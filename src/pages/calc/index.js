/* Страница «Системные требования»: связывает ввод, расчёт (core/sizing.js) и представления (views/).
 * Состояние S живёт здесь; представления получают его через ctx и только строят HTML. */
import * as E from '../../core/sizing.js';
import * as FT from '../../core/fault.js';
import { APP_VERSION } from '../../app/version.js';
import { esc, nf, nfa, plural, dsz } from '../../shared/format.js';
import { toast, copyText, saveFile } from '../../shared/dom.js';
import { encodeState, decodeState } from '../../shared/share.js';
import { runProbTask } from '../../shared/prob.js';
import { DEF, clone, merge, isCalcState, loadSaved, persist, loadCmp, saveCmp } from './state.js';
import { configZip, sizingXlsx, xlsxName, scenarioJson, scenarioName } from './exports.js';
import { VN } from './views/common.js';
import { paneSum } from './views/summary.js';
import { paneDisk } from './views/disk.js';
import { paneFt, schemeStatusHtml, probParts } from './views/fault.js';
import { paneCfg } from './views/config.js';
import { paneCal, calResult } from './views/calibration.js';
import { paneMet } from './views/method.js';
import { summary, cmpHtml } from './views/compare.js';
import { printHtml } from './views/print.js';

const DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
const TABS = ['sum', 'disk', 'ft', 'cfg', 'cal', 'met', 'cmp'];

/**
 * @param {HTMLElement} root контейнер страницы (#page-calc)
 * @param {{ url: { read(): string | null, write(s: string): void, link(s: string): string }, isActive(): boolean }} app
 */
export function mountCalc(root, app) {
  const $ = id => /** @type {any} */ (document.getElementById(id));
  const all = sel => /** @type {NodeListOf<any>} */ (root.querySelectorAll(sel));

  const fromUrl = (() => { const t = app.url.read(); const s = t ? decodeState(t) : null; return isCalcState(s) ? s : null; })();
  let S = merge(DEF, fromUrl || loadSaved());
  let VAR = 'rec', TAB = 'sum', R = null, FTR = null, timer = 0, CMP = loadCmp();
  let stopProb = null, failed = new Uint8Array(0), failSig = '';
  const code = [];
  const ctx = () => ({ R, S, VAR, ft: FTR, failed, code });

  /* ---------- поля ---------- */
  function fillSelects() {
    const cl = FT.WRITE_CL.filter(c => c !== 'ANY');
    $('f-wcl').innerHTML = cl.map(c => `<option>${c}</option>`).join('');
    $('f-rcl').innerHTML = FT.READ_CL.map(c => `<option>${c}</option>`).join('');
    $('preset').innerHTML = '<option value="">Загрузить пример…</option>' + Object.entries(E.PRESETS).map(([k, p]) => `<option value="${k}">${esc(p.label)}</option>`).join('');
    fillDrive();
  }
  function fillDrive() {
    const sizes = E.DRIVES[S.disk] || E.DRIVES.nvme;
    if (S.drive !== 'auto' && !sizes.includes(Number(S.drive))) S.drive = 'auto';
    $('f-drive').innerHTML = '<option value="auto">Подобрать</option>' + sizes.map(z => `<option value="${z}">${dsz(z)}</option>`).join('');
    $('f-drive').value = String(S.drive);
  }
  function setField(el) {
    const k = el.dataset.k, v = S[k];
    if (el.type === 'radio') el.checked = String(v) === el.value;
    else if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v == null ? '' : v;
  }
  function syncFields() { all('[data-k]').forEach(setField); renderRfGrid(); }
  function applyVis() {
    all('[data-show]').forEach(el => {
      const c = el.dataset.show;
      let on;
      if (c === 'dcmulti') on = S.mode === 'cluster' && Number(S.dc) > 1;
      else { const [k, vals] = c.split('='); on = vals.split('|').includes(String(S[k])); }
      el.hidden = !on;
    });
  }
  function renderRfGrid() {
    const D = Math.max(1, Math.min(5, Math.round(Number(S.dc) || 1)));
    if (!Array.isArray(S.rfs)) S.rfs = [3, 3, 3, 3, 3];
    $('rfGrid').innerHTML = Array.from({ length: D }, (_, i) => `<div class="fld"><label for="f-rf${i}">RF в DC${i + 1}</label><input type="number" id="f-rf${i}" data-rf="${i}" min="${i ? 0 : 1}" max="9" step="1" value="${esc(S.rfs[i] ?? 3)}"></div>`).join('');
  }
  function onField(e) {
    const el = e.target;
    if (el.dataset && el.dataset.rf != null) { const v = parseFloat(el.value); if (Number.isFinite(v)) { S.rfs[+el.dataset.rf] = v; S.topo = null; schedule(e.type === 'change' ? 0 : 200); } return; }
    if (el.dataset && el.dataset.c) { S.calib[el.dataset.c] = el.type === 'checkbox' ? el.checked : el.value; schedule(e.type === 'change' ? 0 : 250); return; }
    if (!el.dataset || !el.dataset.k) return;
    const k = el.dataset.k;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'radio') { if (!el.checked) return; v = el.value; }
    else if (el.type === 'number') { v = parseFloat(el.value); if (!Number.isFinite(v)) return; }
    else v = el.value;
    if (k === 'numTokens') v = +v;
    if (S[k] === v) return;
    S[k] = v;
    if (k === 'disk') fillDrive();
    if (['mode', 'hw', 'dc', 'F', 'cons', 'manual', 'rackPolicy'].includes(k)) { S.topo = null; S.profileOverride = null; }
    if (k === 'dc') renderRfGrid();
    if (k === 'mode' && v === 'standalone' && ['raid0', 'jbod', 'none'].includes(S.raid)) { S.raid = 'raid10'; setField($('f-raid')); toast('Для одной ноды RAID data-диска переключён на RAID 10'); }
    applyVis();
    schedule(e.type === 'change' ? 0 : 200);
  }
  root.addEventListener('input', onField);
  root.addEventListener('change', onField);

  /* ---------- группы тегов ---------- */
  function ppsText(g) { const p = Number(g.count) / Number(g.period); return Number.isFinite(p) && p > 0 ? nfa(p) : '—'; }
  function renderGroups() {
    $('groups').innerHTML = S.groups.map((g, i) => `<tr data-i="${i}">
    <td><select aria-label="Тип, группа ${i + 1}" data-g="type">${E.TYPE_ORDER.map(t => `<option ${t === g.type ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
    <td><input type="number" min="0" step="1" aria-label="Тегов, группа ${i + 1}" data-g="count" value="${esc(g.count)}"></td>
    <td><input type="number" min="0.1" step="any" aria-label="Период, с, группа ${i + 1}" data-g="period" value="${esc(g.period)}"></td>
    <td class="pps">${ppsText(g)}</td>
    <td><button class="icon-btn" type="button" data-del="${i}" aria-label="Удалить группу ${i + 1}">${DEL}</button></td></tr>`).join('');
  }
  $('groups').addEventListener('input', e => {
    const el = e.target, tr = el.closest('tr'); if (!tr || !el.dataset.g) return;
    const g = S.groups[+tr.dataset.i];
    if (el.dataset.g === 'type') g.type = el.value; else { const v = parseFloat(el.value); if (!Number.isFinite(v)) return; g[el.dataset.g] = v; }
    tr.querySelector('.pps').textContent = ppsText(g);
    S.topo = null; schedule(200);
  });
  $('groups').addEventListener('change', e => { if (e.target.dataset.g === 'type') { S.groups[+e.target.closest('tr').dataset.i].type = e.target.value; schedule(0); } });
  $('groups').addEventListener('click', e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    if (S.groups.length <= 1) { toast('Нужна хотя бы одна группа тегов'); return; }
    S.groups.splice(+b.dataset.del, 1); S.topo = null; renderGroups(); schedule(0);
  });
  $('add-group').addEventListener('click', () => {
    S.groups.push({ type: 'DOUBLE', count: 1000, period: 5 }); renderGroups(); schedule(0);
    const rows = $('groups').querySelectorAll('tr'); rows[rows.length - 1].querySelector('input').focus();
  });
  $('preset').addEventListener('change', e => {
    const p = E.PRESETS[e.target.value]; if (!p) return;
    S.groups = clone(p.groups); S.topo = null; renderGroups(); schedule(0); e.target.value = '';
    toast('Загружен пример: ' + p.label);
  });

  /* ---------- вкладки и вариант ---------- */
  all('[name=variant]').forEach(r => r.addEventListener('change', () => { VAR = r.value; renderPanes(); }));
  const tabs = () => /** @type {any[]} */ ([...all('.res-head .tab')]);
  tabs().forEach(t => t.addEventListener('click', () => selectTab(t.id.slice(4))));
  /** @type {HTMLElement} */ (root.querySelector('.res-head .tabs')).addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const list = tabs().filter(t => !t.hidden);
    let i = list.indexOf(document.activeElement);
    if (i < 0) i = list.findIndex(t => t.getAttribute('aria-selected') === 'true');
    const n = list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length]; selectTab(n.id.slice(4)); n.focus();
  });
  function selectTab(id) {
    TAB = id;
    tabs().forEach(t => { const on = t.id === 'tab-' + id; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; });
    TABS.forEach(p => { $('pane-' + p).hidden = p !== id; });
  }

  /* ---------- расчёт ---------- */
  function schedule(ms) { clearTimeout(timer); timer = window.setTimeout(run, ms); }
  function run() {
    R = E.compute(S);
    persist(S);
    app.url.write(encodeState(S));
    renderTotals(); renderHints();
    if (R.empty) {
      ['sum', 'disk', 'ft', 'cfg', 'met'].forEach(id => { $('pane-' + id).innerHTML = '<div class="empty">Добавьте хотя бы одну группу тегов с количеством и периодом больше нуля.</div>'; });
      $('repBox').innerHTML = ''; return;
    }
    renderRep();
    renderPanes();
  }
  function renderTotals() {
    if (R.empty) { $('totals').innerHTML = '<span>Нет данных</span>'; return; }
    $('totals').innerHTML = `<span>Тегов: <b>${nf(R.tags)}</b></span><span>Поток: <b>${nf(R.P)}</b> точек/с</span><span>В сутки: <b>${nf(R.P * 86400 / 1e6, 1)}</b> млн точек</span>`;
  }
  function renderHints() {
    const ms = Number(S.partMs);
    $('partHint').innerHTML = ms > 0 ? `Окно партиции тега ${nf(ms / 86400000, 1)} сут, например <code>m50010.1792050000000</code>.` : '';
    const u = E.USAGE[S.usage];
    $('usageHint').textContent = u ? `На пользователя: ${u.trOpen} ${plural(u.trOpen, 'тренд', 'тренда', 'трендов')} в час по ${u.trTags} тегов за ${u.trWin} ч, мнемосхема ${u.mnTags} тегов раз в ${nf(u.mnRef, 1)} с, ${nf(u.repH, 2)} ${Number.isInteger(u.repH) ? plural(u.repH, 'отчёт', 'отчёта', 'отчётов') : 'отчёта'} в час за ${u.repDays} ${plural(u.repDays, 'сутки', 'суток', 'суток')}.` : 'Задайте профиль одного пользователя.';
    if (!R.empty) {
      const v = R.variants[VAR] || R.variants.rec;
      $('compHint').textContent = `LZ4: ${nf(v.lz4.day / (R.P * 86400), 1)} Б на точку, без сжатия: ${nf(v.none.day / (R.P * 86400), 1)} Б (${VN[VAR].toLowerCase()}).`;
    }
  }
  function renderRep() {
    const rep = R.rep, box = $('repBox');
    if (R.standalone) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    const tolW = Math.max(0, R.tol.w), tolR = Math.max(0, R.tol.r);
    const bad = R.checks.some(c => c.scope === 'Отказоустойчивость' && c.sev === 'crit');
    box.className = 'rep-box ' + (bad ? 'bad' : R.consistent === false ? 'mid' : 'good');
    const rfs = [...new Set(rep.dcs.map(d => d.rf))];
    box.innerHTML = `<div class="rb-h">RF ${rfs.join('/')}${rep.dcs.length > 1 ? ' в каждом ДЦ' : ''} · запись ${rep.wcl} · чтение ${rep.rcl}</div>
    <div>Выдерживает отказ ${Math.min(tolW, tolR)} ${plural(Math.min(tolW, tolR), 'ноды', 'нод', 'нод')} без остановки записи и чтения.${R.consistent ? ' Тренды всегда видят последнюю точку.' : R.consistent === false ? ' Тренды могут кратко не видеть последнюю точку.' : ''}</div>`;
  }

  function renderPanes() {
    code.length = 0;
    $('var-' + VAR).checked = true;
    const v = R.variants[VAR];
    FTR = FT.compute(E.ftState(R, v.topo));
    if (!FTR.errors.length) {
      const sig = FTR.T.nodes.map(n => n.name).join(',');
      if (sig !== failSig || failed.length !== FTR.T.N) { failed = new Uint8Array(FTR.T.N); failSig = sig; }
    }
    const c = ctx();
    $('pane-sum').innerHTML = paneSum(c);
    $('pane-disk').innerHTML = paneDisk(c);
    $('pane-ft').innerHTML = paneFt(c);
    $('pane-cfg').innerHTML = paneCfg(c);
    const calBusy = $('pane-cal').contains(document.activeElement) && document.activeElement !== document.body && $('cal-result');
    if (calBusy) $('cal-result').innerHTML = calResult(c); else $('pane-cal').innerHTML = paneCal(c);
    $('pane-met').innerHTML = paneMet(c);
    renderSchemeStatus();
    renderCmp();
    renderHints();
    $('cal-badge').innerHTML = R.calib.valid && R.calib.on ? '<span class="badge n">вкл</span>' : '';
    if (stopProb) { stopProb(); stopProb = null; }
    const det = $('prob-det'); if (det && det.open) startProb();
  }
  function renderSchemeStatus() { const box = $('schemeStatus'); if (box) box.innerHTML = schemeStatusHtml(FTR, failed); }

  /* ---------- Итог: выбор конфигурации ноды ---------- */
  root.addEventListener('click', e => {
    const t = /** @type {any} */ (e.target);
    const tr = t.closest('[data-prof]');
    if (tr) { S.profileOverride = tr.dataset.prof; S.topo = null; schedule(0); return; }
    if (t.closest('[data-prof-auto]')) { S.profileOverride = null; schedule(0); return; }
    const cp = t.closest('[data-copy]'); if (cp) { copyCode(+cp.dataset.copy, cp); return; }
    const dl = t.closest('[data-dl]'); if (dl) { const f = code[+dl.dataset.dl]; saveAndTell(f.file, new Blob([f.text], { type: 'text/plain;charset=utf-8' })); return; }
    const cd = t.closest('[data-cmp-del]'); if (cd) { CMP.splice(+cd.dataset.cmpDel, 1); saveCmp(CMP); renderCmp(); return; }
    if (t.closest('[data-cmp-clear]')) { CMP = []; saveCmp(CMP); renderCmp(); selectTab('sum'); return; }
    const cl = t.closest('[data-cmp-load]'); if (cl) { const it = CMP[+cl.dataset.cmpLoad]; if (it) { setState(it.s); selectTab('sum'); toast('Сценарий загружен'); } return; }
  });
  root.addEventListener('keydown', e => { const t = /** @type {any} */ (e.target); if (e.key === 'Enter' && t.matches('[data-prof]')) { S.profileOverride = t.dataset.prof; schedule(0); } });

  /* ---------- Отказоустойчивость: схема и вероятность ---------- */
  $('pane-ft').addEventListener('click', e => {
    const t = e.target.closest('[data-topo],[data-st],[data-sact]'); if (!t || !FTR) return;
    if (t.dataset.sact) {
      const a = t.dataset.sact, T = FTR.T;
      if (a === 'node') { const id = +t.dataset.node; failed[id] ^= 1; t.classList.toggle('down', !!failed[id]); t.setAttribute('aria-pressed', failed[id] ? 'true' : 'false'); renderSchemeStatus(); return; }
      let ids = [];
      if (a === 'rack') ids = T.racks[+t.dataset.rack].nodes; else if (a === 'dc') ids = T.dcs[+t.dataset.dc].nodes;
      if (a === 'clear') failed.fill(0); else { const every = ids.every(id => failed[id]); ids.forEach(id => { failed[id] = every ? 0 : 1; }); }
      T.nodes.forEach(nd => { const b = root.querySelector(`.nd[data-node="${nd.id}"]`); if (b) { b.classList.toggle('down', !!failed[nd.id]); b.setAttribute('aria-pressed', failed[nd.id] ? 'true' : 'false'); } });
      renderSchemeStatus(); return;
    }
    if (t.dataset.topo === 'reset') { S.topo = null; schedule(0); return; }
    if (t.tagName === 'INPUT') return;
    const topo = S.topo ? clone(S.topo) : clone(R.variants[VAR].topo);
    const d = +t.dataset.dc;
    if (t.dataset.topo === 'addRack') topo[d].racks.push(1);
    else if (t.dataset.topo === 'delRack') { if (topo[d].racks.length > 1) topo[d].racks.pop(); }
    else if (t.dataset.st) { const r = +t.dataset.rack; topo[d].racks[r] = Math.max(1, Math.min(100, topo[d].racks[r] + (t.dataset.st === 'inc' ? 1 : -1))); }
    S.topo = topo; schedule(0);
  });
  $('pane-ft').addEventListener('change', e => {
    const t = e.target; if (t.dataset.st !== 'set') return;
    const topo = S.topo ? clone(S.topo) : clone(R.variants[VAR].topo);
    topo[+t.dataset.dc].racks[+t.dataset.rack] = Math.max(1, Math.min(100, Math.round(+t.value || 1)));
    S.topo = topo; schedule(0);
  });
  $('pane-ft').addEventListener('toggle', e => { if (e.target.id === 'prob-det' && e.target.open && !stopProb) startProb(); }, true);
  function startProb() {
    if (!FTR || FTR.errors.length) return;
    if (stopProb) stopProb();
    const task = FT.makeProbTask(FTR.T, FTR.ring, FTR.W, FTR.R, FTR.S, { kMax: Math.min(FTR.T.N, 8), seed: S.seed || 1 });
    const ft = FTR;
    stopProb = runProbTask(task, () => {
      const chart = $('probChart'); if (!chart) return;
      const p = probParts(task, ft);
      chart.innerHTML = p.chart; $('probTable').innerHTML = p.table; $('probProg').textContent = p.prog;
    });
  }

  /* ---------- Конфигурация ---------- */
  async function copyCode(i, btn) {
    const t = code[i] && code[i].text; if (t == null) return;
    if (await copyText(t)) { btn.textContent = 'Скопировано'; setTimeout(() => { btn.textContent = 'Копировать'; }, 1600); return; }
    const pre = btn.closest('.code').querySelector('pre'); const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Текст выделен, нажмите Ctrl+C');
  }

  /* ---------- Калибровка: вставка вывода nodetool tablestats ---------- */
  root.addEventListener('input', e => {
    const t = /** @type {any} */ (e.target);
    if (t.id !== 'cal-text') return;
    const p = E.parseTablestats(t.value), got = [];
    if (p.spaceGiB != null) { S.calib.spaceGiB = +p.spaceGiB.toFixed(3); $('c-space').value = S.calib.spaceGiB; got.push('Space used (live)'); }
    if (p.ratio != null) { S.calib.ratio = p.ratio; $('c-ratio').value = p.ratio; got.push('Compression Ratio'); }
    if (got.length) { schedule(0); toast('Распознано: ' + got.join(', ')); }
  });

  /* ---------- Сравнение ---------- */
  function renderCmp() {
    $('tab-cmp').hidden = !CMP.length;
    $('cmp-badge').innerHTML = CMP.length ? `<span class="badge n">${CMP.length}</span>` : '';
    if (!CMP.length && TAB === 'cmp') selectTab('sum');
    $('pane-cmp').innerHTML = cmpHtml(CMP);
  }

  /* ---------- Экспорт ---------- */
  function saveAndTell(name, blob) { saveFile(name, blob); toast('Файл ' + name + ' сохранён'); }
  const closeMenu = () => { $('menu').open = false; };
  $('ex-zip').addEventListener('click', () => {
    if (!R || R.empty) return;
    const z = configZip(R, VAR);
    saveAndTell(z.name, new Blob([z.data], { type: 'application/zip' }));
  });
  $('ex-xlsx').addEventListener('click', () => {
    if (!R || R.empty) return;
    saveAndTell(xlsxName(), new Blob([sizingXlsx(R, S, VAR)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  });
  const buildPrint = () => { $('print').innerHTML = printHtml(ctx()); };
  $('ex-pdf').addEventListener('click', () => { if (!R || R.empty) return; buildPrint(); window.print(); });
  window.addEventListener('beforeprint', () => { if (app.isActive() && R && !R.empty && !$('print').innerHTML) buildPrint(); });
  window.addEventListener('afterprint', () => { if (!$('print').innerHTML) return; $('print').innerHTML = ''; renderPanes(); });
  $('m-json').addEventListener('click', () => { closeMenu(); saveAndTell(scenarioName(), new Blob([scenarioJson(S)], { type: 'application/json' })); });
  $('im-json').addEventListener('change', e => {
    closeMenu();
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { const o = JSON.parse(String(rd.result)); const st = o.state || o; if (!Array.isArray(st.groups)) throw new Error(); setState(st); toast('Сценарий загружен'); } catch (err) { toast('Файл не похож на сценарий калькулятора'); } e.target.value = ''; };
    rd.readAsText(f);
  });
  $('m-link').addEventListener('click', async () => { closeMenu(); toast(await copyText(app.url.link(encodeState(S))) ? 'Ссылка скопирована' : 'Скопируйте адрес страницы из адресной строки'); });
  $('m-save').addEventListener('click', () => {
    closeMenu(); if (!R || R.empty) return;
    if (CMP.length >= 5) { toast('В сравнении уже 5 расчётов, удалите лишний'); selectTab('cmp'); return; }
    const sm = summary(ctx()); CMP.push({ name: `${sm.mode}, ${nf(sm.tags)} тегов, ${nf(sm.ret)} сут`, s: clone(S), sum: sm }); saveCmp(CMP); renderCmp(); toast('Расчёт добавлен в сравнение');
  });
  $('m-reset').addEventListener('click', () => { closeMenu(); setState(DEF); toast('Значения сброшены'); });
  const openNew = () => { closeMenu(); const d = $('dlg-new'); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); };
  $('m-new').addEventListener('click', openNew); $('f-new').addEventListener('click', openNew);
  $('dlg-new-close').addEventListener('click', () => $('dlg-new').close());
  document.addEventListener('click', e => { const m = $('menu'); if (m.open && !m.contains(e.target)) m.open = false; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('menu').open) { $('menu').open = false; $('menu').querySelector('summary').focus(); } });

  function setState(st) { S = merge(DEF, clone(st)); fillDrive(); syncFields(); renderGroups(); applyVis(); schedule(0); }

  /* ---------- старт ---------- */
  $('cv').textContent = E.CASSANDRA_VERSION;
  root.querySelectorAll('[data-app-version]').forEach(el => { el.textContent = APP_VERSION; });
  fillSelects(); syncFields(); renderGroups(); applyVis(); selectTab('sum'); run();

  return {
    /** Открыть расчёт из ссылки, вставленной в адресную строку. */
    restore(text) { const s = decodeState(text); if (isCalcState(s)) setState(s); },
    /** Для проверок в браузере: текущий ввод и результат. */
    get S() { return S; },
    get R() { return R; }
  };
}
