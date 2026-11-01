import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { GALLERY, CATEGORIES, FEATURED, DESIGN_WORKFLOWS } from "../public/js/workflow-data.js";
import { TEMPLATES_LIST } from "../public/js/website/templates-list.js";
import { createLoopPlayer, MAX_PLAYING } from "../public/js/workflow-gallery.js";

const pub = (p) => new URL("../public" + p, import.meta.url);
const text = (p) => readFile(pub(p), "utf8");
const exists = (p) => access(pub(p)).then(() => true, () => false);

// ---------- what the tools accept, read from the tools themselves ----------
async function known() {
  const effects = await text("/js/effects.js");
  const block = effects.slice(effects.indexOf("export const EFFECTS"), effects.indexOf("];", effects.indexOf("export const EFFECTS")));
  const fx = {};
  for (const m of block.matchAll(/id: '([\w-]+)', name: '[^']+', hint[^\n]*\n\s*(?:looks: \[([^\n]*)\])?/g))
    fx[m[1]] = [...(m[2] || "").matchAll(/id: '([\w-]+)'/g)].map((x) => x[1]);
  const moves = [...(await text("/js/moves.js")).matchAll(/^\s*id: '([\w-]+)',$/gm)].map((m) => m[1]);
  const samples = [...(await text("/js/ui.js")).matchAll(/\{ key: '([\w-]+)'/g)].map((m) => m[1]);
  const tools = JSON.parse((await text("/js/pages/edit.js")).match(/const TOOLS = (\[[^\]]*\])/)[1]);
  const games = [...(await text("/js/games/gallery.js")).matchAll(/^\s*id: '([\w-]+)', tags/gm)].map((m) => m[1]);
  const audioTabs = [...(await text("/js/pages/audio.js")).matchAll(/p\.get\('tab'\) === '(\w+)'/g)].map((m) => m[1]).concat("voice");
  const office = await text("/js/pages/office.js");
  const officeTabs = JSON.parse(office.match(/if \((\[[^\]]*\])\.includes\(tab\)\) showTab\(tab\)/)[1].replaceAll("'", '"'));
  const ops = [...office.matchAll(/\{ id: '(\w+)', name: '[^']+', note:/g)].map((m) => m[1]);
  const showcase = JSON.parse(await text("/data/showcase.json"));
  return { fx, moves, samples, tools, games, audioTabs, officeTabs, ops, showcase };
}

test("the gallery covers every category with unique, complete cards", () => {
  const ids = new Set();
  for (const c of GALLERY) {
    assert.ok(!ids.has(c.id), `duplicate ${c.id}`);
    ids.add(c.id);
    assert.ok(CATEGORIES.some((k) => k.id === c.cat), `${c.id}: category`);
    assert.ok(c.name && c.line && c.line.length <= 60, `${c.id}: name and a one-line description`);
    assert.match(c.ar, /^\d+\/\d+$/);
  }
  for (const k of CATEGORIES) assert.ok(GALLERY.filter((c) => c.cat === k.id).length >= 3, `${k.id} has cards`);
  assert.ok(FEATURED.length >= 8 && FEATURED.every((id) => ids.has(id)));
});

test("every card opens a real page with parameters that page understands", async () => {
  const k = await known();
  assert.ok(Object.keys(k.fx).length >= 4 && k.moves.length >= 20 && k.samples.length >= 10 && k.games.length >= 10);
  for (const c of GALLERY) {
    const u = new URL(c.href, "https://chucksi.test");
    const path = u.pathname.replace(/\/$/, "");
    assert.ok(await exists(path + "/index.html"), `${c.id}: ${path} is a page`);
    const q = Object.fromEntries(u.searchParams);
    const keys = Object.keys(q).sort().join(",");
    const where = `${c.id} → ${c.href}`;
    switch (path) {
      case "/video":
        assert.ok(k.samples.includes(q.sample), where);
        if (q.effect) {
          assert.ok(k.fx[q.effect], where);
          if (q.look) assert.ok(k.fx[q.effect].includes(q.look), where);
        } else assert.ok(k.moves.includes(q.move), where);
        break;
      case "/3d":
        assert.ok(k.samples.includes(q.sample), where);
        break;
      case "/edit":
        assert.ok(!q.tool || k.tools.includes(q.tool), where);
        break;
      case "/workflows": {
        assert.ok(DESIGN_WORKFLOWS.some((w) => w.id === q.make), where);
        assert.ok(k.showcase.some((x) => x.id === q.example && x.workflow === q.make), where);
        break;
      }
      case "/website":
        assert.ok(TEMPLATES_LIST.some((t) => t.id === q.template), where);
        break;
      case "/games":
        assert.ok(k.games.includes(u.hash.replace("#play=", "")), where);
        break;
      case "/audio":
        assert.ok(k.audioTabs.includes(q.tab), where);
        break;
      case "/office":
        if (q.tab) assert.ok(k.officeTabs.includes(q.tab), where);
        if (q.op) assert.ok(k.ops.includes(q.op), where);
        if (q.sample) assert.equal(q.sample, "1");
        break;
      default:
        assert.equal(keys, "", `${where}: no parameters on ${path}`);
    }
  }
  // all eleven website templates and all twelve gallery games have a card
  for (const t of TEMPLATES_LIST) assert.ok(GALLERY.some((c) => c.href === "/website?template=" + t.id), t.id);
  for (const g of k.games) assert.ok(GALLERY.some((c) => c.href === "/games#play=" + g), g);
});

// ---------- the loops ----------
function box(buf, type, from = 0, to = buf.length) {
  for (let i = from; i + 8 <= to; ) {
    const size = buf.readUInt32BE(i);
    if (buf.toString("latin1", i + 4, i + 8) === type) return [i + 8, i + size];
    if (size < 8) break;
    i += size;
  }
  return null;
}
function mp4Info(buf) {
  const moov = box(buf, "moov");
  const mvhd = box(buf, "mvhd", ...moov);
  const v = buf[mvhd[0]];
  const timescale = buf.readUInt32BE(mvhd[0] + (v ? 20 : 12));
  const duration = v ? Number(buf.readBigUInt64BE(mvhd[0] + 24)) : buf.readUInt32BE(mvhd[0] + 16);
  const trak = box(buf, "trak", ...moov);
  const tkhd = box(buf, "tkhd", ...trak);
  const width = buf.readUInt32BE(tkhd[1] - 8) / 65536;
  const height = buf.readUInt32BE(tkhd[1] - 4) / 65536;
  return { seconds: duration / timescale, width, height, faststart: buf.indexOf("moov") < buf.indexOf("mdat"), avc: buf.includes("avc1"), audio: buf.includes("soun") };
}

test("every card has a short, light, silent H.264 loop and a small poster", async () => {
  let total = 0;
  for (const c of GALLERY) {
    const buf = await readFile(pub(c.video));
    total += buf.length;
    assert.ok(buf.length <= 400 * 1024, `${c.video} is ${buf.length} bytes`);
    const info = mp4Info(buf);
    assert.ok(info.avc && info.faststart && !info.audio, `${c.video}: H.264, faststart, no audio`);
    assert.ok(info.seconds >= 3 && info.seconds <= 6.5, `${c.video} lasts ${info.seconds}s`);
    assert.ok(Math.max(info.width, info.height) <= 854, `${c.video} is ${info.width}x${info.height}`);
    const [w, h] = c.ar.split("/").map(Number);
    assert.ok(Math.abs(info.width / info.height - w / h) < 0.02, `${c.video}: ${info.width}x${info.height} should be ${c.ar}`);
    const poster = await stat(pub(c.poster));
    assert.ok(poster.size > 1000 && poster.size <= 40 * 1024, `${c.poster} is ${poster.size} bytes`);
    const head = (await readFile(pub(c.poster))).subarray(0, 12).toString("latin1");
    assert.ok(head.startsWith("RIFF") && head.endsWith("WEBP"), `${c.poster} is WebP`);
  }
  assert.ok(total < 16 * 1024 * 1024, `all loops together are ${total} bytes`);
});

test("provenance records every loop and poster with its hash", async () => {
  const prov = JSON.parse(await text("/media/templates/provenance.json"));
  const files = new Map(prov.files.map((f) => [f.path, f]));
  for (const c of GALLERY)
    for (const p of [c.video, c.poster]) {
      const f = files.get(p.slice(1));
      assert.ok(f, `${p} is in provenance.json`);
      const buf = await readFile(pub(p));
      assert.equal(f.bytes, buf.length, p);
      assert.equal(f.sha256, createHash("sha256").update(buf).digest("hex"), p);
      assert.ok(prov.sources[f.source], `${p}: source ${f.source} is described`);
    }
});

// ---------- playback policy, with the browser APIs faked ----------
function fakeBrowser({ reduce = false, saveData = false } = {}) {
  const observers = [];
  const listeners = {};
  const frames = [];
  globalThis.matchMedia = () => ({ matches: reduce, addEventListener() {} });
  globalThis.IntersectionObserver = class {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = []; observers.push(this); }
    observe(t) { this.targets.push(t); }
    unobserve() {}
  };
  globalThis.requestAnimationFrame = (f) => frames.push(f);
  Object.defineProperty(globalThis, "navigator", { value: { connection: { saveData } }, configurable: true });
  globalThis.document = { hidden: false, addEventListener: (t, f) => (listeners[t] = f) };
  const video = (n) => {
    const attrs = {};
    return {
      n, dataset: { src: `/v${n}.mp4`, poster: `/p${n}.webp` }, paused: true, poster: "", plays: 0,
      classList: { add() {} }, addEventListener() {},
      getAttribute: (k) => attrs[k] ?? null,
      set src(v) { attrs.src = v; }, get src() { return attrs.src; },
      play() { this.paused = false; this.plays++; return Promise.resolve(); },
      pause() { this.paused = true; },
    };
  };
  const show = (videos, rect = 100) => {
    const [visibility, posters] = observers;
    visibility.cb(videos.map((v, i) => ({ target: v, isIntersecting: true, intersectionRatio: 1 - i / 100, boundingClientRect: { width: rect, height: rect } })));
    posters.cb(videos.map((v) => ({ target: v, isIntersecting: true })));
    while (frames.length) frames.shift()();
  };
  return { video, show, observers };
}

test("never more than six loops play, and only once they are on screen", () => {
  const { video, show } = fakeBrowser();
  const player = createLoopPlayer();
  const vids = Array.from({ length: 14 }, (_, i) => video(i));
  vids.forEach((v) => player.add(v));
  assert.equal(vids.filter((v) => v.src).length, 0, "nothing loads before it is near the screen");
  show(vids.slice(0, 10));
  assert.equal(MAX_PLAYING, 6);
  assert.equal(player.playing, 6);
  assert.deepEqual(vids.filter((v) => !v.paused).map((v) => v.n), [0, 1, 2, 3, 4, 5], "the most visible ones play");
  assert.equal(vids.filter((v) => v.src).length, 6, "videos load lazily");
  assert.ok(vids.slice(10).every((v) => v.paused && !v.src && !v.poster));
});

test("reduced motion and Save-Data show posters and never start a video", () => {
  for (const opts of [{ reduce: true }, { saveData: true }]) {
    const { video, show } = fakeBrowser(opts);
    const player = createLoopPlayer();
    const vids = Array.from({ length: 8 }, (_, i) => video(i));
    vids.forEach((v) => player.add(v));
    show(vids);
    assert.equal(player.playing, 0);
    assert.ok(vids.every((v) => !v.src && v.plays === 0), "no video bytes are fetched");
    assert.ok(vids.every((v) => v.poster === v.dataset.poster), "posters still show");
    assert.ok(player.stillMode);
  }
});

test("the page keeps its motion to transforms and opacity and honours reduced motion", async () => {
  const css = await text("/css/workflows.css");
  for (const m of css.matchAll(/transition:([^;]+);/g))
    for (const part of m[1].split(/,(?![^(]*\))/))
      assert.match(part.trim(), /^(opacity|transform|background-color|color|border-color|box-shadow)\b/, `transition on ${part.trim()}`);
  assert.match(css, /@keyframes wf-slide \{ to \{ transform:/);
  const site = await text("/css/site.css");
  assert.match(site, /prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation: none !important; transition: none !important;/);
  const js = await text("/js/workflow-gallery.js");
  assert.match(js, /prefers-reduced-motion: reduce/);
  const html = await text("/workflows/index.html");
  assert.match(html, /<title>Workflows/);
  assert.match(html, /<h1 id="wf-title">Workflows<\/h1>/);
});
