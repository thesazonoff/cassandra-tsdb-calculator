/* ZIP и XLSX: контрольная сумма, структура архива, экранирование XML. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, zip } from '../../src/export/zip.js';
import { xlsx } from '../../src/export/xlsx.js';
import { readZip } from '../helpers/zip-reader.js';

test('CRC32 эталонного значения 123456789', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')).toString(16), 'cbf43926');
});

test('ZIP: записи, кириллица в данных, вложенные пути и CRC', () => {
  const entries = readZip(zip([{ name: 'a.txt', data: 'привет' }, { name: 'b/c.txt', data: 'x' }]));
  assert.deepEqual(entries.map(x => x.name), ['a.txt', 'b/c.txt']);
  assert.equal(new TextDecoder().decode(entries[0].data), 'привет');
  for (const x of entries) assert.equal(crc32(x.data), x.crc, x.name);
});

test('XLSX: обязательные части пакета и экранирование значений', () => {
  const entries = readZip(xlsx([{ name: 'Итог', rows: [['Показатель', 'Значение'], ['Нод', 9], ['Текст & <теги>', 'ок']], widths: [20, 10] }]));
  const names = entries.map(x => x.name);
  for (const n of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(names.includes(n), n);
  const sheet = new TextDecoder().decode(entries.find(x => x.name === 'xl/worksheets/sheet1.xml').data);
  assert.ok(sheet.includes('Текст &amp; &lt;теги&gt;'));
  assert.ok(!sheet.includes('<теги>'));
  assert.match(sheet, /<c r="B2"[^>]*><v>9<\/v><\/c>/);
});
