(function () {
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

  const DEFAULT_STAGE_LIST = ['A', 'R1', 'R1.1', 'R2', 'R3+', 'F'];
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
  const SIZE_WEIGHT = { S: 1, M: 2, L: 3, XL: 4 };
  const SORT_OPTIONS = [
    { value: 'default', label: 'По умолчанию' },
    { value: 'id_asc', label: 'ID возрастание' },
    { value: 'id_desc', label: 'ID убывание' },
    { value: 'name_asc', label: 'Имя возрастание' },
    { value: 'name_desc', label: 'Имя убывание' },
    { value: 'size', label: 'Размер' },
  ];
  const PROFILE_SECTIONS = [
    { id: 'profile', label: 'Профиль' },
    { id: 'trash', label: 'Удаленные задачи' },
    { id: 'history', label: 'История действий' },
    { id: 'roles', label: 'Мои проекты и роли' },
    { id: 'llm', label: 'Импорт и LLM-операции' },
    { id: 'metrics_project', label: 'Метрики проекта' },
    { id: 'metrics_tasks', label: 'Метрики задач' },
    { id: 'metrics_time', label: 'Метрики времени' },
    { id: 'metrics_budget', label: 'Метрики бюджета' },
    { id: 'ui', label: 'Настройки интерфейса' },
    { id: 'security', label: 'Безопасность' },
  ];

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
    const normalized = String(col || '').toLowerCase();
    const match = COLS.find(function (item) {
      return item.id === normalized;
    });
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
      return [];
    }
    if (Array.isArray(project.stageSettings) && project.stageSettings.length > 0) {
      return project.stageSettings.map(function (item) {
        return item.name;
      });
    }
    if (Array.isArray(project.stages) && project.stages.length > 0) {
      return project.stages.slice();
    }
    return [];
  }

  function mapDeletedTaskFromApi(item) {
    const stage = String(item.stage || item.last_stage || 'A').trim() || 'A';
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
    let overlay = document.getElementById('profile-ov');
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = 'profile-ov';
    overlay.className = 'overlay profile-overlay';
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
      + '<div class="profile-content" id="profile-content"></div>'
      + '</div>'
      + '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function (event) {
      if (event.target === overlay) {
        closeProfilePanel();
      }
    });

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
    closeAllDropdowns();
    const overlay = ensureProfilePanel();
    activeProfileSection = sectionId || activeProfileSection || 'profile';
    renderProfileNavigation();
    renderProfileSection();
    overlay.classList.add('open');
  }

  function closeProfilePanel() {
    const overlay = document.getElementById('profile-ov');
    if (overlay) {
      overlay.classList.remove('open');
    }
  }

  function renderProfileNavigation() {
    const nav = document.getElementById('profile-nav');
    if (!nav) {
      return;
    }

    nav.innerHTML = PROFILE_SECTIONS.map(function (section) {
      return (
        '<button class="profile-nav-item' +
        (section.id === activeProfileSection ? ' active' : '') +
        '" data-profile-section="' +
        section.id +
        '">' +
        escapeHtml(section.label) +
        '</button>'
      );
    }).join('');

    nav.querySelectorAll('[data-profile-section]').forEach(function (button) {
      button.onclick = function () {
        const next = button.getAttribute('data-profile-section');
        if (!next) {
          return;
        }
        activeProfileSection = next;
        renderProfileNavigation();
        renderProfileSection();
      };
    });
  }

  function renderProfilePlaceholder(title, description) {
    const content = document.getElementById('profile-content');
    if (!content) {
      return;
    }
    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">' + escapeHtml(title) + '</div>'
      + '<div class="profile-pane-sub">' + escapeHtml(description) + '</div>'
      + '<div class="profile-empty">Раздел готов к подключению API.</div>'
      + '</div>';
  }

  function renderProfileOverview() {
    const content = document.getElementById('profile-content');
    if (!content) { return; }

    const jwt = decodeJwtPayload(localStorage.getItem('pk24_token'));
    const userEmail  = (jwt && jwt.email)  || '—';
    const userRole   = (jwt && jwt.role)   || '—';
    const userId     = (jwt && jwt.sub)    || '—';
    const tokenExp   = jwt && jwt.exp ? new Date(jwt.exp * 1000) : null;
    const tokenExpStr = tokenExp
      ? new Intl.DateTimeFormat('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(tokenExp)
      : '—';
    const nowMs = Date.now();
    const expMs = tokenExp ? tokenExp.getTime() : 0;
    const hoursLeft = expMs > nowMs ? Math.floor((expMs - nowMs) / 3600000) : 0;

    const roleLabels = { admin: 'Администратор', techlead: 'Техлид', employee: 'Сотрудник' };
    const roleLabel  = roleLabels[userRole] || userRole;
    const roleColors = { admin: 'var(--red)', techlead: 'var(--gold)', employee: 'var(--green)' };
    const roleColor  = roleColors[userRole] || 'var(--tx3)';

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
        const inWork   = (tasks.in_work  || 0);
        const done     = (tasks.done     || 0);
        const backlog  = (tasks.backlog  || 0);
        const total    = backlog + inWork + done;
        const earned   = Number(budget.earned  || 0);
        const budTotal = Number(budget.total   || 0);
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

  function renderProfileRoles() {
    const content = document.getElementById('profile-content');
    if (!content) { return; }

    const jwt = decodeJwtPayload(localStorage.getItem('pk24_token'));
    const userRole  = (jwt && jwt.role)  || 'employee';
    const userId    = (jwt && jwt.sub)   || '';
    const roleLabels = { admin: 'Администратор', techlead: 'Техлид', employee: 'Сотрудник' };
    const roleLabel  = roleLabels[userRole] || userRole;
    const roleColors = { admin: 'var(--red)', techlead: 'var(--gold)', employee: 'var(--green)' };
    const roleColor  = roleColors[userRole] || 'var(--tx3)';

    const rows = projects.map(function (project) {
      const isActive = project.id === activeProjId;
      const stageCount = Array.isArray(project.stages) ? project.stages.length : 0;
      const budget = Number(project.budget_total || 0);
      const budgetStr = budget > 0 ? budget.toLocaleString('ru-RU') + ' ₽' : '—';
      return ''
        + '<div class="profile-role-row"' + (isActive ? ' style="border-color:var(--gold);background:var(--gold-dim)"' : '') + '>'
        + '<div style="display:flex;align-items:center;gap:8px;min-width:0">'
        + (isActive ? '<span style="width:6px;height:6px;border-radius:50%;background:var(--gold);flex-shrink:0;box-shadow:0 0 6px var(--gold-glow)"></span>' : '<span style="width:6px;height:6px;border-radius:50%;background:var(--bd3);flex-shrink:0"></span>')
        + '<div class="profile-role-name">' + escapeHtml(project.name) + (isActive ? ' <span style="font-size:9px;color:var(--gold);letter-spacing:1px">АКТИВНЫЙ</span>' : '') + '</div>'
        + '</div>'
        + '<div style="display:flex;gap:16px;align-items:center;font-size:11px;color:var(--tx3);flex-shrink:0">'
        + '<span>' + stageCount + ' этапов</span>'
        + '<span>' + budgetStr + '</span>'
        + '<span style="color:' + roleColor + ';font-weight:600">' + escapeHtml(roleLabel) + '</span>'
        + '</div>'
        + '</div>';
    }).join('');

    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">Мои проекты и роли</div>'
      + '<div class="profile-pane-sub">Роль в системе: <strong style="color:' + roleColor + '">' + escapeHtml(roleLabel) + '</strong> · ID: <span style="color:var(--tx3);font-size:11px">' + escapeHtml(userId) + '</span></div>'
      + '<div class="profile-role-list">'
      + (rows || '<div class="profile-empty">Нет доступных проектов</div>')
      + '</div>'
      + '</div>';
  }

  function renderProfileUiSettings() {
    const content = document.getElementById('profile-content');
    if (!content) {
      return;
    }
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">Настройки интерфейса</div>'
      + '<div class="profile-pane-sub">Управление темой и визуальным режимом.</div>'
      + '<div class="profile-inline-actions">'
      + '<button class="profile-btn" id="profile-toggle-theme">Переключить тему</button>'
      + '<div class="profile-inline-hint">Текущая тема: ' + escapeHtml(currentTheme) + '</div>'
      + '</div>'
      + '</div>';

    const themeButton = document.getElementById('profile-toggle-theme');
    if (themeButton) {
      themeButton.onclick = function () {
        if (typeof toggleTheme === 'function') {
          toggleTheme();
          renderProfileUiSettings();
        }
      };
    }
  }

  function renderProfileSecurity() {
    const content = document.getElementById('profile-content');
    if (!content) {
      return;
    }
    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">Безопасность</div>'
      + '<div class="profile-pane-sub">Сессия и выход из системы.</div>'
      + '<div class="profile-inline-actions">'
      + '<button class="profile-btn danger" id="profile-logout-btn">Выйти из системы</button>'
      + '</div>'
      + '</div>';

    const logoutButton = document.getElementById('profile-logout-btn');
    if (logoutButton) {
      logoutButton.onclick = function () {
        authToken = '';
        localStorage.removeItem('pk24_token');
        localStorage.removeItem('pk24_email');
        location.replace('/login.html');
      };
    }
  }

  function bindTrashFilterFormEvents() {
    const applyButton = document.getElementById('trash-apply-btn');
    const resetButton = document.getElementById('trash-reset-btn');
    const refreshButton = document.getElementById('trash-refresh-btn');

    if (applyButton) {
      applyButton.onclick = function () {
        profileTrashFilters.q = String(document.getElementById('trash-filter-q').value || '').trim();
        profileTrashFilters.project_id = String(document.getElementById('trash-filter-project').value || '').trim();
        profileTrashFilters.stage = String(document.getElementById('trash-filter-stage').value || '').trim();
        profileTrashFilters.deleted_by = String(document.getElementById('trash-filter-author').value || '').trim();
        profileTrashFilters.deleted_from = String(document.getElementById('trash-filter-from').value || '').trim();
        profileTrashFilters.deleted_to = String(document.getElementById('trash-filter-to').value || '').trim();
        loadDeletedTasks();
      };
    }

    if (resetButton) {
      resetButton.onclick = function () {
        profileTrashFilters = {
          q: '',
          project_id: '',
          stage: '',
          deleted_by: '',
          deleted_from: '',
          deleted_to: '',
        };
        renderProfileTrash();
        loadDeletedTasks();
      };
    }

    if (refreshButton) {
      refreshButton.onclick = function () {
        loadDeletedTasks();
      };
    }

    const quickSearch = document.getElementById('trash-filter-q');
    if (quickSearch) {
      quickSearch.onkeydown = function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (applyButton) {
            applyButton.click();
          }
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
          + '<button class="profile-btn small" data-trash-action="restore" data-trash-id="' + escapeHtml(item.raw_id) + '">Восстановить</button>'
          + '<button class="profile-btn small danger ghost" data-trash-action="purge" data-trash-id="' + escapeHtml(item.raw_id) + '">Удалить навсегда</button>'
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

    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">Удаленные задачи</div>'
      + '<div class="profile-pane-sub">Архив удаленных задач с восстановлением в проект, столбец и этап.</div>'
      + '<div class="trash-filters">'
      + '<input class="profile-input" id="trash-filter-q" placeholder="Поиск по ID, названию, описанию" value="' + escapeHtml(profileTrashFilters.q) + '">'
      + '<select class="profile-input" id="trash-filter-project">' + projectOptions + '</select>'
      + '<select class="profile-input" id="trash-filter-stage">' + stageOptions + '</select>'
      + '<input class="profile-input" id="trash-filter-author" placeholder="Кем удалена" value="' + escapeHtml(profileTrashFilters.deleted_by) + '">'
      + '<input class="profile-input" id="trash-filter-from" type="date" value="' + escapeHtml(profileTrashFilters.deleted_from) + '">'
      + '<input class="profile-input" id="trash-filter-to" type="date" value="' + escapeHtml(profileTrashFilters.deleted_to) + '">'
      + '<div class="trash-filter-actions">'
      + '<button class="profile-btn small" id="trash-apply-btn">Применить</button>'
      + '<button class="profile-btn small ghost" id="trash-reset-btn">Сбросить</button>'
      + '<button class="profile-btn small ghost" id="trash-refresh-btn">Обновить</button>'
      + '</div>'
      + '</div>'
      + '<div class="trash-head">'
      + '<div>ID</div><div>Задача</div><div>Удалена</div><div>Кем</div><div>Проект</div><div>Столбец</div><div>Этап</div><div>Действия</div>'
      + '</div>'
      + '<div id="trash-list" class="trash-list"></div>'
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
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) {
          overlay.remove();
        }
      });
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

    colSelect.innerHTML = COLS.map(function (col) {
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
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) {
          overlay.remove();
        }
      });
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

  function renderProfileHistory() {
    const content = document.getElementById('profile-content');
    if (!content) { return; }

    const projectName = getProjectName(activeProjId) || '—';

    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">История действий</div>'
      + '<div class="profile-pane-sub">Последние 100 событий активного проекта из audit trail (task_events).</div>'
      + (activeProjId
        ? '<div id="profile-history-list"><div class="profile-empty">Загрузка событий...</div></div>'
        : '<div class="profile-empty">Выберите активный проект, чтобы увидеть историю.</div>')
      + '</div>';

    if (!activeProjId) { return; }

    (async function () {
      const listEl = document.getElementById('profile-history-list');
      if (!listEl) { return; }
      try {
        const EVENT_LABELS = {
          task_created:   '✦ Создана',
          task_updated:   '✎ Обновлена',
          task_moved:     '→ Перемещена',
          task_reordered: '⇅ Переупорядочена',
          task_deleted:   '✕ Удалена',
          agent_action:   '⚡ Агент',
        };
        const EVENT_COLORS = {
          task_created:   'var(--green)',
          task_updated:   'var(--gold)',
          task_moved:     'var(--c-A)',
          task_reordered: 'var(--tx3)',
          task_deleted:   'var(--red)',
          agent_action:   'var(--c-R1)',
        };
        const data = await apiFetch('/projects/' + activeProjId + '/events?limit=100');
        const events = Array.isArray(data && data.events) ? data.events : [];
        if (!events.length) {
          listEl.innerHTML = '<div class="profile-empty">Событий не найдено.</div>';
          return;
        }
        const rows = events.map(function (ev) {
          const label = EVENT_LABELS[ev.event_type] || escapeHtml(ev.event_type);
          const color = EVENT_COLORS[ev.event_type] || 'var(--tx2)';
          const taskId = ev.task_id ? String(ev.task_id).slice(0, 8) + '…' : '—';
          let detail = '';
          if (ev.payload) {
            if (ev.payload.from_col && ev.payload.to_col) {
              detail = escapeHtml(ev.payload.from_col) + ' → ' + escapeHtml(ev.payload.to_col);
            } else if (ev.payload.title) {
              detail = escapeHtml(ev.payload.title);
            } else if (Array.isArray(ev.payload.fields_changed)) {
              detail = ev.payload.fields_changed.map(escapeHtml).join(', ');
            }
          }
          return ''
            + '<div class="profile-role-row" style="gap:10px;align-items:flex-start">'
            + '<div style="font-size:11px;color:' + color + ';font-weight:600;flex-shrink:0;min-width:110px">' + label + '</div>'
            + '<div style="font-size:11px;color:var(--tx3);flex-shrink:0;min-width:70px;font-family:\'DM Mono\',monospace">' + escapeHtml(taskId) + '</div>'
            + '<div style="font-size:11px;color:var(--tx2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (detail || '—') + '</div>'
            + '<div style="font-size:10px;color:var(--tx4);flex-shrink:0;white-space:nowrap">' + escapeHtml(formatDateTime(ev.created_at)) + '</div>'
            + '</div>';
        }).join('');
        listEl.innerHTML = '<div class="profile-role-list">' + rows + '</div>';
      } catch (err) {
        if (listEl) { listEl.innerHTML = '<div class="profile-empty">Ошибка загрузки: ' + escapeHtml(err.message) + '</div>'; }
      }
    })();
  }

  function renderProfileLlm() {
    const content = document.getElementById('profile-content');
    if (!content) { return; }

    content.innerHTML = ''
      + '<div class="profile-pane">'
      + '<div class="profile-pane-title">Импорт и LLM-операции</div>'
      + '<div class="profile-pane-sub">Точки входа LLM Gateway. Для использования требуется настроенный провайдер.</div>'
      + '<div class="profile-cards">'
      + '<div class="profile-card" style="grid-column:1/-1">'
      + '<div class="profile-card-label">POST /import/excel</div>'
      + '<div class="profile-card-value" style="font-size:12px">Импорт задач из файла через LLM-парсинг</div>'
      + '<div class="profile-card-sub">Принимает file_name + content → создаёт backlog-задачи</div>'
      + '</div>'
      + '<div class="profile-card" style="grid-column:1/-1">'
      + '<div class="profile-card-label">POST /llm/task-dialog</div>'
      + '<div class="profile-card-value" style="font-size:12px">Диалоговая постановка задачи через LLM</div>'
      + '<div class="profile-card-sub">messages[] → title, descript, stage, priority</div>'
      + '</div>'
      + '<div class="profile-card" style="grid-column:1/-1">'
      + '<div class="profile-card-label">POST /api/llm/chat</div>'
      + '<div class="profile-card-value" style="font-size:12px">Прямой запрос к LLM Gateway</div>'
      + '<div class="profile-card-sub" id="profile-llm-provider">Загрузка доступных моделей...</div>'
      + '</div>'
      + '</div>'
      + '</div>';

    (async function () {
      const el = document.getElementById('profile-llm-provider');
      if (!el) { return; }
      try {
        const data = await apiFetch('/api/llm/models?provider=anthropic');
        const models = Array.isArray(data && data.models) ? data.models : [];
        el.textContent = models.length
          ? 'Провайдер: ' + (data.provider || 'anthropic') + ' · Модели: ' + models.join(', ')
          : 'Провайдер не настроен (LLM_STUB_MODE или ключ отсутствует)';
      } catch (_) {
        el.textContent = 'LLM Gateway недоступен';
      }
    })();
  }

  function renderProfileSection() {
    if (activeProfileSection === 'profile') {
      renderProfileOverview();
      return;
    }
    if (activeProfileSection === 'trash') {
      renderProfileTrash();
      loadDeletedTasks();
      return;
    }
    if (activeProfileSection === 'history') {
      renderProfileHistory();
      return;
    }
    if (activeProfileSection === 'roles') {
      renderProfileRoles();
      return;
    }
    if (activeProfileSection === 'llm') {
      renderProfileLlm();
      return;
    }
    if (
      activeProfileSection === 'metrics_project' ||
      activeProfileSection === 'metrics_tasks' ||
      activeProfileSection === 'metrics_time' ||
      activeProfileSection === 'metrics_budget'
    ) {
      if (
        window.PlanKanbanAnalytics &&
        typeof window.PlanKanbanAnalytics.renderSection === 'function'
      ) {
        window.PlanKanbanAnalytics.renderSection({
          sectionId: activeProfileSection,
          activeProjectId: activeProjId || '',
          activeProject: getActiveProject(),
          projects: projects.slice(),
          apiFetch: apiFetch,
          escapeHtml: escapeHtml,
          formatDateTime: formatDateTime,
        });
      } else {
        renderProfilePlaceholder('Метрики', 'Модуль аналитики не загружен.');
      }
      return;
    }
    if (activeProfileSection === 'ui') {
      renderProfileUiSettings();
      return;
    }
    if (activeProfileSection === 'security') {
      renderProfileSecurity();
      return;
    }
    renderProfileOverview();
  }

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
      return '#64748b';
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

  function getVisibleStagesFromTasks() {
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

    const configuredStages = getCurrentProjectStages();
    const ordered = configuredStages.filter(function (stage) {
      return presentStages.includes(stage);
    });
    const extras = presentStages
      .filter(function (stage) {
        return !configuredStages.includes(stage);
      })
      .sort(function (a, b) {
        return a.localeCompare(b, 'ru');
      });
    return ordered.concat(extras);
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
      wrapper.style.marginLeft = 'auto';
      wrapper.style.marginRight = '8px';

      const select = document.createElement('select');
      select.style.cssText =
        'height:24px;padding:0 8px;background:var(--sf2);border:1px solid var(--bd2);border-radius:6px;color:var(--tx2);font-size:10px;font-family:DM Mono,monospace;outline:none;';
      SORT_OPTIONS.forEach(function (option) {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = option.label;
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

    const safeInitial = Array.isArray(initialItems) && initialItems.length > 0
      ? initialItems
      : [
          { name: 'A', budget: 0, color: '#4a9eff' },
        ];

    const createRow = function (item) {
      const row = document.createElement('div');
      row.className = 'ps-stage-row';
      row.dataset.originalStage = String(item.name || '').trim();
      row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 46px 40px;gap:8px;align-items:center;';
      row.innerHTML = ''
        + '<input class="ps-input" data-field=\"stage-name\" placeholder=\"Этап\" value=\"' + String(item.name || '').replace(/\"/g, '&quot;') + '\">'
        + '<input class="ps-input" data-field=\"stage-budget\" type=\"number\" min=\"0\" placeholder=\"Сумма\" value=\"' + Number(item.budget || 0) + '\">'
        + '<input data-field=\"stage-color\" type=\"color\" value=\"' + (item.color || '#4a9eff') + '\" style=\"height:40px;border:1px solid var(--bd);border-radius:10px;background:var(--sf2);padding:4px;\">'
        + '<button type=\"button\" data-field=\"stage-remove\" class=\"ps-stage-remove\" title=\"Удалить этап\" aria-label=\"Удалить этап\">'
        + '<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" aria-hidden=\"true\">'
        + '<path d=\"M3 6h18\"></path>'
        + '<path d=\"M8 6V4h8v2\"></path>'
        + '<path d=\"M19 6l-1 14H6L5 6\"></path>'
        + '<path d=\"M10 11v6\"></path>'
        + '<path d=\"M14 11v6\"></path>'
        + '</svg>'
        + '</button>';
      const removeButton = row.querySelector('[data-field=\"stage-remove\"]');
      removeButton.onclick = async function () {
        await handleStageRemoveRequest(row, createRow);
      };
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
      return [];
    }
    const rows = Array.from(list.querySelectorAll('.ps-stage-row'));
    const result = [];
    rows.forEach(function (row) {
      const nameInput = row.querySelector('[data-field=\"stage-name\"]');
      const budgetInput = row.querySelector('[data-field=\"stage-budget\"]');
      const colorInput = row.querySelector('[data-field=\"stage-color\"]');
      const name = String((nameInput && nameInput.value) || '').trim();
      if (!name) {
        return;
      }
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
    return result;
  }

  function syncProjectBudgetInputFromStageRows() {
    const stageSettings = collectStageSettingsFromModal();
    const total = stageSettings.reduce(function (sum, item) {
      return sum + Number(item.budget || 0);
    }, 0);
    const budgetInput = document.getElementById('ps-budget');
    if (budgetInput) {
      budgetInput.value = String(Math.max(0, Math.round(total)));
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
        overlay.addEventListener('click', function (event) {
          if (event.target === overlay) {
            overlay.remove();
            resolve(null);
          }
        });
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
    const stageBudget = getRowStageBudget(row);
    const rows = readCurrentStageRows();
    if (rows.length <= 1) {
      showError('В проекте должен остаться хотя бы один этап');
      return;
    }

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

  function fillManualTaskStageOptions() {
    const stageSelect = document.getElementById('ntm-stage');
    if (!stageSelect) {
      return;
    }
    const stages = getCurrentProjectStages();
    const options = stages.length > 0 ? stages : ['A'];
    stageSelect.innerHTML = '';
    options.forEach(function (stage) {
      ensureStageColor(stage, null);
      const option = document.createElement('option');
      option.value = stage;
      option.textContent = stage;
      stageSelect.appendChild(option);
    });
  }

  function resetManualTaskForm() {
    const title = document.getElementById('ntm-title');
    const stage = document.getElementById('ntm-stage');
    const agent = document.getElementById('ntm-agent');
    const track = document.getElementById('ntm-track');
    const size = document.getElementById('ntm-size');
    const hours = document.getElementById('ntm-hours');
    const priority = document.getElementById('ntm-priority');
    const desc = document.getElementById('ntm-desc');
    const notes = document.getElementById('ntm-notes');
    if (!title || !stage || !agent || !track || !size || !hours || !priority || !desc || !notes) {
      return;
    }

    title.value = '';
    stage.selectedIndex = 0;
    agent.value = 'Без агента';
    track.value = 'Backend';
    size.value = 'M';
    hours.value = '8';
    priority.value = '0';
    desc.value = '';
    notes.value = '';
  }

  function setTaskCreateMode(mode) {
    const isManual = mode === 'manual';
    newTaskCreateMode = isManual ? 'manual' : 'ai';

    const aiButton = document.getElementById('nt-mode-ai');
    const manualButton = document.getElementById('nt-mode-manual');
    const chat = document.getElementById('nt-chat');
    const preview = document.getElementById('task-preview');
    const inputRow = document.querySelector('#nt-ov .nt-input-row');
    const manualWrap = document.getElementById('nt-manual-wrap');

    if (aiButton) {
      aiButton.classList.toggle('active', !isManual);
    }
    if (manualButton) {
      manualButton.classList.toggle('active', isManual);
    }
    if (chat) {
      chat.style.display = isManual ? 'none' : '';
    }
    if (inputRow) {
      inputRow.style.display = isManual ? 'none' : 'flex';
    }
    if (preview) {
      if (isManual) {
        preview.classList.remove('show');
      }
      preview.style.display = isManual ? 'none' : '';
    }
    if (manualWrap) {
      manualWrap.style.display = isManual ? 'block' : 'none';
    }

    if (isManual) {
      fillManualTaskStageOptions();
      setTimeout(function () {
        const title = document.getElementById('ntm-title');
        if (title) {
          title.focus();
        }
      }, 0);
    } else {
      setTimeout(function () {
        const input = document.getElementById('nt-ta');
        if (input) {
          input.focus();
        }
      }, 0);
    }
  }

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
      !descInput ||
      !notesInput
    ) {
      return;
    }

    const title = String(titleInput.value || '').trim();
    if (!title) {
      titleInput.focus();
      return;
    }

    submitButton.disabled = true;
    try {
      await createTaskFromPreview({
        title: title,
        stage: String(stageInput.value || 'A').trim() || 'A',
        agent: String(agentInput.value || 'Без агента').trim() || 'Без агента',
        track: String(trackInput.value || '').trim(),
        size: String(sizeInput.value || 'M').trim() || 'M',
        hours: Math.max(0, Number(hoursInput.value || 0)),
        priority: Math.max(0, Number(priorityInput.value || 0)),
        desc: String(descInput.value || '').trim(),
        notes: String(notesInput.value || '').trim(),
      });

      closeNewTask();
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

  function ensureManualTaskCreatorUI() {
    const modal = document.querySelector('#nt-ov .nt-modal');
    const header = document.querySelector('#nt-ov .nt-hd');
    if (!modal || !header) {
      return;
    }

    if (!document.getElementById('nt-mode-switch')) {
      const switcher = document.createElement('div');
      switcher.className = 'nt-mode-switch';
      switcher.id = 'nt-mode-switch';
      switcher.innerHTML = ''
        + '<button type="button" class="nt-mode-btn active" id="nt-mode-ai">✦ AI</button>'
        + '<button type="button" class="nt-mode-btn" id="nt-mode-manual">✍ Ручная</button>';

      const closeButton = header.querySelector('.tm-close');
      if (closeButton) {
        header.insertBefore(switcher, closeButton);
      } else {
        header.appendChild(switcher);
      }
    }

    if (!document.getElementById('nt-manual-wrap')) {
      const wrap = document.createElement('div');
      wrap.className = 'nt-manual-wrap';
      wrap.id = 'nt-manual-wrap';
      wrap.innerHTML = ''
        + '<div class="nt-manual-grid">'
        + '<div class="nt-manual-field full">'
        + '<div class="nt-manual-label">Название задачи</div>'
        + '<input id="ntm-title" class="ps-input" placeholder="Что нужно сделать">'
        + '</div>'
        + '<div class="nt-manual-field"><div class="nt-manual-label">Этап</div><select id="ntm-stage" class="ps-input"></select></div>'
        + '<div class="nt-manual-field"><div class="nt-manual-label">Агент</div><select id="ntm-agent" class="ps-input">'
        + '<option value="Без агента">Без агента</option>'
        + '<option value="Claude">Claude</option>'
        + '<option value="Cursor">Cursor</option>'
        + '<option value="Codex">Codex</option>'
        + '<option value="v0.dev">v0.dev</option>'
        + '</select></div>'
        + '<div class="nt-manual-field"><div class="nt-manual-label">Трек</div><select id="ntm-track" class="ps-input">'
        + '<option value="Backend" selected>Backend</option>'
        + '<option value="Frontend">Frontend</option>'
        + '<option value="QA">QA</option>'
        + '<option value="DevOps">DevOps</option>'
        + '<option value="Design">Design</option>'
        + '<option value="Analytics">Analytics</option>'
        + '<option value="Security">Security</option>'
        + '<option value="Integrations">Integrations</option>'
        + '<option value="Product">Product</option>'
        + '</select></div>'
        + '<div class="nt-manual-field"><div class="nt-manual-label">Размер</div><select id="ntm-size" class="ps-input">'
        + '<option value="S">S</option><option value="M" selected>M</option><option value="L">L</option><option value="XL">XL</option>'
        + '</select></div>'
        + '<div class="nt-manual-field"><div class="nt-manual-label">Часы</div><input id="ntm-hours" type="number" min="0" step="1" value="8" class="ps-input"></div>'
        + '<div class="nt-manual-field"><div class="nt-manual-label">Приоритет</div><input id="ntm-priority" type="number" min="0" step="1" value="0" class="ps-input"></div>'
        + '<div class="nt-manual-field full"><div class="nt-manual-label">Описание</div><textarea id="ntm-desc" class="imp-textarea" style="height:120px;" placeholder="Описание задачи"></textarea></div>'
        + '<div class="nt-manual-field full"><div class="nt-manual-label">Заметки</div><textarea id="ntm-notes" class="imp-textarea" style="height:90px;" placeholder="Дополнительно"></textarea></div>'
        + '</div>'
        + '<div class="nt-manual-actions">'
        + '<button type="button" class="btn-revise" id="ntm-cancel">Отмена</button>'
        + '<button type="button" class="btn-confirm" id="ntm-create">Создать задачу</button>'
        + '</div>';
      modal.appendChild(wrap);
    }

    const aiButton = document.getElementById('nt-mode-ai');
    const manualButton = document.getElementById('nt-mode-manual');
    const cancelButton = document.getElementById('ntm-cancel');
    const createButton = document.getElementById('ntm-create');

    if (aiButton) {
      aiButton.onclick = function () {
        setTaskCreateMode('ai');
      };
    }
    if (manualButton) {
      manualButton.onclick = function () {
        setTaskCreateMode('manual');
      };
    }
    if (cancelButton) {
      cancelButton.onclick = function () {
        setTaskCreateMode('ai');
      };
    }
    if (createButton) {
      createButton.onclick = function () {
        createManualTaskFromForm();
      };
    }
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
    return new Promise(function () {});
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

    const response = await fetch(path, {
      method: method,
      headers: headers,
      body: body,
    });

    if (response.status === 401) {
      authToken = '';
      localStorage.removeItem('pk24_token');
      localStorage.removeItem('pk24_email');
      location.replace('/login.html');
      return new Promise(function () {});
    }

    if (!response.ok) {
      let errorCode = response.status + '';
      try {
        const errorBody = await response.json();
        if (errorBody && errorBody.error) {
          errorCode = errorBody.error;
        }
      } catch (_) {
        // ignore parse errors
      }
      throw new Error(errorCode);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  function mapProjectFromApi(project) {
    const stageSettings = Array.isArray(project.stage_settings)
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
    stageSettings.forEach(function (stage) {
      if (stage.color) {
        ensureStageColor(stage.name, stage.color);
      }
    });

    return {
      id: project.id,
      name: project.name,
      weeks: Number(project.duration_weeks || 0),
      budget: Number(project.budget_total || 0),
      stages: stageSettings.length > 0
        ? stageSettings.map(function (item) {
            return item.name;
          })
        : Array.isArray(project.stages)
        ? project.stages.slice()
        : DEFAULT_STAGE_LIST.slice(),
      stageSettings: stageSettings,
    };
  }

  function normalizeUiCol(apiCol) {
    return API_TO_UI_COL[(apiCol || '').toLowerCase()] || 'backlog';
  }

  function normalizeApiCol(uiCol) {
    return UI_TO_API_COL[(uiCol || '').toLowerCase()] || 'backlog';
  }

  function mapTaskFromApi(task) {
    const stage = (task.stage || 'A').trim() || 'A';
    ensureStageColor(stage);
    const publicIdNumber = Number(task.public_id || 0);
    const displayId =
      publicIdNumber > 0
        ? 'T-' + String(publicIdNumber).padStart(6, '0')
        : String(task.id || '');
    const hours = Number(task.hours || 0);
    let size = String(task.size || '').toUpperCase();
    if (!['S', 'M', 'L', 'XL'].includes(size)) {
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
    return {
      id: displayId,
      raw_id: task.id,
      public_id: publicIdNumber > 0 ? publicIdNumber : null,
      title: task.title || 'Untitled',
      col: normalizeUiCol(task.col),
      position: Number.isFinite(Number(task.position)) ? Number(task.position) : 0,
      stage: stage,
      track: task.track || '',
      agent: task.agent || 'Claude',
      size: size,
      hours: hours,
      desc: task.descript || task.description || '',
      notes: task.notes || '',
      deps: task.deps || '',
      priority: Number(task.priority || 0),
    };
  }

  function mapTaskDialogToPreview(taskDialogData) {
    return {
      title: taskDialogData.title,
      desc: taskDialogData.descript,
      stage: taskDialogData.stage || 'A',
      agent: 'Claude',
      size: 'M',
      hours: 8,
      track: 'Backend',
      priority: Number(taskDialogData.priority || 0),
    };
  }

  function getCurrentProjectStages() {
    const currentProject = getActiveProject();
    if (
      currentProject &&
      Array.isArray(currentProject.stageSettings) &&
      currentProject.stageSettings.length > 0
    ) {
      return currentProject.stageSettings.map(function (item) {
        return item.name;
      });
    }
    if (currentProject && Array.isArray(currentProject.stages) && currentProject.stages.length > 0) {
      return currentProject.stages.slice();
    }
    return DEFAULT_STAGE_LIST.slice();
  }

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
    if (delayChip) {
      delayChip.classList.remove('hidden');
    }

    if (projectCompletedMode) {
      button.textContent = '◆ Проект завершен';
      button.classList.add('completed-mode');
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
      + '.nt-mode-switch{display:flex;gap:6px;margin-left:auto;margin-right:10px;}'
      + '.nt-mode-btn{height:30px;padding:0 10px;border-radius:8px;background:var(--sf2);border:1px solid var(--bd2);'
      + 'color:var(--tx2);font-family:Syne,sans-serif;font-size:11px;font-weight:700;cursor:pointer;transition:all .15s;}'
      + '.nt-mode-btn:hover{border-color:var(--gold);color:var(--tx);}'
      + '.nt-mode-btn.active{background:var(--gold-dim);border-color:rgba(240,165,0,.45);color:var(--gold);}'
      + '.nt-manual-wrap{display:none;padding:14px 16px;overflow:auto;flex:1;min-height:260px;}'
      + '.nt-manual-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}'
      + '.nt-manual-field{display:flex;flex-direction:column;gap:6px;}'
      + '.nt-manual-field.full{grid-column:1/-1;}'
      + '.nt-manual-label{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;font-family:DM Mono,monospace;}'
      + '.nt-manual-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;}'
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
      + '.profile-overlay{justify-content:flex-end;align-items:stretch;padding:0;}'
      + '.profile-drawer{'
      + 'width:min(1120px,96vw);height:100%;background:var(--mbg);border-left:1px solid var(--bd2);'
      + 'box-shadow:var(--sh-lg);display:flex;flex-direction:column;transform:translateX(24px);'
      + 'transition:transform .22s ease;'
      + '}'
      + '.profile-overlay.open .profile-drawer{transform:translateX(0);}'
      + '.profile-hd{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--bd);}'
      + '.profile-title{font-family:Syne,sans-serif;font-size:20px;font-weight:700;color:var(--tx);}'
      + '.profile-sub{font-size:11px;color:var(--tx3);margin-top:4px;font-family:DM Mono,monospace;}'
      + '.profile-layout{display:grid;grid-template-columns:260px 1fr;min-height:0;flex:1;overflow:hidden;}'
      + '.profile-nav{padding:14px;border-right:1px solid var(--bd);display:flex;flex-direction:column;gap:8px;overflow:auto;}'
      + '.profile-nav-item{height:42px;padding:0 12px;border-radius:10px;background:var(--sf);border:1px solid var(--bd2);'
      + 'color:var(--tx2);text-align:left;cursor:pointer;font-family:Syne,sans-serif;font-size:12px;font-weight:700;transition:all .18s;}'
      + '.profile-nav-item:hover{background:var(--sf2);border-color:var(--bd3);color:var(--tx);}'
      + '.profile-nav-item.active{background:var(--gold-dim);border-color:rgba(240,165,0,.45);color:var(--gold);}'
      + '.profile-content{padding:18px;overflow:auto;}'
      + '.profile-pane{display:flex;flex-direction:column;gap:12px;}'
      + '.profile-pane-title{font-family:Syne,sans-serif;font-size:18px;font-weight:700;color:var(--tx);}'
      + '.profile-pane-sub{font-size:12px;color:var(--tx2);line-height:1.5;}'
      + '.profile-empty{padding:14px;border:1px dashed var(--bd2);border-radius:10px;color:var(--tx3);font-size:12px;}'
      + '.profile-cards{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr));gap:10px;}'
      + '.profile-card{padding:12px;border-radius:12px;background:var(--sf);border:1px solid var(--bd2);}'
      + '.profile-card-label{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;}'
      + '.profile-card-value{margin-top:8px;font-size:13px;color:var(--tx);font-family:Syne,sans-serif;font-weight:700;}'
      + '.profile-card-sub{margin-top:4px;font-size:11px;color:var(--tx3);}'
      + '.profile-role-list{display:flex;flex-direction:column;gap:8px;}'
      + '.profile-role-row{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--sf);border:1px solid var(--bd2);border-radius:10px;}'
      + '.profile-role-name{font-size:13px;color:var(--tx);font-family:Syne,sans-serif;}'
      + '.profile-role-meta{font-size:11px;color:var(--tx2);}'
      + '.profile-inline-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}'
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
      + '.trash-filters{display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr;gap:8px;align-items:center;}'
      + '.trash-filter-actions{display:flex;gap:6px;justify-content:flex-end;}'
      + '.trash-head{display:grid;grid-template-columns:110px minmax(180px,1.6fr) 150px 150px 150px 110px 100px 230px;'
      + 'padding:0 10px;font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;min-width:1100px;}'
      + '.trash-list{display:flex;flex-direction:column;gap:8px;min-width:1100px;}'
      + '.trash-row{display:grid;grid-template-columns:110px minmax(180px,1.6fr) 150px 150px 150px 110px 100px 230px;'
      + 'gap:0;padding:8px 10px;background:var(--sf);border:1px solid var(--bd2);border-radius:11px;align-items:center;}'
      + '.trash-cell{font-size:11px;color:var(--tx2);padding-right:8px;line-height:1.4;min-width:0;}'
      + '.trash-cell.id{font-family:Syne,sans-serif;color:var(--tx);font-weight:700;}'
      + '.trash-cell.title{display:flex;flex-direction:column;gap:2px;}'
      + '.trash-title-main{font-size:12px;color:var(--tx);font-family:Syne,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      + '.trash-title-sub{font-size:10px;color:var(--tx3);}'
      + '.trash-cell.actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;}'
      + '.trash-stage{display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;border:1px solid var(--bd2);'
      + 'color:var(--stage-color);font-size:10px;font-weight:700;}'
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
      + '.trash-filters{grid-template-columns:1fr 1fr;}'
      + '.trash-filter-actions{grid-column:1/-1;justify-content:flex-start;}'
      + '.profile-restore-grid{grid-template-columns:1fr 1fr;}'
      + '}'
      + '@media (max-width: 760px){'
      + '.profile-drawer{width:100vw;}'
      + '.profile-layout{grid-template-columns:1fr;}'
      + '.profile-nav{border-right:none;border-bottom:1px solid var(--bd);}'
      + '.profile-nav-item{height:36px;}'
      + '.trash-filters{grid-template-columns:1fr;}'
      + '.profile-restore-grid{grid-template-columns:1fr;}'
      + '}';
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
        + '<div class="bridge-confirm-title">Вы точно хотите вернуться к проекту?</div>'
        + '<div class="bridge-confirm-sub">Таймер разработки снова запустится и проект выйдет из режима завершения.</div>'
        + '<div class="bridge-confirm-row">'
        + '<button class="bridge-confirm-btn no" id="resume-project-no">Нет</button>'
        + '<button class="bridge-confirm-btn yes" id="resume-project-yes">Да</button>'
        + '</div>'
        + '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) {
          overlay.remove();
        }
      });
    }

    overlay.classList.add('open');
    const noButton = document.getElementById('resume-project-no');
    const yesButton = document.getElementById('resume-project-yes');
    noButton.onclick = function () {
      overlay.remove();
    };
    yesButton.onclick = async function () {
      yesButton.disabled = true;
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
        overlay.remove();
      }
    };
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
        + '<div class="bridge-confirm-sub">Проект и все его задачи будут удалены безвозвратно.</div>'
        + '<div class="bridge-delete-hint">Для подтверждения введите точное название проекта:</div>'
        + '<div class="bridge-delete-name" id="delete-project-name-ref"></div>'
        + '<input id="delete-project-name-input" class="bridge-delete-input" placeholder="Введите название проекта">'
        + '<div class="bridge-confirm-row">'
        + '<button class="bridge-confirm-btn no" id="delete-project-no">Отмена</button>'
        + '<button class="bridge-confirm-btn danger" id="delete-project-yes" disabled>Удалить</button>'
        + '</div>'
        + '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) {
          overlay.remove();
        }
      });
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
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) {
          overlay.remove();
        }
      });
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
        if (activeProfileSection === 'trash') {
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

  async function syncCompletionMode() {
    if (!activeProjId || completionTransitionInFlight) {
      projectCompletedMode = false;
      timerFrozen = false;
      return;
    }

    const completed = isProjectCompleted();
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
      if (!activeProjId) {
        document.getElementById('tl-back').textContent = '0';
        document.getElementById('tl-wip').textContent = '0';
        document.getElementById('tl-done').textContent = '0';
        document.getElementById('b-earned').textContent = '0 ₽';
        document.getElementById('progress-fill').style.width = '0%';
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

      const totalEl = document.querySelector('.b-total');
      if (totalEl) {
        totalEl.textContent = '/ ' + fmtBudget(total) + ' ₽';
      }
      await syncCompletionMode();
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
    allButton.innerHTML = 'Все <span class="cnt">' + tasks.length + '</span>';
    stageBar.insertBefore(allButton, searchWrap);

    const visibleStages = getVisibleStagesFromTasks();
    if (curStage !== 'all' && !visibleStages.includes(curStage)) {
      curStage = 'all';
    }
    visibleStages.forEach(function (stage) {
      const count = tasks.filter(function (task) {
        return task.stage === stage;
      }).length;
      const stageColor = ensureStageColor(stage);
      const button = document.createElement('button');
      button.className = 'stab' + (curStage === stage ? ' active' : '');
      button.dataset.stage = stage;
      button.onclick = function () {
        setStage(stage, button);
      };
      button.innerHTML = stage + ' <span class="cnt">' + count + '</span>';
      STAB_C[stage] = stageColor;
      stageBar.insertBefore(button, searchWrap);
    });

    updateStageTabs();
  }

  function getFilteredTasks() {
    let filtered = tasks;

    if (curStage !== 'all') {
      filtered = filtered.filter(function (task) {
        return task.stage === curStage;
      });
    }

    if (searchQ) {
      filtered = filtered.filter(function (task) {
        const haystack = [
          task.id || '',
          task.raw_id || '',
          task.public_id != null ? String(task.public_id) : '',
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
    COLS.forEach(function (column) {
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
    const rawId = task && task.raw_id ? task.raw_id : taskId;
    await apiFetch('/tasks/' + rawId + '/move', {
      method: 'POST',
      body: {
        col: apiCol,
      },
    });
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

    const payload = {
      title: previewTask.title,
      stage: previewTask.stage || 'A',
      col: normalizeApiCol(newTaskCol || 'backlog'),
      track: previewTask.track || null,
      agent: previewTask.agent || null,
      priority: Number(previewTask.priority || 0),
      hours: Number(previewTask.hours || 0),
      descript: previewTask.desc || null,
      notes: previewTask.notes || null,
      deps: null,
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
      const budgetBarWrap = document.querySelector('.b-bar-wrap');
      if (budgetBarWrap) {
        budgetBarWrap.style.display = 'none';
      }

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
      showError('API bootstrap failed: ' + error.message);
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

    if (!name) {
      document.getElementById('ps-name').focus();
      return;
    }
    if (stageSettings.length === 0) {
      showError('Добавьте хотя бы один этап проекта');
      return;
    }

    const stageBudgetTotal = stageSettings.reduce(function (sum, item) {
      return sum + Number(item.budget || 0);
    }, 0);
    const budget = stageBudgetTotal > 0 ? stageBudgetTotal : Math.max(0, budgetInputValue);

    try {
      if (editingProjId === '__new__') {
        const payload = {
          name: name,
          duration_weeks: Math.max(0, weeks),
          budget_total: Math.max(0, budget),
          stages: stageSettings.map(function (item) {
            return item.name;
          }),
          stage_settings: stageSettings,
        };
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
        };

        await applyPendingStageActions(editingProjId, finalStageSettings);
        await apiFetch('/projects/' + editingProjId, {
          method: 'PATCH',
          body: payload,
        });
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
      showError('Project save failed: ' + error.message);
    }
  };

  deleteProject = function () {
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
    openDeleteProjectConfirmModal(project);
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

  sendMsg = async function () {
    const input = document.getElementById('ai-in');
    const text = input.value.trim();
    if (!text || !activeId) {
      return;
    }

    const task = tasks.find(function (item) {
      return item.id === activeId;
    });
    if (!task) {
      return;
    }

    input.value = '';
    input.style.height = 'auto';
    appendTo('ai-msgs', 'user', text);
    chatHist.push({ role: 'user', content: text });

    const button = document.getElementById('ai-btn');
    button.disabled = true;
    showTyping('ai-msgs');

    const systemMessage =
      'Ты технический лид PlanKanban. Отвечай кратко и по делу. Контекст задачи: ' +
      task.title +
      '. stage=' +
      (task.stage || 'A') +
      ', agent=' +
      (task.agent || 'Claude') +
      ', description=' +
      (task.desc || '');

    try {
      const response = await apiFetch('/api/llm/chat', {
        method: 'POST',
        body: {
          purpose: 'chat',
          project_id: activeProjId || null,
          messages: [
            { role: 'system', content: systemMessage },
          ].concat(chatHist),
          params: {
            max_tokens: 700,
            temperature: 0.2,
          },
        },
      });

      const reply = (response && response.text) || 'Нет ответа';
      chatHist.push({ role: 'assistant', content: reply });
      hideTyping('ai-msgs');
      appendTo('ai-msgs', 'ai', reply);
    } catch (error) {
      hideTyping('ai-msgs');
      appendTo('ai-msgs', 'ai', '! LLM error: ' + error.message);
    }

    button.disabled = false;
  };

  sendNewTask = async function () {
    const input = document.getElementById('nt-ta');
    const text = input.value.trim();
    if (!text) {
      return;
    }

    input.value = '';
    input.style.height = 'auto';
    appendTo('nt-chat', 'user', text);
    ntHist.push({ role: 'user', content: text });

    const button = document.getElementById('nt-btn');
    button.disabled = true;
    showTyping('nt-chat');

    try {
      if (text.length < 12) {
        hideTyping('nt-chat');
        appendTo('nt-chat', 'ai', 'Уточни задачу подробнее: цель, результат и ограничения.');
        button.disabled = false;
        return;
      }

      const response = await apiFetch('/llm/task-dialog', {
        method: 'POST',
        body: {
          project_id: activeProjId || null,
          messages: ntHist,
        },
      });

      const preview = mapTaskDialogToPreview(response);
      pendingTask = preview;
      ntHist.push({
        role: 'assistant',
        content:
          'Сформировал задачу: ' +
          preview.title +
          '. Проверь и подтвердите добавление в backlog.',
      });
      hideTyping('nt-chat');
      appendTo(
        'nt-chat',
        'ai',
        'Сформировал задачу. Проверьте блок preview ниже и нажмите "Добавить в Backlog".'
      );
      showPreview(preview);
    } catch (error) {
      hideTyping('nt-chat');
      appendTo('nt-chat', 'ai', '! LLM error: ' + error.message);
    }

    button.disabled = false;
  };

  confirmTask = async function () {
    if (!pendingTask) {
      return;
    }

    try {
      await createTaskFromPreview(pendingTask);
      pendingTask = null;
      closeNewTask();
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
    }
  };

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

    const parseButton = document.getElementById('imp-parse-btn');
    parseButton.textContent = '⏳ Импорт...';
    parseButton.disabled = true;
    document.getElementById('imp-status').textContent = 'Обработка файла и создание задач...';

    try {
      const response = await apiFetch('/import/excel', {
        method: 'POST',
        body: {
          project_id: activeProjId || null,
          content: content,
          file_name: fileName,
        },
      });

      const createdTasks = (response.tasks || []).map(mapTaskFromApi);
      importParsedTasks = createdTasks;
      renderImportPreview(createdTasks);
      parseButton.textContent = 'Готово';
      document.getElementById('imp-status').textContent =
        'Создано задач: ' + Number(response.created || createdTasks.length);
      document.getElementById('imp-confirm-btn').style.display = 'none';

      await loadTasksForActiveProject();
      render();
      syncColumnEmptyStates();
      updateStageTabs();
      scheduleHeaderRefresh();
      await syncCompletionMode();
      applyTimerFromSnapshot();
    } catch (error) {
      parseButton.textContent = 'Ошибка';
      document.getElementById('imp-status').textContent = 'Import error: ' + error.message;
      document.getElementById('imp-status').style.color = 'var(--red)';
    } finally {
      parseButton.disabled = false;
    }
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

  const originalOpenNewTask = openNewTask;
  openNewTask = function (col) {
    originalOpenNewTask(col);
    ensureManualTaskCreatorUI();
    fillManualTaskStageOptions();
    resetManualTaskForm();
    setTaskCreateMode('ai');
  };

  const originalCloseNewTask = closeNewTask;
  closeNewTask = function () {
    originalCloseNewTask();
    setTaskCreateMode('ai');
  };

  const originalOpenTask = openTask;
  openTask = function (id) {
    originalOpenTask(id);
    ensureTaskDeleteButton();
  };

  const originalOpenNewProjectModal = openNewProjectModal;
  openNewProjectModal = function () {
    originalOpenNewProjectModal();
    const weeksInput = document.getElementById('ps-weeks');
    const budgetInput = document.getElementById('ps-budget');
    if (weeksInput) weeksInput.value = '0';
    if (budgetInput) budgetInput.value = '0';
    pendingStageActionsByProject.__new__ = [];
    ensureStageSettingsEditor([
      {
        name: 'A',
        budget: 0,
        color: ensureStageColor('A', EXTRA_STAGE_COLORS[0]),
      },
    ]);
    syncProjectBudgetInputFromStageRows();
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
    const deleteButton = document.getElementById('btn-delete-proj');
    if (deleteButton) {
      deleteButton.classList.remove('hidden');
      deleteButton.onclick = function () {
        deleteProject();
      };
    }
  };

  window.addEventListener('load', function () {
    bootstrapFromApi();
  });
})();
