/**
 * SpectrogramRenderer — Pre-rendered scrolling spectrogram on a <canvas>
 *
 * Uses OfflineAudioContext and ScriptProcessorNode to instantly compute
 * frequency data for the entire audio buffer on initialization.
 * Supports scrubbing, zooming, and muted/grey state.
 */

export class SpectrogramRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {AudioBuffer} audioBuffer
   * @param {Object} opts
   */
  constructor(canvas, audioBuffer, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: false });
    this.buffer = audioBuffer;

    this.accentColor = opts.color || '#f0766b';
    this.minDb = opts.minDb ?? -100;
    this.maxDb = opts.maxDb ?? -20;
    this.isCombined = opts.isCombined ?? false;
    this.bgColor = opts.bgColor || 'rgba(0, 0, 0, 0.3)';
    this.playheadColor = opts.playheadColor || 'rgba(255, 255, 255, 0.9)';
    this.isMuted = false;

    // Zoom state
    this.zoom = 1;
    this.scrollOffset = 0;

    // Callbacks
    this.onSeek = opts.onSeek || null;
    this.onZoom = opts.onZoom || null;
    this.getPlaybackTime = opts.getPlaybackTime || null;
    this.getDuration = opts.getDuration || null;

    this.animFrame = null;
    this.isDragging = false;

    this.offscreenCanvas = null;
    this.colorLUT = this._buildColorLUT();

    this._resize();
    this._bindEvents();
    this._drawStatic(0);
  }

  async init() {
    if (!this.buffer || this.buffer.duration <= 0) return;

    const sampleRate = this.buffer.sampleRate;
    const duration = this.buffer.duration;
    
    const scriptBufferSize = 4096;
    const numChunks = Math.ceil((sampleRate * duration) / scriptBufferSize);
    
    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCanvas.width = numChunks;
    this.offscreenCanvas.height = 200; // Internal vertical resolution
    const offCtx = this.offscreenCanvas.getContext('2d');
    
    offCtx.fillStyle = '#000';
    offCtx.fillRect(0, 0, numChunks, 200);

    const offlineCtx = new OfflineAudioContext(1, sampleRate * duration, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = this.buffer;

    const analyser = offlineCtx.createAnalyser();
    analyser.fftSize = 2048;

    const scriptNode = offlineCtx.createScriptProcessor(scriptBufferSize, 1, 1);

    source.connect(analyser);
    analyser.connect(scriptNode);
    scriptNode.connect(offlineCtx.destination);

    const maxBin = Math.min(analyser.frequencyBinCount, Math.floor(analyser.frequencyBinCount * 0.75));
    const h = this.offscreenCanvas.height;
    let x = 0;

    scriptNode.onaudioprocess = () => {
      const data = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(data);

      for (let y = 0; y < h; y++) {
        const normalizedY = 1 - y / h;
        const binIndex = Math.floor(Math.pow(normalizedY, 1.5) * maxBin);

        if (binIndex >= 0 && binIndex < data.length) {
          const db = data[binIndex];
          const normalized = Math.max(0, Math.min(1, (db - this.minDb) / (this.maxDb - this.minDb)));
          const lutIndex = Math.floor(normalized * 255);
          const color = this.colorLUT[lutIndex];

          if (color) {
            offCtx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
            offCtx.fillRect(x, y, 1, 1);
          }
        }
      }
      x++;
    };

    source.start(0);
    await offlineCtx.startRendering();
    
    // Initial draw
    const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
    const d = this.getDuration ? this.getDuration() : this.buffer.duration;
    this._drawStatic(d > 0 ? t / d : 0);
  }

  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  /* ---------- Drag-to-scrub & zoom events ---------- */
  _bindEvents() {
    this.canvas.style.cursor = 'grab';

    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.canvas.style.cursor = 'grabbing';
      this._seekFromEvent(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this._seekFromEvent(e);
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
      }
    });

    this.canvas.addEventListener('touchstart', (e) => {
      this.isDragging = true;
      this._seekFromTouch(e);
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      if (!this.isDragging) return;
      e.preventDefault();
      this._seekFromTouch(e);
    }, { passive: false });

    this.canvas.addEventListener('touchend', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mousePct = mouseX / rect.width;

      const zoomDelta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const oldZoom = this.zoom;
      let newZoom = oldZoom * zoomDelta;
      newZoom = Math.max(1, Math.min(50, newZoom));

      if (newZoom === oldZoom) return;

      const trackPosUnderMouse = this.scrollOffset + mousePct / oldZoom;
      let newOffset = trackPosUnderMouse - mousePct / newZoom;
      
      const maxOffset = 1 - 1 / newZoom;
      newOffset = Math.max(0, Math.min(maxOffset, newOffset));

      this.zoom = newZoom;
      this.scrollOffset = newOffset;

      if (this.onZoom) {
        this.onZoom(this.zoom, this.scrollOffset);
      }

      const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
      const d = this.getDuration ? this.getDuration() : this.buffer.duration;
      this._drawStatic(d > 0 ? t / d : 0);
    }, { passive: false });

    this._resizeObserver = new ResizeObserver(() => {
      this._resize();
      const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
      const d = this.getDuration ? this.getDuration() : this.buffer.duration;
      this._drawStatic(d > 0 ? t / d : 0);
    });
    this._resizeObserver.observe(this.canvas.parentElement);
  }

  _seekFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const pctInView = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const trackPct = this.scrollOffset + pctInView / this.zoom;
    const duration = this.getDuration ? this.getDuration() : this.buffer.duration;
    if (this.onSeek) this.onSeek(Math.max(0, Math.min(1, trackPct)) * duration);
  }

  _seekFromTouch(e) {
    const rect = this.canvas.getBoundingClientRect();
    const pctInView = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
    const trackPct = this.scrollOffset + pctInView / this.zoom;
    const duration = this.getDuration ? this.getDuration() : this.buffer.duration;
    if (this.onSeek) this.onSeek(Math.max(0, Math.min(1, trackPct)) * duration);
  }

  setZoom(zoom, scrollOffset) {
    this.zoom = zoom;
    this.scrollOffset = scrollOffset;
    const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
    const d = this.getDuration ? this.getDuration() : this.buffer.duration;
    this._drawStatic(d > 0 ? t / d : 0);
  }

  setMuted(muted) {
    this.isMuted = muted;
    const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
    const d = this.getDuration ? this.getDuration() : this.buffer.duration;
    this._drawStatic(d > 0 ? t / d : 0);
  }

  /* ---------- Rendering ---------- */

  _drawStatic(progress) {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, width, height);

    if (this.offscreenCanvas && this.offscreenCanvas.width > 0) {
      const visibleFraction = 1 / this.zoom;
      const startPct = this.scrollOffset;

      const sx = startPct * this.offscreenCanvas.width;
      const sw = visibleFraction * this.offscreenCanvas.width;
      
      if (this.isMuted) {
        ctx.globalAlpha = 0.2;
        ctx.filter = 'grayscale(100%) brightness(50%)';
      }

      ctx.drawImage(
        this.offscreenCanvas,
        sx, 0, sw, this.offscreenCanvas.height,
        0, 0, width, height
      );
      
      ctx.globalAlpha = 1.0;
      ctx.filter = 'none';
      
      if (this.isMuted) {
        ctx.fillStyle = `rgba(0,0,0,0.4)`;
        ctx.fillRect(0, 0, width, height);
      }
    }

    const visibleFraction = 1 / this.zoom;
    const startPct = this.scrollOffset;
    const playheadViewPct = (progress - startPct) / visibleFraction;
    const playheadX = playheadViewPct * width;

    if (playheadViewPct >= 0 && playheadViewPct <= 1) {
      ctx.fillStyle = this.playheadColor;
      ctx.fillRect(playheadX - 1, 0, 2, height);

      const grad = ctx.createLinearGradient(playheadX - 8, 0, playheadX + 8, 0);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(playheadX - 8, 0, 16, height);
    }
  }

  _autoScroll(progress) {
    if (this.zoom <= 1 || this.isDragging) return;

    const visibleFraction = 1 / this.zoom;
    const margin = visibleFraction * 0.15; 

    if (progress > this.scrollOffset + visibleFraction - margin) {
      this.scrollOffset = Math.min(
        1 - visibleFraction,
        progress - visibleFraction * 0.3 
      );
    }
    if (progress < this.scrollOffset + margin) {
      this.scrollOffset = Math.max(0, progress - visibleFraction * 0.3);
    }
  }

  start() {
    const animate = () => {
      const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
      const d = this.getDuration ? this.getDuration() : (this.buffer ? this.buffer.duration : 0);
      const progress = d > 0 ? t / d : 0;
      this._autoScroll(progress);
      this._drawStatic(progress);
      this.animFrame = requestAnimationFrame(animate);
    };
    if (!this.animFrame) {
      this.animFrame = requestAnimationFrame(animate);
    }
  }

  stop() {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
    const d = this.getDuration ? this.getDuration() : (this.buffer ? this.buffer.duration : 0);
    this._drawStatic(d > 0 ? t / d : 0);
  }

  clear() {
    this._drawStatic(0);
  }

  destroy() {
    this.stop();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
    }
  }

  /* ---------- Color LUT ---------- */
  _buildColorLUT() {
    const lut = new Array(256);
    if (this.isCombined) {
      for (let i = 0; i < 256; i++) {
        const t = i / 255;
        let r, g, b;
        if (t < 0.15) {
          r = 0; g = 0; b = Math.floor(40 * (t / 0.15));
        } else if (t < 0.35) {
          const lt = (t - 0.15) / 0.2;
          r = Math.floor(80 * lt); g = 0; b = Math.floor(40 + 80 * lt);
        } else if (t < 0.55) {
          const lt = (t - 0.35) / 0.2;
          r = Math.floor(80 + 160 * lt); g = Math.floor(40 * lt); b = Math.floor(120 * (1 - lt));
        } else if (t < 0.75) {
          const lt = (t - 0.55) / 0.2;
          r = 240; g = Math.floor(40 + 140 * lt); b = Math.floor(20 * lt);
        } else if (t < 0.9) {
          const lt = (t - 0.75) / 0.15;
          r = 240; g = Math.floor(180 + 60 * lt); b = Math.floor(20 + 50 * lt);
        } else {
          const lt = (t - 0.9) / 0.1;
          r = Math.floor(240 + 15 * lt); g = Math.floor(240 + 15 * lt); b = Math.floor(70 + 185 * lt);
        }
        lut[i] = [r, g, b];
      }
    } else {
      const hex = this.accentColor;
      const base = [
        parseInt(hex.replace('#', '').substring(0, 2), 16),
        parseInt(hex.replace('#', '').substring(2, 4), 16),
        parseInt(hex.replace('#', '').substring(4, 6), 16),
      ];
      for (let i = 0; i < 256; i++) {
        const t = i / 255;
        if (t < 0.1) {
          lut[i] = [0, 0, 0];
        } else if (t < 0.5) {
          const lt = (t - 0.1) / 0.4;
          lut[i] = [
            Math.floor(base[0] * 0.3 * lt),
            Math.floor(base[1] * 0.3 * lt),
            Math.floor(base[2] * 0.3 * lt),
          ];
        } else {
          const lt = (t - 0.5) / 0.5;
          lut[i] = [
            Math.floor(base[0] * (0.3 + 0.7 * lt)),
            Math.floor(base[1] * (0.3 + 0.7 * lt)),
            Math.floor(base[2] * (0.3 + 0.7 * lt)),
          ];
        }
      }
    }
    return lut;
  }
}
