// Optional "Sign in with GitHub" configuration.
//
// GitHub's OAuth token exchange requires a client secret and doesn't allow
// browser (CORS) requests, so a static site needs a tiny token-exchange proxy.
// See README.md and oauth-proxy/worker.js. Leave these empty to hide the
// sign-in button; anonymous use and pasting a token keep working regardless.
export const config = {
  // Client ID of a GitHub OAuth App whose callback URL is this site's URL.
  githubOAuthClientId: '',
  // URL of the token-exchange proxy (POST { code } -> { access_token }).
  oauthTokenProxyUrl: '',
};
