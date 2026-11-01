/*! Chucksi Games · aiart.js · MIT License · Copyright (c) 2026 Chuck Crawley · https://github.com/ChuckGPTX/massless */
// Optional AI art for a game: at most a background plus up to three sprites, made by the Image page's free
// engine (FLUX.1 schnell on Cloudflare's daily allowance through /api/shot, Pollinations as the backup).
// Sprites are asked for on a flat chroma background and keyed out in the browser. Everything is cached in
// IndexedDB, so a replay never paints twice.

import { shoot } from '../engines.js';
import * as store from '../store.js';
import { keyImage, loadImage } from './art.js';
import { hash } from './engine.js';

const ROLE_SIZE = { player: [512, 512], enemy: [512, 512], item: [512, 512], bg: [540, 960] };

/** Which flat colour to paint a sprite on: green, unless the subject itself is green. */
export function keyColour(desc) {
  return /\b(green|lime|frog|slime|leaf|plant|cactus|alien|emerald|grass)\b/i.test(desc) ? 'magenta' : 'green';
}
export function artPrompt(recipe, role) {
  const scene = recipe.world?.desc || recipe.world?.scene || '';
  if (role === 'bg') return `${scene}, video game background art, ${recipe.theme}, wide empty scene, no characters, no text, vibrant, clean shapes, mobile game`.slice(0, 480);
  const who = recipe[role] || {};
  const desc = `${who.desc || who.name || role}`;
  const bg = keyColour(desc) === 'magenta' ? 'solid flat magenta #ff00ff background' : 'solid flat chroma green #00b140 background';
  const what = role === 'item' ? 'single game item icon' : 'single cute game character, full body, facing right';
  return `${desc}, ${what}, centered, bold clean outline, cel shaded, 2D mobile game sprite, ${bg}, nothing else, no shadow, no text`.slice(0, 480);
}

/** Keep at most `keep` cache entries of a kind (newest first). Saved work is never touched. */
export async function prune(kind, keep) {
  const items = (await store.all()).filter((x) => x.kind === kind).sort((a, b) => b.created - a.created);
  await Promise.all(items.slice(keep).map((x) => store.del(x.id)));
}

async function toBlob(canvas, type = 'image/png') {
  return new Promise((r) => canvas.toBlob(r, type, 0.9));
}
async function fromBlob(blob) {
  const img = await loadImage(URL.createObjectURL(blob));
  return img;
}

/**
 * Paint art for a recipe. roles: subset of ['player', 'bg', 'enemy', 'item'] (painted in that order).
 * onProgress(i, n, role, note). If the free cloud allowance is used up and the slow Pollinations backup takes
 * over, only the player is painted and the rest stays procedural. Returns { images, notes, painted, cached }.
 */
export async function paintArt(recipe, { roles = ['player', 'bg', 'enemy', 'item'], onProgress, signal, shootFn = shoot } = {}) {
  const images = {};
  const notes = [];
  let slow = false;
  let painted = 0;
  let cached = 0;
  for (const [i, role] of roles.entries()) {
    if (signal?.aborted) break;
    const prompt = artPrompt(recipe, role);
    const [w, h] = ROLE_SIZE[role];
    const seed = (recipe.seed + i * 97) % 2147483647;
    const id = `game-art:${hash(`${role}|${prompt}|${seed}`)}`;
    const hit = await store.get(id).catch(() => null);
    if (hit?.image) {
      images[role] = await fromBlob(hit.image);
      cached++;
      continue;
    }
    if (slow && role !== 'player') { notes.push(`${role}: drawn in code (the free cloud is busy)`); continue; }
    onProgress?.(i, roles.length, role);
    try {
      const res = await shootFn({ prompt, w, h, seed, engine: 'auto', signal, onFallback: () => { slow = true; } });
      let canvas = res.image;
      if (role !== 'bg') {
        const k = keyImage(canvas, { tolerance: 70, maxSize: 512 });
        if (!k.keyed || k.empty) { notes.push(`${role}: background could not be removed, drawn in code instead`); continue; }
        canvas = k.canvas;
      }
      images[role] = canvas;
      painted++;
      const blob = await toBlob(canvas, role === 'bg' ? 'image/jpeg' : 'image/png');
      // stored under `image`, not `blob`, so these working files stay out of My library
      if (blob) store.put({ id, kind: 'game-art', created: Date.now(), role, image: blob }).then(() => prune('game-art', 40)).catch(() => {});
    } catch (e) {
      if (signal?.aborted) break;
      notes.push(`${role}: ${e.message}`);
      if (/45 seconds|Pollinations/i.test(e.message)) slow = true;
    }
  }
  return { images, notes, painted, cached };
}

/** An uploaded file as an image; sprites have a flat background keyed out. Returns { image, keyed }. */
export async function readUpload(file, role) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (role === 'bg') {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return { image: c, keyed: false };
    }
    const k = keyImage(img, { tolerance: 56, maxSize: 512 });
    return { image: k.keyed && !k.empty ? k.canvas : k.canvas, keyed: k.keyed && !k.empty, clear: !!k.alreadyClear };
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
