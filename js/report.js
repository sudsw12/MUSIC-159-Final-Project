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

/* ---------- Start ---------- */
document.addEventListener('DOMContentLoaded', () => {
  initEditMode();
});
