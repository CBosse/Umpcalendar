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
const ADMIN_PASSWORD = 'ump-admin';
let isAdminMode = false;
let adminDraft = null;

// ── Data model helpers ─────────────────────────────────────────────────────

function normalizeFieldSlot(raw) {
  if (!raw || raw === '') return { ump: '', home: '', away: '' };
  if (typeof raw === 'string') return { ump: raw, home: '', away: '' };
  return { ump: raw.ump ?? '', home: raw.home ?? '', away: raw.away ?? '' };
}

function cloneAssignments(source) {
  return JSON.parse(JSON.stringify(source ?? {}));
}

function getScheduleModel() {
  if (isAdminMode && adminDraft) return adminDraft;
  return { fields: state.fields, times: state.times, assignments: state.assignments };
}

function getScheduleAssignments() {
  return getScheduleModel().assignments;
}

function getFieldSlot(dateStr, time, fieldName) {
  const raw = getScheduleAssignments()[dateStr]?.[time]?.[fieldName];
  return normalizeFieldSlot(raw);
}

function setFieldSlot(dateStr, time, fieldName, patch) {
  const assignments = getScheduleAssignments();
  if (!assignments[dateStr])       assignments[dateStr] = {};
  if (!assignments[dateStr][time]) assignments[dateStr][time] = {};
  const cur = normalizeFieldSlot(assignments[dateStr][time][fieldName]);
  assignments[dateStr][time][fieldName] = { ...cur, ...patch };
  if (!isAdminMode) saveAssignment(dateStr, assignments[dateStr]);
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
  return saveSettingsFrom(state.fields, state.times);
}

function saveSettingsFrom(fields, times) {
  return firestoreWrite(setDoc(doc(db, 'config', 'settings'), {
    fields,
    times,
  }));
}

function saveUmp(ump) {
  return firestoreWrite(setDoc(doc(db, 'umps', ump.id), {
    name:        ump.name,
    phone:       ump.phone,
    teams:       ump.teams       ?? [],
    unavailable: ump.unavailable ?? [],
  }));
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
  state.umps = snap.docs.map(d => ({ id: d.id, teams: [], unavailable: [], ...d.data() }));
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
  syncAdminUi();
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

function beginAdminMode() {
  isAdminMode = true;
  adminDraft = {
    fields: [...state.fields],
    times: [...state.times],
    assignments: cloneAssignments(state.assignments),
  };
  showBanner('Admin View enabled. Changes are pending until you save.', 'success');
  renderCurrentTab();
}

function exitAdminMode() {
  isAdminMode = false;
  adminDraft = null;
  renderCurrentTab();
}

function syncAdminUi() {
  const status = document.getElementById('admin-status-msg');
  const enterBtn = document.getElementById('admin-view-btn');
  const saveBtn = document.getElementById('admin-save-btn');
  const lockMsg = document.getElementById('settings-lock-msg');
  const editLocked = !isAdminMode;

  if (status) status.textContent = isAdminMode
    ? 'Admin View is active. Save to apply and lock editing.'
    : 'Settings are locked in View Mode.';
  if (enterBtn) enterBtn.textContent = isAdminMode ? 'Admin View Active' : 'Admin View';
  if (enterBtn) enterBtn.disabled = isAdminMode;
  if (saveBtn) saveBtn.style.display = isAdminMode ? '' : 'none';
  if (lockMsg) lockMsg.style.display = editLocked ? '' : 'none';

  const settingsInputs = [
    'new-field-input', 'add-field-btn',
    'new-time-input', 'add-time-btn',
  ];
  settingsInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = editLocked;
  });

  document.querySelectorAll('#fields-list .remove-btn, #times-list .remove-btn')
    .forEach(btn => { btn.disabled = editLocked; });

  document.getElementById('clear-day-btn').style.display = isAdminMode ? '' : 'none';
  document.getElementById('copy-prev-btn').style.display = isAdminMode ? '' : 'none';
  document.getElementById('import-csv-btn').style.display = isAdminMode ? '' : 'none';
}

async function saveAndExitAdminMode() {
  if (!isAdminMode || !adminDraft) return;

  const writes = [saveSettingsFrom(adminDraft.fields, adminDraft.times)];
  const allDates = new Set([
    ...Object.keys(state.assignments),
    ...Object.keys(adminDraft.assignments),
  ]);
  allDates.forEach(dateStr => {
    const before = state.assignments[dateStr] ?? null;
    const after  = adminDraft.assignments[dateStr] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      writes.push(after
        ? saveAssignment(dateStr, after)
        : firestoreWrite(deleteDoc(doc(db, 'assignments', dateStr))));
    }
  });

  await Promise.all(writes);
  showBanner('Admin changes saved. View Mode is active.', 'success');
  exitAdminMode();
}

document.getElementById('admin-view-btn').addEventListener('click', () => {
  const input = prompt('Enter Admin password');
  if (input === ADMIN_PASSWORD) beginAdminMode();
  else if (input !== null) alert('Incorrect password.');
});

document.getElementById('admin-save-btn').addEventListener('click', () => {
  saveAndExitAdminMode();
});

// ── Settings: Fields ───────────────────────────────────────────────────────

document.getElementById('add-field-btn').addEventListener('click', addField);
document.getElementById('new-field-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') addField();
});

function addField() {
  if (!isAdminMode) return;
  const model = getScheduleModel();
  const input = document.getElementById('new-field-input');
  const name  = input.value.trim();
  if (!name || model.fields.includes(name)) { input.value = ''; return; }
  model.fields.push(name);
  input.value = '';
  renderCurrentTab();
}

function removeField(name) {
  if (!isAdminMode) return;
  if (!confirm(`Remove "${name}"? All umpire assignments for this field will be cleared.`)) return;
  const model = getScheduleModel();
  model.fields = model.fields.filter(f => f !== name);
  Object.values(model.assignments).forEach(slots => {
    Object.values(slots).forEach(timeSlot => {
      if (name in timeSlot) delete timeSlot[name];
    });
  });
  if (adminDraft) {
    adminDraft.fields = model.fields;
    adminDraft.assignments = model.assignments;
  }
  renderCurrentTab();
}

function renderFields() {
  const model = getScheduleModel();
  const list = document.getElementById('fields-list');
  const msg  = document.getElementById('no-fields-msg');
  list.innerHTML = '';
  if (model.fields.length === 0) { msg.style.display = ''; return; }
  msg.style.display = 'none';
  model.fields.forEach(name => {
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
  if (!isAdminMode) return;
  const model = getScheduleModel();
  const input = document.getElementById('new-time-input');
  const val   = input.value;
  if (!val || model.times.includes(val)) { input.value = ''; return; }
  model.times.push(val);
  model.times.sort();
  input.value = '';
  renderCurrentTab();
}

function removeTime(hhmm) {
  if (!isAdminMode) return;
  const model = getScheduleModel();
  model.times = model.times.filter(t => t !== hhmm);
  Object.values(model.assignments).forEach(slots => { delete slots[hhmm]; });
  renderCurrentTab();
}

function renderTimes() {
  const model = getScheduleModel();
  const list = document.getElementById('times-list');
  const msg  = document.getElementById('no-times-msg');
  list.innerHTML = '';
  if (model.times.length === 0) { msg.style.display = ''; return; }
  msg.style.display = 'none';
  model.times.forEach(t => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="info"><span class="name">${formatTime(t)}</span></span>
      <button class="remove-btn">Remove</button>`;
    li.querySelector('.remove-btn').addEventListener('click', () => removeTime(t));
    list.appendChild(li);
  });
}

// ── Conflict detection ─────────────────────────────────────────────────────

function isUmpConflicted(ump, dateStr, time) {
  if (ump.unavailable?.includes(dateStr)) return true;
  if (ump.teams?.length) {
    const slots = getScheduleAssignments()[dateStr]?.[time];
    if (slots) {
      for (const raw of Object.values(slots)) {
        const slot = normalizeFieldSlot(raw);
        for (const team of ump.teams) {
          const t = team.trim().toLowerCase();
          if (slot.home.trim().toLowerCase() === t ||
              slot.away.trim().toLowerCase() === t) return true;
        }
      }
    }
  }
  return false;
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

let _viewingUmpId = null;

function renderUmps() {
  if (_viewingUmpId) {
    const ump = state.umps.find(u => u.id === _viewingUmpId);
    if (ump) { showUmpDetail(ump); return; }
    _viewingUmpId = null;
  }

  document.getElementById('ump-list-view').style.display = '';
  document.getElementById('ump-detail-view').style.display = 'none';

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
        <button class="ump-name-btn">${escHtml(u.name)}</button>
        ${u.phone ? `<span class="sub">${escHtml(u.phone)}</span>` : ''}
      </span>
      <span class="game-count">${n} game${n !== 1 ? 's' : ''}</span>
      <button class="remove-btn">Remove</button>`;
    li.querySelector('.ump-name-btn').addEventListener('click', () => showUmpDetail(u));
    li.querySelector('.remove-btn').addEventListener('click', () => removeUmp(u.id));
    list.appendChild(li);
  });
}

function showUmpDetail(ump) {
  _viewingUmpId = ump.id;
  document.getElementById('ump-list-view').style.display = 'none';
  document.getElementById('ump-detail-view').style.display = '';
  document.getElementById('ump-detail-name').textContent = ump.name;

  // ── Teams datalist from schedule ──
  const teamsDl = document.getElementById('schedule-teams-list');
  teamsDl.innerHTML = '';
  getScheduleTeams().forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    teamsDl.appendChild(opt);
  });

  // ── Teams ──
  const teamsList = document.getElementById('ump-teams-list');
  teamsList.innerHTML = '';
  (ump.teams ?? []).forEach(team => {
    const chip = document.createElement('span');
    chip.className = 'ump-tag';
    chip.innerHTML = `${escHtml(team)}<button class="remove-tag-btn" title="Remove team">&times;</button>`;
    chip.querySelector('.remove-tag-btn').addEventListener('click', () => removeUmpTeam(ump.id, team));
    teamsList.appendChild(chip);
  });

  // ── Unavailable dates ──
  const unavailList = document.getElementById('ump-unavail-list');
  unavailList.innerHTML = '';
  (ump.unavailable ?? []).sort().forEach(dateStr => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const label = new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const chip = document.createElement('span');
    chip.className = 'ump-tag';
    chip.innerHTML = `${escHtml(label)}<button class="remove-tag-btn" title="Remove date">&times;</button>`;
    chip.querySelector('.remove-tag-btn').addEventListener('click', () => removeUmpUnavailable(ump.id, dateStr));
    unavailList.appendChild(chip);
  });

  // ── Schedule ──
  const content = document.getElementById('ump-detail-content');
  content.innerHTML = '';

  const assignments = [];
  Object.entries(state.assignments).forEach(([dk, day]) => {
    Object.entries(day).forEach(([time, timeSlot]) => {
      Object.entries(timeSlot).forEach(([fieldName, raw]) => {
        const slot = normalizeFieldSlot(raw);
        if (slot.ump === ump.id) assignments.push({ dk, time, fieldName, slot });
      });
    });
  });

  if (assignments.length === 0) {
    content.innerHTML = '<p class="muted" style="margin-top:0.5rem;">No games assigned yet.</p>';
    return;
  }

  assignments.sort((a, b) =>
    a.dk !== b.dk ? a.dk.localeCompare(b.dk) : a.time.localeCompare(b.time)
  );

  const byDate = {};
  assignments.forEach(a => { (byDate[a.dk] ??= []).push(a); });

  Object.entries(byDate).forEach(([dk, games]) => {
    const [y, m, d] = dk.split('-').map(Number);
    const label = new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const section = document.createElement('div');
    section.className = 'ump-schedule-day';
    const heading = document.createElement('div');
    heading.className = 'ump-schedule-date';
    heading.textContent = label;
    section.appendChild(heading);
    games.forEach(({ time, fieldName, slot }) => {
      const row = document.createElement('div');
      row.className = 'ump-schedule-row';
      const gameText = (slot.home || slot.away)
        ? `${escHtml(slot.home || '?')} vs ${escHtml(slot.away || '?')}`
        : '<span class="muted">No game info</span>';
      row.innerHTML = `
        <span class="ump-sched-time">${formatTime(time)}</span>
        <span class="ump-sched-field">${escHtml(fieldName)}</span>
        <span class="ump-sched-game">${gameText}</span>`;
      section.appendChild(row);
    });
    content.appendChild(section);
  });
}

document.getElementById('ump-back-btn').addEventListener('click', () => {
  _viewingUmpId = null;
  renderUmps();
});

// ── Team & availability helpers ────────────────────────────────────────────

function addUmpTeam(umpId, name) {
  const ump = state.umps.find(u => u.id === umpId);
  if (!ump || !name) return;
  const teams = [...(ump.teams ?? [])];
  if (teams.map(t => t.toLowerCase()).includes(name.toLowerCase())) return;
  saveUmp({ ...ump, teams: [...teams, name] });
}

function removeUmpTeam(umpId, name) {
  const ump = state.umps.find(u => u.id === umpId);
  if (!ump) return;
  saveUmp({ ...ump, teams: (ump.teams ?? []).filter(t => t !== name) });
}

function addUmpUnavailable(umpId, dateStr) {
  const ump = state.umps.find(u => u.id === umpId);
  if (!ump || !dateStr) return;
  const unavailable = [...(ump.unavailable ?? [])];
  if (unavailable.includes(dateStr)) return;
  saveUmp({ ...ump, unavailable: [...unavailable, dateStr].sort() });
}

function removeUmpUnavailable(umpId, dateStr) {
  const ump = state.umps.find(u => u.id === umpId);
  if (!ump) return;
  saveUmp({ ...ump, unavailable: (ump.unavailable ?? []).filter(d => d !== dateStr) });
}

document.getElementById('ump-add-team-btn').addEventListener('click', () => {
  const input = document.getElementById('ump-team-input');
  const name  = input.value.trim();
  if (name && _viewingUmpId) { addUmpTeam(_viewingUmpId, name); input.value = ''; }
});

document.getElementById('ump-team-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('ump-add-team-btn').click();
});

document.getElementById('ump-add-unavail-btn').addEventListener('click', () => {
  const input = document.getElementById('ump-unavail-input');
  const dateStr = input.value;
  if (dateStr && _viewingUmpId) { addUmpUnavailable(_viewingUmpId, dateStr); input.value = ''; }
});


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
  if (!isAdminMode) return;
  if (!confirm('Clear all assignments for this day?')) return;
  delete getScheduleAssignments()[currentDate];
  renderSchedule();
});

document.getElementById('copy-prev-btn').addEventListener('click', () => {
  if (!isAdminMode) return;
  const prevDate = addDays(currentDate, -7);
  const prevData = getScheduleAssignments()[prevDate];
  if (!prevData) { alert('No assignments found 7 days ago.'); return; }
  if (!confirm("Copy last week's assignments to this day?")) return;
  const copy = JSON.parse(JSON.stringify(prevData));
  getScheduleAssignments()[currentDate] = copy;
  renderSchedule();
});

document.getElementById('print-btn').addEventListener('click', () => window.print());

// ── CSV import ─────────────────────────────────────────────────────────────

document.getElementById('import-csv-btn').addEventListener('click', () => {
  if (!isAdminMode) return;
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
  const model = getScheduleModel();
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Case-insensitive exact match against known fields
  const exact = model.fields.find(f => f.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  // Normalized alias (removes spaces, dashes, underscores)
  const norm = trimmed.toLowerCase().replace(/[-_ ]/g, '');
  for (const f of model.fields) {
    if (f.toLowerCase().replace(/[-_ ]/g, '') === norm) return f;
  }
  // Common generic aliases → first/second field
  if (norm === 'field1' || norm === 'f1') return model.fields[0] ?? trimmed;
  if (norm === 'field2' || norm === 'f2') return model.fields[1] ?? trimmed;
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
    if (!isAdminMode) {
      showImportStatus('Enable Admin View to import CSV.', true);
      return;
    }
    const model = getScheduleModel();
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
      const existing = model.assignments[dateStr] ?? {};
      Object.entries(newSlots).forEach(([time, fields]) => {
        if (!existing[time]) existing[time] = {};
        Object.entries(fields).forEach(([f, teams]) => {
          const cur = normalizeFieldSlot(existing[time][f]);
          existing[time][f] = { ump: cur.ump, home: teams.home, away: teams.away };
        });
      });
      model.assignments[dateStr] = existing;
      return Promise.resolve();
    });

    // Auto-add missing times and fields
    const csvTimes  = [...new Set(Object.values(byDay).flatMap(d => Object.keys(d)))];
    const newTimes  = csvTimes.filter(t => !model.times.includes(t));
    const csvFields = [...new Set(Object.values(byDay).flatMap(d => Object.values(d).flatMap(t => Object.keys(t))))];
    const newFields = csvFields.filter(f => !model.fields.includes(f));

    if (newTimes.length || newFields.length) {
      model.times  = [...model.times,  ...newTimes].sort();
      model.fields = [...model.fields, ...newFields];
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

// ── Game edit modal ────────────────────────────────────────────────────────

let _editingSlot = null;

function openGameEditModal(dateStr, time, fieldName) {
  const slot = getFieldSlot(dateStr, time, fieldName);
  _editingSlot = { dateStr, time, fieldName };
  document.getElementById('game-home-input').value = slot.home;
  document.getElementById('game-away-input').value = slot.away;
  document.getElementById('game-edit-modal').style.display = '';
  document.getElementById('game-home-input').focus();
}

function closeGameEditModal() {
  document.getElementById('game-edit-modal').style.display = 'none';
  _editingSlot = null;
}

document.getElementById('game-edit-save').addEventListener('click', () => {
  if (!_editingSlot) return;
  const home = document.getElementById('game-home-input').value.trim();
  const away = document.getElementById('game-away-input').value.trim();
  setFieldSlot(_editingSlot.dateStr, _editingSlot.time, _editingSlot.fieldName, { home, away });
  closeGameEditModal();
  renderSchedule();
});

document.getElementById('game-edit-cancel').addEventListener('click', closeGameEditModal);
document.querySelector('#game-edit-modal .modal-overlay').addEventListener('click', closeGameEditModal);

['game-home-input', 'game-away-input'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => {
    if (e.key === 'Enter')  document.getElementById('game-edit-save').click();
    if (e.key === 'Escape') closeGameEditModal();
  });
});

// ── Schedule rendering ─────────────────────────────────────────────────────

function getScheduleTeams() {
  const teams = new Set();
  Object.values(getScheduleAssignments()).forEach(day => {
    Object.values(day).forEach(timeSlot => {
      Object.values(timeSlot).forEach(raw => {
        const slot = normalizeFieldSlot(raw);
        if (slot.home) teams.add(slot.home.trim());
        if (slot.away) teams.add(slot.away.trim());
      });
    });
  });
  return [...teams].sort((a, b) => a.localeCompare(b));
}

function buildUmpOptions(selectedId, dateStr, time) {
  let opts = '<option value="">— Unassigned —</option>';
  state.umps.forEach(u => {
    if (u.id !== selectedId && isUmpConflicted(u, dateStr, time)) return;
    opts += `<option value="${u.id}"${u.id === selectedId ? ' selected' : ''}>${escHtml(u.name)}</option>`;
  });
  return opts;
}

function buildGameCell(dateStr, time, fieldName) {
  const td   = document.createElement('td');
  td.className = 'game-cell';
  const slot = getFieldSlot(dateStr, time, fieldName);

  if (slot.home || slot.away) {
    const row = document.createElement('div');
    row.className = 'matchup-row';

    const matchup = document.createElement('div');
    matchup.className = 'matchup';
    matchup.innerHTML = `
      <span class="team">${escHtml(slot.home || '?')}</span>
      <span class="vs">vs</span>
      <span class="team">${escHtml(slot.away || '?')}</span>`;

    row.appendChild(matchup);
    if (isAdminMode) {
      const editBtn = document.createElement('button');
      editBtn.className = 'game-action-btn';
      editBtn.title = 'Edit teams';
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', () => openGameEditModal(dateStr, time, fieldName));

      const clearBtn = document.createElement('button');
      clearBtn.className = 'game-action-btn game-clear-btn';
      clearBtn.title = 'Remove game';
      clearBtn.textContent = '✕';
      clearBtn.addEventListener('click', () => {
        if (!confirm('Remove this game?')) return;
        setFieldSlot(dateStr, time, fieldName, { home: '', away: '' });
      });
      row.append(editBtn, clearBtn);
    }
    td.appendChild(row);
  } else {
    if (isAdminMode) {
      const addBtn = document.createElement('button');
      addBtn.className = 'game-add-btn';
      addBtn.textContent = '+ Add Game';
      addBtn.addEventListener('click', () => openGameEditModal(dateStr, time, fieldName));
      td.appendChild(addBtn);
    }
  }

  if (isAdminMode) {
    const umpRow = document.createElement('div');
    umpRow.className = 'ump-selection-row';

    const editUmpBtn = document.createElement('button');
    editUmpBtn.className = 'game-action-btn ump-edit-btn';
    editUmpBtn.title = 'Edit umpire assignment';
    editUmpBtn.textContent = '✎';

    const sel = document.createElement('select');
    sel.dataset.time  = time;
    sel.dataset.field = fieldName;
    sel.innerHTML = buildUmpOptions(slot.ump, dateStr, time);
    sel.classList.toggle('assigned', !!slot.ump);
    sel.disabled = true;

    editUmpBtn.addEventListener('click', () => {
      sel.disabled = false;
      editUmpBtn.classList.add('active');
      sel.focus();
    });

    sel.addEventListener('change', () => {
      setFieldSlot(dateStr, sel.dataset.time, sel.dataset.field, { ump: sel.value });
      sel.classList.toggle('assigned', !!sel.value);
      sel.disabled = true;
      editUmpBtn.classList.remove('active');
    });

    sel.addEventListener('blur', () => {
      sel.disabled = true;
      editUmpBtn.classList.remove('active');
    });

    umpRow.append(editUmpBtn, sel);
    td.appendChild(umpRow);
  } else {
    const assigned = state.umps.find(u => u.id === slot.ump)?.name ?? '';
    const readOnly = document.createElement('div');
    readOnly.className = `schedule-ump-readonly${assigned ? ' assigned' : ''}`;
    readOnly.textContent = assigned ? `Ump: ${assigned}` : 'Ump: Unassigned';
    td.appendChild(readOnly);
  }

  return td;
}

function renderSchedule() {
  const model = getScheduleModel();
  document.getElementById('schedule-date').value = currentDate;

  const thead   = document.getElementById('schedule-head');
  const tbody   = document.getElementById('schedule-body');
  const noSlots = document.getElementById('no-slots-msg');
  const table   = document.getElementById('schedule-table');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  if (model.times.length === 0 || model.fields.length === 0) {
    table.style.display   = 'none';
    noSlots.style.display = '';
    noSlots.innerHTML = model.fields.length === 0
      ? 'No fields configured. Go to <strong>Settings</strong> to add fields.'
      : 'No game times configured. Go to <strong>Settings</strong> to add time slots.';
    return;
  }
  table.style.display   = '';
  noSlots.style.display = 'none';

  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th>Time</th>' +
    model.fields.map(f => `<th>${escHtml(f)}</th>`).join('');
  thead.appendChild(headRow);

  model.times.forEach(time => {
    const tr = document.createElement('tr');

    const timeCell = document.createElement('td');
    timeCell.className   = 'time-cell';
    timeCell.textContent = formatTime(time);
    tr.appendChild(timeCell);

    model.fields.forEach(fieldName => tr.appendChild(buildGameCell(currentDate, time, fieldName)));

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
