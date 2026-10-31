import { generationAPI } from './generations.js';
export { GenerationLedger } from './generations.js';
// Massless Worker: serves the static app and the free-tier model APIs on Cloudflare Workers AI.
// /api/shot (images), /api/beats and /api/ask (Llama 3.3), /api/tts (MeloTTS), /api/transcribe (Whisper).
// Daily caps keep usage inside the 10,000 free Neurons per day, so this costs $0 on any plan.
// /api/human trades a Cloudflare Turnstile token for a pass cookie that the model endpoints ask for.

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
// Open-weight image models on Workers AI, all inside the free daily allowance. Partner models are left out.
const IMAGE_MODELS = {
  'flux-1-schnell': { id: MODEL, input: (prompt) => ({ prompt, steps: 6 }) },
  'sdxl-lightning': { id: '@cf/bytedance/stable-diffusion-xl-lightning', input: (prompt, o) => ({ prompt, negative_prompt: o.negative, width: o.width, height: o.height, num_steps: 8, guidance: 1.5, seed: o.seed }) },
  'dreamshaper-8-lcm': { id: '@cf/lykon/dreamshaper-8-lcm', input: (prompt, o) => ({ prompt, negative_prompt: o.negative, width: o.width, height: o.height, num_steps: 8, guidance: 2, seed: o.seed }) },
  'sdxl-base': { id: '@cf/stabilityai/stable-diffusion-xl-base-1.0', input: (prompt, o) => ({ prompt, negative_prompt: o.negative, width: o.width, height: o.height, num_steps: 20, guidance: 7, seed: o.seed }) },
};
const dim = (v, def) => Math.max(256, Math.min(1536, Math.round((Number(v) || def) / 64) * 64));
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
function sniffImage(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
  return 'image/jpeg';
}
const MAX_PROMPT = 1800;

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

// Every model call goes through AI Gateway when AI_GATEWAY names one: request analytics and a burst rate
// limit in front of the free allowance. Logging and caching are off on that gateway, so scripts, documents
// and audio are not stored there either.
const ai = (env, model, input) => (env.AI_GATEWAY ? env.AI.run(model, input, { gateway: { id: env.AI_GATEWAY, skipCache: true } }) : env.AI.run(model, input));

// ---------- proof of human (Cloudflare Turnstile) ----------
// Endpoints that spend the free allowance ask for a pass cookie. Without one they answer 401
// { human: true, sitekey }; the page runs Turnstile, posts the token to /api/human and gets a signed
// cookie for PASS_HOURS. The check is off unless TURNSTILE_SITEKEY, TURNSTILE_SECRET and PASS_KEY are set.
const GATED = new Set(['/api/shot', '/api/beats', '/api/ask', '/api/tts', '/api/transcribe']);
const PASS_COOKIE = 'ml_pass';
const PASS_HOURS = 6;
const humanOn = (env) => !!(env.TURNSTILE_SITEKEY && env.TURNSTILE_SECRET && env.PASS_KEY);

async function passSig(env, exp) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.PASS_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`massless-pass:${exp}`)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sameString(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function needsHuman(request, env) {
  if (!humanOn(env)) return null;
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)ml_pass=([0-9]+)\.([A-Za-z0-9_-]+)/);
  if (m && Number(m[1]) > Date.now() / 1000 && sameString(m[2], await passSig(env, m[1]))) return null;
  return json({ error: 'One quick check that you are human, then this runs.', human: true, sitekey: env.TURNSTILE_SITEKEY }, 401);
}

async function humanPass(request, env) {
  // GET: is the check on, and does this visitor already have a pass? Pages ask on load and warm up early.
  if (request.method === 'GET') {
    const on = humanOn(env);
    return json({ on, sitekey: on ? env.TURNSTILE_SITEKEY : null, passed: on ? (await needsHuman(request, env)) === null : true });
  }
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!humanOn(env)) return json({ ok: true, off: true });
  let token = '';
  try { token = String((await request.json()).token || ''); } catch { /* empty */ }
  if (!token || token.length > 4096) return json({ error: 'The human check sent no token. Try again.' }, 400);
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) form.append('remoteip', ip);
  let out;
  try {
    out = await (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })).json();
  } catch {
    return json({ error: 'The human check is unavailable right now. Try again in a minute.' }, 502);
  }
  if (!out || !out.success) return json({ error: 'The human check failed. Reload the page and try again.' }, 403);
  const exp = Math.floor(Date.now() / 1000) + PASS_HOURS * 3600;
  return json({ ok: true }, 200, { 'set-cookie': `${PASS_COOKIE}=${exp}.${await passSig(env, exp)}; Path=/api; Max-Age=${PASS_HOURS * 3600}; HttpOnly; Secure; SameSite=Strict` });
}

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

  const pick = IMAGE_MODELS[body.model] || IMAGE_MODELS['flux-1-schnell'];
  const opts = { width: dim(body.width, 1024), height: dim(body.height, 1024), negative: body.negative ? String(body.negative).slice(0, 400) : undefined, seed: Number.isFinite(Number(body.seed)) ? Math.abs(Math.floor(Number(body.seed))) % 4294967295 : undefined };
  let result;
  try {
    result = await ai(env, pick.id, clean(pick.input(prompt, opts)));
  } catch (e) {
    return json({ error: `Workers AI could not render this frame: ${e.message || e}` }, 502);
  }
  let bytes;
  if (result && typeof result.image === 'string') bytes = Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0));
  else if (result instanceof ReadableStream || result instanceof ArrayBuffer || ArrayBuffer.isView(result)) bytes = new Uint8Array(await new Response(result).arrayBuffer());
  if (!bytes || bytes.length < 100) return json({ error: 'Workers AI returned no image.' }, 502);

  await Promise.all([bump(env.MASSLESS_KV, totalKey, total + 1), bump(env.MASSLESS_KV, visitorKey, mine + 1)]);

  return new Response(bytes, {
    headers: {
      'content-type': sniffImage(bytes),
      'cache-control': 'no-store',
      'x-massless-model': pick.id,
      'x-massless-remaining-today': String(Math.max(0, dailyCap - total - 1)),
    },
  });
}

// POST /api/beats writes a kinetic-film beat sheet with Llama 3.3 70B on Workers AI, inside the same
// free daily allowance. The page validates the JSON and falls back to its own template if anything is off.
const LLM = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const BEAT_RULES = `You write beat sheets for kinetic typography launch films (huge words cut on the beat, like an Apple or Nike launch film).
Reply with JSON only, no prose: {"title": string, "blocks": [block, ...]}.
Block types and fields:
- {"type":"words","beats":4,"words":[4 short punchy words, max 12 chars each],"mode":"slam"|"stack"|"split"}
- {"type":"strike","beats":4,"text":"the old way, max 18 chars","then":"the new way, max 14 chars"}
- {"type":"prompt","beats":8,"text":"a lowercase request someone would type, max 80 chars"}
- {"type":"hero","beats":8,"text":"product name","sub":"three short values joined with ' · '"}
- {"type":"counter","beats":4,"to":integer,"suffix":"% or X or empty","label":"what the number counts"}
- {"type":"stretch","beats":4,"text":"one word"}
- {"type":"fly","beats":8,"words":[5 words the camera flies through]}
- {"type":"image","beats":4,"words":[2 words shown over a still]}
- {"type":"graph","beats":4,"to":integer,"label":"what is growing"}
- {"type":"logo","beats":6,"text":"product name","sub":"tagline, max 60 chars"}
Rules: one word per beat in words blocks. Open with 3 tension blocks (words, strike, prompt), then exactly one block with "drop": true (the hero right after the prompt). Use concrete words from the brief, all caps in words blocks, no emoji or hashtags, no invented statistics presented as facts (counters and graphs should use numbers from the brief or obviously playful ones). End with a logo block.`;

async function beats(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON: { "name": "...", "brief": "..." }' }, 400); }
  const name = String(body.name || '').trim().slice(0, 40);
  const brief = String(body.brief || '').trim().slice(0, 600);
  if (!brief && !name) return json({ error: 'Describe the product first.' }, 400);
  const count = { short: 10, standard: 14, long: 18 }[body.length] || 14;
  const day = today();
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const visitorKey = `bv:${day}:${await hashIp(ip)}`;
  const totalKey = `b:${day}`;
  const [total, mine] = await Promise.all([counter(env.MASSLESS_KV, totalKey), counter(env.MASSLESS_KV, visitorKey)]);
  if (total >= Number(env.BEATS_CAP || 60) || mine >= Number(env.PER_VISITOR_BEATS || 10)) return json({ error: 'The free script writer is resting for today. The built-in template still works.' }, 429);
  let result;
  try {
    result = await ai(env, LLM, {
      messages: [
        { role: 'system', content: BEAT_RULES },
        { role: 'user', content: `Product: ${name || 'unnamed'}\nBrief: ${brief || name}\nWrite ${count} blocks.` },
      ],
      max_tokens: 1600,
      temperature: 0.8,
    });
  } catch (e) {
    return json({ error: `Workers AI could not write the beat sheet: ${e.message || e}` }, 502);
  }
  await Promise.all([bump(env.MASSLESS_KV, totalKey, total + 1), bump(env.MASSLESS_KV, visitorKey, mine + 1)]);
  let spec = result && result.response;
  if (typeof spec === 'string') {
    const a = spec.indexOf('{');
    const b = spec.lastIndexOf('}');
    try { spec = JSON.parse(spec.slice(a, b + 1)); } catch { return json({ error: 'The model returned something that is not a beat sheet.' }, 502); }
  }
  if (!spec || !Array.isArray(spec.blocks)) return json({ error: 'The model returned something that is not a beat sheet.' }, 502);
  return json({ spec, model: LLM });
}

// POST /api/ask answers a question about a document's text with Llama 3.3 70B (Office > Ask). Only the text
// the visitor chooses to send leaves the browser; the PDF itself never does.
async function ask(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON: { "question": "...", "text": "..." }' }, 400); }
  const question = String(body.question || '').trim().slice(0, 500);
  const text = String(body.text || '').trim().slice(0, 12000);
  if (!question) return json({ error: 'Ask a question first.' }, 400);
  if (!text) return json({ error: 'This document has no readable text.' }, 400);
  const day = today();
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const visitorKey = `av:${day}:${await hashIp(ip)}`;
  const totalKey = `a:${day}`;
  const [total, mine] = await Promise.all([counter(env.MASSLESS_KV, totalKey), counter(env.MASSLESS_KV, visitorKey)]);
  if (total >= Number(env.ASK_CAP || 30) || mine >= Number(env.PER_VISITOR_ASK || 8)) return json({ error: 'The free document assistant is resting for today. It resets at midnight UTC.' }, 429);
  let result;
  try {
    result = await ai(env, LLM, {
      messages: [
        { role: 'system', content: 'You answer questions about one document. Use only the document. If the answer is not in it, say so plainly. Be concise and quote short phrases when useful.' },
        { role: 'user', content: `Document:\n"""\n${text}\n"""\n\nQuestion: ${question}` },
      ],
      max_tokens: 700,
      temperature: 0.2,
    });
  } catch (e) {
    return json({ error: `Workers AI could not answer: ${e.message || e}` }, 502);
  }
  await Promise.all([bump(env.MASSLESS_KV, totalKey, total + 1), bump(env.MASSLESS_KV, visitorKey, mine + 1)]);
  const r = result && result.response;
  const answer = typeof r === 'string' ? r : r ? JSON.stringify(r) : '';
  if (!answer) return json({ error: 'The model returned no answer.' }, 502);
  return json({ answer, model: LLM });
}

// POST /api/tts speaks text with MeloTTS (MIT) on Workers AI: English, Spanish, French, Chinese, Japanese, Korean.
const TTS_LANGS = ['en', 'es', 'fr', 'zh', 'jp', 'kr'];
async function tts(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON: { "text": "...", "lang": "en" }' }, 400); }
  const text = String(body.text || '').trim().slice(0, 1200);
  const lang = TTS_LANGS.includes(body.lang) ? body.lang : 'en';
  if (!text) return json({ error: 'Write something to say first.' }, 400);
  const gate = await allow(request, env, 'tts', Number(env.TTS_CAP || 300), Number(env.PER_VISITOR_TTS || 40));
  if (gate) return gate;
  let result;
  try { result = await ai(env, '@cf/myshell-ai/melotts', { prompt: text, lang }); } catch (e) { return json({ error: `Workers AI could not speak this: ${e.message || e}` }, 502); }
  const audio = result && (result.audio || result);
  if (typeof audio !== 'string') return json({ error: 'Workers AI returned no audio.' }, 502);
  const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
  const type = bytes[0] === 0x52 && bytes[1] === 0x49 ? 'audio/wav' : 'audio/mpeg';
  return new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'no-store', 'x-massless-model': '@cf/myshell-ai/melotts' } });
}

// POST /api/transcribe turns speech into text and WebVTT captions with Whisper large-v3-turbo (MIT).
// Body: the audio file itself (mp3, wav, m4a, webm, ogg), up to 20 MB. Query: ?lang=xx&task=transcribe|translate
async function transcribe(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  const size = Number(request.headers.get('content-length') || 0);
  if (size > 20 * 1024 * 1024) return json({ error: 'That file is over 20 MB. Trim it or export the audio only.' }, 413);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.length < 1000) return json({ error: 'Send an audio file as the request body.' }, 400);
  if (buf.length > 20 * 1024 * 1024) return json({ error: 'That file is over 20 MB. Trim it or export the audio only.' }, 413);
  const gate = await allow(request, env, 'asr', Number(env.ASR_CAP || 120), Number(env.PER_VISITOR_ASR || 15));
  if (gate) return gate;
  const q = new URL(request.url).searchParams;
  let b64 = '';
  for (let i = 0; i < buf.length; i += 0x8000) b64 += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  b64 = btoa(b64);
  const input = { audio: b64, task: q.get('task') === 'translate' ? 'translate' : 'transcribe', vad_filter: true };
  if (/^[a-z]{2}$/.test(q.get('lang') || '')) input.language = q.get('lang');
  let result;
  try { result = await ai(env, '@cf/openai/whisper-large-v3-turbo', input); } catch (e) { return json({ error: `Workers AI could not transcribe this: ${e.message || e}` }, 502); }
  return json({ text: result.text || '', vtt: result.vtt || '', segments: (result.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text })), language: result.transcription_info?.language || input.language || '', duration: result.transcription_info?.duration || null, model: '@cf/openai/whisper-large-v3-turbo' });
}

// Daily caps per feature and per visitor keep every endpoint inside the free Workers AI allowance.
async function allow(request, env, name, cap, perVisitor) {
  const day = today();
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const visitorKey = `${name}v:${day}:${await hashIp(ip)}`;
  const totalKey = `${name}:${day}`;
  const [total, mine] = await Promise.all([counter(env.MASSLESS_KV, totalKey), counter(env.MASSLESS_KV, visitorKey)]);
  if (total >= cap || mine >= perVisitor) return json({ error: 'This free tool is resting for today. It resets at midnight UTC.' }, 429);
  await Promise.all([bump(env.MASSLESS_KV, totalKey, total + 1), bump(env.MASSLESS_KV, visitorKey, mine + 1)]);
  return null;
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
  ply: 'application/octet-stream',
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
const PAGES = { '/': '/index.html', '/index.html': '/index.html', '/image': '/image/index.html', '/video': '/video/index.html', '/audio': '/audio/index.html', '/3d': '/3d/index.html', '/film': '/film/index.html', '/office': '/office/index.html', '/workflows': '/workflows/index.html', '/projects': '/projects/index.html', '/music': '/music/index.html', '/demo-site': '/demo-site/index.html' };
for (const studio of ['image', 'video', 'audio', '3d', 'office']) PAGES[`/studios/${studio}`] = `/studios/${studio}/index.html`;
const MEDIA = /\.(mp4|webm|wav|mp3)$/;

async function page(request, ref, file, ctx) {
  const res = await fetchFile(ref, file, ctx);
  if (!res) return notFound();
  let html = await res.text();
  if (SHA.test(ref)) html = html.replace(/(href|src)="\/(css\/[^\"]+|js\/[^\"]+|demo-site\/[^\"]+\.(?:css|js))"/g, `$1="/v/${ref}/$2"`);
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
  if (PAGES[route] || /^\/studios\/(image|video|audio|3d|office)\/index\.html$/.test(path) || /^\/(image|video|audio|3d|film|office|music|demo-site|workflows|projects)\/index\.html$/.test(path)) return page(request, ref, PAGES[route] || path, ctx);
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
    if (url.pathname === '/api/config' || url.pathname.startsWith('/api/generations')) return generationAPI(request, env);
    if (url.pathname === '/api/human') return humanPass(request, env);
    if (GATED.has(url.pathname) && request.method === 'POST') {
      const stop = await needsHuman(request, env);
      if (stop) return stop;
    }
    if (url.pathname === '/api/shot') return shot(request, env);
    if (url.pathname === '/api/beats') return beats(request, env);
    if (url.pathname === '/api/ask') return ask(request, env);
    if (url.pathname === '/api/tts') return tts(request, env);
    if (url.pathname === '/api/transcribe') return transcribe(request, env);
    if (url.pathname === '/api/health') return health(env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    return fromOrigin(request, env, ctx);
  },
};
