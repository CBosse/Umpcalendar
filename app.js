'use strict';

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore,
  doc,
  collection,
  onSnapshot,
  setDoc,
  deleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Firebase setup ─────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey: "AIzaSyB_qR9FLOCc0uRKmBNmiNBAoAq98tlZ1WU",
  authDomain: "bosse-testing.firebaseapp.com",
  projectId: "bosse-testing",
  storageBucket: "bosse-testing.firebasestorage.app",
  messagingSenderId: "327987648702",
  appId: "1:327987648702:web:b0a2337dc099e6772aa6ef",
};

const db = getFirestore(initializeApp(firebaseConfig));

// ── In-memory state ────────────────────────────────────────────────────────

const state = {
  gameDay:     3,
  field1Name:  'Field 1',
  field2Name:  'Field 2',
  times:       [],
  umps:        [],
  // { "YYYY-MM-DD": { "HH:MM": { f1: {ump,home,away}, f2: {ump,home,away} } } }
  assignments: {},
  _ready: { settings: false, umps: false, assignments: false },
};

let currentWeekStart = null;

// ── Data model helpers ─────────────────────────────────────────────────────

// Normalize a single field slot — handles both old string format and new object format
function normalizeFieldSlot(raw) {
  if (!raw || raw === '') return { ump: '', home: '', away: '' };
  if (typeof raw === 'string') return { ump: raw, home: '', away: '' };
  return { ump: raw.ump ?? '', home: raw.home ?? '', away: raw.away ?? '' };
}

function getFieldSlot(dayKey, time, field) {
  const raw = state.assignments[dayKey]?.[time]?.[field];
  return normalizeFieldSlot(raw);
}

function setFieldSlot(dayKey, time, field, patch) {
  if (!state.assignments[dayKey])        state.assignments[dayKey] = {};
  if (!state.assignments[dayKey][time])  state.assignments[dayKey][time] = {};
  const current = normalizeFieldSlot(state.assignments[dayKey][time][field]);
  state.assignments[dayKey][time][field] = { ...current, ...patch };
  saveAssignment(dayKey, state.assignments[dayKey]);
}

// ── Firestore write helpers ────────────────────────────────────────────────

function saveSettings() {
  return setDoc(doc(db, 'config', 'settings'), {
    gameDay:    state.gameDay,
    field1Name: state.field1Name,
    field2Name: state.field2Name,
    times:      state.times,
  });
}

function saveUmp(ump) {
  return setDoc(doc(db, 'umps', ump.id), { name: ump.name, phone: ump.phone });
}

function deleteUmp(id) {
  return deleteDoc(doc(db, 'umps', id));
}

function saveAssignment(dayKey, slots) {
  if (Object.keys(slots).length === 0) return deleteDoc(doc(db, 'assignments', dayKey));
  return setDoc(doc(db, 'assignments', dayKey), slots);
}

// ── localStorage → Firestore migration ────────────────────────────────────
// Runs once if Firestore has no settings (app was previously localStorage-only)

async function migrateFromLocalStorage() {
  try {
    const raw = localStorage.getItem('umpScheduler');
    if (!raw) return;
    const old = JSON.parse(raw);
    if (!old || (!old.times?.length && !old.umps?.length)) return;

    const writes = [];

    // Settings
    writes.push(setDoc(doc(db, 'config', 'settings'), {
      gameDay:    old.gameDay    ?? 3,
      field1Name: old.field1Name ?? 'Field 1',
      field2Name: old.field2Name ?? 'Field 2',
      times:      old.times      ?? [],
    }));

    // Umpires
    (old.umps ?? []).forEach(u => {
      writes.push(setDoc(doc(db, 'umps', u.id), { name: u.name, phone: u.phone ?? '' }));
    });

    // Assignments — convert old {f1: umpId, f2: umpId} → new {f1:{ump,home,away}, f2:{...}}
    Object.entries(old.assignments ?? {}).forEach(([date, slots]) => {
      const newSlots = {};
      Object.entries(slots).forEach(([time, slot]) => {
        newSlots[time] = {
          f1: { ump: typeof slot.f1 === 'string' ? slot.f1 : '', home: '', away: '' },
          f2: { ump: typeof slot.f2 === 'string' ? slot.f2 : '', home: '', away: '' },
        };
      });
      writes.push(setDoc(doc(db, 'assignments', date), newSlots));
    });

    await Promise.all(writes);
    localStorage.removeItem('umpScheduler');
    console.log('Migrated localStorage data to Firestore');
  } catch (err) {
    console.error('localStorage migration failed:', err);
  }
}

// ── Firestore real-time listeners ──────────────────────────────────────────

function allReady() {
  return state._ready.settings && state._ready.umps && state._ready.assignments;
}

function checkReady() {
  if (allReady()) {
    document.getElementById('loading-overlay').style.display = 'none';
    if (!currentWeekStart) currentWeekStart = getGameDayDate(new Date(), state.gameDay);
    renderCurrentTab();
  }
}

let migrationAttempted = false;

onSnapshot(doc(db, 'config', 'settings'), snap => {
  if (snap.exists()) {
    const d = snap.data();
    const prevDay      = state.gameDay;
    state.gameDay      = d.gameDay      ?? 3;
    state.field1Name   = d.field1Name   ?? 'Field 1';
    state.field2Name   = d.field2Name   ?? 'Field 2';
    state.times        = d.times        ?? [];
    if (currentWeekStart && prevDay !== state.gameDay) {
      currentWeekStart = getGameDayDate(new Date(), state.gameDay);
    }
    document.getElementById('game-day-select').value = state.gameDay;
    document.getElementById('field1-name').value     = state.field1Name;
    document.getElementById('field2-name').value     = state.field2Name;
  } else if (!snap.metadata.fromCache && !migrationAttempted) {
    // Firestore has no settings yet — migrate from localStorage if available
    migrationAttempted = true;
    migrateFromLocalStorage();
    return; // listener will re-fire after the write
  }
  state._ready.settings = true;
  checkReady();
  if (allReady()) renderCurrentTab();
}, err => console.error('settings listener:', err));

onSnapshot(collection(db, 'umps'), snap => {
  state.umps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  state._ready.umps = true;
  checkReady();
  if (allReady()) renderCurrentTab();
}, err => console.error('umps listener:', err));

onSnapshot(collection(db, 'assignments'), snap => {
  state.assignments = {};
  snap.docs.forEach(d => { state.assignments[d.id] = d.data(); });
  state._ready.assignments = true;
  checkReady();
  if (allReady()) renderCurrentTab();
}, err => console.error('assignments listener:', err));

// ── Date helpers ───────────────────────────────────────────────────────────

function getGameDayDate(from, dayOfWeek, weekOffset = 0) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const diff = (dayOfWeek - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff + weekOffset * 7);
  return d;
}

// Use local date parts — toISOString() returns UTC which breaks for US timezones
function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function formatTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour   = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${period}`;
}

// ── Tab routing ────────────────────────────────────────────────────────────

function activeTab() {
  return document.querySelector('.tab.active')?.dataset.tab ?? 'schedule';
}

function renderCurrentTab() {
  const tab = activeTab();
  if (tab === 'schedule') renderSchedule();
  if (tab === 'umps')     renderUmps();
  if (tab === 'settings') renderTimes();
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    renderCurrentTab();
  });
});

// ── Settings tab ───────────────────────────────────────────────────────────

document.getElementById('game-day-select').addEventListener('change', e => {
  state.gameDay    = parseInt(e.target.value, 10);
  currentWeekStart = getGameDayDate(new Date(), state.gameDay);
  saveSettings();
});

document.getElementById('save-fields-btn').addEventListener('click', () => {
  state.field1Name = document.getElementById('field1-name').value.trim() || 'Field 1';
  state.field2Name = document.getElementById('field2-name').value.trim() || 'Field 2';
  document.getElementById('field1-name').value = state.field1Name;
  document.getElementById('field2-name').value = state.field2Name;
  saveSettings();
});

document.getElementById('add-time-btn').addEventListener('click', addTime);
document.getElementById('new-time-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addTime();
});

function addTime() {
  const input = document.getElementById('new-time-input');
  const val   = input.value;
  if (!val || state.times.includes(val)) { input.value = ''; return; }
  state.times.push(val);
  state.times.sort();
  input.value = '';
  saveSettings();
}

function removeTime(hhmm) {
  state.times = state.times.filter(t => t !== hhmm);
  const writes = Object.entries(state.assignments)
    .filter(([, slots]) => hhmm in slots)
    .map(([dayKey, slots]) => { delete slots[hhmm]; return saveAssignment(dayKey, slots); });
  Promise.all([saveSettings(), ...writes]);
}

function renderTimes() {
  const list = document.getElementById('times-list');
  const msg  = document.getElementById('no-times-msg');
  list.innerHTML = '';
  if (state.times.length === 0) { msg.style.display = ''; return; }
  msg.style.display = 'none';
  state.times.forEach(t => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="info"><span class="name">${formatTime(t)}</span></span>
      <button class="remove-btn">Remove</button>`;
    li.querySelector('.remove-btn').addEventListener('click', () => removeTime(t));
    list.appendChild(li);
  });
}

// ── Umpires tab ────────────────────────────────────────────────────────────

document.getElementById('add-ump-btn').addEventListener('click', addUmp);
document.getElementById('ump-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addUmp();
});

function addUmp() {
  const nameEl  = document.getElementById('ump-name-input');
  const phoneEl = document.getElementById('ump-phone-input');
  const name    = nameEl.value.trim();
  if (!name) return;
  const phone = phoneEl.value.trim();
  const id    = `ump_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  nameEl.value  = '';
  phoneEl.value = '';
  nameEl.focus();
  saveUmp({ id, name, phone });
}

function removeUmp(id) {
  if (!confirm('Remove this umpire? Their assignments will be cleared.')) return;
  const writes = [deleteUmp(id)];
  Object.entries(state.assignments).forEach(([dayKey, slots]) => {
    let changed = false;
    Object.values(slots).forEach(timeSlot => {
      ['f1', 'f2'].forEach(f => {
        const slot = normalizeFieldSlot(timeSlot[f]);
        if (slot.ump === id) { timeSlot[f] = { ...slot, ump: '' }; changed = true; }
      });
    });
    if (changed) writes.push(saveAssignment(dayKey, slots));
  });
  Promise.all(writes);
}

function countAssignments(umpId) {
  let n = 0;
  Object.values(state.assignments).forEach(day =>
    Object.values(day).forEach(timeSlot =>
      ['f1', 'f2'].forEach(f => {
        if (normalizeFieldSlot(timeSlot[f]).ump === umpId) n++;
      })
    )
  );
  return n;
}

function renderUmps() {
  const list = document.getElementById('ump-list');
  const msg  = document.getElementById('no-umps-msg');
  list.innerHTML = '';
  if (state.umps.length === 0) { msg.style.display = ''; return; }
  msg.style.display = 'none';
  state.umps.forEach(u => {
    const n  = countAssignments(u.id);
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="info">
        <span class="name">${escHtml(u.name)}</span>
        ${u.phone ? `<span class="sub">${escHtml(u.phone)}</span>` : ''}
      </span>
      <span class="game-count">${n} game${n !== 1 ? 's' : ''}</span>
      <button class="remove-btn">Remove</button>`;
    li.querySelector('.remove-btn').addEventListener('click', () => removeUmp(u.id));
    list.appendChild(li);
  });
}

// ── Schedule tab ───────────────────────────────────────────────────────────

document.getElementById('prev-week').addEventListener('click', () => {
  currentWeekStart = getGameDayDate(currentWeekStart, state.gameDay, -1);
  renderSchedule();
});

document.getElementById('next-week').addEventListener('click', () => {
  currentWeekStart = getGameDayDate(currentWeekStart, state.gameDay, 1);
  renderSchedule();
});

document.getElementById('clear-week-btn').addEventListener('click', () => {
  if (!confirm('Clear all assignments and team names for this game day?')) return;
  const key = dateKey(currentWeekStart);
  delete state.assignments[key];
  deleteDoc(doc(db, 'assignments', key));
});

document.getElementById('copy-prev-btn').addEventListener('click', () => {
  const prevKey  = dateKey(getGameDayDate(currentWeekStart, state.gameDay, -1));
  const curKey   = dateKey(currentWeekStart);
  const prevData = state.assignments[prevKey];
  if (!prevData) { alert('No assignments found for the previous game day.'); return; }
  if (!confirm("Copy previous week's assignments to this week?")) return;
  const copy = JSON.parse(JSON.stringify(prevData));
  saveAssignment(curKey, copy);
});

document.getElementById('print-btn').addEventListener('click', () => window.print());

// ── CSV import ─────────────────────────────────────────────────────────────

document.getElementById('import-csv-btn').addEventListener('click', () => {
  document.getElementById('csv-file-input').click();
});

document.getElementById('csv-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // reset so same file can be re-imported
  const reader = new FileReader();
  reader.onload = ev => importCSV(ev.target.result);
  reader.readAsText(file);
});

function normalizeCSVTime(raw) {
  raw = raw.trim();
  // HH:MM 24-hour
  const m24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return `${m24[1].padStart(2, '0')}:${m24[2]}`;
  // H:MM AM/PM
  const m12 = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const mins = m12[2];
    const pm   = m12[3].toUpperCase() === 'PM';
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return `${h.toString().padStart(2, '0')}:${mins}`;
  }
  return null;
}

function matchFieldName(raw) {
  const f = raw.trim().toLowerCase();
  if (f === state.field1Name.toLowerCase() || f === 'field 1' || f === '1') return 'f1';
  if (f === state.field2Name.toLowerCase() || f === 'field 2' || f === '2') return 'f2';
  return null;
}

function showImportStatus(msg, isError = false) {
  const el = document.getElementById('import-status');
  el.textContent = msg;
  el.className   = `import-status ${isError ? 'import-error' : 'import-ok'}`;
  el.style.display = '';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

function importCSV(text) {
  try {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error('File appears empty or has no data rows.');

    // Parse header (case-insensitive)
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const col = name => header.indexOf(name);
    const iDate  = col('date');
    const iTime  = col('time');
    const iField = col('field');
    const iHome  = col('home team');
    const iAway  = col('away team');

    if ([iDate, iTime, iField, iHome, iAway].includes(-1)) {
      const missing = ['date','time','field','home team','away team']
        .filter((_, i) => [iDate,iTime,iField,iHome,iAway][i] === -1);
      throw new Error(`Missing column(s): ${missing.join(', ')}`);
    }

    const byDay = {};  // { "YYYY-MM-DD": { "HH:MM": { f1|f2: { home, away } } } }
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      // Handle quoted fields simply by splitting on comma outside quotes
      const cols = splitCSVLine(lines[i]);
      if (cols.length < 5) { skipped++; continue; }

      const date  = cols[iDate]?.trim();
      const time  = normalizeCSVTime(cols[iTime] ?? '');
      const field = matchFieldName(cols[iField] ?? '');
      const home  = cols[iHome]?.trim() ?? '';
      const away  = cols[iAway]?.trim() ?? '';

      if (!date || !time || !field) { skipped++; continue; }
      if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) { skipped++; continue; }

      if (!byDay[date]) byDay[date] = {};
      if (!byDay[date][time]) byDay[date][time] = {};
      byDay[date][time][field] = { home, away };
    }

    const writes = Object.entries(byDay).map(([dayKey, newSlots]) => {
      // Merge into existing assignments, preserving ump selections
      const existing = state.assignments[dayKey] ?? {};
      Object.entries(newSlots).forEach(([time, fields]) => {
        if (!existing[time]) existing[time] = {};
        Object.entries(fields).forEach(([f, teams]) => {
          const cur = normalizeFieldSlot(existing[time][f]);
          existing[time][f] = { ump: cur.ump, home: teams.home, away: teams.away };
        });
      });
      state.assignments[dayKey] = existing;
      return saveAssignment(dayKey, existing);
    });

    Promise.all(writes).then(() => {
      const gameCount = Object.values(byDay)
        .flatMap(d => Object.values(d).flatMap(t => Object.keys(t))).length;
      const msg = `Imported ${gameCount} game${gameCount !== 1 ? 's' : ''} across ${writes.length} game day${writes.length !== 1 ? 's' : ''}.` +
        (skipped ? ` (${skipped} row${skipped !== 1 ? 's' : ''} skipped)` : '');
      showImportStatus(msg);
      renderSchedule();
    });

  } catch (err) {
    showImportStatus(`Import failed: ${err.message}`, true);
  }
}

// Minimal CSV line splitter that handles double-quoted fields
function splitCSVLine(line) {
  const cols = [];
  let cur = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ',' && !inQuote) { cols.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}

// ── Schedule rendering ─────────────────────────────────────────────────────

function buildUmpOptions(selectedId) {
  let opts = '<option value="">— Unassigned —</option>';
  state.umps.forEach(u => {
    opts += `<option value="${u.id}"${u.id === selectedId ? ' selected' : ''}>${escHtml(u.name)}</option>`;
  });
  return opts;
}

function renderSchedule() {
  if (!currentWeekStart) return;

  document.getElementById('field1-header').textContent = state.field1Name;
  document.getElementById('field2-header').textContent = state.field2Name;
  currentWeekStart = getGameDayDate(currentWeekStart, state.gameDay);
  document.getElementById('week-label').textContent = formatDate(currentWeekStart);

  const tbody   = document.getElementById('schedule-body');
  const noSlots = document.getElementById('no-slots-msg');
  const table   = document.getElementById('schedule-table');
  tbody.innerHTML = '';

  if (state.times.length === 0) {
    table.style.display = 'none';
    noSlots.style.display = '';
    return;
  }
  table.style.display = '';
  noSlots.style.display = 'none';

  const dayKey = dateKey(currentWeekStart);

  state.times.forEach(time => {
    const f1 = getFieldSlot(dayKey, time, 'f1');
    const f2 = getFieldSlot(dayKey, time, 'f2');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="time-cell">${formatTime(time)}</td>
      <td class="game-cell">
        ${matchupHTML(f1)}
        <select data-time="${time}" data-field="f1">${buildUmpOptions(f1.ump)}</select>
      </td>
      <td class="game-cell">
        ${matchupHTML(f2)}
        <select data-time="${time}" data-field="f2">${buildUmpOptions(f2.ump)}</select>
      </td>`;

    tr.querySelectorAll('select').forEach(sel => {
      sel.classList.toggle('assigned', !!sel.value);
      sel.addEventListener('change', () => {
        setFieldSlot(dayKey, sel.dataset.time, sel.dataset.field, { ump: sel.value });
        sel.classList.toggle('assigned', !!sel.value);
      });
    });

    tbody.appendChild(tr);
  });
}

function matchupHTML(slot) {
  if (!slot.home && !slot.away) return '';
  const home = escHtml(slot.home || '?');
  const away = escHtml(slot.away || '?');
  return `<div class="matchup"><span class="team home">${home}</span><span class="vs">vs</span><span class="team away">${away}</span></div>`;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
