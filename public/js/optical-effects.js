// Original, deterministic image effects. No model, network call, or frame history is needed.
// Draw into the existing scene target so preview, storyboard and export share the same finish.
import { program, OVERSCAN } from './renderer.js';

import { OPTICAL_EFFECTS, opticalEffectById } from './effect-presets.js';
export { OPTICAL_EFFECTS, opticalEffectById } from './effect-presets.js';

// A single oversize triangle has no diagonal seam. UVs match the renderer's upward-facing textures.
const VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform vec2 uResolution;
uniform vec2 uPhotoScale;
uniform float uAspect;
uniform float uT;
uniform float uSeconds;
uniform float uIntensity;
uniform int uEffect;
uniform int uLook;
out vec4 frag;
const float PI = 3.14159265359;

vec2 mirrorUV(vec2 uv) { return 1.0 - abs(mod(uv, 2.0) - 1.0); }
vec2 photoUV(vec2 uv) { return 0.5 + (uv - 0.5) * uPhotoScale; }
vec3 photo(vec2 uv) { return texture(uColor, mirrorUV(photoUV(uv))).rgb; }
float depthAt(vec2 uv) { return texture(uDepth, mirrorUV(photoUV(uv))).r; }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 19.13)); }
mat2 rotate(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float gate(float t) { return smoothstep(0.02, 0.18, t) * (1.0 - smoothstep(0.78, 0.98, t)); }
vec3 splitPhoto(vec2 uv, vec2 shift) { return vec3(photo(uv + shift).r, photo(uv).g, photo(uv - shift).b); }

vec3 hologram(vec2 uv, float amount) {
  float d = depthAt(uv);
  float entry = smoothstep(0.04, 0.30, uT) * 1.15;
  float exitFront = smoothstep(0.70, 0.96, uT) * 1.15;
  float height = uv.y + d * 0.10;
  float mask = smoothstep(height - 0.035, height + 0.035, entry)
             * (1.0 - smoothstep(height - 0.035, height + 0.035, exitFront));
  float row = floor(uv.y * 38.0);
  float flicker = smoothstep(0.96, 1.0, sin(row * 4.1 + uSeconds * 6.0));
  vec2 offset = vec2((hash(vec2(row, floor(uSeconds * 8.0))) - 0.5) * 0.018 * flicker, 0.0);
  vec3 original = photo(uv);
  vec3 c = photo(uv + offset * amount);
  vec2 px = max(vec2(1.5) / uResolution, vec2(0.001));
  float edges = length(vec2(lum(photo(uv + vec2(px.x, 0.0))) - lum(photo(uv - vec2(px.x, 0.0))),
                            lum(photo(uv + vec2(0.0, px.y))) - lum(photo(uv - vec2(0.0, px.y)))));
  float contours = 1.0 - smoothstep(0.02, 0.10, abs(fract(d * 22.0 + uSeconds * 0.08) - 0.5));
  float lines = pow(0.5 + 0.5 * cos((uv.y + d * 0.025) * 620.0 + uSeconds * 2.0), 9.0);
  float grid = pow(0.5 + 0.5 * cos(uv.x * uAspect * 230.0), 20.0) * lines;
  vec3 tint = uLook == 1 ? vec3(0.65, 0.20, 1.0) : uLook == 2 ? vec3(1.0, 0.48, 0.08) : vec3(0.05, 0.8, 1.0);
  vec3 projected = tint * (0.04 + lum(c) * 0.80 + lines * 0.28 + edges * 2.8 + contours * 0.12 + grid * 0.38);
  projected += vec3(0.6, 0.9, 1.0) * pow(edges, 1.4) * 0.65;
  float band = exp(-pow((height - entry) / 0.016, 2.0)) + exp(-pow((height - exitFront) / 0.016, 2.0));
  vec3 result = mix(original, projected, clamp(mask * amount, 0.0, 1.0));
  return result + tint * band * 0.55 * amount;
}

vec3 shatter(vec2 uv, float amount) {
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0) * 5.0;
  vec2 cell = floor(p);
  float first = 100.0, second = 100.0;
  vec2 chosen = vec2(0.0), seed = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 id = cell + vec2(float(x), float(y));
    vec2 center = id + 0.18 + hash2(id) * 0.64;
    float distanceToSeed = dot(p - center, p - center);
    if (distanceToSeed < first) { second = first; first = distanceToSeed; chosen = center; seed = id; }
    else second = min(second, distanceToSeed);
  }
  float opening = sin(PI * smoothstep(0.08, 0.90, uT));
  opening = opening * opening * amount;
  float random = hash(seed + 7.0);
  vec2 centerUV = 0.5 + chosen / (5.0 * vec2(uAspect, 1.0));
  vec2 local = (uv - centerUV) * vec2(uAspect, 1.0);
  local = rotate((random - 0.5) * opening * 0.8) * local;
  local /= max(0.65, 1.0 - opening * 0.24);
  vec2 direction = normalize(chosen + vec2(0.0001));
  vec2 sampled = centerUV + (local - direction * opening * (0.025 + random * 0.075)) / vec2(uAspect, 1.0);
  float edge = sqrt(second) - sqrt(first);
  float aa = max(fwidth(edge), 0.006);
  float gap = opening * (0.018 + random * 0.025);
  float face = smoothstep(gap, gap + aa, edge);
  float rim = (1.0 - smoothstep(gap + aa, gap + aa + 0.025, edge)) * face;
  vec2 chroma = normalize(local + vec2(0.0001)) / vec2(uAspect, 1.0) * opening * (uLook == 0 ? 0.007 : 0.003);
  vec3 c = splitPhoto(sampled, chroma);
  vec3 tint = uLook == 1 ? vec3(0.35, 0.80, 1.0) : uLook == 2 ? vec3(1.0, 0.62, 0.18) : 0.55 + 0.45 * cos(vec3(0.0, 2.1, 4.2) + random * 6.28);
  c *= 1.0 + opening * (random - 0.5) * 0.7;
  c = mix(vec3(0.008, 0.012, 0.024), c, face);
  c += tint * rim * opening * 1.15;
  return mix(photo(uv), c, clamp(amount, 0.0, 1.0));
}

vec3 shockwave(vec2 uv, float amount) {
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float radius = length(p);
  vec2 direction = p / max(radius, 0.0001);
  float progress = smoothstep(0.07, 0.91, uT);
  float front = progress * length(vec2(uAspect * 0.5, 0.5)) * 1.3;
  float x = radius - front;
  float width = 0.038 + front * 0.027;
  float wave = exp(-pow(x / width, 2.0));
  float trail = exp(-pow((x + width * 2.2) / (width * 2.0), 2.0)) * (1.0 - smoothstep(0.0, width, x));
  float bend = (sin(x / width * 2.5) * wave * 0.055 + sin(x * 68.0) * trail * 0.012) * amount;
  vec2 shifted = uv + direction / vec2(uAspect, 1.0) * bend;
  vec3 c = splitPhoto(shifted, direction / vec2(uAspect, 1.0) * wave * 0.008 * amount);
  vec3 tint = uLook == 1 ? vec3(0.1, 0.55, 1.0) : uLook == 2 ? vec3(1.0, 0.24, 0.025) : vec3(0.65, 0.90, 1.0);
  float brightEdge = exp(-pow((x - width * 0.6) / (width * 0.17), 2.0));
  c *= 1.0 - wave * 0.20 * amount;
  c += tint * (brightEdge * (uLook == 0 ? 0.24 : 0.65) + trail * 0.05) * amount;
  return c;
}

vec3 portal(vec2 uv, float amount) {
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float radius = length(p);
  float pulse = sin(PI * smoothstep(0.05, 0.95, uT));
  float ringRadius = 0.34 * pulse;
  float inside = 1.0 - smoothstep(ringRadius * 0.55, ringRadius + 0.06, radius);
  float twist = inside * pulse * (2.4 + sin(uT * PI) * 1.3) * amount;
  vec2 warped = rotate(twist) * p;
  warped *= 1.0 + inside * pulse * 1.8 * amount;
  vec2 q = 0.5 + warped / vec2(uAspect, 1.0);
  vec3 c = splitPhoto(q, normalize(p + vec2(0.0001)) / vec2(uAspect, 1.0) * inside * 0.014 * amount);
  vec3 tint = uLook == 1 ? vec3(1.0, 0.29, 0.035) : uLook == 2 ? vec3(0.28, 0.85, 1.0) : vec3(0.65, 0.15, 1.0);
  float ring = exp(-pow((radius - ringRadius) / 0.008, 2.0));
  float halo = exp(-abs(radius - ringRadius) * 22.0);
  float angle = atan(p.y, p.x);
  float arcs = pow(0.5 + 0.5 * sin(angle * 8.0 + uSeconds * 3.2 + radius * 30.0), 5.0);
  float secondRing = exp(-pow((radius - ringRadius * 1.075) / 0.003, 2.0));
  c *= 1.0 - inside * pulse * 0.3 * amount;
  c += (tint * (halo * 0.30 + ring * (0.8 + arcs * 1.2)) + vec3(0.6, 0.8, 1.0) * secondRing * arcs * 0.5) * amount;
  return c;
}

float smoothNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
float pulse() { return pow(sin(PI * clamp(uT,0.0,1.0)), 1.5); }
vec3 melt(vec2 uv, float amount) {
  float flow = (0.5 + 0.5*sin(uv.x*26.0 + sin(uv.x*53.0)*1.2));
  float depth = depthAt(uv);
  float fall = pulse() * amount * (0.06 + 0.20*flow) * (0.4+0.6*depth);
  vec2 q=uv+vec2(sin(uv.y*15.0+uSeconds*1.5)*0.012*amount,fall);
  vec3 c=splitPhoto(q,vec2(0.003*amount,0));
  float slope=cos(uv.x*26.0 + sin(uv.x*53.0)*1.2);
  c += vec3(1.0,0.88,0.70)*pow(max(0.0,slope),12.0)*fall*0.8;
  return c;
}
vec3 inflate(vec2 uv, float amount) {
  vec2 p=(uv-.5)*vec2(uAspect,1); float r=length(p);
  float radius=.40*pulse();
  float inside=1.0-smoothstep(radius-.025,radius+.025,r);
  float bulge=max(0.0,1.0-pow(r/max(radius,.01),2.0));
  vec2 q=.5+p*(1.0-bulge*.5*amount)/vec2(uAspect,1);
  vec3 c=splitPhoto(q,p*.017*inside*amount);
  float rim=exp(-pow((r-radius)/.007,2.0));
  float shine=exp(-dot(p-vec2(-.12,.17)*pulse(),p-vec2(-.12,.17)*pulse())/.003)*inside;
  return c+vec3(.65,.85,1)*(rim*.28+shine*.32)*amount;
}
vec3 squish(vec2 uv, float amount) {
  float bend=sin(uT*PI*3.0)*pulse()*amount;
  vec2 p=uv-.5;
  float sy=1.0+bend*.34, sx=1.0-bend*.18;
  vec2 q=.5+p*vec2(sx,sy);
  q.x+=sin(p.y*9.0+uSeconds*4.0)*.018*pulse()*amount;
  vec3 c=photo(q);
  return c*(1.0+sin(p.y*PI)*bend*.08);
}
vec3 chromatic(vec2 uv,float amount) {
  vec2 p=uv-.5; float z=1.0-pulse()*.16*amount;
  vec3 c=splitPhoto(.5+p*z,p*.10*pulse()*amount);
  vec3 trail=vec3(0);
  for(int i=1;i<=5;i++) trail+=splitPhoto(.5+p*(z-float(i)*.012*amount),p*.035*amount);
  return mix(c,trail/5.0,.32*min(amount,1.0));
}
vec3 glitch(vec2 uv,float amount) {
  float row=floor(uv.y*28.0), clock=floor(uSeconds*9.0);
  float sliceOn=step(.76,hash(vec2(row,clock)));
  float shift=(hash(vec2(row+3.0,clock))-.5)*.18*sliceOn*amount;
  vec2 q=uv+vec2(shift,0);
  vec3 c=splitPhoto(q,vec2((.002+sliceOn*.013)*amount,0));
  float scan=pow(.5+.5*sin(uv.y*uResolution.y*PI),3.0);
  return c*(1.0-scan*.10*amount)+vec3(.03,.10,.12)*sliceOn*amount;
}
vec3 cascade(vec2 uv,float amount) {
  float columns=floor(uv.x*140.0);
  float phase=hash(vec2(columns,2.0));
  float start=.2+phase*.55, brightest=0.0;
  for(int i=0;i<8;i++) {
    float y=.12+float(i)*.10;
    float value=lum(photo(vec2(uv.x,y)));
    if(value>brightest) {brightest=value;start=y;}
  }
  float below=(1.0-smoothstep(start-.02,start+.02,uv.y));
  float lengthMask=smoothstep(start-.60,start-.12,uv.y);
  float stretched=below*lengthMask*amount*pulse();
  vec2 q=vec2(uv.x,mix(uv.y,start,clamp(stretched*.97,0.0,.99)));
  vec3 c=mix(photo(uv),photo(q),smoothstep(.06,.30,brightest));
  c+=photo(vec2(uv.x,start))*stretched*.15;
  return c;
}
vec3 ink(vec2 uv,float amount) {
  vec2 p=(uv-.5)*vec2(uAspect,1);
  float noise=smoothNoise(uv*11.0)*.6+smoothNoise(uv*39.0)*.25;
  float edge=length(p)+noise*.22;
  float spread=mix(1.5,-.1,pulse());
  float paper=smoothstep(spread-.035,spread+.035,edge)*min(amount,1.0);
  vec2 px=vec2(2.0)/uResolution;
  float outline=abs(lum(photo(uv+px))-lum(photo(uv-px)));
  vec3 grain=vec3(.91,.87,.77)+(hash(floor(uv*uResolution))-.5)*.055;
  vec3 sketch=grain*(1.0-clamp(outline*5.0,0.0,.85));
  vec3 c=mix(photo(uv),sketch,paper);
  float rim=exp(-pow((edge-spread)/.018,2.0));
  return c*(1.0-rim*.65*min(amount,1.0));
}
vec3 neonSketch(vec2 uv,float amount) {
  vec2 px=vec2(1.4)/uResolution;
  float gx=lum(photo(uv+vec2(px.x,0)))-lum(photo(uv-vec2(px.x,0)));
  float gy=lum(photo(uv+vec2(0,px.y)))-lum(photo(uv-vec2(0,px.y)));
  float lines=pow(clamp(length(vec2(gx,gy))*4.5,0.0,1.0),.8);
  vec3 hue=.55+.45*cos(vec3(0,2.1,4.2)+uv.x*3.5+uv.y*2.0+uT*2.0);
  vec3 ink=vec3(.004,.008,.023)+hue*lines*1.6;
  float sweep=exp(-pow((uv.y-fract(uT*1.3))/.025,2.0));
  return mix(photo(uv),ink,clamp(amount,0.0,1.0))+hue*sweep*lines*.6*amount;
}
vec3 kaleido(vec2 uv,float amount) {
  vec2 p=(uv-.5)*vec2(uAspect,1); float r=length(p);
  float angle=atan(p.y,p.x)+uT*.8;
  float wedge=PI/3.0;
  angle=abs(mod(angle,wedge*2.0)-wedge);
  vec2 q=.5+vec2(cos(angle),sin(angle))*r/vec2(uAspect,1);
  q=.5+rotate(uT*.6)*(q-.5);
  return mix(photo(uv),photo(q),clamp(amount,0.0,1.0));
}
vec3 slit(vec2 uv,float amount) {
  float bands=floor(uv.y*32.0)/32.0;
  float delay=sin(bands*7.0-uSeconds*1.7)*.10*pulse()*amount;
  vec2 q=uv+vec2(delay,0);
  float seam=pow(fract(uv.y*32.0),20.0);
  return splitPhoto(q,vec2(.004*amount,0))*(1.0-seam*.18*amount);
}
vec3 fold(vec2 uv,float amount) {
  float sections=8.0, strip=floor(uv.x*sections), local=fract(uv.x*sections)-.5;
  float phase=pulse()*amount;
  float narrow=1.0-phase*.28;
  float slope=mod(strip,2.0)*2.0-1.0;
  vec2 q=vec2((strip+.5+local/narrow)/sections, uv.y+(local*slope*.085)*phase);
  vec3 c=photo(q);
  float shade=1.0-phase*(.18+(local*slope+.5)*.42);
  float crease=exp(-abs(local+.5)*170.0)*phase;
  return c*shade+vec3(.6,.8,1)*crease*.18;
}

void main() {
  float amount = gate(uT) * uIntensity;
  vec3 c = photo(vUv);
  if (amount > 0.00001) {
    if (uEffect == 0) c = hologram(vUv, amount);
    else if (uEffect == 1) c = shatter(vUv, amount);
    else if (uEffect == 2) c = shockwave(vUv, amount);
    else if (uEffect == 3) c = portal(vUv, amount);
    else if (uEffect == 4) c = melt(vUv, amount);
    else if (uEffect == 5) c = inflate(vUv, amount);
    else if (uEffect == 6) c = squish(vUv, amount);
    else if (uEffect == 7) c = chromatic(vUv, amount);
    else if (uEffect == 8) c = glitch(vUv, amount);
    else if (uEffect == 9) c = cascade(vUv, amount);
    else if (uEffect == 10) c = ink(vUv, amount);
    else if (uEffect == 11) c = neonSketch(vUv, amount);
    else if (uEffect == 12) c = kaleido(vUv, amount);
    else if (uEffect == 13) c = slit(vUv, amount);
    else c = fold(vUv, amount);
  }
  frag = vec4(max(c, 0.0), 1.0);
}`;

export class OpticalEffects {
  constructor(renderer) {
    this.r = renderer;
    this.shader = program(renderer.gl, VS, FS);
    this.vao = renderer.gl.createVertexArray();
  }

  draw(id, look, t, intensity, finish, duration = 5) {
    const effect = opticalEffectById(id);
    if (!effect) throw new Error('Choose an optical effect.');
    const r = this.r, gl = r.gl, { p, u } = this.shader;
    const aspect = r.canvas.width / r.canvas.height;
    const progress = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
    r.beginScene();
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, r.colorTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, r.depthTex);
    gl.uniform1i(u.uColor, 0);
    gl.uniform1i(u.uDepth, 1);
    gl.uniform2f(u.uResolution, r.canvas.width, r.canvas.height);
    gl.uniform2f(u.uPhotoScale, Math.min(1, aspect / r.aspect) / OVERSCAN, Math.min(1, r.aspect / aspect) / OVERSCAN);
    gl.uniform1f(u.uAspect, aspect);
    gl.uniform1f(u.uT, progress);
    gl.uniform1f(u.uSeconds, progress * duration);
    gl.uniform1f(u.uIntensity, Number.isFinite(intensity) ? Math.max(0, Math.min(2, intensity)) : 1);
    gl.uniform1i(u.uEffect, OPTICAL_EFFECTS.indexOf(effect));
    gl.uniform1i(u.uLook, Math.max(0, effect.looks.findIndex((item) => item.id === look)));
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    r.finish(finish, progress * duration);
  }
}
