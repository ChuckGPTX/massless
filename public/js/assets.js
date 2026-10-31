// Shared local media. Uses the existing store without migrating or deleting originals.
import * as store from "./store.js";
export const mediaKind = (blob) =>
  blob?.type?.startsWith("image/")
    ? "image"
    : blob?.type?.startsWith("video/")
      ? "video"
      : blob?.type?.startsWith("audio/")
        ? "audio"
        : "file";
export function recipeFor(item) {
  return {
    version: 1,
    title: item.name || item.title || item.prompt?.slice(0, 80) || "Untitled",
    kind: mediaKind(item.blob),
    model: item.model || item.engine || "upload",
    seed: item.seed ?? null,
    prompt: item.prompt || "",
    settings: item.settings || item.rig || item.sel || {},
    sourceId: item.sourceId || null,
    created: item.created,
  };
}
export async function saveAsset(blob, meta = {}) {
  if (!(blob instanceof Blob) || !blob.size)
    throw new Error("Choose a non-empty media file.");
  const item = {
    ...meta,
    id: crypto.randomUUID(),
    kind: mediaKind(blob) === "image" ? "shot" : "asset",
    created: Date.now(),
    blob,
  };
  await store.put(item);
  return item;
}
export function assetURL(path, id, brief = "") {
  const u = new URL(path, "https://massless.invalid");
  if (id) u.searchParams.set("shot", id);
  if (brief) u.searchParams.set("brief", brief.slice(0, 600));
  return u.pathname + u.search;
}
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const selectedAsset = () =>
  store.get(new URLSearchParams(location.search).get("shot") || "");
