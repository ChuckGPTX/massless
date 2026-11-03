// Mouth shapes for the talking ad. Pure (no DOM), so tests/lipsync.test.js runs it in Node.
// 1. align(): find the voiced stretches and pauses in the voice's loudness, then spread the script's words over the
//    voiced time by length, splitting at the longest pauses first and preferring punctuation for those splits.
// 2. wordShapes(): turn a word into a rough sequence of mouth shapes with simple English letter rules.
// 3. track() + mouthAt(): place those shapes in time and blend neighbours smoothly (coarticulation).

/** The mouth shapes and how each one looks: open (jaw), wide (spread), round, teeth, tuck (lower lip under teeth), press (lips together). */
export const SHAPES = {
  rest: { open: 0, wide: 1, round: 0, teeth: 0, tuck: 0, press: 0.2 },
  mbp: { open: 0, wide: 0.94, round: 0.05, teeth: 0, tuck: 0, press: 1 },
  fv: { open: 0.13, wide: 1, round: 0, teeth: 1, tuck: 1, press: 0 },
  ai: { open: 0.95, wide: 1.02, round: 0, teeth: 0.55, tuck: 0, press: 0 },
  e: { open: 0.42, wide: 1.16, round: 0, teeth: 0.9, tuck: 0, press: 0 },
  o: { open: 0.62, wide: 0.74, round: 0.85, teeth: 0.2, tuck: 0, press: 0 },
  u: { open: 0.26, wide: 0.6, round: 1, teeth: 0, tuck: 0, press: 0 },
  etc: { open: 0.3, wide: 1.02, round: 0, teeth: 0.8, tuck: 0, press: 0 },
};
export const SHAPE_NAMES = Object.keys(SHAPES);
const KEYS = ['open', 'wide', 'round', 'teeth', 'tuck', 'press'];
// how strongly a shape holds its ground against its neighbours (lips must meet for m/b/p; a, e, o are reached)
const DOMINANCE = { rest: 0.8, mbp: 2.6, fv: 2, ai: 1.2, e: 1, o: 1.2, u: 1.2, etc: 0.45 };
const LENGTH = { rest: 1, mbp: 0.8, fv: 0.8, ai: 1.1, e: 1, o: 1.1, u: 1, etc: 0.55 };

const VOWEL = /[aeiouy]/;
// a few very common words the letter rules get wrong
const EXCEPT = { to: ['etc', 'u'], do: ['etc', 'u'], who: ['u'], two: ['etc', 'u'], into: ['e', 'etc', 'u'], onto: ['o', 'etc', 'u'], you: ['etc', 'u'], your: ['etc', 'o', 'etc'], through: ['etc', 'u'], one: ['u', 'ai', 'etc'], are: ['ai', 'etc'], of: ['ai', 'fv'], was: ['u', 'ai', 'etc'], said: ['etc', 'e', 'etc'] };
/** A word as an ordered list of mouth shapes: [{ s, w }] where w is the relative length. */
export function wordShapes(word) {
  const x = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  const out = [];
  const add = (...names) => { for (const s of names) { const last = out[out.length - 1]; if (last && last.s === s) last.w += LENGTH[s] * 0.5; else out.push({ s, w: LENGTH[s] }); } };
  if (!x) return [{ s: 'etc', w: LENGTH.etc }, { s: 'ai', w: LENGTH.ai }]; // numbers and symbols: something gets said
  if (EXCEPT[x]) { add(...EXCEPT[x]); return out; }
  const cons = (c) => c && !VOWEL.test(c);
  for (let i = 0; i < x.length;) {
    const c = x[i], n = x[i + 1] || '', two = c + n, three = two + (x[i + 2] || '');
    if (three === 'tch') { add('etc'); i += 3; continue; }
    if (three === 'igh') { add('ai', 'e'); i += 3; continue; }
    if (x.startsWith('ough', i)) { add('o'); i += 4; continue; }
    if (two === 'ph') { add('fv'); i += 2; continue; }
    if (two === 'wh') { add('u'); i += 2; continue; }
    if (two === 'qu') { add('etc', 'u'); i += 2; continue; }
    if (['th', 'sh', 'ch', 'ck', 'ng', 'gh'].includes(two)) { if (two !== 'gh') add('etc'); i += 2; continue; }
    if (['ee', 'ea', 'ie', 'ei', 'ey'].includes(two)) { add('e'); i += 2; continue; }
    if (two === 'oo' || two === 'ue' || two === 'ew') { add('u'); i += 2; continue; }
    if (two === 'ou') { add('ai', 'u'); i += 2; continue; }
    if (two === 'ow') { add('o', 'u'); i += 2; continue; }
    if (two === 'oa') { add('o'); i += 2; continue; }
    if (two === 'oi' || two === 'oy') { add('o', 'e'); i += 2; continue; }
    if (two === 'ai' || two === 'ay') { add('e'); i += 2; continue; }
    if (two === 'au' || two === 'aw') { add('o'); i += 2; continue; }
    if (n === c && !VOWEL.test(c)) { i += 1; continue; } // doubled consonant: say it once
    // silent final e after a consonant (make, time, home)
    if (c === 'e' && i === x.length - 1 && cons(x[i - 1]) && VOWEL.test(x.slice(0, i - 1))) { i += 1; continue; }
    // vowel, one consonant, final e: the long vowel (time, use)
    const longV = cons(n) && x[i + 2] === 'e' && i + 3 === x.length;
    if (c === 'a') add(longV ? 'e' : 'ai');
    else if (c === 'e') add('e');
    else if (c === 'i') longV || (i === x.length - 1 && x.length <= 3) ? add('ai', 'e') : add('e');
    else if (c === 'o') add('o');
    else if (c === 'u') add(longV ? 'u' : 'ai');
    else if (c === 'y') { if (i === 0) add('etc'); else if (i === x.length - 1 && x.length <= 3) add('ai', 'e'); else add('e'); }
    else if ('mbp'.includes(c)) add('mbp');
    else if ('fv'.includes(c)) add('fv');
    else if (c === 'w') add('u');
    else if (c === 'r') add(i === 0 ? 'u' : 'etc');
    else if (c === 'h') { /* breath: the next vowel takes over */ }
    else add('etc');
    i += 1;
  }
  if (!out.length) add('etc');
  return out;
}

const PUNCT = (w) => (/[.!?]["')\]]*$/.test(w) ? 1 : /[;:]["')\]]*$/.test(w) ? 0.8 : /,["')\]]*$/.test(w) ? 0.6 : /[-–—]$/.test(w) ? 0.4 : 0);
const weightOf = (w) => w.replace(/[^\p{L}\p{N}]/gu, '').length + 1;

/** Voiced stretches and pauses in a loudness envelope (one value per frame, 0..1). */
export function voicedSpans(env, fps, { thr = 0.08, minGap = 0.1, minRun = 0.06 } = {}) {
  const n = env.length, on = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const v = ((env[i - 1] ?? env[i]) + env[i] * 2 + (env[i + 1] ?? env[i])) / 4; on[i] = v > thr ? 1 : 0; }
  let runs = [];
  for (let i = 0; i < n;) { if (!on[i]) { i++; continue; } let j = i; while (j < n && on[j]) j++; runs.push([i, j]); i = j; }
  // short dips inside a word (a stop like t or k) are not pauses
  const merged = [];
  for (const r of runs) { const last = merged[merged.length - 1]; if (last && (r[0] - last[1]) / fps < minGap) last[1] = r[1]; else merged.push([...r]); }
  runs = merged.filter((r) => (r[1] - r[0]) / fps >= minRun);
  const spans = runs.map(([a, b]) => ({ t0: a / fps, t1: b / fps }));
  const pauses = [];
  for (let i = 1; i < spans.length; i++) pauses.push({ t0: spans[i - 1].t1, t1: spans[i].t0, after: i - 1 });
  return { spans, pauses };
}

/** Spread words over voiced time by their weights: [{ w, t0, t1 }]. */
function spread(words, spans) {
  const total = spans.reduce((a, s) => a + s.t1 - s.t0, 0);
  const W = words.reduce((a, w) => a + weightOf(w), 0) || 1;
  // voiced-clock position -> real time
  const at = (v) => {
    for (const s of spans) { const d = s.t1 - s.t0; if (v <= d + 1e-9) return s.t0 + Math.max(0, v); v -= d; }
    return spans[spans.length - 1].t1;
  };
  let acc = 0;
  return words.map((w) => { const a = (acc / W) * total; acc += weightOf(w); const b = (acc / W) * total; return { w, t0: at(a), t1: at(b) }; });
}

/** Align the script's words to the voice. env: loudness per frame (0..1) at fps. */
export function align(words, env, fps) {
  if (!words.length) return [];
  const { spans } = voicedSpans(env, fps);
  if (!spans.length) return fallbackTimings(words, Math.max(0.5, env.length / fps));
  const place = (ws, sp) => {
    if (ws.length === 1 || sp.length === 1) return spread(ws, sp);
    // try the internal pauses from the longest down; split the words there if it fits their lengths
    const gaps = [];
    for (let i = 1; i < sp.length; i++) gaps.push({ i, d: sp[i].t0 - sp[i - 1].t1 });
    gaps.sort((a, b) => b.d - a.d);
    const V = sp.reduce((a, s) => a + s.t1 - s.t0, 0);
    const W = ws.reduce((a, w) => a + weightOf(w), 0);
    for (const g of gaps) {
      if (g.d < 0.12) break;
      let before = 0;
      for (let i = 0; i < g.i; i++) before += sp[i].t1 - sp[i].t0;
      const f = before / V;
      let best = -1, bestScore = Infinity, bestErr = 1, cum = 0;
      for (let k = 1; k < ws.length; k++) {
        cum += weightOf(ws[k - 1]);
        const err = Math.abs(cum / W - f), score = err - 0.14 * PUNCT(ws[k - 1]);
        if (score < bestScore) { bestScore = score; best = k; bestErr = err; }
      }
      if (best > 0 && bestErr < 0.3) return [...place(ws.slice(0, best), sp.slice(0, g.i)), ...place(ws.slice(best), sp.slice(g.i))];
    }
    return spread(ws, sp);
  };
  return place(words, spans);
}

/** Without a voice yet: words by length, with short rests at punctuation, starting at 0.15 s over `length` seconds. */
export function fallbackTimings(words, length) {
  const rest = words.map((w, i) => (i < words.length - 1 ? PUNCT(w) * 0.42 : 0));
  const R = rest.reduce((a, b) => a + b, 0);
  const W = words.reduce((a, w) => a + weightOf(w), 0) || 1;
  const talk = Math.max(0.2, length - 0.25 - R);
  let t = 0.15;
  return words.map((w, i) => { const d = (weightOf(w) / W) * talk; const r = { w, t0: t, t1: t + d }; t += d + rest[i]; return r; });
}

/** Mouth-shape keys in time: [{ s, c (centre), d (length), sig, dom }], sorted by centre. */
export function track(timings) {
  const keys = [];
  const push = (s, t0, t1) => keys.push({ s, c: (t0 + t1) / 2, d: t1 - t0, sig: Math.max(0.035, 0.55 * (t1 - t0)), dom: DOMINANCE[s] });
  let prev = 0;
  for (const tw of timings) {
    if (tw.t0 - prev > 0.12) push('rest', prev + 0.03, tw.t0 - 0.03);
    const shapes = wordShapes(tw.w), W = shapes.reduce((a, x) => a + x.w, 0);
    let t = tw.t0;
    for (const x of shapes) { const d = ((tw.t1 - tw.t0) * x.w) / W; push(x.s, t, t + d); t += d; }
    prev = tw.t1;
  }
  push('rest', prev + 0.05, prev + 1.5);
  return keys.sort((a, b) => a.c - b.c);
}

/** The blended mouth at time t: { open, wide, round, teeth, tuck, press }. */
export function mouthAt(keys, t) {
  const out = { ...SHAPES.rest };
  if (!keys.length) return out;
  let lo = 0, hi = keys.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (keys[m].c < t) lo = m + 1; else hi = m; }
  let sum = 1e-4;
  const acc = Object.fromEntries(KEYS.map((k) => [k, SHAPES.rest[k] * 1e-4]));
  let close = 0, tuck = 0;
  for (let i = Math.max(0, lo - 6); i < Math.min(keys.length, lo + 6); i++) {
    const k = keys[i], z = (t - k.c) / k.sig, wgt = k.dom * Math.exp(-z * z);
    if (wgt < 1e-5) continue;
    const sh = SHAPES[k.s];
    for (const p of KEYS) acc[p] += sh[p] * wgt;
    sum += wgt;
    // lips really meet for m, b, p and the lip really tucks for f, v: a flat-topped bump around the key
    const y = (t - k.c) / Math.max(0.03, k.d * 0.5);
    if (k.s === 'mbp') close = Math.max(close, Math.exp(-(y ** 4)));
    if (k.s === 'fv') tuck = Math.max(tuck, Math.exp(-(y ** 4)));
  }
  for (const p of KEYS) out[p] = acc[p] / sum;
  out.open *= 1 - close;
  out.press = Math.max(out.press, close);
  out.tuck = Math.max(out.tuck, tuck);
  if (tuck > out.open) { out.open = out.open * (1 - tuck) + SHAPES.fv.open * tuck; out.teeth = Math.max(out.teeth, tuck); }
  return out;
}

/** Loudness envelope (per frame, 0..1) from mono samples. */
export function envelope(mono, rate, fps) {
  const per = rate / fps, n = Math.ceil(mono.length / per), env = new Float32Array(n);
  let peak = 1e-4;
  for (let i = 0; i < n; i++) { let s = 0; const a = Math.floor(i * per), b = Math.min(mono.length, Math.floor((i + 1) * per)); for (let j = a; j < b; j++) s += mono[j] * mono[j]; env[i] = Math.sqrt(s / Math.max(1, b - a)); peak = Math.max(peak, env[i]); }
  for (let i = 0; i < n; i++) env[i] = Math.min(1, Math.max(0, (env[i] / peak - 0.08) * 1.4));
  return env;
}
