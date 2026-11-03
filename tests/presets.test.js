import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PRESETS, SCENES, MOCKUPS, PRESENTERS, presetById, catalogProblems } from "../public/js/presets/catalog.js";
import { validateSpec, denyHits, copyStrings, ENGINES, outputList, defaults } from "../public/js/presets/spec.js";
import { byPopularity } from "../public/js/presets/popular.js";
import { homographyInverse } from "../public/js/presets/engines/mockup.js";
import { _test as warp } from "../public/js/presets/engines/warp.js";
import { height as earthHeight } from "../public/js/presets/engines/earth.js";
import { GALLERY, CATEGORIES, PRESET_CARDS, CAMERA_MOVES, FEATURED } from "../public/js/workflow-data.js";

const pub = (p) => new URL("../public" + p, import.meta.url);
const exists = (p) => access(pub(p)).then(() => true, () => false);

test("every preset spec is valid, unique and uses a real engine", async () => {
  assert.deepEqual(catalogProblems(), []);
  for (const p of PRESETS) {
    assert.ok(ENGINES[p.engine], p.id);
    assert.ok(await exists(`/js/presets/engines/${p.engine}.js`), `${p.id}: engine file`);
    assert.ok(outputList(p).length >= 1, p.id);
    for (const i of p.inputs) if (i.type !== "image") assert.notEqual(defaults(p)[i.key], undefined, `${p.id}.${i.key} has a default`);
  }
});

test("the catalog ships the planned packs", () => {
  const by = (engine) => PRESETS.filter((p) => p.engine === engine);
  assert.equal(SCENES.length, 20);
  assert.equal(by("scene").length, 20);
  assert.equal(by("mockup").length, 5);
  assert.deepEqual(MOCKUPS.map((m) => m.id), ["billboard", "box-truck", "phone", "street-poster", "storefront"]);
  assert.equal(by("warp").length, 5);
  assert.equal(by("rain").length, 5);
  assert.ok(by("transition").length >= 6);
  assert.equal(by("social").length, 12);
  for (const id of ["product-spin", "earth-zoom-out", "talking-ad"]) assert.ok(presetById(id), id);
  // scene outputs are the three ad sizes; social has four sizes and an animated story
  for (const p of by("scene")) assert.deepEqual(p.outputs[0].sizes, ["1080x1350", "1080x1920", "1200x628"]);
  for (const p of by("social")) assert.deepEqual(outputList(p).map((o) => o.size + o.type), ["1080x1080image", "1080x1350image", "1080x1920image", "1280x720image", "1080x1920video"]);
  assert.deepEqual(presetById("earth-zoom-out").outputs[0].sizes, ["1080x1920", "1080x1080"]);
});

test("copy stays plain: no brands, people, model names or tech words", () => {
  for (const p of PRESETS) {
    assert.deepEqual(denyHits(p), [], p.id);
    for (const s of copyStrings(p)) assert.doesNotMatch(s, /\b(AI model|GPU|diffusion|prompt|LoRA|checkpoint|inference|neural)\b/i, `${p.id}: "${s}"`);
  }
  const bad = { ...PRESETS[0], title: "Nike podium" };
  assert.ok(validateSpec(bad).some((e) => e.includes("nike")));
  assert.ok(validateSpec({ ...PRESETS[0], engine: "nope" }).length);
  assert.ok(validateSpec({ ...PRESETS[0], preview: { video: "/x.mp4" } }).length);
  assert.ok(validateSpec({ ...PRESETS[0], safety: { ...PRESETS[0].safety, realPeopleInSamples: true } }).length);
  // the presenter is always labelled as not a real person
  const talk = presetById("talking-ad");
  assert.match(talk.safety.disclosure, /not a real person/i);
  assert.ok(validateSpec({ ...talk, safety: { ...talk.safety, disclosure: "" } }).some((e) => e.includes("disclose")));
});

test("every sample, plate and preview file exists and is small", async () => {
  const seen = new Set();
  for (const p of PRESETS) {
    for (const i of p.inputs.filter((x) => x.type === "image"))
      for (const s of i.samples) for (const f of [s.src, s.matte].filter(Boolean)) {
        if (seen.has(f)) continue;
        seen.add(f);
        assert.ok(await exists(f), `${p.id}: ${f}`);
      }
    const v = await stat(pub(p.preview.video)), poster = await stat(pub(p.preview.poster));
    assert.ok(v.size <= 300 * 1024, `${p.preview.video} is ${v.size} bytes`);
    assert.ok(poster.size <= 40 * 1024, `${p.preview.poster} is ${poster.size} bytes`);
  }
  for (const s of SCENES) for (const o of ["p", "l"]) {
    const f = `/presets/plates/${s.id}-${o}.webp`;
    assert.ok((await stat(pub(f))).size <= 200 * 1024, f);
  }
  for (const m of MOCKUPS) assert.ok((await stat(pub(`/presets/plates/${m.plate}.webp`))).size <= 200 * 1024, m.plate);
  for (let i = 1; i <= 5; i++) assert.ok((await stat(pub(`/presets/plates/earth-${i}.webp`))).size <= 200 * 1024);
  for (const pr of PRESENTERS) assert.ok(await exists(pr.src), pr.src);
});

test("generated plates and samples are recorded with their source and hash", async () => {
  const prov = JSON.parse(await readFile(pub("/presets/provenance.json"), "utf8"));
  const files = new Map(prov.files.map((f) => [f.path, f]));
  const want = [...SCENES.flatMap((s) => [`presets/plates/${s.id}-p.webp`, `presets/plates/${s.id}-l.webp`]), ...MOCKUPS.map((m) => `presets/plates/${m.plate}.webp`), ...[1, 2, 3, 4, 5].map((i) => `presets/plates/earth-${i}.webp`), ...PRESENTERS.map((p) => p.src.slice(1))];
  for (const path of want) {
    const f = files.get(path);
    assert.ok(f, `${path} is in provenance.json`);
    const buf = await readFile(pub("/" + path));
    assert.equal(f.sha256, createHash("sha256").update(buf).digest("hex"), path);
    assert.ok(f.prompt && !/\b(person|people|logo|brand name)\b/i.test(f.prompt.replace(/no people|fictional|not a real/gi, "")) || path.includes("presenter"), `${path}: plates show no people or brands`);
  }
});

test("mockup corners map exactly through the homography", () => {
  const q = [[100, 50], [700, 90], [680, 420], [120, 400]];
  const m = homographyInverse(q);
  const apply = ([x, y]) => { const u = m[0] * x + m[3] * y + m[6], v = m[1] * x + m[4] * y + m[7], w = m[2] * x + m[5] * y + m[8]; return [u / w, v / w]; };
  for (const [p, want] of [[q[0], [0, 0]], [q[1], [1, 0]], [q[2], [1, 1]], [q[3], [0, 1]]]) {
    const [u, v] = apply(p);
    assert.ok(Math.abs(u - want[0]) < 1e-6 && Math.abs(v - want[1]) < 1e-6, `${p} -> ${u},${v}`);
  }
});

test("object effects start and end at rest, so clips loop", () => {
  const D = 5, P = { bx: 500, by: 900, pw: 300, ph: 500 };
  for (const fx of ["squish", "inflate", "levitate", "poke", "melt"]) {
    for (const t of [0, D - 1e-6]) {
      const [x, y] = warp.deform(fx, 1, 0, t, D, P);
      assert.ok(Math.abs(x - 650) < 3 && Math.abs(y - 400) < 3, `${fx} at ${t}: ${x},${y}`);
    }
  }
  assert.ok(warp.squishAmount(1.8, 5) > 0.3, "the press really squashes");
  assert.ok(warp.meltAmount(3.6, 5) > 0.9, "the melt really melts");
  assert.equal(earthHeight(0, 7), 0);
  assert.ok(Math.abs(earthHeight(7, 7) - 5) < 1e-9);
});

test("presets lead the gallery and the 28 camera moves are one card", () => {
  assert.deepEqual(CATEGORIES.slice(0, 3).map((c) => c.name), ["Ads & products", "Effects", "Social"]);
  assert.ok(!CATEGORIES.some((c) => c.id === "moves"));
  assert.equal(GALLERY.filter((c) => c.href.startsWith("/video?move=")).length, 1);
  assert.equal(CAMERA_MOVES.length, 28);
  for (const cat of ["ads", "effects", "social"]) {
    const cards = GALLERY.filter((c) => c.cat === cat);
    assert.ok(cards[0].id.startsWith("preset-"), `${cat} opens with a new preset`);
  }
  assert.equal(PRESET_CARDS.length, PRESETS.length);
  assert.ok(PRESET_CARDS.every((c) => ["new", "trending"].includes(c.badge)));
  assert.ok(PRESET_CARDS.filter((c) => c.badge === "trending").length >= 5);
  assert.ok(FEATURED.filter((id) => id.startsWith("preset-")).length >= 8);
});

test("popular order follows local use and keeps ties in place", () => {
  const items = ["a", "b", "c", "d"].map((id) => ({ id }));
  assert.deepEqual(byPopularity(items, { c: 3, b: 3, d: 1 }).map((x) => x.id), ["b", "c", "d", "a"]);
  assert.deepEqual(byPopularity(items, {}).map((x) => x.id), ["a", "b", "c", "d"]);
});
