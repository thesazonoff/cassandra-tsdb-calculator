"""Сквозная проверка на запущенном сервере Apache Cassandra 5.0.9.

Сервер работает на ускоренных часах (FastClock), строки пишутся Java-драйвером 3.12.1 из дистрибутива
с USING TIMESTAMP в темпе этих часов, затем nodetool flush. Так EncodingStats SSTable считаются
по данным memtable, а local deletion time и истечение TTL распределены по окну TWCS, как в эксплуатации.
Сравнение: байт на точку Data.db Cassandra против модели калькулятора (минимумы = начало окна).
"""
import glob, json, os, shutil, socket, struct, subprocess, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from crossval import gen_rows, model_partitions, COLS, DDL
from sstable_ref import lz4_compress
from paths import CASSANDRA_HOME, JAVA_BUILD, WORK, result

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = CASSANDRA_HOME
SRV = os.path.join(WORK, 'srv')
GO = SRV + '/mapclock.bin'
T0 = 1792050000000


def prepare(fmt):
    if not os.path.exists(SRV):
        shutil.copytree(DIST, SRV, symlinks=True)
        shutil.copy(os.path.join(JAVA_BUILD, 'fastclock.jar'), SRV + '/lib/')
    y = open(DIST + '/conf/cassandra.yaml').read()
    rep = {
        "# data_file_directories:\n#     - /var/lib/cassandra/data": "data_file_directories:\n    - %s/data/data" % SRV,
        "# commitlog_directory: /var/lib/cassandra/commitlog": "commitlog_directory: %s/data/commitlog" % SRV,
        "# saved_caches_directory: /var/lib/cassandra/saved_caches": "saved_caches_directory: %s/data/saved_caches" % SRV,
        "# hints_directory: /var/lib/cassandra/hints": "hints_directory: %s/data/hints" % SRV,
        "# cdc_raw_directory: /var/lib/cassandra/cdc_raw": "cdc_raw_directory: %s/data/cdc_raw" % SRV,
    }
    for a, b in rep.items():
        assert a in y, a
        y = y.replace(a, b)
    if fmt == 'bti':
        assert "#sstable:\n#  selected_format: big" in y
        y = y.replace("#sstable:\n#  selected_format: big", "sstable:\n  selected_format: bti")
        assert "\nstorage_compatibility_mode: CASSANDRA_4" in y
        y = y.replace("\nstorage_compatibility_mode: CASSANDRA_4", "\nstorage_compatibility_mode: NONE")
    open(SRV + '/conf/cassandra.yaml', 'w').write(y)


def port_open(p):
    s = socket.socket(); s.settimeout(0.5)
    try: s.connect(('127.0.0.1', p)); return True
    except OSError: return False
    finally: s.close()


def stop():
    subprocess.run("pkill -9 -f CassandraDaemon", shell=True)
    for _ in range(60):
        if not port_open(9042) and not port_open(7199): break
        time.sleep(1)
    time.sleep(2)


def start(speed):
    stop()
    shutil.rmtree(SRV + '/data', ignore_errors=True)
    if os.path.exists(GO): os.remove(GO)
    # сервер запускается из копии SRV (в её lib/ лежат часы стенда), а не из CASSANDRA_HOME
    env = dict(os.environ, CASSANDRA_HOME=SRV, CASSANDRA_CONF=SRV + '/conf', MAX_HEAP_SIZE='1G', HEAP_NEWSIZE='200M', CASSANDRA_LOG_DIR=SRV + '/logs',
               JVM_EXTRA_OPTS='-Dcassandra.clock=MapClock -Dfastclock.t0=%d -Dfastclock.speed=%s -Dmapclock.file=%s -Dcassandra.skip_wait_for_gossip_to_settle=0 -Djava.security.manager=allow' % (T0, speed, GO))
    subprocess.run([SRV + '/bin/cassandra', '-R'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(240):
        if port_open(9042): return
        time.sleep(1)
    raise RuntimeError('сервер не стартовал: ' + open(SRV + '/logs/system.log').read()[-3000:])


def run(typ, variant, period, n, speed, fmt='big', **kw):
    window = 1 if variant == 'cur' else 13
    ttl = 31536000
    parts = gen_rows(typ, variant, period, window, n, **kw)
    # якорная партиция: данные с самого начала окна, как в эксплуатации
    anchor = gen_rows(typ, variant, period, window, 1, seed=99)[0]
    ev0 = T0
    k, rows = anchor
    parts.append((b'm1.' + str(T0).encode(), [(ev0 + i * int(period * 1000), (ev0 + i * int(period * 1000)) * 1000 + 3000, rows[0][2]) for i in range(3)]))
    allrows = sorted(((wus, key, ev, cells) for key, rs in parts for ev, wus, cells in rs), key=lambda x: x[0])
    work = os.path.join(WORK, 'e2e'); os.makedirs(work, exist_ok=True)
    rf = os.path.join(work, 'rows.tsv')
    with open(rf, 'w') as f:
        for wus, key, ev, cells in allrows:
            vals = [key.hex(), struct.pack('>q', ev).hex()] + [cells[c].hex() if c in cells else ('U' if variant == 'unset' else 'N') for c in COLS]
            f.write('%d\t%s\n' % (wus, '\t'.join(vals)))
    ddl = (DDL % ("{'class': 'LZ4Compressor', 'chunk_length_in_kb': '16'}", ttl if variant != 'cur' else 0)).replace(
        "'compaction_window_unit': 'DAYS'}", "'compaction_window_unit': 'DAYS', 'enabled': 'false'}")
    open(os.path.join(work, 'ddl.cql'), 'w').write(ddl)
    start(speed)
    cp = JAVA_BUILD + ':' + DIST + '/lib/*'
    r = subprocess.run(['java', '-cp', cp, 'L', rf, os.path.join(work, 'ddl.cql'), GO, str(T0), str(speed)], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr[-3000:])
    lag = r.stdout.strip().splitlines()[-1]
    subprocess.run([SRV + '/bin/nodetool', 'flush', 'TSDB', 'data_points'], check=True, capture_output=True)
    d = glob.glob(SRV + '/data/data/TSDB/data_points-*')[0]
    files = {os.path.basename(x).split('-')[-1]: os.path.getsize(x) for x in glob.glob(d + '/*') if os.path.isfile(x)}
    stop()
    nrows = len(allrows)
    # модель: минимумы от начала окна (как в калькуляторе), заголовок из реально записанных колонок
    unset = variant == 'unset'; use_ttl = variant != 'cur'
    min_ts = min(x[0] for x in allrows)
    nows = [x[0] // 1000000 for x in allrows]
    min_ldt = min(nows) if not unset else (min(nows) + ttl if use_ttl else 0)
    present = set(c for x in allrows for c in x[3])
    header = COLS   # заголовок по всем колонкам INSERT, в том числе при Unset.Value
    mod = model_partitions(parts, variant, ttl, min_ts, min_ldt, ttl, header)
    raw = b''.join(mod.values())
    lz = sum(4 + len(lz4_compress(raw[i:i + 16384])) + 4 for i in range(0, len(raw), 16384))
    aux = sum(v for k, v in files.items() if k not in ('Data.db',))
    return dict(typ=typ, variant=variant, fmt=fmt, period=period, rows=nrows, partitions=len(parts), lag=lag,
                cass_data=files.get('Data.db'), model_lz4=lz, model_raw=len(raw),
                cass_bpp=files['Data.db'] / nrows, model_bpp=lz / nrows, dev=files['Data.db'] / lz - 1, aux=aux, files=files)


if __name__ == '__main__':
    out = []
    jobs = [('DOUBLE', 'cur', 1, 20000, 1000, 'big'), ('DOUBLE', 'rec', 1, 20000, 15000, 'big'), ('DOUBLE', 'unset', 1, 20000, 15000, 'big'),
            ('STRING', 'cur', 10, 20000, 1000, 'big'), ('SET', 'rec', 5, 20000, 15000, 'big'), ('DOUBLE', 'cur', 1, 20000, 1000, 'bti')]
    last_fmt = None
    for typ, variant, per, n, speed, fmt in jobs:
        if fmt != last_fmt: prepare(fmt); last_fmt = fmt
        t = time.time()
        r = run(typ, variant, per, n, speed, fmt)
        out.append(r)
        print('%-7s %-5s %s per=%-3s rows=%d Cassandra=%.2f Б/т модель=%.2f Б/т отклонение=%+.2f%% служебные=%d Б (%s) %.0f с' % (
            typ, variant, fmt, per, r['rows'], r['cass_bpp'], r['model_bpp'], r['dev'] * 100, r['aux'], r['lag'], time.time() - t), flush=True)
    json.dump(out, open(result('e2e_server.json'), 'w'), indent=1)
    worst = max(abs(r['dev']) for r in out)
    print('Наибольшее отклонение модели от Cassandra: %.2f %%' % (worst * 100))
    sys.exit(1 if worst > 0.005 else 0)
