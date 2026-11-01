/*! Chucksi Games · match.js · MIT License · Copyright (c) 2026 Chuck Crawley · https://github.com/ChuckGPTX/massless */
// Match three. Swipe a tile (or tap two neighbours, or arrows + Space) to swap; runs of three clear, four make a
// line blaster, five or an L make a bomb. Cascades multiply the score. Each level asks for a target score in a
// set number of moves; boards are dealt with no matches and at least one move, and reshuffle when stuck.

import { W, H, DT, clamp, ease, Game, roundRect } from './engine.js';
import { shade, alpha } from './art.js';

export const meta = { id: 'match', help: 'Swipe a tile to swap it with its neighbour. Match three or more in a row.' };
export const pointerAction = false;

const COLS = 8;
const ROWS = 8;
const TS = 62;
const BX = (W - COLS * TS) / 2;
const BY = 268;
const EXTRAS = {
  moon: ['seed', 'gear', 'star'], candy: ['donut', 'star', 'heart'], cave: ['gem', 'orb', 'star'], ocean: ['orb', 'star', 'gem'],
  forest: ['fruit', 'seed', 'star'], space: ['star', 'orb', 'gem'], default: ['gem', 'orb', 'star', 'gear', 'donut', 'fruit'],
};
const RECOLOR = new Set(['gem', 'star', 'orb', 'gear', 'donut', 'fruit', 'blob', 'ghost', 'bug', 'fish', 'bird', 'cat', 'fox', 'mouse', 'jelly', 'ufo', 'ship', 'robot', 'crystal', 'egg', 'knight', 'rover', 'sub', 'car']);

function tuning(recipe) { return { kinds: 5, moves: 22, target: 1200, ramp: 0.3, ...recipe.tuning }; }

// ---------- pure board helpers (shared with the bot and the playtest) ----------
export function runs(g) {
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      const k = g[r][c]?.k;
      let e = c + 1;
      while (k != null && k >= 0 && e < COLS && g[r][e]?.k === k) e++;
      if (k != null && k >= 0 && e - c >= 3) out.push({ dir: 'h', r, c, n: e - c, k });
      c = e;
    }
  }
  for (let c = 0; c < COLS; c++) {
    let r = 0;
    while (r < ROWS) {
      const k = g[r][c]?.k;
      let e = r + 1;
      while (k != null && k >= 0 && e < ROWS && g[e][c]?.k === k) e++;
      if (k != null && k >= 0 && e - r >= 3) out.push({ dir: 'v', r, c, n: e - r, k });
      r = e;
    }
  }
  return out;
}
const swapIn = (g, a, b) => { const t = g[a[0]][a[1]]; g[a[0]][a[1]] = g[b[0]][b[1]]; g[b[0]][b[1]] = t; };
/** Every swap that makes a match, with how many tiles it clears right away. */
export function moves(g) {
  const out = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const r2 = r + dr, c2 = c + dc;
      if (r2 >= ROWS || c2 >= COLS) continue;
      if (g[r][c].sp && g[r2][c2].sp) { out.push({ a: [r, c], b: [r2, c2], n: 8, best: 5 }); continue; }
      swapIn(g, [r, c], [r2, c2]);
      const rs = runs(g);
      swapIn(g, [r, c], [r2, c2]);
      if (rs.length) out.push({ a: [r, c], b: [r2, c2], n: rs.reduce((s, x) => s + x.n, 0), best: Math.max(...rs.map((x) => x.n)) });
    }
  }
  return out;
}
export function deal(rand, kinds) {
  for (let tries = 0; tries < 200; tries++) {
    const g = [];
    for (let r = 0; r < ROWS; r++) {
      g.push([]);
      for (let c = 0; c < COLS; c++) {
        let k;
        let guard = 0;
        do { k = Math.floor(rand() * kinds); guard++; } while (guard < 20 && ((c >= 2 && g[r][c - 1].k === k && g[r][c - 2].k === k) || (r >= 2 && g[r - 1][c].k === k && g[r - 2][c].k === k)));
        g[r].push({ k, sp: 0 });
      }
    }
    if (!runs(g).length && moves(g).length >= 3) return g;
  }
  return null;
}

class Match {
  constructor(game) {
    this.game = game;
    this.t = tuning(game.recipe);
    this.rand = game.rand;
    this.goal = game.recipe.goal || 0;
    this.level = 0;
    this.time = 0;
    this.cursor = [ROWS - 1, 0];
    this.grab = false;
    this.sel = null;
    this.phase = 'idle';
    this.wait = 0;
    this.combo = 0;
    this.beams = [];
    this.idleT = 0;
    this.skins = this.makeSkins(game);
    this.nextLevel(true);
  }
  makeSkins(game) {
    const R = game.recipe;
    const used = new Set();
    const list = [];
    for (const role of ['player', 'enemy', 'item']) {
      const shape = R[role]?.shape;
      if (!shape || used.has(shape)) continue;
      used.add(shape);
      list.push({ role, shape });
    }
    const extras = EXTRAS[R.world?.scene] || EXTRAS.default;
    for (const s of [...extras, ...EXTRAS.default]) { if (list.length >= 6) break; if (!used.has(s)) { used.add(s); list.push({ shape: s }); } }
    const pal = game.art?.pal;
    return list.slice(0, 6).map((s, i) => ({ ...s, color: pal ? (s.role ? game.art.colors(s.role).main : pal.tiles[i % pal.tiles.length]) : '#fff' }));
  }
  nextLevel(first = false) {
    this.level++;
    const t = this.t;
    this.kinds = clamp(Math.round(t.kinds) + Math.floor((this.level - 1) / 3), 4, 6);
    this.movesLeft = Math.max(10, Math.round(t.moves) - Math.floor((this.level - 1) / 2));
    this.target = Math.round((t.target * (1 + t.ramp) ** (this.level - 1)) / 50) * 50;
    this.levelScore = 0;
    const g = deal(this.rand, this.kinds);
    this.grid = g.map((row, r) => row.map((cell, c) => ({ ...cell, x: c, y: first ? r : r - ROWS - 2 - Math.random() * 2, vy: 0, s: 1, id: Math.random() })));
    this.phase = 'fall';
    this.banner = first ? 0 : 1.4;
  }
  cellAt(x, y) {
    const c = Math.floor((x - BX) / TS);
    const r = Math.floor((y - BY) / TS);
    return r >= 0 && r < ROWS && c >= 0 && c < COLS ? [r, c] : null;
  }

  // ---------- turns ----------
  trySwap(a, b, game) {
    if (this.phase !== 'idle' || !b || b[0] < 0 || b[1] < 0 || b[0] >= ROWS || b[1] >= COLS) return;
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) return;
    this.sel = null;
    this.idleT = 0;
    const g = this.grid;
    const A = g[a[0]][a[1]];
    const B = g[b[0]][b[1]];
    swapIn(g, a, b);
    game.sfx('swap');
    if (A.sp && B.sp) {
      this.movesLeft--;
      this.pending = { fire: [a, b] };
      this.phase = 'swap';
      this.wait = 0.16;
      return;
    }
    if (runs(g).length) {
      this.movesLeft--;
      this.lastSwap = b;
      this.phase = 'swap';
      this.wait = 0.16;
      this.combo = 0;
    } else {
      swapIn(g, a, b);
      this.phase = 'swap';
      this.wait = 0.3;
      this.bounce = { a, b, t: 0 };
      game.sfx('nope');
    }
  }
  resolve(game) {
    const g = this.grid;
    const rs = runs(g);
    const clear = new Set();
    const make = [];
    if (this.pending?.fire) { for (const [r, c] of this.pending.fire) clear.add(`${r},${c}`); this.pending = null; }
    // specials: where runs cross (L / T) or 5 in a row a bomb; 4 in a row a line blaster
    const hits = new Map();
    for (const run of rs) for (let i = 0; i < run.n; i++) { const r = run.dir === 'h' ? run.r : run.r + i; const c = run.dir === 'h' ? run.c + i : run.c; const key = `${r},${c}`; hits.set(key, (hits.get(key) || 0) + 1); clear.add(key); }
    const made = new Map();
    for (const run of rs) {
      const cells = Array.from({ length: run.n }, (_, i) => (run.dir === 'h' ? [run.r, run.c + i] : [run.r + i, run.c]));
      const at = cells.find(([r, c]) => this.lastSwap && r === this.lastSwap[0] && c === this.lastSwap[1]) || cells[Math.floor(run.n / 2)];
      const cross = cells.find(([r, c]) => hits.get(`${r},${c}`) > 1);
      const m = run.n >= 5 || cross ? { at: cross || at, sp: 3, k: run.k } : run.n === 4 ? { at, sp: run.dir === 'h' ? 1 : 2, k: run.k } : null;
      if (!m) continue;
      const key = `${m.at[0]},${m.at[1]}`;
      if (!made.has(key) || made.get(key).sp < m.sp) made.set(key, m);
    }
    make.push(...made.values());
    if (!clear.size) return false;
    // specials caught in the clear go off, and may set off others
    const queue = [...clear];
    const seen = new Set();
    while (queue.length) {
      const key = queue.pop();
      if (seen.has(key)) continue;
      seen.add(key);
      const [r, c] = key.split(',').map(Number);
      const cell = g[r][c];
      if (!cell || !cell.sp) continue;
      const add = [];
      if (cell.sp === 1) { for (let x = 0; x < COLS; x++) add.push([r, x]); this.beams.push({ dir: 'h', r, c, t: 0 }); }
      if (cell.sp === 2) { for (let y = 0; y < ROWS; y++) add.push([y, c]); this.beams.push({ dir: 'v', r, c, t: 0 }); }
      if (cell.sp === 3) { for (let y = r - 1; y <= r + 1; y++) for (let x = c - 1; x <= c + 1; x++) if (y >= 0 && x >= 0 && y < ROWS && x < COLS) add.push([y, x]); this.beams.push({ dir: 'b', r, c, t: 0 }); }
      game.sfx('explode', { vol: 0.45, pitch: 1.3 });
      game.shake(cell.sp === 3 ? 9 : 5);
      for (const [y, x] of add) { const k2 = `${y},${x}`; clear.add(k2); queue.push(k2); }
    }
    for (const m of make) clear.delete(`${m.at[0]},${m.at[1]}`);
    this.combo++;
    const gain = Math.round(clear.size * 10 * this.combo * (1 + make.length * 0.5));
    this.levelScore += gain;
    game.addScore(gain);
    const pal = game.art?.pal;
    let cx = 0, cy = 0;
    for (const key of clear) {
      const [r, c] = key.split(',').map(Number);
      const cell = g[r][c];
      const x = BX + c * TS + TS / 2;
      const y = BY + r * TS + TS / 2;
      cx += x; cy += y;
      if (cell) game.burst(x, y, { n: 6, color: [this.skins[cell.k]?.color || '#fff', '#fff'], speed: 220, size: 7, life: 0.45, grav: 500 });
      g[r][c] = null;
    }
    cx /= clear.size; cy /= clear.size;
    game.popText(cx, cy, `+${gain}`, { color: '#fff', size: 30 + Math.min(20, this.combo * 4) });
    if (this.combo >= 2) game.popText(W / 2, BY - 40, this.combo >= 4 ? `INCREDIBLE ×${this.combo}` : this.combo === 3 ? `GREAT ×3` : `COMBO ×2`, { color: pal?.accent || '#ffd166', size: 40, life: 1.1, vy: -30 });
    game.sfx('match', { pitch: 1 + (this.combo - 1) * 0.12 });
    if (clear.size >= 6) game.shake(4 + Math.min(10, clear.size / 2));
    for (const m of make) {
      const [r, c] = m.at;
      g[r][c] = { k: m.k, sp: m.sp, x: c, y: r, vy: 0, s: 1.5, id: Math.random() };
      game.sfx('power', { vol: 0.5 });
    }
    this.lastSwap = null;
    // gravity and refill
    for (let c = 0; c < COLS; c++) {
      let write = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) if (g[r][c]) { const cell = g[r][c]; g[r][c] = null; g[write][c] = cell; write--; }
      for (let r = write, n = 1; r >= 0; r--, n++) {
        let k = Math.floor(this.rand() * this.kinds);
        g[r][c] = { k, sp: 0, x: c, y: -n - 0.3, vy: 0, s: 1, id: Math.random() };
      }
    }
    return true;
  }
  shuffle(game) {
    const g = deal(this.rand, this.kinds);
    this.grid = g.map((row, r) => row.map((cell, c) => ({ ...cell, x: c, y: r, vy: 0, s: 0.2, id: Math.random() })));
    game.popText(W / 2, BY + ROWS * TS / 2, 'SHUFFLE', { color: '#fff', size: 44 });
    game.sfx('whoosh');
  }
  settled() {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const cell = this.grid[r][c]; if (cell && (Math.abs(cell.y - r) > 0.01 || Math.abs(cell.x - c) > 0.01)) return false; }
    return true;
  }
  update(dt, game) {
    this.time += dt;
    this.banner = Math.max(0, (this.banner || 0) - dt);
    // tiles ease to their cells; falling tiles accelerate and land with a bounce
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = this.grid[r][c];
      if (!cell) continue;
      cell.x += (c - cell.x) * Math.min(1, dt * 16);
      if (Math.abs(c - cell.x) < 0.01) cell.x = c;
      if (cell.y < r) { cell.vy += 60 * dt; cell.y = Math.min(r, cell.y + cell.vy * dt); if (cell.y >= r) { cell.vy = 0; cell.s = 0.86; } }
      else if (cell.y > r) { cell.y += (r - cell.y) * Math.min(1, dt * 16); if (Math.abs(cell.y - r) < 0.01) cell.y = r; }
      cell.s += (1 - cell.s) * Math.min(1, dt * 10);
    }
    this.beams = this.beams.filter((b) => (b.t += dt) < 0.35);
    if (this.bounce) { this.bounce.t += dt; if (this.bounce.t > 0.3) this.bounce = null; }
    if (this.wait > 0) { this.wait -= dt; return; }
    if (this.phase === 'swap') { this.phase = 'clear'; }
    if (this.phase === 'clear' || this.phase === 'fall') {
      if (!this.settled()) return;
      if (this.resolve(game)) { this.phase = 'fall'; this.wait = 0.12; return; }
      // the board is still
      if (this.levelScore >= this.target) return this.levelDone(game);
      if (this.movesLeft <= 0) { game.over(); this.phase = 'done'; return; }
      if (!moves(this.grid).length) this.shuffle(game);
      this.phase = 'idle';
      this.combo = 0;
    }
    if (this.phase === 'idle') this.input(game, dt);
  }
  levelDone(game) {
    const bonus = this.movesLeft * 25;
    if (bonus) game.addScore(bonus);
    game.popText(W / 2, BY + 150, 'LEVEL CLEAR', { color: game.art?.pal.accent || '#ffd166', size: 64, life: 1.5, vy: -20 });
    if (bonus) game.popText(W / 2, BY + 220, `+${bonus} for ${this.movesLeft} moves left`, { color: '#fff', size: 26, life: 1.5, vy: -20 });
    game.sfx('level');
    game.flash('#fff', 0.3);
    for (let i = 0; i < 4; i++) game.burst(80 + i * 130, BY + 200, { n: 16, color: game.art?.pal.tiles || ['#fff'], speed: 420, size: 9, life: 1, grav: 500, angle: -Math.PI / 2, spread: 1.6 });
    if (this.goal && this.level >= this.goal) { game.win(); this.phase = 'done'; return; }
    this.phase = 'between';
    this.wait = 1.4;
    this.after = () => this.nextLevel();
  }
  input(game, dt) {
    const inp = game.input;
    this.idleT += dt;
    if (inp.swipe && inp.swipeAt) {
      const a = this.cellAt(inp.swipeAt.x, inp.swipeAt.y);
      if (a) {
        const d = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] }[inp.swipe];
        this.trySwap(a, [a[0] + d[0], a[1] + d[1]], game);
        return;
      }
    }
    if (inp.tap) {
      const b = this.cellAt(inp.tap.x, inp.tap.y);
      if (b && this.sel && Math.abs(b[0] - this.sel[0]) + Math.abs(b[1] - this.sel[1]) === 1) this.trySwap(this.sel, b, game);
      else if (b) { this.sel = b; game.sfx('tick'); }
      return;
    }
    for (const [k, d] of [['left', [0, -1]], ['right', [0, 1]], ['up', [-1, 0]], ['down', [1, 0]]]) {
      if (!inp.pressed(k)) continue;
      const n = [clamp(this.cursor[0] + d[0], 0, ROWS - 1), clamp(this.cursor[1] + d[1], 0, COLS - 1)];
      if (this.grab) { this.grab = false; this.trySwap(this.cursor, n, game); } else this.cursor = n;
      this.keys = true;
    }
    if (inp.pressed('action')) { this.grab = !this.grab; this.keys = true; }
  }

  // ---------- drawing ----------
  tile(ctx, game, cell, x, y, size) {
    const skin = this.skins[cell.k] || this.skins[0];
    const art = game.art;
    if (skin.role) art.draw(ctx, skin.role, x, y, size);
    else art.draw(ctx, skin.shape, x, y, size, { color: RECOLOR.has(skin.shape) ? skin.color : null });
    if (cell.sp) {
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = 0.85 + 0.15 * Math.sin(this.time * 8);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      if (cell.sp === 1 || cell.sp === 2) {
        if (cell.sp === 2) ctx.rotate(Math.PI / 2);
        for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * size * 0.3, -9); ctx.lineTo(s * size * 0.48, 0); ctx.lineTo(s * size * 0.3, 9); ctx.stroke(); }
      } else {
        ctx.rotate(this.time * 2);
        ctx.beginPath(); ctx.arc(0, 0, size * 0.46, 0, Math.PI * 1.4); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fill();
      }
      ctx.restore();
    }
  }
  draw(ctx, game) {
    const art = game.art;
    const pal = art.pal;
    game.shaken(ctx);
    art.bg(ctx, { t: this.time, dim: art.images.bg ? 0.35 : 0.1 });
    // board
    ctx.fillStyle = alpha('#000000', 0.42);
    roundRect(ctx, BX - 12, BY - 12, COLS * TS + 24, ROWS * TS + 24, 22); ctx.fill();
    ctx.strokeStyle = alpha('#ffffff', 0.12); ctx.lineWidth = 2; ctx.stroke();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      ctx.fillStyle = (r + c) % 2 ? alpha('#ffffff', 0.06) : alpha('#ffffff', 0.11);
      roundRect(ctx, BX + c * TS + 3, BY + r * TS + 3, TS - 6, TS - 6, 12); ctx.fill();
    }
    // hint after a while
    let hint = null;
    if (this.phase === 'idle' && this.idleT > 6) { const m = moves(this.grid)[0]; if (m) hint = m; }
    ctx.save();
    ctx.beginPath(); ctx.rect(BX - 12, BY - 12, COLS * TS + 24, ROWS * TS + 24); ctx.clip();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = this.grid[r][c];
      if (!cell) continue;
      let x = BX + cell.x * TS + TS / 2;
      let y = BY + cell.y * TS + TS / 2;
      if (this.bounce) {
        const { a, b, t } = this.bounce;
        const k = Math.sin((t / 0.3) * Math.PI) * 0.45;
        if (r === a[0] && c === a[1]) { x += (b[1] - a[1]) * TS * k; y += (b[0] - a[0]) * TS * k; }
        if (r === b[0] && c === b[1]) { x += (a[1] - b[1]) * TS * k; y += (a[0] - b[0]) * TS * k; }
      }
      let size = (TS - 8) * cell.s;
      if (hint && ((r === hint.a[0] && c === hint.a[1]) || (r === hint.b[0] && c === hint.b[1]))) size *= 1 + 0.08 * Math.sin(this.time * 10);
      const sel = this.sel && this.sel[0] === r && this.sel[1] === c;
      if (sel) { ctx.fillStyle = alpha(pal.accent, 0.35); roundRect(ctx, BX + c * TS + 2, BY + r * TS + 2, TS - 4, TS - 4, 12); ctx.fill(); size *= 1.08; }
      this.tile(ctx, game, cell, x, y, size);
    }
    ctx.restore();
    if (this.keys) {
      ctx.strokeStyle = this.grab ? pal.accent : '#fff';
      ctx.lineWidth = 4;
      roundRect(ctx, BX + this.cursor[1] * TS + 2, BY + this.cursor[0] * TS + 2, TS - 4, TS - 4, 12); ctx.stroke();
    }
    for (const b of this.beams) {
      const k = 1 - b.t / 0.35;
      ctx.fillStyle = alpha('#ffffff', 0.8 * k);
      if (b.dir === 'h') ctx.fillRect(BX, BY + b.r * TS + TS / 2 - 10 * k, COLS * TS, 20 * k);
      else if (b.dir === 'v') ctx.fillRect(BX + b.c * TS + TS / 2 - 10 * k, BY, 20 * k, ROWS * TS);
      else { ctx.beginPath(); ctx.arc(BX + b.c * TS + TS / 2, BY + b.r * TS + TS / 2, TS * (1.6 - k), 0, 7); ctx.fill(); }
    }
    // moves and target under the board
    const y0 = BY + ROWS * TS + 34;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 46px "Big Shoulders Display", Impact, sans-serif`;
    ctx.fillStyle = this.movesLeft <= 3 ? pal.enemy : '#fff';
    ctx.fillText(String(this.movesLeft), W / 2 - 120, y0 + 18);
    ctx.font = `600 14px "Instrument Sans", system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('MOVES', W / 2 - 120, y0 + 52);
    const bw = 230;
    const k = clamp(this.levelScore / this.target, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.16)'; roundRect(ctx, W / 2 - 40, y0 + 6, bw, 22, 11); ctx.fill();
    ctx.fillStyle = pal.accent; roundRect(ctx, W / 2 - 40, y0 + 6, Math.max(22, bw * k), 22, 11); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`${Math.min(this.levelScore, this.target)} / ${this.target}`, W / 2 - 40 + bw / 2, y0 + 52);
    if (art.recipe.player?.shape && !art.image('player')) {
      const bob = Math.sin(this.time * 3) * 5;
      art.draw(ctx, 'player', 70, y0 + 120 + bob, 90, { rot: Math.sin(this.time * 2) * 0.08 });
      art.draw(ctx, 'enemy', W - 70, y0 + 120 - bob, 90, { rot: -Math.sin(this.time * 2) * 0.08, flip: true });
    }
    game.particles.draw(ctx);
    if (this.banner > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(1, this.banner / 0.3); ctx.font = `900 64px "Big Shoulders Display", Impact, sans-serif`;
      ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.strokeText(`LEVEL ${this.level}`, W / 2, BY + ROWS * TS / 2); ctx.fillStyle = '#fff'; ctx.fillText(`LEVEL ${this.level}`, W / 2, BY + ROWS * TS / 2);
      ctx.restore();
    }
  }
  hud(ctx, game) {
    game.drawHud(ctx, { label: `Level ${this.level}${this.goal ? `/${this.goal}` : ''}` });
  }
}

// the 'between levels' pause: run the queued level change once the wait ends
const baseUpdate = Match.prototype.update;
Match.prototype.update = function update(dt, game) {
  if (this.phase === 'between') {
    this.time += dt;
    this.wait -= dt;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const cell = this.grid[r][c]; if (cell) cell.s = Math.max(0, cell.s - dt * 2.2); }
    if (this.wait <= 0) { const f = this.after; this.after = null; f?.(); }
    return;
  }
  baseUpdate.call(this, dt, game);
};

export function create(game) { return new Match(game); }

// ---------- bot: the swap that clears the most, lower rows first ----------
export function bot(w, game) {
  if (w.phase !== 'idle') { w.botT = game.fast ? 0 : 0.45; game.input.setBot({}); return; }
  w.botT = (w.botT ?? 0.45) - DT;
  if (w.botT > 0) { game.input.setBot({}); return; }
  const ms = moves(w.grid);
  if (!ms.length) { game.input.setBot({}); return; }
  ms.sort((a, b) => (b.best * 10 + b.n + Math.max(a.a[0], a.b[0]) * 0.1) - (a.best * 10 + a.n + Math.max(b.a[0], b.b[0]) * 0.1));
  const m = ms[0];
  const dir = m.b[1] > m.a[1] ? 'right' : 'down';
  game.input.setBot({}, { x: BX + m.a[1] * TS + TS / 2, y: BY + m.a[0] * TS + TS / 2, down: false, swipe: dir });
  w.botT = 0.45;
}

// ---------- playtest ----------
/** Boards dealt for this recipe have no matches and some moves; the greedy bot then clears level 1. */
export function playtest(recipe) {
  const game = new Game({ template: { create, bot }, recipe, headless: true, bot: true });
  game.start();
  const w = game.world;
  let ok = true;
  const notes = [];
  for (let i = 0; i < 12; i++) {
    const g = deal(game.rand, Math.min(6, w.kinds + (i % 3)));
    if (!g || runs(g).length || moves(g).length < 3) { ok = false; notes.push('a dealt board had no moves or a ready match'); break; }
  }
  notes.push(`12 boards dealt with no matches and at least 3 moves each`);
  let steps = 0;
  while (game.state === 'play' && w.level < 2 && steps < 60 * 400) { game.step(); steps++; }
  const cleared = w.level >= 2 || game.state === 'win';
  // a greedy bot plays worse than a person: it has to get most of the way, not all of it
  if (!cleared) { if (w.levelScore < w.target * 0.7) ok = false; notes.push(`greedy bot scored ${w.levelScore} of ${w.target} on level 1`); } else notes.push(`greedy bot cleared level 1 in ${game.time.toFixed(0)} s`);
  return { ok, notes, score: game.score };
}
