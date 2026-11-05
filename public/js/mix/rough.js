// The rough mix: the artist's own full bounce of the unmixed song. It's the answer key for the session:
//   - where each stem belongs in time (stems from a session folder often start at their first note, not bar 1),
//   - how loud the artist meant each part to be,
//   - which files aren't in the song at all (alternate takes, unused parts),
//   - which parts of the song the stems are missing,
//   - and, after mixing, whether the finished mix still plays every section of the song.
// Pure functions of envelopes and samples, so it runs in the worker and in Node tests.

import { fft, ENV_RATE } from './analyze.js';
import { biquad, filterInPlace } from '../master.js';

// Names that mean "the whole song", not a part of it.
export const ROUGH_NAME = /\b(rough(\s?mix)?|bounce[ds]?|mix\s?down|mixdown|full\s?(song|mix|track)|stereo\s?(out|mix|bounce|master)|2[\s-]?mix|two[\s-]?mix|demo|ref(erence)?|print|preview|final\s?(mix|master)?|master(ed)?|main\s?mix|mix\s?\d*|v\d+\s?mix)\b/i;
const PART = /\b(vox|vocals?|kick|snare|hats?|808|bass|drums?|keys|piano|pad|gtr|guitar|synth|fx|adlibs?|bgv|bv|perc|clap|strings?|lead|beat|instrumental|inst|acapella|a\s?cappella)\b/i;

/**
 * Does this file look like the full bounce? path: its path in the session; others: the other paths.
 * A name like "Rough Mix.wav" or "Song v3 (bounce).mp3", a file in a "Bounces"/"Bounced Files"/"Mixdown" folder,
 * or a lone top-level file named like the song folder the stems sit in.
 */
export function looksLikeRough(path, others = []) {
  const parts = String(path).split('/'), name = parts.pop().replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' '), folder = parts.join('/');
  if (PART.test(name) && !/\b(rough|bounce|full|mixdown|mix\s?down|2[\s-]?mix|stereo out)\b/i.test(name)) return false;
  if (/\b(bounce[ds]?|bounced files|mixdowns?|renders?|prints?|masters?|rough mixes)\b/i.test(folder)) return true;
  if (ROUGH_NAME.test(name)) return true;
  // "My Song/My Song.wav" next to "My Song/Stems/Kick.wav"
  const top = parts[0];
  if (top && parts.length === 1 && name.toLowerCase().replace(/\s+/g, ' ').includes(top.toLowerCase().replace(/[_]+/g, ' ').trim()) && others.some((o) => o.split('/').length > 2)) return true;
  return false;
}

// ---------- alignment ----------

/** Onset strength (positive slope of a dB envelope), mean-removed. */
export function flux(env) {
  const out = new Float32Array(env.length);
  for (let k = 1; k < env.length; k++) { const d = env[k] - env[k - 1]; out[k] = d > 0 && env[k] > -70 ? Math.min(d, 30) : 0; }
  let m = 0; for (const v of out) m += v; m /= out.length || 1;
  for (let k = 0; k < out.length; k++) out[k] -= m;
  return out;
}

/**
 * Cross-correlation of a against b by FFT: c = Σ a[t] b[t + lag], for every lag the two can overlap at,
 * -(a.length - 1) .. b.length - 1. Returns { c, min } where c[i] is the value at lag i + min.
 */
export function xcorr(a, b) {
  let n = 1;
  while (n < a.length + b.length) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  ar.set(a); br.set(b);
  fft(ar, ai); fft(br, bi);
  // conj(A) * B
  for (let k = 0; k < n; k++) { const r = ar[k] * br[k] + ai[k] * bi[k], i = ar[k] * bi[k] - ai[k] * br[k]; ar[k] = r; ai[k] = -i; }
  fft(ar, ai); // forward FFT of the conjugate = n * conj(inverse); real part is what we need
  const min = -(a.length - 1), out = new Float64Array(a.length + b.length - 1);
  for (let i = 0; i < out.length; i++) out[i] = ar[(i + min + n) % n] / n;
  return { c: out, min };
}

/**
 * Where a stem sits in the rough, in envelope frames (ENV_RATE), and how sure we are (0..1).
 * Positive lag: the stem's material appears that many frames later in the rough.
 */
export function coarseLag(stemEnv, roughEnv) {
  const a = flux(stemEnv), b = flux(roughEnv);
  const { c, min } = xcorr(a, b);
  let best = 0, bi = -min;
  for (let i = 0; i < c.length; i++) if (c[i] > best) { best = c[i]; bi = i; }
  let ea = 0, eb = 0; for (const v of a) ea += v * v; for (const v of b) eb += v * v;
  const confidence = ea > 0 && eb > 0 ? best / Math.sqrt(ea * eb) : 0;
  return { lag: bi + min, confidence };
}

/**
 * A coarse picture of a signal for finding where it sits: the waveform under 900 Hz at about 2.2 kHz, or for parts with
 * little below 900 Hz (hats, cymbals) the loudness contour of everything above 2 kHz at the same rate.
 */
export function sketch(mono, rate, { bright = false } = {}) {
  const D = Math.max(1, Math.round(rate / 2205)), x = Float32Array.from(mono);
  if (bright) {
    filterInPlace(x, [biquad('highpass', 2000, rate), biquad('highpass', 2000, rate)]);
    for (let i = 0; i < x.length; i++) x[i] = Math.abs(x[i]);
    filterInPlace(x, [biquad('lowpass', 60, rate), biquad('lowpass', 60, rate)]);
  } else filterInPlace(x, [biquad('lowpass', 900, rate), biquad('lowpass', 900, rate)]);
  const out = new Float32Array(Math.floor(x.length / D));
  for (let i = 0; i < out.length; i++) out[i] = x[i * D];
  if (bright) { let m = 0; for (const v of out) m += v; m /= out.length || 1; for (let i = 0; i < out.length; i++) out[i] -= m; }
  return { data: out, step: D };
}

/**
 * Where a stem sits in the rough, from their sketches: the lag (in samples at the full rate) and how far the best match
 * stands out (z-score). Loops repeat every bar, so when no shift scores almost as well as the best, it stays put.
 */
export function waveLag(stemSketch, roughSketch) {
  const a = stemSketch.data, b = roughSketch.data;
  const { c, min } = xcorr(a, b);
  let best = -Infinity, bi = -min, mean = 0;
  for (let i = 0; i < c.length; i++) { mean += c[i]; if (c[i] > best) { best = c[i]; bi = i; } }
  mean /= c.length;
  let sd = 0; for (const v of c) sd += (v - mean) ** 2; sd = Math.sqrt(sd / c.length) || 1;
  const atZero = c[-min];
  const lag = atZero >= 0.85 * best ? 0 : bi + min;
  // edge: how far the best lag beats bar 1, in the same noise units. A part that really sits later wins by a lot.
  return { lag: lag * stemSketch.step, z: (best - mean) / sd, edge: lag ? (best - atZero) / sd : 0 };
}

/**
 * Sample-accurate offset: correlate one second of the stem (its loudest) against the rough around the coarse guess.
 * Returns the shift in samples to apply to the stem (positive = delay it) and the normalised peak (-1..1).
 */
export function fineShift(stem, rough, rate, coarseFrames, opts = {}) {
  return fineShiftAt(stem, rough, rate, Math.round((coarseFrames * rate) / ENV_RATE), opts);
}

/** fineShift with the coarse guess in samples. */
export function fineShiftAt(stem, rough, rate, coarse, { search = Math.round(rate * 0.012) } = {}) {
  const win = Math.min(stem.length, Math.round(rate * 1));
  if (win < rate * 0.1) return { shift: coarse, peak: 0 };
  // loudest second of the stem
  let at = 0, best = -1;
  for (let o = 0; o + win <= stem.length; o += Math.round(rate / 4)) { let e = 0; for (let i = o; i < o + win; i += 8) e += stem[i] * stem[i]; if (e > best) { best = e; at = o; } }
  const base = at + coarse;
  let bestC = 0, bestLag = 0, es = 0;
  for (let i = 0; i < win; i++) es += stem[at + i] * stem[at + i];
  for (let lag = -search; lag <= search; lag++) {
    const o = base + lag;
    if (o < 0 || o + win > rough.length) continue;
    let c = 0, er = 0;
    for (let i = 0; i < win; i += 2) { const r = rough[o + i]; c += stem[at + i] * r; er += r * r; }
    const nc = er > 0 && es > 0 ? c / Math.sqrt((es / 2) * er) : 0;
    if (nc > bestC) { bestC = nc; bestLag = lag; }
  }
  return { shift: coarse + bestLag, peak: bestC };
}

/**
 * Per-stem shifts, relative to the session as a whole. If several stems sit the same distance from the rough (an MP3
 * rough has encoder delay, a bounce may carry plugin latency), that common offset belongs to the rough, not the stems.
 * shifts: samples per stem (null when unsure). The biggest group of agreeing shifts (ties: the one nearest zero) is
 * the common offset; returns each stem's shift relative to it, with tiny ones zeroed.
 */
export function relativeShifts(shifts, tolerance = 3) {
  const known = shifts.filter((s) => Number.isFinite(s));
  if (!known.length) return shifts.map(() => 0);
  let common = 0, size = -1;
  for (const c of known) {
    const n = known.filter((s) => Math.abs(s - c) <= tolerance).length;
    if (n > size || (n === size && Math.abs(c) < Math.abs(common))) { size = n; common = c; }
  }
  // The cluster's median is the offset the rough really carries: steadier than whichever member won the vote.
  const members = known.filter((s) => Math.abs(s - common) <= tolerance).sort((x, y) => x - y);
  common = members[(members.length - 1) >> 1];
  return shifts.map((s) => (Number.isFinite(s) && Math.abs(s - common) > tolerance ? s - common : 0));
}

/** Shift a dB envelope by `frames` (positive = later), filling with silence. */
export function shiftEnv(env, frames, length = env.length) {
  const out = new Float32Array(length).fill(-120);
  for (let k = 0; k < length; k++) { const j = k - frames; if (j >= 0 && j < env.length) out[k] = env[j]; }
  return out;
}

// ---------- balance ----------

const pow = (d) => (d > -119 ? 10 ** (d / 10) : 0);

/**
 * How loud the artist had each stem in the rough. stems: [{ low, mid, high }] dB envelopes (already shifted into place);
 * rough: the same bands. Non-negative least squares on power envelopes (multiplicative updates), both bands at once.
 * Returns { gains: dB per stem (power gain applied in the rough; -Infinity when absent), fit: R² of the power fit }.
 */
export function fitLevels(stems, rough, { iterations = 250, step = 3 } = {}) {
  const n = Math.min(rough.low.length, ...stems.map((s) => s.low.length));
  const idx = [];
  for (let k = 0; k < n; k += step) idx.push(k);
  const bands = ['low', 'mid', 'high'].filter((b) => rough[b] && stems.every((s) => s[b]));
  const R = [], P = stems.map(() => []);
  for (const b of bands) {
    let scale = 0; for (const k of idx) scale += pow(rough[b][k]); scale = scale / idx.length || 1;
    for (const k of idx) { R.push(pow(rough[b][k]) / scale); stems.forEach((s, i) => P[i].push(pow(s[b][k]) / scale)); }
  }
  const m = R.length, w = stems.map(() => 1), model = new Float64Array(m);
  const update = () => { model.fill(0); w.forEach((wi, i) => { if (wi) for (let t = 0; t < m; t++) model[t] += wi * P[i][t]; }); };
  for (let it = 0; it < iterations; it++) {
    update();
    for (let i = 0; i < w.length; i++) {
      let num = 0, den = 0;
      for (let t = 0; t < m; t++) { num += P[i][t] * R[t]; den += P[i][t] * model[t]; }
      w[i] = den > 0 ? w[i] * (num / den) : 0;
    }
  }
  update();
  let ss = 0, st = 0, mean = 0; for (const v of R) mean += v; mean /= m || 1;
  for (let t = 0; t < m; t++) { ss += (R[t] - model[t]) ** 2; st += (R[t] - mean) ** 2; }
  return { gains: w.map((v) => (v > 1e-9 ? 10 * Math.log10(v) : -Infinity)), fit: st > 0 ? Math.max(0, 1 - ss / st) : 0 };
}

// ---------- coverage ----------

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Stretches (≥ minSeconds) where `ref` plays but `test` is much quieter than it should be.
 * ref, test: full-band dB envelopes at ENV_RATE, compared after matching their typical loudness.
 * Returns [{ start, end, label }].
 */
export function gapsBetween(ref, test, { minSeconds = 1.5, drop = 15 } = {}) {
  const n = Math.min(ref.length, test.length);
  const top = ref.reduce((a, b) => Math.max(a, b), -120);
  const live = [];
  for (let k = 0; k < n; k++) if (ref[k] > top - 30) live.push(k);
  if (!live.length) return [];
  const diffs = live.map((k) => test[k] - ref[k]).sort((a, b) => a - b), offset = diffs[Math.floor(diffs.length / 2)];
  const out = [];
  let run = -1;
  for (let k = 0; k <= n; k++) {
    const bad = k < n && ref[k] > top - 30 && test[k] - ref[k] - offset < -drop;
    if (bad && run < 0) run = k;
    if (!bad && run >= 0) {
      if ((k - run) / ENV_RATE >= minSeconds) out.push({ start: run / ENV_RATE, end: k / ENV_RATE, label: `${fmt(run / ENV_RATE)}–${fmt(k / ENV_RATE)}` });
      run = -1;
    }
  }
  // merge gaps closer than a second
  return out.reduce((acc, g) => { const last = acc[acc.length - 1]; if (last && g.start - last.end < 1) { last.end = g.end; last.label = `${fmt(last.start)}–${fmt(g.end)}`; } else acc.push({ ...g }); return acc; }, []);
}

/** Sum of fitted stem powers per frame, as a dB envelope (what the stems explain of the rough). */
export function fittedEnvelope(stemEnvs, gainsDb, length) {
  const out = new Float32Array(length);
  for (let k = 0; k < length; k++) {
    let p = 0;
    stemEnvs.forEach((e, i) => { if (Number.isFinite(gainsDb[i])) p += pow(e[k] ?? -120) * 10 ** (gainsDb[i] / 10); });
    out[k] = p > 1e-12 ? 10 * Math.log10(p) : -120;
  }
  return out;
}
