/**
 * AudioEngine — Synchronized multi-stem playback using Web Audio API
 *
 * Each stem gets:
 *   AudioBufferSourceNode → GainNode → AnalyserNode → masterGain → destination
 *
 * All stems share one AudioContext and are kept in perfect sync.
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;          // AudioContext (created on first user gesture)
    this.masterGain = null;   // GainNode for master volume
    this.stems = new Map();   // stemId → { buffer, source, gain, analyser, muted, soloed, volume }
    this.isPlaying = false;
    this.startTime = 0;       // ctx.currentTime when playback started
    this.pauseOffset = 0;     // seconds into the track when paused
    this.duration = 0;        // total duration (longest stem)
    this.onEndedCallback = null;
  }

  /* ---------- Initialization ---------- */

  async init(stemConfigs, onProgress) {
    // stemConfigs: [{ id, name, url, color }]
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);

    const total = stemConfigs.length;
    let loaded = 0;

    const loadPromises = stemConfigs.map(async (cfg) => {
      const response = await fetch(cfg.url);
      if (!response.ok) throw new Error(`Failed to load ${cfg.url}: ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

      const gain = this.ctx.createGain();
      gain.gain.value = 1.0;

      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.7;

      gain.connect(analyser);
      analyser.connect(this.masterGain);

      this.stems.set(cfg.id, {
        id: cfg.id,
        name: cfg.name,
        color: cfg.color,
        buffer: audioBuffer,
        source: null,
        gain,
        analyser,
        muted: false,
        soloed: false,
        volume: 1.0,
      });

      if (audioBuffer.duration > this.duration) {
        this.duration = audioBuffer.duration;
      }

      loaded++;
      if (onProgress) onProgress(loaded / total);
    });

    await Promise.all(loadPromises);
  }

  /* ---------- Playback ---------- */

  play() {
    if (this.isPlaying) return;

    // Resume AudioContext if suspended (Safari autoplay policy)
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.stems.forEach((stem) => {
      const source = this.ctx.createBufferSource();
      source.buffer = stem.buffer;
      source.connect(stem.gain);
      source.start(0, this.pauseOffset);
      stem.source = source;
    });

    this.startTime = this.ctx.currentTime - this.pauseOffset;
    this.isPlaying = true;

    // Set up ended detection on the longest stem
    const longestStem = [...this.stems.values()].reduce((a, b) =>
      a.buffer.duration > b.buffer.duration ? a : b
    );
    longestStem.source.onended = () => {
      if (this.isPlaying && this.getCurrentTime() >= this.duration - 0.1) {
        this.stop();
        this.pauseOffset = 0;
        if (this.onEndedCallback) this.onEndedCallback();
      }
    };
  }

  pause() {
    if (!this.isPlaying) return;
    this.pauseOffset = this.getCurrentTime();
    this._stopSources();
    this.isPlaying = false;
  }

  stop() {
    this._stopSources();
    this.isPlaying = false;
    this.pauseOffset = 0;
  }

  togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
    return this.isPlaying;
  }

  seek(timeSeconds) {
    const wasPlaying = this.isPlaying;
    if (this.isPlaying) {
      this._stopSources();
    }
    this.pauseOffset = Math.max(0, Math.min(timeSeconds, this.duration));
    if (wasPlaying) {
      this.isPlaying = false;
      this.play();
    }
  }

  getCurrentTime() {
    if (this.isPlaying) {
      return this.ctx.currentTime - this.startTime;
    }
    return this.pauseOffset;
  }

  _stopSources() {
    this.stems.forEach((stem) => {
      if (stem.source) {
        try {
          stem.source.onended = null;
          stem.source.stop();
        } catch (e) { /* already stopped */ }
        stem.source = null;
      }
    });
  }

  /* ---------- Mute / Solo / Volume ---------- */

  setVolume(stemId, value) {
    const stem = this.stems.get(stemId);
    if (!stem) return;
    stem.volume = value;
    this._updateGains();
  }

  toggleMute(stemId) {
    const stem = this.stems.get(stemId);
    if (!stem) return;
    stem.muted = !stem.muted;
    // If muting, also un-solo
    if (stem.muted) stem.soloed = false;
    this._updateGains();
    return stem.muted;
  }

  toggleSolo(stemId) {
    const stem = this.stems.get(stemId);
    if (!stem) return;
    stem.soloed = !stem.soloed;
    // If soloing, un-mute this stem
    if (stem.soloed) stem.muted = false;
    this._updateGains();
    return stem.soloed;
  }

  setMasterVolume(value) {
    if (this.masterGain) {
      this.masterGain.gain.value = value;
    }
  }

  allOn() {
    this.stems.forEach((stem) => {
      stem.muted = false;
      stem.soloed = false;
    });
    this._updateGains();
  }

  allOff() {
    this.stems.forEach((stem) => {
      stem.muted = true;
      stem.soloed = false;
    });
    this._updateGains();
  }

  _updateGains() {
    const anySoloed = [...this.stems.values()].some((s) => s.soloed);

    this.stems.forEach((stem) => {
      let effectiveVolume;
      if (anySoloed) {
        // In solo mode: only soloed tracks play
        effectiveVolume = stem.soloed ? stem.volume : 0;
      } else {
        // Normal mode: muted tracks are silent
        effectiveVolume = stem.muted ? 0 : stem.volume;
      }
      stem.gain.gain.setTargetAtTime(effectiveVolume, this.ctx.currentTime, 0.02);
    });
  }

  /* ---------- Analyser Data ---------- */

  getAnalyserData(stemId) {
    const stem = this.stems.get(stemId);
    if (!stem) return null;
    return stem.analyser;
  }

  getCombinedAnalyser() {
    // For combined visualization — create an analyser on the master gain
    if (!this._combinedAnalyser) {
      this._combinedAnalyser = this.ctx.createAnalyser();
      this._combinedAnalyser.fftSize = 4096;
      this._combinedAnalyser.smoothingTimeConstant = 0.7;
      this.masterGain.connect(this._combinedAnalyser);
    }
    return this._combinedAnalyser;
  }

  /* ---------- Getters ---------- */

  getStemState(stemId) {
    const stem = this.stems.get(stemId);
    if (!stem) return null;
    return {
      muted: stem.muted,
      soloed: stem.soloed,
      volume: stem.volume,
    };
  }

  getAllStems() {
    return [...this.stems.values()].map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color,
    }));
  }

  getBuffer(stemId) {
    const stem = this.stems.get(stemId);
    return stem ? stem.buffer : null;
  }

  /**
   * Returns an AudioBuffer that is the sum of ALL stem buffers,
   * suitable for rendering a combined waveform.
   */
  getMixedBuffer() {
    const buffers = [];
    for (const stem of this.stems.values()) {
      if (stem.buffer) buffers.push(stem.buffer);
    }
    if (buffers.length === 0) return null;

    const sampleRate = buffers[0].sampleRate;
    const length = Math.max(...buffers.map((b) => b.length));
    const numChannels = Math.max(...buffers.map((b) => b.numberOfChannels));

    const mixed = this.ctx.createBuffer(numChannels, length, sampleRate);

    for (let ch = 0; ch < numChannels; ch++) {
      const mixData = mixed.getChannelData(ch);
      for (const buf of buffers) {
        // Use channel 0 if this buffer has fewer channels
        const srcCh = ch < buf.numberOfChannels ? ch : 0;
        const srcData = buf.getChannelData(srcCh);
        for (let i = 0; i < srcData.length; i++) {
          mixData[i] += srcData[i];
        }
      }
      // Normalize to avoid clipping — divide by number of stems
      const scale = 1 / buffers.length;
      for (let i = 0; i < mixData.length; i++) {
        mixData[i] *= scale;
      }
    }

    return mixed;
  }
}
