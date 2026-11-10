/* Общие шаги сквозных проверок: адрес собранного файла, открытие с перехватом ошибок консоли. */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const APP_URL = pathToFileURL(resolve('dist/index.html')).href;

/** Открывает приложение и собирает ошибки страницы и консоли в page.errors. */
export async function openApp(page, hash = '') {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(APP_URL + hash);
  await page.waitForFunction(() => window.__app && window.__app.calc || window.__app && window.__app.fault);
  return errors;
}

/** Ждёт, пока страница «Системные требования» пересчитает результат после ввода. */
export const settle = page => page.waitForTimeout(350);
