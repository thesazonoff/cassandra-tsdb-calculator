/* Сборка одного автономного HTML: dist/index.html.
 * JS (src/app/main.js) и CSS (src/styles/index.css) собираются esbuild, разметка страниц
 * (src/pages/<страница>/template.html) вставляется в src/index.html. Внешних запросов страница не делает.
 *
 *   node scripts/build.mjs                 dist/index.html
 *   node scripts/build.mjs --out <файл>    другой путь
 *   node scripts/build.mjs --dev           без минимизации, с картой исходников
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dev = args.includes('--dev');
const out = resolve(root, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'dist/index.html');
const BUDGET_KB = 400;                         // предел размера файла, проверяется в CI
const TARGET = ['es2020', 'chrome100', 'edge100', 'firefox100', 'safari15'];
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
const read = p => readFileSync(resolve(root, p), 'utf8');

/** @type {import('esbuild').BuildOptions} */
const common = { bundle: true, write: false, minify: !dev, target: TARGET, legalComments: 'none', logLevel: 'warning' };
const [js, css] = await Promise.all([
  build({ ...common, entryPoints: [resolve(root, 'src/app/main.js')], format: 'iife', sourcemap: dev ? 'inline' : false, define: { __APP_VERSION__: JSON.stringify(version) } }),
  build({ ...common, entryPoints: [resolve(root, 'src/styles/index.css')], loader: { '.css': 'css' } })
]);

const fill = (html, key, value) => {
  if (!html.includes(key)) throw new Error('В src/index.html нет метки ' + key);
  return html.split(key).join(value);
};
let html = read('src/index.html');
html = fill(html, '<!--PAGE:calc-->', read('src/pages/calc/template.html'));
html = fill(html, '<!--PAGE:fault-->', read('src/pages/fault/template.html'));
html = fill(html, '/*STYLES*/', css.outputFiles[0].text.trim());
html = fill(html, '/*SCRIPT*/', js.outputFiles[0].text.trim().replace(/<\/script/gi, '<\\/script'));

// Автономность: никаких внешних скриптов, стилей и шрифтов
const external = html.match(/<(script|link|img|iframe)\b[^>]*(src|href)="(https?:)?\/\/[^"]+"/gi);
if (external) throw new Error('Внешние ресурсы в сборке: ' + external.join(', '));
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dup.length) throw new Error('Повторяющиеся id: ' + [...new Set(dup)].join(', '));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
const kb = Buffer.byteLength(html) / 1024;
console.log(`${out.replace(root + '/', '')}: ${kb.toFixed(0)} КБ, версия ${version}${dev ? ', dev' : ''}`);
if (!dev && kb > BUDGET_KB) { console.error(`Размер ${kb.toFixed(0)} КБ больше бюджета ${BUDGET_KB} КБ`); process.exit(1); }
