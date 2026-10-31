import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  planTiles,
  upscaleTiled,
  rgbaToCHW,
  downsample2x,
  resizeChannel,
  compositeOver,
  featherAlpha,
  holeFromStrokes,
  maskBox,
  contextRect,
  miganInputs,
  applyFill,
  pasteHole,
  cropRGBA,
  cropChannel,
  toMatte,
  upscaleCheck,
  modnetSize,
  fitWithin,
  ESRGAN_REACH,
  UPSCALE_MAX,
} from "../public/js/image-tools.js";
import { RUNTIME, MODELS, modelFile } from "../public/js/image-models.js";
import { STUDIOS } from "../public/js/navigation-data.js";

function randomRGBA(w, h, seed = 7, alpha = 255) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) >>> 16) & 255;
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < a.length; i++) a[i] = i % 4 === 3 ? alpha : rnd();
  return a;
}

// A stand-in for a convolutional upscaler: `layers` 3x3 box filters with zero padding at the edge of
// whatever it is given (as a real conv net does), then nearest-neighbour x scale. Its reach is `layers`.
function fakeModel(layers, scale) {
  return async (chw, w, h) => {
    const n = w * h;
    let cur = Float32Array.from(chw);
    for (let l = 0; l < layers; l++) {
      const next = new Float32Array(3 * n);
      for (let c = 0; c < 3; c++)
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            let s = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const xx = x + dx,
                  yy = y + dy;
                if (xx >= 0 && xx < w && yy >= 0 && yy < h) s += cur[c * n + yy * w + xx];
              }
            next[c * n + y * w + x] = s / 9;
          }
      cur = next;
    }
    const W = w * scale,
      N = W * h * scale;
    const out = new Float32Array(3 * N);
    for (let c = 0; c < 3; c++)
      for (let y = 0; y < h * scale; y++)
        for (let x = 0; x < W; x++)
          out[c * N + y * W + x] = cur[c * n + Math.floor(y / scale) * w + Math.floor(x / scale)];
    return out;
  };
}

test("tiles cover every pixel exactly once, stay within the core size and carry the requested context", () => {
  for (const [w, h, core, pad] of [
    [1, 1, 64, 34],
    [97, 61, 32, 5],
    [300, 200, 160, 34],
    [768, 512, 160, 34],
    [1024, 33, 320, 34],
  ]) {
    const seen = new Uint8Array(w * h);
    const tiles = planTiles(w, h, core, pad);
    for (const t of tiles) {
      assert.ok(t.w > 0 && t.h > 0 && t.w <= core && t.h <= core);
      assert.ok(t.sx >= 0 && t.sy >= 0 && t.sx + t.sw <= w && t.sy + t.sh <= h);
      assert.equal(t.x - t.sx, Math.min(pad, t.x));
      assert.equal(t.y - t.sy, Math.min(pad, t.y));
      assert.equal(t.sx + t.sw - (t.x + t.w), Math.min(pad, w - t.x - t.w));
      assert.equal(t.sy + t.sh - (t.y + t.h), Math.min(pad, h - t.y - t.h));
      for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) seen[y * w + x]++;
    }
    assert.ok(seen.every((v) => v === 1), `${w}x${h}`);
  }
  assert.throws(() => planTiles(10, 10, 0, 2));
});

test("tiled upscaling is seam-free: identical to one full-image pass when the context covers the model's reach", async () => {
  const w = 53,
    h = 41,
    reach = 4,
    scale = 2;
  const rgba = randomRGBA(w, h, 11);
  const model = fakeModel(reach, scale);
  const full = await upscaleTiled(rgba, w, h, scale, model, { core: 1000, pad: 0 });
  assert.equal(planTiles(w, h, 16, reach).length, 12);
  let calls = 0;
  const tiled = await upscaleTiled(rgba, w, h, scale, model, {
    core: 16,
    pad: reach,
    onTile: (i, n) => {
      calls++;
      assert.equal(n, 12);
    },
  });
  assert.equal(calls, 12);
  assert.equal(tiled.w, w * scale);
  assert.equal(tiled.h, h * scale);
  assert.deepEqual(tiled.data, full.data);
  // too little context does show seams, so the check above is meaningful
  const short = await upscaleTiled(rgba, w, h, scale, model, { core: 16, pad: reach - 2 });
  assert.notDeepEqual(short.data, full.data);
  // and the real model's reach is what the page uses
  assert.equal(ESRGAN_REACH, 34);
});

test("upscaling keeps alpha: opaque stays opaque, a cutout's alpha is scaled smoothly", async () => {
  const w = 8,
    h = 6;
  const opaque = await upscaleTiled(randomRGBA(w, h), w, h, 4, fakeModel(1, 4), { core: 4, pad: 1 });
  for (let i = 3; i < opaque.data.length; i += 4) assert.equal(opaque.data[i], 255);
  const cut = randomRGBA(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cut[(y * w + x) * 4 + 3] = x < 4 ? 0 : 255;
  const up = await upscaleTiled(cut, w, h, 4, fakeModel(1, 4), { core: 4, pad: 1 });
  const W = up.w;
  assert.equal(up.data[(5 * W + 0) * 4 + 3], 0);
  assert.equal(up.data[(5 * W + W - 1) * 4 + 3], 255);
  const mid = up.data[(5 * W + 16) * 4 + 3];
  assert.ok(mid > 0 && mid < 255, "edge is interpolated");
});

test("planar tensors, 2x box downsampling and bilinear resizing", () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 51, 102, 153, 255]);
  const chw = rgbaToCHW(rgba, 2);
  assert.deepEqual(Array.from(chw.slice(0, 4)), [1, 0, 0, Math.fround(0.2)]);
  assert.deepEqual(Array.from(chw.slice(4, 8)), [0, 1, 0, Math.fround(0.4)]);
  const norm = rgbaToCHW(rgba, 2, { sx: 1, sy: 1, sw: 1, sh: 1 }, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
  assert.ok(Math.abs(norm[0] - (0.2 - 0.5) / 0.5) < 1e-6);
  const d = downsample2x(rgba, 2, 2);
  assert.equal(d.w, 1);
  assert.deepEqual(Array.from(d.data), [77, 89, 102, 255]);
  const ch = Uint8Array.from([0, 50, 100, 150, 200, 250]);
  assert.deepEqual(resizeChannel(ch, 3, 2, 3, 2), ch);
  const flat = resizeChannel(new Uint8Array(12).fill(90), 4, 3, 13, 7);
  assert.ok(flat.every((v) => v === 90));
  const ramp = resizeChannel(Uint8Array.from([0, 255]), 2, 1, 8, 1);
  for (let i = 1; i < ramp.length; i++) assert.ok(ramp[i] >= ramp[i - 1]);
});

test("alpha compositing: transparent cutout, over a backdrop, and the subject's own alpha", () => {
  const fg = new Uint8ClampedArray([200, 100, 50, 255, 200, 100, 50, 255, 200, 100, 50, 255, 10, 20, 30, 0]);
  const matte = Uint8Array.from([255, 0, 128, 255]);
  const cut = compositeOver(fg, matte, null);
  assert.deepEqual(Array.from(cut.slice(0, 4)), [200, 100, 50, 255]);
  assert.equal(cut[7], 0);
  assert.equal(cut[11], 128);
  assert.equal(cut[15], 0, "pixels already transparent stay transparent");
  const bg = new Uint8ClampedArray(16);
  for (let i = 0; i < 4; i++) bg.set([0, 0, 255, 255], i * 4);
  const over = compositeOver(fg, matte, bg);
  assert.deepEqual(Array.from(over.slice(0, 4)), [200, 100, 50, 255]);
  assert.deepEqual(Array.from(over.slice(4, 8)), [0, 0, 255, 255]);
  assert.deepEqual(Array.from(over.slice(8, 12)), [100, 50, 152, 255]);
  assert.deepEqual(Array.from(over.slice(12, 16)), [0, 0, 255, 255]);
  // over a transparent backdrop the result is the cutout itself
  const clear = compositeOver(fg, matte, new Uint8ClampedArray(16));
  assert.deepEqual(Array.from(clear.slice(8, 12)), [200, 100, 50, 128]);
});

test("model outputs become 8-bit mattes, and feathering softens only the edge", () => {
  assert.deepEqual(Array.from(toMatte(Float32Array.from([-20, 0, 20]), true)), [0, 128, 255]);
  assert.deepEqual(Array.from(toMatte(Float32Array.from([-0.2, 0.5, 1.4]), false)), [0, 128, 255]);
  const w = 40,
    h = 10,
    a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 20; x < w; x++) a[y * w + x] = 255;
  assert.deepEqual(featherAlpha(a, w, h, 0), a);
  const f = featherAlpha(a, w, h, 6);
  const row = Array.from(f.slice(5 * w, 6 * w));
  assert.equal(row[0], 0);
  assert.equal(row[w - 1], 255);
  for (let x = 1; x < w; x++) assert.ok(row[x] >= row[x - 1], "monotonic edge");
  assert.ok(row[20] > 0 && row[20] < 255 && row[19] > 0, "edge softened on both sides");
});

test("brush strokes become a grown 0/1 hole with a bounding box and clipped context", () => {
  const w = 30,
    h = 20,
    strokes = new Uint8ClampedArray(w * h * 4);
  assert.equal(holeFromStrokes(strokes, w, h, 3), null);
  strokes[(10 * w + 15) * 4 + 3] = 255;
  strokes[(10 * w + 16) * 4 + 3] = 10; // anti-aliasing fringe below the threshold
  const hole = holeFromStrokes(strokes, w, h, 0);
  assert.equal(hole.reduce((a, b) => a + b, 0), 1);
  const grown = holeFromStrokes(strokes, w, h, 2);
  assert.equal(grown.reduce((a, b) => a + b, 0), 25);
  assert.deepEqual(maskBox(grown, w, h), { x0: 13, y0: 8, x1: 17, y1: 12 });
  assert.equal(maskBox(new Uint8Array(4), 2, 2), null);
  const r = contextRect({ x0: 13, y0: 8, x1: 17, y1: 12 }, w, h, 1, 4);
  assert.deepEqual(r, { x: 8, y: 3, w: 15, h: 15 });
  const edge = contextRect({ x0: 0, y0: 0, x1: 2, y1: 2 }, w, h, 1, 100);
  assert.deepEqual(edge, { x: 0, y: 0, w: 30, h: 20 });
});

test("MI-GAN inputs mark kept pixels 255 and the fill only touches the hole", () => {
  const w = 3,
    h = 2;
  const rgba = randomRGBA(w, h, 3, 200);
  const hole = Uint8Array.from([0, 1, 0, 0, 0, 1]);
  const { image, mask } = miganInputs(rgba, hole, w, h);
  assert.deepEqual(Array.from(mask), [255, 0, 255, 255, 255, 0]);
  assert.equal(image[0], rgba[0]);
  assert.equal(image[6 + 4], rgba[4 * 4 + 1]);
  assert.equal(image[12 + 5], rgba[5 * 4 + 2]);
  const planar = new Uint8Array(18).fill(7);
  const out = applyFill(rgba, planar, hole, w, h);
  for (let i = 0; i < 6; i++) {
    for (let c = 0; c < 3; c++) assert.equal(out[i * 4 + c], hole[i] ? 7 : rgba[i * 4 + c]);
    assert.equal(out[i * 4 + 3], 200, "alpha kept");
  }
  // crop -> fill -> paste back lands in the right place
  const big = randomRGBA(6, 5, 9);
  const holeBig = new Uint8Array(30);
  holeBig[2 * 6 + 3] = 1;
  const rect = { x: 2, y: 1, w: 3, h: 3 };
  const crop = cropRGBA(big, 6, rect);
  const hc = cropChannel(holeBig, 6, rect);
  assert.equal(hc[1 * 3 + 1], 1);
  crop.fill(9);
  const pasted = pasteHole(big, 6, crop, rect, hc);
  for (let i = 0; i < 30; i++) for (let c = 0; c < 4; c++) assert.equal(pasted[i * 4 + c], i === 15 && c < 3 ? 9 : big[i * 4 + c]);
});

test("size limits: upscale caps with a clear message, MODNet sizes, working copies", () => {
  assert.deepEqual(upscaleCheck(640, 480, 4), { ok: true, out: { w: 2560, h: 1920 } });
  const big = upscaleCheck(2000, 1000, 2);
  assert.equal(big.ok, false);
  assert.match(big.message, /1024 px/);
  assert.match(big.message, /2000 × 1000/);
  assert.equal(upscaleCheck(800, 600, 4).ok, false);
  assert.equal(upscaleCheck(800, 600, 3).ok, false);
  assert.ok(UPSCALE_MAX[2] * 2 <= 2048 && UPSCALE_MAX[4] * 4 <= 3072);
  for (const [w, h] of [[1280, 720], [300, 1000], [512, 512], [4000, 3000]]) {
    const s = modnetSize(w, h);
    assert.equal(s.w % 32, 0);
    assert.equal(s.h % 32, 0);
    assert.ok(Math.abs(Math.min(s.w, s.h) - 512) <= 16);
  }
  assert.deepEqual(fitWithin(8000, 4000, 4096), { w: 4096, h: 2048, scaled: true });
  assert.deepEqual(fitWithin(800, 400, 4096), { w: 800, h: 400, scaled: false });
});

test("every downloaded file is permissive, pinned and has a SHA-256; the served upscaler matches its hash", async () => {
  const files = [RUNTIME.lib, RUNTIME.wasm];
  for (const [id, m] of Object.entries(MODELS)) {
    assert.ok(["MIT", "Apache-2.0", "BSD-3-Clause"].includes(m.license), id);
    assert.doesNotMatch(m.source, /RMBG|briaai/i);
    files.push(modelFile(id, "wasm"), modelFile(id, "webgpu"));
  }
  for (const f of files) {
    assert.match(f.sha256, /^[0-9a-f]{64}$/);
    assert.ok(f.size > 0);
    if (f.url.startsWith("https://huggingface.co/")) assert.match(f.url, /\/resolve\/[0-9a-f]{40}\//);
    else if (f.url.startsWith("https://cdn.jsdelivr.net/")) assert.match(f.url, /@\d+\.\d+\.\d+\//);
    else assert.match(f.url, /^\/models\/[\w.-]+\.onnx$/);
  }
  const local = MODELS.esrgan.files.wasm;
  const bytes = await readFile(new URL(`../public${local.url}`, import.meta.url));
  assert.equal(bytes.length, local.size);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), local.sha256);
});

test("the Image menu deep-links to each tool", () => {
  const image = STUDIOS.find((s) => s.id === "image");
  const hrefs = image.features.map((f) => f.href);
  for (const t of ["remove-bg", "upscale", "erase"]) assert.ok(hrefs.includes(`/edit/?tool=${t}`), t);
});
