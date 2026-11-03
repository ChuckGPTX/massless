import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { cleanQuery, PlaceGate, LAYER, MAX_Z } from "../src/place.js";
import { presetById } from "../public/js/presets/catalog.js";
import { copyHits, copyStrings, validateSpec } from "../public/js/presets/spec.js";
import { worldPx, squareTiles, unproject, NOTES, CREDIT, height } from "../public/js/presets/engines/earth.js";

function kv() {
  const m = new Map();
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v, o) => void m.set(k, v) };
}
function fakeCaches() {
  const m = new Map();
  return { m, default: { match: async (r) => m.get(r.url)?.clone(), put: async (r, res) => void m.set(r.url, res) } };
}
// Swap fetch (and caches) for one test, recording every outside call.
async function withFetch(answer, fn, { cache = null } = {}) {
  const realFetch = globalThis.fetch, realCaches = globalThis.caches, calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), headers: new Headers(init.headers || {}) }); return answer(String(url), init); };
  if (cache) globalThis.caches = cache;
  try { return await fn(calls); } finally { globalThis.fetch = realFetch; globalThis.caches = realCaches; }
}
const run = (path, env = {}, init = {}) => {
  const pending = [];
  return worker.fetch(new Request(`https://chucksi.com${path}`, init), env, { waitUntil: (p) => pending.push(p) }).then(async (r) => { await Promise.all(pending); return r; });
};
const LISBON = [{ name: "Lisboa", display_name: "Lisboa, Grande Lisboa, Portugal", lat: "38.7077507", lon: "-9.1365919" }];

test("place search: one polite OpenStreetMap request, then answered from the cache", async () => {
  const env = { MASSLESS_KV: kv() };
  await withFetch(() => Response.json(LISBON), async (calls) => {
    const r = await run("/api/place?q=%20Lisbon%20%20Portugal", env, { headers: { "cf-connecting-ip": "203.0.113.9" } });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { name: "Lisboa", full: "Lisboa, Grande Lisboa, Portugal", lat: 38.70775, lon: -9.13659 });
    assert.equal(calls.length, 1);
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, "https://nominatim.openstreetmap.org/search");
    assert.equal(u.searchParams.get("q"), "Lisbon Portugal");
    assert.equal(u.searchParams.get("limit"), "1");
    assert.match(calls[0].headers.get("user-agent"), /^Chucksi\/.*chucksi\.com/);
    assert.equal(calls[0].headers.get("referer"), "https://chucksi.com/");
    // nothing about the visitor goes upstream
    assert.ok(![...calls[0].headers.values()].some((v) => v.includes("203.0.113.9")));
    assert.ok(![...calls[0].headers.keys()].some((k) => /forwarded|cf-connecting-ip|x-real-ip/.test(k)));
    // the same words (any case) are answered from KV, for 30 days
    const again = await run("/api/place?q=LISBON portugal", env);
    assert.equal(again.status, 200);
    assert.equal((await again.json()).name, "Lisboa");
    assert.equal(calls.length, 1, "no second upstream request");
    const stored = [...env.MASSLESS_KV.m.keys()].filter((k) => k.startsWith("placeq:"));
    assert.equal(stored.length, 1);
    assert.ok(!stored[0].includes("lisbon"), "the cache key is a hash, not the words");
  });
});

test("place search: not found is cached briefly, failures are not cached, bad input is refused", async () => {
  const env = { MASSLESS_KV: kv() };
  await withFetch(() => Response.json([]), async (calls) => {
    const r = await run("/api/place?q=Qwxzzy", env);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).notFound, true);
    assert.equal((await run("/api/place?q=qwxzzy", env)).status, 404);
    assert.equal(calls.length, 1, "a miss is remembered too, so the same words are not sent again");
  });
  await withFetch(() => new Response("busy", { status: 503 }), async () => {
    const r = await run("/api/place?q=Porto", env);
    assert.equal(r.status, 502);
    assert.equal([...env.MASSLESS_KV.m.values()].filter((v) => v.includes("Porto")).length, 0);
  });
  await withFetch(() => { throw new Error("offline"); }, async () => assert.equal((await run("/api/place?q=Porto", env)).status, 502));
  await withFetch(() => Response.json(LISBON), async (calls) => {
    assert.equal((await run("/api/place?q=a", env)).status, 400);
    assert.equal((await run("/api/place", env)).status, 400);
    assert.equal((await run("/api/place?q=Lisbon", env, { method: "POST" })).status, 405);
    assert.equal((await run("/api/place?q=Lisbon", env, { headers: { origin: "https://elsewhere.example" } })).status, 403);
    assert.equal(calls.length, 0);
  });
  assert.equal(cleanQuery("  <b>Rome</b>\n\t Italy " + "x".repeat(200)).length, 120);
  assert.equal(cleanQuery("  Rome\n\tItaly "), "Rome Italy");
});

test("place search: each visitor gets a daily allowance of new lookups", async () => {
  const env = { MASSLESS_KV: kv(), PER_VISITOR_PLACE: "2", PLACE_CAP: "100" };
  await withFetch(() => Response.json(LISBON), async (calls) => {
    const ip = { headers: { "cf-connecting-ip": "198.51.100.4" } };
    assert.equal((await run("/api/place?q=Lisbon", env, ip)).status, 200);
    assert.equal((await run("/api/place?q=Porto", env, ip)).status, 200);
    assert.equal((await run("/api/place?q=Faro", env, ip)).status, 429);
    assert.equal((await run("/api/place?q=Lisbon", env, ip)).status, 200, "places already found still answer");
    assert.equal((await run("/api/place?q=Faro", env, { headers: { "cf-connecting-ip": "198.51.100.5" } })).status, 200, "another visitor is not affected");
    assert.equal(calls.length, 3);
  });
});

test("place search: the site-wide gate spaces OpenStreetMap requests over a second apart", async () => {
  const gate = new PlaceGate();
  const waits = [];
  for (let i = 0; i < 4; i++) waits.push((await gate.fetch().json()).wait);
  assert.equal(waits[0], 0);
  for (let i = 1; i < 4; i++) assert.ok(waits[i] - waits[i - 1] >= 1000, `${waits}`);
  for (let i = 0; i < 4; i++) await gate.fetch();
  assert.equal((await gate.fetch().json()).wait, -1, "a long queue answers busy instead of waiting");
  // the Worker asks the gate before every upstream call and says busy when told to
  const busy = { MASSLESS_KV: kv(), PLACE_GATE: { idFromName: (n) => n, get: () => ({ fetch: async () => Response.json({ wait: -1 }) }) } };
  await withFetch(() => Response.json(LISBON), async (calls) => {
    const r = await run("/api/place?q=Lisbon", busy);
    assert.equal(r.status, 503);
    assert.equal(calls.length, 0);
  });
});

test("satellite views: only the CC BY 2016 layer, zoom 0 to 13, cached hard", async () => {
  const cache = fakeCaches();
  const jpeg = new Uint8Array(2000).fill(7);
  await withFetch(() => new Response(jpeg, { headers: { "content-type": "image/jpeg" } }), async (calls) => {
    const r = await run("/earth-tiles/11/975/770.jpg", {}, { headers: { "cf-connecting-ip": "203.0.113.9" } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/jpeg");
    assert.match(r.headers.get("cache-control"), /public, max-age=2592000, immutable/);
    assert.equal((await r.arrayBuffer()).byteLength, 2000);
    assert.equal(calls.length, 1);
    // WMTS order is {z}/{row}/{col}: y before x
    assert.equal(calls[0].url, `https://tiles.maps.eox.at/wmts/1.0.0/${LAYER}/default/g/11/770/975.jpg`);
    assert.equal(LAYER, "s2cloudless_3857");
    assert.match(calls[0].headers.get("user-agent"), /Chucksi/);
    // a second visitor is served from the edge cache
    const again = await run("/earth-tiles/11/975/770.jpg");
    assert.equal(again.status, 200);
    assert.equal(calls.length, 1);
    // outside the allowed range, or another layer or year: not found, nothing fetched
    for (const p of [`/earth-tiles/${MAX_Z + 1}/0/0.jpg`, "/earth-tiles/2/4/0.jpg", "/earth-tiles/2/0/4.jpg", "/earth-tiles/s2cloudless-2024_3857/2/0/0.jpg", "/earth-tiles/2/0/0.png", "/earth-tiles/../api/place.jpg"]) {
      assert.equal((await run(p)).status, 404, p);
    }
    assert.equal((await run("/earth-tiles/1/0/0.jpg", {}, { method: "POST" })).status, 405);
    assert.equal(calls.length, 1);
  }, { cache });
});

test("satellite views: upstream trouble is not cached, and a fast visitor is slowed on cache misses", async () => {
  const cache = fakeCaches();
  await withFetch(() => new Response("rate limited", { status: 429 }), async () => {
    const r = await run("/earth-tiles/3/1/2.jpg");
    assert.equal(r.status, 502);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(cache.m.size, 0);
  }, { cache });
  await withFetch(() => new Response("<html>", { headers: { "content-type": "text/html" } }), async () => assert.equal((await run("/earth-tiles/3/1/2.jpg")).status, 502), { cache });
  const keys = [];
  const env = { TILE_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } };
  await withFetch(() => new Response(new Uint8Array(500), { headers: { "content-type": "image/jpeg" } }), async (calls) => {
    const r = await run("/earth-tiles/4/1/2.jpg", env, { headers: { "cf-connecting-ip": "203.0.113.9" } });
    assert.equal(r.status, 429);
    assert.equal(calls.length, 0);
    assert.ok(keys[0] && !keys[0].includes("203.0.113.9"), "the limiter sees a hash, not the address");
  }, { cache });
});

test("Earth zoom out copy is plain and the place is looked up only on submit", () => {
  const spec = presetById("earth-zoom-out");
  assert.deepEqual(validateSpec(spec), []);
  const where = spec.inputs.find((i) => i.key === "where");
  assert.equal(where.label, "Where was this photo taken?");
  assert.equal(where.default, "", "no place by default keeps the illustrated climb");
  assert.ok(where.go, "the field has a button, so typing never sends anything");
  assert.match(where.hint, /OpenStreetMap/);
  assert.match(spec.note, /EOxCloudless 2016 by EOX IT Services GmbH \(contains modified Copernicus Sentinel data 2016\), CC BY 4\.0/);
  assert.match(spec.note, /© OpenStreetMap contributors/);
  const visible = [...copyStrings(spec), NOTES.finding, NOTES.gathering, NOTES.found("Lisboa, Portugal"), NOTES.notFound("x"), NOTES.polar, NOTES.offline, ...CREDIT];
  assert.deepEqual(copyHits(...visible), []);
  for (const s of visible) assert.doesNotMatch(s, /\b(tiles?|API|geocod\w*|lat\/lon|WMTS|model|zoom level|server)\b/i, s);
  assert.ok(validateSpec({ ...spec, inputs: [{ ...where, hint: "Uses map tiles" }, ...spec.inputs.filter((i) => i.key !== "where")] }).some((e) => e.includes("tiles")));
  assert.ok(validateSpec({ ...spec, inputs: [{ ...where, go: "x".repeat(40) }] }).some((e) => e.includes("go")));
  assert.ok(CREDIT.join(" ").includes("Contains modified Copernicus Sentinel data 2016"));
});

test("Earth zoom out maths: map squares centre on the place and the globe faces it", () => {
  // Lisbon at zoom 13: the 768 px square needs at most 16 tiles, and its centre is the place
  const [X, Y] = worldPx(38.70775, -9.13659, 13);
  const tiles = squareTiles(38.70775, -9.13659, 13);
  assert.ok(tiles.length <= 16 && tiles.length >= 9);
  for (const [z, x, y, dx, dy] of tiles) {
    assert.equal(z, 13);
    assert.ok(Math.abs(x * 256 - dx - (X - 384)) < 1e-6 && Math.abs(y * 256 - dy - (Y - 384)) < 1e-6);
  }
  // across the date line the columns wrap
  for (const [, x] of squareTiles(0, 179.99, 5)) assert.ok(x >= 0 && x < 32);
  // the disc's centre is the place itself, and the rim is 90 degrees away
  const [la, lo] = unproject(0, 0, 38.7, -9.1);
  assert.ok(Math.abs(la - 38.7) < 1e-9 && Math.abs(lo + 9.1) < 1e-9);
  const [top] = unproject(0, 1, 0, 0);
  assert.ok(Math.abs(top - 90) < 1e-6);
  const [, east] = unproject(1, 0, 0, 0);
  assert.ok(Math.abs(east - 90) < 1e-6);
  // the default climb is unchanged
  assert.equal(height(0, 7), 0);
  assert.ok(Math.abs(height(7, 7) - 5) < 1e-9);
});
