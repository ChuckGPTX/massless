// GPU jobs on the Massless RunPod worker (workers/gpu): what each job may contain, how long it may run and
// what it may cost. The GenerationLedger (src/generations.js) uses this to reserve money before a job is sent
// and to settle the real cost after. Every number here mirrors workers/gpu/handler.py, which checks the input
// again on the GPU.

export const MAIN_JOBS = ['animate', 'music', 'upscale'];
export const LAB_JOBS = ['sound', 'fibo'];
export const STARTUP_SEC = 90; // ComfyUI boot inside a fresh worker, counted in RunPod's executionTime
export const COLD_SEC = 45; // billed boot time RunPod reports inside delayTime (the rest of delayTime is queueing)
export const IDLE_SEC = 5; // the endpoint's idle timeout, billed after the last job
export const QUEUE_SEC = 900; // how long a job may wait for the single worker before RunPod drops it
const MAX_IMAGE_B64 = 9_500_000;
const MAX_VIDEO_B64 = 9_400_000;
// HunyuanVideo-Foley's license (Tencent Hunyuan Community) does not cover the EU, the UK or South Korea.
export const FOLEY_BLOCKED = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'KR']);
const KEYS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'].flatMap((r) => [`${r} major`, `${r} minor`]);
const FIELDS = {
  animate: ['image', 'prompt', 'negative', 'resolution', 'aspect', 'seed', 'steps', 'model'],
  music: ['tags', 'lyrics', 'duration', 'bpm', 'key', 'timesignature', 'language', 'seed'],
  upscale: ['image', 'scale', 'format'],
  sound: ['video', 'prompt', 'negative', 'model', 'seed', 'steps'],
  fibo: ['mode', 'prompt', 'shot', 'image', 'aspect', 'seed', 'steps'],
};

/** Worst-case run time in seconds, the same timeouts the handler enforces. */
export function jobSeconds(job, i) {
  if (job === 'animate') {
    const r = i.resolution === '720p' ? '720p' : '480p';
    if ((i.model || 'wan-fast') === 'wan-fast') return r === '480p' ? 240 : 420;
    const steps = Number(i.steps ?? 20);
    return r === '480p' ? 120 + 12 * steps : 180 + 36 * steps;
  }
  if (job === 'music') return 90 + Number(i.duration ?? 30);
  if (job === 'upscale') return 150;
  if (job === 'sound') return (i.model || 'mmaudio') === 'foley' ? 210 : 120;
  if (job === 'fibo') return 240;
  throw new Error('Unknown job.');
}

const kind = (s) => {
  const v = s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s;
  if (v.startsWith('/9j/')) return 'jpeg';
  if (v.startsWith('iVBORw0KGgo')) return 'png';
  if (v.startsWith('UklGR')) return 'webp';
  if (/^AAAA[A-Za-z0-9+/]{2}Z0eXB/.test(v)) return 'mp4'; // a box size, then 'ftyp'
  return null;
};

/** Throws a readable Error for anything the handler would refuse, so a bad job never wakes a GPU. */
export function validateGpuJob(job, i) {
  if (!FIELDS[job]) throw new Error(`job must be one of ${[...MAIN_JOBS, ...LAB_JOBS].join(', ')}.`);
  if (!i || typeof i !== 'object' || Array.isArray(i)) throw new Error('input must be an object.');
  const extra = Object.keys(i).filter((k) => !FIELDS[job].includes(k));
  if (extra.length) throw new Error(`Unknown field ${extra.join(', ')}.`);
  const fail = (m) => { throw new Error(m); };
  const str = (k, max, req) => {
    if (i[k] == null || i[k] === '') return req && fail(`${k} is required.`);
    if (typeof i[k] !== 'string') fail(`${k} must be text.`);
    if (i[k].length > max) fail(`${k} is ${i[k].length} characters; the limit is ${max}.`);
  };
  const num = (k, lo, hi, int) => {
    if (i[k] == null) return;
    if (typeof i[k] !== 'number' || !Number.isFinite(i[k]) || (int && !Number.isInteger(i[k]))) fail(`${k} must be a ${int ? 'whole ' : ''}number.`);
    if (i[k] < lo || i[k] > hi) fail(`${k} must be between ${lo} and ${hi}.`);
  };
  const one = (k, opts) => { if (i[k] != null && !opts.includes(i[k])) fail(`${k} must be one of ${opts.join(', ')}.`); };
  const media = (k, kinds, max) => {
    if (typeof i[k] !== 'string' || !i[k]) fail(`${k} is required.`);
    if (i[k].length > max) fail(`${k} is ${(i[k].length / 1e6).toFixed(1)} MB as base64; the limit is ${(max / 1e6).toFixed(1)} MB.`);
    if (!kinds.includes(kind(i[k]))) fail(`${k} must be ${kinds.map((x) => x.toUpperCase()).join(', ')}.`);
  };
  num('seed', 0, 4294967295, true);
  if (job === 'animate') {
    if (i.model === 'ltx') fail('LTX-2.5 is not available. Use model "wan-fast" or "wan".');
    media('image', ['jpeg', 'png', 'webp'], MAX_IMAGE_B64);
    str('prompt', 1200); str('negative', 600);
    one('resolution', ['480p', '720p']); one('aspect', ['16:9', '9:16', '1:1']); one('model', ['wan-fast', 'wan']);
    if ((i.model || 'wan-fast') === 'wan-fast') {
      if (i.steps != null && i.steps !== 3) fail('steps: the fast model runs exactly 3 steps. Send model "wan" for 4 to 40 steps.');
      if (i.negative) fail('negative needs model "wan".');
    } else num('steps', 4, 40, true);
  } else if (job === 'music') {
    str('tags', 600, true); str('lyrics', 4000);
    num('duration', 10, 180); num('bpm', 40, 220, true); one('key', KEYS); one('timesignature', ['2', '3', '4', '6', 2, 3, 4, 6]);
  } else if (job === 'upscale') {
    media('image', ['jpeg', 'png', 'webp'], MAX_IMAGE_B64); one('scale', [2, 4]); one('format', ['jpeg', 'webp']);
  } else if (job === 'sound') {
    media('video', ['mp4'], MAX_VIDEO_B64); str('prompt', 400); str('negative', 300); one('model', ['mmaudio', 'foley']);
    num('steps', 10, (i.model || 'mmaudio') === 'foley' ? 60 : 50, true);
  } else if (job === 'fibo') {
    one('mode', ['generate', 'edit']); one('aspect', ['1:1', '16:9', '9:16', '4:5', '5:4', '3:2', '2:3', '2.39:1', '1.85:1']); num('steps', 2, 8, true);
    if (i.prompt == null && i.shot == null) fail('prompt or shot is required.');
    if (typeof i.prompt === 'string') str('prompt', 4000);
    else if (i.prompt != null && (typeof i.prompt !== 'object' || JSON.stringify(i.prompt).length > 12000)) fail('prompt must be text or a JSON caption under 12 kB.');
    if (i.shot != null && (typeof i.shot !== 'object' || Array.isArray(i.shot) || JSON.stringify(i.shot).length > 4000)) fail('shot must be an object.');
    if (i.mode === 'edit') media('image', ['jpeg', 'png', 'webp'], MAX_IMAGE_B64);
  }
  return { job, input: i, seconds: jobSeconds(job, i) };
}

const int = (v, def, lo, hi) => {
  if (v === undefined || v === null || v === '') return def;
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : NaN;
};

/**
 * GPU settings from Worker vars. Any value that is set but invalid turns GPU jobs off (fail closed).
 *   GPU_ENDPOINT_ID, RUNPOD_API_KEY         required
 *   GPU_DAILY_BUDGET_CENTS (0 = off)         one daily budget for every hosted job, MOSS included, 0..1000
 *   GPU_CENTS_PER_HOUR (76)                  price of the main endpoint's GPU while it runs, 1..500
 *   GPU_PER_USER_DAILY (3)                   jobs per signed-in user per UTC day, 1..50
 *   LAB_ENABLED ("true" to allow), LAB_ENDPOINT_ID, LAB_CENTS_PER_HOUR (= GPU_CENTS_PER_HOUR)
 *   MOSS_CENTS_PER_HOUR (122)                to settle MOSS images against the daily budget
 */
export function gpuSettings(env) {
  const daily = int(env.GPU_DAILY_BUDGET_CENTS, 0, 0, 1000);
  const rate = int(env.GPU_CENTS_PER_HOUR, 76, 1, 500);
  const perUser = int(env.GPU_PER_USER_DAILY, 3, 1, 50);
  const labRate = int(env.LAB_CENTS_PER_HOUR, rate, 1, 500);
  const mossRate = int(env.MOSS_CENTS_PER_HOUR, 122, 1, 500);
  const valid = [daily, rate, perUser, labRate, mossRate].every(Number.isFinite);
  const on = valid && daily > 0 && !!(env.GPU_ENDPOINT_ID && env.RUNPOD_API_KEY);
  const lab = on && env.LAB_ENABLED === 'true' && !!env.LAB_ENDPOINT_ID && Number.isFinite(labRate);
  return { valid, on, lab, daily: valid ? daily : 0, rate, labRate, mossRate, perUser };
}

/** Cents reserved before a job is sent: its whole executionTimeout plus cold start and idle time. */
export function reserveCents(seconds, centsPerHour) {
  return Math.ceil(((seconds + STARTUP_SEC + COLD_SEC + IDLE_SEC) * centsPerHour) / 3600);
}

/** Cents a finished RunPod job really cost; null when RunPod did not say (then the reservation stands). */
export function actualCents(status, centsPerHour) {
  const exec = Number(status && status.executionTime) / 1000;
  if (!Number.isFinite(exec) || exec <= 0) return status && status.status === 'CANCELLED' && !status.executionTime ? 0 : null;
  const cold = Math.min(Number(status.delayTime || 0) / 1000, COLD_SEC);
  return Math.ceil(((exec + cold + IDLE_SEC) * centsPerHour) / 3600);
}

export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
