import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeRough, relativeShifts, sketch, waveLag, fineShiftAt, fitLevels, gapsBetween, shiftEnv, fittedEnvelope } from '../public/js/mix/rough.js';
import { analyzeStem } from '../public/js/mix/analyze.js';

const R = 44100;
let seed = 5;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;

test('the full bounce is recognised by its name or place, stems are not', () => {
  const others = ['Song/Stems/Kick.wav', 'Song/Stems/Lead Vox.wav'];
  for (const p of ['Song/Rough Mix.wav', 'Bounced Files/Song.mp3', 'Song/Song.wav', 'Mixdown v3.wav', 'Full Song.mp3', 'Stereo Out.wav']) assert.ok(looksLikeRough(p, others), p);
  for (const p of ['Song/Stems/Lead Vox.wav', 'Kick.wav', 'Beat.wav', 'Vocal Mix.wav', 'Drums Bus.wav']) assert.ok(!looksLikeRough(p, others), p);
});

test('a common offset belongs to the rough; only stems that disagree get moved', () => {
  assert.deepEqual(relativeShifts([1105, 1104, 1107, 1105 + 44100]), [0, 0, 0, 44100]); // MP3 rough: encoder delay on every stem
  assert.deepEqual(relativeShifts([0, 4, null, 359100], 88), [0, 0, 0, 359100]); // under 2 ms is noise
  assert.deepEqual(relativeShifts([null, null]), [0, 0]);
});

function voiceLike(sec, f0 = 180) {
  const x = new Float32Array(Math.round(R * sec));
  for (let i = 0; i < x.length; i++) { const t = i / R, env = Math.max(0, Math.sin(t * 7.3)) * (0.6 + 0.4 * Math.sin(t * 2.1)); x[i] = env * (Math.sin(2 * Math.PI * f0 * t * (1 + 0.05 * Math.sin(t * 5))) + 0.3 * rnd()); }
  return x;
}

test('a stem exported from its first note is found where it sits in the rough, to the sample', () => {
  const N = R * 10, part = voiceLike(2.5), bed = new Float32Array(N);
  for (let i = 0; i < N; i++) bed[i] = 0.3 * Math.sin(2 * Math.PI * 110 * i / R) + 0.05 * rnd();
  const at = Math.round(R * 6.3), rough = Float32Array.from(bed);
  for (let i = 0; i < part.length; i++) rough[at + i] += 0.5 * part[i];
  const w = waveLag(sketch(part, R), sketch(rough, R));
  assert.ok(Math.abs(w.lag - at) < 40, `coarse ${w.lag} vs ${at}`);
  assert.ok(w.z > 8);
  const fine = fineShiftAt(part, rough, R, w.lag);
  assert.ok(Math.abs(fine.shift - at) <= 1, `fine ${fine.shift} vs ${at}`);
});

test('a looping part that already starts at bar 1 stays at bar 1', () => {
  const N = R * 8, loop = new Float32Array(N);
  for (let b = 0; b < 16; b++) { const at = Math.round(b * 0.5 * R); for (let i = 0; i < 4000; i++) loop[at + i] += Math.sin(2 * Math.PI * 60 * i / R) * Math.exp(-i / 900); }
  const rough = Float32Array.from(loop, (v, i) => v + 0.2 * Math.sin(2 * Math.PI * 300 * i / R));
  assert.equal(waveLag(sketch(loop, R), sketch(rough, R)).lag, 0);
});

test('the artist’s balance is recovered from the rough, and silent stretches show as gaps', () => {
  const n = 600, mk = (f) => Float32Array.from({ length: n }, (_, k) => f(k));
  const a = { low: mk((k) => (k % 50 < 5 ? -10 : -80)), mid: mk(() => -60), high: mk(() => -90) };
  const b = { low: mk(() => -70), mid: mk((k) => -20 + 3 * Math.sin(k / 7)), high: mk((k) => -30 + 3 * Math.sin(k / 5)) };
  const p = (d) => 10 ** (d / 10), sum = (x, y, gx, gy) => Float32Array.from(x, (v, k) => 10 * Math.log10(p(v) * p(gx) + p(y[k]) * p(gy)));
  const rough = { low: sum(a.low, b.low, -4, 2), mid: sum(a.mid, b.mid, -4, 2), high: sum(a.high, b.high, -4, 2) };
  const fit = fitLevels([a, b], rough);
  assert.ok(Math.abs(fit.gains[0] - -4) < 0.5 && Math.abs(fit.gains[1] - 2) < 0.5, fit.gains.join());
  assert.ok(fit.fit > 0.95);
  const ref = mk(() => -20), test2 = mk((k) => (k > 300 && k < 520 ? -70 : -21));
  const gaps = gapsBetween(ref, test2, { minSeconds: 1.5, drop: 15 });
  assert.equal(gaps.length, 1); assert.ok(Math.abs(gaps[0].start - 3.01) < 0.05 && Math.abs(gaps[0].end - 5.2) < 0.05);
  assert.equal(shiftEnv(mk((k) => k), 10)[15], 5);
  assert.ok(fittedEnvelope([a.low], [-Infinity], n).every((v) => v === -120));
});

test('the analysis carries the three bands the rough is matched in', () => {
  const f = analyzeStem([voiceLike(2)], R);
  for (const b of ['low', 'mid', 'high']) assert.equal(f.bands[b].length, f.env.length);
});
