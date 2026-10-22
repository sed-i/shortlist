import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient, GitHubError } from '../js/github.js';

function mockFetch({ status, headers = {}, body = {} }) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  });
}

test('getRepo surfaces a real GitHub 404 as "Repository not found"', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetch({
    status: 404,
    // The real API always sends rate-limit headers, even on error responses.
    headers: { 'x-ratelimit-remaining': '59', 'x-ratelimit-limit': '60', 'x-ratelimit-reset': '0' },
    body: { message: 'Not Found' },
  });
  try {
    const client = new GitHubClient();
    await assert.rejects(client.getRepo('does-not/exist'), (err) => {
      assert.ok(err instanceof GitHubError);
      assert.equal(err.status, 404);
      assert.match(err.message, /Repository not found/);
      return true;
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('getRepo reports a blocked/unreachable API instead of a false "not found"', async () => {
  const originalFetch = global.fetch;
  // A 404 with none of GitHub's rate-limit headers never actually reached api.github.com
  // (e.g. a corporate proxy, VPN, or browser extension intercepted the request).
  global.fetch = mockFetch({ status: 404, headers: {}, body: {} });
  try {
    const client = new GitHubClient();
    await assert.rejects(client.getRepo('facebook/react'), (err) => {
      assert.ok(err instanceof GitHubError);
      assert.equal(err.status, 404);
      assert.match(err.message, /Could not reach the GitHub API/);
      return true;
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('request reports GitHub rate limiting distinctly, even unauthenticated', async () => {
  const originalFetch = global.fetch;
  global.fetch = mockFetch({
    status: 403,
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '60', 'x-ratelimit-reset': '0' },
    body: { message: 'API rate limit exceeded for 1.2.3.4.' },
  });
  try {
    const client = new GitHubClient();
    await assert.rejects(client.getRepo('canonical/pebble'), (err) => {
      assert.ok(err instanceof GitHubError);
      assert.equal(err.rateLimited, true);
      assert.match(err.message, /rate limit/i);
      return true;
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('getStarHistory calls the stargazers/history endpoint, paginating up to maxPages', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization });
    const page = Number(new URL(url).searchParams.get('page'));
    const headers = {
      'x-ratelimit-remaining': '59', 'x-ratelimit-limit': '60', 'x-ratelimit-reset': '0',
      link: page === 1
        ? '<https://api.github.com/repos/canonical/pebble/stargazers/history?page=2>; rel="next", '
          + '<https://api.github.com/repos/canonical/pebble/stargazers/history?page=2>; rel="last"'
        : null,
    };
    const body = page === 1 ? [{ week: 2000, total: 3, days: [] }] : [{ week: 1000, total: 4, days: [] }];
    return { ok: true, status: 200, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, json: async () => body };
  };
  try {
    const fakeToken = ['fake', 'token', '123'].join('-');
    const client = new GitHubClient(fakeToken);
    const series = await client.getStarHistory('canonical/pebble', 10, 30);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.url.includes('/repos/canonical/pebble/stargazers/history')));
    // The token must be attached to every request, including star-history pages.
    assert.ok(calls.every((c) => c.auth.endsWith(fakeToken)));
    assert.deepEqual(series.slice(0, 2), [[1000000, 4], [2000000, 7]]);
    const last = series[series.length - 1];
    assert.equal(last[1], 10); // anchored to the live stargazers_count
  } finally {
    global.fetch = originalFetch;
  }
});
