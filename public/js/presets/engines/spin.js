// Product spin: the cut-out becomes a solid. Its outline is extruded with a rounded side wall and a mirrored back,
// the front gets a gentle dome, and it swings on a glossy turntable with a slow push-in, a moving light sweep, a
// floor reflection and the brand name. The swing never goes edge-on and returns to the start, so it loops.
//
// The shape is built from smooth fields, not from a pixel outline: an exact distance from the outline, blurred,
// drives the dome, and the wall follows the soft edge itself (sub-pixel contour). The earlier relief used a chamfer
// distance of a hard 160 px outline under a square-root dome, so every pixel step of the outline became a ridge
// running in from the edge, which the 8-bit normal texture and a sharp highlight turned into visible stripes.
import { canvas, fitText, FONT, hexRgb, luma } from '../common.js';
import { createGL } from '../gl.js';

export const kind = 'video';
const BACKDROPS = {
  cream: ['#f4ede3', '#dccfbf', '#2e241b'], midnight: ['#20222b', '#08090c', '#f2efe8'], blush: ['#f6d9d6', '#e3b2ad', '#4a1f24'],
  sage: ['#dfe6d8', '#b9c5ad', '#23301e'], cobalt: ['#2f4bd8', '#14206e', '#ffffff'],
};
// swing (radians), push-in and camera height for each motion; 'turn' is the old name of the showcase turn
const MOTIONS = { showcase: { swing: 0.8, push: 0.08 }, sway: { swing: 0.36, push: 0.04 } };
const PITCH = 0.16; // the camera looks down a little, so the top of the wall shows
const STRIDE = 9; // x y z, nx ny nz, u v, part (0 front, 1 back, 2 wall)

const VS = `#version 300 es
in vec3 a_pos; in vec3 a_nrm; in vec2 a_uv; in float a_part;
uniform vec2 u_size, u_base; uniform float u_yaw, u_pitch, u_f, u_scale, u_mirror;
out vec2 v_uv, v_s; out vec3 v_n; out float v_part, v_y;
void main() {
  vec3 p = a_pos * u_scale, n = a_nrm;
  if (u_mirror < 0.0) { p.y = -p.y; n.y = -n.y; } // the floor reflection: mirrored about the floor plane
  float c = cos(u_yaw), s = sin(u_yaw), cp = cos(u_pitch), sp = sin(u_pitch);
  p = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  n = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
  p = vec3(p.x, p.y * cp - p.z * sp, p.y * sp + p.z * cp);
  n = vec3(n.x, n.y * cp - n.z * sp, n.y * sp + n.z * cp);
  float k = u_f / (u_f - p.z);
  vec2 px = u_base + vec2(p.x, -p.y) * k;
  vec2 ndc = px / u_size * 2.0 - 1.0;
  float w = 1.0 / k; // perspective-correct texturing
  gl_Position = vec4(ndc.x * w, -ndc.y * w, (-p.z / u_f) * w, w);
  v_uv = a_uv; v_n = n; v_part = a_part; v_y = a_pos.y; v_s = vec2(p.x, p.y) / u_scale;
}`;
const FS = `#version 300 es
precision highp float;
in vec2 v_uv, v_s; in vec3 v_n; in float v_part, v_y; out vec4 o;
uniform sampler2D u_tex; uniform vec3 u_key; uniform vec4 u_disc; uniform float u_prepass, u_canvasH, u_sweep, u_sweepAmt, u_mirror, u_h, u_fade, u_wallLod, u_rim;
void main() {
  vec3 n = normalize(v_n);
  vec4 c;
  if (v_part > 1.5) { // side wall: the product's own edge colour, softened
    vec4 t = textureLod(u_tex, v_uv, u_wallLod);
    c = vec4(t.rgb / max(t.a, 0.05), 1.0);
  } else {
    c = texture(u_tex, v_uv);
    if (c.a < 0.004) discard;
    c.rgb /= c.a;
    // a crisp, one-pixel soft edge right on the outline, so the faces meet the wall without a light seam
    float aw = max(fwidth(c.a), 0.02);
    c.a = clamp((c.a - 0.5) / (2.0 * aw) + 0.5, 0.0, 1.0);
    if (c.a < 0.004) discard;
  }
  if (u_prepass > 0.5) { if (c.a < 0.98) discard; o = vec4(0.0); return; } // depth only: the nearest solid surface
  // the photo already carries its own light, so the key light only shapes it
  float diff = dot(n, u_key);
  float shade = 0.7 + 0.36 * diff;
  if (v_part > 1.5) shade = 0.5 + 0.42 * max(diff, 0.0) + 0.1 * n.y;
  else if (v_part > 0.5) shade *= 0.72;
  float hk = max(dot(n, normalize(u_key + vec3(0.0, 0.0, 1.0))), 0.0);
  // the light sweep: a slanted band of light that crosses the product and bends with its shape
  float q = v_s.x + 0.32 * v_s.y + 0.3 * n.x - u_sweep;
  float sweep = (exp(-q * q / 0.005) * 0.2 + exp(-q * q / 0.05) * 0.07) * u_sweepAmt * (0.4 + 0.6 * clamp(n.z, 0.0, 1.0));
  float spec = pow(hk, 60.0) * 0.1 + sweep;
  float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 3.0) * u_rim;
  float a = c.a;
  if (u_mirror < 0.0) { // the reflection: no highlights, fading with height and kept on the turntable
    spec = rim = 0.0;
    if (v_part > 1.5) shade *= 0.8;
    vec2 e = (vec2(gl_FragCoord.x, u_canvasH - gl_FragCoord.y) - u_disc.xy) / u_disc.zw;
    a *= u_fade * (1.0 - smoothstep(0.0, u_h * 0.45, v_y)) * (1.0 - smoothstep(0.92, 1.0, length(e)));
  }
  vec3 rgb = c.rgb * shade + vec3(spec + rim);
  o = vec4(rgb * a, a);
}`;

// ---------- fields ----------
const INF = 1e20;
/** Exact 1D squared distance transform (Felzenszwalb and Huttenlocher). */
function edt1(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let r = v[k], s = (f[q] + q * q - f[r] - r * r) / (2 * q - 2 * r);
    while (s <= z[k]) { k--; r = v[k]; s = (f[q] + q * q - f[r] - r * r) / (2 * q - 2 * r); }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const r = v[k]; d[q] = (q - r) * (q - r) + f[r]; }
}
/** Euclidean distance (in pixels) from each inside pixel to the nearest outside pixel. */
function distance(inside, w, h) {
  const g = new Float64Array(w * h), m = Math.max(w, h);
  const f = new Float64Array(m), d = new Float64Array(m), v = new Int32Array(m), z = new Float64Array(m + 1);
  for (let i = 0; i < w * h; i++) g[i] = inside[i] ? INF : 0;
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = d[x]; }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(g[i]);
  return out;
}
function blur(src, w, h, sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(r * 2 + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += src[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + r];
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r];
    out[y * w + x] = s;
  }
  return out;
}
const sample = (F, w, h, x, y) => {
  x = Math.min(w - 1.001, Math.max(0, x)); y = Math.min(h - 1.001, Math.max(0, y));
  const x0 = x | 0, y0 = y | 0, ax = x - x0, ay = y - y0, i = y0 * w + x0;
  return (F[i] * (1 - ax) + F[i + 1] * ax) * (1 - ay) + (F[i + w] * (1 - ax) + F[i + w + 1] * ax) * ay;
};
// marching squares: for each case (corner bits a b c d = top-left, top-right, bottom-right, bottom-left inside),
// the pairs of cell edges (0 top, 1 right, 2 bottom, 3 left) the outline crosses
const CASES = [[], [3, 2], [2, 1], [3, 1], [0, 1], [0, 3, 2, 1], [0, 2], [0, 3], [0, 3], [0, 2], [0, 1, 3, 2], [0, 1], [3, 1], [2, 1], [3, 2], []];

export async function prepare(spec, io) {
  const cut = (await io.cutout('product')).cut;
  const ar = cut.width / cut.height, H = 1 / ar;
  // the soft outline at a working size, with a clear border so every contour closes
  const M = 320, P = 4;
  const k = Math.min(1, M / Math.max(cut.width, cut.height)) || 1;
  const w = Math.max(8, Math.round(cut.width * k)), h = Math.max(8, Math.round(cut.height * k));
  const mw = w + P * 2, mh = h + P * 2;
  const sc = canvas(mw, mh), sg = sc.getContext('2d', { willReadFrequently: true });
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(cut, P, P, w, h);
  const px = sg.getImageData(0, 0, mw, mh).data;
  const A = new Float32Array(mw * mh);
  for (let i = 0; i < mw * mh; i++) A[i] = px[i * 4 + 3] / 255;
  const As = blur(A, mw, mh, 0.6); // the contour: a whisker of smoothing takes the pixel steps out
  const Ag = blur(A, mw, mh, 2); // outward directions for the wall and the bevel
  const inside = new Uint8Array(mw * mh);
  for (let i = 0; i < mw * mh; i++) inside[i] = As[i] > 0.5 ? 1 : 0;
  const D = blur(distance(inside, mw, mh), mw, mh, Math.max(2, w / 110)); // smooth distance from the edge, in pixels

  // proportions, in units of the object's width
  const minDim = Math.min(1, H);
  const T = Math.min(0.26 * minDim, 0.15 * Math.max(1, H)); // thickness
  const B = 0.07 * minDim; // dome
  const Dm = 0.24 * minDim; // where the dome levels off
  const Rb = 0.04 * minDim; // rounded edge band
  const toM = (u, v) => [u * w + P - 0.5, v * h + P - 0.5]; // uv -> mask pixel
  const outward = (mx, my) => { // in object space (y up), unit length
    const gx = sample(Ag, mw, mh, mx + 1, my) - sample(Ag, mw, mh, mx - 1, my);
    const gy = sample(Ag, mw, mh, mx, my + 1) - sample(Ag, mw, mh, mx, my - 1);
    const L = Math.hypot(gx, gy);
    return L > 1e-6 ? [-gx / L, gy / L, L] : [0, 0, 0];
  };
  const prof = (x) => { x = Math.min(1, Math.max(0, x)); return 1 - (1 - x) ** 3; };
  const zAt = (u, v) => { const [mx, my] = toM(u, v); return T / 2 + B * prof(sample(D, mw, mh, mx, my) / w / Dm); };

  const verts = [], idx = [];
  const push = (x, y, z, nx, ny, nz, u, v, part) => { verts.push(x, y, z, nx, ny, nz, u, v, part); return verts.length / STRIDE - 1; };

  // side wall from the contour (drawn first, so the soft edge of the faces blends over it)
  const ROWS = 6, PHI = 0.62; // normals turn from the front, through outward, to the back
  const pt = (x, y, e) => {
    let x0, y0, x1, y1;
    if (e === 0) { x0 = x; y0 = y; x1 = x + 1; y1 = y; } else if (e === 1) { x0 = x + 1; y0 = y; x1 = x + 1; y1 = y + 1; }
    else if (e === 2) { x0 = x; y0 = y + 1; x1 = x + 1; y1 = y + 1; } else { x0 = x; y0 = y; x1 = x; y1 = y + 1; }
    const a0 = As[y0 * mw + x0], a1 = As[y1 * mw + x1], f = Math.abs(a1 - a0) > 1e-6 ? (0.5 - a0) / (a1 - a0) : 0.5;
    return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
  };
  const wallCol = (mx, my) => {
    const [ox, oy] = outward(mx, my);
    // tucked half a pixel under the faces so the join is closed
    const u = (mx - ox * 0.6 + 0.5 - P) / w, v = (my + oy * 0.6 + 0.5 - P) / h;
    return { X: u - 0.5, Y: (1 - v) * H, ox, oy, u: (mx - ox * 1.5 + 0.5 - P) / w, v: (my + oy * 1.5 + 0.5 - P) / h };
  };
  for (let y = 0; y < mh - 1; y++) for (let x = 0; x < mw - 1; x++) {
    const c = (As[y * mw + x] > 0.5 ? 8 : 0) | (As[y * mw + x + 1] > 0.5 ? 4 : 0) | (As[(y + 1) * mw + x + 1] > 0.5 ? 2 : 0) | (As[(y + 1) * mw + x] > 0.5 ? 1 : 0);
    const e = CASES[c];
    for (let s = 0; s < e.length; s += 2) {
      const p0 = wallCol(...pt(x, y, e[s])), p1 = wallCol(...pt(x, y, e[s + 1]));
      let base = -1;
      for (let r = 0; r < ROWS; r++) {
        const f = r / (ROWS - 1), z = T / 2 - f * T, phi = (0.5 - f) * 2 * PHI, cs = Math.cos(phi), sn = Math.sin(phi);
        const i0 = push(p0.X, p0.Y, z, p0.ox * cs, p0.oy * cs, sn, p0.u, p0.v, 2);
        push(p1.X, p1.Y, z, p1.ox * cs, p1.oy * cs, sn, p1.u, p1.v, 2);
        if (base >= 0) idx.push(base, base + 1, i0, base + 1, i0 + 1, i0);
        base = i0;
      }
    }
  }
  const wallCount = idx.length;

  // front and back faces: a grid over the cut-out, domed by the smooth distance, with a rounded edge band
  const G = 120;
  const nx = Math.max(8, Math.round(ar >= 1 ? G : G * ar)), ny = Math.max(8, Math.round(ar >= 1 ? G / ar : G));
  const grid = [];
  const du = 1 / nx, dv = 1 / ny;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const u = i / nx, v = j / ny;
    const z = zAt(u, v);
    const dzdX = (zAt(u + du, v) - zAt(u - du, v)) / (2 * du), dzdY = -(zAt(u, v + dv) - zAt(u, v - dv)) / (2 * dv * H);
    let n = [-dzdX, -dzdY, 1];
    const [mx, my] = toM(u, v);
    const d = sample(D, mw, mh, mx, my) / w;
    const b = 0.59 * (1 - Math.min(1, Math.max(0, d / Rb)) ** 2);
    const [ox, oy, gl] = outward(mx, my);
    if (b > 0 && gl > 0) { const L = Math.hypot(...n); n = [n[0] / L * (1 - b) + ox * b, n[1] / L * (1 - b) + oy * b, n[2] / L * (1 - b)]; }
    const L = Math.hypot(...n);
    grid.push([u - 0.5, (1 - v) * H, z, n[0] / L, n[1] / L, n[2] / L, u, v]);
  }
  const face = (part, sz) => {
    const first = verts.length / STRIDE;
    for (const g of grid) push(g[0], g[1], g[2] * sz, g[3], g[4], g[5] * sz, g[6], g[7], part);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = first + j * (nx + 1) + i, b2 = a + 1, c2 = a + nx + 1, d2 = c2 + 1;
      idx.push(a, c2, b2, b2, c2, d2);
    }
  };
  face(1, -1); // mirrored back
  face(0, 1);
  return { cut, ar, T, verts: new Float32Array(verts), idx: new Uint32Array(idx), wallCount };
}

// ---------- drawing ----------
let kit = null, prog = null, cur = null, tex = null, bufs = null, soft = null;
/** Software rendering (no graphics hardware): edge smoothing doubles the cost of every frame there, so it is left off. */
function softwareGL() {
  if (soft === null) {
    const gl = document.createElement('canvas').getContext('webgl2'), ext = gl?.getExtension('WEBGL_debug_renderer_info');
    soft = /swiftshader|llvmpipe|software/i.test(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return soft;
}
function upload(ctx) {
  const gl = kit.gl;
  if (tex) gl.deleteTexture(tex);
  tex = kit.texture(ctx.cut);
  bufs ||= { v: gl.createBuffer(), i: gl.createBuffer() };
  gl.bindBuffer(gl.ARRAY_BUFFER, bufs.v); gl.bufferData(gl.ARRAY_BUFFER, ctx.verts, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ctx.idx, gl.STATIC_DRAW);
  cur = ctx;
}
function drawMesh(ctx) {
  const gl = kit.gl, F = 4;
  gl.bindBuffer(gl.ARRAY_BUFFER, bufs.v);
  for (const [name, n, off] of [['a_pos', 3, 0], ['a_nrm', 3, 3], ['a_uv', 2, 6], ['a_part', 1, 8]]) {
    const a = prog.attrib(name);
    if (a < 0) continue;
    gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, n, gl.FLOAT, false, STRIDE * F, off * F);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.i);
  gl.drawElements(gl.TRIANGLES, ctx.idx.length, gl.UNSIGNED_INT, 0);
}

/** The camera at time T of a clip D seconds long: swing angle, push-in and the light sweep (all loop). */
export function camera(T, D, motion) {
  const m = MOTIONS[motion] || MOTIONS.showcase;
  const u = (((T / D) % 1) + 1) % 1;
  let s = Math.sin(u * Math.PI * 2);
  s *= 1.5 - 0.5 * s * s; // linger a moment at each end of the swing
  return {
    yaw: m.swing * s,
    zoom: 1 + m.push * (0.5 - 0.5 * Math.cos(u * Math.PI * 2)),
    sweep: u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u), // a light that crosses once per loop (0..1)
    sweepAmt: Math.sin(u * Math.PI) ** 1.5,
  };
}

export function render(ctx, c, { w, h, t, duration, params }) {
  const g = c.getContext('2d');
  const D = duration || 5, T = t == null ? D * 0.16 : t;
  const [c0, c1, ink] = BACKDROPS[params.backdrop] || BACKDROPS.cream;
  const cam = camera(T, D, params.motion);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, c0); bg.addColorStop(1, c1);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const dark = luma(hexRgb(c1)) < 0.3;
  // the product's size, the floor, and the push-in around the middle of the product
  const u = Math.min(w, h), tall = h / w > 1.5;
  const objW0 = Math.min(w * 0.68, h * 0.42 * ctx.ar, u * 0.78);
  const baseY0 = h * (tall ? 0.66 : 0.7), cx = w / 2;
  const focusY = baseY0 - (objW0 / ctx.ar) * 0.45;
  const objW = objW0 * cam.zoom, objH = objW / ctx.ar;
  const baseY = focusY + (baseY0 - focusY) * cam.zoom;
  // turntable disc: a soft drop, the glossy top and marks that turn with the product
  const rx = Math.max(objW, objH * 0.6) * 0.82, ry = rx * Math.sin(PITCH) * 1.25;
  g.save();
  g.fillStyle = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)';
  g.beginPath(); g.ellipse(cx, baseY + ry * 0.3, rx * 1.02, ry * 1.1, 0, 0, Math.PI * 2); g.fill();
  const disc = g.createLinearGradient(0, baseY - ry, 0, baseY + ry);
  disc.addColorStop(0, dark ? '#2c2f38' : '#ffffff'); disc.addColorStop(1, dark ? '#15171c' : c0);
  g.fillStyle = disc;
  g.beginPath(); g.ellipse(cx, baseY, rx, ry, 0, 0, Math.PI * 2); g.fill();
  // a soft sheen across the platter that follows the light sweep
  const sx = cx + (cam.sweep * 2 - 1) * rx * 0.6;
  const sheen = g.createRadialGradient(sx, baseY - ry * 0.2, 0, sx, baseY - ry * 0.2, rx * 0.7);
  sheen.addColorStop(0, dark ? `rgba(255,255,255,${0.1 * cam.sweepAmt})` : `rgba(255,255,255,${0.5 * cam.sweepAmt})`); sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.save(); g.beginPath(); g.ellipse(cx, baseY, rx, ry, 0, 0, Math.PI * 2); g.clip();
  g.fillStyle = sheen; g.fillRect(cx - rx, baseY - ry, rx * 2, ry * 2); g.restore();
  g.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  g.lineWidth = Math.max(1, u * 0.002);
  for (let r = 0.35; r < 1; r += 0.22) { g.beginPath(); g.ellipse(cx, baseY, rx * r, ry * r, 0, 0, Math.PI * 2); g.stroke(); }
  for (let i = 0; i < 12; i++) {
    const a = cam.yaw + (i / 12) * Math.PI * 2;
    const x = cx + Math.sin(a) * rx * 0.93, y = baseY + Math.cos(a) * ry * 0.93;
    if (Math.cos(a) < -0.2) continue;
    g.fillStyle = dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.14)';
    g.beginPath(); g.arc(x, y, u * 0.0035, 0, Math.PI * 2); g.fill();
  }
  // contact shadow, as wide as the product's footprint from this angle
  const foot = objW * Math.abs(Math.cos(cam.yaw)) + ctx.T * objW * Math.abs(Math.sin(cam.yaw));
  const sg = g.createRadialGradient(cx, baseY, 0, cx, baseY, foot * 0.62);
  sg.addColorStop(0, 'rgba(0,0,0,0.34)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  g.setTransform(1, 0, 0, 0.13, 0, baseY * 0.87); g.fillStyle = sg; g.fillRect(cx - foot, baseY - foot, foot * 2, foot * 2);
  g.restore();

  // the product, then (underneath it on screen) its reflection
  kit ||= createGL(w, h, { antialias: !softwareGL() });
  kit.size(w, h);
  prog ||= kit.program(VS, FS);
  if (cur !== ctx) upload(ctx);
  const gl = kit.gl;
  kit.clear(0, 0, 0, 0);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  prog.use(); kit.bind(tex, 0);
  const key = [-0.5, 0.55, 0.67], kl = Math.hypot(...key);
  prog.i('u_tex', 0).f('u_size', w, h).f('u_base', cx, baseY).f('u_yaw', cam.yaw).f('u_pitch', PITCH).f('u_f', 3.4 * Math.max(objW, objH)).f('u_scale', objW)
    .f('u_h', 1 / ctx.ar).f('u_fade', dark ? 0.3 : 0.2).f('u_key', key[0] / kl, key[1] / kl, key[2] / kl).f('u_sweep', -0.85 + cam.sweep * (1.85 + 0.32 / ctx.ar)).f('u_disc', cx, baseY, rx, ry).f('u_canvasH', h)
    .f('u_sweepAmt', cam.sweepAmt).f('u_rim', dark ? 0.16 : 0.1).f('u_wallLod', Math.max(0, Math.log2(Math.max(ctx.cut.width, ctx.cut.height) / 32)));
  // the reflection first lays down the depth of the solid surfaces, so only the nearest layer is coloured and the
  // faded copy never shows the wall and faces through each other; the product itself is opaque and needs no such pass
  for (const mirror of [-1, 1]) {
    gl.clear(gl.DEPTH_BUFFER_BIT);
    prog.f('u_mirror', mirror);
    if (mirror < 0) { prog.f('u_prepass', 1); gl.colorMask(false, false, false, false); drawMesh(ctx); gl.colorMask(true, true, true, true); }
    prog.f('u_prepass', 0); drawMesh(ctx);
  }
  gl.disable(gl.DEPTH_TEST);
  g.drawImage(kit.canvas, 0, 0);
  // brand
  const brand = String(params.brand || '').trim();
  if (brand) {
    g.save();
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'top';
    const fit = fitText(g, brand.toUpperCase(), FONT.display, w * 0.82, h * 0.14, { max: u * 0.14, lines: 1, tracking: 0.04 });
    g.fillText(fit.lines[0] || '', w / 2, h * (tall ? 0.1 : 0.07));
    g.restore();
  }
}
