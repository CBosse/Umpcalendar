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

// ── Firebase ───────────────────────────────────────────────────────────────

const firebaseConfig = {
  apiKey: "AIzaSyB_qR9FLOCc0uRKmBNmiNBAoAq98tlZ1WU",
  authDomain: "bosse-testing.firebaseapp.com",
  projectId: "bosse-testing",
  storageBucket: "bosse-testing.firebasestorage.app",
  messagingSenderId: "327987648702",
  appId: "1:327987648702:web:b0a2337dc099e6772aa6ef",
};

const db = getFirestore(initializeApp(firebaseConfig), 'umpcalendar');

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  fields:      ['Field 1', 'Field 2'],
  times:       [],
  umps:        [],
  // { "YYYY-MM-DD": { "HH:MM": { "Field Name": { ump, home, away } } } }
  assignments: {},
  _ready: { settings: false, umps: false, assignments: false },
};

let currentDate = todayKey();

// ── Data model helpers ─────────────────────────────────────────────────────

function normalizeFieldSlot(raw) {
  if (!raw || raw === '') return { ump: '', home: '', away: '' };
  if (typeof raw === 'string') return { ump: raw, home: '', away: '' };
  return { ump: raw.ump ?? '', home: raw.home ?? '', away: raw.away ?? '' };
}

function getFieldSlot(dateStr, time, fieldName) {
  const raw = state.assignments[dateStr]?.[time]?.[fieldName];
  return normalizeFieldSlot(raw);
}

function setFieldSlot(dateStr, time, fieldName, patch) {
  if (!state.assignments[dateStr])           state.assignments[dateStr] = {};
  if (!state.assignments[dateStr][time])     state.assignments[dateStr][time] = {};
  const cur = normalizeFieldSlot(state.assignments[dateStr][time][fieldName]);
  state.assignments[dateStr][time][fieldName] = { ...cur, ...patch };
  saveAssignment(dateStr, state.assignments[dateStr]);
}

// ── Firestore write helpers ────────────────────────────────────────────────

function showDbError(err) {
  console.error('Firestore error:', err);
  const msg = err?.code === 'permission-denied'
    ? 'Database permission denied. Check Firestore security rules in Firebase Console.'
    : `Database error: ${err?.message ?? err}`;
  showBanner(msg, 'error');
}

function firestoreWrite(promise) {
  return promise.catch(showDbError);
}

function saveSettings() {
  return firestoreWrite(setDoc(doc(db, 'config', 'settings'), {
    fields: state.fields,
    times:  state.times,
  }));
}

function saveUmp(ump) {
  return firestoreWrite(setDoc(doc(db, 'umps', ump.id), { name: ump.name, phone: ump.phone }));
}

function deleteUmp(id) {
  return firestoreWrite(deleteDoc(doc(db, 'umps', id)));
}

function saveAssignment(dateStr, slots) {
  const op = Object.keys(slots).length === 0
    ? deleteDoc(doc(db, 'assignments', dateStr))
    : setDoc(doc(db, 'assignments', dateStr), slots);
  return firestoreWrite(op);
}

// ── localStorage migration ─────────────────────────────────────────────────

async function migrateFromLocalStorage() {
  try {
    const raw = localStorage.getItem('umpScheduler');
    if (!raw) return;
    const old = JSON.parse(raw);
    if (!old || (!old.times?.length && !old.umps?.length)) return;

    const fields = [old.field1Name || 'Field 1', old.field2Name || 'Field 2'];
    const writes = [setDoc(doc(db, 'config', 'settings'), { fields, times: old.times ?? [] })];

    (old.umps ?? []).forEach(u => {
      writes.push(setDoc(doc(db, 'umps', u.id), { name: u.name, phone: u.phone ?? '' }));
    });

    Object.entries(old.assignments ?? {}).forEach(([date, slots]) => {
      const newSlots = {};
      Object.entries(slots).forEach(([time, slot]) => {
        newSlots[time] = {};
        // Handle old f1/f2 keys and old {ump,home,away} or string formats
        const raw0 = slot.f1 ?? slot[fields[0]];
        const raw1 = slot.f2 ?? slot[fields[1]];
        if (raw0 !== undefined) newSlots[time][fields[0]] = normalizeFieldSlot(raw0);
        if (raw1 !== undefined) newSlots[time][fields[1]] = normalizeFieldSlot(raw1);
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

// ── Firestore listeners ────────────────────────────────────────────────────

function allReady() {
  return state._ready.settings && state._ready.umps && state._ready.assignments;
}

function checkReady() {
  if (allReady()) {
    clearTimeout(connectTimeout);
    document.getElementById('loading-overlay').style.display = 'none';
    renderCurrentTab();
  }
}

const connectTimeout = setTimeout(() => {
  if (!allReady()) {
    document.getElementById('loading-overlay').style.display = 'none';
    showBanner(
      'Could not connect to database. Check that the "umpcalendar" Firestore database ' +
      'exists and its security rules allow reads and writes.',
      'error'
    );
    renderCurrentTab();
  }
}, 10000);

let migrationAttempted = false;

onSnapshot(doc(db, 'config', 'settings'), snap => {
  if (snap.exists()) {
    const d = snap.data();
    // Support both new (fields array) and old (field1Name/field2Name) formats
    state.fields = Array.isArray(d.fields)
      ? d.fields
      : [d.field1Name || 'Field 1', d.field2Name || 'Field 2'];
    state.times = d.times ?? [];
  } else if (!snap.metadata.fromCache && !migrationAttempted) {
    migrationAttempted = true;
    migrateFromLocalStorage();
  }
  state._ready.settings = true;
  checkReady();
  if (allReady()) renderCurrentTab();
}, err => showDbError(err));

onSnapshot(collection(db, 'umps'), snap => {
  state.umps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  state._ready.umps = true;
  checkReady();
  if (allReady()) renderCurrentTab();
}, err => showDbError(err));

onSnapshot(collection(db, 'assignments'), snap => {
  state.assignments = {};
  snap.docs.forEach(d => { state.assignments[d.id] = d.data(); });
  state._ready.assignments = true;
  checkReady();
  if (allReady()) renderCurrentTab();
}, err => showDbError(err));

// ── Date helpers ───────────────────────────────────────────────────────────

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayKey() { return dateKey(new Date()); }

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return dateKey(date);
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
  if (tab === 'settings') { renderFields(); renderTimes(); }
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

// ── Settings: Fields ───────────────────────────────────────────────────────

document.getElementById('add-field-btn').addEventListener('click', addField);
document.getElementById('new-field-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addField();
});

function addField() {
  const input = document.getElementById('new-field-input');
  const name  = input.value.trim();
  if (!name || state.fields.includes(name)) { input.value = ''; return; }
  state.fields.push(name);
  input.value = '';
  saveSettings();
}

function removeField(name) {
  if (!confirm(`Remove "${name}"? All umpire assignments for this field will be cleared.`)) return;
  state.fields = state.fields.filter(f => f !== name);
  const writes = [saveSettings()];
  Object.entries(state.assignments).forEach(([dateStr, slots]) => {
    let changed = false;
    Object.values(slots).forEach(timeSlot => {
      if (name in timeSlot) { delete timeSlot[name]; changed = true; }
    });
    if (changed) writes.push(saveAssignment(dateStr, slots));
  });
  Promise.all(writes);
}

function renderFields() {
  const list = document.getElementById('fields-list');
  const msg  = document.getElementById('no-fields-msg');
  list.innerHTML = '';
  if (state.fields.length === 0) { msg.style.display = ''; return; }
  msg.style.display = 'none';
  state.fields.forEach(name => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="info"><span class="name">${escHtml(name)}</span></span>
      <button class="remove-btn">Remove</button>`;
    li.querySelector('.remove-btn').addEventListener('click', () => removeField(name));
    list.appendChild(li);
  });
}

// ── Settings: Times ────────────────────────────────────────────────────────

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
    .map(([dateStr, slots]) => { delete slots[hhmm]; return saveAssignment(dateStr, slots); });
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
  Object.entries(state.assignments).forEach(([dateStr, slots]) => {
    let changed = false;
    Object.values(slots).forEach(timeSlot => {
      Object.keys(timeSlot).forEach(fieldName => {
        const slot = normalizeFieldSlot(timeSlot[fieldName]);
        if (slot.ump === id) { timeSlot[fieldName] = { ...slot, ump: '' }; changed = true; }
      });
    });
    if (changed) writes.push(saveAssignment(dateStr, slots));
  });
  Promise.all(writes);
}

function countAssignments(umpId) {
  let n = 0;
  Object.values(state.assignments).forEach(day =>
    Object.values(day).forEach(timeSlot =>
      Object.values(timeSlot).forEach(raw => {
        if (normalizeFieldSlot(raw).ump === umpId) n++;
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

document.getElementById('schedule-date').value = currentDate;

document.getElementById('prev-day').addEventListener('click', () => {
  currentDate = addDays(currentDate, -1);
  document.getElementById('schedule-date').value = currentDate;
  renderSchedule();
});

document.getElementById('next-day').addEventListener('click', () => {
  currentDate = addDays(currentDate, 1);
  document.getElementById('schedule-date').value = currentDate;
  renderSchedule();
});

document.getElementById('schedule-date').addEventListener('change', e => {
  if (e.target.value) { currentDate = e.target.value; renderSchedule(); }
});

document.getElementById('clear-day-btn').addEventListener('click', () => {
  if (!confirm('Clear all assignments for this day?')) return;
  delete state.assignments[currentDate];
  firestoreWrite(deleteDoc(doc(db, 'assignments', currentDate)));
});

document.getElementById('copy-prev-btn').addEventListener('click', () => {
  const prevDate = addDays(currentDate, -7);
  const prevData = state.assignments[prevDate];
  if (!prevData) { alert('No assignments found 7 days ago.'); return; }
  if (!confirm("Copy last week's assignments to this day?")) return;
  const copy = JSON.parse(JSON.stringify(prevData));
  saveAssignment(currentDate, copy);
});

document.getElementById('print-btn').addEventListener('click', () => window.print());

// ── CSV import ─────────────────────────────────────────────────────────────

document.getElementById('import-csv-btn').addEventListener('click', () => {
  document.getElementById('csv-file-input').click();
});

document.getElementById('csv-file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  const reader = new FileReader();
  reader.onload  = ev => importCSV(ev.target.result);
  reader.onerror = () => showImportStatus('Failed to read file.', true);
  reader.readAsText(file);
});

function normalizeCSVTime(raw) {
  raw = raw.trim();
  const m24 = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return `${m24[1].padStart(2, '0')}:${m24[2]}`;
  const m12 = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (m12) {
    let h  = parseInt(m12[1], 10);
    const mins = m12[2];
    const pm   = m12[3].toUpperCase() === 'PM';
    if (pm && h !== 12) h += 12;
    if (!pm && h === 12) h = 0;
    return `${h.toString().padStart(2, '0')}:${mins}`;
  }
  return null;
}

function matchFieldName(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Case-insensitive exact match against known fields
  const exact = state.fields.find(f => f.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  // Normalized alias (removes spaces, dashes, underscores)
  const norm = trimmed.toLowerCase().replace(/[-_ ]/g, '');
  for (const f of state.fields) {
    if (f.toLowerCase().replace(/[-_ ]/g, '') === norm) return f;
  }
  // Common generic aliases → first/second field
  if (norm === 'field1' || norm === 'f1') return state.fields[0] ?? trimmed;
  if (norm === 'field2' || norm === 'f2') return state.fields[1] ?? trimmed;
  // Unknown → return as-is and auto-create it
  return trimmed;
}

function showImportStatus(msg, isError = false) {
  const el = document.getElementById('import-status');
  el.textContent = msg;
  el.className   = `import-status ${isError ? 'import-error' : 'import-ok'}`;
  el.style.display = '';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.display = 'none'; }, 8000);
}

function importCSV(text) {
  try {
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error('File appears empty or has no data rows.');

    const header = lines[0].replace(/^﻿/, '').split(',').map(h => h.trim().toLowerCase());
    const colAny = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i !== -1) return i; } return -1; };
    const iDate  = colAny('date', 'game date', 'gamedate');
    const iTime  = colAny('time', 'game time', 'gametime', 'start time', 'starttime');
    const iField = colAny('field', 'field name', 'fieldname', 'location', 'venue');
    const iHome  = colAny('home team', 'home', 'hometeam', 'home_team');
    const iAway  = colAny('away team', 'away', 'awayteam', 'away_team', 'visitor', 'visitors');

    if ([iDate, iTime, iField, iHome, iAway].includes(-1)) {
      const labels  = ['date','time','field','home team','away team'];
      const indices = [iDate, iTime, iField, iHome, iAway];
      throw new Error(`Missing column(s): ${labels.filter((_, i) => indices[i] === -1).join(', ')}`);
    }

    const byDay = {};
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols  = splitCSVLine(lines[i]);
      const need  = Math.max(iDate, iTime, iField, iHome, iAway) + 1;
      if (cols.length < need) { skipped++; continue; }

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

    const writes = Object.entries(byDay).map(([dateStr, newSlots]) => {
      const existing = state.assignments[dateStr] ?? {};
      Object.entries(newSlots).forEach(([time, fields]) => {
        if (!existing[time]) existing[time] = {};
        Object.entries(fields).forEach(([f, teams]) => {
          const cur = normalizeFieldSlot(existing[time][f]);
          existing[time][f] = { ump: cur.ump, home: teams.home, away: teams.away };
        });
      });
      state.assignments[dateStr] = existing;
      return saveAssignment(dateStr, existing);
    });

    // Auto-add missing times and fields
    const csvTimes  = [...new Set(Object.values(byDay).flatMap(d => Object.keys(d)))];
    const newTimes  = csvTimes.filter(t => !state.times.includes(t));
    const csvFields = [...new Set(Object.values(byDay).flatMap(d => Object.values(d).flatMap(t => Object.keys(t))))];
    const newFields = csvFields.filter(f => !state.fields.includes(f));

    if (newTimes.length || newFields.length) {
      state.times  = [...state.times,  ...newTimes].sort();
      state.fields = [...state.fields, ...newFields];
      writes.push(saveSettings());
    }

    const importedDates = Object.keys(byDay).sort();

    Promise.all(writes).then(() => {
      const gameCount = Object.values(byDay)
        .flatMap(d => Object.values(d).flatMap(t => Object.keys(t))).length;
      const parts = [
        `Imported ${gameCount} game${gameCount !== 1 ? 's' : ''} across ${importedDates.length} day${importedDates.length !== 1 ? 's' : ''}.`,
      ];
      if (newTimes.length)  parts.push(`Added ${newTimes.length} time slot${newTimes.length !== 1 ? 's' : ''}.`);
      if (newFields.length) parts.push(`Added ${newFields.length} field${newFields.length !== 1 ? 's' : ''}.`);
      if (skipped)          parts.push(`(${skipped} rows skipped)`);
      showImportStatus(parts.join(' '));

      if (importedDates.length) {
        currentDate = importedDates[0];
        document.getElementById('schedule-date').value = currentDate;
      }
      renderSchedule();
    });

  } catch (err) {
    showImportStatus(`Import failed: ${err.message}`, true);
  }
}

function splitCSVLine(line) {
  const cols = [];
  let cur = '', inQuote = false;
  for (const ch of line) {
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

function matchupHTML(slot) {
  if (!slot.home && !slot.away) return '';
  return `<div class="matchup">
    <span class="team">${escHtml(slot.home || '?')}</span>
    <span class="vs">vs</span>
    <span class="team">${escHtml(slot.away || '?')}</span>
  </div>`;
}

function renderSchedule() {
  document.getElementById('schedule-date').value = currentDate;

  const thead   = document.getElementById('schedule-head');
  const tbody   = document.getElementById('schedule-body');
  const noSlots = document.getElementById('no-slots-msg');
  const table   = document.getElementById('schedule-table');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  if (state.times.length === 0 || state.fields.length === 0) {
    table.style.display  = 'none';
    noSlots.style.display = '';
    noSlots.innerHTML = state.fields.length === 0
      ? 'No fields configured. Go to <strong>Settings</strong> to add fields.'
      : 'No game times configured. Go to <strong>Settings</strong> to add time slots.';
    return;
  }
  table.style.display   = '';
  noSlots.style.display = 'none';

  // Dynamic header row
  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th>Time</th>' +
    state.fields.map(f => `<th>${escHtml(f)}</th>`).join('');
  thead.appendChild(headRow);

  // One row per time slot
  state.times.forEach(time => {
    const tr = document.createElement('tr');
    let html = `<td class="time-cell">${formatTime(time)}</td>`;

    state.fields.forEach(fieldName => {
      const slot    = getFieldSlot(currentDate, time, fieldName);
      const hasGame = !!(slot.home || slot.away || slot.ump);
      html += `<td class="game-cell${hasGame ? '' : ' no-game'}" data-field="${escHtml(fieldName)}" data-time="${escHtml(time)}">
        ${matchupHTML(slot)}
        <select data-time="${escHtml(time)}" data-field="${escHtml(fieldName)}">
          ${buildUmpOptions(slot.ump)}
        </select>
      </td>`;
    });

    tr.innerHTML = html;

    tr.querySelectorAll('select').forEach(sel => {
      sel.classList.toggle('assigned', !!sel.value);
      sel.addEventListener('change', () => {
        setFieldSlot(currentDate, sel.dataset.time, sel.dataset.field, { ump: sel.value });
        sel.classList.toggle('assigned', !!sel.value);
        // Remove no-game styling once an ump is assigned
        sel.closest('td').classList.toggle('no-game', false);
      });
    });

    tbody.appendChild(tr);
  });
}

// ── Utilities ──────────────────────────────────────────────────────────────

function showBanner(msg, type = 'error') {
  const el = document.getElementById('db-banner');
  el.textContent = msg;
  el.className   = `db-banner db-banner--${type}`;
  el.style.display = 'block';
  if (type !== 'error') {
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.display = 'none'; }, 5000);
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
