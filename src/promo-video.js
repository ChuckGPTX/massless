// Members' promo video model: a cheap hosted text/image-to-video model on OpenRouter (default tbc/mischief-1),
// free for signed-in users inside a hard lifetime budget. The OpenRouter key stays in the Worker; jobs, the
// budget and per-user daily counts live in the GenerationLedger Durable Object next to the GPU jobs.
//
// Settings (Worker vars):
//   OPENROUTER_API_KEY            secret; without it the promo is off
//   PROMO_VIDEO_MODEL             OpenRouter video model id (default tbc/mischief-1)
//   PROMO_VIDEO_BUDGET_CENTS      lifetime budget in cents, 0..5000 (0 = off)
//   PROMO_VIDEO_PER_USER_DAILY    clips per account per UTC day, 0..50 (default 10)
//   PROMO_VIDEO_MILLS_PER_SEC     list price in tenths of a cent per second of video (default 5 = $0.005/s)
// Money is kept in mills (1/10 cent) so 3 s and 5 s clips at half a cent a second stay exact.

export const PROMO_DURATIONS = [3, 5];
export const PROMO_RESOLUTIONS = ['480p', '720p'];
export const PROMO_ASPECT = '16:9';
const int = (v, d, lo, hi) => {
  const n = Number(v);
  return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function promoSettings(env) {
  const budgetMills = int(env.PROMO_VIDEO_BUDGET_CENTS, 0, 0, 5000) * 10;
  const perUser = int(env.PROMO_VIDEO_PER_USER_DAILY, 10, 0, 50);
  const millsPerSec = int(env.PROMO_VIDEO_MILLS_PER_SEC, 5, 1, 1000);
  const model = /^[a-z0-9-]+\/[a-z0-9.-]+$/i.test(env.PROMO_VIDEO_MODEL || '') ? env.PROMO_VIDEO_MODEL : 'tbc/mischief-1';
  return { on: !!env.OPENROUTER_API_KEY && budgetMills > 0 && perUser > 0, budgetMills, perUser, millsPerSec, model };
}

// What the browser may know: whether it's on, the model, the choices, and the per-user allowance.
export function promoConfig(env) {
  const p = promoSettings(env);
  return p.on ? { on: true, model: p.model, perUserDaily: p.perUser, durations: PROMO_DURATIONS, resolutions: PROMO_RESOLUTIONS, aspect: PROMO_ASPECT } : { on: false };
}

// Held while a clip renders: twice the list price, since the provider may charge more at 720p. Settled to the
// real cost OpenRouter reports when the clip finishes.
export const reserveMills = (seconds, millsPerSec) => seconds * millsPerSec * 2;

export function validatePromo(body) {
  if (!body || typeof body !== 'object') throw new Error('Send JSON.');
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (prompt.length < 3 || prompt.length > 2000) throw new Error('Describe your video in a sentence or two.');
  const duration = Number(body.duration ?? 5);
  if (!PROMO_DURATIONS.includes(duration)) throw new Error('Choose 3 or 5 seconds.');
  const resolution = body.resolution ?? '480p';
  if (!PROMO_RESOLUTIONS.includes(resolution)) throw new Error('Choose 480p or 720p.');
  let image;
  if (body.image != null) {
    if (typeof body.image !== 'string' || !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.image)) throw new Error('The start frame must be a JPEG, PNG or WebP image.');
    if (body.image.length > 4_000_000) throw new Error('The start frame is too large; use one under 3 MB.');
    image = body.image;
  }
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.idempotencyKey || '')) throw new Error('A request identifier is required.');
  return { prompt, duration, resolution, image, idempotencyKey: body.idempotencyKey };
}

// The OpenRouter request body for a validated clip.
export function promoRequest(v, model) {
  const req = { model, prompt: v.prompt, duration: v.duration, resolution: v.resolution, aspect_ratio: PROMO_ASPECT };
  if (v.image) req.frame_images = [{ type: 'image_url', image_url: { url: v.image }, frame_type: 'first_frame' }];
  return req;
}

// OpenRouter reports usage.cost in dollars once a job completes; convert to mills (rounded up).
export function usageMills(status) {
  const c = Number(status && status.usage && status.usage.cost);
  return Number.isFinite(c) && c >= 0 ? Math.ceil(c * 1000 - 1e-9) : null;
}

const TERMINAL = ['completed', 'failed', 'cancelled', 'expired', 'unknown'];
export const promoTerminal = (s) => TERMINAL.includes(s);
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

async function openrouter(env, path, init = {}, timeoutMs = 25000) {
  const r = await fetch('https://openrouter.ai/api/v1' + path, {
    ...init,
    headers: { Authorization: 'Bearer ' + env.OPENROUTER_API_KEY, 'content-type': 'application/json', 'HTTP-Referer': 'https://chucksi.com', 'X-Title': 'Chucksi' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return r;
}

const publicJob = (j) => ({ id: j.id, status: j.status, error: j.error, duration: j.duration, resolution: j.resolution, model: j.model, createdAt: j.createdAt, costCents: j.costMills === undefined ? undefined : j.costMills / 10 });

// Runs inside the GenerationLedger Durable Object: ctx is its state, env its environment.
export async function promoAPI(ctx, env, request, owner) {
  const url = new URL(request.url);
  const p = promoSettings(env);
  const store = ctx.storage;
  if (url.pathname === '/api/promo-video/budget' && request.method === 'GET') {
    if (!p.on) return reply({ on: false });
    const used = (await store.get('promo:spent')) || 0;
    const mine = (await store.get('promo:user:' + utcDay() + ':' + owner)) || 0;
    const left = Math.max(0, p.budgetMills - used);
    const cheapest = reserveMills(PROMO_DURATIONS[0], p.millsPerSec);
    return reply({ on: true, model: p.model, perUserDaily: p.perUser, clipsLeftForYou: left < cheapest ? 0 : Math.max(0, p.perUser - mine), budgetLeft: left < cheapest ? 'none' : left < p.budgetMills / 5 ? 'low' : 'ok', centsPerSecond: p.millsPerSec / 10 });
  }
  if (url.pathname === '/api/promo-video' && request.method === 'POST') {
    if (!p.on) return reply({ error: "This isn't available right now. Try again later." }, 503);
    let v;
    try {
      v = validatePromo(await request.json().catch(() => null));
    } catch (e) {
      return reply({ error: e.message }, 400);
    }
    const day = utcDay(), hold = reserveMills(v.duration, p.millsPerSec);
    const fingerprint = JSON.stringify([v.prompt, v.duration, v.resolution, v.image ? v.image.length : 0]);
    let job, isNew = false;
    try {
      await store.transaction(async (tx) => {
        isNew = false;
        const old = await tx.get('promo:request:' + owner + ':' + v.idempotencyKey);
        if (old) { job = await tx.get('promo:job:' + old); return; }
        const active = await tx.get('promo:active:' + owner);
        if (active) {
          const a = await tx.get('promo:job:' + active);
          if (a && !promoTerminal(a.status) && Date.now() - a.createdAt < 900000) throw Object.assign(new Error('Your last video is still being made. Wait for it to finish.'), { status: 409 });
        }
        const mine = (await tx.get('promo:user:' + day + ':' + owner)) || 0;
        if (mine >= p.perUser) throw Object.assign(new Error(`That's all ${p.perUser} free clips for today. Come back tomorrow.`), { status: 429 });
        const spent = (await tx.get('promo:spent')) || 0;
        if (spent + hold > p.budgetMills) throw Object.assign(new Error('Free videos are used up for now. Try Best quality, or come back later.'), { status: 429, budget: true });
        job = { id: crypto.randomUUID(), owner, fingerprint, status: 'submitting', createdAt: Date.now(), duration: v.duration, resolution: v.resolution, model: p.model, holdMills: hold };
        await tx.put({ 'promo:spent': spent + hold, ['promo:user:' + day + ':' + owner]: mine + 1, ['promo:job:' + job.id]: job, ['promo:request:' + owner + ':' + v.idempotencyKey]: job.id, ['promo:active:' + owner]: job.id });
        isNew = true;
      });
    } catch (e) {
      return reply({ error: e.message, budget: e.budget }, e.status || 502);
    }
    if (job.fingerprint !== fingerprint) return reply({ error: 'This request identifier was already used for a different clip.' }, 409);
    if (!isNew) return reply(publicJob(job), 202);
    try {
      const r = await openrouter(env, '/videos', { method: 'POST', body: JSON.stringify(promoRequest(v, p.model)) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.id) {
        // The provider refused the job outright, so nothing was charged: give the hold and the clip back.
        const msg = (j.error && (j.error.message || j.error)) || 'The video service refused the request.';
        await store.transaction(async (tx) => {
          const cur = await tx.get('promo:job:' + job.id);
          cur.status = 'failed';
          cur.error = String(msg).slice(0, 300);
          cur.costMills = 0;
          await tx.put('promo:spent', Math.max(0, ((await tx.get('promo:spent')) || 0) - cur.holdMills));
          const k = 'promo:user:' + day + ':' + owner;
          await tx.put(k, Math.max(0, ((await tx.get(k)) || 1) - 1));
          await tx.put('promo:job:' + job.id, cur);
          job = cur;
        });
        return reply(publicJob(job), r.status === 402 ? 503 : 502);
      }
      job.providerId = j.id;
      job.status = j.status || 'pending';
    } catch {
      job.status = 'unknown';
      job.error = 'Submission could not be confirmed. It will not be automatically repeated.';
    }
    await store.put('promo:job:' + job.id, job);
    return reply(publicJob(job), 202);
  }
  const m = url.pathname.match(/^\/api\/promo-video\/([0-9a-f-]{36})(\/file)?$/);
  if (!m || request.method !== 'GET') return reply({ error: 'Not found' }, 404);
  const key = 'promo:job:' + m[1];
  let job = await store.get(key);
  if (!job || job.owner !== owner) return reply({ error: 'Not found' }, 404);
  if (job.providerId && !promoTerminal(job.status)) {
    const r = await openrouter(env, '/videos/' + encodeURIComponent(job.providerId));
    if (r.ok) {
      const s = await r.json();
      await store.transaction(async (tx) => {
        job = await tx.get(key);
        if (promoTerminal(job.status)) return;
        if (typeof s.status === 'string') job.status = s.status;
        if (s.status === 'failed' || s.status === 'cancelled' || s.status === 'expired') job.error = String(s.error || 'The clip could not be made.').slice(0, 300);
        if (promoTerminal(job.status) && job.costMills === undefined) {
          const actual = usageMills(s);
          job.costMills = actual === null ? (job.status === 'completed' ? job.holdMills : 0) : Math.min(actual, job.holdMills * 4);
          // Return the unused hold (or charge the overrun, which the next clips then can't use).
          await tx.put('promo:spent', Math.max(0, ((await tx.get('promo:spent')) || 0) - job.holdMills + job.costMills));
        }
        await tx.put(key, job);
      });
    }
  }
  if (!m[2]) return reply(publicJob(job));
  if (job.status !== 'completed') return reply({ error: 'The clip is not ready.' }, 409);
  const r = await openrouter(env, '/videos/' + encodeURIComponent(job.providerId) + '/content?index=0', {}, 120000);
  if (!r.ok) return reply({ error: r.status === 404 || r.status === 410 ? 'This clip has expired.' : 'The clip could not be downloaded.' }, r.status === 404 ? 410 : 502);
  return new Response(r.body, { headers: { 'content-type': r.headers.get('content-type') || 'video/mp4', 'cache-control': 'private, no-store' } });
}
