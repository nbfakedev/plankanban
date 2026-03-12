(function () {
  window.openProfilePanel = function (sectionId) {
    var o = document.getElementById('profile-ov');
    if (o) o.classList.add('open');
    var sid = sectionId || 'profile';
    function tryFill(n) {
      if (window.__fillProfileContent) {
        window.__fillProfileContent(sid);
        return;
      }
      if (n < 50) setTimeout(function () { tryFill(n + 1); }, 100);
    }
    tryFill(0);
  };
  const UI_TO_API_COL = {
    backlog: 'backlog',
    todo: 'todo',
    inprogress: 'doing',
    review: 'review',
    done: 'done',
  };

  const API_TO_UI_COL = {
    backlog: 'backlog',
    todo: 'todo',
    doing: 'inprogress',
    inprogress: 'inprogress',
    in_progress: 'inprogress',
    review: 'review',
    done: 'done',
  };

  const DEFAULT_STAGE_LIST = [];
  const EXTRA_STAGE_COLORS = [
    '#38bdf8',
    '#34d399',
    '#f59e0b',
    '#f472b6',
    '#a78bfa',
    '#fb7185',
    '#2dd4bf',
    '#60a5fa',
  ];
  const DEFAULT_SORT_MODE = 'default';
  const SIZE_WEIGHT = { XS: 0, S: 1, M: 2, L: 3, XL: 4 };
  const SORT_OPTIONS = [
    { value: 'default', label: 'По умолчанию', icon: '≡' },
    { value: 'id_asc', label: 'ID возрастание', icon: '№↑' },
    { value: 'id_desc', label: 'ID убывание', icon: '№↓' },
    { value: 'name_asc', label: 'Имя возрастание', icon: 'A–Z' },
    { value: 'name_desc', label: 'Имя убывание', icon: 'Z–A' },
    { value: 'priority_desc', label: 'Приоритет высокий', icon: '▲' },
    { value: 'priority_asc', label: 'Приоритет низкий', icon: '▼' },
  ];
  function buildProfileSections() {
    var jwt = decodeJwtPayload(localStorage.getItem('pk24_token'));
    var role = (jwt && jwt.role) || 'employee';
    var isManager = role === 'manager';
    var profileSubs = [
      { id: 'account', label: 'Аккаунт' },
      { id: 'password', label: 'Пароль' },
    ];
    if (!isManager) {
      profileSubs.push({ id: 'tariff', label: 'Тариф' });
      profileSubs.push({ id: 'payment', label: 'Оплата' });
      profileSubs.push({ id: 'billing', label: 'Биллинг' });
    }
    var sections = [
      { id: 'profile', label: 'Профиль', subs: profileSubs },
      {
        id: 'roles',
        label: 'Проекты и роли',
        subs: [
          { id: 'roles', label: 'Проекты' },
          { id: 'history', label: 'История действий' },
          { id: 'trash', label: 'Удаленные задачи' },
        ],
      },
    ];
    if (role === 'admin' || role === 'techlead') {
      sections.push({
        id: 'llm',
        label: 'LLM провайдеры',
        subs: [
          { id: 'llm_keys', label: 'API-ключи' },
          { id: 'llm_usage', label: 'Статистика' },
        ],
      });
    }
    sections.push({
      id: 'metrics',
      label: 'Метрики',
      subs: [
        { id: 'metrics_project', label: 'Проекты' },
        { id: 'metrics_tasks', label: 'Задачи' },
        { id: 'metrics_time', label: 'Время' },
        { id: 'metrics_budget', label: 'Бюджеты' },
      ],
    });
    sections.push({
      id: 'settings',
      label: 'Настройки',
      subs: [
        { id: 'theme', label: 'Тема' },
        { id: 'design', label: 'Дизайн' },
        { id: 'notifications', label: 'Уведомления' },
      ],
    });
    var securitySubs = [];
    if (role === 'admin') {
      securitySubs.push({ id: 'rights', label: 'Права' });
      securitySubs.push({ id: 'data_deletion', label: 'Удаление данных' });
    }
    securitySubs.push({ id: 'logout', label: 'Выйти' });
    sections.push({
      id: 'security',
      label: 'Безопасность',
      subs: securitySubs,
    });
    sections.push({
      id: 'documentation',
      label: 'Документация',
      subs: [
        { id: 'doc_profile', label: 'Профиль' },
        { id: 'doc_llm', label: 'LLM' },
        { id: 'doc_projects', label: 'Проекты и задачи' },
        { id: 'doc_analytics', label: 'Аналитика' },
        { id: 'doc_settings', label: 'Настройки' },
      ],
    });
    return sections;
  }
  var PROFILE_MAIN_SECTIONS = buildProfileSections();

  function getMainSectionBySubId(subId) {
    for (var i = 0; i < PROFILE_MAIN_SECTIONS.length; i++) {
      var main = PROFILE_MAIN_SECTIONS[i];
      for (var j = 0; j < main.subs.length; j++) {
        if (main.subs[j].id === subId) return main;
      }
    }
    return null;
  }

  function getDefaultSubIdForMain(mainId) {
    var main = PROFILE_MAIN_SECTIONS.find(function (m) { return m.id === mainId; });
    return main && main.subs.length ? main.subs[0].id : null;
  }

  let authToken = localStorage.getItem('pk24_token') || '';
  let authPromise = null;
  let headerRefreshScheduled = false;
  let headerRefreshInFlight = false;
  let timerSyncIntervalId = null;
  let timerTickIntervalId = null;
  let timerSnapshot = {
    projectMs: 0,
    delayMs: 0,
    status: 'paused',
    syncedAtMs: Date.now(),
    deadline: null,
  };
  let projectCompletedMode = false;
  let timerFrozen = false;
  let completionTransitionInFlight = false;
  let completionOverrideByProject = {};
  let newTaskCreateMode = 'ai';
  let pendingStageActionsByProject = {};
  let activeProfileSection = 'profile';
  let activeProfileSubSection = 'account';
  const NO_STAGE = 'Без этапа';
  const NO_STAGE_COLOR = '#64748b';

  let profileTrashLoading = false;
  let profileTrashItems = [];
  let profileTrashFilters = {
    q: '',
    project_id: '',
    stage: '',
    deleted_by: '',
    deleted_from: '',
    deleted_to: '',
  };
  const columnSortModes = {
    backlog: DEFAULT_SORT_MODE,
    todo: DEFAULT_SORT_MODE,
    inprogress: DEFAULT_SORT_MODE,
    review: DEFAULT_SORT_MODE,
    done: DEFAULT_SORT_MODE,
  };

  function showError(message) {
    if (typeof showToast === 'function') {
      showToast('! ' + message);
    }
    const status = document.getElementById('imp-status');
    if (status) {
      status.textContent = message;
      status.style.color = 'var(--red)';
    }
  }

  function showInfo(message) {
    if (typeof showToast === 'function') {
      showToast(message);
    }
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function decodeJwtPayload(token) {
    try {
      const parts = String(token || '').split('.');
      if (parts.length !== 3) { return null; }
      const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(base64).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join('')
      );
      return JSON.parse(json);
    } catch (_) {
      return null;
    }
  }

  function formatDateTime(value) {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function formatDeletedTaskDisplayId(task) {
    if (Number.isFinite(task.public_id) && task.public_id > 0) {
      return 'T-' + String(task.public_id).padStart(6, '0');
    }
    if (task.id) {
      return task.id;
    }
    if (task.raw_id) {
      return String(task.raw_id).slice(0, 8);
    }
    return '—';
  }

  function formatColLabel(col) {
    const cols = typeof getProjectColumns === 'function' ? getProjectColumns() : [];
    const normalized = String(col || '').toLowerCase();
    const uiNorm = normalized === 'doing' ? 'inprogress' : normalized;
    const match = cols.find(function (item) { return item.id === uiNorm || item.id === normalized; });
    return match ? match.label : 'Backlog';
  }

  function getProjectName(projectId) {
    const match = projects.find(function (item) {
      return item.id === projectId;
    });
    return match ? match.name : '—';
  }

  function getProjectStages(projectId) {
    const project = projects.find(function (item) {
      return item.id === projectId;
    });
    if (!project) {
      return [NO_STAGE];
    }
    var stages = [];
    if (Array.isArray(project.stageSettings) && project.stageSettings.length > 0) {
      stages = project.stageSettings.map(function (item) {
        return item.name;
      });
    } else if (Array.isArray(project.stages) && project.stages.length > 0) {
      stages = project.stages.slice();
    }
    if (stages.length === 0 || stages[0] !== NO_STAGE) {
      var rest = stages.filter(function (s) { return String(s || '').trim().toLowerCase() !== NO_STAGE.toLowerCase(); });
      stages = [NO_STAGE].concat(rest);
    }
    return stages;
  }

  function mapDeletedTaskFromApi(item) {
    const stage = String(item.stage || item.last_stage || '').trim();
    ensureStageColor(stage);
    const publicId = Number(item.public_id || item.task_public_id || 0);
    const rawId = String(item.id || item.task_id || item.raw_id || '').trim();
    return {
      raw_id: rawId,
      id: formatDeletedTaskDisplayId({
        public_id: publicId > 0 ? publicId : null,
        raw_id: rawId,
      }),
      public_id: publicId > 0 ? publicId : null,
      title: item.title || 'Untitled',
      deleted_at: item.deleted_at || item.removed_at || null,
      deleted_by: item.deleted_by_name || item.deleted_by_email || item.deleted_by || '—',
      project_id: item.project_id || '',
      project_name: item.project_name || getProjectName(item.project_id || ''),
      col: normalizeUiCol(item.col || item.status || item.last_col || 'backlog'),
      stage: stage,
      agent: item.agent || 'Без агента',
      size: String(item.size || 'M').toUpperCase(),
      hours: Number(item.hours || 0),
      desc: item.descript || item.description || '',
      notes: item.notes || '',
    };
  }

  function ensureProfilePanel() {
    ensureBridgeStyles();
    let overlay = document.getElementById('profile-ov');
    if (overlay) {
      overlay.style.zIndex = '700';
      var closeBtn = document.getElementById('profile-close-btn');
      if (closeBtn && !closeBtn._profileBound) {
        closeBtn._profileBound = true;
        closeBtn.onclick = closeProfilePanel;
      }
      if (!document.body.dataset.profileEscBound) {
        document.body.dataset.profileEscBound = '1';
        document.addEventListener('keydown', function (event) {
          if (event.key === 'Escape') {
            var current = document.getElementById('profile-ov');
            if (current && current.classList.contains('open')) {
              closeProfilePanel();
            }
          }
        });
      }
      return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = 'profile-ov';
    overlay.className = 'overlay profile-overlay';
    overlay.style.zIndex = '700';
    overlay.innerHTML = ''
      + '<div class="profile-drawer">'
      + '<div class="profile-hd">'
      + '<div>'
      + '<div class="profile-title">Профиль</div>'
      + '<div class="profile-sub">Личный кабинет PlanKanban</div>'
      + '</div>'
      + '<button class="tm-close" id="profile-close-btn">✕</button>'
      + '</div>'
      + '<div class="profile-layout">'
      + '<div class="profile-nav" id="profile-nav"></div>'
      + '<div class="profile-content-wrap">'
      + '<div class="profile-sub-nav" id="profile-sub-nav"></div>'
      + '<div class="profile-content" id="profile-content"></div>'
      + '</div>'
      + '</div>'
      + '</div>';
    document.body.appendChild(overlay);

    const closeButton = document.getElementById('profile-close-btn');
    if (closeButton) {
      closeButton.onclick = closeProfilePanel;
    }

    if (!document.body.dataset.profileEscBound) {
      document.body.dataset.profileEscBound = '1';
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
          const current = document.getElementById('profile-ov');
          if (current && current.classList.contains('open')) {
            closeProfilePanel();
          }
        }
      });
    }

    return overlay;
  }

  function openProfilePanel(sectionId) {
    try {
      closeAllDropdowns();
      var overlay = ensureProfilePanel();
      if (!overlay) {
        return;
      }
      overlay.classList.add('open');
      PROFILE_MAIN_SECTIONS = buildProfileSections();
      if (sectionId) {
        var main = PROFILE_MAIN_SECTIONS.find(function (m) { return m.id === sectionId; });
        if (main) {
          activeProfileSection = main.id;
          activeProfileSubSection = main.subs[0] ? main.subs[0].id : activeProfileSubSection;
        } else {
          var mainBySub = getMainSectionBySubId(sectionId);
          if (mainBySub) {
            activeProfileSection = mainBySub.id;
            activeProfileSubSection = sectionId;
          }
        }
      }
      renderProfileNavigation();
      renderProfileSubNav();
      renderProfileSection();
    } catch (err) {
      console.error('openProfilePanel error:', err);
      var ov = document.getElementById('profile-ov');
      if (ov) {
        ov.classList.add('open');
      }
    }
  }

  function closeProfilePanel() {
    const overlay = document.getElementById('profile-ov');
    if (overlay) {
      overlay.classList.remove('open');
    }
  }

  function renderProfileNavigation() {
    const nav = document.getElementById('profile-nav');
    if (!nav) return;

    nav.innerHTML = PROFILE_MAIN_SECTIONS.map(function (section) {
      return (
        '<button class="profile-nav-item' +
        (section.id === activeProfileSection ? ' active' : '') +
        '" data-profile-main="' + escapeHtml(section.id) + '">' +
        escapeHtml(section.label) +
        '</button>'
      );
    }).join('');

    nav.querySelectorAll('[data-profile-main]').forEach(function (button) {
      button.onclick = function () {
        const mainId = button.getAttribute('data-profile-main');
        if (!mainId) return;
        activeProfileSection = mainId;
        activeProfileSubSection = getDefaultSubIdForMain(mainId) || activeProfileSubSection;
        renderProfileNavigation();
        renderProfileSubNav();
        renderProfileSection();
      };
    });
  }

  function renderProfileSubNav() {
    const subNav = document.getElementById('profile-sub-nav');
    if (!subNav) return;

    const main = PROFILE_MAIN_SECTIONS.find(function (m) { return m.id === activeProfileSection; });
    if (!main || !main.subs.length) {
      subNav.innerHTML = '';
      subNav.style.display = 'none';
      return;
    }

    subNav.style.display = 'flex';
    subNav.innerHTML = main.subs.map(function (sub) {
      return (
        '<button class="profile-sub-nav-btn' +
        (sub.id === activeProfileSubSection ? ' active' : '') +
        '" data-profile-sub="' + escapeHtml(sub.id) + '">' +
        escapeHtml(sub.label) +
        '</button>'
      );
    }).join('');

    subNav.querySelectorAll('[data-profile-sub]').forEach(function (button) {
      button.onclick = function () {
        const subId = button.getAttribute('data-profile-sub');
        if (!subId) return;
        activeProfileSubSection = subId;
        renderProfileSubNav();
        renderProfileSection();
      };
    });
  }

  function renderProfilePlaceholder(title, description) {
    const content = document.getElementById('profile-content');
    if (!content) return;
    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">' + escapeHtml(title) + '</div>'
      + '<div class="profile-pane-sub">' + escapeHtml(description) + '</div>'
      + '<div class="profile-empty">Раздел готов к подключению API.</div>'
      + '</div>';
  }

  function renderProfileStub(title, description, features) {
    const content = document.getElementById('profile-content');
    if (!content) return;
    var listHtml = '';
    if (Array.isArray(features) && features.length) {
      listHtml = '<ul class="profile-stub-list">' +
        features.map(function (f) { return '<li>' + escapeHtml(f) + '</li>'; }).join('') +
        '</ul>';
    }
    content.innerHTML = ''
      + '<div class="profile-pane profile-stub">'
      + '<div class="profile-pane-title">' + escapeHtml(title) + '</div>'
      + '<div class="profile-pane-sub">' + escapeHtml(description) + '</div>'
      + '<div class="profile-stub-card">'
      + '<div class="profile-stub-badge">Скоро</div>'
      + '<p class="profile-stub-text">Интерфейс в разработке. Здесь будет настройка после подключения соответствующего API.</p>'
      + listHtml
      + '</div>'
      + '</div>';
  }

  function renderProfileOverview() {
    const content = document.getElementById('profile-content');
    if (!content) { return; }

    const jwt = decodeJwtPayload(localStorage.getItem('pk24_token'));
    const userEmail = (jwt && jwt.email) || '—';
    const userRole = (jwt && jwt.role) || '—';
    const userId = (jwt && jwt.sub) || '—';
    const tokenExp = jwt && jwt.exp ? new Date(jwt.exp * 1000) : null;
    const tokenExpStr = tokenExp
      ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(tokenExp)
      : '—';
    const nowMs = Date.now();
    const expMs = tokenExp ? tokenExp.getTime() : 0;
    const hoursLeft = expMs > nowMs ? Math.floor((expMs - nowMs) / 3600000) : 0;

    const roleLabels = { admin: 'Администратор', techlead: 'Техлид', employee: 'Сотрудник' };
    const roleLabel = roleLabels[userRole] || userRole;
    const roleColors = { admin: 'var(--red)', techlead: 'var(--gold)', employee: 'var(--green)' };
    const roleColor = roleColors[userRole] || 'var(--tx3)';

    const projectName = getProjectName(activeProjId) || 'Не выбран';

    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">Профиль</div>'
      + '<div class="profile-pane-sub">Данные текущей сессии и состояние активного проекта.</div>'
      + '<div class="profile-cards">'
      + '<div class="profile-card" style="grid-column:1/-1">'
      + '<div class="profile-card-label">Email</div>'
      + '<div class="profile-card-value">' + escapeHtml(userEmail) + '</div>'
      + '</div>'
      + '<div class="profile-card">'
      + '<div class="profile-card-label">Роль</div>'
      + '<div class="profile-card-value" style="color:' + roleColor + '">' + escapeHtml(roleLabel) + '</div>'
      + '</div>'
      + '<div class="profile-card">'
      + '<div class="profile-card-label">ID пользователя</div>'
      + '<div class="profile-card-value" style="font-size:11px;word-break:break-all">' + escapeHtml(userId) + '</div>'
      + '</div>'
      + '<div class="profile-card">'
      + '<div class="profile-card-label">Токен истекает</div>'
      + '<div class="profile-card-value" style="font-size:12px">' + escapeHtml(tokenExpStr) + '</div>'
      + '<div class="profile-card-sub" style="color:' + (hoursLeft < 2 ? 'var(--red)' : 'var(--tx3)') + '">'
      + escapeHtml(hoursLeft > 0 ? 'через ' + hoursLeft + ' ч.' : 'истёк') + '</div>'
      + '</div>'
      + '<div class="profile-card">'
      + '<div class="profile-card-label">Активный проект</div>'
      + '<div class="profile-card-value">' + escapeHtml(projectName) + '</div>'
      + '</div>'
      + '<div class="profile-card">'
      + '<div class="profile-card-label">Проектов доступно</div>'
      + '<div class="profile-card-value">' + String(projects.length) + '</div>'
      + '</div>'
      + '</div>'
      + '<div id="profile-overview-stats" style="margin-top:12px">'
      + '<div class="profile-empty">Загрузка статистики...</div>'
      + '</div>'
      + '</div>';

    // Async: подгружаем реальный светофор и бюджет
    (async function () {
      const statsEl = document.getElementById('profile-overview-stats');
      if (!statsEl) { return; }
      try {
        const [tasks, budget] = await Promise.all([
          apiFetch('/stats/tasks'),
          apiFetch('/stats/budget'),
        ]);
        const inWork = (tasks.in_work || 0);
        const done = (tasks.done || 0);
        const backlog = (tasks.backlog || 0);
        const total = backlog + inWork + done;
        const earned = Number(budget.earned || 0);
        const budTotal = Number(budget.total || 0);
        const progress = Number(budget.progress || 0);
        const fmt = function (n) { return n.toLocaleString('ru-RU'); };
        statsEl.innerHTML = ''
          + '<div class="profile-cards">'
          + '<div class="profile-card">'
          + '<div class="profile-card-label">Задач всего</div>'
          + '<div class="profile-card-value">' + total + '</div>'
          + '</div>'
          + '<div class="profile-card">'
          + '<div class="profile-card-label">В работе</div>'
          + '<div class="profile-card-value" style="color:var(--yellow)">' + inWork + '</div>'
          + '</div>'
          + '<div class="profile-card">'
          + '<div class="profile-card-label">Выполнено</div>'
          + '<div class="profile-card-value" style="color:var(--green)">' + done + '</div>'
          + '</div>'
          + '<div class="profile-card">'
          + '<div class="profile-card-label">Backlog</div>'
          + '<div class="profile-card-value" style="color:var(--red)">' + backlog + '</div>'
          + '</div>'
          + '<div class="profile-card" style="grid-column:1/-1">'
          + '<div class="profile-card-label">Бюджет: заработано / всего</div>'
          + '<div class="profile-card-value">'
          + fmt(earned) + ' ₽ <span style="color:var(--tx3);font-size:12px">/ ' + fmt(budTotal) + ' ₽</span>'
          + '</div>'
          + '<div style="margin-top:8px;height:6px;border-radius:99px;background:var(--sf2);border:1px solid var(--bd2);overflow:hidden">'
          + '<div style="height:100%;width:' + Math.min(100, Math.round(progress * 100)) + '%;background:linear-gradient(90deg,var(--green),var(--gold));transition:width .3s"></div>'
          + '</div>'
          + '</div>'
          + '</div>';
      } catch (_) {
        if (statsEl) { statsEl.innerHTML = ''; }
      }
    })();
  }

  var cachedUsersList = [];

  function renderProfileRoles() {
    const content = document.getElementById('profile-content');
    if (!content) { return; }

    const jwt = decodeJwtPayload(localStorage.getItem('pk24_token'));
    const userRole = (jwt && jwt.role) || 'employee';
    const userId = (jwt && jwt.sub) || '';
    const roleLabels = { admin: 'Администратор', techlead: 'Техлид', manager: 'Менеджер', employee: 'Сотрудник' };
    const roleLabel = roleLabels[userRole] || userRole;
    const roleColors = { admin: 'var(--red)', techlead: 'var(--gold)', manager: 'var(--c-A)', employee: 'var(--green)' };
    const roleColor = roleColors[userRole] || 'var(--tx3)';
    var isAdmin = userRole === 'admin';

    var cardsHtml = projects.map(function (project) {
      const isActive = project.id === activeProjId;
      const stageCount = Array.isArray(project.stages) ? project.stages.length : 0;
      const weeks = Number(project.duration_weeks || project.weeks || 0);
      const budget = Number(project.budget_total || project.budget || 0);
      const budgetStr = budget > 0 ? budget.toLocaleString('ru-RU') + ' ₽' : '—';
      var assignHtml = '';
      if (isAdmin) {
        assignHtml = '<div class="profile-proj-field"><label class="profile-proj-lbl">Ответственный</label>'
          + '<select class="status-sel profile-proj-sel" data-assign-project="' + escapeHtml(project.id) + '">'
          + '<option value="">—</option>'
          + cachedUsersList.map(function (u) {
            return '<option value="' + escapeHtml(u.id) + '"' + (project.responsible_user_id === u.id ? ' selected' : '') + '>' + escapeHtml(u.email) + '</option>';
          }).join('')
          + '</select></div>';
      } else {
        var ownerEmail = '';
        if (project.responsible_user_id) {
          var owner = cachedUsersList.find(function (u) { return u.id === project.responsible_user_id; });
          ownerEmail = owner ? owner.email : '';
        }
        assignHtml = '<div class="profile-proj-field"><label class="profile-proj-lbl">Ответственный</label><span class="profile-proj-val">' + escapeHtml(ownerEmail || '—') + '</span></div>';
      }
      var weeksStr = weeks > 0 ? weeks + ' нед.' : '—';
      return '<div class="profile-proj-card"' + (isActive ? ' data-active="1"' : '') + '>'
        + '<div class="profile-proj-head">'
        + '<div class="profile-proj-name">' + escapeHtml(project.name) + '</div>'
        + '<div class="profile-proj-status">' + (isActive ? 'Активный' : 'Не активный') + '</div>'
        + '</div>'
        + '<div class="profile-proj-body">'
        + assignHtml
        + '<div class="profile-proj-meta">'
        + '<span>' + stageCount + ' этапов</span><span>' + budgetStr + '</span><span>' + weeksStr + '</span>'
        + '</div>'
        + '</div>'
        + '<button type="button" class="profile-proj-settings-btn" onclick="if(typeof openProjSettings===\'function\')openProjSettings(\'' + escapeHtml(project.id) + '\')" title="Настройки проекта" aria-label="Настройки">⚙</button>'
        + '</div>';
    }).join('');

    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">Проекты</div>'
      + '<div class="profile-pane-sub">Роль: <strong style="color:' + roleColor + '">' + escapeHtml(roleLabel) + '</strong></div>'
      + '<div class="profile-proj-grid">'
      + (cardsHtml || '<div class="profile-empty" style="grid-column:1/-1">Нет доступных проектов</div>')
      + '</div>'
      + '</div>';

    if (isAdmin) {
      content.querySelectorAll('[data-assign-project]').forEach(function (sel) {
        sel.onchange = function () {
          var projId = sel.getAttribute('data-assign-project');
          var uid = sel.value || null;
          apiFetch('/projects/' + projId + '/assign', { method: 'PATCH', body: { responsible_user_id: uid } })
            .then(function () { showInfo('Ответственный назначен'); loadProjectsAndActive().then(function () { renderProfileRoles(); }); })
            .catch(function (err) { showError(err.message || 'Ошибка'); });
        };
      });
      if (typeof pkDropdownInit === 'function') pkDropdownInit(content);
    }

    if (isAdmin && !cachedUsersList.length) {
      apiFetch('/api/admin/users').then(function (data) {
        cachedUsersList = Array.isArray(data && data.users) ? data.users : [];
        renderProfileRoles();
      }).catch(function () { });
    } else if (!isAdmin && projects.some(function (p) { return p.responsible_user_id; })) {
      apiFetch('/api/assignable-users').then(function (data) {
        cachedUsersList = Array.isArray(data && data.users) ? data.users : [];
      }).catch(function () { cachedUsersList = []; });
    }
  }

  function renderProfileUiSettings() {
    const content = document.getElementById('profile-content');
    if (!content) {
      return;
    }
    const design = localStorage.getItem('pk24_design') || 'v1';

    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">Настройки интерфейса</div>'
      + '<div class="profile-pane-sub">Переключение дизайна интерфейса.</div>'
      + '<div class="profile-ui-design-row" style="margin-bottom:14px">'
      + '<div class="profile-field-label" style="font-size:11px;color:var(--tx3);margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">Дизайн</div>'
      + '<div class="profile-inline-actions" style="gap:12px">'
      + '<label class="profile-radio-label"><input type="radio" name="pk24-design" value="v1"' + (design === 'v1' ? ' checked' : '') + '> Classic v1.0</label>'
      + '<label class="profile-radio-label"><input type="radio" name="pk24-design" value="v2"' + (design === 'v2' ? ' checked' : '') + '> Hero v2.0</label>'
      + '</div></div>'
      + '</div>';

    content.querySelectorAll('input[name="pk24-design"]').forEach(function (radio) {
      radio.onchange = function () {
        var val = this.value;
        localStorage.setItem('pk24_design', val);
        if (val === 'v2') {
          document.documentElement.setAttribute('data-design', 'v2');
          if (typeof pkDropdownInit === 'function') {
            pkDropdownInit(document);
          }
        } else {
          document.documentElement.removeAttribute('data-design');
          if (typeof pkDropdownDestroy === 'function') {
            pkDropdownDestroy(document);
          }
        }
      };
    });
  }

  function renderProfilePassword() {
    var content = document.getElementById('profile-content');
    if (!content) return;
    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">Смена пароля</div>'
      + '<div class="profile-pane-sub">Введите текущий и новый пароль (минимум 6 символов).</div>'
      + '<div style="display:flex;flex-direction:column;gap:10px;max-width:340px;margin-top:8px">'
      + '<input type="password" class="profile-input" id="pf-cur-pwd" placeholder="Текущий пароль" autocomplete="current-password">'
      + '<input type="password" class="profile-input" id="pf-new-pwd" placeholder="Новый пароль" autocomplete="new-password">'
      + '<input type="password" class="profile-input" id="pf-new-pwd2" placeholder="Повторите новый пароль" autocomplete="new-password">'
      + '<div id="pf-pwd-status" style="font-size:11px;min-height:1.2em;color:var(--tx3)"></div>'
      + '<button class="profile-btn" id="pf-pwd-save" style="align-self:flex-start">Сохранить пароль</button>'
      + '</div></div>';
    var saveBtn = document.getElementById('pf-pwd-save');
    if (saveBtn) {
      saveBtn.onclick = function () {
        var cur = (document.getElementById('pf-cur-pwd') || {}).value || '';
        var np = (document.getElementById('pf-new-pwd') || {}).value || '';
        var np2 = (document.getElementById('pf-new-pwd2') || {}).value || '';
        var st = document.getElementById('pf-pwd-status');
        if (!cur) { if (st) { st.textContent = 'Введите текущий пароль'; st.style.color = 'var(--red)'; } return; }
        if (np.length < 6) { if (st) { st.textContent = 'Минимум 6 символов'; st.style.color = 'var(--red)'; } return; }
        if (np !== np2) { if (st) { st.textContent = 'Пароли не совпадают'; st.style.color = 'var(--red)'; } return; }
        if (st) { st.textContent = 'Сохранение...'; st.style.color = 'var(--tx3)'; }
        saveBtn.disabled = true;
        apiFetch('/auth/change-password', { method: 'POST', body: { current_password: cur, new_password: np } })
          .then(function () { if (st) { st.textContent = 'Пароль изменён'; st.style.color = 'var(--green)'; } })
          .catch(function (err) {
            var msg = (err && err.message) || 'Ошибка';
            if (msg.includes('wrong_password')) msg = 'Неверный текущий пароль';
            if (st) { st.textContent = msg; st.style.color = 'var(--red)'; }
          })
          .finally(function () { saveBtn.disabled = false; });
      };
    }
  }

  function renderProfileLogout() {
    var content = document.getElementById('profile-content');
    if (!content) return;
    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">Выход из системы</div>'
      + '<div class="profile-pane-sub">Завершить текущую сессию и перейти на страницу входа.</div>'
      + '<div class="profile-inline-actions" style="margin-top:8px">'
      + '<button class="profile-btn danger" id="profile-logout-btn">Выйти из системы</button>'
      + '</div></div>';
    var btn = document.getElementById('profile-logout-btn');
    if (btn) {
      btn.onclick = function () {
        authToken = '';
        localStorage.removeItem('pk24_token');
        localStorage.removeItem('pk24_email');
        location.replace('/login.html');
      };
    }
  }

  function renderProfileThemeSettings() {
    var content = document.getElementById('profile-content');
    if (!content) return;
    var cur = localStorage.getItem('mossb_theme') || 'dark';
    var themes = [
      { id: 'light', label: 'Светлая', desc: 'Яркий интерфейс для работы при хорошем освещении' },
      { id: 'dark', label: 'Тёмная', desc: 'Комфортный режим для работы в тёмное время суток' },
      { id: 'system', label: 'Как в системе', desc: 'Автоматически следовать настройкам операционной системы' },
    ];
    var cards = themes.map(function (t) {
      var active = cur === t.id;
      return '<div class="profile-role-row" style="cursor:pointer;' + (active ? 'border-color:var(--gold);background:var(--gold-dim)' : '') + '" data-theme-pick="' + t.id + '">'
        + '<div style="display:flex;align-items:center;gap:10px">'
        + '<div style="width:18px;height:18px;border-radius:50%;border:2px solid ' + (active ? 'var(--gold)' : 'var(--bd3)') + ';display:flex;align-items:center;justify-content:center">'
        + (active ? '<div style="width:10px;height:10px;border-radius:50%;background:var(--gold)"></div>' : '')
        + '</div>'
        + '<div><div style="font-size:13px;font-weight:700;color:var(--tx)">' + escapeHtml(t.label) + '</div>'
        + '<div style="font-size:11px;color:var(--tx3)">' + escapeHtml(t.desc) + '</div></div>'
        + '</div></div>';
    }).join('');
    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">Тема оформления</div>'
      + '<div class="profile-pane-sub">Выберите тему интерфейса. Настройка сохраняется локально в браузере.</div>'
      + '<div class="profile-role-list" style="margin-top:8px">' + cards + '</div>'
      + '</div>';
    content.querySelectorAll('[data-theme-pick]').forEach(function (el) {
      el.onclick = function () {
        var picked = el.getAttribute('data-theme-pick');
        localStorage.setItem('mossb_theme', picked);
        if (typeof applyTheme === 'function') applyTheme();
        renderProfileThemeSettings();
      };
    });
  }

  var profileHistoryFilters = (function () {
    try {
      var s = localStorage.getItem('pk24_history_filters');
      if (s) {
        var parsed = JSON.parse(s);
        return {
          q: String(parsed.q || '').trim(),
          event_types: Array.isArray(parsed.event_types) ? parsed.event_types : [],
          from: String(parsed.from || '').trim(),
          to: String(parsed.to || '').trim(),
        };
      }
    } catch (e) { }
    return { q: '', event_types: [], from: '', to: '' };
  })();

  function saveHistoryFilters() {
    try {
      localStorage.setItem('pk24_history_filters', JSON.stringify(profileHistoryFilters));
    } catch (e) { }
  }

  function getProfileHistoryPeriod() {
    var proj = projects.find(function (p) { return p.id === activeProjId; });
    var m = proj && proj.historyRetentionMonths != null ? proj.historyRetentionMonths : 3;
    return m === 6 ? '6m' : m === 3 ? '3m' : 'all';
  }

  function getHistoryPeriodFromDate(period) {
    period = period || getProfileHistoryPeriod();
    if (period === '6m') {
      var d6 = new Date();
      d6.setMonth(d6.getMonth() - 6);
      return d6.toISOString().slice(0, 10);
    }
    if (period === 'all') return '2000-01-01';
    var d3 = new Date();
    d3.setMonth(d3.getMonth() - 3);
    return d3.toISOString().slice(0, 10);
  }

  function renderProfileHistory() {
    var content = document.getElementById('profile-content');
    if (!content) return;

    var profileHistoryPeriod = getProfileHistoryPeriod();

    var EVENT_TYPES = [
      { id: 'task_created', label: 'Создание' },
      { id: 'task_updated', label: 'Обновление' },
      { id: 'task_moved', label: 'Перемещение' },
      { id: 'task_reordered', label: 'Переупорядочение' },
      { id: 'task_deleted', label: 'Удаление' },
      { id: 'agent_action', label: 'Агент' },
    ];
    var eventTypesArr = profileHistoryFilters.event_types;
    var allSelected = !eventTypesArr || eventTypesArr.length === 0 || eventTypesArr.length === EVENT_TYPES.length;
    var eventTypeCheckboxes = EVENT_TYPES.map(function (et) {
      var checked = allSelected || (Array.isArray(eventTypesArr) && eventTypesArr.indexOf(et.id) >= 0);
      return '<label class="hist-type-cb"><input type="checkbox" value="' + escapeHtml(et.id) + '"' + (checked ? ' checked' : '') + '> ' + escapeHtml(et.label) + '</label>';
    }).join('');

    var periodOptions = '<option value="3m"' + (profileHistoryPeriod === '3m' ? ' selected' : '') + '>3 месяца</option>'
      + '<option value="6m"' + (profileHistoryPeriod === '6m' ? ' selected' : '') + '>6 месяцев</option>'
      + '<option value="all"' + (profileHistoryPeriod === 'all' ? ' selected' : '') + '>С начала проекта</option>';

    var retentionWarning = 'При укорочении срока хранения (6→3 мес. или «с начала»→ограниченный).<br>Все события старше выбранного периода будут <strong>безвозвратно удалены</strong>.';

    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">История действий</div>'
      + (activeProjId
        ? '<div class="profile-history-settings-row">'
        + '<div class="profile-field hist-period-field">'
        + '<div class="profile-field-label">Сколько храним историю</div>'
        + '<select class="profile-input" id="hist-period">' + periodOptions + '</select>'
        + '</div>'
        + '<div class="hist-retention-warn">' + retentionWarning + '</div>'
        + '</div>'
        + '<div class="pf-search-row">'
        + '<input class="profile-input" id="hist-filter-q" placeholder="Поиск по ID задачи, типу события, деталям..." value="' + escapeHtml(profileHistoryFilters.q) + '">'
        + '<button class="pf-search-clear" id="hist-search-clear" title="Очистить поиск" style="' + (profileHistoryFilters.q ? '' : 'display:none') + '">&times;</button>'
        + '</div>'
        + '<div class="pf-filter-row">'
        + '<div class="hist-type-dropdown-wrap">'
        + '<button type="button" class="profile-input hist-type-toggle" id="hist-type-toggle">Типы событий</button>'
        + '<div class="hist-type-dropdown" id="hist-type-dropdown">' + eventTypeCheckboxes + '</div>'
        + '</div>'
        + '<input class="profile-input" id="hist-filter-from" type="date" title="С даты" value="' + escapeHtml(profileHistoryFilters.from || getHistoryPeriodFromDate(profileHistoryPeriod)) + '">'
        + '<input class="profile-input" id="hist-filter-to" type="date" title="По дату" value="' + escapeHtml(profileHistoryFilters.to || new Date().toISOString().slice(0, 10)) + '">'
        + '<button class="pf-filter-btn apply" id="hist-apply-btn">Применить</button>'
        + '<button class="pf-filter-btn reset" id="hist-reset-btn">Сбросить</button>'
        + '</div>'
        + '<div id="profile-history-list"><div class="profile-empty">Загрузка событий...</div></div>'
        : '<div class="profile-empty">Выберите активный проект, чтобы увидеть историю.</div>')
      + '</div>';

    if (!activeProjId) return;

    function bindHistFilters() {
      var applyBtn = document.getElementById('hist-apply-btn');
      var resetBtn = document.getElementById('hist-reset-btn');
      var clearBtn = document.getElementById('hist-search-clear');
      var qInput = document.getElementById('hist-filter-q');
      var periodSelect = document.getElementById('hist-period');

      if (periodSelect) {
        periodSelect.onchange = function () {
          var newVal = periodSelect.value || '3m';
          var oldVal = getProfileHistoryPeriod();
          var retentionMonths = newVal === '6m' ? 6 : newVal === '3m' ? 3 : null;
          var isShortening = (oldVal === 'all' && newVal !== 'all') || (oldVal === '6m' && newVal === '3m');
          if (isShortening) {
            var msg = newVal === '3m'
              ? 'Переключение на 3 месяца безвозвратно удалит все события старше 3 месяцев. Продолжить?'
              : 'Переключение на 6 месяцев безвозвратно удалит все события старше 6 месяцев. Продолжить?';
            if (!confirm(msg)) {
              periodSelect.value = oldVal;
              return;
            }
          }
          apiFetch('/projects/' + activeProjId + '/history-retention', {
            method: 'POST',
            body: { retention_months: retentionMonths },
          }).then(function (data) {
            var proj = projects.find(function (p) { return p.id === activeProjId; });
            if (proj && data && data.project) {
              proj.historyRetentionMonths = data.project.history_retention_months;
            }
            var fromEl = document.getElementById('hist-filter-from');
            var toEl = document.getElementById('hist-filter-to');
            if (fromEl && !profileHistoryFilters.from) fromEl.value = getHistoryPeriodFromDate(newVal);
            if (toEl && !profileHistoryFilters.to) toEl.value = new Date().toISOString().slice(0, 10);
            applyHistoryFilters();
            if (data && data.deleted_events > 0) {
              showInfo('Удалено событий старше срока: ' + data.deleted_events);
            }
          }).catch(function (err) {
            periodSelect.value = oldVal;
            showError('Не удалось изменить срок хранения: ' + (err.message || err));
          });
        };
      }

      if (applyBtn) applyBtn.onclick = function () { applyHistoryFilters(); };
      if (resetBtn) resetBtn.onclick = function () {
        profileHistoryFilters = { q: '', event_types: [], from: '', to: '' };
        saveHistoryFilters();
        renderProfileHistory();
      };
      if (clearBtn) clearBtn.onclick = function () {
        if (qInput) qInput.value = '';
        clearBtn.style.display = 'none';
        profileHistoryFilters.q = '';
        applyHistoryFilters();
      };
      if (qInput) {
        qInput.oninput = function () {
          var c = document.getElementById('hist-search-clear');
          if (c) c.style.display = qInput.value ? '' : 'none';
        };
        qInput.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); applyHistoryFilters(); } };
      }

      var typeToggle = document.getElementById('hist-type-toggle');
      var typeDropdown = document.getElementById('hist-type-dropdown');
      if (typeToggle && typeDropdown) {
        typeToggle.onclick = function (e) {
          e.stopPropagation();
          var wasOpen = typeDropdown.classList.contains('open');
          typeDropdown.classList.toggle('open');
          if (!wasOpen) {
            setTimeout(function () {
              function closeHandler() {
                document.removeEventListener('click', closeHandler);
                typeDropdown.classList.remove('open');
              }
              document.addEventListener('click', closeHandler);
            }, 0);
          }
        };
        typeDropdown.onclick = function (e) { e.stopPropagation(); };
      }
    }

    function applyHistoryFilters() {
      profileHistoryFilters.q = String((document.getElementById('hist-filter-q') || {}).value || '').trim();
      var typeCheckboxes = document.querySelectorAll('#hist-type-dropdown input[type="checkbox"]:checked');
      var checkedTypes = Array.prototype.slice.call(typeCheckboxes || []).map(function (cb) { return cb.value; });
      profileHistoryFilters.event_types = checkedTypes.length === EVENT_TYPES.length ? [] : checkedTypes;
      profileHistoryFilters.from = String((document.getElementById('hist-filter-from') || {}).value || '').trim();
      profileHistoryFilters.to = String((document.getElementById('hist-filter-to') || {}).value || '').trim();
      saveHistoryFilters();
      loadHistoryEvents();
    }

    function loadHistoryEvents() {
      var listEl = document.getElementById('profile-history-list');
      if (!listEl) return;
      listEl.innerHTML = '<div class="profile-empty">Загрузка событий...</div>';

      function doFetchEvents() {
        var params = new URLSearchParams();
      params.set('limit', '500');
      if (profileHistoryFilters.q) params.set('q', profileHistoryFilters.q);
      if (profileHistoryFilters.event_types && profileHistoryFilters.event_types.length > 0) {
        params.set('event_types', profileHistoryFilters.event_types.join(','));
      }
      var fromVal = profileHistoryFilters.from || getHistoryPeriodFromDate(getProfileHistoryPeriod());
      var toVal = profileHistoryFilters.to || new Date().toISOString().slice(0, 10);
      params.set('from', fromVal);
      params.set('to', toVal);

      var EVENT_LABELS = {
        task_created: '✦ Создана', task_updated: '✎ Обновлена', task_moved: '→ Перемещена',
        task_reordered: '⇅ Переупорядочена', task_deleted: '✕ Удалена', agent_action: '⚡ Агент',
      };
      var EVENT_COLORS = {
        task_created: 'var(--green)', task_updated: 'var(--gold)', task_moved: 'var(--c-A)',
        task_reordered: 'var(--tx3)', task_deleted: 'var(--red)', agent_action: 'var(--c-R1)',
      };

      apiFetch('/projects/' + activeProjId + '/events?' + params.toString())
        .then(function (data) {
          var events = Array.isArray(data && data.events) ? data.events : [];
          if (!events.length) { listEl.innerHTML = '<div class="profile-empty">Событий не найдено.</div>'; return; }
          var rows = events.map(function (ev) {
            var label = EVENT_LABELS[ev.event_type] || escapeHtml(ev.event_type);
            var color = EVENT_COLORS[ev.event_type] || 'var(--tx2)';
            var taskIdShort = ev.task_id ? String(ev.task_id).slice(0, 8) + '…' : '—';
            var taskTitle = (ev.payload && ev.payload.title) || (ev.after && ev.after.title) || (ev.before && ev.before.title) || null;
            if (!taskTitle && ev.task_id && typeof tasks !== 'undefined' && Array.isArray(tasks)) {
              var t = tasks.find(function (x) { return x.id === ev.task_id || x.raw_id === ev.task_id; });
              if (t) taskTitle = t.title;
            }
            var taskTitleEsc = taskTitle ? escapeHtml(taskTitle) : '—';
            var actorStr = ev.actor_email ? ' Кем: ' + escapeHtml(ev.actor_email) : '';
            var detail = '';
            if (ev.event_type === 'task_moved' && ev.payload && ev.payload.from_col && ev.payload.to_col) {
              detail = 'Из ' + escapeHtml(ev.payload.from_col) + ' в ' + escapeHtml(ev.payload.to_col) + '.' + actorStr;
            } else if (ev.event_type === 'task_updated' && ev.payload && Array.isArray(ev.payload.fields_changed) && ev.payload.fields_changed.length) {
              var changes = ev.payload.fields_changed.map(function (f) {
                var b = ev.before && ev.before[f];
                var a = ev.after && ev.after[f];
                if (f === 'title' || f === 'col' || f === 'stage') {
                  return escapeHtml(f) + ': ' + escapeHtml(String(b || '—')) + ' → ' + escapeHtml(String(a || '—'));
                }
                return escapeHtml(f);
              }).join('; ');
              detail = changes + actorStr;
            } else if (ev.event_type === 'task_reordered' && ev.payload) {
              var col = ev.payload.column || '';
              var pos = ev.payload.position != null ? Number(ev.payload.position) + 1 : '';
              detail = 'Столбец ' + escapeHtml(col) + (pos ? ', позиция ' + pos : '') + '.' + actorStr;
            } else if (ev.event_type === 'task_created' && ev.payload) {
              detail = (ev.payload.source ? escapeHtml(ev.payload.source) : (ev.payload.title ? escapeHtml(ev.payload.title) : '')) + actorStr;
            } else if (ev.payload && ev.payload.title) {
              detail = escapeHtml(ev.payload.title) + actorStr;
            } else if (ev.payload && Array.isArray(ev.payload.fields_changed)) {
              detail = ev.payload.fields_changed.map(escapeHtml).join(', ') + actorStr;
            } else if (actorStr) {
              detail = actorStr.trim();
            }
            return '<div class="profile-role-row hist-row" style="gap:10px;align-items:flex-start;cursor:default">'
              + '<div style="font-size:11px;color:' + color + ';font-weight:600;flex-shrink:0;min-width:110px">' + label + '</div>'
              + '<div style="font-size:11px;color:var(--tx3);flex-shrink:0;min-width:70px;font-family:\'DM Mono\',monospace">' + escapeHtml(taskIdShort) + '</div>'
              + '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">'
              + '<div style="font-size:12px;font-weight:600;color:var(--tx);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + taskTitleEsc + '</div>'
              + '<div style="font-size:11px;color:var(--tx3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (detail || '—') + '</div>'
              + '</div>'
              + '<div style="font-size:10px;color:var(--tx4);flex-shrink:0;white-space:nowrap">' + escapeHtml(formatDateTime(ev.created_at)) + '</div>'
              + '</div>';
          }).join('');
          listEl.innerHTML = '<div class="profile-role-list">' + rows + '</div>';
        })
        .catch(function (err) {
          if (listEl) listEl.innerHTML = '<div class="profile-empty">Ошибка загрузки: ' + escapeHtml(err.message) + '</div>';
        });
      }

      doFetchEvents();
    }

    bindHistFilters();
    if (typeof pkDropdownInit === 'function') pkDropdownInit(content);
    loadHistoryEvents();
  }

  function renderProfileRights() {
    var content = document.getElementById('profile-content');
    if (!content) return;
    content.innerHTML = '<div class="profile-pane"><div class="profile-pane-title">Управление пользователями</div>'
      + '<div class="profile-pane-sub">Создание, редактирование и удаление пользователей. Администратор и Менеджер.</div>'
      + '<div id="pf-users-list"><div class="profile-empty">Загрузка...</div></div>'
      + '<div style="margin-top:12px"><button class="profile-btn" id="pf-user-create-btn">Создать пользователя</button></div>'
      + '</div>';

    var createBtn = document.getElementById('pf-user-create-btn');
    if (createBtn) createBtn.onclick = function () { openUserCreateModal(); };
    loadUsersList();
  }

  function loadUsersList() {
    var listEl = document.getElementById('pf-users-list');
    if (!listEl) return;
    apiFetch('/api/admin/users').then(function (data) {
      var users = Array.isArray(data && data.users) ? data.users : [];
      if (!users.length) { listEl.innerHTML = '<div class="profile-empty">Пользователей нет.</div>'; return; }
      var roleLabels = { admin: 'Администратор', techlead: 'Техлид', manager: 'Менеджер', employee: 'Сотрудник' };
      var roleColors = { admin: 'var(--red)', techlead: 'var(--gold)', manager: 'var(--c-A)', employee: 'var(--green)' };
      var rows = users.map(function (u) {
        return '<div class="profile-role-row" style="gap:10px">'
          + '<div style="flex:1;min-width:0;font-size:12px;color:var(--tx);font-weight:600;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(u.email) + '</div>'
          + '<div style="font-size:11px;color:' + (roleColors[u.role] || 'var(--tx3)') + ';font-weight:600;min-width:100px">' + escapeHtml(roleLabels[u.role] || u.role) + '</div>'
          + '<div style="font-size:11px;color:var(--tx3);min-width:70px">' + (u.status === 'active' ? '<span style="color:var(--green)">Активен</span>' : '<span style="color:var(--red)">Отключён</span>') + '</div>'
          + '<div style="display:flex;gap:6px;flex-shrink:0">'
          + '<button class="profile-btn small" data-user-edit="' + escapeHtml(u.id) + '">Изменить</button>'
          + '<button class="profile-btn small danger ghost" data-user-delete="' + escapeHtml(u.id) + '">Удалить</button>'
          + '</div></div>';
      }).join('');
      listEl.innerHTML = '<div class="profile-role-list">' + rows + '</div>';
      listEl.querySelectorAll('[data-user-edit]').forEach(function (btn) {
        btn.onclick = function () { openUserEditModal(btn.getAttribute('data-user-edit'), users); };
      });
      listEl.querySelectorAll('[data-user-delete]').forEach(function (btn) {
        btn.onclick = function () { openUserDeleteModal(btn.getAttribute('data-user-delete'), users); };
      });
    }).catch(function (err) {
      if (listEl) listEl.innerHTML = '<div class="profile-empty">Ошибка: ' + escapeHtml(err.message) + '</div>';
    });
  }

  function openUserCreateModal() {
    var ov = document.createElement('div');
    ov.className = 'overlay open';
    ov.innerHTML = '<div class="bridge-confirm-card" style="width:400px;max-width:94vw">'
      + '<div class="bridge-confirm-title">Создать пользователя</div>'
      + '<div style="display:flex;flex-direction:column;gap:8px;margin:10px 0">'
      + '<input class="profile-input" id="uc-email" placeholder="Email">'
      + '<input class="profile-input" id="uc-pwd" type="password" placeholder="Пароль (мин. 6 символов)">'
      + '<select class="profile-input" id="uc-role"><option value="manager">Менеджер</option><option value="admin">Администратор</option></select>'
      + '</div><div id="uc-status" style="font-size:11px;min-height:1.2em;color:var(--tx3)"></div>'
      + '<div class="bridge-confirm-row">'
      + '<button class="bridge-confirm-btn no" id="uc-cancel">Отмена</button>'
      + '<button class="bridge-confirm-btn yes" id="uc-confirm">Создать</button>'
      + '</div></div>';
    document.body.appendChild(ov);
    document.getElementById('uc-cancel').onclick = function () { ov.remove(); };
    document.getElementById('uc-confirm').onclick = function () {
      var email = (document.getElementById('uc-email') || {}).value || '';
      var pwd = (document.getElementById('uc-pwd') || {}).value || '';
      var role = (document.getElementById('uc-role') || {}).value || 'manager';
      var st = document.getElementById('uc-status');
      if (!email || !email.includes('@')) { if (st) { st.textContent = 'Введите email'; st.style.color = 'var(--red)'; } return; }
      if (pwd.length < 6) { if (st) { st.textContent = 'Минимум 6 символов'; st.style.color = 'var(--red)'; } return; }
      if (st) { st.textContent = 'Создание...'; st.style.color = 'var(--tx3)'; }
      apiFetch('/api/admin/users', { method: 'POST', body: { email: email, password: pwd, role: role } })
        .then(function () { ov.remove(); showInfo('Пользователь создан'); loadUsersList(); })
        .catch(function (err) { if (st) { st.textContent = (err.message || 'Ошибка').replace('email_already_exists', 'Email уже занят'); st.style.color = 'var(--red)'; } });
    };
  }

  function openUserEditModal(userId, users) {
    var u = (users || []).find(function (x) { return x.id === userId; });
    if (!u) return;
    var ov = document.createElement('div');
    ov.className = 'overlay open';
    ov.innerHTML = '<div class="bridge-confirm-card" style="width:400px;max-width:94vw">'
      + '<div class="bridge-confirm-title">Редактировать: ' + escapeHtml(u.email) + '</div>'
      + '<div style="display:flex;flex-direction:column;gap:8px;margin:10px 0">'
      + '<input class="profile-input" id="ue-email" placeholder="Email" value="' + escapeHtml(u.email) + '">'
      + '<select class="profile-input" id="ue-role"><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Администратор</option><option value="manager"' + (u.role === 'manager' ? ' selected' : '') + '>Менеджер</option></select>'
      + '<select class="profile-input" id="ue-status"><option value="active"' + (u.status === 'active' ? ' selected' : '') + '>Активен</option><option value="disabled"' + (u.status !== 'active' ? ' selected' : '') + '>Отключён</option></select>'
      + '<input class="profile-input" id="ue-pwd" type="password" placeholder="Новый пароль (оставьте пустым)">'
      + '</div><div id="ue-status-msg" style="font-size:11px;min-height:1.2em;color:var(--tx3)"></div>'
      + '<div class="bridge-confirm-row">'
      + '<button class="bridge-confirm-btn no" id="ue-cancel">Отмена</button>'
      + '<button class="bridge-confirm-btn yes" id="ue-save">Сохранить</button>'
      + '</div></div>';
    document.body.appendChild(ov);
    document.getElementById('ue-cancel').onclick = function () { ov.remove(); };
    document.getElementById('ue-save').onclick = function () {
      var body = {};
      var email = (document.getElementById('ue-email') || {}).value || '';
      var role = (document.getElementById('ue-role') || {}).value || '';
      var status = (document.getElementById('ue-status') || {}).value || '';
      var pwd = (document.getElementById('ue-pwd') || {}).value || '';
      if (email && email !== u.email) body.email = email;
      if (role && role !== u.role) body.role = role;
      if (status && status !== u.status) body.status = status;
      if (pwd) body.password = pwd;
      var st = document.getElementById('ue-status-msg');
      if (Object.keys(body).length === 0) { if (st) { st.textContent = 'Нет изменений'; } return; }
      if (st) { st.textContent = 'Сохранение...'; st.style.color = 'var(--tx3)'; }
      apiFetch('/api/admin/users/' + userId, { method: 'PATCH', body: body })
        .then(function () { ov.remove(); showInfo('Пользователь обновлён'); loadUsersList(); })
        .catch(function (err) { if (st) { st.textContent = err.message || 'Ошибка'; st.style.color = 'var(--red)'; } });
    };
  }

  function openUserDeleteModal(userId, users) {
    var u = (users || []).find(function (x) { return x.id === userId; });
    if (!u) return;
    var allUsers = (users || []).filter(function (x) { return x.id !== userId; });
    var opts = allUsers.map(function (x) { return '<option value="' + escapeHtml(x.id) + '">' + escapeHtml(x.email) + '</option>'; }).join('');
    var ov = document.createElement('div');
    ov.className = 'overlay open';
    ov.innerHTML = '<div class="bridge-confirm-card" style="width:460px;max-width:94vw">'
      + '<div class="bridge-confirm-title">Удалить пользователя: ' + escapeHtml(u.email) + '</div>'
      + '<div class="bridge-confirm-sub">Сначала перенесите проекты и задачи другому пользователю.</div>'
      + '<div style="margin:10px 0"><select class="profile-input" id="ud-target">' + opts + '</select></div>'
      + '<div id="ud-status" style="font-size:11px;min-height:1.2em;color:var(--tx3)"></div>'
      + '<div class="bridge-confirm-row">'
      + '<button class="bridge-confirm-btn no" id="ud-cancel">Отмена</button>'
      + '<button class="bridge-confirm-btn yes" id="ud-transfer">Перенести и удалить</button>'
      + '</div></div>';
    document.body.appendChild(ov);
    document.getElementById('ud-cancel').onclick = function () { ov.remove(); };
    document.getElementById('ud-transfer').onclick = function () {
      var target = (document.getElementById('ud-target') || {}).value || '';
      var st = document.getElementById('ud-status');
      if (!target) { if (st) { st.textContent = 'Выберите пользователя'; st.style.color = 'var(--red)'; } return; }
      if (st) { st.textContent = 'Перенос данных...'; st.style.color = 'var(--tx3)'; }
      apiFetch('/api/admin/users/' + userId + '/transfer', { method: 'POST', body: { target_user_id: target } })
        .then(function () {
          if (st) { st.textContent = 'Удаление...'; }
          return apiFetch('/api/admin/users/' + userId, { method: 'DELETE' });
        })
        .then(function () { ov.remove(); showInfo('Пользователь удалён'); loadUsersList(); })
        .catch(function (err) { if (st) { st.textContent = err.message || 'Ошибка'; st.style.color = 'var(--red)'; } });
    };
  }

  function renderProfileDataDeletion() {
    var content = document.getElementById('profile-content');
    if (!content) return;
    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">Удаление данных</div>'
      + '<div class="profile-pane-sub" style="color:var(--red)">Внимание! Удаление данных необратимо. Убедитесь, что вы действительно хотите это сделать.</div>'
      + '<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">'
      + '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--tx2);cursor:pointer"><input type="checkbox" id="dd-events"> История действий (task_events)</label>'
      + '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--tx2);cursor:pointer"><input type="checkbox" id="dd-trash"> Удалённые задачи (task_trash)</label>'
      + '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--tx2);cursor:pointer"><input type="checkbox" id="dd-llm"> Статистика LLM (llm_requests)</label>'
      + '</div>'
      + '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">'
      + '<button class="profile-btn danger" id="dd-selected">Удалить выбранное</button>'
      + '<button class="profile-btn danger" id="dd-all-stats">Удалить все статистические данные</button>'
      + '</div>'
      + '<div id="dd-status" style="font-size:11px;min-height:1.2em;color:var(--tx3);margin-top:8px"></div>'
      + '<hr style="border:none;border-top:1px solid var(--bd2);margin:16px 0">'
      + '<div class="profile-pane-title" style="font-size:14px;color:var(--red)">Удалить аккаунт</div>'
      + '<div class="profile-pane-sub">Для подтверждения введите ваш email. Это действие необратимо.</div>'
      + '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;max-width:400px">'
      + '<input class="profile-input" id="dd-confirm-email" placeholder="Введите ваш email">'
      + '<button class="profile-btn danger" id="dd-delete-account">Удалить аккаунт</button>'
      + '</div>'
      + '<div id="dd-account-status" style="font-size:11px;min-height:1.2em;color:var(--tx3);margin-top:4px"></div>'
      + '</div>';

    document.getElementById('dd-selected').onclick = function () {
      var st = document.getElementById('dd-status');
      var promises = [];
      if ((document.getElementById('dd-events') || {}).checked) promises.push(apiFetch('/api/admin/data/events', { method: 'DELETE' }));
      if ((document.getElementById('dd-trash') || {}).checked) promises.push(apiFetch('/api/admin/data/trash', { method: 'DELETE' }));
      if ((document.getElementById('dd-llm') || {}).checked) promises.push(apiFetch('/api/admin/data/llm-stats', { method: 'DELETE' }));
      if (!promises.length) { if (st) { st.textContent = 'Выберите хотя бы один пункт'; st.style.color = 'var(--red)'; } return; }
      if (!confirm('Это действие безвозвратно удалит выбранные данные. Продолжить?')) return;
      if (st) { st.textContent = 'Удаление...'; st.style.color = 'var(--tx3)'; }
      Promise.all(promises)
        .then(function () { if (st) { st.textContent = 'Данные удалены'; st.style.color = 'var(--green)'; } })
        .catch(function (err) { if (st) { st.textContent = err.message || 'Ошибка'; st.style.color = 'var(--red)'; } });
    };

    document.getElementById('dd-all-stats').onclick = function () {
      var st = document.getElementById('dd-status');
      if (!confirm('Это безвозвратно удалит ВСЮ статистику (историю, корзину, LLM-запросы). Продолжить?')) return;
      if (st) { st.textContent = 'Удаление...'; st.style.color = 'var(--tx3)'; }
      apiFetch('/api/admin/data/all-stats', { method: 'DELETE' })
        .then(function () { if (st) { st.textContent = 'Все статистические данные удалены'; st.style.color = 'var(--green)'; } })
        .catch(function (err) { if (st) { st.textContent = err.message || 'Ошибка'; st.style.color = 'var(--red)'; } });
    };

    document.getElementById('dd-delete-account').onclick = function () {
      var email = (document.getElementById('dd-confirm-email') || {}).value || '';
      var st = document.getElementById('dd-account-status');
      var jwt = decodeJwtPayload(localStorage.getItem('pk24_token'));
      var myEmail = (jwt && jwt.email) || '';
      if (!email || email !== myEmail) { if (st) { st.textContent = 'Email не совпадает с вашим аккаунтом'; st.style.color = 'var(--red)'; } return; }
      if (!confirm('Вы уверены? Это действие БЕЗВОЗВРАТНО удалит ваш аккаунт.')) return;
      if (st) { st.textContent = 'Удаление аккаунта...'; st.style.color = 'var(--tx3)'; }
      apiFetch('/api/admin/account', { method: 'DELETE', body: { confirm_email: email } })
        .then(function () {
          authToken = '';
          localStorage.removeItem('pk24_token');
          localStorage.removeItem('pk24_email');
          location.replace('/login.html');
        })
        .catch(function (err) { if (st) { st.textContent = err.message || 'Ошибка'; st.style.color = 'var(--red)'; } });
    };
  }

  function renderProfileSecurity() {
    renderProfileLogout();
  }

  function applyTrashFiltersFromDom() {
    profileTrashFilters.q = String((document.getElementById('trash-filter-q') || {}).value || '').trim();
    profileTrashFilters.project_id = String((document.getElementById('trash-filter-project') || {}).value || '').trim();
    profileTrashFilters.stage = String((document.getElementById('trash-filter-stage') || {}).value || '').trim();
    profileTrashFilters.deleted_by = String((document.getElementById('trash-filter-author') || {}).value || '').trim();
    profileTrashFilters.deleted_from = String((document.getElementById('trash-filter-from') || {}).value || '').trim();
    profileTrashFilters.deleted_to = String((document.getElementById('trash-filter-to') || {}).value || '').trim();
    loadDeletedTasks();
  }

  function bindTrashFilterFormEvents() {
    const applyButton = document.getElementById('trash-apply-btn');
    const resetButton = document.getElementById('trash-reset-btn');
    const clearButton = document.getElementById('trash-search-clear');

    if (applyButton) {
      applyButton.onclick = function () { applyTrashFiltersFromDom(); };
    }

    if (resetButton) {
      resetButton.onclick = function () {
        profileTrashFilters = { q: '', project_id: '', stage: '', deleted_by: '', deleted_from: '', deleted_to: '' };
        renderProfileTrash();
        loadDeletedTasks();
      };
    }

    if (clearButton) {
      clearButton.onclick = function () {
        var qInput = document.getElementById('trash-filter-q');
        if (qInput) { qInput.value = ''; }
        clearButton.style.display = 'none';
        profileTrashFilters.q = '';
        applyTrashFiltersFromDom();
      };
    }

    var quickSearch = document.getElementById('trash-filter-q');
    if (quickSearch) {
      quickSearch.oninput = function () {
        var c = document.getElementById('trash-search-clear');
        if (c) c.style.display = quickSearch.value ? '' : 'none';
      };
      quickSearch.onkeydown = function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          applyTrashFiltersFromDom();
        }
      };
    }
  }

  function renderTrashRows() {
    const list = document.getElementById('trash-list');
    if (!list) {
      return;
    }

    if (profileTrashLoading) {
      list.innerHTML = '<div class="profile-empty">Загрузка удаленных задач...</div>';
      return;
    }

    if (!profileTrashItems.length) {
      list.innerHTML = '<div class="profile-empty">Удаленных задач не найдено</div>';
      return;
    }

    list.innerHTML = profileTrashItems
      .map(function (item) {
        return ''
          + '<div class="trash-row">'
          + '<div class="trash-cell id">' + escapeHtml(item.id) + '</div>'
          + '<div class="trash-cell title">'
          + '<div class="trash-title-main">' + escapeHtml(item.title) + '</div>'
          + '<div class="trash-title-sub">Agent: ' + escapeHtml(item.agent || '—') + '</div>'
          + '</div>'
          + '<div class="trash-cell">' + escapeHtml(formatDateTime(item.deleted_at)) + '</div>'
          + '<div class="trash-cell">' + escapeHtml(item.deleted_by || '—') + '</div>'
          + '<div class="trash-cell">' + escapeHtml(item.project_name || getProjectName(item.project_id)) + '</div>'
          + '<div class="trash-cell">' + escapeHtml(formatColLabel(item.col)) + '</div>'
          + '<div class="trash-cell"><span class="trash-stage" style="--stage-color:' + ensureStageColor(item.stage, null) + '">' + escapeHtml(item.stage) + '</span></div>'
          + '<div class="trash-cell actions">'
          + '<button class="trash-action-btn trash-action-restore" data-trash-action="restore" data-trash-id="' + escapeHtml(item.raw_id) + '" title="Восстановить"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>'
          + '<button class="trash-action-btn trash-action-purge" data-trash-action="purge" data-trash-id="' + escapeHtml(item.raw_id) + '" title="Удалить навсегда"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>'
          + '</div>'
          + '</div>';
      })
      .join('');

    list.querySelectorAll('[data-trash-action="restore"]').forEach(function (button) {
      button.onclick = function () {
        const rawId = button.getAttribute('data-trash-id');
        const item = profileTrashItems.find(function (task) {
          return task.raw_id === rawId;
        });
        if (item) {
          openRestoreTrashTaskModal(item);
        }
      };
    });
    list.querySelectorAll('[data-trash-action="purge"]').forEach(function (button) {
      button.onclick = function () {
        const rawId = button.getAttribute('data-trash-id');
        const item = profileTrashItems.find(function (task) {
          return task.raw_id === rawId;
        });
        if (item) {
          openPurgeTrashTaskModal(item);
        }
      };
    });
  }

  var trashDeletedByUsers = [];

  function renderProfileTrash() {
    const content = document.getElementById('profile-content');
    if (!content) {
      return;
    }

    const allStages = Array.from(
      new Set(
        projects.reduce(function (acc, item) {
          if (Array.isArray(item.stages)) {
            return acc.concat(item.stages);
          }
          return acc;
        }, [])
      )
    ).sort(function (a, b) {
      return String(a).localeCompare(String(b), 'ru');
    });

    const projectOptions = ['<option value="">Все проекты</option>']
      .concat(
        projects.map(function (item) {
          return '<option value="' + escapeHtml(item.id) + '"' +
            (profileTrashFilters.project_id === item.id ? ' selected' : '') +
            '>' + escapeHtml(item.name) + '</option>';
        })
      )
      .join('');

    const stageOptions = ['<option value="">Все этапы</option>']
      .concat(
        allStages.map(function (stage) {
          return '<option value="' + escapeHtml(stage) + '"' +
            (profileTrashFilters.stage === stage ? ' selected' : '') +
            '>' + escapeHtml(stage) + '</option>';
        })
      )
      .join('');

    const deletedByOptions = ['<option value="">Все пользователи</option>']
      .concat(
        (trashDeletedByUsers || []).map(function (email) {
          return '<option value="' + escapeHtml(email) + '"' +
            (profileTrashFilters.deleted_by === email ? ' selected' : '') +
            '>' + escapeHtml(email) + '</option>';
        })
      )
      .join('');

    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">Удаленные задачи</div>'
      + '<div class="profile-pane-sub">Архив удаленных задач с восстановлением в проект, столбец и этап.</div>'
      + '<div class="pf-search-row">'
      + '<input class="profile-input" id="trash-filter-q" placeholder="Поиск по ID, названию, описанию, агенту..." value="' + escapeHtml(profileTrashFilters.q) + '">'
      + '<button class="pf-search-clear" id="trash-search-clear" title="Очистить поиск" style="' + (profileTrashFilters.q ? '' : 'display:none') + '">&times;</button>'
      + '</div>'
      + '<div class="pf-filter-row">'
      + '<select class="profile-input" id="trash-filter-project">' + projectOptions + '</select>'
      + '<select class="profile-input" id="trash-filter-stage">' + stageOptions + '</select>'
      + '<select class="profile-input" id="trash-filter-author">' + deletedByOptions + '</select>'
      + '<input class="profile-input" id="trash-filter-from" type="date" title="С даты" value="' + escapeHtml(profileTrashFilters.deleted_from) + '">'
      + '<input class="profile-input" id="trash-filter-to" type="date" title="По дату" value="' + escapeHtml(profileTrashFilters.deleted_to) + '">'
      + '<button class="pf-filter-btn apply" id="trash-apply-btn">Применить</button>'
      + '<button class="pf-filter-btn reset" id="trash-reset-btn">Сбросить</button>'
      + '</div>'
      + '<div class="profile-trash-table-wrap">'
      + '<div class="trash-head">'
      + '<div>ID</div><div>Задача</div><div>Удалена</div><div>Кем</div><div>Проект</div><div>Столбец</div><div>Этап</div><div>Действия</div>'
      + '</div>'
      + '<div id="trash-list" class="trash-list"></div>'
      + '</div>'
      + '</div>';

    bindTrashFilterFormEvents();
    renderTrashRows();
  }

  async function loadDeletedTasks() {
    profileTrashLoading = true;
    renderTrashRows();

    const params = new URLSearchParams();
    Object.keys(profileTrashFilters).forEach(function (key) {
      const value = profileTrashFilters[key];
      if (value) {
        params.set(key, value);
      }
    });

    try {
      const response = await apiFetch(
        '/tasks/trash' + (params.toString() ? '?' + params.toString() : '')
      );
      const rows = Array.isArray(response && response.items)
        ? response.items
        : Array.isArray(response && response.tasks)
          ? response.tasks
          : [];
      profileTrashItems = rows.map(mapDeletedTaskFromApi);
      if (Array.isArray(response && response.deleted_by_users)) {
        trashDeletedByUsers = response.deleted_by_users;
      }
    } catch (error) {
      profileTrashItems = [];
      showError('Trash list failed: ' + error.message);
    } finally {
      profileTrashLoading = false;
      renderTrashRows();
    }
  }

  function openRestoreTrashTaskModal(item) {
    let overlay = document.getElementById('trash-restore-ov');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'trash-restore-ov';
      overlay.className = 'overlay open';
      overlay.innerHTML = ''
        + '<div class="bridge-confirm-card profile-modal-wide">'
        + '<div class="bridge-confirm-title">Восстановить задачу</div>'
        + '<div class="bridge-confirm-sub">Укажите проект, столбец и этап, затем подтвердите восстановление.</div>'
        + '<div class="profile-restore-grid">'
        + '<div class="profile-field"><div class="profile-field-label">Проект</div><select id="trash-restore-project" class="profile-input"></select></div>'
        + '<div class="profile-field"><div class="profile-field-label">Столбец</div><select id="trash-restore-col" class="profile-input"></select></div>'
        + '<div class="profile-field"><div class="profile-field-label">Этап</div><select id="trash-restore-stage" class="profile-input"></select></div>'
        + '<div class="profile-field" id="trash-restore-stage-create-wrap" style="display:none;">'
        + '<div class="profile-field-label">Новый этап</div><input id="trash-restore-stage-create" class="profile-input" placeholder="Название этапа">'
        + '</div>'
        + '</div>'
        + '<div class="profile-inline-hint" id="trash-restore-stage-hint" style="margin-top:8px;"></div>'
        + '<div class="trash-preview" id="trash-restore-preview"></div>'
        + '<div class="bridge-confirm-row">'
        + '<button class="bridge-confirm-btn no" id="trash-restore-cancel">Отмена</button>'
        + '<button class="bridge-confirm-btn yes" id="trash-restore-confirm">Подтвердить восстановление</button>'
        + '</div>'
        + '</div>';
      document.body.appendChild(overlay);
    }

    overlay.classList.add('open');
    const projectSelect = document.getElementById('trash-restore-project');
    const colSelect = document.getElementById('trash-restore-col');
    const stageSelect = document.getElementById('trash-restore-stage');
    const stageCreateWrap = document.getElementById('trash-restore-stage-create-wrap');
    const stageCreateInput = document.getElementById('trash-restore-stage-create');
    const stageHint = document.getElementById('trash-restore-stage-hint');
    const preview = document.getElementById('trash-restore-preview');
    const cancelButton = document.getElementById('trash-restore-cancel');
    const confirmButton = document.getElementById('trash-restore-confirm');

    if (
      !projectSelect ||
      !colSelect ||
      !stageSelect ||
      !stageCreateWrap ||
      !stageCreateInput ||
      !stageHint ||
      !preview ||
      !cancelButton ||
      !confirmButton
    ) {
      return;
    }

    projectSelect.innerHTML = projects
      .map(function (project) {
        return '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name) + '</option>';
      })
      .join('');
    if (!projects.length) {
      showError('Нет проектов для восстановления задачи');
      overlay.remove();
      return;
    }

    const defaultProjectId = item.project_id || activeProjId || projects[0].id;
    if (projects.some(function (project) { return project.id === defaultProjectId; })) {
      projectSelect.value = defaultProjectId;
    } else {
      projectSelect.value = projects[0].id;
    }

    var colsForTrash = typeof getProjectColumns === 'function' ? getProjectColumns() : [{ id: 'backlog', label: 'Backlog' }, { id: 'todo', label: 'To Do' }, { id: 'inprogress', label: 'In Progress' }, { id: 'review', label: 'Review' }, { id: 'done', label: 'Done' }];
    colSelect.innerHTML = colsForTrash.map(function (col) {
      return '<option value="' + col.id + '">' + escapeHtml(col.label) + '</option>';
    }).join('');
    colSelect.value = item.col || 'backlog';

    const updateStageSelect = function () {
      const stages = getProjectStages(projectSelect.value);
      const originalStage = String(item.stage || '').trim();
      const hasOriginal = stages.some(function (stage) {
        return stage.toLowerCase() === originalStage.toLowerCase();
      });

      stageSelect.innerHTML = stages
        .map(function (stage) {
          return '<option value="' + escapeHtml(stage) + '">' + escapeHtml(stage) + '</option>';
        })
        .join('');

      if (!hasOriginal) {
        stageSelect.innerHTML += '<option value="__create__">Создать новый этап</option>';
        stageHint.textContent =
          originalStage
            ? 'Исходный этап "' + originalStage + '" отсутствует в проекте. Выберите другой или создайте новый.'
            : 'Выберите этап для восстановления.';
      } else {
        stageHint.textContent = '';
      }

      if (hasOriginal && originalStage) {
        stageSelect.value = originalStage;
      } else if (stages.length > 0) {
        stageSelect.value = stages[0];
      } else {
        stageSelect.value = '__create__';
      }

      stageCreateWrap.style.display = stageSelect.value === '__create__' ? 'block' : 'none';
      if (stageSelect.value === '__create__') {
        stageCreateInput.value = originalStage || '';
      }
      updatePreview();
    };

    const updatePreview = function () {
      const selectedProjectName = getProjectName(projectSelect.value);
      const selectedCol = formatColLabel(colSelect.value);
      const selectedStage =
        stageSelect.value === '__create__'
          ? String(stageCreateInput.value || '').trim() || 'Новый этап'
          : stageSelect.value || '—';
      preview.innerHTML = ''
        + '<div class="trash-preview-id">' + escapeHtml(item.id) + '</div>'
        + '<div class="trash-preview-title">' + escapeHtml(item.title) + '</div>'
        + '<div class="trash-preview-meta">'
        + '<span>Проект: ' + escapeHtml(selectedProjectName) + '</span>'
        + '<span>Столбец: ' + escapeHtml(selectedCol) + '</span>'
        + '<span>Этап: ' + escapeHtml(selectedStage) + '</span>'
        + '</div>'
        + '<div class="trash-preview-desc">' + escapeHtml(item.desc || '—') + '</div>';
    };

    projectSelect.onchange = updateStageSelect;
    stageSelect.onchange = function () {
      stageCreateWrap.style.display = stageSelect.value === '__create__' ? 'block' : 'none';
      updatePreview();
    };
    stageCreateInput.oninput = updatePreview;
    colSelect.onchange = updatePreview;

    updateStageSelect();

    cancelButton.onclick = function () {
      overlay.remove();
    };

    confirmButton.onclick = async function () {
      const projectId = String(projectSelect.value || '').trim();
      const col = String(colSelect.value || '').trim();
      let stage = String(stageSelect.value || '').trim();
      const createStage = stage === '__create__';
      if (createStage) {
        stage = String(stageCreateInput.value || '').trim();
      }
      if (!projectId || !col || !stage) {
        showError('Заполните проект, столбец и этап для восстановления');
        return;
      }

      confirmButton.disabled = true;
      try {
        await apiFetch('/tasks/' + item.raw_id + '/restore', {
          method: 'POST',
          body: {
            project_id: projectId,
            col: normalizeApiCol(col),
            stage: stage,
            create_stage_if_missing: createStage,
          },
        });
        overlay.remove();
        profileTrashItems = profileTrashItems.filter(function (row) {
          return row.raw_id !== item.raw_id;
        });
        renderTrashRows();

        await loadProjectsAndActive();
        if (projectId === activeProjId) {
          await loadTasksForActiveProject();
          render();
          syncColumnEmptyStates();
          updateStageTabs();
          scheduleHeaderRefresh();
          await syncCompletionMode();
          applyTimerFromSnapshot();
        }
        showInfo('Задача восстановлена');
      } catch (error) {
        confirmButton.disabled = false;
        showError('Restore failed: ' + error.message);
      }
    };
  }

  function openPurgeTrashTaskModal(item) {
    let overlay = document.getElementById('trash-purge-ov');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'trash-purge-ov';
      overlay.className = 'overlay open';
      overlay.innerHTML = ''
        + '<div class="bridge-confirm-card">'
        + '<div class="bridge-confirm-title">Удалить задачу навсегда?</div>'
        + '<div class="bridge-confirm-sub" id="trash-purge-sub"></div>'
        + '<div class="bridge-confirm-row">'
        + '<button class="bridge-confirm-btn no" id="trash-purge-no">Отмена</button>'
        + '<button class="bridge-confirm-btn danger" id="trash-purge-yes">Удалить навсегда</button>'
        + '</div>'
        + '</div>';
      document.body.appendChild(overlay);
    }

    overlay.classList.add('open');
    const subtitle = document.getElementById('trash-purge-sub');
    const noButton = document.getElementById('trash-purge-no');
    const yesButton = document.getElementById('trash-purge-yes');
    if (!subtitle || !noButton || !yesButton) {
      return;
    }

    subtitle.textContent = 'Задача ' + item.id + ' («' + item.title + '») будет удалена без возможности восстановления.';
    noButton.onclick = function () {
      overlay.remove();
    };
    yesButton.onclick = async function () {
      yesButton.disabled = true;
      try {
        await apiFetch('/tasks/' + item.raw_id + '/permanent', {
          method: 'DELETE',
        });
        overlay.remove();
        profileTrashItems = profileTrashItems.filter(function (row) {
          return row.raw_id !== item.raw_id;
        });
        renderTrashRows();
        showInfo('Задача удалена навсегда');
      } catch (error) {
        yesButton.disabled = false;
        showError('Permanent delete failed: ' + error.message);
      }
    };
  }

  const PURPOSE_KEYS = ['new_task', 'chat', 'import_parse'];
  const PURPOSE_LABELS = {
    new_task: 'Новая задача',
    chat: 'Работа с задачей',
    import_parse: 'Импорт проекта и задач',
  };
  const PROVIDER_OPTIONS = [
    { value: 'anthropic', label: 'Anthropic (Claude)' },
    { value: 'openai', label: 'OpenAI (GPT)' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'qwen', label: 'Qwen' },
    { value: 'groq', label: 'Groq' },
    { value: 'google', label: 'Google (Gemini)' },
    { value: 'custom', label: 'Custom' },
  ];
  var profileLlmSettingsCache = [];

  function getSettingForPurpose(purpose) {
    return (profileLlmSettingsCache || []).find(function (s) { return s.purpose === purpose; });
  }

  function loadModelsForProvider(provider, modelSelectEl, options) {
    if (!modelSelectEl) return;
    var cur = modelSelectEl.value;
    var apiKey = options && options.apiKey;
    var baseUrl = options && options.baseUrl;
    var statusEl = options && options.statusEl;

    if (apiKey) {
      var body = { provider: provider, apiKey: apiKey };
      if (baseUrl) body.baseUrl = baseUrl;
      apiFetch('/api/llm/models/list', { method: 'POST', body: body })
        .then(function (res) {
          var models = Array.isArray(res && res.models) ? res.models : [];
          if (models.length > 0) {
            setModelSelectOptions(modelSelectEl, models, cur);
          } else {
            if (statusEl) { statusEl.textContent = 'Не удалось загрузить модели'; statusEl.className = 'profile-llm-verify-status error'; }
            setModelSelectPlaceholder(modelSelectEl, '');
          }
        })
        .catch(function () {
          if (statusEl) { statusEl.textContent = 'Не удалось загрузить модели'; statusEl.className = 'profile-llm-verify-status error'; }
          setModelSelectPlaceholder(modelSelectEl, '');
        });
      return;
    }

    apiFetch('/api/llm/models?provider=' + encodeURIComponent(provider)).catch(function () { return { models: [] }; }).then(function (res) {
      var models = Array.isArray(res && res.models) ? res.models : [];
      setModelSelectOptions(modelSelectEl, models, cur);
    });
  }

  function setModelSelectOptions(modelSelectEl, models, preserveValue) {
    if (!modelSelectEl) return;
    var cur = preserveValue !== undefined ? preserveValue : modelSelectEl.value;
    modelSelectEl.innerHTML = (models || []).map(function (m) {
      return '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + '</option>';
    }).join('');
    if (cur && models && models.indexOf(cur) >= 0) modelSelectEl.value = cur;
    else if (models && models.length) modelSelectEl.value = models[0];
    modelSelectEl.disabled = !models || models.length === 0;
  }

  function setModelSelectPlaceholder(modelSelectEl, placeholderText) {
    if (!modelSelectEl) return;
    modelSelectEl.innerHTML = '<option value="">' + (placeholderText || 'Сначала проверьте API-ключ') + '</option>';
    modelSelectEl.value = '';
    modelSelectEl.disabled = true;
  }

  function getDefaultTestModel(provider) {
    var p = (provider || '').toLowerCase();
    if (p === 'anthropic') return 'claude-haiku-4-5-20251001';
    if (p === 'openai') return 'gpt-4o-mini';
    if (p === 'deepseek') return 'deepseek-chat';
    if (p === 'groq') return 'llama-3.1-8b-instant';
    if (p === 'google') return 'gemini-1.5-flash';
    if (p === 'custom' || p === 'qwen') return 'gpt-4o-mini';
    return 'gpt-4o-mini';
  }

  function fillProfileLlmFromSettings(pane, settings) {
    if (!pane) return;
    var mainProvider = document.getElementById('profile-llm-main-provider');
    var mainModel = document.getElementById('profile-llm-main-model');
    var mainKey = document.getElementById('profile-llm-main-apikey');
    if (mainProvider && mainModel) {
      var first = settings[0];
      if (first) {
        mainProvider.value = first.provider || 'anthropic';
        if (first.model) {
          setModelSelectOptions(mainModel, [first.model], first.model);
        } else {
          setModelSelectPlaceholder(mainModel);
        }
        if (mainKey) mainKey.value = '';
      } else {
        setModelSelectPlaceholder(mainModel);
      }
    }
    PURPOSE_KEYS.forEach(function (purpose) {
      var s = getSettingForPurpose(purpose);
      var wrap = pane.querySelector('[data-purpose="' + purpose + '"]');
      if (!wrap) return;
      var cb = wrap.querySelector('.profile-llm-card-override-cb');
      var inner = wrap.querySelector('.profile-llm-card-override-inner');
      if (cb && inner) {
        cb.checked = !!(s && s.is_individual_override);
        inner.style.display = cb.checked ? 'block' : 'none';
        if (s && s.is_individual_override) {
          var prov = wrap.querySelector('.profile-llm-card-provider');
          var mod = wrap.querySelector('.profile-llm-card-model');
          var key = wrap.querySelector('.profile-llm-card-apikey');
          if (prov) prov.value = s.provider || 'anthropic';
          if (mod) {
            if (s.model) { setModelSelectOptions(mod, [s.model], s.model); } else { setModelSelectPlaceholder(mod); }
          }
          if (key) key.value = '';
        }
      }
    });
    var mainWrap = document.getElementById('profile-llm-pane');
    if (mainWrap) {
      var anyOverride = PURPOSE_KEYS.some(function (p) {
        var wrap = mainWrap.querySelector('[data-purpose="' + p + '"]');
        var cb = wrap ? wrap.querySelector('.profile-llm-card-override-cb') : null;
        return cb && cb.checked;
      });
      if (anyOverride) mainWrap.classList.add('profile-llm-main-dimmed'); else mainWrap.classList.remove('profile-llm-main-dimmed');
    }
  }

  function loadProfileLlmSettings() {
    var pane = document.getElementById('profile-llm-pane');
    if (!pane) return;
    apiFetch('/api/llm/provider-settings').catch(function () { return { settings: [] }; }).then(function (res) {
      var settings = Array.isArray(res && res.settings) ? res.settings : [];
      profileLlmSettingsCache = settings;
      fillProfileLlmFromSettings(pane, settings);
    });
  }

  function renderProfileLlm() {
    var content = document.getElementById('profile-content');
    if (!content) { return; }

    var providerOpts = PROVIDER_OPTIONS.map(function (p) {
      return '<option value="' + escapeHtml(p.value) + '">' + escapeHtml(p.label) + '</option>';
    }).join('');
    var cardsHtml = '';
    PURPOSE_KEYS.forEach(function (purpose) {
      var label = PURPOSE_LABELS[purpose];
      cardsHtml += '<div class="profile-llm-card" data-purpose="' + purpose + '">'
        + '<div class="profile-llm-card-title">' + escapeHtml(label) + '</div>'
        + '<label class="profile-llm-card-cb"><input type="checkbox" class="profile-llm-card-override-cb"> Использовать отдельный провайдер</label>'
        + '<div class="profile-llm-card-override-inner" style="display:none;margin-top:10px;">'
        + '<div class="profile-llm-form-row"><label class="profile-llm-form-lbl">Провайдер</label><select class="ps-input profile-llm-card-provider" style="max-width:200px">' + providerOpts + '</select></div>'
        + '<div class="profile-llm-form-row"><label class="profile-llm-form-lbl">API-ключ</label><input type="password" class="ps-input profile-llm-card-apikey" style="flex:1;max-width:280px" placeholder="Ключ" autocomplete="new-password" readonly onfocus="this.removeAttribute(\'readonly\')"><button type="button" class="btn-create profile-llm-card-verify" style="flex-shrink:0">Проверить</button></div>'
        + '<div class="profile-llm-card-verify-status profile-llm-verify-status" style="min-height:1.2em;"></div>'
        + '<div class="profile-llm-form-row"><label class="profile-llm-form-lbl">Модель</label><select class="ps-input profile-llm-card-model" style="max-width:280px" disabled><option value="">Сначала проверьте API-ключ</option></select></div>'
        + '</div></div>';
    });

    content.innerHTML = ''
      + '<div class="profile-pane profile-llm-main-wrap" id="profile-llm-pane">'
      + '<div class="profile-llm-main">'
      + '<div class="profile-pane-title">Основной ИИ-провайдер</div>'
      + '<div class="profile-pane-sub" style="margin-bottom:12px">Используется по умолчанию для всех операций</div>'
      + '<div class="profile-llm-form-row">'
      + '<label class="profile-llm-form-lbl">Провайдер</label>'
      + '<select id="profile-llm-main-provider" class="ps-input" style="max-width:220px">' + providerOpts + '</select>'
      + '</div>'
      + '<div class="profile-llm-form-row">'
      + '<label class="profile-llm-form-lbl">API-ключ</label>'
      + '<input type="password" id="profile-llm-main-apikey" class="ps-input" style="flex:1;max-width:320px" placeholder="Ключ" autocomplete="new-password" readonly onfocus="this.removeAttribute(\'readonly\')">'
      + '<button type="button" class="btn-create" id="profile-llm-main-verify" style="flex-shrink:0">Проверить</button>'
      + '</div>'
      + '<div id="profile-llm-main-verify-status" class="profile-llm-verify-status"></div>'
      + '<div class="profile-llm-form-row">'
      + '<label class="profile-llm-form-lbl">Модель</label>'
      + '<select id="profile-llm-main-model" class="ps-input" style="max-width:280px" disabled><option value="">Сначала введите API-ключ и нажмите «Проверить»</option></select>'
      + '</div>'
      + '<div class="profile-pane-sub profile-llm-model-hint">API-ключ будет использоваться только для выбранной модели.</div>'
      + '<div class="profile-llm-form-row" style="margin-top:12px">'
      + '<button type="button" class="btn-create" id="profile-llm-main-save">Сохранить</button>'
      + '</div>'
      + '</div>'
      + '<div class="profile-llm-extra">'
      + '<button type="button" class="profile-llm-extra-toggle" id="profile-llm-extra-toggle">Дополнительные параметры ▼</button>'
      + '<div class="profile-llm-extra-body" id="profile-llm-extra-body" style="display:none">'
      + '<div class="profile-llm-cards">' + cardsHtml + '</div>'
      + '<div class="profile-llm-form-row" style="margin-top:12px"><button type="button" class="btn-create" id="profile-llm-cards-save">Сохранить дополнительные</button></div>'
      + '</div></div></div>';

    var pane = document.getElementById('profile-llm-pane');
    var mainProvider = document.getElementById('profile-llm-main-provider');
    var mainModel = document.getElementById('profile-llm-main-model');
    var mainKey = document.getElementById('profile-llm-main-apikey');
    var mainVerify = document.getElementById('profile-llm-main-verify');
    var mainVerifyStatus = document.getElementById('profile-llm-main-verify-status');
    var mainSave = document.getElementById('profile-llm-main-save');
    var extraToggle = document.getElementById('profile-llm-extra-toggle');
    var extraBody = document.getElementById('profile-llm-extra-body');
    var cardsSave = document.getElementById('profile-llm-cards-save');

    if (mainProvider && mainModel && mainVerifyStatus) {
      mainProvider.onchange = function () {
        setModelSelectPlaceholder(mainModel);
        mainVerifyStatus.textContent = '';
        mainVerifyStatus.className = '';
      };
    }
    if (mainKey && mainModel && mainVerifyStatus) {
      mainKey.oninput = mainKey.onchange = function () {
        mainVerifyStatus.textContent = '';
        mainVerifyStatus.className = '';
        setModelSelectPlaceholder(mainModel);
      };
    }

    if (mainVerify && mainVerifyStatus) {
      mainVerify.onclick = function () {
        var provider = mainProvider ? mainProvider.value : '';
        var apiKey = mainKey ? mainKey.value.trim() : '';
        if (!provider) { mainVerifyStatus.textContent = 'Выберите провайдер'; mainVerifyStatus.className = 'profile-llm-verify-status error'; return; }
        if (!apiKey) { mainVerifyStatus.textContent = 'Введите ключ'; mainVerifyStatus.className = 'profile-llm-verify-status error'; return; }
        var model = mainModel && mainModel.value ? mainModel.value.trim() : getDefaultTestModel(provider);
        mainVerifyStatus.textContent = 'Проверка...'; mainVerifyStatus.className = 'profile-llm-verify-status';
        apiFetch('/api/llm/settings/test', { method: 'POST', body: { provider: provider, model: model, apiKey: apiKey } })
          .then(function (res) {
            if (res && res.ok) {
              mainVerifyStatus.textContent = '✓ Ключ действителен'; mainVerifyStatus.className = 'profile-llm-verify-status ok';
              loadModelsForProvider(provider, mainModel, { apiKey: apiKey, statusEl: mainVerifyStatus });
            } else {
              mainVerifyStatus.textContent = '✗ Ошибка: ' + (res && res.error ? res.error : 'неверный ключ'); mainVerifyStatus.className = 'profile-llm-verify-status error';
              setModelSelectPlaceholder(mainModel);
            }
          })
          .catch(function (err) {
            mainVerifyStatus.textContent = '✗ Ошибка: ' + (err.message || err); mainVerifyStatus.className = 'profile-llm-verify-status error';
            setModelSelectPlaceholder(mainModel);
          });
      };
    }
    if (mainSave) {
      mainSave.onclick = function () {
        var provider = mainProvider ? mainProvider.value : 'anthropic';
        var model = mainModel ? mainModel.value.trim() : '';
        var apiKey = mainKey ? mainKey.value.trim() : '';
        if (!model) { showError('Выберите модель'); return; }
        var body = { provider: provider, model: model, is_enabled: true, is_individual_override: false }; if (apiKey) body.api_key = apiKey;
        var purposes = ['import_parse', 'new_task', 'chat'];
        Promise.all(purposes.map(function (p) { return apiFetch('/api/llm/provider-settings', { method: 'POST', body: Object.assign({ purpose: p }, body) }); }))
          .then(function () { loadProfileLlmSettings(); showInfo('Основной провайдер сохранён'); })
          .catch(function (err) { showError((err.body && err.body.message) || err.message || 'Ошибка'); });
      };
    }
    if (extraToggle && extraBody) {
      extraToggle.onclick = function () {
        var open = extraBody.style.display !== 'none';
        extraBody.style.display = open ? 'none' : 'block';
        extraToggle.textContent = open ? 'Дополнительные параметры ▼' : 'Дополнительные параметры ▲';
      };
    }
    function updateMainBlockDimmed() {
      var wrap = document.getElementById('profile-llm-pane');
      if (!wrap) return;
      var anyOverride = pane.querySelectorAll('.profile-llm-card-override-cb').length && Array.prototype.some.call(pane.querySelectorAll('.profile-llm-card-override-cb'), function (c) { return c.checked; });
      if (anyOverride) wrap.classList.add('profile-llm-main-dimmed'); else wrap.classList.remove('profile-llm-main-dimmed');
    }
    pane.querySelectorAll('.profile-llm-card-override-cb').forEach(function (cb) {
      cb.onchange = function () {
        var card = cb.closest('.profile-llm-card');
        var inner = card ? card.querySelector('.profile-llm-card-override-inner') : null;
        if (inner) inner.style.display = cb.checked ? 'block' : 'none';
        updateMainBlockDimmed();
      };
    });
    pane.querySelectorAll('.profile-llm-card-provider').forEach(function (sel) {
      sel.onchange = function () {
        var card = sel.closest('.profile-llm-card');
        var modelSel = card ? card.querySelector('.profile-llm-card-model') : null;
        var statusEl = card ? card.querySelector('.profile-llm-card-verify-status') : null;
        if (modelSel) loadModelsForProvider(sel.value || 'anthropic', modelSel);
        if (statusEl) { statusEl.textContent = ''; statusEl.className = 'profile-llm-card-verify-status profile-llm-verify-status'; }
      };
    });
    pane.querySelectorAll('.profile-llm-card-verify').forEach(function (btn) {
      btn.onclick = function () {
        var card = btn.closest('.profile-llm-card');
        if (!card) return;
        var keyInput = card.querySelector('.profile-llm-card-apikey');
        var provSel = card.querySelector('.profile-llm-card-provider');
        var modelSel = card.querySelector('.profile-llm-card-model');
        var statusEl = card.querySelector('.profile-llm-card-verify-status');
        var provider = provSel ? provSel.value : '';
        var model = modelSel && modelSel.value ? modelSel.value.trim() : getDefaultTestModel(provider);
        var apiKey = keyInput ? keyInput.value.trim() : '';
        if (!provider) { if (statusEl) { statusEl.textContent = 'Выберите провайдер'; statusEl.className = 'profile-llm-card-verify-status profile-llm-verify-status error'; } return; }
        if (!apiKey) { if (statusEl) { statusEl.textContent = 'Введите ключ'; statusEl.className = 'profile-llm-card-verify-status profile-llm-verify-status error'; } return; }
        if (statusEl) { statusEl.textContent = 'Проверка...'; statusEl.className = 'profile-llm-card-verify-status profile-llm-verify-status'; }
        apiFetch('/api/llm/settings/test', { method: 'POST', body: { provider: provider, model: model, apiKey: apiKey } })
          .then(function (res) {
            if (res && res.ok) {
              if (statusEl) { statusEl.textContent = '✓ Ключ действителен'; statusEl.className = 'profile-llm-card-verify-status profile-llm-verify-status ok'; }
              loadModelsForProvider(provider, modelSel, { apiKey: apiKey, statusEl: statusEl });
            } else {
              if (statusEl) { statusEl.textContent = '✗ ' + (res && res.error ? res.error : 'неверный ключ'); statusEl.className = 'profile-llm-card-verify-status profile-llm-verify-status error'; }
              if (modelSel) setModelSelectPlaceholder(modelSel);
            }
          })
          .catch(function (err) {
            if (statusEl) { statusEl.textContent = '✗ ' + (err.message || err); statusEl.className = 'profile-llm-card-verify-status profile-llm-verify-status error'; }
            if (modelSel) setModelSelectPlaceholder(modelSel);
          });
      };
    });
    if (cardsSave) {
      cardsSave.onclick = function () {
        var promises = [];
        PURPOSE_KEYS.forEach(function (purpose) {
          var card = pane.querySelector('[data-purpose="' + purpose + '"]');
          if (!card) return;
          var cb = card.querySelector('.profile-llm-card-override-cb');
          var prov = card.querySelector('.profile-llm-card-provider');
          var mod = card.querySelector('.profile-llm-card-model');
          var key = card.querySelector('.profile-llm-card-apikey');
          var existing = getSettingForPurpose(purpose);
          if (cb && cb.checked && prov && mod) {
            var body = { provider: prov.value, model: mod.value.trim(), is_enabled: true };
            if (key && key.value.trim()) body.api_key = key.value.trim();
            if (existing && existing.id) {
              promises.push(apiFetch('/api/llm/provider-settings/' + existing.id, { method: 'PATCH', body: body }));
            } else {
              body.purpose = purpose;
              promises.push(apiFetch('/api/llm/provider-settings', { method: 'POST', body: body }));
            }
          } else if (existing && existing.id) {
            promises.push(apiFetch('/api/llm/provider-settings/' + existing.id, { method: 'DELETE' }));
          }
        });
        if (promises.length === 0) { showInfo('Нечего сохранять'); return; }
        Promise.all(promises).then(function () { loadProfileLlmSettings(); showInfo('Настройки сохранены'); }).catch(function (err) { showError(err.message || 'Ошибка'); });
      };
    }
    loadProfileLlmSettings();
  }

  function renderProfileLlmBasic() {
    ensureBridgeStyles();
    var content = document.getElementById('profile-content');
    if (!content) return;
    var providerOpts = PROVIDER_OPTIONS.map(function (p) {
      return '<option value="' + escapeHtml(p.value) + '">' + escapeHtml(p.label) + '</option>';
    }).join('');

    content.innerHTML = ''
      + '<div class="profile-pane profile-llm-main-wrap" id="profile-llm-pane">'
      + '<div class="profile-llm-main">'
      + '<div class="profile-pane-title">Базовые настройки ИИ</div>'
      + '<div class="profile-pane-sub" style="margin-bottom:12px">Основной ИИ-провайдер, используемый по умолчанию для всех операций: создание задач, чат, импорт. '
      + 'Укажите провайдера, вставьте API-ключ, нажмите «Проверить», выберите модель и сохраните.</div>'
      + '<div class="profile-llm-form-row">'
      + '<label class="profile-llm-form-lbl">Провайдер</label>'
      + '<select id="profile-llm-main-provider" class="ps-input" style="max-width:220px">' + providerOpts + '</select>'
      + '</div>'
      + '<div class="profile-llm-form-row">'
      + '<label class="profile-llm-form-lbl">API-ключ</label>'
      + '<input type="password" id="profile-llm-main-apikey" class="ps-input" style="flex:1;max-width:320px" placeholder="Ключ" autocomplete="new-password" readonly onfocus="this.removeAttribute(\'readonly\')">'
      + '<button type="button" class="btn-create" id="profile-llm-main-verify" style="flex-shrink:0">Проверить</button>'
      + '</div>'
      + '<div id="profile-llm-main-verify-status" class="profile-llm-verify-status"></div>'
      + '<div class="profile-llm-form-row">'
      + '<label class="profile-llm-form-lbl">Модель</label>'
      + '<select id="profile-llm-main-model" class="ps-input" style="max-width:280px" disabled><option value="">Сначала введите API-ключ и нажмите «Проверить»</option></select>'
      + '</div>'
      + '<div class="profile-pane-sub profile-llm-model-hint">API-ключ будет использоваться только для выбранной модели.</div>'
      + '<div class="profile-llm-form-row" style="margin-top:12px">'
      + '<button type="button" class="btn-create" id="profile-llm-main-save">Сохранить</button>'
      + '</div></div></div>';

    var mainProvider = document.getElementById('profile-llm-main-provider');
    var mainModel = document.getElementById('profile-llm-main-model');
    var mainKey = document.getElementById('profile-llm-main-apikey');
    var mainVerify = document.getElementById('profile-llm-main-verify');
    var mainVerifyStatus = document.getElementById('profile-llm-main-verify-status');
    var mainSave = document.getElementById('profile-llm-main-save');

    if (mainProvider && mainModel && mainVerifyStatus) {
      mainProvider.onchange = function () { setModelSelectPlaceholder(mainModel); mainVerifyStatus.textContent = ''; mainVerifyStatus.className = ''; };
    }
    if (mainKey && mainModel && mainVerifyStatus) {
      mainKey.oninput = mainKey.onchange = function () { mainVerifyStatus.textContent = ''; mainVerifyStatus.className = ''; setModelSelectPlaceholder(mainModel); };
    }
    if (mainVerify && mainVerifyStatus) {
      mainVerify.onclick = function () {
        var provider = mainProvider ? mainProvider.value : '';
        var apiKey = mainKey ? mainKey.value.trim() : '';
        if (!provider) { mainVerifyStatus.textContent = 'Выберите провайдер'; mainVerifyStatus.className = 'profile-llm-verify-status error'; return; }
        if (!apiKey) { mainVerifyStatus.textContent = 'Введите ключ'; mainVerifyStatus.className = 'profile-llm-verify-status error'; return; }
        var model = mainModel && mainModel.value ? mainModel.value.trim() : getDefaultTestModel(provider);
        mainVerifyStatus.textContent = 'Проверка...'; mainVerifyStatus.className = 'profile-llm-verify-status';
        apiFetch('/api/llm/settings/test', { method: 'POST', body: { provider: provider, model: model, apiKey: apiKey } })
          .then(function (res) {
            if (res && res.ok) { mainVerifyStatus.textContent = '✓ Ключ действителен'; mainVerifyStatus.className = 'profile-llm-verify-status ok'; loadModelsForProvider(provider, mainModel, { apiKey: apiKey, statusEl: mainVerifyStatus }); }
            else { mainVerifyStatus.textContent = '✗ Ошибка: ' + (res && res.error ? res.error : 'неверный ключ'); mainVerifyStatus.className = 'profile-llm-verify-status error'; setModelSelectPlaceholder(mainModel); }
          })
          .catch(function (err) { mainVerifyStatus.textContent = '✗ Ошибка: ' + (err.message || err); mainVerifyStatus.className = 'profile-llm-verify-status error'; setModelSelectPlaceholder(mainModel); });
      };
    }
    if (mainSave) {
      mainSave.onclick = function () {
        var provider = mainProvider ? mainProvider.value : 'anthropic';
        var model = mainModel ? mainModel.value.trim() : '';
        var apiKey = mainKey ? mainKey.value.trim() : '';
        if (!model) { showError('Выберите модель'); return; }
        var body = { provider: provider, model: model, is_enabled: true, is_individual_override: false }; if (apiKey) body.api_key = apiKey;
        var purposes = ['import_parse', 'new_task', 'chat'];
        Promise.all(purposes.map(function (p) { return apiFetch('/api/llm/provider-settings', { method: 'POST', body: Object.assign({ purpose: p }, body) }); }))
          .then(function () { loadProfileLlmSettings(); showInfo('Основной провайдер сохранён'); })
          .catch(function (err) { showError((err.body && err.body.message) || err.message || 'Ошибка'); });
      };
    }

    var pane = document.getElementById('profile-llm-pane');
    if (pane) {
      apiFetch('/api/llm/provider-settings').catch(function () { return { settings: [] }; }).then(function (res) {
        var settings = Array.isArray(res && res.settings) ? res.settings : [];
        profileLlmSettingsCache = settings;
        var allIndiv = !!(res && res.all_purposes_individual);
        if (!allIndiv && settings.length >= 3) {
          var indivCount = settings.filter(function (s) { return s && s.is_enabled && s.is_individual_override; }).length;
          if (indivCount >= 3) allIndiv = true;
        }
        var block = document.getElementById('profile-llm-pane');
        var main = block ? block.querySelector('.profile-llm-main') : null;
        if (main) {
          main.classList.toggle('profile-llm-locked', allIndiv);
          var inputs = main.querySelectorAll('select, input, button');
          inputs.forEach(function (el) { el.disabled = allIndiv; });
          var hint = main.querySelector('.profile-llm-lock-hint');
          if (allIndiv) {
            if (!hint) {
              hint = document.createElement('div');
              hint.className = 'profile-llm-lock-hint';
              hint.style.cssText = 'font-size:13px;font-weight:600;color:var(--tx3);margin-top:12px;padding:10px 14px;background:rgba(0,0,0,.2);border-radius:10px;position:relative;z-index:1;';
              main.insertBefore(hint, main.firstChild);
            }
            hint.textContent = 'Блокировка: все три блока используют индивидуальные настройки. Снимите галочку «Использовать отдельный провайдер» с одного блока во вкладке «Индивидуальные настройки», чтобы разблокировать.';
            hint.style.display = '';
          } else if (hint) hint.style.display = 'none';
        }
        if (mainProvider && mainModel) {
          var first = settings.find(function (s) { return !s.is_individual_override; }) || settings[0];
          if (first) {
            mainProvider.value = first.provider || 'anthropic';
            if (first.model) setModelSelectOptions(mainModel, [first.model], first.model);
            else setModelSelectPlaceholder(mainModel);
          } else { setModelSelectPlaceholder(mainModel); }
        }
      });
    }
  }

  function renderProfileLlmIndividual() {
    var content = document.getElementById('profile-content');
    if (!content) return;
    var providerOpts = PROVIDER_OPTIONS.map(function (p) {
      return '<option value="' + escapeHtml(p.value) + '">' + escapeHtml(p.label) + '</option>';
    }).join('');
    var cardsHtml = '';
    PURPOSE_KEYS.forEach(function (purpose) {
      var label = PURPOSE_LABELS[purpose];
      cardsHtml += '<div class="profile-llm-card" data-purpose="' + purpose + '">'
        + '<div class="profile-llm-card-title">' + escapeHtml(label) + '</div>'
        + '<label class="profile-llm-card-cb"><input type="checkbox" class="profile-llm-card-override-cb"> Использовать отдельный провайдер</label>'
        + '<div class="profile-llm-card-override-inner" style="display:none;margin-top:10px;">'
        + '<div class="profile-llm-form-row"><label class="profile-llm-form-lbl">Провайдер</label><select class="ps-input profile-llm-card-provider" style="max-width:200px">' + providerOpts + '</select></div>'
        + '<div class="profile-llm-form-row"><label class="profile-llm-form-lbl">API-ключ</label><input type="password" class="ps-input profile-llm-card-apikey" style="flex:1;max-width:280px" placeholder="Ключ" autocomplete="new-password" readonly onfocus="this.removeAttribute(\'readonly\')"><button type="button" class="btn-create profile-llm-card-verify" style="flex-shrink:0">Проверить</button></div>'
        + '<div class="profile-llm-card-verify-status profile-llm-verify-status" style="min-height:1.2em;"></div>'
        + '<div class="profile-llm-form-row"><label class="profile-llm-form-lbl">Модель</label><select class="ps-input profile-llm-card-model" style="max-width:280px" disabled><option value="">Сначала проверьте API-ключ</option></select></div>'
        + '</div></div>';
    });

    content.innerHTML = ''
      + '<div class="profile-pane profile-llm-main-wrap" id="profile-llm-ind-pane">'
      + '<div class="profile-pane-title">Индивидуальные настройки ИИ</div>'
      + '<div class="profile-pane-sub" style="margin-bottom:12px">Здесь вы можете настроить отдельного провайдера для каждой операции. '
      + 'Если включён отдельный провайдер, он будет использоваться вместо основного (базовых настроек) для соответствующей задачи.</div>'
      + '<div class="profile-llm-cards">' + cardsHtml + '</div>'
      + '<div class="profile-llm-form-row" style="margin-top:12px"><button type="button" class="btn-create" id="profile-llm-ind-save">Сохранить индивидуальные настройки</button></div>'
      + '</div>';

    var pane = document.getElementById('profile-llm-ind-pane');
    if (!pane) return;

    pane.querySelectorAll('.profile-llm-card-override-cb').forEach(function (cb) {
      cb.onchange = function () {
        var card = cb.closest('.profile-llm-card');
        var inner = card ? card.querySelector('.profile-llm-card-override-inner') : null;
        if (inner) inner.style.display = cb.checked ? 'block' : 'none';
      };
    });
    pane.querySelectorAll('.profile-llm-card-provider').forEach(function (sel) {
      sel.onchange = function () {
        var card = sel.closest('.profile-llm-card');
        var modelSel = card ? card.querySelector('.profile-llm-card-model') : null;
        if (modelSel) loadModelsForProvider(sel.value || 'anthropic', modelSel);
      };
    });
    pane.querySelectorAll('.profile-llm-card-verify').forEach(function (btn) {
      btn.onclick = function () {
        var card = btn.closest('.profile-llm-card');
        if (!card) return;
        var keyInput = card.querySelector('.profile-llm-card-apikey');
        var provSel = card.querySelector('.profile-llm-card-provider');
        var modelSel = card.querySelector('.profile-llm-card-model');
        var statusEl = card.querySelector('.profile-llm-card-verify-status');
        var provider = provSel ? provSel.value : '';
        var model = modelSel && modelSel.value ? modelSel.value.trim() : getDefaultTestModel(provider);
        var apiKey = keyInput ? keyInput.value.trim() : '';
        if (!provider) { if (statusEl) { statusEl.textContent = 'Выберите провайдер'; statusEl.className = 'profile-llm-card-verify-status profile-llm-verify-status error'; } return; }
        if (!apiKey) { if (statusEl) { statusEl.textContent = 'Введите ключ'; statusEl.className = 'profile-llm-card-verify-status profile-llm-verify-status error'; } return; }
        if (statusEl) { statusEl.textContent = 'Проверка...'; statusEl.className = 'profile-llm-card-verify-status profile-llm-verify-status'; }
        apiFetch('/api/llm/settings/test', { method: 'POST', body: { provider: provider, model: model, apiKey: apiKey } })
          .then(function (res) {
            if (res && res.ok) { if (statusEl) { statusEl.textContent = '✓ Ключ действителен'; statusEl.className = 'profile-llm-card-verify-status profile-llm-verify-status ok'; } loadModelsForProvider(provider, modelSel, { apiKey: apiKey, statusEl: statusEl }); }
            else { if (statusEl) { statusEl.textContent = '✗ ' + (res && res.error ? res.error : 'неверный ключ'); statusEl.className = 'profile-llm-card-verify-status profile-llm-verify-status error'; } if (modelSel) setModelSelectPlaceholder(modelSel); }
          })
          .catch(function (err) { if (statusEl) { statusEl.textContent = '✗ ' + (err.message || err); statusEl.className = 'profile-llm-card-verify-status profile-llm-verify-status error'; } if (modelSel) setModelSelectPlaceholder(modelSel); });
      };
    });

    var indSave = document.getElementById('profile-llm-ind-save');
    if (indSave) {
      indSave.onclick = function () {
        var promises = [];
        PURPOSE_KEYS.forEach(function (purpose) {
          var card = pane.querySelector('[data-purpose="' + purpose + '"]');
          if (!card) return;
          var cb = card.querySelector('.profile-llm-card-override-cb');
          var prov = card.querySelector('.profile-llm-card-provider');
          var mod = card.querySelector('.profile-llm-card-model');
          var key = card.querySelector('.profile-llm-card-apikey');
          var existing = getSettingForPurpose(purpose);
          if (cb && cb.checked && prov && mod) {
            var body = { provider: prov.value, model: mod.value.trim(), is_enabled: true, is_individual_override: true };
            if (key && key.value.trim()) body.api_key = key.value.trim();
            if (existing && existing.id) promises.push(apiFetch('/api/llm/provider-settings/' + existing.id, { method: 'PATCH', body: Object.assign({}, body, { is_individual_override: true }) }));
            else { body.purpose = purpose; promises.push(apiFetch('/api/llm/provider-settings', { method: 'POST', body: body })); }
          } else if (existing && existing.id) {
            var baseCfg = profileLlmSettingsCache.find(function (s) { return s.purpose !== purpose && s.provider && s.model; }) || profileLlmSettingsCache[0];
            if (baseCfg && baseCfg.provider && baseCfg.model) {
              promises.push(apiFetch('/api/llm/provider-settings/' + existing.id, {
                method: 'PATCH',
                body: { is_individual_override: false, provider: baseCfg.provider, model: baseCfg.model },
              }));
            } else {
              promises.push(apiFetch('/api/llm/provider-settings/' + existing.id, { method: 'PATCH', body: { is_individual_override: false } }));
            }
          }
        });
        if (promises.length === 0) { showInfo('Нечего сохранять'); return; }
        Promise.all(promises).then(function () {
          return apiFetch('/api/llm/provider-settings').catch(function () { return { settings: [] }; });
        }).then(function (res) {
          var settings = Array.isArray(res && res.settings) ? res.settings : [];
          profileLlmSettingsCache = settings;
          PURPOSE_KEYS.forEach(function (purpose) {
            var s = settings.find(function (x) { return x.purpose === purpose; });
            var wrap = pane.querySelector('[data-purpose="' + purpose + '"]');
            if (!wrap) return;
            var cb = wrap.querySelector('.profile-llm-card-override-cb');
            var inner = wrap.querySelector('.profile-llm-card-override-inner');
            if (cb && inner) {
              cb.checked = !!(s && s.is_individual_override);
              inner.style.display = cb.checked ? 'block' : 'none';
              if (s && s.is_individual_override) {
                var prov = wrap.querySelector('.profile-llm-card-provider');
                var mod = wrap.querySelector('.profile-llm-card-model');
                if (prov) prov.value = s.provider || 'anthropic';
                if (mod) { if (s.model) setModelSelectOptions(mod, [s.model], s.model); else setModelSelectPlaceholder(mod); }
              }
            }
          });
          showInfo('Настройки сохранены');
        }).catch(function (err) { showError((err.body && err.body.message) || err.message || 'Ошибка'); });
      };
    }

    apiFetch('/api/llm/provider-settings').catch(function () { return { settings: [] }; }).then(function (res) {
      var settings = Array.isArray(res && res.settings) ? res.settings : [];
      profileLlmSettingsCache = settings;
      PURPOSE_KEYS.forEach(function (purpose) {
        var s = getSettingForPurpose(purpose);
        var wrap = pane.querySelector('[data-purpose="' + purpose + '"]');
        if (!wrap) return;
        var cb = wrap.querySelector('.profile-llm-card-override-cb');
        var inner = wrap.querySelector('.profile-llm-card-override-inner');
        if (cb && inner) {
          cb.checked = !!(s && s.is_individual_override);
          inner.style.display = cb.checked ? 'block' : 'none';
          if (s && s.is_individual_override) {
            var prov = wrap.querySelector('.profile-llm-card-provider');
            var mod = wrap.querySelector('.profile-llm-card-model');
            if (prov) prov.value = s.provider || 'anthropic';
            if (mod) { if (s.model) setModelSelectOptions(mod, [s.model], s.model); else setModelSelectPlaceholder(mod); }
          }
        }
      });
    });
  }

  function formatCostUsd(val) {
    if (val == null || val === '') return 'нет данных';
    var n = Number(val);
    if (n === 0 || !Number.isFinite(n)) return 'нет данных';
    return n.toFixed(4);
  }

  const LLM_KEYS_PROVIDERS = [
    { value: 'anthropic', label: 'Anthropic (Claude)' },
    { value: 'openai', label: 'OpenAI (GPT)' },
    { value: 'deepseek', label: 'DeepSeek' },
    { value: 'groq', label: 'Groq' },
    { value: 'qwen', label: 'Qwen' },
    { value: 'custom', label: 'Custom' },
  ];

  function renderProfileLlmKeys() {
    var content = document.getElementById('profile-content');
    if (!content) return;
    content.innerHTML = '<div class="profile-pane"><div class="profile-pane-title">API-ключи провайдеров</div><div class="profile-pane-sub">Загрузка...</div></div>';
    apiFetch('/api/llm/api-keys').catch(function () { return { keys: [] }; }).then(function (res) {
      var keys = res.keys || [];
      var hasKeyMap = {};
      keys.forEach(function (k) { if (k.has_key) hasKeyMap[k.provider] = true; });
      var html = '<div class="profile-pane"><div class="profile-pane-title">API-ключи провайдеров</div>'
        + '<div class="profile-pane-sub" style="margin-bottom:16px">Настройте API-ключи для выбранных провайдеров. Провайдер и модель выбираются при каждой операции (создание задачи, чат, импорт).</div>';
      LLM_KEYS_PROVIDERS.forEach(function (p) {
        var hasKey = hasKeyMap[p.value];
        var provId = 'pk-keys-' + p.value;
        html += '<div class="profile-llm-keys-card" data-provider="' + escapeHtml(p.value) + '"' + (hasKey ? ' data-has-key="1"' : '') + '>'
          + '<div class="profile-llm-keys-card-title">' + escapeHtml(p.label) + '</div>'
          + '<div class="profile-llm-form-row" style="align-items:center;gap:10px;flex-wrap:wrap">'
          + '<input type="password" id="' + provId + '" class="ps-input profile-llm-keys-input" style="flex:1;min-width:200px;max-width:320px" placeholder="' + (hasKey ? '•••••••• (уже настроен)' : 'Введите API-ключ') + '" autocomplete="new-password" readonly onfocus="this.removeAttribute(\'readonly\')">';
        if (p.value === 'custom') {
          html += '<input type="text" class="ps-input profile-llm-keys-baseurl" style="flex:1;min-width:180px;max-width:280px" placeholder="Base URL (обязательно)">';
        }
        html += '<button type="button" class="profile-btn-capsule profile-llm-keys-save" data-provider="' + escapeHtml(p.value) + '">Сохранить</button>';
        if (hasKey) {
          html += '<button type="button" class="profile-btn-capsule profile-btn-danger profile-llm-keys-delete" data-provider="' + escapeHtml(p.value) + '">Удалить ключ</button>';
        }
        html += '</div><div class="profile-llm-keys-status profile-llm-verify-status profile-llm-keys-status-fixed' + (hasKey ? ' ok' : '') + '" data-state="' + (hasKey ? 'ok' : '') + '">' + (hasKey ? '✓ Ключ настроен' : '') + '</div></div>';
      });
      html += '</div>';
      content.innerHTML = html;
      content.querySelectorAll('.profile-llm-keys-save').forEach(function (btn) {
        btn.onclick = function () {
          var provider = btn.getAttribute('data-provider');
          var card = btn.closest('.profile-llm-keys-card');
          var input = card ? card.querySelector('.profile-llm-keys-input') : null;
          var baseInput = card ? card.querySelector('.profile-llm-keys-baseurl') : null;
          var status = card ? card.querySelector('.profile-llm-keys-status') : null;
          var apiKey = input ? input.value.trim() : '';
          var baseUrl = baseInput ? baseInput.value.trim() || null : null;
          if (!apiKey) { if (status) { status.textContent = 'Введите ключ'; status.className = 'profile-llm-keys-status profile-llm-verify-status profile-llm-keys-status-fixed error'; status.setAttribute('data-state', 'error'); } return; }
          if (provider === 'custom' && !baseUrl) { if (status) { status.textContent = 'Для Custom укажите Base URL'; status.className = 'profile-llm-keys-status profile-llm-verify-status profile-llm-keys-status-fixed error'; status.setAttribute('data-state', 'error'); } return; }
          if (status) { status.textContent = 'Проверка ключа...'; status.className = 'profile-llm-keys-status profile-llm-verify-status profile-llm-keys-status-fixed'; status.removeAttribute('data-state'); }
          var testBody = { provider: provider, model: typeof getDefaultTestModel === 'function' ? getDefaultTestModel(provider) : 'gpt-4o-mini', apiKey: apiKey };
          if (baseUrl) testBody.baseUrl = baseUrl;
          apiFetch('/api/llm/settings/test', { method: 'POST', body: testBody })
            .then(function (res) {
              if (res && res.ok) {
                if (status) { status.textContent = '✓ Ключ принят. Сохранение...'; status.className = 'profile-llm-keys-status profile-llm-verify-status profile-llm-keys-status-fixed ok'; status.setAttribute('data-state', 'ok'); }
                var saveBody = { provider: provider, api_key: apiKey }; if (baseUrl) saveBody.base_url = baseUrl;
                return apiFetch('/api/llm/api-keys', { method: 'POST', body: saveBody }).then(function () {
                  if (status) { status.textContent = '✓ Ключ принят и сохранён'; status.className = 'profile-llm-keys-status profile-llm-verify-status profile-llm-keys-status-fixed ok'; status.setAttribute('data-state', 'ok'); }
                  if (input) { input.placeholder = '•••••••• (уже настроен)'; input.value = ''; }
                  setTimeout(function () { renderProfileLlmKeys(); }, 2500);
                });
              } else {
                var errMsg = (res && res.error) ? res.error : 'Ключ отклонён';
                if (status) { status.textContent = '✗ Ключ отклонён: ' + errMsg; status.className = 'profile-llm-keys-status profile-llm-verify-status profile-llm-keys-status-fixed error'; status.setAttribute('data-state', 'error'); }
              }
            })
            .catch(function (err) {
              var errMsg = (err && err.body && err.body.message) ? err.body.message : (err && err.message) ? err.message : 'Ошибка проверки ключа';
              if (status) { status.textContent = '✗ Ключ отклонён: ' + errMsg; status.className = 'profile-llm-keys-status profile-llm-verify-status profile-llm-keys-status-fixed error'; status.setAttribute('data-state', 'error'); }
            });
        };
      });
      content.querySelectorAll('.profile-llm-keys-delete').forEach(function (btn) {
        btn.onclick = function () {
          var provider = btn.getAttribute('data-provider');
          if (!confirm('Удалить API-ключ для ' + provider + '?')) return;
          var card = btn.closest('.profile-llm-keys-card');
          var status = card ? card.querySelector('.profile-llm-keys-status') : null;
          if (status) { status.textContent = 'Удаление...'; status.className = 'profile-llm-keys-status profile-llm-verify-status profile-llm-keys-status-fixed'; }
          apiFetch('/api/llm/api-keys/' + encodeURIComponent(provider), { method: 'DELETE' })
            .then(function () { if (status) { status.textContent = '✓ Удалено'; status.className = 'profile-llm-keys-status profile-llm-verify-status profile-llm-keys-status-fixed ok'; } setTimeout(function () { renderProfileLlmKeys(); }, 2000); })
            .catch(function (err) { if (status) { status.textContent = '✗ ' + (err.body && err.body.message || err.message || 'Ошибка'); status.className = 'profile-llm-keys-status profile-llm-verify-status profile-llm-keys-status-fixed error'; } });
        };
      });
    });
  }

  function renderProfileLlmUsage() {
    var content = document.getElementById('profile-content');
    if (!content) return;
    content.innerHTML = '<div class="profile-pane"><div class="profile-pane-title">Отчёт по использованию LLM</div><div class="profile-pane-sub">Загрузка...</div></div>';
    apiFetch('/api/llm/usage?limit=200').then(function (data) {
      var summary = data.summary || {};
      var byModel = data.by_model || [];
      var byPurpose = data.by_purpose || [];
      var rows = data.rows || [];
      var purposeLabel = function (p) { return PURPOSE_LABELS[p] || p; };
      var sumHtml = '<div class="profile-llm-usage-summary">'
        + '<div class="profile-llm-usage-card"><div class="profile-llm-usage-card-value">' + (summary.total_requests || 0) + '</div><div class="profile-llm-usage-card-label">Запросов</div></div>'
        + '<div class="profile-llm-usage-card"><div class="profile-llm-usage-card-value">' + (summary.ok_count || 0) + '</div><div class="profile-llm-usage-card-label">Успешно</div></div>'
        + '<div class="profile-llm-usage-card"><div class="profile-llm-usage-card-value">' + (summary.error_count || 0) + '</div><div class="profile-llm-usage-card-label">Ошибок</div></div>'
        + '<div class="profile-llm-usage-card"><div class="profile-llm-usage-card-value">' + (summary.total_input_tokens || 0).toLocaleString() + '</div><div class="profile-llm-usage-card-label">Токенов вход</div></div>'
        + '<div class="profile-llm-usage-card"><div class="profile-llm-usage-card-value">' + (summary.total_output_tokens || 0).toLocaleString() + '</div><div class="profile-llm-usage-card-label">Токенов выход</div></div>'
        + '<div class="profile-llm-usage-card"><div class="profile-llm-usage-card-value">' + escapeHtml(formatCostUsd(summary.total_cost_usd)) + '</div><div class="profile-llm-usage-card-label">USD (оценка)</div></div>'
        + '</div>';
      var byModelHtml = '';
      if (byModel.length) {
        byModelHtml = '<div class="profile-pane-title" style="margin-top:20px">По моделям</div>'
          + '<table class="profile-table profile-llm-usage-table"><thead><tr><th>Провайдер</th><th>Модель</th><th>Запросов</th><th>Вход (токены)</th><th>Выход (токены)</th><th>USD</th></tr></thead><tbody>'
          + byModel.map(function (r) {
            return '<tr><td>' + escapeHtml(r.provider) + '</td><td>' + escapeHtml(r.model) + '</td><td>' + r.count + '</td><td>' + (r.input_tokens || 0).toLocaleString() + '</td><td>' + (r.output_tokens || 0).toLocaleString() + '</td><td>' + escapeHtml(formatCostUsd(r.cost_usd)) + '</td></tr>';
          }).join('')
          + '</tbody></table>';
      }
      var byPurposeHtml = '';
      if (byPurpose.length) {
        byPurposeHtml = '<div class="profile-pane-title" style="margin-top:20px">По назначению</div>'
          + '<table class="profile-table profile-llm-usage-table"><thead><tr><th>Назначение</th><th>Запросов</th><th>Вход (токены)</th><th>Выход (токены)</th><th>USD</th></tr></thead><tbody>'
          + byPurpose.map(function (r) {
            return '<tr><td>' + escapeHtml(purposeLabel(r.purpose)) + '</td><td>' + r.count + '</td><td>' + (r.input_tokens || 0).toLocaleString() + '</td><td>' + (r.output_tokens || 0).toLocaleString() + '</td><td>' + escapeHtml(formatCostUsd(r.cost_usd)) + '</td></tr>';
          }).join('')
          + '</tbody></table>';
      }
      var rowsHtml = '<div class="profile-pane-title" style="margin-top:20px">Детализация запросов</div>';
      if (rows.length) {
        rowsHtml += '<div class="profile-llm-usage-detail-wrap"><table class="profile-table profile-llm-usage-table"><thead><tr><th>Дата</th><th>Назначение</th><th>Провайдер</th><th>Модель</th><th>Вход</th><th>Выход</th><th>USD</th><th>Статус</th></tr></thead><tbody>'
          + rows.map(function (r) {
            var dt = r.created_at ? (typeof formatDateTime === 'function' ? formatDateTime(r.created_at) : r.created_at) : '—';
            return '<tr><td>' + escapeHtml(dt) + '</td><td>' + escapeHtml(purposeLabel(r.purpose)) + '</td><td>' + escapeHtml(r.provider) + '</td><td>' + escapeHtml(r.model) + '</td><td>' + (r.input_tokens != null ? r.input_tokens.toLocaleString() : '—') + '</td><td>' + (r.output_tokens != null ? r.output_tokens.toLocaleString() : '—') + '</td><td>' + escapeHtml(formatCostUsd(r.cost_estimate_usd)) + '</td><td>' + (r.status === 'ok' ? '✓' : '✗ ' + escapeHtml(r.error_code || 'error')) + '</td></tr>';
          }).join('')
          + '</tbody></table></div>';
      } else {
        rowsHtml += '<div class="profile-empty">Нет записей</div>';
      }
      content.innerHTML = '<div class="profile-pane">'
        + '<div class="profile-llm-usage-warn">'
        + '⚠ Стоимость использования LLM — приблизительная оценка по открытым данным провайдеров. Точную стоимость уточняйте в личном кабинете провайдера.'
        + '</div>'
        + '<div class="profile-pane-title">Отчёт по использованию LLM</div>'
        + '<div class="profile-pane-sub">Модели, токены (вход/выход), оценка затрат по вашим запросам.</div>'
        + '<div class="profile-llm-usage-actions">'
        + '<button type="button" class="btn-create profile-btn" id="profile-llm-usage-export">Экспорт в Excel</button>'
        + '<button type="button" class="profile-btn ghost" id="profile-llm-usage-refresh">Обновить данные</button>'
        + '</div>'
        + sumHtml + byModelHtml + byPurposeHtml + rowsHtml
        + '</div>';
      var exportBtn = document.getElementById('profile-llm-usage-export');
      if (exportBtn) {
        exportBtn.onclick = function () { exportLlmUsageToExcel(data); };
      }
      var refreshBtn = document.getElementById('profile-llm-usage-refresh');
      if (refreshBtn) {
        refreshBtn.onclick = function () { renderProfileLlmUsage(); };
      }
    }).catch(function (err) {
      if (content) content.innerHTML = '<div class="profile-pane"><div class="profile-pane-title">Отчёт по использованию LLM</div><div class="profile-empty">Ошибка загрузки: ' + escapeHtml(err.message || 'Ошибка') + '</div></div>';
    });
  }

  function exportLlmUsageToExcel(data) {
    if (typeof XLSX === 'undefined') { showError('Библиотека Excel недоступна'); return; }
    var purposeLabel = function (p) { return PURPOSE_LABELS[p] || p; };
    var formatCost = function (v) {
      if (v == null || v === '') return 'нет данных';
      var n = Number(v);
      if (n === 0 || !Number.isFinite(n)) return 'нет данных';
      return n.toFixed(4);
    };
    var wb = XLSX.utils.book_new();
    var summary = data.summary || {};
    var summaryArr = [
      ['Показатель', 'Значение'],
      ['Всего запросов', summary.total_requests || 0],
      ['Успешно', summary.ok_count || 0],
      ['Ошибок', summary.error_count || 0],
      ['Токенов вход', summary.total_input_tokens || 0],
      ['Токенов выход', summary.total_output_tokens || 0],
      ['USD (оценка)', formatCost(summary.total_cost_usd)],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryArr), 'Сводка');
    var byModel = data.by_model || [];
    if (byModel.length) {
      var modelArr = [['Провайдер', 'Модель', 'Запросов', 'Вход (токены)', 'Выход (токены)', 'USD']];
      byModel.forEach(function (r) {
        modelArr.push([r.provider, r.model, r.count, r.input_tokens || 0, r.output_tokens || 0, formatCost(r.cost_usd)]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(modelArr), 'По моделям');
    }
    var byPurpose = data.by_purpose || [];
    if (byPurpose.length) {
      var purposeArr = [['Назначение', 'Запросов', 'Вход (токены)', 'Выход (токены)', 'USD']];
      byPurpose.forEach(function (r) {
        purposeArr.push([purposeLabel(r.purpose), r.count, r.input_tokens || 0, r.output_tokens || 0, formatCost(r.cost_usd)]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(purposeArr), 'По назначению');
    }
    var rows = data.rows || [];
    if (rows.length) {
      var detailArr = [['Дата', 'Назначение', 'Провайдер', 'Модель', 'Вход', 'Выход', 'USD', 'Статус']];
      rows.forEach(function (r) {
        var dt = r.created_at ? (typeof formatDateTime === 'function' ? formatDateTime(r.created_at) : r.created_at) : '';
        detailArr.push([dt, purposeLabel(r.purpose), r.provider, r.model, r.input_tokens != null ? r.input_tokens : '', r.output_tokens != null ? r.output_tokens : '', formatCost(r.cost_estimate_usd), r.status === 'ok' ? 'ok' : (r.error_code || 'error')]);
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailArr), 'Детализация');
    }
    var name = 'llm-usage-' + (new Date().toISOString().slice(0, 10)) + '.xlsx';
    XLSX.writeFile(wb, name);
    showInfo('Экспорт сохранён: ' + name);
  }

  function renderProfileSection() {
    const sub = activeProfileSubSection;
    var jwt = decodeJwtPayload(localStorage.getItem('pk24_token'));
    var userRole = (jwt && jwt.role) || 'employee';

    if (sub === 'account') { renderProfileOverview(); return; }
    if (sub === 'password') { renderProfilePassword(); return; }
    if (sub === 'tariff') { renderProfileStub('Тариф', 'Текущий тарифный план и лимиты.', ['Выбор тарифа', 'Лимиты запросов', 'Дата продления']); return; }
    if (sub === 'payment') { renderProfileStub('Оплата', 'Способы оплаты и платёжные данные.', ['Привязанные карты', 'История платежей']); return; }
    if (sub === 'billing') { renderProfileStub('Биллинг', 'Счета и настройки биллинга.', ['Выставленные счета', 'Реквизиты', 'Налоги']); return; }
    if (sub === 'roles') { renderProfileRoles(); return; }
    if (sub === 'history') { renderProfileHistory(); return; }
    if (sub === 'trash') { renderProfileTrash(); loadDeletedTasks(); return; }
    if (sub === 'llm_keys' || sub === 'llm' || sub === 'llm_basic') { renderProfileLlmKeys(); return; }
    if (sub === 'llm_usage') { renderProfileLlmUsage(); return; }
    if (sub === 'metrics_project' || sub === 'metrics_tasks' || sub === 'metrics_time' || sub === 'metrics_budget') {
      if (window.PlanKanbanAnalytics && typeof window.PlanKanbanAnalytics.renderSection === 'function') {
        window.PlanKanbanAnalytics.renderSection({
          sectionId: sub, activeProjectId: activeProjId || '', activeProject: getActiveProject(),
          projects: projects.slice(), apiFetch: apiFetch, escapeHtml: escapeHtml, formatDateTime: formatDateTime,
        });
      } else {
        renderProfilePlaceholder('Метрики', 'Модуль аналитики не загружен.');
      }
      return;
    }
    if (sub === 'theme') { renderProfileThemeSettings(); return; }
    if (sub === 'design') { renderProfileUiSettings(); return; }
    if (sub === 'notifications') { renderProfileStub('Уведомления', 'Настройка уведомлений по email и в приложении.', ['Email-уведомления', 'Напоминания', 'Сводки']); return; }
    if (sub === 'rights') { if (userRole === 'admin') { renderProfileRights(); } else { renderProfileStub('Права', 'Доступ ограничен. Обратитесь к администратору.', []); } return; }
    if (sub === 'data_deletion') { if (userRole === 'admin') { renderProfileDataDeletion(); } else { renderProfileStub('Удаление данных', 'Доступ ограничен. Только администратор может удалять данные.', []); } return; }
    if (sub === 'logout') { renderProfileLogout(); return; }
    if (sub === 'doc_profile') { renderProfileStub('Документация: Профиль', 'Руководство по аккаунту, данным сессии, смене пароля.', ['Аккаунт', 'Текущий проект', 'Безопасность']); return; }
    if (sub === 'doc_llm') { renderProfileStub('Документация: LLM', 'Настройка ИИ-провайдеров, моделей и API-ключей.', ['Базовые настройки', 'Индивидуальные провайдеры', 'Статистика запросов']); return; }
    if (sub === 'doc_projects') { renderProfileStub('Документация: Проекты и задачи', 'Работа с проектами, доской канбан, задачами и ролями.', ['Проекты', 'Задачи и колонки', 'История действий']); return; }
    if (sub === 'doc_analytics') { renderProfileStub('Документация: Аналитика', 'Метрики проектов, задач, времени и бюджетов.', ['Проекты', 'Задачи', 'Время', 'Бюджеты']); return; }
    if (sub === 'doc_settings') { renderProfileStub('Документация: Настройки', 'Тема, дизайн интерфейса, уведомления.', ['Тема оформления', 'Дизайн', 'Уведомления']); return; }
    renderProfileOverview();
  }

  (function registerProfileGlobalsEarly() {
    window.__fillProfileContent = function (sectionId) {
      try {
        closeAllDropdowns();
        ensureProfilePanel();
        PROFILE_MAIN_SECTIONS = buildProfileSections();
        if (sectionId) {
          var main = PROFILE_MAIN_SECTIONS.find(function (m) { return m.id === sectionId; });
          if (main) {
            activeProfileSection = main.id;
            activeProfileSubSection = main.subs[0] ? main.subs[0].id : activeProfileSubSection;
          } else {
            var mainBySub = getMainSectionBySubId(sectionId);
            if (mainBySub) {
              activeProfileSection = mainBySub.id;
              activeProfileSubSection = sectionId;
            }
          }
        }
        renderProfileNavigation();
        renderProfileSubNav();
        renderProfileSection();
      } catch (err) {
        console.error('Profile content error:', err);
        var contentEl = document.getElementById('profile-content');
        if (contentEl) {
          contentEl.innerHTML = '<div class="profile-pane"><div class="profile-pane-title">Ошибка</div>' +
            '<div class="profile-pane-sub">Не удалось загрузить раздел. Проверьте консоль (F12).</div></div>';
        }
      }
    };
    window.openProfilePanel = function (sectionId) {
      var o = document.getElementById('profile-ov');
      if (o) o.classList.add('open');
      if (typeof window.__fillProfileContent === 'function') window.__fillProfileContent(sectionId || 'profile');
    };
    window.closeProfilePanel = closeProfilePanel;
    try { window.dispatchEvent(new CustomEvent('profile-bridge-ready')); } catch (e) { }
  })();

  function bindProfileButton() {
    const button = document.getElementById('btn-profile');
    if (!button || button.dataset.boundProfile === '1') {
      return;
    }
    button.dataset.boundProfile = '1';
    button.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      const overlay = ensureProfilePanel();
      if (overlay.classList.contains('open')) {
        closeProfilePanel();
      } else {
        openProfilePanel('profile');
      }
    };
  }

  function refreshProfileIfOpen() {
    const overlay = document.getElementById('profile-ov');
    if (overlay && overlay.classList.contains('open')) {
      renderProfileNavigation();
      renderProfileSubNav();
      renderProfileSection();
    }
  }

  function loadCompletionOverrides() {
    try {
      const raw = localStorage.getItem('pk_completion_overrides');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          completionOverrideByProject = parsed;
        }
      }
    } catch (_) {
      completionOverrideByProject = {};
    }
  }

  function saveCompletionOverrides() {
    try {
      localStorage.setItem(
        'pk_completion_overrides',
        JSON.stringify(completionOverrideByProject)
      );
    } catch (_) {
      // ignore storage failures
    }
  }

  function ensureStageColor(stage, forcedColor) {
    if (!stage) {
      return NO_STAGE_COLOR;
    }
    if (String(stage).trim().toLowerCase() === NO_STAGE.toLowerCase()) {
      var c = forcedColor && /^#[0-9a-fA-F]{6}$/.test(forcedColor) ? forcedColor : NO_STAGE_COLOR;
      SC[stage] = c;
      STAB_C[stage] = c;
      return c;
    }
    if (forcedColor && /^#[0-9a-fA-F]{6}$/.test(forcedColor)) {
      SC[stage] = forcedColor;
      STAB_C[stage] = forcedColor;
      return forcedColor;
    }
    if (SC[stage]) {
      return SC[stage];
    }
    let hash = 0;
    for (let i = 0; i < stage.length; i += 1) {
      hash = (hash * 31 + stage.charCodeAt(i)) >>> 0;
    }
    const color = EXTRA_STAGE_COLORS[hash % EXTRA_STAGE_COLORS.length];
    SC[stage] = color;
    STAB_C[stage] = color;
    return color;
  }

  function getStageColorFromProject(stage) {
    if (!stage) {
      return typeof window.getStageColor === 'function' ? window.getStageColor(stage) : '#6B7280';
    }
    var p = typeof window.getActiveProject === 'function' ? window.getActiveProject() : null;
    if (p && Array.isArray(p.stageSettings)) {
      var found = p.stageSettings.find(function (s) {
        return s.name === stage;
      });
      if (found && found.color) {
        return found.color;
      }
    }
    return typeof window.getStageColor === 'function' ? window.getStageColor(stage) : '#6B7280';
  }
  window.getStageColorFromProject = getStageColorFromProject;

  function getVisibleStagesFromTasks() {
    const configuredStages = getCurrentProjectStages();
    const presentStages = Array.from(
      new Set(
        tasks
          .map(function (task) {
            return (task.stage || '').trim();
          })
          .filter(function (stage) {
            return stage !== '';
          })
      )
    );

    const stageSet = new Set(configuredStages.map(function (s) {
      return s.toLowerCase();
    }));
    const extras = presentStages
      .filter(function (stage) {
        return !stageSet.has(stage.toLowerCase());
      })
      .sort(function (a, b) {
        return a.localeCompare(b, 'ru');
      });
    return configuredStages.concat(extras);
  }

  function syncColumnEmptyStates() {
    document.querySelectorAll('.col-body').forEach(function (body) {
      const cards = body.querySelectorAll('.card').length;
      const existing = body.querySelector('.col-empty');
      if (cards === 0) {
        if (!existing) {
          const empty = document.createElement('div');
          empty.className = 'col-empty';
          empty.textContent = 'Нет задач';
          body.appendChild(empty);
        }
      } else if (existing) {
        existing.remove();
      }
    });
  }

  function parseDisplayIdNumber(task) {
    if (Number.isFinite(task.public_id) && task.public_id > 0) {
      return task.public_id;
    }
    const match = String(task.id || '').match(/(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  function sortTasksForColumn(columnId, items) {
    const mode = columnSortModes[columnId] || DEFAULT_SORT_MODE;
    if (mode === DEFAULT_SORT_MODE) {
      return items.slice();
    }

    const sorted = items.slice();
    sorted.sort(function (a, b) {
      if (mode === 'id_asc') {
        return parseDisplayIdNumber(a) - parseDisplayIdNumber(b);
      }
      if (mode === 'id_desc') {
        return parseDisplayIdNumber(b) - parseDisplayIdNumber(a);
      }
      if (mode === 'name_asc') {
        return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
      }
      if (mode === 'name_desc') {
        return String(b.title || '').localeCompare(String(a.title || ''), 'ru');
      }
      if (mode === 'size') {
        const weightA = SIZE_WEIGHT[String(a.size || '').toUpperCase()] || 0;
        const weightB = SIZE_WEIGHT[String(b.size || '').toUpperCase()] || 0;
        return weightB - weightA;
      }
      if (mode === 'priority_desc') {
        const pA = Number(a.priority) || 0;
        const pB = Number(b.priority) || 0;
        return pB - pA;
      }
      if (mode === 'priority_asc') {
        const pA = Number(a.priority) || 0;
        const pB = Number(b.priority) || 0;
        return pA - pB;
      }
      return 0;
    });
    return sorted;
  }

  function renderColumnSortControls() {
    document.querySelectorAll('.col').forEach(function (columnElement) {
      const colId = columnElement.getAttribute('data-col');
      if (!colId) {
        return;
      }
      const head = columnElement.querySelector('.col-head');
      if (!head) {
        return;
      }

      const existing = head.querySelector('.bridge-col-sort');
      if (existing) {
        existing.remove();
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'bridge-col-sort';

      const select = document.createElement('select');
      select.style.cssText =
        'height:24px;padding:0 8px;background:var(--sf2);border:1px solid var(--bd2);border-radius:6px;color:var(--tx2);font-size:10px;font-family:DM Mono,monospace;outline:none;';
      SORT_OPTIONS.forEach(function (option) {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = (option.icon ? option.icon + ' ' : '') + option.label;
        if ((columnSortModes[colId] || DEFAULT_SORT_MODE) === option.value) {
          item.selected = true;
        }
        select.appendChild(item);
      });
      select.onchange = function () {
        columnSortModes[colId] = select.value;
        render();
      };

      wrapper.appendChild(select);
      const count = head.querySelector('.col-cnt');
      if (count) {
        head.insertBefore(wrapper, count);
      } else {
        head.appendChild(wrapper);
      }
      if (typeof pkDropdownInit === 'function') {
        pkDropdownInit(wrapper);
      }
    });
  }

  function nextStageColor(usedColors) {
    for (let i = 0; i < EXTRA_STAGE_COLORS.length; i += 1) {
      const color = EXTRA_STAGE_COLORS[i].toLowerCase();
      if (!usedColors.includes(color)) {
        return color;
      }
    }
    const hue = Math.floor((usedColors.length * 137.5) % 360);
    return hslToHex(hue, 72, 54);
  }

  function hslToHex(h, s, l) {
    const sat = s / 100;
    const light = l / 100;
    const c = (1 - Math.abs(2 * light - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = light - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) {
      r = c; g = x; b = 0;
    } else if (h < 120) {
      r = x; g = c; b = 0;
    } else if (h < 180) {
      r = 0; g = c; b = x;
    } else if (h < 240) {
      r = 0; g = x; b = c;
    } else if (h < 300) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }
    const toHex = function (value) {
      const hex = Math.round((value + m) * 255).toString(16).padStart(2, '0');
      return hex;
    };
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function ensureStageSettingsEditor(initialItems) {
    const body = document.querySelector('#ps-ov .ps-body');
    if (!body) {
      return;
    }

    let container = document.getElementById('ps-stage-settings');
    if (!container) {
      container = document.createElement('div');
      container.id = 'ps-stage-settings';
      container.className = 'ps-field';
      container.innerHTML = ''
        + '<div class="ps-label">Этапы проекта (этап / сумма / цвет)</div>'
        + '<div id="ps-stage-list" style="display:flex;flex-direction:column;gap:8px;"></div>'
        + '<button type="button" id="ps-stage-add" class="ps-stage-add-btn">Добавить этап</button>';
      body.appendChild(container);
    }

    const list = document.getElementById('ps-stage-list');
    const addButton = document.getElementById('ps-stage-add');
    list.innerHTML = '';

    var baseInitial = Array.isArray(initialItems) && initialItems.length > 0 ? initialItems : [];
    var hasNoStage = baseInitial.some(function (x) { return String(x.name || '').trim().toLowerCase() === NO_STAGE.toLowerCase(); });
    var safeInitial = hasNoStage ? baseInitial : [{ name: NO_STAGE, budget: 0, color: NO_STAGE_COLOR }].concat(baseInitial);
    var noStageFirst = safeInitial.filter(function (x) { return String(x.name || '').trim().toLowerCase() === NO_STAGE.toLowerCase(); });
    var restStages = safeInitial.filter(function (x) { return String(x.name || '').trim().toLowerCase() !== NO_STAGE.toLowerCase(); });
    safeInitial = (noStageFirst.length ? noStageFirst : [{ name: NO_STAGE, budget: 0, color: NO_STAGE_COLOR }]).concat(restStages);

    const createRow = function (item) {
      const isNoStage = String(item.name || '').trim().toLowerCase() === NO_STAGE.toLowerCase();
      const row = document.createElement('div');
      row.className = 'ps-stage-row';
      row.dataset.originalStage = String(item.name || '').trim();
      row.dataset.noStage = isNoStage ? '1' : '0';
      row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 46px 40px;gap:8px;align-items:center;';
      row.innerHTML = ''
        + '<input class="ps-input" data-field=\"stage-name\" placeholder=\"Этап\" value=\"' + String(item.name || '').replace(/\"/g, '&quot;') + '\"' + (isNoStage ? ' readonly' : '') + '>'
        + '<input class="ps-input" data-field=\"stage-budget\" type=\"number\" min=\"0\" placeholder=\"Сумма\" value=\"' + Number(item.budget || 0) + '\">'
        + '<input data-field=\"stage-color\" type=\"color\" value=\"' + (item.color || (isNoStage ? NO_STAGE_COLOR : '#4a9eff')) + '\" style=\"height:40px;border:1px solid var(--bd);border-radius:10px;background:var(--sf2);padding:4px;\">'
        + (isNoStage ? '<span data-field=\"stage-remove\" style=\"width:40px;visibility:hidden;\"></span>'
          : '<button type=\"button\" data-field=\"stage-remove\" class=\"ps-stage-remove\" title=\"Удалить этап\" aria-label=\"Удалить этап\">'
          + '<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" aria-hidden=\"true\">'
          + '<path d=\"M3 6h18\"></path><path d=\"M8 6V4h8v2\"></path>'
          + '<path d=\"M19 6l-1 14H6L5 6\"></path><path d=\"M10 11v6\"></path><path d=\"M14 11v6\"></path>'
          + '</svg></button>');
      const removeButton = row.querySelector('[data-field=\"stage-remove\"]');
      if (removeButton && removeButton.tagName === 'BUTTON') {
        removeButton.onclick = async function () {
          await handleStageRemoveRequest(row, createRow);
        };
      }
      const budgetInput = row.querySelector('[data-field=\"stage-budget\"]');
      budgetInput.oninput = syncProjectBudgetInputFromStageRows;
      list.appendChild(row);
    };

    safeInitial.forEach(function (item) {
      createRow(item);
    });

    addButton.onclick = function () {
      const usedColors = Array.from(list.querySelectorAll('[data-field=\"stage-color\"]'))
        .map(function (input) {
          return String(input.value || '').toLowerCase();
        });
      createRow({
        name: '',
        budget: 0,
        color: nextStageColor(usedColors),
      });
      syncProjectBudgetInputFromStageRows();
    };

    syncProjectBudgetInputFromStageRows();
  }

  function collectStageSettingsFromModal() {
    const list = document.getElementById('ps-stage-list');
    if (!list) {
      return [{ name: NO_STAGE, budget: 0, color: NO_STAGE_COLOR }];
    }
    const rows = Array.from(list.querySelectorAll('.ps-stage-row'));
    const result = [];
    var hasNoStage = false;
    rows.forEach(function (row) {
      const nameInput = row.querySelector('[data-field=\"stage-name\"]');
      const budgetInput = row.querySelector('[data-field=\"stage-budget\"]');
      const colorInput = row.querySelector('[data-field=\"stage-color\"]');
      const name = String((nameInput && nameInput.value) || '').trim();
      if (!name) {
        return;
      }
      if (name.toLowerCase() === NO_STAGE.toLowerCase()) hasNoStage = true;
      const budget = Math.max(0, Number((budgetInput && budgetInput.value) || 0));
      const color = String((colorInput && colorInput.value) || '').trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        return;
      }
      result.push({
        name: name,
        budget: Math.round(budget),
        color: color.toLowerCase(),
      });
    });
    if (!hasNoStage) {
      result.unshift({ name: NO_STAGE, budget: 0, color: NO_STAGE_COLOR });
    } else {
      var noStageIdx = result.findIndex(function (r) { return r.name.toLowerCase() === NO_STAGE.toLowerCase(); });
      if (noStageIdx > 0) {
        var noStageItem = result.splice(noStageIdx, 1)[0];
        result.unshift(noStageItem);
      }
    }
    return result;
  }

  function ensureAgentSettingsEditor(initialItems) {
    const container = document.getElementById('ps-agent-settings');
    if (!container) {
      return;
    }
    const list = document.getElementById('ps-agent-list');
    const addButton = document.getElementById('ps-agent-add');
    if (!list || !addButton) {
      return;
    }
    list.innerHTML = '';

    const safeInitial = Array.isArray(initialItems) && initialItems.length > 0
      ? initialItems
      : [{ name: '', type: 'ai', color: '#6B7280' }];

    const usedColors = function () {
      return Array.from(list.querySelectorAll('[data-field=\"agent-color\"]'))
        .map(function (input) {
          return String(input.value || '').toLowerCase();
        });
    };

    const NO_AGENT_LABEL = 'Без агента';
    const createRow = function (item) {
      const row = document.createElement('div');
      row.className = 'ps-agent-row';
      const isNoAgent = String(item.name || '').trim() === NO_AGENT_LABEL;
      row.style.cssText = 'display:grid;grid-template-columns:1fr 120px 46px 40px;gap:8px;align-items:center;';
      const typeVal = (item.type === 'ai' ? 'ai' : 'human');
      row.innerHTML = ''
        + '<input class="ps-input" data-field=\"agent-name\" placeholder=\"Имя агента\" value=\"' + escapeHtml(String(item.name || '')) + '\">'
        + '<select class="ps-input status-sel" data-field=\"agent-type\">'
        + '<option value=\"ai\"' + (typeVal === 'ai' ? ' selected' : '') + '>AI</option>'
        + '<option value=\"human\"' + (typeVal === 'human' ? ' selected' : '') + '>Human</option>'
        + '</select>'
        + '<input data-field=\"agent-color\" type=\"color\" value=\"' + (item.color || '#6B7280') + '\" style=\"width:40px;height:40px;border:1px solid var(--bd);border-radius:10px;background:var(--sf2);padding:4px;\">'
        + (isNoAgent ? '' : (
          '<button type=\"button\" data-field=\"agent-remove\" class=\"ps-stage-remove\" title=\"Удалить агента\" aria-label=\"Удалить агента\">'
          + '<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" aria-hidden=\"true\">'
          + '<path d=\"M3 6h18\"></path>'
          + '<path d=\"M8 6V4h8v2\"></path>'
          + '<path d=\"M19 6l-1 14H6L5 6\"></path>'
          + '<path d=\"M10 11v6\"></path>'
          + '<path d=\"M14 11v6\"></path>'
          + '</svg>'
          + '</button>'
        ));
      const removeBtn = row.querySelector('[data-field=\"agent-remove\"]');
      if (removeBtn) {
        removeBtn.onclick = function () {
          handleAgentRemoveRequest(row, list, createRow, usedColors);
        };
      }
      list.appendChild(row);
    };

    safeInitial.forEach(function (item) {
      createRow(item);
    });

    addButton.onclick = function () {
      const colors = usedColors();
      createRow({
        name: '',
        type: 'ai',
        color: nextStageColor(colors),
      });
      if (typeof pkDropdownInit === 'function') pkDropdownInit(document.getElementById('ps-agent-settings'));
    };
  }

  async function handleAgentRemoveRequest(row, list, createRow, usedColors) {
    const nameInput = row.querySelector('[data-field=\"agent-name\"]');
    const agentName = String((nameInput && nameInput.value) || '').trim();
    if (agentName === 'Без агента') {
      showError('Агент «Без агента» нельзя удалить — он всегда доступен в каждом проекте.');
      return;
    }
    if (!editingProjId || editingProjId === '__new__') {
      row.remove();
      return;
    }
    let tasksWithAgent = [];
    if (editingProjId === activeProjId && typeof tasks !== 'undefined' && Array.isArray(tasks)) {
      tasksWithAgent = tasks.filter(function (t) {
        return String(t.agent || '').trim().toLowerCase() === agentName.toLowerCase();
      });
    } else {
      try {
        const res = await apiFetch('/projects/' + editingProjId + '/tasks');
        const taskList = (res && res.tasks) ? res.tasks : [];
        tasksWithAgent = taskList.filter(function (t) {
          return String(t.agent || '').trim().toLowerCase() === agentName.toLowerCase();
        });
      } catch (e) {
        showError('Не удалось проверить задачи: ' + (e.message || e));
        return;
      }
    }
    if (tasksWithAgent.length > 0) {
      const otherAgents = collectAgentSettingsFromModal()
        .filter(function (a) { return a.name && a.name.toLowerCase() !== agentName.toLowerCase(); })
        .map(function (a) { return a.name; });
      if (otherAgents.length === 0) {
        showError('Нельзя удалить агента: нет других агентов для переназначения задач. Добавьте агента и переназначьте задачи.');
        return;
      }
      const msg = 'Агент «' + agentName + '» назначен на ' + tasksWithAgent.length + ' задач. Выберите нового ответственного:';
      const reassignTo = window.prompt(msg + '\n\nДоступны: ' + otherAgents.join(', '));
      if (reassignTo == null) return;
      const chosen = String(reassignTo || '').trim();
      if (!chosen || otherAgents.indexOf(chosen) < 0) {
        showError('Выберите агента из списка: ' + otherAgents.join(', '));
        return;
      }
      if (!confirm('Переназначить ' + tasksWithAgent.length + ' задач на «' + chosen + '» и удалить агента «' + agentName + '»?')) {
        return;
      }
      try {
        for (var i = 0; i < tasksWithAgent.length; i++) {
          var t = tasksWithAgent[i];
          var taskId = t.id || t.raw_id;
          if (taskId) {
            await apiFetch('/tasks/' + taskId, {
              method: 'PATCH',
              body: { agent: chosen },
            });
          }
        }
        showInfo('Задачи переназначены на «' + chosen + '»');
      } catch (e) {
        showError('Ошибка переназначения: ' + (e.message || e));
        return;
      }
    } else {
      if (!confirm('Удалить агента «' + (agentName || 'без имени') + '»?')) {
        return;
      }
    }
    row.remove();
  }

  function collectAgentSettingsFromModal() {
    const list = document.getElementById('ps-agent-list');
    if (!list) {
      return [];
    }
    const rows = Array.from(list.querySelectorAll('.ps-agent-row'));
    const result = [];
    rows.forEach(function (row) {
      const nameInput = row.querySelector('[data-field=\"agent-name\"]');
      const typeSelect = row.querySelector('[data-field=\"agent-type\"]');
      const colorInput = row.querySelector('[data-field=\"agent-color\"]');
      const name = String((nameInput && nameInput.value) || '').trim();
      if (!name) {
        return;
      }
      const type = (typeSelect && typeSelect.value === 'ai') ? 'ai' : 'human';
      const color = String((colorInput && colorInput.value) || '').trim();
      if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
        return;
      }
      result.push({
        name: name,
        type: type,
        color: color.toLowerCase(),
      });
    });
    return result;
  }

  function ensurePriorityOptionsEditor(initialItems) {
    const list = document.getElementById('ps-priority-list');
    const addButton = document.getElementById('ps-priority-add');
    if (!list || !addButton) return;
    list.innerHTML = '';
    const items = Array.isArray(initialItems) && initialItems.length > 0 ? initialItems : [{ value: 2, label: 'Medium' }];
    function createRow(item) {
      const row = document.createElement('div');
      row.className = 'ps-stage-row';
      row.style.cssText = 'display:grid;grid-template-columns:70px 1fr 48px 36px;gap:8px;align-items:center;';
      const defColors = { 1: '#6B7280', 2: '#3B82F6', 3: '#F59E0B', 4: '#EF4444' };
      const hex = (typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color)) ? item.color : (defColors[item.value] || '#6B7280');
      row.innerHTML = ''
        + '<input class="ps-input" data-field="priority-value" type="number" min="0" placeholder="Число" value="' + escapeHtml(String(item.value ?? '')) + '">'
        + '<input class="ps-input" data-field="priority-label" placeholder="Название (Low, High…)" value="' + escapeHtml(String(item.label ?? '')) + '">'
        + '<input type="color" data-field="priority-color" value="' + escapeHtml(hex) + '" style="width:40px;height:40px;padding:4px;border:1px solid var(--bd);border-radius:10px;background:var(--sf2);cursor:pointer;">'
        + '<button type="button" data-field="priority-remove" class="ps-stage-remove" title="Удалить">'
        + '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>'
        + '</button>';
      const rm = row.querySelector('[data-field="priority-remove"]');
      rm.onclick = function () { row.remove(); };
      list.appendChild(row);
    }
    items.forEach(createRow);
    addButton.onclick = function () {
      const last = list.querySelector('.ps-stage-row:last-child');
      const lastVal = last ? parseInt(last.querySelector('[data-field="priority-value"]')?.value, 10) : 0;
      createRow({ value: (isNaN(lastVal) ? 0 : lastVal) + 1, label: '', color: '#6B7280' });
    };
  }

  function ensureSizeOptionsEditor(initialItems) {
    const list = document.getElementById('ps-size-list');
    const addButton = document.getElementById('ps-size-add');
    if (!list || !addButton) return;
    list.innerHTML = '';
    const items = Array.isArray(initialItems) && initialItems.length > 0 ? initialItems : [{ id: 'M', label: 'M' }];
    function createRow(item) {
      const row = document.createElement('div');
      row.className = 'ps-stage-row';
      row.style.cssText = 'display:grid;grid-template-columns:70px 1fr 48px 36px;gap:8px;align-items:center;';
      const defColors = { XS: '#6B7280', S: '#3B82F6', M: '#10B981', L: '#F59E0B', XL: '#EF4444' };
      const hex = (typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color)) ? item.color : (defColors[String(item.id || 'M').toUpperCase()] || '#6B7280');
      row.innerHTML = ''
        + '<input class="ps-input" data-field="size-id" placeholder="XS,S,M,L,XL" value="' + escapeHtml(String(item.id ?? '')) + '">'
        + '<input class="ps-input" data-field="size-label" placeholder="Подпись" value="' + escapeHtml(String(item.label ?? item.id ?? '')) + '">'
        + '<input type="color" data-field="size-color" value="' + escapeHtml(hex) + '" style="width:40px;height:40px;padding:4px;border:1px solid var(--bd);border-radius:10px;background:var(--sf2);cursor:pointer;">'
        + '<button type="button" data-field="size-remove" class="ps-stage-remove" title="Удалить">'
        + '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>'
        + '</button>';
      const rm = row.querySelector('[data-field="size-remove"]');
      rm.onclick = function () { row.remove(); };
      list.appendChild(row);
    }
    items.forEach(createRow);
    addButton.onclick = function () { createRow({ id: '', label: '', color: '#6B7280' }); };
  }

  function ensureColumnSettingsEditor(initialItems) {
    const list = document.getElementById('ps-column-list');
    if (!list) return;
    list.innerHTML = '';
    const defaults = [
      { id: 'backlog', label: 'Backlog', visible: true, locked: true },
      { id: 'todo', label: 'To Do', visible: true, locked: false },
      { id: 'doing', label: 'In Progress', visible: true, locked: false },
      { id: 'review', label: 'Review', visible: true, locked: false },
      { id: 'done', label: 'Done', visible: true, locked: true },
    ];
    const items = Array.isArray(initialItems) && initialItems.length > 0 ? initialItems : defaults;
    items.forEach(function (item) {
      const row = document.createElement('div');
      row.className = 'ps-stage-row';
      row.dataset.colId = item.id || '';
      row.style.cssText = 'display:grid;grid-template-columns:22px 1fr 70px;gap:6px;align-items:center;';
      const locked = !!item.locked;
      row.innerHTML = ''
        + '<label style="display:flex;align-items:center;cursor:' + (locked ? 'not-allowed' : 'pointer') + '">'
        + '<input type="checkbox" data-field="col-visible" ' + (item.visible !== false ? 'checked' : '') + (locked ? ' disabled' : '') + ' style="width:16px;height:16px;">'
        + '</label>'
        + '<input class="ps-input" data-field="col-label" placeholder="Название колонки" value="' + escapeHtml(String(item.label ?? '')) + '">'
        + '<span style="font-size:10px;color:var(--tx3);">' + escapeHtml(item.id || '') + '</span>';
      list.appendChild(row);
    });
  }

  function collectPriorityOptionsFromModal() {
    const list = document.getElementById('ps-priority-list');
    if (!list) return [];
    const rows = list.querySelectorAll('.ps-stage-row');
    const result = [];
    rows.forEach(function (row) {
      const v = parseInt(row.querySelector('[data-field="priority-value"]')?.value, 10);
      const label = String(row.querySelector('[data-field="priority-label"]')?.value || '').trim();
      const colorEl = row.querySelector('[data-field="priority-color"]');
      const color = colorEl && /^#[0-9a-fA-F]{6}$/.test(colorEl.value) ? colorEl.value : '#6B7280';
      if (!label || isNaN(v) || v < 0) return;
      result.push({ value: v, label: label, color: color });
    });
    return result.sort(function (a, b) { return a.value - b.value; });
  }

  function collectSizeOptionsFromModal() {
    const list = document.getElementById('ps-size-list');
    if (!list) return [];
    const rows = list.querySelectorAll('.ps-stage-row');
    const result = [];
    rows.forEach(function (row) {
      const id = String(row.querySelector('[data-field="size-id"]')?.value || '').trim().toUpperCase();
      const label = String(row.querySelector('[data-field="size-label"]')?.value || id || '').trim();
      const colorEl = row.querySelector('[data-field="size-color"]');
      const color = colorEl && /^#[0-9a-fA-F]{6}$/.test(colorEl.value) ? colorEl.value : '#6B7280';
      if (!id) return;
      result.push({ id: id, label: label || id, color: color });
    });
    return result;
  }

  function collectColumnSettingsFromModal() {
    const list = document.getElementById('ps-column-list');
    if (!list) return [];
    const rows = list.querySelectorAll('.ps-stage-row');
    const result = [];
    const order = ['backlog', 'todo', 'doing', 'review', 'done'];
    rows.forEach(function (row) {
      const id = String(row.dataset.colId || '').trim().toLowerCase();
      if (!order.includes(id)) return;
      const visible = row.querySelector('[data-field="col-visible"]');
      const label = String(row.querySelector('[data-field="col-label"]')?.value || '').trim();
      const locked = id === 'backlog' || id === 'done';
      result.push({
        id: id,
        label: label || id,
        visible: locked ? true : (visible && !visible.disabled ? visible.checked : true),
        locked: locked,
      });
    });
    return order.map(function (cid) {
      const found = result.find(function (r) { return r.id === cid; });
      return found || { id: cid, label: cid, visible: true, locked: cid === 'backlog' || cid === 'done' };
    });
  }

  function syncProjectBudgetInputFromStageRows() {
    const stageSettings = collectStageSettingsFromModal();
    const total = stageSettings.reduce(function (sum, item) {
      return sum + Number(item.budget || 0);
    }, 0);
    const budgetInput = document.getElementById('ps-budget');
    if (budgetInput) {
      if (total > 0) {
        budgetInput.value = String(Math.max(0, Math.round(total)));
      }
    }
  }

  function readCurrentStageRows() {
    const list = document.getElementById('ps-stage-list');
    if (!list) {
      return [];
    }
    return Array.from(list.querySelectorAll('.ps-stage-row'));
  }

  function getRowStageName(row) {
    if (!row) {
      return '';
    }
    const nameInput = row.querySelector('[data-field=\"stage-name\"]');
    return String((nameInput && nameInput.value) || '').trim();
  }

  function getRowStageBudget(row) {
    if (!row) {
      return 0;
    }
    const budgetInput = row.querySelector('[data-field=\"stage-budget\"]');
    return Math.max(0, Number((budgetInput && budgetInput.value) || 0));
  }

  function replacePendingStageAction(projectId, action) {
    if (!projectId || projectId === '__new__') {
      return;
    }
    const list = pendingStageActionsByProject[projectId] || [];
    const stageKey = String(action.stage || '').trim().toLowerCase();
    const filtered = list.filter(function (item) {
      return String(item.stage || '').trim().toLowerCase() !== stageKey;
    });
    filtered.push(action);
    pendingStageActionsByProject[projectId] = filtered;
  }

  async function getTasksForProject(projectId) {
    if (!projectId) {
      return [];
    }
    if (projectId === activeProjId) {
      return tasks.slice();
    }
    const response = await apiFetch('/projects/' + projectId + '/tasks');
    return (response && response.tasks ? response.tasks : []).map(mapTaskFromApi);
  }

  function openStageRemoveActionModal(params) {
    const stageName = params.stageName;
    const taskCount = Number(params.taskCount || 0);
    const targetStages = Array.isArray(params.targetStages) ? params.targetStages : [];

    return new Promise(function (resolve) {
      let overlay = document.getElementById('remove-stage-ov');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'remove-stage-ov';
        overlay.className = 'overlay open';
        overlay.innerHTML = ''
          + '<div class="bridge-confirm-card">'
          + '<div class="bridge-confirm-title">В этапе есть задачи</div>'
          + '<div class="bridge-confirm-sub" id="remove-stage-sub"></div>'
          + '<div style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">'
          + '<select id="remove-stage-target" class="bridge-delete-input"></select>'
          + '<input id="remove-stage-new-name" class="bridge-delete-input" placeholder="Название нового этапа" style="display:none;">'
          + '</div>'
          + '<div class="bridge-confirm-row" style="justify-content:space-between;">'
          + '<button class="bridge-confirm-btn no" id="remove-stage-cancel">Отмена</button>'
          + '<div style="display:flex;gap:8px;">'
          + '<button class="bridge-confirm-btn danger" id="remove-stage-delete">Удалить этап и задачи</button>'
          + '<button class="bridge-confirm-btn yes" id="remove-stage-move">Перенести и удалить этап</button>'
          + '</div>'
          + '</div>'
          + '</div>';
        document.body.appendChild(overlay);
      }

      overlay.classList.add('open');
      const subtitle = document.getElementById('remove-stage-sub');
      const targetSelect = document.getElementById('remove-stage-target');
      const newNameInput = document.getElementById('remove-stage-new-name');
      const cancelButton = document.getElementById('remove-stage-cancel');
      const deleteButton = document.getElementById('remove-stage-delete');
      const moveButton = document.getElementById('remove-stage-move');
      if (
        !subtitle ||
        !targetSelect ||
        !newNameInput ||
        !cancelButton ||
        !deleteButton ||
        !moveButton
      ) {
        resolve(null);
        return;
      }

      subtitle.textContent =
        'В этапе «' +
        stageName +
        '» найдено задач: ' +
        taskCount +
        '. Выберите, что сделать с этими задачами.';

      targetSelect.innerHTML = '';
      targetStages.forEach(function (targetStage) {
        const option = document.createElement('option');
        option.value = targetStage;
        option.textContent = 'Перенести в этап «' + targetStage + '»';
        targetSelect.appendChild(option);
      });
      const newOption = document.createElement('option');
      newOption.value = '__new__';
      newOption.textContent = 'Создать новый этап и перенести';
      targetSelect.appendChild(newOption);

      targetSelect.onchange = function () {
        newNameInput.style.display =
          targetSelect.value === '__new__' ? 'block' : 'none';
      };
      targetSelect.onchange();

      cancelButton.onclick = function () {
        overlay.remove();
        resolve(null);
      };

      deleteButton.onclick = function () {
        overlay.remove();
        resolve({ kind: 'delete' });
      };

      moveButton.onclick = function () {
        if (targetSelect.value === '__new__') {
          const newStageName = String(newNameInput.value || '').trim();
          if (!newStageName) {
            newNameInput.focus();
            return;
          }
          overlay.remove();
          resolve({ kind: 'move', targetStage: newStageName, createNew: true });
          return;
        }

        if (!targetSelect.value) {
          return;
        }
        overlay.remove();
        resolve({ kind: 'move', targetStage: targetSelect.value, createNew: false });
      };
    });
  }

  async function handleStageRemoveRequest(row, createRowFn) {
    const stageName = getRowStageName(row);
    const originalStageName = String(row.dataset.originalStage || '').trim();
    if (String(stageName || '').trim().toLowerCase() === NO_STAGE.toLowerCase() ||
      String(originalStageName || '').trim().toLowerCase() === NO_STAGE.toLowerCase()) {
      showError('Этап «' + NO_STAGE + '» нельзя удалить');
      return;
    }
    const stageBudget = getRowStageBudget(row);
    const rows = readCurrentStageRows();

    const stageCandidates = [];
    if (stageName) {
      stageCandidates.push(stageName);
    }
    if (
      originalStageName &&
      !stageCandidates.some(function (name) {
        return name.toLowerCase() === originalStageName.toLowerCase();
      })
    ) {
      stageCandidates.push(originalStageName);
    }

    if (stageCandidates.length === 0) {
      row.remove();
      syncProjectBudgetInputFromStageRows();
      return;
    }

    const projectId = editingProjId && editingProjId !== '__new__' ? editingProjId : null;
    if (!projectId) {
      row.remove();
      syncProjectBudgetInputFromStageRows();
      return;
    }

    let projectTasks = [];
    try {
      projectTasks = await getTasksForProject(projectId);
    } catch (error) {
      showError('Не удалось проверить задачи этапа: ' + error.message);
      return;
    }

    const stageCandidateSet = new Set(
      stageCandidates.map(function (name) {
        return name.toLowerCase();
      })
    );
    const stageTasks = projectTasks.filter(function (task) {
      const taskStage = String(task.stage || '').trim().toLowerCase();
      return stageCandidateSet.has(taskStage);
    });

    if (stageTasks.length === 0) {
      row.remove();
      syncProjectBudgetInputFromStageRows();
      return;
    }

    const affectedStageNames = Array.from(
      stageTasks.reduce(function (set, task) {
        const taskStage = String(task.stage || '').trim();
        if (taskStage) {
          set.add(taskStage);
        }
        return set;
      }, new Set())
    );
    const primaryStageName = affectedStageNames[0] || stageCandidates[0];

    const targetStages = rows
      .map(getRowStageName)
      .filter(function (name) {
        if (!name) {
          return false;
        }
        return !stageCandidateSet.has(name.toLowerCase());
      });

    const action = await openStageRemoveActionModal({
      stageName: primaryStageName,
      taskCount: stageTasks.length,
      targetStages: targetStages,
    });
    if (!action) {
      return;
    }

    if (action.kind === 'delete') {
      affectedStageNames.forEach(function (affectedStage) {
        replacePendingStageAction(projectId, {
          kind: 'delete',
          stage: affectedStage,
        });
      });
      row.remove();
      syncProjectBudgetInputFromStageRows();
      return;
    }

    let targetStage = String(action.targetStage || '').trim();
    if (!targetStage) {
      showError('Выберите этап для переноса задач');
      return;
    }

    if (action.createNew) {
      const list = document.getElementById('ps-stage-list');
      if (!list) {
        return;
      }
      const duplicate = readCurrentStageRows().some(function (item) {
        return getRowStageName(item).toLowerCase() === targetStage.toLowerCase();
      });
      if (!duplicate) {
        const usedColors = Array.from(
          list.querySelectorAll('[data-field=\"stage-color\"]')
        ).map(function (input) {
          return String(input.value || '').toLowerCase();
        });
        createRowFn({
          name: targetStage,
          budget: stageBudget,
          color: nextStageColor(usedColors),
        });
      }
    }

    affectedStageNames.forEach(function (affectedStage) {
      replacePendingStageAction(projectId, {
        kind: 'move',
        stage: affectedStage,
        target: targetStage,
      });
    });
    row.remove();
    syncProjectBudgetInputFromStageRows();
  }

  async function applyPendingStageActions(projectId, finalStageSettings) {
    const planned = pendingStageActionsByProject[projectId] || [];
    if (!planned.length) {
      return;
    }

    const finalStages = finalStageSettings.map(function (item) {
      return String(item.name || '').trim();
    });
    const finalStageSet = new Set(
      finalStages.map(function (stage) {
        return stage.toLowerCase();
      })
    );

    const projectTasks = await getTasksForProject(projectId);
    for (const action of planned) {
      const actionStage = String(action.stage || '').trim().toLowerCase();
      if (!actionStage || finalStageSet.has(actionStage)) {
        continue;
      }

      const affected = projectTasks.filter(function (task) {
        return String(task.stage || '').trim().toLowerCase() === actionStage;
      });
      if (!affected.length) {
        continue;
      }

      if (action.kind === 'delete') {
        for (const task of affected) {
          await apiFetch('/tasks/' + task.raw_id, { method: 'DELETE' });
        }
        continue;
      }

      if (action.kind === 'move') {
        const targetStage = String(action.target || '').trim();
        if (!targetStage || !finalStageSet.has(targetStage.toLowerCase())) {
          throw new Error('invalid_stage_transfer_target');
        }
        for (const task of affected) {
          await apiFetch('/tasks/' + task.raw_id, {
            method: 'PATCH',
            body: {
              stage: targetStage,
            },
          });
        }
      }
    }
  }

  async function ensureTaskStagesPreserved(projectId, stageSettings) {
    if (!projectId || projectId === '__new__') {
      return {
        stageSettings: stageSettings.slice(),
        addedStages: [],
      };
    }

    const base = stageSettings.slice();
    const existing = new Set(
      base.map(function (item) {
        return String(item.name || '').trim().toLowerCase();
      })
    );

    const planned = pendingStageActionsByProject[projectId] || [];
    const explicitlyHandled = new Set(
      planned.map(function (action) {
        return String(action.stage || '').trim().toLowerCase();
      })
    );

    const projectTasks = await getTasksForProject(projectId);
    const addedStages = [];

    projectTasks.forEach(function (task) {
      const stageName = String(task.stage || '').trim();
      if (!stageName) {
        return;
      }
      const stageKey = stageName.toLowerCase();
      if (existing.has(stageKey) || explicitlyHandled.has(stageKey)) {
        return;
      }
      existing.add(stageKey);
      addedStages.push(stageName);
      base.push({
        name: stageName,
        budget: 0,
        color: ensureStageColor(stageName, null),
      });
    });

    return {
      stageSettings: base,
      addedStages: addedStages,
    };
  }

  var NTM_AGENT_OPTIONS = [
    'Без агента', 'Backend', 'Frontend', 'DevOps', 'QA', 'Design', 'Security',
    'Integrations', 'Search', 'BOM', 'LLM', 'Analytics', 'Admin', 'PM'
  ];

  function getNtmAgentOptions() {
    var agents = getCurrentProjectAgents().filter(function (a) { return a !== 'Без агента'; });
    return ['Без агента'].concat(agents);
  }

  function ensureNtmHiddenOptions() {
    var agentOpts = getNtmAgentOptions();
    var agentSel = document.getElementById('ntm-agent');
    if (agentSel) {
      agentSel.innerHTML = '';
      agentOpts.forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        agentSel.appendChild(opt);
      });
    }
    var trackSel = document.getElementById('ntm-track');
    if (trackSel) {
      trackSel.innerHTML = '';
      NTM_AGENT_OPTIONS.forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        trackSel.appendChild(opt);
      });
    }
    var sizeSel = document.getElementById('ntm-size');
    if (sizeSel) {
      var sizeOpts = typeof getCurrentProjectSizeOptions === 'function' ? getCurrentProjectSizeOptions() : [{ id: 'XS', label: 'XS' }, { id: 'S', label: 'S' }, { id: 'M', label: 'M' }, { id: 'L', label: 'L' }, { id: 'XL', label: 'XL' }];
      sizeSel.innerHTML = '';
      sizeOpts.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.id || s;
        opt.textContent = s.label || s.id || s;
        sizeSel.appendChild(opt);
      });
    }
    var prioSel = document.getElementById('ntm-priority');
    if (prioSel) {
      var prioOpts = typeof getCurrentProjectPriorityOptions === 'function' ? getCurrentProjectPriorityOptions() : [{ value: 1, label: 'Low' }, { value: 2, label: 'Medium' }, { value: 3, label: 'High' }, { value: 4, label: 'Critical' }];
      prioSel.innerHTML = '';
      prioOpts.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = String(p.value);
        opt.textContent = p.label;
        prioSel.appendChild(opt);
      });
    }
  }

  function fillManualTaskStageOptions() {
    const stageSelect = document.getElementById('ntm-stage');
    if (!stageSelect) {
      return;
    }
    let stages = getCurrentProjectStages();
    if (stages.length === 0 && typeof tasks !== 'undefined' && tasks.length > 0) {
      stages = Array.from(new Set(tasks.map(function (t) { return (t.stage || '').trim(); }).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'ru'); });
    }
    stageSelect.innerHTML = '';
    stages.forEach(function (stage) {
      ensureStageColor(stage, null);
      const option = document.createElement('option');
      option.value = stage;
      option.textContent = stage;
      stageSelect.appendChild(option);
    });
  }

  function resetManualTaskForm() {
    const title = document.getElementById('ntm-title');
    const taskCodeEl = document.getElementById('ntm-task-code');
    const col = document.getElementById('ntm-col');
    const stage = document.getElementById('ntm-stage');
    const agent = document.getElementById('ntm-agent');
    const track = document.getElementById('ntm-track');
    const size = document.getElementById('ntm-size');
    const hours = document.getElementById('ntm-hours');
    const priority = document.getElementById('ntm-priority');
    const desc = document.getElementById('ntm-desc');
    if (!title || !stage || !agent || !track || !size || !hours || !priority || !desc) {
      return;
    }

    title.value = '';
    if (taskCodeEl) taskCodeEl.value = '';
    if (col) col.value = 'backlog';
    stage.selectedIndex = 0;
    if (agent) agent.selectedIndex = 0;
    track.value = 'Backend';
    size.value = 'M';
    hours.value = '8';
    priority.value = '2';
    desc.value = '';
    var depsEl = document.getElementById('ntm-deps');
    if (depsEl) depsEl.value = '';
  }

  function setTaskCreateMode(mode) {
    newTaskCreateMode = mode === 'manual' ? 'manual' : 'ai';
  }
  window.setTaskCreateMode = setTaskCreateMode;

  async function createManualTaskFromForm() {
    if (!activeProjId) {
      showError('Сначала выберите активный проект');
      return;
    }

    const submitButton = document.getElementById('ntm-create');
    const titleInput = document.getElementById('ntm-title');
    const stageInput = document.getElementById('ntm-stage');
    const agentInput = document.getElementById('ntm-agent');
    const trackInput = document.getElementById('ntm-track');
    const sizeInput = document.getElementById('ntm-size');
    const hoursInput = document.getElementById('ntm-hours');
    const priorityInput = document.getElementById('ntm-priority');
    const descInput = document.getElementById('ntm-desc');
    const notesInput = document.getElementById('ntm-notes');

    if (
      !submitButton ||
      !titleInput ||
      !stageInput ||
      !agentInput ||
      !trackInput ||
      !sizeInput ||
      !hoursInput ||
      !priorityInput ||
      !descInput
    ) {
      showError('Не все поля формы найдены. Обновите страницу.');
      return;
    }

    const title = String(titleInput.value || '').trim();
    if (!title) {
      titleInput.focus();
      return;
    }
    var taskCodeInput = document.getElementById('ntm-task-code');
    var taskCode = taskCodeInput ? String(taskCodeInput.value || '').trim().slice(0, 10) : '';
    var depsInput = document.getElementById('ntm-deps');
    var depsRaw = depsInput ? String(depsInput.value || '').trim() : '';
    var depsBlocks = [];
    if (depsRaw) {
      depsRaw.split(/[\s,;]+/).forEach(function (s) {
        var code = s.trim();
        if (code) depsBlocks.push(code);
      });
    }
    var stageVal = String(stageInput.value || '').trim() || (getCurrentProjectStages()[0] || '');
    if (!stageVal) {
      showError('Укажите этап задачи');
      if (stageInput) stageInput.focus();
      return;
    }

    var colInput = document.getElementById('ntm-col');
    var colVal = (colInput && colInput.value) ? String(colInput.value).trim() : 'backlog';

    submitButton.disabled = true;
    try {
      await createTaskFromPreview({
        title: title,
        task_code: taskCode || null,
        deps: depsBlocks.length ? { blocks: depsBlocks } : null,
        col: colVal,
        stage: stageVal,
        agent: String(agentInput.value || 'Без агента').trim() || 'Без агента',
        track: String(trackInput.value || '').trim(),
        size: String(sizeInput.value || 'M').trim() || 'M',
        hours: Math.max(0, Number(hoursInput.value || 0)),
        priority: Math.max(1, Math.min(4, Number(priorityInput.value || 2))),
        desc: String(descInput.value || '').trim(),
        notes: (notesInput ? String(notesInput.value || '').trim() : ''),
      });

      if (typeof window.closeTaskCreate === 'function') window.closeTaskCreate();
      await loadTasksForActiveProject();
      render();
      syncColumnEmptyStates();
      updateStageTabs();
      scheduleHeaderRefresh();
      await syncCompletionMode();
      applyTimerFromSnapshot();
      showInfo('Задача добавлена');
    } catch (error) {
      showError('Task create failed: ' + error.message);
    } finally {
      submitButton.disabled = false;
    }
  }
  window.createManualTaskFromForm = createManualTaskFromForm;

  function ensureManualTaskCreatorUI() {
    // manual creation form removed; keep as no-op
    return;
  }

  function isProjectCompleted() {
    if (!activeProjId) {
      return false;
    }
    if (!tasks.length) {
      return false;
    }
    return tasks.every(function (task) {
      return task.col === 'done';
    });
  }

  async function ensureToken() {
    if (authToken) {
      return authToken;
    }

    const stored = localStorage.getItem('pk24_token');
    if (stored) {
      authToken = stored;
      return authToken;
    }

    // Нет токена — редиректим на страницу входа
    location.replace('/login.html');
    // Возвращаем промис, который никогда не резолвится,
    // чтобы остановить дальнейшее выполнение до редиректа
    return new Promise(function () { });
  }

  async function apiFetch(path, options) {
    const params = options || {};
    const method = params.method || 'GET';
    const headers = Object.assign({}, params.headers || {});
    const token = await ensureToken();

    headers.Authorization = 'Bearer ' + token;

    let body = params.body;
    if (body !== undefined && body !== null && typeof body !== 'string') {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(body);
    }

    const fetchOpts = {
      method: method,
      headers: headers,
      body: body,
    };
    if (params.signal) {
      fetchOpts.signal = params.signal;
    }
    const response = await fetch(path, fetchOpts);

    if (response.status === 401) {
      authToken = '';
      localStorage.removeItem('pk24_token');
      localStorage.removeItem('pk24_email');
      location.replace('/login.html');
      return new Promise(function () { });
    }

    if (!response.ok) {
      let errorCode = response.status + '';
      let errorBody = null;
      try {
        errorBody = await response.json();
        if (errorBody && errorBody.error) {
          errorCode = errorBody.error;
        }
      } catch (_) {
        // ignore parse errors
      }
      const err = new Error(errorCode);
      if (errorBody) err.body = errorBody;
      throw err;
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  function mapProjectFromApi(project) {
    let stageSettings = Array.isArray(project.stage_settings)
      ? project.stage_settings
        .filter(function (item) {
          return item && typeof item.name === 'string' && item.name.trim() !== '';
        })
        .map(function (item) {
          return {
            name: item.name.trim(),
            budget: Number(item.budget || 0),
            color:
              typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color)
                ? item.color
                : null,
          };
        })
      : [];
    var noStageLower = NO_STAGE.toLowerCase();
    var hasNoStage = stageSettings.some(function (s) { return s.name.toLowerCase() === noStageLower; });
    if (!hasNoStage) {
      stageSettings = [{ name: NO_STAGE, budget: 0, color: NO_STAGE_COLOR }].concat(stageSettings);
    } else {
      var noStageItem = stageSettings.find(function (s) { return s.name.toLowerCase() === noStageLower; });
      var rest = stageSettings.filter(function (s) { return s.name.toLowerCase() !== noStageLower; });
      stageSettings = [noStageItem].concat(rest);
    }
    stageSettings.forEach(function (stage) {
      if (stage.color) {
        ensureStageColor(stage.name, stage.color);
      }
    });

    const agentSettings = Array.isArray(project.agent_settings)
      ? project.agent_settings
        .filter(function (item) {
          return item && typeof item.name === 'string' && item.name.trim() !== '';
        })
        .map(function (item) {
          return {
            name: item.name.trim(),
            type: (item.type === 'ai' ? 'ai' : 'human'),
            color:
              typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color)
                ? item.color
                : '#6B7280',
          };
        })
      : [];

    const defPrioColors = { 1: '#6B7280', 2: '#3B82F6', 3: '#F59E0B', 4: '#EF4444' };
    const defSizeColors = { XS: '#6B7280', S: '#3B82F6', M: '#10B981', L: '#F59E0B', XL: '#EF4444' };
    const rawPrio = Array.isArray(project.priority_options) && project.priority_options.length > 0 ? project.priority_options : [{ value: 1, label: 'Low' }, { value: 2, label: 'Medium' }, { value: 3, label: 'High' }, { value: 4, label: 'Critical' }];
    const priorityOptions = rawPrio.map(function (item) {
      const v = Number(item.value);
      const c = typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color : (defPrioColors[v] || '#6B7280');
      return { value: v, label: item.label || '', color: c };
    });
    const rawSize = Array.isArray(project.size_options) && project.size_options.length > 0 ? project.size_options : [{ id: 'XS', label: 'XS' }, { id: 'S', label: 'S' }, { id: 'M', label: 'M' }, { id: 'L', label: 'L' }, { id: 'XL', label: 'XL' }];
    const sizeOptions = rawSize.map(function (item) {
      const k = String(item.id || '').toUpperCase();
      const c = typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color) ? item.color : (defSizeColors[k] || '#6B7280');
      return { id: k, label: item.label || k, color: c };
    });
    const columnSettings = Array.isArray(project.column_settings) && project.column_settings.length > 0
      ? project.column_settings
      : [
          { id: 'backlog', label: 'Backlog', visible: true, locked: true },
          { id: 'todo', label: 'To Do', visible: true, locked: false },
          { id: 'doing', label: 'In Progress', visible: true, locked: false },
          { id: 'review', label: 'Review', visible: true, locked: false },
          { id: 'done', label: 'Done', visible: true, locked: true },
        ];
    return {
      id: project.id,
      name: project.name,
      weeks: Number(project.duration_weeks || 0),
      budget: Number(project.budget_total || 0),
      stages: stageSettings.length > 0
        ? stageSettings.map(function (item) {
          return item.name;
        })
        : Array.isArray(project.stages) && project.stages.length > 0
          ? project.stages.slice()
          : [],
      stageSettings: stageSettings,
      agentSettings: agentSettings,
      priorityOptions: priorityOptions,
      sizeOptions: sizeOptions,
      columnSettings: columnSettings,
      responsible_user_id: project.responsible_user_id || null,
      historyRetentionMonths: project.history_retention_months != null ? Number(project.history_retention_months) : null,
    };
  }

  function normalizeUiCol(apiCol) {
    return API_TO_UI_COL[(apiCol || '').toLowerCase()] || 'backlog';
  }

  function normalizeApiCol(uiCol) {
    return UI_TO_API_COL[(uiCol || '').toLowerCase()] || 'backlog';
  }

  function mapTaskFromApi(task) {
    var stage = (task.stage || '').trim() || '';
    if (!stage) stage = NO_STAGE;
    if (stage) ensureStageColor(stage);
    const publicIdNumber = Number(task.public_id || 0);
    const displayId =
      publicIdNumber > 0
        ? 'T-' + String(publicIdNumber).padStart(6, '0')
        : String(task.id || '');
    const hours = Number(task.hours || 0);
    let size = String(task.size || '').toUpperCase();
    if (!['XS', 'S', 'M', 'L', 'XL'].includes(size)) {
      if (hours >= 60) {
        size = 'XL';
      } else if (hours >= 24) {
        size = 'L';
      } else if (hours > 0 && hours < 8) {
        size = 'S';
      } else {
        size = 'M';
      }
    }
    let priority = Number(task.priority);
    if (!Number.isFinite(priority) && typeof task.priority === 'string' && task.priority.trim()) {
      const key = String(task.priority).trim().toLowerCase();
      const map = { low: 1, mid: 2, medium: 2, high: 3, critical: 4 };
      priority = map[key] != null ? map[key] : 0;
    }
    if (!Number.isFinite(priority)) priority = 0;
    var depsVal = task.deps;
    if (!depsVal || typeof depsVal !== 'object' || !Array.isArray(depsVal.blocks)) {
      depsVal = { blocks: [] };
    }
    return {
      id: displayId,
      raw_id: task.id,
      public_id: publicIdNumber > 0 ? publicIdNumber : null,
      task_code: (task.task_code && String(task.task_code).trim()) || '',
      title: task.title || 'Untitled',
      col: normalizeUiCol(task.col),
      position: Number.isFinite(Number(task.position)) ? Number(task.position) : 0,
      stage: stage,
      track: task.track || '',
      agent: task.agent || 'Tech Lead',
      size: size,
      hours: hours,
      desc: task.descript || task.description || '',
      notes: task.notes || '',
      deps: depsVal,
      priority: priority,
    };
  }

  function mapTaskDialogToPreview(taskDialogData) {
    return {
      title: taskDialogData.title,
      desc: taskDialogData.descript,
      stage: (taskDialogData.stage && String(taskDialogData.stage).trim()) || (getCurrentProjectStages()[0] || ''),
      agent: 'Tech Lead',
      size: 'M',
      hours: 8,
      track: 'Backend',
      priority: Number(taskDialogData.priority || 0),
    };
  }

  function getCurrentProjectStages() {
    const currentProject = getActiveProject();
    var stages = [];
    if (
      currentProject &&
      Array.isArray(currentProject.stageSettings) &&
      currentProject.stageSettings.length > 0
    ) {
      stages = currentProject.stageSettings.map(function (item) {
        return item.name;
      });
    } else if (currentProject && Array.isArray(currentProject.stages) && currentProject.stages.length > 0) {
      stages = currentProject.stages.slice();
    }
    if (stages.length === 0 || stages[0] !== NO_STAGE) {
      var rest = stages.filter(function (s) { return String(s || '').trim().toLowerCase() !== NO_STAGE.toLowerCase(); });
      stages = [NO_STAGE].concat(rest);
    }
    return stages;
  }

  function getCurrentProjectAgents() {
    const currentProject = getActiveProject();
    if (
      currentProject &&
      Array.isArray(currentProject.agentSettings) &&
      currentProject.agentSettings.length > 0
    ) {
      return currentProject.agentSettings.map(function (item) {
        return item.name;
      });
    }
    return [];
  }

  function getAgentColorFromProject(agentName) {
    const currentProject = getActiveProject();
    if (
      currentProject &&
      Array.isArray(currentProject.agentSettings) &&
      currentProject.agentSettings.length > 0
    ) {
      const a = currentProject.agentSettings.find(function (item) {
        return item.name && String(item.name).toLowerCase() === String(agentName || '').toLowerCase();
      });
      if (a && a.color) return a.color;
    }
    return null;
  }
  window.getAgentColorFromProject = getAgentColorFromProject;

  function getProjectColumns() {
    const p = getActiveProject();
    const defaults = [
      { id: 'backlog', label: 'Backlog' },
      { id: 'todo', label: 'To Do' },
      { id: 'inprogress', label: 'In Progress' },
      { id: 'review', label: 'Review' },
      { id: 'done', label: 'Done' },
    ];
    if (!p || !Array.isArray(p.columnSettings) || p.columnSettings.length === 0) {
      return defaults;
    }
    const uiColMap = { doing: 'inprogress' };
    return p.columnSettings
      .filter(function (c) { return c && c.visible !== false; })
      .map(function (c) {
        const apiId = c.id;
        const uiId = uiColMap[apiId] || apiId;
        return { id: uiId, label: (c.label && c.label.trim()) || c.id || uiId };
      });
  }
  window.getProjectColumns = getProjectColumns;

  function getCurrentProjectPriorityOptions() {
    const p = getActiveProject();
    if (p && Array.isArray(p.priorityOptions) && p.priorityOptions.length > 0) {
      return p.priorityOptions;
    }
    return [{ value: 1, label: 'Low', color: '#6B7280' }, { value: 2, label: 'Medium', color: '#3B82F6' }, { value: 3, label: 'High', color: '#F59E0B' }, { value: 4, label: 'Critical', color: '#EF4444' }];
  }

  function getCurrentProjectSizeOptions() {
    const p = getActiveProject();
    if (p && Array.isArray(p.sizeOptions) && p.sizeOptions.length > 0) {
      return p.sizeOptions;
    }
    return [{ id: 'XS', label: 'XS', color: '#6B7280' }, { id: 'S', label: 'S', color: '#3B82F6' }, { id: 'M', label: 'M', color: '#10B981' }, { id: 'L', label: 'L', color: '#F59E0B' }, { id: 'XL', label: 'XL', color: '#EF4444' }];
  }

  function getPriorityColorFromProject(value) {
    const opts = getCurrentProjectPriorityOptions();
    const opt = opts.find(function (o) { return Number(o.value) === Number(value); });
    return (opt && opt.color) || '';
  }
  window.getPriorityColorFromProject = getPriorityColorFromProject;

  function getSizeColorFromProject(sizeId) {
    const opts = getCurrentProjectSizeOptions();
    const opt = opts.find(function (o) { return String(o.id || '').toUpperCase() === String(sizeId || '').toUpperCase(); });
    return (opt && opt.color) || '';
  }
  window.getSizeColorFromProject = getSizeColorFromProject;

  function getPriorityLabelFromProject(value) {
    const opts = getCurrentProjectPriorityOptions();
    const opt = opts.find(function (o) { return Number(o.value) === Number(value); });
    return (opt && opt.label) || '';
  }
  window.getPriorityLabelFromProject = getPriorityLabelFromProject;

  function getSizeLabelFromProject(sizeId) {
    const opts = getCurrentProjectSizeOptions();
    const opt = opts.find(function (o) { return String(o.id || '').toUpperCase() === String(sizeId || '').toUpperCase(); });
    return (opt && opt.label) || '';
  }
  window.getSizeLabelFromProject = getSizeLabelFromProject;

  function getTimerDisplayState() {
    const nowMs = Date.now();
    const elapsedSinceSync = Math.max(0, nowMs - timerSnapshot.syncedAtMs);

    let projectMs = timerSnapshot.projectMs;
    let delayMs = timerSnapshot.delayMs;

    if (timerFrozen) {
      return {
        projectMs: projectMs,
        delayMs: delayMs,
        status: timerSnapshot.status,
        deadline: timerSnapshot.deadline,
      };
    }

    if (timerSnapshot.status === 'running') {
      projectMs += elapsedSinceSync;
    } else if (activeProjId) {
      delayMs += elapsedSinceSync;
    }

    return {
      projectMs: projectMs,
      delayMs: delayMs,
      status: timerSnapshot.status,
      deadline: timerSnapshot.deadline,
    };
  }

  function paintProjectTimerFromMs(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const totalDays = Math.floor(totalHours / 24);
    const weeks = Math.floor(totalDays / 7);
    const dayOfWeek = totalDays % 7;
    const hh = String(totalHours % 24).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');

    const weeksEl = document.getElementById('t-weeks');
    const daysEl = document.getElementById('t-days');
    const timeEl = document.getElementById('t-time');

    if (!weeksEl || !daysEl || !timeEl) {
      return;
    }

    weeksEl.textContent = String(weeks);
    daysEl.textContent = String(dayOfWeek);
    timeEl.textContent = hh + ':' + mm;

    const totalWeeks = Math.max(0, Number((getActiveProject() && getActiveProject().weeks) || 0));
    const ratio = totalWeeks > 0 ? weeks / totalWeeks : 0;
    weeksEl.className = 'tc-val' + (ratio > 0.85 ? ' danger' : ratio > 0.65 ? ' warn' : '');
  }

  function paintDelayTimerFromMs(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const totalMinutes = Math.floor(totalSeconds / 60);
    const totalHours = Math.floor(totalMinutes / 60);
    const totalDays = Math.floor(totalHours / 24);
    const weeks = Math.floor(totalDays / 7);
    const dayOfWeek = totalDays % 7;
    const hh = String(totalHours % 24).padStart(2, '0');
    const mm = String(totalMinutes % 60).padStart(2, '0');

    const weeksEl = document.getElementById('d-weeks');
    const daysEl = document.getElementById('d-days');
    const timeEl = document.getElementById('d-time');

    if (!weeksEl || !daysEl || !timeEl) {
      return;
    }

    weeksEl.textContent = String(weeks);
    daysEl.textContent = String(dayOfWeek);
    timeEl.textContent = hh + ':' + mm;
  }

  function applyTimerFromSnapshot() {
    const display = getTimerDisplayState();
    paintProjectTimerFromMs(display.projectMs);
    paintDelayTimerFromMs(display.delayMs);

    if (projectCompletedMode) {
      timerMode = 'completed';
    } else if (!activeProjId) {
      timerMode = 'stopped';
    } else {
      timerMode = display.status === 'running' ? 'project' : 'delay';
    }
    applyTimerUI();
  }

  function applyTimerSnapshotFromApi(timerData) {
    if (!timerData || typeof timerData !== 'object') {
      return false;
    }
    timerSnapshot = {
      projectMs: Number(timerData.project_time_ms || 0),
      delayMs: Number(timerData.client_delay_time_ms || 0),
      status: timerData.status || 'paused',
      syncedAtMs: Date.now(),
      deadline: timerData.deadline || null,
    };
    return true;
  }

  async function refreshTimerFromServer() {
    if (!activeProjId) {
      timerSnapshot = {
        projectMs: 0,
        delayMs: 0,
        status: 'paused',
        syncedAtMs: Date.now(),
        deadline: null,
      };
      applyTimerFromSnapshot();
      return;
    }

    const timerData = await apiFetch('/timer');
    applyTimerSnapshotFromApi(timerData);
    applyTimerFromSnapshot();
  }

  function applyBridgeTimerUI() {
    const button = document.getElementById('btn-timer');
    const delayChip = document.getElementById('delay-chip');
    if (!button) {
      return;
    }

    button.classList.remove('running');
    button.classList.remove('completed-mode');
    button.title = '';
    if (delayChip) {
      delayChip.classList.remove('hidden');
    }

    if (projectCompletedMode) {
      button.textContent = '◆ Завершён';
      button.classList.add('completed-mode');
      button.title = 'Все задачи выполнены. Нажмите, чтобы вернуться к проекту и продолжить время';
      return;
    }

    if (!activeProjId) {
      button.textContent = '▶ Старт';
      return;
    }

    if (timerSnapshot.status === 'running') {
      button.textContent = '⏸ Стоп';
      button.classList.add('running');
      return;
    }

    button.textContent = '▶ Старт';
  }

  var FIELD_COLOR_CONFIG = [
    { id: 'tm-f-col', getColor: 'getStatusColor' },
    { id: 'tm-f-stage', getColor: 'getStageColorFromProject' },
    { id: 'tm-f-agent', getColor: 'getAgentColor' },
    { id: 'tm-f-priority', getColor: 'getPriorityColor' },
    { id: 'tm-f-size', getColor: 'getSizeColor' },
    // поля формы создания задачи (ручной режим)
    { id: 'ntm-col', getColor: 'getStatusColor' },
    { id: 'ntm-stage', getColor: 'getStageColorFromProject' },
    { id: 'ntm-agent', getColor: 'getAgentColor' },
    { id: 'ntm-size', getColor: 'getSizeColor' },
    { id: 'ntm-priority', getColor: 'getPriorityColor' },
  ];

  function applySelectColor(selectEl, colorFn) {
    if (!selectEl || selectEl.tagName !== 'SELECT' || typeof colorFn !== 'function') return;
    function apply() {
      var value = selectEl.value;
      var color = colorFn(value) || '';
      selectEl.style.color = color;
      // если селект обёрнут в pk-dropdown, красим капсулу и опции
      var pkWrapper = selectEl.closest ? selectEl.closest('.pk-dropdown') : null;
      if (pkWrapper) {
        // текст выбранного значения
        var labelSpan = pkWrapper.querySelector('.pk-dropdown-label');
        if (labelSpan) {
          labelSpan.style.color = color;
        }
        // отдельные пункты меню — по их value
        var items = pkWrapper.querySelectorAll('.pk-dropdown-option');
        items.forEach(function (item) {
          var v = item.getAttribute('data-value') || item.textContent.trim();
          item.style.color = colorFn(v) || '';
        });
      }
      var opts = selectEl.options;
      for (var i = 0; i < opts.length; i++) {
        opts[i].style.color = colorFn(opts[i].value) || '';
      }
    }
    apply();
    if (!selectEl.hasAttribute('data-select-color-bound')) {
      selectEl.setAttribute('data-select-color-bound', '1');
      selectEl.addEventListener('change', apply);
    }
  }

  function applyFieldColors(container) {
    if (!container) {
      var meta = document.getElementById('tm-meta');
      var createWrap = document.getElementById('nt-manual-wrap');
      if (meta) applyFieldColors(meta);
      if (createWrap) applyFieldColors(createWrap);
      return;
    }
    FIELD_COLOR_CONFIG.forEach(function (config) {
      var el = container.querySelector ? container.querySelector('#' + config.id) : document.getElementById(config.id);
      if (!el) return;
      var getColorFn = typeof window[config.getColor] === 'function' ? window[config.getColor] : function () { return '#6B7280'; };
      if (el.tagName === 'SELECT') {
        applySelectColor(el, getColorFn);
      }
    });
  }

  function ensureBridgeStyles() {
    if (document.getElementById('bridge-style-overrides')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'bridge-style-overrides';
    style.textContent = ''
      + '.btn-timer.completed-mode{'
      + 'background:rgba(167,139,250,.16);'
      + 'border-color:rgba(167,139,250,.48);'
      + 'color:#a78bfa;'
      + '}'
      + '.btn-timer.completed-mode:hover{'
      + 'background:rgba(167,139,250,.28);'
      + 'border-color:#a78bfa;'
      + 'box-shadow:0 5px 18px rgba(167,139,250,.35);'
      + '}'
      + '.bridge-confirm-card{'
      + 'width:420px;max-width:92vw;background:var(--mbg);border:1px solid var(--bd2);'
      + 'border-radius:16px;box-shadow:var(--sh-lg);padding:20px;'
      + '}'
      + '.bridge-confirm-title{font-family:Syne,sans-serif;font-size:17px;font-weight:700;color:var(--tx);}'
      + '.bridge-confirm-sub{font-size:12px;color:var(--tx2);margin-top:8px;line-height:1.5;}'
      + '.bridge-confirm-row{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;}'
      + '.bridge-confirm-btn{height:38px;padding:0 18px;border-radius:9px;cursor:pointer;font-family:Syne,sans-serif;font-weight:700;font-size:12px;border:1.5px solid transparent;}'
      + '.bridge-confirm-btn.no{background:var(--sf2);color:var(--tx2);border-color:var(--bd2);}'
      + '.bridge-confirm-btn.yes{background:rgba(74,222,128,.15);color:var(--green);border-color:rgba(74,222,128,.45);}'
      + '.bridge-confirm-btn.danger{background:rgba(248,113,113,.12);color:var(--red);border-color:rgba(248,113,113,.45);}'
      + '.bridge-confirm-btn.danger:disabled{opacity:.45;cursor:not-allowed;}'
      + '.bridge-delete-input{height:40px;width:100%;padding:0 12px;background:var(--sf2);border:1px solid var(--bd2);border-radius:10px;'
      + 'color:var(--tx);font-family:DM Mono,monospace;font-size:12px;outline:none;margin-top:10px;}'
      + '.bridge-delete-input:focus{border-color:var(--gold);}'
      + '.bridge-delete-hint{font-size:11px;color:var(--tx3);margin-top:10px;line-height:1.5;}'
      + '.bridge-delete-name{font-family:Syne,sans-serif;color:var(--gold);font-size:13px;font-weight:700;}'
      + '#task-ov .tm-close.tm-delete{'
      + 'color:var(--red);border-color:rgba(248,113,113,.35);background:rgba(248,113,113,.08);'
      + '}'
      + '#task-ov .tm-close.tm-delete:hover{'
      + 'color:#fff;border-color:rgba(248,113,113,.6);background:rgba(248,113,113,.2);'
      + '}'
      + '.msg-actions{margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;}'
      + '.msg-action-btn{'
      + 'height:32px;padding:0 14px;border-radius:8px;font-family:Syne,sans-serif;font-size:12px;font-weight:700;'
      + 'cursor:pointer;transition:all .15s;border:1px solid;'
      + '}'
      + '.msg-action-btn.apply{'
      + 'background:rgba(74,222,128,.15);color:var(--green);border-color:rgba(74,222,128,.45);'
      + '}'
      + '.msg-action-btn.apply:hover:not(:disabled){'
      + 'background:rgba(74,222,128,.28);border-color:var(--green);'
      + '}'
      + '.msg-action-btn.reject{'
      + 'background:var(--sf2);color:var(--tx2);border-color:var(--bd2);'
      + '}'
      + '.msg-action-btn.reject:hover:not(:disabled){border-color:var(--bd3);color:var(--tx);}'
      + '.msg-action-btn:disabled{opacity:.6;cursor:not-allowed;}'
      + '.msg-actions.applied{opacity:.5;pointer-events:none;}'
      + '.bridge-col-sort{display:flex;align-items:center;margin-left:auto;margin-right:8px;}'
      + '.bridge-col-sort select{min-width:200px;text-align:left;vertical-align:middle;}'
      + '.nt-mode-switch{display:flex;align-items:stretch;margin-left:auto;margin-right:8px;background:var(--sf2);border:1px solid var(--bd2);border-radius:10px;overflow:hidden;}'
      + '.nt-mode-btn{height:34px;padding:0 16px;border:none;background:transparent;color:var(--tx3);font-family:Syne,sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;}'
      + '.nt-mode-btn:hover{color:var(--tx2);}'
      + '.nt-mode-btn.active{background:var(--gold);color:#000;}'
      + '.nt-manual-wrap{display:none;padding:16px 20px;overflow:auto;flex:1;min-height:260px;overflow-x:visible;overflow-y:auto;}'
      + '.nt-manual-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}'
      + '.nt-manual-field{display:flex;flex-direction:column;gap:6px;background:var(--sf);border:1px solid var(--bd);border-radius:10px;padding:10px 12px;}'
      + '.nt-manual-field.full,.nt-manual-field.mc-full{grid-column:1/-1;}'
      + '.nt-manual-label{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;font-family:DM Mono,monospace;}'
      + '.nt-manual-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid var(--bd);}'
      + '.ps-stage-add-btn{'
      + 'height:34px;align-self:flex-start;padding:0 14px;border-radius:9px;'
      + 'background:rgba(74,222,128,.15);border:1.5px solid rgba(74,222,128,.45);'
      + 'color:var(--green);font-family:Syne,sans-serif;font-size:12px;font-weight:700;'
      + 'cursor:pointer;transition:all .2s;'
      + '}'
      + '.ps-stage-add-btn:hover{'
      + 'background:rgba(74,222,128,.28);border-color:var(--green);'
      + 'transform:translateY(-1px);box-shadow:0 4px 14px rgba(74,222,128,.25);'
      + '}'
      + '.ps-stage-remove{'
      + 'width:40px;height:40px;padding:0;border-radius:10px;'
      + 'display:flex;align-items:center;justify-content:center;'
      + 'background:rgba(248,113,113,.12);border:1.5px solid rgba(248,113,113,.4);'
      + 'color:var(--red);cursor:pointer;transition:all .2s;'
      + '}'
      + '.ps-stage-remove:hover{'
      + 'background:rgba(248,113,113,.24);border-color:var(--red);'
      + 'transform:translateY(-1px);box-shadow:0 4px 14px rgba(248,113,113,.24);'
      + '}'
      + '.ps-stage-remove svg{'
      + 'fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;'
      + '}'
      + '.profile-overlay{justify-content:flex-end;align-items:stretch;padding:0;z-index:700;}'
      + '.profile-drawer{'
      + 'width:min(1344px,96vw);height:100%;background:var(--mbg);border-left:1px solid var(--bd2);'
      + 'box-shadow:var(--sh-lg);display:flex;flex-direction:column;transform:translateX(24px);'
      + 'transition:transform .22s ease;'
      + '}'
      + '.profile-overlay.open .profile-drawer{transform:translateX(0);}'
      + '.overlay.open:not(.profile-overlay){z-index:800;}'
      + '.profile-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--bd);}'
      + '.profile-title{font-family:Syne,sans-serif;font-size:20px;font-weight:700;color:var(--tx);}'
      + '.profile-sub{font-size:11px;color:var(--tx3);margin-top:4px;font-family:DM Mono,monospace;}'
      + '.profile-layout{display:grid;grid-template-columns:260px 1fr;min-height:0;flex:1;overflow:hidden;}'
      + '.profile-nav{padding:14px;border-right:1px solid var(--bd);display:flex;flex-direction:column;gap:8px;overflow:auto;}'
      + '.profile-nav-item{height:42px;padding:0 12px;border-radius:10px;background:var(--sf);border:1px solid var(--bd2);'
      + 'color:var(--tx2);text-align:left;cursor:pointer;font-family:Syne,sans-serif;font-size:12px;font-weight:700;transition:all .18s;}'
      + '.profile-nav-item:hover{background:var(--sf2);border-color:var(--bd3);color:var(--tx);}'
      + '.profile-nav-item.active{background:var(--gold-dim);border-color:rgba(240,165,0,.45);color:var(--gold);}'
      + '.profile-content-wrap{display:flex;flex-direction:column;min-height:0;flex:1;overflow:hidden;}'
      + '.profile-sub-nav{display:flex;flex-wrap:wrap;gap:8px;padding:12px 18px;border-bottom:1px solid var(--bd);background:var(--sf);}'
      + '.profile-sub-nav-btn{height:36px;padding:0 14px;border-radius:9px;background:var(--sf2);border:1px solid var(--bd2);'
      + 'color:var(--tx2);font-family:Syne,sans-serif;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;}'
      + '.profile-sub-nav-btn:hover{background:var(--mbg);border-color:var(--bd3);color:var(--tx);}'
      + '.profile-sub-nav-btn.active{background:var(--gold-dim);border-color:rgba(240,165,0,.45);color:var(--gold);}'
      + '.profile-content{padding:18px;overflow:auto;flex:1;}'
      + '.profile-pane{display:flex;flex-direction:column;gap:12px;}'
      + '.profile-stub .profile-stub-card{padding:20px;background:var(--sf);border:1px dashed var(--bd2);border-radius:12px;margin-top:8px;position:relative;}'
      + '.profile-stub-badge{display:inline-block;padding:4px 10px;border-radius:999px;background:var(--gold-dim);color:var(--gold);'
      + 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;}'
      + '.profile-stub-text{font-size:12px;color:var(--tx2);line-height:1.6;margin:0 0 12px 0;}'
      + '.profile-stub-list{font-size:12px;color:var(--tx2);line-height:1.8;margin:0;padding-left:20px;}'
      + '.profile-stub-list li{margin-bottom:4px;}'
      + '.profile-pane-title{font-family:Syne,sans-serif;font-size:18px;font-weight:700;color:var(--tx);}'
      + '.profile-pane-sub{font-size:12px;color:var(--tx2);line-height:1.5;}'
      + '.profile-llm-help{padding:14px;background:var(--sf);border:1px solid var(--bd2);border-radius:12px;margin-bottom:8px;}'
      + '.profile-llm-help-title{font-size:11px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;}'
      + '.profile-llm-help-list,.profile-llm-help-p{font-size:12px;color:var(--tx2);line-height:1.55;margin:0 0 12px 0;}'
      + '.profile-llm-help-list{padding-left:18px;}'
      + '.profile-llm-help-list li{margin-bottom:6px;}'
      + '.profile-llm-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}'
      + '.profile-llm-card{padding:14px;background:var(--sf);border:1px solid var(--bd2);border-radius:12px;display:flex;flex-direction:column;gap:10px;}'
      + '.profile-llm-keys-card{padding:14px;background:var(--sf);border:1px solid var(--bd2);border-radius:12px;margin-bottom:12px;}'
      + '.profile-llm-keys-card[data-has-key="1"]{background:rgba(74,222,128,.06);border-color:rgba(74,222,128,.3);box-shadow:0 0 0 1px rgba(74,222,128,.08);}'
      + '[data-theme="light"] .profile-llm-keys-card[data-has-key="1"]{background:rgba(34,197,94,.08);border-color:rgba(34,197,94,.25);}'
      + '.profile-llm-keys-card-title{font-family:Syne,sans-serif;font-size:14px;font-weight:700;color:var(--tx);margin-bottom:10px;}'
      + '.profile-btn-capsule{padding:8px 20px;border-radius:999px;font-size:12px;font-weight:600;font-family:Syne,sans-serif;cursor:pointer;border:1px solid;transition:all .15s;}'
      + '.profile-llm-keys-save.profile-btn-capsule{background:rgba(74,222,128,.15);border-color:rgba(74,222,128,.45);color:var(--green);}'
      + '.profile-llm-keys-save.profile-btn-capsule:hover{background:rgba(74,222,128,.28);border-color:var(--green);}'
      + '.profile-btn-danger.profile-btn-capsule,.profile-llm-keys-delete.profile-btn-capsule{background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.45);color:var(--red);}'
      + '.profile-btn-danger.profile-btn-capsule:hover,.profile-llm-keys-delete.profile-btn-capsule:hover{background:rgba(248,113,113,.25);border-color:var(--red);}'
      + '.profile-llm-card-title{font-family:Syne,sans-serif;font-size:14px;font-weight:700;color:var(--tx);}'
      + '.profile-llm-card-desc{font-size:11px;color:var(--tx3);line-height:1.45;}'
      + '.profile-llm-card-select-wrap{display:flex;flex-direction:column;gap:6px;}'
      + '.profile-llm-card-label{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:0.5px;}'
      + '.profile-llm-tabs{display:flex;gap:6px;margin-bottom:14px;}'
      + '.profile-llm-tab{padding:10px 18px;border-radius:10px;background:var(--sf);border:1px solid var(--bd2);color:var(--tx2);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;}'
      + '.profile-llm-tab:hover{background:var(--sf2);color:var(--tx);border-color:var(--bd3);}'
      + '.profile-llm-tab.active{background:var(--gold-dim);border-color:rgba(240,165,0,.45);color:var(--gold);}'
      + '.profile-llm-ownkey-form{padding:14px;background:var(--sf);border:1px solid var(--bd2);border-radius:12px;}'
      + '.profile-llm-form-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;}'
      + '.profile-llm-form-lbl{font-size:11px;color:var(--tx3);min-width:80px;}'
      + '.profile-llm-verify-status{font-size:12px;margin-bottom:10px;}'
      + '.profile-llm-verify-status.ok{color:var(--green);}'
      + '.profile-llm-verify-status.error{color:var(--red);}'
      + '.profile-llm-keys-status-fixed{min-height:24px;margin-top:8px;font-size:12px;line-height:1.4;color:inherit;}'
      + '.profile-llm-keys-status-fixed.ok{color:var(--green);}'
      + '.profile-llm-keys-status-fixed.error{color:var(--red);}'
      + '.profile-llm-main-wrap{display:flex;flex-direction:column;gap:16px;}'
      + '.profile-llm-main-wrap.profile-llm-main-dimmed .profile-llm-main{opacity:0.55;pointer-events:none;}'
      + '.profile-llm-main{padding:16px;background:var(--sf);border:1px solid var(--bd2);border-radius:12px;transition:opacity .2s;}'
      + '.profile-llm-main.profile-llm-locked{opacity:0.5;pointer-events:none;position:relative;}'
      + '.profile-llm-main.profile-llm-locked::before{content:\'\';position:absolute;inset:0;background:rgba(0,0,0,.25);border-radius:12px;pointer-events:none;}'
      + '.profile-llm-main.profile-llm-locked select,.profile-llm-main.profile-llm-locked input,.profile-llm-main.profile-llm-locked button{opacity:.85;}'
      + '.profile-llm-extra{margin-top:8px;}'
      + '.profile-llm-extra-toggle{padding:10px 14px;border-radius:10px;background:var(--sf2);border:1px solid var(--bd2);color:var(--tx2);font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;}'
      + '.profile-llm-extra-toggle:hover{background:var(--sf);color:var(--tx);border-color:var(--bd3);}'
      + '.profile-llm-extra-body{padding-top:14px;padding-left:4px;}'
      + '.profile-llm-card-cb{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--tx2);cursor:pointer;}'
      + '.profile-llm-card-cb input{flex-shrink:0;}'
      + '.profile-llm-card-override-inner{}'
      + '.profile-llm-usage-warn{padding:12px 14px;background:rgba(240,165,0,.12);border:1px solid rgba(240,165,0,.35);border-radius:10px;font-size:12px;color:var(--tx2);line-height:1.5;margin-bottom:16px;}'
      + '.profile-llm-usage-actions{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;}'
      + '.profile-llm-usage-actions .profile-btn{margin:0;}'
      + '.profile-llm-usage-summary{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px;margin-bottom:8px;}'
      + '.profile-llm-usage-card{padding:14px;background:var(--sf);border:1px solid var(--bd2);border-radius:12px;}'
      + '.profile-llm-usage-card-value{font-family:Syne,sans-serif;font-size:18px;font-weight:700;color:var(--tx);}'
      + '.profile-llm-usage-card-label{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;}'
      + '.profile-llm-usage-detail-wrap{overflow-x:auto;}'
      + '.profile-llm-usage-table{font-size:11px;}'
      + '.profile-empty{padding:14px;border:1px dashed var(--bd2);border-radius:10px;color:var(--tx3);font-size:12px;}'
      + '.profile-cards{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:10px;}'
      + '.profile-card{padding:12px;border-radius:12px;background:var(--sf);border:1px solid var(--bd2);}'
      + '.profile-card-label{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;}'
      + '.profile-card-value{margin-top:8px;font-size:13px;color:var(--tx);font-family:Syne,sans-serif;font-weight:700;}'
      + '.profile-card-sub{margin-top:4px;font-size:11px;color:var(--tx3);}'
      + '.profile-table{border-collapse:collapse;width:100%;}'
      + '.profile-table th,.profile-table td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--bd);}'
      + '.profile-table th{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;}'
      + '.profile-table td{font-size:12px;color:var(--tx2);}'
      + '.profile-role-list{display:flex;flex-direction:column;gap:8px;}'
      + '.profile-role-row{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--sf);border:1px solid var(--bd2);border-radius:10px;}'
      + '.profile-role-name{font-size:13px;color:var(--tx);font-family:Syne,sans-serif;}'
      + '.profile-role-meta{font-size:11px;color:var(--tx2);}'
      + '.profile-proj-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;}'
      + '.profile-proj-card{position:relative;padding:18px;background:var(--sf);border:1px solid var(--bd2);border-radius:12px;display:flex;flex-direction:column;gap:12px;}'
      + '.profile-proj-card[data-active="1"]{border-color:rgba(240,165,0,.4);background:var(--gold-dim);}'
      + '.profile-proj-head{display:flex;flex-direction:column;gap:4px;}'
      + '.profile-proj-name{font-family:Syne,sans-serif;font-size:18px;font-weight:700;color:var(--tx);}'
      + '.profile-proj-status{font-size:11px;color:var(--tx3);text-transform:uppercase;letter-spacing:0.5px;}'
      + '.profile-proj-card[data-active="1"] .profile-proj-status{color:var(--gold);}'
      + '.profile-proj-body{display:flex;flex-direction:column;gap:10px;}'
      + '.profile-proj-field{display:flex;flex-direction:column;gap:4px;}'
      + '.profile-proj-lbl{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:0.5px;}'
      + '.profile-proj-val{font-size:12px;color:var(--tx2);}'
      + '.profile-proj-sel{min-width:140px;max-width:220px;height:29px;padding:0 10px;border-radius:999px;background:var(--sf2);border:1px solid var(--bd2);color:var(--tx);font-size:12px;}'
      + '[data-theme="dark"] .profile-proj-sel{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14);}'
      + '[data-theme="light"] .profile-proj-sel{background:rgba(255,255,255,.96);border-color:rgba(0,0,0,.12);}'
      + '.profile-proj-meta{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:11px;color:var(--tx3);}'
      + '.profile-proj-settings-btn{position:absolute;top:14px;right:14px;width:32px;height:32px;border-radius:8px;background:var(--sf2);border:1px solid var(--bd2);color:var(--tx2);font-size:14px;cursor:pointer;transition:all .15s;display:flex;align-items:center;justify-content:center;}'
      + '.profile-proj-settings-btn:hover{background:var(--sf3);border-color:var(--bd3);color:var(--gold);}'
      + '.profile-proj-card .pk-dropdown,.profile-proj-card .pk-dropdown-trigger{min-height:29px;height:29px;border-radius:999px;}'
      + '#ps-ov .pk-dropdown,#ps-ov .pk-dropdown-trigger{min-height:32px;height:32px;border-radius:999px;}'
      + '.profile-inline-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}'
      + '.profile-radio-label{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;color:var(--tx);}'
      + '.profile-radio-label input{flex-shrink:0;}'
      + '.profile-inline-hint{font-size:11px;color:var(--tx3);line-height:1.5;}'
      + '.profile-btn{height:36px;padding:0 14px;border-radius:9px;background:rgba(74,222,128,.15);border:1.5px solid rgba(74,222,128,.45);'
      + 'color:var(--green);font-family:Syne,sans-serif;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s;}'
      + '.profile-btn:hover{background:rgba(74,222,128,.28);border-color:var(--green);}'
      + '.profile-btn.small{height:32px;padding:0 10px;font-size:11px;}'
      + '.profile-btn.ghost{background:var(--sf2);border-color:var(--bd2);color:var(--tx2);}'
      + '.profile-btn.ghost:hover{color:var(--tx);border-color:var(--bd3);}'
      + '.profile-btn.danger{background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.45);color:var(--red);}'
      + '.profile-btn.danger:hover{background:rgba(248,113,113,.24);border-color:var(--red);}'
      + '.profile-btn:disabled{opacity:.5;cursor:not-allowed;}'
      + '.profile-input{height:38px;width:100%;padding:0 12px;background:var(--sf2);border:1px solid var(--bd2);border-radius:10px;'
      + 'color:var(--tx);font-family:DM Mono,monospace;font-size:12px;outline:none;}'
      + '.profile-input:focus{border-color:var(--gold);}'
      + '.profile-history-settings-row{display:flex;align-items:center;gap:16px;margin-bottom:12px;flex-wrap:wrap;}'
      + '.profile-history-settings-row .profile-field-label{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;}'
      + '.profile-history-settings-row select{min-width:160px;}'
      + '.profile-history-settings-row .pk-dropdown{min-width:160px;}'
      + '.profile-history-settings-row .pk-dropdown-trigger{min-height:38px;height:38px;border-radius:10px;background:var(--sf2);border:1px solid var(--bd2);color:var(--tx);}'
      + '.profile-history-settings-row .pk-dropdown-trigger:hover{background:var(--sf3);border-color:var(--bd3);}'
      + '.profile-history-settings-row .pk-dropdown.open .pk-dropdown-trigger{border-color:var(--gold);}'
      + '.profile-history-settings-row .pk-dropdown-menu{background:var(--mbg);border:1px solid var(--bd2);min-width:max(100%,160px);}'
      + '.profile-history-settings-row .pk-dropdown-option:hover{background:var(--sf2);}'
      + '.profile-history-settings-row .pk-dropdown-option.is-selected{background:var(--gold-dim);color:var(--gold);}'
      + '.hist-period-field{display:flex;flex-direction:column;gap:4px;}'
      + '.hist-retention-warn{font-size:11px;color:var(--tx3);line-height:1.5;flex:1;min-width:200px;margin-top:25px;}'
      + '.hist-retention-warn strong{color:var(--red);}'
      + '.hist-type-dropdown-wrap{position:relative;}'
      + '.hist-type-toggle{min-width:140px;text-align:left;cursor:pointer;background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:0 10px;height:28px;font-size:11px;}'
      + '.hist-type-dropdown{display:none;position:absolute;top:100%;left:0;margin-top:4px;background:var(--mbg);border:1px solid var(--bd2);border-radius:10px;box-shadow:var(--sh-lg);padding:8px;min-width:160px;z-index:100;}'
      + '.hist-type-dropdown.open{display:block;}'
      + '.hist-type-cb{display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:11px;color:var(--tx2);cursor:pointer;border-radius:6px;}'
      + '.hist-type-cb:hover{background:var(--sf2);}'
      + '.hist-type-cb input{flex-shrink:0;}'
      + '.pf-search-row{position:relative;margin-bottom:8px;}'
      + '.pf-search-row input{width:100%;height:38px;padding:0 36px 0 12px;box-sizing:border-box;}'
      + '.pf-search-clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--tx3);font-size:16px;cursor:pointer;padding:2px 4px;line-height:1;}'
      + '.pf-search-clear:hover{color:var(--tx);}'
      + '.pf-filter-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;width:100%;box-sizing:border-box;}'
      + '.pf-filter-row .profile-input{height:28px;font-size:11px;padding:0 8px;flex:1;min-width:100px;}'
      + '.pf-filter-row select.profile-input{min-width:120px;}'
      + '.pf-filter-btn{height:28px;padding:0 14px;border-radius:7px;font-family:Syne,sans-serif;font-size:11px;font-weight:700;cursor:pointer;border:1.5px solid;transition:all .15s;flex-shrink:0;}'
      + '.pf-filter-btn.apply{background:rgba(74,222,128,.18);border-color:rgba(74,222,128,.5);color:#4ade80;}'
      + '.pf-filter-btn.apply:hover{background:rgba(74,222,128,.32);border-color:#4ade80;}'
      + '.pf-filter-btn.reset{background:rgba(248,113,113,.12);border-color:rgba(248,113,113,.45);color:#f87171;margin-left:4px;}'
      + '.pf-filter-btn.reset:hover{background:rgba(248,113,113,.24);border-color:#f87171;}'
      + '.trash-filters{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:8px;align-items:center;}'
      + '.trash-filter-actions{display:flex;gap:6px;justify-content:flex-end;}'
      + '.profile-trash-table-wrap{width:100%;overflow-x:auto;margin-top:4px;min-width:0;}'
      + '.trash-head{display:grid;grid-template-columns:95px minmax(140px,1.5fr) 130px 130px 120px 85px 85px minmax(100px,1fr);'
      + 'padding:0 10px;font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;width:100%;box-sizing:border-box;}'
      + '.trash-list{display:flex;flex-direction:column;gap:8px;width:100%;box-sizing:border-box;}'
      + '.trash-row{display:grid;grid-template-columns:95px minmax(140px,1.5fr) 130px 130px 120px 85px 85px minmax(100px,1fr);'
      + 'gap:0;padding:8px 10px;background:var(--sf);border:1px solid var(--bd2);border-radius:11px;align-items:center;}'
      + '.trash-cell{font-size:11px;color:var(--tx2);padding-right:8px;line-height:1.4;min-width:0;}'
      + '.trash-cell.id{font-family:Syne,sans-serif;color:var(--tx);font-weight:700;}'
      + '.trash-cell.title{display:flex;flex-direction:column;gap:2px;}'
      + '.trash-title-main{font-size:12px;color:var(--tx);font-family:Syne,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '.trash-title-sub{font-size:10px;color:var(--tx3);}'
      + '.trash-cell.actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;}'
      + '.trash-action-btn{width:32px;height:32px;padding:0;border:none;border-radius:8px;background:var(--sf2);color:var(--tx3);cursor:pointer;'
      + 'display:flex;align-items:center;justify-content:center;transition:color .15s,background .15s,transform .1s;}'
      + '.trash-action-btn:hover{transform:translateY(-1px);}'
      + '.trash-action-btn svg{flex-shrink:0;}'
      + '.trash-action-restore:hover{background:rgba(74,222,128,.2);color:#4ade80;}'
      + '.trash-action-purge:hover{background:rgba(248,113,113,.2);color:#f87171;}'
      + '.trash-stage{display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;border:1px solid var(--bd2);'
      + 'color:var(--stage-color);font-size:10px;font-weight:700;}'
      + '[data-design=\"v2\"] .profile-cards{gap:12px;}'
      + '[data-design=\"v2\"] .profile-card{background:var(--bg-card);border:1px solid var(--bd);border-radius:16px;}'
      + '[data-design=\"v2\"] .profile-empty{border-radius:16px;background:var(--bg-card);border-color:var(--bd);color:var(--tx-muted);}'
      + '[data-design=\"v2\"] .profile-btn{border-radius:999px;}'
      + '[data-design=\"v2\"] .profile-btn.ghost{background:var(--bg-card);border-color:var(--bd);color:var(--tx2);}'
      + '[data-design=\"v2\"] .profile-btn.danger{background:var(--red-soft);border-color:rgba(220,38,38,.5);color:var(--red);}'
      + '[data-design=\"v2\"] .profile-input{background:var(--bg-card);border-radius:12px;border:1px solid var(--bd);}'
      + '[data-design=\"v2\"] .profile-input:focus{border-color:var(--bd-focus);box-shadow:0 0 0 3px var(--accent-soft);}'
      + '[data-design=\"v2\"] .profile-role-row{background:var(--bg-card);border-radius:14px;border:1px solid var(--bd);}'
      + '[data-design=\"v2\"] .profile-llm-usage-card{background:var(--bg-card);border:1px solid var(--bd);border-radius:16px;}'
      + '.profile-modal-wide{width:760px;max-width:94vw;}'
      + '.profile-restore-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-top:10px;}'
      + '.profile-field{display:flex;flex-direction:column;gap:6px;}'
      + '.profile-field-label{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;font-family:DM Mono,monospace;}'
      + '.trash-preview{margin-top:10px;padding:10px;border:1px solid var(--bd2);border-radius:10px;background:var(--sf2);display:flex;flex-direction:column;gap:6px;}'
      + '.trash-preview-id{font-size:10px;color:var(--tx3);}'
      + '.trash-preview-title{font-size:14px;color:var(--tx);font-family:Syne,sans-serif;font-weight:700;}'
      + '.trash-preview-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--tx2);}'
      + '.trash-preview-desc{font-size:11px;color:var(--tx3);max-height:80px;overflow:auto;}'
      + '@media (max-width: 1100px){'
      + '.profile-layout{grid-template-columns:220px 1fr;}'
      + '.profile-cards{grid-template-columns:1fr;}'
      + '.profile-llm-cards{grid-template-columns:1fr;}'
      + '.trash-filters{grid-template-columns:1fr 1fr;}'
      + '.trash-filter-actions{grid-column:1/-1;justify-content:flex-start;}'
      + '.profile-restore-grid{grid-template-columns:1fr 1fr;}'
      + '.pf-filter-row{flex-wrap:wrap;}'
      + '}'
      + '@media (max-width: 760px){'
      + '.profile-drawer{width:100vw;}'
      + '.profile-layout{grid-template-columns:1fr;}'
      + '.profile-nav{border-right:none;border-bottom:1px solid var(--bd);}'
      + '.profile-nav-item{height:36px;}'
      + '.profile-sub-nav{padding:10px 14px;}'
      + '.profile-sub-nav-btn{height:32px;padding:0 10px;font-size:11px;}'
      + '.trash-filters{grid-template-columns:1fr;}'
      + '.profile-restore-grid{grid-template-columns:1fr;}'
      + '.pf-filter-row .profile-input{min-width:unset;}'
      + '}'
      + '.tm-title-edit{'
      + 'font-family:Syne,sans-serif;font-size:18px;font-weight:700;line-height:1.4;'
      + 'color:var(--tx);background:transparent;border:none !important;outline:none;width:100%;'
      + 'transition:border-color .15s;box-sizing:border-box;padding:0;'
      + '}'
      + '.tm-title-edit:focus{outline:none;}'
      + '.tm-desc-edit{'
      + 'width:100%;min-height:68px;background:var(--sf2);border:1px solid var(--bd);'
      + 'border-radius:10px;color:var(--tx2);font-family:DM Mono,monospace;font-size:13px;'
      + 'line-height:1.8;padding:10px 12px;outline:none;resize:vertical;'
      + 'transition:border-color .15s;box-sizing:border-box;'
      + '}'
      + '.tm-desc-edit:focus{border-color:var(--gold);}'
      + '#task-create-ov #ntm-desc{min-height:154px;}'
      + '.tm-desc-edit-single{'
      + 'width:100%;height:40px;min-height:0;background:var(--sf2);border:1px solid var(--bd);'
      + 'border-radius:10px;color:var(--tx2);font-family:DM Mono,monospace;font-size:13px;'
      + 'padding:0 12px;outline:none;transition:border-color .15s;box-sizing:border-box;'
      + '}'
      + '.tm-desc-edit-single:focus{border-color:var(--gold);}'
      + '.tm-desc-edit-single::placeholder{color:var(--tx3);}'
      + '#task-ov #tm-save-btn{background:rgba(74,222,128,.2);border:1px solid rgba(74,222,128,.5);color:var(--green);}'
      + '#task-ov #tm-save-btn:hover{background:rgba(74,222,128,.35);border-color:var(--green);}'
      + '#task-ov #tm-save-btn:disabled{opacity:.4;cursor:not-allowed;}'
      + '.tm-field-input{'
      + 'width:100%;background:transparent;border:none;'
      + 'border-bottom:1px solid var(--bd2);'
      + 'color:var(--tx);font-family:DM Mono,monospace;font-size:13px;font-weight:500;'
      + 'outline:none;padding:2px 0;transition:border-color .15s;box-sizing:border-box;'
      + '}'
      + '.tm-field-input:focus{border-bottom-color:var(--gold);}'
      + '.tm-field-input[type=number]{-moz-appearance:textfield;}'
      + '.tm-field-input[type=number]::-webkit-outer-spin-button,'
      + '.tm-field-input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}';
    document.head.appendChild(style);
  }

  function openResumeConfirmModal() {
    let overlay = document.getElementById('resume-project-ov');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'resume-project-ov';
      overlay.className = 'overlay open';
      overlay.innerHTML = ''
        + '<div class="bridge-confirm-card">'
        + '<div class="bridge-confirm-title">Вернуться к проекту и продолжить время?</div>'
        + '<div class="bridge-confirm-sub">Таймер разработки снова запустится. Проект выйдет из режима завершения.</div>'
        + '<div class="bridge-confirm-row">'
        + '<button class="bridge-confirm-btn no" id="resume-project-no">Отмена</button>'
        + '<button class="bridge-confirm-btn yes" id="resume-project-yes">Продолжить время</button>'
        + '</div>'
        + '</div>';
      document.body.appendChild(overlay);
      const noBtn = document.getElementById('resume-project-no');
      const yesBtn = document.getElementById('resume-project-yes');
      if (noBtn) {
        noBtn.onclick = function () {
          overlay.classList.remove('open');
        };
      }
      if (yesBtn) {
        yesBtn.onclick = async function () {
          yesBtn.disabled = true;
          const projectId = activeProjId;
          try {
            completionOverrideByProject[projectId] = true;
            saveCompletionOverrides();
            projectCompletedMode = false;
            timerFrozen = false;
            applyTimerFromSnapshot();

            const started = await apiFetch('/timer/start', { method: 'POST', body: {} });
            applyTimerSnapshotFromApi(started);
            if (timerSnapshot.status !== 'running') {
              const secondAttempt = await apiFetch('/timer/start', { method: 'POST', body: {} });
              applyTimerSnapshotFromApi(secondAttempt);
            }
            applyTimerFromSnapshot();
            scheduleHeaderRefresh();
          } catch (error) {
            delete completionOverrideByProject[projectId];
            saveCompletionOverrides();
            projectCompletedMode = isProjectCompleted();
            timerFrozen = projectCompletedMode;
            applyTimerFromSnapshot();
            showError('Не удалось возобновить проект: ' + error.message);
          } finally {
            yesBtn.disabled = false;
            overlay.classList.remove('open');
          }
        };
      }
    }

    overlay.classList.add('open');
  }

  function openDeleteProjectConfirmModal(project) {
    let overlay = document.getElementById('delete-project-ov');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'delete-project-ov';
      overlay.className = 'overlay open';
      overlay.innerHTML = ''
        + '<div class="bridge-confirm-card">'
        + '<div class="bridge-confirm-title">Удалить проект?</div>'
        + '<div class="bridge-confirm-sub">Проект, все его задачи и вся история действий (аудит) будут удалены безвозвратно.</div>'
        + '<div class="bridge-delete-hint">Для подтверждения введите точное название проекта:</div>'
        + '<div class="bridge-delete-name" id="delete-project-name-ref"></div>'
        + '<input id="delete-project-name-input" class="bridge-delete-input" placeholder="Введите название проекта">'
        + '<div class="bridge-confirm-row">'
        + '<button class="bridge-confirm-btn no" id="delete-project-no">Отмена</button>'
        + '<button class="bridge-confirm-btn danger" id="delete-project-yes" disabled>Удалить</button>'
        + '</div>'
        + '</div>';
      document.body.appendChild(overlay);
    }

    overlay.classList.add('open');
    const nameRef = document.getElementById('delete-project-name-ref');
    const nameInput = document.getElementById('delete-project-name-input');
    const noButton = document.getElementById('delete-project-no');
    const yesButton = document.getElementById('delete-project-yes');

    if (!nameRef || !nameInput || !noButton || !yesButton) {
      return;
    }

    nameRef.textContent = project.name;
    nameInput.value = '';
    yesButton.disabled = true;

    const updateDeleteState = function () {
      yesButton.disabled = nameInput.value !== project.name;
    };
    nameInput.oninput = updateDeleteState;
    updateDeleteState();

    noButton.onclick = function () {
      overlay.remove();
    };

    yesButton.onclick = async function () {
      if (nameInput.value !== project.name) {
        return;
      }
      yesButton.disabled = true;
      try {
        const response = await apiFetch('/projects/' + project.id, {
          method: 'DELETE',
          body: {
            confirm_name: nameInput.value,
          },
        });

        overlay.remove();
        closeProjSettings();
        await loadProjectsAndActive();
        await loadTasksForActiveProject();
        applyProjectSettings();
        renderProjList();
        render();
        syncColumnEmptyStates();
        updateStageTabs();
        scheduleHeaderRefresh();
        await refreshTimerFromServer();
        await syncCompletionMode();
        applyTimerFromSnapshot();
        showInfo(
          'Проект удален. Задач удалено: ' +
          Number((response && response.deleted_tasks) || 0)
        );
      } catch (error) {
        yesButton.disabled = false;
        if (error.message === 'project_name_mismatch') {
          showError('Название проекта введено неверно');
          return;
        }
        if (error.message === 'project_not_found') {
          showError('Проект уже удален');
          overlay.remove();
          await loadProjectsAndActive();
          await loadTasksForActiveProject();
          applyProjectSettings();
          renderProjList();
          render();
          syncColumnEmptyStates();
          updateStageTabs();
          scheduleHeaderRefresh();
          await refreshTimerFromServer();
          await syncCompletionMode();
          applyTimerFromSnapshot();
          return;
        }
        showError('Project delete failed: ' + error.message);
      }
    };

    setTimeout(function () {
      nameInput.focus();
    }, 0);
  }

  function ensureTaskDeleteButton() {
    const header = document.querySelector('#task-ov .tm-hd');
    if (!header) {
      return;
    }

    const closeButton = header.querySelector('.tm-close:not(.tm-delete)');
    if (!closeButton) {
      return;
    }

    let deleteButton = document.getElementById('tm-delete-btn');
    if (!deleteButton) {
      deleteButton = document.createElement('button');
      deleteButton.id = 'tm-delete-btn';
      deleteButton.className = 'tm-close tm-delete';
      deleteButton.title = 'Удалить задачу';
      deleteButton.textContent = '🗑';
      header.insertBefore(deleteButton, closeButton);
    }

    deleteButton.onclick = function () {
      openDeleteTaskConfirmModal();
    };
  }

  function ensureTaskEditUI(taskId) {
    var task = tasks.find(function (item) { return item.id === taskId; });
    if (!task) { return; }

    // ── Task code (ID задачи) в tm-id-col ───────────────────────────────────
    var idCol = document.querySelector('#task-ov .tm-id-col');
    var taskCodeEl = document.getElementById('tm-task-code');
    if (idCol && !taskCodeEl) {
      var codeInp = document.createElement('input');
      codeInp.id = 'tm-task-code';
      codeInp.className = 'tm-title-edit tm-id-input';
      codeInp.placeholder = 'ID';
      codeInp.maxLength = 10;
      codeInp.value = task.task_code || '';
      idCol.innerHTML = '';
      idCol.appendChild(codeInp);
    } else if (taskCodeEl) {
      taskCodeEl.value = task.task_code || '';
    }

    // ── Title в tm-title-col ──────────────────────────────────────────────
    var titleCol = document.querySelector('#task-ov .tm-title-col');
    var titleEl = document.getElementById('tm-title');
    if (titleCol) {
      var titleInput = document.getElementById('tm-title');
      if (!titleInput || titleInput.tagName !== 'INPUT') {
        titleInput = document.createElement('input');
        titleInput.id = 'tm-title';
        titleInput.className = 'tm-title-edit';
        titleInput.value = task.title;
        titleInput.placeholder = 'Название задачи';
        if (titleEl && titleEl.parentNode) {
          titleEl.replaceWith(titleInput);
        } else {
          titleCol.innerHTML = '';
          titleCol.appendChild(titleInput);
        }
      } else {
        titleInput.value = task.title;
      }
    }

    // ── Description ────────────────────────────────────────────────────────
    var descEl = document.getElementById('tm-desc');
    if (descEl) {
      if (descEl.tagName === 'TEXTAREA') {
        descEl.value = task.desc || '';
      } else {
        var descTa = document.createElement('textarea');
        descTa.id = 'tm-desc';
        descTa.className = 'tm-desc-edit';
        descTa.value = task.desc || '';
        descTa.placeholder = 'Описание задачи...';
        descEl.replaceWith(descTa);
      }
    }

    // ── Meta grid: rebuild with all editable fields ─────────────────────
    var metaEl = document.getElementById('tm-meta');
    if (metaEl) {
      var stages = getCurrentProjectStages();
      var taskStage = (task.stage || '').trim();
      if (!taskStage) taskStage = NO_STAGE;
      if (taskStage && !stages.some(function (s) { return String(s || '').trim().toLowerCase() === taskStage.toLowerCase(); })) {
        stages = [taskStage].concat(stages);
      }
      var stageOpts = stages.map(function (s) {
        var match = taskStage && String(s || '').trim().toLowerCase() === taskStage.toLowerCase();
        return '<option value="' + escapeHtml(s) + '"' + (match ? ' selected' : '') + '>' + escapeHtml(s) + '</option>';
      }).join('');

      var colList = typeof getProjectColumns === 'function' ? getProjectColumns() : [{ id: 'backlog', label: 'Backlog' }, { id: 'todo', label: 'To Do' }, { id: 'inprogress', label: 'In Progress' }, { id: 'review', label: 'Review' }, { id: 'done', label: 'Done' }];
      var colOpts = colList.map(function (c) {
        return '<option value="' + c.id + '"' + (task.col === c.id ? ' selected' : '') + '>' + escapeHtml(c.label) + '</option>';
      }).join('');

      var prioList = typeof getCurrentProjectPriorityOptions === 'function' ? getCurrentProjectPriorityOptions() : [{ value: 1, label: 'Low' }, { value: 2, label: 'Medium' }, { value: 3, label: 'High' }, { value: 4, label: 'Critical' }];
      var prioVal = task.priority > 0 ? task.priority : (prioList[0] && prioList[0].value) || 1;
      var prioOpts = prioList.map(function (p) {
        var v = p.value;
        return '<option value="' + v + '"' + (prioVal === v ? ' selected' : '') + '>' + escapeHtml(p.label) + '</option>';
      }).join('');
      if (prioList.length > 0 && !prioList.some(function (p) { return p.value === prioVal; })) {
        prioOpts = '<option value="' + prioVal + '" selected>' + escapeHtml(String(prioVal)) + '</option>' + prioOpts;
      }

      var AGENT_OPTIONS = getNtmAgentOptions();
      var curAgent = task.agent && AGENT_OPTIONS.indexOf(task.agent) >= 0 ? task.agent : 'Без агента';
      var agentOpts = AGENT_OPTIONS.map(function (a) {
        return '<option value="' + escapeHtml(a) + '"' + (curAgent === a ? ' selected' : '') + '>' + escapeHtml(a) + '</option>';
      }).join('');

      var sizeList = typeof getCurrentProjectSizeOptions === 'function' ? getCurrentProjectSizeOptions() : [{ id: 'XS', label: 'XS' }, { id: 'S', label: 'S' }, { id: 'M', label: 'M' }, { id: 'L', label: 'L' }, { id: 'XL', label: 'XL' }];
      var curSize = String(task.size || 'M').toUpperCase();
      var sizeOpts = sizeList.map(function (s) {
        var sid = s.id || s;
        return '<option value="' + escapeHtml(sid) + '"' + (curSize === sid ? ' selected' : '') + '>' + escapeHtml(s.label || sid) + '</option>';
      }).join('');
      if (sizeList.length > 0 && !sizeList.some(function (s) { return (s.id || s) === curSize; }) && curSize) {
        sizeOpts = '<option value="' + escapeHtml(curSize) + '" selected>' + escapeHtml(curSize) + '</option>' + sizeOpts;
      }

      var curDeps = '';
      if (task.deps && typeof task.deps === 'object' && Array.isArray(task.deps.blocks) && task.deps.blocks.length) {
        curDeps = task.deps.blocks.map(function (blockId) {
          if (typeof blockId !== 'string') return '';
          var other = tasks.find(function (item) {
            return item.raw_id === blockId || item.id === blockId;
          });
          return other && other.task_code ? other.task_code : blockId;
        }).filter(Boolean).join(', ');
      }

      function mkMc(id, label, controlHtml) {
        return '<div class="mc"><div class="mc-lbl">' + label + '</div>' + controlHtml + '</div>';
      }
      function mkSel(id, opts) {
        return '<select id="' + id + '" class="status-sel">' + opts + '</select>';
      }
      function mkInp(id, type, val, extra) {
        return '<input id="' + id + '" class="tm-field-input" type="' + type + '" value="'
          + escapeHtml(String(val)) + '"' + (extra || '') + '>';
      }

      metaEl.innerHTML =
        mkMc('tm-f-col', 'Статус', mkSel('tm-f-col', colOpts))
        + mkMc('tm-f-stage', 'Этап', mkSel('tm-f-stage', stageOpts))
        + mkMc('tm-f-priority', 'Приоритет', mkSel('tm-f-priority', prioOpts))
        + mkMc('tm-f-agent', 'Агент', mkSel('tm-f-agent', agentOpts))
        + mkMc('tm-f-size', 'Размер', mkSel('tm-f-size', sizeOpts))
        + mkMc('tm-f-hours', 'Часы', mkInp('tm-f-hours', 'number', task.hours || 0, ' min="0" step="0.5"'));

      var depsInput = document.getElementById('tm-f-deps');
      if (depsInput) depsInput.value = curDeps;

      // Size ↔ Hours auto-sync
      var SIZE_HOURS = { XS: 2, S: 4, M: 12, L: 32, XL: 60 };
      var sizeEl2 = document.getElementById('tm-f-size');
      var hoursEl2 = document.getElementById('tm-f-hours');
      if (sizeEl2 && hoursEl2) {
        sizeEl2.addEventListener('change', function () {
          var h = SIZE_HOURS[sizeEl2.value];
          if (h !== undefined) { hoursEl2.value = h; }
        });
      }

      applyFieldColors(metaEl);
      ['tm-f-col', 'tm-f-stage', 'tm-f-agent', 'tm-f-priority', 'tm-f-size'].forEach(function (id) {
        var sel = document.getElementById(id);
        if (sel) sel.addEventListener('change', function () { applyFieldColors(metaEl); });
      });
    }

    // ── Save button (в теле модала под Описание) ────────────────────────────
    var saveBtn = document.getElementById('tm-save-btn');
    if (saveBtn) {
      saveBtn.style.display = '';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Сохранить';
      saveBtn.onclick = function () { saveTaskEdits(taskId); };
    }
  }

  async function saveTaskEdits(taskId) {
    var task = tasks.find(function (item) { return item.id === taskId; });
    if (!task || !task.raw_id) {
      showError('Не удалось определить задачу для сохранения');
      return;
    }

    var titleEl = document.getElementById('tm-title');
    var taskCodeEl = document.getElementById('tm-task-code');
    var descEl = document.getElementById('tm-desc');
    var colEl = document.getElementById('tm-f-col');
    var stageEl = document.getElementById('tm-f-stage');
    var agentEl = document.getElementById('tm-f-agent');
    var priorityEl = document.getElementById('tm-f-priority');
    var sizeEl = document.getElementById('tm-f-size');
    var hoursEl = document.getElementById('tm-f-hours');
    var depsEl = document.getElementById('tm-f-deps');

    var newTitle = titleEl && titleEl.tagName === 'INPUT' ? titleEl.value.trim() : task.title;
    var newTaskCode = taskCodeEl ? String(taskCodeEl.value || '').trim().slice(0, 10) : (task.task_code || '');
    var newDesc = descEl && descEl.tagName === 'TEXTAREA' ? descEl.value.trim() : (task.desc || '');
    var newCol = colEl ? colEl.value : task.col;
    var newStage = stageEl ? stageEl.value : task.stage;
    var newAgent = agentEl ? agentEl.value.trim() : (task.agent || '');
    var newPriority = priorityEl ? Number(priorityEl.value) : (task.priority || 1);
    var newSize = sizeEl ? sizeEl.value : (task.size || 'M');
    var newHours = hoursEl ? (parseFloat(hoursEl.value) || 0) : (task.hours || 0);
    var depsRaw = depsEl ? depsEl.value.trim() : '';

    if (!newTitle) {
      showError('Название задачи не может быть пустым');
      return;
    }

    // Parse deps: comma-separated codes (or UUIDs) -> { blocks: [...] }
    var newDeps = null;
    if (depsRaw) {
      var blocks = depsRaw.split(/[\s,;]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (blocks.length) newDeps = { blocks: blocks };
    }

    var saveBtn = document.getElementById('tm-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '…'; }

    try {
      await apiFetch('/tasks/' + task.raw_id, {
        method: 'PATCH',
        body: {
          title: newTitle,
          task_code: newTaskCode || null,
          col: normalizeApiCol(newCol),
          stage: newStage || null,
          agent: newAgent || null,
          priority: newPriority,
          hours: newHours,
          descript: newDesc || null,
          deps: newDeps,
        },
      });

      // Update local task object
      task.title = newTitle;
      task.task_code = newTaskCode;
      task.desc = newDesc;
      task.col = newCol;
      task.stage = newStage;
      task.agent = newAgent || 'Tech Lead';
      task.priority = newPriority;
      task.hours = newHours;
      task.size = newSize;
      task.deps = newDeps || { blocks: [] };

      render();
      syncColumnEmptyStates();
      scheduleHeaderRefresh();
      await syncCompletionMode();
      applyTimerFromSnapshot();
      showInfo('Задача сохранена');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✓'; }
    } catch (error) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '✓'; }
      showError('Ошибка сохранения: ' + error.message);
    }
  }

  function openDeleteTaskConfirmModal() {
    const task = tasks.find(function (item) {
      return item.id === activeId || item.raw_id === activeId;
    });
    if (!task || !task.raw_id) {
      showError('Не удалось определить задачу для удаления');
      return;
    }

    let overlay = document.getElementById('delete-task-ov');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'delete-task-ov';
      overlay.className = 'overlay open';
      overlay.innerHTML = ''
        + '<div class="bridge-confirm-card">'
        + '<div class="bridge-confirm-title">Удалить задачу?</div>'
        + '<div class="bridge-confirm-sub" id="delete-task-sub"></div>'
        + '<div class="bridge-confirm-row">'
        + '<button class="bridge-confirm-btn no" id="delete-task-no">Отмена</button>'
        + '<button class="bridge-confirm-btn danger" id="delete-task-yes">Удалить</button>'
        + '</div>'
        + '</div>';
      document.body.appendChild(overlay);
    }

    overlay.classList.add('open');
    const sub = document.getElementById('delete-task-sub');
    const noButton = document.getElementById('delete-task-no');
    const yesButton = document.getElementById('delete-task-yes');
    if (!sub || !noButton || !yesButton) {
      return;
    }

    sub.textContent = 'Задача ' + task.id + ' («' + task.title + '») будет удалена безвозвратно.';
    noButton.onclick = function () {
      overlay.remove();
    };
    yesButton.onclick = async function () {
      yesButton.disabled = true;
      try {
        await apiFetch('/tasks/' + task.raw_id, { method: 'DELETE' });
        overlay.remove();
        closeTask();
        await loadTasksForActiveProject();
        render();
        syncColumnEmptyStates();
        updateStageTabs();
        if (activeProfileSubSection === 'trash') {
          loadDeletedTasks();
        }
        scheduleHeaderRefresh();
        await syncCompletionMode();
        applyTimerFromSnapshot();
        showInfo('Задача удалена');
      } catch (error) {
        yesButton.disabled = false;
        if (error.message === 'task_not_found') {
          overlay.remove();
          closeTask();
          await loadTasksForActiveProject();
          render();
          syncColumnEmptyStates();
          updateStageTabs();
          scheduleHeaderRefresh();
          await syncCompletionMode();
          applyTimerFromSnapshot();
          showError('Задача уже удалена');
          return;
        }
        showError('Task delete failed: ' + error.message);
      }
    };
  }

  async function syncCompletionMode(serverAllDone) {
    if (!activeProjId || completionTransitionInFlight) {
      projectCompletedMode = false;
      timerFrozen = false;
      return;
    }

    const completed = serverAllDone === true || isProjectCompleted();
    const completionOverride = Boolean(completionOverrideByProject[activeProjId]);
    if (!completed && completionOverrideByProject[activeProjId]) {
      delete completionOverrideByProject[activeProjId];
      saveCompletionOverrides();
    }
    if (completed && completionOverride) {
      projectCompletedMode = false;
      timerFrozen = false;
      return;
    }

    if (!completed && projectCompletedMode) {
      projectCompletedMode = false;
      timerFrozen = false;
      applyTimerFromSnapshot();
      return;
    }

    if (!completed || projectCompletedMode) {
      return;
    }

    completionTransitionInFlight = true;
    try {
      const freeze = await apiFetch('/timer/complete', { method: 'POST', body: {} });
      applyTimerSnapshotFromApi(freeze);
      projectCompletedMode = true;
      timerFrozen = true;
      applyTimerFromSnapshot();
    } catch (error) {
      showError('Не удалось зафиксировать завершение проекта: ' + error.message);
    } finally {
      completionTransitionInFlight = false;
    }
  }

  function scheduleHeaderRefresh() {
    if (headerRefreshScheduled) {
      return;
    }
    headerRefreshScheduled = true;

    setTimeout(function () {
      headerRefreshScheduled = false;
      refreshHeaderStats().catch(function (error) {
        showError('Header stats error: ' + error.message);
      });
    }, 50);
  }

  async function refreshHeaderStats() {
    if (headerRefreshInFlight) {
      return;
    }
    headerRefreshInFlight = true;

    try {
      let totalEl;
      if (!activeProjId) {
        document.getElementById('tl-back').textContent = '0';
        document.getElementById('tl-wip').textContent = '0';
        document.getElementById('tl-done').textContent = '0';
        document.getElementById('b-earned').textContent = '0 ₽';
        totalEl = document.querySelector('.b-total');
        if (totalEl) totalEl.textContent = '/ 0 ₽';
        document.getElementById('progress-fill').style.width = '0%';
        var weeksLbl = document.querySelector('#proj-timer .tc-lbl');
        if (weeksLbl) weeksLbl.textContent = '/ 0 нед';
        return;
      }

      const [taskStats, budgetStats] = await Promise.all([
        apiFetch('/stats/tasks'),
        apiFetch('/stats/budget'),
      ]);

      const backlog = Number(taskStats.backlog || 0);
      const inWork = Number(taskStats.in_work || 0);
      const done = Number(taskStats.done || 0);

      document.getElementById('tl-back').textContent = String(backlog);
      document.getElementById('tl-wip').textContent = String(inWork);
      document.getElementById('tl-done').textContent = String(done);

      const totalTasks = backlog + inWork + done;
      const flowPercent = totalTasks > 0 ? Math.round((done / totalTasks) * 100) : 0;
      document.getElementById('progress-fill').style.width = flowPercent + '%';

      const earned = Number(budgetStats.earned || 0);
      const total = Number(budgetStats.total || 0);

      document.getElementById('b-earned').textContent = fmtBudget(earned) + ' ₽';

      totalEl = document.querySelector('.b-total');
      if (totalEl) {
        totalEl.textContent = '/ ' + fmtBudget(total) + ' ₽';
      }
      const allTasksDoneFromServer = Boolean(taskStats.all_tasks_done);
      await syncCompletionMode(allTasksDoneFromServer);
      applyTimerFromSnapshot();
    } finally {
      headerRefreshInFlight = false;
    }
  }

  function renderProjectStageTabs() {
    const stageBar = document.getElementById('stage-bar');
    if (!stageBar) {
      return;
    }

    stageBar.querySelectorAll('.stab').forEach(function (button) {
      button.remove();
    });

    const searchWrap = stageBar.querySelector('.stab-search-wrap');
    const allButton = document.createElement('button');
    allButton.className = 'stab' + (curStage === 'all' ? ' active' : '');
    allButton.dataset.stage = 'all';
    allButton.onclick = function () {
      setStage('all', allButton);
    };
    allButton.innerHTML = '<span class="stab-icon stab-icon-all">⊞</span> Все <span class="cnt">' + tasks.length + '</span>';
    stageBar.insertBefore(allButton, searchWrap);

    const visibleStages = getVisibleStagesFromTasks();
    if (curStage !== 'all' && !visibleStages.some(function (s) { return String(s || '').toLowerCase() === String(curStage || '').toLowerCase(); })) {
      curStage = 'all';
    }
    visibleStages.forEach(function (stage) {
      const count = tasks.filter(function (task) {
        var tStage = (task.stage || '').trim();
        if (!tStage) tStage = NO_STAGE;
        return String(stage || '').toLowerCase() === tStage.toLowerCase();
      }).length;
      const stageColor = ensureStageColor(stage);
      const button = document.createElement('button');
      button.className = 'stab' + (curStage === stage ? ' active' : '');
      button.dataset.stage = stage;
      button.onclick = function () {
        setStage(stage, button);
      };
      button.innerHTML = '<span class="stab-icon" style="color:' + stageColor + '">●</span> ' + stage + ' <span class="cnt">' + count + '</span>';
      STAB_C[stage] = stageColor;
      stageBar.insertBefore(button, searchWrap);
    });

    updateStageTabs();
  }

  function getFilteredTasks() {
    let filtered = tasks;

    if (curStage !== 'all') {
      filtered = filtered.filter(function (task) {
        var tStage = (task.stage || '').trim();
        if (!tStage) tStage = NO_STAGE;
        return String(curStage || '').toLowerCase() === tStage.toLowerCase();
      });
    }

    if (searchQ) {
      filtered = filtered.filter(function (task) {
        const haystack = [
          task.id || '',
          task.raw_id || '',
          task.public_id != null ? String(task.public_id) : '',
          task.task_code || '',
          task.title || '',
          task.desc || '',
          task.notes || '',
          task.stage || '',
          task.agent || '',
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(searchQ);
      });
    }

    const ordered = [];
    const colsForOrder = typeof getProjectColumns === 'function' ? getProjectColumns() : [{ id: 'backlog', label: 'Backlog' }, { id: 'todo', label: 'To Do' }, { id: 'inprogress', label: 'In Progress' }, { id: 'review', label: 'Review' }, { id: 'done', label: 'Done' }];
    colsForOrder.forEach(function (column) {
      const inColumn = filtered.filter(function (task) {
        return task.col === column.id;
      });
      sortTasksForColumn(column.id, inColumn).forEach(function (task) {
        ordered.push(task);
      });
    });
    return ordered;
  }

  async function loadProjectsAndActive() {
    const projectsResponse = await apiFetch('/projects');
    projects = (projectsResponse.projects || []).map(mapProjectFromApi);

    if (projectsResponse.active_project_id) {
      activeProjId = projectsResponse.active_project_id;
    }

    const activeProject = await apiFetch('/projects/active');
    if (activeProject && activeProject.id) {
      const mappedActive = mapProjectFromApi(activeProject);
      const exists = projects.some(function (project) {
        return project.id === mappedActive.id;
      });
      if (!exists) {
        projects.unshift(mappedActive);
      }
      activeProjId = mappedActive.id;
    } else {
      activeProjId = '';
    }

    localStorage.setItem('mossb_active_proj', activeProjId || '');
  }

  async function loadTasksForActiveProject() {
    if (!activeProjId) {
      tasks = [];
      return;
    }

    const taskResponse = await apiFetch('/projects/' + activeProjId + '/tasks');
    tasks = (taskResponse.tasks || []).map(mapTaskFromApi);
  }

  async function moveTaskToColumn(taskId, uiCol) {
    const apiCol = normalizeApiCol(uiCol);
    const task = tasks.find(function (item) {
      return item.id === taskId || item.raw_id === taskId;
    });
    if (task && (apiCol === 'doing' || apiCol === 'todo') && task.deps && Array.isArray(task.deps.blocks) && task.deps.blocks.length) {
      var notDone = task.deps.blocks.filter(function (blockId) {
        var dep = tasks.find(function (t) { return t.raw_id === blockId || t.id === blockId; });
        return !dep || dep.col !== 'done';
      });
      if (notDone.length) {
        var codes = notDone.map(function (id) {
          var t = tasks.find(function (x) { return x.raw_id === id || x.id === id; });
          return t && t.task_code ? t.task_code : id;
        }).join(', ');
        throw new Error('Сначала завершите зависимости: ' + codes);
      }
    }
    const rawId = task && task.raw_id ? task.raw_id : taskId;
    try {
      await apiFetch('/tasks/' + rawId + '/move', {
        method: 'POST',
        body: {
          col: apiCol,
        },
      });
    } catch (err) {
      if (err.body && err.body.error === 'task_blocked_by_deps' && err.body.message) {
        throw new Error(err.body.message);
      }
      throw err;
    }
  }

  function getColumnTaskOrderRawIds(uiCol) {
    return tasks
      .filter(function (task) {
        return task.col === uiCol;
      })
      .map(function (task) {
        return task.raw_id || task.id;
      })
      .filter(function (taskId) {
        return typeof taskId === 'string' && taskId.length > 0;
      });
  }

  async function persistColumnOrder(uiCol) {
    if ((columnSortModes[uiCol] || DEFAULT_SORT_MODE) !== DEFAULT_SORT_MODE) {
      return;
    }

    const order = getColumnTaskOrderRawIds(uiCol);
    await apiFetch('/tasks/reorder', {
      method: 'PATCH',
      body: {
        column: normalizeApiCol(uiCol),
        order: order,
      },
    });
  }

  async function persistColumnOrders(uiCols) {
    const seen = new Set();
    for (const uiCol of uiCols) {
      if (!uiCol || seen.has(uiCol)) {
        continue;
      }
      seen.add(uiCol);
      await persistColumnOrder(uiCol);
    }
  }

  function reorderTasksAfterDrop(taskId, targetCol, afterTaskId) {
    const movingIndex = tasks.findIndex(function (item) {
      return item.id === taskId;
    });
    if (movingIndex < 0) {
      return;
    }
    const movingTask = tasks[movingIndex];
    tasks.splice(movingIndex, 1);
    movingTask.col = targetCol;

    if ((columnSortModes[targetCol] || DEFAULT_SORT_MODE) !== DEFAULT_SORT_MODE) {
      tasks.push(movingTask);
      return;
    }

    if (afterTaskId) {
      const targetIndex = tasks.findIndex(function (item) {
        return item.id === afterTaskId;
      });
      if (targetIndex >= 0) {
        tasks.splice(targetIndex, 0, movingTask);
        return;
      }
    }

    let insertIndex = tasks.length;
    for (let i = tasks.length - 1; i >= 0; i -= 1) {
      if (tasks[i].col === targetCol) {
        insertIndex = i + 1;
        break;
      }
    }
    tasks.splice(insertIndex, 0, movingTask);
  }

  async function createTaskFromPreview(previewTask) {
    if (!activeProjId) {
      throw new Error('No active project');
    }

    const sizeVal = (previewTask.size && String(previewTask.size).trim().toUpperCase()) || '';
    const payload = {
      title: previewTask.title,
      task_code: (previewTask.task_code && String(previewTask.task_code).trim().slice(0, 10)) || null,
      stage: (previewTask.stage && String(previewTask.stage).trim()) || (getCurrentProjectStages()[0] || ''),
      col: normalizeApiCol(previewTask.col || newTaskCol || 'backlog'),
      track: previewTask.track || null,
      agent: previewTask.agent || null,
      priority: Number(previewTask.priority || 0),
      hours: Number(previewTask.hours || 0),
      size: sizeVal && ['XS', 'S', 'M', 'L', 'XL'].includes(sizeVal) ? sizeVal : null,
      descript: previewTask.desc || null,
      notes: previewTask.notes || null,
      deps: previewTask.deps && previewTask.deps.blocks && previewTask.deps.blocks.length ? previewTask.deps : null,
    };

    await apiFetch('/projects/' + activeProjId + '/tasks', {
      method: 'POST',
      body: payload,
    });
  }

  async function setActiveProject(projectId) {
    await apiFetch('/projects/activate', {
      method: 'POST',
      body: {
        project_id: projectId || null,
      },
    });
  }

  async function bootstrapFromApi() {
    try {
      ensureBridgeStyles();
      bindProfileButton();
      ensureManualTaskCreatorUI();
      applyTimerUI = applyBridgeTimerUI;
      loadCompletionOverrides();
      if (typeof timerInt !== 'undefined' && timerInt) {
        clearInterval(timerInt);
      }

      timerRunning = false;
      delayRunning = false;
      timerMode = 'stopped';
      applyTimerUI();

      await loadProjectsAndActive();
      await loadTasksForActiveProject();

      applyProjectSettings();
      render();
      ensureBulkBarBindings();
      syncColumnEmptyStates();
      updateStageTabs();
      renderProjList();
      refreshProfileIfOpen();
      scheduleHeaderRefresh();
      await refreshTimerFromServer();
      await syncCompletionMode();
      applyTimerFromSnapshot();

      if (timerTickIntervalId) {
        clearInterval(timerTickIntervalId);
      }
      timerTickIntervalId = setInterval(applyTimerFromSnapshot, 1000);

      if (timerSyncIntervalId) {
        clearInterval(timerSyncIntervalId);
      }
      timerSyncIntervalId = setInterval(function () {
        refreshTimerFromServer().catch(function (error) {
          showError('Timer sync error: ' + error.message);
        });
      }, 10000);
    } catch (error) {
      var msg = error.message || '';
      if (msg === 'schema_outdated' || (error.body && error.body.error === 'schema_outdated')) {
        showError('Схема БД устарела. Выполните миграцию: npm run db:migrate');
      } else {
        showError('API bootstrap failed: ' + msg);
      }
    }
  }

  const originalRender = render;
  render = function () {
    originalRender();
    syncColumnEmptyStates();
    renderColumnSortControls();
  };

  save = function () {
    // Persist is API-driven now.
  };

  loadTasksForProject = function (projectId) {
    if (projectId && projectId === activeProjId) {
      return tasks;
    }
    return [];
  };

  getFiltered = getFilteredTasks;
  renderStageTabs = renderProjectStageTabs;

  window.selectedTaskIds = window.selectedTaskIds || new Set();
  window.toggleTaskSelection = function (rawId) {
    if (!rawId) return;
    var set = window.selectedTaskIds;
    if (set.has(rawId)) {
      set.delete(rawId);
    } else {
      set.add(rawId);
    }
    if (typeof updateBulkBarVisibility === 'function') updateBulkBarVisibility();
    if (typeof render === 'function') render();
  };
  window.selectColumnTasks = function (colId) {
    var filtered = typeof getFilteredTasks === 'function' ? getFilteredTasks() : [];
    var inCol = filtered.filter(function (t) { return t.col === colId; });
    inCol.forEach(function (t) {
      var id = t.raw_id || t.id;
      if (id) window.selectedTaskIds.add(id);
    });
    if (typeof updateBulkBarVisibility === 'function') updateBulkBarVisibility();
    if (typeof render === 'function') render();
  };
  window.clearSelection = function () {
    window.selectedTaskIds.clear();
    if (typeof updateBulkBarVisibility === 'function') updateBulkBarVisibility();
    if (typeof render === 'function') render();
  };
  function updateBulkBarVisibility() {
    var bar = document.getElementById('bulk-actions-bar');
    var countEl = document.getElementById('bulk-count');
    var boardOuter = document.querySelector('.board-outer');
    var n = window.selectedTaskIds ? window.selectedTaskIds.size : 0;
    if (bar) bar.style.display = n > 0 ? '' : 'none';
    if (countEl) countEl.textContent = n;
    if (boardOuter) boardOuter.style.height = n > 0 ? 'calc(100vh - 192px)' : '';
    if (n > 0) {
      setupBulkBarOptions();
      if (typeof pkDropdownInit === 'function') pkDropdownInit(bar);
    }
  }

  function setupBulkBarOptions() {
    var cols = typeof getProjectColumns === 'function' ? getProjectColumns() : [
      { id: 'backlog', label: 'Backlog' }, { id: 'todo', label: 'To Do' },
      { id: 'inprogress', label: 'In Progress' }, { id: 'review', label: 'Review' }, { id: 'done', label: 'Done' }
    ];
    var colSel = document.getElementById('bulk-col');
    if (colSel) {
      colSel.innerHTML = '<option value="">— Статус —</option>' + cols.map(function (c) {
        return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.label) + '</option>';
      }).join('');
    }
    var stages = typeof getCurrentProjectStages === 'function' ? getCurrentProjectStages() : [];
    var stageSel = document.getElementById('bulk-stage');
    if (stageSel) {
      stageSel.innerHTML = '<option value="">— Этап —</option>' + stages.map(function (s) {
        return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>';
      }).join('');
    }
    var prioSel = document.getElementById('bulk-priority');
    if (prioSel) {
      var prioOpts = typeof getCurrentProjectPriorityOptions === 'function' ? getCurrentProjectPriorityOptions() : [{ value: 1, label: 'Low' }, { value: 2, label: 'Medium' }, { value: 3, label: 'High' }, { value: 4, label: 'Critical' }];
      prioSel.innerHTML = '<option value="">— Приоритет —</option>' + prioOpts.map(function (p) { return '<option value="' + escapeHtml(String(p.value)) + '">' + escapeHtml(p.label) + '</option>'; }).join('');
    }
    var agents = typeof getNtmAgentOptions === 'function' ? getNtmAgentOptions() : [];
    var agentSel = document.getElementById('bulk-agent');
    if (agentSel) {
      agentSel.innerHTML = '<option value="">— Агент —</option>' + agents.map(function (a) {
        return '<option value="' + escapeHtml(a) + '">' + escapeHtml(a) + '</option>';
      }).join('');
    }
    var sizeSel = document.getElementById('bulk-size');
    if (sizeSel) {
      var sizeOptsBulk = typeof getCurrentProjectSizeOptions === 'function' ? getCurrentProjectSizeOptions() : [{ id: 'XS', label: 'XS' }, { id: 'S', label: 'S' }, { id: 'M', label: 'M' }, { id: 'L', label: 'L' }, { id: 'XL', label: 'XL' }];
      sizeSel.innerHTML = '<option value="">— Размер —</option>' + sizeOptsBulk.map(function (s) { return '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.label || s.id) + '</option>'; }).join('');
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.target.closest && (e.target.closest('#bulk-actions-bar') || e.target.closest('.pk-dropdown.open'))) return;
    if (window.clearSelection) window.clearSelection();
  });
  document.addEventListener('click', function (e) {
    if (!window.selectedTaskIds || window.selectedTaskIds.size === 0) return;
    var body = e.target.closest && e.target.closest('.col-body');
    if (!body) return;
    if (e.target.closest && e.target.closest('.card')) return;
    if (window.clearSelection) window.clearSelection();
  });

  var bulkBarBindingsDone = false;
  function ensureBulkBarBindings() {
    if (bulkBarBindingsDone) return;
    bulkBarBindingsDone = true;
    var applyBtn = document.getElementById('bulk-apply');
    var clearBtn = document.getElementById('bulk-clear');
    if (applyBtn) {
      applyBtn.addEventListener('click', async function () {
        var ids = Array.from(window.selectedTaskIds || []);
        if (ids.length === 0) return;
        var updates = {};
        var colEl = document.getElementById('bulk-col');
        var stageEl = document.getElementById('bulk-stage');
        var prioEl = document.getElementById('bulk-priority');
        var agentEl = document.getElementById('bulk-agent');
        var sizeEl = document.getElementById('bulk-size');
        var hoursEl = document.getElementById('bulk-hours');
        if (colEl && colEl.value) updates.col = normalizeApiCol(colEl.value);
        if (stageEl && stageEl.value) updates.stage = stageEl.value.trim();
        if (prioEl && prioEl.value) updates.priority = parseInt(prioEl.value, 10);
        if (agentEl && agentEl.value) updates.agent = agentEl.value.trim();
        if (sizeEl && sizeEl.value) updates.size = sizeEl.value.trim();
        if (hoursEl && hoursEl.value !== '') updates.hours = parseFloat(hoursEl.value) || 0;
        if (Object.keys(updates).length === 0) {
          showError('Выберите хотя бы одно поле для изменения');
          return;
        }
        applyBtn.disabled = true;
        try {
          await Promise.all(ids.map(function (id) {
            return apiFetch('/tasks/' + id, { method: 'PATCH', body: updates });
          }));
          window.clearSelection();
          await loadTasksForActiveProject();
          render();
          syncColumnEmptyStates();
          updateStageTabs();
          scheduleHeaderRefresh();
          showInfo('Изменения применены');
        } catch (err) {
          showError('Ошибка применения: ' + (err.message || err));
        } finally {
          applyBtn.disabled = false;
        }
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        window.clearSelection();
      });
    }
  }

  updateStats = function () {
    syncColumnEmptyStates();
    scheduleHeaderRefresh();
  };

  switchProject = async function (id) {
    try {
      activeProjId = id || '';
      await setActiveProject(activeProjId);
      localStorage.setItem('mossb_active_proj', activeProjId || '');
      await loadTasksForActiveProject();
      curStage = 'all';
      applyProjectSettings();
      closeAllDropdowns();
      render();
      syncColumnEmptyStates();
      updateStageTabs();
      refreshProfileIfOpen();
      scheduleHeaderRefresh();
      await refreshTimerFromServer();
      await syncCompletionMode();
      applyTimerFromSnapshot();
    } catch (error) {
      showError('Project switch failed: ' + error.message);
    }
  };

  saveProjSettings = async function () {
    if (!editingProjId) {
      return;
    }

    const name = document.getElementById('ps-name').value.trim();
    const weeks = parseInt(document.getElementById('ps-weeks').value, 10) || 0;
    const budgetInputValue = parseInt(document.getElementById('ps-budget').value, 10) || 0;
    const stageSettings = collectStageSettingsFromModal();
    const agentSettings = collectAgentSettingsFromModal();
    const priorityOptions = collectPriorityOptionsFromModal();
    const sizeOptions = collectSizeOptionsFromModal();
    const columnSettings = collectColumnSettingsFromModal();

    if (!name) {
      document.getElementById('ps-name').focus();
      return;
    }

    const stageBudgetTotal = stageSettings.reduce(function (sum, item) {
      return sum + Number(item.budget || 0);
    }, 0);
    const budget = stageBudgetTotal > 0 ? stageBudgetTotal : Math.max(0, budgetInputValue);

    try {
      if (editingProjId === '__new__') {
        const responsibleEl = document.getElementById('ps-responsible');
        const responsibleId = (responsibleEl && responsibleEl.value && responsibleEl.value.trim()) || null;
        const payload = {
          name: name,
          duration_weeks: Math.max(0, weeks),
          budget_total: Math.max(0, budget),
          stages: stageSettings.map(function (item) {
            return item.name;
          }),
          stage_settings: stageSettings,
          agent_settings: agentSettings,
          priority_options: priorityOptions.length > 0 ? priorityOptions : undefined,
          size_options: sizeOptions.length > 0 ? sizeOptions : undefined,
          column_settings: columnSettings,
        };
        if (responsibleId) {
          payload.responsible_user_id = responsibleId;
        }
        const created = await apiFetch('/projects', {
          method: 'POST',
          body: payload,
        });
        closeProjSettings();
        await loadProjectsAndActive();
        if (created && created.project && created.project.id) {
          activeProjId = created.project.id;
        }
      } else {
        const resolved = await ensureTaskStagesPreserved(editingProjId, stageSettings);
        const finalStageSettings = resolved.stageSettings;
        if (resolved.addedStages.length > 0) {
          ensureStageSettingsEditor(finalStageSettings);
          syncProjectBudgetInputFromStageRows();
          showInfo(
            'Добавлены этапы с существующими задачами: ' +
            resolved.addedStages.join(', ') +
            '. Проверьте их в форме и нажмите «Сохранить» еще раз.'
          );
          return;
        }

        const payload = {
          name: name,
          duration_weeks: Math.max(0, weeks),
          budget_total: Math.max(0, budget),
          stages: finalStageSettings.map(function (item) {
            return item.name;
          }),
          stage_settings: finalStageSettings,
          agent_settings: agentSettings,
          priority_options: priorityOptions.length > 0 ? priorityOptions : undefined,
          size_options: sizeOptions.length > 0 ? sizeOptions : undefined,
          column_settings: columnSettings,
        };

        await applyPendingStageActions(editingProjId, finalStageSettings);
        await apiFetch('/projects/' + editingProjId, {
          method: 'PATCH',
          body: payload,
        });
        var jwt = decodeJwtPayload(localStorage.getItem('pk24_token'));
        if ((jwt && jwt.role) === 'admin') {
          var responsibleEl = document.getElementById('ps-responsible');
          var newResponsibleId = (responsibleEl && responsibleEl.value && responsibleEl.value.trim()) || null;
          var proj = projects.find(function (p) { return p.id === editingProjId; });
          var oldResponsibleId = (proj && proj.responsible_user_id) || null;
          if (String(newResponsibleId || '') !== String(oldResponsibleId || '')) {
            await apiFetch('/projects/' + editingProjId + '/assign', {
              method: 'PATCH',
              body: { responsible_user_id: newResponsibleId },
            });
          }
        }
        closeProjSettings();
        await loadProjectsAndActive();
      }

      if (editingProjId) {
        delete pendingStageActionsByProject[editingProjId];
      }

      await loadTasksForActiveProject();
      applyProjectSettings();
      renderProjList();
      render();
      syncColumnEmptyStates();
      updateStageTabs();
      refreshProfileIfOpen();
      scheduleHeaderRefresh();
      await refreshTimerFromServer();
      await syncCompletionMode();
      applyTimerFromSnapshot();
    } catch (error) {
      if (error.message === 'invalid_stage_transfer_target') {
        showError('Неверный этап переноса. Проверьте настройки этапов.');
        return;
      }
      if (error.message === 'stages_in_use') {
        showError('Нельзя удалить этап, пока в нем есть задачи. Выберите перенос или удаление задач.');
        return;
      }
      var errBody = error.body || (error.json && typeof error.json === 'function' ? error.json() : null);
      if (errBody && errBody.error === 'column_has_tasks' && Array.isArray(errBody.columns) && errBody.columns.length > 0) {
        var cols = errBody.columns;
        var targetOptions = columnSettings.filter(function (c) { return !cols.some(function (r) { return (r.col || '').toLowerCase() === (c.id || '').toLowerCase(); }); });
        var targetCol = await openColumnMoveTasksModal(cols, targetOptions);
        if (targetCol) {
          try {
            var projTasks = await getTasksForProject(editingProjId);
            var apiCol = targetCol === 'inprogress' ? 'doing' : targetCol;
            for (var i = 0; i < cols.length; i++) {
              var fromCol = cols[i].col;
              var inCol = projTasks.filter(function (t) { return (t.col || '').toLowerCase().replace('inprogress', 'doing') === (fromCol || '').toLowerCase(); });
              for (var j = 0; j < inCol.length; j++) {
                var tid = inCol[j].raw_id || inCol[j].id;
                if (tid) await apiFetch('/tasks/' + tid + '/move', { method: 'POST', body: { col: apiCol } });
              }
            }
            showInfo('Задачи перенесены. Сохраняю настройки...');
            return saveProjSettings();
          } catch (e) {
            showError('Не удалось перенести задачи: ' + (e.message || e));
          }
        }
        return;
      }
      showError('Project save failed: ' + error.message);
    }
  };

  async function openColumnMoveTasksModal(affectedColumns, targetOptions) {
    return new Promise(function (resolve) {
      var ov = document.getElementById('column-move-tasks-ov');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'column-move-tasks-ov';
        ov.className = 'overlay open';
        ov.innerHTML = ''
          + '<div class="bridge-confirm-card" style="max-width:420px">'
          + '<div class="bridge-confirm-title">В колонках есть задачи</div>'
          + '<div class="bridge-confirm-sub" id="column-move-sub"></div>'
          + '<div style="margin-top:12px;"><label style="font-size:12px;color:var(--tx2);">Перенести в:</label>'
          + '<select id="column-move-target" class="bridge-delete-input" style="margin-top:6px;width:100%"></select></div>'
          + '<div class="bridge-confirm-row" style="justify-content:flex-end;margin-top:16px;gap:8px">'
          + '<button class="bridge-confirm-btn no" id="column-move-cancel">Отмена</button>'
          + '<button class="bridge-confirm-btn yes" id="column-move-ok">Перенести и сохранить</button>'
          + '</div></div>';
        document.body.appendChild(ov);
      }
      var sub = document.getElementById('column-move-sub');
      var targetSel = document.getElementById('column-move-target');
      var cancelBtn = document.getElementById('column-move-cancel');
      var okBtn = document.getElementById('column-move-ok');
      if (!sub || !targetSel || !cancelBtn || !okBtn) { resolve(null); return; }
      var lines = affectedColumns.map(function (r) { return r.col + ': ' + r.cnt + ' задач'; });
      sub.textContent = 'В скрываемых колонках: ' + lines.join(', ') + '. Выберите колонку для переноса:';
      targetSel.innerHTML = targetOptions.map(function (c) {
        return '<option value="' + (c.id === 'doing' ? 'inprogress' : c.id) + '">' + escapeHtml(c.label || c.id) + '</option>';
      }).join('');
      if (targetOptions.length > 0) targetSel.value = targetOptions[0].id === 'doing' ? 'inprogress' : targetOptions[0].id;
      ov.classList.add('open');
      cancelBtn.onclick = function () { ov.classList.remove('open'); resolve(null); };
      okBtn.onclick = function () { ov.classList.remove('open'); resolve(targetSel.value || null); };
    });
  }

  deleteProject = async function () {
    if (!editingProjId || editingProjId === '__new__') {
      showError('Выберите существующий проект для удаления');
      return;
    }
    const project = projects.find(function (item) {
      return item.id === editingProjId;
    });
    if (!project) {
      showError('Проект не найден');
      return;
    }
    let taskCount = 0;
    if (project.id === activeProjId && typeof tasks !== 'undefined' && Array.isArray(tasks)) {
      taskCount = tasks.length;
    } else {
      try {
        const res = await apiFetch('/projects/' + project.id + '/tasks');
        taskCount = (res && res.tasks && res.tasks.length) ? res.tasks.length : 0;
      } catch (e) {
        showError('Не удалось получить количество задач: ' + (e.message || e));
        return;
      }
    }
    const msg =
      'Удалить проект «' + (project.name || '') + '»? Будет удалено ' + taskCount + ' задач и вся история действий. Это действие необратимо.';
    if (!confirm(msg)) {
      return;
    }
    try {
      await apiFetch('/projects/' + project.id, {
        method: 'DELETE',
        body: { confirm_name: project.name || '' },
      });
      closeProjSettings();
      await loadProjectsAndActive();
      await loadTasksForActiveProject();
      applyProjectSettings();
      renderProjList();
      if (typeof renderProfileSection === 'function') renderProfileSection();
      render();
      syncColumnEmptyStates();
      updateStageTabs();
      scheduleHeaderRefresh();
      await refreshTimerFromServer();
      await syncCompletionMode();
      applyTimerFromSnapshot();
      showInfo('Проект удалён.');
    } catch (error) {
      showError('Не удалось удалить проект: ' + (error.message || error));
    }
  };

  changeCol = async function (id, col) {
    const task = tasks.find(function (item) {
      return item.id === id;
    });
    if (!task) {
      return;
    }

    const oldCol = task.col;
    task.col = col;
    render();
    syncColumnEmptyStates();

    try {
      await moveTaskToColumn(id, col);
      scheduleHeaderRefresh();
      await syncCompletionMode();
      applyTimerFromSnapshot();
    } catch (error) {
      task.col = oldCol;
      render();
      syncColumnEmptyStates();
      showError('Task move failed: ' + error.message);
    }
  };

  onDrop = async function (event) {
    event.preventDefault();
    const body = event.currentTarget;
    const targetCol = body.dataset.col;
    if (!dragId) {
      return;
    }

    const task = tasks.find(function (item) {
      return item.id === dragId;
    });
    if (!task) {
      return;
    }

    const tasksBeforeDrop = tasks.map(function (item) {
      return { ...item };
    });
    const previousCol = task.col;
    const afterElement = getDragAfterEl(body, event.clientY);
    const afterTaskId = afterElement ? afterElement.dataset.id : null;
    reorderTasksAfterDrop(task.id, targetCol, afterTaskId);

    const cardElement = document.querySelector('.card[data-id="' + dragId + '"]');
    body.querySelectorAll('.card-drop-indicator').forEach(function (element) {
      element.remove();
    });
    body.classList.remove('drag-over');
    const colElement = body.closest('.col');
    if (colElement) {
      colElement.classList.remove('drag-over-col');
    }

    if (afterElement) {
      body.insertBefore(cardElement, afterElement);
    } else {
      body.appendChild(cardElement);
    }

    updateColCounts();
    syncColumnEmptyStates();
    scheduleHeaderRefresh();

    try {
      await moveTaskToColumn(task.id, targetCol);
      await persistColumnOrders([previousCol, targetCol]);
      await syncCompletionMode();
      applyTimerFromSnapshot();
    } catch (error) {
      tasks = tasksBeforeDrop;
      render();
      syncColumnEmptyStates();
      showError('Task move failed: ' + error.message);
    }
  };

  let aiChatAbortController = null;

  window.handleAiSendClick = function () {
    const button = document.getElementById('ai-btn');
    if (button && button.classList.contains('stop-state')) {
      if (aiChatAbortController) aiChatAbortController.abort();
      return;
    }
    sendMsg();
  };

  sendMsg = async function () {
    const input = document.getElementById('ai-in');
    const text = input.value.trim();
    if (!text || !activeId) {
      return;
    }

    const rawId = getActiveTaskRawId();
    if (!rawId) {
      return;
    }

    input.value = '';
    input.style.height = 'auto';
    appendTo('ai-msgs', 'user', text);
    chatHist.push({ role: 'user', content: text });

    const button = document.getElementById('ai-btn');
    if (button) {
      button.disabled = false;
      button.classList.add('stop-state');
      var icon = button.querySelector('.ai-send-icon');
      if (icon) icon.textContent = '\u25A0';
      button.setAttribute('aria-label', 'Остановить');
    }
    aiChatAbortController = new AbortController();
    showTyping('ai-msgs');

    var provWrap = document.getElementById('tc-llm-provider');
    var modWrap = document.getElementById('tc-llm-model');
    var provSel = provWrap ? provWrap.querySelector('select') : null;
    var modSel = modWrap ? modWrap.querySelector('select') : null;
    var provider = provSel && provSel.value ? provSel.value.trim() : '';
    var model = modSel && modSel.value ? modSel.value.trim() : '';
    var body = { content: text };
    if (provider) body.provider = provider;
    if (model) body.model = model;

    try {
      const response = await apiFetch('/tasks/' + rawId + '/chat', {
        method: 'POST',
        body: body,
        signal: aiChatAbortController.signal,
      });

      hideTyping('ai-msgs');
      const msg = response && response.message;
      if (msg) {
        chatHist.push({ role: 'assistant', content: msg.content });
        appendChatMessage('ai-msgs', msg);
      } else {
        appendTo('ai-msgs', 'ai', 'Нет ответа');
      }
    } catch (error) {
      hideTyping('ai-msgs');
      if (error.name === 'AbortError') {
        appendTo('ai-msgs', 'ai', 'Запрос остановлен.');
      } else {
        let msg = '! Ошибка чата: ' + (error.message || 'unknown');
        if (error.message === 'llm_unavailable' || (error.body && error.body.error === 'llm_unavailable')) {
          var hint = error.body && error.body.hint;
          if (hint === 'missing_api_key') {
            msg = 'LLM недоступна: не задан API-ключ. Задайте ключ в Профиль → Настройки LLM.';
          } else if (hint === 'request_failed') {
            msg = 'Запрос к LLM не выполнен (сеть, таймаут или ошибка провайдера). Проверьте логи сервера.';
          } else if (hint === 'provider_error') {
            msg = 'API провайдера вернул ошибку (ключ или лимит). Проверьте ключ и квоты в консоли провайдера.';
          } else {
            msg = 'LLM временно недоступна. Проверьте настройки в Профиль → Настройки LLM.';
          }
        } else if (error.body && error.body.error === 'internal_error' && error.body.message) {
          msg = '! Ошибка: ' + error.body.message;
        }
        appendTo('ai-msgs', 'ai', msg);
      }
    } finally {
      aiChatAbortController = null;
      if (button) {
        button.classList.remove('stop-state');
        var icon = button.querySelector('.ai-send-icon');
        if (icon) icon.textContent = '\u2191';
        button.setAttribute('aria-label', 'Отправить');
        button.disabled = false;
      }
    }
  };

  const TECHLEAD_SYSTEM_PROMPT_BASE =
    'Ты — TechLead. Помогаешь добавить задачу в канбан-проект.\n\n' +
    'Контекст проекта:\n{snapshot_md}\n\n' +
    'Твои действия:\n' +
    '1. Задай 1-2 уточняющих вопроса если задача не ясна\n' +
    '2. Предложи подходящий этап из существующих в проекте\n' +
    '3. Если задача зависит от другой — укажи depends_on (ID задачи)\n' +
    '4. Когда всё ясно — сформируй задачу в JSON внутри блока ```task\n\n' +
    'Формат JSON:\n' +
    "{\n  'title': '...',\n  'stage': '...',\n  'priority': 'high|mid|low|none',\n  'descript': '...',\n  'agent': 'Claude',\n  'depends_on': ['T-000001']\n}\n\n" +
    'Отвечай кратко. Один вопрос за раз.\n\n' +
    'Зависимости — это блокирующие связи: задача B не может быть начата пока не завершена задача A. Не путай с порядком приоритетов. ' +
    'Предлагай зависимость только если это ТЕХНИЧЕСКИ необходимо, не по хронологии.';

  let ntSnapshotMd = '';
  let ntAiHistory = null;
  let ntAiAbortController = null;

  const NT_LLM_PROVIDERS = [
    { value: 'anthropic', label: 'Anthropic' }, { value: 'openai', label: 'OpenAI' },
    { value: 'deepseek', label: 'DeepSeek' }, { value: 'groq', label: 'Groq' },
    { value: 'qwen', label: 'Qwen' }, { value: 'custom', label: 'Custom' },
  ];
  const NT_LLM_STORAGE_KEY = 'pk24_llm_new_task';
  const TC_LLM_STORAGE_KEY = 'pk24_llm_task_edit';
  const IMP_LLM_STORAGE_KEY = 'pk24_llm_import';

  function initLlmSelectors(provSelId, modSelId, storageKey) {
    var provWrap = document.getElementById(provSelId);
    var modWrap = document.getElementById(modSelId);
    if (!provWrap || !modWrap) return;
    var provSel = provWrap.querySelector ? provWrap.querySelector('select') : provWrap;
    var modSel = modWrap.querySelector ? modWrap.querySelector('select') : modWrap;
    if (!provSel || !modSel) return;
    var row = provWrap.parentElement;
    var impLabel = row ? row.querySelector('label') : null;

    /* Скрываем до проверки API ключей — иначе при медленной загрузке показываются пустые поля */
    provWrap.style.display = 'none';
    modWrap.style.display = 'none';
    if (impLabel) impLabel.style.display = 'none';

    var saveToStorage = function () {
      try {
        var pv = provSel ? provSel.value : '';
        var mv = modSel ? modSel.value : '';
        localStorage.setItem(storageKey, JSON.stringify({ provider: pv, model: mv }));
      } catch (e) { }
    };

    apiFetch('/api/llm/api-keys').catch(function () { return { keys: [] }; }).then(function (keysRes) {
      var keys = Array.isArray(keysRes && keysRes.keys) ? keysRes.keys : [];
      var hasKeySet = {};
      keys.forEach(function (k) { if (k && k.provider && k.has_key) hasKeySet[k.provider] = true; });
      var provOpts = NT_LLM_PROVIDERS.filter(function (p) { return hasKeySet[p.value]; }).map(function (p) { return { value: p.value, label: p.label }; });

      var prevEmpty = row ? row.querySelector('.llm-choose-provider-wrap') : null;
      if (prevEmpty) prevEmpty.remove();

      if (provOpts.length === 0) {
        provWrap.style.display = 'none';
        modWrap.style.display = 'none';
        if (impLabel) impLabel.style.display = 'none';
        var wrap = document.createElement('div');
        wrap.className = 'llm-choose-provider-wrap';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'llm-choose-provider-btn';
        btn.textContent = 'Выберите LLM провайдера';
        btn.onclick = function () {
          var to = document.getElementById('task-ov');
          if (to) to.classList.remove('open');
          var tc = document.getElementById('task-create-ov');
          if (tc) tc.classList.remove('open');
          var io = document.getElementById('imp-ov');
          if (io) io.classList.remove('open');
          if (typeof window.openProfilePanel === 'function') window.openProfilePanel('llm_keys');
        };
        wrap.appendChild(btn);
        if (row) row.insertBefore(wrap, provWrap);
        return;
      }

      provWrap.style.display = '';
      modWrap.style.display = '';
      if (impLabel) impLabel.style.display = '';

      provSel.innerHTML = '';
      provOpts.forEach(function (p) {
        var o = document.createElement('option');
        o.value = p.value;
        o.textContent = p.label;
        provSel.appendChild(o);
      });

      var saved = {};
      try {
        var raw = localStorage.getItem(storageKey);
        if (raw) saved = JSON.parse(raw) || {};
      } catch (e) { }
      var model = saved.model || '';
      var provider = saved.provider || 'anthropic';
      if (provOpts.some(function (p) { return p.value === provider; })) {
        provSel.value = provider;
      } else {
        provSel.value = provOpts[0].value;
        provider = provOpts[0].value;
      }

      var loadModelsPlain = function () {
        if (!provSel.value) { modSel.innerHTML = ''; modSel.disabled = true; return; }
        modSel.innerHTML = '<option value="">Загрузка...</option>';
        modSel.disabled = true;
        apiFetch('/api/llm/models?provider=' + encodeURIComponent(provSel.value)).catch(function () { return { models: [] }; }).then(function (res) {
          var models = Array.isArray(res && res.models) ? res.models : [];
          modSel.innerHTML = models.map(function (m) { return '<option value="' + String(m).replace(/"/g, '&quot;') + '">' + String(m).replace(/</g, '&lt;') + '</option>'; }).join('');
          if (model && models.indexOf(model) >= 0) modSel.value = model;
          else if (models.length) modSel.value = models[0];
          modSel.disabled = models.length === 0;
          saveToStorage();
          if (typeof pkDropdownInit === 'function') pkDropdownInit(row || document);
        });
      };
      loadModelsPlain();
      provSel.onchange = function () {
        saveToStorage();
        modSel.innerHTML = '<option value="">Загрузка...</option>';
        modSel.disabled = true;
        apiFetch('/api/llm/models?provider=' + encodeURIComponent(provSel.value)).catch(function () { return { models: [] }; }).then(function (res) {
          var models = Array.isArray(res && res.models) ? res.models : [];
          modSel.innerHTML = models.map(function (m) { return '<option value="' + String(m).replace(/"/g, '&quot;') + '">' + String(m).replace(/</g, '&lt;') + '</option>'; }).join('');
          if (models.length) modSel.value = models[0];
          modSel.disabled = models.length === 0;
          saveToStorage();
          if (typeof pkDropdownInit === 'function') pkDropdownInit(row || document);
        });
      };
      modSel.onchange = saveToStorage;
      if (typeof pkDropdownInit === 'function') pkDropdownInit(row || document);
    });
  }

  window.initNtLlmSelectors = function () {
    initLlmSelectors('nt-llm-provider', 'nt-llm-model', NT_LLM_STORAGE_KEY);
  };

  window.initTcLlmSelectors = function () {
    initLlmSelectors('tc-llm-provider', 'tc-llm-model', TC_LLM_STORAGE_KEY);
  };

  window.initImpLlmSelectors = function () {
    initLlmSelectors('imp-llm-provider', 'imp-llm-model', IMP_LLM_STORAGE_KEY);
  };

  window.handleNtSendClick = function () {
    const button = document.getElementById('nt-btn');
    if (button && button.classList.contains('stop-state')) {
      if (ntAiAbortController) ntAiAbortController.abort();
      return;
    }
    if (window.sendNewTaskAi) window.sendNewTaskAi();
  };

  window.sendNewTaskAi = async function () {
    const input = document.getElementById('nt-ta');
    const text = input && input.value ? input.value.trim() : '';
    if (!text) return;

    if (!input) return;
    input.value = '';
    input.style.height = 'auto';

    const chatEl = document.getElementById('nt-chat');
    if (chatEl && typeof appendTo === 'function') appendTo('nt-chat', 'user', text);

    if (!ntAiHistory) ntAiHistory = [];
    ntAiHistory.push({ role: 'user', content: text });

    const button = document.getElementById('nt-btn');
    if (button) {
      button.disabled = false;
      button.classList.add('stop-state');
      var icon = button.querySelector('.nt-send-icon');
      if (icon) icon.textContent = '\u25A0';
      button.setAttribute('aria-label', 'Остановить');
    }
    ntAiAbortController = new AbortController();
    if (typeof showTyping === 'function') showTyping('nt-chat');

    try {
      const systemPrompt = TECHLEAD_SYSTEM_PROMPT_BASE.replace(
        '{snapshot_md}',
        ntSnapshotMd || '(Снапшот не загружен)'
      );
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'assistant', content: 'Привет! Я TechLead. Опиши задачу которую нужно добавить.' },
      ].concat(ntAiHistory.filter(function (m) { return m.role !== 'system'; }));

      var provWrap = document.getElementById('nt-llm-provider');
      var modWrap = document.getElementById('nt-llm-model');
      var provSel = provWrap ? provWrap.querySelector('select') : null;
      var modSel = modWrap ? modWrap.querySelector('select') : null;
      var provider = provSel && provSel.value ? provSel.value.trim() : '';
      var model = modSel && modSel.value ? modSel.value.trim() : '';
      var body = {
        purpose: 'new_task',
        project_id: activeProjId || null,
        messages: messages,
        params: { max_tokens: 1400, temperature: 0.2 },
      };
      if (provider) body.provider = provider;
      if (model) body.model = model;

      const response = await apiFetch('/api/llm/chat', {
        method: 'POST',
        body: body,
        signal: ntAiAbortController.signal,
      });

      const reply = (response && response.text) ? String(response.text) : '';
      ntAiHistory.push({ role: 'assistant', content: reply });
      if (typeof hideTyping === 'function') hideTyping('nt-chat');

      const taskMatch = reply.match(/```task\s*([\s\S]*?)```/);
      if (taskMatch) {
        try {
          const raw = taskMatch[1].trim().replace(/'/g, '"');
          const parsed = JSON.parse(raw);
          const priorityMap = { high: 3, mid: 2, medium: 2, low: 1, none: 0 };
          const p = String((parsed.priority || 'mid')).toLowerCase();
          parsed.priority = priorityMap[p] !== undefined ? priorityMap[p] : 2;
          parsed.desc = parsed.descript || parsed.desc || '';
          parsed.depends_on = Array.isArray(parsed.depends_on) ? parsed.depends_on : [];
          pendingTask = parsed;
          const cleanReply = reply.replace(/```task[\s\S]*?```/g, '').trim();
          if (cleanReply && chatEl && typeof appendTo === 'function') {
            appendTo('nt-chat', 'ai', cleanReply);
          }
          if (typeof window.showPreviewFromAi === 'function') window.showPreviewFromAi(pendingTask);
        } catch (e) {
          if (chatEl && typeof appendTo === 'function') appendTo('nt-chat', 'ai', reply);
        }
      } else {
        if (chatEl && typeof appendTo === 'function') appendTo('nt-chat', 'ai', reply);
      }
    } catch (error) {
      if (typeof hideTyping === 'function') hideTyping('nt-chat');
      if (error.name === 'AbortError') {
        if (chatEl && typeof appendTo === 'function') appendTo('nt-chat', 'ai', 'Запрос остановлен.');
      } else {
        const errMsg = (error.body && error.body.error === 'llm_unavailable')
          ? 'LLM недоступна. Проверьте настройки в Профиль → Настройки LLM.'
          : 'Ошибка: ' + (error.message || 'unknown');
        if (chatEl && typeof appendTo === 'function') appendTo('nt-chat', 'ai', errMsg);
      }
    } finally {
      ntAiAbortController = null;
      if (button) {
        button.classList.remove('stop-state');
        var icon = button.querySelector('.nt-send-icon');
        if (icon) icon.textContent = '\u2191';
        button.setAttribute('aria-label', 'Отправить');
        button.disabled = false;
      }
    }
  };

  window.showPreviewFromAi = function (t) {
    pendingTask = t;
    const pvTitle = document.getElementById('pv-title');
    const pvGrid = document.getElementById('pv-grid');
    const pvDesc = document.getElementById('pv-desc');
    const pvDeps = document.getElementById('pv-deps');
    const pv = document.getElementById('task-preview');
    const btnAdd = document.getElementById('btn-add-backlog');
    if (!pv) return;

    if (pvTitle) pvTitle.textContent = t.title || 'Без названия';
    const stC = typeof getStageColorFromProject === 'function' ? getStageColorFromProject(t.stage) : (getStageColor ? getStageColor(t.stage) : '#6B7280');
    const agC = typeof getAgentColor === 'function' ? getAgentColor(t.agent) : '#6B7280';
    if (pvGrid) {
      pvGrid.innerHTML =
        '<div class="pv-chip"><div class="pv-chip-lbl">Этап</div><div class="pv-chip-val" style="color:' + stC + '">' + (t.stage || '—') + '</div></div>' +
        '<div class="pv-chip"><div class="pv-chip-lbl">Приоритет</div><div class="pv-chip-val">' + (t.priority === 3 ? 'High' : t.priority === 2 ? 'Mid' : t.priority === 1 ? 'Low' : '—') + '</div></div>' +
        '<div class="pv-chip"><div class="pv-chip-lbl">Агент</div><div class="pv-chip-val" style="color:' + agC + '">' + (t.agent || '—') + '</div></div>';
    }
    if (pvDesc) pvDesc.textContent = t.desc || t.descript || '';
    if (pvDeps && t.depends_on && t.depends_on.length > 0) {
      const depLabels = t.depends_on.map(function (id) {
        const tid = String(id).replace(/^T-0*/, '');
        const num = parseInt(tid, 10);
        const task = tasks.find(function (x) {
          var pid = x.public_id;
          if (pid != null && Number(pid) === num) return true;
          var sid = 'T-' + String(pid || '').padStart(6, '0');
          return sid === id || sid === String(id);
        });
        return task ? (id + ' "' + (task.title || '') + '"') : id;
      });
      pvDeps.innerHTML = '&#128274; Зависит от: ' + depLabels.join(', ');
      pvDeps.style.display = '';
    } else if (pvDeps) {
      pvDeps.innerHTML = '';
      pvDeps.style.display = 'none';
    }
    pv.classList.add('show');
    if (btnAdd) btnAdd.disabled = false;
    setTimeout(function () { pv.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
  };

  window.confirmTaskFromAi = async function () {
    if (!pendingTask || !activeProjId) return;

    const btn = document.getElementById('btn-add-backlog');
    if (btn) btn.disabled = true;

    try {
      const priority = Number(pendingTask.priority || 2);
      const payload = {
        title: String(pendingTask.title || '').trim() || 'Без названия',
        stage: String(pendingTask.stage || '').trim() || (getCurrentProjectStages()[0] || ''),
        col: 'backlog',
        agent: String(pendingTask.agent || '').trim() || null,
        priority: priority >= 1 && priority <= 4 ? priority : 2,
        descript: String(pendingTask.desc || pendingTask.descript || '').trim() || null,
        deps: null,
      };

      const created = await apiFetch('/projects/' + activeProjId + '/tasks', {
        method: 'POST',
        body: payload,
      });

      const newTaskId = created && created.task && created.task.id ? created.task.id : null;
      const dependsOn = pendingTask.depends_on || [];

      if (newTaskId && dependsOn.length > 0) {
        for (var i = 0; i < dependsOn.length; i++) {
          var depId = dependsOn[i];
          var pubIdNum = parseInt(String(depId).replace(/^T-0*/, ''), 10);
          if (!pubIdNum) continue;
          var depTask = tasks.find(function (x) {
            return x.public_id != null && Number(x.public_id) === pubIdNum;
          });
          if (!depTask || !depTask.raw_id) continue;
          try {
            await apiFetch('/tasks/' + newTaskId + '/dependencies', {
              method: 'POST',
              body: { depends_on_task_id: depTask.raw_id },
            });
          } catch (depErr) {
            if (depErr.body && depErr.body.error === 'cyclic_dependency') {
              showError('Нельзя добавить зависимость: возникает цикл');
            } else {
              showError('Ошибка зависимости: ' + (depErr.message || ''));
            }
          }
        }
      }

      pendingTask = null;
      if (typeof closeNewTask === 'function') closeNewTask();
      await loadTasksForActiveProject();
      render();
      syncColumnEmptyStates();
      updateStageTabs();
      scheduleHeaderRefresh();
      await syncCompletionMode();
      applyTimerFromSnapshot();
      showInfo('Задача добавлена');
    } catch (error) {
      showError('Ошибка: ' + (error.message || 'Task create failed'));
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  window.reviseTask = function () {
    const pv = document.getElementById('task-preview');
    if (pv) pv.classList.remove('show');
    pendingTask = null;
    if (typeof appendTo === 'function') appendTo('nt-chat', 'ai', 'Хорошо, что именно поменять? Этап, агента, приоритет или описание?');
    var ta = document.getElementById('nt-ta');
    if (ta) ta.focus();
  };

  sendNewTask = window.sendNewTaskAi;
  confirmTask = window.confirmTaskFromAi;

  let lastImportParsedData = null;
  let importConfirmReadyAt = 0;

  const LARGE_FILE_LINES = 150;
  let _pendingImportContent = null;
  let _pendingImportCreateNew = true;
  let _pendingImportCurrentProject = null;

  function openImportAnalyzeConfirm(linesCount, isLarge, onContinue) {
    const ov = document.getElementById('import-analyze-confirm-ov');
    const msgEl = document.getElementById('import-analyze-confirm-msg');
    const warnEl = document.getElementById('import-analyze-confirm-warning');
    const cancelBtn = document.getElementById('import-analyze-cancel-btn');
    const continueBtn = document.getElementById('import-analyze-continue-btn');
    if (!ov || !msgEl || !warnEl || !cancelBtn || !continueBtn) return;

    function linesWord(n) {
      if (n % 10 === 1 && n % 100 !== 11) return n + ' строка';
      if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return n + ' строки';
      return n + ' строк';
    }
    msgEl.textContent = 'Будет проанализировано ' + linesWord(linesCount) + '.';
    if (isLarge) {
      warnEl.style.display = '';
      warnEl.textContent = 'Файл большой — расход токенов на анализ будет повышен.';
    } else {
      warnEl.style.display = 'none';
    }

    function close() {
      ov.classList.remove('open');
      cancelBtn.onclick = null;
      continueBtn.onclick = null;
    }

    cancelBtn.onclick = function () {
      close();
    };
    continueBtn.onclick = function () {
      close();
      if (typeof onContinue === 'function') onContinue();
    };
    ov.classList.add('open');
  }

  function closeImportAnalyzeConfirm() {
    const ov = document.getElementById('import-analyze-confirm-ov');
    if (ov) ov.classList.remove('open');
  }

  function buildImportPrompt(content, createNew, currentProject) {
    const projectContext =
      !createNew && currentProject
        ? `
Текущий проект: "${currentProject.name}"
Существующие этапы: ${JSON.stringify(currentProject.stages || [])}
Существующие колонки: backlog, todo, doing, review, done
ВАЖНО: не создавай новых этапов. Используй только существующие.
`
        : '';

    return (
      `Ты — аналитик проектной документации. Перед тобой содержимое Excel-файла с несколькими листами (каждый начинается с "=== Лист: ... ===").

${projectContext}

Изучи все листы. Извлеки ТОЛЬКО задачи — строки которые описывают конкретную работу для реализации.
Игнорируй: матрицы зависимостей, легенды, сводки, служебные таблицы, заголовки разделов, строки-описания формата.
Верни ТОЛЬКО JSON без markdown. Варианты:
1) Массив задач: [{"title":"...","stage":"...","agent":"...","description":"...","priority":1|2|3|4,"hours":число или null,"size":"XS|S|M|L|XL","deps":"id1,id2" или []}]
2) Объект проекта (если есть общая инфа): {"project_name":"...","project_description":"...","project_budget":число или null,"duration_weeks":число или null,"tasks":[...]} — project_budget и duration_weeks извлекай из файла (бюджет, стоимость, срок, недели), если есть.
agent: исполнитель/ответственный из колонок (Assignee, Ответственный, Executor, Developer, Designer и т.п.). Если нет — пустая строка или null.
priority: 1=Low, 2=Medium, 3=High, 4=Critical. hours, size, deps — извлекай из таблицы.

Текст для анализа:
` +
      content
    );
  }

  function tryParseImportJson(text) {
    const raw = (text || '').trim();
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try {
      return JSON.parse(stripped);
    } catch (e) {
      try {
        return JSON.parse(raw);
      } catch (e2) {
        return null;
      }
    }
  }

  function openImportConfirmModal(data) {
    lastImportParsedData = data;
    const typeLabel =
      (data.detected_type || '').toLowerCase() === 'project' ? 'Проект' : 'Список задач';
    const name = data.project_name || 'Импортированный проект';
    const desc = data.project_description || '—';
    const tasksCount = Array.isArray(data.tasks) ? data.tasks.length : Number(data.tasks_count) || 0;
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];

    document.getElementById('import-confirm-type').textContent = 'Тип: ' + typeLabel;
    document.getElementById('import-confirm-name').textContent = 'Название: ' + name;
    document.getElementById('import-confirm-desc').textContent = 'Описание: ' + desc;
    var statsText = 'Задач распознано: ' + tasksCount;
    var agentsFromDoc = Array.isArray(data.tasks)
      ? [...new Set(data.tasks.map(function (t) { return String(t.agent || '').trim(); }).filter(Boolean))].sort()
      : [];
    if (agentsFromDoc.length > 0) {
      statsText += ' • Агенты: ' + agentsFromDoc.join(', ');
    }
    document.getElementById('import-confirm-tasks-count').textContent = statsText;
    const warnEl = document.getElementById('import-confirm-warnings');
    if (warnings.length) {
      warnEl.textContent = 'Предупреждения: ' + warnings.join('; ');
      warnEl.style.display = '';
    } else {
      warnEl.textContent = '';
      warnEl.style.display = 'none';
    }

    var nameInput = document.getElementById('import-confirm-project-name');
    if (nameInput) {
      nameInput.value = name;
    }
    var budgetInput = document.getElementById('import-confirm-budget');
    var weeksInput = document.getElementById('import-confirm-weeks');
    if (budgetInput) budgetInput.value = String(Number(data.project_budget) || 0);
    if (weeksInput) weeksInput.value = String(Number(data.duration_weeks) || 12);

    var taskList = Array.isArray(data.tasks) ? data.tasks : [];
    var uniqueStages = [...new Set(taskList.map(function (t) { return String(t.stage || '').trim(); }).filter(Boolean))].sort();
    var uniqueAgents = [...new Set(taskList.map(function (t) { return String(t.agent || '').trim(); }).filter(Boolean))].filter(function (a) { return a !== 'Без агента'; }).sort();
    var stagePalette = ['#4a9eff', '#a78bfa', '#fb923c', '#f87171', '#4ade80', '#22d3ee', '#f59e0b', '#f472b6'];
    var agentPalette = ['#4a9eff', '#a78bfa', '#fb923c', '#f87171', '#4ade80', '#22d3ee', '#f59e0b', '#f472b6'];

    function renderImportStages(items) {
      var list = document.getElementById('import-confirm-stages');
      if (!list) return;
      list.innerHTML = items.map(function (item, idx) {
        return '<div class="import-confirm-row-item" data-stage-idx="' + idx + '">'
          + '<input class="ps-input" data-field="stage-name" placeholder="Этап" value="' + escapeHtml(item.name || '') + '">'
          + '<input class="ps-input" data-field="stage-budget" type="number" min="0" placeholder="0" value="' + Number(item.budget || 0) + '">'
          + '<input type="color" data-field="stage-color" value="' + (item.color || '#4a9eff') + '" style="width:32px;height:28px;border:1px solid var(--bd);border-radius:6px;padding:2px;" title="Цвет">'
          + '<button type="button" class="ps-stage-remove" data-action="remove-stage" title="Удалить">&times;</button></div>';
      }).join('');
      list.querySelectorAll('[data-action="remove-stage"]').forEach(function (btn) {
        btn.onclick = function () {
          var row = btn.closest('.import-confirm-row-item');
          var idx = parseInt(row.getAttribute('data-stage-idx'), 10);
          _importConfirmStages.splice(idx, 1);
          renderImportStages(_importConfirmStages);
        };
      });
    }
    function renderImportAgents(items) {
      var list = document.getElementById('import-confirm-agents');
      if (!list) return;
      list.innerHTML = items.map(function (item, idx) {
        return '<div class="import-confirm-agent-row" data-agent-idx="' + idx + '">'
          + '<input class="ps-input" data-field="agent-name" placeholder="Имя" value="' + escapeHtml(item.name || '') + '">'
          + '<select class="ps-input" data-field="agent-type"><option value="ai"' + (item.type === 'human' ? '' : ' selected') + '>AI</option><option value="human"' + (item.type === 'human' ? ' selected' : '') + '>Human</option></select>'
          + '<input type="color" data-field="agent-color" value="' + (item.color || '#6B7280') + '" style="width:40px;height:40px;border:1px solid var(--bd);border-radius:10px;background:var(--sf2);padding:4px;">'
          + '<button type="button" class="ps-stage-remove" data-action="remove-agent" title="Удалить">&times;</button></div>';
      }).join('');
      list.querySelectorAll('[data-action="remove-agent"]').forEach(function (btn) {
        btn.onclick = function () {
          var row = btn.closest('.import-confirm-agent-row');
          var idx = parseInt(row.getAttribute('data-agent-idx'), 10);
          _importConfirmAgents.splice(idx, 1);
          renderImportAgents(_importConfirmAgents);
        };
      });
    }

    var _importConfirmStages = uniqueStages.length > 0
      ? [{ name: NO_STAGE, budget: 0, color: NO_STAGE_COLOR }].concat(
        uniqueStages
          .filter(function (s) { return String(s || '').trim().toLowerCase() !== NO_STAGE.toLowerCase(); })
          .map(function (s, i) { return { name: s, budget: 0, color: stagePalette[(i + 1) % stagePalette.length] }; })
      )
      : [{ name: NO_STAGE, budget: 0, color: NO_STAGE_COLOR }];
    var _importConfirmAgents = [{ name: 'Без агента', type: 'ai', color: '#6B7280' }].concat(
      uniqueAgents.map(function (a, i) { return { name: a, type: 'ai', color: agentPalette[i % agentPalette.length] }; })
    );
    renderImportStages(_importConfirmStages);
    renderImportAgents(_importConfirmAgents);

    var addStageBtn = document.getElementById('import-confirm-add-stage');
    var addAgentBtn = document.getElementById('import-confirm-add-agent');
    if (addStageBtn) {
      addStageBtn.onclick = function () {
        _importConfirmStages.push({ name: '', budget: 0, color: stagePalette[_importConfirmStages.length % stagePalette.length] });
        renderImportStages(_importConfirmStages);
      };
    }
    if (addAgentBtn) {
      addAgentBtn.onclick = function () {
        _importConfirmAgents.push({ name: '', type: 'ai', color: agentPalette[(_importConfirmAgents.length - 1) % agentPalette.length] });
        renderImportAgents(_importConfirmAgents);
      };
    }

    var responsibleSel = document.getElementById('import-confirm-responsible');
    if (responsibleSel) {
      responsibleSel.innerHTML = '<option value="">—</option>';
      apiFetch('/api/assignable-users').then(function (res) {
        var users = Array.isArray(res && res.users) ? res.users : [];
        users.forEach(function (u) {
          var opt = document.createElement('option');
          opt.value = u.id || '';
          opt.textContent = u.email || '';
          responsibleSel.appendChild(opt);
        });
        if (typeof pkDropdownInit === 'function') pkDropdownInit(document.getElementById('import-confirm-ov'));
      }).catch(function () { });
    }

    var newOpts = document.getElementById('import-confirm-new-opts');
    var currentOpts = document.getElementById('import-confirm-current-opts');
    var stageSelect = document.getElementById('import-confirm-default-stage');
    var stages = typeof getCurrentProjectStages === 'function' ? getCurrentProjectStages() : [];
    if (stageSelect) {
      stageSelect.innerHTML = stages.map(function (s) {
        return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>';
      }).join('');
      if (stages.length > 0 && !stageSelect.value) stageSelect.value = stages[0];
    }
    function toggleDestOpts() {
      var destNew = document.getElementById('import-dest-new');
      if (newOpts) newOpts.style.display = destNew && destNew.checked ? '' : 'none';
      if (currentOpts) currentOpts.style.display = destNew && !destNew.checked ? '' : 'none';
    }
    toggleDestOpts();
    var destNew = document.getElementById('import-dest-new');
    var destCurrent = document.getElementById('import-dest-current');
    if (destNew) destNew.onchange = toggleDestOpts;
    if (destCurrent) destCurrent.onchange = toggleDestOpts;

    const currentName =
      typeof getActiveProject === 'function' && getActiveProject()
        ? getActiveProject().name || 'Текущий'
        : 'Текущий';
    document.getElementById('import-dest-current-name').textContent = currentName;
    var checkEl = document.getElementById('import-confirm-understand');
    var submitBtn = document.getElementById('import-confirm-submit-btn');
    if (checkEl && submitBtn) {
      checkEl.checked = false;
      submitBtn.disabled = true;
      checkEl.onchange = function () {
        submitBtn.disabled = !checkEl.checked;
      };
    }
    const ov = document.getElementById('import-confirm-ov');
    if (ov) {
      ov.classList.add('open');
    }
    const parseBtn = document.getElementById('imp-parse-btn');
    if (parseBtn) parseBtn.style.display = 'none';
  }

  function closeImportConfirm() {
    const ov = document.getElementById('import-confirm-ov');
    if (ov) {
      ov.classList.remove('open');
    }
    const checkEl = document.getElementById('import-confirm-understand');
    if (checkEl) {
      checkEl.checked = false;
      checkEl.onchange = null;
    }
    const destNew = document.getElementById('import-dest-new');
    const destCurrent = document.getElementById('import-dest-current');
    if (destNew) destNew.onchange = null;
    if (destCurrent) destCurrent.onchange = null;
    const parseBtn = document.getElementById('imp-parse-btn');
    if (parseBtn) parseBtn.style.display = '';
    lastImportParsedData = null;
  }

  function openImportSuccessModal(opts) {
    const ov = document.getElementById('import-success-ov');
    const nameWrap = document.getElementById('import-success-name-wrap');
    const nameInput = document.getElementById('import-success-project-name');
    const saveBtn = document.getElementById('import-success-save-name-btn');
    const doneBtn = document.getElementById('import-success-done-btn');
    const statsEl = document.getElementById('import-success-stats');
    const subEl = document.getElementById('import-success-sub');
    if (!ov || !nameWrap || !nameInput || !saveBtn || !doneBtn || !statsEl || !subEl) return;

    const createNew = opts.createNew === true;
    const projectId = opts.projectId || null;
    const projectName = opts.projectName || 'Импортированный проект';
    const tasksCreated = opts.tasksCreated || 0;
    const stagesList = Array.isArray(opts.stagesList) ? opts.stagesList : [];
    const fileName = opts.fileName || null;

    if (createNew) {
      nameWrap.classList.remove('hidden');
      nameInput.value = projectName;
    } else {
      nameWrap.classList.add('hidden');
    }

    subEl.textContent = 'Задачи добавлены в проект';
    let statsHtml = 'Задач создано: ' + tasksCreated;
    if (stagesList.length > 0) {
      statsHtml += '<br>Этапы: ' + stagesList.join(', ');
    }
    if (fileName) {
      statsHtml += '<br>Файл: ' + String(fileName).replace(/</g, '&lt;');
    }
    statsEl.innerHTML = statsHtml;

    function close() {
      ov.classList.remove('open');
      saveBtn.onclick = null;
      doneBtn.onclick = null;
    }

    saveBtn.onclick = async function () {
      const name = (nameInput.value || '').trim() || 'Импортированный проект';
      if (!projectId) return;
      try {
        saveBtn.disabled = true;
        await apiFetch('/projects/' + projectId, {
          method: 'PATCH',
          body: { name: name },
        });
        await loadProjectsAndActive();
        if (typeof renderProjList === 'function') renderProjList();
        nameInput.value = name;
      } catch (e) {
        showError('Не удалось сохранить название: ' + (e.message || e));
      } finally {
        saveBtn.disabled = false;
      }
    };

    doneBtn.onclick = function () {
      close();
    };

    ov.classList.add('open');
  }

  function closeImportSuccess() {
    const ov = document.getElementById('import-success-ov');
    if (ov) ov.classList.remove('open');
  }

  async function logImportEvent(event, projectId, payload) {
    try {
      await apiFetch('/api/import/events', {
        method: 'POST',
        body: {
          event: event,
          project_id: projectId || null,
          payload: payload || {},
        },
      });
    } catch (e) {
      // ignore
    }
  }

  async function executeImport(parsedData, createNew, currentProjectId, opts) {
    opts = opts || {};
    const projectName = opts.projectName || parsedData.project_name || 'Импортированный проект';
    const defaultStage = opts.defaultStage || '';

    let targetProjectId = currentProjectId || null;

    if (createNew) {
      const name = projectName;
      var stageSettings = opts.stageSettings;
      var agentSettings = opts.agentSettings;
      var budgetTotal = opts.budgetTotal != null ? opts.budgetTotal : 0;
      var durationWeeks = opts.durationWeeks != null ? opts.durationWeeks : 12;
      var responsibleUserId = opts.responsibleUserId || null;
      if (!stageSettings || !Array.isArray(stageSettings) || stageSettings.length === 0) {
        const taskListForStages = Array.isArray(parsedData.tasks) ? parsedData.tasks : [];
        const uniqueStages = [...new Set(
          taskListForStages.map(function (t) { return String(t.stage || '').trim(); }).filter(function (s) { return s; })
        )];
        var palette = ['#4a9eff', '#a78bfa', '#fb923c', '#f87171', '#4ade80', '#22d3ee', '#f59e0b', '#f472b6'];
        stageSettings = uniqueStages.length > 0
          ? uniqueStages.map(function (s, idx) { return { name: s, budget: 0, color: palette[idx % palette.length] }; })
          : [{ name: 'A', budget: 0, color: '#4a9eff' }];
      }
      if (!agentSettings || !Array.isArray(agentSettings) || agentSettings.length === 0) {
        const taskListForAgents = Array.isArray(parsedData.tasks) ? parsedData.tasks : [];
        const uniqueAgents = [...new Set(
          taskListForAgents.map(function (t) { return String(t.agent || '').trim(); }).filter(function (s) { return s; })
        )].filter(function (a) { return a !== 'Без агента'; });
        var ap = ['#4a9eff', '#a78bfa', '#fb923c', '#f87171', '#4ade80', '#22d3ee', '#f59e0b', '#f472b6'];
        agentSettings = [{ name: 'Без агента', type: 'ai', color: '#6B7280' }].concat(
          uniqueAgents.map(function (a, idx) { return { name: a, type: 'ai', color: ap[idx % ap.length] }; })
        );
      }
      const stages = stageSettings.map(function (s) { return s.name; });
      var createBody = {
        name: name,
        budget_total: budgetTotal,
        duration_weeks: durationWeeks,
        stages: stages,
        stage_settings: stageSettings,
        agent_settings: agentSettings,
      };
      if (responsibleUserId) createBody.responsible_user_id = responsibleUserId;
      const created = await apiFetch('/projects', {
        method: 'POST',
        body: createBody,
      });
      if (created && created.project && created.project.id) {
        targetProjectId = created.project.id;
        await apiFetch('/projects/activate', {
          method: 'POST',
          body: { project_id: targetProjectId },
        });
        if (typeof activeProjId !== 'undefined') {
          activeProjId = targetProjectId;
        }
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('mossb_active_proj', targetProjectId);
        }
      }
    }

    await logImportEvent('import_started', targetProjectId, {
      create_new: createNew,
      tasks_count: Array.isArray(parsedData.tasks) ? parsedData.tasks.length : 0,
    });

    const taskList = Array.isArray(parsedData.tasks) ? parsedData.tasks : [];
    var projectStages = createNew
      ? [...new Set(taskList.map(function (t) { return String(t.stage || '').trim(); }).filter(Boolean))]
      : getCurrentProjectStages();
    var firstStage = projectStages[0] || '';
    var fallbackStage = defaultStage && projectStages.indexOf(defaultStage) >= 0 ? defaultStage : firstStage;

    const apiCol = function (c) {
      if (c === 'inprogress' || c === 'in_progress') {
        return 'doing';
      }
      return c || 'backlog';
    };
    const priorityNum = function (p) {
      if (p == null) return 2;
      if (Number.isInteger(p) && p >= 1 && p <= 4) return p;
      const s = String(p).toLowerCase().trim().replace(/\s+/g, ' ');
      const map = {
        low: 1, mid: 2, medium: 2, high: 3, critical: 4,
        низкий: 1, средний: 2, высокий: 3, критический: 4,
        'низкий приоритет': 1, 'средний приоритет': 2, 'высокий приоритет': 3, 'критический приоритет': 4,
      };
      return map[s] != null ? map[s] : (map[s.split(/\s/)[0]] != null ? map[s.split(/\s/)[0]] : 2);
    };
    // hours — затраченное/планируемое время; size — объём (XS/S/M/L/XL), отдельный параметр; не конвертируем size в hours
    var resolveHours = function (task) {
      if (task.hours != null && Number.isFinite(task.hours) && task.hours >= 0) return task.hours;
      return null;
    };
    var resolveDeps = function (task) {
      if (!task.deps) return null;
      if (typeof task.deps === 'object' && task.deps !== null && !Array.isArray(task.deps)) return task.deps;
      if (Array.isArray(task.deps)) {
        var ids = task.deps.filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return String(x).trim(); });
        return ids.length ? { blocks: ids } : null;
      }
      if (typeof task.deps === 'string' && task.deps.trim()) {
        var ids = task.deps.split(/[,\s]+/).map(function (s) { return s.trim(); }).filter(Boolean);
        return ids.length ? { blocks: ids } : null;
      }
      return null;
    };
    for (let i = 0; i < taskList.length; i++) {
      const t = taskList[i];
      var rawStage = (t.stage && String(t.stage).trim()) || '';
      var taskStage = (rawStage && projectStages.some(function (s) { return String(s || '').toLowerCase() === rawStage.toLowerCase(); }))
        ? (projectStages.find(function (s) { return String(s || '').toLowerCase() === rawStage.toLowerCase(); }) || rawStage)
        : fallbackStage;
      const payload = {
        title: t.title || 'Без названия',
        col: apiCol(t.col),
        stage: taskStage,
        track: t.track || null,
        agent: t.agent || null,
        priority: priorityNum(t.priority),
        hours: resolveHours(t),
        size: (function () {
          var s = (t.size && String(t.size).trim().toUpperCase()) || '';
          return s && ['XS', 'S', 'M', 'L', 'XL'].indexOf(s) >= 0 ? s : null;
        })(),
        descript: (t.descript || t.description || '').substring(0, 5000) || null,
        notes: (t.notes && String(t.notes).trim()) || null,
        deps: resolveDeps(t),
      };
      await apiFetch('/projects/' + targetProjectId + '/tasks', {
        method: 'POST',
        body: payload,
      });
    }

    if (targetProjectId && !createNew) {
      var existingProject = projects.find(function (p) { return p.id === targetProjectId; });
      var existingAgentNames = (existingProject && Array.isArray(existingProject.agentSettings))
        ? existingProject.agentSettings.map(function (a) { return (a.name || '').toLowerCase(); })
        : [];
      var importAgentNames = [...new Set(
        taskList.map(function (t) { return String(t.agent || '').trim(); }).filter(Boolean)
      )];
      var newAgents = importAgentNames.filter(function (a) {
        return existingAgentNames.indexOf(a.toLowerCase()) < 0;
      });
      if (newAgents.length > 0 && existingProject) {
        var palette = ['#4a9eff', '#a78bfa', '#fb923c', '#f87171', '#4ade80', '#22d3ee', '#f59e0b', '#f472b6', '#6B7280'];
        var mergedAgentSettings = (existingProject.agentSettings || []).slice();
        newAgents.forEach(function (a, idx) {
          mergedAgentSettings.push({ name: a, type: 'ai', color: palette[idx % palette.length] });
        });
        try {
          var projRes = await apiFetch('/projects/' + targetProjectId);
          var proj = projRes && projRes.project ? projRes.project : existingProject;
          await apiFetch('/projects/' + targetProjectId, {
            method: 'PATCH',
            body: {
              name: proj.name,
              duration_weeks: Number(proj.duration_weeks || 0),
              budget_total: Number(proj.budget_total || 0),
              stages: Array.isArray(proj.stages) ? proj.stages : [],
              stage_settings: Array.isArray(proj.stage_settings) ? proj.stage_settings : [],
              agent_settings: mergedAgentSettings,
            },
          });
          await loadProjectsAndActive();
        } catch (e) {
          showInfo('Импорт задач выполнен. Не удалось обновить агентов: ' + (e.message || e));
        }
      }
    }

    if (targetProjectId) {
      try {
        await apiFetch('/projects/' + targetProjectId + '/recalculate-duration', { method: 'POST' });
      } catch (_) { /* ignore */ }
    }

    await logImportEvent('import_completed', targetProjectId, {
      tasks_count: taskList.length,
    });
  }

  async function submitImportConfirm() {
    const data = lastImportParsedData;
    if (!data || !Array.isArray(data.tasks) || data.tasks.length === 0) {
      closeImportConfirm();
      if (typeof closeImport === 'function') {
        closeImport();
      }
      return;
    }
    const destNew = document.getElementById('import-dest-new');
    const createNew = destNew && destNew.checked;
    const currentId = typeof activeProjId !== 'undefined' ? activeProjId : null;
    if (!createNew && !currentId) {
      showError('Выберите проект или создайте новый');
      return;
    }
    var projectName = (data.project_name || '').trim() || 'Импортированный проект';
    var nameInput = document.getElementById('import-confirm-project-name');
    if (createNew && nameInput) {
      projectName = (nameInput.value || '').trim() || 'Импортированный проект';
    }
    var defaultStage = NO_STAGE;
    var stageSelect = document.getElementById('import-confirm-default-stage');
    if (!createNew && stageSelect) {
      defaultStage = String(stageSelect.value || '').trim() || NO_STAGE;
    }
    var importOpts = { projectName: projectName, defaultStage: defaultStage };
    if (createNew) {
      var stagesList = document.getElementById('import-confirm-stages');
      var stageSettings = [];
      if (stagesList) {
        stagesList.querySelectorAll('.import-confirm-row-item').forEach(function (row) {
          var n = (row.querySelector('[data-field="stage-name"]') || {}).value || '';
          var b = parseInt((row.querySelector('[data-field="stage-budget"]') || {}).value, 10) || 0;
          var c = (row.querySelector('[data-field="stage-color"]') || {}).value || '#4a9eff';
          if (n.trim()) stageSettings.push({ name: n.trim(), budget: Math.max(0, b), color: c });
        });
      }
      if (stageSettings.length === 0) stageSettings = [{ name: NO_STAGE, budget: 0, color: NO_STAGE_COLOR }];
      var agentsList = document.getElementById('import-confirm-agents');
      var agentSettings = [];
      if (agentsList) {
        agentsList.querySelectorAll('.import-confirm-agent-row').forEach(function (row) {
          var n = (row.querySelector('[data-field="agent-name"]') || {}).value || '';
          var t = (row.querySelector('[data-field="agent-type"]') || {}).value || 'ai';
          var c = (row.querySelector('[data-field="agent-color"]') || {}).value || '#6B7280';
          if (n.trim()) agentSettings.push({ name: n.trim(), type: t, color: c });
        });
      }
      if (agentSettings.length === 0) agentSettings = [{ name: 'Без агента', type: 'ai', color: '#6B7280' }];
      var budgetEl = document.getElementById('import-confirm-budget');
      var weeksEl = document.getElementById('import-confirm-weeks');
      var respEl = document.getElementById('import-confirm-responsible');
      importOpts.stageSettings = stageSettings;
      importOpts.agentSettings = agentSettings;
      importOpts.budgetTotal = Math.max(0, parseInt(budgetEl && budgetEl.value, 10) || 0);
      importOpts.durationWeeks = Math.max(0, parseInt(weeksEl && weeksEl.value, 10) || 12);
      importOpts.responsibleUserId = (respEl && respEl.value) ? respEl.value : null;
    }
    const btn = document.getElementById('import-confirm-submit-btn');
    if (btn) {
      btn.disabled = true;
    }
    try {
      await executeImport(data, createNew, currentId, importOpts);
      closeImportConfirm();
      if (typeof closeImport === 'function') {
        closeImport();
      }
      await loadTasksForActiveProject();
      await loadProjectsAndActive();
      if (typeof renderProjList === 'function') renderProjList();
      render();
      syncColumnEmptyStates();
      updateStageTabs();
      scheduleHeaderRefresh();
      await syncCompletionMode();
      applyTimerFromSnapshot();
      showInfo('Импорт завершён: добавлено задач ' + data.tasks.length);
    } catch (err) {
      await logImportEvent('import_failed', null, {
        error: err.message || 'unknown',
        tasks_count: data.tasks.length,
      });
      var msg = err.message || err;
      if (msg === 'schema_outdated' || (err.body && err.body.error === 'schema_outdated')) {
        showError('Схема БД устарела. Выполните миграцию: npm run db:migrate');
      } else {
        showError('Импорт не удался: ' + msg);
      }
    } finally {
      if (btn) {
        btn.disabled = false;
      }
    }
  }

  if (typeof window !== 'undefined') {
    window.closeImportConfirm = closeImportConfirm;
    window.submitImportConfirm = submitImportConfirm;
    window.closeImportAnalyzeConfirm = closeImportAnalyzeConfirm;
    window.closeImportSuccess = closeImportSuccess;
  }

  runImportParse = async function () {
    const isTextMode = document.getElementById('itab-text').classList.contains('active');
    let content = '';
    let fileName = null;

    if (isTextMode) {
      content = document.getElementById('imp-text-input').value.trim();
      if (!content) {
        document.getElementById('imp-status').textContent = 'Введите описание проекта';
        return;
      }
    } else {
      if (!importRawData) {
        document.getElementById('imp-status').textContent = 'Сначала загрузите файл';
        return;
      }
      content = importRawData;
      const fileInput = document.getElementById('imp-file-input');
      if (fileInput && fileInput.files && fileInput.files[0]) {
        fileName = fileInput.files[0].name;
      }
    }

    const createNewCheck = document.getElementById('import-create-new-project');
    const createNew = createNewCheck ? createNewCheck.checked : true;
    let currentProject = null;
    if (!createNew && activeProjId) {
      try {
        const p = await apiFetch('/projects/' + activeProjId);
        currentProject = p && p.project ? p.project : null;
      } catch (e) {
        currentProject = null;
      }
    }
    if (!currentProject && typeof getActiveProject === 'function' && getActiveProject()) {
      currentProject = getActiveProject();
    }

    const linesCount = content.split(/\r?\n/).length;
    const isLarge = linesCount > LARGE_FILE_LINES;

    _pendingImportContent = content;
    _pendingImportCreateNew = createNew;
    _pendingImportCurrentProject = currentProject;

    openImportAnalyzeConfirm(linesCount, isLarge, function runAfterConfirm() {
      const content = _pendingImportContent;
      const createNew = _pendingImportCreateNew;
      const currentProject = _pendingImportCurrentProject;
      if (!content) return;

      const parseButton = document.getElementById('imp-parse-btn');
      const progressWrap = document.getElementById('imp-progress-wrap');
      const progressFill = document.getElementById('imp-progress-fill');
      if (progressWrap) progressWrap.style.display = '';
      if (progressFill) progressFill.style.width = '0%';

      if (isLarge) {
        (async function doAsyncImport() {
          parseButton.textContent = '⏳ Импорт в фоне...';
          parseButton.disabled = true;
          document.getElementById('imp-status').textContent = 'Запуск импорта...';
          document.getElementById('imp-status').style.color = '';
          let targetProjectId = null;
          if (createNew) {
            try {
              const created = await apiFetch('/projects', {
                method: 'POST',
                body: { name: 'Импортированный проект', budget_total: 0, duration_weeks: 12, stages: [] },
              });
              if (created && created.project && created.project.id) {
                targetProjectId = created.project.id;
                await apiFetch('/projects/activate', { method: 'POST', body: { project_id: targetProjectId } });
                if (typeof activeProjId !== 'undefined') { activeProjId = targetProjectId; }
                if (typeof localStorage !== 'undefined') { localStorage.setItem('mossb_active_proj', targetProjectId); }
                await loadProjectsAndActive();
                if (typeof renderProjList === 'function') renderProjList();
              }
            } catch (e) {
              document.getElementById('imp-status').textContent = 'Ошибка создания проекта: ' + (e.message || e);
              document.getElementById('imp-status').style.color = 'var(--red)';
              parseButton.disabled = false;
              return;
            }
          } else {
            targetProjectId = (currentProject && currentProject.id) ? currentProject.id : (typeof activeProjId !== 'undefined' ? activeProjId : null);
          }
          if (!targetProjectId) {
            document.getElementById('imp-status').textContent = 'Выберите проект или создайте новый';
            parseButton.disabled = false;
            return;
          }
          var provWrap = document.getElementById('imp-llm-provider');
          var modWrap = document.getElementById('imp-llm-model');
          var provSel = provWrap && (provWrap.tagName === 'SELECT' ? provWrap : provWrap.querySelector('select'));
          var modSel = modWrap && (modWrap.tagName === 'SELECT' ? modWrap : modWrap.querySelector('select'));
          var provider = provSel && provSel.value ? provSel.value.trim() : '';
          var model = modSel && modSel.value ? modSel.value.trim() : '';
          const body = { project_id: targetProjectId, content: content, file_name: fileName || null };
          if (provider) body.provider = provider;
          if (model) body.model = model;
          let jobId;
          try {
            const resp = await apiFetch('/import/async', { method: 'POST', body: body });
            jobId = resp.job_id;
          } catch (e) {
            document.getElementById('imp-status').textContent = 'Ошибка запуска: ' + (e.message || e);
            document.getElementById('imp-status').style.color = 'var(--red)';
            parseButton.disabled = false;
            return;
          }
          const POLL_MS = 3000;
          const TIMEOUT_MS = 5 * 60 * 1000;
          const started = Date.now();
          const poll = async function () {
            if (Date.now() - started > TIMEOUT_MS) {
              document.getElementById('imp-status').textContent = 'Таймаут импорта (5 мин)';
              document.getElementById('imp-status').style.color = 'var(--red)';
              parseButton.textContent = 'Готово';
              parseButton.disabled = false;
              return;
            }
            try {
              const statusRes = await apiFetch('/import/status/' + jobId);
              const total = statusRes.total_chunks || 0;
              const processed = statusRes.processed_chunks || 0;
              if (statusRes.status === 'processing' || statusRes.status === 'pending') {
                document.getElementById('imp-status').textContent = 'Обработка... чанк ' + processed + ' из ' + (total || '?');
                if (progressFill) progressFill.style.width = (total ? (100 * processed / total) : 10) + '%';
                setTimeout(poll, POLL_MS);
                return;
              }
              if (statusRes.status === 'done') {
                if (progressFill) progressFill.style.width = '100%';
                document.getElementById('imp-status').textContent = '';
                parseButton.textContent = 'Готово';
                parseButton.disabled = false;
                if (progressWrap) progressWrap.style.display = 'none';
                if (typeof closeImport === 'function') closeImport();
                await loadProjectsAndActive();
                await loadTasksForActiveProject();
                render();
                await loadProjectsAndActive();
                if (typeof renderProjList === 'function') renderProjList();
                if (createNew && typeof openProjSettings === 'function') {
                  await openProjSettings(targetProjectId);
                  var importTitleEl = document.querySelector('#ps-ov .ps-title');
                  if (importTitleEl) importTitleEl.textContent = 'Настройте новый проект';
                }
                if (typeof syncColumnEmptyStates === 'function') syncColumnEmptyStates();
                if (typeof updateStageTabs === 'function') updateStageTabs();
                if (typeof scheduleHeaderRefresh === 'function') scheduleHeaderRefresh();
                if (typeof syncCompletionMode === 'function') await syncCompletionMode();
                if (typeof applyTimerFromSnapshot === 'function') applyTimerFromSnapshot();
                const stagesList = [...new Set((typeof tasks !== 'undefined' ? tasks : []).map(function (t) { return t.stage; }).filter(Boolean))].sort();
                const proj = (typeof projects !== 'undefined' ? projects : []).find(function (p) { return p.id === targetProjectId; });
                const projectName = (proj && proj.name) ? proj.name : 'Импортированный проект';
                openImportSuccessModal({
                  createNew: createNew,
                  projectId: targetProjectId,
                  projectName: projectName,
                  tasksCreated: statusRes.tasks_created || 0,
                  stagesList: stagesList,
                  fileName: fileName || null,
                });
                return;
              }
              if (statusRes.status === 'failed') {
                document.getElementById('imp-status').textContent = 'Ошибка: ' + (statusRes.error || 'неизвестная');
                document.getElementById('imp-status').style.color = 'var(--red)';
                parseButton.textContent = 'Готово';
                parseButton.disabled = false;
                return;
              }
            } catch (e) {
              document.getElementById('imp-status').textContent = 'Ошибка проверки статуса: ' + (e.message || e);
              document.getElementById('imp-status').style.color = 'var(--red)';
              parseButton.disabled = false;
              return;
            }
            setTimeout(poll, POLL_MS);
          };
          poll();
        })();
        return;
      }

      parseButton.textContent = '⏳ Анализирую...';
      parseButton.disabled = true;
      document.getElementById('imp-status').textContent = 'Распознавание через LLM...';
      document.getElementById('imp-status').style.color = '';
      let importProgressPct = 0;
      const PROGRESS_CAP = 85;
      const PROGRESS_TICK_MS = 450;
      const PROGRESS_DURATION_MS = 14000;
      const progressStep = (PROGRESS_CAP / (PROGRESS_DURATION_MS / PROGRESS_TICK_MS));
      let importProgressIntervalId = setInterval(function () {
        importProgressPct = Math.min(PROGRESS_CAP, importProgressPct + progressStep);
        if (progressFill) progressFill.style.width = importProgressPct.toFixed(1) + '%';
      }, PROGRESS_TICK_MS);

      (async function doActualImportParse() {
        try {
          var provWrap = document.getElementById('imp-llm-provider');
          var modWrap = document.getElementById('imp-llm-model');
          var provSel = provWrap && (provWrap.tagName === 'SELECT' ? provWrap : provWrap.querySelector('select'));
          var modSel = modWrap && (modWrap.tagName === 'SELECT' ? modWrap : modWrap.querySelector('select'));
          var provider = provSel && provSel.value ? provSel.value.trim() : '';
          var model = modSel && modSel.value ? modSel.value.trim() : '';
          const prompt = buildImportPrompt(content, createNew, currentProject);
          const linesCount = content.split(/\r?\n/).length;
          const maxTokens = Math.min(32000, Math.max(4000, linesCount * 200));
          var body = {
            purpose: 'import_parse',
            project_id: activeProjId || null,
            messages: [{ role: 'user', content: prompt }],
            params: { max_tokens: maxTokens, temperature: 0.1 },
          };
          if (provider) body.provider = provider;
          if (model) body.model = model;
          const response = await apiFetch('/api/llm/chat', {
            method: 'POST',
            body: body,
          });

          const text = response && response.text ? response.text : '';
          const parsed = tryParseImportJson(text);
          var normalized;
          if (Array.isArray(parsed)) {
            normalized = { detected_type: 'task_list', project_name: null, project_description: null, project_budget: null, duration_weeks: null, tasks: parsed, warnings: [] };
          } else if (parsed && Array.isArray(parsed.tasks)) {
            normalized = parsed;
            if (!normalized.detected_type) normalized.detected_type = 'project';
          } else {
            normalized = null;
          }
          if (!normalized || !Array.isArray(normalized.tasks)) {
            throw new Error('Не удалось разобрать ответ LLM');
          }

          importParsedTasks = normalized.tasks.map(function (t) {
            return {
              id: t.id,
              title: t.title,
              stage: t.stage,
              col: t.col || 'backlog',
              agent: t.agent,
              size: t.size,
              hours: t.hours,
              track: t.track,
              desc: t.descript || t.description,
            };
          });
          if (typeof renderImportPreview === 'function') {
            renderImportPreview(importParsedTasks);
          }
          document.getElementById('imp-confirm-btn').style.display = 'none';
          parseButton.textContent = 'Готово';
          if (importProgressIntervalId != null) {
            clearInterval(importProgressIntervalId);
            importProgressIntervalId = null;
          }
          if (progressFill) progressFill.style.width = '100%';
          setTimeout(function () {
            if (progressWrap) progressWrap.style.display = 'none';
            if (progressFill) progressFill.style.width = '0%';
            document.getElementById('imp-status').textContent = '';
          }, 400);

          openImportConfirmModal(normalized);
        } catch (error) {
          parseButton.textContent = 'Готово';
          if (importProgressIntervalId != null) {
            clearInterval(importProgressIntervalId);
            importProgressIntervalId = null;
          }
          if (progressFill) progressFill.style.width = '100%';
          setTimeout(function () {
            if (progressWrap) progressWrap.style.display = 'none';
            if (progressFill) progressFill.style.width = '0%';
          }, 350);
          const statusEl = document.getElementById('imp-status');
          if (error.body && error.body.error === 'empty_import') {
            const hint = error.body.hint;
            const msg = hint === 'llm_parse_failed'
              ? 'LLM не смогла распознать структуру файла. Попробуй уменьшить файл или описать задачи текстом.'
              : 'Задачи не найдены в файле.';
            statusEl.textContent = msg;
          } else if (error.message === 'llm_unavailable' || (error.body && error.body.error === 'llm_unavailable')) {
            const hint = error.body && error.body.hint;
            let msg = 'LLM временно недоступна. Проверьте ключ Anthropic и доступность api.anthropic.com.';
            if (hint === 'missing_api_key') {
              msg = 'LLM недоступна: не задан API-ключ. Добавьте ключ в Профиль → LLM провайдеры.';
            } else if (hint === 'request_failed') {
              msg = 'Запрос к LLM не выполнен (сеть, таймаут или ошибка провайдера). Проверьте логи сервера и доступ из контейнера к api.anthropic.com.';
            } else if (hint === 'provider_error') {
              msg = 'Anthropic API вернул ошибку (ключ или лимит). Проверьте ключ и квоты в консоли Anthropic.';
            }
            statusEl.textContent = msg;
          } else if (error.message === 'Не удалось разобрать ответ LLM') {
            statusEl.textContent = 'LLM не смогла распознать структуру файла. Попробуй уменьшить файл или описать задачи текстом.';
          } else {
            statusEl.textContent =
              'Ошибка: ' + (error.message || 'Проверьте доступ к LLM');
          }
          document.getElementById('imp-status').style.color = 'var(--red)';
        } finally {
          if (importProgressIntervalId != null) {
            clearInterval(importProgressIntervalId);
            importProgressIntervalId = null;
          }
          if (progressWrap && progressWrap.style.display !== 'none') {
            if (progressFill) progressFill.style.width = '100%';
            setTimeout(function () {
              if (progressWrap) progressWrap.style.display = 'none';
              if (progressFill) progressFill.style.width = '0%';
            }, 300);
          }
          parseButton.disabled = false;
        }
      })();
    });
  };

  confirmImport = function () {
    closeImport();
  };

  toggleTimer = async function () {
    if (!activeProjId) {
      showError('Сначала выберите активный проект');
      return;
    }

    if (projectCompletedMode) {
      openResumeConfirmModal();
      return;
    }

    try {
      let timerResponse;
      if (timerSnapshot.status === 'running') {
        timerResponse = await apiFetch('/timer/stop', { method: 'POST', body: {} });
      } else {
        timerResponse = await apiFetch('/timer/start', { method: 'POST', body: {} });
      }
      if (!applyTimerSnapshotFromApi(timerResponse)) {
        await refreshTimerFromServer();
      }
      await syncCompletionMode();
      applyTimerFromSnapshot();
    } catch (error) {
      showError('Timer action failed: ' + error.message);
    }
  };

  window.ensureNewTaskModalReady = function () {
    fillManualTaskStageOptions();
    resetManualTaskForm();
    setTaskCreateMode('ai');
  };

  function setNewTaskMode(mode) {
    newTaskCreateMode = mode === 'manual' ? 'manual' : 'ai';
    try { localStorage.setItem('pk24_new_task_mode', newTaskCreateMode); } catch (e) { }
    var aiWrap = document.getElementById('new-task-ai-mode');
    var manualWrap = document.getElementById('new-task-manual-mode');
    var btnAi = document.getElementById('nt-mode-ai');
    var btnManual = document.getElementById('nt-mode-manual');
    var sub = document.getElementById('nt-sub');
    if (mode === 'manual') {
      if (aiWrap) aiWrap.classList.add('hide');
      if (manualWrap) manualWrap.classList.add('show');
      if (btnAi) btnAi.classList.remove('active');
      if (btnManual) btnManual.classList.add('active');
      if (sub) sub.textContent = 'Заполните поля вручную';
    } else {
      if (aiWrap) aiWrap.classList.remove('hide');
      if (manualWrap) manualWrap.classList.remove('show');
      if (btnAi) btnAi.classList.add('active');
      if (btnManual) btnManual.classList.remove('active');
      if (sub) sub.textContent = 'TechLead поможет сформулировать задачу';
    }
  }

  window.openTaskCreate = function (col) {
    newTaskCol = col || 'backlog';
    const ov = document.getElementById('task-create-ov');
    if (!ov) return;

    var savedMode = 'ai';
    try { savedMode = localStorage.getItem('pk24_new_task_mode') || 'ai'; } catch (e) { }
    setTaskCreateMode(savedMode);

    var COLS = typeof window.getProjectColumns === 'function' ? window.getProjectColumns() : [
      { id: 'backlog', label: 'Backlog' }, { id: 'todo', label: 'To Do' },
      { id: 'inprogress', label: 'In Progress' }, { id: 'review', label: 'Review' }, { id: 'done', label: 'Done' }
    ];
    var meta = document.getElementById('ntm-meta');
    if (meta) {
      meta.innerHTML =
        '<div class="mc"><div class="mc-lbl">Статус</div><select class="status-sel" id="ntm-col">' +
        COLS.map(function (c) { return '<option value="' + c.id + '"' + (c.id === newTaskCol ? ' selected' : '') + '>' + c.label + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="mc"><div class="mc-lbl">Этап</div><select class="status-sel" id="ntm-stage"></select></div>' +
        '<div class="mc"><div class="mc-lbl">Приоритет</div><select class="status-sel" id="ntm-priority"></select></div>' +
        '<div class="mc"><div class="mc-lbl">Агент</div><select class="status-sel" id="ntm-agent"></select></div>' +
        '<div class="mc"><div class="mc-lbl">Размер</div><select class="status-sel" id="ntm-size"></select></div>' +
        '<div class="mc"><div class="mc-lbl">Часы</div><input type="number" id="ntm-hours" class="ntm-hours" value="8" min="1" max="999" placeholder="ч" inputmode="numeric"></div>' +
        '<select id="ntm-track" style="display:none" aria-hidden="true"></select>';
      ensureNtmHiddenOptions();
      fillManualTaskStageOptions();
      resetManualTaskForm();
      var colEl = document.getElementById('ntm-col');
      if (colEl) colEl.value = newTaskCol;
      var agentOpts = getNtmAgentOptions();
      var agentSel = document.getElementById('ntm-agent');
      if (agentSel) {
        var currentOpts = Array.from(agentSel.options).map(function (o) { return o.value; });
        var needRefresh = currentOpts.length !== agentOpts.length || agentOpts.some(function (a, i) { return (currentOpts[i] || '') !== a; });
        if (needRefresh) {
          agentSel.innerHTML = '';
          agentOpts.forEach(function (a) {
            var o = document.createElement('option');
            o.value = a;
            o.textContent = a;
            agentSel.appendChild(o);
          });
        }
      }
      if (typeof window.pkDropdownInit === 'function') window.pkDropdownInit(meta);
      applyFieldColors(ov);
    }

    setNewTaskMode(savedMode);

    if (savedMode === 'ai') {
      ntAiHistory = [{ role: 'assistant', content: 'Привет! Я TechLead. Опиши задачу которую нужно добавить.' }];
      pendingTask = null;
      var chatEl = document.getElementById('nt-chat');
      var pv = document.getElementById('task-preview');
      var btnAdd = document.getElementById('btn-add-backlog');
      if (chatEl) chatEl.innerHTML = '';
      if (pv) pv.classList.remove('show');
      if (btnAdd) btnAdd.disabled = true;
      if (typeof appendTo === 'function') appendTo('nt-chat', 'ai', 'Привет! Я TechLead. Опиши задачу которую нужно добавить.');
      if (typeof window.initNtLlmSelectors === 'function') window.initNtLlmSelectors();

      (async function () {
        if (!activeProjId) return;
        try {
          var snap = await apiFetch('/projects/' + activeProjId + '/snapshot');
          ntSnapshotMd = (snap && snap.snapshot_md) ? snap.snapshot_md : '';
        } catch (e) {
          ntSnapshotMd = '';
        }
      })();

      setTimeout(function () {
        var ta = document.getElementById('nt-ta');
        if (ta) ta.focus();
      }, 150);
    } else {
      var title = document.getElementById('ntm-title');
      if (title) title.focus();
    }

    var btnAi = document.getElementById('nt-mode-ai');
    var btnManual = document.getElementById('nt-mode-manual');
    if (btnAi) {
      btnAi.onclick = function () {
        var titleEl = document.getElementById('ntm-title');
        var descEl = document.getElementById('ntm-desc');
        if (titleEl && descEl && (titleEl.value || descEl.value)) {
          var txt = (titleEl.value || '').trim() + ((titleEl.value && descEl.value) ? '\n' : '') + (descEl.value || '').trim();
          if (txt && ntAiHistory) {
            ntAiHistory.push({ role: 'user', content: txt });
            var chatEl = document.getElementById('nt-chat');
            if (chatEl && typeof appendTo === 'function') appendTo('nt-chat', 'user', txt);
          }
        }
        setNewTaskMode('ai');
        try { localStorage.setItem('pk24_new_task_mode', 'ai'); } catch (e) { }
      };
    }
    if (btnManual) {
      btnManual.onclick = function () {
        var titleEl = document.getElementById('ntm-title');
        var descEl = document.getElementById('ntm-desc');
        if (pendingTask && titleEl && descEl) {
          titleEl.value = (pendingTask.title || '').trim();
          descEl.value = (pendingTask.desc || pendingTask.descript || '').trim();
        }
        setNewTaskMode('manual');
        try { localStorage.setItem('pk24_new_task_mode', 'manual'); } catch (e) { }
      };
    }

    ov.classList.add('open');
  };

  window.closeTaskCreate = function () {
    const ov = document.getElementById('task-create-ov');
    if (ov) {
      ov.classList.remove('open');
    }
  };

  // Форма AI-чата остаётся, но +Задача теперь открывает ручную форму.
  // openNewTask (AI) оставляем без изменений, чтобы не ломать существующее поведение, если оно вызывается из кода.

  function getActiveTaskRawId() {
    if (!activeId) {
      return null;
    }
    const task = tasks.find(function (item) {
      return item.id === activeId || item.raw_id === activeId;
    });
    return task && task.raw_id ? task.raw_id : null;
  }

  function appendChatMessage(cid, msg) {
    const c = document.getElementById(cid);
    if (!c) {
      return;
    }
    const role = msg.role === 'user' ? 'user' : 'ai';
    const d = document.createElement('div');
    d.className = 'msg ' + role;
    d.setAttribute('data-role', msg.role);
    if (msg.id) {
      d.setAttribute('data-message-id', msg.id);
    }
    const av = role === 'ai' ? '✦' : 'НБ';
    const avClass = role === 'ai' ? 'ai' : 'usr';
    let bubHtml = (typeof fmtMsg === 'function' ? fmtMsg(msg.content) : msg.content);
    if (msg.role === 'assistant' && msg.action && !msg.action_applied) {
      bubHtml +=
        '<div class="msg-actions">' +
        '<button type="button" class="msg-action-btn apply" data-apply="1">Применить</button>' +
        '<button type="button" class="msg-action-btn reject">Отклонить</button>' +
        '</div>';
    }
    d.innerHTML =
      '<div class="msg-av ' + avClass + '">' + av + '</div>' +
      '<div class="msg-bub">' + bubHtml + '</div>';
    c.appendChild(d);
    c.scrollTop = c.scrollHeight;

    if (msg.role === 'assistant' && msg.action && !msg.action_applied && msg.id) {
      const rawId = getActiveTaskRawId();
      if (rawId) {
        const applyBtn = d.querySelector('.msg-action-btn.apply');
        const rejectBtn = d.querySelector('.msg-action-btn.reject');
        if (applyBtn) {
          applyBtn.addEventListener('click', function () {
            applyChatAction(rawId, msg.id, d);
          });
        }
        if (rejectBtn) {
          rejectBtn.addEventListener('click', function () {
            rejectBtn.disabled = true;
            if (applyBtn) applyBtn.disabled = true;
            const actions = d.querySelector('.msg-actions');
            if (actions) actions.classList.add('applied');
          });
        }
      }
    }
  }

  async function loadTaskChat(rawId) {
    const msgsEl = document.getElementById('ai-msgs');
    if (!msgsEl) {
      return;
    }
    try {
      const data = await apiFetch('/tasks/' + rawId + '/chat');
      const messages = (data && data.messages) || [];
      msgsEl.innerHTML = '';
      chatHist = [];
      if (messages.length === 0) {
        const task = tasks.find(function (item) {
          return item.raw_id === rawId;
        });
        const title = task ? task.title : '';
        appendChatMessage('ai-msgs', {
          role: 'assistant',
          content: 'Задача: ' + (title ? '«' + title + '». ' : '') + 'Готов помочь — декомпозиция, API-контракт, схема БД, промпт для Cursor.',
        });
      } else {
        messages.forEach(function (m) {
          chatHist.push({ role: m.role, content: m.content });
          appendChatMessage('ai-msgs', m);
        });
      }
    } catch (error) {
      msgsEl.innerHTML = '';
      chatHist = [];
      appendChatMessage('ai-msgs', {
        role: 'assistant',
        content: 'Не удалось загрузить историю чата: ' + (error.message || 'ошибка'),
      });
    }
  }

  async function applyChatAction(taskRawId, messageId, messageEl) {
    const applyBtn = messageEl.querySelector('.msg-action-btn.apply');
    const rejectBtn = messageEl.querySelector('.msg-action-btn.reject');
    if (applyBtn) applyBtn.disabled = true;
    if (rejectBtn) rejectBtn.disabled = true;
    try {
      await apiFetch('/tasks/' + taskRawId + '/chat/apply/' + messageId, {
        method: 'POST',
      });
      const actions = messageEl.querySelector('.msg-actions');
      if (actions) actions.classList.add('applied');
      await loadTasksForActiveProject();
      render();
      syncColumnEmptyStates();
      updateStageTabs();
      scheduleHeaderRefresh();
      showInfo('Изменения применены');
    } catch (error) {
      if (applyBtn) applyBtn.disabled = false;
      if (rejectBtn) rejectBtn.disabled = false;
      showError('Ошибка применения: ' + (error.message || 'unknown'));
    }
  }

  window.enhanceTaskModal = function (id) {
    ensureTaskDeleteButton();
    ensureTaskEditUI(id);
    if (typeof window.pkDropdownInit === 'function') {
      window.pkDropdownInit(document.getElementById('tm-meta'));
      window.pkDropdownInit(document.getElementById('task-ov'));
    }
    if (typeof window.initTcLlmSelectors === 'function') window.initTcLlmSelectors();
    var rawId = getActiveTaskRawId();
    if (rawId) {
      setTimeout(function () {
        loadTaskChat(rawId);
      }, 50);
    }
  };

  const originalOpenTask = openTask;
  openTask = function (id) { originalOpenTask(id); };
  window.openTask = openTask;

  function populateResponsibleSelect(users, selectedId) {
    const sel = document.getElementById('ps-responsible');
    const wrap = document.getElementById('ps-responsible-wrap');
    if (!sel) return;
    sel.innerHTML = '<option value="">—</option>' + (Array.isArray(users) ? users : []).map(function (u) {
      return '<option value="' + (u.id || '').replace(/"/g, '&quot;') + '"' + (u.id === selectedId ? ' selected' : '') + '>' + (u.email || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</option>';
    }).join('');
    if (wrap) wrap.style.display = '';
  }

  const originalOpenNewProjectModal = openNewProjectModal;
  openNewProjectModal = function () {
    originalOpenNewProjectModal();
    const weeksInput = document.getElementById('ps-weeks');
    const budgetInput = document.getElementById('ps-budget');
    if (weeksInput) weeksInput.value = '0';
    if (budgetInput) budgetInput.value = '0';
    pendingStageActionsByProject.__new__ = [];
    ensureStageSettingsEditor([]);
    syncProjectBudgetInputFromStageRows();
    ensureAgentSettingsEditor([
      { name: 'Frontend', type: 'ai', color: '#4a9eff' },
      { name: 'Backend', type: 'ai', color: '#a78bfa' },
      { name: 'QA', type: 'ai', color: '#22d3ee' },
    ]);
    ensurePriorityOptionsEditor([{ value: 1, label: 'Low' }, { value: 2, label: 'Medium' }, { value: 3, label: 'High' }, { value: 4, label: 'Critical' }]);
    ensureSizeOptionsEditor([{ id: 'XS', label: 'XS' }, { id: 'S', label: 'S' }, { id: 'M', label: 'M' }, { id: 'L', label: 'L' }, { id: 'XL', label: 'XL' }]);
    ensureColumnSettingsEditor([
      { id: 'backlog', label: 'Backlog', visible: true, locked: true },
      { id: 'todo', label: 'To Do', visible: true, locked: false },
      { id: 'doing', label: 'In Progress', visible: true, locked: false },
      { id: 'review', label: 'Review', visible: true, locked: false },
      { id: 'done', label: 'Done', visible: true, locked: true },
    ]);
    var wrap = document.getElementById('ps-responsible-wrap');
    if (wrap) wrap.style.display = '';
    var jwt = decodeJwtPayload(localStorage.getItem('pk24_token'));
    var currentUserId = (jwt && jwt.sub) || '';
    apiFetch('/api/assignable-users').then(function (data) {
      var users = Array.isArray(data && data.users) ? data.users : [];
      populateResponsibleSelect(users, currentUserId);
      setTimeout(function () { if (typeof pkDropdownInit === 'function') pkDropdownInit(document.getElementById('ps-ov')); }, 100);
    }).catch(function () { populateResponsibleSelect([], ''); setTimeout(function () { if (typeof pkDropdownInit === 'function') pkDropdownInit(document.getElementById('ps-ov')); }, 100); });
  };

  const originalOpenProjSettings = openProjSettings;
  openProjSettings = async function (id) {
    originalOpenProjSettings(id);
    pendingStageActionsByProject[id] = [];
    const project = projects.find(function (item) {
      return item.id === id;
    });
    const stageSettings =
      project && Array.isArray(project.stageSettings) && project.stageSettings.length > 0
        ? project.stageSettings
        : project && Array.isArray(project.stages) && project.stages.length > 0
          ? project.stages.map(function (stageName, index) {
            const budgetShare =
              project.stages.length > 0
                ? Math.floor(Number(project.budget || 0) / project.stages.length)
                : 0;
            return {
              name: stageName,
              budget: budgetShare,
              color: ensureStageColor(stageName, null),
            };
          })
          : [];
    let stageSettingsForEditor = stageSettings;
    try {
      const resolved = await ensureTaskStagesPreserved(id, stageSettings);
      stageSettingsForEditor = resolved.stageSettings;
      if (resolved.addedStages.length > 0) {
        showInfo(
          'Добавлены этапы из существующих задач: ' +
          resolved.addedStages.join(', ')
        );
      }
    } catch (error) {
      showError('Не удалось синхронизировать этапы проекта: ' + error.message);
    }

    ensureStageSettingsEditor(stageSettingsForEditor);
    syncProjectBudgetInputFromStageRows();

    var agentSettingsForEditor = project && Array.isArray(project.agentSettings) && project.agentSettings.length > 0
      ? project.agentSettings
      : [];
    if (agentSettingsForEditor.length === 0 && id === activeProjId && typeof tasks !== 'undefined' && Array.isArray(tasks) && tasks.length > 0) {
      var agentNames = Array.from(new Set(tasks.map(function (t) { return String(t.agent || '').trim(); }).filter(Boolean)));
      agentNames = agentNames.filter(function (n) { return n !== 'Без агента'; });
      var palette = ['#4a9eff', '#a78bfa', '#fb923c', '#f87171', '#4ade80', '#22d3ee', '#f59e0b', '#f472b6'];
      agentSettingsForEditor = [{ name: 'Без агента', type: 'ai', color: '#6B7280' }].concat(
        agentNames.map(function (name, idx) {
          return { name: name, type: 'ai', color: palette[idx % palette.length] };
        })
      );
    }
    if (agentSettingsForEditor.length === 0) {
      if (id === '__new__') {
        agentSettingsForEditor = [
          { name: 'Без агента', type: 'ai', color: '#6B7280' },
          { name: 'Frontend', type: 'ai', color: '#4a9eff' },
          { name: 'Backend', type: 'ai', color: '#a78bfa' },
          { name: 'QA', type: 'ai', color: '#22d3ee' },
        ];
      } else {
        agentSettingsForEditor = [{ name: 'Без агента', type: 'ai', color: '#6B7280' }];
      }
    } else {
      var hasNone = agentSettingsForEditor.some(function (a) { return (a.name || '').trim() === 'Без агента'; });
      if (!hasNone) {
        agentSettingsForEditor = [{ name: 'Без агента', type: 'ai', color: '#6B7280' }].concat(agentSettingsForEditor);
      } else {
        agentSettingsForEditor = agentSettingsForEditor.filter(function (a) { return (a.name || '').trim() !== 'Без агента'; });
        agentSettingsForEditor = [{ name: 'Без агента', type: 'ai', color: '#6B7280' }].concat(agentSettingsForEditor);
      }
    }
    ensureAgentSettingsEditor(agentSettingsForEditor);

    var priorityOpts = project && Array.isArray(project.priorityOptions) && project.priorityOptions.length > 0
      ? project.priorityOptions
      : [{ value: 1, label: 'Low' }, { value: 2, label: 'Medium' }, { value: 3, label: 'High' }, { value: 4, label: 'Critical' }];
    var sizeOpts = project && Array.isArray(project.sizeOptions) && project.sizeOptions.length > 0
      ? project.sizeOptions
      : [{ id: 'XS', label: 'XS' }, { id: 'S', label: 'S' }, { id: 'M', label: 'M' }, { id: 'L', label: 'L' }, { id: 'XL', label: 'XL' }];
    var colOpts = project && Array.isArray(project.columnSettings) && project.columnSettings.length > 0
      ? project.columnSettings
      : [
          { id: 'backlog', label: 'Backlog', visible: true, locked: true },
          { id: 'todo', label: 'To Do', visible: true, locked: false },
          { id: 'doing', label: 'In Progress', visible: true, locked: false },
          { id: 'review', label: 'Review', visible: true, locked: false },
          { id: 'done', label: 'Done', visible: true, locked: true },
        ];
    ensurePriorityOptionsEditor(priorityOpts);
    ensureSizeOptionsEditor(sizeOpts);
    ensureColumnSettingsEditor(colOpts);

    const deleteButton = document.getElementById('btn-delete-proj');
    if (deleteButton) {
      deleteButton.classList.remove('hidden');
      deleteButton.onclick = function () {
        deleteProject();
      };
    }
    var jwt = decodeJwtPayload(localStorage.getItem('pk24_token'));
    var isAdmin = (jwt && jwt.role) === 'admin';
    var wrap = document.getElementById('ps-responsible-wrap');
    if (wrap) wrap.style.display = isAdmin ? '' : 'none';
    if (isAdmin) {
      apiFetch('/api/assignable-users').then(function (data) {
        var users = Array.isArray(data && data.users) ? data.users : [];
        var rid = (project && project.responsible_user_id) || '';
        populateResponsibleSelect(users, rid);
        setTimeout(function () { if (typeof pkDropdownInit === 'function') pkDropdownInit(document.getElementById('ps-ov')); }, 100);
      }).catch(function () { populateResponsibleSelect([], project && project.responsible_user_id); setTimeout(function () { if (typeof pkDropdownInit === 'function') pkDropdownInit(document.getElementById('ps-ov')); }, 100); });
    }
  };

  window.__fillProfileContent = function (sectionId) {
    try {
      closeAllDropdowns();
      ensureProfilePanel();
      PROFILE_MAIN_SECTIONS = buildProfileSections();
      if (sectionId) {
        var main = PROFILE_MAIN_SECTIONS.find(function (m) { return m.id === sectionId; });
        if (main) {
          activeProfileSection = main.id;
          activeProfileSubSection = main.subs[0] ? main.subs[0].id : activeProfileSubSection;
        } else {
          var mainBySub = getMainSectionBySubId(sectionId);
          if (mainBySub) {
            activeProfileSection = mainBySub.id;
            activeProfileSubSection = sectionId;
          }
        }
      }
      renderProfileNavigation();
      renderProfileSubNav();
      renderProfileSection();
    } catch (err) {
      console.error('Profile content error:', err);
      var contentEl = document.getElementById('profile-content');
      if (contentEl) {
        contentEl.innerHTML = '<div class="profile-pane"><div class="profile-pane-title">Ошибка</div>' +
          '<div class="profile-pane-sub">Не удалось загрузить раздел. Проверьте консоль (F12).</div></div>';
      }
    }
  };
  window.openProfilePanel = function (sectionId) {
    var o = document.getElementById('profile-ov');
    if (o) o.classList.add('open');
    if (typeof window.__fillProfileContent === 'function') window.__fillProfileContent(sectionId || 'profile');
  };
  window.closeProfilePanel = closeProfilePanel;
  window.setTaskCreateMode = setTaskCreateMode;

  (function () {
    var profileOv = document.getElementById('profile-ov');
    if (profileOv && typeof MutationObserver !== 'undefined') {
      var observer = new MutationObserver(function () {
        if (profileOv.classList.contains('open') && typeof window.__fillProfileContent === 'function') {
          window.__fillProfileContent(activeProfileSection || 'profile');
        }
      });
      observer.observe(profileOv, { attributes: true, attributeFilter: ['class'] });
    }
  })();

  function bindProfileButtonOnce() {
    var btn = document.getElementById('btn-profile');
    if (!btn) {
      return;
    }
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      var ov = document.getElementById('profile-ov');
      if (ov && ov.classList.contains('open')) {
        window.closeProfilePanel();
      } else {
        window.openProfilePanel('profile');
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindProfileButtonOnce);
  } else {
    bindProfileButtonOnce();
  }
  window.addEventListener('load', function () {
    bootstrapFromApi();
    bindProfileButtonOnce();
  });
})();
