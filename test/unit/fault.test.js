/* Движок отказоустойчивости: ConsistencyLevel.blockFor и NetworkTopologyStrategy 5.0.9 независимой реализацией. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as FT from '../../src/core/fault.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` ${a} vs ${b} (±${tol})`);

function blockFor(cl, rf, c) { // независимая реализация по исходному коду
  const all = rf.reduce((a, b) => a + b, 0), q = x => Math.floor(x / 2) + 1;
  switch (cl) {
    case 'ONE': case 'LOCAL_ONE': return 1; case 'TWO': return 2; case 'THREE': return 3;
    case 'QUORUM': case 'SERIAL': return q(all); case 'ALL': return all;
    case 'LOCAL_QUORUM': case 'LOCAL_SERIAL': return q(rf[c]);
    case 'EACH_QUORUM': return rf.filter(x => x > 0).reduce((a, x) => a + q(x), 0);
  }
}
test('Число подтверждений совпадает для 1–3 ДЦ, RF 1–5, всех CL', () => {
  let n = 0;
  for (const rf of [[1], [2], [3], [5], [3, 3], [3, 2], [5, 3], [3, 3, 3], [2, 0, 3]]) {
    const T = FT.buildTopology({ dcs: rf.map((r, i) => ({ name: 'DC' + (i + 1), rf: r, racks: [Math.max(1, r)] })) });
    for (const cl of ['ONE', 'TWO', 'THREE', 'QUORUM', 'ALL', 'LOCAL_ONE', 'LOCAL_QUORUM', 'EACH_QUORUM', 'SERIAL', 'LOCAL_SERIAL']) {
      const c = rf[0] > 0 ? 0 : rf.findIndex(x => x > 0);
      const req = FT.requirement(cl, c, T);
      if (!req.ok) continue;
      assert.strictEqual(req.acks, blockFor(cl, rf, c), cl + ' ' + rf); n++;
    }
  }
  assert.ok(n > 60);
});
test('Отказоустойчивость: RF 3 + LOCAL_QUORUM = 1 нода, RF 5 = 2, RF 3 + ALL = 0', () => {
  const T = r => FT.buildTopology({ dcs: [{ name: 'DC1', rf: r, racks: [r] }] });
  assert.strictEqual(FT.worstNodeTolerance(FT.requirement('LOCAL_QUORUM', 0, T(3)), T(3)), 1);
  assert.strictEqual(FT.worstNodeTolerance(FT.requirement('LOCAL_QUORUM', 0, T(5)), T(5)), 2);
  assert.strictEqual(FT.worstNodeTolerance(FT.requirement('ALL', 0, T(3)), T(3)), 0);
  assert.strictEqual(FT.worstNodeTolerance(FT.requirement('QUORUM', 0, T(2)), T(2)), 0);
});
test('Согласованность: R + W > RF', () => {
  const T = FT.buildTopology({ dcs: [{ name: 'DC1', rf: 3, racks: [3] }] });
  assert.strictEqual(FT.consistent(FT.requirement('LOCAL_QUORUM', 0, T), FT.requirement('LOCAL_QUORUM', 0, T), T), true);
  assert.strictEqual(FT.consistent(FT.requirement('ONE', 0, T), FT.requirement('ONE', 0, T), T), false);
  assert.strictEqual(FT.consistent(FT.requirement('ALL', 0, T), FT.requirement('ONE', 0, T), T), true);
});

console.log('3. Размещение реплик (NetworkTopologyStrategy 5.0.9)');
function ntsReference(T, ring) { // буквальный перенос calculateNaturalReplicas + DatacenterEndpoints
  const out = [];
  for (let i = 0; i < ring.M; i++) {
    const dcs = T.dcs.map(dc => ({ rfLeft: Math.min(dc.rf, dc.N), repeats: dc.rf - dc.K, racks: new Set(), reps: [] }));
    let toFill = dcs.filter((d, k) => T.dcs[k].rf > 0 && T.dcs[k].N > 0 && d.rfLeft > 0).length;
    for (let s = 0, j = i; toFill > 0 && s < ring.M; s++, j = (j + 1) % ring.M) {
      // ring.tokNode не экспортирован: восстанавливаем владельца токена по первой реплике диапазона j
      const ep = ring.owner[j]; const nd = T.nodes[ep]; const d = dcs[nd.dc];
      if (T.dcs[nd.dc].rf <= 0 || d.rfLeft === 0) continue;
      if (d.reps.includes(ep)) continue;
      if (!d.racks.has(nd.rack)) { d.racks.add(nd.rack); d.reps.push(ep); d.rfLeft--; if (!d.rfLeft) toFill--; continue; }
      if (d.repeats <= 0) continue;
      d.reps.push(ep); d.repeats--; d.rfLeft--; if (!d.rfLeft) toFill--;
    }
    out.push(dcs.flatMap(d => d.reps).sort((a, b) => a - b).join(','));
  }
  return out;
}
test('Наборы реплик каждого диапазона совпадают на 60 случайных топологиях', () => {
  let ranges = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = (k => () => (k = (k * 1103515245 + 12345) % 2147483648) / 2147483648)(seed);
    const D = 1 + Math.floor(rnd() * 3);
    const dcs = Array.from({ length: D }, (_, i) => { const K = 1 + Math.floor(rnd() * 4); return { name: 'DC' + (i + 1), rf: 1 + Math.floor(rnd() * 4), racks: Array.from({ length: K }, () => 1 + Math.floor(rnd() * 4)) }; });
    const T = FT.buildTopology({ dcs });
    if (T.errors.length) continue;
    const ring = FT.buildRing(T, [1, 4, 16][seed % 3], seed % 2 ? 'random' : 'balanced', seed);
    ring.owner = Array.from(ring.tokNode);
    const ref = ntsReference(T, ring);
    for (let i = 0; i < ring.M; i++) {
      const got = Array.from(ring.rep.slice(ring.repOff[i], ring.repOff[i + 1])).sort((a, b) => a - b).join(',');
      assert.strictEqual(got, ref[i], 'seed ' + seed + ' range ' + i); ranges++;
    }
  }
  assert.ok(ranges > 500, 'проверено диапазонов: ' + ranges);
});
test('Доли данных: сумма по ДЦ равна RF; стойки 3/3/2 при RF 3 дают 1/3 и 1/2', () => {
  const T = FT.buildTopology({ dcs: [{ name: 'DC1', rf: 3, racks: [3, 3, 2] }] });
  const sh = FT.idealShares(T.dcs[0]);
  near(sh[0], 1 / 3, 1e-6); near(sh[2], 1 / 2, 1e-6);
  const sum = T.dcs[0].racks.reduce((a, r) => a + r.n * sh[r.gidx], 0); near(sum, 3, 1e-6);
});
