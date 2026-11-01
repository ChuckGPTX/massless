/*! Massless Games · eatgrow.js · MIT License · Copyright (c) 2026 Chuck Crawley · https://github.com/ChuckGPTX/massless */
// Eat and grow. Steer toward the finger (or with the arrow keys) through a big arena. Anything smaller than you
// is food and runs away; anything bigger hunts you. The camera pulls back as you grow. New creatures are always
// spawned around your own size, some smaller and some bigger, until you are the biggest thing there.

import { W, H, DT, clamp, Game } from './engine.js';
import { alpha } from './art.js';

export const meta = { id: 'eatgrow', help: 'Hold and drag toward where you want to go, or use the arrow keys. Eat smaller things, dodge bigger ones.' };
export const pointerAction = false;

const ARENA = 2400;
const START_R = 16;

function tuning(recipe) { return { creatures: 48, growth: 0.5, speed: 260, aggression: 0.7, ...recipe.tuning }; }

class EatGrow {
  constructor(game) {
    this.game = game;
    this.t = tuning(game.recipe);
    this.rand = game.rand;
    this.goal = Math.max(60, game.recipe.goal || 240);
    this.p = { x: ARENA / 2, y: ARENA / 2, r: START_R, vx: 0, vy: 0, inv: 2, pop: 1, face: 0 };
    this.zoom = 1.6;
    this.time = 0;
    this.eaten = 0;
    this.creatures = [];
    this.pellets = [];
    for (let i = 0; i < 260; i++) this.pellets.push(this.pellet());
    for (let i = 0; i < this.t.creatures; i++) this.creatures.push(this.creature(true));
    this.warn = 0;
  }
  /** Half the screen's long side, in world units. */
  viewR() { return Math.max(W, H) / 2 / this.zoom; }
  pellet() { return { x: this.rand() * ARENA, y: this.rand() * ARENA, r: 4 + this.rand() * 3, c: Math.floor(this.rand() * 6) }; }
  /** A creature sized around the player: roughly 55% smaller, 45% bigger (capped so the goal can be the top). */
  creature(initial = false) {
    const r = this.rand;
    const pr = this.p.r;
    const bigger = r() < (initial ? 0.3 : 0.36);
    const k = bigger ? 1.15 + r() * r() * 2.2 : 0.3 + r() * 0.55;
    const rad = clamp(pr * k, 6, this.goal * 1.25);
    // new arrivals come in from a ring just outside the view, so there is always something nearby
    let x, y;
    const view = this.viewR() + rad + 40;
    for (let i = 0; i < 30; i++) {
      if (initial) {
        // the opening spread: anywhere in the arena, but nothing big right next to the start
        x = rad + 20 + r() * (ARENA - 2 * rad - 40);
        y = rad + 20 + r() * (ARENA - 2 * rad - 40);
        if (Math.hypot(x - this.p.x, y - this.p.y) > (bigger ? 520 + rad * 2 : 200)) break;
        continue;
      }
      const a = r() * Math.PI * 2;
      const d = view + r() * 320;
      x = clamp(this.p.x + Math.cos(a) * d, rad + 20, ARENA - rad - 20);
      y = clamp(this.p.y + Math.sin(a) * d, rad + 20, ARENA - rad - 20);
      if (Math.hypot(x - this.p.x, y - this.p.y) > view * 0.9) break;
    }
    const a = r() * Math.PI * 2;
    return { x, y, r: rad, a, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, turn: r() * 3, c: 1 + Math.floor(r() * 5), ph: r() * 6, mood: 0 };
  }
  update(dt, game) {
    this.time += dt;
    const p = this.p;
    const t = this.t;
    const inp = game.input;
    if (p.dead) return;
    // steering: toward the finger (relative to the player, who is always at screen centre), or keys
    let dx = 0, dy = 0;
    if (inp.pointer.down) {
      dx = inp.pointer.x - W / 2;
      dy = inp.pointer.y - H / 2;
      const m = Math.hypot(dx, dy);
      const k = clamp((m - 10) / 90, 0, 1);
      if (m > 0) { dx = (dx / m) * k; dy = (dy / m) * k; }
    }
    if (inp.held('left')) dx -= 1;
    if (inp.held('right')) dx += 1;
    if (inp.held('up')) dy -= 1;
    if (inp.held('down')) dy += 1;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    const sp = t.speed * (START_R / p.r) ** 0.22;
    p.vx += (dx * sp - p.vx) * Math.min(1, dt * 5);
    p.vy += (dy * sp - p.vy) * Math.min(1, dt * 5);
    p.x = clamp(p.x + p.vx * dt, p.r, ARENA - p.r);
    p.y = clamp(p.y + p.vy * dt, p.r, ARENA - p.r);
    if (Math.hypot(p.vx, p.vy) > 20) p.face = Math.atan2(p.vy, p.vx);
    p.inv = Math.max(0, p.inv - dt);
    p.pop += (1 - p.pop) * Math.min(1, dt * 8);
    // camera pulls back as the player grows
    const want = (36 + 15 * Math.log2(p.r / START_R)) / p.r;
    this.zoom += (want - this.zoom) * Math.min(1, dt * 2);
    // pellets
    for (const f of this.pellets) {
      if ((f.x - p.x) ** 2 + (f.y - p.y) ** 2 < (p.r + f.r) ** 2) {
        p.r = Math.sqrt(p.r * p.r + f.r * f.r * t.growth * 0.6);
        game.addScore(1);
        if (!game.headless && this.rand() < 0.3) game.sfx('pop', { pitch: 1.6, vol: 0.4 });
        Object.assign(f, this.pellet());
      }
    }
    // creatures. Only the nearest few big ones hunt at a time, and a hunter tires after a few seconds.
    let danger = 0;
    const hunters = new Set(this.creatures
      .filter((c) => c.r > p.r * 1.08 && !(c.tired > 0) && Math.hypot(c.x - p.x, c.y - p.y) < 260 + c.r * 3)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))
      .slice(0, 1 + Math.round(t.aggression)));
    for (const c of this.creatures) {
      const ddx = p.x - c.x, ddy = p.y - c.y;
      const d = Math.hypot(ddx, ddy) || 1;
      const sight = 260 + c.r * 3;
      const big = c.r > p.r * 1.08;
      const small = c.r * 1.08 < p.r;
      let ax = Math.cos(c.a), ay = Math.sin(c.a);
      let speed = (70 + 40 * Math.sin(c.ph + this.time)) * (START_R / c.r) ** 0.15;
      c.mood = 0;
      c.tired = (c.tired || 0) - dt;
      if (hunters.has(c) && p.inv <= 0) {
        ax = ddx / d; ay = ddy / d; speed = t.speed * 0.7 * t.aggression * (START_R / c.r) ** 0.22 + 24; c.mood = 1;
        c.hunt = (c.hunt || 0) + dt;
        if (c.hunt > 3.5) { c.tired = 3; c.hunt = 0; c.a = Math.atan2(-ddy, -ddx); }
        if (d < 340 / this.zoom) danger = Math.max(danger, 1 - d / (340 / this.zoom));
      }
      else if (d < 150 + p.r * 2 && small) { ax = -ddx / d; ay = -ddy / d; speed = t.speed * 0.42 * (START_R / c.r) ** 0.22; c.mood = -1; }
      else { c.hunt = 0; c.a += Math.sin(this.time * 0.7 + c.ph) * dt * c.turn; }
      // walls turn them around
      if (c.x < c.r + 40) ax += 1.5; if (c.x > ARENA - c.r - 40) ax -= 1.5;
      if (c.y < c.r + 40) ay += 1.5; if (c.y > ARENA - c.r - 40) ay -= 1.5;
      const am = Math.hypot(ax, ay) || 1;
      c.vx += ((ax / am) * speed - c.vx) * Math.min(1, dt * 2.5);
      c.vy += ((ay / am) * speed - c.vy) * Math.min(1, dt * 2.5);
      c.x = clamp(c.x + c.vx * dt, c.r, ARENA - c.r);
      c.y = clamp(c.y + c.vy * dt, c.r, ARENA - c.r);
      if (c.mood === 0 && Math.hypot(c.vx, c.vy) > 5) c.a = Math.atan2(c.vy, c.vx);
      // eat or be eaten
      if (small && d < p.r - c.r * 0.3) {
        c.dead = true;
        const gain = Math.round(c.r * 2);
        p.r = Math.sqrt(p.r * p.r + c.r * c.r * t.growth);
        p.pop = 1.18;
        this.eaten++;
        game.addScore(gain);
        game.sfx('chomp', { pitch: clamp(40 / c.r, 0.6, 1.6) });
        if (this.eaten % 5 === 0) game.sfx('grow');
        const sx = W / 2 + (c.x - p.x) * this.zoom, sy = H / 2 + (c.y - p.y) * this.zoom;
        game.burst(sx, sy, { n: 12, color: [game.art?.pal.tiles[c.c] || '#fff', '#fff'], speed: 240, size: 7, life: 0.45, grav: 0 });
        game.popText(sx, sy - 20, `+${gain}`, { color: '#fff', size: 26 });
        game.shake(Math.min(8, 2 + c.r / 20));
      } else if (big && p.inv <= 0 && d < c.r - p.r * 0.45) {
        p.dead = true;
        game.sfx('chomp', { pitch: 0.5 });
        game.sfx('hit');
        game.shake(16);
        game.flash(game.art?.pal.enemy || '#f44', 0.45);
        game.burst(W / 2, H / 2, { n: 30, color: [game.art?.pal.player || '#fff', '#fff'], speed: 380, size: 8, life: 0.7, grav: 0 });
        game.over();
        return;
      }
    }
    this.warn += (danger - this.warn) * Math.min(1, dt * 6);
    // keep the population near the player's size: drop specks far too small to matter, add new ones out of sight
    const far = this.viewR() * 2.5 + 500;
    this.creatures = this.creatures.filter((c) => {
      if (c.dead) return false;
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      return !(d > this.viewR() + c.r && (c.r < p.r * 0.22 || d > far + c.r));
    });
    while (this.creatures.length < t.creatures) this.creatures.push(this.creature());
    if (p.r >= this.goal) game.win();
  }
  draw(ctx, game) {
    const art = game.art;
    const pal = art.pal;
    const p = this.p;
    const z = this.zoom;
    const t = this.time;
    game.shaken(ctx);
    art.bg(ctx, { t, x: p.x * 0.3, ambient: false, dim: art.images.bg ? 0.25 : 0 });
    game.applyCamera(ctx, p.x, p.y, z);
    // the floor: a soft dot grid that moves with the world, so motion reads at any size
    const step = 80;
    const half = Math.max(W, H) / 2 / z + step;
    ctx.fillStyle = alpha('#ffffff', 0.09);
    const x0 = Math.floor((p.x - half) / step) * step, y0 = Math.floor((p.y - half) / step) * step;
    const dot = Math.max(2, 2.4 / z);
    for (let x = x0; x < p.x + half; x += step) for (let y = y0; y < p.y + half; y += step) if (x >= 0 && y >= 0 && x <= ARENA && y <= ARENA) ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
    ctx.strokeStyle = alpha(pal.accent, 0.5);
    ctx.lineWidth = 6 / z;
    ctx.strokeRect(0, 0, ARENA, ARENA);
    const vis = (x, y, r) => Math.abs(x - p.x) < half + r && Math.abs(y - p.y) < half + r;
    for (const f of this.pellets) {
      if (!vis(f.x, f.y, f.r)) continue;
      ctx.fillStyle = pal.tiles[f.c];
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 + 0.15 * Math.sin(t * 4 + f.x)), 0, 7); ctx.fill();
    }
    const sorted = this.creatures.filter((c) => vis(c.x, c.y, c.r * 1.3)).sort((a, b) => a.r - b.r);
    for (const c of sorted) {
      const big = c.r > p.r * 1.08;
      if (big) {
        ctx.strokeStyle = alpha(pal.enemy, 0.35 + (c.mood > 0 ? 0.35 * Math.abs(Math.sin(t * 8)) : 0));
        ctx.lineWidth = Math.max(2 / z, c.r * 0.06);
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 1.12, 0, 7); ctx.stroke();
      }
      const flip = Math.cos(c.a) < 0;
      const wob = Math.sin(t * 6 + c.ph) * 0.08;
      art.draw(ctx, 'enemy', c.x, c.y, c.r * 2.3, { rot: (flip ? c.a - Math.PI : c.a) + wob, flip, color: art.image('enemy') ? null : pal.tiles[c.c], res: 96 });
    }
    if (!p.dead && !(p.inv > 0 && Math.floor(t * 12) % 2 === 0)) {
      const flip = Math.cos(p.face) < 0;
      ctx.strokeStyle = alpha('#ffffff', 0.7);
      ctx.lineWidth = Math.max(2 / z, p.r * 0.07);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.14 * p.pop, 0, 7); ctx.stroke();
      art.draw(ctx, 'player', p.x, p.y, p.r * 2.4 * p.pop, { rot: flip ? p.face - Math.PI : p.face, flip, res: 128 });
    }
    game.shaken(ctx);
    if (this.warn > 0.05) {
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
      g.addColorStop(0, alpha(pal.enemy, 0));
      g.addColorStop(1, alpha(pal.enemy, 0.45 * this.warn * (0.7 + 0.3 * Math.sin(t * 12))));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    game.particles.draw(ctx);
  }
  hud(ctx, game) {
    game.drawHud(ctx, { label: `Size ${Math.round(this.p.r)}`, progress: (this.p.r - START_R) / (this.goal - START_R) });
  }
}

export function create(game) { return new EatGrow(game); }

// ---------- bot: chase the best meal in reach, run from anything that can eat it ----------
export function bot(w, game) {
  const p = w.p;
  if (p.dead) { game.input.setBot({}); return; }
  const sp = w.t.speed * (START_R / p.r) ** 0.22;
  const threats = w.creatures.filter((c) => c.r > p.r && Math.hypot(c.x - p.x, c.y - p.y) < c.r + 700);
  // the best meal in reach that isn't sitting next to a hunter
  let bestV = 0, tx = 0, ty = 0;
  for (const c of w.creatures) {
    if (!(c.r * 1.12 < p.r)) continue;
    const dx = c.x - p.x, dy = c.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    if (threats.some((q) => Math.hypot(q.x - c.x, q.y - c.y) < q.r + p.r + (q.mood > 0 ? 80 : 10))) continue;
    const v = (c.r * c.r) / (d + 40);
    if (v > bestV) { bestV = v; tx = dx / d; ty = dy / d; }
  }
  for (const f of w.pellets) {
    const dx = f.x - p.x, dy = f.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const v = (f.r * f.r * 0.3) / (d + 60);
    if (v > bestV) { bestV = v; tx = dx / d; ty = dy / d; }
  }
  // try 24 headings: where would each leave us in 0.4 s and 1 s, and how close would the hunters get?
  let best = w.botA ?? 0, bestS = -Infinity;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    let clear = Infinity;
    let edge = Infinity;
    for (const T of [0.4, 1]) {
      const px = clamp(p.x + dx * sp * T, p.r, ARENA - p.r), py = clamp(p.y + dy * sp * T, p.r, ARENA - p.r);
      edge = Math.min(edge, px, py, ARENA - px, ARENA - py);
      for (const c of threats) {
        let qx = c.x + c.vx * T, qy = c.y + c.vy * T;
        if (c.mood > 0) { const cv = Math.hypot(c.vx, c.vy) * T; const d0 = Math.hypot(px - c.x, py - c.y) || 1; const m = Math.min(cv, d0); qx = c.x + ((px - c.x) / d0) * m; qy = c.y + ((py - c.y) / d0) * m; }
        clear = Math.min(clear, Math.hypot(px - qx, py - qy) - c.r - p.r);
      }
    }
    let s = Math.min(clear, 160) + (dx * tx + dy * ty) * 90 + Math.cos(a - (w.botA ?? a)) * 35;
    if (clear < 25) s -= 1000 - clear;
    if (edge < 380) s -= (380 - edge) * 1.2;
    if (s > bestS) { bestS = s; best = a; }
  }
  w.botA = best;
  game.input.setBot({}, { x: W / 2 + Math.cos(best) * 140, y: H / 2 + Math.sin(best) * 140, down: true });
}

// ---------- playtest ----------
/**
 * Enough food in reach: plenty of smaller creatures and pellets at the start, all inside the open arena (there are
 * no walls inside it, so everything in it can be reached), new food always spawning around the player's size, and
 * a seek-and-flee bot that actually grows on it (at least 1.2x within 30 s).
 */
export function playtest(recipe, { seconds = 30 } = {}) {
  const game = new Game({ template: { create, bot }, recipe, headless: true, bot: true });
  game.start();
  const w = game.world;
  const edible = w.creatures.filter((c) => c.r * 1.08 < w.p.r);
  const inside = [...w.creatures, ...w.pellets].every((c) => c.x >= 0 && c.y >= 0 && c.x <= ARENA && c.y <= ARENA);
  const food = edible.reduce((a, c) => a + c.r * c.r, 0) + w.pellets.reduce((a, f) => a + f.r * f.r * 0.6, 0);
  const notes = [`${edible.length} smaller creatures and ${w.pellets.length} pellets at the start, all inside the arena`, `food on the map is worth ${(Math.sqrt(START_R * START_R + food * w.t.growth) / START_R).toFixed(1)}x the starting size before anything respawns`];
  let ok = edible.length >= 8 && w.pellets.length >= 100 && inside;
  let peak = w.p.r;
  for (let i = 0; i < seconds * 60 && game.state === 'play'; i++) { game.step(); peak = Math.max(peak, w.p.r); }
  const grew = peak / START_R;
  notes.push(`bot grew ${grew.toFixed(1)}x and ate ${w.eaten} in ${game.time.toFixed(0)} s${game.state === 'over' ? ' before it was eaten' : ''}`);
  if (grew < 1.2) ok = false;
  return { ok, notes, score: game.score };
}
