/* Вероятность недоступности при случайном отказе k нод: фоновый пересчёт по кусочкам и график SVG.
 * Используется обеими страницами; сама задача строится в core/fault.js (makeProbTask). */
import { esc } from './format.js';

/**
 * Выполняет задачу makeProbTask кусками по sliceMs, не блокируя интерфейс.
 * @param {{ step(ms: number): boolean }} task
 * @param {() => void} onProgress вызывается после каждого куска и в начале
 * @returns {() => void} остановить расчёт
 */
export function runProbTask(task, onProgress, { sliceMs = 30, delayMs = 10 } = {}) {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const done = task.step(sliceMs);
    onProgress();
    if (!done) setTimeout(tick, 0);
  };
  onProgress();
  setTimeout(tick, delayMs);
  return () => { stopped = true; };
}

/**
 * @typedef {{ key: string, name: string, col: string, width?: number, opacity?: number, dash?: boolean }} ProbSeries
 * @param {{ rs: Array<Record<string, number>>, kMax: number, series: ProbSeries[], height?: number, maxWidth?: number, fmt: (x: number) => string, kLabel?: (k: number) => string }} p
 */
export function probChartSvg({ rs, kMax, series, height = 220, maxWidth = 720, fmt, kLabel = k => k + ' нод' }) {
  const W = 640, H = height, L = 44, R = 12, Tp = 10, B = 30, iw = W - L - R, ih = H - Tp - B;
  const x = k => L + (kMax <= 1 ? iw / 2 : (k - 1) / (kMax - 1) * iw), y = p => Tp + (1 - p) * ih;
  let svg = `<svg class="prob-chart" viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${maxWidth}px;display:block" role="img" aria-label="Вероятность недоступности при отказе k нод">`;
  [0, .25, .5, .75, 1].forEach(p => { svg += `<line x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(p) + 4}" font-size="11" text-anchor="end">${p * 100}%</text>`; });
  for (let k = 1; k <= kMax; k++) svg += `<text x="${x(k)}" y="${H - 10}" font-size="11" text-anchor="middle">${k}</text>`;
  if (rs.length) series.forEach(s => {
    const pts = rs.map(r => [x(r.k), y(r[s.key])]);
    svg += `<polyline fill="none" stroke="${s.col}" stroke-width="${s.width || 2}" stroke-linejoin="round"${s.opacity != null ? ` stroke-opacity="${s.opacity}"` : ''}${s.dash ? ' stroke-dasharray="5 4"' : ''} points="${pts.map(p => p.join(',')).join(' ')}"/>`;
    rs.forEach((r, i) => { svg += `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="3" fill="var(--surface)" stroke="${s.col}" stroke-width="2"><title>${esc(s.name)}, ${kLabel(r.k)}: ${fmt(r[s.key])}</title></circle>`; });
  });
  return svg + '</svg>';
}

/** Легенда графика. */
export const probLegend = series => series.map(s => `<span><i style="background:${s.col}"></i>${esc(s.name)}</span>`).join('');
