// The mix's back room: listens to each stem, keeps the buses, balances them and masters the result,
// so the page stays smooth while the console renders. Nothing leaves the device.
// Messages are answered { id, ok, ... }; arrays travel as transferables.

import { analyzeStem, sumEnvelopes, tempo, ENV_RATE } from './analyze.js';
import { planStrip, faderGain, busBalance, toneMatch, vocalDuck } from './plan.js';
import { GENRES } from './rules.js';
import { LoudnessMeter } from '../loudness.js';
import { octaveSpectrum, preChain, master, limit, measureOutput } from '../master.js';
import { analyzeBands, estimateBeat } from '../lyrics-engine.js';

const S = { rate: 44100, feats: [], rough: null, length: 0, buses: null };
const BUS = ['drums', 'inst', 'vox', 'voxVerb', 'beatVerb'];
const dbToGain = (d) => 10 ** (d / 20);
const TAIL = (rate) => Math.round(rate * 2.5); // room for reverb and delay tails after the last note

function loudness(chs, rate) {
  const m = new LoudnessMeter(rate, chs.length, chs[0].length);
  m.push(chs, chs[0].length);
  const v = m.integrated();
  return Number.isFinite(v) ? v : -120;
}
function grow(arr, n) { if (arr && arr.length >= n) return arr; const out = new Float32Array(n); if (arr) out.set(arr); return out; }
function addInto(target, src, gain) { const n = Math.min(target.length, src.length); for (let i = 0; i < n; i++) target[i] += src[i] * gain; }
function peaks(chs, bins = 600) {
  const n = chs[0].length, out = new Float32Array(bins), step = n / bins;
  for (let b = 0; b < bins; b++) {
    let m = 0;
    for (let i = Math.floor(b * step), e = Math.min(n, Math.floor((b + 1) * step)); i < e; i += 4) for (const c of chs) { const a = c[i] < 0 ? -c[i] : c[i]; if (a > m) m = a; }
    out[b] = m;
  }
  return out;
}

/** Soft clip in place: samples above the knee (db below the peak) bend smoothly toward the peak. */
function softClip(chs, db) {
  let peak = 0; for (const c of chs) for (let i = 0; i < c.length; i++) { const a = c[i] < 0 ? -c[i] : c[i]; if (a > peak) peak = a; }
  if (!peak) return;
  const knee = peak * 10 ** (-db / 20), room = peak - knee;
  for (const c of chs) for (let i = 0; i < c.length; i++) {
    const x = c[i], a = x < 0 ? -x : x;
    if (a > knee) c[i] = Math.sign(x) * (knee + room * Math.tanh((a - knee) / room) * 0.62);
  }
}

const H = {
  reset({ rate }) { S.rate = rate; S.feats = []; S.rough = null; S.length = 0; S.buses = null; return {}; },

  // Pass 1: listen to one stem and add it to the plain sum used for tempo and the "before" comparison.
  analyze({ index, channels }) {
    const chs = channels.slice(0, 2), n = chs[0].length;
    S.length = Math.max(S.length, n);
    S.rough = S.rough || [new Float32Array(n), new Float32Array(n)];
    S.rough = S.rough.map((r) => grow(r, n));
    addInto(S.rough[0], chs[0], 1); addInto(S.rough[1], chs[1] || chs[0], 1);
    const f = analyzeStem(chs, S.rate);
    S.feats[index] = f;
    const lite = { duration: f.duration, lufs: f.lufs, isMono: f.isMono, width: f.width, crestDb: f.crestDb, onsetsPerSec: f.onsetsPerSec, centroid: f.centroid, activeRatio: f.activeRatio, activeSeconds: f.activeSeconds, subShare: f.subShare, lowShare: f.lowShare, mudShare: f.mudShare, midShare: f.midShare, highShare: f.highShare, spectrum: f.spectrum, start: f.start, end: f.end };
    return { feats: lite, peaks: peaks(chs) };
  },

  // Tempo from the plain sum, and the envelopes the mix keys off (kick for sidechain, vocal for ducking).
  prepare({ roles }) {
    // Tempo from the drums when there are drum stems, otherwise from the plain sum.
    const rhythmic = roles.map((r, i) => (['kick', 'snare', 'hats', 'perc', 'drums', 'beat', '808'].includes(r) && S.feats[i] ? S.feats[i].env : null)).filter(Boolean);
    let beat = rhythmic.length ? tempo(rhythmic) : { bpm: 0, confidence: 0 };
    if (!beat.bpm || beat.confidence < 0.05) { const b = estimateBeat(analyzeBands(S.rough, S.rate)); beat = { bpm: b?.bpm || 0, confidence: 0.1 }; }
    const frames = Math.ceil(S.length / S.rate * ENV_RATE);
    const pick = (list) => roles.map((r, i) => (list.includes(r) && S.feats[i] ? S.feats[i] : null)).filter(Boolean);
    const kicks = pick(['kick']).length ? pick(['kick']) : pick(['drums']);
    S.kickLow = kicks.length ? sumEnvelopes(kicks.map((f) => f.low), frames) : null;
    const vox = pick(['leadVox', 'backVox']);
    S.voxPres = vox.length ? sumEnvelopes(vox.map((f) => f.pres), frames) : null;
    S.envLength = frames;
    S.roles = roles;
    return { bpm: beat?.bpm || 0, beat, duration: S.length / S.rate, renderLength: S.length + TAIL(S.rate), hasKick: !!S.kickLow, hasVox: !!S.voxPres };
  },

  plan({ index, role, pan, genre, macros, bpm }) {
    const p = planStrip({ feats: S.feats[index], role, pan }, { genre, macros, bpm, kickLow: S.kickLow, length: S.envLength, has808: S.roles?.includes('808') });
    return { plan: p };
  },

  // Pass 2: a rendered strip arrives; set its fader from its measured loudness and add it to its bus and sends.
  addStrip({ index, plan, dry, wet }) {
    const n = S.length + TAIL(S.rate);
    S.buses ||= Object.fromEntries(BUS.map((b) => [b, [new Float32Array(n), new Float32Array(n)]]));
    const measured = loudness(dry, S.rate);
    const fader = faderGain(plan, measured), g = dbToGain(fader);
    const bus = plan.group === 'vox' ? 'vox' : plan.group === 'drums' ? 'drums' : 'inst';
    for (let c = 0; c < 2; c++) { addInto(S.buses[bus][c], dry[c], g); if (wet) addInto(S.buses[bus][c], wet[c], g); }
    if (plan.verb && plan.verb.send > -50) {
      const target = plan.verb.bus === 'vox' ? 'voxVerb' : 'beatVerb', sg = g * dbToGain(plan.verb.send);
      for (let c = 0; c < 2; c++) addInto(S.buses[target][c], dry[c], sg);
    }
    S.feats[index] = { ...S.feats[index], env: null, sib: null, pres: null }; // done with the big envelopes
    return { fader, measured };
  },

  // Balance the vocal against the beat, then hand the buses back for the bus stage.
  buses({ genre, macros }) {
    const B = S.buses, G = GENRES[genre] || GENRES.hiphop;
    const beatSum = [0, 1].map((c) => { const out = Float32Array.from(B.drums[c]); addInto(out, B.inst[c], 1); return out; });
    const beatLufs = loudness(beatSum, S.rate), voxLufs = B.vox[0].some((v) => v !== 0) ? loudness(B.vox, S.rate) : -120;
    const bal = busBalance({ beatLufs: beatLufs > -100 ? beatLufs : NaN, voxLufs: voxLufs > -100 ? voxLufs : NaN, genre, macros });
    const duck = vocalDuck(S.voxPres, S.envLength, { eqDepth: 2.5 * (G.duck ?? 1), gainDepth: 0.8, verbDepth: G.verbDuck ? 5 : 0 });
    const gains = { drums: bal.beat, inst: bal.beat, vox: bal.vox, voxVerb: bal.vox, beatVerb: bal.beat };
    const out = {}, transfer = [];
    for (const b of BUS) { if (B[b][0].some((v) => v !== 0)) { out[b] = B[b]; transfer.push(...B[b].map((x) => x.buffer)); } else out[b] = null; }
    S.buses = null;
    return { buses: out, gains, duck, balance: { beatLufs, voxLufs, offset: bal.offset }, length: S.length + TAIL(S.rate), transfer };
  },

  // Master the mix toward the genre (or the reference), then give the instrumental, a cappella and the
  // plain "before" sum the same treatment so every file matches.
  master({ mix, instrumental, acapella, genre, macros, reference }) {
    const rate = S.rate, G = GENRES[genre] || GENRES.hiphop;
    const target = reference?.spectrum || G.tone;
    const spectrum = octaveSpectrum(mix, rate);
    const tone = toneMatch(spectrum, target, macros);
    const lufs = Math.max(-14, Math.min(-6, (reference?.lufs ?? G.lufs) + (macros?.loud || 0) * 0.7));
    const premasterLufs = loudness(mix, rate);
    const plan = {
      character: 'balanced', destination: 'custom', lufs, tp: G.tp, ceiling: G.tp - 0.1,
      eq: [{ type: 'highpass', f: 25, q: Math.SQRT1_2 }, { type: 'lowpass', f: 19500, q: 0.54 }, { type: 'lowpass', f: 19500, q: 1.31 }, ...tone],
      glue: { threshold: premasterLufs + 4, ratio: 1.5, knee: 6, attack: 0.03, release: 0.25 },
      width: 1, monoBass: true,
    };
    // Clip before the limiter: a soft clipper shaves the top 1.5 dB of peaks (more for lo-fi) so the limiter works less.
    softClip(mix, genre === 'lofi' ? 2.5 : 1.5);
    if (instrumental) softClip(instrumental, genre === 'lofi' ? 2.5 : 1.5);
    if (acapella) softClip(acapella, 1);
    const res = master(mix, rate, plan);
    // Same chain and gain on the alternates.
    const follow = (chs) => {
      if (!chs) return null;
      const pre = preChain(chs, rate, plan);
      return limit(pre, rate, dbToGain(res.gainDb), res.truePeak <= plan.tp ? plan.ceiling : plan.ceiling - 0.3, true).out;
    };
    const inst = follow(instrumental), acap = follow(acapella);
    // "Before": the plain sum, high-passed and turned to the same loudness, so the comparison is fair.
    const rough = S.rough ? S.rough.map((x) => x.slice(0, mix[0].length)) : null;
    let before = null;
    if (rough) {
      const lr = loudness(rough, rate);
      const pre = rough.map((x) => x);
      before = limit(pre, rate, dbToGain(Math.min(30, res.lufs - lr)), plan.ceiling, false).out;
    }
    // A mix for an outside mastering engineer: no master, peaks at -6 dBFS.
    let peak = 0; for (const c of mix) for (let i = 0; i < c.length; i++) { const a = c[i] < 0 ? -c[i] : c[i]; if (a > peak) peak = a; }
    const pg = peak > 0 ? 0.5 / peak : 1;
    const premaster = mix.map((c) => { const o = new Float32Array(c.length); for (let i = 0; i < c.length; i++) o[i] = c[i] * pg; return o; });
    const outMeasure = measureOutput(res.channels, rate);
    const arrays = [res.channels, inst, acap, before, premaster].flat().filter(Boolean);
    return { mix: res.channels, instrumental: inst, acapella: acap, before, premaster, lufs: outMeasure.lufs, truePeak: outMeasure.truePeak, gainDb: res.gainDb, limiterDb: res.limiterDb, tone, target, spectrum, premasterLufs, transfer: arrays.map((a) => a.buffer) };
  },

  // A reference track: its tonal balance and loudness.
  reference({ channels }) {
    const chs = channels.slice(0, 2);
    return { spectrum: octaveSpectrum(chs, S.rate), lufs: loudness(chs, S.rate) };
  },
};

self.onmessage = async (e) => {
  const { id, type } = e.data;
  try {
    const out = await H[type](e.data);
    const transfer = out.transfer || [];
    delete out.transfer;
    self.postMessage({ id, ok: true, ...out }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
