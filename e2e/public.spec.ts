import { expect, request, test } from '@playwright/test';

const backendBaseURL = process.env.BACKEND_BASE_URL || 'https://unng.ru';

test('landing page is visible and links to Flutter admin', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /web analytics/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /open flutter admin/i })).toHaveAttribute('href', './admin/');
  await expect(page.getByText(/OAuth 2.0 \/ OIDC only/i)).toBeVisible();
});

test('backend is HTTPS and does not expose bypass auth endpoints', async () => {
  const api = await request.newContext({ baseURL: backendBaseURL });
  const health = await api.get('/healthz');
  expect(health.ok()).toBeTruthy();
  await expect(health.json()).resolves.toMatchObject({ status: 'ok', service: 'endlessmetrics' });

  const hiddenLogin = await api.post('/api/v1/auth/dev-login', { data: { email: 'x@example.com' } });
  expect(hiddenLogin.status()).toBe(404);

  const reset = await api.post('/api/v1/test/reset');
  expect(reset.status()).toBe(404);

  const oauth = await api.get('/auth/login?redirect_to=https%3A%2F%2Funng-lab.github.io%2Fendlessmetricsfront%2Fadmin%2F&token_redirect=1');
  expect([302, 503]).toContain(oauth.status());
  await api.dispose();
});

test('Flutter admin shell loads without local auth bypass controls', async ({ page }) => {
  await page.goto('/admin/');
  await expect(page.getByText('EndlessMetrics')).toBeVisible();
  await expect(page.getByRole('button', { name: /OAuth login/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Check backend/i })).toBeVisible();
  await expect(page.getByText(/Development logins and bypass endpoints are not available/i)).toBeVisible();
  await expect(page.getByText(/Dev login/i)).toHaveCount(0);
});
