import { saveAsset, selectedAsset, assetURL, downloadBlob } from "../assets.js";
const $ = (s) => document.querySelector(s),
  canvas = $("#art"),
  ctx = canvas.getContext("2d");
let image, sourceId;
const message = (t) => ($("#status").textContent = t);
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
function draw() {
  const s = settings(),
    dims = { square: [1080, 1080], portrait: [1080, 1350], wide: [1920, 1080] }[
      s.frame
    ];
  [canvas.width, canvas.height] = dims;
  const w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!$("#original").checked && s.backdrop !== "transparent") {
    const g = ctx.createLinearGradient(0, 0, w, h);
    const colors = {
      studio: ["#eee6d7", "#c2ad91"],
      botanical: ["#d2e0bc", "#254d3e"],
      neon: ["#47326e", "#121622"],
    }[s.backdrop];
    g.addColorStop(0, colors[0]);
    g.addColorStop(1, colors[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
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
async function load(blob, id) {
  image?.close?.();
  image = await createImageBitmap(blob);
  sourceId = id;
  draw();
  message("Ready. Your source remains unchanged.");
}
async function png() {
  return new Promise((res, rej) =>
    canvas.toBlob(
      (b) => (b ? res(b) : rej(new Error("Image export failed."))),
      "image/png",
    ),
  );
}
$("#image-file").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (f) await load(f);
  } catch (e) {
    message(e.message);
  }
};
for (const control of document.querySelectorAll(
  ".controls input,.controls select",
))
  if (control.type !== "file") control.addEventListener("input", draw);
$("#download").onclick = async () => {
  try {
    if (!image) throw new Error("Open an image first.");
    downloadBlob(await png(), "massless-edit.png");
  } catch (e) {
    message(e.message);
  }
};
$("#save").onclick = async (e) => {
  e.target.disabled = true;
  try {
    if (!image) throw new Error("Open an image first.");
    const it = await saveAsset(await png(), {
      name: $("#headline").value || "Edited take",
      engine: "local-composite",
      sourceId,
      settings: settings(),
    });
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
      a.href = assetURL(path, it.id);
      next.append(a);
    }
    next.hidden = false;
    message("Saved as a new take in your library.");
  } catch (e) {
    message(e.message);
  } finally {
    e.target.disabled = false;
  }
};
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
