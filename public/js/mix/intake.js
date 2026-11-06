// Getting stems in: loose audio files, a dropped folder, a .zip (stems or a whole DAW session folder), or a link.
// Zips are read straight from the file with File.slice, one entry at a time, so a 2 GB session never sits in memory.
// Stored entries are sliced; deflated ones go through the browser's own DecompressionStream.

import { unbundle, BUNDLE_EXT } from '../bundles.js';

export const AUDIO_EXT = /\.(wav|wave|aif|aiff|aifc|mp3|m4a|aac|flac|ogg|oga|opus|caf|webm)$/i;
export const SESSION_EXT = { als: 'Ableton Live', alp: 'Ableton Live pack', logicx: 'Logic Pro', flp: 'FL Studio', ptx: 'Pro Tools', ptf: 'Pro Tools', cpr: 'Cubase', rpp: 'REAPER', song: 'Studio One', band: 'GarageBand', bwproject: 'Bitwig', reason: 'Reason' };
export const MAX_STEMS = 48;
const SKIP = /(^|\/)(__MACOSX|\.DS_Store|\._|[^/]*Backups?[^/]*\/|Freeze Files|Samples\/Imported\/.*preview)/i;

const sessionOf = (name) => { const m = String(name).toLowerCase().match(/\.([a-z]+)$/); return m && SESSION_EXT[m[1]] ? SESSION_EXT[m[1]] : null; };
const baseName = (p) => String(p).split('/').pop();

// ---------- zip ----------

function u16(v, o) { return v.getUint16(o, true); }
function u32(v, o) { return v.getUint32(o, true); }
function u64(v, o) { return Number(v.getBigUint64(o, true)); }

/** List a zip's entries: [{ name, size, compressed, method, offset }]. */
export async function listZip(file) {
  const tail = Math.min(file.size, 65557 + 20);
  const buf = new DataView(await file.slice(file.size - tail).arrayBuffer());
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= 0; i--) if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This doesn’t look like a zip file. Zip the stems again, or drop the audio files themselves.');
  let count = u16(buf, eocd + 10), cdSize = u32(buf, eocd + 12), cdOff = u32(buf, eocd + 16);
  // Zip64: the real numbers live in the zip64 end record.
  if (cdOff === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && u32(buf, loc) === 0x07064b50) {
      const recOff = u64(buf, loc + 8);
      const rec = new DataView(await file.slice(recOff, recOff + 56).arrayBuffer());
      count = u64(rec, 32); cdSize = u64(rec, 40); cdOff = u64(rec, 48);
    }
  }
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const out = [], dec = new TextDecoder();
  for (let p = 0, k = 0; k < count && p + 46 <= cd.byteLength; k++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const method = u16(cd, p + 10), flags = u16(cd, p + 8);
    let compressed = u32(cd, p + 20), size = u32(cd, p + 24), offset = u32(cd, p + 42);
    const nLen = u16(cd, p + 28), xLen = u16(cd, p + 30), cLen = u16(cd, p + 32);
    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nLen);
    const name = (flags & 0x800 ? dec : new TextDecoder('utf-8')).decode(nameBytes);
    // zip64 extra field
    for (let x = p + 46 + nLen, end = x + xLen; x + 4 <= end;) {
      const id = u16(cd, x), len = u16(cd, x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (size === 0xffffffff) { size = u64(cd, q); q += 8; }
        if (compressed === 0xffffffff) { compressed = u64(cd, q); q += 8; }
        if (offset === 0xffffffff) { offset = u64(cd, q); }
      }
      x += 4 + len;
    }
    if (!name.endsWith('/')) out.push({ name, size, compressed, method, offset, encrypted: !!(flags & 1) });
    p += 46 + nLen + xLen + cLen;
  }
  return out;
}

/** One entry as a Blob (lazy: nothing is read until it's decoded). */
export async function zipEntry(file, entry) {
  const head = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer());
  if (u32(head, 0) !== 0x04034b50) throw new Error(`Couldn’t read ${baseName(entry.name)} from the zip.`);
  const start = entry.offset + 30 + u16(head, 26) + u16(head, 28);
  const raw = file.slice(start, start + entry.compressed);
  if (entry.encrypted) throw new Error('This zip is password-protected. Zip the stems again without a password.');
  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error(`${baseName(entry.name)} uses a zip compression this browser can’t open. Re-zip with standard settings.`);
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t unzip files. Unzip the stems and drop the audio files instead.');
  return await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
}

// ---------- gathering ----------

/**
 * Turn whatever was dropped into a list of stems.
 * items: File[] (files, a folder's files with webkitRelativePath, or one zip).
 * Returns { stems: [{ name, path, size, blob() }], sessions: ['Ableton Live', ...], sessionFiles: [{ name, path, daw, size, blob() }], skipped: [names],
 * bundles: [{ name, kind, count, note }] (Cakewalk bundles opened into their recordings) }.
 */
export async function gather(files) {
  const stems = [], sessions = new Set(), sessionFiles = [], skipped = [], bundles = [];
  const mtimes = new Map();
  const mtimeOf = (path) => mtimes.get(path) || 0;
  const add = (path, size, blob) => {
    // Session files are kept even from the DAW's backup folder: the newest backup is often the only one with the
    // audio placed. Backup audio and OS droppings are skipped.
    const s = sessionOf(path);
    if (s) { if (/(^|\/)(__MACOSX|\._)/.test(path)) return; sessions.add(s); sessionFiles.push({ name: baseName(path), path, daw: s, size, mtime: mtimeOf(path), blob }); return; }
    if (SKIP.test(path)) return;
    if (!AUDIO_EXT.test(path)) { if (!/\.(txt|pdf|png|jpe?g|asd|reapeaks|pkf|xml|json|mid|midi|nfo|ini)$/i.test(path)) skipped.push(baseName(path)); return; }
    stems.push({ name: baseName(path).replace(AUDIO_EXT, ''), path, size, blob });
  };
  for (let f of files) {
    const path = f.webkitRelativePath || f.relativePath || f.name;
    mtimes.set(path, f.lastModified || 0);
    if (BUNDLE_EXT.test(f.name)) { // a Cakewalk bundle: its recordings, each a stem
      try { const b = await unbundle(f); bundles.push({ name: f.name, kind: b.kind, count: b.recordings.length, note: b.note }); for (const r of b.recordings) { add(r.name, r.size, async () => r); stems[stems.length - 1].fromBundle = true; } } catch (e) { skipped.push(f.name); }
      continue;
    }
    if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
      const entries = await listZip(f);
      for (const e of entries) add(e.name, e.size, () => zipEntry(f, e));
    } else add(path, f.size, async () => f);
  }
  // Bounces and stems of the same song often sit together: drop exact duplicates by name and size.
  const seen = new Set(), unique = [];
  for (const s of stems) { const k = `${s.name.toLowerCase()}|${s.size}`; if (!seen.has(k)) { seen.add(k); unique.push(s); } }
  unique.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  if (unique.length > MAX_STEMS) throw new Error(`That’s ${unique.length} audio files. Mix up to ${MAX_STEMS} stems at a time: group similar parts (for example all background vocals) into one stem.`);
  // The session file itself: the newest one at the top of the folder (backups are skipped above).
  sessionFiles.sort((a, b) => a.path.split('/').length - b.path.split('/').length || b.size - a.size);
  return { stems: unique, sessions: [...sessions], sessionFiles, skipped, bundles };
}

// ---------- links ----------

/** Rewrite share links into direct downloads where the host allows it. */
export function directLink(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'dropbox.com' || host.endsWith('.dropbox.com')) { u.searchParams.set('dl', '1'); return { url: u.href, host: 'Dropbox', proxy: true }; }
  if (host === 'drive.google.com') {
    const id = u.pathname.match(/\/d\/([\w-]{10,})/)?.[1] || u.searchParams.get('id');
    if (!id) return null;
    return { url: `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, host: 'Google Drive', proxy: true };
  }
  return { url: u.href, host, proxy: false };
}

/** Download a linked zip or audio file. Tries the browser first, then our proxy for Dropbox and Google Drive. */
export async function fetchLink(raw, { apiFetch, onProgress, signal } = {}) {
  const link = directLink(raw);
  if (!link) throw new Error('Paste a full link that starts with https://');
  const read = async (res) => {
    if (!res.ok) throw new Error(res.status === 404 ? 'That link wasn’t found. Check it’s shared with “anyone with the link”.' : `The link answered ${res.status}. Make sure it’s shared publicly.`);
    const type = res.headers.get('content-type') || '';
    if (/text\/html/.test(type)) throw new Error(`${link.host} sent a web page instead of the file. Make sure the link is shared publicly, or download it and drop it here.`);
    const total = Number(res.headers.get('content-length')) || 0, reader = res.body.getReader(), parts = [];
    let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; onProgress?.(total ? got / total : 0, got); }
    const name = decodeURIComponent((res.headers.get('content-disposition') || '').match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] || new URL(link.url).pathname.split('/').pop() || 'stems.zip');
    return new File(parts, name, { type: type.split(';')[0] || 'application/octet-stream' });
  };
  if (!link.proxy) {
    try { return await read(await fetch(link.url, { signal })); }
    catch (e) { if (signal?.aborted || /answered|wasn’t found|web page/.test(e.message)) throw e; throw new Error('That site won’t let other sites download its files. Download the zip and drop it here.'); }
  }
  return read(await apiFetch(`/api/mix-fetch?url=${encodeURIComponent(link.url)}`, { signal }));
}
