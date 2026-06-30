import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

const backendBaseURL = process.env.BACKEND_BASE_URL || 'http://127.0.0.1:8080';

test.describe.configure({ mode: 'serial' });

type TestState = {
  token: string;
  orgId: string;
  projectId: string;
  counterPublicKey: string;
};

const state: TestState = {
  token: '',
  orgId: '',
  projectId: '',
  counterPublicKey: ''
};

test.beforeAll(async () => {
  const api = await request.newContext({ baseURL: backendBaseURL });
  await api.post('/api/v1/test/reset');
  await api.dispose();
});

test('admin setup creates organization, project, counter and goal', async ({ page }) => {
  await page.goto(`/?api=${encodeURIComponent(backendBaseURL)}`);
  await page.getByTestId('login').click();
  await expect(page.getByTestId('status')).toContainText('Signed in');
  state.token = await page.evaluate(() => localStorage.getItem('em_token') || '');
  expect(state.token).toMatch(/^sess_/);

  await page.locator('[data-tab="setup"]').click();
  await page.getByTestId('org-name').fill(`E2E Org ${Date.now()}`);
  await page.getByTestId('create-org').click();
  await expect(page.getByTestId('current-org')).toContainText('org_');
  state.orgId = (await page.getByTestId('current-org').textContent()) || '';

  await page.getByTestId('project-name').fill('E2E Site');
  await page.getByTestId('project-domain').fill('127.0.0.1');
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('current-project')).toContainText('prj_');
  state.projectId = (await page.getByTestId('current-project').textContent()) || '';

  await page.getByTestId('create-counter').click();
  await expect(page.getByTestId('counter-public-key')).toContainText('cnt_');
  state.counterPublicKey = (await page.getByTestId('counter-public-key').textContent()) || '';
  await expect(page.getByTestId('snippet')).toContainText('/sdk/sma.js');

  const api = await authedAPI();
  const counters = await getJSON(api, `/api/v1/projects/${state.projectId}/counters`);
  const snippet = await getJSON(api, `/api/v1/counters/${counters.counters[0].id}/snippet`);
  expect(snippet.snippet).toContain(state.counterPublicKey);
  await api.dispose();

  await page.locator('[data-tab="goals"]').click();
  await page.getByTestId('goal-name').fill('lead_form_submit');
  await page.getByTestId('goal-type').selectOption('js_goal');
  await page.getByTestId('create-goal').click();
  await expect(page.getByTestId('goals-table')).toContainText('lead_form_submit');
});

test('SDK tracks pageview, SPA routes, UTM, goals and privacy masking', async ({ page }) => {
  await page.goto(`/site.html?api=${encodeURIComponent(backendBaseURL)}&counter=${encodeURIComponent(state.counterPublicKey)}&utm_source=google&utm_medium=cpc&utm_campaign=test`);
  await page.waitForFunction(() => (window as any).__smaReady === true);
  await page.getByTestId('route-pricing').click();
  await page.getByTestId('route-checkout').click();
  await page.getByTestId('send-event').click();
  await page.getByTestId('send-goal').click();
  await page.getByTestId('send-ecommerce').click();
  await page.getByTestId('privacy-route').click();

  const api = await authedAPI();
  await expect.poll(async () => {
    const json = await getJSON(api, `/api/v1/debug/events?project_id=${state.projectId}`);
    return json.events.some((event: any) => event.type === 'ecommerce_purchase' && event.revenue === 199);
  }, { timeout: 15_000 }).toBeTruthy();

  const debug = await getJSON(api, `/api/v1/debug/events?project_id=${state.projectId}`);
  const pageViews = debug.events.filter((event: any) => event.type === 'page_view');
  expect(pageViews.length).toBeGreaterThanOrEqual(3);
  expect(debug.events.some((event: any) => event.type === 'event' && event.name === 'button_click')).toBeTruthy();
  expect(debug.events.some((event: any) => event.type === 'goal' && event.name === 'lead_form_submit')).toBeTruthy();
  expect(debug.events.some((event: any) => event.type === 'ecommerce_purchase' && event.revenue === 199)).toBeTruthy();
  const privacyEvent = debug.events.find((event: any) => String(event.url).includes('/privacy'));
  expect(privacyEvent.url).not.toContain('test@example.com');
  expect(privacyEvent.url).not.toContain('secret');
  expect(privacyEvent.url).toContain('utm_source=google');
  expect(privacyEvent.ip_hash).toMatch(/[0-9a-f]{64}/);
  await api.dispose();
});

test('admin reports, debug screen, CSV, metrics and API token stay functional', async ({ page }) => {
  await page.goto(`/?api=${encodeURIComponent(backendBaseURL)}`);
  await page.evaluate((token) => localStorage.setItem('em_token', token), state.token);
  await page.reload();
  await page.locator('[data-tab="dashboard"]').click();
  await expect(page.getByTestId('metric-pageviews')).not.toHaveText('0');
  await expect(page.getByTestId('metric-goals')).not.toHaveText('0');

  await page.locator('[data-tab="reports"]').click();
  await expect(page.getByTestId('sources-table')).toContainText('google');
  await expect(page.getByTestId('pages-table')).toContainText('/pricing');
  await expect(page.getByTestId('events-table')).toContainText('button_click');
  await expect(page.getByTestId('goals-report-table')).toContainText('lead_form_submit');

  await page.locator('[data-tab="debug"]').click();
  await expect(page.getByTestId('debug-table')).toContainText('page_view');

  await page.locator('[data-tab="security"]').click();
  await page.getByTestId('create-api-token').click();
  await expect(page.getByTestId('api-token-output')).toContainText('emt_');

  const api = await authedAPI();
  for (const path of [
    '/api/v1/reports/overview',
    '/api/v1/reports/traffic',
    '/api/v1/reports/sources',
    '/api/v1/reports/pages',
    '/api/v1/reports/events',
    '/api/v1/reports/goals',
    '/api/v1/reports/geo',
    '/api/v1/reports/tech'
  ]) {
    const response = await api.get(`${path}?project_id=${state.projectId}`);
    expect(response.ok(), path).toBeTruthy();
  }
  const csv = await api.get(`/api/v1/reports/export.csv?project_id=${state.projectId}`);
  expect(csv.ok()).toBeTruthy();
  expect(await csv.text()).toContain('server_time,type,name,url');

  const metrics = await api.get('/metrics');
  expect(await metrics.text()).toContain('collector_events_accepted_total');
  const openapi = await api.get('/openapi.yaml');
  expect(await openapi.text()).toContain('EndlessMetrics API');
  await api.dispose();
});

test('cross-project access returns 403 and writes audit log', async () => {
  const alice = await authedAPI();
  const bobToken = await devLogin('bob-e2e@endlessmetrics.local');
  const bob = await request.newContext({
    baseURL: backendBaseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${bobToken}` }
  });
  const bobOrg = await postJSON(bob, '/api/v1/organizations', { name: 'Bob E2E Org' });
  const bobProject = await postJSON(bob, '/api/v1/projects', {
    organization_id: bobOrg.organization.id,
    name: 'Bob Private Project',
    domain: 'bob.test',
    allowed_domains: ['bob.test']
  });

  const denied = await alice.get(`/api/v1/projects/${bobProject.project.id}`);
  expect(denied.status()).toBe(403);

  const audit = await getJSON(bob, `/api/v1/audit-log?project_id=${bobProject.project.id}`);
  expect(audit.audit_log.some((entry: any) => String(entry.action).includes('denied'))).toBeTruthy();
  await alice.dispose();
  await bob.dispose();
});

async function authedAPI(): Promise<APIRequestContext> {
  return request.newContext({
    baseURL: backendBaseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${state.token}` }
  });
}

async function devLogin(email: string): Promise<string> {
  const api = await request.newContext({ baseURL: backendBaseURL });
  const response = await api.post('/api/v1/auth/dev-login', {
    data: { email, name: email }
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  await api.dispose();
  return body.session_token;
}

async function postJSON(api: APIRequestContext, path: string, data: unknown): Promise<any> {
  const response = await api.post(path, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

async function getJSON(api: APIRequestContext, path: string): Promise<any> {
  const response = await api.get(path);
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
