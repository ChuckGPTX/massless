// GPU worker jobs through the GenerationLedger: validation, one daily budget, per-user limits, settlement,
// Lab gating and the Foley territory block. The provider (RunPod) is faked; nothing leaves the process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GenerationLedger, generationAPI, generationConfig } from '../src/generations.js';
import { actualCents, gpuSettings, jobSeconds, reserveCents, validateGpuJob } from '../src/gpu-jobs.js';

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
const JPEG = '/9j/' + 'A'.repeat(400);
const MP4 = 'AAAAIGZ0eXBpc29t' + 'A'.repeat(400);
const ENV = { GPU_ENDPOINT_ID: 'gpu-ep', LAB_ENDPOINT_ID: 'lab-ep', RUNPOD_API_KEY: 'k', GPU_DAILY_BUDGET_CENTS: '120', MOSS_BUDGET_CENTS: '200' };
let n = 0;
const key = () => `gpu-test-request-${String(++n).padStart(6, '0')}`;
function ledger(env = {}) {
  const store = storage();
  const l = new GenerationLedger({ storage: store }, { ...ENV, ...env });
  const calls = [];
  const jobs = new Map();
  l.provider = async (path, options = {}, endpoint) => {
    calls.push({ path, endpoint, body: options.body ? JSON.parse(options.body) : null });
    if (path === '/run') { const id = 'rp-' + calls.length; jobs.set(id, { status: 'IN_QUEUE' }); return { id, status: 'IN_QUEUE' }; }
    const id = decodeURIComponent(path.split('/').pop());
    if (path.startsWith('/cancel')) { jobs.set(id, { status: 'CANCELLED' }); return { status: 'CANCELLED' }; }
    return { id, ...(jobs.get(id) || { status: 'COMPLETED', output: { image: 'data:image/jpeg;base64,/9j/2Q==' } }) };
  };
  const call = async (path, owner = 'u1', body, country = '') => {
    const r = await l.fetch(new Request('https://massless.test' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-owner-id': owner, 'x-country': country, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }));
    return { status: r.status, r, j: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
  };
  const submit = (job, input, owner, extra = {}, country) => call('/api/generations', owner, { job, input, idempotencyKey: key(), ...extra }, country);
  return { l, store, calls, jobs, call, submit };
}

test('job validation mirrors the handler and never needs the GPU', () => {
  assert.equal(validateGpuJob('animate', { image: JPEG }).seconds, 240);
  assert.equal(jobSeconds('animate', { model: 'wan', resolution: '720p', steps: 40 }), 1620);
  assert.equal(jobSeconds('music', { duration: 180 }), 270);
  for (const [job, input, msg] of [
    ['paint', {}, /job must be one of/],
    ['animate', { prompt: 'x' }, /image is required/],
    ['animate', { image: JPEG, steps: 8 }, /exactly 3 steps/],
    ['animate', { image: JPEG, model: 'ltx' }, /LTX-2.5 is not available/],
    ['animate', { image: JPEG, fps: 30 }, /Unknown field fps/],
    ['music', { tags: 'x', duration: 181 }, /between 10 and 180/],
    ['upscale', { image: 'R0lGODlh' + 'A'.repeat(50) }, /must be JPEG, PNG, WEBP/],
    ['sound', { video: JPEG }, /must be MP4/],
    ['sound', { video: MP4, model: 'foley', steps: 70 }, /between 10 and 60/],
    ['fibo', { aspect: '1:1' }, /prompt or shot is required/],
    ['fibo', { mode: 'edit', prompt: 'night' }, /image is required/],
  ]) assert.throws(() => validateGpuJob(job, input), msg);
});

test('cost: reservation is the whole timeout plus cold start and idle; settlement is what RunPod measured', () => {
  assert.equal(reserveCents(240, 76), Math.ceil((240 + 90 + 45 + 5) * 76 / 3600)); // 9 cents
  assert.equal(actualCents({ executionTime: 30000, delayTime: 90000 }, 76), Math.ceil((30 + 45 + 5) * 76 / 3600)); // 2 cents
  assert.equal(actualCents({ status: 'CANCELLED' }, 76), 0);
  assert.equal(actualCents({ status: 'TIMED_OUT' }, 76), null);
});

test('bad configuration fails closed; anonymous visitors get no GPU jobs', async () => {
  for (const bad of [{ GPU_DAILY_BUDGET_CENTS: 'lots' }, { GPU_DAILY_BUDGET_CENTS: '5000' }, { GPU_CENTS_PER_HOUR: '0' }, { GPU_PER_USER_DAILY: '-1' }, { GPU_ENDPOINT_ID: '' }, { GPU_DAILY_BUDGET_CENTS: '0' }]) {
    const { submit, calls } = ledger(bad);
    const r = await submit('music', { tags: 'x' });
    assert.equal(r.status, 503, JSON.stringify(bad));
    assert.equal(calls.length, 0);
    assert.equal(gpuSettings({ ...ENV, ...bad }).on, false);
  }
  const env = { ...ENV, SUPABASE_URL: 'https://s.test', SUPABASE_PUBLISHABLE_KEY: 'pk', GENERATION_LEDGER: {} };
  assert.deepEqual(generationConfig(env).gpu, { on: true, lab: false, perUserDaily: 3 });
  assert.ok(!JSON.stringify(generationConfig(env)).includes('"k"'));
  const anon = await generationAPI(new Request('https://massless.test/api/generations/budget'), env);
  assert.equal(anon.status, 401);
});

test('submit reserves, calls the GPU endpoint with an executionTimeout, and settles the real cost', async () => {
  const { submit, call, calls, store, jobs } = ledger();
  const s = await submit('animate', { image: JPEG, prompt: 'waves', seed: 3 });
  assert.equal(s.status, 202);
  const run = calls.find((c) => c.path === '/run');
  assert.equal(run.endpoint, 'gpu-ep');
  assert.equal(run.body.input.job, 'animate');
  assert.equal(run.body.policy.executionTimeout, 330000);
  const day = 'day:' + new Date().toISOString().slice(0, 10);
  assert.equal(await store.get(day), 9);
  assert.equal((await store.get('job:' + s.j.id)).input, undefined, 'the uploaded image is not kept');
  jobs.set('rp-1', { status: 'IN_PROGRESS', output: { text: 'Rendering frames (2/3)', percent: 61 } });
  let r = await call('/api/generations/' + s.j.id);
  assert.equal(r.j.message, 'Rendering frames (2/3)');
  assert.equal(r.j.percent, 61);
  const mp4 = Buffer.from('\0\0\0\x18ftypmp42 a fake clip', 'latin1').toString('base64');
  jobs.set('rp-1', { status: 'COMPLETED', executionTime: 30000, delayTime: 60000, output: { type: 'video', mime: 'video/mp4', data: mp4, width: 832, height: 480, duration: 5.04, seed: 3 } });
  r = await call('/api/generations/' + s.j.id);
  assert.equal(r.j.status, 'COMPLETED');
  assert.equal(r.j.costCents, 2);
  assert.equal(r.j.output.data, undefined);
  assert.equal(await store.get(day), 2, 'the unused reservation went back to today');
  const file = await call('/api/generations/' + s.j.id + '/file');
  assert.equal(file.r.headers.get('content-type'), 'video/mp4');
  assert.equal(Buffer.from(await file.r.arrayBuffer()).subarray(4, 8).toString(), 'ftyp');
  await call('/api/generations/' + s.j.id);
  assert.equal(await store.get(day), 2, 'settled once');
  assert.equal((await call('/api/generations/' + s.j.id + '/file', 'stranger')).status, 404);
  const b = await call('/api/generations/budget');
  assert.deepEqual([b.j.dailyBudgetCents, b.j.leftCents, b.j.jobsLeftForYou, b.j.queue], [120, 118, 2, 0]);
});

test('one daily budget, per-user daily limits, one running job per user', async () => {
  const { submit, call, jobs } = ledger({ GPU_DAILY_BUDGET_CENTS: '20', GPU_PER_USER_DAILY: '2' });
  const a = await submit('animate', { image: JPEG }, 'a');
  assert.equal(a.status, 202);
  assert.equal((await submit('music', { tags: 'x' }, 'a')).status, 409, 'previous job still running');
  const b = await submit('animate', { image: JPEG }, 'b');
  assert.equal(b.status, 202);
  const c = await submit('animate', { image: JPEG }, 'c');
  assert.equal(c.status, 429);
  assert.match(c.j.error, /Only 2¢ of GPU time is left today/);
  jobs.set('rp-1', { status: 'FAILED', executionTime: 2000, error: JSON.stringify({ error_message: 'boom' }) });
  const failed = await call('/api/generations/' + a.j.id, 'a');
  assert.equal(failed.j.error, 'boom');
  const second = await submit('upscale', { image: JPEG }, 'a');
  assert.equal(second.status, 202, 'the refund makes room again');
  const runId = [...jobs.keys()].at(-1);
  jobs.set(runId, { status: 'CANCELLED' });
  assert.equal((await call('/api/generations/' + second.j.id, 'a')).j.status, 'CANCELLED');
  const third = await submit('music', { tags: 'x' }, 'a');
  assert.equal(third.status, 429);
  assert.match(third.j.error, /your 2 GPU jobs for today/);
  const realNow = Date.now;
  Date.now = () => realNow() + 86400000;
  try {
    const tomorrow = await call('/api/generations/budget', 'c');
    assert.equal(tomorrow.j.leftCents, 20, 'the budget resets every UTC day');
  } finally {
    Date.now = realNow;
  }
});

test('Lab models are off unless LAB_ENABLED, need lab: true, and Foley is refused in the EU, UK and Korea', async () => {
  const off = ledger();
  assert.equal((await off.submit('fibo', { prompt: 'x' }, 'u', { lab: true })).status, 403);
  const { submit, calls } = ledger({ LAB_ENABLED: 'true' });
  assert.equal((await submit('fibo', { prompt: 'x' }, 'u1')).status, 403, 'lab: true is required');
  const f = await submit('fibo', { prompt: 'x' }, 'u1', { lab: true });
  assert.equal(f.status, 202);
  assert.equal(calls.at(-1).endpoint, 'lab-ep');
  for (const country of ['DE', 'GB', 'KR']) {
    const r = await submit('sound', { video: MP4, model: 'foley' }, 'u' + country, { lab: true }, country);
    assert.equal(r.status, 451);
    assert.equal(r.j.suggest.model, 'mmaudio');
  }
  assert.equal((await submit('sound', { video: MP4, model: 'mmaudio' }, 'uDE2', { lab: true }, 'DE')).status, 202);
  assert.equal((await submit('sound', { video: MP4, model: 'foley' }, 'uUS', { lab: true }, 'US')).status, 202);
});

test('MOSS images count against the same daily budget and settle to their real cost', async () => {
  const { call, store, jobs } = ledger({ GPU_DAILY_BUDGET_CENTS: '60' });
  const body = (k) => ({ model: 'moss-image-sft', prompt: 'p', width: 1024, height: 1024, seed: 1, idempotencyKey: k });
  const m = await call('/api/generations', 'm1', body(key()));
  assert.equal(m.status, 202);
  const day = 'day:' + new Date().toISOString().slice(0, 10);
  assert.equal(await store.get(day), 50);
  assert.equal((await call('/api/generations', 'm2', body(key()))).status, 429, 'a second 50¢ reservation does not fit 60¢');
  jobs.set('rp-1', { status: 'COMPLETED', executionTime: 81000, delayTime: 20000, output: { image: 'data:image/jpeg;base64,/9j/2Q==' } });
  await call('/api/generations/' + m.j.id, 'm1');
  assert.equal(await store.get(day), Math.ceil((81 + 20 + 5) * 122 / 3600), 'settled to about 4¢');
  assert.equal(await store.get('reservedCents'), 50, 'the lifetime MOSS allowance is never refunded');
});
