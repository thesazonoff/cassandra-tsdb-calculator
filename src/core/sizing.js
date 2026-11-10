/* Модель сайзинга кластера Cassandra для TSDB MES: поток точек, объём на диске, ноды, диски, CPU, RAM, проверки.
 * Размер строки и LZ4 берутся из size.js, реплики, racks и consistency level из fault.js.
 * Чистые функции без DOM: работают в браузере и в Node. */
import * as SZ from './size.js';
import * as FT from './fault.js';
import { CASSANDRA_VERSION } from './meta.js';

const TYPE_ORDER = SZ.TYPE_ORDER;
const TYPE_COL = { DOUBLE: 'double_value', FLOAT: 'float_value', LONG: 'long_value', DATETIME: 'long_value', SET: 'long_value', STRING: 'string_value' };

const PROFILES = [
  { id: 'p8', c: 8, ram: 32 }, { id: 'p16', c: 16, ram: 64 }, { id: 'p32', c: 32, ram: 128 }, { id: 'p64', c: 64, ram: 256 }
];
const DRIVES = { nvme: [0.96, 1.92, 3.84, 7.68, 15.36], ssd: [0.48, 0.96, 1.92, 3.84, 7.68], hdd: [1, 2, 4, 8, 12, 16] };
const DISK = {
  nvme: { label: 'NVMe', iops: 300000, lat: 0.15, mbs: 2000 },
  ssd: { label: 'SATA SSD', iops: 50000, lat: 0.4, mbs: 450 },
  hdd: { label: 'HDD', iops: 150, lat: 9, mbs: 180 }
};
const RAIDS = {
  none: { label: 'Без RAID', eff: n => n }, raid0: { label: 'RAID 0', eff: n => n }, jbod: { label: 'JBOD', eff: n => n },
  raid1: { label: 'RAID 1', eff: n => n / 2 }, raid10: { label: 'RAID 10', eff: n => n / 2 },
  raid5: { label: 'RAID 5', eff: n => n - 1 }, raid6: { label: 'RAID 6', eff: n => n - 2 }
};
// Профиль работы одного пользователя MES
const USAGE = {
  light:   { label: 'Редкие обращения', trOpen: 2, trTags: 8, trWin: 8, trRef: 10, mnTags: 30, mnRef: 5, repH: 0.25, repTags: 20, repDays: 1 },
  typical: { label: 'Типовой', trOpen: 6, trTags: 10, trWin: 8, trRef: 5, mnTags: 50, mnRef: 2, repH: 1, repTags: 50, repDays: 1 },
  heavy:   { label: 'Активная аналитика', trOpen: 12, trTags: 20, trWin: 24, trRef: 2, mnTags: 100, mnRef: 1, repH: 3, repTags: 100, repDays: 7 }
};
// Параметры модели: оценки, уточняются нагрузочным тестом
const M = {
  wpc: 4000, qpc: 1500, rpc: 150000, util: 0.6, page: 5000,
  keyLen: 20, sstAux: 40, auxPct: 0.002, hintWindowSec: 10800, fsReserve: 0.05, maxFill: 0.80, mutOverhead: 60
};
const G = (type, count, period) => ({ type, count, period });
const PRESETS = {
  tz:      { label: '5000 × 1 с + 2000 × 10 с', groups: [G('DOUBLE', 5000, 1), G('DOUBLE', 2000, 10)] },
  shop:    { label: 'Цех, ~3 000 тегов', groups: [G('DOUBLE', 800, 1), G('DOUBLE', 1200, 10), G('FLOAT', 300, 5), G('LONG', 200, 10), G('DATETIME', 50, 60), G('SET', 400, 5), G('STRING', 50, 60)] },
  plant:   { label: 'Завод, ~25 000 тегов', groups: [G('DOUBLE', 4000, 1), G('DOUBLE', 9000, 10), G('FLOAT', 3000, 5), G('LONG', 2500, 5), G('DATETIME', 500, 60), G('SET', 5000, 2), G('STRING', 600, 60)] },
  holding: { label: 'Площадка холдинга, ~120 000 тегов', groups: [G('DOUBLE', 20000, 1), G('DOUBLE', 60000, 10), G('FLOAT', 10000, 5), G('LONG', 10000, 10), G('DATETIME', 2000, 60), G('SET', 15000, 5), G('STRING', 3000, 60)] }
};

function defaultState() {
  return {
    v: 2, mode: 'cluster', hw: 'recommend',
    groups: [G('DOUBLE', 5000, 1), G('DOUBLE', 2000, 10), G('FLOAT', 1000, 5), G('LONG', 1000, 5), G('DATETIME', 200, 60), G('SET', 2000, 2), G('STRING', 300, 60)],
    strLen: 32, strEnc: 'mix', annPct: 1, annLen: 64, annEnc: 'cyr',
    retention: 365, growth: 10, years: 3, comp: 'lz4',
    cleanup: 'delete', cleanInt: 7, backups: 'on_nocleanup', backInt: 7,
    dc: 1, F: 1, cons: 'strong',
    manual: false, rfs: [3, 3, 3, 3, 3], wcl: 'LOCAL_QUORUM', rcl: 'LOCAL_QUORUM', lwt: false, scl: 'LOCAL_SERIAL',
    rackPolicy: 'rf', numTokens: 16, tokenMode: 'balanced', seed: 1, topo: null,
    users: 30, usage: 'typical',
    trOpen: 6, trTags: 10, trWin: 8, trRef: 5, mnTags: 50, mnRef: 2, repH: 1, repTags: 50, repDays: 1,
    rpo: 10, rto: 4, slaW: 20, slaR: 100,
    disk: 'nvme', raid: 'raid0', drive: 'auto', maxNodeTB: 4, netIn: 10, rttIn: 0.3, netDc: 1, rttDc: 20,
    ownCores: 16, ownRam: 64, ownDrives: 2, ownDrive: 3.84,
    snapPer: true, peak: 2, partMs: 1950000000, backfill: 30,
    calib: { on: false, spaceGiB: '', nodes: '', rf: '', days: '', pps: '', ratio: '' },
    profileOverride: null
  };
}

/* ---------- утилиты ---------- */
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function num(x, d) { const v = typeof x === 'string' ? parseFloat(x.replace(',', '.')) : Number(x); return Number.isFinite(v) ? v : d; }
const ceilTo = (x, k) => Math.ceil(x / k) * k;
function heapFor(ram) { if (ram <= 24) return Math.max(4, Math.floor(ram / 4)); if (ram <= 40) return 8; if (ram <= 80) return 16; if (ram <= 160) return 24; return 31; }
function pickSmall(needTB, list) { for (const g of list) if (g >= needTB) return g; return list[list.length - 1]; }
function drivesFor(reqTB, raid, size) {
  switch (raid) {
    case 'none': return reqTB <= size ? 1 : null;
    case 'raid0': case 'jbod': return Math.max(1, Math.ceil(reqTB / size));
    case 'raid1': return reqTB <= size ? 2 : null;
    case 'raid10': return Math.max(4, 2 * Math.ceil(reqTB / size));
    case 'raid5': return Math.max(3, Math.ceil(reqTB / size) + 1);
    case 'raid6': return Math.max(4, Math.ceil(reqTB / size) + 2);
  }
  return null;
}
function pickDrives(reqTB, disk, raid, sizeSel) {
  const sizes = sizeSel === 'auto' ? DRIVES[disk] : [num(sizeSel, 3.84)];
  let best = null;
  for (const sz of sizes) {
    const n = drivesFor(reqTB, raid, sz);
    if (n == null) continue;
    const cand = { n, size: sz, raw: n * sz, usable: RAIDS[raid].eff(n) * sz };
    if (sizeSel !== 'auto') { best = cand; break; }
    if (n > 8) continue;
    cand.score = cand.raw + 0.5 * n;
    if (!best || cand.score < best.score - 1e-9) best = cand;
  }
  if (!best && sizeSel === 'auto') {
    const sz = sizes[sizes.length - 1], n = drivesFor(reqTB, raid, sz);
    if (n != null) best = { n, size: sz, raw: n * sz, usable: RAIDS[raid].eff(n) * sz };
  }
  return best || { n: null, size: sizes[sizes.length - 1], raw: 0, usable: 0, impossible: true };
}

/* ---------- репликация ---------- */
function resolveRep(s) {
  if (s.mode === 'standalone') return { standalone: true, dcs: [{ name: 'DC1', rf: 1 }], wcl: 'ONE', rcl: 'ONE', lwt: false, scl: 'SERIAL', F: 0, auto: true };
  const D = clamp(Math.round(num(s.dc, 1)), 1, 5);
  const F = clamp(Math.round(num(s.F, 1)), 0, 3);
  if (s.manual) {
    const rfs = Array.from({ length: D }, (_, i) => clamp(Math.round(num((s.rfs || [])[i], 3)), i === 0 ? 1 : 0, 9));
    return { dcs: rfs.map((rf, i) => ({ name: 'DC' + (i + 1), rf })), wcl: s.wcl, rcl: s.rcl, lwt: !!s.lwt, scl: s.scl || 'LOCAL_SERIAL', F, auto: false };
  }
  const strong = s.cons !== 'eventual';
  const rf = Math.max(1, strong ? 2 * F + 1 : F + 1);
  return { dcs: Array.from({ length: D }, (_, i) => ({ name: 'DC' + (i + 1), rf })), wcl: strong ? 'LOCAL_QUORUM' : 'LOCAL_ONE', rcl: strong ? 'LOCAL_QUORUM' : 'LOCAL_ONE', lwt: !!s.lwt, scl: 'LOCAL_SERIAL', F, auto: true };
}
function racksFor(rf, N, policy) { return rf >= 2 && policy !== 'one' ? Math.min(rf, N) : 1; }
function spread(N, K) { return Array.from({ length: K }, (_, i) => Math.floor(N / K) + (i < N % K ? 1 : 0)); }
function ftState(R, topo) {
  const s = R.s, rep = R.rep;
  return {
    cluster: 'MES_TSDB', ks: 'TSDB', dcs: topo.map((t, i) => ({ name: rep.dcs[i].name, rf: rep.dcs[i].rf, racks: t.racks.slice() })),
    wcl: rep.wcl, rcl: rep.rcl, clientDc: 0, lwt: rep.lwt, scl: rep.scl,
    numTokens: num(s.numTokens, 16), tokenMode: s.tokenMode || 'balanced', seed: num(s.seed, 1), dataGB: '', writesPs: '', readsPs: '', rowBytes: ''
  };
}

/* ---------- чтение ---------- */
function usageParams(s) { return s.usage === 'custom' ? s : USAGE[s.usage] || USAGE.typical; }
function readModel(s, ratePerTag) {
  const u = usageParams(s);
  const U = Math.max(0, num(s.users, 0)), page = M.page;
  const rowsWin = num(u.trWin, 8) * 3600 * ratePerTag;
  const pagesWin = Math.max(1, Math.ceil(rowsWin / page));
  const trRef = Math.max(1, num(u.trRef, 5)), mnRef = Math.max(0.5, num(u.mnRef, 2));
  const rowsRef = Math.max(1, trRef * ratePerTag);
  const rowsRep = num(u.repDays, 1) * 86400 * ratePerTag;
  const pagesRep = Math.max(1, Math.ceil(rowsRep / page));
  const trTags = num(u.trTags, 10), mnTags = num(u.mnTags, 0), repTags = num(u.repTags, 0);
  const q = { open: U * num(u.trOpen, 0) / 3600 * trTags * pagesWin, ref: U * trTags / trRef, mn: U * mnTags / mnRef, rep: U * num(u.repH, 0) / 3600 * repTags * pagesRep };
  q.total = q.open + q.ref + q.mn + q.rep; q.tsdb = q.open + q.ref + q.rep;
  const rows = { open: U * num(u.trOpen, 0) / 3600 * trTags * rowsWin, ref: q.ref * rowsRef, mn: q.mn, rep: U * num(u.repH, 0) / 3600 * repTags * rowsRep };
  rows.total = rows.open + rows.ref + rows.mn + rows.rep;
  return { U, page, rowsWin, pagesWin, rowsRep, q, rows, u };
}

/* ---------- калибровка по nodetool tablestats ---------- */
function parseTablestats(text) {
  const out = {};
  if (!text) return out;
  const unit = { bytes: 1, KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
  const m1 = /Space used \(live\):\s*([\d.,]+)\s*([KMGT]i?B|bytes)?/i.exec(text);
  if (m1) { const v = parseFloat(m1[1].replace(',', '.')); const u = m1[2] || 'bytes'; out.spaceGiB = v * (unit[u] || 1) / 1073741824; }
  const m2 = /SSTable Compression Ratio:\s*([\d.,]+)/i.exec(text);
  if (m2) out.ratio = parseFloat(m2[1].replace(',', '.'));
  const m3 = /Number of partitions \(estimate\):\s*(\d+)/i.exec(text);
  if (m3) out.partitions = +m3[1];
  return out;
}

/* ---------- основной расчёт ---------- */
function compute(sIn) {
  const s = Object.assign(defaultState(), sIn || {});
  s.calib = Object.assign(defaultState().calib, (sIn && sIn.calib) || {});
  const rep = resolveRep(s);
  const standalone = !!rep.standalone;
  const F = standalone ? 0 : rep.F;

  const groups = [];
  let P = 0, tags = 0, minPer = Infinity;
  const byType = {};
  for (const g of (s.groups || [])) {
    const cnt = num(g.count, 0), per = num(g.period, 0);
    if (!(cnt > 0 && per > 0) || !SZ.TYPES[g.type]) continue;
    const pps = cnt / per;
    groups.push({ type: g.type, count: cnt, period: per, pps });
    P += pps; tags += cnt; minPer = Math.min(minPer, per);
    const t = byType[g.type] || (byType[g.type] = { tags: 0, pps: 0 });
    t.tags += cnt; t.pps += pps;
  }
  if (P <= 0) return { empty: true, s, rep };

  const ret = Math.max(1, num(s.retention, 365));
  const g = Math.max(0, num(s.growth, 0)) / 100, Y = clamp(num(s.years, 0), 0, 15);
  const Gf = Math.pow(1 + g, Y);
  const Gavg = (g > 0 && Y > 0) ? (Gf - 1) / (Y * Math.log(1 + g)) : 1;
  const horizonDays = Math.max(Y * 365, ret);
  const peak = Math.max(1, num(s.peak, 2));
  const mutFactor = 1 + (s.snapPer ? 1 : 0);
  const mutAvg = P * mutFactor * Gf, mutPeak = mutAvg * peak;
  const ratePerTag = P / tags;
  const strBytes = Math.round(num(s.strLen, 32) * SZ.BPC[s.strEnc || 'mix']);
  const annBytes = Math.round(num(s.annLen, 0) * SZ.BPC[s.annEnc || 'cyr']);
  const annPct = clamp(num(s.annPct, 0), 0, 100) / 100;
  const Wrec = clamp(Math.ceil(ret / 30), 1, 30);
  const ttlSec = Math.min(Math.round(ret * 86400), 630720000);
  const reads = readModel(s, ratePerTag * Gf);

  const o = { s, rep, standalone, F, groups, P, tags, byType, minPer, ret, g, Y, Gf, Gavg, horizonDays, peak, mutFactor, mutAvg, mutPeak,
    ratePerTag, strBytes, annBytes, annPct, Wrec, ttlSec, reads, partSec: Math.max(1, num(s.partMs, 1950000000) / 1000) };

  // Топология по умолчанию для оценки CL (RF и CL от числа нод не зависят)
  const T0 = FT.buildTopology({ dcs: rep.dcs.map(d => ({ name: d.name, rf: d.rf, racks: [Math.max(d.rf, 1)] })) });
  o.req = { W: FT.requirement(rep.wcl, 0, T0), R: FT.requirement(rep.rcl, 0, T0), S: rep.lwt ? FT.requirement(rep.scl, 0, T0) : null };
  o.tol = { w: FT.worstNodeTolerance(o.req.W, T0), r: FT.worstNodeTolerance(o.req.R, T0), s: o.req.S ? FT.worstNodeTolerance(o.req.S, T0) : null };
  o.consistent = FT.consistent(o.req.W, o.req.R, T0);
  o.rLocal = rep.dcs.map((d, i) => { const Rq = FT.requirement(rep.rcl, i, T0); const per = FT.readSpread(Rq, T0, i); return Math.max(1, per[i] || 0); });

  // калибровка
  o.calib = calibration(o);

  const defs = {
    cur:   { key: 'cur', name: 'Текущая схема', short: 'Текущая', ttl: false, unset: false, W: 1, gcSec: 86400, cleanup: s.cleanup, backups: s.backups, autoSnapTruncate: s.cleanup === 'truncate' },
    rec:   { key: 'rec', name: 'Рекомендации', short: 'Рекомендации', ttl: true, unset: false, W: Wrec, gcSec: standalone ? 3600 : 10800, cleanup: 'ttl', backups: s.backups === 'on_cleanup' ? 'on_cleanup' : 'off', autoSnapTruncate: false },
    unset: { key: 'unset', name: 'Рекомендации + доработка драйвера', short: '+ доработка драйвера', ttl: true, unset: true, W: Wrec, gcSec: standalone ? 3600 : 10800, cleanup: 'ttl', backups: s.backups === 'on_cleanup' ? 'on_cleanup' : 'off', autoSnapTruncate: false }
  };
  o.variants = {};
  for (const k of ['cur', 'rec', 'unset']) o.variants[k] = sizeVariant(o, defs[k]);
  o.checks = buildChecks(o);
  return o;
}

function pointParams(o, gr, v) {
  return { type: gr.type, period: gr.period, strBytes: gr.type === 'STRING' ? o.strBytes : 0, annPct: o.annPct, annBytes: o.annBytes, windowDays: v.W, ttlSec: o.ttlSec };
}
function dayBytes(o, v, comp, k) {
  let data = 0, raw = 0, tomb = 0;
  const variant = v.key;
  for (const gr of o.groups) {
    const pb = SZ.pointBytes(pointParams(o, gr, v), variant, comp);
    data += gr.pps * 86400 * pb.disk; raw += gr.pps * 86400 * pb.raw;
    tomb += gr.pps * (v.unset ? 0 : 5);
  }
  data *= k;
  const part = o.tags * (SZ.partitionBytes(M.keyLen) + M.sstAux) / v.W; // на тег в каждом SSTable окна
  return { day: data * (1 + M.auxPct) + part, data, raw, tombPerRow: tomb / o.P };
}

function calibration(o) {
  const c = o.s.calib || {};
  const space = num(c.spaceGiB, 0), nodes = num(c.nodes, 0), rf = num(c.rf, 0), days = num(c.days, 0);
  const pps = num(c.pps, 0) || o.P, ratio = num(c.ratio, 0);
  const res = { valid: false, on: !!c.on, k: 1, kRaw: 1, pps };
  if (!(space > 0 && nodes > 0 && rf > 0 && days > 0)) return res;
  const measured = space * 1073741824 * nodes / rf / (pps * days * 86400);
  const cur = { key: 'cur', ttl: false, unset: false, W: 1 };
  const model = dayBytes(o, cur, 'lz4', 1).day / (o.P * 86400);
  const modelRaw = dayBytes(o, cur, 'none', 1).day / (o.P * 86400);
  res.valid = true; res.measured = measured; res.model = model; res.dev = measured / model - 1;
  res.k = measured / model;
  if (ratio > 0 && ratio < 1.5) { res.ratio = ratio; res.measuredRaw = measured / ratio; res.kRaw = res.measuredRaw / modelRaw; res.modelRaw = modelRaw; }
  res.suspicious = res.k > 2 || res.k < 0.5;
  return res;
}

function sizeVariant(o, v) {
  const s = o.s;
  const useK = o.calib.valid && o.calib.on;
  const k = useK ? o.calib.k : 1, kRaw = useK ? o.calib.kRaw : 1;
  const lz4 = dayBytes(o, v, 'lz4', k), none = dayBytes(o, v, 'none', kRaw);
  const comp = s.comp === 'none' ? 'none' : 'lz4';
  const D = comp === 'lz4' ? lz4 : none;
  const compDay = D.day;
  const avgRaw = lz4.raw / (o.P * 86400);
  // объём одной копии на горизонте
  const cleanInt = Math.max(1, num(s.cleanInt, 7));
  let L, Lnote;
  if (v.cleanup === 'ttl') { L = compDay * o.Gf * (o.ret + v.W + v.gcSec / 86400); Lnote = 'TTL: срок хранения + окно TWCS + gc_grace_seconds'; }
  else if (v.cleanup === 'delete') { L = compDay * o.Gavg * o.horizonDays; Lnote = 'DELETE при TWCS не освобождает место: данные копятся весь горизонт'; }
  else if (v.cleanup === 'delete_gc') { L = compDay * o.Gf * (o.ret + cleanInt) * 1.02; Lnote = 'DELETE + nodetool garbagecollect: срок хранения + интервал очистки'; }
  else { L = compDay * o.Gf * (o.ret + cleanInt); Lnote = 'TRUNCATE: срок хранения + интервал очистки'; }
  let B = 0;
  if (v.backups === 'on_nocleanup') B = compDay * o.Gavg * o.horizonDays;
  else if (v.backups === 'on_cleanup') B = compDay * o.Gf * Math.max(1, num(s.backInt, 7));
  const rowDisk = compDay / (o.P * 86400);
  const snapT = o.tags * o.Gf * (rowDisk * 2 + 60); // snapshots: строка на тег, перезаписи до compaction
  // объём с другой настройкой сжатия: для сравнения
  const alt = comp === 'lz4' ? none.day : lz4.day;
  const ctx = { v, lz4, none, comp, compDay, alt, avgRaw, rowDisk, rawPerPoint: avgRaw, bytesPerPoint: rowDisk, tombPerRow: lz4.tombPerRow, L, Lnote, B, snapT };
  ctx.tf = 1 + 0.15 * ctx.tombPerRow;

  // нагрузка по ДЦ (каждый ДЦ рассчитан на полную нагрузку: зеркальное резервирование)
  ctx.dcLoad = o.rep.dcs.map((d, i) => {
    const writeCores = o.mutPeak * d.rf / M.wpc;
    const readCores = d.rf > 0 ? o.reads.q.total * o.rLocal[i] / M.qpc + o.reads.rows.total * o.rLocal[i] * ctx.tf / M.rpc : 0;
    return { writeCores, readCores, coresNeed: (writeCores + readCores) / M.util };
  });

  const own = s.hw === 'own';
  const profiles = own ? [{ id: 'own', c: Math.max(1, num(s.ownCores, 16)), ram: Math.max(4, num(s.ownRam, 64)), own: true }] : PROFILES;
  ctx.cands = profiles.map(p => sizeProfile(o, v, ctx, p));
  const fit = ctx.cands.filter(c => c.fits);
  const ov = s.profileOverride && ctx.cands.find(c => c.p.id === s.profileOverride);
  ctx.chosen = ov || (fit.length ? fit.reduce((a, b) => (b.cost < a.cost - 1e-9 ? b : a)) : ctx.cands[ctx.cands.length - 1]);
  ctx.own = own;
  ctx.dcs = ctx.chosen.dcs;
  ctx.node = ctx.dcs[0].node;
  ctx.N = ctx.dcs[0].N;
  ctx.Ntotal = ctx.dcs.reduce((a, d) => a + d.N, 0);
  ctx.topo = ctx.dcs.map(d => ({ racks: d.racks.slice() }));
  return ctx;
}

function manualTopo(o) {
  const t = o.s.topo;
  if (!Array.isArray(t) || t.length !== o.rep.dcs.length) return null;
  if (!t.every(d => Array.isArray(d.racks) && d.racks.length && d.racks.every(n => num(n, 0) >= 1))) return null;
  return t.map(d => ({ racks: d.racks.map(n => Math.round(num(n, 1))) }));
}

function sizeProfile(o, v, ctx, p) {
  const s = o.s, F = o.F;
  const maxNodeBytes = Math.max(0.5, num(s.maxNodeTB, 4)) * 1e12;
  const man = o.standalone ? null : manualTopo(o);
  let manShares = null;
  if (man) {
    const T = FT.buildTopology({ dcs: man.map((t, i) => ({ name: o.rep.dcs[i].name, rf: o.rep.dcs[i].rf, racks: t.racks })) });
    manShares = T.dcs.map(dc => { const sh = FT.idealShares(dc); return Math.max(0, ...dc.racks.map(r => sh[r.gidx])); });
  }
  const dcs = o.rep.dcs.map((d, i) => {
    const rf = d.rf, load = ctx.dcLoad[i];
    const LDC = (ctx.L + ctx.snapT) * rf;
    if (o.standalone) {
      const node = nodeDetail(o, v, ctx, p, 1, 1, i);
      return { N: 1, racks: [1], K: 1, node, limits: [], need: 1 };
    }
    const Nrf = Math.max(rf, 3), Ndisk = Math.ceil(LDC / maxNodeBytes), Ncpu = Math.ceil(load.coresNeed / p.c) + F;
    let need = Math.max(Nrf, Ndisk, Ncpu);
    const limits = [];
    if (need === Nrf) limits.push('RF'); if (need === Ndisk && Ndisk > 0) limits.push('объём на ноду'); if (need === Ncpu) limits.push('CPU');
    if (man) {
      const N = man[i].racks.reduce((a, b) => a + b, 0);
      const share = rf > 0 ? manShares[i] : 0;
      const node = nodeDetail(o, v, ctx, p, N, share, i);
      let needRam = need;
      // сколько нод нужно с учётом RAM при сбалансированных racks
      for (let n = need, guard = 0; guard < 2000; n++, guard++) { if (nodeDetail(o, v, ctx, p, n, rf / n, i).ram.fits) { needRam = n; break; } }
      return { N, racks: man[i].racks.slice(), K: man[i].racks.length, node, limits, need: Math.max(need, needRam), manual: true };
    }
    const K0 = racksFor(rf, need, s.rackPolicy);
    let N = ceilTo(need, K0);
    let node = nodeDetail(o, v, ctx, p, N, rf > 0 ? rf / N : 0, i);
    let guard = 0;
    while (guard++ < 2000 && (!node.ram.fits || (p.own && !node.data.ownFits))) { N += K0; node = nodeDetail(o, v, ctx, p, N, rf > 0 ? rf / N : 0, i); }
    if (guard > 1) limits.splice(0, limits.length, node.ram.fits ? 'диск ноды' : 'RAM');
    const K = racksFor(rf, N, s.rackPolicy);
    return { N, racks: spread(N, K), K, node, limits, need: N };
  });
  let fits;
  if (o.standalone) {
    const n = dcs[0].node;
    dcs[0].limits = [];
    if (n.cpu.peakUtil > 100) dcs[0].limits.push('CPU');
    if (!n.ram.fits) dcs[0].limits.push('RAM');
    if (n.live > maxNodeBytes) dcs[0].limits.push('объём на ноду');
    if (p.own && !n.data.ownFits) dcs[0].limits.push('диск ноды');
    fits = dcs[0].limits.length === 0;
  } else fits = dcs.every(d => d.N <= 2000);
  const Ntot = dcs.reduce((a, d) => a + d.N, 0);
  return { p, dcs, N: dcs[0].N, Ntot, fits, limits: dcs[0].limits, node: dcs[0].node, cost: Ntot * (p.c + p.ram / 4 + 12) };
}

function nodeDetail(o, v, ctx, p, N, share, dci) {
  const s = o.s, F = o.F;
  const live = (ctx.L + ctx.snapT) * share;
  const windowData = ctx.compDay * o.Gf * v.W * share;
  const head = Math.max(2 * windowData, 0.10 * live);
  const repair = o.standalone ? 0 : 0.10 * live;
  const snapRes = 0.05 * live;
  const autoSnap = v.autoSnapTruncate ? ctx.L * share : 0;
  const rawWriteNodeAvg = o.mutAvg * share * (ctx.avgRaw + M.mutOverhead);
  const hints = o.standalone || F === 0 || N - F <= 0 ? 0 : rawWriteNodeAvg * M.hintWindowSec * F / (N - F);
  const backups = ctx.B * share;
  const reqData = (live + head + repair + snapRes + autoSnap + hints + backups) / (1 - M.fsReserve);
  const steady = live + snapRes + autoSnap + backups;
  const reqDataFinal = Math.max(reqData, steady / M.maxFill);
  const fillLimit = Math.min(M.maxFill, steady / reqDataFinal);
  const disk = s.disk || 'nvme', raid = s.raid || 'raid0';
  let drives, ownFits = true;
  if (p.own) {
    const n = Math.max(1, Math.round(num(s.ownDrives, 2))), sz = num(s.ownDrive, 3.84);
    const usable = Math.max(0, RAIDS[raid].eff(n)) * sz;
    drives = { n, size: sz, raw: n * sz, usable };
    ownFits = usable * 1e12 >= reqDataFinal;
  } else drives = pickDrives(reqDataFinal / 1e12, disk, raid, s.drive || 'auto');
  // RAM
  const heap = heapFor(p.ram), memOff = heap / 4;
  const compMeta = ctx.comp === 'lz4' ? live / 16384 * 8 / 1e9 : 0;
  const windows = v.cleanup === 'ttl' ? Math.ceil((o.ret + v.W) / v.W) : Math.ceil(ctx.L / Math.max(1, ctx.compDay * o.Gf));
  const bf = o.tags * o.Gf * Math.min(1, share) * windows * 1.25 / 1e9;
  const fileCache = Math.min(2, heap / 4), osRes = 4;
  const hot = Math.max(4, ctx.compDay * o.Gf * share / 1e9);
  const need = heap + memOff + compMeta + bf + fileCache + osRes + hot;
  const ram = { heap, memOff, compMeta, bf, fileCache, osRes, hot, need, have: p.ram, fits: need <= p.ram };
  // CPU: нагрузка ДЦ пропорциональна доле ноды
  const load = ctx.dcLoad[dci];
  const rf = o.rep.dcs[dci].rf || 1;
  const demand = (load.writeCores + load.readCores) * share / rf;
  const peakUtil = demand / p.c * 100;
  const failUtil = (o.standalone || N - F <= 0) ? peakUtil : (load.writeCores + load.readCores) * share / rf * N / (N - F) / p.c * 100;
  const cpu = { cores: p.c, demand, peakUtil, failUtil };
  // запись
  const writesPeak = o.mutPeak * share, writesAvg = o.mutAvg * share;
  const clMBs = writesPeak * (ctx.avgRaw + M.mutOverhead) / 1048576;
  const clTotalMiB = clMBs * 60 > 8192 ? 16384 : 8192;
  const clNeedGB = Math.max(64, clTotalMiB / 1024 * 2 + 16);
  const clDrive = pickSmall(clNeedGB / 1000, [0.24, 0.48, 0.96, 1.92]);
  const osNeedGB = 50 + heap + 20, osDrive = pickSmall(osNeedGB / 1000, [0.24, 0.48, 0.96]);
  // чтение, диск
  const rLoc = o.rLocal[dci];
  const qNode = o.reads.q.total * rLoc * share / rf, qTsdb = o.reads.q.tsdb * rLoc * share / rf;
  const sstPerRead = v.cleanup === 'ttl' ? 5 : 6;
  const dk = DISK[disk];
  const effDrives = drives.n ? Math.max(1, Math.floor(RAIDS[raid].eff(drives.n)) || 1) : 1;
  const iopsNeed = qTsdb * sstPerRead * 0.75 + (qNode - qTsdb) * 0.2, iopsCap = dk.iops * effDrives;
  // сеть
  const intraBps = (o.standalone ? 0 : writesPeak * (ctx.avgRaw + M.mutOverhead) * 8) + o.reads.rows.total * rLoc * share / rf * 40 * 8;
  const intraUtil = intraBps / (Math.max(0.1, num(s.netIn, 10)) * 1e9) * 100;
  const D = o.rep.dcs.length;
  const interBps = D > 1 ? o.mutPeak * (ctx.avgRaw + M.mutOverhead) * 8 * (D - 1) * 0.6 : 0;
  const interUtil = D > 1 ? interBps / (Math.max(0.01, num(s.netDc, 1)) * 1e9) * 100 : 0;
  // задержки, ориентир
  const rttIn = num(s.rttIn, 0.3), rttDc = num(s.rttDc, 20);
  const crossW = o.req.W.needsRemote, crossR = o.req.R.needsRemote;
  const latW = 5 + (o.standalone ? 0 : rttIn) + (crossW ? rttDc : 0) + (disk === 'hdd' ? 6 : 0) + (o.standalone && num(s.rpo, 10) < 1 ? 15 : 0);
  const rowsPage = Math.min(o.reads.page, o.reads.rowsWin);
  const latR = 7 + (o.standalone ? 0 : rttIn) + (crossR ? rttDc : 0) + sstPerRead * dk.lat * 2 + rowsPage * 0.0015 * ctx.tf;
  // восстановление ноды: обычный streaming (TWCS-SSTable покрывают все диапазоны vnode)
  const netMBs = Math.max(0.1, num(s.netIn, 10)) * 1e9 / 8 / 1e6;
  const sources = o.standalone ? 0 : Math.min(N - 1, 4);
  const defRate = Math.min(sources * 24 * 1.048576, netMBs * 0.7, dk.mbs * effDrives);
  const recPerSrc = Math.min(100, Math.max(24, Math.floor(netMBs * 0.25 / 8) * 8));
  const recRate = Math.min(sources * recPerSrc * 1.048576, netMBs * 0.7, dk.mbs * effDrives);
  return {
    N, share, live, windowData, head, repair, snapRes, autoSnap, hints, backups, reqData: reqDataFinal, fillLimit, steady,
    data: { drives, raid, disk, ownFits },
    commitlog: { mbs: clMBs, totalMiB: clTotalMiB, needGB: clNeedGB, drive: clDrive }, os: { needGB: osNeedGB, drive: osDrive },
    ram, cpu, writes: { peak: writesPeak, avg: writesAvg, rawBpsAvg: rawWriteNodeAvg },
    reads: { q: qNode, qTsdb, sstPerRead, iopsNeed, iopsCap, iopsUtil: iopsNeed / iopsCap * 100 },
    net: { intraBps, intraUtil, interBps, interUtil }, lat: { w: latW, r: latR, rowsPage },
    rto: { sources, recPerSrc, defH: sources ? live / 1e6 / defRate / 3600 : null, recH: sources ? live / 1e6 / recRate / 3600 : null }
  };
}

/* ---------- проверки ---------- */
function fmtB(b) { return b >= 1e12 ? (b / 1e12).toFixed(1).replace('.', ',') + ' ТБ' : Math.round(b / 1e9) + ' ГБ'; }
function buildChecks(o) {
  const out = [];
  const add = (sev, scope, title, text, fix) => out.push({ sev, scope, title, text, fix: fix || '' });
  const s = o.s, cur = o.variants.cur, rec = o.variants.rec, rep = o.rep;
  const rf0 = rep.dcs[0].rf;
  if (o.standalone) {
    add('warn', 'Отказоустойчивость', 'Одна копия данных', 'Отказ сервера останавливает запись и чтение. При потере data-диска данные восстанавливаются только из резервной копии.', 'Data-диск в RAID 1 или RAID 10, ежедневный nodetool snapshot с выгрузкой на внешнее хранилище.');
    if (['none', 'raid0', 'jbod'].includes(s.raid)) add('crit', 'Хранилище', 'Нет избыточности дисков', RAIDS[s.raid].label + ' на одной ноде: отказ накопителя означает потерю данных.', 'Для одной ноды используйте RAID 1 или RAID 10.');
    if (!rec.chosen.fits) add('crit', 'Ресурсы', 'Нагрузка не помещается на один сервер', 'Ограничения: ' + rec.chosen.limits.join(', ') + '.', 'Перейдите в режим «Кластер».');
  } else {
    if (o.tol.w < rep.F) add('crit', 'Отказоустойчивость', 'Запись остановится при ' + rep.F + ' отказах', 'RF ' + rf0 + ', запись ' + rep.wcl + ' выдерживает отказ ' + Math.max(0, o.tol.w) + ' нод.', 'Для ' + rep.F + ' отказов при QUORUM нужен RF ≥ ' + (2 * rep.F + 1) + ', при LOCAL_ONE RF ≥ ' + (rep.F + 1) + '.');
    if (o.tol.r < rep.F) add('crit', 'Отказоустойчивость', 'Чтение остановится при ' + rep.F + ' отказах', 'RF ' + rf0 + ', чтение ' + rep.rcl + ' выдерживает отказ ' + Math.max(0, o.tol.r) + ' нод.', 'Увеличьте RF или понизьте consistency level чтения.');
    if (o.consistent === false) add('warn', 'Отказоустойчивость', 'Тренд может кратко не показать последние точки', 'Запись и чтение не перекрываются гарантированно (W + R ≤ RF).', 'Для строгой согласованности: LOCAL_QUORUM на запись и чтение.');
    if (o.consistent === null) add('crit', 'Отказоустойчивость', 'Consistency level не выполняется', 'Запись или чтение требует больше реплик, чем задано RF.', 'Проверьте RF и consistency level.');
    if (rep.dcs.some(d => d.rf === 1)) add('crit', 'Отказоустойчивость', 'RF 1 в кластере', 'Каждая партиция хранится на одной ноде: отказ диска означает потерю данных.', 'RF не меньше 2, рекомендуемо 3.');
    if (rep.dcs.length > 1 && (o.req.W.needsRemote || o.req.R.needsRemote)) add('warn', 'Отказоустойчивость', 'Каждая операция ждёт удалённый ДЦ', 'Consistency level требует ответа из другого ДЦ: задержка не меньше RTT между ДЦ (' + s.rttDc + ' мс), обрыв связи останавливает операции.', 'Используйте LOCAL_QUORUM или LOCAL_ONE.');
    if (rep.F === 0) add('warn', 'Отказоустойчивость', 'Отказ любой ноды не допускается', 'Допустимых отказов: 0.', 'Для MES в производстве рекомендуемо не меньше 1.');
  }
  // хранение, текущая схема
  if (s.backups === 'on_nocleanup') add('crit', 'Хранилище', 'incremental_backups копит файлы без очистки', 'На каждый flush создаётся hard link в backups/. За ' + Math.round(o.horizonDays) + ' сут это ' + fmtB(cur.B) + ' в одной копии, место не освобождается.', 'ALTER TABLE ... WITH incremental_backups = false; либо выгрузка и очистка backups/ по расписанию.');
  if (s.cleanup === 'delete') add('crit', 'Хранилище', 'DELETE при TWCS не освобождает место', 'Старые данные и их tombstone лежат в разных окнах TWCS и не объединяются: ' + fmtB(cur.L) + ' в одной копии против ' + fmtB(rec.L) + ' с TTL.', 'Перейти на default_time_to_live (без доработки MES) или запускать nodetool garbagecollect после DELETE.');
  if (s.cleanup === 'truncate') add('crit', 'Хранилище', 'TRUNCATE оставляет snapshot', 'При allow_auto_snapshot = true перед TRUNCATE создаётся snapshot таблицы: место не освобождается до nodetool clearsnapshot.', 'ALTER TABLE ... WITH allow_auto_snapshot = false или nodetool clearsnapshot после очистки.');
  // tombstone при чтении
  const pageRows = Math.min(M.page, Math.max(1, num(o.reads.u.trWin, 8) * 3600 / o.minPer));
  const tombPage = pageRows * cur.tombPerRow;
  if (tombPage > 100000) add('crit', 'Чтение', 'Превышение tombstone_failure_threshold', 'Страница тренда ≈' + Math.round(tombPage).toLocaleString('ru-RU') + ' tombstone: запрос завершится ошибкой.', 'Не передавать null из драйвера (Unset.Value).');
  else if (tombPage > 1000) add('warn', 'Чтение', 'Tombstone в каждой строке', 'Явные null дают 5 tombstone-ячеек на точку, страница тренда ≈' + Math.round(tombPage).toLocaleString('ru-RU') + ': предупреждения в system.log и медленнее чтение.', 'В драйвере C# передавать Unset.Value вместо null. Без доработки tombstone_warn_threshold поднимается в cassandra.yaml.');
  // размер партиции
  const rowsPart = o.partSec / o.minPer;
  let fastRow = 0;
  for (const gr of o.groups) if (gr.period === o.minPer) fastRow = Math.max(fastRow, SZ.rowRaw(pointParams(o, gr, cur.v), 'cur'));
  const partBytes = rowsPart * fastRow;
  if (partBytes > 100 * 1048576) add('warn', 'Модель данных', 'Партиция больше 100 МиБ', 'Тег с периодом ' + o.minPer + ' с за PartitionSize ' + (o.partSec / 86400).toFixed(1).replace('.', ',') + ' сут ≈ ' + Math.round(partBytes / 1048576) + ' МиБ до сжатия.', 'Для быстрых тегов уменьшить PartitionSize до ' + Math.max(1, Math.floor(o.partSec / 86400 * 100 * 1048576 / partBytes)) + ' сут.');
  // диски
  if (s.disk === 'hdd') add('warn', 'Хранилище', 'HDD под оперативные данные', 'Чтение с HDD ≈ 9 мс на SSTable: тренды открываются медленно, compaction конкурирует с чтением.', 'Data и commitlog на SSD или NVMe.');
  if (s.raid === 'raid5' || s.raid === 'raid6') add('warn', 'Хранилище', s.raid.toUpperCase() + ' на data-диске', 'Штраф записи RAID 5/6 при постоянном compaction и медленная работа при деградации массива.', o.standalone ? 'Для одной ноды RAID 10.' : 'В кластере с RF ≥ 3 достаточно RAID 0 или JBOD.');
  if (!o.standalone && (s.raid === 'raid1' || s.raid === 'raid10') && rf0 >= 3) add('info', 'Хранилище', 'Двойная избыточность', 'RAID ' + (s.raid === 'raid1' ? '1' : '10') + ' вместе с RF ' + rf0 + ' удваивает число накопителей.', 'При RF ≥ 3 достаточно RAID 0 или JBOD.');
  if (rec.node.data.drives.impossible) add('crit', 'Хранилище', 'Выбранный RAID не вмещает данные', RAIDS[s.raid].label + ' на одном накопителе не даёт ' + fmtB(rec.node.reqData) + '.', 'Выберите RAID 0, RAID 10 или JBOD.');
  if (rec.own && !rec.node.data.ownFits) add('crit', 'Своё оборудование', 'Data-диск ноды мал', 'Нужно ' + fmtB(rec.node.reqData) + ' на ноду.', 'Добавьте накопители или ноды.');
  if (rec.own && !rec.node.ram.fits) add('crit', 'Своё оборудование', 'Не хватает RAM', 'Нужно ' + Math.ceil(rec.node.ram.need) + ' ГБ, есть ' + rec.chosen.p.ram + ' ГБ.', 'Увеличьте RAM.');
  rec.dcs.forEach((d, i) => { if (d.manual && d.N < d.need) add('crit', 'Топология', rep.dcs[i].name + ': нод меньше расчётного', 'В схеме ' + d.N + ' нод, по расчёту нужно не меньше ' + d.need + '.', 'Добавьте ноды или вернитесь к рекомендованной топологии.'); });
  if (rec.node.cpu.failUtil > 85) add('warn', 'Ресурсы', 'CPU после отказа выше 85 %', 'После отказа ' + o.F + ' нод загрузка оставшихся в пике ≈ ' + Math.round(rec.node.cpu.failUtil) + ' %.', 'Добавьте ноды или ядра.');
  if (rec.node.net.intraUtil > 40) add('warn', 'Сеть', 'Сеть между нодами загружена на ' + Math.round(rec.node.net.intraUtil) + ' %', 'Пиковый трафик репликации близок к пропускной способности.', 'Сеть 10 Гбит/с и выше.');
  if (rec.node.net.interUtil > 40) add('warn', 'Сеть', 'Канал между ДЦ загружен на ' + Math.round(rec.node.net.interUtil) + ' %', 'Репликация в другие ДЦ в пике.', 'Расширьте канал или включите internode_compression: all.');
  // SLA
  const sw = num(s.slaW, 0), sr = num(s.slaR, 0);
  if (sw > 0 && rec.node.lat.w > sw) add('warn', 'SLA', 'p99 записи ' + sw + ' мс под угрозой', 'Оценка ≈ ' + rec.node.lat.w.toFixed(0) + ' мс.', 'NVMe, consistency level LOCAL_*; подтвердить нагрузочным тестом.');
  if (sr > 0 && rec.node.lat.r > sr) add('warn', 'SLA', 'p99 чтения ' + sr + ' мс под угрозой', 'Оценка страницы тренда ≈ ' + rec.node.lat.r.toFixed(0) + ' мс.', 'NVMe, Unset.Value вместо null.');
  const rto = num(s.rto, 0);
  if (!o.standalone && rto > 0 && rec.node.rto.recH != null && rec.node.rto.recH > rto) add('warn', 'RTO', 'Замена ноды дольше ' + rto + ' ч', 'Восстановление ' + fmtB(rec.node.live) + ' занимает ≈ ' + rec.node.rto.recH.toFixed(1).replace('.', ',') + ' ч.', 'Меньше данных на ноду (больше нод) или более быстрая сеть.');
  if (o.calib.valid && o.calib.suspicious) add('warn', 'Калибровка', 'Факт отличается от модели более чем вдвое', 'Факт ' + o.calib.measured.toFixed(1) + ' Б на точку, модель ' + o.calib.model.toFixed(1) + ' Б.', 'Проверьте ввод: Space used (live) одной ноды, число нод, RF, глубину хранения и поток точек.');
  return out;
}

/* ---------- конфигурация ---------- */

export { CASSANDRA_VERSION, TYPE_ORDER, TYPE_COL, PROFILES, DRIVES, DISK, RAIDS, USAGE, PRESETS, M, defaultState, compute, resolveRep, ftState, parseTablestats, heapFor, pickDrives, readModel, num, fmtB };
