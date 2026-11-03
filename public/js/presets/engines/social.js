// Social, story and thumbnail templates: twelve layouts that reflow for square, portrait, story and 16:9, and a
// kinetic version (staggered entrances, a slow push on the photo) for the animated story.
import { cover, setFont, fitText, FONT, clamp, ease, span, hexRgb, luma, rgbCss } from '../common.js';

export const kind = 'image';
export const animated = true;

export async function prepare(spec, io) {
  const [img, img2] = await Promise.all([io.image('image'), spec.inputs.some((i) => i.key === 'image2') ? io.image('image2') : null]);
  return { layout: spec.layout, img, img2 };
}

const ORDER = { img: [0, 0.7], deco: [0.15, 0.85], h: [0.35, 1.05], sub: [0.65, 1.3], cta: [0.95, 1.6], extra: [1.2, 1.9] };
export function render(ctx, c, { w, h, t, params }) {
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.shadowBlur = 0; g.shadowColor = 'transparent';
  const u = Math.min(w, h) / 1080;
  const A = (name) => (t == null ? 1 : ease.out(span(t, ...ORDER[name])));
  const zoom = t == null ? 1.0 : 1.08 - 0.08 * ease.inOut(clamp(t / 6));
  const color = /^#[0-9a-f]{6}$/i.test(params.color || '') ? params.color : '#ffc127';
  const ink = luma(hexRgb(color)) > 0.55 ? '#141414' : '#ffffff';
  const S = { g, w, h, u, A, zoom, color, ink, p: params, ctx, t, wide: w / h > 1.3, tall: h / w > 1.5, sq: Math.abs(w / h - 1) < 0.05 };
  (LAYOUTS[ctx.layout] || LAYOUTS.launch)(S);
}

// ---------- helpers ----------
function enter(S, name, fn, { dy = 34, scale = 0 } = {}) {
  const p = S.A(name);
  if (p <= 0.001) return;
  const { g } = S;
  g.save();
  g.globalAlpha *= p;
  g.translate(0, (1 - p) * dy * S.u);
  if (scale) { const k = 1 - scale * (1 - p); g.translate(S.w / 2, S.h / 2); g.scale(k, k); g.translate(-S.w / 2, -S.h / 2); }
  fn();
  g.restore();
}
function photo(S, img, x, y, w, h, { r = 0, fx = 0.5, fy = 0.5, filter = '' } = {}) {
  const { g } = S;
  if (!img) { g.fillStyle = '#2a2a2f'; g.fillRect(x, y, w, h); return; }
  g.save();
  g.beginPath();
  if (r) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
  g.clip();
  if (filter) g.filter = filter;
  cover(g, img, x, y, w, h, { zoom: S.zoom, fx, fy });
  g.restore();
}
function text(S, str, f, x, y, maxW, maxH, { max = 200, lines = 3, lh = 1.0, color = S.ink, align = 'left', caps = false, tracking = 0, italic = false, stroke = 0, strokeColor = '#000', baseline = 'top' } = {}) {
  const { g } = S;
  const s = caps ? String(str).toUpperCase() : String(str);
  if (!s.trim()) return { h: 0, size: 0, lines: [] };
  const fit = fitText(g, s, f, maxW, maxH, { max: max * S.u, lines, lh, tracking, italic });
  g.textAlign = align;
  g.textBaseline = 'top';
  const ax = align === 'center' ? x + maxW / 2 : align === 'right' ? x + maxW : x;
  let yy = baseline === 'bottom' ? y - fit.lines.length * fit.size * lh : y;
  const top = yy;
  for (const ln of fit.lines) {
    if (stroke) { g.lineJoin = 'round'; g.lineWidth = stroke * fit.size; g.strokeStyle = strokeColor; g.strokeText(ln, ax, yy); }
    g.fillStyle = color;
    g.fillText(ln, ax, yy);
    yy += fit.size * lh;
  }
  return { h: yy - top, size: fit.size, lines: fit.lines, top };
}
function pill(S, str, x, y, { bg = S.color, fg = S.ink, size = 30, align = 'left', f = FONT.grotesk } = {}) {
  const { g, u } = S;
  if (!String(str).trim()) return 0;
  setFont(g, f, size * u, { tracking: 0.06 });
  const tw = g.measureText(String(str).toUpperCase()).width;
  const pw = tw + size * u * 1.3, ph = size * u * 1.9;
  const px = align === 'right' ? x - pw : align === 'center' ? x - pw / 2 : x;
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(px, y, pw, ph, ph / 2); g.fill();
  g.fillStyle = fg; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(String(str).toUpperCase(), px + size * u * 0.65, y + ph / 2 + size * u * 0.04);
  g.textBaseline = 'top';
  return pw;
}
function shade(S, y0, y1, a = 0.75) {
  const { g, w } = S;
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, `rgba(0,0,0,${a})`);
  g.fillStyle = gr;
  g.fillRect(0, y0, w, y1 - y0);
}
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const M = (S) => Math.round(Math.min(S.w, S.h) * 0.075);

// ---------- the twelve layouts ----------
const LAYOUTS = {
  launch(S) {
    const { g, w, h, u, p } = S, m = M(S);
    if (S.wide) {
      g.fillStyle = S.color; g.fillRect(0, 0, w, h);
      enter(S, 'img', () => photo(S, S.ctx.img, w * 0.46, 0, w * 0.54, h), { dy: 0 });
      enter(S, 'deco', () => pill(S, 'NEW', m, m, { bg: S.ink, fg: S.color, size: 24 }));
      enter(S, 'h', () => text(S, p.headline, FONT.bold, m, h * 0.3, w * 0.4 - m, h * 0.36, { max: 150, lines: 2, caps: true, lh: 0.95 }));
      enter(S, 'sub', () => text(S, p.sub, FONT.sans, m, h * 0.68, w * 0.38 - m, h * 0.1, { max: 34, lines: 2, lh: 1.2 }));
      enter(S, 'cta', () => pill(S, p.cta, m, h - m - 56 * u, { bg: S.ink, fg: S.color, size: 26 }));
      return;
    }
    enter(S, 'img', () => photo(S, S.ctx.img, 0, 0, w, h), { dy: 0 });
    shade(S, h * 0.42, h, 0.78);
    enter(S, 'deco', () => pill(S, 'NEW DROP', m, m, { size: 28 }));
    const hy = h - m - (S.tall ? h * 0.27 : h * 0.34);
    enter(S, 'h', () => text(S, p.headline, FONT.bold, m, hy, w - m * 2, h * 0.17, { max: 190, lines: 2, caps: true, color: '#fff', lh: 0.92 }));
    enter(S, 'sub', () => text(S, p.sub, FONT.sans, m, hy + h * (S.tall ? 0.13 : 0.18), w - m * 2, h * 0.08, { max: 42, lines: 2, color: '#fff', lh: 1.2 }));
    enter(S, 'cta', () => pill(S, p.cta, m, h - m - 60 * u, { size: 30 }));
  },
  sale(S) {
    const { g, w, h, u, p } = S, m = M(S);
    g.fillStyle = S.color; g.fillRect(0, 0, w, h);
    const imgBox = S.wide ? [w * 0.5, m, w * 0.5 - m, h - m * 2] : [m, h * (S.tall ? 0.36 : 0.4), w - m * 2, h * (S.tall ? 0.42 : 0.42)];
    enter(S, 'img', () => photo(S, S.ctx.img, ...imgBox, { r: 28 * u }), { scale: 0.06 });
    const tw = S.wide ? w * 0.46 - m : w - m * 2;
    enter(S, 'h', () => text(S, p.headline, FONT.bold, m, S.wide ? h * 0.18 : m * 1.1, tw, S.wide ? h * 0.42 : h * (S.tall ? 0.2 : 0.26), { max: 330, lines: 2, caps: true, lh: 0.9 }), { scale: 0.15 });
    enter(S, 'sub', () => text(S, p.sub, FONT.grotesk, m, S.wide ? h * 0.66 : imgBox[1] + imgBox[3] + m * 0.6, tw, h * 0.08, { max: 44, lines: 2, lh: 1.15 }));
    // a rotating sticker with the call to action
    enter(S, 'cta', () => {
      if (!String(p.cta).trim()) return;
      const r = (S.wide ? 120 : 150) * u;
      const cx = S.wide ? w * 0.5 + r * 0.4 : w - m - r * 0.6, cy = S.wide ? h - m - r * 0.4 : imgBox[1] + r * 0.1;
      g.save(); g.translate(cx, cy); g.rotate(-0.22 + (S.t == null ? 0 : Math.sin(S.t * 1.6) * 0.06));
      g.fillStyle = S.ink; g.beginPath();
      for (let i = 0; i < 28; i++) { const a = (i / 28) * Math.PI * 2, rr = i % 2 ? r : r * 0.9; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath(); g.fill();
      g.translate(-r * 0.78, -r * 0.4);
      text(S, p.cta, FONT.bold, 0, 0, r * 1.56, r * 0.8, { max: 60, lines: 2, color: S.color, align: 'center', caps: true, lh: 1.0 });
      g.restore();
    }, { scale: 0.3 });
  },
  quote(S) {
    const { g, w, h, u, p } = S, m = M(S);
    enter(S, 'img', () => photo(S, S.ctx.img, 0, 0, w, h, { filter: 'brightness(0.55) saturate(0.9)' }), { dy: 0 });
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, w, h);
    enter(S, 'deco', () => { setFont(g, FONT.serif, (S.wide ? 260 : 330) * u); g.fillStyle = S.color; g.textBaseline = 'top'; g.textAlign = 'left'; g.fillText('“', m * 0.8, m * (S.wide ? 0.2 : 0.6)); });
    const top = S.wide ? h * 0.28 : h * (S.tall ? 0.3 : 0.27);
    let qh = 0;
    enter(S, 'h', () => { qh = text(S, p.headline, FONT.serif, m, top, w - m * 2, h * (S.wide ? 0.48 : 0.46), { max: 120, lines: 6, lh: 1.08, color: '#fff' }).h; });
    enter(S, 'sub', () => { g.fillStyle = S.color; g.fillRect(m, h - m - 74 * u, 60 * u, 4 * u); text(S, p.sub, FONT.grotesk, m, h - m - 52 * u, w - m * 2, 40 * u, { max: 30, lines: 1, color: '#fff', caps: true, tracking: 0.12 }); });
    void qh;
  },
  review(S) {
    const { g, w, h, u, p } = S, m = M(S);
    g.fillStyle = S.color; g.fillRect(0, 0, w, h);
    const ink = S.ink;
    const side = S.wide;
    const imgS = side ? h - m * 2 : Math.min(w, h) * (S.tall ? 0.42 : 0.3);
    enter(S, 'img', () => photo(S, S.ctx.img, side ? w - m - imgS * 0.8 : w - m - imgS, side ? m : h - m - imgS, side ? imgS * 0.8 : imgS, imgS, { r: 24 * u }), { scale: 0.05 });
    enter(S, 'deco', () => {
      const s = (side ? 46 : 58) * u;
      for (let i = 0; i < 5; i++) star(g, m + s * 0.55 + i * s * 1.25, m + s * 0.55, s * 0.55, ink);
    });
    const tw = side ? w * 0.56 - m : w - m * 2;
    enter(S, 'h', () => text(S, `“${String(p.headline).replace(/^[“"]|[”"]$/g, '')}”`, FONT.serif, m, m + 110 * u, tw, h * (S.tall ? 0.4 : side ? 0.5 : 0.36), { max: 96, lines: 6, lh: 1.1, color: ink }));
    enter(S, 'sub', () => text(S, '— ' + p.sub, FONT.sans, m, side ? h - m - 90 * u : h - m - (S.tall ? imgS + 60 * u : 150 * u), tw * (side ? 1 : 0.6), 50 * u, { max: 32, lines: 1, color: ink }));
    enter(S, 'cta', () => text(S, p.cta, FONT.grotesk, m, side ? h - m - 44 * u : h - m - (S.tall ? imgS + 16 * u : 96 * u), tw * 0.6, 40 * u, { max: 26, lines: 1, color: ink, caps: true, tracking: 0.12 }));
  },
  event(S) {
    const { g, w, h, u, p } = S, m = M(S);
    g.fillStyle = S.color; g.fillRect(0, 0, w, h);
    const split = S.wide ? 0.5 : S.tall ? 0.56 : 0.5;
    if (S.wide) enter(S, 'img', () => photo(S, S.ctx.img, w * split, 0, w * (1 - split), h), { dy: 0 });
    else enter(S, 'img', () => photo(S, S.ctx.img, 0, 0, w, h * split), { dy: 0 });
    const x0 = m, y0 = S.wide ? m : h * split + m * 0.7, tw = (S.wide ? w * split : w) - m * 2;
    enter(S, 'cta', () => text(S, p.cta, FONT.display, x0, y0, tw, (S.wide ? h * 0.3 : h * 0.13), { max: 200, lines: 1, caps: true, lh: 0.9 }));
    enter(S, 'h', () => text(S, p.headline, FONT.bold, x0, y0 + (S.wide ? h * 0.36 : h * 0.15), tw, S.wide ? h * 0.32 : h * (S.tall ? 0.13 : 0.16), { max: 110, lines: 3, lh: 1.0, caps: true }));
    enter(S, 'sub', () => { g.fillStyle = S.ink; g.fillRect(x0, h - m - 64 * u, tw, 3 * u); text(S, p.sub, FONT.grotesk, x0, h - m - 46 * u, tw, 46 * u, { max: 34, lines: 1 }); });
  },
  tips(S) {
    const { g, w, h, u, p } = S, m = M(S);
    g.fillStyle = S.color; g.fillRect(0, 0, w, h);
    const items = lines(p.sub).slice(0, 5);
    const imgW = S.wide ? w * 0.36 : w * 0.34;
    enter(S, 'img', () => photo(S, S.ctx.img, w - m - imgW, m, imgW, S.wide ? h - m * 2 : imgW, { r: 26 * u }), { scale: 0.08 });
    const tw = S.wide ? w - imgW - m * 3 : w - imgW - m * 3;
    enter(S, 'h', () => text(S, p.headline, FONT.bold, m, m, tw, S.wide ? h * 0.3 : imgW, { max: 120, lines: 3, lh: 0.98, caps: true }));
    const top = S.wide ? h * 0.42 : m + imgW + m * 0.8, bottom = h - m - 70 * u;
    const rowH = Math.min((bottom - top) / Math.max(1, items.length), 200 * u);
    items.forEach((it, i) => {
      const y = top + i * rowH;
      const pseudo = { ...S, A: (n) => (S.t == null ? 1 : ease.out(span(S.t, 0.7 + i * 0.25, 1.3 + i * 0.25))) };
      enter(pseudo, 'sub', () => {
        g.strokeStyle = S.ink; g.globalAlpha *= 0.35; g.lineWidth = 2 * u; g.beginPath(); g.moveTo(m, y); g.lineTo(S.wide ? m + tw : w - m, y); g.stroke(); g.globalAlpha /= 0.35;
        text(S, String(i + 1).padStart(2, '0'), FONT.mono, m, y + rowH * 0.18, 90 * u, rowH * 0.6, { max: 40, lines: 1 });
        text(S, it, FONT.grotesk, m + 100 * u, y + rowH * 0.14, (S.wide ? tw : w - m * 2) - 100 * u, rowH * 0.72, { max: 54, lines: 2, lh: 1.1 });
      });
    });
    enter(S, 'cta', () => text(S, p.cta, FONT.mono, m, h - m - 40 * u, w - m * 2, 40 * u, { max: 28, lines: 1 }));
  },
  'before-after'(S) {
    const { g, w, h, u, p } = S, m = M(S);
    const vertical = !S.wide && !S.sq;
    const prog = S.t == null ? 1 : ease.inOut(span(S.t, 0.6, 2.2));
    const a = S.ctx.img, b = S.ctx.img2 || S.ctx.img;
    if (vertical) {
      photo(S, a, 0, 0, w, h / 2);
      g.save(); g.beginPath(); g.rect(0, h / 2, w * prog, h / 2); g.clip(); photo(S, b, 0, h / 2, w, h / 2); g.restore();
      if (prog < 1) { g.fillStyle = '#111'; g.fillRect(w * prog, h / 2, w * (1 - prog), h / 2); }
    } else {
      photo(S, a, 0, 0, w / 2, h);
      g.save(); g.beginPath(); g.rect(w / 2, 0, (w / 2) * prog, h); g.clip(); photo(S, b, w / 2, 0, w / 2, h); g.restore();
      if (prog < 1) { g.fillStyle = '#111'; g.fillRect(w / 2 + (w / 2) * prog, 0, (w / 2) * (1 - prog), h); }
    }
    g.fillStyle = S.color;
    if (vertical) g.fillRect(0, h / 2 - 4 * u, w, 8 * u); else g.fillRect(w / 2 - 4 * u, 0, 8 * u, h);
    enter(S, 'deco', () => { pill(S, 'BEFORE', m, m, { size: 26, bg: '#111', fg: '#fff' }); pill(S, 'AFTER', vertical ? m : w / 2 + m, vertical ? h / 2 + m : m, { size: 26 }); });
    enter(S, 'h', () => {
      const bw = Math.min(w * 0.8, 760 * u), bh = 120 * u;
      g.fillStyle = S.color; g.beginPath(); g.roundRect((w - bw) / 2, h / 2 - bh / 2, bw, bh, 16 * u); g.fill();
      text(S, p.headline, FONT.bold, (w - bw) / 2 + 20 * u, h / 2 - bh / 2 + 18 * u, bw - 40 * u, bh - 36 * u, { max: 80, lines: 1, align: 'center', caps: true });
    }, { scale: 0.2 });
    enter(S, 'sub', () => { shade(S, h * 0.78, h, 0.6); text(S, p.sub, FONT.sans, m, h - m - 50 * u, w - m * 2, 50 * u, { max: 36, lines: 1, color: '#fff', align: 'center' }); });
  },
  countdown(S) {
    const { g, w, h, u, p } = S, m = M(S);
    enter(S, 'img', () => photo(S, S.ctx.img, 0, 0, w, h, { filter: 'brightness(0.62)' }), { dy: 0 });
    shade(S, h * 0.3, h, 0.55);
    enter(S, 'h', () => text(S, p.headline, FONT.grotesk, m, S.wide ? h * 0.18 : h * 0.22, w - m * 2, 80 * u, { max: 54, lines: 1, color: '#fff', caps: true, tracking: 0.3, align: 'center' }));
    enter(S, 'cta', () => {
      const pulse = S.t == null ? 1 : 1 + 0.03 * Math.sin(S.t * 5);
      g.save(); g.translate(w / 2, h * 0.5); g.scale(pulse, pulse); g.translate(-w / 2, -h * 0.5);
      text(S, p.cta, FONT.display, m, S.wide ? h * 0.3 : h * 0.34, w - m * 2, S.wide ? h * 0.42 : h * 0.3, { max: 420, lines: 1, color: S.color, caps: true, align: 'center', lh: 0.9 });
      g.restore();
    }, { scale: 0.25 });
    enter(S, 'sub', () => text(S, p.sub, FONT.luxe, m, S.wide ? h * 0.78 : h * 0.72, w - m * 2, 90 * u, { max: 70, lines: 1, color: '#fff', align: 'center', italic: true }));
  },
  stat(S) {
    const { g, w, h, u, p } = S, m = M(S);
    g.fillStyle = S.color; g.fillRect(0, 0, w, h);
    const imgH = S.wide ? h - m * 2 : h * (S.tall ? 0.36 : 0.32);
    const imgW = S.wide ? w * 0.38 : w - m * 2;
    enter(S, 'img', () => photo(S, S.ctx.img, S.wide ? w - m - imgW : m, S.wide ? m : h - m - imgH, imgW, imgH, { r: 28 * u }), { scale: 0.05 });
    const tw = S.wide ? w - imgW - m * 3 : w - m * 2;
    enter(S, 'cta', () => text(S, p.cta, FONT.mono, m, m, tw, 40 * u, { max: 30, lines: 1, caps: true }));
    const hy = S.wide ? h * 0.2 : m + 70 * u, hh = S.wide ? h * 0.45 : h * (S.tall ? 0.24 : 0.3);
    // measure first so the caption sits right under the number
    setFont(g, FONT.round, 100);
    const used = Math.min(hh, (tw / Math.max(1, g.measureText(String(p.headline)).width)) * 100 * 0.95, 460 * u * 0.95);
    enter(S, 'h', () => text(S, p.headline, FONT.round, m, hy, tw, hh, { max: 460, lines: 1, lh: 0.95 }), { scale: 0.2 });
    enter(S, 'sub', () => text(S, p.sub, FONT.grotesk, m, S.wide ? h * 0.68 : hy + used + 30 * u, tw, 110 * u, { max: 54, lines: 2, lh: 1.1 }));
  },
  thumbnail(S) {
    const { g, w, h, u, p } = S, m = M(S);
    enter(S, 'img', () => photo(S, S.ctx.img, 0, 0, w, h, { filter: 'saturate(1.25) contrast(1.08)' }), { dy: 0 });
    const gr = g.createLinearGradient(0, 0, S.wide ? w * 0.75 : 0, S.wide ? 0 : h);
    gr.addColorStop(0, 'rgba(0,0,0,0.72)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const tw = S.wide ? w * 0.58 : w - m * 2;
    let res = null;
    enter(S, 'h', () => { res = text(S, p.headline, FONT.bold, m, S.wide ? h * 0.2 : h * 0.12, tw, S.wide ? h * 0.62 : h * 0.4, { max: 170, lines: 3, lh: 0.98, caps: true, color: '#fff', stroke: 0.12, strokeColor: '#000' }); }, { scale: 0.12 });
    enter(S, 'deco', () => {
      // a highlight bar under the title and an arrow pointing in
      const y = (res?.top ?? h * 0.2) + (res?.h ?? h * 0.4) + 14 * u;
      g.fillStyle = S.color; g.fillRect(m, y, Math.min(tw, 380 * u), 16 * u);
      const ax = S.wide ? w * 0.68 : w * 0.7, ay = S.wide ? h * 0.58 : h * 0.62, s = 120 * u;
      g.save(); g.translate(ax, ay); g.rotate(0.35);
      g.fillStyle = S.color; g.strokeStyle = '#000'; g.lineWidth = 8 * u;
      g.beginPath(); g.moveTo(-s, -s * 0.18); g.lineTo(s * 0.3, -s * 0.18); g.lineTo(s * 0.3, -s * 0.5); g.lineTo(s, 0); g.lineTo(s * 0.3, s * 0.5); g.lineTo(s * 0.3, s * 0.18); g.lineTo(-s, s * 0.18); g.closePath();
      g.stroke(); g.fill(); g.restore();
    });
    enter(S, 'cta', () => pill(S, p.cta, w - m, m, { align: 'right', size: 34, bg: S.color, f: FONT.bold }), { scale: 0.4 });
  },
  podcast(S) {
    const { g, w, h, u, p } = S, m = M(S);
    g.fillStyle = '#121216'; g.fillRect(0, 0, w, h);
    const glow = g.createRadialGradient(w * 0.2, h * 0.1, 0, w * 0.2, h * 0.1, Math.max(w, h));
    glow.addColorStop(0, rgbCss(hexRgb(S.color), 0.45)); glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    const sz = S.wide ? h - m * 2 : Math.min(w - m * 2, h * (S.tall ? 0.4 : 0.42));
    enter(S, 'img', () => photo(S, S.ctx.img, S.wide ? m : (w - sz) / 2, m * (S.tall ? 2 : 1), sz, sz, { r: 30 * u }), { scale: 0.06 });
    const x0 = S.wide ? m * 2 + sz : m, tw = S.wide ? w - x0 - m : w - m * 2, y0 = S.wide ? m * 1.2 : m * (S.tall ? 2 : 1) + sz + m * 0.7;
    const [ep, rest] = String(p.sub).split('·').map((x) => x.trim());
    enter(S, 'sub', () => text(S, ep || p.sub, FONT.mono, x0, y0, tw, 40 * u, { max: 30, lines: 1, color: S.color, caps: true, tracking: 0.1 }));
    enter(S, 'h', () => text(S, p.headline, FONT.bric, x0, y0 + 56 * u, tw, S.wide ? h * 0.34 : h * (S.tall ? 0.16 : 0.15), { max: 120, lines: 2, color: '#fff', lh: 1.0 }));
    if (rest) enter(S, 'extra', () => text(S, rest, FONT.sans, x0, y0 + 56 * u + (S.wide ? h * 0.36 : h * (S.tall ? 0.17 : 0.16)), tw, 50 * u, { max: 32, lines: 1, color: '#c9c9cf' }));
    // waveform
    enter(S, 'deco', () => {
      const bars = 42, by = h - m - 110 * u, bh = 70 * u, bw = tw / bars;
      for (let i = 0; i < bars; i++) {
        const ph = S.t == null ? 0 : S.t * 6;
        const v = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.7 + ph) * Math.sin(i * 0.23 + 1.3 + ph * 0.4));
        g.fillStyle = i < bars * 0.35 ? S.color : 'rgba(255,255,255,0.35)';
        g.beginPath(); g.roundRect(x0 + i * bw + bw * 0.2, by + (bh - bh * v) / 2, bw * 0.6, bh * v, bw * 0.3); g.fill();
      }
    });
    enter(S, 'cta', () => {
      const r = 30 * u, cx = x0 + r, cy = h - m - r;
      g.fillStyle = S.color; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = S.ink; g.beginPath(); g.moveTo(cx - r * 0.3, cy - r * 0.42); g.lineTo(cx + r * 0.5, cy); g.lineTo(cx - r * 0.3, cy + r * 0.42); g.closePath(); g.fill();
      text(S, p.cta, FONT.grotesk, cx + r * 1.6, cy - 18 * u, tw - r * 3, 40 * u, { max: 30, lines: 1, color: '#fff' });
    });
  },
  'price-list'(S) {
    const { g, w, h, u, p } = S, m = M(S);
    g.fillStyle = S.color; g.fillRect(0, 0, w, h);
    const split = S.wide ? 0.45 : S.tall ? 0.42 : 0.4;
    if (S.wide) enter(S, 'img', () => photo(S, S.ctx.img, 0, 0, w * split, h), { dy: 0 });
    else enter(S, 'img', () => photo(S, S.ctx.img, 0, 0, w, h * split), { dy: 0 });
    const x0 = S.wide ? w * split + m : m, y0 = S.wide ? m : h * split + m * 0.7, tw = (S.wide ? w * (1 - split) : w) - m * 2;
    enter(S, 'h', () => text(S, p.headline, FONT.luxe, x0, y0, tw, S.wide ? h * 0.2 : h * 0.1, { max: 120, lines: 1, italic: true }));
    const items = lines(p.sub).slice(0, 6);
    const top = y0 + (S.wide ? h * 0.26 : h * 0.13), bottom = h - m - 70 * u;
    const rowH = Math.min((bottom - top) / Math.max(1, items.length), 120 * u);
    items.forEach((it, i) => {
      const [name, price = ''] = it.split(/\s*[·\-–|]\s*(?=[^·\-–|]*$)/);
      const pseudo = { ...S, A: (n) => (S.t == null ? 1 : ease.out(span(S.t, 0.6 + i * 0.22, 1.2 + i * 0.22))) };
      enter(pseudo, 'sub', () => {
        const y = top + i * rowH;
        const r1 = text(S, name, FONT.grotesk, x0, y, tw * 0.7, rowH * 0.6, { max: 46, lines: 1 });
        setFont(g, FONT.grotesk, r1.size || 40 * u);
        g.textAlign = 'right';
        g.fillStyle = S.ink;
        g.fillText(price, x0 + tw, y);
        const pw = g.measureText(price).width, nw = g.measureText(name).width;
        g.globalAlpha *= 0.45;
        g.setLineDash([2 * u, 8 * u]); g.lineWidth = 3 * u; g.strokeStyle = S.ink;
        g.beginPath(); g.moveTo(x0 + nw + 16 * u, y + (r1.size || 40) * 0.8); g.lineTo(x0 + tw - pw - 16 * u, y + (r1.size || 40) * 0.8); g.stroke();
        g.setLineDash([]); g.textAlign = 'left';
      });
    });
    enter(S, 'cta', () => text(S, p.cta, FONT.bold, x0, h - m - 46 * u, tw, 46 * u, { max: 36, lines: 1, caps: true }));
  },
};
function star(g, cx, cy, r, color) {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  g.closePath(); g.fill();
}
export const LAYOUT_IDS = Object.keys(LAYOUTS);
