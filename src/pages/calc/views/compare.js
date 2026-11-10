/* Вкладка «Сравнение»: до 5 сохранённых расчётов рядом. */
import { esc, nf, fB } from '../../../shared/format.js';
import { VN, drivesStr } from './common.js';

/** Краткая сводка расчёта для вкладки «Сравнение». */
export function summary(ctx) {
  const { R, S, VAR } = ctx;
  const v = R.variants[VAR];
  return { mode: R.standalone ? 'Одна нода' : 'Кластер', tags: R.tags, P: R.P, ret: R.ret, rf: R.rep.dcs.map(d => d.rf).join('/'), dc: R.rep.dcs.length, variant: VN[VAR],
    N: v.Ntotal, prof: v.chosen.p.c + ' ядер / ' + v.chosen.p.ram + ' ГБ', disk: v.node.reqData, drives: drivesStr(v.node), data: (v.L + v.snapT) * R.rep.dcs.reduce((a, d) => a + d.rf, 0), comp: S.comp === 'none' ? 'без сжатия' : 'LZ4' };
}

/** Таблица сохранённых расчётов. */
export function cmpHtml(CMP) {
  if (!CMP.length) return '';
  /** @type {Array<[string, (x: any) => string]>} */
  const rows = [['Режим', x => x.mode], ['Вариант', x => x.variant], ['Тегов', x => nf(x.tags)], ['Точек/с', x => nf(x.P)], ['Хранение, сут', x => nf(x.ret)], ['RF × ДЦ', x => x.rf + ' × ' + x.dc], ['Сжатие', x => x.comp], ['Нод', x => nf(x.N)], ['Нода', x => x.prof], ['Data-диск на ноду', x => fB(x.disk)], ['Накопители', x => x.drives], ['Данные с репликами', x => fB(x.data)]];
  return `<div class="tbl-wrap"><table class="t"><thead><tr><th></th>${CMP.map(c => `<th>${esc(c.name)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(r => `<tr><th scope="row">${r[0]}</th>${CMP.map(c => `<td>${esc(r[1](c.sum))}</td>`).join('')}</tr>`).join('')}
    <tr><th></th>${CMP.map((c, i) => `<td><button class="btn ghost" type="button" data-cmp-load="${i}">Открыть</button> <button class="btn ghost" type="button" data-cmp-del="${i}">Удалить</button></td>`).join('')}</tr></tbody></table></div>
    <div><button class="btn" type="button" data-cmp-clear>Очистить сравнение</button></div>`;
}
