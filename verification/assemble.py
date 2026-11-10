"""Собирает сетку сжатия для калькулятора (src/core/data/comp-grid.json) из замеров results/grid_*.json."""
import json, collections, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import result, COMP_GRID
base = json.load(open(result('grid_base.json'))); strg = json.load(open(result('grid_str.json'))); ann = json.load(open(result('grid_ann.json')))
PER = [0.1, 1, 10, 60, 600]
VARS = ['cur', 'rec', 'unset']
TYPES = ['DOUBLE', 'FLOAT', 'LONG', 'DATETIME', 'SET', 'STRING']
B = {v: {t: [None]*len(PER) for t in TYPES} for v in VARS}
for r in base:
    B[r['variant']][r['typ']][PER.index(r['period_s'])] = round(r['lz4'], 3)
# STRING по длине (байт): из grid_str + базовая точка 32 байта из grid_base
SB = sorted({r['str_bytes'] for r in strg} | {32})
SP = [1, 10, 60]
S = {}
for v in VARS:
    m = [[None]*len(SP) for _ in SB]
    for r in strg:
        if r['variant'] == v: m[SB.index(r['str_bytes'])][SP.index(r['period_s'])] = round(r['lz4'], 3)
    for j, p in enumerate(SP): m[SB.index(32)][j] = B[v]['STRING'][PER.index(p)]
    S[v] = dict(bytes=SB, periods=SP, lz4=m)
# annotation: прирост на точку с annotation относительно базы DOUBLE того же варианта и периода
AB = sorted({r['ann_bytes'] for r in ann}); AP = [1, 60]
A = {}
for v in VARS:
    m = [[None]*len(AP) for _ in AB]
    for r in ann:
        if r['variant'] == v:
            d = (r['lz4'] - B[v]['DOUBLE'][PER.index(r['period_s'])]) / r['ann_pct']
            m[AB.index(r['ann_bytes'])][AP.index(r['period_s'])] = round(d, 3)
    A[v] = dict(bytes=AB, periods=AP, delta=m)
COMP = dict(src='verification/measure.py, liblz4 1.9.4, LZ4 16 КиБ, профиль значений: медиана', periods=PER, base=B, str=S, ann=A)
json.dump(COMP, open(COMP_GRID, 'w'), ensure_ascii=False)
for v in VARS:
    print(v, {t: B[v][t] for t in TYPES})
    print('  STRING', S[v]['lz4']); print('  ANN', A[v]['delta'])
