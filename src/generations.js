// Hosted generation boundary. Credentials and the budget ledger never reach the browser.
// One ledger for every hosted GPU job: MOSS Image (its own endpoint, a lifetime allowance) and the GPU worker's
// jobs (workers/gpu: animate, motion, lipsync, upscale_video, music, upscale, and Lab jobs when LAB_ENABLED), all
// inside one daily budget.
import { promoAPI, promoConfig } from './promo-video.js';
import { FOLEY_BLOCKED, LAB_JOBS, QUEUE_SEC, STARTUP_SEC, actualCents, gpuSettings, quotes, reserveCents, utcDay, validateGpuJob } from './gpu-jobs.js';
const reply = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
export function generationConfig(env) {
  const g = gpuSettings(env);
  const ready = !!(env.GENERATION_LEDGER && env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
  return {
    gpu: { on: ready && g.on, lab: ready && g.lab, perUserDaily: g.on ? g.perUser : 0 },
    promoVideo: ready ? promoConfig(env) : { on: false },
    cloud: !!(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY),
    supabaseUrl: env.SUPABASE_URL || "",
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY || "",
    models: {
      "moss-image-sft": !!(
        env.MOSS_ENDPOINT_ID &&
        env.RUNPOD_API_KEY &&
        env.GENERATION_LEDGER &&
        Number(env.MOSS_BUDGET_CENTS) > 0
      ),
    },
  };
}
export function validateGeneration(body) {
  if (body.model !== "moss-image-sft")
    throw new Error("Choose a supported model.");
  if (!body || typeof body !== "object" || typeof body.prompt !== "string")
    throw new Error("Enter an image prompt.");
  const prompt = body.prompt.trim();
  if (!prompt || prompt.length > 12000)
    throw new Error("Use a prompt between 1 and 12,000 characters.");
  const width = Number(body.width),
    height = Number(body.height),
    seed = Number(body.seed);
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 256 ||
    height < 256 ||
    width > 1536 ||
    height > 1536 ||
    width % 16 ||
    height % 16 ||
    width * height > 1572864
  )
    throw new Error("Choose dimensions divisible by 16, up to 1.5 megapixels.");
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)
    throw new Error("Choose a valid seed.");
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.idempotencyKey || ""))
    throw new Error("A request identifier is required.");
  return {
    model: body.model,
    prompt,
    width,
    height,
    seed,
    idempotencyKey: body.idempotencyKey,
  };
}
async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function generationAPI(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/config") return reply(generationConfig(env));
  const promo = url.pathname.startsWith("/api/promo-video");
  if (promo ? !env.GENERATION_LEDGER : !env.GENERATION_LEDGER || !env.RUNPOD_API_KEY)
    return reply(
      {
        error:
          "This isn't available right now. Try again later.",
      },
      503,
    );
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
    return reply({ error: "Sign-in isn't available right now. Try again later." }, 503);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin)
    return reply({ error: "Cross-site requests are not allowed." }, 403);
  const bearer = request.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(bearer))
    return reply({ error: promo ? "Sign in to make free clips. It's free." : "Sign in to create. It's free." }, 401);
  let auth;
  try {
    auth = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: bearer },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return reply(
      { error: "Sign-in could not be checked. Please try again." },
      503,
    );
  }
  if (!auth.ok) return reply({ error: "Please sign in again." }, 401);
  const user = await auth.json();
  if (!user.id) return reply({ error: "Please sign in again." }, 401);
  // Only the trusted Worker supplies the owner header to this private binding.
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.set("x-owner-id", user.id);
  headers.set("x-moss-ready", env.MOSS_ENDPOINT_ID ? "1" : "0");
  headers.set(
    "x-country",
    String(request.cf?.country || request.headers.get("cf-ipcountry") || "").toUpperCase(),
  );
  return env.GENERATION_LEDGER.get(
    env.GENERATION_LEDGER.idFromName("moss-development-v1"),
  ).fetch(new Request(request, { headers }));
}
export class GenerationLedger {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async provider(path, options = {}, endpoint = this.env.MOSS_ENDPOINT_ID) {
    const r = await fetch(
      "https://api.runpod.ai/v2/" + endpoint + path,
      {
        ...options,
        headers: {
          Authorization: "Bearer " + this.env.RUNPOD_API_KEY,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!r.ok) throw new Error("This isn't available right now. Try again in a minute.");
    return r.json();
  }
  async fetch(request) {
    const url = new URL(request.url),
      owner = request.headers.get("x-owner-id");
    if (!owner) return reply({ error: "Unauthorized" }, 401);
    if (url.pathname.startsWith("/api/promo-video")) {
      try {
        return await promoAPI(this.ctx, this.env, request, owner);
      } catch (e) {
        return reply({ error: e.message || "The video request failed." }, 502);
      }
    }
    try {
      if (url.pathname === "/api/generations" && request.method === "POST") {
        let body;
        try {
          body = await request.json();
        } catch {
          return reply({ error: "Send JSON." }, 400);
        }
        return body && typeof body === "object" && "job" in body
          ? await this.submitGpu(body, owner, request.headers.get("x-country") || "")
          : await this.submit(body, owner, request.headers.get("x-moss-ready") !== "0");
      }
      if (url.pathname === "/api/generations/budget" && request.method === "GET")
        return reply(await this.budget(owner));
      const match = url.pathname.match(
        /^\/api\/generations\/([0-9a-f-]{36})(\/(?:image|file|audio|cancel))?$/,
      );
      if (!match) return reply({ error: "Not found" }, 404);
      const key = "job:" + match[1];
      let job = await this.ctx.storage.get(key);
      if (!job || job.owner !== owner)
        return reply({ error: "Not found" }, 404);
      if (match[2] === "/cancel" && request.method === "POST") {
        if (job.providerId && !this.terminal(job.status)) {
          await this.provider(
            "/cancel/" + encodeURIComponent(job.providerId),
            { method: "POST" },
            this.endpointOf(job),
          );
          await this.ctx.storage.transaction(async (tx) => {
            job = await tx.get(key);
            if (!this.terminal(job.status)) {
              job.status = "CANCELLED";
              await tx.put(key, job);
            }
          });
        }
        return reply(this.publicJob(job));
      }
      if (request.method !== "GET") return reply({ error: "Use GET." }, 405);
      if (job.providerId && !this.terminal(job.status)) {
        const result = await this.provider(
          "/status/" + encodeURIComponent(job.providerId),
          {},
          this.endpointOf(job),
        );
        if (job.kind === "gpu") {
          job = await this.updateGpu(key, result);
          return this.gpuResponse(job, match[2]);
        }
        await this.ctx.storage.transaction(async (tx) => {
          job = await tx.get(key);
          // Cancellation or a terminal result may have arrived while the provider responded.
          if (this.terminal(job.status)) return;
          if (
            ![
              "IN_QUEUE",
              "IN_PROGRESS",
              "COMPLETED",
              "FAILED",
              "CANCELLED",
              "TIMED_OUT",
            ].includes(result.status)
          )
            return;
          if (job.status === "IN_PROGRESS" && result.status === "IN_QUEUE")
            return;
          job.status = result.status;
          job.error = result.error
            ? "The image could not be completed."
            : undefined;
          if (this.terminal(job.status)) await this.settle(tx, job, result, this.settings().mossRate);
          if (result.status === "COMPLETED") {
            const image = result.output?.image;
            if (
              typeof image !== "string" ||
              !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(
                image,
              ) ||
              image.length > 7000000
            ) {
              job.status = "FAILED";
              job.error = "The service returned an invalid image.";
            } else {
              const chunks = {};
              job.imageChunks = Math.ceil(image.length / 60000);
              for (let i = 0; i < job.imageChunks; i++)
                chunks["image:" + job.id + ":" + i] = image.slice(
                  i * 60000,
                  (i + 1) * 60000,
                );
              await tx.put(chunks);
            }
          }
          await tx.put(key, job);
        });
      }
      if (job.kind === "gpu") return this.gpuResponse(job, match[2]);
      if (match[2] === "/image") {
        if (job.status !== "COMPLETED" || !job.imageChunks)
          return reply({ error: "The image is not ready." }, 409);
        const parts = await Promise.all(
          Array.from({ length: job.imageChunks }, (_, i) =>
            this.ctx.storage.get("image:" + job.id + ":" + i),
          ),
        );
        const image = parts.join("");
        const raw = atob(image.split(",")[1]),
          bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        return new Response(bytes, {
          headers: {
            "content-type": image.startsWith("data:image/jpeg")
              ? "image/jpeg"
              : "image/png",
            "cache-control": "private, no-store",
          },
        });
      }
      return reply(this.publicJob(job));
    } catch (e) {
      return reply(
        { error: e.message || "Couldn't create this. Try again." },
        e.status || 502,
      );
    }
  }
  terminal(s) {
    return [
      "COMPLETED",
      "FAILED",
      "CANCELLED",
      "TIMED_OUT",
      "SUBMISSION_UNKNOWN",
    ].includes(s);
  }
  publicJob(j) {
    if (j.kind === "gpu")
      return {
        id: j.id,
        job: j.job,
        lab: j.lab,
        status: j.status,
        message: j.message,
        percent: j.percent,
        error: j.error,
        output: j.output,
        reservedCents: j.reservedCents,
        costCents: j.costCents,
        timeoutSec: j.timeoutSec,
        createdAt: j.createdAt,
      };
    return {
      id: j.id,
      status: j.status,
      model: j.input.model,
      seed: j.input.seed,
      error: j.error,
      createdAt: j.createdAt,
    };
  }
  settings() {
    return gpuSettings(this.env);
  }
  endpointOf(job) {
    if (job.kind !== "gpu") return this.env.MOSS_ENDPOINT_ID;
    return job.lab ? this.env.LAB_ENDPOINT_ID : this.env.GPU_ENDPOINT_ID;
  }
  // Return the unused part of a job's reservation to the day it was reserved on. MOSS's lifetime allowance
  // (reservedCents) is never refunded; the daily budget is, once RunPod reports what the job really used.
  async settle(tx, job, result, centsPerHour) {
    if (!job.day || job.costCents !== undefined) return;
    const actual = actualCents(result, centsPerHour);
    job.costCents = actual === null ? job.reservedCents : Math.min(actual, job.reservedCents);
    const dayKey = "day:" + job.day;
    const used = (await tx.get(dayKey)) || 0;
    await tx.put(dayKey, Math.max(0, used - (job.reservedCents - job.costCents)));
    const queue = ((await tx.get("queue")) || []).filter((id) => id !== job.id);
    await tx.put("queue", queue);
  }
  async budget(owner) {
    const g = this.settings();
    if (!g.on) return { on: false };
    const day = utcDay();
    const used = (await this.ctx.storage.get("day:" + day)) || 0;
    const mine = (await this.ctx.storage.get("user:" + day + ":" + owner)) || 0;
    const queue = await this.liveQueue();
    const left = Math.max(0, g.daily - used);
    return {
      on: true,
      lab: g.lab,
      dailyBudgetCents: g.daily,
      leftCents: left,
      jobsLeftForYou: left < 2 ? 0 : Math.max(0, g.perUser - mine),
      perUserDaily: g.perUser,
      centsPerHour: g.rate,
      estimates: quotes(g.rate),
      queue: queue.length,
      resetsAt: new Date(Date.parse(day + "T00:00:00Z") + 86400000).toISOString(),
    };
  }
  async liveQueue() {
    const ids = (await this.ctx.storage.get("queue")) || [];
    const jobs = await Promise.all(ids.map((id) => this.ctx.storage.get("job:" + id)));
    return jobs.filter((j) => j && !this.terminal(j.status) && Date.now() - j.createdAt < (j.timeoutSec || 1800) * 1000);
  }
  async submitGpu(body, owner, country) {
    const g = this.settings();
    if (!g.valid) return reply({ error: "This isn't available right now. Try again later." }, 503);
    if (!g.on) return reply({ on: false, error: "This isn't available right now. Try again later." }, 503);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.idempotencyKey || ""))
      return reply({ error: "A request identifier is required." }, 400);
    const lab = LAB_JOBS.includes(body.job);
    if (lab && !g.lab) return reply({ error: "This isn't available on this site." }, 403);
    if (lab && body.lab !== true)
      return reply({ error: "This is a Lab model: a research preview for non-commercial use. Turn on Lab mode to run it.", lab: true }, 403);
    let v;
    try {
      v = validateGpuJob(body.job, body.input);
    } catch (e) {
      return reply({ error: e.message }, 400);
    }
    if (v.job === "sound" && v.input.model === "foley" && FOLEY_BLOCKED.has(country))
      return reply({
        error: "HunyuanVideo-Foley's license does not cover the EU, the UK or South Korea, so it can't run for you here. MMAudio does the same job: choose it instead.",
        suggest: { model: "mmaudio" },
      }, 451);
    const sec = v.seconds + STARTUP_SEC;
    const cents = reserveCents(v.seconds, lab ? g.labRate : g.rate);
    // a hash, not the input: images and clips can be several MB and storage values are limited to 2 MB
    const fingerprint = await sha256Hex(JSON.stringify([v.job, v.input, !!lab]));
    const day = utcDay();
    let job, isNew = false;
    try {
      await this.ctx.storage.transaction(async (tx) => {
        isNew = false;
        const old = await tx.get("request:" + owner + ":" + body.idempotencyKey);
        if (old) {
          job = await tx.get("job:" + old);
          return;
        }
        const active = await tx.get("active:" + owner);
        if (active) {
          const a = await tx.get("job:" + active);
          if (a && !this.terminal(a.status) && Date.now() - a.createdAt < (a.timeoutSec || 1200) * 1000)
            throw Object.assign(new Error("Your last one is still being made. Wait for it to finish."), { status: 409 });
        }
        const mine = (await tx.get("user:" + day + ":" + owner)) || 0;
        if (mine >= g.perUser)
          throw Object.assign(new Error(`That's all ${g.perUser} for today. Come back tomorrow.`), { status: 429 });
        const used = (await tx.get("day:" + day)) || 0;
        if (used + cents > g.daily) {
          const left = Math.max(0, g.daily - used);
          throw Object.assign(new Error(left < 2
            ? "Today's free creations are used up. Come back tomorrow."
            : "There isn't enough left today for this one. Try a shorter or smaller one, or come back tomorrow."), { status: 429, budget: true });
        }
        job = {
          id: crypto.randomUUID(), kind: "gpu", owner, job: v.job, lab, fingerprint,
          status: "SUBMITTING", createdAt: Date.now(), reservedCents: cents, day, timeoutSec: sec + QUEUE_SEC,
        };
        const queue = ((await tx.get("queue")) || []).slice(-200);
        await tx.put({
          ["day:" + day]: used + cents,
          ["user:" + day + ":" + owner]: mine + 1,
          ["job:" + job.id]: job,
          ["request:" + owner + ":" + body.idempotencyKey]: job.id,
          ["active:" + owner]: job.id,
          queue: [...queue, job.id],
        });
        isNew = true;
      });
    } catch (e) {
      return reply({ error: e.message, budget: e.budget }, e.status || 502);
    }
    if (job.fingerprint !== fingerprint)
      return reply({ error: "This request identifier was already used for a different job." }, 409);
    if (!isNew) return reply(this.publicJob(job), 202);
    await this.pruneFiles();
    try {
      const result = await this.provider("/run", {
        method: "POST",
        body: JSON.stringify({
          input: { ...v.input, job: v.job },
          policy: { executionTimeout: sec * 1000, ttl: (sec + QUEUE_SEC) * 1000 },
        }),
      }, this.endpointOf(job));
      if (!result.id) throw new Error("Missing provider identifier");
      job.providerId = result.id;
      job.status = result.status || "IN_QUEUE";
    } catch {
      job.status = "SUBMISSION_UNKNOWN";
      job.error = "Couldn't start this one. Try again.";
    }
    await this.ctx.storage.put("job:" + job.id, job);
    return reply(this.publicJob(job), 202);
  }
  async updateGpu(key, result) {
    let job;
    await this.ctx.storage.transaction(async (tx) => {
      job = await tx.get(key);
      if (this.terminal(job.status)) return;
      const known = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"];
      if (!known.includes(result.status)) return;
      if (job.status === "IN_PROGRESS" && result.status === "IN_QUEUE") return;
      job.status = result.status;
      if (result.status === "IN_QUEUE")
        job.message = Date.now() - job.createdAt > 15000 ? "Waking up the GPU (a cold start takes about a minute)…" : "Waiting for the GPU…";
      if (result.status === "IN_PROGRESS") {
        const o = result.output;
        job.message = (o && typeof o === "object" ? o.text : typeof o === "string" ? o : "") || "Rendering…";
        job.percent = o && Number.isFinite(o.percent) ? o.percent : undefined;
      }
      if (result.status === "COMPLETED") {
        const o = result.output || {};
        if (o.error || typeof o.data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(o.data.slice(0, 1000)) || o.data.length > 15_000_000) {
          job.status = "FAILED";
          job.error = typeof o.error === "string" ? o.error.slice(0, 400) : "The GPU returned no result.";
        } else {
          const { data, audio, ...meta } = o;
          job.files = { file: await this.putFile(tx, job.id, "file", data, meta.mime || "application/octet-stream") };
          if (audio && typeof audio.data === "string")
            job.files.audio = await this.putFile(tx, job.id, "audio", audio.data, audio.mime || "audio/mp4");
          job.output = { ...meta, ...(audio ? { audio: { mime: audio.mime, bytes: audio.bytes } } : {}) };
          job.message = "Done";
          job.percent = 100;
        }
      }
      if (result.status === "FAILED") {
        let e = (result.output && result.output.error) || result.error || "";
        if (typeof e === "string" && e.startsWith("{")) {
          try { e = JSON.parse(e).error_message || e; } catch { /* keep it */ }
        }
        job.error = String(e || "The GPU job failed.").slice(0, 400);
      }
      if (result.status === "CANCELLED") job.error = "The GPU job was cancelled.";
      if (result.status === "TIMED_OUT") job.error = "The GPU job ran out of time and was stopped.";
      if (this.terminal(job.status)) await this.settle(tx, job, result, job.lab ? this.settings().labRate : this.settings().rate);
      await tx.put(key, job);
    });
    return job;
  }
  // Results are kept in the ledger's storage in 1 MB pieces (values may not exceed 2 MB) for 24 hours.
  async putFile(tx, id, name, b64, mime) {
    const size = 1_000_000, parts = Math.ceil(b64.length / size), rows = {};
    for (let i = 0; i < parts; i++) rows["file:" + id + ":" + name + ":" + i] = b64.slice(i * size, (i + 1) * size);
    await tx.put(rows);
    const index = (await tx.get("files")) || [];
    await tx.put("files", [...index, { id, name, parts, at: Date.now() }]);
    return { parts, mime };
  }
  async pruneFiles() {
    const index = (await this.ctx.storage.get("files")) || [];
    const old = index.filter((f) => Date.now() - f.at > 86400000).slice(0, 10);
    if (!old.length) return;
    const keys = old.flatMap((f) => Array.from({ length: f.parts }, (_, i) => "file:" + f.id + ":" + f.name + ":" + i));
    for (let i = 0; i < keys.length; i += 100) await this.ctx.storage.delete(keys.slice(i, i + 100));
    const gone = new Set(old.map((f) => f.id + f.name));
    await this.ctx.storage.put("files", index.filter((f) => !gone.has(f.id + f.name)));
  }
  async gpuResponse(job, suffix) {
    if (suffix !== "/file" && suffix !== "/audio") return reply(this.publicJob(job));
    const f = job.files && job.files[suffix.slice(1)];
    if (job.status !== "COMPLETED" || !f) return reply({ error: "The result is not ready." }, 409);
    const parts = await Promise.all(Array.from({ length: f.parts }, (_, i) => this.ctx.storage.get("file:" + job.id + ":" + suffix.slice(1) + ":" + i)));
    if (parts.some((p) => typeof p !== "string")) return reply({ error: "This result has expired." }, 410);
    const raw = atob(parts.join(""));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Response(bytes, { headers: { "content-type": f.mime, "cache-control": "private, no-store" } });
  }
  async submit(body, owner, mossReady) {
    let input;
    try {
      input = validateGeneration(body);
    } catch (e) {
      return reply({ error: e.message }, 400);
    }
    if (mossReady === false)
      return reply(
        { error: "Best quality isn't available right now. Try another style." },
        503,
      );
    const g = this.settings();
    const fingerprint = JSON.stringify(input);
    let job,
      isNew = false;
    await this.ctx.storage.transaction(async (tx) => {
      isNew = false; // A storage conflict can re-run this callback.
      const old = await tx.get("request:" + owner + ":" + input.idempotencyKey);
      if (old) {
        job = await tx.get("job:" + old);
        return;
      }
      const active = await tx.get("active:" + owner);
      if (active) {
        const a = await tx.get("job:" + active);
        if (a && !this.terminal(a.status) && Date.now() - a.createdAt < 1200000)
          throw Object.assign(
            new Error("Your previous image is still processing."),
            { status: 409 },
          );
      }
      const used = (await tx.get("reservedCents")) || 0,
        configured = Number(this.env.MOSS_BUDGET_CENTS || 0);
      const limit = Number.isFinite(configured)
        ? Math.min(500, Math.max(0, Math.floor(configured)))
        : 0;
      const reserve = 50;
      if (used + reserve > limit)
        throw Object.assign(
          new Error(
            "Best quality is used up for now. Try another style.",
          ),
          { status: 429 },
        );
      // With a daily GPU budget configured, MOSS also counts against it (settled to the real cost later).
      const day = utcDay(),
        dayKey = "day:" + day;
      const dayUsed = (await tx.get(dayKey)) || 0;
      if (!g.valid)
        throw Object.assign(new Error("This isn't available right now. Try again later."), { status: 503 });
      if (g.daily > 0 && dayUsed + reserve > g.daily)
        throw Object.assign(
          new Error("Today's free images are used up. Come back tomorrow."),
          { status: 429 },
        );
      job = {
        id: crypto.randomUUID(),
        owner,
        input,
        fingerprint,
        status: "SUBMITTING",
        createdAt: Date.now(),
        reservedCents: reserve,
        day: g.daily > 0 ? day : undefined,
      };
      await tx.put({
        ...(g.daily > 0 ? { [dayKey]: dayUsed + reserve } : {}),
        reservedCents: used + reserve,
        ["job:" + job.id]: job,
        ["request:" + owner + ":" + input.idempotencyKey]: job.id,
        ["active:" + owner]: job.id,
      });
      isNew = true;
    });
    if (job.fingerprint !== fingerprint)
      return reply(
        {
          error:
            "This request identifier was already used for a different image.",
        },
        409,
      );
    if (!isNew) return reply(this.publicJob(job), 202);
    try {
      const result = await this.provider("/run", {
        method: "POST",
        body: JSON.stringify({
          input: {
            model: input.model,
            prompt: input.prompt,
            width: input.width,
            height: input.height,
            seed: input.seed,
          },
          policy: { executionTimeout: 600000, ttl: 1200000 },
        }),
      });
      if (!result.id) throw new Error("Missing provider identifier");
      job.providerId = result.id;
      job.status = result.status || "IN_QUEUE";
    } catch {
      job.status = "SUBMISSION_UNKNOWN";
      job.error =
        "Couldn't start this one. Try again.";
    }
    await this.ctx.storage.put("job:" + job.id, job);
    return reply(this.publicJob(job), 202);
  }
}
