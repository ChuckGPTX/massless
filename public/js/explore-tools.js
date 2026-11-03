// Explore: the tools a post can come from and the Remix links they may carry. Shared by the Worker (src/explore.js)
// and the pages (explore-share.js, pages/explore-feed.js), so both sides check a link the same way.
//
// A Remix link is a same-site relative path that reopens the tool with the same settings: /video?move=arc-right,
// /website#s=…, /games#g=…, /office?tab=slides#d=…, /workflows?make=map&example=…. Only the paths each tool owns
// are accepted; `from` (added when someone opens a remix) and `shot` (an id in one browser's library) are dropped.

export const EXPLORE_TOOLS = [
  { id: 'video', label: 'Video', paths: ['/video', '/film', '/music', '/cut'] },
  { id: 'image', label: 'Image', paths: ['/image', '/edit'] },
  { id: 'design', label: 'Design', paths: ['/workflows'] },
  { id: 'website', label: 'Website', paths: ['/website'] },
  { id: 'games', label: 'Games', paths: ['/games'] },
  { id: 'slides', label: 'Slides', paths: ['/office'] },
  { id: '3d', label: '3D', paths: ['/3d', '/scene'] },
];
export const TOOL_IDS = EXPLORE_TOOLS.map((t) => t.id);
export const toolLabel = (id) => EXPLORE_TOOLS.find((t) => t.id === id)?.label || 'Chucksi';
export const MAX_REMIX = 6000;
export const POST_ID = /^[a-z0-9]{6,20}$/;
const DROP = ['from', 'shot'];

/**
 * Check and tidy a Remix link for a tool. Returns { url } (pathname + search + hash, normalised) or { error }.
 */
export function checkRemix(tool, raw) {
  const t = EXPLORE_TOOLS.find((x) => x.id === tool);
  if (!t) return { error: 'Pick the tool this was made with.' };
  const s = String(raw ?? '');
  if (!s) return { error: 'The Remix link is missing.' };
  if (s.length > MAX_REMIX) return { error: 'The Remix link is too long. Save a shorter version or use a template.' };
  // relative to this site only: one leading slash, no scheme, no backslashes, nothing invisible
  if (!s.startsWith('/') || s.startsWith('//') || /[\\\u0000-\u001f\u007f\s]/.test(s)) return { error: 'The Remix link must be a Chucksi page.' };
  let u;
  try { u = new URL(s, 'https://chucksi.com'); } catch { return { error: 'The Remix link is not a valid address.' }; }
  if (u.origin !== 'https://chucksi.com') return { error: 'The Remix link must be a Chucksi page.' };
  const path = u.pathname.replace(/\/index\.html$/, '').replace(/\/+$/, '') || '/';
  if (!t.paths.includes(path)) return { error: `A ${t.label} post can only remix in ${t.paths.join(', ')}.` };
  for (const k of DROP) u.searchParams.delete(k);
  const search = u.searchParams.toString();
  return { url: `${path}${search ? `?${search}` : ''}${u.hash && u.hash !== '#' ? u.hash : ''}` };
}

/** The link the Remix button opens: the post's link with ?from=<id>, so the open is counted once. */
export function remixHref(remix, id) {
  const u = new URL(remix, 'https://chucksi.com');
  u.searchParams.set('from', id);
  return u.pathname + u.search + u.hash;
}

/** A published v2web.site address, the only outside link a post may carry. */
export function checkLink(raw) {
  if (raw == null || raw === '') return { url: '' };
  const s = String(raw).trim().toLowerCase().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]\.v2web\.site$/.test(s) || s.includes('--')) return { error: 'Only a v2web.site address can be linked.' };
  return { url: s };
}
