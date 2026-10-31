import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const env = {};
const ctx = { waitUntil() {} };

test("old and www addresses redirect to chucksi.com with path and query", async () => {
  for (const host of ["massless.chucksi.com", "www.chucksi.com"]) {
    const r = await worker.fetch(new Request(`https://${host}/sign?x=1`), env, ctx);
    assert.equal(r.status, 301);
    assert.equal(r.headers.get("location"), "https://chucksi.com/sign?x=1");
  }
});

test("APIs and non-GET requests are not redirected", async () => {
  const r = await worker.fetch(new Request("https://massless.chucksi.com/api/nope"), env, ctx);
  assert.notEqual(r.status, 301);
  const p = await worker.fetch(new Request("https://massless.chucksi.com/", { method: "POST" }), env, ctx);
  assert.notEqual(p.status, 301);
});
