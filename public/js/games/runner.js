/*! Chucksi Games · runner.js · MIT License · Copyright (c) 2026 Chuck Crawley · https://github.com/ChuckGPTX/massless */
// Endless side runner. One button: tap to jump, tap again in the air to double jump, hold for height.
// Patterns (hazards, clusters, tall hazards, pits, platforms over pits, walkers you can stomp, low and high
// flyers, coin arcs, shields) are laid out ahead from the seeded RNG, each sized to the jump arc at the speed
// it will be met at. The speed ramps; every 500 m is a new zone.

import { W, H, DT, clamp, rng, Game } from './engine.js';

const GY = 800;
const PX = 150;
const M = 40; // px per metre
const STACKED = new Set(['crate', 'barrier', 'rock', 'mine']);

export const meta = { id: 'runner', help: 'Tap, click or press Space to jump. Tap again in the air to double jump. Hold to jump higher.' };

function tuning(recipe) {
  const t = { speed: 330, accel: 3, maxSpeed: 660, gravity: 2600, jump: 980, gap: 1, coins: 0.6, pits: 0.4, flyers: 0.35, walkers: 0.35, ...recipe.tuning };
  t.maxSpeed = Math.max(t.maxSpeed, t.speed + 20);
  return t;
}
/** Seconds the feet stay above height h during a full single jump. */
const windowAbove = (t, h) => { const d = t.jump * t.jump - 2 * t.gravity * h; return d > 0 ? (2 * Math.sqrt(d)) / t.gravity : 0; };

class Runner {
  constructor(game) {
    this.game = game;
    this.recipe = game.recipe;
    this.t = tuning(game.recipe);
    this.rand = game.rand;
    const a = game.recipe.art || {};
    this.sheet = !!a.player && typeof a.player === 'object';
    this.tallFoes = !!a.enemy && typeof a.enemy === 'object';
    this.pw = this.sheet ? 46 : 44;
    this.ph = this.sheet ? 92 : 58;
    this.dist = 0;
    this.speed = this.t.speed;
    this.time = 0;
    this.p = { y: GY, vy: 0, ground: true, jumps: 1, coyote: 0, buffer: 0, sq: 1, alive: true, shield: false, inv: 0, holding: false, runT: 0, land: 0 };
    this.obs = [];
    this.nextX = W + 260;
    this.coins = 0;
    this.stomps = 0;
    this.zone = 0;
    this.goal = (game.recipe.goal || 0) * M;
    this.dustT = 0;
    this.fill();
  }
  get meters() { return Math.floor(this.dist / M); }

  // ---------- level generation ----------
  fill() { while (this.nextX < this.dist + W + 500) this.spawn(); }
  spawn() {
    const t = this.t;
    const r = this.rand;
    const lead = (this.nextX - this.dist - PX) / Math.max(1, this.speed);
    const v = Math.min(t.maxSpeed, this.speed + t.accel * lead);
    const d = clamp((v - t.speed) / Math.max(1, t.maxSpeed - t.speed), 0, 1);
    const air = (2 * t.jump) / t.gravity;
    const reach = v * air;
    const gapMin = v * 0.5 + 80;
    let x = this.nextX;
    const fits = (h, w, rv = v) => rv * windowAbove(t, h + 10) >= w + this.pw + 26;
    const hazard = (hx, w, h) => {
      while (h > 40 && !fits(h, w)) h -= 6;
      this.obs.push({ type: 'hazard', x: hx, w, h, y: GY - h });
      return hx + w;
    };
    const coinArc = (cx, span, top = 150) => {
      if (!r.chance(t.coins)) return;
      const n = 5;
      for (let i = 0; i < n; i++) {
        const k = i / (n - 1);
        this.obs.push({ type: 'coin', x: cx - span / 2 + k * span, y: GY - 40 - Math.sin(k * Math.PI) * top, w: 30, h: 30 });
      }
    };
    const weights = [
      ['hazard', 3], ['double', 1 + d * 1.6], ['tall', 0.7 + d], ['pit', t.pits * 3], ['plat', t.pits * (0.6 + d)],
      ['walker', t.walkers * 2.6], ['flyer', t.flyers * 2.4], ['coins', t.coins * 0.8],
    ].filter(([, w]) => w > 0);
    let sum = weights.reduce((a, [, w]) => a + w, 0);
    let pick = r() * sum;
    let kind = weights[0][0];
    for (const [k, w] of weights) { if ((pick -= w) <= 0) { kind = k; break; } }
    let end = x;
    switch (kind) {
      case 'hazard': {
        const w = r.range(40, 58);
        end = hazard(x, w, r.range(42, 74));
        coinArc(x + w / 2, Math.min(reach * 0.7, 220), 160);
        break;
      }
      case 'double': {
        const w1 = r.range(38, 52);
        const h1 = r.range(40, 64);
        if (r.chance(0.5)) {
          const h = Math.min(h1, 54);
          let gap = r.range(18, 46);
          let w2 = r.range(36, 50);
          while (!fits(h, w1 + gap + w2) && gap > 8) gap -= 6;
          while (!fits(h, w1 + gap + w2) && w2 > 30) w2 -= 4;
          hazard(x, w1, h);
          end = hazard(x + w1 + gap, w2, h);
          if (!fits(h, w1 + gap + w2)) { this.obs.pop(); end = x + w1; }
        } else {
          hazard(x, w1, h1);
          end = hazard(x + w1 + gapMin * r.range(1, 1.25), r.range(38, 52), r.range(40, 70));
        }
        break;
      }
      case 'tall': {
        const w = r.range(40, 50);
        end = hazard(x, w, r.range(96, 118 + d * 26));
        break;
      }
      case 'pit': {
        const w = clamp(reach * r.range(0.34, 0.5 + d * 0.08), 70, reach - this.pw - 70);
        this.obs.push({ type: 'pit', x, w, y: GY, h: 300 });
        coinArc(x + w / 2, w * 0.9, 130);
        end = x + w;
        break;
      }
      case 'plat': {
        const pw = r.range(150, 220);
        const g1 = clamp(reach * r.range(0.28, 0.38), 60, reach * 0.42);
        const g2 = clamp(reach * r.range(0.28, 0.38), 60, reach * 0.42);
        const py = GY - r.range(90, 120);
        this.obs.push({ type: 'pit', x, w: g1 + pw + g2, y: GY, h: 300, gaps: [g1, g2] });
        this.obs.push({ type: 'plat', x: x + g1, w: pw, y: py, h: 26 });
        if (r.chance(t.coins + 0.2)) for (let i = 0; i < 4; i++) this.obs.push({ type: 'coin', x: x + g1 + 30 + i * ((pw - 60) / 3), y: py - 40, w: 30, h: 30 });
        end = x + g1 + pw + g2;
        break;
      }
      case 'walker': {
        const vx = r.range(30, 70 + d * 40);
        const eh = this.tallFoes ? 88 : 50;
        this.obs.push({ type: 'walker', x, w: 46, h: eh, y: GY - eh, vx, v: r.int(0, 2) });
        end = x + 46;
        break;
      }
      case 'flyer': {
        const low = r.chance(0.55);
        const vx = r.range(50, 110 + d * 60);
        const y = low ? GY - 58 : GY - this.ph - 96;
        this.obs.push({ type: 'flyer', x, w: 48, h: 40, y, vx, low, ph: r() * 6 });
        end = x + 48;
        break;
      }
      default: {
        const n = 6;
        for (let i = 0; i < n; i++) this.obs.push({ type: 'coin', x: x + i * 44, y: GY - 40, w: 30, h: 30 });
        end = x + n * 44;
      }
    }
    if (!this.p.shield && r.chance(0.04 + d * 0.03)) this.obs.push({ type: 'shield', x: end + gapMin * 0.5, y: GY - 150, w: 40, h: 40 });
    this.nextX = end + gapMin * t.gap * r.range(1.05, 1.7) * (1.1 - d * 0.2);
  }

  // ---------- physics ----------
  overPit(wx) {
    for (const o of this.obs) if (o.type === 'pit' && wx - this.pw * 0.25 > o.x && wx + this.pw * 0.25 < o.x + o.w) return true;
    return false;
  }
  platUnder(wx, prevY, y) {
    for (const o of this.obs) if (o.type === 'plat' && wx + this.pw / 2 > o.x + 4 && wx - this.pw / 2 < o.x + o.w - 4 && prevY <= o.y + 1 && y >= o.y) return o;
    return null;
  }
  onPlat(wx, y) {
    for (const o of this.obs) if (o.type === 'plat' && Math.abs(y - o.y) < 1 && wx + this.pw / 2 > o.x + 4 && wx - this.pw / 2 < o.x + o.w - 4) return true;
    return false;
  }
  jump(double) {
    const p = this.p;
    p.vy = -this.t.jump * (double ? 0.9 : 1);
    p.ground = false;
    p.coyote = 0;
    p.holding = true;
    p.sq = 0.7;
    if (double) p.jumps = 0;
    this.game.sfx(double ? 'djump' : 'jump', { pitch: 0.95 + Math.random() * 0.1 });
    if (!this.game.headless) this.game.burst(PX, p.y, { n: double ? 10 : 6, color: double ? '#fff' : this.game.art?.pal.groundTop, speed: 160, size: 7, life: 0.35, grav: 200, angle: Math.PI / 2, spread: 2.4 });
  }
  update(dt, game) {
    const t = this.t;
    const p = this.p;
    const inp = game.input;
    this.time += dt;
    if (!p.alive) {
      p.vy += t.gravity * dt;
      p.y += p.vy * dt;
      p.spin = (p.spin || 0) + dt * 9;
      return;
    }
    this.speed = Math.min(t.maxSpeed, this.speed + t.accel * dt);
    this.dist += this.speed * dt;
    const wx = this.dist + PX;
    // zones
    const z = Math.floor(this.meters / 500);
    if (z > this.zone) {
      this.zone = z;
      game.sfx('level');
      game.flash('#fff', 0.35);
      game.popText(W / 2, 300, `ZONE ${z + 1}`, { size: 64, color: game.art?.pal.accent || '#ffd166', life: 1.6, vy: -20 });
    }
    // input: buffered jumps, coyote time, variable height, double jump
    if (inp.pressed('action') || inp.pressed('up')) p.buffer = 0.12;
    else p.buffer = Math.max(0, p.buffer - dt);
    const held = inp.held('action') || inp.held('up');
    if (p.buffer > 0) {
      if (p.ground || p.coyote > 0) { this.jump(false); p.buffer = 0; } else if (p.jumps > 0) { this.jump(true); p.buffer = 0; }
    }
    if (p.holding && !held && p.vy < -t.jump * 0.42) { p.vy = -t.jump * 0.42; p.holding = false; }
    if (p.vy >= 0) p.holding = false;
    // move
    const prevY = p.y;
    if (!p.ground) {
      p.vy += t.gravity * dt * (p.vy > 0 ? 1.12 : 1);
      p.y += p.vy * dt;
      const plat = p.vy > 0 ? this.platUnder(wx, prevY, p.y) : null;
      if (plat) this.landOn(plat.y);
      else if (p.y >= GY && prevY <= GY + 2 && !this.overPit(wx)) this.landOn(GY);
    } else if (!this.onPlat(wx, p.y) && (p.y < GY - 1 || this.overPit(wx))) {
      p.ground = false;
      p.coyote = 0.09;
      p.vy = 0;
    }
    p.coyote = Math.max(0, p.coyote - dt);
    p.sq += (1 - p.sq) * Math.min(1, dt * 12);
    p.inv = Math.max(0, p.inv - dt);
    p.land = Math.max(0, p.land - dt);
    if (p.y > GY + 160) return this.die(game, 'fall');
    // the world
    for (const o of this.obs) if (o.vx) o.x -= o.vx * dt;
    const box = { x: wx - this.pw / 2 + 5, y: p.y - this.ph + 6, w: this.pw - 10, h: this.ph - 8 };
    for (const o of this.obs) {
      if (o.dead || o.x > wx + 80 || o.x + o.w < wx - 80) continue;
      if (o.type === 'coin') {
        if (box.x < o.x + o.w / 2 + 16 && box.x + box.w > o.x - o.w / 2 - 6 && box.y < o.y + 18 && box.y + box.h > o.y - 18) {
          o.dead = true; this.coins++; game.sfx('coin', { pitch: 1 + (this.coins % 5) * 0.06 });
          game.burst(o.x - this.dist, o.y, { n: 8, color: ['#ffe066', '#fff'], speed: 200, size: 6, life: 0.4, grav: 0 });
        }
      } else if (o.type === 'shield') {
        if (Math.abs(o.x - wx) < 40 && Math.abs(o.y - (p.y - this.ph / 2)) < 60) { o.dead = true; p.shield = true; game.sfx('power'); game.popText(PX, p.y - 120, 'SHIELD', { color: '#7cf0ff', size: 36 }); }
      } else if (o.type === 'hazard') {
        if (p.inv <= 0 && box.x < o.x + o.w - 6 && box.x + box.w > o.x + 6 && box.y + box.h > o.y + 6) this.hit(game, o);
      } else if (o.type === 'walker' || o.type === 'flyer') {
        if (box.x < o.x + o.w - 4 && box.x + box.w > o.x + 4 && box.y < o.y + o.h - 4 && box.y + box.h > o.y + 6) {
          if (p.vy > 60 && prevY - 4 <= o.y + 18) this.stomp(game, o);
          else if (p.inv <= 0) this.hit(game, o);
        }
      }
    }
    this.obs = this.obs.filter((o) => o.x + o.w > this.dist - 200 && !(o.dead && o.type === 'coin') && !(o.dead && o.type === 'shield') && !(o.gone));
    this.fill();
    // score
    game.score = this.meters + this.coins * 5 + this.stomps * 25;
    if (this.goal && this.dist >= this.goal) game.win();
    // run dust
    if (p.ground && !game.headless) {
      this.dustT -= dt;
      if (this.dustT <= 0) { this.dustT = 0.09; game.burst(PX - 16, p.y - 2, { n: 1, color: 'rgba(255,255,255,0.5)', speed: 60, size: 9, life: 0.35, grav: -60, angle: Math.PI, spread: 0.8 }); }
    }
  }
  landOn(y) {
    const p = this.p;
    if (p.vy > 500) this.game.sfx('land');
    if (p.vy > 300 && !this.game.headless) this.game.burst(PX, y, { n: 6, color: 'rgba(255,255,255,0.6)', speed: 120, size: 8, life: 0.3, grav: 0, angle: -Math.PI / 2, spread: 3 });
    p.y = y;
    p.vy = 0;
    p.ground = true;
    p.jumps = 1;
    p.sq = 1.3;
    p.land = 0.1;
  }
  stomp(game, o) {
    o.dead = true;
    o.fall = { vy: -300, rot: 0 };
    this.p.vy = -this.t.jump * 0.72;
    this.p.ground = false;
    this.p.jumps = 1;
    this.p.holding = true;
    this.stomps++;
    game.sfx('pop');
    game.shake(5);
    game.addScore(0);
    game.popText(o.x - this.dist + o.w / 2, o.y - 30, '+25', { color: game.art?.pal.accent || '#ffd166', size: 34 });
    game.burst(o.x - this.dist + o.w / 2, o.y + o.h / 2, { n: 14, color: [game.art?.pal.enemy || '#f55', '#fff'], speed: 260, size: 8, life: 0.5 });
  }
  hit(game, o) {
    const p = this.p;
    if (p.shield) {
      p.shield = false;
      p.inv = 1;
      o.dead = true;
      if (o.type === 'hazard') o.gone = true;
      game.sfx('explode', { vol: 0.6 });
      game.shake(10);
      game.burst(PX, p.y - this.ph / 2, { n: 24, color: ['#7cf0ff', '#fff'], speed: 380, size: 7, life: 0.6 });
      return;
    }
    this.die(game, o.type);
  }
  die(game) {
    const p = this.p;
    if (!p.alive) return;
    p.alive = false;
    p.vy = -700;
    game.sfx('hit');
    game.sfx('explode', { vol: 0.5 });
    game.shake(18);
    game.flash('#fff', 0.55);
    game.burst(PX, p.y - this.ph / 2, { n: 34, color: [game.art?.pal.player || '#fff', '#fff', game.art?.pal.accent || '#fc0'], speed: 460, size: 9, life: 0.8 });
    game.over();
  }

  // ---------- drawing ----------
  draw(ctx, game) {
    const art = game.art;
    const pal = art.pal;
    const t = this.time;
    game.shaken(ctx);
    art.bg(ctx, { x: this.dist, t, mode: 'scroll', zone: this.zone });
    const ox = -this.dist;
    // ground, cut by pits
    const pits = this.obs.filter((o) => o.type === 'pit' && o.x + ox < W + 20 && o.x + o.w + ox > -20).sort((a, b) => a.x - b.x);
    let gx = -20;
    const imgBg = !!art.images.bg;
    const seg = (a, b) => {
      if (b <= a) return;
      const g = ctx.createLinearGradient(0, GY, 0, H);
      g.addColorStop(0, pal.ground);
      g.addColorStop(1, '#000');
      ctx.globalAlpha = imgBg ? 0.88 : 1;
      ctx.fillStyle = g;
      ctx.fillRect(a, GY, b - a, H - GY);
      ctx.globalAlpha = 1;
      ctx.fillStyle = pal.groundTop;
      ctx.fillRect(a, GY - 2, b - a, 7);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      const step = 64;
      for (let x = a - ((this.dist + a) % step); x < b; x += step) if (x > a - 30) ctx.fillRect(Math.max(a, x), GY + 22, Math.min(30, b - Math.max(a, x)), 6);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      const step2 = 47;
      for (let x = a - ((this.dist * 0.999 + a) % step2); x < b; x += step2) if (x > a) { ctx.fillRect(x, GY + 58, 10, 4); ctx.fillRect(x + 20, GY + 96, 6, 3); }
    };
    for (const p of pits) {
      seg(gx, p.x + ox);
      const g = ctx.createLinearGradient(0, GY, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(1, '#000');
      ctx.fillStyle = g;
      ctx.fillRect(p.x + ox, GY + 5, p.w, H - GY);
      gx = p.x + p.w + ox;
    }
    seg(gx, W + 20);
    for (const o of this.obs) {
      const sx = o.x + ox;
      if (sx > W + 80 || sx + o.w < -80) continue;
      if (o.type === 'plat') {
        ctx.fillStyle = pal.ground;
        ctx.beginPath(); ctx.roundRect(sx, o.y, o.w, o.h, 8); ctx.fill();
        ctx.fillStyle = pal.groundTop;
        ctx.beginPath(); ctx.roundRect(sx, o.y - 2, o.w, 8, 4); ctx.fill();
      } else if (o.type === 'hazard') {
        const shape = art.shapeOf('hazard');
        if (art.image('hazard')) art.draw(ctx, 'hazard', sx + o.w / 2, o.y + o.h / 2, Math.max(o.w, o.h) * 1.05, { sx: o.w / Math.max(o.w, o.h), sy: o.h / Math.max(o.w, o.h) });
        else if (STACKED.has(shape)) {
          const n = Math.max(1, Math.round(o.h / o.w));
          const s = o.h / n;
          for (let i = 0; i < n; i++) art.draw(ctx, 'hazard', sx + o.w / 2, GY - s / 2 - i * s, s * 1.04, { sx: o.w / s });
        } else if (shape === 'saw') art.draw(ctx, 'hazard', sx + o.w / 2, o.y + o.h / 2, Math.max(o.w, o.h) * 1.1, { rot: t * 9 });
        else art.draw(ctx, 'hazard', sx + o.w / 2, o.y + o.h / 2 + 2, o.w * 1.1, { sy: o.h / o.w });
      } else if (o.type === 'coin' && !o.dead) {
        art.draw(ctx, 'item', sx, o.y + Math.sin(t * 4 + o.x * 0.02) * 4, 34, { sx: 0.35 + 0.65 * Math.abs(Math.cos(t * 3 + o.x * 0.01)) });
      } else if (o.type === 'shield' && !o.dead) {
        ctx.save(); ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 6); ctx.strokeStyle = '#7cf0ff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(sx, o.y, 24, 0, 7); ctx.stroke(); ctx.restore();
        art.draw(ctx, 'bolt', sx, o.y, 30);
      } else if (o.type === 'walker' || o.type === 'flyer') {
        const cx = sx + o.w / 2;
        if (o.dead) {
          o.fall.vy += 1600 * DT; o.fallY = (o.fallY || 0) + o.fall.vy * DT; o.fall.rot += 0.25;
          if (o.fallY > 600) o.gone = true;
        }
        const fy = o.dead ? o.fallY : 0;
        if (art.sheet('enemy')) {
          const anims = art.sheet('enemy').anims;
          const v = o.v % Math.max(1, Object.keys(anims).filter((k) => k.startsWith('walk')).length);
          const name = o.dead ? (anims[`hurt${v || ''}`] ? `hurt${v || ''}` : 'hurt') : anims[`walk${v || ''}`] ? `walk${v || ''}` : 'walk';
          art.drawAnim(ctx, 'enemy', name, t + o.x * 0.001, cx, o.y + o.h + fy, 128, { flip: true, fps: 11 });
        } else {
          const bob = o.type === 'flyer' ? Math.sin(t * 8 + o.ph) * 6 : Math.abs(Math.sin(t * 10 + o.x)) * -4;
          art.draw(ctx, 'enemy', cx, o.y + o.h / 2 + bob + fy, o.type === 'flyer' ? 54 : 58, { flip: true, rot: o.dead ? o.fall.rot : o.type === 'flyer' ? Math.sin(t * 8 + o.ph) * 0.12 : 0, sy: o.dead ? 0.6 : 1 });
        }
      }
    }
    // player
    const p = this.p;
    const blink = p.inv > 0 && Math.floor(t * 20) % 2 === 0;
    if (!blink) {
      let drew = false;
      if (this.sheet && art.sheet('player')) {
        let anim = 'run';
        let frame = null;
        const jumpFrames = art.sheet('player').anims.jump?.length || 0;
        if (!p.ground && jumpFrames) { anim = 'jump'; frame = Math.round(clamp((p.vy + this.t.jump) / (2 * this.t.jump), 0, 1) * (jumpFrames - 2)) + 1; }
        if (!p.alive && art.sheet('player').anims.hurt) { anim = 'hurt'; frame = 1; }
        drew = art.drawAnim(ctx, 'player', anim, t, PX, p.y, 150, { fps: 8 + this.speed / 40, frame });
      }
      if (!drew) {
        const size = 66;
        const run = p.ground ? Math.abs(Math.sin(t * (10 + this.speed / 60))) * 5 : 0;
        const sy = p.sq;
        const sx = 2 - p.sq;
        ctx.save();
        ctx.translate(PX, p.y);
        if (!p.alive) ctx.rotate(p.spin || 0);
        else ctx.rotate(p.ground ? 0 : clamp(p.vy / 2400, -0.25, 0.35));
        art.draw(ctx, 'player', 0, -size / 2 * sy - run + 4, size, { sx, sy });
        ctx.restore();
      }
      if (p.shield) {
        ctx.save(); ctx.globalAlpha = 0.45 + 0.2 * Math.sin(t * 10); ctx.strokeStyle = '#7cf0ff'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(PX, p.y - this.ph / 2, this.ph * 0.75, 0, 7); ctx.stroke(); ctx.restore();
      }
    }
    // speed lines
    if (this.speed > 480 && !game.headless) {
      ctx.save(); ctx.globalAlpha = clamp((this.speed - 480) / 300, 0, 0.5); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) { const y = 160 + ((i * 97 + Math.floor(t * 30) * 13) % 520); const x = W - ((t * 1400 + i * 211) % (W + 200)); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 80, y); ctx.stroke(); }
      ctx.restore();
    }
    game.particles.draw(ctx);
  }
  hud(ctx, game) {
    game.drawHud(ctx, { label: `${this.meters} m`, progress: this.goal ? this.dist / this.goal : null, color: '#fff' });
  }
}

// ---------- bot: the latest safe jump, found by simulating ahead ----------
function threatsNear(w, from, to) {
  return w.obs.filter((o) => !o.dead && o.type !== 'coin' && o.type !== 'shield' && o.x < to && o.x + o.w > from);
}
/** Simulate the player for `steps` with a jump after `delay` steps (delay < 0: no jump). True if it survives. */
function safe(w, delay, steps = 80, double = -1) {
  const t = w.t;
  if (delay >= 0) steps = Math.max(steps, delay + 66);
  let y = w.p.y, vy = w.p.vy, ground = w.p.ground, jumps = w.p.jumps, hold = w.p.holding;
  let dist = w.dist, speed = w.speed;
  const near = threatsNear(w, w.dist + PX - 60, w.dist + PX + speed * (steps * DT) + 120);
  let air = !ground;
  let landedAt = -1;
  for (let i = 0; i < steps; i++) {
    if (i === delay && ground) { vy = -t.jump; ground = false; hold = true; }
    if (i === double && !ground && jumps > 0) { vy = -t.jump * 0.9; jumps = 0; hold = true; }
    if (vy >= 0) hold = false;
    speed = Math.min(t.maxSpeed, speed + t.accel * DT);
    dist += speed * DT;
    const wx = dist + PX;
    const prev = y;
    const tt = (i + 1) * DT;
    if (!ground) {
      vy += t.gravity * DT * (vy > 0 ? 1.12 : 1);
      y += vy * DT;
      let landed = false;
      for (const o of near) if (o.type === 'plat' && vy > 0 && wx + w.pw / 2 > o.x + 4 && wx - w.pw / 2 < o.x + o.w - 4 && prev <= o.y + 1 && y >= o.y) { y = o.y; vy = 0; ground = true; jumps = 1; landed = true; }
      if (!landed && y >= GY && prev <= GY + 2) {
        let pit = false;
        for (const o of near) if (o.type === 'pit' && wx - w.pw * 0.25 > o.x && wx + w.pw * 0.25 < o.x + o.w) pit = true;
        if (!pit) { y = GY; vy = 0; ground = true; jumps = 1; }
      }
    } else {
      let support = false;
      for (const o of near) if (o.type === 'plat' && Math.abs(y - o.y) < 1 && wx + w.pw / 2 > o.x + 4 && wx - w.pw / 2 < o.x + o.w - 4) support = true;
      let pit = false;
      for (const o of near) if (o.type === 'pit' && wx - w.pw * 0.25 > o.x && wx + w.pw * 0.25 < o.x + o.w) pit = true;
      if (!support && (y < GY - 1 || pit)) { ground = false; vy = 0; }
    }
    if (y > GY + 40) return false;
    // once a jump has landed cleanly the bot gets to jump again: only the touchdown itself is judged
    if (!ground) air = true;
    else if (air && landedAt < 0) landedAt = i;
    if (landedAt >= 0 && i - landedAt > 8) return true;
    const bx = wx - w.pw / 2 + 5, by = y - w.ph + 6, bw = w.pw - 10, bh = w.ph - 8;
    for (const o of near) {
      const ox = o.vx ? o.x - o.vx * tt : o.x;
      if (o.type === 'hazard') { if (bx < ox + o.w - 2 && bx + bw > ox + 2 && by + bh > o.y + 2) return false; }
      else if (o.type === 'walker' || o.type === 'flyer') {
        if (bx < ox + o.w && bx + bw > ox && by < o.y + o.h && by + bh > o.y) { if (!(vy > 60 && prev - 4 <= o.y + 18)) return false; }
      }
    }
  }
  return true;
}
export function bot(w, game) {
  if (!w.p.alive) { game.input.setBot({}); return; }
  const p = w.p;
  let act = false;
  if (p.ground) {
    // a planned jump: still safe? then wait for its frame
    if (w.plan != null) {
      const d = w.plan - game.frame;
      if (d <= 0) { act = true; w.plan = null; } else if (!safe(w, d)) w.plan = null;
    }
    if (w.plan == null && !act && !safe(w, -1)) {
      // the first window of safe take-off frames; jump in its middle
      let a = -1, b = -1;
      for (let d = 0; d < 80; d++) { if (safe(w, d)) { if (a < 0) a = d; b = d; } else if (a >= 0) break; }
      if (a < 0) act = true;
      else { const at = Math.floor((a + b) / 2); if (at <= 0) act = true; else w.plan = game.frame + at; }
    }
  } else if (p.vy < 0 && p.holding) {
    act = true;
  } else if (p.jumps > 0 && p.vy > -150 && !safe(w, -1, 60) && safe(w, -1, 60, 0)) {
    act = !game.input.botPrev.action;
  }
  game.input.setBot({ action: act });
}

export function create(game) { return new Runner(game); }

// ---------- playtest ----------
/**
 * Lay out three minutes of course exactly as the game does (same seed, same speed curve), note the speed each
 * obstacle is met at, and check it against the jump arc; then let the bot run it for 60 s. { ok, notes }.
 */
export function playtest(recipe, { seconds = 60, course = 180 } = {}) {
  const notes = [];
  const game = new Game({ template: { create, bot }, recipe, headless: true, bot: true });
  game.start();
  const w = game.world;
  const t = w.t;
  const probe = new Runner(Object.assign(Object.create(game), { rand: rng(((recipe.seed >>> 0) + 7919) >>> 0), recipe, art: null, headless: true }));
  const met = [];
  for (let time = 0; time < course; time += DT) {
    probe.speed = Math.min(t.maxSpeed, probe.speed + t.accel * DT);
    probe.dist += probe.speed * DT;
    probe.fill();
    const front = probe.dist + PX;
    for (const o of probe.obs) if (o.vMet == null && o.x <= front) { o.vMet = probe.speed; met.push(o); }
    if (probe.obs.length > 200) probe.obs = probe.obs.filter((o) => o.vMet == null);
  }
  const apex = (t.jump * t.jump) / (2 * t.gravity);
  const air = (2 * t.jump) / t.gravity;
  let bad = 0;
  let checked = 0;
  const fail = (o, why) => { bad++; if (bad <= 4) notes.push(`${o.type} at ${Math.round(o.x / M)} m: ${why}`); };
  for (const o of met) {
    const v = o.vMet;
    if (o.type === 'hazard') {
      checked++;
      if (o.h > apex - 12) fail(o, `${Math.round(o.h)} px is taller than the jump`);
      else if (v * windowAbove(t, o.h + 4) < o.w + w.pw - 6) fail(o, 'too wide for the arc');
    } else if (o.type === 'pit') {
      checked++;
      for (const gap of o.gaps || [o.w]) if (gap + w.pw * 0.5 > v * air) fail(o, 'wider than a jump');
    } else if (o.type === 'plat') {
      checked++;
      if (GY - o.y > apex - 20) fail(o, 'platform out of reach');
    } else if (o.type === 'walker' || o.type === 'flyer') {
      checked++;
      if (o.type === 'walker' || o.low) {
        const top = GY - o.y;
        if ((v + o.vx) * windowAbove(t, top + 4) < o.w + w.pw - 6) fail(o, 'cannot be jumped');
      } else if (o.y + o.h > GY - w.ph - 4) fail(o, 'flies too low to run under');
    }
  }
  game.advance(seconds);
  const survived = game.state === 'play' || game.state === 'win';
  if (!survived) notes.push(`bot fell at ${w.meters} m after ${game.time.toFixed(1)} s`);
  notes.unshift(`${checked} obstacles on ${course / 60} min of course checked against the jump arc at the speed they are met`, `bot ran ${w.meters} m in ${game.time.toFixed(0)} s, ${w.coins} coins, ${w.stomps} stomps`);
  return { ok: bad === 0 && survived, notes, score: game.score, seconds: game.time };
}
