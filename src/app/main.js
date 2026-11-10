/* Точка входа: монтирует страницы, переключатель страниц в шапке и адрес. */
import { APP_VERSION } from './version.js';
import { createRouter } from './router.js';
import { decodeState } from '../shared/share.js';
import { mountCalc } from '../pages/calc/index.js';
import { mountFault, isFaultState } from '../pages/fault/index.js';
import { isCalcState } from '../pages/calc/state.js';

const PAGES = ['calc', 'fault'];
const $ = id => document.getElementById(id);

// Ссылка без имени страницы (версии 2.0.x): определить страницу по содержимому
const guess = payload => { const s = decodeState(payload); return isFaultState(s) ? 'fault' : isCalcState(s) ? 'calc' : null; };

const router = createRouter({ pages: PAGES, guess, onExternal: (page, payload) => { show(page); if (payload) mounted[page].restore(payload); } });
const mount = { calc: mountCalc, fault: mountFault };
/** @type {Record<string, any>} */
const mounted = {};

function show(page, focus = false) {
  PAGES.forEach(p => {
    const on = p === page, tab = $('nav-' + p);
    tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1;
    $('page-' + p).hidden = !on;
  });
  // Страница создаётся при первом показе: вторая страница не тратит время на старте
  if (!mounted[page]) mounted[page] = mount[page]($('page-' + page), { url: router.forPage(page), isActive: () => router.active === page });
  router.activate(page);
  if (focus) $('nav-' + page).focus();
}

$('app-ver').textContent = APP_VERSION;
PAGES.forEach(p => $('nav-' + p).addEventListener('click', () => show(p)));
$('nav').addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  e.preventDefault();
  show(PAGES[(PAGES.indexOf(router.active) + 1) % PAGES.length], true);
});
show(router.active);

// Для автоматических проверок в браузере (test/e2e)
window.__app = { get calc() { return mounted.calc; }, get fault() { return mounted.fault; }, version: APP_VERSION };
