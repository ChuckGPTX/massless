// Mockups: the design is mapped into the blank surface of a photographed plate with an exact perspective
// (homography), takes on the surface's light and shading, keeps anything in front of it (a phone's camera
// cut-out), and gets the photo's grain. The clip version is a slow push-in on the finished photo.
import { loadImage, canvas, clamp } from '../common.js';
import { createGL, QUAD_VS, GLSL_LIB } from '../gl.js';

export const kind = 'image';
export const heavy = ['fit'];

const FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_plate, u_design;
uniform mat3 u_hinv; uniform vec2 u_size; uniform float u_white, u_emit, u_radius, u_aspect, u_seed, u_keep;
${GLSL_LIB}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 px = v_uv * u_size;
  vec4 plate = texture(u_plate, v_uv);
  vec3 q = u_hinv * vec3(px, 1.0);
  vec2 uv = q.xy / q.z;
  // anti-aliased mask of the surface, with rounded corners for screens
  vec2 d = min(uv, 1.0 - uv);
  vec2 fw = fwidth(uv) * 1.2;
  float m = smoothstep(0.0, fw.x, d.x) * smoothstep(0.0, fw.y, d.y);
  if (u_radius > 0.0) {
    vec2 r = vec2(u_radius, u_radius * u_aspect);
    vec2 c = clamp(uv, r, 1.0 - r);
    vec2 e = (uv - c) / r;
    m *= 1.0 - smoothstep(1.0 - 2.0 * length(fw / r), 1.0, length(e));
  }
  if (m <= 0.0) { o = plate; return; }
  vec4 des = texture(u_design, clamp(uv, 0.0, 1.0));
  float l = luma(plate.rgb);
  float shade = clamp(l / u_white, 0.0, 1.15);
  vec3 lit = des.rgb * mix(1.0, shade, 0.7 * (1.0 - u_emit));
  // a little of the surface's own colour cast and reflections
  lit = mix(lit, lit * (plate.rgb / max(l, 0.02)), 0.18 * (1.0 - u_emit));
  lit += max(plate.rgb - u_white, 0.0) * 0.5;
  // grain like the photo
  lit += (hash(px + u_seed) - 0.5) * 0.035;
  // keep dark things in front of the surface (a camera cut-out, a sticker)
  float keep = u_keep * (1.0 - smoothstep(u_white * 0.28, u_white * 0.42, l));
  o = vec4(mix(plate.rgb, lit, m * des.a * (1.0 - keep)), 1.0);
}`;

/** Homography from the unit square to quad (4 points, pixels), returned inverted as a column-major mat3. */
export function homographyInverse(qd) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = qd;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / den, h = (dx1 * dy3 - dx3 * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  // forward: [a b c; d e f; g h 1] maps (u, v, 1) to (x, y, w)
  const A = [a, b, c, d, e, f, g, h, 1];
  const inv = [
    A[4] * A[8] - A[5] * A[7], A[2] * A[7] - A[1] * A[8], A[1] * A[5] - A[2] * A[4],
    A[5] * A[6] - A[3] * A[8], A[0] * A[8] - A[2] * A[6], A[2] * A[3] - A[0] * A[5],
    A[3] * A[7] - A[4] * A[6], A[1] * A[6] - A[0] * A[7], A[0] * A[4] - A[1] * A[3],
  ];
  // column-major for GLSL
  return new Float32Array([inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]);
}

let kit = null, prog = null;
export async function prepare(spec, io, params) {
  const m = spec.mockup;
  const [plate, design] = await Promise.all([loadImage(`/presets/plates/${m.plate}.webp`), io.image('design')]);
  const W = plate.width, H = plate.height;
  const qd = m.quad.map(([x, y]) => [x * W, y * H]);
  // the surface's size in pixels decides the design's aspect
  const sw = (Math.hypot(qd[1][0] - qd[0][0], qd[1][1] - qd[0][1]) + Math.hypot(qd[2][0] - qd[3][0], qd[2][1] - qd[3][1])) / 2;
  const sh = (Math.hypot(qd[3][0] - qd[0][0], qd[3][1] - qd[0][1]) + Math.hypot(qd[2][0] - qd[1][0], qd[2][1] - qd[1][1])) / 2;
  const k = Math.min(2, 1600 / Math.max(sw, sh));
  const dc = canvas(Math.round(sw * k), Math.round(sh * k)), dg = dc.getContext('2d');
  dg.imageSmoothingQuality = 'high';
  const fill = params.fit !== 'contain';
  const s = fill ? Math.max(dc.width / design.width, dc.height / design.height) : Math.min(dc.width / design.width, dc.height / design.height);
  if (!fill) {
    // show all of it, over a soft blurred copy of itself
    const b = Math.max(dc.width / design.width, dc.height / design.height);
    dg.filter = `blur(${Math.round(dc.width / 40)}px) brightness(0.9)`;
    dg.drawImage(design, (dc.width - design.width * b) / 2, (dc.height - design.height * b) / 2, design.width * b, design.height * b);
    dg.filter = 'none';
  }
  dg.drawImage(design, (dc.width - design.width * s) / 2, (dc.height - design.height * s) / 2, design.width * s, design.height * s);
  // white level: the bright end of the blank surface
  const probe = canvas(64, 64), pg = probe.getContext('2d', { willReadFrequently: true });
  const xs = qd.map((p) => p[0]), ys = qd.map((p) => p[1]);
  const bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
  pg.drawImage(plate, bx + bw * 0.1, by + bh * 0.1, bw * 0.8, bh * 0.8, 0, 0, 64, 64);
  const px = pg.getImageData(0, 0, 64, 64).data, ls = [];
  for (let i = 0; i < px.length; i += 4) ls.push((px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255);
  ls.sort((a, b) => a - b);
  const white = clamp(ls[Math.floor(ls.length * 0.9)], 0.3, 1);
  // composite once at the plate's size
  kit ||= createGL(W, H);
  kit.size(W, H);
  prog ||= kit.program(QUAD_VS, FS);
  const tp = kit.texture(plate, { mips: false }), td = kit.texture(dc);
  prog.use();
  kit.bind(tp, 0); kit.bind(td, 1);
  const phone = m.id === 'phone';
  prog.i('u_plate', 0).i('u_design', 1).f('u_size', W, H).f('u_white', white).f('u_emit', phone ? 0.75 : 0).f('u_radius', phone ? 0.095 : 0).f('u_aspect', sw / sh).f('u_seed', 3.1).f('u_keep', phone ? 1 : 0.6);
  kit.gl.uniformMatrix3fv(kit.gl.getUniformLocation(prog.p, 'u_hinv'), false, homographyInverse(qd));
  kit.clear(0, 0, 0, 1);
  kit.quad(prog);
  const out = canvas(W, H);
  out.getContext('2d').drawImage(kit.canvas, 0, 0);
  kit.gl.deleteTexture(tp); kit.gl.deleteTexture(td);
  const cx = (xs.reduce((a, b) => a + b) / 4) / W, cy = (ys.reduce((a, b) => a + b) / 4) / H;
  return { out, focus: [cx, cy] };
}

export function render(ctx, c, { w, h, t, duration }) {
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingQuality = 'high';
  const img = ctx.out;
  const p = t == null ? 0 : t / (duration || 4);
  const ease = p < 0 ? 0 : 1 - Math.pow(1 - Math.min(1, p), 2);
  const z = 1 + 0.1 * ease;
  const k = Math.max(w / img.width, h / img.height) * z;
  const dw = img.width * k, dh = img.height * k;
  const fx = 0.5 + (ctx.focus[0] - 0.5) * ease, fy = 0.5 + (ctx.focus[1] - 0.5) * ease;
  const ox = clamp(w / 2 - fx * dw, w - dw, 0), oy = clamp(h / 2 - fy * dh, h - dh, 0);
  g.drawImage(img, ox, oy, dw, dh);
}
