// Reads a REAPER project (.rpp): a text file of nested <TAG ...> blocks. Tracks hold items; an item has its
// timeline position, length, the offset into its source file, a mute flag, and a SOURCE block naming the file.

const unquote = (s) => s.replace(/^["'`]|["'`]$/g, '');

/** Split a line into its tokens, keeping quoted names whole. */
function tokens(line) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return out;
}

/**
 * Parse the project text. Returns { rate, files, clips, tracks, placements } in the same shape as the Pro Tools
 * reader (positions in samples at `rate`, which REAPER's text gives in seconds, so rate is only a scale).
 */
export function parseReaper(text, rate = 48000) {
  const lines = String(text).split(/\r?\n/);
  const files = [], clips = [], tracks = [], placements = [];
  const fileIndex = (name) => { let i = files.indexOf(name); if (i < 0) { i = files.length; files.push(name); } return i; };
  const stack = [];
  let track = null, item = null, trackMuted = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('<')) {
      const t = tokens(line.slice(1));
      stack.push(t[0]);
      if (t[0] === 'TRACK') { track = { name: `Track ${tracks.length + 1}`, channels: [tracks.length], index: tracks.length }; trackMuted = false; tracks.push(track); }
      else if (t[0] === 'ITEM' && track) item = { track: track.index, trackName: track.name, start: 0, length: 0, offset: 0, mute: false, file: null, name: '' };
      else if (t[0] === 'SOURCE' && item) item.sourceType = t[1];
      continue;
    }
    if (line === '>') {
      const closed = stack.pop();
      if (closed === 'ITEM' && item) {
        if (item.file) fileIndex(item.file); // known to the project even when muted: then it's an unused take
        if (item.file && !item.mute && !trackMuted && item.length > 0) {
          const file = fileIndex(item.file);
          const clip = { name: item.name || item.file.split(/[\\/]/).pop(), file, fileName: item.file, offset: Math.round(item.offset * rate), length: Math.round(item.length * rate), start: Math.round(item.start * rate), index: clips.length };
          clips.push(clip);
          placements.push({ track: item.track, trackName: item.trackName, clip: clip.index, start: clip.start, fade: false });
        }
        item = null;
      }
      if (closed === 'TRACK') track = null;
      continue;
    }
    const t = tokens(line), key = t[0];
    if (track && !item) {
      if (key === 'NAME') track.name = t[1] || track.name;
      if (key === 'MUTESOLO') trackMuted = Number(t[1]) === 1;
    }
    if (item) {
      if (key === 'POSITION') item.start = Number(t[1]) || 0;
      else if (key === 'LENGTH') item.length = Number(t[1]) || 0;
      else if (key === 'SOFFS') item.offset = Number(t[1]) || 0;
      else if (key === 'MUTE') item.mute = Number(t[1]) === 1;
      else if (key === 'NAME') item.name = t[1] || '';
      else if (key === 'FILE' && stack[stack.length - 1] === 'SOURCE') item.file = unquote(t[1] || '').split(/[\\/]/).pop();
    }
  }
  return { rate, files, clips, tracks, placements };
}
