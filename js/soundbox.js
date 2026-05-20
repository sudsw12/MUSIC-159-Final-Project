import { AudioEngine } from './audio-engine.js';
import { analyzeStemBuffer, mapFrameToSoundboxPosition } from './soundbox-analyzer.js';
import { DEPTH_PROFILES, SECTION_MARKERS, STEMS, getStemById } from './soundbox-data.js';
import { SoundboxScene } from './soundbox-scene.js';
import {
  createVisibilityState,
  isolateStem,
  setStemVisible,
  showAllStems,
} from './soundbox-visibility.js';

const $ = (selector) => document.querySelector(selector);

const engine = new AudioEngine();
let scene = null;
let ready = false;
let selectedStemId = 'vocals';
let isDraggingTimeline = false;
let currentTime = 0;
const visibility = createVisibilityState(STEMS);

function formatTime(seconds) {
  const safeSeconds = Math.max(0, seconds || 0);
  const minutes = Math.floor(safeSeconds / 60);
  const secs = Math.floor(safeSeconds % 60);
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function setLoading(message, progress = null) {
  const text = $('#soundbox-loading-text');
  const bar = $('#soundbox-loading-bar');
  if (text) text.textContent = message;
  if (bar && progress !== null) bar.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
}

function hideLoading() {
  const overlay = $('#soundbox-loading');
  if (overlay) overlay.classList.add('hidden');
}

function showFatalError(message) {
  const overlay = $('#soundbox-loading');
  const text = $('#soundbox-loading-text');
  const hint = $('#soundbox-loading-hint');
  if (overlay) overlay.classList.remove('hidden');
  if (text) text.textContent = message;
  if (hint) hint.textContent = 'Try refreshing the page from a local server. The 3D view also needs WebGL and the pinned Three.js CDN module.';
}

function buildStemControls() {
  const list = $('#soundbox-stems');
  if (!list) return;
  list.innerHTML = `
    <div class="soundbox-stems__actions">
      <button class="soundbox-mini-button" type="button" data-stems-all>All</button>
    </div>
  `;

  STEMS.forEach((stem) => {
    const row = document.createElement('div');
    row.className = `soundbox-stem ${stem.id === selectedStemId ? 'active' : ''}`;
    row.dataset.stem = stem.id;
    row.style.setProperty('--stem-color', stem.color);
    row.innerHTML = `
      <label class="soundbox-stem__visibility">
        <input type="checkbox" checked data-stem-visible="${stem.id}">
        <span class="soundbox-stem__dot"></span>
        <span>${stem.name}</span>
      </label>
      <div class="soundbox-stem__actions">
        <button class="soundbox-stem__focus" type="button" data-stem-isolate="${stem.id}">Isolate</button>
        <button class="soundbox-stem__focus" type="button" data-stem-focus="${stem.id}">Focus</button>
      </div>
    `;
    list.appendChild(row);
  });

  list.addEventListener('change', (event) => {
    const input = event.target.closest('[data-stem-visible]');
    if (!input) return;
    setStemVisible(visibility, input.dataset.stemVisible, input.checked);
    renderAt(currentTime);
  });

  list.addEventListener('click', (event) => {
    const allButton = event.target.closest('[data-stems-all]');
    const isolateButton = event.target.closest('[data-stem-isolate]');
    const focusButton = event.target.closest('[data-stem-focus]');
    const stemRow = event.target.closest('.soundbox-stem');
    if (allButton) {
      showAllStems(visibility, STEMS);
      syncVisibilityControls();
      renderAt(currentTime);
      return;
    }
    if (isolateButton) {
      const stemId = isolateButton.dataset.stemIsolate;
      isolateStem(visibility, STEMS, stemId);
      syncVisibilityControls();
      selectStem(stemId);
      renderAt(currentTime);
      return;
    }
    if (focusButton) {
      selectStem(focusButton.dataset.stemFocus);
      scene.focusStem(selectedStemId);
      return;
    }
    if (stemRow) selectStem(stemRow.dataset.stem);
  });
}

function syncVisibilityControls() {
  document.querySelectorAll('[data-stem-visible]').forEach((input) => {
    input.checked = visibility[input.dataset.stemVisible] !== false;
  });
}

function buildMarkers() {
  const markerWrap = $('#soundbox-markers');
  if (!markerWrap) return;
  markerWrap.innerHTML = '';
  SECTION_MARKERS.forEach((marker) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'soundbox-marker';
    button.textContent = marker.label;
    button.dataset.label = marker.label;
    button.dataset.markerTime = marker.time;
    button.style.left = `${(marker.time / 292.44) * 100}%`;
    markerWrap.appendChild(button);
  });

  markerWrap.addEventListener('click', (event) => {
    const marker = event.target.closest('[data-marker-time]');
    if (!marker || !ready) return;
    seekTo(parseFloat(marker.dataset.markerTime));
  });
}

function setPlayButtonState(isPlaying) {
  const playButton = $('#soundbox-play');
  if (!playButton) return;
  playButton.classList.toggle('is-playing', isPlaying);
  playButton.innerHTML = isPlaying
    ? '<span class="soundbox-play__icon">Ⅱ</span><span>Pause</span>'
    : '<span class="soundbox-play__icon">▶</span><span>Play</span>';
}

function updateTimeline(time) {
  const duration = engine.duration || 1;
  const progress = Math.max(0, Math.min(1, time / duration));
  if (!isDraggingTimeline) {
    const slider = $('#soundbox-timeline');
    if (slider) slider.value = String(Math.round(progress * 10000));
  }
  const current = $('#soundbox-time-current');
  const total = $('#soundbox-time-total');
  const progressFill = $('#soundbox-timeline-fill');
  if (current) current.textContent = formatTime(time);
  if (total) total.textContent = formatTime(duration);
  if (progressFill) progressFill.style.width = `${progress * 100}%`;
}

function updateInspector() {
  if (!scene) return;
  const stem = getStemById(selectedStemId);
  const frame = scene.getCurrentFrame(selectedStemId);
  const profile = DEPTH_PROFILES[selectedStemId];
  if (!stem || !frame || !profile) return;
  const mapped = mapFrameToSoundboxPosition(frame, profile);

  const title = $('#inspector-title');
  const zone = $('#inspector-zone');
  const note = $('#inspector-note');
  if (title) {
    title.textContent = stem.name;
    title.style.color = stem.color;
  }
  if (zone) zone.textContent = profile.zone;
  if (note) note.textContent = profile.note;

  const values = {
    pan: mapped.isActive ? `${frame.pan >= 0 ? '+' : ''}${frame.pan.toFixed(2)}` : 'Inactive',
    register: mapped.isActive ? `${Math.round(frame.registerHz)} Hz` : 'Inactive',
    depth: mapped.z.toFixed(2),
    energy: `${Math.round(frame.energyNorm * 100)}%`,
  };

  Object.entries(values).forEach(([key, value]) => {
    const target = $(`[data-inspector-value="${key}"]`);
    if (target) target.textContent = value;
  });
}

function selectStem(stemId) {
  selectedStemId = stemId;
  if (scene) scene.selectStem(stemId);
  document.querySelectorAll('.soundbox-stem').forEach((row) => {
    row.classList.toggle('active', row.dataset.stem === stemId);
  });
  updateInspector();
}

function renderAt(time) {
  currentTime = Math.max(0, Math.min(time, engine.duration || time));
  if (scene) {
    scene.update(currentTime, visibility);
    scene.render();
  }
  updateTimeline(currentTime);
  updateInspector();
}

function seekTo(time) {
  if (!ready) return;
  engine.seek(Math.max(0, Math.min(time, engine.duration)));
  renderAt(engine.getCurrentTime());
}

function bindControls() {
  $('#soundbox-play')?.addEventListener('click', () => {
    if (!ready) return;
    const isPlaying = engine.togglePlayPause();
    setPlayButtonState(isPlaying);
  });

  $('#soundbox-reset-camera')?.addEventListener('click', () => scene?.resetCamera());
  $('#soundbox-focus-selected')?.addEventListener('click', () => scene?.focusStem(selectedStemId));
  $('#soundbox-trails')?.addEventListener('change', (event) => {
    scene?.setTrailsVisible(event.target.checked);
    renderAt(currentTime);
  });

  const slider = $('#soundbox-timeline');
  slider?.addEventListener('pointerdown', () => {
    isDraggingTimeline = true;
  });
  slider?.addEventListener('pointerup', () => {
    isDraggingTimeline = false;
    seekTo((parseFloat(slider.value) / 10000) * engine.duration);
  });
  slider?.addEventListener('input', () => {
    const previewTime = (parseFloat(slider.value) / 10000) * engine.duration;
    renderAt(previewTime);
  });
  slider?.addEventListener('change', () => {
    isDraggingTimeline = false;
    seekTo((parseFloat(slider.value) / 10000) * engine.duration);
  });

  $('#soundbox-volume')?.addEventListener('input', (event) => {
    engine.setMasterVolume(parseFloat(event.target.value));
  });

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.target.matches('input, button, textarea, select')) return;
    event.preventDefault();
    $('#soundbox-play')?.click();
  });
}

function animationLoop() {
  if (ready && engine.isPlaying) {
    renderAt(engine.getCurrentTime());
  } else if (scene) {
    scene.render();
  }
  requestAnimationFrame(animationLoop);
}

async function buildAnalyses() {
  const analyses = {};
  const total = STEMS.length;

  for (let i = 0; i < STEMS.length; i++) {
    const stem = STEMS[i];
    setLoading(`Mapping ${stem.name} through the soundbox...`, 0.55 + (i / total) * 0.35);
    const buffer = engine.getBuffer(stem.id);
    const frames = analyzeStemBuffer(buffer, { intervalSeconds: 0.5, windowSeconds: 0.24 });
    const positions = frames.map((frame) => mapFrameToSoundboxPosition(frame, DEPTH_PROFILES[stem.id]));
    analyses[stem.id] = { frames, positions };
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return analyses;
}

async function init() {
  try {
    buildStemControls();
    buildMarkers();
    bindControls();

    setLoading('Starting 3D soundbox...', 0.05);
    scene = new SoundboxScene({
      container: $('#soundbox-canvas-wrap'),
      onSelect: selectStem,
    });
    scene.init();

    setLoading('Loading synchronized stems...', 0.12);
    await engine.init(STEMS, (progress) => {
      setLoading(`Loading stems... ${Math.round(progress * 100)}%`, 0.12 + progress * 0.38);
    });
    engine.setMasterVolume(parseFloat($('#soundbox-volume')?.value || '0.82'));
    engine.onEndedCallback = () => {
      setPlayButtonState(false);
      renderAt(0);
    };

    const analyses = await buildAnalyses();
    scene.setAnalyses(analyses);
    scene.selectStem(selectedStemId);

    ready = true;
    $('#soundbox-play')?.removeAttribute('disabled');
    setLoading('Rendering soundbox...', 1);
    renderAt(0);
    hideLoading();
    animationLoop();
  } catch (error) {
    console.error(error);
    showFatalError(`Could not start the soundbox: ${error.message}`);
  }
}

init();
