// Monocular depth in the browser with Depth Anything V2 Small (Apache-2.0, open weights),
// run by Transformers.js on WebGPU when available, otherwise WebAssembly.
// Nothing is uploaded: the image never leaves the visitor's machine.

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
export const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';

let estimatorPromise = null;
let backendLabel = '';

async function hasWebGPU() {
  try {
    if (!('gpu' in navigator)) return false;
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

export function depthBackend() {
  return backendLabel;
}

/** Loads the depth model once. onProgress(fraction 0..1, label). */
export function loadDepth(onProgress = () => {}) {
  if (estimatorPromise) return estimatorPromise;
  estimatorPromise = (async () => {
    const tf = await import(/* @vite-ignore */ TRANSFORMERS_URL);
    tf.env.allowLocalModels = false;
    const files = new Map();
    const progress_callback = (p) => {
      if (p.status === 'progress' && p.total) {
        files.set(p.file, { loaded: p.loaded, total: p.total });
        let l = 0;
        let t = 0;
        for (const f of files.values()) {
          l += f.loaded;
          t += f.total;
        }
        onProgress(t ? l / t : 0, 'Getting ready… (first time only)');
      }
    };
    const gpu = await hasWebGPU();
    const attempts = gpu
      ? [
          { device: 'webgpu', dtype: 'fp16', label: 'WebGPU' },
          { device: 'webgpu', dtype: 'fp32', label: 'WebGPU' },
          { device: 'wasm', dtype: 'q8', label: 'WebAssembly' },
        ]
      : [{ device: 'wasm', dtype: 'q8', label: 'WebAssembly' }];
    let lastErr;
    for (const a of attempts) {
      try {
        const est = await tf.pipeline('depth-estimation', DEPTH_MODEL, { device: a.device, dtype: a.dtype, progress_callback });
        backendLabel = a.label;
        return { est, RawImage: tf.RawImage };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Depth model failed to load');
  })();
  estimatorPromise.catch(() => {
    estimatorPromise = null;
  });
  return estimatorPromise;
}

/** Downscale a source to fit within maxSide, returned as a canvas. */
export function toCanvas(source, maxSide) {
  const s = Math.min(1, maxSide / Math.max(source.width, source.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(source.width * s));
  c.height = Math.max(1, Math.round(source.height * s));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

/**
 * Estimate depth for an image source. Returns { data: Uint8Array (255 = near), w, h, source: 'model' | 'estimate' }.
 */
export async function estimateDepth(source, onProgress) {
  try {
    const { est, RawImage } = await loadDepth(onProgress);
    onProgress?.(1, 'Preparing your still…');
    const small = toCanvas(source, 518);
    const img = RawImage.fromCanvas(small);
    const out = await est(img);
    const raw = out.depth;
    const data = raw.channels === 1 ? raw.data : toGray(raw);
    return { ...refine(new Uint8Array(data), raw.width, raw.height), source: 'model' };
  } catch (err) {
    console.warn('Depth model unavailable, using a geometric estimate instead.', err);
    return { ...heuristicDepth(source), source: 'estimate', error: err };
  }
}

function toGray(raw) {
  const out = new Uint8Array(raw.width * raw.height);
  for (let i = 0; i < out.length; i++) out[i] = raw.data[i * raw.channels];
  return out;
}

/**
 * Clean up a depth map for parallax: stretch the range, grow near regions slightly so the
 * stretch at silhouettes falls on the background, then smooth.
 */
export function refine(data, w, h) {
  let lo = 255;
  let hi = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  let acc = 0;
  const n = data.length;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (lo === 255 && acc > n * 0.01) lo = v;
    if (acc > n * 0.995) { hi = v; break; }
  }
  const span = Math.max(1, hi - lo);
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.max(0, Math.min(255, ((data[i] - lo) / span) * 255));
  // grow near regions past the mesh cell size, so cut cliff triangles fall on background pixels
  const dil = maxFilter(a, w, h, Math.max(2, Math.round(Math.max(w, h) / 110)));
  const b = boxBlur(dil, w, h, Math.max(1, Math.round(Math.max(w, h) / 500)));
  return { data: b, w, h };
}

// Running max/min over a (2r+1) window in linear time (van Herk / Gil-Werman), edges replicated.
function runFilter1D(src, n, r, isMax, get, set, scratch) {
  const W = 2 * r + 1;
  const len = n + 2 * r;
  const pad = scratch.pad;
  const g = scratch.g;
  const hh = scratch.h;
  for (let i = 0; i < len; i++) pad[i] = get(Math.min(n - 1, Math.max(0, i - r)));
  for (let i = 0; i < len; i++) {
    const v = pad[i];
    g[i] = i % W === 0 ? v : isMax ? (v > g[i - 1] ? v : g[i - 1]) : (v < g[i - 1] ? v : g[i - 1]);
  }
  for (let i = len - 1; i >= 0; i--) {
    const v = pad[i];
    hh[i] = i === len - 1 || (i + 1) % W === 0 ? v : isMax ? (v > hh[i + 1] ? v : hh[i + 1]) : (v < hh[i + 1] ? v : hh[i + 1]);
  }
  for (let i = 0; i < n; i++) {
    const x = hh[i];
    const y = g[i + 2 * r];
    set(i, isMax ? (x > y ? x : y) : (x < y ? x : y));
  }
}

function morph(src, w, h, r, isMax) {
  const tmp = new Uint8Array(src.length);
  const out = new Uint8Array(src.length);
  const L = Math.max(w, h) + 2 * r;
  const scratch = { pad: new Uint8Array(L), g: new Uint8Array(L), h: new Uint8Array(L) };
  for (let y = 0; y < h; y++) {
    const row = y * w;
    runFilter1D(src, w, r, isMax, (i) => src[row + i], (i, v) => (tmp[row + i] = v), scratch);
  }
  for (let x = 0; x < w; x++) {
    runFilter1D(tmp, h, r, isMax, (i) => tmp[i * w + x], (i, v) => (out[i * w + x] = v), scratch);
  }
  return out;
}

/** Grayscale dilation and erosion over a (2r+1) square, edges replicated. */
export const maxFilter = (src, w, h, r) => morph(src, w, h, r, true);
export const minFilter = (src, w, h, r) => morph(src, w, h, r, false);

/**
 * Build the background layer that sits behind foreground objects.
 * Pixels on the near side of a depth cliff (within a band as wide as the largest expected reveal)
 * are refilled along their row from whichever neighbor is farther away, for both depth and color.
 * Moving the camera then reveals stretched background, not a ghost of the subject.
 * Returns { bgDepth: Uint8Array, bgColor: ImageData } at the depth map's resolution.
 */
export function backgroundLayer(source, depth, w, h) {
  const R = Math.max(3, Math.round(Math.max(w, h) / 26));
  // cliffs: strong local depth change
  const cliff = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = Math.abs(depth[i + 1] - depth[i - 1]);
      const gy = Math.abs(depth[i + w] - depth[i - w]);
      if (Math.max(gx, gy) > 18) cliff[i] = 255;
    }
  }
  const band = maxFilter(cliff, w, h, R);
  const far = minFilter(depth, w, h, R);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) if (band[i] && depth[i] - far[i] > 16) mask[i] = 1;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const px = img.data;
  const bgDepth = new Uint8Array(depth);

  for (let y = 0; y < h; y++) {
    const row = y * w;
    let x = 0;
    while (x < w) {
      if (!mask[row + x]) { x++; continue; }
      const start = x;
      while (x < w && mask[row + x]) x++;
      const end = x - 1;
      let runMin = 255;
      for (let k = start; k <= end; k++) runMin = Math.min(runMin, depth[row + k]);
      // a neighbor is only a valid source if it is farther away than what it replaces
      let L = start > 0 ? row + start - 1 : -1;
      let Rr = end < w - 1 ? row + end + 1 : -1;
      if (L >= 0 && depth[L] > runMin - 4) L = -1;
      if (Rr >= 0 && depth[Rr] > runMin - 4) Rr = -1;
      if (L < 0 && Rr < 0) {
        for (let k = start; k <= end; k++) mask[row + k] = 0;
        continue;
      }
      for (let k = start; k <= end; k++) {
        const i = row + k;
        let src;
        if (L < 0) src = Rr;
        else if (Rr < 0) src = L;
        else if (Math.abs(depth[L] - depth[Rr]) < 12) src = -2; // similar depth: blend
        else src = depth[L] < depth[Rr] ? L : Rr; // prefer the farther side
        if (src === -2) {
          const t = (k - start + 1) / (end - start + 2);
          for (let ch = 0; ch < 3; ch++) px[i * 4 + ch] = px[L * 4 + ch] * (1 - t) + px[Rr * 4 + ch] * t;
          bgDepth[i] = depth[L] * (1 - t) + depth[Rr] * t;
        } else if (src >= 0) {
          for (let ch = 0; ch < 3; ch++) px[i * 4 + ch] = px[src * 4 + ch];
          bgDepth[i] = depth[src];
        }
      }
    }
  }
  // soften the row streaks inside filled regions
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        for (let ch = 0; ch < 3; ch++) px[i * 4 + ch] = (px[(i - w) * 4 + ch] + 2 * px[i * 4 + ch] + px[(i + w) * 4 + ch]) / 4;
        bgDepth[i] = (bgDepth[i - w] + 2 * bgDepth[i] + bgDepth[i + w]) / 4;
      }
    }
  }
  for (let i = 0; i < bgDepth.length; i++) bgDepth[i] = Math.min(bgDepth[i], depth[i]);
  return { bgDepth, bgColor: img };
}

/** Box blur of a one-channel Uint8Array, radius r. */
export function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Uint8Array(src.length);
  const d = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[y * w + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / d;
      const add = src[y * w + Math.min(w - 1, x + r + 1)];
      const rem = src[y * w + Math.max(0, x - r)];
      s += add - rem;
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / d;
      const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
      const rem = tmp[Math.max(0, y - r) * w + x];
      s += add - rem;
    }
  }
  return out;
}

/** Fallback when the model cannot load: ground plane plus a centered subject bulge, nudged by luminance. */
export function heuristicDepth(source) {
  const c = toCanvas(source, 256);
  const w = c.width;
  const h = c.height;
  const px = c.getContext('2d').getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = y / (h - 1);
      const dx = (x / (w - 1) - 0.5) * 1.6;
      const dy = (v - 0.55) * 1.4;
      const bulge = Math.exp(-(dx * dx + dy * dy) * 2.2);
      const i = (y * w + x) * 4;
      const lum = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
      const d = 0.15 + 0.45 * Math.pow(v, 1.4) + 0.35 * bulge + (0.5 - lum) * 0.06;
      out[y * w + x] = Math.max(0, Math.min(255, d * 255));
    }
  }
  return { data: boxBlur(out, w, h, 3), w, h };
}

/** Quantiles of the depth map in a central window, used to place the pivot and focus marks. */
export function depthStats(data, w, h) {
  const vals = [];
  for (let y = Math.floor(h * 0.2); y < h * 0.9; y += 2) {
    for (let x = Math.floor(w * 0.25); x < w * 0.75; x += 2) vals.push(data[y * w + x]);
  }
  vals.sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] / 255;
  const all = Array.from(data).sort((a, b) => a - b);
  const qa = (p) => all[Math.min(all.length - 1, Math.floor(p * all.length))] / 255;
  return { subject: q(0.8), near: qa(0.97), far: qa(0.08) };
}
