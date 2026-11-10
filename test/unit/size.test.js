/* Модель размера строки и LZ4: сверка с эталонной сериализацией verification/ (Cassandra 5.0.9). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as SZ from '../../src/core/size.js';

const readJson = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, (msg || '') + ` ${a} vs ${b} (±${tol})`);

test('rowRaw совпадает с эталонной сериализацией (16 случаев, ±0,1 Б)', () => {
  for (const c of readJson('../../verification/results/rawcheck.json')) near(SZ.rowRaw(c, c.variant), c.py, 0.1, c.type + ' ' + c.variant);
});
test('vint: границы 7 бит на байт', () => {
  assert.strictEqual(SZ.vsize(127), 1); assert.strictEqual(SZ.vsize(128), 2); assert.strictEqual(SZ.vsize(16383), 2); assert.strictEqual(SZ.vsize(16384), 3);
  assert.strictEqual(SZ.vsize(Math.pow(2, 35) - 1), 5); assert.strictEqual(SZ.vsize(Math.pow(2, 35)), 6);
});
test('явные null: +5 tombstone-ячеек против unset', () => {
  const o = { type: 'DOUBLE', strBytes: 0, annPct: 0, annBytes: 0, windowDays: 13, ttlSec: 31536000 };
  assert.ok(SZ.rowRaw(o, 'rec') - SZ.rowRaw(o, 'unset') > 15);
});
test('LZ4 меньше несжатого для всех типов, вариантов и периодов', () => {
  for (const type of SZ.TYPE_ORDER) for (const v of ['cur', 'rec', 'unset']) for (const p of [0.1, 0.5, 1, 3, 10, 60, 300, 3600]) {
    const o = { type, period: p, strBytes: 32, annPct: 0.01, annBytes: 64, windowDays: v === 'cur' ? 1 : 13, ttlSec: 31536000 };
    const a = SZ.pointBytes(o, v, 'lz4'), b = SZ.pointBytes(o, v, 'none');
    assert.ok(a.disk > 5 && a.disk < b.disk, type + v + p + ': ' + a.disk + ' ' + b.disk);
  }
});
test('STRING: сжатый размер растёт с длиной строки', () => {
  let prev = 0;
  for (const sb of [4, 8, 16, 32, 64, 128, 256, 512, 1024]) { const d = SZ.pointBytes({ type: 'STRING', period: 10, strBytes: sb, annPct: 0, annBytes: 0, windowDays: 13, ttlSec: 31536000 }, 'rec', 'lz4').disk; assert.ok(d >= prev - 0.3, sb + ': ' + d + ' < ' + prev); prev = d; }
});
test('Сетка сжатия совпадает с замерами на опорных точках', () => {
  const base = readJson('../../verification/results/grid_base.json');
  for (const r of base) {
    if (r.period_s > 60) continue;
    const got = SZ.lz4Point(r.typ, r.variant, r.period_s, 32);
    near(got, r.lz4, 0.01, r.typ + ' ' + r.variant + ' ' + r.period_s);
  }
});
