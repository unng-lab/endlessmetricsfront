const qs = new URLSearchParams(location.search);
const defaultAPIBase = window.EM_API_BASE || 'http://unng.ru:7074';
const state = {
  apiBase: qs.get('api') || localStorage.getItem('em_api_base') || defaultAPIBase,
  token: localStorage.getItem('em_token') || '',
  user: null,
  organizations: [],
  projects: [],
  counters: [],
  goals: [],
  selectedOrgId: localStorage.getItem('em_org_id') || '',
  selectedProjectId: localStorage.getItem('em_project_id') || '',
  selectedCounterId: localStorage.getItem('em_counter_id') || '',
  tab: localStorage.getItem('em_tab') || 'dashboard',
  overview: null,
  debugEvents: [],
  reports: {},
  audit: []
};

const app = document.getElementById('app');

function api(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(state.apiBase.replace(/\/$/, '') + path, {
    ...options,
    headers,
    credentials: 'include'
  }).then(async (response) => {
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const error = new Error(body.message || response.statusText);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  });
}

function saveConfig() {
  localStorage.setItem('em_api_base', state.apiBase);
  if (state.token) localStorage.setItem('em_token', state.token);
  if (state.selectedOrgId) localStorage.setItem('em_org_id', state.selectedOrgId);
  if (state.selectedProjectId) localStorage.setItem('em_project_id', state.selectedProjectId);
  if (state.selectedCounterId) localStorage.setItem('em_counter_id', state.selectedCounterId);
  localStorage.setItem('em_tab', state.tab);
}

function selectedProject() {
  return state.projects.find((project) => project.id === state.selectedProjectId) || null;
}

function selectedCounter() {
  return state.counters.find((counter) => counter.id === state.selectedCounterId) || state.counters[0] || null;
}

async function bootstrap() {
  if (state.token) {
    await refreshAll().catch(() => {
      state.token = '';
      localStorage.removeItem('em_token');
    });
  }
  render();
}

async function refreshAll() {
  const me = await api('/api/v1/me');
  state.user = me.user;
  state.organizations = me.organizations || [];
  const projects = await api('/api/v1/projects');
  state.projects = projects.projects || [];
  if (!state.organizations.some((org) => org.id === state.selectedOrgId)) {
    state.selectedOrgId = state.organizations[0]?.id || '';
  }
  if (!state.projects.some((project) => project.id === state.selectedProjectId)) {
    state.selectedProjectId = state.projects[0]?.id || '';
  }
  await refreshProjectData();
  saveConfig();
}

async function refreshProjectData() {
  if (!state.selectedProjectId) return;
  const [counters, goals, overview, debug, sources, pages, events, goalsReport, geo, tech, audit] = await Promise.all([
    api(`/api/v1/projects/${state.selectedProjectId}/counters`),
    api(`/api/v1/projects/${state.selectedProjectId}/goals`),
    api(`/api/v1/reports/overview?project_id=${state.selectedProjectId}`),
    api(`/api/v1/debug/events?project_id=${state.selectedProjectId}`),
    api(`/api/v1/reports/sources?project_id=${state.selectedProjectId}`),
    api(`/api/v1/reports/pages?project_id=${state.selectedProjectId}`),
    api(`/api/v1/reports/events?project_id=${state.selectedProjectId}`),
    api(`/api/v1/reports/goals?project_id=${state.selectedProjectId}`),
    api(`/api/v1/reports/geo?project_id=${state.selectedProjectId}`),
    api(`/api/v1/reports/tech?project_id=${state.selectedProjectId}`),
    api(`/api/v1/audit-log?project_id=${state.selectedProjectId}`)
  ]);
  state.counters = counters.counters || [];
  state.goals = goals.goals || [];
  if (!state.selectedCounterId && state.counters[0]) state.selectedCounterId = state.counters[0].id;
  state.overview = overview;
  state.debugEvents = debug.events || [];
  state.reports = { sources, pages, events, goals: goalsReport, geo, tech };
  state.audit = audit.audit_log || [];
}

function render() {
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">EndlessMetrics</div>
        <div>${state.user ? escapeHtml(state.user.email) : 'Not signed in'}</div>
        <div class="nav">
          ${navButton('dashboard', 'Dashboard')}
          ${navButton('setup', 'Setup')}
          ${navButton('reports', 'Reports')}
          ${navButton('debug', 'Debug')}
          ${navButton('goals', 'Goals')}
          ${navButton('security', 'Security')}
        </div>
      </aside>
      <section class="content">
        <div class="topbar">
          <label>API base
            <input data-testid="api-base" value="${escapeAttr(state.apiBase)}" />
          </label>
          <button class="secondary" data-testid="save-api">Save API</button>
          <button class="primary" data-testid="login">${state.user ? 'Refresh' : 'Dev login'}</button>
        </div>
        <div class="status" data-testid="status"></div>
        ${state.user ? renderAuthed() : renderLoginHint()}
      </section>
    </div>
  `;
  bindCommon();
  if (state.user) bindAuthed();
}

function navButton(tab, label) {
  return `<button data-tab="${tab}" class="${state.tab === tab ? 'active' : ''}">${label}</button>`;
}

function renderLoginHint() {
  return `
    <div class="panel">
      <h1>Admin</h1>
      <p>Backend: <code>${escapeHtml(state.apiBase)}</code></p>
      <div class="row">
        <button class="primary" data-testid="quick-demo">Create demo workspace</button>
        <button class="secondary" data-testid="check-backend">Check backend</button>
      </div>
    </div>
    <div class="grid">
      ${metric('Visits', 0, 'preview-visits')}
      ${metric('Pageviews', 0, 'preview-pageviews')}
      ${metric('Goals', 0, 'preview-goals')}
      ${metric('Conversion', '0%', 'preview-conversion')}
    </div>
  `;
}

function renderAuthed() {
  if (state.tab === 'setup') return renderSetup();
  if (state.tab === 'reports') return renderReports();
  if (state.tab === 'debug') return renderDebug();
  if (state.tab === 'goals') return renderGoals();
  if (state.tab === 'security') return renderSecurity();
  return renderDashboard();
}

function renderDashboard() {
  const project = selectedProject();
  const overview = state.overview || {};
  return `
    <div class="panel">
      <h1 data-testid="project-title">${project ? escapeHtml(project.name) : 'No project'}</h1>
      <p>${project ? escapeHtml(project.domain) : 'Create a project to start collecting analytics.'}</p>
      ${project ? '' : '<button class="primary" data-testid="quick-demo">Create demo workspace</button>'}
    </div>
    <div class="grid">
      ${metric('Visits', overview.visits, 'metric-visits')}
      ${metric('Visitors', overview.visitors, 'metric-visitors')}
      ${metric('Pageviews', overview.pageviews, 'metric-pageviews')}
      ${metric('Goals', overview.goals, 'metric-goals')}
      ${metric('Conversion', `${round(overview.conversion_rate)}%`, 'metric-conversion')}
      ${metric('Bounce rate', `${round(overview.bounce_rate)}%`, 'metric-bounce')}
    </div>
  `;
}

function metric(label, value, testId) {
  return `<div class="metric"><span>${label}</span><strong data-testid="${testId}">${value ?? 0}</strong></div>`;
}

function renderSetup() {
  const counter = selectedCounter();
  return `
    <div class="panel">
      <h2>Organization</h2>
      <div class="form">
        <label>Name <input data-testid="org-name" placeholder="Acme Analytics" /></label>
        <button class="primary" data-testid="create-org">Create organization</button>
      </div>
      <p>Current: <span data-testid="current-org">${escapeHtml(state.selectedOrgId || 'none')}</span></p>
    </div>
    <div class="panel">
      <h2>Project</h2>
      <div class="form">
        <label>Name <input data-testid="project-name" placeholder="Main Site" /></label>
        <label>Domain <input data-testid="project-domain" placeholder="localhost" /></label>
        <button class="primary" data-testid="create-project">Create project</button>
      </div>
      <p>Current: <span data-testid="current-project">${escapeHtml(state.selectedProjectId || 'none')}</span></p>
    </div>
    <div class="panel">
      <h2>Counter</h2>
      <button class="primary" data-testid="create-counter">Create counter</button>
      <p>Counter id: <code data-testid="counter-id">${counter ? counter.id : ''}</code></p>
      <p>Public key: <code data-testid="counter-public-key">${counter ? counter.public_key : ''}</code></p>
      <pre data-testid="snippet">${counter ? escapeHtml(renderSnippet(counter.public_key)) : ''}</pre>
    </div>
  `;
}

function renderSnippet(publicKey) {
  return `<script>
  window.sma = window.sma || function(){(window.sma.q = window.sma.q || []).push(arguments)};
  sma('init', { counterId: '${publicKey}', endpoint: '${state.apiBase.replace(/\/$/, '')}/collect', trackSpa: true });
  sma('pageview');
</script>
<script async src="${state.apiBase.replace(/\/$/, '')}/sdk/sma.js"></script>`;
}

function renderReports() {
  const sources = state.reports.sources?.sources || [];
  const pages = state.reports.pages?.pages || [];
  const events = state.reports.events?.events || [];
  const goals = state.reports.goals?.goals || [];
  return `
    <div class="panel">
      <div class="row">
        <button class="secondary" data-testid="refresh">Refresh</button>
        <a data-testid="csv-export" href="${state.apiBase.replace(/\/$/, '')}/api/v1/reports/export.csv?project_id=${state.selectedProjectId}" target="_blank">CSV export</a>
      </div>
    </div>
    ${tablePanel('Sources', ['source', 'medium', 'campaign', 'visits', 'pageviews', 'goals'], sources, 'sources-table')}
    ${tablePanel('Pages', ['url', 'views', 'unique_visitors', 'entrances', 'exits', 'goals'], pages, 'pages-table')}
    ${tablePanel('Events', ['type', 'name', 'count', 'unique_users', 'sessions', 'goals_triggered'], events, 'events-table')}
    ${tablePanel('Goals report', ['name', 'visits', 'completions', 'unique_users', 'conversion_rate', 'revenue'], goals, 'goals-report-table')}
  `;
}

function renderDebug() {
  return `
    <div class="panel">
      <button class="secondary" data-testid="refresh">Refresh</button>
      <table data-testid="debug-table">
        <thead><tr><th>Time</th><th>Type</th><th>Name</th><th>URL</th><th>Traffic</th><th>Goals</th></tr></thead>
        <tbody>
          ${state.debugEvents.map((event) => `
            <tr>
              <td>${escapeHtml(event.server_time || '')}</td>
              <td>${escapeHtml(event.type)}</td>
              <td>${escapeHtml(event.name || '')}</td>
              <td>${escapeHtml(event.url || '')}</td>
              <td>${escapeHtml(event.traffic_source || '')}</td>
              <td>${escapeHtml((event.matched_goal_ids || []).join(','))}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderGoals() {
  return `
    <div class="panel">
      <h2>Create goal</h2>
      <div class="form">
        <label>Name <input data-testid="goal-name" value="lead_form_submit" /></label>
        <label>Type
          <select data-testid="goal-type">
            <option value="js_goal">JS goal</option>
            <option value="event">Event</option>
            <option value="page_url">Page URL</option>
          </select>
        </label>
        <button class="primary" data-testid="create-goal">Create goal</button>
      </div>
    </div>
    ${tablePanel('Goals', ['name', 'type', 'enabled', 'value', 'currency'], state.goals, 'goals-table')}
  `;
}

function renderSecurity() {
  return `
    <div class="panel">
      <h2>API token</h2>
      <button class="primary" data-testid="create-api-token">Create API token</button>
      <pre data-testid="api-token-output"></pre>
    </div>
    ${tablePanel('Audit log', ['created_at', 'actor_user_id', 'action', 'entity_type', 'entity_id'], state.audit, 'audit-table')}
  `;
}

function tablePanel(title, columns, rows, testId) {
  return `
    <div class="panel">
      <h2>${title}</h2>
      <table data-testid="${testId}">
        <thead><tr>${columns.map((col) => `<th>${col}</th>`).join('')}</tr></thead>
        <tbody>
          ${(rows || []).map((row) => `<tr>${columns.map((col) => `<td>${escapeHtml(formatCell(row[col]))}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function formatCell(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number') return String(round(value));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function bindCommon() {
  app.querySelector('[data-testid="save-api"]').addEventListener('click', () => {
    state.apiBase = app.querySelector('[data-testid="api-base"]').value.trim();
    saveConfig();
    setStatus('API base saved');
  });
  app.querySelector('[data-testid="login"]').addEventListener('click', async () => {
    await devLogin();
    await refreshAll();
    render();
    setStatus('Signed in');
  });
  app.querySelectorAll('[data-testid="quick-demo"]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        setStatus('Preparing demo workspace...');
        await quickDemo();
        render();
        setStatus('Demo workspace is ready');
      } catch (error) {
        showError(error);
      }
    });
  });
  const checkBackend = app.querySelector('[data-testid="check-backend"]');
  if (checkBackend) {
    checkBackend.addEventListener('click', async () => {
      try {
        state.apiBase = app.querySelector('[data-testid="api-base"]').value.trim();
        await api('/healthz', { headers: {} });
        setStatus('Backend is reachable');
      } catch (error) {
        showError(error);
      }
    });
  }
  app.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', async () => {
      state.tab = button.dataset.tab;
      saveConfig();
      if (state.selectedProjectId) await refreshProjectData().catch(showError);
      render();
    });
  });
}

async function devLogin() {
  state.apiBase = app.querySelector('[data-testid="api-base"]').value.trim();
  const body = await api('/api/v1/auth/dev-login', {
    method: 'POST',
    body: JSON.stringify({ email: `demo-${Date.now()}@endlessmetrics.local`, name: 'Demo User' })
  });
  state.token = body.session_token;
  saveConfig();
  return body;
}

async function quickDemo() {
  if (!state.token) {
    await devLogin();
  }
  let orgId = state.selectedOrgId;
  if (!orgId) {
    const org = await api('/api/v1/organizations', {
      method: 'POST',
      body: JSON.stringify({ name: `Demo Org ${new Date().toLocaleTimeString()}` })
    });
    orgId = org.organization.id;
    state.selectedOrgId = orgId;
  }
  let projectId = state.selectedProjectId;
  if (!projectId) {
    const project = await api('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify({
        organization_id: orgId,
        name: 'Demo Analytics Site',
        domain: 'localhost',
        allowed_domains: ['localhost', '127.0.0.1']
      })
    });
    projectId = project.project.id;
    state.selectedProjectId = projectId;
  }
  await refreshProjectData();
  let counter = selectedCounter();
  if (!counter) {
    const created = await api(`/api/v1/projects/${projectId}/counters`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Demo counter' })
    });
    counter = created.counter;
    state.selectedCounterId = counter.id;
  }
  if (!state.goals.some((goal) => goal.name === 'lead_form_submit')) {
    await api(`/api/v1/projects/${projectId}/goals`, {
      method: 'POST',
      body: JSON.stringify({ name: 'lead_form_submit', type: 'js_goal', conditions: {}, value: 99, currency: 'RUB' })
    });
  }
  await sendDemoEvents(counter.public_key);
  await refreshAll();
  state.tab = 'dashboard';
  saveConfig();
}

async function sendDemoEvents(counterPublicKey) {
  const now = new Date().toISOString();
  const visitor = `v_demo_${Date.now()}`;
  const session = `s_demo_${Date.now()}`;
  await api('/collect', {
    method: 'POST',
    body: JSON.stringify({
      counter_id: counterPublicKey,
      visitor_id: visitor,
      session_id: session,
      client_time: now,
      events: [
        {
          event_id: `evt_home_${Date.now()}`,
          type: 'page_view',
          url: 'http://localhost/?utm_source=google&utm_medium=cpc&utm_campaign=demo',
          title: 'Home',
          referrer: 'https://google.com/search?q=endlessmetrics'
        },
        {
          event_id: `evt_pricing_${Date.now()}`,
          type: 'page_view',
          url: 'http://localhost/pricing?email=test@example.com&token=secret&utm_source=google&utm_medium=cpc&utm_campaign=demo',
          title: 'Pricing',
          referrer: 'https://google.com/search?q=endlessmetrics',
          params: { email: 'test@example.com', token: 'secret' }
        },
        {
          event_id: `evt_click_${Date.now()}`,
          type: 'event',
          name: 'button_click',
          url: 'http://localhost/pricing',
          params: { button_id: 'buy' }
        },
        {
          event_id: `evt_goal_${Date.now()}`,
          type: 'goal',
          name: 'lead_form_submit',
          url: 'http://localhost/thank-you',
          revenue: 99,
          currency: 'RUB'
        },
        {
          event_id: `evt_purchase_${Date.now()}`,
          type: 'ecommerce_purchase',
          name: 'purchase',
          url: 'http://localhost/checkout',
          revenue: 199,
          currency: 'RUB',
          params: { order_id: 'demo-order', items: [{ sku: 'sku-1', price: 199, quantity: 1 }] }
        }
      ]
    })
  });
}

function bindAuthed() {
  app.querySelectorAll('[data-testid="refresh"]').forEach((button) => {
    button.addEventListener('click', async () => {
      await refreshAll();
      render();
    });
  });
  const createOrg = app.querySelector('[data-testid="create-org"]');
  if (createOrg) {
    createOrg.addEventListener('click', async () => {
      const name = app.querySelector('[data-testid="org-name"]').value.trim();
      const body = await api('/api/v1/organizations', { method: 'POST', body: JSON.stringify({ name }) });
      state.selectedOrgId = body.organization.id;
      await refreshAll();
      state.tab = 'setup';
      render();
    });
  }
  const createProject = app.querySelector('[data-testid="create-project"]');
  if (createProject) {
    createProject.addEventListener('click', async () => {
      const name = app.querySelector('[data-testid="project-name"]').value.trim();
      const domain = app.querySelector('[data-testid="project-domain"]').value.trim();
      const body = await api('/api/v1/projects', {
        method: 'POST',
        body: JSON.stringify({
          organization_id: state.selectedOrgId,
          name,
          domain,
          allowed_domains: [domain, '127.0.0.1', 'localhost']
        })
      });
      state.selectedProjectId = body.project.id;
      await refreshProjectData();
      render();
    });
  }
  const createCounter = app.querySelector('[data-testid="create-counter"]');
  if (createCounter) {
    createCounter.addEventListener('click', async () => {
      const body = await api(`/api/v1/projects/${state.selectedProjectId}/counters`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Main counter' })
      });
      state.selectedCounterId = body.counter.id;
      await refreshProjectData();
      render();
    });
  }
  const createGoal = app.querySelector('[data-testid="create-goal"]');
  if (createGoal) {
    createGoal.addEventListener('click', async () => {
      const name = app.querySelector('[data-testid="goal-name"]').value.trim();
      const type = app.querySelector('[data-testid="goal-type"]').value;
      await api(`/api/v1/projects/${state.selectedProjectId}/goals`, {
        method: 'POST',
        body: JSON.stringify({ name, type, conditions: {} })
      });
      await refreshProjectData();
      render();
    });
  }
  const tokenButton = app.querySelector('[data-testid="create-api-token"]');
  if (tokenButton) {
    tokenButton.addEventListener('click', async () => {
      const body = await api(`/api/v1/api-tokens?project_id=${state.selectedProjectId}`, {
        method: 'POST',
        body: JSON.stringify({ name: 'E2E token' })
      });
      app.querySelector('[data-testid="api-token-output"]').textContent = body.token;
    });
  }
}

function setStatus(message) {
  const el = app.querySelector('[data-testid="status"]');
  if (el) {
    el.className = 'status';
    el.textContent = message;
  }
}

function showError(error) {
  const el = app.querySelector('[data-testid="status"]');
  if (el) {
    el.className = 'status error';
    el.textContent = error.message || String(error);
  }
}

function round(value) {
  const number = Number(value || 0);
  return Math.round(number * 100) / 100;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

bootstrap().catch((error) => {
  console.error(error);
  render();
  showError(error);
});
