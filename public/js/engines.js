// Where hero frames come from. Every engine runs FLUX.1 [schnell] (Apache-2.0, open weights).
//  1. Pollinations community API: free, no key, about one frame per 15 seconds per visitor.
//  2. Cloudflare Workers AI through our own /api/shot: free daily allocation, capped server-side.
//  3. Your own ComfyUI: your GPU, the workflow in /comfy, no limits.

export const ENGINES = {
  auto: { name: 'Free cloud', detail: 'Pollinations first, Cloudflare Workers AI as backup' },
  pollinations: { name: 'Pollinations', detail: 'Community FLUX.1 schnell, no key' },
  workers: { name: 'Cloudflare Workers AI', detail: 'FLUX.1 schnell on our Worker, daily cap' },
  comfy: { name: 'Your ComfyUI', detail: 'Local open weights on your GPU' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function blobToBitmap(blob) {
  if (!blob.type.startsWith('image/')) throw new Error('The engine did not return an image.');
  return await createImageBitmap(blob);
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

let lastPollinations = 0;

export async function viaPollinations({ prompt, w, h, seed, signal, onWait }) {
  const gap = 15500 - (Date.now() - lastPollinations);
  if (lastPollinations && gap > 0) {
    onWait?.(gap);
    await sleep(gap);
  }
  lastPollinations = Date.now();
  const params = new URLSearchParams({ width: String(w), height: String(h), seed: String(seed), model: 'flux', nologo: 'true', private: 'true', safe: 'true' });
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  signal?.addEventListener('abort', () => ctl.abort());
  try {
    const res = await fetch(url, { signal: ctl.signal, mode: 'cors' });
    if (res.status === 429) throw Object.assign(new Error('Pollinations is busy. Try again in a few seconds.'), { retry: true });
    if (!res.ok) throw new Error(`Pollinations returned ${res.status}.`);
    const bmp = await blobToBitmap(await res.blob());
    return { image: bmp.width === w && bmp.height === h ? bmp : cropTo(bmp, w, h), engine: 'pollinations' };
  } finally {
    clearTimeout(timer);
  }
}

export async function viaWorkers({ prompt, w, h, seed, signal }) {
  const res = await fetch('/api/shot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, seed }),
    signal,
  });
  if (res.status === 429) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || "Today's free Cloudflare frames are used up. Pollinations or your own ComfyUI still work.");
  }
  if (!res.ok) throw new Error(`Cloudflare Workers AI returned ${res.status}.`);
  const bmp = await blobToBitmap(await res.blob());
  return { image: cropTo(bmp, w, h), engine: 'workers' };
}

/** ComfyUI's own HTTP API (start ComfyUI with --enable-cors-header). */
export async function viaComfy({ prompt, w, h, seed, signal, comfyUrl, ckpt, onWait }) {
  const base = comfyUrl.replace(/\/$/, '');
  const wfRes = await fetch('/comfy/massless_shot_flux_schnell.api.json');
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
    return { image: cropTo(bmp, w, h), engine: 'comfy' };
  }
  throw new Error('ComfyUI took longer than five minutes.');
}

export async function shoot(opts) {
  const { engine } = opts;
  if (engine === 'pollinations') return viaPollinations(opts);
  if (engine === 'workers') return viaWorkers(opts);
  if (engine === 'comfy') return viaComfy(opts);
  // auto: Pollinations, then our Worker
  try {
    return await viaPollinations(opts);
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    opts.onFallback?.(e);
    return await viaWorkers(opts);
  }
}
