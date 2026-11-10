/* Страница «Системные требования»: сценарии ввода, схема отказов, калибровка, выгрузки, ссылка, печать. */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openApp, settle, APP_URL } from '../helpers/app.js';
import { readZip } from '../helpers/zip-reader.js';

const R = (page, expr) => page.evaluate(`(() => { const R = window.__app.calc.R; return ${expr}; })()`);

test('стартовый расчёт и скрытые по умолчанию поля', async ({ page }) => {
  const errors = await openApp(page);
  expect(await R(page, 'R.variants.rec.Ntotal')).toBeGreaterThanOrEqual(3);
  await expect(page.locator('#f-ownCores')).toBeHidden();
  await expect(page.locator('#tab-cmp')).toBeHidden();
  await expect(page.locator('#page-fault')).toBeHidden();
  expect(errors).toEqual([]);
});

test('одна нода, отказ двух нод, ручная топология и схема отказов', async ({ page }) => {
  await openApp(page);
  await page.check('input[name=mode][value=standalone]'); await settle(page);
  expect(await R(page, 'R.variants.rec.Ntotal')).toBe(1);
  await expect(page.locator('#f-raid')).toHaveValue('raid10');
  await page.check('input[name=mode][value=cluster]'); await settle(page);

  await page.fill('#f-F', '2'); await page.press('#f-F', 'Tab'); await settle(page);
  expect(await R(page, 'R.rep.dcs[0].rf')).toBe(5);
  await page.fill('#f-F', '1'); await page.press('#f-F', 'Tab'); await settle(page);

  await page.click('#tab-ft');
  const n0 = await R(page, 'R.variants.rec.Ntotal');
  await page.click('[data-st=inc][data-dc="0"][data-rack="0"]'); await settle(page);
  expect(await R(page, 'R.variants.rec.Ntotal')).toBe(n0 + 1);
  await expect(page.locator('[data-topo=reset]')).toBeVisible();

  await page.click('.nd[data-node="0"]'); await page.click('.nd[data-node="1"]');
  await expect(page.locator('#schemeStatus')).toContainText('2 из');
  await page.click('[data-topo=reset]'); await settle(page);
  expect(await R(page, 'R.variants.rec.Ntotal')).toBe(n0);

  await page.click('#prob-det summary');
  await expect(page.locator('#probTable tbody tr')).toHaveCount(8, { timeout: 15_000 });
});

test('калибровка по выводу nodetool tablestats', async ({ page }) => {
  await openApp(page);
  await page.click('#tab-cal');
  await page.fill('#cal-text', 'Table: data_points\n\tSpace used (live): 1200.5 GiB\n\tSSTable Compression Ratio: 0.55\n');
  await expect(page.locator('#c-space')).toHaveValue('1200.5');
  await page.fill('#c-nodes', '9'); await page.fill('#c-rf', '3'); await page.fill('#c-days', '200'); await page.press('#c-days', 'Tab'); await settle(page);
  expect(await R(page, 'R.calib.valid')).toBe(true);
  await page.check('#c-on'); await settle(page);
  expect(await R(page, 'R.calib.on')).toBe(true);
  await expect(page.locator('#cal-badge')).toContainText('вкл');
});

test('выгрузки: ZIP конфигурации, Excel, сценарий JSON и его загрузка', async ({ page }, info) => {
  await openApp(page);
  const save = async sel => { const [d] = await Promise.all([page.waitForEvent('download'), page.click(sel)]); const p = info.outputPath(d.suggestedFilename()); await d.saveAs(p); return { name: d.suggestedFilename(), path: p }; };

  const z = await save('#ex-zip');
  const names = readZip(readFileSync(z.path)).map(e => e.name);
  expect(names).toEqual(expect.arrayContaining(['cassandra.yaml', 'MesCassandra.cs', 'README.txt']));

  const x = await save('#ex-xlsx');
  const entries = readZip(readFileSync(x.path));
  expect(entries.filter(e => e.name.startsWith('xl/worksheets/')).length).toBe(5);
  const sheet1 = new TextDecoder().decode(entries.find(e => e.name === 'xl/worksheets/sheet1.xml').data);
  expect(sheet1).toContain('Текущая схема');
  expect(sheet1).toContain('Рекомендации + доработка драйвера');

  await page.click('#menu summary');
  const j = await save('#m-json');
  const scenario = JSON.parse(readFileSync(j.path, 'utf8'));
  expect(scenario.version).toBe(await page.evaluate('window.__app.version'));
  expect(scenario.state.groups).toHaveLength(7);

  scenario.state.retention = 90;
  await page.setInputFiles('#im-json', { name: 'scenario.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scenario)) });
  await settle(page);
  expect(await R(page, 'R.ret')).toBe(90);

  await page.click('#menu summary'); await page.click('#m-save');
  await expect(page.locator('#tab-cmp')).toBeVisible();
});

test('ссылка на расчёт восстанавливает ввод в новой вкладке', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openApp(page);
  await page.fill('#f-retention', '90'); await page.press('#f-retention', 'Tab'); await settle(page);
  await page.click('#menu summary'); await page.click('#m-link');
  const link = await page.evaluate('navigator.clipboard.readText()');
  expect(link.startsWith(APP_URL + '#calc&s=')).toBe(true);
  const p2 = await context.newPage();
  await openApp(p2, link.slice(APP_URL.length));
  expect(await p2.evaluate('window.__app.calc.R.ret')).toBe(90);
});

test('отчёт PDF: печатается только страница расчёта', async ({ page }, info) => {
  await openApp(page);
  await page.evaluate('window.print = () => { window.__printed = (window.__printed || 0) + 1; }');
  await page.click('#ex-pdf');
  expect(await page.evaluate('window.__printed')).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#print')).toBeVisible();
  await expect(page.locator('.app-bar')).toBeHidden();
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  expect(pdf.length).toBeGreaterThan(50_000);
  await info.attach('report.pdf', { body: pdf, contentType: 'application/pdf' });
});

test('окно «Что нового» и стрелки по вкладкам результата', async ({ page }) => {
  await openApp(page);
  await page.click('#f-new');
  await expect(page.locator('#dlg-new')).toBeVisible();
  await page.click('#dlg-new-close');
  await page.focus('#tab-sum'); await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-disk')).toHaveAttribute('aria-selected', 'true');
});
