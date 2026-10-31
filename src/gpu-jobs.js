// GPU jobs on the Massless RunPod worker (workers/gpu): what each job may contain, how long it may run and
// what it may cost. The GenerationLedger (src/generations.js) uses this to reserve money before a job is sent
// and to settle the real cost after. Every number here mirrors workers/gpu/handler.py, which checks the input
// again on the GPU (tests/fixtures/gpu_timeouts.json is checked against both).

export const MAIN_JOBS = ['animate', 'motion', 'lipsync', 'upscale_video', 'music', 'upscale'];
export const LAB_JOBS = ['sound', 'fibo'];
export const STARTUP_SEC = 90; // container start + ComfyUI boot inside a fresh worker, counted in RunPod's executionTime
export const COLD_SEC = 45; // billed boot time RunPod reports inside delayTime (the rest of delayTime is queueing)
export const IDLE_SEC = 5; // the endpoint's idle timeout, billed after the last job
export const QUEUE_SEC = 900; // how long a job may wait for the single worker before RunPod drops it
export const DEFAULT_CENTS_PER_HOUR = 539; // H100 80GB PRO, the dearer of the endpoint's two GPU types (A100 80GB is 272)
const MAX_IMAGE_B64 = 9_500_000;
const MAX_MEDIA_B64 = 9_400_000;
const MAX_REQUEST_B64 = 9_500_000; // RunPod refuses /run bodies over 10 MB
// HunyuanVideo-Foley's license (Tencent Hunyuan Community) does not cover the EU, the UK or South Korea.
export const FOLEY_BLOCKED = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'KR']);
const KEYS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'].flatMap((r) => [`${r} major`, `${r} minor`]);
const FIELDS = {
  animate: ['image', 'prompt', 'negative', 'resolution', 'aspect', 'seed', 'steps', 'mode', 'cfg'],
  motion: ['image', 'video', 'prompt', 'seed', 'steps', 'keep_audio'],
  lipsync: ['image', 'audio', 'prompt', 'aspect', 'seed', 'steps', 'mode'],
  upscale_video: ['video', 'scale', 'seed'],
  music: ['tags', 'lyrics', 'duration', 'bpm', 'key', 'timesignature', 'language', 'seed'],
  upscale: ['image', 'scale', 'format'],
  sound: ['video', 'prompt', 'negative', 'model', 'seed', 'steps'],
  fibo: ['mode', 'prompt', 'shot', 'image', 'aspect', 'seed', 'steps'],
};

// Timing model for an A100 80GB (the slower GPU the endpoint may get; an H100 is about twice as fast). One Wan 14B
// pass over an 81-frame clip: ~11 s at 480p, ~40 s at 720p; "best" runs CFG (~1.8x a pass). Timeout = the cold
// model load from the network volume + 1.5x the warm estimate, rounded up to 30 s. Clip jobs assume the longest
// clip (10 s); the handler's own deadline uses the real length, so it is never longer than this.
const COLD_LOAD = { animate: 120, motion: 120, lipsync: 90, upscale_video: 60, music: 0, upscale: 0, sound: 0, fibo: 0 };
const WAN_PASS = { '480p': 11, '720p': 40 };
const WAN_OVERHEAD = { '480p': 20, '720p': 45 };
export const STEPS = {
  'animate:quick': [4, 8, 4], 'animate:best:480p': [10, 30, 20], 'animate:best:720p': [10, 20, 20],
  'lipsync:quick': [4, 8, 4], 'lipsync:best': [10, 20, 20], motion: [6, 12, 10],
};
const MOTION_PASS = 15; // one Wan-Animate-2 pass over a 21-latent-frame window at 480p
const S2V_PASS = 13; // one S2V pass over a 77-frame chunk at 480p
const SEEDVR2_FRAME = 0.9; // seconds per 1920x1080 output frame
const ceil30 = (x) => 30 * Math.ceil(x / 30 - 1e-9);
const evals = (mode, steps) => (mode === 'best' ? steps * 1.8 : steps);
const stepsOf = (key, i) => Number(i.steps ?? STEPS[key][2]);
const resOf = (i) => (i.resolution === '720p' ? '720p' : '480p');
const modeOf = (i) => (i.mode === 'best' ? 'best' : 'quick');
const motionWindows = (frames) => {
  const latent = Math.floor((frames - 1) / 4) + 2; // + the reference frame
  return latent <= 21 ? 1 : 1 + Math.ceil((latent - 21) / 13);
};

/** Expected GPU seconds once the worker is warm (models loaded), for the longest input the job accepts. */
export function estimateSeconds(job, i = {}) {
  if (job === 'animate') {
    const r = resOf(i), m = modeOf(i);
    return WAN_OVERHEAD[r] + WAN_PASS[r] * evals(m, stepsOf(m === 'best' ? `animate:best:${r}` : 'animate:quick', i));
  }
  if (job === 'motion') return 40 + MOTION_PASS * motionWindows(161) * stepsOf('motion', i);
  if (job === 'lipsync') return 30 + S2V_PASS * 3 * evals(modeOf(i), stepsOf(`lipsync:${modeOf(i)}`, i));
  if (job === 'upscale_video') return 20 + SEEDVR2_FRAME * 300;
  if (job === 'music') return 10 + 0.25 * Number(i.duration ?? 30);
  if (job === 'upscale') return 15;
  if (job === 'sound') return (i.model || 'mmaudio') === 'foley' ? 90 : 45;
  if (job === 'fibo') return 40;
  throw new Error('Unknown job.');
}

/** Worst-case run time in seconds: the timeout the handler enforces and RunPod's executionTimeout (less boot). */
export function jobSeconds(job, i = {}) {
  if (job === 'music') return 90 + Number(i.duration ?? 30);
  if (job === 'upscale') return 150;
  if (job === 'sound') return (i.model || 'mmaudio') === 'foley' ? 210 : 120;
  if (job === 'fibo') return 240;
  return COLD_LOAD[job] + ceil30(1.5 * estimateSeconds(job, i));
}

// The first bytes of a base64 file, decoded, say what it is.
function kind(s) {
  const v = s.startsWith('data:') ? s.slice(s.indexOf(',') + 1) : s;
  let b;
  try {
    b = Uint8Array.from(atob(v.slice(0, 24)), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const at = (o, str) => [...str].every((c, k) => b[o + k] === c.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && at(1, 'PNG')) return 'png';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'webp';
  if (at(0, 'RIFF') && at(8, 'WAVE')) return 'wav';
  if (at(4, 'ftyp')) return at(8, 'M4A ') || at(8, 'M4B ') ? 'm4a' : at(8, 'qt  ') ? 'mov' : 'mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (at(0, 'OggS')) return 'ogg';
  if (at(0, 'fLaC')) return 'flac';
  if (at(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'mp3';
  return null;
}

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
  const steps = (key) => num('steps', STEPS[key][0], STEPS[key][1], true);
  const one = (k, opts) => { if (i[k] != null && !opts.includes(i[k])) fail(`${k} must be one of ${opts.join(', ')}.`); };
  const media = (k, kinds, max) => {
    if (typeof i[k] !== 'string' || !i[k]) fail(`${k} is required.`);
    if (i[k].length > max) fail(`${k} is ${(i[k].length / 1e6).toFixed(1)} MB as base64; the limit is ${(max / 1e6).toFixed(1)} MB.`);
    if (!kinds.includes(kind(i[k]))) fail(`${k} must be ${kinds.map((x) => x.toUpperCase()).join(', ')}.`);
  };
  const IMAGE = ['jpeg', 'png', 'webp'], CLIP = ['mp4', 'mov', 'webm'], SPEECH = ['mp3', 'wav', 'm4a', 'ogg', 'flac'];
  num('seed', 0, 4294967295, true);
  if (job === 'animate') {
    if (i.image != null) media('image', IMAGE, MAX_IMAGE_B64);
    str('prompt', 1200, i.image == null); str('negative', 600);
    one('resolution', ['480p', '720p']); one('aspect', ['16:9', '9:16', '1:1']); one('mode', ['quick', 'best']);
    if (modeOf(i) === 'quick') {
      steps('animate:quick');
      if (i.cfg != null) fail('cfg needs mode "best".');
      if (i.negative) fail('negative needs mode "best".');
    } else {
      steps(`animate:best:${resOf(i)}`);
      num('cfg', 1.5, 8);
    }
  } else if (job === 'motion') {
    media('image', IMAGE, MAX_IMAGE_B64); media('video', CLIP, MAX_MEDIA_B64); str('prompt', 1200); steps('motion');
    if (i.keep_audio != null && typeof i.keep_audio !== 'boolean') fail('keep_audio must be true or false.');
  } else if (job === 'lipsync') {
    media('image', IMAGE, MAX_IMAGE_B64); media('audio', SPEECH, MAX_MEDIA_B64); str('prompt', 1200);
    one('aspect', ['16:9', '9:16', '1:1']); one('mode', ['quick', 'best']); steps(`lipsync:${modeOf(i)}`);
  } else if (job === 'upscale_video') {
    media('video', CLIP, MAX_MEDIA_B64); one('scale', [2, 4]);
  } else if (job === 'music') {
    str('tags', 600, true); str('lyrics', 4000);
    num('duration', 10, 180); num('bpm', 40, 220, true); one('key', KEYS); one('timesignature', ['2', '3', '4', '6', 2, 3, 4, 6]);
  } else if (job === 'upscale') {
    media('image', IMAGE, MAX_IMAGE_B64); one('scale', [2, 4]); one('format', ['jpeg', 'webp']);
  } else if (job === 'sound') {
    media('video', ['mp4'], MAX_MEDIA_B64); str('prompt', 400); str('negative', 300); one('model', ['mmaudio', 'foley']);
    num('steps', 10, (i.model || 'mmaudio') === 'foley' ? 60 : 50, true);
  } else if (job === 'fibo') {
    one('mode', ['generate', 'edit']); one('aspect', ['1:1', '16:9', '9:16', '4:5', '5:4', '3:2', '2:3', '2.39:1', '1.85:1']); num('steps', 2, 8, true);
    if (i.prompt == null && i.shot == null) fail('prompt or shot is required.');
    if (typeof i.prompt === 'string') str('prompt', 4000);
    else if (i.prompt != null && (typeof i.prompt !== 'object' || JSON.stringify(i.prompt).length > 12000)) fail('prompt must be text or a JSON caption under 12 kB.');
    if (i.shot != null && (typeof i.shot !== 'object' || Array.isArray(i.shot) || JSON.stringify(i.shot).length > 4000)) fail('shot must be an object.');
    if (i.mode === 'edit') media('image', IMAGE, MAX_IMAGE_B64);
  }
  const total = Object.values(i).reduce((n, v) => n + (typeof v === 'string' ? v.length : 0), 0);
  if (total > MAX_REQUEST_B64) fail(`The files are ${(total / 1e6).toFixed(1)} MB together as base64; the limit is ${(MAX_REQUEST_B64 / 1e6).toFixed(1)} MB. Send a shorter or smaller clip.`);
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
 *   GPU_DAILY_BUDGET_CENTS (0 = off)         one daily budget for every hosted job, MOSS included, 0..10000 (set 500)
 *   GPU_CENTS_PER_HOUR (539)                 price of the main endpoint's GPU while it runs, 1..2000. 539 is the
 *                                            H100 80GB PRO; on an A100 80GB (272) this overstates cost about 2x
 *   GPU_PER_USER_DAILY (10)                  jobs per signed-in user per UTC day, 1..50
 *   LAB_ENABLED ("true" to allow), LAB_ENDPOINT_ID, LAB_CENTS_PER_HOUR (= GPU_CENTS_PER_HOUR)
 *   MOSS_CENTS_PER_HOUR (122)                to settle MOSS images against the daily budget
 */
export function gpuSettings(env) {
  const daily = int(env.GPU_DAILY_BUDGET_CENTS, 0, 0, 10000);
  const rate = int(env.GPU_CENTS_PER_HOUR, DEFAULT_CENTS_PER_HOUR, 1, 2000);
  const perUser = int(env.GPU_PER_USER_DAILY, 10, 1, 50);
  const labRate = int(env.LAB_CENTS_PER_HOUR, rate, 1, 2000);
  const mossRate = int(env.MOSS_CENTS_PER_HOUR, 122, 1, 2000);
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

// What the site shows before a job is sent: a warm run, a cold one (fresh worker, models read from the volume)
// and what is held back from the daily budget until RunPod reports the real time.
export const PRESETS = {
  'animate:quick:480p': ['animate', { mode: 'quick', resolution: '480p' }],
  'animate:quick:720p': ['animate', { mode: 'quick', resolution: '720p' }],
  'animate:best:480p': ['animate', { mode: 'best', resolution: '480p' }],
  'animate:best:720p': ['animate', { mode: 'best', resolution: '720p' }],
  motion: ['motion', {}],
  'lipsync:quick': ['lipsync', { mode: 'quick' }],
  'lipsync:best': ['lipsync', { mode: 'best' }],
  upscale_video: ['upscale_video', {}],
  music: ['music', { duration: 30 }],
  upscale: ['upscale', {}],
};
export function quote(job, input, centsPerHour) {
  const warm = estimateSeconds(job, input);
  const cold = warm + COLD_LOAD[job] + STARTUP_SEC;
  const c = (s) => Math.ceil(((s + IDLE_SEC) * centsPerHour) / 3600);
  return { seconds: Math.round(warm), coldSeconds: Math.round(cold), cents: c(warm), coldCents: c(cold + COLD_SEC), reserveCents: reserveCents(jobSeconds(job, input), centsPerHour) };
}
export function quotes(centsPerHour) {
  return Object.fromEntries(Object.entries(PRESETS).map(([k, [job, i]]) => [k, quote(job, i, centsPerHour)]));
}

export const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
