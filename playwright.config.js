/* Сквозные проверки собранного файла dist/index.html в Chromium. Сборка: npm run build. */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list',
  snapshotPathTemplate: '{testDir}/__snapshots__/{arg}{ext}',
  use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, acceptDownloads: true, locale: 'ru-RU', trace: 'retain-on-failure' }
});
