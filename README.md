# shortlist

A stateless, static web app that compares up to 3 GitHub projects to help you
decide which one to install. For each project it charts how these evolved over time:

- **Stars** (cumulative)
- **Contributors** (cumulative)
- **Weekly commits** (optionally smoothed with a 4-week average)
- **Yearly growth**: new contributors vs. total commits for each of the last 5 calendar years

plus a summary table (latest release, last push, license, open issues, archived, …).

## Usage

- Add projects as `owner/repo` or by pasting a GitHub URL (several at once, separated by spaces or commas).
- The chart range is configurable (6 months … all time) and defaults to the **last 3 years**.
- The page URL updates automatically, e.g. `?repos=vitejs/vite,webpack/webpack&range=5y`,
  so you can share it and others see the same comparison without retyping anything.
  (The `range` parameter is omitted when it's the default.)

### Authentication (optional)

Everything works without logging in, but anonymous GitHub API use is limited to 60 requests/hour
(roughly one comparison of 3 projects). To get 5,000 requests/hour, either:

- **Paste a token** under "Use a GitHub token", or
- **Sign in with GitHub** (only shown if the site owner configured it, see below).

Shortlist only ever reads public data, so the token needs no write access. The required
permissions depend on the kind of token:

- **Fine-grained personal access token**
  ([create one](https://github.com/settings/personal-access-tokens/new)): no extra permissions
  are needed — the default "Public Repositories (read-only)" access is enough. Do **not** grant
  access to any private repositories.
- **Classic personal access token**
  ([create one](https://github.com/settings/tokens/new)): the **`public_repo`** scope is enough
  (and already more than Shortlist needs, since it only reads data, never writes). No other
  scopes are required.
- **Sign in with GitHub** requests no scopes at all — just read-only access to public data at
  the authenticated rate limit.

The token is stored **unencrypted** in your browser's `localStorage`, is sent **only to GitHub**
(`api.github.com`), and "Forget token / sign out" deletes it. The app shows this note next to the token field.

### Troubleshooting

- **"Repository not found (or it is private)"** for a project you know is public and exists usually
  means the repo name couldn't be parsed correctly, or the repo was renamed/deleted. This is
  **not** a token permission problem — no scope or fine-grained permission changes what a token
  can see on a public repo, since Shortlist only requests public data.
- **"Could not reach the GitHub API"** means a request never actually got a response from
  `api.github.com` (so it fails for every project, not just one). This points to something between
  your browser and GitHub, such as a corporate proxy, VPN, DNS filter or ad-blocking browser
  extension blocking that domain — try disabling it or switching networks.
- **"GitHub API rate limit exceeded"** means you've hit the 60 requests/hour anonymous cap (or,
  more rarely, the 5,000/hour authenticated cap). Paste a token or sign in to raise the limit.
  Note that opening an `api.github.com` URL directly in your browser's address bar is always an
  **anonymous** request (the page can't attach Shortlist's saved token to it), so it will hit the
  60/hour cap much faster than the app itself — this doesn't mean the app isn't using your token.
- Each project chip shows a short **⚠ error** label when it fails to load; hover over (or focus)
  it to see the full error message in a tooltip.

## Data notes

- Star history comes from GitHub's
  [weekly star-history endpoint](https://docs.github.com/en/rest/activity/starring), which
  returns new stars per week going back to the repo's creation. To limit API usage, only the most
  recent pages are fetched (30 weeks/page): up to 900 weeks (~17 years) with a token, or 240 weeks
  (~4.6 years) anonymously — older history is omitted from "all time" views on very old repos.
  The classic "list stargazers" endpoint this previously sampled is no longer used: GitHub
  restricts it to repo admins/collaborators, so it 404s for everyone else regardless of token
  permissions.
- Contributors and weekly commits come from GitHub's
  [contributor statistics](https://docs.github.com/en/rest/metrics/statistics#get-all-contributor-commit-activity),
  which cover the top 100 contributors on the default branch. GitHub computes these lazily; if
  they're not ready yet, reload after a minute.
- Responses are cached for an hour in `sessionStorage` to save API quota.


## Running locally

No build step. Serve the folder with any static server (ES modules don't load from `file://`):

```sh
npm start          # python3 -m http.server 8000, then open http://localhost:8000
npm test           # unit tests (Node 18+)
```

## Deploying to GitHub Pages

In the repository settings → Pages, set **Source: GitHub Actions**. The
[`pages.yml`](.github/workflows/pages.yml) workflow runs the tests and deploys
`index.html`, `css/` and `js/` on every push to `main`. (Alternatively, "Deploy from a branch"
with the repository root works too.)

### Enabling "Sign in with GitHub" (optional)

GitHub's OAuth token exchange requires a client secret and can't be called from the browser, so a
static site needs a tiny, stateless token-exchange proxy:

1. Create a [GitHub OAuth App](https://github.com/settings/applications/new) with the
   *Authorization callback URL* set to your site's URL, e.g. `https://<user>.github.io/shortlist/`.
2. Deploy [`oauth-proxy/worker.js`](oauth-proxy/worker.js) as a Cloudflare Worker with
   `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (as a secret) and `ALLOWED_ORIGIN`
   (e.g. `https://<user>.github.io`).
3. Fill in `githubOAuthClientId` and `oauthTokenProxyUrl` in [`js/config.js`](js/config.js).

The sign-in requests no scopes, i.e. read-only access to public data.
