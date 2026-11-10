# Проверка модели объёма на Apache Cassandra 5.0.9

Калькулятор считает байты на точку `"TSDB".data_points` по формату SSTable Cassandra 5.0.9. Эта папка доказывает, что модель совпадает с настоящей Cassandra, и воспроизводит данные, на которых модель построена.

## Запуск

```bash
./run.sh model      # секунды, без Cassandra: эталон воспроизводит results/rawcheck.json и src/core/data/comp-grid.json
./run.sh crossval   # SSTable, записанные кодом 5.0.9, совпадают с моделью побайтно
./run.sh server     # запущенный сервер 5.0.9: байт на точку против модели, допуск 0,5 %
./run.sh all
```

Нужны Python 3.10+, системная `liblz4.so.1`, JDK 17 и curl. Дистрибутив `apache-cassandra-5.0.9-bin.tar.gz` скачивается с archive.apache.org в `work/` и сверяется по SHA-512. Чтобы взять уже распакованный дистрибутив, задайте `CASSANDRA_HOME`.

В CI шаг `model` выполняется на каждом push. `crossval` и `server` запускаются вручную: Actions → «Проверка на Cassandra 5.0.9» → Run workflow.

## Что проверяется

| Уровень | Как | Результат |
|---|---|---|
| Формат | Эталонные SSTable из исходников 5.0.9 (`test/data/legacy-sstables`, форматы oa и da) разобраны целиком, пересжаты liblz4 | Совпадение до байта |
| Код Cassandra | 23 набора по 20 000 строк записаны `CQLSSTableWriter` из apache-cassandra-5.0.9.jar: 6 типов × (null, TTL + null, TTL + Unset.Value), BIG и BTI, без сжатия, аннотации, период 0,1 с | 0 несовпавших партиций, Data.db модели = Data.db Cassandra побайтно |
| Сервер | Запущенный сервер 5.0.9, запись Java-драйвером с `USING TIMESTAMP`, `nodetool flush` | Отклонение от −0,12 % до +0,08 % |

Подробные таблицы: [RESULTS.md](RESULTS.md).

## Файлы

| Файл | Назначение |
|---|---|
| `run.sh` | Точка входа: скачивание дистрибутива, сборка Java, запуск проверок |
| `paths.py` | Пути стенда, переопределяются `CASSANDRA_HOME`, `CASSANDRA_SRC` |
| `sstable_ref.py` | Эталонная модель формата: разбор Data.db и CompressionInfo.db, сериализация строк, LZ4 через системную liblz4 1.9.4 |
| `measure.py` | Замер байт на точку без сжатия и с LZ4 16 КиБ по сетке типов, вариантов схемы и периодов → `results/grid_*.json` |
| `assemble.py` | Сборка сетки сжатия для калькулятора `src/core/data/comp-grid.json` из `results/grid_*.json` |
| `rerun_unset.py` | Пересчёт сетки для варианта с Unset.Value |
| `rawcheck.py` | Средний размер строки до сжатия → `results/rawcheck.json`; с ним сверяется `src/core/size.js` в unit-тестах |
| `crossval.py` | Сверка с `CQLSSTableWriter` 5.0.9 → `results/crossval.json` |
| `e2e_server.py` | Сверка с запущенным сервером 5.0.9 → `results/e2e_server.json` |
| `verify_legacy.py` | Разбор эталонных SSTable из исходников (нужен `CASSANDRA_SRC`) |
| `java/W.java` | Запись строк через `CQLSSTableWriter` |
| `java/L.java` | Загрузка строк в сервер Java-драйвером 3.12.1 из дистрибутива |
| `java/FixedClock.java`, `FastClock.java`, `MapClock.java` | Часы Cassandra для воспроизводимых меток времени и TTL |
| `results/` | Зафиксированные результаты замеров; unit-тесты калькулятора читают `rawcheck.json` и `grid_base.json` |

`work/` создаётся при запуске и в git не попадает.
