/* Вкладка «Отказы»: худший случай по нодам и racks, отказ DC, консистентность между DC, случайный отказ k нод. */
import { esc, nf as fmt } from '../../../shared/format.js';
import { probChartSvg, probLegend } from '../../../shared/prob.js';
import { pctP, tolText } from './common.js';

export function failHtml(o) {
  const T = o.T, st = o.st, D = T.dcs.length;
  const rackCell = (v, K) => K === 1 ? '<span class="na pill">1 rack</span>' : (v >= K ? 'все ' + K + (D > 1 ? ' (весь DC)' : '') : v);
  const rows = [
    ['Запись · ' + st.wcl, o.wTol, d => o.rackTol[d].w],
    ['Чтение · ' + st.rcl, o.rTol, d => o.rackTol[d].r]
  ];
  if (o.S) rows.push(['LWT · ' + st.scl, o.sTol, d => o.rackTol[d].s]);
  rows.push(['Данные сохранены (после репликации)', o.replLossTol, d => o.rackTol[d].loss]);
  let h = '<h3 class="sec">Худший случай: сколько отказов переносится гарантированно</h3>';
  h += '<p class="lead">Число в ячейке: сколько любых нод или любых racks может отказать одновременно. Расчёт для худшего расклада: отказали именно те ноды или racks, где лежат реплики одного диапазона. Racks считаются по смоделированному размещению реплик NetworkTopologyStrategy. Клиент работает в ' + esc(T.dcs[o.c].name) + '.</p>';
  h += '<div class="tbl-wrap"><table><thead><tr><th>Операция</th><th class="n">Любые ноды (из ' + T.N + ')</th>' + T.dcs.map(dc => '<th class="n">Racks в ' + esc(dc.name) + ' (из ' + dc.K + ')</th>').join('') + '</tr></thead><tbody>';
  rows.forEach(r => { h += '<tr><td>' + esc(r[0]) + '</td><td class="n">' + tolText(r[1]) + '</td>' + T.dcs.map((dc, d) => '<td class="n">' + (r[2](d) == null ? '—' : rackCell(r[2](d), dc.K)) + '</td>').join('') + '</tr>'; });
  h += '<tr><td>Подтверждённая запись сохранена</td><td class="n">' + o.ackLossTol + '</td>' + T.dcs.map(() => '<td class="n">—</td>').join('') + '</tr>';
  h += '</tbody></table></div>';
  if (D > 1) {
    h += '<h3 class="sec">Отказ целого DC</h3><p class="lead">Строка: какой DC отказал или потерял связь с остальными. Столбцы: что продолжает работать у приложения в каждом из оставшихся DC.</p>';
    h += '<div class="tbl-wrap"><table><thead><tr><th>Отказал</th>' + T.dcs.map(dc => '<th>Клиент в ' + esc(dc.name) + '</th>').join('') + '<th>Данные</th></tr></thead><tbody>';
    const pill = (v, t) => '<span class="pill ' + (v ? 'ok' : 'bad') + '">' + t + (v ? ' да' : ' нет') + '</span> ';
    o.dcFail.forEach(row => {
      h += '<tr><td><b>' + esc(T.dcs[row.dc].name) + '</b></td>' + row.cells.map(cell => cell ? '<td>' + pill(cell.w, 'запись') + pill(cell.r, 'чтение') + (cell.s != null ? pill(cell.s, 'LWT') : '') + '</td>' : '<td><span class="pill na">недоступен</span></td>').join('') +
        '<td>' + (row.dataSafe ? '<span class="pill ok">сохранены</span>' : '<span class="pill bad">потеряны</span>') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<h3 class="sec">Консистентность между DC</h3><p class="lead">Пишет клиент в DC строки с ' + esc(st.wcl) + ', читает клиент в DC столбца с ' + esc(st.rcl) + '. «Да»: чтение гарантированно видит подтверждённую запись.</p>';
    h += '<div class="tbl-wrap"><table><thead><tr><th>Пишет \\ читает</th>' + T.dcs.map(dc => '<th>' + esc(dc.name) + '</th>').join('') + '</tr></thead><tbody>';
    o.consMatrix.forEach((row, a) => { h += '<tr><td><b>' + esc(T.dcs[a].name) + '</b></td>' + row.map(v => '<td>' + (v === null ? '<span class="pill na">н/д</span>' : '<span class="pill ' + (v ? 'ok' : 'bad') + '">' + (v ? 'да' : 'нет') + '</span>') + '</td>').join('') + '</tr>'; });
    h += '</tbody></table></div>';
  }
  h += '<h3 class="sec">Случайный одновременный отказ k нод</h3>';
  h += '<p class="lead">Ноды отказывают случайно, без учёта racks. P: вероятность, что часть данных станет недоступна для операции. Доля: сколько данных в среднем недоступно. Оценка зависит от раскладки токенов: с vnodes почти любые две ноды из разных racks делят какой-то диапазон, поэтому вероятность ближе к худшему случаю, чем при num_tokens: 1.</p>';
  h += '<div class="chart-box"><div class="legend" id="ft-probLegend"></div><div id="ft-probChart"></div><div class="prog" id="ft-probProg"></div></div>';
  h += '<div class="tbl-wrap" style="margin-top:10px"><table id="ft-probTable"></table></div>';
  return h;
}
/** Легенда, график, состояние и таблица для задачи вероятности. */
export function probParts(task, res) {
  const rs = task.results; const kMax = task.kMax; const hasS = !!res.S;
  const series = [{ key: 'pW', f: 'fW', name: 'Запись ' + res.st.wcl, col: 'var(--series-write)' }, { key: 'pR', f: 'fR', name: 'Чтение ' + res.st.rcl, col: 'var(--series-read)' }];
  if (hasS) series.push({ key: 'pS', f: 'fS', name: 'LWT ' + res.st.scl, col: 'var(--series-lwt)' });
  series.push({ key: 'pL', f: 'fL', name: 'Потеря данных', col: 'var(--series-loss)' });
  const legend = probLegend(series);
  const svg = probChartSvg({ rs, kMax, series: series.map((s, si) => ({ key: s.key, name: s.name, col: s.col, width: [5, 2.4, 2.4, 2][si], opacity: si === 0 ? 0.55 : undefined, dash: s.key === 'pL' })), height: 240, maxWidth: 760, fmt: pctP, kLabel: k => 'k=' + k });
  const chart = svg + '<div class="note" style="text-align:center;margin:0">k: число одновременно отказавших нод</div>';
  const prog = task.done() ? (rs.every(r => r.exact) ? 'Перебор всех сочетаний, значения точные для смоделированной раскладки токенов.' : 'Где нет отметки «точно», оценка методом Монте-Карло; число испытаний указано в таблице.') : 'Считаю: k = ' + (rs.length + 1) + ' из ' + kMax + '…';
  let t = '<thead><tr><th class="n">k</th>' + series.map(s => '<th class="n">P · ' + esc(s.name) + '</th>').join('') + series.filter(s => s.key !== 'pL').map(s => '<th class="n">Доля · ' + esc(s.name.split(' ')[0].toLowerCase()) + '</th>').join('') + '<th class="n">Метод</th></tr></thead><tbody>';
  rs.forEach(r => {
    t += '<tr><td class="n">' + r.k + '</td>' + series.map(s => '<td class="n ' + (r[s.key] > 0.5 ? 'bad-t' : r[s.key] > 0 ? 'mid-t' : 'ok-t') + '">' + pctP(r[s.key]) + '</td>').join('') +
      series.filter(s => s.key !== 'pL').map(s => '<td class="n">' + pctP(r[s.f]) + '</td>').join('') + '<td class="n">' + (r.exact ? 'точно, ' + fmt(r.trials) + ' сочет.' : fmt(r.trials) + ' испыт.') + '</td></tr>';
  });
  return { legend, chart, prog, table: t + '</tbody>' };
}