/**
 * WaveformRenderer — Full-track waveform visualization with DJ-style scrubbing & zoom
 *
 * Pre-computes a downsampled waveform from the AudioBuffer and renders it 
 * on a canvas with a moving playhead. Supports click-and-drag to seek,
 * synchronized zoom, and muted/grey state.
 */

export class WaveformRenderer {
  constructor(canvas, audioBuffer, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.buffer = audioBuffer;

    this.activeColor = options.color || '#f0766b';
    this.color = this.activeColor;
    this.mutedColor = '#3a3a4a';
    this.bgColor = options.bgColor || 'rgba(0, 0, 0, 0.3)';
    this.playheadColor = options.playheadColor || 'rgba(255, 255, 255, 0.9)';
    this.isCombined = options.isCombined || false;
    this.isMuted = false;

    // Zoom state — shared via external zoom controller
    this.zoom = 1;          // 1 = full track visible
    this.scrollOffset = 0;  // 0..1 representing left edge position in the track

    // Callbacks
    this.onSeek = options.onSeek || null;
    this.onZoom = options.onZoom || null; // (zoom, scrollOffset) => void
    this.getPlaybackTime = options.getPlaybackTime || null;
    this.getDuration = options.getDuration || null;

    // Pre-computed waveform peaks (high-res, we downsample when drawing)
    this.peaks = null;
    this.animFrame = null;
    this.isDragging = false;

    this._resize();
    this._computePeaks();
    this._bindEvents();
    this._drawStatic(0);
  }

  /* ---------- Resize & DPR handling ---------- */
  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  /* ---------- Pre-compute waveform peaks ---------- */
  _computePeaks() {
    if (!this.buffer) return;

    const numChannels = this.buffer.numberOfChannels;
    const totalSamples = this.buffer.length;

    // Compute a very high-res set of peaks — ~6000 peaks total
    // This allows us to zoom in quite far without losing detail
    const targetPeaks = 6000;
    const samplesPerPeak = Math.max(1, Math.floor(totalSamples / targetPeaks));

    const channelData = [];
    for (let c = 0; c < numChannels; c++) {
      channelData.push(this.buffer.getChannelData(c));
    }

    this.peaks = [];
    for (let i = 0; i < targetPeaks; i++) {
      const start = i * samplesPerPeak;
      const end = Math.min(start + samplesPerPeak, totalSamples);
      let min = 0, max = 0;

      for (let j = start; j < end; j++) {
        let sample = 0;
        for (let c = 0; c < numChannels; c++) {
          sample += channelData[c][j];
        }
        sample /= numChannels;
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }

      this.peaks.push({ min, max });
    }
  }

  /* ---------- Drag-to-scrub & zoom events ---------- */
  _bindEvents() {
    this.canvas.style.cursor = 'grab';

    // Click and drag to seek
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

    // Touch support
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

    // Scroll wheel to zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mousePct = mouseX / rect.width; // 0..1 position of mouse in canvas

      // Calculate zoom
      const zoomDelta = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const oldZoom = this.zoom;
      let newZoom = oldZoom * zoomDelta;
      newZoom = Math.max(1, Math.min(50, newZoom)); // Clamp zoom 1x to 50x

      if (newZoom === oldZoom) return;

      // Adjust scroll offset so the point under the mouse stays fixed
      // The mouse points at track position: scrollOffset + mousePct / zoom
      const trackPosUnderMouse = this.scrollOffset + mousePct / oldZoom;
      let newOffset = trackPosUnderMouse - mousePct / newZoom;
      
      // Clamp offset
      const maxOffset = 1 - 1 / newZoom;
      newOffset = Math.max(0, Math.min(maxOffset, newOffset));

      this.zoom = newZoom;
      this.scrollOffset = newOffset;

      // Notify parent to sync all waveforms
      if (this.onZoom) {
        this.onZoom(this.zoom, this.scrollOffset);
      }

      // Re-draw immediately
      const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
      const d = this.getDuration ? this.getDuration() : this.buffer.duration;
      this._drawStatic(d > 0 ? t / d : 0);
    }, { passive: false });

    // Resize
    this._resizeObserver = new ResizeObserver(() => {
      this._resize();
      this._computePeaks();
      const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
      const d = this.getDuration ? this.getDuration() : this.buffer.duration;
      this._drawStatic(d > 0 ? t / d : 0);
    });
    this._resizeObserver.observe(this.canvas.parentElement);
  }

  _seekFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pctInView = Math.max(0, Math.min(1, x / rect.width));
    // Convert view position to track position using zoom/scroll
    const trackPct = this.scrollOffset + pctInView / this.zoom;
    const duration = this.getDuration ? this.getDuration() : this.buffer.duration;
    if (this.onSeek) this.onSeek(Math.max(0, Math.min(1, trackPct)) * duration);
  }

  _seekFromTouch(e) {
    const touch = e.touches[0];
    const rect = this.canvas.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const pctInView = Math.max(0, Math.min(1, x / rect.width));
    const trackPct = this.scrollOffset + pctInView / this.zoom;
    const duration = this.getDuration ? this.getDuration() : this.buffer.duration;
    if (this.onSeek) this.onSeek(Math.max(0, Math.min(1, trackPct)) * duration);
  }

  /* ---------- External zoom/scroll sync ---------- */
  setZoom(zoom, scrollOffset) {
    this.zoom = zoom;
    this.scrollOffset = scrollOffset;
    const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
    const d = this.getDuration ? this.getDuration() : this.buffer.duration;
    this._drawStatic(d > 0 ? t / d : 0);
  }

  /* ---------- Muted state ---------- */
  setMuted(muted) {
    this.isMuted = muted;
    this.color = muted ? this.mutedColor : this.activeColor;
    // Re-draw
    const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
    const d = this.getDuration ? this.getDuration() : this.buffer.duration;
    this._drawStatic(d > 0 ? t / d : 0);
  }

  /* ---------- Drawing ---------- */
  _drawStatic(progress) {
    const { ctx, width, height, peaks, color } = this;
    if (!peaks || peaks.length === 0) return;

    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = this.bgColor;
    ctx.fillRect(0, 0, width, height);

    const mid = height / 2;
    const totalPeaks = peaks.length;

    // Calculate visible range based on zoom and scroll
    const visibleFraction = 1 / this.zoom;
    const startPct = this.scrollOffset;
    const endPct = startPct + visibleFraction;

    const startIdx = Math.floor(startPct * totalPeaks);
    const endIdx = Math.min(Math.ceil(endPct * totalPeaks), totalPeaks);
    const visiblePeaks = endIdx - startIdx;

    if (visiblePeaks <= 0) return;

    const barWidth = width / visiblePeaks;

    // Where is the playhead in the visible range?
    const playheadTrackPct = progress; // 0..1 in full track
    const playheadViewPct = (playheadTrackPct - startPct) / visibleFraction; // 0..1 in view
    const playheadX = playheadViewPct * width;

    // Draw waveform bars
    for (let i = 0; i < visiblePeaks; i++) {
      const peakIdx = startIdx + i;
      if (peakIdx < 0 || peakIdx >= totalPeaks) continue;

      const x = i * barWidth;
      const peakTrackPct = peakIdx / totalPeaks;
      const isPast = peakTrackPct < playheadTrackPct;

      if (this.isMuted) {
        ctx.fillStyle = this.mutedColor;
        ctx.globalAlpha = isPast ? 0.5 : 0.2;
      } else if (isPast) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.9;
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3;
      }

      const maxH = peaks[peakIdx].max * mid;
      const minH = peaks[peakIdx].min * mid;

      ctx.fillRect(x, mid - maxH, Math.max(barWidth - 0.3, 0.8), maxH - minH || 1);
    }

    ctx.globalAlpha = 1;

    // Center line
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(0, mid - 0.5, width, 1);

    // Playhead (only if visible in current view)
    if (playheadViewPct >= 0 && playheadViewPct <= 1) {
      ctx.fillStyle = this.playheadColor;
      ctx.fillRect(playheadX - 1, 0, 2, height);

      // Glow
      const grad = ctx.createLinearGradient(playheadX - 8, 0, playheadX + 8, 0);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
      grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(playheadX - 8, 0, 16, height);
    }

    // Zoom indicator (only when zoomed in)
    if (this.zoom > 1.05) {
      // Mini-map at top-right
      const mmW = 60;
      const mmH = 8;
      const mmX = width - mmW - 8;
      const mmY = 6;

      // Background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(mmX, mmY, mmW, mmH);

      // Viewport indicator
      ctx.fillStyle = 'rgba(155, 109, 255, 0.5)';
      const vpX = mmX + startPct * mmW;
      const vpW = Math.max(2, visibleFraction * mmW);
      ctx.fillRect(vpX, mmY, vpW, mmH);

      // Border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(mmX, mmY, mmW, mmH);

      // Zoom label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '9px "Space Grotesk", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${this.zoom.toFixed(1)}×`, mmX - 4, mmY + 7);
      ctx.textAlign = 'start';
    }
  }

  /* ---------- Auto-scroll: keep playhead in view ---------- */
  _autoScroll(progress) {
    if (this.zoom <= 1 || this.isDragging) return;

    const visibleFraction = 1 / this.zoom;
    const margin = visibleFraction * 0.15; // 15% margin before auto-scroll

    // If playhead is about to leave the right edge
    if (progress > this.scrollOffset + visibleFraction - margin) {
      this.scrollOffset = Math.min(
        1 - visibleFraction,
        progress - visibleFraction * 0.3 // Put playhead at 30% from left
      );
    }
    // If playhead is behind the left edge (e.g., user seeked backwards)
    if (progress < this.scrollOffset + margin) {
      this.scrollOffset = Math.max(0, progress - visibleFraction * 0.3);
    }
  }

  /* ---------- Animation Loop ---------- */
  start() {
    const animate = () => {
      const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
      const d = this.getDuration ? this.getDuration() : this.buffer.duration;
      const progress = d > 0 ? t / d : 0;
      this._autoScroll(progress);
      this._drawStatic(progress);
      this.animFrame = requestAnimationFrame(animate);
    };
    this.animFrame = requestAnimationFrame(animate);
  }

  stop() {
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
    const d = this.getDuration ? this.getDuration() : this.buffer.duration;
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

  setColor(newColor) {
    this.activeColor = newColor;
    if (!this.isMuted) this.color = newColor;
    const t = this.getPlaybackTime ? this.getPlaybackTime() : 0;
    const d = this.getDuration ? this.getDuration() : this.buffer.duration;
    this._drawStatic(d > 0 ? t / d : 0);
  }
}
