/* Регрессия: результаты обеих страниц совпадают с выпуском 2.1.0 на 34 сценариях. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import * as sizing from '../../src/core/sizing.js';
import { configs as sizingConfigs } from '../../src/core/sizing-config.js';
import * as fault from '../../src/core/fault.js';
import { configs as faultConfigs } from '../../src/core/fault-config.js';
import { CALC, FAULT, projectCalc, projectFault } from '../fixtures/scenarios.js';

const golden = JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/golden-2.1.0.json.gz', import.meta.url))).toString('utf8'));
const E = { ...sizing, configs: sizingConfigs };
const FT = { ...fault, configs: faultConfigs };
const norm = x => JSON.parse(JSON.stringify(x));

for (const [name, s] of Object.entries(CALC)) {
  test(`системные требования: сценарий ${name} совпадает с 2.1.0`, () => {
    assert.deepEqual(norm(projectCalc(E, FT, s)), golden.calc[name]);
  });
}
for (const [name, s] of Object.entries(FAULT)) {
  test(`отказоустойчивость: сценарий ${name} совпадает с 2.1.0`, () => {
    assert.deepEqual(norm(projectFault(FT, s)), golden.fault[name]);
  });
}
