import test from "node:test";
import assert from "node:assert/strict";
import * as E from "../public/js/textedit.js";
import { buildCues, toSrt, toVtt } from "../public/js/transcribe.js";

// A small talk with timings like Whisper's: [text, start, end]
const RAW = [
  [" So", 0.5, 0.7],
  [" um,", 0.8, 1.1],
  [" I", 1.3, 1.4],
  [" I", 1.45, 1.55],
  [" think", 1.6, 1.9],
  [" it", 2.0, 2.1],
  [" was,", 2.15, 2.4],
  [" like,", 2.6, 2.85],
  [" huge.", 3.05, 3.5],
  [" I", 5.0, 5.1], // a 1.5 s pause before this
  [" like", 5.15, 5.4],
  [" it.", 5.45, 5.7],
  [" You", 6.0, 6.2],
  [" know,", 6.2, 6.4],
  [" uh,", 6.6, 6.9],
  [" the", 7.0, 7.1],
  [" the", 7.15, 7.3],
  [" end.", 7.35, 7.8],
];
const segs = [
  { start: 0.5, end: 3.5, text: RAW.slice(0, 9).map((w) => w[0]).join("").trim(), words: RAW.slice(0, 9).map(([text, start, end]) => ({ text, start, end })) },
  { start: 5.0, end: 7.8, text: RAW.slice(9).map((w) => w[0]).join("").trim(), words: RAW.slice(9).map(([text, start, end]) => ({ text, start, end })) },
];
const words = E.wordsFromSegments(segs);
const DUR = 8.5;

test("words come out flat, ordered and indexed", () => {
  assert.equal(words.length, RAW.length);
  assert.deepEqual(words.map((w) => w.i), RAW.map((_, i) => i));
  assert.equal(words[9].seg, 1);
  // a segment without word timings still gets words, spread by length
  const spread = E.wordsFromSegments([{ start: 0, end: 2, text: "one two three" }]);
  assert.equal(spread.length, 3);
  assert.ok(spread.every((w) => w.approx && w.e <= 2));
});

test("fillers: sounds always, soft words only when set off", () => {
  const f = E.detectFillers(words, "en");
  const texts = f.map((x) => x.text);
  assert.deepEqual(texts, ["um,", "like,", "You know,", "uh,"]);
  // "I like it." is a real "like"
  assert.ok(!f.some((x) => x.from === 10));
  // other languages have their own lists
  const es = E.wordsFromSegments([{ start: 0, end: 3, text: "", words: [{ text: " Eh,", start: 0, end: 0.3 }, { text: " bueno,", start: 0.5, end: 0.8 }, { text: " vale.", start: 1.1, end: 1.4 }] }]);
  assert.deepEqual(E.detectFillers(es, "es").map((x) => x.text), ["Eh,", "bueno,"]);
});

test("repeats: stutters, doubled words and phrases, not deliberate doubles", () => {
  const r = E.detectRepeats(words);
  assert.deepEqual(r.map((x) => [x.from, x.to]), [[2, 2], [15, 15]]);
  const more = E.wordsFromSegments([{ start: 0, end: 5, text: "", words: [" I", " think", " I", " think", " th-", " the", " very", " very", " good"].map((text, k) => ({ text, start: k * 0.4, end: k * 0.4 + 0.3 })) }]);
  assert.deepEqual(E.detectRepeats(more).map((x) => x.text), ["I think", "th-"]);
});

test("pauses: gaps over the cap, lead-in and tail included", () => {
  const p = E.detectPauses(words, DUR, { over: 0.5 });
  assert.deepEqual(p.map((x) => x.gap), [8, 17]);
  assert.ok(Math.abs(p[0].len - 1.5) < 1e-9);
  assert.equal(E.detectPauses(words, DUR, { over: 0.3 })[0].gap, -1);
});

test("compile: struck words go, the longer neighbouring pause stays, caps shorten from the middle", () => {
  const st = E.emptyState();
  assert.deepEqual(E.compile(words, st, DUR), [[0, DUR]]);
  st.struck.add(1); // "um," between "So" (ends 0.7) and "I" (starts 1.3): silences 0.1 and 0.2
  let keep = E.compile(words, st, DUR);
  assert.equal(keep.length, 2);
  const kept = 0.2; // the longer of the two silences remains
  assert.ok(Math.abs(E.keptLength(keep) - (DUR - (1.3 - 0.7 - kept))) < 1e-9, JSON.stringify(keep));
  // the struck word's audio is gone
  assert.ok(keep.every(([a, b]) => b <= 0.8 + 1e-9 || a >= 1.1 - 1e-9));
  st.caps.set(8, 0.5);
  keep = E.compile(words, st, DUR);
  assert.ok(Math.abs(E.keptLength(keep) - (DUR - 0.4 - 1.0)) < 1e-9);
  // the cap keeps half of the pause next to each word
  assert.ok(keep.some(([a, b]) => Math.abs(b - 3.75) < 1e-9));
  // striking the first and last words cuts the lead-in to what touches the first kept word, and the tail
  const s2 = E.emptyState();
  s2.struck.add(0);
  s2.struck.add(17);
  keep = E.compile(words, s2, DUR);
  assert.ok(Math.abs(keep[0][0] - 0.7) < 1e-9, String(keep[0][0]));
  assert.ok(keep.at(-1)[1] < 7.36 && keep.at(-1)[1] >= 7.3);
});

test("time mapping and re-timed captions follow the edit", () => {
  const st = E.emptyState();
  for (const f of E.detectFillers(words)) for (let i = f.from; i <= f.to; i++) st.struck.add(i);
  st.caps.set(8, 0.5);
  const keep = E.compile(words, st, DUR);
  for (const t of [0.3, 2.0, 5.2, 7.5]) {
    const o = E.srcToOut(t, keep);
    if (keep.some(([a, b]) => t >= a && t <= b)) assert.ok(Math.abs(E.outToSrc(o, keep) - t) < 1e-9);
  }
  const segsOut = E.editedSegments(words, keep, st);
  assert.equal(segsOut.length, 2);
  assert.ok(!/\bum\b|\buh\b|You know/.test(segsOut.map((s) => s.text).join(" ")));
  const cues = buildCues(segsOut);
  const srt = toSrt(cues);
  const vtt = toVtt(cues);
  assert.match(srt, /^1\n00:00:00,500 --> /);
  assert.match(vtt, /^WEBVTT/);
  // the second sentence starts where "I" lands on the edited timeline
  const second = cues.find((c) => c.text.startsWith("I like"));
  assert.ok(Math.abs(second.start - E.srcToOut(5.0, keep)) < 1e-9);
  assert.ok(cues.at(-1).end <= E.keptLength(keep) + 1e-9);
  // source-time cues from the caption box are moved too; a cue inside a cut disappears
  const moved = E.retimeCues([{ start: 0.8, end: 1.1, text: "um" }, { start: 5, end: 5.7, text: "I like it." }], keep);
  assert.equal(moved.length, 1);
  assert.ok(Math.abs(moved[0].start - E.srcToOut(5, keep)) < 1e-9);
});

test("snapping moves cut edges to the quietest point nearby, never across words", () => {
  const rate = 16000;
  const x = new Float32Array(rate * 2);
  // speech-like noise everywhere except a quiet hole at 0.93-0.97 s
  let seed = 1;
  for (let i = 0; i < x.length; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    x[i] = ((seed / 2 ** 32) * 2 - 1) * 0.3;
  }
  for (let i = Math.round(0.93 * rate); i < Math.round(0.97 * rate); i++) x[i] *= 0.01;
  const env = E.rmsFrames(x, rate);
  const keep = E.snapCuts([[0, 0.9], [1.4, 2]], env, 2);
  assert.ok(Math.abs(keep[0][1] - 0.95) < 0.0126, `end moved to ${keep[0][1]}`);
  assert.ok(Math.abs(keep[1][0] - 1.4) <= E.SNAP_WINDOW + 1e-9);
  assert.equal(keep[0][0], 0);
  assert.equal(keep[1][1], 2);
  // in flat silence an edge stays where it was (to the envelope's 2.5 ms grid)
  const quiet = E.rmsFrames(new Float32Array(rate * 2), rate);
  const same = E.snapCuts([[0, 0.9], [1.4, 2]], quiet, 2);
  assert.ok(Math.abs(same[0][1] - 0.9) < 0.0013 && Math.abs(same[1][0] - 1.4) < 0.0013);
});

test("crossfades: exact output length and no jump at any join, even mid-tone", () => {
  const rate = 48000;
  const n = rate * 3;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate);
    R[i] = 0.5 * Math.sin((2 * Math.PI * 331 * i) / rate + 1);
  }
  const keep = [[0.1, 0.913], [1.271, 2.0], [2.5004, 2.9]]; // cuts in the middle of the tones
  const total = E.keepFrames(keep, rate).reduce((a, r) => a + r.e - r.s, 0);
  const [l, r] = E.renderEdit([L, R], rate, keep);
  assert.equal(l.length, total);
  assert.ok(Math.abs(l.length / rate - E.keptLength(keep)) < 2 / rate);
  // a sine's second difference is tiny (A * w^2); a hard cut would be about the amplitude
  const d2 = (y) => { let m = 0; for (let i = 2; i < y.length; i++) m = Math.max(m, Math.abs(y[i] - 2 * y[i - 1] + y[i - 2])); return m; };
  const smooth = 0.5 * (2 * Math.PI * 331 / rate) ** 2;
  assert.ok(d2(l) < 0.02 && d2(r) < 0.02, `max second difference ${d2(l)}, ${d2(r)} vs sine ${smooth}`);
  // the cut start and end fade from and to silence
  assert.ok(Math.abs(l[0]) < 0.01 && Math.abs(l.at(-1)) < 0.01);
  // rendering in blocks gives the same samples as one pass
  const a = E.renderEdit([L], rate, keep, { from: 0, to: 40000 })[0];
  const b = E.renderEdit([L], rate, keep, { from: 40000, to: total })[0];
  const whole = E.renderEdit([L], rate, keep)[0];
  for (const i of [0, 39000, 39999]) assert.equal(a[i], whole[i]);
  for (const i of [0, 1000, b.length - 1]) assert.equal(b[i], whole[40000 + i]);
});

test("energy: fillers glued to the next word are tight, sound inside a pause is flagged", () => {
  const rate = 16000;
  const x = new Float32Array(rate * 4);
  const tone = (a, b, f, amp = 0.3) => { for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) x[i] = amp * Math.sin((2 * Math.PI * f * i) / rate); };
  tone(0.2, 0.6, 200); // "well"
  tone(0.6, 0.9, 150); // "um" glued to both neighbours
  tone(0.9, 1.3, 220); // "so"
  tone(2.0, 2.3, 180); // an unworded sound inside the pause
  tone(3.2, 3.6, 240); // "yes"
  const ws = E.wordsFromSegments([{ start: 0.2, end: 3.6, text: "", words: [[" well", 0.2, 0.6], [" um", 0.6, 0.9], [" so", 0.9, 1.3], [" yes", 3.2, 3.6]].map(([text, start, end]) => ({ text, start, end })) }]);
  const env = E.rmsFrames(x, rate);
  const f = E.markTight(E.detectFillers(ws), env, ws);
  assert.equal(f.length, 1);
  assert.equal(f[0].tight, true);
  const p = E.markSpeechInPauses(E.detectPauses(ws, 4, { over: 0.5 }), env, ws);
  const mid = p.find((q) => q.gap === 2);
  assert.equal(mid.speech, true);
  const tail = p.find((q) => q.gap === 3);
  assert.equal(tail?.speech ?? false, false);
});

test("edit lists: CMX 3600 timecode and JSON agree with the keep ranges", () => {
  const edl = E.toEdl([[0, 1.5], [2, 3]], { title: "Talk", clip: "talk.wav", fps: 30 });
  assert.match(edl, /001 {2}AX {7}AA\/V {2}C {8}00:00:00:00 00:00:01:15 00:00:00:00 00:00:01:15/);
  assert.match(edl, /002 .* 00:00:02:00 00:00:03:00 00:00:01:15 00:00:02:15/);
  const st = E.emptyState();
  st.struck.add(1);
  const j = E.toEditJson({ name: "talk.wav", duration: DUR, words, state: st, keep: E.compile(words, st, DUR) });
  assert.equal(j.struck[0].t, "um,");
  assert.equal(j.kind, "edit");
  // the state key is order independent
  const a = E.emptyState(); a.struck.add(3); a.struck.add(1);
  const b = E.emptyState(); b.struck.add(1); b.struck.add(3);
  assert.equal(E.stateKey(a), E.stateKey(b));
});

test("the Worker passes Whisper's word timings, confidence and initial_prompt through; the page reads them", async () => {
  const { default: worker } = await import("../src/index.js");
  const { shiftResult } = await import("../public/js/transcribe.js");
  let input = null;
  const env = {
    AI: {
      run: async (model, inp) => {
        input = inp;
        return {
          text: "So um hello.",
          vtt: "WEBVTT\n\n00:00.000 --> 00:00.400\nSo\n\n",
          segments: [{ start: 0, end: 1.2, text: " So um hello.", avg_logprob: -0.31, no_speech_prob: 0.02, words: [{ word: " So", start: 0, end: 0.3 }, { word: " um", start: 0.4, end: 0.7 }, { word: " hello.", start: 0.8, end: 1.2 }] }],
          transcription_info: { language: "en", duration: 1.2 },
        };
      },
    },
  };
  const body = new Uint8Array(4000);
  const prompt = "Umm, so, uh, I was like, you know, thinking...";
  const res = await worker.fetch(new Request(`https://massless.test/api/transcribe?lang=en&prompt=${encodeURIComponent(prompt + "\u0007")}`, { method: "POST", body, headers: { "content-length": "4000" } }), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.equal(input.initial_prompt, prompt, "control characters are dropped and the prompt is passed as initial_prompt");
  assert.equal(input.language, "en");
  const data = await res.json();
  assert.deepEqual(data.segments[0].words[1], { word: " um", start: 0.4, end: 0.7 });
  assert.equal(data.segments[0].avg_logprob, -0.31);
  // without a prompt nothing changes for the Captions tab
  await worker.fetch(new Request("https://massless.test/api/transcribe", { method: "POST", body, headers: { "content-length": "4000" } }), env, { waitUntil() {} });
  assert.equal(input.initial_prompt, undefined);
  // the page moves them onto the file's timeline and keeps them in place of the VTT guess
  const shifted = shiftResult(data, 10);
  assert.deepEqual(shifted.segments[0].words.map((w) => [w.text, w.start]), [[" So", 10], [" um", 10.4], [" hello.", 10.8]]);
  assert.equal(shifted.segments[0].avg_logprob, -0.31);
  const words = E.wordsFromSegments(shifted.segments);
  assert.deepEqual(E.detectFillers(words).map((f) => f.text), ["um"]);
});
