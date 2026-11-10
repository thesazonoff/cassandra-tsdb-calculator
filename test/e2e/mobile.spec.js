/* Телефон 390 px: на всех вкладках обеих страниц нет горизонтальной прокрутки. */
import { test, expect } from '@playwright/test';
import { openApp } from '../helpers/app.js';

test.use({ viewport: { width: 390, height: 844 } });

const noHScroll = page => page.evaluate('document.documentElement.scrollWidth');

test('страница «Системные требования»', async ({ page }) => {
  await openApp(page);
  for (const tab of ['sum', 'disk', 'ft', 'cfg', 'cal', 'met']) {
    await page.click('#tab-' + tab);
    expect(await noHScroll(page), tab).toBeLessThanOrEqual(390);
  }
});

test('страница «Отказоустойчивость»', async ({ page }) => {
  await openApp(page, '#fault');
  for (const tab of ['sum', 'fail', 'scheme', 'data', 'cfg', 'method']) {
    await page.click(`#ft-tabs [data-tab=${tab}]`);
    expect(await noHScroll(page), tab).toBeLessThanOrEqual(390);
  }
});
