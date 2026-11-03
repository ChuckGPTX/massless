// Transitions: two or three photos cut together with a shader transition (whip pan, zoom punch, light leak, ink
// wipe, glitch cut, spin swap, iris reveal, liquid morph). Each shot drifts slowly while it holds.
//
// Speed: a held shot is one texture read per pixel. The motion-blurred transitions (whip, zoom, spin) blur into a
// smaller buffer, with each tap read from a softer mip level so fewer taps stay smooth, and the full-size pass only
// upsamples it; where the blur is shorter than a few pixels (the middle of a zoom or a spin) the sharp image is
// used instead, so nothing that should be crisp goes soft.
import { createGL, QUAD_VS, GLSL_LIB } from '../gl.js';
import { clamp } from '../common.js';

export const kind = 'video';
const STYLES = ['whip', 'zoom', 'leak', 'ink', 'glitch', 'spin', 'iris', 'liquid'];
// blurred styles: buffer scale (x, y) and blur taps on software rendering / with graphics hardware
const BLUR = { 0: { sx: 0.25, sy: 1, taps: [16, 24] }, 1: { sx: 0.5, sy: 0.5, taps: [10, 20] }, 5: { sx: 0.5, sy: 0.5, taps: [12, 20] } };
// one small program per style and pass (STYLE -1 holds a shot; PASS 0 draws straight, 1 into the blur buffer,
// 2 brings the buffer up to full size; AB picks the photos a blurred style reads): a single program with every style behind branches runs several times
// slower on software rendering even when the branches are not taken
const FS = (style, pass, ab) => `#version 300 es
#define STYLE ${style}
#define PASS ${pass}
#define AB ${ab}
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_a, u_b, u_blur; uniform vec2 u_ra, u_rb, u_res;
uniform float u_ar, u_p, u_za, u_zb, u_time, u_spread; uniform int u_taps;
${GLSL_LIB}
const float PI = 3.14159;
vec2 fitUV(vec2 uv, float ia, float zoom) {
  vec2 s = vec2(1.0);
  if (u_ar > ia) s.y = ia / u_ar; else s.x = u_ar / ia;
  return (uv - 0.5) * s / zoom + 0.5;
}
vec4 A(vec2 uv, float b) { return texture(u_a, clamp(fitUV(uv, u_ra.x / u_ra.y, u_za), 0.001, 0.999), b); }
vec4 B(vec2 uv, float b) { return texture(u_b, clamp(fitUV(uv, u_rb.x / u_rb.y, u_zb), 0.001, 0.999), b); }
vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
// blur length in output pixels at uv, and the mip bias that makes n taps over it read as one smooth smear
float blurLen(vec2 uv) {
  float p = u_p;
#if STYLE == 0
  return sin(p * PI) * 0.18 * u_res.x;
#elif STYLE == 1
  return length((uv - 0.5) * u_res) * sin(p * PI) * 0.25;
#else
  return length((uv - 0.5) * u_res) * sin(p * PI) * 0.5;
#endif
}
// one mip bias per frame (a per-pixel level is several times slower on software rendering), set for the blur a
// third of the way out from the centre, a level under the tap spacing so the streaks keep their direction
float bias(vec2 uv, int n) { return n > 1 ? max(0.0, log2(blurLen(vec2(0.5) + 0.3 * normalize(vec2(1.0, u_res.y / u_res.x))) * u_spread / float(n - 1)) - 1.0) : 0.0; }
vec4 whip(vec2 uv, int n) {
  float p = u_p, e = p * p * (3.0 - 2.0 * p), blur = sin(p * PI) * 0.18; vec4 col = vec4(0.0);
  for (int i = 0; i < n; i++) { float k = n > 1 ? (float(i) / float(n - 1) - 0.5) * blur : 0.0;
    vec2 ua = uv + vec2(e + k, 0.0), ub = uv + vec2(e - 1.0 + k, 0.0);
    col += (ua.x <= 1.0 ? A(ua, 0.0) : B(ub, 0.0)); }
  return col / float(n);
}
vec4 zoom(vec2 uv, int n) {
  float p = u_p, e = p, str = sin(p * PI) * 0.25, m = smoothstep(0.42, 0.58, p), b = bias(uv, n);
  vec4 sa = vec4(0.0), sb = vec4(0.0); vec2 c = uv - 0.5;
  for (int i = 0; i < n; i++) { float k = n > 1 ? float(i) / float(n - 1) : 0.0;
#if AB != 2
    sa += A(0.5 + c / (1.0 + e * 1.5) * (1.0 - str * k), b);
#endif
#if AB != 1
    sb += B(0.5 + c * (1.0 + (1.0 - e) * 0.6) * (1.0 - str * k), b);
#endif
  }
  vec4 col = mix(sa, sb, m) / float(n);
  col.rgb += vec3(1.0) * exp(-pow((p - 0.5) * 9.0, 2.0)) * 0.25;
  return col;
}
vec4 spin(vec2 uv, int n) {
  float p = u_p, e = p * p * (3.0 - 2.0 * p), ang = e * 6.28318, bl = sin(p * PI) * 0.5, b = bias(uv, n);
  vec2 c = (uv - 0.5) * vec2(u_ar, 1.0); vec4 s = vec4(0.0);
  for (int i = 0; i < n; i++) { float k = n > 1 ? (float(i) / float(n - 1) - 0.5) * bl : 0.0;
    vec2 r = rot(c, ang + k) / vec2(u_ar, 1.0) / (1.0 - sin(p * PI) * 0.35) + 0.5;
#if AB == 2
    s += B(r, b);
#else
    s += A(r, b);
#endif
  }
  return s / float(n);
}
vec4 blurred(vec2 uv, int n) {
#if STYLE == 0
  return whip(uv, n);
#elif STYLE == 1
  return zoom(uv, n);
#else
  return spin(uv, n);
#endif
}
void main() {
  vec2 uv = v_uv; float p = u_p; vec4 col;
#if PASS == 1
  col = blurred(uv, u_taps); // into the small blur buffer
#elif PASS == 2
  // full size: the blur buffer, or the sharp image where the blur is shorter than a few pixels
  col = texture(u_blur, vec2(uv.x, 1.0 - uv.y));
#if STYLE != 0
  float w = smoothstep(1.5, 4.0, blurLen(uv));
  if (w < 1.0) col = mix(blurred(uv, 1), col, w);
#endif
#elif STYLE < 0 // holding a shot
  col = A(uv, 0.0);
#elif STYLE == 2 // light leak
  {
    vec4 a = A(uv, 0.0), b = B(uv, 0.0); float m = smoothstep(0.3, 0.7, p);
    col = mix(a, b, m);
    float burn = max(0.0, exp(-pow((p - 0.5) * 3.2, 2.0)) - 0.0773) / 0.9227; // zero at both ends, so the holds stay clean
    vec2 q = uv * vec2(u_ar, 1.0);
    float blob = smoothstep(0.2, 0.9, fbm(q * 2.0 + vec2(p * 2.5, -p)) + (uv.x - 0.3) * 0.6);
    vec3 leak = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.86, 0.55), uv.y);
    col.rgb = col.rgb + leak * blob * burn * 1.25 + vec3(burn * burn * 0.25);
  }
#elif STYLE == 3 // ink wipe
  {
    float n = fbm(uv * vec2(u_ar, 1.0) * 3.0) * 0.55 + (1.0 - uv.y) * 0.25 + uv.x * 0.2;
    float edge = p * 1.35 - 0.1;
    float m = smoothstep(edge - 0.02, edge + 0.02, n);
    col = mix(B(uv, 0.0), A(uv, 0.0), m);
    float line = smoothstep(0.035, 0.0, abs(n - edge)) * (1.0 - smoothstep(0.9, 1.0, p));
    col.rgb = mix(col.rgb, vec3(0.04, 0.04, 0.06), line * 0.9);
  }
#elif STYLE == 4 // glitch cut
  {
    float g = sin(p * PI);
    float row = floor(uv.y * 24.0); float r1 = hash(vec2(row, floor(u_time * 20.0)));
    float shift = (r1 - 0.5) * 0.25 * g * step(0.55, r1);
    vec2 u2 = uv + vec2(shift, 0.0);
    bool useB = hash(vec2(row, 7.0)) < smoothstep(0.25, 0.75, p) * 1.1;
    vec4 base = useB ? B(u2, 0.0) : A(u2, 0.0);
    float sp = 0.02 * g;
    vec4 r = useB ? B(u2 + vec2(sp, 0.0), 0.0) : A(u2 + vec2(sp, 0.0), 0.0);
    vec4 bl = useB ? B(u2 - vec2(sp, 0.0), 0.0) : A(u2 - vec2(sp, 0.0), 0.0);
    col = vec4(r.r, base.g, bl.b, 1.0);
    col.rgb += step(0.97, hash(uv * 400.0 + u_time)) * g * 0.4;
  }
#elif STYLE == 6 // iris
  {
    vec2 c = (uv - 0.5) * vec2(u_ar, 1.0); float d = length(c);
    float r = (p * p * (3.0 - 2.0 * p)) * (0.5 * length(vec2(u_ar, 1.0)) + 0.05);
    float m = smoothstep(r, r - 0.012, d);
    col = mix(A(uv, 0.0), B(0.5 + (uv - 0.5) * (1.08 - 0.08 * p), 0.0), m);
    col.rgb += vec3(1.0, 0.95, 0.85) * smoothstep(0.02, 0.0, abs(d - r)) * 0.6 * (1.0 - p);
  }
#elif STYLE == 7 // liquid morph
  {
    float amp = sin(p * PI) * 0.04;
    vec2 off = vec2(sin(uv.y * 18.0 + p * 9.0), cos(uv.x * 14.0 - p * 7.0)) * amp;
    col = mix(A(uv + off, 0.0), B(uv - off, 0.0), smoothstep(0.2, 0.8, p));
  }
#else
  col = blurred(uv, u_taps); // a blurred style drawn straight at full size
#endif
  o = vec4(col.rgb, 1.0);
}`;

let kit = null, soft = null, buf = null, blank = null;
/** Software rendering (no graphics hardware) gets fewer blur taps so exports stay quick. */
function softwareGL() {
  if (soft === null) {
    const ext = kit.gl.getExtension('WEBGL_debug_renderer_info');
    soft = /swiftshader|llvmpipe|software/i.test(ext ? kit.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '');
  }
  return soft;
}
/** The small buffer the blurred styles render into. */
function blurBuffer(w, h) {
  const gl = kit.gl;
  if (buf && buf.w === w && buf.h === h) return buf;
  if (buf) { gl.deleteFramebuffer(buf.fb); gl.deleteTexture(buf.tex); }
  gl.activeTexture(gl.TEXTURE3); // a spare unit, so the new texture is never bound where it is drawn into
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return (buf = { fb, tex, w, h });
}
const texCache = new Map(), programs = new Map();
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
  // full-screen passes need no edge smoothing, which costs a lot without graphics hardware
  kit ||= createGL(w, h, { antialias: false });
  const gl = kit.gl;
  kit.bind(tex(a), 0); kit.bind(tex(b), 1);
  const drift = (k) => 1.02 + 0.06 * clamp(k);
  const za = drift((T - i * (hold + tr)) / (hold + tr + 0.001)), zb = drift(0);
  const style = p > 0 ? Math.max(0, ctx.style) : -1;
  // unit 2 holds the blur buffer only while it is read; otherwise a blank, so it is never drawn into while bound
  if (!blank) { gl.activeTexture(gl.TEXTURE3); blank = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, blank); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); }
  kit.bind(blank, 2);
  // which photos a blurred style reads this frame (AB 1: the first only, 2: the second only, 0: both)
  const ab = style === 1 ? (p < 0.42 ? 1 : p > 0.58 ? 2 : 0) : style === 5 ? (p < 0.5 ? 1 : 2) : 0;
  const use = (pass) => {
    const key = `${style}|${pass}|${ab}`;
    if (!programs.has(key)) programs.set(key, kit.program(QUAD_VS, FS(style, pass, ab)));
    return programs.get(key).use().i('u_a', 0).i('u_b', 1).i('u_blur', 2).f('u_ra', a.width, a.height).f('u_rb', b.width, b.height)
      .f('u_ar', w / h).f('u_p', p).f('u_za', za).f('u_zb', zb).f('u_time', T).f('u_res', w, h);
  };
  let prog;
  const blur = BLUR[style];
  if (blur) {
    // blur into the small buffer, then bring it up to full size
    const bw = Math.max(16, Math.round(w * blur.sx)), bh = Math.max(16, Math.round(h * blur.sy));
    const target = blurBuffer(bw, bh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, bw, bh);
    // u_res stays the full size so blur lengths are in output pixels; u_spread turns them into buffer pixels
    prog = use(1).f('u_spread', Math.max(blur.sx, blur.sy)).i('u_taps', blur.taps[softwareGL() ? 0 : 1]);
    kit.quad(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    kit.size(w, h);
    kit.bind(target.tex, 2);
    prog = use(2).f('u_spread', 1).i('u_taps', 1);
  } else {
    kit.size(w, h);
    prog = use(0).f('u_spread', 1).i('u_taps', 1);
  }
  kit.quad(prog);
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.drawImage(kit.canvas, 0, 0, w, h);
}
