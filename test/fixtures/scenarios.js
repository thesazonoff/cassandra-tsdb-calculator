/* Сценарии регрессии и проекция результата расчёта в сравнимый JSON.
 * Эталон golden-2.1.0.json.gz снят этими же сценариями на коде выпуска 2.1.0 (до перехода на модули):
 * любое расхождение означает, что рефакторинг изменил цифры или тексты, которые видит пользователь.
 * E: модуль sizing.js с полем configs из sizing-config.js; FT: модуль fault.js с полем configs из fault-config.js. */

const CALC = {
  default: {},
  tz: { preset: 'tz' }, shop: { preset: 'shop' }, plant: { preset: 'plant' }, holding: { preset: 'holding' },
  standalone: { mode: 'standalone' },
  f2: { F: 2 },
  eventual: { cons: 'eventual' },
  dc3: { dc: 3 },
  dc2f2: { dc: 2, F: 2 },
  manual: { manual: true, rfs: [3, 2, 3, 3, 3], dc: 2, wcl: 'EACH_QUORUM', rcl: 'LOCAL_ONE', lwt: true, scl: 'SERIAL' },
  oneRack: { rackPolicy: 'one', numTokens: 1 },
  topo332: { topo: [{ racks: [3, 3, 2] }] },
  own: { hw: 'own', ownCores: 8, ownRam: 32, ownDrives: 1, ownDrive: 1.92 },
  noComp: { comp: 'none' },
  hdd: { disk: 'hdd', raid: 'raid6' },
  truncate: { cleanup: 'truncate', backups: 'off', snapPer: false },
  heavy: { usage: 'heavy', users: 200 },
  custom: { usage: 'custom', trOpen: 20, trTags: 40, repH: 5 },
  calib: { calib: { on: true, spaceGiB: 900, nodes: 3, rf: 3, days: 200, pps: '', ratio: 0.5 } },
  junk: { retention: 'abc', growth: -5, years: 99, strLen: 'x', groups: [{ type: 'DOUBLE', count: 0, period: 1 }] }
};

const FAULT = {
  default: {},
  standalone: { dcs: [{ name: 'DC1', rf: 1, racks: [1] }], wcl: 'ONE', rcl: 'ONE' },
  rf3x9: { dcs: [{ name: 'DC1', rf: 3, racks: [3, 3, 3] }] },
  rf5: { dcs: [{ name: 'DC1', rf: 5, racks: [3, 3, 3, 3, 3] }] },
  dc2: { dcs: [{ name: 'DC1', rf: 3, racks: [1, 1, 1] }, { name: 'DC2', rf: 3, racks: [1, 1, 1] }], clientDc: 1 },
  dc3each: { dcs: [{ name: 'DC1', rf: 3, racks: [1, 1, 1] }, { name: 'DC2', rf: 3, racks: [1, 1, 1] }, { name: 'DC3', rf: 2, racks: [2] }], wcl: 'EACH_QUORUM', rcl: 'QUORUM', lwt: true, scl: 'SERIAL' },
  uneven: { dcs: [{ name: 'DC1', rf: 3, racks: [3, 3, 2] }] },
  fewRacks: { dcs: [{ name: 'DC1', rf: 3, racks: [2, 2] }], numTokens: 4, tokenMode: 'random', seed: 7 },
  any: { wcl: 'ANY', rcl: 'ONE', dataGB: '2000', writesPs: '50000', readsPs: '2000', rowBytes: '120' },
  rf0: { dcs: [{ name: 'DC1', rf: 3, racks: [1, 1, 1] }, { name: 'AN', rf: 0, racks: [2] }], wcl: 'LOCAL_QUORUM', rcl: 'ALL', dataGB: '500' },
  tok1: { numTokens: 1 },
  tok64: { numTokens: 64, dcs: [{ name: 'DC1', rf: 3, racks: [4, 4, 4] }] },
  err: { dcs: [{ name: 'DC1', rf: 5, racks: [1, 1] }] }
};

const round = x => (typeof x === 'number' && Number.isFinite(x) ? +x.toPrecision(12) : x);
function deep(x) {
  if (x == null) return x;
  if (ArrayBuffer.isView(x)) return Array.from(/** @type {ArrayLike<number>} */ (/** @type {unknown} */ (x)), round);
  if (Array.isArray(x)) return x.map(deep);
  if (typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) if (typeof x[k] !== 'function') o[k] = deep(x[k]); return o; }
  if (typeof x === 'number') return Number.isFinite(x) ? round(x) : String(x);
  return x;
}

function calcState(E, s) {
  const st = Object.assign(E.defaultState(), JSON.parse(JSON.stringify(s)));
  if (s.preset) { st.groups = JSON.parse(JSON.stringify(E.PRESETS[s.preset].groups)); delete st.preset; }
  if (s.calib) st.calib = Object.assign(E.defaultState().calib, s.calib);
  return st;
}

function projectCalc(E, FT, s) {
  const R = E.compute(calcState(E, s));
  if (R.empty) return { empty: true };
  const out = { tags: R.tags, P: R.P, ret: R.ret, Y: R.Y, Gf: R.Gf, F: R.F, standalone: !!R.standalone, consistent: R.consistent, tol: R.tol,
    rep: { dcs: R.rep.dcs, wcl: R.rep.wcl, rcl: R.rep.rcl, lwt: R.rep.lwt, scl: R.rep.scl },
    calib: R.calib, checks: R.checks.map(c => [c.sev, c.scope, c.title, c.text, c.fix || '']), variants: {} };
  for (const k of ['cur', 'rec', 'unset']) {
    const v = R.variants[k];
    const ft = FT.compute(E.ftState(R, v.topo));
    out.variants[k] = {
      Ntotal: v.Ntotal, L: v.L, B: v.B, snapT: v.snapT, compDay: v.compDay, lz4: v.lz4, none: v.none, chosen: v.chosen.p.id,
      dcs: v.dcs, topo: v.topo, node: v.node,
      cands: (v.cands || []).map(c => [c.p.id, c.Ntot, c.limits]),
      configs: E.configs(R, v).map(f => [f.id, f.file, f.title, !!f.main, f.text]),
      ft: { errors: ft.errors, appTol: ft.appTol, wTol: ft.wTol, rTol: ft.rTol, rackTol: ft.rackTol, dcFail: ft.dcFail, warnings: ft.warnings }
    };
  }
  return deep(out);
}

function projectFault(FT, s) {
  const st = Object.assign(FT.defaultState(), JSON.parse(JSON.stringify(s)));
  const o = FT.compute(st);
  if (o.errors.length) return deep({ errors: o.errors });
  const task = FT.makeProbTask(o.T, o.ring, o.W, o.R, o.S, { kMax: Math.min(o.T.N, 10), seed: st.seed });
  while (!task.step(1e9));
  const ev = FT.evalFailures(o.T, o.ring, Uint8Array.from(o.T.nodes.map((n, i) => (i % 3 === 0 ? 1 : 0))), o.W, o.R, o.S);
  return deep({
    c: o.c, W: o.W, R: o.R, S: o.S, wTol: o.wTol, rTol: o.rTol, sTol: o.sTol, appTol: o.appTol, consistent: o.consistent,
    ackLossTol: o.ackLossTol, replLossTol: o.replLossTol, consMatrix: o.consMatrix, shares: o.shares, rackTol: o.rackTol,
    dcFail: o.dcFail, readPer: o.readPer, perDc: o.perDc, interDcMbps: o.interDcMbps, warnings: o.warnings,
    ring: { M: o.ring.M, own: o.ring.own }, prob: task.results, ev, configs: FT.configs(o)
  });
}

export { CALC, FAULT, calcState, projectCalc, projectFault, deep };
