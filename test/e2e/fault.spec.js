/* Страница «Отказоустойчивость»: типовые схемы, топология, схема отказов, конфигурация, ссылка, ошибки ввода. */
import { test, expect } from '@playwright/test';
import { openApp, APP_URL } from '../helpers/app.js';

const res = (page, expr) => page.evaluate(`(() => { const o = window.__app.fault.res; return ${expr}; })()`);
const recalc = page => page.waitForTimeout(300);

let errors = [];
test.beforeEach(async ({ page }) => {
  errors = await openApp(page, '#fault');
  await expect(page.locator('#page-fault')).toBeVisible();
});
test.afterEach(() => { expect(errors).toEqual([]); });

test('типовые схемы меняют топологию и результат', async ({ page }) => {
  expect(await res(page, 'o.appTol')).toBe(1);
  await page.click('#ft-presets [data-p="3"]'); await recalc(page);   // 15 нод, 5 racks, RF5
  expect(await res(page, 'o.T.N')).toBe(15);
  expect(await res(page, 'o.appTol')).toBe(2);
  await page.click('#ft-presets [data-p="4"]'); await recalc(page);   // 2 DC по 3 ноды
  await expect(page.locator('#ft-clientRow')).toBeVisible();
  await expect(page.locator('#ft-pane-sum')).toContainText('Отказ целого DC');
});

test('топология: RF, racks, распределение нод, второй DC', async ({ page }) => {
  await page.click('#ft-dcList [data-act=inc][data-f=rf]'); await recalc(page);
  await expect(page.locator('#ft-errBox')).toContainText('RF=4 больше числа нод (3)');
  await page.click('#ft-dcList [data-act=dec][data-f=rf]'); await recalc(page);
  await expect(page.locator('#ft-errBox')).toBeEmpty();
  await page.fill('#ft-dcList input[data-f=dist]', '9');
  await page.click('#ft-dcList [data-act=dist]'); await recalc(page);
  expect(await res(page, 'o.T.dcs[0].racks.map(r => r.n).join()')).toBe('3,3,3');
  await page.click('#ft-btnAddDc'); await recalc(page);
  expect(await res(page, 'o.T.dcs.length')).toBe(2);
  await page.selectOption('#ft-wcl', 'EACH_QUORUM'); await recalc(page);
  await expect(page.locator('#ft-pane-sum')).toContainText('EACH_QUORUM');
});

test('ошибка ввода показывается и не ломает страницу', async ({ page }) => {
  await page.fill('#ft-dcList input[data-f=rf]', '5'); await recalc(page);
  await expect(page.locator('#ft-errBox')).toContainText('RF=5 больше числа нод');
  await page.fill('#ft-dcList input[data-f=rf]', '3'); await recalc(page);
  await expect(page.locator('#ft-errBox')).toBeEmpty();
});

test('схема отказов: нода, rack, случайный отказ', async ({ page }) => {
  await page.click('#ft-presets [data-p="2"]'); await recalc(page);   // 9 нод, 3 racks
  await page.click('#ft-tabs [data-tab=scheme]');
  await page.click('#ft-pane-scheme .node[data-node="0"]');
  await expect(page.locator('#ft-schemeStatus')).toContainText('1 из 9');
  await page.click('#ft-pane-scheme [data-sact=rack][data-rack="1"]');
  await expect(page.locator('#ft-schemeStatus')).toContainText('4 из 9');
  await page.click('#ft-pane-scheme [data-sact=clear]');
  await page.click('#ft-pane-scheme [data-sact=kinc]');
  await page.click('#ft-pane-scheme [data-sact=rand]');
  await expect(page.locator('#ft-schemeStatus')).toContainText('3 из 9');
  await expect(page.locator('#ft-randK')).toHaveValue('3');
});

test('вероятность при случайных отказах досчитывается', async ({ page }) => {
  await page.click('#ft-tabs [data-tab=fail]');
  await expect(page.locator('#ft-probTable tbody tr')).toHaveCount(3, { timeout: 15_000 });
  await expect(page.locator('#ft-probProg')).toContainText('Перебор всех сочетаний');
});

test('конфигурация: копирование и скачивание фрагмента', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#ft-tabs [data-tab=cfg]');
  await page.click('#ft-pane-cfg [data-copy="0"]');
  expect(await page.evaluate('navigator.clipboard.readText()')).toContain('CREATE KEYSPACE IF NOT EXISTS "TSDB"');
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('#ft-pane-cfg [data-dl="1"]')]);
  expect(d.suggestedFilename()).toBe('cassandra.yaml.DC1.fragment');
});

test('ссылка на расчёт ведёт на эту страницу', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#ft-presets [data-p="5"]'); await recalc(page);
  await page.click('#ft-btnShare');
  const link = await page.evaluate('navigator.clipboard.readText()');
  expect(link.startsWith(APP_URL + '#fault&s=')).toBe(true);
  const p2 = await context.newPage();
  await openApp(p2, link.slice(APP_URL.length));
  expect(await p2.evaluate('window.__app.fault.res.T.dcs.length')).toBe(3);
});
