// Brand identity kit: a name and a vibe become a coherent identity, drawn entirely in the browser.
// Wordmark in an OFL face with tuned tracking, a generated SVG monogram/mark, an OKLCH palette checked for
// contrast, a type pairing, a pattern built from the mark, six applications and a presentation board.

import { canvas, font, measure, text, fitSize, wrap, rng, hashStr, oklch, contrast, bestInk, oklchString, fontURL, FACES, slug } from './kit.js';

export const VIBES = {
  playful: { name: 'Playful', display: { family: 'Bricolage Grotesque', weight: 800, tracking: -0.045 }, lower: true, hues: [335, 255, 145, 28], L: 0.66, C: 0.2, marks: ['blob', 'petal', 'pills'], radius: 0.5 },
  bold: { name: 'Bold', display: { family: 'Archivo Black', weight: 400, tracking: -0.025 }, upper: true, hues: [27, 262, 300, 150], L: 0.6, C: 0.21, marks: ['slab', 'stripes', 'quarters'], radius: 0.08 },
  calm: { name: 'Calm', display: { family: 'Fraunces', weight: 300, tracking: -0.03 }, lower: true, hues: [205, 155, 230, 280], L: 0.64, C: 0.085, marks: ['arch', 'ring', 'waves'], radius: 0.28 },
  luxe: { name: 'Luxe', display: { family: 'DM Serif Display', weight: 400, tracking: 0.06 }, upper: true, hues: [22, 310, 165, 60], L: 0.36, C: 0.075, marks: ['ring', 'frame', 'arch'], radius: 0.02 },
  tech: { name: 'Tech', display: { family: 'Unbounded', weight: 700, tracking: -0.035 }, lower: true, hues: [268, 192, 135, 300], L: 0.58, C: 0.19, marks: ['dots', 'quarters', 'stripes'], radius: 0.18 },
  organic: { name: 'Organic', display: { family: 'Fraunces', weight: 900, tracking: -0.035 }, lower: true, hues: [128, 48, 88, 20], L: 0.52, C: 0.12, marks: ['leaf', 'petal', 'waves'], radius: 0.36 },
};
const BODY = { family: 'Instrument Sans', weight: 400 };
const BODY_B = { family: 'Instrument Sans', weight: 600 };
const MONO = { family: 'IBM Plex Mono', weight: 500 };

/** OKLCH palette for a vibe: primary, secondary, accent, ink and paper, all inside sRGB. */
export function palette(vibe, seed) {
  const v = VIBES[vibe] || VIBES.playful, r = rng(seed);
  const h = (v.hues[Math.floor(r() * v.hues.length)] + (r() - 0.5) * 16 + 360) % 360;
  const dark = v.L < 0.45;
  const p = {
    primary: oklch(v.L, v.C, h),
    secondary: oklch(dark ? 0.88 : 0.87, v.C * 0.55, (h + (dark ? 40 : 150)) % 360),
    accent: oklch(dark ? 0.74 : 0.79, v.C * (dark ? 1.4 : 0.85), (h + (dark ? 65 : 290)) % 360),
    ink: oklch(0.2, Math.min(0.04, v.C * 0.3), h),
    paper: oklch(0.975, 0.012, (h + 40) % 360),
  };
  return { ...p, hue: Math.round(h), onPrimary: bestInk(p.primary, p.paper, p.ink), onSecondary: bestInk(p.secondary, p.paper, p.ink), onAccent: bestInk(p.accent, p.paper, p.ink) };
}
/** Every text pairing the kit uses, with its WCAG ratio. */
export function contrastReport(p) {
  return [
    ['ink on paper', contrast(p.ink, p.paper)],
    ['text on primary', contrast(p.onPrimary, p.primary)],
    ['text on secondary', contrast(p.onSecondary, p.secondary)],
    ['text on accent', contrast(p.onAccent, p.accent)],
    ['paper on ink', contrast(p.paper, p.ink)],
  ];
}

// ---------- the mark: SVG path data on a 100-unit grid (Path2D draws the same data on canvas) ----------

const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const rrect = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
const f = (n) => +n.toFixed(2);
export const MARKS = {
  blob: { letter: true, d: () => { let d = ''; for (let i = 0; i <= 64; i++) { const a = (i / 64) * Math.PI * 2, rr = 44 + 3.2 * Math.sin(a * 5); d += `${i ? 'L' : 'M'}${f(50 + Math.cos(a) * rr)} ${f(50 + Math.sin(a) * rr)}`; } return d + 'Z'; } },
  petal: { letter: false, d: () => [[50, 27], [73, 50], [50, 73], [27, 50]].map(([x, y]) => circ(x, y, 23)).join('') + circ(50, 50, 9) },
  pills: { letter: false, d: () => rrect(8, 16, 56, 30, 15) + rrect(36, 54, 56, 30, 15) },
  slab: { letter: true, d: () => rrect(6, 6, 88, 88, 6) },
  stripes: { letter: false, d: () => { let d = ''; for (let i = 0; i < 6; i++) { const y0 = 7 + i * 15, y = y0 + 5, half = Math.sqrt(Math.max(0, 43 ** 2 - (y - 50) ** 2)); d += rrect(f(50 - half), y0, f(half * 2), 10, 5); } return d; } },
  quarters: { letter: false, d: () => 'M6 50A44 44 0 0 1 50 6V50Z' + 'M94 50A44 44 0 0 1 50 94V50Z' + 'M54 6h40v40h-40Z' + circ(28, 72, 18) },
  arch: { letter: false, evenodd: true, d: () => 'M12 94V50a38 38 0 0 1 76 0V94Z' + 'M30 94V54a20 20 0 0 1 40 0V94Z' },
  ring: { letter: true, ringLetter: true, evenodd: true, d: () => circ(50, 50, 46) + circ(50, 50, 39) },
  waves: { letter: false, d: () => { let d = ''; for (let k = 0; k < 3; k++) { const y = 26 + k * 24; let top = '', bot = ''; for (let i = 0; i <= 20; i++) { const x = 8 + i * 4.2; top += `${i ? 'L' : 'M'}${f(x)} ${f(y + Math.sin(i / 3) * 5)}`; bot = `L${f(x)} ${f(y + 11 + Math.sin(i / 3) * 5)}` + bot; } d += top + bot.replace(/^L/, 'L') + 'Z'; } return d; } },
  frame: { letter: true, ringLetter: true, evenodd: true, d: () => 'M50 2L98 50L50 98L2 50Z' + 'M50 10L90 50L50 90L10 50Z' },
  dots: { letter: false, d: () => { let d = ''; for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) d += x === 2 && y === 0 ? rrect(68, 4, 28, 28, 6) : circ(18 + x * 32, 18 + y * 32, 12); return d; } },
  leaf: { letter: false, evenodd: true, d: () => 'M50 4C84 26 84 74 50 96C16 74 16 26 50 4Z' + 'M48.5 18h3v70h-3Z' },
};
export function pickMark(vibe, seed) {
  const v = VIBES[vibe] || VIBES.playful;
  return v.marks[seed % v.marks.length];
}
const initialOf = (name) => (String(name).trim().match(/[A-Za-z0-9]/) || ['C'])[0].toUpperCase();
export function markSVG(markId, color, letter, letterColor, fontFamily, fontCSS = '') {
  const m = MARKS[markId];
  const t = m.letter ? `<text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-family="'${fontFamily}'" font-size="${m.ringLetter ? 46 : 54}" fill="${m.ringLetter ? color : letterColor}">${letter}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">${fontCSS ? `<style>${fontCSS}</style>` : ''}<path d="${m.d()}" fill="${color}"${m.evenodd ? ' fill-rule="evenodd"' : ''}/>${t}</svg>`;
}

function drawMark(ctx, id, x, y, size, color, letterColor, name, display) {
  const m = MARKS[id];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(m.d()), m.evenodd ? 'evenodd' : 'nonzero');
  if (m.letter) {
    font(ctx, { ...display, tracking: 0, size: m.ringLetter ? 46 : 54 });
    ctx.fillStyle = m.ringLetter ? color : letterColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const met = ctx.measureText(initialOf(name));
    const off = (met.actualBoundingBoxAscent - met.actualBoundingBoxDescent) / 2;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(initialOf(name), 50, 50 + off);
  }
  ctx.restore();
}

const wordOf = (s, v) => (v.upper ? s.name.toUpperCase() : v.lower ? s.name.toLowerCase() : s.name);
/** Wordmark fitted to a width (and max height), drawn centred at (cx, baseline-centre cy). */
function wordmark(ctx, s, v, cx, cy, maxW, maxH, color) {
  const word = wordOf(s, v);
  let size = Math.min(fitSize(ctx, [word], v.display, maxW), maxH);
  font(ctx, { ...v.display, size });
  const met = ctx.measureText(word);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  text(ctx, word, cx, cy + (met.actualBoundingBoxAscent - met.actualBoundingBoxDescent) / 2);
  return size;
}
function patternTile(id, size, fg, bg, accent) {
  const c = canvas(size * 2, size * 2), g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  const k = size * 0.62, o = (size - k) / 2;
  [[0, 0, fg, 0], [size, 0, accent, 1], [0, size, accent, 1], [size, size, fg, 0]].forEach(([x, y, col, rot]) => {
    g.save();
    g.translate(x + size / 2, y + size / 2);
    g.rotate((rot * Math.PI) / 2);
    g.translate(-size / 2, -size / 2);
    g.translate(o, o);
    g.scale(k / 100, k / 100);
    g.fillStyle = col;
    g.fill(new Path2D(MARKS[id].d()), MARKS[id].evenodd ? 'evenodd' : 'nonzero');
    g.restore();
  });
  return c;
}
function fillPattern(ctx, tile, x, y, w, h, r = 0) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.clip();
  ctx.translate(x, y);
  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
function mono(ctx, str, x, y, size, color, align = 'left', tracking = 0.08) {
  font(ctx, { ...MONO, size, tracking });
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  text(ctx, str.toUpperCase(), x, y);
}
function body(ctx, str, x, y, size, color, spec = BODY, align = 'left') {
  font(ctx, { ...spec, size });
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  text(ctx, str, x, y);
}
function shadowed(ctx, fn, blur = 30, y = 12, alpha = 0.22) {
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = y;
  fn();
  ctx.restore();
}

// ---------- applications ----------

function cardFront(s, v, P, id) {
  const c = canvas(1050, 600), g = c.getContext('2d');
  g.fillStyle = P.primary; g.fillRect(0, 0, 1050, 600);
  wordmark(g, s, v, 525, 290, 760, 190, P.onPrimary);
  mono(g, s.tagline, 525, 540, 20, P.onPrimary, 'center', 0.14);
  return c;
}
function cardBack(s, v, P, id, tile) {
  const c = canvas(1050, 600), g = c.getContext('2d');
  g.fillStyle = P.paper; g.fillRect(0, 0, 1050, 600);
  fillPattern(g, tile, 790, 0, 260, 600);
  drawMark(g, id, 70, 70, 96, P.primary, P.paper, s.name, v.display);
  body(g, s.person, 70, 380, 40, P.ink, BODY_B);
  body(g, s.role, 70, 428, 26, P.ink);
  mono(g, s.contact, 70, 520, 19, P.ink, 'left', 0.06);
  return c;
}
function poster(s, v, P, id, tile) {
  const c = canvas(1200, 1800), g = c.getContext('2d');
  g.fillStyle = P.primary; g.fillRect(0, 0, 1200, 1800);
  fillPattern(g, tile, 0, 1180, 1200, 620);
  mono(g, s.what, 80, 120, 26, P.onPrimary, 'left', 0.14);
  mono(g, 'EST. 2026', 1120, 120, 26, P.onPrimary, 'right', 0.14);
  const words = wordOf(s, v).split(/\s+/);
  const lines = words.length > 1 ? words : [wordOf(s, v)];
  const size = Math.min(fitSize(g, lines, v.display, 1040), 700 / lines.length / 0.93);
  font(g, { ...v.display, size });
  g.fillStyle = P.onPrimary; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  lines.forEach((l, i) => text(g, l, 80, 200 + size * 0.82 + i * size * 0.93));
  font(g, { ...BODY, size: 46 });
  const tl = wrap(g, s.tagline, 760).slice(0, 3);
  tl.forEach((l, i) => body(g, l, 80, 1120 - (tl.length - 1 - i) * 56, 46, P.onPrimary));
  shadowed(g, () => { g.fillStyle = P.paper; g.beginPath(); g.arc(1030, 1180, 100, 0, Math.PI * 2); g.fill(); });
  drawMark(g, id, 966, 1116, 128, P.primary, P.paper, s.name, v.display);
  return c;
}
function social(s, v, P, id, tile) {
  const c = canvas(1080, 1350), g = c.getContext('2d');
  fillPattern(g, tile, 0, 0, 1080, 1350);
  shadowed(g, () => { g.fillStyle = P.paper; g.beginPath(); g.roundRect(110, 300, 860, 750, 860 * v.radius * 0.18 + 12); g.fill(); }, 50, 18, 0.25);
  drawMark(g, id, 470, 380, 140, P.primary, P.paper, s.name, v.display);
  font(g, { ...v.display, size: 80 });
  const lines = wrap(g, s.tagline, 720).slice(0, 3);
  const size = Math.min(84, fitSize(g, lines, v.display, 720));
  font(g, { ...v.display, size });
  g.fillStyle = P.ink; g.textAlign = 'center';
  lines.forEach((l, i) => text(g, l, 540, 690 + i * size * 1.04 - ((lines.length - 1) * size * 1.04) / 2));
  const pillW = 360;
  g.fillStyle = P.primary; g.beginPath(); g.roundRect(540 - pillW / 2, 900, pillW, 76, 38); g.fill();
  mono(g, wordOf(s, v).length > 18 ? 'NEW SEASON' : wordOf(s, v), 540, 948, 26, P.onPrimary, 'center', 0.12);
  return c;
}
function sign(s, v, P, id) {
  const c = canvas(1200, 900), g = c.getContext('2d');
  const wall = oklch(0.86, 0.02, P.hue + 40);
  g.fillStyle = wall; g.fillRect(0, 0, 1200, 900);
  g.strokeStyle = 'rgba(0,0,0,0.05)'; g.lineWidth = 2;
  for (let y = 60; y < 900; y += 72) { g.beginPath(); g.moveTo(0, y); g.lineTo(1200, y); g.stroke(); }
  g.fillStyle = P.ink;
  g.fillRect(120, 150, 26, 120);
  g.fillRect(120, 190, 560, 16);
  [[300, 206], [560, 206]].forEach(([x, y]) => { g.fillRect(x, y, 6, 70); });
  shadowed(g, () => { g.fillStyle = P.primary; g.beginPath(); g.arc(433, 530, 260, 0, Math.PI * 2); g.fill(); }, 60, 40, 0.3);
  g.strokeStyle = P.onPrimary; g.lineWidth = 6; g.beginPath(); g.arc(433, 530, 236, 0, Math.PI * 2); g.stroke();
  drawMark(g, id, 433 - 80, 360, 160, P.onPrimary, P.primary, s.name, v.display);
  wordmark(g, s, v, 433, 640, 360, 80, P.onPrimary);
  shadowed(g, () => { g.fillStyle = P.paper; g.beginPath(); g.roundRect(800, 300, 300, 420, 12); g.fill(); }, 30, 14, 0.18);
  mono(g, 'OPEN', 950, 380, 34, P.ink, 'center', 0.2);
  ['MON–FRI  8–18', 'SAT  9–16', 'SUN  CLOSED'].forEach((l, i) => mono(g, l, 950, 470 + i * 56, 22, P.ink, 'center', 0.04));
  drawMark(g, id, 920, 640, 60, P.primary, P.paper, s.name, v.display);
  return c;
}
function tote(s, v, P, id) {
  const c = canvas(1000, 1200), g = c.getContext('2d');
  g.fillStyle = P.secondary; g.fillRect(0, 0, 1000, 1200);
  const canvasCol = oklch(0.93, 0.03, 80);
  g.strokeStyle = oklch(0.84, 0.035, 80); g.lineWidth = 34; g.lineCap = 'round';
  g.beginPath(); g.moveTo(330, 420); g.bezierCurveTo(330, 120, 670, 120, 670, 420); g.stroke();
  shadowed(g, () => { g.fillStyle = canvasCol; g.beginPath(); g.moveTo(190, 380); g.lineTo(810, 380); g.lineTo(840, 1110); g.lineTo(160, 1110); g.closePath(); g.fill(); }, 50, 26, 0.25);
  g.strokeStyle = 'rgba(0,0,0,0.06)'; g.lineWidth = 2; g.setLineDash([10, 9]);
  g.beginPath(); g.moveTo(196, 410); g.lineTo(804, 410); g.stroke(); g.setLineDash([]);
  drawMark(g, id, 400, 560, 200, P.primary, canvasCol, s.name, v.display);
  wordmark(g, s, v, 500, 880, 470, 110, P.ink);
  mono(g, s.what, 500, 970, 20, P.ink, 'center', 0.16);
  return c;
}
function stickers(s, v, P, id) {
  const c = canvas(1080, 1080), g = c.getContext('2d');
  g.fillStyle = P.accent; g.fillRect(0, 0, 1080, 1080);
  const sticker = (fn) => shadowed(g, fn, 24, 10, 0.2);
  sticker(() => { g.fillStyle = '#ffffff'; g.beginPath(); g.arc(300, 300, 200, 0, Math.PI * 2); g.fill(); });
  g.fillStyle = P.primary; g.beginPath(); g.arc(300, 300, 180, 0, Math.PI * 2); g.fill();
  drawMark(g, id, 200, 200, 200, P.onPrimary, P.primary, s.name, v.display);
  g.save(); g.translate(720, 330); g.rotate(-0.12);
  sticker(() => { g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(-260, -95, 520, 190, 95); g.fill(); });
  g.fillStyle = P.ink; g.beginPath(); g.roundRect(-244, -79, 488, 158, 79); g.fill();
  wordmark(g, s, v, 0, 0, 400, 90, P.paper);
  g.restore();
  g.save(); g.translate(330, 790); g.rotate(0.1);
  sticker(() => { g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(0, 0, 250, 150, 0, 0, Math.PI * 2); g.fill(); });
  g.fillStyle = P.secondary; g.beginPath(); g.ellipse(0, 0, 232, 132, 0, 0, Math.PI * 2); g.fill();
  font(g, { ...BODY_B, size: 40 });
  const tl = wrap(g, s.tagline, 360).slice(0, 2);
  tl.forEach((l, i) => body(g, l, 0, 14 + i * 46 - (tl.length - 1) * 23, 40, P.onSecondary, BODY_B, 'center'));
  g.restore();
  sticker(() => { g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(700, 640, 280, 280, 60); g.fill(); });
  g.fillStyle = P.paper; g.beginPath(); g.roundRect(716, 656, 248, 248, 48); g.fill();
  drawMark(g, id, 750, 690, 180, P.primary, P.paper, s.name, v.display);
  return c;
}

function board(s, v, P, id, tile, apps) {
  const W = 2400, H = 1600, c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = P.paper; g.fillRect(0, 0, W, H);
  mono(g, `Brand identity / ${s.name} / v1`, 80, 104, 20, P.ink, 'left', 0.12);
  mono(g, `${v.name} · ${s.what}`, 1200, 104, 20, P.ink, 'left', 0.12);
  mono(g, 'Made with Chucksi', W - 80, 104, 20, P.ink, 'right', 0.12);
  g.fillStyle = P.ink; g.fillRect(80, 128, W - 160, 2);
  // wordmark panel
  const R = 28;
  g.fillStyle = P.primary; g.beginPath(); g.roundRect(80, 170, 1060, 470, R); g.fill();
  wordmark(g, s, v, 610, 395, 860, 230, P.onPrimary);
  mono(g, 'Primary wordmark', 116, 216, 17, P.onPrimary, 'left', 0.12);
  mono(g, `${v.display.family} ${v.display.weight} · tracking ${Math.round(v.display.tracking * 1000) / 10}%`, 116, 610, 17, P.onPrimary, 'left', 0.06);
  // mark tiles
  const tileBox = (x, bg, fg, letterBg, label) => {
    g.fillStyle = bg; g.beginPath(); g.roundRect(x, 670, 330, 330, R); g.fill();
    drawMark(g, id, x + 85, 735, 160, fg, letterBg, s.name, v.display);
    mono(g, label, x + 30, 970, 15, bestInk(bg, P.paper, P.ink), 'left', 0.12);
  };
  tileBox(80, oklch(0.93, 0.02, P.hue + 40), P.primary, P.paper, 'Mark');
  tileBox(445, P.ink, P.paper, P.ink, 'Mark, reversed');
  // type specimen
  g.fillStyle = P.secondary; g.beginPath(); g.roundRect(810, 670, 330, 330, R); g.fill();
  font(g, { ...v.display, size: 150, tracking: 0 });
  g.fillStyle = P.onSecondary; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  text(g, 'Aa', 840, 830);
  body(g, v.display.family, 842, 890, 24, P.onSecondary, BODY_B);
  body(g, 'Instrument Sans · IBM Plex Mono', 842, 924, 19, P.onSecondary);
  mono(g, 'Type pairing', 842, 970, 15, P.onSecondary, 'left', 0.12);
  // palette
  const sw = [['Primary', P.primary], ['Secondary', P.secondary], ['Accent', P.accent], ['Ink', P.ink], ['Paper', P.paper]];
  const swW = (1060 - 4 * 16) / 5;
  sw.forEach(([name, hex], i) => {
    const x = 80 + i * (swW + 16), ink = bestInk(hex, P.paper, P.ink);
    g.fillStyle = hex; g.beginPath(); g.roundRect(x, 1030, swW, 230, R * 0.7); g.fill();
    if (hex === P.paper) { g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 2; g.stroke(); }
    body(g, name, x + 20, 1078, 24, ink, BODY_B);
    mono(g, hex, x + 20, 1214, 16, ink, 'left', 0.04);
    mono(g, oklchString(hex).replace('oklch', ''), x + 20, 1240, 13, ink, 'left', 0);
  });
  fillPattern(g, tile, 80, 1290, 1060, 230, R);
  // applications
  const cells = [['01 Poster', apps.poster], ['02 Business card', [apps.cardFront, apps.cardBack]], ['03 Social post', apps.social], ['04 Shop sign', apps.sign], ['05 Tote bag', apps.tote], ['06 Stickers', apps.stickers]];
  const cw = (1100 - 2 * 20) / 3, ch = (1350 - 20) / 2;
  cells.forEach(([label, img], i) => {
    const x = 1220 + (i % 3) * (cw + 20), y = 170 + Math.floor(i / 3) * (ch + 20);
    g.fillStyle = oklch(0.94, 0.015, P.hue + 40); g.beginPath(); g.roundRect(x, y, cw, ch, R); g.fill();
    const area = { x: x + 24, y: y + 24, w: cw - 48, h: ch - 90 };
    const list = Array.isArray(img) ? img : [img];
    const gap = 22, k = Math.min(area.w / list[0].width, (area.h - gap * (list.length - 1)) / list.reduce((a, im) => a + im.height, 0));
    let yy = area.y + (area.h - (list.reduce((a, im) => a + im.height * k, 0) + gap * (list.length - 1))) / 2;
    for (const im of list) {
      const w = im.width * k, hh = im.height * k;
      shadowed(g, () => g.drawImage(im, x + (cw - w) / 2, yy, w, hh), 18, 8, 0.16);
      yy += hh + gap;
    }
    mono(g, label, x + 24, y + ch - 28, 15, P.ink, 'left', 0.12);
  });
  return c;
}

async function fontCSS(spec) {
  const face = FACES.find(([fam, , w]) => fam === spec.family && w === spec.weight);
  if (!face) return '';
  try {
    const buf = new Uint8Array(await (await fetch(fontURL(face[1]))).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return `@font-face{font-family:'${spec.family}';font-weight:${spec.weight};src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2')}`;
  } catch { return ''; }
}

export default {
  id: 'identity',
  fields: [
    { key: 'name', label: 'Brand name', max: 28 },
    { key: 'vibe', label: 'Vibe', type: 'select', options: Object.entries(VIBES).map(([k, v]) => [k, v.name]) },
    { key: 'what', label: 'What you do', max: 40 },
    { key: 'tagline', label: 'Tagline', max: 60 },
    { key: 'person', label: 'Name on the card', max: 32 },
    { key: 'role', label: 'Role', max: 32 },
    { key: 'contact', label: 'Contact line', max: 48 },
    { key: 'seed', label: 'Variation', type: 'range', min: 1, max: 60, hint: 'Shifts the hue and the mark within the vibe.' },
  ],
  presets: [{ state: { name: 'Pebble & Pine', vibe: 'playful', what: 'Neighbourhood bakery', tagline: 'Warm bread, early mornings.', person: 'Jo Marlow', role: 'Head baker', contact: '@pebbleandpine · 14 Harbour Row', seed: 3 }, samples: {} }],
  frames: () => 0,
  surprise(r) {
    const ideas = [
      ['Northwind', 'bold', 'Coffee roasters', 'Roasted loud. Brewed slow.'],
      ['Halcyon', 'calm', 'Swim and sauna club', 'Cold water, warm people.'],
      ['Maison Vale', 'luxe', 'Perfume atelier', 'Scents made by hand, in small numbers.'],
      ['Lumen Labs', 'tech', 'Battery research', 'Energy you can see coming.'],
      ['Fern & Field', 'organic', 'Plant nursery', 'Grown slowly, on purpose.'],
      ['Kite Studio', 'playful', 'Animation studio', 'Small films with big ideas.'],
      ['Orbit Bikes', 'bold', 'Bicycle workshop', 'Fixed fast. Ridden far.'],
      ['Saltwater', 'calm', 'Seafood kitchen', 'Today’s catch, simply cooked.'],
    ];
    const [name, vibe, what, tagline] = ideas[Math.floor(r() * ideas.length)];
    return { name, vibe, what, tagline, seed: 1 + Math.floor(r() * 60) };
  },
  async build(s, io) {
    const v = VIBES[s.vibe] || VIBES.playful;
    const seed = (Number(s.seed) || 1) + hashStr(s.name) % 7;
    const P = palette(s.vibe, seed);
    const id = pickMark(s.vibe, Number(s.seed) || 1);
    io.status('Drawing the identity…');
    const tile = patternTile(id, 120, P.primary, P.secondary, P.accent);
    const apps = { cardFront: cardFront(s, v, P, id), cardBack: cardBack(s, v, P, id, tile), poster: poster(s, v, P, id, tile), social: social(s, v, P, id, tile), sign: sign(s, v, P, id), tote: tote(s, v, P, id), stickers: stickers(s, v, P, id) };
    const main = board(s, v, P, id, tile, apps);
    const css = await fontCSS(v.display);
    const word = wordOf(s, v);
    const mc = canvas(10, 10).getContext('2d');
    font(mc, { ...v.display, size: 100 });
    const ww = Math.ceil(measure(mc, word) + 40);
    const wordSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ww} 140" width="${ww * 4}" height="560"><style>${css}</style><text x="${ww / 2}" y="100" text-anchor="middle" font-family="'${v.display.family}'" font-weight="${v.display.weight}" font-size="100" letter-spacing="${(v.display.tracking * 100).toFixed(1)}" fill="${P.ink}">${word.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
    const tokens = {
      name: s.name, vibe: s.vibe, version: 1,
      color: Object.fromEntries(['primary', 'secondary', 'accent', 'ink', 'paper'].map((k) => [k, { hex: P[k], oklch: oklchString(P[k]) }])),
      on: { primary: P.onPrimary, secondary: P.onSecondary, accent: P.onAccent },
      contrast: Object.fromEntries(contrastReport(P).map(([k, x]) => [k, +x.toFixed(2)])),
      type: { display: { ...v.display, case: v.upper ? 'upper' : v.lower ? 'lower' : 'as typed', license: 'SIL OFL 1.1' }, body: { family: 'Instrument Sans', weights: [400, 600] }, mono: { family: 'IBM Plex Mono', weights: [500] } },
      mark: { id, grammar: 'path on a 100-unit grid', letter: MARKS[id].letter ? initialOf(s.name) : null },
      radius: { card: Math.round(v.radius * 100) / 100 },
      space: [4, 8, 12, 16, 24, 32, 48, 64, 96],
    };
    const label = { cardFront: 'Business card, front', cardBack: 'Business card, back', poster: 'Poster', social: 'Social post', sign: 'Shop sign', tote: 'Tote bag', stickers: 'Sticker sheet' };
    return {
      name: s.name,
      layout: 'board',
      boards: [
        { id: 'identity-board', label: `Identity board · ${s.name}`, canvas: main, size: 'hero', print: true },
        ...Object.entries(apps).map(([k, c]) => ({ id: k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), label: label[k], canvas: c, print: k.startsWith('card') || k === 'poster', save: false })),
      ],
      files: [
        { name: `${slug(s.name)}-mark.svg`, data: markSVG(id, P.primary, initialOf(s.name), P.paper, v.display.family, MARKS[id].letter ? css : '') },
        { name: `${slug(s.name)}-wordmark.svg`, data: wordSVG },
        { name: `${slug(s.name)}-tokens.json`, data: JSON.stringify(tokens, null, 2) },
      ],
    };
  },
};
