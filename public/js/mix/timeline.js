// The arrangement side of the mix: laying a session's clips on the timeline, tightening doubles to the lead,
// cleaning up between phrases, finding the song's sections and the moves that build into every chorus.
// Everything here is plain arrays, so it runs in the worker and in tests alike.

import { ENV_RATE } from './analyze.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Put a file's clips where the session has them. clips: [{ start, offset, length }] in seconds (start on the
 * timeline, offset into the file). A later clip on the same track hides what's under it, as in the DAW. Clip edges
 * get a 4 ms fade so cuts never click. Returns channels of `length` samples (at least the last clip's end).
 */
export function placeClips(chs, rate, clips, length = 0) {
  const sorted = [...clips].filter((c) => c.length > 0).sort((a, b) => a.start - b.start);
  let end = length;
  for (const c of sorted) end = Math.max(end, Math.round((c.start + c.length) * rate));
  const out = chs.map(() => new Float32Array(end));
  const fade = Math.round(rate * 0.004);
  sorted.forEach((c, k) => {
    const next = sorted[k + 1];
    const from = Math.round(c.start * rate), srcFrom = Math.round(c.offset * rate);
    let n = Math.round(c.length * rate);
    if (next) n = Math.min(n, Math.round(next.start * rate) - from);
    n = Math.min(n, chs[0].length - srcFrom, end - from);
    if (n <= 0) return;
    for (let ch = 0; ch < chs.length; ch++) {
      const src = chs[ch], dst = out[ch];
      for (let i = 0; i < n; i++) {
        const g = i < fade ? i / fade : i >= n - fade ? (n - i) / fade : 1;
        dst[from + i] = src[srcFrom + i] * g;
      }
    }
  });
  return out;
}

/** RMS envelope in dB at `hz` frames a second (1000 for timing work). */
export function fineEnvelope(mono, rate, hz = 1000) {
  const hop = Math.max(1, Math.round(rate / hz)), n = Math.floor(mono.length / hop), out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let e = 0;
    for (let i = k * hop, end = i + hop; i < end; i++) e += mono[i] * mono[i];
    out[k] = 10 * Math.log10(e / hop + 1e-12);
  }
  return out;
}

/** Sung phrases in a 1 kHz dB envelope: runs above the floor, split by gaps of `gapMs` or more. [{ from, to }] in frames. */
export function phrases(env, { floorDb = -45, gapMs = 180, minMs = 120 } = {}) {
  const out = [];
  let start = -1, quiet = 0;
  for (let k = 0; k <= env.length; k++) {
    const on = k < env.length && env[k] > floorDb;
    if (on) { if (start < 0) start = k; quiet = 0; }
    else if (start >= 0 && ++quiet >= gapMs) { const to = k - quiet + 1; if (to - start >= minMs) out.push({ from: start, to }); start = -1; quiet = 0; }
  }
  if (start >= 0 && env.length - start >= minMs) out.push({ from: start, to: env.length });
  return out;
}

/**
 * How far each phrase of a double sits from the lead, in ms (positive: the double is late). Both envelopes at 1 kHz.
 * Returns [{ from, to, ms, score }] per phrase of the double; ms is 0 when the match is weak or already tight.
 */
export function tightenOffsets(doubleEnv, leadEnv, { maxMs = 60, minMs = 4 } = {}) {
  // smoothed over 7 ms, so the match is about where syllables land, not grain
  const smooth = (e) => { const o = new Float32Array(e.length); for (let k = 0; k < e.length; k++) { let s = 0, n = 0; for (let j = -3; j <= 3; j++) { const v = e[k + j]; if (v !== undefined) { s += 10 ** (Math.max(-80, v) / 20); n++; } } o[k] = 20 * Math.log10(s / n + 1e-9); } return o; };
  const dEnv = smooth(doubleEnv), lEnv = smooth(leadEnv);
  const lin = (e, a, b) => { const o = new Float32Array(b - a); let m = 0; for (let i = a; i < b; i++) { o[i - a] = 10 ** (Math.max(-80, e[i] ?? -80) / 20); m += o[i - a]; } m /= o.length; for (let i = 0; i < o.length; i++) o[i] -= m; return o; };
  const out = [];
  for (const p of phrases(doubleEnv)) {
    const a = lin(dEnv, p.from, p.to), ea = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    let best = -Infinity, bestLag = 0;
    for (let lag = -maxMs; lag <= maxMs; lag++) {
      const lo = p.from - lag, hi = p.to - lag;
      if (lo < 0 || hi > leadEnv.length) continue;
      const b = lin(lEnv, lo, hi);
      let c = 0; for (let i = 0; i < a.length; i++) c += a[i] * b[i];
      if (c > best) { best = c; bestLag = lag; }
    }
    const lo = p.from - bestLag, hi = p.to - bestLag;
    const b = lo >= 0 && hi <= leadEnv.length ? lin(lEnv, lo, hi) : null;
    const eb = b ? Math.sqrt(b.reduce((s, v) => s + v * v, 0)) : 0;
    const score = b && ea > 0 && eb > 0 ? best / (ea * eb) : 0;
    // the double is bestLag ms late when its phrase matches the lead's bestLag ms earlier
    out.push({ from: p.from, to: p.to, ms: score >= 0.35 && Math.abs(bestLag) >= minMs ? bestLag : 0, score: +score.toFixed(2) });
  }
  return out;
}

/**
 * Move phrases of a placed stem by their measured offsets (in ms, positive = currently late, so they move earlier).
 * moves: [{ from, to, ms }] in 1 kHz frames. Each phrase is lifted out with 3 ms fades and put back in place.
 */
export function applyTightening(chs, rate, moves) {
  const out = chs.map((c) => Float32Array.from(c));
  const fade = Math.round(rate * 0.003), hop = Math.max(1, Math.round(rate / 1000)); // the frames fineEnvelope used
  for (const m of moves) {
    if (!m.ms) continue;
    const from = m.from * hop, to = Math.min(chs[0].length, m.to * hop), shift = -Math.round((m.ms / 1000) * rate);
    const n = to - from;
    if (n <= 2 * fade) continue;
    for (let ch = 0; ch < chs.length; ch++) {
      const src = chs[ch], dst = out[ch];
      for (let i = from; i < to; i++) dst[i] = 0;
      for (let i = 0; i < n; i++) {
        const j = from + i + shift;
        if (j < 0 || j >= dst.length) continue;
        const g = i < fade ? i / fade : i >= n - fade ? (n - i) / fade : 1;
        dst[j] += src[from + i] * g;
      }
    }
  }
  return out;
}

/**
 * Clean-up between phrases: a gain curve (dB, at ENV_RATE) that lets sung passages through and turns the room,
 * headphone bleed and breaths between them down by `depth` dB. Opens in one frame, holds, then closes gently.
 */
export function gateCurve(env, { depth = 15, openAbove = 12, holdFrames = 15, releaseFrames = 25 } = {}) {
  const n = env.length, out = new Float32Array(n);
  if (!n) return out;
  const sorted = Float32Array.from(env).sort();
  const floor = sorted[Math.floor(n * 0.08)], top = sorted[Math.floor(n * 0.95)];
  if (top - floor < 20) return out; // nothing to clean: the stem is either all sound or all silence
  const thr = Math.max(floor + openAbove, top - 36);
  let hold = 0, g = -depth;
  for (let k = 0; k < n; k++) {
    if (env[k] > thr) { g = 0; hold = holdFrames; }
    else if (hold > 0) { hold--; g = 0; }
    else g = Math.max(-depth, g - depth / releaseFrames);
    out[k] = g;
  }
  return out;
}

/**
 * The song's sections from who's singing. layers[bar]: vocal stems active in that bar; lead[bar]: a lead sings;
 * energy[bar]: the music's level (dB). Returns [{ kind: 'break' | 'verse' | 'chorus', from, to }] in bars.
 */
export function findSections({ layers, lead, energy, adlib = [], hook = [] }) {
  const n = layers.length;
  if (!n) return [];
  const sortedE = energy.filter(Number.isFinite).sort((a, b) => a - b), medE = sortedE[sortedE.length >> 1] ?? 0;
  const maxLayers = Math.max(...layers);
  // A chorus is where the stack is biggest: at least three voices, and near half of the song's largest stack.
  const stackAt = Math.max(3, Math.round(maxLayers * 0.45));
  const raw = [];
  for (let b = 0; b < n; b++) {
    let kind = 'break';
    if (lead[b] || layers[b] > 0) {
      const stacked = maxLayers >= 3 ? layers[b] >= stackAt || (layers[b] >= 2 && adlib[b] && maxLayers < 5) : maxLayers >= 2 ? layers[b] >= 2 : (energy[b] ?? medE) >= medE + 1.5;
      // with one voice all through, a louder half is the chorus (the median splits the bars, so compare with the quiet half)
      if (maxLayers <= 1 && !stacked && Number.isFinite(energy[b])) { const quiet = sortedE[Math.floor(sortedE.length * 0.25)]; if (energy[b] >= quiet + 3) raw.push('chorus'); else raw.push('verse'); continue; }
      kind = stacked || hook[b] ? 'chorus' : 'verse';
    }
    raw.push(kind);
  }
  // majority of three, so one odd bar doesn't make a section
  const sm = raw.map((k, b) => { const w = [raw[b - 1] ?? k, k, raw[b + 1] ?? k]; return w.filter((x) => x === k).length >= 2 ? k : w[0] === w[2] ? w[0] : k; });
  const out = [];
  for (let b = 0; b < n; b++) { if (out.length && out[out.length - 1].kind === sm[b]) out[out.length - 1].to = b + 1; else out.push({ kind: sm[b], from: b, to: b + 1 }); }
  // runs of a single bar join their longer neighbour
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (s.to - s.from > 1 || out.length === 1) continue;
    const prev = out[i - 1], next = out[i + 1];
    const into = prev && (!next || prev.to - prev.from >= next.to - next.from) ? prev : next;
    if (!into) continue;
    if (into === prev) prev.to = s.to; else next.from = s.from;
    out.splice(i, 1); i = -1;
  }
  for (let i = 1; i < out.length; i++) if (out[i].kind === out[i - 1].kind) { out[i - 1].to = out[i].to; out.splice(i, 1); i--; }
  return out;
}

/**
 * The moves that build into each chorus and lift it, as curves at ENV_RATE over `frames`.
 * bar: seconds a bar lasts. Returns { beatHpf: Hz[], beatMute: dB[], fxMute: dB[], leadVerb: dB[], lift: { lead, double, adlib: dB[] }, moves: [...] }.
 */
export function arrangementMoves(sections, bar, frames, opts = {}) {
  const { sweepBars = 2, sweepTo = 320, dropBeats = 2, punchBeats = 1, throwDb = 8, liftLead = 1, liftDouble = 2, liftAdlib = 1, verseVerb = 3, verseDouble = -1.5 } = opts;
  const F = ENV_RATE, beat = bar / 4;
  const beatHpf = new Float32Array(frames).fill(0), beatMute = new Float32Array(frames), fxMute = new Float32Array(frames), leadVerb = new Float32Array(frames);
  const lift = { lead: new Float32Array(frames), double: new Float32Array(frames), adlib: new Float32Array(frames) };
  const moves = [];
  const fill = (arr, fromSec, toSec, value) => { for (let k = Math.max(0, Math.round(fromSec * F)); k < Math.min(frames, Math.round(toSec * F)); k++) arr[k] = typeof value === 'function' ? value((k / F - fromSec) / (toSec - fromSec)) : value; };
  for (const s of sections) {
    const from = s.from * bar, to = s.to * bar;
    if (s.kind === 'chorus') { fill(lift.lead, from, to, liftLead); fill(lift.double, from, to, liftDouble); fill(lift.adlib, from, to, liftAdlib); }
    if (s.kind === 'verse') { fill(leadVerb, from, to, verseVerb); fill(lift.double, from, to, verseDouble); }
  }
  // ramps of 300 ms on the lifts, so a section change plays like a performance, not a switch
  const ramp = (arr, secs = 0.3) => { const r = Math.round(secs * F); const o = Float32Array.from(arr); for (let k = 1; k < arr.length; k++) { const step = Math.abs(arr[k] - arr[k - 1]); if (step > 0.01) for (let j = 0; j < r && k + j < arr.length; j++) o[k + j] = arr[k - 1] + (arr[k] - arr[k - 1]) * ((j + 1) / r); } return o; };
  for (const key of ['lead', 'double', 'adlib']) lift[key] = ramp(lift[key]);
  const leadVerbR = ramp(leadVerb);
  sections.forEach((s, i) => {
    if (s.kind !== 'chorus' || i === 0 || s.from < sweepBars) return;
    const T = s.from * bar;
    // 1. the music thins out: a high-pass sweeping up over the last bars
    fill(beatHpf, T - sweepBars * bar, T - dropBeats * beat, (u) => 25 * (sweepTo / 25) ** (u * u));
    // 2. the drop: the beat goes quiet for the last beats, the vocal carries it in
    fill(beatMute, T - dropBeats * beat, T, -60);
    // 3. the dry punch: every vocal effect off for the last beat, so the chorus lands wet and wide
    fill(fxMute, T - punchBeats * beat, T, -60);
    // 4. the throw: the last words before the gap ring out into it
    fill(leadVerbR, T - bar, T - punchBeats * beat, throwDb);
    moves.push({ at: T, bar: s.from, sweepFrom: T - sweepBars * bar, drop: dropBeats * beat, punch: punchBeats * beat, throwDb });
  });
  // the first chorus (or an intro hook) gets no build-up, but still lifts
  return { beatHpf, beatMute: ramp(beatMute, 0.04), fxMute, leadVerb: leadVerbR, lift, moves };
}

/**
 * Two fake doubles of a lead for sections that have none: pitched ∓cents, 10 and 20 ms late, to pan hard left and
 * right. Granular pitch shift (two 40 ms grains, overlap-add), fine for the ±6 cents a double needs.
 */
export function ghostDouble(mono, rate, { cents = -6, delayMs = 10 } = {}) {
  const ratio = 2 ** (cents / 1200), grain = Math.round(rate * 0.04), hop = grain >> 1, out = new Float32Array(mono.length);
  const win = new Float32Array(grain); for (let i = 0; i < grain; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / grain);
  for (let g = 0; g + hop < mono.length; g += hop) {
    for (let i = 0; i < grain; i++) {
      const src = g + i * ratio, j = Math.floor(src), fr = src - j;
      if (j + 1 >= mono.length || g + i >= out.length) break;
      out[g + i] += (mono[j] * (1 - fr) + mono[j + 1] * fr) * win[i];
    }
  }
  const d = Math.round((delayMs / 1000) * rate), delayed = new Float32Array(mono.length);
  delayed.set(out.subarray(0, Math.max(0, mono.length - d)), d);
  return delayed;
}

/** Vocal stems active per bar, for findSections. active: frames at ENV_RATE. */
export function barActivity(active, bar, bars, minShare = 0.25) {
  const out = new Uint8Array(bars), per = bar * ENV_RATE;
  for (let b = 0; b < bars; b++) {
    let on = 0, n = 0;
    for (let k = Math.round(b * per); k < Math.round((b + 1) * per) && k < active.length; k++) { n++; if (active[k]) on++; }
    out[b] = n && on / n >= minShare ? 1 : 0;
  }
  return out;
}

export const sectionLabel = { break: 'Break', verse: 'Verse', chorus: 'Chorus' };
export const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export { clamp };
