/* Файлы конфигурации для страницы отказоустойчивости: CQL keyspace, cassandra.yaml по DC,
 * cassandra-rackdc.properties по нодам, драйвер, команды проверки. Вход: результат compute() из fault.js. */
function configs(o) {
  const T = o.T, st = o.st; const files = [];
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  const ksName = /^[a-z_][a-z0-9_]*$/.test(st.ks) ? st.ks : q(st.ks);
  const repl = T.dcs.filter(d => d.rf > 0).map(d => "'" + d.name + "': " + d.rf).join(', ');
  const sysRepl = (cap) => T.dcs.map(d => "'" + d.name + "': " + Math.min(d.N, cap)).join(', ');
  let cql = '-- Keyspace данных\n';
  cql += 'CREATE KEYSPACE IF NOT EXISTS ' + ksName + '\n  WITH replication = {\'class\': \'NetworkTopologyStrategy\', ' + repl + '}\n  AND durable_writes = true;\n\n';
  cql += '-- Для существующего keyspace\n-- ALTER KEYSPACE ' + ksName + ' WITH replication = {\'class\': \'NetworkTopologyStrategy\', ' + repl + '};\n';
  cql += '-- После ALTER с изменением RF: nodetool repair -full ' + st.ks + ' на каждой ноде по очереди.\n\n';
  cql += '-- Системные keyspace: по умолчанию SimpleStrategy (system_auth RF=1, system_distributed RF=3, system_traces RF=2).\n';
  cql += '-- system_auth нужен в каждом DC, иначе вход не работает при отказе ноды или потере связи между DC.\n';
  cql += 'ALTER KEYSPACE system_auth WITH replication = {\'class\': \'NetworkTopologyStrategy\', ' + sysRepl(3) + '};\n';
  cql += 'ALTER KEYSPACE system_distributed WITH replication = {\'class\': \'NetworkTopologyStrategy\', ' + sysRepl(3) + '};\n';
  cql += 'ALTER KEYSPACE system_traces WITH replication = {\'class\': \'NetworkTopologyStrategy\', ' + sysRepl(2) + '};\n';
  cql += '-- Затем на каждой ноде: nodetool repair -full system_auth\n';
  files.push({ name: 'schema.cql', lang: 'cql', title: 'cqlsh', content: cql });

  const seeds = [];
  T.dcs.forEach(dc => {
    const own = [];
    for (const r of dc.racks) { if (own.length >= 3) break; own.push('<IP ' + T.nodes[r.nodes[0]].name + '>'); }
    if (own.length < Math.min(2, dc.N)) own.push('<IP ' + T.nodes[dc.nodes[1]].name + '>');
    seeds.push(...own);
  });
  T.dcs.forEach(dc => {
    let y = '# Фрагмент cassandra.yaml для нод ' + dc.name + ' (за основу взят conf/cassandra_latest.yaml 5.0.9)\n';
    y += "cluster_name: '" + st.cluster.replace(/'/g, "''") + "'\n";
    y += 'endpoint_snitch: GossipingPropertyFileSnitch\n';
    y += 'num_tokens: ' + o.ring.numTokens + '\n';
    if (o.ring.numTokens > 1) y += '# Алгоритм выдачи токенов под RF локального DC (только при первом запуске ноды)\nallocate_tokens_for_local_replication_factor: ' + Math.max(1, Math.min(dc.rf || 3, dc.N)) + '\n';
    else y += '# num_tokens: 1 - задайте initial_token каждой ноде вручную, токены нод DC равномерно по кольцу\n# initial_token: <токен ноды>\n';
    y += 'seed_provider:\n  - class_name: org.apache.cassandra.locator.SimpleSeedProvider\n    parameters:\n      # 2-3 seed из каждого DC, по одному из разных racks; одинаковый список на всех нодах кластера\n      - seeds: "' + seeds.join(',') + '"\n';
    y += 'hinted_handoff_enabled: true\nmax_hint_window: 3h\n';
    y += 'internode_compression: dc\n';
    if (st.lwt) y += 'paxos_variant: v2\n';
    files.push({ name: 'cassandra.yaml — ' + dc.name, lang: 'yaml', title: 'cassandra.yaml', content: y });
  });

  let rk = '# cassandra-rackdc.properties: свой файл на каждой ноде, ниже содержимое по нодам\n';
  T.dcs.forEach(dc => {
    dc.racks.forEach(r => {
      r.nodes.forEach(id => { rk += '\n# ' + T.nodes[id].name + '\ndc=' + dc.name + '\nrack=' + r.name + '\n'; });
    });
  });
  files.push({ name: 'cassandra-rackdc.properties', lang: 'properties', title: 'cassandra-rackdc.properties', content: rk });

  const cdc = T.dcs[o.c].name;
  let drv = '# application.conf, Apache Cassandra Java Driver 4.x (DataStax Java Driver 4.x)\n';
  drv += 'datastax-java-driver {\n';
  drv += '  basic.load-balancing-policy.local-datacenter = "' + cdc + '"\n';
  drv += '  basic.request.consistency = ' + st.rcl + '\n';
  drv += '  basic.request.serial-consistency = ' + (st.lwt ? st.scl : 'LOCAL_SERIAL') + '\n';
  drv += '  profiles {\n    write { basic.request.consistency = ' + st.wcl + ' }\n    read  { basic.request.consistency = ' + st.rcl + ' }\n  }\n}\n';
  drv += '# Профиль выбирается в запросе: statement.setExecutionProfileName("write").\n';
  drv += '# Драйвер 4.x не переключается на другой DC при отказе локального: это решается на уровне приложения.\n';
  files.push({ name: 'application.conf (драйвер)', lang: 'hocon', title: 'application.conf', content: drv });

  let chk = '# Проверка после развёртывания\n';
  chk += 'nodetool status ' + st.ks + '        # колонка "Owns (effective)": доля данных ноды с учётом RF\n';
  chk += 'nodetool describecluster              # одна версия схемы, имена DC\n';
  chk += 'nodetool getendpoints ' + st.ks + ' <таблица> <ключ>   # на каких нодах лежат реплики ключа\n';
  chk += "cqlsh -e \"SELECT keyspace_name, replication FROM system_schema.keyspaces;\"\n";
  files.push({ name: 'Проверка', lang: 'bash', title: 'shell', content: chk });
  return files;
}


export { configs };
