// DAW bundles: one file that carries a project's recordings inside it. Opened here into plain WAV files the
// rest of the site already plays, trims, converts and mixes. Nothing is copied: each recording is a view onto the
// bundle's bytes (a 44-byte header plus a slice), so a 2 GB bundle costs no memory to open.
//
// Cakewalk / SONAR bundle (.cwb, older .bun): a RIFF WAVE. The first recording sits at the top level (fmt, data);
// every further recording is a LIST chunk of type WAVE with its own fmt and data; Cakewalk's PAD chunks sit
// between; the project itself (tracks, clips, mixer) is a final cwp1 chunk in Cakewalk's own format, which is
// not public, so where each clip sits on the timeline is not read: every recording comes back whole.

export const BUNDLE_EXT = /\.(cwb|bun)$/i;

const fourcc = (u8, o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);

/** By name, or by a quick look inside: a RIFF WAVE with a nested WAVE list or a Cakewalk project chunk. */
export async function looksLikeBundle(file, { peek = true } = {}) {
  if (BUNDLE_EXT.test(file.name)) return true;
  if (!peek || !/\.(wav|wave)$/i.test(file.name) || file.size < 64) return false;
  try { return (await scanRiff(file)).recordings.length > 1; } catch { return false; }
}

/** Walk the chunk tree without reading the audio. Returns { recordings: [{ fmt, dataStart, dataSize }], project: { start, size } | null }. */
async function scanRiff(file) {
  const headOf = async (at, n = 12) => new Uint8Array(await file.slice(at, Math.min(file.size, at + n)).arrayBuffer());
  const top = await headOf(0, 12);
  if (fourcc(top, 0) !== 'RIFF' || fourcc(top, 8) !== 'WAVE') throw new Error('Not a RIFF WAVE bundle.');
  const recordings = [];
  let project = null;
  const walk = async (pos, end, depth) => {
    let fmt = null;
    while (pos + 8 <= end) {
      const h = await headOf(pos, 12);
      if (h.length < 8) break;
      const id = fourcc(h, 0), size = new DataView(h.buffer).getUint32(4, true);
      if (id === 'fmt ') {
        const f = new DataView((await headOf(pos + 8, Math.min(size, 40))).buffer);
        let tag = f.getUint16(0, true);
        if (tag === 0xfffe && size >= 26) tag = f.getUint16(24, true);
        fmt = { tag, channels: f.getUint16(2, true), rate: f.getUint32(4, true), align: f.getUint16(12, true), bits: f.getUint16(14, true) };
      } else if (id === 'data') {
        const dataSize = Math.min(size === 0xffffffff ? end - pos - 8 : size, end - pos - 8);
        if (fmt && dataSize > 0) recordings.push({ fmt, dataStart: pos + 8, dataSize });
        fmt = null;
      } else if (id === 'LIST' && fourcc(h, 8) === 'WAVE' && depth < 2) {
        await walk(pos + 12, Math.min(end, pos + 8 + size), depth + 1);
      } else if (/^cwp/.test(id)) project = { start: pos + 8, size };
      pos += 8 + size + (size & 1);
    }
  };
  await walk(12, file.size, 0);
  return { recordings, project };
}

function wavHeader({ channels, rate, bits, tag }, dataSize) {
  const b = new ArrayBuffer(44), v = new DataView(b), put = (o, s) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  put(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); put(8, 'WAVE'); put(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, tag === 3 ? 3 : 1, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * channels * (bits / 8), true); v.setUint16(32, channels * (bits / 8), true); v.setUint16(34, bits, true);
  put(36, 'data'); v.setUint32(40, dataSize, true);
  return b;
}

/** Track names the project chunk mentions (best effort: clip names like "07 Track 7 (59)" give "Track 7"). */
function trackNames(u8) {
  const text = new TextDecoder('latin1').decode(u8), names = [];
  for (const m of text.matchAll(/(?:^|[^\x20-\x7e])\d{2} ([\x20-\x7e]{1,60}?) \(\d+\)(?=[^\x20-\x7e])/g)) if (!names.includes(m[1])) names.push(m[1]);
  return names;
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Open a bundle. Returns { kind, recordings: [File], tracks: [names], note } where each File is a standalone WAV
 * named after the bundle, numbered, with `.bundle = { source, index, count, channels, rate, bits, duration }`.
 */
export async function unbundle(file) {
  const { recordings, project } = await scanRiff(file);
  if (!recordings.length) throw new Error(`${file.name} has no audio inside that this reader understands.`);
  const base = file.name.replace(/\.[^.]+$/, '');
  let tracks = [];
  if (project && project.size < 64 << 20) { try { tracks = trackNames(new Uint8Array(await file.slice(project.start, project.start + project.size).arrayBuffer())); } catch { /* names are a nicety */ } }
  const out = recordings.map((r, i) => {
    const { fmt } = r, duration = r.dataSize / (fmt.rate * fmt.align || 1);
    const label = tracks.length === recordings.length ? tracks[i] : `recording ${i + 1}`;
    const name = `${base} · ${label} (${fmt.channels === 1 ? 'mono' : fmt.channels === 2 ? 'stereo' : fmt.channels + ' ch'}, ${fmtTime(duration)}).wav`;
    const f = new File([wavHeader(fmt, r.dataSize), file.slice(r.dataStart, r.dataStart + r.dataSize)], name, { type: 'audio/wav', lastModified: file.lastModified });
    f.bundle = { source: file.name, index: i, count: recordings.length, channels: fmt.channels, rate: fmt.rate, bits: fmt.bits, duration };
    return f;
  });
  const kind = BUNDLE_EXT.test(file.name) || project ? 'Cakewalk bundle' : 'WAV bundle';
  return { kind, recordings: out, tracks, note: `${kind}: ${out.length} recording${out.length === 1 ? '' : 's'} inside, each opened whole. ${project ? 'Cakewalk keeps where its clips sit in its own project format, so the recordings play from their start.' : ''}`.trim() };
}

/** Expand any bundles in a file list into their recordings; everything else passes through. */
export async function expandBundles(files, onBundle) {
  const out = [];
  for (const f of files) {
    if (await looksLikeBundle(f, { peek: false })) {
      try { const b = await unbundle(f); out.push(...b.recordings); onBundle?.(f, b); continue; } catch (e) { onBundle?.(f, null, e); continue; }
    }
    out.push(f);
  }
  return out;
}
