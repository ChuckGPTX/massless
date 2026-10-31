// Pure pixel logic for the image tools on the Edit page: tiling, tensors, masks and compositing.
// No DOM here, so the page, the model worker and the Node tests all share the same code.

import { boxBlur, maxFilter } from './depth.js';

const clamp255 = (v) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

/** Longest side the tools work on; bigger images are scaled down first. */
export const WORK_MAX = 4096;
/** Longest input side for upscaling, per factor (the result is factor times bigger). */
export const UPSCALE_MAX = { 2: 1024, 4: 768 };
/** Real-ESRGAN general x4v3 sees 34 pixels around each output pixel (34 stacked 3x3 convolutions). */
export const ESRGAN_REACH = 34;

/** Size that fits inside max on the long side, keeping the aspect ratio. */
export function fitWithin(w, h, max) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scaled: s < 1 };
}

/** Whether an image can be upscaled by factor; message explains the limit when it cannot. */
export function upscaleCheck(w, h, factor) {
  const max = UPSCALE_MAX[factor];
  if (!max) return { ok: false, message: 'Pick 2× or 4×.' };
  if (Math.max(w, h) <= max) return { ok: true, out: { w: w * factor, h: h * factor } };
  return {
    ok: false,
    max,
    message: `${factor}× upscaling takes images up to ${max} px on the long side, so the result stays under ${max * factor} px and fits in memory. This one is ${w} × ${h}. Try ${factor === 4 ? '2×' : 'a smaller image'}, or crop it first.`,
  };
}

// ---------------------------------------------------------------------------------------------
// Tiling: memory stays bounded and the seams are exact
// ---------------------------------------------------------------------------------------------

/**
 * Split w x h into core tiles of at most `core` pixels, each read with `pad` pixels of context on every
 * side (clipped at the image edge). When pad is at least the model's reach, every output pixel sees exactly
 * what it would see in one full-image pass, so the stitched result has no seams.
 * Returns [{ x, y, w, h, sx, sy, sw, sh }]: core rectangle and the source rectangle that is fed to the model.
 */
export function planTiles(w, h, core, pad) {
  if (!(core > 0) || pad < 0) throw new Error('Bad tile size.');
  const tiles = [];
  const nx = Math.ceil(w / core);
  const ny = Math.ceil(h / core);
  // even split, so no sliver tiles at the right and bottom edges
  const cw = Math.ceil(w / nx);
  const ch = Math.ceil(h / ny);
  for (let ty = 0; ty < ny; ty++) {
    for (let tx = 0; tx < nx; tx++) {
      const x = tx * cw;
      const y = ty * ch;
      const tw = Math.min(cw, w - x);
      const th = Math.min(ch, h - y);
      if (tw <= 0 || th <= 0) continue;
      const sx = Math.max(0, x - pad);
      const sy = Math.max(0, y - pad);
      const sw = Math.min(w, x + tw + pad) - sx;
      const sh = Math.min(h, y + th + pad) - sy;
      tiles.push({ x, y, w: tw, h: th, sx, sy, sw, sh });
    }
  }
  return tiles;
}

/** RGB of a source rectangle as a planar float tensor in 0..1 (or normalised with mean and std). */
export function rgbaToCHW(rgba, imgW, rect = null, mean = [0, 0, 0], std = [1, 1, 1]) {
  const r = rect || { sx: 0, sy: 0, sw: imgW, sh: rgba.length / 4 / imgW };
  const n = r.sw * r.sh;
  const out = new Float32Array(3 * n);
  for (let y = 0; y < r.sh; y++) {
    let i = ((r.sy + y) * imgW + r.sx) * 4;
    let k = y * r.sw;
    for (let x = 0; x < r.sw; x++, i += 4, k++) {
      out[k] = (rgba[i] / 255 - mean[0]) / std[0];
      out[n + k] = (rgba[i + 1] / 255 - mean[1]) / std[1];
      out[2 * n + k] = (rgba[i + 2] / 255 - mean[2]) / std[2];
    }
  }
  return out;
}

/**
 * Copy the core of one model output tile (planar RGB floats in 0..1, `scale` times the source rectangle)
 * into the RGB channels of the output image (RGBA, outW wide). Alpha is left alone.
 */
export function stitchTile(out, outW, tileOut, tile, scale) {
  const tw = tile.sw * scale;
  const n = tw * tile.sh * scale;
  const ox = (tile.x - tile.sx) * scale;
  const oy = (tile.y - tile.sy) * scale;
  const cw = tile.w * scale;
  const chh = tile.h * scale;
  for (let y = 0; y < chh; y++) {
    let k = (oy + y) * tw + ox;
    let o = ((tile.y * scale + y) * outW + tile.x * scale) * 4;
    for (let x = 0; x < cw; x++, k++, o += 4) {
      out[o] = clamp255(tileOut[k] * 255);
      out[o + 1] = clamp255(tileOut[n + k] * 255);
      out[o + 2] = clamp255(tileOut[2 * n + k] * 255);
    }
  }
}

/**
 * Upscale RGBA by `scale` with a model that maps a planar RGB rectangle to one `scale` times bigger.
 * runTile(chw, sw, sh) resolves to the planar output. Alpha is scaled bilinearly. onTile(done, total).
 */
export async function upscaleTiled(rgba, w, h, scale, runTile, { core = 192, pad = ESRGAN_REACH, onTile } = {}) {
  const W = w * scale;
  const H = h * scale;
  const out = new Uint8ClampedArray(W * H * 4);
  const alpha = new Uint8Array(w * h);
  let opaque = true;
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = rgba[i * 4 + 3];
    if (alpha[i] !== 255) opaque = false;
  }
  if (opaque) for (let i = 3; i < out.length; i += 4) out[i] = 255;
  else {
    const a = resizeChannel(alpha, w, h, W, H);
    for (let i = 0; i < a.length; i++) out[i * 4 + 3] = a[i];
  }
  const tiles = planTiles(w, h, core, pad);
  for (let t = 0; t < tiles.length; t++) {
    const tile = tiles[t];
    const res = await runTile(rgbaToCHW(rgba, w, tile), tile.sw, tile.sh);
    stitchTile(out, W, res, tile, scale);
    onTile?.(t + 1, tiles.length);
  }
  return { data: out, w: W, h: H };
}

/** Halve an RGBA image with a 2x2 box filter (4x model output -> 2x result). */
export function downsample2x(rgba, w, h) {
  const W = Math.floor(w / 2);
  const H = Math.floor(h / 2);
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = ((2 * y) * w + 2 * x) * 4;
      const b = a + w * 4;
      const o = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = (rgba[a + c] + rgba[a + 4 + c] + rgba[b + c] + rgba[b + 4 + c] + 2) >> 2;
    }
  }
  return { data: out, w: W, h: H };
}

/** Bilinear resize of one channel (pixel centres aligned). Returns a Uint8Array. */
export function resizeChannel(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh);
  const fx = sw / dw;
  const fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = sx - x0;
      const top = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const bot = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * dw + x] = Math.round(top * (1 - ty) + bot * ty);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Background removal
// ---------------------------------------------------------------------------------------------

/** MODNet input size: short side 512, both sides a multiple of 32, aspect kept. */
export function modnetSize(w, h) {
  const s = 512 / Math.min(w, h);
  const r = (v) => Math.max(32, Math.round((v * s) / 32) * 32);
  return { w: r(w), h: r(h) };
}

/** Model output (logits or 0..1 matte) to an 8-bit matte. */
export function toMatte(values, logits) {
  const out = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = logits ? 1 / (1 + Math.exp(-values[i])) : values[i];
    out[i] = clamp255(v * 255);
  }
  return out;
}

/** Soften a matte's edge: radius in pixels (two box passes, close to a Gaussian). 0 returns a copy. */
export function featherAlpha(alpha, w, h, radius) {
  const r = Math.round(radius);
  if (r < 1) return new Uint8Array(alpha);
  return boxBlur(boxBlur(alpha, w, h, Math.max(1, r >> 1)), w, h, Math.max(1, r - (r >> 1)));
}

/**
 * Put the foreground (RGBA, its own alpha multiplied by the matte) over a background.
 * bg: RGBA of the same size, or null for a transparent result (colour kept, alpha = matte).
 */
export function compositeOver(fg, matte, bg, out = new Uint8ClampedArray(fg.length)) {
  for (let i = 0, p = 0; i < matte.length; i++, p += 4) {
    const a = (matte[i] * fg[p + 3]) / 65025; // 0..1
    if (!bg) {
      out[p] = fg[p];
      out[p + 1] = fg[p + 1];
      out[p + 2] = fg[p + 2];
      out[p + 3] = clamp255(a * 255);
      continue;
    }
    const ba = bg[p + 3] / 255;
    const oa = a + ba * (1 - a);
    if (oa <= 0) {
      out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
      continue;
    }
    for (let c = 0; c < 3; c++) out[p + c] = clamp255((fg[p + c] * a + bg[p + c] * ba * (1 - a)) / oa);
    out[p + 3] = clamp255(oa * 255);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Erase: masks
// ---------------------------------------------------------------------------------------------

/** Brush strokes (RGBA of the mask layer) to a 0/1 hole, grown by `grow` pixels to cover edge colour. */
export function holeFromStrokes(strokeRGBA, w, h, grow = 0) {
  const hole = new Uint8Array(w * h);
  let any = false;
  for (let i = 0; i < hole.length; i++) {
    if (strokeRGBA[i * 4 + 3] > 24) {
      hole[i] = 1;
      any = true;
    }
  }
  if (!any) return null;
  return grow > 0 ? maxFilter(hole, w, h, grow) : hole;
}

/** Bounding box of a 0/1 mask: { x0, y0, x1, y1 } (inclusive), or null when empty. */
export function maskBox(mask, w, h) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Rectangle around a box with `margin` (fraction of the box size, at least minPad px), clipped to the image. */
export function contextRect(box, w, h, margin = 0.75, minPad = 32) {
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const px = Math.max(minPad, Math.round(bw * margin));
  const py = Math.max(minPad, Math.round(bh * margin));
  const x = Math.max(0, box.x0 - px);
  const y = Math.max(0, box.y0 - py);
  return { x, y, w: Math.min(w, box.x1 + px + 1) - x, h: Math.min(h, box.y1 + py + 1) - y };
}

/** MI-GAN pipeline inputs: uint8 planar RGB and a uint8 mask where 255 is kept and 0 is filled. */
export function miganInputs(rgba, hole, w, h) {
  const n = w * h;
  const image = new Uint8Array(3 * n);
  const mask = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    image[i] = rgba[p];
    image[n + i] = rgba[p + 1];
    image[2 * n + i] = rgba[p + 2];
    mask[i] = hole[i] ? 0 : 255;
  }
  return { image, mask };
}

/** Planar uint8 RGB result back into RGBA: only hole pixels change, alpha is kept. */
export function applyFill(rgba, planar, hole, w, h) {
  const n = w * h;
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (!hole[i]) continue;
    out[p] = planar[i];
    out[p + 1] = planar[n + i];
    out[p + 2] = planar[2 * n + i];
  }
  return out;
}

/** Copy a rectangle out of an RGBA image. */
export function cropRGBA(rgba, w, r) {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) out.set(rgba.subarray(((r.y + y) * w + r.x) * 4, ((r.y + y) * w + r.x + r.w) * 4), y * r.w * 4);
  return out;
}

/** Copy one channel's rectangle. */
export function cropChannel(src, w, r) {
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) out.set(src.subarray((r.y + y) * w + r.x, (r.y + y) * w + r.x + r.w), y * r.w);
  return out;
}

/** Bilinear resize of RGBA (each channel through resizeChannel). */
export function resizeRGBA(rgba, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const ch = new Uint8Array(sw * sh);
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < ch.length; i++) ch[i] = rgba[i * 4 + c];
    const r = resizeChannel(ch, sw, sh, dw, dh);
    for (let i = 0; i < r.length; i++) out[i * 4 + c] = r[i];
  }
  return out;
}

/** Write the hole pixels of a filled crop back into the full image (alpha kept). */
export function pasteHole(rgba, w, crop, rect, holeCrop) {
  const out = new Uint8ClampedArray(rgba);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const k = y * rect.w + x;
      if (!holeCrop[k]) continue;
      const o = ((rect.y + y) * w + rect.x + x) * 4;
      out[o] = crop[k * 4];
      out[o + 1] = crop[k * 4 + 1];
      out[o + 2] = crop[k * 4 + 2];
    }
  }
  return out;
}
