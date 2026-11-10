/* Вкладка «Диски»: накопители ноды, состав data-диска, LZ4 против хранения без сжатия, итог по кластеру. */
import * as E from '../../../core/sizing.js';
import { esc, nf, fB, fTB, pct, plural, dsz } from '../../../shared/format.js';
import { drivesStr } from './common.js';

export function paneDisk(ctx) {
  const { R, S, VAR } = ctx;
  const v = R.variants[VAR], n = v.node, d = n.data.drives, rep = R.rep;
  const usable = (d.usable || 0) * 1e12, fsRes = n.reqData * E.M.fsReserve;
  const segs = [
    ['Данные', n.live, 'var(--seg-live)', 'Срок хранения × поток × RF / число нод'],
    ['Запас compaction', n.head, 'var(--seg-head)', 'Не меньше двух окон TWCS или 10 % данных'],
    ['Repair и streaming', n.repair, 'var(--seg-repair)', '10 % данных'],
    ['Резерв snapshot', n.snapRes, 'var(--seg-snap)', '5 % данных под nodetool snapshot'],
    ['Snapshot после TRUNCATE', n.autoSnap, 'var(--seg-auto)', 'Копия таблицы до nodetool clearsnapshot'],
    ['Hints', n.hints, 'var(--seg-hints)', '3 ч записи на отказавшие ноды'],
    ['incremental backups', n.backups, 'var(--seg-back)', v.v.backups === 'on_nocleanup' ? 'Не чистится, копится весь горизонт' : 'До очистки'],
    ['Резерв ФС', fsRes, 'var(--seg-fs)', '5 % свободного места XFS']
  ].filter(x => x[1] > 0);
  const total = Math.max(usable, n.reqData), free = Math.max(0, usable - n.reqData);
  const bar = segs.map(x => `<i style="width:${(x[1] / total * 100).toFixed(3)}%;background:${x[2]}" title="${esc(x[0])}: ${fB(x[1])}"></i>`).join('');
  let h = `<div class="disk-cards">
    <div class="dcard"><span class="role">ОС и логи</span><span class="big">2 × ${dsz(n.os.drive)}</span><span>RAID 1</span><span class="hint">ОС, логи, heap dump ${n.ram.heap} ГБ</span></div>
    <div class="dcard"><span class="role">Commitlog</span><span class="big">${dsz(n.commitlog.drive)}</span><span>Отдельный SSD${R.standalone ? ', лучше RAID 1' : ''}</span><span class="hint">commitlog_total_space ${n.commitlog.totalMiB} MiB</span></div>
    <div class="dcard main"><span class="role">Data, hints, saved_caches</span><span class="big">${d.n ? `${d.n} × ${dsz(d.size)}` : '—'}</span><span>${esc(drivesStr(n))}</span><span class="hint">Нужно ${fB(n.reqData)}, полезно ${d.n ? fTB(d.usable) : '—'}</span></div>
  </div>
  <div class="block"><h3>Состав data-диска одной ноды</h3>
    <div class="stack" role="img" aria-label="Состав data-диска">${bar}</div>
    <div class="legend">${segs.map(x => `<span><i style="background:${x[2]}"></i>${esc(x[0])} ${fB(x[1])}</span>`).join('')}${free > 0 ? `<span><i style="background:var(--surface-2);border:1px solid var(--line-strong)"></i>Свободно ${fB(free)}</span>` : ''}</div>
    <div class="tbl-wrap"><table class="t"><thead><tr><th>Компонент</th><th class="r">На ноду</th><th>Как считается</th></tr></thead><tbody>
    ${segs.map(x => `<tr><th scope="row">${esc(x[0])}</th><td class="r">${fB(x[1])}</td><td>${esc(x[3])}</td></tr>`).join('')}
    <tr><th scope="row">Итого</th><td class="r"><b>${fB(n.reqData)}</b></td><td>Заполнение данными не выше ${pct(n.fillLimit * 100)}</td></tr>
    </tbody></table></div></div>`;
  const kTot = rep.dcs.reduce((a, x) => a + x.rf, 0);
  const dataFor = day => (v.cleanup === 'ttl' || v.v.cleanup === 'ttl' ? day * R.Gf * (R.ret + v.v.W + v.v.gcSec / 86400) : day / v.compDay * v.L);
  const lz4L = dataFor(v.lz4.day), noneL = dataFor(v.none.day);
  h += `<div class="split">
    <div class="block"><h3>LZ4 и без сжатия</h3><div class="tbl-wrap"><table class="t"><thead><tr><th></th><th class="r">LZ4</th><th class="r">Без сжатия</th></tr></thead><tbody>
      <tr><th scope="row">Байт на точку</th><td class="r">${nf(v.lz4.day / (R.P * 86400), 1)}</td><td class="r">${nf(v.none.day / (R.P * 86400), 1)}</td></tr>
      <tr><th scope="row">Данные в сутки, 1 копия</th><td class="r">${fB(v.lz4.day * R.Gf)}</td><td class="r">${fB(v.none.day * R.Gf)}</td></tr>
      <tr><th scope="row">Данные с репликами</th><td class="r">${fB(lz4L * kTot)}</td><td class="r">${fB(noneL * kTot)}</td></tr>
    </tbody></table></div><p class="hint">LZ4 почти не нагружает CPU и уменьшает объём и чтение с диска. Без сжатия имеет смысл только при нехватке CPU.</p></div>
    <div class="block"><h3>${R.standalone ? 'Сервер' : 'Весь кластер'}</h3><div class="tbl-wrap"><table class="t"><tbody>
      <tr><th scope="row">Нод</th><td class="r">${nf(v.Ntotal)}</td></tr>
      <tr><th scope="row">Data-накопителей</th><td class="r">${d.n ? nf(d.n * v.Ntotal) + ' × ' + dsz(d.size) : '—'}</td></tr>
      <tr><th scope="row">Полезная ёмкость data</th><td class="r">${d.n ? fTB(d.usable * v.Ntotal) : '—'}</td></tr>
      <tr><th scope="row">Commitlog</th><td class="r">${nf(v.Ntotal)} × ${dsz(n.commitlog.drive)}</td></tr>
      <tr><th scope="row">ОС</th><td class="r">${nf(v.Ntotal * 2)} × ${dsz(n.os.drive)}</td></tr>
    </tbody></table></div></div></div>
  <p class="hint">Ёмкость в десятичных ТБ, как у производителей. Расчёт на конец горизонта ${R.Y} ${plural(R.Y, 'год', 'года', 'лет')} с ростом ${nf(S.growth)} %/год. ${esc(v.Lnote)}.</p>`;
  return h;
}
