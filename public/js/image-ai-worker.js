// The model worker for the Edit page's image tools. Runs ONNX Runtime Web off the main thread so the page
// stays responsive: WebGPU when the browser offers it, WebAssembly otherwise.
// Every runtime and model file is fetched at a pinned version, checked against its SHA-256 before use and
// kept in this browser's Cache API, so later visits load from the device. Images never leave the tab.

import { RUNTIME, MODELS, modelFile, CACHE_NAME, mb } from './image-models.js';
import {
  rgbaToCHW, toMatte, upscaleTiled, downsample2x, miganInputs, applyFill, maskBox, contextRect,
  cropRGBA, cropChannel, resizeRGBA, resizeChannel, pasteHole, fitWithin, ESRGAN_REACH,
} from './image-tools.js';
import { inpaint } from './effects.js';

let progress = () => {};
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

async function sha256(buf) {
  return hex(await crypto.subtle.digest('SHA-256', buf));
}

/** Download (or read from the Cache API) one pinned file and check its SHA-256. */
async function fetchVerified(file, label) {
  const url = new URL(file.url, self.location.origin).href;
  let cache = null;
  try {
    cache = await caches.open(CACHE_NAME);
  } catch {
    /* no Cache API (private mode): download every time */
  }
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        progress(0, 'Getting ready…');
        const buf = await hit.arrayBuffer();
        if ((await sha256(buf)) === file.sha256) return buf;
        await cache.delete(url);
      }
    } catch {
      /* fall through to a fresh download */
    }
  }
  let res;
  try {
    res = await fetch(url, { credentials: 'omit' });
  } catch {
    throw new Error('Could not get this tool ready. Check your connection and try again.');
  }
  if (!res.ok || !res.body) throw new Error('Could not get this tool ready. Try again in a moment.');
  const buf = new Uint8Array(file.size);
  const reader = res.body.getReader();
  let got = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > file.size) throw new Error('Could not get this tool ready. Try again in a moment.');
    buf.set(value, got);
    got += value.length;
    if (got - last > 1 << 20 || got === file.size) {
      last = got;
      progress(got / file.size, 'Getting ready… (first time only)');
    }
  }
  if (got !== file.size || (await sha256(buf.buffer)) !== file.sha256) {
    throw new Error('Could not get this tool ready. Try again in a moment.');
  }
  if (cache) {
    try {
      await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }));
    } catch {
      /* storage full: it still runs now, it just downloads again next time */
    }
  }
  return buf.buffer;
}

let ortPromise = null;
function loadRuntime() {
  ortPromise ||= (async () => {
    const lib = await fetchVerified(RUNTIME.lib, 'the AI runtime');
    const wasm = await fetchVerified(RUNTIME.wasm, 'the AI runtime');
    const url = URL.createObjectURL(new Blob([lib], { type: 'text/javascript' }));
    let ort;
    try {
      ort = await import(/* @vite-ignore */ url);
    } finally {
      URL.revokeObjectURL(url);
    }
    ort.env.wasm.wasmBinary = wasm; // the checked bytes; the runtime never fetches its own
    ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, which this site does not set
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'error';
    return ort;
  })();
  ortPromise.catch(() => (ortPromise = null));
  return ortPromise;
}

let gpuPromise = null;
const hasWebGPU = () =>
  (gpuPromise ||= (async () => {
    try {
      return !!(self.navigator?.gpu && (await navigator.gpu.requestAdapter()));
    } catch {
      return false;
    }
  })());

const sessions = new Map();
const gpuFailed = new Set();

/** One model in memory at a time: the big ones need most of what a tab can hold. */
async function session(id) {
  if (sessions.has(id)) return sessions.get(id);
  for (const [k, s] of sessions) {
    sessions.delete(k);
    try {
      await s.session.release();
    } catch {
      /* already gone */
    }
  }
  const ort = await loadRuntime();
  const m = MODELS[id];
  const backends = m.files.webgpu && !gpuFailed.has(id) && (await hasWebGPU()) ? ['webgpu', 'wasm'] : ['wasm'];
  let lastErr;
  for (const backend of backends) {
    try {
      const file = modelFile(id, backend);
      const bytes = await fetchVerified(file, `${m.name} (${mb(file.size)})`);
      progress(1, 'Getting ready…');
      const s = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: [backend], graphOptimizationLevel: 'all' });
      const entry = { session: s, backend, ort };
      sessions.set(id, entry);
      return entry;
    } catch (e) {
      lastErr = e;
      if (backend === 'webgpu') gpuFailed.add(id);
    }
  }
  throw lastErr || new Error('This tool could not start on this device.');
}

/** Run fn(session entry); if WebGPU fails mid-run, retry once on WebAssembly. */
async function withModel(id, fn) {
  const entry = await session(id);
  try {
    return await fn(entry);
  } catch (e) {
    if (entry.backend !== 'webgpu') throw e;
    gpuFailed.add(id);
    sessions.delete(id);
    try {
      await entry.session.release();
    } catch {
      /* ignore */
    }
    return fn(await session(id));
  }
}

// ---------------------------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------------------------

async function removeBackground({ model, rgba, w, h }) {
  const birefnet = model === 'birefnet';
  return withModel(model, async ({ session: s, ort, backend }) => {
    progress(1, 'Finding the subject');
    const chw = birefnet
      ? rgbaToCHW(rgba, w, null, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
      : rgbaToCHW(rgba, w, null, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    const name = birefnet ? 'input_image' : 'input';
    const out = await s.run({ [name]: new ort.Tensor('float32', chw, [1, 3, h, w]) });
    const t = out[birefnet ? 'output_image' : 'output'];
    const matte = toMatte(t.data, birefnet);
    t.dispose?.();
    return { result: { matte, w, h, backend }, transfer: [matte.buffer] };
  });
}

async function upscale({ rgba, w, h, factor }) {
  return withModel('esrgan', async ({ session: s, ort, backend }) => {
    const core = backend === 'webgpu' ? 320 : 160;
    progress(0, 'Upscaling');
    const up = await upscaleTiled(
      rgba, w, h, 4,
      async (chw, sw, sh) => {
        const out = await s.run({ input: new ort.Tensor('float32', chw, [1, 3, sh, sw]) });
        const data = out.output.data;
        return data;
      },
      { core, pad: ESRGAN_REACH, onTile: (i, n) => progress(i / n, `Upscaling: part ${i} of ${n}`) },
    );
    const res = factor === 2 ? downsample2x(up.data, up.w, up.h) : up;
    return { result: { data: res.data, w: res.w, h: res.h, backend }, transfer: [res.data.buffer] };
  });
}

async function erase({ rgba, w, h, hole, method }) {
  const box = maskBox(hole, w, h);
  if (!box) throw new Error('Paint over what you want to remove first.');
  if (method === 'migan') {
    return withModel('migan', async ({ session: s, ort, backend }) => {
      progress(1, 'Filling in');
      const rect = contextRect(box, w, h, 1.5, 128);
      const crop = cropRGBA(rgba, w, rect);
      const holeCrop = cropChannel(hole, w, rect);
      const { image, mask } = miganInputs(crop, holeCrop, rect.w, rect.h);
      const out = await s.run({
        image: new ort.Tensor('uint8', image, [1, 3, rect.h, rect.w]),
        mask: new ort.Tensor('uint8', mask, [1, 1, rect.h, rect.w]),
      });
      const filled = applyFill(crop, out.result.data, holeCrop, rect.w, rect.h);
      const data = pasteHole(rgba, w, filled, rect, holeCrop);
      return { result: { data, w, h, backend }, transfer: [data.buffer] };
    });
  }
  // Texture copy (PatchMatch, as in the Video page's clean plate): no download, works anywhere
  progress(0.5, 'Filling in');
  const rect = contextRect(box, w, h, 0.75, 32);
  const crop = cropRGBA(rgba, w, rect);
  const holeCrop = cropChannel(hole, w, rect);
  const small = fitWithin(rect.w, rect.h, 512);
  const c = small.scaled ? resizeRGBA(crop, rect.w, rect.h, small.w, small.h) : crop;
  const hs = small.scaled ? resizeChannel(holeCrop.map((v) => v * 255), rect.w, rect.h, small.w, small.h).map((v) => (v > 0 ? 1 : 0)) : holeCrop;
  const n = small.w * small.h;
  const chans = [0, 1, 2].map((k) => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = c[i * 4 + k];
    return a;
  });
  inpaint(chans, small.w, small.h, hs);
  const filledSmall = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    filledSmall[i * 4] = chans[0][i];
    filledSmall[i * 4 + 1] = chans[1][i];
    filledSmall[i * 4 + 2] = chans[2][i];
    filledSmall[i * 4 + 3] = 255;
  }
  const filled = small.scaled ? resizeRGBA(filledSmall, small.w, small.h, rect.w, rect.h) : filledSmall;
  const data = pasteHole(rgba, w, filled, rect, holeCrop);
  return { result: { data, w, h, backend: 'cpu' }, transfer: [data.buffer] };
}

const JOBS = { 'remove-bg': removeBackground, upscale, erase };

self.onmessage = async ({ data: { id, type, payload } }) => {
  progress = (fraction, label) => self.postMessage({ id, type: 'progress', fraction, label });
  try {
    const job = JOBS[type];
    if (!job) throw new Error(`Unknown job ${type}`);
    const { result, transfer } = await job(payload);
    self.postMessage({ id, type: 'done', result }, transfer);
  } catch (e) {
    const msg = String(e?.message || e);
    const memory = /bad_alloc|out of memory|Aborted|RangeError/i.test(msg);
    self.postMessage({
      id,
      type: 'error',
      message: memory ? 'This device ran out of memory for that model. Try a smaller image, or the lighter option.' : msg,
    });
  }
};
