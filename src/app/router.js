/* Адрес приложения: #<страница>&s=<состояние>. У каждой страницы своё состояние; при переключении
 * страниц адрес показывает состояние активной. Ссылки версии 2.0.x (#s=...) открывают страницу,
 * которой принадлежит состояние. Модуль не зависит от DOM, кроме location и history. */

/**
 * @param {string} hash location.hash
 * @param {string[]} pages имена страниц, первая по умолчанию
 * @param {(payload: string) => string | null} guess страница по содержимому ссылки без имени страницы
 * @returns {{ page: string, payload: string }}
 */
export function parseHash(hash, pages, guess) {
  const h = String(hash || '').replace(/^#/, '');
  const parts = h.split('&');
  let page = pages.includes(parts[0]) ? parts[0] : '';
  const sPart = parts.find(p => p.startsWith('s='));
  const payload = sPart ? sPart.slice(2) : '';
  if (!page) page = (payload && guess(payload)) || pages[0];
  return { page, payload };
}

/** @param {string} page @param {string} payload */
export const formatHash = (page, payload) => '#' + page + (payload ? '&s=' + payload : '');

/**
 * @param {{ pages: string[], guess: (payload: string) => string | null, onExternal: (page: string, payload: string) => void }} opt
 */
export function createRouter({ pages, guess, onExternal }) {
  const first = parseHash(location.hash, pages, guess);
  /** @type {Record<string, string>} */
  const payloads = Object.fromEntries(pages.map(p => [p, '']));
  payloads[first.page] = first.payload;
  let active = first.page, written = location.hash;
  const base = () => location.href.split('#')[0];
  function write() {
    const h = formatHash(active, payloads[active]);
    written = h;
    try { history.replaceState(null, '', h); } catch (e) { /* file:// в некоторых браузерах */ }
  }
  // Вставили другую ссылку в адресную строку этой вкладки
  window.addEventListener('hashchange', () => {
    if (location.hash === written) return;
    const r = parseHash(location.hash, pages, guess);
    payloads[r.page] = r.payload; active = r.page; written = location.hash;
    onExternal(r.page, r.payload);
  });
  return {
    get active() { return active; },
    /** Сделать страницу активной и показать её состояние в адресе. */
    activate(page) { active = page; write(); },
    /** Интерфейс адреса для страницы. */
    forPage(page) {
      return {
        read: () => payloads[page] || null,
        write: payload => { payloads[page] = payload; if (page === active) write(); },
        link: payload => base() + formatHash(page, payload)
      };
    }
  };
}
