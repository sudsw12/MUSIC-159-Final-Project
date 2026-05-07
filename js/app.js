/**
 * App — Main application for Champagne Coast stem analyzer
 *
 * Wires together the AudioEngine, SpectrogramRenderers, admin panel, and the DOM.
 */

import { AudioEngine } from './audio-engine.js';
import { SpectrogramRenderer } from './spectrogram.js';
import { WaveformRenderer } from './waveform.js';

/* ---------- Stem Configuration ---------- */
const STEM_CONFIG = [
  { id: 'vocals', name: 'Vocals',  url: 'audio/vocals.mp3', color: '#f0766b' },
  { id: 'hihat',  name: 'Hi-Hat',  url: 'audio/hihat.mp3',  color: '#e05e8a' },
  { id: 'bass',   name: 'Bass',    url: 'audio/bass.mp3',   color: '#9b6dff' },
  { id: 'melody', name: 'Melody',  url: 'audio/melody.mp3', color: '#5b87f5' },
  { id: 'kick',   name: 'Kick',    url: 'audio/kick.mp3',   color: '#4fd1d9' },
];

/* ---------- Admin Credentials ---------- */
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'champagne2011';

/* ---------- State ---------- */
const engine = new AudioEngine();
const spectrograms = new Map();
const waveforms = new Map();
let combinedSpectrogram = null;
let combinedWaveform = null;
let seekAnimFrame = null;
let vizMode = 'spectrogram'; // 'spectrogram' | 'waveform'
let isAdmin = false;
let markers = [
  { id: 'verse_1', time: 14, label: 'Verse 1', color: '#f0766b' },
  { id: 'refrain_1', time: 30, label: 'Refrain', color: '#e05e8a' },
  { id: 'verse_2', time: 46, label: 'Verse 2', color: '#f0766b' },
  { id: 'refrain_2', time: 61, label: 'Refrain', color: '#e05e8a' },
  { id: 'verse_3', time: 85, label: 'Verse 3', color: '#f0766b' },
  { id: 'refrain_3', time: 100, label: 'Refrain', color: '#e05e8a' },
  { id: 'breakdown', time: 148, label: 'Breakdown', color: '#9b6dff' },
  { id: 'outro', time: 210, label: 'Outro', color: '#4fd1d9' }
];
let spectrogramSettings = {
  minDb: -100,
  maxDb: -25,
  combinedMinDb: -100,
  combinedMaxDb: -20,
  fftSize: 2048,
  smoothing: 0.7,
};

/* ---------- LocalStorage Keys ---------- */
const LS_MARKERS = 'cc_markers';
const LS_SPECTRO = 'cc_spectro_settings';
const LS_THEME = 'cc_theme';
const LS_VIZ_MODE = 'cc_viz_mode';

/* ---------- DOM Helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ---------- Load persisted data ---------- */
function loadPersistedData() {
  try {
    const m = localStorage.getItem(LS_MARKERS);
    if (m) {
      markers = JSON.parse(m);
    }

    const s = localStorage.getItem(LS_SPECTRO);
    if (s) spectrogramSettings = { ...spectrogramSettings, ...JSON.parse(s) };

    const v = localStorage.getItem(LS_VIZ_MODE);
    if (v) vizMode = v;

    const t = localStorage.getItem(LS_THEME);
    if (t) {
      const theme = JSON.parse(t);
      Object.entries(theme).forEach(([key, value]) => {
        document.documentElement.style.setProperty(key, value);
      });
    }
  } catch (e) {
    console.warn('Failed to load persisted data:', e);
  }
}

function saveMarkers() {
  localStorage.setItem(LS_MARKERS, JSON.stringify(markers));
}

function saveSpectroSettings() {
  localStorage.setItem(LS_SPECTRO, JSON.stringify(spectrogramSettings));
}

function saveTheme(overrides) {
  localStorage.setItem(LS_THEME, JSON.stringify(overrides));
}

/* ---------- Build Stem Track Cards ---------- */
function buildStemCards() {
  const grid = $('#stems-grid');
  grid.innerHTML = '';

  STEM_CONFIG.forEach((cfg) => {
    const card = document.createElement('div');
    card.className = 'stem-track';
    card.id = `stem-${cfg.id}`;
    card.style.setProperty('--stem-color', cfg.color);

    card.innerHTML = `
      <div class="stem-track__header">
        <div class="stem-track__indicator"></div>
        <div class="stem-track__info">
          <span class="stem-track__name">${cfg.name}</span>
        </div>
        <div class="stem-track__controls">
          <button class="btn-control btn-mute" data-stem="${cfg.id}" title="Mute">M</button>
          <button class="btn-control btn-solo" data-stem="${cfg.id}" title="Solo">S</button>
        </div>
        <button class="btn-expand btn-expand-stem" title="Toggle Fullscreen" data-stem="${cfg.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
        </button>
      </div>
      <div class="stem-track__volume">
        <svg class="volume-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"></path>
        </svg>
        <input type="range" class="volume-slider" data-stem="${cfg.id}" min="0" max="100" value="100" />
        <span class="volume-value" data-stem="${cfg.id}">100%</span>
      </div>
      <div class="stem-track__spectrogram" data-stem="${cfg.id}">
        <canvas id="canvas-${cfg.id}" class="viz-canvas viz-canvas--spectro"></canvas>
        <canvas id="canvas-wf-${cfg.id}" class="viz-canvas viz-canvas--waveform"></canvas>
      </div>
    `;
    grid.appendChild(card);
  });
}

/* ---------- Build Admin UI ---------- */
function buildAdminUI() {
  // Login button in header
  const loginBtn = document.createElement('button');
  loginBtn.className = 'btn-login';
  loginBtn.id = 'btn-login';
  loginBtn.textContent = 'Log In';
  loginBtn.addEventListener('click', () => {
    if (isAdmin) {
      isAdmin = false;
      loginBtn.textContent = 'Log In';
      hideAdminPanel();
    } else {
      showLoginModal();
    }
  });
  $('#login-area').appendChild(loginBtn);
}

function showLoginModal() {
  const existing = $('#login-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'login-modal';
  modal.innerHTML = `
    <div class="modal">
      <h2 class="modal__title">Admin Login</h2>
      <p class="modal__subtitle">Log in to edit page settings and add markers</p>
      <div class="modal__field">
        <label for="login-user">Username</label>
        <input type="text" id="login-user" placeholder="Username" autocomplete="off" />
      </div>
      <div class="modal__field">
        <label for="login-pass">Password</label>
        <input type="password" id="login-pass" placeholder="Password" />
      </div>
      <p class="modal__error" id="login-error"></p>
      <div class="modal__actions">
        <button class="btn-modal btn-modal--cancel" id="login-cancel">Cancel</button>
        <button class="btn-modal btn-modal--submit" id="login-submit">Log In</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Focus username
  setTimeout(() => $('#login-user').focus(), 100);

  // Events
  $('#login-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  const submit = () => {
    const user = $('#login-user').value.trim();
    const pass = $('#login-pass').value;
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
      isAdmin = true;
      $('#btn-login').textContent = 'Log Out';
      modal.remove();
      showAdminPanel();
    } else {
      $('#login-error').textContent = 'Invalid credentials';
      $('#login-pass').value = '';
      $('#login-pass').focus();
    }
  };

  $('#login-submit').addEventListener('click', submit);
  $('#login-pass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  $('#login-user').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#login-pass').focus();
  });
}

function showAdminPanel() {
  let panel = $('#admin-panel');
  if (panel) {
    panel.classList.remove('hidden');
    return;
  }

  panel = document.createElement('div');
  panel.className = 'admin-panel';
  panel.id = 'admin-panel';
  panel.innerHTML = `
    <div class="admin-panel__header">
      <h3 class="admin-panel__title">Admin Panel</h3>
      <button class="admin-panel__close" id="admin-close">✕</button>
    </div>

    <div class="admin-panel__tabs">
      <button class="admin-tab active" data-tab="markers">Markers</button>
      <button class="admin-tab" data-tab="spectrogram">Spectrogram</button>
      <button class="admin-tab" data-tab="appearance">Appearance</button>
    </div>

    <!-- Markers Tab -->
    <div class="admin-tab-content active" id="tab-markers">
      <p class="admin-hint">Add time-stamped labels for song sections. Time is in seconds.</p>
      <div class="admin-form-row">
        <input type="number" id="marker-time" placeholder="Time (s)" step="0.1" min="0" class="admin-input admin-input--sm" />
        <input type="text" id="marker-label" placeholder="Label (e.g. Verse 1)" class="admin-input" />
        <input type="color" id="marker-color" value="#f0766b" class="admin-color" title="Marker color" />
        <button class="btn-admin" id="btn-add-marker">Add</button>
      </div>
      <button class="btn-admin btn-admin--secondary" id="btn-add-marker-current" style="margin-top:8px;width:100%">
        Add at current playback position
      </button>
      <div class="marker-list" id="marker-list"></div>
    </div>

    <!-- Spectrogram Tab -->
    <div class="admin-tab-content" id="tab-spectrogram">
      <p class="admin-hint">Adjust FFT and dB range for spectrogram rendering.</p>
      <div class="admin-field">
        <label>Min dB (floor)</label>
        <input type="range" id="spectro-min-db" min="-140" max="-40" value="${spectrogramSettings.minDb}" class="admin-slider" />
        <span class="admin-slider-val" id="spectro-min-db-val">${spectrogramSettings.minDb}</span>
      </div>
      <div class="admin-field">
        <label>Max dB (ceiling)</label>
        <input type="range" id="spectro-max-db" min="-60" max="0" value="${spectrogramSettings.maxDb}" class="admin-slider" />
        <span class="admin-slider-val" id="spectro-max-db-val">${spectrogramSettings.maxDb}</span>
      </div>
      <div class="admin-field">
        <label>Smoothing</label>
        <input type="range" id="spectro-smoothing" min="0" max="99" value="${Math.round(spectrogramSettings.smoothing * 100)}" class="admin-slider" />
        <span class="admin-slider-val" id="spectro-smoothing-val">${spectrogramSettings.smoothing}</span>
      </div>
      <button class="btn-admin" id="btn-apply-spectro" style="margin-top:12px;width:100%">Apply Settings</button>
    </div>

    <!-- Appearance Tab -->
    <div class="admin-tab-content" id="tab-appearance">
      <p class="admin-hint">Customize the look and feel of the page.</p>
      <div class="admin-field">
        <label>Accent Color (Coral)</label>
        <input type="color" id="theme-accent-coral" value="#f0766b" class="admin-color-lg" />
      </div>
      <div class="admin-field">
        <label>Accent Color (Purple)</label>
        <input type="color" id="theme-accent-purple" value="#9b6dff" class="admin-color-lg" />
      </div>
      <div class="admin-field">
        <label>Background</label>
        <input type="color" id="theme-bg" value="#0a0a12" class="admin-color-lg" />
      </div>
      <div class="admin-field">
        <label>Card Background Opacity</label>
        <input type="range" id="theme-card-opacity" min="10" max="90" value="55" class="admin-slider" />
        <span class="admin-slider-val" id="theme-card-opacity-val">55%</span>
      </div>
      <button class="btn-admin" id="btn-apply-theme" style="margin-top:12px;width:100%">Apply Theme</button>
      <button class="btn-admin btn-admin--secondary" id="btn-reset-theme" style="margin-top:8px;width:100%">Reset to Default</button>
    </div>
  `;

  document.body.appendChild(panel);

  // Tab switching
  panel.querySelectorAll('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('active'));
      panel.querySelectorAll('.admin-tab-content').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      $(`#tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Close
  $('#admin-close').addEventListener('click', () => hideAdminPanel());

  // Markers
  $('#btn-add-marker').addEventListener('click', addMarkerFromForm);
  $('#btn-add-marker-current').addEventListener('click', () => {
    const time = engine.getCurrentTime();
    $('#marker-time').value = time.toFixed(1);
    // Focus label input for quick entry
    $('#marker-label').focus();
  });

  // Spectrogram sliders live readout
  $('#spectro-min-db').addEventListener('input', (e) => {
    $('#spectro-min-db-val').textContent = e.target.value;
  });
  $('#spectro-max-db').addEventListener('input', (e) => {
    $('#spectro-max-db-val').textContent = e.target.value;
  });
  $('#spectro-smoothing').addEventListener('input', (e) => {
    $('#spectro-smoothing-val').textContent = (parseInt(e.target.value) / 100).toFixed(2);
  });

  $('#btn-apply-spectro').addEventListener('click', applySpectroSettings);

  // Appearance
  $('#theme-card-opacity').addEventListener('input', (e) => {
    $('#theme-card-opacity-val').textContent = `${e.target.value}%`;
  });
  $('#btn-apply-theme').addEventListener('click', applyTheme);
  $('#btn-reset-theme').addEventListener('click', resetTheme);

  renderMarkerList();
}

function hideAdminPanel() {
  const panel = $('#admin-panel');
  if (panel) panel.classList.add('hidden');
}

/* ---------- Markers ---------- */
function addMarkerFromForm() {
  const timeInput = $('#marker-time');
  const labelInput = $('#marker-label');
  const colorInput = $('#marker-color');

  const time = parseFloat(timeInput.value);
  const label = labelInput.value.trim();
  if (isNaN(time) || !label) return;

  markers.push({ time, label, color: colorInput.value });
  markers.sort((a, b) => a.time - b.time);
  saveMarkers();
  renderMarkerList();
  renderMarkersOnSeekBar();

  // Reset form
  timeInput.value = '';
  labelInput.value = '';
  labelInput.focus();
}

function removeMarker(index) {
  markers.splice(index, 1);
  saveMarkers();
  renderMarkerList();
  renderMarkersOnSeekBar();
}

function renderMarkerList() {
  const list = $('#marker-list');
  if (!list) return;

  if (markers.length === 0) {
    list.innerHTML = '<p class="admin-hint" style="margin-top:12px;opacity:0.5">No markers added yet</p>';
    return;
  }

  list.innerHTML = markers.map((m, i) => `
    <div class="marker-item">
      <span class="marker-item__color" style="background:${m.color}"></span>
      <span class="marker-item__time">${formatTime(m.time)}</span>
      <span class="marker-item__label">${m.label}</span>
      <button class="marker-item__seek" data-time="${m.time}" title="Seek to this marker">▶</button>
      <button class="marker-item__edit" data-index="${i}" title="Edit marker" style="color:#f0766b; margin-right:4px;">✐</button>
      <button class="marker-item__delete" data-index="${i}" title="Delete marker">✕</button>
    </div>
  `).join('');

  // Events
  list.querySelectorAll('.marker-item__delete').forEach((btn) => {
    btn.addEventListener('click', () => removeMarker(parseInt(btn.dataset.index)));
  });
  list.querySelectorAll('.marker-item__edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.index);
      const m = markers[i];
      $('#marker-time').value = m.time;
      $('#marker-label').value = m.label;
      $('#marker-color').value = m.color;
      removeMarker(i);
      $('#marker-label').focus();
    });
  });
  list.querySelectorAll('.marker-item__seek').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = parseFloat(btn.dataset.time);
      engine.seek(t);
      const seekBar = $('#seek-bar');
      seekBar.value = Math.floor(t * 100);
      updateTimeDisplay(t, engine.duration);
    });
  });
}

function renderMarkersOnSeekBar() {
  // Remove old markers
  $$('.seek-marker').forEach((m) => m.remove());

  if (markers.length === 0 || engine.duration === 0) return;

  const seekWrap = $('.transport__seek');
  markers.forEach((m) => {
    const pct = (m.time / engine.duration) * 100;
    const marker = document.createElement('div');
    marker.className = 'seek-marker';
    marker.style.left = `${pct}%`;
    marker.style.setProperty('--marker-color', m.color);
    marker.title = `${m.label} (${formatTime(m.time)})`;

    // Tooltip
    const tooltip = document.createElement('span');
    tooltip.className = 'seek-marker__tooltip';
    tooltip.textContent = m.label;
    marker.appendChild(tooltip);

    seekWrap.appendChild(marker);
  });
}

/* ---------- Spectrogram Settings ---------- */
function applySpectroSettings() {
  spectrogramSettings.minDb = parseInt($('#spectro-min-db').value);
  spectrogramSettings.maxDb = parseInt($('#spectro-max-db').value);
  spectrogramSettings.smoothing = parseInt($('#spectro-smoothing').value) / 100;

  saveSpectroSettings();

  // Recreate spectrograms with new settings
  rebuildSpectrograms();
}

async function rebuildSpectrograms() {
  const loadingText = $('#loading-text');
  const overlay = $('#loading-overlay');
  
  if (overlay && loadingText) {
    loadingText.textContent = 'Regenerating spectrograms...';
    overlay.classList.remove('hidden');
  }

  // Destroy old spectrograms
  spectrograms.forEach((r) => r.destroy());
  spectrograms.clear();
  if (combinedSpectrogram) {
    combinedSpectrogram.destroy();
    combinedSpectrogram = null;
  }

  const spectroInitPromises = [];

  // Rebuild with updated settings
  STEM_CONFIG.forEach((cfg) => {
    const canvas = $(`#canvas-${cfg.id}`);
    const buffer = engine.getBuffer(cfg.id);
    if (canvas && buffer) {
      const renderer = new SpectrogramRenderer(canvas, buffer, {
        color: cfg.color,
        minDb: spectrogramSettings.minDb,
        maxDb: spectrogramSettings.maxDb,
        isCombined: false,
        onSeek: handleWaveformSeek,
        onZoom: handleWaveformZoom,
        getPlaybackTime: () => engine.getCurrentTime(),
        getDuration: () => engine.duration,
      });
      spectrograms.set(cfg.id, renderer);
      spectroInitPromises.push(renderer.init());
    }
  });

  const combinedCanvas = $('#canvas-combined');
  const combinedBuffer = engine.getMixedBuffer();
  if (combinedCanvas && combinedBuffer) {
    combinedSpectrogram = new SpectrogramRenderer(combinedCanvas, combinedBuffer, {
      minDb: spectrogramSettings.combinedMinDb,
      maxDb: spectrogramSettings.combinedMaxDb,
      isCombined: true,
      onSeek: handleWaveformSeek,
      onZoom: handleWaveformZoom,
      getPlaybackTime: () => engine.getCurrentTime(),
      getDuration: () => engine.duration,
    });
    spectroInitPromises.push(combinedSpectrogram.init());
  }

  await Promise.all(spectroInitPromises);

  if (overlay) {
    overlay.classList.add('hidden');
  }

  // If currently playing, start the active viz
  if (engine.isPlaying) {
    startActiveViz();
  }
}

/* ---------- Theme ---------- */
function applyTheme() {
  const coral = $('#theme-accent-coral').value;
  const purple = $('#theme-accent-purple').value;
  const bg = $('#theme-bg').value;
  const cardOp = parseInt($('#theme-card-opacity').value) / 100;

  const overrides = {
    '--accent-coral': coral,
    '--accent-purple': purple,
    '--bg-primary': bg,
    '--glass-bg': `rgba(${hexToRGB(bg).map((c) => Math.min(255, c + 12)).join(',')}, ${cardOp})`,
  };

  Object.entries(overrides).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });

  saveTheme(overrides);
}

function resetTheme() {
  const defaults = {
    '--accent-coral': '#f0766b',
    '--accent-purple': '#9b6dff',
    '--bg-primary': '#0a0a12',
    '--glass-bg': 'rgba(20, 20, 36, 0.55)',
  };
  Object.entries(defaults).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });
  localStorage.removeItem(LS_THEME);

  // Update inputs
  if ($('#theme-accent-coral')) $('#theme-accent-coral').value = '#f0766b';
  if ($('#theme-accent-purple')) $('#theme-accent-purple').value = '#9b6dff';
  if ($('#theme-bg')) $('#theme-bg').value = '#0a0a12';
  if ($('#theme-card-opacity')) {
    $('#theme-card-opacity').value = 55;
    $('#theme-card-opacity-val').textContent = '55%';
  }
}

function hexToRGB(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

/* ---------- Visualization Mode Toggle ---------- */
function buildVizToggle() {
  const wrap = document.createElement('div');
  wrap.className = 'viz-toggle';
  wrap.innerHTML = `
    <button class="viz-toggle__btn ${vizMode === 'spectrogram' ? 'active' : ''}" data-mode="spectrogram">
      <svg viewBox="0 0 18 18" width="14" height="14"><rect x="1" y="1" width="3" height="16" rx="1" fill="currentColor" opacity=".3"/><rect x="5" y="4" width="3" height="10" rx="1" fill="currentColor" opacity=".5"/><rect x="9" y="2" width="3" height="14" rx="1" fill="currentColor" opacity=".7"/><rect x="13" y="6" width="3" height="6" rx="1" fill="currentColor"/></svg>
      Spectrogram
    </button>
    <button class="viz-toggle__btn ${vizMode === 'waveform' ? 'active' : ''}" data-mode="waveform">
      <svg viewBox="0 0 18 18" width="14" height="14"><path d="M1 9 Q3 3, 5 9 Q7 15, 9 9 Q11 3, 13 9 Q15 15, 17 9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
      Waveform
    </button>
  `;

  // Insert before the stems grid
  const stemsGrid = $('#stems-grid');
  stemsGrid.parentElement.insertBefore(wrap, stemsGrid);

  wrap.querySelectorAll('.viz-toggle__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const newMode = btn.dataset.mode;
      if (newMode === vizMode) return;
      setVizMode(newMode);
    });
  });
}

function setVizMode(mode) {
  vizMode = mode;
  localStorage.setItem(LS_VIZ_MODE, mode);

  // Update toggle buttons
  $$('.viz-toggle__btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Toggle canvas visibility
  $$('.viz-canvas--spectro').forEach((c) => {
    c.style.display = mode === 'spectrogram' ? 'block' : 'none';
  });
  $$('.viz-canvas--waveform').forEach((c) => {
    c.style.display = mode === 'waveform' ? 'block' : 'none';
  });

  // Also toggle combined
  const combinedSpectroCanvas = $('#canvas-combined');
  const combinedWfCanvas = $('#canvas-combined-wf');
  const combinedLabel = document.querySelector('.combined-spectrogram__label');

  if (combinedSpectroCanvas) combinedSpectroCanvas.style.display = mode === 'spectrogram' ? 'block' : 'none';
  if (combinedWfCanvas) combinedWfCanvas.style.display = mode === 'waveform' ? 'block' : 'none';
  if (combinedLabel) combinedLabel.textContent = mode === 'spectrogram' ? 'Combined Spectrogram — All Active Stems' : 'Combined Waveform — All Active Stems';

  // Start/stop the appropriate renderers
  if (engine.isPlaying) {
    stopAllViz();
    startActiveViz();
  } else {
    // Just update renders for static display
    if (mode === 'waveform') {
      waveforms.forEach((w) => { w.stop(); }); // re-draw static
      if (combinedWaveform) combinedWaveform.stop();
    }
  }
}

function startActiveViz() {
  if (vizMode === 'spectrogram') {
    spectrograms.forEach((r) => r.start());
    if (combinedSpectrogram) combinedSpectrogram.start();
  } else {
    waveforms.forEach((w) => w.start());
    if (combinedWaveform) combinedWaveform.start();
  }
}

function stopAllViz() {
  spectrograms.forEach((r) => r.stop());
  if (combinedSpectrogram) combinedSpectrogram.stop();
  waveforms.forEach((w) => w.stop());
  if (combinedWaveform) combinedWaveform.stop();
}

/* ---------- DJ Scrub from Waveform ---------- */
function handleWaveformSeek(timeSeconds) {
  engine.seek(timeSeconds);
  const seekBar = $('#seek-bar');
  seekBar.value = Math.floor(timeSeconds * 100);
  updateTimeDisplay(timeSeconds, engine.duration);
  if (!engine.isPlaying) stopAllViz();
}

/* ---------- Synchronized Zoom ---------- */
function handleWaveformZoom(zoom, scrollOffset) {
  // Apply the same zoom/scroll to ALL renderers
  waveforms.forEach((w) => w.setZoom(zoom, scrollOffset));
  if (combinedWaveform) combinedWaveform.setZoom(zoom, scrollOffset);
  
  spectrograms.forEach((r) => r.setZoom(zoom, scrollOffset));
  if (combinedSpectrogram) combinedSpectrogram.setZoom(zoom, scrollOffset);
}

/* ---------- Initialize ---------- */
async function init() {
  loadPersistedData();
  buildStemCards();
  buildAdminUI();
  bindTransportEvents();
  bindStemEvents();
  bindFullscreenEvents();

  const overlay = $('#loading-overlay');
  const progressBar = $('#loading-progress-bar');
  const loadingText = $('#loading-text');

  try {
    loadingText.textContent = 'Loading audio stems...';

    await engine.init(STEM_CONFIG, (progress) => {
      progressBar.style.width = `${Math.round(progress * 100)}%`;
      loadingText.textContent = `Loading stems... ${Math.round(progress * 100)}%`;
    });

    // Initialize spectrograms
    loadingText.textContent = 'Generating spectrograms (this may take a moment)...';
    const spectroInitPromises = [];

    STEM_CONFIG.forEach((cfg) => {
      const canvas = $(`#canvas-${cfg.id}`);
      const buffer = engine.getBuffer(cfg.id);
      if (canvas && buffer) {
        const renderer = new SpectrogramRenderer(canvas, buffer, {
          color: cfg.color,
          minDb: spectrogramSettings.minDb,
          maxDb: spectrogramSettings.maxDb,
          isCombined: false,
          onSeek: handleWaveformSeek,
          onZoom: handleWaveformZoom,
          getPlaybackTime: () => engine.getCurrentTime(),
          getDuration: () => engine.duration,
        });
        spectrograms.set(cfg.id, renderer);
        spectroInitPromises.push(renderer.init());
      }
    });

    // Combined spectrogram
    const combinedCanvas = $('#canvas-combined');
    const combinedBuffer = engine.getMixedBuffer();
    if (combinedCanvas && combinedBuffer) {
      combinedSpectrogram = new SpectrogramRenderer(combinedCanvas, combinedBuffer, {
        minDb: spectrogramSettings.combinedMinDb,
        maxDb: spectrogramSettings.combinedMaxDb,
        isCombined: true,
        onSeek: handleWaveformSeek,
        onZoom: handleWaveformZoom,
        getPlaybackTime: () => engine.getCurrentTime(),
        getDuration: () => engine.duration,
      });
      spectroInitPromises.push(combinedSpectrogram.init());
    }

    await Promise.all(spectroInitPromises);

    // Initialize waveform renderers
    STEM_CONFIG.forEach((cfg) => {
      const canvas = $(`#canvas-wf-${cfg.id}`);
      const buffer = engine.getBuffer(cfg.id);
      if (canvas && buffer) {
        const renderer = new WaveformRenderer(canvas, buffer, {
          color: cfg.color,
          onSeek: handleWaveformSeek,
          onZoom: handleWaveformZoom,
          getPlaybackTime: () => engine.getCurrentTime(),
          getDuration: () => engine.duration,
        });
        waveforms.set(cfg.id, renderer);
      }
    });

    // Combined waveform — mix all stem buffers together
    const combinedWfCanvas = $('#canvas-combined-wf');
    const mixedBuffer = engine.getMixedBuffer();
    if (combinedWfCanvas && mixedBuffer) {
      combinedWaveform = new WaveformRenderer(combinedWfCanvas, mixedBuffer, {
        color: '#9b6dff',
        onSeek: handleWaveformSeek,
        onZoom: handleWaveformZoom,
        getPlaybackTime: () => engine.getCurrentTime(),
        getDuration: () => engine.duration,
        isCombined: true,
      });
    }

    // Build viz toggle and set initial mode
    buildVizToggle();
    setVizMode(vizMode);

    // Set total duration
    updateTimeDisplay(0, engine.duration);
    $('#seek-bar').max = Math.floor(engine.duration * 100);

    // Check for seek parameter in URL
    const params = new URLSearchParams(window.location.search);
    const seekTime = parseFloat(params.get('t'));
    if (!isNaN(seekTime) && seekTime >= 0 && seekTime <= engine.duration) {
      engine.seek(seekTime);
      $('#seek-bar').value = Math.floor(seekTime * 100);
      updateTimeDisplay(seekTime, engine.duration);
      // Auto-play
      const isPlaying = engine.togglePlayPause();
      updatePlayButton(isPlaying);
      if (isPlaying) {
        startActiveViz();
        startSeekUpdate();
      }
    }

    // Render markers on seek bar
    renderMarkersOnSeekBar();

    // Engine ended callback
    engine.onEndedCallback = () => onPlaybackEnded();

    // Hide loading overlay
    overlay.classList.add('hidden');
  } catch (err) {
    console.error('Failed to initialize:', err);
    loadingText.textContent = `Error loading audio: ${err.message}. Make sure audio files exist in the audio/ folder.`;
    progressBar.style.background = '#f0766b';
  }
}

/* ---------- Transport Controls ---------- */
function bindTransportEvents() {
  $('#btn-play').addEventListener('click', () => {
    const isPlaying = engine.togglePlayPause();
    updatePlayButton(isPlaying);
    if (isPlaying) {
      startActiveViz();
      startSeekUpdate();
    } else {
      stopAllViz();
      stopSeekUpdate();
    }
  });

  const seekBar = $('#seek-bar');
  seekBar.addEventListener('input', () => {
    const time = parseFloat(seekBar.value) / 100;
    engine.seek(time);
    updateTimeDisplay(time, engine.duration);
    if (!engine.isPlaying) stopAllViz();
  });

  $('#master-volume').addEventListener('input', (e) => {
    engine.setMasterVolume(parseFloat(e.target.value) / 100);
  });

  $('#btn-all-on').addEventListener('click', () => {
    engine.allOn();
    refreshAllStemUI();
  });

  $('#btn-all-off').addEventListener('click', () => {
    engine.allOff();
    refreshAllStemUI();
  });
}

/* ---------- Stem Controls ---------- */
function bindStemEvents() {
  document.addEventListener('click', (e) => {
    const muteBtn = e.target.closest('.btn-mute');
    if (muteBtn) {
      const stemId = muteBtn.dataset.stem;
      const isMuted = engine.toggleMute(stemId);
      muteBtn.classList.toggle('active', isMuted);
      updateStemCardState(stemId);
      updateWaveformMuteStates();
    }

    const soloBtn = e.target.closest('.btn-solo');
    if (soloBtn) {
      const stemId = soloBtn.dataset.stem;
      const isSoloed = engine.toggleSolo(stemId);
      soloBtn.classList.toggle('active', isSoloed);
      refreshAllStemUI();
      updateWaveformMuteStates();
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.classList.contains('volume-slider')) {
      const stemId = e.target.dataset.stem;
      const value = parseFloat(e.target.value) / 100;
      engine.setVolume(stemId, value);
      const display = document.querySelector(`.volume-value[data-stem="${stemId}"]`);
      if (display) display.textContent = `${Math.round(value * 100)}%`;
    }
  });
}

/* ---------- UI Helpers ---------- */
function updatePlayButton(isPlaying) {
  const btn = $('#btn-play');
  btn.classList.toggle('playing', isPlaying);
  btn.innerHTML = isPlaying
    ? `<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor"/><rect x="14" y="4" width="4" height="16" fill="currentColor"/></svg>`
    : `<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20" fill="currentColor"/></svg>`;
}

function updateTimeDisplay(current, total) {
  $('#time-current').textContent = formatTime(current);
  $('#time-total').textContent = formatTime(total);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateStemCardState(stemId) {
  const state = engine.getStemState(stemId);
  if (!state) return;
  const card = $(`#stem-${stemId}`);
  if (!card) return;
  card.classList.toggle('muted', state.muted);
  card.classList.toggle('soloed', state.soloed);
}

function refreshAllStemUI() {
  STEM_CONFIG.forEach((cfg) => {
    const state = engine.getStemState(cfg.id);
    if (!state) return;
    const card = $(`#stem-${cfg.id}`);
    if (!card) return;
    card.classList.toggle('muted', state.muted);
    card.classList.toggle('soloed', state.soloed);
    const muteBtn = card.querySelector('.btn-mute');
    const soloBtn = card.querySelector('.btn-solo');
    if (muteBtn) muteBtn.classList.toggle('active', state.muted);
    if (soloBtn) soloBtn.classList.toggle('active', state.soloed);
  });
  updateWaveformMuteStates();
}

/* ---------- Waveform Mute State Sync ---------- */
function updateWaveformMuteStates() {
  // Check if any stem is soloed
  let anySoloed = false;
  STEM_CONFIG.forEach((cfg) => {
    const state = engine.getStemState(cfg.id);
    if (state && state.soloed) anySoloed = true;
  });

  STEM_CONFIG.forEach((cfg) => {
    const wf = waveforms.get(cfg.id);
    if (!wf) return;
    const state = engine.getStemState(cfg.id);
    if (!state) return;

    // A stem is effectively muted if:
    // - It's explicitly muted, OR
    // - Some other stem is soloed and this one isn't
    const effectivelyMuted = state.muted || (anySoloed && !state.soloed);
    wf.setMuted(effectivelyMuted);
  });
}

/* ---------- Spectrograms (kept for rebuild compatibility) ---------- */
function startSpectrograms() {
  startActiveViz();
}

function stopSpectrograms() {
  stopAllViz();
}

/* ---------- Seek Bar Animation ---------- */
function startSeekUpdate() {
  const seekBar = $('#seek-bar');
  const update = () => {
    if (!engine.isPlaying) return;
    const currentTime = engine.getCurrentTime();
    seekBar.value = Math.floor(currentTime * 100);
    updateTimeDisplay(currentTime, engine.duration);
    seekAnimFrame = requestAnimationFrame(update);
  };
  seekAnimFrame = requestAnimationFrame(update);
}

function stopSeekUpdate() {
  if (seekAnimFrame) {
    cancelAnimationFrame(seekAnimFrame);
    seekAnimFrame = null;
  }
}

function onPlaybackEnded() {
  updatePlayButton(false);
  stopAllViz();
  stopSeekUpdate();
  $('#seek-bar').value = 0;
  updateTimeDisplay(0, engine.duration);
  spectrograms.forEach((r) => r.clear());
  if (combinedSpectrogram) combinedSpectrogram.clear();
  waveforms.forEach((w) => w.clear());
  if (combinedWaveform) combinedWaveform.clear();
}

/* ---------- Keyboard Shortcuts ---------- */
document.addEventListener('keydown', (e) => {
  // Skip shortcuts when user is typing in an input or editing essay content
  const isEditing = e.target.tagName === 'INPUT' || e.target.isContentEditable;
  if (isEditing) return;

  if (e.code === 'Space') {
    e.preventDefault();
    $('#btn-play').click();
  }
  const num = parseInt(e.key);
  if (num >= 1 && num <= STEM_CONFIG.length) {
    e.preventDefault();
    const stemId = STEM_CONFIG[num - 1].id;
    const muteBtn = document.querySelector(`.btn-mute[data-stem="${stemId}"]`);
    if (muteBtn) muteBtn.click();
  }
});

/* ---------- Fullscreen Modals ---------- */
function resizeAllRenderers() {
  const t = engine.getCurrentTime();
  const d = engine.duration;
  const progress = d > 0 ? t / d : 0;
  spectrograms.forEach(r => { r._resize(); r._drawStatic(progress); });
  if (combinedSpectrogram) { combinedSpectrogram._resize(); combinedSpectrogram._drawStatic(progress); }
  waveforms.forEach(w => { w._resize(); w._drawStatic(progress); });
  if (combinedWaveform) { combinedWaveform._resize(); combinedWaveform._drawStatic(progress); }
}

function bindFullscreenEvents() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-expand');
    if (!btn) return;

    let target = btn.closest('.stem-track');
    if (!target) {
      target = btn.closest('.combined-spectrogram');
    }

    if (target) {
      const isFullscreen = target.classList.contains('is-fullscreen');

      // Remove fullscreen from all others first
      document.querySelectorAll('.is-fullscreen').forEach(el => {
        el.classList.remove('is-fullscreen');
        const svg = el.querySelector('.btn-expand svg');
        if (svg) svg.innerHTML = '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>';
      });

      if (!isFullscreen) {
        target.classList.add('is-fullscreen');
        btn.querySelector('svg').innerHTML = '<path d="M8 3v3h3M21 8h-3V5M3 16h3v3M16 21v-3h3M14 10l7-7M3 21l7-7M10 14l-7 7M21 3l-7 7"></path>';
        document.body.style.overflow = 'hidden';
      } else {
        target.classList.remove('is-fullscreen');
        btn.querySelector('svg').innerHTML = '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>';
        document.body.style.overflow = '';
      }

      // Let the browser finish layout, then resize & redraw canvases
      requestAnimationFrame(() => requestAnimationFrame(resizeAllRenderers));
    }
  });
}

/* ---------- Analysis Timestamp Click-to-Seek ---------- */
document.addEventListener('click', (e) => {
  const ts = e.target.closest('.analysis-timestamp');
  if (!ts) return;
  e.preventDefault();
  const time = parseFloat(ts.dataset.time);
  if (isNaN(time)) return;

  engine.seek(time);
  const seekBar = $('#seek-bar');
  seekBar.value = Math.floor(time * 100);
  updateTimeDisplay(time, engine.duration);

  // Auto-play if not already playing
  if (!engine.isPlaying) {
    const isPlaying = engine.togglePlayPause();
    updatePlayButton(isPlaying);
    if (isPlaying) {
      startActiveViz();
      startSeekUpdate();
    }
  }

  // Scroll to the combined spectrogram so user can see/hear the result
  const combined = $('#combined-section');
  if (combined) {
    combined.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

/* ---------- Start ---------- */
document.addEventListener('DOMContentLoaded', () => {
  init();
});
