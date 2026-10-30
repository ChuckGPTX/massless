// Free, in-browser audio for Massless.
// Voices: Kokoro-82M (Apache-2.0, open weights) through kokoro-js, on WebGPU when available,
// otherwise WebAssembly. Ambience beds: synthesized from scratch with OfflineAudioContext.
// Kokoro and the beds never leave the visitor's machine. MeloTTS (more languages) sends only the script to
// Cloudflare Workers AI, through /api/tts. No paid API is called.

import { apiFetch } from './human.js';

// kokoro-js bundles its own Transformers.js (3.5.1) and phonemizer, so it loads independently of depth.js.
const KOKORO_URL = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
export const VOICE_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

const VOICE_RATE = 24000; // Kokoro's native output rate
const MAX_CHUNK_CHARS = 300; // ~300 phonemes, well inside Kokoro's 510-token window
const SENTENCE_PAUSE = 0.12; // seconds of silence added between generated chunks
const PARAGRAPH_PAUSE = 0.45;

const BED_RATE = 48000;
const CURVE_RATE = 200; // automation points per second
const FADE = 0.5; // seconds, at each end of a bed
const LEVEL_SPAN = 12; // dB of loudness change across the intensity range
export const MAX_BED_SECONDS = 120;

/** Curated Kokoro voices (all English; kokoro-js 1.2.1 ships 28 English voices). */
export const VOICES = [
  { id: 'af_heart', name: 'Heart', accent: 'American', gender: 'Female', note: 'Warm and natural; the highest-rated Kokoro voice' },
  { id: 'af_bella', name: 'Bella', accent: 'American', gender: 'Female', note: 'Bright and expressive' },
  { id: 'af_nicole', name: 'Nicole', accent: 'American', gender: 'Female', note: 'Soft and close, almost a whisper' },
  { id: 'am_michael', name: 'Michael', accent: 'American', gender: 'Male', note: 'Even, steady narrator' },
  { id: 'am_fenrir', name: 'Fenrir', accent: 'American', gender: 'Male', note: 'Deeper, with more grit' },
  { id: 'am_puck', name: 'Puck', accent: 'American', gender: 'Male', note: 'Lively and playful' },
  { id: 'bf_emma', name: 'Emma', accent: 'British', gender: 'Female', note: 'Clear, composed reader' },
  { id: 'bm_george', name: 'George', accent: 'British', gender: 'Male', note: 'Mature documentary tone' },
];

/** Procedural ambience beds. */
export const BEDS = [
  { id: 'rain', name: 'Rain', note: 'Steady rain with close drops and puddle plinks' },
  { id: 'wind', name: 'Wind', note: 'Gusts that sweep across, whistling at the peaks' },
  { id: 'ocean', name: 'Ocean waves', note: 'Swells that break and fizz back over sand' },
  { id: 'city-night', name: 'City night', note: 'Far traffic hum, passing cars, a distant siren' },
  { id: 'room-tone', name: 'Room tone', note: 'Quiet interior air with a low ventilation hum' },
  { id: 'campfire', name: 'Campfire', note: 'Soft flame roar with crackles and the odd pop' },
  { id: 'forest-birds', name: 'Forest birds', note: 'Leaves in a light breeze, songbirds near and far' },
];

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------------------------

let kokoro = null; // the imported library module
let ttsPromise = null;
let voiceLabel = '';
let wasmOnly = false; // set when WebGPU loaded but failed at run time
const loadListeners = new Set();
let speakQueue = Promise.resolve(); // one generation at a time: an ONNX session runs serially

async function hasWebGPU() {
  try {
    if (!('gpu' in navigator)) return false;
    const adapter = await navigator.gpu.requestAdapter();
    // a software (fallback) adapter would be slower than WebAssembly
    return !!adapter && !(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter);
  } catch {
    return false;
  }
}

/** 'WebGPU' or 'WebAssembly' once the voice model has loaded, '' before. */
export function voiceBackend() {
  return voiceLabel;
}

function reportLoad(fraction, label) {
  for (const fn of loadListeners) {
    try {
      fn(fraction, label);
    } catch (e) {
      console.warn(e);
    }
  }
}

async function createTTS() {
  reportLoad(0, 'Loading the voice engine');
  kokoro ||= await import(/* @vite-ignore */ KOKORO_URL);
  const gpu = !wasmOnly && (await hasWebGPU());
  // kokoro-js recommends fp32 on WebGPU; q8 is the small, fast choice on CPU
  const attempts = gpu
    ? [
        { device: 'webgpu', dtype: 'fp32', label: 'WebGPU' },
        { device: 'wasm', dtype: 'q8', label: 'WebAssembly' },
      ]
    : [{ device: 'wasm', dtype: 'q8', label: 'WebAssembly' }];
  let lastErr;
  for (const a of attempts) {
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
        reportLoad(t ? l / t : 0, 'Downloading the voice model');
      }
    };
    try {
      const tts = await kokoro.KokoroTTS.from_pretrained(VOICE_MODEL, { device: a.device, dtype: a.dtype, progress_callback });
      voiceLabel = a.label;
      reportLoad(1, 'Voice model ready');
      return tts;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Voice model failed to load');
}

function getTTS(onProgress) {
  if (onProgress) loadListeners.add(onProgress);
  if (!ttsPromise) {
    ttsPromise = createTTS();
    ttsPromise.catch(() => {
      ttsPromise = null;
    });
  }
  return ttsPromise.finally(() => onProgress && loadListeners.delete(onProgress));
}

/** Loads Kokoro-82M once and caches it (the browser also caches the files). onProgress(fraction 0..1, label). */
export async function loadVoiceModel(onProgress) {
  await getTTS(onProgress);
}

/**
 * Speak text with a Kokoro voice. Long text is split on sentences (and on clauses or words when a
 * sentence is too long), generated chunk by chunk and joined with short pauses; blank lines become
 * longer paragraph pauses. Returns a mono 16-bit WAV at 24 kHz, peak-normalized to -1 dBFS.
 * Optional onProgress(fraction, label) reports model download and then generation progress.
 */
export function speak(text, { voice = VOICES[0].id, speed = 1, onProgress } = {}) {
  const input = String(text ?? '').trim();
  if (!input) return Promise.reject(new Error('Nothing to speak: the text is empty'));
  const rate = clamp(Number(speed) || 1, 0.5, 2);
  const run = speakQueue.then(async () => {
    let tts = await getTTS(onProgress);
    if (!Object.hasOwn(tts.voices, voice)) {
      throw new Error(`Unknown voice "${voice}". Use one of: ${Object.keys(tts.voices).join(', ')}`);
    }
    let parts;
    try {
      parts = await synthesize(tts, input, voice, rate, onProgress);
    } catch (err) {
      if (voiceLabel !== 'WebGPU') throw err;
      // some GPUs load the model but fail when running it: retry once on WebAssembly
      console.warn('WebGPU voice failed, retrying on WebAssembly.', err);
      wasmOnly = true;
      ttsPromise = null;
      voiceLabel = '';
      tts = await getTTS(onProgress);
      parts = await synthesize(tts, input, voice, rate, onProgress);
    }
    const samples = joinParts(parts);
    const blob = encodeWav([samples], VOICE_RATE);
    return { blob, url: URL.createObjectURL(blob), duration: samples.length / VOICE_RATE, sampleRate: VOICE_RATE };
  });
  speakQueue = run.catch(() => {});
  return run;
}

async function synthesize(tts, text, voice, speed, onProgress) {
  const chunks = splitForSpeech(text);
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(i / chunks.length, 'Generating speech');
    const out = await tts.generate(chunks[i].text, { voice, speed });
    parts.push({ samples: trimSilence(out.audio, out.sampling_rate), pause: chunks[i].pause });
  }
  onProgress?.(1, 'Generating speech');
  return parts;
}

/** Split text into chunks Kokoro can take in one pass, packing whole sentences where they fit. */
function splitForSpeech(text) {
  const chunks = [];
  for (const para of text.split(/\n\s*\n/)) {
    if (!para.trim()) continue;
    const splitter = new kokoro.TextSplitterStream();
    splitter.push(para);
    splitter.close();
    const sentences = splitter.sentences
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .flatMap((s) => breakLong(s, MAX_CHUNK_CHARS));
    let cur = '';
    for (const s of sentences) {
      if (cur && cur.length + 1 + s.length > MAX_CHUNK_CHARS) {
        chunks.push({ text: cur, pause: SENTENCE_PAUSE });
        cur = s;
      } else {
        cur = cur ? `${cur} ${s}` : s;
      }
    }
    if (cur) chunks.push({ text: cur, pause: PARAGRAPH_PAUSE });
  }
  return chunks;
}

/** Break an over-long sentence at clause punctuation, then at spaces. */
function breakLong(sentence, max) {
  if (sentence.length <= max) return [sentence];
  const out = [];
  let cur = '';
  const add = (piece) => {
    if (cur && cur.length + 1 + piece.length > max) {
      out.push(cur);
      cur = piece;
    } else {
      cur = cur ? `${cur} ${piece}` : piece;
    }
  };
  for (const clause of sentence.split(/(?<=[,;:–—])\s+/)) {
    if (clause.length <= max) add(clause);
    else clause.split(' ').forEach(add);
  }
  if (cur) out.push(cur);
  return out;
}

/** Trim leading and trailing near-silence, keeping a short natural margin. */
function trimSilence(x, sr) {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const th = Math.max(0.002, peak * 0.01);
  let a = 0;
  while (a < x.length && Math.abs(x[a]) < th) a++;
  let b = x.length - 1;
  while (b > a && Math.abs(x[b]) < th) b--;
  if (a >= b) return x;
  return x.subarray(Math.max(0, a - Math.round(0.05 * sr)), Math.min(x.length, b + Math.round(0.12 * sr)));
}

function joinParts(parts, rate = VOICE_RATE) {
  let total = 0;
  parts.forEach((p, i) => (total += p.samples.length + (i < parts.length - 1 ? Math.round(p.pause * rate) : 0)));
  const out = new Float32Array(total);
  let o = 0;
  let peak = 0;
  parts.forEach((p, i) => {
    out.set(p.samples, o);
    o += p.samples.length + (i < parts.length - 1 ? Math.round(p.pause * rate) : 0);
  });
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 0 ? Math.min(8, 0.89 / peak) : 1;
  for (let i = 0; i < out.length; i++) out[i] *= g;
  return out;
}

// ---------------------------------------------------------------------------------------------
// MeloTTS (MIT) on Cloudflare Workers AI: six languages, one voice each, through /api/tts.
// Unlike Kokoro, the script is sent to Cloudflare to be spoken; nothing is stored there.
// ---------------------------------------------------------------------------------------------

export const MELO_MODEL = 'MeloTTS';
const MELO_RATE = 44100;
const MELO_MAX_CHARS = 950; // the endpoint takes 1,200; stay well under 1,000
const MELO_SENTENCE_PAUSE = 0.25;
const MELO_PARAGRAPH_PAUSE = 0.5;

export const MELO_LANGS = [
  { id: 'en', name: 'English', native: 'English', tag: 'EN', sample: 'Hi, this is MeloTTS speaking English, generated on Cloudflare for free.' },
  { id: 'es', name: 'Spanish', native: 'Español', tag: 'ES', sample: 'Hola, esta es la voz en español de MeloTTS, gratis.' },
  { id: 'fr', name: 'French', native: 'Français', tag: 'FR', sample: 'Bonjour, voici la voix française de MeloTTS, gratuite.' },
  { id: 'zh', name: 'Chinese', native: '中文', tag: 'ZH', sample: '你好，这是中文的声音，完全免费。' },
  { id: 'jp', name: 'Japanese', native: '日本語', tag: 'JA', sample: 'こんにちは。これは日本語の声です。無料で作りました。' },
  { id: 'kr', name: 'Korean', native: '한국어', tag: 'KO', sample: '안녕하세요. 이것은 한국어 목소리입니다.' },
];

/** Split a script into chunks under MELO_MAX_CHARS, packing whole sentences (also 。！？ for CJK). */
export function splitForMelo(text, max = MELO_MAX_CHARS) {
  const chunks = [];
  for (const para of String(text).split(/\n\s*\n/)) {
    if (!para.trim()) continue;
    const sentences = para
      .replace(/\s+/g, ' ')
      .replace(/([.!?…]["'”’)\]]*)\s+/g, '$1\n')
      .replace(/([。！？])/g, '$1\n')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .flatMap((s) => breakLong(s.replace(/([，、；：])/g, '$1 '), max).map((p) => p.replace(/([，、；：]) /g, '$1')))
      .flatMap((s) => (s.length > max ? s.match(new RegExp(`[\\s\\S]{1,${max}}`, 'gu')) : [s]));
    let cur = '';
    for (const s of sentences) {
      const sep = /[。！？]$/.test(cur) ? '' : ' ';
      if (cur && cur.length + sep.length + s.length > max) {
        chunks.push({ text: cur, pause: MELO_SENTENCE_PAUSE });
        cur = s;
      } else {
        cur = cur ? `${cur}${sep}${s}` : s;
      }
    }
    if (cur) chunks.push({ text: cur, pause: MELO_PARAGRAPH_PAUSE });
  }
  return chunks;
}

/**
 * Speak text with MeloTTS through /api/tts. Long scripts are split on sentences, sent one chunk at a
 * time and joined with short pauses into one 44.1 kHz mono WAV, peak-normalized to -1 dBFS.
 * onProgress(fraction, label). Errors carry the server's message (for example the daily cap).
 */
export async function speakMelo(text, { lang = 'en', onProgress } = {}) {
  const input = String(text ?? '').trim();
  if (!input) throw new Error('Nothing to speak: the text is empty');
  const chunks = splitForMelo(input);
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(chunks.length > 1 ? i / chunks.length : null, chunks.length > 1 ? `Part ${i + 1} of ${chunks.length}` : 'Speaking');
    let res;
    try {
      res = await apiFetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: chunks[i].text, lang }) });
    } catch {
      throw new Error('could not reach Cloudflare. Check your connection and try again.');
    }
    if (!res.ok) {
      let msg = `the server answered ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const audio = await decodeToMono(await res.arrayBuffer(), MELO_RATE);
    parts.push({ samples: trimSilence(audio, MELO_RATE), pause: chunks[i].pause });
  }
  onProgress?.(1, 'Joining');
  const samples = joinParts(parts, MELO_RATE);
  const blob = encodeWav([samples], MELO_RATE);
  return { blob, url: URL.createObjectURL(blob), duration: samples.length / MELO_RATE, sampleRate: MELO_RATE, chunks: chunks.length };
}

/** Decode any audio the browser can read (wav, mp3, m4a, mp4, webm, ogg) to one channel at sampleRate. */
export async function decodeToMono(arrayBuffer, sampleRate) {
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  const buf = await ctx.decodeAudioData(arrayBuffer);
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  const n = buf.numberOfChannels;
  for (let c = 0; c < n; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / n;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// WAV
// ---------------------------------------------------------------------------------------------

/** Encode planar float channels (-1..1) as an interleaved 16-bit PCM WAV blob. */
export function encodeWav(channels, sampleRate) {
  if (!channels?.length) throw new Error('encodeWav needs at least one channel');
  const nch = channels.length;
  const frames = channels[0].length;
  if (channels.some((c) => c.length !== frames)) throw new Error('encodeWav channels must have equal length');
  const blockAlign = nch * 2;
  const dataSize = frames * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const s = channels[c][i];
      v.setInt16(o, Math.round((s < -1 ? -1 : s > 1 ? 1 : s) * 32767), true);
      o += 2;
    }
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------------------------------------------------------------------------------------------
// Ambience beds
// ---------------------------------------------------------------------------------------------

/**
 * Render an ambience bed: stereo, 48 kHz, 16-bit WAV with 0.5 s fades at both ends so it loops cleanly.
 * intensity 0..1 scales activity (drops, gusts, wave size, traffic, crackle, birdsong) and level.
 * Pass seed for a repeatable render. seconds is clamped to 1..MAX_BED_SECONDS.
 */
export async function renderBed(id, seconds, { intensity = 0.7, seed } = {}) {
  const bed = BED_SYNTHS[id];
  if (!bed) throw new Error(`Unknown bed "${id}". Use one of: ${BEDS.map((b) => b.id).join(', ')}`);
  const s = clamp(Number(seconds) || 0, 1, MAX_BED_SECONDS);
  const k = clamp(Number.isFinite(Number(intensity)) ? Number(intensity) : 0.7, 0, 1);
  const frames = Math.round(s * BED_RATE);
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: frames, sampleRate: BED_RATE });
  const kit = makeKit(ctx, rng(seed ?? Math.floor(Math.random() * 2 ** 32)), s);
  bed.build(kit, k);
  const audio = await ctx.startRendering();
  const channels = [audio.getChannelData(0), audio.getChannelData(1)];
  finishBed(channels, BED_RATE, bed.level + LEVEL_SPAN * (k - 0.7));
  const blob = encodeWav(channels, BED_RATE);
  return { blob, url: URL.createObjectURL(blob), duration: frames / BED_RATE, sampleRate: BED_RATE };
}

/** Set loudness to a target RMS, hold peaks under -1 dBFS with a look-ahead limiter, and fade both ends. */
function finishBed(channels, sr, targetDb) {
  const [L, R] = channels;
  const len = L.length;
  let sum = 0;
  for (let i = 0; i < len; i++) sum += L[i] * L[i] + R[i] * R[i];
  const rms = Math.sqrt(sum / (2 * len));
  const g = rms > 1e-9 ? 10 ** (targetDb / 20) / rms : 0;
  // the gain each frame needs to stay under the ceiling (both channels linked, so the image holds)
  const CEIL = 0.89;
  const need = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const p = Math.max(Math.abs(L[i]), Math.abs(R[i])) * g;
    need[i] = p > CEIL ? CEIL / p : 1;
  }
  // look ahead 2 ms: ramp down before each peak (average of the sliding minimum), release over ~80 ms
  const look = Math.round(0.002 * sr);
  const lim = slidingMin(need, look);
  const rel = 1 - Math.exp(-1 / (0.08 * sr));
  const fade = Math.min(Math.round(FADE * sr), Math.floor(len / 4));
  let box = look + 1; // as if preceded by unity gain
  let gain = 1;
  for (let i = 0; i < len; i++) {
    box += lim[i] - (i > look ? lim[i - look - 1] : 1);
    gain = Math.min(box / (look + 1), gain + (1 - gain) * rel);
    let v = g * gain;
    const e = Math.min(i, len - 1 - i);
    if (e < fade) v *= 0.5 - 0.5 * Math.cos((Math.PI * e) / fade);
    L[i] *= v;
    R[i] *= v;
  }
}

/** out[i] = min(a[i .. i + w]) in linear time (monotonic deque). */
function slidingMin(a, w) {
  const n = a.length;
  const out = new Float32Array(n);
  const q = new Int32Array(n);
  let h = 0;
  let t = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (t > h && a[q[t - 1]] >= a[i]) t--;
    q[t++] = i;
    while (q[h] > i + w) h++;
    out[i] = a[q[h]];
  }
  return out;
}

/** Small seeded PRNG (mulberry32), so a seed reproduces a bed exactly. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A mono noise buffer of the given color at RMS 0.25 that loops without a seam. */
function noiseBuffer(ctx, rand, seconds, color) {
  const sr = ctx.sampleRate;
  const len = Math.round(seconds * sr);
  const xf = Math.round(0.05 * sr);
  const raw = new Float32Array(len + xf);
  if (color === 'pink') {
    // Paul Kellet's economy pink filter
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = rand() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      raw[i] = b0 + b1 + b2 + w * 0.1848;
    }
  } else if (color === 'brown') {
    // leaky integrator of white noise
    let b = 0;
    for (let i = 0; i < raw.length; i++) {
      b = (b + 0.02 * (rand() * 2 - 1)) / 1.02;
      raw[i] = b;
    }
  } else {
    for (let i = 0; i < raw.length; i++) raw[i] = rand() * 2 - 1;
  }
  let sum = 0;
  for (let i = 0; i < len; i++) sum += raw[i] * raw[i];
  const g = 0.25 / Math.sqrt(sum / len || 1);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = raw[i] * g;
  // equal-power crossfade from the tail's continuation into the head: the loop point is seamless
  for (let i = 0; i < xf; i++) {
    const a = ((i + 0.5) / xf) * (Math.PI / 2);
    d[i] = (raw[len + i] * Math.cos(a) + raw[i] * Math.sin(a)) * g;
  }
  return buf;
}

/** Smooth random wandering in 0..1 (Catmull-Rom through random knots every `period` seconds). */
function wanderer(rand, period, seconds) {
  const n = Math.ceil(seconds / period) + 8;
  const knots = Float32Array.from({ length: n }, () => rand());
  return (t) => {
    const x = Math.max(0, t / period + 1);
    const i = Math.min(n - 3, Math.floor(x));
    const f = Math.min(1, x - i);
    const p0 = knots[Math.max(0, i - 1)];
    const p1 = knots[i];
    const p2 = knots[i + 1];
    const p3 = knots[i + 2];
    const v = 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
    return v < 0 ? 0 : v > 1 ? 1 : v;
  };
}

/** A stereo sample layer for grains (drops, crackles, chirps) written directly in JS. */
class Grains {
  constructor(ctx, seconds) {
    this.ctx = ctx;
    this.sr = ctx.sampleRate;
    this.L = new Float32Array(Math.round(seconds * this.sr));
    this.R = new Float32Array(this.L.length);
  }

  /** Add a mono grain at t0 seconds, len samples, constant-power pan -1..1; fn(i) gives sample i. */
  add(t0, len, pan, gain, fn) {
    const start = Math.round(t0 * this.sr);
    const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
    const gl = Math.cos(a) * gain;
    const gr = Math.sin(a) * gain;
    const { L, R } = this;
    for (let i = 0; i < len; i++) {
      const j = start + i;
      if (j >= L.length) break;
      const v = fn(i);
      if (j < 0) continue;
      L[j] += v * gl;
      R[j] += v * gr;
    }
  }

  source() {
    const buf = this.ctx.createBuffer(2, this.L.length, this.sr);
    buf.copyToChannel(this.L, 0);
    buf.copyToChannel(this.R, 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.start(0);
    return src;
  }
}

/** Building blocks shared by every bed, bound to one OfflineAudioContext and seed. */
function makeKit(ctx, rand, seconds) {
  const sr = ctx.sampleRate;
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const noiseLen = Math.min(seconds + 1, 12);
  const buffers = {};
  const uses = {};
  const kit = {
    ctx,
    rand,
    sr,
    seconds,
    master,
    between: (a, b) => a + (b - a) * rand(),
    /** A looping noise source; each new source of a color starts at a well-separated offset. */
    noise(color = 'white', when = 0, until = seconds) {
      const buf = (buffers[color] ||= noiseBuffer(ctx, rand, noiseLen, color));
      const n = (uses[color] = (uses[color] || 0) + 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.start(when, (((n * 0.6180339 + 0.1 * rand()) % 1) * buf.duration));
      if (until < seconds) src.stop(until);
      return src;
    },
    filter(type, frequency, Q, gain) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = frequency;
      if (Q !== undefined) f.Q.value = Q;
      if (gain !== undefined) f.gain.value = gain;
      return f;
    },
    amp(value = 1) {
      const g = ctx.createGain();
      g.gain.value = value;
      return g;
    },
    panner(pan = 0) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      return p;
    },
    osc(type, frequency) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = frequency;
      return o;
    },
    /** Connect nodes in series and return the last one. */
    chain(...nodes) {
      for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
      return nodes[nodes.length - 1];
    },
    /**
     * Drive an AudioParam with fn(t) over [start, start + dur]. Every curve here moves slowly, so it is
     * evaluated once per 128-frame block (k-rate): a swept filter then needs new coefficients per block,
     * not per sample, which keeps renders several times faster.
     */
    automate(param, fn, start = 0, dur = seconds - start) {
      const n = Math.max(2, Math.ceil(dur * CURVE_RATE) + 1);
      const values = new Float32Array(n);
      for (let i = 0; i < n; i++) values[i] = fn(start + (i * dur) / (n - 1));
      param.automationRate = 'k-rate';
      param.setValueCurveAtTime(values, start, dur);
    },
    /** Merger whose inputs 0 and 1 are the left and right channels of the master bus. */
    stereo() {
      const m = ctx.createChannelMerger(2);
      m.connect(master);
      return m;
    },
    wander: (period) => wanderer(rand, period, seconds + 4),
    grains: () => new Grains(ctx, seconds),
    /** Poisson events at `rate` per second over [start, end). */
    events(rate, fn, start = 0, end = seconds) {
      if (rate <= 0) return;
      for (let t = start - Math.log(1 - rand()) / rate; t < end; t -= Math.log(1 - rand()) / rate) fn(t);
    },
    /** Synthetic stereo reverb (decaying filtered noise) feeding the master bus; returns its input. */
    reverb(tail = 1.6, brightness = 0.5) {
      const len = Math.round(tail * sr);
      const buf = ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          lp += (rand() * 2 - 1 - lp) * brightness;
          d[i] = lp * Math.exp((-6.9 * i) / len);
        }
      }
      const c = ctx.createConvolver();
      c.buffer = buf;
      c.connect(master);
      return c;
    },
  };
  return kit;
}

/** Write a pitched tone into a grain layer: freq(x) Hz and env(x) 0..1, x seconds from t0. */
function tone(layer, t0, dur, pan, level, freq, env, second = 0.12) {
  const sr = layer.sr;
  const len = Math.ceil(dur * sr);
  const edge = Math.max(1, Math.min(0.004 * sr, len / 2));
  let ph = 0;
  layer.add(t0, len, pan, level, (i) => {
    const x = i / sr;
    ph += (2 * Math.PI * freq(x)) / sr;
    const e = env(x) * Math.min(1, i / edge, (len - i) / edge);
    return (Math.sin(ph) + second * Math.sin(2 * ph)) * e;
  });
}

/** A noise burst through a two-pole resonator at f Hz (bandwidth bw Hz), decaying with time constant tau. */
function ringBurst(layer, rand, t, pan, gain, f, bw, tau) {
  const sr = layer.sr;
  const r = Math.exp((-Math.PI * bw) / sr);
  const a1 = 2 * r * Math.cos((2 * Math.PI * f) / sr);
  const a2 = -r * r;
  const dk = Math.exp(-1 / (tau * sr));
  let e = 2 * (1 - r); // input level, decaying
  let y1 = 0;
  let y2 = 0;
  layer.add(t, Math.ceil(Math.max(tau * 6, 3 / bw) * sr), pan, gain, () => {
    const y = (rand() * 2 - 1) * e + a1 * y1 + a2 * y2;
    e *= dk;
    y2 = y1;
    y1 = y;
    return y;
  });
}

const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Bird phrases: each writes one phrase into a layer and returns its length in seconds.
const SONGS = {
  // a run of quick down-slurred chirps
  chirps(layer, rand, t, b) {
    const n = 3 + Math.floor(rand() * 5);
    const gap = 0.07 + 0.06 * rand();
    let at = t;
    for (let j = 0; j < n; j++) {
      const d = 0.045 + 0.035 * rand();
      const f0 = b.f * (0.95 + 0.1 * rand());
      tone(layer, at, d, b.pan, b.level * (1 - j * 0.06), (x) => f0 * (1.3 - 0.55 * (x / d)), (x) => Math.sin((Math.PI * x) / d) ** 0.7);
      at += d + gap;
    }
    return at - t;
  },
  // a clear two-note whistle, the second note lower
  whistle(layer, rand, t, b) {
    const d1 = 0.22 + 0.12 * rand();
    const gap = 0.05 + 0.05 * rand();
    const d2 = 0.28 + 0.14 * rand();
    const drop = 0.8 + 0.08 * rand();
    tone(layer, t, d1, b.pan, b.level, (x) => b.f * (1 + (0.03 * x) / d1), (x) => Math.sin((Math.PI * x) / d1) ** 0.5, 0.05);
    tone(layer, t + d1 + gap, d2, b.pan, b.level * 0.9, (x) => b.f * drop * (1 - (0.02 * x) / d2), (x) => Math.sin((Math.PI * x) / d2) ** 0.5, 0.05);
    return d1 + gap + d2;
  },
  // a fast trill of tiny up-sweeps that swells and fades
  trill(layer, rand, t, b) {
    const dur = 0.6 + 0.7 * rand();
    const rate = 16 + 8 * rand();
    const n = Math.floor(dur * rate);
    const d = 0.7 / rate;
    for (let j = 0; j < n; j++) {
      const shape = Math.sin((Math.PI * (j + 0.5)) / n) ** 0.6;
      tone(layer, t + j / rate, d, b.pan, b.level * (0.4 + 0.6 * shape), (x) => b.f * (0.88 + (0.24 * x) / d), (x) => Math.sin((Math.PI * x) / d), 0.1);
    }
    return dur;
  },
  // a wandering song of a few syllables with vibrato
  warble(layer, rand, t, b) {
    const dur = 0.8 + 0.8 * rand();
    const syl = 3 + Math.floor(rand() * 4);
    const vib = 5 + 4 * rand();
    const ph = rand() * 6.28;
    const contour = Array.from({ length: syl }, () => rand());
    tone(
      layer,
      t,
      dur,
      b.pan,
      b.level,
      (x) => b.f * (0.85 + 0.35 * contour[Math.min(syl - 1, Math.floor((x / dur) * syl))] + 0.12 * Math.sin(2 * Math.PI * vib * x + ph)),
      (x) => Math.abs(Math.sin((Math.PI * syl * x) / dur)) ** 0.6 * Math.sin((Math.PI * x) / dur) ** 0.3,
      0.15,
    );
    return dur;
  },
};

const BIRD_PITCH = { chirps: [3200, 4800], whistle: [2600, 3800], trill: [3800, 5600], warble: [2200, 3400] };

// Each bed: build(kit, intensity) wires the graph; level is the target RMS (dBFS) at intensity 0.7.
const BED_SYNTHS = {
  rain: {
    level: -20,
    build(kit, k) {
      const { sr, master, rand, between, noise, filter, amp, chain, automate } = kit;
      const out = kit.stereo();
      for (let ch = 0; ch < 2; ch++) {
        // the wash: countless far drops blur into a soft, slowly breathing hiss
        const swell = kit.wander(3);
        const g = amp(0);
        automate(g.gain, (t) => (0.3 + 0.2 * k) * (0.75 + 0.25 * swell(t)));
        chain(noise('white'), filter('highpass', 1200), filter('lowpass', 8000 + 3000 * k), g).connect(out, 0, ch);
        // a little low body from rain on roofs and ground
        chain(noise('pink'), filter('bandpass', 500, 0.7), amp(0.12 + 0.08 * k)).connect(out, 0, ch);
      }
      const drops = kit.grains();
      // ticks: close drops striking hard surfaces, some bright, some dulled by distance
      kit.events(250 + 900 * k, (t) => {
        const tau = between(0.0002, 0.0015);
        const dk = Math.exp(-1 / (tau * sr));
        const c = between(0.25, 1);
        let prev = 0;
        let lp = 0;
        let e = 1;
        drops.add(t, Math.ceil(tau * 8 * sr), between(-1, 1), 0.04 + 0.4 * rand() ** 4, () => {
          const n = rand() * 2 - 1;
          lp += (n - prev - lp) * c;
          prev = n;
          return lp * (e *= dk);
        });
      });
      // patter: drops on leaves and wood ring briefly at a pitch of their own
      kit.events(40 + 140 * k, (t) => {
        const f = between(500, 2500);
        ringBurst(drops, rand, t, between(-0.9, 0.9), 0.05 + 0.5 * rand() ** 3, f, f / between(2, 5), between(0.002, 0.006));
      });
      // plinks: drops into puddles ring as small bubbles with a rising pitch
      kit.events(10 + 40 * k, (t) => {
        const f0 = between(1100, 3800);
        const tau = between(0.004, 0.012);
        const rise = between(0.15, 0.6);
        const dk = Math.exp(-1 / (tau * sr));
        const w = (2 * Math.PI * f0) / sr;
        let ph = 0;
        let e = 1;
        drops.add(t, Math.ceil(tau * 6 * sr), between(-0.9, 0.9), 0.04 + 0.35 * rand() ** 3, (i) => {
          ph += w * (1 + rise * (1 - e)); // the bubble's pitch rises as it rings down
          e *= dk;
          return Math.sin(ph) * e * Math.min(1, i / 12);
        });
      });
      const src = chain(drops.source(), filter('highpass', 250));
      src.connect(master);
      chain(src, amp(0.3), kit.reverb(0.9, 0.5));
    },
  },

  wind: {
    level: -21,
    build(kit, k) {
      const { master, rand, between, noise, filter, amp, panner, chain, automate } = kit;
      const out = kit.stereo();
      const swell = kit.wander(5);
      const surge = kit.wander(1.8);
      const drift = kit.wander(4);
      // gust strength 0..1: slow swells with quicker surges, stretched so lulls go quiet
      const gust = (t) => clamp((0.6 * swell(t) + 0.4 * surge(t) - 0.25) / 0.5, 0, 1) ** 1.4;
      const floor = 0.06 + 0.08 * k;
      // one side hears each gust a moment later, so gusts sweep across the stereo field
      const sweep = between(0.4, 0.9) * (rand() < 0.5 ? -1 : 1);
      for (let ch = 0; ch < 2; ch++) {
        const G = (t) => gust(t + (ch ? sweep : 0));
        // the rush of moving air: a broad band that rises in pitch and level with each gust
        const bp = filter('bandpass', 500, 1);
        const g = amp(0);
        automate(bp.frequency, (t) => 250 + 1200 * G(t));
        automate(g.gain, (t) => floor + G(t));
        chain(noise('pink'), bp, g).connect(out, 0, ch);
        // low buffeting under it, churning a little
        const churn = kit.wander(0.15);
        const r = amp(0);
        automate(r.gain, (t) => 0.5 * (floor + G(t)) * (0.5 + 0.5 * churn(t)));
        chain(noise('brown'), filter('highpass', 30), filter('lowpass', 250), r).connect(out, 0, ch);
        // leaves and grass hissing at the peaks
        const hs = amp(0);
        automate(hs.gain, (t) => 0.12 * G(t) ** 2);
        chain(noise('white'), filter('bandpass', 4000, 0.7), hs).connect(out, 0, ch);
      }
      // whistle: narrow resonances that sing softly at gust peaks, their pitch rising with the gust
      for (const [f, pan] of [[520, -0.45], [780, 0.4]]) {
        const wb = filter('bandpass', f, 35);
        const wg = amp(0);
        automate(wb.frequency, (t) => f * (0.8 + 0.5 * gust(t) + 0.1 * drift(t)));
        automate(wg.gain, (t) => (0.8 + 1.2 * k) * smoothstep(0.4, 0.95, gust(t)));
        chain(noise('white'), wb, wg, panner(pan), master);
      }
    },
  },

  ocean: {
    level: -19,
    build(kit, k) {
      const { sr, seconds: s, rand, between, noise, filter, amp, chain, automate } = kit;
      const out = kit.stereo();
      // breaking waves: the first crashes early so even a short bed has one
      const waves = [];
      const gap = () => between(6.5, 11) - 2.5 * k;
      const wave = (t) => waves.push({ t, size: between(0.55, 1) * (0.7 + 0.3 * k), rise: between(2.2, 3.6), decay: between(3, 5.5), pan: between(-0.6, 0.6) });
      const first = between(0.8, 2.2);
      wave(first - gap()); // an earlier wave still washing back as the bed starts
      for (let t = first; t < s + 6; t += gap()) wave(t);
      const shapes = {
        swell: (x, w) => (x < 0 ? (1 + x / w.rise) ** 2 : Math.exp(-x / w.decay)),
        crash: (x, w) => (x < 0 ? (1 + x / w.rise) ** 4 : Math.exp(-x / (w.decay * 0.35))),
        foam: (x, w) => (x < 0 ? 0 : (1 - Math.exp(-x / 0.35)) * Math.exp(-x / (w.decay * 0.8))),
      };
      const sum = (shape, ch) => (t) => {
        let v = 0;
        for (const w of waves) {
          const x = t - w.t;
          if (x < -w.rise || x > w.decay * 8) continue;
          const a = ((w.pan + 1) * Math.PI) / 4;
          v += w.size * Math.SQRT2 * (ch ? Math.sin(a) : Math.cos(a)) * shapes[shape](x, w);
        }
        return v;
      };
      const fizz = kit.grains();
      for (let ch = 0; ch < 2; ch++) {
        const swell = sum('swell', ch);
        const crash = sum('crash', ch);
        const foam = sum('foam', ch);
        // body of the water: dark in the trough, opening up as the wave breaks
        const lp = filter('lowpass', 500);
        const bg = amp(0);
        automate(lp.frequency, (t) => 250 + 600 * swell(t) + 3500 * crash(t));
        automate(bg.gain, (t) => 0.04 + 0.7 * swell(t));
        chain(noise('pink'), lp, bg).connect(out, 0, ch);
        // the break itself: a bright broadband rush
        const cg = amp(0);
        automate(cg.gain, (t) => 1.1 * crash(t));
        chain(noise('white'), filter('highpass', 400), filter('lowpass', 8000), cg).connect(out, 0, ch);
        // the wash running back: high fizz
        const fg = amp(0);
        automate(fg.gain, (t) => 0.5 * foam(t));
        chain(noise('white'), filter('highpass', 2000), fg).connect(out, 0, ch);
        // bubbles: churned water rings with countless tiny resonances (big and low in the break,
        // small and high in the wash), which is what makes noise sound like water
        kit.events(1500, (t) => {
          const c = crash(t);
          const f = foam(t);
          if (rand() > clamp(0.9 * c + 0.6 * f, 0, 1)) return;
          const fr = c > f ? 300 * 2 ** (rand() * 3.5) : 900 * 2 ** (rand() * 3);
          const tau = between(6, 18) / (Math.PI * fr);
          const rise = between(0.05, 0.3);
          const dk = Math.exp(-1 / (tau * sr));
          const w = (2 * Math.PI * fr) / sr;
          let ph = 0;
          let e = 1;
          fizz.add(t, Math.ceil(tau * 4 * sr), ch ? between(0.1, 1) : between(-1, -0.1), 0.02 + 0.13 * rand() ** 2, (i) => {
            ph += w * (1 + rise * (1 - e));
            e *= dk;
            return Math.sin(ph) * e * Math.min(1, i / 8);
          });
        });
      }
      // deep rumble of surf along the shore, plus a far, steady wash
      const both = sum('swell', 0);
      const rg = amp(0);
      automate(rg.gain, (t) => 0.08 + 0.45 * both(t));
      const rumble = chain(noise('brown'), filter('highpass', 25), filter('lowpass', 140), rg);
      rumble.connect(out, 0, 0);
      rumble.connect(out, 0, 1);
      for (let ch = 0; ch < 2; ch++) chain(noise('pink'), filter('bandpass', 450, 0.5), amp(0.05)).connect(out, 0, ch);
      fizz.source().connect(kit.master);
    },
  },

  'city-night': {
    level: -24,
    build(kit, k) {
      const { seconds: s, master, rand, between, noise, filter, amp, panner, osc, chain, automate } = kit;
      const out = kit.stereo();
      const street = kit.reverb(1.7, 0.3); // the echo off buildings
      for (let ch = 0; ch < 2; ch++) {
        // the far, never-ending traffic rumble
        const hum = kit.wander(5);
        const g = amp(0);
        automate(g.gain, (t) => (0.15 + 0.08 * k) * (0.7 + 0.3 * hum(t)));
        chain(noise('brown'), filter('highpass', 30), filter('lowpass', 220), g).connect(out, 0, ch);
        // the city's mid-band roar: many far roads at once, air conditioners
        const wash = kit.wander(4);
        const wg = amp(0);
        automate(wg.gain, (t) => (0.24 + 0.1 * k) * (0.7 + 0.3 * wash(t)));
        chain(noise('pink'), filter('bandpass', 700, 0.7), filter('lowpass', 2000), wg).connect(out, 0, ch);
      }
      // passing cars: tyre roar and engine swell up, sweep across and fade, with a slight Doppler drop
      const exhaust = kit.grains();
      const car = (tc) => {
        const w = between(0.7, 1.6);
        const dir = rand() < 0.5 ? -1 : 1;
        const size = between(0.45, 1);
        const t0 = Math.max(0, tc - 5 * w);
        const t1 = Math.min(s, tc + 5 * w);
        if (t1 - t0 < 0.3) return;
        const d = t1 - t0;
        const near = (t) => size / (1 + ((t - tc) / w) ** 2);
        const doppler = (t) => 1 - 0.035 * Math.tanh((t - tc) / (w * 0.5));
        const pan = (t) => 0.85 * dir * Math.tanh((t - tc) / (w * 0.8));
        const p = panner(0);
        automate(p.pan, pan, t0, d);
        // tyres on asphalt: a band centred near 900 Hz, a little brighter as the car gets close
        const lp = filter('lowpass', 800);
        const tg = amp(0);
        automate(lp.frequency, (t) => 700 + (2800 * near(t)) / size, t0, d);
        automate(tg.gain, (t) => 1.1 * near(t), t0, d);
        chain(noise('pink', t0, t1), filter('bandpass', 900, 1), lp, tg, p);
        // engine: low rumble pulsing at the firing rate, its pitch dropping as the car passes
        const f0 = between(45, 80);
        const eg = amp(0);
        automate(eg.gain, (t) => 0.6 * near(t), t0, d);
        const pulse = amp(0.4);
        const firing = osc('sine', f0);
        automate(firing.frequency, (t) => f0 * doppler(t), t0, d);
        chain(firing, amp(0.6), pulse.gain);
        firing.start(t0);
        firing.stop(t1);
        chain(noise('pink', t0, t1), filter('bandpass', 260, 0.7), pulse, eg, p);
        // and the exhaust: individual firing pulses ringing a low resonance, slightly irregular
        const fr = between(140, 260);
        for (let t = t0; t < t1; t += 1 / (f0 * doppler(t) * (1 + 0.04 * (rand() - 0.5)))) {
          const a = 0.5 * near(t) * (0.7 + 0.3 * rand());
          if (a > 0.004) ringBurst(exhaust, rand, t, pan(t), a, fr, fr * 0.6, 0.004);
        }
        p.connect(master);
        chain(p, amp(0.35), street);
      };
      for (let tc = between(1, 2.5); tc < s + 3; tc += between(2, 5.5) / (0.5 + k)) car(tc);
      const ex = exhaust.source();
      ex.connect(master);
      chain(ex, amp(0.35), street);
      // a distant siren wailing between buildings: one in a short bed, about one every 45 s in a long one
      const sirens = Math.max(1, Math.round(s / 45));
      for (let i = 0; i < sirens; i++) {
        const ts = s < 10 ? between(0, 0.3) * s : (s * (i + between(0.05, 0.5))) / sirens;
        const dur = Math.min(s - ts, between(7, 12));
        if (dur < 2) continue;
        const period = between(3.4, 4.6);
        const fin = Math.min(2.5, dur / 3);
        const fout = Math.min(3, dur / 3);
        const sg = amp(0);
        automate(sg.gain, (t) => 0.09 * clamp(Math.min((t - ts) / fin, (ts + dur - t) / fout), 0, 1) ** 2, ts, dur);
        const p = panner(between(-0.7, 0.7));
        for (const detune of [0, 4]) {
          const o = osc('triangle', 900);
          o.detune.value = detune;
          automate(o.frequency, (t) => 950 + 360 * Math.sin((2 * Math.PI * (t - ts)) / period - Math.PI / 2), ts, dur);
          o.connect(sg);
          o.start(ts);
          o.stop(ts + dur);
        }
        chain(sg, filter('lowpass', 1800), p);
        chain(p, amp(0.5), master);
        p.connect(street);
      }
      // the odd far-off horn
      kit.events(0.05 + 0.08 * k, (t) => {
        const d = between(0.15, 0.45);
        const hg = amp(0);
        hg.gain.setValueAtTime(0, t);
        hg.gain.linearRampToValueAtTime(0.03, t + 0.012);
        hg.gain.setValueAtTime(0.03, t + d - 0.04);
        hg.gain.linearRampToValueAtTime(0, t + d);
        const p = panner(between(-0.8, 0.8));
        for (const f of [349, 440]) {
          const o = osc('square', f);
          o.connect(hg);
          o.start(t);
          o.stop(t + d + 0.05);
        }
        chain(hg, filter('lowpass', 1300), p);
        chain(p, amp(0.4), master);
        p.connect(street);
      }, 0.5, s - 0.6);
    },
  },

  'room-tone': {
    level: -38,
    build(kit, k) {
      const { noise, filter, amp, osc, chain, automate } = kit;
      const out = kit.stereo();
      for (let ch = 0; ch < 2; ch++) {
        // still air: soft, dark, wide
        chain(noise('pink'), filter('highpass', 40), filter('lowpass', 700), amp(0.6)).connect(out, 0, ch);
      }
      // ventilation: a low, slightly resonant rumble that barely moves
      const breathe = kit.wander(6);
      const hv = amp(0);
      automate(hv.gain, (t) => (0.45 + 0.35 * k) * (0.93 + 0.07 * breathe(t)));
      const vent = chain(noise('brown'), filter('highpass', 30), filter('lowpass', 220), filter('peaking', 105, 3, 6), hv);
      vent.connect(out, 0, 0);
      vent.connect(out, 0, 1);
      // a faint electrical hum
      for (const [f, g] of [[60, 0.008], [120, 0.005], [180, 0.002]]) {
        const o = osc('sine', f);
        chain(o, amp(g), kit.master);
        o.start(0);
      }
    },
  },

  campfire: {
    level: -23,
    build(kit, k) {
      const { sr, rand, between, noise, filter, amp, chain, automate } = kit;
      const out = kit.stereo();
      for (let ch = 0; ch < 2; ch++) {
        // the low roar of the fire, flickering
        const flicker = kit.wander(0.35);
        const g = amp(0);
        automate(g.gain, (t) => (0.1 + 0.06 * k) * (0.6 + 0.4 * flicker(t)));
        chain(noise('brown'), filter('highpass', 60), filter('lowpass', 320), g).connect(out, 0, ch);
        // flames licking: broadband breath that surges and drops quickly
        const lick = kit.wander(0.3);
        const lg = amp(0);
        automate(lg.gain, (t) => 0.08 * (0.35 + 0.65 * lick(t) ** 2));
        chain(noise('pink'), filter('highpass', 300), filter('lowpass', 3000), lg).connect(out, 0, ch);
      }
      // sap hiss that comes and goes
      const sizzle = kit.wander(2);
      const hg = amp(0);
      automate(hg.gain, (t) => 0.05 * sizzle(t) ** 3);
      const hiss = chain(noise('white'), filter('highpass', 4500), hg);
      hiss.connect(out, 0, 0);
      hiss.connect(out, 0, 1);

      const cr = kit.grains();
      // a crackle is a sub-millisecond click: some sharp and broadband, some with a dull woody knock
      const crackle = (t, pan, a) => {
        if (rand() < 0.4) {
          const f = between(700, 3000);
          ringBurst(cr, rand, t, pan, a * 1.5, f, f / between(1, 2), between(0.0003, 0.0008));
          return;
        }
        const tau = between(0.00008, 0.0004);
        const dk = Math.exp(-1 / (tau * sr));
        const c = between(0.3, 1);
        let prev = 0;
        let lp = 0;
        let e = 1;
        cr.add(t, Math.ceil(tau * 10 * sr) + 2, pan, a, () => {
          const n = rand() * 2 - 1;
          lp += (n - prev - lp) * c;
          prev = n;
          return lp * (e *= dk);
        });
      };
      // bursts: resin pockets crackling in clusters
      kit.events(0.8 + 2.2 * k, (t) => {
        const n = 1 + Math.floor(rand() ** 2 * (5 + 8 * k));
        const spread = between(0.02, 0.25);
        const pan = between(-0.45, 0.45);
        for (let j = 0; j < n; j++) crackle(t + rand() ** 2 * spread, pan + between(-0.1, 0.1), 0.15 + 0.85 * rand() ** 2);
      });
      // a light scatter of single ticks between bursts
      kit.events(2 + 5 * k, (t) => crackle(t, between(-0.5, 0.5), 0.05 + 0.3 * rand() ** 2));
      // pops: a pocket of steam bursting, a sharp snap with a short thump under it
      kit.events(0.2 + 0.4 * k, (t) => {
        const snap = between(0.0008, 0.003);
        const thump = between(0.004, 0.01);
        let lp = 0;
        cr.add(t, Math.ceil(thump * 7 * sr), between(-0.4, 0.4), between(0.3, 0.55), (i) => {
          const n = rand() * 2 - 1;
          lp += (n - lp) * 0.06;
          return n * Math.exp(-i / (snap * sr)) + 1.5 * lp * Math.exp(-i / (thump * sr));
        });
      });
      const src = cr.source();
      src.connect(kit.master);
      chain(src, amp(0.25), kit.reverb(0.6, 0.6));
    },
  },

  'forest-birds': {
    level: -27,
    build(kit, k) {
      const { seconds: s, rand, between, noise, filter, amp, chain, automate } = kit;
      const out = kit.stereo();
      for (let ch = 0; ch < 2; ch++) {
        // leaves stirring in a light breeze
        const rustle = kit.wander(1.8);
        const g = amp(0);
        automate(g.gain, (t) => (0.1 + 0.06 * k) * (0.5 + 0.5 * rustle(t)));
        chain(noise('pink'), filter('bandpass', 2200, 0.6), g).connect(out, 0, ch);
        // distant air through the trees
        chain(noise('brown'), filter('highpass', 30), filter('lowpass', 250), amp(0.15)).connect(out, 0, ch);
      }
      const kinds = ['chirps', 'whistle', 'trill', 'warble', 'chirps', 'whistle'];
      for (let i = kinds.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
      }
      const near = kit.grains();
      const far = kit.grains();
      const count = 3 + Math.round(2 * k);
      for (let i = 0; i < count; i++) {
        const song = kinds[i];
        const [lo, hi] = BIRD_PITCH[song];
        const isNear = i < 2;
        const pan = i < 2 ? (i ? 1 : -1) * between(0.25, 0.85) : between(-0.85, 0.85); // near birds on opposite sides
        const b = { f: between(lo, hi), pan, level: isNear ? between(0.45, 0.7) : between(0.15, 0.3) };
        const rest = [1.2 / (0.5 + k), 4.5 / (0.5 + k)];
        for (let t = i === 0 ? between(0.15, 0.8) : between(0.3, 4); t < s - 0.3; ) {
          t += SONGS[song](isNear ? near : far, rand, t, b) + between(...rest);
        }
      }
      const forest = kit.reverb(1.5, 0.35);
      const n = near.source();
      n.connect(kit.master);
      chain(n, amp(0.3), forest);
      const f = chain(far.source(), filter('lowpass', 3800));
      chain(f, amp(0.5), kit.master);
      chain(f, amp(0.7), forest);
    },
  },
};
