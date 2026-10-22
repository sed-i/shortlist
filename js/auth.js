// Token handling: pasted personal access tokens and the OAuth web flow.
// The token is kept in this browser only (localStorage) and is sent only to api.github.com.
import { config } from './config.js';

const TOKEN_KEY = 'shortlist.token';
const STATE_KEY = 'shortlist.oauthState';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (e.g. private mode): token lives for this page only */
  }
}

export function oauthEnabled() {
  return Boolean(config.githubOAuthClientId && config.oauthTokenProxyUrl);
}

function randomString() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function redirectUri() {
  return `${location.origin}${location.pathname}`;
}

/** Redirects to GitHub; the current query (selected repos) is restored after login. */
export function startOAuth() {
  const nonce = randomString();
  sessionStorage.setItem(STATE_KEY, JSON.stringify({ nonce, search: location.search }));
  const params = new URLSearchParams({
    client_id: config.githubOAuthClientId,
    redirect_uri: redirectUri(),
    state: nonce,
    // No scopes: read-only access to public data, but with the authenticated rate limit.
    scope: '',
  });
  location.assign(`https://github.com/login/oauth/authorize?${params}`);
}

/**
 * Completes the OAuth flow if the page was loaded as the OAuth callback.
 * Returns the token, or null if this wasn't a callback. Throws on failure.
 */
export async function completeOAuthIfCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return null;

  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
  } catch {
    saved = null;
  }
  sessionStorage.removeItem(STATE_KEY);
  history.replaceState(null, '', `${location.pathname}${(saved && saved.search) || ''}`);

  if (!saved || saved.nonce !== state) throw new Error('GitHub sign-in failed: state mismatch. Please try again.');
  if (!oauthEnabled()) throw new Error('GitHub sign-in is not configured for this site.');

  const res = await fetch(config.oauthTokenProxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirect_uri: redirectUri() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`GitHub sign-in failed: ${data.error_description || data.error || res.statusText}`);
  }
  setToken(data.access_token);
  return data.access_token;
}
