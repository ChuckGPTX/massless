// Session files: REAPER projects read from text, the best of several sessions chosen, audio matched later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReaper } from '../public/js/mix/sessions/reaper.js';
import { sessionLayout } from '../public/js/mix/sessions/protools.js';
import { readSessions, applySession, canReadSession } from '../public/js/mix/sessions/index.js';
import { gather } from '../public/js/mix/intake.js';

const RPP = `<REAPER_PROJECT 0.1 "7.0/macOS-arm64" 1700000000
  TEMPO 150 4 4
  <TRACK {A}
    NAME "Beat"
    <ITEM
      POSITION 0
      LENGTH 120.5
      SOFFS 0
      NAME "beat.wav"
      <SOURCE WAVE
        FILE "/Users/x/Audio Files/beat.wav"
      >
    >
  >
  <TRACK {B}
    NAME "Vox Main A"
    <ITEM
      POSITION 24.4
      LENGTH 21.1
      SOFFS 69.2
      NAME "take 01"
      <SOURCE WAVE
        FILE "Record Mono_01.wav"
      >
    >
    <ITEM
      POSITION 83.25
      LENGTH 13.5
      SOFFS 70.45
      MUTE 0
      <SOURCE WAVE
        FILE "Record Mono_01.wav"
      >
    >
    <ITEM
      POSITION 50
      LENGTH 3
      SOFFS 0
      MUTE 1
      <SOURCE WAVE
        FILE "Record Mono_02.wav"
      >
    >
  >
  <TRACK {C}
    NAME "Dub L"
    <ITEM
      POSITION 25.4
      LENGTH 20.5
      SOFFS 6.2
      <SOURCE WAVE
        FILE "Record Mono_18.wav"
      >
    >
  >
>`;

test('a REAPER project gives tracks, items with their positions and sources; muted items are left out', () => {
  const s = parseReaper(RPP, 48000), L = sessionLayout(s);
  assert.deepEqual(s.tracks.map((t) => t.name), ['Beat', 'Vox Main A', 'Dub L']);
  assert.deepEqual(L.files.map((f) => [f.track, f.file, f.clips.length]), [['Beat', 'beat.wav', 1], ['Vox Main A', 'Record Mono_01.wav', 2], ['Dub L', 'Record Mono_18.wav', 1]]);
  const take = L.files[1].clips[1];
  assert.ok(Math.abs(take.start - 83.25) < 1e-3 && Math.abs(take.offset - 70.45) < 1e-3 && Math.abs(take.length - 13.5) < 1e-3);
  assert.ok(!L.files.some((f) => f.file === 'Record Mono_02.wav'), 'the muted item is not placed');
});

test('of several session files, the one that places audio wins over an older main file that places none', async () => {
  const empty = `<REAPER_PROJECT 0.1 "7.0" 1\n  <TRACK\n    NAME "Beat"\n  >\n>`;
  const asFile = (text, name, mtime) => ({ name, path: name, mtime, blob: async () => new File([text], name) });
  const { best, all } = await readSessions([asFile(empty, 'Main.rpp', 10), asFile(RPP, 'Backups/Main.bak.rpp', 20)]);
  assert.equal(best.name, 'Backups/Main.bak.rpp'); assert.equal(best.placed, 3);
  assert.equal(all.find((s) => s.name === 'Main.rpp').placed, 0);
  assert.ok(canReadSession('x.ptx') && canReadSession('x.als') && canReadSession('x.rpp') && !canReadSession('x.logicx'));
});

test('audio dropped after the session goes to its tracks; files the session wants but has not got are named', () => {
  const layout = sessionLayout(parseReaper(RPP, 48000));
  const stems = [{ name: 'Record Mono_01', path: 'Record Mono_01.wav' }, { name: 'Record Mono_02', path: 'Record Mono_02.wav' }];
  const r = applySession(stems, layout);
  assert.deepEqual(r, { placed: 1, unused: 1, missing: ['beat.wav', 'Record Mono_18.wav'] });
  assert.equal(stems[0].role, 'leadVox'); assert.equal(stems[0].clips.length, 2); assert.equal(stems[1].role, 'skip');
  // applying again (a second drop) starts clean, so nothing is placed twice
  stems.push({ name: 'beat', path: 'Audio Files/beat.wav' });
  const r2 = applySession(stems, layout);
  assert.deepEqual(r2, { placed: 2, unused: 1, missing: ['Record Mono_18.wav'] });
  assert.equal(stems[2].role, 'beat');
});

test('session files are kept from the backup folder too, with their dates, and backup audio is still skipped', async () => {
  const f = (name, rel, mtime) => Object.assign(new File(['x'], name, { lastModified: mtime }), { relativePath: rel });
  const g = await gather([f('Main Event.ptx', 'Main Event/Main Event.ptx', 100), f('Main Event.bak.000.ptx', 'Main Event/Session File Backups/Main Event.bak.000.ptx', 200), f('old.wav', 'Main Event/Session File Backups/old.wav', 50), f('beat.wav', 'Main Event/Audio Files/beat.wav', 60)]);
  assert.deepEqual(g.sessionFiles.map((s) => [s.name, s.mtime]), [['Main Event.ptx', 100], ['Main Event.bak.000.ptx', 200]]);
  assert.deepEqual(g.stems.map((s) => s.name), ['beat']);
});
