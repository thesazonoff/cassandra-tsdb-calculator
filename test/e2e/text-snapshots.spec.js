/* Тексты всех вкладок для расчёта по умолчанию. Эталон снят с выпуска 2.1.0 и совпал с ним полностью.
 * Если изменение текста намеренное: npx playwright test text-snapshots --update-snapshots и проверить diff. */
import { test, expect } from '@playwright/test';
import { openApp } from '../helpers/app.js';

const norm = s => s.replace(/\s+/g, ' ').trim();

test('страница «Системные требования»', async ({ page }) => {
  await openApp(page);
  await page.click('#tab-ft'); await page.click('#prob-det summary');
  await expect(page.locator('#probProg')).toContainText('Перебор', { timeout: 15_000 });
  for (const id of ['pane-sum', 'pane-disk', 'pane-ft', 'pane-cfg', 'pane-cal', 'pane-met', 'totals', 'repBox', 'usageHint', 'compHint']) {
    expect(norm(await page.locator('#' + id).textContent()) + '\n').toMatchSnapshot(`calc-${id}.txt`);
  }
});

test('страница «Отказоустойчивость»', async ({ page }) => {
  await openApp(page, '#fault');
  await expect(page.locator('#ft-probProg')).toContainText('Перебор', { timeout: 15_000 });
  for (const id of ['pane-sum', 'pane-fail', 'pane-scheme', 'pane-data', 'pane-cfg', 'pane-method', 'inputs']) {
    expect(norm(await page.locator('#ft-' + id).textContent()) + '\n').toMatchSnapshot(`fault-${id}.txt`);
  }
});
