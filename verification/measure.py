"""Замер байт на точку "TSDB".data_points в формате SSTable 5.0 (oa/da): без сжатия и LZ4 16 КиБ.

Строки сериализуются по UnfilteredSerializer / Cell.Serializer 5.0.9, затем поток Data.db
разбирается обратно parse_data (самопроверка) и сжимается чанками как CompressedSequentialWriter.
Медианный профиль значений скрыт от пользователя калькулятора (по требованию), калибруется по tablestats.
"""
import json, os, random, struct, sys
sys.path.insert(0, os.path.dirname(__file__))
from sstable_ref import write_uvint, lz4_compress, parse_data, _uvsize

COLS = ['added_time', 'annotation', 'double_value', 'float_value', 'long_value',
        'quality_mark', 'quality_mark_statenumber', 'string_value']  # порядок ColumnMetadata (по имени)
FIXED = {'added_time': 8, 'double_value': 8, 'float_value': 4, 'long_value': 8, 'quality_mark': 8,
         'quality_mark_statenumber': 4}
TYPE_COL = {'DOUBLE': 'double_value', 'FLOAT': 'float_value', 'LONG': 'long_value', 'DATETIME': 'long_value',
            'SET': 'long_value', 'STRING': 'string_value'}

WORDS_LAT = ['RUN', 'STOP', 'IDLE', 'FAULT', 'ALARM', 'OK', 'MANUAL', 'AUTO', 'BATCH', 'LINE', 'MIXER', 'PUMP',
             'VALVE', 'OPEN', 'CLOSED', 'READY', 'WAIT', 'CIP', 'SETUP', 'CHANGEOVER']
WORDS_CYR = ['Работа', 'Останов', 'Простой', 'Авария', 'Норма', 'Ручной', 'Автомат', 'Партия', 'Линия',
             'Смеситель', 'Насос', 'Клапан', 'Открыт', 'Закрыт', 'Готов', 'Ожидание', 'Мойка', 'Наладка',
             'Переход', 'Брак']


def make_text(rng, nbytes, enc):
    """Строка ~nbytes байт UTF-8: из словаря, enc = lat | cyr | mix."""
    out = []
    size = 0
    while size < nbytes:
        pool = WORDS_LAT if enc == 'lat' or (enc == 'mix' and rng.random() < 0.5) else WORDS_CYR
        w = rng.choice(pool) + ('_' + str(rng.randint(1, 99)) if rng.random() < 0.3 else '')
        out.append(w)
        size = len(' '.join(out).encode())
    s = ' '.join(out).encode()[:nbytes]
    return s.decode('utf-8', 'ignore').encode()


class Gen:
    """Медианный профиль значений тега."""
    REPEAT = {'DOUBLE': 0.30, 'FLOAT': 0.30, 'LONG': 0.60, 'DATETIME': 0.50, 'SET': 0.95, 'STRING': 0.80}

    def __init__(self, typ, rng, str_bytes, str_enc):
        self.t, self.r = typ, rng
        self.level = rng.uniform(10, 900)
        self.v = None
        self.strings = [make_text(rng, str_bytes, str_enc) for _ in range(20)] if typ == 'STRING' else None
        self.counter = rng.randint(0, 10 ** 7)

    def next(self, ev_ms):
        r = self.r
        if self.v is not None and r.random() < self.REPEAT[self.t]:
            return self.v
        t = self.t
        if t == 'DOUBLE':
            self.level += r.gauss(0, self.level * 0.002 + 0.05)
            self.v = struct.pack('>d', round(self.level, 2))
        elif t == 'FLOAT':
            self.level += r.gauss(0, self.level * 0.002 + 0.05)
            self.v = struct.pack('>f', round(self.level, 2))
        elif t == 'LONG':
            self.counter += r.randint(1, 20)
            self.v = struct.pack('>q', self.counter)
        elif t == 'DATETIME':
            self.v = struct.pack('>q', (ev_ms // 1000) * 1000000)
        elif t == 'SET':
            self.v = struct.pack('>q', r.randint(0, 12))
        else:
            self.v = r.choice(self.strings)
        return self.v


def build_sstable(typ, variant, period_s, window_days, n_rows, str_bytes=32, str_enc='mix',
                  ann_pct=0.0, ann_bytes=64, ann_enc='cyr', ttl_s=365 * 86400, seed=1):
    """variant: cur (явные null, без TTL) | rec (явные null + TTL) | unset (unset + TTL)."""
    rng = random.Random(seed)
    span_s = window_days * 86400
    per_window = max(1, int(span_s / period_s))           # строк тега в окне TWCS
    tags = max(4, -(-n_rows // per_window))
    L = min(per_window, -(-n_rows // tags))                # строк тега в выборке (подряд, с шагом периода)
    use_ttl = variant in ('rec', 'unset')
    unset = variant == 'unset'
    t0_ms = 1792050000000                                  # начало окна
    ann_texts = [make_text(rng, ann_bytes, ann_enc) for _ in range(50)]
    parts = []
    step_ms = int(round(period_s * 1000))
    for tg in range(tags):
        g = Gen(typ, rng, str_bytes, str_enc)
        key = ('m%d.%d' % (50000 + tg * 7, 1792050000000)).encode()
        rows = []
        start = t0_ms + rng.randint(0, max(0, span_s * 1000 - L * step_ms))
        start -= start % step_ms                           # метки кратны периоду
        for i in range(L):
            ev = start + i * step_ms
            write_us = ev * 1000 + rng.randint(2000, 60000)
            cells = {}
            cells[TYPE_COL[typ]] = g.next(ev)
            q = 192 if rng.random() > 0.01 else rng.choice([0, 24, 64, 68])
            cells['quality_mark_statenumber'] = struct.pack('>i', q)
            ann = ann_texts[rng.randrange(len(ann_texts))] if rng.random() < ann_pct else (b'' if not unset else None)
            if ann is not None:
                cells['annotation'] = ann
            rows.append((ev, write_us, cells))
        parts.append((key, rows))
    # 2) EncodingStats SSTable
    all_rows = [r for _, rs in parts for r in rs]
    # минимумы по всему SSTable окна: в окне есть данные с самого его начала
    min_ts = t0_ms * 1000
    w0 = t0_ms // 1000
    min_ldt = w0 if not unset else (w0 + ttl_s if use_ttl else 0)
    present_cols = set()
    for _, _, cells in all_rows:
        present_cols.update(cells.keys())
    # MES пишет одним INSERT со всеми колонками; Unset.Value не убирает колонку из заголовка SSTable
    # (проверено на сервере 5.0.9: маска отсутствующих колонок считается по всем 8 колонкам).
    header_cols = COLS
    # 3) сериализация
    buf = bytearray()
    for key, rows in parts:
        pstart = len(buf)
        buf += struct.pack('>H', len(key)) + key + b'\x80'
        prev = len(buf) - pstart
        for ev, wus, cells in rows:
            now_s = wus // 1000000
            present = header_cols if not unset else [c for c in header_cols if c in cells]
            all_cols = len(present) == len(header_cols)
            flags = 0x04 | (0x08 if use_ttl else 0) | (0x20 if all_cols else 0)
            body = bytearray()
            body += write_uvint(wus - min_ts)
            if use_ttl:
                body += write_uvint(0)  # ttl - minTTL
                body += write_uvint(now_s + ttl_s - min_ldt)
            if not all_cols:
                missing = 0
                for i, c in enumerate(header_cols):
                    if c not in cells:
                        missing |= 1 << i
                body += write_uvint(missing)
            for c in present:
                if c in cells:
                    val = cells[c]
                    cf = 0x08  # USE_ROW_TIMESTAMP
                    if use_ttl:
                        cf |= 0x02 | 0x10  # IS_EXPIRING | USE_ROW_TTL
                    if len(val) == 0:
                        cf |= 0x04
                    body.append(cf)
                    if len(val):
                        if c in FIXED:
                            assert len(val) == FIXED[c]
                            body += val
                        else:
                            body += write_uvint(len(val)) + val
                else:  # явный null -> tombstone-ячейка
                    body.append(0x01 | 0x04 | 0x08)
                    body += write_uvint(now_s - min_ldt)
            clustering = write_uvint(0) + struct.pack('>q', ev)
            size_field = len(body) + _uvsize(prev)
            row = bytes([flags]) + clustering + write_uvint(size_field) + write_uvint(prev) + body
            buf += row
            prev = len(row)
        buf.append(0x01)
    buf = bytes(buf)
    # 4) самопроверка разбором
    types = ['text' if c in ('annotation', 'string_value') else FIXED[c] for c in header_cols]
    st = parse_data(buf, [8], types)
    assert st['rows'] == len(all_rows)
    # 5) сжатие чанками 16 КиБ
    comp = 0
    chunks = 0
    for i in range(0, len(buf), 16384):
        comp += 4 + len(lz4_compress(buf[i:i + 16384])) + 4
        chunks += 1
    n = len(all_rows)
    return dict(typ=typ, variant=variant, period=period_s, window=window_days, rows=n, tags=tags,
                raw=len(buf) / n, lz4=comp / n, compinfo=8 * chunks / n, ratio=comp / len(buf))


def run(jobs, name):
    out = []
    for kw in jobs:
        r = build_sstable(**kw)
        r.update({k: v for k, v in kw.items() if k not in r})
        out.append(r)
        print(name, {k: kw[k] for k in kw if k not in ('n_rows',)}, 'raw=%.2f lz4=%.2f' % (r['raw'], r['lz4']), flush=True)
    from paths import result
    json.dump(out, open(result(name + '.json'), 'w'), indent=1)


if __name__ == '__main__':
    N = 80000
    VARS = [('cur', 1), ('rec', 13), ('unset', 13)]
    PER = [0.1, 1, 10, 60, 600]
    which = sys.argv[1]
    if which == 'base':
        run([dict(typ=t, variant=v, window_days=w, period_s=p, n_rows=N)
             for t in ['DOUBLE', 'FLOAT', 'LONG', 'DATETIME', 'SET', 'STRING'] for v, w in VARS for p in PER], 'grid_base')
    elif which == 'str':
        run([dict(typ='STRING', variant=v, window_days=w, period_s=p, n_rows=N, str_bytes=b)
             for b in [4, 8, 16, 64, 128, 256, 512] for v, w in VARS for p in [1, 10, 60]], 'grid_str')
    elif which == 'ann':
        run([dict(typ='DOUBLE', variant=v, window_days=w, period_s=p, n_rows=N, ann_pct=0.10, ann_bytes=b)
             for b in [16, 64, 128, 256] for v, w in VARS for p in [1, 60]], 'grid_ann')
    elif which == 'win':
        run([dict(typ=t, variant=v, window_days=w, period_s=1, n_rows=N)
             for t in ['DOUBLE', 'STRING'] for v in ['rec', 'unset'] for w in [1, 13, 30, 60]], 'grid_win')
