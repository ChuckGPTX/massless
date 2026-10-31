import { createPreviewMotion } from "../preview-motion.js";
import { drawCrystal, createOrbitGame } from "../studio-demos.js";

const dialog = document.querySelector(".cinema-dialog");
const player = dialog.querySelector("video");
let opener;
const motion = createPreviewMotion({
  videos: document.querySelectorAll("video[data-src]"),
  isSuspended: () => dialog.open,
});
for (const button of document.querySelectorAll("[data-watch]")) {
  button.addEventListener("click", () => {
    opener = button;
    document.querySelector("#cinema-title").textContent = button.dataset.title;
    document.querySelector("#cinema-credit").textContent =
      button.dataset.credit;
    player.src = button.dataset.watch;
    dialog.showModal();
    motion.sync();
    player.play().catch(() => {});
  });
}
dialog
  .querySelector(".cinema-close")
  .addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  }
});
dialog.addEventListener("close", () => {
  player.pause();
  player.removeAttribute("src");
  player.load();
  motion.sync();
  opener?.focus();
});

const audio = document.querySelector("#audio-demo");
const listen = document.querySelector("#listen-demo");
if (audio && listen) {
  const syncAudio = () => {
    document.body.classList.toggle("is-listening", !audio.paused);
    listen.setAttribute("aria-pressed", String(!audio.paused));
    listen.textContent = audio.paused
      ? "▶ Listen to the demo"
      : "Ⅱ Pause demo";
  };
  listen.addEventListener("click", async () => {
    if (!audio.paused) audio.pause();
    else {
      try {
        await audio.play();
      } catch {
        listen.textContent = "Audio unavailable — try again";
      }
    }
  });
  ["play", "pause", "ended"].forEach((event) =>
    audio.addEventListener(event, syncAudio),
  );
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) audio.pause();
  });
}

const crystal = document.querySelector("#dimension-crystal");
const gameCanvas = document.querySelector("#studio-orbit");
const visible = new Set();
const observer = new IntersectionObserver((entries) => {
  for (const e of entries)
    e.isIntersecting ? visible.add(e.target) : visible.delete(e.target);
});
[crystal, gameCanvas].filter(Boolean).forEach((el) => observer.observe(el));
let game;
if (crystal) drawCrystal(crystal);
if (gameCanvas) {
  const start = document.querySelector("#orbit-start");
  game = createOrbitGame(gameCanvas, {
    status: document.querySelector("#orbit-status"),
    onEnd: () => {
      start.textContent = "Play again ↗";
    },
  });
  game.render(0, true);
  start.addEventListener("click", () => {
    game.start();
    gameCanvas.focus();
    start.textContent = "Restart ↗";
  });
}
let previous = performance.now(),
  time = 0;
function frame(now) {
  const dt = Math.min((now - previous) / 1000, 0.05);
  previous = now;
  if (motion.playing) {
    time += dt;
    if (crystal && visible.has(crystal)) drawCrystal(crystal, time);
    if (gameCanvas && visible.has(gameCanvas) && !game.running)
      game.render(time, true);
  }
  if (game?.running && !document.hidden && visible.has(gameCanvas)) {
    game.step(dt);
    game.render(time);
  }
  requestAnimationFrame(frame);
}
if (crystal || gameCanvas) requestAnimationFrame(frame);
