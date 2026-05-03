'use strict';

// ── Default tasks ──────────────────────────────────────────────
const DEFAULT_TASKS = [
  { id: 'water-softener', name: 'Water Softener Salt', emoji: '🧂', intervalDays: 30, notes: 'Check salt level and refill as needed.' },
  { id: 'ac-filter', name: 'Central AC Filter', emoji: '❄️', intervalDays: 90, notes: 'Replace HVAC/furnace air filter.' },
  { id: 'water-filter', name: 'Water Filter Membrane', emoji: '💧', intervalDays: 180, notes: 'Replace RO membrane or whole-house filter.' },
  { id: 'fridge-filter', name: 'Refrigerator Water Filter', emoji: '🧊', intervalDays: 180, notes: 'Replace in-fridge water/ice filter.' },
  { id: 'furnace-filter', name: 'Furnace Filter', emoji: '🔥', intervalDays: 90, notes: 'Replace or clean furnace filter.' },
  { id: 'smoke-detector', name: 'Smoke Detector Battery', emoji: '🔋', intervalDays: 365, notes: 'Test detector and replace battery.' },
  { id: 'co-detector', name: 'CO Detector Battery', emoji: '⚠️', intervalDays: 365, notes: 'Test CO detector and replace battery.' },
  { id: 'gutter-cleaning', name: 'Gutter Cleaning', emoji: '🏠', intervalDays: 180, notes: 'Clear leaves and debris from gutters.' },
  { id: 'dryer-vent', name: 'Dryer Vent Cleaning', emoji: '🌀', intervalDays: 365, notes: 'Clean dryer vent to prevent fire hazard.' },
  { id: 'water-heater', name: 'Water Heater Flush', emoji: '♨️', intervalDays: 365, notes: 'Flush sediment from water heater tank.' },
];

const EMOJI_OPTIONS = ['🧂','💧','❄️','🔥','🧊','🏠','🌀','⚠️','🔋','♨️','🔧','🪛','🛠️','🧹','🌿','🌡️','💡','🚿','🪣','🧯'];

// ── State ──────────────────────────────────────────────────────
let state = {
  tasks: [],
  history: [],
  settings: {
    notificationsEnabled: false,
    advanceDays: 7,
    dueDateAlert: true,
  },
};

let currentView = 'dashboard';
let editingTaskId = null;
let selectedEmoji = '🔧';
let deferInstallPrompt = null;

// ── Persistence ────────────────────────────────────────────────
function save() {
  localStorage.setItem('hm_state', JSON.stringify(state));
}

function load() {
  const raw = localStorage.getItem('hm_state');
  if (raw) {
    const saved = JSON.parse(raw);
    state = { ...state, ...saved };
    state.settings = { ...state.settings, ...(saved.settings || {}) };
  } else {
    // First launch: seed with defaults, all with lastDone = null
    state.tasks = DEFAULT_TASKS.map(t => ({ ...t, lastDone: null, createdAt: Date.now() }));
    save();
  }
}

// ── Utilities ──────────────────────────────────────────────────
function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function taskStatus(task) {
  if (!task.lastDone) return { status: 'overdue', daysUntil: -Infinity, label: 'Never done', dueDateStr: '—' };
  const dueDate = addDays(task.lastDone, task.intervalDays);
  const now = today();
  const daysUntil = Math.round((dueDate - now) / 86400000);
  const dueDateStr = dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (daysUntil < 0) {
    return { status: 'overdue', daysUntil, label: `${Math.abs(daysUntil)}d overdue`, dueDateStr };
  } else if (daysUntil <= state.settings.advanceDays) {
    return { status: 'soon', daysUntil, label: daysUntil === 0 ? 'Due today' : `Due in ${daysUntil}d`, dueDateStr };
  } else {
    return { status: 'ok', daysUntil, label: `Due in ${daysUntil}d`, dueDateStr };
  }
}

function sortedTasks() {
  return [...state.tasks].sort((a, b) => {
    const sa = taskStatus(a);
    const sb = taskStatus(b);
    return sa.daysUntil - sb.daysUntil;
  });
}

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtInterval(days) {
  if (days % 365 === 0) return `${days / 365} year${days / 365 > 1 ? 's' : ''}`;
  if (days % 30 === 0) return `${days / 30} month${days / 30 > 1 ? 's' : ''}`;
  if (days % 7 === 0) return `${days / 7} week${days / 7 > 1 ? 's' : ''}`;
  return `${days} days`;
}

function genId() {
  return 'task-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

// ── Notifications ──────────────────────────────────────────────
async function requestNotifications() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  const perm = await Notification.requestPermission();
  return perm === 'granted';
}

function checkAndNotify() {
  if (!state.settings.notificationsEnabled) return;
  if (Notification.permission !== 'granted') return;
  const shownKey = 'hm_notified_' + today().toISOString().slice(0, 10);
  if (localStorage.getItem(shownKey)) return;

  const alerts = [];
  for (const task of state.tasks) {
    const { status, daysUntil } = taskStatus(task);
    if (status === 'overdue') alerts.push({ task, msg: `${task.emoji} ${task.name} is overdue!` });
    else if (status === 'soon') {
      if (daysUntil === 0 && state.settings.dueDateAlert) alerts.push({ task, msg: `${task.emoji} ${task.name} is due today!` });
      else if (daysUntil > 0) alerts.push({ task, msg: `${task.emoji} ${task.name} is due in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}.` });
    }
  }

  if (alerts.length === 0) return;
  localStorage.setItem(shownKey, '1');

  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    const title = alerts.length === 1 ? 'Maintenance Reminder' : `${alerts.length} Maintenance Tasks Need Attention`;
    const body = alerts.length === 1 ? alerts[0].msg : alerts.map(a => a.msg).join('\n');
    navigator.serviceWorker.controller.postMessage({ type: 'NOTIFY', title, body });
  } else {
    alerts.slice(0, 3).forEach(a => {
      new Notification('Maintenance Reminder', { body: a.msg, icon: '/icon-192.png' });
    });
  }
}

// ── Navigation ─────────────────────────────────────────────────
function navigate(view, taskId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  currentView = view;

  if (view === 'dashboard') {
    document.getElementById('view-dashboard').classList.add('active');
    document.querySelector('[data-nav="dashboard"]').classList.add('active');
    setHeader('dashboard');
    renderDashboard();
  } else if (view === 'detail') {
    document.getElementById('view-detail').classList.add('active');
    setHeader('detail');
    renderDetail(taskId);
  } else if (view === 'add-task') {
    document.getElementById('view-add').classList.add('active');
    setHeader('add-task', taskId);
    renderAddForm(taskId);
  } else if (view === 'history') {
    document.getElementById('view-history').classList.add('active');
    document.querySelector('[data-nav="history"]').classList.add('active');
    setHeader('history');
    renderHistory();
  } else if (view === 'settings') {
    document.getElementById('view-settings').classList.add('active');
    document.querySelector('[data-nav="settings"]').classList.add('active');
    setHeader('settings');
    renderSettings();
  }
}

function setHeader(view, taskId) {
  const header = document.getElementById('app-header');
  if (view === 'dashboard') {
    header.innerHTML = `
      <h1>🏠 Home Maintenance</h1>
      <div class="header-actions">
        <button class="icon-btn" onclick="navigate('add-task')" title="Add Task">+</button>
      </div>`;
  } else if (view === 'detail') {
    header.innerHTML = `
      <button class="back-btn" onclick="navigate('dashboard')">‹ Back</button>
      <span class="header-title">Task Detail</span>
      <div></div>`;
  } else if (view === 'add-task') {
    const isEdit = !!taskId;
    header.innerHTML = `
      <button class="back-btn" onclick="navigate(${isEdit ? "'detail'" : "'dashboard'"}, '${taskId || ''}')">‹ Back</button>
      <span class="header-title">${isEdit ? 'Edit Task' : 'Add Task'}</span>
      <div></div>`;
  } else if (view === 'history') {
    header.innerHTML = `<h1>History</h1><div></div>`;
  } else if (view === 'settings') {
    header.innerHTML = `<h1>Settings</h1><div></div>`;
  }
}

// ── Dashboard ──────────────────────────────────────────────────
function renderDashboard() {
  const tasks = sortedTasks();
  const overdue = tasks.filter(t => taskStatus(t).status === 'overdue');
  const soon = tasks.filter(t => taskStatus(t).status === 'soon');
  const ok = tasks.filter(t => taskStatus(t).status === 'ok');

  const installBanner = !isInstalled()
    ? `<div class="install-banner show" id="install-banner">
        <p>📲 Add to Home Screen in Safari for the best experience & notifications.</p>
        <button class="install-x" onclick="document.getElementById('install-banner').style.display='none'">✕</button>
       </div>`
    : '';

  let html = installBanner;
  html += `<div class="summary-bar">
    <div class="summary-card overdue"><div class="count">${overdue.length}</div><div class="label">Overdue</div></div>
    <div class="summary-card soon"><div class="count">${soon.length}</div><div class="label">Due Soon</div></div>
    <div class="summary-card ok"><div class="count">${ok.length}</div><div class="label">On Track</div></div>
  </div>`;

  if (tasks.length === 0) {
    html += `<div class="empty-state"><div class="empty-icon">🛠️</div><h3>No tasks yet</h3><p>Tap the + button to add your first maintenance task.</p></div>`;
  } else {
    if (overdue.length) {
      html += `<div class="section-title">⚠️ Overdue</div>`;
      overdue.forEach(t => html += taskCardHtml(t));
    }
    if (soon.length) {
      html += `<div class="section-title">⏰ Due Soon</div>`;
      soon.forEach(t => html += taskCardHtml(t));
    }
    if (ok.length) {
      html += `<div class="section-title">✅ On Track</div>`;
      ok.forEach(t => html += taskCardHtml(t));
    }
  }

  document.getElementById('view-dashboard').innerHTML = html;
}

function taskCardHtml(task) {
  const { status, label } = taskStatus(task);
  const badgeClass = { overdue: 'badge-overdue', soon: 'badge-soon', ok: 'badge-ok' }[status];
  const lastStr = task.lastDone ? `Last done ${fmtDate(task.lastDone)}` : 'Never completed';
  return `<div class="task-card status-${status}" onclick="navigate('detail','${task.id}')">
    <span class="task-emoji">${task.emoji}</span>
    <div class="task-info">
      <div class="task-name">${task.name}</div>
      <div class="task-meta">${lastStr} · Every ${fmtInterval(task.intervalDays)}</div>
    </div>
    <span class="task-badge ${badgeClass}">${label}</span>
  </div>`;
}

// ── Detail ─────────────────────────────────────────────────────
function renderDetail(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) { navigate('dashboard'); return; }
  const { status, label, dueDateStr } = taskStatus(task);

  const statusIcon = { overdue: '🚨', soon: '⏰', ok: '✅' }[status];
  const taskHistory = state.history.filter(h => h.taskId === taskId).slice(-10).reverse();

  let histHtml = '';
  if (taskHistory.length === 0) {
    histHtml = '<p style="color:var(--gray-500);font-size:14px;text-align:center;padding:12px 0">No completions recorded yet.</p>';
  } else {
    taskHistory.forEach(h => {
      histHtml += `<div class="history-item">
        <div class="history-dot"></div>
        <div class="history-text">Marked complete</div>
        <div class="history-date">${fmtDate(h.completedAt)}</div>
      </div>`;
    });
  }

  document.getElementById('view-detail').innerHTML = `
    <div class="status-banner ${status}">${statusIcon} ${status === 'overdue' ? (task.lastDone ? label : 'Never done — needs attention!') : label}</div>

    <div class="detail-card">
      <div style="font-size:40px;text-align:center;margin-bottom:8px">${task.emoji}</div>
      <div style="font-size:20px;font-weight:800;text-align:center;margin-bottom:14px">${task.name}</div>
      <div class="info-row"><span class="info-label">Interval</span><span class="info-value">Every ${fmtInterval(task.intervalDays)}</span></div>
      <div class="info-row"><span class="info-label">Last Done</span><span class="info-value">${fmtDate(task.lastDone)}</span></div>
      <div class="info-row"><span class="info-label">Next Due</span><span class="info-value">${dueDateStr}</span></div>
      ${task.notes ? `<div class="info-row" style="flex-direction:column;align-items:flex-start;gap:4px"><span class="info-label">Notes</span><span style="font-size:14px;color:var(--gray-700)">${task.notes}</span></div>` : ''}
    </div>

    <button class="btn btn-success" onclick="markDone('${taskId}')">✓ Mark as Complete — Done Today</button>
    <button class="btn btn-ghost" onclick="toggleDatePicker()" style="color:var(--blue)">📅 Mark Done on a Different Date</button>
    <div id="date-picker-section" style="display:none;margin-bottom:10px">
      <div class="detail-card" style="margin-bottom:0">
        <div class="form-label" style="margin-bottom:8px;font-size:14px">Date of Maintenance</div>
        <input type="date" class="form-input" id="custom-date-input" max="${todayStr()}">
        <button class="btn btn-success" style="margin-top:12px;margin-bottom:0" onclick="markDoneOnDate('${taskId}')">✓ Confirm This Date</button>
      </div>
    </div>
    <button class="btn btn-primary" onclick="navigate('add-task','${taskId}')">✏️ Edit Task</button>
    <button class="btn btn-ghost" onclick="confirmDelete('${taskId}')">🗑️ Delete Task</button>

    <div class="detail-card" style="margin-top:6px">
      <div class="detail-title">Completion History</div>
      ${histHtml}
    </div>`;
}

function markDone(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.lastDone = Date.now();
  state.history.push({ taskId, completedAt: Date.now() });
  save();
  renderDetail(taskId);
}

function toggleDatePicker() {
  const section = document.getElementById('date-picker-section');
  if (!section) return;
  const isHidden = section.style.display === 'none' || section.style.display === '';
  section.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    // Pre-fill with today's date and focus the input
    const inp = document.getElementById('custom-date-input');
    if (inp) { inp.value = todayStr(); inp.focus(); }
  }
}

function markDoneOnDate(taskId) {
  const inp = document.getElementById('custom-date-input');
  if (!inp || !inp.value) { alert('Please select a date.'); return; }
  // Parse at noon local time to avoid timezone boundary issues
  const ts = new Date(inp.value + 'T12:00:00').getTime();
  if (isNaN(ts)) { alert('Invalid date selected.'); return; }
  if (ts > Date.now()) { alert('Date cannot be in the future.'); return; }
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.lastDone = ts;
  state.history.push({ taskId, completedAt: ts });
  save();
  renderDetail(taskId);
}

function confirmDelete(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  if (confirm(`Delete "${task.name}"? This cannot be undone.`)) {
    state.tasks = state.tasks.filter(t => t.id !== taskId);
    state.history = state.history.filter(h => h.taskId !== taskId);
    save();
    navigate('dashboard');
  }
}

// ── Add / Edit Form ────────────────────────────────────────────
function renderAddForm(taskId) {
  editingTaskId = taskId || null;
  const task = taskId ? state.tasks.find(t => t.id === taskId) : null;

  const name = task ? task.name : '';
  const notes = task ? (task.notes || '') : '';
  const interval = task ? task.intervalDays : 90;
  selectedEmoji = task ? task.emoji : '🔧';

  const emojiGrid = EMOJI_OPTIONS.map(e =>
    `<div class="emoji-option ${e === selectedEmoji ? 'selected' : ''}" onclick="selectEmoji('${e}',this)">${e}</div>`
  ).join('');

  document.getElementById('view-add').innerHTML = `
    <div class="form-group">
      <label class="form-label">Task Name</label>
      <input class="form-input" id="inp-name" type="text" placeholder="e.g. Water Softener Salt" value="${name}" maxlength="50">
    </div>

    <div class="form-group">
      <label class="form-label">Icon</label>
      <div class="emoji-grid">${emojiGrid}</div>
    </div>

    <div class="form-group">
      <label class="form-label">Repeat Interval</label>
      <select class="form-select" id="inp-interval-unit" onchange="syncIntervalUnit()">
        <option value="days">Days</option>
        <option value="weeks">Weeks</option>
        <option value="months">Months</option>
        <option value="years">Years</option>
      </select>
      <div style="margin-top:10px;display:flex;align-items:center;gap:12px">
        <button class="stepper-btn" onclick="stepInterval(-1)">−</button>
        <span class="stepper-val" id="interval-display">1</span>
        <button class="stepper-btn" onclick="stepInterval(1)">+</button>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Notes <span style="color:var(--gray-400);font-weight:400">(optional)</span></label>
      <input class="form-input" id="inp-notes" type="text" placeholder="Parts needed, tips, etc." value="${notes}" maxlength="120">
    </div>

    <button class="btn btn-primary" onclick="saveTask()">${task ? '💾 Save Changes' : '➕ Add Task'}</button>`;

  // Set interval unit and value from existing task
  setIntervalDisplay(interval);
}

let _intervalDays = 90;

function setIntervalDisplay(days) {
  _intervalDays = days;
  const sel = document.getElementById('inp-interval-unit');
  const disp = document.getElementById('interval-display');
  if (!sel || !disp) return;

  if (days % 365 === 0) { sel.value = 'years'; disp.textContent = days / 365; }
  else if (days % 30 === 0) { sel.value = 'months'; disp.textContent = days / 30; }
  else if (days % 7 === 0) { sel.value = 'weeks'; disp.textContent = days / 7; }
  else { sel.value = 'days'; disp.textContent = days; }
}

function syncIntervalUnit() {
  const sel = document.getElementById('inp-interval-unit');
  const disp = document.getElementById('interval-display');
  const unit = sel.value;
  let val = parseInt(disp.textContent) || 1;
  // Convert current days to new unit
  if (unit === 'years') val = Math.max(1, Math.round(_intervalDays / 365));
  else if (unit === 'months') val = Math.max(1, Math.round(_intervalDays / 30));
  else if (unit === 'weeks') val = Math.max(1, Math.round(_intervalDays / 7));
  else val = Math.max(1, _intervalDays);
  disp.textContent = val;
  updateIntervalDays();
}

function stepInterval(delta) {
  const disp = document.getElementById('interval-display');
  let val = (parseInt(disp.textContent) || 1) + delta;
  if (val < 1) val = 1;
  if (val > 999) val = 999;
  disp.textContent = val;
  updateIntervalDays();
}

function updateIntervalDays() {
  const sel = document.getElementById('inp-interval-unit');
  const disp = document.getElementById('interval-display');
  const val = parseInt(disp.textContent) || 1;
  const unit = sel ? sel.value : 'days';
  if (unit === 'years') _intervalDays = val * 365;
  else if (unit === 'months') _intervalDays = val * 30;
  else if (unit === 'weeks') _intervalDays = val * 7;
  else _intervalDays = val;
}

function selectEmoji(emoji, el) {
  document.querySelectorAll('.emoji-option').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  selectedEmoji = emoji;
}

function saveTask() {
  const name = document.getElementById('inp-name').value.trim();
  if (!name) { alert('Please enter a task name.'); return; }
  updateIntervalDays();
  const notes = document.getElementById('inp-notes').value.trim();

  if (editingTaskId) {
    const task = state.tasks.find(t => t.id === editingTaskId);
    if (task) {
      task.name = name;
      task.emoji = selectedEmoji;
      task.intervalDays = _intervalDays;
      task.notes = notes;
    }
  } else {
    state.tasks.push({
      id: genId(),
      name,
      emoji: selectedEmoji,
      intervalDays: _intervalDays,
      lastDone: null,
      notes,
      createdAt: Date.now(),
    });
  }
  save();
  navigate(editingTaskId ? 'detail' : 'dashboard', editingTaskId);
}

// ── History ────────────────────────────────────────────────────
function renderHistory() {
  const allHistory = [...state.history].reverse();
  let html = '';
  if (allHistory.length === 0) {
    html = `<div class="empty-state"><div class="empty-icon">📋</div><h3>No history yet</h3><p>Complete a task to start building your history.</p></div>`;
  } else {
    const grouped = {};
    allHistory.forEach(h => {
      const task = state.tasks.find(t => t.id === h.taskId);
      const name = task ? task.name : 'Deleted Task';
      const emoji = task ? task.emoji : '🗑️';
      const dateKey = new Date(h.completedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      if (!grouped[dateKey]) grouped[dateKey] = [];
      grouped[dateKey].push({ name, emoji, completedAt: h.completedAt });
    });

    for (const [month, entries] of Object.entries(grouped)) {
      html += `<div class="section-title">${month}</div>`;
      html += `<div class="detail-card" style="padding:0 16px">`;
      entries.forEach(e => {
        html += `<div class="history-item">
          <span style="font-size:20px">${e.emoji}</span>
          <div class="history-text">${e.name}</div>
          <div class="history-date">${fmtDate(e.completedAt)}</div>
        </div>`;
      });
      html += `</div>`;
    }
  }
  document.getElementById('view-history').innerHTML = html;
}

// ── Settings ───────────────────────────────────────────────────
function renderSettings() {
  const s = state.settings;
  document.getElementById('view-settings').innerHTML = `
    <div class="settings-section">
      <div class="settings-row">
        <div>
          <div class="settings-row-label">Notifications</div>
          <div class="settings-row-sub">Show alerts when tasks are due</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="toggle-notif" ${s.notificationsEnabled ? 'checked' : ''} onchange="toggleNotifications(this)">
          <div class="toggle-track"></div>
        </label>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">Advance Warning</div>
          <div class="settings-row-sub">Days before due date to alert</div>
        </div>
        <div class="stepper">
          <button class="stepper-btn" onclick="changeAdvanceDays(-1)">−</button>
          <span class="stepper-val" id="advance-days-val">${s.advanceDays}</span>
          <button class="stepper-btn" onclick="changeAdvanceDays(1)">+</button>
        </div>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">Due-Date Alert</div>
          <div class="settings-row-sub">Also alert on the exact due date</div>
        </div>
        <label class="toggle">
          <input type="checkbox" id="toggle-duedate" ${s.dueDateAlert ? 'checked' : ''} onchange="toggleDueDateAlert(this)">
          <div class="toggle-track"></div>
        </label>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-row" style="flex-direction:column;align-items:flex-start">
        <div class="settings-row-label">📲 Install on iPhone</div>
        <div class="settings-row-sub" style="margin-top:4px">Open this app in <strong>Safari</strong>, tap the Share button (□↑), then choose <strong>"Add to Home Screen"</strong>. After installing, grant notification permission when prompted.</div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-row" onclick="clearHistory()" style="cursor:pointer">
        <div class="settings-row-label" style="color:var(--red)">Clear All History</div>
      </div>
      <div class="settings-row" onclick="resetTasks()" style="cursor:pointer">
        <div class="settings-row-label" style="color:var(--red)">Reset to Default Tasks</div>
      </div>
    </div>

    <p style="text-align:center;font-size:13px;color:var(--gray-400);margin-top:16px">All data stored locally on this device.</p>`;
}

async function toggleNotifications(el) {
  if (el.checked) {
    const granted = await requestNotifications();
    state.settings.notificationsEnabled = granted;
    if (!granted) {
      el.checked = false;
      alert('Notification permission was denied. Please enable it in Settings → Safari (or your browser settings).');
    }
  } else {
    state.settings.notificationsEnabled = false;
  }
  save();
}

function toggleDueDateAlert(el) {
  state.settings.dueDateAlert = el.checked;
  save();
}

function changeAdvanceDays(delta) {
  let val = state.settings.advanceDays + delta;
  if (val < 1) val = 1;
  if (val > 30) val = 30;
  state.settings.advanceDays = val;
  document.getElementById('advance-days-val').textContent = val;
  save();
}

function clearHistory() {
  if (confirm('Clear all completion history? This cannot be undone.')) {
    state.history = [];
    save();
    renderSettings();
  }
}

function resetTasks() {
  if (confirm('Replace all tasks with defaults? Your current tasks and history will be removed.')) {
    state.tasks = DEFAULT_TASKS.map(t => ({ ...t, lastDone: null, createdAt: Date.now() }));
    state.history = [];
    save();
    navigate('dashboard');
  }
}

// ── PWA install detection ──────────────────────────────────────
function isInstalled() {
  return window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
}

// ── Service Worker ─────────────────────────────────────────────
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch (e) {
    console.warn('SW registration failed', e);
  }
}

// ── Boot ───────────────────────────────────────────────────────
function boot() {
  load();
  registerSW();

  // Wire bottom nav
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.nav));
  });

  navigate('dashboard');

  // Check and notify after a short delay
  setTimeout(checkAndNotify, 1500);
}

document.addEventListener('DOMContentLoaded', boot);
