// Transitions: two or three photos cut together with a shader transition (whip pan, zoom punch, light leak, ink
// wipe, glitch cut, spin swap, iris reveal, liquid morph). Each shot drifts slowly while it holds.
import { createGL, QUAD_VS, GLSL_LIB } from '../gl.js';
import { clamp, ease } from '../common.js';

export const kind = 'video';
const STYLES = ['whip', 'zoom', 'leak', 'ink', 'glitch', 'spin', 'iris', 'liquid'];
const FS = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_a, u_b; uniform vec2 u_ra, u_rb; uniform float u_ar, u_p, u_za, u_zb, u_time; uniform int u_style, u_taps;
${GLSL_LIB}
vec2 fitUV(vec2 uv, float ia, float zoom) {
  vec2 s = vec2(1.0);
  if (u_ar > ia) s.y = ia / u_ar; else s.x = u_ar / ia;
  return (uv - 0.5) * s / zoom + 0.5;
}
vec4 A(vec2 uv) { return texture(u_a, clamp(fitUV(uv, u_ra.x / u_ra.y, u_za), 0.001, 0.999)); }
vec4 B(vec2 uv) { return texture(u_b, clamp(fitUV(uv, u_rb.x / u_rb.y, u_zb), 0.001, 0.999)); }
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
void main() {
  vec2 uv = v_uv; float p = u_p; vec4 col;
  if (u_style == 0) { // whip pan
    float e = p * p * (3.0 - 2.0 * p); float blur = sin(p * 3.14159) * 0.18; col = vec4(0.0);
    float n = 0.0;
    for (int i = 0; i < 24; i++) { if (i >= u_taps) break; float k = (float(i) / float(u_taps - 1) - 0.5) * blur;
      vec2 ua = uv + vec2(e * 1.0 + k, 0.0), ub = uv + vec2(e * 1.0 - 1.0 + k, 0.0);
      col += (ua.x <= 1.0 ? A(ua) : B(ub)); n += 1.0; }
    col /= n;
  } else if (u_style == 1) { // zoom punch
    float e = p; vec4 sa = vec4(0.0), sb = vec4(0.0); float str = sin(p * 3.14159) * 0.25;
    float n = 0.0;
    for (int i = 0; i < 20; i++) { if (i >= u_taps) break; float k = float(i) / float(u_taps - 1);
      vec2 c = uv - 0.5;
      sa += A(0.5 + c / (1.0 + e * 1.5) * (1.0 - str * k));
      sb += B(0.5 + c * (1.0 + (1.0 - e) * 0.6) * (1.0 - str * k)); n += 1.0; }
    col = mix(sa / n, sb / n, smoothstep(0.42, 0.58, p));
    col.rgb += vec3(1.0) * exp(-pow((p - 0.5) * 9.0, 2.0)) * 0.25;
  } else if (u_style == 2) { // light leak
    vec4 a = A(uv), b = B(uv); float m = smoothstep(0.3, 0.7, p);
    col = mix(a, b, m);
    float burn = exp(-pow((p - 0.5) * 3.2, 2.0));
    vec2 q = uv * vec2(u_ar, 1.0);
    float blob = smoothstep(0.2, 0.9, fbm(q * 2.0 + vec2(p * 2.5, -p)) + (uv.x - 0.3) * 0.6);
    vec3 leak = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.86, 0.55), uv.y);
    col.rgb = col.rgb + leak * blob * burn * 1.25 + vec3(burn * burn * 0.25);
  } else if (u_style == 3) { // ink wipe
    float n = fbm(uv * vec2(u_ar, 1.0) * 3.0) * 0.55 + (1.0 - uv.y) * 0.25 + uv.x * 0.2;
    float edge = p * 1.35 - 0.1;
    float m = smoothstep(edge - 0.02, edge + 0.02, n);
    col = mix(B(uv), A(uv), m);
    float line = smoothstep(0.035, 0.0, abs(n - edge)) * (1.0 - smoothstep(0.9, 1.0, p));
    col.rgb = mix(col.rgb, vec3(0.04, 0.04, 0.06), line * 0.9);
  } else if (u_style == 4) { // glitch cut
    float g = sin(p * 3.14159);
    float row = floor(uv.y * 24.0); float r1 = hash(vec2(row, floor(u_time * 20.0)));
    float shift = (r1 - 0.5) * 0.25 * g * step(0.55, r1);
    vec2 u2 = uv + vec2(shift, 0.0);
    bool useB = hash(vec2(row, 7.0)) < smoothstep(0.25, 0.75, p) * 1.1;
    vec4 base = useB ? B(u2) : A(u2);
    float sp = 0.02 * g;
    vec4 r = useB ? B(u2 + vec2(sp, 0.0)) : A(u2 + vec2(sp, 0.0));
    vec4 bl = useB ? B(u2 - vec2(sp, 0.0)) : A(u2 - vec2(sp, 0.0));
    col = vec4(r.r, base.g, bl.b, 1.0);
    col.rgb += step(0.97, hash(uv * 400.0 + u_time)) * g * 0.4;
  } else if (u_style == 5) { // spin swap
    float e = p * p * (3.0 - 2.0 * p); vec4 s = vec4(0.0); float ang = e * 6.28318; float bl = sin(p * 3.14159) * 0.5;
    vec2 c = (uv - 0.5) * vec2(u_ar, 1.0);
    float n = 0.0;
    for (int i = 0; i < 16; i++) { if (i >= u_taps) break; float k = (float(i) / float(u_taps - 1) - 0.5) * bl;
      vec2 r = rot(c, ang + k) / vec2(u_ar, 1.0) / (1.0 - sin(p * 3.14159) * 0.35) + 0.5;
      s += p < 0.5 ? A(r) : B(r); n += 1.0; }
    col = s / n;
  } else if (u_style == 6) { // iris
    vec2 c = (uv - 0.5) * vec2(u_ar, 1.0); float d = length(c);
    float r = ease(p) * (0.5 * length(vec2(u_ar, 1.0)) + 0.05);
    float m = smoothstep(r, r - 0.012, d);
    col = mix(A(uv), B(0.5 + (uv - 0.5) * (1.08 - 0.08 * p)), m);
    col.rgb += vec3(1.0, 0.95, 0.85) * smoothstep(0.02, 0.0, abs(d - r)) * 0.6 * (1.0 - p);
  } else { // liquid morph
    float amp = sin(p * 3.14159) * 0.04;
    vec2 off = vec2(sin(uv.y * 18.0 + p * 9.0), cos(uv.x * 14.0 - p * 7.0)) * amp;
    col = mix(A(uv + off), B(uv - off), smoothstep(0.2, 0.8, p));
  }
  o = vec4(col.rgb, 1.0);
}`.replace('float r = ease(p)', 'float r = (p * p * (3.0 - 2.0 * p))');

let kit = null, prog = null, soft = null;
/** Software rendering (no GPU) gets fewer blur taps so exports stay quick. */
function softwareGL() {
  if (soft === null) {
    const ext = kit.gl.getExtension('WEBGL_debug_renderer_info');
    soft = /swiftshader|llvmpipe|software/i.test(ext ? kit.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '');
  }
  return soft;
}
const texCache = new Map();
export async function prepare(spec, io, params) {
  const imgs = [];
  for (const k of ['a', 'b', 'c']) if (io.has(k)) imgs.push(await io.image(k));
  return { style: STYLES.indexOf(spec.style), imgs };
}
function timing(params) {
  return params.pace === 'smooth' ? { hold: 1.5, tr: 0.9 } : { hold: 1.25, tr: 0.5 };
}
export function duration(ctx, params) {
  const { hold, tr } = timing(params);
  const n = ctx.imgs.length;
  return Math.min(20, n * hold + (n - 1) * tr + 0.4);
}
export function galleryDuration(ctx, params) {
  const { hold, tr } = timing(params);
  return ctx.imgs.length * (hold + tr);
}
function tex(img) {
  if (!texCache.has(img)) { texCache.set(img, kit.texture(img)); if (texCache.size > 12) { const [k, v] = texCache.entries().next().value; kit.gl.deleteTexture(v); texCache.delete(k); } }
  return texCache.get(img);
}

export function render(ctx, c, { w, h, t, params, gallery }) {
  const { hold, tr } = timing(params);
  const n = ctx.imgs.length;
  // gallery loops go round back to the first shot
  const shots = gallery ? [...ctx.imgs, ctx.imgs[0]] : ctx.imgs;
  const total = gallery ? n * (hold + tr) : duration(ctx, params);
  let T = t == null ? hold + tr * 0.5 : gallery ? (t % total) : t;
  // where are we: holding shot i, or moving from i to i+1
  let i = 0, p = 0, local = T;
  for (i = 0; i < shots.length - 1; i++) {
    if (local < hold) { p = 0; break; }
    if (local < hold + tr) { p = (local - hold) / tr; break; }
    local -= hold + tr;
  }
  if (i >= shots.length - 1) { i = shots.length - 1; p = 0; }
  const a = shots[i], b = shots[Math.min(shots.length - 1, i + 1)];
  kit ||= createGL(w, h);
  kit.size(w, h);
  prog ||= kit.program(QUAD_VS, FS);
  prog.use();
  kit.bind(tex(a), 0); kit.bind(tex(b), 1);
  const drift = (k) => 1.02 + 0.06 * clamp(k);
  const za = drift((T - i * (hold + tr)) / (hold + tr + 0.001)), zb = drift(0);
  prog.i('u_a', 0).i('u_b', 1).f('u_ra', a.width, a.height).f('u_rb', b.width, b.height).f('u_ar', w / h).f('u_p', p > 0 ? ease.inOut(p) * 0.0 + p : 0).f('u_za', za).f('u_zb', zb).f('u_time', T);
  kit.gl.uniform1i(kit.gl.getUniformLocation(prog.p, 'u_style'), Math.max(0, ctx.style));
  kit.gl.uniform1i(kit.gl.getUniformLocation(prog.p, 'u_taps'), softwareGL() ? 6 : 20);
  kit.quad(prog);
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.drawImage(kit.canvas, 0, 0, w, h);
}
