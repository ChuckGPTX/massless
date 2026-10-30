// Massless renderer: a still + a depth map become a mesh you can fly a camera through.
// Vertices are pushed along their own rest-camera rays, so the rest frame matches the source exactly.
// Pass 1 renders the scene with depth-of-field; pass 2 applies lens and film finishing.

import { mat4 } from './math.js';

const SCENE_VS = `#version 300 es
precision highp float;
in vec2 aUv;
uniform sampler2D uDepth;
uniform mat4 uProj;
uniform mat4 uView;
uniform float uAspect;
uniform float uD;
uniform float uSNear;
uniform float uSFar;
uniform float uPush;
out vec2 vUv;
out float vDepth;
void main() {
  float d = texture(uDepth, aUv).r;
  float s = uPush / mix(1.0 / uSFar, 1.0 / uSNear, d);
  vec3 P = vec3((aUv.x - 0.5) * uAspect, aUv.y - 0.5, 0.0);
  vec3 C = vec3(0.0, 0.0, uD);
  vec3 pos = C + (P - C) * s;
  vUv = aUv;
  vDepth = d;
  gl_Position = uProj * uView * vec4(pos, 1.0);
}`;

// Two layers: a soft background (depth with foreground objects pushed back, color blurred) and the
// sharp foreground, whose triangles that span a depth cliff are cut away. Moving the camera then
// reveals a plausible smudge behind objects instead of streaked "rubber sheet" stripes.
const SCENE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in float vDepth;
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform sampler2D uBgColor;
uniform float uFocus;
uniform float uBlur;
uniform float uAspect;
uniform float uOval;
uniform float uTilt;
uniform float uLayer;
uniform float uCut;
out vec4 frag;
const float GA = 2.39996323;
float cocAt(float d, float y) {
  float dc = clamp(abs(d - uFocus) * 1.7, 0.0, 1.0);
  float tc = smoothstep(0.05, 0.36, abs(y - 0.46));
  return mix(dc, tc, uTilt);
}
void main() {
  if (uLayer < 0.5) {
    frag = vec4(texture(uBgColor, vUv, 0.5).rgb, 1.0);
    return;
  }
  // depth gradient in image space (height units), recovered from screen-space derivatives
  vec2 dx = dFdx(vUv);
  vec2 dy = dFdy(vUv);
  float ddx = dFdx(vDepth);
  float ddy = dFdy(vDepth);
  float det = dx.x * dy.y - dx.y * dy.x;
  vec2 g = vec2(ddx * dy.y - dx.y * ddy, dx.x * ddy - ddx * dy.x) / (abs(det) > 1e-12 ? det : 1e-12);
  float slope = length(vec2(g.x / uAspect, g.y));
  if (uCut < -0.5) { frag = vec4(vec3(slope / 40.0), 1.0); return; }
  if (slope > uCut) discard;
  float coc = cocAt(vDepth, vUv.y) * uBlur;
  vec3 col;
  if (coc < 0.0007) {
    col = texture(uColor, vUv).rgb;
  } else {
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    vec2 scale = vec2(coc / uAspect * mix(1.0, 0.55, uOval), coc);
    for (int i = 0; i < 28; i++) {
      float r = sqrt((float(i) + 0.5) / 28.0);
      float th = float(i) * GA;
      vec2 uv2 = vUv + vec2(cos(th), sin(th)) * r * scale;
      vec3 c = texture(uColor, uv2).rgb;
      float dd = texture(uDepth, uv2).r;
      float sc = cocAt(dd, uv2.y) * uBlur;
      // a sharp sample sitting in front of us should not bleed into our blur
      float w = (dd > vDepth + 0.04) ? smoothstep(0.0, coc, sc + 0.0005) : 1.0;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      w *= 1.0 + smoothstep(0.72, 1.0, l) * 2.5;
      acc += c * w;
      wsum += w;
    }
    col = acc / max(wsum, 1e-4);
  }
  frag = vec4(col, 1.0);
}`;

const POST_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const POST_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uTime;
uniform vec2 uWeave;
uniform float uGrain;
uniform float uVignette;
uniform float uHalation;
uniform float uCA;
uniform float uDistort;
uniform float uSat;
uniform float uContrast;
uniform float uWarm;
uniform float uFade;
uniform float uVHS;
uniform float uStreak;
uniform float uSoft;
uniform float uTealOrange;
uniform float uMono;
uniform float uExposure;
out vec4 frag;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 lens(vec2 uv) {
  float asp = uRes.x / uRes.y;
  vec2 c = uv - 0.5;
  c.x *= asp;
  float r2 = dot(c, c);
  float rmax = (asp * asp + 1.0) * 0.25;
  c *= (1.0 + uDistort * r2) / (1.0 + uDistort * rmax);
  c.x /= asp;
  return c + 0.5;
}

vec3 sampleScene(vec2 uv) {
  return texture(uScene, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
}

void main() {
  vec2 uv = lens(vUv) + uWeave;

  // analog tape wobble
  if (uVHS > 0.0) {
    float line = floor(uv.y * uRes.y / 3.0);
    float jitter = (hash(vec2(line, floor(uTime * 24.0))) - 0.5) * 0.004 * uVHS;
    uv.x += jitter + sin(uv.y * 40.0 + uTime * 3.0) * 0.0008 * uVHS;
  }

  vec2 dir = uv - 0.5;
  float ca = uCA * 0.006 + uVHS * 0.004;
  vec3 col;
  col.r = sampleScene(uv + dir * ca + vec2(uVHS * 0.003, 0.0)).r;
  col.g = sampleScene(uv).g;
  col.b = sampleScene(uv - dir * ca - vec2(uVHS * 0.003, 0.0)).b;

  // glow / halation and softness from a small blur kernel
  vec3 blur = vec3(0.0);
  vec3 glow = vec3(0.0);
  float px = 1.0 / uRes.y;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5236;
    float r = (i % 2 == 0) ? 7.0 : 15.0;
    vec3 s = sampleScene(uv + vec2(cos(a) * r / uRes.x, sin(a) * r * px));
    blur += s;
    glow += max(s - 0.62, 0.0);
  }
  blur /= 12.0;
  glow /= 12.0;
  col = mix(col, blur, clamp(uSoft * 0.45 + uVHS * 0.35, 0.0, 0.8));
  col += glow * vec3(1.0, 0.5, 0.3) * uHalation * 2.2;

  // anamorphic streaks: horizontal smear of highlights, tinted blue
  if (uStreak > 0.0) {
    vec3 st = vec3(0.0);
    for (int i = -10; i <= 10; i++) {
      float o = float(i) * 0.012;
      st += max(sampleScene(vec2(uv.x + o, uv.y)) - 0.7, 0.0) * (1.0 - abs(float(i)) / 11.0);
    }
    col += st * vec3(0.35, 0.6, 1.0) * uStreak * 0.35;
  }

  // grade
  col *= uExposure;
  col *= vec3(1.0 + uWarm * 0.12, 1.0 + uWarm * 0.02, 1.0 - uWarm * 0.14);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 teal = col * vec3(0.86, 1.02, 1.14);
  vec3 orange = col * vec3(1.14, 1.0, 0.84);
  col = mix(col, mix(teal, orange, smoothstep(0.15, 0.85, l)), abs(uTealOrange));
  if (uTealOrange < 0.0) col = mix(col, col * vec3(0.95, 1.08, 0.88), -uTealOrange);
  col = (col - 0.5) * uContrast + 0.5;
  l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat);
  col = mix(col, vec3(l), uMono);
  col = mix(vec3(uFade), vec3(1.0 - uFade * 0.35), clamp(col, 0.0, 1.0));

  // scanlines
  if (uVHS > 0.0) {
    col *= 1.0 - uVHS * 0.12 * (0.5 + 0.5 * sin(vUv.y * uRes.y * 3.14159));
  }

  // vignette
  vec2 vc = vUv - 0.5;
  vc.x *= uRes.x / uRes.y * 0.75;
  col *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(vc));

  // grain, stronger in the mids
  float n = hash(vUv * uRes + fract(uTime * 7.13) * 911.0) - 0.5;
  float n2 = hash(vUv * uRes * 0.5 + fract(uTime * 3.7) * 377.0) - 0.5;
  l = dot(col, vec3(0.299, 0.587, 0.114));
  col += (n * 0.7 + n2 * 0.5) * uGrain * 0.16 * (1.0 - abs(l - 0.5));

  frag = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('Shader compile failed: ' + log);
  }
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

// UNPACK_FLIP_Y_WEBGL is ignored for ImageBitmap sources, so route those through a canvas.
function asFlippable(source) {
  if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    const c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    c.getContext('2d').drawImage(source, 0, 0);
    return c;
  }
  return source;
}

export const REST_FOV = 40; // degrees, vertical, of the virtual camera at rest
export const OVERSCAN = 1.08; // rest frame shows 1/OVERSCAN of the image height

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error('This browser has no WebGL2, which Massless needs to move the camera.');
    this.gl = gl;
    this.scene = program(gl, SCENE_VS, SCENE_FS);
    this.post = program(gl, POST_VS, POST_FS);
    this.aspect = 16 / 9;
    this.depthW = 0;
    this.depthH = 0;
    this.depthData = null;
    this.colorTex = this._tex();
    this.depthTex = this._tex();
    this.bgDepthTex = this._tex();
    this.bgColorTex = this._tex();
    this.sceneTex = this._tex();
    this.fbo = gl.createFramebuffer();
    this.depthRb = gl.createRenderbuffer();
    this.vao = gl.createVertexArray();
    this.postVao = gl.createVertexArray();
    this.indexCount = 0;
    this.hasImage = false;
    this.setDepthRange(0.55, 1.5);
    this.cut = 8; // depth change per image height above which a triangle counts as a cliff
  }

  _tex() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 22, 28, 255]));
    return t;
  }

  /** Rest-camera distance so the image plane fills the frame with overscan. */
  get restDistance() {
    return 1 / OVERSCAN / (2 * Math.tan((REST_FOV * Math.PI) / 360));
  }

  setDepthRange(sNear, sFar) {
    this.sNear = sNear;
    this.sFar = sFar;
  }

  /** Output size in pixels. Width and height are kept even for H.264. */
  setSize(w, h) {
    w = Math.max(2, Math.round(w / 2) * 2);
    h = Math.max(2, Math.round(h / 2) * 2);
    if (this.canvas.width === w && this.canvas.height === h && this._fboReady) return;
    this.canvas.width = w;
    this.canvas.height = h;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._fboReady = true;
  }

  /** Source still: ImageBitmap, HTMLImageElement or canvas. */
  setImage(source) {
    const gl = this.gl;
    source = asFlippable(source);
    this.aspect = source.width / source.height;
    gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    this._buildMesh();
    this.hasImage = true;
  }

  /**
   * Depth: Uint8Array, one channel, 255 = nearest, row 0 = top of the image.
   * bg: optional background-layer depth of the same size (foreground eroded away).
   */
  setDepth(data, w, h, bg = null) {
    const gl = this.gl;
    this.depthData = data;
    this.depthW = w;
    this.depthH = h;
    const upload = (tex, d) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, d);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    };
    upload(this.depthTex, data);
    upload(this.bgDepthTex, bg || data);
  }

  /** Inpainted color for the background layer (ImageData or canvas). Defaults to the source. */
  setBackgroundColor(source) {
    const gl = this.gl;
    source = asFlippable(source);
    gl.bindTexture(gl.TEXTURE_2D, this.bgColorTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }

  /** Depth at an image position (u right, v up, both 0..1), 0..1 with 1 = near. */
  depthAt(u, v) {
    if (!this.depthData) return 0.5;
    const x = Math.min(this.depthW - 1, Math.max(0, Math.round(u * (this.depthW - 1))));
    const y = Math.min(this.depthH - 1, Math.max(0, Math.round((1 - v) * (this.depthH - 1))));
    return this.depthData[y * this.depthW + x] / 255;
  }

  /** World position of an image point after displacement (mirrors the vertex shader). */
  worldPoint(u, v) {
    const d = this.depthAt(u, v);
    const s = 1 / (1 / this.sFar + (1 / this.sNear - 1 / this.sFar) * d);
    const D = this.restDistance;
    const px = (u - 0.5) * this.aspect;
    const py = v - 0.5;
    return [px * s, py * s, D - D * s];
  }

  /** Distance factor s for a depth value d. */
  sFor(d) {
    return 1 / (1 / this.sFar + (1 / this.sNear - 1 / this.sFar) * d);
  }

  _buildMesh() {
    const gl = this.gl;
    const cols = 320;
    const rows = Math.max(40, Math.round(cols / this.aspect));
    const verts = new Float32Array((cols + 1) * (rows + 1) * 2);
    let k = 0;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        verts[k++] = i / cols;
        verts[k++] = j / rows;
      }
    }
    const idx = new Uint32Array(cols * rows * 6);
    k = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i;
        const b = a + 1;
        const c = a + cols + 1;
        const d = c + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = c;
        idx[k++] = b; idx[k++] = d; idx[k++] = c;
      }
    }
    gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.scene.p, 'aUv');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.indexCount = idx.length;
  }

  viewProj(cam, outAspect) {
    const proj = mat4.perspective((cam.fov * Math.PI) / 180, outAspect, 0.01, 50);
    const view = mat4.lookAt(cam.eye, cam.target, cam.roll || 0);
    return { proj, view };
  }

  /**
   * cam: { eye, target, fov, roll, focus, blur }
   * fx: finishing parameters (see app.js finishFor)
   */
  render(cam, fx, time) {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const { proj, view } = this.viewProj(cam, W / H);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.08, 0.09, 0.11, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.hasImage) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      const { p, u } = this.scene;
      gl.useProgram(p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.colorTex);
      gl.uniform1i(u.uColor, 0);
      gl.uniform1i(u.uDepth, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.bgColorTex);
      gl.uniform1i(u.uBgColor, 2);
      gl.uniformMatrix4fv(u.uProj, false, proj);
      gl.uniformMatrix4fv(u.uView, false, view);
      gl.uniform1f(u.uAspect, this.aspect);
      gl.uniform1f(u.uD, this.restDistance);
      gl.uniform1f(u.uSNear, this.sNear);
      gl.uniform1f(u.uSFar, this.sFar);
      gl.uniform1f(u.uFocus, cam.focus ?? 0.6);
      gl.uniform1f(u.uBlur, (cam.blur ?? 0) * 0.014);
      gl.uniform1f(u.uOval, fx.ovalBokeh || 0);
      gl.uniform1f(u.uTilt, fx.tilt || 0);
      gl.uniform1f(u.uCut, this.cut);
      gl.bindVertexArray(this.vao);
      // background layer, pushed a hair behind
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.bgDepthTex);
      gl.uniform1f(u.uLayer, 0);
      gl.uniform1f(u.uPush, 1.004);
      if (this.layers !== 'fg') gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
      // foreground layer
      gl.bindTexture(gl.TEXTURE_2D, this.depthTex);
      gl.uniform1f(u.uLayer, 1);
      gl.uniform1f(u.uPush, 1.0);
      if (this.layers !== 'bg') gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);
      gl.disable(gl.DEPTH_TEST);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    const { p, u } = this.post;
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(u.uScene, 0);
    gl.uniform2f(u.uRes, W, H);
    gl.uniform1f(u.uTime, time);
    const wv = fx.weave || 0;
    gl.uniform2f(u.uWeave, Math.sin(time * 9.1) * Math.sin(time * 2.3) * 0.0016 * wv, Math.sin(time * 7.3 + 1.7) * 0.0022 * wv);
    gl.uniform1f(u.uGrain, fx.grain ?? 0);
    gl.uniform1f(u.uVignette, fx.vignette ?? 0.3);
    gl.uniform1f(u.uHalation, fx.halation ?? 0);
    gl.uniform1f(u.uCA, fx.ca ?? 0);
    gl.uniform1f(u.uDistort, fx.distort ?? 0);
    gl.uniform1f(u.uSat, fx.sat ?? 1);
    gl.uniform1f(u.uContrast, fx.contrast ?? 1);
    gl.uniform1f(u.uWarm, fx.warm ?? 0);
    gl.uniform1f(u.uFade, fx.fade ?? 0);
    gl.uniform1f(u.uVHS, fx.vhs ?? 0);
    gl.uniform1f(u.uStreak, fx.streak ?? 0);
    gl.uniform1f(u.uSoft, fx.soft ?? 0);
    gl.uniform1f(u.uTealOrange, fx.tealOrange ?? 0);
    gl.uniform1f(u.uMono, fx.mono ?? 0);
    gl.uniform1f(u.uExposure, fx.exposure ?? 1);
    gl.bindVertexArray(this.postVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /**
   * How much extra zoom a camera path needs so the edges of the image never enter the frame.
   * Projects the displaced border of the mesh for each sampled camera and returns the largest
   * factor (>= 1) by which the field of view must be tightened.
   */
  requiredZoom(cams, outAspect) {
    if (!this.hasImage) return 1;
    const N = 40;
    const border = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      border.push({ side: 'b', p: this.worldPoint(t, 0) });
      border.push({ side: 't', p: this.worldPoint(t, 1) });
      border.push({ side: 'l', p: this.worldPoint(0, t) });
      border.push({ side: 'r', p: this.worldPoint(1, t) });
    }
    let zoom = 1;
    for (const cam of cams) {
      const { proj, view } = this.viewProj(cam, outAspect);
      const vp = mat4.multiply(proj, view);
      for (const { side, p } of border) {
        const c = mat4.transformPoint(vp, p);
        if (c[3] <= 0.0001) { zoom = Math.max(zoom, 3); continue; }
        const x = c[0] / c[3];
        const y = c[1] / c[3];
        let need = 1;
        if (side === 'l') need = x < -1e-3 ? 1 / -x : 3;
        if (side === 'r') need = x > 1e-3 ? 1 / x : 3;
        if (side === 'b') need = y < -1e-3 ? 1 / -y : 3;
        if (side === 't') need = y > 1e-3 ? 1 / y : 3;
        zoom = Math.max(zoom, need);
      }
    }
    return Math.min(zoom * 1.01, 3);
  }

  readPixelsPNG() {
    return new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
  }
}
