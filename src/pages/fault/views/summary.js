/* Вкладка «Итог»: консистентность, отказы нод без влияния и без потери данных, реплики в операции, доля данных, racks, DC, замечания. */
import { esc, nf as fmt, plural } from '../../../shared/format.js';
import { pct, tolText } from './common.js';

export function summaryHtml(o) {
  const T = o.T, st = o.st, c = o.c, D = T.dcs.length; const cname = T.dcs[c].name;
  const multi = D > 1;
  const cards = [];
  // 1. консистентность
  let cv, cc, cd;
  if (o.consistent === null) { cv = 'н/д'; cc = 'bad'; cd = 'Один из consistency level не выполняется даже при всех живых нодах.'; }
  else {
    cv = o.consistent ? 'Консистентно' : 'Eventually consistent'; cc = o.consistent ? 'ok' : 'mid';
    const localBoth = /^LOCAL_/.test(st.wcl) && /^LOCAL_/.test(st.rcl);
    const rfRel = (!multi || localBoth) ? T.rf[c] : T.totRf;
    const simple = !o.W.any && (!multi || localBoth || (!/LOCAL_|EACH/.test(st.wcl + st.rcl)));
    cd = simple ? 'W + R ' + (o.W.acks + o.R.acks > rfRel ? '>' : '≤') + ' RF: <b>' + o.W.acks + ' + ' + o.R.acks + (o.W.acks + o.R.acks > rfRel ? ' > ' : ' ≤ ') + rfRel + '</b>' + (multi && localBoth ? ' в ' + esc(cname) : '') + '. '
      : '';
    cd += o.consistent ? 'Чтение всегда застаёт хотя бы одну реплику с последней подтверждённой записью.' : 'Чтение может вернуть старое значение, пока запись не дошла до всех реплик.';
  }
  cards.push({ k: 'Чтения' + (multi ? ' (клиент в ' + esc(cname) + ')' : ''), v: cv, cls: cc, d: cd,
    sub: multi ? 'Клиент в другом DC: ' + (o.consMatrix.every(r => r.every(x => x)) ? 'тоже консистентно.' : 'не гарантировано, см. матрицу на вкладке «Отказы».') : '' });
  // 2. отказ нод без влияния
  const tolParts = ['запись (' + st.wcl + '): <b>' + tolText(o.wTol) + '</b>', 'чтение (' + st.rcl + '): <b>' + tolText(o.rTol) + '</b>'];
  if (o.S) tolParts.push('LWT (' + st.scl + '): <b>' + tolText(o.sTol) + '</b>');
  cards.push({ k: 'Отказ любых нод без влияния на приложение', v: o.appTol < 0 ? 'недоступно' : String(o.appTol), cls: o.appTol < 0 ? 'bad' : o.appTol === 0 ? 'bad' : 'ok',
    d: tolParts.join(' · '), sub: 'Нижняя граница для худшего случая: отказали ноды, хранящие реплики одного и того же диапазона. Случайные отказы оценены на вкладке «Отказы».' });
  // 3. без потери данных
  cards.push({ k: 'Отказ любых нод без потери данных', v: String(o.ackLossTol), cls: o.ackLossTol === 0 && T.N > 1 ? 'mid' : 'ok',
    d: 'Для только что подтверждённой записи: она гарантированно есть на <b>' + Math.max(o.W.acks, o.W.any ? 0 : 1) + '</b> ' + plural(Math.max(o.W.acks, 1), 'реплике', 'репликах', 'репликах') + '.',
    sub: 'После репликации на все копии (hints, repair): <b>' + o.replLossTol + '</b> ' + plural(o.replLossTol, 'нода', 'ноды', 'нод') + ' из ' + T.N + '.' });
  // 4. сколько реплик в операции
  const rp = o.readPer.map((n, d) => n > 0 ? n + ' в ' + esc(T.dcs[d].name) : null).filter(Boolean).join(', ');
  cards.push({ k: 'Реплик в одной операции', v: (o.W.any ? 'hint' : o.W.acks) + ' <small>/</small> ' + (o.R.ok ? o.R.acks : '—'), cls: '',
    d: 'Запись отправляется на все <b>' + T.totRf + '</b> ' + plural(T.totRf, 'реплику', 'реплики', 'реплик') + ', клиент ждёт подтверждения от <b>' + (o.W.any ? '1 ноды (можно hint)' : o.W.acks) + '</b>.',
    sub: 'Чтение ждёт ответа от <b>' + (o.R.ok ? o.R.acks : '—') + '</b>' + (multi && rp ? ': ' + rp : '') + '. Чем больше реплик в ответе, тем выше задержка и сетевой трафик.' });
  // 5. доля данных
  const shareLines = o.shares.map(sh => { const dc = T.dcs[sh.dc]; if (dc.rf === 0) return esc(dc.name) + ': 0% (RF=0)'; return esc(dc.name) + ': ' + (Math.abs(sh.idealMax - sh.idealMin) < 1e-9 ? pct(sh.idealAvg) : pct(sh.idealMin) + '…' + pct(sh.idealMax)); });
  const sh0 = o.shares[c];
  const vShare = Math.abs(sh0.idealMax - sh0.idealMin) < 1e-9 ? pct(sh0.idealAvg) : pct(sh0.idealMin) + '…' + pct(sh0.idealMax);
  let gb = '';
  if (o.load.dataGB != null) gb = 'При ' + fmt(o.load.dataGB) + ' ГБ одной копии: ' + o.perDc.map((p, d) => esc(T.dcs[d].name) + ' ' + fmt(p.gbMax, 1) + ' ГБ на самую загруженную ноду').join('; ') + '.';
  cards.push({ k: 'Каждая нода хранит' + (multi ? ' (' + esc(cname) + ')' : ''), v: vShare, cls: sh0.idealMax / Math.max(sh0.idealMin, 1e-9) > 1.05 ? 'mid' : '',
    d: (multi ? shareLines.join(' · ') + '. ' : '') + 'Доля одной копии данных при сбалансированных токенах. Столько же данных станет недоступно при каждой лишней потерянной ноде.', sub: gb });
  // 6. racks
  const rt = o.rackTol[c]; const dcC = T.dcs[c];
  const appR = Math.min(rt.w, rt.r, rt.s == null ? Infinity : rt.s);
  let rv, rcls = 'ok';
  if (dcC.K === 1) { rv = '1 rack'; rcls = 'mid'; } else { rv = appR + ' <small>из ' + dcC.K + '</small>'; if (appR === 0) rcls = 'bad'; }
  cards.push({ k: 'Отказ racks в ' + esc(cname), v: rv, cls: rcls,
    d: dcC.K === 1 ? 'Все ноды в одном rack: отказ rack равен отказу всего DC.' : 'Без влияния на приложение переносится отказ любых racks в количестве ' + appR + ', без потери данных: ' + rt.loss + '.',
    sub: dcC.K > 1 && rt.maxPerRack > 1 ? 'В одном rack лежит до ' + rt.maxPerRack + ' реплик одного диапазона (racks меньше RF).' : '' });
  // 7. DC
  if (multi) {
    const lines = o.dcFail.map(row => {
      const okC = row.cells.map((cell, cc2) => cell ? { cc2, ok: cell.w && cell.r && (cell.s == null || cell.s), cell } : null).filter(Boolean);
      const allOk = okC.every(x => x.ok);
      const failTxt = okC.filter(x => !x.ok).map(x => {
        const ops = []; if (!x.cell.w) ops.push('запись'); if (!x.cell.r) ops.push('чтение'); if (x.cell.s === false) ops.push('LWT');
        return ops.join(', ') + ' в ' + esc(T.dcs[x.cc2].name);
      }).join('; ');
      return { allOk, txt: 'Отказ ' + esc(T.dcs[row.dc].name) + ': ' + (allOk ? '<span class="ok-t">приложение в остальных DC работает</span>' : '<span class="bad-t">останавливается ' + failTxt + '</span>') + (row.dataSafe ? '' : ', <span class="bad-t">данные теряются</span>') };
    });
    const n = lines.filter(l => l.allOk).length;
    cards.push({ k: 'Отказ целого DC', v: n + ' <small>из ' + D + '</small>', cls: n === D ? 'ok' : n === 0 ? 'bad' : 'mid', d: lines.map(l => l.txt).join('<br>') });
  }
  const warns = o.warnings.slice().sort((a, b) => ({ err: 0, warn: 1, info: 2 }[a.level] - { err: 0, warn: 1, info: 2 }[b.level]));
  return '<div class="cards">' + cards.map((cd, i) => '<div class="card' + (i < 2 ? ' accent' : '') + '"><div class="k">' + cd.k + '</div><div class="v ' + (cd.cls || '') + '">' + cd.v + '</div><div class="d">' + cd.d + '</div>' + (cd.sub ? '<div class="sub">' + cd.sub + '</div>' : '') + '</div>').join('') + '</div>' +
    (warns.length ? '<h3 class="sec">Замечания по схеме</h3><div class="warns">' + warns.map(w => '<div class="w ' + w.level + '">' + esc(w.text) + '</div>').join('') + '</div>' : '');
}