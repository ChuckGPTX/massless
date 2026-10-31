// Hosted GPU panels: <section data-gpu-panel="animate|music"></section> on a page, plus this module.
// The Video panel has four modes on the Chucksi GPU worker (80 GB GPU): Animate (Wan 2.2 A14B, from a still or
// from text, Quick or Best), Motion (Wan-Animate-2: a still performs the motion of a driving clip), Lip sync
// (Wan 2.2 S2V: a face speaks an audio clip) and Upscale video (SeedVR2 7B). Music writes a track (ACE-Step 1.5).
// All run for signed-in users inside one daily budget, shown honestly with each job's expected cost.
import { accessToken, gpuBudget, gpuJob } from "./cloud.js";

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) k === "text" ? (e.textContent = v) : e.setAttribute(k, v === true ? "" : v);
  e.append(...kids);
  return e;
};
const MAX_CLIP_BYTES = 6_500_000; // with a still, under RunPod's 10 MB request limit as base64
const MAX_CLIP_SECONDS = 10;
function toBase64(buf) {
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}
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
    const b64 = toBase64(new Uint8Array(await blob.arrayBuffer()));
    if (b64.length < 2_500_000) return b64;
  }
  throw new Error("That image is too large to send.");
}
function mediaSeconds(file, tag) {
  return new Promise((resolve) => {
    const el = document.createElement(tag);
    const url = URL.createObjectURL(file);
    el.preload = "metadata";
    el.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(el.duration); };
    el.onerror = () => { URL.revokeObjectURL(url); resolve(NaN); };
    el.src = url;
  });
}
async function clipBase64(file, what, tag = "video") {
  if (!file) throw new Error(`Choose ${what} first.`);
  if (file.size > MAX_CLIP_BYTES) throw new Error(`That ${what} is ${(file.size / 1e6).toFixed(1)} MB; the limit is ${(MAX_CLIP_BYTES / 1e6).toFixed(1)} MB. Trim or compress it.`);
  const sec = await mediaSeconds(file, tag);
  if (sec > MAX_CLIP_SECONDS + 0.05) throw new Error(`That ${what} is ${sec.toFixed(1)} s long; the limit is ${MAX_CLIP_SECONDS} s. Trim it first.`);
  return toBase64(new Uint8Array(await file.arrayBuffer()));
}

// A still: from a file, or from the images saved in this browser's library (IndexedDB, js/store.js).
let library;
async function libraryImages() {
  if (!library) {
    library = import("./store.js")
      .then((s) => s.all())
      .then((items) => (items || []).filter((x) => x && x.blob instanceof Blob && /^image\//.test(x.blob.type)).sort((a, b) => (b.created || 0) - (a.created || 0)))
      .catch(() => []);
  }
  return library;
}
function stillPicker(name, label, required) {
  const file = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", name });
  const pick = h("select", { name: name + "_library", "aria-label": "Or pick from your library" }, h("option", { value: "", text: "or pick from your library…" }));
  libraryImages().then((items) => {
    for (const x of items.slice(0, 200)) {
      const when = x.created ? new Date(x.created).toLocaleDateString() : "";
      pick.append(h("option", { value: x.id, text: [x.title || x.prompt || x.name || "Image", when].filter(Boolean).join(" · ").slice(0, 80) }));
    }
    pick.hidden = !items.length;
  });
  pick.hidden = true;
  const wrap = h("label", {}, label + (required ? " " : " (optional) "), file, pick);
  wrap.read = async () => {
    if (file.files[0]) return jpegBase64(file.files[0]);
    if (pick.value) {
      const item = (await libraryImages()).find((x) => x.id === pick.value);
      if (item) return jpegBase64(item.blob);
    }
    if (required) throw new Error(`Choose ${label.toLowerCase()} first.`);
    return undefined;
  };
  return wrap;
}
const select = (name, label, options) => h("label", {}, label + " ", h("select", { name }, ...options.map(([v, t]) => h("option", { value: v, text: t }))));
const videoOut = (blob) => h("video", { src: URL.createObjectURL(blob), controls: true, loop: true, playsinline: true, autoplay: true, muted: true });

const VIDEO_MODES = {
  animate: {
    label: "Animate",
    note: "Wan 2.2 A14B (Apache-2.0): a still becomes a 5-second clip, or describe one from scratch. Quick uses the Wan2.2-Lightning 4-step LoRA; Best runs the full model.",
    fields() {
      this.still = stillPicker("image", "Still", false);
      return [
        this.still,
        h("label", {}, "What happens ", h("input", { name: "prompt", maxlength: "1200", placeholder: "the sea breathes, hair moves in the wind (required without a still)" })),
        select("mode", "Quality", [["quick", "Quick (4 steps)"], ["best", "Best (full steps, slower)"]]),
        select("resolution", "Size", [["480p", "480p"], ["720p", "720p"]]),
        select("aspect", "Shape", ["16:9", "9:16", "1:1"].map((a) => [a, a])),
      ];
    },
    preset: (f) => `animate:${f.mode.value}:${f.resolution.value}`,
    async input(f) {
      const image = await this.still.read();
      const prompt = f.prompt.value.trim() || undefined;
      if (!image && !prompt) throw new Error("Choose a still, or describe the clip.");
      return { image, prompt, mode: f.mode.value, resolution: f.resolution.value, aspect: f.aspect.value };
    },
    show: videoOut,
    file: "massless-animate.mp4",
  },
  motion: {
    label: "Motion",
    note: "Wan-Animate-2 (Apache-2.0): the person in your still performs the motion of a driving clip (up to 10 s), at 480p. The clip's sound is kept.",
    fields() {
      this.still = stillPicker("image", "Character still", true);
      return [
        this.still,
        h("label", {}, "Driving clip ", h("input", { type: "file", accept: "video/mp4,video/quicktime,video/webm", name: "video", required: true })),
        h("label", {}, "Character and background ", h("input", { name: "prompt", maxlength: "1200", placeholder: "a knight in silver armor; a castle courtyard at dusk" })),
      ];
    },
    preset: () => "motion",
    async input(f) {
      const image = await this.still.read();
      const video = await clipBase64(f.video.files[0], "driving clip");
      const p = f.prompt.value.trim();
      const prompt = p ? `Character description: ${p.split(";")[0].trim()}\nBackground description: ${(p.split(";")[1] || "the same place as the reference image").trim()}` : undefined;
      return { image, video, prompt };
    },
    show: videoOut,
    file: "massless-motion.mp4",
  },
  lipsync: {
    label: "Lip sync",
    note: "Wan 2.2 S2V (Apache-2.0): a face in your still speaks or sings an audio clip (up to 10 s), at 480p.",
    fields() {
      this.still = stillPicker("image", "Face still", true);
      return [
        this.still,
        h("label", {}, "Speech or song ", h("input", { type: "file", accept: "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg,audio/flac", name: "audio", required: true })),
        h("label", {}, "Scene (optional) ", h("input", { name: "prompt", maxlength: "1200", placeholder: "a woman talking to the camera in a sunny kitchen" })),
        select("mode", "Quality", [["quick", "Quick (4 steps)"], ["best", "Best (20 steps, much slower)"]]),
      ];
    },
    preset: (f) => `lipsync:${f.mode.value}`,
    async input(f) {
      return { image: await this.still.read(), audio: await clipBase64(f.audio.files[0], "audio clip", "audio"), prompt: f.prompt.value.trim() || undefined, mode: f.mode.value };
    },
    show: videoOut,
    file: "massless-lipsync.mp4",
  },
  upscale_video: {
    label: "Upscale video",
    note: "SeedVR2 7B (Apache-2.0): restores detail and upscales a clip (up to 10 s) to as much as 1920×1080, keeping its sound.",
    fields: () => [
      h("label", {}, "Clip ", h("input", { type: "file", accept: "video/mp4,video/quicktime,video/webm", name: "video", required: true })),
      select("scale", "Scale", [["2", "2×"], ["4", "4× (capped at 1920×1080)"]]),
    ],
    preset: () => "upscale_video",
    async input(f) {
      return { video: await clipBase64(f.video.files[0], "clip"), scale: Number(f.scale.value) };
    },
    show: videoOut,
    file: "massless-upscaled.mp4",
  },
};

const KIND = {
  animate: { title: "Video on the GPU", modes: VIDEO_MODES },
  music: {
    title: "Compose on the GPU",
    modes: {
      music: {
        label: "Music",
        note: "ACE-Step 1.5 (MIT; generated music may be used commercially): style tags, optional lyrics, up to 3 minutes.",
        fields: () => [
          h("label", {}, "Style ", h("input", { name: "tags", maxlength: "600", required: true, placeholder: "warm lo-fi hip hop, mellow piano, vinyl crackle" })),
          h("label", {}, "Lyrics (optional) ", h("textarea", { name: "lyrics", maxlength: "4000", rows: "3", placeholder: "[verse]\n…" })),
          h("label", {}, "Seconds ", h("input", { name: "duration", type: "number", min: "10", max: "180", value: "30" })),
          h("label", {}, "BPM ", h("input", { name: "bpm", type: "number", min: "40", max: "220", value: "100" })),
        ],
        preset: () => "music",
        async input(f) {
          return { tags: f.tags.value.trim(), lyrics: f.lyrics.value.trim() || undefined, duration: Number(f.duration.value), bpm: Number(f.bpm.value) };
        },
        show: (blob) => h("audio", { src: URL.createObjectURL(blob), controls: true }),
        file: "massless-music.mp3",
      },
    },
  },
};
function money(c) {
  return "$" + (c / 100).toFixed(2);
}
async function mount(el) {
  const kind = KIND[el.dataset.gpuPanel];
  if (!kind) return;
  const names = Object.keys(kind.modes);
  let mode = names[0];
  const status = h("p", { class: "gpu-status", role: "status", "aria-live": "polite" });
  const meter = h("p", { class: "gpu-meter" });
  const note = h("p", { class: "gpu-note" });
  const cost = h("p", { class: "gpu-cost" });
  const form = h("form", { class: "gpu-form" });
  const go = h("button", { type: "submit", class: "btn-accent", text: "Render on the GPU" });
  const stop = h("button", { type: "button", class: "btn-ghost", text: "Cancel", hidden: true });
  const out = h("div", { class: "gpu-result" });
  const tabs = h("div", { class: "gpu-modes", role: "tablist", hidden: names.length < 2 });
  let budget = null;
  const showCost = () => {
    const m = kind.modes[mode];
    const q = budget && budget.estimates && budget.estimates[m.preset(form.elements)];
    cost.textContent = q
      ? `About ${Math.round(q.seconds / 60) >= 2 ? Math.round(q.seconds / 60) + " min" : q.seconds + " s"} on the GPU, ≈ ${money(q.cents)} of today's budget (${money(q.coldCents)} if the GPU has to wake up). Up to ${money(q.reserveCents)} is held until it finishes.`
      : "";
  };
  const render = () => {
    const m = kind.modes[mode];
    note.textContent = m.note;
    form.replaceChildren(...m.fields(), go, stop);
    for (const b of tabs.children) b.setAttribute("aria-selected", String(b.dataset.mode === mode));
    out.replaceChildren();
    status.textContent = "";
    showCost();
  };
  for (const n of names) {
    const b = h("button", { type: "button", role: "tab", class: "btn-ghost", "data-mode": n, text: kind.modes[n].label });
    b.addEventListener("click", () => { if (mode !== n) { mode = n; render(); } });
    tabs.append(b);
  }
  form.addEventListener("change", showCost);
  el.replaceChildren(h("h3", { text: kind.title }), tabs, note, meter, form, cost, status, out);
  el.hidden = true;
  const refresh = async () => {
    const b = await gpuBudget();
    budget = b;
    el.hidden = !b.on;
    if (!b.on) return b;
    showCost();
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
    const m = kind.modes[mode];
    ctl = new AbortController();
    go.disabled = true;
    stop.hidden = false;
    out.replaceChildren();
    try {
      await accessToken();
      status.textContent = "Preparing…";
      const input = await m.input(form.elements);
      status.textContent = "Sending…";
      const r = await gpuJob({ job: mode, input, signal: ctl.signal, onProgress: (p) => (status.textContent = p.message + (Number.isFinite(p.percent) ? ` (${p.percent}%)` : "")) });
      const a = h("a", { href: URL.createObjectURL(r.blob), download: m.file, class: "btn-ghost", text: "Download" });
      out.replaceChildren(m.show(r.blob), a);
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
  render();
  await refresh();
}
for (const el of document.querySelectorAll("[data-gpu-panel]")) mount(el);
