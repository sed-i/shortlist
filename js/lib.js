// Pure helpers (no DOM, no network) so they can be unit-tested with `node --test`.

export const MAX_REPOS = 3;
export const DAY = 24 * 60 * 60 * 1000;
export const WEEK = 7 * DAY;

export const RANGES = {
  '6m': { label: 'Last 6 months', months: 6 },
  '1y': { label: 'Last year', months: 12 },
  '2y': { label: 'Last 2 years', months: 24 },
  '3y': { label: 'Last 3 years', months: 36 },
  '5y': { label: 'Last 5 years', months: 60 },
  all: { label: 'All time', months: null },
};
export const DEFAULT_RANGE = '3y';

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Accepts "owner/repo", "https://github.com/owner/repo(.git)(/anything)",
 * "github.com/owner/repo" or "git@github.com:owner/repo.git".
 * Returns "owner/repo" or null when the input is not a valid repository reference.
 */
export function parseRepoInput(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^git@github\.com:/i, '');
  s = s.replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '');
  s = s.replace(/[?#].*$/, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === '.' || repo === '..') return null;
  return `${owner}/${repo}`;
}

/** Reads app state from a URL query string ("?repos=a/b,c/d&range=1y"). */
export function parseState(search) {
  const params = new URLSearchParams(search || '');
  const repos = [];
  for (const raw of (params.get('repos') || '').split(',')) {
    const repo = parseRepoInput(raw);
    if (repo && !repos.some((r) => r.toLowerCase() === repo.toLowerCase())) repos.push(repo);
    if (repos.length >= MAX_REPOS) break;
  }
  const rangeParam = params.get('range');
  const range = Object.prototype.hasOwnProperty.call(RANGES, rangeParam) ? rangeParam : DEFAULT_RANGE;
  return { repos, range };
}

/** Serializes app state into a query string (leading "?" included, or "" when empty). */
export function serializeState({ repos = [], range = DEFAULT_RANGE }) {
  const parts = [];
  // Repo names only contain [A-Za-z0-9._-/], so they are safe to put in the URL verbatim.
  if (repos.length) parts.push(`repos=${repos.join(',')}`);
  if (range && range !== DEFAULT_RANGE) parts.push(`range=${encodeURIComponent(range)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Returns the start timestamp (ms) of a range key relative to `now`, or null for "all". */
export function rangeStart(range, now = Date.now()) {
  const def = RANGES[range] || RANGES[DEFAULT_RANGE];
  if (def.months == null) return null;
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - def.months);
  return d.getTime();
}

/** Parses an RFC 5988 Link header into a { rel: url } map. */
export function parseLinkHeader(header) {
  const links = {};
  if (!header) return links;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (m) links[m[2]] = m[1];
  }
  return links;
}

/** Extracts the `page` query param of the rel="last" link, or null if absent. */
export function lastPageFromLink(header) {
  const last = parseLinkHeader(header).last;
  if (!last) return null;
  const page = Number(new URL(last).searchParams.get('page'));
  return Number.isFinite(page) && page > 0 ? page : null;
}

/**
 * Picks up to `max` page numbers in [1, totalPages], evenly spread, always
 * including the first and the last page.
 */
export function samplePages(totalPages, max) {
  if (totalPages <= 0 || max <= 0) return [];
  if (totalPages <= max) return Array.from({ length: totalPages }, (_, i) => i + 1);
  if (max === 1) return [1];
  const pages = new Set();
  for (let i = 0; i < max; i++) {
    pages.add(1 + Math.round((i * (totalPages - 1)) / (max - 1)));
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * Builds a cumulative star-count series from sampled stargazer pages.
 * `pages` is [{ page, stars: [{ starred_at }] }]; `perPage` is the page size;
 * `total` is the repository's current stargazers_count.
 */
export function buildStarSeries(pages, perPage, total, now = Date.now()) {
  const points = [];
  for (const { page, stars } of [...pages].sort((a, b) => a.page - b.page)) {
    if (!stars || !stars.length) continue;
    const offset = (page - 1) * perPage;
    points.push([Date.parse(stars[0].starred_at), offset + 1]);
    if (stars.length > 1) {
      points.push([Date.parse(stars[stars.length - 1].starred_at), offset + stars.length]);
    }
  }
  const series = dedupeSorted(points);
  if (typeof total === 'number') {
    const lastValue = series.length ? series[series.length - 1][1] : 0;
    const lastTime = series.length ? series[series.length - 1][0] : -Infinity;
    if (now > lastTime) series.push([now, Math.max(total, lastValue)]);
  }
  return series;
}

/**
 * Converts the response of GET /repos/{o}/{r}/stats/contributors into
 * - commits: weekly commit totals [[weekStartMs, commits]]
 * - contributors: cumulative distinct contributors [[weekStartMs, count]]
 */
export function buildActivitySeries(stats) {
  const weekly = new Map();
  const firstWeeks = [];
  for (const contributor of Array.isArray(stats) ? stats : []) {
    let first = null;
    for (const week of contributor.weeks || []) {
      const t = week.w * 1000;
      weekly.set(t, (weekly.get(t) || 0) + (week.c || 0));
      if (week.c > 0 && (first === null || t < first)) first = t;
    }
    if (first !== null) firstWeeks.push(first);
  }
  const weeks = [...weekly.keys()].sort((a, b) => a - b);
  const commits = weeks.map((t) => [t, weekly.get(t)]);
  firstWeeks.sort((a, b) => a - b);
  let i = 0;
  const contributors = weeks.map((t) => {
    while (i < firstWeeks.length && firstWeeks[i] <= t) i++;
    return [t, i];
  });
  return { commits, contributors };
}

/** Trailing moving average over `window` points. */
export function movingAverage(points, window) {
  if (window <= 1) return points;
  let sum = 0;
  return points.map(([t, v], idx) => {
    sum += v;
    if (idx >= window) sum -= points[idx - window][1];
    const n = Math.min(idx + 1, window);
    return [t, Math.round((sum / n) * 10) / 10];
  });
}

/** Linear interpolation of a sorted series at time t (clamped to the ends). */
export function valueAt(points, t) {
  if (!points.length) return null;
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    if (t <= t1) {
      const [t0, v0] = points[i - 1];
      return t1 === t0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return points[points.length - 1][1];
}

/**
 * Restricts a sorted series to [start, +inf). With `interpolate`, a point is
 * synthesized at `start` so cumulative lines don't begin mid-chart.
 */
export function clipSeries(points, start, interpolate = false) {
  if (start == null) return points;
  const inside = points.filter(([t]) => t >= start);
  if (interpolate && points.length && points[0][0] < start && (!inside.length || inside[0][0] > start)) {
    inside.unshift([start, Math.round(valueAt(points, start))]);
  }
  return inside;
}

/** "Nice" axis ticks between min and max. */
export function niceTicks(min, max, count = 5) {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

/** Compact number formatting: 1234 -> "1.2k". */
export function formatNumber(n) {
  if (n == null || Number.isNaN(n)) return '–';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `${trim(n / 1e3)}k`;
  return String(Math.round(n * 10) / 10);
}

function trim(x) {
  return (Math.round(x * 10) / 10).toString();
}

function dedupeSorted(points) {
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const p of points) {
    if (Number.isNaN(p[0])) continue;
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0]) prev[1] = Math.max(prev[1], p[1]);
    else out.push([...p]);
  }
  return out;
}
