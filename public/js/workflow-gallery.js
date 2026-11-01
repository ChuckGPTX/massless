// The moving Workflows gallery: a marquee of loops, category chips and a masonry grid of video cards.
// Motion rules: transforms and opacity only; posters and videos load lazily; at most MAX_PLAYING loops play at
// once (the most visible ones); nothing plays off-screen, in a hidden tab, with Save-Data, or for anyone who
// prefers reduced motion (they get the posters).

export const MAX_PLAYING = 6;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

/** Plays the most visible loops, never more than `max`, and only when motion is welcome. */
export function createLoopPlayer({ max = MAX_PLAYING, root = document } = {}) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const ratio = new Map();
  const videos = new Set();
  const still = () => reduce.matches || !!navigator.connection?.saveData || document.hidden;
  let queued = false;
  const sync = () => {
    queued = false;
    const ranked = [...videos].filter((v) => (ratio.get(v) || 0) > 0).sort((a, b) => ratio.get(b) - ratio.get(a));
    const allowed = still() ? new Set() : new Set(ranked.slice(0, max));
    for (const v of videos) {
      if (allowed.has(v)) {
        if (!v.getAttribute("src")) v.src = v.dataset.src;
        const p = v.play();
        if (p) p.catch(() => {});
      } else if (!v.paused) v.pause();
    }
  };
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(sync);
    }
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) ratio.set(e.target, e.isIntersecting ? e.intersectionRatio * e.boundingClientRect.width * e.boundingClientRect.height : 0);
      schedule();
    },
    { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
  );
  // Posters load a screen ahead; reduced motion still shows them.
  const near = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        if (e.isIntersecting) {
          e.target.poster = e.target.dataset.poster;
          near.unobserve(e.target);
        }
    },
    { rootMargin: "600px 0px" },
  );
  reduce.addEventListener?.("change", schedule);
  document.addEventListener("visibilitychange", schedule);
  return {
    add(video) {
      videos.add(video);
      io.observe(video);
      near.observe(video);
      video.addEventListener("playing", () => video.classList.add("is-playing"), { once: true });
    },
    sync: schedule,
    get playing() {
      return [...videos].filter((v) => !v.paused).length;
    },
    get stillMode() {
      return still();
    },
  };
}

function loop(item) {
  const v = el("video");
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.preload = "none";
  v.setAttribute("muted", "");
  v.setAttribute("playsinline", "");
  v.setAttribute("aria-hidden", "true");
  v.disablePictureInPicture = true;
  v.dataset.src = item.video;
  v.dataset.poster = item.poster;
  return v;
}

export function cardFor(item, catName) {
  const a = el("a", "wf-card");
  a.href = item.href;
  a.dataset.cat = item.cat;
  a.dataset.id = item.id;
  a.setAttribute("role", "listitem");
  a.style.setProperty("--ar", item.ar);
  if (item.ar === "16/9") a.classList.add("is-wide");
  a.setAttribute("aria-label", `${item.name}. ${item.line}. ${catName}`);
  const inner = el("span", "wf-inner");
  const more = el("span", "wf-more");
  more.append(el("span", "wf-line", item.line), el("span", "wf-use", "Use workflow ↗"));
  inner.append(loop(item), el("span", "wf-name", item.name), more);
  a.append(inner);
  return a;
}

/** Masonry on a CSS grid: every card spans as many 2px rows as its aspect ratio needs. */
function masonry(grid) {
  const layout = () => {
    const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
    const colW = (grid.clientWidth - gap * (cols - 1)) / cols;
    grid.style.setProperty("--cols", cols);
    for (const c of grid.children) {
      if (c.hidden) continue;
      const span = c.classList.contains("is-wide") && cols > 1 ? 2 : 1;
      const [w, h] = c.style.getPropertyValue("--ar").split("/").map(Number);
      const height = ((colW * span + gap * (span - 1)) * h) / w;
      c.style.gridColumn = `span ${span}`;
      c.style.gridRowEnd = `span ${Math.ceil((height + gap) / 2)}`;
    }
  };
  new ResizeObserver(layout).observe(grid);
  layout();
  return layout;
}

export function mountGallery({ items, categories, featured, grid, chips, track, initial = "all" }) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const player = createLoopPlayer();
  const names = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  // marquee: the featured loops twice over, so the strip can slide forever
  const feat = featured.map((id) => items.find((x) => x.id === id)).filter(Boolean);
  for (const pass of [0, 1])
    for (const item of feat) {
      const a = el("a", "wf-tile");
      a.href = item.href;
      a.tabIndex = -1;
      a.style.setProperty("--ar", item.ar);
      const v = loop(item);
      a.append(v);
      if (pass) a.dataset.copy = "";
      track.append(a);
      player.add(v);
    }

  for (const item of items) {
    const c = cardFor(item, names[item.cat]);
    grid.append(c);
    player.add(c.querySelector("video"));
  }
  const layout = masonry(grid);

  // staggered entrance as cards scroll in
  const animate = () => !reduce.matches;
  if (animate()) grid.classList.add("wf-enter");
  const entrance = new IntersectionObserver(
    (entries) => {
      let i = 0;
      for (const e of entries)
        if (e.isIntersecting) {
          e.target.style.setProperty("--d", `${Math.min(i++, 8) * 55}ms`);
          e.target.classList.add("is-in");
          entrance.unobserve(e.target);
        }
    },
    { rootMargin: "0px 0px -6% 0px" },
  );
  for (const c of grid.children) entrance.observe(c);

  // touch: the first tap reveals the line and the action, the second opens the workflow
  const touch = matchMedia("(hover: none)");
  grid.addEventListener("click", (e) => {
    const c = e.target.closest(".wf-card");
    if (!c || !touch.matches || c.classList.contains("is-open")) return;
    e.preventDefault();
    grid.querySelector(".wf-card.is-open")?.classList.remove("is-open");
    c.classList.add("is-open");
  });

  // chips with FLIP filtering
  let current = "all";
  const buttons = [];
  for (const c of [{ id: "all", name: "All" }, ...categories]) {
    const b = el("button", "wf-chip", c.name);
    b.type = "button";
    b.dataset.cat = c.id;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => filter(c.id, true));
    buttons.push(b);
    chips.append(b);
  }
  function filter(cat, user = false) {
    if (!names[cat]) cat = "all";
    current = cat;
    for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset.cat === cat));
    const cards = [...grid.children];
    const before = new Map(cards.filter((c) => !c.hidden).map((c) => [c, c.getBoundingClientRect()]));
    for (const c of cards) c.hidden = !(cat === "all" || c.dataset.cat === cat);
    layout();
    if (user) {
      const url = new URL(location.href);
      url.hash = cat === "all" ? "" : cat;
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    if (animate() && user) {
      let k = 0;
      for (const c of cards) {
        if (c.hidden) continue;
        c.classList.add("is-in");
        const first = before.get(c);
        const last = c.getBoundingClientRect();
        if (first) {
          const dx = first.left - last.left, dy = first.top - last.top;
          const sx = first.width / last.width;
          if (Math.abs(dx) + Math.abs(dy) > 1 || Math.abs(sx - 1) > 0.01)
            c.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${sx})` }, { transform: "none" }], { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
        } else if (last.top < innerHeight && last.bottom > 0) {
          c.animate([{ opacity: 0, transform: "translateY(18px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: Math.min(k++, 10) * 35, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" });
        }
      }
    }
    if (user) {
      const top = chips.getBoundingClientRect().top;
      if (top < 0 || top > innerHeight * 0.6) chips.scrollIntoView({ block: "start", behavior: animate() ? "smooth" : "instant" });
    }
    player.sync();
  }
  filter(initial);
  return { filter, player, get current() { return current; } };
}
