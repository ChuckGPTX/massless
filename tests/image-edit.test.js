import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { imageInfo, EDIT_MODEL, EDIT_FALLBACK } from "../src/image-edit.js";
import { editSize, editRefusal, fitInside, INPUT_MAX } from "../public/js/edit-words.js";

// Minimal valid headers: enough for imageInfo to read type and size.
function png(w, h) {
  const b = new Uint8Array(200);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return b;
}
function jpeg(w, h) {
  const b = new Uint8Array(200);
  // SOI, APP0 (length 16), SOF0
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3], 20);
  return b;
}
function webp(w, h) {
  const b = new Uint8Array(200);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  b.set([(w - 1) & 255, ((w - 1) >> 8) & 255, 0, (h - 1) & 255, ((h - 1) >> 8) & 255, 0], 24);
  return b;
}
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

function kv() {
  const m = new Map();
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v) };
}
function fakeAI(answer = () => ({ image: b64(jpeg(1024, 1024)) })) {
  const calls = [];
  return {
    calls,
    async run(model, input, opts) {
      const form = await new Response(input.multipart.body, { headers: { "content-type": input.multipart.contentType } }).formData();
      calls.push({ model, form, opts });
      return answer(model, form);
    },
  };
}
function editRequest({ prompt = "make it sunset", images = [png(511, 340)], size = "match", headers = {} } = {}) {
  const f = new FormData();
  if (prompt !== null) f.append("prompt", prompt);
  images.forEach((b, i) => f.append(`input_image_${i}`, new Blob([b], { type: "image/png" }), `p${i}.png`));
  if (size !== null) f.append("size", size);
  return new Request("https://massless.test/api/edit", { method: "POST", body: f, headers: { "cf-connecting-ip": "1.2.3.4", ...headers } });
}
const ctx = { waitUntil() {} };

test("imageInfo reads JPEG, PNG and WebP sizes and rejects other bytes", () => {
  assert.deepEqual(imageInfo(png(511, 300)), { type: "image/png", w: 511, h: 300 });
  assert.deepEqual(imageInfo(jpeg(400, 511)), { type: "image/jpeg", w: 400, h: 511 });
  assert.deepEqual(imageInfo(webp(320, 200)), { type: "image/webp", w: 320, h: 200 });
  assert.equal(imageInfo(new TextEncoder().encode("GIF89a........................")), null);
});

test("output sizes: fixed shapes, and match keeps the first picture's aspect with a 1024 long side", () => {
  assert.deepEqual(editSize("square"), { w: 1024, h: 1024 });
  assert.deepEqual(editSize("portrait"), { w: 816, h: 1024 });
  assert.deepEqual(editSize("landscape"), { w: 1024, h: 576 });
  assert.deepEqual(editSize("match", 511, 340), { w: 1024, h: 688 });
  assert.deepEqual(editSize("match", 300, 511), { w: 608, h: 1024 });
  assert.deepEqual(editSize("match", 511, 20), { w: 1024, h: 256 });
  assert.deepEqual(fitInside(4000, 3000), { w: INPUT_MAX, h: 383 });
  assert.deepEqual(fitInside(200, 100), { w: 200, h: 100 });
});

test("safety: undressing, sexual edits and edits of children are refused; ordinary edits pass", () => {
  for (const ok of ["make it sunset", "remove the people", "put this product on a marble table", "use the style of this", "make the sky baby blue", "remove the top of the tower", "a 30-year-old man smiling", "10 years later, more weathered"])
    assert.equal(editRefusal(ok), "", ok);
  for (const no of ["undress her", "remove her shirt", "make him naked", "take off her clothes", "see-through dress", "put her in lingerie", "make it sexy", "nsfw version", "bigger breasts"])
    assert.match(editRefusal(no), /undress|sexual/, no);
  for (const no of ["make the child older", "a 12 year old girl", "put the kids on a beach", "little girl in a dress", "teenager at a party"])
    assert.match(editRefusal(no), /children/, no);
});

test("POST /api/edit sends a multipart form to klein 9B through AI Gateway and returns the image", async () => {
  const AI = fakeAI();
  const env = { AI, AI_GATEWAY: "massless", MASSLESS_KV: kv() };
  const res = await worker.fetch(editRequest({ images: [png(511, 340), jpeg(300, 300), webp(200, 400)], prompt: "  put this on a marble table  " }), env, ctx);
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.equal(res.headers.get("x-massless-model"), EDIT_MODEL);
  assert.equal(res.headers.get("x-massless-size"), "1024x688");
  assert.equal(res.headers.get("x-massless-remaining-today"), "14");
  assert.deepEqual(imageInfo(new Uint8Array(await res.arrayBuffer())), { type: "image/jpeg", w: 1024, h: 1024 });
  assert.equal(AI.calls.length, 1);
  const { model, form, opts } = AI.calls[0];
  assert.equal(model, "@cf/black-forest-labs/flux-2-klein-9b");
  assert.deepEqual(opts, { gateway: { id: "massless", skipCache: true } });
  assert.equal(form.get("prompt"), "put this on a marble table");
  assert.equal(form.get("width"), "1024");
  assert.equal(form.get("height"), "688");
  const types = [0, 1, 2].map((i) => form.get(`input_image_${i}`).type);
  assert.deepEqual(types, ["image/png", "image/jpeg", "image/webp"]);
  assert.equal(form.get("input_image_3"), null);
  assert.deepEqual(imageInfo(new Uint8Array(await form.get("input_image_1").arrayBuffer())), { type: "image/jpeg", w: 300, h: 300 });
  assert.equal([...env.MASSLESS_KV.m.keys()].filter((k) => /^e:|^ev:/.test(k)).length, 2);
});

test("a failed klein 9B call falls back to klein 4B; both failing is a plain 502 and is not counted", async () => {
  const AI = fakeAI((model) => {
    if (model === EDIT_MODEL) throw new Error("3040: capacity");
    return { image: b64(png(1024, 1024)) };
  });
  const env = { AI, MASSLESS_KV: kv() };
  const res = await worker.fetch(editRequest({ size: "square" }), env, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-massless-model"), EDIT_FALLBACK);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.deepEqual(AI.calls.map((c) => c.model), [EDIT_MODEL, EDIT_FALLBACK]);
  assert.equal(AI.calls[1].form.get("width"), "1024");
  assert.ok(AI.calls[1].form.get("input_image_0").size > 0, "the fallback gets a fresh form body");

  const broken = { AI: fakeAI(() => ({ image: "" })), MASSLESS_KV: kv() };
  const bad = await worker.fetch(editRequest(), broken, ctx);
  assert.equal(bad.status, 502);
  assert.match((await bad.json()).error, /Couldn't make this edit/);
  assert.equal(broken.MASSLESS_KV.m.size, 0);
});

test("POST /api/edit validates instruction, pictures and size with plain-language errors", async () => {
  const env = () => ({ AI: fakeAI(), MASSLESS_KV: kv() });
  const cases = [
    [{ prompt: "" }, 400, /Say what to change/],
    [{ prompt: "x".repeat(1001) }, 400, /under 1000 characters/],
    [{ images: [] }, 400, /Add a picture/],
    [{ images: [png(512, 300)] }, 400, /wrong size/],
    [{ images: [new TextEncoder().encode("GIF89a" + " ".repeat(100))] }, 415, /JPEG, PNG or WebP/],
    [{ images: [png(100, 100), png(100, 100), png(100, 100), png(100, 100), png(100, 100)] }, 400, /up to three references/],
    [{ images: [new Uint8Array(1024 * 1024 + 1).fill(1)] }, 413, /under 1 MB/],
    [{ size: "huge" }, 400, /Match original, Square, Portrait or Landscape/],
    [{ prompt: "undress the woman" }, 422, /won't undress/],
    [{ prompt: "make the kids look older" }, 422, /children/],
  ];
  for (const [opts, status, msg] of cases) {
    const e = env();
    const res = await worker.fetch(editRequest(opts), e, ctx);
    assert.equal(res.status, status, JSON.stringify(opts).slice(0, 80));
    assert.match((await res.json()).error, msg);
    assert.equal(e.AI.calls.length, 0, "the model never runs for a bad request");
  }
  const json = await worker.fetch(new Request("https://massless.test/api/edit", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), env(), ctx);
  assert.equal(json.status, 400);
  const get = await worker.fetch(new Request("https://massless.test/api/edit"), env(), ctx);
  assert.equal(get.status, 405);
  const cross = await worker.fetch(editRequest({ headers: { origin: "https://evil.example" } }), env(), ctx);
  assert.equal(cross.status, 403);
});

test("per-visitor and global daily edit caps, from EDIT_CAP and PER_VISITOR_EDIT", async () => {
  const env = { AI: fakeAI(), MASSLESS_KV: kv(), PER_VISITOR_EDIT: "2", EDIT_CAP: "3" };
  for (let i = 0; i < 2; i++) assert.equal((await worker.fetch(editRequest(), env, ctx)).status, 200);
  const mine = await worker.fetch(editRequest(), env, ctx);
  assert.equal(mine.status, 429);
  assert.match((await mine.json()).error, /used your 2 free edits/);
  assert.equal((await worker.fetch(editRequest({ headers: { "cf-connecting-ip": "5.6.7.8" } }), env, ctx)).status, 200);
  const all = await worker.fetch(editRequest({ headers: { "cf-connecting-ip": "9.9.9.9" } }), env, ctx);
  assert.equal(all.status, 429);
  assert.match((await all.json()).error, /free edits are used up/);
  assert.equal(env.AI.calls.length, 3);
});

test("POST /api/edit asks for the human check when Turnstile is on", async () => {
  const env = { AI: fakeAI(), TURNSTILE_SITEKEY: "site", TURNSTILE_SECRET: "secret", PASS_KEY: "k" };
  const res = await worker.fetch(editRequest(), env, ctx);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.human, true);
  assert.equal(body.sitekey, "site");
  assert.equal(env.AI.calls.length, 0);
});
