// Tiny dependency-free SVG line chart with a hover tooltip.
import { niceTicks, formatNumber, valueAt } from './lib.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 800;
const H = 300;
const M = { top: 12, right: 16, bottom: 28, left: 52 };

function el(name, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function timeTicks(min, max) {
  const months = (max - min) / (30.44 * 24 * 3600 * 1000);
  const step = [1, 2, 3, 6, 12, 24, 36, 60, 120].find((s) => months / s <= 8) || 240;
  const d = new Date(min);
  const start = step >= 12
    ? new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1))
    : new Date(Date.UTC(d.getUTCFullYear(), Math.ceil((d.getUTCMonth() + 1) / step) * step, 1));
  const ticks = [];
  for (let t = start; t.getTime() <= max; t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + step, 1))) {
    if (t.getTime() >= min) ticks.push(t.getTime());
  }
  const fmt = step >= 12 ? { year: 'numeric', timeZone: 'UTC' } : { month: 'short', year: '2-digit', timeZone: 'UTC' };
  return ticks.map((t) => ({ t, label: new Date(t).toLocaleDateString(undefined, fmt) }));
}

/**
 * series: [{ label, color, points: [[ms, value], ...] }] (points sorted by time)
 * options: { xMin, xMax, interpolate }  — interpolate: tooltip uses linear interpolation
 * (cumulative data) instead of the nearest sample (weekly data).
 */
export function renderChart(container, series, { xMin, xMax, interpolate = true } = {}) {
  container.replaceChildren();
  const all = series.flatMap((s) => s.points);
  if (!all.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No data for this period.';
    container.appendChild(p);
    return;
  }
  const x0 = xMin ?? Math.min(...all.map((p) => p[0]));
  const x1 = Math.max(xMax ?? 0, ...all.map((p) => p[0]));
  const yMaxRaw = Math.max(1, ...all.map((p) => p[1]));
  const yTicks = niceTicks(0, yMaxRaw, 5);
  const y1 = Math.max(yMaxRaw, yTicks[yTicks.length - 1]);

  const sx = (t) => M.left + ((t - x0) / Math.max(1, x1 - x0)) * (W - M.left - M.right);
  const sy = (v) => H - M.bottom - (v / y1) * (H - M.top - M.bottom);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });

  const grid = el('g', { class: 'grid' }, svg);
  for (const v of yTicks) {
    el('line', { x1: M.left, x2: W - M.right, y1: sy(v), y2: sy(v) }, grid);
    el('text', { x: M.left - 6, y: sy(v) + 4, 'text-anchor': 'end' }, grid).textContent = formatNumber(v);
  }
  for (const { t, label } of timeTicks(x0, x1)) {
    el('line', { x1: sx(t), x2: sx(t), y1: M.top, y2: H - M.bottom, class: 'v' }, grid);
    el('text', { x: sx(t), y: H - M.bottom + 18, 'text-anchor': 'middle' }, grid).textContent = label;
  }

  for (const s of series) {
    if (!s.points.length) continue;
    const d = s.points.map(([t, v], i) => `${i ? 'L' : 'M'}${sx(t).toFixed(1)},${sy(v).toFixed(1)}`).join('');
    const attrs = { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round' };
    if (s.dashed) attrs['stroke-dasharray'] = '7 5';
    el('path', attrs, svg);
  }

  const cursor = el('line', { y1: M.top, y2: H - M.bottom, class: 'cursor', visibility: 'hidden' }, svg);
  const overlay = el('rect', {
    x: M.left, y: M.top, width: W - M.left - M.right, height: H - M.top - M.bottom, fill: 'transparent',
  }, svg);

  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.hidden = true;

  const nearest = (points, t) => {
    let best = null;
    for (const p of points) if (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
    return best;
  };

  const show = (evt) => {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    const t = x0 + ((px - M.left) / (W - M.left - M.right)) * (x1 - x0);
    cursor.setAttribute('x1', px);
    cursor.setAttribute('x2', px);
    cursor.setAttribute('visibility', 'visible');
    tooltip.replaceChildren();
    let shownTime = t;
    const rows = [];
    for (const s of series) {
      if (!s.points.length || t < s.points[0][0]) continue;
      let v;
      if (interpolate) v = valueAt(s.points, t);
      else {
        const p = nearest(s.points, t);
        v = p[1];
        shownTime = p[0];
      }
      rows.push([s, v]);
    }
    const head = document.createElement('div');
    head.className = 'tt-date';
    head.textContent = new Date(shownTime).toLocaleDateString(undefined, { dateStyle: 'medium' });
    tooltip.appendChild(head);
    for (const [s, v] of rows) {
      const row = document.createElement('div');
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = s.color;
      row.append(sw, `${s.label}: ${formatNumber(Math.round(v * 10) / 10)}`);
      tooltip.appendChild(row);
    }
    tooltip.hidden = false;
    const left = evt.clientX - container.getBoundingClientRect().left;
    tooltip.style.left = `${Math.min(left + 12, container.clientWidth - tooltip.offsetWidth - 4)}px`;
  };
  const hide = () => {
    cursor.setAttribute('visibility', 'hidden');
    tooltip.hidden = true;
  };
  overlay.addEventListener('pointermove', show);
  overlay.addEventListener('pointerleave', hide);

  container.append(svg, tooltip);
}

const SM = { top: 16, right: 24, bottom: 42, left: 56 };

/**
 * XY scatter/line plot: one point per calendar year, points connected by a
 * line in year order, with a year label next to each point.
 * series: [{ label, color, points: [[x, y, year], ...] }] (points sorted by year)
 * options: { xLabel, yLabel }
 */
export function renderScatterChart(container, series, { xLabel = '', yLabel = '' } = {}) {
  container.replaceChildren();
  const all = series.flatMap((s) => s.points);
  if (!all.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No data for this period.';
    container.appendChild(p);
    return;
  }
  const xMaxRaw = Math.max(1, ...all.map((p) => p[0]));
  const yMaxRaw = Math.max(1, ...all.map((p) => p[1]));
  const xTicks = niceTicks(0, xMaxRaw, 5);
  const yTicks = niceTicks(0, yMaxRaw, 5);
  const x1 = Math.max(xMaxRaw, xTicks[xTicks.length - 1]);
  const y1 = Math.max(yMaxRaw, yTicks[yTicks.length - 1]);

  const sx = (v) => SM.left + (v / Math.max(1, x1)) * (W - SM.left - SM.right);
  const sy = (v) => H - SM.bottom - (v / Math.max(1, y1)) * (H - SM.top - SM.bottom);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });

  const grid = el('g', { class: 'grid' }, svg);
  for (const v of yTicks) {
    el('line', { x1: SM.left, x2: W - SM.right, y1: sy(v), y2: sy(v) }, grid);
    el('text', { x: SM.left - 6, y: sy(v) + 4, 'text-anchor': 'end' }, grid).textContent = formatNumber(v);
  }
  for (const v of xTicks) {
    el('line', { x1: sx(v), x2: sx(v), y1: SM.top, y2: H - SM.bottom, class: 'v' }, grid);
    el('text', { x: sx(v), y: H - SM.bottom + 18, 'text-anchor': 'middle' }, grid).textContent = formatNumber(v);
  }
  if (xLabel) {
    el('text', {
      x: SM.left + (W - SM.left - SM.right) / 2, y: H - 4, 'text-anchor': 'middle', class: 'axis-label',
    }, svg).textContent = xLabel;
  }
  if (yLabel) {
    const cy = SM.top + (H - SM.top - SM.bottom) / 2;
    el('text', {
      x: 12, y: cy, 'text-anchor': 'middle', class: 'axis-label', transform: `rotate(-90 12 ${cy})`,
    }, svg).textContent = yLabel;
  }

  for (const s of series) {
    if (!s.points.length) continue;
    if (s.points.length > 1) {
      const d = s.points.map(([x, y], i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join('');
      const attrs = { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round' };
      if (s.dashed) attrs['stroke-dasharray'] = '7 5';
      el('path', attrs, svg);
    }
    for (const [x, y, year] of s.points) {
      const circleAttrs = { cx: sx(x).toFixed(1), cy: sy(y).toFixed(1), r: 3.5 };
      if (s.dashed) Object.assign(circleAttrs, { fill: 'none', stroke: s.color, 'stroke-width': 2 });
      else circleAttrs.fill = s.color;
      el('circle', circleAttrs, svg);
      el('text', {
        x: sx(x) + 6, y: sy(y) - 6, 'text-anchor': 'start', class: 'point-label',
      }, svg).textContent = year;
    }
  }

  container.append(svg);
}
