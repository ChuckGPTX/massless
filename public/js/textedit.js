// Edit by text for Massless: the pure logic behind cutting media by editing its transcript.
// Words come from Whisper (word timings per segment). The visitor's edits are a small state, never media:
//   { struck: Set<word index>, caps: Map<gap index, seconds> }
// compile() turns words + state into keep ranges in source seconds; snapCuts() moves every cut edge to the
// quietest point near it; renderEdit() joins the kept audio with short equal-power crossfades (no clicks);
// mapping helpers re-time words and captions to the edited timeline. Nothing here touches the DOM or the
// network, so the same functions run in the page, a worker and the Node tests.

export const SNAP_WINDOW = 0.08; // seconds either side of a word edge where a cut may move
export const FADE = 0.008; // crossfade at each join, seconds
const MIN_KEEP = 0.01; // keep ranges shorter than this are dropped

const PUNCT = /[\s.,!?;:'"“”‘’«»()[\]{}…—–-]+/g;
/** Lower case with punctuation and spaces removed: "Um," -> "um". */
export const normWord = (t) => String(t || '').toLowerCase().replace(PUNCT, '');

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

/**
 * One flat list of words from transcript segments: [{ i, text, s, e, seg, low? , approx? }].
 * Segments with word timings use them; segments without get their words spread over the segment by length
 * (marked approx). text keeps Whisper's leading space, which marks a word boundary.
 */
export function wordsFromSegments(segments) {
  const out = [];
  segments.forEach((seg, k) => {
    const low = Number.isFinite(seg.avg_logprob) && seg.avg_logprob < -1;
    const ws = (seg.words || []).filter((w) => String(w.text ?? w.word ?? '').trim());
    if (ws.length) {
      for (const w of ws) {
        const s = Number(w.start);
        const e = Math.max(s, Number(w.end));
        if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
        out.push({ i: out.length, text: String(w.text ?? w.word), s, e, seg: k, ...(low ? { low: true } : {}) });
      }
      return;
    }
    const toks = String(seg.text || '').trim().split(/\s+/).filter(Boolean);
    const weight = toks.reduce((a, t) => a + t.length + 1, 0) || 1;
    const span = Math.max(0, seg.end - seg.start);
    let t = seg.start;
    for (const tok of toks) {
      const d = (span * (tok.length + 1)) / weight;
      out.push({ i: out.length, text: ` ${tok}`, s: t, e: t + d * 0.9, seg: k, approx: true, ...(low ? { low: true } : {}) });
      t += d;
    }
  });
  // Whisper sometimes lets a word end after the next one starts; make the list monotonic.
  for (let i = 1; i < out.length; i++) {
    if (out[i].s < out[i - 1].s) out[i].s = out[i - 1].s;
    if (out[i - 1].e > out[i].s) out[i - 1].e = Math.max(out[i - 1].s, out[i].s);
    if (out[i].e < out[i].s) out[i].e = out[i].s;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Detection: fillers, repeats, pauses
// ---------------------------------------------------------------------------------------------

// Per language: `always` are sounds that are fillers wherever they appear; `soft` are real words that are only
// fillers when set off by a pause or a comma on both sides ("it was, like, huge" but not "I like it").
// Phrases are written with spaces and matched word by word. English first; the rest are starting points.
export const FILLERS = {
  en: { always: ['um', 'umm', 'uhm', 'uh', 'uhh', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm'], soft: ['like', 'you know', 'i mean', 'sort of', 'kind of'] },
  es: { always: ['eh', 'ehm', 'em', 'mmm', 'ah'], soft: ['este', 'o sea', 'pues', 'bueno', 'sabes'] },
  fr: { always: ['euh', 'heu', 'hum', 'bah', 'ben'], soft: ['genre', 'tu vois', 'en fait', 'bon'] },
  de: { always: ['äh', 'ähm', 'äm', 'öh', 'hm', 'hmm'], soft: ['also', 'halt', 'quasi', 'sozusagen'] },
  it: { always: ['ehm', 'eh', 'mmm', 'uhm'], soft: ['cioè', 'tipo', 'allora', 'insomma'] },
  pt: { always: ['ahn', 'hum', 'éh', 'ah'], soft: ['tipo', 'né', 'então', 'sabe'] },
  nl: { always: ['eh', 'ehm', 'uh', 'uhm', 'hm'], soft: ['zeg maar', 'eigenlijk', 'nou'] },
};

/** A short disfluent sentence for Whisper's initial_prompt, so it writes the fillers down instead of dropping them. */
export const VERBATIM_PROMPTS = {
  en: 'Umm, so, uh, I was like, you know, thinking... Hmm, okay. I I mean, uh, yeah.',
  es: 'Eh, bueno, este... o sea, mmm, pues, ¿sabes? Eh, sí.',
  fr: 'Euh, bon, alors... en fait, hum, tu vois, euh, voilà.',
  de: 'Äh, also, ähm... halt so, hm, weißt du, äh, ja.',
  it: 'Ehm, allora, cioè... tipo, mmm, sai, eh, sì.',
  pt: 'Ahn, então, tipo... né, hum, sabe, éh, isso.',
  nl: 'Eh, nou, ehm... zeg maar, uh, weet je, ja.',
};

const CLAUSE_END = /[,;:…—–]$|\.\.\.$/;
const SENTENCE_END = /[.!?。！？]["'”’)\]]*$/;
const PAUSE = 0.15; // a gap this long sets a soft filler off like a comma

/** Words to detection items. Each item: { kind, from, to, s, e, text, tight? } (word index range, inclusive). */
export function detectFillers(words, lang = 'en') {
  const L = FILLERS[lang] || FILLERS.en;
  const always = new Set(L.always);
  const soft = L.soft.map((p) => p.split(' '));
  const n = words.map((w) => normWord(w.text));
  const isAlways = (i) => i >= 0 && i < words.length && always.has(n[i]);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (isAlways(i)) {
      out.push(item('filler', words, i, i));
      continue;
    }
    for (const p of soft) {
      if (p.some((tok, k) => n[i + k] !== tok)) continue;
      const j = i + p.length - 1;
      const raw = (k) => String(words[k].text).trim();
      const before = i === 0 || SENTENCE_END.test(raw(i - 1)) || CLAUSE_END.test(raw(i - 1)) || words[i].s - words[i - 1].e >= PAUSE || isAlways(i - 1);
      const after = j === words.length - 1 || CLAUSE_END.test(raw(j)) || SENTENCE_END.test(raw(j)) || words[j + 1].s - words[j].e >= PAUSE || isAlways(j + 1);
      // at the very start or end of a sentence a soft word needs a clear break on its other side
      if (before && after && !(i === 0 && j === words.length - 1)) {
        out.push(item('filler', words, i, j));
        i = j;
        break;
      }
    }
  }
  return out;
}

// doubled words that are usually meant ("had had", "very very", "no no")
const LEGIT_DOUBLES = new Set(['had', 'that', 'very', 'really', 'no', 'yeah', 'yes', 'bye', 'ha', 'haha', 'so', 'well', 'go', 'knock', 'many', 'more', 'far']);

/** Stutters and repeated words or short phrases: "I I think", "the the", "th- the", "I think I think". Marks the first copy. */
export function detectRepeats(words) {
  const n = words.map((w) => normWord(w.text));
  const out = [];
  const taken = new Uint8Array(words.length);
  for (let i = 0; i < words.length - 1; i++) {
    if (taken[i] || !n[i]) continue;
    const raw = String(words[i].text).trim();
    // a cut-off word: "th-" followed by "the"
    if (/[-—–]$/.test(raw) && n[i + 1].startsWith(n[i]) && n[i].length < n[i + 1].length) {
      out.push(item('repeat', words, i, i));
      taken[i] = 1;
      continue;
    }
    // repeated phrases of three, then two words
    let hit = false;
    for (const k of [3, 2]) {
      if (i + 2 * k > words.length) continue;
      let same = true;
      for (let m = 0; m < k && same; m++) same = n[i + m] && n[i + m] === n[i + k + m];
      if (!same) continue;
      // a sentence break between the copies means it was said twice on purpose
      if (SENTENCE_END.test(String(words[i + k - 1].text).trim())) continue;
      out.push(item('repeat', words, i, i + k - 1));
      for (let m = 0; m < k; m++) taken[i + m] = 1;
      i += k - 1;
      hit = true;
      break;
    }
    if (hit) continue;
    if (n[i] === n[i + 1] && !LEGIT_DOUBLES.has(n[i]) && !SENTENCE_END.test(raw)) {
      out.push(item('repeat', words, i, i));
      taken[i] = 1;
    }
  }
  return out;
}

function item(kind, words, from, to) {
  return { kind, from, to, s: words[from].s, e: words[to].e, text: words.slice(from, to + 1).map((w) => String(w.text).trim()).join(' ') };
}

/**
 * Gaps between words (and before the first / after the last) longer than `over` seconds.
 * Gap index g sits after word g (g = -1 is the lead-in, g = words.length - 1 the tail).
 * Returns [{ kind: 'pause', gap, s, e, len }].
 */
export function detectPauses(words, duration, { over = 0.5, minSave = 0.05 } = {}) {
  const out = [];
  for (let g = -1; g < words.length; g++) {
    const s = g < 0 ? 0 : words[g].e;
    const e = g + 1 < words.length ? words[g + 1].s : duration;
    const len = e - s;
    if (len > over + minSave) out.push({ kind: 'pause', gap: g, s, e, len });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Energy: quiet points, fillers that cannot be cut cleanly, sound inside "silent" gaps
// ---------------------------------------------------------------------------------------------

/** RMS envelope of mono samples: one value per `hop` seconds over a `win`-second window centred on it. */
export function rmsFrames(x, rate, { hop = 0.0025, win = 0.02 } = {}) {
  const h = Math.max(1, Math.round(hop * rate));
  const w = Math.max(1, Math.round(win * rate));
  const n = Math.ceil(x.length / h);
  const out = new Float32Array(n);
  // running sum of squares
  const cs = new Float64Array(x.length + 1);
  for (let i = 0; i < x.length; i++) cs[i + 1] = cs[i] + x[i] * x[i];
  for (let k = 0; k < n; k++) {
    const c = k * h;
    const a = Math.max(0, c - (w >> 1));
    const b = Math.min(x.length, a + w);
    out[k] = b > a ? Math.sqrt((cs[b] - cs[a]) / (b - a)) : 0;
  }
  return { rms: out, hop: h / rate };
}

/** A typical speaking level: the median RMS inside words. */
export function speechLevel(env, words) {
  const vals = [];
  for (const w of words) {
    for (let k = Math.floor(w.s / env.hop); k < Math.ceil(w.e / env.hop) && k < env.rms.length; k += 4) vals.push(env.rms[k]);
  }
  if (!vals.length) return 0;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

/** The quietest moment in [lo, hi] near t: minimum of rms * (1 + distance / window), so ties stay put. */
export function quietestNear(env, t, lo, hi, win = SNAP_WINDOW) {
  const { rms, hop } = env;
  let best = t;
  let bestCost = Infinity;
  const a = Math.max(0, Math.ceil(Math.max(lo, t - win) / hop));
  const b = Math.min(rms.length - 1, Math.floor(Math.min(hi, t + win) / hop));
  for (let k = a; k <= b; k++) {
    const c = k * hop;
    const cost = rms[k] * (1 + Math.abs(c - t) / win) + 1e-9 * Math.abs(c - t);
    if (cost < bestCost) { bestCost = cost; best = c; }
  }
  return { t: bestCost === Infinity ? t : best, level: bestCost === Infinity ? 0 : rms[Math.round(best / hop)] || 0 };
}

/** Mark fillers whose edges have no quiet moment nearby: cutting them would chop the next word. */
export function markTight(items, env, words, { ratio = 0.3 } = {}) {
  const ref = speechLevel(env, words) || 1e-9;
  for (const it of items) {
    const prev = it.from > 0 ? words[it.from - 1] : null;
    const next = it.to + 1 < words.length ? words[it.to + 1] : null;
    const a = quietestNear(env, it.s, prev ? prev.s : 0, it.e);
    const b = quietestNear(env, it.e, it.s, next ? next.e : Infinity);
    it.tight = a.level > ref * ratio || b.level > ref * ratio;
  }
  return items;
}

/**
 * Flag pauses that hold sound loud enough to be speech Whisper left out (a dropped "um", a laugh, a word):
 * at least `minRun` seconds above max(noise floor x 3, speech level / 10), ignoring the word tails at each end.
 */
export function markSpeechInPauses(pauses, env, words, { minRun = 0.15, edge = 0.06 } = {}) {
  const { rms, hop } = env;
  const sorted = Float32Array.from(rms).sort();
  const floor = sorted[Math.floor(sorted.length * 0.1)] || 0;
  const thr = Math.max(floor * 3, speechLevel(env, words) * 0.1, 1e-4);
  for (const p of pauses) {
    let run = 0;
    let best = 0;
    for (let k = Math.ceil((p.s + edge) / hop); k * hop < p.e - edge && k < rms.length; k++) {
      run = rms[k] > thr ? run + 1 : 0;
      if (run > best) best = run;
    }
    p.speech = best * hop >= minRun;
  }
  return pauses;
}

// ---------------------------------------------------------------------------------------------
// Compile: words + edit state -> keep ranges in source seconds
// ---------------------------------------------------------------------------------------------

export function emptyState() {
  return { struck: new Set(), caps: new Map() };
}
export function cloneState(st) {
  return { struck: new Set(st.struck), caps: new Map(st.caps) };
}
export function stateKey(st) {
  return `${[...st.struck].sort((a, b) => a - b).join(',')}|${[...st.caps].sort((a, b) => a[0] - b[0]).map(([g, c]) => `${g}:${c}`).join(',')}`;
}

/**
 * Keep ranges [[a, b], ...] in source seconds.
 * Between two kept words (or the file's start / end) lies a stretch of silences and struck words. Struck words
 * go; of the silences, only the pieces touching the kept words can stay, and the pause that remains is as long
 * as the longer of those two (so deleting a word never leaves a rushed join), shortened to the gap's cap if set.
 */
export function compile(words, state, duration) {
  const kept = [];
  for (let i = 0; i < words.length; i++) if (!state.struck.has(i)) kept.push(i);
  const removed = [];
  const capOf = (g) => (state.caps.has(g) ? state.caps.get(g) : Infinity);
  // junctions: before the first kept word, between kept words, after the last kept word
  const bounds = [-1, ...kept, words.length];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a = bounds[k];
    const b = bounds[k + 1];
    const ae = a < 0 ? 0 : words[a].e;
    const bs = b >= words.length ? duration : words[b].s;
    if (bs <= ae) continue;
    let cap = Infinity;
    for (let g = a; g < b; g++) cap = Math.min(cap, capOf(g));
    if (b === a + 1) {
      // a plain gap between two kept words: shorten from the middle
      const len = bs - ae;
      if (len > cap) removed.push([ae + cap / 2, bs - cap / 2]);
      continue;
    }
    // struck words a+1 .. b-1
    const sl = Math.max(0, words[a + 1].s - ae); // the silence after the kept word on the left
    const sr = Math.max(0, bs - words[b - 1].e); // and before the one on the right
    let L = Math.min(Math.max(sl, sr), cap);
    // at the file's edges keep only what touches the edge
    if (a < 0) L = Math.min(sr, cap);
    if (b >= words.length) L = Math.min(sl, cap);
    let first = Math.min(sl, L / 2);
    const second = Math.min(sr, L - first);
    if (second < L - first) first = Math.min(sl, L - second);
    if (a < 0) first = 0;
    if (b >= words.length) first = Math.min(sl, L);
    const x = ae + first;
    const y = b >= words.length ? duration : bs - (a < 0 ? L : second);
    if (y > x) removed.push([x, y]);
  }
  return complement(removed, duration);
}

/** [0, duration] minus the removed ranges, merged, without slivers. */
export function complement(removed, duration) {
  const r = removed.map(([a, b]) => [Math.max(0, a), Math.min(duration, b)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const keep = [];
  let t = 0;
  for (const [a, b] of r) {
    if (a > t) keep.push([t, a]);
    t = Math.max(t, b);
  }
  if (duration > t) keep.push([t, duration]);
  return keep.filter(([a, b]) => b - a >= MIN_KEEP);
}

/**
 * Move each cut edge to the quietest moment within SNAP_WINDOW of it (on an RMS envelope from rmsFrames), never
 * past the neighbouring edges. The file's own start and end are not cuts and stay put. Cuts that close up are dropped.
 */
export function snapCuts(keep, env, duration, { win = SNAP_WINDOW, guard = 0.01 } = {}) {
  const out = keep.map((r) => r.slice());
  for (let k = 0; k < out.length; k++) {
    const r = out[k];
    if (r[0] > 1e-6) r[0] = quietestNear(env, r[0], (k > 0 ? out[k - 1][1] : 0) + guard, r[1] - guard, win).t;
    if (r[1] < duration - 1e-6) r[1] = quietestNear(env, r[1], r[0] + guard, k + 1 < keep.length ? keep[k + 1][1] - guard : duration, win).t;
  }
  const merged = [];
  for (const r of out) {
    if (merged.length && r[0] <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(merged.at(-1)[1], r[1]);
    else merged.push(r);
  }
  return merged.filter(([a, b]) => b - a >= MIN_KEEP);
}

export const keptLength = (keep) => keep.reduce((a, [s, e]) => a + (e - s), 0);

// ---------------------------------------------------------------------------------------------
// Time mapping
// ---------------------------------------------------------------------------------------------

/** Source time -> edited time. A time inside a removed stretch maps to the join where it was removed. */
export function srcToOut(t, keep) {
  let acc = 0;
  for (const [a, b] of keep) {
    if (t < a) return acc;
    if (t <= b) return acc + (t - a);
    acc += b - a;
  }
  return acc;
}

/** Edited time -> source time. */
export function outToSrc(t, keep) {
  let acc = 0;
  for (const [a, b] of keep) {
    const len = b - a;
    if (t < acc + len) return a + Math.max(0, t - acc);
    acc += len;
  }
  return keep.length ? keep.at(-1)[1] : 0;
}

/** Kept words with edited times: [{ ...word, os, oe }]. A word cut in part keeps what is left. */
export function retimeWords(words, keep, state) {
  const out = [];
  for (const w of words) {
    if (state?.struck.has(w.i)) continue;
    const os = srcToOut(w.s, keep);
    const oe = srcToOut(w.e, keep);
    if (oe - os <= 0.001 && w.e - w.s > 0.001) continue; // removed entirely by a cut
    out.push({ ...w, os, oe });
  }
  return out;
}

/** Transcript segments on the edited timeline, with word timings, ready for buildCues() in transcribe.js. */
export function editedSegments(words, keep, state) {
  const segs = new Map();
  for (const w of retimeWords(words, keep, state)) {
    if (!segs.has(w.seg)) segs.set(w.seg, []);
    segs.get(w.seg).push(w);
  }
  return [...segs.values()].map((ws) => ({
    start: ws[0].os,
    end: ws.at(-1).oe,
    text: ws.map((w) => w.text).join('').trim(),
    words: ws.map((w) => ({ text: w.text, start: w.os, end: w.oe })),
  }));
}

/** Caption cues in source time ({ start, end, text }) moved to the edited timeline; cues cut away are dropped. */
export function retimeCues(cues, keep, { min = 0.2 } = {}) {
  return cues.map((c) => ({ ...c, start: srcToOut(c.start, keep), end: srcToOut(c.end, keep) })).filter((c) => c.end - c.start >= min);
}

// ---------------------------------------------------------------------------------------------
// Rendering: kept audio joined with equal-power crossfades
// ---------------------------------------------------------------------------------------------

/** Kept ranges in whole frames at `rate`, with where each starts in the output. */
export function keepFrames(keep, rate) {
  let o = 0;
  return keep.map(([a, b]) => {
    const s = Math.round(a * rate);
    const e = Math.max(s, Math.round(b * rate));
    const r = { s, e, o };
    o += e - s;
    return r;
  });
}

/**
 * Edited audio, output frames [from, to). channels: planar Float32Arrays at `rate`.
 * Every join crossfades over `fade` seconds centred on the cut (half from the material either side), so the
 * output is exactly as long as the kept ranges and no edge jumps. Cuts at the file's own start or end get a
 * short fade instead. Returns planar Float32Arrays of length to - from.
 */
export function renderEdit(channels, rate, keep, { from = 0, to = Infinity, fade = FADE } = {}) {
  const fr = keepFrames(keep, rate);
  const total = fr.length ? fr.at(-1).o + fr.at(-1).e - fr.at(-1).s : 0;
  to = Math.min(to, total);
  from = Math.max(0, Math.min(from, to));
  const n = to - from;
  const N = channels[0]?.length || 0;
  const H = Math.max(1, Math.round((fade * rate) / 2)); // half the crossfade
  const out = channels.map(() => new Float32Array(n));
  // which ranges overlap [from, to)
  let k = 0;
  while (k < fr.length && fr[k].o + (fr[k].e - fr[k].s) <= from) k++;
  for (; k < fr.length && fr[k].o < to; k++) {
    const r = fr[k];
    const len = r.e - r.s;
    const a = Math.max(from, r.o) - r.o;
    const b = Math.min(to, r.o + len) - r.o;
    for (let c = 0; c < channels.length; c++) {
      const x = channels[c];
      const y = out[c];
      for (let i = a; i < b; i++) y[r.o + i - from] = x[r.s + i];
    }
  }
  // joins: around each output join point J between range j-1 (ends at source e1) and range j (starts at s2):
  // out[J + t] = A(e1 + t) * cos + B(s2 + t) * sin for t in [-H, H)
  for (let j = 1; j < fr.length; j++) {
    const prev = fr[j - 1];
    const next = fr[j];
    const J = next.o;
    if (J + H <= from || J - H >= to) continue;
    for (let t = -H; t < H; t++) {
      const oi = J + t;
      if (oi < from || oi >= to || oi < 0 || oi >= total) continue;
      const p = (t + H + 0.5) / (2 * H); // 0..1 across the fade
      const gOut = Math.cos((p * Math.PI) / 2);
      const gIn = Math.sin((p * Math.PI) / 2);
      for (let c = 0; c < channels.length; c++) {
        const x = channels[c];
        out[c][oi - from] = (x[prev.e + t] || 0) * gOut + (x[next.s + t] || 0) * gIn;
      }
    }
  }
  // the file's own start or end was cut: fade in or out over the same length
  const F = 2 * H;
  if (fr.length && fr[0].s > 0) {
    for (let i = Math.max(0, from); i < Math.min(F, to); i++) {
      const g = Math.sin((((i + 0.5) / F) * Math.PI) / 2);
      for (const y of out) y[i - from] *= g;
    }
  }
  if (fr.length && fr.at(-1).e < N) {
    for (let i = Math.max(total - F, from); i < to; i++) {
      const g = Math.sin((((total - i - 0.5) / F) * Math.PI) / 2);
      for (const y of out) y[i - from] *= g;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Edit decision list
// ---------------------------------------------------------------------------------------------

const tc = (t, fps) => {
  const f = Math.round(t * fps);
  const ff = f % fps;
  const s = Math.floor(f / fps);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, ff].map((v) => String(v).padStart(2, '0')).join(':');
};

/** CMX 3600 edit list of the kept ranges (frame-rounded timecode) for any editor that reads EDLs. */
export function toEdl(keep, { title = 'Massless edit', clip = 'source', fps = 30 } = {}) {
  const lines = [`TITLE: ${title.replace(/[\r\n]/g, ' ').slice(0, 70)}`, 'FCM: NON-DROP FRAME', ''];
  let rec = 0;
  keep.forEach(([a, b], k) => {
    lines.push(`${String(k + 1).padStart(3, '0')}  AX       AA/V  C        ${tc(a, fps)} ${tc(b, fps)} ${tc(rec, fps)} ${tc(rec + b - a, fps)}`);
    lines.push(`* FROM CLIP NAME: ${clip.replace(/[\r\n]/g, ' ').slice(0, 120)}`);
    lines.push('');
    rec += b - a;
  });
  return `${lines.join('\n')}\n`;
}

/** The same edit as JSON: source ranges in seconds, plus what was removed and why. */
export function toEditJson({ name, duration, words, state, keep }) {
  return {
    v: 1,
    kind: 'edit',
    source: { name, duration },
    keep: keep.map(([a, b]) => [round3(a), round3(b)]),
    struck: [...state.struck].sort((a, b) => a - b).map((i) => ({ i, t: String(words[i]?.text || '').trim(), s: round3(words[i]?.s), e: round3(words[i]?.e) })),
    caps: [...state.caps].map(([gap, to]) => ({ gap, to })),
    length: round3(keptLength(keep)),
  };
}
const round3 = (t) => Math.round(t * 1000) / 1000;
