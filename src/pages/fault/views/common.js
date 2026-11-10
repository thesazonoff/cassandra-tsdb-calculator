/* Общие элементы представлений страницы «Отказоустойчивость».
 * Представление: чистая функция от результата fault.compute (o) и вспомогательного состояния, возвращает HTML. */
import * as C from '../../../core/fault.js';

export const pct = x => C.pct(x);
/** Проценты для вероятностей: «<0,1%» вместо нуля для малых значений. */
export const pctP = x => { const v = x * 100; if (v === 0) return '0%'; if (v < 0.1) return '<0,1%'; return (v >= 10 ? v.toFixed(0) : v.toFixed(1)).replace('.', ',') + '%'; };
export function tolText(v) { if (v < 0) return '<span class="bad-t">недоступно</span>'; return String(v); }
export function clampInt(v, lo, hi) { v = Math.floor(+v); if (!isFinite(v)) v = lo; return Math.max(lo, Math.min(hi, v)); }
