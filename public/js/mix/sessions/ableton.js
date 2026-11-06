// Reads an Ableton Live set (.als): gzip-compressed XML. Arrangement audio clips sit under each AudioTrack's
// ArrangerAutomation events, placed in beats; the master tempo turns beats into seconds. A clip's start inside its
// file is in seconds for unwarped clips and in beats for warped ones (at the clip's own tempo, which Live does
// not write plainly, so warped clips are read best-effort at the set tempo).

/** Decompress with the browser's DecompressionStream (the file may also be plain XML). */
export async function inflateAls(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t open a compressed Live set.');
    return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return file.text();
}

const attr = (el, tag) => { const c = el.querySelector(`:scope > ${tag}`); return c ? c.getAttribute('Value') : null; };
const num = (el, tag, d = 0) => { const v = attr(el, tag); return v == null || v === '' ? d : Number(v); };

/** Parse the XML text. Returns { rate, files, clips, tracks, placements } like the Pro Tools reader (samples at `rate`). */
export function parseAbleton(xml, rate = 48000) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || !doc.querySelector('Ableton')) throw new Error('Not an Ableton Live set.');
  const tempoEl = doc.querySelector('MasterTrack Tempo > Manual, MainTrack Tempo > Manual');
  const bpm = Number(tempoEl?.getAttribute('Value')) || 120, spb = 60 / bpm;
  const files = [], clips = [], tracks = [], placements = [];
  const fileIndex = (name) => { let i = files.indexOf(name); if (i < 0) { i = files.length; files.push(name); } return i; };
  for (const tr of doc.querySelectorAll('Tracks > AudioTrack')) {
    const name = tr.querySelector(':scope > Name > EffectiveName')?.getAttribute('Value') || tr.querySelector(':scope > Name > UserName')?.getAttribute('Value') || `Track ${tracks.length + 1}`;
    const track = { name, channels: [tracks.length], index: tracks.length };
    tracks.push(track);
    const muted = tr.querySelector(':scope > DeviceChain > Mixer > Speaker > Manual')?.getAttribute('Value') === 'false';
    if (muted) continue;
    for (const clip of tr.querySelectorAll('ArrangerAutomation > Events > AudioClip')) {
      const startBeats = num(clip, 'CurrentStart', Number(clip.getAttribute('Time')) || 0), endBeats = num(clip, 'CurrentEnd', startBeats);
      const warped = attr(clip, 'IsWarped') === 'true';
      const loop = clip.querySelector(':scope > Loop');
      const loopStart = loop ? num(loop, 'LoopStart') : 0, startRel = loop ? num(loop, 'StartRelative') : 0;
      const fileName = clip.querySelector('SampleRef > FileRef > RelativePath')?.getAttribute('Value')?.split(/[\\/]/).pop() || clip.querySelector('SampleRef > FileRef > Path')?.getAttribute('Value')?.split(/[\\/]/).pop() || clip.querySelector('SampleRef > FileRef > Name')?.getAttribute('Value');
      if (!fileName || attr(clip, 'Disabled') === 'true') continue;
      const offsetSec = warped ? (loopStart + startRel) * spb : loopStart + startRel;
      const file = fileIndex(fileName);
      const c = { name: attr(clip, 'Name') || fileName, file, fileName, offset: Math.round(Math.max(0, offsetSec) * rate), length: Math.round(Math.max(0, endBeats - startBeats) * spb * rate), start: Math.round(Math.max(0, startBeats) * spb * rate), index: clips.length, warped };
      clips.push(c);
      placements.push({ track: track.index, trackName: name, clip: c.index, start: c.start, fade: false });
    }
  }
  return { rate, bpm, files, clips, tracks, placements };
}
