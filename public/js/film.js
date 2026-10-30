// Kinetic film engine: a beat sheet (spec) drawn on a canvas, frame by frame, locked to a tempo.
// Every block lives on the beat grid, so cuts land on the music. Motion blur comes from averaging
// sub-frames across a 180° shutter, the way a real camera smears fast motion.

const DISPLAY = "'Big Shoulders Display', 'Arial Narrow', Impact, sans-serif";
const UI = "'Instrument Sans', system-ui, sans-serif";

export const PALETTES = {
  amber: { name: 'Amber', grounds: ['#0b0b0c', '#ffbf2f', '#f4f4f1', '#16161a'], accent: '#ffbf2f', hot: '#ff4f6d' },
  neon: { name: 'Neon', grounds: ['#07070b', '#ff2e88', '#2b2bff', '#f2f2f2'], accent: '#ff2e88', hot: '#00e5ff' },
  acid: { name: 'Acid', grounds: ['#0a0a0a', '#c6ff00', '#ececec', '#ff3d00'], accent: '#c6ff00', hot: '#ff3d00' },
  mono: { name: 'Mono', grounds: ['#000000', '#ffffff', '#1a1a1a', '#e9e9e9'], accent: '#ffffff', hot: '#ff2b2b' },
  ocean: { name: 'Ocean', grounds: ['#04121f', '#00c2ff', '#f1f7fb', '#0a2a43'], accent: '#00c2ff', hot: '#ffd23f' },
};

export const BLOCKS = {
  words: { name: 'Words', hint: 'One idea per beat: slams and stacks' },
  strike: { name: 'Strike', hint: 'The old way, struck out, then the new one' },
  hero: { name: 'Hero', hint: 'The name in 3D, orbited and lit' },
  prompt: { name: 'Prompt', hint: 'The brief types, Enter is the drop' },
  counter: { name: 'Counter', hint: 'A number on slot reels' },
  stretch: { name: 'Stretch', hint: 'Type that breathes on the beat' },
  fly: { name: 'Fly', hint: 'A camera through 3D words' },
  image: { name: 'Image', hint: 'A still with a push and words on top' },
  graph: { name: 'Graph', hint: 'A curve that climbs to a number' },
  logo: { name: 'Logo', hint: 'The end card, on the last hit' },
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = {
  out: (t) => 1 - Math.pow(1 - clamp01(t), 3),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(t))),
  inOut: (t) => { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
  in: (t) => clamp01(t) ** 3,
  back: (t) => { t = clamp01(t); const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
};
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}
const inkOn = (bg, pal) => (lum(bg) > 0.55 ? '#0b0b0c' : bg === pal.grounds[0] || lum(bg) < 0.12 ? '#f6f6f2' : '#ffffff');
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

/** Lay the blocks on the beat grid. Returns { blocks: [...with start, end], beats, dropBeat, endBeat, cuts }. */
export function layout(spec) {
  let b = 0;
  const blocks = spec.blocks.map((blk, i) => {
    const beats = Math.max(1, Math.round(blk.beats || 4));
    const out = { ...blk, i, beats, start: b, end: b + beats, in: blk.in || (i === 0 ? 'cut' : ['whip', 'cut', 'zoom'][i % 3]) };
    b += beats;
    return out;
  });
  const dropIdx = Math.max(0, blocks.findIndex((x) => x.drop));
  const dropBeat = blocks[dropIdx]?.start ?? 0;
  const endBeat = blocks.length ? blocks[blocks.length - 1].start : b;
  const cuts = [];
  for (const blk of blocks) {
    const kind = blk.type === 'logo' ? null : blk.in === 'whip' ? 'whoosh' : blk.in === 'zoom' ? 'boom' : 'hit';
    if (kind && blk.start > 0 && blk.start !== dropBeat) cuts.push({ beat: blk.start, kind, gain: 0.8 });
    // inner beat accents
    if (blk.type === 'words' || blk.type === 'image' || blk.type === 'fly') for (let k = 1; k < blk.beats; k++) cuts.push({ beat: blk.start + k, kind: k % 2 ? 'snap' : 'hit', gain: 0.45 });
    if (blk.type === 'strike') cuts.push({ beat: blk.start + 1, kind: 'glitch', gain: 0.7 }, { beat: blk.start + 2, kind: 'hit', gain: 0.8 });
    if (blk.type === 'counter') for (let k = 0; k < blk.beats * 2; k++) cuts.push({ beat: blk.start + k / 2, kind: 'tick', gain: 0.35 });
    if (blk.type === 'prompt') {
      const n = Math.min(40, (blk.text || '').length);
      const typeBeats = Math.max(1, blk.beats - 1.5);
      for (let k = 0; k < n; k += 2) cuts.push({ beat: blk.start + 0.25 + (k / n) * typeBeats, kind: 'click', gain: 0.4 });
    }
  }
  return { blocks, beats: b, dropBeat, endBeat, cuts: cuts.sort((x, y) => x.beat - y.beat) };
}

/** Pacing checks, the way Scenario measures its films. */
export function check(lay, bpm) {
  const sec = 60 / bpm;
  const dur = lay.beats * sec;
  const hardCuts = lay.blocks.length - 1 + lay.cuts.filter((c) => c.kind === 'hit' || c.kind === 'snap').length;
  let longest = 0;
  for (const b of lay.blocks) {
    if (b.type === 'logo') continue;
    const per = b.type === 'words' || b.type === 'image' || b.type === 'fly' || b.type === 'counter' ? 1 : b.type === 'prompt' ? 0.5 : b.beats;
    longest = Math.max(longest, per * sec * (b.type === 'hero' || b.type === 'graph' || b.type === 'stretch' ? 0.25 : 1));
  }
  return { duration: dur, cutsPer10: (hardCuts / dur) * 10, longestHold: longest, blocks: lay.blocks.length };
}

// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------

function fitFont(g, text, maxW, maxH, weight = 900, family = DISPLAY) {
  let size = maxH;
  g.font = `${weight} ${size}px ${family}`;
  const w = g.measureText(text).width || 1;
  if (w > maxW) size = (size * maxW) / w;
  return Math.max(8, Math.floor(size));
}
function slab(g, text, x, y, size, color, { weight = 900, align = 'center', family = DISPLAY, spacing = 0 } = {}) {
  g.font = `${weight} ${size}px ${family}`;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillStyle = color;
  if (spacing && 'letterSpacing' in g) g.letterSpacing = `${spacing}px`;
  g.fillText(text, x, y);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}

// ---------------------------------------------------------------------------------------------
// Blocks. Each draws one frame: (g, W, H, lb = local beat, blk, env) where env has { pal, ground(k), images, spec, fps }
// ---------------------------------------------------------------------------------------------

const R = {};

R.words = (g, W, H, lb, blk, env) => {
  const words = (blk.words && blk.words.length ? blk.words : ['WORDS']).slice(0, 8);
  const k = Math.min(words.length - 1, Math.floor(lb * (words.length / blk.beats)));
  const per = blk.beats / words.length;
  const f = (lb - k * per) / per; // 0..1 within this word
  const bg = env.ground(blk.i * 3 + k);
  const ink = inkOn(bg, env.pal);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const mode = blk.mode || 'slam';
  const word = words[k].toUpperCase();
  if (mode === 'stack') {
    const shown = words.slice(0, k + 1);
    const lh = Math.min(H * 0.8 / words.length, H * 0.26);
    shown.forEach((w, j) => {
      const yy = H / 2 + (j - (words.length - 1) / 2) * lh;
      const sz = fitFont(g, w.toUpperCase(), W * 0.86, lh * 0.95);
      const p = j === k ? ease.outExpo(f * 3) : 1;
      g.save();
      g.translate(0, (1 - p) * lh * 0.8);
      g.globalAlpha = p;
      slab(g, w.toUpperCase(), W / 2, yy, sz, j === k ? (ink === '#0b0b0c' ? '#0b0b0c' : env.pal.accent) : ink);
      g.restore();
    });
    return;
  }
  if (mode === 'split') {
    const sz = fitFont(g, word, W * 0.9, H * 0.6);
    const p = ease.outExpo(f * 2.5);
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H / 2);
    g.clip();
    slab(g, word, W / 2 - (1 - p) * W * 0.6, H / 2, sz, ink);
    g.restore();
    g.save();
    g.beginPath();
    g.rect(0, H / 2, W, H / 2);
    g.clip();
    slab(g, word, W / 2 + (1 - p) * W * 0.6, H / 2, sz, ink);
    g.restore();
    return;
  }
  // slam: comes in big and fast, settles, drifts
  const sz = fitFont(g, word, W * 0.9, H * (word.length <= 4 ? 0.72 : 0.56));
  const s = 1 + 0.9 * (1 - ease.outExpo(f * 3.2)) + 0.05 * f;
  g.save();
  g.translate(W / 2, H / 2);
  g.scale(s, s);
  g.rotate((1 - ease.out(f * 3)) * (k % 2 ? 0.05 : -0.05));
  slab(g, word, 0, 0, sz, ink);
  g.restore();
};

R.strike = (g, W, H, lb, blk, env) => {
  const before = lb < 2;
  const bg = before ? env.ground(0) : env.pal.accent;
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const ink = inkOn(bg, env.pal);
  if (before) {
    const text = (blk.text || 'THE OLD WAY').toUpperCase();
    const sz = fitFont(g, text, W * 0.84, H * 0.36);
    slab(g, text, W / 2, H / 2, sz, '#8a8a90');
    const p = ease.outExpo((lb - 1) * 2.4);
    if (lb >= 1) {
      g.font = `900 ${sz}px ${DISPLAY}`;
      const tw = g.measureText(text).width;
      g.fillStyle = env.pal.hot;
      g.fillRect(W / 2 - tw / 2 - sz * 0.08, H / 2 - sz * 0.06, (tw + sz * 0.16) * p, sz * 0.12);
      const no = 'NO';
      const nsz = sz * 0.5 * (1 + 0.6 * (1 - ease.outExpo((lb - 1) * 4)));
      slab(g, no, W / 2, H / 2 - sz * 0.75, nsz, env.pal.hot);
    }
    return;
  }
  const text = (blk.then || 'THE NEW WAY').toUpperCase();
  const f = lb - 2;
  const sz = fitFont(g, text, W * 0.88, H * 0.5);
  const s = 1 + 0.7 * (1 - ease.outExpo(f * 3));
  g.save();
  g.translate(W / 2, H / 2);
  g.scale(s, s);
  slab(g, text, 0, 0, sz, ink);
  g.restore();
};

function extruded(g, text, size, depth, face, side, angle) {
  g.font = `900 ${size}px ${DISPLAY}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const dx = Math.sin(angle) * size * 0.012;
  const dy = size * 0.009;
  for (let i = depth; i > 0; i--) {
    g.fillStyle = side(i / depth);
    g.fillText(text, dx * i, dy * i);
  }
  g.fillStyle = face;
  g.fillText(text, 0, 0);
}

R.hero = (g, W, H, lb, blk, env) => {
  const bg = env.ground(0);
  const t = lb / blk.beats;
  const grad = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
  grad.addColorStop(0, '#26262c');
  grad.addColorStop(1, bg);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const text = (blk.text || env.spec.title || 'MASSLESS').toUpperCase();
  const sz = fitFont(g, text, W * 0.78, H * 0.42);
  const angle = -0.9 + 1.8 * ease.inOut(t);
  const s = 0.86 + 0.18 * ease.out(t * 1.3) + 0.25 * (1 - ease.outExpo(lb * 2));
  g.save();
  g.translate(W / 2, H / 2);
  g.scale(s * (0.82 + 0.18 * Math.cos(angle)), s);
  g.transform(1, 0, Math.sin(angle) * -0.18, 1, 0, 0);
  const acc = env.pal.accent;
  extruded(g, text, sz, 26, '#f7f7f3', (d) => `rgba(${hexRgb(acc)},${0.95 - d * 0.55})`, angle);
  // light sweep across the face
  g.globalCompositeOperation = 'source-atop';
  const sx = (-0.7 + 1.4 * ease.inOut(t)) * W;
  const lg = g.createLinearGradient(sx - W * 0.2, 0, sx + W * 0.2, 0);
  lg.addColorStop(0, 'rgba(255,255,255,0)');
  lg.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  lg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = lg;
  g.fillRect(-W, -H, W * 2, H * 2);
  g.restore();
  g.globalCompositeOperation = 'source-over';
  if (blk.sub) {
    const p = ease.out((lb - 1) * 1.5);
    g.globalAlpha = p;
    const ssz = Math.min(H * 0.05, W * 0.035);
    slab(g, blk.sub.toUpperCase(), W / 2, H * 0.8 + (1 - p) * 20, ssz, '#b9b9c0', { weight: 600, family: UI, spacing: ssz * 0.25 });
    g.globalAlpha = 1;
  }
};

function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; }

R.prompt = (g, W, H, lb, blk, env) => {
  const enterAt = blk.beats - 1;
  const after = lb >= enterAt;
  g.fillStyle = after ? env.pal.accent : '#0c0c0e';
  g.fillRect(0, 0, W, H);
  const text = blk.text || 'make a launch film';
  const typeBeats = Math.max(1, blk.beats - 1.5);
  const n = Math.round(clamp01((lb - 0.25) / typeBeats) * text.length);
  const bw = Math.min(W * 0.84, H * 1.6);
  const fs = Math.min(bw / 24, H * 0.05);
  const bh = fs * 3.4;
  const pulse = after ? 1 + 0.08 * (1 - ease.outExpo((lb - enterAt) * 3)) : 1;
  g.save();
  g.translate(W / 2, H / 2);
  g.scale(pulse, pulse);
  roundRect(g, -bw / 2, -bh / 2, bw, bh, fs * 0.9);
  g.fillStyle = after ? '#0b0b0c' : '#18181c';
  g.fill();
  g.lineWidth = Math.max(1.5, fs * 0.08);
  g.strokeStyle = after ? '#0b0b0c' : '#333338';
  g.stroke();
  g.font = `500 ${fs}px ${UI}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillStyle = '#f4f4f1';
  let shown = text.slice(0, n);
  const maxW = bw - fs * 6.2;
  while (shown.length > 1 && g.measureText(shown).width > maxW) shown = shown.slice(1);
  g.fillText(shown, -bw / 2 + fs * 1.1, 0);
  const cw = g.measureText(shown).width;
  if (!after && Math.floor(lb * 4) % 2 === 0) g.fillRect(-bw / 2 + fs * 1.2 + cw, -fs * 0.6, fs * 0.08 + 1, fs * 1.2);
  // the send button
  const r = bh * 0.34;
  g.beginPath();
  g.arc(bw / 2 - r - fs * 0.5, 0, r, 0, Math.PI * 2);
  g.fillStyle = env.pal.accent;
  g.fill();
  g.strokeStyle = '#0b0b0c';
  g.lineWidth = r * 0.16;
  g.beginPath();
  g.moveTo(bw / 2 - r - fs * 0.5, r * 0.45);
  g.lineTo(bw / 2 - r - fs * 0.5, -r * 0.45);
  g.moveTo(bw / 2 - r - fs * 0.5 - r * 0.38, -r * 0.08);
  g.lineTo(bw / 2 - r - fs * 0.5, -r * 0.45);
  g.lineTo(bw / 2 - r - fs * 0.5 + r * 0.38, -r * 0.08);
  g.stroke();
  g.restore();
  if (!after) {
    slab(g, (blk.label || 'DESCRIBE IT').toUpperCase(), W / 2, H / 2 - bh * 1.25, fs * 0.9, '#77777f', { weight: 600, family: UI, spacing: fs * 0.2 });
  } else {
    const p = ease.outExpo((lb - enterAt) * 2);
    slab(g, 'ENTER', W / 2, H / 2 + bh * (0.9 + 0.3 * p), fs * 1.1, '#0b0b0c', { weight: 700, family: UI, spacing: fs * 0.35 });
  }
};

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

R.counter = (g, W, H, lb, blk, env) => {
  const bg = env.ground(1);
  const ink = inkOn(bg, env.pal);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const to = Math.max(0, Math.round(Number(blk.to) || 0));
  const digits = String(to).split('');
  const settle = Math.max(1, blk.beats - 1);
  const sz = fitFont(g, `${'0'.repeat(digits.length)}${blk.suffix || ''}`, W * 0.84, H * 0.5);
  g.font = `900 ${sz}px ${DISPLAY}`;
  const dw = g.measureText('0').width * 1.04;
  const suffix = (blk.suffix || '').toUpperCase();
  const sw = suffix ? g.measureText(suffix).width : 0;
  const total = dw * digits.length + sw;
  let x = W / 2 - total / 2;
  digits.forEach((d, i) => {
    const land = settle * ((i + 1) / digits.length); // later digits land later
    const p = clamp01(lb / land);
    const spins = 3 + i * 2;
    const pos = (Number(d) + spins * 10) * ease.out(p); // reel position in digits
    const cur = Math.floor(pos);
    const frac = pos - cur;
    g.save();
    g.beginPath();
    g.rect(x - 2, H / 2 - sz * 0.62, dw + 4, sz * 1.24);
    g.clip();
    for (const off of [0, 1]) {
      const digit = (cur + off) % 10;
      slab(g, String(digit), x + dw / 2, H / 2 + (off - frac) * sz * 1.1, sz, ink);
    }
    g.restore();
    x += dw;
  });
  if (suffix) slab(g, suffix, x + sw / 2, H / 2, sz, env.pal.accent === bg ? '#0b0b0c' : env.pal.accent);
  if (blk.label) {
    const p = ease.out((lb - settle + 0.5) * 2);
    g.globalAlpha = clamp01(p);
    slab(g, blk.label.toUpperCase(), W / 2, H / 2 + sz * 0.85, Math.min(sz * 0.18, W * 0.04), ink, { weight: 600, family: UI, spacing: sz * 0.03 });
    g.globalAlpha = 1;
  }
};

R.stretch = (g, W, H, lb, blk, env) => {
  const bg = env.ground(2);
  const ink = inkOn(bg, env.pal);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const text = (blk.text || 'FREE').toUpperCase();
  const f = lb % 1;
  const k = Math.floor(lb);
  const target = [0.35, 1.7, 0.6, 2.2, 1][k % 5];
  const prev = [1, 0.35, 1.7, 0.6, 2.2][k % 5];
  const sx = prev + (target - prev) * ease.outExpo(f * 2.5);
  const sz = fitFont(g, text, (W * 0.88) / Math.max(sx, 1), H * 0.62);
  g.save();
  g.translate(W / 2, H / 2);
  g.scale(sx, 1);
  slab(g, text, 0, 0, sz, ink, { weight: 900 });
  g.restore();
};

R.fly = (g, W, H, lb, blk, env) => {
  const bg = env.ground(0);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const words = (blk.words && blk.words.length ? blk.words : ['FLY', 'THROUGH', 'WORDS']).slice(0, 8);
  const per = blk.beats / words.length;
  const camZ = lb / per; // one word per beat-slot
  const focal = Math.min(W, H) * 1.1;
  for (let i = words.length - 1; i >= 0; i--) {
    const z = i + 1 - camZ; // distance in word units
    if (z < 0.08 || z > 4) continue;
    const s = 1 / z;
    const ang = i * 2.1;
    const ox = Math.cos(ang) * W * 0.18 * (i % 2 ? 1 : -1);
    const oy = Math.sin(ang) * H * 0.12;
    const word = words[i].toUpperCase();
    const base = fitFont(g, word, W * 0.6, H * 0.3);
    g.save();
    g.globalAlpha = clamp01(1.6 - z * 0.5) * clamp01(z * 6);
    g.translate(W / 2 + ox * s * 0.6, H / 2 + oy * s * 0.6);
    g.scale(s * 0.55 * (focal / Math.min(W, H)), s * 0.55 * (focal / Math.min(W, H)));
    const col = i % 2 ? env.pal.accent : '#f4f4f1';
    extruded(g, word, base, 10, col, () => 'rgba(0,0,0,0.55)', 0.4);
    g.restore();
  }
  g.globalAlpha = 1;
};

R.image = (g, W, H, lb, blk, env) => {
  const img = env.images[blk.src];
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const t = lb / blk.beats;
  if (img) {
    const s = Math.max(W / img.width, H / img.height) * (1.06 + 0.12 * t);
    const dx = (blk.pan ?? 0.04) * W * (t - 0.5);
    g.drawImage(img, W / 2 - (img.width * s) / 2 + dx, H / 2 - (img.height * s) / 2, img.width * s, img.height * s);
    const v = g.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, 'rgba(0,0,0,0.25)');
    v.addColorStop(0.55, 'rgba(0,0,0,0.05)');
    v.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
  }
  const words = blk.words || [];
  if (words.length) {
    const per = blk.beats / words.length;
    const k = Math.min(words.length - 1, Math.floor(lb / per));
    const f = (lb - k * per) / per;
    const word = words[k].toUpperCase();
    const sz = fitFont(g, word, W * 0.86, H * 0.34);
    const p = ease.outExpo(f * 3);
    g.save();
    g.translate(W / 2, H * 0.5 + (1 - p) * H * 0.08);
    g.globalAlpha = clamp01(f * 6);
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = sz * 0.2;
    slab(g, word, 0, 0, sz, k % 2 ? env.pal.accent : '#ffffff');
    g.restore();
  }
};

R.graph = (g, W, H, lb, blk, env) => {
  const bg = env.ground(0);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const ink = inkOn(bg, env.pal);
  const t = ease.inOut(clamp01(lb / Math.max(1, blk.beats - 1)));
  const x0 = W * 0.12;
  const x1 = W * 0.88;
  const y0 = H * 0.78;
  const y1 = H * 0.22;
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = y0 + ((y1 - y0) * i) / 4; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); }
  const curve = (u) => Math.pow(u, 2.4) * 0.92 + 0.04 * Math.sin(u * 9) * (1 - u);
  g.beginPath();
  const N = 120;
  let tipX = x0;
  let tipY = y0;
  for (let i = 0; i <= N * t; i++) {
    const u = i / N;
    tipX = x0 + (x1 - x0) * u;
    tipY = y0 + (y1 - y0) * curve(u);
    if (i === 0) g.moveTo(tipX, tipY);
    else g.lineTo(tipX, tipY);
  }
  g.strokeStyle = env.pal.accent;
  g.lineWidth = Math.max(3, H * 0.012);
  g.lineCap = 'round';
  g.stroke();
  g.beginPath();
  g.arc(tipX, tipY, H * 0.016, 0, Math.PI * 2);
  g.fillStyle = env.pal.accent;
  g.fill();
  const val = Math.round((Number(blk.to) || 100) * curve(t));
  const lsz = H * 0.13;
  slab(g, `${val}${blk.suffix || ''}`, Math.min(tipX + lsz * 0.2, x1 - lsz), tipY - lsz * 0.7, lsz, ink, { align: 'center' });
  if (blk.label) slab(g, blk.label.toUpperCase(), x0, H * 0.12, H * 0.04, '#9b9ba2', { align: 'left', weight: 600, family: UI, spacing: H * 0.008 });
};

R.logo = (g, W, H, lb, blk, env) => {
  const hit = ease.outExpo(lb * 3);
  g.fillStyle = env.ground(0);
  g.fillRect(0, 0, W, H);
  const name = (blk.text || env.spec.title || 'MASSLESS').toUpperCase();
  const sz = fitFont(g, name, W * 0.66, H * 0.22);
  const mark = sz * 0.9;
  const s = 1 + 0.4 * (1 - hit);
  g.save();
  g.translate(W / 2, H / 2 - sz * 0.25);
  g.scale(s, s);
  g.globalAlpha = clamp01(lb * 4);
  // iris mark
  g.translate(0, -mark * 0.75);
  g.strokeStyle = env.pal.accent;
  g.fillStyle = env.pal.accent;
  g.lineWidth = mark * 0.09;
  g.beginPath();
  g.arc(0, 0, mark * 0.36, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(0, 0, mark * 0.11, 0, Math.PI * 2);
  g.fill();
  g.translate(0, mark * 0.75);
  slab(g, name, 0, mark * 0.3, sz, '#f6f6f2');
  g.restore();
  if (blk.sub) {
    const p = ease.out((lb - 0.6) * 1.6);
    g.globalAlpha = clamp01(p);
    slab(g, blk.sub, W / 2, H / 2 + sz * 1.05, Math.min(sz * 0.2, W * 0.03), '#a6a6ad', { weight: 500, family: UI });
    g.globalAlpha = 1;
  }
};

// ---------------------------------------------------------------------------------------------
// Frame assembly
// ---------------------------------------------------------------------------------------------

function drawBlock(g, W, H, blk, lb, env) {
  g.save();
  try { (R[blk.type] || R.words)(g, W, H, lb, blk, env); } finally { g.restore(); }
}

/** Draw the film at beat position b (fractional) into g, one sharp sub-frame. */
function drawAt(g, W, H, lay, b, env) {
  const blocks = lay.blocks;
  if (!blocks.length) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); return; }
  let i = blocks.findIndex((x) => b >= x.start && b < x.end);
  if (i < 0) i = b < 0 ? 0 : blocks.length - 1;
  const blk = blocks[i];
  const lb = Math.max(0, b - blk.start);
  const T = 0.32; // transition length in beats
  const prev = blocks[i - 1];
  // camera shake on each beat hit, decaying
  const sinceBeat = b - Math.floor(b);
  const kick = blk.type === 'logo' ? 0 : Math.exp(-sinceBeat * 9) * (b >= lay.dropBeat ? 1 : 0.4);
  const sx = (hash(Math.floor(b) * 3.1) - 0.5) * W * 0.012 * kick;
  const sy = (hash(Math.floor(b) * 7.7) - 0.5) * H * 0.012 * kick;
  g.save();
  g.translate(sx, sy);
  if (prev && lb < T && blk.in === 'whip') {
    const p = ease.inOut(lb / T);
    g.save();
    g.translate(-p * W * 1.05, 0);
    drawBlock(g, W, H, prev, prev.beats - 0.001, env);
    g.restore();
    g.save();
    g.translate((1 - p) * W * 1.05, 0);
    drawBlock(g, W, H, blk, lb, env);
    g.restore();
  } else if (prev && lb < T && blk.in === 'zoom') {
    const p = ease.in(lb / T);
    g.save();
    g.translate(W / 2, H / 2);
    g.scale(1 + p * 2.5, 1 + p * 2.5);
    g.translate(-W / 2, -H / 2);
    drawBlock(g, W, H, prev, prev.beats - 0.001, env);
    g.restore();
    g.globalAlpha = p;
    drawBlock(g, W, H, blk, lb, env);
    g.globalAlpha = 1;
  } else {
    drawBlock(g, W, H, blk, lb, env);
  }
  g.restore();
  // a white flash on the drop
  const fd = b - lay.dropBeat;
  if (fd >= 0 && fd < 0.5 && lay.dropBeat > 0) {
    g.fillStyle = `rgba(255,255,255,${0.85 * (1 - fd / 0.5)})`;
    g.fillRect(0, 0, W, H);
  }
}

/**
 * Renderer for one canvas. render(t, { samples }) draws time t (seconds); samples > 1 averages sub-frames
 * across a 180° shutter at the given fps for real motion blur.
 */
export class FilmRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this.tmp = document.createElement('canvas');
    this.tg = this.tmp.getContext('2d', { alpha: false });
    this.images = {};
  }
  setSpec(spec) {
    this.spec = spec;
    this.lay = layout(spec);
    const pal = PALETTES[spec.palette] || PALETTES.amber;
    this.env = { pal, spec, images: this.images, ground: (k) => pal.grounds[((k % pal.grounds.length) + pal.grounds.length) % pal.grounds.length] };
    return this.lay;
  }
  async loadImages(srcs) {
    await Promise.all(srcs.filter((s) => s && !this.images[s]).map(async (s) => {
      try { this.images[s] = await createImageBitmap(await (await fetch(s)).blob()); } catch { /* skip missing stills */ }
    }));
  }
  get duration() { return this.lay.beats * (60 / this.spec.bpm) + 1.2; }
  render(t, { samples = 1, fps = 30 } = {}) {
    const { canvas, g } = this;
    const W = canvas.width;
    const H = canvas.height;
    const bs = 60 / this.spec.bpm;
    if (samples <= 1) { drawAt(g, W, H, this.lay, t / bs, this.env); return; }
    if (this.tmp.width !== W || this.tmp.height !== H) { this.tmp.width = W; this.tmp.height = H; }
    const shutter = 0.5 / fps;
    for (let i = 0; i < samples; i++) {
      const ts = t - shutter / 2 + (shutter * (i + 0.5)) / samples;
      drawAt(this.tg, W, H, this.lay, ts / bs, this.env);
      g.globalAlpha = 1 / (i + 1);
      g.drawImage(this.tmp, 0, 0);
    }
    g.globalAlpha = 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Briefs to beat sheets
// ---------------------------------------------------------------------------------------------

const STOP = new Set('a an the and or but for with from into onto your our their this that these those is are was were be been being it its of on in to at by as you we they he she them his her my me i so than then just very really can will make makes made get gets any every all more most less no not new film video app tool tools product launch brand game make'.split(' '));

function keywords(text, n) {
  const seen = new Set();
  const out = [];
  for (const w of String(text).toLowerCase().replace(/[^a-z0-9$%\s-]/g, ' ').split(/\s+/)) {
    if (w.length < 3 || STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w.toUpperCase());
    if (out.length >= n) break;
  }
  return out;
}

/** A complete beat sheet from a brief, with no model: the structure of a launch film, filled with the brief's words. */
export function templateSpec({ name = 'Massless', brief = '', style = 'phonk', bpm = 150, palette = 'amber', length = 'standard', images = [] }) {
  const title = name.trim() || 'Massless';
  const kw = keywords(`${brief}`, 12);
  while (kw.length < 8) kw.push(['FAST', 'FREE', 'BOLD', 'YOURS', 'NOW', 'LOUD', 'CLEAN', 'REAL'][kw.length % 8]);
  const num = (brief.match(/\b\d{1,5}\b/) || [])[0];
  const img = (k) => images.length ? images[k % images.length] : null;
  const blocks = [
    { type: 'words', beats: 4, words: ['THIS', 'IS', 'NOT', 'AN AD'] , mode: 'slam' },
    { type: 'strike', beats: 4, text: 'THE OLD WAY', then: kw[0] },
    { type: 'prompt', beats: 8, text: brief.slice(0, 90) || `make a launch film for ${title}`, label: 'Describe it' },
    { type: 'hero', beats: 8, text: title, sub: kw.slice(1, 4).join(' · '), drop: true, in: 'cut' },
    { type: 'words', beats: 4, words: kw.slice(1, 5), mode: 'slam' },
  ];
  if (img(0)) blocks.push({ type: 'image', beats: 4, src: img(0), words: kw.slice(5, 7) });
  blocks.push({ type: 'counter', beats: 4, to: num ? Number(num) : 100, suffix: num ? '' : '%', label: kw[7] || title });
  blocks.push({ type: 'stretch', beats: 4, text: kw[2] });
  if (length !== 'short') {
    blocks.push({ type: 'fly', beats: 8, words: kw.slice(0, 6) });
    if (img(1)) blocks.push({ type: 'image', beats: 4, src: img(1), words: kw.slice(3, 5) });
    blocks.push({ type: 'graph', beats: 4, to: num ? Number(num) * 10 : 1000, label: `${title} growth`, suffix: '' });
    blocks.push({ type: 'words', beats: 4, words: kw.slice(6, 10), mode: 'stack' });
  }
  if (length === 'long') {
    if (img(2)) blocks.push({ type: 'image', beats: 8, src: img(2), words: kw.slice(8, 12) });
    blocks.push({ type: 'words', beats: 4, words: [kw[0], kw[1], kw[2], title.toUpperCase()], mode: 'split' });
    blocks.push({ type: 'hero', beats: 4, text: title });
  }
  blocks.push({ type: 'logo', beats: 6, text: title, sub: brief ? brief.split(/[.!?]/)[0].slice(0, 70) : 'Made with Massless' });
  return { title, style, bpm, palette, blocks };
}

const TYPES = Object.keys(BLOCKS);
const up = (s, n = 18) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Clean a model-written spec: known blocks only, short words, sane beats, exactly one drop, a logo at the end. */
export function sanitizeSpec(raw, fallback) {
  try {
    const blocks = (Array.isArray(raw?.blocks) ? raw.blocks : []).filter((b) => b && TYPES.includes(b.type)).slice(0, 18).map((b) => {
      const o = { type: b.type, beats: Math.min(12, Math.max(2, Math.round(Number(b.beats) || 4))) };
      if (b.words) o.words = (Array.isArray(b.words) ? b.words : String(b.words).split(/[,\s]+/)).map((w) => up(w, 14)).filter(Boolean).slice(0, 8);
      for (const k of ['text', 'then', 'sub', 'label', 'suffix']) if (b[k] != null) o[k] = up(b[k], k === 'text' && b.type === 'prompt' ? 90 : k === 'sub' || k === 'label' ? 60 : 22);
      if (b.to != null) o.to = Math.max(0, Math.min(999999, Math.round(Number(b.to) || 0)));
      if (b.mode && ['slam', 'stack', 'split'].includes(b.mode)) o.mode = b.mode;
      if (b.drop) o.drop = true;
      if (b.type === 'image') o.src = b.src || null;
      return o;
    });
    if (blocks.length < 4) return fallback;
    const drops = blocks.filter((b) => b.drop);
    if (drops.length !== 1) { blocks.forEach((b) => delete b.drop); (blocks.find((b) => b.type === 'hero') || blocks[Math.min(3, blocks.length - 1)]).drop = true; }
    if (blocks[blocks.length - 1].type !== 'logo') blocks.push({ type: 'logo', beats: 6, text: fallback.title, sub: '' });
    // images: fill sources from the fallback's stills
    const stills = fallback.blocks.filter((b) => b.type === 'image').map((b) => b.src);
    let k = 0;
    for (const b of blocks) if (b.type === 'image' && !b.src) b.src = stills.length ? stills[k++ % stills.length] : null;
    return { ...fallback, title: up(raw.title || fallback.title, 24) || fallback.title, blocks: blocks.filter((b) => b.type !== 'image' || b.src) };
  } catch {
    return fallback;
  }
}
