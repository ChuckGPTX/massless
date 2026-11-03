import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { libraryChoices, acceptKinds } from "../public/js/presets/library-pick.js";
import { PRESETS } from "../public/js/presets/catalog.js";
import { DENY } from "../public/js/presets/spec.js";

const item = (id, type, created, size = 1000) => ({ id, created, blob: new Blob([new Uint8Array(size)], { type }) });

test("the library sheet shows only what the preset takes, newest first", () => {
  const items = [
    item("old-png", "image/png", 1), item("new-jpg", "image/jpeg", 5), item("webp", "image/webp", 3),
    item("clip", "video/mp4", 9), item("song", "audio/mpeg", 8), item("svg", "image/svg+xml", 7), item("doc", "application/pdf", 6),
    item("empty", "image/png", 4, 0), item("huge", "image/png", 2, 26e6), { id: "deck", created: 10, kind: "deck" },
  ];
  const image = { key: "product", type: "image" };
  assert.deepEqual(libraryChoices(items, image).map((x) => x.id), ["new-jpg", "webp", "old-png"]);
  assert.deepEqual(libraryChoices(items, { key: "clip", type: "media" }).map((x) => x.id), ["clip", "new-jpg", "webp", "old-png"]);
  assert.deepEqual(libraryChoices(items, { key: "script", type: "textarea" }), []);
  assert.deepEqual(libraryChoices([], image), []);
  assert.deepEqual(libraryChoices(undefined, image), []);
  assert.equal(libraryChoices(Array.from({ length: 80 }, (_, i) => item(`p${i}`, "image/png", i)), image).length, 60);
});

test("every preset's picture inputs take pictures from the library", () => {
  for (const p of PRESETS) for (const i of p.inputs.filter((x) => x.type === "image")) assert.deepEqual(acceptKinds(i), ["image"], `${p.id}.${i.key}`);
});

test("the library sheet's words stay plain", async () => {
  const src = await readFile(new URL("../public/js/presets/library-pick.js", import.meta.url), "utf8");
  const copy = [...src.matchAll(/'([^'\n]{12,})'|`([^`\n]{12,})`/g)].map((m) => m[1] || m[2]).filter((s) => / /.test(s)).join(" \n ").toLowerCase();
  assert.match(copy, /no saved/);
  for (const w of [...DENY, "indexeddb", "database", "blob", "gpu", "model", "prompt"]) assert.ok(!new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(copy), w);
});
