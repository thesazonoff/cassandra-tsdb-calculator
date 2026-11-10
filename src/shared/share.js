/* Состояние расчёта в адресе страницы: JSON → UTF-8 → base64url без «=». */

/** @param {unknown} state */
export function encodeState(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {string} text @returns {any} null, если строка не разбирается */
export function decodeState(text) {
  try {
    const bin = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    return null;
  }
}
