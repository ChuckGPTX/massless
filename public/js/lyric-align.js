// Turning Whisper's word timings into lyric lines, and matching lyrics a singer typed to the song.
// Everything here runs in the browser in a few milliseconds. No extra model or download.
//
// Ideas borrowed from open-source projects (credited, no code copied):
// - Hallucination checks use the same signals faster-whisper and stable-ts expose
//   (no_speech_prob, avg_logprob, compression_ratio) plus a short list of phrases Whisper
//   is known to invent over music (github.com/SYSTRAN/faster-whisper, github.com/jianfch/stable-ts).
// - "Paste your lyrics, keep the timing" follows the text-alignment idea behind stable-ts align()
//   and WhisperX: trust the typed words, borrow the times from what Whisper heard.

const NORM = s => String(s).toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');

// Phrases Whisper writes when it hears music but no words. The most common ones from the
// "Bag of Hallucinations" study (ICASSP 2025, github.com/DSP-AGH/ICASSP2025_Whisper_Hallucination, MIT)
// plus TV-style lines we saw it invent over instrumentals.
const INVENTED = /^(thank you( (so much|very much))?( for (watching|listening))?|thanks for watching|please subscribe|subscribe( to (my|the) channel)?|like and subscribe|(i'll |we'll )?see you (next time|later|in the next video)|we'll be right back|bye+|you|so|oh|uh|um|music|instrumental|applause|laughter|[♪♫\s.,!?-]*)$/i;

// faster-whisper's word anomaly score, without the probability term we don't receive:
// words squeezed under 0.133 s or stretched past 2 s are suspicious (github.com/SYSTRAN/faster-whisper, MIT).
function anomaly(s) {
  let score = 0;
  for (const w of (s.words || []).slice(0, 8)) {
    const d = Number(w.end) - Number(w.start);
    if (d < 0.133) score += (0.133 - d) * 15;
    if (d > 2) score += d - 2;
  }
  return score;
}

// Remove segments that are probably invented: phrase list, confidence, looping text,
// "a few words stretched over a long stretch of music", and anomalous words with silence on both sides.
export function dropInvented(segments) {
  const list = (segments || []).filter(s => String(s.text || '').trim()).sort((a, b) => a.start - b.start);
  return list.filter((s, i) => {
    const text = String(s.text).trim();
    if (INVENTED.test(text.replace(/[.!?,]+$/, ''))) return false;
    if (Number(s.no_speech_prob) > 0.6 && Number(s.avg_logprob) < -0.7) return false;
    if (Number(s.compression_ratio) > 2.4) return false; // the same words looping
    const words = text.split(/\s+/).length, span = Number(s.end) - Number(s.start);
    const timed = Array.isArray(s.words) && s.words.length;
    if (!timed && span > 10 && words / span < 0.35) return false;
    if (timed) {
      const score = anomaly(s), n = Math.min(8, s.words.length);
      const alone = (i === 0 || s.start - list[i - 1].end >= 2) && (i === list.length - 1 || list[i + 1].start - s.end >= 2);
      if (alone && (score >= 3 || score + 0.01 >= n)) return false;
    }
    return true;
  });
}

// One flat list of timed words. Segments without word times get evenly spread words.
export function wordsFrom(segments) {
  const out = [];
  for (const s of dropInvented(segments)) {
    const tokens = String(s.text).trim().split(/\s+/).filter(Boolean);
    const timed = (s.words || []).map(w => ({ text: String(w.text ?? w.word ?? '').trim(), start: Number(w.start), end: Number(w.end) }))
      .filter(w => w.text && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);
    if (timed.length) { out.push(...timed); continue; }
    const a = Number(s.start), b = Number(s.end), step = (b - a) / Math.max(1, tokens.length);
    tokens.forEach((t, i) => out.push({ text: t, start: a + i * step, end: a + (i + 1) * step, estimated: true }));
  }
  out.sort((x, y) => x.start - y.start);
  // A word can't be held for ages: Whisper sometimes stretches the last word over an instrumental.
  for (let i = 0; i < out.length; i++) {
    const w = out[i], next = out[i + 1];
    w.end = Math.min(w.end, w.start + 2.5, next ? Math.max(w.start + 0.05, next.start) : Infinity);
  }
  return out;
}

const MAX_WORDS = 10, MAX_CHARS = 44;
const PRONOUN_I = /^(I|I'm|I'll|I've|I'd)[,.!?]?$/;

// Where a new line may start inside a segment: after a pause of half a second (stable-ts's default),
// after sentence punctuation, or at a capitalised word (lyric lines start with a capital).
const breakBefore = (prev, w) => w.start - prev.end >= 0.5 || /[.!?]$/.test(prev.text) || (/^\p{Lu}/u.test(w.text) && !PRONOUN_I.test(w.text));

// Balanced halves (at a comma near the middle when there is one), so nothing is left with one orphaned word.
function split(words) {
  const chars = words.reduce((n, w) => n + w.text.length + 1, 0);
  if (words.length <= MAX_WORDS && chars <= MAX_CHARS) return [words];
  const mid = words.length / 2;
  let cut = -1, best = Infinity;
  words.forEach((w, j) => { if (j >= 1 && j < words.length - 2 && /[,;:]$/.test(w.text) && Math.abs(j + 1 - mid) < best) { best = Math.abs(j + 1 - mid); cut = j + 1; } });
  if (cut < 0 || best > words.length / 4) cut = Math.round(mid);
  return [...split(words.slice(0, cut)), ...split(words.slice(cut))];
}

// Whisper's segments usually follow the singer's phrases, so each one is a line. A segment that holds
// several sung lines (it happens when Whisper is given a prompt) is first cut at phrase starts.
function phrases(words) {
  if (words.length <= MAX_WORDS) return [words];
  const out = [[words[0]]];
  for (let i = 1; i < words.length; i++) {
    const cur = out[out.length - 1];
    if (cur.length >= 3 && words.length - i >= 3 && breakBefore(words[i - 1], words[i])) out.push([words[i]]); else cur.push(words[i]);
  }
  return out;
}
export function phraseCues(segments) {
  const out = [];
  for (const s of dropInvented(segments)) {
    for (const line of phrases(wordsFrom([s])).flatMap(split)) {
      if (!line.length) continue;
      out.push({ start: line[0].start, end: line[line.length - 1].end, text: line.map(w => w.text).join(' '),
        words: line.filter(w => !w.estimated).length === line.length ? line.map(w => ({ text: w.text, start: w.start, end: w.end })) : undefined });
    }
  }
  return out.sort((x, y) => x.start - y.start).map(c => (c.words ? c : (delete c.words, c)));
}

// Give each line a short tail so it doesn't vanish the instant the last word ends.
export function holdLines(cues, duration) {
  return cues.map((c, i) => {
    const next = cues[i + 1]?.start ?? duration;
    return { ...c, end: Math.min(next, duration, Math.max(c.end, Math.min(c.end + 0.8, next))) };
  });
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Edit distance ratio, so "lettuce" vs "letters" and "draw" vs "drop" still line up.
  const m = a.length, n = b.length, row = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = row[0]; row[0] = i;
    for (let j = 1; j <= n; j++) { const tmp = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return 1 - row[n] / Math.max(m, n);
}

// Lyrics as the singer typed them, minus section labels like [Chorus] or (x2).
export function lyricLines(text) {
  return String(text).replace(/\r/g, '').split('\n').map(l => l.replace(/\[[^\]]*\]|\((x\d+|\d+x|repeat)\)/gi, '').trim())
    .filter(l => l && !/^(verse|chorus|bridge|intro|outro|hook|pre-?chorus)(\s*\d+)?:?$/i.test(l)).slice(0, 500);
}

// Match typed lyrics to the words Whisper heard (global alignment, Needleman–Wunsch).
// Every typed word gets a time: matched words borrow Whisper's, the rest are spread between neighbours.
// Returns { cues, matched } where matched is the share of typed words that found a heard word.
export function alignLyrics(text, heard, duration) {
  const lines = lyricLines(text);
  const typed = [];
  lines.forEach((l, li) => l.split(/\s+/).filter(Boolean).forEach(w => typed.push({ text: w, line: li, key: NORM(w) })));
  const H = (heard || []).map(w => ({ ...w, key: NORM(w.text) })).filter(w => w.key);
  if (!typed.length) return { cues: [], matched: 0 };
  if (!H.length) return { cues: [], matched: 0 };
  const n = typed.length, m = H.length, GAPC = -0.6;
  const score = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1 diag, 2 up (typed only), 3 left (heard only)
  for (let i = 1; i <= n; i++) { score[i][0] = i * GAPC; move[i][0] = 2; }
  for (let j = 1; j <= m; j++) { score[0][j] = j * GAPC * 0.5; move[0][j] = 3; } // heard extras (ad-libs) are cheap to skip
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const s = similarity(typed[i - 1].key, H[j - 1].key);
    const d = score[i - 1][j - 1] + (s >= 0.5 ? s * 2 : -1), u = score[i - 1][j] + GAPC, l = score[i][j - 1] + GAPC * 0.5;
    if (d >= u && d >= l) { score[i][j] = d; move[i][j] = 1; } else if (u >= l) { score[i][j] = u; move[i][j] = 2; } else { score[i][j] = l; move[i][j] = 3; }
  }
  let i = n, j = m, hits = 0;
  while (i > 0 || j > 0) {
    const mv = move[i][j];
    if (mv === 1) { if (similarity(typed[i - 1].key, H[j - 1].key) >= 0.5) { typed[i - 1].start = H[j - 1].start; typed[i - 1].end = H[j - 1].end; hits++; } i--; j--; }
    else if (mv === 2) i--; else j--;
  }
  // Fill unmatched words between their timed neighbours, by character length.
  let k = 0;
  while (k < n) {
    if (Number.isFinite(typed[k].start)) { k++; continue; }
    let e = k; while (e < n && !Number.isFinite(typed[e].start)) e++;
    const from = k ? typed[k - 1].end : Math.max(0, (typed[e]?.start ?? duration) - 0.4 * (e - k));
    const to = e < n ? typed[e].start : Math.min(duration, from + 0.4 * (e - k));
    const total = typed.slice(k, e).reduce((s, w) => s + w.text.length, 0) || 1;
    let t = from;
    for (let x = k; x < e; x++) { const d = (to - from) * typed[x].text.length / total; typed[x].start = t; typed[x].end = t + Math.max(0.01, d); t += d; }
    k = e;
  }
  const cues = lines.map((l, li) => {
    const ws = typed.filter(w => w.line === li);
    return ws.length ? { text: l, start: ws[0].start, end: ws[ws.length - 1].end, words: ws.map(w => ({ text: w.text, start: w.start, end: w.end })) } : null;
  }).filter(Boolean);
  // Keep lines in order and non-overlapping.
  for (let x = 1; x < cues.length; x++) if (cues[x].start < cues[x - 1].start) cues[x].start = cues[x - 1].start;
  return { cues: holdLines(cues.filter(c => c.end > c.start), duration), matched: hits / n };
}

// Up to 240 characters of typed lyrics, as Whisper's prompt, so it expects the right words and spellings.
export function promptFrom(text) {
  return lyricLines(text).join(' ').replace(/\s+/g, ' ').slice(0, 240);
}
