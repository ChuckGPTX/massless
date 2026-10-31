import test from "node:test";
import assert from "node:assert/strict";
import {
  GenerationLedger,
  generationAPI,
  generationConfig,
  validateGeneration,
} from "../src/generations.js";
function storage() {
  const data = new Map();
  let queue = Promise.resolve();
  const api = {
    get: async (k) => structuredClone(data.get(k)),
    put: async (k, v) => {
      if (typeof k === "object") {
        for (const [a, b] of Object.entries(k)) data.set(a, structuredClone(b));
      } else data.set(k, structuredClone(v));
    },
    transaction: (fn) => {
      const next = queue.then(() => fn(api));
      queue = next.catch(() => {});
      return next;
    },
    data,
  };
  return api;
}
const input = (key = "test-request-00000001") => ({
  model: "moss-image-sft",
  prompt: "A signed poster",
  width: 1024,
  height: 1024,
  seed: 42,
  idempotencyKey: key,
});
const req = (path = "/api/generations", owner = "user1", body) =>
  new Request("https://massless.test" + path, {
    method: body ? "POST" : "GET",
    headers: { "x-owner-id": owner, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
function ledger(budget = 100) {
  const store = storage();
  const l = new GenerationLedger(
    { storage: store },
    { MOSS_BUDGET_CENTS: String(budget) },
  );
  let calls = 0;
  l.provider = async (path) => {
    calls++;
    return {
      id: "provider-" + calls,
      status: path.startsWith("/status") ? "COMPLETED" : "IN_QUEUE",
      output: { image: "data:image/jpeg;base64,/9j/2Q==" },
    };
  };
  return { l, store, calls: () => calls };
}
test("rejects unsupported models, malformed dimensions, seeds and missing request keys", () => {
  for (const patch of [
    { model: "other" },
    { width: 1023 },
    { height: 1600 },
    { seed: -1 },
    { idempotencyKey: "short" },
  ])
    assert.throws(() => validateGeneration({ ...input(), ...patch }));
  assert.equal(validateGeneration(input()).seed, 42);
  assert.equal(
    generationConfig({
      MOSS_ENDPOINT_ID: "x",
      RUNPOD_API_KEY: "x",
      GENERATION_LEDGER: {},
    }).models["moss-image-sft"],
    false,
  );
});
test("concurrent duplicate submissions reserve and call the provider once", async () => {
  const { l, store, calls } = ledger();
  const rows = await Promise.all(
    Array.from({ length: 6 }, () =>
      l.fetch(req(undefined, "user1", input())).then((r) => r.json()),
    ),
  );
  assert.equal(new Set(rows.map((x) => x.id)).size, 1);
  assert.equal(calls(), 1);
  assert.equal(await store.get("reservedCents"), 50);
  const conflict = await l.fetch(
    req(undefined, "user1", { ...input(), prompt: "Different" }),
  );
  assert.equal(conflict.status, 409);
});
test("budget is global and persistent; active requests prevent a second charge", async () => {
  const { l, store, calls } = ledger(100);
  await l.fetch(req(undefined, "one", input()));
  assert.equal(
    (await l.fetch(req(undefined, "one", input("test-request-00000002"))))
      .status,
    409,
  );
  await l.fetch(req(undefined, "two", input()));
  assert.equal((await l.fetch(req(undefined, "three", input()))).status, 429);
  assert.equal(await store.get("reservedCents"), 100);
  assert.equal(calls(), 2);
});
test("owner isolation covers status, images and cancellation; completed image bytes survive storage chunking", async () => {
  const { l } = ledger();
  const job = await (await l.fetch(req(undefined, "owner", input()))).json();
  for (const suffix of ["", "/image", "/cancel"])
    assert.equal(
      (
        await l.fetch(
          req(
            "/api/generations/" + job.id + suffix,
            "stranger",
            suffix === "/cancel" ? {} : undefined,
          ),
        )
      ).status,
      404,
    );
  const result = await l.fetch(req("/api/generations/" + job.id, "owner"));
  assert.equal((await result.json()).status, "COMPLETED");
  assert.equal(
    (
      await l.fetch(req("/api/generations/" + job.id + "/image", "owner"))
    ).headers.get("content-type"),
    "image/jpeg",
  );
});
test("late status response cannot resurrect a cancelled job", async () => {
  const { l } = ledger();
  const job = await (await l.fetch(req(undefined, "owner", input()))).json();
  let respond;
  l.provider = (path) =>
    path.startsWith("/status")
      ? new Promise((r) => (respond = r))
      : Promise.resolve({ status: "CANCELLED" });
  const polling = l.fetch(req("/api/generations/" + job.id, "owner"));
  await new Promise((r) => setTimeout(r, 0));
  await l.fetch(req("/api/generations/" + job.id + "/cancel", "owner", {}));
  respond({ status: "IN_PROGRESS" });
  assert.equal((await (await polling).json()).status, "CANCELLED");
});
test("ambiguous provider submission is never automatically repeated", async () => {
  const { l, store } = ledger();
  let calls = 0;
  l.provider = async () => {
    calls++;
    throw new Error("Network timeout");
  };
  assert.equal(
    (await (await l.fetch(req(undefined, "owner", input()))).json()).status,
    "SUBMISSION_UNKNOWN",
  );
  await l.fetch(req(undefined, "owner", input()));
  assert.equal(calls, 1);
  assert.equal(await store.get("reservedCents"), 50);
});
test("server rejects cross-site requests and missing authentication before reaching ledger", async () => {
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public",
    GENERATION_LEDGER: {},
    MOSS_ENDPOINT_ID: "x",
    RUNPOD_API_KEY: "secret",
  };
  assert.equal(
    (
      await generationAPI(
        new Request("https://massless.test/api/generations", {
          headers: { origin: "https://other.test" },
        }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await generationAPI(
        new Request("https://massless.test/api/generations"),
        env,
      )
    ).status,
    401,
  );
  const config = JSON.stringify(generationConfig(env));
  assert.ok(!config.includes("secret"));
});

test("invalid budget configuration fails closed", async () => {
  const { l, calls } = ledger("invalid");
  assert.equal((await l.fetch(req(undefined, "owner", input()))).status, 429);
  assert.equal(calls(), 0);
});
