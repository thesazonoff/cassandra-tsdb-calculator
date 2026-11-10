/* Пересоздаёт эталон регрессии текущим кодом, когда расчёт меняется намеренно.
 *   node scripts/update-golden.mjs <версия>   → test/fixtures/golden-<версия>.json.gz
 * После этого заменить имя файла в test/unit/regression.test.js и описать изменение цифр в CHANGELOG. */
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import * as sizing from '../src/core/sizing.js';
import { configs as sizingConfigs } from '../src/core/sizing-config.js';
import * as fault from '../src/core/fault.js';
import { configs as faultConfigs } from '../src/core/fault-config.js';
import { CALC, FAULT, projectCalc, projectFault } from '../test/fixtures/scenarios.js';

const version = process.argv[2];
if (!version) { console.error('Укажите версию: node scripts/update-golden.mjs 2.3.0'); process.exit(2); }
const E = { ...sizing, configs: sizingConfigs }, FT = { ...fault, configs: faultConfigs };
const out = { calc: {}, fault: {} };
for (const [k, s] of Object.entries(CALC)) out.calc[k] = projectCalc(E, FT, s);
for (const [k, s] of Object.entries(FAULT)) out.fault[k] = projectFault(FT, s);
const file = new URL(`../test/fixtures/golden-${version}.json.gz`, import.meta.url);
writeFileSync(file, gzipSync(JSON.stringify(out), { level: 9 }));
console.log(file.pathname);
