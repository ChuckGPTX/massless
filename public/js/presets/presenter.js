// The talking ad's presenters: three made-up people drawn in code as flat editorial illustrations (a few solid
// fills and one soft shade tone). No photos. Eyes, brows and mouth are shapes, so they can blink, lift and speak.
// Everything is drawn in a 1000 x 1250 design space; frame() maps it onto the video like a camera.
import { clamp } from './common.js';

/** The cast: colours and hair style for each presenter, and the soft backdrop that goes with them. */
export const CAST = {
  ava: { skin: '#9b6646', shade: '#82533a', hair: '#231610', hairShade: '#3b261a', brow: '#231610', style: 'curls', outfit: '#e2a33b', outfitShade: '#c98c2a', collar: '#fbf3e6', lip: '#87473a', lipShade: '#6b3529', blush: '#c0503f', blushAlpha: 0.14, backdrop: ['#fff1d9', '#f7cf98'] },
  leo: { skin: '#f0c4a1', shade: '#dba582', hair: '#5b3b25', hairShade: '#7a5236', brow: '#4a2f1d', style: 'short', outfit: '#26406a', outfitShade: '#1c3156', collar: '#2f5185', lip: '#c47767', lipShade: '#a85f51', blush: '#f08e7c', backdrop: ['#e6effa', '#b9cde8'] },
  mei: { skin: '#e2ab80', shade: '#c88f65', hair: '#17151b', hairShade: '#2d2934', brow: '#17151b', style: 'bob', outfit: '#f3e9da', outfitShade: '#dfcfb8', collar: '#ffffff', lip: '#c4655c', lipShade: '#a44f47', blush: '#ee8a77', backdrop: ['#e3f5ec', '#b2dfc8'] },
};
const INNER = '#3b1c22', TEETH = '#fbf7f1', TONGUE = '#d9757c', EYE = '#1d1719';
// head centre and size in design units
const HX = 500, HY = 500, RX = 148, RY = 178;
export const MOUTH = { x: HX, y: HY + 120, w: 112 };

/** Map the 1000 x 1250 design space onto a w x h frame like cover(): returns the scale and offset. */
export function frame(w, h, { zoom = 1, fx = 0.5, fy = 0.5 } = {}) {
  const k = Math.max(w / 1000, h / 1250) * zoom, dw = 1000 * k, dh = 1250 * k;
  return { k, ox: clamp(w / 2 - fx * dw, w - dw, 0), oy: clamp(h / 2 - fy * dh, h - dh, 0) };
}

/** The backdrop: the presenter's soft gradient, or one built from a brand colour [r, g, b]. */
export function backdrop(g, w, h, look, brand = null) {
  const mixW = (c, t) => `rgb(${c.map((v) => Math.round(v + (255 - v) * t)).join(',')})`;
  const [top, bottom] = brand ? [mixW(brand, 0.82), mixW(brand, 0.5)] : look.backdrop;
  const gr = g.createLinearGradient(0, 0, w * 0.3, h);
  gr.addColorStop(0, top); gr.addColorStop(1, bottom);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  // one big soft disc behind the head, editorial style
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.beginPath(); g.arc(w * 0.5, h * 0.36, Math.min(w, h) * 0.46, 0, Math.PI * 2); g.fill();
}

const ellipse = (g, x, y, rx, ry, fill, rot = 0) => { g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); };
const circles = (g, list, fill) => { g.fillStyle = fill; g.beginPath(); for (const [x, y, r] of list) { g.moveTo(x + r, y); g.arc(x, y, r, 0, Math.PI * 2); } g.fill(); };

function facePath(g, jaw) {
  g.beginPath();
  g.moveTo(HX - RX, HY - 10);
  g.bezierCurveTo(HX - RX, HY - 10 - RY * 1.3, HX + RX, HY - 10 - RY * 1.3, HX + RX, HY - 10);
  g.bezierCurveTo(HX + RX, HY + RY * 0.55, HX + RX * 0.5, HY + RY + jaw, HX, HY + RY + jaw);
  g.bezierCurveTo(HX - RX * 0.5, HY + RY + jaw, HX - RX, HY + RY * 0.55, HX - RX, HY - 10);
  g.closePath();
}

// ---------- hair: a back layer (behind the head) and a front layer (over the forehead) ----------
const CURL_BACK = [];
for (let i = 0; i <= 14; i++) { const a = Math.PI * (0.92 + (1.16 * i) / 14); CURL_BACK.push([HX + Math.cos(a) * (RX + 58), HY - 40 + Math.sin(a) * (RY + 30), 62 + (i % 3) * 8]); }
for (const s of [-1, 1]) for (let j = 0; j < 4; j++) CURL_BACK.push([HX + s * (RX + 40 + (j % 2) * 18), HY + 20 + j * 52, 56 - j * 4]);
const CURL_FRONT = [[HX - 92, HY - 128, 44], [HX - 40, HY - 150, 46], [HX + 18, HY - 154, 46], [HX + 74, HY - 140, 44], [HX + 118, HY - 108, 38], [HX - 128, HY - 92, 34]];
function hairBack(g, look) {
  if (look.style === 'curls') { circles(g, CURL_BACK.map(([x, y, r]) => [x + 8, y + 10, r]), look.hairShade); circles(g, CURL_BACK, look.hair); }
  else if (look.style === 'bob') {
    g.fillStyle = look.hair; g.beginPath();
    g.moveTo(HX - RX - 40, HY + RY * 0.72);
    g.lineTo(HX - RX - 42, HY - 40);
    g.bezierCurveTo(HX - RX - 42, HY - RY * 1.55, HX + RX + 42, HY - RY * 1.55, HX + RX + 42, HY - 40);
    g.lineTo(HX + RX + 40, HY + RY * 0.72);
    g.quadraticCurveTo(HX, HY + RY * 0.8, HX - RX - 40, HY + RY * 0.72);
    g.fill();
  }
}
function hairFront(g, look) {
  if (look.style === 'curls') { circles(g, CURL_FRONT.map(([x, y, r]) => [x + 6, y + 8, r]), look.hairShade); circles(g, CURL_FRONT, look.hair); return; }
  if (look.style === 'short') {
    g.fillStyle = look.hair; g.beginPath();
    g.moveTo(HX - RX - 6, HY - 18);
    g.bezierCurveTo(HX - RX - 14, HY - RY * 1.42, HX + RX + 14, HY - RY * 1.42, HX + RX + 6, HY - 18);
    g.lineTo(HX + RX - 6, HY - 40);
    g.quadraticCurveTo(HX + RX - 30, HY - RY * 0.62, HX + 30, HY - RY * 0.74);
    g.quadraticCurveTo(HX - 60, HY - RY * 0.6, HX - RX + 10, HY - 50);
    g.lineTo(HX - RX + 4, HY - 14);
    g.closePath(); g.fill();
    // a lighter sweep along the side part
    g.fillStyle = look.hairShade; g.beginPath();
    g.moveTo(HX - 46, HY - RY * 0.98); g.quadraticCurveTo(HX + 40, HY - RY * 1.08, HX + 110, HY - RY * 0.85);
    g.quadraticCurveTo(HX + 40, HY - RY * 0.95, HX - 46, HY - RY * 0.98); g.fill();
    return;
  }
  // bob: a centre part and two curtains down the sides of the face
  g.fillStyle = look.hair; g.beginPath();
  g.moveTo(HX + 6, HY - RY * 0.76);
  g.bezierCurveTo(HX + RX * 0.7, HY - RY * 0.72, HX + RX * 0.95, HY - RY * 0.2, HX + RX * 0.88, HY + RY * 0.7);
  g.lineTo(HX + RX + 41, HY + RY * 0.72);
  g.lineTo(HX + RX + 42, HY - 40);
  g.bezierCurveTo(HX + RX + 42, HY - RY * 1.55, HX - RX - 42, HY - RY * 1.55, HX - RX - 42, HY - 40);
  g.lineTo(HX - RX - 41, HY + RY * 0.72);
  g.lineTo(HX - RX * 0.88, HY + RY * 0.7);
  g.bezierCurveTo(HX - RX * 0.95, HY - RY * 0.2, HX - RX * 0.7, HY - RY * 0.72, HX + 6, HY - RY * 0.76);
  g.fill();
  g.fillStyle = look.hairShade; g.beginPath();
  g.moveTo(HX + 6, HY - RY * 0.76); g.quadraticCurveTo(HX + 70, HY - RY * 1.1, HX + 120, HY - RY * 1.02); g.quadraticCurveTo(HX + 60, HY - RY * 0.98, HX + 6, HY - RY * 0.76); g.fill();
}

function body(g, look) {
  // torso and shoulders
  g.fillStyle = look.outfit; g.beginPath();
  g.moveTo(HX - 62, 780);
  g.bezierCurveTo(HX - 160, 792, HX - 300, 820, HX - 345, 900);
  g.bezierCurveTo(HX - 395, 975, HX - 420, 1120, HX - 430, 1320);
  g.lineTo(HX + 430, 1320);
  g.bezierCurveTo(HX + 420, 1120, HX + 395, 975, HX + 345, 900);
  g.bezierCurveTo(HX + 300, 820, HX + 160, 792, HX + 62, 780);
  g.closePath(); g.fill();
  // the one shade: the side away from the light, and a fold under each arm
  g.save(); g.clip();
  g.fillStyle = look.outfitShade;
  g.beginPath(); g.ellipse(HX + 470, 1150, 170, 420, -0.12, 0, Math.PI * 2); g.fill();
  g.restore();
  // neck, with the chin's shadow
  g.fillStyle = look.skin; g.beginPath(); g.roundRect(HX - 56, HY + RY * 0.5, 112, 820 - HY - RY * 0.5, 30); g.fill();
  g.beginPath(); g.moveTo(HX - 56, 784); g.lineTo(HX + 56, 784); g.lineTo(HX, 890); g.closePath(); g.fill();
  g.save(); g.beginPath(); g.rect(HX - 56, HY, 112, 300); g.clip();
  ellipse(g, HX, HY + RY + 14, 70, 46, look.shade);
  g.restore();
  // collar
  g.fillStyle = look.collar;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(HX + s * 54, 770); g.lineTo(HX + s * 128, 818); g.lineTo(HX + s * 14, 912); g.lineTo(HX + s * 4, 880); g.lineTo(HX + s * 40, 800);
    g.closePath(); g.fill();
  }
}

/** Draw the mouth at (x, y), mw wide: lips as one simple shape, the inside dark, teeth one light shape. */
export function drawMouth(g, x, y, mw, m, look) {
  const r = clamp(m.round), press = clamp(m.press), tuck = clamp(m.tuck);
  const hw = mw * 0.5 * clamp(m.wide, 0.5, 1.3);
  const gap = mw * 0.32 * clamp(m.open, 0, 1.15);
  const up = gap * 0.18, dn = gap - up;
  const tu = mw * 0.085 * (1 + 0.3 * r) * (1 - 0.45 * press), tl = mw * 0.11 * (1 + 0.3 * r) * (1 - 0.35 * press) * (1 + 0.3 * tuck);
  const cy = y - mw * 0.05 * (1 - r) * (1 - 0.6 * clamp(m.open)) + gap * 0.1;
  const L = [x - hw, cy], R = [x + hw, cy], iw = hw * (1 - 0.12 * (1 + r));
  const ro = 0.25 + 0.65 * r;
  const arc = (A, B, mid, round) => { const t = 0.25 * (1 - round); g.bezierCurveTo(A[0] + (B[0] - A[0]) * t, A[1] + (4 / 3) * (mid - A[1]), B[0] + (A[0] - B[0]) * t, B[1] + (4 / 3) * (mid - B[1]), B[0], B[1]); };
  const IL = [x - iw, cy], IR = [x + iw, cy];
  g.save();
  // lower and upper lip together as one soft shape
  g.beginPath(); g.moveTo(L[0], L[1]); arc(L, R, y - up - tu, ro + 0.1); arc(R, L, y + dn + tl, Math.min(1, ro + 0.3)); g.closePath();
  g.fillStyle = look.lip; g.fill();
  const opening = () => { g.beginPath(); g.moveTo(IL[0], IL[1]); arc(IL, IR, y - up, ro); arc(IR, IL, y + dn, ro); g.closePath(); };
  if (gap > mw * 0.02) {
    opening(); g.fillStyle = INNER; g.fill();
    g.save(); opening(); g.clip();
    const th = Math.min(gap * (0.5 + 0.35 * tuck), mw * 0.11) * clamp(m.teeth);
    if (th > 0.5) { g.fillStyle = TEETH; g.beginPath(); g.roundRect(x - iw * 0.72, y - up - mw * 0.06, iw * 1.44, mw * 0.06 + th, th * 0.45); g.fill(); }
    if (gap > mw * 0.14) ellipse(g, x, y + dn + gap * 0.08, iw * 0.5, gap * 0.34, TONGUE);
    g.restore();
  } else {
    // closed: one clean line where the lips meet
    g.strokeStyle = look.lipShade; g.lineWidth = mw * (0.035 + 0.02 * press); g.lineCap = 'round';
    g.beginPath(); g.moveTo(IL[0], IL[1]); arc(IL, IR, y + mw * 0.012, ro); g.stroke();
  }
  // the upper lip a shade darker
  g.beginPath(); g.moveTo(L[0], L[1]); arc(L, R, y - up - tu, ro + 0.1); g.lineTo(IR[0], IR[1]); arc(IR, IL, y - up, ro); g.closePath();
  g.fillStyle = look.lipShade; g.fill();
  g.restore();
}

/**
 * Draw the presenter into g (already in design space). pose: { mouth, blink 0..1, brow 0..1, tilt (rad), nod (units) }.
 */
export function drawPresenter(g, look, pose) {
  const m = pose.mouth, jaw = clamp(m.open, 0, 1.15) * MOUTH.w * 0.32 * 0.7;
  body(g, look);
  g.save();
  // the head turns and nods around the top of the neck
  g.translate(HX, HY + RY * 0.8); g.rotate(pose.tilt || 0); g.translate(-HX, -(HY + RY * 0.8) - (pose.nod || 0));
  hairBack(g, look);
  for (const s of [-1, 1]) { ellipse(g, HX + s * RX * 0.98, HY + 18, 24, 40, look.skin); ellipse(g, HX + s * RX * 0.98, HY + 20, 11, 22, look.shade); }
  facePath(g, jaw); g.fillStyle = look.skin; g.fill();
  // the one soft shade down the far side of the face
  // (the face again, nudged left, leaves a crescent of shade down the right side and under the chin)
  g.save(); facePath(g, jaw); g.clip();
  g.fillStyle = look.shade; g.fillRect(HX - RX - 10, HY - RY * 1.4, RX * 2 + 20, RY * 2.6);
  g.translate(-24, -10); facePath(g, jaw); g.fillStyle = look.skin; g.fill();
  g.restore();
  // cheeks, nose
  g.globalAlpha = look.blushAlpha || 0.22; ellipse(g, HX - 88, HY + 78, 30, 20, look.blush); ellipse(g, HX + 88, HY + 78, 30, 20, look.blush); g.globalAlpha = 1;
  g.strokeStyle = look.shade; g.lineWidth = 8; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(HX + 6, HY + 22); g.quadraticCurveTo(HX + 20, HY + 62, HX + 12, HY + 74); g.quadraticCurveTo(HX + 2, HY + 80, HX - 10, HY + 74); g.stroke();
  // eyes: dark ovals that close to a soft arc
  const c = clamp(pose.blink || 0);
  for (const s of [-1, 1]) {
    const ex = HX + s * 60, ey = HY + 12;
    if (c < 0.75) {
      ellipse(g, ex, ey, 12.5, 16 * (1 - c) + 1.5, EYE);
      if (c < 0.4) ellipse(g, ex + 4, ey - 6 * (1 - c), 3.6, 3.6, 'rgba(255,255,255,0.9)');
    } else {
      g.strokeStyle = EYE; g.lineWidth = 5.5;
      g.beginPath(); g.moveTo(ex - 14, ey + 1); g.quadraticCurveTo(ex, ey + 9, ex + 14, ey + 1); g.stroke();
    }
    // brows lift for emphasis and dip a touch with a blink
    const by = HY - 42 - 12 * clamp(pose.brow || 0) + 3 * c;
    g.strokeStyle = look.brow; g.lineWidth = 10;
    g.beginPath(); g.moveTo(ex - s * 26, by + 6); g.quadraticCurveTo(ex - s * 2, by - 9, ex + s * 26, by + 2); g.stroke();
  }
  drawMouth(g, MOUTH.x, MOUTH.y + jaw * 0.25, MOUTH.w, m, look);
  hairFront(g, look);
  g.restore();
}
