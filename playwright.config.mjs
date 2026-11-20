import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.browser.mjs',
  use: {
    baseURL: 'http://127.0.0.1:4317',
    launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE || undefined },
  },
  webServer: {
    command: 'node site/dev.mjs',
    env: { PORT: '4317' },
    url: 'http://127.0.0.1:4317',
  },
});
