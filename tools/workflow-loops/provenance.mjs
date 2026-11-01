// Write public/media/templates/provenance.json: where every Workflows loop and poster came from.
// node tools/workflow-loops/provenance.mjs
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { GALLERY } from "../../public/js/workflow-data.js";

const SOURCES = {
  "video-renderer": "Drawn frame by frame by the Video page's own depth renderer, camera moves and effect engine (massless.drawFrame) on the bundled sample stills in /media/art with their precomputed depth maps (record-video.cjs). Camera moves play forward then back (ping-pong); effects close with a short crossfade into their first frame.",
  "game-previews": "Re-cut from the Games gallery clips in /media/games, which tools/game_previews.py recorded headlessly with each game's own bot playing. Closed with a short crossfade into the first frame.",
  "design-artboards": "Artboards rendered by the design workflow itself (/workflows?make=<id>&example=<id>) from its bundled sample frames, no AI calls, captured from the page's canvases (record-design.cjs) and assembled into a sliding carousel (slides.py).",
  "film-poem-player": "Frames drawn by the Film poem workflow's own player, stepped with its scrubber (record-design.cjs).",
  "website-builder": "The Website builder's own template preview at tablet width (768 px), scrolled frame by frame and captured (record-steps.cjs).",
  "edit-workroom": "The Image workroom on its bundled sample photo (/media/website/ceramics.jpg). Compose: the page's own frame, backdrop, scale and headline controls stepped per frame. Remove background, upscale and erase: the tool's real on-device model output, shown with the page's own before/after slider (record-steps.cjs).",
  "depth-viewer": "The 3D page's depth splat of the bundled samurai sample, orbited by dragging the viewer frame by frame (record-steps.cjs, jobs/animated.js).",
  "scene-studio": "The Scene studio's default scene, orbited by dragging the viewer frame by frame (record-steps.cjs, jobs/animated.js).",
  "launch-film": "The Launch film page's built-in example film, drawn by its own renderer (massless.seek) frame by frame.",
  "music-visualizer": "The Music page's visualizer driving the bundled sample still /media/art/lighthouse.jpg with the bundled synthesized instrumental, stepped with its scrubber.",
  "audio-page": "The Audio page's own animated voice and sound-bed preview cards over the bundled sample stills, with performance.now() stepped 1/24 s per frame (jobs/animated.js).",
  "clip-workroom": "The Clip workroom burning three typed captions into its bundled LiDAR sample clip, seeking the clip frame by frame (jobs/tools.js).",
  "office": "Chucksi Office on its bundled sample document and contract templates, driven with scripted clicks and typing, captured frame by frame.",
};
const sourceOf = (c) =>
  c.id.startsWith("fx-") || c.id.startsWith("move-") ? "video-renderer"
  : c.id.startsWith("game-") ? "game-previews"
  : c.id.startsWith("design-film-") ? "film-poem-player"
  : c.id.startsWith("design-") ? "design-artboards"
  : c.id.startsWith("site-") ? "website-builder"
  : c.id === "image-depth" ? "depth-viewer"
  : c.id === "image-scene" ? "scene-studio"
  : c.id.startsWith("image-") ? "edit-workroom"
  : c.id === "film-launch" ? "launch-film"
  : c.id === "film-music" ? "music-visualizer"
  : c.id === "film-captions" ? "clip-workroom"
  : c.id.startsWith("film-") ? "audio-page"
  : "office";

const pub = (p) => new URL("../../public" + p, import.meta.url);
const files = [];
for (const c of GALLERY)
  for (const p of [c.video, c.poster]) {
    const buf = await readFile(pub(p));
    files.push({ path: p.slice(1), bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex"), card: c.id, source: sourceOf(c), recorded_from: c.href });
  }
await writeFile(
  pub("/media/templates/provenance.json"),
  JSON.stringify(
    {
      date: new Date().toISOString().slice(0, 10),
      notice: "Every loop and poster here was made by Chucksi's own tools in headless Chromium from media already in this repository (sample stills, sample frames, bundled audio). No people were filmed and no outside footage was used. Encoded with ffmpeg: H.264, no audio, 24 fps, posters are WebP. Recording scripts: tools/workflow-loops.",
      sources: SOURCES,
      files,
    },
    null,
    1,
  ) + "\n",
);
console.log(files.length, "files");
