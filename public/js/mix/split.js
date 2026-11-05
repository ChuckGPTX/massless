// One finished song in, four stems out (vocals, drums, bass, music), on this device. See split-worker.js.

import { decode } from '../extract.js';
import { RATE, MAX_SECONDS } from './engine.js';

let worker = null;
const spawn = () => (worker ||= new Worker(new URL('./split-worker.js', import.meta.url), { type: 'module' }));

/** Can this browser run the splitter on its graphics chip? (Without it the splitter still runs, slowly.) */
export async function gpuReady() {
  try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; }
}

/**
 * Can this device hold the splitter? Running HT-Demucs takes about 3 GB of memory (measured: 2.9-3.7 GB on the
 * processor, more than 3 GB through WebGPU), far more than a phone browser lets one tab use; the tab is killed and
 * reloads. Phones and tablets, devices that report under 8 GB, and any browser where a split already died, say no.
 */
export function deviceFitsSplit() {
  if (typeof navigator === 'undefined') return true;
  try { if (localStorage.getItem('mix-split-crashed')) return false; } catch { /* storage blocked */ }
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (mobile) return false;
  if (navigator.deviceMemory && navigator.deviceMemory < 8) return false;
  return true;
}

/** Download the model into this browser's cache while the person picks a genre. Nothing is built yet. */
export function prefetch(onEvent) {
  return new Promise((resolve) => {
    const w = new Worker(new URL('./split-worker.js', import.meta.url), { type: 'module' });
    const done = (ok) => { w.terminate(); resolve(ok); };
    w.onmessage = (e) => { const d = e.data; if (d.type === 'progress') onEvent?.(d); else if (d.type === 'ready') done(true); else if (d.type === 'error') done(false); };
    w.onerror = () => done(false);
    w.postMessage({ type: 'prefetch' });
  });
}

/** Decode a song for splitting and for the page: stereo at 44.1 kHz plus a few hundred peaks to draw. */
export async function openSong(file) {
  const pcm = await decode(file, RATE);
  if (pcm.duration > MAX_SECONDS) throw new Error(`That song is ${Math.round(pcm.duration / 60)} minutes long. Mix songs up to ${MAX_SECONDS / 60} minutes.`);
  if (pcm.duration < 3) throw new Error('That file is only a few seconds long. Drop the whole song.');
  // The decoder's own arrays, not copies: nothing writes to them (the splitter and the mixer take copies), and on a
  // phone every 40 MB a minute of stereo song costs matters.
  const L = pcm.getChannelData(0), R = pcm.numberOfChannels > 1 ? pcm.getChannelData(1) : L;
  return { channels: [L, R], duration: pcm.duration, peaks: peaksOf([L, R], 600) };
}

export function peaksOf(chs, bins = 600) {
  const n = chs[0].length, step = n / bins, out = new Float32Array(bins);
  for (let b = 0; b < bins; b++) {
    let m = 0;
    for (let i = Math.floor(b * step), e = Math.min(n, Math.floor((b + 1) * step)); i < e; i += 16) m = Math.max(m, Math.abs(chs[0][i]), Math.abs(chs[1]?.[i] || 0));
    out[b] = m;
  }
  return Array.from(out);
}

/**
 * Split decoded channels. onEvent gets { type: 'progress', stage, value, label } while the model downloads and loads,
 * then { type: 'segment', index, total, start, levels, backend, value, eta } for every 7.8 s window.
 * Resolves to { stems: { vocals, drums, bass, other }: [L, R], backend, seconds }.
 */
export function splitSong(channels, { onEvent, signal } = {}) {
  const w = spawn();
  return new Promise((resolve, reject) => {
    const stop = () => { w.terminate(); if (worker === w) worker = null; reject(new DOMException('Cancelled', 'AbortError')); };
    if (signal?.aborted) return stop();
    signal?.addEventListener('abort', stop, { once: true });
    // The worker's memory (gigabytes of WebAssembly heap, which never shrinks) goes back as soon as it's done.
    const end = () => { signal?.removeEventListener('abort', stop); w.terminate(); if (worker === w) worker = null; };
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'done') { end(); resolve(d); }
      else if (d.type === 'error') { end(); reject(d.message === 'Cancelled' ? new DOMException('Cancelled', 'AbortError') : new Error(/memory|alloc|OOM|RangeError/i.test(d.message) ? 'This device ran out of memory splitting the song. Use Quick polish, or Split & mix on a computer.' : d.message)); }
      else onEvent?.(d);
    };
    w.onerror = (e) => { end(); reject(new Error(e.message || 'The splitter stopped. Try again, or use Quick polish.')); };
    // copies: the page keeps the song for the before/after and the rough
    const L = channels[0].slice(), R = channels[1].slice();
    w.postMessage({ type: 'split', left: L, right: R }, [L.buffer, R.buffer]);
  });
}

/** The split stems as tracks for the mixer, with their roles. The bass is an 808 in genres built on one. */
export function stemsFromSplit(stems, genre) {
  const parts = [
    ['vocals', 'Vocals', 'leadVox'],
    ['drums', 'Drums', 'drums'],
    ['bass', ['trap', 'drill', 'hiphop'].includes(genre) ? '808' : 'Bass', ['trap', 'drill', 'hiphop'].includes(genre) ? '808' : 'bass'],
    ['other', 'Music', 'music'],
  ];
  return {
    stems: parts.map(([id, name]) => ({ name, path: `${name}.wav`, size: stems[id][0].length * 8, channels: stems[id] })),
    roles: parts.map(([, , role]) => role),
  };
}
