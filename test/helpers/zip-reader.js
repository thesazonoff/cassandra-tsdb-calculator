/* Чтение ZIP (метод STORE) для проверок: центральный каталог, локальные заголовки, данные. */
import assert from 'node:assert/strict';

/** Читает центральный каталог ZIP и возвращает записи с данными (метод STORE). */
export function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  assert.ok(e >= 0, 'нет записи конца центрального каталога');
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50, 'сигнатура записи каталога');
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
    assert.equal(dv.getUint32(local, true), 0x04034b50, 'сигнатура локального заголовка ' + name);
    const lnl = dv.getUint16(local + 26, true), lxl = dv.getUint16(local + 28, true);
    const data = u8.subarray(local + 30 + lnl + lxl, local + 30 + lnl + lxl + size);
    out.push({ name, crc, data });
    p += 46 + nl + xl + cl;
  }
  return out;
}
