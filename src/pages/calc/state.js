/* Состояние страницы «Системные требования»: значения по умолчанию, слияние, сохранение в браузере. */
import * as E from '../../core/sizing.js';

const LS = 'mes-cass-calc-v2', LS_CMP = 'mes-cass-calc-cmp-v2';

export const clone = x => JSON.parse(JSON.stringify(x));
export const DEF = E.defaultState();

/** Дополняет сохранённый или присланный по ссылке ввод значениями по умолчанию. */
export function merge(base, s) {
  const o = Object.assign(clone(base), s || {});
  o.calib = Object.assign(clone(base.calib), (s && s.calib) || {});
  if (!Array.isArray(o.groups) || !o.groups.length) o.groups = clone(base.groups);
  return o;
}

/** Похож ли объект на ввод этой страницы (для ссылок версии 2.0.x без имени страницы). */
export const isCalcState = s => !!s && Array.isArray(s.groups);

export function loadSaved() { try { const t = localStorage.getItem(LS); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
export function persist(S) { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { /* приватный режим */ } }
export function loadCmp() { try { return JSON.parse(localStorage.getItem(LS_CMP) || '[]'); } catch (e) { return []; } }
export function saveCmp(CMP) { try { localStorage.setItem(LS_CMP, JSON.stringify(CMP)); } catch (e) { /* приватный режим */ } }
