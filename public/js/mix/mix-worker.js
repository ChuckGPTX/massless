// The mix's back room: listens to each stem, keeps the buses, balances them and masters the result,
// so the page stays smooth while the console renders. Nothing leaves the device.
// Messages are answered { id, ok, ... }; arrays travel as transferables.

import { analyzeStem, sumEnvelopes, tempo, envelope, ENV_RATE } from './analyze.js';
import { sketch, waveLag, fineShiftAt, relativeShifts, fitLevels, shiftEnv, gapsBetween, fittedEnvelope } from './rough.js';
import { ROLE_RULES } from './rules.js';
import { fineEnvelope, tightenOffsets, gateCurve, findSections, arrangementMoves, barActivity } from './timeline.js';
import { chroma, detectKey } from './tune.js';
import { transientShape, doubler } from './fx.js';
import { planStrip, faderGain, busBalance, toneMatch, vocalDuck } from './plan.js';
import { GENRES } from './rules.js';
import { LoudnessMeter } from '../loudness.js';
import { octaveSpectrum, preChain, master, limit, measureOutput } from '../master.js';
import { analyzeBands, estimateBeat } from '../lyrics-engine.js';

const S = { rate: 44100, feats: [], rough: null, length: 0, buses: null };
const BUS = ['drums', 'inst', 'vox', 'hook', 'voxVerb', 'hookVerb', 'beatVerb'];
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

/** Line every stem up against the rough, learn the artist's balance, spot unused takes and missing parts. */
function matchRough(roles, used) {
  const B = S.bounce, rate = S.rate;
  const idx = roles.map((_, i) => i).filter((i) => used[i] && S.feats[i]);
  const raw = idx.map((i) => S.align[i]?.raw ?? null);
  // Stems placed by their session are already where they belong: they only tell us where the rough starts.
  const placedKs = idx.map((i, k) => (S.placed[i] && Number.isFinite(raw[k]) ? k : -1)).filter((k) => k >= 0);
  const rel = relativeShifts(raw, Math.round(rate * 0.002)); // under 2 ms is measurement noise, not a misplaced stem
  if (placedKs.length) { const sorted = placedKs.map((k) => raw[k]).sort((a, b) => a - b); const c = sorted[sorted.length >> 1]; idx.forEach((i, k) => { rel[k] = S.placed[i] ? 0 : (Number.isFinite(raw[k]) && Math.abs(raw[k] - c) > rate * 0.002 ? raw[k] - c : 0); }); }
  const anchor = placedKs.length ? placedKs[0] : idx.findIndex((i, k) => Number.isFinite(raw[k]));
  S.common = anchor >= 0 ? (placedKs.length ? placedKs.map((k) => raw[k]).sort((a, b) => a - b)[placedKs.length >> 1] : raw[anchor] - rel[anchor]) : 0; // where bar 1 of the stems lands in the rough
  const frames = Math.ceil(Math.max(S.length, B.mono.length) / rate * ENV_RATE) + ENV_RATE;
  const commonFrames = Math.round((S.common / rate) * ENV_RATE);
  const roughEnv = { env: shiftEnv(B.feats.env, -commonFrames, frames), low: shiftEnv(B.feats.bands.low, -commonFrames, frames), mid: shiftEnv(B.feats.bands.mid, -commonFrames, frames), high: shiftEnv(B.feats.bands.high, -commonFrames, frames) };
  const moved = [];
  idx.forEach((i, k) => {
    const f = S.feats[i], sh = rel[k], fr = Math.round((sh / rate) * ENV_RATE);
    S.shift[i] = sh;
    if (Math.abs(sh) >= rate * 0.001) moved.push({ index: i, ms: Math.round((sh / rate) * 1000) });
    for (const key of ['env', 'low', 'sib', 'pres']) f[key] = shiftEnv(f[key], fr, frames);
    f.bands = { low: f.low, mid: shiftEnv(f.bands.mid, fr, frames), high: shiftEnv(f.bands.high, fr, frames) };
    const act = new Uint8Array(frames); for (let t = 0; t < frames; t++) { const j = t - fr; if (j >= 0 && j < f.active.length) act[t] = f.active[j]; } f.active = act;
    S.length = Math.max(S.length, Math.round(f.duration * rate) + Math.max(0, sh));
  });
  const fit = fitLevels(idx.map((i) => S.feats[i].bands), roughEnv);
  const gains = fit.gains, finite = gains.filter(Number.isFinite).sort((a, b) => a - b), med = finite[Math.floor(finite.length / 2)] ?? 0;
  // Each stem's loudness inside the rough. The reference is the lead vocal the artist actually used (the loudest one
  // in the rough), otherwise the loudest stem.
  const inRough = idx.map((i, k) => (Number.isFinite(gains[k]) ? S.feats[i].lufs + gains[k] : -Infinity));
  const leadKs = idx.map((i, k) => (roles[i] === 'leadVox' ? k : -1)).filter((k) => k >= 0);
  const pool = leadKs.length ? leadKs : idx.map((_, k) => k);
  const refK = pool.reduce((a, b) => (inRough[b] > inRough[a] ? b : a), pool[0]);
  const ruleOf = (i) => ROLE_RULES[roles[i]]?.level ?? -10;
  // Takes the artist didn't use: no waveform match in the rough AND far quieter in it than their role would be.
  // Never the reference lead vocal.
  const leaveOut = idx.filter((i, k) => {
    if (fit.fit < 0.5 || k === refK || S.feats[i].activeSeconds < 2) return false;
    const absent = !Number.isFinite(inRough[k]) || inRough[k] - inRough[refK] < ruleOf(i) - ruleOf(idx[refK]) - 15;
    return absent && (S.align[i]?.peak ?? 1) < 0.1;
  });
  // The artist's balance nudges the rulebook: half the difference, at most 4 dB either way.
  idx.forEach((i, k) => {
    S.levelAdjust[i] = 0;
    if (fit.fit < 0.5 || k === refK || leaveOut.includes(i) || !Number.isFinite(inRough[k]) || !Number.isFinite(inRough[refK])) return;
    const roughRel = inRough[k] - inRough[refK], ruleRel = ruleOf(i) - ruleOf(idx[refK]);
    S.levelAdjust[i] = Math.max(-4, Math.min(4, (roughRel - ruleRel) * 0.5));
  });
  const keep = idx.map((i, k) => (leaveOut.includes(i) ? -Infinity : gains[k]));
  const explained = fittedEnvelope(idx.map((i) => S.feats[i].env), keep, frames);
  const missing = fit.fit >= 0.3 ? gapsBetween(roughEnv.env, explained, { drop: 6, minSeconds: 2 }) : [];
  S.roughEnv = roughEnv.env;
  return { fit: Math.round(fit.fit * 100) / 100, moved, leaveOut, missing, adjust: idx.map((i) => ({ index: i, db: Math.round(S.levelAdjust[i] * 10) / 10 })), diag: idx.map((i, k) => ({ index: i, raw: raw[k], conf: +(S.align[i]?.confidence ?? 0).toFixed(2), edge: +(S.align[i]?.edge ?? 0).toFixed(1), peak: +(S.align[i]?.peak ?? 0).toFixed(2), gain: Number.isFinite(gains[k]) ? +gains[k].toFixed(1) : null, inRough: Number.isFinite(inRough[k]) ? +inRough[k].toFixed(1) : null })), commonMs: Math.round((S.common / rate) * 1000) };
}

/** No rough given: is one of the "stems" really the whole song? (It plays all the time and follows the sum of the rest.) */
function probableRough(roles, used) {
  const idx = roles.map((_, i) => i).filter((i) => used[i] && S.feats[i]?.bands);
  if (idx.length < 3) return null;
  const len = Math.min(...idx.map((i) => S.feats[i].env.length));
  const p = (d) => (d > -119 ? 10 ** (d / 10) : 0);
  const corr = (x, y) => {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0;
    for (let t = 0; t < x.length; t++) { sx += x[t]; sy += y[t]; sxx += x[t] * x[t]; syy += y[t] * y[t]; sxy += x[t] * y[t]; n++; }
    const d = (n * sxx - sx * sx) * (n * syy - sy * sy);
    return d > 1e-30 ? (n * sxy - sx * sy) / Math.sqrt(d) : 0;
  };
  // A full mix follows the rest of the stems in every band: low, mid and top. A loud kick or 808 follows them only
  // in the low end, so the quick score is the weakest band (bands where the other stems are silent don't count).
  const scored = [];
  for (const i of idx) {
    if (S.feats[i].activeRatio < 0.6) continue;
    let score = Infinity;
    for (const band of ['low', 'mid', 'high']) {
      const x = new Float64Array(Math.ceil(len / 2)), y = new Float64Array(x.length);
      for (let t = 0, k = 0; t < len; t += 2, k++) {
        x[k] = p(S.feats[i].bands[band][t]);
        for (const j of idx) if (j !== i) y[k] += p(S.feats[j].bands[band][t]);
      }
      let ey = 0; for (const v of y) ey += v;
      if (ey / y.length < 1e-7) continue; // nothing else plays in this band
      score = Math.min(score, corr(x, y));
    }
    if (Number.isFinite(score) && score >= 0.3) scored.push({ i, score });
  }
  // Then the real test on the best few: can the other stems, each at some level, rebuild it? (R² of that fit.)
  const thin = (env) => { const o = new Float32Array(Math.ceil(len / 4)); for (let k = 0; k < o.length; k++) o[k] = env[k * 4] ?? -120; return o; };
  const bandsOf = (j) => ({ low: thin(S.feats[j].bands.low), mid: thin(S.feats[j].bands.mid), high: thin(S.feats[j].bands.high) });
  let best = null, bestFit = 0.75;
  for (const { i } of scored.sort((a, b) => b.score - a.score).slice(0, 3)) {
    const { fit } = fitLevels(idx.filter((j) => j !== i).map(bandsOf), bandsOf(i));
    if (fit > bestFit) { bestFit = fit; best = i; }
  }
  return best;
}

const H = {
  reset({ rate }) { Object.assign(S, { rate, feats: [], rough: null, length: 0, buses: null, bounce: null, align: [], shift: [], levelAdjust: [], common: 0, placed: [], fine: [], tighten: [], arrange: null, gates: [], chroma: [], key: null }); return {}; },

  // The artist's rough mix (full bounce): kept to line stems up against, learn the balance from, and check the result.
  bounce({ channels }) {
    const chs = channels.slice(0, 2), n = chs[0].length;
    const mono = chs.length > 1 ? Float32Array.from(chs[0], (v, i) => 0.5 * (v + chs[1][i])) : chs[0];
    const feats = analyzeStem(chs, S.rate);
    S.bounce = { chs, mono, feats, sketch: { dark: sketch(mono, S.rate), bright: sketch(mono, S.rate, { bright: true }) } };
    S.length = Math.max(S.length, n);
    return { duration: n / S.rate, lufs: feats.lufs, peaks: peaks(chs) };
  },

  // Pass 1: listen to one stem and add it to the plain sum used for tempo and the "before" comparison.
  analyze({ index, channels, placed = false }) {
    const chs = channels.slice(0, 2), n = chs[0].length;
    S.length = Math.max(S.length, n);
    S.placed[index] = placed;
    if (!S.bounce) {
      S.rough = S.rough || [new Float32Array(n), new Float32Array(n)];
      S.rough = S.rough.map((r) => grow(r, n));
      addInto(S.rough[0], chs[0], 1); addInto(S.rough[1], chs[1] || chs[0], 1);
    }
    const f = analyzeStem(chs, S.rate);
    S.feats[index] = f;
    const mono = chs.length > 1 ? Float32Array.from(chs[0], (v, i) => 0.5 * (v + chs[1][i])) : chs[0];
    // A 1 kHz envelope for timing work (doubles against the lead); the worker drops it once the mix is planned.
    S.fine[index] = f.activeRatio < 0.9 && f.activeRatio > 0.02 ? fineEnvelope(mono, S.rate) : null;
    S.chroma[index] = f.activeRatio > 0.02 ? chroma(mono, S.rate) : null; // the notes it holds, for the song's key
    if (S.bounce) {
      // Where does this stem sit in the rough? Onsets first (coarse), then the waveform itself (to the sample).
      // Find it in the waveform (a 2.2 kHz sketch), then pin it to the sample. Loops stay at bar 1 when that fits as well.
      const bright = f.lowShare + f.midShare < 0.25;
      const w = waveLag(sketch(mono, S.rate, { bright }), bright ? S.bounce.sketch.bright : S.bounce.sketch.dark);
      const fine = fineShiftAt(mono, S.bounce.mono, S.rate, w.lag);
      // A quiet part under a busy rough matches the waveform only weakly even when it's exactly in place, so a match
      // that stands far out of the noise (z ≥ 8), or one that beats bar 1 by a wide margin, is trusted on its own.
      const strong = w.z >= 8 || (w.z >= 6 && w.edge >= 3);
      const raw = fine.peak >= 0.1 && w.z >= 5 ? fine.shift : strong ? (fine.peak > 0 ? fine.shift : w.lag) : null;
      S.align[index] = { raw, confidence: w.z, edge: w.edge, peak: fine.peak };
    }
    const lite = { duration: f.duration, lufs: f.lufs, isMono: f.isMono, width: f.width, crestDb: f.crestDb, onsetsPerSec: f.onsetsPerSec, centroid: f.centroid, activeRatio: f.activeRatio, activeSeconds: f.activeSeconds, subShare: f.subShare, lowShare: f.lowShare, mudShare: f.mudShare, midShare: f.midShare, highShare: f.highShare, spectrum: f.spectrum, start: f.start, end: f.end };
    return { feats: lite, peaks: peaks(chs) };
  },

  // Tempo from the plain sum, and the envelopes the mix keys off (kick for sidechain, vocal for ducking).
  prepare({ roles, hookBars = [], genre }) {
    S.arrangeOpts = (GENRES[genre] || GENRES.hiphop).arrange || {};
    const used = roles.map((r) => r !== 'rough' && r !== 'skip');
    const rough = S.bounce ? matchRough(roles, used) : { probable: probableRough(roles, used) };
    // Tempo from the drums when there are drum stems, otherwise from the plain sum.
    const rhythmic = roles.map((r, i) => (used[i] && ['kick', 'snare', 'hats', 'perc', 'drums', 'beat', '808'].includes(r) && S.feats[i] ? S.feats[i].env : null)).filter(Boolean);
    let beat = rhythmic.length ? tempo(rhythmic) : { bpm: 0, confidence: 0 };
    if (!beat.bpm || beat.confidence < 0.05) { const b = estimateBeat(analyzeBands(S.bounce ? S.bounce.chs : S.rough, S.rate)); beat = { bpm: b?.bpm || 0, confidence: 0.1 }; }
    const frames = Math.ceil(S.length / S.rate * ENV_RATE);
    const pick = (list) => roles.map((r, i) => (list.includes(r) && used[i] && !rough.leaveOut?.includes(i) && S.feats[i] ? S.feats[i] : null)).filter(Boolean);
    const kicks = pick(['kick']).length ? pick(['kick']) : pick(['drums']);
    S.kickLow = kicks.length ? sumEnvelopes(kicks.map((f) => f.low), frames) : null;
    const vox = pick(['leadVox', 'backVox', 'double']);
    S.voxPres = vox.length ? sumEnvelopes(vox.map((f) => f.pres), frames) : null;
    S.envLength = frames;
    const live = (i) => used[i] && S.feats[i] && !rough.leaveOut?.includes(i);
    // Two leads singing the same bars (a session's "Main A" and "Main B") are one lead and a stacked take: the
    // second becomes a centre double, tightened to the first, so the lead stays one voice instead of two in a fight.
    const stacked = [];
    const leads = roles.map((r, i) => (r === 'leadVox' && live(i) && S.feats[i].active ? i : -1)).filter((i) => i >= 0);
    for (let a = 1; a < leads.length; a++) {
      const i = leads[a], A = S.feats[i].active;
      for (let b = 0; b < a; b++) {
        const j = leads[b], B = S.feats[j].active;
        if (stacked.some((t) => t.index === j)) continue;
        let both = 0, na = 0, nb = 0;
        for (let k = 0; k < Math.min(A.length, B.length); k++) { if (A[k]) na++; if (B[k]) nb++; if (A[k] && B[k]) both++; }
        if (na && nb && both / Math.min(na, nb) >= 0.5) { // the take that sings more stays the lead
          const [lead, stack] = na > nb ? [i, j] : [j, i];
          stacked.push({ index: stack, with: lead, share: +(both / Math.min(na, nb)).toFixed(2) }); roles[stack] = 'double'; break;
        }
      }
    }
    S.roles = roles;
    // The song's key: the music's notes (then the vocals' when there's no music), for the retune.
    // the music's notes at full weight, each vocal's at a third (the vocals are what gets tuned, so they get a say)
    const musicChroma = new Float32Array(12);
    let voters = 0;
    for (const [pool, weight] of [[['beat', 'music', 'keys', 'pad', 'synth', 'guitar', 'bass', '808'], 1], [['leadVox', 'backVox', 'double'], 0.35]]) {
      roles.forEach((r, i) => { if (pool.includes(r) && live(i) && S.chroma[i]) { for (let k = 0; k < 12; k++) musicChroma[k] += S.chroma[i][k] * weight; voters++; } });
    }
    S.musicChroma = voters ? musicChroma : null;
    S.key = voters ? detectKey(musicChroma) : null;
    // Doubles follow the lead: each phrase measured against the lead (whichever lead sings there), to the ms.
    const leadIdx = roles.map((r, i) => (r === 'leadVox' && live(i) && S.fine[i] ? i : -1)).filter((i) => i >= 0);
    const tightened = [];
    if (leadIdx.length) {
      const L = Math.max(...leadIdx.map((i) => S.fine[i].length)), leadEnv = new Float32Array(L).fill(-120);
      for (const i of leadIdx) { const e = S.fine[i]; for (let k = 0; k < e.length; k++) if (e[k] > leadEnv[k]) leadEnv[k] = e[k]; }
      roles.forEach((r, i) => {
        if (r !== 'double' || !live(i) || !S.fine[i]) return;
        const moves = tightenOffsets(S.fine[i], leadEnv).filter((m) => m.ms);
        if (moves.length) { S.tighten[i] = moves; tightened.push({ index: i, phrases: moves.length, maxMs: Math.max(...moves.map((m) => Math.abs(m.ms))), ms: moves.map((m) => m.ms) }); }
      });
    }
    // The song's shape: who sings in each bar, how loud the music is, then the moves that build into every chorus.
    const bpm = beat?.bpm || 0, bar = bpm > 50 ? (60 / bpm) * 4 : 0, bars = bar ? Math.ceil(S.length / S.rate / bar) : 0;
    let arrange = null;
    if (bars >= 8) {
      const vocal = roles.map((r, i) => (['leadVox', 'backVox', 'double', 'adlib'].includes(r) && live(i) ? i : -1)).filter((i) => i >= 0);
      const layers = new Uint8Array(bars), lead = new Uint8Array(bars), adlib = new Uint8Array(bars);
      for (const i of vocal) { const a = barActivity(S.feats[i].active, bar, bars); for (let b = 0; b < bars; b++) if (a[b]) { layers[b]++; if (roles[i] === 'leadVox') lead[b] = 1; if (roles[i] === 'adlib') adlib[b] = 1; } }
      const music = roles.map((r, i) => (!['leadVox', 'backVox', 'double', 'adlib', 'rough', 'skip'].includes(r) && live(i) ? S.feats[i].env : null)).filter(Boolean);
      const musicEnv = music.length ? sumEnvelopes(music, frames) : S.roughEnv || null;
      const energy = Array.from({ length: bars }, (_, b) => { if (!musicEnv) return NaN; let s = 0, n = 0; for (let k = Math.round(b * bar * ENV_RATE); k < Math.round((b + 1) * bar * ENV_RATE) && k < musicEnv.length; k++) { s += 10 ** (musicEnv[k] / 10); n++; } return n ? 10 * Math.log10(s / n + 1e-12) : NaN; });
      const hook = new Uint8Array(bars); for (const [from, to] of hookBars) for (let b = Math.max(0, Math.floor(from / bar)); b < Math.min(bars, Math.ceil(to / bar)); b++) hook[b] = 1;
      const sections = findSections({ layers: Array.from(layers), lead: Array.from(lead), energy, adlib: Array.from(adlib), hook: Array.from(hook) });
      const A = arrangementMoves(sections, bar, frames, S.arrangeOpts || {});
      S.arrange = { ...A, bar, sections };
      arrange = { bar, bars, sections: sections.map((s) => ({ ...s, from: +(s.from * bar).toFixed(2), to: +(s.to * bar).toFixed(2), fromBar: s.from, toBar: s.to })), moves: A.moves, layers: Array.from(layers) };
    }
    return { bpm: beat?.bpm || 0, beat, duration: S.length / S.rate, renderLength: S.length + TAIL(S.rate), hasKick: !!S.kickLow, hasVox: !!S.voxPres, rough, tightened, arrange, key: S.key, musicChroma: S.musicChroma ? Array.from(S.musicChroma) : null, stacked };
  },

  /** The phrase moves for one double, so the engine can lift its phrases into place before rendering. */
  tightening({ index }) { return { moves: S.tighten[index] || [] }; },

  plan({ index, role, pan, genre, macros, bpm, ghost = false }) {
    const G = GENRES[genre] || GENRES.hiphop;
    const p = planStrip({ feats: S.feats[index], role, pan }, { genre, macros, bpm, kickLow: S.kickLow, length: S.envLength, has808: S.roles?.includes('808') });
    // The artist's balance from the rough nudges the rulebook level, and the stem moves to where it sits in the song.
    p.level += S.levelAdjust[index] || 0;
    p.shift = (S.shift[index] || 0) / S.rate;
    const vocal = ['leadVox', 'backVox', 'double', 'adlib'].includes(role), f = S.feats[index], A = S.arrange;
    // Clean-up between phrases: doubles and ad-libs close hard, the lead gently (its breaths are part of the take).
    const gate = vocal && f?.env ? gateCurve(f.env, { depth: role === 'leadVox' ? 9 : 18 }) : null;
    // The arrangement: lifts per section, the build-up moves, the reverb that's bigger in verses and thrown before a drop.
    const n = S.envLength, auto = new Float32Array(n);
    if (gate) for (let k = 0; k < n; k++) auto[k] += gate[k] ?? 0;
    if (A) {
      const lift = role === 'leadVox' ? A.lift.lead : role === 'double' || role === 'backVox' ? A.lift.double : role === 'adlib' ? A.lift.adlib : null;
      if (lift) for (let k = 0; k < n; k++) auto[k] += lift[k];
      if (!vocal && role !== 'fx') { p.hpfCurve = A.beatHpf; for (let k = 0; k < n; k++) auto[k] += A.beatMute[k]; }
      if (vocal) { p.fxMute = A.fxMute; if (role === 'leadVox' && p.verb) p.verbCurve = A.leadVerb; }
    }
    if (ghost) { for (let k = 0; k < n; k++) auto[k] += A?.sections ? -60 : 0; if (A) for (const s of A.sections) if (s.kind === 'chorus') for (let k = Math.round(s.from * A.bar * ENV_RATE); k < Math.min(n, Math.round(s.to * A.bar * ENV_RATE)); k++) auto[k] += 60; }
    p.auto = gate || A || ghost ? auto : null;
    p.gated = !!gate;
    // The delay ducker (the templates' "Delay Ducker" return): the echoes sit under the voice while it sings and
    // bloom in the gaps between phrases. Keyed off the stem's own envelope, so every vocal ducks its own delay.
    if (vocal && p.delay && f?.env && Number.isFinite(G.delayDuck)) p.delayDuck = vocalDuck(f.env, n, { gainDepth: G.delayDuck }).gain;
    if (vocal && !ghost && Number.isFinite(G.clip)) p.clip = G.clip;
    return { plan: p };
  },

  // Pass 2: a rendered strip arrives; set its fader from its measured loudness and add it to its bus and sends.
  addStrip({ index, plan, dry, wet }) {
    const n = S.length + TAIL(S.rate);
    S.buses ||= Object.fromEntries(BUS.map((b) => [b, [new Float32Array(n), new Float32Array(n)]]));
    // Vocal clip limiter (the templates' L1 / Maxim on every vocal track): the hottest syllables are caught at
    // -6 dBFS with 2 ms look-ahead, so a shout never jumps out of the stack and the fader lands on the body of the take.
    if (plan.group === 'vox' && plan.clip) { const l = limit(dry, S.rate, 1, plan.clip, false).out; for (let c = 0; c < dry.length; c++) dry[c] = l[c]; }
    const measured = loudness(dry, S.rate);
    const fader = faderGain(plan, measured), g = dbToGain(fader);
    // leads on the vocal bus; doubles, backing vocals, ad-libs and the deep layer on the hook bus, as the templates route them
    const bus = plan.group === 'vox' ? (['double', 'backVox', 'adlib', 'deep'].includes(plan.role) ? 'hook' : 'vox') : plan.group === 'drums' ? 'drums' : 'inst';
    for (let c = 0; c < 2; c++) { addInto(S.buses[bus][c], dry[c], g); if (wet) addInto(S.buses[bus][c], wet[c], g); }
    if (plan.verb && plan.verb.send > -50) {
      const target = plan.verb.bus === 'vox' ? (bus === 'hook' ? 'hookVerb' : 'voxVerb') : 'beatVerb', sg = g * dbToGain(plan.verb.send);
      // Send automation: more room in the verses, a throw into each drop, and the dry punch right before the chorus.
      const curve = plan.verbCurve || plan.fxMute ? Float32Array.from({ length: S.envLength }, (_, k) => (plan.verbCurve?.[k] || 0) + (plan.fxMute?.[k] || 0)) : null;
      for (let c = 0; c < 2; c++) {
        if (!curve) { addInto(S.buses[target][c], dry[c], sg); continue; }
        const src = dry[c], dst = S.buses[target][c], per = S.rate / ENV_RATE;
        for (let i = 0; i < src.length && i < dst.length; i++) { const k = Math.min(curve.length - 1, Math.floor(i / per)); dst[i] += src[i] * sg * dbToGain(curve[k]); }
      }
    }
    S.feats[index] = { ...S.feats[index], env: null, sib: null, pres: null }; S.fine[index] = null; // done with the big envelopes
    return { fader, measured };
  },

  // Balance the vocal against the beat, then hand the buses back for the bus stage.
  buses({ genre, macros }) {
    const B = S.buses, G = GENRES[genre] || GENRES.hiphop;
    // Punch: the drums' hits lifted a little at their start (the templates' AVOX Punch on ad-libs, SPL-style on drums).
    if (G.punch && B.drums[0].some((v) => v !== 0)) { const p = transientShape(B.drums, S.rate, { attackDb: G.punch }); B.drums[0] = p[0]; B.drums[1] = p[1]; }
    const hookOn = B.hook[0].some((v) => v !== 0);
    // Doubler: the stack (doubles, backing vocals, ad-libs) widened with a detuned, late copy each side.
    if (hookOn && Number.isFinite(G.doubler)) { const d = doubler(B.hook, S.rate, { wetDb: G.doubler }); for (let c = 0; c < 2; c++) addInto(B.hook[c], d[c], 1); }
    const beatSum = [0, 1].map((c) => { const out = Float32Array.from(B.drums[c]); addInto(out, B.inst[c], 1); return out; });
    const voxSum = [0, 1].map((c) => { const out = Float32Array.from(B.vox[c]); if (hookOn) addInto(out, B.hook[c], 1); return out; });
    const beatLufs = loudness(beatSum, S.rate), voxLufs = voxSum[0].some((v) => v !== 0) ? loudness(voxSum, S.rate) : -120;
    const bal = busBalance({ beatLufs: beatLufs > -100 ? beatLufs : NaN, voxLufs: voxLufs > -100 ? voxLufs : NaN, genre, macros });
    const duck = vocalDuck(S.voxPres, S.envLength, { eqDepth: 2.5 * (G.duck ?? 1), gainDepth: 0.8, verbDepth: G.verbDuck ? 5 : 0 });
    const gains = { drums: bal.beat, inst: bal.beat, vox: bal.vox, hook: bal.vox, voxVerb: bal.vox, hookVerb: bal.vox, beatVerb: bal.beat };
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
    // With a rough mix, "before" is the artist's own rough, lined up with the stems.
    const n = mix[0].length;
    const align = (chs) => chs.map((x) => { const o = new Float32Array(n), c = S.common || 0; for (let i = 0; i < n; i++) { const j = i + c; if (j >= 0 && j < x.length) o[i] = x[j]; } return o; });
    const rough = S.bounce ? align(S.bounce.chs) : S.rough ? S.rough.map((x) => x.slice(0, n)) : null;
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
    // Is it still the whole song? Every stretch where the rough plays must play in the mix too.
    let coverage = null;
    if (S.roughEnv) {
      const mono = Float32Array.from(res.channels[0], (v, i) => 0.5 * (v + (res.channels[1]?.[i] ?? v)));
      const gaps = gapsBetween(S.roughEnv, envelope(mono, rate), { drop: 18, minSeconds: 1.5 });
      coverage = { gaps, seconds: Math.round(S.bounce.mono.length / rate) };
    }
    const arrays = [res.channels, inst, acap, before, premaster].flat().filter(Boolean);
    return { coverage, mix: res.channels, instrumental: inst, acapella: acap, before, premaster, lufs: outMeasure.lufs, truePeak: outMeasure.truePeak, gainDb: res.gainDb, limiterDb: res.limiterDb, tone, target, spectrum, premasterLufs, transfer: arrays.map((a) => a.buffer) };
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
