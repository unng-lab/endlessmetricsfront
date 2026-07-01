import { defineConfig, devices } from '@playwright/test';

const frontendBaseURL = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5173';
const useLocalWebServer = frontendBaseURL.startsWith('http://127.0.0.1') || frontendBaseURL.startsWith('http://localhost');
const frontendHostResolverRules = process.env.FRONTEND_HOST_RESOLVER_RULES;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: frontendBaseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: frontendHostResolverRules
      ? { args: [`--host-resolver-rules=${frontendHostResolverRules}`] }
      : undefined
  },
  webServer: useLocalWebServer ? {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    url: frontendBaseURL,
    reuseExistingServer: true,
    timeout: 30_000
  } : undefined,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
