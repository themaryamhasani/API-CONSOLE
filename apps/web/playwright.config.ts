import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5290);
const API_PORT = Number(process.env.E2E_API_PORT || 5291);
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const API_URL = `http://127.0.0.1:${API_PORT}`;

// Prefer system browsers when Playwright's bundled Chromium cannot be downloaded
// (common on restricted networks). Override with E2E_BROWSER=chromium|chrome|msedge
const browserChannel = String(process.env.E2E_BROWSER || 'chrome').toLowerCase();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // video needs playwright ffmpeg download; keep off for restricted networks
    video: 'off',
    locale: 'fa-IR',
  },
  projects: [
    browserChannel === 'chromium'
      ? {
          name: 'chromium',
          use: { ...devices['Desktop Chrome'] },
        }
      : {
          name: browserChannel === 'msedge' ? 'msedge' : 'chrome',
          use: {
            ...devices['Desktop Chrome'],
            channel: browserChannel === 'msedge' ? 'msedge' : 'chrome',
          },
        },
  ],
  webServer: [
    {
      command: `node "${path.join(repoRoot, 'scripts/e2e-api.cjs')}"`,
      url: `${API_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        E2E_API_PORT: String(API_PORT),
        API_CONSOLE_CORS_ORIGIN: WEB_URL,
        API_CONSOLE_PUBLIC_URL: WEB_URL,
        API_CONSOLE_COOKIE_SECURE: 'false',
        API_CONSOLE_IS_ENABLED: 'false',
        API_CONSOLE_REQUIRED_WORKSPACES: '',
      },
    },
    {
      command: `npm run build -w @api-console/web && npm run preview -w @api-console/web -- --host 127.0.0.1 --port ${WEB_PORT}`,
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      cwd: repoRoot,
      env: {
        ...process.env,
        E2E_WEB_PORT: String(WEB_PORT),
        E2E_API_URL: API_URL,
      },
    },
  ],
});
