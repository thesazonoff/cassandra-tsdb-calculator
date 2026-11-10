/* Страница «Отказоустойчивость»: ввод топологии и consistency level, расчёт (core/fault.js), вкладки результата.
 * id элементов страницы начинаются с ft-: $('wcl') ищет #ft-wcl. */
import * as C from '../../core/fault.js';
import { configs } from '../../core/fault-config.js';
import { esc, plural } from '../../shared/format.js';
import { toast, copyText, saveFile } from '../../shared/dom.js';
import { encodeState, decodeState } from '../../shared/share.js';
import { runProbTask } from '../../shared/prob.js';
import { PRESETS } from './presets.js';
import { clampInt } from './views/common.js';
import { summaryHtml } from './views/summary.js';
import { failHtml, probParts } from './views/failures.js';
import { schemeHtml, schemeStatusHtml } from './views/scheme.js';
import { dataHtml } from './views/data.js';
import { cfgHtml } from './views/config.js';
import { methodHtml } from './views/method.js';

const PANES = ['sum', 'fail', 'scheme', 'data', 'cfg', 'method'];
export const isFaultState = s => !!s && Array.isArray(s.dcs);

/**
 * @param {HTMLElement} root контейнер страницы (#page-fault)
 * @param {{ url: { read(): string | null, write(s: string): void, link(s: string): string } }} app
 */
export function mountFault(root, app) {
  const $ = id => /** @type {any} */ (document.getElementById('ft-' + id));
  const fromUrl = (() => { const t = app.url.read(); const s = t ? decodeState(t) : null; return isFaultState(s) ? Object.assign(C.defaultState(), s) : null; })();
  let state = fromUrl || C.defaultState();
  let timer = 0, res = null, stopProb = null, failed = new Uint8Array(0), failSig = '', cfgFiles = [];

  /* ---------- ввод ---------- */
  function fillSelect(el, list, val) { el.innerHTML = list.map(v => '<option value="' + v + '"' + (v === val ? ' selected' : '') + '>' + v + '</option>').join(''); }
  function syncControls() {
    fillSelect($('wcl'), C.WRITE_CL, state.wcl);
    fillSelect($('rcl'), C.READ_CL, state.rcl);
    fillSelect($('scl'), C.SERIAL_CL, state.scl);
    $('numTokens').innerHTML = C.TOKEN_CHOICES.map(v => '<option value="' + v + '"' + (+state.numTokens === v ? ' selected' : '') + '>' + v + (v === 16 ? ' (по умолчанию в 5.0)' : '') + '</option>').join('');
    $('tokenMode').value = state.tokenMode;
    $('lwt').checked = !!state.lwt;
    ['dataGB', 'writesPs', 'readsPs', 'rowBytes', 'ks', 'cluster'].forEach(k => { $(k).value = state[k]; });
    syncClientDc(); renderDcs();
    $('sclRow').style.display = state.lwt ? '' : 'none';
    $('seedNote').textContent = 'раскладка №' + state.seed;
  }
  function syncClientDc() {
    if (state.clientDc >= state.dcs.length) state.clientDc = 0;
    $('clientDc').innerHTML = state.dcs.map((d, i) => '<option value="' + i + '"' + (i === state.clientDc ? ' selected' : '') + '>' + esc(d.name || ('DC' + (i + 1))) + '</option>').join('');
    $('clientRow').style.display = state.dcs.length > 1 ? '' : 'none';
  }
  function stepper(f, d, r, val, min, max, label) {
    return '<span class="stepper"><button type="button" data-act="dec" data-f="' + f + '" data-dc="' + d + '" data-rack="' + r + '" aria-label="Уменьшить ' + label + '">−</button>' +
      '<input type="number" inputmode="numeric" min="' + min + '" max="' + max + '" value="' + val + '" data-f="' + f + '" data-dc="' + d + '" data-rack="' + r + '" aria-label="' + label + '">' +
      '<button type="button" data-act="inc" data-f="' + f + '" data-dc="' + d + '" data-rack="' + r + '" aria-label="Увеличить ' + label + '">+</button></span>';
  }
  function dcSummary(d) {
    const dc = state.dcs[d]; const n = dc.racks.reduce((s, x) => s + (+x || 0), 0); const k = dc.racks.filter(x => +x > 0).length;
    return n + ' ' + plural(n, 'нода', 'ноды', 'нод') + ' · ' + k + ' ' + plural(k, 'rack', 'racks', 'racks');
  }
  function renderDcs() {
    const multi = state.dcs.length > 1;
    $('dcList').innerHTML = state.dcs.map((dc, d) => {
      const racks = dc.racks.map((n, r) => '<div class="rack-row"><span>RACK' + (r + 1) + '</span>' + stepper('rack', d, r, n, 1, C.LIMITS.maxNodesPerDc, 'число нод в RACK' + (r + 1) + ' ' + esc(dc.name || '')) + '</div>').join('');
      const total = dc.racks.reduce((s, x) => s + (+x || 0), 0);
      return '<div class="dc-card">' +
        '<div class="dc-head"><input class="name" type="text" value="' + esc(dc.name) + '" data-f="dcname" data-dc="' + d + '" aria-label="Имя DC" maxlength="40">' +
        '<span class="lbl">RF</span>' + stepper('rf', d, -1, dc.rf, multi ? 0 : 1, C.LIMITS.maxRf, 'RF ' + esc(dc.name || '')) +
        (multi ? '<button class="btn sm" type="button" data-act="delDc" data-dc="' + d + '" title="Удалить DC">✕</button>' : '') + '</div>' +
        '<div class="racks">' + racks + '</div>' +
        '<div class="dc-foot"><button class="btn sm" type="button" data-act="addRack" data-dc="' + d + '">+ rack</button>' +
        (dc.racks.length > 1 ? '<button class="btn sm" type="button" data-act="delRack" data-dc="' + d + '">− rack</button>' : '') +
        '<span>поровну</span><input type="number" min="1" max="' + C.LIMITS.maxNodesPerDc + '" value="' + total + '" style="width:56px;border:1px solid var(--line);border-radius:6px;padding:2px 4px" data-f="dist" data-dc="' + d + '" aria-label="Всего нод для распределения">' +
        '<button class="btn sm" type="button" data-act="dist" data-dc="' + d + '">распределить</button>' +
        '<span class="sum" id="ft-dcsum' + d + '">' + dcSummary(d) + '</span></div></div>';
    }).join('');
    $('btnAddDc').disabled = state.dcs.length >= C.LIMITS.maxDc;
  }
  function onDcInput(e) {
    const t = e.target; const f = t.dataset.f; if (!f) return;
    const d = +t.dataset.dc; const dc = state.dcs[d]; if (!dc) return;
    if (f === 'dcname') { dc.name = t.value.trim() || ('DC' + (d + 1)); syncClientDc(); }
    else if (f === 'rf') { if (t.value === '') return; dc.rf = clampInt(t.value, state.dcs.length > 1 ? 0 : 1, C.LIMITS.maxRf); }
    else if (f === 'rack') { if (t.value === '') return; dc.racks[+t.dataset.rack] = clampInt(t.value, 1, C.LIMITS.maxNodesPerDc); const s = $('dcsum' + d); if (s) s.textContent = dcSummary(d); }
    else return;
    schedule();
  }
  function onDcChange(e) { const t = e.target; if (t.dataset.f === 'rf' || t.dataset.f === 'rack') renderDcs(); }
  function onDcClick(e) {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const act = b.dataset.act; const d = +b.dataset.dc; const dc = state.dcs[d]; if (!dc) return;
    const f = b.dataset.f;
    if (act === 'inc' || act === 'dec') {
      const delta = act === 'inc' ? 1 : -1;
      if (f === 'rf') dc.rf = clampInt(dc.rf + delta, state.dcs.length > 1 ? 0 : 1, C.LIMITS.maxRf);
      if (f === 'rack') { const r = +b.dataset.rack; dc.racks[r] = clampInt((+dc.racks[r] || 0) + delta, 1, C.LIMITS.maxNodesPerDc); }
    } else if (act === 'addRack') { if (dc.racks.length < C.LIMITS.maxRacksPerDc) dc.racks.push(1); }
    else if (act === 'delRack') { if (dc.racks.length > 1) dc.racks.pop(); }
    else if (act === 'delDc') { state.dcs.splice(d, 1); if (state.dcs.length === 1 && state.dcs[0].rf < 1) state.dcs[0].rf = 1; syncClientDc(); }
    else if (act === 'dist') {
      const inp = b.parentNode.querySelector('input[data-f=dist]');
      const n = clampInt(inp.value, 1, C.LIMITS.maxNodesPerDc); const k = Math.min(dc.racks.length, n);
      dc.racks = Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
    }
    renderDcs(); schedule();
  }

  /* ---------- расчёт ---------- */
  function saveUrl() { app.url.write(encodeState(state)); }
  function schedule() { clearTimeout(timer); timer = window.setTimeout(update, 120); }
  function update() {
    saveUrl();
    res = C.compute(state);
    if (!res.errors.length) {
      const sig = res.T.nodes.map(n => n.name).join(',');
      if (sig !== failSig || failed.length !== res.T.N) { failed = new Uint8Array(res.T.N); failSig = sig; }
    }
    renderAll();
    startProb();
  }
  function startProb() {
    if (stopProb) { stopProb(); stopProb = null; }
    if (!res || res.errors.length) return;
    const task = C.makeProbTask(res.T, res.ring, res.W, res.R, res.S, { kMax: Math.min(res.T.N, 10), seed: state.seed });
    const r = res;
    stopProb = runProbTask(task, () => {
      if (!$('probChart')) return;
      const p = probParts(task, r);
      $('probLegend').innerHTML = p.legend; $('probChart').innerHTML = p.chart; $('probProg').textContent = p.prog; $('probTable').innerHTML = p.table;
    }, { delayMs: 20 });
  }

  /* ---------- вывод ---------- */
  function renderAll() {
    const box = $('errBox');
    if (res.errors.length) {
      box.innerHTML = '<div class="errors"><b>Расчёт невозможен, исправьте ввод:</b><ul>' + res.errors.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></div>';
      ['sum', 'fail', 'scheme', 'data', 'cfg'].forEach(p => { $('pane-' + p).innerHTML = ''; });
      renderMethod();
      return;
    }
    box.innerHTML = '';
    cfgFiles = configs(res);
    $('pane-sum').innerHTML = summaryHtml(res);
    $('pane-fail').innerHTML = failHtml(res);
    renderScheme();
    $('pane-data').innerHTML = dataHtml(res);
    $('pane-cfg').innerHTML = cfgHtml(cfgFiles);
    renderMethod();
  }
  function renderMethod() { if (!$('pane-method').dataset.done) { $('pane-method').dataset.done = '1'; $('pane-method').innerHTML = methodHtml(); } }
  function renderScheme(randK) { $('pane-scheme').innerHTML = schemeHtml(res, failed, randK); }
  function renderSchemeStatus() { const box = $('schemeStatus'); if (box) box.innerHTML = schemeStatusHtml(res, failed); }
  function onSchemeClick(e) {
    const el = e.target.closest('[data-sact]'); if (!el || !res || res.errors.length) return;
    const a = el.dataset.sact; const T = res.T;
    if (a === 'node') { const id = +el.dataset.node; failed[id] ^= 1; el.classList.toggle('down', !!failed[id]); renderSchemeStatus(); return; }
    if (a === 'rack') { const r = T.racks[+el.dataset.rack]; const every = r.nodes.every(id => failed[id]); r.nodes.forEach(id => { failed[id] = every ? 0 : 1; }); }
    else if (a === 'dc') { const dc = T.dcs[+el.dataset.dc]; const every = dc.nodes.every(id => failed[id]); dc.nodes.forEach(id => { failed[id] = every ? 0 : 1; }); }
    else if (a === 'clear') failed.fill(0);
    else if (a === 'kinc' || a === 'kdec') { const inp = $('randK'); inp.value = clampInt(+inp.value + (a === 'kinc' ? 1 : -1), 1, T.N); return; }
    else if (a === 'rand') {
      const k = clampInt($('randK').value, 1, T.N); failed.fill(0);
      const ids = Array.from({ length: T.N }, (_, i) => i);
      for (let i = 0; i < k; i++) { const j = i + Math.floor(Math.random() * (T.N - i)); const t = ids[i]; ids[i] = ids[j]; ids[j] = t; failed[ids[i]] = 1; }
      renderScheme(k); return;
    }
    renderScheme($('randK') && +$('randK').value);
  }
  function onCfgClick(e) {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.copy != null) copyText(cfgFiles[+b.dataset.copy].content).then(ok => toast(ok ? 'Скопировано' : 'Не удалось скопировать', 1800));
    if (b.dataset.dl != null) {
      const f = cfgFiles[+b.dataset.dl];
      const fname = f.title === 'shell' ? 'check.sh' : f.name.includes('cassandra.yaml') ? 'cassandra.yaml.' + f.name.split('— ')[1] + '.fragment' : f.title;
      saveFile(fname, new Blob([f.content], { type: 'text/plain;charset=utf-8' }));
    }
  }
  function selectTab(name) {
    root.querySelectorAll('#ft-tabs .tab').forEach(t => t.setAttribute('aria-selected', /** @type {HTMLElement} */ (t).dataset.tab === name ? 'true' : 'false'));
    PANES.forEach(p => $('pane-' + p).classList.toggle('on', p === name));
  }

  /* ---------- старт ---------- */
  $('presets').innerHTML = PRESETS.map((p, i) => '<button class="chip" type="button" data-p="' + i + '">' + esc(p.t) + '</button>').join('');
  $('presets').addEventListener('click', e => {
    const b = e.target.closest('[data-p]'); if (!b) return; const p = PRESETS[+b.dataset.p];
    const keep = { ks: state.ks, cluster: state.cluster, dataGB: state.dataGB, writesPs: state.writesPs, readsPs: state.readsPs, rowBytes: state.rowBytes, numTokens: state.numTokens, tokenMode: state.tokenMode };
    state = Object.assign(C.defaultState(), keep, JSON.parse(JSON.stringify(p.s))); syncControls(); update();
  });
  const dl = $('dcList');
  dl.addEventListener('input', onDcInput); dl.addEventListener('change', onDcChange); dl.addEventListener('click', onDcClick);
  $('btnAddDc').addEventListener('click', () => { if (state.dcs.length >= C.LIMITS.maxDc) return; state.dcs.push({ name: 'DC' + (state.dcs.length + 1), rf: 3, racks: [1, 1, 1] }); syncClientDc(); renderDcs(); schedule(); });
  ['wcl', 'rcl', 'scl', 'tokenMode'].forEach(k => $(k).addEventListener('change', e => { state[k] = e.target.value; schedule(); }));
  $('numTokens').addEventListener('change', e => { state.numTokens = +e.target.value; schedule(); });
  $('clientDc').addEventListener('change', e => { state.clientDc = +e.target.value; schedule(); });
  $('lwt').addEventListener('change', e => { state.lwt = e.target.checked; $('sclRow').style.display = state.lwt ? '' : 'none'; schedule(); });
  ['dataGB', 'writesPs', 'readsPs', 'rowBytes'].forEach(k => $(k).addEventListener('input', e => { state[k] = e.target.value; schedule(); }));
  ['ks', 'cluster'].forEach(k => $(k).addEventListener('input', e => { state[k] = e.target.value.trim() || C.defaultState()[k]; schedule(); }));
  $('btnReseed').addEventListener('click', () => { state.seed = (state.seed % 999) + 1; $('seedNote').textContent = 'раскладка №' + state.seed; update(); });
  $('btnReset').addEventListener('click', () => { state = C.defaultState(); syncControls(); update(); });
  $('btnShare').addEventListener('click', async () => { saveUrl(); toast(await copyText(app.url.link(encodeState(state))) ? 'Скопировано' : 'Не удалось скопировать', 1800); });
  $('tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) selectTab(b.dataset.tab); });
  $('pane-scheme').addEventListener('click', onSchemeClick);
  $('pane-scheme').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset.sact === 'rack') { e.preventDefault(); onSchemeClick(e); } });
  $('pane-cfg').addEventListener('click', onCfgClick);
  syncControls(); update();

  return {
    restore(text) { const s = decodeState(text); if (isFaultState(s)) { state = Object.assign(C.defaultState(), s); syncControls(); update(); } },
    get state() { return state; },
    get res() { return res; }
  };
}
