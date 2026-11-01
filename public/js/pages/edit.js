import { saveAsset, selectedAsset, assetURL, downloadBlob } from "../assets.js";
import { runJob, downloadNote, clearModels, hasWebGPU } from "../image-ai.js";
import { MODELS } from "../image-models.js";
import {
  WORK_MAX,
  fitWithin,
  upscaleCheck,
  modnetSize,
  resizeChannel,
  featherAlpha,
  compositeOver,
  holeFromStrokes,
} from "../image-tools.js";

const $ = (s) => document.querySelector(s),
  canvas = $("#art"),
  ctx = canvas.getContext("2d");
let image, sourceId;
const message = (t) => ($("#status").textContent = t);
const TOOLS = ["compose", "remove-bg", "upscale", "erase"];
const BACKDROPS = {
  studio: ["#eee6d7", "#c2ad91"],
  botanical: ["#d2e0bc", "#254d3e"],
  neon: ["#47326e", "#121622"],
};
// Working state of the three image tools. base: the image they start from; result: the latest output.
const T = {
  tool: "compose",
  base: null,
  baseData: null,
  result: null,
  meta: null,
  matte: null,
  strokes: null,
  history: [],
  busy: false,
};

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
const pixels = (c) =>
  c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
function paintBackdrop(g, w, h, key) {
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, BACKDROPS[key][0]);
  grad.addColorStop(1, BACKDROPS[key][1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}

// ---------------------------------------------------------------------------------------------
// Compose (the original workroom)
// ---------------------------------------------------------------------------------------------

function settings() {
  return Object.fromEntries(
    [
      "frame",
      "backdrop",
      "scale",
      "x",
      "y",
      "brightness",
      "contrast",
      "saturation",
      "headline",
    ].map((id) => [id, $("#" + id).value]),
  );
}
function drawCompose() {
  const s = settings(),
    dims = { square: [1080, 1080], portrait: [1080, 1350], wide: [1920, 1080] }[
      s.frame
    ];
  [canvas.width, canvas.height] = dims;
  const w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!$("#original").checked && s.backdrop !== "transparent")
    paintBackdrop(ctx, w, h, s.backdrop);
  if (image) {
    const scale =
        Math.min(w / image.width, h / image.height) *
        ($("#original").checked ? 1 : Number(s.scale) / 100),
      iw = image.width * scale,
      ih = image.height * scale;
    ctx.save();
    ctx.filter = $("#original").checked
      ? "none"
      : `brightness(${s.brightness}%) contrast(${s.contrast}%) saturate(${s.saturation}%)`;
    ctx.drawImage(
      image,
      (w - iw) / 2 + (Number(s.x) * w) / 100,
      (h - ih) / 2 + (Number(s.y) * h) / 100,
      iw,
      ih,
    );
    ctx.restore();
  }
  if (s.headline && !$("#original").checked) {
    ctx.font = `700 ${Math.round(w * 0.057)}px sans-serif`;
    ctx.fillStyle = s.backdrop === "neon" ? "#fff" : "#17211b";
    ctx.textAlign = "center";
    ctx.fillText(s.headline, w / 2, h * 0.9, w * 0.88);
  }
}

// ---------------------------------------------------------------------------------------------
// Tool view: before / after split, plus the brush strokes while erasing
// ---------------------------------------------------------------------------------------------

function drawTool() {
  const before = T.base;
  if (!before) return;
  const after = T.result || before;
  if (canvas.width !== after.width || canvas.height !== after.height) {
    canvas.width = after.width;
    canvas.height = after.height;
  }
  const w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(after, 0, 0, w, h);
  if (T.result) {
    const split = Math.round((Number($("#compare").value) / 100) * w);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, split, h);
    ctx.clip();
    ctx.clearRect(0, 0, split, h);
    ctx.drawImage(before, 0, 0, w, h);
    ctx.restore();
    if (split > 0 && split < w) {
      ctx.fillStyle = "#ffc22e";
      ctx.fillRect(split - Math.max(1, w / 600), 0, Math.max(2, w / 300), h);
    }
  }
  if (T.tool === "erase" && T.strokes) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.drawImage(T.strokes, 0, 0, w, h);
    ctx.restore();
  }
}

function draw() {
  if (T.tool === "compose") drawCompose();
  else drawTool();
}

// ---------------------------------------------------------------------------------------------
// Source image
// ---------------------------------------------------------------------------------------------

function setBase(source) {
  const fit = fitWithin(source.width, source.height, WORK_MAX);
  const c = makeCanvas(fit.w, fit.h);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(source, 0, 0, fit.w, fit.h);
  T.base = c;
  T.baseData = null;
  T.result = null;
  T.meta = null;
  T.matte = null;
  T.history = [];
  T.strokes = makeCanvas(fit.w, fit.h);
  return fit.scaled;
}

async function load(blob, id) {
  image?.close?.();
  image = await createImageBitmap(blob);
  sourceId = id;
  const scaled = setBase(image);
  refresh();
  message(
    scaled
      ? `Ready. The tools work on a ${T.base.width} × ${T.base.height} copy of this large image.`
      : "Ready. Your original stays unchanged.",
  );
}

// ---------------------------------------------------------------------------------------------
// Tabs and panels
// ---------------------------------------------------------------------------------------------

/** A result carries over to the next tool (and to Compose), so the tools chain. */
async function carryOver() {
  if (!T.result) return;
  const next = T.result;
  image?.close?.();
  image = await createImageBitmap(next);
  setBase(next);
}

async function setTool(id, { remember = true } = {}) {
  if (!TOOLS.includes(id)) id = "compose";
  if (T.busy) return;
  if (id !== T.tool) await carryOver();
  T.tool = id;
  for (const b of document.querySelectorAll(".tool-tabs button"))
    b.setAttribute("aria-selected", String(b.dataset.tool === id));
  for (const p of document.querySelectorAll(".panel")) p.hidden = p.dataset.panel !== id;
  canvas.classList.toggle("painting", id === "erase");
  if (remember) {
    const u = new URL(location.href);
    if (id === "compose") u.searchParams.delete("tool");
    else u.searchParams.set("tool", id);
    history.replaceState(null, "", u.pathname + u.search);
    try {
      localStorage.setItem("massless-edit-tool", id);
    } catch {
      /* storage off: the tab is just not remembered */
    }
  }
  $("#next").hidden = true;
  refresh();
  updateNote();
}

function refresh() {
  const toolView = T.tool !== "compose";
  $("#compare-row").hidden = !toolView || !T.result;
  $("#result-actions").hidden = !toolView || !T.result;
  $("#er-undo").disabled = !T.history.length || T.busy;
  updateUpscaleHint();
  draw();
}

async function updateNote() {
  const tool = T.tool;
  const el = document.querySelector(`[data-note="${tool}"]`);
  if (!el) return;
  let id = { "remove-bg": $("#bg-model").value, upscale: "esrgan", erase: "migan" }[tool];
  if (tool === "erase" && $("#er-method").value === "patch") {
    el.dataset.model = "patch";
    el.textContent = "Fills the gap from the rest of the picture.";
    return;
  }
  const [note, gpu] = await Promise.all([downloadNote(id), hasWebGPU()]);
  const heavy =
    id === "birefnet" && !gpu
      ? " On this device it can take up to a minute. For portraits, People is much faster."
      : "";
  if (T.tool === tool) {
    el.dataset.model = id;
    el.dataset.cached = String(!note.bytes);
    el.textContent = `${note.bytes ? "The first time takes a moment to get ready." : ""}${heavy}`.trim();
  }
}

function updateUpscaleHint() {
  if (!T.base) return;
  const f = Number(document.querySelector('[name="up-factor"]:checked').value);
  const c = upscaleCheck(T.base.width, T.base.height, f);
  $("#up-size").textContent = c.ok
    ? `${T.base.width} × ${T.base.height} → ${c.out.w} × ${c.out.h} px`
    : c.message;
  $("#up-run").disabled = !c.ok || T.busy;
}

function setBusy(on) {
  T.busy = on;
  for (const b of document.querySelectorAll("#bg-run,#up-run,#er-run,#tool-save,#er-clear,.tool-tabs button"))
    b.disabled = on;
  $("#progress").hidden = !on;
  if (on) $("#progress").removeAttribute("value");
  refresh();
}

const onProgress = (fraction, label) => {
  const p = $("#progress");
  if (fraction > 0 && fraction < 1) p.value = fraction;
  else p.removeAttribute("value");
  message(label);
};


async function tool(label, fn) {
  if (!T.base) return message("Open an image first.");
  setBusy(true);
  // on a phone the picture sits above the controls: bring it (and the progress bar) into view
  if (innerWidth <= 800 && $(".stage").getBoundingClientRect().top < 0)
    $(".stage").scrollIntoView({ behavior: "smooth", block: "start" });
  const t0 = performance.now();
  try {
    const backend = await fn();
    const s = ((performance.now() - t0) / 1000).toFixed(1);
    message(`${label} in ${s} s.`);
  } catch (e) {
    message(e.message);
  } finally {
    setBusy(false);
    updateNote();
  }
}

// ---------------------------------------------------------------------------------------------
// Remove background
// ---------------------------------------------------------------------------------------------

async function removeBackground() {
  const model = $("#bg-model").value;
  await tool("Background removed", async () => {
    const w = T.base.width,
      h = T.base.height;
    const size = model === "birefnet" ? { w: 512, h: 512 } : modnetSize(w, h);
    const small = makeCanvas(size.w, size.h);
    const g = small.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff";
    g.fillRect(0, 0, size.w, size.h);
    g.imageSmoothingQuality = "high";
    g.drawImage(T.base, 0, 0, size.w, size.h);
    const px = g.getImageData(0, 0, size.w, size.h).data;
    const res = await runJob(
      "remove-bg",
      { model, rgba: px, w: size.w, h: size.h },
      { transfer: [px.buffer], onProgress },
    );
    T.matte = { data: resizeChannel(res.matte, res.w, res.h, w, h), w, h, model };
    composeCutout();
    return res.backend;
  });
}

function backgroundPixels(kind, w, h) {
  if (kind === "transparent") return null;
  const c = makeCanvas(w, h);
  const g = c.getContext("2d", { willReadFrequently: true });
  if (kind === "color") {
    g.fillStyle = $("#bg-color").value;
    g.fillRect(0, 0, w, h);
  } else if (kind === "blur") {
    // shrink and enlarge: a soft blur that works in every browser
    const s = makeCanvas(Math.max(1, Math.round(w / 32)), Math.max(1, Math.round(h / 32)));
    const sg = s.getContext("2d");
    sg.imageSmoothingQuality = "high";
    sg.drawImage(T.base, 0, 0, s.width, s.height);
    g.imageSmoothingQuality = "high";
    g.drawImage(s, 0, 0, w, h);
  } else paintBackdrop(g, w, h, kind);
  return g.getImageData(0, 0, w, h).data;
}

function composeCutout() {
  if (!T.matte) return;
  const { w, h } = T.matte;
  T.baseData ||= pixels(T.base).data;
  const fill = $("#bg-fill").value;
  const soft = Number($("#bg-feather").value);
  const matte = featherAlpha(T.matte.data, w, h, soft * Math.max(1, Math.max(w, h) / 1000));
  const out = compositeOver(T.baseData, matte, backgroundPixels(fill, w, h));
  const c = makeCanvas(w, h);
  c.getContext("2d").putImageData(new ImageData(out, w, h), 0, 0);
  T.result = c;
  T.meta = {
    name: "Background removed",
    engine: `remove-bg · ${MODELS[T.matte.model].name}`,
    settings: { tool: "remove-bg", model: T.matte.model, fill, color: $("#bg-color").value, softness: soft },
  };
  refresh();
}

// ---------------------------------------------------------------------------------------------
// Upscale
// ---------------------------------------------------------------------------------------------

async function upscale() {
  const factor = Number(document.querySelector('[name="up-factor"]:checked').value);
  const check = upscaleCheck(T.base.width, T.base.height, factor);
  if (!check.ok) return message(check.message);
  await tool(`Upscaled ${factor}×`, async () => {
    const { data, width: w, height: h } = pixels(T.base);
    const res = await runJob(
      "upscale",
      { rgba: data, w, h, factor },
      { transfer: [data.buffer], onProgress },
    );
    const c = makeCanvas(res.w, res.h);
    c.getContext("2d").putImageData(new ImageData(res.data, res.w, res.h), 0, 0);
    T.result = c;
    T.meta = {
      name: `Upscaled ${factor}×`,
      engine: `upscale · ${MODELS.esrgan.name}`,
      settings: { tool: "upscale", factor, from: [w, h], to: [res.w, res.h] },
    };
    return res.backend;
  });
}

// ---------------------------------------------------------------------------------------------
// Erase object
// ---------------------------------------------------------------------------------------------

let painting = null;
function toImage(e) {
  const r = canvas.getBoundingClientRect();
  const s = Math.min(r.width / canvas.width, r.height / canvas.height);
  const ox = r.left + (r.width - canvas.width * s) / 2,
    oy = r.top + (r.height - canvas.height * s) / 2;
  return { x: (e.clientX - ox) / s, y: (e.clientY - oy) / s, s };
}
function stroke(from, to) {
  const g = T.strokes.getContext("2d");
  g.strokeStyle = g.fillStyle = "#ff3b3b";
  g.lineCap = g.lineJoin = "round";
  g.lineWidth = Number($("#er-brush").value) / to.s;
  g.beginPath();
  g.moveTo(from.x, from.y);
  g.lineTo(to.x + 0.01, to.y);
  g.stroke();
}
canvas.addEventListener("pointerdown", (e) => {
  if (T.tool !== "erase" || T.busy || !T.strokes) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  painting = toImage(e);
  stroke(painting, painting);
  draw();
});
canvas.addEventListener("pointermove", (e) => {
  if (!painting) return;
  const p = toImage(e);
  stroke(painting, p);
  painting = p;
  draw();
});
for (const ev of ["pointerup", "pointercancel"])
  canvas.addEventListener(ev, () => (painting = null));

async function erase() {
  const current = T.result || T.base;
  const { width: w, height: h } = current;
  const hole = holeFromStrokes(
    pixels(T.strokes).data,
    w,
    h,
    Math.max(2, Math.round(Math.max(w, h) / 400)),
  );
  if (!hole) return message("Paint over what you want to remove first.");
  const method = $("#er-method").value;
  await tool("Erased", async () => {
    const { data } = pixels(current);
    const res = await runJob(
      "erase",
      { rgba: data, w, h, hole, method },
      { transfer: [data.buffer, hole.buffer], onProgress },
    );
    const c = makeCanvas(w, h);
    c.getContext("2d").putImageData(new ImageData(res.data, w, h), 0, 0);
    T.history.push(T.result);
    T.result = c;
    T.strokes.getContext("2d").clearRect(0, 0, w, h);
    T.meta = {
      name: "Object erased",
      engine: `erase · ${method === "migan" ? MODELS.migan.name : "PatchMatch texture copy"}`,
      settings: { tool: "erase", method, strokes: T.history.length },
    };
    return res.backend;
  });
}

// ---------------------------------------------------------------------------------------------
// Results: save, download, keep editing
// ---------------------------------------------------------------------------------------------

const toPNG = (c) =>
  new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("Image export failed."))), "image/png"),
  );

function showNext(item) {
  const next = $("#next");
  next.replaceChildren();
  for (const [name, path] of [
    ["Animate ↗", "/video"],
    ["Music preview ↗", "/music"],
    ["Open library ↗", "/library/"],
  ]) {
    const a = document.createElement("a");
    a.className = "btn-ghost";
    a.textContent = name;
    a.href = assetURL(path, item.id);
    next.append(a);
  }
  next.hidden = false;
}

$("#tool-save").onclick = async (e) => {
  if (!T.result) return;
  e.target.disabled = true;
  try {
    const item = await saveAsset(await toPNG(T.result), {
      name: T.meta.name,
      engine: T.meta.engine,
      sourceId,
      settings: T.meta.settings,
    });
    T.savedId = item.id;
    showNext(item);
    message("Saved as a new take in your library.");
  } catch (err) {
    message(err.message);
  } finally {
    e.target.disabled = false;
  }
};
$("#tool-download").onclick = async () => {
  try {
    if (!T.result) throw new Error("Nothing to download yet.");
    downloadBlob(await toPNG(T.result), `chucksi-${T.tool}.png`);
  } catch (err) {
    message(err.message);
  }
};
// ---------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------

$("#image-file").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (f) await load(f);
  } catch (err) {
    message(err.message);
  }
};
for (const control of document.querySelectorAll(
  '.panel[data-panel="compose"] input, .panel[data-panel="compose"] select',
))
  control.addEventListener("input", draw);
for (const b of document.querySelectorAll(".tool-tabs button"))
  b.onclick = () => setTool(b.dataset.tool);
$("#bg-run").onclick = removeBackground;
$("#up-run").onclick = upscale;
$("#er-run").onclick = erase;
$("#er-clear").onclick = () => {
  T.strokes?.getContext("2d").clearRect(0, 0, T.strokes.width, T.strokes.height);
  draw();
};
$("#er-undo").onclick = () => {
  if (!T.history.length) return;
  T.result = T.history.pop();
  refresh();
  message("Undone.");
};
$("#bg-model").onchange = updateNote;
$("#er-method").onchange = updateNote;
$("#bg-fill").oninput = () => {
  $("#bg-color-row").hidden = $("#bg-fill").value !== "color";
  composeCutout();
};
let soften = 0;
const recomposite = () => {
  cancelAnimationFrame(soften);
  soften = requestAnimationFrame(composeCutout);
};
$("#bg-feather").oninput = recomposite;
$("#bg-color").oninput = recomposite;
$("#compare").oninput = draw;
for (const r of document.querySelectorAll('[name="up-factor"]')) r.onchange = refresh;
$("#clear-models").onclick = async () => {
  const ok = await clearModels();
  message(ok ? "Space freed." : "Nothing to remove.");
  updateNote();
};
$("#download").onclick = async () => {
  try {
    if (!image) throw new Error("Open an image first.");
    downloadBlob(await toPNG(canvas), "chucksi-edit.png");
  } catch (e) {
    message(e.message);
  }
};
$("#save").onclick = async (e) => {
  e.target.disabled = true;
  try {
    if (!image) throw new Error("Open an image first.");
    const it = await saveAsset(await toPNG(canvas), {
      name: $("#headline").value || "Edited take",
      engine: "local-composite",
      sourceId,
      settings: settings(),
    });
    showNext(it);
    message("Saved as a new take in your library.");
  } catch (e) {
    message(e.message);
  } finally {
    e.target.disabled = false;
  }
};

let startTool = new URLSearchParams(location.search).get("tool");
if (!startTool) {
  try {
    startTool = localStorage.getItem("massless-edit-tool");
  } catch {
    startTool = null;
  }
}
await setTool(startTool || "compose", { remember: false });
window.massless = { edit: T, setTool };
try {
  const item = await selectedAsset();
  if (item?.blob?.type.startsWith("image/")) await load(item.blob, item.id);
  else {
    const r = await fetch("/media/website/ceramics.jpg");
    await load(await r.blob());
  }
} catch (e) {
  message(e.message);
}
