// "Free for members" video: a fast text/image-to-video model on OpenRouter (tbc/mischief-1 by default), free for
// signed-in users within a daily allowance and a hard overall budget. Mounts on <section data-promo-video>.
import { accessToken, promoBudget, promoVideoJob } from "./cloud.js";

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) k === "text" ? (e.textContent = v) : e.setAttribute(k, v === true ? "" : v);
  e.append(...kids);
  return e;
};
const IDEAS = [
  "A paper boat drifting down a rain-soaked city gutter at dusk, neon reflections, slow tracking shot",
  "Macro shot of coffee being poured into a glass cup, swirling cream, morning window light",
  "A red balloon rising past brick rooftops into a pastel sky, gentle camera tilt up",
  "Slow dolly through a sunlit greenhouse full of ferns, floating dust, cinematic",
];
// A start frame, sized down to a JPEG data URL the server accepts (under ~3 MB).
async function frameDataURL(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const s = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = h("canvas", { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL("image/jpeg", 0.88);
}
async function mount(el) {
  const status = h("p", { class: "gpu-status", role: "status", "aria-live": "polite" });
  const meter = h("p", { class: "gpu-meter" });
  const out = h("div", { class: "gpu-result" });
  const prompt = h("textarea", { name: "prompt", rows: "3", maxlength: "2000", required: true, placeholder: IDEAS[0], "aria-label": "Describe the clip" });
  const duration = h("select", { name: "duration", "aria-label": "Length" }, h("option", { value: "5", text: "5 seconds" }), h("option", { value: "3", text: "3 seconds" }));
  const resolution = h("select", { name: "resolution", "aria-label": "Quality" }, h("option", { value: "480p", text: "480p (faster)" }), h("option", { value: "720p", text: "720p" }));
  const still = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", "aria-label": "Optional start frame" });
  const idea = h("button", { type: "button", class: "btn-ghost", text: "Surprise me" });
  const go = h("button", { type: "submit", class: "btn-accent", text: "Make a free clip" });
  const stop = h("button", { type: "button", class: "btn-ghost", text: "Cancel", hidden: true });
  const form = h("form", { class: "gpu-form" },
    h("label", {}, "Describe the clip", prompt),
    h("div", { class: "promo-row" }, h("label", {}, "Length", duration), h("label", {}, "Quality", resolution)),
    h("label", {}, "Start frame (optional)", still),
    h("div", { class: "promo-row" }, go, idea, stop));
  el.replaceChildren(
    h("h3", {}, "Free for members ", h("small", { class: "studio-badge", text: "NEW" })),
    h("p", { class: "gpu-note", text: "A fast text-to-video model (mischief-1 on OpenRouter), widescreen, 3 or 5 seconds. Free while the promo lasts for anyone with an account. Prompts and start frames are sent to OpenRouter to make the clip." }),
    meter, form, status, out,
  );
  idea.addEventListener("click", () => { prompt.value = IDEAS[Math.floor(Math.random() * IDEAS.length)]; prompt.focus(); });
  const refresh = async () => {
    const b = await promoBudget().catch(() => ({ on: false }));
    el.hidden = !b.on;
    if (!b.on) return;
    if (!b.signedIn) {
      meter.replaceChildren(`Members get ${b.perUserDaily} free clips a day. `, h("a", { href: "/projects/#account", text: "Sign in or create a free account" }), " to start.");
      go.disabled = true;
      return;
    }
    if (b.error) { meter.textContent = b.error; go.disabled = true; return; }
    meter.textContent = b.budgetLeft === "none"
      ? "The free promo allowance has been used up. Thanks for testing it!"
      : `${b.clipsLeftForYou} of your ${b.perUserDaily} free clips left today · resets at midnight UTC` + (b.budgetLeft === "low" ? " · the promo is almost used up" : "");
    go.disabled = !b.clipsLeftForYou;
  };
  let ctl;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    ctl = new AbortController();
    go.disabled = true;
    stop.hidden = false;
    out.replaceChildren();
    try {
      await accessToken();
      const image = still.files[0] ? await frameDataURL(still.files[0]) : undefined;
      status.textContent = "Sending…";
      const r = await promoVideoJob({ prompt: prompt.value, duration: Number(duration.value), resolution: resolution.value, image, signal: ctl.signal, onProgress: (m) => (status.textContent = m) });
      const url = URL.createObjectURL(r.blob);
      out.replaceChildren(h("video", { src: url, controls: true, autoplay: true, loop: true, muted: true, playsinline: true }), h("a", { href: url, download: "chucksi-clip.mp4", class: "btn-ghost", text: "Download" }));
      status.textContent = "Done. Saved to My library.";
      import("./assets.js").then(({ saveAsset }) => saveAsset(r.blob, { name: "chucksi-clip.mp4", engine: "mischief-1", settings: { prompt: prompt.value, duration: Number(duration.value), resolution: resolution.value } })).catch(() => (status.textContent = "Done. Download it before leaving; it couldn't be saved to your library."));
    } catch (err) {
      status.textContent = err.name === "AbortError" ? "Stopped waiting. If it was already rendering, it still counts toward today's clips." : err.message;
    } finally {
      stop.hidden = true;
      await refresh();
    }
  });
  stop.addEventListener("click", () => ctl?.abort());
  window.addEventListener("massless-session", refresh);
  await refresh();
}
for (const el of document.querySelectorAll("[data-promo-video]")) mount(el);
