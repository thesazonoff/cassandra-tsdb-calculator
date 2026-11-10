# История изменений

Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии по [SemVer](https://semver.org/lang/ru/).

## [2.1.0-rc.1] — 2026-11-10

### Добавлено
- Две страницы, переключаются вверху: «Системные требования» (калькулятор 2.0.1) и «Отказоустойчивость» (отдельный калькулятор отказоустойчивости Cassandra 5.0).
- Ссылка на расчёт запоминает открытую страницу; ссылки версии 2.0.1 продолжают открываться.

## [2.0.1] — 2026-11-09

### Исправлено
- Вариант с `Unset.Value`: маска отсутствующих колонок 2 байта для числовых типов (проверено на сервере Cassandra 5.0.9).
- Учтён заголовок партиции формата nb, который Cassandra 5.0.9 пишет с `cassandra.yaml` по умолчанию.

### Изменено
- В генерируемый `cassandra.yaml` для нового кластера добавлены `storage_compatibility_mode: NONE` и формат SSTable BTI.

## [2.0] — 2026-11-09

### Добавлено
- Объём на диске по формату строк SSTable Cassandra 5.0.9 со сжатием LZ4, сравнение с хранением без сжатия.
- Калибровка по выводу `nodetool tablestats`.
- Расчёт отказоустойчивости: стойки, несколько ДЦ, схема отказов, вероятность при случайных отказах.
- Третий вариант схемы: доработка драйвера C# (`Unset.Value` вместо `null`).
- Конфигурация драйвера C# и `cassandra-rackdc.properties` на каждую ноду.
- Экспорт в Excel, архив конфигов и PDF без интернета.

### Изменено
- Упрощён ввод: профиль пользователей одним выбором, параметры для архитектора свёрнуты.

## [1.0] — 2026-10-20

### Добавлено
- Первая версия: сайзинг кластера по группам тегов, RF и consistency level, диски по ролям, фрагменты конфигурации.

[2.1.0-rc.1]: https://github.com/thesazonoff/cassandra-tsdb-calculator/releases/tag/v2.1.0-rc.1
[2.0.1]: https://github.com/thesazonoff/cassandra-tsdb-calculator/releases/tag/v2.0.1
[2.0]: https://github.com/thesazonoff/cassandra-tsdb-calculator/blob/main/CHANGELOG.md#20--2026-11-09
[1.0]: https://github.com/thesazonoff/cassandra-tsdb-calculator/blob/main/CHANGELOG.md#10--2026-10-20
