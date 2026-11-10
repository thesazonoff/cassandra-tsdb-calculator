"""Сверка модели с настоящим кодом Cassandra 5.0.9.

Одни и те же строки:
  1) записываются CQLSSTableWriter из apache-cassandra-5.0.9.jar (java/W.java, часы FixedClock);
  2) сериализуются моделью (те же правила, что в measure.py).
Data.db Cassandra разбирается и сравнивается с моделью побайтно по каждой партиции,
затем поток пересжимается liblz4 и сравнивается размер Data.db.
CQLSSTableWriter пишет заголовок с EncodingStats.NO_STATS, поэтому здесь минимумы = NO_STATS.
"""
import glob, os, random, shutil, struct, subprocess, sys, json
sys.path.insert(0, os.path.dirname(__file__))
from sstable_ref import write_uvint, _uvsize, lz4_compress, read_compression_info, decompress_data, parse_data
from measure import Gen, make_text, COLS, FIXED, TYPE_COL
from paths import CASSANDRA_HOME, JAVA_BUILD, WORK as WORK_ROOT, result

HERE = os.path.dirname(os.path.abspath(__file__))
C509 = CASSANDRA_HOME
WORK = os.path.join(WORK_ROOT, 'crossval')
NO_TS = 1442880000 * 1000000      # EncodingStats.TIMESTAMP_EPOCH, 2015-09-22 UTC, мкс
NO_LDT = 1442880000               # DELETION_TIME_EPOCH, с

DDL = '''CREATE TABLE "TSDB".data_points (
    partition_id text, event_time bigint, added_time bigint, annotation text, double_value double,
    float_value float, long_value bigint, quality_mark bigint, quality_mark_statenumber int, string_value text,
    PRIMARY KEY (partition_id, event_time)) WITH CLUSTERING ORDER BY (event_time ASC)
    AND compaction = {'class': 'org.apache.cassandra.db.compaction.TimeWindowCompactionStrategy', 'compaction_window_size': '1', 'compaction_window_unit': 'DAYS'}
    AND compression = %s AND default_time_to_live = %d AND gc_grace_seconds = 86400'''


def gen_rows(typ, variant, period_s, window_days, n_rows, str_bytes=32, ann_pct=0.0, ann_bytes=64, seed=3):
    rng = random.Random(seed)
    span_s = window_days * 86400
    per_window = max(1, int(span_s / period_s))
    tags = max(4, -(-n_rows // per_window))
    L = min(per_window, -(-n_rows // tags))
    unset = variant == 'unset'
    t0 = 1792050000000
    anns = [make_text(rng, ann_bytes, 'cyr') for _ in range(50)]
    step = int(round(period_s * 1000))
    parts = []
    for tg in range(tags):
        g = Gen(typ, rng, str_bytes, 'mix')
        key = ('m%d.%d' % (50000 + tg * 7, t0)).encode()
        start = t0 + rng.randint(0, max(0, span_s * 1000 - L * step)); start -= start % step
        rows = []
        for i in range(L):
            ev = start + i * step
            wus = ev * 1000 + rng.randint(2000, 60000)
            cells = {TYPE_COL[typ]: g.next(ev), 'quality_mark_statenumber': struct.pack('>i', 192 if rng.random() > 0.01 else 0)}
            a = anns[rng.randrange(50)] if rng.random() < ann_pct else (b'' if not unset else None)
            if a is not None:
                cells['annotation'] = a
            rows.append((ev, wus, cells))
        parts.append((key, rows))
    return parts


def model_partitions(parts, variant, ttl_s, min_ts, min_ldt, min_ttl, header_cols):
    use_ttl = variant in ('rec', 'unset'); unset = variant == 'unset'
    out = {}
    for key, rows in parts:
        buf = bytearray(struct.pack('>H', len(key)) + key + b'\x80')
        prev = len(buf)
        for ev, wus, cells in rows:
            now_s = wus // 1000000
            present = [c for c in header_cols if (c in cells or not unset)]
            all_cols = len(present) == len(header_cols)
            flags = 0x04 | (0x08 if use_ttl else 0) | (0x20 if all_cols else 0)
            body = bytearray(write_uvint(wus - min_ts))
            if use_ttl:
                body += write_uvint(ttl_s - min_ttl) + write_uvint(now_s + ttl_s - min_ldt)
            if not all_cols:
                miss = 0
                for i, c in enumerate(header_cols):
                    if c not in present: miss |= 1 << i
                body += write_uvint(miss)
            for c in present:
                if c in cells:
                    v = cells[c]; cf = 0x08 | ((0x02 | 0x10) if use_ttl else 0) | (0x04 if not v else 0)
                    body.append(cf)
                    if v: body += v if c in FIXED else write_uvint(len(v)) + v
                else:
                    body.append(0x0D); body += write_uvint(now_s - min_ldt)
            row = bytes([flags]) + write_uvint(0) + struct.pack('>q', ev)
            row += write_uvint(len(body) + _uvsize(prev)) + write_uvint(prev) + body
            buf += row; prev = len(row)
        buf.append(0x01)
        out[key] = bytes(buf)
    return out


def split_partitions(buf):
    """Разрезать Data.db на партиции (по маркерам, через parse_data на каждой)."""
    out, p = {}, 0
    types = ['text' if c in ('annotation', 'string_value') else FIXED[c] for c in COLS]
    while p < len(buf):
        (kl,) = struct.unpack('>H', buf[p:p + 2]); key = buf[p + 2:p + 2 + kl]
        # конец партиции ищем разбором: parse_data на хвосте с ограничением неудобен, поэтому идём по строкам
        q = p + 2 + kl + (1 if buf[p + 2 + kl] & 0x80 else 12)   # DeletionTime: 1 байт (oa/da) или 12 (nb)
        while True:
            fl = buf[q]
            if fl & 0x01: q += 1; break
            q += 1
            from sstable_ref import read_uvint
            _, q = read_uvint(buf, q); q += 8           # заголовок clustering + bigint
            size, q2 = read_uvint(buf, q)
            q = q2 + size
        out[key] = buf[p:q]; p = q
    return out


def run(typ, variant, comp, fmt, period, n, ttl_s=31536000, **kw):
    d = os.path.join(WORK, '%s_%s_%s_%s_%s' % (typ, variant, comp, fmt, period))
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d + '/out')
    parts = gen_rows(typ, variant, period, 1 if variant == 'cur' else 13, n, **kw)
    with open(d + '/rows.tsv', 'w') as f:
        for key, rows in parts:
            for ev, wus, cells in rows:
                vals = [key.hex(), struct.pack('>q', ev).hex()]
                for c in COLS:
                    if c in cells: vals.append(cells[c].hex())
                    else: vals.append('U' if variant == 'unset' else 'N')
                f.write('%d\t%d\t%s\n' % (wus // 1000, wus, '\t'.join(vals)))
    compression = "{'class': 'LZ4Compressor', 'chunk_length_in_kb': '16'}" if comp == 'lz4' else "{'enabled': 'false'}"
    open(d + '/schema.cql', 'w').write(DDL % (compression, ttl_s if variant != 'cur' else 0))
    cp = JAVA_BUILD + ':' + C509 + '/lib/*'
    opts = [x for l in open(C509 + '/conf/jvm17-clients.options') if l.strip() and not l.startswith('#') for x in l.split()]
    r = subprocess.run(['java'] + opts + ['-Dcassandra.clock=FixedClock', '-Dcassandra.storagedir=' + d + '/storage', '-cp', cp, 'W', d + '/out', d + '/schema.cql', d + '/rows.tsv', fmt],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stdout[-2000:] + r.stderr[-3000:])
    data = glob.glob(d + '/out/**/*Data.db', recursive=True)
    assert len(data) == 1, data
    files = {os.path.basename(x).split('-')[-1]: os.path.getsize(x) for x in glob.glob(os.path.dirname(data[0]) + '/*')}
    if comp == 'lz4':
        ci = read_compression_info(glob.glob(os.path.dirname(data[0]) + '/*CompressionInfo.db')[0])
        raw, comp_size = decompress_data(data[0], ci)
    else:
        raw = open(data[0], 'rb').read(); comp_size = len(raw)
    cas = split_partitions(raw)
    mod = model_partitions(parts, variant, ttl_s, NO_TS, NO_LDT, 0, COLS)
    nrows = sum(len(r) for _, r in parts)
    mism = [k for k in mod if mod[k] != cas.get(k)]
    same_bytes = sum(len(v) for v in mod.values()) == len(raw)
    # пересжатие потока Cassandra нашим LZ4
    rec = sum(4 + len(lz4_compress(raw[i:i + 16384])) + 4 for i in range(0, len(raw), 16384)) if comp == 'lz4' else len(raw)
    return dict(typ=typ, variant=variant, comp=comp, fmt=fmt, period=period, rows=nrows, partitions=len(mod),
                mismatched_partitions=len(mism), raw_equal=same_bytes, data_db=comp_size, recompressed=rec,
                files=files, raw=len(raw))


if __name__ == '__main__':
    res = []
    jobs = []
    for typ in ['DOUBLE', 'FLOAT', 'LONG', 'DATETIME', 'SET', 'STRING']:
        for variant in ['cur', 'rec', 'unset']:
            jobs.append((typ, variant, 'lz4', 'big', 1, 20000, {}))
    jobs += [('DOUBLE', 'rec', 'none', 'big', 10, 20000, {}), ('DOUBLE', 'cur', 'lz4', 'bti', 1, 20000, {}),
             ('STRING', 'unset', 'lz4', 'bti', 60, 20000, {'str_bytes': 200}), ('DOUBLE', 'cur', 'lz4', 'big', 1, 20000, {'ann_pct': 0.2, 'ann_bytes': 120}),
             ('SET', 'rec', 'lz4', 'big', 0.1, 20000, {})]
    for typ, variant, comp, fmt, per, n, kw in jobs:
        r = run(typ, variant, comp, fmt, per, n, **kw)
        res.append(r)
        print('%-8s %-5s %-4s %-3s per=%-4s rows=%d parts=%d mismatch=%d raw_equal=%s Data.db=%d recompressed=%d' % (
            typ, variant, comp, fmt, per, r['rows'], r['partitions'], r['mismatched_partitions'], r['raw_equal'], r['data_db'], r['recompressed']), flush=True)
    json.dump(res, open(result('crossval.json'), 'w'), indent=1)
    bad = [r for r in res if r['mismatched_partitions'] or not r['raw_equal'] or r['data_db'] != r['recompressed']]
    print('Наборов: %d, расхождений: %d' % (len(res), len(bad)))
    sys.exit(1 if bad else 0)
