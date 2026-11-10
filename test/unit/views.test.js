/* Представления обеих страниц строятся без ошибок на всех сценариях регрессии, включая крайние. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/core/sizing.js';
import * as FT from '../../src/core/fault.js';
import { configs as faultConfigs } from '../../src/core/fault-config.js';
import { CALC, FAULT, calcState } from '../fixtures/scenarios.js';
import { paneSum } from '../../src/pages/calc/views/summary.js';
import { paneDisk } from '../../src/pages/calc/views/disk.js';
import { paneFt, schemeStatusHtml, probParts } from '../../src/pages/calc/views/fault.js';
import { paneCfg } from '../../src/pages/calc/views/config.js';
import { paneCal } from '../../src/pages/calc/views/calibration.js';
import { paneMet } from '../../src/pages/calc/views/method.js';
import { summary, cmpHtml } from '../../src/pages/calc/views/compare.js';
import { printHtml } from '../../src/pages/calc/views/print.js';
import { configZip, sizingXlsx } from '../../src/pages/calc/exports.js';
import { summaryHtml } from '../../src/pages/fault/views/summary.js';
import { failHtml, probParts as faultProb } from '../../src/pages/fault/views/failures.js';
import { schemeHtml } from '../../src/pages/fault/views/scheme.js';
import { dataHtml } from '../../src/pages/fault/views/data.js';
import { cfgHtml } from '../../src/pages/fault/views/config.js';

const wellFormed = html => assert.ok(!/undefined|NaN|\[object Object\]/.test(html.replace(/<[^>]+>/g, '')), html.slice(0, 200));

for (const [name, s] of Object.entries(CALC)) {
  test(`системные требования, ${name}: вкладки, печать, выгрузки`, () => {
    const S = calcState(E, s), R = E.compute(S);
    if (R.empty) return;
    for (const VAR of ['cur', 'rec', 'unset']) {
      const ft = FT.compute(E.ftState(R, R.variants[VAR].topo));
      const failed = new Uint8Array(ft.errors.length ? 0 : ft.T.N).fill(1);
      const ctx = { R, S, VAR, ft, failed, code: [] };
      for (const html of [paneSum(ctx), paneDisk(ctx), paneCfg(ctx), paneCal(ctx), paneMet(ctx), printHtml(ctx), cmpHtml([{ name: 'x', s: S, sum: summary(ctx) }])]) wellFormed(html);
      if (!ft.errors.length) {
        wellFormed(paneFt(ctx)); wellFormed(schemeStatusHtml(ft, failed));
        const task = FT.makeProbTask(ft.T, ft.ring, ft.W, ft.R, ft.S, { kMax: Math.min(ft.T.N, 3) });
        while (!task.step(1e9));
        const p = probParts(task, ft); wellFormed(p.chart + p.table);
      }
      assert.ok(configZip(R, VAR).data.length > 1000);
      assert.ok(sizingXlsx(R, S, VAR).length > 1000);
    }
  });
}

for (const [name, s] of Object.entries(FAULT)) {
  test(`отказоустойчивость, ${name}: вкладки`, () => {
    const o = FT.compute(Object.assign(FT.defaultState(), s));
    if (o.errors.length) return;
    const failed = new Uint8Array(o.T.N); failed[0] = 1;
    for (const html of [summaryHtml(o), failHtml(o), schemeHtml(o, failed, 2), dataHtml(o), cfgHtml(faultConfigs(o))]) wellFormed(html);
    const task = FT.makeProbTask(o.T, o.ring, o.W, o.R, o.S, { kMax: Math.min(o.T.N, 3) });
    while (!task.step(1e9));
    const p = faultProb(task, o); wellFormed(p.chart + p.table + p.legend);
  });
}
