// The talking ad's presenter, drawn as an illustration: the made-up presenter's picture becomes flat colour bands
// with ink lines (so it never reads as a real person), its own closed mouth is painted out, and a drawn mouth,
// blinks and eyelids go on top every frame.
import { canvas, clamp } from './common.js';

const INK = [41, 26, 23];
const cache = new Map();

/** Box blur of a planar channel (radius r), edges clamped. */
function box(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[y * w + clamp(k, 0, w - 1)];
    for (let x = 0; x < w; x++) { tmp[y * w + x] = s / n; s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[clamp(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / n; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
  }
  return out;
}

/** The illustrated presenter, cached per picture: { base, lip }. meta: { mouth: [x, y], mw, eye: [[x, y], …], ew }. */
export function illustrate(img, meta, key = img.src || '') {
  if (key && cache.has(key)) return cache.get(key);
  const W = img.width, H = img.height, w = W >> 1, h = H >> 1, N = w * h;
  const sc = canvas(w, h), sg = sc.getContext('2d', { willReadFrequently: true });
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(img, 0, 0, w, h);
  const id = sg.getImageData(0, 0, w, h), px = id.data;
  const ch = [0, 1, 2].map((c) => { const a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = px[i * 4 + c] / 255; return a; });
  const cx = meta.mouth[0] * w, cy = meta.mouth[1] * h, MW = meta.mw * w;
  const mean = (x0, y0, x1, y1) => { const s = [0, 0, 0]; let n = 0; for (let y = Math.max(0, y0 | 0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0 | 0); x < Math.min(w, x1); x++) { for (let c = 0; c < 3; c++) s[c] += ch[c][y * w + x]; n++; } return s.map((v) => v / Math.max(1, n)); };
  // the lips' own colour, a little richer, before they are painted out
  const lip0 = mean(cx - MW * 0.22, cy - MW * 0.03, cx + MW * 0.22, cy + MW * 0.07);
  const lg = (lip0[0] + lip0[1] + lip0[2]) / 3;
  const lip = lip0.map((v, i) => clamp((lg + (v - lg) * 1.3) * (i === 0 ? 0.98 : 0.88)) * 255);
  // paint the closed mouth out: fill an ellipse from its edge inwards (a smooth patch of skin)
  const rx = MW * 0.62, ry = MW * 0.27;
  const x0 = Math.max(1, Math.floor(cx - rx - 2)), x1 = Math.min(w - 1, Math.ceil(cx + rx + 3)), y0 = Math.max(1, Math.floor(cy - ry - 2)), y1 = Math.min(h - 1, Math.ceil(cy + ry + 3));
  const inside = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1) inside.push(y * w + x);
  const ring = mean(x0, y0, x1, y0 + 2);
  for (const i of inside) for (let c = 0; c < 3; c++) ch[c][i] = ring[c];
  for (let it = 0; it < 400; it++) for (const i of inside) for (let c = 0; c < 3; c++) { const a = ch[c]; a[i] = (a[i - 1] + a[i + 1] + a[i - w] + a[i + w]) / 4; }
  // smooth while keeping edges (a small bilateral filter, twice)
  const LUT = new Float32Array(512);
  for (let i = 0; i < 512; i++) LUT[i] = Math.exp(-(i / 4000) / (2 * 0.07 * 0.07));
  for (let pass = 0; pass < 2; pass++) {
    const [R, G, B] = ch, oR = new Float32Array(N), oG = new Float32Array(N), oB = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, r0 = R[i], g0 = G[i], b0 = B[i];
      let sr = 0, sgc = 0, sb = 0, sw = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = clamp(y + dy, 0, h - 1) * w;
        for (let dx = -2; dx <= 2; dx++) {
          const j = yy + clamp(x + dx, 0, w - 1), dr = R[j] - r0, dg = G[j] - g0, db = B[j] - b0;
          const k = ((dr * dr + dg * dg + db * db) * 4000) | 0;
          if (k >= 512) continue;
          const wt = LUT[k] * (dx * dx + dy * dy <= 2 ? 1 : dx * dx + dy * dy <= 5 ? 0.6 : 0.3);
          sr += R[j] * wt; sgc += G[j] * wt; sb += B[j] * wt; sw += wt;
        }
      }
      oR[i] = sr / sw; oG[i] = sgc / sw; oB[i] = sb / sw;
    }
    ch[0] = oR; ch[1] = oG; ch[2] = oB;
  }
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) px[i * 4 + c] = ch[c][i] * 255;
  sg.putImageData(id, 0, 0);
  // ink lines where the brightness changes (difference of two blurs)
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = 0.299 * ch[0][i] + 0.587 * ch[1][i] + 0.114 * ch[2][i];
  const g1 = box(box(L, w, h, 1), w, h, 1), g2 = box(box(L, w, h, 2), w, h, 2);
  const lc = canvas(w, h), lgx = lc.getContext('2d'), ld = lgx.createImageData(w, h);
  for (let i = 0; i < N; i++) { const v = clamp((g2[i] - g1[i] - 0.006) / 0.02); ld.data[i * 4] = INK[0]; ld.data[i * 4 + 1] = INK[1]; ld.data[i * 4 + 2] = INK[2]; ld.data[i * 4 + 3] = v * 0.85 * 255; }
  lgx.putImageData(ld, 0, 0);
  // flat colour bands at full size: soft steps of brightness, the colour kept and a touch richer
  const base = canvas(W, H), bg = base.getContext('2d', { willReadFrequently: true });
  bg.imageSmoothingQuality = 'high';
  bg.drawImage(sc, 0, 0, W, H);
  const fd = bg.getImageData(0, 0, W, H), f = fd.data, BANDS = 4;
  for (let i = 0; i < f.length; i += 4) {
    const r = f[i] / 255, g = f[i + 1] / 255, b = f[i + 2] / 255, l = 0.299 * r + 0.587 * g + 0.114 * b + 1e-3;
    const q = l * BANDS, fl = Math.floor(q), step = clamp((q - fl - 0.5) / 0.08 + 0.5);
    const k = Math.min((0.2 + 0.74 * ((fl + step) / BANDS)) / l, 1.3);
    const R = r * k, G = g * k, B = b * k, m = 0.299 * R + 0.587 * G + 0.114 * B;
    f[i] = clamp(m + (R - m) * 1.18) * 255; f[i + 1] = clamp(m + (G - m) * 1.18) * 255; f[i + 2] = clamp(m + (B - m) * 1.18) * 255;
  }
  bg.putImageData(fd, 0, 0);
  bg.drawImage(lc, 0, 0, W, H);
  const out = { base, lip };
  if (key) cache.set(key, out);
  return out;
}

const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const lerp = (a, b, t) => a + (b - a) * t;
/** A curve from L to R whose middle sits at y = mid; round 0 is a gentle arc, 1 a full half-ellipse. */
function arc(g, L, R, mid, round, move = true) {
  const t = 0.25 * (1 - round), cy1 = L[1] + (4 / 3) * (mid - L[1]), cy2 = R[1] + (4 / 3) * (mid - R[1]);
  if (move) g.moveTo(L[0], L[1]);
  g.bezierCurveTo(lerp(L[0], R[0], t), cy1, lerp(R[0], L[0], t), cy2, R[0], R[1]);
}

/**
 * Draw the mouth at (x, y) in the presenter picture, mw wide. m: { open, wide, round, teeth, tuck, press } with
 * open already scaled by the voice's loudness.
 */
export function drawMouth(g, x, y, mw, m, look) {
  const r = clamp(m.round), press = clamp(m.press), tuck = clamp(m.tuck);
  const hw = mw * 0.4 * clamp(m.wide, 0.5, 1.3);
  const gap = mw * 0.3 * clamp(m.open, 0, 1.15);
  const up = gap * 0.16, dn = gap - up;
  const tu = mw * 0.06 * (1 + 0.35 * r) * (1 - 0.4 * press);
  const tl = mw * 0.085 * (1 + 0.3 * r) * (1 - 0.35 * press) * (1 + 0.3 * tuck);
  const cyC = y - mw * 0.025 * (1 - r) + gap * 0.12;
  const L = [x - hw, cyC], R = [x + hw, cyC];
  const iw = hw * (1 - 0.1 * (1 + r)), IL = [x - iw, cyC], IR = [x + iw, cyC];
  const ro = 0.2 + 0.7 * r;
  const lipTop = (move = true) => {
    const py = y - up - tu, dip = y - up - tu * 0.7;
    if (move) g.moveTo(L[0], L[1]);
    g.quadraticCurveTo(lerp(L[0], x, 0.35), py - tu * 0.1 * (1 - r), x - hw * 0.3, py);
    g.quadraticCurveTo(x - hw * 0.12, py, x, dip);
    g.quadraticCurveTo(x + hw * 0.12, py, x + hw * 0.3, py);
    g.quadraticCurveTo(lerp(R[0], x, 0.35), py - tu * 0.1 * (1 - r), R[0], R[1]);
  };
  const lipBottomBack = () => arc(g, R, L, y + dn + tl, Math.min(1, ro + 0.25), false);
  g.save();
  g.lineJoin = g.lineCap = 'round';
  // lips: the lower lip, then the upper lip over it
  g.beginPath(); lipTop(); lipBottomBack(); g.closePath();
  g.fillStyle = css(look.lip); g.fill();
  // the opening
  const opening = () => { g.beginPath(); g.moveTo(L[0], L[1]); g.lineTo(IL[0], IL[1]); arc(g, IL, IR, y - up, ro, false); g.lineTo(R[0], R[1]); g.lineTo(IR[0], IR[1]); arc(g, IR, IL, y + dn, ro, false); g.closePath(); };
  if (gap > mw * 0.012) {
    opening(); g.fillStyle = 'rgb(58,20,24)'; g.fill();
    g.save(); opening(); g.clip();
    const th = Math.min(gap * (0.42 + 0.4 * tuck), mw * 0.075) * clamp(m.teeth);
    if (th > 0.5) { g.fillStyle = '#f1ebe1'; g.beginPath(); g.roundRect(x - iw * 0.78, y - up - mw * 0.05, iw * 1.56, mw * 0.05 + th, [0, 0, th * 0.4, th * 0.4]); g.fill(); }
    if (gap > mw * 0.11) { g.fillStyle = 'rgb(176,84,92)'; g.beginPath(); g.ellipse(x, y + dn + gap * 0.12, iw * 0.55, gap * 0.38, 0, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }
  // upper lip on top, a shade darker
  g.beginPath(); lipTop(); g.lineTo(IR[0], IR[1]); arc(g, IR, IL, y - up, ro, false); g.closePath();
  g.fillStyle = css(look.lip.map((v) => v * 0.8)); g.fill();
  // a soft shine on the lower lip
  g.fillStyle = 'rgba(255,240,235,0.22)';
  g.beginPath(); g.ellipse(x - hw * 0.08, y + dn + tl * 0.45, hw * 0.32, tl * 0.18, -0.05, 0, Math.PI * 2); g.fill();
  // ink: the line between the lips, or round the opening
  g.strokeStyle = css(INK, 0.9); g.lineWidth = mw * (0.022 + 0.008 * press);
  g.beginPath(); g.moveTo(L[0], L[1]); g.lineTo(IL[0], IL[1]); arc(g, IL, IR, y - up, ro, false); g.lineTo(R[0], R[1]); g.stroke();
  if (gap > mw * 0.012) { g.beginPath(); g.moveTo(IL[0], IL[1]); arc(g, IL, IR, y + dn, ro, false); g.stroke(); }
  g.restore();
}

/** Close the eyes by c (0 open .. 1 shut): the skin above each eye slides down over it. eyes: [[x, y]] px, ew px. */
export function drawBlink(g, eyes, ew, c, look) {
  if (c <= 0.02) return;
  const src = look.base;
  for (const [x, y] of eyes) {
    const rx = ew * 0.6, ry = ew * 0.3, top = y - ry, lidY = top + 2 * ry * c, sag = ry * (0.2 + 0.4 * c);
    const edge = (move) => { if (move) g.moveTo(x - rx * 1.05, lidY - sag * 0.5); g.quadraticCurveTo(x, lidY + sag, x + rx * 1.05, lidY - sag * 0.5); };
    g.save();
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.clip();
    g.beginPath(); g.moveTo(x - rx * 1.1, top - ry); g.lineTo(x - rx * 1.05, lidY - sag * 0.5); edge(false); g.lineTo(x + rx * 1.1, top - ry); g.closePath(); g.clip();
    // a thin strip of the skin just above the lid, stretched down: one smooth lid colour
    const sh = ry * 0.35;
    g.drawImage(src, x - rx * 1.1, top - ry * 0.55, rx * 2.2, sh, x - rx * 1.1, top - ry * 0.5, rx * 2.2, lidY + sag - top + ry * 0.5);
    g.restore();
    g.save();
    g.strokeStyle = css(INK, 0.85); g.lineWidth = ew * 0.07; g.lineCap = 'round';
    g.beginPath(); g.ellipse(x, y, rx * 1.02, ry * 1.4, 0, 0, Math.PI * 2); g.clip();
    g.beginPath(); edge(true); g.stroke();
    g.restore();
  }
}
