// Shared drawing helpers for the preset engines: images, cut-outs, shadows, colour, type and MP4 export.
// Everything runs on the visitor's device; nothing here calls a server.

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - clamp(t), 3),
  in: (t) => Math.pow(clamp(t), 3),
  back: (t) => { const c = 1.7; t = clamp(t); return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  elastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};
/** Position within [a, b] as 0..1. */
export const span = (t, a, b) => clamp((t - a) / (b - a));

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
export const ctx2d = (c) => c.getContext('2d', { willReadFrequently: false });

const imageCache = new Map();
export function loadImage(url) {
  if (imageCache.has(url)) return imageCache.get(url);
  const p = new Promise((res, rej) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => res(im);
    im.onerror = () => { imageCache.delete(url); rej(new Error('Could not load an image. Check your connection and try again.')); };
    im.src = url;
  });
  imageCache.set(url, p);
  return p;
}
/** A user's file as an image, scaled so its longest side is at most `max`. */
export async function fileToImage(file, max = 2048) {
  if (!file.type.startsWith('image/')) throw new Error('Choose a JPG, PNG or WebP image.');
  if (file.size > 25e6) throw new Error('Choose an image smaller than 25 MB.');
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('That image could not be opened. Try a JPG or PNG.'); });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = canvas(bmp.width * k, bmp.height * k);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

/** Draw `img` to cover the box (x, y, w, h); fx/fy pick the focus point (0..1). */
export function cover(g, img, x, y, w, h, { zoom = 1, fx = 0.5, fy = 0.5 } = {}) {
  const iw = img.width, ih = img.height;
  const k = Math.max(w / iw, h / ih) * zoom;
  const dw = iw * k, dh = ih * k;
  const ox = clamp(w / 2 - fx * dw, w - dw, 0), oy = clamp(h / 2 - fy * dh, h - dh, 0);
  g.drawImage(img, x + ox, y + oy, dw, dh);
  return { k, ox: x + ox, oy: y + oy, dw, dh };
}

// ---------------------------------------------------------------------------------------------
// Cut-outs
// ---------------------------------------------------------------------------------------------

/** Bounding box of pixels with alpha above `t` (0..255). */
export function alphaBox(c, t = 12) {
  const { width: w, height: h } = c;
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > t) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
/** Crop a cut-out to its visible pixels. */
export function trim(c, pad = 2) {
  const b = alphaBox(c);
  if (!b) return c;
  const out = canvas(b.w + pad * 2, b.h + pad * 2);
  out.getContext('2d').drawImage(c, b.x, b.y, b.w, b.h, pad, pad, b.w, b.h);
  out.box = { x: b.x - pad, y: b.y - pad, w: out.width, h: out.height };
  return out;
}
export function hasTransparency(img) {
  const k = Math.min(1, 256 / Math.max(img.width, img.height));
  const c = canvas(img.width * k, img.height * k);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let clear = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 200) clear++;
  return clear / (d.length / 4) > 0.02;
}

/**
 * Fast cut-out for product photos on a plain backdrop: flood-fill the backdrop from the border, treating
 * darker pixels of the same hue (shadows) as backdrop too. Returns { cut, matte, rough } where `rough`
 * means the border was too busy for this method and a precise cut-out will do better.
 */
export function quickCutout(img) {
  const W = img.width, H = img.height;
  const k = Math.min(1, 640 / Math.max(W, H));
  const w = Math.max(8, Math.round(W * k)), h = Math.max(8, Math.round(H * k));
  const sc = canvas(w, h), sg = sc.getContext('2d', { willReadFrequently: true });
  sg.drawImage(img, 0, 0, w, h);
  const d = sg.getImageData(0, 0, w, h).data;
  // backdrop colour from the border
  const border = [];
  const bw = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < bw || y < bw || x >= w - bw || y >= h - bw) border.push(y * w + x);
  const med = [0, 1, 2].map((c) => { const v = border.map((i) => d[i * 4 + c]).sort((a, b) => a - b); return v[v.length >> 1]; });
  const dist = new Float32Array(w * h);
  const ml = med[0] * 0.299 + med[1] * 0.587 + med[2] * 0.114;
  for (let i = 0; i < w * h; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const l = r * 0.299 + g * 0.587 + b * 0.114;
    // chroma difference counts fully; a darker version of the backdrop (a shadow) counts a third as much
    const dl = l - ml, scale = l / Math.max(1, ml);
    const cr = r - med[0] * scale, cg = g - med[1] * scale, cb = b - med[2] * scale;
    dist[i] = Math.sqrt(cr * cr + cg * cg + cb * cb) + (dl < 0 ? -dl * 0.33 : dl * 0.9);
  }
  const bd = border.map((i) => dist[i]).sort((a, b) => a - b);
  const spread = bd[Math.floor(bd.length * 0.9)];
  const T = Math.max(14, spread * 2.2);
  // flood fill the backdrop
  const bg = new Uint8Array(w * h), stack = [];
  for (const i of border) if (dist[i] < T * 1.6 && !bg[i]) { bg[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop(), x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
      if (j >= 0 && !bg[j] && dist[j] < T) { bg[j] = 1; stack.push(j); }
  }
  // enclosed gaps of backdrop colour (a mug's handle, the space between straps) are backdrop too
  {
    const seen = new Uint8Array(w * h), comp = [];
    for (let i = 0; i < w * h; i++) {
      if (bg[i] || seen[i] || dist[i] >= T * 0.7) continue;
      comp.length = 0; stack.push(i); seen[i] = 1;
      while (stack.length) {
        const p = stack.pop(), x = p % w, y = (p / w) | 0; comp.push(p);
        for (const j of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
          if (j >= 0 && !bg[j] && !seen[j] && dist[j] < T * 0.7) { seen[j] = 1; stack.push(j); }
      }
      if (comp.length > w * h * 0.002) for (const p of comp) bg[p] = 1;
    }
  }
  // keep the largest object
  const lab = new Int32Array(w * h).fill(-1);
  let best = -1, bestN = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    if (bg[i] || lab[i] >= 0) continue;
    let count = 0; stack.push(i); lab[i] = n;
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p / w) | 0; count++;
      for (const j of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
        if (j >= 0 && !bg[j] && lab[j] < 0) { lab[j] = n; stack.push(j); }
    }
    if (count > bestN) { bestN = count; best = n; }
    n++;
  }
  const m = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = lab[i] === best ? 1 : 0;
  // soften the edge by how far each edge pixel is from the backdrop colour
  for (let i = 0; i < w * h; i++) if (m[i]) {
    const x = i % w, y = (i / w) | 0;
    const edge = (x > 0 && !m[i - 1]) || (x < w - 1 && !m[i + 1]) || (y > 0 && !m[i - w]) || (y < h - 1 && !m[i + w]);
    if (edge) m[i] = clamp((dist[i] - T * 0.6) / (T * 1.2), 0.25, 1);
  }
  const fg = bestN / (w * h);
  const rough = spread > 26 || fg < 0.015 || fg > 0.94;
  return { ...applyMatte(img, m, w, h), rough };
}
/** Apply a small matte (values 0..1, mw x mh) to a full-size image: a trimmed cut-out canvas. */
export function applyMatte(img, matte, mw, mh) {
  const W = img.width, H = img.height;
  const mc = canvas(mw, mh), mg = mc.getContext('2d');
  const md = mg.createImageData(mw, mh);
  for (let i = 0; i < mw * mh; i++) { md.data[i * 4 + 3] = Math.round(clamp(matte[i]) * 255); }
  mg.putImageData(md, 0, 0);
  const out = canvas(W, H), og = out.getContext('2d');
  og.imageSmoothingQuality = 'high';
  og.filter = `blur(${Math.max(0.4, W / mw * 0.45).toFixed(2)}px)`;
  og.drawImage(mc, 0, 0, W, H);
  og.filter = 'none';
  og.globalCompositeOperation = 'source-in';
  og.drawImage(img, 0, 0, W, H);
  return { cut: trim(out), full: out };
}

/** Fill the hole a cut-out leaves in its photo with its blurred surroundings (push-pull), for effects that move the cut-out. */
export function cleanPlate(img, full) {
  const W = img.width, H = img.height;
  const k = Math.min(1, 256 / Math.max(W, H));
  const w = Math.max(4, Math.round(W * k)), h = Math.max(4, Math.round(H * k));
  const a = canvas(w, h), ag = a.getContext('2d', { willReadFrequently: true });
  ag.drawImage(img, 0, 0, w, h);
  const m = canvas(w, h), mg = m.getContext('2d', { willReadFrequently: true });
  mg.filter = `blur(${Math.max(1.5, w / 90).toFixed(1)}px)`;
  mg.drawImage(full, 0, 0, w, h);
  const px = ag.getImageData(0, 0, w, h), md = mg.getImageData(0, 0, w, h).data;
  // level 0: colour and how much of it is known (0 inside the grown hole)
  let L = { w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) };
  for (let i = 0; i < w * h; i++) { L.a[i] = md[i * 4 + 3] > 4 ? 0 : 1; for (let c = 0; c < 3; c++) L.c[i * 3 + c] = px.data[i * 4 + c]; }
  const levels = [L];
  while (L.w > 1 || L.h > 1) {
    const nw = Math.ceil(L.w / 2), nh = Math.ceil(L.h / 2), N = { w: nw, h: nh, c: new Float32Array(nw * nh * 3), a: new Float32Array(nw * nh) };
    const sa = new Float32Array(nw * nh);
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
      const s = y * L.w + x, t = (y >> 1) * nw + (x >> 1);
      sa[t] += L.a[s];
      for (let c = 0; c < 3; c++) N.c[t * 3 + c] += L.c[s * 3 + c] * L.a[s];
    }
    for (let t = 0; t < nw * nh; t++) { for (let c = 0; c < 3; c++) N.c[t * 3 + c] = sa[t] > 0 ? N.c[t * 3 + c] / sa[t] : 0; N.a[t] = Math.min(1, sa[t]); }
    levels.push(N); L = N;
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const F = levels[l], U = levels[l + 1];
    for (let y = 0; y < F.h; y++) for (let x = 0; x < F.w; x++) {
      const s = y * F.w + x;
      if (F.a[s] >= 1) continue;
      const t = (y >> 1) * U.w + (x >> 1);
      for (let c = 0; c < 3; c++) F.c[s * 3 + c] = F.c[s * 3 + c] * F.a[s] + U.c[t * 3 + c] * (1 - F.a[s]);
      F.a[s] = 1;
    }
  }
  const base = levels[0];
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) px.data[i * 4 + c] = base.c[i * 3 + c];
  ag.putImageData(px, 0, 0);
  const out = canvas(W, H), og = out.getContext('2d');
  og.drawImage(img, 0, 0, W, H);
  const fill = canvas(W, H), fg = fill.getContext('2d');
  fg.filter = `blur(${Math.max(4, W / 70).toFixed(1)}px)`;
  fg.drawImage(full, 0, 0); fg.drawImage(full, 0, 0); fg.drawImage(full, 0, 0);
  fg.filter = 'none';
  fg.globalCompositeOperation = 'source-in';
  fg.imageSmoothingQuality = 'high';
  fg.drawImage(a, 0, 0, W, H);
  og.drawImage(fill, 0, 0);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------------------------

/** Mean colour of a region of an image (0..255), ignoring transparent pixels. */
export function meanColor(img, x = 0, y = 0, w = img.width, h = img.height) {
  const c = canvas(24, 24), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, x, y, Math.max(1, w), Math.max(1, h), 0, 0, 24, 24);
  const d = g.getImageData(0, 0, 24, 24).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; r += d[i] * a; gg += d[i + 1] * a; b += d[i + 2] * a; n += a; }
  n = n || 1;
  return [r / n, gg / n, b / n];
}
export const luma = ([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
export const rgbCss = ([r, g, b], a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
export const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/**
 * A cut-out graded to sit in a plate: matches brightness to the spot it stands in, tints it with the plate's
 * ambient light, and adds a soft light wrap from the surroundings along its edges.
 */
export function gradeCutout(cut, ambient, { strength = 0.35, light = null } = {}) {
  const out = canvas(cut.width, cut.height), g = out.getContext('2d');
  g.drawImage(cut, 0, 0);
  const own = meanColor(cut);
  const target = luma(ambient), mine = luma(own);
  // brightness: pull partway toward the plate, never more than a stop either way
  const gain = clamp(Math.pow(target / Math.max(0.05, mine), 0.35 * strength * 2), 0.7, 1.25);
  g.globalCompositeOperation = 'source-atop';
  if (gain < 1) { g.fillStyle = `rgba(0,0,0,${(1 - gain).toFixed(3)})`; g.fillRect(0, 0, out.width, out.height); }
  // ambient colour through soft-light, then a plain tint
  g.globalCompositeOperation = 'soft-light';
  g.globalAlpha = strength * 0.9;
  g.fillStyle = rgbCss(ambient);
  g.fillRect(0, 0, out.width, out.height);
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = strength * 0.12;
  g.fillRect(0, 0, out.width, out.height);
  if (gain > 1) { g.globalCompositeOperation = 'source-atop'; g.globalAlpha = (gain - 1) * 0.8; g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height); }
  // light from one side: a gentle gradient across the object
  if (light) {
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = 1;
    const lx = light.x ?? -1;
    const gr = g.createLinearGradient(lx < 0 ? 0 : out.width, 0, lx < 0 ? out.width : 0, 0);
    gr.addColorStop(0, `rgba(255,250,240,${0.10 * (light.amount ?? 1)})`);
    gr.addColorStop(0.55, 'rgba(0,0,0,0)');
    gr.addColorStop(1, `rgba(0,0,0,${0.16 * (light.amount ?? 1)})`);
    g.fillStyle = gr;
    g.fillRect(0, 0, out.width, out.height);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(cut, 0, 0);
  return out;
}

/** The silhouette of a cut-out in one colour (for shadows). */
export function silhouette(cut, color = '#000') {
  const s = canvas(cut.width, cut.height), g = s.getContext('2d');
  g.drawImage(cut, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, s.width, s.height);
  return s;
}

/**
 * Shadows for an object standing at (x, y) (its base centre) drawn at size (w, h): a soft ambient pool, a cast
 * shadow laid on the floor along `dir` (radians; 0 = to the right, +PI/2 = straight back) and a tight contact line.
 */
export function drawShadows(g, cut, x, y, w, h, o = {}) {
  const { contact = 0.5, pool = 0.3, cast = 0.3, dir = 0.5, length = 0.6, squash = 0.35, blur = 1, color = [24, 18, 14], footprint = 0.92 } = o;
  g.save();
  g.globalCompositeOperation = 'multiply';
  const fw = w * footprint;
  if (pool > 0) {
    const rg = g.createRadialGradient(x, y, 0, x, y, fw * 0.85);
    rg.addColorStop(0, rgbCss(color, pool));
    rg.addColorStop(1, rgbCss(color, 0));
    g.setTransform(1, 0, 0, 0.18, 0, y * (1 - 0.18));
    g.fillStyle = rg;
    g.fillRect(x - fw, y - fw, fw * 2, fw * 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (cast > 0) {
    const pad = Math.round(w * 0.12 * blur + 4);
    const sc = canvas(w + pad * 2, h + pad * 2), sg = sc.getContext('2d');
    sg.filter = `blur(${(w * 0.025 * blur + 1).toFixed(1)}px)`;
    sg.drawImage(silhouette(cut, rgbCss(color)), pad, pad, w, h);
    sg.filter = 'none';
    // softer and lighter away from the base
    sg.globalCompositeOperation = 'destination-in';
    const gr = sg.createLinearGradient(0, h + pad, 0, pad);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(1, 'rgba(0,0,0,0.15)');
    sg.fillStyle = gr;
    sg.fillRect(0, 0, sc.width, sc.height);
    const sx = Math.cos(dir), sy = Math.sin(dir);
    g.globalAlpha = cast;
    g.setTransform(1, 0, -sx * length, sy * length * squash, x, y);
    g.drawImage(sc, -w / 2 - pad, -h - pad);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
  }
  if (contact > 0) {
    const rg = g.createRadialGradient(x, y, 0, x, y, fw * 0.55);
    rg.addColorStop(0, rgbCss(color, contact));
    rg.addColorStop(0.65, rgbCss(color, contact * 0.4));
    rg.addColorStop(1, rgbCss(color, 0));
    g.setTransform(1, 0, 0, 0.075, 0, y * (1 - 0.075));
    g.fillStyle = rg;
    g.fillRect(x - fw, y - fw, fw * 2, fw * 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  g.restore();
}

/** A mirror reflection below an object standing at (x, y), fading out over `fade` of its height. */
export function drawReflection(g, cut, x, y, w, h, { opacity = 0.3, fade = 0.45, blur = 0 } = {}) {
  const c = canvas(w, h * fade), cg = c.getContext('2d');
  cg.translate(0, 0);
  cg.scale(1, -1);
  if (blur) cg.filter = `blur(${blur}px)`;
  cg.drawImage(cut, 0, -h, w, h);
  cg.setTransform(1, 0, 0, 1, 0, 0);
  cg.filter = 'none';
  cg.globalCompositeOperation = 'destination-in';
  const gr = cg.createLinearGradient(0, 0, 0, c.height);
  gr.addColorStop(0, `rgba(0,0,0,${opacity})`);
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  cg.fillStyle = gr;
  cg.fillRect(0, 0, c.width, c.height);
  g.drawImage(c, x - w / 2, y);
}

// ---------------------------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------------------------

export const FONT = {
  serif: { family: 'DM Serif Display', weight: 400 },
  luxe: { family: 'Fraunces', weight: 300 },
  sans: { family: 'Instrument Sans', weight: 600 },
  grotesk: { family: 'Space Grotesk', weight: 700 },
  display: { family: 'Big Shoulders Display', weight: 900 },
  bold: { family: 'Archivo Black', weight: 400 },
  round: { family: 'Unbounded', weight: 700 },
  mono: { family: 'IBM Plex Mono', weight: 500 },
  bric: { family: 'Bricolage Grotesque', weight: 800 },
};
export function setFont(g, f, size, { italic = false, tracking = 0 } = {}) {
  g.font = `${italic ? 'italic ' : ''}${f.weight} ${Math.max(1, size).toFixed(1)}px "${f.family}", "Instrument Sans", sans-serif`;
  if ('letterSpacing' in g) g.letterSpacing = `${(tracking * size).toFixed(2)}px`;
}
/** Word-wrap `str` to `maxW` at the current font. */
export function wrapText(g, str, maxW) {
  const out = [];
  for (const para of String(str || '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + ' ' + word : word;
      if (line && g.measureText(next).width > maxW) { out.push(line); line = word; } else line = next;
    }
    if (line) out.push(line);
  }
  return out;
}
/** Largest font size (<= max) at which `str` wraps into at most `lines` lines of `maxW`. */
export function fitText(g, str, f, maxW, maxH, { max = 400, min = 10, lines = 3, lh = 1.05, tracking = 0, italic = false } = {}) {
  let lo = min, hi = max, best = min, bestLines = [str];
  for (let i = 0; i < 14; i++) {
    const s = (lo + hi) / 2;
    setFont(g, f, s, { tracking, italic });
    const ls = wrapText(g, str, maxW);
    const fits = ls.length <= lines && ls.length * s * lh <= maxH && ls.every((l) => g.measureText(l).width <= maxW * 1.001);
    if (fits) { best = s; bestLines = ls; lo = s; } else hi = s;
  }
  setFont(g, f, best, { tracking, italic });
  return { size: best, lines: bestLines };
}

// ---------------------------------------------------------------------------------------------
// MP4 export (H.264 with WebCodecs; AAC or Opus sound when there is a voice track)
// ---------------------------------------------------------------------------------------------

const AVC = ['avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.42001f'];
const tick = () => new Promise((r) => setTimeout(r, 0));
export const canExportVideo = () => typeof VideoEncoder !== 'undefined';

/**
 * Render `draw(canvas, t)` for t in [0, duration) into an MP4. audio: { channels: [Float32Array], sampleRate }.
 * Returns a Blob (video/mp4).
 */
export async function encodeMP4(c, { duration, fps = 30, draw, audio = null, onProgress = () => {}, signal } = {}) {
  if (typeof VideoEncoder === 'undefined') throw new Error('Video export needs a recent Chrome, Edge or Safari. You can still download the stills.');
  const W = c.width, H = c.height;
  let vcfg = null;
  for (const codec of AVC) {
    const cfg = { codec, width: W, height: H, bitrate: Math.round(W * H * fps * 0.16), framerate: fps, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) { vcfg = cfg; break; } } catch { /* next */ }
  }
  if (!vcfg) throw new Error('This browser cannot export MP4 at this size. Try desktop Chrome.');
  let acfg = null, amux = null;
  if (audio && typeof AudioEncoder !== 'undefined') {
    for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
      const cfg = { codec, sampleRate: audio.sampleRate, numberOfChannels: 1, bitrate: 128000 };
      try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) { acfg = cfg; amux = mux; break; } } catch { /* next */ }
    }
  }
  const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.mjs');
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H, frameRate: fps },
    ...(acfg ? { audio: { codec: amux, sampleRate: audio.sampleRate, numberOfChannels: 1 } } : {}),
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let failure = null;
  const venc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: (e) => (failure = e) });
  venc.configure(vcfg);
  let aenc = null;
  try {
    if (acfg) {
      aenc = new AudioEncoder({ output: (ch, meta) => muxer.addAudioChunk(ch, meta), error: (e) => (failure = e) });
      aenc.configure(acfg);
      const src = audio.channels[0], sr = audio.sampleRate, len = Math.min(src.length, Math.floor(duration * sr));
      for (let i = 0; i < len; i += 4800) {
        const n = Math.min(4800, len - i);
        const frame = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round((i / sr) * 1e6), data: src.slice(i, i + n) });
        aenc.encode(frame); frame.close();
        if (aenc.encodeQueueSize > 16) await aenc.flush();
      }
    }
    const total = Math.max(2, Math.round(duration * fps));
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new Error('Cancelled');
      if (failure) throw failure;
      await draw(c, i / fps, i / total);
      const frame = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 4) await tick();
      if (i % 3 === 0) { onProgress(i / total); await tick(); }
    }
    await venc.flush();
    if (aenc) await aenc.flush();
    if (failure) throw failure;
    muxer.finalize();
    onProgress(1);
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally {
    if (venc.state !== 'closed') venc.close();
    if (aenc && aenc.state !== 'closed') aenc.close();
  }
}

export const toBlob = (c, type = 'image/png', q = 0.92) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t save the image. Try again.'))), type, q));
