// Where hero frames come from. Every model here has open weights and costs $0 to run.
//  1. Cloudflare Workers AI through our own /api/shot: FLUX.1 schnell, SDXL-Lightning, DreamShaper 8, SDXL 1.0.
//     Free daily allocation, capped server-side.
//  2. Pollinations community API: free, no key, NVIDIA Sana, 1 image per 45 seconds per IP.
//  3. Your own ComfyUI: your GPU, the FLUX.1 schnell workflow in /comfy, no limits.

export const ENGINES = {
  auto: { name: 'Free cloud', detail: 'Cloudflare Workers AI first, Pollinations as backup' },
  workers: { name: 'Cloudflare Workers AI', detail: 'Open models on our Worker, daily cap' },
  pollinations: { name: 'Pollinations', detail: 'Community API, NVIDIA Sana, 1 image per 45 s' },
  comfy: { name: 'Your ComfyUI', detail: 'Local open weights on your GPU' },
};

/** Every model the Image page offers, keyed by id. `server` is the /api/shot model name. */
export const MODELS = {
  'flux-1-schnell': {
    engine: 'workers', server: 'flux-1-schnell', cf: '@cf/black-forest-labs/flux-1-schnell', family: 'flux', group: 'cloudflare',
    name: 'FLUX.1 schnell', short: 'FLUX.1 schnell', note: 'Black Forest Labs. Sharp, follows prompts', licence: 'Apache-2.0',
  },
  'sdxl-lightning': {
    engine: 'workers', server: 'sdxl-lightning', cf: '@cf/bytedance/stable-diffusion-xl-lightning', family: 'sdxl', group: 'cloudflare',
    name: 'SDXL-Lightning', short: 'SDXL-Lightning', note: 'ByteDance. 8 steps, the quickest SDXL', licence: 'OpenRAIL++',
  },
  'dreamshaper-8-lcm': {
    engine: 'workers', server: 'dreamshaper-8-lcm', cf: '@cf/lykon/dreamshaper-8-lcm', family: 'sd15', group: 'cloudflare',
    name: 'DreamShaper 8', short: 'DreamShaper 8', note: 'Lykon. Stylized looks and illustration', licence: 'CreativeML OpenRAIL-M',
  },
  'sdxl-base': {
    engine: 'workers', server: 'sdxl-base', cf: '@cf/stabilityai/stable-diffusion-xl-base-1.0', family: 'sdxl', group: 'cloudflare',
    name: 'SDXL 1.0', short: 'SDXL 1.0', note: 'Stability AI base. 20 steps, slower', licence: 'OpenRAIL++',
  },
  sana: {
    engine: 'pollinations', family: 'sana', group: 'community',
    name: 'Pollinations · Sana', short: 'Sana', note: 'Community API, NVIDIA Sana, 1 image per 45 s', licence: "NVIDIA's licence, open weights",
  },
  comfy: {
    engine: 'comfy', family: 'flux', group: 'gpu',
    name: 'ComfyUI · FLUX.1 schnell', short: 'FLUX.1 schnell · ComfyUI', note: 'Your own GPU, no limits', licence: 'Your choice',
  },
};

export const MODEL_GROUPS = [
  { id: 'cloudflare', name: 'Free on Cloudflare' },
  { id: 'community', name: 'Community' },
  { id: 'gpu', name: 'Your GPU' },
];

export const DEFAULT_MODEL = 'flux-1-schnell';

// Default negative prompt terms, each with the words that mean the prompt asks for it.
const NEGATIVE = [
  ['blurry', 'blur\\w*'],
  ['lowres', 'low[- ]?res\\w*'],
  ['watermark', 'watermark\\w*'],
  ['text', 'text|lettering|typography|caption\\w*'],
  ['deformed hands', 'deformed'],
];

/** True for the diffusion models that take a negative prompt (everything on Cloudflare except FLUX). */
export const takesNegative = (model) => MODELS[model]?.engine === 'workers' && MODELS[model].family !== 'flux';

/**
 * The default negative prompt for SDXL-family models, minus anything the prompt asks for
 * ("motion blur" keeps blur, "a sign with lettering" keeps text; "no text" still counts as avoiding it).
 */
export function negativeFor(model, prompt = '') {
  if (!takesNegative(model)) return '';
  const p = prompt.toLowerCase();
  const wanted = (words) => [...p.matchAll(new RegExp(`(no |without |not )?\\b(?:${words})\\b`, 'g'))].some((m) => !m[1]);
  return NEGATIVE.filter(([, words]) => !wanted(words)).map(([term]) => term).join(', ');
}

/** Request size for /api/shot: the frame's aspect, long side 1024, short side at least 512, multiples of 64. */
export function requestSize(w, h, base = 1024) {
  const r64 = (v) => Math.max(256, Math.min(1536, Math.round(v / 64) * 64));
  const ratio = w / h;
  let long = base;
  let short = base / Math.max(ratio, 1 / ratio);
  if (short < base / 2) { short = base / 2; long = (base / 2) * Math.max(ratio, 1 / ratio); }
  return ratio >= 1 ? { width: r64(long), height: r64(short) } : { width: r64(short), height: r64(long) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function blobToBitmap(blob) {
  if (!blob.type.startsWith('image/')) throw new Error('The engine did not return an image.');
  return await createImageBitmap(blob);
}

async function errorText(res) {
  const j = await res.json().catch(() => null);
  if (!j) return '';
  const e = j.error;
  return String((e && typeof e === 'object' ? e.message : e) || j.message || '').trim();
}

/** Center-crop a bitmap to the requested aspect and size. */
export function cropTo(bitmap, w, h) {
  const target = w / h;
  const src = bitmap.width / bitmap.height;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (src > target) sw = Math.round(sh * target);
  else sh = Math.round(sw / target);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, w, h);
  return c;
}

// Pollinations' anonymous tier allows 1 image per 45 seconds per IP.
const POLLINATIONS_GAP = 45500;
let nextPollinations = 0;

export async function viaPollinations({ prompt, w, h, seed, signal, onWait }) {
  const gap = nextPollinations - Date.now();
  if (gap > 0) {
    onWait?.(gap);
    await sleep(gap);
  }
  nextPollinations = Date.now() + POLLINATIONS_GAP;
  const params = new URLSearchParams({ width: String(w), height: String(h), seed: String(seed), model: 'sana', nologo: 'true', private: 'true', safe: 'true' });
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  signal?.addEventListener('abort', () => ctl.abort());
  try {
    let res;
    try {
      res = await fetch(url, { signal: ctl.signal, mode: 'cors' });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new Error('Could not reach Pollinations. Its free tier allows 1 image per 45 seconds, so try again shortly.');
    }
    if (!res.ok) {
      const retry = Number(res.headers.get('retry-after'));
      if (retry > 0) nextPollinations = Date.now() + retry * 1000;
      const msg = await errorText(res);
      if (msg) throw Object.assign(new Error(`Pollinations: ${msg}`), { retry: res.status === 402 || res.status === 429 || res.status === 503 });
      if (res.status === 429 || res.status === 402) throw Object.assign(new Error('Pollinations allows 1 image per 45 seconds. Try again in a moment.'), { retry: true });
      throw new Error(`Pollinations returned ${res.status}.`);
    }
    const bmp = await blobToBitmap(await res.blob());
    return { image: bmp.width === w && bmp.height === h ? bmp : cropTo(bmp, w, h), engine: 'pollinations', model: 'sana' };
  } finally {
    clearTimeout(timer);
  }
}

/** Request body for /api/shot. Exported so the page and tests can show exactly what is sent. */
export function workersBody({ prompt, w, h, seed, model = DEFAULT_MODEL, negative }) {
  const m = MODELS[model]?.engine === 'workers' ? model : DEFAULT_MODEL;
  // DreamShaper 8 is an SD 1.5 model (native 512 px): a 768 long side avoids repeated subjects
  const body = { prompt, model: MODELS[m].server, ...requestSize(w, h, m === 'dreamshaper-8-lcm' ? 768 : 1024), seed };
  const neg = negative ?? negativeFor(m, prompt);
  if (takesNegative(m) && neg) body.negative = neg;
  return body;
}

export async function viaWorkers(opts) {
  const body = workersBody(opts);
  const res = await fetch('/api/shot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok) {
    const msg = await errorText(res);
    if (res.status === 429) throw Object.assign(new Error(msg || "Today's free Cloudflare frames are used up. Pollinations or your own ComfyUI still work."), { cap: true });
    throw new Error(msg || `Cloudflare Workers AI returned ${res.status}.`);
  }
  const used = res.headers.get('x-massless-model');
  const model = Object.keys(MODELS).find((k) => MODELS[k].cf && MODELS[k].cf === used) || body.model;
  const bmp = await blobToBitmap(await res.blob());
  return { image: cropTo(bmp, opts.w, opts.h), engine: 'workers', model };
}

/** ComfyUI's own HTTP API (start ComfyUI with --enable-cors-header). */
export async function viaComfy({ prompt, w, h, seed, signal, comfyUrl, ckpt, onWait }) {
  const base = comfyUrl.replace(/\/$/, '');
  const wfRes = await fetch(new URL('../comfy/massless_shot_flux_schnell.api.json', import.meta.url));
  const wf = await wfRes.json();
  wf['6'].inputs.text = prompt;
  wf['5'].inputs.width = Math.round(w / 16) * 16;
  wf['5'].inputs.height = Math.round(h / 16) * 16;
  wf['3'].inputs.seed = seed;
  if (ckpt) wf['4'].inputs.ckpt_name = ckpt;
  const clientId = crypto.randomUUID();
  let res;
  try {
    res = await fetch(`${base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: clientId }), signal });
  } catch {
    throw new Error(`Could not reach ComfyUI at ${base}. Start it with --enable-cors-header and allow local network access if your browser asks.`);
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`ComfyUI rejected the workflow: ${t.slice(0, 200)}`);
  }
  const { prompt_id } = await res.json();
  const started = Date.now();
  while (Date.now() - started < 300000) {
    if (signal?.aborted) throw new Error('Cancelled');
    await sleep(1000);
    onWait?.(0);
    const hist = await fetch(`${base}/history/${prompt_id}`, { signal }).then((r) => r.json());
    const entry = hist[prompt_id];
    if (!entry) continue;
    const out = entry.outputs?.['9']?.images?.[0];
    if (!out) {
      if (entry.status?.status_str === 'error') throw new Error('ComfyUI reported an error while running the workflow.');
      continue;
    }
    const q = new URLSearchParams({ filename: out.filename, subfolder: out.subfolder || '', type: out.type || 'output' });
    const img = await fetch(`${base}/view?${q}`, { signal }).then((r) => r.blob());
    const bmp = await blobToBitmap(img);
    return { image: cropTo(bmp, w, h), engine: 'comfy', model: 'comfy' };
  }
  throw new Error('ComfyUI took longer than five minutes.');
}

/**
 * Render one frame. Pass `model` (a MODELS key) to pick a model, or a bare `engine`
 * ('auto' | 'workers' | 'pollinations' | 'comfy'). Resolves to { image, engine, model }.
 */
export async function shoot(opts) {
  const m = MODELS[opts.model];
  const engine = m ? m.engine : opts.engine || 'auto';
  if (engine === 'pollinations') return viaPollinations(opts);
  if (engine === 'workers') return viaWorkers({ ...opts, model: m ? opts.model : DEFAULT_MODEL });
  if (engine === 'comfy') return viaComfy(opts);
  // auto: our Worker (FLUX.1 schnell), then Pollinations
  try {
    return await viaWorkers({ ...opts, model: DEFAULT_MODEL });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    opts.onFallback?.(e);
    return await viaPollinations(opts);
  }
}
