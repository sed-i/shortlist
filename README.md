# shortlist

A stateless, static web app that compares up to 3 GitHub projects to help you
decide which one to install. For each project it charts how these evolved over time:

- **Stars** (cumulative)
- **Contributors** (cumulative)
- **Weekly commits** (optionally smoothed with a 4-week average)

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

- **Paste a token** under "Use a GitHub token" — a
  [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
  with no extra permissions is enough, or
- **Sign in with GitHub** (only shown if the site owner configured it, see below).

The token is stored **unencrypted** in your browser's `localStorage`, is sent **only to GitHub**
(`api.github.com`), and "Forget token / sign out" deletes it. The app shows this note next to the token field.

### Troubleshooting

- **"Repository not found (or it is private)"** for a project you know is public and exists usually
  means the repo name couldn't be parsed correctly, or GitHub genuinely rejected the request (e.g.
  it was renamed/deleted, or you pasted a token without "public repositories" access).
- **"Could not reach the GitHub API"** means a request never actually got a response from
  `api.github.com` (so it fails for every project, not just one). This points to something between
  your browser and GitHub, such as a corporate proxy, VPN, DNS filter or ad-blocking browser
  extension blocking that domain — try disabling it or switching networks.

## Data notes

- Star history is estimated from evenly sampled pages of the stargazer list (GitHub only exposes
  the first 40,000 stargazers; the line then goes straight to today's total).
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
