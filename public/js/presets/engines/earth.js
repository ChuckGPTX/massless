// Earth zoom out: from the visitor's photo up through rooftops, the city, the coast and the clouds to the whole
// planet. Each layer is a picture of the next scale, nested in the centre of the one above with a soft edge;
// the camera's height moves on a log scale so the speed feels constant, then settles on the globe.
//
// With a real place (the "where" field, looked up only when the visitor presses Fly there), the first steps stay
// on the illustrated rooftops, then cross-fade into real satellite views centred on that place: square mosaics at
// web-map zooms 13, 11, 9, 7 and 5 (four times wider each), and a globe drawn from zoom-3 imagery, turned so the
// place faces the camera. The imagery is EOxCloudless 2016 by EOX (CC BY 4.0), fetched through this site's
// /earth-tiles/ route; the place comes from /api/place (OpenStreetMap). See src/place.js. If either is missing,
// the clip falls back to the illustrated layers and says why.
import { loadImage, canvas, cover, clamp, ease, span, smooth, setFont, FONT, rng } from '../common.js';

export const kind = 'video';
const R = 5.2; // how much smaller each illustrated layer sits inside the next
const LN_R = Math.log(R);
const LEVELS = 5;
const REAL_Z = [13, 11, 9, 7, 5]; // city to continent; real imagery is about 10 m a pixel, so nothing closer
const GLOBE_Z = 3;
const SIDE = 768; // each real view is a 768 px square (16 tiles at most) centred on the place
const MAX_LAT = 80; // the square map views stop near the poles
const GLOBE_R = 0.335; // globe radius as a share of the frame's short side (as on the illustrated globe)
const EARTH_R = 6371000, MPP0 = 156543.03392804097; // metres per pixel at zoom 0 on the equator
export const CREDIT = ['Satellite views: EOxCloudless 2016 by EOX IT Services GmbH', 'Contains modified Copernicus Sentinel data 2016 (CC BY 4.0) · Place: © OpenStreetMap contributors'];
/** What the visitor may read in the status line (checked against the deny-list in tests). */
export const NOTES = {
  finding: 'Finding the place…',
  gathering: 'Gathering the views from above…',
  found: (full) => `Flying out over ${full}.`,
  notFound: (q) => `We couldn’t find “${q}”, so this uses the standard views. Try a city, landmark or street address.`,
  polar: 'That place is too close to a pole for the satellite views, so this uses the standard views.',
  offline: 'We couldn’t reach the satellite views just now, so this uses the standard views. Check your connection and press Fly there again.',
};

export async function prepare(spec, io, params = {}) {
  const [photo, ...plates] = await Promise.all([io.image('photo'), ...Array.from({ length: LEVELS }, (_, i) => loadImage(`/presets/plates/earth-${i + 1}.webp`))]);
  const ctx = { layers: [photo, ...plates], cache: new Map(), clouds: cloudSprites(), real: null, note: '', defaultLabel: spec.inputs.find((i) => i.key === 'place')?.default ?? '' };
  const q = String(params.where || '').trim();
  if (!q) return ctx;
  try {
    io.status?.(NOTES.finding);
    const place = await findPlace(q);
    if (Math.abs(place.lat) > MAX_LAT) { ctx.note = NOTES.polar; return ctx; }
    io.status?.(NOTES.gathering);
    ctx.real = await realViews(place, (f) => io.status?.(`${NOTES.gathering} ${Math.round(f * 100)}%`));
    ctx.note = NOTES.found(place.full || place.name);
  } catch (e) {
    ctx.real = null;
    ctx.note = e.notFound ? NOTES.notFound(q) : e.visitorMessage || NOTES.offline;
  }
  return ctx;
}

/** A real place makes a longer climb (more distance to cover), so the clip runs a second longer. */
export const duration = (ctx, params, o) => (ctx?.real ? o.duration + 1 : o.duration);

// ---------- place and imagery ----------
const places = new Map(); // words -> Promise<{ name, full, lat, lon }> (this page only; the site caches too)
async function findPlace(q) {
  const key = q.toLowerCase();
  if (!places.has(key)) {
    places.set(key, (async () => {
      let r;
      try { r = await fetch(`/api/place?q=${encodeURIComponent(q)}`); } catch { throw new Error('offline'); }
      const body = await r.json().catch(() => ({}));
      if (r.status === 404) throw Object.assign(new Error('not found'), { notFound: true });
      if (!r.ok) throw Object.assign(new Error('lookup failed'), { visitorMessage: r.status === 429 || r.status === 503 ? `${body.error || 'Place search is busy.'} This uses the standard views for now.` : '' });
      if (!Number.isFinite(body.lat) || !Number.isFinite(body.lon)) throw new Error('bad answer');
      return body;
    })());
    places.get(key).catch(() => places.delete(key));
  }
  return places.get(key);
}

const tileCache = new Map(); // "z/x/y" -> Promise<ImageBitmap | null>
function tile(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (!tileCache.has(k)) {
    const p = fetch(`/earth-tiles/${k}.jpg`).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? createImageBitmap(b) : null)).catch(() => null);
    tileCache.set(k, p);
    p.then((im) => { if (!im) tileCache.delete(k); });
  }
  return tileCache.get(k);
}
/** Fetch many tiles, six at a time; returns Map("z/x/y" -> bitmap) and how many failed. */
async function fetchTiles(list, onProgress) {
  const out = new Map();
  let next = 0, done = 0, failed = 0;
  const worker = async () => {
    while (next < list.length) {
      const [z, x, y] = list[next++];
      const im = await tile(z, x, y);
      if (im) out.set(`${z}/${x}/${y}`, im); else failed++;
      onProgress?.(++done / list.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { tiles: out, failed };
}
/** Web-mercator world pixel of a place at zoom z. */
export function worldPx(lat, lon, z) {
  const n = 256 * 2 ** z, phi = (clamp(lat, -85.05, 85.05) * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n];
}
/** The tiles a SIDE x SIDE square centred on the place needs at zoom z: [[z, x, y, dx, dy]]. */
export function squareTiles(lat, lon, z) {
  const [X, Y] = worldPx(lat, lon, z), n = 2 ** z, L = X - SIDE / 2, T = Y - SIDE / 2, out = [];
  for (let ty = Math.floor(T / 256); ty <= Math.floor((T + SIDE - 1) / 256); ty++)
    for (let tx = Math.floor(L / 256); tx <= Math.floor((L + SIDE - 1) / 256); tx++)
      if (ty >= 0 && ty < n) out.push([z, ((tx % n) + n) % n, ty, tx * 256 - L, ty * 256 - T]);
  return out;
}
/** The zoom-3 tiles the globe needs when turned to face (lat, lon). */
function globeTiles(lat, lon) {
  const need = new Set(), n = 2 ** GLOBE_Z;
  for (let j = 0; j <= 96; j++) for (let i = 0; i <= 96; i++) {
    const x = i / 48 - 1, y = 1 - j / 48;
    if (x * x + y * y > 1) continue;
    const [la, lo] = unproject(x, y, lat, lon);
    if (Math.abs(la) > 85) continue;
    const [X, Y] = worldPx(la, lo, GLOBE_Z);
    need.add(`${Math.floor(X / 256) % n}/${Math.min(n - 1, Math.floor(Y / 256))}`);
  }
  return [...need].map((s) => [GLOBE_Z, ...s.split('/').map(Number)]);
}
/** Orthographic projection, inverse: a point on the unit disc (y up) to latitude and longitude in degrees. */
export function unproject(x, y, lat0, lon0) {
  const z = Math.sqrt(Math.max(0, 1 - x * x - y * y)), p0 = (lat0 * Math.PI) / 180;
  const lat = Math.asin(clamp(z * Math.sin(p0) + y * Math.cos(p0), -1, 1));
  const lon = (lon0 * Math.PI) / 180 + Math.atan2(x, z * Math.cos(p0) - y * Math.sin(p0));
  return [(lat * 180) / Math.PI, ((((lon * 180) / Math.PI + 540) % 360) + 360) % 360 - 180];
}

const realCache = new Map(); // "lat,lon" -> Promise<real>
function realViews(place, onProgress) {
  const key = `${place.lat},${place.lon}`;
  if (!realCache.has(key)) {
    const p = buildReal(place, onProgress);
    realCache.set(key, p);
    p.catch(() => realCache.delete(key));
  }
  return realCache.get(key);
}
async function buildReal(place, onProgress) {
  const views = REAL_Z.map((z) => ({ z, list: squareTiles(place.lat, place.lon, z) }));
  const globeList = globeTiles(place.lat, place.lon);
  const all = [...views.flatMap((v) => v.list.map(([z, x, y]) => [z, x, y])), ...globeList];
  const { tiles, failed } = await fetchTiles(all, onProgress);
  if (failed > all.length * 0.25) throw new Error('offline');
  const mosaics = views.map(({ z, list }) => {
    const c = canvas(SIDE, SIDE), g = c.getContext('2d');
    g.fillStyle = '#d9e2e8'; g.fillRect(0, 0, SIDE, SIDE); // beyond the map's edge near the poles: ice
    for (const [tz, x, y, dx, dy] of list) {
      const im = tiles.get(`${tz}/${x}/${y}`);
      if (im) g.drawImage(im, Math.round(dx), Math.round(dy), 256, 256);
      else { g.fillStyle = '#1d3346'; g.fillRect(Math.round(dx), Math.round(dy), 256, 256); }
    }
    return { z, c };
  });
  // the globe's texture: a zoom-3 world map, filled where it was not needed
  const n = 256 * 2 ** GLOBE_Z, tex = canvas(n, n), tg = tex.getContext('2d', { willReadFrequently: true });
  tg.fillStyle = '#0d2236'; tg.fillRect(0, 0, n, n);
  for (const [z, x, y] of globeList) { const im = tiles.get(`${z}/${x}/${y}`); if (im) tg.drawImage(im, x * 256, y * 256); }
  return { place, mosaics, texture: tg.getImageData(0, 0, n, n), globes: new Map() };
}

// ---------- layers ----------
/** The layer stack for a frame of w x h: [{ key, src | globe, pos (log size), feather, alpha(Z) }] and the end height. */
function stack(ctx, w, h) {
  const plates = ctx.layers.map((src, i) => ({ key: `p${i}`, src, pos: i * LN_R, feather: i < LEVELS }));
  if (!ctx.real) return { list: plates, end: LEVELS * LN_R, cross: null };
  const { place, mosaics } = ctx.real;
  const cos = Math.cos((place.lat * Math.PI) / 180), long = Math.max(w, h);
  const base = 2 * LN_R; // the first real view sits where the illustrated city did
  const ground = (z) => (MPP0 * cos * SIDE) / 2 ** z / long; // metres per frame pixel, layer at full size
  const real = mosaics.map((m) => ({ key: `z${m.z}`, src: m.c, pos: base + Math.log(ground(m.z) / ground(REAL_Z[0])), feather: true }));
  const globePos = real[real.length - 1].pos + Math.log(EARTH_R / (GLOBE_R * Math.min(w, h)) / ground(REAL_Z[REAL_Z.length - 1]));
  // cross-fade from the illustrated rooftops and city into the real place while the rooftops recede
  const cross = [0.9 * LN_R, 1.75 * LN_R];
  const fade = (Z) => smooth(span(Z, cross[0], cross[1]));
  const list = [
    plates[0],
    { ...plates[1], alpha: (Z) => 1 - fade(Z) },
    { ...real[0], alpha: fade }, // drawn over the illustrated city at the same size
    { ...plates[2], alpha: (Z) => (fade(Z) >= 1 ? 0 : 1) },
    ...real.slice(1),
    { key: 'globe', globe: true, pos: globePos, feather: false },
  ];
  return { list, end: globePos, cross };
}

/** A layer cover-fitted to the frame's aspect, with feathered edges (the photo gets a soft vignette edge). */
function feathered(ctx, L, w, h) {
  const k = Math.min(1, (L.globe ? 1920 : 900) / Math.max(w, h));
  const W = Math.round(w * k), H = Math.round(h * k), key = `${L.key}|${W}x${H}`;
  if (ctx.cache.has(key)) return ctx.cache.get(key);
  if (L.globe) { const c = globe(ctx.real, W, H); ctx.cache.set(key, c); return c; }
  const c = canvas(W, H), g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  cover(g, L.src, 0, 0, W, H);
  if (L.feather) {
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
/** The whole Earth in space, turned so the place faces the camera, the same size as the illustrated globe. */
function globe(real, W, H) {
  const c = canvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const r = rng(11), u = Math.min(W, H);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${(0.15 + r() * 0.6).toFixed(2)})`; const s = r() < 0.08 ? 1.6 : 0.9; g.fillRect(r() * W, r() * H, s * (u / 540), s * (u / 540)); }
  const cx = W / 2, cy = H / 2, rad = GLOBE_R * u;
  const glow = g.createRadialGradient(cx, cy, rad * 0.96, cx, cy, rad * 1.16);
  glow.addColorStop(0, 'rgba(120,175,255,0.55)'); glow.addColorStop(0.35, 'rgba(80,140,255,0.18)'); glow.addColorStop(1, 'rgba(60,120,255,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  const x0 = Math.max(0, Math.floor(cx - rad - 1)), y0 = Math.max(0, Math.floor(cy - rad - 1)), S = Math.ceil(rad * 2 + 2);
  const img = g.getImageData(x0, y0, Math.min(S, W - x0), Math.min(S, H - y0)), d = img.data;
  const tex = real.texture, T = tex.width, td = tex.data, { lat, lon } = real.place;
  const L = [-0.45, 0.5, 0.74]; // light from the upper left, mostly from the camera
  for (let j = 0; j < img.height; j++) for (let i = 0; i < img.width; i++) {
    const x = (x0 + i + 0.5 - cx) / rad, y = (cy - (y0 + j + 0.5)) / rad, rho = Math.hypot(x, y);
    if (rho > 1) continue;
    const z = Math.sqrt(1 - rho * rho);
    const [la, lo] = unproject(x, y, lat, lon);
    let cr = 222, cg = 230, cb = 236; // ice beyond the map's edge
    if (Math.abs(la) <= 85.05) {
      const [X, Y] = worldPx(la, lo, GLOBE_Z), o = ((Math.min(T - 1, Y | 0) * T) + (Math.min(T - 1, X | 0))) * 4;
      cr = td[o]; cg = td[o + 1]; cb = td[o + 2];
    }
    const light = 0.38 + 0.8 * Math.max(0, x * L[0] + y * L[1] + z * L[2]);
    const haze = Math.pow(1 - z, 2.2) * 0.75; // the atmosphere thickens toward the edge
    const edge = clamp((1 - rho) * rad * 1.2); // smooth rim
    const p = (j * img.width + i) * 4;
    const mixc = (v, a) => (v * light) * (1 - haze) + a * haze;
    d[p] = d[p] * (1 - edge) + mixc(cr, 140) * edge;
    d[p + 1] = d[p + 1] * (1 - edge) + mixc(cg, 185) * edge;
    d[p + 2] = d[p + 2] * (1 - edge) + mixc(cb, 255) * edge;
  }
  g.putImageData(img, x0, y0);
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
  const { list, end, cross } = stack(ctx, w, h);
  const z = height(T, D); // 0..5, drives the roll, clouds, smear and pin as before
  const Z = (z / LEVELS) * end; // the camera's log height in layer sizes
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  g.imageSmoothingQuality = 'high';
  // a slow roll as we rise, settling at the end
  const roll = Math.sin(clamp(z / LEVELS) * Math.PI) * 0.12;
  g.translate(w / 2, h / 2); g.rotate(roll); g.translate(-w / 2, -h / 2);
  // the outermost layer that still covers the frame (and any layer the same size under it), then every inner one
  let outer = list.length - 1;
  for (let i = 0; i < list.length; i++) if (Math.exp(list[i].pos - Z) >= 1.35) { outer = i; break; }
  while (outer + 1 < list.length && list[outer + 1].pos === list[outer].pos) outer++;
  for (let i = outer; i >= 0; i--) {
    const L = list[i], s = Math.exp(L.pos - Z);
    if (s < 0.02) break;
    const a = L.alpha ? L.alpha(Z) : 1;
    if (a <= 0.001) continue;
    const img = feathered(ctx, L, w, h);
    const dw = w * s * 1.25, dh = h * s * 1.25; // a little extra so rotation never shows the edge
    g.globalAlpha = a;
    g.drawImage(img, w / 2 - dw / 2, h / 2 - dh / 2, dw, dh);
  }
  g.globalAlpha = 1;
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
  let place = String(params.place ?? '').trim();
  if (ctx.real && place === ctx.defaultLabel) place = ctx.real.place.name;
  pin(g, w, h, T, D, z, place, !!ctx.real);
  // the imagery's licence asks for credit wherever it is shown: on the clip itself, from the cross-fade on
  if (ctx.real) credit(g, w, h, smooth(span(Z, cross[0], cross[1])));
}

function credit(g, w, h, a) {
  if (a <= 0.01) return;
  const u = Math.min(w, h), size = Math.max(9, u * 0.017), pad = u * 0.03;
  g.save();
  g.globalAlpha = a * 0.8;
  setFont(g, FONT.sans, size);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = size * 0.4;
  g.fillStyle = '#fff';
  const maxW = w - pad * 2;
  CREDIT.forEach((line, i) => g.fillText(line, pad, h - pad - (CREDIT.length - 1 - i) * size * 1.35, maxW));
  g.restore();
}

function pin(g, w, h, T, D, z, place, credited = false) {
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
  if (end > 0 && place) { g.save(); g.globalAlpha = end; label(g, place, w / 2, h * (h / w > 1.5 ? 0.78 : credited ? 0.82 : 0.86), u, 'top'); g.restore(); }
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
