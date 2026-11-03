// Product spin: the cut-out gets a soft 3D relief from its own outline and turns on a glossy turntable, with a
// mirror reflection, a moving light sweep and the brand name. The swing returns to the start, so it loops.
import { canvas, clamp, setFont, fitText, FONT, hexRgb, luma } from '../common.js';
import { createGL } from '../gl.js';

export const kind = 'video';
const N = 90;
const BACKDROPS = {
  cream: ['#f4ede3', '#dccfbf', '#2e241b'], midnight: ['#20222b', '#08090c', '#f2efe8'], blush: ['#f6d9d6', '#e3b2ad', '#4a1f24'],
  sage: ['#dfe6d8', '#b9c5ad', '#23301e'], cobalt: ['#2f4bd8', '#14206e', '#ffffff'],
};
const VS = `#version 300 es
in vec3 a_pos; in vec2 a_uv; in float a_shade;
uniform vec2 u_size; uniform vec2 u_base; uniform float u_ang, u_f, u_mirror, u_scale;
out vec2 v_uv; out vec3 v_n; out float v_y;
void main() {
  vec3 p = a_pos * u_scale;
  float c = cos(u_ang), s = sin(u_ang);
  vec3 r = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  float k = u_f / (u_f - r.z);
  vec2 sp = vec2(r.x * k, r.y * k * u_mirror);
  vec2 px = u_base + vec2(sp.x, -sp.y);
  v_uv = a_uv; v_y = p.y; v_n = vec3(a_shade);
  gl_Position = vec4(px / u_size * 2.0 - 1.0, -r.z / u_f, 1.0); gl_Position.y = -gl_Position.y;
}`;
const FS = `#version 300 es
precision highp float;
in vec2 v_uv; in vec3 v_n; in float v_y; out vec4 o;
uniform sampler2D u_tex, u_norm; uniform float u_ang, u_light, u_mirror, u_h, u_fade;
void main() {
  vec4 c = texture(u_tex, v_uv);
  if (c.a < 0.01) discard;
  vec3 n = texture(u_norm, v_uv).xyz * 2.0 - 1.0;
  float ca = cos(u_ang), sa = sin(u_ang);
  n = normalize(vec3(n.x * ca + n.z * sa, n.y, -n.x * sa + n.z * ca));
  vec3 l = normalize(vec3(sin(u_light), 0.35, cos(u_light)));
  // seen from behind, the relief is the mirrored front a little darker
  if (!gl_FrontFacing == (u_mirror > 0.0)) n.z = -n.z;
  float diff = 0.78 + 0.32 * dot(n, l);
  if (n.z < 0.0) diff *= 0.82;
  vec3 hv = normalize(l + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, hv), 0.0), 40.0) * 0.38;
  vec3 rgb = c.rgb * diff + c.a * spec;
  float a = 1.0;
  if (u_mirror < 0.0) a = u_fade * (1.0 - smoothstep(0.0, u_h * 0.55, v_y));
  o = vec4(rgb, c.a) * a;
}`;

let kit = null, prog = null, mesh = null, cur = null, texC = null, texN = null;

export async function prepare(spec, io) {
  const cut = (await io.cutout('product')).cut;
  // relief: distance from the outline, on a small copy, eased into a dome
  const k = Math.min(1, 160 / Math.max(cut.width, cut.height));
  const w = Math.max(8, Math.round(cut.width * k)), h = Math.max(8, Math.round(cut.height * k));
  const sc = canvas(w, h), sg = sc.getContext('2d', { willReadFrequently: true });
  sg.drawImage(cut, 0, 0, w, h);
  const a = sg.getImageData(0, 0, w, h).data;
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = a[i * 4 + 3] > 100 ? INF : 0;
  // two-pass chamfer distance
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!d[i]) continue; d[i] = Math.min(d[i], x ? d[i - 1] + 1 : 1, y ? d[i - w] + 1 : 1, x && y ? d[i - w - 1] + 1.414 : 1.414, y && x < w - 1 ? d[i - w + 1] + 1.414 : 1.414); }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (!d[i]) continue; d[i] = Math.min(d[i], x < w - 1 ? d[i + 1] + 1 : 1, y < h - 1 ? d[i + w] + 1 : 1, x < w - 1 && y < h - 1 ? d[i + w + 1] + 1.414 : 1.414, y < h - 1 && x ? d[i + w - 1] + 1.414 : 1.414); }
  let max = 1;
  for (const v of d) if (v > max) max = v;
  // depth in units of the object's width
  const depth = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) depth[i] = Math.sqrt(d[i] / max) * 0.2;
  // smooth the chamfer steps away
  for (let pass = 0; pass < 3; pass++) {
    const src = depth.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      depth[i] = (src[i] * 4 + src[i - 1] + src[i + 1] + src[i - w] + src[i + w]) / 8;
    }
  }
  // normals as a texture
  const nc = canvas(w, h), ng = nc.getContext('2d'), nd = ng.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const dx = (depth[Math.min(w - 1, x + 1) + y * w] - depth[Math.max(0, x - 1) + y * w]) * w * 0.5;
    const dy = (depth[x + Math.min(h - 1, y + 1) * w] - depth[x + Math.max(0, y - 1) * w]) * w * 0.5;
    const n = [-dx, dy, 1], L = Math.hypot(...n);
    nd.data[i * 4] = ((n[0] / L) * 0.5 + 0.5) * 255; nd.data[i * 4 + 1] = ((n[1] / L) * 0.5 + 0.5) * 255; nd.data[i * 4 + 2] = ((n[2] / L) * 0.5 + 0.5) * 255; nd.data[i * 4 + 3] = 255;
  }
  ng.putImageData(nd, 0, 0);
  return { cut, depth, dw: w, dh: h, normals: nc, ar: cut.width / cut.height };
}

function geometry(ctx) {
  if (!mesh) mesh = kit.grid(N);
  // unit object: width 1, height 1/ar, base at y=0, centred on x
  const H = 1 / ctx.ar;
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const k = j * (N + 1) + i, u = i / N, v = j / N;
    const fx = u * (ctx.dw - 1), fy = v * (ctx.dh - 1), x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(ctx.dw - 1, x0 + 1), y1 = Math.min(ctx.dh - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    const D = ctx.depth, W = ctx.dw;
    const z = (D[y0 * W + x0] * (1 - ax) + D[y0 * W + x1] * ax) * (1 - ay) + (D[y1 * W + x0] * (1 - ax) + D[y1 * W + x1] * ax) * ay;
    mesh.pos[k * 3] = u - 0.5; mesh.pos[k * 3 + 1] = (1 - v) * H; mesh.pos[k * 3 + 2] = z;
    mesh.shade[k] = 1;
  }
}

export function render(ctx, c, { w, h, t, duration, params }) {
  const g = c.getContext('2d');
  const D = duration || 5, T = t == null ? D * 0.12 : t;
  const [c0, c1, ink] = BACKDROPS[params.backdrop] || BACKDROPS.cream;
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, c0); bg.addColorStop(1, c1);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  // the product's size and the floor
  const u = Math.min(w, h);
  const objW = Math.min(w * 0.7, (h * 0.46) * ctx.ar, u * 0.8);
  const objH = objW / ctx.ar;
  const baseY = h * (h / w > 1.5 ? 0.66 : 0.7), cx = w / 2;
  // a full turn that eases out of and back into the front view, or a gentle sway
  const ang = params.motion === 'sway' ? Math.sin((T / D) * Math.PI * 2) * 0.6 : Math.PI * 2 * (0.5 - 0.5 * Math.cos(Math.PI * (T / D)));
  const spin = (T / D) * Math.PI * 2;
  // turntable disc
  const rx = objW * 0.85, ry = rx * 0.2;
  g.save();
  const dark = luma(hexRgb(c1)) < 0.3;
  g.fillStyle = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
  g.beginPath(); g.ellipse(cx, baseY + ry * 0.25, rx * 1.02, ry * 1.08, 0, 0, Math.PI * 2); g.fill();
  const disc = g.createLinearGradient(0, baseY - ry, 0, baseY + ry);
  disc.addColorStop(0, dark ? '#2c2f38' : '#ffffff'); disc.addColorStop(1, dark ? '#15171c' : c0);
  g.fillStyle = disc;
  g.beginPath(); g.ellipse(cx, baseY, rx, ry, 0, 0, Math.PI * 2); g.fill();
  // marks that show the platter turning
  g.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  g.lineWidth = Math.max(1, u * 0.002);
  for (let r = 0.35; r < 1; r += 0.22) { g.beginPath(); g.ellipse(cx, baseY, rx * r, ry * r, 0, 0, Math.PI * 2); g.stroke(); }
  for (let i = 0; i < 12; i++) {
    const a = spin + (i / 12) * Math.PI * 2;
    const x = cx + Math.cos(a) * rx * 0.93, y = baseY + Math.sin(a) * ry * 0.93;
    if (Math.sin(a) < -0.2) continue;
    g.fillStyle = dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.14)';
    g.beginPath(); g.arc(x, y, u * 0.0035, 0, Math.PI * 2); g.fill();
  }
  // contact shadow
  const sg = g.createRadialGradient(cx, baseY, 0, cx, baseY, objW * 0.6);
  sg.addColorStop(0, 'rgba(0,0,0,0.35)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  g.setTransform(1, 0, 0, 0.13, 0, baseY * 0.87); g.fillStyle = sg; g.fillRect(cx - objW, baseY - objW, objW * 2, objW * 2);
  g.restore();
  // the object, then its reflection
  kit ||= createGL(w, h);
  kit.size(w, h);
  if (!prog) prog = kit.program(VS, FS);
  if (cur !== ctx) {
    if (texC) kit.gl.deleteTexture(texC);
    if (texN) kit.gl.deleteTexture(texN);
    texC = kit.texture(ctx.cut); texN = kit.texture(ctx.normals, { mips: false });
    geometry(ctx); cur = ctx;
  }
  const gl = kit.gl;
  kit.clear(0, 0, 0, 0);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  prog.use(); kit.bind(texC, 0); kit.bind(texN, 1);
  prog.i('u_tex', 0).i('u_norm', 1).f('u_size', w, h).f('u_base', cx, baseY).f('u_ang', ang).f('u_f', 3.2).f('u_scale', objW).f('u_light', -0.9 + Math.sin(spin) * 1.1).f('u_h', objH).f('u_fade', dark ? 0.32 : 0.22);
  // shrink perspective units: u_f in object widths
  prog.f('u_f', 3.2 * objW);
  prog.f('u_mirror', -1); mesh.draw(prog);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  prog.f('u_mirror', 1); mesh.draw(prog);
  gl.disable(gl.DEPTH_TEST);
  g.drawImage(kit.canvas, 0, 0);
  // brand
  const brand = String(params.brand || '').trim();
  if (brand) {
    g.save();
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'top';
    const fit = fitText(g, brand.toUpperCase(), FONT.display, w * 0.82, h * 0.14, { max: u * 0.14, lines: 1, tracking: 0.04 });
    g.fillText(fit.lines[0] || '', w / 2, h * (h / w > 1.5 ? 0.1 : 0.07));
    g.restore();
  }
  void setFont; void clamp;
}
