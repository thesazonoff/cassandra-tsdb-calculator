/* Движок отказоустойчивости Apache Cassandra 5.0: топология, требования consistency level, кольцо токенов,
 * размещение реплик (повторяет NetworkTopologyStrategy.calculateNaturalReplicas 5.0.9), отказы нод, racks и DC,
 * вероятность при случайных отказах. Один движок для обеих страниц. Чистые функции без DOM. */
const CL_LIST = ['ANY', 'ONE', 'TWO', 'THREE', 'QUORUM', 'ALL', 'LOCAL_ONE', 'LOCAL_QUORUM', 'EACH_QUORUM', 'SERIAL', 'LOCAL_SERIAL'];
const WRITE_CL = ['ANY', 'ONE', 'TWO', 'THREE', 'QUORUM', 'ALL', 'LOCAL_ONE', 'LOCAL_QUORUM', 'EACH_QUORUM'];
const READ_CL = ['ONE', 'TWO', 'THREE', 'QUORUM', 'ALL', 'LOCAL_ONE', 'LOCAL_QUORUM', 'EACH_QUORUM'];
const SERIAL_CL = ['SERIAL', 'LOCAL_SERIAL'];
const TOKEN_CHOICES = [1, 4, 8, 16, 32, 64, 128, 256];
const LIMITS = { maxDc: 5, maxNodesPerDc: 100, maxRacksPerDc: 12, maxRf: 9 };

function defaultState() {
  return {
    cluster: 'MES Cluster', ks: 'TSDB',
    dcs: [{ name: 'DC1', rf: 3, racks: [1, 1, 1] }],
    wcl: 'LOCAL_QUORUM', rcl: 'LOCAL_QUORUM', clientDc: 0,
    lwt: false, scl: 'LOCAL_SERIAL',
    numTokens: 16, tokenMode: 'balanced', seed: 1,
    dataGB: '', writesPs: '', readsPs: '', rowBytes: ''
  };
}

// ---------- утилиты ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  return arr;
}
const sum = a => a.reduce((s, x) => s + x, 0);
function num(v) { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
function binom(n, k) { if (k < 0 || k > n) return 0; k = Math.min(k, n - k); let r = 1; for (let i = 1; i <= k; i++) { r = r * (n - k + i) / i; if (r > 1e12) return Infinity; } return Math.round(r); }

// ---------- топология ----------
function buildTopology(st) {
  const errors = [];
  const dcs = []; const nodes = []; const racks = [];
  if (!st.dcs || !st.dcs.length) errors.push('Не задан ни один DC.');
  const names = new Set();
  (st.dcs || []).forEach((d, di) => {
    const name = String(d.name || ('DC' + (di + 1))).trim();
    if (names.has(name)) errors.push('Имя DC «' + name + '» повторяется.');
    names.add(name);
    const rf = Math.max(0, Math.floor(num(d.rf) || 0));
    const rk = (d.racks || []).map(x => Math.max(0, Math.floor(num(x) || 0)));
    const dc = { idx: di, name, rf, racks: [], nodes: [], N: 0, K: 0 };
    rk.forEach((n, ri) => {
      const rack = { gidx: racks.length, dc: di, local: ri, name: 'RACK' + (ri + 1), n, nodes: [] };
      for (let k = 0; k < n; k++) {
        const node = { id: nodes.length, dc: di, rack: rack.gidx, rackLocal: ri, name: name.toLowerCase() + '-r' + (ri + 1) + '-n' + (k + 1) };
        nodes.push(node); rack.nodes.push(node.id); dc.nodes.push(node.id);
      }
      if (n > 0) { racks.push(rack); dc.racks.push(rack); }
    });
    dc.N = dc.nodes.length; dc.K = dc.racks.length;
    if (dc.N === 0) errors.push('В ' + name + ' нет ни одной ноды.');
    if (rf > dc.N && dc.N > 0) errors.push(name + ': RF=' + rf + ' больше числа нод (' + dc.N + '). NetworkTopologyStrategy разместит реплики только на ' + dc.N + ' нодах, а QUORUM и ALL будут считаться от RF=' + rf + '. Уменьшите RF или добавьте ноды.');
    if (rf > LIMITS.maxRf) errors.push(name + ': RF больше ' + LIMITS.maxRf + ' калькулятор не поддерживает.');
    if (dc.N > LIMITS.maxNodesPerDc) errors.push(name + ': больше ' + LIMITS.maxNodesPerDc + ' нод в DC калькулятор не поддерживает.');
    dcs.push(dc);
  });
  const rf = dcs.map(d => d.rf);
  const totRf = sum(rf);
  if (dcs.length && totRf === 0) errors.push('Сумма RF по всем DC равна 0: keyspace не хранит данных.');
  if (dcs.length > LIMITS.maxDc) errors.push('Больше ' + LIMITS.maxDc + ' DC калькулятор не поддерживает.');
  return { dcs, nodes, racks, rf, totRf, N: nodes.length, errors };
}

// ---------- consistency level ----------
// Требование CL: минимум живых реплик в каждом DC (mins) и в сумме (g). Формулы как в ConsistencyLevel.blockFor (5.0.9).
function requirement(cl, c, T) {
  const D = T.dcs.length; const mins = new Array(D).fill(0); let g = 0; const rf = T.rf; const tot = T.totRf;
  let any = false; const q = x => Math.floor(x / 2) + 1;
  switch (cl) {
    case 'ANY': any = true; break;
    case 'ONE': g = 1; break;
    case 'TWO': g = 2; break;
    case 'THREE': g = 3; break;
    case 'QUORUM': case 'SERIAL': g = q(tot); break;
    case 'ALL': for (let d = 0; d < D; d++) mins[d] = rf[d]; g = tot; break;
    case 'LOCAL_ONE': mins[c] = 1; break;
    case 'LOCAL_QUORUM': case 'LOCAL_SERIAL': mins[c] = q(rf[c]); break;
    case 'EACH_QUORUM': for (let d = 0; d < D; d++) if (rf[d] > 0) mins[d] = q(rf[d]); break;
  }
  const acks = any ? 0 : Math.max(g, sum(mins));
  let ok = true;
  for (let d = 0; d < D; d++) if (mins[d] > rf[d]) ok = false;
  if (g > tot) ok = false;
  // DC, из которых нужен ответ
  const fromDcs = [];
  for (let d = 0; d < D; d++) if (mins[d] > 0) fromDcs.push(d);
  const needsRemote = !any && (fromDcs.some(d => d !== c) || g > (rf[c] || 0));
  return { cl, c, mins, g, any, acks, ok, needsRemote };
}
function satisfied(R, live, anyAlive) {
  if (R.any) return anyAlive;
  if (!R.ok) return false;
  let s = 0;
  for (let d = 0; d < live.length; d++) { if (live[d] < R.mins[d]) return false; s += live[d]; }
  return s >= R.g;
}
// Сколько любых нод можно потерять в худшем случае (противник выбивает реплики одного диапазона).
function worstNodeTolerance(R, T) {
  if (R.any) return T.N - 1;
  if (!R.ok) return -1;
  let f = Infinity;
  for (let d = 0; d < T.rf.length; d++) if (R.mins[d] > 0) f = Math.min(f, T.rf[d] - R.mins[d]);
  if (R.g > 0) f = Math.min(f, T.totRf - R.g);
  if (!isFinite(f)) f = T.N - 1;
  return Math.min(f, T.N - 1);
}
// Гарантированно ли пересекаются множества реплик записи и чтения.
// Множества могут не пересечься, если есть распределение w_d, r_d с w_d + r_d <= rf_d.
function consistent(W, Rd, T) {
  if (!W.ok || !Rd.ok) return null;
  if (W.any) return false;
  let slack = 0;
  for (let d = 0; d < T.rf.length; d++) {
    const s = T.rf[d] - W.mins[d] - Rd.mins[d];
    if (s < 0) return true;
    slack += s;
  }
  const extraW = Math.max(0, W.g - sum(W.mins));
  const extraR = Math.max(0, Rd.g - sum(Rd.mins));
  return extraW + extraR > slack;
}

// ---------- кольцо токенов и размещение реплик ----------
function buildRing(T, numTokens, mode, seed) {
  const rng = mulberry32((seed || 1) * 2654435761 >>> 0);
  const toks = [];
  const D = T.dcs.length;
  T.dcs.forEach((dc, di) => {
    if (!dc.N) return;
    const k = dc.N * numTokens;
    if (mode === 'random') {
      dc.nodes.forEach(id => { for (let t = 0; t < numTokens; t++) toks.push({ pos: rng(), node: id }); });
      return;
    }
    // Сбалансированное приближение: равномерные позиции, в каждом «раунде» ноды идут вперемешку по racks.
    const order = [];
    for (let t = 0; t < numTokens; t++) {
      const lists = shuffle(dc.racks.map(r => shuffle(r.nodes.slice(), rng)), rng);
      const maxLen = Math.max(...lists.map(l => l.length));
      for (let i = 0; i < maxLen; i++) for (const l of lists) if (i < l.length) order.push(l[i]);
    }
    const off = (di + 0.5) / (D + 1);
    for (let s = 0; s < k; s++) toks.push({ pos: (s + off) / k, node: order[s] });
  });
  toks.sort((a, b) => a.pos - b.pos);
  const M = toks.length;
  const tokNode = new Int32Array(M); const size = new Float64Array(M);
  for (let i = 0; i < M; i++) {
    tokNode[i] = toks[i].node;
    const prev = toks[(i - 1 + M) % M].pos;
    let s = toks[i].pos - prev; if (s <= 0) s += 1; if (M === 1) s = 1;
    size[i] = s;
  }
  // Реплики каждого диапазона (prev, tok_i]: обход кольца, как в NTS.
  const nodeDc = T.nodes.map(n => n.dc); const nodeRack = T.nodes.map(n => n.rack);
  const repOff = new Int32Array(M + 1); const reps = [];
  const rackSeen = new Int32Array(T.racks.length + 1).fill(-1);
  const nodeSeen = new Int32Array(T.N).fill(-1);
  const dcRfLeft = new Int32Array(D); const dcRepeats = new Int32Array(D);
  for (let i = 0; i < M; i++) {
    repOff[i] = reps.length;
    let toFill = 0;
    for (let d = 0; d < D; d++) {
      const dc = T.dcs[d];
      if (dc.rf <= 0 || dc.N <= 0) { dcRfLeft[d] = 0; continue; }
      dcRfLeft[d] = Math.min(dc.rf, dc.N); dcRepeats[d] = dc.rf - dc.K; toFill++;
    }
    for (let step = 0, j = i; toFill > 0 && step < M; step++, j = (j + 1) % M) {
      const ep = tokNode[j]; const d = nodeDc[ep];
      if (dcRfLeft[d] <= 0) continue;
      if (nodeSeen[ep] === i) continue;
      const rk = nodeRack[ep];
      if (rackSeen[rk] !== i) {
        rackSeen[rk] = i; nodeSeen[ep] = i; reps.push(ep); dcRfLeft[d]--;
        if (dcRfLeft[d] === 0) toFill--;
        continue;
      }
      if (dcRepeats[d] <= 0) continue;
      nodeSeen[ep] = i; reps.push(ep); dcRepeats[d]--; dcRfLeft[d]--;
      if (dcRfLeft[d] === 0) toFill--;
    }
  }
  repOff[M] = reps.length;
  const rep = Int32Array.from(reps);
  // владение: доля одной копии данных на каждой ноде
  const own = new Float64Array(T.N);
  for (let i = 0; i < M; i++) for (let p = repOff[i]; p < repOff[i + 1]; p++) own[rep[p]] += size[i];
  // индекс нода -> диапазоны
  const cnt = new Int32Array(T.N + 1);
  for (let p = 0; p < rep.length; p++) cnt[rep[p] + 1]++;
  for (let n = 0; n < T.N; n++) cnt[n + 1] += cnt[n];
  const nodeRanges = new Int32Array(rep.length); const fill = cnt.slice(0, T.N);
  for (let i = 0; i < M; i++) for (let p = repOff[i]; p < repOff[i + 1]; p++) nodeRanges[fill[rep[p]]++] = i;
  return { M, size, rep, repOff, own, nodeRangeOff: cnt, nodeRanges, nodeDc, nodeRack, numTokens, mode, tokNode };
}

// Идеальная доля данных на ноду при сбалансированном распределении токенов (water-filling по racks).
function idealShares(dc) {
  const R = Math.min(dc.rf, dc.N); const K = dc.K; const res = {};
  if (R <= 0 || !dc.N) { dc.racks.forEach(r => { res[r.gidx] = 0; }); return res; }
  const lo = r => (K < R ? 1 : 0);
  const hi = r => (K < R ? Math.min(r.n, 1 + R - K) : Math.min(r.n, 1));
  const f = s => sum(dc.racks.map(r => Math.min(hi(r), Math.max(lo(r), r.n * s))));
  let a = 0, b = 1;
  for (let it = 0; it < 80; it++) { const m = (a + b) / 2; if (f(m) < R) a = m; else b = m; }
  dc.racks.forEach(r => { res[r.gidx] = Math.min(hi(r), Math.max(lo(r), r.n * b)) / r.n; });
  return res;
}

// ---------- отказы racks и DC ----------
// maxLoss[d][t] - сколько реплик одного диапазона в DC d можно выбить отказом t racks этого DC (максимум по кольцу).
function rackLossTable(T, ring) {
  const out = T.dcs.map(dc => new Int32Array(dc.K + 1));
  const local = new Int32Array(T.racks.length);
  for (let i = 0; i < ring.M; i++) {
    const per = T.dcs.map(() => []);
    const touched = [];
    for (let p = ring.repOff[i]; p < ring.repOff[i + 1]; p++) {
      const rk = ring.nodeRack[ring.rep[p]];
      if (local[rk] === 0) touched.push(rk);
      local[rk]++;
    }
    for (const rk of touched) { per[T.racks[rk].dc].push(local[rk]); local[rk] = 0; }
    per.forEach((arr, d) => {
      arr.sort((x, y) => y - x);
      let s = 0; const tbl = out[d];
      for (let t = 1; t <= T.dcs[d].K; t++) { if (t <= arr.length) s += arr[t - 1]; if (s > tbl[t]) tbl[t] = s; }
    });
  }
  return out;
}
function rackTolerance(R, T, lossTbl, d) {
  // максимум t: любые t racks в DC d могут отказать без нарушения требования (K - весь DC)
  const dc = T.dcs[d];
  const live = T.rf.slice();
  let best = 0;
  for (let t = 1; t <= dc.K; t++) {
    live[d] = Math.max(0, T.rf[d] - lossTbl[d][t]);
    const anyAlive = t < dc.K || T.N > dc.N;
    if (!satisfied(R, live, anyAlive)) break;
    best = t;
  }
  return best;
}
const LOSS_REQ = { cl: 'DATA', mins: [], g: 1, any: false, ok: true };
function lossReq(T) { return Object.assign({}, LOSS_REQ, { mins: new Array(T.dcs.length).fill(0) }); }

function dcFailure(T, reqs) {
  // reqs(c) -> {w, r, s}
  const rows = [];
  T.dcs.forEach((fdc, f) => {
    const live = T.rf.slice(); live[f] = 0;
    const anyAlive = T.N > fdc.N;
    const cells = T.dcs.map((cdc, c) => {
      if (c === f) return null;
      const q = reqs(c);
      return { w: satisfied(q.w, live, anyAlive), r: satisfied(q.r, live, anyAlive), s: q.s ? satisfied(q.s, live, anyAlive) : null };
    });
    const dataSafe = T.rf.some((x, d) => d !== f && x > 0);
    rows.push({ dc: f, cells, dataSafe });
  });
  return rows;
}

// ---------- оценка конкретного набора отказов ----------
function evalFailures(T, ring, failed, reqW, reqR, reqS) {
  const D = T.dcs.length; const live = new Int32Array(D);
  let anyAlive = false; for (let n = 0; n < T.N; n++) if (!failed[n]) { anyAlive = true; break; }
  const res = { w: 0, r: 0, s: 0, loss: 0, wAny: false, rAny: false, sAny: false, lossAny: false };
  for (let i = 0; i < ring.M; i++) {
    let down = false;
    for (let p = ring.repOff[i]; p < ring.repOff[i + 1]; p++) if (failed[ring.rep[p]]) { down = true; break; }
    if (!down && anyAlive) continue;
    live.fill(0); let tot = 0;
    for (let p = ring.repOff[i]; p < ring.repOff[i + 1]; p++) { const n = ring.rep[p]; if (!failed[n]) { live[ring.nodeDc[n]]++; tot++; } }
    const sz = ring.size[i];
    if (!satisfied(reqW, live, anyAlive)) { res.w += sz; res.wAny = true; }
    if (!satisfied(reqR, live, anyAlive)) { res.r += sz; res.rAny = true; }
    if (reqS && !satisfied(reqS, live, anyAlive)) { res.s += sz; res.sAny = true; }
    if (tot === 0) { res.loss += sz; res.lossAny = true; }
  }
  return res;
}

// ---------- вероятность при случайных отказах k нод ----------
function* combos(n, k) {
  const c = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield c;
    let i = k - 1; while (i >= 0 && c[i] === n - k + i) i--;
    if (i < 0) return;
    c[i]++; for (let j = i + 1; j < k; j++) c[j] = c[j - 1] + 1;
  }
}
function makeProbTask(T, ring, reqW, reqR, reqS, opts) {
  opts = opts || {};
  const N = T.N;
  const kMax = Math.min(N, opts.kMax || 10);
  const budget = opts.budget || 2.5e7;
  const avgRanges = ring.rep.length / Math.max(1, N);
  const avgRep = ring.rep.length / Math.max(1, ring.M);
  const D = T.dcs.length;
  const rng = mulberry32(((opts.seed || 1) * 7919) >>> 0);
  const ks = []; for (let k = 1; k <= kMax; k++) ks.push(k);
  const results = [];
  const visited = new Int32Array(ring.M).fill(-1);
  const failed = new Uint8Array(N);
  const live = new Int32Array(D);
  const pool = Array.from({ length: N }, (_, i) => i);
  let stamp = 0;
  function trial(list) {
    stamp++;
    for (const n of list) failed[n] = 1;
    const anyAlive = list.length < N;
    let w = 0, r = 0, s = 0, l = 0;
    for (const n of list) {
      for (let q = ring.nodeRangeOff[n]; q < ring.nodeRangeOff[n + 1]; q++) {
        const i = ring.nodeRanges[q];
        if (visited[i] === stamp) continue; visited[i] = stamp;
        live.fill(0); let tot = 0;
        for (let p = ring.repOff[i]; p < ring.repOff[i + 1]; p++) { const x = ring.rep[p]; if (!failed[x]) { live[ring.nodeDc[x]]++; tot++; } }
        const sz = ring.size[i];
        if (!satisfied(reqW, live, anyAlive)) w += sz;
        if (!satisfied(reqR, live, anyAlive)) r += sz;
        if (reqS && !satisfied(reqS, live, anyAlive)) s += sz;
        if (tot === 0) l += sz;
      }
    }
    if (reqW.any && !anyAlive) w = 1;
    for (const n of list) failed[n] = 0;
    return [w, r, s, l];
  }
  let ki = 0;
  return {
    kMax,
    done() { return ki >= ks.length; },
    results,
    step(timeBudgetMs) {
      const t0 = Date.now();
      while (ki < ks.length && (Date.now() - t0) < (timeBudgetMs || 1e9)) {
        const k = ks[ki++];
        const total = binom(N, k);
        const perTrial = Math.max(1, k * avgRanges * avgRep);
        const trials = Math.max(200, Math.min(4000, Math.floor(budget / ks.length / perTrial)));
        const exact = total <= trials;
        const acc = { k, exact, trials: 0, pW: 0, pR: 0, pS: 0, pL: 0, fW: 0, fR: 0, fS: 0, fL: 0, pBoth: 0 };
        const add = res => {
          acc.trials++;
          if (res[0] > 1e-12) acc.pW++; if (res[1] > 1e-12) acc.pR++; if (res[2] > 1e-12) acc.pS++; if (res[3] > 1e-12) acc.pL++;
          if (res[0] > 1e-12 || res[1] > 1e-12) acc.pBoth++;
          acc.fW += res[0]; acc.fR += res[1]; acc.fS += res[2]; acc.fL += res[3];
        };
        if (exact) { for (const c of combos(N, k)) add(trial(c)); }
        else {
          for (let t = 0; t < trials; t++) {
            for (let i = 0; i < k; i++) { const j = i + Math.floor(rng() * (N - i)); const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp; }
            add(trial(pool.slice(0, k)));
          }
        }
        ['pW', 'pR', 'pS', 'pL', 'fW', 'fR', 'fS', 'fL', 'pBoth'].forEach(key => { acc[key] /= acc.trials; });
        results.push(acc);
      }
      return ki >= ks.length;
    }
  };
}

// ---------- нагрузка ----------
function readSpread(Rq, T, c) {
  // сколько реплик опрашивается в каждом DC (координатор берёт ближайшие, т.е. сначала локальный DC)
  const D = T.dcs.length; const per = new Array(D).fill(0);
  if (!Rq.ok || Rq.any) return per;
  for (let d = 0; d < D; d++) per[d] = Rq.mins[d];
  let extra = Rq.g - sum(per);
  if (extra > 0) { const addLocal = Math.min(extra, T.rf[c] - per[c]); per[c] += addLocal; extra -= addLocal; }
  for (let d = 0; d < D && extra > 0; d++) { if (d === c) continue; const a = Math.min(extra, T.rf[d] - per[d]); per[d] += a; extra -= a; }
  return per;
}

// ---------- полный расчёт ----------
function compute(st, opts) {
  opts = opts || {};
  const T = buildTopology(st);
  const out = { T, st, errors: T.errors.slice(), warnings: [] };
  if (out.errors.length) return out;
  const D = T.dcs.length;
  const c = Math.min(Math.max(0, st.clientDc | 0), D - 1);
  out.c = c;
  const W = requirement(st.wcl, c, T), R = requirement(st.rcl, c, T);
  const S = st.lwt ? requirement(st.scl, c, T) : null;
  out.W = W; out.R = R; out.S = S;
  out.wTol = worstNodeTolerance(W, T); out.rTol = worstNodeTolerance(R, T);
  out.sTol = S ? worstNodeTolerance(S, T) : null;
  out.appTol = Math.min(out.wTol, out.rTol, S ? out.sTol : Infinity);
  out.consistent = consistent(W, R, T);
  out.ackLossTol = W.any ? 0 : Math.max(0, W.acks - 1);
  out.replLossTol = T.totRf - 1;
  // матрица консистентности: пишет клиент в DC a, читает клиент в DC b
  out.consMatrix = T.dcs.map((_, a) => T.dcs.map((__, b) => consistent(requirement(st.wcl, a, T), requirement(st.rcl, b, T), T)));
  // кольцо
  const nt = TOKEN_CHOICES.includes(+st.numTokens) ? +st.numTokens : 16;
  const ring = buildRing(T, nt, st.tokenMode === 'random' ? 'random' : 'balanced', st.seed || 1);
  out.ring = ring;
  // доли данных
  out.shares = T.dcs.map(dc => {
    const ideal = idealShares(dc);
    const nodes = dc.nodes.map(id => ({ id, ideal: ideal[T.nodes[id].rack], sim: ring.own[id] }));
    const iv = nodes.map(n => n.ideal), sv = nodes.map(n => n.sim);
    return { dc: dc.idx, nodes, idealMin: Math.min(...iv), idealMax: Math.max(...iv), idealAvg: dc.N ? Math.min(dc.rf, dc.N) / dc.N : 0,
      simMin: Math.min(...sv), simMax: Math.max(...sv), rackIdeal: dc.racks.map(r => ({ rack: r.gidx, n: r.n, share: ideal[r.gidx] })) };
  });
  // racks
  const lossTbl = rackLossTable(T, ring);
  out.rackLoss = lossTbl;
  const L = lossReq(T);
  out.rackTol = T.dcs.map((dc, d) => ({
    dc: d, K: dc.K,
    w: rackTolerance(W, T, lossTbl, d), r: rackTolerance(R, T, lossTbl, d),
    s: S ? rackTolerance(S, T, lossTbl, d) : null, loss: rackTolerance(L, T, lossTbl, d),
    maxPerRack: dc.K ? lossTbl[d][1] : 0
  }));
  out.dcFail = D > 1 ? dcFailure(T, cc => ({ w: requirement(st.wcl, cc, T), r: requirement(st.rcl, cc, T), s: S ? requirement(st.scl, cc, T) : null })) : [];
  // операции
  out.readPer = readSpread(R, T, c);
  // нагрузка и данные
  const dataGB = num(st.dataGB), wps = num(st.writesPs), rps = num(st.readsPs), rowB = num(st.rowBytes);
  out.load = { dataGB, wps, rps, rowB };
  out.remoteDcs = T.dcs.filter((d, i) => i !== c && d.rf > 0).length;
  out.perDc = T.dcs.map((dc, d) => {
    const sh = out.shares[d];
    const localRead = out.readPer[d];
    const readFactor = dc.rf > 0 ? localRead / Math.min(dc.rf, dc.N) : 0;
    return {
      dc: d,
      gbAvg: dataGB != null ? dataGB * sh.idealAvg : null,
      gbMax: dataGB != null ? dataGB * sh.idealMax : null,
      gbTotal: dataGB != null ? dataGB * Math.min(dc.rf, dc.N) : null,
      wAvg: wps != null ? wps * sh.idealAvg : null, wMax: wps != null ? wps * sh.idealMax : null,
      rAvg: rps != null ? rps * sh.idealAvg * readFactor : null, rMax: rps != null ? rps * sh.idealMax * readFactor : null,
      readReplicas: localRead
    };
  });
  out.interDcMbps = (wps != null && rowB != null) ? wps * rowB * out.remoteDcs * 8 / 1e6 : null;
  out.warnings = warnings(out);
  return out;
}

// ---------- предупреждения ----------
function warnings(o) {
  const T = o.T, st = o.st, list = [];
  const add = (level, text) => list.push({ level, text });
  const D = T.dcs.length; const c = o.c; const cname = T.dcs[c].name;
  if (!o.W.ok) add('err', 'Запись с ' + st.wcl + ' невозможна даже при всех живых нодах: требуется больше реплик, чем есть' + (o.W.mins[c] > T.rf[c] ? ' в ' + cname : '') + '.');
  if (!o.R.ok) add('err', 'Чтение с ' + st.rcl + ' невозможно даже при всех живых нодах: требуется больше реплик, чем есть' + (o.R.mins[c] > T.rf[c] ? ' в ' + cname : '') + '.');
  if (o.S && !o.S.ok) add('err', 'LWT с ' + st.scl + ' невозможны даже при всех живых нодах.');
  if (T.N === 1) add('info', 'Одна нода (standalone): отказ ноды останавливает и чтение, и запись. Защиту данных дают только бэкапы.');
  T.dcs.forEach((dc, d) => {
    if (dc.rf === 1 && dc.N > 1) add('warn', dc.name + ': RF=1. Отказ любой ноды делает часть данных недоступной, а отказ диска означает потерю этих данных без восстановления из реплик.');
    if (dc.rf > 1 && dc.rf % 2 === 0 && /QUORUM|SERIAL/.test(st.wcl + st.rcl + (st.lwt ? st.scl : ''))) add('info', dc.name + ': RF=' + dc.rf + ' чётный. QUORUM от ' + dc.rf + ' равен ' + (Math.floor(dc.rf / 2) + 1) + ' и переносит столько же отказов, сколько RF=' + (dc.rf - 1) + ', но хранит лишнюю копию.');
    if (dc.rf > 1 && dc.K > 1 && dc.K < dc.rf) add('warn', dc.name + ': racks (' + dc.K + ') меньше RF (' + dc.rf + '). NetworkTopologyStrategy кладёт в один rack до ' + Math.min(1 + dc.rf - dc.K, Math.max(...dc.racks.map(r => r.n))) + ' реплик одного диапазона, поэтому отказ rack выбивает несколько реплик сразу. Число racks лучше сделать равным RF или кратным ему.');
    if (dc.rf > 1 && dc.K === 1 && dc.N > 1) add('info', dc.name + ': один rack. Размещение реплик не учитывает зоны отказа (стойки, питание, коммутаторы); переносится только отказ отдельных нод.');
    const sh = o.shares[d];
    if (dc.rf > 0 && sh.idealMin > 0 && sh.idealMax / sh.idealMin > 1.05) {
      add('warn', dc.name + ': racks разного размера. При RF=' + dc.rf + ' и racks ' + dc.racks.map(r => r.n).join('/') + ' ноды хранят от ' + pct(sh.idealMin) + ' до ' + pct(sh.idealMax) + ' данных, самые загруженные ноды получают в ' + (sh.idealMax / sh.idealMin).toFixed(2).replace('.', ',') + ' раза больше записи, чтения и места на диске. Выравнивайте число нод в racks.');
    }
    if (dc.rf === 0 && D > 1) add('info', dc.name + ': RF=0, ноды DC не хранят данных keyspace «' + st.ks + '». DC не указывается в replication: в 5.0.9 явно указанный DC с RF 0 учитывается в EACH_QUORUM и делает его недоступным.');
  });
  if (T.dcs[c].rf === 0 && /LOCAL/.test(st.wcl + st.rcl + (st.lwt ? st.scl : ''))) add('err', 'Клиент работает в ' + cname + ', где RF=0: LOCAL_* consistency level в этом DC не выполняется.');
  if (D > 1) {
    const remote = [];
    if (o.W.needsRemote) remote.push('запись (' + st.wcl + ')');
    if (o.R.needsRemote) remote.push('чтение (' + st.rcl + ')');
    if (o.S && o.S.needsRemote) remote.push('LWT (' + st.scl + ')');
    if (remote.length) add('warn', remote.join(', ') + ': нужен ответ реплик из другого DC. Задержка операции будет не меньше RTT между DC, а обрыв связи между DC остановит эти операции.');
    if (o.consistent && o.consMatrix.some((row, a) => row.some((v, b) => a !== b && v === false))) add('info', 'Консистентность гарантирована только внутри одного DC: клиент, читающий в другом DC, может получить устаревшие данные, пока репликация не дошла.');
  }
  if (st.wcl === 'ANY') add('warn', 'ANY: запись считается успешной, даже если сохранена только как hint на координаторе. Отказ координатора до доставки hint означает потерю записи, а прочитать такую запись нельзя ни на одном CL.');
  if (o.W.ok && !o.W.any && o.W.acks === 1 && T.totRf > 1) add('warn', 'Запись с ' + st.wcl + ' подтверждается одной репликой. Если эта нода откажет до доставки hints остальным репликам, подтверждённая запись потеряна.');
  if (o.consistent === false && o.W.ok && o.R.ok) add('info', 'Чтение и запись не перекрываются гарантированно (R + W ≤ RF): после записи чтение может вернуть старое значение до завершения репликации, read repair или repair.');
  if (+st.numTokens === 1) add('info', 'num_tokens: 1. Каждой ноде нужен вручную рассчитанный initial_token, добавление нод требует перебалансировки. Зато случайный отказ нескольких нод реже задевает общий диапазон.');
  if (+st.numTokens >= 64) add('warn', 'num_tokens: ' + st.numTokens + '. Чем больше vnodes, тем выше вероятность, что отказ двух-трёх случайных нод затронет общий диапазон, и тем дольше repair. Для 5.0 по умолчанию 16.');
  if (st.lwt) add('info', 'LWT: в cassandra.yaml 5.0 по умолчанию paxos_variant v1, в cassandra_latest.yaml v2. Для нового кластера используйте v2, требования к числу живых реплик это не меняет.');
  if (T.N > 1) add('info', 'Отказ ноды дольше max_hint_window (3h по умолчанию) требует nodetool repair после возвращения. Repair каждой таблицы выполняется чаще, чем gc_grace_seconds.');
  return list;
}
function pct(x) { const v = x * 100; return (v >= 10 ? v.toFixed(0) : v.toFixed(1)).replace('.', ',') + '%'; }

export { CL_LIST, WRITE_CL, READ_CL, SERIAL_CL, TOKEN_CHOICES, LIMITS, defaultState, buildTopology, requirement, satisfied, worstNodeTolerance, consistent, buildRing, idealShares, rackLossTable, rackTolerance, evalFailures, makeProbTask, compute, pct, num, binom, readSpread, dcFailure };
