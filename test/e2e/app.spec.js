/* Приложение целиком: переключение страниц, адрес у каждой страницы свой, старые ссылки, клавиатура. */
import { test, expect } from '@playwright/test';
import { openApp, settle } from '../helpers/app.js';
import { encodeState } from '../../src/shared/share.js';

test('версия в шапке, ссылка на GitHub, одна страница видна', async ({ page }) => {
  const errors = await openApp(page);
  const version = await page.evaluate('window.__app.version');
  expect(version).toMatch(/^\d+\.\d+\.\d+/);
  await expect(page.locator('#app-ver')).toHaveText(version);
  await expect(page.locator('.app-gh')).toHaveAttribute('href', 'https://github.com/thesazonoff/cassandra-tsdb-calculator');
  await expect(page.locator('#page-calc')).toBeVisible();
  await expect(page.locator('#page-fault')).toBeHidden();
  expect(await page.locator('iframe').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('у каждой страницы своё состояние в адресе', async ({ page }) => {
  await openApp(page);
  expect(await page.evaluate('location.hash')).toMatch(/^#calc&s=/);
  await page.fill('#f-retention', '90'); await page.press('#f-retention', 'Tab'); await settle(page);
  const calcHash = await page.evaluate('location.hash');

  await page.click('#nav-fault');
  await expect(page.locator('#page-fault')).toBeVisible();
  await expect(page.locator('#page-calc')).toBeHidden();
  await expect(page).toHaveURL(/#fault&s=/);

  await page.click('#nav-calc');
  expect(await page.evaluate('location.hash')).toBe(calcHash);
});

test('ссылка на вторую страницу открывает её с расчётом', async ({ page }) => {
  const s = encodeState({ dcs: [{ name: 'MSK', rf: 3, racks: [2, 2, 2] }, { name: 'SPB', rf: 3, racks: [1, 1, 1] }], clientDc: 1 });
  await openApp(page, '#fault&s=' + s);
  await expect(page.locator('#page-fault')).toBeVisible();
  expect(await page.evaluate('window.__app.fault.state.dcs.map(d => d.name).join()')).toBe('MSK,SPB');
  await expect(page.locator('#ft-clientDc')).toHaveValue('1');
});

test('ссылки версии 2.0.x без имени страницы', async ({ page }) => {
  const calc = encodeState({ groups: [{ type: 'DOUBLE', count: 100, period: 1 }], retention: 30 });
  await openApp(page, '#s=' + calc);
  await expect(page.locator('#page-calc')).toBeVisible();
  expect(await page.evaluate('window.__app.calc.R.ret')).toBe(30);

  const fault = encodeState({ dcs: [{ name: 'DC1', rf: 5, racks: [1, 1, 1, 1, 1] }] });
  await page.goto('about:blank');
  await openApp(page, '#s=' + fault);
  await expect(page.locator('#page-fault')).toBeVisible();
  expect(await page.evaluate('window.__app.fault.res.appTol')).toBe(2);
});

test('вставленная в адрес ссылка открывается без перезагрузки', async ({ page }) => {
  await openApp(page);
  await page.evaluate('window.__marker = 1');
  const s = encodeState({ dcs: [{ name: 'DC9', rf: 3, racks: [3, 3, 3] }] });
  await page.evaluate(h => { location.hash = h; }, '#fault&s=' + s);
  await expect(page.locator('#page-fault')).toBeVisible();
  await expect.poll(() => page.evaluate('window.__app.fault.state.dcs[0].name')).toBe('DC9');
  expect(await page.evaluate('window.__marker')).toBe(1);
});

test('стрелки переключают страницы', async ({ page }) => {
  await openApp(page);
  await page.focus('#nav-calc'); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#nav-fault')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#nav-fault')).toBeFocused();
});

test('печать со второй страницы не тянет отчёт первой', async ({ page }) => {
  await openApp(page);
  await page.click('#nav-fault');
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(page.locator('#print')).toBeEmpty();
  await expect(page.locator('#page-calc')).toBeHidden();
  await expect(page.locator('#ft-pane-sum')).toBeVisible();
});
