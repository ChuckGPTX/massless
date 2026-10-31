// Extract audio for Chucksi: turn a video or audio file the visitor already has into MP3, M4A or WAV.
// The file is read and decoded in this tab at its own sample rate: MP4/MOV/M4A and MP3 are streamed through
// WebCodecs (only the audio is read, a slice at a time) and WAV is read as PCM; anything else goes through the
// browser's decodeAudioData. The audio is then streamed in chunks to extract-worker.js, which trims, fades,
// evens out loudness and encodes. Nothing is uploaded. The only download is the MP3 encoder itself
// (LAME 3.100 via wasm-media-encoders 0.7.0, from jsDelivr, checked by SHA-256).

export const FORMATS = {
  mp3: { id: 'mp3', label: 'MP3', ext: 'mp3', mime: 'audio/mpeg', kbps: [128, 192, 320], def: 192 },
  m4a: { id: 'm4a', label: 'M4A', ext: 'm4a', mime: 'audio/mp4', kbps: [128, 192, 256], def: 192 },
  wav: { id: 'wav', label: 'WAV', ext: 'wav', mime: 'audio/wav', kbps: [], def: 0 },
};
export const MAX_FILE_BYTES = 2 * 1024 ** 3; // for decodeAudioData, which needs the whole file in memory
export const MAX_PCM_BYTES = 2.2e9; // decoded audio a tab can hold: about 95 minutes of 48 kHz stereo
export const MIN_SECONDS = 0.1;
const CACHE_BYTES = 1.5e9; // decoded audio kept between reading and converting; past it the oldest is decoded again
const CHUNK = 1 << 17; // frames per message to the worker (2.7 s at 48 kHz)
const ACCEPT = /\.(mp4|m4v|mov|webm|mkv|mp3|wav|wave|m4a|aac|ogg|oga|opus|flac|aif|aiff|caf|3gp)$/i;

export function looksLikeMedia(file) {
  return /^(audio|video)\//.test(file.type) || ACCEPT.test(file.name);
}

/** "My clip.mov" -> "My clip.mp3": the original name with the new extension, minus characters file systems refuse. */
export function outputName(name, ext) {
  const base = String(name || 'audio').replace(/\.[^.]{1,5}$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim().slice(0, 120) || 'audio';
  return `${base}.${ext}`;
}

// ---------------------------------------------------------------------------------------------
// Reading the header: sample rate, channels and length, without decoding (best effort)
// ---------------------------------------------------------------------------------------------

const fourcc = (u8, o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/**
 * Read what the container says about its audio. Returns { sampleRate?, channels?, duration?, video?, noAudio? }.
 * Anything it cannot read is left out; decoding is the final word.
 */
export async function probe(file) {
  try {
    const u8 = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
    const v = new DataView(u8.buffer);
    const t0 = fourcc(u8, 0);
    if ((t0 === 'RIFF' || t0 === 'RF64') && fourcc(u8, 8) === 'WAVE') return riff(u8, v);
    if (t0 === 'FORM' && /^AIF[FC]$/.test(fourcc(u8, 8))) return aiff(u8, v);
    if (t0 === 'fLaC') return flac(u8, v);
    if (t0 === 'OggS') return await ogg(file, u8, v);
    if (v.getUint32(0) === 0x1a45dfa3) return ebml(u8, v);
    if (['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot', 'uuid', 'styp'].includes(fourcc(u8, 4))) return await mp4(file);
    return mpegAudio(u8, v, file.size);
  } catch {
    return {};
  }
}

function riff(u8, v) {
  const out = {};
  for (let o = 12; o + 8 <= u8.length; ) {
    const id = fourcc(u8, o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      out.channels = v.getUint16(o + 10, true);
      out.sampleRate = v.getUint32(o + 12, true);
      out.byteRate = v.getUint32(o + 16, true);
    } else if (id === 'data') {
      if (out.byteRate && size !== 0xffffffff) out.duration = size / out.byteRate;
      break;
    }
    o += 8 + size + (size & 1);
  }
  delete out.byteRate;
  return out;
}

function aiff(u8, v) {
  for (let o = 12; o + 8 <= u8.length; ) {
    const size = v.getUint32(o + 4);
    if (fourcc(u8, o) === 'COMM') {
      const channels = v.getInt16(o + 8);
      const frames = v.getUint32(o + 10);
      const exp = v.getUint16(o + 16) & 0x7fff;
      const rate = Math.round(v.getUint32(o + 18) * 2 ** (exp - 16383 - 31));
      return { channels, sampleRate: rate, duration: rate ? frames / rate : undefined };
    }
    o += 8 + size + (size & 1);
  }
  return {};
}

function flac(u8, v) {
  const rate = (u8[18] << 12) | (u8[19] << 4) | (u8[20] >> 4);
  const total = (u8[21] & 0xf) * 2 ** 32 + v.getUint32(22);
  return { sampleRate: rate, channels: ((u8[20] >> 1) & 7) + 1, duration: rate && total ? total / rate : undefined };
}

async function ogg(file, u8, v) {
  const p = 27 + u8[26];
  let out = {};
  let preskip = 0;
  if (fourcc(u8, p) === 'Opus' && fourcc(u8, p + 4) === 'Head') {
    out = { channels: u8[p + 9], sampleRate: 48000 }; // Opus always decodes at 48 kHz
    preskip = v.getUint16(p + 10, true);
  } else if (u8[p] === 1 && fourcc(u8, p + 1) === 'vorb') {
    out = { channels: u8[p + 11], sampleRate: v.getUint32(p + 12, true) };
  }
  if (!out.sampleRate) return out;
  // the last page's granule position is the length in samples
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 65536)).arrayBuffer());
  for (let o = tail.length - 27; o >= 0; o--) {
    if (fourcc(tail, o) !== 'OggS') continue;
    const g = new DataView(tail.buffer, o + 6, 8);
    const gran = g.getUint32(4, true) * 2 ** 32 + g.getUint32(0, true);
    if (gran > 0 && gran < 2 ** 52) out.duration = (gran - preskip) / out.sampleRate;
    break;
  }
  return out;
}

/** WebM / Matroska: Info for the length, the first audio TrackEntry for rate and channels. */
function ebml(u8, v) {
  const id = (o) => {
    const b = u8[o];
    const n = b & 0x80 ? 1 : b & 0x40 ? 2 : b & 0x20 ? 3 : b & 0x10 ? 4 : 0;
    if (!n) throw new Error('bad id');
    let x = 0;
    for (let i = 0; i < n; i++) x = x * 256 + u8[o + i];
    return [x, n];
  };
  const size = (o) => {
    const b = u8[o];
    let n = 1;
    let mask = 0x80;
    while (n <= 8 && !(b & mask)) { n++; mask >>= 1; }
    if (n > 8) throw new Error('bad size');
    let x = b & (mask - 1);
    let ones = x === mask - 1;
    for (let i = 1; i < n; i++) { x = x * 256 + u8[o + i]; if (u8[o + i] !== 0xff) ones = false; }
    return [ones ? Infinity : x, n];
  };
  const uint = (o, n) => { let x = 0; for (let i = 0; i < n; i++) x = x * 256 + u8[o + i]; return x; };
  const float = (o, n) => (n === 4 ? v.getFloat32(o) : v.getFloat64(o));
  const out = {};
  let scale = 1e6;
  let dur = 0;
  let tracks = 0;
  let audio = 0;
  const MASTER = new Set([0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe1]); // Segment, Info, Tracks, TrackEntry, Audio
  const walk = (o, end, entry) => {
    while (o < end && o < u8.length - 2) {
      const [eid, il] = id(o);
      const [len, sl] = size(o + il);
      const body = o + il + sl;
      const stop = Math.min(end, len === Infinity ? u8.length : body + len);
      if (eid === 0x1f43b675) return true; // Cluster: the headers are done
      if (MASTER.has(eid)) {
        const e = eid === 0xae ? { type: 0 } : entry;
        if (walk(body, stop, e)) return true;
        if (eid === 0xae) {
          tracks++;
          if (e.type === 2 && !audio++) Object.assign(out, { sampleRate: e.rate, channels: e.channels });
        }
      } else if (eid === 0x2ad7b1) scale = uint(body, len);
      else if (eid === 0x4489) dur = float(body, len);
      else if (entry && eid === 0x83) entry.type = uint(body, len);
      else if (entry && eid === 0xb5) entry.rate ||= Math.round(float(body, len));
      else if (entry && eid === 0x78b5) entry.rate = Math.round(float(body, len)); // output rate (SBR)
      else if (entry && eid === 0x9f) entry.channels = uint(body, len);
      if (len === Infinity) return false;
      o = body + len;
    }
    return false;
  };
  try {
    walk(0, u8.length, null);
  } catch {
    return out; // the headers run past what was read: keep what was found
  }
  if (dur) out.duration = (dur * scale) / 1e9;
  if (tracks && !audio) out.noAudio = true;
  return out;
}

/** MP4 / MOV / M4A: find moov (it can sit after the media), then read the first sound track's setup. */
async function mp4(file) {
  const m = await readMoov(file);
  if (!m) return {};
  const t = soundTrack(m);
  const out = {};
  if (t.duration) out.duration = t.duration;
  if (t.video) out.video = true;
  if (t.track) Object.assign(out, { sampleRate: t.track.rate, channels: t.track.channels });
  else if (t.traks) out.noAudio = true;
  return out;
}

async function readMoov(file) {
  for (let o = 0; o + 8 <= file.size; ) {
    const h = new DataView(await file.slice(o, o + 16).arrayBuffer());
    let len = h.getUint32(0);
    const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    if (len === 1) len = Number(h.getBigUint64(8));
    else if (len === 0) len = file.size - o;
    if (len < 8) return null;
    if (type === 'moov') return len <= 256e6 ? boxReader(new Uint8Array(await file.slice(o, o + len).arrayBuffer())) : null;
    o += len;
  }
  return null;
}

function boxReader(u8) {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const kids = (o, end) => {
    const list = [];
    while (o + 8 <= end) {
      let len = v.getUint32(o);
      let hdr = 8;
      if (len === 1) { len = Number(v.getBigUint64(o + 8)); hdr = 16; } else if (len === 0) len = end - o;
      if (len < hdr || o + len > end) break;
      list.push({ type: fourcc(u8, o + 4), o, body: o + hdr, end: o + len });
      o += len;
    }
    return list;
  };
  const find = (box, ...path) => {
    let cur = box;
    for (const t of path) {
      cur = cur && kids(cur.body, cur.end).find((k) => k.type === t);
      if (!cur) return null;
    }
    return cur;
  };
  return { u8, v, kids, find, root: { body: 8, end: u8.length } };
}

/** The movie length, whether there is video, and the first sound track: codec setup, rate, channels, edit list. */
function soundTrack(m) {
  const { u8, v, kids, find, root } = m;
  const out = { traks: 0, video: false, track: null };
  let movieScale = 0;
  const mvhd = find(root, 'mvhd');
  if (mvhd) {
    const ver = u8[mvhd.body];
    movieScale = v.getUint32(mvhd.body + (ver ? 20 : 12));
    const d = ver ? Number(v.getBigUint64(mvhd.body + 24)) : v.getUint32(mvhd.body + 16);
    if (movieScale && d && d !== 0xffffffff) out.duration = d / movieScale;
  }
  for (const trak of kids(root.body, root.end).filter((k) => k.type === 'trak')) {
    out.traks++;
    const hdlr = find(trak, 'mdia', 'hdlr');
    const kind = hdlr ? fourcc(u8, hdlr.body + 8) : '';
    if (kind === 'vide') out.video = true;
    if (kind !== 'soun' || out.track) continue;
    const mdhd = find(trak, 'mdia', 'mdhd');
    const stbl = find(trak, 'mdia', 'minf', 'stbl');
    const stsd = stbl && find(stbl, 'stsd');
    if (!mdhd || !stsd) continue;
    const timescale = v.getUint32(mdhd.body + (u8[mdhd.body] ? 20 : 12));
    const e = stsd.body + 8; // the first sample entry
    const type = fourcc(u8, e + 4);
    const ver = v.getUint16(e + 16);
    let channels = v.getUint16(e + 24);
    let rate = v.getUint16(e + 32);
    if (ver === 2) { rate = Math.round(v.getFloat64(e + 40)); channels = v.getUint32(e + 48); }
    let codec = null;
    let description = null;
    if (type === 'mp4a') {
      // the ES descriptor names the codec; for AAC its AudioSpecificConfig is the more reliable rate (HE-AAC doubles it)
      const entryEnd = e + v.getUint32(e);
      for (let p = e + 36; p + 4 < entryEnd; p++) {
        if (fourcc(u8, p) !== 'esds') continue;
        const es = esdsConfig(u8, p + 8, entryEnd);
        if (es?.oti === 0x69 || es?.oti === 0x6b) codec = 'mp3';
        else if (es?.asc && (es.oti === 0x40 || (es.oti >= 0x66 && es.oti <= 0x68))) {
          codec = `mp4a.40.${es.aot}`;
          description = es.asc;
          rate = es.rate || rate;
          channels = es.channels || channels;
        }
        break;
      }
    } else if (type === '.mp3') codec = 'mp3';
    else if (type === 'Opus') { codec = 'opus'; rate = 48000; }
    let elst = null;
    const el = find(trak, 'edts', 'elst');
    if (el) {
      const v1 = u8[el.body] === 1;
      const n = v.getUint32(el.body + 4);
      for (let i = 0, o = el.body + 8; i < n; i++, o += v1 ? 20 : 12) {
        const segDur = v1 ? Number(v.getBigUint64(o)) : v.getUint32(o);
        const mediaTime = v1 ? Number(v.getBigInt64(o + 8)) : v.getInt32(o + 4);
        if (mediaTime >= 0) { elst = { segDur, mediaTime }; break; } // an empty edit (-1) before it is a delay; ignored
      }
    }
    out.track = { stbl, timescale, movieScale, type, codec, description, rate, channels, elst };
  }
  return out;
}

function esdsConfig(u8, o, end) {
  const len = () => { let n = 0; for (let i = 0; i < 4; i++) { const b = u8[o++]; n = (n << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return n; };
  if (u8[o++] !== 0x03) return null;
  len();
  o += 2;
  const flags = u8[o++];
  if (flags & 0x80) o += 2;
  if (flags & 0x40) o += 1 + u8[o];
  if (flags & 0x20) o += 2;
  if (u8[o++] !== 0x04) return null;
  len();
  const oti = u8[o];
  o += 13;
  if (u8[o++] !== 0x05) return { oti };
  const n = len();
  if (o + 2 > end || !n) return { oti };
  const asc = u8.slice(o, o + n);
  let bits = 0;
  let nb = 0;
  const read = (k) => { while (nb < k) { bits = (bits << 8) | u8[o++]; nb += 8; } nb -= k; return (bits >> nb) & ((1 << k) - 1); };
  let aot = read(5);
  if (aot === 31) aot = 32 + read(6);
  const fi = read(4);
  let rate = fi === 15 ? read(24) : ADTS_RATES[fi];
  const cc = read(4);
  if (aot === 5 || aot === 29) { const xi = read(4); rate = xi === 15 ? read(24) : ADTS_RATES[xi]; }
  return { oti, asc, aot, rate, channels: [0, 1, 2, 3, 4, 5, 6, 8][cc] || 0 };
}

/** Where every sample of a track sits in the file, and its decode time. Null for fragmented files. */
function sampleTable(m, stbl) {
  const { v, find } = m;
  const stsz = find(stbl, 'stsz');
  const stsc = find(stbl, 'stsc');
  const stco = find(stbl, 'stco') || find(stbl, 'co64');
  const stts = find(stbl, 'stts');
  if (!stsz || !stsc || !stco || !stts) return null;
  const fixed = v.getUint32(stsz.body + 4);
  const n = v.getUint32(stsz.body + 8);
  if (!n) return null;
  const sizes = new Uint32Array(n);
  for (let i = 0; i < n; i++) sizes[i] = fixed || v.getUint32(stsz.body + 12 + 4 * i);
  const co64 = stco.type === 'co64';
  const chunks = v.getUint32(stco.body + 4);
  const chunkAt = (c) => (co64 ? Number(v.getBigUint64(stco.body + 8 + 8 * c)) : v.getUint32(stco.body + 8 + 4 * c));
  const entries = v.getUint32(stsc.body + 4);
  const offsets = new Float64Array(n);
  let s = 0;
  for (let e = 0; e < entries && s < n; e++) {
    const b = stsc.body + 8 + 12 * e;
    const first = v.getUint32(b) - 1;
    const per = v.getUint32(b + 4);
    const last = e + 1 < entries ? v.getUint32(b + 12) - 1 : chunks;
    for (let c = first; c < last && s < n; c++) {
      let off = chunkAt(c);
      for (let k = 0; k < per && s < n; k++) { offsets[s] = off; off += sizes[s++]; }
    }
  }
  if (s < n) return null;
  const times = new Float64Array(n);
  let t = 0;
  let i = 0;
  const runs = v.getUint32(stts.body + 4);
  for (let e = 0; e < runs; e++) {
    const count = v.getUint32(stts.body + 8 + 8 * e);
    const delta = v.getUint32(stts.body + 12 + 8 * e);
    for (let k = 0; k < count && i < n; k++) { times[i++] = t; t += delta; }
  }
  return { sizes, offsets, times, total: t };
}

/** MP3 (after any ID3 tag) or ADTS AAC: the first two frames that agree. */
function mpegAudio(u8, v, fileSize) {
  let o = 0;
  if (fourcc(u8, 0).startsWith('ID3')) o = 10 + ((u8[6] << 21) | (u8[7] << 14) | (u8[8] << 7) | u8[9]) + (u8[5] & 0x10 ? 10 : 0);
  const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const KB = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
  const frame = (p) => {
    if (u8[p] !== 0xff || (u8[p + 1] & 0xe0) !== 0xe0) return null;
    const ver = (u8[p + 1] >> 3) & 3;
    const layer = (u8[p + 1] >> 1) & 3;
    const bi = u8[p + 2] >> 4;
    const si = (u8[p + 2] >> 2) & 3;
    if (ver === 1 || layer === 0 || bi === 0 || bi === 15 || si === 3) return null;
    const rate = RATES[ver][si];
    const kbps = layer === 1 ? KB[ver === 3 ? 1 : 2][bi] : null;
    if (!kbps) return { rate, channels: u8[p + 3] >> 6 === 3 ? 1 : 2, size: 0, layer };
    const v1 = ver === 3;
    return { rate, kbps, v1, channels: u8[p + 3] >> 6 === 3 ? 1 : 2, size: Math.floor(((v1 ? 144000 : 72000) * kbps) / rate) + ((u8[p + 2] >> 1) & 1), spf: v1 ? 1152 : 576 };
  };
  for (let p = o; p < Math.min(u8.length - 4, o + 65536); p++) {
    if (u8[p] !== 0xff) continue;
    if ((u8[p + 1] & 0xf6) === 0xf0) {
      // ADTS
      const fi = (u8[p + 2] >> 2) & 0xf;
      const cc = ((u8[p + 2] & 1) << 2) | (u8[p + 3] >> 6);
      const flen = ((u8[p + 3] & 3) << 11) | (u8[p + 4] << 3) | (u8[p + 5] >> 5);
      if (ADTS_RATES[fi] && flen > 7 && u8[p + flen] === 0xff && (u8[p + flen + 1] & 0xf6) === 0xf0) return { sampleRate: ADTS_RATES[fi], channels: cc || undefined };
      continue;
    }
    const f = frame(p);
    if (!f || !f.size) continue;
    const g = frame(p + f.size);
    if (!g || g.rate !== f.rate) continue;
    const out = { sampleRate: f.rate, channels: f.channels };
    // a Xing/Info or VBRI header gives the frame count; otherwise estimate from the bitrate
    const side = f.v1 ? (f.channels === 1 ? 17 : 32) : f.channels === 1 ? 9 : 17;
    const x = p + 4 + side;
    const tag = fourcc(u8, x);
    if ((tag === 'Xing' || tag === 'Info') && v.getUint32(x + 4) & 1) out.duration = (v.getUint32(x + 8) * f.spf) / f.rate;
    else if (fourcc(u8, p + 36) === 'VBRI') out.duration = (v.getUint32(p + 36 + 14) * f.spf) / f.rate;
    else out.duration = ((fileSize - p) * 8) / (f.kbps * 1000);
    return out;
  }
  return {};
}

// ---------------------------------------------------------------------------------------------
// Decoding. MP4/MOV/M4A, MP3 and WAV are streamed: only the audio is read from the file, a slice at a time,
// and decoded with WebCodecs (or read as PCM), so an hour-long video never sits in memory whole. Anything
// else, or a browser without WebCodecs, goes through decodeAudioData, which needs the whole file at once.
// ---------------------------------------------------------------------------------------------

const decodable = (r) => r >= 8000 && r <= 96000;
const family441 = (r) => r % 11025 === 0;

/** The rate to decode at for a format: the file's own rate when the encoder takes it, else the nearest standard one. */
export function workRate(native, format) {
  const r = native || 48000;
  if (format === 'wav') return decodable(r) ? r : family441(r) ? 44100 : 48000;
  if (format === 'mp3' && [32000, 44100, 48000].includes(r)) return r;
  if (format === 'm4a' && [44100, 48000].includes(r)) return r;
  return family441(r) ? 44100 : 48000;
}

/** Decoded audio as planar Float32 channels; enough like an AudioBuffer for this module. */
class Pcm {
  constructor(sampleRate, channels) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.numberOfChannels = channels.length;
    this.length = channels[0].length;
  }

  get duration() {
    return this.length / this.sampleRate;
  }

  getChannelData(c) {
    return this.channels[c];
  }

  copyFromChannel(dest, c, start = 0) {
    dest.set(this.channels[c].subarray(start, start + dest.length));
  }

  slice(a, b) {
    a = Math.max(0, Math.min(this.length, a));
    b = Math.max(a, Math.min(this.length, b));
    return new Pcm(this.sampleRate, this.channels.map((x) => x.subarray(a, b)));
  }
}

function readError(e) {
  if (e?.name === 'RangeError' || /memory|allocation/i.test(e?.message || '')) return new Error('The browser ran out of memory reading this file. Try a shorter file, or close other tabs.');
  return new Error('Couldn’t read audio from this file. It may be damaged, have no sound, or use a codec this browser can’t play. Try mp4, mov, webm, mp3, wav or m4a.');
}

/**
 * Decode a file to planar audio at `rate`. Streams MP4/MOV/M4A, MP3 and WAV when the file's own rate is `rate`;
 * otherwise the browser's decodeAudioData resamples. onProgress(fraction) while streaming.
 */
export async function decode(file, rate, onProgress) {
  try {
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const t0 = fourcc(head, 0);
    let pcm = null;
    if ((t0 === 'RIFF' || t0 === 'RF64') && fourcc(head, 8) === 'WAVE') pcm = await readWav(file, rate, onProgress);
    else if (['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide'].includes(fourcc(head, 4))) pcm = await decodeMp4(file, rate, onProgress);
    else if (t0.startsWith('ID3') || (head[0] === 0xff && (head[1] & 0xe6) === 0xe2)) pcm = await decodeMp3(file, rate, onProgress);
    if (pcm) return pcm;
  } catch (e) {
    if (e?.name === 'RangeError') throw readError(e);
    console.warn('Streaming decode failed; trying the whole file.', e);
  }
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is over 2 GB and this browser can only read it whole. Export a shorter clip, or just its audio.');
  let data;
  try {
    data = await file.arrayBuffer();
  } catch {
    throw new Error('This file could not be opened. If it is on a network drive or in the cloud, copy it to this device first.');
  }
  let ctx;
  try {
    ctx = new OfflineAudioContext(1, 1, rate);
  } catch {
    ctx = new OfflineAudioContext(1, 1, 48000);
  }
  try {
    return await ctx.decodeAudioData(data);
  } catch (e) {
    throw readError(e);
  }
}

/** 16/24/32-bit integer or 32/64-bit float WAV, read straight into planar floats. Null if it needs resampling. */
async function readWav(file, rate, onProgress) {
  const head = new Uint8Array(await file.slice(0, 1 << 16).arrayBuffer());
  const v = new DataView(head.buffer);
  let fmt = null;
  let data = null;
  for (let o = 12; o + 8 <= head.length; ) {
    const id = fourcc(head, o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      let tag = v.getUint16(o + 8, true);
      if (tag === 0xfffe && size >= 26) tag = v.getUint16(o + 32, true);
      fmt = { tag, channels: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), align: v.getUint16(o + 20, true), bits: v.getUint16(o + 22, true) };
    } else if (id === 'data') {
      data = { start: o + 8, size: size === 0xffffffff || !size || o + 8 + size > file.size ? file.size - o - 8 : size };
      break;
    }
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.rate !== rate || !fmt.channels || !fmt.align) return null;
  const { tag, channels, bits, align } = fmt;
  const bytes = bits / 8;
  const kind = tag === 1 && [8, 16, 24, 32].includes(bits) ? 'int' : tag === 3 && (bits === 32 || bits === 64) ? 'float' : null;
  if (!kind || align !== bytes * channels) return null;
  const frames = Math.floor(data.size / align);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  const step = Math.max(1, Math.floor((4 << 20) / align));
  for (let f = 0; f < frames; f += step) {
    const n = Math.min(step, frames - f);
    const dv = new DataView(await file.slice(data.start + f * align, data.start + (f + n) * align).arrayBuffer());
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < channels; c++) {
        const o = i * align + c * bytes;
        // integers map to floats as Chromium maps them (negative over 2^(n-1), positive over 2^(n-1) - 1), so this
        // matches decodeAudioData exactly and a 16-bit WAV comes back out of the WAV writer unchanged
        let x;
        let top;
        if (kind === 'float') { out[c][f + i] = bits === 32 ? dv.getFloat32(o, true) : dv.getFloat64(o, true); continue; }
        if (bits === 16) { x = dv.getInt16(o, true); top = 32768; }
        else if (bits === 24) { x = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16); top = 8388608; }
        else if (bits === 32) { x = dv.getInt32(o, true); top = 2147483648; }
        else { x = dv.getUint8(o) - 128; top = 128; }
        out[c][f + i] = x < 0 ? x / top : x / (top - 1);
      }
    }
    onProgress?.((f + n) / frames);
  }
  return new Pcm(rate, out);
}

/**
 * Run encoded packets through a WebCodecs AudioDecoder into planar floats.
 * packets: an async iterable of { data, ts } (ts in microseconds). Null if the browser cannot decode this codec.
 */
async function decodePackets(cfg, packets, count, seconds, onProgress) {
  if (typeof AudioDecoder === 'undefined') return null;
  try {
    if (!(await AudioDecoder.isConfigSupported(cfg)).supported) return null;
  } catch {
    return null;
  }
  let store = null;
  let len = 0;
  let rate = 0;
  let err = null;
  const dec = new AudioDecoder({
    output: (ad) => {
      try {
        if (!store) {
          rate = ad.sampleRate;
          store = Array.from({ length: ad.numberOfChannels }, () => new Float32Array(Math.ceil((seconds + 2) * rate)));
        }
        const n = ad.numberOfFrames;
        if (len + n > store[0].length) {
          store = store.map((x) => {
            const y = new Float32Array(Math.ceil((len + n) * 1.25));
            y.set(x.subarray(0, len));
            return y;
          });
        }
        for (let c = 0; c < store.length; c++) ad.copyTo(store[c].subarray(len, len + n), { planeIndex: Math.min(c, ad.numberOfChannels - 1), format: 'f32-planar' });
        len += n;
      } catch (e) {
        err ||= e;
      } finally {
        ad.close();
      }
    },
    error: (e) => (err ||= e),
  });
  dec.configure(cfg);
  let i = 0;
  const room = () => new Promise((r) => {
    if ('ondequeue' in dec) dec.addEventListener('dequeue', r, { once: true });
    setTimeout(r, 20); // also when an error stops the decoder, or there is no dequeue event
  });
  for await (const p of packets) {
    if (err) break;
    dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: p.ts, data: p.data }));
    while (dec.decodeQueueSize > 48 && !err) await room();
    if (++i % 500 === 0) onProgress?.(Math.min(0.99, i / count));
  }
  if (!err) await dec.flush().catch((e) => (err ||= e));
  if (dec.state !== 'closed') dec.close();
  if (err) throw err;
  if (!store || !len) return null;
  onProgress?.(1);
  return new Pcm(rate, store.map((x) => x.subarray(0, len)));
}

/** The audio track of an MP4, MOV or M4A: only its samples are read, a few MB at a time. */
async function decodeMp4(file, rate, onProgress) {
  const m = await readMoov(file);
  const tr = m && soundTrack(m).track;
  if (!tr?.codec || tr.rate !== rate) return null;
  const st = sampleTable(m, tr.stbl);
  if (!st) return null;
  async function* packets() {
    const n = st.sizes.length;
    for (let i = 0; i < n; ) {
      // read runs of samples together, bridging small gaps (video in between) to keep the reads few
      const start = st.offsets[i];
      let end = start + st.sizes[i];
      let j = i + 1;
      while (j < n && st.offsets[j] >= end && st.offsets[j] - end < (256 << 10) && st.offsets[j] + st.sizes[j] - start < (8 << 20)) end = st.offsets[j] + st.sizes[j++];
      const buf = new Uint8Array(await file.slice(start, end).arrayBuffer());
      if (buf.length < end - start) throw new Error('The file ends early.');
      for (let k = i; k < j; k++) yield { data: buf.subarray(st.offsets[k] - start, st.offsets[k] - start + st.sizes[k]), ts: Math.round((st.times[k] / tr.timescale) * 1e6) };
      i = j;
    }
  }
  const cfg = { codec: tr.codec, sampleRate: tr.rate, numberOfChannels: tr.channels || 2, ...(tr.description ? { description: tr.description } : {}) };
  const pcm = await decodePackets(cfg, packets(), st.sizes.length, st.total / tr.timescale, onProgress);
  if (!pcm || pcm.sampleRate !== rate) return null;
  if (!tr.elst) return pcm;
  // the edit list hides the encoder's priming at the start and the padding at the end
  const skip = Math.round((tr.elst.mediaTime * pcm.sampleRate) / tr.timescale);
  const keep = tr.elst.segDur && tr.movieScale ? Math.round((tr.elst.segDur * pcm.sampleRate) / tr.movieScale) : pcm.length;
  return pcm.slice(skip, skip + keep);
}

/** MP3, frame by frame; a LAME or Lavf tag gives the encoder delay and padding to trim, as players do. */
async function decodeMp3(file, rate, onProgress) {
  const SLICE = 1 << 20;
  let pos = 0;
  let buf = new Uint8Array(await file.slice(0, SLICE).arrayBuffer());
  if (fourcc(buf, 0).startsWith('ID3')) pos = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]) + (buf[5] & 0x10 ? 10 : 0);
  let base = 0; // file offset of buf[0]
  const more = async (need) => {
    // make buf hold at least `need` bytes from pos on, if the file has them
    if (pos - base + need <= buf.length) return true;
    const from = base + (pos - base);
    if (from >= file.size) return false;
    buf = new Uint8Array(await file.slice(from, from + Math.max(SLICE, need)).arrayBuffer());
    base = from;
    return pos - base + need <= buf.length;
  };
  const hdr = (o) => mp3Frame(buf, o - base);
  // find the first frame that a second frame confirms
  let first = null;
  for (let scanned = 0; scanned < 1 << 16; scanned++, pos++) {
    if (!(await more(4))) return null;
    const f = hdr(pos);
    if (!f) continue;
    if (!(await more(f.size + 4))) return null;
    const g = hdr(pos + f.size);
    if (g && g.rate === f.rate) { first = f; break; }
  }
  if (!first || first.rate !== rate) return null;
  let delay = -1;
  let padding = 0;
  let frames = 0;
  // a Xing/Info/VBRI first frame is a header, not audio
  const x = pos - base + 4 + first.side;
  const tag = fourcc(buf, x);
  if (tag === 'Xing' || tag === 'Info') {
    const xv = new DataView(buf.buffer, buf.byteOffset);
    const flags = xv.getUint32(x + 4);
    let o = x + 8;
    if (flags & 1) { frames = xv.getUint32(o); o += 4; }
    if (flags & 2) o += 4;
    if (flags & 4) o += 100;
    if (flags & 8) o += 4;
    if (/^(LAME|Lavf|Lavc)/.test(String.fromCharCode(...buf.subarray(o, o + 4)))) {
      const d = (buf[o + 21] << 16) | (buf[o + 22] << 8) | buf[o + 23];
      delay = d >> 12;
      padding = d & 0xfff;
    }
    pos += first.size;
  } else if (fourcc(buf, pos - base + 36) === 'VBRI') pos += first.size;
  const estimate = frames || Math.ceil(((file.size - pos) * 8) / (first.kbps * 1000) / (first.spf / first.rate));
  const whole = async (f) => f && f.rate === first.rate && (await more(f.size));
  // what follows a good frame: another frame, a trailing tag, or the end of the file
  const followed = async (f) => {
    if (!(await more(f.size + 4))) return true;
    const o = pos - base + f.size;
    return !!mp3Frame(buf, o) || /^(TAG|APET|LYRI|ID3)/.test(fourcc(buf, o));
  };
  async function* packets() {
    let n = 0;
    while (await more(4)) {
      let f = hdr(pos);
      if (!(await whole(f)) || !(await followed(f))) {
        // damage or a tag in the middle: skip to the next frame that the one after it confirms;
        // trailing tags (ID3v1, APE) have none, which ends the stream
        let found = false;
        for (let k = 0; k < 1 << 16 && (await more(4)); k++) {
          pos++;
          f = hdr(pos);
          if ((await whole(f)) && (await more(f.size + 4)) && hdr(pos + f.size)) { found = true; break; }
        }
        if (!found) break;
      }
      yield { data: buf.subarray(pos - base, pos - base + f.size), ts: Math.round(((n++ * f.spf) / f.rate) * 1e6) };
      pos += f.size;
    }
  }
  const pcm = await decodePackets({ codec: 'mp3', sampleRate: first.rate, numberOfChannels: first.channels }, packets(), estimate, (estimate * first.spf) / first.rate, onProgress);
  if (!pcm || pcm.sampleRate !== rate) return null;
  if (delay < 0) return pcm;
  const skip = delay + 529; // the decoder's own delay comes on top of the encoder's
  return pcm.slice(skip, pcm.length - Math.max(0, padding - 529));
}

const MP3_KB = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
/** An MPEG Layer III frame header at u8[o], or null. */
function mp3Frame(u8, o) {
  if (o < 0 || o + 4 > u8.length || u8[o] !== 0xff || (u8[o + 1] & 0xe0) !== 0xe0) return null;
  const ver = (u8[o + 1] >> 3) & 3;
  const layer = (u8[o + 1] >> 1) & 3;
  const bi = u8[o + 2] >> 4;
  const si = (u8[o + 2] >> 2) & 3;
  if (ver === 1 || layer !== 1 || bi === 0 || bi === 15 || si === 3) return null;
  const v1 = ver === 3;
  const kbps = MP3_KB[v1 ? 1 : 2][bi];
  const rate = MP3_RATES[ver][si];
  const channels = u8[o + 3] >> 6 === 3 ? 1 : 2;
  return { rate, kbps, channels, spf: v1 ? 1152 : 576, side: v1 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17, size: Math.floor(((v1 ? 144000 : 72000) * kbps) / rate) + ((u8[o + 2] >> 1) & 1) };
}

/** Max |sample| per bin, across channels, normalised to the loudest bin. */
export function peaksOf(buf, bins = 1000) {
  const n = buf.length;
  const out = new Float32Array(bins);
  const ch = buf.numberOfChannels;
  const stride = Math.max(1, Math.ceil((n * ch) / 12e6));
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let b = 0; b < bins; b++) {
      let m = out[b];
      const end = Math.min(n, Math.floor(((b + 1) * n) / bins));
      for (let i = Math.floor((b * n) / bins); i < end; i += stride) {
        const a = d[i] < 0 ? -d[i] : d[i];
        if (a > m) m = a;
      }
      out[b] = m;
    }
  }
  let top = 1e-4;
  for (const x of out) if (x > top) top = x;
  for (let i = 0; i < bins; i++) out[i] /= top;
  return out;
}

// Decoded audio stays in memory between reading a file and converting it, up to a budget; past it the oldest
// is dropped and decoded again when its turn comes.
const cache = new Map(); // item id -> decoded audio, oldest first
const bytesOf = (b) => b.length * b.numberOfChannels * 4;
function remember(id, buf) {
  cache.delete(id);
  cache.set(id, buf);
  let total = 0;
  for (const b of cache.values()) total += bytesOf(b);
  for (const [k, b] of cache) {
    if (total <= CACHE_BYTES || k === id) break;
    total -= bytesOf(b);
    cache.delete(k);
  }
}
export function forget(id) {
  cache.delete(id);
}
/** Make room before a decode of about `need` bytes: drop the oldest entries other than `keep` until it fits. */
function makeRoom(keep, need = Infinity) {
  let total = 0;
  for (const b of cache.values()) total += bytesOf(b);
  for (const [k, b] of [...cache]) {
    if (total + need <= CACHE_BYTES) break;
    if (k === keep) continue;
    total -= bytesOf(b);
    cache.delete(k);
  }
}

/**
 * Read a file for the queue: check it, decode it once, and return what the card shows.
 * { duration, channels, sampleRate (the file's own when known), video, peaks }. onProgress(fraction).
 */
export async function read(file, id, onProgress) {
  if (!file.size) throw new Error('This file is empty.');
  const info = await probe(file);
  if (info.noAudio) throw new Error('This file has no sound track, so there is no audio to extract.');
  const native = decodable(info.sampleRate) ? info.sampleRate : 0;
  const rate = workRate(native, 'wav');
  if (info.duration && info.duration * rate * Math.min(2, info.channels || 2) * 4 > MAX_PCM_BYTES) {
    throw new Error('This file is too long for a browser tab to hold (about 90 minutes of stereo at most). Cut it into parts first.');
  }
  makeRoom(id, info.duration ? info.duration * rate * Math.min(2, info.channels || 2) * 4 : Infinity);
  const buf = await decode(file, rate, onProgress);
  if (buf.duration < MIN_SECONDS) throw new Error('This file has less than a tenth of a second of audio.');
  remember(id, buf);
  return {
    duration: buf.duration,
    channels: buf.numberOfChannels,
    sampleRate: native || buf.sampleRate,
    video: !!info.video || /^video\//.test(file.type) || /\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name),
    peaks: peaksOf(buf),
  };
}

// ---------------------------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------------------------

let worker = null;
let seq = 0;
const pending = new Map();
function call(type, data = {}, transfer = []) {
  if (!worker) {
    worker = new Worker(new URL('./extract-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, ok, error, ...rest } = e.data;
      const p = pending.get(id);
      pending.delete(id);
      if (p) ok ? p.resolve(rest) : p.reject(new Error(error));
    };
    worker.onerror = (e) => {
      e.preventDefault?.();
      const err = new Error(`The converter stopped${e.message ? `: ${e.message}` : ''}. Try again.`);
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...data }, transfer);
  });
}

let capsPromise = null;
/** What this browser can encode: { aac: [kbps...] } (empty when it has no AAC encoder). */
export function caps() {
  capsPromise ||= call('caps').catch(() => ({ aac: [] }));
  return capsPromise;
}

/** Fetch and compile the MP3 encoder ahead of the first Convert (a ~140 KB download). */
export function warm() {
  return call('warm').catch(() => {});
}

const PASS_LABEL = { measure: 'Measuring loudness', simulate: 'Evening out loudness', encode: 'Converting' };

/**
 * Convert one queue item. item: { id, file, start, end, sampleRate }.
 * settings: { format, kbps, mono, fadeIn, fadeOut, normalize, codec? }.
 * onProgress(fraction 0..1 or null, label). signal: an AbortSignal.
 * Returns { blob, frames, rate, channels, duration, gainDb?, sourceLufs? }.
 */
export async function convert(item, settings, { onProgress, signal } = {}) {
  const fmt = FORMATS[settings.format];
  if (!fmt) throw new Error(`Unknown format ${settings.format}`);
  let buf = cache.get(item.id);
  if (!buf || buf.sampleRate !== workRate(item.sampleRate, fmt.id)) {
    onProgress?.(null, 'Reading');
    const r = workRate(item.sampleRate, fmt.id);
    buf = null;
    forget(item.id); // decoded at another rate: not needed while this one decodes
    makeRoom(item.id, item.duration * r * item.channels * 4);
    buf = await decode(item.file, r, (f) => onProgress?.(f, 'Reading'));
    if (signal?.aborted) throw abortError();
    remember(item.id, buf);
  }
  const rate = buf.sampleRate;
  const a = Math.max(0, Math.min(buf.length - 1, Math.round(item.start * rate)));
  const b = Math.max(a + 1, Math.min(buf.length, Math.round(item.end * rate)));
  const read = (off, n) => {
    const chans = [];
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = new Float32Array(n);
      buf.copyFromChannel(d, c, a + off);
      chans.push(d);
    }
    return chans;
  };
  return encode({ rate, channels: buf.numberOfChannels, frames: b - a, read }, settings, { onProgress, signal });
}

/**
 * Encode any audio the page can produce in slices. src: { rate, channels, frames, read(offset, n) -> planar
 * Float32Arrays of n frames }. Used by convert() above and by Edit by text and Master, so every tool shares
 * one encoder path. settings: { format, kbps, mono, fadeIn, fadeOut, normalize, bits (WAV: 16 or 24), codec? }.
 */
export async function encode(src, settings, { onProgress, signal } = {}) {
  const fmt = FORMATS[settings.format];
  if (!fmt) throw new Error(`Unknown format ${settings.format}`);
  const { rate, frames } = src;
  const outChannels = settings.mono ? 1 : Math.min(2, src.channels);
  const cfg = { format: fmt.id, kbps: settings.kbps || fmt.def, rate, outChannels, frames, fadeIn: settings.fadeIn || 0, fadeOut: settings.fadeOut || 0, normalize: !!settings.normalize, codec: settings.codec, bits: settings.bits === 24 ? 24 : 16 };
  onProgress?.(0, settings.normalize ? PASS_LABEL.measure : PASS_LABEL.encode);
  let r = await call('begin', { cfg });
  let sims = 0;
  try {
    while (!r.done) {
      const span = !cfg.normalize ? [0, 1] : r.pass === 'measure' ? [0, 0.1] : r.pass === 'simulate' ? [0.1 + 0.03 * sims, 0.13 + 0.03 * sims] : [0.22, 1];
      if (r.pass === 'simulate') sims++;
      for (let off = 0; off < frames; off += CHUNK) {
        if (signal?.aborted) throw abortError();
        const n = Math.min(CHUNK, frames - off);
        const chans = src.read(off, n).map((d) => (d.length === n && d.byteOffset === 0 && d.buffer.byteLength === n * 4 ? d : d.slice(0, n)));
        await call('chunk', { channels: chans }, chans.map((d) => d.buffer));
        onProgress?.(span[0] + (span[1] - span[0]) * ((off + n) / frames), PASS_LABEL[r.pass]);
      }
      r = await call('end');
    }
  } catch (e) {
    await call('abort').catch(() => {});
    throw e;
  }
  onProgress?.(1, 'Done');
  return { ...r, rate, channels: outChannels, duration: frames / rate };
}

function abortError() {
  const e = new Error('Stopped.');
  e.name = 'AbortError';
  return e;
}
