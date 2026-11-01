// Office > Slides: describe a pitch and get a designed deck, edit it in place, present it, share and export it.
// Loaded on first use by pages/office.js. The deck lives in localStorage (autosave) and, when saved, in the
// shared IndexedDB library; uploaded and generated images live in IndexedDB as slide-asset records.

import { el, toast, download } from '../ui.js';
import * as store from '../store.js';
import { flux, zipStore, slug, toBlob } from '../make/kit.js';
import { LAYOUTS, LAYOUT_IDS, TONES, TRANSITIONS, ANIMS, newSlide, changeLayout, sanitizeDeck, sanitizeSlide, imageSlots, getIn, setIn, fieldType, plain, uid, SLIDE_W, SLIDE_H } from './spec.js';
import { THEMES, themeById, palette, themeFaces, woff2URL, woffURL, faceFor } from './themes.js';
import { renderSlide } from './render.js';
import { deckRuntime } from './runtime.js';
import { writeDeck, KINDS, SURPRISES } from './writer.js';
import { TEMPLATES, templateDeck } from './templates.js';
import { shareUrl, decodeDeck, localImageCount } from './share.js';
import { CDN, extractScene, drawScene, buildPdf, buildPptx, buildHtml, withoutFontFaces, facesUsed, loadImg } from './export.js';

const RT = deckRuntime();
const LS = { deck: (id) => `chucksi-slides:deck:${id}`, recent: 'chucksi-slides:recent', current: 'chucksi-slides:current' };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } };
const ic = (d, cls = '') => `<svg viewBox="0 0 16 16" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${d}</svg>`;
const I = {
  undo: '<path d="M5.5 3L2.5 6l3 3"/><path d="M2.5 6h7a4 4 0 010 8H7"/>',
  redo: '<path d="M10.5 3l3 3-3 3"/><path d="M13.5 6h-7a4 4 0 000 8H9"/>',
  add: '<path d="M8 3v10M3 8h10"/>',
  dup: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.5A1 1 0 014 2.5h7"/>',
  del: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9"/>',
  play: '<path d="M5 3.2v9.6L12.5 8z"/>',
  present: '<rect x="2" y="2.5" width="12" height="8.5" rx="1"/><path d="M8 11v2.5M5.5 13.5h5"/>',
  share: '<path d="M8 2v8M5 4.8L8 2l3 2.8M3.5 8.5v5h9v-5"/>',
  save: '<path d="M3 2.5h8l2 2v9H3z"/><path d="M5.5 2.5v3.5h5V2.5M5.5 13.5V9.5h5v4"/>',
  img: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 11l3.5-3 3 2.5 2-1.8L14 11.5"/><circle cx="10.5" cy="6" r="1.2"/>',
  up: '<path d="M8 13V3M4 7l4-4 4 4"/>',
  spark: '<path d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z"/>',
  left: '<path d="M10 3L5 8l5 5"/>', right: '<path d="M6 3l5 5-5 5"/>',
};
const LAYOUT_ICON = {
  title: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M4 9.5h5M4 11h3"/>',
  statement: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M4 6.5h8M4 8.5h6"/>',
  bignumber: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M4.5 6v4M6.5 6h2v2h-2v2h2"/>',
  imagetext: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M9 3v10M3.5 6.5h4M3.5 8.5h3"/>',
  twocol: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M8 5.5v6M3.5 7h3M9.5 7h3"/>',
  agenda: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6.5 6h5M6.5 8h5M6.5 10h5M4 6h.5M4 8h.5M4 10h.5"/>',
  quote: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M4.5 6.5h1.5v1.5l-1 1.5M7.5 6.5H9v1.5l-1 1.5"/>',
  timeline: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M3.5 8h9"/><circle cx="5" cy="8" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="11" cy="8" r=".8"/>',
  team: '<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="7" r="1.3"/><circle cx="10.5" cy="7" r="1.3"/><path d="M4 10.5h3M9 10.5h3"/>',
  pricing: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M4 5.5v6M8 5.5v6M12 5.5v6"/>',
  chart: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M5 11V8.5M8 11V6.5M11 11V5"/>',
  gallery: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10M10 3v10"/>',
  closing: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M5 7h6M6.5 9.5h3"/>',
};

const state = {
  deck: null, sel: 0, undo: [], redo: [], panel: 'write', kind: '', count: 10,
  urls: new Map(), busy: false, editing: null, savedAt: 0, dirty: false,
};
let root, ui = {}, opts = {};
const $ = (s, r = document) => r.querySelector(s);

// ======================================================================
// assets (uploaded and generated images, IndexedDB)
// ======================================================================
async function putAsset(blob) {
  const id = crypto.randomUUID ? crypto.randomUUID() : uid('a');
  await store.put({ id: `slide-asset:${id}`, kind: 'slide-asset', created: Date.now(), file: blob });
  state.urls.set(`asset:${id}`, URL.createObjectURL(blob));
  return `asset:${id}`;
}
async function loadAssets(deck) {
  const want = JSON.stringify(deck).match(/asset:[\w-]+/g) || [];
  let added = 0;
  for (const src of new Set(want)) {
    if (state.urls.has(src)) continue;
    try {
      const rec = await store.get(`slide-asset:${src.slice(6)}`);
      if (rec?.file) { state.urls.set(src, URL.createObjectURL(rec.file)); added++; }
    } catch { /* private mode */ }
  }
  return added;
}
const resolve = (src) => (src && src.startsWith('asset:') ? state.urls.get(src) || '' : src);
async function shrink(blob, max = 2200) {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && blob.size < 1.5e6) return blob;
    const c = el('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await toBlob(c, 'image/jpeg', 0.9);
  } catch { return blob; }
}

// ======================================================================
// deck state, undo, autosave
// ======================================================================
const cur = () => state.deck.slides[state.sel];
const snap = () => JSON.stringify({ deck: state.deck, sel: state.sel });
function pushUndo() {
  state.undo.push(snap());
  if (state.undo.length > 120) state.undo.shift();
  state.redo = [];
  syncHistory();
}
function restore(s) {
  const o = JSON.parse(s);
  state.deck = o.deck;
  state.sel = Math.min(o.sel, state.deck.slides.length - 1);
  renderAll();
  save();
}
function undo() { if (!state.undo.length) return; finishEdit(); state.redo.push(snap()); restore(state.undo.pop()); syncHistory(); }
function redo() { if (!state.redo.length) return; finishEdit(); state.undo.push(snap()); restore(state.redo.pop()); syncHistory(); }
function syncHistory() {
  if (!ui.undo) return;
  ui.undo.disabled = !state.undo.length;
  ui.redo.disabled = !state.redo.length;
}
let saveT = 0;
function save(now = false) {
  state.dirty = true;
  clearTimeout(saveT);
  const go = () => {
    const d = state.deck;
    d.title = d.title || 'Untitled deck';
    lsSet(LS.deck(d.id), JSON.stringify(d));
    lsSet(LS.current, d.id);
    const list = recent().filter((r) => r.id !== d.id);
    list.unshift({ id: d.id, title: plain(d.title), theme: d.theme, n: d.slides.length, updated: Date.now() });
    for (const old of list.slice(12)) lsDel(LS.deck(old.id));
    lsSet(LS.recent, JSON.stringify(list.slice(0, 12)));
    state.savedAt = Date.now();
    if (ui.saved) ui.saved.textContent = 'Saved';
    if (state.panel === 'write') renderRecent();
  };
  if (now) go(); else saveT = setTimeout(go, 500);
}
function recent() { try { return JSON.parse(lsGet(LS.recent) || '[]').filter((r) => r && r.id); } catch { return []; } }

/** Replace the open deck (the old one stays in Your decks). */
async function openDeck(deck, { sel = 0, keepHistory = false, quiet = false } = {}) {
  finishEdit();
  if (state.deck && !keepHistory) save(true);
  state.deck = sanitizeDeck(deck);
  state.sel = Math.max(0, Math.min(sel, state.deck.slides.length - 1));
  if (!keepHistory) { state.undo = []; state.redo = []; }
  syncHistory();
  renderAll();
  save(true);
  if (await loadAssets(state.deck)) renderAll();
  if (!quiet) playCurrent();
}

// ======================================================================
// rendering
// ======================================================================
function renderAll() {
  if (!root) return;
  ui.name.value = plain(state.deck.title);
  renderCanvas();
  renderStrip();
  renderPanel();
}
function slideHTML(i, edit) {
  const d = state.deck;
  return renderSlide(d.slides[i], d, { index: i, total: d.slides.length, edit, resolve, lazy: !edit });
}
function renderCanvas() {
  ui.stack.innerHTML = slideHTML(state.sel, true);
  const s = ui.stack.firstElementChild;
  s.querySelectorAll('[data-k]').forEach((n) => { n.tabIndex = 0; n.setAttribute('role', 'textbox'); n.setAttribute('aria-label', n.dataset.ph || 'Text'); });
  s.querySelectorAll('[data-img]').forEach((n) => { n.tabIndex = 0; n.setAttribute('role', 'button'); n.setAttribute('aria-label', 'Image: upload, generate or remove'); });
  fitCanvas();
  ui.count.textContent = `${state.sel + 1} / ${state.deck.slides.length}`;
}
function fitCanvas() {
  if (!ui.wrap) return;
  const r = ui.wrap.getBoundingClientRect();
  const k = Math.min(r.width / SLIDE_W, r.height / SLIDE_H) || 0.5;
  ui.fit.style.transform = `translate(-50%, -50%) scale(${k})`;
  ui.k = k;
}
function thumb(i) {
  const li = el('li', { class: `sd-th${i === state.sel ? ' on' : ''}`, 'data-i': i, tabindex: i === state.sel ? 0 : -1, role: 'option', 'aria-selected': String(i === state.sel), 'aria-label': `Slide ${i + 1}: ${LAYOUTS[state.deck.slides[i].layout].name}, ${plain(state.deck.slides[i].title || state.deck.slides[i].quote || state.deck.slides[i].value || '')}` });
  li.innerHTML = `<span class="sd-no">${i + 1}</span><div class="sd-mini"><div class="sd-mini-in">${slideHTML(i, false)}</div></div>`;
  return li;
}
function renderStrip() {
  ui.strip.replaceChildren(...state.deck.slides.map((_, i) => thumb(i)), el('li', { class: 'sd-th add', role: 'presentation' }, el('button', { type: 'button', class: 'sd-addtile', 'aria-label': 'Add a slide', html: `${ic(I.add)}<span>Add</span>`, onclick: (e) => openAddMenu(e.currentTarget) })));
  ui.strip.querySelector('.sd-th.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
let thumbT = 0;
function refreshThumb(i = state.sel) {
  clearTimeout(thumbT);
  thumbT = setTimeout(() => {
    const old = ui.strip.querySelector(`.sd-th[data-i="${i}"]`);
    if (old) old.replaceWith(thumb(i));
  }, 120);
}
function select(i, play = true) {
  finishEdit();
  state.sel = Math.max(0, Math.min(i, state.deck.slides.length - 1));
  renderCanvas();
  ui.strip.querySelectorAll('.sd-th[data-i]').forEach((t) => {
    const on = Number(t.dataset.i) === state.sel;
    t.classList.toggle('on', on);
    t.tabIndex = on ? 0 : -1;
    t.setAttribute('aria-selected', String(on));
    if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  if (state.panel === 'slide') renderPanel();
  if (play) playCurrent();
}
function playCurrent() {
  const s = ui.stack?.firstElementChild;
  if (s && !state.editing) RT.playIn(s);
}
/** Builder preview: the transition from the previous slide, then the entrance. */
async function preview() {
  finishEdit();
  const i = state.sel;
  if (i === 0) { renderCanvas(); playCurrent(); return; }
  ui.stack.innerHTML = slideHTML(i - 1, false) + slideHTML(i, false);
  const [a, b] = ui.stack.children;
  b.hidden = true;
  await new Promise((r) => setTimeout(r, 250));
  const kind = b.dataset.tr || 'fade';
  await RT.transition(a, b, kind, 1);
  const d = RT.playAfter(b, kind);
  setTimeout(() => { if (state.sel === i && !state.editing) { renderCanvas(); } }, Math.max(400, d + 200));
}

// ======================================================================
// in-place text editing
// ======================================================================
function startEdit(n) {
  if (state.editing?.n === n) return;
  finishEdit();
  const path = n.dataset.k;
  const slide = cur();
  const type = fieldType(slide, path);
  const raw = getIn(slide, path);
  const before = snap();
  RT.settle(ui.stack.firstElementChild);
  n.classList.add('editing');
  n.textContent = Array.isArray(raw) ? raw.join('\n') : String(raw ?? '');
  try { n.contentEditable = 'plaintext-only'; } catch { /* old engines */ }
  if (n.contentEditable !== 'plaintext-only') n.contentEditable = 'true';
  n.spellcheck = true;
  n.focus();
  const range = document.createRange();
  range.selectNodeContents(n);
  range.collapse(false);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(range);
  state.editing = { n, path, type, before };
  ui.hint.hidden = false;
  ui.hint.textContent = type === 'list' ? 'One item per line. Esc to finish.' : type === 'para' ? 'Wrap words in *stars* to highlight them. Esc to finish.' : 'Wrap words in *stars* to highlight them. Enter to finish.';
}
function readEdit() {
  const e = state.editing;
  if (!e) return;
  const text = e.n.innerText.replace(/\r/g, '').replace(/\n$/, '');
  let v = e.type === 'list' ? text.split('\n').map((x) => x.trim()).filter(Boolean) : e.type === 'text' ? text.replace(/\s*\n\s*/g, ' ') : text;
  setIn(cur(), e.path, v);
}
function finishEdit() {
  const e = state.editing;
  if (!e) return;
  state.editing = null;
  readEdit();
  ui.hint.hidden = true;
  const after = snap();
  if (after !== e.before) {
    state.undo.push(e.before);
    if (state.undo.length > 120) state.undo.shift();
    state.redo = [];
    syncHistory();
    // keep the spec clean (limits, list shape) without changing ids
    state.deck.slides[state.sel] = sanitizeSlide(cur(), new Set());
    if (e.path === 'title' && state.sel === 0 && /^Untitled/.test(state.deck.title)) state.deck.title = plain(cur().title);
    save();
  }
  renderCanvas();
  refreshThumb();
}

// ======================================================================
// slide operations
// ======================================================================
function mutate(fn, { select: to, full = true } = {}) {
  finishEdit();
  pushUndo();
  fn(state.deck);
  state.deck = sanitizeDeck(state.deck);
  if (to != null) state.sel = Math.max(0, Math.min(to, state.deck.slides.length - 1));
  state.sel = Math.min(state.sel, state.deck.slides.length - 1);
  if (full) { renderCanvas(); renderStrip(); } else { renderCanvas(); refreshThumb(); }
  renderPanel();
  save();
}
function addSlide(layout) {
  const s = newSlide(layout);
  mutate((d) => d.slides.splice(state.sel + 1, 0, s), { select: state.sel + 1 });
  playCurrent();
}
function duplicate() {
  const copy = JSON.parse(JSON.stringify(cur()));
  copy.id = uid('s');
  mutate((d) => d.slides.splice(state.sel + 1, 0, copy), { select: state.sel + 1 });
}
function remove() {
  if (state.deck.slides.length <= 1) { toast('A deck needs at least one slide.', 'error'); return; }
  mutate((d) => d.slides.splice(state.sel, 1), { select: Math.max(0, state.sel - (state.sel === state.deck.slides.length - 1 ? 1 : 0)) });
}
function move(from, to) {
  if (to < 0 || to >= state.deck.slides.length || from === to) return;
  mutate((d) => { const [s] = d.slides.splice(from, 1); d.slides.splice(to, 0, s); }, { select: to });
}
function setSlide(fn, full = false) { mutate(() => fn(cur()), { full }); }

// ======================================================================
// images
// ======================================================================
let imgPath = null;
function openImageMenu(n, path) {
  finishEdit();
  imgPath = path;
  const m = ui.imgmenu;
  const im = getIn(cur(), path) || {};
  m.querySelector('[data-im="remove"]').hidden = !im.src;
  m.querySelector('[data-im="focus"]').hidden = !im.src;
  m.hidden = false;
  const r = n.getBoundingClientRect(), w = ui.view.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left - w.left + r.width / 2 - m.offsetWidth / 2, w.width - m.offsetWidth - 8));
  const top = Math.max(8, r.top - w.top + Math.min(r.height / 2, 120) - m.offsetHeight / 2);
  m.style.left = `${left}px`;
  m.style.top = `${top}px`;
  m.querySelector('button:not([hidden])').focus();
}
function closeImageMenu() { ui.imgmenu.hidden = true; }
async function setImage(path, blob, extra = {}) {
  const src = await putAsset(await shrink(blob));
  setSlide((s) => { const im = getIn(s, path) || {}; setIn(s, path, { ...im, src, ...extra }); });
}
function slotSize(path) {
  const n = ui.stack.querySelector(`[data-img="${path}"]`);
  const box = n?.closest('.media') || n;
  const r = box ? box.getBoundingClientRect() : { width: 16, height: 9 };
  const ratio = r.width / r.height || 16 / 9;
  const long = 1024;
  return ratio >= 1 ? [long, Math.round(long / ratio / 16) * 16] : [Math.round((long * ratio) / 16) * 16, long];
}
async function generate(path, prompt) {
  const [w, h] = slotSize(path);
  const seed = Math.floor(Math.random() * 2 ** 31);
  const label = ui.genGo;
  label.disabled = true;
  label.textContent = 'Generating…';
  try {
    const image = await flux({ prompt, w, h, seed });
    const c = el('canvas');
    c.width = image.width; c.height = image.height;
    c.getContext('2d').drawImage(image, 0, 0);
    await setImage(path, await toBlob(c, 'image/jpeg', 0.9), { prompt, alt: prompt.slice(0, 120) });
    ui.gen.close();
    toast('Image added.');
  } catch (e) {
    toast(e.message || 'Could not generate an image right now.', 'error');
  } finally {
    label.disabled = false;
    label.textContent = 'Generate';
  }
}
function openGenerate(path) {
  imgPath = path;
  const s = cur();
  const im = getIn(s, path) || {};
  ui.genPrompt.value = im.prompt || `${plain(s.title || s.quote || state.deck.title)}, editorial photograph, natural light`;
  ui.gen.showModal();
  ui.genPrompt.focus();
}
/** Image files dropped on the stage go into the slot under the pointer, or the first slot on the slide. */
export async function handleFiles(files, at) {
  const img = [...files].find((f) => /^image\//.test(f.type));
  if (!img) { toast('Drop an image to place it on the slide.', 'error'); return; }
  let path = null;
  if (at) { const n = document.elementFromPoint(at.x, at.y)?.closest?.('[data-img]'); if (n && ui.stack.contains(n)) path = n.dataset.img; }
  if (!path) path = (imageSlots(cur()).find(([, v]) => !v?.src) || imageSlots(cur())[0] || [])[0];
  if (!path) { toast('This layout has no image. Try Image + text, Title or Gallery.', 'error'); return; }
  await setImage(path, img);
  toast('Image placed.');
}

// ======================================================================
// filmstrip: select, drag to reorder, keyboard
// ======================================================================
function bindStrip() {
  let drag = null;
  ui.strip.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('.sd-th[data-i]');
    if (!li || e.button !== 0) return;
    const i = Number(li.dataset.i);
    drag = { i, li, x: e.clientX, y: e.clientY, on: false, id: e.pointerId, touch: e.pointerType !== 'mouse', t: setTimeout(() => { if (drag && !drag.on && drag.touch) begin(); }, 380) };
  });
  const begin = () => {
    drag.on = true;
    drag.li.classList.add('dragging');
    ui.strip.classList.add('reordering');
    drag.mark = el('i', { class: 'sd-mark', 'aria-hidden': 'true' });
    ui.strip.append(drag.mark);
    try { ui.strip.setPointerCapture(drag.id); } catch { /* fine */ }
  };
  ui.strip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (drag.touch) { if (Math.hypot(dx, dy) > 8) { clearTimeout(drag.t); drag = null; } return; }
      if (Math.hypot(dx, dy) < 6) return;
      begin();
    }
    e.preventDefault();
    drag.li.style.transform = `translate(${dx}px, ${Math.max(-12, Math.min(12, dy))}px)`;
    const ths = [...ui.strip.querySelectorAll('.sd-th[data-i]')].filter((t) => t !== drag.li);
    let to = ths.length;
    for (const [k, t] of ths.entries()) { const r = t.getBoundingClientRect(); if (e.clientX < r.left + r.width / 2) { to = k; break; } }
    drag.to = to;
    const ref = ths[to] || ths[ths.length - 1];
    const sr = ui.strip.getBoundingClientRect(), rr = ref.getBoundingClientRect();
    drag.mark.style.left = `${(ths[to] ? rr.left - 6 : rr.right + 4) - sr.left + ui.strip.scrollLeft}px`;
    const edge = 40;
    if (e.clientX < sr.left + edge) ui.strip.scrollLeft -= 12; else if (e.clientX > sr.right - edge) ui.strip.scrollLeft += 12;
  });
  const end = () => {
    if (!drag) return;
    clearTimeout(drag.t);
    const d = drag;
    drag = null;
    if (!d.on) { if (d.i !== state.sel) select(d.i); return; }
    d.li.classList.remove('dragging');
    d.li.style.transform = '';
    d.mark?.remove();
    ui.strip.classList.remove('reordering');
    if (d.to != null && d.to !== d.i) move(d.i, d.to); else renderStrip();
  };
  ui.strip.addEventListener('pointerup', end);
  ui.strip.addEventListener('pointercancel', () => { if (drag?.on) { drag.li.classList.remove('dragging'); drag.li.style.transform = ''; drag.mark?.remove(); ui.strip.classList.remove('reordering'); } clearTimeout(drag?.t); drag = null; });
  ui.strip.addEventListener('contextmenu', (e) => { if (e.target.closest('.sd-th')) e.preventDefault(); });
  ui.strip.addEventListener('keydown', (e) => {
    const li = e.target.closest('.sd-th[data-i]');
    if (!li) return;
    const i = Number(li.dataset.i);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); if (e.altKey) move(i, i + 1); else select(i + 1); focusThumb(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); if (e.altKey) move(i, i - 1); else select(i - 1); focusThumb(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); focusThumb(); }
    else if (e.key === 'Enter') { e.preventDefault(); ui.stack.querySelector('[data-k]')?.focus(); }
  });
}
const focusThumb = () => ui.strip.querySelector('.sd-th.on')?.focus();

// ======================================================================
// side panels
// ======================================================================
function renderPanel() {
  if (!opts.side) return;
  for (const p of ['write', 'design', 'slide']) {
    opts.side.querySelector(`[data-sp="${p}"]`).setAttribute('aria-selected', String(p === state.panel));
    opts.side.querySelector(`#sp-${p}`).hidden = p !== state.panel;
  }
  if (state.panel === 'write') renderWrite();
  if (state.panel === 'design') renderDesign();
  if (state.panel === 'slide') renderSlidePanel();
}
const seg = (label, items, value, onPick, cls = '') => el('div', { class: `field sd-seg ${cls}` },
  el('div', { class: 'f-head' }, el('span', {}, label)),
  el('div', { class: 'groups', role: 'radiogroup', 'aria-label': label }, ...Object.entries(items).map(([k, v]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(k === value), 'aria-selected': String(k === value), onclick: () => onPick(k) }, v))));

function renderWrite() {
  const box = opts.side.querySelector('#sp-write');
  const kind = state.kind;
  const ta = el('textarea', { id: 'sd-brief', rows: 5, maxlength: 600, 'aria-label': 'Describe your deck', placeholder: (KINDS[kind] || KINDS.pitch).example });
  ta.value = state.brief || '';
  ta.addEventListener('input', () => { state.brief = ta.value; out.textContent = `${ta.value.length} / 600`; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); write(); } });
  const out = el('output', {}, `${(state.brief || '').length} / 600`);
  const count = el('input', { type: 'range', min: 8, max: 12, step: 1, value: state.count, 'aria-label': 'Number of slides' });
  const cOut = el('output', {}, `${state.count} slides`);
  count.addEventListener('input', () => { state.count = Number(count.value); cOut.textContent = `${state.count} slides`; });
  box.replaceChildren(
    el('div', { class: 'field' }, el('div', { class: 'f-head' }, el('span', {}, 'Describe your deck'), out), ta),
    seg('Kind', { '': 'Auto', ...Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.name])) }, kind, (k) => { state.kind = k; renderWrite(); }),
    el('div', { class: 'field' }, el('div', { class: 'f-head' }, el('span', {}, 'Length'), cOut), count),
    el('div', { class: 'sd-row' },
      el('button', { type: 'button', class: 'btn-accent', id: 'sd-write', onclick: write, html: `${ic(I.spark)}Write my deck` }),
      el('button', { type: 'button', class: 'btn-ghost', id: 'sd-surprise', onclick: surprise }, 'Surprise me')),
    el('p', { class: 'side-note' }, 'Written from your description.'),
    el('h3', { class: 'sd-h' }, 'Templates'),
    el('div', { class: 'sd-tpls' }, ...TEMPLATES.map((t) => {
      const d = templateDeck(t.id);
      return el('button', { type: 'button', class: 'sd-tpl', 'data-tpl': t.id, onclick: () => { openDeck(templateDeck(t.id)); toast(`${t.name} template opened. Your previous deck is in Your decks.`); }, 'aria-label': `${t.name} template: ${t.blurb}` },
        el('span', { class: 'sd-tpl-mini', html: `<span class="sd-mini-in">${renderSlide(d.slides[0], d, { index: 0, total: d.slides.length, lazy: true })}</span>` }),
        el('strong', {}, t.name), el('small', {}, t.blurb));
    })),
    el('h3', { class: 'sd-h' }, 'Your decks'),
    el('ol', { class: 'sd-recent', id: 'sd-recent' }),
  );
  renderRecent();
}
async function renderRecent() {
  const box = opts.side?.querySelector('#sd-recent');
  if (!box) return;
  let lib = [];
  try { lib = (await store.all()).filter((x) => x.kind === 'deck'); } catch { /* private mode */ }
  const rows = new Map();
  for (const r of recent()) rows.set(r.id, { ...r, local: true });
  for (const l of lib) { const id = l.spec?.id; if (id && !rows.has(id)) rows.set(id, { id, title: l.name, theme: l.spec.theme, n: l.spec.slides?.length, updated: l.updated || l.created, lib: l.id }); else if (id) rows.get(id).lib = l.id; }
  const list = [...rows.values()].sort((a, b) => b.updated - a.updated).slice(0, 12);
  if (!list.length) { box.replaceChildren(el('li', { class: 'side-note' }, 'Decks you write or open appear here.')); return; }
  box.replaceChildren(...list.map((r) => {
    const t = themeById(r.theme), p = palette(t);
    const open = el('button', { type: 'button', class: 'sd-rec-open', onclick: () => openSaved(r) },
      el('i', { class: 'sd-sw', style: `background:${p.bg};border-color:${p.accent}` }),
      el('span', {}, el('strong', {}, r.title || 'Untitled deck'), el('small', {}, `${r.n || '?'} slides · ${t.name}${r.lib ? ' · in My library' : ''}${r.id === state.deck.id ? ' · open' : ''}`)));
    const del = el('button', { type: 'button', class: 'sd-rec-del', 'aria-label': `Remove ${r.title}`, title: 'Remove', html: ic(I.del), onclick: async () => {
      if (!confirm(`Remove “${r.title}” from this device${r.lib ? ' and My library' : ''}?`)) return;
      lsDel(LS.deck(r.id));
      lsSet(LS.recent, JSON.stringify(recent().filter((x) => x.id !== r.id)));
      if (r.lib) await store.del(r.lib).catch(() => {});
      renderRecent();
    } });
    return el('li', { class: r.id === state.deck.id ? 'on' : '' }, open, del);
  }));
}
async function openSaved(r) {
  let d = null;
  try { d = JSON.parse(lsGet(LS.deck(r.id)) || 'null'); } catch { d = null; }
  if (!d && r.lib) { try { d = (await store.get(r.lib))?.spec; } catch { d = null; } }
  if (!d) { toast('That deck is no longer on this device.', 'error'); return; }
  if (d.id === state.deck.id) return;
  openDeck(d);
}
function write() {
  const text = (state.brief || '').trim();
  const deck = writeDeck(text || (KINDS[state.kind] || KINDS.pitch).example, { kind: state.kind || undefined, count: state.count });
  openDeck(deck);
  toast(`Wrote ${deck.slides.length} slides in the ${themeById(deck.theme).name} theme. Click any text to edit it.`);
}
function surprise() {
  let pick;
  do { pick = SURPRISES[Math.floor(Math.random() * SURPRISES.length)]; } while (pick === state.brief && SURPRISES.length > 1);
  state.brief = pick;
  state.kind = '';
  const deck = writeDeck(pick, { count: state.count });
  if (Math.random() < 0.4) deck.theme = THEMES[Math.floor(Math.random() * THEMES.length)].id;
  openDeck(deck);
  renderWrite();
}

function renderDesign() {
  const box = opts.side.querySelector('#sp-design');
  const d = state.deck;
  box.replaceChildren(
    el('h3', { class: 'sd-h first' }, 'Theme'),
    el('div', { class: 'sd-themes', role: 'radiogroup', 'aria-label': 'Theme' }, ...THEMES.map((t) => {
      const p = palette(t);
      const b = el('button', { type: 'button', class: 'sd-theme', role: 'radio', 'aria-checked': String(t.id === d.theme), 'data-theme': t.id, title: t.note, onclick: () => setTheme(t.id) },
        el('span', { class: 'sd-theme-sw', style: `background:${p.bg};color:${p.ink}` },
          el('b', { style: `font-family:'${t.display.family}';font-weight:${t.display.weight};text-transform:${t.display.upper ? 'uppercase' : 'none'};letter-spacing:${t.display.tracking}em` }, 'Aa'),
          el('i', { style: `background:${p.accent}` }), el('i', { style: `background:${p.accent2}` })),
        el('strong', {}, t.name), el('small', {}, `${t.display.family} · ${t.body.family}`));
      return b;
    })),
    seg('Transition between slides', TRANSITIONS, d.transition, (k) => mutate((x) => { x.transition = k; }, { full: true })),
    el('label', { class: 'check' }, Object.assign(el('input', { type: 'checkbox', onchange: (e) => mutate((x) => { x.motion = e.target.checked; }, { full: true }) }), { checked: d.motion !== false }), el('span', {}, el('strong', {}, 'Animate entrances'), el('small', {}, 'Text, images, numbers and charts animate in. Off when your device asks for reduced motion.'))),
    el('label', { class: 'check' }, Object.assign(el('input', { type: 'checkbox', onchange: (e) => mutate((x) => { x.footer = e.target.checked; }, { full: true }) }), { checked: d.footer !== false }), el('span', {}, el('strong', {}, 'Footer'), el('small', {}, 'Deck name and slide number on content slides.'))),
  );
}
function setTheme(id) {
  if (state.deck.theme === id) return;
  mutate((d) => { d.theme = id; }, { full: true });
  playCurrent();
}

function renderSlidePanel() {
  const box = opts.side.querySelector('#sp-slide');
  const s = cur();
  const L = LAYOUTS[s.layout];
  const parts = [
    el('div', { class: 'sd-slidehead' }, el('strong', {}, `Slide ${state.sel + 1} of ${state.deck.slides.length}`),
      el('span', { class: 'sd-move' },
        el('button', { type: 'button', class: 'btn-ghost small', 'aria-label': 'Move slide earlier', title: 'Move earlier (Alt+←)', html: ic(I.left), disabled: state.sel === 0, onclick: () => move(state.sel, state.sel - 1) }),
        el('button', { type: 'button', class: 'btn-ghost small', 'aria-label': 'Move slide later', title: 'Move later (Alt+→)', html: ic(I.right), disabled: state.sel === state.deck.slides.length - 1, onclick: () => move(state.sel, state.sel + 1) }))),
    el('h3', { class: 'sd-h' }, 'Layout'),
    el('div', { class: 'sd-layouts', role: 'radiogroup', 'aria-label': 'Layout' }, ...LAYOUT_IDS.map((id) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(id === s.layout), title: LAYOUTS[id].hint, onclick: () => { if (id !== s.layout) { setSlide((x) => Object.assign(x, changeLayout(x, id)), true); playCurrent(); } }, html: `${ic(LAYOUT_ICON[id])}<span>${LAYOUTS[id].name}</span>` }))),
  ];
  if (Object.keys(L.variants).length > 1) parts.push(seg('Style', L.variants, s.variant, (k) => setSlide((x) => { x.variant = k; }, true)));
  parts.push(seg('Background', TONES, s.tone, (k) => setSlide((x) => { x.tone = k; }, true), 'tones'));
  const items = L.fields.items;
  if (items) {
    const n = (s.items || []).length;
    parts.push(el('div', { class: 'field sd-items' }, el('div', { class: 'f-head' }, el('span', {}, s.layout === 'team' ? 'People' : s.layout === 'pricing' ? 'Plans' : s.layout === 'gallery' ? 'Photos' : s.layout === 'bignumber' ? 'Extra figures' : 'Items'), el('output', {}, `${n} of ${items.max}`)),
      el('div', { class: 'sd-row' },
        el('button', { type: 'button', class: 'btn-ghost small', disabled: n === 0, onclick: () => setSlide((x) => { x.items.pop(); }, true) }, 'Remove last'),
        el('button', { type: 'button', class: 'btn-ghost small', disabled: n >= items.max, onclick: () => setSlide((x) => { const tpl = newSlide(x.layout).items?.[0] || {}; x.items.push(JSON.parse(JSON.stringify({ ...tpl, featured: false }))); }, true) }, 'Add one'))));
  }
  if (s.layout === 'pricing' && (s.items || []).length) {
    parts.push(seg('Highlight plan', Object.fromEntries([['-1', 'None'], ...s.items.map((it, i) => [String(i), plain(it.name) || `Plan ${i + 1}`])]), String(s.items.findIndex((it) => it.featured)), (k) => setSlide((x) => { x.items.forEach((it, i) => { it.featured = String(i) === k; }); }, true)));
  }
  const slots = imageSlots(s);
  if (slots.length) {
    parts.push(el('h3', { class: 'sd-h' }, slots.length > 1 ? 'Images' : 'Image'));
    parts.push(el('div', { class: 'sd-slots' }, ...slots.map(([path, im]) => el('div', { class: 'sd-slot' },
      im?.src ? el('img', { src: resolve(im.src), alt: '' }) : el('span', { class: 'sd-slot-empty', html: ic(I.img) }),
      el('span', { class: 'sd-slot-btns' },
        el('button', { type: 'button', class: 'btn-ghost small', onclick: () => { imgPath = path; ui.file.click(); } }, 'Upload'),
        el('button', { type: 'button', class: 'btn-ghost small', onclick: () => openGenerate(path) }, 'Generate'),
        im?.src ? el('button', { type: 'button', class: 'btn-ghost small', 'aria-label': 'Remove image', onclick: () => setSlide((x) => { setIn(x, path, { ...getIn(x, path), src: '' }); }, true) }, 'Remove') : null)))));
  }
  if (s.layout === 'chart') parts.push(chartEditor(s));
  parts.push(seg('Transition in', { '': 'Deck default', ...TRANSITIONS }, s.transition, (k) => setSlide((x) => { x.transition = k; })));
  parts.push(seg('Entrance', ANIMS, s.anim || 'rise', (k) => { setSlide((x) => { x.anim = k === 'rise' ? '' : k; }); playCurrent(); }));
  const notes = el('textarea', { rows: 4, maxlength: 2400, 'aria-label': 'Presenter notes', placeholder: 'What to say on this slide. Only you see these in present mode (press N).' });
  notes.value = s.notes || '';
  let before = null;
  notes.addEventListener('focus', () => { before = snap(); });
  notes.addEventListener('input', () => { cur().notes = notes.value; save(); });
  notes.addEventListener('blur', () => { if (before && before !== snap()) { state.undo.push(before); state.redo = []; syncHistory(); } before = null; });
  parts.push(el('div', { class: 'field' }, el('div', { class: 'f-head' }, el('span', {}, 'Presenter notes')), notes));
  box.replaceChildren(...parts);
}
function chartEditor(s) {
  const c = s.chart;
  const wrap = el('div', { class: 'field sd-chart' });
  const commit = (fn) => setSlide((x) => fn(x.chart), true);
  const head = el('div', { class: 'sd-row' },
    el('div', { class: 'groups', role: 'radiogroup', 'aria-label': 'Chart type' }, ...[['bar', 'Bars'], ['line', 'Line']].map(([k, v]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(c.type === k), 'aria-selected': String(c.type === k), onclick: () => commit((ch) => { ch.type = k; }) }, v))),
    el('label', { class: 'sd-mini-in-l' }, 'Before', Object.assign(el('input', { type: 'text', maxlength: 4, class: 'text-in', 'aria-label': 'Text before each value', onchange: (e) => commit((ch) => { ch.prefix = e.target.value; }) }), { value: c.prefix })),
    el('label', { class: 'sd-mini-in-l' }, 'After', Object.assign(el('input', { type: 'text', maxlength: 6, class: 'text-in', 'aria-label': 'Text after each value', onchange: (e) => commit((ch) => { ch.suffix = e.target.value; }) }), { value: c.suffix })));
  const table = el('table', { class: 'sd-table' });
  const tr = (...cells) => el('tr', {}, ...cells);
  table.append(tr(el('th', {}, 'Label'), ...c.series.map((se, si) => el('th', {}, Object.assign(el('input', { type: 'text', class: 'text-in', maxlength: 40, 'aria-label': `Series ${si + 1} name`, onchange: (e) => commit((ch) => { ch.series[si].name = e.target.value; }) }), { value: se.name }))), el('th', {})));
  c.labels.forEach((lab, i) => table.append(tr(
    el('td', {}, Object.assign(el('input', { type: 'text', class: 'text-in', maxlength: 24, 'aria-label': `Label ${i + 1}`, onchange: (e) => commit((ch) => { ch.labels[i] = e.target.value; }) }), { value: lab })),
    ...c.series.map((se, si) => el('td', {}, Object.assign(el('input', { type: 'number', step: 'any', class: 'text-in', 'aria-label': `${se.name} ${lab}`, onchange: (e) => commit((ch) => { ch.series[si].values[i] = Number(e.target.value) || 0; }) }), { value: se.values[i] }))),
    el('td', {}, el('button', { type: 'button', class: 'sd-x', 'aria-label': `Remove ${lab}`, disabled: c.labels.length <= 1, onclick: () => commit((ch) => { ch.labels.splice(i, 1); ch.series.forEach((se) => se.values.splice(i, 1)); }) }, '×')))));
  wrap.append(el('div', { class: 'f-head' }, el('span', {}, 'Chart data'), el('output', {}, `${c.labels.length} rows`)), head, el('div', { class: 'sd-tablewrap' }, table),
    el('div', { class: 'sd-row' },
      el('button', { type: 'button', class: 'btn-ghost small', disabled: c.labels.length >= 8, onclick: () => commit((ch) => { ch.labels.push(`#${ch.labels.length + 1}`); ch.series.forEach((se) => se.values.push(se.values.at(-1) || 0)); }) }, 'Add row'),
      c.series.length < 2
        ? el('button', { type: 'button', class: 'btn-ghost small', onclick: () => commit((ch) => { ch.series.push({ name: 'Series 2', values: ch.labels.map(() => 0) }); }) }, 'Add series')
        : el('button', { type: 'button', class: 'btn-ghost small', onclick: () => commit((ch) => { ch.series.pop(); }) }, 'Remove series 2')));
  return wrap;
}

function openAddMenu(anchor) {
  finishEdit();
  const m = ui.addmenu;
  m.hidden = !m.hidden;
  if (m.hidden) return;
  const r = anchor.getBoundingClientRect(), w = ui.view.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(r.left - w.left, w.width - m.offsetWidth - 8))}px`;
  m.style.top = `${r.bottom - w.top + 6}px`;
  if (r.bottom - w.top + 6 + m.offsetHeight > w.height) m.style.top = `${Math.max(8, r.top - w.top - m.offsetHeight - 6)}px`;
  m.querySelector('button').focus();
}

// ======================================================================
// present, share, export, library
// ======================================================================
function present(start = state.sel, { fullscreen = true, onEdit = null, editLabel } = {}) {
  finishEdit();
  const d = state.deck;
  const slides = d.slides.map((s, i) => ({ html: renderSlide(s, d, { index: i, total: d.slides.length, resolve }), notes: s.notes }));
  const p = RT.Player(slides, {
    title: plain(d.title), start, accent: palette(d.theme).accent,
    onExit: (i) => { select(i, false); ui.present.focus(); },
    onEdit, editLabel,
  });
  p.mount(document.body, fullscreen);
  state.player = p;
  return p;
}

async function waitImages(host) {
  await Promise.all([...host.querySelectorAll('img')].map((im) => (im.complete && im.naturalWidth ? Promise.resolve() : im.decode().catch(() => {}))));
}
async function loadThemeFonts(theme) {
  await Promise.all(themeFaces(theme).map(([fam, w, st]) => document.fonts.load(`${st} ${w} 40px "${fam}"`).catch(() => {})));
  await document.fonts.ready;
}
/** Render every slide off screen at full size and read each back as a scene. */
async function scenes(onStep) {
  const d = state.deck;
  await loadThemeFonts(d.theme);
  const host = el('div', { class: 'sd-offscreen', 'aria-hidden': 'true' });
  document.body.append(host);
  const out = [];
  try {
    for (const [i, s] of d.slides.entries()) {
      onStep?.(i);
      host.innerHTML = renderSlide(s, d, { index: i, total: d.slides.length, resolve });
      await waitImages(host);
      await new Promise((r) => requestAnimationFrame(() => r()));
      out.push(extractScene(host.firstElementChild));
    }
  } finally { host.remove(); }
  return out;
}
async function cropImage(it, type = 'image/jpeg', scale = 2) {
  const im = await loadImg(it.src);
  const k = Math.min(scale, 2400 / Math.max(it.w, it.h));
  const c = el('canvas');
  c.width = Math.max(1, Math.round(it.w * k)); c.height = Math.max(1, Math.round(it.h * k));
  const g = c.getContext('2d');
  g.drawImage(im, it.sx, it.sy, it.sw, it.sh, 0, 0, c.width, c.height);
  return c;
}
const fontCache = new Map();
async function fontBytes(family, weight, style) {
  const f = faceFor(family, weight, style);
  if (!f) return null;
  const url = woffURL(family, f[2]);
  if (!fontCache.has(url)) fontCache.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b ? new Uint8Array(b) : null)).catch(() => null));
  return fontCache.get(url);
}
let pdfLibP = null;
const loadPdfLib = () => (pdfLibP = pdfLibP || Promise.all([import(CDN.pdfLib), import(CDN.fontkit)]).catch((e) => { pdfLibP = null; throw e; }));
let pptxP = null;
function loadPptx() {
  if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
  return (pptxP = pptxP || new Promise((res, rej) => {
    const s = el('script', { src: CDN.pptx, crossorigin: 'anonymous' });
    s.onload = () => (window.PptxGenJS ? res(window.PptxGenJS) : rej(new Error('PowerPoint writer did not load.')));
    s.onerror = () => { pptxP = null; rej(new Error('Could not load the PowerPoint writer. Check your connection.')); };
    document.head.append(s);
  }));
}
const fileBase = () => slug(plain(state.deck.title)) || 'deck';
async function withBusy(btn, label, fn) {
  if (state.busy) return;
  state.busy = true;
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('busy');
  const set = (t) => { btn.textContent = t; };
  set(label);
  try { return await fn(set); } catch (e) { toast(e.message || 'Export failed.', 'error'); return null; } finally { state.busy = false; btn.disabled = false; btn.classList.remove('busy'); btn.innerHTML = old; }
}
export async function exportPdf(btn = ui.exPdf) {
  return withBusy(btn, 'Preparing…', async (set) => {
    const [lib, fk] = await loadPdfLib();
    const sc = await scenes((i) => set(`Reading slide ${i + 1}…`));
    set('Writing PDF…');
    const { bytes, report } = await buildPdf(sc, lib, {
      fontkit: fk.default || fk, fontBytes, title: plain(state.deck.title),
      imageBytes: async (it) => { try { const c = await cropImage(it); return { bytes: new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.88)).arrayBuffer()), type: 'jpg' }; } catch { return null; } },
    });
    const name = `${fileBase()}.pdf`;
    download(new Blob([bytes], { type: 'application/pdf' }), name);
    toast(report.fallbackWords ? `${name} saved. Some text used Helvetica because a font could not load.` : `${name} saved: ${sc.length} pages with real, selectable text.`);
    return { bytes, pages: sc.length, report };
  });
}
export async function exportPptx(btn = ui.exPptx) {
  return withBusy(btn, 'Preparing…', async (set) => {
    const Pptx = await loadPptx();
    const sc = await scenes((i) => set(`Reading slide ${i + 1}…`));
    set('Writing PowerPoint…');
    const pptx = await buildPptx(sc, state.deck, Pptx, { imageData: async (it) => { try { return (await cropImage(it, 'image/jpeg', 1.5)).toDataURL('image/jpeg', 0.86); } catch { return null; } } });
    const blob = await pptx.write({ outputType: 'blob' });
    const name = `${fileBase()}.pptx`;
    download(blob, name);
    toast(`${name} saved. Text stays editable; install the theme fonts for an exact match.`);
    return blob;
  });
}
const toDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
export async function exportHtml(btn = ui.exHtml) {
  return withBusy(btn, 'Packing…', async () => {
    const d = state.deck;
    const css = withoutFontFaces(await (await fetch('/css/deck.css')).text());
    const faces = themeFaces(d.theme);
    let fontCSS = '';
    for (const [fam, w, st, file] of faces) {
      try { fontCSS += `@font-face{font-family:'${fam}';src:url(${await toDataURL(await (await fetch(woff2URL(file))).blob())}) format('woff2');font-weight:${w};font-style:${st};font-display:block}\n`; } catch { /* system fallback */ }
    }
    const data = new Map();
    const inline = async (src) => {
      if (!src) return '';
      if (!data.has(src)) {
        const url = resolve(src);
        let v = '';
        try { const b = await shrink(await (await fetch(url)).blob(), 1920); v = await toDataURL(b); } catch { v = ''; }
        data.set(src, v);
      }
      return data.get(src);
    };
    for (const s of d.slides) for (const [, im] of imageSlots(s)) if (im?.src) await inline(im.src);
    const slides = d.slides.map((s, i) => ({ html: renderSlide(s, d, { index: i, total: d.slides.length, resolve: (src) => data.get(src) || '' }), notes: s.notes }));
    const html = buildHtml({ title: plain(d.title), slides, css, fontCSS, runtime: deckRuntime.toString(), accent: palette(d.theme).accent });
    const blob = new Blob([html], { type: 'text/html' });
    const name = `${fileBase()}.html`;
    download(blob, name);
    toast(`${name} saved (${Math.round(blob.size / 1024)} KB). Open it in any browser, even offline.`);
    return html;
  });
}
export async function exportPng(btn = ui.exPng) {
  return withBusy(btn, 'Drawing…', async (set) => {
    const sc = await scenes((i) => set(`Reading slide ${i + 1}…`));
    const files = [];
    for (const [i, s] of sc.entries()) {
      set(`Drawing ${i + 1} of ${sc.length}…`);
      const c = el('canvas');
      c.width = 1920; c.height = 1080;
      await drawScene(c.getContext('2d'), s, 1.5);
      files.push({ name: `${fileBase()}-${String(i + 1).padStart(2, '0')}.png`, bytes: new Uint8Array(await (await toBlob(c, 'image/png')).arrayBuffer()) });
    }
    const zip = zipStore(files);
    download(new Blob([zip], { type: 'application/zip' }), `${fileBase()}-slides.zip`);
    toast(`${files.length} PNG slides saved as a zip.`);
    return files.length;
  });
}
async function coverBlob() {
  const host = el('div', { class: 'sd-offscreen', 'aria-hidden': 'true' });
  document.body.append(host);
  try {
    await loadThemeFonts(state.deck.theme);
    host.innerHTML = renderSlide(state.deck.slides[0], state.deck, { index: 0, total: state.deck.slides.length, resolve });
    await waitImages(host);
    const sc = extractScene(host.firstElementChild);
    const c = el('canvas');
    c.width = 960; c.height = 540;
    await drawScene(c.getContext('2d'), sc, 0.75);
    return await toBlob(c, 'image/png');
  } finally { host.remove(); }
}
export async function saveToLibrary(btn = ui.save) {
  return withBusy(btn, 'Saving…', async () => {
    finishEdit();
    const d = state.deck;
    const id = `deck:${d.id}`;
    let created = Date.now();
    try { created = (await store.get(id))?.created || created; } catch { /* new */ }
    const item = { id, kind: 'deck', name: plain(d.title), title: plain(d.title), created, updated: Date.now(), spec: JSON.parse(JSON.stringify(d)), blob: await coverBlob(), engine: 'slides', model: 'Chucksi Slides', prompt: state.brief || '' };
    await store.put(item);
    save(true);
    toast('Saved to My library. Open it again from Your decks or the Library page.');
    renderRecent();
    return item;
  });
}
async function copyShare() {
  finishEdit();
  const url = await shareUrl(state.deck);
  ui.shareOut.value = url;
  const n = localImageCount(state.deck);
  ui.shareNote.textContent = n ? `${n} image${n === 1 ? '' : 's'} you added won’t travel with the link. Export HTML to share everything.` : 'Anyone with the link can open the whole deck.';
  try { await navigator.clipboard.writeText(url); toast('Share link copied.'); } catch { ui.shareOut.select(); toast('Select the link and copy it.'); }
  return url;
}

// ======================================================================
// build the UI
// ======================================================================
function buildView(view) {
  view.replaceChildren();
  const btn = (id, label, icon, onclick, extra = {}) => el('button', { type: 'button', class: 'tbtn', id, title: extra.title || label, 'aria-label': label, onclick, html: `${ic(icon)}<span>${extra.text ?? label}</span>`, ...(extra.attrs || {}) });
  ui.name = el('input', { type: 'text', class: 'sd-name', maxlength: 120, 'aria-label': 'Deck name', spellcheck: 'false' });
  ui.name.addEventListener('change', () => mutate((d) => { d.title = ui.name.value.trim() || 'Untitled deck'; }, { full: true }));
  ui.undo = btn('sd-undo', 'Undo', I.undo, undo, { title: 'Undo (Ctrl+Z)' });
  ui.redo = btn('sd-redo', 'Redo', I.redo, redo, { title: 'Redo (Ctrl+Shift+Z)' });
  ui.add = btn('sd-add', 'Add slide', I.add, (e) => openAddMenu(e.currentTarget), { text: 'Add', attrs: { 'aria-haspopup': 'menu' } });
  ui.dup = btn('sd-dup', 'Duplicate slide', I.dup, duplicate, { text: 'Duplicate' });
  ui.del = btn('sd-del', 'Delete slide', I.del, remove, { text: 'Delete' });
  ui.play = btn('sd-play', 'Preview the transition and animation', I.play, preview, { text: 'Preview' });
  ui.present = btn('sd-present-top', 'Present', I.present, () => present(), { text: 'Present' });
  ui.shareBtn = btn('sd-share', 'Share and export', I.share, () => { ui.share.showModal(); }, { text: 'Share' });
  ui.save = btn('sd-save', 'Save to My library', I.save, () => saveToLibrary(), { text: 'Save' });
  ui.saved = el('span', { class: 'sd-saved', 'aria-live': 'polite' });
  const top = el('div', { class: 'sd-top' },
    el('div', { class: 'sd-title' }, ui.name),
    el('div', { class: 'tools sd-tools', role: 'toolbar', 'aria-label': 'Deck tools' },
      el('div', { class: 'tool-group' }, ui.undo, ui.redo, el('span', { class: 'tsep', 'aria-hidden': 'true' }), ui.add, ui.dup, ui.del),
      el('div', { class: 'tool-group right' }, ui.play, ui.present, ui.shareBtn, ui.save)));
  ui.fit = el('div', { class: 'sd-fit' });
  ui.stack = el('div', { class: 'dk-stack sd-stack' });
  ui.fit.append(ui.stack);
  ui.wrap = el('div', { class: 'sd-canvas', role: 'region', 'aria-label': 'Slide editor' }, ui.fit);
  ui.hint = el('p', { class: 'sd-hint', hidden: true });
  ui.count = el('output', { class: 'sd-count' });
  ui.strip = el('ol', { class: 'sd-strip', role: 'listbox', 'aria-label': 'Slides. Drag to reorder.', 'aria-orientation': 'horizontal' });
  ui.addmenu = el('div', { class: 'sd-menu', role: 'menu', hidden: true, 'aria-label': 'Add a slide' }, ...LAYOUT_IDS.map((id) => el('button', { type: 'button', role: 'menuitem', onclick: () => { ui.addmenu.hidden = true; addSlide(id); }, html: `${ic(LAYOUT_ICON[id])}<span><strong>${LAYOUTS[id].name}</strong><small>${LAYOUTS[id].hint}</small></span>` })));
  ui.imgmenu = el('div', { class: 'sd-menu sd-imgmenu', role: 'menu', hidden: true, 'aria-label': 'Image' },
    el('button', { type: 'button', role: 'menuitem', 'data-im': 'upload', html: `${ic(I.up)}<span><strong>Upload</strong></span>`, onclick: () => { closeImageMenu(); ui.file.click(); } }),
    el('button', { type: 'button', role: 'menuitem', 'data-im': 'generate', html: `${ic(I.spark)}<span><strong>Generate</strong></span>`, onclick: () => { closeImageMenu(); openGenerate(imgPath); } }),
    el('button', { type: 'button', role: 'menuitem', 'data-im': 'focus', html: `${ic('<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.5"/>')}<span><strong>Change focus</strong></span>`, onclick: () => { closeImageMenu(); cycleFocus(imgPath); } }),
    el('button', { type: 'button', role: 'menuitem', 'data-im': 'remove', html: `${ic(I.del)}<span><strong>Remove</strong></span>`, onclick: () => { closeImageMenu(); setSlide((x) => setIn(x, imgPath, { ...getIn(x, imgPath), src: '' }), true); } }));
  ui.file = el('input', { type: 'file', id: 'sd-file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
  ui.file.addEventListener('change', async () => { const f = ui.file.files[0]; ui.file.value = ''; if (f && imgPath) { await setImage(imgPath, f); renderPanel(); toast('Image placed.'); } });
  ui.view = view;
  view.append(top, el('div', { class: 'sd-stagewrap' }, ui.wrap, el('div', { class: 'sd-under' }, ui.count, ui.hint, ui.saved)), ui.strip, ui.addmenu, ui.imgmenu, ui.file);

  // dialogs
  ui.genPrompt = el('textarea', { rows: 3, maxlength: 400, 'aria-label': 'Describe the image' });
  ui.genGo = el('button', { type: 'button', class: 'btn-accent', onclick: () => { const p = ui.genPrompt.value.trim(); if (p) generate(imgPath, p); } }, 'Generate');
  ui.gen = el('dialog', { class: 'sheet sd-sheet', 'aria-label': 'Generate an image' },
    el('form', { method: 'dialog', class: 'sheet-head' }, el('h2', {}, 'Generate an image'), el('button', { class: 'x', 'aria-label': 'Close' }, '×')),
    el('div', { class: 'field' }, el('div', { class: 'f-head' }, el('span', {}, 'Describe the picture')), ui.genPrompt),
    el('div', { class: 'sd-row end' }, ui.genGo),
    el('p', { class: 'small muted' }, 'Free, with a daily limit.'));
  ui.shareOut = el('input', { type: 'text', class: 'text-in', readonly: true, 'aria-label': 'Share link', placeholder: 'Press Copy link' });
  ui.shareNote = el('p', { class: 'small muted' }, 'Anyone with the link can open the whole deck.');
  const exBtn = (id, title, sub, fn) => { const b = el('button', { type: 'button', class: 'sd-ex', id, onclick: () => fn(b) }, el('strong', {}, title), el('small', {}, sub)); return b; };
  ui.exPdf = exBtn('sd-ex-pdf', 'PDF', 'One page per slide, real text in the theme fonts', exportPdf);
  ui.exPptx = exBtn('sd-ex-pptx', 'PowerPoint', '.pptx with editable text, shapes and charts', exportPptx);
  ui.exHtml = exBtn('sd-ex-html', 'HTML player', 'One file with animations, works offline', exportHtml);
  ui.exPng = exBtn('sd-ex-png', 'Images', 'Every slide as a 1920 × 1080 PNG, zipped', exportPng);
  ui.share = el('dialog', { class: 'sheet sd-sheet', 'aria-label': 'Share and export' },
    el('form', { method: 'dialog', class: 'sheet-head' }, el('h2', {}, 'Share & export'), el('button', { class: 'x', 'aria-label': 'Close' }, '×')),
    el('div', { class: 'sd-row' }, ui.shareOut, el('button', { type: 'button', class: 'btn-accent', id: 'sd-copy', onclick: copyShare }, 'Copy link')),
    ui.shareNote,
    el('div', { class: 'sd-exs' }, ui.exPdf, ui.exPptx, ui.exHtml, ui.exPng),
    el('p', { class: 'small muted' }, 'PDF keeps the text real and selectable. PowerPoint opens in PowerPoint, Keynote and Google Slides.'));
  document.body.append(ui.gen, ui.share);
  for (const d of [ui.gen, ui.share]) d.addEventListener('click', (e) => { if (e.target === d) d.close(); });

  // canvas interactions
  ui.wrap.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]');
    if (k && ui.stack.contains(k)) { startEdit(k); return; }
    const im = e.target.closest('[data-img]');
    if (im && ui.stack.contains(im)) { openImageMenu(im, im.dataset.img); return; }
    finishEdit();
  });
  ui.wrap.addEventListener('keydown', (e) => {
    const ed = state.editing;
    if (ed) {
      if (e.key === 'Escape' || (e.key === 'Enter' && (ed.type === 'text' || e.metaKey || e.ctrlKey))) { e.preventDefault(); const path = ed.path; finishEdit(); ui.stack.querySelector(`[data-k="${path}"]`)?.focus({ preventScroll: true }); }
      else if (e.key === 'Tab') { finishEditAndTab(e); }
      return;
    }
    const k = e.target.closest?.('[data-k]');
    if (k && (e.key === 'Enter' || e.key === 'F2')) { e.preventDefault(); startEdit(k); return; }
    const im = e.target.closest?.('[data-img]');
    if (im && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openImageMenu(im, im.dataset.img); }
  });
  ui.wrap.addEventListener('input', () => { readEdit(); refreshThumb(); save(); });
  ui.wrap.addEventListener('focusout', (e) => { if (state.editing && e.target === state.editing.n && !ui.wrap.contains(e.relatedTarget)) finishEdit(); });
  ui.wrap.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  ui.wrap.addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); e.stopPropagation(); handleFiles(e.dataTransfer.files, { x: e.clientX, y: e.clientY }); });
  document.addEventListener('pointerdown', (e) => {
    if (!ui.addmenu.hidden && !ui.addmenu.contains(e.target) && !e.target.closest('#sd-add, .sd-addtile')) ui.addmenu.hidden = true;
    if (!ui.imgmenu.hidden && !ui.imgmenu.contains(e.target) && !e.target.closest('[data-img]')) closeImageMenu();
  });
  for (const m of [ui.addmenu, ui.imgmenu]) m.addEventListener('keydown', (e) => {
    const items = [...m.querySelectorAll('button:not([hidden])')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { m.hidden = true; e.stopPropagation(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  bindStrip();
  new ResizeObserver(fitCanvas).observe(ui.wrap);
}
function finishEditAndTab(e) {
  const fields = [...ui.stack.querySelectorAll('[data-k]')];
  const i = fields.indexOf(state.editing.n);
  const next = fields[i + (e.shiftKey ? -1 : 1)];
  if (!next) { finishEdit(); return; }
  e.preventDefault();
  const path = next.dataset.k;
  finishEdit();
  startEdit(ui.stack.querySelector(`[data-k="${path}"]`));
}
function cycleFocus(path) {
  const stops = [[50, 50], [50, 20], [50, 80], [20, 50], [80, 50]];
  setSlide((x) => {
    const im = getIn(x, path) || {};
    const at = stops.findIndex(([a, b]) => a === (im.x ?? 50) && b === (im.y ?? 50));
    const [nx, ny] = stops[(at + 1) % stops.length];
    setIn(x, path, { ...im, x: nx, y: ny });
  });
  toast('Image focus moved. Press Change focus again to try another crop.');
}

function bindPanelTabs(side) {
  side.querySelectorAll('[data-sp]').forEach((b) => b.addEventListener('click', () => { state.panel = b.dataset.sp; renderPanel(); }));
}
function bindKeys() {
  document.addEventListener('keydown', (e) => {
    if (opts.tab() !== 'slides' || state.player?.el?.isConnected) return;
    const t = e.target;
    const typing = t.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], dialog');
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); }
    else if (mod && e.key.toLowerCase() === 'd' && !typing) { e.preventDefault(); duplicate(); }
    else if (!typing && !mod && (e.key === 'PageDown')) { e.preventDefault(); select(state.sel + 1); }
    else if (!typing && !mod && (e.key === 'PageUp')) { e.preventDefault(); select(state.sel - 1); }
    else if (!typing && e.key === 'F5') { e.preventDefault(); present(e.shiftKey ? state.sel : 0); }
  });
}

/** Mount the builder. o: { view, side, tab() -> current Office tab, setSrc(text) } */
export async function init(o) {
  opts = o;
  root = o.view;
  buildView(o.view);
  bindPanelTabs(o.side);
  bindKeys();
  o.setSrc?.('Slides');
  const p = new URLSearchParams(location.search);
  const hash = location.hash.match(/[#&]d=([\w-]+)/);
  let opened = false;
  if (hash) {
    try {
      const d = await decodeDeck(hash[1]);
      d.id = uid('d');
      history.replaceState(null, '', location.pathname + location.search.replace(/([?&])play=1&?/, '$1').replace(/[?&]$/, ''));
      await openDeck(d, { quiet: true });
      opened = true;
      if (p.get('play') === '1') present(0, { fullscreen: false, onEdit: () => toast('This is your copy now. Edits save automatically.'), editLabel: 'Edit a copy' });
      else toast('Shared deck opened. Edits save automatically.');
    } catch (e) { toast(e.message || 'That link could not be opened.', 'error'); }
  }
  if (!opened && p.get('template') && TEMPLATES.some((t) => t.id === p.get('template'))) { await openDeck(templateDeck(p.get('template'))); opened = true; }
  if (!opened && p.get('deck')) {
    try { const rec = await store.get(p.get('deck')); if (rec?.spec) { await openDeck(rec.spec); opened = true; } } catch { /* gone */ }
  }
  if (!opened && p.get('brief')) { state.brief = p.get('brief').slice(0, 600); await openDeck(writeDeck(state.brief)); opened = true; }
  if (!opened) {
    let d = null;
    const id = lsGet(LS.current);
    if (id) { try { d = JSON.parse(lsGet(LS.deck(id)) || 'null'); } catch { d = null; } }
    await openDeck(d || templateDeck('pitch'), { quiet: !!d });
  }
  renderPanel();
  return api;
}
export const api = {
  get state() { return state; }, openDeck, select, addSlide, duplicate, remove, move, undo, redo, present, setTheme, write, surprise,
  exportPdf, exportPptx, exportHtml, exportPng, saveToLibrary, copyShare, scenes, handleFiles, preview,
  setPanel: (p) => { state.panel = p; renderPanel(); }, onShow: () => { fitCanvas(); playCurrent(); },
};
