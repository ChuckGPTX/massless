// Massless Games: pure logic that runs in Node (no browser): recipes, remix, playtests, share links, the
// download bundler and the /api/game Worker route. The page itself is covered by tests/games_test.py.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GENRES, GENRE_IDS, TUNING, GAME_RULES, templateRecipe, sanitizeRecipe, remixRecipe, guessGenre, shareable } from "../public/js/games/recipe.js";
import { PALETTES, SCENES } from "../public/js/games/art.js";
import { encodeRecipe, decodeRecipe, wrapModule } from "../public/js/games/share.js";
import { GALLERY } from "../public/js/games/gallery.js";

const inRange = (r) => Object.entries(TUNING[r.genre]).every(([k, [lo, hi]]) => r.tuning[k] >= lo && r.tuning[k] <= hi);

test("the built-in writer reads the genre and look from a prompt", () => {
  assert.equal(guessGenre("stack donuts as high as you can"), "stack");
  assert.equal(guessGenre("a hungry shark eating smaller fish"), "eatgrow");
  assert.equal(guessGenre("a knight finds keys in a dungeon maze"), "maze");
  assert.equal(guessGenre("aliens invade, shoot them down"), "shooter");
  assert.equal(guessGenre("match three gems"), "match");
  assert.equal(guessGenre("a fox hopping puddles"), "runner");
  const r = templateRecipe("a penguin sliding down an icy mountain at night", "runner");
  assert.equal(r.genre, "runner");
  assert.equal(r.player.shape, "bird");
  assert.equal(r.world.scene, "snow");
  assert.ok(PALETTES[r.palette]);
  for (const g of GENRE_IDS) {
    const t = templateRecipe("something fun", g);
    assert.equal(t.genre, g);
    assert.ok(inRange(t), g);
    assert.deepEqual(sanitizeRecipe(t, t), t, `sanitizing a good ${g} recipe changes nothing`);
  }
  assert.equal(templateRecipe("build a tower", "stack", { dims: "3d" }).dims, "3d");
  assert.equal(templateRecipe("a maze", "maze", { dims: "3d" }).dims, "2d", "3D is Stack only");
});

test("sanitizeRecipe survives fuzzed junk and never pollutes prototypes", () => {
  let s = 99;
  const R = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const junk = (d = 0) => {
    if (d > 3) return R();
    return [null, undefined, NaN, -Infinity, 1e308, "x".repeat(Math.floor(R() * 3000)), "<img onerror=x>", [junk(d + 1)],
      Object.fromEntries(["title", "genre", "tuning", "player", "art", "music", "goal", "seed", "palette", "__proto__", "constructor", "world", "text"].map((k) => [k, junk(d + 1)])),
      { genre: GENRE_IDS[Math.floor(R() * 6)], tuning: { speed: "1e9", kinds: -3, lives: 99 }, art: { player: "https://evil.example/a.png", bg: "/media/games/../x.png" }, music: { bpm: 9e9, style: "metal" } },
      JSON.stringify({ title: "From text", genre: "maze" })][Math.floor(R() * 11)];
  };
  const fb = templateRecipe("a fox", "runner");
  for (let i = 0; i < 800; i++) {
    const out = sanitizeRecipe(junk(), fb);
    assert.ok(GENRES[out.genre]);
    assert.ok(PALETTES[out.palette]);
    assert.ok(SCENES.includes(out.world.scene));
    assert.ok(out.title.length >= 2 && out.title.length <= 40 && !/[<>]/.test(out.title));
    assert.ok(inRange(out), JSON.stringify(out.tuning));
    assert.ok(out.music.bpm >= 80 && out.music.bpm <= 170);
    assert.ok(!/evil|\.\./.test(JSON.stringify(out.art)));
  }
  assert.equal(({}).title, undefined);
  assert.equal(sanitizeRecipe(null, fb), fb, "unusable input returns the fallback itself");
  assert.equal(sanitizeRecipe('{"recipe":{"title":"Wrapped","genre":"maze"}}', fb).title, "Wrapped");
});

test("a manual remix changes only what was asked and stays in range", () => {
  const base = templateRecipe("a robot runs over rooftops", "runner");
  const hard = remixRecipe(base, { difficulty: 1 });
  assert.ok(hard.tuning.speed > base.tuning.speed);
  assert.equal(hard.seed, base.seed);
  const easy = remixRecipe(base, { difficulty: -1, title: "Rooftop Stroll", palette: "candy", scene: "candy", newLevels: true });
  assert.ok(easy.tuning.speed < base.tuning.speed);
  assert.equal(easy.title, "Rooftop Stroll");
  assert.equal(easy.palette, "candy");
  assert.equal(easy.world.scene, "candy");
  assert.notEqual(easy.seed, base.seed);
  assert.ok(inRange(easy));
  const m = remixRecipe(templateRecipe("gems", "match"), { difficulty: 1 });
  assert.ok(inRange(m));
});

test("playtests pass for the 2D templates on several seeds, and gallery games pass", async () => {
  for (const g of ["runner", "shooter", "match", "maze", "eatgrow"]) {
    const tpl = await import(`../public/js/games/${g}.js`);
    for (let i = 0; i < 4; i++) {
      const r = templateRecipe("a fun little game", g, { seed: 1000 + i * 4242 });
      const res = tpl.playtest(r);
      assert.ok(res.ok, `${g} seed ${r.seed}: ${res.notes.join(" | ")}`);
    }
  }
  for (const item of GALLERY.filter((x) => x.recipe.genre !== "stack")) {
    const tpl = await import(`../public/js/games/${item.recipe.genre}.js`);
    const r = sanitizeRecipe(item.recipe, templateRecipe("", item.recipe.genre));
    assert.ok(tpl.playtest(r).ok, item.id);
  }
  assert.equal(GALLERY.length, 12);
  for (const g of GENRE_IDS) assert.equal(GALLERY.filter((x) => x.recipe.genre === g).length, 2, g);
});

test("share links carry the recipe, never image data", async () => {
  const r = { ...templateRecipe("a slime in a cave", "eatgrow"), art: { player: "data:image/png;base64,AAAA", bg: "/media/games/tp-greenhouse.jpg" } };
  const code = await encodeRecipe(r);
  assert.match(code, /^z[A-Za-z0-9_-]+$/);
  const back = await decodeRecipe(code);
  assert.equal(back.art.player, undefined);
  assert.equal(back.art.bg, "/media/games/tp-greenhouse.jpg");
  assert.deepEqual(sanitizeRecipe(back, r), sanitizeRecipe(shareable(r), r));
  assert.ok(code.length < 1500);
  await assert.rejects(decodeRecipe("qnope"));
});

test("the download bundler turns the ES modules into one self-contained script", async () => {
  const src = async (f) => readFile(new URL(`../public/js/${f}`, import.meta.url), "utf8");
  const __m = {};
  let code = "";
  for (const [name, file] of [["engine", "games/engine.js"], ["art", "games/art.js"], ["template", "games/maze.js"], ["score", "score.js"]]) {
    const w = wrapModule(name, await src(file));
    assert.deepEqual(w.hoisted, []);
    assert.ok(!/^\s*(import|export)\s/m.test(w.code), `${name} has no module syntax left`);
    code += w.code;
  }
  new Function("__m", code)(__m);
  assert.equal(typeof __m.engine.mountGame, "function");
  assert.equal(typeof __m.template.create, "function");
  assert.equal(typeof __m.score.renderScore, "function");
  const game = new __m.engine.Game({ template: __m.template, recipe: templateRecipe("a mouse in a maze", "maze"), headless: true, bot: true });
  game.start();
  game.advance(10);
  assert.ok(game.score > 0, "the bundled maze plays");
  assert.deepEqual(wrapModule("template", await src("games/stack.js")).hoisted, ["import * as THREE from 'three';"]);
});

test("GAME_RULES names every genre, palette and range, with one example", () => {
  for (const g of GENRE_IDS) assert.ok(GAME_RULES.includes(g));
  for (const p of Object.keys(PALETTES)) assert.ok(GAME_RULES.includes(p));
  assert.ok(GAME_RULES.includes("Example."));
  const example = JSON.parse(GAME_RULES.slice(GAME_RULES.lastIndexOf("Reply: ") + 7));
  assert.deepEqual(sanitizeRecipe(example, templateRecipe("", "runner")).title, "Penguin Slide");
  assert.ok(GAME_RULES.length < 6000);
});

test("/api/game writes a sanitized recipe, caps use, and fails cleanly", async () => {
  const { default: worker } = await import("../src/index.js");
  const kv = new Map();
  const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) };
  let sent = null;
  const env = (response) => ({ MASSLESS_KV: KV, AI: { run: async (model, input) => ((sent = input), { response }) } });
  const post = (body, e) => worker.fetch(new Request("https://massless.test/api/game", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), e, { waitUntil() {} });
  const reply = `Here you go: ${JSON.stringify({ title: "Moon Hop", genre: "runner", palette: "moon", tuning: { speed: 99999 }, world: { scene: "moon" } })}`;
  const ok = await post({ prompt: "a robot hops on the moon", genre: "runner", dims: "2d" }, env(reply));
  assert.equal(ok.status, 200);
  const { recipe } = await ok.json();
  assert.equal(recipe.title, "Moon Hop");
  assert.equal(recipe.tuning.speed, TUNING.runner.speed[1], "clamped server-side");
  assert.equal(sent.messages[0].content, GAME_RULES);
  assert.deepEqual(JSON.parse(sent.messages[1].content), { prompt: "a robot hops on the moon", genre: "runner", dims: "2d" });
  assert.equal((await post({ prompt: "x" }, env("no json here"))).status, 502);
  assert.equal((await post({ prompt: "" }, env(reply))).status, 400);
  const capped = { ...env(reply), PER_VISITOR_GAME: "2" };
  await post({ prompt: "a" }, capped);
  assert.equal((await post({ prompt: "b" }, capped)).status, 429);
  assert.equal((await worker.fetch(new Request("https://massless.test/api/game"), env(reply), { waitUntil() {} })).status, 405);
});

test("/games is a friendly address that forwards to the games view in Build, keeping share links", async () => {
  const { default: worker } = await import("../src/index.js");
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname.split("/public/")[1];
    try { return new Response(await readFile(new URL(`../public/${path}`, import.meta.url))); } catch { return new Response("missing", { status: 404 }); }
  };
  try {
    for (const route of ["/games", "/games/"]) {
      const res = await worker.fetch(new Request(`https://massless.test${route}`), { ASSET_REF: "a".repeat(40) }, { waitUntil() {} });
      assert.equal(res.status, 200, route);
      const html = await res.text();
      assert.match(html, /location\.replace\('\/build\/\?template=game' \+ location\.hash\)/);
    }
    const build = await (await worker.fetch(new Request("https://massless.test/build"), { ASSET_REF: "a".repeat(40) }, { waitUntil() {} })).text();
    assert.ok(build.includes('id="games-view"') && build.includes('id="website-view"') && build.includes('"three": "https://cdn.jsdelivr.net/npm/three@0.180.0/'));
    assert.ok(build.includes(`/v/${"a".repeat(40)}/js/pages/games.js`));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.caches = originalCaches;
  }
});
