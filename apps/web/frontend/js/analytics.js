(function () {
  const SECTION_META = {
    metrics_project: {
      title: '\u041c\u0435\u0442\u0440\u0438\u043a\u0438 \u043f\u0440\u043e\u0435\u043a\u0442\u0430',
      subtitle:
        '\u041f\u0440\u043e\u0433\u0440\u0435\u0441\u0441 \u043f\u0440\u043e\u0435\u043a\u0442\u0430 \u0438 \u0441\u043a\u043e\u0440\u043e\u0441\u0442\u044c \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f.',
    },
    metrics_tasks: {
      title: '\u041c\u0435\u0442\u0440\u0438\u043a\u0438 \u0437\u0430\u0434\u0430\u0447',
      subtitle:
        '\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u0435\u043b\u0438 \u043f\u043e \u0436\u0438\u0437\u043d\u0435\u043d\u043d\u043e\u043c\u0443 \u0446\u0438\u043a\u043b\u0443 \u0437\u0430\u0434\u0430\u0447 \u043d\u0430 \u043e\u0441\u043d\u043e\u0432\u0435 task_events.',
    },
    metrics_time: {
      title: '\u041c\u0435\u0442\u0440\u0438\u043a\u0438 \u0432\u0440\u0435\u043c\u0435\u043d\u0438',
      subtitle:
        '\u0424\u0430\u043a\u0442\u0438\u0447\u0435\u0441\u043a\u043e\u0435 \u0432\u0440\u0435\u043c\u044f \u043f\u0440\u043e\u0435\u043a\u0442\u0430, \u0437\u0430\u0434\u0435\u0440\u0436\u043a\u0438 \u0438 \u0434\u0435\u0434\u043b\u0430\u0439\u043d.',
    },
    metrics_budget: {
      title: '\u041c\u0435\u0442\u0440\u0438\u043a\u0438 \u0431\u044e\u0434\u0436\u0435\u0442\u0430',
      subtitle:
        '\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u0431\u044e\u0434\u0436\u0435\u0442, \u0437\u0430\u0440\u0430\u0431\u043e\u0442\u0430\u043d\u043e \u0438 \u0442\u0435\u043c\u043f \u043e\u0441\u0432\u043e\u0435\u043d\u0438\u044f.',
    },
  };

  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  let stylesInjected = false;

  function asNumber(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return fallback;
    }
    return num;
  }

  function escapeVia(context, value) {
    if (context && typeof context.escapeHtml === 'function') {
      return context.escapeHtml(value);
    }
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value) {
    const num = asNumber(value, 0);
    if (typeof window.fmtBudget === 'function') {
      return window.fmtBudget(num) + ' \u20bd';
    }
    return num.toLocaleString('ru-RU') + ' \u20bd';
  }

  function numberWith1(value) {
    return asNumber(value, 0).toFixed(1);
  }

  function percent(value) {
    const num = Math.max(0, asNumber(value, 0));
    return num.toFixed(1) + '%';
  }

  function durationHuman(ms) {
    const totalMs = Math.max(0, asNumber(ms, 0));
    const totalMinutes = Math.floor(totalMs / 60000);
    const minutes = totalMinutes % 60;
    const totalHours = Math.floor(totalMinutes / 60);
    const hours = totalHours % 24;
    const days = Math.floor(totalHours / 24);
    const weeks = Math.floor(days / 7);
    const remDays = days % 7;
    return (
      weeks +
      ' \u043d\u0435\u0434 ' +
      remDays +
      ' \u0434\u043d ' +
      String(hours).padStart(2, '0') +
      ':' +
      String(minutes).padStart(2, '0')
    );
  }

  function deadlineRemaining(deadlineIso) {
    if (!deadlineIso) {
      return '\u2014';
    }
    const deadlineMs = Date.parse(deadlineIso);
    if (!Number.isFinite(deadlineMs)) {
      return '\u2014';
    }
    const diff = deadlineMs - Date.now();
    if (diff <= 0) {
      return '\u041f\u0440\u043e\u0441\u0440\u043e\u0447\u0435\u043d';
    }
    return durationHuman(diff);
  }

  function injectStyles() {
    if (stylesInjected) {
      return;
    }
    stylesInjected = true;
    const style = document.createElement('style');
    style.id = 'pk-analytics-styles';
    style.textContent =
      '' +
      '.analytics-grid{display:grid;grid-template-columns:repeat(2,minmax(220px,1fr));gap:10px;}' +
      '.analytics-card{padding:12px;border-radius:12px;background:var(--sf);border:1px solid var(--bd2);}' +
      '.analytics-label{font-size:10px;color:var(--tx3);text-transform:uppercase;letter-spacing:1px;font-family:DM Mono,monospace;}' +
      '.analytics-value{margin-top:8px;font-size:18px;color:var(--tx);font-family:Syne,sans-serif;font-weight:700;}' +
      '.analytics-sub{margin-top:4px;font-size:11px;color:var(--tx2);}' +
      '.analytics-progress{margin-top:12px;height:8px;border-radius:999px;background:var(--sf2);border:1px solid var(--bd2);overflow:hidden;}' +
      '.analytics-progress-fill{height:100%;background:linear-gradient(90deg,var(--green),var(--gold));width:0%;transition:width .25s ease;}' +
      '.analytics-wide{padding:12px;border-radius:12px;background:var(--sf);border:1px solid var(--bd2);}' +
      '.analytics-wide-row{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--tx2);}' +
      '.analytics-wide-row strong{color:var(--tx);font-family:Syne,sans-serif;font-size:14px;}' +
      '@media (max-width: 980px){.analytics-grid{grid-template-columns:1fr;}}';
    document.head.appendChild(style);
  }

  function contentRoot() {
    return document.getElementById('profile-content');
  }

  function renderLoading(context, meta) {
    const root = contentRoot();
    if (!root) {
      return;
    }
    root.innerHTML =
      '' +
      '<div class="profile-pane">' +
      '<div class="profile-pane-title">' +
      escapeVia(context, meta.title) +
      '</div>' +
      '<div class="profile-pane-sub">' +
      escapeVia(context, meta.subtitle) +
      '</div>' +
      '<div class="profile-empty">\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430 \u043c\u0435\u0442\u0440\u0438\u043a...</div>' +
      '</div>';
  }

  function renderEmpty(context, meta) {
    const root = contentRoot();
    if (!root) {
      return;
    }
    root.innerHTML =
      '' +
      '<div class="profile-pane">' +
      '<div class="profile-pane-title">' +
      escapeVia(context, meta.title) +
      '</div>' +
      '<div class="profile-pane-sub">' +
      escapeVia(context, meta.subtitle) +
      '</div>' +
      '<div class="profile-empty">\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u043f\u0440\u043e\u0435\u043a\u0442, \u0447\u0442\u043e\u0431\u044b \u0443\u0432\u0438\u0434\u0435\u0442\u044c \u0430\u043d\u0430\u043b\u0438\u0442\u0438\u043a\u0443.</div>' +
      '</div>';
  }

  function renderError(context, meta, errorMessage) {
    const root = contentRoot();
    if (!root) {
      return;
    }
    root.innerHTML =
      '' +
      '<div class="profile-pane">' +
      '<div class="profile-pane-title">' +
      escapeVia(context, meta.title) +
      '</div>' +
      '<div class="profile-pane-sub">' +
      escapeVia(context, meta.subtitle) +
      '</div>' +
      '<div class="profile-empty">\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u043c\u0435\u0442\u0440\u0438\u043a: ' +
      escapeVia(context, errorMessage) +
      '</div>' +
      '</div>';
  }

  function renderProjectMetrics(context, meta, payload) {
    const root = contentRoot();
    if (!root) {
      return;
    }
    const completion = asNumber(payload.completion_percent, 0);
    root.innerHTML =
      '' +
      '<div class="profile-pane">' +
      '<div class="profile-pane-title">' +
      escapeVia(context, meta.title) +
      '</div>' +
      '<div class="profile-pane-sub">' +
      escapeVia(context, meta.subtitle) +
      '</div>' +
      '<div class="analytics-grid">' +
      '<div class="analytics-card"><div class="analytics-label">\u0412\u0441\u0435\u0433\u043e \u0437\u0430\u0434\u0430\u0447</div><div class="analytics-value">' +
      escapeVia(context, payload.tasks_total) +
      '</div></div>' +
      '<div class="analytics-card"><div class="analytics-label">\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u043e</div><div class="analytics-value">' +
      escapeVia(context, payload.tasks_done) +
      '</div></div>' +
      '<div class="analytics-card"><div class="analytics-label">\u0412 \u0440\u0430\u0431\u043e\u0442\u0435</div><div class="analytics-value">' +
      escapeVia(context, payload.tasks_in_progress) +
      '</div></div>' +
      '<div class="analytics-card"><div class="analytics-label">\u0421\u043a\u043e\u0440\u043e\u0441\u0442\u044c (\u0437\u0430\u0434\u0430\u0447/\u043d\u0435\u0434.)</div><div class="analytics-value">' +
      escapeVia(context, numberWith1(payload.velocity_tasks_per_week)) +
      '</div></div>' +
      '</div>' +
      '<div class="analytics-wide">' +
      '<div class="analytics-wide-row"><span>\u041f\u0440\u043e\u0446\u0435\u043d\u0442 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f</span><strong>' +
      escapeVia(context, percent(completion)) +
      '</strong></div>' +
      '<div class="analytics-progress"><div class="analytics-progress-fill" style="width:' +
      Math.max(0, Math.min(100, completion)) +
      '%"></div></div>' +
      '</div>' +
      '</div>';
  }

  function renderTaskMetrics(context, meta, payload) {
    const root = contentRoot();
    if (!root) {
      return;
    }
    root.innerHTML =
      '' +
      '<div class="profile-pane">' +
      '<div class="profile-pane-title">' +
      escapeVia(context, meta.title) +
      '</div>' +
      '<div class="profile-pane-sub">' +
      escapeVia(context, meta.subtitle) +
      '</div>' +
      '<div class="analytics-grid">' +
      '<div class="analytics-card"><div class="analytics-label">\u0421\u0440\u0435\u0434\u043d\u0438\u0439 \u0446\u0438\u043a\u043b (\u0447)</div><div class="analytics-value">' +
      escapeVia(context, numberWith1(payload.avg_task_cycle_time_hours)) +
      '</div></div>' +
      '<div class="analytics-card"><div class="analytics-label">\u0421\u043e\u0437\u0434\u0430\u043d\u043e \u0437\u0430 7 \u0434\u043d\u0435\u0439</div><div class="analytics-value">' +
      escapeVia(context, payload.tasks_created_last_week) +
      '</div></div>' +
      '<div class="analytics-card"><div class="analytics-label">\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u043e \u0437\u0430 7 \u0434\u043d\u0435\u0439</div><div class="analytics-value">' +
      escapeVia(context, payload.tasks_completed_last_week) +
      '</div></div>' +
      '<div class="analytics-card"><div class="analytics-label">\u0412\u0441\u0435\u0433\u043e \u0437\u0430\u0434\u0430\u0447</div><div class="analytics-value">' +
      escapeVia(context, payload.tasks_total) +
      '</div></div>' +
      '</div>' +
      '</div>';
  }

  function renderTimeMetrics(context, meta, timerPayload) {
    const root = contentRoot();
    if (!root) {
      return;
    }
    const projectMs = asNumber(timerPayload.project_time_ms, 0);
    const delayMs = asNumber(timerPayload.client_delay_time_ms, 0);
    const delayPercentValue = projectMs + delayMs > 0 ? (delayMs / (projectMs + delayMs)) * 100 : 0;
    root.innerHTML =
      '' +
      '<div class="profile-pane">' +
      '<div class="profile-pane-title">' +
      escapeVia(context, meta.title) +
      '</div>' +
      '<div class="profile-pane-sub">' +
      escapeVia(context, meta.subtitle) +
      '</div>' +
      '<div class="analytics-grid">' +
      '<div class="analytics-card"><div class="analytics-label">\u0412\u0440\u0435\u043c\u044f \u043f\u0440\u043e\u0435\u043a\u0442\u0430</div><div class="analytics-value">' +
      escapeVia(context, durationHuman(projectMs)) +
      '</div></div>' +
      '<div class="analytics-card"><div class="analytics-label">\u0417\u0430\u0434\u0435\u0440\u0436\u043a\u0430 \u0437\u0430\u043a\u0430\u0437\u0447\u0438\u043a\u0430</div><div class="analytics-value">' +
      escapeVia(context, durationHuman(delayMs)) +
      '</div></div>' +
      '<div class="analytics-card"><div class="analytics-label">\u0414\u043e \u0434\u0435\u0434\u043b\u0430\u0439\u043d\u0430</div><div class="analytics-value">' +
      escapeVia(context, deadlineRemaining(timerPayload.deadline)) +
      '</div></div>' +
      '<div class="analytics-card"><div class="analytics-label">\u0414\u043e\u043b\u044f \u0437\u0430\u0434\u0435\u0440\u0436\u043a\u0438</div><div class="analytics-value">' +
      escapeVia(context, percent(delayPercentValue)) +
      '</div></div>' +
      '</div>' +
      '<div class="analytics-wide">' +
      '<div class="analytics-wide-row"><span>Delay percent</span><strong>' +
      escapeVia(context, percent(delayPercentValue)) +
      '</strong></div>' +
      '<div class="analytics-progress"><div class="analytics-progress-fill" style="width:' +
      Math.max(0, Math.min(100, delayPercentValue)) +
      '%"></div></div>' +
      '</div>' +
      '</div>';
  }

  function renderBudgetMetrics(context, meta, budgetPayload, timerPayload) {
    const root = contentRoot();
    if (!root) {
      return;
    }
    const total = asNumber(budgetPayload.total, 0);
    const earned = asNumber(budgetPayload.earned, 0);
    const remaining = Math.max(0, total - earned);
    const completion = asNumber(budgetPayload.progress, 0) * 100;
    const elapsedWeeks = asNumber(timerPayload.project_time_ms, 0) / WEEK_MS;
    const burnRate = elapsedWeeks > 0 ? earned / elapsedWeeks : 0;

    root.innerHTML =
      '' +
      '<div class="profile-pane">' +
      '<div class="profile-pane-title">' +
      escapeVia(context, meta.title) +
      '</div>' +
      '<div class="profile-pane-sub">' +
      escapeVia(context, meta.subtitle) +
      '</div>' +
      '<div class="analytics-grid">' +
      '<div class="analytics-card"><div class="analytics-label">\u0411\u044e\u0434\u0436\u0435\u0442 \u0432\u0441\u0435\u0433\u043e</div><div class="analytics-value">' +
      escapeVia(context, money(total)) +
      '</div></div>' +
      '<div class="analytics-card"><div class="analytics-label">\u0417\u0430\u0440\u0430\u0431\u043e\u0442\u0430\u043d\u043e</div><div class="analytics-value">' +
      escapeVia(context, money(earned)) +
      '</div></div>' +
      '<div class="analytics-card"><div class="analytics-label">\u041e\u0441\u0442\u0430\u0442\u043e\u043a</div><div class="analytics-value">' +
      escapeVia(context, money(remaining)) +
      '</div></div>' +
      '<div class="analytics-card"><div class="analytics-label">Burn rate / \u043d\u0435\u0434\u0435\u043b\u044f</div><div class="analytics-value">' +
      escapeVia(context, money(burnRate)) +
      '</div></div>' +
      '</div>' +
      '<div class="analytics-wide">' +
      '<div class="analytics-wide-row"><span>\u041f\u0440\u043e\u0446\u0435\u043d\u0442 \u043e\u0441\u0432\u043e\u0435\u043d\u0438\u044f</span><strong>' +
      escapeVia(context, percent(completion)) +
      '</strong></div>' +
      '<div class="analytics-progress"><div class="analytics-progress-fill" style="width:' +
      Math.max(0, Math.min(100, completion)) +
      '%"></div></div>' +
      '</div>' +
      '</div>';
  }

  async function renderSection(context) {
    const sectionId = context && context.sectionId;
    const meta = SECTION_META[sectionId];
    if (!meta) {
      return;
    }

    injectStyles();
    if (!context.activeProjectId) {
      renderEmpty(context, meta);
      return;
    }

    renderLoading(context, meta);
    try {
      if (sectionId === 'metrics_project') {
        const metrics = await context.apiFetch('/projects/' + context.activeProjectId + '/metrics');
        renderProjectMetrics(context, meta, metrics || {});
        return;
      }

      if (sectionId === 'metrics_tasks') {
        const metrics = await context.apiFetch('/projects/' + context.activeProjectId + '/metrics');
        renderTaskMetrics(context, meta, metrics || {});
        return;
      }

      if (sectionId === 'metrics_time') {
        const timer = await context.apiFetch('/timer');
        renderTimeMetrics(context, meta, timer || {});
        return;
      }

      if (sectionId === 'metrics_budget') {
        const [budget, timer] = await Promise.all([
          context.apiFetch('/stats/budget'),
          context.apiFetch('/timer'),
        ]);
        renderBudgetMetrics(context, meta, budget || {}, timer || {});
      }
    } catch (error) {
      renderError(context, meta, error && error.message ? error.message : 'unknown_error');
    }
  }

  window.PlanKanbanAnalytics = {
    renderSection: renderSection,
  };
})();