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
