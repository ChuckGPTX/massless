// The mix engineer's decisions, as pure functions: analysis + role + genre + the AI's style notes in,
// channel-strip settings and automation curves out. Nothing here touches audio, so every decision is testable.

import { ROLE_RULES, GENRES, LIMITS } from './rules.js';
import { THIRDS, ENV_RATE, follow } from './analyze.js';
import { ROLES } from './roles.js';

export const STAGE_LUFS = -18; // every stem is gain-staged here before its chain (the classic -18 dBFS habit)
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

export const NEUTRAL_MACROS = { vox: 0, low: 0, bright: 0, space: 0, width: 0, loud: 0 };
export function cleanMacros(m = {}) {
  const out = {};
  for (const k of Object.keys(NEUTRAL_MACROS)) out[k] = clamp(Number(m[k]) || 0, -LIMITS.macro, LIMITS.macro);
  return out;
}

/**
 * Narrow resonances: third-octave bands that stand more than 3.5 dB above their neighbours' trend,
 * between 150 Hz and 8 kHz. Returns up to `max` peaking cuts (about 60% of the excess, never more than LIMITS.fixCut).
 */
export function resonanceCuts(spectrum, max = 2) {
  if (!max) return [];
  const found = [];
  for (let i = 2; i < THIRDS.length - 2; i++) {
    const f = THIRDS[i];
    if (f < 150 || f > 8000) continue;
    const trend = (spectrum[i - 2] + spectrum[i - 1] + spectrum[i + 1] + spectrum[i + 2]) / 4;
    const excess = spectrum[i] - trend;
    if (excess > 3.5 && spectrum[i] >= spectrum[i - 1] && spectrum[i] >= spectrum[i + 1]) found.push({ f, excess });
  }
  return found.sort((a, b) => b.excess - a.excess).slice(0, max).map(({ f, excess }) => ({ type: 'peaking', f, q: 4.3, gain: -Math.min(LIMITS.fixCut, Math.round(excess * 0.6 * 10) / 10), fix: true }));
}

/** De-esser automation (dB on a peaking band) from the sibilance and presence envelopes. */
export function deessCurve(feats, maxCut = 6) {
  const { sib, pres, active } = feats, out = new Float32Array(sib.length);
  const loud = median(Array.from(pres).filter((_, k) => active[k])) || -40;
  for (let k = 0; k < sib.length; k++) {
    if (!active[k] || sib[k] < loud - 24) continue;
    const excess = sib[k] - (pres[k] - 4); // an "s" is when the 5-10 kHz band nears the 1-5 kHz band
    out[k] = excess > 0 ? -Math.min(maxCut, excess * 0.9) : 0;
  }
  // fast in, slower out, so the cut never chatters
  const sm = follow(Float32Array.from(out, (v) => -v), 0.002, 0.05);
  return Float32Array.from(sm, (v) => -v);
}

/** Vocal rider: gentle gain moves (max ±5 dB) that bring every phrase toward the vocal's typical level. */
export function riderCurve(feats, depth = 0.6) {
  const { env, active } = feats, smooth = follow(env, 0.25, 0.4);
  const target = median(Array.from(smooth).filter((_, k) => active[k])) || -30;
  const raw = Float32Array.from(smooth, (v, k) => (active[k] ? clamp((target - v) * depth, -5, 5) : 0));
  return follow(raw.map((v) => v + 60), 0.15, 0.15).map((v) => v - 60);
}

/** Sidechain: duck by up to `depth` dB as the kick hits, back up over about 90 ms. */
export function duckCurve(kickLow, depth, length) {
  const out = new Float32Array(length);
  if (!kickLow || depth <= 0) return out;
  const top = kickLow.reduce((a, b) => Math.max(a, b), -120);
  for (let k = 0; k < length; k++) {
    const v = kickLow[k] ?? -120;
    const amt = clamp((v - (top - 18)) / 14, 0, 1);
    out[k] = -depth * amt;
  }
  return Float32Array.from(follow(Float32Array.from(out, (v) => -v), 0.001, 0.09), (v) => -v);
}

/** While the vocal sings: a dip at 2.5 kHz in the music bus (and a touch of overall level), and the vocal reverb tucked under. */
export function vocalDuck(voxPres, length, { eqDepth = 2.5, gainDepth = 1, verbDepth = 0 } = {}) {
  const eq = new Float32Array(length), gain = new Float32Array(length), verb = new Float32Array(length);
  if (!voxPres) return { eq, gain, verb };
  const top = voxPres.reduce((a, b) => Math.max(a, b), -120);
  const sm = follow(voxPres, 0.02, 0.25);
  for (let k = 0; k < length; k++) {
    const amt = clamp(((sm[k] ?? -120) - (top - 30)) / 18, 0, 1);
    eq[k] = -eqDepth * amt; gain[k] = -gainDepth * amt; verb[k] = -verbDepth * amt;
  }
  return { eq, gain, verb };
}

/** Pan positions for several stems sharing a "spread" role: alternate left and right, widening outward. */
export function spreadPans(count, base = 0.35, step = 0.15) {
  return Array.from({ length: count }, (_, i) => {
    if (count === 1) return 0;
    const side = i % 2 ? 1 : -1, ring = Math.floor(i / 2);
    return clamp(side * (base + ring * step), -0.8, 0.8);
  });
}

/**
 * One channel strip's plan.
 * s: { feats, role, pan }; ctx: { genre, macros, bpm, kickLow, length }.
 */
export function planStrip(s, ctx) {
  const R = ROLE_RULES[s.role] || ROLE_RULES.synth, G = GENRES[ctx.genre] || GENRES.hiphop, M = ctx.macros || NEUTRAL_MACROS;
  const f = s.feats, group = ROLES[s.role]?.group || 'music';
  const trim = clamp(STAGE_LUFS - f.lufs, -LIMITS.trim, LIMITS.trim);
  const eq = [...(R.eq || [])].map((e) => (/peaking|shelf/.test(e.type) ? { ...e, gain: clamp(e.gain || 0, -LIMITS.cut, LIMITS.boost) } : { ...e }));
  // Brightness macro: vocals and top-end instruments get a little more or less air.
  const bright = (G.bright + M.bright) * 0.5;
  if (['leadVox', 'backVox', 'adlib', 'hats', 'snare'].includes(s.role) && Math.abs(bright) >= 0.2) eq.push({ type: 'highshelf', f: 9000, gain: clamp(bright, -3, 3) });
  // Low macro: weight on kick, 808 and bass.
  const low = (G.low + M.low) * 0.6;
  if (['kick', '808', 'bass'].includes(s.role) && Math.abs(low) >= 0.2) eq.push({ type: 'lowshelf', f: 90, gain: clamp(low, -3, 3.5) });
  // Resonance cuts: a cut near an existing band replaces that band's move instead of fighting it.
  for (const c of resonanceCuts(f.spectrum, R.fix || 0)) {
    const near = eq.find((e) => e.type === 'peaking' && Math.abs(Math.log2(e.f / c.f)) < 0.34);
    if (near) { near.gain = clamp(Math.min(near.gain, 0) + c.gain * 0.7, -LIMITS.fixCut, LIMITS.boost); near.fix = true; }
    else eq.push(c);
  }
  mergeShelves(eq);
  // Thresholds aim each compressor's gain reduction at the stem's loud passages (after gain staging).
  const loud = Number.isFinite(f.loudDb) && f.loudDb > -100 ? f.loudDb + trim : STAGE_LUFS + 4;
  const ratio1 = s.role === 'leadVox' ? G.voxRatio || R.comp?.ratio : R.comp?.ratio;
  const thr = (level, gr, ratio) => clamp(level - gr / (1 - 1 / Math.max(1.01, ratio)), -60, 0);
  const comp = R.comp ? { threshold: thr(loud, R.comp.gr, ratio1), ratio: ratio1, attack: R.comp.attack, release: R.comp.release, knee: 6, gr: R.comp.gr } : null;
  const comp2 = R.comp2 ? { threshold: thr(loud - (R.comp?.gr || 0), R.comp2.gr, R.comp2.ratio), ratio: R.comp2.ratio, attack: R.comp2.attack, release: R.comp2.release, knee: 10, gr: R.comp2.gr } : null;
  const bpm = ctx.bpm > 50 && ctx.bpm < 200 ? ctx.bpm : 90;
  let delay = null;
  if (R.delay) {
    const note = (s.role === 'leadVox' ? G.delayNote ?? R.delay.note : R.delay.note) * 4; // in beats
    delay = { time: clamp((note * 60) / bpm, 0.08, 1.8), send: R.delay.send + (G.space + M.space) * 0.7, feedback: R.delay.feedback, hp: 400, lp: 8000, pan: 0 };
  }
  const verb = R.verb ? { bus: R.verb.bus, send: R.verb.send + G.space + M.space } : null;
  const widthBase = R.width || 1;
  const width = f.isMono ? 1 : clamp(widthBase * (G.width || 1) * (1 + M.width * 0.06), 0.6, 1.6);
  const duckDepth = R.duck && ctx.kickLow ? R.duck.depth * (G.duck ?? 1) : 0;
  return {
    role: s.role, group, trim, mono: !!R.mono,
    hpf: s.role === 'leadVox' && G.voxHpf ? G.voxHpf : s.role === 'kick' && ctx.has808 ? 40 : R.hpf || 0, lpf: R.lpf || 0, eq,
    deess: R.deess && f.sib ? { f: R.deess.f, max: R.deess.max, curve: deessCurve(f, R.deess.max) } : null,
    comp, comp2,
    sat: R.sat ? { drive: R.sat.drive, mix: clamp(R.sat.mix * (ctx.genre === 'lofi' ? 1.6 : 1), 0, 0.6) } : null,
    rider: R.rider ? riderCurve(f) : null,
    duck: duckDepth ? duckCurve(ctx.kickLow, duckDepth, ctx.length) : null,
    pan: typeof s.pan === 'number' ? s.pan : typeof R.pan === 'number' ? R.pan : 0,
    width, delay, verb,
    level: R.level + (['kick', '808', 'bass'].includes(s.role) ? (G.low + M.low) * 0.5 : 0),
  };
}

/**
 * Fader gain (dB) that puts a rendered strip at its target loudness.
 * measured: integrated LUFS of the rendered dry strip. Lead vocal sits at STAGE_LUFS; everything else relative.
 */
export function faderGain(plan, measured) {
  if (!Number.isFinite(measured) || measured < -70) return -120;
  return clamp(STAGE_LUFS + plan.level - measured, -40, 24);
}

/** Bus gains: the vocal bus sits `offset` LU above the beat, and the sum lands near -16 LUFS before the mix bus. */
export function busBalance({ beatLufs, voxLufs, genre, macros }) {
  const G = GENRES[genre] || GENRES.hiphop, M = macros || NEUTRAL_MACROS;
  const offset = G.vox + M.vox;
  let vox = 0, beat = 0;
  if (Number.isFinite(beatLufs) && Number.isFinite(voxLufs)) vox = clamp(beatLufs + offset - voxLufs, -18, 18);
  // combined loudness of two signals at levels a and b (uncorrelated)
  const a = (Number.isFinite(beatLufs) ? beatLufs : -120) + beat, b = (Number.isFinite(voxLufs) ? voxLufs : -120) + vox;
  const total = 10 * Math.log10(10 ** (a / 10) + 10 ** (b / 10));
  const shift = Number.isFinite(total) ? clamp(-16 - total, -30, 30) : 0;
  return { beat: beat + shift, vox: vox + shift, offset };
}

/**
 * Tone match for the master: octave-band EQ moves (half the difference, ±3 dB) from the mix's spectrum to the
 * genre's or the reference's, plus the brightness macro.
 */
export function toneMatch(spectrum, target, macros = NEUTRAL_MACROS) {
  const bands = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const eq = [];
  bands.forEach((f, i) => {
    if (f < 40 || f > 14000) return;
    const d = clamp((target[i] - spectrum[i]) * 0.5, -3, 3);
    if (Math.abs(d) >= 0.4) eq.push({ type: 'peaking', f, q: 1.1, gain: Math.round(d * 10) / 10 });
  });
  if (Math.abs(macros.bright || 0) >= 0.3) eq.push({ type: 'highshelf', f: 8000, gain: clamp(macros.bright * 0.6, -2, 2) });
  return eq;
}

function mergeShelves(eq) {
  for (const type of ['highshelf', 'lowshelf']) {
    const list = eq.filter((e) => e.type === type);
    if (list.length < 2) continue;
    list[0].gain = clamp(list.reduce((s, e) => s + e.gain, 0), -LIMITS.cut, LIMITS.boost);
    for (const e of list.slice(1)) eq.splice(eq.indexOf(e), 1);
  }
}

/** A plain sentence per strip for the mix notes. */
export function describeStrip(name, p, fader) {
  const bits = [];
  if (p.hpf) bits.push(`high-pass ${Math.round(p.hpf)} Hz`);
  const cuts = p.eq.filter((e) => e.gain < -0.4), boosts = p.eq.filter((e) => e.gain > 0.4);
  if (cuts.length) bits.push(`cut ${cuts.map((e) => `${fmtHz(e.f)} ${e.gain.toFixed(1)} dB`).join(', ')}`);
  if (boosts.length) bits.push(`lift ${boosts.map((e) => `${fmtHz(e.f)} +${e.gain.toFixed(1)} dB`).join(', ')}`);
  if (p.comp) bits.push(`compress ${p.comp.ratio}:1${p.comp2 ? ` then ${p.comp2.ratio}:1` : ''}`);
  if (p.deess) bits.push('de-ess');
  if (p.sat) bits.push('saturate');
  if (p.rider) bits.push('ride the level');
  if (p.duck) bits.push('duck under the kick');
  if (Math.abs(p.pan) > 0.05) bits.push(`pan ${Math.round(Math.abs(p.pan) * 100)}% ${p.pan < 0 ? 'left' : 'right'}`);
  if (p.verb && p.verb.send > -40) bits.push(`${p.verb.bus === 'vox' ? 'plate' : 'room'} reverb`);
  if (p.delay) bits.push(`${Math.round(p.delay.time * 1000)} ms delay on the beat`);
  return `${name}: ${bits.join(' · ')}${Number.isFinite(fader) && fader > -100 ? ` · fader ${fader >= 0 ? '+' : ''}${fader.toFixed(1)} dB` : ''}`;
}
export const fmtHz = (f) => (f >= 1000 ? `${(f / 1000).toFixed(f >= 10000 ? 0 : 1).replace(/\.0$/, '')} kHz` : `${Math.round(f)} Hz`);
export { ENV_RATE };
