/* Вкладка «Итог»: число нод, конфигурация ноды, ключевые показатели, что учесть, сравнение вариантов схемы. */
import { esc, nf, fB, pct, plural, dsz } from '../../../shared/format.js';
import { VN, drivesStr, attnList, checksHtml } from './common.js';

export function paneSum(ctx) {
  const { R, S, VAR } = ctx;
  const v = R.variants[VAR], n = v.node, ch = v.chosen, rep = R.rep;
  const D = rep.dcs.length;
  const N = v.Ntotal;
  const unit = R.standalone ? 'сервер, одна нода' : (D > 1 ? `${plural(N, 'нода', 'ноды', 'нод')}: ${v.dcs.map((d, i) => rep.dcs[i].name + ' ' + d.N).join(', ')}` : plural(N, 'нода', 'ноды', 'нод'));
  const tol = R.standalone ? 'Без резервирования' : `Выдерживает отказ ${Math.max(0, Math.min(R.tol.w, R.tol.r))} ${plural(Math.max(0, Math.min(R.tol.w, R.tol.r)), 'ноды', 'нод', 'нод')}`;
  const rfs = [...new Set(rep.dcs.map(d => d.rf))].join('/');
  let h = `<div class="verdict">
    <div><div class="v-num">${N}</div><div class="v-unit">${esc(unit)}</div></div>
    <div class="v-spec">
      <div class="line">${ch.p.c} ${plural(ch.p.c, 'ядро', 'ядра', 'ядер')} · ${ch.p.ram} ГБ RAM на ноду</div>
      <div class="line">Data: ${esc(drivesStr(n))}</div>
      <div class="line">Commitlog: ${dsz(n.commitlog.drive)} SSD · ОС: 2 × ${dsz(n.os.drive)} RAID 1</div>
      <div class="chips"><span class="chip">RF ${rfs}</span><span class="chip">${rep.wcl === rep.rcl ? esc(rep.wcl) : 'запись ' + esc(rep.wcl) + ' · чтение ' + esc(rep.rcl)}</span><span class="chip lime">${tol}</span><span class="chip">${S.comp === 'none' ? 'Без сжатия' : 'LZ4'}</span>${R.calib.valid && R.calib.on ? '<span class="chip">Откалибровано</span>' : ''}</div>
    </div></div>`;
  const dataAll = (v.L + v.snapT) * rep.dcs.reduce((a, d) => a + d.rf, 0);
  const bpp = v.compDay / (R.P * 86400);
  h += `<div class="kpis">
    <div class="kpi"><span class="k">Поток записи</span><span class="v">${nf(R.P)}</span><span class="d">точек/с; через ${R.Y} ${plural(R.Y, 'год', 'года', 'лет')} ${nf(R.P * R.Gf)}</span></div>
    <div class="kpi"><span class="k">Данные с репликами</span><span class="v">${fB(dataAll)}</span><span class="d">на горизонте ${R.Y} ${plural(R.Y, 'год', 'года', 'лет')}${D > 1 ? ', все ДЦ' : ''}</span></div>
    <div class="kpi"><span class="k">Data-диск на ноду</span><span class="v">${fB(n.reqData)}</span><span class="d">заполнять не выше ${pct(n.fillLimit * 100)}</span></div>
    <div class="kpi"><span class="k">Байт на точку</span><span class="v">${nf(bpp, 1)}</span><span class="d">${S.comp === 'none' ? 'без сжатия; с LZ4 ' + nf(v.lz4.day / (R.P * 86400), 1) : 'LZ4; без сжатия ' + nf(v.none.day / (R.P * 86400), 1)}</span></div>
  </div>`;
  const att = attnList(R, 4), total = R.checks.filter(c => c.sev === 'crit' || c.sev === 'warn').length;
  if (att.length) {
    h += `<div class="block"><h3>Что учесть</h3><div class="attn">${att.map(c => `<div class="attn-i ${c.sev}"><span class="ic" aria-hidden="true">!</span><div><b>${esc(c.title)}.</b> ${esc(c.fix || c.text)}</div></div>`).join('')}</div>
    ${total > att.length || R.checks.length > att.length ? `<details class="more"><summary>Все проверки (${R.checks.length})</summary><div class="more-body">${checksHtml(R)}</div></details>` : ''}</div>`;
  }
  const cols = ['cur', 'rec', 'unset'];
  const row = (label, f, note) => `<tr><th scope="row">${label}${note ? `<br><small class="muted">${note}</small>` : ''}</th>${cols.map(k => `<td class="r${k === VAR ? ' sel' : ''}">${f(R.variants[k])}</td>`).join('')}</tr>`;
  h += `<div class="block"><h3>Текущая схема и рекомендации</h3><div class="tbl-wrap"><table class="t cmp3"><thead><tr><th></th>${cols.map(k => `<th class="r${k === VAR ? ' sel' : ''}">${esc(VN[k])}</th>`).join('')}</tr></thead><tbody>
    ${row('Байт на точку, LZ4', x => nf(x.lz4.day / (R.P * 86400), 1))}
    ${row('Байт на точку без сжатия', x => nf(x.none.day / (R.P * 86400), 1))}
    ${row('Данные одной копии', x => fB(x.L), 'на горизонте')}
    ${row('Нод', x => nf(x.Ntotal))}
    ${row('Data-диск на ноду', x => fB(x.node.reqData))}
  </tbody></table></div>
  <p class="hint">Рекомендации не требуют доработки MES: TTL таблицы вместо DELETE, окно TWCS ${R.Wrec} ${plural(R.Wrec, 'сутки', 'суток', 'суток')}, incremental_backups выключен. TTL добавляет к точке несколько байт, зато старые данные удаляются вовремя. Доработка драйвера C#: Unset.Value вместо null, без 5 tombstone-ячеек на точку.</p></div>`;
  if (!v.own && !R.standalone) {
    h += `<details class="more"><summary>Другие конфигурации ноды</summary><div class="more-body"><div class="tbl-wrap"><table class="t"><thead><tr><th>Нода</th><th class="r">Нод</th><th>Число нод определяет</th><th class="r">CPU в пике</th><th class="r">RAM нужно</th></tr></thead><tbody>
    ${v.cands.map(c => `<tr class="click ${c === ch ? 'sel' : ''}" data-prof="${c.p.id}" tabindex="0"><th scope="row">${c.p.c} ядер · ${c.p.ram} ГБ ${c === ch ? '<span class="tag ok">выбрано</span>' : ''}</th><td class="r">${nf(c.Ntot)}</td><td>${esc(c.limits.join(', ') || '—')}</td><td class="r">${pct(c.node.cpu.peakUtil)}</td><td class="r">${nf(c.node.ram.need)} из ${c.p.ram} ГБ</td></tr>`).join('')}
    </tbody></table></div>${S.profileOverride ? '<div><button class="btn ghost" type="button" data-prof-auto>Вернуть автоматический выбор</button></div>' : ''}
    <p class="hint">Автовыбор минимизирует суммарные ядра и RAM. Щёлкните строку, чтобы выбрать вручную.</p></div></details>`;
  }
  return h;
}
