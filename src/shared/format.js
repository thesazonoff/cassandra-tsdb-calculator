/* Форматирование чисел и текста для русского интерфейса. */

/** Экранирует текст для вставки в HTML. */
export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Число с разделителями разрядов; не число даёт «—». */
export const nf = (x, d = 0) => (Number.isFinite(x) ? Number(x).toLocaleString('ru-RU', { maximumFractionDigits: d }) : '—');

/** Число с точностью по величине: 2 знака до 10, 1 знак до 100. */
export const nfa = x => nf(x, Math.abs(x) < 10 ? 2 : Math.abs(x) < 100 ? 1 : 0);

/** Байты в КБ…ПБ (десятичные). */
export function fB(b) {
  if (!Number.isFinite(b)) return '—';
  if (b >= 1e15) return nf(b / 1e15, 2) + ' ПБ';
  if (b >= 1e12) return nf(b / 1e12, b >= 1e14 ? 0 : 2) + ' ТБ';
  if (b >= 1e9) return nf(b / 1e9, b >= 1e11 ? 0 : 1) + ' ГБ';
  if (b >= 1e6) return nf(b / 1e6, 0) + ' МБ';
  return nf(b / 1e3, 0) + ' КБ';
}
export const fTB = tb => nf(tb, 2) + ' ТБ';
/** Проценты, вход в процентах. */
export const pct = x => nf(x, x < 10 ? 1 : 0) + ' %';
/** Объём накопителя: меньше 1 ТБ в ГБ. */
export const dsz = sz => sz < 1 ? nf(sz * 1000, 0) + ' ГБ' : nf(sz, 2) + ' ТБ';

/** Согласование существительного с числом: 1 нода, 2 ноды, 5 нод. */
export function plural(n, a, b, c) {
  n = Math.abs(Math.round(n)) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return c;
  if (n1 > 1 && n1 < 5) return b;
  if (n1 === 1) return a;
  return c;
}

/** Дата для имён файлов: 2026-11-10. */
export const stamp = () => new Date().toISOString().slice(0, 10);
