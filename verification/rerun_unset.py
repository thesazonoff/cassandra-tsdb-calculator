"""Пересчёт сетки сжатия для варианта unset (заголовок по всем 8 колонкам) с заменой в grid_*.json."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from measure import build_sstable
from paths import result
part = sys.argv[1]
N = 80000
if part == 'base':
    f = result('grid_base.json'); jobs = [dict(typ=t, variant='unset', window_days=13, period_s=p, n_rows=N) for t in ['DOUBLE', 'FLOAT', 'LONG', 'DATETIME', 'SET', 'STRING'] for p in [0.1, 1, 10, 60, 600]]
elif part == 'str':
    f = result('grid_str.json'); jobs = [dict(typ='STRING', variant='unset', window_days=13, period_s=p, n_rows=N, str_bytes=b) for b in [4, 8, 16, 64, 128, 256, 512] for p in [1, 10, 60]]
else:
    f = result('grid_ann.json'); jobs = [dict(typ='DOUBLE', variant='unset', window_days=13, period_s=p, n_rows=N, ann_pct=0.10, ann_bytes=b) for b in [16, 64, 128, 256] for p in [1, 60]]
old = [r for r in json.load(open(f)) if r['variant'] != 'unset']
for kw in jobs:
    r = build_sstable(**kw); r.update({k: v for k, v in kw.items() if k not in r}); old.append(r)
    print(part, kw.get('typ'), kw.get('period_s'), kw.get('str_bytes', kw.get('ann_bytes', '')), 'raw=%.2f lz4=%.2f' % (r['raw'], r['lz4']), flush=True)
json.dump(old, open(f, 'w'), indent=1)
