import test from 'node:test';
import assert from 'node:assert/strict';
import { roleFromName, roleFromSound, labelStems, ROLES } from '../public/js/mix/roles.js';
import { analyzeStem, tempo, ENV_RATE } from '../public/js/mix/analyze.js';
import { planStrip, resonanceCuts, spreadPans, busBalance, toneMatch, faderGain, deessCurve, duckCurve, cleanMacros, STAGE_LUFS } from '../public/js/mix/plan.js';
import { ROLE_RULES, GENRES, TIPS, LIMITS } from '../public/js/mix/rules.js';
import { listZip, zipEntry, gather, directLink } from '../public/js/mix/intake.js';
import { zip } from '../public/js/website/export.js';
import worker from '../src/index.js';

const RATE = 44100;
const sine = (f, sec, amp = 0.5) => Float32Array.from({ length: Math.round(RATE * sec) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / RATE));
function clicks(bpm, sec) {
  const x = new Float32Array(Math.round(RATE * sec)), step = (60 / bpm) * RATE;
  for (let b = 0; b * step < x.length; b++) { const at = Math.round(b * step); for (let i = 0; i < 2000 && at + i < x.length; i++) x[at + i] = Math.sin((2 * Math.PI * 60 * i) / RATE) * Math.exp(-i / 400); }
  return x;
}

test('stems are labelled from their names, folders and sound', () => {
  const cases = { 'Kick.wav': 'kick', '808 Glide.wav': '808', 'Lead Vox.wav': 'leadVox', 'Hook DBL.wav': 'backVox', 'adlibs.wav': 'adlib', 'HiHat Open.wav': 'hats', 'Snare_Clap.wav': 'snare', 'Rhodes.wav': 'keys', 'Strings Pad.wav': 'pad', 'Gtr L.wav': 'guitar', 'Beat (instrumental).wav': 'beat', 'Riser FX.wav': 'fx', 'Drums/Audio 14.wav': 'drums' };
  for (const [name, role] of Object.entries(cases)) assert.equal(roleFromName(name), role, name);
  assert.equal(roleFromName('Audio 14.wav'), null);
  const sub = analyzeStem([sine(45, 4)], RATE);
  assert.equal(roleFromSound(sub), '808', 'a sustained 45 Hz tone is an 808');
  for (const r of Object.keys(ROLE_RULES)) assert.ok(ROLES[r], `${r} has a role card`);
});

test('one lead vocal: the longest vocal leads, short extra vocal files become backing', () => {
  const f = (s) => ({ activeSeconds: s });
  const out = labelStems([{ path: 'Vox.wav', feats: f(120) }, { path: 'Vocal 2.wav', feats: f(20) }, { path: 'Verse 2 Vocal.wav', feats: f(40) }]);
  assert.deepEqual(out.map((o) => o.role), ['leadVox', 'backVox', 'leadVox']);
});

test('tempo is found from the drum envelopes, also at trap tempos', () => {
  for (const bpm of [90, 128, 140]) {
    const f = analyzeStem([clicks(bpm, 12)], RATE);
    const t = tempo([f.env]);
    assert.ok(Math.abs(t.bpm - bpm) < 2, `${bpm} → ${t.bpm}`);
  }
  assert.equal(tempo([new Float32Array(10)]).bpm, 0);
});

test('channel strips follow the rulebook and stay inside the guardrails', () => {
  const voc = analyzeStem([Float32Array.from(sine(220, 6, 0.3), (v, i) => v * (Math.sin(i / 9000) > 0 ? 1 : 0.05))], RATE);
  const p = planStrip({ feats: voc, role: 'leadVox' }, { genre: 'trap', macros: cleanMacros({}), bpm: 140, length: voc.env.length });
  assert.equal(p.hpf, GENRES.trap.voxHpf);
  assert.equal(p.comp.ratio, GENRES.trap.voxRatio);
  assert.ok(p.comp.threshold < voc.loudDb + p.trim, 'the first compressor works on the loud passages');
  assert.ok(p.comp2.threshold < p.comp.threshold + 1, 'the second compressor sits under the first');
  assert.ok(Math.abs(p.delay.time - (0.75 * 60) / 140) < 1e-6, 'dotted-eighth delay at 140 BPM for trap');
  assert.ok(p.rider && p.deess, 'lead vocal is ridden and de-essed');
  for (const e of p.eq.filter((x) => /peaking|shelf/.test(x.type))) assert.ok(e.gain <= LIMITS.boost && e.gain >= -LIMITS.cut, 'EQ inside the guardrails');
  assert.equal(p.eq.filter((e) => e.type === 'highshelf').length, 1, 'shelves are merged');
  const kick = planStrip({ feats: analyzeStem([clicks(120, 4)], RATE), role: 'kick' }, { genre: 'trap', has808: true, length: 400 });
  assert.equal(kick.hpf, 40, 'the kick leaves the sub to the 808');
  assert.deepEqual(spreadPans(4).map((v) => Math.sign(v)), [-1, 1, -1, 1]);
});

test('resonances are cut narrowly and never more than the fix limit', () => {
  const flat = new Array(28).fill(-30); flat[12] = -18; // a 12 dB spike at 500 Hz
  const cuts = resonanceCuts(flat, 3);
  assert.equal(cuts.length, 1); assert.equal(cuts[0].f, 500); assert.ok(cuts[0].gain >= -LIMITS.fixCut && cuts[0].gain < 0); assert.ok(cuts[0].q > 3);
  assert.equal(resonanceCuts(new Array(28).fill(-30), 3).length, 0);
});

test('automation: the de-esser dips on sibilance, the sidechain on kicks', () => {
  const n = 300, sib = new Float32Array(n).fill(-60), pres = new Float32Array(n).fill(-20), active = new Uint8Array(n).fill(1);
  for (let k = 100; k < 110; k++) sib[k] = -12;
  const d = deessCurve({ sib, pres, active }, 6);
  assert.ok(Math.min(...d.slice(100, 112)) < -3 && Math.min(...d) >= -6.01 && d[50] === 0);
  const kick = new Float32Array(200).fill(-80); kick[50] = -10;
  const duck = duckCurve(kick, 5, 200);
  assert.ok(duck[50] <= -4.5 && duck[70] > -1 && duck[10] === 0);
});

test('bus balance puts the vocal its genre offset above the beat; tone match is gentle', () => {
  const b = busBalance({ beatLufs: -20, voxLufs: -26, genre: 'hiphop', macros: cleanMacros({ vox: 1 }) });
  assert.ok(Math.abs((-26 + b.vox) - (-20 + b.beat) - (GENRES.hiphop.vox + 1)) < 1e-9);
  const eq = toneMatch(new Array(10).fill(0), new Array(10).fill(20));
  assert.ok(eq.length && eq.every((e) => Math.abs(e.gain) <= 3));
  assert.equal(faderGain({ level: -6 }, -30), STAGE_LUFS - 6 + 30);
  assert.equal(faderGain({ level: 0 }, -Infinity), -120);
  assert.ok(TIPS.length >= 20 && TIPS.every((t) => t.length < 90));
  for (const g of Object.values(GENRES)) assert.ok(g.lufs <= -7 && g.lufs >= -14 && g.tp <= -1 && g.tone.length === 10);
});

test('stems come in from a zip (stored and deflated), with DAW project files noted', async () => {
  const wav = new Uint8Array(4000).fill(7);
  const blob = await zip([{ name: 'My Song/Kick.wav', data: wav }, { name: 'My Song/Lead Vox.wav', data: wav, compress: false }, { name: 'My Song/My Song.als', data: 'x'.repeat(300) }, { name: '__MACOSX/._Kick.wav', data: 'junk' }, { name: 'My Song/notes.txt', data: 'hi' }]);
  const file = new File([blob], 'session.zip', { type: 'application/zip' });
  const entries = await listZip(file);
  assert.equal(entries.length, 5);
  const kick = entries.find((e) => e.name.endsWith('Kick.wav'));
  assert.deepEqual(new Uint8Array(await (await zipEntry(file, kick)).arrayBuffer()), wav);
  const g = await gather([file]);
  assert.deepEqual(g.stems.map((s) => s.name), ['Kick', 'Lead Vox']);
  assert.deepEqual(g.sessions, ['Ableton Live']);
  assert.deepEqual(new Uint8Array(await (await g.stems[1].blob()).arrayBuffer()), wav);
});

test('share links become direct downloads', () => {
  assert.equal(directLink('https://www.dropbox.com/scl/fi/abc/stems.zip?rlkey=x&dl=0').url, 'https://www.dropbox.com/scl/fi/abc/stems.zip?rlkey=x&dl=1');
  assert.equal(directLink('https://drive.google.com/file/d/1AbCdEfGhIjK/view?usp=sharing').url, 'https://drive.usercontent.google.com/download?id=1AbCdEfGhIjK&export=download&confirm=t');
  assert.equal(directLink('ftp://x'), null);
});

const kv = () => { const m = new Map(); return { get: async (k) => m.get(k) || null, put: async (k, v) => m.set(k, v) }; };
const post = (path, body) => new Request('https://massless.test' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' }, body: JSON.stringify(body) });

test('the mix planner returns bounded roles and moves, and falls back cleanly', async () => {
  let reply = { response: { roles: ['leadVox', 'nonsense'], macros: { vox: 9, low: -1.2, bright: 'x' }, notes: 'Punchy and dry.' } };
  const env = { AI: { run: async () => reply }, MASSLESS_KV: kv() };
  const tracks = [{ name: 'Audio 1', role: 'synth' }, { name: 'Kick', role: 'kick', sure: true }];
  let res = await worker.fetch(post('/api/mix-plan', { genre: 'trap', tracks }), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.deepEqual(j.roles, ['leadVox', 'kick']);
  assert.deepEqual(j.macros, { vox: 3, low: -1, bright: 0, space: 0, width: 0, loud: 0 });
  reply = { response: 'not json' };
  res = await worker.fetch(post('/api/mix-plan', { genre: 'trap', tracks }), env, { waitUntil() {} });
  assert.equal(res.status, 502);
  assert.equal((await worker.fetch(post('/api/mix-plan', { tracks: [] }), env, { waitUntil() {} })).status, 400);
});

test('the link fetcher only fetches Dropbox and Google Drive', async () => {
  const env = { MASSLESS_KV: kv() };
  const res = await worker.fetch(new Request('https://massless.test/api/mix-fetch?url=' + encodeURIComponent('https://evil.example/x.zip')), env, { waitUntil() {} });
  assert.equal(res.status, 400);
});
