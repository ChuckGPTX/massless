// Exercise reservations inside actual SQLite-backed Cloudflare Durable Objects.
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import assert from "node:assert/strict";
const compiled = await build({
  entryPoints: ["src/generations.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});
const script =
  compiled.outputFiles[0].text +
  `
export class RuntimeLedger extends GenerationLedger {
 async provider(path){return {id:'test-provider',status:path.startsWith('/status')?'COMPLETED':'IN_QUEUE',output:{image:'data:image/jpeg;base64,'+'A'.repeat(200000)}};}
}
export default {fetch(request,env){return env.TEST_LEDGER.get(env.TEST_LEDGER.idFromName('test')).fetch(request)}};`;
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: "ledger-test",
        modules: true,
        script,
        compatibilityDate: "2026-10-01",
        durableObjects: {
          TEST_LEDGER: { className: "RuntimeLedger", useSQLite: true },
        },
        bindings: { MOSS_BUDGET_CENTS: "100" },
      },
    ],
  }),
);
try {
  const input = {
    model: "moss-image-sft",
    prompt: "Test",
    width: 512,
    height: 512,
    seed: 42,
    idempotencyKey: "runtime-test-key-0001",
  };
  const request = (owner) =>
    mf.dispatchFetch("http://massless.test/api/generations", {
      method: "POST",
      headers: { "x-owner-id": owner, "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  const results = await Promise.all(
    Array.from({ length: 8 }, () => request("owner").then((x) => x.json())),
  );
  assert.equal(new Set(results.map((x) => x.id)).size, 1);
  assert.ok(results[0].id);
  assert.equal((await request("second")).status, 202);
  assert.equal((await request("third")).status, 429);
  const id = results[0].id;
  assert.equal(
    (
      await mf.dispatchFetch("http://massless.test/api/generations/" + id, {
        headers: { "x-owner-id": "other" },
      })
    ).status,
    404,
  );
  const completed = await mf.dispatchFetch(
    "http://massless.test/api/generations/" + id,
    { headers: { "x-owner-id": "owner" } },
  );
  assert.equal((await completed.json()).status, "COMPLETED");
  const image = await mf.dispatchFetch(
    "http://massless.test/api/generations/" + id + "/image",
    { headers: { "x-owner-id": "owner" } },
  );
  assert.equal((await image.arrayBuffer()).byteLength, 150000);
  console.log(
    "SQLite Durable Object runtime passed: concurrent idempotency, global budget, owner isolation, chunked image delivery.",
  );
} finally {
  await mf.dispose();
}
