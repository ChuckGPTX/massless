// Shared parts for the one-click design workflows (/workflows?make=<id>): fonts, colour, canvas type,
// the FLUX call (the same /api/shot request the Image studio sends), and small exporters (PDF, ZIP).
// Nothing here touches the DOM at import time, so the pure parts are tested in Node.

import { shoot, workersBody, DEFAULT_MODEL } from '../engines.js';

// ---------- fonts (SIL OFL 1.1, self-hosted in /fonts with their licences) ----------

export const FACES = [
  ['Fraunces', 'fraunces-latin-300-normal', 300, 'normal'],
  ['Fraunces', 'fraunces-latin-300-italic', 300, 'italic'],
  ['Fraunces', 'fraunces-latin-700-normal', 700, 'normal'],
  ['Fraunces', 'fraunces-latin-900-normal', 900, 'normal'],
  ['Instrument Serif', 'instrument-serif-latin-400-normal', 400, 'normal'],
  ['Instrument Serif', 'instrument-serif-latin-400-italic', 400, 'italic'],
  ['Space Grotesk', 'space-grotesk-latin-400-normal', 400, 'normal'],
  ['Space Grotesk', 'space-grotesk-latin-700-normal', 700, 'normal'],
  ['Archivo', 'archivo-latin-400-normal', 400, 'normal'],
  ['Archivo', 'archivo-latin-800-normal', 800, 'normal'],
  ['Archivo Black', 'archivo-black-latin-400-normal', 400, 'normal'],
  ['DM Serif Display', 'dm-serif-display-latin-400-normal', 400, 'normal'],
  ['DM Serif Display', 'dm-serif-display-latin-400-italic', 400, 'italic'],
  ['IBM Plex Mono', 'ibm-plex-mono-latin-400-normal', 400, 'normal'],
  ['IBM Plex Mono', 'ibm-plex-mono-latin-500-normal', 500, 'normal'],
  ['Unbounded', 'unbounded-latin-700-normal', 700, 'normal'],
  ['Bricolage Grotesque', 'bricolage-grotesque-latin-500-normal', 500, 'normal'],
  ['Bricolage Grotesque', 'bricolage-grotesque-latin-800-normal', 800, 'normal'],
  ['Big Shoulders Display', 'big-shoulders-display-latin-800-normal', 800, 'normal'],
  ['Big Shoulders Display', 'big-shoulders-display-latin-900-normal', 900, 'normal'],
  ['Instrument Sans', 'instrument-sans-latin-400-normal', 400, 'normal'],
  ['Instrument Sans', 'instrument-sans-latin-600-normal', 600, 'normal'],
];
/** Licence file per family, next to the font files. */
export const FONT_LICENSES = {
  Fraunces: 'OFL-Fraunces.txt',
  'Instrument Serif': 'OFL-InstrumentSerif.txt',
  'Space Grotesk': 'OFL-SpaceGrotesk.txt',
  Archivo: 'OFL-Archivo.txt',
  'Archivo Black': 'OFL-ArchivoBlack.txt',
  'DM Serif Display': 'OFL-DMSerifDisplay.txt',
  'IBM Plex Mono': 'OFL-IBMPlexMono.txt',
  Unbounded: 'OFL-Unbounded.txt',
  'Bricolage Grotesque': 'OFL-BricolageGrotesque.txt',
  'Big Shoulders Display': 'OFL-BigShouldersDisplay.txt',
  'Instrument Sans': 'OFL-InstrumentSans.txt',
};
export const fontURL = (file) => `/fonts/${file}.woff2`;

let fontsReady = null;
/** Load every face once (about 450 KB, cached for a year). Canvas text needs them loaded before drawing. */
export function loadFonts() {
  if (fontsReady) return fontsReady;
  fontsReady = Promise.all(
    FACES.map(async ([family, file, weight, style]) => {
      const face = new FontFace(family, `url(${fontURL(file)})`, { weight: String(weight), style });
      document.fonts.add(face);
      try { await face.load(); } catch { /* a missing face falls back to the next family in the stack */ }
    }),
  );
  return fontsReady;
}

// ---------- seeded randomness ----------

export function rng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const pickOne = (rand, arr) => arr[Math.floor(rand() * arr.length) % arr.length];
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ---------- colour: OKLCH in, sRGB hex out, WCAG contrast ----------

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** OKLCH (L 0..1, C, h degrees) to linear-free sRGB [0..1] (may be out of gamut). */
export function oklchToRgb(L, C, h) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
export function rgbToOklch([r, g, b]) {
  [r, g, b] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  return [L, C, C < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
export const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
/** OKLCH to hex, reducing chroma (never lightness or hue) until the colour fits sRGB. */
export function oklch(L, C, h) {
  if (inGamut(oklchToRgb(L, C, h))) return rgbToHex(oklchToRgb(L, C, h));
  let lo = 0, hi = C;
  for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inGamut(oklchToRgb(L, mid, h))) lo = mid; else hi = mid; }
  return rgbToHex(oklchToRgb(L, lo, h));
}
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** The better-contrasting of two inks on a ground. */
export const bestInk = (ground, a, b) => (contrast(ground, a) >= contrast(ground, b) ? a : b);
export const oklchString = (hex) => { const [L, C, h] = rgbToOklch(hexToRgb(hex)); return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(3)} ${h.toFixed(1)})`; };

// ---------- canvas helpers ----------

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.round(w);
  c.height = Math.round(h);
  return c;
}
/** Set a font. tracking is in em (e.g. -0.02). */
export function font(ctx, { family, size, weight = 400, style = 'normal', tracking = 0 }) {
  ctx.font = `${style} ${weight} ${Math.max(1, size).toFixed(2)}px "${family}", "Instrument Sans", sans-serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(tracking * size).toFixed(2)}px`;
  ctx._track = 'letterSpacing' in ctx ? 0 : tracking * size;
}
/** Width of a string in the current font, including tracking (letterSpacing adds after every glyph). */
export function measure(ctx, text) {
  const w = ctx.measureText(text).width + (ctx._track || 0) * text.length;
  const ls = 'letterSpacing' in ctx ? parseFloat(ctx.letterSpacing) || 0 : 0;
  return w - ls; // drop the trailing space after the last glyph so centring is optical
}
/** Draw text; handles tracking in browsers without ctx.letterSpacing. */
export function text(ctx, str, x, y) {
  if (!ctx._track) { ctx.fillText(str, x, y); return; }
  const w = measure(ctx, str);
  const align = ctx.textAlign;
  let cx = align === 'center' ? x - w / 2 : align === 'right' || align === 'end' ? x - w : x;
  ctx.textAlign = 'left';
  for (const ch of str) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + ctx._track; }
  ctx.textAlign = align;
}
/** Largest size (<= max) at which every line fits maxW. */
export function fitSize(ctx, lines, spec, maxW, max = 4000) {
  font(ctx, { ...spec, size: 100 });
  const widest = Math.max(...lines.map((l) => measure(ctx, l)), 1);
  return Math.min(max, (100 * maxW) / widest);
}
/** Greedy word wrap at the current font. */
export function wrap(ctx, str, maxW) {
  const out = [];
  for (const para of String(str).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (line && measure(ctx, next) > maxW) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out;
}
/** Draw an image to cover a box, with optional zoom and pan (-1..1). */
export function cover(ctx, img, x, y, w, h, { zoom = 1, px = 0, py = 0 } = {}) {
  const iw = img.width, ih = img.height;
  const k = Math.max(w / iw, h / ih) * zoom;
  const dw = iw * k, dh = ih * k;
  ctx.drawImage(img, x + (w - dw) / 2 + (px * (dw - w)) / 2, y + (h - dh) / 2 + (py * (dh - h)) / 2, dw, dh);
}
const noiseTiles = new Map();
/** Film grain / paper tooth: a tiled noise pattern composited softly. */
export function grain(ctx, w, h, amount = 0.06, seed = 1, offset = 0) {
  let tile = noiseTiles.get(seed);
  if (!tile) {
    tile = canvas(256, 256);
    const g = tile.getContext('2d'), d = g.createImageData(256, 256), r = rng(seed);
    for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (r() - 0.5) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0);
    noiseTiles.set(seed, tile);
  }
  ctx.save();
  ctx.globalAlpha = amount;
  ctx.globalCompositeOperation = 'overlay';
  const pat = ctx.createPattern(tile, 'repeat');
  ctx.translate(-(offset * 97) % 256, -(offset * 61) % 256);
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w + 256, h + 256);
  ctx.restore();
}
/** Grey copy of an image (luma), optionally with lifted blacks: the one grade every film poem frame shares. */
export function greyscale(img, { lift = 0, gamma = 1 } = {}) {
  const c = canvas(img.width, img.height), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    let v = (0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]) / 255;
    v = lift + (1 - lift) * v ** gamma;
    p[i] = p[i + 1] = p[i + 2] = v * 255;
  }
  g.putImageData(d, 0, 0);
  return c;
}
/** Otsu threshold of a luma histogram (0..255): the level that best separates figure from ground. */
export function otsu(hist) {
  let total = 0, sum = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
  let sumB = 0, wB = 0, best = 0, level = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; level = t; }
  }
  return level;
}
/** Image to a one-ink print: dark areas become `ink`, the rest transparent (mode 'silhouette'),
 *  or a two-tone gradient from ink to ground (mode 'duotone'). */
export function inkPrint(img, ink, ground, mode = 'silhouette', w = img.width, h = img.height) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h), p = d.data, hist = new Array(256).fill(0);
  const L = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < p.length; i += 4, j++) { L[j] = Math.round(0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]); hist[L[j]]++; }
  const [ir, ig, ib] = hexToRgb(ink).map((v) => v * 255), [gr, gg, gb] = hexToRgb(ground).map((v) => v * 255);
  const t = otsu(hist);
  for (let j = 0, i = 0; j < L.length; j++, i += 4) {
    if (mode === 'silhouette') {
      const a = clamp((t + 10 - L[j]) / 20, 0, 1); // a soft 20-level edge instead of a hard step
      p[i] = ir; p[i + 1] = ig; p[i + 2] = ib; p[i + 3] = a * 255;
    } else {
      const v = clamp((L[j] - t * 0.35) / (255 - t * 0.35), 0, 1) ** 1.2;
      p[i] = ir + (gr - ir) * v; p[i + 1] = ig + (gg - ig) * v; p[i + 2] = ib + (gb - ib) * v; p[i + 3] = 255;
    }
  }
  g.putImageData(d, 0, 0);
  return c;
}
export const toBlob = (c, type = 'image/png', q = 0.92) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t save the image. Try again.'))), type, q));
export function loadImage(url) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Could not load ' + url));
    im.src = url;
  });
}

// ---------- FLUX.1 schnell through the existing /api/shot (same body as the Image studio) ----------

/** The exact JSON body /api/shot receives for a design frame; the Image studio builds it the same way. */
export const fluxRequest = ({ prompt, w, h, seed }) => workersBody({ prompt, w, h, seed, model: DEFAULT_MODEL });
/** One FLUX frame, cropped to w x h. Throws on the daily cap or a network failure; callers fall back to samples. */
export async function flux({ prompt, w, h, seed, signal }) {
  const out = await shoot({ prompt, w, h, seed, model: DEFAULT_MODEL, signal });
  return out.image;
}

// ---------- exporters ----------

const enc = new TextEncoder();
function joinBytes(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/** A print-ready PDF: one page per JPEG, each page sized to its artboard at `dpi` (default 300). */
export function pdfFromJpegs(pages, dpi = 300) {
  const parts = [], offsets = [];
  let pos = 0;
  const push = (b) => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); pos += u.length; };
  const obj = (n, body) => { offsets[n] = pos; push(`${n} 0 obj\n`); for (const b of [].concat(body)) push(b); push('\nendobj\n'); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach(({ bytes, width, height }, i) => {
    const n = 3 + i * 3, pw = (width * 72) / dpi, ph = (height * 72) / dpi;
    const content = `q ${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm /Im0 Do Q`;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`);
    obj(n + 1, [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`, bytes, '\nendstream']);
    obj(n + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  const count = 3 + pages.length * 3, xref = pos;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return joinBytes(parts);
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** A stored (uncompressed) ZIP: PNG, JPEG and MP4 are already compressed. files: [{ name, bytes }]. */
export function zipStore(files) {
  const parts = [], central = [];
  let offset = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name), data = f.bytes, crc = crc32(data);
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    const local = new Uint8Array([...u32(0x04034b50), ...common]);
    parts.push(local, name, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + data.length;
  }
  const cd = joinBytes(central);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cd.length), ...u32(offset), ...u16(0)]);
  return joinBytes([...parts, cd, end]);
}
export const slug = (s) => String(s || 'chucksi').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 48) || 'chucksi';
