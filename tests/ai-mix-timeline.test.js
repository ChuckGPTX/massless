// The arrangement side of AI Mix: clips on the timeline, doubles tightened to the lead, sections and build-ups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeClips, fineEnvelope, phrases, tightenOffsets, applyTightening, gateCurve, findSections, arrangementMoves, ghostDouble, barActivity } from '../public/js/mix/timeline.js';
import { ENV_RATE } from '../public/js/mix/analyze.js';
import { roleFromTrack } from '../public/js/mix/roles.js';
import { sessionLayout, unscramble } from '../public/js/mix/sessions/protools.js';
import { applySession } from '../public/js/mix/sessions/index.js';

const R = 44100;
const tone = (secs, f = 220, amp = 0.5) => Float32Array.from({ length: Math.round(secs * R) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / R));

test('clips land where the session puts them, as often as it puts them, and a later clip hides what it covers', () => {
  const file = tone(2, 100, 0.3);
  // one 0.5 s clip placed three times, then a clip that starts inside the third one
  const out = placeClips([file], R, [{ start: 0, offset: 0, length: 0.5 }, { start: 1, offset: 0, length: 0.5 }, { start: 2, offset: 0, length: 0.5 }, { start: 2.25, offset: 1, length: 0.5 }]);
  assert.equal(out[0].length, Math.round(2.75 * R));
  const rms = (a, b) => { let e = 0; for (let i = Math.round(a * R); i < Math.round(b * R); i++) e += out[0][i] ** 2; return Math.sqrt(e / ((b - a) * R)); };
  assert.ok(rms(0.1, 0.4) > 0.2 && rms(0.6, 0.9) < 1e-6 && rms(1.1, 1.4) > 0.2, 'placed where asked, silence between');
  assert.ok(Math.abs(out[0][Math.round(2.3 * R)] - file[Math.round(1.05 * R)]) < 1e-6, 'the later clip wins the overlap');
  assert.ok(Math.abs(out[0][0]) < 1e-6 && Math.abs(out[0][Math.round(0.5 * R) - 1]) < 0.02, 'edges fade so cuts never click');
});

test('a late double is measured phrase by phrase and lifted back onto the lead', () => {
  // three phrases of "syllables" (short tone bursts with gaps); the double sings the same, 30 ms late on the
  // first two phrases and 12 ms early on the third
  const lead = new Float32Array(Math.round(4 * R)), dbl = new Float32Array(lead.length);
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const starts = [0.3, 1.6, 2.9], lags = [30, 30, -12];
  starts.forEach((start, k) => {
    let t = start;
    for (let syl = 0; syl < 6; syl++) {
      const len = 0.06 + rnd() * 0.08, f = 180 + rnd() * 120, n = Math.round(len * R), at = Math.round(t * R);
      for (let i = 0; i < n; i++) { const v = Math.sin((2 * Math.PI * f * i) / R) * Math.sin((Math.PI * i) / n); lead[at + i] += v * 0.6; const j = at + i + Math.round((lags[k] / 1000) * R); if (j >= 0 && j < dbl.length) dbl[j] += v * 0.5; }
      t += len + 0.03 + rnd() * 0.05;
    }
  });
  const moves = tightenOffsets(fineEnvelope(dbl, R), fineEnvelope(lead, R));
  assert.equal(moves.length, 3);
  moves.forEach((m, k) => assert.ok(Math.abs(m.ms - lags[k]) <= 3, `phrase ${k}: found ${m.ms} ms, truth ${lags[k]}`));
  const fixed = applyTightening([dbl], R, moves);
  const again = tightenOffsets(fineEnvelope(fixed[0], R), fineEnvelope(lead, R));
  for (const m of again) assert.ok(Math.abs(m.ms) <= 3, `after tightening a phrase is still ${m.ms} ms off`);
  assert.equal(phrases(fineEnvelope(lead, R)).length, 3);
});

test('the clean-up gate opens on sung passages and closes between them, and leaves a steady stem alone', () => {
  const env = new Float32Array(1000).fill(-62); // room tone
  for (let k = 200; k < 400; k++) env[k] = -20; for (let k = 600; k < 650; k++) env[k] = -24;
  const g = gateCurve(env, { depth: 18 });
  assert.equal(g[300], 0); assert.equal(g[620], 0);
  assert.ok(g[100] <= -17 && g[500] <= -17, 'closed between phrases');
  assert.ok(g[401] === 0 && g[414] === 0 && g[440] < -5, 'holds a moment, then closes gently');
  assert.ok(gateCurve(new Float32Array(500).fill(-20)).every((v) => v === 0), 'a pad that never stops is left alone');
});

test('sections: a repeated hook, a lone verse and the big stack read as chorus, verse, chorus', () => {
  // 40 bars, as the Falling session reads: lead + 2 doubles for 28 bars, lead alone for 12, then an 11-voice stack
  const layers = [...Array(12).fill(3), ...Array(16).fill(3), ...Array(12).fill(1), ...Array(9).fill(9), ...Array(11).fill(3), ...Array(10).fill(0)];
  const lead = layers.map((l) => (l ? 1 : 0)), energy = layers.map(() => -20), hook = layers.map((_, b) => (b < 12 ? 1 : 0));
  const s = findSections({ layers, lead, energy, hook });
  assert.deepEqual(s.map((x) => [x.kind, x.from, x.to]), [['chorus', 0, 12], ['verse', 12, 40], ['chorus', 40, 49], ['verse', 49, 60], ['break', 60, 70]]);
  // with no stacks at all, the loud bars where the lead sings are the chorus
  const flat = findSections({ layers: Array(16).fill(1), lead: Array(16).fill(1), energy: [...Array(8).fill(-24), ...Array(8).fill(-18)] });
  assert.deepEqual(flat.map((x) => x.kind), ['verse', 'chorus']);
});

test('the build-up: sweep, drop, dry punch and throw sit right before the chorus; the first section gets none', () => {
  const bar = 1.6, frames = Math.round(40 * bar * ENV_RATE);
  const A = arrangementMoves([{ kind: 'verse', from: 0, to: 16 }, { kind: 'chorus', from: 16, to: 24 }, { kind: 'verse', from: 24, to: 40 }], bar, frames);
  assert.equal(A.moves.length, 1); assert.equal(A.moves[0].bar, 16);
  const at = (s) => Math.round(s * ENV_RATE), T = 16 * bar;
  assert.ok(A.beatHpf[at(T - 2 * bar)] < 30 && A.beatHpf[at(T - 0.5 * bar - 0.05)] > 200, 'the sweep climbs over the last two bars');
  assert.ok(A.beatHpf[at(T + 0.1)] === 0, 'and is gone when the chorus lands');
  assert.ok(A.beatMute[at(T - 0.2)] <= -50 && A.beatMute[at(T - 1)] === 0 && A.beatMute[at(T + 0.1)] === 0, 'the beat drops for the last two beats only');
  assert.ok(A.fxMute[at(T - 0.2)] <= -50 && A.fxMute[at(T - 0.6)] === 0, 'effects off for the last beat');
  assert.ok(A.leadVerb[at(T - 1.2)] >= 7 && A.leadVerb[at(T + 1)] === 0 && A.leadVerb[at(2)] === 3, 'throw before the drop, more room in the verse, dry chorus');
  assert.ok(A.lift.lead[at(T + 1)] === 1 && A.lift.double[at(T + 1)] === 2 && A.lift.double[at(2)] === -1.5, 'the chorus lifts, the verse tucks the doubles');
});

test('a made double is pitched by the cents asked and lands late by the ms asked', () => {
  const src = tone(1, 440, 0.5), g = ghostDouble(src, R, { cents: 6, delayMs: 20 });
  const zc = (x, a, b) => { let n = 0; for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 && x[i] >= 0) n++; return n; };
  const f0 = zc(src, R * 0.2, R * 0.9) / 0.7, f1 = zc(g, R * 0.2, R * 0.9) / 0.7;
  assert.ok(Math.abs(f1 / f0 - 2 ** (6 / 1200)) < 0.003, `pitch ratio ${(f1 / f0).toFixed(4)}`);
  assert.ok(g.subarray(0, Math.round(0.019 * R)).every((v) => v === 0), 'silent for the delay');
  assert.equal(barActivity(Uint8Array.from([1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0]), 0.04, 3).join(''), '101');
});

test('Pro Tools track names give the jobs: Main is a lead, Dub L a double on the left, Libbs the ad-libs, buses nothing', () => {
  assert.deepEqual(roleFromTrack('Vox 1 Main A'), { role: 'leadVox', pan: null });
  assert.deepEqual(roleFromTrack('Dub L.dup2'), { role: 'double', pan: -0.85 });
  assert.deepEqual(roleFromTrack('Vox 2 Libbs'), { role: 'adlib', pan: null });
  assert.deepEqual(roleFromTrack('Instrumental'), { role: 'beat', pan: null });
  assert.equal(roleFromTrack('Vox Subs'), null); assert.equal(roleFromTrack('Master 1 -'), null);
});

test('a session layout gives each dropped recording its clips and role; recordings on no track are unused', () => {
  const layout = { rate: 48000, files: [{ file: 'Record Mono_07.wav', track: 'Main B', clips: [{ start: 0, offset: 0, length: 6.75 }, { start: 6.4, offset: 0, length: 6.75 }] }, { file: 'Beat.wav', track: 'Instrumental', clips: [{ start: 0, offset: 0, length: 60 }] }], unused: ['Record Mono_02.wav'], tracks: [] };
  const stems = [{ name: 'Record Mono_02', path: 'Falling/Audio Files/Record Mono_02.wav' }, { name: 'Record Mono_07', path: 'Falling/Audio Files/Record Mono_07.wav' }, { name: 'Beat', path: 'Falling/Audio Files/Beat.wav' }];
  const r = applySession(stems, layout);
  assert.deepEqual(r, { placed: 2, unused: 1, missing: [] });
  assert.equal(stems[1].role, 'leadVox'); assert.equal(stems[1].clips.length, 2); assert.equal(stems[2].role, 'beat');
  assert.equal(stems[0].role, 'skip'); assert.equal(stems[0].unused, true);
  // the scramble: a Pro Tools 10+ header (type 5) round-trips through the key
  const buf = new Uint8Array(0x14 + 4096); buf[0x12] = 0x05; buf[0x13] = (11 * 3) & 0xff; for (let i = 0x14; i < buf.length; i++) buf[i] = i & 0xff;
  const once = unscramble(buf), twice = unscramble(once);
  assert.deepEqual(Array.from(twice.subarray(0x14, 0x14 + 16)), Array.from(buf.subarray(0x14, 0x14 + 16)));
  assert.equal(sessionLayout({ rate: 48000, files: [], clips: [], tracks: [], placements: [] }).files.length, 0);
});

test('every genre says how hard to build into a chorus', async () => {
  const { GENRES } = await import('../public/js/mix/rules.js');
  for (const [id, g] of Object.entries(GENRES)) { assert.ok(g.arrange, id); assert.ok(g.arrange.sweepTo >= 150 && g.arrange.sweepTo <= 800, `${id} sweep`); assert.ok(g.arrange.dropBeats >= 1 && g.arrange.dropBeats <= 4, `${id} drop`); }
});

test('with one voice, sections are at least four bars and build-ups only go into real choruses', () => {
  // loudness flickers bar to bar; one voice throughout
  const energy = Array.from({ length: 32 }, (_, b) => (b % 3 === 0 ? -16 : -22) + (b >= 16 ? 5 : 0));
  const s = findSections({ layers: Array(32).fill(1), lead: Array(32).fill(1), energy });
  assert.ok(s.every((x) => x.to - x.from >= 4), `short sections: ${JSON.stringify(s)}`);
  assert.ok(s.length <= 3, `too many sections: ${s.length}`);
  const A = arrangementMoves([{ kind: 'verse', from: 0, to: 8 }, { kind: 'chorus', from: 8, to: 10 }, { kind: 'verse', from: 10, to: 12 }, { kind: 'chorus', from: 12, to: 20 }], 1.6, Math.round(20 * 1.6 * ENV_RATE));
  assert.deepEqual(A.moves.map((m) => m.bar), [], 'a two-bar chorus and a chorus after a two-bar verse get no build-up');
  const B = arrangementMoves([{ kind: 'verse', from: 0, to: 8 }, { kind: 'chorus', from: 8, to: 16 }], 1.6, Math.round(16 * 1.6 * ENV_RATE));
  assert.deepEqual(B.moves.map((m) => m.bar), [8]);
});

test('doubler: a detuned, late copy each side, different on the left and the right, at the asked level', async () => {
  const { doubler } = await import('../public/js/mix/fx.js');
  const rate = 44100, n = rate, mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate);
  const [L, R] = doubler([mono, mono], rate, { cents: 7, delayMs: [14, 22], wetDb: -10 });
  assert.equal(L.length, n); assert.equal(R.length, n);
  // nothing before the delay, something after
  assert.ok(L.subarray(0, Math.round(rate * 0.013)).every((v) => v === 0));
  assert.ok(R.subarray(0, Math.round(rate * 0.021)).every((v) => v === 0));
  const rms = (x, a, b) => Math.sqrt(x.subarray(a, b).reduce((s, v) => s + v * v, 0) / (b - a));
  const mid = rms(mono, rate * 0.5, rate * 0.9), l = rms(L, rate * 0.5, rate * 0.9), r = rms(R, rate * 0.5, rate * 0.9);
  assert.ok(Math.abs(20 * Math.log10(l / mid) + 10) < 2, `left ${20 * Math.log10(l / mid)} dB`);
  assert.ok(Math.abs(20 * Math.log10(r / mid) + 10) < 2, `right ${20 * Math.log10(r / mid)} dB`);
  // the two sides are not the same signal
  let diff = 0; for (let i = rate * 0.5; i < rate * 0.9; i++) diff += (L[i] - R[i]) ** 2;
  assert.ok(Math.sqrt(diff / (rate * 0.4)) > 0.3 * l);
});

test('lowLevelLift: quiet syllables come up, loud ones stay, silence stays silent', async () => {
  const { lowLevelLift } = await import('../public/js/mix/fx.js');
  const rate = 44100, n = rate * 4, x = new Float32Array(n);
  // 4 s: loud bursts (0.5), quiet bursts (0.05 = -20 dB), silence between
  for (let i = 0; i < n; i++) { const t = i / rate, ph = t % 1; const a = ph < 0.3 ? 0.5 : ph > 0.5 && ph < 0.8 ? 0.05 : 0; x[i] = a * Math.sin(2 * Math.PI * 220 * t); }
  const [y] = lowLevelLift([x], rate, { maxDb: 3 });
  const rms = (s, a, b) => { a = Math.round(a); b = Math.round(b); let e = 0; for (let i = a; i < b; i++) e += s[i] * s[i]; return Math.sqrt(e / (b - a)); };
  const loudIn = rms(x, rate * 1.1, rate * 1.28), loudOut = rms(y, rate * 1.1, rate * 1.28);
  const quietIn = rms(x, rate * 1.6, rate * 1.78), quietOut = rms(y, rate * 1.6, rate * 1.78);
  assert.ok(Math.abs(20 * Math.log10(loudOut / loudIn)) < 0.3, `loud moved ${20 * Math.log10(loudOut / loudIn)} dB`);
  const lift = 20 * Math.log10(quietOut / quietIn);
  assert.ok(lift > 1.5 && lift <= 2.5, `quiet lifted ${lift} dB (a -20 dB syllable sits on the ramp toward the full 3 dB at -24)`);
  assert.ok(rms(y, rate * 1.85, rate * 1.98) < 1e-6, 'silence stays silent');
});
