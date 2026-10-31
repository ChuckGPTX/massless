// Captions for Chucksi: speech to text with Whisper large-v3-turbo (MIT) on Cloudflare Workers AI.
// The file is decoded in the browser, downmixed to mono and resampled to 16 kHz, then sent as a small
// 16-bit WAV (32 KB per second) only when the visitor presses Transcribe. Long files go in parts and the
// timestamps are shifted back into place. Captions are rebuilt from the segments as sentence-level cues.

import { encodeWav, decodeToMono } from './audio-engine.js';
import { apiFetch } from './human.js';

export const ASR_RATE = 16000;
export const BYTES_PER_SECOND = ASR_RATE * 2;
export const MAX_SINGLE_BYTES = 18e6; // ~9.4 minutes in one request (the server takes up to 20 MB)
export const MAX_PART_SECONDS = 8 * 60;
export const MAX_SECONDS = 60 * 60;
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;
export const ASR_MODEL = 'Whisper large-v3-turbo';

export const ASR_LANGS = [
  ['', 'Auto-detect'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['nl', 'Dutch'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['ko', 'Korean'], ['hi', 'Hindi'],
  ['ar', 'Arabic'], ['ru', 'Russian'], ['tr', 'Turkish'], ['pl', 'Polish'],
];

/**
 * Decode an audio or video file to 16 kHz mono and plan the upload parts.
 * Returns { samples, duration, parts: [{ start, end }] } with times in seconds.
 */
export async function prepareAudio(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is over 1 GB. Export the audio track first.');
  let samples;
  try {
    samples = await decodeToMono(await file.arrayBuffer(), ASR_RATE);
  } catch {
    throw new Error('This browser could not read audio from that file. Try mp3, wav, m4a, mp4 or webm.');
  }
  const duration = samples.length / ASR_RATE;
  if (duration < 0.5) throw new Error('That file has less than half a second of audio.');
  if (duration > MAX_SECONDS) throw new Error('That file is over 60 minutes. Trim it and try again.');
  return { samples, duration, parts: planParts(samples) };
}

/** Split into parts of at most MAX_PART_SECONDS when one WAV would be too big, cutting at quiet moments. */
export function planParts(samples, rate = ASR_RATE) {
  const total = samples.length;
  if (44 + total * 2 <= MAX_SINGLE_BYTES) return [{ start: 0, end: total / rate }];
  const n = Math.ceil(total / (MAX_PART_SECONDS * rate));
  const ideal = total / n;
  const parts = [];
  let a = 0;
  for (let k = 1; k < n; k++) {
    const target = Math.round(k * ideal);
    const cut = quietestNear(samples, Math.max(a + rate, target - 10 * rate), Math.min(target, a + MAX_PART_SECONDS * rate), rate);
    parts.push({ start: a / rate, end: cut / rate });
    a = cut;
  }
  parts.push({ start: a / rate, end: total / rate });
  return parts;
}

/** The start of the quietest 100 ms window in [lo, hi). */
function quietestNear(x, lo, hi, rate) {
  const win = Math.round(rate / 10);
  let best = hi;
  let bestE = Infinity;
  for (let i = lo; i + win <= hi; i += win) {
    let e = 0;
    for (let j = i; j < i + win; j += 4) e += x[j] * x[j];
    if (e < bestE) { bestE = e; best = i; }
  }
  return best;
}

export function partWav(samples, part, rate = ASR_RATE) {
  return encodeWav([samples.subarray(Math.round(part.start * rate), Math.round(part.end * rate))], rate);
}

/**
 * Send each part to /api/transcribe in turn. onPart(index, status, info) reports 'sending', 'done' or 'error'.
 * done: optional array of earlier results to reuse (a retry skips parts that already came back).
 * Returns { segments, text, language, results }. Segments carry word timings when the server sent them.
 */
export async function transcribeParts(samples, parts, { lang = '', translate = false, prompt = '', onPart, done = [] } = {}) {
  const results = done.slice();
  const q = new URLSearchParams();
  if (lang) q.set('lang', lang);
  if (translate) q.set('task', 'translate');
  if (prompt) q.set('prompt', prompt.slice(0, 240)); // Whisper's initial_prompt
  const qs = q.toString();
  for (let i = 0; i < parts.length; i++) {
    if (results[i]) { onPart?.(i, 'done', results[i]); continue; }
    onPart?.(i, 'sending');
    let res;
    try {
      res = await apiFetch(`/api/transcribe${qs ? `?${qs}` : ''}`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: partWav(samples, parts[i]) });
    } catch {
      const err = new Error('Could not reach the transcriber. Check your connection and try again.');
      onPart?.(i, 'error', err);
      err.results = results;
      throw err;
    }
    if (!res.ok) {
      let msg = `The transcriber answered ${res.status}.`;
      try { msg = (await res.json()).error || msg; } catch {}
      const err = new Error(msg);
      onPart?.(i, 'error', err);
      err.results = results;
      throw err;
    }
    const data = await res.json();
    results[i] = shiftResult(data, parts[i].start);
    onPart?.(i, 'done', results[i]);
  }
  const segments = results.flatMap((r) => r.segments);
  return { segments, text: segments.map((s) => s.text).join(' '), language: results.find((r) => r.language)?.language || lang, results };
}

/**
 * Move one part's segments and words to the file's timeline and attach words to their segments.
 * Word timings come from the segment's own words when the server sends them, else from the WebVTT.
 */
export function shiftResult(data, offset) {
  const words = parseVtt(data.vtt || '').map((w) => ({ ...w, start: w.start + offset, end: w.end + offset }));
  const segs = (data.segments || []).filter((s) => String(s.text || '').trim());
  const segments = segs.map((s) => {
    const out = { start: round(Number(s.start) + offset), end: round(Number(s.end) + offset), text: String(s.text).trim() };
    for (const k of ['avg_logprob', 'no_speech_prob']) if (Number.isFinite(s[k])) out[k] = s[k];
    const own = (Array.isArray(s.words) ? s.words : [])
      .map((w) => ({ text: String(w.word ?? w.text ?? ''), start: round(Number(w.start) + offset), end: round(Number(w.end) + offset) }))
      .filter((w) => w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end));
    // Whisper marks word starts with a leading space; if the server trimmed them all, put them back for spaced text
    const trimmed = own.length > 1 && own.slice(1).every((w) => !/^\s/.test(w.text)) && /\s/.test(out.text);
    if (own.length) out.words = trimmed ? own.map((w, i) => ({ ...w, text: i ? ` ${w.text}` : w.text })) : own;
    return out;
  });
  if (!segments.length && String(data.text || '').trim()) segments.push({ start: round(offset), end: round(offset + (Number(data.duration) || 1)), text: String(data.text).trim() });
  // prefer the server's words when they spell the segment's text, then the VTT's, then the server's anyway
  for (const s of segments) {
    const own = s.words;
    if (own && norm(own.map((w) => w.text).join('')) === norm(s.text)) continue;
    const mine = words.filter((w) => w.start >= s.start - 0.05 && w.start < s.end + 0.05);
    if (mine.length && norm(mine.map((w) => w.text).join('')) === norm(s.text)) s.words = mine;
  }
  return { segments, language: data.language || '' };
}

const round = (t) => Math.round(t * 1000) / 1000;
const norm = (s) => String(s).toLowerCase().replace(/[\s.,!?;:'"“”‘’«»。，、！？…-]/g, '');

/** Parse WebVTT cues into [{ start, end, text }] (text keeps its leading space, which marks a word gap). */
export function parseVtt(vtt) {
  const out = [];
  const re = /((?:\d+:)?\d+:\d+[.,]\d+)\s*-->\s*((?:\d+:)?\d+:\d+[.,]\d+)[^\n]*\n([\s\S]*?)(?:\n\n|$)/g;
  let m;
  while ((m = re.exec(String(vtt).replace(/\r/g, '')))) {
    const text = m[3].replace(/\n/g, ' ');
    if (text.trim()) out.push({ start: parseTime(m[1]), end: parseTime(m[2]), text });
  }
  return out;
}

export function parseTime(s) {
  const p = String(s).trim().replace(',', '.').split(':').map(Number);
  if (p.some((x) => !Number.isFinite(x))) return NaN;
  return p.reduce((acc, x) => acc * 60 + x, 0);
}

// ---------------------------------------------------------------------------------------------
// The editable transcript: one line per segment, "[00:03.2 → 00:07.9] text"
// ---------------------------------------------------------------------------------------------

export function clock(t, digits = 1) {
  t = Math.max(0, t);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(digits).padStart(digits ? 3 + digits : 2, '0');
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')}:${s}`;
}

export function formatTranscript(segments) {
  return segments.map((s) => `[${clock(s.start)} → ${clock(s.end)}] ${s.text}`).join('\n');
}

/** Read the edited transcript back. Lines without a timestamp join the line above. Unchanged lines keep their word timings. */
export function parseTranscript(text, original = []) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*\[\s*([\d:.]+)\s*(?:→|-->|->|–|-)\s*([\d:.]+)\s*\]\s*(.*)$/);
    if (m) {
      const start = parseTime(m[1]);
      const end = parseTime(m[2]);
      if (Number.isFinite(start) && Number.isFinite(end)) { out.push({ start, end: Math.max(end, start), text: m[3].trim() }); continue; }
    }
    if (line.trim() && out.length) out[out.length - 1].text = `${out[out.length - 1].text} ${line.trim()}`.trim();
  }
  for (const s of out) {
    const o = original.find((x) => Math.abs(x.start - s.start) < 0.06 && x.words && norm(x.text) === norm(s.text));
    if (o) { s.words = o.words; s.start = o.start; s.end = Math.max(o.end, s.start); }
  }
  return out.filter((s) => s.text);
}

export function toText(segments) {
  return `${segments.map((s) => s.text).join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------
// Captions: sentence-level cues, at most two lines of 42 characters
// ---------------------------------------------------------------------------------------------

const SENTENCE_END = /[.!?。！？…]["'”’)\]]*$/;
const CJK = /[　-鿿가-힯＀-￯]/;

/** Turn segments into cues: [{ start, end, lines: [..] }]. */
export function buildCues(segments, { maxLine = 42, maxLines = 2, maxDur = 7 } = {}) {
  const maxChars = maxLine * maxLines;
  const cues = [];
  const fits = (toks) => {
    const text = joinTokens(toks);
    return toks.length === 1 || (text.length <= maxChars && toks[toks.length - 1].end - toks[0].start <= maxDur && wrap(text, maxLine, maxLines).every((l) => l.length <= maxLine));
  };
  for (const seg of segments) {
    // one cue per sentence; a sentence too long for one cue is cut into even pieces, at commas where possible
    let sentence = [];
    const flush = () => {
      if (!sentence.length) return;
      for (const piece of balance(sentence, maxChars, fits)) cues.push({ start: piece[0].start, end: piece[piece.length - 1].end, text: joinTokens(piece) });
      sentence = [];
    };
    for (const tok of tokensFor(seg, maxLine)) {
      sentence.push(tok);
      if (SENTENCE_END.test(tok.text)) flush();
    }
    flush();
  }
  // tidy: no overlaps, a readable minimum length
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const next = cues[i + 1];
    c.end = Math.max(c.end, c.start + 0.6);
    if (next && c.end > next.start) c.end = Math.max(c.start + 0.1, next.start);
    c.lines = wrap(c.text, maxLine, maxLines);
  }
  return cues;
}

/** Split tokens into the fewest even pieces that each fit one cue, preferring breaks after commas. */
function balance(tokens, maxChars, fits) {
  if (fits(tokens)) return [tokens];
  const total = joinTokens(tokens).length;
  for (let k = Math.max(2, Math.ceil(total / maxChars)); k <= tokens.length; k++) {
    const target = total / k;
    const pieces = [];
    let cur = [];
    for (const tok of tokens) {
      const before = cur.length ? joinTokens(cur).length : 0;
      cur.push(tok);
      const len = joinTokens(cur).length;
      const clause = /[,;:，、；：—–]$/.test(tok.text);
      if (pieces.length >= k - 1) continue;
      if (len >= target && cur.length > 1 && target - before < len - target) {
        // stopping before this word lands closer to an even split
        pieces.push(cur.slice(0, -1));
        cur = [tok];
      } else if (len >= target || (clause && len >= target * 0.7)) {
        pieces.push(cur);
        cur = [];
      }
    }
    if (cur.length) pieces.push(cur);
    if (pieces.every(fits)) return pieces;
  }
  return tokens.map((t) => [t]);
}

/** Tokens with times: real word timings when present, otherwise spread across the segment by length. */
function tokensFor(seg, maxLine) {
  if (seg.words?.length) {
    return seg.words.map((w, i) => ({ text: w.text.trim(), sep: i === 0 || /^\s/.test(w.text) ? ' ' : '', start: w.start, end: w.end })).filter((t) => t.text);
  }
  const raw = [];
  for (const word of seg.text.trim().split(/\s+/)) {
    if (!word) continue;
    if (word.length > maxLine && CJK.test(word)) {
      // languages without spaces: break after punctuation, then into line-sized runs
      const pieces = word.replace(/([。！？，、；：])/g, '$1\n').split('\n').filter(Boolean)
        .flatMap((p) => (p.length > maxLine ? p.match(new RegExp(`.{1,${maxLine}}`, 'gu')) : [p]));
      pieces.forEach((p, i) => raw.push({ text: p, sep: i === 0 ? ' ' : '' }));
    } else raw.push({ text: word, sep: ' ' });
  }
  const weight = raw.reduce((a, t) => a + t.text.length + 1, 0) || 1;
  const span = Math.max(0, seg.end - seg.start);
  let t = seg.start;
  return raw.map((tok) => {
    const d = (span * (tok.text.length + 1)) / weight;
    const out = { ...tok, start: t, end: t + d };
    t += d;
    return out;
  });
}

function joinTokens(tokens) {
  return tokens.map((t, i) => (i === 0 ? t.text : t.sep + t.text)).join('').trim();
}

/** Wrap into at most maxLines lines, balancing the two lines when one is not enough. */
export function wrap(text, maxLine = 42, maxLines = 2) {
  if (text.length <= maxLine) return [text];
  const spaced = text.includes(' ');
  let best = null;
  const mid = text.length / 2;
  for (let i = 1; i < text.length; i++) {
    if (spaced ? text[i] !== ' ' : false) continue;
    const a = text.slice(0, i).trim();
    const b = text.slice(i).trim();
    const score = Math.max(a.length, b.length) + Math.abs(i - mid) * 0.01;
    if (!best || score < best.score) best = { a, b, score };
  }
  if (!best || maxLines < 2) return [text];
  return [best.a, best.b];
}

const stamp = (t, sep) => {
  const ms = Math.round(Math.max(0, t) * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
};

export function toSrt(cues) {
  return `${cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.lines.join('\n')}`).join('\n\n')}\n`;
}

export function toVtt(cues) {
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.lines.join('\n')}`).join('\n\n')}\n`;
}
