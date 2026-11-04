import test from 'node:test';
import assert from 'node:assert/strict';
import { installLoops } from '../public/js/loops-core.js';
import { aacDescription, audioSink } from '../public/js/aac.js';
import { planScenes, snapToBeat, LOOK_LOOPS, MOTION_LOOKS } from '../public/js/lyric-motion.js';
import { fallbackPrompts } from '../public/js/lyric-scenes.js';

function fakeCtx() {
  const calls = { fill: 0, stroke: 0 };
  const num = (...a) => a.forEach((x) => assert.ok(Number.isFinite(x), `finite argument: ${a}`));
  const ctx = new Proxy({
    fill: () => calls.fill++, stroke: () => calls.stroke++, fillRect: (...a) => { num(...a); calls.fill++; },
    arc: (x, y, r) => { num(x, y, r); assert.ok(r >= 0, 'radius is never negative'); }, ellipse: (x, y, rx, ry) => { num(x, y, rx, ry); assert.ok(rx >= 0 && ry >= 0); },
    moveTo: num, lineTo: num, arcTo: num, translate: num, scale: num, rotate: num,
  }, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  return { ctx, calls };
}

test('every Motion Loop draws something at every phase, in every shape of frame', () => {
  const { LOOPS, drawLoop, PALETTES } = installLoops();
  assert.ok(LOOPS.length >= 18);
  assert.equal(new Set(LOOPS.map((l) => l.id)).size, LOOPS.length, 'ids are unique');
  for (const l of LOOPS) for (const [w, h] of [[1080, 1080], [1080, 1920], [1920, 1080]]) for (const p of [0, 0.13, 0.5, 0.77, 0.9999]) {
    const { ctx, calls } = fakeCtx();
    drawLoop(ctx, l.id, p, w, h, { palette: 'ocean', bg: null });
    assert.ok(calls.fill + calls.stroke > 0, `${l.id} draws at p=${p}`);
  }
  for (const p of Object.values(PALETTES)) assert.equal(p.ink.length, 3);
});

test('the loop library is self-contained, so it can ship as one HTML file', () => {
  const src = installLoops.toString();
  const again = new Function(`return (${src})();`)();
  assert.deepEqual(again.LOOPS.map((l) => l.id), installLoops().LOOPS.map((l) => l.id));
});

test('AAC decoder description is written ourselves (Safari writes a broken one)', () => {
  assert.deepEqual([...aacDescription(48000, 2)], [0x11, 0x90]);
  assert.deepEqual([...aacDescription(44100, 2)], [0x12, 0x10]);
  assert.deepEqual([...aacDescription(44100, 1)], [0x12, 0x08]);
  assert.equal(aacDescription(12345, 2), null);
  const seen = [];
  const sink = audioSink({ addAudioChunk: (c, m) => seen.push(m) }, { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 });
  sink({ byteLength: 0 }, { decoderConfig: { codec: 'mp4a.40.2', sampleRate: 22050, numberOfChannels: 0, description: new Uint8Array([0, 0]) } });
  sink({ byteLength: 0 }, undefined);
  assert.deepEqual([...seen[0].decoderConfig.description], [0x11, 0x90]);
  assert.equal(seen[0].decoderConfig.sampleRate, 48000);
  assert.equal(seen[1], undefined, 'later chunks pass through');
  const opus = [];
  audioSink({ addAudioChunk: (c, m) => opus.push(m) }, { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 })({}, { x: 1 });
  assert.deepEqual(opus[0], { x: 1 }, 'Opus is left alone');
});

test('scene cuts land on the beat grid', () => {
  const beat = { period: 0.5, offset: 0.2 };
  const cut = snapToBeat(7.93, beat, 60);
  assert.ok(Math.abs(((cut - 0.2) / 2) - Math.round((cut - 0.2) / 2)) < 1e-9, `on a bar line: ${cut}`);
  assert.equal(snapToBeat(5, null, 60), 5);
  const cues = Array.from({ length: 12 }, (_, i) => ({ start: i * 4 + 0.37, end: i * 4 + 3.3, text: `line ${i}` }));
  const scenes = planScenes(cues, 48, 6, beat);
  for (const s of scenes.slice(1)) assert.ok(Math.abs(((s.start - 0.2) / 0.5) - Math.round((s.start - 0.2) / 0.5)) < 1e-9, `cut ${s.start} on a beat`);
  for (const id of Object.keys(MOTION_LOOKS)) assert.ok(LOOK_LOOPS[id]?.length, `${id} has loops`);
});

test('built-in scene pictures tell one story with one subject', () => {
  const scenes = Array.from({ length: 6 }, (_, i) => ({ start: i * 8, end: i * 8 + 8 }));
  const prompts = fallbackPrompts(scenes, [{ start: 1, end: 3, text: 'dancing tonight' }], 'Glow');
  assert.equal(prompts.length, 6);
  const subject = prompts[0].match(/shot of (.+?), something/)[1];
  for (const p of prompts) { assert.ok(p.includes(subject), 'same subject in every scene'); assert.match(p, /No text/); }
  assert.match(prompts[0], /opening shot/); assert.match(prompts.at(-1), /final/);
});
