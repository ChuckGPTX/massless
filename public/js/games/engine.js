/*! Massless Games · engine.js · MIT License · Copyright (c) 2026 Chuck Crawley · https://github.com/ChuckGPTX/massless */
// A small game runtime shared by every template: a fixed 60 Hz step, keyboard / touch / pointer input,
// a camera with shake and flash, pooled particles, tweens, collision helpers, a seeded RNG, a canvas HUD,
// and the start / pause / game-over / win screens (with the best score kept in localStorage).
// The world is always 540 x 960 (9:16); the canvas scales to fit. Headless mode steps without drawing,
// so bots and playtests run the same code faster than real time.

export const W = 540;
export const H = 960;
export const DT = 1 / 60;
export const FONT = '"Big Shoulders Display", "Arial Narrow", Impact, sans-serif';
export const UI_FONT = '"Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

// ---------- math ----------
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = {
  linear: (t) => t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
  outElastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};
export function hash(s) {
  let h = 2166136261;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** mulberry32 with helpers: the same seed always gives the same game. */
export function rng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  r.chance = (p) => r() < p;
  r.sign = () => (r() < 0.5 ? -1 : 1);
  return r;
}
export const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export const circles = (ax, ay, ar, bx, by, br) => (ax - bx) ** 2 + (ay - by) ** 2 < (ar + br) ** 2;
export function circleRect(cx, cy, r, x, y, w, h) {
  const nx = clamp(cx, x, x + w);
  const ny = clamp(cy, y, y + h);
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}

// ---------- particles ----------
export class Particles {
  constructor(max = 320) {
    this.max = max;
    this.list = [];
    this.texts = [];
  }
  burst(x, y, o = {}) {
    const n = o.n ?? 12;
    for (let i = 0; i < n; i++) {
      if (this.list.length >= this.max) this.list.shift();
      const a = (o.angle ?? 0) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
      const sp = (o.speed ?? 240) * (0.35 + Math.random() * 0.65);
      const life = (o.life ?? 0.6) * (0.6 + Math.random() * 0.4);
      this.list.push({
        x, y, vx: Math.cos(a) * sp + (o.vx || 0), vy: Math.sin(a) * sp + (o.vy || 0), life, max: life,
        size: (o.size ?? 6) * (0.5 + Math.random() * 0.7), color: Array.isArray(o.color) ? o.color[i % o.color.length] : o.color || '#fff',
        grav: o.grav ?? 600, drag: o.drag ?? 1.5, shape: o.shape || 'circle', spin: (Math.random() - 0.5) * 12, rot: Math.random() * 6,
      });
    }
  }
  text(x, y, str, o = {}) {
    if (this.texts.length > 24) this.texts.shift();
    this.texts.push({ x, y, str: String(str), life: o.life ?? 0.9, max: o.life ?? 0.9, color: o.color || '#fff', size: o.size ?? 34, vy: o.vy ?? -90 });
  }
  update(dt) {
    const L = this.list;
    let j = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      L[j++] = p;
    }
    L.length = j;
    this.texts = this.texts.filter((t) => ((t.life -= dt), (t.y += t.vy * dt), (t.vy *= 0.96), t.life > 0));
  }
  draw(ctx) {
    for (const p of this.list) {
      const k = p.life / p.max;
      ctx.globalAlpha = k < 0.3 ? k / 0.3 : 1;
      ctx.fillStyle = p.color;
      const s = p.size * (0.4 + 0.6 * k);
      if (p.shape === 'square') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-s / 2, -s / 2, s, s); ctx.restore();
      } else if (p.shape === 'line') {
        ctx.strokeStyle = p.color; ctx.lineWidth = s * 0.4; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.life / t.max;
      const pop = k > 0.85 ? 1 + (k - 0.85) * 3 : 1;
      ctx.globalAlpha = Math.min(1, k * 2.5);
      ctx.font = `900 ${Math.round(t.size * pop)}px ${FONT}`;
      ctx.lineWidth = Math.max(3, t.size / 7);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(t.str, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }
  clear() { this.list.length = 0; this.texts.length = 0; }
}

// ---------- tweens ----------
export class Tweens {
  constructor() { this.list = []; }
  to(obj, props, dur, fn = ease.outCubic, delay = 0, done = null) {
    const from = {};
    for (const k in props) from[k] = obj[k];
    this.list.push({ obj, props, from, dur: Math.max(1e-4, dur), t: -delay, fn, done });
  }
  update(dt) {
    this.list = this.list.filter((tw) => {
      tw.t += dt;
      if (tw.t < 0) return true;
      const k = Math.min(1, tw.t / tw.dur);
      const e = tw.fn(k);
      for (const p in tw.props) tw.obj[p] = tw.from[p] + (tw.props[p] - tw.from[p]) * e;
      if (k >= 1) { tw.done?.(); return false; }
      return true;
    });
  }
  clear() { this.list.length = 0; }
}

// ---------- input ----------
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'action', Enter: 'action', KeyZ: 'action', KeyX: 'action', KeyJ: 'action',
};
export class Input {
  constructor() {
    this.keys = new Set();
    this.fresh = new Set();
    this.bot = null;
    this.botPrev = {};
    this.pointer = { x: W / 2, y: H / 2, down: false, pressed: false, released: false, sx: 0, sy: 0, dx: 0, dy: 0, t0: 0, moved: 0 };
    this.swipe = null;
    this.tap = null;
    this._dx = 0;
    this._dy = 0;
    this._pressed = false;
    this._released = false;
  }
  attach(el, toWorld) {
    this.el = el;
    this.toWorld = toWorld;
    this.onKey = (e) => {
      const k = KEYMAP[e.code];
      if (!k || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
      if (e.type === 'keydown') { if (!this.keys.has(k)) this.fresh.add(k); this.keys.add(k); } else this.keys.delete(k);
      if (this.active) e.preventDefault();
    };
    this.onDown = (e) => {
      // presses on the overlay's buttons stay ordinary clicks (capturing them would retarget the click)
      if (e.button > 0 || e.target.closest?.('button, a, input, select, textarea')) return;
      const p = toWorld(e.clientX, e.clientY);
      Object.assign(this.pointer, { x: p.x, y: p.y, sx: p.x, sy: p.y, down: true, t0: performance.now(), moved: 0 });
      this._pressed = true;
      this.id = e.pointerId;
      try { el.setPointerCapture(e.pointerId); } catch { /* ok */ }
      e.preventDefault();
    };
    this.onMove = (e) => {
      const p = toWorld(e.clientX, e.clientY);
      if (this.pointer.down && e.pointerId === this.id) {
        this._dx += p.x - this.pointer.x;
        this._dy += p.y - this.pointer.y;
        this.pointer.moved = Math.max(this.pointer.moved, Math.hypot(p.x - this.pointer.sx, p.y - this.pointer.sy));
        if (!this.swipeDone && this.pointer.moved > 34) {
          const dx = p.x - this.pointer.sx;
          const dy = p.y - this.pointer.sy;
          this.swipe = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
          this.swipeAt = { x: this.pointer.sx, y: this.pointer.sy };
          this.swipeDone = true;
        }
      }
      this.pointer.x = p.x;
      this.pointer.y = p.y;
    };
    this.onUp = (e) => {
      if (e.pointerId !== this.id || !this.pointer.down) return;
      this.pointer.down = false;
      this._released = true;
      if (this.pointer.moved < 18 && performance.now() - this.pointer.t0 < 450) this.tap = { x: this.pointer.x, y: this.pointer.y };
      this.swipeDone = false;
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.style.touchAction = 'none';
  }
  detach() {
    if (!this.el) return;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.el.removeEventListener('pointerdown', this.onDown);
    this.el.removeEventListener('pointermove', this.onMove);
    this.el.removeEventListener('pointerup', this.onUp);
    this.el.removeEventListener('pointercancel', this.onUp);
  }
  /** Bots drive the game through the same input: keys {left, right, up, down, action} and an optional pointer. */
  setBot(keys = {}, pointer = null) {
    this.bot = keys;
    for (const k of ['left', 'right', 'up', 'down', 'action']) {
      if (keys[k] && !this.botPrev[k]) this.fresh.add(k);
    }
    this.botPrev = { ...keys };
    if (pointer) {
      if (pointer.down && !this.pointer.down) { this._pressed = true; Object.assign(this.pointer, { sx: pointer.x, sy: pointer.y }); }
      if (!pointer.down && this.pointer.down) this._released = true;
      this._dx += pointer.x - this.pointer.x;
      this._dy += pointer.y - this.pointer.y;
      Object.assign(this.pointer, { x: pointer.x, y: pointer.y, down: !!pointer.down });
      if (pointer.tap) this.tap = { x: pointer.x, y: pointer.y };
      if (pointer.swipe) { this.swipe = pointer.swipe; this.swipeAt = { x: pointer.x, y: pointer.y }; }
    }
  }
  held(k) { return this.keys.has(k) || !!this.bot?.[k] || (k === 'action' && this.pointer.down && this.pointerAction); }
  pressed(k) { return this.fresh.has(k) || (k === 'action' && this.pointer.pressed && this.pointerAction); }
  /** Called by the game at the start of each step: latch the pointer edges and deltas for this step. */
  begin() {
    this.pointer.pressed = this._pressed;
    this.pointer.released = this._released;
    this.pointer.dx = this._dx;
    this.pointer.dy = this._dy;
    this._pressed = this._released = false;
    this._dx = this._dy = 0;
  }
  end() {
    this.fresh.clear();
    this.tap = null;
    this.swipe = null;
  }
  reset() {
    this.keys.clear();
    this.fresh.clear();
    this.pointer.down = false;
    this._pressed = this._released = false;
    this.botPrev = {};
    this.tap = this.swipe = null;
    this._dx = this._dy = 0;
  }
}

// ---------- best score ----------
const bestKey = (recipe) => `massless-games-best:${hash(`${recipe.genre}|${recipe.title}|${recipe.seed}`)}`;
function loadBest(recipe) {
  try { return Number(localStorage.getItem(bestKey(recipe))) || 0; } catch { return 0; }
}
function saveBest(recipe, v) {
  try { localStorage.setItem(bestKey(recipe), String(v)); } catch { /* private mode */ }
}

// ---------- the game ----------
/**
 * One game. template = { create(game) -> world, bot?(world, game) }; world = { update(dt), draw(ctx), hud?(ctx) }.
 * Templates read game.rand (seeded per run), game.recipe, game.art, game.input and call game.addScore, game.over,
 * game.win, game.shake, game.flash, game.sfx and game.particles.
 */
export class Game {
  constructor({ template, recipe, art = null, sound = null, headless = false, bot = false, onState = null } = {}) {
    this.template = template;
    this.recipe = recipe;
    this.art = art;
    this.sound = sound;
    this.headless = headless;
    this.botOn = bot;
    this.onState = onState;
    this.W = W;
    this.H = H;
    this.input = new Input();
    this.particles = new Particles(headless ? 40 : 320);
    this.tweens = new Tweens();
    this.cam = { x: 0, y: 0, zoom: 1, shake: 0, sx: 0, sy: 0 };
    this.flashA = 0;
    this.flashC = '#fff';
    this.state = 'title';
    this.runs = 0;
    this.layered = typeof template.layered === 'function' ? template.layered(recipe) : !!template.layered;
    this.score = 0;
    this.best = headless ? 0 : loadBest(recipe);
    this.time = 0;
    this.frame = 0;
    this.world = null;
    this.ctx = null;
    this.scale = 1;
    this.raf = 0;
    this.acc = 0;
    this.last = 0;
    this.result = null;
    this.events = [];
  }

  // ----- lifecycle -----
  start() {
    this.runs++;
    this.rand = rng((this.recipe.seed >>> 0) + this.runs * 7919);
    this.score = 0;
    this.time = 0;
    this.frame = 0;
    this.result = null;
    this.particles.clear();
    this.tweens.clear();
    Object.assign(this.cam, { x: 0, y: 0, zoom: 1, shake: 0, sx: 0, sy: 0 });
    this.input.reset();
    this.world?.destroy?.();
    this.world = this.template.create(this);
    this.setState('play');
    this.sound?.startMusic();
  }
  setState(s, info = {}) {
    this.state = s;
    this.onState?.(s, { score: this.score, best: this.best, ...info });
  }
  pause() {
    if (this.state !== 'play') return;
    this.setState('paused');
    this.sound?.pauseMusic();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.input.reset();
    this.last = 0;
    this.setState('play');
    this.sound?.resumeMusic();
  }
  end(kind, msg) {
    if (this.state === 'title') {
      // attract mode: the demo behind the title screen just starts over
      this.rand = rng((this.recipe.seed >>> 0) + 104729 * ++this.runs);
      this.world?.destroy?.();
      this.world = this.template.create(this);
      this.score = 0;
      return;
    }
    if (this.state !== 'play') return;
    const newBest = this.score > this.best;
    if (newBest) { this.best = this.score; if (!this.headless) saveBest(this.recipe, this.best); }
    this.result = { kind, msg, score: this.score, newBest, time: this.time };
    this.events.push(kind);
    if (kind === 'win') this.sfx('win'); else this.sfx('lose');
    this.sound?.duckMusic();
    // let the last explosion play out for a beat before the screen comes up
    this.endAt = this.time + (this.headless ? 0 : 0.9);
    this.state = 'ending';
  }
  over(msg) { this.end('over', msg || this.recipe.text?.lose || 'Game over'); }
  win(msg) { this.end('win', msg || this.recipe.text?.win || 'You win!'); }

  // ----- feedback -----
  addScore(n, x, y, color) {
    this.score = Math.max(0, Math.round(this.score + n));
    if (x != null && !this.headless) this.particles.text(x, y, `${n > 0 ? '+' : ''}${n}`, { color: color || '#fff', size: 30 });
  }
  shake(mag) { this.cam.shake = Math.min(28, Math.max(this.cam.shake, mag)); }
  flash(color = '#fff', a = 0.5) { this.flashC = color; this.flashA = Math.max(this.flashA, a); }
  sfx(name, o) { if (!this.headless && !this.fast && this.state !== 'title') this.sound?.play(name, o); }
  burst(x, y, o) { if (!this.headless) this.particles.burst(x, y, o); }
  popText(x, y, s, o) { if (!this.headless) this.particles.text(x, y, s, o); }

  // ----- stepping -----
  step() {
    this.input.begin();
    const attract = this.state === 'title';
    if (this.world && (attract || this.state === 'play' || this.state === 'ending')) {
      if ((this.botOn || attract) && this.state !== 'ending' && this.template.bot) this.template.bot(this.world, this);
      this.world.update(DT, this);
      this.time += DT;
      this.frame++;
      if (this.state === 'ending' && this.time >= this.endAt) this.setState(this.result.kind, this.result);
    }
    this.particles.update(DT);
    this.tweens.update(DT);
    const c = this.cam;
    if (c.shake > 0.1) {
      c.sx = (Math.random() - 0.5) * 2 * c.shake;
      c.sy = (Math.random() - 0.5) * 2 * c.shake;
      c.shake *= 0.86;
    } else c.sx = c.sy = c.shake = 0;
    this.flashA = Math.max(0, this.flashA - DT * 2.8);
    this.input.end();
  }
  /** Run `seconds` of game time as fast as possible (playtests, previews, tests). draw: also render each frame. */
  advance(seconds, { draw = false } = {}) {
    const n = Math.round(seconds / DT);
    this.fast = true;
    for (let i = 0; i < n; i++) {
      this.step();
      if (draw && this.ctx && i % 2 === 1) this.render();
      if (this.state === 'over' || this.state === 'win') break;
    }
    this.fast = false;
    if (draw && this.ctx) this.render();
  }

  // ----- drawing -----
  attach(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: this.layered });
  }
  render() {
    const ctx = this.ctx;
    if (!ctx || !this.world) return;
    const s = this.canvas.width / W;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    if (this.layered) ctx.clearRect(0, 0, W, H);
    this.world.draw(ctx, this);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    if (this.flashA > 0.01) {
      ctx.globalAlpha = this.flashA;
      ctx.fillStyle = this.flashC;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (this.state === 'play' || this.state === 'ending' || this.state === 'paused') this.world.hud?.(ctx, this);
  }
  /** Camera transform helper: translate so (cx, cy) world point sits at screen centre, with shake and zoom. */
  applyCamera(ctx, cx = W / 2, cy = H / 2, zoom = 1) {
    const s = this.canvas ? this.canvas.width / W : 1;
    ctx.setTransform(s * zoom, 0, 0, s * zoom, s * (W / 2 - cx * zoom + this.cam.sx), s * (H / 2 - cy * zoom + this.cam.sy));
  }
  shaken(ctx) {
    const s = this.canvas ? this.canvas.width / W : 1;
    ctx.setTransform(s, 0, 0, s, s * this.cam.sx, s * this.cam.sy);
  }
  loop(now) {
    this.raf = requestAnimationFrame((t) => this.loop(t));
    if (!this.last) this.last = now;
    this.acc += Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    let n = 0;
    while (this.acc >= DT && n < 5) { this.step(); this.acc -= DT; n++; }
    if (n === 5) this.acc = 0;
    this.render();
    this.fpsN = (this.fpsN || 0) + 1;
    if (now - (this.fpsT || 0) > 1000) { this.fps = Math.round((this.fpsN * 1000) / (now - (this.fpsT || now - 1000))); this.fpsN = 0; this.fpsT = now; }
  }
  go() { if (!this.raf) { this.last = 0; this.raf = requestAnimationFrame((t) => this.loop(t)); } }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  destroy() {
    this.stop();
    this.input.detach();
    this.world?.destroy?.();
    this.template.dispose?.(this);
    this.sound?.stopMusic();
  }

  /** Shared HUD: big score top centre, a label top left, hearts or a progress bar top right. */
  drawHud(ctx, { label = '', lives = null, maxLives = 3, progress = null, value = null, color = '#fff' } = {}) {
    this.shaken(ctx);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    const txt = value != null ? String(value) : String(this.score);
    ctx.font = `900 68px ${FONT}`;
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,0.42)';
    ctx.strokeText(txt, W / 2, 34);
    ctx.fillStyle = color;
    ctx.fillText(txt, W / 2, 34);
    ctx.font = `600 17px ${UI_FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    if (this.best > 0) ctx.fillText(`BEST ${this.best}`, W / 2, 104);
    if (label) {
      ctx.textAlign = 'left';
      ctx.font = `800 24px ${FONT}`;
      ctx.lineWidth = 5;
      ctx.strokeText(label.toUpperCase(), 24, 40);
      ctx.fillStyle = '#fff';
      ctx.fillText(label.toUpperCase(), 24, 40);
    }
    if (lives != null) {
      for (let i = 0; i < maxLives; i++) heart(ctx, W - 36 - i * 34, 52, 13, i < lives ? '#ff4f6d' : 'rgba(255,255,255,0.22)');
    } else if (progress != null) {
      const w = 120;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(ctx, W - 26 - w, 42, w + 4, 16, 8); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      roundRect(ctx, W - 24 - w, 44, w, 12, 6); ctx.fill();
      ctx.fillStyle = color;
      roundRect(ctx, W - 24 - w, 44, Math.max(12, w * clamp(progress, 0, 1)), 12, 6); ctx.fill();
    }
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export function heart(ctx, x, y, s, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.6, y - s * 0.1, x - s * 0.7, y - s * 1.3, x, y - s * 0.45);
  ctx.bezierCurveTo(x + s * 0.7, y - s * 1.3, x + s * 1.6, y - s * 0.1, x, y + s * 0.9);
  ctx.fill();
}

// ---------- the shell: canvas sizing, the screens, pause on blur ----------
const SHELL_CSS = `
.mg-shell{position:relative;width:100%;height:100%;display:grid;place-items:center;overflow:hidden;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.mg-frame{position:relative;overflow:hidden;border-radius:14px;background:#000;box-shadow:0 20px 60px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08);touch-action:none}
.mg-frame canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.mg-ov{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:28px 22px;text-align:center;color:#fff;background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,.66),rgba(0,0,0,.88));font-family:${UI_FONT};z-index:3}
.mg-ov[hidden]{display:none}
.mg-tag{font:700 11px/1 ${UI_FONT};letter-spacing:.16em;text-transform:uppercase;color:#1c1400;background:var(--mg-accent,#ffbf2f);padding:5px 8px;border-radius:5px}
.mg-title{margin:4px 0 0;font:900 clamp(38px,11cqw,64px)/.9 ${FONT};text-transform:uppercase;letter-spacing:.005em;text-shadow:0 4px 24px rgba(0,0,0,.6);overflow-wrap:anywhere}
.mg-sub{margin:0;max-width:30ch;font-size:14px;line-height:1.45;color:rgba(255,255,255,.82)}
.mg-score{font:900 clamp(64px,22cqw,112px)/.85 ${FONT};color:var(--mg-accent,#ffbf2f);text-shadow:0 6px 30px rgba(0,0,0,.6)}
.mg-best{font:600 13px/1 ${UI_FONT};letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.7)}
.mg-best b{color:#fff}
.mg-new{display:inline-block;margin-left:6px;padding:3px 6px;border-radius:4px;background:#ff4f6d;color:#fff;font-style:italic;letter-spacing:.04em}
.mg-help{display:flex;align-items:center;gap:8px;margin-top:4px;font-size:13px;color:rgba(255,255,255,.75)}
.mg-help svg{width:18px;height:18px;flex:none}
.mg-btn{margin-top:10px;min-width:170px;min-height:54px;padding:0 26px;border:0;border-radius:999px;background:var(--mg-accent,#ffbf2f);color:#1c1400;font:800 22px/1 ${FONT};letter-spacing:.06em;text-transform:uppercase;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:transform .12s}
.mg-btn:hover{transform:translateY(-1px) scale(1.03)}
.mg-btn:active{transform:translateY(1px)}
.mg-btn.ghost{min-height:42px;min-width:0;margin-top:2px;background:rgba(255,255,255,.12);color:#fff;font-size:17px;box-shadow:none}
.mg-pulse{animation:mgPulse 1.6s ease-in-out infinite}
@keyframes mgPulse{50%{transform:scale(1.05)}}
@media (prefers-reduced-motion:reduce){.mg-pulse{animation:none}}
`;
function injectCss() {
  if (document.getElementById('mg-css')) return;
  const s = document.createElement('style');
  s.id = 'mg-css';
  s.textContent = SHELL_CSS;
  document.head.append(s);
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TOUCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11V5.5a1.5 1.5 0 013 0V10m0-1a1.5 1.5 0 013 0v2m0-1a1.5 1.5 0 013 0v4.5c0 3.6-2.4 6-6 6h-1c-2.2 0-3.6-.9-4.8-2.6L4.6 15a1.5 1.5 0 012.4-1.8L9 15.5"/></svg>';

/**
 * Mount a game in `container`: a 9:16 frame that fits the box, the canvas, and the overlay screens.
 * Returns { game, frame, destroy, resize }. opts: { bot, autoPause, autostart, genreName, help, accent }.
 */
export function mountGame(container, { template, recipe, art, sound, bot = false, autoPause = true, autostart = false, genreName = '', help = '', accent = '' } = {}) {
  injectCss();
  container.replaceChildren();
  const shell = document.createElement('div');
  shell.className = 'mg-shell';
  const frame = document.createElement('div');
  frame.className = 'mg-frame';
  frame.style.containerType = 'inline-size';
  if (accent) frame.style.setProperty('--mg-accent', accent);
  const canvas = document.createElement('canvas');
  canvas.className = 'mg-2d';
  canvas.setAttribute('aria-label', `${recipe.title}: game`);
  const ov = document.createElement('div');
  ov.className = 'mg-ov';
  frame.append(canvas, ov);
  shell.append(frame);
  container.append(shell);

  const game = new Game({ template, recipe, art, sound, bot });
  game.frameEl = frame;
  game.attach(canvas);
  const toWorld = (cx, cy) => {
    const r = frame.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * W, y: ((cy - r.top) / r.height) * H };
  };
  game.input.attach(frame, toWorld);
  game.input.pointerAction = template.pointerAction !== false;

  const resize = () => {
    const cw = shell.clientWidth;
    const ch = shell.clientHeight;
    if (!cw || !ch) return;
    const s = Math.min(cw / W, ch / H);
    const w = Math.floor(W * s);
    const h = Math.floor(H * s);
    frame.style.width = `${w}px`;
    frame.style.height = `${h}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = Math.round(w * dpr);
    if (canvas.width !== bw) {
      canvas.width = bw;
      canvas.height = Math.round(bw * (H / W));
      game.world?.resize?.(bw, canvas.height);
    }
    game.render();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(shell);

  const show = (html) => { ov.innerHTML = html; ov.hidden = false; };
  const play = () => {
    sound?.unlock();
    game.start();
    ov.hidden = true;
    frame.focus?.();
  };
  const titleScreen = () => show(`
    <span class="mg-tag">${esc(genreName || recipe.genre)}</span>
    <h2 class="mg-title">${esc(recipe.title)}</h2>
    <p class="mg-sub">${esc(recipe.theme)}</p>
    <p class="mg-help">${TOUCH_ICON}<span>${esc(help || recipe.text?.start || 'Tap to play')}</span></p>
    <button type="button" class="mg-btn mg-pulse" data-act="play">Play</button>
    ${game.best ? `<span class="mg-best">Best <b>${game.best}</b></span>` : ''}`);
  game.onState = (s, info) => {
    if (s === 'play') { ov.hidden = true; mount.onState?.(s, info); return; }
    if (s === 'paused') show(`<h2 class="mg-title">Paused</h2><button type="button" class="mg-btn" data-act="resume">Resume</button><button type="button" class="mg-btn ghost" data-act="restart">Restart</button>`);
    if (s === 'over' || s === 'win') {
      show(`<span class="mg-tag">${s === 'win' ? 'You win' : 'Game over'}</span>
        <p class="mg-sub" style="font-size:16px">${esc(info.msg)}</p>
        <div class="mg-score">${info.score}</div>
        <span class="mg-best">Best <b>${game.best}</b>${info.newBest ? '<span class="mg-new">NEW BEST</span>' : ''}</span>
        <button type="button" class="mg-btn mg-pulse" data-act="play">Play again</button>`);
    }
    mount.onState?.(s, info);
  };
  ov.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'play' || act === 'restart') play();
    if (act === 'resume') { sound?.unlock(); game.resume(); }
  });
  const onKey = (e) => {
    if (ov.hidden || !frame.isConnected) return;
    if ((e.code === 'Space' || e.code === 'Enter') && (frame.contains(document.activeElement) || !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName || ''))) {
      e.preventDefault();
      ov.querySelector('[data-act]')?.click();
    }
  };
  window.addEventListener('keydown', onKey);
  const onBlur = () => { if (autoPause && !game.botOn) game.pause(); };
  const onVis = () => { if (document.hidden) onBlur(); };
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVis);

  // a live title screen: the world idles behind the overlay so the first frame is never blank
  game.world = template.create(Object.assign(game, { rand: rng(recipe.seed >>> 0) }));
  game.state = 'title';
  resize();
  game.go();

  const mount = {
    game, frame, canvas, resize, play,
    destroy() {
      ro.disconnect();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
      game.destroy();
      container.replaceChildren();
    },
  };
  if (autostart) play(); else titleScreen();
  return mount;
}
