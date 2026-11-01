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

// GPU jobs: one daily budget under real concurrency. 18 cents fits two 9-cent animate reservations.
const gpu = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: "gpu-ledger-test",
        modules: true,
        script:
          compiled.outputFiles[0].text +
          `
export class RuntimeLedger extends GenerationLedger {
 async provider(path){return path==='/run'?{id:'rp-'+crypto.randomUUID(),status:'IN_QUEUE'}:{status:'COMPLETED',executionTime:20000,delayTime:0,output:{type:'audio',mime:'audio/mpeg',data:'SUQz'.repeat(600000)}};}
}
export default {fetch(request,env){return env.TEST_LEDGER.get(env.TEST_LEDGER.idFromName('gpu')).fetch(request)}};`,
        compatibilityDate: "2026-10-01",
        durableObjects: { TEST_LEDGER: { className: "RuntimeLedger", useSQLite: true } },
        bindings: { GPU_ENDPOINT_ID: "gpu-ep", RUNPOD_API_KEY: "k", GPU_DAILY_BUDGET_CENTS: "18", GPU_PER_USER_DAILY: "3", GPU_CENTS_PER_HOUR: "76" },
      },
    ],
  }),
);
try {
  const submit = (owner, i) =>
    gpu.dispatchFetch("http://massless.test/api/generations", {
      method: "POST",
      headers: { "x-owner-id": owner, "content-type": "application/json" },
      body: JSON.stringify({ job: "animate", input: { image: "/9j/" + "A".repeat(100) }, idempotencyKey: "gpu-runtime-key-" + String(i).padStart(4, "0") }),
    });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => submit("user" + i, i).then(async (r) => ({ status: r.status, j: await r.json() }))));
  const accepted = results.filter((r) => r.status === 202);
  assert.equal(accepted.length, 2, JSON.stringify(results.map((r) => r.status)));
  assert.ok(results.filter((r) => r.status === 429).every((r) => /today|tomorrow/i.test(r.j.error)));
  const id = accepted[0].j.id, owner = "user" + results.indexOf(accepted[0]);
  const done = await (await gpu.dispatchFetch("http://massless.test/api/generations/" + id, { headers: { "x-owner-id": owner } })).json();
  assert.equal(done.status, "COMPLETED");
  assert.equal(done.costCents, 1);
  const file = await gpu.dispatchFetch("http://massless.test/api/generations/" + id + "/file", { headers: { "x-owner-id": owner } });
  assert.equal(file.headers.get("content-type"), "audio/mpeg");
  assert.equal((await file.arrayBuffer()).byteLength, 1800000);
  const budget = await (await gpu.dispatchFetch("http://massless.test/api/generations/budget", { headers: { "x-owner-id": owner } })).json();
  assert.equal(budget.leftCents, 18 - 9 - 1);
  // a 6 MB image: over the 2 MB storage value limit, so the ledger must never store the input itself
  const big = await gpu.dispatchFetch("http://massless.test/api/generations", {
    method: "POST",
    headers: { "x-owner-id": "big-input-user", "content-type": "application/json" },
    body: JSON.stringify({ job: "upscale", input: { image: "/9j/" + "A".repeat(6_000_000) }, idempotencyKey: "gpu-runtime-big-0001" }),
  });
  const bigBody = await big.json();
  assert.equal(big.status, 202, JSON.stringify(bigBody).slice(0, 300));
  console.log(
    "SQLite Durable Object runtime passed: GPU daily budget under 8 concurrent submissions, settlement refund, 2.4 MB result in 1 MB pieces, 6 MB input never stored.",
  );
} finally {
  await gpu.dispose();
}
