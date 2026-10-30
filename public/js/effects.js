// One-tap effects for the Video page: LiDAR scan, Vanish, Bullet time freeze and Clones.
// Everything comes from the still and its depth map: a subject matte found in the depth, a clean
// plate that fills in behind the subject, and a small WebGL2 mesh and point renderer that draws into
// the same scene target as the camera moves, so the lens and film finish and the recorder are shared.
// No video model runs and nothing leaves the device. Frames are a pure function of t, so previews,
// exports and tests all see the same picture.

import { mat4 } from './math.js';
import { REST_FOV, program } from './renderer.js';
import { maxFilter, minFilter } from './depth.js';

export const EFFECTS = [
  {
    id: 'lidar', name: 'LiDAR scan', hint: 'A laser sweep turns the still into a point cloud', duration: 6,
    looks: [{ id: 'cyan', name: 'Cyan' }, { id: 'thermal', name: 'Thermal' }, { id: 'white', name: 'White' }],
  },
  {
    id: 'vanish', name: 'Vanish', hint: 'The subject crumbles and blows away', duration: 5,
    looks: [{ id: 'ash', name: 'Ash' }, { id: 'embers', name: 'Embers' }, { id: 'pixels', name: 'Pixels' }],
  },
  {
    id: 'freeze', name: 'Bullet time freeze', hint: 'Push in, freeze, swing around the subject', duration: 5,
    looks: [],
  },
  {
    id: 'clones', name: 'Clones', hint: 'Echoes trail the subject as the camera slides', duration: 5,
    looks: [{ id: 'natural', name: 'Natural' }, { id: 'rainbow', name: 'Rainbow' }, { id: 'ghost', name: 'Ghost glow' }],
  },
];

export const effectById = (id) => EFFECTS.find((e) => e.id === id) || null;
export const defaultLook = (id) => effectById(id)?.looks[0]?.id || '';

// ---------------------------------------------------------------------------------------------
// Image work on the CPU: subject matte, edge refinement, clean plate. All deterministic.
// ---------------------------------------------------------------------------------------------

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (t) => t * t * (3 - 2 * t);
const win = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const easeIO = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const easeIOCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const a = hash2(xi + seed, yi);
  const b = hash2(xi + 1 + seed, yi);
  const c = hash2(xi + seed, yi + 1);
  const d = hash2(xi + 1 + seed, yi + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Running-sum box filter over a Float32Array, radius r, edges clamped. */
function boxF(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const d = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[row + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / d;
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / d;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function otsu(hist, from = 0) {
  let total = 0;
  let sum = 0;
  for (let v = from; v < 256; v++) { total += hist[v]; sum += v * hist[v]; }
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let thr = from;
  for (let v = from; v < 256; v++) {
    wB += hist[v];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = v; }
  }
  return thr;
}

/** 4-connected components of a 0/1 mask. Returns { labels: Int32Array (0 = none), comps }. */
function components(mask, w, h) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const comps = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    const id = comps.length + 1;
    const c = { id, area: 0, x0: w, y0: h, x1: 0, y1: 0, sx: 0, sy: 0, left: 0, right: 0, top: 0, bottom: 0, mass: 0, perim: 0 };
    let sp = 0;
    stack[sp++] = i;
    labels[i] = id;
    while (sp) {
      const j = stack[--sp];
      const x = j % w;
      const y = (j - x) / w;
      c.area++; c.sx += x; c.sy += y;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      if (x === 0) c.left++;
      if (x === w - 1) c.right++;
      if (y === 0) c.top++;
      if (y === h - 1) c.bottom++;
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1 || !mask[j - 1] || !mask[j + 1] || !mask[j - w] || !mask[j + w]) c.perim++;
      if (x > 0 && mask[j - 1] && !labels[j - 1]) { labels[j - 1] = id; stack[sp++] = j - 1; }
      if (x < w - 1 && mask[j + 1] && !labels[j + 1]) { labels[j + 1] = id; stack[sp++] = j + 1; }
      if (y > 0 && mask[j - w] && !labels[j - w]) { labels[j - w] = id; stack[sp++] = j - w; }
      if (y < h - 1 && mask[j + w] && !labels[j + w]) { labels[j + w] = id; stack[sp++] = j + w; }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/** Holes: background pixels that the border cannot reach. Filled in place. */
function fillHoles(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (j) => { if (!mask[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const j = stack[--sp];
    const x = j % w;
    if (x > 0) push(j - 1);
    if (x < w - 1) push(j + 1);
    if (j >= w) push(j - w);
    if (j < w * (h - 1)) push(j + w);
  }
  for (let i = 0; i < mask.length; i++) if (!mask[i] && !seen[i]) mask[i] = 1;
}

const binary = (m) => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] ? 255 : 0; return o; };
const unbinary = (m) => { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] > 127 ? 1 : 0; return o; };
const erode = (m, w, h, r) => (r > 0 ? unbinary(minFilter(binary(m), w, h, r)) : m);
const dilate = (m, w, h, r) => (r > 0 ? unbinary(maxFilter(binary(m), w, h, r)) : m);

/**
 * Subject matte from depth alone, at the depth map's resolution.
 * Each row gets a baseline (a low quantile of its depth, which is the ground or the far scene at that
 * height); what stands out toward the camera from it is relief. Otsu splits the relief histogram, a
 * small open and close cleans it, and the connected piece with the most relief wins, with a penalty
 * for pieces that run along the sides or top of the frame (walls, ceilings). Holes are filled.
 * If nothing stands out, the nearest depth band is used instead, so effects still have a subject.
 * Returns { mask: Uint8Array (0/1), w, h, fallback, bbox: [x0, y0, x1, y1], area }.
 */
export function subjectMatte(data, w, h) {
  const n = w * h;
  const base = new Float32Array(h);
  const hist = new Uint32Array(256);
  for (let y = 0; y < h; y++) {
    hist.fill(0);
    const row = y * w;
    for (let x = 0; x < w; x++) hist[data[row + x]]++;
    let acc = 0;
    let v = 0;
    for (; v < 255; v++) { acc += hist[v]; if (acc >= w * 0.18) break; }
    base[y] = v;
  }
  const sb = new Float32Array(h);
  const br = Math.max(2, Math.round(h / 40));
  for (let y = 0; y < h; y++) {
    let s = 0;
    let c = 0;
    for (let k = -br; k <= br; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += base[yy]; c++; } }
    sb[y] = s / c;
  }
  const relief = new Uint8Array(n);
  hist.fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // log ratio: a dancer at 25 against a stage at 4 stands out as much as a seat at 150 against 75
      const r = clamp(Math.round(120 * (Math.log(data[i] + 16) - Math.log(sb[y] + 16))), 0, 255);
      relief[i] = r;
      hist[r]++;
    }
  }
  const thr0 = Math.max(14, otsu(hist, 4));
  const rr = Math.max(1, Math.round(Math.max(w, h) / 260));
  // Try a few thresholds: a subject that touches a near ground at the Otsu level often stands
  // free a little higher. Pieces are scored by relief and size, against frame-border contact.
  let best = null;
  let bestScore = 0;
  let bestLevel = 0;
  const levels = [];
  const sideFrac = (c) => (c.left + c.right + c.top) / Math.max(1, c.perim);
  for (const f of [1, 1.35, 1.8, 2.4]) {
    const T = Math.min(220, thr0 * f);
    let mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = relief[i] > T ? 1 : 0;
    mask = dilate(erode(mask, w, h, rr), w, h, rr); // open: drop specks
    mask = erode(dilate(mask, w, h, rr + 1), w, h, rr + 1); // close: join cracks
    const { labels, comps } = components(mask, w, h);
    levels.push({ labels, comps });
    for (let i = 0; i < n; i++) if (labels[i]) comps[labels[i] - 1].mass += relief[i];
    for (const c of comps) {
      if (c.area < n * 0.0012) continue;
      const borderFrac = sideFrac(c) + (0.35 * c.bottom) / Math.max(1, c.perim);
      const borderPen = Math.max(0.05, 1 - 3 * borderFrac);
      const cx = c.sx / c.area / w - 0.5;
      const cy = c.sy / c.area / h - 0.5;
      const centre = 1 - 0.5 * Math.min(1, Math.hypot(cx * 1.1, cy) / 0.7);
      const big = c.area > n * 0.45 ? 0.3 : 1;
      const score = (c.mass / c.area) * Math.pow(c.area, 0.55) * borderPen * centre * big * (1 - 0.06 * (f - 1));
      if (score > bestScore) { bestScore = score; best = c; bestLevel = levels.length - 1; }
    }
  }
  let out = new Uint8Array(n);
  let fallback = false;
  const meanRelief = best ? best.mass / best.area : 0;
  if (best && best.area > n * 0.003 && best.area < n * 0.6 && meanRelief > thr0 * 1.2) {
    // the same piece at a lower threshold, if it is not much bigger and no more stuck to the frame
    // sides (a portrait whose shoulders reach the bottom edge keeps its hair)
    let pick = { labels: levels[bestLevel].labels, c: best };
    for (let j = bestLevel - 1; j >= 0; j--) {
      const L = levels[j];
      const votes = new Map();
      for (let i = 0; i < n; i++) if (levels[bestLevel].labels[i] === best.id && L.labels[i]) votes.set(L.labels[i], (votes.get(L.labels[i]) || 0) + 1);
      let id = 0;
      let most = 0;
      for (const [k, v] of votes) if (v > most) { most = v; id = k; }
      if (!id) break;
      const c = L.comps[id - 1];
      if (c.area > best.area * 1.8 || sideFrac(c) > sideFrac(best) + 0.06) break;
      pick = { labels: L.labels, c };
    }
    for (let i = 0; i < n; i++) out[i] = pick.labels[i] === pick.c.id ? 1 : 0;
    // hysteresis: grow into nearby pixels that still stand out (legs in grass, a head behind a camera)
    const low = Math.max(10, thr0 * 0.5);
    const near = dilate(out, w, h, Math.max(3, Math.round(Math.max(w, h) * 0.025)));
    for (let pass = 0; pass < 2; pass++) {
      const grown = dilate(out, w, h, Math.max(2, Math.round(Math.max(w, h) * 0.012)));
      for (let i = 0; i < n; i++) if (grown[i] && near[i] && relief[i] > low) out[i] = 1;
    }
  } else {
    // no clear foreground: the nearest depth band
    fallback = true;
    const sorted = Uint8Array.from(data).sort();
    const q = sorted[Math.floor(n * 0.86)];
    for (let i = 0; i < n; i++) out[i] = data[i] >= q ? 1 : 0;
    out = dilate(erode(out, w, h, rr + 1), w, h, rr + 1);
    const cc = components(out, w, h);
    const keep = new Set(cc.comps.filter((c) => c.area > n * 0.003).map((c) => c.id));
    for (let i = 0; i < n; i++) out[i] = keep.has(cc.labels[i]) ? 1 : 0;
  }
  fillHoles(out, w, h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!out[y * w + x]) continue;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (!area) { x0 = Math.round(w * 0.4); x1 = Math.round(w * 0.6); y0 = Math.round(h * 0.4); y1 = Math.round(h * 0.6); }
  return { mask: out, w, h, fallback, bbox: [x0, y0, x1, y1], area: area / n };
}

/** Bilinear resample of a one-channel Float32Array. */
function resample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    const fy = clamp(((y + 0.5) * sh) / dh - 0.5, 0, sh - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = clamp(((x + 0.5) * sw) / dw - 0.5, 0, sw - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const a = src[y0 * sw + x0] + (src[y0 * sw + x1] - src[y0 * sw + x0]) * tx;
      const b = src[y1 * sw + x0] + (src[y1 * sw + x1] - src[y1 * sw + x0]) * tx;
      out[y * dw + x] = a + (b - a) * ty;
    }
  }
  return out;
}

/** Guided filter (He et al.) with a grayscale guide: snaps a soft matte to edges in the photo. */
function guided(I, p, w, h, r, eps) {
  const n = w * h;
  const Ip = new Float32Array(n);
  const II = new Float32Array(n);
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
  const mI = boxF(I, w, h, r);
  const mp = boxF(p, w, h, r);
  const mIp = boxF(Ip, w, h, r);
  const mII = boxF(II, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mII[i] - mI[i] * mI[i];
    a[i] = (mIp[i] - mI[i] * mp[i]) / (v + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxF(a, w, h, r);
  const mb = boxF(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

/** Push-pull fill: values where weight > 0 spread smoothly into the rest. Returns a new array. */
function pushPull(val, wgt, w, h) {
  const levels = [{ v: val, wt: wgt, w, h }];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const L = levels[levels.length - 1];
    const W2 = Math.ceil(L.w / 2);
    const H2 = Math.ceil(L.h / 2);
    const v = new Float32Array(W2 * H2);
    const wt = new Float32Array(W2 * H2);
    for (let y = 0; y < H2; y++) {
      for (let x = 0; x < W2; x++) {
        let s = 0;
        let ws = 0;
        for (let dy = 0; dy < 2; dy++) {
          const yy = 2 * y + dy;
          if (yy >= L.h) continue;
          for (let dx = 0; dx < 2; dx++) {
            const xx = 2 * x + dx;
            if (xx >= L.w) continue;
            const k = yy * L.w + xx;
            s += L.v[k] * L.wt[k];
            ws += L.wt[k];
          }
        }
        const k = y * W2 + x;
        v[k] = ws > 0 ? s / ws : 0;
        wt[k] = Math.min(1, ws);
      }
    }
    levels.push({ v, wt, w: W2, h: H2 });
  }
  let filled = levels[levels.length - 1].v;
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l];
    const C = levels[l + 1];
    const out = new Float32Array(L.w * L.h);
    for (let y = 0; y < L.h; y++) {
      const fy = clamp((y + 0.5) / 2 - 0.5, 0, C.h - 1);
      const y0 = Math.floor(fy);
      const y1 = Math.min(C.h - 1, y0 + 1);
      const ty = fy - y0;
      for (let x = 0; x < L.w; x++) {
        const fx = clamp((x + 0.5) / 2 - 0.5, 0, C.w - 1);
        const x0 = Math.floor(fx);
        const x1 = Math.min(C.w - 1, x0 + 1);
        const tx = fx - x0;
        const a = filled[y0 * C.w + x0] + (filled[y0 * C.w + x1] - filled[y0 * C.w + x0]) * tx;
        const b = filled[y1 * C.w + x0] + (filled[y1 * C.w + x1] - filled[y1 * C.w + x0]) * tx;
        const up = a + (b - a) * ty;
        const k = y * L.w + x;
        out[k] = L.wt[k] * L.v[k] + (1 - L.wt[k]) * up;
      }
    }
    filled = out;
  }
  return filled;
}

/**
 * Inpaint a hole with real texture from the rest of the picture: coarse-to-fine PatchMatch
 * (Barnes et al. 2009) in the spirit of Wexler et al. (2007). At each level every hole pixel
 * finds a 7x7 patch outside the hole that matches its neighbourhood; the hole is then repainted
 * from those patches (voted at the coarsest level, copied above it to keep texture sharp). Coarse levels settle the layout, finer ones the detail. Sources are
 * limited to the neighbourhood of the hole and, when a depth map is given, pay for being nearer
 * than the background expected at the spot they fill (depth spread in from around the hole), so
 * a floor is filled with floor and a wall with wall, never with more foreground.
 * Deterministic (seeded). chans: Float32Array per channel (0..255), modified in place;
 * hole: Uint8Array 0/1; opts: { depth (Float32Array 0..255, same size), budget }.
 */
export function inpaint(chans, w, h, hole, opts = {}) {
  const R = 3;
  const budget = opts.budget || 26000;
  const nc = chans.length;
  let expect = null;
  if (opts.depth) {
    const wt = new Float32Array(w * h);
    for (let i = 0; i < wt.length; i++) wt[i] = hole[i] ? 0 : 1;
    expect = pushPull(opts.depth, wt, w, h);
  }
  const pyr = [{ w, h, c: chans, m: hole, d: opts.depth || null, e: expect }];
  const bboxOf = (m, W) => {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (let i = 0; i < m.length; i++) if (m[i]) { const x = i % W; const y = (i - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  };
  for (;;) {
    const L = pyr[pyr.length - 1];
    const [x0, y0, x1, y1] = bboxOf(L.m, L.w);
    if (x1 < 0 || Math.min(L.w, L.h) < 24 || Math.max(x1 - x0, y1 - y0) < 14) break;
    const W2 = Math.ceil(L.w / 2);
    const H2 = Math.ceil(L.h / 2);
    const c2 = L.c.map(() => new Float32Array(W2 * H2));
    const d2 = L.d ? new Float32Array(W2 * H2) : null;
    const e2 = L.d ? new Float32Array(W2 * H2) : null;
    const m2 = new Uint8Array(W2 * H2);
    const acc = new Float64Array(nc);
    for (let y = 0; y < H2; y++) {
      for (let x = 0; x < W2; x++) {
        let cnt = 0;
        let any = 0;
        let dd = 0;
        let de = 0;
        acc.fill(0);
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const xx = Math.min(L.w - 1, 2 * x + dx);
            const yy = Math.min(L.h - 1, 2 * y + dy);
            const k = yy * L.w + xx;
            if (L.d) { dd += L.d[k] / 4; de += L.e[k] / 4; }
            if (L.m[k]) { any = 1; continue; }
            for (let ch = 0; ch < nc; ch++) acc[ch] += L.c[ch][k];
            cnt++;
          }
        }
        const k2 = y * W2 + x;
        m2[k2] = any;
        if (d2) { d2[k2] = dd; e2[k2] = de; }
        for (let ch = 0; ch < nc; ch++) c2[ch][k2] = cnt ? acc[ch] / cnt : 0;
      }
    }
    pyr.push({ w: W2, h: H2, c: c2, m: m2, d: d2, e: e2 });
  }
  const rand = mulberry32(1234);
  let prev = null;
  for (let l = pyr.length - 1; l >= 0; l--) {
    const { w: Wl, h: Hl, c, m, d: dep, e } = pyr[l];
    const n = Wl * Hl;
    // valid sources: the whole patch is inside the frame, outside the hole, near it, and far enough
    const known = new Uint8Array(n);
    for (let i = 0; i < n; i++) known[i] = m[i] ? 0 : 255;
    const er = minFilter(known, Wl, Hl, R);
    const [hx0, hy0, hx1, hy1] = bboxOf(m, Wl);
    const reach = Math.max(hx1 - hx0, hy1 - hy0) * 1.2 + 8;
    let valid = new Uint8Array(n);
    let vlist = [];
    const collect = (useReach) => {
      valid = new Uint8Array(n);
      vlist = [];
      for (let y = R; y < Hl - R; y++) {
        for (let x = R; x < Wl - R; x++) {
          const i = y * Wl + x;
          if (!er[i]) continue;
          if (useReach && (x < hx0 - reach || x > hx1 + reach || y < hy0 - reach || y > hy1 + reach)) continue;
          valid[i] = 1;
          vlist.push(i);
        }
      }
    };
    collect(true);
    if (vlist.length < 200) collect(false);
    const targets = [];
    for (let i = 0; i < n; i++) if (m[i]) targets.push(i);
    if (!targets.length) { prev = null; continue; }
    if (!vlist.length) {
      // nothing to copy from: smooth fill
      const wt = new Float32Array(n);
      for (let i = 0; i < n; i++) wt[i] = m[i] ? 0 : 1;
      c.forEach((ch, k) => { const f = pushPull(ch, wt, Wl, Hl); for (const i of targets) c[k][i] = f[i]; });
      prev = null;
      continue;
    }
    const nnf = new Int32Array(n).fill(-1);
    const dist = new Float32Array(n);
    const randValid = () => vlist[Math.floor(rand() * vlist.length)];
    const copy = () => { for (const t of targets) for (let k = 0; k < nc; k++) c[k][t] = c[k][nnf[t]]; };
    if (!prev) {
      const wt = new Float32Array(n);
      for (let i = 0; i < n; i++) wt[i] = m[i] ? 0 : 1;
      c.forEach((ch, k) => { const f = pushPull(ch, wt, Wl, Hl); for (const i of targets) c[k][i] = f[i]; });
      for (const i of targets) nnf[i] = randValid();
    } else {
      for (const i of targets) {
        const x = i % Wl;
        const y = (i - x) / Wl;
        const pi = Math.min(prev.h - 1, y >> 1) * prev.w + Math.min(prev.w - 1, x >> 1);
        const ps = prev.nnf[pi];
        let s = -1;
        if (ps >= 0) {
          const sx = Math.min(Wl - 1, 2 * (ps % prev.w) + (x & 1));
          const sy = Math.min(Hl - 1, 2 * Math.floor(ps / prev.w) + (y & 1));
          s = sy * Wl + sx;
        }
        nnf[i] = s >= 0 && valid[s] ? s : randValid();
      }
    }
    const patchDist = (t, s, cap) => {
      const tx = t % Wl;
      const ty = (t - tx) / Wl;
      const sx = s % Wl;
      const sy = (s - sx) / Wl;
      let d = 0;
      if (e) {
        // nearer than the expected background costs a lot, much farther a little
        const gap = dep[s] - e[t];
        d += gap > 4 ? 160 * (gap - 4) * (gap - 4) : gap < -24 ? 6 * (gap + 24) * (gap + 24) : 0;
      }
      for (let dy = -R; dy <= R; dy++) {
        const yy = ty + dy;
        if (yy < 0 || yy >= Hl) continue;
        const trow = yy * Wl;
        const srow = (sy + dy) * Wl;
        for (let dx = -R; dx <= R; dx++) {
          const xx = tx + dx;
          if (xx < 0 || xx >= Wl) continue;
          const a = trow + xx;
          const b = srow + sx + dx;
          for (let ch = 0; ch < nc; ch++) { const e = c[ch][a] - c[ch][b]; d += e * e; }
        }
        if (d > cap) return d;
      }
      return d;
    };
    const vote = () => {
      // weights from match quality: good matches dominate the vote
      const ds = targets.map((t) => dist[t]).sort((a, b) => a - b);
      const sig = Math.max(1, ds[Math.floor(ds.length * 0.5)]);
      const acc = c.map(() => new Float32Array(targets.length));
      const wacc = new Float32Array(targets.length);
      const slot = new Int32Array(n).fill(-1);
      targets.forEach((t, k) => (slot[t] = k));
      for (const q of targets) {
        const s = nnf[q];
        const wq = Math.exp(-dist[q] / sig);
        const qx = q % Wl;
        const qy = (q - qx) / Wl;
        const sx = s % Wl;
        const sy = (s - sx) / Wl;
        for (let dy = -R; dy <= R; dy++) {
          const yy = qy + dy;
          if (yy < 0 || yy >= Hl) continue;
          for (let dx = -R; dx <= R; dx++) {
            const xx = qx + dx;
            if (xx < 0 || xx >= Wl) continue;
            const k = slot[yy * Wl + xx];
            if (k < 0) continue;
            const b = (sy + dy) * Wl + sx + dx;
            for (let ch = 0; ch < nc; ch++) acc[ch][k] += c[ch][b] * wq;
            wacc[k] += wq;
          }
        }
      }
      targets.forEach((t, k) => { if (wacc[k] > 0) for (let ch = 0; ch < nc; ch++) c[ch][t] = acc[ch][k] / wacc[k]; });
    };
    for (const t of targets) dist[t] = patchDist(t, nnf[t], Infinity);
    if (prev) copy();
    // full search where the hole is small enough, local refinement above that
    const heavy = targets.length > budget;
    const iters = !prev ? 6 : heavy ? 1 : 4;
    const maxRad = heavy ? 6 : Math.max(Wl, Hl);
    for (let it = 0; it < iters; it++) {
      const fwd = it % 2 === 0;
      for (const t of targets) dist[t] = patchDist(t, nnf[t], Infinity);
      for (let k = 0; k < targets.length; k++) {
        const t = targets[fwd ? k : targets.length - 1 - k];
        const tx = t % Wl;
        let best = nnf[t];
        let bd = dist[t];
        // propagation from the neighbours already visited in this pass
        for (const nb of fwd ? [t - 1, t - Wl] : [t + 1, t + Wl]) {
          if (nb < 0 || nb >= n || !m[nb] || nnf[nb] < 0) continue;
          if ((nb === t - 1 && tx === 0) || (nb === t + 1 && tx === Wl - 1)) continue;
          const cand = nnf[nb] + (t - nb);
          if (cand < 0 || cand >= n || !valid[cand]) continue;
          const d = patchDist(t, cand, bd);
          if (d < bd) { bd = d; best = cand; }
        }
        // random search around the current best
        let rad = maxRad;
        const bx = best % Wl;
        const by = (best - bx) / Wl;
        while (rad >= 1) {
          const cx = Math.round(bx + (rand() * 2 - 1) * rad);
          const cy = Math.round(by + (rand() * 2 - 1) * rad);
          if (cx >= 0 && cx < Wl && cy >= 0 && cy < Hl) {
            const cand = cy * Wl + cx;
            if (valid[cand]) {
              const d = patchDist(t, cand, bd);
              if (d < bd) { bd = d; best = cand; }
            }
          }
          rad = Math.floor(rad / 2);
        }
        nnf[t] = best;
        dist[t] = bd;
      }
      // the coarsest level votes (it sets the layout); finer ones copy each pixel from its match,
      // which keeps texture crisp instead of averaging it to mush
      if (prev) copy();
      else vote();
    }
    if (l === 0) copy();
    prev = { nnf, w: Wl, h: Hl };
  }
}

function pixelsOf(source, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

/**
 * Depth alone loses whatever stands on the ground: legs and feet sit at the same depth as the floor
 * around them. Below the matte, pixels that look like the subject (a colour histogram of the subject
 * against one of its surroundings) and sit at the depth where the subject meets the ground are
 * added, as long as they connect to the subject. soft: Float32Array 0..1 at W x H; returns a new one.
 */
function extendDown(soft, px, depthUp, W, H) {
  const N = W * H;
  const fg = new Uint8Array(N);
  let x0 = W, x1 = -1;
  for (let i = 0; i < N; i++) if (soft[i] > 0.5) { fg[i] = 1; const x = i % W; if (x < x0) x0 = x; if (x > x1) x1 = x; }
  if (x1 < 0) return soft;
  const bin = (i) => ((px[i * 4] >> 4) << 8) | ((px[i * 4 + 1] >> 4) << 4) | (px[i * 4 + 2] >> 4);
  const near = dilate(fg, W, H, Math.round(H * 0.02));
  const ring = dilate(fg, W, H, Math.round(H * 0.12));
  const hf = new Float32Array(4096);
  const hb = new Float32Array(4096);
  let nf = 0;
  let nb = 0;
  for (let i = 0; i < N; i++) {
    if (fg[i]) { hf[bin(i)]++; nf++; } else if (ring[i] && !near[i]) { hb[bin(i)]++; nb++; }
  }
  if (nf < 50 || nb < 50) return soft;
  // per column: the lowest subject pixel and the depth there (smoothed across columns)
  const span = Math.round(W * 0.02);
  const bottom = new Int32Array(W).fill(-1);
  for (let x = 0; x < W; x++) for (let y = H - 1; y >= 0; y--) if (fg[y * W + x]) { bottom[x] = y; break; }
  const reachB = new Int32Array(W).fill(-1);
  const refD = new Float32Array(W);
  for (let x = Math.max(0, x0 - span); x <= Math.min(W - 1, x1 + span); x++) {
    let by = -1;
    let bd = 0;
    for (let k = -span; k <= span; k++) {
      const xx = x + k;
      if (xx < 0 || xx >= W || bottom[xx] < 0) continue;
      if (bottom[xx] > by) { by = bottom[xx]; bd = depthUp[by * W + xx]; }
    }
    reachB[x] = by;
    refD[x] = bd;
  }
  const cand = new Uint8Array(N);
  for (let x = 0; x < W; x++) {
    if (reachB[x] < 0) continue;
    for (let y = Math.max(0, reachB[x] - Math.round(H * 0.04)); y < H; y++) {
      const i = y * W + x;
      if (fg[i]) continue;
      // legs meet a floor that comes toward the camera; below a dancer in mid-air the stage falls away
      const dd = depthUp[i] - refD[x];
      if (dd < -3 || dd > 12) continue;
      const b = bin(i);
      const pf = hf[b] / nf;
      const pb = hb[b] / nb;
      if (pf > 2 * pb + 1e-5) cand[i] = 1;
    }
  }
  // keep only what connects to the subject
  const out = Uint8Array.from(fg);
  const stack = new Int32Array(N);
  let sp = 0;
  for (let i = 0; i < N; i++) if (fg[i]) stack[sp++] = i;
  while (sp) {
    const j = stack[--sp];
    const x = j % W;
    for (const k of [j - 1, j + 1, j - W, j + W]) {
      if (k < 0 || k >= N || (k === j - 1 && x === 0) || (k === j + 1 && x === W - 1)) continue;
      if (cand[k] && !out[k]) { out[k] = 1; stack[sp++] = k; }
    }
  }
  const closed = erode(dilate(out, W, H, 2), W, H, 2);
  const res = boxF(Float32Array.from(closed), W, H, 1);
  for (let i = 0; i < N; i++) res[i] = Math.max(res[i], soft[i]);
  return res;
}

/**
 * Depth edges are soft and a little fat, so a matte from depth alone carries a rim of background
 * (sky inside a bike wheel, the floor between a dancer's legs). In a band around the edge, each
 * pixel is judged by colour: a histogram of the sure subject against one of the nearby background.
 * Returns a new soft matte; the guided filter afterwards makes it follow edges in the photo.
 */
function refineEdge(soft, px, W, H) {
  const N = W * H;
  const fg = new Uint8Array(N);
  for (let i = 0; i < N; i++) fg[i] = soft[i] > 0.5 ? 1 : 0;
  const r = Math.max(3, Math.round(Math.max(W, H) * 0.014));
  const inner = erode(fg, W, H, r);
  const outer = dilate(fg, W, H, r);
  const far = dilate(fg, W, H, r * 3);
  const bin = (i) => ((px[i * 4] >> 4) << 8) | ((px[i * 4 + 1] >> 4) << 4) | (px[i * 4 + 2] >> 4);
  const hf = new Float32Array(4096);
  const hb = new Float32Array(4096);
  let nf = 0;
  let nb = 0;
  for (let i = 0; i < N; i++) {
    if (inner[i]) { hf[bin(i)]++; nf++; } else if (far[i] && !outer[i]) { hb[bin(i)]++; nb++; }
  }
  if (nf < 200 || nb < 200) return soft;
  // a little smoothing across neighbouring bins so near colours vote together
  const blur3 = (h) => {
    const o = new Float32Array(4096);
    for (let rr = 0; rr < 16; rr++) for (let g = 0; g < 16; g++) for (let b = 0; b < 16; b++) {
      let sum = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
        const R = rr + dr, G = g + dg, B = b + db;
        if (R < 0 || G < 0 || B < 0 || R > 15 || G > 15 || B > 15) continue;
        sum += h[(R << 8) | (G << 4) | B] * (dr || dg || db ? 0.35 : 1);
      }
      o[(rr << 8) | (g << 4) | b] = sum;
    }
    return o;
  };
  const sf = blur3(hf);
  const sbk = blur3(hb);
  const out = Float32Array.from(soft);
  for (let i = 0; i < N; i++) {
    if (inner[i] || !outer[i]) continue;
    const b = bin(i);
    const pf = sf[b] / nf;
    const pb = sbk[b] / nb;
    const p = pf / (pf + pb + 1e-6);
    // colour decides where it is sure; depth keeps a say where colours are shared
    const sure = Math.abs(p - 0.5) * 2;
    out[i] = soft[i] * (1 - sure) + p * sure;
  }
  return out;
}

/**
 * Everything an effect needs from one still. Cached on the depth object.
 * image: the source still; depth: { data, w, h, bg, bgColor } as the Video page keeps it.
 */
export function prepareStill(image, depth, maxSide = 960) {
  const t0 = performance.now();
  const { w: dw, h: dh } = depth;
  const m = subjectMatte(depth.data, dw, dh);
  const s = Math.min(1, maxSide / Math.max(image.width, image.height));
  const W = Math.max(2, Math.round(image.width * s));
  const H = Math.max(2, Math.round(image.height * s));
  const img = pixelsOf(image, W, H);
  const px = img.data;
  const N = W * H;

  // matte: pull in the depth map's grown edge, upsample, snap to photo edges
  const grow = Math.max(1, Math.round(Math.max(dw, dh) / 110) - 2);
  const core = erode(m.mask, dw, dh, grow);
  let any = 0;
  for (let i = 0; i < core.length; i++) any += core[i];
  const src = new Float32Array(dw * dh);
  const use = any > core.length * 0.002 ? core : m.mask;
  for (let i = 0; i < src.length; i++) src[i] = use[i];
  let soft = resample(boxF(src, dw, dh, 1), dw, dh, W, H);
  const depthUp = resample(Float32Array.from(depth.data), dw, dh, W, H);
  if (!m.fallback) soft = extendDown(soft, px, depthUp, W, H);
  soft = refineEdge(soft, px, W, H);
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) lum[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
  const gr = Math.max(3, Math.round(Math.max(W, H) / 110));
  const q = guided(lum, soft, W, H, gr, 0.004);
  const reach = dilate(Uint8Array.from(soft, (v) => (v > 0.02 ? 1 : 0)), W, H, gr);
  const alpha = new Float32Array(N);
  for (let i = 0; i < N; i++) alpha[i] = reach[i] ? clamp((q[i] - 0.22) / 0.56, 0, 1) : 0;
  const alphaS = boxF(alpha, W, H, 1);

  // hole for the clean plate: the matte, grown a little so no edge colour is left behind
  let hole = new Uint8Array(N);
  for (let i = 0; i < N; i++) hole[i] = alphaS[i] > 0.03 || soft[i] > 0.5 ? 1 : 0;
  hole = dilate(hole, W, H, Math.max(2, Math.round(Math.max(W, H) / 240)));
  let bx0 = W, by0 = H, bx1 = -1, by1 = -1, holeArea = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hole[y * W + x]) { holeArea++; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  if (bx1 < 0) { bx0 = W >> 1; bx1 = bx0 + 1; by0 = H >> 1; by1 = by0 + 1; }
  const R = new Float32Array(N);
  const G = new Float32Array(N);
  const B = new Float32Array(N);
  for (let i = 0; i < N; i++) { R[i] = px[i * 4]; G[i] = px[i * 4 + 1]; B[i] = px[i * 4 + 2]; }
  if (holeArea) {
    // fill with what is behind the subject, judged by the depth around it
    inpaint([R, G, B], W, H, hole, { depth: depthUp });
  }
  const plate = new ImageData(W, H);
  for (let i = 0; i < N; i++) {
    plate.data[i * 4] = R[i];
    plate.data[i * 4 + 1] = G[i];
    plate.data[i * 4 + 2] = B[i];
    plate.data[i * 4 + 3] = 255;
  }

  // plate depth at the depth map's resolution; its hole also covers the grown edge of the subject
  const holeD0 = new Uint8Array(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const X = Math.min(W - 1, Math.floor(((x + 0.5) * W) / dw));
      const Y = Math.min(H - 1, Math.floor(((y + 0.5) * H) / dh));
      holeD0[y * dw + x] = hole[Y * W + X] | m.mask[y * dw + x];
    }
  }
  const holeD = dilate(holeD0, dw, dh, grow + 3);
  const dwt = new Float32Array(dw * dh);
  for (let i = 0; i < dwt.length; i++) dwt[i] = holeD[i] ? 0 : 1;
  const pd = pushPull(Float32Array.from(depth.data), dwt, dw, dh);
  const plateDepth = new Uint8Array(dw * dh);
  const bgSrc = depth.bg || depth.data;
  const plateBgDepth = new Uint8Array(dw * dh);
  for (let i = 0; i < pd.length; i++) {
    plateDepth[i] = clamp(Math.round(holeD[i] ? Math.min(pd[i], depth.data[i]) : depth.data[i]), 0, 255);
    plateBgDepth[i] = holeD[i] ? plateDepth[i] : Math.min(bgSrc[i], plateDepth[i]);
  }
  // background layer colour: the refilled background, with the plate inside the hole
  const plateBg = new ImageData(dw, dh);
  const bgc = depth.bgColor ? depth.bgColor.data : null;
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const i = y * dw + x;
      const X = Math.min(W - 1, Math.floor(((x + 0.5) * W) / dw));
      const Y = Math.min(H - 1, Math.floor(((y + 0.5) * H) / dh));
      const j = Y * W + X;
      const fromPlate = holeD[i] || !bgc;
      for (let ch = 0; ch < 3; ch++) plateBg.data[i * 4 + ch] = fromPlate ? plate.data[j * 4 + ch] : bgc[i * 4 + ch];
      plateBg.data[i * 4 + 3] = 255;
    }
  }

  // dissolve order for Vanish: a diagonal front across the subject plus fractal noise, equalised
  // so the front eats the same area every frame
  const bw = Math.max(1, bx1 - bx0);
  const bh = Math.max(1, by1 - by0);
  const sc = Math.max(bw, bh);
  const raw = new Float32Array(N);
  const idx = [];
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const i = y * W + x;
      if (!hole[i]) continue;
      const u = (x - bx0) / bw;
      const v = (y - by0) / bh;
      let f = 0;
      let amp = 0.5;
      let fr = 5 / sc;
      for (let o = 0; o < 4; o++) { f += amp * valueNoise(x * fr, y * fr, 17 + o * 31); amp *= 0.5; fr *= 2.1; }
      raw[i] = (1 - u) * 0.55 + v * 0.45 + (f - 0.47) * 0.85;
      idx.push(i);
    }
  }
  idx.sort((a, b) => raw[a] - raw[b]);
  const order = new Float32Array(N);
  for (let k = 0; k < idx.length; k++) order[idx[k]] = idx.length > 1 ? k / (idx.length - 1) : 0;

  // halo for glows: the matte, blurred wide
  const halo = boxF(boxF(alpha, W, H, Math.max(2, Math.round(Math.max(W, H) / 120))), W, H, Math.max(2, Math.round(Math.max(W, H) / 160)));
  const holeSoft = boxF(Float32Array.from(hole), W, H, 2);
  const fx = new Uint8Array(N * 4);
  let ax = 0, ay = 0, aw = 0;
  for (let i = 0; i < N; i++) {
    fx[i * 4] = Math.round(alphaS[i] * 255);
    fx[i * 4 + 1] = Math.round(clamp(halo[i] * 1.6, 0, 1) * 255);
    fx[i * 4 + 2] = Math.round(order[i] * 255);
    fx[i * 4 + 3] = Math.round(clamp(holeSoft[i] * 1.3, 0, 1) * 255);
    if (alphaS[i] > 0.5) { const x = i % W; ax += x; ay += (i - x) / W; aw++; }
  }
  // subject depth (median inside the matte) and centroid, in the depth map's terms
  const ds = [];
  for (let i = 0; i < m.mask.length; i += 2) if (m.mask[i]) ds.push(depth.data[i]);
  ds.sort((a, b) => a - b);
  const subjectDepth = ds.length ? ds[Math.floor(ds.length * 0.5)] / 255 : 0.6;
  // where the subject runs off the frame: those cut edges must stay out of view when the camera moves
  const edges = [];
  const stepE = Math.max(1, Math.round(Math.max(W, H) / 48));
  for (let x = 0; x < W; x += stepE) {
    if (alphaS[x] > 0.5) edges.push({ side: 't', u: x / (W - 1), v: 1 });
    if (alphaS[(H - 1) * W + x] > 0.5) edges.push({ side: 'b', u: x / (W - 1), v: 0 });
  }
  for (let y = 0; y < H; y += stepE) {
    if (alphaS[y * W] > 0.5) edges.push({ side: 'l', u: 0, v: 1 - y / (H - 1) });
    if (alphaS[y * W + W - 1] > 0.5) edges.push({ side: 'r', u: 1, v: 1 - y / (H - 1) });
  }
  const cu = aw ? (ax / aw + 0.5) / W : 0.5;
  const cv = aw ? 1 - (ay / aw + 0.5) / H : 0.5; // v up, like the renderer
  return {
    image, W, H, fx, plate, plateDepth, plateBgDepth, plateBg, dw, dh,
    fallback: m.fallback, area: aw / N, bbox: [bx0 / W, by0 / H, bx1 / W, by1 / H],
    subjectDepth, centroid: [cu, cv], edges, ms: Math.round(performance.now() - t0),
  };
}

// ---------------------------------------------------------------------------------------------
// GPU
// ---------------------------------------------------------------------------------------------

const MESH_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUv;
uniform sampler2D uDepth;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uAspect;
uniform float uD;
uniform float uSNear;
uniform float uSFar;
uniform float uPush;
uniform float uRelief;
uniform float uReliefD;
out vec2 vUv;
out float vDepth;
out float vS;
void main() {
  float d = texture(uDepth, aUv).r;
  d = d > uReliefD ? uReliefD + (d - uReliefD) * uRelief : d;
  float s = uPush / mix(1.0 / uSFar, 1.0 / uSNear, d);
  vec3 P = vec3((aUv.x - 0.5) * uAspect, aUv.y - 0.5, 0.0);
  vec3 C = vec3(0.0, 0.0, uD);
  vUv = aUv;
  vDepth = d;
  vS = s;
  gl_Position = uProj * uView * vec4(C + (P - C) * s, 1.0);
}`;

// One shader for every mesh layer an effect draws: the photo (two layers, cut at depth cliffs),
// the clean plate behind the subject, and the subject alone (alpha from the matte), with optional
// dissolve front, tint, glow halo and the LiDAR sweep.
const MESH_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in float vDepth;
in float vS;
uniform sampler2D uColor;
uniform sampler2D uPlate;
uniform sampler2D uFx;
uniform sampler2D uDepth;
uniform float uSource;
uniform float uLod;
uniform float uAspect;
uniform float uCut;
uniform float uSubject;
uniform float uDissolve;
uniform float uBlock;
uniform vec2 uBlockGrid;
uniform vec3 uEdge;
uniform vec4 uTint;
uniform float uAlpha;
uniform float uGlow;
uniform vec3 uGlowColor;
uniform float uSweep;
uniform float uSweepBack;
uniform vec3 uSweepColor;
uniform float uFocus;
uniform float uBlur;
uniform float uReveal;
uniform float uRevealFront;
out vec4 frag;
const float GA = 2.39996323;

// The clean plate only replaces the photo once something could show it: as the camera leaves its
// rest pose, or (Vanish) where the dissolve front has passed. At rest the frame is the photo.
float plateMix(vec2 uv) {
  if (uSource < 0.5) return 0.0;
  if (uSource > 1.5 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
  vec4 f = texture(uFx, uv);
  float r = uRevealFront > -0.5 ? 1.0 - smoothstep(uRevealFront - 0.04, uRevealFront, f.b) : uReveal;
  return f.a * r;
}
// k: how much of the plate shows, judged once per pixel so blur taps fetch only what they need
vec3 colorAt(vec2 uv, float k) {
  if (k <= 0.001) return texture(uColor, uv, uLod).rgb;
  vec3 p = texture(uPlate, uv, uLod).rgb;
  if (k >= 0.999) return p;
  return mix(texture(uColor, uv, uLod).rgb, p, k);
}

void main() {
  float a = 1.0;
  float halo = 0.0;
  if (uSubject > 0.5) {
    vec4 m = texture(uFx, vUv);
    a = m.r;
    halo = m.g * (1.0 - a) * uGlow;
    if (a < 0.004 && halo < 0.004) discard;
  } else {
    vec2 dx = dFdx(vUv);
    vec2 dy = dFdy(vUv);
    float ddx = dFdx(vDepth);
    float ddy = dFdy(vDepth);
    float det = dx.x * dy.y - dx.y * dy.x;
    vec2 g = vec2(ddx * dy.y - dx.y * ddy, dx.x * ddy - ddx * dy.x) / (abs(det) > 1e-12 ? det : 1e-12);
    if (length(vec2(g.x / uAspect, g.y)) > uCut) discard;
  }
  float edge = 0.0;
  if (uDissolve > -0.5) {
    vec2 q = uBlock > 0.5 ? (floor(vUv * uBlockGrid) + 0.5) / uBlockGrid : vUv;
    float o = texture(uFx, q).b;
    if (o < uDissolve) discard;
    edge = 1.0 - smoothstep(0.0, 0.045, o - uDissolve);
  }
  float sweepGlow = 0.0;
  if (uSweep > 0.0) {
    if (vS < uSweep && vS > uSweepBack) discard;
    float w = 0.014 * vS;
    sweepGlow = exp(-pow((vS - uSweep) / w, 2.0)) + exp(-pow((vS - uSweepBack) / w, 2.0)) * step(0.001, uSweepBack);
    sweepGlow *= smoothstep(0.035, 0.12, vDepth); // the sky returns nothing, so it never lights up
  }
  vec3 col;
  float coc = clamp(abs(vDepth - uFocus) * 1.7, 0.0, 1.0) * uBlur;
  float k = plateMix(vUv);
  if (coc < 0.0007) {
    col = colorAt(vUv, k);
  } else {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    vec2 scale = vec2(coc / uAspect, coc);
    for (int i = 0; i < 16; i++) {
      float r = sqrt((float(i) + 0.5) / 16.0);
      float th = float(i) * GA;
      vec2 uv2 = vUv + vec2(cos(th), sin(th)) * r * scale;
      vec3 c = colorAt(uv2, k);
      float w = 1.0 + smoothstep(0.72, 1.0, dot(c, vec3(0.299, 0.587, 0.114))) * 2.5;
      acc += c * w;
      wsum += w;
    }
    col = acc / wsum;
  }
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, uTint.rgb * (0.25 + 1.25 * l), uTint.a);
  col = mix(col, col * 0.25, smoothstep(0.0, 1.0, edge) * 0.5);
  col += uEdge * edge * edge * 1.6;
  col += uSweepColor * sweepGlow * 0.9;
  vec3 glow = uGlowColor * halo;
  float outA = clamp(a + halo, 0.0, 1.0) * uAlpha;
  frag = vec4((col * a + glow) * uAlpha, outA);
}`;

// LiDAR returns: one point per sample on horizontal scanlines, coloured by style, lit at the
// sweep front, on depth edges and by passing scan pulses. Additive, so no sorting.
const LIDAR_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUv;
layout(location = 1) in vec2 aRnd;
uniform sampler2D uDepth;
uniform sampler2D uColor;
uniform sampler2D uFx;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uAspect;
uniform float uD;
uniform float uSNear;
uniform float uSFar;
uniform float uSize;
uniform float uSweep;
uniform float uSweepBack;
uniform float uPulse;
uniform float uPulseAmt;
uniform float uSec;
uniform float uStyle;
uniform float uSky;
uniform vec2 uTexel;
out vec3 vCol;
vec3 thermal(float h) {
  vec3 c = mix(vec3(0.02, 0.0, 0.10), vec3(0.32, 0.02, 0.55), smoothstep(0.0, 0.28, h));
  c = mix(c, vec3(0.92, 0.08, 0.32), smoothstep(0.25, 0.5, h));
  c = mix(c, vec3(1.0, 0.48, 0.02), smoothstep(0.48, 0.7, h));
  c = mix(c, vec3(1.0, 0.9, 0.25), smoothstep(0.68, 0.86, h));
  return mix(c, vec3(1.0, 1.0, 0.92), smoothstep(0.86, 1.0, h));
}
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  float d = texture(uDepth, aUv).r;
  float s = 1.0 / mix(1.0 / uSFar, 1.0 / uSNear, d);
  bool live = s < uSweep && s > uSweepBack && d > uSky;
  if (!live) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec3(0.0); return; }
  vec3 P = vec3((aUv.x - 0.5) * uAspect, aUv.y - 0.5, 0.0);
  vec3 C = vec3(0.0, 0.0, uD);
  vec4 vp = uView * vec4(C + (P - C) * s, 1.0);
  gl_Position = uProj * vp;
  float z = max(0.02, -vp.z);
  float px = uSize * s / z;
  gl_PointSize = clamp(px, 1.0, 48.0);
  float dl = texture(uDepth, aUv - vec2(uTexel.x, 0.0)).r;
  float dr = texture(uDepth, aUv + vec2(uTexel.x, 0.0)).r;
  float du = texture(uDepth, aUv + vec2(0.0, uTexel.y)).r;
  float dd = texture(uDepth, aUv - vec2(0.0, uTexel.y)).r;
  float edge = clamp(length(vec2(dr - dl, du - dd)) * 9.0, 0.0, 1.0);
  vec3 photo = texture(uColor, aUv).rgb;
  float lum = dot(photo, vec3(0.299, 0.587, 0.114));
  float matte = texture(uFx, aUv).r;
  float fog = mix(0.42, 1.0, smoothstep(0.0, 0.8, d));
  vec3 col;
  if (uStyle < 0.5) {
    col = vec3(0.12, 0.78, 1.0) * (0.22 + 0.75 * lum + 0.8 * edge) * fog;
  } else if (uStyle < 1.5) {
    float h = clamp(0.06 + 0.42 * d + 0.38 * lum + 0.42 * matte + 0.15 * edge, 0.0, 1.0);
    col = thermal(h) * (0.62 + 0.5 * edge) * mix(0.7, 1.0, fog);
  } else {
    col = vec3(0.86, 0.92, 1.0) * (0.16 + 0.8 * lum + 0.7 * edge) * fog;
  }
  float front = exp(-pow((s - uSweep) / (0.03 * s), 2.0));
  float back = exp(-pow((s - uSweepBack) / (0.03 * s), 2.0)) * step(0.001, uSweepBack);
  float pulse = exp(-pow((s - uPulse) / (0.018 * s), 2.0)) * uPulseAmt;
  vec3 hot = uStyle > 0.5 && uStyle < 1.5 ? vec3(1.0, 0.95, 0.8) : (uStyle < 0.5 ? vec3(0.65, 1.0, 1.0) : vec3(1.0));
  col += hot * (2.2 * (front + back) + 0.9 * pulse);
  col *= 0.88 + 0.24 * h12(aRnd * 91.0 + floor(uSec * 18.0));
  float cover = clamp(px * px / 4.0, 0.15, 1.0);
  vCol = col * cover;
}`;

const LIDAR_FS = `#version 300 es
precision highp float;
in vec3 vCol;
out vec4 frag;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  frag = vec4(vCol * exp(-r2 * 2.6), 1.0);
}`;

// Vanish particles: each one is a bit of the subject that comes loose when the dissolve front
// passes it, then rides wind plus divergence-free curl noise. Stateless: position is a function
// of birth place and age, integrated in a few steps, so any frame can be drawn on its own.
const DUST_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUv;
layout(location = 1) in vec2 aRnd;
uniform sampler2D uDepth;
uniform sampler2D uColor;
uniform sampler2D uFx;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uAspect;
uniform float uD;
uniform float uSNear;
uniform float uSFar;
uniform float uFront;
uniform float uRate;
uniform float uLifeA;
uniform float uLifeB;
uniform float uSec;
uniform float uLook;
uniform float uSize;
uniform float uTurb;
uniform vec3 uWind;
uniform float uBlockW;
uniform float uLod;
out vec4 vCol;
out float vSquare;
float h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), u.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), u.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}
vec3 curl(vec3 p) {
  const float e = 0.12;
  float a = vnoise(p + vec3(0.0, e, 0.0)) - vnoise(p - vec3(0.0, e, 0.0));
  float b = vnoise(p + vec3(e, 0.0, 0.0)) - vnoise(p - vec3(e, 0.0, 0.0));
  return vec3(a, -b, vnoise(p * 0.7 + 23.0) * 2.0 * e - e) / (2.0 * e);
}
void main() {
  float order = texture(uFx, aUv).b;
  float age = (uFront - order) / uRate;
  float life = min(uLifeA, uLifeB * (1.0 - order) + 0.25 * uLifeB) * (0.62 + 0.38 * aRnd.x);
  float hide = texture(uFx, aUv).r < 0.3 ? 1.0 : 0.0;
  if (age <= 0.0 || age >= life || hide > 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vCol = vec4(0.0); vSquare = 0.0; return; }
  float d = texture(uDepth, aUv).r;
  float s = 1.0 / mix(1.0 / uSFar, 1.0 / uSNear, d);
  vec3 P = vec3((aUv.x - 0.5) * uAspect, aUv.y - 0.5, 0.0);
  vec3 C = vec3(0.0, 0.0, uD);
  vec3 start = C + (P - C) * s;
  vec3 pos = start;
  float hs = age / 5.0;
  float born = uSec - age;
  vec3 wind = uWind * (0.55 + 0.9 * aRnd.y);
  for (int i = 0; i < 5; i++) {
    float a = (float(i) + 0.5) * hs;
    vec3 q = pos * 3.4 + vec3(aRnd * 0.15, (born + a) * 0.45);
    vec3 v = wind * min(1.0, a / 0.55) + curl(q) * uTurb * min(1.0, a / 0.25);
    pos += v * hs;
  }
  vec3 disp = pos - start;
  if (uLook > 1.5) {
    float bw = uBlockW * s;
    disp = floor(disp / bw + 0.5) * bw;
  }
  vec4 vp = uView * vec4(start + disp, 1.0);
  gl_Position = uProj * vp;
  float z = max(0.02, -vp.z);
  float k = age / life;
  float fade = 1.0 - smoothstep(0.5, 1.0, k);
  vec3 photo = textureLod(uColor, aUv, uLod).rgb;
  vec3 col;
  float size;
  vSquare = 0.0;
  if (uLook < 0.5) {
    vec3 ash = mix(vec3(0.3, 0.29, 0.28), photo * 0.5, 0.35) * (0.45 + 1.1 * aRnd.y);
    col = mix(photo, ash, smoothstep(0.0, 0.6, age)) + vec3(1.0, 0.45, 0.1) * exp(-age * 6.0) * 1.1;
    size = mix(1.7, 0.6, k);
    float a = fade * 0.9;
    vCol = vec4(col * a, a);
  } else if (uLook < 1.5) {
    float heat = exp(-age * 1.3);
    vec3 hot = mix(vec3(0.85, 0.14, 0.03), vec3(1.0, 0.66, 0.22), heat) * (0.9 + 1.1 * heat);
    col = mix(photo, hot, smoothstep(0.0, 0.2, age));
    col *= 0.7 + 0.3 * sin(uSec * 21.0 + aRnd.x * 60.0);
    size = mix(1.25, 0.5, k) * (aRnd.y > 0.85 ? 1.7 : 1.0);
    vCol = vec4(col * fade * (aRnd.y > 0.85 ? 1.6 : 0.85), 0.0);
  } else {
    col = photo * (1.0 + 0.25 * step(0.92, aRnd.y));
    size = 1.0 - smoothstep(0.55, 1.0, k);
    vSquare = 1.0;
    vCol = vec4(col, 1.0) * step(0.02, size);
  }
  gl_PointSize = clamp(uSize * size * s / z, 0.0, 64.0);
}`;

const DUST_FS = `#version 300 es
precision highp float;
in vec4 vCol;
in float vSquare;
out vec4 frag;
void main() {
  if (vSquare > 0.5) { frag = vCol; return; }
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  frag = vCol * smoothstep(1.0, 0.25, r2);
}`;

const QUAD_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Bloom: bright pass to a quarter-size buffer, two separable blurs, added back to the scene.
const BLOOM_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uMode;
uniform float uThreshold;
uniform float uGain;
out vec4 frag;
void main() {
  if (uMode < 0.5) {
    vec3 c = texture(uTex, vUv).rgb;
    frag = vec4(max(c - uThreshold, 0.0), 1.0);
  } else if (uMode < 1.5) {
    vec3 acc = texture(uTex, vUv).rgb * 0.227;
    acc += (texture(uTex, vUv + uDir * 1.38).rgb + texture(uTex, vUv - uDir * 1.38).rgb) * 0.316;
    acc += (texture(uTex, vUv + uDir * 3.23).rgb + texture(uTex, vUv - uDir * 3.23).rgb) * 0.070;
    frag = vec4(acc, 1.0);
  } else {
    frag = vec4(texture(uTex, vUv).rgb * uGain, 1.0);
  }
}`;

function hsv(h, s, v) {
  const f = (n) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

function rotY(v, pivot, a) {
  const x = v[0] - pivot[0];
  const z = v[2] - pivot[2];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [pivot[0] + x * c + z * s, v[1], pivot[2] - x * s + z * c];
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const EXT = 1.6; // how far the clean plate is extended (mirrored) past each image edge, in image sizes

export class EffectEngine {
  constructor(renderer) {
    this.r = renderer;
    const gl = (this.gl = renderer.gl);
    this.mesh = program(gl, MESH_VS, MESH_FS);
    this.lidar = program(gl, LIDAR_VS, LIDAR_FS);
    this.dust = program(gl, DUST_VS, DUST_FS);
    this.bloomProg = program(gl, QUAD_VS, BLOOM_FS);
    this.quadVao = gl.createVertexArray();
    this.fxTex = this._tex(gl.CLAMP_TO_EDGE);
    this.plateTex = this._tex(gl.MIRRORED_REPEAT);
    this.plateDepthTex = this._tex(gl.MIRRORED_REPEAT);
    this.plateBgDepthTex = this._tex(gl.MIRRORED_REPEAT);
    this.plateBgTex = this._tex(gl.MIRRORED_REPEAT);
    this.inner = null;
    this.ext = null;
    this.points = new Map();
    this.prep = null;
    this.density = 1;
    this.zoomCache = new Map();
    this.bloomSize = [0, 0];
  }

  _tex(wrap) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    return t;
  }

  _upload(tex, w, h, data, format, mip = false) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (format === 'r') gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }

  /** Build (or reuse) the matte and clean plate for a still and upload them. */
  prepare(image, depth) {
    if (!depth.fxPrep || depth.fxPrep.image !== image) depth.fxPrep = prepareStill(image, depth);
    const p = depth.fxPrep;
    if (this.prep !== p) {
      this.prep = p;
      this._upload(this.fxTex, p.W, p.H, p.fx, 'rgba');
      this._upload(this.plateTex, p.W, p.H, p.plate.data, 'rgba', true);
      this._upload(this.plateBgTex, p.dw, p.dh, p.plateBg.data, 'rgba', true);
      this._upload(this.plateDepthTex, p.dw, p.dh, p.plateDepth, 'r');
      this._upload(this.plateBgDepthTex, p.dw, p.dh, p.plateBgDepth, 'r');
      this.points.clear();
      this.zoomCache.clear();
    }
    return p;
  }

  /** A mesh over the given u and v coordinates (vertex grid us x vs). */
  _grid(us, vs) {
    const gl = this.gl;
    const cols = us.length - 1;
    const rows = vs.length - 1;
    const verts = new Float32Array((cols + 1) * (rows + 1) * 2);
    let k = 0;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        verts[k++] = us[i];
        verts[k++] = vs[j];
      }
    }
    const idx = new Uint32Array(cols * rows * 6);
    k = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i;
        const c = a + cols + 1;
        idx[k++] = a; idx[k++] = a + 1; idx[k++] = c;
        idx[k++] = a + 1; idx[k++] = c + 1; idx[k++] = c;
      }
    }
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: idx.length, aspect: this.r.aspect, vb, ib };
  }

  _grids() {
    const a = this.r.aspect;
    if (!this.inner || this.inner.aspect !== a || this.sub?.prep !== this.prep) {
      for (const g of [this.inner, this.ext, this.sub]) if (g) { this.gl.deleteBuffer(g.vb); this.gl.deleteBuffer(g.ib); this.gl.deleteVertexArray(g.vao); }
      // 320 cells along the long side inside the picture; outside it, cells grow toward the far edge
      const n = (len) => Math.max(40, Math.round((320 * len) / Math.max(a, 1)));
      const axis = (cells, ext) => {
        const inner = Array.from({ length: cells + 1 }, (_, i) => i / cells);
        if (!ext) return inner;
        const out = [];
        const m = 24;
        for (let i = m; i >= 1; i--) out.push(-ext * Math.pow(i / m, 1.6));
        return [...out, ...inner, ...out.slice().reverse().map((u) => 1 - u)];
      };
      const cu = n(a);
      const cv = n(1);
      this.inner = this._grid(axis(cu, 0), axis(cv, 0));
      this.ext = this._grid(axis(cu, EXT), axis(cv, EXT));
      // the subject layers only need the subject's box (plus room for glows), not the whole frame
      const [x0, y0, x1, y1] = this.prep.bbox;
      const span = (lo, hi, cells) => {
        const a0 = Math.max(0, lo - 0.05);
        const a1 = Math.min(1, hi + 0.05);
        const n = Math.max(8, Math.round(cells * (a1 - a0)));
        return Array.from({ length: n + 1 }, (_, i) => a0 + ((a1 - a0) * i) / n);
      };
      this.sub = this._grid(span(x0, x1, cu), span(1 - y1, 1 - y0, cv));
      this.sub.prep = this.prep;
    }
  }

  _pointBuffer(key, build) {
    let pb = this.points.get(key);
    if (pb) return pb;
    const gl = this.gl;
    const { uv, rnd, count } = build();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const b0 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b0);
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const b1 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b1);
    gl.bufferData(gl.ARRAY_BUFFER, rnd, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    for (const [k, v] of this.points) if (k.split(':')[0] === key.split(':')[0]) { gl.deleteBuffer(v.b0); gl.deleteBuffer(v.b1); gl.deleteVertexArray(v.vao); this.points.delete(k); }
    pb = { vao, count, b0, b1 };
    this.points.set(key, pb);
    return pb;
  }

  /** Scanline samples for LiDAR: about 345k at 1080p, fewer for smaller output. */
  _lidarPoints() {
    const H = this.r.canvas.height;
    const rows = Math.round(clamp(220 * (H / 1080) * Math.sqrt(this.density), 40, 420));
    const cols = Math.round(rows * this.r.aspect * 4);
    return this._pointBuffer(`lidar:${rows}x${cols}`, () => {
      const count = rows * cols;
      const uv = new Float32Array(count * 2);
      const rnd = new Float32Array(count * 2);
      const rand = mulberry32(7);
      let k = 0;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          uv[k * 2] = (i + rand()) / cols;
          uv[k * 2 + 1] = (j + 0.5) / rows;
          rnd[k * 2] = rand();
          rnd[k * 2 + 1] = rand();
          k++;
        }
      }
      return { uv, rnd, count, rows, cols };
    });
  }

  /** Vanish particles: a jittered grid over the subject, or square blocks for the pixel look. */
  _dustPoints(look) {
    const p = this.prep;
    const outH = this.r.canvas.height;
    const pixels = look === 'pixels';
    // spacing in image heights: about 150k particles for the subject at 1080p, finer for small subjects
    const area = Math.max(1e-4, p.area) * this.r.aspect;
    const target = Math.max(20000, 150000 * (outH / 1080) ** 2) * this.density;
    const step = pixels ? 1 / 110 : clamp(Math.sqrt(area / target), 0.6 / outH, 3 / outH);
    const key = `dust:${pixels ? 'px' : 'fine'}:${step.toFixed(6)}`;
    const pb = this._pointBuffer(key, () => {
      const a = this.r.aspect;
      const cols = Math.max(2, Math.round(a / step));
      const rows = Math.max(2, Math.round(1 / step));
      const [u0, v0, u1, v1] = p.bbox;
      const uvs = [];
      const rnds = [];
      const rand = mulberry32(11);
      const cap = 320000;
      for (let j = Math.floor(v0 * rows); j <= Math.ceil(v1 * rows); j++) {
        for (let i = Math.floor(u0 * cols); i <= Math.ceil(u1 * cols); i++) {
          const jx = pixels ? 0.5 : rand();
          const jy = pixels ? 0.5 : rand();
          const u = (i + jx) / cols;
          const vt = (j + jy) / rows; // from the top
          const X = Math.min(p.W - 1, Math.max(0, Math.floor(u * p.W)));
          const Y = Math.min(p.H - 1, Math.max(0, Math.floor(vt * p.H)));
          const r1 = rand();
          const r2 = rand();
          if (p.fx[(Y * p.W + X) * 4] < 77) continue;
          uvs.push(u, 1 - vt);
          rnds.push(r1, r2);
        }
      }
      let count = uvs.length / 2;
      let uv = new Float32Array(uvs);
      let rnd = new Float32Array(rnds);
      if (count > cap) {
        const keep = cap / count;
        const u2 = [];
        const r2 = [];
        for (let i = 0; i < count; i++) if (hash2(i, 3) < keep) { u2.push(uv[i * 2], uv[i * 2 + 1]); r2.push(rnd[i * 2], rnd[i * 2 + 1]); }
        uv = new Float32Array(u2);
        rnd = new Float32Array(r2);
        count = u2.length / 2;
      }
      return { uv, rnd, count };
    });
    pb.step = step;
    return pb;
  }

  // ----- cameras: each maps t to { eye, target, fov, roll, focus, blur } like a move -----

  _pivot(ctx) {
    const p = this.prep;
    const r = this.r;
    const D = ctx.D;
    const d = p && !p.fallback ? p.subjectDepth : null;
    const s = d != null ? r.sFor(d) : ctx.sSub;
    const [u, v] = p && !p.fallback ? p.centroid : [0.5, 0.5];
    return [(u - 0.5) * r.aspect * s, (v - 0.5) * s, D - D * s];
  }

  camera(id, t, ctx) {
    const D = ctx.D;
    const k = ctx.k;
    const rest = [0, 0, D];
    const ahead = (e) => [e[0], e[1], e[2] - D];
    const base = { fov: REST_FOV, roll: 0, focus: ctx.focusSub, blur: ctx.blur };
    if (id === 'lidar') {
      const pivot = this._pivot(ctx);
      const w = smooth(win(t, 0.17, 0.9));
      const b = Math.sin(Math.PI * w);
      const yaw = 0.5 * k * b;
      const pushed = lerp3(rest, pivot, 0.28 * k * b);
      pushed[1] += 0.06 * D * k * b;
      const eye = rotY(pushed, pivot, yaw);
      const aim = lerp3(ahead(rest), pivot, smooth(Math.min(1, b * 1.6)));
      return { ...base, eye, target: aim, roll: -0.04 * k * b };
    }
    if (id === 'freeze') {
      const pivot = this._pivot(ctx);
      const push = easeIO(win(t, 0.02, 0.25));
      const back = easeIOCubic(win(t, 0.7, 0.97));
      const swing = easeIOCubic(win(t, 0.27, 0.66));
      const hold = push * (1 - back);
      const a = 0.6 * k * swing * (1 - back); // about 34 degrees at full intensity
      // push in on small subjects, barely at all on a close-up
      const area = this.prep && !this.prep.fallback ? this.prep.area : 0.2;
      const eye0 = lerp3(rest, pivot, (0.06 + 0.24 * (1 - smooth(win(area, 0.04, 0.3)))) * hold);
      eye0[1] += 0.03 * D * k * swing * (1 - back);
      const eye = rotY(eye0, pivot, a);
      const target = lerp3(ahead(rest), pivot, hold);
      return { ...base, eye, target, roll: -0.05 * a, focus: this.prep && !this.prep.fallback ? this.prep.subjectDepth : ctx.focusSub };
    }
    if (id === 'clones') {
      const e = easeIOCubic(win(t, 0.04, 0.84));
      // about a fifth of the frame width at the subject's distance, so portraits move as far as landscapes
      const X = 0.42 * D * ctx.sSub * Math.tan((REST_FOV * Math.PI) / 360) * this.r.aspect * k;
      const eye = [X * e, 0.012 * D * Math.sin(Math.PI * e) * k, D];
      return { ...base, eye, target: ahead(eye) };
    }
    return { ...base, eye: rest, target: ahead(rest) };
  }

  /** Extra zoom over time so the clean plate's (extended) edges never enter the frame. */
  _zoomCurve(id, ctx, outAspect) {
    const key = `${id}|${ctx.k}|${ctx.sSub}|${outAspect.toFixed(4)}|${this.r.sNear}|${this.r.sFar}`;
    let curve = this.zoomCache.get(key);
    if (curve) return curve;
    const r = this.r;
    const p = this.prep;
    // Clones zoom against the real picture edge (no mirrored scenery on a slow slide); the freeze
    // swing is too wide for that, so it may use the mirrored extension.
    const ext = id === 'freeze' ? EXT * 0.9 : 0;
    const N = 24;
    const border = [];
    const mirror = (u) => { const m = ((u % 2) + 2) % 2; return m > 1 ? 2 - m : m; };
    const depthAt = (u, v) => {
      const x = Math.round(mirror(u) * (p.dw - 1));
      const y = Math.round((1 - mirror(v)) * (p.dh - 1));
      return p.plateBgDepth[y * p.dw + x] / 255;
    };
    const wp = (u, v) => {
      const s = r.sFor(depthAt(u, v)) * 1.004;
      const D = r.restDistance;
      return [(u - 0.5) * r.aspect * s, (v - 0.5) * s, D - D * s];
    };
    for (let i = 0; i <= N; i++) {
      const t = -ext + ((1 + 2 * ext) * i) / N;
      border.push({ side: 'b', p: wp(t, -ext) }, { side: 't', p: wp(t, 1 + ext) }, { side: 'l', p: wp(-ext, t) }, { side: 'r', p: wp(1 + ext, t) });
    }
    if (ext && !p.fallback) {
      for (const e of p.edges) {
        const s = r.sFor(p.subjectDepth);
        const D = r.restDistance;
        border.push({ side: e.side, p: [(e.u - 0.5) * r.aspect * s, (e.v - 0.5) * s, D - D * s] });
      }
    }
    const S = 40;
    const need = [];
    for (let i = 0; i <= S; i++) {
      const cam = this.camera(id, i / S, ctx);
      const { proj, view } = r.viewProj(cam, outAspect);
      const vp = mat4.multiply(proj, view);
      let z = 1;
      for (const { side, p: q } of border) {
        const c = mat4.transformPoint(vp, q);
        if (c[3] <= 1e-4) { if (!ext) z = Math.max(z, 3); continue; } // the far-out plate edge can fall behind the camera
        const x = c[0] / c[3];
        const y = c[1] / c[3];
        let nz = 1;
        if (side === 'l') nz = x < -1e-3 ? 1 / -x : 3;
        if (side === 'r') nz = x > 1e-3 ? 1 / x : 3;
        if (side === 'b') nz = y < -1e-3 ? 1 / -y : 3;
        if (side === 't') nz = y > 1e-3 ? 1 / y : 3;
        z = Math.max(z, nz);
      }
      // never crop in hard: past this, the mirrored plate covers the edge
      need.push(Math.min(id === 'clones' ? 1.25 : 1.8, z * 1.01));
    }
    // widen peaks so the zoom eases in and out instead of snapping
    curve = need.map((_, i) => {
      let m = 1;
      for (let j = -3; j <= 3; j++) {
        const v = need[clamp(i + j, 0, S)];
        m = Math.max(m, 1 + (v - 1) * (1 - Math.abs(j) / 4));
      }
      return m;
    });
    this.zoomCache.set(key, curve);
    return curve;
  }

  zoomAt(id, t, ctx, outAspect) {
    if (id === 'lidar' || id === 'vanish') return 1;
    const c = this._zoomCurve(id, ctx, outAspect);
    const f = clamp(t, 0, 1) * (c.length - 1);
    const i = Math.floor(f);
    const a = c[i];
    const b = c[Math.min(c.length - 1, i + 1)];
    return a + (b - a) * (f - i);
  }

  // ----- drawing -----

  _meshUniforms(proj, view, cam) {
    const gl = this.gl;
    const r = this.r;
    const { u } = this.mesh;
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform1f(u.uAspect, r.aspect);
    gl.uniform1f(u.uD, r.restDistance);
    gl.uniform1f(u.uSNear, r.sNear);
    gl.uniform1f(u.uSFar, r.sFar);
    gl.uniform1f(u.uFocus, cam.focus ?? 0.6);
  }

  /**
   * Draw one mesh layer. o: { layer: 'photo' | 'photoBg' | 'plate' | 'plateBg' | 'subject', grid, view, push,
   * relief, alpha, tint [r,g,b,a], glow, glowColor, dissolve, edge, block, sweep, sweepBack, sweepColor, blur }
   */
  _drawMesh(o) {
    const gl = this.gl;
    const r = this.r;
    const { u } = this.mesh;
    const layer = o.layer;
    if (o.view) gl.uniformMatrix4fv(u.uView, false, o.view);
    // textures: 0 colour, 1 depth, 2 plate colour, 3 fx
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, layer === 'photoBg' ? r.bgColorTex : r.colorTex);
    gl.activeTexture(gl.TEXTURE1);
    const depthTex = { photo: r.depthTex, photoBg: r.bgDepthTex, plate: this.plateDepthTex, plateBg: this.plateBgDepthTex, subject: r.depthTex }[layer];
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, layer === 'plateBg' ? this.plateBgTex : this.plateTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.fxTex);
    gl.uniform1i(u.uColor, 0);
    gl.uniform1i(u.uDepth, 1);
    gl.uniform1i(u.uPlate, 2);
    gl.uniform1i(u.uFx, 3);
    const bg = layer === 'photoBg' || layer === 'plateBg';
    gl.uniform1f(u.uSource, layer === 'plate' ? 1 : layer === 'plateBg' ? 2 : 0);
    gl.uniform1f(u.uLod, bg ? 0.5 : 0);
    gl.uniform1f(u.uPush, o.push ?? (bg ? 1.004 : 1));
    gl.uniform1f(u.uRelief, o.relief ?? 1);
    gl.uniform1f(u.uReliefD, this.prep ? this.prep.subjectDepth : 0.6);
    gl.uniform1f(u.uCut, bg || layer === 'subject' ? 1e9 : r.cut);
    gl.uniform1f(u.uSubject, layer === 'subject' ? 1 : 0);
    gl.uniform1f(u.uDissolve, o.dissolve ?? -1);
    gl.uniform1f(u.uBlock, o.block ? 1 : 0);
    gl.uniform2f(u.uBlockGrid, o.block ? Math.round(r.aspect * o.block) : 1, o.block || 1);
    gl.uniform3fv(u.uEdge, o.edge || [0, 0, 0]);
    gl.uniform4fv(u.uTint, o.tint || [0, 0, 0, 0]);
    gl.uniform1f(u.uAlpha, o.alpha ?? 1);
    gl.uniform1f(u.uGlow, o.glow ?? 0);
    gl.uniform3fv(u.uGlowColor, o.glowColor || [0, 0, 0]);
    gl.uniform1f(u.uSweep, o.sweep ?? 0);
    gl.uniform1f(u.uSweepBack, o.sweepBack ?? 0);
    gl.uniform3fv(u.uSweepColor, o.sweepColor || [0, 0, 0]);
    gl.uniform1f(u.uBlur, bg ? 0 : (o.blur ?? 0) * 0.014);
    gl.uniform1f(u.uReveal, o.reveal ?? 1);
    gl.uniform1f(u.uRevealFront, o.revealFront ?? -1);
    const g = o.grid || (layer === 'subject' ? this.sub : this.inner);
    gl.bindVertexArray(g.vao);
    gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
  }

  _bloom(strength, threshold = 0) {
    const gl = this.gl;
    const r = this.r;
    const W = Math.max(2, r.canvas.width >> 2);
    const H = Math.max(2, r.canvas.height >> 2);
    if (this.bloomSize[0] !== W || this.bloomSize[1] !== H) {
      this.bloomTex = this.bloomTex || [this._tex(gl.CLAMP_TO_EDGE), this._tex(gl.CLAMP_TO_EDGE)];
      this.bloomFbo = this.bloomFbo || [gl.createFramebuffer(), gl.createFramebuffer()];
      for (let i = 0; i < 2; i++) {
        gl.bindTexture(gl.TEXTURE_2D, this.bloomTex[i]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomFbo[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bloomTex[i], 0);
      }
      this.bloomSize = [W, H];
    }
    const { p, u } = this.bloomProg;
    gl.useProgram(p);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.quadVao);
    gl.uniform1i(u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    const pass = (fbo, tex, mode, dir) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, W, H);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1f(u.uMode, mode);
      gl.uniform2f(u.uDir, dir[0], dir[1]);
      gl.uniform1f(u.uThreshold, threshold);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    pass(this.bloomFbo[0], r.sceneTex, 0, [0, 0]);
    pass(this.bloomFbo[1], this.bloomTex[0], 1, [1 / W, 0]);
    pass(this.bloomFbo[0], this.bloomTex[1], 1, [0, 1 / H]);
    pass(this.bloomFbo[1], this.bloomTex[0], 1, [2.2 / W, 0]);
    pass(this.bloomFbo[0], this.bloomTex[1], 1, [0, 2.2 / H]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo);
    gl.viewport(0, 0, r.canvas.width, r.canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomTex[0]);
    gl.uniform1f(u.uMode, 2);
    gl.uniform1f(u.uGain, strength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /**
   * Render one frame of an effect onto the renderer's canvas.
   * id, look: the effect; t: 0..1; ctx: the move context from the page ({ D, sSub, focusSub, k, blur, ... });
   * fx: finish parameters; time: seconds into the clip (grain, flicker); duration: clip length in seconds.
   */
  draw(id, look, t, ctx, fx, time, duration) {
    const r = this.r;
    const gl = this.gl;
    if (!this.prep || !r.hasImage) { r.render(this.camera(id, 0, ctx), fx, time); return; }
    this._grids();
    this.k = ctx.k;
    const W = r.canvas.width;
    const H = r.canvas.height;
    const camAt = (tt) => {
      const c = this.camera(id, tt, ctx);
      const z = this.zoomAt(id, tt, ctx, W / H);
      return z > 1 ? { ...c, fov: (2 * Math.atan(Math.tan((c.fov * Math.PI) / 360) / z) * 180) / Math.PI } : c;
    };
    const cam = camAt(t);
    const { proj, view } = r.viewProj(cam, W / H);
    let finish = fx;
    r.beginScene(id === 'lidar' ? [0, 0, 0] : [0.08, 0.09, 0.11]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.mesh.p);
    this._meshUniforms(proj, view, cam);
    const blur = cam.blur ?? 0;
    if (id === 'lidar') finish = this._drawLidar(look, t, proj, view, cam, fx, time);
    else if (id === 'vanish') this._drawVanish(look, t, proj, view, blur, duration);
    else if (id === 'freeze') finish = this._drawFreeze(t, fx, blur, this._revealFor(cam, ctx));
    else if (id === 'clones') this._drawClones(look, t, cam, camAt, blur, this._revealFor(cam, ctx));
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    r.finish(finish, time);
  }

  _drawLidar(look, t, proj, view, cam, fx, time) {
    const gl = this.gl;
    const r = this.r;
    const sn = r.sNear * 0.97;
    const sf = r.sFar * 1.06;
    const logS = (e) => Math.exp(Math.log(sn) + (Math.log(sf) - Math.log(sn)) * e);
    const inE = win(t, 0.04, 0.3);
    const outE = win(t, 0.7, 0.95);
    const sweep = inE <= 0 ? 0.0001 : logS(easeIO(inE));
    const sweepBack = outE <= 0 ? 0 : outE >= 1 ? 99 : logS(easeIO(outE));
    const style = look === 'thermal' ? 1 : look === 'white' ? 2 : 0;
    const sweepColor = [[0.4, 1.0, 1.0], [1.0, 0.85, 0.45], [1.0, 1.0, 1.0]][style];
    // photo where it has not been scanned yet, or has been handed back
    if (inE < 1 || outE > 0) {
      const o = { sweep: inE >= 1 ? 99 : sweep, sweepBack, sweepColor, blur: cam.blur };
      this._drawMesh({ ...o, layer: 'photo' });
      this._drawMesh({ ...o, layer: 'photoBg' });
    }
    // the cloud
    if (inE > 0 && outE < 1) {
      const pb = this._lidarPoints();
      const { p, u } = this.lidar;
      gl.useProgram(p);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, r.colorTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, r.depthTex);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.fxTex);
      gl.uniform1i(u.uColor, 0);
      gl.uniform1i(u.uDepth, 1);
      gl.uniform1i(u.uFx, 3);
      gl.uniformMatrix4fv(u.uProj, false, proj);
      gl.uniformMatrix4fv(u.uView, false, view);
      gl.uniform1f(u.uAspect, r.aspect);
      gl.uniform1f(u.uD, r.restDistance);
      gl.uniform1f(u.uSNear, r.sNear);
      gl.uniform1f(u.uSFar, r.sFar);
      const projScale = r.canvas.height / 2 / Math.tan((cam.fov * Math.PI) / 360);
      const vSpacing = 1 / Math.max(1, Math.sqrt(pb.count / (r.aspect * 4)));
      gl.uniform1f(u.uSize, 0.62 * vSpacing * projScale);
      gl.uniform1f(u.uSweep, inE >= 1 ? 99 : sweep);
      gl.uniform1f(u.uSweepBack, sweepBack);
      const hold = win(t, 0.3, 0.38) * (1 - win(t, 0.64, 0.7));
      const cyc = ((time * 0.55) % 1 + 1) % 1;
      gl.uniform1f(u.uPulse, logS(cyc));
      gl.uniform1f(u.uPulseAmt, hold);
      gl.uniform1f(u.uSec, time);
      gl.uniform1f(u.uStyle, style);
      gl.uniform1f(u.uSky, 0.035);
      gl.uniform2f(u.uTexel, 1.5 / this.r.depthW, 1.5 / this.r.depthH);
      gl.bindVertexArray(pb.vao);
      gl.drawArrays(gl.POINTS, 0, pb.count);
    }
    const cloud = smooth(win(t, 0.05, 0.25)) * (1 - smooth(win(t, 0.78, 0.96)));
    if (cloud > 0.01) this._bloom(0.85 * cloud, 0.02);
    return { ...fx, vignette: (fx.vignette ?? 0.3) + 0.2 * cloud, sat: (fx.sat ?? 1) * (1 - 0.1 * cloud) };
  }

  _drawVanish(look, t, proj, view, blur, duration) {
    const gl = this.gl;
    const r = this.r;
    const t0 = 0.12;
    const t1 = 0.68;
    const front = (t - t0) / (t1 - t0);
    const dissolve = t < t0 ? -1 : front;
    const pixels = look === 'pixels';
    const block = pixels ? 110 : 0;
    const edge = look === 'embers' ? [1.0, 0.55, 0.12] : look === 'ash' ? [1.0, 0.38, 0.06] : [0.55, 0.85, 1.0];
    const revealFront = t < t0 ? -0.2 : front >= 1.02 ? 2 : front;
    this._drawMesh({ layer: 'plate', grid: this.inner, blur, revealFront });
    this._drawMesh({ layer: 'plateBg', grid: this.inner });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this._drawMesh({ layer: 'subject', push: 0.996, dissolve: front >= 1.02 ? 2 : dissolve, edge: pixels ? [edge[0] * 0.5, edge[1] * 0.5, edge[2] * 0.5] : edge, block, blur });
    if (front <= 0 || front > 2.5) return;
    const pb = this._dustPoints(look);
    const { p, u } = this.dust;
    gl.useProgram(p);
    gl.depthMask(false);
    if (look === 'embers') gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.colorTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, r.depthTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.fxTex);
    gl.uniform1i(u.uColor, 0);
    gl.uniform1i(u.uDepth, 1);
    gl.uniform1i(u.uFx, 3);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform1f(u.uAspect, r.aspect);
    gl.uniform1f(u.uD, r.restDistance);
    gl.uniform1f(u.uSNear, r.sNear);
    gl.uniform1f(u.uSFar, r.sFar);
    const dur = duration || 5;
    const sec = t * dur;
    gl.uniform1f(u.uFront, front);
    gl.uniform1f(u.uRate, 1 / ((t1 - t0) * dur));
    gl.uniform1f(u.uLifeA, look === 'pixels' ? 1.6 : 2.4);
    gl.uniform1f(u.uLifeB, (0.97 - t1) * dur * 1.35);
    gl.uniform1f(u.uSec, sec);
    gl.uniform1f(u.uLook, look === 'embers' ? 1 : pixels ? 2 : 0);
    const projScale = r.canvas.height / 2 / Math.tan((REST_FOV * Math.PI) / 360);
    gl.uniform1f(u.uSize, pb.step * projScale * (pixels ? 1.0 : 1.0));
    gl.uniform1f(u.uTurb, look === 'pixels' ? 0.08 : look === 'embers' ? 0.2 : 0.22);
    const k = this.k ?? 1;
    gl.uniform3f(u.uWind, (look === 'pixels' ? 0.24 : 0.3) * k, look === 'embers' ? 0.24 : 0.09, 0.06);
    gl.uniform1f(u.uBlockW, 1 / 110);
    gl.uniform1f(u.uLod, pixels ? Math.log2(Math.max(1, this.prep.H / 110)) : 0);
    gl.bindVertexArray(pb.vao);
    gl.drawArrays(gl.POINTS, 0, pb.count);
    if (look === 'embers') this._bloom(0.55, 0.25);
  }

  /** How far the camera has left its rest pose, 0..1, for revealing the plate. */
  _revealFor(cam, ctx) {
    const d = Math.hypot(cam.eye[0], cam.eye[1], cam.eye[2] - ctx.D);
    return smooth(clamp(d / (0.025 * ctx.D), 0, 1));
  }

  _drawFreeze(t, fx, blur, reveal) {
    const gl = this.gl;
    this._drawMesh({ layer: 'plate', grid: this.ext, blur, reveal });
    this._drawMesh({ layer: 'plateBg', grid: this.ext });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this._drawMesh({ layer: 'subject', push: 0.996, relief: 0.7, blur });
    const tf = 0.25;
    const flash = t < tf - 0.012 ? 0 : t < tf ? (t - (tf - 0.012)) / 0.012 : Math.exp(-(t - tf) * 34);
    const frozen = smooth(win(t, tf, tf + 0.06)) * (1 - smooth(win(t, 0.84, 0.97)));
    return {
      ...fx,
      exposure: (fx.exposure ?? 1) * (1 + 1.5 * flash),
      fade: Math.max(fx.fade ?? 0, 0.22 * flash),
      sat: (fx.sat ?? 1) * (1 - 0.3 * frozen - 0.5 * flash),
      contrast: (fx.contrast ?? 1) * (1 + 0.08 * frozen),
      warm: (fx.warm ?? 0) - 0.25 * frozen,
      vignette: (fx.vignette ?? 0.3) + 0.18 * frozen,
      ca: (fx.ca ?? 0) + 0.6 * frozen,
    };
  }

  _drawClones(look, t, cam, camAt, blur, reveal) {
    const gl = this.gl;
    const r = this.r;
    this._drawMesh({ layer: 'plate', grid: this.ext, blur, reveal });
    this._drawMesh({ layer: 'plateBg', grid: this.ext });
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    const N = 6;
    const lag = 0.07;
    const fadeOut = 1 - smooth(win(t, 0.84, 0.98));
    for (let k = N; k >= 1; k--) {
      const tk = t - k * lag;
      const appear = smooth(win(t, k * lag * 0.6, k * lag * 1.2));
      const a = appear * fadeOut * Math.pow(1 - (k - 1) / N, 1.15);
      if (a < 0.01) continue;
      const { view } = r.viewProj(camAt(Math.max(0, tk)), r.canvas.width / r.canvas.height);
      const o = { layer: 'subject', view, push: 0.996 + 0.0015 * k, blur: 0 }; // echoes skip lens blur: six of them would cost more than the frame
      if (look === 'rainbow') {
        const c = hsv(((k - 1) / (N - 1)) * 0.8, 0.85, 1);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this._drawMesh({ ...o, alpha: 0.85 * a, tint: [c[0], c[1], c[2], 0.6], glow: 1.1, glowColor: c });
      } else if (look === 'ghost') {
        gl.blendFunc(gl.ONE, gl.ONE);
        this._drawMesh({ ...o, alpha: 0.55 * a, tint: [0.55, 0.82, 1.0, 0.85], glow: 0.9, glowColor: [0.35, 0.6, 1.0] });
      } else {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        this._drawMesh({ ...o, alpha: 0.78 * a });
      }
    }
    gl.depthMask(true);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const { view } = r.viewProj(cam, r.canvas.width / r.canvas.height);
    this._drawMesh({ layer: 'subject', view, push: 0.994, blur });
    if (look !== 'natural') this._bloom(look === 'ghost' ? 0.45 : 0.3, 0.72);
  }
}
