/*! Chucksi Games · art.js · MIT License · Copyright (c) 2026 Chuck Crawley · https://github.com/ChuckGPTX/massless */
// Procedural vector art drawn in code from the recipe (characters, items, hazards, parallax scenes), so every
// game has art for free and at once. Images (uploads, AI art, the gallery's sprite sheets) replace any role.
// keyImage() removes a flat background in the browser: it samples the border colour, flood-fills from the
// edges with a tolerance, softens and de-spills the edge, then trims to the subject.

import { W, H, hash, rng, roundRect } from './engine.js';

// ---------- palettes ----------
// sky: top to bottom; far/mid/near: parallax silhouettes; ground + groundTop for runners; tiles for puzzles.
export const PALETTES = {
  amber: { name: 'Amber', sky: ['#120d05', '#3b2608'], far: '#4a3210', mid: '#2e1f0a', near: '#1a1206', ground: '#20170a', groundTop: '#ffbf2f', ink: '#140e04', player: '#ffbf2f', enemy: '#ff4f6d', item: '#7cf0ff', hazard: '#ff7a3d', accent: '#ffd166', tiles: ['#ffbf2f', '#ff4f6d', '#7cf0ff', '#9b7bff', '#5ee08a', '#ff8a3d'] },
  sunset: { name: 'Sunset', sky: ['#2b1055', '#ff8a5b'], far: '#9b4a73', mid: '#5e2459', near: '#2c0f36', ground: '#2a1033', groundTop: '#ff9e6d', ink: '#1e0a26', player: '#ffd166', enemy: '#ef476f', item: '#06d6a0', hazard: '#ff7b54', accent: '#ffd166', tiles: ['#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#c77dff', '#ff9e6d'] },
  ocean: { name: 'Ocean', sky: ['#021a33', '#0b6f94'], far: '#0d4f73', mid: '#0a3a57', near: '#062538', ground: '#04263b', groundTop: '#2ec4b6', ink: '#021220', player: '#ffb347', enemy: '#ff5d8f', item: '#b8f2e6', hazard: '#9b5de5', accent: '#7cf0ff', tiles: ['#ffb347', '#ff5d8f', '#2ec4b6', '#b8f2e6', '#9b5de5', '#fee440'] },
  neon: { name: 'Neon', sky: ['#07011a', '#2a0b4f'], far: '#3d1373', mid: '#25094a', near: '#12042b', ground: '#0e0322', groundTop: '#f15bb5', ink: '#06010f', player: '#00f5d4', enemy: '#f15bb5', item: '#fee440', hazard: '#ff3f81', accent: '#00f5d4', tiles: ['#00f5d4', '#f15bb5', '#fee440', '#9b5de5', '#00bbf9', '#ff7b3d'] },
  forest: { name: 'Forest', sky: ['#7ec8e3', '#e3f6ff'], far: '#8bb8a8', mid: '#4f8a6b', near: '#24533d', ground: '#3d2c1c', groundTop: '#6abf4b', ink: '#1b1f16', player: '#ff8c42', enemy: '#6a4c93', item: '#ffd23f', hazard: '#8d6e63', accent: '#ffd23f', tiles: ['#ff8c42', '#6a4c93', '#ffd23f', '#3fa7d6', '#e84855', '#6abf4b'] },
  candy: { name: 'Candy', sky: ['#ffc8e1', '#c3f0ff'], far: '#ffb3d1', mid: '#ff8fb8', near: '#e86a9a', ground: '#8e4f6f', groundTop: '#ffe066', ink: '#3d1d4a', player: '#7b2ff7', enemy: '#ff595e', item: '#ffca3a', hazard: '#ff7eb9', accent: '#ffca3a', tiles: ['#7b2ff7', '#ff595e', '#ffca3a', '#1982c4', '#8ac926', '#ff7eb9'] },
  arctic: { name: 'Arctic', sky: ['#0b1a33', '#4b7fb8'], far: '#7fa4cc', mid: '#c9dcef', near: '#eef6ff', ground: '#dfeaf5', groundTop: '#ffffff', ink: '#0d1b2e', player: '#ff6b6b', enemy: '#4361ee', item: '#ffd166', hazard: '#7fa4cc', accent: '#9bf6ff', tiles: ['#ff6b6b', '#4361ee', '#ffd166', '#9bf6ff', '#b388eb', '#57cc99'] },
  ember: { name: 'Ember', sky: ['#1f0907', '#d4501f'], far: '#9c3a1d', mid: '#64220f', near: '#3a1309', ground: '#4a1a0c', groundTop: '#ff8c42', ink: '#1a0703', player: '#ffe066', enemy: '#9be564', item: '#4cc9f0', hazard: '#ff5a1f', accent: '#ffe066', tiles: ['#ffe066', '#9be564', '#4cc9f0', '#ff5a1f', '#f72585', '#ffffff'] },
  moon: { name: 'Moon', sky: ['#030818', '#142a63'], far: '#22356e', mid: '#2b3c6e', near: '#3a4a78', ground: '#4b5683', groundTop: '#9aa7d4', ink: '#060b1f', player: '#f2f4f8', enemy: '#ff8c2a', item: '#9d6bff', hazard: '#ff8c2a', accent: '#4cc9ff', tiles: ['#f2f4f8', '#ff8c2a', '#9d6bff', '#4cc9ff', '#7ae582', '#ffd23f'] },
  arcade: { name: 'Arcade', sky: ['#14081f', '#4a1238'], far: '#3a1240', mid: '#22092a', near: '#120518', ground: '#1b1b22', groundTop: '#ff3b5c', ink: '#0a0410', player: '#ff3b3b', enemy: '#ffd23f', item: '#ffd23f', hazard: '#ff3b5c', accent: '#ffd23f', tiles: ['#ff3b3b', '#ffd23f', '#3bd6ff', '#9d4dff', '#3bff8a', '#ff8a3b'] },
  mono: { name: 'Mono', sky: ['#0d0d0f', '#2b2b30'], far: '#3a3a40', mid: '#26262a', near: '#161618', ground: '#141416', groundTop: '#f4f4f1', ink: '#050505', player: '#f4f4f1', enemy: '#ff4f4f', item: '#ffd400', hazard: '#ff4f4f', accent: '#ffd400', tiles: ['#f4f4f1', '#ff4f4f', '#ffd400', '#7c7c85', '#4fc3ff', '#b0ff4f'] },
};

export const CHARACTERS = ['blob', 'robot', 'egg', 'crystal', 'ship', 'ufo', 'bug', 'fish', 'bird', 'cat', 'fox', 'mouse', 'ghost', 'knight', 'rover', 'jelly', 'sub', 'car'];
export const ITEMS = ['coin', 'gem', 'star', 'heart', 'key', 'fruit', 'cheese', 'bolt', 'seed', 'orb', 'donut', 'gear'];
export const HAZARDS = ['spike', 'crate', 'rock', 'cactus', 'saw', 'mine', 'cone', 'barrier'];
export const SHAPES = [...CHARACTERS, ...ITEMS, ...HAZARDS];
export const SCENES = ['city', 'hills', 'desert', 'space', 'ocean', 'forest', 'grid', 'cave', 'candy', 'moon', 'snow'];

// ---------- colour helpers ----------
function rgbOf(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
export function mix(a, b, t) {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
export const shade = (c, t) => (t >= 0 ? mix(c, '#ffffff', t) : mix(c, '#000000', -t));
export function alpha(c, a) {
  const [r, g, b] = rgbOf(c);
  return `rgba(${r},${g},${b},${a})`;
}
export const luma = (c) => { const [r, g, b] = rgbOf(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

// ---------- shape drawing (unit box -50..50, facing right / up for ships) ----------
function outlined(ctx, fill, ink, lw = 4) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = ink;
  ctx.lineJoin = 'round';
  ctx.stroke();
}
function grad(ctx, c, x0 = -20, y0 = -30, r = 80) {
  const g = ctx.createRadialGradient(x0, y0, 2, 0, 0, r);
  g.addColorStop(0, shade(c, 0.35));
  g.addColorStop(0.55, c);
  g.addColorStop(1, shade(c, -0.3));
  return g;
}
function eye(ctx, x, y, r, ink, look = 0.35) {
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.12, 0, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.lineWidth = 2.5; ctx.strokeStyle = ink; ctx.stroke();
  ctx.beginPath(); ctx.arc(x + r * look, y + r * 0.1, r * 0.52, 0, Math.PI * 2); ctx.fillStyle = ink; ctx.fill();
  ctx.beginPath(); ctx.arc(x + r * look + r * 0.2, y - r * 0.18, r * 0.18, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
}
function shine(ctx, x, y, rx, ry, rot = -0.6) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
}
function glowDot(ctx, x, y, r, c) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
  g.addColorStop(0, '#fff'); g.addColorStop(0.3, c); g.addColorStop(1, alpha(c, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.4, 0, Math.PI * 2); ctx.fill();
}
function star(ctx, x, y, r1, r2, n = 5, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1;
    const a = rot + (i * Math.PI) / n;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

const DRAW = {
  blob(ctx, c) {
    ctx.beginPath();
    ctx.moveTo(-44, 24); ctx.bezierCurveTo(-48, -34, -22, -46, 0, -46); ctx.bezierCurveTo(22, -46, 48, -34, 44, 24); ctx.bezierCurveTo(40, 44, -40, 44, -44, 24);
    outlined(ctx, grad(ctx, c.main), c.ink);
    shine(ctx, -22, -26, 11, 6);
    eye(ctx, 6, -6, 10, c.ink); eye(ctx, 28, -6, 9, c.ink);
    ctx.beginPath(); ctx.arc(18, 14, 7, 0.15, Math.PI - 0.15); ctx.lineWidth = 3.5; ctx.strokeStyle = c.ink; ctx.stroke();
  },
  robot(ctx, c) {
    ctx.fillStyle = shade(c.main, -0.45);
    roundRect(ctx, -22, 26, 14, 20, 4); ctx.fill(); roundRect(ctx, 8, 26, 14, 20, 4); ctx.fill();
    roundRect(ctx, -30, -4, 60, 36, 9); outlined(ctx, grad(ctx, c.main, -10, 0, 50), c.ink);
    roundRect(ctx, -42, 0, 12, 24, 5); outlined(ctx, shade(c.main, -0.2), c.ink, 3); roundRect(ctx, 30, 0, 12, 24, 5); outlined(ctx, shade(c.main, -0.2), c.ink, 3);
    ctx.beginPath(); ctx.moveTo(0, -44); ctx.lineTo(0, -54); ctx.lineWidth = 4; ctx.strokeStyle = c.ink; ctx.stroke();
    glowDot(ctx, 0, -56, 4, c.glow);
    roundRect(ctx, -36, -46, 72, 44, 11); outlined(ctx, grad(ctx, c.main, -18, -40, 60), c.ink);
    roundRect(ctx, -27, -38, 54, 28, 9); ctx.fillStyle = '#10141c'; ctx.fill();
    glowDot(ctx, -11, -24, 5.5, c.glow); glowDot(ctx, 11, -24, 5.5, c.glow);
    glowDot(ctx, 0, 14, 4.5, c.glow);
    shine(ctx, -24, -40, 8, 3.5, 0);
  },
  egg(ctx, c) {
    const ring = (front) => {
      ctx.save(); ctx.rotate(-0.32);
      ctx.beginPath(); ctx.ellipse(0, 4, 52, 13, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
      ctx.lineWidth = 3.2; ctx.strokeStyle = c.glow; ctx.stroke();
      if (front) { glowDot(ctx, 44, 10, 3.2, '#ffffff'); } else glowDot(ctx, -46, 0, 3.2, '#ffffff');
      ctx.restore();
    };
    ring(false);
    ctx.beginPath();
    ctx.moveTo(0, -46); ctx.bezierCurveTo(30, -46, 40, -4, 38, 14); ctx.bezierCurveTo(36, 38, 18, 46, 0, 46); ctx.bezierCurveTo(-18, 46, -36, 38, -38, 14); ctx.bezierCurveTo(-40, -4, -30, -46, 0, -46);
    const g = ctx.createLinearGradient(-30, -40, 30, 40); g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, shade(c.main, -0.06)); g.addColorStop(1, shade(c.main, -0.28));
    outlined(ctx, g, c.ink, 3.5);
    ctx.beginPath(); ctx.ellipse(10, -6, 18, 19, 0, 0, Math.PI * 2); ctx.fillStyle = '#121826'; ctx.fill();
    glowDot(ctx, 12, -6, 7.5, c.glow);
    ctx.beginPath(); ctx.arc(12, -6, 3.2, 0, Math.PI * 2); ctx.fillStyle = '#0b2a3a'; ctx.fill();
    shine(ctx, -18, -24, 7, 12, 0.3);
    ring(true);
  },
  crystal(ctx, c) {
    const P = [[0, -48], [34, -22], [34, 18], [0, 46], [-34, 18], [-34, -22]];
    ctx.beginPath(); P.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.closePath();
    outlined(ctx, c.main, c.ink, 3.5);
    ctx.beginPath(); ctx.moveTo(0, -48); ctx.lineTo(-34, -22); ctx.lineTo(-14, -12); ctx.closePath(); ctx.fillStyle = shade(c.main, 0.35); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -48); ctx.lineTo(34, -22); ctx.lineTo(14, -12); ctx.closePath(); ctx.fillStyle = shade(c.main, 0.15); ctx.fill();
    ctx.beginPath(); ctx.moveTo(34, 18); ctx.lineTo(0, 46); ctx.lineTo(0, 26); ctx.closePath(); ctx.fillStyle = shade(c.main, -0.3); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-34, 18); ctx.lineTo(0, 46); ctx.lineTo(0, 26); ctx.closePath(); ctx.fillStyle = shade(c.main, -0.15); ctx.fill();
    roundRect(ctx, -20, -12, 40, 26, 9); ctx.fillStyle = '#100a1c'; ctx.fill();
    ctx.fillStyle = c.glow2; roundRect(ctx, -12, -6, 7, 12, 3); ctx.fill(); roundRect(ctx, 5, -6, 7, 12, 3); ctx.fill();
    ctx.globalAlpha = 0.35; glowDot(ctx, -8.5, 0, 5, c.glow2); glowDot(ctx, 8.5, 0, 5, c.glow2); ctx.globalAlpha = 1;
  },
  ship(ctx, c) {
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-46, 26); ctx.lineTo(-44, 38); ctx.lineTo(-14, 28); ctx.closePath(); outlined(ctx, shade(c.main, -0.25), c.ink, 3.5);
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(46, 26); ctx.lineTo(44, 38); ctx.lineTo(14, 28); ctx.closePath(); outlined(ctx, shade(c.main, -0.25), c.ink, 3.5);
    ctx.beginPath(); ctx.moveTo(0, -48); ctx.bezierCurveTo(12, -34, 16, -10, 16, 30); ctx.lineTo(-16, 30); ctx.bezierCurveTo(-16, -10, -12, -34, 0, -48);
    const g = ctx.createLinearGradient(-16, 0, 16, 0); g.addColorStop(0, shade(c.main, -0.2)); g.addColorStop(0.45, shade(c.main, 0.3)); g.addColorStop(1, shade(c.main, -0.25));
    outlined(ctx, g, c.ink, 3.5);
    ctx.beginPath(); ctx.ellipse(0, -14, 6.5, 13, 0, 0, Math.PI * 2); ctx.fillStyle = c.glow; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = c.ink; ctx.stroke();
    shine(ctx, -2, -20, 2, 5, 0);
    ctx.fillStyle = c.glow; ctx.globalAlpha = 0.9; ctx.fillRect(-40, 30, 6, 6); ctx.fillRect(34, 30, 6, 6); ctx.globalAlpha = 1;
  },
  ufo(ctx, c) {
    ctx.beginPath(); ctx.ellipse(0, -4, 22, 22, 0, Math.PI, 0); ctx.closePath();
    const g = ctx.createLinearGradient(0, -26, 0, 0); g.addColorStop(0, alpha(c.glow, 0.95)); g.addColorStop(1, alpha(shade(c.glow, -0.4), 0.9));
    outlined(ctx, g, c.ink, 3.5);
    ctx.beginPath(); ctx.ellipse(0, 6, 48, 15, 0, 0, Math.PI * 2); outlined(ctx, grad(ctx, c.main, -10, -4, 50), c.ink, 3.5);
    for (let i = -2; i <= 2; i++) glowDot(ctx, i * 17, 9 + Math.abs(i) * -1.5, 3, i % 2 ? '#fff' : c.glow);
    shine(ctx, -8, -16, 4, 7, 0.5);
  },
  bug(ctx, c) {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.ellipse(-26, -10, 22, 11, -0.5, 0, Math.PI * 2); ctx.fillStyle = shade(c.glow, 0.5); ctx.fill();
    ctx.beginPath(); ctx.ellipse(26, -10, 22, 11, 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = c.ink; ctx.lineWidth = 3.5;
    for (const s of [-1, 1]) for (const y of [-6, 8]) { ctx.beginPath(); ctx.moveTo(s * 18, y); ctx.lineTo(s * 34, y + 10); ctx.lineTo(s * 38, y + 22); ctx.stroke(); }
    ctx.beginPath(); ctx.ellipse(0, -4, 22, 30, 0, 0, Math.PI * 2); outlined(ctx, grad(ctx, c.main, -8, -16, 40), c.ink, 3.5);
    ctx.fillStyle = shade(c.main, -0.35); for (const y of [-14, -2, 10]) { ctx.fillRect(-18, y, 36, 4); }
    ctx.beginPath(); ctx.ellipse(0, 28, 17, 13, 0, 0, Math.PI * 2); outlined(ctx, shade(c.main, -0.3), c.ink, 3.5);
    glowDot(ctx, -7, 31, 3.5, c.glow2); glowDot(ctx, 7, 31, 3.5, c.glow2);
    ctx.beginPath(); ctx.moveTo(-8, 38); ctx.lineTo(-12, 47); ctx.moveTo(8, 38); ctx.lineTo(12, 47); ctx.stroke();
  },
  fish(ctx, c) {
    ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(-50, -22); ctx.quadraticCurveTo(-44, 0, -50, 22); ctx.closePath(); outlined(ctx, shade(c.main, -0.15), c.ink, 3.5);
    ctx.beginPath(); ctx.moveTo(-8, -24); ctx.quadraticCurveTo(2, -42, 18, -22); ctx.closePath(); outlined(ctx, shade(c.main, -0.15), c.ink, 3.5);
    ctx.beginPath(); ctx.ellipse(4, 0, 40, 26, 0, 0, Math.PI * 2); outlined(ctx, grad(ctx, c.main, 0, -12, 48), c.ink, 3.5);
    ctx.save(); ctx.beginPath(); ctx.ellipse(4, 0, 38, 24, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = shade(c.main, 0.45); ctx.beginPath(); ctx.ellipse(8, 18, 34, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = shade(c.main, -0.3); ctx.fillRect(-14, -30, 7, 60); ctx.fillRect(-2, -30, 5, 60);
    ctx.restore();
    eye(ctx, 24, -6, 8, c.ink, 0.3);
    ctx.beginPath(); ctx.arc(38, 6, 4, -0.3, 1.6); ctx.lineWidth = 3; ctx.strokeStyle = c.ink; ctx.stroke();
  },
  bird(ctx, c) {
    ctx.beginPath(); ctx.moveTo(-28, -2); ctx.lineTo(-50, -14); ctx.lineTo(-46, 4); ctx.lineTo(-50, 16); ctx.closePath(); outlined(ctx, shade(c.main, -0.25), c.ink, 3.5);
    ctx.beginPath(); ctx.arc(-2, 4, 32, 0, Math.PI * 2); outlined(ctx, grad(ctx, c.main, -12, -12, 44), c.ink, 3.5);
    ctx.beginPath(); ctx.ellipse(2, 20, 18, 10, 0, 0, Math.PI * 2); ctx.fillStyle = shade(c.main, 0.5); ctx.fill();
    ctx.beginPath(); ctx.moveTo(26, -4); ctx.lineTo(48, 4); ctx.lineTo(26, 12); ctx.closePath(); outlined(ctx, '#ffb703', c.ink, 3);
    ctx.beginPath(); ctx.ellipse(-12, 8, 18, 11, 0.4, 0, Math.PI * 2); outlined(ctx, shade(c.main, -0.2), c.ink, 3);
    ctx.beginPath(); ctx.moveTo(-6, -27); ctx.quadraticCurveTo(-2, -42, 8, -38); ctx.quadraticCurveTo(2, -34, 4, -28); ctx.fillStyle = shade(c.main, -0.2); ctx.fill();
    eye(ctx, 14, -8, 8.5, c.ink, 0.35);
  },
  cat(ctx, c) {
    ctx.beginPath(); ctx.moveTo(-26, -24); ctx.lineTo(-30, -50); ctx.lineTo(-8, -34); ctx.closePath(); outlined(ctx, c.main, c.ink, 3.5);
    ctx.beginPath(); ctx.moveTo(26, -24); ctx.lineTo(30, -50); ctx.lineTo(8, -34); ctx.closePath(); outlined(ctx, c.main, c.ink, 3.5);
    ctx.beginPath(); ctx.ellipse(0, 26, 24, 20, 0, 0, Math.PI * 2); outlined(ctx, shade(c.main, -0.1), c.ink, 3.5);
    ctx.beginPath(); ctx.ellipse(0, -10, 36, 30, 0, 0, Math.PI * 2); outlined(ctx, grad(ctx, c.main, -12, -26, 50), c.ink, 3.5);
    ctx.fillStyle = '#ff9fb2'; ctx.beginPath(); ctx.moveTo(-24, -30); ctx.lineTo(-26, -42); ctx.lineTo(-16, -33); ctx.fill(); ctx.beginPath(); ctx.moveTo(24, -30); ctx.lineTo(26, -42); ctx.lineTo(16, -33); ctx.fill();
    eye(ctx, -13, -12, 8.5, c.ink, 0.2); eye(ctx, 13, -12, 8.5, c.ink, 0.2);
    ctx.fillStyle = '#ff6f91'; ctx.beginPath(); ctx.moveTo(-4, 2); ctx.lineTo(4, 2); ctx.lineTo(0, 7); ctx.fill();
    ctx.strokeStyle = c.ink; ctx.lineWidth = 2; ctx.beginPath();
    for (const s of [-1, 1]) { ctx.moveTo(s * 12, 6); ctx.lineTo(s * 34, 2); ctx.moveTo(s * 12, 10); ctx.lineTo(s * 33, 12); }
    ctx.stroke();
  },
  fox(ctx, c) {
    ctx.beginPath(); ctx.moveTo(-18, 30); ctx.bezierCurveTo(-56, 30, -56, -10, -40, -6); ctx.bezierCurveTo(-46, 10, -34, 22, -18, 18); ctx.closePath(); outlined(ctx, c.main, c.ink, 3.5);
    ctx.beginPath(); ctx.arc(-46, 0, 7, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 28, 22, 18, 0, 0, Math.PI * 2); outlined(ctx, shade(c.main, -0.1), c.ink, 3.5);
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * 10, -30); ctx.lineTo(s * 28, -52); ctx.lineTo(s * 32, -20); ctx.closePath(); outlined(ctx, c.main, c.ink, 3.5); ctx.fillStyle = c.ink; ctx.beginPath(); ctx.moveTo(s * 24, -46); ctx.lineTo(s * 28, -52); ctx.lineTo(s * 29.5, -42); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(-34, -16); ctx.quadraticCurveTo(-30, -40, 0, -40); ctx.quadraticCurveTo(30, -40, 34, -16); ctx.quadraticCurveTo(26, 8, 0, 14); ctx.quadraticCurveTo(-26, 8, -34, -16); outlined(ctx, grad(ctx, c.main, -10, -30, 50), c.ink, 3.5);
    ctx.beginPath(); ctx.moveTo(-24, -6); ctx.quadraticCurveTo(-12, -2, 0, 14); ctx.quadraticCurveTo(12, -2, 24, -6); ctx.quadraticCurveTo(10, 10, 0, 14); ctx.quadraticCurveTo(-10, 10, -24, -6); ctx.fillStyle = '#fff6ec'; ctx.fill();
    eye(ctx, -12, -18, 7, c.ink, 0.2); eye(ctx, 12, -18, 7, c.ink, 0.2);
    ctx.beginPath(); ctx.ellipse(0, 6, 5, 3.5, 0, 0, Math.PI * 2); ctx.fillStyle = c.ink; ctx.fill();
  },
  mouse(ctx, c) {
    ctx.beginPath(); ctx.moveTo(-34, 22); ctx.bezierCurveTo(-56, 26, -50, 44, -36, 40); ctx.lineWidth = 3.5; ctx.strokeStyle = '#ff9fb2'; ctx.stroke();
    for (const x of [-18, 18]) { ctx.beginPath(); ctx.arc(x, -30, 17, 0, Math.PI * 2); outlined(ctx, c.main, c.ink, 3.5); ctx.beginPath(); ctx.arc(x, -30, 10, 0, Math.PI * 2); ctx.fillStyle = '#ffb3c6'; ctx.fill(); }
    ctx.beginPath(); ctx.ellipse(-2, 10, 36, 32, 0, 0, Math.PI * 2); outlined(ctx, grad(ctx, c.main, -12, -10, 46), c.ink, 3.5);
    ctx.beginPath(); ctx.ellipse(6, 22, 20, 14, 0, 0, Math.PI * 2); ctx.fillStyle = shade(c.main, 0.4); ctx.fill();
    eye(ctx, -10, -2, 7.5, c.ink, 0.3); eye(ctx, 12, -2, 7.5, c.ink, 0.3);
    ctx.beginPath(); ctx.arc(2, 12, 4.5, 0, Math.PI * 2); ctx.fillStyle = '#ff6f91'; ctx.fill();
  },
  ghost(ctx, c) {
    ctx.beginPath();
    ctx.moveTo(-38, 40); ctx.lineTo(-38, -6); ctx.bezierCurveTo(-38, -56, 38, -56, 38, -6); ctx.lineTo(38, 40);
    for (let i = 0; i < 4; i++) { const x0 = 38 - i * 19; ctx.quadraticCurveTo(x0 - 4.75, 30, x0 - 9.5, 40); ctx.quadraticCurveTo(x0 - 14.25, 50, x0 - 19, 40); }
    ctx.closePath();
    outlined(ctx, grad(ctx, c.main, -12, -26, 56), c.ink, 3.5);
    ctx.fillStyle = c.ink;
    ctx.beginPath(); ctx.ellipse(-12, -8, 7, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(14, -8, 7, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-10, -11, 2.5, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(16, -11, 2.5, 0, 7); ctx.fill();
    ctx.fillStyle = alpha('#ff6f91', 0.5); ctx.beginPath(); ctx.ellipse(-22, 8, 6, 3.5, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.ellipse(26, 8, 6, 3.5, 0, 0, 7); ctx.fill();
  },
  knight(ctx, c) {
    ctx.beginPath(); ctx.moveTo(0, -40); ctx.bezierCurveTo(10, -62, 34, -56, 30, -40); ctx.bezierCurveTo(20, -50, 10, -44, 4, -36); ctx.fillStyle = c.glow2 === '#7ae582' ? '#ef476f' : c.glow2; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = c.ink; ctx.stroke();
    roundRect(ctx, -40, 18, 80, 28, 12); outlined(ctx, shade(c.main, -0.15), c.ink, 3.5);
    ctx.beginPath(); ctx.moveTo(-32, 24); ctx.lineTo(-32, -14); ctx.bezierCurveTo(-32, -48, 32, -48, 32, -14); ctx.lineTo(32, 24); ctx.closePath();
    const g = ctx.createLinearGradient(-32, 0, 32, 0); g.addColorStop(0, shade(c.main, -0.25)); g.addColorStop(0.4, shade(c.main, 0.4)); g.addColorStop(1, shade(c.main, -0.3));
    outlined(ctx, g, c.ink, 3.5);
    roundRect(ctx, -24, -12, 48, 9, 4); ctx.fillStyle = '#0d0f14'; ctx.fill();
    ctx.globalAlpha = 0.9; glowDot(ctx, -9, -7.5, 2.6, c.glow); glowDot(ctx, 9, -7.5, 2.6, c.glow); ctx.globalAlpha = 1;
    ctx.strokeStyle = shade(c.main, -0.35); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(0, -14); ctx.moveTo(0, 0); ctx.lineTo(0, 22); ctx.stroke();
  },
  rover(ctx, c) {
    ctx.strokeStyle = c.ink; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(12, -12); ctx.lineTo(16, -36); ctx.stroke();
    roundRect(ctx, 6, -48, 22, 14, 5); outlined(ctx, shade(c.main, -0.1), c.ink, 3);
    glowDot(ctx, 22, -41, 3.5, c.glow);
    roundRect(ctx, -40, -20, 52, 8, 3); outlined(ctx, '#2b4a8a', c.ink, 3);
    roundRect(ctx, -42, -12, 84, 30, 9); outlined(ctx, grad(ctx, c.main, -16, -10, 60), c.ink, 3.5);
    ctx.fillStyle = shade(c.main, -0.35); ctx.fillRect(-30, 0, 26, 5);
    for (const x of [-30, 0, 30]) { ctx.beginPath(); ctx.arc(x, 28, 13, 0, Math.PI * 2); outlined(ctx, '#2a2d34', c.ink, 3.5); ctx.beginPath(); ctx.arc(x, 28, 5, 0, Math.PI * 2); ctx.fillStyle = '#9aa0ab'; ctx.fill(); }
  },
  jelly(ctx, c) {
    ctx.strokeStyle = alpha(shade(c.main, 0.4), 0.85); ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) { const x = -24 + i * 12; ctx.beginPath(); ctx.moveTo(x, 4); ctx.bezierCurveTo(x - 8, 18, x + 8, 30, x - 2, 46); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(-40, 6); ctx.bezierCurveTo(-42, -50, 42, -50, 40, 6); ctx.quadraticCurveTo(30, 12, 20, 6); ctx.quadraticCurveTo(10, 12, 0, 6); ctx.quadraticCurveTo(-10, 12, -20, 6); ctx.quadraticCurveTo(-30, 12, -40, 6);
    const g = ctx.createRadialGradient(-6, -24, 2, 0, -10, 50); g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, alpha(c.main, 0.95)); g.addColorStop(1, alpha(shade(c.main, -0.3), 0.9));
    outlined(ctx, g, alpha(c.ink, 0.8), 3);
    ctx.fillStyle = c.ink; ctx.beginPath(); ctx.arc(-10, -8, 4, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(10, -8, 4, 0, 7); ctx.fill();
    shine(ctx, -18, -26, 6, 10, 0.6);
  },
  sub(ctx, c) {
    ctx.beginPath(); ctx.moveTo(-44, -10); ctx.lineTo(-54, -18); ctx.lineTo(-54, 18); ctx.lineTo(-44, 10); ctx.closePath(); outlined(ctx, shade(c.main, -0.3), c.ink, 3);
    roundRect(ctx, -6, -40, 22, 22, 5); outlined(ctx, shade(c.main, -0.1), c.ink, 3.5);
    ctx.strokeStyle = c.ink; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(8, -40); ctx.lineTo(8, -50); ctx.lineTo(18, -50); ctx.stroke();
    roundRect(ctx, -46, -22, 92, 44, 22); outlined(ctx, grad(ctx, c.main, -10, -14, 60), c.ink, 3.5);
    for (const x of [-18, 2, 22]) { ctx.beginPath(); ctx.arc(x, -2, 7, 0, 7); ctx.fillStyle = c.glow; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = shade(c.main, -0.4); ctx.stroke(); }
    shine(ctx, -24, -14, 10, 3, 0);
  },
  car(ctx, c) {
    ctx.beginPath(); ctx.moveTo(-46, 16); ctx.lineTo(-46, -2); ctx.quadraticCurveTo(-44, -10, -30, -12); ctx.lineTo(-18, -32); ctx.lineTo(16, -32); ctx.lineTo(30, -12); ctx.quadraticCurveTo(46, -10, 48, 2); ctx.lineTo(48, 16); ctx.closePath();
    outlined(ctx, grad(ctx, c.main, -10, -20, 60), c.ink, 3.5);
    ctx.fillStyle = alpha(c.glow, 0.85); ctx.beginPath(); ctx.moveTo(-14, -27); ctx.lineTo(-2, -27); ctx.lineTo(-2, -13); ctx.lineTo(-24, -13); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(3, -27); ctx.lineTo(14, -27); ctx.lineTo(24, -13); ctx.lineTo(3, -13); ctx.closePath(); ctx.fill();
    glowDot(ctx, 44, 0, 3, '#fff4b3');
    for (const x of [-26, 28]) { ctx.beginPath(); ctx.arc(x, 18, 12, 0, 7); outlined(ctx, '#22252c', c.ink, 3.5); ctx.beginPath(); ctx.arc(x, 18, 5, 0, 7); ctx.fillStyle = '#b9bec8'; ctx.fill(); }
  },
  // ----- items -----
  coin(ctx, c) {
    ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(-30, -40, 30, 40); g.addColorStop(0, '#fff2a8'); g.addColorStop(0.4, '#ffd23f'); g.addColorStop(1, '#e09a00');
    outlined(ctx, g, '#7a4a00', 4);
    ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.lineWidth = 4; ctx.strokeStyle = '#e8a500'; ctx.stroke();
    star(ctx, 0, 1, 16, 7); ctx.fillStyle = '#fff3b0'; ctx.fill();
    shine(ctx, -18, -20, 8, 4);
  },
  gem(ctx, c) {
    ctx.beginPath(); ctx.moveTo(-40, -12); ctx.lineTo(-22, -36); ctx.lineTo(22, -36); ctx.lineTo(40, -12); ctx.lineTo(0, 42); ctx.closePath(); outlined(ctx, c.main, c.ink, 3.5);
    ctx.fillStyle = shade(c.main, 0.4); ctx.beginPath(); ctx.moveTo(-22, -36); ctx.lineTo(-10, -12); ctx.lineTo(10, -12); ctx.lineTo(22, -36); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(c.main, -0.25); ctx.beginPath(); ctx.moveTo(10, -12); ctx.lineTo(40, -12); ctx.lineTo(0, 42); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(c.main, 0.15); ctx.beginPath(); ctx.moveTo(-40, -12); ctx.lineTo(-10, -12); ctx.lineTo(0, 42); ctx.closePath(); ctx.fill();
    shine(ctx, -14, -26, 7, 3, -0.3);
  },
  star(ctx, c) {
    star(ctx, 0, 3, 46, 21); outlined(ctx, grad(ctx, c.main, -10, -20, 50), c.ink, 4);
    shine(ctx, -10, -14, 7, 4);
  },
  heart(ctx, c) {
    ctx.beginPath(); ctx.moveTo(0, 40); ctx.bezierCurveTo(-60, 0, -36, -50, 0, -22); ctx.bezierCurveTo(36, -50, 60, 0, 0, 40); outlined(ctx, grad(ctx, '#ff4f6d', -16, -20, 50), c.ink, 4);
    shine(ctx, -18, -16, 8, 5);
  },
  key(ctx, c) {
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(42, 0); ctx.moveTo(30, 0); ctx.lineTo(30, 16); ctx.moveTo(40, 0); ctx.lineTo(40, 12);
    ctx.lineWidth = 16; ctx.strokeStyle = c.ink; ctx.stroke(); ctx.lineWidth = 9; ctx.strokeStyle = '#ffd23f'; ctx.stroke();
    ctx.beginPath(); ctx.arc(-22, 0, 19, 0, Math.PI * 2); ctx.lineWidth = 16; ctx.strokeStyle = c.ink; ctx.stroke(); ctx.lineWidth = 9; ctx.strokeStyle = '#ffd23f'; ctx.stroke();
    shine(ctx, -30, -10, 5, 3);
  },
  fruit(ctx, c) {
    ctx.beginPath(); ctx.moveTo(0, -30); ctx.bezierCurveTo(30, -46, 50, -6, 30, 26); ctx.bezierCurveTo(18, 46, 6, 40, 0, 36); ctx.bezierCurveTo(-6, 40, -18, 46, -30, 26); ctx.bezierCurveTo(-50, -6, -30, -46, 0, -30);
    outlined(ctx, grad(ctx, c.main === '#ffd23f' ? '#ef476f' : c.main, -16, -16, 50), c.ink, 4);
    ctx.beginPath(); ctx.moveTo(0, -30); ctx.lineTo(4, -46); ctx.lineWidth = 5; ctx.strokeStyle = '#6b3e1f'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(16, -42, 13, 6, -0.4, 0, Math.PI * 2); outlined(ctx, '#5ec46a', c.ink, 3);
    shine(ctx, -18, -14, 7, 11, 0.3);
  },
  cheese(ctx, c) {
    ctx.beginPath(); ctx.moveTo(-44, 30); ctx.lineTo(40, 30); ctx.lineTo(40, -6); ctx.lineTo(-44, 14); ctx.closePath(); outlined(ctx, '#ffd23f', c.ink, 3.5);
    ctx.beginPath(); ctx.moveTo(-44, 14); ctx.lineTo(40, -6); ctx.lineTo(18, -26); ctx.closePath(); outlined(ctx, '#ffe680', c.ink, 3.5);
    ctx.fillStyle = '#e8b400'; for (const [x, y, r] of [[-20, 22, 5], [8, 12, 7], [28, 22, 4], [20, -10, 4]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  },
  bolt(ctx, c) {
    ctx.beginPath(); ctx.moveTo(8, -48); ctx.lineTo(-28, 6); ctx.lineTo(-2, 6); ctx.lineTo(-10, 48); ctx.lineTo(28, -8); ctx.lineTo(2, -8); ctx.closePath(); outlined(ctx, '#ffe14d', c.ink, 4);
    shine(ctx, -6, -10, 3, 9, 0.5);
  },
  seed(ctx, c) {
    ctx.beginPath(); ctx.moveTo(0, 42); ctx.quadraticCurveTo(-4, 10, 0, -6); ctx.lineWidth = 6; ctx.strokeStyle = c.ink; ctx.stroke(); ctx.lineWidth = 3; ctx.strokeStyle = '#4caf50'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.bezierCurveTo(-10, -40, -46, -36, -44, -12); ctx.bezierCurveTo(-30, -4, -12, -4, 0, -6); outlined(ctx, '#7ae582', c.ink, 3.5);
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.bezierCurveTo(10, -46, 48, -42, 44, -16); ctx.bezierCurveTo(30, -6, 12, -4, 0, -6); outlined(ctx, '#5ed16a', c.ink, 3.5);
    ctx.beginPath(); ctx.ellipse(0, 40, 24, 8, 0, 0, Math.PI * 2); ctx.fillStyle = '#8d5a3b'; ctx.fill();
  },
  orb(ctx, c) {
    glowDot(ctx, 0, 0, 18, c.main);
    ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); outlined(ctx, grad(ctx, c.main, -8, -10, 30), alpha(c.ink, 0.7), 3);
    shine(ctx, -9, -10, 6, 4);
  },
  donut(ctx, c) {
    ctx.beginPath(); ctx.arc(0, 0, 42, 0, Math.PI * 2); ctx.arc(0, 0, 14, 0, Math.PI * 2, true); outlined(ctx, '#e0a96d', c.ink, 3.5);
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; const r = 36 + Math.sin(i * 2.3) * 4; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.arc(0, 0, 18, 0, Math.PI * 2, true); ctx.fillStyle = c.main; ctx.fill();
    const cols = ['#fff', '#7cf0ff', '#ffe14d', '#7ae582'];
    for (let i = 0; i < 14; i++) { const a = i * 2.4; const r = 22 + (i % 3) * 5; ctx.save(); ctx.translate(Math.cos(a) * r, Math.sin(a) * r); ctx.rotate(a * 3); ctx.fillStyle = cols[i % 4]; ctx.fillRect(-4, -1.5, 8, 3); ctx.restore(); }
  },
  gear(ctx, c) {
    ctx.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; const r = i % 2 ? 32 : 44; ctx.lineTo(Math.cos(a - 0.12) * r, Math.sin(a - 0.12) * r); ctx.lineTo(Math.cos(a + 0.12) * r, Math.sin(a + 0.12) * r); }
    ctx.closePath(); ctx.arc(0, 0, 13, 0, Math.PI * 2, true);
    outlined(ctx, grad(ctx, c.main, -12, -14, 50), c.ink, 3.5);
  },
  // ----- hazards -----
  spike(ctx, c) {
    for (let i = 0; i < 3; i++) {
      const x = -36 + i * 36;
      ctx.beginPath(); ctx.moveTo(x - 17, 46); ctx.lineTo(x, -44); ctx.lineTo(x + 17, 46); ctx.closePath();
      const g = ctx.createLinearGradient(x - 17, 0, x + 17, 0); g.addColorStop(0, shade(c.main, 0.3)); g.addColorStop(0.5, c.main); g.addColorStop(1, shade(c.main, -0.35));
      outlined(ctx, g, c.ink, 3.5);
    }
  },
  crate(ctx, c) {
    roundRect(ctx, -44, -44, 88, 88, 6); outlined(ctx, '#b07a43', c.ink, 4);
    ctx.strokeStyle = '#7a4f26'; ctx.lineWidth = 6; ctx.strokeRect(-34, -34, 68, 68);
    ctx.beginPath(); ctx.moveTo(-34, -34); ctx.lineTo(34, 34); ctx.moveTo(34, -34); ctx.lineTo(-34, 34); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(-40, -40, 80, 5);
  },
  rock(ctx, c) {
    ctx.beginPath(); [[-44, 30], [-40, -6], [-20, -36], [12, -42], [38, -18], [46, 30]].forEach(([x, y]) => ctx.lineTo(x, y)); ctx.closePath();
    outlined(ctx, grad(ctx, '#8a8f99', -16, -24, 60), c.ink, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.moveTo(-20, -36); ctx.lineTo(12, -42); ctx.lineTo(0, -18); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.moveTo(38, -18); ctx.lineTo(46, 30); ctx.lineTo(16, 30); ctx.closePath(); ctx.fill();
  },
  cactus(ctx, c) {
    const g = '#3fa34d';
    roundRect(ctx, -12, -46, 24, 92, 12); outlined(ctx, g, c.ink, 3.5);
    roundRect(ctx, -38, -14, 18, 34, 9); outlined(ctx, g, c.ink, 3.5); roundRect(ctx, 20, -28, 18, 30, 9); outlined(ctx, g, c.ink, 3.5);
    ctx.fillStyle = g; ctx.fillRect(-24, 6, 14, 10); ctx.fillRect(10, -6, 12, 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-4, -38); ctx.lineTo(-4, 38); ctx.stroke();
  },
  saw(ctx, c) {
    ctx.beginPath();
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; const r = i % 2 ? 36 : 47; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); outlined(ctx, grad(ctx, '#d6dbe3', -14, -14, 60), c.ink, 3.5);
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, 7); ctx.fillStyle = c.main; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = c.ink; ctx.stroke();
  },
  mine(ctx, c) {
    ctx.strokeStyle = c.ink; ctx.lineWidth = 7; ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); ctx.lineTo(Math.cos(a) * 46, Math.sin(a) * 46); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(0, 0, 33, 0, 7); outlined(ctx, grad(ctx, '#3a3f4b', -10, -12, 44), c.ink, 3.5);
    glowDot(ctx, 0, 0, 6, c.main);
  },
  cone(ctx, c) {
    ctx.beginPath(); ctx.moveTo(-10, -44); ctx.lineTo(10, -44); ctx.lineTo(30, 36); ctx.lineTo(-30, 36); ctx.closePath(); outlined(ctx, '#ff7a1a', c.ink, 3.5);
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(-15, -20); ctx.lineTo(15, -20); ctx.lineTo(19, -4); ctx.lineTo(-19, -4); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-22, 8); ctx.lineTo(22, 8); ctx.lineTo(25, 20); ctx.lineTo(-25, 20); ctx.closePath(); ctx.fill();
    roundRect(ctx, -42, 34, 84, 12, 3); outlined(ctx, '#ff7a1a', c.ink, 3.5);
  },
  barrier(ctx, c) {
    roundRect(ctx, -46, -30, 92, 60, 6); ctx.save(); ctx.clip();
    ctx.fillStyle = '#ffd23f'; ctx.fillRect(-46, -30, 92, 60); ctx.fillStyle = '#1b1b1f';
    for (let i = -5; i < 6; i++) { ctx.beginPath(); ctx.moveTo(i * 22, -30); ctx.lineTo(i * 22 + 11, -30); ctx.lineTo(i * 22 - 19, 30); ctx.lineTo(i * 22 - 30, 30); ctx.fill(); }
    ctx.restore(); roundRect(ctx, -46, -30, 92, 60, 6); ctx.lineWidth = 4; ctx.strokeStyle = c.ink; ctx.stroke();
  },
};

/** Draw a procedural shape centred at (x, y) in a box of `size` px. colors: a palette colour or a full set. */
export function drawShape(ctx, kind, x, y, size, colors) {
  const fn = DRAW[kind] || DRAW.blob;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 100, size / 100);
  fn(ctx, colors);
  ctx.restore();
}

// ---------- images ----------
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${String(src).slice(0, 60)}`));
    img.src = src;
  });
}
const isSheet = (v) => v && typeof v === 'object' && typeof v.src === 'string' && v.cw > 0;

/**
 * Remove a flat background. Returns { canvas, keyed, key }: keyed is false when the border isn't one solid
 * colour (a photo, say), and the image comes back unchanged (downscaled to maxSize).
 */
export function keyImage(src, { tolerance = 52, maxSize = 512, minSolid = 0.6, trim = true } = {}) {
  const sw = src.naturalWidth || src.width;
  const sh = src.naturalHeight || src.height;
  const k = Math.min(1, maxSize / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  const im = ctx.getImageData(0, 0, w, h);
  const d = im.data;
  // border colour: the fullest 4-bit bucket of border pixels, averaged
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const buckets = new Map();
  for (const p of border) {
    if (d[p * 4 + 3] < 128) continue;
    const b = ((d[p * 4] >> 4) << 8) | ((d[p * 4 + 1] >> 4) << 4) | (d[p * 4 + 2] >> 4);
    buckets.set(b, (buckets.get(b) || 0) + 1);
  }
  if (!buckets.size) return { canvas: c, keyed: false, alreadyClear: true };
  let best = 0;
  let bestN = -1;
  for (const [b, n] of buckets) if (n > bestN) { best = b; bestN = n; }
  let kr = 0, kg = 0, kb = 0, kn = 0;
  for (const p of border) {
    const b = ((d[p * 4] >> 4) << 8) | ((d[p * 4 + 1] >> 4) << 4) | (d[p * 4 + 2] >> 4);
    if (b === best) { kr += d[p * 4]; kg += d[p * 4 + 1]; kb += d[p * 4 + 2]; kn++; }
  }
  kr /= kn; kg /= kn; kb /= kn;
  const tol2 = tolerance * tolerance;
  const dist2 = (i) => (d[i] - kr) ** 2 + (d[i + 1] - kg) ** 2 + (d[i + 2] - kb) ** 2;
  let near = 0;
  for (const p of border) if (dist2(p * 4) < tol2) near++;
  if (near / border.length < minSolid) return { canvas: c, keyed: false };
  // flood fill from every border pixel close to the key
  const mask = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let qh = 0, qt = 0;
  for (const p of border) if (!mask[p] && dist2(p * 4) < tol2) { mask[p] = 1; q[qt++] = p; }
  while (qh < qt) {
    const p = q[qh++];
    const x = p % w;
    const y = (p / w) | 0;
    const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const n of nb) if (n >= 0 && !mask[n] && dist2(n * 4) < tol2) { mask[n] = 1; q[qt++] = n; }
  }
  // holes of the exact key colour (between an arm and the body) when the key is a strong chroma colour
  const sat = Math.max(kr, kg, kb) - Math.min(kr, kg, kb);
  if (sat > 120) {
    const t2 = (tolerance * 0.55) ** 2;
    for (let p = 0; p < w * h; p++) if (!mask[p] && dist2(p * 4) < t2) mask[p] = 1;
  }
  // soft, de-spilled edge: pixels next to the background get alpha from their distance to the key colour
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (mask[p]) { d[i + 3] = 0; continue; }
    const x = p % w;
    const y = (p / w) | 0;
    let edge = false;
    for (let dy = -2; dy <= 2 && !edge; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) { edge = true; break; }
    }
    if (!edge) continue;
    const dd = Math.sqrt(dist2(i));
    const a = Math.max(0, Math.min(1, (dd - tolerance * 0.6) / (tolerance * 1.4)));
    if (a < 1 && a > 0) {
      d[i] = Math.max(0, Math.min(255, (d[i] - (1 - a) * kr) / a));
      d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] - (1 - a) * kg) / a));
      d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] - (1 - a) * kb) / a));
    }
    d[i + 3] = Math.round(d[i + 3] * Math.max(a, 0.0));
  }
  ctx.putImageData(im, 0, 0);
  const key = toHex(kr, kg, kb);
  if (!trim) return { canvas: c, keyed: true, key };
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { canvas: c, keyed: true, key, empty: true };
  const pad = 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { canvas: out, keyed: true, key };
}

// ---------- scenes ----------
function layerCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
// draw fn at x and its wrapped copies so a layer tiles seamlessly
const wrapX = (lw, x, fn) => { fn(x); if (x < 200) fn(x + lw); if (x > lw - 200) fn(x - lw); };
function hillsLayer(ctx, lw, lh, base, amp, color, seed, freqs = [1, 2, 5]) {
  const r = rng(seed);
  const ph = freqs.map(() => r() * Math.PI * 2);
  const am = freqs.map((f, i) => amp / (i + 1) * (0.6 + r() * 0.5));
  ctx.beginPath(); ctx.moveTo(0, lh);
  for (let x = 0; x <= lw; x += 6) {
    let y = base;
    freqs.forEach((f, i) => { y -= Math.sin((x / lw) * Math.PI * 2 * f + ph[i]) * am[i]; });
    ctx.lineTo(x, y);
  }
  ctx.lineTo(lw, lh); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}

/** Build the procedural scene: a sky and up to three parallax layers, each 2W wide and tiling seamlessly. */
export function buildScene(kind, pal, seed = 1) {
  const lw = W * 2;
  const r = rng(seed);
  const sky = layerCanvas(W, H);
  const s = sky.getContext('2d');
  const g = s.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, pal.sky[0]);
  g.addColorStop(1, pal.sky[1]);
  s.fillStyle = g;
  s.fillRect(0, 0, W, H);
  const layers = [];
  const add = (speed, draw) => {
    const c = layerCanvas(lw, H);
    draw(c.getContext('2d'));
    layers.push({ c, speed });
  };
  const dark = luma(pal.sky[0]) < 0.35;
  const stars = (ctx, n, w, h, a = 0.8) => {
    for (let i = 0; i < n; i++) { ctx.globalAlpha = a * (0.3 + r() * 0.7); ctx.fillStyle = '#fff'; const z = r() < 0.1 ? 2.4 : 1.4; ctx.fillRect(r() * w, r() * h, z, z); }
    ctx.globalAlpha = 1;
  };
  const sun = (x, y, rad, c) => {
    const sg = s.createRadialGradient(x, y, rad * 0.2, x, y, rad * 3);
    sg.addColorStop(0, alpha(c, 0.5)); sg.addColorStop(1, alpha(c, 0));
    s.fillStyle = sg; s.fillRect(0, 0, W, H);
    s.beginPath(); s.arc(x, y, rad, 0, Math.PI * 2); s.fillStyle = c; s.fill();
  };
  const ground = H * 0.75;
  switch (kind) {
    case 'city': {
      if (dark) stars(s, 60, W, H * 0.5);
      sun(W * 0.72, H * 0.22, 46, mix(pal.accent, '#ffffff', 0.4));
      for (const [speed, col, minH, maxH, win] of [[0.15, pal.far, 160, 380, 0.25], [0.35, pal.mid, 120, 300, 0.4], [0.6, pal.near, 60, 200, 0.15]]) {
        add(speed, (c) => {
          let x = 0;
          while (x < lw) {
            const bw = 40 + r() * 70;
            const bh = minH + r() * (maxH - minH);
            const top = ground - bh + (speed > 0.5 ? 60 : 0);
            c.fillStyle = col; c.fillRect(x, top, bw - 4, H - top);
            if (r() < 0.3) c.fillRect(x + bw / 2 - 2, top - 24, 3, 24);
            c.fillStyle = alpha(pal.accent, win);
            for (let wy = top + 12; wy < ground + 40; wy += 18) for (let wx = x + 8; wx < x + bw - 12; wx += 14) if (r() < 0.45) c.fillRect(wx, wy, 6, 8);
            x += bw;
          }
        });
      }
      break;
    }
    case 'grid': {
      stars(s, 70, W, H * 0.5);
      const sy = H * 0.4;
      const sg = s.createLinearGradient(0, sy - 110, 0, sy + 110);
      sg.addColorStop(0, pal.accent); sg.addColorStop(1, pal.enemy);
      s.save(); s.beginPath(); s.arc(W / 2, sy, 110, Math.PI, 0); s.closePath(); s.clip(); s.fillStyle = sg; s.fillRect(0, 0, W, H);
      s.fillStyle = pal.sky[0]; for (let i = 0; i < 7; i++) s.fillRect(0, sy - 60 + i * 9 + i * i * 0.9, W, 2 + i * 0.8); s.restore();
      add(0.2, (c) => {
        c.beginPath(); c.moveTo(0, sy + 4);
        for (let x = 0; x <= lw; x += 30) c.lineTo(x, sy + 4 - Math.abs(Math.sin(x * 0.013 + 1)) * 70 * (0.4 + 0.6 * Math.abs(Math.sin(x * 0.004))));
        c.lineTo(lw, sy + 4); c.closePath(); c.fillStyle = pal.near; c.fill(); c.strokeStyle = pal.enemy; c.lineWidth = 2; c.stroke();
      });
      break;
    }
    case 'space': {
      stars(s, 160, W, H, 0.9);
      for (let i = 0; i < 3; i++) {
        const x = r() * W, y = r() * H, rad = 140 + r() * 160;
        const ng = s.createRadialGradient(x, y, 0, x, y, rad);
        ng.addColorStop(0, alpha(i % 2 ? pal.enemy : pal.accent, 0.18)); ng.addColorStop(1, alpha(pal.accent, 0));
        s.fillStyle = ng; s.fillRect(0, 0, W, H);
      }
      const px = W * 0.78, py = H * 0.18;
      s.beginPath(); s.arc(px, py, 54, 0, Math.PI * 2); const pg = s.createRadialGradient(px - 20, py - 20, 6, px, py, 60); pg.addColorStop(0, shade(pal.far, 0.5)); pg.addColorStop(1, shade(pal.far, -0.4)); s.fillStyle = pg; s.fill();
      s.beginPath(); s.ellipse(px, py, 92, 16, -0.35, 0, Math.PI * 2); s.lineWidth = 5; s.strokeStyle = alpha(pal.accent, 0.5); s.stroke();
      add(0.25, (c) => stars(c, 60, lw, H, 0.7));
      break;
    }
    case 'ocean': {
      for (let i = 0; i < 6; i++) {
        const x = r() * W;
        s.save(); s.globalAlpha = 0.08 + r() * 0.06; s.fillStyle = '#ffffff';
        s.beginPath(); s.moveTo(x - 20, 0); s.lineTo(x + 30, 0); s.lineTo(x + 140 + r() * 80, H); s.lineTo(x + 40, H); s.closePath(); s.fill(); s.restore();
      }
      add(0.2, (c) => hillsLayer(c, lw, H, H * 0.82, 60, pal.far, seed + 1, [1, 3, 7]));
      add(0.45, (c) => {
        for (let i = 0; i < 16; i++) {
          const x = r() * lw, hgt = 120 + r() * 220;
          wrapX(lw, x, (xx) => { c.beginPath(); c.moveTo(xx, H); for (let y = 0; y < hgt; y += 10) c.lineTo(xx + Math.sin(y * 0.05 + i) * 10, H - y); c.lineWidth = 8 + r() * 6; c.strokeStyle = pal.mid; c.lineCap = 'round'; c.stroke(); });
        }
        hillsLayer(c, lw, H, H * 0.93, 26, pal.near, seed + 2, [2, 5]);
      });
      break;
    }
    case 'forest':
    case 'hills':
    case 'snow': {
      if (dark) stars(s, 80, W, H * 0.6);
      if (kind === 'snow' && dark) {
        for (let i = 0; i < 3; i++) { s.save(); s.globalAlpha = 0.18; s.strokeStyle = i % 2 ? '#7cf0b0' : pal.accent; s.lineWidth = 40; s.beginPath(); s.moveTo(-40, 160 + i * 40); s.bezierCurveTo(W * 0.3, 60 + i * 30, W * 0.7, 260 + i * 20, W + 40, 120 + i * 30); s.stroke(); s.restore(); }
      } else sun(W * 0.25, H * 0.2, 40, mix(pal.accent, '#ffffff', 0.5));
      add(0.12, (c) => {
        hillsLayer(c, lw, H, H * 0.52, 110, pal.far, seed + 3, [1, 3, 4]);
        if (kind === 'snow') { c.globalCompositeOperation = 'source-atop'; c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillRect(0, 0, lw, H * 0.5); c.globalCompositeOperation = 'source-over'; }
      });
      add(0.3, (c) => {
        hillsLayer(c, lw, H, H * 0.64, 60, pal.mid, seed + 4, [2, 3]);
        if (kind !== 'hills') for (let i = 0; i < 28; i++) { const x = r() * lw; const th = 60 + r() * 70; wrapX(lw, x, (xx) => pine(c, xx, H * 0.66 + r() * 30, th, pal.mid)); }
      });
      add(0.55, (c) => {
        hillsLayer(c, lw, H, H * 0.76, 30, pal.near, seed + 5, [3, 4]);
        if (kind !== 'hills') for (let i = 0; i < 16; i++) { const x = r() * lw; const th = 90 + r() * 90; wrapX(lw, x, (xx) => pine(c, xx, H * 0.78, th, pal.near)); }
      });
      break;
    }
    case 'desert': {
      sun(W * 0.66, H * 0.26, 64, mix(pal.accent, '#ffffff', 0.3));
      add(0.12, (c) => {
        for (let i = 0; i < 6; i++) {
          const x = r() * lw, w = 90 + r() * 160, hgt = 80 + r() * 140;
          wrapX(lw, x, (xx) => { c.beginPath(); c.moveTo(xx - w / 2 - 30, H * 0.62); c.lineTo(xx - w / 2, H * 0.62 - hgt); c.lineTo(xx + w / 2, H * 0.62 - hgt); c.lineTo(xx + w / 2 + 30, H * 0.62); c.closePath(); c.fillStyle = pal.far; c.fill(); });
        }
        c.fillStyle = pal.far; c.fillRect(0, H * 0.62 - 1, lw, H);
      });
      add(0.32, (c) => hillsLayer(c, lw, H, H * 0.7, 40, pal.mid, seed + 6, [1, 2, 3]));
      add(0.58, (c) => {
        hillsLayer(c, lw, H, H * 0.79, 22, pal.near, seed + 7, [2, 3]);
        for (let i = 0; i < 6; i++) { const x = r() * lw; wrapX(lw, x, (xx) => { c.save(); c.translate(xx, H * 0.76); c.scale(0.9, 0.9); c.fillStyle = pal.near; c.fillRect(-9, -70, 18, 76); c.fillRect(-30, -40, 12, 26); c.fillRect(-30, -24, 24, 10); c.fillRect(18, -54, 12, 26); c.fillRect(8, -36, 22, 10); c.restore(); }); }
      });
      break;
    }
    case 'cave': {
      add(0.2, (c) => {
        c.fillStyle = pal.far;
        for (let x = 0; x < lw; x += 26 + r() * 30) { const hgt = 40 + r() * 140; c.beginPath(); c.moveTo(x - 18, 0); c.lineTo(x, hgt); c.lineTo(x + 18, 0); c.fill(); }
        hillsLayer(c, lw, H, H * 0.8, 50, pal.far, seed + 8, [2, 5]);
      });
      add(0.45, (c) => {
        for (let i = 0; i < 14; i++) {
          const x = r() * lw, y = H * 0.55 + r() * H * 0.3, sz = 14 + r() * 26, col = r() < 0.5 ? pal.accent : pal.item;
          wrapX(lw, x, (xx) => {
            const gg = c.createRadialGradient(xx, y, 0, xx, y, sz * 3); gg.addColorStop(0, alpha(col, 0.35)); gg.addColorStop(1, alpha(col, 0)); c.fillStyle = gg; c.fillRect(xx - sz * 3, y - sz * 3, sz * 6, sz * 6);
            c.beginPath(); c.moveTo(xx, y - sz * 1.6); c.lineTo(xx + sz * 0.5, y); c.lineTo(xx - sz * 0.5, y); c.closePath(); c.fillStyle = col; c.fill();
          });
        }
        hillsLayer(c, lw, H, H * 0.88, 30, pal.mid, seed + 9, [3, 4]);
      });
      break;
    }
    case 'candy': {
      sun(W * 0.75, H * 0.16, 40, '#ffffff');
      for (let i = 0; i < 7; i++) { const x = r() * W, y = 80 + r() * 300; s.fillStyle = 'rgba(255,255,255,0.8)'; for (let k = 0; k < 4; k++) { s.beginPath(); s.arc(x + k * 26, y + Math.sin(k) * 6, 24 - Math.abs(k - 1.5) * 4, 0, Math.PI * 2); s.fill(); } }
      add(0.18, (c) => hillsLayer(c, lw, H, H * 0.6, 70, pal.far, seed + 10, [1, 2, 4]));
      add(0.4, (c) => {
        hillsLayer(c, lw, H, H * 0.7, 40, pal.mid, seed + 11, [2, 3]);
        for (let i = 0; i < 10; i++) {
          const x = r() * lw, y = H * 0.68, hgt = 70 + r() * 80, col = pal.tiles[i % pal.tiles.length];
          wrapX(lw, x, (xx) => { c.fillStyle = '#fff'; c.fillRect(xx - 3, y - hgt, 6, hgt); c.beginPath(); c.arc(xx, y - hgt, 22, 0, Math.PI * 2); c.fillStyle = col; c.fill(); c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 4; c.beginPath(); c.arc(xx, y - hgt, 12, 0, Math.PI * 1.5); c.stroke(); });
        }
      });
      add(0.6, (c) => hillsLayer(c, lw, H, H * 0.8, 24, pal.near, seed + 12, [3, 5]));
      break;
    }
    case 'moon': {
      stars(s, 180, W, H, 0.9);
      const ex = W * 0.25, ey = H * 0.17;
      const eg = s.createRadialGradient(ex - 16, ey - 16, 4, ex, ey, 60);
      eg.addColorStop(0, '#9fd8ff'); eg.addColorStop(0.6, '#2f6fd6'); eg.addColorStop(1, '#0d2c66');
      s.beginPath(); s.arc(ex, ey, 52, 0, Math.PI * 2); s.fillStyle = eg; s.fill();
      s.fillStyle = 'rgba(122,229,130,0.7)'; s.beginPath(); s.ellipse(ex - 10, ey - 8, 16, 10, 0.6, 0, 7); s.fill(); s.beginPath(); s.ellipse(ex + 18, ey + 14, 12, 8, -0.4, 0, 7); s.fill();
      add(0.15, (c) => hillsLayer(c, lw, H, H * 0.66, 50, pal.far, seed + 13, [1, 3]));
      add(0.35, (c) => {
        hillsLayer(c, lw, H, H * 0.74, 26, pal.mid, seed + 14, [2, 3]);
        for (let i = 0; i < 5; i++) {
          const x = r() * lw, y = H * 0.73, rad = 34 + r() * 40;
          wrapX(lw, x, (xx) => {
            c.beginPath(); c.arc(xx, y, rad, Math.PI, 0); c.closePath();
            const dg = c.createLinearGradient(0, y - rad, 0, y); dg.addColorStop(0, alpha(pal.accent, 0.5)); dg.addColorStop(1, alpha('#7ae582', 0.35)); c.fillStyle = dg; c.fill();
            c.strokeStyle = alpha('#ffffff', 0.6); c.lineWidth = 2; c.stroke();
            c.beginPath(); c.moveTo(xx, y - rad); c.lineTo(xx, y); c.moveTo(xx - rad * 0.7, y - rad * 0.7); c.lineTo(xx + rad * 0.7, y - rad * 0.7); c.stroke();
          });
        }
      });
      add(0.6, (c) => {
        hillsLayer(c, lw, H, H * 0.82, 16, pal.near, seed + 15, [3, 5]);
        for (let i = 0; i < 12; i++) { const x = r() * lw, y = H * 0.84 + r() * 60, rad = 6 + r() * 16; wrapX(lw, x, (xx) => { c.beginPath(); c.ellipse(xx, y, rad, rad * 0.35, 0, 0, Math.PI * 2); c.fillStyle = shade(pal.near, -0.25); c.fill(); }); }
      });
      break;
    }
    default:
      add(0.3, (c) => hillsLayer(c, lw, H, H * 0.7, 60, pal.mid, seed, [1, 2, 4]));
  }
  return { kind, sky, layers, lw };
}
function pine(c, x, y, h, col) {
  c.fillStyle = col;
  for (let k = 0; k < 3; k++) {
    const w = h * (0.42 - k * 0.09);
    const top = y - h * (0.35 + k * 0.3);
    c.beginPath(); c.moveTo(x, top - h * 0.25); c.lineTo(x + w, top + h * 0.3); c.lineTo(x - w, top + h * 0.3); c.closePath(); c.fill();
  }
  c.fillRect(x - h * 0.04, y - h * 0.1, h * 0.08, h * 0.14);
}

const AMBIENT = { space: 'stars', moon: 'stars', grid: 'stars', ocean: 'bubbles', snow: 'snow', forest: 'fireflies', cave: 'dust', candy: 'sparkles', city: 'dust', desert: 'dust', hills: 'pollen' };

// ---------- the Art object a game draws with ----------
/**
 * art.draw(ctx, role, x, y, size, opts) draws the player / enemy / item / hazard: the uploaded or AI image when
 * there is one, otherwise the recipe's procedural shape. art.bg(ctx, opts) draws the scene.
 */
export class Art {
  constructor(recipe, images = {}) {
    this.recipe = recipe;
    this.pal = PALETTES[recipe.palette] || PALETTES.amber;
    this.images = images;
    this.cache = new Map();
    this.scene = null;
    const r = rng(hash(`${recipe.seed}|amb`));
    this.amb = Array.from({ length: 46 }, () => [r(), r(), r(), r()]);
  }
  colors(role) {
    const p = this.pal;
    const main = role === 'player' ? p.player : role === 'enemy' ? p.enemy : role === 'hazard' ? p.hazard : role === 'item' ? p.item : (p[role] || role);
    return { main, ink: p.ink, glow: p.accent === main ? '#ffffff' : p.accent, glow2: role === 'enemy' ? '#ff3b3b' : '#7ae582' };
  }
  shapeOf(role) {
    const spec = this.recipe[role];
    return (spec && spec.shape) || { player: 'blob', enemy: 'bug', item: 'coin', hazard: 'spike' }[role] || role;
  }
  image(role) {
    const v = this.images[role];
    return v && !v.sheet ? v : null;
  }
  sheet(role) {
    const v = this.images[role];
    return v && v.sheet ? v : null;
  }
  /** Cached sprite canvas for a role (or a raw shape name), rendered at 2x for crisp scaling. */
  sprite(role, size, color = null) {
    const px = Math.max(16, Math.ceil((size * 2) / 16) * 16);
    const key = `${role}|${px}|${color || ''}`;
    let c = this.cache.get(key);
    if (c) return c;
    c = layerCanvas(px, px);
    const ctx = c.getContext('2d');
    const img = this.image(role);
    if (img) {
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const k = Math.min(px / iw, px / ih);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (px - iw * k) / 2, (px - ih * k) / 2, iw * k, ih * k);
    } else {
      const kind = SHAPES.includes(role) ? role : this.shapeOf(role);
      const col = color ? { ...this.colors('item'), main: color } : this.colors(SHAPES.includes(role) ? 'item' : role);
      drawShape(ctx, kind, px / 2, px / 2, px * 0.96, col);
    }
    if (this.cache.size > 300) this.cache.clear();
    this.cache.set(key, c);
    return c;
  }
  draw(ctx, role, x, y, size, { rot = 0, flip = false, sx = 1, sy = 1, alpha: a = 1, color = null, res = 0 } = {}) {
    const c = this.sprite(role, res || size, color);
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    ctx.scale(flip ? -sx : sx, sy);
    if (a < 1) ctx.globalAlpha = a;
    ctx.drawImage(c, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  /** Draw a frame of a sprite-sheet animation, feet at (x, y), `h` px tall. Returns false if no sheet. */
  drawAnim(ctx, role, anim, t, x, y, h, { flip = false, fps = 0, frame = null, alpha: a = 1 } = {}) {
    const s = this.sheet(role);
    if (!s) return false;
    const frames = s.anims[anim] || s.anims[Object.keys(s.anims)[0]];
    if (!frames?.length) return false;
    const i = frame != null ? Math.min(frames.length - 1, Math.max(0, frame)) : Math.floor(t * (fps || s.fps || 12)) % frames.length;
    const f = frames[i];
    const cols = Math.max(1, Math.floor(s.img.width / s.cw));
    const fx = (f % cols) * s.cw;
    const fy = Math.floor(f / cols) * s.ch;
    const k = h / s.ch;
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    if (a < 1) ctx.globalAlpha = a;
    ctx.imageSmoothingEnabled = !s.pixel;
    ctx.drawImage(s.img, fx, fy, s.cw, s.ch, -s.cw * k * (s.ax ?? 0.5), -s.ch * k * (s.ay ?? 1), s.cw * k, s.ch * k);
    ctx.restore();
    return true;
  }
  /**
   * The background. mode 'scroll' tiles horizontally with parallax (runners); 'cover' fills the frame.
   * x: horizontal scroll in world px; t: seconds (ambient motion); zone: which uploaded/stage image to show.
   */
  bg(ctx, { x = 0, t = 0, zone = 0, mode = 'cover', vy = 0, dim = 0, ambient = true } = {}) {
    const imgs = this.images.bg ? (Array.isArray(this.images.bg) ? this.images.bg : [this.images.bg]) : null;
    if (imgs?.length) {
      const img = imgs[zone % imgs.length];
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      if (mode === 'scroll') {
        // images play one after another (stage to stage), each seam crossfaded, so nothing looks mirrored
        const h = this.recipe.genre === 'runner' ? 900 : H;
        const w = (iw / ih) * h;
        const fade = Math.round(w * 0.12);
        const span = w - fade;
        ctx.fillStyle = this.pal.sky[0];
        ctx.fillRect(0, 0, W, H);
        const pos = x * 0.35;
        const first = Math.floor(pos / span);
        for (let k = first; k * span - pos < W; k++) {
          const left = k * span - pos;
          const im = imgs[((k % imgs.length) + imgs.length) % imgs.length];
          ctx.drawImage(this.seam(im, imgs[(((k - 1) % imgs.length) + imgs.length) % imgs.length], w, h, fade), Math.round(left), 0);
        }
      } else {
        const k = Math.max(W / iw, H / ih);
        ctx.drawImage(img, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
      }
    } else {
      if (!this.scene) this.scene = buildScene(this.recipe.world?.scene || 'hills', this.pal, this.recipe.seed);
      const sc = this.scene;
      ctx.drawImage(sc.sky, 0, 0, W, H);
      for (const L of sc.layers) {
        const off = mode === 'scroll' ? -(((x * L.speed) % sc.lw) + sc.lw) % sc.lw : -(((t * 8 * L.speed) % sc.lw) + sc.lw) % sc.lw;
        ctx.drawImage(L.c, off, 0);
        if (off + sc.lw < W) ctx.drawImage(L.c, off + sc.lw, 0);
      }
    }
    if (dim > 0) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, W, H); }
    if (ambient) this.ambient(ctx, t, x, vy);
  }
  /** An image scaled to w x h whose first `fade` columns blend in from the end of `prev`. Cached. */
  seam(img, prev, w, h, fade) {
    this.seams = this.seams || new Map();
    const key = `${this.imgId(img)}|${this.imgId(prev)}|${Math.round(w)}`;
    let c = this.seams.get(key);
    if (c) return c;
    c = layerCanvas(Math.ceil(w), h);
    const ctx = c.getContext('2d');
    const pw = prev.naturalWidth || prev.width;
    const ph = prev.naturalHeight || prev.height;
    const sx = pw - (fade / w) * pw;
    ctx.drawImage(prev, sx, 0, pw - sx, ph, 0, 0, fade, h);
    const t = layerCanvas(Math.ceil(w), h);
    const tc = t.getContext('2d');
    tc.drawImage(img, 0, 0, w, h);
    tc.globalCompositeOperation = 'destination-in';
    const g = tc.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(fade / w, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    tc.fillStyle = g;
    tc.fillRect(0, 0, w, h);
    ctx.drawImage(t, 0, 0);
    this.seams.set(key, c);
    return c;
  }
  imgId(img) {
    this.ids = this.ids || new WeakMap();
    if (!this.ids.has(img)) this.ids.set(img, (this.idN = (this.idN || 0) + 1));
    return this.ids.get(img);
  }
  ambient(ctx, t, x = 0, vy = 0) {
    const kind = AMBIENT[this.recipe.world?.scene] || 'dust';
    const n = kind === 'stars' ? 30 : 22;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const [a, b, c, d] = this.amb[i];
      let px, py;
      if (kind === 'bubbles') {
        py = H - (((b * H + t * (30 + c * 50) + vy * t * 0.2) % (H + 40)));
        px = ((a * W + Math.sin(t * (1 + d) + i) * 14 - x * 0.2) % W + W) % W;
        ctx.globalAlpha = 0.35; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, 2 + c * 6, 0, 7); ctx.stroke();
      } else if (kind === 'snow') {
        py = ((b * H + t * (40 + c * 60) + vy * t * 0.3) % H);
        px = ((a * W + Math.sin(t * (0.6 + d) + i) * 20 - x * (0.3 + c * 0.4)) % W + W) % W;
        ctx.globalAlpha = 0.5 + c * 0.4; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, 1.5 + c * 2.5, 0, 7); ctx.fill();
      } else if (kind === 'stars') {
        px = ((a * W - x * 0.05) % W + W) % W;
        py = ((b * H + vy * t * (0.4 + c)) % H + H) % H;
        ctx.globalAlpha = 0.25 + 0.6 * Math.abs(Math.sin(t * (0.5 + d * 2) + i));
        ctx.fillStyle = '#fff';
        const s = 1 + c * 2;
        ctx.fillRect(px, py, s, s);
      } else if (kind === 'fireflies' || kind === 'sparkles') {
        px = ((a * W + Math.sin(t * 0.4 + i) * 40 - x * 0.4) % W + W) % W;
        py = b * H * 0.8 + Math.cos(t * 0.5 + i * 2) * 30;
        ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(t * (1 + d) + i));
        ctx.fillStyle = kind === 'sparkles' ? '#fff' : this.pal.accent;
        ctx.beginPath(); ctx.arc(px, py, 1.5 + c * 2, 0, 7); ctx.fill();
      } else {
        px = ((a * W + t * (6 + c * 12) - x * (0.5 + c * 0.5)) % W + W) % W;
        py = ((b * H + Math.sin(t * 0.3 + i) * 30 + vy * t * 0.3) % H + H) % H;
        ctx.globalAlpha = 0.12 + c * 0.2; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, 1 + c * 2, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  }
}

/** Resolve the image URLs in recipe.art (static paths or data: URIs) into an images object for new Art(). */
export async function loadArt(recipe, extra = {}) {
  const images = { ...extra };
  const a = recipe.art || {};
  const jobs = [];
  for (const role of ['player', 'enemy', 'item', 'hazard']) {
    const v = a[role];
    if (images[role] || !v) continue;
    if (typeof v === 'string') jobs.push(loadImage(v).then((img) => { images[role] = img; }).catch(() => {}));
    else if (isSheet(v)) jobs.push(loadImage(v.src).then((img) => { images[role] = { sheet: true, img, cw: v.cw, ch: v.ch, anims: v.anims || {}, fps: v.fps || 12, ax: v.ax ?? 0.5, ay: v.ay ?? 1, pixel: !!v.pixel }; }).catch(() => {}));
  }
  if (!images.bg && a.bg) {
    const list = Array.isArray(a.bg) ? a.bg : [a.bg];
    jobs.push(Promise.all(list.map((u) => loadImage(u).catch(() => null))).then((imgs) => { const ok = imgs.filter(Boolean); if (ok.length) images.bg = ok; }));
  }
  await Promise.all(jobs);
  return new Art(recipe, images);
}
