/* Вкладка «Данные и нагрузка»: доли данных по racks и нодам, ГБ и операции на ноду, трафик между DC. */
import { esc, nf as fmt, plural } from '../../../shared/format.js';
import { pct } from './common.js';

export function dataHtml(o) {
  const T = o.T, L = o.load;
  let h = '<h3 class="sec">Распределение данных и нагрузки по нодам</h3>';
  h += '<p class="lead">Доля: какая часть одной копии данных keyspace лежит на ноде. Сумма долей по нодам DC равна RF этого DC. «Идеал» соответствует сбалансированной выдаче токенов (allocate_tokens_for_local_replication_factor), «модель» показывает разброс в смоделированной раскладке. Нагрузка на ноду пропорциональна её доле.</p>';
  h += '<div class="tbl-wrap"><table><thead><tr><th>DC</th><th>Rack</th><th class="n">Нод</th><th class="n">Доля на ноду, идеал</th><th class="n">Модель, мин…макс</th><th class="n">ГБ на ноду</th><th class="n">Записей/с на ноду</th><th class="n">Чтений/с на ноду</th></tr></thead><tbody>';
  T.dcs.forEach((dc, d) => {
    const sh = o.shares[d];
    const readFactor = dc.rf > 0 ? o.readPer[d] / Math.min(dc.rf, dc.N) : 0;
    dc.racks.forEach((r, i) => {
      const ri = sh.rackIdeal[i]; const sims = r.nodes.map(id => o.ring.own[id]);
      h += '<tr><td>' + (i === 0 ? '<b>' + esc(dc.name) + '</b> <span class="lbl">RF ' + dc.rf + '</span>' : '') + '</td><td>' + r.name + '</td><td class="n">' + r.n + '</td><td class="n">' + pct(ri.share) + '</td><td class="n">' + pct(Math.min(...sims)) + '…' + pct(Math.max(...sims)) + '</td>' +
        '<td class="n">' + (L.dataGB != null ? fmt(L.dataGB * ri.share, 1) : '—') + '</td><td class="n">' + (L.wps != null ? fmt(L.wps * ri.share) : '—') + '</td><td class="n">' + (L.rps != null ? fmt(L.rps * ri.share * readFactor) : '—') + '</td></tr>';
    });
  });
  h += '</tbody></table></div>';
  const cards = [];
  const copies = T.dcs.reduce((s, dc) => s + Math.min(dc.rf, dc.N), 0);
  cards.push({ k: 'Данных на дисках кластера', v: L.dataGB != null ? fmt(L.dataGB * copies) + ' <small>ГБ</small>' : '—', d: copies + ' ' + plural(copies, 'копия', 'копии', 'копий') + ' данных (сумма RF). Только данные: без запаса под compaction, snapshots, commitlog и hints.' });
  cards.push({ k: 'Записей реплик в секунду', v: L.wps != null ? fmt(L.wps * T.totRf) : '—', d: 'Каждая клиентская запись выполняется на всех ' + T.totRf + ' репликах, независимо от consistency level.' });
  if (T.dcs.length > 1) cards.push({ k: 'Трафик записи из ' + esc(T.dcs[o.c].name) + ' в другие DC', v: o.interDcMbps != null ? fmt(o.interDcMbps, 1) + ' <small>Мбит/с</small>' : '—', d: 'Записей/с × размер × ' + o.remoteDcs + ' ' + plural(o.remoteDcs, 'удалённый DC', 'удалённых DC', 'удалённых DC') + ' (координатор отправляет в каждый удалённый DC одно сообщение, там его пересылают остальным репликам). До сжатия internode_compression: dc; без repair, hints и streaming.' });
  h += '<div class="cards" style="margin-top:14px">' + cards.map(c => '<div class="card"><div class="k">' + c.k + '</div><div class="v">' + c.v + '</div><div class="d">' + c.d + '</div></div>').join('') + '</div>';
  if (L.dataGB == null && L.wps == null && L.rps == null) h += '<div class="w info">Заполните блок «Данные и нагрузка» слева, чтобы получить ГБ и операции на ноду. Размер дисков с учётом compaction, TTL и retention считается в калькуляторе системных требований TSDB.</div>';
  return h;
}