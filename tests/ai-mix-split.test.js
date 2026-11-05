// One song in: the split's pre/post-processing and how its parts become mixer tracks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONSTANTS, prepareModelInput, standaloneIspec } from '../public/js/vendor/demucs-web/demucs.js';
import { stemsFromSplit } from '../public/js/mix/split.js';
import { ROLES } from '../public/js/mix/roles.js';
import { ROLE_RULES } from '../public/js/mix/rules.js';

const { TRAINING_SAMPLES: SEG, MODEL_SPEC_BINS: B, MODEL_SPEC_FRAMES: F } = CONSTANTS;

test('the spectrogram the model reads turns back into the same audio (its frequency branch lines up)', () => {
  const L = new Float32Array(SEG), R = new Float32Array(SEG);
  for (let i = 0; i < SEG; i++) { L[i] = 0.4 * Math.sin((2 * Math.PI * 220 * i) / 44100) + 0.1 * Math.sin(i * 0.37); R[i] = 0.3 * Math.sin((2 * Math.PI * 330 * i) / 44100); }
  const { magSpec, waveform } = prepareModelInput(L, R);
  assert.equal(magSpec.length, 4 * B * F);
  assert.equal(waveform.length, 2 * SEG);
  const plane = (c) => magSpec.subarray(c * B * F, (c + 1) * B * F);
  const back = standaloneIspec({ leftReal: plane(0), leftImag: plane(1), rightReal: plane(2), rightImag: plane(3) }, SEG);
  // away from the window edges the round trip is exact (the top bin is dropped, so allow a hair)
  let err = 0, ref = 0;
  for (let i = 8192; i < SEG - 8192; i++) { err += (back.left[i] - L[i]) ** 2 + (back.right[i] - R[i]) ** 2; ref += L[i] ** 2 + R[i] ** 2; }
  assert.ok(10 * Math.log10(ref / err) > 40, `round trip SNR ${(10 * Math.log10(ref / err)).toFixed(1)} dB`);
});

test('split parts become four tracks with fixed roles; the bass is an 808 in genres built on one', () => {
  const ch = () => [new Float32Array(10), new Float32Array(10)];
  const parts = { vocals: ch(), drums: ch(), bass: ch(), other: ch() };
  const pop = stemsFromSplit(parts, 'pop'), trap = stemsFromSplit(parts, 'trap');
  assert.deepEqual(pop.roles, ['leadVox', 'drums', 'bass', 'music']);
  assert.deepEqual(trap.roles, ['leadVox', 'drums', '808', 'music']);
  assert.deepEqual(pop.stems.map((s) => s.name), ['Vocals', 'Drums', 'Bass', 'Music']);
  assert.equal(pop.stems[0].channels, parts.vocals, 'the audio is handed over, not copied');
  for (const r of pop.roles.concat(trap.roles)) { assert.ok(ROLES[r], r); assert.ok(ROLE_RULES[r], r); }
});

test('the music part is treated gently: whole range, light glue, small carve for the vocal', () => {
  const m = ROLE_RULES.music;
  assert.ok(m.hpf <= 40);
  assert.ok(m.comp.ratio <= 2 && m.comp.gr <= 2);
  assert.ok(m.eq.every((e) => Math.abs(e.gain || 0) <= 2));
});

test('phones, tablets and small-memory devices polish instead of splitting (the splitter needs about 3 GB)', async () => {
  const { deviceFitsSplit } = await import('../public/js/mix/split.js');
  const real = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const as = (nav) => Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
  try {
    as({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 });
    assert.equal(deviceFitsSplit(), false, 'iPhone');
    as({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36', deviceMemory: 8 });
    assert.equal(deviceFitsSplit(), false, 'Android');
    as({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15', maxTouchPoints: 5 });
    assert.equal(deviceFitsSplit(), false, 'iPad asking for the desktop site');
    as({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36', deviceMemory: 4 });
    assert.equal(deviceFitsSplit(), false, '4 GB laptop');
    as({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36', deviceMemory: 8 });
    assert.equal(deviceFitsSplit(), true, '8 GB desktop');
    as({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15', maxTouchPoints: 0 });
    assert.equal(deviceFitsSplit(), true, 'Mac Safari');
  } finally { if (real) Object.defineProperty(globalThis, 'navigator', real); else delete globalThis.navigator; }
});
