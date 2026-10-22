// Optional token-exchange proxy enabling "Sign in with GitHub" on the static site.
//
// GitHub's OAuth token endpoint needs the client secret and doesn't send CORS
// headers, so the browser can't call it directly. Deploy this stateless
// Cloudflare Worker (free tier is plenty) with these variables:
//   GITHUB_CLIENT_ID      – OAuth App client ID (same as js/config.js)
//   GITHUB_CLIENT_SECRET  – OAuth App client secret (store as a secret!)
//   ALLOWED_ORIGIN        – the site's origin, e.g. https://sed-i.github.io
// It stores nothing; it only swaps a one-time `code` for an access token.

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST' || request.headers.get('Origin') !== env.ALLOWED_ORIGIN) {
      return new Response('Forbidden', { status: 403, headers: cors });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid_request' }, { status: 400, headers: cors });
    }
    if (typeof body.code !== 'string' || !body.code) {
      return Response.json({ error: 'invalid_request' }, { status: 400, headers: cors });
    }

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code: body.code,
        ...(typeof body.redirect_uri === 'string' ? { redirect_uri: body.redirect_uri } : {}),
      }),
    });
    const data = await res.json();
    if (data.error || !data.access_token) {
      return Response.json(
        { error: data.error || 'exchange_failed', error_description: data.error_description },
        { status: 400, headers: cors },
      );
    }
    return Response.json({ access_token: data.access_token }, { headers: cors });
  },
};
