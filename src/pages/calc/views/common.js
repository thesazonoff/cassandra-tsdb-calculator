/* Общие элементы представлений страницы «Системные требования».
 * Представление: чистая функция (ctx) => HTML. ctx = { R, S, VAR, ft, failed, code }:
 * R результат sizing.compute, S ввод, VAR выбранный вариант схемы, ft результат fault.compute
 * для топологии варианта, failed отметки отказавших нод, code реестр блоков кода для кнопок «Копировать». */
import * as E from '../../../core/sizing.js';
import { esc, dsz } from '../../../shared/format.js';

export const VN = { cur: 'Текущая схема', rec: 'Рекомендации', unset: 'Рекомендации + доработка драйвера' };

/** Накопители data одной ноды одной строкой. */
export function drivesStr(n) {
  const d = n.data.drives;
  if (!d.n) return 'не помещается в выбранный RAID';
  const raid = d.n === 1 && ['raid0', 'none', 'jbod'].includes(n.data.raid) ? 'один диск' : E.RAIDS[n.data.raid].label;
  return `${d.n} × ${dsz(d.size)} ${E.DISK[n.data.disk].label}, ${raid}`;
}

/** Самые важные проверки: сначала критичные. */
export function attnList(R, max) {
  const list = R.checks.filter(c => c.sev === 'crit' || c.sev === 'warn').sort((a, b) => (a.sev === 'crit' ? 0 : 1) - (b.sev === 'crit' ? 0 : 1));
  return list.slice(0, max);
}

export function checksHtml(R) {
  const order = { crit: 0, warn: 1, info: 2, ok: 3 }, icon = { crit: '!', warn: '!', info: 'i', ok: '✓' };
  return '<div class="checks">' + R.checks.slice().sort((a, b) => order[a.sev] - order[b.sev]).map(c => `<div class="chk ${c.sev}"><span class="ic" aria-hidden="true">${icon[c.sev]}</span><div class="tt">${esc(c.title)}<small>${esc(c.scope)}</small></div><p>${esc(c.text)}</p>${c.fix ? `<p class="fix"><b>Что сделать:</b> ${esc(c.fix)}</p>` : ''}</div>`).join('') + '</div>';
}

/** Подсветка комментариев и ключей в yaml, CQL, shell и C#. */
export function hl(text) {
  return esc(text).split('\n').map(l => {
    if (/^\s*(#|--|\/\/)/.test(l)) return `<span class="c">${l}</span>`;
    const m = l.match(/^(\s*[\w.\-]+)(:)(.*)$/);
    if (m && !/^\s*-/.test(l)) return `<span class="k">${m[1]}</span>${m[2]}${m[3].replace(/(\s#.*)$/, '<span class="c">$1</span>')}`;
    return l.replace(/(\s(--|\/\/)\s.*)$/, '<span class="c">$1</span>');
  }).join('\n');
}

/** Блок кода с кнопками «Копировать» и «Скачать»; текст сохраняется в реестре code. */
export function codeBlock(code, f) {
  const i = code.push(f) - 1;
  return `<div class="code"><div class="code-h"><div><b>${esc(f.file)}</b> <span>${esc(f.title)}</span></div><div style="display:flex;gap:6px"><button class="copy" type="button" data-copy="${i}">Копировать</button><button class="copy" type="button" data-dl="${i}">Скачать</button></div></div><pre>${hl(f.text)}</pre></div>`;
}

export function stepper(attrs, val, min, max, label) {
  return `<span class="stepper"><button type="button" data-st="dec" ${attrs} aria-label="Уменьшить: ${esc(label)}">−</button><input type="number" min="${min}" max="${max}" value="${val}" data-st="set" ${attrs} aria-label="${esc(label)}"><button type="button" data-st="inc" ${attrs} aria-label="Увеличить: ${esc(label)}">+</button></span>`;
}
