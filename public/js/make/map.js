// Illustrated map: a place or theme becomes an aerial map poster. FLUX.1 schnell paints the land (told to stay
// strictly top-down and wordless); every word, symbol, the legend, compass and scale are our own vector layer,
// drawn on canvas so labels stay editable (type them, or drag them on the map).

import { canvas, font, measure, text, fitSize, wrap, cover, grain, rng, hashStr, clamp } from './kit.js';

export const MAP_STYLES = {
  gouache: { name: 'Gouache', words: 'hand-painted gouache illustration, soft muted vintage palette, visible brush texture' },
  watercolour: { name: 'Watercolour', words: 'loose watercolour illustration, airy transparent washes, soft edges' },
  papercut: { name: 'Paper-cut', words: 'layered paper-cut collage illustration, soft shadows between paper layers, flat matte colours' },
  night: { name: 'Night lights', words: 'night-time illustration, deep blue tones, warm glowing windows and lanterns' },
};
const PAPERS = {
  cream: { ground: '#f2ece0', ink: '#2a2823', soft: '#7d776b', pill: 'rgba(246,241,231,0.92)' },
  white: { ground: '#fafaf7', ink: '#1c1e21', soft: '#7a7d82', pill: 'rgba(255,255,255,0.92)' },
  ink: { ground: '#141920', ink: '#efe8d8', soft: '#9aa1a8', pill: 'rgba(20,25,32,0.86)' },
};
const FORMATS = { portrait: [1800, 2400], square: [2000, 2000], landscape: [2400, 1800] };
const TITLES = {
  serif: { family: 'Fraunces', weight: 300, tracking: -0.02, upper: false },
  italic: { family: 'Instrument Serif', weight: 400, style: 'italic', tracking: -0.01, upper: false },
  grotesk: { family: 'Archivo', weight: 800, tracking: 0.06, upper: true },
};
const ICONS = ['circle', 'triangle', 'square', 'diamond', 'star', 'ring'];

export function mapPrompt(s) {
  const style = MAP_STYLES[s.style] || MAP_STYLES.gouache;
  return `${style.words}, an illustrated map of ${s.place.trim() || 'an imagined island'}: ${s.scene.trim() || 'small villages, fields and a coastline'}. Orthographic top-down view straight down, bird's-eye illustrated map, flat 2D cartographic illustration, no horizon, no perspective, no text, no labels, no letters`;
}
/** Labels: "Name" or "Name · Category" per line (max 12). */
export function parseLabels(src) {
  return String(src || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12).map((l) => {
    const [name, cat] = l.split(/\s*[·|]\s*/);
    return { name: name.slice(0, 40), cat: (cat || '').slice(0, 24) };
  });
}
export function legendOf(labels) {
  const cats = [];
  for (const l of labels) if (l.cat && !cats.includes(l.cat)) cats.push(l.cat);
  return cats.slice(0, ICONS.length).map((c, i) => ({ cat: c, icon: ICONS[i] }));
}
/** Spread label anchors over the map so no two start too close (seeded, deterministic). */
export function placeLabels(n, seed, existing = []) {
  const r = rng(seed), out = existing.slice(0, n).map((p) => [...p]);
  while (out.length < n) {
    let best = null, bestD = -1;
    for (let k = 0; k < 24; k++) {
      const p = [0.12 + r() * 0.62, 0.1 + r() * 0.8];
      const d = Math.min(1, ...out.map((q) => Math.hypot((p[0] - q[0]) * 1.4, p[1] - q[1])));
      if (d > bestD) { bestD = d; best = p; }
    }
    out.push(best);
  }
  return out;
}

function icon(ctx, kind, x, y, r, fill, stroke) {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = r * 0.42;
  ctx.beginPath();
  if (kind === 'triangle') { ctx.moveTo(x, y - r * 1.1); ctx.lineTo(x + r, y + r * 0.75); ctx.lineTo(x - r, y + r * 0.75); ctx.closePath(); }
  else if (kind === 'square') ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
  else if (kind === 'diamond') { ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r * 1.15, y); ctx.lineTo(x, y + r * 1.15); ctx.lineTo(x - r * 1.15, y); ctx.closePath(); }
  else if (kind === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.5 : r * 1.25; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } ctx.closePath(); }
  else ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  if (kind === 'ring') { ctx.fillStyle = stroke; ctx.fill(); ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fillStyle = fill; }
  ctx.fill();
  ctx.restore();
}

/** The painted land, masked with a feathered, brush-like edge (seeded so it is stable while you edit). */
function featheredLand(img, w, hgt, seed, night) {
  const land = canvas(w, hgt), g = land.getContext('2d');
  cover(g, img, 0, 0, w, hgt);
  if (night) { g.globalCompositeOperation = 'multiply'; g.fillStyle = '#8a97c4'; g.fillRect(0, 0, w, hgt); g.globalCompositeOperation = 'source-over'; }
  const mask = canvas(w, hgt), m = mask.getContext('2d'), r = rng(seed), f = Math.min(w, hgt) * 0.022;
  m.filter = `blur(${(f * 0.55).toFixed(1)}px)`;
  m.fillStyle = '#000';
  m.beginPath();
  const edge = (x0, y0, x1, y1, nx, ny) => {
    const steps = Math.round(Math.hypot(x1 - x0, y1 - y0) / (f * 0.8));
    let drift = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      drift = drift * 0.7 + (r() - 0.5) * f * 0.9;
      m.lineTo(x0 + (x1 - x0) * t + nx * (f * 1.2 + drift), y0 + (y1 - y0) * t + ny * (f * 1.2 + drift));
    }
  };
  edge(0, 0, w, 0, 0, 1); edge(w, 0, w, hgt, -1, 0); edge(w, hgt, 0, hgt, 0, -1); edge(0, hgt, 0, 0, 1, 0);
  m.closePath();
  m.fill();
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(mask, 0, 0);
  return land;
}

function compass(ctx, x, y, r, ink, ground) {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = r * 0.04;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, r * 0.72, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8, l = i % 4 ? 0.08 : 0.16;
    ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); ctx.lineTo(x + Math.cos(a) * r * (1 - l), y + Math.sin(a) * r * (1 - l)); ctx.stroke();
  }
  // needle: north half solid, south half outline
  ctx.fillStyle = ink;
  ctx.beginPath(); ctx.moveTo(x, y - r * 0.68); ctx.lineTo(x + r * 0.14, y); ctx.lineTo(x - r * 0.14, y); ctx.closePath(); ctx.fill();
  ctx.fillStyle = ground;
  ctx.beginPath(); ctx.moveTo(x, y + r * 0.68); ctx.lineTo(x + r * 0.14, y); ctx.lineTo(x - r * 0.14, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  font(ctx, { family: 'IBM Plex Mono', weight: 500, size: r * 0.3 });
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  text(ctx, 'N', x, y - r * 1.12);
  ctx.restore();
}
function scaleBar(ctx, x, y, w, ink, ground) {
  ctx.save();
  const seg = w / 4, hh = w * 0.035;
  ctx.strokeStyle = ink;
  ctx.lineWidth = hh * 0.18;
  for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? ground : ink; ctx.fillRect(x + i * seg, y, seg, hh); }
  ctx.strokeRect(x, y, w, hh);
  font(ctx, { family: 'IBM Plex Mono', weight: 400, size: hh * 1.25, tracking: 0.06 });
  ctx.fillStyle = ink;
  ctx.textAlign = 'right';
  text(ctx, 'ILLUSTRATIVE · NOT TO SCALE', x + w, y + hh * 3.4);
  ctx.restore();
}

export default {
  id: 'map',
  fields: [
    { key: 'place', label: 'Place or theme', max: 60 },
    { key: 'scene', label: 'What is in it', type: 'textarea', rows: 3, max: 300, hint: 'Painted from straight above. Your labels are added on top.' },
    { key: 'subtitle', label: 'Subtitle', max: 90 },
    { key: 'coords', label: 'Coordinates or a note', max: 60 },
    { key: 'labels', label: 'Labels', type: 'textarea', rows: 6, max: 600, hint: 'One per line. Add “· Category” to put it in the legend. Drag labels on the map to move them.' },
    { key: 'style', label: 'Illustration', type: 'select', options: Object.entries(MAP_STYLES).map(([k, v]) => [k, v.name]) },
    { key: 'paper', label: 'Paper', type: 'select', options: [['cream', 'Cream paper'], ['white', 'White paper'], ['ink', 'Ink (dark)']] },
    { key: 'title', label: 'Title type', type: 'select', options: [['serif', 'Light serif'], ['italic', 'Italic serif'], ['grotesk', 'Grotesk capitals']] },
    { key: 'format', label: 'Format', type: 'select', options: [['portrait', 'Portrait 3:4'], ['square', 'Square'], ['landscape', 'Landscape 4:3']] },
    { key: 'furniture', label: 'Compass, legend and scale', type: 'check' },
  ],
  presets: [
    {
      state: {
        place: 'Saltmere Island', scene: 'A small island town with turquoise coves, a harbour of tiny boats and a lighthouse on the point',
        subtitle: 'Summer · coves, harbour and the old light', coords: '37°04′ N · 25°28′ E',
        labels: 'The Old Light · Viewpoint\nHarbour Steps · Harbour\nFig Tree Cove · Swim\nUpper Town · Village\nOlive Terraces · Walk\nSouth Beach · Swim',
        style: 'gouache', paper: 'cream', title: 'serif', format: 'portrait', furniture: true, seed: 7, pos: [[0.52, 0.47], [0.24, 0.24], [0.66, 0.84], [0.54, 0.62], [0.2, 0.62], [0.15, 0.86]],
      },
      samples: { base: '/media/make/samples/map-island.webp' },
    },
  ],
  frames: () => 1,
  surprise(r) {
    const ideas = [
      ['Larkspur Valley', 'An alpine valley with a turquoise lake, pine forests and a small wooden village', 'Late spring · lake, forest and the high trail', '46°31′ N · 8°02′ E', 'Boathouse · Swim\nPine Hollow · Walk\nThe Village · Village\nHigh Pass · Viewpoint\nWaterfall · Viewpoint'],
      ['The Riverside Quarter', 'A river city with bridges, tree-lined boulevards, a market square and parks', 'A walking map · bridges, markets and parks', '51°03′ N · 3°43′ E', 'Market Square · Food\nIron Bridge · Viewpoint\nBotanic Park · Park\nOld Mill · Museum\nFlower Quay · Food'],
      ['Tamarind Bay', 'A tropical bay with coral reefs, palm groves and a fishing village on wooden piers', 'Dry season · reef, palms and the fishing pier', '12°17′ S · 49°18′ E', 'Coral Garden · Swim\nPalm Walk · Walk\nFishing Pier · Harbour\nMangrove Mouth · Boat\nVillage Well · Village'],
      ['Harvest Plains', 'Farmland in bloom with yellow mustard fields, a winding stream and small farms', 'Early bloom · fields, stream and farms', '29°53′ N · 77°18′ E', 'North Farm · Farm\nStream Ford · Walk\nWindbreak Trees · Viewpoint\nMarket Road · Food'],
      ['Kumo Terraces', 'Flooded rice paddies in spring with cherry blossom and a small shrine', 'Spring · blossom over flooded paddies', '37°55′ N · 139°02′ E', 'Shrine Gate · Visit\nBlossom Row · Viewpoint\nRiver Path · Walk\nTea House · Food'],
    ];
    const [place, scene, subtitle, coords, labels] = ideas[Math.floor(r() * ideas.length)];
    return { place, scene, subtitle, coords, labels, pos: [], style: ['gouache', 'watercolour', 'papercut', 'gouache'][Math.floor(r() * 4)], paper: r() < 0.8 ? 'cream' : 'ink', title: ['serif', 'italic', 'grotesk'][Math.floor(r() * 3)], seed: Math.floor(r() * 1e6) };
  },
  async build(s, io) {
    const [W, H] = FORMATS[s.format] || FORMATS.portrait;
    const side = s.format === 'landscape';
    const m = Math.round(Math.min(W, H) * 0.07);
    const box = side
      ? { x: m, y: m, w: Math.round(W * 0.66 - m), h: H - 2 * m }
      : { x: m, y: m, w: W - 2 * m, h: Math.round(H - m - (s.format === 'square' ? H * 0.2 : H * 0.215)) };
    const prompt = mapPrompt(s);
    const img = await io.image('base', prompt, box.w > box.h ? 1024 : 768, box.w > box.h ? 768 : 1024, 1000 + (hashStr(s.place) % 9000));
    io.status('Drawing the map layer…');
    const land = featheredLand(img, box.w, box.h, 31 + (s.seed || 0), s.style === 'night');
    const c = canvas(W, H);
    let rects = [];
    const paint = (st, ctx) => {
      const P = PAPERS[st.paper] || PAPERS.cream;
      const labels = parseLabels(st.labels);
      const legend = legendOf(labels);
      st.pos = placeLabels(labels.length, 97 + (st.seed || 0), st.pos || []);
      ctx.fillStyle = P.ground;
      ctx.fillRect(0, 0, W, H);
      grain(ctx, W, H, st.paper === 'ink' ? 0.05 : 0.09, 3);
      ctx.drawImage(land, box.x, box.y);
      // labels
      rects = [];
      const fs = Math.round(Math.min(W, H) * 0.0165);
      labels.forEach((l, i) => {
        const [nx, ny] = st.pos[i];
        const x = box.x + nx * box.w, y = box.y + ny * box.h;
        const ic = legend.find((g) => g.cat === l.cat)?.icon || 'circle';
        font(ctx, { family: 'Space Grotesk', weight: 700, size: fs, tracking: 0.07 });
        const label = l.name.toUpperCase(), tw = measure(ctx, label), padX = fs * 0.62, ph = fs * 1.9, pw = tw + padX * 2;
        const right = x + fs * 1.1 + pw < box.x + box.w;
        const px = right ? x + fs * 1.05 : x - fs * 1.05 - pw, py = y - ph / 2;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.18)';
        ctx.shadowBlur = fs * 0.6;
        ctx.shadowOffsetY = fs * 0.12;
        ctx.fillStyle = P.pill;
        ctx.beginPath(); ctx.roundRect(px, py, pw, ph, ph / 2); ctx.fill();
        ctx.restore();
        icon(ctx, ic, x, y, fs * 0.46, P.ink, P.ground);
        ctx.fillStyle = P.ink;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        text(ctx, label, px + padX, y + fs * 0.06);
        rects.push([Math.min(px, x - fs) / W, py / H, (Math.max(px + pw, x + fs)) / W, (py + ph) / H]);
      });
      // caption block
      const T = TITLES[st.title] || TITLES.serif;
      const title = T.upper ? st.place.toUpperCase() : st.place;
      ctx.fillStyle = P.ink;
      ctx.textBaseline = 'alphabetic';
      if (side) {
        const x = box.x + box.w + m * 0.9, w = W - x - m;
        let y = m + H * 0.02;
        font(ctx, { family: 'IBM Plex Mono', weight: 500, size: H * 0.0125, tracking: 0.12 });
        ctx.textAlign = 'left';
        ctx.fillStyle = P.soft;
        text(ctx, 'AN ILLUSTRATED MAP', x, y);
        ctx.fillStyle = P.ink;
        const tSize = Math.min(H * 0.09, fitSize(ctx, wrapTitle(title), T, w));
        font(ctx, { ...T, size: tSize });
        const tl = wrap(ctx, title, w);
        y += tSize * 1.05;
        for (const line of tl) { text(ctx, line, x, y); y += tSize * 0.98; }
        font(ctx, { family: 'Instrument Sans', weight: 400, size: H * 0.019 });
        ctx.fillStyle = P.ink;
        for (const line of wrap(ctx, st.subtitle, w)) { y += H * 0.012; text(ctx, line, x, y); y += H * 0.014; }
        font(ctx, { family: 'IBM Plex Mono', weight: 400, size: H * 0.0125, tracking: 0.06 });
        ctx.fillStyle = P.soft;
        y += H * 0.03;
        text(ctx, st.coords, x, y);
        if (st.furniture) {
          legendBlock(ctx, legend, x, y + H * 0.07, H * 0.016, P);
          compass(ctx, x + w * 0.2, H - m - H * 0.17, H * 0.06, P.ink, P.ground);
          scaleBar(ctx, x, H - m - H * 0.035, w * 0.8, P.ink, P.ground);
        }
      } else {
        const top = box.y + box.h + H * 0.012, foot = H - m * 0.6 - top, cx = W / 2;
        const colW = W * 0.5;
        font(ctx, { family: 'IBM Plex Mono', weight: 500, size: W * 0.0105, tracking: 0.14 });
        ctx.fillStyle = P.soft;
        ctx.textAlign = 'center';
        text(ctx, 'AN ILLUSTRATED MAP', cx, top + foot * 0.2);
        ctx.fillStyle = P.ink;
        const tSize = Math.min(foot * 0.38, fitSize(ctx, [title], T, colW));
        font(ctx, { ...T, size: tSize });
        text(ctx, title, cx, top + foot * 0.2 + tSize * 1.02);
        font(ctx, { family: 'Instrument Sans', weight: 400, size: W * 0.0155 });
        const sub = wrap(ctx, st.subtitle, colW)[0] || '';
        text(ctx, sub, cx, top + foot * 0.2 + tSize * 1.02 + W * 0.033);
        font(ctx, { family: 'IBM Plex Mono', weight: 400, size: W * 0.0105, tracking: 0.08 });
        ctx.fillStyle = P.soft;
        text(ctx, st.coords, cx, top + foot * 0.2 + tSize * 1.02 + W * 0.062);
        if (st.furniture) {
          legendBlock(ctx, legend, m + W * 0.01, top + foot * 0.2 - W * 0.006, W * 0.0118, P);
          const r = Math.min(foot * 0.2, W * 0.045);
          compass(ctx, W - m - r * 1.3 - W * 0.01, top + foot * 0.18 + r * 1.2, r, P.ink, P.ground);
          scaleBar(ctx, W - m - W * 0.2, top + foot * 0.18 + r * 2.85, W * 0.19, P.ink, P.ground);
        }
      }
    };
    paint(s, c.getContext('2d'));
    const board = {
      id: 'map-poster', label: `Map poster · ${s.place}`, canvas: c, size: 'hero', print: true,
      drag: {
        hit: (st, nx, ny) => rects.findIndex(([x0, y0, x1, y1]) => nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1),
        move: (st, i, nx, ny) => { st.pos[i] = [clamp((nx * W - box.x) / box.w, 0.03, 0.97), clamp((ny * H - box.y) / box.h, 0.03, 0.97)]; },
        redraw: (st, cv) => paint(st, cv.getContext('2d')),
      },
    };
    return { name: s.place, prompt, boards: [board], layout: 'single', patch: { pos: s.pos } };
  },
};

function wrapTitle(t) { return String(t).split(/\s+/); }
function legendBlock(ctx, legend, x, y, size, P) {
  if (!legend.length) return;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  font(ctx, { family: 'IBM Plex Mono', weight: 500, size: size * 0.82, tracking: 0.14 });
  ctx.fillStyle = P.soft;
  text(ctx, 'LEGEND', x, y);
  font(ctx, { family: 'Instrument Sans', weight: 400, size });
  legend.forEach((g, i) => {
    const yy = y + size * 2.3 + i * size * 1.9;
    icon(ctx, g.icon, x + size * 0.5, yy, size * 0.42, P.ink, P.ground);
    ctx.fillStyle = P.ink;
    text(ctx, g.cat, x + size * 1.5, yy + size * 0.05);
  });
  ctx.restore();
}
