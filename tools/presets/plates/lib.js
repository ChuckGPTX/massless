// Offline plate renderer for the preset factory (tools/presets/render-plates.cjs drives it in headless Chromium).
// three.js scenes are rendered many times with a jittered sub-pixel camera, a jittered area key light, a random
// shadowed sky light and a jittered lens, then averaged in a float target. The average gives anti-aliasing, soft
// area shadows, ambient occlusion from the sky and real depth of field: plates that read as photographs, not
// as real-time 3D. Output is tone mapped (ACES) once at the end.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export { THREE };

// ---------- seeded noise ----------
export function rng(seed = 1) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const sm = (t) => t * t * (3 - 2 * t);
export function noise(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm(x, y, oct = 5, s = 0) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += amp * noise(x * f, y * f, s + i * 17); f *= 2.03; amp *= 0.5; }
  return v;
}
// Tileable value noise (period p) for seamless textures.
function tnoise(x, y, p, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi);
  const m = (v) => ((v % p) + p) % p;
  const a = hash(m(xi), m(yi), s), b = hash(m(xi + 1), m(yi), s), c = hash(m(xi), m(yi + 1), s), d = hash(m(xi + 1), m(yi + 1), s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function tfbm(x, y, p, oct = 5, s = 0) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += amp * tnoise(x * f, y * f, p * f, s + i * 17); f *= 2; amp *= 0.5; }
  return v;
}

// ---------- canvas textures ----------
export function cvs(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function pixelTex(size, fn, { srgb = true, repeat = 1 } = {}) {
  const c = cvs(size), g = c.getContext('2d'), d = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, gg, b, a = 255] = fn(x / size, y / size, x, y);
    const i = (y * size + x) * 4;
    d.data[i] = r; d.data[i + 1] = gg; d.data[i + 2] = b; d.data[i + 3] = a;
  }
  g.putImageData(d, 0, 0);
  return toTex(c, { srgb, repeat });
}
export function toTex(c, { srgb = true, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}
/** Normal map from a height function h(u, v) in 0..1 (tileable if h is). */
export function normalTex(size, h, strength = 2, repeat = 1) {
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = h(x / size, y / size);
  return pixelTex(size, (u, v, x, y) => {
    const l = H[y * size + ((x - 1 + size) % size)], r = H[y * size + ((x + 1) % size)];
    const t = H[((y - 1 + size) % size) * size + x], b = H[((y + 1) % size) * size + x];
    let nx = (l - r) * strength, ny = (t - b) * strength, nz = 1;
    const k = Math.hypot(nx, ny, nz); nx /= k; ny /= k; nz /= k;
    return [(nx * 0.5 + 0.5) * 255, (ny * 0.5 + 0.5) * 255, (nz * 0.5 + 0.5) * 255];
  }, { srgb: false, repeat });
}
const hex = (c) => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export const col = hex;

export const TEX = {
  marble(size = 1024, base = '#f2efe9', vein = '#8f8a84', s = 3) {
    const B = hex(base), V = hex(vein);
    return pixelTex(size, (u, v) => {
      const w = tfbm(u * 4, v * 4, 4, 6, s);
      const vn = Math.abs(Math.sin((u * 3 + v * 1.4 + w * 2.6) * Math.PI * 2));
      const fine = Math.abs(Math.sin((u * 7 - v * 2 + tfbm(u * 8, v * 8, 8, 4, s + 9) * 3) * Math.PI * 2));
      const k = Math.pow(1 - vn, 22) * 0.75 + Math.pow(1 - fine, 40) * 0.35;
      const cloud = (tfbm(u * 6, v * 6, 6, 5, s + 3) - 0.5) * 18;
      return mix(B, V, Math.min(1, k)).map((x) => x + cloud);
    });
  },
  terrazzo(size = 1024, base = '#ece6dc', chips = ['#c9705a', '#e4b04a', '#6f8f86', '#2e3a44', '#f7f3ec', '#b7a99a'], s = 5) {
    const c = cvs(size), g = c.getContext('2d'), r = rng(s);
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    const id = g.getImageData(0, 0, size, size);
    for (let i = 0; i < id.data.length; i += 4) { const n = (r() - 0.5) * 14; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
    g.putImageData(id, 0, 0);
    for (let k = 0; k < 900; k++) {
      const x = r() * size, y = r() * size, rad = (r() ** 2.4) * size * 0.022 + 2;
      g.fillStyle = chips[Math.floor(r() * chips.length)];
      for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
        g.beginPath();
        const n = 5 + Math.floor(r() * 4);
        for (let j = 0; j < n; j++) { const a = (j / n) * Math.PI * 2 + r() * 0.5, rr = rad * (0.6 + r() * 0.6); g.lineTo(x + ox + Math.cos(a) * rr, y + oy + Math.sin(a) * rr); }
        g.fill();
      }
    }
    return toTex(c);
  },
  noiseColor(size, base, dark, scale = 8, amt = 1, s = 1) {
    const B = hex(base), D = hex(dark);
    return pixelTex(size, (u, v) => mix(B, D, Math.min(1, Math.max(0, (tfbm(u * scale, v * scale, scale, 6, s) - 0.35) * 1.6 * amt))));
  },
  concrete(size = 1024, base = '#a9a6a0', s = 7) {
    const B = hex(base);
    return pixelTex(size, (u, v) => {
      const n = tfbm(u * 6, v * 6, 6, 6, s), p = tnoise(u * 180, v * 180, 180, s + 3);
      const pit = p > 0.86 ? -40 : 0;
      return B.map((x) => x + (n - 0.5) * 46 + pit + (tnoise(u * 60, v * 60, 60, s + 5) - 0.5) * 12);
    });
  },
  wood(size = 1024, base = '#b9875a', dark = '#7a5232', s = 11) {
    const B = hex(base), D = hex(dark);
    return pixelTex(size, (u, v) => {
      const w = tfbm(u * 2, v * 8, 2, 5, s) * 3;
      const ring = 0.5 + 0.5 * Math.sin((v * 26 + w * 2.2) * Math.PI);
      const streak = tnoise(u * 3, v * 120, 3, s + 2);
      return mix(B, D, ring * 0.45 + streak * 0.25);
    });
  },
  linen(size = 1024, base = '#e9e1d3', s = 13) {
    const B = hex(base);
    return pixelTex(size, (u, v, x, y) => {
      const wx = Math.sin(x * 1.9) * 0.5 + 0.5, wy = Math.sin(y * 1.9) * 0.5 + 0.5;
      const slub = tnoise(u * 8, v * 160, 8, s) * 0.6 + tnoise(u * 160, v * 8, 160, s + 1) * 0.6;
      return B.map((c) => c + (wx * wy - 0.25) * 18 + (slub - 0.6) * 22);
    });
  },
  tiles(size = 1024, base = '#f4f2ee', grout = '#cfcac1', cols = 4, rows = 8, s = 17) {
    const B = hex(base), G = hex(grout);
    return pixelTex(size, (u, v) => {
      const row = Math.floor(v * rows), off = row % 2 ? 0.5 / cols : 0;
      const fu = ((u + off) * cols) % 1, fv = (v * rows) % 1, gw = 0.025;
      const isG = fu < gw * rows / cols || fv < gw;
      const tile = hash(Math.floor((u + off) * cols), row, s);
      return isG ? G : B.map((c) => c - tile * 10 + (tnoise(u * 40, v * 40, 40, s) - 0.5) * 6);
    });
  },
  tilesNormal(size = 1024, cols = 4, rows = 8, repeat = 1) {
    return normalTex(size, (u, v) => {
      const row = Math.floor(v * rows), off = row % 2 ? 0.5 / cols : 0;
      const fu = ((u + off) * cols) % 1, fv = (v * rows) % 1;
      const e = Math.min(fu * cols / rows, (1 - fu) * cols / rows, fv, 1 - fv);
      return Math.min(1, e / 0.04);
    }, 3, repeat);
  },
  sandNormal(size = 1024, s = 19, repeat = 1) {
    return normalTex(size, (u, v) => tfbm(u * 64, v * 64, 64, 3, s) * 0.6 + Math.sin((u * 18 + tfbm(u * 4, v * 4, 4, 3, s) * 2.5) * Math.PI * 2) * 0.08, 3, repeat);
  },
  rippleNormal(size = 1024, s = 23, repeat = 1) {
    return normalTex(size, (u, v) => tfbm(u * 6, v * 6, 6, 5, s) + 0.25 * Math.sin((Math.hypot(u - 0.5, v - 0.5) * 60) * Math.PI) * Math.exp(-Math.hypot(u - 0.5, v - 0.5) * 6), 6, repeat);
  },
  bumpy(size = 512, s = 29, scale = 16, amp = 2, repeat = 1) {
    return normalTex(size, (u, v) => tfbm(u * scale, v * scale, scale, 5, s), amp, repeat);
  },
};

// Leaf silhouettes for gobo shadows and foreground foliage (alpha textures).
export function leafTexture(kind = 'palm', size = 1024, color = '#2f5a35', s = 3) {
  const c = cvs(size), g = c.getContext('2d'), r = rng(s);
  g.translate(size / 2, size);
  g.fillStyle = color; g.strokeStyle = color;
  if (kind === 'palm') {
    g.lineWidth = size * 0.012;
    g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(size * 0.05, -size * 0.5, -size * 0.02, -size * 0.95); g.stroke();
    for (let i = 0; i < 26; i++) {
      const t = 0.12 + (i / 26) * 0.82, y = -size * t, x = size * 0.05 * Math.sin(t * 2.5);
      for (const side of [-1, 1]) {
        const len = size * (0.42 - Math.abs(t - 0.45) * 0.5) * (0.85 + r() * 0.3);
        const ang = side * (0.9 + t * 0.5) - Math.PI / 2 + (r() - 0.5) * 0.15;
        g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2);
        g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.5, -size * 0.022, len, -size * 0.01 * side); g.quadraticCurveTo(len * 0.5, size * 0.02, 0, 0); g.fill();
        g.restore();
      }
    }
  } else if (kind === 'monstera') {
    g.beginPath();
    const R = size * 0.46;
    g.ellipse(0, -R * 1.05, R * 0.92, R, 0, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 7; i++) for (const side of [-1, 1]) {
      const a = -Math.PI / 2 + side * (0.35 + i * 0.36);
      g.save(); g.translate(0, -R * 1.05); g.rotate(a);
      g.beginPath(); g.moveTo(R * 0.55, 0); g.lineTo(R * 1.1, -R * 0.05); g.lineTo(R * 1.1, R * 0.07); g.closePath(); g.fill();
      g.beginPath(); g.ellipse(R * 0.38, 0, R * 0.07, R * 0.035, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    g.lineWidth = size * 0.012; g.beginPath(); g.moveTo(0, -R * 0.05); g.lineTo(0, -R * 1.9); g.stroke();
    g.globalCompositeOperation = 'source-over';
    g.lineWidth = size * 0.02; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -R * 0.1); g.stroke();
  } else if (kind === 'olive') {
    g.lineWidth = size * 0.006;
    g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(size * 0.1, -size * 0.3, -size * 0.08, -size * 0.6, size * 0.02, -size * 0.95); g.stroke();
    for (let i = 0; i < 40; i++) {
      const t = 0.08 + r() * 0.86, x = size * (0.04 * Math.sin(t * 6)), y = -size * t;
      g.save(); g.translate(x, y); g.rotate((r() - 0.5) * 2.4 + (r() < 0.5 ? Math.PI : 0));
      g.beginPath(); g.ellipse(size * 0.06, 0, size * 0.065, size * 0.014, 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- geometry helpers ----------
export function mat(color, o = {}) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, metalness: 0, ...o });
}
export function mesh(geo, material, o = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = o.cast !== false;
  m.receiveShadow = o.receive !== false;
  if (o.pos) m.position.set(...o.pos);
  if (o.rot) m.rotation.set(...o.rot);
  if (o.scale) m.scale.set(...[].concat(o.scale, o.scale, o.scale).slice(0, 3));
  return m;
}
/** A rounded-edge cylinder (podium) of radius r, height h, edge bevel b. */
export function podium(r, h, b = 0.02, seg = 128) {
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(r - b, 0)];
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, b + Math.sin(a) * b)); }
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, h - b + Math.sin(a) * b)); }
  pts.push(new THREE.Vector2(0, h));
  return new THREE.LatheGeometry(pts, seg);
}
export function roundedBox(w, h, d, r = 0.03, seg = 4) {
  const shape = new THREE.Shape();
  const x = -w / 2 + r, y = -h / 2 + r, W = w - 2 * r, H = h - 2 * r;
  shape.moveTo(x, y - r); shape.lineTo(x + W, y - r); shape.quadraticCurveTo(x + W + r, y - r, x + W + r, y);
  shape.lineTo(x + W + r, y + H); shape.quadraticCurveTo(x + W + r, y + H + r, x + W, y + H + r);
  shape.lineTo(x, y + H + r); shape.quadraticCurveTo(x - r, y + H + r, x - r, y + H); shape.lineTo(x - r, y); shape.quadraticCurveTo(x - r, y - r, x, y - r);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.98, bevelSegments: seg, curveSegments: seg * 2 });
  g.translate(0, 0, -(d - 2 * r) / 2);
  g.computeVertexNormals();
  return g;
}
/** Box UVs scaled to world size so textures keep a constant scale. */
export function worldUV(geo, k = 1) {
  geo.computeBoundingBox();
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (ax >= az) { u = p.getZ(i); v = p.getY(i); } else { u = p.getX(i); v = p.getY(i); }
    uv[i * 2] = u * k; uv[i * 2 + 1] = v * k;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
/** Seamless studio sweep: a floor that curves up into a wall. */
export function sweep(width, depth, height, radius, segs = 64) {
  const pts = [];
  pts.push([depth, 0]);
  pts.push([0, 0]);
  for (let i = 1; i <= 24; i++) { const a = (i / 24) * (Math.PI / 2); pts.push([-Math.sin(a) * radius, radius - Math.cos(a) * radius]); }
  pts.push([-radius, height]);
  const geo = new THREE.BufferGeometry(), pos = [], uv = [], idx = [];
  let acc = 0; const L = [0];
  for (let i = 1; i < pts.length; i++) { acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); L.push(acc); }
  for (let i = 0; i < pts.length; i++) for (let j = 0; j <= segs; j++) {
    const x = -width / 2 + (j / segs) * width;
    pos.push(x, pts[i][1], pts[i][0]); uv.push(x, L[i]);
  }
  for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * (segs + 1) + j, b = a + 1, c = a + segs + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}
/** A gradient sky dome (unlit). */
export function skyDome(top, mid, bottom, r = 200, sun = null) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(top) }, mid: { value: new THREE.Color(mid) }, bot: { value: new THREE.Color(bottom) }, sun: { value: new THREE.Vector3(...(sun?.dir || [0, -1, 0])).normalize() }, sunCol: { value: new THREE.Color(sun?.color || '#000000') } },
    vertexShader: 'varying vec3 vd; void main(){ vd = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top, mid, bot, sun, sunCol; varying vec3 vd; void main(){ float y = vd.y; vec3 c = y > 0. ? mix(mid, top, pow(clamp(y,0.,1.),0.55)) : mix(mid, bot, pow(clamp(-y*3.,0.,1.),0.7)); float s = max(dot(normalize(vd), sun), 0.); c += sunCol * (pow(s, 600.) * 8. + pow(s, 12.) * 0.5); gl_FragColor = vec4(c, 1.); }',
  });
  const d = new THREE.Mesh(new THREE.SphereGeometry(r, 64, 32), m);
  d.castShadow = d.receiveShadow = false;
  return d;
}
export function heightPlane(w, d, segX, segZ, hfn, uvScale = 1) {
  const g = new THREE.PlaneGeometry(w, d, segX, segZ);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, hfn(p.getX(i), p.getZ(i)));
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * uvScale, p.getZ(i) * uvScale);
  g.computeVertexNormals();
  return g;
}
export function rock(r, s, squash = 0.6) {
  const g = new THREE.IcosahedronGeometry(r, 5), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const k = 1 + (fbm(n.x * 1.6 + s, n.z * 1.6 + n.y, 4, s) - 0.5) * 0.45;
    v.copy(n).multiplyScalar(r * k); v.y *= squash;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// ---------- the accumulation renderer ----------
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
function sampleDisk(r) { const a = r() * Math.PI * 2, d = Math.sqrt(r()); return [Math.cos(a) * d, Math.sin(a) * d]; }

/**
 * def: { build(ctx) -> { scene, camera, key, sky, focus, aperture, envIntensity, exposure, background, alpha }, frames }
 * Returns the canvas holding the final image and the THREE objects (for projecting metadata).
 */
export async function render(def, { W, H, frames = 48, canvas, onFrame, pass = 'white' }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const s = await def.build({ THREE, W, H, envTex: room, renderer, pmrem, pass });
  const { scene, camera } = s;
  if (!s.noEnv) scene.environment = s.env || room;
  scene.environmentIntensity = s.envIntensity ?? 0.45;
  if (s.background !== undefined) scene.background = s.background === null ? null : new THREE.Color(s.background);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  // key: directional with area-light jitter; sky: a shadowed hemisphere sample per frame (ambient occlusion)
  const key = new THREE.DirectionalLight(s.key?.color || '#fff3e6', s.key?.intensity ?? 3);
  const sky = new THREE.DirectionalLight(s.sky?.color || '#dfe8ff', (s.sky?.intensity ?? 1.2) * 0.75);
  const fill = new THREE.HemisphereLight(s.sky?.color || '#dfe8ff', s.ground || '#8a7f73', s.fill ?? 0.15);
  for (const l of [key, sky]) {
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    const b = s.shadowBox || 6;
    Object.assign(l.shadow.camera, { left: -b, right: b, top: b, bottom: -b, near: 0.1, far: 60 });
    l.shadow.bias = -0.0004; l.shadow.normalBias = 0.02; l.shadow.radius = 2;
    l.target.position.set(...(s.target || [0, 0.5, 0]));
    scene.add(l, l.target);
  }
  if (s.key === null) key.visible = false;
  scene.add(fill);
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
  const acc = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { map: { value: rt.texture }, k: { value: 1 / frames } },
    vertexShader: QUAD_VS, fragmentShader: 'uniform sampler2D map; uniform float k; varying vec2 vUv; void main(){ gl_FragColor = texture2D(map, vUv) * k; }',
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor, depthTest: false, depthWrite: false, transparent: true,
  }));
  const qs = new THREE.Scene(); qs.add(quad);
  const qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const r = rng(s.seed || 7);
  const keyBase = new THREE.Vector3(...(s.key?.pos || [-4, 6, 4]));
  const keyR = s.key?.radius ?? 0.8;
  const camPos = camera.position.clone();
  const focus = new THREE.Vector3(...(s.focus || s.target || [0, 0.5, 0]));
  const lookAt = new THREE.Vector3(...(s.target || [0, 0.5, 0]));
  const right = new THREE.Vector3(), up = new THREE.Vector3();
  renderer.setRenderTarget(acc); renderer.setClearColor(0x000000, 0); renderer.clear();
  for (let i = 0; i < frames; i++) {
    // lens: jitter on the aperture disk, re-aim at the focus point (real depth of field)
    const [lx, ly] = sampleDisk(r);
    camera.position.copy(camPos); camera.lookAt(lookAt); camera.updateMatrixWorld();
    right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
    const ap = s.aperture || 0;
    camera.position.addScaledVector(right, lx * ap).addScaledVector(up, ly * ap);
    // keep the look direction's change confined to the focus plane
    const dir = lookAt.clone().sub(camPos).normalize();
    const fd = focus.clone().sub(camPos).dot(dir);
    camera.lookAt(camPos.clone().addScaledVector(dir, fd));
    camera.setViewOffset(W, H, r() - 0.5, r() - 0.5, W, H);
    camera.updateMatrixWorld();
    const [kx, ky] = sampleDisk(r);
    key.position.copy(keyBase).add(new THREE.Vector3(kx * keyR, ky * keyR * 0.5, -kx * keyR * 0.5));
    // cosine-weighted direction on the upper hemisphere, biased by s.skyBias toward the open side
    const u1 = r(), u2 = r(), rr = Math.sqrt(u1), th = 2 * Math.PI * u2;
    const sd = new THREE.Vector3(rr * Math.cos(th), Math.sqrt(1 - u1), rr * Math.sin(th));
    if (s.skyBias) sd.add(new THREE.Vector3(...s.skyBias)).normalize();
    if (sd.y < 0.08) sd.y = 0.08;
    sky.position.copy(sd.normalize().multiplyScalar(25)).add(sky.target.position);
    s.perFrame?.(i, r);
    renderer.setRenderTarget(rt); renderer.setClearColor(s.clear ?? 0x000000, s.alpha ? 0 : 1); renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(acc); renderer.autoClear = false; renderer.render(qs, qc); renderer.autoClear = true;
    if (onFrame && i % 4 === 0) await onFrame(i);
  }
  camera.position.copy(camPos); camera.clearViewOffset(); camera.lookAt(lookAt); camera.updateMatrixWorld();
  // tone map once: ACES fitted, exposure, sRGB; straight alpha for cutouts
  const out = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { map: { value: acc.texture }, exposure: { value: (s.exposure ?? 1) * 0.86 }, alphaOut: { value: s.alpha ? 1 : 0 }, sat: { value: s.saturation ?? 1 } },
    vertexShader: QUAD_VS,
    fragmentShader: `uniform sampler2D map; uniform float exposure, alphaOut, sat; varying vec2 vUv;
      vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.); }
      vec3 srgb(vec3 c){ return mix(c*12.92, 1.055*pow(c, vec3(1./2.4))-0.055, step(0.0031308, c)); }
      void main(){ vec4 a = texture2D(map, vUv); vec3 c = a.rgb; float al = a.a;
        if (alphaOut > 0.5) c = al > 0.0001 ? c / al : vec3(0.);
        c = aces(c * exposure); float l = dot(c, vec3(0.2126,0.7152,0.0722)); c = mix(vec3(l), c, sat);
        gl_FragColor = vec4(srgb(c), alphaOut > 0.5 ? al : 1.); }`,
    depthTest: false, depthWrite: false,
  }));
  const os = new THREE.Scene(); os.add(out);
  renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(os, qc);
  return { renderer, scene, camera, s, keyBase };
}

/** Screen position (0..1, y down) of a world point. */
export function project(camera, p) {
  const v = new THREE.Vector3(...p).project(camera);
  return [v.x * 0.5 + 0.5, 0.5 - v.y * 0.5];
}
