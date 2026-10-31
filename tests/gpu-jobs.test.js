// GPU worker jobs through the GenerationLedger: validation, one daily budget, per-user limits, settlement,
// Lab gating and the Foley territory block. The provider (RunPod) is faked; nothing leaves the process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GenerationLedger, generationAPI, generationConfig } from '../src/generations.js';
import { readFileSync } from 'node:fs';
import { actualCents, estimateSeconds, gpuSettings, jobSeconds, quotes, reserveCents, validateGpuJob } from '../src/gpu-jobs.js';

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
const head = (bytes) => Buffer.concat([Buffer.from(bytes, 'latin1'), Buffer.alloc(300)]).subarray(0, 300).toString('base64');
const WAV = head('RIFF\x24\0\0\0WAVEfmt ');
const MP3 = head('ID3\x04\0\0');
const WEBM = head('\x1a\x45\xdf\xa3');
const M4A = head('\0\0\0\x20ftypM4A ');
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
  assert.equal(validateGpuJob('animate', { prompt: 'a fox in snow', mode: 'best', resolution: '720p' }).seconds, 2370, 'text to video');
  assert.equal(jobSeconds('music', { duration: 180 }), 270);
  assert.equal(validateGpuJob('motion', { image: JPEG, video: WEBM }).seconds, 870);
  assert.equal(validateGpuJob('lipsync', { image: JPEG, audio: WAV, mode: 'best' }).seconds, 2250);
  assert.equal(validateGpuJob('lipsync', { image: JPEG, audio: MP3 }).seconds, 390);
  assert.equal(validateGpuJob('lipsync', { image: JPEG, audio: M4A }).seconds, 390);
  assert.equal(validateGpuJob('upscale_video', { video: MP4, scale: 4 }).seconds, 510);
  for (const [job, input, msg] of [
    ['paint', {}, /job must be one of/],
    ['animate', {}, /prompt is required/],
    ['animate', { image: JPEG, steps: 9 }, /between 4 and 8/],
    ['animate', { image: JPEG, mode: 'best', resolution: '720p', steps: 25 }, /between 10 and 20/],
    ['animate', { image: JPEG, cfg: 3 }, /cfg needs mode "best"/],
    ['animate', { image: JPEG, negative: 'blur' }, /negative needs mode "best"/],
    ['animate', { image: JPEG, model: 'wan' }, /Unknown field model/],
    ['animate', { image: JPEG, fps: 30 }, /Unknown field fps/],
    ['motion', { image: JPEG }, /video is required/],
    ['motion', { image: JPEG, video: JPEG }, /video must be MP4, MOV, WEBM/],
    ['motion', { image: JPEG, video: MP4, steps: 20 }, /between 6 and 12/],
    ['motion', { image: '/9j/' + 'A'.repeat(5_000_000), video: 'AAAAIGZ0eXBpc29t' + 'A'.repeat(5_000_000) }, /together/],
    ['lipsync', { image: JPEG, audio: MP4 }, /audio must be MP3, WAV, M4A, OGG, FLAC/],
    ['lipsync', { image: JPEG, audio: WAV, mode: 'best', steps: 30 }, /between 10 and 20/],
    ['upscale_video', { video: MP4, scale: 3 }, /scale must be one of 2, 4/],
    ['music', { tags: 'x', duration: 181 }, /between 10 and 180/],
    ['upscale', { image: 'R0lGODlh' + 'A'.repeat(50) }, /must be JPEG, PNG, WEBP/],
    ['sound', { video: JPEG }, /must be MP4/],
    ['sound', { video: MP4, model: 'foley', steps: 70 }, /between 10 and 60/],
    ['fibo', { aspect: '1:1' }, /prompt or shot is required/],
    ['fibo', { mode: 'edit', prompt: 'night' }, /image is required/],
  ]) assert.throws(() => validateGpuJob(job, input), msg);
});

test('the timeouts match the handler (shared fixture)', () => {
  const rows = JSON.parse(readFileSync(new URL('./fixtures/gpu_timeouts.json', import.meta.url), 'utf8'));
  assert.ok(rows.length >= 15);
  for (const r of rows) {
    assert.equal(jobSeconds(r.job, r.input), r.worst, `${r.job} ${JSON.stringify(r.input)} timeout`);
    assert.equal(Math.round(estimateSeconds(r.job, r.input)), r.warm, `${r.job} ${JSON.stringify(r.input)} estimate`);
  }
  const q = quotes(539);
  assert.deepEqual(q['animate:quick:480p'], { seconds: 64, coldSeconds: 274, cents: 11, coldCents: 49, reserveCents: 57 });
  assert.ok(Object.values(q).every((x) => x.reserveCents <= 500), 'every job fits the default daily budget of 500 cents');
});

test('cost: reservation is the whole timeout plus cold start and idle; settlement is what RunPod measured', () => {
  assert.equal(reserveCents(240, 76), Math.ceil((240 + 90 + 45 + 5) * 76 / 3600)); // 9 cents
  assert.equal(actualCents({ executionTime: 30000, delayTime: 90000 }, 76), Math.ceil((30 + 45 + 5) * 76 / 3600)); // 2 cents
  assert.equal(actualCents({ status: 'CANCELLED' }, 76), 0);
  assert.equal(actualCents({ status: 'TIMED_OUT' }, 76), null);
});

test('bad configuration fails closed; anonymous visitors get no GPU jobs', async () => {
  for (const bad of [{ GPU_DAILY_BUDGET_CENTS: 'lots' }, { GPU_DAILY_BUDGET_CENTS: '50000' }, { GPU_CENTS_PER_HOUR: '0' }, { GPU_PER_USER_DAILY: '-1' }, { GPU_ENDPOINT_ID: '' }, { GPU_DAILY_BUDGET_CENTS: '0' }]) {
    const { submit, calls } = ledger(bad);
    const r = await submit('music', { tags: 'x' });
    assert.equal(r.status, 503, JSON.stringify(bad));
    assert.equal(calls.length, 0);
    assert.equal(gpuSettings({ ...ENV, ...bad }).on, false);
  }
  const env = { ...ENV, SUPABASE_URL: 'https://s.test', SUPABASE_PUBLISHABLE_KEY: 'pk', GENERATION_LEDGER: {} };
  assert.deepEqual(generationConfig(env).gpu, { on: true, lab: false, perUserDaily: 10 });
  assert.equal(gpuSettings(ENV).rate, 539, 'priced as the H100 by default');
  assert.equal(gpuSettings({ ...ENV, GPU_CENTS_PER_HOUR: '2001' }).on, false);
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
  assert.equal(await store.get(day), 57, '(240 + 140) s at 539 cents an hour');
  const kept = await store.get('job:' + s.j.id);
  assert.equal(kept.input, undefined, 'the uploaded image is not kept');
  assert.match(kept.fingerprint, /^[0-9a-f]{64}$/, 'only a hash of the input is stored');
  jobs.set('rp-1', { status: 'IN_PROGRESS', output: { text: 'Rendering frames (2/3)', percent: 61 } });
  let r = await call('/api/generations/' + s.j.id);
  assert.equal(r.j.message, 'Rendering frames (2/3)');
  assert.equal(r.j.percent, 61);
  const mp4 = Buffer.from('\0\0\0\x18ftypmp42 a fake clip', 'latin1').toString('base64');
  jobs.set('rp-1', { status: 'COMPLETED', executionTime: 30000, delayTime: 60000, output: { type: 'video', mime: 'video/mp4', data: mp4, width: 832, height: 480, duration: 5.04, seed: 3 } });
  r = await call('/api/generations/' + s.j.id);
  assert.equal(r.j.status, 'COMPLETED');
  assert.equal(r.j.costCents, 12);
  assert.equal(r.j.output.data, undefined);
  assert.equal(await store.get(day), 12, 'the unused reservation went back to today');
  const file = await call('/api/generations/' + s.j.id + '/file');
  assert.equal(file.r.headers.get('content-type'), 'video/mp4');
  assert.equal(Buffer.from(await file.r.arrayBuffer()).subarray(4, 8).toString(), 'ftyp');
  await call('/api/generations/' + s.j.id);
  assert.equal(await store.get(day), 12, 'settled once');
  assert.equal((await call('/api/generations/' + s.j.id + '/file', 'stranger')).status, 404);
  const b = await call('/api/generations/budget');
  assert.deepEqual([b.j.dailyBudgetCents, b.j.leftCents, b.j.jobsLeftForYou, b.j.queue, b.j.centsPerHour], [120, 108, 9, 0, 539]);
  assert.equal(b.j.estimates['animate:best:720p'].reserveCents, 376);
});

test('one daily budget, per-user daily limits, one running job per user', async () => {
  const { submit, call, jobs } = ledger({ GPU_DAILY_BUDGET_CENTS: '20', GPU_PER_USER_DAILY: '2', GPU_CENTS_PER_HOUR: '76' });
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
  const { submit, calls } = ledger({ LAB_ENABLED: 'true', LAB_CENTS_PER_HOUR: '76' });
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
