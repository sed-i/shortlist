import {
  MAX_REPOS, RANGES, parseRepoInput, parseState, serializeState, rangeStart, clipSeries,
  movingAverage, formatNumber,
} from './lib.js';
import { GitHubClient } from './github.js';
import { renderChart } from './chart.js';
import { getToken, setToken, oauthEnabled, startOAuth, completeOAuthIfCallback } from './auth.js';

const COLORS = ['#2f81f7', '#e5534b', '#3fb950'];
const CACHE_PREFIX = 'shortlist.v1.';
const CACHE_TTL = 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);

let state = parseState(location.search);
let client = null;
const repoData = new Map(); // lower-cased name -> { status, data?, error? }

// ---------- URL state ----------

function syncUrl() {
  const search = serializeState(state);
  if (search !== location.search) history.replaceState(null, '', `${location.pathname}${search}`);
}

// ---------- caching (per browser tab, to save API quota on reloads) ----------

function cacheGet(key) {
  try {
    const entry = JSON.parse(sessionStorage.getItem(CACHE_PREFIX + key) || 'null');
    if (entry && Date.now() - entry.at < CACHE_TTL) return entry.data;
  } catch {
    /* ignore */
  }
  return null;
}

function cacheSet(key, data) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* quota exceeded: skip caching */
  }
}

// ---------- data loading ----------

async function fetchRepo(name) {
  const cached = cacheGet(name.toLowerCase());
  if (cached && cached.activityComplete) return cached;
  const info = await client.getRepo(name);
  const [stars, activity, contributorCount, release] = await Promise.all([
    client.getStarHistory(info.full_name, info.stargazers_count, client.token ? 30 : 8),
    client.getActivity(info.full_name),
    client.getContributorCount(info.full_name),
    client.getLatestRelease(info.full_name),
  ]);
  const data = {
    info: {
      full_name: info.full_name,
      html_url: info.html_url,
      description: info.description,
      stargazers_count: info.stargazers_count,
      forks_count: info.forks_count,
      open_issues_count: info.open_issues_count,
      license: info.license && (info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : info.license.name),
      archived: info.archived,
      created_at: info.created_at,
      pushed_at: info.pushed_at,
      language: info.language,
    },
    release: release && { tag_name: release.tag_name, published_at: release.published_at, html_url: release.html_url },
    stars,
    commits: activity.commits,
    contributors: activity.contributors,
    activityComplete: activity.complete,
    contributorCount,
  };
  cacheSet(name.toLowerCase(), data);
  if (info.full_name.toLowerCase() !== name.toLowerCase()) cacheSet(info.full_name.toLowerCase(), data);
  return data;
}

function loadRepo(name) {
  const key = name.toLowerCase();
  if (repoData.has(key) && repoData.get(key).status !== 'error') return;
  repoData.set(key, { status: 'loading' });
  render();
  fetchRepo(name)
    .then((data) => {
      repoData.set(key, { status: 'ok', data });
      // Use GitHub's canonical casing / renamed name in the shareable URL.
      const canonical = data.info.full_name;
      const idx = state.repos.findIndex((r) => r.toLowerCase() === key);
      if (idx >= 0 && state.repos[idx] !== canonical) {
        state.repos[idx] = canonical;
        repoData.set(canonical.toLowerCase(), repoData.get(key));
        syncUrl();
      }
    })
    .catch((error) => {
      repoData.set(key, { status: 'error', error });
      if (error.rateLimited) showMessage(error.message + (error.reset ? ` Resets at ${new Date(error.reset).toLocaleTimeString()}.` : ''));
    })
    .finally(render);
}

function loadAll() {
  state.repos.forEach(loadRepo);
}

// ---------- actions ----------

function addRepo(input) {
  const name = parseRepoInput(input);
  if (!name) return showMessage(`"${input}" doesn't look like a GitHub repository (use owner/repo or a github.com URL).`);
  if (state.repos.some((r) => r.toLowerCase() === name.toLowerCase())) return showMessage(`${name} is already in the comparison.`);
  if (state.repos.length >= MAX_REPOS) return showMessage(`You can compare up to ${MAX_REPOS} projects.`);
  state.repos.push(name);
  syncUrl();
  showMessage('');
  loadRepo(name);
  render();
}

function removeRepo(name) {
  state.repos = state.repos.filter((r) => r !== name);
  syncUrl();
  render();
}

function showMessage(text) {
  const box = $('message');
  box.textContent = text;
  box.hidden = !text;
}

// ---------- rendering ----------

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '–';
}

function link(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function renderChips() {
  const list = $('repo-list');
  list.replaceChildren();
  state.repos.forEach((name, i) => {
    const li = document.createElement('li');
    li.className = 'chip';
    li.style.borderColor = COLORS[i];
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = COLORS[i];
    const entry = repoData.get(name.toLowerCase());
    const status = document.createElement('span');
    status.className = 'status';
    if (entry && entry.status === 'loading') status.textContent = 'loading…';
    if (entry && entry.status === 'error') {
      status.textContent = '⚠ error';
      status.title = entry.error.message;
      status.setAttribute('aria-label', entry.error.message);
      status.classList.add('error');
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'remove';
    btn.title = `Remove ${name}`;
    btn.setAttribute('aria-label', `Remove ${name}`);
    btn.textContent = '×';
    btn.addEventListener('click', () => removeRepo(name));
    li.append(sw, link(`https://github.com/${name}`, name), status);
    if (entry && entry.status === 'error') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'link';
      retry.textContent = 'retry';
      retry.addEventListener('click', () => loadRepo(name));
      li.append(retry);
    }
    li.append(btn);
    list.appendChild(li);
  });
  const full = state.repos.length >= MAX_REPOS;
  $('repo-input').disabled = full;
  $('add-btn').disabled = full;
  $('repo-input').placeholder = full ? `Maximum of ${MAX_REPOS} projects` : 'owner/repo or https://github.com/owner/repo';
}

function loaded() {
  return state.repos
    .map((name, i) => ({ name, color: COLORS[i], entry: repoData.get(name.toLowerCase()) }))
    .filter((r) => r.entry && r.entry.status === 'ok');
}

function renderSummary(repos) {
  const table = $('summary');
  table.replaceChildren();
  if (!repos.length) return;
  const rows = [
    ['Description', (d) => d.info.description || '–'],
    ['Stars', (d) => formatNumber(d.info.stargazers_count)],
    ['Contributors', (d) => (d.contributorCount == null ? 'n/a (too many to list)' : formatNumber(d.contributorCount))],
    ['Commits (last 12 weeks)', (d) => formatNumber(d.commits.slice(-12).reduce((s, [, c]) => s + c, 0))],
    ['Forks', (d) => formatNumber(d.info.forks_count)],
    ['Open issues + PRs', (d) => formatNumber(d.info.open_issues_count)],
    ['Latest release', (d) => (d.release ? link(d.release.html_url, `${d.release.tag_name} (${fmtDate(d.release.published_at)})`) : '–')],
    ['Last push', (d) => fmtDate(d.info.pushed_at)],
    ['Created', (d) => fmtDate(d.info.created_at)],
    ['Language', (d) => d.info.language || '–'],
    ['License', (d) => d.info.license || '–'],
    ['Archived', (d) => (d.info.archived ? 'Yes ⚠️' : 'No')],
  ];
  const thead = table.createTHead().insertRow();
  thead.appendChild(document.createElement('th'));
  for (const r of repos) {
    const th = document.createElement('th');
    th.style.borderBottomColor = r.color;
    th.appendChild(link(r.entry.data.info.html_url, r.entry.data.info.full_name));
    thead.appendChild(th);
  }
  const tbody = table.createTBody();
  for (const [label, fn] of rows) {
    const tr = tbody.insertRow();
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = label;
    tr.appendChild(th);
    for (const r of repos) tr.insertCell().append(fn(r.entry.data));
  }
}

function renderLegend(container, repos) {
  container.replaceChildren();
  for (const r of repos) {
    const span = document.createElement('span');
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = r.color;
    span.append(sw, r.entry.data.info.full_name);
    container.appendChild(span);
  }
}

function renderCharts(repos) {
  $('charts').hidden = !repos.length;
  if (!repos.length) return;
  const now = Date.now();
  const start = rangeStart(state.range, now);
  const smooth = $('smooth').checked;
  const mk = (key, transform = (p) => p, interpolateClip = true) => repos.map((r) => ({
    label: r.entry.data.info.full_name,
    color: r.color,
    points: clipSeries(transform(r.entry.data[key]), start, interpolateClip),
  }));
  const opts = { xMin: start ?? undefined, xMax: now };
  renderChart($('chart-stars'), mk('stars'), opts);
  renderChart($('chart-contributors'), mk('contributors'), { ...opts, interpolate: false });
  renderChart($('chart-commits'), mk('commits', (p) => (smooth ? movingAverage(p, 4) : p), false), { ...opts, interpolate: false });
  for (const id of ['legend-stars', 'legend-contributors', 'legend-commits']) renderLegend($(id), repos);

  const pending = repos.filter((r) => !r.entry.data.activityComplete).map((r) => r.entry.data.info.full_name);
  const note = $('stats-pending');
  note.hidden = !pending.length;
  note.textContent = pending.length
    ? `GitHub is still computing statistics for ${pending.join(', ')}. Reload in a minute to see contributors and commits.`
    : '';
}

function render() {
  renderChips();
  $('range').value = state.range;
  $('empty').hidden = state.repos.length > 0;
  const repos = loaded();
  renderSummary(repos);
  renderCharts(repos);
}

// ---------- auth UI ----------

function renderAuth(user) {
  const token = client.token;
  $('signin-btn').hidden = Boolean(token) || !oauthEnabled();
  $('token-details').hidden = Boolean(token);
  $('signout-btn').hidden = !token;
  $('auth-status').textContent = token
    ? `Authenticated${user ? ` as @${user.login}` : ''}`
    : 'Anonymous (60 requests/hour)';
}

function renderRateLimit(rl) {
  $('rate-limit').textContent = rl ? `API quota: ${rl.remaining}/${rl.limit}` : '';
}

async function useToken(token) {
  setToken(token);
  client = new GitHubClient(token, { onRateLimit: renderRateLimit });
  let user = null;
  if (token) {
    try {
      user = await client.getUser();
    } catch (err) {
      if (err.status === 401) {
        setToken(null);
        client = new GitHubClient(null, { onRateLimit: renderRateLimit });
        showMessage(err.message);
      }
    }
  }
  renderAuth(user);
}

// ---------- init ----------

async function init() {
  const rangeSelect = $('range');
  for (const [key, def] of Object.entries(RANGES)) rangeSelect.add(new Option(def.label, key));

  $('add-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('repo-input');
    // Allow pasting several repos at once, separated by spaces or commas.
    for (const part of input.value.split(/[\s,]+/).filter(Boolean)) addRepo(part);
    input.value = '';
  });
  rangeSelect.addEventListener('change', () => {
    state.range = rangeSelect.value;
    syncUrl();
    render();
  });
  $('smooth').addEventListener('change', render);
  $('share-btn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $('share-btn').textContent = 'Link copied!';
    } catch {
      prompt('Copy this link:', location.href);
    }
    setTimeout(() => ($('share-btn').textContent = 'Copy share link'), 2000);
  });
  $('signin-btn').addEventListener('click', startOAuth);
  $('token-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = $('token-input').value.trim();
    if (!token) return;
    $('token-input').value = '';
    showMessage('');
    await useToken(token);
    retryFailed();
  });
  $('signout-btn').addEventListener('click', () => useToken(null));

  let token = getToken();
  try {
    token = (await completeOAuthIfCallback()) || token;
  } catch (err) {
    showMessage(err.message);
  }
  state = parseState(location.search);
  syncUrl();
  await useToken(token);
  render();
  loadAll();
}

function retryFailed() {
  for (const name of state.repos) {
    const entry = repoData.get(name.toLowerCase());
    if (entry && entry.status === 'error') loadRepo(name);
  }
}

init();
