'use strict';

// ── State ──────────────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  gameDay: 3,           // 0=Sun … 6=Sat; default Wednesday
  field1Name: 'Field 1',
  field2Name: 'Field 2',
  times: [],            // sorted "HH:MM" strings
  umps: [],             // [{ id, name, phone }]
  // assignments: { "YYYY-MM-DD": { "HH:MM": { f1: umpId|"", f2: umpId|"" } } }
  assignments: {},
};

let state = loadState();
let currentWeekStart = getGameDayDate(new Date(), state.gameDay);

// ── Persistence ────────────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem('umpScheduler');
    return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : { ...DEFAULT_STATE };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState() {
  localStorage.setItem('umpScheduler', JSON.stringify(state));
}

// ── Date helpers ───────────────────────────────────────────────────────────

// Returns the Date of the nearest upcoming (or same-day) occurrence of dayOfWeek
// relative to `from`, then steps by `weekOffset` weeks.
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
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, '0')} ${period}`;
}

// ── Tab switching ──────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'schedule') renderSchedule();
    if (btn.dataset.tab === 'umps') renderUmps();
  });
});

// ── Settings Tab ───────────────────────────────────────────────────────────

const gameDaySelect = document.getElementById('game-day-select');
const field1Input   = document.getElementById('field1-name');
const field2Input   = document.getElementById('field2-name');
const newTimeInput  = document.getElementById('new-time-input');

function initSettings() {
  gameDaySelect.value = state.gameDay;
  field1Input.value   = state.field1Name;
  field2Input.value   = state.field2Name;
  renderTimes();
}

gameDaySelect.addEventListener('change', () => {
  state.gameDay = parseInt(gameDaySelect.value, 10);
  currentWeekStart = getGameDayDate(new Date(), state.gameDay);
  saveState();
});

document.getElementById('save-fields-btn').addEventListener('click', () => {
  const n1 = field1Input.value.trim() || 'Field 1';
  const n2 = field2Input.value.trim() || 'Field 2';
  state.field1Name = n1;
  state.field2Name = n2;
  saveState();
  document.getElementById('field1-header').textContent = n1;
  document.getElementById('field2-header').textContent = n2;
  field1Input.value = n1;
  field2Input.value = n2;
});

document.getElementById('add-time-btn').addEventListener('click', addTime);
newTimeInput.addEventListener('keydown', e => { if (e.key === 'Enter') addTime(); });

function addTime() {
  const val = newTimeInput.value;
  if (!val) return;
  if (state.times.includes(val)) { newTimeInput.value = ''; return; }
  state.times.push(val);
  state.times.sort();
  saveState();
  newTimeInput.value = '';
  renderTimes();
}

function removeTime(hhmm) {
  state.times = state.times.filter(t => t !== hhmm);
  // Remove assignments for this time across all days
  Object.values(state.assignments).forEach(day => { delete day[hhmm]; });
  saveState();
  renderTimes();
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
      <button class="remove-btn" data-time="${t}">Remove</button>`;
    li.querySelector('.remove-btn').addEventListener('click', () => removeTime(t));
    list.appendChild(li);
  });
}

// ── Umpires Tab ────────────────────────────────────────────────────────────

const umpNameInput  = document.getElementById('ump-name-input');
const umpPhoneInput = document.getElementById('ump-phone-input');

document.getElementById('add-ump-btn').addEventListener('click', addUmp);
umpNameInput.addEventListener('keydown', e => { if (e.key === 'Enter') addUmp(); });

function addUmp() {
  const name = umpNameInput.value.trim();
  if (!name) return;
  const phone = umpPhoneInput.value.trim();
  const id = `ump_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  state.umps.push({ id, name, phone });
  saveState();
  umpNameInput.value  = '';
  umpPhoneInput.value = '';
  umpNameInput.focus();
  renderUmps();
}

function removeUmp(id) {
  if (!confirm('Remove this umpire? Their assignments will be cleared.')) return;
  state.umps = state.umps.filter(u => u.id !== id);
  // Clear assignments for this ump
  Object.values(state.assignments).forEach(day => {
    Object.values(day).forEach(slot => {
      if (slot.f1 === id) slot.f1 = '';
      if (slot.f2 === id) slot.f2 = '';
    });
  });
  saveState();
  renderUmps();
  renderSchedule();
}

function countAssignments(umpId) {
  let count = 0;
  Object.values(state.assignments).forEach(day => {
    Object.values(day).forEach(slot => {
      if (slot.f1 === umpId) count++;
      if (slot.f2 === umpId) count++;
    });
  });
  return count;
}

function renderUmps() {
  const list = document.getElementById('ump-list');
  const msg  = document.getElementById('no-umps-msg');
  list.innerHTML = '';
  if (state.umps.length === 0) { msg.style.display = ''; return; }
  msg.style.display = 'none';
  state.umps.forEach(u => {
    const games = countAssignments(u.id);
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="info">
        <span class="name">${escHtml(u.name)}</span>
        ${u.phone ? `<span class="sub">${escHtml(u.phone)}</span>` : ''}
      </span>
      <span class="game-count">${games} game${games !== 1 ? 's' : ''}</span>
      <button class="remove-btn" data-id="${u.id}">Remove</button>`;
    li.querySelector('.remove-btn').addEventListener('click', () => removeUmp(u.id));
    list.appendChild(li);
  });
}

// ── Schedule Tab ───────────────────────────────────────────────────────────

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
  delete state.assignments[dateKey(currentWeekStart)];
  saveState();
  renderSchedule();
});

document.getElementById('copy-prev-btn').addEventListener('click', () => {
  const prevDate  = getGameDayDate(currentWeekStart, state.gameDay, -1);
  const prevKey   = dateKey(prevDate);
  const curKey    = dateKey(currentWeekStart);
  const prevData  = state.assignments[prevKey];
  if (!prevData) { alert('No assignments found for the previous game day.'); return; }
  if (!confirm('Copy previous week\'s umpire assignments to this week?')) return;
  state.assignments[curKey] = JSON.parse(JSON.stringify(prevData));
  saveState();
  renderSchedule();
});

document.getElementById('print-btn').addEventListener('click', () => window.print());

function getAssignment(dayKey, time) {
  return state.assignments[dayKey]?.[time] ?? { f1: '', f2: '' };
}

function setAssignment(dayKey, time, field, umpId) {
  if (!state.assignments[dayKey]) state.assignments[dayKey] = {};
  if (!state.assignments[dayKey][time]) state.assignments[dayKey][time] = { f1: '', f2: '' };
  state.assignments[dayKey][time][field] = umpId;
  saveState();
}

function buildUmpOptions(selectedId) {
  let opts = '<option value="">— Unassigned —</option>';
  state.umps.forEach(u => {
    opts += `<option value="${u.id}"${u.id === selectedId ? ' selected' : ''}>${escHtml(u.name)}</option>`;
  });
  return opts;
}

function renderSchedule() {
  // Sync field headers
  document.getElementById('field1-header').textContent = state.field1Name;
  document.getElementById('field2-header').textContent = state.field2Name;

  // Make sure currentWeekStart is on the correct day of week
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
    const asgn = getAssignment(dayKey, time);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="time-cell">${formatTime(time)}</td>
      <td>
        <select data-time="${time}" data-field="f1">
          ${buildUmpOptions(asgn.f1)}
        </select>
      </td>
      <td>
        <select data-time="${time}" data-field="f2">
          ${buildUmpOptions(asgn.f2)}
        </select>
      </td>`;

    tr.querySelectorAll('select').forEach(sel => {
      if (sel.value) sel.classList.add('assigned');
      sel.addEventListener('change', () => {
        setAssignment(dayKey, sel.dataset.time, sel.dataset.field, sel.value);
        sel.classList.toggle('assigned', !!sel.value);
        if (document.querySelector('.tab[data-tab="umps"]').classList.contains('active')) {
          renderUmps();
        }
      });
    });

    tbody.appendChild(tr);
  });
}

// ── Utilities ──────────────────────────────────────────────────────────────

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ───────────────────────────────────────────────────────────────────

initSettings();
renderSchedule();
