/*! Massless Games · shooter.js · MIT License · Copyright (c) 2026 Chuck Crawley · https://github.com/ChuckGPTX/massless */
// Vertical scrolling shooter. Drag anywhere (or use the arrow keys) to fly; the ship fires on its own.
// Waves come in formations (lines, V, weavers, divers, turrets), each wave bigger and faster; every fifth wave
// is a boss with bullet patterns. Power-ups: spread shot and a heart.

import { W, H, DT, clamp, Game } from './engine.js';

export const meta = { id: 'shooter', help: 'Drag anywhere to fly, or use the arrow keys. You fire on your own.' };
export const pointerAction = false;

function tuning(recipe) {
  return { enemySpeed: 1, fireRate: 8, enemyFire: 1, waveSize: 7, ramp: 0.14, lives: 3, ...recipe.tuning };
}

class Shooter {
  constructor(game) {
    this.game = game;
    this.t = tuning(game.recipe);
    this.rand = game.rand;
    this.p = { x: W / 2, y: H - 170, r: 22, inv: 1.2, fire: 0, power: 0, lives: this.t.lives, tilt: 0 };
    this.shots = [];
    this.bullets = [];
    this.enemies = [];
    this.drops = [];
    this.wave = 0;
    this.waveT = 1.2;
    this.time = 0;
    this.scroll = 0;
    this.goal = game.recipe.goal || 0;
    this.kills = 0;
    this.banner = 0;
  }
  diff() { return 1 + this.t.ramp * (this.wave - 1); }

  // ---------- waves ----------
  spawnWave() {
    this.wave++;
    const r = this.rand;
    const d = this.diff();
    const n = Math.round(this.t.waveSize * Math.min(2.2, 0.75 + 0.25 * d));
    const boss = this.wave % 5 === 0;
    this.banner = 1.6;
    this.game.sfx(boss ? 'whoosh' : 'level', { vol: 0.6 });
    if (boss) {
      const hp = Math.round(60 + 26 * this.wave * this.t.enemySpeed);
      this.enemies.push({ kind: 'boss', x: W / 2, y: -120, ty: 210, r: 70, hp, max: hp, t: 0, fire: 1.4, ph: r() * 6, score: 500 + this.wave * 50 });
      return;
    }
    const pattern = this.wave === 1 ? 'line' : this.wave === 2 ? 'vee' : r.pick(['line', 'vee', 'weave', 'dive', 'turret', 'mix']);
    const sp = (82 + 18 * d) * this.t.enemySpeed;
    const fireP = Math.min(0.85, (0.18 + 0.07 * this.wave) * this.t.enemyFire);
    for (let i = 0; i < n; i++) {
      const k = n > 1 ? i / (n - 1) : 0.5;
      const e = { kind: 'drone', x: 60 + k * (W - 120), y: -40 - (i % 2) * 40, r: 24, hp: 2 + Math.floor(this.wave / 3), vx: 0, vy: sp, t: -i * 0.18, ph: r() * 6, fire: r.range(1.2, 3.2) / Math.max(0.3, this.t.enemyFire), shoots: r() < fireP, score: 10 };
      const kind = pattern === 'mix' ? r.pick(['line', 'vee', 'weave', 'dive']) : pattern;
      // drones fly in fast to a hover row, then drift down slowly, weaving, and now and then peel off to dive
      e.ty = 150 + (i % 3) * 62 + r() * 36;
      if (kind === 'vee') { e.y = -40 - Math.abs(k - 0.5) * 260; e.ty = 150 + Math.abs(k - 0.5) * 240; }
      if (kind === 'weave') { e.weave = r.range(60, 120); e.x = W / 2 + (k - 0.5) * 200; e.y = -40 - i * 60; e.vy *= 0.85; e.ty = 170 + (i % 4) * 40; }
      if (kind === 'dive') { e.kind = 'diver'; e.y = -40 - i * 90; e.x = r.range(60, W - 60); e.vy = sp * 1.25; e.r = 22; e.shoots = false; e.score = 15; }
      if (kind === 'turret') { e.kind = 'turret'; e.ty = r.range(110, 330); e.vy = sp * 1.4; e.hp += 2; e.r = 28; e.shoots = true; e.fire = r.range(0.8, 1.6) / Math.max(0.3, this.t.enemyFire); e.score = 30; if (i >= Math.ceil(n / 2)) continue; e.x = 80 + (i / Math.max(1, Math.ceil(n / 2) - 1)) * (W - 160); }
      this.enemies.push(e);
    }
  }

  // ---------- rules ----------
  update(dt, game) {
    this.time += dt;
    this.scroll += dt * 120;
    const p = this.p;
    const inp = game.input;
    const t = this.t;
    if (p.lives > 0) {
      // drag moves the ship by the finger's motion (it never hides under the finger); keys move it directly
      let dx = inp.pointer.down ? inp.pointer.dx * 1.15 : 0;
      let dy = inp.pointer.down ? inp.pointer.dy * 1.15 : 0;
      const ks = 430 * dt;
      if (inp.held('left')) dx -= ks;
      if (inp.held('right')) dx += ks;
      if (inp.held('up')) dy -= ks;
      if (inp.held('down')) dy += ks;
      p.x = clamp(p.x + dx, 26, W - 26);
      p.y = clamp(p.y + dy, 140, H - 60);
      p.tilt += (clamp(dx / (ks || 1), -1, 1) * 0.35 - p.tilt) * Math.min(1, dt * 10);
      p.fire -= dt;
      if (p.fire <= 0) {
        p.fire = 1 / t.fireRate;
        const lanes = p.power >= 2 ? [-0.22, -0.08, 0.08, 0.22] : p.power === 1 ? [-0.12, 0, 0.12] : [-0.03, 0.03];
        for (const a of lanes) this.shots.push({ x: p.x + a * 60, y: p.y - 30, vx: Math.sin(a) * 900, vy: -Math.cos(a) * 900 });
        game.sfx('shoot', { pitch: 0.9 + Math.random() * 0.2, vol: 0.7 });
      }
      p.inv = Math.max(0, p.inv - dt);
    }
    // waves: the next one rolls in when this one is nearly cleared (or has been around for a while); bosses fight alone
    const alive = this.enemies.filter((e) => !e.dead).length;
    const bossUp = this.enemies.some((e) => e.kind === 'boss');
    this.sinceWave = (this.sinceWave || 0) + dt;
    const nearlyClear = alive <= Math.max(0, Math.floor((this.lastSize || 0) * 0.25)) && !bossUp;
    if (alive === 0 || (nearlyClear && this.sinceWave > 4) || (this.sinceWave > 10 && !bossUp)) {
      this.waveT -= dt;
      if (this.waveT <= 0) {
        if (this.goal && this.wave >= this.goal) { if (alive === 0) game.win(); return; }
        if ((this.wave + 1) % 5 === 0 && alive > 0) return; // clear the floor before a boss
        const before = this.enemies.length;
        this.spawnWave();
        this.lastSize = this.enemies.length - before;
        this.sinceWave = 0;
        this.waveT = 0.9;
      }
    }
    this.banner = Math.max(0, this.banner - dt);
    // shots
    for (const s of this.shots) { s.x += s.vx * dt; s.y += s.vy * dt; }
    this.shots = this.shots.filter((s) => s.y > -20 && !s.hit && s.x > -20 && s.x < W + 20);
    // enemies
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.t += dt;
      if (e.t < 0) continue;
      if (e.kind === 'boss') this.bossStep(e, dt, game);
      else if (e.kind === 'turret') { if (e.y < e.ty) e.y = Math.min(e.ty, e.y + e.vy * 2 * dt); else { e.y = e.ty; e.x += Math.sin(e.t * 1.3 + e.ph) * 40 * dt; } }
      else if (e.kind === 'diver') {
        if (!e.locked && e.y > Math.max(160, (e.ty || 0) + 30)) { e.locked = true; const a = Math.atan2(p.y - e.y, p.x - e.x); e.vx = Math.cos(a) * e.vy * 1.3; e.vy = Math.sin(a) * e.vy * 1.3; }
        e.x += e.vx * dt; e.y += e.vy * dt;
      } else {
        if (e.y < e.ty) e.y += e.vy * 2.6 * dt;
        else {
          e.y += e.vy * 0.28 * dt;
          if (this.rand() < (0.03 + 0.012 * this.wave) * dt * this.t.enemySpeed) { e.kind = 'diver'; e.vy *= 1.4; e.locked = false; }
        }
        if (e.weave) e.x += Math.cos(e.t * 2.2 + e.ph) * e.weave * dt * 2;
        else e.x += Math.sin(e.t * 1.4 + e.ph) * 36 * dt;
        e.x = clamp(e.x, 30, W - 30);
      }
      if (e.shoots && e.y > 20 && e.y < H * 0.6 && p.lives > 0) {
        e.fire -= dt;
        if (e.fire <= 0) {
          e.fire = (e.kind === 'turret' ? 1.3 : 2.4) / Math.max(0.3, t.enemyFire) * (0.8 + this.rand() * 0.5);
          const a = Math.atan2(p.y - e.y, p.x - e.x);
          const sp = (210 + 14 * this.wave) * Math.min(1.4, t.enemySpeed);
          if (e.kind === 'turret' && this.wave > 3) for (const da of [-0.25, 0, 0.25]) this.bullets.push({ x: e.x, y: e.y, vx: Math.cos(a + da) * sp, vy: Math.sin(a + da) * sp, r: 7 });
          else this.bullets.push({ x: e.x, y: e.y + 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 7 });
          game.sfx('zap', { vol: 0.5 });
        }
      }
      if (e.y > H + 60 || e.x < -80 || e.x > W + 80) e.dead = e.gone = true;
      // hits from the player's shots
      for (const s of this.shots) {
        if (e.y < 24 || ((e.kind === 'drone' || e.kind === 'turret') && e.y < e.ty - 8)) break; // nothing takes hits until it has flown in
        if (s.hit || (s.x - e.x) ** 2 + (s.y - e.y) ** 2 > (e.r + 6) ** 2) continue;
        s.hit = true;
        e.hp--;
        e.flash = 0.06;
        if (e.kind === 'boss') { game.burst(s.x, s.y, { n: 2, color: '#fff', speed: 120, size: 4, life: 0.2, grav: 0 }); game.addScore(1); }
        if (e.hp <= 0) { this.kill(e, game); break; }
      }
      e.flash = Math.max(0, (e.flash || 0) - dt);
      // ram the player
      if (!e.dead && p.lives > 0 && p.inv <= 0 && (e.x - p.x) ** 2 + (e.y - p.y) ** 2 < (e.r * 0.8 + p.r * 0.7) ** 2) {
        if (e.kind !== 'boss') this.kill(e, game);
        this.hurt(game);
      }
    }
    this.enemies = this.enemies.filter((e) => !e.dead);
    // enemy bullets
    for (const b of this.bullets) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (p.lives > 0 && p.inv <= 0 && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < (b.r + p.r * 0.45) ** 2) { b.hit = true; this.hurt(game); }
    }
    this.bullets = this.bullets.filter((b) => !b.hit && b.y < H + 20 && b.y > -40 && b.x > -20 && b.x < W + 20);
    // power-ups
    for (const d of this.drops) {
      d.y += 120 * dt;
      d.t += dt;
      if (p.lives > 0 && (d.x - p.x) ** 2 + (d.y - p.y) ** 2 < 44 ** 2) {
        d.got = true;
        if (d.kind === 'heart') { p.lives = Math.min(this.t.lives + 1, p.lives + 1); game.popText(d.x, d.y - 30, '+1 LIFE', { color: '#ff4f6d' }); }
        else { p.power = Math.min(2, p.power + 1); game.popText(d.x, d.y - 30, 'POWER UP', { color: game.art?.pal.accent || '#ffd166' }); }
        game.sfx('power');
      }
    }
    this.drops = this.drops.filter((d) => !d.got && d.y < H + 40);
  }
  bossStep(e, dt, game) {
    if (e.y < e.ty) e.y += 90 * dt;
    e.x = W / 2 + Math.sin(e.t * 0.7 + e.ph) * (W / 2 - 100);
    e.fire -= dt;
    if (e.fire <= 0 && e.y >= e.ty - 4 && this.p.lives > 0) {
      const phase = Math.floor(e.t / 4) % 3;
      const sp = 190 + 10 * this.wave;
      if (phase === 0) { const n = 10 + Math.min(8, this.wave); for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + e.t; this.bullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp * 0.8, vy: Math.sin(a) * sp * 0.8, r: 8 }); } e.fire = 1.3 / Math.max(0.4, this.t.enemyFire); }
      else if (phase === 1) { const a = Math.atan2(this.p.y - e.y, this.p.x - e.x); for (const da of [-0.3, -0.15, 0, 0.15, 0.3]) this.bullets.push({ x: e.x, y: e.y + 30, vx: Math.cos(a + da) * sp, vy: Math.sin(a + da) * sp, r: 7 }); e.fire = 1 / Math.max(0.4, this.t.enemyFire); }
      else { const a = Math.PI / 2 + Math.sin(e.t * 3) * 0.9; this.bullets.push({ x: e.x, y: e.y + 30, vx: Math.cos(a) * sp * 1.2, vy: Math.sin(a) * sp * 1.2, r: 7 }); e.fire = 0.12 / Math.max(0.4, this.t.enemyFire); }
      game.sfx('zap', { vol: 0.4, pitch: 0.7 });
    }
  }
  kill(e, game) {
    e.dead = true;
    this.kills++;
    const big = e.kind === 'boss';
    game.addScore(e.score, e.x, e.y - 20, big ? (game.art?.pal.accent || '#fc0') : '#fff');
    game.sfx(big ? 'boom' : 'explode', { vol: big ? 1 : 0.55, pitch: 0.9 + Math.random() * 0.3 });
    game.shake(big ? 22 : 5);
    if (big) { game.flash('#fff', 0.7); this.bullets.length = 0; }
    const pal = game.art?.pal;
    game.burst(e.x, e.y, { n: big ? 70 : 18, color: [pal?.enemy || '#f55', '#fff', pal?.accent || '#fc0'], speed: big ? 520 : 320, size: big ? 12 : 8, life: big ? 1.1 : 0.55, grav: 0, drag: 2.2, shape: 'square' });
    const dropP = big ? 1 : 0.07;
    if (this.rand() < dropP) this.drops.push({ x: e.x, y: e.y, t: 0, kind: this.p.lives < this.t.lives && this.rand() < 0.4 ? 'heart' : 'power' });
  }
  hurt(game) {
    const p = this.p;
    p.lives--;
    p.inv = 1.6;
    p.power = Math.max(0, p.power - 1);
    game.sfx('hurt');
    game.shake(14);
    game.flash(game.art?.pal.enemy || '#f55', 0.35);
    game.burst(p.x, p.y, { n: 22, color: ['#fff', game.art?.pal.player || '#0ff'], speed: 360, size: 7, life: 0.6, grav: 0 });
    if (p.lives <= 0) {
      game.sfx('boom');
      game.burst(p.x, p.y, { n: 60, color: ['#fff', game.art?.pal.player || '#0ff', '#fc0'], speed: 520, size: 10, life: 1, grav: 0, shape: 'square' });
      game.over();
    }
  }

  // ---------- drawing ----------
  draw(ctx, game) {
    const art = game.art;
    const pal = art.pal;
    const t = this.time;
    game.shaken(ctx);
    art.bg(ctx, { t, vy: 160, ambient: false });
    // streaming stars (or bubbles, underwater) give the sense of flight
    const wet = art.recipe.world?.scene === 'ocean';
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 46; i++) {
      const [a, b, c] = art.amb[i % art.amb.length];
      const sp = 60 + c * 340;
      const y = ((b * H + this.scroll * (sp / 120)) % H);
      ctx.globalAlpha = 0.2 + c * 0.5;
      if (wet) { ctx.beginPath(); ctx.arc(a * W + Math.sin(t * 2 + i) * 6, y, 2 + c * 5, 0, 7); ctx.stroke(); }
      else ctx.fillRect(a * W, y, 1.6 + c * 1.4, 2 + c * c * 18);
    }
    ctx.globalAlpha = 1;
    for (const d of this.drops) {
      ctx.save(); ctx.globalAlpha = 0.5 + 0.3 * Math.sin(d.t * 8); ctx.fillStyle = d.kind === 'heart' ? '#ff4f6d' : pal.accent; ctx.beginPath(); ctx.arc(d.x, d.y, 26, 0, 7); ctx.fill(); ctx.restore();
      art.draw(ctx, d.kind === 'heart' ? 'heart' : 'item', d.x, d.y, 38, { rot: Math.sin(d.t * 3) * 0.3 });
    }
    for (const e of this.enemies) {
      if (e.t < 0) continue;
      const size = e.kind === 'boss' ? 170 : e.kind === 'turret' ? 66 : 60;
      const rot = e.kind === 'diver' && e.locked ? Math.atan2(e.vy, e.vx) - Math.PI / 2 : Math.sin(t * 3 + e.ph) * 0.12;
      if (art.image('enemy')) art.draw(ctx, 'enemy', e.x, e.y, size, { rot, sy: -1 });
      else art.draw(ctx, 'enemy', e.x, e.y, size, { rot: rot + (['ship', 'rover', 'car'].includes(art.shapeOf('enemy')) ? Math.PI : 0) });
      if (e.flash > 0) { ctx.save(); ctx.globalAlpha = 0.7; ctx.globalCompositeOperation = 'lighter'; art.draw(ctx, 'enemy', e.x, e.y, size, { rot, alpha: 0.6 }); ctx.restore(); }
      if (e.kind === 'boss') {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(70, 140, W - 140, 10);
        ctx.fillStyle = pal.enemy; ctx.fillRect(70, 140, (W - 140) * (e.hp / e.max), 10);
      }
    }
    // player shots
    ctx.fillStyle = pal.accent;
    for (const s of this.shots) { ctx.fillRect(s.x - 2.5, s.y - 12, 5, 22); }
    // enemy bullets
    for (const b of this.bullets) {
      ctx.fillStyle = pal.enemy; ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 3, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 2, 0, 7); ctx.fill();
    }
    const p = this.p;
    if (p.lives > 0 && !(p.inv > 0 && Math.floor(t * 18) % 2 === 0)) {
      // engine flame
      const fl = 18 + Math.sin(t * 40) * 6;
      ctx.fillStyle = '#ffb703'; ctx.beginPath(); ctx.moveTo(p.x - 9, p.y + 26); ctx.lineTo(p.x, p.y + 26 + fl); ctx.lineTo(p.x + 9, p.y + 26); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(p.x - 4, p.y + 26); ctx.lineTo(p.x, p.y + 26 + fl * 0.5); ctx.lineTo(p.x + 4, p.y + 26); ctx.fill();
      const shape = art.shapeOf('player');
      const upright = ['ship', 'ufo', 'egg', 'robot', 'crystal', 'ghost', 'jelly', 'knight'].includes(shape) || art.image('player');
      art.draw(ctx, 'player', p.x, p.y, 70, { rot: (upright ? 0 : -Math.PI / 2) + p.tilt * 0.5, sx: 1 - Math.abs(p.tilt) * 0.3 });
    }
    game.particles.draw(ctx);
    if (this.banner > 0) {
      const k = Math.min(1, this.banner / 0.3, (1.6 - this.banner) / 0.2);
      ctx.save(); ctx.globalAlpha = Math.max(0, k); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `900 64px ${'"Big Shoulders Display", Impact, sans-serif'}`;
      ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      const txt = this.wave % 5 === 0 ? 'BOSS' : `WAVE ${this.wave}`;
      ctx.strokeText(txt, W / 2, H * 0.42); ctx.fillStyle = this.wave % 5 === 0 ? pal.enemy : '#fff'; ctx.fillText(txt, W / 2, H * 0.42);
      ctx.restore();
    }
  }
  hud(ctx, game) {
    game.drawHud(ctx, { label: `Wave ${this.wave}${this.goal ? `/${this.goal}` : ''}`, lives: this.p.lives, maxLives: Math.max(this.t.lives, this.p.lives) });
  }
}

export function create(game) { return new Shooter(game); }

// ---------- bot: stay under a target, dodge what's coming ----------
export function bot(w, game) {
  const p = w.p;
  if (p.lives <= 0) { game.input.setBot({}); return; }
  // where would each candidate x be safe over the next ~0.6 s?
  const cands = [];
  for (let x = 40; x <= W - 40; x += 20) cands.push(x);
  const targetE = w.enemies.filter((e) => e.t >= 0 && e.y > 0).sort((a, b) => b.y - a.y)[0];
  let best = p.x;
  let bestScore = -1e9;
  const yWant = clamp(H - 190, 160, H - 80);
  for (const x of cands) {
    if (Math.abs(x - p.x) > 260) continue;
    let danger = 0;
    for (const b of w.bullets) {
      for (const tt of [0.1, 0.25, 0.4, 0.6]) {
        const bx = b.x + b.vx * tt;
        const by = b.y + b.vy * tt;
        const px = p.x + clamp(x - p.x, -400 * tt, 400 * tt);
        const d2 = (bx - px) ** 2 + (by - yWant) ** 2;
        if (d2 < 46 ** 2) danger += 3 / (tt + 0.2);
      }
    }
    for (const e of w.enemies) {
      if (e.t < 0) continue;
      for (const tt of [0.2, 0.5, 0.8]) {
        const ex = e.x + (e.vx || 0) * tt;
        const ey = e.y + (e.kind === 'boss' || e.kind === 'turret' ? 0 : e.vy * tt);
        if (Math.abs(ex - x) < e.r + 34 && Math.abs(ey - yWant) < e.r + 40) danger += 4;
      }
    }
    const aim = targetE ? -Math.abs(x - targetE.x) / 120 : -Math.abs(x - W / 2) / 300;
    const score = -danger * 10 + aim - Math.abs(x - p.x) / 400;
    if (score > bestScore) { bestScore = score; best = x; }
  }
  const keys = { left: best < p.x - 6, right: best > p.x + 6, up: p.y > yWant + 8, down: p.y < yWant - 8 };
  game.input.setBot(keys);
}

// ---------- playtest ----------
/** A dodging bot must survive the first 30 s (wave 1 onward) without losing its last life. */
export function playtest(recipe, { seconds = 30 } = {}) {
  const game = new Game({ template: { create, bot }, recipe, headless: true, bot: true });
  game.start();
  game.advance(seconds);
  const w = game.world;
  const ok = game.state === 'play' || game.state === 'win';
  return { ok, notes: [`dodging bot: ${ok ? 'survived' : 'shot down at'} ${game.time.toFixed(1)} s, wave ${w.wave}, ${w.p.lives} lives left, ${w.kills} kills`], score: game.score };
}
