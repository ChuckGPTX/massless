// A Cakewalk-style bundle built by hand: a top-level recording, a second one in a LIST/WAVE, PAD chunks and a
// project chunk. The reader must find both recordings and hand back standalone WAVs that slice the bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unbundle, looksLikeBundle, expandBundles, BUNDLE_EXT } from '../public/js/bundles.js';

const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const u16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; };
const chunk = (id, ...parts) => { const body = cat(...parts); return cat(ascii(id), u32(body.length), body, body.length & 1 ? new Uint8Array(1) : new Uint8Array(0)); };
function cat(...parts) { const n = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
const fmt = (ch, rate, bits) => chunk('fmt ', u16(1), u16(ch), u32(rate), u32(rate * ch * (bits / 8)), u16(ch * (bits / 8)), u16(bits), u16(0));
const pcm = (frames, ch, v) => { const b = new Uint8Array(frames * ch * 2); for (let i = 0; i < frames * ch; i++) new DataView(b.buffer).setInt16(i * 2, v + i, true); return b; };

function bundle() {
  const a = pcm(1000, 1, 100), b = pcm(500, 2, -7);
  const project = cat(ascii('Cakewalk_SONAR'), new Uint8Array(3), ascii('07 Track 7 (59)'), new Uint8Array(5), ascii('02 Beat (3)'), new Uint8Array(2));
  const body = cat(ascii('WAVE'), fmt(1, 44100, 16), chunk('PAD ', new Uint8Array(37)), chunk('data', a), chunk('PAD ', new Uint8Array(4)),
    chunk('LIST', ascii('WAVE'), fmt(2, 48000, 16), chunk('PAD ', new Uint8Array(9)), chunk('data', b)), chunk('cwp1', project));
  return { file: new File([chunk('RIFF', body)], 'My song.cwb'), a, b };
}

test('a Cakewalk bundle opens into its recordings, each a standalone WAV over the bundle bytes', async () => {
  const { file, a, b } = bundle();
  assert.ok(BUNDLE_EXT.test(file.name));
  assert.equal(await looksLikeBundle(file), true);
  const r = await unbundle(file);
  assert.equal(r.kind, 'Cakewalk bundle');
  assert.equal(r.recordings.length, 2);
  assert.deepEqual(r.tracks, ['Track 7', 'Beat']);
  const [one, two] = r.recordings;
  assert.equal(one.name, 'My song · Track 7 (mono, 0:00).wav');
  assert.equal(two.name, 'My song · Beat (stereo, 0:00).wav');
  assert.deepEqual({ ...one.bundle, duration: +one.bundle.duration.toFixed(4) }, { source: 'My song.cwb', index: 0, count: 2, channels: 1, rate: 44100, bits: 16, duration: +(1000 / 44100).toFixed(4) });
  assert.equal(two.bundle.channels, 2); assert.equal(two.bundle.rate, 48000);
  // each file is a well-formed WAV whose data is exactly the recording's bytes
  for (const [f, data] of [[one, a], [two, b]]) {
    const u8 = new Uint8Array(await f.arrayBuffer());
    assert.equal(String.fromCharCode(...u8.subarray(0, 4)), 'RIFF'); assert.equal(String.fromCharCode(...u8.subarray(36, 40)), 'data');
    assert.equal(new DataView(u8.buffer).getUint32(40, true), data.length);
    assert.equal(u8.length, 44 + data.length);
    assert.deepEqual(u8.subarray(44), data);
  }
});

test('expandBundles opens bundles in a list and leaves other files alone', async () => {
  const { file } = bundle();
  const plain = new File([new Uint8Array(10)], 'take.wav');
  const seen = [];
  const out = await expandBundles([plain, file], (f, b) => seen.push([f.name, b.recordings.length]));
  assert.equal(out.length, 3); assert.equal(out[0], plain); assert.ok(out[1].bundle && out[2].bundle);
  assert.deepEqual(seen, [['My song.cwb', 2]]);
  await assert.rejects(unbundle(new File([new Uint8Array(100)], 'junk.cwb')), /Not a RIFF WAVE bundle/);
});
