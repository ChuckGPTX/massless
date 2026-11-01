// Slide themes: an OFL type pairing (self-hosted in /fonts) and an OKLCH palette per theme. Every colour is
// written as OKLCH and converted to sRGB hex with the same gamut mapping the identity kit uses; muted text
// and "on accent" ink are solved for WCAG contrast instead of picked by eye. tokens() turns a theme into the
// CSS custom properties deck.css reads, for four slide tones (page, soft, ink, accent).

import { oklch, contrast, hexToRgb, rgbToHex } from '../make/kit.js';

/** Font faces a theme may use: family -> [[weight, style, file]] (files in /fonts, woff2; woff on the CDN for PDF). */
export const FACE_FILES = {
  'Instrument Serif': [[400, 'normal', 'instrument-serif-latin-400-normal'], [400, 'italic', 'instrument-serif-latin-400-italic']],
  'Instrument Sans': [[400, 'normal', 'instrument-sans-latin-400-normal'], [500, 'normal', 'instrument-sans-latin-500-normal'], [600, 'normal', 'instrument-sans-latin-600-normal'], [700, 'normal', 'instrument-sans-latin-700-normal']],
  'Space Grotesk': [[400, 'normal', 'space-grotesk-latin-400-normal'], [700, 'normal', 'space-grotesk-latin-700-normal']],
  'Archivo Black': [[400, 'normal', 'archivo-black-latin-400-normal']],
  Archivo: [[400, 'normal', 'archivo-latin-400-normal'], [800, 'normal', 'archivo-latin-800-normal']],
  Fraunces: [[300, 'normal', 'fraunces-latin-300-normal'], [300, 'italic', 'fraunces-latin-300-italic'], [700, 'normal', 'fraunces-latin-700-normal'], [900, 'normal', 'fraunces-latin-900-normal']],
  Unbounded: [[700, 'normal', 'unbounded-latin-700-normal']],
  'IBM Plex Mono': [[400, 'normal', 'ibm-plex-mono-latin-400-normal'], [500, 'normal', 'ibm-plex-mono-latin-500-normal']],
  'DM Serif Display': [[400, 'normal', 'dm-serif-display-latin-400-normal'], [400, 'italic', 'dm-serif-display-latin-400-italic']],
  'Bricolage Grotesque': [[500, 'normal', 'bricolage-grotesque-latin-500-normal'], [800, 'normal', 'bricolage-grotesque-latin-800-normal']],
  'Big Shoulders Display': [[600, 'normal', 'big-shoulders-display-latin-600-normal'], [800, 'normal', 'big-shoulders-display-latin-800-normal'], [900, 'normal', 'big-shoulders-display-latin-900-normal']],
};
/** Fontsource package per family (same OFL files as /fonts; the CDN also has .woff, which the PDF writer can embed). */
export const FONTSOURCE = {
  'Instrument Serif': 'instrument-serif', 'Instrument Sans': 'instrument-sans', 'Space Grotesk': 'space-grotesk', 'Archivo Black': 'archivo-black',
  Archivo: 'archivo', Fraunces: 'fraunces', Unbounded: 'unbounded', 'IBM Plex Mono': 'ibm-plex-mono', 'DM Serif Display': 'dm-serif-display',
  'Bricolage Grotesque': 'bricolage-grotesque', 'Big Shoulders Display': 'big-shoulders-display',
};
export const FONTSOURCE_VERSION = '5.2.5';
export const FONT_CDN = 'https://cdn.jsdelivr.net/npm/@fontsource';
const FALLBACK = { serif: "Georgia, 'Times New Roman', serif", sans: "'Helvetica Neue', Arial, sans-serif", mono: "ui-monospace, 'SFMono-Regular', Menlo, monospace" };
const CAT = { 'Instrument Serif': 'serif', Fraunces: 'serif', 'DM Serif Display': 'serif', 'IBM Plex Mono': 'mono' };
export const stack = (family) => `'${family}', ${FALLBACK[CAT[family] || 'sans']}`;

/** The closest available face for a family / weight / style. */
export function faceFor(family, weight = 400, style = 'normal') {
  const list = FACE_FILES[family];
  if (!list) return null;
  const want = Number(weight) || 400;
  const pool = list.filter((f) => f[1] === style).length ? list.filter((f) => f[1] === style) : list;
  return pool.reduce((best, f) => (Math.abs(f[0] - want) < Math.abs(best[0] - want) ? f : best), pool[0]);
}
export const woff2URL = (file) => `/fonts/${file}.woff2`;
export const woffURL = (family, file) => `${FONT_CDN}/${FONTSOURCE[family]}@${FONTSOURCE_VERSION}/files/${file}.woff`;

// ---------- colour helpers ----------
const mix = (a, b, t) => rgbToHex(hexToRgb(a).map((v, i) => v + (hexToRgb(b)[i] - v) * t));
/** The most "toned down" mix of ink toward ground that still reads at `target`:1 (muted text, captions). */
export function legibleMix(ink, ground, target = 4.6, max = 0.45, also = []) {
  let best = ink;
  for (let t = 0.02; t <= max + 1e-9; t += 0.02) {
    const c = mix(ink, ground, t);
    if ([ground, ...also].every((g) => contrast(c, g) >= target)) best = c; else break;
  }
  return best;
}
/** Nudge a card colour away from the ink until the ink reads at `target`:1 on it. */
function cardFor(card, ink, target = 4.8) {
  const far = contrast(ink, '#000000') > contrast(ink, '#ffffff') ? '#000000' : '#ffffff';
  let c = card;
  for (let t = 0.04; contrast(ink, c) < target && t <= 0.6; t += 0.04) c = mix(card, far, t);
  return c;
}
const pick = (ground, ...inks) => inks.reduce((a, b) => (contrast(ground, b) > contrast(ground, a) ? b : a));
const hexA = (hex, a) => `rgba(${hexToRgb(hex).map((v) => Math.round(v * 255)).join(', ')}, ${a})`;

// ---------- the themes ----------
// colours are OKLCH triples [L, C, h]; display/body/label are type specs.
const T = (o) => o;
export const THEMES = [
  T({ id: 'studio', name: 'Studio', note: 'Editorial serif on warm paper',
    display: { family: 'Instrument Serif', weight: 400, tracking: -0.015, lh: 0.98, scale: 1.08, em: 'italic' },
    body: { family: 'Instrument Sans', weight: 400, bold: 600 }, label: { family: 'IBM Plex Mono', weight: 500, tracking: 0.08, upper: true },
    bg: [0.972, 0.012, 85], surface: [0.935, 0.016, 80], ink: [0.21, 0.014, 60], accent: [0.57, 0.19, 34], accent2: [0.42, 0.09, 255],
    inv: { bg: [0.21, 0.014, 60], ink: [0.965, 0.012, 85], accent: [0.76, 0.13, 50] }, radius: 4, deco: 'rule' }),
  T({ id: 'midnight', name: 'Midnight', note: 'Deep navy, crisp grotesk, cyan light',
    display: { family: 'Space Grotesk', weight: 700, tracking: -0.035, lh: 1, scale: 0.94 },
    body: { family: 'Instrument Sans', weight: 400, bold: 600 }, label: { family: 'Space Grotesk', weight: 400, tracking: 0.12, upper: true },
    bg: [0.2, 0.04, 266], surface: [0.25, 0.045, 266], ink: [0.97, 0.008, 250], accent: [0.83, 0.12, 205], accent2: [0.74, 0.13, 300],
    inv: { bg: [0.96, 0.012, 250], ink: [0.21, 0.04, 266], accent: [0.5, 0.16, 258] }, radius: 16, deco: 'orb' }),
  T({ id: 'poster', name: 'Poster', note: 'Heavy caps, cream and signal red',
    display: { family: 'Archivo Black', weight: 400, tracking: -0.02, lh: 0.94, scale: 0.86, upper: true },
    body: { family: 'Archivo', weight: 400, bold: 800 }, label: { family: 'Archivo', weight: 800, tracking: 0.06, upper: true },
    bg: [0.955, 0.025, 92], surface: [0.915, 0.035, 90], ink: [0.17, 0.004, 60], accent: [0.585, 0.225, 29], accent2: [0.17, 0.004, 60],
    inv: { bg: [0.17, 0.004, 60], ink: [0.955, 0.025, 92], accent: [0.66, 0.21, 31] }, radius: 0, deco: 'block' }),
  T({ id: 'harvest', name: 'Harvest', note: 'Fraunces on oat, forest and terracotta',
    display: { family: 'Fraunces', weight: 700, tracking: -0.025, lh: 1.02, scale: 0.94, em: 'light' },
    body: { family: 'Instrument Sans', weight: 400, bold: 600 }, label: { family: 'Instrument Sans', weight: 600, tracking: 0.14, upper: true },
    bg: [0.94, 0.03, 84], surface: [0.9, 0.04, 80], ink: [0.28, 0.05, 150], accent: [0.555, 0.135, 42], accent2: [0.48, 0.07, 150],
    inv: { bg: [0.28, 0.05, 150], ink: [0.95, 0.025, 84], accent: [0.8, 0.11, 70] }, radius: 22, deco: 'arch' }),
  T({ id: 'signal', name: 'Signal', note: 'Wide display, mono body, terminal green',
    display: { family: 'Unbounded', weight: 700, tracking: -0.035, lh: 1.02, scale: 0.72 },
    body: { family: 'IBM Plex Mono', weight: 400, bold: 500 }, label: { family: 'IBM Plex Mono', weight: 500, tracking: 0.1, upper: true },
    bg: [0.175, 0.012, 160], surface: [0.225, 0.014, 160], ink: [0.95, 0.02, 150], accent: [0.87, 0.2, 140], accent2: [0.78, 0.12, 215],
    inv: { bg: [0.93, 0.03, 140], ink: [0.18, 0.012, 160], accent: [0.45, 0.13, 150] }, radius: 6, deco: 'grid' }),
  T({ id: 'luxe', name: 'Luxe', note: 'Black, ivory and gold, high-contrast serif',
    display: { family: 'DM Serif Display', weight: 400, tracking: -0.005, lh: 1.02, scale: 0.98, em: 'italic' },
    body: { family: 'Instrument Sans', weight: 400, bold: 600 }, label: { family: 'Instrument Sans', weight: 500, tracking: 0.24, upper: true },
    bg: [0.165, 0.006, 60], surface: [0.215, 0.008, 60], ink: [0.95, 0.014, 85], accent: [0.8, 0.1, 82], accent2: [0.66, 0.06, 40],
    inv: { bg: [0.94, 0.016, 85], ink: [0.18, 0.006, 60], accent: [0.52, 0.09, 70] }, radius: 0, deco: 'frame' }),
  T({ id: 'pop', name: 'Pop', note: 'Rounded and bright: plum, tomato and blush',
    display: { family: 'Bricolage Grotesque', weight: 800, tracking: -0.045, lh: 0.98, scale: 0.96 },
    body: { family: 'Instrument Sans', weight: 400, bold: 600 }, label: { family: 'Bricolage Grotesque', weight: 500, tracking: 0.02 },
    bg: [0.955, 0.03, 345], surface: [0.915, 0.05, 345], ink: [0.27, 0.1, 295], accent: [0.62, 0.21, 28], accent2: [0.45, 0.17, 295],
    inv: { bg: [0.27, 0.1, 295], ink: [0.96, 0.025, 345], accent: [0.8, 0.13, 25] }, radius: 30, deco: 'blob' }),
  T({ id: 'stadium', name: 'Stadium', note: 'Condensed caps on royal blue and yellow',
    display: { family: 'Big Shoulders Display', weight: 900, tracking: 0, lh: 0.9, scale: 1.3, upper: true },
    body: { family: 'Archivo', weight: 400, bold: 800 }, label: { family: 'Big Shoulders Display', weight: 800, tracking: 0.08, upper: true },
    bg: [0.33, 0.13, 263], surface: [0.38, 0.14, 263], ink: [0.985, 0.01, 95], accent: [0.89, 0.17, 96], accent2: [0.76, 0.13, 25],
    inv: { bg: [0.89, 0.17, 96], ink: [0.25, 0.1, 263], accent: [0.33, 0.13, 263] }, radius: 2, deco: 'stripe' }),
  T({ id: 'swiss', name: 'Swiss', note: 'White, black and Klein blue on a strict grid',
    display: { family: 'Instrument Sans', weight: 700, tracking: -0.045, lh: 0.98, scale: 0.94 },
    body: { family: 'Instrument Sans', weight: 400, bold: 600 }, label: { family: 'Instrument Sans', weight: 600, tracking: 0.08, upper: true },
    bg: [0.995, 0, 0], surface: [0.955, 0.004, 250], ink: [0.17, 0.006, 250], accent: [0.5, 0.24, 263], accent2: [0.63, 0.2, 32],
    inv: { bg: [0.5, 0.24, 263], ink: [0.995, 0, 0], accent: [0.92, 0.06, 263] }, radius: 0, deco: 'dot' }),
  T({ id: 'aurora', name: 'Aurora', note: 'Violet night, pink and cyan glow',
    display: { family: 'Archivo', weight: 800, tracking: -0.04, lh: 0.98, scale: 0.9 },
    body: { family: 'Space Grotesk', weight: 400, bold: 700 }, label: { family: 'Space Grotesk', weight: 700, tracking: 0.12, upper: true },
    bg: [0.22, 0.075, 295], surface: [0.27, 0.085, 295], ink: [0.97, 0.012, 300], accent: [0.8, 0.14, 340], accent2: [0.83, 0.12, 200],
    inv: { bg: [0.95, 0.025, 320], ink: [0.24, 0.08, 295], accent: [0.55, 0.2, 340] }, radius: 20, deco: 'orb' }),
];
export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_THEME = 'studio';
export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES.find((t) => t.id === DEFAULT_THEME);

const hex = (c) => oklch(c[0], c[1], c[2]);
const cache = new Map();
/** Resolved colours per tone, solved for contrast. */
export function palette(theme) {
  const t = typeof theme === 'string' ? themeById(theme) : theme;
  if (cache.has(t.id)) return cache.get(t.id);
  const bg = hex(t.bg), surface = hex(t.surface), ink = hex(t.ink), accent = hex(t.accent), accent2 = hex(t.accent2);
  const ibg = hex(t.inv.bg), iink = hex(t.inv.ink), iacc = hex(t.inv.accent);
  const onAccent = pick(accent, ink, bg, '#ffffff', '#111111');
  const tone = (g, i, a, card0) => {
    const card = cardFor(card0, i);
    return { bg: g, ink: i, muted: legibleMix(i, g, 4.6, 0.45, [card]), accent: a, card, line: mix(i, g, 0.82), onAccent: pick(a, g, i, '#ffffff', '#111111') };
  };
  const p = {
    bg, surface, ink, accent, accent2, onAccent,
    tones: {
      base: tone(bg, ink, accent, surface),
      alt: tone(surface, ink, accent, bg),
      ink: tone(ibg, iink, iacc, mix(ibg, iink, 0.08)),
      accent: tone(accent, onAccent, onAccent, mix(accent, onAccent, 0.1)),
    },
    chart: [accent, accent2, mix(ink, bg, 0.35), mix(accent, bg, 0.45)],
  };
  // the accent tone's "accent" is its ink; keep its pill readable
  p.tones.accent.onAccent = pick(p.tones.accent.accent, accent, '#ffffff', '#111111');
  cache.set(t.id, p);
  return p;
}

/** Every text and graphic pairing the slides use, with its WCAG ratio and the minimum it must meet. */
export function contrastReport(theme) {
  const p = palette(theme), out = [];
  for (const [name, c] of Object.entries(p.tones)) {
    out.push([`${name}: text`, contrast(c.ink, c.bg), name === 'base' || name === 'alt' ? 7 : 4.5]);
    out.push([`${name}: muted text`, contrast(c.muted, c.bg), 4.5]);
    out.push([`${name}: muted text on cards`, contrast(c.muted, c.card), 4.5]);
    out.push([`${name}: text on cards`, contrast(c.ink, c.card), 4.5]);
    out.push([`${name}: accent display type`, contrast(c.accent, c.bg), 3]);
    out.push([`${name}: label on accent pill`, contrast(c.onAccent, c.accent), 4.5]);
  }
  out.push(['chart series 1 on page', contrast(p.chart[0], p.bg), 3]);
  out.push(['chart series 2 on page', contrast(p.chart[1], p.bg), 3]);
  return out;
}

/** CSS custom properties for one slide (theme + tone). The values are plain strings so exports can inline them. */
export function tokens(theme, tone = 'base') {
  const t = typeof theme === 'string' ? themeById(theme) : theme;
  const p = palette(t), c = p.tones[tone] || p.tones.base;
  const d = t.display, b = t.body, l = t.label;
  return {
    '--bg': c.bg, '--ink': c.ink, '--muted': c.muted, '--accent': c.accent, '--on-accent': c.onAccent, '--card': c.card, '--line': c.line,
    '--scrim': hexA(p.tones.ink.bg, 0.5),
    '--c1': tone === 'accent' ? c.ink : p.chart[0], '--c2': tone === 'accent' ? mix(c.ink, c.bg, 0.4) : p.chart[1], '--c3': p.chart[2], '--grid': mix(c.ink, c.bg, 0.86),
    '--fd': stack(d.family), '--fdw': String(d.weight), '--fdt': `${d.tracking}em`, '--fdl': String(d.lh), '--fdu': d.upper ? 'uppercase' : 'none',
    '--fds': d.em === 'italic' ? 'italic' : 'normal', '--fdew': d.em === 'light' ? '300' : String(d.weight), '--fdes': d.em === 'light' ? 'italic' : d.em === 'italic' ? 'italic' : 'normal',
    '--fb': stack(b.family), '--fbw': String(b.weight), '--fbb': String(b.bold),
    '--fl': stack(l.family), '--flw': String(l.weight), '--flt': `${l.tracking}em`, '--flu': l.upper ? 'uppercase' : 'none',
    '--r': `${t.radius}px`,
  };
}
export const styleAttr = (vars) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');

/** The faces a theme draws with, as [family, weight, style, file]. */
export function themeFaces(theme) {
  const t = typeof theme === 'string' ? themeById(theme) : theme;
  const want = [[t.display.family, t.display.weight, 'normal'], [t.body.family, t.body.weight, 'normal'], [t.body.family, t.body.bold, 'normal'], [t.label.family, t.label.weight, 'normal']];
  if (t.display.em === 'italic') want.push([t.display.family, t.display.weight, 'italic']);
  if (t.display.em === 'light') want.push([t.display.family, 300, 'italic']);
  const seen = new Map();
  for (const [fam, w, s] of want) {
    const f = faceFor(fam, w, s);
    if (f) seen.set(f[2], [fam, f[0], f[1], f[2]]);
  }
  return [...seen.values()];
}
