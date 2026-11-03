import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { wordShapes, align, voicedSpans, fallbackTimings, track, mouthAt, envelope, SHAPES, SHAPE_NAMES } from "../public/js/presets/lipsync.js";
import { presetById } from "../public/js/presets/catalog.js";
import { DENY } from "../public/js/presets/spec.js";

const { speechWav } = createRequire(import.meta.url)("./fixtures/voice-stub.cjs");
const shapes = (w) => wordShapes(w).map((x) => x.s).join(" ");

test("there are 6 to 8 mouth shapes, from rest to wide open", () => {
  assert.ok(SHAPE_NAMES.length >= 6 && SHAPE_NAMES.length <= 8);
  for (const s of ["rest", "mbp", "fv", "ai", "e", "o", "etc"]) assert.ok(SHAPES[s], s);
  assert.equal(SHAPES.mbp.open, 0);
  assert.ok(SHAPES.ai.open > SHAPES.e.open && SHAPES.e.open > SHAPES.rest.open);
  assert.ok(SHAPES.o.round > 0.5 && SHAPES.e.wide > SHAPES.o.wide);
});

test("letters become mouth shapes by simple English rules", () => {
  assert.equal(shapes("mop"), "mbp o mbp");
  assert.equal(shapes("five"), "fv ai e fv"); // long i, silent final e
  assert.equal(shapes("photo"), "fv o etc o"); // ph is f
  assert.equal(shapes("we"), "u e");
  assert.equal(shapes("see"), "etc e");
  assert.equal(shapes("good."), "etc u etc"); // punctuation ignored, oo is round
  assert.equal(shapes("Bubble"), "mbp ai mbp etc"); // doubled consonant said once
  assert.equal(shapes("the"), "etc e"); // the only vowel is not silent
  assert.equal(shapes("my"), "mbp ai e");
  assert.equal(shapes("light"), "etc ai e etc");
  assert.equal(shapes("you"), "etc u");
  assert.ok(wordShapes("3").length > 0, "numbers still move the mouth");
  for (const w of ["serum", "every", "morning,", "sticky", "it."]) for (const x of wordShapes(w)) assert.ok(SHAPES[x.s] && x.w > 0, w);
});

test("voiced stretches and pauses come from the loudness", () => {
  const fps = 30, env = new Float32Array(90);
  env.fill(0.6, 6, 30); env[18] = 0; // a stop inside a word is not a pause
  env.fill(0.6, 45, 80);
  const { spans, pauses } = voicedSpans(env, fps);
  assert.equal(spans.length, 2);
  assert.equal(pauses.length, 1);
  assert.ok(Math.abs(pauses[0].t0 - 1) < 0.05 && Math.abs(pauses[0].t1 - 1.5) < 0.05);
});

test("words line up with the voice: weighted by length, punctuation in the pauses", () => {
  const script = "Okay, my skin has never looked this good. This is Glow Serum. Three drops every morning, and it just sinks right in. Light, fast, no sticky feel. Tap the link and try it.";
  const { wav, words: truth } = speechWav(script);
  const rate = wav.readUInt32LE(24), n = (wav.length - 44) / 2, mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = wav.readInt16LE(44 + i * 2) / 32768;
  const env = envelope(mono, rate, 30);
  const got = align(script.split(" "), env, 30);
  assert.equal(got.length, truth.length);
  let err = 0;
  got.forEach((g, i) => { assert.ok(g.t1 > g.t0 && (i === 0 || g.t0 >= got[i - 1].t1 - 1e-9), "in order"); err += Math.abs(g.t0 - truth[i].t0) + Math.abs(g.t1 - truth[i].t1); });
  assert.ok(err / (2 * got.length) < 0.08, `mean error ${(err / (2 * got.length)).toFixed(3)} s`);
  // every full stop ends inside a pause: no word is spread across a sentence break
  got.forEach((g, i) => { if (/[.!?]$/.test(g.w) && i < got.length - 1) assert.ok(Math.abs(g.t1 - truth[i].t1) < 0.06 && got[i + 1].t0 - g.t1 > 0.3, `${g.w} ends in the pause`); });
});

test("without a voice the words are spread by length with rests at punctuation", () => {
  const t = fallbackTimings(["Hello,", "a", "wonderful", "day."], 3);
  assert.ok(t[0].t0 > 0 && t[3].t1 <= 3);
  assert.ok(t[1].t0 - t[0].t1 > 0.2, "a rest after the comma");
  assert.ok(t[2].t1 - t[2].t0 > t[1].t1 - t[1].t0, "longer words take longer");
});

test("the mouth blends smoothly between shapes and closes for m, b and p", () => {
  const keys = track([{ w: "mama", t0: 0.5, t1: 1.0 }, { w: "oh", t0: 1.4, t1: 1.7 }]);
  const at = (t) => mouthAt(keys, t);
  const m = keys.find((k) => k.s === "mbp");
  assert.ok(at(m.c).open < 0.02 && at(m.c).press > 0.95, "lips meet");
  assert.ok(at(keys.find((k) => k.s === "ai").c).open > 0.5, "a opens wide");
  assert.ok(at(1.55).round > 0.5, "o is round");
  assert.ok(at(0.2).open < 0.05 && at(2.5).open < 0.05, "rest before and after");
  // no snapping: between frames at 60 fps nothing jumps
  let prev = at(0.3), worst = 0;
  for (let t = 0.3; t < 2; t += 1 / 60) { const c = at(t); for (const k of Object.keys(c)) worst = Math.max(worst, Math.abs(c[k] - prev[k])); prev = c; }
  assert.ok(worst < 0.35, `largest step ${worst.toFixed(2)}`);
});

test("the talking ad's visible copy stays plain", () => {
  const talk = presetById("talking-ad");
  const copy = [talk.note, talk.description, talk.safety.disclosure].join(" ").toLowerCase();
  for (const w of [...DENY, "viseme", "lip-sync", "indexeddb", "prompt", "inference"]) assert.ok(!new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(copy), w);
  assert.match(talk.note, /mouth follows the words/i);
});
