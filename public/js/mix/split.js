// One finished song in, four stems out (vocals, drums, bass, music), on this device. See split-worker.js.

import { decode } from '../extract.js';
import { RATE, MAX_SECONDS } from './engine.js';

let worker = null;
const spawn = () => (worker ||= new Worker(new URL('./split-worker.js', import.meta.url), { type: 'module' }));

/** Can this browser run the splitter on its graphics chip? (Without it the splitter still runs, slowly.) */
export async function gpuReady() {
  try { return !!(navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; }
}

/** Start downloading the model while the person picks a genre. Resolves when it's on this device. */
export function prefetch(onEvent) {
  return new Promise((resolve) => {
    const w = spawn(), prev = w.onmessage;
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress') onEvent?.(d);
      if (d.type === 'ready' || d.type === 'error') { w.onmessage = prev; resolve(d.type === 'ready'); }
    };
    w.postMessage({ type: 'prefetch' });
  });
}

/** Decode a song for splitting and for the page: stereo at 44.1 kHz plus a few hundred peaks to draw. */
export async function openSong(file) {
  const pcm = await decode(file, RATE);
  if (pcm.duration > MAX_SECONDS) throw new Error(`That song is ${Math.round(pcm.duration / 60)} minutes long. Mix songs up to ${MAX_SECONDS / 60} minutes.`);
  if (pcm.duration < 3) throw new Error('That file is only a few seconds long. Drop the whole song.');
  const L = Float32Array.from(pcm.getChannelData(0)), R = pcm.numberOfChannels > 1 ? Float32Array.from(pcm.getChannelData(1)) : L.slice();
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
    const stop = () => { w.postMessage({ type: 'cancel' }); reject(new DOMException('Cancelled', 'AbortError')); };
    if (signal?.aborted) return stop();
    signal?.addEventListener('abort', stop, { once: true });
    w.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'done') { signal?.removeEventListener('abort', stop); resolve(d); }
      else if (d.type === 'error') { signal?.removeEventListener('abort', stop); reject(d.message === 'Cancelled' ? new DOMException('Cancelled', 'AbortError') : new Error(d.message)); }
      else onEvent?.(d);
    };
    w.onerror = (e) => { worker = null; reject(new Error(e.message || 'The splitter stopped. Try again, or use Quick polish.')); };
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
