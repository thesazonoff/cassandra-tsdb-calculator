/* Адрес приложения, состояние в ссылке, форматирование. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, formatHash } from '../../src/app/router.js';
import { encodeState, decodeState } from '../../src/shared/share.js';
import { plural, nf, fB, esc } from '../../src/shared/format.js';

const PAGES = ['calc', 'fault'];
const guess = p => (p === 'F' ? 'fault' : p === 'C' ? 'calc' : null);

test('адрес: страница и состояние', () => {
  assert.deepEqual(parseHash('#fault&s=abc', PAGES, guess), { page: 'fault', payload: 'abc' });
  assert.deepEqual(parseHash('#calc', PAGES, guess), { page: 'calc', payload: '' });
  assert.deepEqual(parseHash('', PAGES, guess), { page: 'calc', payload: '' });
  assert.deepEqual(parseHash('#unknown&s=x', PAGES, guess), { page: 'calc', payload: 'x' });
});

test('адрес: ссылки 2.0.x без имени страницы определяются по содержимому', () => {
  assert.deepEqual(parseHash('#s=F', PAGES, guess), { page: 'fault', payload: 'F' });
  assert.deepEqual(parseHash('#s=C', PAGES, guess), { page: 'calc', payload: 'C' });
});

test('адрес: формат обратим', () => {
  for (const [p, s] of [['calc', ''], ['fault', 'eyJh'], ['calc', 'a-b_c']]) assert.deepEqual(parseHash(formatHash(p, s), PAGES, guess), { page: p, payload: s });
});

test('состояние в ссылке: кириллица, base64url без «=», совместимость с 2.x', () => {
  const s = { name: 'ДЦ Москва', dcs: [{ rf: 3 }], q: 'a+b/c' };
  const e = encodeState(s);
  assert.match(e, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeState(e), s);
  // кодирование версии 2.x: btoa(unescape(encodeURIComponent(json)))
  const legacy = Buffer.from(JSON.stringify(s), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(e, legacy);
  assert.equal(decodeState('%%%'), null);
});

test('форматирование: склонение, числа, байты, экранирование', () => {
  assert.deepEqual([1, 2, 5, 11, 21, 22, 25, 111].map(n => plural(n, 'нода', 'ноды', 'нод')), ['нода', 'ноды', 'нод', 'нод', 'нода', 'ноды', 'нод', 'нод']);
  assert.equal(nf(NaN), '—');
  assert.equal(nf(1234.5, 1).replace(/\s/g, ' '), '1 234,5');
  assert.equal(fB(1.5e12), '1,5 ТБ');
  assert.equal(esc('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});
