import { defineConfig } from '@playwright/test';

const baseURL = 'http://localhost:4455';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  // Locally the system Chrome is enough; CI installs Playwright's Chromium.
  use: { baseURL, channel: process.env.CI ? undefined : 'chrome', trace: 'retain-on-failure' },
  webServer: {
    command: 'bun run build && bun e2e/server.ts',
    url: `${baseURL}/api/config`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
