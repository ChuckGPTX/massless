// Retune: pitch correction for a vocal, the way every pro vocal template starts (Auto-Key then Auto-Tune on each
// take). Three parts: the song's key from the music (a pitch-class profile against the major and minor scales),
// the vocal's pitch over time (YIN on 2048-sample windows every 5 ms), and the correction (each sung note pulled
// toward the nearest scale note at a retune speed, applied as a time-varying granular pitch shift).

import { fft } from './analyze.js';

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const midi = (hz) => 69 + 12 * Math.log2(hz / 440);
const hz = (m) => 440 * 2 ** ((m - 69) / 12);

/** Fundamental frequency of one window by YIN (de Cheveigné & Kawahara). Returns Hz, or 0 when unvoiced. */
export function yin(x, start, rate, { win = 1536, fmin = 75, fmax = 1000, threshold = 0.15 } = {}) {
  const maxTau = Math.min(Math.floor(rate / fmin), win >> 1), minTau = Math.max(2, Math.floor(rate / fmax));
  if (start + win > x.length) return 0;
  const d = new Float32Array(maxTau + 1), half = win >> 1;
  let energy = 0;
  for (let i = 0; i < half; i++) energy += x[start + i] * x[start + i];
  if (energy / half < 1e-5) return 0; // quiet: not a note (−50 dB)
  // d(tau) = Σ (x[i] − x[i+tau])² = e0 + e(tau) − 2·r(tau); the correlation is the costly part, so use every
  // second sample of the window: plenty for a 75 Hz-and-up voice at this resolution
  for (let tau = 1; tau <= maxTau; tau++) { let s = 0; for (let i = 0; i < half; i += 2) { const v = x[start + i] - x[start + i + tau]; s += v * v; } d[tau] = s; }
  // cumulative mean normalised difference
  let run = 0;
  const cmnd = new Float32Array(maxTau + 1); cmnd[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) { run += d[tau]; cmnd[tau] = run ? (d[tau] * tau) / run : 1; }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) if (cmnd[t] < threshold) { while (t + 1 <= maxTau && cmnd[t + 1] < cmnd[t]) t++; tau = t; break; }
  if (tau < 0) return 0;
  // parabolic refinement
  const a = cmnd[tau - 1] ?? cmnd[tau], b = cmnd[tau], c = cmnd[tau + 1] ?? cmnd[tau], den = a - 2 * b + c;
  const shift = den ? (0.5 * (a - c)) / den : 0;
  return rate / (tau + shift);
}

/** Pitch track: Hz per hop (0 = unvoiced). hop in samples. */
export function pitchTrack(mono, rate, { hop = Math.round(rate * 0.01), win = 1536 } = {}) {
  const n = Math.max(0, Math.floor((mono.length - win) / hop)), out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[k] = yin(mono, k * hop, rate, { win });
  // drop lone voiced frames and octave jumps that last one frame
  for (let k = 1; k < n - 1; k++) {
    if (out[k] && !out[k - 1] && !out[k + 1]) out[k] = 0;
    if (out[k] && out[k - 1] && out[k + 1]) { const r1 = out[k] / out[k - 1], r2 = out[k] / out[k + 1]; if ((r1 > 1.8 || r1 < 0.55) && (r2 > 1.8 || r2 < 0.55)) out[k] = Math.sqrt(out[k - 1] * out[k + 1]); }
  }
  return out;
}


/**
 * Pitch-class profile of a signal (how much of each note it holds): 8192-point spectra every 0.1 s, only the
 * tonal peaks between 120 Hz and 3 kHz (a bin louder than its neighbours and well above the local floor, so
 * drums and noise don't count), each peak's frequency refined and mapped to its semitone.
 */
export function chroma(mono, rate, { hop = Math.round(rate * 0.1), n = 8192 } = {}) {
  const out = new Float32Array(12), win = new Float32Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  const re = new Float32Array(n), im = new Float32Array(n), mag = new Float32Array(n >> 1);
  const lo = Math.ceil((120 * n) / rate), hi = Math.min((n >> 1) - 2, Math.floor((3000 * n) / rate)), span = Math.round((60 * n) / rate); // floor: median-ish over ±60 Hz
  for (let b = 0; b + n <= mono.length; b += hop) {
    let e = 0;
    for (let i = 0; i < n; i++) { re[i] = mono[b + i] * win[i]; im[i] = 0; e += re[i] * re[i]; }
    if (e / n < 1e-7) continue;
    fft(re, im);
    for (let k = 0; k < mag.length; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    for (let k = lo; k <= hi; k++) {
      if (mag[k] <= mag[k - 1] || mag[k] < mag[k + 1]) continue;
      let floor = 0, c = 0; for (let j = Math.max(1, k - span); j <= Math.min(mag.length - 1, k + span); j += 3) { floor += mag[j]; c++; }
      floor /= c;
      if (mag[k] < floor * 4) continue; // not a peak that stands out (12 dB over the local floor)
      const a = mag[k - 1], m = mag[k], cN = mag[k + 1], den = a - 2 * m + cN, d = den ? (0.5 * (a - cN)) / den : 0;
      const f = ((k + d) * rate) / n;
      const pc = ((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12;
      out[pc] += Math.sqrt(m / floor);
    }
  }
  const top = Math.max(...out) || 1;
  for (let i = 0; i < 12; i++) out[i] /= top;
  return out;
}

/** Which notes a pitch track sings, by time: a 12-bin profile to add to the music's chroma. */
export function noteHistogram(track) {
  const out = new Float32Array(12);
  for (const f of track) if (f) out[((Math.round(midi(f)) % 12) + 12) % 12] += 1;
  const top = Math.max(...out) || 1;
  for (let i = 0; i < 12; i++) out[i] /= top;
  return out;
}

/** The key a chroma fits best (Krumhansl-Schmuckler). Returns { tonic: 0-11, mode: 'major' | 'minor', name, score }. */
export function detectKey(ch) {
  // Krumhansl's profile correlation says which tonic; a plain diatonic fit (notes in the scale minus notes out of
  // it) settles major against minor, which the profiles alone get wrong on sparse beats.
  let best = null;
  const total = ch.reduce((a, b) => a + b, 0) || 1;
  for (const [mode, prof] of [['major', MAJOR], ['minor', MINOR]]) {
    const degrees = SCALES[mode];
    for (let t = 0; t < 12; t++) {
      let sxy = 0, sxx = 0, syy = 0, mx = 0, my = 0;
      for (let i = 0; i < 12; i++) { mx += ch[i] / 12; my += prof[i] / 12; }
      for (let i = 0; i < 12; i++) { const x = ch[i] - mx, y = prof[(i - t + 12) % 12] - my; sxy += x * y; sxx += x * x; syy += y * y; }
      const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
      let inS = 0; for (const d of degrees) inS += ch[(d + t) % 12];
      const fit = (inS - (total - inS)) / total; // 1 = every note in the scale, -1 = none
      const score = r + 0.5 * fit;
      if (!best || score > best.score) best = { tonic: t, mode, score, r, fit };
    }
  }
  return { ...best, name: `${NOTE[best.tonic]} ${best.mode}` };
}

/** Nearest scale note (as MIDI, fractional allowed in) in a key. */
export function snapToScale(m, key) {
  const degrees = SCALES[key.mode].map((d) => (d + key.tonic) % 12);
  let best = m, bd = Infinity;
  for (let cand = Math.floor(m) - 2; cand <= Math.ceil(m) + 2; cand++) {
    if (!degrees.includes(((cand % 12) + 12) % 12)) continue;
    const d = Math.abs(cand - m);
    if (d < bd) { bd = d; best = cand; }
  }
  return best;
}

/**
 * Correct a vocal. track: Hz per hop from pitchTrack. Returns the correction in cents per hop (what to shift by),
 * smoothed at the retune speed (ms to reach the note; 0 = instant, Auto-Tune's "0"; 100 = natural).
 * strength 0..1 scales the correction. Vibrato and slides faster than the speed are kept.
 */
export function correctionCurve(track, key, { hopMs = 10, speedMs = 60, strength = 1, maxCents = 200 } = {}) {
  const out = new Float32Array(track.length);
  const alpha = speedMs <= 0 ? 1 : 1 - Math.exp(-hopMs / speedMs);
  let cur = 0;
  for (let k = 0; k < track.length; k++) {
    if (!track[k]) { cur *= 0.9; out[k] = 0; continue; }
    const m = midi(track[k]), target = snapToScale(m, key);
    const want = Math.max(-maxCents, Math.min(maxCents, (target - m) * 100)) * strength;
    cur += (want - cur) * alpha;
    out[k] = cur;
  }
  return out;
}

/**
 * Apply a cents-per-hop correction by TD-PSOLA: grains two pitch periods long, cut at the sung pitch and laid
 * back down at the corrected period, so grains stay in phase and nothing combs. Timing is unchanged. Unvoiced
 * stretches pass straight through.
 */
export function applyCorrection(mono, rate, cents, { hop = Math.round(rate * 0.01), track = null } = {}) {
  const n = mono.length, out = new Float32Array(n);
  const f0At = (i) => (track ? track[Math.min(track.length - 1, Math.floor(i / hop))] || 0 : 0);
  const centsAt = (i) => cents[Math.min(cents.length - 1, Math.floor(i / hop))] || 0;
  // input marks: one per period while voiced; every 5 ms while unvoiced (ratio 1 there, so it's a pass-through)
  const marks = [];
  for (let i = 0; i < n;) { const f = f0At(i); const P = f ? rate / f : hop; marks.push({ at: i, P, voiced: !!f }); i += Math.max(8, Math.round(P)); }
  if (!marks.length) return out;
  // output marks: same timeline, period divided by the ratio; each takes the grain of the nearest input mark
  let t = marks[0].at, mi = 0;
  const windowCache = new Map();
  const win = (len) => { if (!windowCache.has(len)) { const w = new Float32Array(len); for (let i = 0; i < len; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (len + 1)); windowCache.set(len, w); } return windowCache.get(len); };
  while (t < n) {
    while (mi + 1 < marks.length && Math.abs(marks[mi + 1].at - t) <= Math.abs(marks[mi].at - t)) mi++;
    const m = marks[mi], ratio = m.voiced ? 2 ** (centsAt(Math.round(t)) / 1200) : 1;
    const half = Math.round(m.P), len = 2 * half, w = win(len), from = m.at - half, to = Math.round(t) - half;
    for (let i = 0; i < len; i++) { const si = from + i, oi = to + i; if (si >= 0 && si < n && oi >= 0 && oi < n) out[oi] += mono[si] * w[i]; }
    t += m.P / ratio;
  }
  return out;
}

/**
 * The whole thing. music: a mono array to find the key in (null: the vocal's own notes decide).
 * Returns { audio, key, cents: average |correction| while voiced, voicedShare }.
 */
export function retune(mono, rate, { music = null, musicChroma = null, key = null, speedMs = 60, strength = 1, adapt = true } = {}) {
  const hop = Math.round(rate * 0.01);
  const track = pitchTrack(mono, rate, { hop });
  // Sung or rapped? Notes held steady for a quarter second or more are singing; a rap moves every few frames.
  // A sung lead gets the templates' singing chain: the retune twice as fast (the Auto-Tune EFX lock) at full strength.
  const sungShare = sustainedShare(track);
  const sung = sungShare >= 0.3;
  if (adapt && sung) { speedMs = Math.round(speedMs * 0.5); strength = Math.max(strength, 0.9); }
  let K = key;
  if (!K) { // the music's notes and the sung notes vote together
    const base = musicChroma || (music ? chroma(music, rate) : null), sung = noteHistogram(track);
    K = detectKey(base ? base.map((v, i) => v + sung[i] * 0.7) : sung);
  }
  const cents = correctionCurve(track, K, { hopMs: 10, speedMs, strength });
  let voiced = 0, sum = 0;
  for (let k = 0; k < track.length; k++) if (track[k]) { voiced++; sum += Math.abs(cents[k]); }
  return { audio: applyCorrection(mono, rate, cents, { hop, track }), key: K, cents: voiced ? sum / voiced : 0, voicedShare: track.length ? voiced / track.length : 0, sungShare, sung, speedMs, strength };
}

/** The share of voiced frames that sit in a held note: a run of 25+ frames (250 ms) that stays within 60 cents. */
export function sustainedShare(track, { minFrames = 25, cents = 60 } = {}) {
  let voiced = 0, held = 0, run = 0, ref = 0;
  for (let k = 0; k < track.length; k++) {
    const f = track[k];
    if (!f) { if (run >= minFrames) held += run; run = 0; continue; }
    voiced++;
    if (run && Math.abs(1200 * Math.log2(f / ref)) <= cents) run++;
    else { if (run >= minFrames) held += run; run = 1; ref = f; }
    // let the reference drift with the note so a slow vibrato still counts as held
    ref = ref * 0.9 + f * 0.1;
  }
  if (run >= minFrames) held += run;
  return voiced ? held / voiced : 0;
}

export { NOTE, SCALES };
