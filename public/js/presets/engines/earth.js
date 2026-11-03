// Earth zoom out: from the visitor's photo up through rooftops, the city, the coast and the clouds to the whole
// planet. Each layer is a photo of the next scale, nested in the centre of the one above with a soft edge;
// the camera's height moves on a log scale so the speed feels constant, then settles on the globe.
import { loadImage, canvas, cover, clamp, ease, span, setFont, FONT, rng } from '../common.js';

export const kind = 'video';
const R = 5.2; // how much smaller each layer sits inside the next
const LEVELS = 5;

export async function prepare(spec, io) {
  const [photo, ...plates] = await Promise.all([io.image('photo'), ...Array.from({ length: LEVELS }, (_, i) => loadImage(`/presets/plates/earth-${i + 1}.webp`))]);
  return { layers: [photo, ...plates], cache: new Map(), clouds: cloudSprites() };
}

/** A layer cover-fitted to the frame's aspect, with feathered edges (the photo gets a soft vignette edge). */
function feathered(ctx, i, w, h) {
  const k = Math.min(1, 900 / Math.max(w, h));
  const W = Math.round(w * k), H = Math.round(h * k), key = `${i}|${W}x${H}`;
  if (ctx.cache.has(key)) return ctx.cache.get(key);
  const c = canvas(W, H), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  cover(g, ctx.layers[i], 0, 0, W, H);
  if (i < LEVELS) {
    // soft edge so the layer melts into the one around it
    g.globalCompositeOperation = 'destination-in';
    const f = Math.min(W, H) * 0.22;
    const mask = canvas(W, H), mg = mask.getContext('2d');
    mg.fillStyle = '#000';
    mg.filter = `blur(${(f * 0.45).toFixed(0)}px)`;
    mg.fillRect(f * 0.55, f * 0.55, W - f * 1.1, H - f * 1.1);
    g.drawImage(mask, 0, 0);
  }
  ctx.cache.set(key, c);
  return c;
}
function cloudSprites() {
  const r = rng(5), out = [];
  for (let k = 0; k < 6; k++) {
    const c = canvas(256, 256), g = c.getContext('2d');
    for (let i = 0; i < 14; i++) {
      const x = 60 + r() * 136, y = 80 + r() * 96, rad = 30 + r() * 50;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    }
    out.push(c);
  }
  return out;
}

/** Camera height in layers (0 = the photo, 5 = the globe) at time t of a D-second clip. */
export function height(t, D) {
  const p = span(t, D * 0.07, D * 0.88);
  // fast in the middle, gentle at both ends
  return LEVELS * ease.inOut(p);
}

export function render(ctx, c, { w, h, t, duration, params }) {
  const g = c.getContext('2d');
  const D = duration || 7, T = t == null ? D * 0.35 : t;
  const z = height(T, D);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.imageSmoothingQuality = 'high';
  // a slow roll as we rise, settling at the end
  const roll = Math.sin(clamp(z / LEVELS) * Math.PI) * 0.12;
  g.translate(w / 2, h / 2); g.rotate(roll); g.translate(-w / 2, -h / 2);
  // the outermost layer that still covers the frame, then every inner layer on top
  let outer = LEVELS;
  for (let i = 0; i <= LEVELS; i++) if (Math.pow(R, i - z) >= 1.35) { outer = i; break; }
  for (let i = outer; i >= 0; i--) {
    const s = Math.pow(R, i - z);
    if (s < 0.02) break;
    const L = feathered(ctx, i, w, h);
    const dw = w * s * 1.25, dh = h * s * 1.25; // a little extra so rotation never shows the edge
    g.drawImage(L, w / 2 - dw / 2, h / 2 - dh / 2, dw, dh);
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  // passing through cloud between the coast and orbit
  const cloud = span(z, 2.3, 3.7);
  if (cloud > 0 && cloud < 1) {
    const r = rng(9);
    for (let k = 0; k < 9; k++) {
      const spr = ctx.clouds[k % ctx.clouds.length];
      const ang = r() * Math.PI * 2, dist = 0.15 + r() * 0.4;
      const grow = 0.6 + cloud * 3.2;
      const x = w / 2 + Math.cos(ang) * dist * w * grow, y = h / 2 + Math.sin(ang) * dist * h * grow;
      const size = Math.max(w, h) * (0.5 + r() * 0.4) * grow;
      g.globalAlpha = Math.sin(cloud * Math.PI) * 0.9;
      g.drawImage(spr, x - size / 2, y - size / 2, size, size);
    }
    g.globalAlpha = 1;
  }
  // speed: a soft zoom smear while climbing fastest
  const speed = Math.sin(clamp(z / LEVELS) * Math.PI);
  if (speed > 0.3) {
    g.globalAlpha = (speed - 0.3) * 0.35;
    g.drawImage(c, -w * 0.02, -h * 0.02, w * 1.04, h * 1.04);
    g.globalAlpha = 1;
  }
  // vignette
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
  pin(g, w, h, T, D, z, String(params.place || '').trim());
}

function pin(g, w, h, T, D, z, place) {
  const u = Math.min(w, h);
  const a = clamp(span(T, D * 0.03, D * 0.12)) * (1 - span(z, 3.9, 4.6));
  const end = span(T, D * 0.86, D * 0.96);
  if (a > 0.01) {
    const x = w / 2, y = h / 2, s = u * 0.032;
    g.save();
    g.globalAlpha = a;
    const pulse = (T * 0.9) % 1;
    g.strokeStyle = `rgba(255,193,39,${1 - pulse})`; g.lineWidth = u * 0.004;
    g.beginPath(); g.ellipse(x, y, s * (1 + pulse * 2.4), s * 0.45 * (1 + pulse * 2.4), 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffc127'; g.strokeStyle = '#1a1a1a'; g.lineWidth = u * 0.004;
    g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x - s * 1.1, y - s * 1.4, x - s * 0.9, y - s * 2.6, x, y - s * 2.6); g.bezierCurveTo(x + s * 0.9, y - s * 2.6, x + s * 1.1, y - s * 1.4, x, y); g.fill(); g.stroke();
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(x, y - s * 1.75, s * 0.36, 0, Math.PI * 2); g.fill();
    if (place) label(g, place, x, y - s * 3.3, u, 'bottom');
    g.restore();
  }
  if (end > 0 && place) { g.save(); g.globalAlpha = end; label(g, place, w / 2, h * (h / w > 1.5 ? 0.78 : 0.86), u, 'top'); g.restore(); }
}
function label(g, text, x, y, u, anchor) {
  setFont(g, FONT.grotesk, u * 0.04, { tracking: 0.04 });
  const tw = g.measureText(text.toUpperCase()).width, ph = u * 0.072, pw = tw + u * 0.06;
  const top = anchor === 'bottom' ? y - ph : y;
  g.fillStyle = 'rgba(12,12,14,0.78)';
  g.beginPath(); g.roundRect(x - pw / 2, top, pw, ph, ph / 2); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text.toUpperCase(), x, top + ph / 2 + u * 0.002);
}
