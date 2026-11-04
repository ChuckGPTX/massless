// Motion Loops: original shape animations, each a seamless loop drawn on a 2D canvas.
// Inspired by the bouncy motion-graphics loop idea (morphs, bounces, bursts, line draws) and mo.js-style
// shape bursts; every loop here is our own code.
//
// The whole library is one self-contained function so it can be shipped as a string: the Website builder
// inlines it into exported sites, and "Copy as HTML" on /loops writes a single file that runs anywhere.
// No imports, no globals, no DOM access. Every loop is a pure function of the phase p in [0, 1), so the
// frame at p = 0 and p = 1 match and the loop never jumps.
export function installLoops() {
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const fract = (x) => x - Math.floor(x);
  const smooth = (k) => k * k * (3 - 2 * k);
  const easeOut = (k) => 1 - Math.pow(1 - k, 3);
  const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  const backOut = (k) => { const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
  const wave = (p, k) => 0.5 - 0.5 * Math.cos(TAU * p * k); // 0..1..0, k whole cycles per loop
  const hash = (n) => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

  function circle(g, x, y, r) { g.beginPath(); g.arc(x, y, Math.max(0, r), 0, TAU); g.fill(); }
  function rr(g, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  // Radius of a regular n-gon (or star when inner < 1) at angle a, for smooth shape morphs.
  function polyR(a, n, inner) {
    if (n <= 2) return 1;
    const seg = TAU / n, k = fract(a / seg);
    if (inner < 1) return lerp(1, inner, Math.min(k, 1 - k) * 2); // star: points at k = 0, valleys between
    return Math.cos(Math.PI / n) / Math.cos((k - 0.5) * seg); // flat-sided polygon, vertices at k = 0
  }
  function shapePath(g, x, y, r, rot, fn, steps) {
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * TAU, rad = r * fn(a);
      const px = x + Math.cos(a + rot) * rad, py = y + Math.sin(a + rot) * rad;
      if (i) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.closePath();
  }

  const L = {};

  // ---------- bounces ----------
  L.bounce = { name: 'Bounce', kind: 'Bounces', draw(g, p, W, H, C) {
    const u = Math.min(W, H), n = 3, floor = H / 2 + u * 0.22;
    for (let i = 0; i < n; i++) {
      const k = fract(p * 2 + i / n), up = Math.sin(Math.PI * k); // two hops per loop, staggered
      const land = Math.max(0, 1 - Math.min(k, 1 - k) * 9); // squash near the floor
      const r = u * 0.075, x = W / 2 + (i - 1) * u * 0.26, y = floor - r - up * u * 0.34;
      g.globalAlpha = 0.25 * (1 - up * 0.6); g.fillStyle = C.ink[2];
      g.beginPath(); g.ellipse(x, floor + r * 0.15, r * (1.3 - up * 0.5), r * 0.22, 0, 0, TAU); g.fill();
      g.globalAlpha = 1; g.fillStyle = C.ink[i % 3];
      g.beginPath(); g.ellipse(x, y + land * r * 0.35, r * (1 + land * 0.45 - up * 0.08), r * (1 - land * 0.4 + up * 0.12), 0, 0, TAU); g.fill();
    }
  } };

  L.jelly = { name: 'Jelly', kind: 'Bounces', draw(g, p, W, H, C) {
    // Blocks drop in, wobble like jelly, then pop away so the next drop starts from nothing.
    const u = Math.min(W, H), cols = 4;
    for (let i = 0; i < cols; i++) {
      const k = fract(p * 2 - i * 0.08), drop = easeInOut(clamp(k / 0.3, 0, 1)), settle = clamp((k - 0.3) / 0.45, 0, 1);
      const squish = k > 0.3 ? Math.sin(settle * Math.PI * 4) * Math.exp(-settle * 4) : 0, gone = smooth(clamp((k - 0.8) / 0.2, 0, 1));
      const s = u * 0.15 * (1 - gone), x = W / 2 + (i - (cols - 1) / 2) * u * 0.2, base = H / 2 + u * 0.14;
      if (s <= 0.5) continue;
      const hgt = s * (1 - squish * 0.35), wid = s * (1 + squish * 0.3), y = lerp(-s * 1.3, base - hgt, drop);
      g.fillStyle = C.ink[i % 3]; rr(g, x - wid / 2, y, wid, hgt, s * 0.32); g.fill();
    }
  } };

  // ---------- morphs ----------
  L.morph = { name: 'Morph', kind: 'Morphs', draw(g, p, W, H, C) {
    const u = Math.min(W, H), shapes = [[0, 1], [4, 1], [3, 1], [5, 0.48]], seg = p * shapes.length, i = Math.floor(seg) % shapes.length, k = smooth(clamp((fract(seg) - 0.15) / 0.7, 0, 1));
    const A = shapes[i], B = shapes[(i + 1) % shapes.length];
    const r = u * 0.26 * (1 + 0.06 * Math.sin(TAU * p * 4)), rot = TAU * p;
    const f = (a) => lerp(A[0] ? polyR(a, A[0], A[1]) : 1, B[0] ? polyR(a, B[0], B[1]) : 1, k);
    g.fillStyle = C.ink[1]; shapePath(g, W / 2 + u * 0.03, H / 2 + u * 0.03, r, rot, f, 180); g.fill();
    g.fillStyle = C.ink[0]; shapePath(g, W / 2, H / 2, r, rot, f, 180); g.fill();
    g.strokeStyle = C.ink[2]; g.lineWidth = u * 0.012; shapePath(g, W / 2, H / 2, r * 1.22, -rot * 0.5, f, 180); g.stroke();
  } };

  L.blob = { name: 'Blob', kind: 'Morphs', draw(g, p, W, H, C) {
    const u = Math.min(W, H);
    for (let j = 2; j >= 0; j--) {
      const r = u * (0.2 + j * 0.06);
      const f = (a) => 1 + 0.12 * Math.sin(3 * a + TAU * p * (j + 1)) + 0.08 * Math.sin(5 * a - TAU * p * 2) + 0.05 * Math.cos(2 * a + TAU * p * 3);
      g.globalAlpha = j ? 0.55 : 1; g.fillStyle = C.ink[j];
      shapePath(g, W / 2, H / 2, r, TAU * p * (j % 2 ? -1 : 1), f, 160); g.fill();
    }
    g.globalAlpha = 1;
  } };

  L.petals = { name: 'Petals', kind: 'Morphs', draw(g, p, W, H, C) {
    const u = Math.min(W, H), n = 8, open = wave(p, 2), rot = TAU * p / 2;
    for (let ring = 1; ring >= 0; ring--) {
      for (let i = 0; i < n; i++) {
        const a = rot * (ring ? -1 : 1) + (i + ring * 0.5) * TAU / n, len = u * (0.16 + ring * 0.08) * (0.55 + 0.45 * open);
        g.save(); g.translate(W / 2, H / 2); g.rotate(a); g.fillStyle = C.ink[(i + ring) % 2 ? 0 : 2];
        g.beginPath(); g.ellipse(len * 0.9, 0, len * 0.9, u * 0.045 * (1 + ring * 0.5), 0, 0, TAU); g.fill(); g.restore();
      }
    }
    g.fillStyle = C.ink[1]; circle(g, W / 2, H / 2, u * (0.06 + 0.02 * open));
  } };

  // ---------- bursts ----------
  L.burst = { name: 'Burst', kind: 'Bursts', draw(g, p, W, H, C) {
    // Three mo.js-style bursts per loop: rays shoot out, a ring expands, dots scatter, the core pops.
    const u = Math.min(W, H), id = Math.floor(p * 3), local = fract(p * 3), n = 12;
    const out = easeOut(local), tail = easeOut(clamp((local - 0.25) / 0.75, 0, 1));
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + id * 0.4, r0 = u * (0.08 + tail * 0.34), r1 = u * (0.1 + out * 0.36);
      g.strokeStyle = C.ink[(i + id) % 3]; g.lineWidth = u * 0.018 * (1 - tail * 0.8) * smooth(clamp(local * 12, 0, 1));
      if (r1 > r0) { g.beginPath(); g.moveTo(W / 2 + Math.cos(a) * r0, H / 2 + Math.sin(a) * r0); g.lineTo(W / 2 + Math.cos(a) * r1, H / 2 + Math.sin(a) * r1); g.stroke(); }
      g.fillStyle = C.ink[(i + id + 1) % 3]; circle(g, W / 2 + Math.cos(a + 0.26) * r1 * 0.8, H / 2 + Math.sin(a + 0.26) * r1 * 0.8, u * 0.012 * (1 - tail) * smooth(clamp(local * 12, 0, 1)));
    }
    const ring = easeOut(clamp(local / 0.6, 0, 1));
    g.strokeStyle = C.ink[(id + 2) % 3]; g.lineWidth = u * 0.03 * (1 - ring); g.globalAlpha = (1 - ring) * smooth(clamp(local * 10, 0, 1));
    g.beginPath(); g.arc(W / 2, H / 2, u * 0.05 + ring * u * 0.22, 0, TAU); g.stroke(); g.globalAlpha = 1;
    g.fillStyle = C.ink[id % 3]; circle(g, W / 2, H / 2, u * 0.06 * Math.sin(Math.PI * clamp(local / 0.4, 0, 1)));
  } };

  L.confetti = { name: 'Confetti', kind: 'Bursts', draw(g, p, W, H, C) {
    const u = Math.min(W, H), n = 46;
    for (let i = 0; i < n; i++) {
      const life = fract(p * 2 + (i % 2) * 0.5), a = hash(i + 3) * TAU, sp = 0.35 + hash(i + 5) * 0.55;
      const x = W / 2 + Math.cos(a) * easeOut(life) * u * sp * 0.75, y = H / 2 + Math.sin(a) * easeOut(life) * u * sp * 0.6 + life * life * u * 0.25;
      g.save(); g.translate(x, y); g.rotate(life * TAU * (1 + hash(i + 8) * 2) * (i % 2 ? 1 : -1)); g.globalAlpha = 1 - smooth(clamp((life - 0.7) / 0.3, 0, 1));
      g.fillStyle = C.ink[i % 3]; const s = u * (0.012 + hash(i + 9) * 0.018);
      if (i % 3 === 0) circle(g, 0, 0, s); else if (i % 3 === 1) g.fillRect(-s, -s * 0.45, s * 2, s * 0.9); else { g.beginPath(); g.moveTo(0, -s); g.lineTo(s, s); g.lineTo(-s, s); g.closePath(); g.fill(); }
      g.restore();
    }
    g.globalAlpha = 1;
  } };

  L.sunburst = { name: 'Sunburst', kind: 'Bursts', draw(g, p, W, H, C) {
    const u = Math.min(W, H), R = Math.hypot(W, H), n = 18, rot = TAU * p / n * 2;
    for (let i = 0; i < n; i++) {
      const a0 = rot + (i / n) * TAU, a1 = a0 + TAU / n / 2;
      g.fillStyle = C.ink[i % 2 ? 0 : 2]; g.globalAlpha = 0.85;
      g.beginPath(); g.moveTo(W / 2, H / 2); g.arc(W / 2, H / 2, R, a0, a1); g.closePath(); g.fill();
    }
    g.globalAlpha = 1; g.fillStyle = C.ink[1]; circle(g, W / 2, H / 2, u * (0.12 + 0.025 * wave(p, 6)));
  } };

  // ---------- line draws ----------
  L.scribble = { name: 'Line draw', kind: 'Line draws', draw(g, p, W, H, C) {
    const u = Math.min(W, H), pts = [];
    for (let i = 0; i <= 160; i++) { const a = (i / 160) * TAU; pts.push([W / 2 + Math.sin(a * 2) * u * 0.34, H / 2 + Math.sin(a * 3 + 0.6) * u * 0.26]); }
    let total = 0; const seg = [0];
    for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(total); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let j = 0; j < 3; j++) {
      const k = fract(p - j * 0.06), head = easeInOut(clamp(k * 2, 0, 1)) * total, tailEnd = easeInOut(clamp(k * 2 - 1, 0, 1)) * total;
      g.strokeStyle = C.ink[j]; g.lineWidth = u * (0.03 - j * 0.007);
      g.beginPath(); let on = false;
      for (let i = 0; i < pts.length; i++) { if (seg[i] < tailEnd || seg[i] > head) { on = false; continue; } if (on) g.lineTo(pts[i][0], pts[i][1]); else { g.moveTo(pts[i][0], pts[i][1]); on = true; } }
      g.stroke();
    }
  } };

  L.zigzag = { name: 'Zigzag', kind: 'Line draws', draw(g, p, W, H, C) {
    const u = Math.min(W, H), step = u * 0.09, rows = 3;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let r = 0; r < rows; r++) {
      const y = H / 2 + (r - 1) * u * 0.18, shift = fract(p * (r % 2 ? -1 : 1) + 1) * step * 2;
      g.strokeStyle = C.ink[r]; g.lineWidth = u * 0.028; g.beginPath();
      for (let x = -step * 2 + shift, i = 0; x < W + step * 2; x += step, i++) { const yy = y + (i % 2 ? -1 : 1) * u * 0.035 * (1 + 0.4 * wave(p, 2)); if (i) g.lineTo(x, yy); else g.moveTo(x, yy); }
      g.stroke();
    }
  } };

  L.ripple = { name: 'Ripple', kind: 'Line draws', draw(g, p, W, H, C) {
    const u = Math.min(W, H), R = Math.hypot(W, H) * 0.55, n = 7;
    for (let i = 0; i < n; i++) {
      const k = fract(p * 2 + i / n), r = k * R;
      g.strokeStyle = C.ink[i % 3]; g.globalAlpha = 1 - k; g.lineWidth = u * 0.02 * (1 - k * 0.6);
      g.beginPath(); g.arc(W / 2, H / 2, r, 0, TAU); g.stroke();
    }
    g.globalAlpha = 1;
  } };

  // ---------- patterns ----------
  L.grid = { name: 'Dot wave', kind: 'Patterns', draw(g, p, W, H, C) {
    const u = Math.min(W, H), gap = u / 9;
    for (let y = gap / 2; y < H; y += gap) for (let x = gap / 2; x < W; x += gap) {
      const d = (x + y) / (gap * 9), k = wave(fract(p - d * 0.25), 1);
      g.fillStyle = C.ink[k > 0.66 ? 0 : k > 0.33 ? 1 : 2]; circle(g, x, y, gap * (0.1 + 0.3 * k));
    }
  } };

  L.pills = { name: 'Pills', kind: 'Patterns', draw(g, p, W, H, C) {
    const u = Math.min(W, H), rowH = u / 7, len = rowH * 3.2, gap = rowH * 0.5, period = len + gap;
    for (let r = 0, y = rowH * 0.15; y < H; r++, y += rowH) {
      const dir = r % 2 ? 1 : -1, off = fract(p * dir * (r % 3 + 1) + 4) * period * 3; // three pills per wrap keeps the colours seamless
      for (let j = -3, x = -period * 3 + off; x < W + period; x += period, j++) { g.fillStyle = C.ink[(r + j + 3) % 3]; rr(g, x, y, len, rowH * 0.7, rowH * 0.35); g.fill(); }
    }
  } };

  L.stripes = { name: 'Flow', kind: 'Patterns', draw(g, p, W, H, C) {
    const u = Math.min(W, H), n = 9, band = H / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = C.ink[i % 3]; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, i * band + Math.sin(x / (u * 0.25) + TAU * p * 2 + i * 0.7) * band * 0.45);
      g.lineTo(W, H); g.closePath(); g.globalAlpha = 0.9; g.fill();
    }
    g.globalAlpha = 1;
  } };

  L.tiles = { name: 'Tile flip', kind: 'Patterns', draw(g, p, W, H, C) {
    const u = Math.min(W, H), s = u / 6;
    for (let y = 0, j = 0; y < H; y += s, j++) for (let x = 0, i = 0; x < W; x += s, i++) {
      const k = fract(p * 2 - (i + j) * 0.04), flip = Math.cos(Math.PI * (smooth(clamp(k * 2.2, 0, 1)) + smooth(clamp((k - 0.5) * 2.2, 0, 1)))), front = k < 0.25 || k > 0.75;
      g.fillStyle = C.ink[front ? (i + j) % 2 : 2]; const hw = s * 0.42 * Math.abs(flip);
      rr(g, x + s / 2 - hw, y + s * 0.08, hw * 2, s * 0.84, s * 0.18); g.fill();
    }
  } };

  // ---------- orbits ----------
  L.orbit = { name: 'Orbit', kind: 'Orbits', draw(g, p, W, H, C) {
    const u = Math.min(W, H);
    g.fillStyle = C.ink[1]; circle(g, W / 2, H / 2, u * 0.08);
    for (let i = 0; i < 3; i++) {
      const rx = u * (0.18 + i * 0.1), ry = rx * 0.42, tilt = -0.35 + i * 0.35, speed = (i + 1) * (i % 2 ? -1 : 1);
      g.save(); g.translate(W / 2, H / 2); g.rotate(tilt);
      g.strokeStyle = C.ink[i % 3]; g.globalAlpha = 0.35; g.lineWidth = u * 0.006; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.stroke(); g.globalAlpha = 1;
      for (let tr = 6; tr >= 0; tr--) { const a = TAU * p * speed - tr * 0.06 * Math.sign(speed); g.globalAlpha = tr ? 0.12 * (7 - tr) / 7 : 1; g.fillStyle = C.ink[(i + 2) % 3]; circle(g, Math.cos(a) * rx, Math.sin(a) * ry, u * 0.035 * (1 - tr * 0.08)); }
      g.restore();
    }
    g.globalAlpha = 1;
  } };

  L.spiral = { name: 'Spiral', kind: 'Orbits', draw(g, p, W, H, C) {
    const u = Math.min(W, H), n = 160, gold = Math.PI * (3 - Math.sqrt(5)), breathe = 0.85 + 0.15 * wave(p, 2);
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(i / n) * u * 0.42 * breathe, a = i * gold + TAU * p;
      g.fillStyle = C.ink[i % 3]; circle(g, W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r, u * 0.004 + (i / n) * u * 0.014);
    }
  } };

  L.loader = { name: 'Chase', kind: 'Orbits', draw(g, p, W, H, C) {
    const u = Math.min(W, H), n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU - Math.PI / 2, k = fract(p * 3 - i / n), s = 0.3 + 0.7 * (k < 0.1 ? smooth(k / 0.1) : Math.pow((1 - k) / 0.9, 2));
      g.fillStyle = C.ink[i % 3]; circle(g, W / 2 + Math.cos(a) * u * 0.28, H / 2 + Math.sin(a) * u * 0.28, u * 0.05 * s);
    }
    const spin = TAU * p * 2;
    g.strokeStyle = C.ink[1]; g.lineWidth = u * 0.024; g.lineCap = 'round';
    g.beginPath(); g.arc(W / 2, H / 2, u * 0.13, spin, spin + Math.PI * (0.3 + 1.2 * wave(p, 3))); g.stroke();
  } };

  const PALETTES = {
    chucksi: { name: 'Chucksi', bg: '#0d0b14', ink: ['#ff5b9c', '#ffd23f', '#7c5cff'] },
    citrus: { name: 'Citrus', bg: '#fff6e6', ink: ['#ff6b1a', '#ffc21a', '#14a37f'] },
    ocean: { name: 'Ocean', bg: '#04121f', ink: ['#38c6ff', '#e8f7ff', '#2856ff'] },
    candy: { name: 'Candy', bg: '#ffe8f3', ink: ['#ff3d8b', '#7b61ff', '#33c4b3'] },
    forest: { name: 'Forest', bg: '#0e1a12', ink: ['#b9f66b', '#f1ead8', '#3fae68'] },
    mono: { name: 'Mono', bg: '#f3f1ec', ink: ['#111111', '#7a7a7a', '#d64027'] },
  };

  const LIST = Object.keys(L).map((id) => ({ id, name: L[id].name, kind: L[id].kind }));

  // Draw loop `id` at phase p. opts: { colors: [a, b, c], bg (CSS colour, or null for transparent), scale }.
  function drawLoop(g, id, p, W, H, opts) {
    opts = opts || {};
    const loop = L[id] || L.bounce, pal = PALETTES[opts.palette] || PALETTES.chucksi;
    const C = { ink: (opts.colors && opts.colors.length >= 3 ? opts.colors : pal.ink).slice(0, 3), bg: opts.bg === undefined ? pal.bg : opts.bg };
    g.save();
    if (C.bg) { g.fillStyle = C.bg; g.fillRect(0, 0, W, H); }
    const s = opts.scale || 1;
    if (s !== 1) { g.translate(W / 2, H / 2); g.scale(s, s); g.translate(-W / 2, -H / 2); }
    loop.draw(g, fract(p), W, H, C);
    g.restore();
  }

  return { LOOPS: LIST, PALETTES, drawLoop };
}
