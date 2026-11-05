// DAW sessions: read the one that came with the stems and hand each recording its clips, track and role.

import { parseProTools, sessionLayout } from './protools.js';
import { roleFromTrack } from '../roles.js';

export const SESSION_READERS = { ptx: 'Pro Tools', ptf: 'Pro Tools' };

/** Read a session file. Returns { daw, layout } or throws with a plain message. */
export async function readSession(file) {
  const ext = String(file.name).toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (ext === 'ptx' || ext === 'ptf') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { daw: 'Pro Tools', layout: sessionLayout(parseProTools(bytes)) };
  }
  throw new Error(`Sessions from ${file.name.split('.').pop()} files aren’t read yet.`);
}

const base = (p) => String(p).split('/').pop().toLowerCase();

/**
 * Give stems their clips, track names and roles from a session layout. Stems the session doesn't place are unused
 * takes. Returns { placed, unused, missing } counts (missing: files the session names that weren't dropped).
 */
export function applySession(stems, layout) {
  const byName = new Map(stems.map((s) => [base(s.path), s]));
  let placed = 0, unused = 0, missing = 0;
  for (const f of layout.files) {
    const s = byName.get(base(f.file));
    if (!s) { missing++; continue; }
    s.clips = f.clips.map((c) => ({ start: c.start, offset: c.offset, length: c.length }));
    s.track = f.track;
    const r = roleFromTrack(f.track);
    if (r) { s.role = r.role; if (typeof r.pan === 'number') s.pan = r.pan; }
    s.unused = false;
    placed++;
  }
  for (const name of layout.unused) {
    const s = byName.get(base(name));
    if (!s) continue;
    s.unused = true; s.clips = null; s.track = null; s.role = 'skip';
    unused++;
  }
  return { placed, unused, missing };
}
