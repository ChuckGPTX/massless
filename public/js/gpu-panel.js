// Hosted GPU panels: <div data-gpu-panel="animate|music"></div> on a page, plus this module.
// Animate turns a still into a 5 s clip (Wan 2.2 TI2V-5B); Music writes a track (ACE-Step 1.5). Both run on the
// Massless GPU worker for signed-in users, inside one daily budget shown honestly above the button.
import { accessToken, gpuBudget, gpuJob } from "./cloud.js";

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) k === "text" ? (e.textContent = v) : e.setAttribute(k, v === true ? "" : v);
  e.append(...kids);
  return e;
};
async function jpegBase64(file, maxSide = 1536) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = h("canvas", { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  for (const q of [0.9, 0.8, 0.7]) {
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", q));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    if (bin.length * 4 / 3 < 9e6) return btoa(bin);
  }
  throw new Error("That image is too large to send.");
}
const KIND = {
  animate: {
    title: "Animate on the GPU",
    note: "Wan 2.2 TI2V-5B (Apache-2.0): your still becomes a 5-second clip with real motion in the scene.",
    fields: () => [
      h("label", {}, "Still ", h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", name: "image", required: true })),
      h("label", {}, "What moves ", h("input", { name: "prompt", maxlength: "1200", placeholder: "the sea breathes, hair moves in the wind" })),
      h("label", {}, "Size ", h("select", { name: "resolution" }, h("option", { value: "480p", text: "480p (faster)" }), h("option", { value: "720p", text: "720p" }))),
      h("label", {}, "Shape ", h("select", { name: "aspect" }, ...["16:9", "9:16", "1:1"].map((a) => h("option", { value: a, text: a })))),
    ],
    async input(f) {
      const file = f.image.files[0];
      if (!file) throw new Error("Choose a still first.");
      return { image: await jpegBase64(file), prompt: f.prompt.value.trim() || undefined, resolution: f.resolution.value, aspect: f.aspect.value };
    },
    show: (blob) => h("video", { src: URL.createObjectURL(blob), controls: true, loop: true, playsinline: true, autoplay: true, muted: true }),
    file: "massless-animate.mp4",
  },
  music: {
    title: "Compose on the GPU",
    note: "ACE-Step 1.5 (MIT; generated music may be used commercially): style tags, optional lyrics, up to 3 minutes.",
    fields: () => [
      h("label", {}, "Style ", h("input", { name: "tags", maxlength: "600", required: true, placeholder: "warm lo-fi hip hop, mellow piano, vinyl crackle" })),
      h("label", {}, "Lyrics (optional) ", h("textarea", { name: "lyrics", maxlength: "4000", rows: "3", placeholder: "[verse]\n…" })),
      h("label", {}, "Seconds ", h("input", { name: "duration", type: "number", min: "10", max: "180", value: "30" })),
      h("label", {}, "BPM ", h("input", { name: "bpm", type: "number", min: "40", max: "220", value: "100" })),
    ],
    async input(f) {
      return { tags: f.tags.value.trim(), lyrics: f.lyrics.value.trim() || undefined, duration: Number(f.duration.value), bpm: Number(f.bpm.value) };
    },
    show: (blob) => h("audio", { src: URL.createObjectURL(blob), controls: true }),
    file: "massless-music.mp3",
  },
};
function money(c) {
  return "$" + (c / 100).toFixed(2);
}
async function mount(el) {
  const k = KIND[el.dataset.gpuPanel];
  if (!k) return;
  const status = h("p", { class: "gpu-status", role: "status", "aria-live": "polite" });
  const meter = h("p", { class: "gpu-meter" });
  const form = h("form", { class: "gpu-form" }, ...k.fields());
  const go = h("button", { type: "submit", class: "btn-accent", text: "Render on the GPU" });
  const stop = h("button", { type: "button", class: "btn-ghost", text: "Cancel", hidden: true });
  const out = h("div", { class: "gpu-result" });
  form.append(go, stop);
  el.replaceChildren(h("h3", { text: k.title }), h("p", { class: "gpu-note", text: k.note }), meter, form, status, out);
  el.hidden = true;
  const refresh = async () => {
    const b = await gpuBudget();
    el.hidden = !b.on;
    if (!b.on) return b;
    if (!b.signedIn) {
      meter.replaceChildren("Hosted GPU jobs are free for signed-in users, within a shared daily budget. ", h("a", { href: "/projects/", text: "Sign in" }), " to use them; the browser tools here need no account.");
      go.disabled = true;
      return b;
    }
    meter.textContent = b.error || `GPU budget left today: ${money(b.leftCents)} of ${money(b.dailyBudgetCents)} · ${b.jobsLeftForYou} of your ${b.perUserDaily} daily jobs left` + (b.queue ? ` · ${b.queue} job${b.queue === 1 ? "" : "s"} ahead of you` : "") + " · resets at midnight UTC";
    go.disabled = !b.jobsLeftForYou;
    return b;
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
      const input = await k.input(form.elements);
      status.textContent = "Sending…";
      const r = await gpuJob({ job: el.dataset.gpuPanel, input, signal: ctl.signal, onProgress: (p) => (status.textContent = p.message + (Number.isFinite(p.percent) ? ` (${p.percent}%)` : "")) });
      const a = h("a", { href: URL.createObjectURL(r.blob), download: k.file, class: "btn-ghost", text: "Download" });
      out.replaceChildren(k.show(r.blob), a);
      status.textContent = `Done in ${r.output?.seconds ?? "?"} s on the GPU` + (Number.isFinite(r.costCents) ? `, ${money(r.costCents)} of today's budget.` : ".");
    } catch (err) {
      status.textContent = err.name === "AbortError" ? "Cancelled." : err.message;
    } finally {
      stop.hidden = true;
      await refresh();
    }
  });
  stop.addEventListener("click", () => ctl?.abort());
  window.addEventListener("massless-session", refresh);
  await refresh();
}
for (const el of document.querySelectorAll("[data-gpu-panel]")) mount(el);
