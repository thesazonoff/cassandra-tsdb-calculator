/* Файлы конфигурации для варианта сайзинга: cassandra.yaml, CQL, cassandra-rackdc.properties, драйвер C#, JVM, ОС, эксплуатация.
 * Вход: результат compute() из sizing.js и выбранный вариант схемы. Чистые функции без DOM. */
import * as FT from './fault.js';
import { CASSANDRA_VERSION } from './meta.js';
import { M, RAIDS, DISK, num, ftState } from './sizing.js';

function cfgVals(o, v) {
  const n = v.node, p = v.chosen.p, s = o.s;
  const d = n.data.drives;
  return {
    n, p, d, concR: s.disk === 'hdd' ? 16 * Math.max(1, d.n || 1) : s.disk === 'ssd' ? 32 : 64,
    concW: Math.min(128, 8 * p.c), compactors: Math.max(2, Math.min(8, Math.floor(p.c / 4))),
    compTh: { nvme: '256MiB/s', ssd: '128MiB/s', hdd: '32MiB/s' }[s.disk || 'nvme'],
    flushW: s.disk === 'hdd' ? 2 : Math.max(2, Math.min(4, Math.floor(p.c / 8))),
    fillWarn: Math.round(n.fillLimit * 100),
    tombWarn: v.tombPerRow > 0 ? Math.max(1000, Math.ceil(M.page * v.tombPerRow * 1.2 / 1000) * 1000) : 1000,
    hintsMiB: o.standalone ? 0 : Math.max(1024, Math.ceil(n.writes.rawBpsAvg * M.hintWindowSec * 2 / 1048576 / 1024) * 1024)
  };
}
function nodeNames(o, v) {
  const T = FT.buildTopology(ftState(o, v.topo));
  return T;
}
function genYaml(o, v) {
  const c = cfgVals(o, v), s = o.s, n = c.n, T = nodeNames(o, v);
  const jbod = n.data.raid === 'jbod' && c.d.n > 1;
  const dataDirs = jbod ? Array.from({ length: c.d.n }, (_, i) => '  - /mnt/cass-data' + (i + 1) + '/data').join('\n') : '  - /var/lib/cassandra/data';
  const aux = jbod ? '/mnt/cass-data1' : '/var/lib/cassandra';
  const rpo = num(s.rpo, 10);
  let sync;
  if (o.standalone && rpo < 1) sync = 'commitlog_sync: group\ncommitlog_sync_group_window: 15ms';
  else if (o.standalone && rpo < 10) sync = 'commitlog_sync: periodic\ncommitlog_sync_period: ' + Math.max(1, Math.floor(rpo)) * 1000 + 'ms';
  else sync = 'commitlog_sync: periodic\ncommitlog_sync_period: 10000ms';
  const seeds = [];
  T.dcs.forEach(dc => { const own = []; for (const r of dc.racks) { if (own.length >= 3) break; own.push('<IP ' + T.nodes[r.nodes[0]].name + '>'); } if (own.length < Math.min(2, dc.N)) own.push('<IP ' + T.nodes[dc.nodes[1]].name + '>'); seeds.push(...own); });
  const rf0 = Math.max(1, o.rep.dcs[0].rf);
  return `# cassandra.yaml, Apache Cassandra ${CASSANDRA_VERSION}
# Основа: conf/cassandra_latest.yaml из дистрибутива ${CASSANDRA_VERSION}, ниже изменяемые параметры.
# Нода: ${c.p.c} ядер, ${c.p.ram} ГБ RAM, data ${c.d.n || '?'} × ${c.d.size} ТБ ${DISK[n.data.disk].label} ${RAIDS[n.data.raid].label}

cluster_name: 'MES_TSDB'
num_tokens: ${num(s.numTokens, 16)}
allocate_tokens_for_local_replication_factor: ${rf0}
endpoint_snitch: GossipingPropertyFileSnitch
seed_provider:
  - class_name: org.apache.cassandra.locator.SimpleSeedProvider
    parameters:
      - seeds: "${seeds.join(',')}"
listen_address: <IP этой ноды>
rpc_address: <IP этой ноды>

data_file_directories:
${dataDirs}
commitlog_directory: /var/lib/cassandra/commitlog   # отдельный накопитель
hints_directory: ${aux}/hints
saved_caches_directory: ${aux}/saved_caches

${sync}
commitlog_segment_size: 32MiB
commitlog_total_space: ${n.commitlog.totalMiB}MiB

# Новый кластер: формат SSTable 5.0 (как в cassandra_latest.yaml).
# В cassandra.yaml по умолчанию стоит CASSANDRA_4 и пишется формат nb версии 4.x.
storage_compatibility_mode: NONE
sstable:
  selected_format: bti

memtable_allocation_type: offheap_objects
memtable_flush_writers: ${c.flushW}
concurrent_reads: ${c.concR}
concurrent_writes: ${c.concW}
concurrent_compactors: ${c.compactors}
compaction_throughput: ${c.compTh}
stream_throughput_outbound: ${n.rto.recPerSrc}MiB/s

internode_compression: dc
hinted_handoff_enabled: true
max_hint_window: 3h${o.standalone ? '' : '\nmax_hints_size_per_host: ' + c.hintsMiB + 'MiB'}

tombstone_warn_threshold: ${c.tombWarn}
tombstone_failure_threshold: 100000
incremental_backups: false

authenticator: PasswordAuthenticator
authorizer: CassandraAuthorizer
role_manager: CassandraRoleManager
${o.rep.lwt ? 'paxos_variant: v2\n' : ''}
partition_size_warn_threshold: 100MiB
data_disk_usage_percentage_warn_threshold: ${c.fillWarn}
data_disk_usage_percentage_fail_threshold: ${Math.min(95, c.fillWarn + 10)}
`;
}
function genCql(o, v) {
  const repl = o.rep.dcs.filter(d => d.rf > 0).map(d => "'" + d.name + "': " + d.rf).join(', ');
  const sys = o.rep.dcs.map((d, i) => "'" + d.name + "': " + Math.min(3, v.dcs[i].N)).join(', ');
  let t = `-- schema_changes.cql: выполнить в cqlsh на одной ноде
ALTER KEYSPACE "TSDB" WITH replication = {'class': 'NetworkTopologyStrategy', ${repl}};
ALTER KEYSPACE system_auth WITH replication = {'class': 'NetworkTopologyStrategy', ${sys}};
ALTER KEYSPACE system_distributed WITH replication = {'class': 'NetworkTopologyStrategy', ${sys}};
ALTER KEYSPACE system_traces WITH replication = {'class': 'NetworkTopologyStrategy', ${sys}};
-- После изменения RF: nodetool repair --full на каждой ноде по очереди.
`;
  if (v.v.key === 'cur') return t + '\n-- Вариант «Текущая схема»: таблицы не меняются.\n';
  t += `
-- data_points: удаление по TTL вместо внешнего DELETE.
-- default_time_to_live действует на новые записи; внешнюю очистку отключить после истечения срока хранения старых данных.
ALTER TABLE "TSDB".data_points WITH
    default_time_to_live = ${o.ttlSec}
    AND gc_grace_seconds = ${v.v.gcSec}
    AND compaction = {'class': 'org.apache.cassandra.db.compaction.TimeWindowCompactionStrategy',
                      'compaction_window_unit': 'DAYS', 'compaction_window_size': '${v.v.W}',
                      'unchecked_tombstone_compaction': 'true'}
    AND compression = ${o.s.comp === 'none' ? "{'enabled': 'false'}" : "{'class': 'org.apache.cassandra.io.compress.LZ4Compressor', 'chunk_length_in_kb': '16'}"}
    AND incremental_backups = false;

ALTER TABLE "TSDB".snapshots WITH incremental_backups = false;
`;
  return t;
}
function genRack(o, v) {
  const T = nodeNames(o, v);
  let t = '# cassandra-rackdc.properties: свой файл на каждой ноде\n';
  T.dcs.forEach(dc => dc.racks.forEach(r => r.nodes.forEach(id => { t += '\n# ' + T.nodes[id].name + '\ndc=' + dc.name + '\nrack=' + r.name + '\n'; })));
  return t;
}
function genCsharp(o, v) {
  const T = nodeNames(o, v);
  const cps = T.dcs[0].racks.slice(0, 3).map(r => '"<IP ' + T.nodes[r.nodes[0]].name + '>"').join(', ');
  const cl = x => x.split('_').map(w => w[0] + w.slice(1).toLowerCase()).join('');
  return `// DataStax C# Driver for Apache Cassandra (NuGet: CassandraCSharpDriver 3.x)
using Cassandra;

var cluster = Cluster.Builder()
    .AddContactPoints(${cps})
    .WithLoadBalancingPolicy(new TokenAwarePolicy(new DCAwareRoundRobinPolicy("${T.dcs[0].name}")))
    .WithQueryOptions(new QueryOptions()
        .SetConsistencyLevel(ConsistencyLevel.${cl(o.rep.rcl)})
        .SetSerialConsistencyLevel(ConsistencyLevel.${cl(o.rep.scl || 'LOCAL_SERIAL')})
        .SetPageSize(${M.page}))
    .Build();
var session = cluster.Connect("TSDB");

// Запись точки: consistency level записи задаётся на запросе
var insert = session.Prepare(
    "INSERT INTO data_points (partition_id, event_time, double_value, quality_mark_statenumber, annotation) VALUES (?, ?, ?, ?, ?)");
var stmt = insert.Bind(partitionId, eventTime, value, 192, ${v.v.unset ? 'annotation ?? (object)Unset.Value' : 'annotation'})
    .SetConsistencyLevel(ConsistencyLevel.${cl(o.rep.wcl)})
    .SetIdempotence(true);
await session.ExecuteAsync(stmt);
${v.v.unset ? `
// Пустые колонки не передавать: Unset.Value вместо null (протокол v4+).
// Каждый null записывается как tombstone-ячейка и замедляет чтение.` : `
// Сейчас пустые колонки передаются как null: 5 tombstone-ячеек на точку.
// Доработка: Unset.Value вместо null, см. вариант «+ доработка драйвера».`}
// Не задавать USING TIMESTAMP по event_time: дозапись истории попадёт в старые окна TWCS.
`;
}
function genJvm(o, v) {
  const p = v.chosen.p, h = v.node.ram.heap, par = Math.min(p.c, 16);
  return `# conf/jvm-server.options
-Xms${h}G
-Xmx${h}G

# conf/jvm17-server.options (JDK 17, G1GC)
-XX:+UseG1GC
-XX:+ParallelRefProcEnabled
-XX:MaxTenuringThreshold=2
-XX:G1HeapRegionSize=16m
-XX:MaxGCPauseMillis=300
-XX:InitiatingHeapOccupancyPercent=70
-XX:ParallelGCThreads=${par}
-XX:ConcGCThreads=${Math.max(1, Math.floor(par / 4))}
`;
}
function genOs(o, v) {
  const n = v.node, raid = n.data.raid, d = n.data.drives;
  const dev = raid === 'none' || (raid === 'raid0' && d.n === 1) ? '/dev/nvme1n1' : raid === 'jbod' ? '/dev/nvme1n1' : '/dev/md0';
  return `# Подготовка ОС на каждой ноде (Linux)
# /etc/sysctl.d/60-cassandra.conf
vm.max_map_count = 1048575
vm.swappiness = 1

# swapoff -a и убрать swap из /etc/fstab
# /etc/security/limits.d/cassandra.conf
cassandra - memlock unlimited
cassandra - nofile 1048576
cassandra - nproc 32768

# Transparent Huge Pages
echo never > /sys/kernel/mm/transparent_hugepage/enabled
echo never > /sys/kernel/mm/transparent_hugepage/defrag

# Data-том: XFS, noatime; имена устройств подставить свои (lsblk)
mkfs.xfs ${dev}
${dev}  /var/lib/cassandra  xfs  defaults,noatime  0 0
blockdev --setra ${o.s.disk === 'hdd' ? 64 : 8} ${dev}
`;
}
function genRepair(o, v) {
  if (o.standalone) return '# Одна нода: repair не нужен. Резервная копия раз в сутки:\nnodetool snapshot -t daily_$(date +%F) TSDB\n# выгрузить snapshots/ на внешнее хранилище, затем:\nnodetool clearsnapshot -t daily_$(date +%F) TSDB\n';
  return `# Repair: каждая нода по очереди, раз в неделю
nodetool repair -pr --full TSDB
# snapshots: gc_grace_seconds = 864000, repair чаще 10 суток обязателен.

# Контроль после ввода
nodetool status TSDB
nodetool tablestats TSDB.data_points     # Space used (live), SSTable Compression Ratio
nodetool compactionstats
nodetool tpstats
`;
}
function configs(o, v) {
  return [
    { id: 'yaml', file: 'cassandra.yaml', title: 'основные параметры', text: genYaml(o, v), main: true },
    { id: 'cql', file: 'schema_changes.cql', title: 'ALTER KEYSPACE и ALTER TABLE', text: genCql(o, v), main: true },
    { id: 'cs', file: 'MesCassandra.cs', title: 'подключение из C#', text: genCsharp(o, v), main: true },
    { id: 'rack', file: 'cassandra-rackdc.properties', title: 'dc и rack каждой ноды', text: genRack(o, v) },
    { id: 'jvm', file: 'jvm-options.txt', title: 'heap и GC', text: genJvm(o, v) },
    { id: 'os', file: 'os-checklist.sh', title: 'подготовка сервера', text: genOs(o, v) },
    { id: 'ops', file: 'repair-and-monitoring.sh', title: 'эксплуатация', text: genRepair(o, v) }
  ];
}

export { configs };
