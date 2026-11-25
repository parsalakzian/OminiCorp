import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.browser.mjs',
  use: {
    baseURL: 'http://127.0.0.1:4317',
    launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE || undefined },
  },
  webServer: {
    command: 'node server/start.mjs',
    env: { PORT: '4317', BLOG_DB: ':memory:', BLOG_COOKIE_SECURE: '0', BLOG_SITE_URL: 'http://127.0.0.1:4317', BLOG_ADMIN_PASSWORD: 'editorial-test-fixture-only' },
    url: 'http://127.0.0.1:4317',
  },
});
