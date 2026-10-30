// Score engine for the Film page: a launch-film soundtrack synthesized in the browser, locked to the beat grid.
//
// renderScore() builds the track at 48 kHz in two halves. Drums, 808s, risers and the edit's cut sounds are
// written sample by sample in JS, so every transient lands on its exact sample. The tonal parts (pads, arps,
// braams, stabs, strings, bells) are persistent Web Audio voices in an OfflineAudioContext. The halves meet in
// JS: the build filter, echo, a feedback-delay-network reverb and sidechain ducking, then mastering to about
// -14 LUFS (BS.1770) with a look-ahead limiter that keeps the interpolated peak under -1 dBFS, and short fades.
// No samples, no network, no Math.random: the same inputs always give identical samples.

const SR = 48000;
const TAU = Math.PI * 2;
const TARGET_LUFS = -14;
const CEILING = 0.87; // -1.2 dBFS on the interpolated peak, so sample peaks stay under -1 dBFS (0.891)
const MAX_GR = 6; // dB: the most the limiter may take off a peak
const FADE_IN = 0.01;
const FADE_OUT = 0.3;

/**
 * @typedef {{ id: string, name: string, bpm: number }} ScoreStyle
 * Music styles, in the order the Film page lists them. bpm is the default tempo for the style.
 * @type {ScoreStyle[]}
 */
export const STYLES = [
  { id: 'phonk', name: 'Phonk', bpm: 150 },
  { id: 'drive', name: 'Drive', bpm: 118 },
  { id: 'trailer', name: 'Trailer', bpm: 96 },
  { id: 'trap', name: 'Trap', bpm: 140 },
  { id: 'house', name: 'House', bpm: 124 },
];

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mod = (a, n) => ((a % n) + n) % n;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const db = (x) => 10 ** (x / 20);

/** mulberry32: a small seeded PRNG, so a seed reproduces a score exactly. */
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
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length) % arr.length];
const noise = (rand) => rand() * 2 - 1;

// ---------------------------------------------------------------------------------------------
// Harmony: one key per seed; chords are stacked thirds of the scale, so bass, chords and motifs agree
// ---------------------------------------------------------------------------------------------

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};
const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

/** MIDI note of scale degree d (any integer) in octave oct (C4 = 60). */
function degree(key, d, oct) {
  return 12 * (oct + 1) + key.root + key.scale[mod(d, 7)] + 12 * Math.floor(d / 7);
}
/** Move a MIDI note by octaves into [lo, lo + 12): close voicings and smooth voice leading for free. */
const fold = (m, lo) => lo + mod(m - lo, 12);
/** Chord on scale degree c as MIDI notes folded into [lo, lo + 12), lowest first. */
function chordNotes(key, c, n, lo) {
  const out = [];
  for (let k = 0; k < n; k++) out.push(fold(degree(key, c + 2 * k, 4), lo));
  return out.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// JS DSP for the one-shots
// ---------------------------------------------------------------------------------------------

/** RBJ biquad (lp, hp or bp with 0 dB peak), transposed direct form II, in place. */
function biquad(x, type, f, q = 0.707) {
  const w = (TAU * Math.min(f, SR * 0.45)) / SR;
  const cs = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  let b0;
  let b1;
  let b2;
  if (type === 'lp') { b1 = 1 - cs; b0 = b2 = b1 / 2; } else if (type === 'hp') { b1 = -(1 + cs); b0 = b2 = -b1 / 2; } else { b0 = al; b1 = 0; b2 = -al; }
  const a0 = 1 + al;
  const a1 = (-2 * cs) / a0;
  const a2 = (1 - al) / a0;
  b0 /= a0; b1 /= a0; b2 /= a0;
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = b0 * v + z1;
    z1 = b1 * v - a1 * y + z2;
    z2 = b2 * v - a2 * y;
    x[i] = y;
  }
  return x;
}

/**
 * Topology-preserving state-variable filter (Zavalishin), in place. It stays stable while the cutoff moves,
 * so it carries the swept sounds (risers, whooshes); freqAt(i) is read every 16 samples.
 */
function svf(x, mode, freqAt, q = 1) {
  const k = 1 / q;
  let ic1 = 0;
  let ic2 = 0;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  for (let i = 0; i < x.length; i++) {
    if ((i & 15) === 0) {
      const g = Math.tan((Math.PI * clamp(freqAt(i), 20, SR * 0.45)) / SR);
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }
    const v0 = x[i];
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    x[i] = mode === 'bp' ? v1 * k : mode === 'lp' ? v2 : v0 - k * v1 - v2;
  }
  return x;
}

const buf = (seconds) => new Float32Array(Math.max(1, Math.round(seconds * SR)));
const whiteBuf = (rand, seconds) => { const x = buf(seconds); for (let i = 0; i < x.length; i++) x[i] = noise(rand); return x; };
/** Fade the last 3 ms so a truncated decay never clicks. */
function tail(x) {
  const n = Math.min(x.length, 144);
  for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n;
  return x;
}

/**
 * A stereo layer written in JS (backed by the AudioBuffers the context will play), plus a mono reverb send.
 * add() mixes a mono one-shot at a time in seconds; the first sample lands on round(t * 48000).
 */
class Layer {
  constructor(L, R, W) { this.L = L; this.R = R; this.W = W; }
  add(t, x, gain = 1, pan = 0, send = 0) {
    const s0 = Math.round(t * SR);
    const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
    const gl = Math.cos(a) * Math.SQRT2 * gain; // constant power, unity in the centre
    const gr = Math.sin(a) * Math.SQRT2 * gain;
    const gs = send * gain;
    const { L, R, W } = this;
    const i0 = Math.max(0, -s0);
    const i1 = Math.min(x.length, L.length - s0);
    for (let i = i0; i < i1; i++) {
      const v = x[i];
      const j = s0 + i;
      L[j] += v * gl;
      R[j] += v * gr;
      if (gs) W[j] += v * gs;
    }
  }
  addStereo(t, l, r, gain = 1, send = 0) {
    const s0 = Math.round(t * SR);
    const { L, R, W } = this;
    const i0 = Math.max(0, -s0);
    const i1 = Math.min(l.length, r.length, L.length - s0);
    const gs = send * gain * 0.5;
    for (let i = i0; i < i1; i++) {
      const j = s0 + i;
      L[j] += l[i] * gain;
      R[j] += r[i] * gain;
      if (gs) W[j] += (l[i] + r[i]) * gs;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// One-shots: each returns a mono Float32Array that starts on its transient
// ---------------------------------------------------------------------------------------------

/** Kick: a sine whose pitch falls exponentially from f0 to f1, saturated, with a short noise click. */
function kick(rand, { f0 = 150, f1 = 48, bend = 0.035, decay = 0.3, click = 0.3, drive = 1.6 } = {}) {
  const x = buf(decay * 6);
  const nd = Math.tanh(drive);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    ph += (TAU * (f1 + (f0 - f1) * Math.exp(-t / bend))) / SR;
    const e = Math.exp(-t / decay) * (i < 24 ? i / 24 : 1);
    x[i] = Math.tanh(Math.sin(ph) * e * drive) / nd;
  }
  const c = Math.round(0.003 * SR);
  for (let i = 0; i < c; i++) x[i] += click * noise(rand) * (1 - i / c) ** 2;
  return tail(x);
}

/** Drum membrane (toms, taiko, the body of hits): pitch-dropping sine, low noise body and a skin slap. */
function membrane(rand, { f0 = 200, f1 = 120, bend = 0.05, decay = 0.3, body = 0.35, bodyF = 600, slap = 0.25, slapF = 2000, drive = 1.3 } = {}) {
  const x = buf(decay * 5 + 0.05);
  const nb = biquad(whiteBuf(rand, x.length / SR), 'lp', bodyF, 0.8);
  const ns = biquad(whiteBuf(rand, 0.03), 'bp', slapF, 1.2);
  const nd = Math.tanh(drive);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    ph += (TAU * (f1 + (f0 - f1) * Math.exp(-t / bend))) / SR;
    const e = (i < 24 ? i / 24 : 1) * Math.exp(-t / decay);
    let v = Math.sin(ph) * e + body * 2.5 * nb[i] * Math.exp(-t / (decay * 0.35));
    if (i < ns.length) v += slap * 3 * ns[i] * Math.exp(-t / 0.006);
    x[i] = Math.tanh(v * drive) / nd;
  }
  return tail(x);
}

/** Snare: band-limited noise plus a two-partial shell tone. */
function snare(rand, { tone = 185, decay = 0.15, bright = 6500, body = 0.5, hp = 900 } = {}) {
  const x = biquad(biquad(whiteBuf(rand, decay * 6 + 0.02), 'hp', hp, 0.7), 'lp', bright, 0.7);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const bend = 1 + 0.25 * Math.exp(-t / 0.008);
    p1 += (TAU * tone * bend) / SR;
    p2 += (TAU * tone * 1.62 * bend) / SR;
    const a = i < 24 ? i / 24 : 1;
    x[i] = a * (1.6 * x[i] * Math.exp(-t / decay) + body * (0.75 * Math.sin(p1) + 0.35 * Math.sin(p2)) * Math.exp(-t / 0.045));
  }
  return tail(x);
}

/** Clap: three quick noise bursts, then a band-passed tail (the 808 way). */
function clap(rand, { decay = 0.15, f = 1250, q = 1.1 } = {}) {
  const x = biquad(biquad(whiteBuf(rand, decay * 6 + 0.04), 'bp', f, q), 'hp', 500, 0.7);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    let e = 0;
    for (const o of [0, 0.009, 0.018]) if (t >= o) e = Math.max(e, Math.exp(-(t - o) / 0.0045));
    if (t >= 0.024) e = Math.max(e, 0.8 * Math.exp(-(t - 0.024) / decay));
    x[i] *= 3.2 * e * (i < 12 ? i / 12 : 1);
  }
  return tail(x);
}

// The six square-wave partials of the 808's cymbal and hat circuit: inharmonic, so they read as metal
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
/** Hats and cymbals: the metal cluster plus noise, high-passed. len overrides the decay-based length. */
function metal(rand, { decay = 0.045, tune = 1, hp = 7000, air = 0.35, len = 0, attack = 0.0003 } = {}) {
  const x = buf(len || decay * 7);
  const ph = METAL.map(() => rand());
  const inc = METAL.map((f) => (f * tune * 2.2) / SR);
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let k = 0; k < 6; k++) { ph[k] += inc[k]; if (ph[k] >= 1) ph[k] -= 1; s += ph[k] < 0.5 ? 1 : -1; }
    x[i] = s / 6 + air * noise(rand);
  }
  biquad(x, 'bp', Math.min(11000, hp * 1.45), 0.6);
  biquad(x, 'hp', hp, 0.7);
  const at = Math.max(1, attack * SR);
  for (let i = 0; i < x.length; i++) x[i] *= 2.4 * Math.min(1, i / at) * Math.exp(-i / SR / decay);
  return tail(x);
}

/** Shaker or soft closed hat: high-passed noise with a slower attack. */
function shaker(rand, { decay = 0.03, hp = 6000, attack = 0.004 } = {}) {
  const x = biquad(whiteBuf(rand, decay * 6 + attack), 'hp', hp, 0.8);
  for (let i = 0; i < x.length; i++) { const t = i / SR; x[i] *= 1.6 * Math.min(1, t / attack) * Math.exp(-Math.max(0, t - attack) / decay); }
  return tail(x);
}

/** A short pitched click (rim, clock tick, key click): a decaying sine with a noise edge. */
function tick(rand, { f = 3000, decay = 0.012, edge = 0.6, q = 2 } = {}) {
  const x = biquad(whiteBuf(rand, decay * 6 + 0.004), 'bp', f * 1.3, q);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    x[i] = (Math.sin(TAU * f * t) * Math.exp(-t / decay) + edge * 3 * x[i] * Math.exp(-t / 0.002)) * (i < 6 ? i / 6 : 1);
  }
  return tail(x);
}

/** Gated reverb burst (the drive snare): dense stereo noise that holds, then shuts. Returns [L, R]. */
function gatedTail(rand, { hold = 0.17, lp = 6000 } = {}) {
  const out = [0, 1].map(() => biquad(biquad(whiteBuf(rand, hold + 0.012), 'lp', lp, 0.6), 'hp', 350, 0.6));
  for (const x of out) {
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      x[i] *= 1.5 * Math.min(1, t / 0.004) * (1 - 0.45 * (t / hold)) * (t > hold ? Math.max(0, 1 - (t - hold) / 0.012) : 1);
    }
  }
  return out;
}

/** Sub boom: a long sine falling from f0 to f1 under a low noise thump. The impact of drops and booms. */
function boom(rand, { f0 = 85, f1 = 30, bend = 0.35, decay = 0.85, thump = 0.6, drive = 1.6 } = {}) {
  const x = buf(decay * 5);
  const th = biquad(whiteBuf(rand, 0.12), 'lp', 260, 0.9);
  const nd = Math.tanh(drive);
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    ph += (TAU * (f1 + (f0 - f1) * Math.exp(-t / bend))) / SR;
    let v = Math.sin(ph) * Math.exp(-t / decay) * (i < 24 ? i / 24 : 1);
    if (i < th.length) v += thump * 4 * th[i] * Math.exp(-t / 0.035);
    x[i] = Math.tanh(v * drive) / nd;
  }
  return tail(x);
}

let CYMBALS = new Map();
/** Stereo cymbal: two slightly detuned metal clusters, one per side. Cached per render (callers never modify it). */
function cymbal(rand, decay = 1.1, len = 3, hp = 4200) {
  const key = `${decay}|${len}|${hp}`;
  if (!CYMBALS.has(key)) CYMBALS.set(key, [metal(rand, { decay, tune: 1, hp, air: 0.7, len }), metal(rand, { decay: decay * 0.92, tune: 1.047, hp, air: 0.7, len })]);
  return CYMBALS.get(key);
}

/**
 * An 808 note written straight into a layer: a sine (plus a little second harmonic so it reads on phones)
 * that can slide in from another pitch, saturated with tanh. dur is the gate; the note releases over 25 ms.
 */
function play808(layer, t, dur, f, { from = 0, glide = 0.08, drive = 2, decay = 1.6, level = 1, harm = 0.15, lp = 0 } = {}) {
  const gate = Math.round(dur * SR);
  const rel = Math.round(0.025 * SR);
  const x = new Float32Array(gate + rel);
  const nd = Math.tanh(drive);
  const ratio = from > 0 ? from / f : 1;
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const tt = i / SR;
    // the slide moves in pitch (log frequency), which is how a portamento sounds right
    const ff = ratio === 1 || tt > glide * 2.5 ? f : f * ratio ** Math.exp((-tt * 4) / glide);
    ph += (TAU * ff) / SR;
    const e = (i < 48 ? i / 48 : 1) * Math.exp(-tt / decay) * (i > gate ? 1 - (i - gate) / rel : 1);
    x[i] = Math.tanh((Math.sin(ph) + harm * Math.sin(2 * ph)) * e * drive) / nd;
  }
  if (lp) biquad(x, 'lp', lp, 0.6);
  layer.add(t, x, level);
}

/** Noise riser into a layer: a band-pass sweeping f0 -> f1 (exponentially) as the level climbs to t1. */
function riser(layer, rand, t0, t1, { f0 = 300, f1 = 7000, q = 1.4, level = 0.3, curve = 2.2, send = 0.3, release = 0.05 } = {}) {
  if (t1 - t0 < 0.05) return;
  const n = Math.round((t1 - t0) * SR);
  const r = Math.round(release * SR);
  const ch = [0, 1].map(() => {
    const x = whiteBuf(rand, (n + r) / SR);
    svf(x, 'bp', (i) => f0 * (f1 / f0) ** Math.min(1, i / n), q);
    for (let i = 0; i < x.length; i++) x[i] *= i < n ? (i / n) ** curve : 1 - (i - n) / r;
    return x;
  });
  layer.addStereo(t0, ch[0], ch[1], level, send);
}

/** A cymbal played backwards so its swell ends exactly at t1. */
function reverseCymbal(layer, rand, t1, len, level = 0.3, send = 0.3) {
  if (len < 0.1) return;
  const [l, r] = cymbal(rand, len * 0.45, len, 3500).map((x) => x.slice().reverse());
  for (const x of [l, r]) for (let i = 0; i < 96; i++) x[x.length - 1 - i] *= i / 96;
  layer.addStereo(t1 - len, l, r, level, send);
}

// ---------------------------------------------------------------------------------------------
// Web Audio: the mix bus and the tonal instruments
// ---------------------------------------------------------------------------------------------

// Chromium sums the connections into an input in hash-set (pointer) order, and float addition is not
// associative, so three or more connections into one node render slightly differently from run to run.
// Two inputs are fine (a + b === b + a), so every mix point here is a binary tree of unity gains.
/** Connect nodes into dest through a pairwise tree of GainNodes, so each input sums at most two signals. */
function sumInto(ctx, nodes, dest) {
  let level = nodes.filter(Boolean);
  while (level.length > 2) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) { const g = ctx.createGain(); level[i].connect(g); level[i + 1].connect(g); next.push(g); } else next.push(level[i]);
    }
    level = next;
  }
  for (const n of level) n.connect(dest);
}

/**
 * The Web Audio half of the mix. Instruments collect on the music bus, their reverb sends on the send bus and
 * their echo sends on the echo bus; the context renders five channels (music L/R, send L/R, echo) and mixDown()
 * does the rest in JS: the build filter, echo, reverb, sidechain ducking and the sum with the drums and cuts.
 * (Each of those in Web Audio would be a node processed every render quantum for the whole film.)
 */
function makeMix(ctx) {
  const m = { ctx, musicIn: [], sendIn: [], echoIn: [], echo: null };
  ctx.destination.channelInterpretation = 'discrete';
  const merger = ctx.createChannelMerger(5);
  merger.connect(ctx.destination);
  m.bus = [0, 1, 2].map((k) => {
    const g = ctx.createGain();
    g.channelCount = k < 2 ? 2 : 1;
    g.channelCountMode = 'explicit'; // mono sources up-mix to both sides; the echo bus sums to mono
    if (k < 2) {
      const split = ctx.createChannelSplitter(2);
      g.connect(split);
      split.connect(merger, 0, 2 * k);
      split.connect(merger, 1, 2 * k + 1);
    } else g.connect(merger, 0, 4);
    return g;
  });
  m.close = () => { sumInto(ctx, m.musicIn, m.bus[0]); sumInto(ctx, m.sendIn, m.bus[1]); sumInto(ctx, m.echoIn, m.bus[2]); };
  return m;
}

/** Route a node to the music bus (or into `out`) with an optional reverb send. */
function route(m, node, out, send) {
  if (out) node.connect(out); else m.musicIn.push(node);
  if (send) { const s = m.ctx.createGain(); s.gain.value = send; node.connect(s); m.sendIn.push(s); }
}

// Delay lengths (samples at 48 kHz, mutually prime, 30-64 ms) and input diffusers for the reverb
const FDN_LENS = [1427, 1621, 1871, 2063, 2347, 2539, 2803, 3061];
const DIFFUSE = [[223, 337, 557], [241, 353, 571]];

/**
 * Feedback-delay-network reverb, in JS: eight delay lines mixed by a Hadamard matrix, each loop losing
 * 60 dB over t60 seconds and darkening through a one-pole low-pass, fed through three all-pass diffusers
 * per side. Returns [wetL, wetR] normalised so an impulse's tail carries unit energy, like a normalised IR.
 */
function fdnReverb(inL, inR, n, { t60 = 1.6, damp = 0.4, size = 1, pre = 0.012 } = {}) {
  const lens = FDN_LENS.map((l) => Math.round(l * size));
  const fb = Float64Array.from(lens, (l) => 10 ** ((-3 * l) / (t60 * SR)));
  const run = (srcL, srcR, len, outL, outR) => {
    const D = lens.map((l) => new Float32Array(l));
    const P = new Int32Array(8);
    const Z = new Float64Array(8); // damping filter state per loop
    const v = new Float64Array(8);
    const A = [...DIFFUSE[0], ...DIFFUSE[1]].map((l) => new Float32Array(Math.round(l * size)));
    const AP = new Int32Array(6);
    const p = Math.round(pre * SR);
    const k1 = 1 - damp;
    const s8 = 1 / Math.sqrt(8);
    let i0 = 0;
    while (i0 < len && srcL[i0] === 0 && srcR[i0] === 0) i0++; // nothing rings before the first sound
    for (let i = i0; i < len; i++) {
      let xl = i - i0 >= p ? srcL[i - p] : 0;
      let xr = i - i0 >= p ? srcR[i - p] : 0;
      for (let k = 0; k < 3; k++) { // Schroeder all-passes smear the input before it enters the loops
        const bl = A[k];
        const br = A[k + 3];
        const dl = bl[AP[k]];
        const yl = dl - 0.6 * xl;
        bl[AP[k]] = xl + 0.6 * yl;
        if (++AP[k] === bl.length) AP[k] = 0;
        xl = yl;
        const dq = br[AP[k + 3]];
        const yr = dq - 0.6 * xr;
        br[AP[k + 3]] = xr + 0.6 * yr;
        if (++AP[k + 3] === br.length) AP[k + 3] = 0;
        xr = yr;
      }
      let oL = 0;
      let oR = 0;
      for (let k = 0; k < 8; k++) {
        const d = D[k][P[k]];
        if (k & 1) oR += d; else oL += d;
        Z[k] += (d - Z[k]) * k1;
        v[k] = Z[k] * fb[k];
      }
      outL[i] = oL;
      outR[i] = oR;
      // 8-point Walsh-Hadamard, unrolled: an orthogonal (energy-preserving) mix of the eight loops
      const a0 = v[0] + v[1]; const a1 = v[0] - v[1]; const a2 = v[2] + v[3]; const a3 = v[2] - v[3];
      const a4 = v[4] + v[5]; const a5 = v[4] - v[5]; const a6 = v[6] + v[7]; const a7 = v[6] - v[7];
      const b0 = a0 + a2; const b2 = a0 - a2; const b1 = a1 + a3; const b3 = a1 - a3;
      const b4 = a4 + a6; const b6 = a4 - a6; const b5 = a5 + a7; const b7 = a5 - a7;
      v[0] = b0 + b4; v[4] = b0 - b4; v[1] = b1 + b5; v[5] = b1 - b5; v[2] = b2 + b6; v[6] = b2 - b6; v[3] = b3 + b7; v[7] = b3 - b7;
      for (let k = 0; k < 8; k++) {
        D[k][P[k]] = v[k] * s8 + (k & 1 ? xr : xl) * 0.5;
        if (++P[k] === lens[k]) P[k] = 0;
      }
    }
  };
  // calibrate on an impulse so wet levels mean the same thing at every t60 and size
  const cl = Math.round(Math.min(t60, 4) * SR);
  const imp = new Float32Array(cl);
  imp[0] = 1;
  const zero = new Float32Array(cl);
  const il = new Float32Array(cl);
  const ir = new Float32Array(cl);
  run(imp, zero, cl, il, ir);
  let e = 0;
  for (let i = 0; i < cl; i++) e += il[i] * il[i] + ir[i] * ir[i];
  const g = 1 / Math.sqrt(e || 1);
  const wl = new Float32Array(n);
  const wr = new Float32Array(n);
  run(inL, inR, n, wl, wr);
  for (let i = 0; i < n; i++) { wl[i] *= g; wr[i] *= g; }
  return [wl, wr];
}

/** Sidechain gain per sample: dips to `depth` within ~3 ms of each kick and recovers with time constant rel/3. */
function duckCurve(n, kicks, depth, rel) {
  const g = new Float32Array(n);
  const down = 1 - Math.exp(-1 / (0.0025 * SR));
  const up = 1 - Math.exp(-1 / ((rel / 3) * SR));
  const hold = new Uint8Array(n);
  for (const t of kicks) {
    const a = Math.max(0, Math.round((t - 0.003) * SR));
    const b = Math.min(n, Math.round((t + 0.02) * SR));
    for (let i = a; i < b; i++) hold[i] = 1;
  }
  let v = 1;
  for (let i = 0; i < n; i++) { v += ((hold[i] ? depth : 1) - v) * (hold[i] ? down : up); g[i] = v; }
  return g;
}

let SHAPES = null;
/** tanh waveshaper curve for drive k (cached; curves are shared between nodes). */
function shaper(ctx, k) {
  SHAPES = SHAPES || new Map();
  if (!SHAPES.has(k)) {
    const c = new Float32Array(2049);
    for (let i = 0; i < c.length; i++) { const x = (i / 1024) - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    SHAPES.set(k, c);
  }
  const ws = ctx.createWaveShaper();
  ws.curve = SHAPES.get(k);
  ws.oversample = '2x';
  return ws;
}

/**
 * A re-triggerable synth voice: persistent oscillators -> (drive) -> filter -> amp. One node graph plays a whole
 * part, so a 16th-note arp costs a few automation events per note instead of new nodes. `poly` slots let one
 * voice play chords (stabs); `ratios` stack partials per slot (the cowbell's two squares).
 */
class Synth {
  constructor(m, o) {
    const ctx = m.ctx;
    this.m = m;
    this.o = o = { type: 'sawtooth', poly: 1, ratios: [1], detune: [0], cutoff: 2000, q: 0.7, ftype: 'lowpass', drive: 0, pan: 0, width: 0, level: 1, send: 0, out: null, ...o };
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = o.ftype;
    this.filter.frequency.value = o.cutoff;
    this.filter.frequency.automationRate = 'k-rate';
    this.filter.Q.value = o.q;
    const n = o.poly * o.ratios.length * o.detune.length;
    let head = this.filter;
    if (o.drive) { head = shaper(ctx, o.drive); head.connect(this.filter); }
    const ins = [];
    if (o.width) {
      for (const p of [-o.width, o.width]) { const pn = ctx.createStereoPanner(); pn.pan.value = p; pn.connect(head); ins.push(pn); }
    } else ins.push(head);
    const pre = ins.map((node) => { const g = ctx.createGain(); g.gain.value = 1 / Math.sqrt(n); g.connect(node); return g; });
    this.oscs = [];
    const feeds = pre.map(() => []);
    for (let s = 0; s < o.poly; s++) {
      const slot = [];
      o.ratios.forEach((ratio) => o.detune.forEach((dt, j) => {
        const osc = ctx.createOscillator();
        osc.type = o.type;
        osc.detune.value = dt;
        feeds[j % pre.length].push(osc);
        slot.push({ osc, ratio });
      }));
      this.oscs.push(slot);
    }
    feeds.forEach((f, j) => sumInto(ctx, f, pre[j]));
    this.filter.connect(this.amp);
    let out = this.amp;
    if (o.pan && !o.width) { const pn = ctx.createStereoPanner(); pn.pan.value = o.pan; this.amp.connect(pn); out = pn; }
    route(m, out, o.out, o.send);
    if (o.fx) out.connect(o.fx);
    this.started = false;
  }
  /**
   * Play notes (MIDI, one per slot; fewer notes repeat) at t for dur seconds. Envelope a/d/s/r in seconds and
   * level 0..1; cut = [peak, sustain] Hz for a filter envelope (attack fa, decay fd, starting from c0 when
   * given); glide (s) slides pitch from the last note.
   */
  note(t, dur, notes, { vel = 1, a = 0.004, d = 0.15, s = 0.6, r = 0.08, cut = null, fa = 0, fd = 0, c0 = 0, glide = 0 } = {}) {
    notes = Array.isArray(notes) ? notes : [notes];
    if (!this.started) glide = 0; // the first note starts on pitch
    if (!this.started) {
      const at = Math.max(0, t - 0.02);
      for (const slot of this.oscs) for (const { osc } of slot) osc.start(at);
      this.started = true;
    }
    this.oscs.forEach((slot, k) => {
      const f = mtof(notes[k % notes.length]);
      for (const { osc, ratio } of slot) {
        if (glide > 0) osc.frequency.setTargetAtTime(f * ratio, t, glide / 3);
        else osc.frequency.setValueAtTime(f * ratio, t);
      }
    });
    const g = this.amp.gain;
    const peak = vel * this.o.level;
    // setTargetAtTime starts from wherever the last note left the gain, so retriggers never click
    g.setTargetAtTime(peak, t, a / 3);
    g.setTargetAtTime(peak * s, t + a, Math.max(0.002, d / 3));
    g.setTargetAtTime(0, t + dur, Math.max(0.002, r / 3));
    if (cut) {
      const fq = this.filter.frequency;
      const at = fa || a;
      if (c0) fq.setValueAtTime(c0, t);
      fq.setTargetAtTime(cut[0], t, Math.max(0.001, at / 3));
      fq.setTargetAtTime(cut[1], t + at, Math.max(0.003, (fd || d) / 3));
    }
  }
}

/** FM bell (trap): a sine carrier whose frequency is pushed around by an inharmonic modulator that dies first. */
class Bell {
  constructor(m, { ratio = 3.5, index = 2.2, decay = 0.9, level = 0.2, send = 0.3, pan = 0, out = null } = {}) {
    const ctx = m.ctx;
    Object.assign(this, { ratio, index, decay, level, started: false });
    this.car = ctx.createOscillator();
    this.mod = ctx.createOscillator();
    this.depth = ctx.createGain();
    this.depth.gain.value = 0;
    this.mod.connect(this.depth).connect(this.car.frequency);
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    const pn = ctx.createStereoPanner();
    pn.pan.value = pan;
    this.car.connect(this.amp).connect(pn);
    route(m, pn, out, send);
  }
  note(t, dur, midi, vel = 1) {
    if (!this.started) { this.car.start(Math.max(0, t - 0.02)); this.mod.start(Math.max(0, t - 0.02)); this.started = true; }
    const f = mtof(midi);
    this.car.frequency.setValueAtTime(f, t);
    this.mod.frequency.setValueAtTime(f * this.ratio, t);
    this.depth.gain.setTargetAtTime(f * this.index, t, 0.001);
    this.depth.gain.setTargetAtTime(f * this.index * 0.08, t + 0.004, 0.12);
    this.amp.gain.setTargetAtTime(vel * this.level, t, 0.001);
    this.amp.gain.setTargetAtTime(0, t + 0.004, Math.min(this.decay, dur + 0.3) / 3);
  }
}

/** Round-robin over a few voices, so a note's tail rings under the next one. */
function rr(voices) {
  let k = 0;
  return { note: (...args) => voices[k++ % voices.length].note(...args) };
}

/**
 * Pad: one persistent poly voice (two detuned oscillators per chord tone, spread left and right) that moves
 * legato from chord to chord, gliding each tone to its neighbour. play(t0, t1, notes, { level, a, r, cut }).
 */
function padVoice(m, n, { type = 'sawtooth', detune = 9, cutoff = 1600, width = 0.6, send = 0.35 } = {}) {
  const v = new Synth(m, { type, poly: n, detune: [-detune, detune], width, cutoff, q: 0.5, level: 1, send });
  return {
    play: (t0, t1, notes, { level = 0.1, a = 0.4, r = 0.8, cut = null } = {}) => v.note(t0, Math.max(0.01, t1 - t0), notes, { vel: level, a, d: 0.1, s: 1, r, glide: 0.06, cut: cut ? [cut, cut] : null }),
  };
}

/**
 * Braam (trailer): detuned saws on root, fifth and octave, driven through tanh, into a low-pass that blooms
 * from 110 Hz to `open` in 0.22 s and settles to `rest`. One persistent voice; each braam re-triggers it.
 */
function braamVoice(m) {
  const v = new Synth(m, { type: 'sawtooth', poly: 3, detune: [-11, 11], width: 0.5, drive: 2.5, cutoff: 110, q: 1.1, level: 1, send: 0.45 });
  return {
    play: (t0, dur, notes, { level = 0.32, open = 2400, rest = 750, r = 1.2 } = {}) => v.note(t0, dur, notes, { vel: level, a: 0.04, d: 1.2, s: 0.6, r, cut: [open, rest], fa: 0.22, fd: 1.05, c0: 110 }),
  };
}

/**
 * Ping-pong echo send: returns a node to connect a part into. The echo itself runs in JS after rendering
 * (see echo()), every `time` seconds, alternating sides, each repeat fb quieter and darker.
 */
function pingpong(m, time, fb = 0.35, wet = 0.5, lp = 3500) {
  m.echo = { time, fb, wet, lp };
  const input = m.ctx.createGain();
  m.echoIn.push(input);
  return input;
}


// ---------------------------------------------------------------------------------------------
// The edit's cut sounds. Each writes into the fx layer with its transient (or, for a whoosh, its peak) on t.
// ---------------------------------------------------------------------------------------------

const SFX = {
  /** Air past the lens: band-passed noise sweeping up into the cut, panning across, peaking exactly on t. */
  whoosh(fx, rand, t, g, spb) {
    const pre = Math.min(0.42, spb * 0.9);
    const post = 0.16;
    const np = Math.round(pre * SR);
    const n = np + Math.round(post * SR);
    const ch = [0, 1].map((side) => {
      const x = whiteBuf(rand, n / SR);
      svf(x, 'bp', (i) => (i < np ? 280 * (4200 / 280) ** ((i / np) ** 1.6) : 4200 * 0.35 ** ((i - np) / (n - np))), 1.6);
      for (let i = 0; i < n; i++) {
        const e = i < np ? (i / np) ** 2.6 : Math.exp(-(i - np) / (0.045 * SR));
        const p = clamp(i / n, 0, 1); // pan sweeps left to right through the cut
        x[i] *= 2.2 * e * (side ? 0.35 + 0.65 * p : 1 - 0.65 * p);
      }
      return x;
    });
    fx.addStereo(t - np / SR, ch[0], ch[1], g * 0.55, 0.25);
  },
  /** A sub drop under the cut. */
  boom(fx, rand, t, g) {
    fx.add(t, boom(rand, { f0: 95, f1: 34, bend: 0.18, decay: 0.45, thump: 0.5 }), g * 0.55, 0, 0.12);
    fx.add(t, tick(rand, { f: 1400, decay: 0.01, edge: 0.8 }), g * 0.12, 0, 0.1);
  },
  /** A hard cinematic hit: a punchy body, a cracking mid burst and a short metallic ring. */
  hit(fx, rand, t, g) {
    fx.add(t, membrane(rand, { f0: 160, f1: 62, bend: 0.03, decay: 0.12, body: 0.3, slap: 0.6, slapF: 2600, drive: 1.8 }), g * 0.45, 0, 0.15);
    const crack = biquad(whiteBuf(rand, 0.12), 'bp', 1800, 0.9);
    for (let i = 0; i < crack.length; i++) crack[i] *= 2.4 * Math.exp(-i / SR / 0.025);
    fx.add(t, tail(crack), g * 0.28, 0.1, 0.25);
    fx.add(t, metal(rand, { decay: 0.12, tune: 0.7, hp: 3000, air: 0.2 }), g * 0.08, -0.15, 0.2);
  },
  /** A finger snap: a very short, bright band of noise with a tiny pitched edge. */
  snap(fx, rand, t, g) {
    const x = biquad(whiteBuf(rand, 0.06), 'bp', 2400, 1.6);
    for (let i = 0; i < x.length; i++) { const tt = i / SR; x[i] = (3.2 * x[i] + 0.35 * Math.sin(TAU * 1900 * tt)) * Math.exp(-tt / 0.011) * (i < 8 ? i / 8 : 1); }
    fx.add(t, tail(x), g * 0.35, 0.15, 0.25);
  },
  /** Digital glitch: a stutter of short, bit-crushed buzz grains on a 32nd-note-ish grid, the first one on t. */
  glitch(fx, rand, t, g, spb) {
    const grain = Math.min(0.03, spb / 12);
    const reps = 5;
    const f = 180 + 400 * rand();
    const x = buf(grain * 2 * reps + 0.01);
    let held = 0;
    for (let r = 0; r < reps; r++) {
      const s0 = Math.round(r * 2 * grain * SR);
      const len = Math.round(grain * SR * (r === reps - 1 ? 1.8 : 1));
      const fr = f * (1 + 0.5 * (r % 3));
      for (let i = 0; i < len && s0 + i < x.length; i++) {
        if (i % (3 + r) === 0) held = Math.sign(Math.sin((TAU * fr * i) / SR)) * 0.7 + 0.3 * noise(rand); // sample-and-hold = crushed
        x[s0 + i] = held * (1 - i / len) ** 0.5 * (0.9 ** r);
      }
    }
    biquad(x, 'hp', 300, 0.7);
    fx.add(t, tail(x), g * 0.22, 0.3 * (rand() - 0.5), 0.15);
  },
  /** Counter reel tick. */
  tick(fx, rand, t, g) { fx.add(t, tick(rand, { f: 4200, decay: 0.006, edge: 0.5 }), g * 0.22, 0.2, 0.05); },
  /** Key click for the typed prompt. */
  click(fx, rand, t, g) {
    fx.add(t, tick(rand, { f: 1700 + 500 * rand(), decay: 0.004, edge: 0.9, q: 1.5 }), g * 0.2, 0.4 * (rand() - 0.5), 0.05);
    fx.add(t + 0.012, tick(rand, { f: 900, decay: 0.006, edge: 0.4 }), g * 0.08, 0, 0);
  },
};

/** Lay every cut over the music. Unknown kinds play as hits; cuts beyond the film are ignored. */
function layCuts(S, fx, cuts) {
  for (const c of Array.isArray(cuts) ? cuts : []) {
    if (!c) continue;
    const b = Number(c.beat);
    if (!Number.isFinite(b) || b < 0 || b >= S.total) continue;
    const fn = SFX[c.kind] || SFX.hit;
    fn(fx, S.rand, b * S.spb, clamp(Number(c.gain ?? 0.8), 0, 1.5), S.spb);
  }
}

// ---------------------------------------------------------------------------------------------
// Arrangement helpers
// ---------------------------------------------------------------------------------------------

/** Every 16th in [b0, b1): fn(beat, step 0..15 in the bar, bar). Bars count from the drop, so it is a downbeat. */
function sixteenths(S, b0, b1, fn) {
  const s0 = Math.ceil((b0 - S.drop) * 4 - 1e-6);
  const s1 = (b1 - S.drop) * 4 - 1e-6;
  for (let s = s0; s < s1; s++) fn(S.drop + s / 4, mod(s, 16), Math.floor(s / 16));
}
/** Each chord span [b0, b1) with its scale degree, clipped to [from, to). */
function chordSpans(S, from, to, fn) {
  const cb = S.chordBeats;
  for (let k = Math.floor((from - S.drop) / cb); S.drop + k * cb < to; k++) {
    const b0 = Math.max(from, S.drop + k * cb);
    const b1 = Math.min(to, S.drop + (k + 1) * cb);
    if (b1 > b0) fn(b0, b1, S.prog[mod(k, S.prog.length)]);
  }
}
/** MIDI note `d` scale steps above chord degree c, whose root is folded into [lo, lo + 12). */
function above(S, c, d, lo) {
  const root = fold(degree(S.key, c, 4), lo);
  return root + degree(S.key, c + d, 4) - degree(S.key, c, 4);
}

/**
 * A two-bar motif from seeded rhythm templates: [{ step 0..31, len in 16ths, deg }], where deg is in scale steps
 * above the chord root. The walk prefers chord tones and small steps; bar two answers bar one (same opening,
 * new ending), the way a hook repeats.
 */
function motif(rand, rhythms, { lo = -2, hi = 9, start = [0, 4, 7] } = {}) {
  const r1 = pick(rand, rhythms);
  const r2 = rand() < 0.6 ? r1 : pick(rand, rhythms);
  const steps = [];
  [r1, r2].forEach((p, bar) => { for (let i = 0; i < 16; i++) if (p[i] === 'x') steps.push(bar * 16 + i); });
  let d = pick(rand, start);
  const first = [];
  const out = steps.map((s, i) => {
    if (i > 0) d = pick(rand, [0, 2, 4, 7, d + 1, d - 1, d + 2, d - 2].filter((x) => x >= lo && x <= hi));
    if (r1 === r2 && s >= 16) {
      const j = first.length ? steps.indexOf(s - 16) : -1;
      const tailNote = steps.length - i <= 2;
      if (j >= 0 && !tailNote) d = first[j];
    }
    if (s < 16) first.push(d);
    return { step: s, len: (steps[i + 1] ?? 32) - s, deg: d };
  });
  out[out.length - 1].deg = pick(rand, [0, 4, 7]); // land the phrase on a chord tone
  return out;
}

/** Play a motif across [b0, b1), following the chord progression. play(beat, lenBeats, midi, vel). */
function playMotif(S, mo, b0, b1, lo, play, velAt = () => 1) {
  sixteenths(S, b0, b1, (b, step, bar) => {
    const s = step + 16 * mod(bar, 2);
    for (const n of mo) if (n.step === s) play(b, Math.min(n.len, 8) / 4, above(S, S.chordAt(b), n.deg, lo), velAt(b, step));
  });
}

/** Write a list of 808 hits [{ b, midi, glide }]: each holds until the next one (mono, like the real thing). */
function flush808(S, dr, hits, o) {
  hits.sort((a, b) => a.b - b.b);
  hits.forEach((h, i) => {
    const next = hits[i + 1];
    const beats = Math.min(next ? next.b - h.b : 2, h.max || 2.5);
    const prev = hits[i - 1];
    play808(dr, S.T(h.b), beats * S.spb, mtof(h.midi), { ...o, ...(h.o || {}), from: h.glide && prev ? mtof(prev.midi) : 0 });
  });
}

/**
 * The build's whole-bus filter, applied in JS to the rendered music and reverb send: high-passed and dark,
 * the low-pass opening over the last 8 beats, wide open from the drop. Time-varying RBJ biquads, coefficients
 * every 32 samples; the last 3 ms crossfade into the unfiltered signal so the drop does not click.
 */
function buildFilter(chs, S, { lp = [700, 9000], hp = 150 }) {
  if (S.drop <= 0) return;
  const n1 = Math.min(chs[0].length, Math.round(S.T(S.drop) * SR));
  const n0 = Math.round(S.T(Math.max(0, S.drop - 8)) * SR);
  const xf = Math.round(0.003 * SR);
  const coef = (type, f, q) => {
    const w = (TAU * Math.min(f, SR * 0.45)) / SR;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const a0 = 1 + al;
    const b1 = type === 'lp' ? (1 - cs) / a0 : -(1 + cs) / a0;
    return [Math.abs(b1) / 2, b1, Math.abs(b1) / 2, (-2 * cs) / a0, (1 - al) / a0];
  };
  const H = coef('hp', hp, 0.6);
  for (const x of chs) {
    let h1 = 0, h2 = 0, l1 = 0, l2 = 0; // eslint-disable-line one-var
    let C = coef('lp', lp[0], 0.9);
    for (let i = 0; i < n1; i++) {
      if ((i & 31) === 0 && i >= n0) C = coef('lp', lp[0] * (lp[1] / lp[0]) ** ((i - n0) / Math.max(1, n1 - n0)), 0.9);
      const v = x[i];
      const y = H[0] * v + h1; // transposed direct form II, high-pass then low-pass
      h1 = H[1] * v - H[3] * y + h2;
      h2 = H[2] * v - H[4] * y;
      const z = C[0] * y + l1;
      l1 = C[1] * y - C[3] * z + l2;
      l2 = C[2] * y - C[4] * z;
      const e = n1 - i;
      x[i] = e > xf ? z : z * (e / xf) + v * (1 - e / xf);
    }
  }
}

/** Into the drop: a noise riser and a reversed cymbal ending at the drop (or `gap` beats before it). */
function intoDrop(S, fx, { len = 8, gap = 0, level = 0.22, f1 = 7500 } = {}) {
  if (S.drop <= 0) return;
  const t1 = S.T(S.drop - gap);
  riser(fx, S.rand, S.T(Math.max(0, S.drop - Math.min(len, S.drop))), t1, { level, f1 });
  reverseCymbal(fx, S.rand, t1, Math.min(2 * S.spb, t1), level * 1.2);
}

/** The drop and the final hit: a sub boom on the exact sample, plus a crash. */
function impact(S, fx, b, { level = 0.75, crash = 0.3, f0 = 85, decay = 0.9 } = {}) {
  const t = S.T(b);
  fx.add(t, boom(S.rand, { f0, f1: 30, bend: 0.3, decay }), level, 0, 0.1);
  const [l, r] = cymbal(S.rand, 1.4, 3.5, 3800);
  fx.addStereo(t, l, r, crash, 0.3);
}

// ---------------------------------------------------------------------------------------------
// The five styles. make() builds the instruments and returns build / main / outro players. Before the drop
// nothing has a full kick or bass; from it everything plays; at the end one last hit rings out.
// ---------------------------------------------------------------------------------------------

const DEFS = {};

DEFS.phonk = {
  progs: { phrygian: [[0, 0, 1, 1], [0, 1, 0, 6], [0, 5, 1, 0]], minor: [[0, 5, 3, 4], [0, 0, 5, 6], [0, 3, 5, 4]] },
  chordBeats: 8,
  verb: { t60: 1.3, damp: 0.35, size: 0.8, ret: 0.3 },
  build: { lp: [650, 9000], hp: 160 },
  duck: [0.5, 0.4],
  make(S, m, dr) {
    const r = S.rand;
    const k = {
      kick: kick(r, { f0: 190, f1: 55, bend: 0.025, decay: 0.16, click: 0.45, drive: 3 }),
      snare: snare(r, { tone: 210, decay: 0.11, bright: 8000, body: 0.35 }),
      clap: clap(r, { decay: 0.12, f: 1500 }),
      hats: [metal(r, { decay: 0.028 }), metal(r, { decay: 0.022, tune: 1.05 }), metal(r, { decay: 0.034, tune: 0.97 })],
    };
    const hit = (x, b, g, pan = 0, send = 0) => dr.add(S.T(b), x, g, pan, send);
    // the cowbell: two square waves a ratio of 1.48 apart through a resonant band-pass, overdriven a little
    const bell = rr([-0.12, 0.12].map((pan) => new Synth(m, { type: 'square', ratios: [1, 1.4823], ftype: 'bandpass', cutoff: 1500, q: 2.6, drive: 1.8, level: 0.6, send: 0.2, pan })));
    const mo = motif(r, ['x..x..x.x..x..x.', 'x..x..x...x.x...', 'x.xx.x..x.xx.x..', 'x..x.x..x..x.xx.']);
    const kicks = pick(r, [[0, 8], [0, 8, 11], [0, 3, 8], [0, 7, 8, 11]]);
    const cow = (lvl) => (b, len, midi, vel) => { const f = mtof(midi); bell.note(S.T(b), len * S.spb * 0.9, midi, { vel: vel * lvl, a: 0.001, d: 0.32, s: 0, r: 0.05, cut: [f * 1.3, f * 1.25] }); };
    const pv = padVoice(m, 3, { cutoff: 900, send: 0.4 });
    const pads = (b0, b1, lvl) => chordSpans(S, b0, b1, (c0, c1, c) => pv.play(S.T(c0), S.T(c1), chordNotes(S.key, c, 3, 55), { level: lvl * 1.4, a: 0.6, r: 0.8 }));
    const hats = (b, step, bar, lvl) => {
      if (bar % 2 === 1 && step >= 14) { for (let j = 0; j < 2; j++) hit(k.hats[(j + 1) % 3], b + j / 8, lvl * (0.5 + 0.25 * j), 0.2); return; } // 32nd roll
      hit(k.hats[step % 3], b, lvl * [1, 0.4, 0.7, 0.45][step % 4], step % 2 ? 0.18 : -0.1);
    };
    return {
      build(b0, b1) {
        pads(b0, b1, 0.06);
        playMotif(S, mo, b0, b1, 72, cow(0.75));
        sixteenths(S, Math.max(b0, b1 - 8), b1 - 2, (b, step) => { if (step % 2 === 0) hit(k.hats[0], b, 0.12 * (step % 4 ? 0.6 : 1), 0.1); });
        sixteenths(S, Math.max(b0, b1 - 2), b1, (b) => hit(k.snare, b, 0.12 + 0.3 * ((b - b1 + 2) / 2), 0, 0.15)); // snare roll
      },
      main(b0, b1) {
        pads(b0, b1, 0.05);
        playMotif(S, mo, b0, b1, 72, cow(1));
        const bass = [];
        sixteenths(S, b0, b1, (b, step, bar) => {
          if (kicks.includes(step)) {
            hit(k.kick, b, step === 0 || step === 8 ? 0.95 : 0.7);
            S.kick(b);
            const last = step === kicks[kicks.length - 1] && bar % 2 === 1 && kicks.length > 2;
            bass.push({ b, midi: fold(degree(S.key, S.chordAt(b), 2), 29) + (last ? 12 : 0), glide: last });
          }
          if (step === 4 || step === 12) { hit(k.clap, b, 0.5, 0, 0.2); hit(k.snare, b, 0.35, 0, 0.1); }
          if (bar % 4 === 3 && step >= 13) hit(k.snare, b, 0.12 + 0.06 * (step - 13), 0, 0.1);
          hats(b, step, bar, 0.17);
          if (bar % 8 === 0 && step === 0 && b > S.drop) { const [l, rr2] = cymbal(r, 1.0, 2.5); dr.addStereo(S.T(b), l, rr2, 0.16, 0.2); }
        });
        flush808(S, dr, bass, { drive: 3.2, decay: 1.4, level: 0.5, lp: 2200, glide: 0.09 });
      },
      outro(b) {
        hit(k.kick, b, 0.95);
        hit(k.clap, b, 0.5, 0, 0.35);
        flush808(S, dr, [{ b, midi: fold(degree(S.key, 0, 2), 29), max: 4 }], { drive: 2.6, decay: 1.1, level: 0.5, lp: 2000 });
        cow(1)(b, 2, above(S, 0, 0, 72), 1);
        pv.play(S.T(b), S.T(b + 2), chordNotes(S.key, 0, 3, 55), { level: 0.13, a: 0.02, r: 2.2, cut: 1200 });
      },
    };
  },
};

DEFS.drive = {
  progs: { minor: [[0, 5, 2, 6], [0, 6, 5, 6], [0, 3, 5, 6], [5, 6, 0, 0]], dorian: [[0, 3, 0, 3], [0, 6, 3, 0], [0, 4, 3, 6]] },
  chordBeats: 4,
  verb: { t60: 2.4, damp: 0.25, size: 1.1, ret: 0.35 },
  build: { lp: [520, 7500], hp: 150 },
  duck: [0.55, 0.45],
  make(S, m, dr) {
    const r = S.rand;
    const k = {
      kick: kick(r, { f0: 140, f1: 50, bend: 0.04, decay: 0.26, click: 0.25, drive: 1.6 }),
      snare: snare(r, { tone: 180, decay: 0.12, bright: 7000, body: 0.6 }),
      gate: gatedTail(r, { hold: 0.18 }),
      hat: metal(r, { decay: 0.035, tune: 0.94, hp: 8000 }),
      toms: [[300, 220], [240, 175], [190, 138], [150, 108]].map(([f0, f1]) => membrane(r, { f0, f1, bend: 0.04, decay: 0.2, body: 0.25, slap: 0.3 })),
    };
    const hit = (x, b, g, pan = 0, send = 0) => dr.add(S.T(b), x, g, pan, send);
    const gsnare = (b, g) => { hit(k.snare, b, g, 0, 0.1); dr.addStereo(S.T(b), k.gate[0], k.gate[1], g * 0.55, 0.05); };
    const echo = pingpong(m, 0.75 * S.spb, 0.38, 0.5);
    const arp = new Synth(m, { type: 'square', detune: [-5, 5], width: 0.3, cutoff: 1800, q: 2, level: 0.15, send: 0.15, fx: echo });
    const bass = new Synth(m, { type: 'sawtooth', detune: [-4, 4], cutoff: 400, q: 1.6, level: 0.3 });
    const order = pick(r, [[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 5], [0, 1, 2, 0, 1, 2, 3, 4], [0, 2, 4, 2, 1, 3, 5, 3]]);
    const octs = pick(r, [[0, 0, 0, 0, 0, 0, 0, 0], [0, 12, 0, 12, 0, 12, 0, 12], [0, 0, 12, 0, 0, 12, 0, 12]]);
    const kicks = pick(r, [[0, 8], [0, 8, 11], [0, 4, 8, 12], [0, 7, 8]]);
    const arpAt = (b, step, vel, c = S.chordAt(b)) => {
      const tones = chordNotes(S.key, c, 3, 62);
      const idx = order[step % 8];
      const midi = tones[idx % 3] + 12 * Math.floor(idx / 3);
      arp.note(S.T(b), S.spb * 0.22, midi, { vel, a: 0.002, d: 0.11, s: 0.25, r: 0.04, cut: [3600, 1300] });
    };
    const pv = padVoice(m, 3, { cutoff: 2400, detune: 12, send: 0.45 });
    const pads = (b0, b1, lvl) => chordSpans(S, b0, b1, (c0, c1, c) => pv.play(S.T(c0), S.T(c1), chordNotes(S.key, c, 3, 57), { level: lvl * 1.4, a: 0.25, r: 0.6 }));
    const fill = (b, lvl) => k.toms.forEach((x, j) => hit(x, b + j / 4, lvl * (0.8 + 0.1 * j), 0.5 - j * 0.33, 0.2));
    return {
      build(b0, b1) {
        pads(b0, b1, 0.07);
        sixteenths(S, b0, b1, (b, step) => arpAt(b, step, 0.7));
        sixteenths(S, Math.max(b0, b1 - 4), b1 - 1, (b, step) => { if (step % 8 === 4) gsnare(b, 0.3); });
        if (b1 - b0 >= 1) fill(b1 - 1, 0.35);
      },
      main(b0, b1) {
        pads(b0, b1, 0.06);
        sixteenths(S, b0, b1, (b, step, bar) => {
          arpAt(b, step, step % 4 === 0 ? 1 : 0.8);
          if (step % 2 === 0) {
            const root = fold(degree(S.key, S.chordAt(b), 2), 33);
            bass.note(S.T(b), S.spb * 0.42, root + octs[(step / 2) % 8], { vel: step % 4 ? 0.8 : 1, a: 0.003, d: 0.14, s: 0.5, r: 0.04, cut: [1100, 380] });
          }
          if (kicks.includes(step)) { hit(k.kick, b, 0.9); S.kick(b); }
          if (step === 4 || step === 12) gsnare(b, 0.5);
          if (step % 2 === 0 || bar % 8 >= 4) hit(k.hat, b, (step % 2 ? 0.07 : 0.13), 0.25, 0.05);
          if (bar % 4 === 3 && step === 12 && b + 1 <= b1) fill(b, 0.45);
          if (bar % 8 === 0 && step === 0 && b > S.drop) { const [l, rr2] = cymbal(r, 1.3, 3); dr.addStereo(S.T(b), l, rr2, 0.14, 0.25); }
        });
      },
      outro(b) {
        hit(k.kick, b, 0.9);
        gsnare(b, 0.55);
        const c = 0;
        bass.note(S.T(b), S.spb * 3, fold(degree(S.key, c, 2), 33), { vel: 1, a: 0.003, d: 0.6, s: 0.6, r: 1.2, cut: [1200, 300], fd: 1.5 });
        arpAt(b, 0, 1, c);
        pv.play(S.T(b), S.T(b + 2), chordNotes(S.key, c, 3, 57), { level: 0.15, a: 0.02, r: 2.6, cut: 2600 });
      },
    };
  },
};

DEFS.trailer = {
  progs: { minor: [[0, 5, 3, 4], [0, 5, 2, 6], [0, 0, 5, 5], [0, 3, 5, 6]], harmonic: [[0, 5, 3, 4], [0, 3, 4, 4], [0, 5, 0, 4]] },
  chordBeats: 8,
  verb: { t60: 3.4, damp: 0.3, size: 1.4, ret: 0.4 },
  build: { lp: [1500, 9000], hp: 130 },
  duck: [0.7, 0.5],
  gap: 0.5, // half a beat of silence before the drop
  make(S, m, dr, fx) {
    const r = S.rand;
    const k = {
      lo: membrane(r, { f0: 120, f1: 58, bend: 0.05, decay: 0.45, body: 0.5, bodyF: 400, slap: 0.35, slapF: 1500, drive: 1.6 }),
      hi: membrane(r, { f0: 260, f1: 165, bend: 0.03, decay: 0.2, body: 0.4, bodyF: 900, slap: 0.5, slapF: 2500 }),
      clock: tick(r, { f: 2600, decay: 0.01, edge: 0.4 }),
    };
    const hit = (x, b, g, pan = 0, send = 0) => dr.add(S.T(b), x, g, pan, send);
    // spiccato strings: detuned saws with a fast filter envelope, a low section and a high one
    const strings = [-0.3, 0.3].map((pan, j) => new Synth(m, { type: 'sawtooth', detune: [-7, 7], pan, cutoff: 2600, q: 0.6, level: j ? 0.12 : 0.17, send: 0.35 }));
    const pat = pick(r, [[0, 0, 4, 0, 0, 4, 0, 7], [0, 4, 7, 4, 0, 4, 7, 4], [0, 0, 0, 2, 0, 0, 4, 2], [0, 7, 4, 7, 0, 7, 4, 7]]);
    const extra = pick(r, [[13, 15], [7, 15], [11, 13, 15], [3, 11]]);
    const ost = (b, step, v, lo, vel) => strings[v].note(S.T(b), S.spb * 0.2, above(S, S.chordAt(b), pat[step % 8], lo), { vel, a: 0.006, d: 0.09, s: 0.25, r: 0.06, cut: [3400, 1700] });
    const pv = padVoice(m, 3, { cutoff: 1300, detune: 8, send: 0.6 });
    const bv = braamVoice(m);
    const strPad = (c0, c1, c, lvl, rel) => pv.play(S.T(c0), S.T(c1), chordNotes(S.key, c, 3, 52), { level: lvl * 1.4, a: 1.2, r: rel });
    const big = (b, dur, lvl, rel) => { const root = fold(degree(S.key, b >= S.end ? 0 : S.chordAt(b), 2), 36); bv.play(S.T(b), dur, [root, root + 7, root + 12], { level: lvl, r: rel }); };
    return {
      build(b0, b1) {
        const stop = b1 - DEFS.trailer.gap;
        chordSpans(S, b0, stop, (c0, c1, c) => strPad(c0, c1, c, 0.08, c1 >= stop - 1e-6 ? 0.2 : 0.9));
        sixteenths(S, b0, stop, (b, step, bar) => {
          if (b >= b1 - 4 || step % 2 === 0) ost(b, step, 0, 48, 0.3 + (0.6 * (b - b0)) / Math.max(1, b1 - b0));
          if (step % 4 === 0) hit(k.clock, b, 0.12, 0.3, 0.1);
          if (step === 0 && mod(bar, 2) === 0 && b < b1 - 4) hit(k.hi, b, 0.3, -0.2, 0.45);
        });
      },
      main(b0, b1) {
        chordSpans(S, b0, b1, (c0, c1, c) => { big(c0, (c1 - c0) * S.spb - 0.05, 0.3, 1.2); strPad(c0, c1, c, 0.06, 1); });
        const bars = (b1 - b0) / 4;
        sixteenths(S, b0, b1, (b, step, bar) => {
          ost(b, step, 0, 48, step % 4 === 0 ? 1 : 0.75);
          if ((bar >= 4 || bars <= 4) && step % 2 === 0) ost(b, step, 1, 60, 0.7);
          if (step === 0 || step === 8) { hit(k.lo, b, 0.95, 0, 0.3); S.kick(b); }
          if (step === 4 || step === 12) hit(k.hi, b, 0.6, -0.15, 0.35);
          if (extra.includes(step)) hit(k.hi, b, 0.3, 0.2, 0.35);
          if (step % 2 === 0) hit(k.clock, b, step % 4 ? 0.05 : 0.09, 0.3, 0.1);
          if (bar % 4 === 0 && step === 0 && b > S.drop) impact(S, fx, b, { level: 0.35, crash: 0.16, decay: 0.6 });
        });
      },
      outro(b) {
        big(b, S.spb * 2.5, 0.34, 2.8);
        hit(k.lo, b, 1, 0, 0.5);
        pv.play(S.T(b), S.T(b + 3), chordNotes(S.key, 0, 3, 52), { level: 0.14, a: 0.05, r: 3, cut: 2000 });
      },
    };
  },
};

DEFS.trap = {
  progs: { minor: [[0, 5, 3, 4], [0, 0, 5, 6], [0, 3, 5, 4], [0, 6, 5, 6]], harmonic: [[0, 5, 3, 4], [0, 3, 4, 0], [0, 5, 4, 4]] },
  chordBeats: 8,
  verb: { t60: 1.8, damp: 0.3, size: 1, ret: 0.3 },
  build: { lp: [900, 8000], hp: 170 },
  duck: [0.6, 0.35],
  make(S, m, dr) {
    const r = S.rand;
    const k = {
      kick: kick(r, { f0: 210, f1: 58, bend: 0.022, decay: 0.12, click: 0.5, drive: 2.4 }),
      snare: snare(r, { tone: 220, decay: 0.13, bright: 9000, body: 0.3, hp: 1500 }),
      clap: clap(r, { decay: 0.17, f: 1350 }),
      hats: [metal(r, { decay: 0.02, tune: 1.12, hp: 8500 }), metal(r, { decay: 0.018, tune: 1.2, hp: 9000 })],
    };
    const hit = (x, b, g, pan = 0, send = 0) => dr.add(S.T(b), x, g, pan, send);
    const bells = rr([new Bell(m, { pan: -0.2, level: 0.2 }), new Bell(m, { pan: 0.2, level: 0.2 })]);
    const mo = motif(r, ['x..x..x.x.......', 'x...x.x...x.x...', 'x..x...x..x.x...', 'x.x...x..x..x...']);
    const kicks = pick(r, [[0], [0, 11], [0, 7, 11], [0, 3, 11]]);
    const moves = kicks.map((s) => (s === 0 ? 0 : pick(r, [0, 0, 4, 7, -1]))); // 808 steps above the root, per kick
    const rolls = [pick(r, ['16', '32', 'trip', '8']), pick(r, ['16', '32', 'trip'])];
    const pv = padVoice(m, 3, { type: 'triangle', cutoff: 1400, send: 0.4 });
    const pads = (b0, b1, lvl) => chordSpans(S, b0, b1, (c0, c1, c) => pv.play(S.T(c0), S.T(c1), chordNotes(S.key, c, 3, 55), { level: lvl * 1.4, a: 0.5, r: 1 }));
    const bell = (lvl) => (b, len, midi, vel) => bells.note(S.T(b), len * S.spb, midi, vel * lvl);
    const hats = (b, step, bar, lvl) => {
      const kind = bar % 2 === 1 && step >= 12 ? rolls[mod(bar, 4) === 3 ? 1 : 0] : '8';
      if (kind === 'trip') { if (step === 12) for (let j = 0; j < 6; j++) hit(k.hats[j % 2], b + j / 6, lvl * (0.45 + 0.1 * j), 0.15); return; }
      if (kind === '32') { for (let j = 0; j < 2; j++) hit(k.hats[j], b + j / 8, lvl * (0.5 + 0.15 * (step - 12)), 0.15); return; }
      if (kind === '16') { hit(k.hats[step % 2], b, lvl * (0.55 + 0.12 * (step - 12)), 0.15); return; }
      if (step % 2 === 0) hit(k.hats[0], b, lvl * (step % 4 ? 0.55 : 1), 0.15);
    };
    return {
      build(b0, b1) {
        pads(b0, b1, 0.1);
        playMotif(S, mo, b0, b1, 72, bell(0.8));
        sixteenths(S, Math.max(b0, b1 - 8), b1 - 1, (b, step) => { if (step % 4 === 0) hit(k.hats[0], b, 0.12, 0.15); });
        if (b1 - b0 >= 1) for (let j = 0; j < 8; j++) hit(k.hats[j % 2], b1 - 1 + j / 8, 0.07 + 0.02 * j, 0.15); // the roll into the drop
      },
      main(b0, b1) {
        pads(b0, b1, 0.08);
        playMotif(S, mo, b0, b1, 72, bell(1));
        const bass = [];
        let prev = 0;
        sixteenths(S, b0, b1, (b, step, bar) => {
          const ki = kicks.indexOf(step);
          if (ki >= 0) {
            hit(k.kick, b, step === 0 ? 0.9 : 0.7);
            S.kick(b);
            bass.push({ b, midi: above(S, S.chordAt(b), moves[ki], 29), glide: moves[ki] !== prev });
            prev = moves[ki];
          }
          if (step === 8) { hit(k.clap, b, 0.55, 0, 0.25); hit(k.snare, b, 0.35, 0, 0.1); }
          if (step === 15 && bar % 2) hit(k.snare, b, 0.12, 0, 0.05);
          hats(b, step, bar, 0.2);
          if (bar % 8 === 0 && step === 0 && b > S.drop) { const [l, rr2] = cymbal(r, 1.1, 2.6); dr.addStereo(S.T(b), l, rr2, 0.15, 0.2); }
        });
        flush808(S, dr, bass, { drive: 1.6, decay: 2.2, level: 0.62, glide: 0.1 });
      },
      outro(b) {
        hit(k.kick, b, 0.9);
        hit(k.clap, b, 0.55, 0, 0.4);
        flush808(S, dr, [{ b, midi: above(S, 0, 0, 29), max: 5 }], { drive: 1.5, decay: 1.3, level: 0.62 });
        bell(1)(b, 3, above(S, 0, 7, 72), 1);
        pv.play(S.T(b), S.T(b + 2), chordNotes(S.key, 0, 3, 55), { level: 0.2, a: 0.02, r: 2.5, cut: 1800 });
      },
    };
  },
};

DEFS.house = {
  progs: { dorian: [[0, 3, 0, 3], [0, 4, 3, 3], [0, 6, 3, 4]], minor: [[0, 5, 3, 4], [0, 3, 6, 5], [5, 6, 0, 0]] },
  chordBeats: 4,
  verb: { t60: 1.5, damp: 0.35, size: 0.9, ret: 0.3 },
  build: { lp: [380, 9000], hp: 180 },
  duck: [0.4, 0.5],
  make(S, m, dr) {
    const r = S.rand;
    const k = {
      kick: kick(r, { f0: 125, f1: 48, bend: 0.04, decay: 0.24, click: 0.3, drive: 1.8 }),
      clap: clap(r, { decay: 0.18, f: 1150 }),
      open: metal(r, { decay: 0.07, tune: 1, hp: 7500 }),
      shake: shaker(r, { decay: 0.025 }),
      rim: tick(r, { f: 900, decay: 0.02, edge: 0.7, q: 1.5 }),
    };
    const hit = (x, b, g, pan = 0, send = 0) => dr.add(S.T(b), x, g, pan, send);
    const echo = pingpong(m, 0.75 * S.spb, 0.3, 0.35, 2800);
    const stab = new Synth(m, { type: 'sawtooth', poly: 4, detune: [-6, 6], width: 0.4, cutoff: 900, q: 1.8, level: 0.3, send: 0.25, fx: echo });
    const bass = new Synth(m, { type: 'sawtooth', cutoff: 320, q: 3, level: 0.26 });
    const sub = new Synth(m, { type: 'sine', cutoff: 3000, level: 0.34 });
    const pv = padVoice(m, 4, { cutoff: 2600, send: 0.5 });
    const stabRh = pick(r, ['..x...x...x...x.', '...x..x....x..x.', 'x..x..x...x..x..', '..x..x....x..x..']);
    const bassRh = pick(r, ['..x...x...x...x.', '..x..x.x..x..x.x', 'x..x..x...x.x..x', '..xx..x...xx..x.']);
    const bassMoves = pick(r, [[0, 0, 0, 0, 0, 0], [0, 7, 0, 0, 7, 0], [0, 0, 7, 0, 4, 0]]);
    const rims = pick(r, [[3, 11], [7, 13], [6, 15], [10]]);
    const stabAt = (b, vel) => stab.note(S.T(b), 0.16, chordNotes(S.key, S.chordAt(b), 4, 55), { vel, a: 0.002, d: 0.16, s: 0, r: 0.06, cut: [4200, 700], fd: 0.12 });
    const bassAt = (b, midi, dur, vel = 1) => {
      bass.note(S.T(b), dur, midi, { vel, a: 0.004, d: 0.12, s: 0.6, r: 0.04, cut: [900, 320] });
      sub.note(S.T(b), dur, midi, { vel, a: 0.004, d: 0.2, s: 0.7, r: 0.04 });
    };
    return {
      build(b0, b1) {
        sixteenths(S, b0, b1, (b, step) => { if (stabRh[step] === 'x') stabAt(b, 0.8); });
        sixteenths(S, Math.max(b0, b1 - 8), b1, (b, step) => {
          if (step % 4 === 2) hit(k.open, b, 0.12, 0.2, 0.05);
          if (b < b1 - 4 && (step === 4 || step === 12)) hit(k.clap, b, 0.3, 0, 0.3);
        });
        sixteenths(S, Math.max(b0, b1 - 4), b1, (b, step) => { if (b >= b1 - 2 || step % 2 === 0) hit(k.clap, b, 0.15 + 0.3 * (1 - (b1 - b) / 4), 0, 0.25); });
      },
      main(b0, b1) {
        let n = 0;
        sixteenths(S, b0, b1, (b, step, bar) => {
          if (step % 4 === 0) { hit(k.kick, b, 0.95); S.kick(b); }
          if (step === 4 || step === 12) hit(k.clap, b, 0.45, 0, 0.3);
          if (step % 4 === 2) hit(k.open, b, 0.16, 0.2, 0.05);
          hit(k.shake, b, step % 2 ? 0.07 : 0.045, -0.25);
          if (rims.includes(step)) hit(k.rim, b, 0.12, -0.35, 0.2);
          if (stabRh[step] === 'x') stabAt(b, 1);
          if (bassRh[step] === 'x') bassAt(b, above(S, S.chordAt(b), bassMoves[n++ % bassMoves.length], 33), S.spb * 0.4);
          if (bar % 8 === 0 && step === 0 && b > S.drop) { const [l, rr2] = cymbal(r, 1.2, 2.8); dr.addStereo(S.T(b), l, rr2, 0.13, 0.2); }
        });
        // a soft pad lifts the second half of long films
        if (b1 - b0 >= 32) chordSpans(S, b0 + 16, b1, (c0, c1, c) => pv.play(S.T(c0), S.T(c1), chordNotes(S.key, c, 4, 60), { level: 0.07, a: 0.5, r: 0.8 }));
      },
      outro(b) {
        hit(k.kick, b, 0.95);
        hit(k.clap, b, 0.5, 0, 0.45);
        stab.note(S.T(b), 0.16, chordNotes(S.key, 0, 4, 55), { vel: 1, a: 0.002, d: 0.16, s: 0, r: 0.06, cut: [4200, 700], fd: 0.12 });
        bassAt(b, above(S, 0, 0, 33), S.spb * 2.5);
        pv.play(S.T(b), S.T(b + 2), chordNotes(S.key, 0, 4, 55), { level: 0.17, a: 0.02, r: 2.6, cut: 2400 });
      },
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Mastering
// ---------------------------------------------------------------------------------------------

/** Integrated loudness in LUFS (ITU-R BS.1770 / EBU R128): K-weighting, 400 ms blocks at 75% overlap, both gates. */
function loudness(L, R) {
  // the standard 48 kHz K-weighting: a +4 dB high shelf, then a 38 Hz high-pass ([b0, b1, b2, a1, a2])
  const K = [[1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585], [1, -2, 1, -1.99004745483398, 0.99007225036621]];
  const hop = Math.round(0.1 * SR);
  const hops = Math.floor(L.length / hop);
  const pw = new Float64Array(hops);
  const [p, q] = K;
  for (const x of [L, R]) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    let o1 = 0;
    let o2 = 0;
    for (let i = 0; i < hops * hop; i++) {
      const v = x[i];
      const y = p[0] * v + p[1] * x1 + p[2] * x2 - p[3] * y1 - p[4] * y2;
      const o = q[0] * y + q[1] * y1 + q[2] * y2 - q[3] * o1 - q[4] * o2;
      x2 = x1; x1 = v; y2 = y1; y1 = y; o2 = o1; o1 = o;
      pw[(i / hop) | 0] += o * o;
    }
  }
  const lk = (p) => -0.691 + 10 * Math.log10(p + 1e-20);
  const blocks = [];
  for (let j = 0; j + 4 <= hops; j++) blocks.push((pw[j] + pw[j + 1] + pw[j + 2] + pw[j + 3]) / (4 * hop));
  if (!blocks.length) return -70;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const abs = blocks.filter((p) => lk(p) > -70);
  if (!abs.length) return -70;
  const rel = lk(mean(abs)) - 10;
  return lk(mean(abs.filter((p) => lk(p) > rel)));
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

/** The largest of |x[i]| and the Catmull-Rom curve between x[i] and x[i+1] at 1/4, 1/2, 3/4: a true-peak estimate. */
function peakAt(x, i, n) {
  const a = x[i > 0 ? i - 1 : i];
  const b = x[i];
  const c = x[i + 1 < n ? i + 1 : i];
  const d = x[i + 2 < n ? i + 2 : i];
  const c1 = 0.5 * (c - a);
  const c2 = a - 2.5 * b + 2 * c - 0.5 * d;
  const c3 = 0.5 * (d - a) + 1.5 * (b - c);
  let p = b < 0 ? -b : b;
  let v = b + 0.25 * (c1 + 0.25 * (c2 + 0.25 * c3));
  if (v < 0) v = -v;
  if (v > p) p = v;
  v = b + 0.5 * (c1 + 0.5 * (c2 + 0.5 * c3));
  if (v < 0) v = -v;
  if (v > p) p = v;
  v = b + 0.75 * (c1 + 0.75 * (c2 + 0.75 * c3));
  if (v < 0) v = -v;
  return v > p ? v : p;
}

/**
 * Apply gain g (lowered if it would need more than MAX_GR dB of limiting), then a stereo-linked look-ahead
 * limiter (3 ms ramp down ahead of each peak, ~90 ms release) holding the interpolated peak under CEILING,
 * then the fades. Returns the deepest gain reduction in dB.
 */
function finish(L, R, g) {
  const n = L.length;
  const need = new Float32Array(n);
  let top = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.max(peakAt(L, i, n), peakAt(R, i, n));
    need[i] = p;
    if (p > top) top = p;
  }
  // a film that is mostly quiet with one huge hit would need crushing to reach the target: settle for quieter
  if (top > 0) g = Math.min(g, (CEILING * db(MAX_GR)) / top);
  for (let i = 0; i < n; i++) { const p = need[i] * g; need[i] = p > CEILING ? CEILING / p : 1; }
  const look = Math.round(0.003 * SR);
  const lim = slidingMin(need, look);
  const rel = 1 - Math.exp(-1 / (0.09 * SR));
  const fin = Math.max(1, Math.min(Math.round(FADE_IN * SR), n >> 2));
  const fout = Math.max(1, Math.min(Math.round(FADE_OUT * SR), n >> 1));
  // the average of the sliding minimum over the look-ahead window is a ramp that is already down at the peak
  let box = look + 1;
  let gain = 1;
  let low = 1;
  for (let i = 0; i < n; i++) {
    box += lim[i] - (i > look ? lim[i - look - 1] : 1);
    gain = Math.min(box / (look + 1), gain + (1 - gain) * rel);
    if (gain < low) low = gain;
    let v = g * gain;
    if (i < fin) v *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fin);
    const e = n - 1 - i;
    if (e < fout) v *= 0.5 - 0.5 * Math.cos((Math.PI * e) / fout);
    L[i] = clamp(L[i] * v, -0.89, 0.89);
    R[i] = clamp(R[i] * v, -0.89, 0.89);
  }
  return 20 * Math.log10(low);
}

/** Ping-pong echo of the mono send x into L/R: darkened by a one-pole low-pass, then every `time` s, alternating sides. */
function echo(x, L, R, { time, fb, wet, lp }) {
  const n = x.length;
  const d = Math.max(1, Math.round(time * SR));
  const a = 1 - Math.exp((-TAU * lp) / SR);
  const eL = new Float32Array(n);
  const eR = new Float32Array(n);
  let z = 0;
  for (let i = 0; i < n; i++) {
    z += (x[i] - z) * a;
    x[i] = z;
    if (i >= d) { eL[i] = x[i - d] + fb * eR[i - d]; eR[i] = fb * eL[i - d]; }
    L[i] += wet * eL[i];
    R[i] += wet * eR[i];
  }
}

/**
 * Sum the parts: drums + cuts + duck * (music + reverb). The echo is music (so it is filtered in the build);
 * the reverb input is the rendered send bus plus the JS layers' send; the duck curve dips the music and its
 * reverb under every kick after the drop. Returns [L, R], written into the drum layer's arrays.
 */
function mixDown(out, dr, fx, kicks, D, S, m) {
  const n = out.length;
  const mL = out.getChannelData(0);
  const mR = out.getChannelData(1);
  const sL = out.getChannelData(2);
  const sR = out.getChannelData(3);
  if (m.echo) echo(out.getChannelData(4), mL, mR, m.echo);
  buildFilter([mL, mR, sL, sR], S, D.build);
  for (let i = 0; i < n; i++) { sL[i] += dr.W[i]; sR[i] += dr.W[i]; }
  const [wL, wR] = fdnReverb(sL, sR, n, D.verb);
  const duck = kicks.length ? duckCurve(n, kicks, D.duck[0], D.duck[1] * S.spb) : null;
  const ret = D.verb.ret ?? 0.35;
  const L = dr.L;
  const R = dr.R;
  for (let i = 0; i < n; i++) {
    const g = duck ? duck[i] : 1;
    L[i] += fx.L[i] + g * (mL[i] + ret * wL[i]);
    R[i] += fx.R[i] + g * (mR[i] + ret * wR[i]);
  }
  return [L, R];
}

// ---------------------------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------------------------

/**
 * Render the score for a film, in an OfflineAudioContext at 48 kHz stereo.
 *
 * Before dropBeat it builds (filtered, sparse, risers, no kick or bass); dropBeat hits with a sub boom on the
 * exact sample and the full groove; endBeat lands a final hit that rings out under the logo. Every cut is a
 * synthesized sound whose transient (a whoosh's peak) falls on beat * 60 / bpm.
 *
 * @param {object} o
 * @param {string} o.style one of the STYLES ids (unknown ids play as phonk)
 * @param {number} o.bpm tempo in beats per minute
 * @param {number} o.beats beats in the film; the score lasts beats * 60 / bpm + 1.2 s, exactly like the film
 * @param {number} o.dropBeat beat where the build ends and the drop hits
 * @param {number} o.endBeat beat where the final logo block starts
 * @param {{ beat: number, kind: string, gain?: number }[]} [o.cuts] the edit's sounds; kind is whoosh, boom, hit, snap, glitch, tick or click
 * @param {number} [o.seed] integer; the same inputs and seed always give identical samples
 * @returns {Promise<{ sampleRate: number, channels: Float32Array[], duration: number, info: object }>}
 *   channels are [left, right]; info describes the key, chords and loudness (for display and tests)
 */
export async function renderScore({ style = 'phonk', bpm, beats = 0, dropBeat = 0, endBeat, cuts = [], seed = 1 } = {}) {
  const id = DEFS[style] ? style : 'phonk';
  const D = DEFS[id];
  bpm = clamp(Number(bpm) || STYLES.find((s) => s.id === id).bpm, 40, 240);
  beats = Math.max(0, Number(beats) || 0);
  const spb = 60 / bpm;
  const duration = beats * spb + 1.2;
  const length = Math.max(1, Math.round(duration * SR));
  const end = clamp(Number.isFinite(Number(endBeat)) && endBeat !== null ? Number(endBeat) : beats, 0, beats);
  const drop = clamp(Number(dropBeat) || 0, 0, end);
  const rand = rng((Number(seed) >>> 0) ^ hashStr(id));
  CYMBALS = new Map();
  const scaleName = pick(rand, Object.keys(D.progs));
  const key = { root: Math.floor(rand() * 12) % 12, scale: SCALES[scaleName] };
  const S = { bpm, spb, beats, drop, end, dur: duration, total: duration / spb, rand, key, prog: pick(rand, D.progs[scaleName]), chordBeats: D.chordBeats, T: (b) => b * spb };
  S.chordAt = (b) => S.prog[mod(Math.floor((b - drop) / S.chordBeats + 1e-9), S.prog.length)];

  const t0 = performance.now();
  const ctx = new OfflineAudioContext({ numberOfChannels: 5, length, sampleRate: SR });
  const m = makeMix(ctx);
  const kicks = [];
  S.kick = (b) => kicks.push(S.T(b));
  // drums and cuts are written in JS: stereo layers plus one mono reverb send they share
  const W = new Float32Array(length);
  const dr = new Layer(new Float32Array(length), new Float32Array(length), W);
  const fx = new Layer(new Float32Array(length), new Float32Array(length), W);

  const P = D.make(S, m, dr, fx);
  if (drop > 0) { P.build(0, drop); intoDrop(S, fx, { gap: D.gap || 0 }); }
  if (end > drop) { P.main(drop, end); impact(S, fx, drop); }
  P.outro(end);
  impact(S, fx, end, end > drop ? { level: 0.6, crash: 0.26 } : {});
  layCuts(S, fx, cuts);
  m.close();

  const t1 = performance.now();
  const out = await ctx.startRendering();
  const t2 = performance.now();
  const [L, R] = mixDown(out, dr, fx, kicks, D, S, m);
  const t3 = performance.now();
  const before = loudness(L, R);
  const gr = finish(L, R, db(clamp(TARGET_LUFS - before, -30, 40)));
  const ms = { js: Math.round(t1 - t0), webaudio: Math.round(t2 - t1), mix: Math.round(t3 - t2), master: Math.round(performance.now() - t3) };
  return {
    sampleRate: SR,
    channels: [L, R],
    duration,
    info: { style: id, bpm, key: `${NOTE_NAMES[key.root]} ${scaleName}`, chords: S.prog.slice(), lufs: Math.round(loudness(L, R) * 10) / 10, limiterDb: Math.round(gr * 10) / 10, ms },
  };
}
