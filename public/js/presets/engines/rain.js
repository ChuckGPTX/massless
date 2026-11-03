// Rains: stylised money, confetti, petals, snow and fireworks with real depth. Each particle has a depth; the far
// ones fall behind the subject (the subject is redrawn over them from its matte) and the near ones in front.
// Motion is a closed function of time, so every clip loops seamlessly.
import { canvas, cover, rng, clamp, ease } from '../common.js';

export const kind = 'video';
const COUNTS = { money: 70, confetti: 190, petals: 110, snow: 200, fireworks: 0 };

export async function prepare(spec, io) {
  const L = await io.layers('photo');
  const img = L.img;
  let subject = null;
  if (L.matte) {
    subject = canvas(img.width, img.height);
    const sg = subject.getContext('2d');
    sg.drawImage(L.matte, 0, 0, img.width, img.height);
    sg.globalCompositeOperation = 'source-in';
    sg.drawImage(img, 0, 0);
  }
  return { kind: spec.kind, img, subject, sprites: sprites(spec.kind) };
}

// ---------- sprites, drawn once ----------
function sprites(kind) {
  const out = [];
  if (kind === 'money') {
    for (const [tone, ink] of [['#cfe3b8', '#3f6b3a'], ['#d9e9c6', '#466f3e'], ['#c4dcb0', '#355f33']]) {
      const c = canvas(240, 110), g = c.getContext('2d');
      g.fillStyle = tone; g.beginPath(); g.roundRect(0, 0, 240, 110, 6); g.fill();
      g.strokeStyle = ink; g.lineWidth = 4; g.beginPath(); g.roundRect(8, 8, 224, 94, 4); g.stroke();
      g.lineWidth = 1.2; g.globalAlpha = 0.5;
      for (let i = 0; i < 9; i++) { g.beginPath(); for (let x = 14; x <= 226; x += 4) g.lineTo(x, 22 + i * 8 + Math.sin(x * 0.08 + i) * 3); g.stroke(); }
      g.globalAlpha = 1;
      // a plain star medallion: no portrait, no currency marks
      g.fillStyle = tone; g.beginPath(); g.arc(120, 55, 30, 0, Math.PI * 2); g.fill();
      g.strokeStyle = ink; g.lineWidth = 3; g.stroke();
      g.fillStyle = ink; g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 9 : 20; g.lineTo(120 + Math.cos(a) * r, 55 + Math.sin(a) * r); }
      g.fill();
      g.fillRect(24, 22, 26, 26); g.fillRect(190, 62, 26, 26);
      out.push(c);
    }
    const coin = canvas(90, 90), cg = coin.getContext('2d');
    const gr = cg.createRadialGradient(35, 30, 4, 45, 45, 45);
    gr.addColorStop(0, '#fff3b0'); gr.addColorStop(0.5, '#f2c230'); gr.addColorStop(1, '#a8740c');
    cg.fillStyle = gr; cg.beginPath(); cg.arc(45, 45, 43, 0, Math.PI * 2); cg.fill();
    cg.strokeStyle = 'rgba(120,80,0,0.6)'; cg.lineWidth = 4; cg.beginPath(); cg.arc(45, 45, 32, 0, Math.PI * 2); cg.stroke();
    out.coin = coin;
  } else if (kind === 'confetti') {
    for (const col of ['#ff4d6d', '#ffd23f', '#3ec1d3', '#7b5cff', '#ff8c42', '#4ade80', '#ffffff']) {
      const c = canvas(40, 18), g = c.getContext('2d');
      g.fillStyle = col; g.fillRect(0, 0, 40, 18);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, 40, 5);
      out.push(c);
    }
  } else if (kind === 'petals') {
    for (const [a, b] of [['#ffd6e0', '#f48fb1'], ['#ffe4ec', '#f8a5c2'], ['#fff0f5', '#f6b8cf']]) {
      const c = canvas(60, 60), g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 60, 60); gr.addColorStop(0, a); gr.addColorStop(1, b);
      g.fillStyle = gr; g.beginPath(); g.moveTo(30, 4); g.bezierCurveTo(58, 10, 56, 44, 30, 56); g.bezierCurveTo(4, 44, 2, 10, 30, 4); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(24, 22, 6, 12, -0.4, 0, Math.PI * 2); g.fill();
      out.push(c);
    }
  } else if (kind === 'snow') {
    for (const blur of [0, 1]) {
      const c = canvas(64, 64), g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(blur ? 0.2 : 0.45, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      out.push(c);
    }
  }
  return out;
}

// ---------- particles ----------
function particles(kind, amount, w, h, D) {
  const r = rng(kind.length * 97 + 3);
  const n = Math.round((COUNTS[kind] || 80) * amount * Math.sqrt((w * h) / (1080 * 1350)));
  const list = [];
  for (let i = 0; i < n; i++) {
    const z = r();
    const cycles = kind === 'snow' ? 1 : 1 + (r() < 0.5 ? 1 : 0);
    list.push({ z, x: r(), phase: r(), cycles, sway: r() * Math.PI * 2, swayAmp: 0.01 + r() * 0.03, spin: (r() - 0.5) * 6, flip: 2 + r() * 5, sprite: Math.floor(r() * 7), coin: r() < 0.25, size: 0.7 + r() * 0.6 });
  }
  return list.sort((a, b) => a.z - b.z);
}

export function render(ctx, c, { w, h, t, duration, params }) {
  const g = c.getContext('2d');
  const D = duration || 5, T = t == null ? D * 0.5 : t;
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  const zoom = 1.02 + 0.03 * Math.sin((T / D) * Math.PI * 2) * 0.5;
  const P = cover(g, ctx.img, 0, 0, w, h, { zoom });
  const night = ctx.kind === 'fireworks' && params.night !== false;
  if (night) { g.fillStyle = 'rgba(70,78,130,0.5)'; g.globalCompositeOperation = 'multiply'; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(10,14,40,0.25)'; g.fillRect(0, 0, w, h); }
  if (ctx.kind === 'snow') { g.fillStyle = 'rgba(200,220,255,0.12)'; g.fillRect(0, 0, w, h); }
  const amount = params.amount ?? 1;
  if (ctx.kind === 'fireworks') {
    const flash = fireworks(g, w, h, T, D, amount);
    drawSubject(ctx, g, P, night, flash);
    return;
  }
  const list = (ctx._list && ctx._list.w === w && ctx._list.a === amount) ? ctx._list.p : (ctx._list = { w, a: amount, p: particles(ctx.kind, amount, w, h, D) }).p;
  const behind = ctx.subject ? 0.55 : -1;
  let i = 0;
  for (; i < list.length && list[i].z < behind; i++) drawParticle(ctx, g, list[i], w, h, T, D);
  drawSubject(ctx, g, P, false, null);
  for (; i < list.length; i++) drawParticle(ctx, g, list[i], w, h, T, D);
}

function drawSubject(ctx, g, P, night, flash) {
  if (!ctx.subject) return;
  if (!night) { g.drawImage(ctx.subject, P.ox, P.oy, P.dw, P.dh); return; }
  // at night the subject stays a little brighter than the sky and picks up the burst colour
  const s = canvas(g.canvas.width, g.canvas.height), sg = s.getContext('2d');
  sg.drawImage(ctx.subject, P.ox, P.oy, P.dw, P.dh);
  sg.globalCompositeOperation = 'source-atop';
  sg.fillStyle = 'rgba(10,12,30,0.42)'; sg.fillRect(0, 0, s.width, s.height);
  if (flash && flash.a > 0) { sg.globalCompositeOperation = 'source-atop'; sg.fillStyle = `rgba(${flash.rgb.join(',')},${flash.a * 0.3})`; sg.fillRect(0, 0, s.width, s.height); }
  g.drawImage(s, 0, 0);
}

function drawParticle(ctx, g, p, w, h, T, D) {
  const k = ctx.kind;
  const scale = (0.45 + p.z * 1.15) * p.size * (Math.min(w, h) / 1080);
  const y = ((p.phase + (T / D) * p.cycles) % 1) * (h * 1.3) - h * 0.15;
  const x = (p.x + Math.sin(p.sway + (T / D) * Math.PI * 2 * p.cycles) * p.swayAmp * (k === 'snow' ? 1.5 : 1)) * w;
  const ang = (Math.round(p.spin) || 1) * (T / D) * Math.PI * 2;
  const flipA = Math.cos((T / D) * Math.PI * 2 * Math.round(p.flip));
  g.save();
  g.translate(x, y);
  g.globalAlpha = k === 'snow' ? 0.55 + p.z * 0.45 : 1;
  if (p.z > 0.88 && k !== 'snow') g.filter = `blur(${(scale * 3).toFixed(1)}px)`;
  if (p.z < 0.2) g.globalAlpha *= 0.75;
  if (k === 'money') {
    if (p.coin) { const s = ctx.sprites.coin; g.rotate(ang); g.scale(scale * 0.55 * Math.max(0.15, Math.abs(flipA)), scale * 0.55); g.drawImage(s, -s.width / 2, -s.height / 2); }
    else {
      const s = ctx.sprites[p.sprite % ctx.sprites.length];
      g.rotate(ang * 0.4 + p.sway);
      g.scale(scale * 0.7 * flipA, scale * 0.7 * (0.75 + 0.25 * Math.cos((T / D) * Math.PI * 2 * Math.round(p.flip) + 1)));
      g.drawImage(s, -s.width / 2, -s.height / 2);
      if (flipA < 0) { g.globalAlpha *= 0.25; g.fillStyle = '#000'; g.fillRect(-s.width / 2, -s.height / 2, s.width, s.height); }
    }
  } else if (k === 'confetti') {
    const s = ctx.sprites[p.sprite % ctx.sprites.length];
    g.rotate(ang);
    g.scale(scale * 1.3, scale * 1.3 * Math.max(0.12, Math.abs(flipA)));
    g.drawImage(s, -s.width / 2, -s.height / 2);
  } else if (k === 'petals') {
    const s = ctx.sprites[p.sprite % ctx.sprites.length];
    g.rotate(ang * 0.6);
    g.scale(scale * 1.1 * Math.max(0.2, Math.abs(flipA)), scale * 1.1);
    g.drawImage(s, -s.width / 2, -s.height / 2);
  } else if (k === 'snow') {
    const s = ctx.sprites[p.z > 0.8 ? 1 : 0];
    const sz = scale * (p.z > 0.8 ? 0.55 : 0.3);
    g.scale(sz, sz);
    g.drawImage(s, -s.width / 2, -s.height / 2);
  }
  g.restore();
}

function fireworks(g, w, h, T, D, amount) {
  const r = rng(42);
  const bursts = Math.max(4, Math.round(8 * amount));
  const cols = [[255, 210, 90], [255, 90, 120], [120, 200, 255], [190, 120, 255], [120, 255, 170], [255, 255, 255]];
  let flash = { a: 0, rgb: [255, 220, 160] };
  g.save();
  g.globalCompositeOperation = 'lighter';
  const u = Math.min(w, h);
  for (let b = 0; b < bursts; b++) {
    const start = (b / bursts) * D + r() * 0.3, cx = (0.15 + r() * 0.7) * w, cy = (0.1 + r() * 0.35) * h, col = cols[Math.floor(r() * cols.length)];
    const R = u * (0.24 + r() * 0.16), n = 60;
    for (const offset of [0, D]) {
      const age = T - start + offset;
      if (age < -0.6 || age > 2.2) continue;
      if (age < 0) {
        // the rocket's trail
        const p = 1 + age / 0.6;
        const y = h * 1.05 - (h * 1.05 - cy) * ease.out(p);
        g.fillStyle = `rgba(255,230,180,${0.8 * p})`;
        g.beginPath(); g.arc(cx, y, u * 0.004, 0, Math.PI * 2); g.fill();
        continue;
      }
      const life = clamp(1 - age / 2.2);
      if (age < 0.25) flash = { a: Math.max(flash.a, 1 - age / 0.25), rgb: col };
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + b, sp = 0.75 + ((i * 37) % 11) / 22;
        const dist = R * sp * ease.out(clamp(age / 1.4));
        const x = cx + Math.cos(a) * dist, y = cy + Math.sin(a) * dist + age * age * u * 0.035;
        const s = u * 0.0058 * (0.5 + life);
        g.fillStyle = `rgba(${col.join(',')},${life * 0.95})`;
        g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
        // a short trail toward the centre
        g.strokeStyle = `rgba(${col.join(',')},${life * 0.35})`;
        g.lineWidth = s * 0.8;
        g.beginPath(); g.moveTo(x, y); g.lineTo(cx + Math.cos(a) * dist * 0.82, cy + Math.sin(a) * dist * 0.82 + age * age * u * 0.03); g.stroke();
      }
      const glow = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.4);
      glow.addColorStop(0, `rgba(${col.join(',')},${0.22 * life * life})`); glow.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = glow; g.fillRect(cx - R * 1.5, cy - R * 1.5, R * 3, R * 3);
    }
  }
  g.restore();
  return flash;
}
