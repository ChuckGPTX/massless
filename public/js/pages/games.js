// Games page: describe a game, optionally add art, get a playtested, playable game; or play one from the gallery.
import { bindDialogs, toast, el, download, autoplayVideos } from '../ui.js';
import { retainExport } from '../assets.js';
import * as store from '../store.js';
import { GENRES, GENRE_IDS, templateRecipe, sanitizeRecipe, guessGenre, defaultTuning, remixRecipe } from '../games/recipe.js';
import { PALETTES, SCENES } from '../games/art.js';
import { GALLERY, byId } from '../games/gallery.js';
import { loadTemplate, playtested } from '../games/index.js';
import { mountGame, hash } from '../games/engine.js';
import { loadArt } from '../games/art.js';
import { Sound } from '../games/sound.js';
import { encodeRecipe, decodeRecipe, buildStandalone } from '../games/share.js';

const $ = (s) => document.querySelector(s);
const ICON = {
  auto: '<path d="M12 3l2.2 5.3L20 9l-4.4 3.8L17 18.5 12 15.6 7 18.5l1.4-5.7L4 9l5.8-.7z"/>',
  runner: '<circle cx="14" cy="4.5" r="2"/><path d="M8 21l3-6 3 3v4M6 12l3-4h5l3 3 3 1M11 15l1-6"/>',
  stack: '<path d="M4 18h16v3H4zM6 13h12v3H6zM8 8h9v3H8zM10 3h6v3h-6z"/>',
  shooter: '<path d="M12 2l3 8v6l3 2v2l-6-2-6 2v-2l3-2v-6zM12 20v2"/>',
  match: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="3.5"/><path d="M6.5 14l3.5 7H3zM14 14h7v7h-7z"/>',
  maze: '<path d="M3 3h18v18H3zM7 3v8h4M15 7v10M7 15h4v6M15 7h-4"/>',
  eatgrow: '<circle cx="9" cy="13" r="6"/><path d="M15 11l5-3v10l-5-3"/><circle cx="20" cy="5" r="1.5"/>',
};
const LINES = { auto: 'Read it from what you write', runner: 'Jump hazards, stomp foes, go far', stack: 'Drop blocks, build high. 3D or 2D', shooter: 'Fly, dodge, blast every wave', match: 'Swap tiles, match three, clear levels', maze: 'Grab the keys, find the door', eatgrow: 'Eat smaller things, grow huge' };
const FILTERS = [['all', 'All'], ['runner', 'Runners'], ['stack', 'Stackers'], ['shooter', 'Shooters'], ['match', 'Puzzles'], ['maze', 'Maze'], ['eatgrow', 'Eat & Grow'], ['arcade', 'Arcade'], ['kids', 'Kids'], ['yours', 'Yours']];
const SURPRISE = [
  'a penguin sliding down an icy mountain at night', 'stack donuts as high as you can', 'a tiny ufo defending the moon from space bugs',
  'match three with fruit in a jungle', 'a ghost escaping a haunted maze', 'a hungry shark eating its way through the reef',
  'a robot dashing over neon rooftops', 'a knight collecting keys in a dungeon', 'a cat running through a candy land', 'build a sandcastle tower on the beach',
  'a bee shooting pollen at grumpy wasps', 'a slime that eats everything in a cave',
];
const ART_SLOTS = [['player', 'Player', 'Your hero'], ['enemy', 'Enemy', 'What to avoid'], ['bg', 'Background', 'The world']];

const state = {
  genre: 'auto', dims: '2d', uploads: {}, busy: false, current: null, filter: 'all', mine: [],
  sound: new Sound({
    loadScore: () => import('../score.js'),
    cache: {
      // `pcm`, not `blob`: a working cache, kept out of My library and capped at a few loops
      get: async (k) => (await store.get(`game-music:${k}`))?.pcm || null,
      put: async (k, pcm) => {
        await store.put({ id: `game-music:${k}`, kind: 'game-music', created: Date.now(), pcm });
        const { prune } = await import('../games/aiart.js');
        await prune('game-music', 8);
      },
    },
  }),
};
window.massless = { state };

// ---------- the prompt card ----------
function setGenre(g) {
  state.genre = g;
  $('#genre-label').textContent = `Genre: ${g === 'auto' ? 'Auto' : GENRES[g].name}`;
  $('#genre-pop').querySelectorAll('.g-opt').forEach((o) => o.setAttribute('aria-selected', String(o.dataset.genre === g)));
  const can3d = g === 'auto' || GENRES[g].dims.includes('3d');
  const b3 = $('.g-seg [data-dims="3d"]');
  b3.disabled = !can3d;
  if (!can3d && state.dims === '3d') setDims('2d');
  if (g === 'stack' && state.dims === '2d' && !state.dimsTouched) setDims('3d');
}
function setDims(d) {
  state.dims = d;
  document.querySelectorAll('.g-seg [data-dims]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.dims === d)));
}
function popToggle(id, on) {
  const pop = $(id);
  const btn = id === '#genre-pop' ? $('#genre-chip') : $('#art-tile');
  const open = on ?? pop.hidden;
  document.querySelectorAll('.g-pop').forEach((p) => { p.hidden = true; });
  $('#genre-chip').setAttribute('aria-expanded', 'false');
  $('#art-tile').setAttribute('aria-expanded', 'false');
  pop.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}
function buildPrompt() {
  const pop = $('#genre-pop');
  for (const g of ['auto', ...GENRE_IDS]) {
    const b = el('button', { type: 'button', class: 'g-opt', role: 'option', 'data-genre': g, 'aria-selected': String(g === 'auto') },
      el('span', { class: 'ico', html: `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[g]}</svg>` }),
      el('strong', {}, g === 'auto' ? 'Auto' : GENRES[g].name), el('small', {}, LINES[g]));
    b.addEventListener('click', () => { setGenre(g); popToggle('#genre-pop', false); $('#prompt').focus(); });
    pop.append(b);
  }
  $('#genre-chip').addEventListener('click', (e) => { e.stopPropagation(); popToggle('#genre-pop'); });
  $('#art-tile').addEventListener('click', (e) => { e.stopPropagation(); popToggle('#art-pop'); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.g-pop')) document.querySelectorAll('.g-pop').forEach((p) => { if (!p.hidden) popToggle(`#${p.id}`, false); }); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.g-pop').forEach((p) => { if (!p.hidden) popToggle(`#${p.id}`, false); }); });
  document.querySelectorAll('.g-seg [data-dims]').forEach((b) => b.addEventListener('click', () => { state.dimsTouched = true; setDims(b.dataset.dims); if (b.dataset.dims === '3d' && state.genre === 'auto') toast('3D works with Stack. Describe a tower, or pick Stack.'); }));
  $('#surprise').addEventListener('click', () => {
    const p = SURPRISE[Math.floor(Math.random() * SURPRISE.length)];
    $('#prompt').value = p;
    setGenre('auto');
    $('#prompt').focus();
  });
  $('#prompt-form').addEventListener('submit', (e) => { e.preventDefault(); generate(); });
  $('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } });
  // art slots
  const slots = $('#art-slots');
  for (const [role, name, hint] of ART_SLOTS) {
    const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': `${name} image` });
    const pv = el('span', { class: 'pv' }, '+');
    const note = el('small', {}, hint);
    const rm = el('button', { type: 'button', class: 'rm', 'aria-label': `Remove ${name.toLowerCase()} image`, hidden: true }, '×');
    const slot = el('label', { class: 'g-slot', 'data-role': role }, input, pv, el('span', {}, name), note, rm);
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const { readUpload } = await import('../games/aiart.js');
        const res = await readUpload(f, role);
        state.uploads[role] = res.image;
        pv.replaceChildren(el('img', { src: res.image.toDataURL ? res.image.toDataURL() : URL.createObjectURL(f), alt: '' }));
        note.textContent = role === 'bg' ? 'Used as the world' : res.keyed ? 'Background removed' : res.clear ? 'Transparent, used as is' : 'Used as is';
        rm.hidden = false;
        syncThumbs();
      } catch (e) { toast(`That image could not be read: ${e.message}`, 'error'); }
      input.value = '';
    });
    rm.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); delete state.uploads[role]; pv.textContent = '+'; note.textContent = hint; rm.hidden = true; syncThumbs(); });
    slots.append(slot);
  }
}
function syncThumbs() {
  const box = $('#art-thumbs');
  box.replaceChildren(...Object.values(state.uploads).map((im) => el('img', { src: im.toDataURL ? im.toDataURL() : im.src, alt: '' })));
  $('#art-tile').classList.toggle('has-art', Object.keys(state.uploads).length > 0);
  $('#art-tile').lastElementChild.textContent = Object.keys(state.uploads).length ? 'Your art' : 'Add your art';
}

// ---------- making a game ----------
function steps(active, note = '') {
  const box = $('#steps');
  box.hidden = !active;
  const order = ['recipe', 'test', 'art', 'play'];
  const i = order.indexOf(active);
  box.querySelectorAll('li[data-step]').forEach((li) => {
    const j = order.indexOf(li.dataset.step);
    li.className = j < i ? 'done' : j === i ? 'on' : '';
  });
  $('#step-note').textContent = note;
}
// The recipe is written in the browser by the built-in writer (recipe.js): no model call, nothing leaves the page.
// recipe.js keeps GAME_RULES, a system prompt for an optional model-backed writer; no server route uses it yet.
async function writeRecipe(prompt, genre, dims) {
  const base = templateRecipe(prompt, genre, { dims });
  return { recipe: base, base, source: 'template' };
}
async function generate() {
  if (state.busy) return;
  const prompt = $('#prompt').value.trim() || 'a fox hopping puddles in the rain';
  state.busy = true;
  $('#generate').disabled = true;
  $('#go-label').textContent = 'Making…';
  popToggle('#genre-pop', false);
  try {
    steps('recipe', 'Writing your game…');
    const genre = state.genre === 'auto' ? guessGenre(prompt) : state.genre;
    let dims = GENRES[genre].dims.includes(state.dims) ? state.dims : GENRES[genre].dims[0];
    if (state.dims === '3d' && dims !== '3d') toast(`3D works with Stack for now, so this ${GENRES[genre].name.toLowerCase()} is 2D.`);
    const { recipe: written, base, source } = await writeRecipe(prompt, genre, dims);
    steps('test', 'Testing it…');
    let t = await playtested(written, { tries: 12 });
    if (!t.ok) {
      // the written tuning would not pass: keep the look, use the template's tuning
      const safe = { ...written, tuning: written.genre === base.genre ? base.tuning : defaultTuning(written.genre) };
      t = await playtested(safe, { tries: 12 });
    }
    const images = { ...state.uploads };
    if ($('#ai-art').checked) {
      steps('art', 'Painting the art…');
      const { paintArt } = await import('../games/aiart.js');
      const roles = ['player', 'bg', 'enemy', 'item'].filter((r) => !images[r]);
      const res = await paintArt(t.recipe, { roles, onProgress: (i, n, role) => steps('art', `Painting the ${role === 'bg' ? 'background' : role} (${i + 1} of ${n})`) });
      Object.assign(images, res.images);
      if (res.notes.length) toast(res.notes[0]);
    }
    steps('play', t.ok ? `Playtested in ${t.tries} ${t.tries === 1 ? 'try' : 'tries'}` : 'Ready');
    await openGame({ recipe: t.recipe, images, tested: t, source, save: true });
  } catch (e) {
    toast(`Could not make the game: ${e.message}`, 'error');
  } finally {
    state.busy = false;
    $('#generate').disabled = false;
    $('#go-label').textContent = 'Generate';
    setTimeout(() => { if (!state.busy) steps(null); }, 2500);
  }
}

// ---------- the player ----------
const fontsReady = Promise.all(['900 40px "Big Shoulders Display"', '800 40px "Big Shoulders Display"', '600 16px "Instrument Sans"', '400 16px "Instrument Sans"'].map((f) => document.fonts.load(f).catch(() => {})));
let lastFocus = null;

async function openGame(o) {
  closeGame({ silent: true });
  const recipe = o.recipe;
  const [tpl, art] = await Promise.all([loadTemplate(recipe.genre), loadArt(recipe, o.images || {}), fontsReady]);
  lastFocus = document.activeElement;
  const box = $('#player');
  box.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#pl-title').textContent = recipe.title;
  $('#pl-genre').textContent = `${GENRES[recipe.genre].name}${recipe.dims === '3d' ? ' · 3D' : ''}`;
  const tested = o.tested;
  $('#pl-tested').hidden = !tested?.ok;
  $('#pl-tested').title = tested?.notes?.join('\n') || '';
  const mount = mountGame($('#stage'), { template: tpl, recipe, art, sound: state.sound, genreName: GENRES[recipe.genre].name, help: tpl.meta?.help, accent: art.pal.accent, bot: !!o.bot, autostart: !!o.autostart });
  state.current = { ...o, recipe, mount, art, tpl, images: o.images || {} };
  mount.onState = () => syncButtons();
  syncButtons();
  renderSide();
  // the score engine works on the main thread: let the title screen settle first (bots and tests can skip it)
  if (!o.noMusic) setTimeout(() => { if (state.current?.mount === mount) state.sound.prepareMusic({ ...recipe.music, seed: recipe.seed }); }, 400);
  const hashNow = o.galleryId ? `#play=${o.galleryId}` : `#g=${await encodeRecipe(recipe)}`;
  if (state.current?.mount === mount) {
    if (location.hash !== hashNow) history.pushState({ game: true }, '', hashNow);
    state.current.link = shareLink(hashNow);
  }
  // keyboard players can press Space straight away
  mount.frame.tabIndex = -1;
  mount.frame.style.outline = 'none';
  mount.frame.focus({ preventScroll: true });
  if (o.save) saveMine(state.current);
  return mount;
}
function closeGame({ silent = false, fromHistory = false } = {}) {
  const cur = state.current;
  if (!cur) return;
  cur.mount.destroy();
  state.sound.stopMusic();
  state.current = null;
  $('#player').hidden = true;
  $('#pl-side').classList.remove('open');
  document.body.style.overflow = '';
  if (!silent && !fromHistory && /#(g|play)=/.test(location.hash)) history.pushState({}, '', location.pathname + location.search);
  if (!silent) lastFocus?.focus?.({ preventScroll: true });
}
function syncButtons() {
  const g = state.current?.mount.game;
  const paused = g?.state === 'paused';
  const b = $('#pl-pause');
  b.setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  b.innerHTML = paused ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>';
  b.disabled = !(g && (g.state === 'play' || g.state === 'paused'));
  const s = $('#pl-sound');
  s.setAttribute('aria-pressed', String(!state.sound.muted));
  s.setAttribute('aria-label', state.sound.muted ? 'Sound off' : 'Sound on');
}
function spriteThumb(art, role) {
  const c = document.createElement('canvas');
  c.width = c.height = 88;
  const ctx = c.getContext('2d');
  if (art.sheet(role)) art.drawAnim(ctx, role, Object.keys(art.sheet(role).anims)[0], 0, 44, 86, 84);
  else art.draw(ctx, role === 'item' && art.recipe.genre === 'maze' ? 'item' : role, 44, 44, 80);
  return c;
}
function renderSide() {
  const cur = state.current;
  const r = cur.recipe;
  const side = $('#pl-side');
  const who = (role, label) => el('div', {}, spriteThumb(cur.art, role), el('span', {}, el('strong', {}, r[role]?.name || label), el('small', {}, `${label} · ${r[role]?.desc || ''}`.slice(0, 80))));
  const cast = r.genre === 'stack' ? [] : [who('player', 'Player'), who('enemy', r.genre === 'match' ? 'Tile' : 'Enemy'), who('item', r.genre === 'maze' ? 'Key' : r.genre === 'match' ? 'Tile' : 'Pick-up')];
  const source = cur.galleryId ? 'Gallery game' : cur.source === 'link' ? 'Shared link' : cur.source === 'remix' ? 'Your remix' : 'Your words';
  const goal = r.goal ? `${r.goal} ${GENRES[r.genre].goalUnit}` : 'Endless';
  side.replaceChildren(...[
    el('h3', {}, 'The game'),
    el('p', { class: 'theme' }, r.theme),
    el('p', {}, cur.tpl.meta?.help || r.text.start),
    cast.length ? el('h3', {}, 'Cast') : null,
    cast.length ? el('div', { class: 'g-cast' }, ...cast) : null,
    el('h3', {}, 'Details'),
    el('dl', { class: 'g-kv' },
      el('dt', {}, 'Made by'), el('dd', {}, source),
      el('dt', {}, 'Goal'), el('dd', {}, goal),
      el('dt', {}, 'Music'), el('dd', {}, `${r.music.style}, ${r.music.bpm} BPM`),
      el('dt', {}, 'Look'), el('dd', {}, `${cur.art.pal.name} palette, ${r.world.scene}${Object.keys(cur.images).length || r.art?.mode === 'images' ? ', with images' : ''}`)),
    cur.tested?.ok ? el('h3', {}, 'Tested and ready') : null,
    remixForm(r),
    el('button', { type: 'button', class: 'btn-ghost g-remix', onclick: () => remix(r) }, 'Describe a new version'),
  ].filter(Boolean));
}
// Manual remix: no model, no network. Title, look, world, difficulty and fresh levels, playtested again.
function remixForm(r) {
  const title = el('input', { type: 'text', id: 'rx-title', value: r.title, maxlength: '40', 'aria-label': 'Title' });
  const pal = el('select', { id: 'rx-palette', 'aria-label': 'Palette' }, ...Object.entries(PALETTES).map(([k, v]) => el('option', { value: k, selected: k === r.palette }, v.name)));
  const scene = el('select', { id: 'rx-scene', 'aria-label': 'World' }, ...SCENES.map((k) => el('option', { value: k, selected: k === r.world.scene }, k[0].toUpperCase() + k.slice(1))));
  let diff = 0;
  const seg = el('div', { class: 'g-seg rx-diff', role: 'radiogroup', 'aria-label': 'Difficulty' }, ...[[-1, 'Easier'], [0, 'Same'], [1, 'Harder']].map(([v, label]) => {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(v === 0), 'data-diff': v }, label);
    b.addEventListener('click', () => { diff = v; seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b))); });
    return b;
  }));
  const fresh = el('input', { type: 'checkbox', id: 'rx-new' });
  const go = el('button', { type: 'button', class: 'btn-accent g-remix', id: 'rx-apply' }, 'Play the remix');
  go.addEventListener('click', async () => {
    const cur = state.current;
    if (!cur) return;
    go.disabled = true;
    try {
      const next = remixRecipe(cur.recipe, { title: title.value.trim(), palette: pal.value, scene: scene.value, difficulty: diff, newLevels: fresh.checked });
      const t = await playtested(next, { tries: 12 });
      await openGame({ recipe: t.recipe, images: cur.images, tested: t, source: 'remix', save: true });
      toast(`Remixed: ${t.recipe.title}. ${t.ok ? 'Tested and ready.' : ''}`);
    } catch (e) {
      toast(`Could not remix: ${e.message}`, 'error');
    } finally { go.disabled = false; }
  });
  return el('form', { class: 'g-rx', onsubmit: (e) => e.preventDefault() },
    el('h3', {}, 'Remix'),
    el('label', {}, el('span', {}, 'Title'), title),
    el('div', { class: 'g-rx-row' }, el('label', {}, el('span', {}, 'Look'), pal), el('label', {}, el('span', {}, 'World'), scene)),
    el('label', {}, el('span', {}, 'Difficulty'), seg),
    el('label', { class: 'g-rx-check' }, fresh, el('span', {}, 'New levels')),
    go);
}
function remix(r) {
  closeGame();
  $('#prompt').value = r.theme;
  setGenre(r.genre);
  if (GENRES[r.genre].dims.includes(r.dims)) setDims(r.dims);
  document.getElementById('make').scrollIntoView({ behavior: 'smooth' });
  $('#prompt').focus({ preventScroll: true });
}
const shareLink = (h) => `${location.origin}/games${h}`;
async function share() {
  const cur = state.current;
  if (!cur) return;
  const url = shareLink(cur.galleryId ? `#play=${cur.galleryId}` : `#g=${await encodeRecipe(cur.recipe)}`);
  cur.link = url;
  const note = Object.keys(cur.images).length ? ' The link carries the game, not your images; Download keeps them.' : '';
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: cur.recipe.title, text: `Play ${cur.recipe.title}, made with Chucksi`, url }); return; } catch { /* cancelled */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(`Link copied. Anyone with it can play ${cur.recipe.title}.${note}`);
  } catch {
    toast(`Copy this link: ${url}`);
  }
}
async function downloadGame() {
  const cur = state.current;
  if (!cur) return;
  const b = $('#pl-download');
  b.disabled = true;
  try {
    const { html, threeInlined } = await buildStandalone(cur.recipe, cur.images, { genreName: GENRES[cur.recipe.genre].name, help: cur.tpl.meta?.help });
    const name = `${cur.recipe.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chucksi-game'}.html`;
    const blob = new Blob([html], { type: 'text/html' });
    download(blob, name);
    const kept = await retainExport(blob, { name: cur.recipe.title, title: cur.recipe.title, prompt: cur.recipe.theme, engine: 'games', model: `Chucksi Games · ${GENRES[cur.recipe.genre].name}`, seed: cur.recipe.seed, settings: { recipe: cur.recipe } });
    toast(`Saved ${name} (${(html.length / 1e6).toFixed(1)} MB)${kept.saved ? ' and added it to My library' : ''}. It plays in any browser${cur.recipe.dims === '3d' && !threeInlined ? ' with an internet connection' : ', even offline'}.`);
  } catch (e) {
    toast(`Download failed: ${e.message}`, 'error');
  } finally { b.disabled = false; }
}

// ---------- the gallery ----------
const tested = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';
function card({ id, title, genre, dims, poster, video, onPlay, tags = [], onRemove }) {
  const thumb = el('button', { type: 'button', class: 'g-thumb', 'aria-label': `Play ${title}` });
  if (video) thumb.append(el('video', { muted: true, loop: true, playsinline: true, preload: 'none', poster, 'data-src': video, 'aria-hidden': 'true' }));
  else if (poster) thumb.append(el('img', { src: poster, alt: '', loading: 'lazy' }));
  thumb.append(el('span', { class: 'g-badge', html: `${tested}Playtested` }));
  if (dims === '3d') thumb.append(el('span', { class: 'g-badge d3' }, '3D'));
  const play = el('button', { type: 'button', class: 'g-play', 'aria-label': `Play ${title}` }, 'Play');
  const a = el('article', { class: 'g-card', 'data-genre': genre, 'data-tags': tags.join(' '), 'data-id': id },
    thumb, el('div', { class: 'g-meta' }, el('div', {}, el('h3', { title }, title), el('span', {}, GENRES[genre].name)), play));
  thumb.addEventListener('click', onPlay);
  play.addEventListener('click', onPlay);
  if (onRemove) a.append(el('button', { type: 'button', class: 'rm', 'aria-label': `Remove ${title}`, onclick: onRemove }, '×'));
  return a;
}
function buildFilters() {
  const box = $('#genre-filter');
  box.replaceChildren();
  const count = (f) => (f === 'all' ? GALLERY.length + state.mine.length : f === 'yours' ? state.mine.length : GALLERY.filter((g) => g.recipe.genre === f || g.tags.includes(f)).length + state.mine.filter((m) => m.recipe.genre === f).length);
  for (const [f, name] of FILTERS) {
    const n = count(f);
    if (f === 'yours' && !n) continue;
    const b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(state.filter === f), 'data-filter': f }, name, f === 'all' || f === 'yours' ? el('span', { class: 'n' }, String(n)) : null);
    b.addEventListener('click', () => { state.filter = f; buildFilters(); applyFilter(); });
    box.append(b);
  }
}
function applyFilter() {
  const f = state.filter;
  let shown = 0;
  document.querySelectorAll('#grid .g-card').forEach((c) => {
    const mine = c.classList.contains('mine');
    const on = f === 'all' || (f === 'yours' ? mine : c.dataset.genre === f || c.dataset.tags.split(' ').includes(f));
    c.hidden = !on;
    if (on) shown++;
  });
  $('#grid .g-empty')?.remove();
  if (!shown) $('#grid').append(el('p', { class: 'g-empty' }, 'Nothing here yet. Describe one above.'));
}
function buildGallery() {
  const grid = $('#grid');
  grid.replaceChildren();
  for (const m of state.mine) {
    const c = card({
      id: m.id, title: m.recipe.title, genre: m.recipe.genre, dims: m.recipe.dims, poster: m.thumbUrl, tags: ['yours'],
      onPlay: () => openMine(m),
      onRemove: async (e) => { e.stopPropagation(); await store.del(m.id).catch(() => {}); await loadMine(); },
    });
    c.classList.add('mine');
    grid.append(c);
  }
  for (const g of GALLERY) {
    grid.append(card({ id: g.id, title: g.recipe.title, genre: g.recipe.genre, dims: g.recipe.dims, tags: g.tags, poster: `/media/games/${g.id}.jpg`, video: `/media/games/${g.id}.mp4`, onPlay: () => openGallery(g.id) }));
  }
  autoplayVideos(grid.querySelectorAll('video[data-src]'));
  applyFilter();
}
async function openGallery(id, opts = {}) {
  const g = byId(id);
  if (!g) return null;
  const recipe = sanitizeRecipe(g.recipe, templateRecipe('', g.recipe.genre));
  const tpl = await loadTemplate(recipe.genre);
  const res = tpl.playtest(recipe);
  return openGame({ recipe, galleryId: id, tested: { ok: res.ok, notes: res.notes, tries: 1 }, ...opts });
}
async function openRecipe(raw, opts = {}) {
  const base = templateRecipe('', GENRES[raw?.genre] ? raw.genre : 'runner');
  const recipe = sanitizeRecipe(raw, base);
  const t = await playtested(recipe, { tries: opts.tries ?? 1 });
  return openGame({ recipe, tested: { ...t, ok: t.ok }, source: opts.source || 'link', ...opts });
}

// ---------- your games (IndexedDB) ----------
async function loadMine() {
  const items = (await store.all().catch(() => [])).filter((x) => x.kind === 'game').sort((a, b) => b.created - a.created);
  state.mine.forEach((m) => m.thumbUrl && URL.revokeObjectURL(m.thumbUrl));
  state.mine = items.map((x) => ({ ...x, thumbUrl: x.thumb ? URL.createObjectURL(x.thumb) : '' }));
  buildFilters();
  buildGallery();
}
async function saveMine(cur) {
  const id = `game:${hash(JSON.stringify(cur.recipe))}`;
  const art = {};
  for (const [role, im] of Object.entries(cur.images)) {
    const c = document.createElement('canvas');
    c.width = im.naturalWidth || im.width;
    c.height = im.naturalHeight || im.height;
    c.getContext('2d').drawImage(im, 0, 0);
    art[role] = await new Promise((r) => c.toBlob(r, role === 'bg' ? 'image/jpeg' : 'image/png', 0.88));
  }
  await new Promise((r) => setTimeout(r, 1600));
  let thumb = null;
  if (state.current?.mount === cur.mount) {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 400;
    const ctx = c.getContext('2d');
    cur.mount.game.render();
    for (const cv of cur.mount.frame.querySelectorAll('canvas')) ctx.drawImage(cv, 0, -((cv.height / cv.width) * 300 - 400) / 2, 300, (cv.height / cv.width) * 300);
    thumb = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
  }
  await store.put({ id, kind: 'game', created: Date.now(), recipe: cur.recipe, art, thumb, source: cur.source, tested: cur.tested }).catch(() => {});
  await loadMine();
}
async function openMine(m) {
  const images = {};
  for (const [role, blob] of Object.entries(m.art || {})) {
    if (!blob) continue;
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await img.decode().catch(() => {});
    images[role] = img;
  }
  return openGame({ recipe: m.recipe, images, tested: m.tested, source: m.source });
}

// ---------- links ----------
async function fromHash() {
  const h = location.hash;
  const play = h.match(/^#play=([\w-]+)/);
  const g = h.match(/^#g=([\w-]+)/);
  try {
    if (play && state.current?.galleryId !== play[1]) await openGallery(play[1]);
    else if (g && !(state.current && !state.current.galleryId && state.current.link?.endsWith(g[1]))) await openRecipe(await decodeRecipe(g[1]), { source: 'link' });
    else if (!play && !g && state.current) closeGame({ fromHistory: true });
  } catch (e) {
    toast(`That game link could not be opened (${e.message}).`, 'error');
  }
}

function init() {
  bindDialogs();
  buildPrompt();
  const q = new URLSearchParams(location.search);
  if (q.get('genre') && GENRES[q.get('genre')]) setGenre(q.get('genre'));
  if (q.get('prompt')) $('#prompt').value = q.get('prompt').slice(0, 300);
  buildFilters();
  buildGallery();
  loadMine();
  $('#pl-close').addEventListener('click', () => closeGame());
  $('#pl-pause').addEventListener('click', () => { const g = state.current?.mount.game; if (!g) return; if (g.state === 'paused') { state.sound.unlock(); g.resume(); } else g.pause(); syncButtons(); });
  $('#pl-restart').addEventListener('click', () => { state.current?.mount.play(); syncButtons(); });
  $('#pl-sound').addEventListener('click', () => { state.sound.unlock(); state.sound.setMuted(!state.sound.muted); syncButtons(); });
  $('#pl-share').addEventListener('click', share);
  $('#pl-download').addEventListener('click', downloadGame);
  $('#pl-remix').addEventListener('click', () => $('#pl-side').classList.toggle('open'));
  document.addEventListener('keydown', (e) => {
    if ($('#player').hidden) return;
    if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.preventDefault(); closeGame(); }
    if ((e.key === 'p' || e.key === 'P') && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) $('#pl-pause').click();
  });
  window.addEventListener('popstate', fromHash);
  fromHash();
  Object.assign(window.massless, { GALLERY, generate, openGallery, openRecipe, openGame, closeGame, share, downloadGame, encodeRecipe, decodeRecipe, buildStandalone, current: () => state.current });
}

init();
