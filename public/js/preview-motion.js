/** One motion policy for videos and canvas/CSS previews. No offscreen playback. */
export function createPreviewMotion({
  videos,
  button,
  root = document.body,
  onChange = () => {},
  isSuspended = () => false,
}) {
  const media = [...videos];
  const preference = matchMedia("(prefers-reduced-motion: reduce)");
  const connection = navigator.connection;
  let paused = preference.matches || !!connection?.saveData;
  const visible = new Set();
  const allowed = (element) =>
    !paused && !document.hidden && !isSuspended() && visible.has(element);
  const sync = () => {
    root.classList.toggle(
      "previews-paused",
      paused || document.hidden || isSuspended(),
    );
    if (button) {
      button.textContent = paused ? "Play previews" : "Pause previews";
      button.setAttribute("aria-pressed", String(paused));
    }
    for (const video of media) {
      if (allowed(video)) {
        if (!video.getAttribute("src")) video.src = video.dataset.src;
        video
          .play()
          .then(() => {
            if (!allowed(video)) video.pause();
          })
          .catch(() => {});
      } else video.pause();
    }
    onChange(!paused && !document.hidden && !isSuspended());
  };
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        entry.isIntersecting && entry.intersectionRatio > 0
          ? visible.add(entry.target)
          : visible.delete(entry.target);
      sync();
    },
    { threshold: [0, 0.15] },
  );
  media.forEach((video) => observer.observe(video));
  button?.addEventListener("click", () => {
    paused = !paused;
    sync();
  });
  document.addEventListener("visibilitychange", sync);
  preference.addEventListener("change", () => {
    paused = preference.matches || !!connection?.saveData;
    sync();
  });
  connection?.addEventListener("change", () => {
    if (connection.saveData) paused = true;
    sync();
  });
  sync();
  return {
    sync,
    get playing() {
      return !paused && !document.hidden && !isSuspended();
    },
  };
}
