// Reads a Pro Tools session (.ptx, Pro Tools 10 and later; .ptf, 5 to 9): which audio file sits on which track,
// where on the timeline, trimmed how, and the track names. Written from the file layout as it is understood
// publicly (the session is a light byte scramble over nested tagged blocks); no Avid code or data is used.
// Mutes, fades, volume and plug-ins are not read: the mix engine makes those calls itself.

const ZMARK = 0x5a;
const TAG = {
  sampleRate: 0x1028,
  wavList: 0x1004, wavNames: 0x103a, wavMeta: 0x1003, wavInfo: 0x1001,
  clipList10: 0x262a, clip10: 0x2629, clipList5: 0x100b, clip5: 0x1008,
  trackList: 0x1015, track: 0x1014,
  placeMap8: 0x1054, placeTrack8: 0x1052, placeEntry8: 0x1050, placeSub8: 0x104f,
  placeMap5: 0x1012, placeTrack5: 0x1011, placeEntry5: 0x100f, placeSub5: 0x100e,
};

/** Undo the scramble: 20 clear bytes, then a 256-byte key, chosen by two header bytes, applied by position. */
export function unscramble(bytes) {
  const out = new Uint8Array(bytes);
  if (out.length < 0x14) throw new Error('Not a Pro Tools session.');
  const type = out[0x12], value = out[0x13];
  let delta = 0;
  const mul = type === 0x01 ? 53 : type === 0x05 ? 11 : 0;
  if (!mul) throw new Error('This Pro Tools session version isn’t supported. Export the stems from bar 1 instead.');
  for (let i = 0; i < 256; i++) if (((i * mul) & 0xff) === value) { delta = type === 0x05 ? (-i) & 0xff : i; break; }
  const key = new Uint8Array(256);
  for (let i = 0; i < 256; i++) key[i] = (i * delta) & 0xff;
  for (let i = 0x14; i < out.length; i++) out[i] ^= key[type === 0x01 ? i & 0xff : (i >> 12) & 0xff];
  return out;
}

class Reader {
  constructor(buf) { this.b = buf; this.big = !!buf[0x11]; this.v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  u16(p) { return this.v.getUint16(p, !this.big); }
  u32(p) { return this.v.getUint32(p, !this.big); }
  u64(p) { return Number(this.v.getBigUint64(p, !this.big)); }
  str(p) { const n = this.u32(p); return new TextDecoder('latin1').decode(this.b.subarray(p + 4, p + 4 + n)); }
  /** Little-endian integer of n bytes (clip positions are stored this way whatever the file's byte order). */
  le(p, n) { let x = 0; for (let i = n - 1; i >= 0; i--) x = x * 256 + this.b[p + i]; return x; }
  /** One block at pos: { type, size, offset (where its payload starts), children }. Null if there's none. */
  block(pos, max) {
    if (this.b[pos] !== ZMARK || pos + 9 > this.b.length) return null;
    const kind = this.u16(pos + 1), size = this.u32(pos + 3), type = this.u16(pos + 7), offset = pos + 7;
    if (kind & 0xff00 || size + offset > max) return null;
    const blk = { type, size, offset, children: [] };
    for (let i = 1; i < size && pos + i < max;) {
      const c = this.block(pos + i, offset + size);
      if (c) { blk.children.push(c); i += c.size + 7; } else i++;
    }
    return blk;
  }
  blocks() {
    const out = [];
    for (let i = 0x14; i < this.b.length;) { const blk = this.block(i, this.b.length); if (blk) { out.push(blk); i += blk.size + 7; } else i++; }
    return out;
  }
}

const walk = (blocks, type, fn) => { for (const b of blocks) { if (b.type === type) fn(b); walk(b.children, type, fn); } };

/** Three variable-width little-endian numbers: how far into the file the clip starts, how long it is, where it sits. */
function threePoint(r, j) {
  const big = r.big;
  const offsetBytes = (r.b[j + (big ? 4 : 1)] & 0xf0) >> 4, lengthBytes = (r.b[j + (big ? 3 : 2)] & 0xf0) >> 4, startBytes = (r.b[j + (big ? 2 : 3)] & 0xf0) >> 4;
  let p = j + 5;
  const offset = r.le(p, offsetBytes); p += offsetBytes;
  const length = r.le(p, lengthBytes); p += lengthBytes;
  const start = r.le(p, startBytes);
  return { offset, length, start };
}

/**
 * Parse a session. Returns { rate, files: [names], clips: [{ name, file, offset, length, start }], tracks: [{ name, channels }],
 * placements: [{ track, trackName, clip, start, fade }] } with every position in samples at the session rate.
 */
export function parseProTools(bytes) {
  const buf = unscramble(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (buf[0] !== 0x03 && new TextDecoder('latin1').decode(buf.subarray(0, 0x100)).indexOf('0010111100101011') !== 1) throw new Error('Not a Pro Tools session.');
  const r = new Reader(buf), top = r.blocks();
  let rate = 0;
  walk(top, TAG.sampleRate, (b) => { rate = r.u32(b.offset + 4); });
  if (rate < 44100 || rate > 192000) throw new Error('Couldn’t read the session’s sample rate.');
  const isAudio = (name, type) => /\.(wav|aif|aiff|mxf)$/i.test(name) || /WAVE|EVAW|AIFF|FFIA|fFXM|MXFf/.test(type);

  // audio files, in the order clips refer to them
  const files = [];
  walk(top, TAG.wavList, (b) => {
    const n = r.u32(b.offset + 2);
    walk(b.children, TAG.wavNames, (c) => {
      let p = c.offset + 11;
      while (p < c.offset + c.size && files.length < n) {
        const name = r.str(p); p += name.length + 4;
        const type = new TextDecoder('latin1').decode(buf.subarray(p, p + 4)); p += 9;
        if (/\.grp$|Audio Files|Fade Files/.test(name) || !isAudio(name, type)) continue;
        files.push(name);
      }
    });
  });

  // clips: a name, a file index and where in that file they start, their length, and a default position
  const clips = [];
  const readClips = (listTag, clipTag) => walk(top, listTag, (b) => {
    for (const c of b.children) {
      if (c.type !== clipTag || !c.children.length) continue;
      let j = c.offset + 11;
      const name = r.str(j); j += name.length + 4;
      const { offset, length, start } = threePoint(r, j);
      const d = c.children[0], file = r.u32(d.offset + d.size);
      clips.push({ name, file, fileName: files[file] ?? null, offset, length, start, index: clips.length });
    }
  });
  readClips(TAG.clipList10, TAG.clip10);
  if (!clips.length) readClips(TAG.clipList5, TAG.clip5);

  // tracks, with their channel slots (a stereo track takes two)
  const tracks = [];
  walk(top, TAG.trackList, (b) => {
    for (const c of b.children) {
      if (c.type !== TAG.track) continue;
      let j = c.offset + 2;
      const name = r.str(j); j += name.length + 5;
      const nch = r.u32(j); j += 4;
      const channels = [];
      for (let i = 0; i < nch && i < 8; i++) { channels.push(r.u16(j)); j += 2; }
      tracks.push({ name, channels, index: tracks.length });
    }
  });

  // placements: which clip plays on which track, from where
  const placements = [];
  let placed = false;
  walk(top, TAG.placeMap8, (b) => {
    placed = true;
    let t = 0;
    for (const c of b.children) {
      if (c.type !== TAG.placeTrack8) continue;
      const trackName = r.str(c.offset + 2);
      for (const d of c.children) {
        if (d.type !== TAG.placeEntry8) continue;
        const fade = buf[d.offset + 46] === 0x01;
        for (const e of d.children) {
          if (e.type !== TAG.placeSub8) continue;
          const clip = r.u32(e.offset + 4), start = r.u32(e.offset + 9);
          if (clips[clip]) placements.push({ track: t, trackName, clip, start, fade });
        }
      }
      t++;
    }
  });
  if (!placed) walk(top, TAG.placeMap5, (b) => {
    let t = 0;
    for (const c of b.children) {
      if (c.type !== TAG.placeTrack5) continue;
      const trackName = r.str(c.offset + 2);
      for (const d of c.children) {
        if (d.type !== TAG.placeEntry5) continue;
        for (const e of d.children) {
          if (e.type !== TAG.placeSub5) continue;
          const clip = r.u32(e.offset + 4);
          if (clips[clip]) placements.push({ track: t, trackName, clip, start: clips[clip].start, fade: false });
        }
      }
      t++;
    }
  });
  return { rate, files, clips, tracks, placements };
}

/**
 * The session as the mixer wants it: one entry per audio file that's placed on a track, with its clips in order.
 * [{ file, track, clips: [{ start, offset, length }] }], positions in seconds. Files that are on no track are
 * unused takes, and come back in `unused`.
 */
export function sessionLayout(session) {
  const byFile = new Map();
  for (const p of session.placements) {
    if (p.fade) continue;
    const c = session.clips[p.clip];
    if (!c || c.fileName == null) continue;
    const key = c.fileName;
    if (!byFile.has(key)) byFile.set(key, { file: key, track: p.trackName, clips: [] });
    byFile.get(key).clips.push({ start: p.start / session.rate, offset: c.offset / session.rate, length: c.length / session.rate, name: c.name });
  }
  // a stereo track lists each clip once per channel: keep one
  for (const f of byFile.values()) { f.clips.sort((a, b) => a.start - b.start || a.offset - b.offset); f.clips = f.clips.filter((c, i, arr) => !i || Math.abs(c.start - arr[i - 1].start) > 1e-6 || Math.abs(c.offset - arr[i - 1].offset) > 1e-6 || Math.abs(c.length - arr[i - 1].length) > 1e-6); }
  const used = new Set(byFile.keys());
  return { rate: session.rate, files: [...byFile.values()], unused: session.files.filter((f) => !used.has(f)), tracks: session.tracks.map((t) => t.name) };
}
