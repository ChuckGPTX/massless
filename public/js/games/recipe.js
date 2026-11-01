/*! Chucksi Games · recipe.js · MIT License · Copyright (c) 2026 Chuck Crawley · https://github.com/ChuckGPTX/massless */
// A game is a small JSON recipe: genre, look, names, tuning, level seed, music. templateRecipe() writes a good
// one from a prompt with no model; sanitizeRecipe() makes anything a model (or a link) sends safe to play;
// GAME_RULES is the system prompt the Worker gives Llama 3.3 70B to write one.

import { PALETTES, CHARACTERS, ITEMS, HAZARDS, SCENES } from './art.js';
import { hash, rng } from './engine.js';

export const GENRES = {
  runner: { name: 'Runner', plural: 'Runners', dims: ['2d'], goal: [0, 5000, 2000], goalUnit: 'm' },
  stack: { name: 'Stack', plural: 'Stackers', dims: ['3d', '2d'], goal: [0, 200, 50], goalUnit: 'floors' },
  shooter: { name: 'Shooter', plural: 'Shooters', dims: ['2d'], goal: [0, 40, 12], goalUnit: 'waves' },
  match: { name: 'Match 3', plural: 'Puzzles', dims: ['2d'], goal: [0, 30, 8], goalUnit: 'levels' },
  maze: { name: 'Maze', plural: 'Maze', dims: ['2d'], goal: [0, 20, 8], goalUnit: 'levels' },
  eatgrow: { name: 'Eat & Grow', plural: 'Eat & Grow', dims: ['2d'], goal: [0, 400, 240], goalUnit: 'size' },
};
export const GENRE_IDS = Object.keys(GENRES);
export const MUSIC_STYLES = ['phonk', 'drive', 'trailer', 'trap', 'house'];

/** Tuning per genre: [min, max, default]. Every number a recipe carries is clamped to these. */
export const TUNING = {
  runner: { speed: [240, 520, 330], accel: [0, 10, 3], maxSpeed: [380, 900, 660], gravity: [1800, 3600, 2600], jump: [760, 1250, 980], gap: [0.8, 1.6, 1], coins: [0, 1, 0.6], pits: [0, 1, 0.4], flyers: [0, 1, 0.35], walkers: [0, 1, 0.35] },
  stack: { speed: [0.6, 2.4, 1.15], ramp: [0, 0.06, 0.022], size: [0.6, 1.2, 1], tolerance: [0.015, 0.08, 0.035], grow: [0, 0.2, 0.08] },
  shooter: { enemySpeed: [0.6, 1.8, 1], fireRate: [4, 14, 8], enemyFire: [0, 2, 1], waveSize: [4, 14, 7], ramp: [0.05, 0.3, 0.14], lives: [1, 5, 3] },
  match: { kinds: [4, 6, 5], moves: [10, 40, 22], target: [400, 4000, 1200], ramp: [0.1, 0.6, 0.3] },
  maze: { size: [5, 11, 7], grow: [0, 4, 2], keys: [1, 4, 1], enemies: [0, 4, 0], speed: [3, 9, 6], time: [30, 180, 75] },
  eatgrow: { creatures: [20, 90, 48], growth: [0.2, 1, 0.5], speed: [160, 420, 260], aggression: [0, 1.5, 0.7] },
};
const INT_KEYS = new Set(['match.kinds', 'match.moves', 'match.target', 'maze.size', 'maze.grow', 'maze.keys', 'maze.enemies', 'maze.time', 'eatgrow.creatures', 'shooter.waveSize', 'shooter.lives']);

export function defaultTuning(genre) {
  const t = {};
  for (const [k, [, , d]] of Object.entries(TUNING[genre] || {})) t[k] = d;
  return t;
}

/** The recipe schema, for docs, tests and the Worker. */
export const SCHEMA = {
  v: 1,
  title: 'string, 2-40 chars',
  genre: GENRE_IDS,
  dims: ['2d', '3d'],
  theme: 'string, one sentence, <= 160 chars',
  palette: Object.keys(PALETTES),
  seed: 'integer 0..2147483647 (levels and obstacle layouts)',
  player: { name: 'string <= 20', desc: 'string <= 100', shape: [...CHARACTERS, ...ITEMS] },
  enemy: { name: 'string <= 20', desc: 'string <= 100', shape: [...CHARACTERS, ...ITEMS] },
  item: { name: 'string <= 20', desc: 'string <= 100', shape: [...ITEMS, ...CHARACTERS] },
  hazard: { name: 'string <= 20', desc: 'string <= 100', shape: HAZARDS },
  world: { desc: 'string <= 100', scene: SCENES },
  art: { mode: ['procedural', 'images'], player: 'image URL or sprite sheet', enemy: 'image URL or sprite sheet', item: 'image URL', hazard: 'image URL', bg: 'image URL or list of up to 6' },
  tuning: TUNING,
  goal: Object.fromEntries(GENRE_IDS.map((g) => [g, GENRES[g].goal])),
  text: { start: 'string <= 70', win: 'string <= 70', lose: 'string <= 70' },
  music: { style: MUSIC_STYLES, bpm: [80, 170] },
};

// ---------- reading a prompt ----------
const WORDS = (re) => new RegExp(`\\b(?:${re})\\b`, 'i');
const CHAR_WORDS = [
  ['jelly', 'jelly ?fish(?:es)?|jellies|squids?|octop(?:us|i|uses)'],
  ['sub', 'submarines?|subs?'],
  ['cat', 'cats?|kitt(?:y|ies|ens?)|kitties|lions?|tigers?|dogs?|pupp(?:y|ies)|pups?|bunn(?:y|ies)|rabbits?|bears?|pandas?|monkeys?'],
  ['fox', 'fox(?:es)?|wolf|wolves|raccoons?'],
  ['mouse', 'mouse|mice|rats?|hamsters?|gerbils?'],
  ['robot', 'robots?|bots?|droids?|androids?|mechs?|cyborgs?'],
  ['ship', 'ships?|spaceships?|starships?|rockets?|jets?|planes?|fighters?|starfighters?'],
  ['ufo', 'ufos?|saucers?'],
  ['bug', 'bugs?|beetles?|insects?|bees?|wasps?|hornets?|aliens?|invaders?|spiders?|ants?'],
  ['fish', 'fish(?:es)?|sharks?|whales?|goldfish|piranhas?|dolphins?|turtles?'],
  ['bird', 'birds?|chickens?|ducks?|owls?|penguins?|parrots?|chicks?|crows?|eagles?|dragons?'],
  ['ghost', 'ghosts?|spirits?|phantoms?|spooks?|zombies?|skeletons?|vampires?'],
  ['knight', 'knights?|warriors?|soldiers?|heroes?|samurai|ninjas?|wizards?|princess(?:es)?|kings?|guards?'],
  ['car', 'cars?|racers?|taxis?|vans?|buses?'],
  ['rover', 'rovers?|tanks?|trucks?|buggies|buggy|tractors?'],
  ['egg', 'eggs?|egg-shaped'],
  ['crystal', 'crystals?|golems?'],
  ['blob', 'slimes?|blobs?|goo|amoebas?|cells?|bubbles?|frogs?|snails?'],
];
const ITEM_WORDS = [
  ['coin', 'coins?|gold|money|cash|treasure'], ['gem', 'gems?|jewels?|diamonds?|rubies|ruby|emeralds?'], ['star', 'stars?|stardust'],
  ['heart', 'hearts?|love'], ['key', 'keys?'], ['fruit', 'apples?|fruits?|berr(?:y|ies)|cherr(?:y|ies)|oranges?|bananas?|food|snacks?|pizza'],
  ['cheese', 'cheese'], ['bolt', 'batter(?:y|ies)|energy|lightning|power'], ['seed', 'seeds?|plants?|sprouts?|flowers?|seedlings?|leaves|leaf'],
  ['donut', 'donuts?|doughnuts?|candy|candies|sweets?|cakes?|cookies?|cupcakes?|pancakes?'], ['gear', 'gears?|cogs?|parts?|bolts?|scrap'], ['orb', 'orbs?|souls?|sparks?|pearls?'],
];
const HAZARD_WORDS = [
  ['rock', 'rocks?|boulders?|asteroids?|meteors?|stones?'], ['cactus', 'cacti|cactus(?:es)?'], ['saw', 'saws?|blades?|buzzsaws?'],
  ['mine', 'mines?|bombs?'], ['cone', 'cones?|traffic|roadworks?'], ['crate', 'crates?|boxes|barrels?'], ['barrier', 'barriers?|fences?|hurdles?|walls?'], ['spike', 'spikes?|thorns?|spiky'],
];
const SCENE_WORDS = [
  ['moon', 'moon|lunar|crater'], ['space', 'space|galaxy|galaxies|planets?|orbit|cosmic|asteroids?|stars?|nebula|alien'],
  ['ocean', 'ocean|sea|underwater|reef|deep|fish|shark|beach|coral|lagoon'], ['snow', 'snow|ice|icy|winter|frozen|arctic|polar|penguins?|ski'],
  ['desert', 'desert|dunes?|sand|cactus|cacti|mars|canyon|wild west|cowboy'], ['candy', 'candy|sweets?|cake|sugar|dessert|donuts?|cookie|pastel'],
  ['cave', 'caves?|dungeon|mines?|underground|cavern|crypt|tomb|pyramid'], ['grid', 'synth|retro|80s|arcade|cyber|neon grid|tron|vapor'],
  ['city', 'city|street|town|rooftops?|downtown|urban|neon|traffic|subway|skyline'], ['forest', 'forest|woods|jungle|trees|camp|garden'],
  ['hills', 'hills?|farm|meadow|countryside|valley|field|park'],
];
const SCENE_PALETTE = { city: 'neon', grid: 'neon', space: 'neon', moon: 'moon', ocean: 'ocean', snow: 'arctic', desert: 'ember', candy: 'candy', cave: 'amber', forest: 'forest', hills: 'sunset' };
const MOOD_PALETTE = [
  ['mono', 'noir|black and white|minimal|monochrome'], ['ember', 'fire|lava|volcano|hell|mars|inferno|dragon'], ['arctic', 'ice|snow|winter|frozen'],
  ['candy', 'pastel|cute|sweet|kawaii|pink'], ['neon', 'neon|cyber|synth|retro|80s|arcade'], ['sunset', 'sunset|dusk|evening|golden'],
  ['moon', 'night|midnight|spooky|haunted|dark'], ['amber', 'amber|honey|gold(?:en)?'], ['ocean', 'ocean|sea|water'], ['forest', 'forest|jungle|green'],
];
const GENRE_WORDS = [
  ['stack', 'stack|stacking|tower|pile|build(?:ing)? up|skyscraper|balance'], ['match', 'match|swap|puzzle|gems?|jewels?|candy crush|tiles?|three in a row'],
  ['maze', 'maze|labyrinth|keys?|dungeon|escape room|corridors?'], ['eatgrow', 'eat|eats|eating|grow|grows|bigger|hungry|gobble|swallow|devour|feed'],
  ['shooter', 'shoot|shooter|shooting|blast|laser|invaders?|space war|bullet|gun|fire at|defend|aliens?'],
  ['runner', 'run|runner|running|jump|jumping|dash|dodge|hop|endless|race|platform'],
];
const NAMES = ['Pip', 'Zuzu', 'Nova', 'Bolt', 'Miso', 'Juno', 'Taro', 'Kiki', 'Lumo', 'Rex', 'Oli', 'Fizz', 'Momo', 'Dex', 'Skye', 'Bean'];
const SUFFIX = {
  runner: ['Dash', 'Rush', 'Run', 'Sprint', 'Hop'],
  stack: ['Tower', 'Stack', 'Heights', 'Skyline'],
  shooter: ['Blaster', 'Storm', 'Strike', 'Defender', 'Barrage'],
  match: ['Match', 'Swap', 'Crush', 'Pop'],
  maze: ['Maze', 'Labyrinth', 'Escape', 'Quest'],
  eatgrow: ['Feast', 'Gobble', 'Grow', 'Munch'],
};
const DEFAULT_CAST = {
  runner: { player: 'blob', enemy: 'bird', item: 'coin', hazard: 'spike' },
  stack: { player: 'blob', enemy: 'bird', item: 'star', hazard: 'crate' },
  shooter: { player: 'ship', enemy: 'bug', item: 'bolt', hazard: 'rock' },
  match: { player: 'gem', enemy: 'star', item: 'heart', hazard: 'rock' },
  maze: { player: 'mouse', enemy: 'ghost', item: 'key', hazard: 'spike' },
  eatgrow: { player: 'fish', enemy: 'fish', item: 'orb', hazard: 'mine' },
};
const SCENE_ENEMY = { space: 'ufo', moon: 'ufo', ocean: 'jelly', cave: 'ghost', city: 'robot', grid: 'ufo', snow: 'bird', desert: 'bug', candy: 'blob' };
const SCENE_HAZARD = { desert: 'cactus', city: 'cone', grid: 'barrier', space: 'rock', moon: 'rock', cave: 'spike', candy: 'spike', snow: 'rock', forest: 'rock', hills: 'crate', ocean: 'mine' };
const SCENE_ITEM = { candy: 'donut', ocean: 'orb', space: 'star', moon: 'star', forest: 'fruit', cave: 'gem', city: 'coin', grid: 'bolt', desert: 'gem', snow: 'gem' };
const MUSIC = { runner: ['drive', 118], stack: ['house', 124], shooter: ['phonk', 150], match: ['house', 116], maze: ['drive', 108], eatgrow: ['house', 122] };
const TEXT = {
  runner: { start: 'Tap to jump. Tap again in the air to double jump.', win: '{p} made it all the way!', lose: 'Ouch. One more run?' },
  stack: { start: 'Tap to drop each block. Line it up for a perfect.', win: 'Tower complete. Sky high.', lose: 'The tower stops here.' },
  shooter: { start: 'Drag to fly. You fire on your own.', win: 'The last wave is down. You saved the day.', lose: '{p} went down. One more go?' },
  match: { start: 'Swipe a tile to swap it. Match three or more.', win: 'Every level cleared!', lose: 'Out of moves.' },
  maze: { start: 'Swipe or tap to move. Grab the keys, then find the door.', win: 'You escaped every maze!', lose: 'Caught! Try again.' },
  eatgrow: { start: 'Drag to move. Eat smaller things, dodge bigger ones.', win: '{p} is the biggest thing here!', lose: 'Something bigger got you.' },
};

// One step of difficulty per genre: what "harder" means for each template's dials.
const DIFFICULTY = { runner: { speed: 40, accel: 1.5, gap: -0.12, pits: 0.15 }, stack: { speed: 0.3, tolerance: -0.01 }, shooter: { enemySpeed: 0.2, enemyFire: 0.35, waveSize: 2, lives: -1 }, match: { moves: -4, target: 300 }, maze: { enemies: 1, time: -15, size: 2 }, eatgrow: { aggression: 0.35, creatures: 10 } };
function harder(g, tuning, k) {
  for (const [key, d] of Object.entries(DIFFICULTY[g])) {
    const [lo, hi] = TUNING[g][key];
    tuning[key] = Math.min(hi, Math.max(lo, (tuning[key] ?? TUNING[g][key][2]) + d * k));
  }
  return tuning;
}

/**
 * A manual remix, no model needed: a new title, palette or world, a step easier or harder, or fresh levels.
 * The result is sanitized like anything else.
 */
export function remixRecipe(recipe, { title, palette, scene, difficulty = 0, newLevels = false } = {}) {
  const r = JSON.parse(JSON.stringify(recipe));
  if (title) r.title = title;
  if (palette) r.palette = palette;
  if (scene) r.world = { ...r.world, scene };
  if (difficulty) r.tuning = harder(r.genre, { ...defaultTuning(r.genre), ...r.tuning }, Math.sign(difficulty));
  if (newLevels) r.seed = (Math.imul((r.seed >>> 0) ^ 0x5bd1e995, 2654435761) >>> 1) % 2147483647;
  return sanitizeRecipe(r, recipe);
}

function findAll(text, table) {
  const hits = [];
  for (const [id, re] of table) {
    const m = WORDS(re).exec(text);
    if (m) hits.push({ id, word: m[0], at: m.index });
  }
  return hits.sort((a, b) => a.at - b.at);
}
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const plain = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Which genre a prompt reads as (falls back to runner). */
export function guessGenre(prompt) {
  const p = plain(prompt).toLowerCase();
  const hits = findAll(p, GENRE_WORDS);
  return hits.length ? hits[0].id : 'runner';
}

/**
 * A complete, playable recipe from a prompt with no model: theme words pick the scene, palette, cast and names;
 * words like "easy" or "insane" shift the tuning. opts: { dims, seed, palette }.
 */
export function templateRecipe(prompt = '', genre = 'auto', opts = {}) {
  const text = plain(prompt).slice(0, 400);
  const p = text.toLowerCase();
  const g = GENRES[genre] ? genre : guessGenre(p);
  const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : hash(`${g}|${p}`) & 0x7fffffff;
  const r = rng(seed);
  const chars = findAll(p, CHAR_WORDS);
  const scene = findAll(p, SCENE_WORDS)[0]?.id || { runner: 'hills', stack: 'city', shooter: 'space', match: 'candy', maze: 'cave', eatgrow: 'ocean' }[g];
  const mood = findAll(p, MOOD_PALETTE)[0]?.id;
  const palette = PALETTES[opts.palette] ? opts.palette : mood || SCENE_PALETTE[scene] || 'amber';
  const cast = { ...DEFAULT_CAST[g] };
  if (chars[0]) cast.player = chars[0].id;
  if (chars[1] && chars[1].id !== chars[0].id) cast.enemy = chars[1].id;
  else if (g === 'eatgrow') cast.enemy = chars[0]?.id || cast.enemy;
  else if (SCENE_ENEMY[scene] && !chars[1]) cast.enemy = SCENE_ENEMY[scene];
  if (g === 'shooter' && !['ship', 'ufo', 'sub', 'rover', 'car', 'robot', 'egg', 'crystal'].includes(cast.player)) {
    // a shooter needs something that flies and fires; keep the subject as the enemy instead
    if (chars[0] && !chars[1]) cast.enemy = chars[0].id;
    cast.player = scene === 'ocean' ? 'sub' : 'ship';
  }
  const item = findAll(p, ITEM_WORDS)[0]?.id || SCENE_ITEM[scene] || cast.item;
  const hazard = findAll(p, HAZARD_WORDS)[0]?.id || SCENE_HAZARD[scene] || cast.hazard;
  const subjectWord = chars[0]?.word || findAll(p, ITEM_WORDS)[0]?.word || scene;
  const noun = cap(subjectWord.replace(/s$/, '').replace(/ie$/, 'y'));
  const title = opts.title || `${noun} ${r.pick(SUFFIX[g])}`.slice(0, 40);
  const pname = r.pick(NAMES);
  const easy = /\b(easy|kids?|children|toddler|chill|relax(?:ing)?|calm|gentle|cozy)\b/.test(p);
  const hard = /\b(hard|insane|extreme|brutal|fast|difficult|crazy|impossible)\b/.test(p);
  const tuning = defaultTuning(g);
  const k = easy ? -1 : hard ? 1 : 0;
  if (k) harder(g, tuning, k);
  const [style, bpm] = MUSIC[g];
  const music = /\b(epic|boss|battle|war|dramatic)\b/.test(p) ? ['trailer', 96] : /\b(dark|spooky|haunted|creepy)\b/.test(p) ? ['trap', 132] : /\b(fast|speed|rush|hype)\b/.test(p) ? ['phonk', 150] : easy ? ['house', 112] : [style, bpm];
  const t = TEXT[g];
  const pfx = (s) => s.replace('{p}', pname);
  const dims = GENRES[g].dims.includes(opts.dims) ? opts.dims : GENRES[g].dims[0];
  return {
    v: 1,
    title,
    genre: g,
    dims,
    theme: (text ? text.charAt(0).toUpperCase() + text.slice(1) : `A ${GENRES[g].name.toLowerCase()} game in a ${scene} world.`).slice(0, 160),
    palette,
    seed,
    player: { name: pname, desc: chars[0] ? `${chars[0].word}` : `a ${cast.player}`, shape: cast.player },
    enemy: { name: cap(chars[1]?.word || cast.enemy).slice(0, 20), desc: chars[1]?.word || `a ${cast.enemy}`, shape: cast.enemy },
    item: { name: cap(findAll(p, ITEM_WORDS)[0]?.word || item).slice(0, 20), desc: `a ${item}`, shape: item },
    hazard: { name: cap(hazard), desc: `a ${hazard}`, shape: hazard },
    world: { desc: `a ${scene} world`, scene },
    art: { mode: 'procedural' },
    tuning,
    goal: g === 'runner' && easy ? 1200 : GENRES[g].goal[2],
    text: { start: t.start, win: pfx(t.win), lose: pfx(t.lose) },
    music: { style: music[0], bpm: music[1] },
  };
}

// ---------- sanitizing ----------
const str = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/[\u0000-\u001f\u007f<>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');
function num(v, lo, hi, d, int = false) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return d;
  const c = Math.min(hi, Math.max(lo, n));
  return int ? Math.round(c) : Math.round(c * 1000) / 1000;
}
const ART_URL = /^(?:\/media\/games\/[\w\-./]{1,120}\.(?:png|jpe?g|webp)|data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/;
const okUrl = (u) => typeof u === 'string' && u.length < 6_000_000 && ART_URL.test(u) && !u.includes('..');
function sheet(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !okUrl(v.src)) return null;
  const anims = {};
  if (v.anims && typeof v.anims === 'object') {
    for (const [k, list] of Object.entries(v.anims).slice(0, 16)) {
      if (!/^[a-z][a-z0-9]{0,15}$/i.test(k) || !Array.isArray(list)) continue;
      const fr = list.slice(0, 32).map((n) => num(n, 0, 1023, -1, true)).filter((n) => n >= 0);
      if (fr.length) anims[k] = fr;
    }
  }
  if (!Object.keys(anims).length) return null;
  return { src: v.src, cw: num(v.cw, 8, 1024, 64, true), ch: num(v.ch, 8, 1024, 64, true), anims, fps: num(v.fps, 1, 30, 12), ax: num(v.ax, 0, 1, 0.5), ay: num(v.ay, 0, 1, 1), pixel: v.pixel === true };
}
function sanitizeArt(a) {
  const out = { mode: 'procedural' };
  if (!a || typeof a !== 'object' || Array.isArray(a)) return out;
  for (const role of ['player', 'enemy', 'item', 'hazard']) {
    const v = a[role];
    if (okUrl(v)) out[role] = v;
    else if (role === 'player' || role === 'enemy') { const s = sheet(v); if (s) out[role] = s; }
  }
  const bg = Array.isArray(a.bg) ? a.bg.filter(okUrl).slice(0, 6) : okUrl(a.bg) ? [a.bg] : [];
  if (bg.length) out.bg = bg.length === 1 ? bg[0] : bg;
  if (Object.keys(out).length > 1) out.mode = 'images';
  return out;
}
function actor(v, fb, shapes) {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return { name: str(o.name, 20) || fb.name, desc: str(o.desc, 100) || fb.desc, shape: shapes.includes(o.shape) ? o.shape : shapes.includes(fb.shape) ? fb.shape : shapes[0] };
}

/**
 * Make any input safe to play: whitelist fields, clamp every number to its range, cap every string, and fill
 * gaps from `fallback`. Returns `fallback` itself when raw isn't a usable object (so callers can tell).
 */
export function sanitizeRecipe(raw, fallback) {
  const fb = fallback && typeof fallback === 'object' && GENRES[fallback.genre] ? fallback : templateRecipe('', 'runner');
  if (typeof raw === 'string') {
    const m = raw.match(/\{[\s\S]*\}/);
    try { raw = JSON.parse(m ? m[0] : raw); } catch { return fb; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fb;
  if (raw.recipe && typeof raw.recipe === 'object' && !raw.genre) raw = raw.recipe;
  const genre = GENRES[raw.genre] ? raw.genre : fb.genre;
  const same = genre === fb.genre;
  const G = GENRES[genre];
  const baseTuning = same ? { ...defaultTuning(genre), ...fb.tuning } : defaultTuning(genre);
  const tuning = {};
  const rt = raw.tuning && typeof raw.tuning === 'object' && !Array.isArray(raw.tuning) ? raw.tuning : {};
  for (const [k, [lo, hi]] of Object.entries(TUNING[genre])) { const int = INT_KEYS.has(`${genre}.${k}`); tuning[k] = num(rt[k], lo, hi, num(baseTuning[k], lo, hi, TUNING[genre][k][2], int), int); }
  const ft = fb.text || {};
  const rtxt = raw.text && typeof raw.text === 'object' ? raw.text : {};
  const tdef = TEXT[genre];
  const rm = raw.music && typeof raw.music === 'object' ? raw.music : {};
  const fm = same && fb.music ? fb.music : { style: MUSIC[genre][0], bpm: MUSIC[genre][1] };
  const rw = raw.world && typeof raw.world === 'object' ? raw.world : {};
  const fw = fb.world || { desc: '', scene: 'hills' };
  const out = {
    v: 1,
    title: str(raw.title, 40) || fb.title,
    genre,
    dims: G.dims.includes(raw.dims) ? raw.dims : same && G.dims.includes(fb.dims) ? fb.dims : G.dims[0],
    theme: str(raw.theme, 160) || fb.theme,
    palette: Object.hasOwn(PALETTES, raw.palette) ? raw.palette : fb.palette,
    seed: num(raw.seed, 0, 2147483647, fb.seed >>> 0, true),
    player: actor(raw.player, fb.player, [...CHARACTERS, ...ITEMS]),
    enemy: actor(raw.enemy, fb.enemy, [...CHARACTERS, ...ITEMS]),
    item: actor(raw.item, fb.item, [...ITEMS, ...CHARACTERS]),
    hazard: actor(raw.hazard, fb.hazard || { name: 'Spike', desc: 'a spike', shape: 'spike' }, HAZARDS),
    world: { desc: str(rw.desc, 100) || fw.desc, scene: SCENES.includes(rw.scene) ? rw.scene : fw.scene },
    art: sanitizeArt(raw.art !== undefined ? raw.art : fb.art),
    tuning,
    goal: num(raw.goal, G.goal[0], G.goal[1], same ? num(fb.goal, G.goal[0], G.goal[1], G.goal[2], true) : G.goal[2], true),
    text: {
      start: str(rtxt.start, 70) || (same && str(ft.start, 70)) || tdef.start,
      win: str(rtxt.win, 70) || (same && str(ft.win, 70)) || tdef.win.replace('{p}', 'You'),
      lose: str(rtxt.lose, 70) || (same && str(ft.lose, 70)) || tdef.lose.replace('{p}', 'You'),
    },
    music: { style: MUSIC_STYLES.includes(rm.style) ? rm.style : fm.style, bpm: num(rm.bpm, 80, 170, fm.bpm, true) },
  };
  if (!Object.hasOwn(PALETTES, out.palette)) out.palette = 'amber';
  if (out.title.length < 2) out.title = fb.title;
  return out;
}

/** A recipe with no image data, for share links (static gallery art paths stay). */
export function shareable(recipe) {
  const r = JSON.parse(JSON.stringify(recipe));
  const keep = (v) => (typeof v === 'string' ? v.startsWith('/media/games/') : v && typeof v.src === 'string' && v.src.startsWith('/media/games/'));
  for (const k of ['player', 'enemy', 'item', 'hazard']) if (r.art?.[k] && !keep(r.art[k])) delete r.art[k];
  if (r.art?.bg) {
    const list = (Array.isArray(r.art.bg) ? r.art.bg : [r.art.bg]).filter(keep);
    if (list.length) r.art.bg = list.length === 1 ? list[0] : list; else delete r.art.bg;
  }
  if (r.art) r.art.mode = Object.keys(r.art).length > 1 ? 'images' : 'procedural';
  return r;
}

// ---------- the model's instructions ----------
const tuningLines = GENRE_IDS.map((g) => `  ${g}: ${Object.entries(TUNING[g]).map(([k, [lo, hi, d]]) => `${k} ${lo}-${hi} (${d})`).join(', ')}; goal ${GENRES[g].goal[0]}-${GENRES[g].goal[1]} ${GENRES[g].goalUnit} (${GENRES[g].goal[2]}, 0 = endless)`).join('\n');

const EXAMPLE = {
  title: 'Penguin Slide', genre: 'runner', dims: '2d', theme: 'A penguin races down an icy mountain at night, hopping rocks and gaps.', palette: 'arctic', seed: 48213,
  player: { name: 'Pip', desc: 'a round little penguin with a red scarf', shape: 'bird' },
  enemy: { name: 'Snow Owl', desc: 'a grumpy white owl swooping low', shape: 'bird' },
  item: { name: 'Fish Snack', desc: 'a shiny blue gem-like fish treat', shape: 'gem' },
  hazard: { name: 'Ice Rock', desc: 'a jagged grey rock', shape: 'rock' },
  world: { desc: 'a snowy mountain slope under the northern lights', scene: 'snow' },
  tuning: { speed: 340, accel: 3, maxSpeed: 680, gravity: 2600, jump: 980, gap: 1, coins: 0.7, pits: 0.4, flyers: 0.4, walkers: 0.2 },
  goal: 2000,
  text: { start: 'Tap to jump. Tap again in the air to double jump.', win: 'Pip reached the bottom!', lose: 'Bonk! One more slide?' },
  music: { style: 'drive', bpm: 120 },
};

/** A system prompt for a model-backed game writer (Llama 3.3 70B; user message JSON { prompt, genre, dims }). Not wired to a Worker route yet: the page uses templateRecipe. */
export const GAME_RULES = `You design small, fun mobile games for Chucksi. Reply with ONE JSON object and nothing else: no prose, no code fences.

The user sends {"prompt": what the game is about, "genre": one of ${GENRE_IDS.join(', ')} or "auto", "dims": "2d" or "3d"}. If genre is "auto", pick the genre that fits best. Keep the genre you were given otherwise. "3d" only applies to stack.

Fields:
- title: 2-32 chars, catchy, no quotes or emoji
- genre, dims: as above
- theme: one vivid sentence, at most 120 chars
- palette: one of ${Object.keys(PALETTES).join(', ')}
- seed: any integer 1-2000000000
- player, enemy: {name: at most 16 chars, desc: what it looks like in at most 80 chars, shape: one of ${CHARACTERS.join(', ')}}
- item: {name, desc, shape: one of ${ITEMS.join(', ')}}
- hazard: {name, desc, shape: one of ${HAZARDS.join(', ')}}
- world: {desc: at most 80 chars, scene: one of ${SCENES.join(', ')}}
- tuning: numbers for the chosen genre only, inside these ranges (default in brackets):
${tuningLines}
- goal: a number in the genre's goal range
- text: {start: how to play in at most 60 chars, win: at most 60 chars, lose: at most 60 chars}
- music: {style: one of ${MUSIC_STYLES.join(', ')}, bpm: 80-170}

Rules: pick the shape and scene closest to the prompt (a dog can be "cat", a dragon "bird", a tank "rover"). Easy or kids games: lower speeds, more moves or time, fewer enemies. Hard games: the other way. When unsure, use the default. Keep everything kid-safe: no gore, no real people, brands or logos.

Example. User: {"prompt":"a penguin sliding down an icy mountain","genre":"runner","dims":"2d"}
Reply: ${JSON.stringify(EXAMPLE)}`;
