/* Вкладка «Методика»: байт на точку по типам и вариантам, как получена и проверена модель. */
import * as E from '../../../core/sizing.js';
import * as SZ from '../../../core/size.js';
import { esc, nf } from '../../../shared/format.js';

export function paneMet(ctx) {
  const { R, VAR } = ctx;
  const v = R.variants[VAR];
  const rows = E.TYPE_ORDER.filter(t => R.byType[t]).map(t => {
    const gr = R.groups.find(g => g.type === t);
    const pp = { type: t, period: gr.period, strBytes: t === 'STRING' ? R.strBytes : 0, annPct: 0, annBytes: 0, windowDays: v.v.W, ttlSec: R.ttlSec };
    return `<tr><th scope="row">${t}</th><td>${esc(E.TYPE_COL[t])}</td><td class="r">${nf(R.byType[t].tags)}</td>${['cur', 'rec', 'unset'].map(k => { const ppk = Object.assign({}, pp, { windowDays: R.variants[k].v.W }); return `<td class="r">${nf(SZ.rowRaw(ppk, k), 1)} / ${nf(SZ.pointBytes(ppk, k, 'lz4').disk, 1)}</td>`; }).join('')}</tr>`;
  }).join('');
  return `<div class="block"><h3>Размер точки на диске</h3><div class="tbl-wrap"><table class="t"><thead><tr><th>Тип</th><th>Колонка</th><th class="r">Тегов</th><th class="r">Текущая схема</th><th class="r">Рекомендации</th><th class="r">+ драйвер</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">Байт на точку без сжатия / с LZ4, без аннотаций, при периоде первой группы этого типа.</p></div>
  <div class="prose">
    <p><b>Как получены байты на точку.</b> Строка <code>data_points</code> сериализуется по правилам Cassandra 5.0.9 (UnfilteredSerializer, Cell.Serializer): флаги, clustering <code>event_time</code>, метка записи, TTL, ячейки. Каждый явный <code>null</code> записывается tombstone-ячейкой, пустая <code>annotation</code> ячейкой без значения. Поток Data.db режется на чанки 16 КиБ и сжимается LZ4 (4 байта длины + блок + CRC32), как CompressedSequentialWriter.</p>
    <p><b>Проверка на Cassandra 5.0.9.</b> Модель сверена с официальным дистрибутивом 5.0.9 тремя способами. Эталонные SSTable из исходников (форматы oa и da) разобраны целиком, пересжатие совпало до байта. 23 набора строк записаны кодом 5.0.9 (CQLSSTableWriter): Data.db совпал с моделью побайтно по каждой партиции, включая tombstone от null, TTL, Unset.Value, BIG, BTI и таблицу без сжатия. 9 наборов записаны в запущенный сервер 5.0.9 через драйвер с последующим nodetool flush: байт на точку совпал с моделью в пределах 0,12 %.</p>
    <p><b>Профиль значений.</b> Сжатие рассчитано на типовом профиле: 30 % неизменных значений у аналоговых тегов, 95 % у дискретных, 20 разных строк у STRING. Фактическое сжатие у заказчика уточняется во вкладке «Калибровка».</p>
    <p><b>Unset.Value.</b> Если MES оставляет один INSERT со всеми колонками и передаёт Unset.Value, все 8 колонок остаются в заголовке SSTable, и в строке пишется маска отсутствующих колонок: 2 байта для числовых типов, 1 для STRING. Калькулятор считает этот вариант.</p>
    <p><b>Формат SSTable.</b> С cassandra.yaml по умолчанию 5.0.9 работает в storage_compatibility_mode: CASSANDRA_4 и пишет формат nb (12 байт DeletionTime в заголовке партиции вместо 1). На объём данных это почти не влияет.</p>
    <p><b>Объём.</b> Данные одной копии = байт на точку × точек в сутки × (срок хранения + окно TWCS + gc_grace_seconds) × рост тегов. На ноду: × RF / число нод (при стойках разного размера берётся самая загруженная нода). К данным на диске добавляются запас compaction, repair, snapshot, hints и 5 % свободного места файловой системы.</p>
    <p><b>Ноды.</b> Число нод в ДЦ: максимум из RF (не меньше 3), объёма данных на ноду и CPU с запасом на отказ F нод; затем округление до кратного числу стоек. Каждый ДЦ рассчитан на полную нагрузку, чтобы принять MES при отказе другого.</p>
    <p><b>Отказоустойчивость.</b> Требования consistency level как в ConsistencyLevel.blockFor, размещение реплик как в NetworkTopologyStrategy 5.0.9.</p>
    <p><b>Оценки, требующие нагрузочного теста:</b> ${nf(E.M.wpc)} записей/с и ${nf(E.M.qpc)} запросов/с на ядро, задержки p99, время замены ноды.</p>
    <p>Исходный код: <a href="https://github.com/apache/cassandra/tree/cassandra-5.0.9" target="_blank" rel="noopener">apache/cassandra, тег cassandra-5.0.9</a>.</p>
  </div>`;
}
