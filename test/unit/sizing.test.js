/* Модель сайзинга и генерация конфигурации. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/core/sizing.js';
import { configs } from '../../src/core/sizing-config.js';
import * as SZ from '../../src/core/size.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` ${a} vs ${b} (±${tol})`);

const base = E.defaultState();
const C = s => E.compute(Object.assign(E.defaultState(), s));
test('По умолчанию: кластер RF 3, ноды кратны стойкам, данных на ноду не больше предела', () => {
  const R = C({});
  for (const k of ['cur', 'rec', 'unset']) {
    const v = R.variants[k];
    assert.ok(v.N >= 3 && v.N % 3 === 0, k + ' N=' + v.N);
    assert.ok(v.node.live <= base.maxNodeTB * 1e12 * 1.0001, k + ' live ' + v.node.live);
    assert.ok(v.node.reqData >= v.node.live / 0.8, k);
    assert.ok(v.node.ram.fits, k);
  }
});
test('Рекомендации меньше текущей схемы, драйвер меньше рекомендаций', () => {
  const R = C({});
  assert.ok(R.variants.rec.L < R.variants.cur.L && R.variants.unset.L < R.variants.rec.L);
});
test('Без сжатия больше, чем LZ4, в 1,4–2,5 раза', () => {
  const a = C({ comp: 'lz4' }).variants.rec, b = C({ comp: 'none' }).variants.rec;
  const r = b.L / a.L; assert.ok(r > 1.4 && r < 2.5, 'отношение ' + r);
});
test('Объём линеен по числу тегов и сроку хранения (TTL)', () => {
  const a = C({ growth: 0 }).variants.rec, b = C({ growth: 0, groups: base.groups.map(g => Object.assign({}, g, { count: g.count * 2 })) }).variants.rec;
  near(b.L / a.L, 2, 0.01);
  const c = C({ growth: 0, retention: 730 }).variants.rec;
  assert.ok(c.L / a.L > 1.9 && c.L / a.L < 2.05);
});
test('Ручной расчёт: 1000 DOUBLE × 1 с, 30 сут, RF 1, рост 0', () => {
  const R = C({ mode: 'standalone', raid: 'raid10', groups: [{ type: 'DOUBLE', count: 1000, period: 1 }], retention: 30, growth: 0, years: 0, annPct: 0, snapPer: false });
  const v = R.variants.rec;
  const bpp = SZ.pointBytes({ type: 'DOUBLE', period: 1, strBytes: 0, annPct: 0, annBytes: 0, windowDays: 1, ttlSec: 30 * 86400 }, 'rec', 'lz4').disk;
  const day = 1000 * 86400 * bpp * 1.002 + 1000 * (35 + 40) / 1;
  near(v.compDay, day, day * 1e-9);
  near(v.L, day * (30 + 1 + 3600 / 86400), 1);
});
test('Одна нода: N = 1, RF 1, CL ONE', () => {
  const R = C({ mode: 'standalone', raid: 'raid10' });
  assert.strictEqual(R.variants.rec.Ntotal, 1); assert.strictEqual(R.rep.dcs[0].rf, 1); assert.strictEqual(R.rep.wcl, 'ONE');
});
test('Два отказа при строгой согласованности: RF 5', () => {
  const R = C({ F: 2 }); assert.strictEqual(R.rep.dcs[0].rf, 5); assert.ok(R.tol.w >= 2 && R.tol.r >= 2); assert.ok(R.variants.rec.N >= 5);
});
test('Неверная комбинация RF 2 + QUORUM при отказе 1 ноды: критичная проверка', () => {
  const R = C({ manual: true, rfs: [2], wcl: 'QUORUM', rcl: 'QUORUM', F: 1 });
  assert.ok(R.checks.some(c => c.sev === 'crit' && /Запись остановится/.test(c.title)));
});
test('Три ДЦ: ноды в каждом, CL локальный', () => {
  const R = C({ dc: 3 }); const v = R.variants.rec;
  assert.strictEqual(v.dcs.length, 3); assert.strictEqual(v.Ntotal, v.dcs.reduce((a, d) => a + d.N, 0));
  assert.ok(!R.req.W.needsRemote && !R.req.R.needsRemote);
});
test('Ручная топология со стойками 3/3/2: нагрузка по самой загруженной ноде', () => {
  const R0 = C({}); const R = C({ topo: [{ racks: [3, 3, 2] }] });
  assert.strictEqual(R.variants.rec.N, 8);
  near(R.variants.rec.node.share, 0.5, 1e-6);
  assert.ok(R.variants.rec.node.live > R0.variants.rec.node.live);
});
test('Своё оборудование: мало дисков, число нод растёт', () => {
  const a = C({ hw: 'own', ownCores: 16, ownRam: 64, ownDrives: 2, ownDrive: 3.84 }).variants.rec;
  const b = C({ hw: 'own', ownCores: 16, ownRam: 64, ownDrives: 1, ownDrive: 0.96 }).variants.rec;
  assert.ok(b.N > a.N); assert.ok(b.node.data.ownFits);
});
test('Калибровка: факт = модель даёт k = 1; факт вдвое больше удваивает объём', () => {
  const R0 = C({ growth: 0 });
  const model = R0.calib; assert.strictEqual(model.valid, false);
  const P = R0.P, bppCur = (() => { const r = C({ growth: 0, calib: { spaceGiB: 1, nodes: 3, rf: 3, days: 1, pps: P } }); return r.calib.model; })();
  const space = bppCur * P * 86400 * 10 / 1073741824; // 10 суток, RF 3, 3 ноды
  const R1 = C({ growth: 0, calib: { on: true, spaceGiB: space, nodes: 3, rf: 3, days: 10, pps: P } });
  near(R1.calib.k, 1, 1e-9);
  const R2 = C({ growth: 0, calib: { on: true, spaceGiB: space * 2, nodes: 3, rf: 3, days: 10, pps: P } });
  near(R2.calib.k, 2, 1e-9);
  near(R2.variants.rec.lz4.data / R0.variants.rec.lz4.data, 2, 1e-9);
});
test('Разбор вывода nodetool tablestats', () => {
  const txt = `Table: data_points\n\tSSTable count: 31\n\tSpace used (live): 412.36 GiB\n\tSpace used (total): 415.1 GiB\n\tSSTable Compression Ratio: 0.5812\n\tNumber of partitions (estimate): 2104\n`;
  const p = E.parseTablestats(txt); near(p.spaceGiB, 412.36, 1e-9); near(p.ratio, 0.5812, 1e-9); assert.strictEqual(p.partitions, 2104);
  const p2 = E.parseTablestats('Space used (live): 442770210816'); near(p2.spaceGiB, 412.36, 0.01);
});
test('Конфигурация: TTL, окно TWCS, LZ4, C# Unset.Value в варианте драйвера', () => {
  const R = C({});
  const cql = configs(R, R.variants.rec).find(f => f.id === 'cql').text;
  assert.ok(/default_time_to_live = 31536000/.test(cql) && /compaction_window_size': '13'/.test(cql) && /LZ4Compressor/.test(cql));
  const cs = configs(R, R.variants.unset).find(f => f.id === 'cs').text;
  assert.ok(/Unset\.Value/.test(cs) && /DCAwareRoundRobinPolicy\("DC1"\)/.test(cs) && /LocalQuorum/.test(cs));
  const y = configs(R, R.variants.rec).find(f => f.id === 'yaml').text;
  assert.ok(/allocate_tokens_for_local_replication_factor: 3/.test(y) && !/_in_kb|_in_ms/.test(y));
  const rack = configs(R, R.variants.rec).find(f => f.id === 'rack').text;
  assert.strictEqual((rack.match(/^dc=/gm) || []).length, R.variants.rec.Ntotal);
});
test('Без сжатия: compression enabled false в ALTER TABLE', () => {
  const R = C({ comp: 'none' }); assert.ok(/'enabled': 'false'/.test(configs(R, R.variants.rec).find(f => f.id === 'cql').text));
});
test('Устойчивость к мусору во вводе', () => {
  const R = C({ groups: [{ type: 'DOUBLE', count: 'abc', period: 0 }, { type: 'XXX', count: 5, period: 1 }] }); assert.ok(R.empty);
  const R2 = C({ retention: -5, growth: 'x', years: 99, dc: 9, F: 7, users: -1 }); assert.ok(!R2.empty && Number.isFinite(R2.variants.rec.L));
});
test('Крупный объект: 200 000 тегов × 1 с считается быстрее 2 с', () => {
  const t0 = Date.now(); const R = C({ groups: [{ type: 'DOUBLE', count: 200000, period: 1 }] }); assert.ok(R.variants.rec.N > 20); assert.ok(Date.now() - t0 < 2000);
});
