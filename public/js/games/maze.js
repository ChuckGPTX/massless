/*! Chucksi Games · maze.js · MIT License · Copyright (c) 2026 Chuck Crawley · https://github.com/ChuckGPTX/massless */
// Maze. Each level is a fresh maze (recursive backtracker, then a few walls knocked out so there are loops to
// escape through). Collect every key to unlock the door, before the clock runs out; from level 2 on, guards
// wander the halls and chase you when they get close. Swipe, tap a spot to walk there, or use the arrow keys.

import { W, H, DT, clamp, rng, Game, roundRect } from './engine.js';
import { alpha, shade } from './art.js';

export const meta = { id: 'maze', help: 'Swipe, use the arrow keys, or tap where you want to go. Grab every key, then reach the door.' };
export const pointerAction = false;

const DIRS = { up: [0, -1, 1], right: [1, 0, 2], down: [0, 1, 4], left: [-1, 0, 8] };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
const TOP = 196;

function tuning(recipe) { return { size: 7, grow: 2, keys: 1, enemies: 0, speed: 6, time: 75, ...recipe.tuning }; }

/** Level layout from the seed: { cols, rows, open[] (bitmask of open sides), start, exit, keys[], coins[], guards[] }. */
export function layout(recipe, level) {
  const t = tuning(recipe);
  const r = rng(((recipe.seed >>> 0) + level * 1013) >>> 0);
  const cols = clamp(Math.round(t.size) + Math.floor(((level - 1) * t.grow) / 2), 5, 13);
  const rows = clamp(Math.round(cols * 1.55), 7, 21);
  const n = cols * rows;
  const open = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const stack = [n - cols];
  seen[n - cols] = 1;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const x = cur % cols, y = (cur / cols) | 0;
    const opts = [];
    for (const [d, [dx, dy]] of Object.entries(DIRS)) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny * cols + nx]) opts.push([d, ny * cols + nx]);
    }
    if (!opts.length) { stack.pop(); continue; }
    const [d, next] = r.pick(opts);
    open[cur] |= DIRS[d][2];
    open[next] |= DIRS[OPP[d]][2];
    seen[next] = 1;
    stack.push(next);
  }
  // loops: knock out some inner walls
  const extra = Math.round(n * 0.09);
  for (let i = 0; i < extra; i++) {
    const c = r.int(0, n - 1);
    const x = c % cols, y = (c / cols) | 0;
    const d = r.pick(['right', 'down']);
    const [dx, dy] = DIRS[d];
    if (x + dx >= cols || y + dy >= rows) continue;
    open[c] |= DIRS[d][2];
    open[(y + dy) * cols + x + dx] |= DIRS[OPP[d]][2];
  }
  const start = n - cols; // bottom-left
  const dist = bfs(open, cols, rows, start);
  let exit = 0;
  for (let i = 0; i < n; i++) if (dist[i] > dist[exit]) exit = i;
  const maxD = dist[exit];
  const nKeys = clamp(Math.round(t.keys) + Math.floor((level - 1) / 2), 1, 4);
  const keys = [];
  const cand = [];
  for (let i = 0; i < n; i++) if (i !== exit && i !== start && dist[i] > maxD * 0.3) cand.push(i);
  for (let k = 0; k < nKeys && cand.length; k++) {
    // spread keys out: take the candidate farthest from the keys so far (with a little chance)
    let best = -1, bestS = -1;
    for (let j = 0; j < 24; j++) {
      const c = cand[r.int(0, cand.length - 1)];
      const cx = c % cols, cy = (c / cols) | 0;
      let s = 1e9;
      for (const kk of [...keys, start, exit]) s = Math.min(s, Math.abs((kk % cols) - cx) + Math.abs(((kk / cols) | 0) - cy));
      if (s > bestS) { bestS = s; best = c; }
    }
    keys.push(best);
    cand.splice(cand.indexOf(best), 1);
  }
  const coins = [];
  for (let i = 0; i < n; i++) if (i !== start && i !== exit && !keys.includes(i) && r() < 0.33) coins.push(i);
  const nGuards = clamp(Math.round(t.enemies) + Math.floor(level / 2), 0, 5);
  const guards = [];
  const far = [];
  for (let i = 0; i < n; i++) if (dist[i] >= Math.max(6, maxD * 0.45)) far.push(i);
  for (let g = 0; g < nGuards && far.length; g++) guards.push(far.splice(r.int(0, far.length - 1), 1)[0]);
  // the clock grows with the maze, and never gets tighter than the key route at the player's speed allows
  const L = { cols, rows, open, start, exit, keys, coins, guards, dist, maxD };
  L.time = Math.max(Math.round(t.time + (cols - 7) * 6), Math.ceil(routeLength(L) / t.speed / 0.55));
  return L;
}

/** Length in cells of the greedy route start -> nearest key -> ... -> door. */
function routeLength(L) {
  let at = L.start, len = 0;
  const left = new Set(L.keys);
  while (left.size) {
    const dd = bfs(L.open, L.cols, L.rows, at);
    let nk = null;
    for (const k of left) if (nk == null || dd[k] < dd[nk]) nk = k;
    if (dd[nk] < 0) return Infinity;
    len += dd[nk];
    at = nk;
    left.delete(nk);
  }
  return len + bfs(L.open, L.cols, L.rows, at)[L.exit];
}
export function bfs(open, cols, rows, from, block = null) {
  const n = cols * rows;
  const dist = new Int32Array(n).fill(-1);
  const q = new Int32Array(n);
  let h = 0, t = 0;
  dist[from] = 0;
  q[t++] = from;
  while (h < t) {
    const c = q[h++];
    const x = c % cols, y = (c / cols) | 0;
    for (const [dx, dy, bit] of Object.values(DIRS)) {
      if (!(open[c] & bit)) continue;
      const nc = (y + dy) * cols + x + dx;
      if (dist[nc] >= 0 || (block && block[nc])) continue;
      dist[nc] = dist[c] + 1;
      q[t++] = nc;
    }
  }
  return dist;
}
/** First step (a direction) along the shortest path from a to b, or null. */
function stepToward(L, a, b, block = null) {
  const d = bfs(L.open, L.cols, L.rows, b, block);
  if (d[a] < 0) return null;
  const x = a % L.cols, y = (a / L.cols) | 0;
  let best = null, bestD = d[a];
  for (const [name, [dx, dy, bit]] of Object.entries(DIRS)) {
    if (!(L.open[a] & bit)) continue;
    const nc = (y + dy) * L.cols + x + dx;
    if (d[nc] >= 0 && d[nc] < bestD) { bestD = d[nc]; best = name; }
  }
  return best;
}

class Maze {
  constructor(game) {
    this.game = game;
    this.t = tuning(game.recipe);
    this.goal = game.recipe.goal || 0;
    this.level = 0;
    this.lives = 3;
    this.time = 0;
    this.nextLevel();
  }
  nextLevel() {
    this.level++;
    const L = (this.L = layout(this.game.recipe, this.level));
    this.cs = Math.floor(Math.min((W - 40) / L.cols, (H - TOP - 60) / L.rows));
    this.ox = Math.round((W - L.cols * this.cs) / 2);
    this.oy = TOP + Math.round((H - TOP - 60 - L.rows * this.cs) / 2);
    this.keys = new Set(L.keys);
    this.coins = new Set(L.coins);
    this.clock = L.time;
    this.wall = null;
    this.banner = 1.4;
    this.spawn();
  }
  spawn() {
    const L = this.L;
    this.p = { c: L.start, to: L.start, k: 1, dir: null, want: null, path: null, face: 1, inv: 1.2, bob: 0 };
    const sp = this.t.speed * (0.48 + Math.min(0.3, this.level * 0.03));
    this.guards = L.guards.map((c, i) => ({ c, to: c, k: 1, dir: null, home: c, sp, chase: false, ph: i * 1.7 }));
  }
  pos(e) {
    const L = this.L;
    const ax = e.c % L.cols, ay = (e.c / L.cols) | 0;
    const bx = e.to % L.cols, by = (e.to / L.cols) | 0;
    return { x: ax + (bx - ax) * e.k, y: ay + (by - ay) * e.k };
  }
  canGo(c, d) { return !!(this.L.open[c] & DIRS[d][2]); }
  neighbour(c, d) { const L = this.L; return c + DIRS[d][0] + DIRS[d][1] * L.cols; }
  /** Move an actor along the grid; at each cell centre `choose` picks the next direction. */
  move(e, speed, dt, choose) {
    let left = speed * dt;
    while (left > 0) {
      if (e.k >= 1) {
        e.c = e.to;
        e.k = 0;
        this.arrive?.(e);
        const d = choose(e);
        if (!d) { e.k = 1; e.dir = null; return; }
        e.dir = d;
        e.to = this.neighbour(e.c, d);
      }
      const step = Math.min(left, 1 - e.k);
      e.k += step;
      left -= step;
    }
  }
  update(dt, game) {
    this.time += dt;
    this.banner = Math.max(0, this.banner - dt);
    if (this.done) return;
    const L = this.L;
    const p = this.p;
    const inp = game.input;
    this.clock -= dt;
    if (this.clock <= 0) { this.clock = 0; game.sfx('lose'); game.over(this.game.recipe.text?.lose || 'Out of time.'); this.done = true; return; }
    if (this.clock < 10 && Math.floor(this.clock + dt) !== Math.floor(this.clock)) game.sfx('tick');
    // input: swipes and keys set the wanted direction; a tap walks to that spot
    for (const d of ['up', 'down', 'left', 'right']) if (inp.pressed(d) || inp.held(d)) { p.want = d; p.path = null; }
    if (inp.swipe) { p.want = inp.swipe; p.path = null; }
    if (inp.tap) {
      const cx = Math.floor((inp.tap.x - this.ox) / this.cs);
      const cy = Math.floor((inp.tap.y - this.oy) / this.cs);
      if (cx >= 0 && cy >= 0 && cx < L.cols && cy < L.rows) p.path = cy * L.cols + cx;
    }
    p.inv = Math.max(0, p.inv - dt);
    const before = p.c;
    this.move(p, this.t.speed, dt, (e) => {
      if (p.path != null) {
        if (p.path === e.c) { p.path = null; p.want = null; return null; }
        return stepToward(L, e.c, p.path);
      }
      if (p.want && this.canGo(e.c, p.want)) return p.want;
      if (p.dir && this.canGo(e.c, p.dir)) return p.dir;
      return null;
    });
    if (p.dir === 'left') p.face = -1;
    if (p.dir === 'right') p.face = 1;
    p.bob += p.dir ? dt * 14 : 0;
    if (p.c !== before) this.enter(p.c, game);
    // guards
    const pc = this.cellOf(p);
    for (const g of this.guards) {
      this.move(g, g.sp, dt, (e) => {
        // guards on the first maze only wander; from maze 2 they give chase when you come close
        const near = this.level > 1 && Math.abs((e.c % L.cols) - (pc % L.cols)) + Math.abs(((e.c / L.cols) | 0) - ((pc / L.cols) | 0)) <= 5;
        e.chase = near;
        if (near) return stepToward(L, e.c, pc);
        const opts = Object.keys(DIRS).filter((d) => this.canGo(e.c, d) && d !== OPP[e.dir]);
        const all = Object.keys(DIRS).filter((d) => this.canGo(e.c, d));
        return (opts.length ? game.rand.pick(opts) : all[0]) || null;
      });
      const a = this.pos(p), b = this.pos(g);
      if (p.inv <= 0 && (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < 0.42) this.caught(game);
    }
  }
  cellOf(e) { return e.k < 0.5 ? e.c : e.to; }
  enter(c, game) {
    const L = this.L;
    const x = this.ox + (c % L.cols + 0.5) * this.cs;
    const y = this.oy + (((c / L.cols) | 0) + 0.5) * this.cs;
    if (this.coins.delete(c)) { game.addScore(5); game.sfx('coin', { pitch: 1.2, vol: 0.5 }); game.burst(x, y, { n: 4, color: game.art?.pal.item || '#fff', speed: 90, size: 5, life: 0.3, grav: 0 }); }
    if (this.keys.delete(c)) {
      game.addScore(50, x, y - 20, game.art?.pal.accent);
      game.sfx('key');
      game.shake(4);
      game.burst(x, y, { n: 18, color: ['#ffd23f', '#fff'], speed: 260, size: 7, life: 0.6, grav: 0 });
      if (!this.keys.size) { game.sfx('door'); game.popText(W / 2, this.oy - 30, 'THE DOOR IS OPEN', { color: '#fff', size: 34, life: 1.4, vy: -10 }); game.flash('#fff', 0.2); }
    }
    if (c === L.exit && !this.keys.size) this.levelDone(game);
  }
  caught(game) {
    this.lives--;
    game.sfx('hurt');
    game.shake(14);
    game.flash(game.art?.pal.enemy || '#f44', 0.35);
    const a = this.pos(this.p);
    game.burst(this.ox + (a.x + 0.5) * this.cs, this.oy + (a.y + 0.5) * this.cs, { n: 26, color: ['#fff', game.art?.pal.player || '#fff'], speed: 300, size: 7, life: 0.6, grav: 0 });
    if (this.lives <= 0) { this.done = true; game.over(); return; }
    this.spawn();
  }
  levelDone(game) {
    const bonus = Math.round(this.clock) * 5;
    game.addScore(100 + bonus);
    game.sfx('level');
    game.flash('#fff', 0.4);
    game.popText(W / 2, H / 2 - 40, 'ESCAPED!', { color: game.art?.pal.accent || '#ffd166', size: 64, life: 1.4, vy: -20 });
    game.popText(W / 2, H / 2 + 20, `+${100 + bonus}`, { color: '#fff', size: 34, life: 1.4, vy: -20 });
    if (this.goal && this.level >= this.goal) { this.done = true; game.win(); return; }
    this.nextLevel();
  }

  // ---------- drawing ----------
  walls(game) {
    const L = this.L;
    const cs = this.cs;
    const c = document.createElement('canvas');
    const s = 2;
    c.width = W * s;
    c.height = H * s;
    const ctx = c.getContext('2d');
    ctx.scale(s, s);
    const pal = game.art.pal;
    ctx.fillStyle = alpha('#000000', 0.5);
    roundRect(ctx, this.ox - 10, this.oy - 10, L.cols * cs + 20, L.rows * cs + 20, 16); ctx.fill();
    for (let i = 0; i < L.cols * L.rows; i++) {
      const x = this.ox + (i % L.cols) * cs, y = this.oy + ((i / L.cols) | 0) * cs;
      ctx.fillStyle = ((i % L.cols) + ((i / L.cols) | 0)) % 2 ? alpha('#ffffff', 0.035) : alpha('#ffffff', 0.06);
      ctx.fillRect(x, y, cs, cs);
    }
    const wallCol = pal.accent;
    const lw = Math.max(4, cs * 0.16);
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? shade(wallCol, 0.15) : alpha(shade(wallCol, -0.5), 0.9);
      ctx.lineWidth = pass ? lw : lw + 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < L.cols * L.rows; i++) {
        const x = this.ox + (i % L.cols) * cs, y = this.oy + ((i / L.cols) | 0) * cs;
        if (!(L.open[i] & 1)) { ctx.moveTo(x, y); ctx.lineTo(x + cs, y); }
        if (!(L.open[i] & 8)) { ctx.moveTo(x, y); ctx.lineTo(x, y + cs); }
        if ((i % L.cols) === L.cols - 1 && !(L.open[i] & 2)) { ctx.moveTo(x + cs, y); ctx.lineTo(x + cs, y + cs); }
        if (((i / L.cols) | 0) === L.rows - 1 && !(L.open[i] & 4)) { ctx.moveTo(x, y + cs); ctx.lineTo(x + cs, y + cs); }
      }
      ctx.stroke();
    }
    return c;
  }
  draw(ctx, game) {
    const art = game.art;
    const pal = art.pal;
    const L = this.L;
    const cs = this.cs;
    const t = this.time;
    game.shaken(ctx);
    art.bg(ctx, { t, dim: art.images.bg ? 0.4 : 0.15 });
    if (!this.wall || this.wallFor !== this.level) { this.wall = this.walls(game); this.wallFor = this.level; }
    ctx.drawImage(this.wall, 0, 0, W, H);
    const at = (c) => [this.ox + ((c % L.cols) + 0.5) * cs, this.oy + (((c / L.cols) | 0) + 0.5) * cs];
    for (const c of this.coins) { const [x, y] = at(c); ctx.fillStyle = alpha(pal.item, 0.85); ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, cs * 0.08), 0, 7); ctx.fill(); }
    // door
    {
      const [x, y] = at(L.exit);
      const openDoor = !this.keys.size;
      if (openDoor) {
        const g = ctx.createRadialGradient(x, y, 2, x, y, cs * 1.4);
        g.addColorStop(0, alpha('#ffffff', 0.8)); g.addColorStop(1, alpha(pal.accent, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, cs * 1.4, 0, 7); ctx.fill();
      }
      ctx.fillStyle = openDoor ? '#fff' : shade(pal.hazard, -0.2);
      roundRect(ctx, x - cs * 0.32, y - cs * 0.38, cs * 0.64, cs * 0.76, cs * 0.3); ctx.fill();
      ctx.fillStyle = openDoor ? pal.accent : '#1a1a1a';
      if (openDoor) { ctx.font = `900 ${Math.round(cs * 0.5)}px "Big Shoulders Display", Impact, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('EXIT', x, y + 1); }
      else { roundRect(ctx, x - cs * 0.12, y - cs * 0.02, cs * 0.24, cs * 0.2, 3); ctx.fill(); ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y - cs * 0.04, cs * 0.09, Math.PI, 0); ctx.stroke(); }
    }
    for (const c of this.keys) {
      const [x, y] = at(c);
      const g = ctx.createRadialGradient(x, y, 0, x, y, cs * 0.8);
      g.addColorStop(0, alpha('#ffd23f', 0.45)); g.addColorStop(1, alpha('#ffd23f', 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, cs * 0.8, 0, 7); ctx.fill();
      art.draw(ctx, 'item', x, y + Math.sin(t * 4 + c) * cs * 0.06, cs * 0.78, { rot: Math.sin(t * 3 + c) * 0.25 });
    }
    for (const g of this.guards) {
      const q = this.pos(g);
      const x = this.ox + (q.x + 0.5) * cs, y = this.oy + (q.y + 0.5) * cs;
      art.draw(ctx, 'enemy', x, y + Math.sin(t * 6 + g.ph) * cs * 0.05, cs * 0.92, { flip: g.dir === 'left' });
      if (g.chase) { ctx.fillStyle = pal.enemy; ctx.font = `900 ${Math.round(cs * 0.6)}px "Big Shoulders Display", Impact, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('!', x, y - cs * 0.55); }
    }
    const p = this.p;
    if (!(p.inv > 0 && Math.floor(t * 16) % 2 === 0)) {
      const q = this.pos(p);
      const x = this.ox + (q.x + 0.5) * cs, y = this.oy + (q.y + 0.5) * cs;
      const hop = p.dir ? Math.abs(Math.sin(p.bob)) * cs * 0.08 : 0;
      art.draw(ctx, 'player', x, y - hop, cs * 0.95, { flip: p.face < 0, sx: p.dir ? 1.04 : 1, sy: p.dir ? 0.96 : 1 });
    }
    if (p.path != null) { const [x, y] = at(p.path); ctx.strokeStyle = alpha('#ffffff', 0.6); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, cs * 0.3 + Math.sin(t * 8) * 2, 0, 7); ctx.stroke(); }
    game.particles.draw(ctx);
    if (this.banner > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(1, this.banner / 0.3); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `900 64px "Big Shoulders Display", Impact, sans-serif`; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(`MAZE ${this.level}`, W / 2, H / 2); ctx.fillStyle = '#fff'; ctx.fillText(`MAZE ${this.level}`, W / 2, H / 2);
      ctx.restore();
    }
  }
  hud(ctx, game) {
    game.drawHud(ctx, { label: `Maze ${this.level}${this.goal ? `/${this.goal}` : ''}`, lives: this.lives, maxLives: 3 });
    const L = this.L;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `800 24px "Big Shoulders Display", Impact, sans-serif`;
    const got = L.keys.length - this.keys.size;
    game.art.draw(ctx, 'item', 40, 150, 34);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${got} / ${L.keys.length}`, 62, 151);
    ctx.textAlign = 'right';
    ctx.fillStyle = this.clock < 10 ? game.art.pal.enemy : '#fff';
    ctx.fillText(`${Math.ceil(this.clock)} s`, W - 24, 151);
  }
}

export function create(game) { return new Maze(game); }

// ---------- bot: cheapest path to the next key (or the door); cells near a guard cost more, a guard's cell is a wall ----------
function cheapest(L, from, cost) {
  const n = L.cols * L.rows;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[from] = 0;
  for (;;) {
    let c = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; c = i; }
    if (c < 0) break;
    done[c] = 1;
    const x = c % L.cols, y = (c / L.cols) | 0;
    for (const [dx, dy, bit] of Object.values(DIRS)) {
      if (!(L.open[c] & bit)) continue;
      const nc = (y + dy) * L.cols + x + dx;
      const d = best + cost[nc];
      if (d < dist[nc]) { dist[nc] = d; prev[nc] = c; }
    }
  }
  return { dist, prev };
}
export function bot(w, game) {
  const L = w.L;
  const p = w.p;
  if (w.done || !L) { game.input.setBot({}); return; }
  const here = p.to; // the next cell centre is where the next turn happens
  const n = L.cols * L.rows;
  const cost = new Float64Array(n).fill(1);
  for (const g of w.guards) {
    const gd = bfs(L.open, L.cols, L.rows, g.k < 0.5 ? g.c : g.to);
    for (let i = 0; i < n; i++) if (gd[i] >= 0 && gd[i] <= 3) cost[i] += [1e6, 40, 12, 3][gd[i]];
  }
  cost[here] = 1;
  const { dist, prev } = cheapest(L, here, cost);
  const targets = w.keys.size ? [...w.keys] : [L.exit];
  let best = null;
  for (const c of targets) if (dist[c] < Infinity && (best == null || dist[c] < dist[best])) best = c;
  let d = null;
  if (best != null && dist[best] < 1e5) {
    let c = best;
    while (prev[c] !== here && prev[c] >= 0) c = prev[c];
    if (prev[c] === here) d = Object.keys(DIRS).find((k) => L.open[here] & DIRS[k][2] && w.neighbour(here, k) === c) || null;
  }
  if (!d) {
    // boxed in: take the neighbouring cell that is cheapest (furthest from guards)
    const opts = Object.keys(DIRS).filter((k) => L.open[here] & DIRS[k][2]);
    d = opts.sort((a2, b2) => cost[w.neighbour(here, a2)] - cost[w.neighbour(here, b2)])[0] || null;
  }
  game.input.setBot(d ? { [d]: true } : {});
}

// ---------- playtest ----------
/** Every level up to the goal: the door and every key reachable from the start, guards spawn far away, and the
 * route start -> keys -> door fits in the clock with room to spare. */
export function playtest(recipe) {
  const t = tuning(recipe);
  const levels = Math.min(recipe.goal || 8, 8);
  const notes = [];
  let ok = true;
  for (let lv = 1; lv <= levels; lv++) {
    const L = layout(recipe, lv);
    const d = L.dist;
    if (d[L.exit] < 0 || L.keys.some((k) => d[k] < 0)) { ok = false; notes.push(`level ${lv}: a key or the door is walled off`); continue; }
    if (L.guards.some((g) => d[g] < 5)) { ok = false; notes.push(`level ${lv}: a guard starts too close`); }
    // greedy route through the keys
    const len = routeLength(L);
    const need = len / t.speed;
    if (need > L.time * 0.6) { ok = false; notes.push(`level ${lv}: the route takes ${need.toFixed(0)} s of ${L.time} s`); }
    if (lv === 1 || lv === levels) notes.push(`level ${lv}: ${L.cols}x${L.rows}, ${L.keys.length} keys, ${L.guards.length} guards, route ${len} cells in ${L.time} s`);
  }
  // the bot plays the first two levels
  const game = new Game({ template: { create, bot }, recipe, headless: true, bot: true });
  game.start();
  let steps = 0;
  while (game.state === 'play' && game.world.level < 3 && steps < 60 * 240) { game.step(); steps++; }
  notes.push(`bot reached maze ${game.world.level} in ${game.time.toFixed(0)} s`);
  if (game.world.level < 2 && !(game.state === 'win')) {
    // with no guards a failed run means a broken maze; with guards it can just be the bot's bad luck
    const L1 = layout(recipe, 1);
    if (!L1.guards.length) ok = false;
    notes.push(L1.guards.length ? 'the bot was caught on maze 1 (the maze itself is solvable)' : 'bot could not finish maze 1');
  }
  return { ok, notes, score: game.score };
}
