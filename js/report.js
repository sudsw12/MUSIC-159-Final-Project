import { AudioEngine } from './audio-engine.js';
import { SpectrogramRenderer } from './spectrogram.js';
import { WaveformRenderer } from './waveform.js';

const ALL_STEMS = {
  vocals: { id: 'vocals', name: 'Vocals',  url: 'audio/vocals.mp3', color: '#f0766b' },
  hihat:  { id: 'hihat',  name: 'Hi-Hat',  url: 'audio/hihat.mp3',  color: '#e05e8a' },
  bass:   { id: 'bass',   name: 'Bass',    url: 'audio/bass.mp3',   color: '#9b6dff' },
  melody: { id: 'melody', name: 'Melody',  url: 'audio/melody.mp3', color: '#5b87f5' },
  kick:   { id: 'kick',   name: 'Kick',    url: 'audio/kick.mp3',   color: '#4fd1d9' },
};

/* ---------- LocalStorage Key ---------- */
const LS_ESSAY = 'cc_essay_content';

/* ---------- Edit Mode State ---------- */
let editMode = false;
let saveTimeout = null;

/* ---------- DOM Helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ---------- Essay Edit Mode ---------- */
function initEditMode() {
  const btn = $('#btn-edit-mode');
  if (!btn) return;

  // Load any saved edits on startup
  loadEssayEdits();

  btn.addEventListener('click', () => {
    editMode = !editMode;
    toggleEditMode(editMode);
  });
}

function toggleEditMode(on) {
  const bodies = $$('.report-section__body');
  const btn = $('#btn-edit-mode');
  const btnLabel = btn ? btn.querySelector('span') : null;

  document.body.classList.toggle('edit-mode', on);

  bodies.forEach((body) => {
    body.contentEditable = on ? 'true' : 'false';
  });

  // Also make headings and subheadings editable
  $$('.report-section__heading, .report-section__subheading').forEach((el) => {
    el.contentEditable = on ? 'true' : 'false';
  });

  if (btnLabel) btnLabel.textContent = on ? 'Editing ✓' : 'Edit Report';
  if (btn) btn.classList.toggle('active', on);

  if (on) {
    // Listen for input to auto-save
    document.addEventListener('input', handleEssayInput);
    showToast('Edit mode ON — click any text to edit. Changes auto-save locally.');
  } else {
    document.removeEventListener('input', handleEssayInput);
    saveEssayEdits();
    
    // Ask if they want to publish
    setTimeout(() => {
      const pwd = prompt("Changes saved to your browser! To publish them permanently to the live website (GitHub), enter your secret edit password. Or click Cancel to just keep them locally.");
      if (pwd) {
        publishToGitHub(pwd);
      } else {
        showToast('Edit mode OFF — changes saved locally only.');
      }
    }, 100);
  }
}

async function publishToGitHub(password) {
  showToast('Publishing to GitHub... please wait.', 10000); // 10s toast
  
  try {
    // Clean up DOM before saving
    const existingToast = document.getElementById('edit-toast');
    if (existingToast) existingToast.remove();
    
    // Get the full HTML
    const htmlContent = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
    
    const res = await fetch('/.netlify/functions/save-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: password,
        content: htmlContent
      })
    });
    
    if (res.ok) {
      showToast('🎉 Successfully published to GitHub! The live site will update in ~1 minute.');
    } else {
      const err = await res.text();
      showToast('Failed to publish: ' + err);
    }
  } catch(e) {
    showToast('Error: ' + e.message);
  }
}

function handleEssayInput(e) {
  const target = e.target;
  if (!target.closest('.report-section')) return;

  // Debounced auto-save
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveEssayEdits();
  }, 1000);
}

function saveEssayEdits() {
  const sections = $$('.report-section');
  const data = {};
  sections.forEach((section) => {
    const id = section.id;
    if (!id) return;
    // Save heading
    const heading = section.querySelector('.report-section__heading');
    if (heading) data[id + '__heading'] = heading.innerHTML;
    // Save subheadings
    section.querySelectorAll('.report-section__subheading').forEach((sh, i) => {
      data[id + '__sub_' + i] = sh.innerHTML;
    });
    // Save body
    const body = section.querySelector('.report-section__body');
    if (body) data[id + '__body'] = body.innerHTML;
  });
  localStorage.setItem(LS_ESSAY, JSON.stringify(data));
}

function loadEssayEdits() {
  try {
    const raw = localStorage.getItem(LS_ESSAY);
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.entries(data).forEach(([key, html]) => {
      // Parse key: sectionId__part
      const parts = key.split('__');
      const sectionId = parts[0];
      const part = parts.slice(1).join('__');
      const section = $(`#${sectionId}`);
      if (!section) return;

      if (part === 'heading') {
        const heading = section.querySelector('.report-section__heading');
        if (heading) heading.innerHTML = html;
      } else if (part === 'body') {
        const body = section.querySelector('.report-section__body');
        if (body) body.innerHTML = html;
      } else if (part.startsWith('sub_')) {
        const idx = parseInt(part.split('_')[1]);
        const subs = section.querySelectorAll('.report-section__subheading');
        if (subs[idx]) subs[idx].innerHTML = html;
      }
    });
  } catch (e) {
    console.warn('Failed to load essay edits:', e);
  }
}

function showToast(message, duration = 2500) {
  // Remove existing toast
  const existing = $('#edit-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'edit-toast';
  toast.id = 'edit-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('visible');
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 400);
    }, duration);
  });
}

/* ---------- Handle Timestamps ---------- */
// In report.html, clicking a timestamp should probably go back to index.html with a query param,
// or we can just leave it as text. Let's make it link back to the player with a time param.
document.addEventListener('click', (e) => {
  const ts = e.target.closest('.analysis-timestamp');
  if (!ts) return;
  e.preventDefault();
  
  if (editMode) return; // Don't navigate while editing

  const timeStr = ts.textContent.replace('▶', '').trim();
  const parts = timeStr.split(':');
  let seconds = 0;
  if (parts.length === 2) {
    seconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  } else {
    seconds = parseInt(timeStr);
  }
  
  if (!isNaN(seconds)) {
    window.location.href = `index.html?t=${seconds}`;
  }
});

/* ---------- Snippet Editor Toolbar & Modal ---------- */
let currentSelectionRange = null;
const creatorEngine = new AudioEngine();
let creatorWaveform = null;
let creatorLoopFrame = null;

function initSnippetEditor() {
  const toolbar = document.createElement('div');
  toolbar.className = 'snippet-edit-toolbar hidden';
  toolbar.id = 'snippet-edit-toolbar';
  toolbar.innerHTML = `<button id="btn-open-creator">🔗 Add Audio Snippet</button>`;
  
  // Prevent mousedown from clearing the selection
  toolbar.addEventListener('mousedown', (e) => e.preventDefault());
  document.body.appendChild(toolbar);

  document.addEventListener('mouseup', (e) => {
    if (!editMode) return;
    if (e.target.closest('#snippet-edit-toolbar') || e.target.closest('#snippet-creator-modal')) return;
    
    const sel = window.getSelection();
    if (sel.isCollapsed) {
      toolbar.classList.add('hidden');
      return;
    }
    
    const node = sel.anchorNode;
    if (node && node.parentElement && node.parentElement.closest('.report-section__body')) {
      currentSelectionRange = sel.getRangeAt(0);
      const rect = currentSelectionRange.getBoundingClientRect();
      toolbar.style.left = `${rect.left + rect.width/2}px`;
      toolbar.style.top = `${rect.top + window.scrollY}px`;
      toolbar.classList.remove('hidden');
    } else {
      toolbar.classList.add('hidden');
    }
  });

  document.getElementById('btn-open-creator').addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentSelectionRange) return;
    toolbar.classList.add('hidden');
    openSnippetCreator();
  });

  buildSnippetCreatorModal();
}

function buildSnippetCreatorModal() {
  const modal = document.createElement('div');
  modal.className = 'snippet-player-modal expanded hidden';
  modal.id = 'snippet-creator-modal';
  modal.style.zIndex = '1000';
  modal.innerHTML = `
    <div class="sp-header">
      <span class="sp-title">Create Audio Snippet</span>
      <div class="sp-actions">
        <button class="sp-btn" id="sc-btn-close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </div>
    <div style="padding: 16px;">
      <div style="margin-bottom: 12px; display: flex; gap: 12px; font-family: 'Inter', sans-serif; font-size: 0.85rem; color: var(--text-primary);">
         <label><input type="checkbox" class="sc-stem-cb" value="vocals" checked> Vocals</label>
         <label><input type="checkbox" class="sc-stem-cb" value="hihat"> Hi-Hat</label>
         <label><input type="checkbox" class="sc-stem-cb" value="bass"> Bass</label>
         <label><input type="checkbox" class="sc-stem-cb" value="melody"> Melody</label>
         <label><input type="checkbox" class="sc-stem-cb" value="kick"> Kick</label>
      </div>
      <div class="sp-canvas-wrap">
        <canvas id="sc-canvas"></canvas>
        <div id="sc-loading" class="sp-loading hidden">Loading audio...</div>
      </div>
      <div class="sp-controls" style="padding: 12px 0;">
        <button class="sp-play-btn" id="sc-btn-play">
          <svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"></polygon></svg>
        </button>
        <div class="sp-progress">
          <span class="sp-time" id="sc-time-current">0.0s</span>
          <div class="sp-bar-wrap" id="sc-bar-wrap">
            <div class="sp-bar-fill" id="sc-bar-fill"></div>
          </div>
          <span class="sp-time" id="sc-time-end">0.0s</span>
        </div>
      </div>
      <div style="display: flex; gap: 16px; align-items: center; margin-top: 8px; font-family: 'Inter', sans-serif; font-size: 0.85rem; color: var(--text-primary);">
        <div>Start: <input type="number" id="sc-start" value="0.0" step="0.1" style="width: 60px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-subtle); color: #fff; border-radius: 4px; padding: 2px 4px;" /> <button id="sc-set-start" style="background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:4px; padding: 2px 6px; cursor: pointer;">Set to Playhead</button></div>
        <div>End: <input type="number" id="sc-end" value="5.0" step="0.1" style="width: 60px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-subtle); color: #fff; border-radius: 4px; padding: 2px 4px;" /> <button id="sc-set-end" style="background:var(--bg-card); color:var(--text-primary); border:1px solid var(--border-subtle); border-radius:4px; padding: 2px 6px; cursor: pointer;">Set to Playhead</button></div>
      </div>
      <div style="margin-top: 16px; text-align: right;">
         <button id="sc-btn-save" style="background: var(--accent-coral); padding: 8px 16px; border: none; color: white; border-radius: 4px; cursor: pointer; font-weight: 600; font-family: 'Space Grotesk', sans-serif;">Insert Snippet</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Close Creator
  document.getElementById('sc-btn-close').addEventListener('click', closeSnippetCreator);
  
  // Stem checkboxes
  document.querySelectorAll('.sc-stem-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      creatorEngine.setVolume(cb.value, cb.checked ? 1 : 0);
    });
  });

  // Play button
  document.getElementById('sc-btn-play').addEventListener('click', () => {
    const btn = document.getElementById('sc-btn-play');
    if (creatorEngine.isPlaying) {
      creatorEngine.pause();
      btn.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"></polygon></svg>';
    } else {
      creatorEngine.play();
      btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
    }
  });

  // Set to Playhead
  document.getElementById('sc-set-start').addEventListener('click', () => {
    document.getElementById('sc-start').value = creatorEngine.getCurrentTime().toFixed(1);
  });
  document.getElementById('sc-set-end').addEventListener('click', () => {
    document.getElementById('sc-end').value = creatorEngine.getCurrentTime().toFixed(1);
  });

  // Save Snippet
  document.getElementById('sc-btn-save').addEventListener('click', () => {
    if (!currentSelectionRange) return;
    const checked = Array.from(document.querySelectorAll('.sc-stem-cb')).filter(c => c.checked).map(c => c.value);
    const stems = checked.length ? checked.join(',') : 'vocals';
    const start = document.getElementById('sc-start').value || '0';
    const end = document.getElementById('sc-end').value || '5';
    
    const span = document.createElement('span');
    span.className = 'audio-snippet-link';
    span.dataset.stems = stems;
    span.dataset.start = start;
    span.dataset.end = end;
    
    currentSelectionRange.surroundContents(span);
    closeSnippetCreator();
    saveEssayEdits();
    showToast('Snippet link added!');
  });
  
  // Custom scrub bar
  document.getElementById('sc-bar-wrap').addEventListener('mousedown', (e) => {
    const rect = e.target.closest('#sc-bar-wrap').getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    creatorEngine.seek(pct * creatorEngine.duration);
  });
}

async function openSnippetCreator() {
  document.getElementById('snippet-creator-modal').classList.remove('hidden');
  
  // If not loaded yet
  if (!creatorEngine.duration) {
    document.getElementById('sc-loading').classList.remove('hidden');
    const stemConfigsToLoad = Object.values(ALL_STEMS);
    await creatorEngine.init(stemConfigsToLoad);
    document.getElementById('sc-loading').classList.add('hidden');
    
    const canvas = document.getElementById('sc-canvas');
    const buffer = creatorEngine.getMixedBuffer();
    creatorWaveform = new WaveformRenderer(canvas, buffer, {
      color: '#9b6dff',
      getPlaybackTime: () => creatorEngine.getCurrentTime(),
      getDuration: () => creatorEngine.duration,
      onSeek: (t) => creatorEngine.seek(t)
    });
    
    document.getElementById('sc-time-end').textContent = `${creatorEngine.duration.toFixed(1)}s`;
  }
  
  // Sync checkboxes
  document.querySelectorAll('.sc-stem-cb').forEach(cb => {
    creatorEngine.setVolume(cb.value, cb.checked ? 1 : 0);
  });
  
  // Start render loop
  const loop = () => {
    if (creatorEngine.duration) {
      const t = creatorEngine.getCurrentTime();
      document.getElementById('sc-time-current').textContent = `${t.toFixed(1)}s`;
      document.getElementById('sc-bar-fill').style.width = `${(t / creatorEngine.duration) * 100}%`;
    }
    creatorLoopFrame = requestAnimationFrame(loop);
  };
  loop();
  
  if (creatorWaveform) creatorWaveform.start();
}

function closeSnippetCreator() {
  creatorEngine.stop();
  document.getElementById('sc-btn-play').innerHTML = '<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"></polygon></svg>';
  if (creatorWaveform) creatorWaveform.stop();
  cancelAnimationFrame(creatorLoopFrame);
  document.getElementById('snippet-creator-modal').classList.add('hidden');
}

/* ---------- Mini Player Modal ---------- */
let snippetEngine = null;
let snippetSpectrogram = null;
let snippetAnimationFrame = null;
let currentSnippet = null; // { start, end }

function initSnippetPlayer() {
  const modal = document.createElement('div');
  modal.className = 'snippet-player-modal hidden';
  modal.id = 'snippet-player-modal';
  modal.innerHTML = `
    <div class="sp-header">
      <span class="sp-title" id="sp-title">Audio Snippet</span>
      <div class="sp-actions">
        <button class="sp-btn" id="sp-btn-expand" title="Expand window">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
        </button>
        <button class="sp-btn" id="sp-btn-close" title="Close player">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </div>
    <div class="sp-canvas-wrap">
      <canvas id="sp-canvas"></canvas>
      <div class="sp-loading" id="sp-loading">Loading audio...</div>
    </div>
    <div class="sp-controls">
      <button class="sp-play-btn" id="sp-btn-play">
        <svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"></polygon></svg>
      </button>
      <div class="sp-progress">
        <span class="sp-time" id="sp-time-current">0.0s</span>
        <div class="sp-bar-wrap" id="sp-bar-wrap">
          <div class="sp-bar-fill" id="sp-bar-fill"></div>
        </div>
        <span class="sp-time" id="sp-time-end">5.0s</span>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.addEventListener('click', (e) => {
    if (editMode) return;
    const link = e.target.closest('.audio-snippet-link');
    if (!link) return;
    e.preventDefault();
    openSnippetPlayer(link.dataset.stems, parseFloat(link.dataset.start), parseFloat(link.dataset.end));
  });

  document.getElementById('sp-btn-close').addEventListener('click', closeSnippetPlayer);
  document.getElementById('sp-btn-expand').addEventListener('click', () => {
    const pModal = document.getElementById('snippet-player-modal');
    pModal.classList.toggle('expanded');
    if (snippetSpectrogram) snippetSpectrogram._resize();
  });
  
  document.getElementById('sp-btn-play').addEventListener('click', toggleSnippetPlay);
  
  // Scrubber click handler
  document.getElementById('sp-bar-wrap').addEventListener('mousedown', (e) => {
    if (!currentSnippet || !snippetEngine || !snippetEngine.duration) return;
    const rect = e.target.closest('#sp-bar-wrap').getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    
    const newTime = currentSnippet.start + (pct * currentSnippet.duration);
    snippetEngine.seek(newTime);
    
    document.getElementById('sp-bar-fill').style.width = `${pct * 100}%`;
    document.getElementById('sp-time-current').textContent = `${(newTime - currentSnippet.start).toFixed(1)}s`;
    if (snippetSpectrogram) {
       snippetSpectrogram._drawStatic(newTime / snippetEngine.duration);
    }
  });
}

async function openSnippetPlayer(stemsStr, start, end) {
  const modal = document.getElementById('snippet-player-modal');
  modal.classList.remove('hidden');
  document.getElementById('sp-loading').classList.remove('hidden');
  document.getElementById('sp-title').textContent = `${stemsStr} (${start}s - ${end}s)`;
  document.getElementById('sp-time-end').textContent = `${(end - start).toFixed(1)}s`;
  document.getElementById('sp-time-current').textContent = '0.0s';
  document.getElementById('sp-bar-fill').style.width = '0%';
  document.getElementById('sp-btn-play').innerHTML = '<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"></polygon></svg>';
  
  // Stop current if playing and recreate engine
  if (snippetEngine) {
    snippetEngine.stop();
  }
  snippetEngine = new AudioEngine();

  if (snippetSpectrogram) {
    snippetSpectrogram.destroy();
    snippetSpectrogram = null;
  }
  cancelAnimationFrame(snippetAnimationFrame);

  currentSnippet = { start, end, duration: end - start };

  const requestedStemIds = stemsStr.split(',').map(s => s.trim());
  const stemConfigsToLoad = requestedStemIds.map(id => ALL_STEMS[id]).filter(Boolean);

  await snippetEngine.init(stemConfigsToLoad);
  
  document.getElementById('sp-loading').classList.add('hidden');

  // Render spectrogram
  const canvas = document.getElementById('sp-canvas');
  // Combine buffer
  const buffer = snippetEngine.getMixedBuffer();
  
  snippetSpectrogram = new SpectrogramRenderer(canvas, buffer, {
    isCombined: requestedStemIds.length > 1,
    color: requestedStemIds.length === 1 ? stemConfigsToLoad[0].color : '#9b6dff',
    getPlaybackTime: () => snippetEngine.getCurrentTime()
  });
  await snippetSpectrogram.init();
  
  // Zoom into the snippet
  const dur = snippetEngine.duration;
  const zoom = dur / currentSnippet.duration;
  const scroll = start / dur;
  snippetSpectrogram.setZoom(zoom, scroll);
  
  // Auto seek to start
  snippetEngine.seek(start);
  
  // Start animation loop
  const loop = () => {
    if (snippetEngine.isPlaying) {
      let t = snippetEngine.getCurrentTime();
      if (t >= end) {
        snippetEngine.pause();
        snippetEngine.seek(start); // reset to start
        t = start;
        document.getElementById('sp-btn-play').innerHTML = '<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"></polygon></svg>';
      }
      const pct = Math.max(0, Math.min(1, (t - start) / currentSnippet.duration));
      document.getElementById('sp-bar-fill').style.width = `${pct * 100}%`;
      document.getElementById('sp-time-current').textContent = `${(t - start).toFixed(1)}s`;
      snippetSpectrogram._drawStatic(t / dur);
    }
    snippetAnimationFrame = requestAnimationFrame(loop);
  };
  loop();
}

function toggleSnippetPlay() {
  const btn = document.getElementById('sp-btn-play');
  if (snippetEngine.isPlaying) {
    snippetEngine.pause();
    btn.innerHTML = '<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"></polygon></svg>';
  } else {
    // If we are at the end, reset to start
    if (snippetEngine.getCurrentTime() >= currentSnippet.end) {
      snippetEngine.seek(currentSnippet.start);
    }
    snippetEngine.play();
    btn.innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
  }
}

function closeSnippetPlayer() {
  if (snippetEngine) snippetEngine.stop();
  cancelAnimationFrame(snippetAnimationFrame);
  document.getElementById('snippet-player-modal').classList.add('hidden');
}

/* ---------- Start ---------- */
initEditMode();
initSnippetEditor();
initSnippetPlayer();

