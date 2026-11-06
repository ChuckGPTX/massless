// DAW sessions: read the ones that came with the stems (or on their own), pick the one that places audio,
// and hand each recording its clips, track and role.

import { parseProTools, sessionLayout } from './protools.js';
import { parseReaper } from './reaper.js';
import { parseAbleton, inflateAls } from './ableton.js';
import { roleFromTrack } from '../roles.js';

/** File kinds we read. Others (Logic, FL Studio, Cubase, Studio One) are named but not read. */
export const SESSION_READERS = { ptx: 'Pro Tools', ptf: 'Pro Tools', rpp: 'REAPER', als: 'Ableton Live' };
export const SESSION_EXTS = Object.keys(SESSION_READERS);
export const canReadSession = (name) => SESSION_EXTS.includes(String(name).toLowerCase().split('.').pop());

/** Read one session file. Returns { daw, name, layout, tracks: [{ name, role, clips, files }] } or throws plainly. */
export async function readSession(file, name = file.name) {
  const ext = String(name).toLowerCase().split('.').pop();
  let parsed, daw;
  if (ext === 'ptx' || ext === 'ptf') { daw = 'Pro Tools'; parsed = parseProTools(new Uint8Array(await file.arrayBuffer())); }
  else if (ext === 'rpp') { daw = 'REAPER'; parsed = parseReaper(await file.text()); }
  else if (ext === 'als') { daw = 'Ableton Live'; parsed = parseAbleton(await inflateAls(file)); }
  else throw new Error(`${ext.toUpperCase()} sessions aren’t read yet. Export the stems from bar 1, or drop a Pro Tools, REAPER or Ableton session.`);
  const layout = sessionLayout(parsed);
  // every track, with its job and what's on it, so the page can show the session as the DAW does
  const byTrack = new Map();
  for (const f of layout.files) { const t = f.track; if (!byTrack.has(t)) byTrack.set(t, { files: [], clips: 0 }); byTrack.get(t).files.push(f.file); byTrack.get(t).clips += f.clips.length; }
  const tracks = parsed.tracks.map((t) => ({ name: t.name.replace(/\.dup\d+$/i, ''), role: roleFromTrack(t.name)?.role || null, bus: roleFromTrack(t.name) === null && /\b(bus|buss|sum|stem|subs?|master|print|aux|mix)\b/i.test(t.name), clips: byTrack.get(t.name)?.clips || 0, files: byTrack.get(t.name)?.files || [] }));
  return { daw, name, layout, tracks, bpm: parsed.bpm || null };
}

/**
 * Read several session files and choose the one to use: the one that places the most audio files, and among those
 * the newest. Returns { best, all: [{ name, daw, placed, error }] }. A session that places nothing (a template, or a
 * main file older than its auto-backup) is reported, not used.
 */
export async function readSessions(files) {
  const all = [];
  for (const f of files) {
    try { const s = await readSession(await (f.blob ? f.blob() : f), f.name); all.push({ ...s, placed: s.layout.files.length, mtime: f.mtime || 0, path: f.path || f.name }); }
    catch (e) { all.push({ name: f.name, daw: f.daw || null, placed: 0, error: e.message, mtime: f.mtime || 0, path: f.path || f.name }); }
  }
  const best = all.filter((s) => !s.error && s.placed > 0).sort((a, b) => b.placed - a.placed || b.mtime - a.mtime)[0] || all.find((s) => !s.error) || null;
  return { best, all };
}

const base = (p) => String(p).split(/[\\/]/).pop().toLowerCase();

/**
 * Give stems their clips, track names and roles from a session layout. Stems the session doesn't place are unused
 * takes. Returns { placed, unused, missing: [names the session wants that weren't dropped] }.
 */
export function applySession(stems, layout) {
  const byName = new Map(stems.map((s) => [base(s.path), s]));
  let placed = 0, unused = 0;
  const missing = [];
  for (const s of stems) { s.clips = null; s.track = null; s.unused = false; if (s.role && s.roleFromSession) { s.role = null; s.pan = undefined; } }
  for (const f of layout.files) {
    const s = byName.get(base(f.file));
    if (!s) { missing.push(f.file); continue; }
    s.clips = f.clips.map((c) => ({ start: c.start, offset: c.offset, length: c.length }));
    s.track = f.track;
    const r = roleFromTrack(f.track);
    if (r) { s.role = r.role; s.roleFromSession = true; if (typeof r.pan === 'number') s.pan = r.pan; }
    placed++;
  }
  for (const name of layout.unused) {
    const s = byName.get(base(name));
    if (!s) continue;
    s.unused = true; s.clips = null; s.track = null; s.role = 'skip'; s.roleFromSession = true;
    unused++;
  }
  // audio that the session never mentions at all (dropped alongside): mixed as exported, from bar 1
  return { placed, unused, missing };
}
