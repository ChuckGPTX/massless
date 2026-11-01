import { all, del } from "../store.js";
import {
  saveAsset,
  mediaKind,
  recipeFor,
  assetURL,
  downloadBlob,
} from "../assets.js";
const $ = (s) => document.querySelector(s),
  urls = [];
const node = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
let items = [];
async function refresh() {
  items = (await all()).sort((a, b) => b.created - a.created);
  render();
}
function render() {
  urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  $("#assets").replaceChildren();
  const q = $("#search").value.toLowerCase(),
    kind = $("#kind").value;
  const visible = items.filter(
    (i) =>
      i.blob &&
      (kind === "all" || mediaKind(i.blob) === kind) &&
      [i.name, i.title, i.prompt, i.model].join(" ").toLowerCase().includes(q),
  );
  $("#status").textContent =
    `${visible.length} saved item${visible.length === 1 ? "" : "s"} · stored on this device. Download originals before clearing browser data.`;
  if (!visible.length) {
    $("#assets").append(
      node("p", "Add your own media, or create an image to begin.", "empty"),
    );
    return;
  }
  for (const item of visible) {
    const card = node("article", null, "asset-card"),
      body = node("div", null, "asset-body"),
      kind = mediaKind(item.blob),
      url = URL.createObjectURL(item.blob);
    urls.push(url);
    if (["image", "audio", "video"].includes(kind)) {
      const media = node(kind === "image" ? "img" : kind);
      media.src = url;
      if (kind === "image") {
        media.alt = item.name || item.prompt || "Saved image";
        media.loading = "lazy";
      } else {
        media.controls = true;
        media.preload = "metadata";
      }
      card.append(media);
    }
    const title =
        item.name ||
        item.title ||
        item.prompt?.slice(0, 80) ||
        "Untitled " + kind,
      actions = node("div", null, "actions");
    body.append(
      node("h2", title),
      node(
        "p",
        `${kind.toUpperCase()} · ${new Date(item.created).toLocaleDateString()} · ${item.model || { "local-composite": "Image workroom", "camera-effects": "Camera & effects", "film-composer": "Launch film", "music-visualizer": "Music preview", "local-caption-render": "Caption & trim", "local-text-edit": "Edit by text", "local-master": "Master", "three-scene": "Scene studio", games: "Games", upload: "Your media" }[item.engine] || "Your media"}`,
      ),
    );
    const link = (label, path) => {
      const a = node("a", label, "btn-ghost");
      a.href = assetURL(path, item.id);
      actions.append(a);
    };
    if (kind === "image") {
      link("Edit", "/edit/");
      link("Animate", "/video");
      link("Music preview", "/music");
      link("3D", "/3d");
      link("Launch film", "/film");
    }
    if (kind === "video") link("Caption & trim", "/cut/");
    if (kind === "audio") link("Edit by text", "/cut/");
    if (kind === "audio") link("Master", "/audio?tab=master");
    if (kind === "video" || kind === "audio")
      link("Transcribe", "/audio?tab=captions");
    const button = (label, fn) => {
      const b = node("button", label, "btn-ghost");
      b.onclick = fn;
      actions.append(b);
    };
    button("Download", () =>
      downloadBlob(
        item.blob,
        item.name ||
          item.id +
            "." +
            ({
              image: item.blob.type.includes("jpeg")
                ? "jpg"
                : item.blob.type.includes("webp")
                  ? "webp"
                  : "png",
              video: item.blob.type.includes("webm") ? "webm" : "mp4",
              audio: item.blob.type.includes("mpeg")
                ? "mp3"
                : item.blob.type.includes("mp4")
                  ? "m4a"
                  : "wav",
            }[kind] || "bin"),
      ),
    );
    button("Recipe", () =>
      downloadBlob(
        new Blob([JSON.stringify(recipeFor(item), null, 2)], {
          type: "application/json",
        }),
        "chucksi-recipe.json",
      ),
    );
    button("Rename", async () => {
      const name = prompt("Name this item", title);
      if (name?.trim()) {
        const { put } = await import("../store.js");
        await put({ ...item, name: name.trim().slice(0, 120) });
        await refresh();
      }
    });
    button("Remove", async () => {
      if (
        confirm(
          "Remove this local copy? Download the original first if you need it.",
        )
      ) {
        await del(item.id);
        await refresh();
      }
    });
    body.append(actions);
    card.append(body);
    $("#assets").append(card);
  }
}
$("#search").oninput = render;
$("#kind").onchange = render;
$("#files").onchange = async (e) => {
  try {
    for (const f of e.target.files) {
      if (f.size > 150 * 1024 * 1024)
        throw new Error("Use files under 150 MB in the local library.");
      await saveAsset(f, { name: f.name, engine: "upload" });
    }
    await refresh();
  } catch (err) {
    $("#status").textContent = err.message;
  }
  e.target.value = "";
};
refresh().catch(
  (e) =>
    ($("#status").textContent = "Your library could not open: " + e.message),
);
