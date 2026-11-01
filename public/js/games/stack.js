/*! Massless Games · stack.js · MIT License · Copyright (c) 2026 Chuck Crawley · https://github.com/ChuckGPTX/massless */
// Tower stacker. A block slides over the tower (along x, then z in 3D); tap to drop it. What hangs over is
// sliced off and falls; a drop within the tolerance is a perfect, and a streak of perfects grows the block
// back. The slide speeds up every floor. 3D renders with three.js 0.180.0; 2D draws the same tower side-on.

import * as THREE from 'three';
import { W, H, DT, clamp, Game } from './engine.js';
import { shade, alpha } from './art.js';

export const meta = { id: 'stack', help: 'Tap, click or press Space to drop the block. Line it up with the one below.' };
export const layered = (recipe) => recipe.dims === '3d';

const RANGE = 1.3; // the slide runs from -RANGE to +RANGE around the tower
const HB = 0.22; // block height in 3D units
const PX2D = 270; // 2D: px per unit
const BH2D = 38; // 2D: block height px

function tuning(recipe) {
  return { speed: 1.15, ramp: 0.022, size: 1, tolerance: 0.035, grow: 0.08, ...recipe.tuning };
}

// ---------- the rules (no drawing) ----------
class Tower {
  constructor(recipe, rand, threeD) {
    this.t = tuning(recipe);
    this.three = threeD;
    this.rand = rand;
    const s = this.t.size;
    this.blocks = [{ x: 0, z: 0, w: s, d: s, level: 0 }];
    this.debris = [];
    this.combo = 0;
    this.perfects = 0;
    this.level = 0;
    this.dead = false;
    this.next();
  }
  get top() { return this.blocks[this.blocks.length - 1]; }
  speedAt(level) { return Math.min(4.2, this.t.speed * (1 + this.t.ramp) ** level); }
  next() {
    const top = this.top;
    const level = top.level + 1;
    const axis = this.three ? (level % 2 ? 'x' : 'z') : 'x';
    const from = this.three ? -1 : level % 2 ? -1 : 1;
    this.cur = { x: top.x, z: top.z, w: top.w, d: top.d, level, axis, dir: -from, pos: from * RANGE };
    this.cur[axis] = (axis === 'x' ? top.x : top.z) + this.cur.pos;
  }
  step(dt) {
    const c = this.cur;
    if (!c || this.dead) return;
    const v = this.speedAt(c.level);
    c.pos += c.dir * v * dt;
    if (c.pos > RANGE) { c.pos = RANGE; c.dir = -1; }
    if (c.pos < -RANGE) { c.pos = -RANGE; c.dir = 1; }
    const top = this.top;
    c[c.axis] = (c.axis === 'x' ? top.x : top.z) + c.pos;
  }
  /** Drop the moving block. Returns { kind: 'perfect' | 'cut' | 'miss', cut, block }. */
  drop() {
    const c = this.cur;
    const top = this.top;
    const ax = c.axis;
    const size = ax === 'x' ? 'w' : 'd';
    const delta = c[ax] - top[ax];
    const tol = this.t.tolerance * this.t.size;
    if (Math.abs(delta) <= tol) {
      c[ax] = top[ax];
      this.combo++;
      this.perfects++;
      if (this.combo >= 3 && this.t.grow > 0) {
        const grow = Math.min(this.t.grow * this.t.size, this.t.size - c[size]);
        if (grow > 0) c[size] += grow;
      }
      const b = { x: c.x, z: c.z, w: c.w, d: c.d, level: c.level };
      this.blocks.push(b);
      this.level = c.level;
      this.next();
      return { kind: 'perfect', block: b, combo: this.combo };
    }
    this.combo = 0;
    const overlap = c[size] - Math.abs(delta);
    if (overlap <= 0) {
      this.dead = true;
      const piece = { x: c.x, z: c.z, w: c.w, d: c.d, level: c.level };
      this.debris.push(piece);
      this.cur = null;
      return { kind: 'miss', cut: piece };
    }
    const keepC = (c[ax] + top[ax]) / 2;
    const cutW = Math.abs(delta);
    const cutC = keepC + Math.sign(delta) * (overlap / 2 + cutW / 2);
    const b = { x: c.x, z: c.z, w: c.w, d: c.d, level: c.level };
    b[ax] = keepC;
    b[size] = overlap;
    const piece = { ...b };
    piece[ax] = cutC;
    piece[size] = cutW;
    this.blocks.push(b);
    this.debris.push(piece);
    this.level = c.level;
    this.next();
    return { kind: 'cut', block: b, cut: piece, dir: Math.sign(delta) };
  }
}

// ---------- the world ----------
class Stack {
  constructor(game) {
    this.game = game;
    this.recipe = game.recipe;
    this.three = game.recipe.dims === '3d';
    this.tower = new Tower(game.recipe, game.rand, this.three);
    this.time = 0;
    this.camY = 0;
    this.goal = game.recipe.goal || 0;
    this.botAim = 0;
    this.botAimFor = -1;
    this.flashes = [];
    if (!game.headless && game.art) {
      const pal = game.art.pal;
      // the tower walks round the colour wheel from the palette's own colour, a few degrees a floor
      const [h0, s0, l0] = hsl(pal.player === '#f4f4f1' ? pal.accent : pal.player);
      const sat = Math.max(0.55, Math.min(0.8, s0));
      const light = Math.max(0.52, Math.min(0.66, l0));
      this.colors = (level) => hex((h0 + level * 7) % 360, sat, light);
      if (this.three) this.setup3d();
    }
  }

  setup3d() {
    const g = this.game;
    let gl = g._stackGl;
    if (!gl || !gl.canvas.isConnected) {
      // the sky is drawn into a texture behind the tower (refreshed now and then), so only two layers composite
      const bg = document.createElement('canvas');
      bg.width = W / 2;
      bg.height = H / 2;
      const canvas = document.createElement('canvas');
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, alpha: false, powerPreference: 'high-performance' });
      g.frameEl?.insertBefore(canvas, g.canvas);
      const tex = new THREE.CanvasTexture(bg);
      tex.colorSpace = THREE.SRGBColorSpace;
      gl = g._stackGl = { renderer, canvas, bg, tex };
    }
    this.gl = gl;
    this.skyFor = -1;
    const scene = new THREE.Scene();
    scene.background = gl.tex;
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(-4, 9, 6);
    scene.add(sun);
    this.scene = scene;
    this.cam = cam;
    this.meshes = [];
    this.debrisMeshes = [];
    this.mats = new Map();
    this.box = new THREE.BoxGeometry(1, 1, 1);
    // a little pedestal under the first block
    const base = new THREE.Mesh(new THREE.BoxGeometry(this.tower.t.size, 6, this.tower.t.size), new THREE.MeshLambertMaterial({ color: shade(this.game.art.pal.near, 0.1) }));
    base.position.y = -3 - HB / 2;
    scene.add(base);
    this.base = base;
    for (const b of this.tower.blocks) this.addMesh(b);
    this.curMesh = new THREE.Mesh(this.box, this.mat(1));
    scene.add(this.curMesh);
    this.resize();
  }
  mat(level) {
    const c = this.colors(level);
    let m = this.mats.get(c);
    if (!m) { m = new THREE.MeshLambertMaterial({ color: c }); this.mats.set(c, m); }
    return m;
  }
  addMesh(b) {
    const m = new THREE.Mesh(this.box, this.mat(b.level));
    m.scale.set(b.w, HB, b.d);
    m.position.set(b.x, b.level * HB, b.z);
    this.scene.add(m);
    this.meshes.push(m);
    if (this.meshes.length > 70) { const old = this.meshes.shift(); this.scene.remove(old); }
    return m;
  }
  resize() {
    if (!this.gl) return;
    const c = this.game.canvas;
    const w = c.clientWidth || W;
    const h = c.clientHeight || H;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.gl.renderer.setPixelRatio(dpr);
    this.gl.renderer.setSize(w, h, false);
    Object.assign(this.gl.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
    const viewH = 6.4;
    const aspect = W / H;
    Object.assign(this.cam, { left: (-viewH * aspect) / 2, right: (viewH * aspect) / 2, top: viewH / 2, bottom: -viewH / 2 });
    this.cam.updateProjectionMatrix();
  }

  // ---------- rules ----------
  update(dt, game) {
    this.time += dt;
    const tw = this.tower;
    if (!tw.dead) {
      if (game.input.pressed('action') || game.input.pressed('up') || game.input.pressed('down')) this.drop(game);
      else tw.step(dt);
    }
    for (const p of tw.debris) {
      p.vy = (p.vy || 0) - 9 * dt;
      p.y = (p.y ?? p.level * HB) + p.vy * dt;
      p.rot = (p.rot || 0) + (p.spin || 0) * dt;
      p.off = (p.off || 0) + (p.push || 0) * dt;
    }
    tw.debris = tw.debris.filter((p) => p.y > (tw.level - 30) * HB);
    const target = tw.level * HB;
    this.camY += (target - this.camY) * Math.min(1, dt * 4);
    this.flashes = this.flashes.filter((f) => (f.t += dt) < 0.6);
  }
  drop(game) {
    const tw = this.tower;
    const r = tw.drop();
    const pos = this.screenOf(r.block || r.cut);
    if (r.kind === 'perfect') {
      game.addScore(1);
      game.sfx('perfect', { pitch: 1 + Math.min(12, r.combo - 1) * 0.06 });
      game.popText(pos.x, pos.y - 60, r.combo > 1 ? `PERFECT ×${r.combo}` : 'PERFECT', { color: '#fff', size: 34 });
      game.burst(pos.x, pos.y, { n: 16, color: ['#fff', game.art?.pal.accent || '#fc0'], speed: 300, size: 7, life: 0.6, grav: 300 });
      this.flashes.push({ b: r.block, t: 0 });
      if (r.combo >= 3) game.shake(3);
    } else if (r.kind === 'cut') {
      game.addScore(1);
      game.sfx('place', { pitch: 0.9 + Math.random() * 0.15 });
      game.sfx('slice');
      game.shake(2);
      r.cut.vy = 0.6;
      r.cut.spin = (r.dir || 1) * (2 + Math.random() * 2);
      r.cut.push = (r.dir || 1) * 0.6;
      r.cut.axis = r.block ? (r.block.level % 2 || !this.three ? 'x' : 'z') : 'x';
    } else {
      r.cut.vy = 0;
      r.cut.spin = 1.5;
      r.cut.axis = 'x';
      game.sfx('hit');
      game.shake(12);
      game.flash('#fff', 0.35);
      game.over();
      return;
    }
    if (this.three && this.scene) {
      this.addMesh(r.block);
      if (r.cut) {
        const m = new THREE.Mesh(this.box, this.mat(r.cut.level));
        m.scale.set(r.cut.w, HB, r.cut.d);
        this.scene.add(m);
        r.cut.mesh = m;
      }
      this.curMesh.material = this.mat(tw.cur.level);
    }
    if (this.goal && tw.level >= this.goal) game.win();
  }
  screenOf(b) {
    if (!b) return { x: W / 2, y: H / 2 };
    if (this.three && this.cam) {
      const v = new THREE.Vector3(b.x, b.level * HB + HB / 2, b.z).project(this.cam);
      return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H };
    }
    return { x: W / 2 + b.x * PX2D, y: this.y2d(b.level) };
  }
  y2d(level) { return H * 0.52 - (level - this.camY / HB) * BH2D; }

  // ---------- drawing ----------
  sky(ctx, game, ambient = true) {
    const art = game.art;
    art.bg(ctx, { t: this.time, ambient });
    const k = Math.min(0.75, this.tower.level / 70);
    if (k > 0) { ctx.fillStyle = alpha(art.pal.sky[0], k); ctx.fillRect(0, 0, W, H); }
  }
  draw(ctx, game) {
    if (this.three) this.draw3d(ctx, game);
    else this.draw2d(ctx, game);
  }
  draw3d(ctx, game) {
    if (!this.gl) return;
    const tw = this.tower;
    // the sky texture: redrawn when the tower grows (its tint follows the height) and every few seconds
    const key = `${tw.level}|${Math.floor(this.time / 3)}`;
    if (key !== this.skyFor) {
      this.skyFor = key;
      const bctx = this.gl.bg.getContext('2d');
      const s = this.gl.bg.width / W;
      bctx.setTransform(s, 0, 0, s, 0, 0);
      this.sky(bctx, game, false);
      this.gl.tex.needsUpdate = true;
    }
    const c = tw.cur;
    if (c) {
      this.curMesh.visible = true;
      this.curMesh.scale.set(c.w, HB, c.d);
      this.curMesh.position.set(c.x, c.level * HB, c.z);
    } else this.curMesh.visible = false;
    for (const p of tw.debris) {
      if (!p.mesh) { p.mesh = new THREE.Mesh(this.box, this.mat(p.level)); p.mesh.scale.set(p.w, HB, p.d); this.scene.add(p.mesh); this.debrisMeshes.push(p.mesh); }
      p.mesh.position.set(p.x + (p.axis === 'x' ? p.off || 0 : 0), p.y, p.z + (p.axis === 'z' ? p.off || 0 : 0));
      if (p.axis === 'x') p.mesh.rotation.z = -(p.rot || 0); else p.mesh.rotation.x = p.rot || 0;
    }
    const live = new Set(tw.debris.map((p) => p.mesh));
    this.debrisMeshes = this.debrisMeshes.filter((m) => { if (!live.has(m)) { this.scene.remove(m); return false; } return true; });
    // perfect flash: a bright frame around the placed block
    for (const f of this.flashes) {
      if (!f.mesh) {
        f.mesh = new THREE.Mesh(this.box, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
        this.scene.add(f.mesh);
      }
      const k = f.t / 0.6;
      f.mesh.material.opacity = 0.55 * (1 - k);
      f.mesh.scale.set(f.b.w + 0.12 + k * 0.5, 0.02, f.b.d + 0.12 + k * 0.5);
      f.mesh.position.set(f.b.x, f.b.level * HB - HB / 2 + 0.005, f.b.z);
      if (k >= 0.98) this.scene.remove(f.mesh);
    }
    const sx = game.cam.sx * 0.006;
    const sy = game.cam.sy * 0.006;
    const y = this.camY + 0.6;
    this.cam.position.set(6 + sx, y + 6 + sy, 6 - sx);
    this.cam.lookAt(sx * 0.2, y, -sx * 0.2);
    this.gl.renderer.render(this.scene, this.cam);
    game.shaken(ctx);
    game.art.ambient(ctx, this.time);
    game.particles.draw(ctx);
  }
  draw2d(ctx, game) {
    game.shaken(ctx);
    this.sky(ctx, game);
    const tw = this.tower;
    const depth = 16;
    const block = (b, x0, y0, rot = 0) => {
      const w = b.w * PX2D;
      const col = this.colors(b.level);
      ctx.save();
      ctx.translate(x0, y0);
      if (rot) ctx.rotate(rot);
      ctx.fillStyle = shade(col, 0.28);
      ctx.beginPath(); ctx.moveTo(-w / 2, -BH2D / 2); ctx.lineTo(-w / 2 + depth, -BH2D / 2 - depth * 0.6); ctx.lineTo(w / 2 + depth, -BH2D / 2 - depth * 0.6); ctx.lineTo(w / 2, -BH2D / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(col, -0.28);
      ctx.beginPath(); ctx.moveTo(w / 2, -BH2D / 2); ctx.lineTo(w / 2 + depth, -BH2D / 2 - depth * 0.6); ctx.lineTo(w / 2 + depth, BH2D / 2 - depth * 0.6); ctx.lineTo(w / 2, BH2D / 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col;
      ctx.fillRect(-w / 2, -BH2D / 2, w, BH2D);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(-w / 2, -BH2D / 2, w, 5);
      ctx.restore();
    };
    const lo = Math.max(0, tw.blocks.length - 30);
    const baseY = this.y2d(0) + BH2D / 2;
    if (baseY < H) { ctx.fillStyle = shade(game.art.pal.near, 0.05); ctx.fillRect(W / 2 - (tw.t.size * PX2D) / 2, baseY, tw.t.size * PX2D, H - baseY); }
    for (let i = lo; i < tw.blocks.length; i++) { const b = tw.blocks[i]; block(b, W / 2 + b.x * PX2D, this.y2d(b.level)); }
    for (const p of tw.debris) block(p, W / 2 + (p.x + (p.off || 0)) * PX2D, this.y2d(0) - p.y / HB * BH2D, p.rot || 0);
    if (tw.cur) block(tw.cur, W / 2 + tw.cur.x * PX2D, this.y2d(tw.cur.level));
    for (const f of this.flashes) {
      const k = f.t / 0.6;
      const w = f.b.w * PX2D + 10 + k * 50;
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
      ctx.lineWidth = 4;
      ctx.strokeRect(W / 2 + f.b.x * PX2D - w / 2, this.y2d(f.b.level) - BH2D / 2 - k * 10, w, BH2D + k * 20);
    }
    game.particles.draw(ctx);
  }
  hud(ctx, game) {
    game.drawHud(ctx, { label: this.tower.combo >= 2 ? `Streak ${this.tower.combo}` : '', progress: this.goal ? this.tower.level / this.goal : null });
  }
  destroy() {
    if (!this.scene) return;
    this.scene.traverse((o) => { if (o.material && o.material !== this.curMesh?.material) o.material.dispose?.(); });
    this.box?.dispose();
    this.base?.geometry.dispose();
  }
}

function hex(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function hsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function create(game) { return new Stack(game); }
export function dispose(game) {
  const gl = game._stackGl;
  if (!gl) return;
  gl.tex.dispose();
  gl.renderer.dispose();
  gl.renderer.forceContextLoss?.();
  gl.canvas.remove();
  game._stackGl = null;
}

// ---------- bot ----------
/** Drops at the step where the block is closest to its aim. perfect: aim dead centre. Otherwise a small human error. */
export function bot(w, game, perfect = game.botPerfect) {
  const tw = w.tower;
  const c = tw.cur;
  if (!c || tw.dead) { game.input.setBot({}); return; }
  if (w.botAimFor !== c.level) {
    w.botAimFor = c.level;
    const tol = tw.t.tolerance * tw.t.size;
    w.botAim = perfect ? 0 : (game.rand() < 0.55 ? 0 : (game.rand() * 2 - 1) * tol * 2.6);
    w.botWait = perfect ? 0 : 0.35 + game.rand() * 0.5;
  }
  w.botWait -= DT;
  const top = tw.top;
  const ax = c.axis;
  const now = c[ax] - top[ax] - w.botAim;
  const v = tw.speedAt(c.level) * DT;
  let nextPos = c.pos + c.dir * v;
  let nextDir = c.dir;
  if (nextPos > RANGE) { nextPos = RANGE; nextDir = -1; }
  if (nextPos < -RANGE) { nextPos = -RANGE; nextDir = 1; }
  const after = nextPos - w.botAim;
  const drop = w.botWait <= 0 && Math.abs(now) <= Math.abs(after) && Math.abs(now) < c[ax === 'x' ? 'w' : 'd'] * 0.5;
  game.input.setBot({ action: drop && !game.input.botPrev.action });
}

// ---------- playtest ----------
/** A perfect-play bot must reach floor 30 (or the goal) on this recipe, every floor dropped at its best step. */
export function playtest(recipe, { floors = 30 } = {}) {
  const game = new Game({ template: { create, bot: (w, g) => bot(w, g, true) }, recipe, headless: true, bot: true });
  game.start();
  const need = recipe.goal ? Math.min(floors, recipe.goal) : floors;
  let steps = 0;
  while (game.state === 'play' && game.world.tower.level < need && steps < 60 * 600) { game.step(); steps++; }
  const tw = game.world.tower;
  const step = tw.speedAt(30) * DT;
  const notes = [`perfect bot reached floor ${tw.level} with ${tw.perfects} perfects`, `slide step at floor 30: ${step.toFixed(3)} of tolerance ${(tw.t.tolerance * 2).toFixed(3)}`];
  return { ok: tw.level >= need, notes, score: tw.level };
}
