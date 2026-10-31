// Hosted generation boundary. Credentials and the budget ledger never reach the browser.
const reply = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
export function generationConfig(env) {
  return {
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
export async function generationAPI(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/config") return reply(generationConfig(env));
  if (!env.GENERATION_LEDGER || !env.MOSS_ENDPOINT_ID || !env.RUNPOD_API_KEY)
    return reply(
      {
        error:
          "MOSS Image is being connected. The other image models are ready.",
      },
      503,
    );
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
    return reply({ error: "Cloud sign-in is being connected." }, 503);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin)
    return reply({ error: "Cross-site requests are not allowed." }, 403);
  const bearer = request.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(bearer))
    return reply({ error: "Sign in to use MOSS Image." }, 401);
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
  return env.GENERATION_LEDGER.get(
    env.GENERATION_LEDGER.idFromName("moss-development-v1"),
  ).fetch(new Request(request, { headers }));
}
export class GenerationLedger {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
  async provider(path, options = {}) {
    const r = await fetch(
      "https://api.runpod.ai/v2/" + this.env.MOSS_ENDPOINT_ID + path,
      {
        ...options,
        headers: {
          Authorization: "Bearer " + this.env.RUNPOD_API_KEY,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!r.ok) throw new Error("The image service is unavailable.");
    return r.json();
  }
  async fetch(request) {
    const url = new URL(request.url),
      owner = request.headers.get("x-owner-id");
    if (!owner) return reply({ error: "Unauthorized" }, 401);
    try {
      if (url.pathname === "/api/generations" && request.method === "POST")
        return await this.submit(request, owner);
      const match = url.pathname.match(
        /^\/api\/generations\/([0-9a-f-]{36})(\/(?:image|cancel))?$/,
      );
      if (!match) return reply({ error: "Not found" }, 404);
      const key = "job:" + match[1];
      let job = await this.ctx.storage.get(key);
      if (!job || job.owner !== owner)
        return reply({ error: "Not found" }, 404);
      if (match[2] === "/cancel" && request.method === "POST") {
        if (job.providerId && !this.terminal(job.status)) {
          await this.provider("/cancel/" + encodeURIComponent(job.providerId), {
            method: "POST",
          });
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
        );
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
        { error: e.message || "Generation request failed." },
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
    return {
      id: j.id,
      status: j.status,
      model: j.input.model,
      seed: j.input.seed,
      error: j.error,
      createdAt: j.createdAt,
    };
  }
  async submit(request, owner) {
    let input;
    try {
      input = validateGeneration(await request.json());
    } catch (e) {
      return reply({ error: e.message }, 400);
    }
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
            "The MOSS preview allowance has been used. Other image models are available.",
          ),
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
      };
      await tx.put({
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
        "Submission could not be confirmed. It will not be automatically repeated.";
    }
    await this.ctx.storage.put("job:" + job.id, job);
    return reply(this.publicJob(job), 202);
  }
}
