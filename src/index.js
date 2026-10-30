// Massless Worker: serves the static app and a small free-tier image API.
// POST /api/shot runs FLUX.1 [schnell] (Apache-2.0) on Cloudflare Workers AI.
// A daily cap keeps usage inside the 10,000 free Neurons per day, so this costs $0 on any plan.

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const MAX_PROMPT = 1800;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function hashIp(ip) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`massless:${ip}`));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function counter(kv, key) {
  if (!kv) return 0;
  return Number((await kv.get(key)) || 0);
}

async function bump(kv, key, value) {
  if (!kv) return;
  await kv.put(key, String(value), { expirationTtl: 60 * 60 * 36 });
}

async function shot(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const origin = request.headers.get('origin');
  const host = new URL(request.url).host;
  if (origin && new URL(origin).host !== host) return json({ error: 'Cross-site requests are not allowed.' }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Send JSON: { "prompt": "...", "seed": 123 }' }, 400);
  }
  const prompt = String(body.prompt || '').trim().slice(0, MAX_PROMPT);
  if (!prompt) return json({ error: 'The prompt is empty.' }, 400);

  const dailyCap = Number(env.DAILY_CAP || 120);
  const perVisitor = Number(env.PER_VISITOR_CAP || 12);
  const day = today();
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const visitorKey = `v:${day}:${await hashIp(ip)}`;
  const totalKey = `t:${day}`;
  const [total, mine] = await Promise.all([counter(env.MASSLESS_KV, totalKey), counter(env.MASSLESS_KV, visitorKey)]);
  if (total >= dailyCap) return json({ error: "Today's free Cloudflare frames are used up. Pollinations or your own ComfyUI still work, and the allowance resets at midnight UTC." }, 429);
  if (mine >= perVisitor) return json({ error: `You've used your ${perVisitor} free Cloudflare frames for today. Pollinations or your own ComfyUI still work.` }, 429);

  let result;
  try {
    result = await env.AI.run(MODEL, { prompt, steps: 6 });
  } catch (e) {
    return json({ error: `Workers AI could not render this frame: ${e.message || e}` }, 502);
  }
  if (!result || !result.image) return json({ error: 'Workers AI returned no image.' }, 502);

  await Promise.all([bump(env.MASSLESS_KV, totalKey, total + 1), bump(env.MASSLESS_KV, visitorKey, mine + 1)]);

  const bytes = Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'content-type': 'image/jpeg',
      'cache-control': 'no-store',
      'x-massless-model': MODEL,
      'x-massless-remaining-today': String(Math.max(0, dailyCap - total - 1)),
    },
  });
}

async function health(env) {
  const total = await counter(env.MASSLESS_KV, `t:${today()}`).catch(() => 0);
  return json({ ok: true, app: 'massless', model: MODEL, framesToday: total, dailyCap: Number(env.DAILY_CAP || 120) });
}

// Static files: served from the ASSETS binding when deployed with Wrangler, otherwise pulled from
// the public GitHub repo (ASSET_ORIGIN at ASSET_REF) and cached at Cloudflare's edge, so a push to
// the repo updates the live site within minutes.
const TYPES = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  ico: 'image/x-icon',
};

function cacheControlFor(path) {
  if (path.startsWith('/fonts/') || path.startsWith('/js/vendor/')) return 'public, max-age=31536000, immutable';
  if (path.endsWith('.html')) return 'public, max-age=60, must-revalidate';
  return 'public, max-age=300';
}

function securityHeaders(h) {
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return h;
}

async function fromOrigin(request, env, ctx) {
  const url = new URL(request.url);
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  if (path.includes('..') || path.startsWith('/_')) return new Response('Not found', { status: 404 });
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (!TYPES[ext]) return new Response('Not found', { status: 404 });

  const origin = env.ASSET_ORIGIN || 'https://raw.githubusercontent.com/ChuckGPTX/massless';
  const ref = env.ASSET_REF || 'main';
  const src = `${origin}/${ref}/public${path}`;
  const cacheKey = new Request(`https://massless-assets.internal/${ref}${path}`);
  const cache = caches.default;
  let res = await cache.match(cacheKey);
  if (!res) {
    const upstream = await fetch(src, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!upstream.ok) return new Response('Not found', { status: 404, headers: securityHeaders(new Headers()) });
    const headers = securityHeaders(new Headers({ 'content-type': TYPES[ext], 'cache-control': cacheControlFor(path) }));
    res = new Response(upstream.body, { status: 200, headers });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  if (request.method === 'HEAD') return new Response(null, { status: res.status, headers: res.headers });
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/shot') return shot(request, env);
    if (url.pathname === '/api/health') return health(env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    return fromOrigin(request, env, ctx);
  },
};
