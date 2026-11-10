/* Вкладка «Схема отказов»: DC, racks и ноды кнопками; доступность записи, чтения, LWT и сохранность при отмеченных отказах. */
import * as C from '../../../core/fault.js';
import { esc } from '../../../shared/format.js';
import { pct, pctP } from './common.js';

export function schemeHtml(o, failed, randK) {
  const T = o.T;
  let h = '<p class="lead">Нажмите на ноду, rack или DC, чтобы отметить отказ. Ниже пересчитывается, какая доля данных остаётся доступной для записи и чтения у приложения в ' + esc(T.dcs[o.c].name) + '. Подсказка на ноде показывает её долю данных в смоделированной раскладке токенов.</p>';
  h += '<div class="row" style="margin-bottom:10px"><button class="btn sm" type="button" data-sact="clear">Все ноды в строй</button><span class="lbl">Случайный отказ</span><span class="stepper"><button type="button" data-sact="kdec">−</button><input type="number" id="ft-randK" value="' + (randK || Math.min(2, T.N)) + '" min="1" max="' + T.N + '" aria-label="Число нод"><button type="button" data-sact="kinc">+</button></span><button class="btn sm" type="button" data-sact="rand">нод</button></div>';
  h += '<div class="scheme">' + T.dcs.map(dc => '<div class="s-dc"><div class="s-dc-h"><button class="btn sm" type="button" data-sact="dc" data-dc="' + dc.idx + '">' + esc(dc.name) + '</button><span class="lbl">RF ' + dc.rf + '</span></div><div class="s-racks">' +
    dc.racks.map(r => '<div class="s-rack"><div class="s-rack-h" data-sact="rack" data-rack="' + r.gidx + '" role="button" tabindex="0">' + r.name + '</div><div class="s-nodes">' +
      r.nodes.map((id, i) => '<button type="button" class="node' + (failed[id] ? ' down' : '') + '" data-sact="node" data-node="' + id + '" title="' + esc(T.nodes[id].name) + ': ' + pct(o.ring.own[id]) + ' данных">' + (i + 1) + '</button>').join('') +
      '</div></div>').join('') + '</div></div>').join('') + '</div>';
  h += '<div id="ft-schemeStatus">' + schemeStatusHtml(o, failed) + '</div>';
  return h;
}
export function schemeStatusHtml(o, failed) {
  const T = o.T;
  const nDown = failed.reduce((s, x) => s + x, 0);
  const ev = C.evalFailures(T, o.ring, failed, o.W, o.R, o.S);
  const item = (t, frac, okText) => { const avail = 1 - frac; const bad = frac > 1e-12; return '<div class="st"><div class="t">' + t + '</div><div class="x ' + (bad ? 'bad-t' : 'ok-t') + '">' + (bad ? 'доступно ' + pctP(avail) + ' данных' : okText) + '</div><div class="bar' + (bad ? ' bad' : '') + '"><span style="width:' + (avail * 100).toFixed(1) + '%"></span></div></div>'; };
  let h = '<div class="status">';
  h += '<div class="st"><div class="t">Отказавших нод</div><div class="x">' + nDown + ' из ' + T.N + '</div></div>';
  h += item('Запись · ' + o.st.wcl, ev.w, 'работает');
  h += item('Чтение · ' + o.st.rcl, ev.r, 'работает');
  if (o.S) h += item('LWT · ' + o.st.scl, ev.s, 'работает');
  h += '<div class="st"><div class="t">Сохранность данных</div><div class="x ' + (ev.loss > 1e-12 ? 'bad-t' : 'ok-t') + '">' + (ev.loss > 1e-12 ? 'все реплики ' + pctP(ev.loss) + ' данных на отказавших нодах' : 'реплики всех данных живы') + '</div></div>';
  h += '</div>';
  const cdc = T.dcs[o.c];
  if (T.dcs.length > 1 && cdc.nodes.every(id => failed[id])) h += '<div class="w warn" style="margin-bottom:8px">Все ноды ' + esc(cdc.name) + ' отказали. Приложение, работающее с LOCAL_*, должно переключиться на другой DC: выберите его в поле «DC приложения» слева, чтобы увидеть, что работает там.</div>';
  if (ev.loss > 1e-12) h += '<div class="w err">Если отказ этих нод означает потерю дисков, часть данных восстанавливается только из бэкапа.</div>';
  return h;
}