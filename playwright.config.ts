import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { MOCK_GAS_API_PATH } from './tests/fixtures/items';

const PREVIEW_HOST = '127.0.0.1';
const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`;

const skipBuild =
  process.env.PLAYWRIGHT_SKIP_BUILD === '1' || process.env.PLAYWRIGHT_SKIP_BUILD === 'true';

if (skipBuild && !existsSync(resolve(process.cwd(), 'frontend/dist/index.html'))) {
  throw new Error(
    'PLAYWRIGHT_SKIP_BUILD is enabled, but frontend/dist/index.html was not found. Build the frontend or download the frontend-dist artifact first.',
  );
}

const webServerEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (typeof value === 'string') {
    webServerEnv[key] = value;
  }
}
webServerEnv.VITE_GAS_API_URL = MOCK_GAS_API_PATH;

const previewCommand = `npm --workspace=frontend run preview -- --host ${PREVIEW_HOST} --port ${PREVIEW_PORT} --strictPort`;
const webServerCommand = skipBuild
  ? previewCommand
  : `npm --workspace=frontend run build && ${previewCommand}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: PREVIEW_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: PREVIEW_URL,
    env: webServerEnv,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
