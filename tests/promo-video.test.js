// The members' free video model (OpenRouter, tbc/mischief-1): validation, the hard budget, per-user daily clips,
// settlement to the real cost, refunds when the provider refuses, ownership and the config the browser sees.
// OpenRouter is faked; nothing leaves the process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GenerationLedger, generationAPI, generationConfig } from '../src/generations.js';
import { promoRequest, promoSettings, reserveMills, usageMills, validatePromo } from '../src/promo-video.js';

function storage() {
  const data = new Map();
  let queue = Promise.resolve();
  const api = {
    get: async (k) => structuredClone(data.get(k)),
    put: async (k, v) => {
      if (typeof k === 'object') for (const [a, b] of Object.entries(k)) data.set(a, structuredClone(b));
      else data.set(k, structuredClone(v));
    },
    delete: async (k) => { for (const x of [].concat(k)) data.delete(x); },
    transaction: (fn) => { const next = queue.then(() => fn(api)); queue = next.catch(() => {}); return next; },
    data,
  };
  return api;
}
const ENV = { OPENROUTER_API_KEY: 'or-key', PROMO_VIDEO_BUDGET_CENTS: '100', PROMO_VIDEO_PER_USER_DAILY: '10', GENERATION_LEDGER: {}, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'pk' };
let n = 0;
const key = () => `promo-test-request-${String(++n).padStart(6, '0')}`;

// A fake OpenRouter: jobs move to whatever state the test sets; usage.cost is reported on completion.
function fakeOpenRouter() {
  const jobs = new Map(), calls = [];
  let refuse = null;
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname + u.search, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization });
    if (u.pathname === '/api/v1/videos' && init.method === 'POST') {
      if (refuse) return Response.json({ error: { message: refuse.msg } }, { status: refuse.status });
      const id = 'gen-vid-' + calls.length;
      jobs.set(id, { id, status: 'pending' });
      return Response.json({ id, status: 'pending', polling_url: '/api/v1/videos/' + id }, { status: 202 });
    }
    const m = u.pathname.match(/^\/api\/v1\/videos\/([^/]+)(\/content)?$/);
    if (m && m[2]) return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { headers: { 'content-type': 'video/mp4' } });
    if (m) return Response.json(jobs.get(m[1]));
    return new Response('nope', { status: 404 });
  };
  return { fetch, jobs, calls, refuse: (status, msg) => (refuse = { status, msg }) };
}
function ledger(env = {}) {
  const store = storage();
  const l = new GenerationLedger({ storage: store }, { ...ENV, ...env });
  const call = async (path, owner = 'u1', body) => {
    const r = await l.fetch(new Request('https://chucksi.test' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-owner-id': owner, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }));
    return { status: r.status, r, j: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
  };
  const make = (owner = 'u1', extra = {}) => call('/api/promo-video', owner, { prompt: 'a red balloon over rooftops', duration: 5, resolution: '480p', idempotencyKey: key(), ...extra });
  return { l, store, call, make };
}
async function withFake(fn) {
  const real = globalThis.fetch, fake = fakeOpenRouter();
  globalThis.fetch = fake.fetch;
  try { await fn(fake); } finally { globalThis.fetch = real; }
}

test('validation: prompt, 3 or 5 s, 480p or 720p, optional start frame, request id', () => {
  const ok = validatePromo({ prompt: '  a fox  ', idempotencyKey: 'x'.repeat(20) });
  assert.deepEqual([ok.prompt, ok.duration, ok.resolution, ok.image], ['a fox', 5, '480p', undefined]);
  assert.throws(() => validatePromo({ prompt: 'a fox', duration: 10, idempotencyKey: 'x'.repeat(20) }), /3 or 5/);
  assert.throws(() => validatePromo({ prompt: 'a fox', resolution: '1080p', idempotencyKey: 'x'.repeat(20) }), /480p or 720p/);
  assert.throws(() => validatePromo({ prompt: 'ab', idempotencyKey: 'x'.repeat(20) }), /3 to 2,000/);
  assert.throws(() => validatePromo({ prompt: 'a fox', image: 'https://evil.example/x.png', idempotencyKey: 'x'.repeat(20) }), /JPEG, PNG or WebP/);
  assert.throws(() => validatePromo({ prompt: 'a fox' }), /identifier/);
  const v = validatePromo({ prompt: 'a fox', image: 'data:image/jpeg;base64,/9j/2Q==', duration: 3, idempotencyKey: 'x'.repeat(20) });
  assert.deepEqual(promoRequest(v, 'tbc/mischief-1'), {
    model: 'tbc/mischief-1', prompt: 'a fox', duration: 3, resolution: '480p', aspect_ratio: '16:9',
    frame_images: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/2Q==' }, frame_type: 'first_frame' }],
  });
});

test('money is exact in mills: a 5 s clip holds 5¢ (twice list) and settles to the reported cost', () => {
  assert.equal(reserveMills(5, 5), 50);
  assert.equal(reserveMills(3, 5), 30);
  assert.equal(usageMills({ usage: { cost: 0.025 } }), 25);
  assert.equal(usageMills({ usage: {} }), null);
  assert.equal(promoSettings({}).on, false, 'off without a key and a budget');
  assert.equal(promoSettings({ OPENROUTER_API_KEY: 'k', PROMO_VIDEO_BUDGET_CENTS: '0' }).on, false);
  assert.equal(promoSettings({ OPENROUTER_API_KEY: 'k', PROMO_VIDEO_BUDGET_CENTS: '100' }).model, 'tbc/mischief-1');
});

test('config tells the browser only what it needs, never the key', () => {
  const c = generationConfig(ENV);
  assert.deepEqual(c.promoVideo, { on: true, model: 'tbc/mischief-1', perUserDaily: 10, durations: [3, 5], resolutions: ['480p', '720p'], aspect: '16:9' });
  assert.ok(!JSON.stringify(c).includes('or-key'));
  assert.equal(generationConfig({ ...ENV, OPENROUTER_API_KEY: '' }).promoVideo.on, false);
});

test('a clip: submit, poll, settle to the real cost, download; others cannot see it', () => withFake(async (fake) => {
  const { store, call, make } = ledger();
  const s = await make();
  assert.equal(s.status, 202);
  assert.equal(fake.calls[0].auth, 'Bearer or-key');
  assert.equal(fake.calls[0].body.model, 'tbc/mischief-1');
  assert.equal(store.data.get('promo:spent'), 50, 'held at twice list price');
  assert.equal((await call('/api/promo-video/' + s.j.id + '/file')).status, 409, 'not ready yet');
  assert.equal((await call('/api/promo-video/' + s.j.id, 'u2')).status, 404, 'another account cannot poll it');
  fake.jobs.set('gen-vid-1', { id: 'gen-vid-1', status: 'completed', usage: { cost: 0.025 } });
  const done = await call('/api/promo-video/' + s.j.id);
  assert.equal(done.j.status, 'completed');
  assert.equal(done.j.costCents, 2.5);
  assert.equal(store.data.get('promo:spent'), 25, 'settled to what OpenRouter charged');
  const file = await call('/api/promo-video/' + s.j.id + '/file');
  assert.equal(file.status, 200);
  assert.equal(file.r.headers.get('content-type'), 'video/mp4');
  assert.equal((await call('/api/promo-video/' + s.j.id + '/file', 'u2')).status, 404);
}));

test('one clip at a time, 10 a day per account, and the budget is a hard stop', () => withFake(async (fake) => {
  const { call, make } = ledger({ PROMO_VIDEO_BUDGET_CENTS: '1000' });
  const finish = async (made) => {
    const id = [...fake.jobs.keys()].pop();
    fake.jobs.set(id, { id, status: 'completed', usage: { cost: 0.025 } });
    await call('/api/promo-video/' + made.j.id, 'a');
  };
  const first = await make('a');
  assert.equal((await make('a')).status, 409, 'previous clip still rendering');
  await finish(first);
  for (let i = 2; i <= 10; i++) {
    const r = await make('a');
    assert.equal(r.status, 202, 'clip ' + i);
    await finish(r);
  }
  const over = await make('a');
  assert.equal(over.status, 429);
  assert.match(over.j.error, /10 free clips/);
  const budget = await call('/api/promo-video/budget', 'a');
  assert.equal(budget.j.clipsLeftForYou, 0);
  assert.ok(!('budgetMills' in budget.j), 'the dollar budget is not exposed');

  // Budget: $0.08 holds one 5 s clip (5¢) but not a second while the first is held.
  const small = ledger({ PROMO_VIDEO_BUDGET_CENTS: '8' });
  assert.equal((await small.make('b')).status, 202);
  const second = await small.make('c');
  assert.equal(second.status, 429);
  assert.equal(second.j.budget, true);
}));

test('a refused request (e.g. out of credit) costs nothing and gives the clip back', () => withFake(async (fake) => {
  const { store, call, make } = ledger();
  fake.refuse(402, 'Insufficient credits');
  const r = await make('z');
  assert.equal(r.status, 503);
  assert.equal(r.j.status, 'failed');
  assert.equal(store.data.get('promo:spent'), 0);
  const b = await call('/api/promo-video/budget', 'z');
  assert.equal(b.j.clipsLeftForYou, 10);
}));

test('the Worker routes promo calls without needing RunPod, and requires sign-in', async () => {
  const env = { ...ENV, RUNPOD_API_KEY: '', GENERATION_LEDGER: { idFromName: () => 'id', get: () => ({ fetch: async () => Response.json({ ok: true }) }) } };
  const anon = await generationAPI(new Request('https://chucksi.com/api/promo-video/budget'), env);
  assert.equal(anon.status, 401);
  assert.match((await anon.json()).error, /free clips/);
});
