// Object effects: the product is cut out and drawn as a soft-body mesh (squish, inflate, levitate, poke, melt)
// over a studio plate, or over its own photo with the hole filled in.
import { loadImage, canvas, cleanPlate, clamp, lerp, ease, span, smooth, meanColor, rgbCss, rng } from '../common.js';
import { createGL } from '../gl.js';
import { SCENES } from '../catalog.js';
import { _test as sceneParts } from './scene.js';

export const kind = 'video';
export const heavy = ['backdrop'];
const N = 36;
const VS = `#version 300 es
in vec3 a_pos; in vec2 a_uv; in float a_shade;
uniform vec2 u_size; out vec2 v_uv; out float v_shade;
void main() { v_uv = a_uv; v_shade = a_shade; vec2 p = a_pos.xy / u_size * 2.0 - 1.0; gl_Position = vec4(p.x, -p.y, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
in vec2 v_uv; in float v_shade; out vec4 o; uniform sampler2D u_tex;
void main() { vec4 c = texture(u_tex, v_uv); if (c.a < 0.003) discard;
  vec3 rgb = c.rgb * min(v_shade, 1.0) + c.a * max(v_shade - 1.0, 0.0) * 0.85; o = vec4(rgb, c.a); }`;

let kit = null, prog = null, mesh = null, texFor = null, tex = null;

export async function prepare(spec, io, params) {
  const cut = await io.cutout('product');
  const own = params.backdrop === 'own' && !cut.img?.src?.includes?.('/presets/samples/') && cut.full && cut.img;
  let plate, meta;
  if (own) {
    plate = cleanPlate(cut.img, cut.full);
    const b = cut.cut.box || { x: 0, y: 0, w: cut.img.width, h: cut.img.height };
    meta = { own: true, a: [(b.x + b.w / 2) / plate.width, (b.y + b.h) / plate.height], box: [b.w / plate.width, b.h / plate.height] };
  } else {
    const id = params.backdrop === 'own' ? 'studio-sweep' : params.backdrop;
    const s = SCENES.find((x) => x.id === id) || SCENES.find((x) => x.id === 'studio-sweep');
    plate = await loadImage(`/presets/plates/${s.id}-p.webp`);
    meta = { ...s.p, box: [s.p.box[0] * 1.3, s.p.box[1] * 1.3] };
  }
  const tone = meanColor(cut.cut);
  return { effect: spec.effect, cut: cut.cut, plate, meta, tone, seed: 7 };
}

/** The deformation: returns [x, y, shade] for mesh point (u, v) at time t (seconds, 0..D). */
function deform(fx, u, v, t, D, P) {
  const { bx, by, pw, ph } = P;
  let x = bx + (u - 0.5) * pw, y = by - (1 - v) * ph, sh = 1;
  if (fx === 'squish') {
    const s = squishAmount(t, D);
    const bulge = s * (0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, 1 - v + 0.15)));
    x = bx + (u - 0.5) * pw * (1 + bulge * 0.7);
    y = by - (1 - v) * ph * (1 - s);
    sh = 1 - Math.max(0, s) * 0.25 * (1 - v) + Math.max(0, s) * 0.12 * Math.sin(Math.PI * u) * v;
  } else if (fx === 'inflate') {
    const a = inflateAmount(t, D);
    const dx = (u - 0.5) / 0.5, dy = (v - 0.55) / 0.55, r2 = Math.min(1, dx * dx + dy * dy);
    const f = 1 + a * 0.5 * (1 - r2);
    const cx = bx, cy = by - ph * 0.45;
    x = cx + (u - 0.5) * pw * f * (1 + a * 0.12);
    y = cy + (v - 0.55) * ph * f;
    const lift = a * ph * 0.1 + a * Math.sin(t * 3.1) * ph * 0.02;
    y -= lift;
    const hx = dx + 0.35, hy = dy + 0.45;
    sh = 1 + a * 0.55 * Math.max(0, 1 - Math.sqrt(hx * hx + hy * hy) * 2.4);
  } else if (fx === 'levitate') {
    const L = levitateLift(t, D) * ph;
    const ang = 0.07 * Math.sin((t / D) * Math.PI * 4) * (L / ph / 0.28);
    const cx = bx, cy = by - ph * 0.5;
    let px = (u - 0.5) * pw, py = (v - 0.5) * ph;
    px += Math.sin(v * 3 + t * 2.4) * pw * 0.012 * (L / ph / 0.28);
    x = cx + px * Math.cos(ang) - py * Math.sin(ang);
    y = cy + px * Math.sin(ang) + py * Math.cos(ang) - L;
  } else if (fx === 'poke') {
    const { dent, wob } = pokeState(t, D);
    const pu = 0.86, pv = 0.42;
    const d2 = ((u - pu) / 0.35) ** 2 + ((v - pv) / 0.3) ** 2;
    const g = Math.exp(-d2 * 2.2);
    x -= dent * g * pw * 0.2;
    y += dent * g * ph * 0.02;
    x += wob * (1 - v) * pw * 0.14 * (1 - v * 0.3);
    y += Math.abs(wob) * (1 - v) * ph * 0.03;
    sh = 1 - dent * g * 0.3;
  } else if (fx === 'melt') {
    const m = meltAmount(t, D);
    const n = 0.9 + 0.1 * Math.sin(u * 6.3 + 1.7);
    // the top sags into a dome, the body slumps and spreads at the base
    const height = (1 - m * 0.72 * n) * (1 - m * 0.45 * Math.pow(2 * u - 1, 2));
    const spread = 1 + m * 1.1 * Math.pow(v, 3) + m * 0.2;
    x = bx + (u - 0.5) * pw * spread;
    y = by - (1 - v) * ph * height;
    // drips run down the sides below the base
    const drip = m * m * Math.pow(Math.max(0, Math.sin(u * Math.PI * 4 + 0.8)), 6) * ph * 0.05 * Math.pow(v, 4);
    y += drip;
    sh = 1 + m * 0.3 * Math.max(0, 1 - Math.abs(u - 0.35) * 4) * (1 - v * 0.5);
  }
  return [x, y, sh];
}
// timelines, each returning to rest so the clip loops
function squishAmount(t, D) {
  const k = t / D;
  if (k < 0.16) return 0.02 * Math.sin(t * 6);
  if (k < 0.3) return ease.in(span(k, 0.16, 0.3)) * 0.48;
  if (k < 0.52) return 0.48 + 0.015 * Math.sin(t * 40);
  const r = span(k, 0.52, 0.95);
  return 0.48 * (1 - ease.elastic(r)) ;
}
function inflateAmount(t, D) {
  const k = t / D;
  if (k < 0.12) return 0;
  if (k < 0.45) return ease.back(span(k, 0.12, 0.45));
  if (k < 0.7) return 1;
  return 1 - ease.elastic(span(k, 0.7, 1));
}
function levitateLift(t, D) {
  const k = t / D;
  const up = ease.inOut(span(k, 0.08, 0.38)), down = ease.inOut(span(k, 0.78, 0.98));
  return (up - down) * (0.26 + 0.03 * Math.sin(t * 2.6));
}
function pokeState(t, D) {
  const k = t / D;
  const tip = k < 0.18 ? 0 : k < 0.32 ? ease.out(span(k, 0.18, 0.32)) : k < 0.42 ? 1 : 1 - ease.inOut(span(k, 0.42, 0.52));
  const dent = clamp((tip - 0.55) / 0.45);
  const since = t - 0.42 * D;
  const wob = since > 0 ? 0.9 * Math.sin(since * 12) * Math.exp(-since * 1.3) : 0;
  return { tip, dent, wob };
}
function meltAmount(t, D) {
  const k = t / D;
  if (k < 0.1) return 0;
  if (k < 0.7) return ease.inOut(span(k, 0.1, 0.7));
  if (k < 0.82) return 1;
  return 1 - ease.inOut(span(k, 0.82, 1));
}

export function render(ctx, c, { w, h, t, duration, params }) {
  const g = c.getContext('2d');
  const D = duration || 5;
  const T = t == null ? D * 0.4 : t;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  // plate, framed like a product scene
  const m = ctx.meta;
  const P0 = sceneParts.place(ctx.plate, m, w, h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(ctx.plate, P0.ox, P0.oy, P0.dw, P0.dh);
  let pw, ph;
  if (m.own) { pw = m.box[0] * P0.dw; ph = m.box[1] * P0.dh; } else {
    const bw = m.box[0] * P0.dw * (params.size ?? 1), bh = m.box[1] * P0.dh * (params.size ?? 1), ar = ctx.cut.width / ctx.cut.height;
    pw = bw; ph = bw / ar; if (ph > bh) { ph = bh; pw = bh * ar; }
  }
  const P = { bx: P0.ox + m.a[0] * P0.dw, by: P0.oy + m.a[1] * P0.dh, pw, ph };
  // extent of the deformed base for the shadow
  const fx = ctx.effect;
  const [lx] = deform(fx, 0, 1, T, D, P), [rx] = deform(fx, 1, 1, T, D, P);
  const [, topY] = deform(fx, 0.5, 0, T, D, P), [, baseY] = deform(fx, 0.5, 1, T, D, P);
  const lift = Math.max(0, P.by - baseY);
  const sw = Math.max(pw * 0.3, rx - lx);
  shadow(g, P.bx, P.by, sw, lift, ph);
  if (fx === 'melt') puddle(g, ctx, P, meltAmount(T, D));
  // mesh
  kit ||= createGL(w, h);
  kit.size(w, h);
  if (!prog) { prog = kit.program(VS, FS); mesh = kit.grid(N); }
  if (texFor !== ctx.cut) { if (tex) kit.gl.deleteTexture(tex); tex = kit.texture(ctx.cut); texFor = ctx.cut; }
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * (N + 1) + i;
    const [x, y, s] = deform(fx, i / N, j / N, T, D, P);
    mesh.pos[k * 3] = x; mesh.pos[k * 3 + 1] = y; mesh.pos[k * 3 + 2] = 0; mesh.shade[k] = s;
  }
  const gl = kit.gl;
  kit.clear(0, 0, 0, 0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  prog.use(); kit.bind(tex, 0); prog.i('u_tex', 0).f('u_size', w, h);
  mesh.draw(prog);
  g.drawImage(kit.canvas, 0, 0);
  if (fx === 'squish') press(g, P, squishAmount(T, D), topY, T, D);
  if (fx === 'poke') poker(g, P, pokeState(T, D), T);
  if (fx === 'levitate') sparkles(g, P, T, D, lift);
}

function shadow(g, x, y, w, lift, ph) {
  const k = clamp(1 - lift / (ph * 0.45));
  g.save();
  g.globalCompositeOperation = 'multiply';
  const rw = w * (0.55 + 0.25 * k);
  const rg = g.createRadialGradient(x, y, 0, x, y, rw);
  rg.addColorStop(0, `rgba(20,14,10,${0.55 * k + 0.12})`);
  rg.addColorStop(0.55, `rgba(20,14,10,${0.22 * k + 0.05})`);
  rg.addColorStop(1, 'rgba(20,14,10,0)');
  g.setTransform(1, 0, 0, 0.12, 0, y * 0.88);
  g.fillStyle = rg;
  g.fillRect(x - rw, y - rw, rw * 2, rw * 2);
  g.restore();
}
function puddle(g, ctx, P, m) {
  if (m <= 0.01) return;
  const rw = P.pw * (0.6 + m * 1.1), rh = rw * 0.16;
  g.save();
  g.fillStyle = rgbCss(ctx.tone.map((v) => Math.min(255, v * 1.05 + 12)), 0.92);
  g.beginPath(); g.ellipse(P.bx, P.by, rw * ease.out(m), rh * ease.out(m), 0, 0, Math.PI * 2); g.fill();
  const hl = g.createLinearGradient(P.bx - rw, P.by - rh, P.bx + rw, P.by + rh);
  hl.addColorStop(0.2, 'rgba(255,255,255,0.0)'); hl.addColorStop(0.42, 'rgba(255,255,255,0.35)'); hl.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.fillStyle = hl;
  g.beginPath(); g.ellipse(P.bx, P.by - rh * 0.1, rw * 0.85 * ease.out(m), rh * 0.6 * ease.out(m), 0, 0, Math.PI * 2); g.fill();
  g.restore();
}
function press(g, P, s, topY, t, D) {
  // a soft padded block comes down from above, presses and lifts away
  const k = t / D;
  const contact = topY;
  const enterY = -P.ph * 0.6;
  let y;
  if (k < 0.16) y = lerp(enterY, contact - P.ph * 0.25, ease.out(span(k, 0.02, 0.16)));
  else if (k < 0.52) y = Math.min(contact, lerp(contact - P.ph * 0.25, contact, ease.in(span(k, 0.16, 0.3))));
  else y = lerp(contact, enterY, ease.in(span(k, 0.52, 0.8)));
  const bw = P.pw * 1.9, bh = P.ph * 0.42;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowBlur = bh * 0.25; g.shadowOffsetY = bh * 0.08;
  const gr = g.createLinearGradient(0, y - bh, 0, y);
  gr.addColorStop(0, '#f6efe7'); gr.addColorStop(1, '#d9cfc4');
  g.fillStyle = gr;
  g.beginPath(); g.roundRect(P.bx - bw / 2, y - bh, bw, bh, bh * 0.28); g.fill();
  g.shadowColor = 'transparent';
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.beginPath(); g.roundRect(P.bx - bw / 2 + bh * 0.15, y - bh + bh * 0.12, bw - bh * 0.3, bh * 0.12, bh * 0.06); g.fill();
  g.restore();
  void s;
}
function poker(g, P, st, t) {
  if (st.tip <= 0) return;
  const len = P.pw * 1.6, r = P.pw * 0.075;
  const tx = P.bx + P.pw * 0.36 + (1 - st.tip) * P.pw * 1.4 + (st.dent > 0 ? -st.dent * P.pw * 0.2 : 0);
  const ty = P.by - P.ph * 0.58;
  g.save();
  g.translate(tx, ty); g.rotate(-0.18);
  const gr = g.createLinearGradient(0, -r, 0, r);
  gr.addColorStop(0, '#ffd2dc'); gr.addColorStop(0.5, '#ff8fab'); gr.addColorStop(1, '#d9607e');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(0, -r * 0.8); g.arc(r * 0.8, 0, r * 0.8, Math.PI, Math.PI * 1.5, true);
  g.roundRect(0, -r, len, r * 2, r); g.fill();
  g.beginPath(); g.arc(r * 0.6, 0, r * 0.95, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(r, -r * 0.62, len - r * 2, r * 0.22);
  g.restore();
  void t;
}
function sparkles(g, P, t, D, lift) {
  const r = rng(11);
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const ph0 = r(), sp = 0.5 + r(), x = P.bx + (r() - 0.5) * P.pw * 2.2;
    const life = (ph0 + (t / D) * sp * 2) % 1;
    const y = P.by - life * P.ph * 1.6;
    const a = Math.sin(life * Math.PI) * clamp(lift / (P.ph * 0.1));
    if (a <= 0.01) continue;
    const s = P.pw * 0.02 * (0.5 + r());
    g.fillStyle = `rgba(255,236,190,${0.8 * a})`;
    g.beginPath(); g.moveTo(x, y - s * 2); g.lineTo(x + s * 0.5, y); g.lineTo(x, y + s * 2); g.lineTo(x - s * 0.5, y); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x - s * 2, y); g.lineTo(x, y + s * 0.5); g.lineTo(x + s * 2, y); g.lineTo(x, y - s * 0.5); g.closePath(); g.fill();
  }
  g.restore();
}
export const _test = { deform, squishAmount, inflateAmount, meltAmount, levitateLift, pokeState, canvas, smooth };
