// Optional cloud projects. Local libraries are never uploaded automatically.
let configPromise;
let refreshPromise;
const SESSION_KEY = "massless.cloud-session";
export const cloudConfig = () =>
  (configPromise ||= fetch("/api/config")
    .then((r) => (r.ok ? r.json() : { cloud: false, models: {} }))
    .catch(() => ({ cloud: false, models: {} })));
export function session() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}
function saveSession(s) {
  if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_KEY);
  window.dispatchEvent(new Event("massless-session"));
}
async function auth(path, body) {
  const c = await cloudConfig();
  if (!c.cloud)
    throw new Error(
      "Cloud projects are being connected. Your local tools are ready.",
    );
  const r = await fetch(c.supabaseUrl + "/auth/v1/" + path, {
    method: "POST",
    headers: { apikey: c.publishableKey, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok)
    throw new Error(
      j.msg || j.error_description || j.message || "Sign-in failed.",
    );
  return j;
}
export async function signIn(email, password) {
  const s = await auth("token?grant_type=password", { email, password });
  saveSession({
    ...s,
    expires_at: Math.floor(Date.now() / 1000) + s.expires_in,
  });
  return s;
}
export async function signUp(email, password) {
  // the confirmation email links back to this site's Projects page
  const j = await auth(`signup?redirect_to=${encodeURIComponent(location.origin + "/projects/")}`, { email, password });
  if (j.access_token)
    saveSession({
      ...j,
      expires_at: Math.floor(Date.now() / 1000) + j.expires_in,
    });
  return j;
}
export async function accessToken() {
  let s = session();
  if (!s)
    throw new Error("Sign in to save a project or use the connected model.");
  if (s.expires_at < Date.now() / 1000 + 60) {
    refreshPromise ||= auth("token?grant_type=refresh_token", {
      refresh_token: s.refresh_token,
    })
      .then((next) => {
        const fresh = {
          ...next,
          expires_at: Math.floor(Date.now() / 1000) + next.expires_in,
        };
        saveSession(fresh);
        return fresh;
      })
      .catch((e) => {
        saveSession(null);
        throw e;
      })
      .finally(() => {
        refreshPromise = null;
      });
    s = await refreshPromise;
  }
  return s.access_token;
}
export async function signOut() {
  const c = await cloudConfig();
  let s = session();
  saveSession(null);
  if (s)
    await fetch(c.supabaseUrl + "/auth/v1/logout?scope=local", {
      method: "POST",
      headers: {
        apikey: c.publishableKey,
        Authorization: "Bearer " + s.access_token,
      },
    }).catch(() => {});
}
export async function cloudRequest(path, options = {}) {
  const c = await cloudConfig();
  const token = await accessToken();
  const r = await fetch(c.supabaseUrl + path, {
    ...options,
    headers: {
      apikey: c.publishableKey,
      Authorization: "Bearer " + token,
      ...options.headers,
    },
  });
  if (!r.ok) {
    let j = await r.json().catch(() => ({}));
    throw new Error(j.message || j.error || "The cloud request failed.");
  }
  return r.status === 204 ? null : r.json();
}
export const projects = () =>
  cloudRequest("/rest/v1/massless_projects?select=*&order=created_at.desc");
export const createProject = (name) =>
  cloudRequest("/rest/v1/massless_projects", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ name }),
  });
export const assets = (id) =>
  cloudRequest(
    "/rest/v1/massless_assets?select=*&project_id=eq." +
      encodeURIComponent(id) +
      "&order=created_at.desc",
  );
export async function uploadAsset(projectId, file, metadata = {}) {
  if (file.size > 30 * 1024 * 1024)
    throw new Error("Choose a file smaller than 30 MB.");
  const uid = session()?.user?.id;
  if (!uid) throw new Error("Sign in first.");
  const kind = file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("audio/")
      ? "audio"
      : file.type.startsWith("video/")
        ? "video"
        : file.type === "application/pdf"
          ? "document"
          : "workflow";
  const ext = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/mp4": "m4a",
    "video/mp4": "mp4",
    "application/pdf": "pdf",
    "application/json": "json",
  }[file.type];
  if (!ext)
    throw new Error(
      "Choose JPG, PNG, WebP, MP3, WAV, M4A, MP4, PDF or workflow JSON.",
    );
  const object_path = uid + "/" + crypto.randomUUID() + "." + ext;
  await cloudRequest("/storage/v1/object/massless-private/" + object_path, {
    method: "POST",
    headers: { "content-type": file.type },
    body: file,
  });
  try {
    return await cloudRequest("/rest/v1/massless_assets", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        project_id: projectId,
        name: file.name.slice(0, 200),
        object_path,
        kind,
        metadata,
      }),
    });
  } catch (e) {
    await cloudRequest("/storage/v1/object/massless-private", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefixes: [object_path] }),
    }).catch(() => {});
    throw e;
  }
}
export async function assetURL(path) {
  const c = await cloudConfig();
  const j = await cloudRequest(
    "/storage/v1/object/sign/massless-private/" + path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: 300 }),
    },
  );
  return c.supabaseUrl + "/storage/v1" + (j.signedURL || j.signedUrl);
}
export async function hostedImage({
  model,
  prompt,
  w,
  h,
  seed,
  signal,
  onWait,
}) {
  const token = await accessToken();
  const idempotencyKey = crypto.randomUUID();
  let r = await fetch("/api/generations", {
    method: "POST",
    signal,
    headers: {
      Authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      width: w,
      height: h,
      seed,
      idempotencyKey,
    }),
  });
  let j = await r.json();
  if (!r.ok) throw new Error(j.error || "Generation could not start.");
  const id = j.id,
    deadline = Date.now() + 22 * 60 * 1000;
  const cancel = () =>
    fetch("/api/generations/" + id + "/cancel", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    }).catch(() => {});
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (
      ![
        "COMPLETED",
        "FAILED",
        "CANCELLED",
        "TIMED_OUT",
        "SUBMISSION_UNKNOWN",
      ].includes(j.status)
    ) {
      if (signal?.aborted) throw new Error("Cancelled");
      if (Date.now() > deadline) {
        await cancel();
        throw new Error("This image took too long. Please try another model.");
      }
      onWait?.(0, j.status);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      r = await fetch("/api/generations/" + id, {
        signal,
        headers: { Authorization: "Bearer " + (await accessToken()) },
      });
      j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not check the generation.");
    }
    if (j.status !== "COMPLETED")
      throw new Error(j.error || "Generation " + j.status.toLowerCase() + ".");
    const imageResponse = await fetch("/api/generations/" + id + "/image", {
      signal,
      headers: { Authorization: "Bearer " + (await accessToken()) },
    });
    if (!imageResponse.ok)
      throw new Error("The completed image could not be downloaded.");
    const blob = await imageResponse.blob();
    const image = await createImageBitmap(blob);
    return { image, engine: "hosted", model, jobId: id };
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
export const workflowRuns = (id) =>
  cloudRequest(
    "/rest/v1/massless_workflow_runs?select=*&project_id=eq." +
      encodeURIComponent(id) +
      "&order=updated_at.desc",
  );
export const workflowRun = (id) =>
  cloudRequest(
    "/rest/v1/massless_workflow_runs?select=*&id=eq." +
      encodeURIComponent(id) +
      "&limit=1",
  );

// ---- GPU worker jobs (Animate, Music, Upscale; Lab jobs when the site enables them) ----
// Signed-in users only; the Worker's ledger enforces one daily budget and a per-user daily limit.
export async function gpuBudget() {
  const c = await cloudConfig();
  if (!c.gpu?.on) return { on: false };
  if (!session()) return { on: true, signedIn: false };
  const r = await fetch("/api/generations/budget", {
    headers: { Authorization: "Bearer " + (await accessToken()) },
  });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ...j, signedIn: true } : { on: true, signedIn: r.status !== 401, error: j.error };
}
/** Run one GPU job; resolves { blob, audio?, output, costCents }. onProgress({ status, message, percent }). */
export async function gpuJob({ job, input, lab = false, signal, onProgress }) {
  const token = await accessToken();
  let r = await fetch("/api/generations", {
    method: "POST",
    signal,
    headers: { Authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify({ job, input, ...(lab ? { lab: true } : {}), idempotencyKey: crypto.randomUUID() }),
  });
  let j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "The GPU job could not start."), { status: r.status, budget: !!j.budget });
  const id = j.id,
    deadline = Date.now() + (j.timeoutSec || 1500) * 1000,
    auth = async () => ({ Authorization: "Bearer " + (await accessToken()) });
  const cancel = async () => fetch("/api/generations/" + id + "/cancel", { method: "POST", headers: await auth() }).catch(() => {});
  signal?.addEventListener("abort", cancel, { once: true });
  let delay = 2000;
  try {
    while (!["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT", "SUBMISSION_UNKNOWN"].includes(j.status)) {
      onProgress?.({ status: j.status, message: j.message || (j.status === "IN_QUEUE" ? "Waiting for the GPU…" : "Starting…"), percent: j.percent ?? null });
      if (Date.now() > deadline) {
        await cancel();
        throw new Error("The GPU job took too long and was stopped.");
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      delay = j.status === "IN_PROGRESS" ? 2500 : Math.min(8000, delay * 1.4);
      r = await fetch("/api/generations/" + id, { signal, headers: await auth() });
      j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not check the GPU job.");
    }
    if (j.status !== "COMPLETED") throw new Error(j.error || "The GPU job " + j.status.toLowerCase().replace("_", " ") + ".");
    onProgress?.({ status: "COMPLETED", message: "Done", percent: 100 });
    const get = async (part) => {
      const f = await fetch("/api/generations/" + id + "/" + part, { signal, headers: await auth() });
      if (!f.ok) throw new Error("The result could not be downloaded.");
      return f.blob();
    };
    return { blob: await get("file"), audio: j.output?.audio ? await get("audio") : undefined, output: j.output, costCents: j.costCents, id };
  } finally {
    signal?.removeEventListener("abort", cancel);
    window.dispatchEvent(new Event("massless-gpu"));
  }
}
