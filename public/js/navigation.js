import { STUDIOS } from "./navigation-data.js";

const PATHS = {
  image: "M3 3h18v18H3z M3 16l6-6 6 6 3-3 3 3 M16 7h.01",
  camera: "M3 7h13v13H3z M16 11l5-3v11l-5-3 M6 4h7",
  frame: "M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 8h8v8H8z",
  sun: "M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M5 19l1-1 M18 6l1-1 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  play: "M8 4l13 8-13 8z",
  chip: "M6 6h12v12H6z M9 9h6v6H9z M9 2v4 M15 2v4 M9 18v4 M15 18v4 M2 9h4 M2 15h4 M18 9h4 M18 15h4",
  spark: "M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z",
  scan: "M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M3 12h18 M8 8h.01 M16 8h.01 M8 16h.01 M16 16h.01",
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  film: "M3 3h18v18H3z M7 3v18 M17 3v18 M3 8h4 M3 16h4 M17 8h4 M17 16h4",
  cube: "M12 2l9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10",
  layers: "M12 2l10 6-10 6L2 8z M2 13l10 6 10-6 M2 18l10 6 10-6",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8",
  text: "M4 4h16 M12 4v16 M8 20h8",
  wave: "M3 10v4 M7 5v14 M12 2v20 M17 7v10 M21 10v4",
  download: "M12 2v13 M7 10l5 5 5-5 M3 17v4h18v-4",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c-5 5-5 13 0 18 M12 3c5 5 5 13 0 18",
  game: "M7 6h10l4 12-3 1-4-4h-4l-4 4-3-1z M6 10h6 M9 7v6 M16 10h.01 M18 13h.01",
  window:
    "M3 4h18v16H3z M3 9h18 M6 6.5h.01 M9 6.5h.01 M9 13l-3 2 3 2 M15 13l3 2-3 2",
  pen: "M3 21l2-6L17 3l4 4L9 19z M14 6l4 4 M3 21l6-2",
  cutout: "M3 7V3h4 M17 3h4v4 M21 17v4h-4 M7 21H3v-4 M12 7a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5 M7 18c1-3 3-4.5 5-4.5s4 1.5 5 4.5",
  expand: "M3 9V3h6 M3 3l7 7 M21 15v6h-6 M21 21l-7-7 M15 3h6v6 M9 21H3v-6",
  eraser: "M8 20l-5-5L14 4l7 7-9 9z M20 20H8 M9 9l7 7",
  file: "M5 2h9l5 5v15H5z M14 2v6h5 M8 12h8 M8 16h8",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  chevron: "M6 9l6 6 6-6",
  close: "M5 5l14 14 M19 5L5 19",
};

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", PATHS[name] || PATHS.spark);
  svg.append(path);
  return svg;
}

function card(item) {
  const a = node("a", "studio-link");
  a.href = item.href;
  const mark = node("span", "studio-icon");
  mark.append(icon(item.icon));
  const copy = node("span", "studio-link-copy");
  const title = node("span", "studio-link-title", item.label);
  if (item.badge) title.append(node("small", "studio-badge", item.badge));
  copy.append(title, node("span", "studio-link-detail", item.detail));
  a.append(mark, copy);
  return a;
}

export function initNavigation() {
  const header = document.querySelector("header.nav");
  const nav = header?.querySelector(".nav-links");
  if (!nav || header.dataset.studioNav) return;
  header.dataset.studioNav = "ready";
  const mobile = matchMedia("(max-width: 760px)");
  const hover = matchMedia("(hover: hover) and (pointer: fine)");
  const path = location.pathname.replace(/\/$/, "") || "/";
  const active = STUDIOS.find(
    (s) =>
      s.href === path ||
      path === `/studios/${s.id}` ||
      (["/film", "/music"].includes(path) && s.id === "video"),
  );
  const explore = node("a", "studio-explore", "Explore");
  explore.href = "/";
  if (path === "/") explore.setAttribute("aria-current", "page");
  nav.replaceChildren(explore);
  const workflows = node("a", "studio-explore", "Workflows"); workflows.href="/workflows/";
  if(path==="/workflows")workflows.setAttribute("aria-current","page");
  nav.append(workflows);
  const mobileProjects=node("a","studio-explore mobile-projects","My projects");mobileProjects.href="/projects/";nav.append(mobileProjects);
  const library=node("a","btn-ghost","My library");library.href="/library/";
  if(!header.querySelector('.nav-right a[href="/library/"]')) header.querySelector(".nav-right")?.prepend(library);
  // Every page links to the source, since being open is the point.
  const right=header.querySelector(".nav-right");
  if(right&&!right.querySelector('a[href^="https://github.com/ChuckGPTX/massless"]')){
    const gh=node("a","btn-ghost","GitHub");gh.href="https://github.com/ChuckGPTX/massless";gh.rel="noopener";
    const cta=right.querySelector(".btn-accent");cta?cta.before(gh):right.append(gh);
  }
  nav.id = "studio-navigation";

  const toggle = node("button", "studio-mobile-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", nav.id);
  toggle.setAttribute("aria-label", "Browse studios");
  toggle.append(
    node("span", "", active?.label || (path === "/workflows" ? "Workflows" : path === "/projects" ? "Projects" : path === "/library" ? "Library" : ["/edit","/build","/cut","/scene"].includes(path) ? "Create" : "Explore")),
    node("span", "studio-mobile-label", "Studios"),
    icon("chevron"),
  );
  nav.before(toggle);
  const entries = [];
  let opened = null;
  let hovered = false;
  let timer;

  function close(restoreFocus = false, closeMobile = false) {
    clearTimeout(timer);
    const previous = opened;
    if (opened) {
      opened.panel.hidden = true;
      opened.button.setAttribute("aria-expanded", "false");
      opened = null;
    }
    hovered = false;
    header.classList.remove("studio-open");
    if (closeMobile) {
      header.classList.remove("studios-mobile-open");
      toggle.setAttribute("aria-expanded", "false");
    }
    if (restoreFocus) (mobile.matches ? toggle : previous?.button)?.focus();
  }

  function open(entry, fromHover = false) {
    clearTimeout(timer);
    if (opened !== entry) close();
    opened = entry;
    hovered = fromHover;
    entry.panel.hidden = false;
    entry.button.setAttribute("aria-expanded", "true");
    header.classList.add("studio-open");
  }

  for (const studio of STUDIOS) {
    const wrap = node("div", "studio-menu");
    const top = node("div", "studio-menu-top");
    const destination = node("a", "studio-destination", studio.label);
    destination.href = `/studios/${studio.id}/`;
    if (active === studio) destination.setAttribute("aria-current", "page");
    const button = node("button", "studio-trigger");
    button.type = "button";
    button.id = `studio-trigger-${studio.id}`;
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", `studio-panel-${studio.id}`);
    button.setAttribute("aria-label", `${studio.label} tools and models`);
    button.append(icon("chevron"));
    if (active === studio) {
      button.classList.add("is-current");
      button.setAttribute("aria-current", "true");
    }
    const panel = node("div", "studio-panel");
    panel.id = `studio-panel-${studio.id}`;
    panel.hidden = true;
    panel.setAttribute("aria-labelledby", button.id);
    const head = node("div", "studio-panel-head");
    const intro = node("div");
    intro.append(
      node("strong", "studio-panel-title", studio.title),
      node("p", "", studio.subtitle),
    );
    const launch = node("a", "studio-launch", `Open ${studio.label} studio`);
    launch.href = studio.href;
    launch.append(icon("arrow"));
    head.append(intro, launch);
    const columns = node("div", "studio-columns");
    for (const [label, items] of [
      ["Features", studio.features],
      [studio.engineTitle, studio.engines],
    ]) {
      const column = node("section", "studio-column");
      const heading = node("h2", "studio-column-title", label);
      column.append(heading, ...items.map(card));
      columns.append(column);
    }
    const footer = node("div", "studio-panel-foot");
    footer.append(card(studio.feature), node("p", "studio-note", studio.note));
    panel.append(head, columns, footer);
    top.append(destination, button);
    wrap.append(top, panel);
    nav.append(wrap);
    const entry = { studio, button, panel, wrap };
    entries.push(entry);
    button.addEventListener("click", () => {
      if (opened === entry && !hovered) close();
      else open(entry);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        open(entry);
        panel.querySelector("a")?.focus();
      }
    });
    wrap.addEventListener("pointerenter", () => {
      clearTimeout(timer);
      if (
        !mobile.matches &&
        hover.matches &&
        !nav.contains(document.activeElement)
      ) {
        timer = setTimeout(() => open(entry, true), 130);
      }
    });
    wrap.addEventListener("pointerleave", () => {
      clearTimeout(timer);
      if (hovered && !wrap.contains(document.activeElement))
        timer = setTimeout(() => close(), 180);
    });
  }

  toggle.addEventListener("click", () => {
    if (toggle.getAttribute("aria-expanded") === "true") close(false, true);
    else {
      toggle.setAttribute("aria-expanded", "true");
      header.classList.add("studios-mobile-open");
      if (active) open(entries.find((e) => e.studio === active));
    }
  });
  header.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      (opened || toggle.getAttribute("aria-expanded") === "true")
    ) {
      event.preventDefault();
      event.stopPropagation();
      close(true, true);
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (!nav.contains(event.target) && !toggle.contains(event.target))
      close(false, true);
  });
  header.addEventListener("focusout", (event) => {
    if (
      event.relatedTarget &&
      !nav.contains(event.relatedTarget) &&
      event.relatedTarget !== toggle
    )
      close(false, true);
    else if (
      opened &&
      event.relatedTarget &&
      !opened.wrap.contains(event.relatedTarget)
    )
      close();
  });
  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) close(false, true);
  });
  mobile.addEventListener("change", () => close(false, true));
}

initNavigation();
