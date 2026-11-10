import sys, glob, os
sys.path.insert(0, os.path.dirname(__file__))
from sstable_ref import *
from paths import CASSANDRA_SRC
base = os.path.join(CASSANDRA_SRC, 'test/data/legacy-sstables')
for fmt in ['oa', 'da']:
    for tbl, ck in [('simple', []), ('clust', ['text'])]:
        d = f'{base}/{fmt}/legacy_tables/legacy_{fmt}_{tbl}'
        ci_path = glob.glob(d + '/*CompressionInfo.db')[0]
        ci = read_compression_info(ci_path)
        buf, comp = decompress_data(glob.glob(d + '/*Data.db')[0], ci)
        st = parse_data(buf, ck, ['text'])
        # пересжатие нашим путём: тот же размер файла?
        rec = 0
        for i in range(0, len(buf), ci['chunk_len']):
            rec += 4 + len(lz4_compress(buf[i:i + ci['chunk_len']])) + 4
        print(fmt, tbl, ci['name'], ci['chunk_len'], 'chunks', len(ci['offsets']), 'raw', len(buf), 'Data.db', comp, 'recompressed', rec, st)
