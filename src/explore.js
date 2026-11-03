// Chucksi Explore: people share what they make, it shows in the public feed at chucksi.com/explore, and anyone can
// Remix a post (open the same tool with the same settings). Imported by src/index.js.
//
// API (on chucksi.com):
//   GET    /api/explore?tool=&sort=new|top&cursor=&limit=   the public feed (cached briefly)
//   GET    /api/explore?mine=1                              your posts, including ones not in the feed yet (signed in)
//   GET    /api/explore/:id                                 one post (+ liked/mine when signed in)
//   POST   /api/explore                                     share (signed in, human check)  form: meta, media, poster
//   DELETE /api/explore/:id                                 delete your post (owner)
//   POST   /api/explore/:id/like  · DELETE …/like           like / unlike (signed in, one per account)
//   POST   /api/explore/:id/report                          report (anyone, human check)    JSON { reason, details }
//   POST   /api/explore/:id/remix                           count an open of the Remix link (?from=<id>; once per IP a day)
// Media: /explore-media/<id>/media.<ext> and /explore-media/<id>/poster.<ext>, from R2 with byte ranges.
//
// Rules: images up to 3 MB (WebP, JPEG, PNG), videos up to 8 MB (MP4, WebM) with a poster image up to 600 KB; the
// bytes must really be that format. Titles up to 80 characters, up to 5 tags, and a Remix link from the tool's own
// pages (public/js/explore-tools.js). Daily limits per account, per IP, and lower ones for accounts under a day old.
// Posts from accounts younger than EXPLORE_HOLD_HOURS (default 24) are live by link at once but only enter the
// public feed when the account is that old, so a fresh throwaway account can't put anything in front of everyone.
// Takedown: KV `explore-block:<id>` (any value) hides a post and its media; enough reports from different people set
// it automatically ("reports") and mark the row hidden. See docs/EXPLORE.md.
//
// Bindings: EXPLORE_BUCKET (R2; falls back to SITES_BUCKET), EXPLORE_DB (D1, migrations/explore; falls back to
// SITES_DB, then SIGN_DB), MASSLESS_KV (takedowns), SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (sign-in).
// Optional vars: EXPLORE_PER_ACCOUNT_DAILY, EXPLORE_PER_NEW_ACCOUNT_DAILY, EXPLORE_PER_IP_DAILY, EXPLORE_HOLD_HOURS,
// EXPLORE_REPORT_HIDE (0 turns automatic hiding off), EXPLORE_PAUSED ("1" stops new posts; the feed stays up).

import { TOOL_IDS, toolLabel, checkRemix, checkLink, POST_ID } from '../public/js/explore-tools.js';

export const EXPLORE_LIMITS = {
  maxImage: 3 * 1024 * 1024,
  maxVideo: 8 * 1024 * 1024,
  maxPoster: 600 * 1024,
  maxTitle: 80,
  maxTags: 5,
  perAccountDaily: 20,
  perNewAccountDaily: 5, // accounts created in the last 24 hours
  perIpDaily: 40,
  likesPerAccountDaily: 300,
  reportsPerIpDaily: 10,
  remixPingsPerIpDaily: 200,
  hideAfterReports: 3, // distinct reporters before a post is hidden for review
  holdHours: 24,
  pageSize: 24,
  maxPageSize: 48,
};
export const REPORT_REASONS = ['sexual', 'violence', 'hate', 'harassment', 'spam', 'illegal', 'copyright', 'other'];
const HOUR = 3600000;
const DAY = 24 * HOUR;

let clock = () => Date.now();
export function _setClock(fn) { clock = fn || (() => Date.now()); }

const enc = new TextEncoder();
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const today = () => new Date(clock()).toISOString().slice(0, 10);
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const clientIp = (request) => request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
const hashIp = async (ip) => (await sha256Hex(`massless:${ip}`)).slice(0, 16);
const db = (env) => env.EXPLORE_DB || env.SITES_DB || env.SIGN_DB;
const bucket = (env) => env.EXPLORE_BUCKET || env.SITES_BUCKET;
const limit = (env, name, def) => { const n = Number(env[name]); return env[name] !== undefined && env[name] !== '' && Number.isFinite(n) && n >= 0 ? n : def; };
const plain = (s, max) => String(s ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------------------------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------------------------

export const MEDIA_TYPES = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4', webm: 'video/webm' };
const IMAGE_EXT = ['webp', 'jpg', 'png'];
const at = (b, sig, o = 0) => sig.every((x, i) => b[o + i] === x);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

/** What the bytes really are: one of MEDIA_TYPES' keys, or null. */
export function sniffMedia(b) {
  if (!b || b.length < 12) return null;
  if (at(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (at(b, [0xff, 0xd8, 0xff])) return 'jpg';
  if (at(b, ascii('RIFF')) && at(b, ascii('WEBP'), 8)) return 'webp';
  if (at(b, ascii('ftyp'), 4)) return 'mp4';
  if (at(b, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm';
  return null;
}

/** Check one upload's media and poster. Returns { kind, mediaExt, posterExt, media, poster } or { error, status }. */
export function checkMedia(media, poster) {
  const fail = (error, status = 400) => ({ error, status });
  if (!media || !media.length) return fail('Add the image or video you made.');
  const mediaExt = sniffMedia(media);
  if (!mediaExt) return fail('Share a WebP, JPEG or PNG image, or an MP4 or WebM video.', 415);
  const kind = IMAGE_EXT.includes(mediaExt) ? 'image' : 'video';
  if (kind === 'image' && media.length > EXPLORE_LIMITS.maxImage) return fail('Images can be up to 3 MB.', 413);
  if (kind === 'video' && media.length > EXPLORE_LIMITS.maxVideo) return fail('Videos can be up to 8 MB. Share a shorter or smaller clip.', 413);
  if (!poster || !poster.length) {
    if (kind === 'video') return fail('A video needs a poster image.');
    if (media.length > EXPLORE_LIMITS.maxPoster) return fail('Add a smaller poster image (up to 600 KB).');
    return { kind, mediaExt, posterExt: mediaExt, media, poster: media };
  }
  const posterExt = sniffMedia(poster);
  if (!IMAGE_EXT.includes(posterExt)) return fail('The poster must be a WebP, JPEG or PNG image.', 415);
  if (poster.length > EXPLORE_LIMITS.maxPoster) return fail('The poster image can be up to 600 KB.', 413);
  return { kind, mediaExt, posterExt, media, poster };
}

/** Title, tags, tool, Remix link, outside link and size, checked. Returns the clean values or { error }. */
export function checkMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { error: 'The post details are missing.' };
  const title = plain(meta.title, 200);
  if (!title) return { error: 'Give it a title.', field: 'title' };
  if (title.length > EXPLORE_LIMITS.maxTitle) return { error: 'Titles can be up to 80 characters.', field: 'title' };
  if (/https?:|www\.|\.(?:com|net|org|io|xyz|ru)\b/i.test(title)) return { error: 'Titles can\'t contain links.', field: 'title' };
  const tool = String(meta.tool || '');
  if (!TOOL_IDS.includes(tool)) return { error: 'Pick the tool this was made with.', field: 'tool' };
  const remix = checkRemix(tool, meta.remix);
  if (remix.error) return { error: remix.error, field: 'remix' };
  const link = checkLink(meta.link);
  if (link.error) return { error: link.error, field: 'link' };
  const rawTags = Array.isArray(meta.tags) ? meta.tags : typeof meta.tags === 'string' ? meta.tags.split(/[\s,#]+/) : [];
  const tags = [...new Set(rawTags.map((t) => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean))];
  if (tags.length > EXPLORE_LIMITS.maxTags) return { error: 'Use up to 5 tags.', field: 'tags' };
  if (tags.some((t) => !/^[a-z0-9][a-z0-9-]{0,23}$/.test(t))) return { error: 'Tags are short words: letters, numbers and hyphens.', field: 'tags' };
  const dim = (v) => Math.max(1, Math.min(8192, Math.round(Number(v)) || 0));
  let width = dim(meta.width), height = dim(meta.height);
  if (width === 1 && height === 1) { width = 4; height = 5; }
  // keep the masonry sane: between 1:3 and 3:1
  if (width / height > 3) height = Math.ceil(width / 3);
  if (height / width > 3) width = Math.ceil(height / 3);
  return { title, tool, remix: remix.url, link: link.url, tags, width, height };
}

// ---------------------------------------------------------------------------------------------
// Sign-in (Supabase), the same check as src/sites.js, plus the public display name and account age
// ---------------------------------------------------------------------------------------------

/** The name shown on posts: from the Supabase profile, never an email address. */
export function displayName(user) {
  const m = (user && user.user_metadata) || {};
  for (const k of ['display_name', 'full_name', 'name', 'user_name', 'preferred_username', 'nickname']) {
    const v = plain(m[k], 40);
    if (v && !v.includes('@') && !/https?:|www\./i.test(v)) return v;
  }
  return 'Creator';
}

async function currentUser(request, env, { required = true } = {}) {
  const bearer = request.headers.get('authorization') || '';
  if (!bearer && !required) return { user: null };
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return { stop: json({ error: 'Sign-in is being connected. Try again later.' }, 503) };
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(bearer)) return required ? { stop: json({ error: 'Sign in to share on Explore.', signIn: true }, 401) } : { user: null };
  let res;
  try {
    res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: bearer }, signal: AbortSignal.timeout(10000) });
  } catch {
    return { stop: json({ error: 'Sign-in could not be checked. Please try again.' }, 503) };
  }
  if (!res.ok) return required ? { stop: json({ error: 'Please sign in again.', signIn: true }, 401) } : { user: null };
  const user = await res.json().catch(() => ({}));
  if (!user || typeof user.id !== 'string' || !user.id) return required ? { stop: json({ error: 'Please sign in again.', signIn: true }, 401) } : { user: null };
  const created = Date.parse(user.created_at || '') || 0;
  return { user: { id: user.id, name: displayName(user), created, confirmed: !!(user.email_confirmed_at || user.confirmed_at || user.phone_confirmed_at) } };
}

// ---------------------------------------------------------------------------------------------
// Storage: R2 explore/<id>/media.<ext> + poster.<ext>; D1 explore_* tables (migrations/explore)
// ---------------------------------------------------------------------------------------------

const mediaKey = (id, name, ext) => `explore/${id}/${name}.${ext}`;
export const mediaPath = (id, name, ext) => `/explore-media/${id}/${name}.${ext}`;

async function deletePrefix(b, prefix) {
  let cursor;
  do {
    const listed = await b.list({ prefix, cursor });
    const keys = (listed.objects || []).map((o) => o.key);
    if (keys.length) await b.delete(keys);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

const memo = { block: new Map() };
export function _resetExploreCaches() { memo.block.clear(); }
/** The takedown flag: KV `explore-block:<id>`. Any value hides the post; "reports" means hidden by visitor reports. */
async function blockOf(env, id) {
  if (!env.MASSLESS_KV) return null;
  const hit = memo.block.get(id);
  if (hit && hit.until > clock()) return hit.value;
  let value = null;
  try { value = await env.MASSLESS_KV.get(`explore-block:${id}`, { cacheTtl: 60 }); } catch { /* treat as not blocked */ }
  if (memo.block.size > 4000) memo.block.clear();
  memo.block.set(id, { value, until: clock() + 30000 });
  return value;
}

async function quotaCount(env, who) {
  return (await db(env).prepare('SELECT n FROM explore_quota WHERE day = ? AND who = ?').bind(today(), who).first('n')) || 0;
}
const quotaUp = (env, who) => db(env).prepare('INSERT INTO explore_quota (day, who, n) VALUES (?, ?, 1) ON CONFLICT(day, who) DO UPDATE SET n = n + 1').bind(today(), who);
async function sweepQuota(env) {
  await db(env).prepare('DELETE FROM explore_quota WHERE day < ?').bind(new Date(clock() - 2 * DAY).toISOString().slice(0, 10)).run();
}

function newId() {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(12));
  return [...r].map((x) => a[x % a.length]).join('');
}

/** A row as the pages see it. `who` adds liked/mine/status for the signed-in viewer. */
export function postOut(row, extra = {}) {
  return {
    id: row.id,
    title: row.title,
    tool: row.tool,
    toolLabel: toolLabel(row.tool),
    kind: row.kind,
    media: mediaPath(row.id, 'media', row.media_ext),
    poster: mediaPath(row.id, 'poster', row.poster_ext),
    width: row.width,
    height: row.height,
    remix: row.remix,
    link: row.link || '',
    tags: row.tags ? row.tags.split(',') : [],
    author: row.author || 'Creator',
    likes: row.likes,
    remixes: row.remixes,
    createdAt: iso(row.created_at),
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------------------------

async function readUpload(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  const max = EXPLORE_LIMITS.maxVideo + EXPLORE_LIMITS.maxPoster + 64 * 1024;
  if (declared > max) return { stop: json({ error: 'Videos can be up to 8 MB. Share a shorter or smaller clip.' }, 413) };
  let form;
  try { form = await request.formData(); } catch { return { stop: json({ error: 'Send the post as form data: meta, media and poster.' }, 400) }; }
  let meta;
  try { meta = JSON.parse(String(form.get('meta') || '')); } catch { return { stop: json({ error: 'The post details are not valid JSON.' }, 400) }; }
  const bytesOf = async (name) => {
    const part = form.get(name);
    if (!part || typeof part.arrayBuffer !== 'function') return null;
    return new Uint8Array(await part.arrayBuffer());
  };
  const media = await bytesOf('media');
  const poster = await bytesOf('poster');
  if ((media?.length || 0) + (poster?.length || 0) > max) return { stop: json({ error: 'Videos can be up to 8 MB. Share a shorter or smaller clip.' }, 413) };
  return { meta, media, poster };
}

async function share(request, env, ctx, user) {
  if (env.EXPLORE_PAUSED === '1' || env.EXPLORE_PAUSED === 'true') return json({ error: 'Sharing is paused for maintenance. The feed stays up.' }, 503);
  if (!user.confirmed) return json({ error: 'Confirm your email address first, then share.' }, 403);
  const now = clock();
  const young = !user.created || now - user.created < DAY;
  const ipWho = `ip:${await hashIp(clientIp(request))}`;
  const userWho = `u:${user.id}`;
  const [mine, ipn] = await Promise.all([quotaCount(env, userWho), quotaCount(env, ipWho)]);
  const perAccount = young ? limit(env, 'EXPLORE_PER_NEW_ACCOUNT_DAILY', EXPLORE_LIMITS.perNewAccountDaily) : limit(env, 'EXPLORE_PER_ACCOUNT_DAILY', EXPLORE_LIMITS.perAccountDaily);
  if (mine >= perAccount || ipn >= limit(env, 'EXPLORE_PER_IP_DAILY', EXPLORE_LIMITS.perIpDaily)) {
    return json({ error: 'You have shared a lot today. Try again tomorrow (midnight UTC).' }, 429);
  }
  const up = await readUpload(request);
  if (up.stop) return up.stop;
  const meta = checkMeta(up.meta);
  if (meta.error) return json({ error: meta.error, field: meta.field }, 400);
  const media = checkMedia(up.media, up.poster);
  // every checked upload counts toward the daily limit, refused ones too
  await db(env).batch([quotaUp(env, userWho), quotaUp(env, ipWho)]);
  if (media.error) return json({ error: media.error, field: 'media' }, media.status);

  const id = newId();
  const hold = limit(env, 'EXPLORE_HOLD_HOURS', EXPLORE_LIMITS.holdHours) * HOUR;
  const listed = Math.max(now, (user.created || now) + hold);
  const b = bucket(env);
  try {
    await b.put(mediaKey(id, 'media', media.mediaExt), media.media, { httpMetadata: { contentType: MEDIA_TYPES[media.mediaExt] } });
    await b.put(mediaKey(id, 'poster', media.posterExt), media.poster, { httpMetadata: { contentType: MEDIA_TYPES[media.posterExt] } });
  } catch (e) {
    await deletePrefix(b, `explore/${id}/`).catch(() => {});
    return json({ error: `The post could not be stored: ${e.message || e}` }, 500);
  }
  const bytes = media.media.length + (media.poster === media.media ? 0 : media.poster.length);
  const row = {
    id, owner: user.id, author: user.name, title: meta.title, tool: meta.tool, remix: meta.remix, link: meta.link || null,
    tags: meta.tags.join(','), kind: media.kind, media_ext: media.mediaExt, poster_ext: media.posterExt, bytes,
    width: meta.width, height: meta.height, likes: 0, remixes: 0, score: 0, reports: 0, status: 'live', created_at: now, listed_at: listed,
  };
  try {
    await db(env).prepare(
      `INSERT INTO explore_posts (id, owner, author, title, tool, remix, link, tags, kind, media_ext, poster_ext, bytes, width, height, created_at, listed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(row.id, row.owner, row.author, row.title, row.tool, row.remix, row.link, row.tags, row.kind, row.media_ext, row.poster_ext, row.bytes, row.width, row.height, row.created_at, row.listed_at).run();
  } catch (e) {
    await deletePrefix(b, `explore/${id}/`).catch(() => {});
    throw e;
  }
  if (ctx && ctx.waitUntil) ctx.waitUntil(sweepQuota(env).catch(() => {}));
  return json({ ok: true, post: postOut(row, { mine: true, liked: false, status: listed > now ? 'held' : 'live', listedAt: iso(listed) }) }, 201);
}

async function remove(env, user, id) {
  const row = await db(env).prepare('SELECT id, owner FROM explore_posts WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'That post is not on Explore.' }, 404);
  if (row.owner !== user.id) return json({ error: 'That post belongs to another account.' }, 403);
  await deletePrefix(bucket(env), `explore/${id}/`);
  await db(env).batch([
    db(env).prepare('DELETE FROM explore_posts WHERE id = ? AND owner = ?').bind(id, user.id),
    db(env).prepare('DELETE FROM explore_likes WHERE post_id = ?').bind(id),
  ]);
  return json({ ok: true, id });
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

const b64u = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));
export const encodeCursor = (row, sort) => b64u(JSON.stringify(sort === 'top' ? [row.score, row.listed_at, row.id] : [row.listed_at, row.id]));
export function decodeCursor(raw, sort) {
  if (!raw) return null;
  try {
    const c = JSON.parse(unb64u(String(raw).slice(0, 200)));
    const n = sort === 'top' ? 3 : 2;
    if (!Array.isArray(c) || c.length !== n) return undefined;
    if (!c.slice(0, n - 1).every((x) => Number.isSafeInteger(x)) || !POST_ID.test(c[n - 1])) return undefined;
    return c;
  } catch { return undefined; }
}

async function list(request, env, url, ctx) {
  const sort = url.searchParams.get('sort') === 'top' ? 'top' : 'new';
  const tool = url.searchParams.get('tool') || '';
  if (tool && !TOOL_IDS.includes(tool)) return json({ error: 'Unknown tool.' }, 400);
  const size = Math.max(1, Math.min(EXPLORE_LIMITS.maxPageSize, Number(url.searchParams.get('limit')) || EXPLORE_LIMITS.pageSize));
  const cursor = decodeCursor(url.searchParams.get('cursor'), sort);
  if (cursor === undefined) return json({ error: 'That page link is out of date. Reload the feed.' }, 400);

  // a short edge cache: everyone sees the same public feed
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const key = cache ? new Request(`https://explore-cache.internal${url.pathname}?${[...url.searchParams].filter(([k]) => ['sort', 'tool', 'cursor', 'limit'].includes(k)).sort().map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`) : null;
  if (cache) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) return hit;
  }
  const where = ["status = 'live'", 'listed_at <= ?'];
  const args = [clock()];
  if (tool) { where.push('tool = ?'); args.push(tool); }
  if (cursor && sort === 'new') { where.push('(listed_at < ? OR (listed_at = ? AND id < ?))'); args.push(cursor[0], cursor[0], cursor[1]); }
  if (cursor && sort === 'top') { where.push('(score < ? OR (score = ? AND (listed_at < ? OR (listed_at = ? AND id < ?))))'); args.push(cursor[0], cursor[0], cursor[1], cursor[1], cursor[2]); }
  const order = sort === 'top' ? 'score DESC, listed_at DESC, id DESC' : 'listed_at DESC, id DESC';
  const { results } = await db(env).prepare(`SELECT * FROM explore_posts WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`).bind(...args, size + 1).all();
  const rows = results || [];
  const more = rows.length > size;
  const page = rows.slice(0, size);
  const blocks = await Promise.all(page.map((r) => blockOf(env, r.id)));
  const posts = page.filter((_, i) => !blocks[i]).map((r) => postOut(r));
  const body = { posts, cursor: more ? encodeCursor(page[page.length - 1], sort) : null, sort, tool: tool || null };
  const res = json(body, 200, { 'cache-control': 'public, max-age=20' });
  if (cache) {
    const put = cache.put(key, res.clone()).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(put);
  }
  return res;
}

async function mine(env, user) {
  const { results } = await db(env).prepare('SELECT * FROM explore_posts WHERE owner = ? ORDER BY created_at DESC LIMIT 200').bind(user.id).all();
  const rows = results || [];
  const blocks = await Promise.all(rows.map((r) => blockOf(env, r.id)));
  const now = clock();
  return json({ posts: rows.map((r, i) => postOut(r, { mine: true, status: blocks[i] || r.status === 'hidden' ? 'hidden' : r.listed_at > now ? 'held' : 'live', listedAt: iso(r.listed_at) })) });
}

async function one(request, env, id) {
  const row = await db(env).prepare('SELECT * FROM explore_posts WHERE id = ?').bind(id).first();
  const a = await currentUser(request, env, { required: false });
  const viewer = a.user;
  const isMine = !!(row && viewer && viewer.id === row.owner);
  if (!row) return json({ error: 'That post is not on Explore.' }, 404);
  const block = await blockOf(env, id);
  if ((block || row.status === 'hidden') && !isMine) return json({ error: 'This post is unavailable. It was taken down or paused for review.' }, 410);
  const extra = {};
  if (viewer) {
    extra.liked = !!(await db(env).prepare('SELECT 1 AS y FROM explore_likes WHERE post_id = ? AND user_id = ?').bind(id, viewer.id).first('y'));
    extra.mine = isMine;
  }
  if (isMine) { extra.status = block || row.status === 'hidden' ? 'hidden' : row.listed_at > clock() ? 'held' : 'live'; extra.listedAt = iso(row.listed_at); }
  return json({ post: postOut(row, extra) }, 200, viewer ? {} : { 'cache-control': 'public, max-age=20' });
}

// ---------------------------------------------------------------------------------------------
// Likes, remixes and reports
// ---------------------------------------------------------------------------------------------

async function liveRow(env, id) {
  const row = await db(env).prepare('SELECT id, owner, status, created_at FROM explore_posts WHERE id = ?').bind(id).first();
  if (!row) return null;
  if (row.status === 'hidden' || (await blockOf(env, id))) return null;
  return row;
}
const recount = (env, id) => db(env).prepare(
  'UPDATE explore_posts SET likes = (SELECT COUNT(*) FROM explore_likes WHERE post_id = ?1), score = (SELECT COUNT(*) FROM explore_likes WHERE post_id = ?1) * 2 + remixes WHERE id = ?1',
).bind(id);

async function like(env, user, id, on) {
  if (!(await liveRow(env, id))) return json({ error: 'That post is not on Explore.' }, 404);
  const who = `l:${user.id}`;
  if (on && (await quotaCount(env, who)) >= EXPLORE_LIMITS.likesPerAccountDaily) return json({ error: 'That is a lot of likes for one day. Try again tomorrow.' }, 429);
  const write = on
    ? db(env).prepare('INSERT INTO explore_likes (post_id, user_id, at) VALUES (?, ?, ?) ON CONFLICT(post_id, user_id) DO NOTHING').bind(id, user.id, clock())
    : db(env).prepare('DELETE FROM explore_likes WHERE post_id = ? AND user_id = ?').bind(id, user.id);
  const [w] = await db(env).batch([write, recount(env, id), ...(on ? [quotaUp(env, who)] : [])]);
  const likes = await db(env).prepare('SELECT likes FROM explore_posts WHERE id = ?').bind(id).first('likes');
  return json({ ok: true, liked: on, likes: likes || 0, changed: !!(w.meta && w.meta.changes) });
}

async function remixed(request, env, id) {
  if (!(await liveRow(env, id))) return json({ ok: false }, 404);
  const ip = await hashIp(clientIp(request));
  const [seen, pings] = await Promise.all([quotaCount(env, `x:${id}:${ip}`), quotaCount(env, `x:${ip}`)]);
  if (seen || pings >= EXPLORE_LIMITS.remixPingsPerIpDaily) {
    await quotaUp(env, `x:${ip}`).run();
    return json({ ok: true, counted: false });
  }
  await db(env).batch([
    quotaUp(env, `x:${id}:${ip}`),
    quotaUp(env, `x:${ip}`),
    db(env).prepare('UPDATE explore_posts SET remixes = remixes + 1, score = score + 1 WHERE id = ?').bind(id),
  ]);
  return json({ ok: true, counted: true });
}

async function report(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON: { "reason": "...", "details": "..." }' }, 400); }
  const reason = String(body?.reason || '');
  if (!REPORT_REASONS.includes(reason)) return json({ error: 'Pick a reason.', field: 'reason' }, 400);
  const details = String(body.details || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 2000);
  const row = await db(env).prepare('SELECT id, created_at FROM explore_posts WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'That post is not on Explore.' }, 404);
  const who = `r:${await hashIp(clientIp(request))}`;
  if ((await quotaCount(env, who)) >= EXPLORE_LIMITS.reportsPerIpDaily) return json({ error: 'Thanks. You have sent many reports today; we will look at those first.' }, 429);
  const now = clock();
  await db(env).batch([
    db(env).prepare('INSERT INTO explore_reports (post_id, reason, details, who, at) VALUES (?, ?, ?, ?, ?)').bind(id, reason, details, who, now),
    db(env).prepare('UPDATE explore_posts SET reports = reports + 1 WHERE id = ?').bind(id),
    quotaUp(env, who),
  ]);
  // enough different people reporting a post hides it (and its media) until someone reviews it
  const hideAt = limit(env, 'EXPLORE_REPORT_HIDE', EXPLORE_LIMITS.hideAfterReports);
  let hidden = false;
  if (hideAt > 0) {
    const n = await db(env).prepare('SELECT COUNT(DISTINCT who) AS n FROM explore_reports WHERE post_id = ?').bind(id).first('n');
    if (n >= hideAt) {
      hidden = true;
      await db(env).prepare("UPDATE explore_posts SET status = 'hidden' WHERE id = ?").bind(id).run();
      if (env.MASSLESS_KV && !(await env.MASSLESS_KV.get(`explore-block:${id}`))) await env.MASSLESS_KV.put(`explore-block:${id}`, 'reports');
      memo.block.delete(id);
    }
  }
  return json({ ok: true, hidden });
}

// ---------------------------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------------------------

/** Writes that go behind the Turnstile human check (see needsHuman in src/index.js). */
export function exploreGated(method, path) {
  if (method !== 'POST') return false;
  return path === '/api/explore' || /^\/api\/explore\/[^/]+\/report$/.test(path);
}

export async function exploreApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === url.host; } catch { /* bad origin */ }
      if (!ok) return json({ error: 'Cross-site requests are not allowed.' }, 403);
    }
  }
  if (!bucket(env) || !db(env)) return json({ error: 'Explore is not switched on here yet.' }, 501);
  try {
    if (path === '/api/explore') {
      if (method === 'GET' || method === 'HEAD') {
        if (url.searchParams.get('mine')) {
          const a = await currentUser(request, env);
          return a.stop || (await mine(env, a.user));
        }
        return await list(request, env, url, ctx);
      }
      if (method !== 'POST') return json({ error: 'Use GET or POST.' }, 405);
      const a = await currentUser(request, env);
      return a.stop || (await share(request, env, ctx, a.user));
    }
    const m = path.match(/^\/api\/explore\/([^/]+)(?:\/(like|report|remix))?$/);
    if (!m || !POST_ID.test(m[1])) return json({ error: 'That post is not on Explore.' }, 404);
    const [, id, action] = m;
    if (!action) {
      if (method === 'GET' || method === 'HEAD') return await one(request, env, id);
      if (method !== 'DELETE') return json({ error: 'Use GET or DELETE.' }, 405);
      const a = await currentUser(request, env);
      return a.stop || (await remove(env, a.user, id));
    }
    if (action === 'remix') return method === 'POST' ? await remixed(request, env, id) : json({ error: 'Use POST.' }, 405);
    if (action === 'report') return method === 'POST' ? await report(request, env, id) : json({ error: 'Use POST.' }, 405);
    if (method !== 'POST' && method !== 'DELETE') return json({ error: 'Use POST or DELETE.' }, 405);
    const a = await currentUser(request, env);
    return a.stop || (await like(env, a.user, id, method === 'POST'));
  } catch (e) {
    console.error('explore failed:', e?.message || e);
    return json({ error: "Explore couldn't do that right now. Try again in a minute." }, 500);
  }
}

// ---------------------------------------------------------------------------------------------
// Serving /explore-media/<id>/<media|poster>.<ext>
// ---------------------------------------------------------------------------------------------

const MEDIA_RE = /^\/explore-media\/([a-z0-9]{6,20})\/(media|poster)\.(webp|jpg|png|mp4|webm)$/;
export const isExploreMedia = (pathname) => pathname.startsWith('/explore-media/');

function mediaHeaders(type) {
  return new Headers({
    'content-type': type,
    'cache-control': 'public, max-age=600',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'cross-origin-resource-policy': 'same-site',
    'content-disposition': 'inline',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'accept-ranges': 'bytes',
  });
}
const gone = (status, text) => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });

export async function serveExploreMedia(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  const m = new URL(request.url).pathname.match(MEDIA_RE);
  if (!m || !bucket(env)) return gone(404, 'Not found');
  const [, id, name, ext] = m;
  if (await blockOf(env, id)) return gone(410, 'This post is unavailable.');
  const key = mediaKey(id, name, ext);
  const b = bucket(env);
  const head = await b.head(key);
  if (!head) return gone(404, 'Not found');
  const size = head.size;
  const headers = mediaHeaders(MEDIA_TYPES[ext]);
  const etag = head.httpEtag || (head.etag ? `"${head.etag}"` : null);
  if (etag) headers.set('etag', etag);
  if (etag && (request.headers.get('if-none-match') || '').split(/\s*,\s*/).includes(etag)) return new Response(null, { status: 304, headers });
  const r = (request.headers.get('range') || '').match(/^bytes=(\d*)-(\d*)$/);
  if (r && !(r[1] === '' && r[2] === '')) {
    const start = r[1] === '' ? Math.max(0, size - Number(r[2])) : Number(r[1]);
    const end = r[1] === '' || r[2] === '' ? size - 1 : Math.min(size - 1, Number(r[2]));
    if (start >= size || start > end) {
      headers.set('content-range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set('content-range', `bytes ${start}-${end}/${size}`);
    headers.set('content-length', String(end - start + 1));
    if (request.method === 'HEAD') return new Response(null, { status: 206, headers });
    const obj = await b.get(key, { range: { offset: start, length: end - start + 1 } });
    if (!obj) return gone(404, 'Not found');
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(size));
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  const obj = await b.get(key);
  if (!obj) return gone(404, 'Not found');
  return new Response(obj.body, { status: 200, headers });
}
