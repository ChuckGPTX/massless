/*! Massless Games · index.js · MIT License · Copyright (c) 2026 Chuck Crawley · https://github.com/ChuckGPTX/massless */
// The six genre templates, loaded on demand. Stack pulls in three.js (through the page's import map).

export const TEMPLATES = {
  runner: () => import('./runner.js'),
  stack: () => import('./stack.js'),
  shooter: () => import('./shooter.js'),
  match: () => import('./match.js'),
  maze: () => import('./maze.js'),
  eatgrow: () => import('./eatgrow.js'),
};

const cache = new Map();
/** The template module for a genre: { create, bot, playtest, meta, layered?, pointerAction?, dispose? }. */
export function loadTemplate(genre) {
  if (!TEMPLATES[genre]) return Promise.reject(new Error(`No template for ${genre}`));
  if (!cache.has(genre)) cache.set(genre, TEMPLATES[genre]().catch((e) => { cache.delete(genre); throw e; }));
  return cache.get(genre);
}

/** Playtest, re-seeding until it passes (at most `tries` seeds). Returns { recipe, ok, notes, tries }. */
export async function playtested(recipe, { tries = 12 } = {}) {
  const tpl = await loadTemplate(recipe.genre);
  let r = recipe;
  let res = null;
  for (let i = 0; i < tries; i++) {
    res = tpl.playtest(r);
    if (res.ok) return { recipe: r, ok: true, notes: res.notes, tries: i + 1 };
    r = { ...r, seed: (Math.imul(r.seed ^ 0x9e3779b9, 2654435761) >>> 1) % 2147483647 };
  }
  return { recipe, ok: false, notes: res?.notes || [], tries };
}
