// Explore (src/explore.js): share validation and limits, the remix link allow-list, sign-in and ownership, likes,
// reports and automatic hiding, the feed's sorting and cursors, held posts from new accounts, remix counting, media
// serving and the seed posts. Runs the real Worker (src/index.js) on in-memory R2, KV and D1 (SQLite running
// migrations/explore) with a stubbed Supabase.

import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { checkMeta, checkMedia, sniffMedia, displayName, exploreGated, decodeCursor, EXPLORE_LIMITS, _setClock, _resetExploreCaches } from '../src/explore.js';
import { checkRemix, checkLink, remixHref, EXPLORE_TOOLS } from '../public/js/explore-tools.js';
import { seedPosts } from '../tools/explore/seed.mjs';
import { FakeD1, FakeR2 } from '../tools/sign/fakes.mjs';

const SCHEMA = new URL('../migrations/explore/0001_init.sql', import.meta.url).pathname;
const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
const OLD = '2026-01-01T00:00:00Z';

class FakeKV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, String(v)); }
  async delete(k) { this.map.delete(k); }
}
/** FakeR2 plus the parts of R2 the media route uses: head() with an etag, and ranged get(). */
class RangeR2 extends FakeR2 {
  async head(key) { const o = this.objects.get(key); return o ? { key, size: o.bytes.length, httpEtag: `"e${o.bytes.length}"` } : null; }
  async get(key, opts = {}) {
    const o = await super.get(key);
    if (!o || !opts.range) return o;
    const all = this.objects.get(key).bytes;
    const part = all.slice(opts.range.offset, opts.range.offset + opts.range.length);
    return { ...o, get body() { return new Blob([part]).stream(); } };
  }
}

const USERS = {
  'tok-alice': { id: 'alice', created_at: OLD, email_confirmed_at: OLD, email: 'alice@example.com', user_metadata: { full_name: 'Alice Ray' } },
  'tok-bob': { id: 'bob', created_at: OLD, email_confirmed_at: OLD, email: 'bob@example.com', user_metadata: { name: 'bob@example.com' } },
  'tok-new': { id: 'newbie', created_at: new Date(NOW - 3600000).toISOString(), email_confirmed_at: OLD, user_metadata: { user_name: 'fresh' } },
  'tok-unconfirmed': { id: 'nope', created_at: OLD, email_confirmed_at: null },
};

function makeEnv(extra = {}) {
  return { SITES_BUCKET: new RangeR2(), SITES_DB: new FakeD1(SCHEMA), MASSLESS_KV: new FakeKV(), SUPABASE_URL: 'https://sb.test', SUPABASE_PUBLISHABLE_KEY: 'pk', ...extra };
}

let realFetch;
let now = NOW;
test.before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url) === 'https://sb.test/auth/v1/user') {
      const user = USERS[(new Headers(init.headers).get('authorization') || '').replace(/^Bearer /, '')];
      return user ? Response.json(user) : new Response('{}', { status: 401 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  _setClock(() => now);
});
test.after(() => { globalThis.fetch = realFetch; _setClock(null); });
test.beforeEach(() => { now = NOW; _resetExploreCaches(); });

const PNG = (n = 2000) => { const b = new Uint8Array(n); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]); return b; };
const JPG = (n = 2000) => { const b = new Uint8Array(n); b.set([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]); return b; };
const MP4 = (n = 5000) => { const b = new Uint8Array(n); b.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); for (let i = 12; i < n; i++) b[i] = i % 251; return b; };
const HTML = () => new TextEncoder().encode('<!doctype html><script>alert(1)</script>');

function form(meta, media = PNG(), poster) {
  const f = new FormData();
  f.append('meta', JSON.stringify(meta));
  if (media) f.append('media', new Blob([media]), 'media');
  if (poster) f.append('poster', new Blob([poster]), 'poster');
  return f;
}
const META = (o = {}) => ({ title: 'Glass koi', tool: 'video', remix: '/video?move=arc-right&sample=fisherman', tags: ['koi', 'glass'], width: 1280, height: 720, ...o });

async function call(env, method, path, { token, body, json, ip = '203.0.113.7', origin, headers = {} } = {}) {
  const h = { 'cf-connecting-ip': ip, ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (origin) h.origin = origin;
  let b = body;
  if (json !== undefined) { h['content-type'] = 'application/json'; b = JSON.stringify(json); }
  const res = await worker.fetch(new Request(`https://chucksi.com${path}`, { method, headers: h, body: b }), env, { waitUntil: () => {} });
  const buf = method === 'HEAD' ? new Uint8Array() : new Uint8Array(await res.arrayBuffer());
  let data = null;
  try { data = JSON.parse(new TextDecoder().decode(buf)); } catch { /* bytes */ }
  return { status: res.status, data, bytes: buf, headers: res.headers };
}
const share = (env, token, meta = META(), media, poster, opts = {}) => call(env, 'POST', '/api/explore', { token, body: form(meta, media, poster), ...opts });

// ---------------------------------------------------------------------------------------------

test('remix links: only same-site paths a tool owns', () => {
  const ok = [
    ['video', '/video?move=arc-right', '/video?move=arc-right'],
    ['video', '/video?effect=lidar&look=cyan&sample=canyon&from=abcdef123&shot=xyz', '/video?effect=lidar&look=cyan&sample=canyon'],
    ['video', '/video?prompt=a%20fox%20in%20snow', '/video?prompt=a+fox+in+snow'],
    ['website', '/website#s=zAbc_-123', '/website#s=zAbc_-123'],
    ['website', '/website/?template=manifesto', '/website?template=manifesto'],
    ['games', '/games#g=zQQ', '/games#g=zQQ'],
    ['games', '/games/index.html#play=sky-tower', '/games#play=sky-tower'],
    ['slides', '/office?tab=slides&play=1#d=zXYZ', '/office?tab=slides&play=1#d=zXYZ'],
    ['design', '/workflows?make=map&example=map-saltmere', '/workflows?make=map&example=map-saltmere'],
    ['image', '/image?model=flux-1-schnell&prompt=koi', '/image?model=flux-1-schnell&prompt=koi'],
  ];
  for (const [tool, raw, want] of ok) assert.equal(checkRemix(tool, raw).url, want, raw);
  const bad = [
    ['video', 'https://evil.example/video'], ['video', '//evil.example/video'], ['video', 'javascript:alert(1)'], ['video', '/\\evil.example'],
    ['video', '/website#s=x'], ['website', '/video?move=x'], ['video', '/api/explore'], ['video', '/explore-media/x/media.mp4'],
    ['video', 'video?move=x'], ['video', '/video?move=a b'], ['video', '/video\n'], ['nope', '/video'], ['video', ''],
    ['video', `/video?prompt=${'x'.repeat(6001)}`], ['games', '/games/../api/explore'],
  ];
  for (const [tool, raw] of bad) assert.ok(checkRemix(tool, raw).error, `${tool} ${raw}`);
  assert.equal(remixHref('/games#play=sky-tower', 'abc123'), '/games?from=abc123#play=sky-tower');
  assert.equal(remixHref('/video?move=fpv', 'abc123'), '/video?move=fpv&from=abc123');
  assert.equal(checkLink('https://cedar-lawn.v2web.site/').url, 'https://cedar-lawn.v2web.site');
  for (const l of ['https://evil.example', 'http://cedar.v2web.site', 'https://a.b.v2web.site', 'https://v2web.site.evil.example']) assert.ok(checkLink(l).error, l);
  assert.deepEqual(EXPLORE_TOOLS.map((t) => t.id), ['video', 'image', 'design', 'website', 'games', 'slides', '3d']);
});

test('post details: titles, tags, tools and sizes', () => {
  assert.equal(checkMeta(META()).title, 'Glass koi');
  assert.match(checkMeta(META({ title: '' })).error, /title/);
  assert.match(checkMeta(META({ title: 'x'.repeat(81) })).error, /80/);
  assert.equal(checkMeta(META({ title: 'x'.repeat(80) })).title.length, 80);
  assert.match(checkMeta(META({ title: 'free stuff at https://spam.example' })).error, /links/);
  assert.equal(checkMeta(META({ title: '  Neon\u0000‮  koi  ' })).title, 'Neon koi');
  assert.match(checkMeta(META({ tool: 'shell' })).error, /tool/);
  assert.match(checkMeta(META({ remix: 'https://evil.example' })).error, /Chucksi page/);
  assert.deepEqual(checkMeta(META({ tags: '#Neon, koi koi' })).tags, ['neon', 'koi']);
  assert.match(checkMeta(META({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] })).error, /5 tags/);
  assert.match(checkMeta(META({ tags: ['<script>'] })).error, /Tags/);
  const tall = checkMeta(META({ width: 100, height: 1000 }));
  assert.ok(tall.height / tall.width <= 3);
  assert.match(checkMeta(META({ link: 'https://evil.example' })).error, /v2web/);
  assert.equal(checkMeta(null).error, 'The post details are missing.');
});

test('media: real formats only, with size limits and posters', () => {
  assert.equal(sniffMedia(PNG()), 'png');
  assert.equal(sniffMedia(JPG()), 'jpg');
  assert.equal(sniffMedia(MP4()), 'mp4');
  assert.equal(sniffMedia(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), 'webm');
  assert.equal(sniffMedia(HTML()), null);
  assert.equal(checkMedia(PNG(), null).kind, 'image');
  assert.equal(checkMedia(HTML(), null).status, 415);
  assert.equal(checkMedia(PNG(EXPLORE_LIMITS.maxImage + 1), PNG()).status, 413);
  assert.equal(checkMedia(MP4(EXPLORE_LIMITS.maxVideo + 1), PNG()).status, 413);
  assert.match(checkMedia(MP4(), null).error, /poster/);
  assert.equal(checkMedia(MP4(), MP4()).status, 415, 'a video is not a poster');
  assert.equal(checkMedia(MP4(), PNG(EXPLORE_LIMITS.maxPoster + 1)).status, 413);
  assert.equal(checkMedia(MP4(), JPG()).kind, 'video');
});

test('display names come from the profile, never an email', () => {
  assert.equal(displayName(USERS['tok-alice']), 'Alice Ray');
  assert.equal(displayName(USERS['tok-bob']), 'Creator');
  assert.equal(displayName({}), 'Creator');
  assert.equal(displayName({ user_metadata: { display_name: 'x'.repeat(60) } }).length, 40);
});

test('sharing: sign-in, confirmation, origin, validation and storage', async () => {
  const env = makeEnv();
  assert.equal((await share(env, null)).status, 401);
  assert.equal((await share(env, 'tok-bogus')).status, 401);
  assert.equal((await share(env, 'tok-unconfirmed')).status, 403);
  assert.equal((await share(env, 'tok-alice', META(), PNG(), null, { origin: 'https://evil.example' })).status, 403);
  const badRemix = await share(env, 'tok-alice', META({ remix: 'https://evil.example/x' }));
  assert.equal(badRemix.status, 400);
  assert.equal(badRemix.data.field, 'remix');
  assert.equal((await share(env, 'tok-alice', META(), HTML())).status, 415);
  assert.equal((await share(env, 'tok-alice', META(), MP4(), null)).status, 400);

  const r = await share(env, 'tok-alice', META(), MP4(), JPG(), { origin: 'https://chucksi.com' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const p = r.data.post;
  assert.match(p.id, /^[a-z0-9]{12}$/);
  assert.equal(p.author, 'Alice Ray');
  assert.equal(p.kind, 'video');
  assert.equal(p.media, `/explore-media/${p.id}/media.mp4`);
  assert.equal(p.poster, `/explore-media/${p.id}/poster.jpg`);
  assert.equal(p.status, 'live');
  assert.equal(p.remix, '/video?move=arc-right&sample=fisherman');
  assert.ok(env.SITES_BUCKET.objects.has(`explore/${p.id}/media.mp4`));
  assert.ok(env.SITES_BUCKET.objects.has(`explore/${p.id}/poster.jpg`));
  assert.equal(env.SITES_BUCKET.objects.get(`explore/${p.id}/media.mp4`).httpMetadata.contentType, 'video/mp4');
  const dump = JSON.stringify(env.SITES_DB.dump());
  assert.ok(!dump.includes('alice@example.com'), 'no emails stored');

  // an image without a poster uses itself
  const img = await share(env, 'tok-bob', META({ tool: 'image', remix: '/image?prompt=koi' }), PNG());
  assert.equal(img.status, 201);
  assert.equal(img.data.post.poster, `/explore-media/${img.data.post.id}/poster.png`);
  assert.equal(img.data.post.author, 'Creator');

  // switched off
  assert.equal((await share({ ...env, EXPLORE_PAUSED: '1' }, 'tok-alice')).status, 503);
  assert.equal((await call({ SUPABASE_URL: 'x' }, 'GET', '/api/explore')).status, 501);
});

test('sharing goes behind the human check', async () => {
  assert.ok(exploreGated('POST', '/api/explore'));
  assert.ok(exploreGated('POST', '/api/explore/abcdef/report'));
  assert.ok(!exploreGated('POST', '/api/explore/abcdef/like'));
  assert.ok(!exploreGated('POST', '/api/explore/abcdef/remix'));
  assert.ok(!exploreGated('GET', '/api/explore'));
  const env = makeEnv({ TURNSTILE_SITEKEY: 'sk', TURNSTILE_SECRET: 'sec', PASS_KEY: 'pass' });
  const r = await share(env, 'tok-alice');
  assert.equal(r.status, 401);
  assert.equal(r.data.human, true);
  const rep = await call(env, 'POST', '/api/explore/abcdef12/report', { json: { reason: 'spam' } });
  assert.equal(rep.data.human, true);
  assert.equal((await call(env, 'GET', '/api/explore')).status, 200);
});

test('daily limits: per account, lower for new accounts, per IP', async () => {
  const env = makeEnv();
  for (let i = 0; i < EXPLORE_LIMITS.perNewAccountDaily; i++) assert.equal((await share(env, 'tok-new', META(), PNG(), null, { ip: `10.0.0.${i}` })).status, 201);
  assert.equal((await share(env, 'tok-new', META(), PNG(), null, { ip: '10.0.1.1' })).status, 429);
  // refused uploads count too
  const env2 = makeEnv({ EXPLORE_PER_ACCOUNT_DAILY: '2' });
  assert.equal((await share(env2, 'tok-alice', META(), HTML())).status, 415);
  assert.equal((await share(env2, 'tok-alice')).status, 201);
  assert.equal((await share(env2, 'tok-alice')).status, 429);
  now += 86400000;
  assert.equal((await share(env2, 'tok-alice')).status, 201, 'a new day');
  const env3 = makeEnv({ EXPLORE_PER_IP_DAILY: '1' });
  assert.equal((await share(env3, 'tok-alice', META(), PNG(), null, { ip: '1.1.1.1' })).status, 201);
  assert.equal((await share(env3, 'tok-bob', META(), PNG(), null, { ip: '1.1.1.1' })).status, 429);
});

test('new accounts: live by link at once, in the feed after the hold', async () => {
  const env = makeEnv();
  const r = await share(env, 'tok-new');
  assert.equal(r.status, 201);
  assert.equal(r.data.post.status, 'held');
  const id = r.data.post.id;
  assert.equal((await call(env, 'GET', '/api/explore')).data.posts.length, 0);
  assert.equal((await call(env, 'GET', `/api/explore/${id}`)).status, 200, 'the link works');
  assert.equal((await call(env, 'GET', `/explore-media/${id}/media.png`)).status, 200);
  const mine = await call(env, 'GET', '/api/explore?mine=1', { token: 'tok-new' });
  assert.equal(mine.data.posts[0].status, 'held');
  now += 22 * 3600000; // the account was an hour old: it turns one day old 23 hours from now
  assert.equal((await call(env, 'GET', '/api/explore')).data.posts.length, 0);
  now += 1 * 3600000;
  assert.deepEqual((await call(env, 'GET', '/api/explore')).data.posts.map((p) => p.id), [id]);
  // switched off: listed straight away
  const env2 = makeEnv({ EXPLORE_HOLD_HOURS: '0' });
  now = NOW;
  assert.equal((await share(env2, 'tok-new')).data.post.status, 'live');
  assert.equal((await call(env2, 'GET', '/api/explore')).data.posts.length, 1);
});

test('feed: new and top, tool filter, cursors without gaps or repeats', async () => {
  const env = makeEnv();
  const ids = [];
  for (let i = 0; i < 7; i++) {
    now = NOW + i * 1000;
    const tool = i % 2 ? 'image' : 'video';
    const r = await share(env, i % 2 ? 'tok-bob' : 'tok-alice', META({ title: `Post ${i}`, tool, remix: tool === 'image' ? '/image' : '/video?move=fpv' }), PNG(), null, { ip: `10.1.0.${i}` });
    ids.push(r.data.post.id);
  }
  // two posts share a timestamp: the id breaks the tie
  now = NOW + 6000;
  ids.push((await share(env, 'tok-alice', META({ title: 'Tie' }), PNG(), null, { ip: '10.1.1.1' })).data.post.id);
  now = NOW + 10000;
  const all = (await call(env, 'GET', '/api/explore')).data;
  assert.equal(all.posts.length, 8);
  assert.equal(all.cursor, null);
  assert.equal(all.posts[0].title === 'Tie' || all.posts[0].title === 'Post 6', true);
  const seen = [];
  let cursor = null;
  do {
    const page = (await call(env, 'GET', `/api/explore?limit=3${cursor ? `&cursor=${cursor}` : ''}`)).data;
    assert.ok(page.posts.length <= 3);
    seen.push(...page.posts.map((p) => p.id));
    cursor = page.cursor;
  } while (cursor);
  assert.deepEqual(seen, all.posts.map((p) => p.id), 'paging matches the full list');
  assert.equal(new Set(seen).size, 8);
  const images = (await call(env, 'GET', '/api/explore?tool=image')).data.posts;
  assert.equal(images.length, 3);
  assert.ok(images.every((p) => p.tool === 'image'));
  assert.equal((await call(env, 'GET', '/api/explore?tool=bogus')).status, 400);
  assert.equal((await call(env, 'GET', '/api/explore?cursor=garbage')).status, 400);
  assert.equal(decodeCursor('', 'new'), null);

  // top: likes count double, remixes once
  await call(env, 'POST', `/api/explore/${ids[0]}/like`, { token: 'tok-alice' });
  await call(env, 'POST', `/api/explore/${ids[0]}/like`, { token: 'tok-bob' });
  await call(env, 'POST', `/api/explore/${ids[3]}/remix`, { ip: '9.9.9.1' });
  await call(env, 'POST', `/api/explore/${ids[3]}/remix`, { ip: '9.9.9.2' });
  await call(env, 'POST', `/api/explore/${ids[3]}/remix`, { ip: '9.9.9.3' });
  const top = (await call(env, 'GET', '/api/explore?sort=top')).data.posts;
  assert.deepEqual(top.slice(0, 2).map((p) => p.id), [ids[0], ids[3]]);
  const topPaged = [];
  cursor = null;
  do {
    const page = (await call(env, 'GET', `/api/explore?sort=top&limit=2${cursor ? `&cursor=${cursor}` : ''}`)).data;
    topPaged.push(...page.posts.map((p) => p.id));
    cursor = page.cursor;
  } while (cursor);
  assert.deepEqual(topPaged, top.map((p) => p.id));
  assert.equal((await call(env, 'GET', '/api/explore?sort=top&cursor=' + all.posts[0].id)).status, 400);
});

test('likes: signed in, one per account, unlike', async () => {
  const env = makeEnv();
  const id = (await share(env, 'tok-alice')).data.post.id;
  assert.equal((await call(env, 'POST', `/api/explore/${id}/like`)).status, 401);
  let r = await call(env, 'POST', `/api/explore/${id}/like`, { token: 'tok-bob' });
  assert.deepEqual([r.status, r.data.likes, r.data.liked], [200, 1, true]);
  r = await call(env, 'POST', `/api/explore/${id}/like`, { token: 'tok-bob' });
  assert.equal(r.data.likes, 1, 'liking twice counts once');
  r = await call(env, 'POST', `/api/explore/${id}/like`, { token: 'tok-alice' });
  assert.equal(r.data.likes, 2);
  const view = await call(env, 'GET', `/api/explore/${id}`, { token: 'tok-bob' });
  assert.equal(view.data.post.liked, true);
  assert.equal(view.data.post.mine, false);
  assert.equal((await call(env, 'GET', `/api/explore/${id}`, { token: 'tok-alice' })).data.post.mine, true);
  r = await call(env, 'DELETE', `/api/explore/${id}/like`, { token: 'tok-bob' });
  assert.deepEqual([r.data.likes, r.data.liked], [1, false]);
  assert.equal((await call(env, 'DELETE', `/api/explore/${id}/like`, { token: 'tok-bob' })).data.likes, 1);
  assert.equal((await call(env, 'POST', '/api/explore/zzzzzzzz/like', { token: 'tok-bob' })).status, 404);
  assert.equal((await call(env, 'GET', `/api/explore/${id}`)).data.post.liked, undefined, 'signed out sees no like state');
});

test('remixes: counted once per visitor a day', async () => {
  const env = makeEnv();
  const id = (await share(env, 'tok-alice')).data.post.id;
  assert.equal((await call(env, 'POST', `/api/explore/${id}/remix`)).data.counted, true);
  assert.equal((await call(env, 'POST', `/api/explore/${id}/remix`)).data.counted, false);
  assert.equal((await call(env, 'POST', `/api/explore/${id}/remix`, { ip: '198.51.100.2' })).data.counted, true);
  assert.equal((await call(env, 'GET', `/api/explore/${id}`)).data.post.remixes, 2);
  now += 86400000;
  assert.equal((await call(env, 'POST', `/api/explore/${id}/remix`)).data.counted, true);
  assert.equal((await call(env, 'GET', `/api/explore/${id}/remix`)).status, 405);
  assert.equal((await call(env, 'POST', '/api/explore/zzzzzzzz/remix')).status, 404);
});

test('reports: hidden after enough different people, media stops, owner still sees it', async () => {
  const env = makeEnv();
  const id = (await share(env, 'tok-alice')).data.post.id;
  assert.equal((await call(env, 'POST', `/api/explore/${id}/report`, { json: { reason: 'nope' } })).status, 400);
  assert.equal((await call(env, 'POST', '/api/explore/zzzzzzzz/report', { json: { reason: 'spam' } })).status, 404);
  for (let i = 0; i < 4; i++) assert.equal((await call(env, 'POST', `/api/explore/${id}/report`, { json: { reason: 'spam' }, ip: '192.0.2.1' })).data.hidden, false, 'one person, many reports');
  assert.equal((await call(env, 'POST', `/api/explore/${id}/report`, { json: { reason: 'sexual', details: 'x' }, ip: '192.0.2.2' })).data.hidden, false);
  assert.equal((await call(env, 'POST', `/api/explore/${id}/report`, { json: { reason: 'sexual' }, ip: '192.0.2.3' })).data.hidden, true);
  _resetExploreCaches();
  assert.equal(env.MASSLESS_KV.map.get(`explore-block:${id}`), 'reports');
  assert.equal((await call(env, 'GET', '/api/explore')).data.posts.length, 0);
  assert.equal((await call(env, 'GET', `/api/explore/${id}`)).status, 410);
  assert.equal((await call(env, 'GET', `/explore-media/${id}/media.png`)).status, 410);
  assert.equal((await call(env, 'POST', `/api/explore/${id}/like`, { token: 'tok-bob' })).status, 404);
  const own = await call(env, 'GET', `/api/explore/${id}`, { token: 'tok-alice' });
  assert.equal(own.data.post.status, 'hidden');
  // reports per IP per day
  const env2 = makeEnv();
  const id2 = (await share(env2, 'tok-alice')).data.post.id;
  for (let i = 0; i < EXPLORE_LIMITS.reportsPerIpDaily; i++) await call(env2, 'POST', `/api/explore/${id2}/report`, { json: { reason: 'spam' }, ip: '192.0.2.9' });
  assert.equal((await call(env2, 'POST', `/api/explore/${id2}/report`, { json: { reason: 'spam' }, ip: '192.0.2.9' })).status, 429);
  // an operator takedown (KV flag) hides a post too
  const env3 = makeEnv();
  const id3 = (await share(env3, 'tok-alice')).data.post.id;
  await env3.MASSLESS_KV.put(`explore-block:${id3}`, 'manual');
  _resetExploreCaches();
  assert.equal((await call(env3, 'GET', '/api/explore')).data.posts.length, 0);
  assert.equal((await call(env3, 'GET', `/explore-media/${id3}/poster.png`)).status, 410);
});

test('delete: owner only, media removed', async () => {
  const env = makeEnv();
  const id = (await share(env, 'tok-alice', META(), MP4(), JPG())).data.post.id;
  await call(env, 'POST', `/api/explore/${id}/like`, { token: 'tok-bob' });
  assert.equal((await call(env, 'DELETE', `/api/explore/${id}`)).status, 401);
  assert.equal((await call(env, 'DELETE', `/api/explore/${id}`, { token: 'tok-bob' })).status, 403);
  assert.equal((await call(env, 'DELETE', `/api/explore/${id}`, { token: 'tok-alice', origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(env, 'DELETE', `/api/explore/${id}`, { token: 'tok-alice' })).status, 200);
  assert.equal([...env.SITES_BUCKET.objects.keys()].filter((k) => k.startsWith(`explore/${id}/`)).length, 0);
  assert.equal(env.SITES_DB.dump().explore_likes.length, 0);
  assert.equal((await call(env, 'GET', `/api/explore/${id}`)).status, 404);
  assert.equal((await call(env, 'GET', `/explore-media/${id}/media.mp4`)).status, 404);
  assert.equal((await call(env, 'DELETE', `/api/explore/${id}`, { token: 'tok-alice' })).status, 404);
});

test('media: served from R2 with safe headers and byte ranges', async () => {
  const env = makeEnv();
  const video = MP4(5000);
  const id = (await share(env, 'tok-alice', META(), video, JPG())).data.post.id;
  const r = await call(env, 'GET', `/explore-media/${id}/media.mp4`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'video/mp4');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.equal(r.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(r.bytes, video);
  const part = await call(env, 'GET', `/explore-media/${id}/media.mp4`, { headers: { range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 100-199/5000');
  assert.deepEqual(part.bytes, video.slice(100, 200));
  const tail = await call(env, 'GET', `/explore-media/${id}/media.mp4`, { headers: { range: 'bytes=-10' } });
  assert.deepEqual(tail.bytes, video.slice(4990));
  assert.equal((await call(env, 'GET', `/explore-media/${id}/media.mp4`, { headers: { range: 'bytes=9000-' } })).status, 416);
  const etag = r.headers.get('etag');
  assert.equal((await call(env, 'GET', `/explore-media/${id}/media.mp4`, { headers: { 'if-none-match': etag } })).status, 304);
  const head = await call(env, 'HEAD', `/explore-media/${id}/poster.jpg`);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'image/jpeg');
  assert.equal((await call(env, 'GET', `/explore-media/${id}/media.webm`)).status, 404, 'wrong extension');
  assert.equal((await call(env, 'GET', `/explore-media/${id}/other.mp4`)).status, 404);
  assert.equal((await call(env, 'GET', `/explore-media/${id}/media.html`)).status, 404);
  assert.equal((await call(env, 'GET', '/explore-media/AB/media.mp4')).status, 404);
  assert.equal((await call(env, 'POST', `/explore-media/${id}/media.mp4`)).status, 405);
});

test('seed posts: 20 to 30 valid posts from media in the repo', async () => {
  const posts = seedPosts();
  assert.ok(posts.length >= 20 && posts.length <= 30, `${posts.length} posts`);
  assert.equal(new Set(posts.map((p) => p.id)).size, posts.length);
  assert.ok(new Set(posts.map((p) => p.row.tool)).size >= 4, 'several tools');
  for (const p of posts) {
    assert.ok(checkRemix(p.row.tool, p.row.remix).url === p.row.remix, p.row.remix);
    assert.match(p.id, /^[a-z0-9]{6,20}$/);
  }
  // the generated SQL loads into the schema and the feed lists it
  const { readFileSync } = await import('node:fs');
  const env = makeEnv();
  env.SITES_DB.sqlite.exec(readFileSync(new URL('../tools/explore/seed/seed.sql', import.meta.url), 'utf8'));
  const feed = (await call(env, 'GET', '/api/explore?limit=48')).data.posts;
  assert.equal(feed.length, posts.length);
  assert.equal(feed[0].id, 'chucksi01');
  assert.equal(feed[0].author, 'Chucksi');
});

test('routes: /explore is a page, unknown explore paths are not', async () => {
  assert.equal((await call(makeEnv(), 'GET', '/api/explore/bad!id')).status, 404);
  assert.equal((await call(makeEnv(), 'PUT', '/api/explore')).status, 405);
});

test('starter posts point at the example clips already on the site', async () => {
  const { serveExploreMedia } = await import('../src/explore.js');
  const r = await serveExploreMedia(new Request('https://chucksi.com/explore-media/chucksi01/media.mp4'), { SITES_BUCKET: { head: async () => null }, MASSLESS_KV: { get: async () => null } });
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /^\/media\/templates\/[\w.-]+\.mp4$/);
});
