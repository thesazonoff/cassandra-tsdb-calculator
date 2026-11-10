/* Вкладка «Калибровка»: факт nodetool tablestats против модели, поправочный коэффициент. */
import { esc, nf } from '../../../shared/format.js';

export function paneCal(ctx) {
  const { S, R } = ctx;
  const c = S.calib;
  return `<p class="hint" style="max-width:78ch">Сжатие зависит от характера значений тегов и у каждого заказчика своё. Если есть действующая инсталляция с этой же схемой таблиц, внесите её фактические данные: калькулятор сравнит их с моделью и поправит расчёт.</p>
  <div class="block"><label class="lbl" for="cal-text">Вывод <code>nodetool tablestats TSDB.data_points</code> с одной ноды</label>
    <textarea id="cal-text" placeholder="Вставьте вывод команды целиком: значения Space used (live) и SSTable Compression Ratio заполнятся сами"></textarea></div>
  <div class="grid" id="cal-form">
    <div class="fld"><label for="c-space">Space used (live), ГиБ на ноду</label><input type="number" id="c-space" data-c="spaceGiB" min="0" step="any" value="${esc(c.spaceGiB)}"></div>
    <div class="fld"><label for="c-ratio">SSTable Compression Ratio</label><input type="number" id="c-ratio" data-c="ratio" min="0" max="1.5" step="any" value="${esc(c.ratio)}"></div>
    <div class="fld"><label for="c-nodes">Нод с данными в ДЦ</label><input type="number" id="c-nodes" data-c="nodes" min="1" step="1" value="${esc(c.nodes)}"></div>
    <div class="fld"><label for="c-rf">RF keyspace TSDB</label><input type="number" id="c-rf" data-c="rf" min="1" step="1" value="${esc(c.rf)}"></div>
    <div class="fld"><label for="c-days">Данные за сколько суток на диске</label><input type="number" id="c-days" data-c="days" min="0.1" step="any" value="${esc(c.days)}"></div>
    <div class="fld"><label for="c-pps">Точек/с на инсталляции</label><input type="number" id="c-pps" data-c="pps" min="0" step="any" value="${esc(c.pps)}" placeholder="${nf(R.P)}"></div>
  </div>
  <p class="hint">Space used (live) не включает snapshots и каталог backups/. Число суток: возраст самых старых данных на диске; при удалении через DELETE это время работы инсталляции. Если поток не указан, берётся поток из расчёта, и тогда группы тегов должны совпадать с инсталляцией.</p>
  <div id="cal-result">${calResult(ctx)}</div>`;
}

export function calResult(ctx) {
  const { S, R } = ctx;
  const c = S.calib, k = R.calib;
  if (!k.valid) return '<div class="inline-note">Заполните Space used (live), число нод, RF и число суток, чтобы сравнить факт с моделью.</div>';
  const dev = k.dev * 100;
  return `<div class="cal-res">
      <div class="kpi"><span class="k">Факт, байт на точку</span><span class="v">${nf(k.measured, 1)}</span><span class="d">одна копия, LZ4, текущая схема</span></div>
      <div class="kpi"><span class="k">Модель, байт на точку</span><span class="v">${nf(k.model, 1)}</span><span class="d">та же схема и поток</span></div>
      <div class="kpi"><span class="k">Отклонение</span><span class="v ${Math.abs(dev) <= 20 ? 'ok' : Math.abs(dev) <= 50 ? 'mid' : 'bad'}">${dev > 0 ? '+' : ''}${nf(dev, 0)} %</span><span class="d">поправочный коэффициент ${nf(k.k, 3)}${k.ratio ? '; без сжатия ' + nf(k.kRaw, 3) : ''}</span></div>
    </div>
    <label class="check"><input type="checkbox" data-c="on" id="c-on" ${c.on ? 'checked' : ''}><span>Применить калибровку к расчёту<small>Коэффициент умножает объём данных во всех вариантах схемы.</small></span></label>`;
}
