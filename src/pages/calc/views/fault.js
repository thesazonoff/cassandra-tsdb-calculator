/* Вкладка «Отказоустойчивость»: показатели, интерактивная схема кластера, вероятность при случайных отказах, отказ ДЦ. */
import * as FT from '../../../core/fault.js';
import { esc, plural } from '../../../shared/format.js';
import { probChartSvg, probLegend } from '../../../shared/prob.js';
import { stepper } from './common.js';

export function paneFt(ctx) {
  const { R, VAR, failed } = ctx;
  const o = ctx.ft, T = o.T, v = R.variants[VAR];
  if (o.errors && o.errors.length) return '<div class="chk crit"><span class="ic">!</span><div class="tt">Схема не считается</div><p>' + o.errors.map(esc).join('<br>') + '</p></div>';
  const D = T.dcs.length;
  const appTol = o.appTol, rt = o.rackTol[0], dc0 = T.dcs[0];
  const appR = Math.min(rt.w, rt.r, rt.s == null ? Infinity : rt.s);
  const cards = [];
  cards.push(`<div class="kpi"><span class="k">Отказ любых нод без остановки</span><span class="v ${appTol > 0 ? 'ok' : 'bad'}">${appTol < 0 ? 'нет' : appTol}</span><span class="d">Запись ${o.st.wcl}: ${Math.max(0, o.wTol)}, чтение ${o.st.rcl}: ${Math.max(0, o.rTol)}. Худший случай: отказали ноды с репликами одних и тех же данных.</span></div>`);
  cards.push(`<div class="kpi"><span class="k">Отказ стоек (racks)</span><span class="v ${dc0.K === 1 ? 'mid' : appR > 0 ? 'ok' : 'bad'}">${dc0.K === 1 ? '1 rack' : appR + ' из ' + dc0.K}</span><span class="d">${dc0.K === 1 ? 'Все ноды в одной стойке: её отказ останавливает ДЦ.' : 'Сколько стоек ' + esc(dc0.name) + ' может отказать без остановки MES.'}</span></div>`);
  cards.push(`<div class="kpi"><span class="k">Тренды и последняя точка</span><span class="v ${o.consistent ? 'ok' : 'mid'}">${o.consistent ? 'Всегда видна' : o.consistent === false ? 'С задержкой' : '—'}</span><span class="d">${o.consistent ? 'Чтение всегда застаёт реплику с последней записью.' : 'Чтение может вернуть старое значение до завершения репликации.'}</span></div>`);
  if (D > 1) {
    const okN = o.dcFail.filter(r => r.cells.every(c => !c || (c.w && c.r))).length;
    cards.push(`<div class="kpi"><span class="k">Отказ целого ДЦ</span><span class="v ${okN === D ? 'ok' : okN ? 'mid' : 'bad'}">${okN} из ${D}</span><span class="d">При отказе любого из ${okN} ДЦ остальные продолжают работу.</span></div>`);
  }
  let h = `<div class="kpis">${cards.join('')}</div>`;
  const manual = v.dcs.some(d => d.manual);
  h += `<div class="block"><div class="topo-h"><h3>Схема кластера <small>нажмите на ноду, стойку или ДЦ, чтобы смоделировать отказ</small></h3>
    <div class="row-actions" style="gap:8px">${manual ? '<button class="btn" type="button" data-topo="reset">Вернуть рекомендованную</button>' : ''}<button class="btn ghost" type="button" data-sact="clear">Все ноды в строй</button></div></div>
    <div class="topo">${T.dcs.map((dc, d) => `<div class="topo-dc"><div class="topo-h"><b><button class="rack-l" type="button" data-sact="dc" data-dc="${d}" style="font-size:15px;color:var(--ink)">${esc(dc.name)}</button></b><span class="muted">RF ${dc.rf} · ${dc.N} ${plural(dc.N, 'нода', 'ноды', 'нод')} · ${dc.K} ${plural(dc.K, 'стойка', 'стойки', 'стоек')}</span>
      <span class="row-actions" style="gap:6px"><button class="btn" type="button" data-topo="addRack" data-dc="${d}" ${dc.K >= 12 ? 'disabled' : ''}>+ стойка</button>${dc.K > 1 ? `<button class="btn" type="button" data-topo="delRack" data-dc="${d}">− стойка</button>` : ''}</span></div>
      <div class="topo-racks">${dc.racks.map((r, ri) => `<div class="rack"><button class="rack-l" type="button" data-sact="rack" data-rack="${r.gidx}">${r.name}</button>
        <div class="nodes">${r.nodes.map((id, i) => `<button type="button" class="nd${failed[id] ? ' down' : ''}" data-sact="node" data-node="${id}" title="${esc(T.nodes[id].name)}: ${FT.pct(o.ring.own[id])} данных" aria-pressed="${failed[id] ? 'true' : 'false'}" aria-label="${esc(T.nodes[id].name)}">${i + 1}</button>`).join('')}</div>
        ${stepper(`data-dc="${d}" data-rack="${ri}"`, r.n, 1, 100, 'нод в ' + r.name + ' ' + dc.name)}</div>`).join('')}</div></div>`).join('')}</div>
    <div id="schemeStatus"></div>
    <p class="hint">Изменение числа нод и стоек пересчитывает диски и ресурсы по самой загруженной ноде.</p></div>`;
  const warns = o.warnings.filter(w => w.level !== 'info' || /racks|rack/.test(w.text)).slice(0, 4);
  if (warns.length) h += `<div class="attn">${warns.map(w => `<div class="attn-i ${w.level === 'err' ? 'crit' : 'warn'}"><span class="ic" aria-hidden="true">${w.level === 'info' ? 'i' : '!'}</span><div>${esc(w.text)}</div></div>`).join('')}</div>`;
  h += `<details class="more" id="prob-det"><summary>Вероятность при случайном отказе нескольких нод</summary><div class="more-body"><p class="hint">Ноды отказывают случайно. P: вероятность, что часть данных станет недоступна. С vnodes почти любые две ноды из разных стоек делят какой-то диапазон.</p><div class="chart" id="probChart"></div><div class="tbl-wrap"><table class="t" id="probTable"></table></div><p class="hint" id="probProg"></p></div></details>`;
  if (D > 1) {
    h += `<details class="more"><summary>Отказ целого ДЦ подробно</summary><div class="more-body"><div class="tbl-wrap"><table class="t"><thead><tr><th>Отказал</th>${T.dcs.map(dc => `<th>MES в ${esc(dc.name)}</th>`).join('')}</tr></thead><tbody>
    ${o.dcFail.map(row => `<tr><th scope="row">${esc(T.dcs[row.dc].name)}</th>${row.cells.map(c => c ? `<td><span class="pill ${c.w ? 'ok' : 'bad'}">запись ${c.w ? 'да' : 'нет'}</span> <span class="pill ${c.r ? 'ok' : 'bad'}">чтение ${c.r ? 'да' : 'нет'}</span></td>` : '<td><span class="pill na">недоступен</span></td>').join('')}</tr>`).join('')}
    </tbody></table></div></div></details>`;
  }
  return h;
}

/** Состояние после отмеченных отказов. */
export function schemeStatusHtml(o, failed) {
  if (!o || o.errors.length) return '';
  const T = o.T;
  const nDown = failed.reduce((a, b) => a + b, 0);
  if (!nDown) return '<p class="hint">Все ноды работают.</p>';
  const ev = FT.evalFailures(T, o.ring, failed, o.W, o.R, o.S);
  const item = (t, frac) => { const bad = frac > 1e-12; return `<div class="ft-st"><span class="t">${t}</span><span class="x ${bad ? 'bad-t' : 'ok-t'}">${bad ? 'недоступно ' + FT.pct(frac) + ' данных' : 'работает'}</span></div>`; };
  return `<div class="ft-status"><div class="ft-st"><span class="t">Отказало</span><span class="x">${nDown} из ${T.N}</span></div>${item('Запись · ' + o.st.wcl, ev.w)}${item('Чтение · ' + o.st.rcl, ev.r)}
    <div class="ft-st"><span class="t">Сохранность</span><span class="x ${ev.loss > 1e-12 ? 'bad-t' : 'ok-t'}">${ev.loss > 1e-12 ? 'все копии ' + FT.pct(ev.loss) + ' данных на отказавших нодах' : 'копии всех данных живы'}</span></div></div>`;
}

/** График, таблица и строка состояния для задачи вероятности. */
export function probParts(task, ft) {
  const rs = task.results, kMax = task.kMax, FTR = ft;
  const series = [{ key: 'pW', name: 'Запись ' + FTR.st.wcl, col: 'var(--brand)', w: 3 }, { key: 'pR', name: 'Чтение ' + FTR.st.rcl, col: 'var(--info)', w: 2 }, { key: 'pL', name: 'Потеря всех копий', col: 'var(--crit)', w: 2, dash: true }];
  const chart = probChartSvg({ rs, kMax, series: series.map(s => ({ key: s.key, name: s.name, col: s.col, width: s.w, dash: s.dash })), height: 220, maxWidth: 720, fmt: FT.pct }) + '<div class="legend">' + probLegend(series) + '</div>';
  const table = `<thead><tr><th class="r">Отказало нод</th>${series.map(s => `<th class="r">${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${rs.map(r => `<tr><td class="r">${r.k}</td>${series.map(s => `<td class="r ${r[s.key] > 0.5 ? 'bad-t' : r[s.key] > 0 ? 'mid-t' : 'ok-t'}">${FT.pct(r[s.key])}</td>`).join('')}</tr>`).join('')}</tbody>`;
  const prog = task.done() ? (rs.every(r => r.exact) ? 'Перебор всех сочетаний.' : 'Оценка методом Монте-Карло, где сочетаний слишком много.') : 'Считаю…';
  return { chart, table, prog };
}
