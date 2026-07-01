import { expect, request, test } from '@playwright/test';

const backendBaseURL = process.env.BACKEND_BASE_URL || 'https://metrics.unng.ru';
const sessionToken = process.env.E2E_SESSION_TOKEN || '';
const secondSessionToken = process.env.E2E_SECOND_SESSION_TOKEN || '';

test.describe('authenticated production flow', () => {
  test.skip(!sessionToken, 'requires E2E_SESSION_TOKEN from a real OAuth session');

  test('covers setup, collection, reports, debug, tokens, and audit', async () => {
    const api = await request.newContext({
      baseURL: backendBaseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${sessionToken}` },
    });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const domain = `e2e-${suffix}.example.com`;

    const me = await api.get('/api/v1/me');
    expect(me.ok()).toBeTruthy();

    const org = await post(api, '/api/v1/organizations', { name: `E2E Org ${suffix}` }, 201);
    const project = await post(api, '/api/v1/projects', {
      organization_id: org.organization.id,
      name: `E2E Project ${suffix}`,
      domain,
      allowed_domains: [domain],
      timezone: 'Europe/Moscow',
      default_currency: 'RUB',
    }, 201);
    const counter = await post(api, `/api/v1/projects/${project.project.id}/counters`, { name: 'Main counter' }, 201);
    const goal = await post(api, `/api/v1/projects/${project.project.id}/goals`, {
      name: `lead_${suffix}`,
      type: 'js_goal',
      conditions: {},
      value: 1500,
      currency: 'RUB',
    }, 201);
    expect(goal.goal.enabled).toBeTruthy();

    const snippet = await api.get(`/api/v1/counters/${counter.counter.id}/snippet`);
    expect(snippet.ok()).toBeTruthy();
    await expect(snippet.json()).resolves.toEqual(expect.objectContaining({
      snippet: expect.stringContaining(counter.counter.public_key),
    }));

    const collector = await request.newContext({
      baseURL: backendBaseURL,
      extraHTTPHeaders: { Origin: `https://${domain}` },
    });
    const collect = await collector.post('/collect', {
      data: {
        counter_id: counter.counter.public_key,
        visitor_id: `visitor-${suffix}`,
        session_id: `session-${suffix}`,
        client_time: new Date().toISOString(),
        events: [
          {
            event_id: `page-${suffix}`,
            type: 'page_view',
            url: `https://${domain}/pricing?email=lead@example.com&token=secret&utm_source=yandex&utm_medium=cpc&utm_campaign=e2e`,
            title: 'Pricing',
            referrer: 'https://yandex.ru/search/?text=endlessmetrics',
            params: { email: 'lead@example.com' },
          },
          {
            event_id: `event-${suffix}`,
            type: 'event',
            name: 'cta_click',
            url: `https://${domain}/pricing`,
          },
          {
            event_id: `goal-${suffix}`,
            type: 'goal',
            name: `lead_${suffix}`,
            url: `https://${domain}/thanks`,
          },
        ],
      },
    });
    expect(collect.status()).toBe(200);
    await expect(collect.json()).resolves.toMatchObject({ accepted: 3 });
    await collector.dispose();

    const projectID = project.project.id;
    const debugEvents = await expectEvents(api, projectID, 3);
    const pageView = debugEvents.find((event: any) => event.type === 'page_view');
    expect(pageView).toBeTruthy();
    expect(pageView.url).not.toContain('lead@example.com');
    expect(pageView.url).not.toContain('secret');
    expect(pageView.utm).toMatchObject({ source: 'yandex', medium: 'cpc', campaign: 'e2e' });
    expect(pageView.ip_hash).toBeTruthy();

    const overview = await get(api, `/api/v1/reports/overview?project_id=${projectID}`);
    expect(overview).toMatchObject({ pageviews: 1, events: 1, goals: 1 });
    for (const report of ['traffic', 'sources', 'pages', 'events', 'goals', 'geo', 'tech']) {
      const result = await api.get(`/api/v1/reports/${report}?project_id=${projectID}`);
      expect(result.ok(), `${report} report`).toBeTruthy();
    }
    const csv = await api.get(`/api/v1/reports/export.csv?project_id=${projectID}`);
    expect(csv.ok()).toBeTruthy();
    expect(await csv.text()).toContain('type,name,url');

    const token = await post(api, '/api/v1/api-tokens', { name: `e2e-${suffix}` }, 201);
    expect(token.api_token.token).toBeTruthy();

    const audit = await get(api, `/api/v1/audit-log?project_id=${projectID}`);
    expect(audit.audit_log.length).toBeGreaterThan(0);
    await api.dispose();
  });

  test('Flutter admin opens with a real OAuth session token', async ({ page }) => {
    await page.addInitScript(({ token, apiBase }) => {
      window.sessionStorage.setItem('em_token', token);
      window.localStorage.setItem('em_api_base', apiBase);
    }, { token: sessionToken, apiBase: backendBaseURL });
    await page.goto('./admin/');
    await expect(page).toHaveTitle('EndlessMetrics Admin');
    await expect.poll(async () => (await page.screenshot({ fullPage: true })).length, {
      timeout: 15_000,
    }).toBeGreaterThan(20_000);
  });
});

test.describe('authenticated access control', () => {
  test.skip(!sessionToken || !secondSessionToken, 'requires two real OAuth sessions');

  test('rejects cross-project access for another OAuth user', async () => {
    const first = await request.newContext({
      baseURL: backendBaseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${sessionToken}` },
    });
    const second = await request.newContext({
      baseURL: backendBaseURL,
      extraHTTPHeaders: { Authorization: `Bearer ${secondSessionToken}` },
    });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const org = await post(second, '/api/v1/organizations', { name: `Second E2E Org ${suffix}` }, 201);
    const project = await post(second, '/api/v1/projects', {
      organization_id: org.organization.id,
      name: `Second E2E Project ${suffix}`,
      domain: `second-${suffix}.example.com`,
    }, 201);
    const denied = await first.get(`/api/v1/projects/${project.project.id}`);
    expect(denied.status()).toBe(403);
    await first.dispose();
    await second.dispose();
  });
});

async function post(api: any, path: string, data: unknown, status: number) {
  const response = await api.post(path, { data });
  expect(response.status(), `${path} response`).toBe(status);
  return response.json();
}

async function get(api: any, path: string) {
  const response = await api.get(path);
  expect(response.ok(), `${path} response`).toBeTruthy();
  return response.json();
}

async function expectEvents(api: any, projectID: string, minCount: number) {
  let events: any[] = [];
  await expect.poll(async () => {
    const debug = await get(api, `/api/v1/debug/events?project_id=${projectID}`);
    events = debug.events || [];
    return events.length;
  }, { timeout: 10_000 }).toBeGreaterThanOrEqual(minCount);
  return events;
}
