/* Выгрузки страницы «Системные требования»: ZIP конфигурации, Excel, сценарий JSON. Без DOM: возвращают байты и имена. */
import * as E from '../../core/sizing.js';
import { configs } from '../../core/sizing-config.js';
import { zip } from '../../export/zip.js';
import { xlsx } from '../../export/xlsx.js';
import { APP_VERSION } from '../../app/version.js';
import { stamp } from '../../shared/format.js';
import { VN, drivesStr } from './views/common.js';

/** Файлы конфигурации выбранного варианта + README, переводы строк Windows. */
export function configZip(R, VAR) {
  const v = R.variants[VAR], files = configs(R, v).map(f => ({ name: f.file, data: f.text.replace(/\n/g, '\r\n') }));
  files.push({ name: 'README.txt', data: `Конфигурация Apache Cassandra ${E.CASSANDRA_VERSION} для TSDB MES, вариант «${VN[VAR]}».\r\nНода: ${v.chosen.p.c} ядер, ${v.chosen.p.ram} ГБ RAM, ${drivesStr(v.node)}. Нод: ${v.Ntotal}.\r\nПараметры cassandra.yaml вносятся в conf/cassandra_latest.yaml дистрибутива.\r\nСформировано калькулятором TSDB Cassandra ${APP_VERSION}, ${stamp()}.\r\n` });
  return { name: `cassandra-config-${stamp()}.zip`, data: zip(files) };
}

/** Книга Excel: итог по трём вариантам, диск ноды, группы тегов, проверки, исходные данные. */
export function sizingXlsx(R, S, VAR) {
  const ks = ['cur', 'rec', 'unset'], V = ks.map(k => R.variants[k]);
  const GB = b => Math.round(b / 1e9 * 10) / 10;
  const sum = [['Показатель', ...ks.map(k => VN[k])],
    ['Режим', ...V.map(() => R.standalone ? 'Одна нода' : 'Кластер')], ['RF по ДЦ', ...V.map(() => R.rep.dcs.map(d => d.rf).join('/'))],
    ['Запись CL', ...V.map(() => R.rep.wcl)], ['Чтение CL', ...V.map(() => R.rep.rcl)], ['Сжатие', ...V.map(() => S.comp === 'none' ? 'без сжатия' : 'LZ4')],
    ['Нод всего', ...V.map(v => v.Ntotal)], ['Ядер на ноду', ...V.map(v => v.chosen.p.c)], ['RAM на ноду, ГБ', ...V.map(v => v.chosen.p.ram)], ['Heap, ГБ', ...V.map(v => v.node.ram.heap)],
    ['Тегов', ...V.map(() => R.tags)], ['Точек/с', ...V.map(() => Math.round(R.P))],
    ['Байт на точку, LZ4', ...V.map(v => +(v.lz4.day / (R.P * 86400)).toFixed(2))], ['Байт на точку без сжатия', ...V.map(v => +(v.none.day / (R.P * 86400)).toFixed(2))],
    ['Данные одной копии, ГБ', ...V.map(v => GB(v.L))], ['backups/, ГБ', ...V.map(v => GB(v.B))],
    ['Data-диск на ноду, ГБ', ...V.map(v => GB(v.node.reqData))], ['Накопители data', ...V.map(v => drivesStr(v.node))], ['Заполнение не выше, %', ...V.map(v => Math.round(v.node.fillLimit * 100))],
    ['Commitlog, ГБ', ...V.map(v => Math.round(v.node.commitlog.drive * 1000))], ['ОС (2 диска RAID 1), ГБ', ...V.map(v => Math.round(v.node.os.drive * 1000))]];
  const v = R.variants[VAR], n = v.node;
  const disk = [['Компонент на ноду, ГБ', 'Значение'], ['Данные', GB(n.live)], ['Запас compaction', GB(n.head)], ['Repair', GB(n.repair)], ['Snapshot', GB(n.snapRes)], ['Snapshot после TRUNCATE', GB(n.autoSnap)], ['Hints', GB(n.hints)], ['incremental backups', GB(n.backups)], ['Итого', GB(n.reqData)]];
  const grp = [['Тип', 'Тегов', 'Период, с', 'Точек/с']].concat(R.groups.map(g => [g.type, g.count, g.period, +g.pps.toFixed(3)]));
  const ck = [['Уровень', 'Раздел', 'Проверка', 'Описание', 'Что сделать']].concat(R.checks.map(c => [{ crit: 'Критично', warn: 'Внимание', info: 'К сведению', ok: 'Норма' }[c.sev], c.scope, c.title, c.text, c.fix]));
  const inp = [['Параметр', 'Значение'], ['Развёртывание', R.standalone ? 'Одна нода' : 'Кластер'], ['Глубина хранения, сут', R.ret], ['Рост тегов, %/год', +S.growth], ['Горизонт, лет', +S.years], ['Длина STRING', +S.strLen], ['Аннотации, % точек', +S.annPct], ['Длина аннотации', +S.annLen],
    ['Дата-центров', R.rep.dcs.length], ['Допустимых отказов', R.F], ['Пользователей', +S.users], ['Профиль', E.USAGE[S.usage] ? E.USAGE[S.usage].label : 'Свой'], ['Накопители', E.DISK[S.disk].label], ['RAID', E.RAIDS[S.raid].label], ['Калибровка', R.calib.valid && R.calib.on ? 'k = ' + R.calib.k.toFixed(3) : 'нет']];
  return xlsx([{ name: 'Итог', rows: sum, widths: [34, 22, 22, 30] }, { name: 'Диск ноды (' + (VAR === 'cur' ? 'текущая' : 'рекоменд.') + ')', rows: disk, widths: [30, 14] }, { name: 'Группы тегов', rows: grp, widths: [12, 10, 10, 10] }, { name: 'Проверки', rows: ck, widths: [12, 18, 40, 70, 60] }, { name: 'Исходные данные', rows: inp, widths: [30, 24] }]);
}

export const xlsxName = () => `cassandra-sizing-${stamp()}.xlsx`;

/** Сценарий для сохранения и повторной загрузки. */
export const scenarioJson = S => JSON.stringify({ app: 'mes-cassandra-calc', version: APP_VERSION, state: S }, null, 2);
export const scenarioName = () => `cassandra-scenario-${stamp()}.json`;
