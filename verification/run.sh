#!/usr/bin/env bash
# Стенд проверки модели объёма на Apache Cassandra 5.0.9.
#
#   ./run.sh model      эталонная сериализация воспроизводит results/rawcheck.json и сетку сжатия (секунды, без Cassandra)
#   ./run.sh crossval   SSTable, записанные кодом 5.0.9 (CQLSSTableWriter), совпадают с моделью побайтно (~10 мин)
#   ./run.sh server     запущенный сервер 5.0.9: байт на точку Data.db против модели (~15 мин)
#   ./run.sh all        всё по очереди
#
# Нужны: Python 3.10+, системная liblz4 (liblz4.so.1), JDK 17 (javac, java), curl.
# Дистрибутив скачивается с archive.apache.org и сверяется по SHA-512, если не задан CASSANDRA_HOME.
set -euo pipefail
cd "$(dirname "$0")"

VERSION=5.0.9
SHA512=beaf3df6342ef1a0ccc83fa80214f250b32c35cfbb1af591b00e3fd539eef0915bc3b89f0e7ae73f6d50cbb03f6075c4e4cf32d3c46ff9c33f745542fcc925df
WORK=work
export CASSANDRA_HOME="${CASSANDRA_HOME:-$PWD/$WORK/apache-cassandra-$VERSION}"

fetch() {
  [ -x "$CASSANDRA_HOME/bin/cassandra" ] && return
  mkdir -p "$WORK"
  local tgz="$WORK/apache-cassandra-$VERSION-bin.tar.gz"
  [ -f "$tgz" ] || curl -fsSL -o "$tgz" "https://archive.apache.org/dist/cassandra/$VERSION/apache-cassandra-$VERSION-bin.tar.gz"
  echo "$SHA512  $tgz" | sha512sum -c -
  tar -xzf "$tgz" -C "$WORK"
}

build_java() {
  mkdir -p "$WORK/java"
  javac -nowarn -cp "$CASSANDRA_HOME/lib/*" -d "$WORK/java" java/*.java
  (cd "$WORK/java" && jar cf fastclock.jar FastClock.class MapClock.class)
}

model() {
  python3 -I rawcheck.py
  python3 -I assemble.py > /dev/null
  git diff --exit-code -- results/rawcheck.json ../src/core/data/comp-grid.json
  echo "Модель: rawcheck.json и comp-grid.json воспроизведены без изменений"
}

crossval() { fetch; build_java; python3 -I crossval.py; }
server() { fetch; build_java; python3 -I e2e_server.py; }

case "${1:-all}" in
  model) model ;;
  crossval) crossval ;;
  server) server ;;
  all) model; crossval; server ;;
  *) echo "Использование: $0 [model|crossval|server|all]" >&2; exit 2 ;;
esac
