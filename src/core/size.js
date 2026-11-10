/* Модель размера строки "TSDB".data_points на диске, Apache Cassandra 5.0.9 (форматы oa / da).
 * Сериализация: UnfilteredSerializer, Cell.Serializer, Columns.serializeSubset, ClusteringPrefix (5.0.9).
 * Сжатие LZ4 16 КиБ: коэффициенты (data/comp-grid.json) получены эталонной моделью (verification/measure.py) на liblz4 1.9.4,
 * которая побайтно совпала с Data.db из test/data/legacy-sstables (oa, da) репозитория 5.0.9.
 */
import COMP from './data/comp-grid.json' with { type: 'json' };

const TYPES = {
  DOUBLE: { col: 'double_value', val: 8 }, FLOAT: { col: 'float_value', val: 4 }, LONG: { col: 'long_value', val: 8 },
  DATETIME: { col: 'long_value', val: 8 }, SET: { col: 'long_value', val: 8 }, STRING: { col: 'string_value', val: null }
};
const TYPE_ORDER = ['DOUBLE', 'FLOAT', 'LONG', 'DATETIME', 'SET', 'STRING'];
const BPC = { lat: 1, mix: 1.5, cyr: 2 };

function vsize(v) { let n = 1; while (n < 9 && v >= Math.pow(2, 7 * n)) n++; return n; }
// Средний размер unsigned vint для значения, равномерно распределённого на [a, b)
function avgVint(a, b) {
  if (b <= a) return vsize(a);
  let s = 0;
  for (let n = 1; n <= 9; n++) {
    const lo = n === 1 ? 0 : Math.pow(2, 7 * (n - 1)), hi = n === 9 ? Infinity : Math.pow(2, 7 * n);
    const x = Math.max(a, lo), y = Math.min(b, hi);
    if (y > x) s += n * (y - x);
  }
  return s / (b - a);
}

/* Ожидаемый размер строки до сжатия, байт.
 * variant: cur (явные null, без TTL) | rec (явные null + TTL) | unset (unset + TTL)
 * o: { type, strBytes, annPct (0..1), annBytes, windowDays, ttlSec } */
function rowRaw(o, variant) {
  const ttl = variant !== 'cur', unset = variant === 'unset';
  const spanS = o.windowDays * 86400;
  const ts = avgVint(0, spanS * 1e6);                     // метка записи, мкс от начала окна
  const offS = avgVint(0, spanS);                         // секунды от начала окна
  let body = ts;
  if (ttl) body += 1 + (unset ? offS : avgVint(o.ttlSec, o.ttlSec + spanS)); // TTL (дельта 0) + время истечения
  if (unset) body += o.type === 'STRING' ? 1 : 2;          // маска отсутствующих колонок из 8 (string_value = бит 7)
  const t = TYPES[o.type];
  const sb = o.strBytes || 0;
  const value = t.val != null ? 1 + t.val : 1 + vsize(sb) + sb;
  body += value + 5;                                       // значение + quality_mark_statenumber (int)
  const p = Math.min(1, Math.max(0, o.annPct || 0)), ab = o.annBytes || 0;
  const annFull = 1 + vsize(ab) + ab;
  body += unset ? p * annFull : p * annFull + (1 - p) * 1; // '' пишется ячейкой без значения
  if (!unset) body += 5 * (1 + offS);                      // 5 tombstone-ячеек: флаг + local deletion time
  const row = 1 + 9 + body;                                // флаги + clustering (заголовок 1 + bigint 8)
  const len = row + 2;
  return row + vsize(len) + vsize(len);                    // размер тела и размер предыдущей строки (vint)
}
// Заголовок партиции и маркер конца: на тег в каждом SSTable окна
// DeletionTime 12 байт в формате nb (storage_compatibility_mode: CASSANDRA_4, по умолчанию в cassandra.yaml 5.0), 1 байт в oa/da
function partitionBytes(keyLen) { return 2 + keyLen + 12 + 1; }

// Линейная интерполяция по log(period) и по log(байт строки)
function interp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) { const k = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return ys[i - 1] + k * (ys[i] - ys[i - 1]); }
  return ys[ys.length - 1];
}
const L = Math.log;
// Медленнее 60 с берём не меньше, чем при 60 с: выигрыш на редких тегах зависит от выравнивания меток времени.
function clampSlow(arr) { const a = arr.slice(); const i60 = COMP.periods.indexOf(60); for (let i = i60 + 1; i < a.length; i++) a[i] = Math.max(a[i], a[i60]); return a; }
// Байт на точку после LZ4 (Data.db, включая CRC чанка), строка без annotation ('' или unset)
function lz4Point(type, variant, period, strBytes) {
  const lp = L(Math.max(0.1, period));
  const base = clampSlow(COMP.base[variant][type]);
  const byBase = interp(COMP.periods.map(L), base, lp);
  if (type !== 'STRING') return byBase;
  const g = COMP.str[variant];
  const pc = Math.min(Math.max(period, g.periods[0]), g.periods[g.periods.length - 1]);
  const lb = L(Math.max(1, strBytes));
  const byPer = g.periods.map((_, j) => interp(g.bytes.map(L), g.lz4.map(r => r[j]), lb));
  let v = interp(g.periods.map(L), byPer, L(pc));
  if (period < g.periods[0]) v *= byBase / interp(COMP.periods.map(L), base, L(g.periods[0])); // поправка на частый опрос
  return v;
}
// Прирост сжатого объёма на одну точку с непустой annotation, байт
function annDelta(variant, annBytes, period) {
  const g = COMP.ann[variant];
  const pc = Math.min(Math.max(period, g.periods[0]), g.periods[g.periods.length - 1]);
  const byPer = g.periods.map((_, j) => interp(g.bytes.map(L), g.delta.map(r => r[j]), L(Math.max(1, annBytes))));
  return Math.max(0, interp(g.periods.map(L), byPer, L(pc)));
}

/* Байт на точку на диске (одна копия, Data.db) для группы тегов. comp: 'lz4' | 'none'.
 * o: { type, period, strBytes, annPct, annBytes, windowDays, ttlSec } */
function pointBytes(o, variant, comp) {
  const raw = rowRaw(o, variant);
  if (comp === 'none') return { raw, disk: raw, ratio: 1 };
  const disk = lz4Point(o.type, variant, o.period, o.strBytes || 0) + (o.annPct || 0) * annDelta(variant, o.annBytes || 0, o.period)
    + 8 / 16384 * raw;                                     // смещение чанка в CompressionInfo.db
  return { raw, disk, ratio: disk / raw };
}


export { TYPES, TYPE_ORDER, BPC, vsize, avgVint, rowRaw, partitionBytes, lz4Point, annDelta, pointBytes, COMP };
