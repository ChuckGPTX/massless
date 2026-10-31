import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCaptions,
  activeCaption,
  validateTrim,
} from "../public/js/captions.js";
import { renderTemplate, templateSettings } from "../public/js/templates.js";
import { assetURL, recipeFor, saveAsset } from "../public/js/assets.js";
import { get, all } from "../public/js/store.js";
import "fake-indexeddb/auto";
test("caption cues retain fractional timing and exclude the end boundary", () => {
  const cues = parseCaptions(
    "1\n00:00:00,250 --> 00:00:01,500\nHello <b>world</b>\n\n2\n00:00:02.000 --> 00:00:03.000\nNext",
  );
  assert.deepEqual(cues, [
    { start: 0.25, end: 1.5, text: "Hello world" },
    { start: 2, end: 3, text: "Next" },
  ]);
  assert.equal(activeCaption(cues, 0.24), "");
  assert.equal(activeCaption(cues, 0.25), "Hello world");
  assert.equal(activeCaption(cues, 1.5), "");
  assert.throws(() => parseCaptions("00:00:04,000 --> 00:00:01,000\nWrong"));
  assert.throws(() => parseCaptions("00:61:00,000 --> 00:62:00,000\nWrong"));
  assert.deepEqual(validateTrim(1, 3, 4), { start: 1, end: 3 });
  for (const args of [
    [2, 1, 3],
    [-1, 2, 3],
    [0, 4, 3],
    [0, 121, 200],
  ])
    assert.throws(() => validateTrim(...args));
});
test("template output escapes markup and ignores unsafe image URLs and settings", () => {
  const html = renderTemplate(
    {
      name: "</title><script>alert(1)</script>",
      headline: "<img onerror=evil()>",
      accent: "red; }body{display:none}",
      speed: 1e9,
    },
    "https://evil.invalid/tracker",
  );
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("evil.invalid"));
  assert.ok(!html.includes("display:none"));
  assert.equal(templateSettings({ speed: 1e9 }).speed, 5);
  const game = renderTemplate({ template: "game", name: "Arcade", speed: 3 });
  assert.match(game, /<script>/);
  assert.match(game, /<\/script>/);
  assert.match(game, /speed=3/);
  assert.ok(!game.includes("cdn."));
});
test("shared media keeps original bytes and a recipe links to its source", async () => {
  const source = await saveAsset(
    new Blob(["original"], { type: "image/png" }),
    { name: "Original" },
  );
  const edited = await saveAsset(new Blob(["edited"], { type: "image/png" }), {
    name: "New take",
    sourceId: source.id,
    settings: { brightness: 110 },
  });
  assert.equal(await (await get(source.id)).blob.text(), "original");
  assert.equal(recipeFor(edited).sourceId, source.id);
  assert.equal(recipeFor(edited).settings.brightness, 110);
  assert.equal((await all()).length, 2);
  const link = assetURL("/film", edited.id, "A&B <new>");
  assert.equal(
    new URL(link, "https://local.invalid").searchParams.get("brief"),
    "A&B <new>",
  );
  await assert.rejects(saveAsset(new Blob()));
});
