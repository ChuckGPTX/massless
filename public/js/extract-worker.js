// Extract audio for Chucksi: the worker that trims, fades, evens out loudness and encodes.
// The page decodes the file with the browser's own decoder and streams the samples in, chunk by chunk;
// this worker never sees the file and nothing leaves the tab.
//   MP3: LAME 3.100 (LGPL) compiled to WebAssembly by wasm-media-encoders 0.7.0 (MIT), fetched unmodified
//        from jsDelivr at that exact version and checked against a SHA-256 before it runs.
//   M4A: the browser's own AAC encoder (WebCodecs AudioEncoder) and mp4-muxer (MIT, vendored).
//   WAV: 16-bit PCM (24-bit for masters).
// "Even out loudness" measures integrated loudness (ITU-R BS.1770, gated), sets the gain for -14 LUFS and holds
// peaks under the ceiling with the same look-ahead limiter the sound beds use, here in a streaming form.

const LAME_BASE = 'https://cdn.jsdelivr.net/npm/wasm-media-encoders@0.7.0/';
export const LAME_FILES = {
  js: { url: `${LAME_BASE}dist/umd/WasmMediaEncoder.min.js`, sha256: '3U4Xq/U3ff7Mcm1uxee3LasBzzUil0J45TR/TmhID7M=' },
  wasm: { url: `${LAME_BASE}wasm/mp3.wasm`, sha256: 'hegXGSULmmZ7ElgUP2id2nDj5Xp+fCmrC0zvZcj265o=' },
};
export const TARGET_LUFS = -14;
export const MP3_DELAY = 576; // LAME's encoder delay in samples (the decoder adds 529 more, which players skip)
const CEILING = { wav: 10 ** (-1.05 / 20), lossy: 10 ** (-1.6 / 20) }; // lossy codecs overshoot a little
const MAX_GAIN_DB = 30; // never lift a near-silent file by more than this

// The loudness meter (ITU-R BS.1770, gated) and the look-ahead limiter live in loudness.js, shared with Master.
import { kWeights, LoudnessMeter, Limiter } from './loudness.js';
export { kWeights, LoudnessMeter, Limiter };

// ---------------------------------------------------------------------------------------------
// Encoders
// ---------------------------------------------------------------------------------------------

async function fetchChecked({ url, sha256 }) {
  let res;
  try {
    res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  } catch {
    throw new Error('Could not download the MP3 encoder. Check your connection, or pick WAV, which needs no download.');
  }
  if (!res.ok) throw new Error(`The MP3 encoder download failed (${res.status}). Try again, or pick WAV.`);
  const buf = await res.arrayBuffer();
  if (self.crypto?.subtle) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    if (btoa(String.fromCharCode(...d)) !== sha256) throw new Error('The MP3 encoder download did not match its checksum, so it was not run.');
  }
  return buf;
}

let lamePromise = null;
/** One LAME encoder, reused across jobs (configure() resets it). */
function loadLame() {
  lamePromise ||= (async () => {
    const [js, wasm] = await Promise.all([fetchChecked(LAME_FILES.js), fetchChecked(LAME_FILES.wasm)]);
    const url = URL.createObjectURL(new Blob([js], { type: 'text/javascript' }));
    try {
      await import(/* @vite-ignore */ url); // the UMD build sets self.WasmMediaEncoder
    } finally {
      URL.revokeObjectURL(url);
    }
    const lib = self.WasmMediaEncoder;
    if (!lib?.createEncoder) throw new Error('The MP3 encoder did not load.');
    return lib.createEncoder('audio/mpeg', await WebAssembly.compile(wasm));
  })();
  lamePromise.catch(() => (lamePromise = null));
  return lamePromise;
}

class ByteSink {
  constructor(size) {
    this.buf = new Uint8Array(Math.max(1 << 16, size));
    this.len = 0;
  }

  push(bytes) {
    if (!bytes.length) return;
    if (this.len + bytes.length > this.buf.length) {
      const next = new Uint8Array(Math.max(this.buf.length * 1.5, this.len + bytes.length) | 0);
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
    }
    this.buf.set(bytes, this.len);
    this.len += bytes.length;
  }
}

class Mp3Writer {
  async init({ rate, outChannels, kbps, frames }) {
    this.rate = rate;
    this.kbps = kbps;
    this.enc = await loadLame();
    this.enc.configure({ sampleRate: rate, channels: outChannels, bitrate: kbps });
    this.sink = new ByteSink(Math.ceil(((frames + 4000) / rate) * kbps * 125 * 1.01) + 8192);
    this.frames = 0;
  }

  write(chs, len) {
    if (!len) return;
    this.sink.push(this.enc.encode(chs.map((c) => (c.length === len ? c : c.subarray(0, len)))));
    this.frames += len;
  }

  finish() {
    this.sink.push(this.enc.finalize());
    const data = this.sink.buf.subarray(0, this.sink.len);
    const info = infoFrame(data, this.frames, this.kbps);
    return new Blob(info ? [info, data] : [data], { type: 'audio/mpeg' });
  }
}

const MP3_KBPS = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Parse an MPEG-1/2/2.5 Layer III frame header at data[o]; null when there is none. */
export function mp3Header(data, o) {
  if (o + 4 > data.length || data[o] !== 0xff || (data[o + 1] & 0xe0) !== 0xe0) return null;
  const ver = (data[o + 1] >> 3) & 3;
  const layer = (data[o + 1] >> 1) & 3;
  const bi = data[o + 2] >> 4;
  const si = (data[o + 2] >> 2) & 3;
  if (ver === 1 || layer !== 1 || bi === 0 || bi === 15 || si === 3) return null;
  const v1 = ver === 3;
  const kbps = MP3_KBPS[v1 ? 1 : 2][bi];
  const rate = MP3_RATES[ver][si];
  const mono = data[o + 3] >> 6 === 3;
  return { v1, kbps, rate, mono, spf: v1 ? 1152 : 576, size: Math.floor(((v1 ? 144000 : 72000) * kbps) / rate) + ((data[o + 2] >> 1) & 1), side: v1 ? (mono ? 17 : 32) : mono ? 9 : 17 };
}

// CRC-16/ARC, the checksum LAME uses for its tag
const CRC16 = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
    t[i] = c;
  }
  return t;
})();
function crc16(bytes, crc = 0) {
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC16[(crc ^ bytes[i]) & 0xff];
  return crc;
}

/**
 * A Xing "Info" frame with a LAME tag for a CBR stream: frame count, byte count, a seek table, and the encoder
 * delay and end padding so players trim the stream to exactly `samples` long. Returns null if data has no frames.
 */
export function infoFrame(data, samples, kbps) {
  const h = mp3Header(data, 0);
  if (!h) return null;
  let frames = 0;
  for (let o = 0; o < data.length; ) {
    const f = mp3Header(data, o);
    if (!f) break;
    frames++;
    o += f.size;
  }
  const size = Math.floor(((h.v1 ? 144000 : 72000) * h.kbps) / h.rate);
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  out[0] = 0xff;
  out[1] = data[1] | 1; // no CRC
  out[2] = data[2] & ~2; // no padding bit
  out[3] = data[3];
  let p = 4 + h.side;
  const str = (s) => { for (const ch of s) out[p++] = ch.charCodeAt(0); };
  str('Info');
  v.setUint32(p, 0x0f); p += 4; // frames, bytes, TOC and quality are present
  v.setUint32(p, frames); p += 4;
  v.setUint32(p, size + data.length); p += 4;
  for (let i = 0; i < 100; i++) out[p++] = Math.floor((i * 256) / 100); // CBR: a straight line
  v.setUint32(p, 0); p += 4;
  const tag = p;
  str('LAME3.100');
  out[p++] = 0x01; // tag revision 0, CBR
  out[p++] = 0; // lowpass unknown
  p += 4 + 2 + 2; // peak and ReplayGain: not computed
  out[p++] = 0; // flags, ATH type
  out[p++] = Math.min(255, kbps);
  const pad = frames * h.spf - MP3_DELAY - samples;
  const delays = pad >= 0 && pad < 4096 ? (MP3_DELAY << 12) | pad : 0;
  out[p++] = delays >> 16;
  out[p++] = (delays >> 8) & 0xff;
  out[p++] = delays & 0xff;
  p += 1 + 1 + 2; // misc, MP3 gain, preset
  v.setUint32(p, size + data.length); p += 4;
  v.setUint16(p, crc16(data)); p += 2;
  v.setUint16(p, crc16(out.subarray(0, p)));
  if (p - tag !== 34) throw new Error('LAME tag layout');
  return out;
}

class WavWriter {
  init({ rate, outChannels, bits = 16 }) {
    this.rate = rate;
    this.ch = outChannels;
    this.bits = bits === 24 ? 24 : 16;
    this.parts = [];
    this.frames = 0;
  }

  write(chs, len) {
    if (!len) return;
    const { ch } = this;
    if (this.bits === 24) {
      // 24-bit little-endian PCM, for masters
      const out = new Uint8Array(len * ch * 3);
      for (let c = 0; c < ch; c++) {
        const x = chs[c];
        for (let i = 0, o = c * 3; i < len; i++, o += ch * 3) {
          const s = x[i];
          const v = s < 0 ? Math.round((s < -1 ? -1 : s) * 8388608) : Math.round((s > 1 ? 1 : s) * 8388607);
          out[o] = v & 0xff;
          out[o + 1] = (v >> 8) & 0xff;
          out[o + 2] = (v >> 16) & 0xff;
        }
      }
      this.parts.push(out);
      this.frames += len;
      return;
    }
    const out = new Int16Array(len * ch);
    for (let c = 0; c < ch; c++) {
      const x = chs[c];
      for (let i = 0, j = c; i < len; i++, j += ch) {
        const s = x[i];
        out[j] = s < 0 ? Math.round((s < -1 ? -1 : s) * 32768) : Math.round((s > 1 ? 1 : s) * 32767); // the inverse of the reader
      }
    }
    this.parts.push(out);
    this.frames += len;
  }

  finish() {
    const { ch, rate } = this;
    const bytes = this.bits / 8;
    const dataSize = this.frames * ch * bytes;
    const head = new DataView(new ArrayBuffer(44));
    const str = (o, s) => { for (let i = 0; i < 4; i++) head.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF');
    head.setUint32(4, 36 + dataSize, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    head.setUint32(16, 16, true);
    head.setUint16(20, 1, true); // PCM
    head.setUint16(22, ch, true);
    head.setUint32(24, rate, true);
    head.setUint32(28, rate * ch * bytes, true);
    head.setUint16(32, ch * bytes, true);
    head.setUint16(34, this.bits, true);
    str(36, 'data');
    head.setUint32(40, dataSize, true);
    return new Blob([head.buffer, ...this.parts], { type: 'audio/wav' });
  }
}

const AAC = 'mp4a.40.2';
class M4aWriter {
  async init({ rate, outChannels, kbps, codec = 'aac' }) {
    if (typeof AudioEncoder === 'undefined') throw new Error('This browser cannot make M4A files. Pick MP3, which plays everywhere.');
    const opus = codec === 'opus'; // only used by the tests, where Chromium has no AAC encoder; same muxing path
    const cfg = { codec: opus ? 'opus' : AAC, sampleRate: rate, numberOfChannels: outChannels, bitrate: kbps * 1000 };
    let ok = false;
    try { ok = (await AudioEncoder.isConfigSupported(cfg)).supported; } catch { /* unsupported */ }
    if (!ok) throw new Error(`This browser cannot make ${kbps} kbps M4A at ${rate / 1000} kHz. Pick MP3, or a lower quality.`);
    const { Muxer, ArrayBufferTarget } = await import('./vendor/mp4-muxer.mjs');
    this.muxer = new Muxer({ target: new ArrayBufferTarget(), audio: { codec: opus ? 'opus' : 'aac', numberOfChannels: outChannels, sampleRate: rate }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
    this.err = null;
    this.enc = new AudioEncoder({ output: (chunk, meta) => this.muxer.addAudioChunk(chunk, meta), error: (e) => (this.err = e) });
    this.enc.configure(cfg);
    this.rate = rate;
    this.ch = outChannels;
    this.frames = 0;
  }

  async write(chs, len) {
    if (this.err) throw this.err;
    if (!len) return;
    const data = new Float32Array(len * this.ch);
    for (let c = 0; c < this.ch; c++) data.set(chs[c].subarray(0, len), c * len);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: this.rate, numberOfFrames: len, numberOfChannels: this.ch, timestamp: Math.round((this.frames / this.rate) * 1e6), data });
    this.enc.encode(ad);
    ad.close();
    this.frames += len;
    while (this.enc.encodeQueueSize > 4 && !this.err) await new Promise((r) => setTimeout(r, 2));
  }

  async finish() {
    await this.enc.flush();
    if (this.err) throw this.err;
    this.enc.close();
    this.muxer.finalize();
    return new Blob([this.muxer.target.buffer], { type: 'audio/mp4' });
  }
}

// ---------------------------------------------------------------------------------------------
// A job: the page streams the trimmed source once per pass. Passes: measure (only for loudness),
// simulate (only when the limiter has work to do: re-measure after limiting and correct the gain), encode.
// ---------------------------------------------------------------------------------------------

const SQRT1_2 = Math.SQRT1_2;
/** Mix planar source channels to 1 or 2 output channels (Web Audio's speaker rules for 4 and 6 channels). */
export function mixdown(chs, len, out) {
  const n = chs.length;
  if (n === out) return chs;
  let L;
  let R;
  if (n === 1) return out === 2 ? [chs[0], chs[0].slice(0, len)] : chs;
  if (n === 2) [L, R] = chs;
  else {
    L = chs[0];
    R = chs[1];
    if (n === 4) for (let i = 0; i < len; i++) { L[i] = 0.5 * (L[i] + chs[2][i]); R[i] = 0.5 * (R[i] + chs[3][i]); }
    else if (n >= 6) for (let i = 0; i < len; i++) { L[i] += SQRT1_2 * (chs[2][i] + chs[4][i]); R[i] += SQRT1_2 * (chs[2][i] + chs[5][i]); }
    else for (let i = 0; i < len; i++) { L[i] = (L[i] + 0.5 * chs[2][i]) / 1.5; R[i] = (R[i] + 0.5 * chs[2][i]) / 1.5; }
  }
  if (out === 2) return [L, R];
  for (let i = 0; i < len; i++) L[i] = 0.5 * (L[i] + R[i]);
  return [L];
}

class Job {
  constructor(cfg) {
    this.cfg = cfg;
    const { rate, frames } = cfg;
    const half = Math.floor(frames / 2);
    this.fi = Math.min(half, Math.round((cfg.fadeIn || 0) * rate));
    this.fo = Math.min(half, Math.round((cfg.fadeOut || 0) * rate));
    this.gain = 1;
    this.sims = []; // [gain dB, loudness] after each simulated pass
    this.lossy = cfg.format !== 'wav';
    this.ceiling = this.lossy ? CEILING.lossy : CEILING.wav;
    this.info = {};
  }

  async start() {
    const W = { mp3: Mp3Writer, wav: WavWriter, m4a: M4aWriter }[this.cfg.format];
    if (!W) throw new Error(`Unknown format ${this.cfg.format}`);
    this.writer = new W();
    await this.writer.init(this.cfg); // load the encoder first, so a missing one fails before any work
    return this.begin(this.cfg.normalize ? 'measure' : 'encode');
  }

  begin(pass) {
    this.pass = pass;
    this.pos = 0;
    const { rate, outChannels, frames } = this.cfg;
    this.meter = pass === 'encode' ? null : new LoudnessMeter(rate, outChannels, frames);
    this.limiter = this.cfg.normalize && pass !== 'measure' ? new Limiter(outChannels, rate, this.ceiling, this.gain) : null;
    return { pass, done: false };
  }

  fade(chs, len) {
    const { fi, fo } = this;
    const N = this.cfg.frames;
    const p0 = this.pos;
    if ((!fi || p0 >= fi) && (!fo || p0 + len <= N - fo)) return;
    for (let i = 0; i < len; i++) {
      const p = p0 + i;
      let g = 1;
      if (p < fi) g = 0.5 - 0.5 * Math.cos((Math.PI * (p + 0.5)) / fi);
      const e = N - 1 - p;
      if (e < fo) g *= 0.5 - 0.5 * Math.cos((Math.PI * (e + 0.5)) / fo);
      if (g !== 1) for (const x of chs) x[i] *= g;
    }
  }

  async push(chs) {
    const len = chs[0].length;
    let out = mixdown(chs, len, this.cfg.outChannels);
    this.fade(out, len);
    this.pos += len;
    if (this.pass === 'measure') return this.meter.push(out, len);
    if (this.limiter) out = this.limiter.process(out, len);
    await this.emit(out);
  }

  async emit(out) {
    const n = out[0].length;
    if (this.pass === 'simulate') this.meter.push(out, n);
    else await this.writer.write(out, n);
  }

  async end() {
    if (this.pos !== this.cfg.frames) throw new Error(`Expected ${this.cfg.frames} frames, got ${this.pos}`);
    const T = TARGET_LUFS;
    if (this.pass === 'measure') {
      const L = this.meter.integrated();
      this.info.sourceLufs = L;
      this.info.sourcePeak = this.meter.peak;
      if (!Number.isFinite(L)) return this.begin('encode'); // silence: nothing to even out
      this.gain = 10 ** (Math.min(MAX_GAIN_DB, T - L) / 20);
      return this.begin(this.meter.peak * this.gain > this.ceiling ? 'simulate' : 'encode');
    }
    if (this.limiter) await this.emit(this.limiter.flush());
    if (this.pass === 'simulate') {
      // the limiter takes some loudness back: correct the gain and check again. Loudness grows less than
      // 1 dB per dB once the limiter works hard, so after the first try step by the measured slope (secant).
      const L = this.meter.integrated();
      const gDb = 20 * Math.log10(this.gain);
      this.sims.push([gDb, L]);
      const miss = T - L;
      if (!Number.isFinite(L) || Math.abs(miss) <= 0.15) return this.begin('encode');
      let slope = 1;
      if (this.sims.length > 1) {
        const [[g0, l0], [g1, l1]] = this.sims.slice(-2);
        if (g1 !== g0) slope = Math.min(1, Math.max(0.15, (l1 - l0) / (g1 - g0)));
      }
      this.gain = 10 ** (Math.min(MAX_GAIN_DB, gDb + miss / slope) / 20);
      return this.begin(Math.abs(miss) > 0.3 && this.sims.length < 4 ? 'simulate' : 'encode');
    }
    const blob = await this.writer.finish();
    return { done: true, blob, frames: this.writer.frames, gainDb: 20 * Math.log10(this.gain), ...this.info };
  }
}

// ---------------------------------------------------------------------------------------------
// Messages from the page: caps, begin, chunk, end, abort. Each answers { id, ok, ... }.
// ---------------------------------------------------------------------------------------------

let job = null;
const handlers = {
  async caps() {
    const aac = [];
    if (typeof AudioEncoder !== 'undefined') {
      for (const kbps of [128, 192, 256]) {
        try {
          if ((await AudioEncoder.isConfigSupported({ codec: AAC, sampleRate: 48000, numberOfChannels: 2, bitrate: kbps * 1000 })).supported) aac.push(kbps);
        } catch { /* unsupported */ }
      }
    }
    return { aac };
  },
  async warm() {
    await loadLame();
    return {};
  },
  async begin({ cfg }) {
    job = new Job(cfg);
    try {
      return await job.start();
    } catch (e) {
      job = null;
      throw e;
    }
  },
  async chunk({ channels }) {
    if (!job) throw new Error('No conversion is running.');
    await job.push(channels);
    return {};
  },
  async end() {
    if (!job) throw new Error('No conversion is running.');
    const r = await job.end();
    if (r.done) job = null;
    return r;
  },
  abort() {
    try { job?.writer?.enc?.close?.(); } catch { /* already closed */ }
    job = null;
    return {};
  },
};

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = async (e) => {
    const { id, type } = e.data;
    try {
      const out = await handlers[type](e.data);
      self.postMessage({ id, ok: true, ...out });
    } catch (err) {
      if (type !== 'abort') job = null;
      self.postMessage({ id, ok: false, error: err?.message || String(err) });
    }
  };
}
