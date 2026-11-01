// Text to video, front and centre on /video: one prompt bar above the studio. It is always visible.
// Signed in, it renders on the free members model (mischief-1 on OpenRouter) when that's on, or on the Chucksi GPU
// (Wan 2.2, from text). Signed out, the prompt is kept and the visitor is sent to sign in, then brought back here.
import { accessToken, cloudConfig, gpuBudget, gpuJob, promoBudget, promoVideoJob, session } from "./cloud.js";

const KEEP = "chucksi.video-prompt";
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) k === "text" ? (e.textContent = v) : e.setAttribute(k, v === true ? "" : v);
  e.append(...kids);
  return e;
};
const IDEAS = [
  "A paper boat drifting down a rain-soaked city street at dusk, neon reflections, slow tracking shot",
  "Macro shot of coffee poured into a glass cup, cream swirling, soft morning window light",
  "A red balloon rising past brick rooftops into a pastel sky, gentle camera tilt up",
  "Slow dolly through a sunlit greenhouse full of ferns, floating dust, cinematic",
  "A fox trotting through fresh snow in a birch forest, low angle, golden hour",
];
const store = {
  get: () => { try { return localStorage.getItem(KEEP) || ""; } catch { return ""; } },
  set: (v) => { try { v ? localStorage.setItem(KEEP, v) : localStorage.removeItem(KEEP); } catch { /* private mode */ } },
};

async function mount(el) {
  const c = await cloudConfig();
  const engines = [];
  if (c.promoVideo?.on) engines.push({ id: "free", label: "Free clip · mischief-1 · 5 s", hint: "Fast. Free for members while the promo lasts." });
  if (c.gpu?.on) engines.push({ id: "gpu", label: "Best quality · Wan 2.2 · 5 s", hint: "Our 80 GB GPU. About 2–4 minutes (longer if it has to wake up)." });

  const prompt = h("textarea", { id: "vp-prompt", rows: "2", maxlength: "1200", placeholder: IDEAS[0], "aria-label": "Describe your video" });
  prompt.value = store.get();
  const engine = h("select", { id: "vp-engine", "aria-label": "Video model" }, ...engines.map((e) => h("option", { value: e.id, text: e.label })));
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
    hint.textContent = e ? e.hint : "Video models are being connected.";
    shape.hidden = engine.value === "free"; // the free model makes widescreen clips only
  };
  engine.addEventListener("change", sync);
  prompt.addEventListener("input", () => store.set(prompt.value));
  idea.addEventListener("click", () => { prompt.value = IDEAS[Math.floor(Math.random() * IDEAS.length)]; store.set(prompt.value); prompt.focus(); });

  const refresh = async () => {
    sync();
    if (!engines.length) { go.disabled = true; status.textContent = "Text to video is being connected. The camera moves below work right now."; return; }
    if (!session()) { go.disabled = false; go.textContent = "Generate video"; status.replaceChildren("Free with an account. ", h("a", { href: "/projects/#account", text: "Sign in" }), " and you'll come straight back here with your prompt."); return; }
    const [p, g] = await Promise.all([engines.some((e) => e.id === "free") ? promoBudget() : null, engines.some((e) => e.id === "gpu") ? gpuBudget() : null].map((x) => Promise.resolve(x).catch(() => null)));
    const free = p && p.on && p.signedIn ? `${p.clipsLeftForYou} free clips left today` : "";
    const gpu = g && g.on && g.signedIn && !g.error ? `${g.jobsLeftForYou} GPU videos left today` : "";
    status.textContent = [free, gpu].filter(Boolean).join(" · ");
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
      status.textContent = "Sending…";
      let blob;
      if (engine.value === "free") {
        blob = (await promoVideoJob({ prompt: text, duration: 5, resolution: "480p", signal: ctl.signal, onProgress: (m) => (status.textContent = m) })).blob;
      } else {
        blob = (await gpuJob({ job: "animate", input: { prompt: text, mode: "quick", resolution: "480p", aspect: shape.value }, signal: ctl.signal, onProgress: (p) => (status.textContent = p.message + (Number.isFinite(p.percent) ? ` (${p.percent}%)` : "")) })).blob;
      }
      const url = URL.createObjectURL(blob);
      out.replaceChildren(
        h("video", { src: url, controls: true, autoplay: true, loop: true, muted: true, playsinline: true }),
        h("div", { class: "vp-result-actions" }, h("a", { href: url, download: "chucksi-video.mp4", class: "btn-ghost", text: "Download" }), h("a", { href: "/cut/", class: "btn-ghost", text: "Caption & trim ↗" })),
      );
      out.hidden = false;
      status.textContent = "Done. Saved to My library.";
      import("./assets.js").then(({ saveAsset }) => saveAsset(blob, { name: "chucksi-video.mp4", engine: engine.value === "free" ? "mischief-1" : "wan-2.2", settings: { prompt: text } })).catch(() => (status.textContent = "Done. Download it before leaving; it couldn't be saved to your library."));
      store.set("");
    } catch (err) {
      status.textContent = err.name === "AbortError" ? "Stopped waiting. If it had started, it still counts toward today's videos." : err.message;
    } finally {
      stop.hidden = true;
      go.disabled = false;
      if (status.textContent.startsWith("Done")) return;
      refresh();
    }
  });
  stop.addEventListener("click", () => ctl?.abort());
  window.addEventListener("massless-session", refresh);
  await refresh();
}
for (const el of document.querySelectorAll("[data-video-prompt]")) mount(el);
