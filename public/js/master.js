// Master for Chucksi: an automatic mastering chain that runs entirely on the visitor's device.
// analyze() measures a mix (BS.1770 loudness, loudness range, 4x true peak, tonal balance against a typical
// mastered mix, stereo width, clipping). planChain() turns that report plus a character and a destination into
// settings; master() runs the chain: subsonic high-pass, a gentle tilt EQ, glue compression, optional width,
// then gain to the destination's loudness and a true-peak look-ahead limiter. The gain is corrected until the
// limited result measures on target, and the true peak of the actual output is checked before it is returned.
// No DOM, no network: the same code runs in master-worker.js and in the Node tests.

import { LoudnessMeter, Limiter, TruePeakMeter } from './loudness.js';

export const DESTINATIONS = {
  streaming: { id: 'streaming', name: 'Streaming', lufs: -14, tp: -1, note: 'Spotify, YouTube, Apple Music' },
  podcast: { id: 'podcast', name: 'Podcast', lufs: -16, tp: -1, note: 'Apple Podcasts and most podcast apps' },
  broadcast: { id: 'broadcast', name: 'Broadcast', lufs: -23, tp: -1, note: 'TV and radio (EBU R 128)' },
  loud: { id: 'loud', name: 'Loud', lufs: -9, tp: -1, note: 'Clubs and DJ sets. Streaming services turn it down.' },
};

// Our own characters: a gentle tilt, a glue amount and how much the optional width adds.
export const CHARACTERS = {
  warm: { id: 'warm', name: 'Warm', note: 'Rounder lows, softer highs, gentle glue', low: 1.5, high: -1.5, presence: 0, ratio: 1.6, width: 1.05 },
  balanced: { id: 'balanced', name: 'Balanced', note: 'Even tone, transparent glue', low: 0, high: 0, presence: 0, ratio: 1.8, width: 1.1 },
  bright: { id: 'bright', name: 'Bright', note: 'Tighter lows, open highs, more presence', low: -0.5, high: 2, presence: 1, ratio: 2, width: 1.15 },
};

export const TOO_QUIET_LUFS = -55; // below this a mix is mostly silence: there is nothing to master
const MAX_GAIN_DB = 36;
const TP_MARGIN = 0.1; // dB under the true-peak target the limiter aims for
export const LOSSY_MARGIN = 1; // extra dB of headroom for MP3, whose encoder overshoots

// ---------------------------------------------------------------------------------------------
// Filters (RBJ cookbook biquads), run in place in Float64 state
// ---------------------------------------------------------------------------------------------

export function biquad(type, f, rate, { q = Math.SQRT1_2, gain = 0 } = {}) {
  const w = (2 * Math.PI * Math.min(f, rate * 0.49)) / rate;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const A = 10 ** (gain / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'highpass' || type === 'lowpass') {
    const al = sw / (2 * q);
    const s = type === 'highpass' ? 1 + cw : 1 - cw;
    b0 = s / 2;
    b1 = type === 'highpass' ? -s : s;
    b2 = s / 2;
    a0 = 1 + al;
    a1 = -2 * cw;
    a2 = 1 - al;
  } else if (type === 'peaking') {
    const al = sw / (2 * q);
    b0 = 1 + al * A;
    b1 = -2 * cw;
    b2 = 1 - al * A;
    a0 = 1 + al / A;
    a1 = -2 * cw;
    a2 = 1 - al / A;
  } else {
    // shelves with slope 1
    const al = (sw / 2) * Math.SQRT2;
    const sq = 2 * Math.sqrt(A) * al;
    if (type === 'lowshelf') {
      b0 = A * (A + 1 - (A - 1) * cw + sq);
      b1 = 2 * A * (A - 1 - (A + 1) * cw);
      b2 = A * (A + 1 - (A - 1) * cw - sq);
      a0 = A + 1 + (A - 1) * cw + sq;
      a1 = -2 * (A - 1 + (A + 1) * cw);
      a2 = A + 1 + (A - 1) * cw - sq;
    } else {
      b0 = A * (A + 1 + (A - 1) * cw + sq);
      b1 = -2 * A * (A - 1 + (A + 1) * cw);
      b2 = A * (A + 1 + (A - 1) * cw - sq);
      a0 = A + 1 - (A - 1) * cw + sq;
      a1 = 2 * (A - 1 - (A + 1) * cw);
      a2 = A + 1 - (A - 1) * cw - sq;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Run biquads in series over x in place (transposed direct form II). */
export function filterInPlace(x, filters) {
  for (const f of filters) {
    const { b0, b1, b2, a1, a2 } = f;
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const y = b0 * v + s1;
      s1 = b1 * v - a1 * y + s2;
      s2 = b2 * v - a2 * y;
      x[i] = y;
    }
  }
  return x;
}

// ---------------------------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------------------------

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export const BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
// A typical mastered mix, octave-band power in dB relative to the 250 Hz - 2 kHz average: a gentle fall above
// 1 kHz and a little weight around 100 Hz. Rough on purpose: the report says "about right" within 1.5 dB.
export const REFERENCE = [-6, 0, 1, 0, -0.5, -1.5, -3.5, -6, -9.5, -15.5];

/** Long-term octave-band spectrum of the mid signal, relative to its 250 Hz - 2 kHz average (dB). */
export function octaveSpectrum(chs, rate, { size = 4096, maxWindows = 240 } = {}) {
  const n = chs[0].length;
  const pow = new Float64Array(size / 2);
  const hann = new Float64Array(size);
  for (let i = 0; i < size; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  const count = Math.max(1, Math.min(maxWindows, Math.floor(n / size)));
  const step = n > size ? (n - size) / Math.max(1, count - 1) : 0;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let w = 0; w < count; w++) {
    const o = Math.round(w * step);
    for (let i = 0; i < size; i++) {
      let v = 0;
      for (const x of chs) v += x[o + i] || 0;
      re[i] = (v / chs.length) * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k];
  }
  const band = BANDS.map((fc) => {
    const lo = Math.max(1, Math.floor(((fc / Math.SQRT2) * size) / rate));
    const hi = Math.min(size / 2 - 1, Math.ceil(((fc * Math.SQRT2) * size) / rate));
    let s = 0;
    for (let k = lo; k <= hi; k++) s += pow[k];
    return s;
  });
  const mid = (band[3] + band[4] + band[5] + band[6]) / 4;
  return band.map((p) => (p > 0 && mid > 0 ? 10 * Math.log10(p / mid) : -60));
}

/** Plain words for a tonal difference in dB (positive = more than typical). */
function lean(d, more, less) {
  const a = Math.abs(d);
  if (a < 1.5) return 'about right';
  return `${a < 4 ? 'a little ' : ''}${d > 0 ? more : less}`;
}

/**
 * Measure a mix. chs: planar Float32Arrays at `rate`. Returns numbers plus a list of plain-English lines.
 */
export function analyze(chs, rate) {
  const frames = chs[0].length;
  const meter = new LoudnessMeter(rate, chs.length, frames);
  meter.push(chs, frames);
  const lufs = meter.integrated();
  const lra = Number.isFinite(lufs) ? meter.lra() : 0;
  const tpm = new TruePeakMeter(chs.length);
  tpm.push(chs, frames);
  tpm.finish();
  const truePeak = tpm.dBTP();
  let peak = 0;
  let clips = 0;
  for (const x of chs) {
    let run = 0;
    for (let i = 0; i < frames; i++) {
      const a = x[i] < 0 ? -x[i] : x[i];
      if (a > peak) peak = a;
      if (a >= 0.999) {
        if (++run === 3) clips++; // three samples pinned at full scale in a row is a clip
      } else run = 0;
    }
  }
  // stereo
  let correlation = 1;
  let width = 0;
  let bassWidth = 0;
  if (chs.length >= 2) {
    const [L, R] = chs;
    let lr = 0;
    let ll = 0;
    let rr = 0;
    let mm = 0;
    let ss = 0;
    for (let i = 0; i < frames; i++) {
      const l = L[i];
      const r = R[i];
      lr += l * r;
      ll += l * l;
      rr += r * r;
      const m = l + r;
      const s = l - r;
      mm += m * m;
      ss += s * s;
    }
    correlation = ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 1;
    width = mm > 0 ? Math.sqrt(ss / mm) : 0;
    // below 150 Hz
    const step = Math.max(1, Math.floor(frames / (rate * 120))); // at most about two minutes of samples
    const lo = Float32Array.from({ length: Math.ceil(frames / step) }, (_, k) => L[k * step] + R[k * step]);
    const so = Float32Array.from({ length: lo.length }, (_, k) => L[k * step] - R[k * step]);
    const r2 = rate / step;
    const lp = () => [biquad('lowpass', Math.min(150, r2 * 0.45), r2), biquad('lowpass', Math.min(150, r2 * 0.45), r2)];
    filterInPlace(lo, lp());
    filterInPlace(so, lp());
    let a = 0;
    let b = 0;
    for (let i = 0; i < lo.length; i++) { a += lo[i] * lo[i]; b += so[i] * so[i]; }
    bassWidth = a > 0 ? Math.sqrt(b / a) : 0;
  }
  const spectrum = octaveSpectrum(chs, rate);
  const dev = spectrum.map((d, i) => d - REFERENCE[i]);
  const avg = (ix) => ix.reduce((s, i) => s + dev[i], 0) / ix.length;
  const tone = { low: avg([1, 2]), lowMid: avg([3, 4]), mid: avg([5, 6]), presence: avg([7]), air: avg([8, 9]) };
  const report = {
    rate,
    channels: chs.length,
    duration: frames / rate,
    lufs,
    lra,
    truePeak,
    samplePeak: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
    plr: Number.isFinite(lufs) ? truePeak - lufs : 0,
    clips,
    correlation,
    width,
    bassWidth,
    spectrum,
    tone,
    tooQuiet: !Number.isFinite(lufs) || lufs < TOO_QUIET_LUFS,
  };
  report.lines = describe(report);
  return report;
}

const f1 = (x) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toFixed(1).replace('-', '−') : '−∞');

/** The report in short plain sentences: [{ label, value, say }]. */
export function describe(r) {
  const out = [];
  out.push({ label: 'Loudness', value: `${f1(r.lufs)} LUFS`, say: !Number.isFinite(r.lufs) || r.tooQuiet ? 'Almost silent.' : r.lufs > -10 ? 'Already very loud.' : r.lufs > -16 ? 'Around streaming level.' : r.lufs > -24 ? 'Quieter than streaming level.' : 'Very quiet.' });
  out.push({ label: 'True peak', value: `${f1(r.truePeak)} dBTP`, say: r.truePeak > -0.1 ? 'Touches or passes full scale: it may distort after encoding.' : r.truePeak > -1 ? 'Close to full scale.' : 'Safe headroom.' });
  out.push({ label: 'Loudness range', value: `${f1(r.lra)} LU`, say: r.lra < 4 ? 'Even and steady, like most pop and podcasts.' : r.lra < 10 ? 'Some movement between quiet and loud parts.' : 'Wide swings between quiet and loud parts.' });
  const t = r.tone;
  out.push({ label: 'Tone', value: `lows ${lean(t.low, 'heavy', 'light')}, highs ${lean((t.presence + t.air) / 2, 'bright', 'dark')}`, say: `Compared with a typical mastered mix: low mids ${lean(t.lowMid, 'thick', 'thin')}, presence ${lean(t.presence, 'forward', 'set back')}.` });
  if (r.channels >= 2) {
    const w = r.correlation > 0.97 ? 'Nearly mono.' : r.width < 0.25 ? 'Narrow.' : r.width < 0.6 ? 'Normal width.' : r.correlation < 0.2 ? 'Very wide: check it in mono, parts may cancel.' : 'Wide.';
    out.push({ label: 'Stereo', value: `${Math.round(r.width * 100)}% side, correlation ${(Math.round(r.correlation * 100) / 100).toFixed(2)}`, say: `${w}${r.bassWidth > 0.35 ? ' The bass is spread wide; it will be tightened.' : ''}` });
  } else out.push({ label: 'Stereo', value: 'Mono', say: 'One channel. It stays mono.' });
  out.push({ label: 'Clipping', value: r.clips ? `${r.clips} spot${r.clips === 1 ? '' : 's'}` : 'None', say: r.clips ? 'Flat-topped peaks were found. Mastering cannot undo them; export a cleaner mix if you can.' : 'No flat-topped peaks.' });
  return out;
}

// ---------------------------------------------------------------------------------------------
// The chain
// ---------------------------------------------------------------------------------------------

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Settings for one character x destination, from the analysis. Pure, so a card always renders the same master. */
export function planChain(report, character = 'balanced', destination = 'streaming', { widen = false, lossy = false } = {}) {
  const C = CHARACTERS[character] || CHARACTERS.balanced;
  const D = DESTINATIONS[destination] || DESTINATIONS.streaming;
  const t = report.tone;
  // correct about half of what is off, gently, then add the character's tilt
  const lowFix = clamp(-0.5 * t.low, -2.5, 2.5);
  const highFix = clamp(-0.5 * ((t.presence + t.air) / 2), -2.5, 2.5);
  const eq = [
    { type: 'highpass', f: 25, q: Math.SQRT1_2 },
    // nothing anyone hears lives above 19.5 kHz, and leaving it out keeps the true-peak limiter honest
    { type: 'lowpass', f: 19500, q: 0.54 },
    { type: 'lowpass', f: 19500, q: 1.31 },
    { type: 'lowshelf', f: 110, gain: clamp(C.low + lowFix, -4, 4) },
    { type: 'highshelf', f: 7500, gain: clamp(C.high + highFix, -4, 4) },
  ];
  if (C.presence) eq.push({ type: 'peaking', f: 3200, q: 0.9, gain: C.presence });
  const loud = D.id === 'loud';
  const glue = { threshold: (Number.isFinite(report.lufs) ? report.lufs : -30) + (loud ? 1 : 3), ratio: C.ratio + (loud ? 0.5 : 0), knee: 6, attack: 0.02, release: 0.2 };
  const stereo = report.channels >= 2;
  const width = widen && stereo && report.correlation > 0.3 ? C.width : 1;
  const monoBass = stereo && report.bassWidth > 0.35;
  const ceiling = D.tp - TP_MARGIN - (lossy ? LOSSY_MARGIN : 0);
  return { character: C.id, destination: D.id, lufs: D.lufs, tp: D.tp, ceiling, eq, glue, width, monoBass };
}

/** Everything before the loudness stage: EQ, glue, width. Returns new planar channels. */
export function preChain(chs, rate, plan) {
  const out = chs.map((x) => Float32Array.from(x));
  const filters = plan.eq
    .filter((f) => (f.type === 'lowpass' ? f.f < rate * 0.45 : f.type === 'highpass' || Math.abs(f.gain || 0) >= 0.05))
    .map((f) => biquad(f.type, f.f, rate, f));
  for (const x of out) filterInPlace(x, filters);
  glue(out, rate, plan.glue);
  if (out.length >= 2 && (plan.width !== 1 || plan.monoBass)) width(out, rate, plan.width, plan.monoBass);
  return out;
}

/** Stereo-linked feed-forward RMS compressor with a soft knee; slow, for glue, no make-up gain. */
export function glue(chs, rate, { threshold, ratio, knee = 6, attack = 0.02, release = 0.2 }) {
  if (ratio <= 1) return 0;
  const n = chs[0].length;
  const at = Math.exp(-1 / (attack * rate));
  const rt = Math.exp(-1 / (release * rate));
  const det = Math.exp(-1 / (0.01 * rate)); // 10 ms RMS
  let ms = 0;
  let gr = 0; // smoothed gain reduction in dB (positive)
  let most = 0;
  const half = knee / 2;
  const slope = 1 - 1 / ratio;
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const x of chs) p += x[i] * x[i];
    ms = det * ms + (1 - det) * (p / chs.length);
    const lvl = ms > 1e-12 ? 10 * Math.log10(ms) : -120;
    const over = lvl - threshold;
    const want = over <= -half ? 0 : over >= half ? over * slope : (slope * (over + half) ** 2) / (2 * knee);
    gr = want > gr ? at * gr + (1 - at) * want : rt * gr + (1 - rt) * want;
    if (gr > most) most = gr;
    if (gr > 1e-4) {
      const g = 10 ** (-gr / 20);
      for (const x of chs) x[i] *= g;
    }
  }
  return most;
}

/** Mid/side width above about 150 Hz, and optionally the side signal below it removed (mono bass). */
export function width(chs, rate, w, monoBass) {
  const [L, R] = chs;
  const n = L.length;
  const S = new Float32Array(n);
  for (let i = 0; i < n; i++) S[i] = 0.5 * (L[i] - R[i]);
  const low = Float32Array.from(S);
  filterInPlace(low, [biquad('lowpass', 150, rate), biquad('lowpass', 150, rate)]); // Linkwitz-Riley 4th order
  for (let i = 0; i < n; i++) {
    const m = 0.5 * (L[i] + R[i]);
    const hi = S[i] - low[i];
    const s = (monoBass ? 0 : low[i]) + hi * w;
    L[i] = m + s;
    R[i] = m - s;
  }
}

function measure(chs, rate) {
  const m = new LoudnessMeter(rate, chs.length, chs[0].length);
  m.push(chs, chs[0].length);
  return m.integrated();
}

function limit(chs, rate, gain, ceilingDb, truePeak = true) {
  const n = chs[0].length;
  const lim = new Limiter(chs.length, rate, 10 ** (ceilingDb / 20), gain, { truePeak });
  const out = chs.map(() => new Float32Array(n));
  const B = 1 << 15;
  let o = 0;
  const put = (part) => {
    const k = part[0].length;
    for (let c = 0; c < out.length; c++) out[c].set(part[c], o);
    o += k;
  };
  for (let off = 0; off < n; off += B) put(lim.process(chs.map((x) => x.subarray(off, Math.min(n, off + B))), Math.min(B, n - off)));
  put(lim.flush());
  return { out, maxGr: -20 * Math.log10(lim.minGain || 1) };
}

/**
 * Master planar channels. Returns { channels, lufs, truePeak, gainDb, limiterDb, glueDb, passes }.
 * Throws an Error with .code = 'quiet' for near-silence.
 */
export function master(chs, rate, plan, { onProgress, pre } = {}) {
  const src = measure(chs, rate);
  if (!Number.isFinite(src) || src < TOO_QUIET_LUFS) {
    const e = new Error('Too quiet to master: this file is almost silent.');
    e.code = 'quiet';
    throw e;
  }
  onProgress?.(0.05, 'Shaping tone');
  pre ||= preChain(chs, rate, plan);
  const L0 = measure(pre, rate);
  let gDb = clamp(plan.lufs - L0, -40, MAX_GAIN_DB);
  let ceiling = plan.ceiling;
  const tries = [];
  const step = (L) => {
    // loudness grows less than 1 dB per dB once the limiter works: step along the measured slope (secant)
    tries.push([gDb, L]);
    let slope = 1;
    if (tries.length > 1) {
      const [[g0, l0], [g1, l1]] = tries.slice(-2);
      if (g1 !== g0) slope = clamp((l1 - l0) / (g1 - g0), 0.1, 1);
    }
    gDb = clamp(gDb + (plan.lufs - L) / slope, -40, MAX_GAIN_DB);
  };
  // 1. find the gain quickly with the sample-peak detector
  for (let pass = 0; pass < 6; pass++) {
    onProgress?.(0.15 + 0.08 * pass, 'Setting loudness');
    const { out } = limit(pre, rate, 10 ** (gDb / 20), ceiling, false);
    const L = measure(out, rate);
    if (Math.abs(plan.lufs - L) <= 0.08 || gDb >= MAX_GAIN_DB) break;
    step(L);
  }
  // 2. the real thing, with the true-peak detector; correct once or twice more
  let best = null;
  let passes = 0;
  for (let pass = 0; pass < 5; pass++) {
    passes++;
    onProgress?.(0.65 + 0.07 * pass, 'Limiting true peaks');
    const { out, maxGr } = limit(pre, rate, 10 ** (gDb / 20), ceiling, true);
    const { lufs: L, truePeak: T } = measureOutput(out, rate);
    const tpOk = T <= plan.tp - 0.02;
    const r = { channels: out, lufs: L, truePeak: T, gainDb: gDb, limiterDb: maxGr, tpOk };
    if (!best || (tpOk && (!best.tpOk || Math.abs(plan.lufs - L) < Math.abs(plan.lufs - best.lufs)))) best = r;
    if (!tpOk) {
      // an in-between peak got through: aim lower and run again
      ceiling -= T - (plan.tp - TP_MARGIN) + 0.05;
      continue;
    }
    if (Math.abs(plan.lufs - L) <= 0.15 || gDb >= MAX_GAIN_DB) break;
    step(L);
  }
  best.passes = passes;
  onProgress?.(1, 'Done');
  const { tpOk, ...res } = best;
  res.tpOk = tpOk;
  return res;
}

/** Loudness and true peak of finished audio (what the export report shows). */
export function measureOutput(chs, rate) {
  const lufs = measure(chs, rate);
  const tp = new TruePeakMeter(chs.length);
  tp.push(chs, chs[0].length);
  tp.finish();
  return { lufs, truePeak: tp.dBTP() };
}
