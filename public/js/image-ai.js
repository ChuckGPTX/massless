// Main-thread side of the image tools: talks to the model worker and reports what a first use downloads.

import { RUNTIME, MODELS, modelFile, CACHE_NAME, mb } from './image-models.js';

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./image-ai-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    if (data.type === 'progress') job.onProgress?.(data.fraction, data.label);
    else {
      pending.delete(data.id);
      if (data.type === 'done') job.resolve(data.result);
      else job.reject(new Error(data.message));
    }
  };
  worker.onerror = (e) => {
    for (const job of pending.values()) job.reject(new Error(e.message || 'The image tools stopped unexpectedly.'));
    pending.clear();
    worker = null;
  };
  return worker;
}

/** Run a job in the worker: 'remove-bg', 'upscale' or 'erase'. Buffers in `transfer` move to the worker. */
export function runJob(type, payload, { transfer = [], onProgress } = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, type, payload }, transfer);
  });
}

let gpu = null;
export function hasWebGPU() {
  gpu ||= (async () => {
    try {
      return !!(navigator.gpu && (await navigator.gpu.requestAdapter()));
    } catch {
      return false;
    }
  })();
  return gpu;
}

async function cachedURLs() {
  try {
    const c = await caches.open(CACHE_NAME);
    return new Set((await c.keys()).map((r) => r.url));
  } catch {
    return new Set();
  }
}

/**
 * What the first use of a model downloads on this device: { bytes, text }. bytes is 0 when it is all cached.
 */
export async function downloadNote(id) {
  const m = MODELS[id];
  const backend = m.files.webgpu && (await hasWebGPU()) ? 'webgpu' : 'wasm';
  const have = await cachedURLs();
  const abs = (u) => new URL(u, location.origin).href;
  const need = [modelFile(id, backend), RUNTIME.lib, RUNTIME.wasm].filter((f) => !have.has(abs(f.url)));
  const bytes = need.reduce((a, f) => a + f.size, 0);
  const model = modelFile(id, backend);
  if (!bytes) return { bytes, text: `${m.name} is saved on this device. Runs here; nothing is uploaded.` };
  const runtime = need.includes(RUNTIME.wasm);
  return {
    bytes,
    text: `Runs on this device; nothing is uploaded. First use downloads ${m.name} (${mb(model.size)}${m.files.webgpu && m.files.webgpu.size !== m.files.wasm.size ? backend === 'webgpu' ? ', WebGPU' : ', no WebGPU here' : ''})${runtime ? ` and the AI runtime (${mb(RUNTIME.lib.size + RUNTIME.wasm.size)})` : ''} once, then keeps ${need.length > 1 ? 'them' : 'it'} in this browser.`,
  };
}

/** Delete every downloaded model and the runtime from this browser. */
export async function clearModels() {
  try {
    return await caches.delete(CACHE_NAME);
  } catch {
    return false;
  }
}
