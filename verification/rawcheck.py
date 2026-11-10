"""Средний размер строки при равномерном распределении меток по окну: для проверки size.js rowRaw."""
import sys, os, random, struct, json
sys.path.insert(0, os.path.dirname(__file__))
from sstable_ref import _uvsize
rng = random.Random(7)
def row(typ, variant, W, ttl, sb, ann_pct, ab, n=200000):
    span = W * 86400
    tot = 0
    for _ in range(n):
        off_us = rng.randrange(0, span * 1000000)
        off_s = off_us // 1000000
        body = _uvsize(off_us)
        unset = variant == 'unset'
        if variant != 'cur':
            body += 1 + (_uvsize(off_s) if unset else _uvsize(ttl + off_s))
        if unset: body += 1 if typ == 'STRING' else 2
        val = {'DOUBLE': 9, 'FLOAT': 5, 'LONG': 9, 'DATETIME': 9, 'SET': 9}.get(typ) or (1 + _uvsize(sb) + sb)
        body += val + 5
        a = rng.random() < ann_pct
        if a: body += 1 + _uvsize(ab) + ab
        elif not unset: body += 1
        if not unset: body += 5 * (1 + _uvsize(off_s))
        r = 1 + 9 + body
        r += _uvsize(r + 2) * 2
        tot += r
    return tot / n
cases = []
for typ, sb in [('DOUBLE', 0), ('FLOAT', 0), ('STRING', 48), ('STRING', 300)]:
    for variant, W in [('cur', 1), ('rec', 13), ('unset', 13), ('rec', 40)]:
        cases.append(dict(type=typ, variant=variant, windowDays=W, ttlSec=365*86400, strBytes=sb, annPct=0.01, annBytes=128,
                          py=row(typ, variant, W, 365*86400, sb, 0.01, 128)))
from paths import result
json.dump(cases, open(result('rawcheck.json'), 'w'))
print('ok', len(cases))
