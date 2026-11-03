// Earth zoom out over a real place (public/js/presets/engines/earth.js). The page only talks to chucksi.com, so
// this Worker does the two outside calls for it:
//   GET /api/place?q=Lisbon        -> { name, full, lat, lon } for the top OpenStreetMap match (Nominatim).
//   GET /earth-tiles/{z}/{x}/{y}.jpg -> one EOxCloudless 2016 satellite tile (EOX, CC BY 4.0), z 0..13.
// Nominatim's usage policy (operations.osmfoundation.org/policies/nominatim): no autocomplete (the page asks only
// when the visitor presses the button), at most 1 request per second for the whole site (PlaceGate below),
// identify the app (User-Agent and Referer), cache results (KV, 30 days) and show "© OpenStreetMap contributors".
// Only the words the visitor typed are sent on; never their address or location.
// EOX asks for attribution and a link back (maps.eox.at); the layer is the 2016 one, the last under CC BY 4.0.
// Later years are CC BY-NC-SA, so they are refused here. Tiles are cached hard at the edge and in the browser.

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const AGENT = 'Chucksi/1.0 (https://chucksi.com; Earth zoom out place search; https://github.com/ChuckGPTX/massless)';
export const LAYER = 's2cloudless_3857';
export const MAX_Z = 13;
const tileUrl = (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/${LAYER}/default/g/${z}/${y}/${x}.jpg`;
const PLACE_DAYS = 30;
const GAP_MS = 1100; // a little over one second between Nominatim requests, site-wide
const MAX_WAIT_MS = 6000; // more than a few visitors in the queue: answer "busy" instead of piling up

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** The query as it is looked up and cached: plain text, single spaces, at most 120 characters. */
export const cleanQuery = (q) => String(q || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

// One request per second for the whole site: a single Durable Object hands out start times 1.1 s apart.
// Without the binding (tests, local dev) the same queue runs in this isolate only.
let localNext = 0;
function reserve(now, next) {
  const at = Math.max(now, next);
  return at - now > MAX_WAIT_MS ? { wait: -1, next } : { wait: at - now, next: at + GAP_MS };
}
export class PlaceGate {
  constructor() { this.next = 0; }
  fetch() {
    const r = reserve(Date.now(), this.next);
    this.next = r.next;
    return Response.json({ wait: r.wait });
  }
}
async function turn(env) {
  let wait;
  if (env.PLACE_GATE) wait = (await (await env.PLACE_GATE.get(env.PLACE_GATE.idFromName('nominatim')).fetch('https://gate/turn')).json()).wait;
  else { const r = reserve(Date.now(), localNext); localNext = r.next; wait = r.wait; }
  if (wait < 0) return false;
  if (wait > 0) await sleep(wait);
  return true;
}

/** GET /api/place?q= ; `allow` is the Worker's daily per-visitor limiter (src/index.js). */
export async function placeApi(request, env, { allow }) {
  if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  const q = cleanQuery(new URL(request.url).searchParams.get('q'));
  if (q.length < 2) return json({ error: 'Type a place name first.' }, 400);
  const key = `placeq:${await sha(q.toLowerCase())}`;
  const kv = env.MASSLESS_KV;
  const hit = kv ? await kv.get(key).catch(() => null) : null;
  if (hit) {
    try {
      const v = JSON.parse(hit);
      return v.found ? json(v.place, 200, { 'cache-control': 'private, max-age=86400' }) : json({ error: 'We couldn’t find that place.', notFound: true }, 404);
    } catch { /* look it up again */ }
  }
  // Only lookups that reach OpenStreetMap count against the daily allowance.
  const gate = await allow(request, env, 'place', Number(env.PLACE_CAP || 1500), Number(env.PER_VISITOR_PLACE || 25));
  if (gate) return gate;
  if (!(await turn(env))) return json({ error: 'Lots of people are looking up places right now. Try again in a few seconds.' }, 503, { 'retry-after': '5' });
  let rows;
  try {
    const r = await fetch(`${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, {
      headers: { 'user-agent': AGENT, referer: 'https://chucksi.com/', 'accept-language': 'en' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`status ${r.status}`);
    rows = await r.json();
  } catch (e) {
    console.warn('place lookup failed:', e?.message || e);
    return json({ error: 'We couldn’t look places up just now. Try again in a minute.' }, 502);
  }
  const top = Array.isArray(rows) ? rows[0] : null;
  const lat = Number(top?.lat), lon = Number(top?.lon);
  if (!top || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    if (kv) await kv.put(key, JSON.stringify({ found: false }), { expirationTtl: 86400 }).catch(() => {});
    return json({ error: 'We couldn’t find that place.', notFound: true }, 404);
  }
  const full = String(top.display_name || q).slice(0, 200);
  const place = { name: String(top.name || full.split(',')[0] || q).trim().slice(0, 60), full, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 };
  if (kv) await kv.put(key, JSON.stringify({ found: true, place }), { expirationTtl: PLACE_DAYS * 86400 }).catch(() => {});
  return json(place, 200, { 'cache-control': 'private, max-age=86400' });
}

const TILE_PATH = /^\/earth-tiles\/(\d{1,2})\/(\d{1,5})\/(\d{1,5})\.jpg$/;
export const isEarthTile = (path) => path.startsWith('/earth-tiles/');
/** GET /earth-tiles/{z}/{x}/{y}.jpg ; `hashIp` keys the per-visitor burst limit (TILE_LIMITER, misses only). */
export async function earthTile(request, env, ctx, { hashIp }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const m = new URL(request.url).pathname.match(TILE_PATH);
  const [z, x, y] = m ? m.slice(1).map(Number) : [];
  if (!m || z > MAX_Z || x >= 2 ** z || y >= 2 ** z) return new Response('Not found', { status: 404, headers: { 'cache-control': 'public, max-age=86400' } });
  const key = new Request(`https://chucksi-earth-tiles.internal/${LAYER}/${z}/${x}/${y}.jpg`);
  const cache = globalThis.caches?.default;
  const hit = cache ? await cache.match(key) : null;
  if (hit) return request.method === 'HEAD' ? new Response(null, hit) : hit;
  if (env.TILE_LIMITER) {
    const { success } = await env.TILE_LIMITER.limit({ key: await hashIp(request.headers.get('cf-connecting-ip') || 'unknown') });
    if (!success) return new Response('Slow down', { status: 429, headers: { 'retry-after': '30', 'cache-control': 'no-store' } });
  }
  let bytes;
  try {
    const r = await fetch(tileUrl(z, x, y), { headers: { 'user-agent': AGENT, referer: 'https://chucksi.com/' }, cf: { cacheTtl: 2592000, cacheEverything: true }, signal: AbortSignal.timeout(10000) });
    if (!r.ok || !/^image\/jpe?g/.test(r.headers.get('content-type') || 'image/jpeg')) throw new Error(`status ${r.status}`);
    bytes = await r.arrayBuffer();
    if (bytes.byteLength < 100 || bytes.byteLength > 1048576) throw new Error(`size ${bytes.byteLength}`);
  } catch (e) {
    console.warn('earth tile failed:', z, x, y, e?.message || e);
    return new Response('Tile unavailable', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  const res = new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=2592000, immutable', 'x-content-type-options': 'nosniff', 'x-imagery': 'EOxCloudless 2016 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0' } });
  if (cache) ctx?.waitUntil?.(cache.put(key, res.clone()));
  return request.method === 'HEAD' ? new Response(null, res) : res;
}
