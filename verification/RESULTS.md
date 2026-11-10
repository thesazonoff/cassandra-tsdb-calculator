# Проверка модели на Apache Cassandra 5.0.9

Дистрибутив: apache-cassandra-5.0.9-bin.tar.gz с archive.apache.org, SHA-512 сверен.
JDK в стенде: 21 (Cassandra 5.0 официально поддерживает 11 и 17; формат SSTable от версии JDK не зависит,
серверу нужен -Djava.security.manager=allow).

## 1. Эталонные SSTable из исходников (test/data/legacy-sstables)
oa (BIG) и da (BTI): Data.db разобран целиком, CRC чанков сошлись, пересжатие liblz4 1.9.4 = 8609 и 8616 Б, до байта.

## 2. Код 5.0.9, CQLSSTableWriter (verification/crossval.py, java/W.java + FixedClock)
23 набора по 20 000 строк: 6 типов × (null, TTL + null, TTL + Unset.Value), BIG и BTI, без сжатия, аннотации, период 0,1 с.
Во всех: 0 несовпавших партиций, Data.db модели = Data.db Cassandra побайтно, размер после LZ4 совпал.

## 3. Запущенный сервер 5.0.9 (verification/e2e_server.py, java/L.java + MapClock)
Запись Java-драйвером 3.12.1 из дистрибутива, USING TIMESTAMP, «сейчас» сервера = время записи строки, nodetool flush.
| Тип | Схема | Формат | Cassandra, Б/точка | Модель, Б/точка | Отклонение |
|---|---|---|---|---|---|
| DOUBLE 1 с | null | nb (BIG) | 30,60 | 30,59 | +0,03 % |
| DOUBLE 1 с | TTL + null | nb (BIG) | 35,19 | 35,20 | −0,01 % |
| DOUBLE 1 с | TTL + Unset.Value | nb (BIG) | 18,94 | 18,93 | +0,03 % |
| STRING 10 с | null | nb (BIG) | 27,78 | 27,76 | +0,08 % |
| STRING 10 с | TTL + Unset.Value | nb (BIG) | 19,77 | 19,75 | +0,07 % |
| SET 5 с | TTL + null | nb (BIG) | 41,04 | 41,04 | +0,01 % |
| DOUBLE 1 с | null | da (BTI) | 30,60 | 30,59 | +0,03 % |
| DOUBLE 10 с | TTL + null | da (BTI) | 35,56 | 35,61 | −0,12 % |

## Что исправлено по итогам
- Unset.Value при одном INSERT со всеми колонками: все 8 колонок остаются в заголовке SSTable,
  маска отсутствующих колонок 2 байта (числовые типы) или 1 байт (STRING). Первая версия модели закладывала 1 байт.
- cassandra.yaml по умолчанию в 5.0.9: storage_compatibility_mode: CASSANDRA_4, формат nb, DeletionTime 12 байт на партицию.
  BTI доступен только при storage_compatibility_mode: NONE.
- Служебные файлы SSTable на стенде: Index/Summary/Filter/CompressionInfo ≈ 0,2 % Data.db + десятки байт на партицию,
  Statistics.db ≈ 7 КБ на SSTable. Совпадает с допущением калькулятора.
