// ── AUTH GUARD ──
(function () {
  if (!localStorage.getItem('pk24_token')) {
    location.replace('/login.html');
  }
})();
const _d = localStorage.getItem('pk24_design') || 'v1';
const _s = localStorage.getItem('pk24_color_scheme') || 'dark';
if (_d === 'v2') document.documentElement.setAttribute('data-design', 'v2');
document.documentElement.setAttribute('data-color-scheme', _s);
if (_d === 'v2') {
  document.documentElement.setAttribute('data-theme', _s === 'light' ? 'light' : 'dark');
}
// ============================================
// CONSTANTS
// ============================================
const COLS = [{ id: 'backlog', label: 'Backlog' }, { id: 'todo', label: 'To Do' }, { id: 'inprogress', label: 'In Progress' }, { id: 'review', label: 'Review' }, { id: 'done', label: 'Done' }];
const TOTAL_BUDGET = 0; /* only fallback; real value from active project */
const SC = { A: '#4a9eff', R1: '#a78bfa', 'R1.1': '#fb923c', R2: '#f87171', 'R2+': '#f87171', 'R3+': '#4ade80', 'R4+': '#4ade80', F: '#22d3ee' };
const SZC = { XS: '#6B7280', S: '#3B82F6', M: '#10B981', L: '#F59E0B', XL: '#EF4444' };
const AGC = {
  'Backend': '#f0a500',
  'Frontend': '#4a9eff',
  'DevOps': '#22d3ee',
  'QA': '#a78bfa',
  'Design': '#f472b6',
  'Security': '#f87171',
  'Integrations': '#34d399',
  'Search': '#fbbf24',
  'BOM': '#fb923c',
  'LLM': '#c084fc',
  'Analytics': '#4ade80',
  'Admin': '#94a3b8',
  'PM': '#e2e8f0',
  'Без агента': '#6B7280'
};
const AGENT_MODEL = {
  'Backend': 'Claude Code',
  'Frontend': 'Cursor',
  'DevOps': 'Cursor',
  'QA': 'Codex',
  'Design': 'v0.dev',
  'Security': 'Claude Code',
  'Integrations': 'Claude Code',
  'Search': 'Claude Code',
  'BOM': 'Claude Code',
  'LLM': 'Claude Code',
  'Analytics': 'Codex',
  'Admin': 'Cursor',
  'PM': 'Claude Code'
};
function getAgentColor(agentName) {
  if (typeof getAgentColorFromProject === 'function') {
    const c = getAgentColorFromProject(agentName);
    if (c) return c;
  }
  return AGC[agentName] || '#6B7280';
}
function getStageColor(stage) {
  if (!stage) return '#6B7280';
  return typeof getStageColorFromProject === 'function' ? (getStageColorFromProject(stage) || '#6B7280') : '#6B7280';
}
function getStatusColor(col) {
  const c = col === 'inprogress' || col === 'in_progress' ? 'doing' : (col || '').toLowerCase();
  const map = { backlog: '#EF4444', todo: '#8B5CF6', doing: '#F59E0B', review: '#3B82F6', done: '#10B981' };
  return map[c] || '#6B7280';
}
function getPriorityColor(priority) {
  if (typeof getPriorityColorFromProject === 'function') {
    const c = getPriorityColorFromProject(priority);
    if (c) return c;
  }
  const p = priority === undefined || priority === null ? '' : String(priority).toLowerCase().trim();
  const num = Number(priority);
  if (num === 1 || p === 'low') return '#6B7280';
  if (num === 2 || p === 'medium') return '#3B82F6';
  if (num === 3 || p === 'high') return '#F59E0B';
  if (num === 4 || p === 'critical') return '#EF4444';
  return '#6B7280';
}
function getSizeColor(size) {
  if (typeof getSizeColorFromProject === 'function') {
    const c = getSizeColorFromProject(size);
    if (c) return c;
  }
  return SZC[String(size || 'M').toUpperCase()] || '#6B7280';
}
const STAB_C = { 'all': null, A: '#6366F1', R1: '#3B82F6', 'R1.1': '#3B82F6', R2: '#8B5CF6', 'R2+': '#8B5CF6', 'R3+': '#EC4899', 'R4+': '#EC4899', F: '#10B981' };

// -- DnD state (declared early so all functions can reference) --
let dragId = null, isDragging = false, dragSourceCol = null;

const GREETINGS = ['Привет! Что нужно сделать?', 'Здравствуйте! Какую задачу обсудим?', 'Привет, Николай. Что ставим сегодня?', 'Готов к работе. Опишите задачу.', 'Слушаю. Что нужно реализовать?'];
const DEFAULT_TASKS = [];
// ============================================
// STATE
// ============================================
function getTasksKey(projId) { return 'tasks_' + projId; }
function loadTasksForProject(projId) {
  if (!projId) return [];
  try {
    const s = localStorage.getItem(getTasksKey(projId));
    if (s) return JSON.parse(s);
  } catch (e) { }
  return DEFAULT_TASKS.map(t => ({ ...t }));
}
function loadTasks() { return loadTasksForProject(loadActiveProject()); }
function save() { if (!activeProjId) return; try { localStorage.setItem(getTasksKey(activeProjId), JSON.stringify(tasks)); } catch (e) { } }

let tasks = loadTasks(), curStage = 'all', searchQ = '', activeId = null, chatHist = [], ntHist = [], pendingTask = null, newTaskCol = 'backlog';

// ============================================
// THEME (синхронизировано с Профиль→Настройки→Тема и кнопкой в хедере)
// ============================================
let theme = localStorage.getItem('mossb_theme') || 'dark';
function resolveEffectiveTheme() {
  var t = localStorage.getItem('mossb_theme') || 'dark';
  if (t === 'system') {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
  }
  return t;
}
function applyTheme() {
  var eff = resolveEffectiveTheme();
  document.documentElement.setAttribute('data-theme', eff);
  var btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = eff === 'dark' ? '☀️' : '🌙';
  theme = localStorage.getItem('mossb_theme') || 'dark';
  if (typeof updateStageTabs === 'function') updateStageTabs();
}
function toggleTheme() {
  var eff = resolveEffectiveTheme();
  theme = eff === 'dark' ? 'light' : 'dark';
  localStorage.setItem('mossb_theme', theme); applyTheme();
}
applyTheme();
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change', function () { if ((localStorage.getItem('mossb_theme') || 'dark') === 'system') applyTheme(); });
}

// ============================================
// TIMER
// ============================================
let timerRunning = false, delayRunning = false;
let projMs = parseInt(localStorage.getItem('mossb_proj_ms')) || 0;
let delMs = parseInt(localStorage.getItem('mossb_del_ms')) || 0;
// timerMode: 'stopped' | 'project' | 'delay'
let timerMode = localStorage.getItem('mossb_timer_mode') || 'stopped';
// wallStart: epoch ms when current running period began (to calc elapsed since last save)
let timerWall = parseInt(localStorage.getItem('mossb_timer_wall')) || 0;
let projStart = null, delStart = null, timerInt = null;

function saveTimerState() {
  localStorage.setItem('mossb_timer_mode', timerMode);
  localStorage.setItem('mossb_timer_wall', timerMode === 'stopped' ? 0 : Date.now());
  localStorage.setItem('mossb_proj_ms', projMs);
  localStorage.setItem('mossb_del_ms', delMs);
}

function applyTimerUI() {
  const btn = document.getElementById('btn-timer');
  const dc = document.getElementById('delay-chip');
  if (timerMode === 'project') {
    btn.textContent = '⏸ Стоп'; btn.classList.add('running');
    dc.classList.add('hidden');
  } else if (timerMode === 'delay') {
    btn.textContent = '▶ Старт'; btn.classList.remove('running');
    dc.classList.remove('hidden');
  } else {
    btn.textContent = '▶ Старт'; btn.classList.remove('running');
    dc.classList.add('hidden');
  }
}

function toggleTimer() {
  const dc = document.getElementById('delay-chip');
  if (timerMode === 'stopped') {
    // Start project timer
    timerMode = 'project';
    timerRunning = true; delayRunning = false;
    projStart = Date.now() - projMs;
    timerInt = setInterval(tickTimer, 1000);
  } else if (timerMode === 'project') {
    // Stop project -> start delay
    timerRunning = false;
    projMs = Date.now() - projStart;
    clearInterval(timerInt);
    timerMode = 'delay';
    delayRunning = true;
    delStart = Date.now() - delMs;
    timerInt = setInterval(tickTimer, 1000);
  } else {
    // Stop delay -> resume project
    delayRunning = false;
    delMs = Date.now() - delStart;
    clearInterval(timerInt);
    timerMode = 'project';
    timerRunning = true;
    projStart = Date.now() - projMs;
    timerInt = setInterval(tickTimer, 1000);
  }
  saveTimerState();
  applyTimerUI();
}

function tickTimer() {
  if (timerRunning) { projMs = Date.now() - projStart; localStorage.setItem('mossb_proj_ms', projMs); paintProj(projMs); }
  if (delayRunning) { delMs = Date.now() - delStart; localStorage.setItem('mossb_del_ms', delMs); paintDel(delMs); }
}

function paintProj(ms) {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60;
  const totalDays = Math.floor(sec / 86400);
  const weeks = Math.floor(totalDays / 7);
  const dayOfWeek = totalDays % 7;
  const wEl = document.getElementById('t-weeks');
  wEl.textContent = weeks;
  const pct = weeks / 50;
  wEl.className = 'tc-val' + (pct > 0.85 ? ' danger' : pct > 0.65 ? ' warn' : '');
  document.getElementById('t-days').textContent = dayOfWeek;
  document.getElementById('t-time').textContent = pad(h) + ':' + pad(m);
}
function paintDel(ms) {
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60;
  const totalDays = Math.floor(sec / 86400);
  const weeks = Math.floor(totalDays / 7);
  const dayOfWeek = totalDays % 7;
  document.getElementById('d-weeks').textContent = weeks;
  document.getElementById('d-days').textContent = dayOfWeek;
  document.getElementById('d-time').textContent = pad(h) + ':' + pad(m);
}
function pad(n) { return String(n).padStart(2, '0'); }

// restore on load — account for real time elapsed since page was closed
if (timerMode === 'project' && timerWall > 0) {
  // Page was closed while project timer running — add elapsed time since last save
  const elapsed = Date.now() - timerWall;
  projMs += elapsed;
  localStorage.setItem('mossb_proj_ms', projMs);
} else if (timerMode === 'delay' && timerWall > 0) {
  // Page was closed while delay timer running — add elapsed time
  const elapsed = Date.now() - timerWall;
  delMs += elapsed;
  localStorage.setItem('mossb_del_ms', delMs);
}

if (projMs > 0) paintProj(projMs);
if (delMs > 0) paintDel(delMs);

// Restart interval if timer was running
if (timerMode === 'project') {
  timerRunning = true;
  projStart = Date.now() - projMs;
  timerInt = setInterval(tickTimer, 1000);
} else if (timerMode === 'delay') {
  delayRunning = true;
  delStart = Date.now() - delMs;
  timerInt = setInterval(tickTimer, 1000);
  document.getElementById('delay-chip').classList.remove('hidden');
}
// Set button state after DOM ready
setTimeout(applyTimerUI, 0);

// ============================================
// SEARCH
// ============================================
function onSearch(q) { searchQ = (q == null ? '' : q).toString().toLowerCase().trim(); var btn = document.getElementById('search-clear-btn'); if (btn) btn.style.display = searchQ ? '' : 'none'; render(); }
function clearSearch() { var inp = document.getElementById('search-input'); if (inp) { inp.value = ''; inp.focus(); } onSearch(''); }
(function () {
  var inp = document.getElementById('search-input'); var btn = document.getElementById('search-clear-btn');
  if (inp && btn) { btn.onclick = function () { clearSearch(); }; inp.addEventListener('input', function () { btn.style.display = this.value.trim() ? '' : 'none'; }); }
})();


// ============================================
// DYNAMIC STAGE TABS (only from project + tasks, no hardcoded stages)
// ============================================
function renderStageTabs() {
  const bar = document.getElementById('stage-bar');
  if (!bar) return;
  bar.querySelectorAll('.stab').forEach(el => el.remove());
  const searchWrap = bar.querySelector('.stab-search-wrap');

  const allBtn = document.createElement('button');
  allBtn.className = 'stab' + (curStage === 'all' ? ' active' : '');
  allBtn.dataset.stage = 'all';
  allBtn.onclick = () => setStage('all', allBtn);
  allBtn.innerHTML = '<span class="stab-icon stab-icon-all"><i data-lucide="filter" class="pk24-icon" style="width:14px;height:14px"></i></span><span>Все</span> <span class="cnt">' + tasks.length + '</span>';
  bar.insertBefore(allBtn, searchWrap);

  if (!tasks.length) { updateStageTabs(); return; }

  var order = [];
  var p = typeof getActiveProject === 'function' ? getActiveProject() : null;
  if (p && Array.isArray(p.stages) && p.stages.length) order = p.stages.slice();
  else if (p && Array.isArray(p.stageSettings) && p.stageSettings.length) order = p.stageSettings.map(function (x) { return x.name; });
  var present = [...new Set(tasks.map(function (t) { return (t.stage || '').trim(); }).filter(Boolean))];
  var ordered = order.filter(function (s) { return present.includes(s); });
  var extras = present.filter(function (s) { return !order.includes(s); }).sort(function (a, b) { return a.localeCompare(b, 'ru'); });
  var stageOrder = ordered.concat(extras);

  stageOrder.forEach(function (s) {
    var cnt = tasks.filter(function (t) { return t.stage === s; }).length;
    var isActive = curStage === s;
    var btn = document.createElement('button');
    btn.className = 'stab' + (isActive ? ' active' : '');
    btn.dataset.stage = s;
    btn.onclick = () => setStage(s, btn);
    var sClr = typeof getStageColorFromProject === 'function' ? (getStageColorFromProject(s) || '#6B7280') : getStageColor(s);
    btn.innerHTML = '<span class="stab-icon" style="color:' + sClr + '">●</span> ' + s + ' <span class="cnt">' + cnt + '</span>';
    bar.insertBefore(btn, searchWrap);
  });
  updateStageTabs();
  if (typeof window.refreshLucideIcons === 'function') window.refreshLucideIcons();
}

// ============================================
// HELPERS
// ============================================
function getFiltered() {
  var ft = curStage === 'all' ? tasks : tasks.filter(function (t) { return t.stage === curStage; });
  if (searchQ) ft = ft.filter(function (t) { var q = searchQ.toLowerCase(); return (t.title || '').toLowerCase().includes(q) || (t.id || '').toLowerCase().includes(q) || (t.track || '').toLowerCase().includes(q) || (t.agent || '').toLowerCase().includes(q); });
  return ft;
}
function sc(s) { return s === 'all' ? null : (typeof getStageColorFromProject === 'function' ? getStageColorFromProject(s) : getStageColor(s)); }
function fmtBudget(n) { if (n >= 1000000) return (n / 1000000).toFixed(3).replace(/\.?0+$/, '') + 'M'; if (n >= 1000) return (n / 1000).toFixed(0) + 'K'; return n + ''; }

// ============================================
// STATS
// ============================================
function updateStats() {
  const done = tasks.filter(t => t.col === 'done').length;
  const wip = tasks.filter(t => t.col === 'inprogress').length;
  const back = tasks.filter(t => t.col !== 'done' && t.col !== 'inprogress').length;
  document.getElementById('tl-done').textContent = done;
  document.getElementById('tl-wip').textContent = wip;
  document.getElementById('tl-back').textContent = back;
  document.getElementById('progress-fill').style.width = tasks.length ? Math.round(done / tasks.length * 100) + '%' : '0%';
  const p = getActiveProject();
  const tot = (p && Number(p.budget) > 0) ? Number(p.budget) : null;
  const stages = [...new Set(tasks.map(t => t.stage))];
  let earned = 0;
  if (tot != null && tot > 0) {
    const stageBudgets = (p && Array.isArray(p.stage_settings) && p.stage_settings.length) ? p.stage_settings : (p && Array.isArray(p.stageSettings) && p.stageSettings.length) ? p.stageSettings : null;
    stages.forEach(s => {
      const st = tasks.filter(t => t.stage === s); if (!st.length) return;
      const it = stageBudgets ? stageBudgets.find(x => x.name === s) : null;
      const stageBudget = (it != null && Number.isFinite(Number(it.budget))) ? Number(it.budget) : 0;
      earned += Math.round((stageBudget || 0) * st.filter(t => t.col === 'done').length / st.length);
    });
  }
  document.getElementById('b-earned').textContent = fmtBudget(earned) + ' ₽';
  const bt = document.querySelector('.b-total');
  if (bt) bt.textContent = tot != null ? '/ ' + fmtBudget(tot) + ' ₽' : '/ 0 ₽';
  // stage counts now handled by renderStageTabs()
}

// ============================================
// STAGE TABS
// ============================================
function updateStageTabs() {
  document.querySelectorAll('.stab').forEach(btn => {
    const s = btn.dataset.stage, isActive = s === curStage, color = s === 'all' ? null : (typeof getStageColorFromProject === 'function' ? getStageColorFromProject(s) : getStageColor(s));
    if (isActive) {
      if (color) { btn.style.background = color; btn.style.borderColor = color; btn.style.color = '#fff'; }
      else { btn.style.background = 'var(--gold)'; btn.style.borderColor = 'var(--gold)'; btn.style.color = '#000'; }
    } else { btn.style.background = ''; btn.style.borderColor = ''; btn.style.color = ''; }
  });
}
function setStage(s, btn) { curStage = s; updateStageTabs(); render(); }

// ============================================
// RENDER
// ============================================
function render() {
  const board = document.getElementById('board');
  const ft = getFiltered();
  board.innerHTML = '';
  const COLS = (typeof getProjectColumns === 'function' ? getProjectColumns() : null) || [{ id: 'backlog', label: 'Backlog' }, { id: 'todo', label: 'To Do' }, { id: 'inprogress', label: 'In Progress' }, { id: 'review', label: 'Review' }, { id: 'done', label: 'Done' }];
  COLS.forEach(col => {
    const ct = ft.filter(t => t.col === col.id);
    const colEl = document.createElement('div');
    colEl.className = 'col';
    colEl.dataset.col = col.id;

    // Header — фон и текст заголовка цветом статуса
    const colClr = getStatusColor(col.id);
    const head = document.createElement('div'); head.className = 'col-head';
    head.style.background = colClr + '22';
    head.style.borderBottomColor = colClr + '44';
    head.innerHTML = `<div class="col-label" style="color:${colClr}">${col.label}</div><div class="col-cnt" id="hcnt-${col.id}">${ct.length}</div>`;
    head.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      if (typeof window.selectColumnTasks === 'function') window.selectColumnTasks(col.id);
    });
    colEl.appendChild(head);

    // Body
    const body = document.createElement('div');
    body.className = 'col-body'; body.id = 'col-' + col.id;
    body.dataset.col = col.id;

    if (ct.length === 0) {
      const empty = document.createElement('div'); empty.className = 'col-empty'; empty.textContent = 'Нет задач';
      body.appendChild(empty);
    } else {
      ct.forEach(t => {
        const card = makeCardEl(t);
        const rawId = t.raw_id || t.id;
        if (rawId && window.selectedTaskIds) {
          const isSelected = window.selectedTaskIds.has(rawId) || window.selectedTaskIds.has(t.id);
          if (isSelected) card.classList.add('selected');
        }
        card.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          const id = t.raw_id || t.id;
          if (id && typeof window.toggleTaskSelection === 'function') window.toggleTaskSelection(id);
        });
        body.appendChild(card);
      });
    }

    // Drop zone events on body
    body.addEventListener('dragover', onDragOver);
    body.addEventListener('dragenter', onDragEnter);
    body.addEventListener('dragleave', onDragLeave);
    body.addEventListener('drop', onDrop);

    colEl.appendChild(body);

    // Footer
    const foot = document.createElement('div'); foot.className = 'col-footer';
    foot.innerHTML = `<button class="col-add-btn" onclick="openTaskCreate('${col.id}')">+ задача</button>`;
    colEl.appendChild(foot);

    board.appendChild(colEl);
  });
  updateStats();
  renderStageTabs();
}

function makeCardEl(t) {
  const color = sc(t.stage), szClr = getSizeColor(t.size), agClr = getAgentColor(t.agent);
  const prio = t.priority != null ? Number(t.priority) : 0;
  const showPrio = prio > 0;
  const prioLabel = (typeof getPriorityLabelFromProject === 'function' ? getPriorityLabelFromProject(prio) : '') || { 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Critical' }[prio] || '';
  const prioClr = showPrio ? getPriorityColor(prio) : '';
  const displayId = (t.task_code && t.task_code.trim()) ? t.task_code : t.id;
  const el = document.createElement('div');
  el.className = 'card';
  el.draggable = true;
  el.dataset.id = t.id;
  el.innerHTML = `
<div class="card-strip" style="background:${color}"></div>
<div class="card-r1">
  <div class="card-id">${displayId}</div>
  <div class="size-pill" style="background:${szClr}1a;color:${szClr};border:1px solid ${szClr}44">${t.size || 'M'}</div>
</div>
<div class="card-title">${(t.task_code && t.task_code.trim()) ? (t.task_code + ' — ' + (t.title || '')) : (t.title || '')}</div>
<div class="card-r3">
  <div class="agent-pill" style="color:${agClr};border-color:${agClr}33;background:${agClr}12">${t.agent}</div>
  <div class="track-lbl">${t.track || ''}</div>
  <div class="hours-lbl">${t.hours}h</div>
  ${showPrio ? `<div class="priority-pill" style="background:${prioClr}1a;color:${prioClr};border:1px solid ${prioClr}44">${prioLabel}</div>` : ''}
</div>`;
  // Click to open (only if not dragging)
  el.addEventListener('click', () => { if (!isDragging) openTask(t.id); });
  // Drag events
  el.addEventListener('dragstart', onDragStart);
  el.addEventListener('dragend', onDragEnd);
  return el;
}
// Keep renderCard as alias used nowhere else (safety)
function renderCard(t) { return makeCardEl(t).outerHTML; }

// ============================================
// TASK VIEW MODAL
// ============================================
function openTask(id) {
  activeId = id; const t = tasks.find(x => x.id === id || x.raw_id === id); if (!t) return;
  const stageClr = (typeof getStageColorFromProject === 'function' ? getStageColorFromProject(t.stage) : getStageColor(t.stage)), agClr = getAgentColor(t.agent), szClr = getSizeColor(t.size);
  const idLabel = (t.task_code && t.task_code.trim()) ? t.task_code : (String(t.public_id || t.id || '').slice(0, 10));
  var codeEl = document.getElementById('tm-task-code'); if (codeEl) codeEl.value = idLabel;
  var titleEl = document.getElementById('tm-title'); if (titleEl) { if (titleEl.tagName === 'INPUT') titleEl.value = t.title || '—'; else titleEl.textContent = t.title || '—'; }
  var descEl = document.getElementById('tm-desc'); if (descEl) descEl[descEl.tagName === 'TEXTAREA' ? 'value' : 'textContent'] = t.desc || '—';
  function depsDisplay(d) {
    if (!d || !d.blocks || !d.blocks.length) return 'нет';
    function findDep(blockId) {
      if (!blockId) return null;
      var s = String(blockId).trim();
      return tasks.find(function (x) {
        return x.raw_id === s || x.id === s || (x.task_code && x.task_code === s) || (x.public_id != null && String(x.public_id) === s);
      });
    }
    return d.blocks.map(function (b) { var o = findDep(b); return o && o.task_code ? o.task_code : b; }).join(', ');
  }
  const taskCols = (typeof getProjectColumns === 'function' ? getProjectColumns() : null) || COLS;
  document.getElementById('tm-meta').innerHTML = `
<div class="mc"><div class="mc-lbl">Статус</div><select class="status-sel" onchange="changeCol('${t.id}',this.value)">${taskCols.map(c => `<option value="${c.id}"${t.col === c.id ? ' selected' : ''}>${c.label}</option>`).join('')}</select></div>
<div class="mc"><div class="mc-lbl">Агент</div><div class="mc-val" style="color:${agClr}">${t.agent}</div></div>
<div class="mc"><div class="mc-lbl">Размер / Часы</div><div class="mc-val" style="color:${szClr};font-weight:600">${t.size || '—'} · ${t.hours}h</div></div>
<div class="mc mc-full"><div class="mc-lbl">Этап</div><div class="mc-val" style="color:${stageClr};width:100%">${t.stage}</div></div>
<div class="mc mc-full"><div class="mc-lbl">Зависимости</div><div class="mc-val" style="font-size:11px;color:var(--tx2)">${depsDisplay(t.deps)}</div></div>`;
  chatHist = [];
  const msgs = document.getElementById('ai-msgs');
  msgs.innerHTML = `<div class="msg ai"><div class="msg-av ai">✦</div><div class="msg-bub">Задача: «${(t.title || '').replace(/</g, '&lt;')}». Готов сделать — декомпозицию, API-контракт, схема БД, разобрать на подзадачи и др.</div></div>`;
  document.getElementById('task-ov').classList.add('open');
  if (typeof window.enhanceTaskModal === 'function') window.enhanceTaskModal(id);
  setTimeout(() => document.getElementById('ai-in').focus(), 200);
}
window.openTask = openTask;
function closeTask() { document.getElementById('task-ov').classList.remove('open'); activeId = null; }
function changeCol(id, col) { const t = tasks.find(x => x.id === id); if (t) { t.col = col; save(); render(); } }

// ============================================
// AI CHAT (task modal)
// ============================================
async function sendMsg() {
  const inp = document.getElementById('ai-in'); const text = inp.value.trim(); if (!text || !activeId) return;
  const t = tasks.find(x => x.id === activeId); inp.value = ''; inp.style.height = 'auto';
  appendTo('ai-msgs', 'user', text); chatHist.push({ role: 'user', content: text });
  const btn = document.getElementById('ai-btn'); btn.disabled = true; showTyping('ai-msgs');
  const sys = `Ты — Tech Lead проекта PlanKanban. Канбан для планирования задач команды.\nСтек: PostgreSQL, Elasticsearch, Redis, S3, Next.js, Node.js/TypeScript, Docker, GitHub Actions.\nЗадача: [${t.id}] ${t.title} | Этап: ${t.stage} | Трек: ${t.track} | Агент: ${t.agent}\nОписание: ${t.desc}\nОтвечай кратко и технично на русском.`;
  const token = localStorage.getItem('pk24_token'); if (!token) { hideTyping('ai-msgs'); appendTo('ai-msgs', 'ai', '⚠️ Нужна авторизация.'); btn.disabled = false; return; }
  const messages = [{ role: 'system', content: sys }, ...chatHist];
  try {
    const res = await fetch('/api/llm/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ purpose: 'chat', messages, params: { max_tokens: 1000 } }) });
    const data = await res.json().catch(() => ({})); const reply = res.ok && data.text != null ? data.text : (data.error || 'Ошибка API.');
    chatHist.push({ role: 'assistant', content: reply }); hideTyping('ai-msgs'); appendTo('ai-msgs', 'ai', reply);
  } catch (e) { hideTyping('ai-msgs'); appendTo('ai-msgs', 'ai', '⚠️ Ошибка API.'); }
  btn.disabled = false;
}

function pkDropdownInit(container) {
  var isCreateMeta = container && container.id === 'ntm-meta';
  var isEditMeta = container && container.id === 'tm-meta';
  var isProfileProj = container && (container.id === 'profile-content' || (container.querySelector && container.querySelector('.profile-proj-grid')));
  var isPsModal = container && (container.id === 'ps-ov' || (container.querySelector && container.querySelector('#ps-responsible')));
  var isImportConfirm = container && container.id === 'import-confirm-ov';
  var isBridgeReassignModal = container && (container.id === 'reassign-option-overlay' || container.id === 'column-move-tasks-ov' || container.id === 'remove-stage-ov');
  var isProfileContent = container && container.id === 'profile-content';
  var isAiCtx = container && (container.closest && (container.closest('#tc-llm-provider') || container.closest('#tc-llm-model') || container.closest('#ai-in-wrap')));
  var isNtCtx = container && (container.closest && (container.closest('#nt-llm-provider') || container.closest('#nt-llm-model') || container.closest('#nt-in-wrap')));
  var isImpCtx = container && (container.closest && (container.closest('#imp-llm-provider') || container.closest('#imp-llm-model') || container.closest('#import-modal')));

  function shouldEnhance(sel) {
    if (document.documentElement.getAttribute('data-design') === 'v2') return true;
    if (isCreateMeta || isEditMeta || isProfileProj || isPsModal || isImportConfirm || isBridgeReassignModal) return true;
    if (sel.classList.contains('ai-capsule-sel') || sel.classList.contains('nt-capsule-sel') || sel.classList.contains('imp-capsule-sel') || sel.classList.contains('bulk-sel')) return true;
    if (isProfileContent && sel.classList.contains('profile-input')) return true;
    return false;
  }

  const root = container || document;
  const selector = 'select.status-sel, select.ps-responsible-sel, select.ps-input, select.profile-input, .nt-manual-field select.ps-input, .bridge-col-sort select, .profile-proj-sel, .ps-agent-settings select, select.ai-capsule-sel, select.nt-capsule-sel, select.imp-capsule-sel, select.bulk-sel, select.bridge-delete-input';
  const selects = root.querySelectorAll(selector);
  selects.forEach(function (sel) {
    if (sel.dataset.pkEnhanced === '1') return;
    if (!shouldEnhance(sel)) return;
    sel.dataset.pkEnhanced = '1';
    var direction = (sel.classList.contains('ai-capsule-sel') || sel.classList.contains('nt-capsule-sel') || sel.classList.contains('imp-capsule-sel') || sel.classList.contains('bulk-sel') || sel.classList.contains('import-confirm-responsible-sel')) ? 'up' : 'down';
    var wrapper = document.createElement('div');
    wrapper.className = 'pk-dropdown';
    wrapper.setAttribute('data-direction', direction);
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'pk-dropdown-trigger';
    trigger.setAttribute('aria-expanded', 'false');
    var labelSpan = document.createElement('span');
    labelSpan.className = 'pk-dropdown-label';
    var chev = document.createElement('span');
    chev.className = 'pk-dropdown-chevron';
    chev.textContent = '▾';
    trigger.appendChild(labelSpan);
    trigger.appendChild(chev);
    var menu = document.createElement('div');
    menu.className = 'pk-dropdown-menu';
    menu.setAttribute('role', 'listbox');
    function syncLabel() {
      var opt = sel.options[sel.selectedIndex];
      labelSpan.textContent = opt ? opt.textContent : '';
    }
    function rebuildMenu() {
      menu.innerHTML = '';
      Array.prototype.forEach.call(sel.options, function (opt) {
        var item = document.createElement('div');
        item.className = 'pk-dropdown-option';
        item.setAttribute('data-value', opt.value);
        item.setAttribute('role', 'option');
        item.textContent = opt.textContent;
        if (opt.value === sel.value) item.classList.add('is-selected');
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          if (sel.value !== opt.value) {
            sel.value = opt.value;
            var evt = new Event('change', { bubbles: true });
            sel.dispatchEvent(evt);
          }
          syncLabel();
          menu.querySelectorAll('.pk-dropdown-option').forEach(function (el) { el.classList.remove('is-selected'); });
          item.classList.add('is-selected');
          wrapper.classList.remove('open');
          trigger.setAttribute('aria-expanded', 'false');
        });
        menu.appendChild(item);
      });
    }
    rebuildMenu();
    syncLabel();
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var already = wrapper.classList.contains('open');
      document.querySelectorAll('.pk-dropdown.open').forEach(function (el) { el.classList.remove('open'); el.querySelector('.pk-dropdown-trigger').setAttribute('aria-expanded', 'false'); });
      if (!already) {
        wrapper.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        rebuildMenu();
      }
    });
    sel.parentNode.insertBefore(wrapper, sel);
    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);
    wrapper.appendChild(sel);
    sel.style.position = 'absolute';
    sel.style.inset = '0';
    sel.style.opacity = '0';
    sel.style.pointerEvents = 'none';
    sel.style.width = '100%';
    sel.style.height = '100%';
    var mo = sel.onchange ? sel.onchange : null;
    if (typeof MutationObserver !== 'undefined') {
      var obs = new MutationObserver(function () { rebuildMenu(); syncLabel(); });
      obs.observe(sel, { childList: true, subtree: true });
    }
  });
}

function pkDropdownDestroy(container) {
  const root = container || document;
  const wrappers = root.querySelectorAll('.pk-dropdown');
  wrappers.forEach(function (wrapper) {
    var sel = wrapper.querySelector('select');
    if (!sel) return;
    delete sel.dataset.pkEnhanced;
    sel.style.position = '';
    sel.style.inset = '';
    sel.style.opacity = '';
    sel.style.pointerEvents = '';
    sel.style.width = '';
    sel.style.height = '';
    wrapper.parentNode.insertBefore(sel, wrapper);
    wrapper.remove();
  });
}

document.addEventListener('click', function () {
  document.querySelectorAll('.pk-dropdown.open').forEach(function (el) { el.classList.remove('open'); var t = el.querySelector('.pk-dropdown-trigger'); if (t) t.setAttribute('aria-expanded', 'false'); });
});

window.pkDropdownInit = pkDropdownInit;
window.pkDropdownDestroy = pkDropdownDestroy;
window.enhanceTaskModal = function () {
  pkDropdownInit(document.getElementById('tm-meta'));
};

document.addEventListener('DOMContentLoaded', function () {
  pkDropdownInit(document);
});

// ============================================
// NEW TASK CHAT
// ============================================
function openNewTask(col) {
  newTaskCol = col || 'backlog';
  if (typeof window.openTaskCreate === 'function') {
    window.openTaskCreate(col);
  }
}
function closeNewTask() {
  const ov = document.getElementById('task-create-ov');
  if (ov) ov.classList.remove('open');
}

async function sendNewTask() {
  const inp = document.getElementById('nt-ta'); const text = inp.value.trim(); if (!text) return;
  inp.value = ''; inp.style.height = 'auto';
  appendTo('nt-chat', 'user', text); ntHist.push({ role: 'user', content: text });
  const btn = document.getElementById('nt-btn'); btn.disabled = true; showTyping('nt-chat');

  const sys = `Ты — Tech Lead проекта PlanKanban.
Стек: PostgreSQL, Elasticsearch, Redis, S3, Next.js, Node.js/TypeScript, Docker, GitHub Actions.
Этапы: A (архитектура/инфра), R1 (MVP: каталог/поиск/корзина/оформление), R1.1 (B2B/RBAC/2FA/лимиты), R2 (BOM-хаб/EDI/склад/внешний API), R3+ (лояльность/маркет/SEO), F (стабилизация/запуск/поддержка).
Роли исполнителей (agent): Backend, Frontend, DevOps, QA, Design, Security, Integrations, Search, BOM, LLM, Analytics, Admin, PM. Выбирай роль по типу работы.

Ведёшь живой диалог. Уточняй детали если нужно. Когда задача ясна — сформируй её и выведи в конце:
TASK_JSON::{"title":"...","stage":"A|R1|R1.1|R2|R3+|F","agent":"Backend|Frontend|DevOps|QA|Design|Security|Integrations|Search|BOM|LLM|Analytics|Admin|PM","size":"S|M|L|XL","hours":N,"track":"Backend|Frontend|...", "desc":"Детальное ТЗ для агента: что реализовать, входные данные, результат, edge cases, критерии приёмки."}

Оценка для ИИ-агентов: S=2-6ч (простой скрипт/компонент), M=8-20ч (фича со смежными частями), L=24-48ч (сложная фича с интеграцией), XL=48-80ч (подсистема).
Общайся на русском, технично, как настоящий Tech Lead.`;

  const token = localStorage.getItem('pk24_token'); if (!token) { hideTyping('nt-chat'); appendTo('nt-chat', 'ai', '⚠️ Нужна авторизация.'); btn.disabled = false; return; }
  const messages = [{ role: 'system', content: sys }, ...ntHist];
  try {
    const res = await fetch('/api/llm/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ purpose: 'new_task', messages, params: { max_tokens: 1400 } }) });
    const data = await res.json().catch(() => ({})); const reply = res.ok && data.text != null ? data.text : (data.error || 'Ошибка API.');
    ntHist.push({ role: 'assistant', content: reply }); hideTyping('nt-chat');
    const jm = reply.match(/TASK_JSON::(\{[\s\S]*?\})\s*$/);
    if (jm) {
      try {
        pendingTask = JSON.parse(jm[1]);
        const clean = reply.replace(/TASK_JSON::[\s\S]*$/, '').trim();
        if (clean) appendTo('nt-chat', 'ai', clean);
        showPreview(pendingTask);
      } catch (e) { appendTo('nt-chat', 'ai', reply); }
    } else { appendTo('nt-chat', 'ai', reply); }
  } catch (e) { hideTyping('nt-chat'); appendTo('nt-chat', 'ai', '⚠️ Ошибка API.'); }
  btn.disabled = false;
}

function showPreview(t) {
  document.getElementById('pv-title').textContent = t.title;
  const stC = (typeof getStageColorFromProject === 'function' ? getStageColorFromProject(t.stage) : getStageColor(t.stage)), agC = getAgentColor(t.agent);
  document.getElementById('pv-grid').innerHTML = `
<div class="pv-chip"><div class="pv-chip-lbl">Этап</div><div class="pv-chip-val" style="color:${stC}">${t.stage}</div></div>
<div class="pv-chip"><div class="pv-chip-lbl">Агент</div><div class="pv-chip-val" style="color:${agC}">${t.agent}</div></div>
<div class="pv-chip"><div class="pv-chip-lbl">Размер / Часы</div><div class="pv-chip-val">${t.size} · ${t.hours}h</div></div>
<div class="pv-chip"><div class="pv-chip-lbl">Трек</div><div class="pv-chip-val">${t.track}</div></div>
<div class="pv-chip"><div class="pv-chip-lbl">Колонка</div><div class="pv-chip-val">${newTaskCol}</div></div>`;
  document.getElementById('pv-desc').textContent = t.desc;
  const pv = document.getElementById('task-preview');
  pv.classList.add('show');
  setTimeout(() => pv.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
}

function confirmTask() {
  if (!pendingTask) return;
  const s = pendingTask.stage;
  const nums = tasks.filter(t => t.stage === s).map(t => parseInt(t.id.split('-').pop())).filter(n => !isNaN(n));
  const num = (Math.max(0, ...nums) + 1).toString().padStart(3, '0');
  const id = `${s.replace(/[^A-Za-z0-9]/g, '')}-${num}`;
  tasks.push({ id, stage: s, col: newTaskCol, title: pendingTask.title, desc: pendingTask.desc || '—', agent: pendingTask.agent || 'Backend', size: pendingTask.size || 'M', hours: pendingTask.hours || 8, track: pendingTask.track || 'Backend', deps: '' });
  save(); closeNewTask(); render();
}
function reviseTask() {
  document.getElementById('task-preview').classList.remove('show');
  pendingTask = null;
  appendTo('nt-chat', 'ai', 'Хорошо, что именно поменять? Этап, агента, оценку или описание?');
  document.getElementById('nt-ta').focus();
}

// ============================================
// MSG UTILS
// ============================================
function fmtMsg(t) {
  return t.replace(/\n/g, '<br>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;font-size:11px">$1</code>');
}
function appendTo(cid, role, text) {
  const c = document.getElementById(cid);
  const d = document.createElement('div'); d.className = `msg ${role === 'ai' ? 'ai' : 'user'}`;
  d.innerHTML = `<div class="msg-av ${role === 'ai' ? 'ai' : 'usr'}">${role === 'ai' ? '✦' : 'НБ'}</div><div class="msg-bub">${fmtMsg(text)}</div>`;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
}
const typEls = {};
function showTyping(cid) { const c = document.getElementById(cid); const d = document.createElement('div'); d.className = 'msg ai'; d.innerHTML = `<div class="msg-av ai">✦</div><div class="msg-bub"><div class="typing"><span></span><span></span><span></span></div></div>`; c.appendChild(d); c.scrollTop = c.scrollHeight; typEls[cid] = d; }
function hideTyping(cid) { if (typEls[cid]) { typEls[cid].remove(); delete typEls[cid]; } }

// ============================================
// KEYBOARD
// ============================================
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeTask(); closeNewTask(); } });


// ============================================
// DRAG & DROP
// ============================================
function onDragStart(e) {
  isDragging = true;
  const card = e.currentTarget;
  dragId = card.dataset.id;
  dragSourceCol = card.closest('.col-body').dataset.col;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  // Add dragging class after a tick so ghost image captures un-faded card
  requestAnimationFrame(() => card.classList.add('dragging'));
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  // clean all hover states
  document.querySelectorAll('.col-body.drag-over').forEach(el => el.classList.remove('drag-over'));
  document.querySelectorAll('.col.drag-over-col').forEach(el => el.classList.remove('drag-over-col'));
  document.querySelectorAll('.card-drop-indicator').forEach(el => el.remove());
  // delay reset so click handler sees isDragging=true and ignores the click
  setTimeout(() => { isDragging = false; dragId = null; dragSourceCol = null; }, 50);
}

function onDragEnter(e) {
  e.preventDefault();
  const body = e.currentTarget;
  body.classList.add('drag-over');
  body.closest('.col').classList.add('drag-over-col');
}

function onDragLeave(e) {
  // Only remove if truly leaving the body (not entering a child)
  const body = e.currentTarget;
  if (!body.contains(e.relatedTarget)) {
    body.classList.remove('drag-over');
    body.closest('.col').classList.remove('drag-over-col');
    body.querySelectorAll('.card-drop-indicator').forEach(el => el.remove());
  }
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const body = e.currentTarget;

  // Show drop indicator between cards
  body.querySelectorAll('.card-drop-indicator').forEach(el => el.remove());
  const afterEl = getDragAfterEl(body, e.clientY);
  const indicator = document.createElement('div');
  indicator.className = 'card-drop-indicator';
  if (afterEl) {
    body.insertBefore(indicator, afterEl);
  } else {
    body.appendChild(indicator);
  }
}

function getDragAfterEl(container, y) {
  const draggableEls = [...container.querySelectorAll('.card:not(.dragging)')];
  return draggableEls.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: -Infinity }).element;
}

function onDrop(e) {
  e.preventDefault();
  const body = e.currentTarget;
  const targetCol = body.dataset.col;
  if (!dragId) return;

  // Find position: which card are we dropping before?
  const afterEl = getDragAfterEl(body, e.clientY);

  // Update task data
  const t = tasks.find(x => x.id === dragId);
  if (!t) return;
  t.col = targetCol;
  save();

  // Move card in DOM without full re-render
  const cardEl = document.querySelector(`.card[data-id="${dragId}"]`);
  body.querySelectorAll('.card-drop-indicator').forEach(el => el.remove());
  body.classList.remove('drag-over');
  body.closest('.col').classList.remove('drag-over-col');

  // Remove col-empty if present
  body.querySelectorAll('.col-empty').forEach(el => el.remove());

  if (afterEl) {
    body.insertBefore(cardEl, afterEl);
  } else {
    body.appendChild(cardEl);
  }

  // Add empty state to source col if now empty
  if (dragSourceCol && dragSourceCol !== targetCol) {
    const srcBody = document.getElementById('col-' + dragSourceCol);
    if (srcBody && srcBody.querySelectorAll('.card').length === 0) {
      const empty = document.createElement('div'); empty.className = 'col-empty'; empty.textContent = 'Нет задач';
      srcBody.appendChild(empty);
    }
  }

  // Update counters
  updateColCounts();
  updateStats();
}

function updateColCounts() {
  const cols = (typeof getProjectColumns === 'function' ? getProjectColumns() : null) || COLS;
  cols.forEach(col => {
    const cnt = tasks.filter(t => t.col === col.id).length;
    // update column header count
    const hcnt = document.getElementById('hcnt-' + col.id);
    if (hcnt) hcnt.textContent = cnt;
    // also col-cnt if exists
    const ccnt = document.querySelector(`[data-col="${col.id}"]`)?.closest('.col')?.querySelector('.col-cnt');
    if (ccnt) ccnt.textContent = cnt;
  });
}


// ============================================
// IMPORT (Excel / Text -> Tech Lead)
// ============================================
let importParsedTasks = [];
let importRawData = null; // raw text or sheet data

function openImport() {
  importParsedTasks = [];
  importRawData = null;
  if (typeof window !== 'undefined') window.lastImportParsedData = null;
  document.getElementById('imp-preview').style.display = 'none';
  document.getElementById('imp-parse-btn').style.display = '';
  document.getElementById('imp-parse-btn').textContent = 'Загрузить';
  document.getElementById('imp-parse-btn').onclick = handleImportMainButton;
  document.getElementById('imp-status').textContent = '';
  document.getElementById('imp-file-hint').style.display = 'none';
  document.getElementById('imp-text-input').value = '';
  const fi = document.getElementById('imp-file-input');
  if (fi) fi.value = '';
  switchImpTab('file');
  if (typeof window.initImpLlmSelectors === 'function') window.initImpLlmSelectors();
  document.getElementById('imp-ov').classList.add('open');
}
function closeImport() { document.getElementById('imp-ov').classList.remove('open'); }

function switchProjSettingsTab(tab) {
  var panes = ['pspane-main', 'pspane-team', 'pspane-columns', 'pspane-priority', 'pspane-size'];
  var tabs = ['pstab-main', 'pstab-team', 'pstab-columns', 'pstab-priority', 'pstab-size'];
  panes.forEach(function (id, i) {
    var el = document.getElementById(id);
    if (el) el.style.display = (['main', 'team', 'columns', 'priority', 'size'][i] === tab) ? '' : 'none';
  });
  tabs.forEach(function (id, i) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle('active', ['main', 'team', 'columns', 'priority', 'size'][i] === tab);
  });
}

function switchImpTab(tab) {
  document.getElementById('ipane-file').style.display = tab === 'file' ? '' : 'none';
  document.getElementById('ipane-text').style.display = tab === 'text' ? '' : 'none';
  document.getElementById('itab-file').classList.toggle('active', tab === 'file');
  document.getElementById('itab-text').classList.toggle('active', tab === 'text');
}

// Drag-over on drop zone
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const dz = document.getElementById('imp-drop');
    if (!dz) return;
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-active'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-active'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-active');
      const f = e.dataTransfer.files[0];
      if (f) processImportFile(f);
    });
  });
})();

function handleFileSelect(input) {
  if (input.files[0]) processImportFile(input.files[0]);
}

function processImportFile(file) {
  const hint = document.getElementById('imp-file-hint');
  hint.style.display = '';
  hint.textContent = '📄 Загружен: ' + file.name + ' (' + Math.round(file.size / 1024) + ' KB)';

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const sheetParts = wb.SheetNames.map(function (name) {
        const ws = wb.Sheets[name];
        if (!ws) return null;
        const csv = XLSX.utils.sheet_to_csv(ws, { skipHidden: true });
        const nonEmpty = csv.split('\n').filter(function (r) { return r.replace(/,/g, '').trim(); });
        if (nonEmpty.length < 2) return null;
        return '=== Лист: ' + name + ' ===\n' + csv;
      }).filter(Boolean);
      const content = sheetParts.join('\n\n');
      importRawData = 'Файл: ' + file.name + '\n\n' + content;
      const totalRows = content.split(/\r?\n/).filter(function (r) { return r.trim(); }).length;
      const nSheets = sheetParts.length;
      hint.textContent = '✓ ' + file.name + ' — ' + nSheets + (nSheets === 1 ? ' вкладка' : ' вкладок') + ', ' + totalRows + ' строк. Нажмите «Загрузить».';
      hint.style.color = 'var(--green)';
    } catch (err) {
      hint.textContent = '❌ Ошибка чтения файла: ' + err.message;
      hint.style.color = 'var(--red)';
    }
  };
  reader.readAsArrayBuffer(file);
}

/* runImportParse переопределяется в api-bridge.js — использует /api/llm/chat с выбором провайдера/модели */
const SC2 = { A: '#4a9eff', R1: '#a78bfa', 'R1.1': '#fb923c', R2: '#f87171', 'R2+': '#f87171', 'R3+': '#34d399', F: '#fbbf24', 'Без этапа': '#6b7280' };

function renderImportPreview(tasks) {
  const preview = document.getElementById('imp-preview');
  const count = document.getElementById('imp-preview-count');
  const listWrap = document.getElementById('imp-preview-list-wrap');
  if (!preview || !count || !listWrap) return;

  const stages = ['Все', ...([...new Set(tasks.map(t => t.stage || 'Без этапа'))].sort())];
  const stageCounts = {};
  tasks.forEach(t => {
    const s = t.stage || 'Без этапа';
    stageCounts[s] = (stageCounts[s] || 0) + 1;
  });
  stageCounts['Все'] = tasks.length;

  count.textContent = '✓ Загружено: ' + tasks.length + ' задач. Нажмите «Готово» для настроек.';
  preview.dataset.impCurStage = 'Все';

  const tabsHtml = stages.map(s => {
    const n = stageCounts[s] || 0;
    const color = s === 'Все' ? 'var(--gold)' : (SC2[s] || '#888');
    return '<button type="button" class="imp-preview-tab' + (s === 'Все' ? ' active' : '') + '" data-stage="' + (s === 'Все' ? 'all' : s) + '" style="--tab-color:' + color + '">' + s + (n ? ' (' + n + ')' : '') + '</button>';
  }).join('');

  listWrap.innerHTML = '<div class="imp-preview-tabs">' + tabsHtml + '</div><div class="imp-preview-list" id="imp-preview-list"></div>';

  const list = document.getElementById('imp-preview-list');
  const tabs = listWrap.querySelectorAll('.imp-preview-tab');
  function renderList(cur) {
    const filtered = cur === 'all' ? tasks : tasks.filter(t => (t.stage || 'Без этапа') === cur);
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    list.innerHTML = filtered.map(t => `
<div class="imp-task-row">
  <span class="imp-task-stage" style="background:${SC2[t.stage] || '#888'}">${esc(t.stage || '?')}</span>
  <span class="imp-task-title" title="${esc(t.title)}">${esc(t.title)}</span>
  <span class="imp-task-meta">${esc(t.agent)} · ${esc(t.size || 'M')} · ${t.hours || 0}h</span>
</div>`).join('');
  }
  renderList('all');
  tabs.forEach(btn => {
    btn.addEventListener('click', function () {
      tabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const stage = btn.dataset.stage;
      preview.dataset.impCurStage = stage === 'all' ? 'Все' : stage;
      renderList(stage);
    });
  });

  preview.style.display = '';
  const parseBtn = document.getElementById('imp-parse-btn');
  if (parseBtn) {
    parseBtn.textContent = 'Готово';
    parseBtn.onclick = handleImportMainButton;
  }
}

function clearImportPreview() {
  importParsedTasks = [];
  if (typeof window !== 'undefined') window.lastImportParsedData = null;
  document.getElementById('imp-preview').style.display = 'none';
  const parseBtn = document.getElementById('imp-parse-btn');
  if (parseBtn) {
    parseBtn.textContent = 'Загрузить';
    parseBtn.onclick = handleImportMainButton;
  }
}

function handleImportMainButton() {
  const hasParsed = importParsedTasks.length > 0 && (typeof window !== 'undefined' && window.lastImportParsedData);
  if (hasParsed && typeof window.openImportConfirmModal === 'function') {
    window.openImportConfirmModal(window.lastImportParsedData);
  } else {
    if (typeof runImportParse === 'function') runImportParse();
  }
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--green);color:#000;padding:10px 22px;border-radius:10px;font-family:Syne,sans-serif;font-size:13px;font-weight:700;z-index:9999;box-shadow:0 4px 20px rgba(74,222,128,.4);animation:fadeInUp .3s ease;';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
// ============================================
// INIT
// ============================================

// ============================================
// PROJECTS
// ============================================
const DEFAULT_PROJECT = { id: '', name: 'PlanKanban24', weeks: 0, budget: 0 };

function loadProjects() {
  try { const s = localStorage.getItem('mossb_projects'); if (s) return JSON.parse(s); } catch (e) { }
  return [];
}
function saveProjects() {
  try { localStorage.setItem('mossb_projects', JSON.stringify(projects)); } catch (e) { }
}
function loadActiveProject() {
  return localStorage.getItem('mossb_active_proj') || '';
}

let projects = loadProjects();
let activeProjId = loadActiveProject();

if (
  projects.length === 1 &&
  projects[0] &&
  projects[0].id === 'mossb' &&
  /mossb\.ru/i.test(projects[0].name || '')
) {
  projects = [];
  activeProjId = '';
  try { localStorage.removeItem('mossb_projects'); } catch (e) { }
  try { localStorage.removeItem('mossb_active_proj'); } catch (e) { }
  try { localStorage.removeItem('tasks_mossb'); } catch (e) { }
}

function getActiveProject() {
  return projects.find(p => p.id === activeProjId) || projects[0] || null;
}

function renderProjList() {
  const list = document.getElementById('proj-list');
  list.innerHTML = `<div class="proj-dd-list-label">Проекты (${projects.length})</div>` +
    projects.map((p, i) => {
      const isActive = p.id === activeProjId;
      const emoji = ['📋', '🚀', '⚡', '🎯', '🛠', '💡'][i % 6];
      const weekStr = (p.weeks && Number(p.weeks) > 0) ? p.weeks + 'н' : '0';
      const budgetStr = (p.budget && Number(p.budget) > 0) ? fmtBudget(p.budget) + ' ₽' : '0';
      return `<div class="proj-dd-item ${isActive ? 'active-proj' : ''}">
    <div class="proj-dd-icon-wrap">${emoji}</div>
    <div class="proj-dd-info" onclick="switchProject('${p.id}')">
      <span class="proj-dd-name">${p.name}</span>
      <div class="proj-dd-meta">${weekStr} · ${budgetStr}</div>
    </div>
    <button class="proj-dd-gear" onclick="openProjSettings('${p.id}')" title="Настройки">⚙</button>
  </div>`;
    }).join('');
}

function toggleProjMenu(e) {
  e.stopPropagation();
  const dd = document.getElementById('proj-dropdown');
  const isOpen = dd.classList.contains('open');
  closeAllDropdowns();
  if (!isOpen) {
    renderProjList();
    dd.classList.add('open');
  }
}

function closeAllDropdowns() {
  document.querySelectorAll('.proj-dropdown').forEach(d => d.classList.remove('open'));
  document.querySelectorAll('.pk-dropdown.open').forEach(function (el) {
    el.classList.remove('open');
    var t = el.querySelector('.pk-dropdown-trigger');
    if (t) t.setAttribute('aria-expanded', 'false');
  });
}

// Close on outside click
document.addEventListener('click', () => closeAllDropdowns());

function switchProject(id) {
  activeProjId = id || '';
  if (activeProjId) {
    localStorage.setItem('mossb_active_proj', activeProjId);
  } else {
    localStorage.removeItem('mossb_active_proj');
  }
  // Save current project tasks first (already saved on each change, but be safe)
  // Load tasks for the new project
  tasks = activeProjId ? loadTasksForProject(activeProjId) : [];
  closeAllDropdowns();
  curStage = 'all';
  updateStageTabs();
  applyProjectSettings();
  render();
}

function applyProjectSettings() {
  const p = getActiveProject();
  const totalBudget = (p && Number(p.budget) > 0) ? Number(p.budget) : null;
  const totalWeeks = (p && Number(p.weeks) > 0) ? Number(p.weeks) : null;
  const projectName = (p && p.name) || 'Без проекта';
  // Budget chip
  const bt = document.querySelector('.b-total');
  if (bt) bt.textContent = totalBudget != null ? '/ ' + fmtBudget(totalBudget) + ' ₽' : '/ 0 ₽';
  // Timer weeks label
  const wlbl = document.querySelector('#proj-timer .tc-lbl');
  if (wlbl) wlbl.textContent = totalWeeks != null ? '/ ' + totalWeeks + ' нед' : '/ 0 нед';
  // Header project title
  const ptl = document.getElementById('proj-title-label');
  if (ptl) ptl.textContent = projectName;
  // Document title
  document.title = projectName + ' — PlanKanban24';
}

function openNewProjectModal() {
  closeAllDropdowns();
  // Reuse settings modal but in "create" mode
  editingProjId = '__new__';
  document.getElementById('ps-name').value = '';
  document.getElementById('ps-weeks').value = '0';
  document.getElementById('ps-budget').value = '0';
  document.getElementById('ps-proj-name-hint').textContent = 'Новый проект';
  // Change modal title
  const title = document.querySelector('.ps-title');
  if (title) title.textContent = 'Новый проект';
  const icon = document.querySelector('.ps-icon');
  if (icon) icon.textContent = '🆕';
  const saveBtn = document.getElementById('ps-save-btn');
  if (saveBtn) saveBtn.textContent = 'Создать';
  const delBtn = document.getElementById('btn-delete-proj');
  if (delBtn) delBtn.classList.add('hidden');
  switchProjSettingsTab('main');
  document.getElementById('ps-ov').classList.add('open');
  setTimeout(() => document.getElementById('ps-name').focus(), 150);
}

function newProject() { openNewProjectModal(); }

// -- PROJECT SETTINGS --
let editingProjId = null;

function openProjSettings(id) {
  closeAllDropdowns();
  editingProjId = id;
  const p = projects.find(x => x.id === id) || DEFAULT_PROJECT;
  document.getElementById('ps-name').value = p.name;
  document.getElementById('ps-weeks').value = p.weeks ?? 0;
  document.getElementById('ps-budget').value = p.budget ?? 0;
  document.getElementById('ps-proj-name-hint').textContent = p.name;
  // Reset to edit mode labels
  const title = document.querySelector('.ps-title');
  if (title) title.textContent = 'Настройки проекта';
  const icon = document.querySelector('.ps-icon');
  if (icon) icon.textContent = '⚙️';
  const saveBtn = document.getElementById('ps-save-btn');
  if (saveBtn) saveBtn.textContent = 'Сохранить';
  const delBtn = document.getElementById('btn-delete-proj');
  if (delBtn) {
    // Show delete for all projects
    delBtn.classList.remove('hidden');
  }
  document.getElementById('ps-ov').classList.add('open');
  setTimeout(() => document.getElementById('ps-name').focus(), 150);
}


function deleteProject() {
  if (!editingProjId || editingProjId === '__new__') return;
  const p = projects.find(x => x.id === editingProjId);
  if (!p) return;
  showDeleteConfirm(p);
}

function showDeleteConfirm(p) {
  const existing = document.getElementById('del-confirm-overlay');
  if (existing) existing.remove();

  const taskCount = loadTasksForProject(p.id).length;

  const ov = document.createElement('div');
  ov.id = 'del-confirm-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:600;background:rgba(0,0,0,.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;';
  ov.innerHTML = `
<div style="background:var(--mbg);border:1px solid rgba(239,68,68,.3);border-radius:16px;padding:28px 28px 22px;max-width:400px;width:90%;box-shadow:0 24px 60px rgba(0,0,0,.6);">
  <div style="font-size:28px;margin-bottom:12px;text-align:center;">🗑</div>
  <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:700;color:var(--tx);text-align:center;margin-bottom:8px;">Удалить проект?</div>
  <div style="font-size:13px;color:var(--tx2);text-align:center;line-height:1.6;margin-bottom:6px;">«${p.name}»</div>
  <div style="font-size:12px;color:var(--red);text-align:center;margin-bottom:22px;opacity:.85;">${taskCount ? taskCount + ' задач будут удалены безвозвратно.' : 'Проект пустой.'} Отменить нельзя.</div>
  <div style="display:flex;gap:10px;justify-content:center;">
    <button id="del-no" style="padding:0 22px;height:40px;background:var(--sf2);border:1.5px solid var(--bd2);border-radius:9px;color:var(--tx);font-family:'Syne',sans-serif;font-size:13px;font-weight:700;cursor:pointer;">Отмена</button>
    <button id="del-yes" style="padding:0 22px;height:40px;background:#ef4444;border:none;border-radius:9px;color:#fff;font-family:'Syne',sans-serif;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(239,68,68,.4);">Удалить</button>
  </div>
</div>`;

  document.body.appendChild(ov);

  document.getElementById('del-no').onclick = () => ov.remove();
  document.getElementById('del-yes').onclick = () => {
    ov.remove();
    doDeleteProject(p.id);
  };
}

function doDeleteProject(projId) {
  try { localStorage.removeItem(getTasksKey(projId)); } catch (e) { }
  projects = projects.filter(x => x.id !== projId);
  saveProjects();
  closeProjSettings();
  if (projects.length) {
    switchProject(projects[0].id);
  } else {
    switchProject('');
  }
}

function closeProjSettings() {
  document.getElementById('ps-ov').classList.remove('open');
  editingProjId = null;
}

function saveProjSettings() {
  if (!editingProjId) return;
  const name = document.getElementById('ps-name').value.trim();
  const weeks = parseInt(document.getElementById('ps-weeks').value, 10) || 0;
  const budget = parseInt(document.getElementById('ps-budget').value, 10) || 0;
  if (!name) { document.getElementById('ps-name').focus(); return; }

  if (editingProjId === '__new__') {
    // Create mode
    const id = 'proj_' + Date.now();
    projects.push({ id, name, weeks, budget });
    saveProjects();
    closeProjSettings();
    switchProject(id);
  } else {
    // Edit mode
    const idx = projects.findIndex(p => p.id === editingProjId);
    if (idx < 0) return;
    projects[idx] = { ...projects[idx], name, weeks, budget };
    saveProjects();
    closeProjSettings();
    applyProjectSettings();
    renderProjList();
  }
}

// Also update TOTAL_BUDGET dynamically via getter override
// (fmtBudget in updateStats uses the project budget)
const _origUpdateStats = updateStats;
updateStats = function () {
  const p = getActiveProject();
  // Patch earned calculation to use project budget
  const done = tasks.filter(t => t.col === 'done').length;
  const wip = tasks.filter(t => t.col === 'inprogress').length;
  const back = tasks.filter(t => t.col !== 'done' && t.col !== 'inprogress').length;
  document.getElementById('tl-done').textContent = done;
  document.getElementById('tl-wip').textContent = wip;
  document.getElementById('tl-back').textContent = back;
  document.getElementById('progress-fill').style.width = tasks.length ? Math.round(done / tasks.length * 100) + '%' : '0%';
  const totalBudget = (p && Number(p.budget) > 0) ? Number(p.budget) : null;
  const stages = [...new Set(tasks.map(t => t.stage))];
  let earned = 0;
  if (totalBudget != null && totalBudget > 0) {
    const stageBudgets = (p && Array.isArray(p.stage_settings) && p.stage_settings.length) ? p.stage_settings : (p && Array.isArray(p.stageSettings) && p.stageSettings.length) ? p.stageSettings : null;
    stages.forEach(s => {
      const st = tasks.filter(t => t.stage === s); if (!st.length) return;
      const it = stageBudgets ? stageBudgets.find(x => x.name === s) : null;
      const stageBudget = (it != null && Number.isFinite(Number(it.budget))) ? Number(it.budget) : 0;
      earned += Math.round((stageBudget || 0) * st.filter(t => t.col === 'done').length / st.length);
    });
  }
  document.getElementById('b-earned').textContent = fmtBudget(earned) + ' ₽';
  const bt = document.querySelector('.b-total');
  if (bt) bt.textContent = totalBudget != null ? '/ ' + fmtBudget(totalBudget) + ' ₽' : '/ 0 ₽';
  // stage counts now handled by renderStageTabs()
};

// Keyboard: Escape closes settings too
const _origKeydown = document.onkeydown;
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeProjSettings();
});

// Init projects
applyProjectSettings();


render();
updateStageTabs();
