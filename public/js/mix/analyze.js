// Listening to one stem: loudness, where it plays, its spectrum, how punchy it is, its stereo image,
// and the 100 Hz envelopes the mix needs later (kick for sidechain, vocal for ducking and riding, sibilance
// for de-essing). Pure functions of planar Float32Arrays, so it runs in a worker and in Node tests.

import { biquad, filterInPlace } from '../master.js';
import { LoudnessMeter } from '../loudness.js';

export const THIRDS = [31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000];
export const ENV_RATE = 100; // envelope frames per second

const dB = (p) => (p > 1e-12 ? 10 * Math.log10(p) : -120);

export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** Mean-square envelope in dB at ENV_RATE, of x (optionally band-limited first). */
export function envelope(x, rate, filters) {
  const y = filters ? filterInPlace(Float32Array.from(x), filters) : x;
  const hop = Math.round(rate / ENV_RATE), n = Math.ceil(y.length / hop), out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    const a = k * hop, b = Math.min(y.length, a + hop);
    for (let i = a; i < b; i++) s += y[i] * y[i];
    out[k] = dB(s / Math.max(1, b - a));
  }
  return out;
}

/** Average power per third-octave band (dB, absolute) over the windows where the stem actually plays. */
export function thirdSpectrum(mono, rate, active, { size = 4096, maxWindows = 160 } = {}) {
  const hop = Math.round(rate / ENV_RATE), framesPerWin = Math.max(1, Math.round(size / hop));
  const starts = [];
  for (let k = 0; k + framesPerWin < active.length; k += framesPerWin) {
    let on = 0;
    for (let j = 0; j < framesPerWin; j++) on += active[k + j];
    if (on > framesPerWin * 0.6) starts.push(k * hop);
  }
  const pick = starts.length > maxWindows ? Array.from({ length: maxWindows }, (_, i) => starts[Math.floor((i * starts.length) / maxWindows)]) : starts;
  const pow = new Float64Array(size / 2), re = new Float64Array(size), im = new Float64Array(size);
  const hann = new Float64Array(size);
  for (let i = 0; i < size; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  for (const o of pick) {
    for (let i = 0; i < size; i++) { re[i] = (mono[o + i] || 0) * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k];
  }
  const norm = Math.max(1, pick.length) * size * size * 0.375 / 4;
  return THIRDS.map((fc) => {
    const lo = Math.max(1, Math.floor((fc / 2 ** (1 / 6)) * size / rate)), hi = Math.min(size / 2 - 1, Math.ceil((fc * 2 ** (1 / 6)) * size / rate));
    let s = 0;
    for (let k = lo; k <= hi; k++) s += pow[k];
    return dB(s / norm);
  });
}

/**
 * Everything the mixer needs to know about one stem.
 * chs: planar Float32Arrays (1 or 2) at rate.
 */
export function analyzeStem(chs, rate) {
  const n = chs[0].length, duration = n / rate;
  // Mono sum for analysis; stereo facts first.
  const mono = new Float32Array(n);
  let lr = 0, ll = 0, rr = 0, ss = 0, mm = 0, peak = 0;
  if (chs.length > 1) {
    const [L, R] = chs;
    for (let i = 0; i < n; i++) {
      const l = L[i], r = R[i], m = 0.5 * (l + r), s = 0.5 * (l - r);
      mono[i] = m; lr += l * r; ll += l * l; rr += r * r; mm += m * m; ss += s * s;
      const a = Math.max(l < 0 ? -l : l, r < 0 ? -r : r); if (a > peak) peak = a;
    }
  } else {
    const x = chs[0];
    for (let i = 0; i < n; i++) { mono[i] = x[i]; const a = x[i] < 0 ? -x[i] : x[i]; if (a > peak) peak = a; }
  }
  const correlation = chs.length > 1 && ll > 0 && rr > 0 ? lr / Math.sqrt(ll * rr) : 1;
  const width = chs.length > 1 && mm > 0 ? Math.sqrt(ss / mm) : 0; // side/mid amplitude ratio
  const isMono = chs.length === 1 || correlation > 0.995 || width < 0.02;

  const meter = new LoudnessMeter(rate, chs.length, n);
  meter.push(chs, n);
  const lufs = meter.integrated();

  const env = envelope(mono, rate);
  const low = envelope(mono, rate, [biquad('lowpass', 150, rate), biquad('lowpass', 150, rate)]);
  const sib = envelope(mono, rate, [biquad('highpass', 5000, rate), biquad('highpass', 5000, rate), biquad('lowpass', 10000, rate)]);
  const pres = envelope(mono, rate, [biquad('highpass', 1000, rate), biquad('lowpass', 5000, rate)]);
  // Three wide bands for matching against a rough mix: under 150 Hz, 150 Hz-2.5 kHz, above 2.5 kHz.
  const bands = { low, mid: envelope(mono, rate, [biquad('highpass', 150, rate), biquad('lowpass', 2500, rate)]), high: envelope(mono, rate, [biquad('highpass', 2500, rate), biquad('highpass', 2500, rate)]) };
  const top = env.reduce((a, b) => Math.max(a, b), -120);
  const floor = Math.max(-62, top - 42);
  const active = new Uint8Array(env.length);
  let on = 0, first = -1, last = -1, sumP = 0;
  for (let k = 0; k < env.length; k++) if (env[k] > floor) { active[k] = 1; on++; if (first < 0) first = k; last = k; sumP += 10 ** (env[k] / 10); }
  const activeRms = on ? dB(sumP / on) : -120;
  // How loud the loud passages are: the 90th percentile of the 10 ms levels while it plays (what a compressor reacts to).
  const levels = []; for (let k = 0; k < env.length; k++) if (active[k]) levels.push(env[k]);
  levels.sort((a, b) => a - b);
  const loudDb = levels.length ? levels[Math.floor(levels.length * 0.9)] : -120;
  // Onsets: a jump of 9 dB within 30 ms, above the floor.
  let onsets = 0;
  for (let k = 3; k < env.length; k++) {
    if (!active[k]) continue;
    const prev = Math.min(env[k - 1], env[k - 2], env[k - 3]);
    if (env[k] - prev > 9 && env[k] > activeRms - 12 && !(env[k - 1] - Math.min(env[k - 2], env[k - 3]) > 9)) onsets++;
  }
  const activeSeconds = on / ENV_RATE;
  const spectrum = thirdSpectrum(mono, rate, active);
  const lin = spectrum.map((d) => 10 ** (d / 10)), total = lin.reduce((a, b) => a + b, 0) || 1;
  const share = (lo, hi) => THIRDS.reduce((s, f, i) => s + (f >= lo && f < hi ? lin[i] : 0), 0) / total;
  const centroid = Math.exp(THIRDS.reduce((s, f, i) => s + Math.log(f) * lin[i], 0) / total);
  return {
    duration, channels: chs.length, isMono, correlation, width,
    lufs: Number.isFinite(lufs) ? lufs : -70,
    peakDb: 20 * Math.log10(peak || 1e-9), loudDb, activeRms,
    crestDb: 20 * Math.log10(peak || 1e-9) - activeRms, // peak vs RMS while playing (env holds power in dB)
    activeRatio: env.length ? on / env.length : 0, activeSeconds,
    start: first < 0 ? 0 : first / ENV_RATE, end: last < 0 ? 0 : (last + 1) / ENV_RATE,
    onsetsPerSec: activeSeconds > 0.5 ? onsets / activeSeconds : 0,
    spectrum, centroid,
    subShare: share(0, 60), lowShare: share(0, 160), mudShare: share(200, 500), midShare: share(500, 4000), highShare: share(4000, 20000), airShare: share(9000, 20000),
    env, low, sib, pres, active, bands,
  };
}

/** Smooth an envelope (dB) with separate attack and release in seconds. */
export function follow(env, attack = 0.005, release = 0.12) {
  const out = new Float32Array(env.length), a = Math.exp(-1 / (attack * ENV_RATE)), r = Math.exp(-1 / (release * ENV_RATE));
  let y = -120;
  for (let k = 0; k < env.length; k++) { const x = env[k]; y = x > y ? a * y + (1 - a) * x : r * y + (1 - r) * x; out[k] = y; }
  return out;
}

/** Sum envelopes (dB) by power, aligned at frame 0. */
export function sumEnvelopes(list, length) {
  const out = new Float32Array(length).fill(-120);
  for (const e of list) for (let k = 0; k < Math.min(length, e.length); k++) {
    const p = 10 ** (out[k] / 10) + 10 ** (e[k] / 10);
    out[k] = dB(p);
  }
  return out;
}

/**
 * Tempo from onset strength (positive envelope slope) of the rhythmic stems, by autocorrelation over 70-180 BPM,
 * folded so the answer prefers 70-150 BPM (trap at 140 stays 140; 75 halftime stays 75). Returns { bpm, confidence }.
 */
export function tempo(envs) {
  const len = Math.max(0, ...envs.map((e) => e.length));
  if (len < ENV_RATE * 4) return { bpm: 0, confidence: 0 };
  const flux = new Float32Array(len);
  for (const e of envs) for (let k = 1; k < e.length; k++) { const d = e[k] - e[k - 1]; if (d > 0 && e[k] > -70) flux[k] += Math.min(d, 30); }
  let mean = 0; for (const v of flux) mean += v; mean /= len;
  for (let k = 0; k < len; k++) flux[k] -= mean;
  const lagMin = Math.floor((60 / 190) * ENV_RATE), lagMax = Math.ceil((60 / 65) * ENV_RATE);
  const ac = new Float64Array(lagMax + 2);
  for (let lag = lagMin - 1; lag <= lagMax + 1; lag++) { let s = 0; for (let k = lag; k < len; k++) s += flux[k] * flux[k - lag]; ac[lag] = s / (len - lag); }
  let zero = 0; for (let k = 0; k < len; k++) zero += flux[k] * flux[k]; zero /= len;
  // Score each lag with its multiples, so the beat beats its subdivisions.
  let best = 0, bestScore = -Infinity;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const sc = ac[lag] + 0.5 * (2 * lag <= lagMax + 1 ? ac[2 * lag] || 0 : 0) + 0.25 * (ac[Math.round(lag / 2)] || 0);
    if (sc > bestScore) { bestScore = sc; best = lag; }
  }
  // parabolic refinement
  const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1], den = y0 - 2 * y1 + y2;
  const lag = best + (den ? 0.5 * (y0 - y2) / den : 0);
  let bpm = (60 * ENV_RATE) / lag;
  while (bpm > 165) bpm /= 2;
  while (bpm < 68) bpm *= 2;
  return { bpm: Math.round(bpm * 10) / 10, confidence: zero > 0 ? Math.max(0, Math.min(1, y1 / zero)) : 0 };
}
