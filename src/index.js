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

// Static files: served from the ASSETS binding when deployed with Wrangler; otherwise pulled from the
// public GitHub repo and cached at Cloudflare's edge. Each page load is pinned to one commit: the
// Worker resolves the branch (ASSET_REF, default main) to a commit SHA, rewrites index.html to load
// /v/<sha>/..., and every module import resolves inside that same immutable version. A push to the
// branch goes live within about a minute, and a page never mixes files from two versions.
const REPO = 'ChuckGPTX/massless';
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
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  ico: 'image/x-icon',
};
const SHA = /^[0-9a-f]{40}$/;

function securityHeaders(h) {
  h.set('x-content-type-options', 'nosniff');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return h;
}

async function resolveRef(env, ctx) {
  const ref = env.ASSET_REF || 'main';
  if (SHA.test(ref)) return ref;
  const key = new Request(`https://massless-assets.internal/ref/${ref}`);
  const hit = await caches.default.match(key);
  if (hit) return await hit.text();
  try {
    const r = await fetch(`https://github.com/${REPO}.git/info/refs?service=git-upload-pack`, { headers: { 'user-agent': 'massless-worker' } });
    const m = (await r.text()).match(new RegExp(`([0-9a-f]{40}) refs/heads/${ref}\\b`));
    if (m) {
      ctx.waitUntil(caches.default.put(key, new Response(m[1], { headers: { 'cache-control': 'public, max-age=60' } })));
      return m[1];
    }
  } catch {
    /* fall back to the branch name */
  }
  return ref;
}

async function fetchFile(ref, path, ctx) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (!TYPES[ext]) return null;
  const pinned = SHA.test(ref);
  const key = new Request(`https://massless-assets.internal/f/${ref}${path}`);
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const upstream = await fetch(`https://raw.githubusercontent.com/${REPO}/${ref}/public${path}`, { cf: { cacheTtl: pinned ? 86400 : 60, cacheEverything: true } });
  if (!upstream.ok) return null;
  const headers = securityHeaders(new Headers({ 'content-type': TYPES[ext], 'cache-control': pinned ? 'public, max-age=31536000, immutable' : 'public, max-age=60' }));
  const res = new Response(upstream.body, { status: 200, headers });
  ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
}

const notFound = () => new Response('Not found', { status: 404, headers: securityHeaders(new Headers()) });
const PAGES = { '/': '/index.html', '/index.html': '/index.html', '/image': '/image/index.html', '/video': '/video/index.html', '/audio': '/audio/index.html' };
const MEDIA = /\.(mp4|webm|wav|mp3)$/;

async function page(request, ref, file, ctx) {
  const res = await fetchFile(ref, file, ctx);
  if (!res) return notFound();
  let html = await res.text();
  if (SHA.test(ref)) html = html.replace(/(href|src)="\/(css|js)\//g, `$1="/v/${ref}/$2/`);
  const headers = securityHeaders(new Headers({ 'content-type': TYPES.html, 'cache-control': 'public, max-age=0, must-revalidate' }));
  return new Response(request.method === 'HEAD' ? null : html, { headers });
}

// Video and audio need byte ranges: Safari will not play an <video> whose server ignores Range.
async function ranged(request, res, cacheControl) {
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const headers = securityHeaders(new Headers({ 'content-type': res.headers.get('content-type'), 'accept-ranges': 'bytes', 'cache-control': cacheControl }));
  const m = (request.headers.get('range') || '').match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === '' && m[2] === '')) {
    headers.set('content-length', String(size));
    return new Response(request.method === 'HEAD' ? null : buf, { status: 200, headers });
  }
  let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  let end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(size - 1, Number(m[2]));
  if (start >= size || start > end) {
    headers.set('content-range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set('content-range', `bytes ${start}-${end}/${size}`);
  headers.set('content-length', String(end - start + 1));
  return new Response(request.method === 'HEAD' ? null : buf.slice(start, end + 1), { status: 206, headers });
}

async function fromOrigin(request, env, ctx) {
  const url = new URL(request.url);
  let path = decodeURIComponent(url.pathname);
  if (path.includes('..') || path.includes('//')) return notFound();

  // versioned module and stylesheet URLs: /v/<sha>/js/app.js
  const v = path.match(/^\/v\/([0-9a-f]{40})(\/.+)$/);
  if (v) return (await fetchFile(v[1], v[2], ctx)) || notFound();

  const ref = await resolveRef(env, ctx);
  const route = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  if (PAGES[route] || /^\/(image|video|audio)\/index\.html$/.test(path)) return page(request, ref, PAGES[route] || path, ctx);
  if (path.startsWith('/_')) return notFound();
  const res = await fetchFile(ref, path, ctx);
  if (!res) return notFound();
  // unversioned paths get a short cache so they follow the branch; fonts and media change rarely
  const cc = path.startsWith('/fonts/') ? res.headers.get('cache-control') : path.startsWith('/media/') ? 'public, max-age=3600' : 'public, max-age=300';
  if (MEDIA.test(path)) return ranged(request, res, cc);
  const out = new Response(request.method === 'HEAD' ? null : res.body, res);
  out.headers.set('cache-control', cc);
  return out;
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
