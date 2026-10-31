import { all, get } from "../store.js";
import { renderTemplate, templateSettings } from "../templates.js";
import { downloadBlob } from "../assets.js";
const $ = (s) => document.querySelector(s),
  fields = [
    "template",
    "name",
    "headline",
    "description",
    "accent",
    "speed",
    "asset",
  ];
let art = "";
const message = (t) => ($("#status").textContent = t);
function settings() {
  return templateSettings(
    Object.fromEntries(fields.map((id) => [id, $("#" + id).value])),
  );
}
function apply(s) {
  s = templateSettings(s);
  for (const id of fields) $("#" + id).value = s[id];
}
async function update() {
  try {
    const s = settings();
    let blob;
    if (s.asset) {
      const item = await get(s.asset);
      if (!item?.blob?.type.startsWith("image/"))
        throw new Error("That image is no longer available. Choose another.");
      blob = item.blob;
    } else
      blob = await fetch("/media/website/pavilion.jpg").then((r) => r.blob());
    const image = await createImageBitmap(blob),
      canvas = document.createElement("canvas"),
      scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    art = canvas.toDataURL("image/jpeg", 0.85);
    $("#preview-frame").srcdoc = renderTemplate(s, art).replace(
      "<title>",
      '<base href="about:srcdoc"><title>',
    );
    message(
      "Live preview updated. Export includes your image and runs offline.",
    );
    return true;
  } catch (e) {
    message(e.message);
    return false;
  }
}
$("#preview").onclick = update;
$("#download").onclick = async () => {
  if (await update())
    downloadBlob(
      new Blob([renderTemplate(settings(), art)], { type: "text/html" }),
      "chucksi-" + settings().template + ".html",
    );
};
$("#save").onclick = () => {
  const s = settings();
  try {
    localStorage.setItem("massless.builder", JSON.stringify(s));
  } catch {}
  downloadBlob(
    new Blob([JSON.stringify(s, null, 2)], { type: "application/json" }),
    "chucksi-template.json",
  );
  message(
    "Settings downloaded. Selected images stay in this browser; HTML exports embed them.",
  );
};
$("#restore").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 10000)
      throw new Error("Choose a template settings file under 10 KB.");
    const s = JSON.parse(await f.text());
    if (s.version !== 1)
      throw new Error("Choose a Chucksi template settings file.");
    apply(s);
    await update();
  } catch (e) {
    message(e.message);
  }
};
try {
  for (const it of (await all()).filter((i) =>
    i.blob?.type.startsWith("image/"),
  )) {
    const o = document.createElement("option");
    o.value = it.id;
    o.textContent = it.name || it.prompt?.slice(0, 60) || "Saved image";
    $("#asset").append(o);
  }
  const saved = localStorage.getItem("massless.builder");
  if (saved) apply(JSON.parse(saved));
  const tab = new URLSearchParams(location.search).get("template");
  if (["game", "website"].includes(tab)) $("#template").value = tab;
  await update();
} catch (e) {
  message(e.message);
}
