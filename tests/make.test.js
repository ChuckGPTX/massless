import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { DESIGN_WORKFLOWS, WEBSITE_WORKFLOWS, WORKFLOWS } from "../public/js/workflow-data.js";
import { workersBody } from "../public/js/engines.js";
import * as kit from "../public/js/make/kit.js";
import { timeline, poemLines, framePrompt, MAX_LINES } from "../public/js/make/filmpoem.js";
import { splitPoem, breakAt } from "../public/js/make/poetry.js";
import { parseLabels, legendOf, placeLabels, mapPrompt } from "../public/js/make/map.js";
import { palette, contrastReport, VIBES, MARKS, markSVG } from "../public/js/make/identity.js";
import { festivalPrompt, splitTwo, PALETTES as FEST } from "../public/js/make/festival.js";
import map from "../public/js/make/map.js";
import identity from "../public/js/make/identity.js";
import filmpoem from "../public/js/make/filmpoem.js";
import poetry from "../public/js/make/poetry.js";
import festival from "../public/js/make/festival.js";

const MODULES = { map, identity, "film-poem": filmpoem, poetry, festival };
const pub = (p) => new URL("../public" + p, import.meta.url);

test("design workflows are one-click links with small real thumbnails", async () => {
  assert.deepEqual(DESIGN_WORKFLOWS.map((w) => w.id), Object.keys(MODULES));
  for (const w of DESIGN_WORKFLOWS) {
    assert.equal(w.href, "/workflows?make=" + w.id);
    assert.ok(w.name && w.description && w.output && w.tag);
    const size = (await stat(pub(w.image))).size;
    assert.ok(size > 2000 && size < 80 * 1024, `${w.image} is ${size} bytes`);
    assert.equal(MODULES[w.id].frames(MODULES[w.id].presets[0].state), w.frames, `${w.id} frame count`);
  }
  // the step-by-step plans are untouched
  assert.ok(WORKFLOWS.every((w) => !DESIGN_WORKFLOWS.some((d) => d.id === w.id)));
});

test("website template cards point at the four builder templates", async () => {
  assert.deepEqual(
    WEBSITE_WORKFLOWS.map((w) => [w.name, w.href]),
    [
      ["Editorial shop", "/website?template=editorial-shop"],
      ["Manifesto", "/website?template=manifesto"],
      ["Portfolio timeline", "/website?template=portfolio-timeline"],
      ["AI product launch", "/website?template=ai-product"],
    ],
  );
  for (const w of WEBSITE_WORKFLOWS) assert.ok((await stat(pub(w.image))).size < 80 * 1024);
});

test("each workflow has fields, a default with bundled samples, and a surprise", async () => {
  for (const [id, m] of Object.entries(MODULES)) {
    assert.equal(m.id, id);
    const state = m.presets[0].state;
    for (const f of m.fields) assert.ok(f.key in state, `${id}: default for ${f.key}`);
    for (const url of Object.values(m.presets[0].samples)) assert.ok((await stat(pub(url))).size > 1000, url);
    let seed = 1;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 20; i++) {
      const s = { ...state, ...m.surprise(r, state) };
      for (const f of m.fields.filter((x) => x.type === "select")) assert.ok(f.options.some(([v]) => v === s[f.key]), `${id}: ${f.key}=${s[f.key]}`);
    }
  }
});

test("Made with Chucksi examples are curated recipes with real images", async () => {
  const list = JSON.parse(await readFile(pub("/data/showcase.json")));
  assert.ok(list.length >= 10);
  const ids = new Set();
  for (const x of list) {
    assert.ok(MODULES[x.workflow], x.workflow);
    assert.ok(!ids.has(x.id));
    ids.add(x.id);
    const fields = new Set([...MODULES[x.workflow].fields.map((f) => f.key), "pos", "seed"]);
    for (const k of Object.keys(x.state)) assert.ok(fields.has(k), `${x.id}: unknown field ${k}`);
    assert.ok((await stat(pub(x.image))).size < 80 * 1024, x.image);
    for (const url of Object.values(x.samples)) await stat(pub(url));
  }
  for (const w of DESIGN_WORKFLOWS) assert.ok(list.some((x) => x.workflow === w.id), `examples for ${w.id}`);
});

test("FLUX frames use the exact /api/shot body the Image studio sends", () => {
  for (const [w, h] of [[768, 1024], [1280, 720], [720, 1280]]) {
    const o = { prompt: "an aerial map", w, h, seed: 42 };
    assert.deepEqual(kit.fluxRequest(o), workersBody({ ...o, model: "flux-1-schnell" }));
    assert.equal(kit.fluxRequest(o).model, "flux-1-schnell");
  }
  // prompts keep words out of the image: all type is drawn by us
  for (const p of [mapPrompt(map.presets[0].state), framePrompt("A line", "a world", "paper"), festivalPrompt("jazz", 2, "silhouette")]) assert.match(p, /no text/);
});

test("OKLCH colour maths and contrast", () => {
  assert.equal(kit.oklch(0.628, 0.2577, 29.23), "#ff0000");
  assert.equal(kit.oklch(1, 0, 0), "#ffffff");
  assert.equal(kit.contrast("#000000", "#ffffff"), 21);
  const [L, C, h] = kit.rgbToOklch(kit.hexToRgb("#3366cc"));
  assert.equal(kit.oklch(L, C, h), "#3366cc");
  // out-of-gamut chroma is reduced, never clipped per channel
  assert.match(kit.oklch(0.7, 0.5, 150), /^#[0-9a-f]{6}$/);
});

test("identity palettes pass contrast for every vibe and variation", () => {
  for (const vibe of Object.keys(VIBES))
    for (let seed = 1; seed <= 60; seed++) {
      const p = palette(vibe, seed);
      for (const [pair, ratio] of contrastReport(p)) assert.ok(ratio >= (pair === "ink on paper" || pair === "paper on ink" ? 7 : 3), `${vibe}/${seed} ${pair} ${ratio.toFixed(2)}`);
    }
  for (const [id, m] of Object.entries(MARKS)) {
    assert.match(m.d(), /^M[-\d.\s]/, id);
    assert.match(markSVG(id, "#112233", "A", "#ffffff", "Archivo"), /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  }
});

test("film poem cuts land between 20 and 40 seconds", () => {
  for (let n = 1; n <= MAX_LINES; n++) {
    const { segments, duration } = timeline(n);
    assert.ok(duration >= 20 && duration <= 40, `${n} lines: ${duration}`);
    assert.equal(segments.filter((s) => s.kind === "shot").length, n);
    segments.reduce((t, s) => (assert.equal(s.start, t), t + s.d), 0);
  }
  assert.equal(poemLines("a\n\n b \n" + "x\n".repeat(20)).length, MAX_LINES);
  assert.equal(filmpoem.frames({ poem: "1\n2\n3\n4\n5\n6\n7" }), 6);
});

test("poetry series splits stanzas in order and re-breaks lines", () => {
  const poem = poetry.presets[0].state.poem;
  for (const n of [3, 4, 5]) {
    const chunks = splitPoem(poem, n);
    assert.equal(chunks.length, n);
    assert.ok(chunks.every((c) => c.length));
    assert.deepEqual(chunks.flat(), poem.split("\n").filter((l) => l.trim()));
  }
  assert.equal(splitPoem("one line", 3).length, 3);
  assert.deepEqual(breakAt("we wrote the day on the back".split(" "), 10), ["we wrote", "the day on", "the back"]);
});

test("map labels, legend and placement", () => {
  const labels = parseLabels("Old Light · Viewpoint\nHarbour\nCove | Swim\n\n");
  assert.deepEqual(labels, [{ name: "Old Light", cat: "Viewpoint" }, { name: "Harbour", cat: "" }, { name: "Cove", cat: "Swim" }]);
  assert.deepEqual(legendOf(labels).map((l) => l.cat), ["Viewpoint", "Swim"]);
  const pos = placeLabels(6, 7);
  assert.equal(pos.length, 6);
  assert.deepEqual(placeLabels(6, 7), pos);
  assert.deepEqual(placeLabels(7, 7, pos).slice(0, 6), pos);
  assert.ok(pos.every(([x, y]) => x > 0 && x < 1 && y > 0 && y < 1));
});

test("festival kit parts", () => {
  assert.deepEqual(splitTwo("Harbourlight Jazz Weekend"), ["Harbourlight", "Jazz Weekend"]);
  for (const p of Object.values(FEST)) assert.ok(kit.contrast(p.ink, p.ground) >= 4.5, p.name);
  assert.equal(festival.frames({ count: 9 }), 5);
});

test("print PDF and ZIP writers produce valid structures", () => {
  assert.equal(kit.crc32(new TextEncoder().encode("hello")), 0x3610a686);
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
  const pdf = kit.pdfFromJpegs([{ bytes: jpeg, width: 1200, height: 1800 }, { bytes: jpeg, width: 600, height: 600 }]);
  const txt = new TextDecoder("latin1").decode(pdf);
  assert.ok(txt.startsWith("%PDF-1.4"));
  assert.match(txt, /\/MediaBox \[0 0 288.00 432.00\]/);
  assert.match(txt, /\/Count 2/);
  const xref = Number(txt.match(/startxref\n(\d+)/)[1]);
  assert.ok(txt.slice(xref).startsWith("xref"));
  for (const m of txt.matchAll(/^(\d{10}) 00000 n $/gm)) assert.match(txt.slice(Number(m[1])), /^\d+ 0 obj/);
  const zip = kit.zipStore([{ name: "a.txt", bytes: new TextEncoder().encode("hello") }, { name: "b/ü.json", bytes: new Uint8Array(3) }]);
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(14, true), 0x3610a686);
  const end = zip.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  assert.equal(dv.getUint16(end + 10, true), 2);
  assert.equal(dv.getUint32(dv.getUint32(end + 16, true), true), 0x02014b50);
});

test("every typeface the workflows draw with is self-hosted with its OFL licence", async () => {
  for (const [family, file] of kit.FACES) {
    assert.ok((await stat(pub(kit.fontURL(file)))).size > 5000, file);
    const lic = kit.FONT_LICENSES[family];
    assert.ok(lic, family);
    assert.match(await readFile(pub("/fonts/" + lic), "utf8"), /SIL Open Font License/);
  }
});

test("workflow pages surface the design kits without touching the top navigation", async () => {
  const wf = await readFile(pub("/workflows/index.html"), "utf8");
  for (const id of ["maker", "make-cards", "site-cards", "workflow-cards"]) assert.ok(wf.includes(`id="${id}"`), id);
  const image = await readFile(pub("/studios/image/index.html"), "utf8");
  for (const id of ["map", "identity", "poetry", "festival"]) assert.ok(image.includes(`/workflows?make=${id}`), id);
  assert.ok((await readFile(pub("/studios/video/index.html"), "utf8")).includes("/workflows?make=film-poem"));
  assert.ok((await readFile(pub("/film/index.html"), "utf8")).includes("/workflows?make=film-poem"));
  assert.ok((await readFile(pub("/image/index.html"), "utf8")).includes("/workflows?make=map"));
  const nav = await readFile(pub("/js/navigation-data.js"), "utf8");
  assert.ok(!nav.includes("make="));
});
