// Lyric Studio motion engine. Draws one frame of a lyric video at time t on a 2D canvas.
// Everything is a pure function of t, so the live preview and the frame-by-frame MP4 export match exactly.
//
// Per frame: a scene picture under a moving camera (push, pull, pan, tilt, orbit, full 360 spin),
// a transition into each new scene, a colour grade, particles that follow the music, and the lyric
// itself animated letter by letter as each word is sung, with a beat-driven camera punch on top.

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = k => 1 - (1 - k) ** 3;
const easeInOut = k => (k < .5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const back = k => { const c = 1.9; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; };
const elastic = k => (k <= 0 ? 0 : k >= 1 ? 1 : 2 ** (-10 * k) * Math.sin((k * 10 - .75) * (2 * Math.PI / 3)) + 1);
// Deterministic pseudo-random numbers in [0, 1): the same letter always moves the same way.
const rand = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const TAU = Math.PI * 2;

export const MOTION_LOOKS = {
  kinetic: { font: '900 {s}px "Big Shoulders Display", Impact, sans-serif', upper: true, size: .2, accent: '#ff5b9c', grade: ['#ff2e88', '#3a0b5e'], stagger: .028 },
  paper: { font: 'italic 400 {s}px "Instrument Serif", Georgia, serif', upper: false, size: .12, accent: '#df7c4d', grade: ['#f3c58a', '#3b2416'], stagger: .035 },
  orbit: { font: '700 {s}px Unbounded, "Instrument Sans", sans-serif', upper: true, size: .1, accent: '#b7a2ff', grade: ['#6d4dff', '#05031a'], stagger: .02 },
  matter: { font: '400 {s}px "Archivo Black", "Arial Black", sans-serif', upper: true, size: .12, accent: '#b9f66b', grade: ['#38e07b', '#04140c'], stagger: .018 },
  architecture: { font: '900 {s}px "Big Shoulders Display", Impact, sans-serif', upper: true, size: .17, accent: '#78d9ff', grade: ['#2aa8ff', '#03101e'], stagger: .03 },
  echo: { font: '700 {s}px "Space Grotesk", "Instrument Sans", sans-serif', upper: true, size: .12, accent: '#ffb55b', grade: ['#ff7a1a', '#1c0700'], stagger: .02 },
};
const MOVES = ['push', 'spin', 'pan', 'pull', 'orbit', 'tilt'];
const TRANSITIONS = ['zoom', 'spin', 'flash', 'whip'];

// Split the song into `count` scenes of roughly equal length, cutting only between lyric lines.
export function planScenes(cues, duration, count) {
  const n = clamp(Math.round(count) || 1, 1, 24);
  if (!cues.length || n === 1) return [{ start: 0, end: duration, move: MOVES[0], transition: 'zoom', seed: 1, index: 0 }];
  const cuts = [0];
  for (let k = 1; k < n; k++) {
    const target = duration * k / n;
    // Cut at the line starting nearest the target; in a long instrumental, cut at the target itself.
    const cue = cues.reduce((best, c) => (Math.abs(c.start - target) < Math.abs(best.start - target) ? c : best), cues[0]);
    const inLine = cues.some(c => target > c.start && target < c.end);
    const at = Math.abs(cue.start - target) < duration / n / 2 || inLine ? cue.start : target;
    if (at > cuts[cuts.length - 1] + 1.5 && at < duration - 1.5) cuts.push(at);
  }
  cuts.push(duration);
  return cuts.slice(0, -1).map((start, i) => ({ start, end: cuts[i + 1], index: i, seed: i + 1, move: MOVES[i % MOVES.length], transition: TRANSITIONS[i % TRANSITIONS.length] }));
}

// How many pictures a song gets on "Auto": one for about every eight seconds, between 4 and 10.
export const autoPictureCount = duration => clamp(Math.round(duration / 8), 4, 10);

const sceneAt = (scenes, t) => { let i = 0; while (i < scenes.length - 1 && t >= scenes[i + 1].start) i++; return i; };

// ---------- pictures ----------

function camera(scene, t, w, h, img, motion) {
  const span = Math.max(.5, scene.end - scene.start), k = clamp((t - scene.start) / span, 0, 1), r = rand(scene.seed);
  if (!motion) return { x: 0, y: 0, s: 1.05, rot: 0 };
  switch (scene.move) {
    case 'push': return { x: (r - .5) * w * .04 * k, y: 0, s: 1.08 + .32 * easeInOut(k), rot: (r - .5) * .08 * k };
    case 'pull': return { x: 0, y: (r - .5) * h * .05 * k, s: 1.42 - .3 * easeInOut(k), rot: -(r - .5) * .1 * k };
    case 'pan': return { x: lerp(-1, 1, easeInOut(k)) * w * .09 * (r > .5 ? 1 : -1), y: 0, s: 1.3, rot: 0 };
    case 'tilt': return { x: 0, y: lerp(-1, 1, easeInOut(k)) * h * .08, s: 1.3, rot: .03 * Math.sin(k * Math.PI) };
    // A full turn over the scene. The scale covers the frame's diagonal so corners never show.
    case 'spin': { const cover = Math.hypot(w, h) / Math.min(w, h); return { x: 0, y: 0, s: cover * (1.02 + .12 * k), rot: (r > .5 ? 1 : -1) * TAU * easeInOut(k) }; }
    case 'orbit': { const a = TAU * k; const cover = Math.hypot(w, h) / Math.min(w, h); return { x: Math.cos(a) * w * .05, y: Math.sin(a) * h * .05, s: cover * 1.08, rot: Math.sin(a) * .25 }; }
    default: return { x: 0, y: 0, s: 1.1, rot: 0 };
  }
}

function drawPicture(ctx, img, w, h, cam, punch, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(w / 2 + cam.x, h / 2 + cam.y);
  ctx.rotate(cam.rot);
  const s = Math.max(w / img.width, h / img.height) * cam.s * (1 + punch);
  ctx.drawImage(img, -img.width * s / 2, -img.height * s / 2, img.width * s, img.height * s);
  ctx.restore();
}

// A picture made from code for scenes without one: soft colour fields that still move.
function drawFallback(ctx, w, h, t, look, seed, cam) {
  const [a, b] = look.grade;
  ctx.save();
  ctx.translate(w / 2 + cam.x, h / 2 + cam.y); ctx.rotate(cam.rot); ctx.scale(cam.s, cam.s);
  const R = Math.hypot(w, h);
  ctx.fillStyle = b; ctx.fillRect(-R, -R, R * 2, R * 2);
  for (let i = 0; i < 5; i++) {
    const g = ctx.createRadialGradient?.(Math.cos(seed + i * 1.7 + t * .2) * w * .35, Math.sin(seed * 2 + i + t * .17) * h * .35, 0, 0, 0, R * .55);
    if (!g) break;
    g.addColorStop(0, i % 2 ? a : look.accent); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = .35; ctx.fillStyle = g; ctx.fillRect(-R, -R, R * 2, R * 2);
  }
  ctx.restore();
}

// Paper look: the picture is a polaroid that skids onto a dim, blurred copy of itself and floats.
function drawPolaroid(ctx, img, scene, t, w, h, motion, alpha) {
  const unit = Math.min(w, h), r = rand(scene.seed * 5), k = motion ? easeOut(clamp((t - scene.start) / .9, 0, 1)) : 1;
  const side = unit * .5, pad = side * .06;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.translate(w / 2 + (1 - k) * w * (r > .5 ? .8 : -.8) + (motion ? Math.sin(t * .8) * unit * .01 : 0), h * .38 + (motion ? Math.cos(t * .6) * unit * .01 : 0));
  ctx.rotate((r - .5) * .22 + (1 - k) * (r > .5 ? .9 : -.9) + (motion ? Math.sin(t * .5 + r * 6) * .02 : 0));
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = unit * .04; ctx.shadowOffsetY = unit * .015;
  ctx.fillStyle = '#f7f2e8'; ctx.fillRect(-side / 2 - pad, -side / 2 - pad, side + pad * 2, side + pad * 4.5);
  ctx.shadowColor = 'transparent';
  if (img && img.width) { const s = Math.max(side / img.width, side / img.height) * (motion ? 1.05 + .05 * Math.sin(t * .4) : 1.05); ctx.save(); ctx.beginPath(); ctx.rect(-side / 2, -side / 2, side, side); ctx.clip(); ctx.drawImage(img, -img.width * s / 2, -img.height * s / 2, img.width * s, img.height * s); ctx.restore(); }
  else { ctx.fillStyle = '#c9b49a'; ctx.fillRect(-side / 2, -side / 2, side, side); }
  ctx.restore();
}

function drawScene(ctx, o, scene, t, w, h, look, punch, alpha) {
  const img = o.images?.[scene.index] || o.art || null;
  const cam = camera(scene, t, w, h, img, o.motion);
  if (look === MOTION_LOOKS.paper) {
    if (img && img.width) { drawPicture(ctx, img, w, h, { ...cam, s: cam.s * 1.2 }, punch, alpha * .45); }
    drawPolaroid(ctx, img, scene, t, w, h, o.motion, alpha);
    return;
  }
  if (img && img.width) drawPicture(ctx, img, w, h, cam, punch, alpha);
  else { ctx.save(); ctx.globalAlpha = alpha; drawFallback(ctx, w, h, t, look, scene.seed * 3.1, cam); ctx.restore(); }
}

function background(ctx, o, t, w, h, look, punch) {
  const scenes = o.scenes?.length ? o.scenes : [{ start: 0, end: o.duration || 30, move: 'push', transition: 'zoom', seed: 1, index: 0 }];
  const i = sceneAt(scenes, t), scene = scenes[i], prev = scenes[i - 1];
  const TR = .55, k = prev && o.motion ? clamp((t - scene.start) / TR, 0, 1) : 1;
  if (k < 1) drawScene(ctx, o, prev, t, w, h, look, punch, 1);
  if (k >= 1) { drawScene(ctx, o, scene, t, w, h, look, punch, 1); return { flash: 0 }; }
  // Transition into the new scene.
  const e = easeOut(k);
  ctx.save();
  if (scene.transition === 'zoom') { ctx.translate(w / 2, h / 2); ctx.scale(lerp(1.8, 1, e), lerp(1.8, 1, e)); ctx.translate(-w / 2, -h / 2); drawScene(ctx, o, scene, t, w, h, look, punch, e); }
  else if (scene.transition === 'spin') { ctx.translate(w / 2, h / 2); ctx.rotate((1 - e) * -Math.PI * .75); ctx.scale(lerp(2.2, 1, e), lerp(2.2, 1, e)); ctx.translate(-w / 2, -h / 2); drawScene(ctx, o, scene, t, w, h, look, punch, e); }
  else if (scene.transition === 'whip') { for (let s = 4; s >= 0; s--) { ctx.save(); ctx.translate((1 - e) * w * (1 + s * .06), 0); drawScene(ctx, o, scene, t, w, h, look, punch, s ? .18 : 1); ctx.restore(); } }
  else drawScene(ctx, o, scene, t, w, h, look, punch, e);
  ctx.restore();
  return { flash: scene.transition === 'flash' || scene.transition === 'zoom' ? (1 - k) ** 2 : 0 };
}

function grade(ctx, w, h, look, energy, emphasis) {
  const [a, b] = look.grade;
  ctx.save();
  const lg = ctx.createLinearGradient?.(0, 0, w, h);
  if (lg) {
    lg.addColorStop(0, a); lg.addColorStop(1, b);
    ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = .55; ctx.fillStyle = lg; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    // Darker centre band so the words always read over busy pictures.
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .15, w / 2, h / 2, Math.hypot(w, h) * .62);
    v.addColorStop(0, `rgba(0,0,0,${.28 + (emphasis ? .05 : 0)})`); v.addColorStop(1, 'rgba(0,0,0,.72)');
    ctx.globalAlpha = 1; ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

// ---------- particles ----------

function particles(ctx, id, w, h, t, look, en, motion) {
  if (!motion) return;
  const unit = Math.min(w, h), [lo, mid, hi] = en;
  ctx.save();
  if (id === 'orbit') {
    for (let i = 0; i < 90; i++) { const r = unit * (.18 + rand(i) * .75), a = rand(i + 9) * TAU + t * (.15 + rand(i + 3) * .25) * (i % 2 ? 1 : -1); ctx.globalAlpha = .25 + rand(i + 4) * .6; ctx.fillStyle = i % 6 ? '#fff' : look.accent; ctx.beginPath(); ctx.arc(w / 2 + Math.cos(a) * r * 1.4, h / 2 + Math.sin(a) * r * .8, .8 + rand(i + 2) * 2.2 + hi * 2.5, 0, TAU); ctx.fill(); }
  } else if (id === 'echo') {
    ctx.strokeStyle = look.accent; ctx.lineCap = 'round';
    for (let i = 0; i < 70; i++) { const a = rand(i) * TAU, z = (rand(i + 7) + t * (.35 + mid * .5)) % 1, r0 = unit * .05 + z ** 2 * unit * 1.1, r1 = r0 + unit * (.02 + z * .12); ctx.globalAlpha = z * .8; ctx.lineWidth = 1 + z * 3; ctx.beginPath(); ctx.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0); ctx.lineTo(w / 2 + Math.cos(a) * r1, h / 2 + Math.sin(a) * r1); ctx.stroke(); }
  } else if (id === 'matter') {
    for (let i = 0; i < 26; i++) { const x = i * w / 25, bh = unit * (.02 + lo * .3 * (.5 + rand(i))) * (1 + Math.sin(t * 6 + i) * .2); ctx.globalAlpha = .7; ctx.fillStyle = i % 3 ? look.accent : '#fff'; ctx.fillRect(x, h - bh, w / 34, bh); }
    for (let i = 0; i < 60; i++) { const y = h - ((rand(i) * h + t * unit * (.08 + rand(i + 1) * .2)) % h); ctx.globalAlpha = .5; ctx.fillStyle = look.accent; ctx.fillRect(rand(i + 5) * w, y, 2 + lo * 4, 2 + lo * 4); }
  } else if (id === 'architecture') {
    ctx.strokeStyle = look.accent; ctx.lineWidth = 1.2;
    for (let i = 0; i < 12; i++) { const z = (i / 12 + t * .25) % 1, y = h * .62 + z ** 2 * h * .45; ctx.globalAlpha = z * .45; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.globalAlpha = .3; for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(w / 2 + i * w * .02, h * .62); ctx.lineTo(w / 2 + i * w * .16, h); ctx.stroke(); }
  } else if (id === 'paper') {
    for (let i = 0; i < 40; i++) { ctx.globalAlpha = .25 * rand(i + 2); ctx.fillStyle = '#fff6e0'; ctx.beginPath(); ctx.arc((rand(i) * w + t * 12 * rand(i + 4)) % w, (rand(i + 1) * h - t * 9 * rand(i + 6) + h * 10) % h, 1 + rand(i + 3) * 2.5, 0, TAU); ctx.fill(); }
  } else {
    // kinetic: speed streaks that flare with the treble.
    ctx.strokeStyle = '#fff';
    for (let i = 0; i < 26; i++) { const y = rand(i) * h, x = ((rand(i + 2) + t * (1.2 + rand(i + 3))) % 1.4 - .2) * w, len = unit * (.08 + hi * .3); ctx.globalAlpha = .12 + hi * .35; ctx.lineWidth = 1 + rand(i + 1) * 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - len, y); ctx.stroke(); }
  }
  ctx.restore();
}

// ---------- words ----------

function wordTimes(cue) {
  const tokens = cue.text.split(/\s+/).filter(Boolean);
  if (cue.words?.length === tokens.length && cue.words.every(w => Number.isFinite(w.start))) return tokens.map((text, i) => ({ text, start: cue.words[i].start, end: cue.words[i].end }));
  const span = Math.max(.2, (cue.end - cue.start) * .8);
  return tokens.map((text, i) => ({ text, start: cue.start + span * i / tokens.length, end: cue.start + span * (i + 1) / tokens.length }));
}

const fontFor = (look, size) => look.font.replace('{s}', Math.round(size));

// Lay a line out in rows; returns words with x, y (centre-relative) and the font size used.
function layout(ctx, words, look, w, h, emphasis) {
  const unit = Math.min(w, h), maxW = w * .84, maxH = h * .5;
  let size = unit * look.size * (emphasis ? 1.15 : 1), rows;
  for (let tries = 0; tries < 40; tries++) {
    ctx.font = fontFor(look, size);
    const space = ctx.measureText(' ').width;
    rows = [[]]; let width = 0;
    for (const wd of words) {
      const ww = ctx.measureText(wd.shown).width;
      if (rows[rows.length - 1].length && width + space + ww > maxW) { rows.push([]); width = 0; }
      rows[rows.length - 1].push({ ...wd, width: ww }); width += (width ? space : 0) + ww;
    }
    const widest = Math.max(...rows.map(r => r.reduce((s, x) => s + x.width, 0) + space * (r.length - 1)));
    if (rows.length * size * 1.02 <= maxH && widest <= maxW) break;
    size *= .92;
  }
  ctx.font = fontFor(look, size);
  const space = ctx.measureText(' ').width, lh = size * (look === MOTION_LOOKS.paper ? 1.15 : .98), out = [];
  rows.forEach((row, ri) => {
    const rw = row.reduce((s, x) => s + x.width, 0) + space * (row.length - 1);
    let x = -rw / 2;
    for (const wd of row) {
      const letters = [];
      let lx = 0;
      for (const ch of wd.shown) { const cw = ctx.measureText(ch).width; letters.push({ ch, x: lx + cw / 2, w: cw }); lx += cw; }
      // Kerning: scale letter positions to the measured word width.
      const kern = lx ? wd.width / lx : 1; letters.forEach(l => { l.x *= kern; });
      out.push({ ...wd, x, y: (ri - (rows.length - 1) / 2) * lh, letters });
      x += wd.width + space;
    }
  });
  return { words: out, size };
}

// One letter's pose for each look. p: entrance progress 0..1, e: exit progress 0..1, r: random seed.
function pose(id, p, e, r, size, unit) {
  const P = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, a: 1 };
  if (id === 'kinetic') {
    const k = back(clamp(p, 0, 1));
    P.y = (1 - k) * -size * 1.1; P.rot = (1 - k) * (r - .5) * 1.4; P.sx = P.sy = lerp(2.4, 1, k); P.a = clamp(p * 3, 0, 1);
    if (e > 0) { const q = easeOut(e); P.x += (r - .5) * unit * 1.2 * q; P.y += (rand(r * 9) - .7) * unit * .9 * q; P.rot += (r - .5) * 6 * q; P.a *= 1 - q; P.sx = P.sy = P.sx * (1 + q); }
  } else if (id === 'paper') {
    const k = easeOut(clamp(p, 0, 1));
    P.sx = P.sy = lerp(1.6, 1, k); P.rot = (1 - k) * (r - .5) * .6; P.y = (1 - k) * size * .15; P.a = clamp(p * 2.5, 0, 1);
    if (e > 0) { P.y -= e * size * 1.4; P.a *= (1 - e) ** 2; }
  } else if (id === 'matter') {
    const k = easeOut(clamp(p, 0, 1));
    P.x = (1 - k) * (r - .5) * unit * 2.2; P.y = (1 - k) * (rand(r * 7) - .5) * unit * 1.6; P.rot = (1 - k) * (r - .5) * 9; P.sx = P.sy = lerp(.2, 1, k); P.a = clamp(p * 2, 0, 1);
    if (e > 0) { const q = easeOut(e); P.x += (r - .5) * unit * 1.6 * q; P.y += (rand(r * 3) - .8) * unit * q + unit * 1.2 * e * e; P.rot += (r - .5) * 8 * q; P.a *= 1 - e; }
  } else if (id === 'architecture') {
    // Each letter flips up into place around its horizontal axis, like a split-flap board.
    const k = elastic(clamp(p, 0, 1));
    P.sy = Math.cos((1 - clamp(k, 0, 1.2)) * Math.PI / 2) || .01; P.y = (1 - clamp(k, 0, 1)) * size * .4; P.a = clamp(p * 3, 0, 1);
    if (e > 0) { P.sx = Math.cos(e * Math.PI / 2); P.a *= 1 - e; }
  } else if (id === 'echo') {
    const k = easeOut(clamp(p, 0, 1));
    P.sx = P.sy = lerp(.05, 1, k); P.a = clamp(p * 1.5, 0, 1);
    if (e > 0) { P.sx = P.sy = 1 + e * e * 4; P.a *= 1 - e; }
  }
  return P;
}

function drawLetters(ctx, words, look, id, t, base, unit, size, beatKick, motion) {
  const fg = id === 'paper' ? '#fff8ec' : '#ffffff';
  words.forEach((wd, wi) => {
    const sung = t >= wd.start;
    wd.letters.forEach((l, li) => {
      const r = rand(wi * 31 + li * 7 + base.seed);
      const p = motion ? (t - wd.start - li * look.stagger) / (id === 'architecture' ? .45 : id === 'matter' ? .5 : .32) : (sung ? 1 : 0);
      if (p <= 0 && id !== 'orbit') {
        // Not sung yet: a faint ghost so the line can be read ahead.
        if (id === 'paper' || id === 'architecture') { ctx.save(); ctx.translate(base.x + wd.x + l.x, base.y + wd.y); ctx.globalAlpha = .16 * base.alpha; ctx.fillStyle = fg; ctx.fillText(l.ch, 0, 0); ctx.restore(); }
        return;
      }
      const P = pose(id, p, motion ? base.exit : 0, r, size, unit);
      const current = t >= wd.start && t < wd.end + .15;
      // Echo: letters rush out of the tunnel's centre, and on exit the whole line flies past the camera.
      const spread = id === 'echo' && motion ? lerp(.15, 1, easeOut(clamp(p, 0, 1))) * (1 + base.exit * base.exit * 4) : 1;
      ctx.save();
      ctx.translate(base.x + (wd.x + l.x) * spread + P.x, base.y + wd.y * spread + P.y);
      ctx.rotate(P.rot); ctx.scale(P.sx * (current ? 1 + beatKick : 1), P.sy * (current ? 1 + beatKick : 1));
      ctx.globalAlpha = clamp(P.a * base.alpha, 0, 1);
      if (id === 'architecture') { ctx.fillStyle = '#0b2a3d'; for (let z = 8; z > 0; z -= 2) ctx.fillText(l.ch, z * size * .012, z * size * .012); }
      if (id === 'echo' && motion) { for (let z = 4; z > 0; z--) { ctx.globalAlpha = .12 * P.a * base.alpha; ctx.fillStyle = look.accent; const s = 1 + z * .09; ctx.save(); ctx.scale(s, s); ctx.fillText(l.ch, 0, 0); ctx.restore(); } ctx.globalAlpha = clamp(P.a * base.alpha, 0, 1); }
      if (id === 'kinetic' && current && motion) { ctx.fillStyle = look.accent; ctx.fillText(l.ch, size * .035, size * .03); }
      ctx.fillStyle = current && id !== 'kinetic' ? look.accent : fg;
      if (id === 'kinetic' && current) ctx.fillStyle = '#fff';
      ctx.fillText(l.ch, 0, 0);
      ctx.restore();
    });
  });
}

// The orbit look puts the line on a turning 3D carousel: the word being sung swings to the front,
// letters foreshorten as they curve away and the back of the ring disappears.
function drawRing(ctx, words, look, t, w, h, size, alpha, motion) {
  // One continuous strip around the ring (the row layout used by other looks doesn't apply here).
  const letters = [], gap = size * .35;
  let run = 0;
  const strip = words.map(wd => { const o = { ...wd, x: run }; wd.letters.forEach(l => letters.push({ ...l, wd: o, gx: run + l.x })); run += wd.width + gap; return o; });
  words = strip;
  if (!letters.length) return;
  const first = letters[0].gx, total = letters[letters.length - 1].gx - first + size;
  const R = clamp(total / 2.4, Math.min(w, h) * .28, w * .4);
  const cur = words.findLast(wd => t >= wd.start) || words[0];
  const p = clamp((t - cur.start) / Math.max(.2, cur.end - cur.start), 0, 1);
  const centre = motion ? cur.x + cur.width * p - first : total / 2 - size / 2;
  // Ease the ring between words instead of snapping.
  const spin = centre / R + (motion ? Math.sin(t * .8) * .05 : 0);
  const tilt = motion ? Math.sin(t * .5) * .18 : 0;
  ctx.save(); ctx.translate(w / 2, h / 2);
  const order = letters.map(l => { const a = (l.gx - first) / R - spin; return { l, a, z: Math.cos(a) }; }).filter(o => o.z > .05).sort((p2, q) => p2.z - q.z);
  for (const { l, a, z } of order) {
    const sung = t >= l.wd.start, live = sung && t < l.wd.end + .15;
    ctx.save();
    ctx.translate(Math.sin(a) * R, Math.sin(a) * R * tilt + (1 - z) * size * .35);
    const s = (.55 + z * .55) * (live ? 1.15 : 1);
    ctx.scale(s * Math.max(.12, z), s);
    ctx.globalAlpha = alpha * clamp((z - .05) * 3, 0, 1) * (sung ? 1 : .45);
    ctx.fillStyle = live ? look.accent : '#fff';
    ctx.fillText(l.ch, 0, 0); ctx.restore();
  }
  ctx.restore();
}

// ---------- frame ----------

export function cueIndexAt(cues, t) { return cues.findIndex(c => t >= c.start && t < c.end); }

export function drawMotion(canvas, t, o = {}) {
  const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height, unit = Math.min(w, h);
  const id = MOTION_LOOKS[o.look] ? o.look : 'kinetic', look = MOTION_LOOKS[id], motion = o.motion !== false;
  const cues = o.cues || [], fps = o.analysis?.fps || 50, k = Math.floor(t * fps);
  const en = o.analysis?.bands?.map(b => b[k] || 0) || [.3, .35, .25];
  const beat = o.analysis?.beat, beatPulse = beat && t >= beat.offset ? Math.exp(-((t - beat.offset) % beat.period) / .1) : 0;
  const bar = beat ? Math.floor((t - beat.offset) / beat.period) % 4 === 0 : false;
  const ci = cueIndexAt(cues, t), cue = cues[ci], emphasis = !!cue?.emphasis;
  const punch = motion ? beatPulse * (emphasis ? .05 : .025) + en[0] * .015 : 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#07060a'; ctx.fillRect(0, 0, w, h);

  // Camera shake on the chorus, the whole frame turns a touch with the music.
  ctx.save();
  if (motion) {
    const shake = emphasis ? unit * .006 * beatPulse : 0;
    ctx.translate(w / 2 + (rand(k) - .5) * shake, h / 2 + (rand(k + 1) - .5) * shake);
    ctx.rotate(Math.sin(t * .6) * .012); ctx.translate(-w / 2, -h / 2);
  }
  const bg = background(ctx, { ...o, motion }, t, w, h, look, punch);
  if (id === 'paper') { ctx.fillStyle = 'rgba(40,22,10,.35)'; ctx.fillRect(0, 0, w, h); }
  grade(ctx, w, h, look, en, emphasis);
  particles(ctx, id, w, h, t, look, en, motion);
  ctx.restore();

  // Lines on screen: the current one, plus the previous one while it blows away.
  const lines = [];
  if (cue) lines.push({ cue, index: ci, exit: 0 });
  const prevIdx = cue ? ci - 1 : cues.findLastIndex(c => c.end <= t), prev = cues[prevIdx];
  if (prev && t - prev.end < .45 && t >= prev.end) lines.push({ cue: prev, index: prevIdx, exit: clamp((t - prev.end) / .45, 0, 1) });
  if (!cues.length || t < (cues[0]?.start ?? 0)) lines.push({ cue: { text: o.title || '', start: 0, end: cues[0]?.start ?? 1e9 }, index: -1, exit: cues.length ? clamp((t - cues[0].start + .45) / .45, 0, 1) : 0, title: true });
  else if (!cue) {
    // A long instrumental gets the song title, animated in the same style, so the screen never goes empty.
    const before = cues.findLast(c => c.end <= t), after = cues.find(c => c.start > t);
    const from = (before?.end ?? 0) + .6, to = (after?.start ?? o.duration ?? t + 10) - .2;
    if (to - from >= 4 && t >= from) lines.push({ cue: { text: [o.title, o.artist].filter(Boolean).join(' · ') || o.title || '', start: from, end: to }, index: -2, exit: after ? clamp((t - to + .45) / .45, 0, 1) : 0, title: true, from });
  }

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const line of lines) {
    if (!line.cue.text) continue;
    const words = wordTimes(line.cue).map(wd => ({ ...wd, shown: look.upper ? wd.text.toLocaleUpperCase() : wd.text }));
    if (line.title) words.forEach((wd, i) => { wd.start = (line.from ?? 0) + .15 + i * .18; wd.end = 1e9; });
    const L = layout(ctx, words, look, w, h, line.cue.emphasis);
    ctx.font = fontFor(look, L.size);
    const cy = id === 'paper' ? h * .8 : h * .5;
    const kick = motion ? beatPulse * (emphasis ? .1 : .05) : 0;
    ctx.save();
    // Text glow so letters stay readable over any picture.
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = L.size * .18;
    if (id === 'orbit') drawRing(ctx, L.words, look, t, w, h, L.size, 1 - line.exit, motion);
    else {
      // The whole line drifts and, on the chorus, takes a slow half turn in depth.
      let bx = w / 2, by = cy;
      if (motion) {
        bx += Math.sin(t * .9 + line.index) * unit * .012; by += Math.cos(t * .7 + line.index) * unit * .01;
        ctx.translate(bx, by);
        if (id === 'kinetic') ctx.rotate(-.06 + rand(line.index + 2) * .12);
        if (id === 'architecture') { const turn = Math.sin((t - line.cue.start) * 1.1) * .35; ctx.transform(Math.cos(turn), Math.sin(turn) * .12, 0, 1, 0, 0); }
        if (emphasis && id !== 'paper') { const s = 1 + .06 * Math.sin((t - line.cue.start) * 2); ctx.scale(s, s); }
        ctx.translate(-bx, -by);
      }
      drawLetters(ctx, L.words, look, id, t, { x: bx, y: by, alpha: 1, exit: line.exit, seed: line.index * 13 + 5 }, unit, L.size, kick, motion);
      // Chorus underline sweep for paper.
      if (id === 'paper' && emphasis && !line.exit) { const k2 = easeOut(clamp((t - line.cue.start) / .6, 0, 1)); ctx.shadowBlur = 0; ctx.fillStyle = look.accent; ctx.fillRect(w * .5 - w * .3 * k2, cy + L.size * .75, w * .6 * k2, Math.max(2, L.size * .05)); }
    }
    ctx.restore();
  }

  // Scene-change flash and a kick of light on each bar.
  const flash = (bg.flash || 0) * .85 + (motion && bar && emphasis ? beatPulse * .18 : 0);
  if (flash > .01) { ctx.fillStyle = `rgba(255,255,255,${clamp(flash, 0, 1)})`; ctx.fillRect(0, 0, w, h); }

  // Small corner credits and a progress line.
  ctx.shadowBlur = 0; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = .8;
  ctx.font = `600 ${Math.round(unit * .022)}px "Instrument Sans", sans-serif`; ctx.fillStyle = '#fff';
  if (o.artist) ctx.fillText(o.artist.slice(0, 40).toUpperCase(), w * .05, h * .08);
  ctx.textAlign = 'right'; if (o.title && cues.length && t >= cues[0].start) ctx.fillText(o.title.slice(0, 40), w * .95, h * .08);
  if (o.duration) { ctx.globalAlpha = .5; ctx.fillStyle = '#ffffff40'; ctx.fillRect(w * .05, h * .94, w * .9, 2); ctx.fillStyle = look.accent; ctx.globalAlpha = .9; ctx.fillRect(w * .05, h * .94, w * .9 * clamp(t / o.duration, 0, 1), 2); }
  ctx.globalAlpha = 1;
}
