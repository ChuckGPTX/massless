// Splits one finished song into vocals, drums, bass and the rest of the music, on this device.
// The model is HT-Demucs (Meta AI, MIT), exported to ONNX for the browser by demucs-web (MIT). It runs in
// ONNX Runtime Web: WebGPU when the browser has it, WebAssembly otherwise. Like the image tools, every file is
// fetched at a pinned revision, checked against its SHA-256 and kept in the Cache API, so it downloads once.
// Whatever the model leaves out (the difference between the song and the four parts) goes into "music", so the
// four stems always add back up to exactly the song.

import { RUNTIME } from '../image-models.js';
import { CONSTANTS, prepareModelInput, standaloneMask, standaloneIspec } from '../vendor/demucs-web/demucs.js';

const { TRAINING_SAMPLES: SEG, MODEL_SPEC_BINS: BINS, MODEL_SPEC_FRAMES: FRAMES, SEGMENT_OVERLAP, TRACKS } = CONSTANTS;
export const SPLIT_MODEL = {
  name: 'HT-Demucs',
  license: 'MIT',
  url: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/92e33df61cfc9eb820272aaa62d2ef6dcf4d950d/htdemucs_embedded.onnx',
  sha256: 'e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077',
  size: 180534758,
};
const CACHE = 'massless-models-v1';
const BLOCK = 4410; // one level per 0.1 s for the lanes on the page

const post = (msg, transfer = []) => self.postMessage(msg, transfer);
const say = (stage, value, label) => post({ type: 'progress', stage, value, label });
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (buf) => hex(await crypto.subtle.digest('SHA-256', buf));

/** One pinned file, from this browser's cache or the network, checked before use. */
async function fetchVerified(file, onBytes) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch { /* private mode: download every time */ }
  if (cache) {
    try {
      const hit = await cache.match(file.url);
      if (hit) { const buf = await hit.arrayBuffer(); if ((await sha256(buf)) === file.sha256) return buf; await cache.delete(file.url); }
    } catch { /* fall through */ }
  }
  let res;
  try { res = await fetch(file.url, { credentials: 'omit' }); } catch { throw new Error('Couldn’t download the splitter. Check your connection and try again.'); }
  if (!res.ok || !res.body) throw new Error('Couldn’t download the splitter. Try again in a moment.');
  const buf = new Uint8Array(file.size), reader = res.body.getReader();
  let got = 0, last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > file.size) throw new Error('The splitter download didn’t check out. Try again.');
    buf.set(value, got); got += value.length;
    if (got - last > 1 << 20 || got === file.size) { last = got; onBytes?.(got, file.size); }
  }
  if (got !== file.size || (await sha256(buf.buffer)) !== file.sha256) throw new Error('The splitter download didn’t check out. Try again.');
  if (cache) { try { await cache.put(file.url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })); } catch { /* storage full */ } }
  return buf.buffer;
}

let ortPromise = null;
function runtime() {
  ortPromise ||= (async () => {
    const [lib, wasm] = await Promise.all([fetchVerified(RUNTIME.lib), fetchVerified(RUNTIME.wasm)]);
    const url = URL.createObjectURL(new Blob([lib], { type: 'text/javascript' }));
    let ort;
    try { ort = await import(/* @vite-ignore */ url); } finally { URL.revokeObjectURL(url); }
    ort.env.wasm.wasmBinary = wasm;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    ort.env.wasm.proxy = false;
    ort.env.logLevel = 'error';
    return ort;
  })();
  ortPromise.catch(() => (ortPromise = null));
  return ortPromise;
}

async function hasWebGPU() {
  try { return !!(self.navigator?.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; }
}

let model = null; // { session, backend, ort }
let bytesP = null, loading = null;
/** The default session (WebGPU if it works, else WebAssembly), started once however many callers ask. */
function load(prefer) {
  if (model && (!prefer || model.backend === prefer)) return Promise.resolve(model);
  if (prefer) return open(prefer);
  loading ||= open().finally(() => { loading = null; });
  return loading;
}
async function open(prefer) {
  const ort = await runtime();
  bytesP ||= fetchVerified(SPLIT_MODEL, (got, total) => say('download', got / total, `Getting the splitter ready: ${Math.round(got / 1e6)} of ${Math.round(total / 1e6)} MB, first time only`));
  bytesP.catch(() => { bytesP = null; });
  const bytes = await bytesP;
  const order = prefer ? [prefer] : (await hasWebGPU()) ? ['webgpu', 'wasm'] : ['wasm'];
  let last;
  for (const backend of order) {
    try {
      say('load', 1, backend === 'webgpu' ? 'Warming up your graphics chip' : 'Warming up the splitter');
      if (model) { try { await model.session.release(); } catch { /* gone */ } model = null; }
      const session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: [backend], graphOptimizationLevel: 'basic' });
      model = { session, backend, ort };
      return model;
    } catch (e) { last = e; }
  }
  throw last || new Error('The splitter couldn’t start on this device.');
}

/** One 7.8 s window through the model: four stereo parts, time branch plus the iSTFT of the frequency branch. */
async function runSegment({ session, ort }, segL, segR) {
  const input = prepareModelInput(segL, segR);
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input.waveform, [1, 2, SEG]) };
  if (session.inputNames.length > 1) feeds[session.inputNames[1]] = new ort.Tensor('float32', input.magSpec, [1, 4, BINS, FRAMES]);
  const out = await session.run(feeds);
  let time = null, dims = null, freq = null;
  for (const name of session.outputNames) {
    const t = out[name];
    if (t.dims.length === 4 && t.dims[2] === 2) { time = t.data; dims = t.dims; }
    else if (t.dims.length === 5 && t.dims[2] === 4) freq = t.data;
  }
  if (!time) throw new Error('The splitter returned something unexpected.');
  const n = dims[3], specs = freq ? standaloneMask(freq) : null;
  const parts = [];
  for (let t = 0; t < 4; t++) {
    const f = specs ? standaloneIspec(specs[t], SEG) : null;
    const L = new Float32Array(n), R = new Float32Array(n), base = t * 2 * n;
    for (let i = 0; i < n; i++) { L[i] = time[base + i] + (f ? f.left[i] || 0 : 0); R[i] = time[base + n + i] + (f ? f.right[i] || 0 : 0); }
    parts.push([L, R]);
  }
  for (const k in out) { try { out[k].dispose?.(); } catch { /* fine */ } }
  return parts;
}

async function split(left, right, cancelled) {
  const N = left.length, stride = Math.floor(SEG * (1 - SEGMENT_OVERLAP));
  const segments = Math.max(1, Math.ceil(Math.max(0, N - SEG) / stride) + 1);
  const outs = TRACKS.map(() => [new Float32Array(N), new Float32Array(N)]);
  const weights = new Float32Array(N);
  let m = await load();
  const t0 = performance.now();
  for (let s = 0, start = 0; s < segments; s++, start += stride) {
    if (cancelled()) throw new DOMException('Cancelled', 'AbortError');
    const len = Math.min(SEG, N - start);
    const segL = new Float32Array(SEG), segR = new Float32Array(SEG);
    segL.set(left.subarray(start, start + len)); segR.set(right.subarray(start, start + len));
    let parts;
    try { parts = await runSegment(m, segL, segR); }
    catch (e) {
      if (m.backend !== 'webgpu') throw e;
      m = await load('wasm'); // a graphics chip that gives up mid-song: carry on without it
      parts = await runSegment(m, segL, segR);
    }
    // Triangular cross-fade over the overlap; edges of the song keep full weight.
    const ramp = stride * 0.5;
    for (let i = 0; i < len; i++) {
      const w = Math.max(1e-3, Math.min(start === 0 ? 1 : i / ramp, start + len >= N ? 1 : (len - i) / ramp, 1));
      weights[start + i] += w;
      for (let t = 0; t < 4; t++) { outs[t][0][start + i] += parts[t][0][i] * w; outs[t][1][start + i] += parts[t][1][i] * w; }
    }
    // Levels of the fresh part for the page's lanes.
    const upto = Math.min(len, s === segments - 1 ? len : stride), levels = {};
    TRACKS.forEach((name, t) => {
      const a = [];
      for (let b = 0; b < upto; b += BLOCK) { let pk = 0; for (let i = b; i < Math.min(upto, b + BLOCK); i += 4) pk = Math.max(pk, Math.abs(parts[t][0][i]), Math.abs(parts[t][1][i])); a.push(+pk.toFixed(3)); }
      levels[name] = a;
    });
    const done = (s + 1) / segments, secs = (performance.now() - t0) / 1000;
    post({ type: 'segment', index: s, total: segments, start: start / 44100, levels, backend: m.backend, value: done, eta: Math.round((secs / done) * (1 - done)) });
  }
  for (let i = 0; i < N; i++) {
    const w = weights[i] || 1;
    let sl = 0, sr = 0;
    for (let t = 0; t < 4; t++) { outs[t][0][i] /= w; outs[t][1][i] /= w; sl += outs[t][0][i]; sr += outs[t][1][i]; }
    // Whatever the model missed goes to "other", so the parts add up to the song exactly.
    outs[2][0][i] += left[i] - sl; outs[2][1][i] += right[i] - sr;
  }
  return { stems: Object.fromEntries(TRACKS.map((name, t) => [name, outs[t]])), backend: m.backend, seconds: (performance.now() - t0) / 1000 };
}

let job = 0;
self.onmessage = async (e) => {
  const d = e.data;
  if (d.type === 'cancel') { job++; return; }
  if (d.type === 'prefetch') { try { await load(); post({ type: 'ready', backend: model.backend }); } catch (err) { post({ type: 'error', message: err.message }); } return; }
  if (d.type !== 'split') return;
  const mine = ++job;
  try {
    const r = await split(d.left, d.right || d.left, () => mine !== job);
    const transfer = Object.values(r.stems).flatMap(([L, R]) => [L.buffer, R.buffer]);
    post({ type: 'done', ...r }, transfer);
  } catch (err) {
    post({ type: 'error', message: err.name === 'AbortError' ? 'Cancelled' : err.message || String(err) });
  }
};
