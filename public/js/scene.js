// A procedural calibration scene with an exact depth map, so camera moves work
// the moment the page opens, before any model has downloaded.

function ridge(x, seed, amp, freq) {
  return (
    Math.sin(x * freq + seed) * amp * 0.5 +
    Math.sin(x * freq * 2.13 + seed * 1.7) * amp * 0.28 +
    Math.sin(x * freq * 4.71 + seed * 3.1) * amp * 0.14 +
    Math.sin(x * freq * 9.3 + seed * 5.3) * amp * 0.08
  );
}

export function calibrationScene(w = 1344, h = 560) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const dc = document.createElement('canvas');
  dc.width = w;
  dc.height = h;
  const d = dc.getContext('2d');
  const gray = (v) => {
    const n = Math.round(v * 255);
    return `rgb(${n},${n},${n})`;
  };

  // sky
  const sky = g.createLinearGradient(0, 0, 0, h * 0.72);
  sky.addColorStop(0, '#1b2140');
  sky.addColorStop(0.45, '#5b4a78');
  sky.addColorStop(0.8, '#e8955a');
  sky.addColorStop(1, '#ffd08a');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  d.fillStyle = gray(0);
  d.fillRect(0, 0, w, h);

  // stars
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 140; i++) {
    const x = rnd() * w;
    const y = rnd() * h * 0.35;
    const r = rnd() * 1.2 + 0.2;
    g.globalAlpha = 0.3 + rnd() * 0.7;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // sun
  const sx = w * 0.62;
  const sy = h * 0.6;
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.55);
  glow.addColorStop(0, 'rgba(255,236,190,0.95)');
  glow.addColorStop(0.08, 'rgba(255,214,150,0.8)');
  glow.addColorStop(0.3, 'rgba(255,160,90,0.25)');
  glow.addColorStop(1, 'rgba(255,140,80,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff4dc';
  g.beginPath();
  g.arc(sx, sy, h * 0.045, 0, Math.PI * 2);
  g.fill();

  // ridges, far to near
  const layers = [
    { base: 0.6, amp: 0.1, freq: 3.1, seed: 1.2, color: '#9b7aa0', depth: 0.08 },
    { base: 0.66, amp: 0.12, freq: 4.4, seed: 4.1, color: '#6f5683', depth: 0.22 },
    { base: 0.74, amp: 0.09, freq: 6.2, seed: 2.7, color: '#47395c', depth: 0.38 },
    { base: 0.82, amp: 0.07, freq: 8.8, seed: 7.9, color: '#2b2338', depth: 0.52 },
  ];
  for (const L of layers) {
    g.fillStyle = L.color;
    d.fillStyle = gray(L.depth);
    g.beginPath();
    d.beginPath();
    g.moveTo(0, h);
    d.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) {
      const y = h * (L.base - ridge(x / w, L.seed, L.amp, L.freq));
      g.lineTo(x, y);
      d.lineTo(x, y);
    }
    g.lineTo(w, h);
    d.lineTo(w, h);
    g.closePath();
    d.closePath();
    g.fill();
    d.fill();
  }

  // foreground ground with depth ramp
  const groundTop = h * 0.86;
  const gg = g.createLinearGradient(0, groundTop, 0, h);
  gg.addColorStop(0, '#22192b');
  gg.addColorStop(1, '#120d17');
  g.fillStyle = gg;
  const dg = d.createLinearGradient(0, groundTop, 0, h);
  dg.addColorStop(0, gray(0.6));
  dg.addColorStop(1, gray(1));
  d.fillStyle = dg;
  g.beginPath();
  d.beginPath();
  g.moveTo(0, h);
  d.moveTo(0, h);
  for (let x = 0; x <= w; x += 4) {
    const y = groundTop - ridge(x / w, 9.1, 0.03, 5) * h;
    g.lineTo(x, y);
    d.lineTo(x, y);
  }
  g.lineTo(w, h);
  d.lineTo(w, h);
  g.fill();
  d.fill();

  // the subject: a traveler on a rock with a lantern
  const fx = w * 0.38;
  const fy = h * 0.83;
  const fs = h * 0.22;
  const subjectDepth = 0.78;
  const shapes = (ctx, fill) => {
    ctx.fillStyle = fill;
    // rock
    ctx.beginPath();
    ctx.moveTo(fx - fs * 0.55, fy + fs * 0.18);
    ctx.quadraticCurveTo(fx - fs * 0.4, fy - fs * 0.08, fx, fy - fs * 0.1);
    ctx.quadraticCurveTo(fx + fs * 0.45, fy - fs * 0.05, fx + fs * 0.6, fy + fs * 0.18);
    ctx.closePath();
    ctx.fill();
    // cloak
    ctx.beginPath();
    ctx.moveTo(fx - fs * 0.16, fy - fs * 0.1);
    ctx.lineTo(fx - fs * 0.07, fy - fs * 0.7);
    ctx.lineTo(fx + fs * 0.08, fy - fs * 0.7);
    ctx.lineTo(fx + fs * 0.2, fy - fs * 0.1);
    ctx.closePath();
    ctx.fill();
    // head
    ctx.beginPath();
    ctx.arc(fx, fy - fs * 0.8, fs * 0.09, 0, Math.PI * 2);
    ctx.fill();
    // staff
    ctx.fillRect(fx + fs * 0.24, fy - fs * 0.95, fs * 0.025, fs * 0.88);
  };
  shapes(g, '#0d0a10');
  shapes(d, gray(subjectDepth));
  // lantern glow
  const lx = fx + fs * 0.25;
  const ly = fy - fs * 0.98;
  const lg = g.createRadialGradient(lx, ly, 0, lx, ly, fs * 0.5);
  lg.addColorStop(0, 'rgba(255,214,140,1)');
  lg.addColorStop(0.12, 'rgba(255,180,90,0.75)');
  lg.addColorStop(1, 'rgba(255,150,60,0)');
  g.fillStyle = lg;
  g.beginPath();
  g.arc(lx, ly, fs * 0.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff1c9';
  g.beginPath();
  g.arc(lx, ly, fs * 0.03, 0, Math.PI * 2);
  g.fill();

  // foreground grass, nearest of all
  for (let i = 0; i < 70; i++) {
    const side = i < 35 ? 0 : 1;
    const x = side ? w - rnd() * w * 0.22 : rnd() * w * 0.22;
    const len = h * (0.06 + rnd() * 0.16);
    const lean = (rnd() - 0.5) * h * 0.06;
    const draw = (ctx, col, width) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, h + 2);
      ctx.quadraticCurveTo(x + lean * 0.3, h - len * 0.6, x + lean, h - len);
      ctx.stroke();
    };
    const wdt = 1.5 + rnd() * 2.5;
    draw(g, '#07050a', wdt);
    draw(d, gray(0.97), wdt + 1);
  }

  const hw = Math.round(w / 2);
  const hh = Math.round(h / 2);
  const half = document.createElement('canvas');
  half.width = hw;
  half.height = hh;
  half.getContext('2d').drawImage(dc, 0, 0, hw, hh);
  const px = half.getContext('2d').getImageData(0, 0, hw, hh).data;
  const depth = new Uint8Array(hw * hh);
  for (let i = 0; i < depth.length; i++) depth[i] = px[i * 4];
  return { canvas: c, depth: { data: depth, w: hw, h: hh } };
}
