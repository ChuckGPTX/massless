// Retune and the template-shaped buses: key from the music, pitch pulled to the scale, punch on hits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yin, pitchTrack, chroma, detectKey, snapToScale, retune, noteHistogram } from '../public/js/mix/tune.js';
import { transientShape, octaveDown } from '../public/js/mix/fx.js';
import { GENRES } from '../public/js/mix/rules.js';

const R = 44100;
const voice = (seq, offsets = []) => { // [[midi, seconds]] with a few harmonics, vibrato and soft edges
  const n = Math.round(seq.reduce((a, s) => a + s[1], 0) * R + R * 0.05), x = new Float32Array(n);
  let t = 0, ph = 0;
  seq.forEach(([m, d], k) => { const f0 = 440 * 2 ** ((m + (offsets[k] || 0) / 100 - 69) / 12), len = Math.round(d * R); for (let i = 0; i < len; i++) { const f = f0 * (1 + 0.004 * Math.sin((2 * Math.PI * 5.5 * i) / R)); ph += (2 * Math.PI * f) / R; const env = Math.min(1, i / (0.02 * R), (len - i) / (0.03 * R)); x[t + i] = env * (0.5 * Math.sin(ph) + 0.25 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph)); } t += len; });
  return x;
};

test('YIN finds the pitch of a voiced window, and nothing in silence', () => {
  const x = voice([[69, 0.5]]);
  const f = yin(x, Math.round(0.2 * R), R);
  assert.ok(Math.abs(f - 440) < 2, `found ${f.toFixed(1)} Hz`);
  assert.equal(yin(new Float32Array(4096), 0, R), 0);
  const tr = pitchTrack(x, R);
  assert.ok(tr.filter(Boolean).length > tr.length * 0.7);
});

test('the key comes from the music: an A minor pad reads A minor, an F major triad F major', () => {
  const pad = (notes) => { const x = new Float32Array(R * 3); for (const m of notes) { const f = 440 * 2 ** ((m - 69) / 12); for (let i = 0; i < x.length; i++) x[i] += 0.2 * Math.sin((2 * Math.PI * f * i) / R) + 0.05 * Math.sin((4 * Math.PI * f * i) / R); } return x; };
  assert.equal(detectKey(chroma(pad([57, 60, 64, 69, 72]), R)).name, 'A minor');
  assert.equal(detectKey(chroma(pad([53, 57, 60, 65, 69]), R)).name, 'F major');
  assert.equal(snapToScale(70.4, { tonic: 9, mode: 'minor' }), 71, 'B flat and a bit, in A minor, goes to B');
  const h = noteHistogram(Float32Array.from([440, 440, 0, 523.25, 0]));
  assert.ok(h[9] === 1 && h[0] === 0.5);
});

test('retune pulls a flat and sharp line onto the scale at the speed asked, and keeps its level', () => {
  const seq = [[69, 0.3], [72, 0.3], [74, 0.4], [76, 0.35], [74, 0.3], [72, 0.4]], off = [35, -40, 30, -45, 25, -30];
  const x = voice(seq, off), key = { tonic: 9, mode: 'minor', name: 'A minor', score: 1 };
  const err = (tr, ref) => { let s = 0, c = 0; for (let k = 10; k < tr.length; k++) if (tr[k] && ref[k]) { const m = 69 + 12 * Math.log2(tr[k] / 440); s += Math.abs((m - snapToScale(m, key)) * 100); c++; } return s / c; };
  const before = pitchTrack(x, R);
  const tight = retune(x, R, { key, speedMs: 0 }), natural = retune(x, R, { key, speedMs: 80 });
  const eB = err(before, before), eT = err(pitchTrack(tight.audio, R), before), eN = err(pitchTrack(natural.audio, R), before);
  assert.ok(eB > 25, `before ${eB.toFixed(1)}`); assert.ok(eT < 8, `tight ${eT.toFixed(1)} cents`); assert.ok(eN < eB && eN > eT, `natural ${eN.toFixed(1)} sits between`);
  let e = 0, e2 = 0; for (let i = 0; i < x.length; i++) { e += x[i] ** 2; e2 += tight.audio[i] ** 2; }
  assert.ok(Math.abs(10 * Math.log10(e2 / e)) < 0.5, 'level kept');
  assert.equal(tight.audio.length, x.length, 'timing kept');
});

test('punch lifts the start of a hit more than its tail; the octave layer halves the pitch', () => {
  const hit = new Float32Array(R), start = Math.round(0.1 * R);
  for (let i = 0; i < 0.3 * R; i++) hit[start + i] = Math.exp(-i / (0.05 * R)) * Math.sin(i * 0.3);
  const out = transientShape([hit], R, { attackDb: 3 })[0];
  const rms = (x, a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
  const onset = rms(out, start, start + 300) / rms(hit, start, start + 300), tail = rms(out, start + 8000, start + 12000) / rms(hit, start + 8000, start + 12000);
  assert.ok(onset > 1.15 && onset > tail + 0.1, `onset ×${onset.toFixed(2)}, tail ×${tail.toFixed(2)}`);
  const low = octaveDown(voice([[69, 0.6]]), R), f = yin(low, Math.round(0.25 * R), R, { fmin: 60 });
  assert.ok(Math.abs(f - 220) < 4, `octave down reads ${f.toFixed(1)} Hz`);
});

test('every genre says how to tune and which parallel buses to run', () => {
  for (const [id, g] of Object.entries(GENRES)) { assert.ok(g.tune && g.tune.speedMs >= 0 && g.tune.strength > 0, `${id} tune`); assert.ok('dist' in g && 'parComp' in g && 'punch' in g && 'deep' in g, `${id} buses`); }
});

test('sustainedShare: held notes count as singing, a moving line does not', async () => {
  const { sustainedShare } = await import('../public/js/mix/tune.js');
  const held = new Float32Array(400); for (let k = 0; k < 400; k++) held[k] = k % 100 < 80 ? 220 * (1 + 0.01 * Math.sin(k / 3)) : 0; // 800 ms notes with vibrato, gaps between
  const rap = new Float32Array(400); for (let k = 0; k < 400; k++) rap[k] = k % 10 < 8 ? 150 + 40 * ((k / 10) % 5) : 0; // a new pitch every 100 ms
  assert.ok(sustainedShare(held) > 0.9, `held ${sustainedShare(held)}`);
  assert.ok(sustainedShare(rap) < 0.05, `rap ${sustainedShare(rap)}`);
});
