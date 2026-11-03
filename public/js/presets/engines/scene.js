// Product scenes: the cut-out stands on a photographed plate with a contact shadow, a cast shadow, an optional
// mirror reflection, light and colour matched to the spot, and the brand name set in the open space above.
import { loadImage, meanColor, gradeCutout, drawShadows, drawReflection, setFont, fitText, FONT, clamp, rgbCss, hexRgb, luma } from '../common.js';

export const kind = 'image';
export const drag = true;

export async function prepare(spec, io) {
  const s = spec.scene;
  const [p, l, cut] = await Promise.all([loadImage(`/presets/plates/${s.id}-p.webp`), loadImage(`/presets/plates/${s.id}-l.webp`), io.cutout('product')]);
  const graded = {};
  for (const [o, img] of [['p', p], ['l', l]]) {
    const m = s[o];
    const W = img.width, H = img.height;
    const amb = meanColor(img, (m.a[0] - m.box[0]) * W, (m.a[1] - m.box[1] * 1.1) * H, m.box[0] * 2 * W, m.box[1] * 1.4 * H);
    graded[o] = gradeCutout(cut.cut, amb, { strength: 0.32, light: { x: Math.cos(m.dir) >= 0 ? -1 : 1, amount: m.cast > 0.25 ? 1 : 0.5 } });
  }
  return { s, plates: { p, l }, graded, cut: cut.cut, hit: null };
}

/** Where the plate goes in a w x h frame so the product's spot sits nicely. */
function place(img, m, w, h) {
  const k = Math.max(w / img.width, h / img.height);
  const dw = img.width * k, dh = img.height * k;
  const ox = clamp(w / 2 - m.a[0] * dw, w - dw, 0);
  // keep the product's base around 70% down a tall frame, a little higher in a wide one
  const want = h / w > 1.5 ? m.a[1] * h : h * (w > h ? 0.68 : 0.72);
  const oy = clamp(want - m.a[1] * dh, h - dh, 0);
  return { k, dw, dh, ox, oy };
}

export function render(ctx, c, { w, h, params }) {
  const g = c.getContext('2d');
  const o = w / h > 1.25 ? 'l' : 'p';
  const img = ctx.plates[o], m = ctx.s[o], prod = ctx.graded[o];
  const P = place(img, m, w, h);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, P.ox, P.oy, P.dw, P.dh);
  // product size: fit inside the spot's box, scaled by the size slider
  const size = params.size ?? 1;
  const bw = m.box[0] * P.dw * size, bh = m.box[1] * P.dh * size;
  const ar = prod.width / prod.height;
  let pw = bw, ph = bw / ar;
  if (ph > bh) { ph = bh; pw = bh * ar; }
  // the cut-out has a 2 px pad; drop the base a hair so it sits into the surface
  const bx = P.ox + m.a[0] * P.dw + (params.dx || 0) * w;
  const by = P.oy + m.a[1] * P.dh + (params.dy || 0) * h + ph * 0.006;
  if (params._matte) {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.filter = 'brightness(0) invert(1)';
    g.drawImage(prod, bx - pw / 2, by - ph, pw, ph);
    g.filter = 'none';
    return;
  }
  if (m.reflect) drawReflection(g, prod, bx, by, pw, ph, { opacity: m.reflect, fade: 0.5, blur: Math.max(0.5, pw / 260) });
  const dark = luma(meanColor(img, bx - pw, by - ph * 0.1, pw * 2, ph * 0.3)) < 0.25;
  drawShadows(g, prod, bx, by, pw, ph, { cast: m.cast, contact: dark ? 0.9 : 0.75, pool: dark ? 0.5 : 0.36, dir: m.dir, length: m.length, color: dark ? [0, 0, 0] : [36, 26, 18] });
  g.drawImage(prod, bx - pw / 2, by - ph, pw, ph);
  // a touch of occlusion where it meets the floor
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.restore();
  ctx.hit = { x0: (bx - pw / 2) / w, x1: (bx + pw / 2) / w, y0: (by - ph) / h, y1: by / h };
  drawText(g, ctx.s, params, w, h, by - ph);
}

function drawText(g, s, params, w, h, productTop) {
  const brand = String(params.brand || '').trim(), line = String(params.tagline || '').trim();
  if (!brand && !line) return;
  const f = FONT[s.font] || FONT.serif;
  const wide = w / h > 1.25;
  const margin = Math.round(Math.min(w, h) * 0.07);
  const top = margin;
  const room = Math.max(h * 0.12, productTop - top - h * 0.04);
  const maxW = wide ? w * 0.6 : w - margin * 2;
  const ink = s.ink;
  const light = luma(hexRgb(ink)) > 0.6;
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'top';
  g.shadowColor = light ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.25)';
  g.shadowBlur = Math.round(h * 0.012);
  g.fillStyle = ink;
  let y = top;
  if (brand) {
    const caps = f === FONT.display || f === FONT.bold || f === FONT.round;
    const t = caps ? brand.toUpperCase() : brand;
    const fit = fitText(g, t, f, maxW, Math.min(room * 0.7, h * (wide ? 0.16 : 0.12)), { max: h * (wide ? 0.13 : 0.085), lines: 2, lh: 1.02, tracking: caps ? 0.02 : -0.01 });
    for (const ln of fit.lines) { g.fillText(ln, w / 2, y); y += fit.size * 1.02; }
    y += fit.size * 0.22;
  }
  if (line) {
    const sf = FONT.sans;
    const fit = fitText(g, line, sf, maxW * 0.9, h * 0.05, { max: Math.min(h * (wide ? 0.042 : 0.026), w * 0.04), lines: 2, lh: 1.25, tracking: 0.04 });
    g.globalAlpha = 0.86;
    for (const ln of fit.lines) { g.fillText(ln, w / 2, y); y += fit.size * 1.25; }
  }
  g.restore();
}
export const _test = { place, rgbCss };
