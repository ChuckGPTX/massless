// Text to video, front and centre on /video: one prompt bar above the studio. It is always visible.
// Signed in, "Fast" renders on the members model (promoVideo) and "Best quality" on the GPU worker (animate job).
// Signed out, the prompt is kept and the visitor is sent to sign in, then brought back here.
import { accessToken, cloudConfig, gpuBudget, gpuJob, promoBudget, promoVideoJob, session } from "./cloud.js";

const KEEP = "chucksi.video-prompt";
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) k === "text" ? (e.textContent = v) : e.setAttribute(k, v === true ? "" : v);
  e.append(...kids);
  return e;
};
const IDEAS = [
  "A fox trotting through fresh snow at sunrise",
  "A paper boat drifting down a rainy street at dusk",
  "Cream swirling into a glass of iced coffee",
  "A red balloon rising over city rooftops",
  "A slow walk through a sunlit greenhouse",
];
const store = {
  get: () => { try { return localStorage.getItem(KEEP) || ""; } catch { return ""; } },
  set: (v) => { try { v ? localStorage.setItem(KEEP, v) : localStorage.removeItem(KEEP); } catch { /* private mode */ } },
};

async function mount(el) {
  const c = await cloudConfig();
  const engines = [];
  if (c.promoVideo?.on) engines.push({ id: "free", label: "Fast · 5 s", hint: "Ready in about a minute." });
  if (c.gpu?.on) engines.push({ id: "gpu", label: "Best quality · 5 s", hint: "Takes a few minutes." });

  const prompt = h("textarea", { id: "vp-prompt", rows: "2", maxlength: "1200", placeholder: IDEAS[0], "aria-label": "Describe your video" });
  prompt.value = store.get();
  const engine = h("select", { id: "vp-engine", "aria-label": "Quality" }, ...engines.map((e) => h("option", { value: e.id, text: e.label })));
  const shape = h("select", { id: "vp-shape", "aria-label": "Shape" }, h("option", { value: "16:9", text: "16:9" }), h("option", { value: "9:16", text: "9:16" }), h("option", { value: "1:1", text: "1:1" }));
  const go = h("button", { type: "submit", class: "btn-accent vp-go" }, "Generate video");
  const idea = h("button", { type: "button", class: "btn-ghost", text: "Surprise me" });
  const stop = h("button", { type: "button", class: "btn-ghost", text: "Cancel", hidden: true });
  const status = h("p", { class: "vp-status", role: "status", "aria-live": "polite" });
  const out = h("div", { class: "vp-result", hidden: true });
  const form = h("form", { class: "vp-form" },
    h("div", { class: "vp-head" }, h("span", { class: "vp-kicker", text: "Text to video" }), h("span", { class: "vp-hint", id: "vp-hint" })),
    h("div", { class: "vp-row" }, prompt, h("div", { class: "vp-actions" }, go, stop)),
    h("div", { class: "vp-row vp-opts" }, engines.length ? engine : "", shape, idea));
  el.replaceChildren(form, status, out);
  el.hidden = false;

  const hint = form.querySelector("#vp-hint");
  const sync = () => {
    const e = engines.find((x) => x.id === engine.value);
    hint.textContent = e ? e.hint : "";
    shape.hidden = engine.value === "free"; // the free model makes widescreen clips only
  };
  engine.addEventListener("change", () => { sync(); showLeft(); });
  prompt.addEventListener("input", () => store.set(prompt.value));
  idea.addEventListener("click", () => { prompt.value = IDEAS[Math.floor(Math.random() * IDEAS.length)]; store.set(prompt.value); prompt.focus(); });

  const left = {};
  const showLeft = () => {
    if (!session() || !engines.length) return;
    const n = left[engine.value];
    status.textContent = Number.isFinite(n) ? `${n} left today` : "";
  };
  const refresh = async () => {
    sync();
    if (!engines.length) { go.disabled = true; status.textContent = "Coming soon. Try a camera move below."; return; }
    if (!session()) { go.disabled = false; go.textContent = "Generate video"; status.replaceChildren(h("a", { href: "/projects/#account", text: "Sign in" }), " to create. It’s free."); return; }
    const [p, g] = await Promise.all([engines.some((e) => e.id === "free") ? promoBudget() : null, engines.some((e) => e.id === "gpu") ? gpuBudget() : null].map((x) => Promise.resolve(x).catch(() => null)));
    left.free = p && p.on && p.signedIn && !p.error ? p.clipsLeftForYou : undefined;
    left.gpu = g && g.on && g.signedIn && !g.error ? g.jobsLeftForYou : undefined;
    showLeft();
  };

  let ctl;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = prompt.value.trim();
    if (text.length < 3) { status.textContent = "Describe your video first."; prompt.focus(); return; }
    store.set(text);
    if (!session()) {
      try { sessionStorage.setItem("chucksi.after-signin", "/video"); } catch { /* fine */ }
      location.href = "/projects/#account";
      return;
    }
    ctl = new AbortController();
    go.disabled = true;
    stop.hidden = false;
    out.hidden = true;
    try {
      await accessToken();
      status.textContent = "Creating…";
      let blob;
      if (engine.value === "free") {
        blob = (await promoVideoJob({ prompt: text, duration: 5, resolution: "480p", signal: ctl.signal, onProgress: (m) => (status.textContent = m) })).blob;
      } else {
        blob = (await gpuJob({ job: "animate", input: { prompt: text, mode: "quick", resolution: "480p", aspect: shape.value }, signal: ctl.signal, onProgress: (p) => (status.textContent = p.message) })).blob;
      }
      const url = URL.createObjectURL(blob);
      out.replaceChildren(
        h("video", { src: url, controls: true, autoplay: true, loop: true, muted: true, playsinline: true }),
        h("div", { class: "vp-result-actions" }, h("a", { href: url, download: "chucksi-video.mp4", class: "btn-ghost", text: "Download" }), h("a", { href: "/cut/", class: "btn-ghost", text: "Caption & trim ↗" })),
      );
      out.hidden = false;
      status.textContent = "Ready. Saved to My library.";
      import("./assets.js").then(({ saveAsset }) => saveAsset(blob, { name: "chucksi-video.mp4", engine: engine.value === "free" ? "mischief-1" : "wan-2.2", settings: { prompt: text } })).catch(() => (status.textContent = "Ready. Download it before leaving; it couldn't be saved to your library."));
      store.set("");
    } catch (err) {
      status.textContent = err.name === "AbortError" ? "Stopped. If it had already started, it still counts toward today's videos." : err.message || "Couldn't create the video. Try again.";
    } finally {
      stop.hidden = true;
      go.disabled = false;
      if (status.textContent.startsWith("Ready")) return;
      refresh();
    }
  });
  stop.addEventListener("click", () => ctl?.abort());
  window.addEventListener("massless-session", refresh);
  await refresh();
}
for (const el of document.querySelectorAll("[data-video-prompt]")) mount(el);
