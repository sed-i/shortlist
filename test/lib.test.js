import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEEK, parseRepoInput, parseState, serializeState, rangeStart, lastPageFromLink,
  buildStarSeries, buildActivitySeries, buildYearlyStats, clipSeries, movingAverage, niceTicks, formatNumber, valueAt,
} from '../js/lib.js';

test('parseRepoInput accepts common formats', () => {
  assert.equal(parseRepoInput('facebook/react'), 'facebook/react');
  assert.equal(parseRepoInput(' https://github.com/facebook/react '), 'facebook/react');
  assert.equal(parseRepoInput('github.com/facebook/react/tree/main/packages'), 'facebook/react');
  assert.equal(parseRepoInput('https://www.github.com/facebook/react.git'), 'facebook/react');
  assert.equal(parseRepoInput('git@github.com:facebook/react.git'), 'facebook/react');
  assert.equal(parseRepoInput('https://github.com/a/b?tab=readme#x'), 'a/b');
  assert.equal(parseRepoInput('owner/repo.js'), 'owner/repo.js');
});

test('parseRepoInput rejects invalid input', () => {
  for (const bad of ['', 'react', 'https://github.com/facebook', '-bad/x', 'a/<script>', 'a/..', null, 'a b/c']) {
    assert.equal(parseRepoInput(bad), null, String(bad));
  }
});

test('parseState reads repos and range, dedupes and caps at 3', () => {
  assert.deepEqual(parseState(''), { repos: [], range: '3y' });
  assert.deepEqual(parseState('?repos=a/b,A/B,c/d,bogus,e/f,g/h&range=1y'), { repos: ['a/b', 'c/d', 'e/f'], range: '1y' });
  assert.deepEqual(parseState('?repos=a/b&range=nope'), { repos: ['a/b'], range: '3y' });
  assert.deepEqual(parseState('?range=__proto__'), { repos: [], range: '3y' });
});

test('serializeState round-trips and omits the default range', () => {
  assert.equal(serializeState({ repos: [], range: '3y' }), '');
  assert.equal(serializeState({ repos: ['a/b', 'c/d.js'], range: '3y' }), '?repos=a/b,c/d.js');
  const s = serializeState({ repos: ['a/b', 'c/d'], range: 'all' });
  assert.equal(s, '?repos=a/b,c/d&range=all');
  assert.deepEqual(parseState(s), { repos: ['a/b', 'c/d'], range: 'all' });
});

test('rangeStart defaults to 3 years and supports all-time', () => {
  const now = Date.UTC(2026, 9, 22);
  assert.equal(rangeStart('3y', now), Date.UTC(2023, 9, 22));
  assert.equal(rangeStart('6m', now), Date.UTC(2026, 3, 22));
  assert.equal(rangeStart('bogus', now), Date.UTC(2023, 9, 22));
  assert.equal(rangeStart('all', now), null);
});

test('lastPageFromLink parses GitHub Link headers', () => {
  const h = '<https://api.github.com/repositories/1/stargazers?per_page=100&page=2>; rel="next", '
    + '<https://api.github.com/repositories/1/stargazers?per_page=100&page=57>; rel="last"';
  assert.equal(lastPageFromLink(h), 57);
  assert.equal(lastPageFromLink(null), null);
  assert.equal(lastPageFromLink('<https://x/y?page=2>; rel="next"'), null);
});

test('buildStarSeries sums weekly star deltas into a cumulative series ending at the current total', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  const w = (n) => n * 604800; // weeks since epoch, seconds
  const weeks = [
    { week: w(2900), total: 5, days: [0, 0, 0, 0, 0, 3, 2] },
    { week: w(2898), total: 10, days: [1, 2, 3, 2, 1, 1, 0] },
    // Duplicate week (e.g. overlapping pages) should be summed, not double counted.
    { week: w(2898), total: 1, days: [0, 0, 0, 0, 0, 0, 1] },
  ];
  assert.deepEqual(buildStarSeries(weeks, 250, now), [
    [w(2898) * 1000, 11],
    [w(2900) * 1000, 16],
    [now, 250],
  ]);
  assert.deepEqual(buildStarSeries([], 0, now), [[now, 0]]);
});

test('buildActivitySeries sums weekly commits and counts new contributors, splitting out bot authors', () => {
  const w = (n) => n * 604800;
  const stats = [
    { author: { login: 'alice', type: 'User' }, weeks: [{ w: w(1), c: 2 }, { w: w(2), c: 0 }, { w: w(3), c: 1 }] },
    { author: { login: 'bob', type: 'User' }, weeks: [{ w: w(1), c: 0 }, { w: w(2), c: 5 }, { w: w(3), c: 0 }] },
    { author: { login: 'dependabot[bot]', type: 'Bot' }, weeks: [{ w: w(1), c: 0 }, { w: w(2), c: 0 }, { w: w(3), c: 3 }] },
  ];
  const { commits, contributors } = buildActivitySeries(stats);
  assert.deepEqual(commits.all, [[w(1) * 1000, 2], [w(2) * 1000, 5], [w(3) * 1000, 4]]);
  assert.deepEqual(commits.nonBot, [[w(1) * 1000, 2], [w(2) * 1000, 5], [w(3) * 1000, 1]]);
  assert.deepEqual(contributors.all, [[w(1) * 1000, 1], [w(2) * 1000, 2], [w(3) * 1000, 3]]);
  assert.deepEqual(contributors.nonBot, [[w(1) * 1000, 1], [w(2) * 1000, 2], [w(3) * 1000, 2]]);
  assert.deepEqual(buildActivitySeries({}), {
    commits: { all: [], nonBot: [] },
    contributors: { all: [], nonBot: [] },
  });
});

test('buildYearlyStats aggregates weekly series into per-year commits and new contributors', () => {
  const y = (year, week = 0) => Date.UTC(year, 0, 1) + week * WEEK;
  const commits = [[y(2023), 5], [y(2023, 10), 3], [y(2024), 2], [y(2025), 1]];
  const contributors = [[y(2023), 1], [y(2023, 10), 2], [y(2024), 2], [y(2025), 4]];
  assert.deepEqual(buildYearlyStats(commits, contributors), [
    { year: 2023, commits: 8, newContributors: 2 },
    { year: 2024, commits: 2, newContributors: 0 },
    { year: 2025, commits: 1, newContributors: 2 },
  ]);
  assert.deepEqual(buildYearlyStats([], []), []);
  // A year with contributor data but no commits that year still shows up, with 0 commits.
  assert.deepEqual(buildYearlyStats([], [[y(2020), 3]]), [{ year: 2020, commits: 0, newContributors: 3 }]);
});

test('clipSeries trims to the range and optionally interpolates the start', () => {
  const pts = [[0, 0], [10, 100], [20, 200]];
  assert.deepEqual(clipSeries(pts, null), pts);
  assert.deepEqual(clipSeries(pts, 5), [[10, 100], [20, 200]]);
  assert.deepEqual(clipSeries(pts, 5, true), [[5, 50], [10, 100], [20, 200]]);
  assert.deepEqual(clipSeries(pts, 10, true), [[10, 100], [20, 200]]);
  assert.deepEqual(clipSeries(pts, -5, true), pts);
});

test('valueAt interpolates and clamps', () => {
  const pts = [[0, 0], [10, 100]];
  assert.equal(valueAt(pts, -1), 0);
  assert.equal(valueAt(pts, 5), 50);
  assert.equal(valueAt(pts, 99), 100);
  assert.equal(valueAt([], 1), null);
});

test('movingAverage smooths with a trailing window', () => {
  assert.deepEqual(movingAverage([[1, 4], [2, 0], [3, 2], [4, 6]], 2), [[1, 4], [2, 2], [3, 1], [4, 4]]);
  const pts = [[1, 1]];
  assert.equal(movingAverage(pts, 1), pts);
});

test('niceTicks and formatNumber', () => {
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(0, 7, 5), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(niceTicks(0, 1234, 5), [0, 200, 400, 600, 800, 1000, 1200]);
  assert.equal(formatNumber(950), '950');
  assert.equal(formatNumber(1234), '1.2k');
  assert.equal(formatNumber(2500000), '2.5M');
  assert.equal(formatNumber(null), '–');
});
