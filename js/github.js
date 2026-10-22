// Minimal GitHub REST API client used by the app. Talks only to api.github.com.
import { lastPageFromLink, buildStarSeries, buildActivitySeries } from './lib.js';

const API = 'https://api.github.com';
const STAR_HISTORY_PAGE_SIZE = 30;
// GitHub's documented page cap for this endpoint (100 pages x 30 weeks ≈ 57 years).
const MAX_STAR_HISTORY_PAGE = 100;

export class GitHubError extends Error {
  constructor(message, status, { rateLimited = false, reset = null } = {}) {
    super(message);
    this.status = status;
    this.rateLimited = rateLimited;
    this.reset = reset;
  }
}

export class GitHubClient {
  constructor(token = null, { onRateLimit } = {}) {
    this.token = token;
    this.onRateLimit = onRateLimit;
    this.rateLimit = null;
  }

  async request(path, { accept = 'application/vnd.github+json', allow202 = false } = {}) {
    const headers = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
    if (this.token) headers.Authorization = ['Bearer', this.token].join(' ');
    const res = await fetch(`${API}${path}`, { headers });
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining !== null) {
      this.rateLimit = {
        remaining: Number(remaining),
        limit: Number(res.headers.get('x-ratelimit-limit')),
        reset: Number(res.headers.get('x-ratelimit-reset')) * 1000,
      };
      if (this.onRateLimit) this.onRateLimit(this.rateLimit);
    }
    if (res.status === 202 && allow202) return { status: 202, data: null, headers: res.headers };
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = (await res.json()).message || message;
      } catch {
        /* ignore non-JSON bodies */
      }
      const rateLimited = (res.status === 403 || res.status === 429) && (remaining === '0' || /rate limit/i.test(message));
      if (rateLimited) {
        throw new GitHubError(
          'GitHub API rate limit exceeded. Sign in or paste a token to raise the limit.',
          res.status,
          { rateLimited: true, reset: this.rateLimit && this.rateLimit.reset },
        );
      }
      if (res.status === 401) throw new GitHubError('The GitHub token is invalid or expired.', 401);
      if (res.status === 404) {
        // The real API always returns rate-limit headers, even on error responses. Their
        // absence means this response never actually reached api.github.com — it's most likely
        // a network filter, corporate proxy, VPN, or browser extension blocking the request, not
        // a missing repository. Reporting the real cause avoids a confusing "not found" for every repo.
        if (remaining === null) {
          throw new GitHubError(
            'Could not reach the GitHub API (api.github.com). A network filter, proxy, VPN or browser extension may be blocking the request.',
            404,
          );
        }
        throw new GitHubError('Repository not found (or it is private).', 404);
      }
      throw new GitHubError(`GitHub API error ${res.status}: ${message}`, res.status);
    }
    return { status: res.status, data: res.status === 204 ? null : await res.json(), headers: res.headers };
  }

  getRepo(fullName) {
    return this.request(`/repos/${fullName}`).then((r) => r.data);
  }

  /**
   * Cumulative stars over time, built from GitHub's weekly star-history endpoint.
   * (The older "list stargazers" endpoint this used to sample is now restricted
   * to repo admins/collaborators, see the README's Troubleshooting section.)
   * `maxPages` bounds how many of the most recent weekly pages (30 weeks each)
   * are fetched, trading older history for API quota on repos with a long past.
   */
  async getStarHistory(fullName, total, maxPages) {
    if (!total) return [];
    const path = `/repos/${fullName}/stargazers/history?per_page=${STAR_HISTORY_PAGE_SIZE}`;
    const first = await this.request(`${path}&page=1`);
    const lastPage = Math.min(lastPageFromLink(first.headers.get('link')) || 1, MAX_STAR_HISTORY_PAGE, maxPages);
    const weeks = [...(first.data || [])];
    if (lastPage > 1) {
      const results = await Promise.all(
        Array.from({ length: lastPage - 1 }, (_, i) => i + 2)
          .map((page) => this.request(`${path}&page=${page}`).then((r) => r.data || [])),
      );
      for (const pageWeeks of results) weeks.push(...pageWeeks);
    }
    return buildStarSeries(weeks, total);
  }

  /**
   * Weekly commits and cumulative contributors, from the statistics endpoint.
   * GitHub computes these lazily and answers 202 until ready, so poll a bit.
   */
  async getActivity(fullName, { attempts = 8, delay = 2000 } = {}) {
    for (let i = 0; i < attempts; i++) {
      const res = await this.request(`/repos/${fullName}/stats/contributors`, { allow202: true });
      if (res.status !== 202) return { ...buildActivitySeries(res.data), complete: true };
      await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
    }
    return { commits: [], contributors: [], complete: false };
  }

  /** Total number of contributors (including anonymous), or null if GitHub won't say. */
  async getContributorCount(fullName) {
    try {
      const res = await this.request(`/repos/${fullName}/contributors?per_page=1&anon=1`);
      if (!Array.isArray(res.data)) return null;
      return lastPageFromLink(res.headers.get('link')) || res.data.length;
    } catch (err) {
      if (err.rateLimited) throw err;
      // Very large repositories return 403 "list is too large to list contributors".
      return null;
    }
  }

  async getLatestRelease(fullName) {
    try {
      return (await this.request(`/repos/${fullName}/releases/latest`)).data;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async getUser() {
    return (await this.request('/user')).data;
  }
}
