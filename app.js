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

// ── In-memory state (kept in sync by Firestore listeners) ──────────────────

const state = {
  gameDay:    3,          // 0=Sun … 6=Sat
  field1Name: 'Field 1',
  field2Name: 'Field 2',
  times:      [],         // sorted "HH:MM" strings
  umps:       [],         // [{ id, name, phone }]
  // { "YYYY-MM-DD": { "HH:MM": { f1: umpId|"", f2: umpId|"" } } }
  assignments: {},
  _ready: { settings: false, umps: false, assignments: false },
};

let currentWeekStart = null;

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

// ── Firestore real-time listeners ──────────────────────────────────────────

function checkReady() {
  const r = state._ready;
  if (r.settings && r.umps && r.assignments) {
    document.getElementById('loading-overlay').style.display = 'none';
    if (!currentWeekStart) currentWeekStart = getGameDayDate(new Date(), state.gameDay);
    renderCurrentTab();
  }
}

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
    // Keep settings UI in sync for other users viewing that tab
    document.getElementById('game-day-select').value = state.gameDay;
    document.getElementById('field1-name').value     = state.field1Name;
    document.getElementById('field2-name').value     = state.field2Name;
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

function allReady() {
  return state._ready.settings && state._ready.umps && state._ready.assignments;
}

// ── Date helpers ───────────────────────────────────────────────────────────

function getGameDayDate(from, dayOfWeek, weekOffset = 0) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const diff = (dayOfWeek - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + diff + weekOffset * 7);
  return d;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
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
  saveUmp({ id, name, phone });  // listener will add it to state.umps
}

function removeUmp(id) {
  if (!confirm('Remove this umpire? Their assignments will be cleared.')) return;
  const writes = [deleteUmp(id)];
  Object.entries(state.assignments).forEach(([dayKey, slots]) => {
    let changed = false;
    Object.values(slots).forEach(slot => {
      if (slot.f1 === id) { slot.f1 = ''; changed = true; }
      if (slot.f2 === id) { slot.f2 = ''; changed = true; }
    });
    if (changed) writes.push(saveAssignment(dayKey, slots));
  });
  Promise.all(writes);
}

function countAssignments(umpId) {
  let n = 0;
  Object.values(state.assignments).forEach(day =>
    Object.values(day).forEach(slot => {
      if (slot.f1 === umpId) n++;
      if (slot.f2 === umpId) n++;
    })
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
  if (!confirm('Clear all assignments for this game day?')) return;
  const key = dateKey(currentWeekStart);
  delete state.assignments[key];
  deleteDoc(doc(db, 'assignments', key));
});

document.getElementById('copy-prev-btn').addEventListener('click', () => {
  const prevKey  = dateKey(getGameDayDate(currentWeekStart, state.gameDay, -1));
  const curKey   = dateKey(currentWeekStart);
  const prevData = state.assignments[prevKey];
  if (!prevData) { alert('No assignments found for the previous game day.'); return; }
  if (!confirm("Copy previous week's umpire assignments to this week?")) return;
  const copy = JSON.parse(JSON.stringify(prevData));
  saveAssignment(curKey, copy);
});

document.getElementById('print-btn').addEventListener('click', () => window.print());

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
    const slot = state.assignments[dayKey]?.[time] ?? { f1: '', f2: '' };
    const tr   = document.createElement('tr');
    tr.innerHTML = `
      <td class="time-cell">${formatTime(time)}</td>
      <td><select data-time="${time}" data-field="f1">${buildUmpOptions(slot.f1)}</select></td>
      <td><select data-time="${time}" data-field="f2">${buildUmpOptions(slot.f2)}</select></td>`;

    tr.querySelectorAll('select').forEach(sel => {
      sel.classList.toggle('assigned', !!sel.value);
      sel.addEventListener('change', () => {
        if (!state.assignments[dayKey])        state.assignments[dayKey] = {};
        if (!state.assignments[dayKey][time])  state.assignments[dayKey][time] = { f1: '', f2: '' };
        state.assignments[dayKey][time][sel.dataset.field] = sel.value;
        sel.classList.toggle('assigned', !!sel.value);
        saveAssignment(dayKey, state.assignments[dayKey]);
      });
    });

    tbody.appendChild(tr);
  });
}

// ── Utilities ──────────────────────────────────────────────────────────────

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
