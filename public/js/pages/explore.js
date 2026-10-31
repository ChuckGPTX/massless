import { bindDialogs } from "../ui.js";
import { createPreviewMotion } from "../preview-motion.js";
import { drawCrystal, createOrbitGame } from "../studio-demos.js";
const $ = (s) => document.querySelector(s);
const studies = [
  [
    "paper-city",
    "Paper city",
    "Wan 3.0 Prime",
    "animation",
    "A handmade world, one tiny tram at a time.",
  ],
  [
    "lunar-rally",
    "Lunar rally",
    "Kling 4.0",
    "cinema",
    "Dust, speed and a sky full of possibility.",
  ],
  [
    "robot-dance",
    "Borrow a little motion",
    "Genjutsu Light",
    "character",
    "The dance reference, recast as our original robot.",
  ],
  [
    "clay-garden",
    "A little sunshine",
    "Wan 3.0 Prime",
    "animation",
    "A clay character. A flower. A small surprise.",
  ],
  [
    "frost-bloom",
    "Frost bloom",
    "Wan 3.0 Prime",
    "cinema",
    "Glass petals, growing into the light.",
  ],
  [
    "motion-source",
    "The starting move",
    "Kling 4.0",
    "character",
    "The original six-second motion-transfer source.",
  ],
];
// Publish only downloaded and verified outputs. Pending provider jobs stay off the page.
const published = new Set([
  "paper-city",
  "clay-garden",
  "frost-bloom",
  "motion-source",
  "robot-dance",
]);
for (const [id, title, model, category, description] of studies) {
  if (!published.has(id)) continue;
  const card = document.createElement("button");
  card.type = "button";
  card.className = "study";
  card.dataset.category = category;
  card.innerHTML = `<div class="study-visual"><video muted loop playsinline preload="none" poster="/media/showcase/${id}.jpg" data-src="/media/showcase/${id}.mp4" aria-label="${title}"></video><span class="media-label">${model.toUpperCase()} · REFERENCE</span><span class="study-play" aria-hidden="true">▶</span></div><h3>${title}</h3><p>${description}</p>`;
  card.addEventListener("click", () => {
    $("#reference-dialog-title").textContent = title;
    $("#character-reference").hidden = id !== "robot-dance";
    $("#reference-credit").textContent = `${model} · ${description}`;
    $("#reference-player").src = `/media/showcase/${id}.mp4`;
    $("#reference-dialog").showModal();
    $("#reference-player")
      .play()
      .catch(() => {});
  });
  $("#reference-grid").append(card);
}
$("#reference-dialog").addEventListener("close", () =>
  $("#reference-player").pause(),
);
const crystal = $("#crystal-preview"),
  preview = $("#game-preview"),
  gameCanvas = $("#game-canvas");
const game = createOrbitGame(gameCanvas, {
  status: $("#game-status"),
  onEnd: () => {
    $("#game-start").textContent = "Play again";
  },
});
const attract = createOrbitGame(preview);
const visible = new Set();
let previewTime = 0,
  last = performance.now();
const motion = createPreviewMotion({
  videos: document.querySelectorAll("video[data-src]"),
  button: $("#motion-toggle"),
  isSuspended: () => !!document.querySelector("dialog[open]"),
});
const observer = new IntersectionObserver(
  (entries) => {
    for (const e of entries)
      e.isIntersecting ? visible.add(e.target) : visible.delete(e.target);
  },
  { threshold: 0.05 },
);
[crystal, preview].forEach((c) => observer.observe(c));
drawCrystal(crystal);
attract.render(0, true);
game.render();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (motion.playing) {
    previewTime += dt;
    if (visible.has(crystal)) drawCrystal(crystal, previewTime);
    if (visible.has(preview)) attract.render(previewTime, true);
  }
  if ($("#game-dialog").open && !document.hidden) {
    game.step(dt);
    game.render(previewTime);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
$("#game-start").addEventListener("click", () => {
  game.start();
  $("#game-start").textContent = "Restart";
});
$("#game-dialog").addEventListener("close", () => {
  game.stop();
  $("#game-start").textContent = "Start game";
});
for (const button of document.querySelectorAll("[data-filter]"))
  button.addEventListener("click", () => {
    for (const b of document.querySelectorAll("[data-filter]")) {
      b.classList.toggle("active", b === button);
      b.setAttribute("aria-pressed", String(b === button));
    }
    for (const card of document.querySelectorAll(".study"))
      card.hidden =
        button.dataset.filter !== "all" &&
        card.dataset.category !== button.dataset.filter;
    motion.sync();
  });
bindDialogs();
for (const dialog of document.querySelectorAll("dialog"))
  dialog.addEventListener("toggle", () => motion.sync());
