// Website: describe a site, get a spec from the built-in writer, edit it live in a real-size
// preview, export static files. The preview is a same-origin iframe: the editor writes the site into it and
// listens for clicks, so every heading, paragraph, button label and image is editable in place.

import { KINDS, SECTIONS, SECTION_GROUPS, COLLECTIONS, TONES, templateSite, sanitizeSite, newSection, newItem, getIn, setIn, uid, slugify, checklist, isPlaceholder, embedFor, tidySite } from '../website/spec.js';
import { STYLES, PALETTES, FONTS, HEADING_FONTS, BODY_FONTS, themeFor, themeCss, fontsHref, contrastReport, tokens, headingWeight, fontFamily } from '../website/theme.js';
import { TEMPLATES, TEMPLATES_LIST, buildTemplate } from '../website/templates.js';
import { MOTIFS } from '../website/art.js';
import { renderParts, renderSingle, makeContext, usedCollection } from '../website/render.js';
import { renderSection, inline, paras } from '../website/sections.js';
import { BASE_CSS, EDIT_CSS } from '../website/css.js';
import { exportZip, exportSingle, faviconSvg } from '../website/export.js';
import { shareUrl, decodeSite } from '../website/share.js';
import { ICON_NAMES, icon } from '../website/icons.js';
import { shoot } from '../engines.js';
import * as store from '../store.js';
import { bindDialogs, toast, el, download } from '../ui.js';

const $ = (s) => document.querySelector(s);
const frame = $('#preview');
const BPS = { desktop: 1440, tablet: 768, phone: 390 };
const PLAINTEXT = (() => { const d = document.createElement('div'); try { d.contentEditable = 'plaintext-only'; } catch { return false; } return d.contentEditable === 'plaintext-only'; })();
const UI = {
  up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M4 7l4-4 4 4"/></svg>',
  down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M4 9l4 4 4-4"/></svg>',
  dup: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.8c0-.5.3-.8.8-.8h6.7"/></svg>',
  del: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
  eye: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>',
  layout: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 7h11M7 7v6.5"/></svg>',
};

const state = {
  site: null, id: null, created: 0, assets: new Map(),
  pageId: null, view: null, sel: null, bp: 'desktop',
  past: [], future: [], lastKey: '', lastAt: 0,
  kind: 'business', style: 'friendly', styleTouched: false, source: 'template',
  editing: null, tab: 'create', cmsCol: 'posts', open: new Set(),
  frameReady: false, template: null, insertAfter: null, imgPath: null, imgRatio: 4 / 3, busy: false, fillCtl: null, replaying: false, demo: false,
};

// ---------------------------------------------------------------------------------------------
// Assets (uploaded and generated media live in this browser only)
// ---------------------------------------------------------------------------------------------

function assetUrl(ref) {
  if (!ref) return '';
  if (ref.startsWith('asset:')) return state.assets.get(ref.slice(6))?.url || '';
  if (/^\/media\//.test(ref)) return ref;
  return '';
}
async function addAsset(blob, meta = {}) {
  const id = uid('a');
  let { w, h } = meta;
  if (!w && blob.type.startsWith('image/') && blob.type !== 'image/svg+xml') {
    try { const b = await createImageBitmap(blob); w = b.width; h = b.height; b.close?.(); } catch { /* unknown size */ }
  }
  state.assets.set(id, { blob, url: URL.createObjectURL(blob), w, h, type: blob.type, name: meta.name || '' });
  return `asset:${id}`;
}
async function imageFileToBlob(file) {
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') return file;
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return await new Promise((r) => c.toBlob(r, type, 0.88));
}
const previewOpts = {
  mode: 'edit',
  src: (src) => assetUrl(src),
  imgInfo: (src) => { const a = src && src.startsWith('asset:') ? state.assets.get(src.slice(6)) : null; return a ? { w: a.w, h: a.h } : null; },
};

// ---------------------------------------------------------------------------------------------
// Paths: "<sectionId>:items.2.title", "@posts:<itemId>:title", "$:seo.title"
// ---------------------------------------------------------------------------------------------

function parsePath(path) {
  if (path.startsWith('$:')) return { kind: 'site', key: path.slice(2) };
  if (path.startsWith('@')) { const [col, id, ...rest] = path.slice(1).split(':'); return { kind: 'item', col, id, key: rest.join(':') }; }
  const i = path.indexOf(':');
  return { kind: 'sec', sid: path.slice(0, i), key: path.slice(i + 1) };
}
function targetOf(site, p) {
  if (p.kind === 'site') return site;
  if (p.kind === 'item') return (site.collections[p.col] || []).find((x) => x.id === p.id) || null;
  for (const pg of site.pages) { const s = pg.sections.find((x) => x.id === p.sid); if (s) return s; }
  return null;
}
function readPath(path, site = state.site) { const p = parsePath(path); const t = targetOf(site, p); return t ? getIn(t, p.key) : undefined; }
function writePath(site, path, value) {
  const p = parsePath(path);
  const t = targetOf(site, p);
  if (!t) return;
  setIn(t, p.key, value);
  // an item someone has edited is no longer a placeholder (unless it still has [brackets])
  const keys = p.key.split('.');
  let o = t;
  let holder = p.kind === 'item' ? t : null;
  for (let i = 0; i < keys.length - 1; i++) { o = o?.[keys[i]]; if (o && typeof o === 'object' && !Array.isArray(o) && !('src' in o && 'prompt' in o) && !('href' in o && 'label' in o)) holder = o; }
  if (holder && holder.ph && typeof value === 'string' && !isPlaceholder(value)) delete holder.ph;
}
const renderHintFor = (path) => { const p = parsePath(path); return p.kind === 'sec' ? { sid: p.sid } : 'full'; };
function findSection(sid, site = state.site) {
  for (const page of site.pages) { const s = page.sections.find((x) => x.id === sid); if (s) return { page, s }; }
  return null;
}
const currentPage = () => state.site.pages.find((p) => p.id === state.pageId) || state.site.pages[0];

// ---------------------------------------------------------------------------------------------
// History, changes and autosave
// ---------------------------------------------------------------------------------------------

const snapshot = () => JSON.stringify(state.site);
/** Change the site. render: 'full' | 'theme' | 'none' | { sid }. key coalesces typing into one undo step. */
function mutate(fn, { render = 'full', key = '', panels = true } = {}) {
  const before = snapshot();
  fn(state.site);
  const after = snapshot();
  if (before === after) return false;
  const now = Date.now();
  if (!(key && key === state.lastKey && now - state.lastAt < 1600)) {
    state.past.push(before);
    if (state.past.length > 150) state.past.shift();
  }
  state.lastKey = key;
  state.lastAt = now;
  state.future.length = 0;
  state.demo = false;
  changed(render, panels);
  return true;
}
function changed(render, panels) {
  fixView();
  renderPreview(render);
  if (panels === true) renderPanels();
  else if (panels === 'list') { renderSectionList(); renderPageSelect(); }
  updateHistoryButtons();
  scheduleSave();
}
function undo() {
  commitEdit();
  if (!state.past.length) return;
  state.future.push(snapshot());
  state.site = JSON.parse(state.past.pop());
  state.lastKey = '';
  changed('full', true);
}
function redo() {
  commitEdit();
  if (!state.future.length) return;
  state.past.push(snapshot());
  state.site = JSON.parse(state.future.pop());
  state.lastKey = '';
  changed('full', true);
}
function updateHistoryButtons() {
  $('#undo').disabled = !state.past.length;
  $('#redo').disabled = !state.future.length;
}
function fixView() {
  const s = state.site;
  if (!s.pages.some((p) => p.id === state.pageId)) state.pageId = s.pages[0].id;
  if (state.view && !(s.collections[state.view.col] || []).some((x) => x.id === state.view.id)) state.view = null;
  if (state.sel && !findSection(state.sel)) state.sel = null;
}

let saveTimer = 0;
function scheduleSave() {
  if (state.demo) return;
  if (!state.id) { state.id = uid('w'); state.created = Date.now(); }
  clearTimeout(saveTimer);
  $('#saved').textContent = 'Saving…';
  saveTimer = setTimeout(save, 600);
}
async function save() {
  clearTimeout(saveTimer);
  if (!state.id || !state.site) return;
  const refs = state.past.slice(-40).join('') + state.future.join('') + snapshot();
  const assets = {};
  for (const [id, a] of state.assets) if (refs.includes(`asset:${id}`)) assets[id] = { blob: a.blob, w: a.w, h: a.h, type: a.type, name: a.name };
  try {
    await store.put({ id: state.id, kind: 'site', created: state.created, updated: Date.now(), name: state.site.name, spec: state.site, assets });
    $('#saved').textContent = 'Saved';
  } catch (e) {
    $('#saved').textContent = 'Not saved';
    console.warn('Autosave failed', e);
  }
  renderSites();
}

// ---------------------------------------------------------------------------------------------
// The preview frame
// ---------------------------------------------------------------------------------------------

function here() {
  const s = state.site;
  if (state.view) {
    const it = (s.collections[state.view.col] || []).find((x) => x.id === state.view.id);
    if (it) return { kind: 'item', col: state.view.col, item: it, path: `${state.view.col}/${it.slug}/`, key: `${state.view.col}/${it.slug}`, depth: 2, title: it.title };
  }
  const page = currentPage();
  const i = s.pages.indexOf(page);
  return { kind: 'page', page, path: i ? `${page.slug}/` : '', key: i ? page.slug : '', depth: i ? 1 : 0, title: page.title };
}

async function initFrame() {
  await new Promise((resolve) => {
    frame.addEventListener('load', function onload() {
      if (frame.contentDocument?.URL !== 'about:srcdoc') return;
      frame.removeEventListener('load', onload);
      resolve();
    });
    frame.srcdoc = '<!doctype html><html class="editing"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>';
  });
  const doc = frame.contentDocument;
  doc.head.insertAdjacentHTML('beforeend', `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" id="mz-fonts" href=""><style id="mz-theme"></style><style id="mz-base">${BASE_CSS}</style><style id="mz-edit">${EDIT_CSS}</style>`);
  doc.addEventListener('click', onFrameClick, true);
  doc.addEventListener('keydown', onFrameKey);
  doc.addEventListener('focusout', (e) => { if (state.editing && e.target === state.editing.el) commitEdit(); });
  doc.addEventListener('submit', (e) => e.preventDefault(), true);
  doc.addEventListener('paste', (e) => {
    if (state.editing && !PLAINTEXT) { e.preventDefault(); doc.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }
  });
  doc.addEventListener('mouseover', (e) => { const sec = e.target.closest?.('[data-sid]'); if (sec) showBar(sec); });
  doc.addEventListener('dragstart', (e) => e.preventDefault());
  state.frameReady = true;
}

function applyHead(doc) {
  const t = state.site.theme;
  const html = doc.documentElement;
  html.lang = state.site.seo.lang || 'en';
  html.dataset.style = t.style;
  html.dataset.mode = t.mode;
  html.dataset.motion = t.motion;
  if (!state.replaying) { html.classList.add('editing'); html.classList.remove('rv'); }
  const link = doc.getElementById('mz-fonts');
  const href = fontsHref(t);
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  doc.getElementById('mz-theme').textContent = themeCss(t);
}

function sectionContext(h, sec) {
  const c = makeContext(state.site, h, previewOpts);
  const idx = h.page.sections.indexOf(sec);
  c.h1.used = h.page.sections.slice(0, idx).some((x) => x.type === 'hero');
  return c;
}

function renderPreview(hint = 'full') {
  if (!state.frameReady || !state.site || hint === 'none') return;
  const doc = frame.contentDocument;
  const h = here();
  if (hint === 'theme') { applyHead(doc); return; }
  if (hint && typeof hint === 'object' && hint.sid && h.kind === 'page' && !state.replaying) {
    const node = doc.querySelector(`[data-sid="${hint.sid}"]`);
    const sec = h.page.sections.find((x) => x.id === hint.sid);
    if (node && sec) {
      if (state.editing && node.contains(state.editing.el)) return;
      node.outerHTML = renderSection(sec, sectionContext(h, sec));
      markSelection();
      return;
    }
  }
  state.replaying = false;
  applyHead(doc);
  const p = renderParts(state.site, h, previewOpts);
  const win = frame.contentWindow;
  const y = win.scrollY;
  doc.title = p.title;
  doc.body.innerHTML = p.body;
  win.scrollTo(0, y);
  markSelection();
}

function markSelection() {
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.querySelectorAll('.mz-sel').forEach((n) => n.classList.remove('mz-sel'));
  if (state.sel) doc.querySelector(`[data-sid="${state.sel}"]`)?.classList.add('mz-sel');
}

function layoutFrame() {
  const canvas = $('#canvas');
  const wrap = $('#frame-wrap');
  const bw = BPS[state.bp];
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const scale = Math.min(1, (W - 32) / bw);
  wrap.style.width = `${bw}px`;
  wrap.style.height = `${Math.max(240, (H - 32) / scale)}px`;
  wrap.style.transform = `translateX(-50%) scale(${scale})`;
  wrap.classList.toggle('phone', state.bp === 'phone');
}
function setBreakpoint(bp) {
  state.bp = BPS[bp] ? bp : 'desktop';
  document.querySelectorAll('[data-bp]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bp === state.bp)));
  layoutFrame();
}

// the floating section bar inside the preview
let bar = null;
function showBar(secEl) {
  const doc = frame.contentDocument;
  if (state.editing || state.replaying) return;
  if (!bar || bar.ownerDocument !== doc) bar = doc.createElement('div');
  const sid = secEl.dataset.sid;
  const found = findSection(sid);
  if (!found) return;
  if (bar.dataset.sid === sid && bar.isConnected && bar.parentNode === secEl) return;
  const { page, s } = found;
  const i = page.sections.indexOf(s);
  const n = page.sections.length;
  bar.className = 'mz-bar';
  bar.dataset.sid = sid;
  bar.setAttribute('contenteditable', 'false');
  bar.innerHTML = `<b>${SECTIONS[s.type].name}</b><button type="button" data-act="variant" title="Next layout" aria-label="Next layout">${UI.layout}</button><button type="button" data-act="up" title="Move up" aria-label="Move up"${i === 0 ? ' disabled' : ''}>${UI.up}</button><button type="button" data-act="down" title="Move down" aria-label="Move down"${i === n - 1 ? ' disabled' : ''}>${UI.down}</button><button type="button" data-act="dup" title="Duplicate" aria-label="Duplicate">${UI.dup}</button><button type="button" data-act="hide" title="${s.hidden ? 'Show' : 'Hide'}" aria-label="${s.hidden ? 'Show' : 'Hide'}">${UI.eye}</button><button type="button" data-act="del" title="Delete" aria-label="Delete">${UI.del}</button><button type="button" data-act="add" title="Add a section below" aria-label="Add a section below">${UI.plus}</button>`;
  secEl.appendChild(bar);
}

function onFrameClick(e) {
  const t = e.target;
  if (!t.closest) return;
  const b = t.closest('.mz-bar button');
  if (b) { e.preventDefault(); e.stopPropagation(); sectionAction(b.closest('.mz-bar').dataset.sid, b.dataset.act); return; }
  if (state.replaying) { e.preventDefault(); renderPreview('full'); return; }
  if (state.editing && state.editing.el.contains(t)) return;
  const img = t.closest('[data-img]');
  if (img) { e.preventDefault(); selectFrom(img); openImage(img.dataset.img, img); return; }
  const ed = t.closest('[data-edit]');
  if (ed) { e.preventDefault(); selectFrom(ed); startEdit(ed, e); return; }
  const emb = t.closest('[data-embed]');
  if (emb) {
    e.preventDefault();
    const f = frame.contentDocument.createElement('iframe');
    f.src = emb.dataset.embed;
    f.title = emb.dataset.title || 'Embedded content';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    emb.replaceWith(f);
    return;
  }
  const play = t.closest('.tplay');
  if (play) { e.preventDefault(); previewPlay(play); return; }
  const a = t.closest('a[href]');
  if (a) { e.preventDefault(); followLink(a.getAttribute('href')); }
  if (t.closest('button[type="submit"]')) e.preventDefault();
  selectFrom(t);
}

let previewAudio = null;
function previewPlay(btn) {
  if (!previewAudio) previewAudio = new Audio();
  const on = btn.getAttribute('aria-pressed') === 'true';
  frame.contentDocument.querySelectorAll('.tplay[aria-pressed="true"]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
  if (on) { previewAudio.pause(); return; }
  previewAudio.src = btn.dataset.audio;
  previewAudio.play().catch(() => {});
  btn.setAttribute('aria-pressed', 'true');
}

function followLink(href) {
  if (!href || href === '#') return;
  const m = href.match(/^\/([\w-]*)(?:\/([\w-]+))?(?:#([\w-]+))?$/);
  if (m) {
    if (m[2] && COLLECTIONS[m[1]]) {
      const it = (state.site.collections[m[1]] || []).find((x) => x.slug === m[2]);
      if (it) { openItem(m[1], it.id); return; }
    }
    const page = state.site.pages.find((p, i) => (i === 0 ? '' : p.slug) === m[1]);
    if (page) { goPage(page.id, m[3]); return; }
  }
  if (href.startsWith('#')) { scrollToAnchor(href.slice(1)); return; }
  toast('Links to other sites open on your published site.');
}
function scrollToAnchor(a) {
  const n = frame.contentDocument.getElementById(a);
  if (n) frame.contentWindow.scrollTo({ top: n.getBoundingClientRect().top + frame.contentWindow.scrollY - 72, behavior: 'smooth' });
}
function goPage(id, anchor) {
  commitEdit();
  state.view = null;
  state.pageId = id;
  state.sel = null;
  renderPreview('full');
  frame.contentWindow.scrollTo(0, 0);
  if (anchor) setTimeout(() => scrollToAnchor(anchor), 50);
  renderPanels();
}
function openItem(col, id) {
  commitEdit();
  state.view = { col, id };
  state.sel = null;
  renderPreview('full');
  frame.contentWindow.scrollTo(0, 0);
  renderPanels();
}
function selectFrom(node) {
  const sec = node.closest?.('[data-sid]');
  if (sec) select(sec.dataset.sid);
}
function select(sid, { scroll = false } = {}) {
  state.sel = sid;
  markSelection();
  if (state.tab === 'create' || state.tab === 'page') switchTab('page');
  renderPagePanel();
  if (scroll) {
    const n = frame.contentDocument.querySelector(`[data-sid="${sid}"]`);
    if (n) frame.contentWindow.scrollTo({ top: n.getBoundingClientRect().top + frame.contentWindow.scrollY - 20, behavior: 'smooth' });
  }
  document.querySelector(`.ws-sec[data-sid="${sid}"]`)?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------------------------------------
// Inline text editing
// ---------------------------------------------------------------------------------------------

function startEdit(node, ev) {
  commitEdit();
  const path = node.dataset.edit;
  const raw = String(readPath(path) ?? '');
  const doc = node.ownerDocument;
  state.editing = { el: node, path, raw, ml: node.hasAttribute('data-ml') };
  bar?.remove();
  node.removeAttribute('data-empty');
  node.textContent = raw;
  node.style.whiteSpace = 'pre-wrap';
  node.contentEditable = PLAINTEXT ? 'plaintext-only' : 'true';
  node.spellcheck = true;
  node.focus({ preventScroll: true });
  const sel = doc.getSelection();
  let r = null;
  if (ev && doc.caretRangeFromPoint) r = doc.caretRangeFromPoint(ev.clientX, ev.clientY);
  else if (ev && doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(ev.clientX, ev.clientY);
    if (pos) { r = doc.createRange(); r.setStart(pos.offsetNode, pos.offset); }
  }
  sel.removeAllRanges();
  if (r && node.contains(r.startContainer)) sel.addRange(r);
  else { const rr = doc.createRange(); rr.selectNodeContents(node); rr.collapse(false); sel.addRange(rr); }
}

function commitEdit(cancel = false) {
  const ed = state.editing;
  if (!ed) return;
  state.editing = null;
  const { el: node, path, raw, ml } = ed;
  let v = cancel ? raw : ml ? node.innerText : node.textContent;
  v = String(v).replace(/ /g, ' ');
  if (!ml) v = v.replace(/\s*\n\s*/g, ' ');
  v = v.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  node.removeAttribute('contenteditable');
  node.style.whiteSpace = '';
  // show the formatted text in place, so a click on the next field still lands
  node.innerHTML = ml ? paras(v, { edit: true }) : inline(v, { edit: true });
  if (!v) { node.setAttribute('data-empty', ''); if (!node.dataset.ph) node.dataset.ph = 'Add text'; }
  if (v !== raw) mutate((site) => writePath(site, path, v), { render: 'none', key: `edit:${path}` });
  // re-render the section once the editor is idle (avatar initials, empty states)
  const hint = renderHintFor(path);
  setTimeout(() => { if (!state.editing) renderPreview(hint); }, 250);
}

function onFrameKey(e) {
  const ed = state.editing;
  if (ed) {
    if (e.key === 'Escape') { e.preventDefault(); commitEdit(true); return; }
    if (e.key === 'Enter' && !ed.ml && !e.shiftKey) { e.preventDefault(); ed.el.blur(); return; }
    if (e.key === ' ' && ed.el.closest('summary')) { e.preventDefault(); frame.contentDocument.execCommand('insertText', false, ' '); }
    return;
  }
  hotkeys(e);
}
function hotkeys(e) {
  if (!(e.metaKey || e.ctrlKey)) return;
  const tag = (e.target?.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable) return;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if (k === 'y') { e.preventDefault(); redo(); }
}

// ---------------------------------------------------------------------------------------------
// Section and page operations
// ---------------------------------------------------------------------------------------------

function sectionAction(sid, act) {
  commitEdit();
  const found = findSection(sid);
  if (!found) return;
  if (act === 'add') { openAdd(sid); return; }
  if (act === 'del' && found.s.type === 'hero' && found.page.sections.filter((x) => x.type === 'hero').length === 1 && !confirm('Delete the hero? The page needs a title for search engines; one will be added for screen readers.')) return;
  mutate((site) => {
    const { page, s } = findSection(sid, site);
    const i = page.sections.indexOf(s);
    if (act === 'up' && i > 0) page.sections.splice(i - 1, 0, page.sections.splice(i, 1)[0]);
    if (act === 'down' && i < page.sections.length - 1) page.sections.splice(i + 1, 0, page.sections.splice(i, 1)[0]);
    if (act === 'dup') { const c = JSON.parse(JSON.stringify(s)); c.id = uid('s'); delete c.anchor; page.sections.splice(i + 1, 0, c); tidySite(site); state.sel = c.id; }
    if (act === 'del') page.sections.splice(i, 1);
    if (act === 'hide') s.hidden = !s.hidden || undefined;
    if (act === 'variant') { const vs = Object.keys(SECTIONS[s.type].variants); s.variant = vs[(vs.indexOf(s.variant) + 1) % vs.length]; }
  }, { render: act === 'variant' || act === 'hide' ? { sid } : 'full' });
  if (act === 'del' && state.sel === sid) { state.sel = null; renderPanels(); }
  if (act === 'variant') toast(`${SECTIONS[found.s.type].name}: ${SECTIONS[found.s.type].variants[findSection(sid)?.s.variant]} layout`);
}

function openAdd(afterSid = null) {
  commitEdit();
  state.insertAfter = afterSid || state.sel;
  $('#add-dialog').showModal();
}
function addSection(type) {
  let newId = null;
  mutate((site) => {
    const page = site.pages.find((p) => p.id === currentPage().id);
    const s = newSection(type, site);
    newId = s.id;
    if (SECTIONS[type].collection && !(site.collections[SECTIONS[type].collection] || []).length) site.collections[SECTIONS[type].collection] = [0, 1, 2].map(() => newItem(SECTIONS[type].collection));
    let at = page.sections.findIndex((x) => x.id === state.insertAfter);
    if (at === -1) { const f = page.sections.findIndex((x) => x.type === 'footer'); at = f === -1 ? page.sections.length - 1 : f - 1; }
    if (type === 'footer') at = page.sections.length - 1;
    page.sections.splice(at + 1, 0, s);
    tidySite(site);
  });
  $('#add-dialog').close();
  if (newId) select(newId, { scroll: true });
}

function addPage() {
  commitEdit();
  let id = null;
  mutate((site) => {
    const n = site.pages.length + 1;
    const title = `Page ${n}`;
    const hero = newSection('hero', site);
    Object.assign(hero, { variant: 'banner', eyebrow: '', title, subtitle: 'A short line about this page.', cta: { label: '', href: '' }, cta2: { label: '', href: '' } });
    const homeFooter = site.pages[0].sections.find((s) => s.type === 'footer');
    const foot = homeFooter ? { ...JSON.parse(JSON.stringify(homeFooter)), id: uid('s') } : newSection('footer', site);
    const p = { id: uid('p'), slug: slugify(title), title, seo: { title: '', description: '' }, sections: [hero, newSection('about', site), foot] };
    site.pages.push(p);
    id = p.id;
    tidySite(site);
  });
  if (id) goPage(id);
}
function renamePage(pageId, title) {
  mutate((site) => {
    const p = site.pages.find((x) => x.id === pageId);
    if (!p) return;
    p.title = title.slice(0, 40);
    if (site.pages.indexOf(p) === 0) return;
    const old = p.slug;
    let slug = slugify(title) || p.slug;
    if (site.pages.some((x) => x !== p && x.slug === slug)) slug = `${slug}-2`;
    p.slug = slug;
    if (old && old !== slug) {
      const walk = (o) => {
        if (Array.isArray(o)) return o.forEach(walk);
        if (!o || typeof o !== 'object') return;
        if (typeof o.href === 'string') o.href = o.href.replace(new RegExp(`^/${old}(?=$|#)`), `/${slug}`);
        Object.values(o).forEach(walk);
      };
      walk(site.pages);
      walk(site.nav);
    }
  }, { render: 'full', key: `rename:${pageId}`, panels: 'list' });
}
function deletePage(pageId) {
  const s = state.site;
  const i = s.pages.findIndex((p) => p.id === pageId);
  if (i <= 0) return;
  if (!confirm(`Delete the page “${s.pages[i].title}”?`)) return;
  mutate((site) => { site.pages.splice(i, 1); });
  goPage(state.site.pages[Math.max(0, i - 1)].id);
}

// ---------------------------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------------------------

function switchTab(name) {
  state.tab = name;
  for (const t of ['create', 'page', 'theme', 'cms', 'settings']) {
    const on = t === name;
    $(`#t-${t}`).setAttribute('aria-selected', String(on));
    $(`#t-${t}`).tabIndex = on ? 0 : -1;
    $(`#p-${t}`).hidden = !on;
  }
}

function renderPanels() {
  renderPageSelect();
  renderPagePanel();
  renderThemePanel();
  renderCms();
  renderSettings();
  renderFill();
  syncCreate();
}

function renderPageSelect() {
  const sel = $('#page-select');
  const s = state.site;
  sel.replaceChildren(...s.pages.map((p) => el('option', { value: p.id, selected: !state.view && p.id === currentPage().id }, p.title)));
  if (state.view) {
    const it = (s.collections[state.view.col] || []).find((x) => x.id === state.view.id);
    if (it) sel.append(el('option', { value: `@${state.view.col}:${it.id}`, selected: true }, `${COLLECTIONS[state.view.col].singular}: ${it.title}`));
  }
}

function svgBtn(svg, label, on, opts = {}) {
  return el('button', { type: 'button', 'aria-label': label, title: label, html: svg, onclick: on, disabled: opts.disabled || false });
}

function renderPagePanel() {
  const s = state.site;
  const cur = currentPage();
  $('#pagelist').replaceChildren(...s.pages.map((p) => el('li', {}, el('button', { type: 'button', 'aria-current': String(!state.view && p.id === cur.id), onclick: () => goPage(p.id) }, p.title))));
  renderSectionList();
  renderInspector();
}

let dragSid = null;
function renderSectionList() {
  const page = currentPage();
  const list = $('#seclist');
  if (state.view) {
    list.replaceChildren(el('li', { class: 'ws-note' }, `You are viewing a ${COLLECTIONS[state.view.col].singular.toLowerCase()} page. Edit its text in place or in the Content tab.`));
    return;
  }
  const n = page.sections.length;
  list.replaceChildren(...page.sections.map((s, i) => {
    const def = SECTIONS[s.type];
    const li = el('li', { class: `ws-sec${s.id === state.sel ? ' sel' : ''}${s.hidden ? ' hid' : ''}`, 'data-sid': s.id, draggable: 'true' },
      el('span', { class: 'grip', 'aria-hidden': 'true' }, '⋮⋮'),
      el('button', { type: 'button', class: 'pick', onclick: () => select(s.id, { scroll: true }) }, el('strong', {}, def.name), el('small', {}, `${def.variants[s.variant]}${s.hidden ? ' · hidden' : ''}${s.title ? ` · ${String(s.title).replace(/\*/g, '')}` : ''}`)),
      el('span', { class: 'ctl' },
        svgBtn(UI.up, `Move ${def.name} up`, () => sectionAction(s.id, 'up'), { disabled: i === 0 }),
        svgBtn(UI.down, `Move ${def.name} down`, () => sectionAction(s.id, 'down'), { disabled: i === n - 1 }),
        svgBtn(UI.dup, `Duplicate ${def.name}`, () => sectionAction(s.id, 'dup')),
        svgBtn(UI.del, `Delete ${def.name}`, () => sectionAction(s.id, 'del'))));
    li.addEventListener('dragstart', (e) => { dragSid = s.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); });
    li.addEventListener('dragover', (e) => { if (dragSid && dragSid !== s.id) { e.preventDefault(); li.classList.add('drag-over'); } });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      const from = dragSid;
      dragSid = null;
      if (!from || from === s.id) return;
      mutate((site) => {
        const pg = site.pages.find((p) => p.id === page.id);
        const a = pg.sections.findIndex((x) => x.id === from);
        const moved = pg.sections.splice(a, 1)[0];
        const b = pg.sections.findIndex((x) => x.id === s.id);
        pg.sections.splice(a <= b ? b + 1 : b, 0, moved);
      });
    });
    return li;
  }));
}

// generic fields bound to a path
function textField(label, path, { multi = false, rows = 3, max = 1000, hint = '', render, after } = {}) {
  const v = readPath(path) ?? '';
  const input = multi ? el('textarea', { rows, maxlength: max }) : el('input', { type: 'text', maxlength: max });
  input.value = v;
  const id = `f${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  input.addEventListener('input', () => {
    mutate((site) => writePath(site, path, input.value), { render: render || renderHintFor(path), key: `insp:${path}`, panels: 'list' });
    after?.(input.value);
  });
  return el('div', { class: 'ws-field' }, el('div', { class: 'ws-f-head' }, el('label', { for: id }, label), hint ? el('span', { class: 'ws-hint' }, hint) : null), input);
}
function selectField(label, value, options, onchange) {
  const sel = el('select', {}, ...options.map(([v, t]) => el('option', { value: v, selected: v === value }, t)));
  sel.addEventListener('change', () => onchange(sel.value));
  return el('label', { class: 'ws-sel' }, el('small', {}, label), sel);
}
function linkTargets() {
  const out = [['/', 'Home page']];
  state.site.pages.forEach((p, i) => { if (i) out.push([`/${p.slug}`, `${p.title} page`]); });
  for (const p of state.site.pages) for (const s of p.sections) if (s.anchor) out.push([p === currentPage() ? `#${s.anchor}` : `/${p.slug}#${s.anchor}`.replace(/^\/#/, '/#'), `${SECTIONS[s.type].name} on ${p.title}`]);
  return out;
}
function linkField(label, path) {
  const l = readPath(path) || { label: '', href: '' };
  const dl = `dl-${Math.random().toString(36).slice(2, 8)}`;
  const lab = el('input', { type: 'text', maxlength: 40, value: l.label || '', placeholder: 'Button text (empty hides it)', 'aria-label': `${label} text` });
  const href = el('input', { type: 'text', maxlength: 400, value: l.href || '', placeholder: '/contact, #faq, https://…, mailto:…', list: dl, 'aria-label': `${label} link` });
  lab.addEventListener('input', () => mutate((site) => writePath(site, `${path}.label`, lab.value), { render: renderHintFor(path), key: `insp:${path}.label`, panels: false }));
  href.addEventListener('change', () => mutate((site) => writePath(site, `${path}.href`, href.value.trim()), { render: renderHintFor(path), key: `insp:${path}.href`, panels: false }));
  return el('div', { class: 'ws-field' }, el('div', { class: 'ws-f-head' }, el('span', {}, label)), lab, el('div', { style: 'height:6px' }), href, el('datalist', { id: dl }, ...linkTargets().map(([v, t]) => el('option', { value: v }, t))));
}
function imageField(label, path) {
  const slot = readPath(path) || {};
  const url = assetUrl(slot.src);
  return el('div', { class: 'ws-img-field' },
    el('div', { class: 'ws-thumb' }, url ? el('img', { src: url, alt: '' }) : 'none'),
    el('div', {}, el('strong', { style: 'font-size:13px' }, label), el('small', {}, slot.src ? slot.alt || 'No alt text' : slot.prompt ? `Suggested: ${slot.prompt}` : 'No image'), el('button', { type: 'button', class: 'ws-mini', onclick: () => openImage(path) }, slot.src ? 'Change' : 'Add image')));
}
function iconField(path) {
  const v = readPath(path) || 'sparkle';
  return selectField('Icon', v, ICON_NAMES.map((n) => [n, n]), (val) => mutate((site) => writePath(site, path, val), { render: renderHintFor(path), panels: false }));
}
function boolField(label, path) {
  const cb = el('input', { type: 'checkbox', checked: !!readPath(path) });
  cb.addEventListener('change', () => mutate((site) => writePath(site, path, cb.checked), { render: renderHintFor(path), panels: false }));
  return el('label', { class: 'ws-toggle' }, cb, label);
}

const LABEL = { mark: 'Big numeral', client: 'Client or team', credits: 'Credits (one per line)', year: 'Year', status: 'Status', eyebrow: 'Label above the title', title: 'Title', subtitle: 'Intro', text: 'Text', note: 'Small print', hours: 'Opening hours', button: 'Button text', tagline: 'Tagline', caption: 'Caption', url: 'Link or map: address', status: 'Status', price: 'Price', address: 'Address', beds: 'Beds', baths: 'Baths', sqft: 'Square feet', lot: 'Lot size', year: 'Year built', name: 'Name', role: 'Role', bio: 'Short bio', quote: 'Quote', q: 'Question', a: 'Answer', value: 'Value', label: 'Label', date: 'Date or step', day: 'Day', time: 'Time', period: 'Per', features: 'Included (one per line)', excerpt: 'Summary', body: 'Article', length: 'Length', category: 'Category' };
const lbl = (k, def) => def?.labels?.[k] || LABEL[k] || k[0].toUpperCase() + k.slice(1);

function fieldFor(type, key, path, def) {
  if (type === 'image') return imageField(lbl(key, def) === 'image' ? 'Image' : 'Image', path);
  if (type === 'link') return linkField(lbl(key, def), path);
  if (type === 'icon') return iconField(path);
  if (type === 'motif') return selectField('Line art', readPath(path) || 'orbit', Object.entries(MOTIFS), (val) => mutate((site) => writePath(site, path, val), { render: renderHintFor(path), panels: false }));
  if (type === 'bool') return boolField(key === 'featured' ? 'Highlight this one' : lbl(key, def), path);
  if (type === 'href') return textField('Link', path, { max: 400, render: renderHintFor(path) });
  if (type === 'url') {
    const f = textField(lbl(key, def), path, { max: 400, hint: 'YouTube, Vimeo, Spotify, SoundCloud or map: an address' });
    const ok = embedFor(readPath(path));
    f.append(el('p', { class: 'ws-hint', style: 'margin:6px 0 0' }, ok ? `Shows a ${ok.kind === 'map' ? 'map' : ok.kind === 'video' ? 'video' : 'player'} that loads when a visitor clicks it.` : 'Not a link we can embed yet.'));
    return f;
  }
  return textField(lbl(key, def), path, { multi: type === 'para' || type === 'long' || type === 'list', rows: type === 'long' ? 8 : type === 'list' ? 4 : 3, max: type === 'long' ? 12000 : type === 'para' || type === 'list' ? 1200 : 160 });
}

function itemSummary(it, i, schema) {
  const k = Object.keys(schema).find((x) => schema[x] === 'text' && it[x]);
  return k ? String(it[k]).replace(/\*/g, '') : `Item ${i + 1}`;
}
function blankItem(schema) {
  const o = {};
  for (const [k, t] of Object.entries(schema)) o[k] = t === 'image' ? { src: '', alt: '', prompt: '' } : t === 'link' ? { label: '', href: '' } : t === 'icon' ? 'sparkle' : t === 'bool' ? false : '';
  return o;
}
function itemsEditor(base, key, spec, label, renderHint) {
  const arr = readPath(`${base}${key}`) || [];
  const box = el('div', { class: 'ws-fieldset' });
  const add = el('button', { type: 'button', class: 'ws-mini', disabled: arr.length >= spec.max, onclick: () => {
    mutate((site) => {
      const list = readPath(`${base}${key}`, site);
      const last = list[list.length - 1];
      const it = last ? JSON.parse(JSON.stringify(last)) : blankItem(spec.item);
      delete it.ph;
      delete it.id;
      if (it.image) it.image = { ...it.image, src: '' };
      if ('featured' in it) it.featured = false;
      list.push(it);
    }, { render: renderHint });
    state.open.add(`${base}${key}.${arr.length}`);
    renderInspector();
  } }, '+ Add');
  box.append(el('div', { class: 'ws-f-head' }, el('span', {}, `${label} · ${arr.length}`), add));
  const list = el('div', { class: 'ws-items' });
  arr.forEach((it, i) => {
    const id = `${base}${key}.${i}`;
    const d = el('details', { class: 'ws-item', open: state.open.has(id) });
    d.addEventListener('toggle', () => { if (d.open) state.open.add(id); else state.open.delete(id); });
    const move = (dir) => (e) => {
      e.preventDefault();
      mutate((site) => { const l = readPath(`${base}${key}`, site); const j = i + dir; if (j < 0 || j >= l.length) return; l.splice(j, 0, l.splice(i, 1)[0]); }, { render: renderHint });
    };
    const ctl = el('span', { class: 'ws-item-ctl' },
      svgBtn(UI.up, 'Move up', move(-1), { disabled: i === 0 }),
      svgBtn(UI.down, 'Move down', move(1), { disabled: i === arr.length - 1 }),
      svgBtn(UI.del, 'Remove', (e) => { e.preventDefault(); mutate((site) => readPath(`${base}${key}`, site).splice(i, 1), { render: renderHint }); }));
    d.append(el('summary', {}, el('span', { class: it.ph ? 'ph' : '' }, `${it.ph ? '● ' : ''}${itemSummary(it, i, spec.item)}`), ctl));
    const body = el('div', { class: 'ws-item-body' });
    for (const [k, t] of Object.entries(spec.item)) body.append(fieldFor(t, k, `${id}.${k}`));
    d.append(body);
    list.append(d);
  });
  box.append(list);
  return box;
}

function renderInspector() {
  const box = $('#inspector');
  const found = state.sel && !state.view ? findSection(state.sel) : null;
  if (!found) {
    box.replaceChildren(el('p', { class: 'ws-note' }, state.view ? '' : 'Click a section in the preview, or in the list above, to edit its layout and details. Click any text in the preview to type over it.'));
    return;
  }
  const { s } = found;
  const def = SECTIONS[s.type];
  const base = `${s.id}:`;
  const hint = { sid: s.id };
  const nodes = [
    el('div', { class: 'ws-insp-head' }, el('h2', {}, def.name), el('button', { type: 'button', class: 'ws-mini', onclick: () => openAdd(s.id) }, '+ Below')),
    el('p', { class: 'ws-note' }, def.hint),
    el('div', { class: 'ws-grid2' },
      selectField('Layout', s.variant, Object.entries(def.variants), (v) => mutate((site) => { findSection(s.id, site).s.variant = v; }, { render: hint })),
      selectField('Background', s.tone || 'base', Object.entries(TONES), (v) => mutate((site) => { findSection(s.id, site).s.tone = v; }, { render: hint }))),
  ];
  if (def.collection) {
    const col = def.collection;
    nodes.push(el('div', { class: 'ws-fill' }, el('p', {}, `Shows the ${COLLECTIONS[col].name} collection (${(state.site.collections[col] || []).length} items).`), el('button', { type: 'button', class: 'btn-ghost wide', onclick: () => { state.cmsCol = col; switchTab('cms'); renderCms(); } }, `Edit ${COLLECTIONS[col].name.toLowerCase()}`)));
  }
  for (const [k, t] of Object.entries(def.fields)) {
    if (typeof t === 'object') nodes.push(itemsEditor(base, k, t, k === 'items' ? 'Items' : lbl(k, def), hint));
    else nodes.push(fieldFor(t, k, `${base}${k}`, def));
  }
  const anchor = el('input', { type: 'text', value: s.anchor || '', maxlength: 40, placeholder: 'e.g. contact' });
  anchor.addEventListener('change', () => mutate((site) => { const x = findSection(s.id, site).s; const v = slugify(anchor.value, 40); if (v) x.anchor = v; else delete x.anchor; tidySite(site); }));
  nodes.push(el('div', { class: 'ws-field' }, el('div', { class: 'ws-f-head' }, el('span', {}, 'Link name'), el('span', { class: 'ws-hint' }, 'Links to it use #name')), anchor));
  nodes.push(boolField('Hide this section on the live site', `${base}hidden`));
  box.replaceChildren(...nodes);
}

// ---------- theme ----------
function styleCard(id, checked, onpick) {
  const st = STYLES[id];
  const pal = PALETTES[st.palette][st.mode];
  const acc = PALETTES[st.palette].accent;
  const b = el('button', { type: 'button', class: 'ws-style', role: 'radio', 'aria-checked': String(checked), onclick: onpick, 'data-style': id },
    el('span', { class: 'ws-swatch', style: `background:${pal.bg};color:${pal.text};border-radius:${Math.min(st.radius, 12)}px` }, el('b', { style: `font-family:'${fontFamily(st.heading)}',serif;font-weight:${Math.min(st.hw, FONTS[st.heading].w[1])};font-stretch:${FONTS[st.heading].wdth || 100}%` }, 'Aa'), el('i', { style: `background:${acc}` })),
    el('strong', {}, st.name), el('small', {}, st.blurb));
  return b;
}
function seg(boxSel, opts, value, onpick) {
  $(boxSel).replaceChildren(...opts.map(([v, t]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), onclick: () => onpick(v) }, t)));
}
function setTheme(fn, render = 'theme', key = '') {
  mutate((site) => fn(site.theme, site), { render, key: key ? `theme:${key}` : '', panels: false });
  renderThemePanel();
}
function renderThemePanel() {
  const t = state.site.theme;
  $('#theme-styles').replaceChildren(...Object.keys(STYLES).map((id) => styleCard(id, id === t.style, () => setTheme((th, site) => { site.theme = { ...themeFor(id, th.accent) }; }, 'full'))));
  seg('#mode', [['light', 'Light'], ['dark', 'Dark']], t.mode, (v) => setTheme((th) => { th.mode = v; }));
  $('#palettes').replaceChildren(...Object.entries(PALETTES).map(([id, p]) => {
    const n = p[t.mode];
    return el('button', { type: 'button', class: 'ws-pal', role: 'radio', 'aria-checked': String(id === t.palette), 'aria-label': `${p.name} palette`, title: p.name, onclick: () => setTheme((th) => { th.palette = id; th.accent = p.accent; }) }, el('span', { style: `background:${n.bg}` }), el('span', { style: `background:${p.accent}` }));
  }));
  $('#accent').value = t.accent;
  $('#o-accent').textContent = t.accent;
  const fill = (sel, list, val) => $(sel).replaceChildren(...list.map((f) => el('option', { value: f, selected: f === val }, `${f} · ${FONTS[f].cat}`)));
  fill('#font-h', HEADING_FONTS, t.heading);
  fill('#font-b', BODY_FONTS, t.body);
  $('#radius').value = t.radius;
  $('#o-radius').textContent = `${t.radius} px`;
  seg('#spacing', [['compact', 'Compact'], ['normal', 'Normal'], ['airy', 'Airy']], t.spacing, (v) => setTheme((th) => { th.spacing = v; }));
  seg('#motion', [['none', 'None'], ['subtle', 'Subtle'], ['lively', 'Lively']], t.motion, (v) => setTheme((th) => { th.motion = v; }));
  const rep = contrastReport(t).filter((r) => r.tone === 'base' || r.tone === 'acc' || r.tone === 'inv');
  $('#contrast').replaceChildren(...rep.map((r) => el('li', {}, el('span', {}, `${{ base: 'Page', acc: 'Brand band', inv: 'Inverse' }[r.tone]}: ${r.pair}`), el('b', { class: r.ratio < 4.5 ? 'bad' : '' }, `${r.ratio.toFixed(1)}:1`))));
}

// ---------- content (CMS) ----------
function renderCms() {
  const s = state.site;
  seg('#cms-tabs', Object.entries(COLLECTIONS).map(([k, c]) => [k, `${c.name} ${(s.collections[k] || []).length}`]), state.cmsCol, (v) => { state.cmsCol = v; renderCms(); });
  document.querySelectorAll('#cms-tabs button').forEach((b) => b.setAttribute('role', 'tab'));
  const col = state.cmsCol;
  const def = COLLECTIONS[col];
  const items = s.collections[col] || [];
  const listType = Object.keys(SECTIONS).find((t) => SECTIONS[t].collection === col);
  const where = s.pages.filter((p) => p.sections.some((x) => x.type === listType && !x.hidden)).map((p) => p.title);
  const nodes = [
    el('p', { class: 'ws-note' }, where.length ? `Shown on: ${where.join(', ')}.${def.detail ? ' Each one also gets its own page.' : ''}` : `Not on any page yet.`),
  ];
  if (!where.length) nodes.push(el('button', { type: 'button', class: 'btn-ghost wide', onclick: () => { state.insertAfter = null; addSection(listType); switchTab('page'); } }, `Add a ${SECTIONS[listType].name} section to ${currentPage().title}`));
  const listBox = el('div', { class: 'ws-items' });
  items.forEach((it, i) => {
    const id = `@${col}:${it.id}`;
    const d = el('details', { class: 'ws-item', open: state.open.has(id) });
    d.addEventListener('toggle', () => { if (d.open) state.open.add(id); else state.open.delete(id); });
    const move = (dir) => (e) => { e.preventDefault(); mutate((site) => { const l = site.collections[col]; const j = i + dir; if (j < 0 || j >= l.length) return; l.splice(j, 0, l.splice(i, 1)[0]); }); };
    d.append(el('summary', {}, el('span', { class: it.ph ? 'ph' : '' }, `${it.ph ? '● ' : ''}${it.title || `${def.singular} ${i + 1}`}`), el('span', { class: 'ws-item-ctl' },
      svgBtn(UI.up, 'Move up', move(-1), { disabled: i === 0 }),
      svgBtn(UI.down, 'Move down', move(1), { disabled: i === items.length - 1 }),
      svgBtn(UI.del, `Delete ${def.singular}`, (e) => { e.preventDefault(); mutate((site) => site.collections[col].splice(i, 1)); }))));
    const body = el('div', { class: 'ws-item-body' });
    for (const [k, t] of Object.entries(def.fields)) {
      const path = `${id}:${k}`;
      if (t === 'audio') body.append(audioField(path, it));
      else if (t === 'image') body.append(imageField('Image', path));
      else body.append(textField(lbl(k), path, { multi: t === 'para' || t === 'long', rows: t === 'long' ? 8 : 3, max: t === 'long' ? 12000 : t === 'para' ? 1000 : t === 'href' ? 400 : 160, render: 'full' }));
    }
    if (def.detail) body.append(el('button', { type: 'button', class: 'ws-mini', onclick: () => openItem(col, it.id) }, 'Open its page'));
    d.append(body);
    listBox.append(d);
  });
  nodes.push(listBox, el('button', { type: 'button', class: 'btn-ghost wide', onclick: () => { const it = newItem(col); mutate((site) => { site.collections[col].push(it); tidySite(site); }); state.open.add(`@${col}:${it.id}`); renderCms(); } }, `+ Add ${def.singular.toLowerCase()}`));
  $('#cms').replaceChildren(...nodes);
}
function audioField(path, it) {
  const input = el('input', { type: 'file', accept: 'audio/*', hidden: true });
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { toast('That file is over 25 MB, too big for most free hosts. Try an MP3.', 'error'); return; }
    const ref = await addAsset(f, { name: f.name });
    mutate((site) => writePath(site, path, ref));
  });
  return el('div', { class: 'ws-field' }, el('div', { class: 'ws-f-head' }, el('span', {}, 'Audio file'), el('span', { class: 'ws-hint' }, it.audio ? state.assets.get(String(it.audio).slice(6))?.name || 'Added' : 'MP3 or M4A you have the rights to')),
    el('label', { class: 'ws-mini', style: 'display:inline-grid;place-items:center;cursor:pointer' }, input, it.audio ? 'Replace' : 'Upload'),
    it.audio ? el('button', { type: 'button', class: 'ws-mini', style: 'margin-left:6px', onclick: () => mutate((site) => writePath(site, path, '')) }, 'Remove') : null);
}

// ---------- settings ----------
function renderSettings() {
  const s = state.site;
  const page = currentPage();
  const pi = s.pages.indexOf(page);
  const counter = (path, max) => { const n = String(readPath(path) || '').length; return `${n} / ${max}`; };
  const seoTitle = textField('Search title', '$:seo.title', { max: 70, hint: counter('$:seo.title', 60), render: 'none', after: () => snippet() });
  const seoDesc = textField('Search description', '$:seo.description', { multi: true, rows: 3, max: 170, hint: counter('$:seo.description', 155), render: 'none', after: () => snippet() });
  const snip = el('div', { class: 'ws-field', 'aria-label': 'Search result preview' });
  const snippet = () => {
    const u = s.seo.url ? s.seo.url.replace(/^https?:\/\//, '') : 'your-site.pages.dev';
    snip.replaceChildren(el('div', { class: 'ws-f-head' }, el('span', {}, 'How it may look in search')), el('div', { style: 'font-size:12px;color:#9aa0a6' }, u), el('div', { style: 'font-size:16px;color:#8ab4f8;line-height:1.3;margin:2px 0' }, state.site.seo.title || state.site.name), el('div', { style: 'font-size:13px;color:#bdc1c6' }, state.site.seo.description || ''));
  };
  snippet();
  const url = el('input', { type: 'url', value: s.seo.url || '', placeholder: 'https://your-site.pages.dev' });
  url.addEventListener('change', () => {
    let v = url.value.trim();
    if (v && !/^https?:\/\//.test(v)) v = `https://${v}`;
    try { v = v ? new URL(v).origin + new URL(v).pathname.replace(/\/+$/, '') : ''; } catch { toast('That does not look like a web address.', 'error'); return; }
    mutate((site) => { site.seo.url = v; }, { render: 'none' });
  });
  const lang = selectField('Language', s.seo.lang || 'en', [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'], ['nl', 'Nederlands'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文']], (v) => mutate((site) => { site.seo.lang = v; }, { render: 'none' }));
  const form = textField('Form service URL (optional)', '$:contact.form', { max: 400, render: 'full', hint: 'https only' });
  form.querySelector('input').addEventListener('change', (e) => { const v = e.target.value.trim(); if (v && !/^https:\/\//.test(v)) { toast('Use the https:// address your form service gives you.', 'error'); } });
  const credit = el('input', { type: 'checkbox', checked: !!s.credit });
  credit.addEventListener('change', () => mutate((site) => { site.credit = credit.checked; }, { render: 'full', panels: false }));
  const nodes = [
    el('div', { class: 'ws-group-h' }, 'Site'),
    textField('Site name', '$:name', { max: 80, render: 'full' }),
    textField('Tagline', '$:tagline', { max: 140, render: 'full' }),
    linkField('Header button', '$:nav.cta'),
    el('div', { class: 'ws-group-h' }, 'Search and sharing'),
    seoTitle, seoDesc, snip,
    el('div', { class: 'ws-field' }, el('div', { class: 'ws-f-head' }, el('label', {}, 'Site address'), el('span', { class: 'ws-hint' }, 'For the sitemap and link previews')), url),
    imageField('Social preview image (auto if empty)', '$:seo.image'),
    lang,
    el('div', { class: 'ws-group-h' }, 'Contact and forms'),
    textField('Email', '$:contact.email', { max: 120, render: 'full' }),
    textField('Phone', '$:contact.phone', { max: 40, render: 'full' }),
    textField('Address', '$:contact.address', { max: 160, render: 'full' }),
    form,
    el('p', { class: 'ws-note' }, 'Forms send to the URL from a form service you sign up for (Formspree, Basin, Web3Forms, Getform and others have free plans). Without one, the form opens the visitor’s email app addressed to your email.'),
    el('label', { class: 'ws-check' }, credit, el('span', {}, el('strong', {}, 'Made with Chucksi credit'), el('small', {}, 'A small link in the footer. Optional.'))),
    el('div', { class: 'ws-group-h' }, `This page: ${page.title}`),
  ];
  const title = el('input', { type: 'text', value: page.title, maxlength: 40 });
  title.addEventListener('input', () => renamePage(page.id, title.value || 'Page'));
  nodes.push(el('div', { class: 'ws-field' }, el('div', { class: 'ws-f-head' }, el('label', {}, 'Page name'), el('span', { class: 'ws-hint' }, pi ? `Address: /${page.slug}/` : 'Home page: /')), title));
  nodes.push(textField('Page search title', `$:pages.${pi}.seo.title`, { max: 70, render: 'none', hint: 'Optional' }));
  nodes.push(textField('Page search description', `$:pages.${pi}.seo.description`, { multi: true, rows: 2, max: 170, render: 'none', hint: 'Optional' }));
  if (pi) nodes.push(el('button', { type: 'button', class: 'ws-mini danger', onclick: () => deletePage(page.id) }, `Delete ${page.title}`));
  $('#settings').replaceChildren(...nodes);
}

// ---------------------------------------------------------------------------------------------
// Create: kinds, styles, generation, image filling, saved sites
// ---------------------------------------------------------------------------------------------

function renderCreate() {
  $('#kinds').replaceChildren(...Object.entries(KINDS).map(([k, v]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(k === state.kind), 'data-kind': k, onclick: () => {
    state.kind = k;
    if (!state.styleTouched) state.style = v.style;
    $('#prompt').placeholder = v.example;
    renderCreate();
  } }, v.name)));
  $('#styles').replaceChildren(...Object.keys(STYLES).map((id) => styleCard(id, id === state.style, () => { state.style = id; state.styleTouched = true; renderCreate(); })));
}
function syncCreate() {
  $('#o-prompt').textContent = `${$('#prompt').value.length} / 600`;
}

// The site is written in the browser by the built-in writer (spec.js templateSite): no model call, nothing leaves
// the page. SITE_RULES in spec.js is kept for a future model-backed writer; no server route uses it.
async function writeSite(prompt, kind, style) {
  state.source = 'template';
  return templateSite({ prompt, kind, style });
}

async function generate() {
  if (state.busy) return;
  commitEdit();
  const prompt = $('#prompt').value.trim() || KINDS[state.kind].example;
  state.busy = true;
  $('#generate').disabled = true;
  $('#generate-label').textContent = 'Writing…';
  try {
    if (state.id && !state.demo) await save();
    const site = await writeSite(prompt, state.kind, state.style);
    newProject(site);
    hideStatus();
    const n = site.pages.reduce((a, p) => a + p.sections.length, 0);
    toast(`The built-in writer made ${site.pages.length} page${site.pages.length > 1 ? 's' : ''} and ${n} sections. Click any text to edit it.`);
    scheduleSave();
  } finally {
    state.busy = false;
    $('#generate').disabled = false;
    $('#generate-label').textContent = 'Generate site';
    hideStatus();
  }
}

function newProject(site, { demo = false } = {}) {
  for (const a of state.assets.values()) URL.revokeObjectURL(a.url);
  state.assets = new Map();
  state.site = site;
  state.id = demo ? null : uid('w');
  state.created = Date.now();
  state.demo = demo;
  state.past = [];
  state.future = [];
  state.lastKey = '';
  state.pageId = site.pages[0].id;
  state.view = null;
  state.sel = null;
  state.open.clear();
  state.template = null;
  state.kind = site.kind;
  if (STYLES[site.theme.style]) state.style = site.theme.style;
  frame.contentWindow?.scrollTo(0, 0);
  renderPreview('full');
  renderPanels();
  renderCreate();
  updateHistoryButtons();
  $('#saved').textContent = demo ? 'Example' : '';
}

/** Image slots that have a suggested prompt but no picture yet, across every page and listed collection. */
function emptySlots() {
  const out = [];
  const walk = (o, path) => {
    if (Array.isArray(o)) { o.forEach((x, i) => walk(x, `${path}.${i}`)); return; }
    if (!o || typeof o !== 'object') return;
    if ('src' in o && 'prompt' in o && 'alt' in o) { if (!o.src && String(o.prompt).trim()) out.push({ path, prompt: o.prompt }); return; }
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') walk(v, path ? `${path}.${k}` : k);
  };
  for (const p of state.site.pages) for (const s of p.sections) {
    if (s.hidden) continue;
    for (const [k, v] of Object.entries(s)) if (v && typeof v === 'object') walk(v, `${s.id}:${k}`);
  }
  for (const col of Object.keys(COLLECTIONS)) {
    if (!usedCollection(state.site, col)) continue;
    for (const it of state.site.collections[col]) if (it.image && !it.image.src && it.image.prompt) out.push({ path: `@${col}:${it.id}:image`, prompt: it.image.prompt });
  }
  return out;
}
function renderFill() {
  const n = state.site ? emptySlots().length : 0;
  $('#fill-box').hidden = !n || state.demo;
  $('#fill-count').textContent = `${n} image${n === 1 ? '' : 's'}`;
}

function ratioFor(path, node) {
  const n = node || frame.contentDocument?.querySelector(`[data-img="${CSS.escape(path)}"]`);
  const r = n?.getBoundingClientRect();
  if (r && r.width > 20 && r.height > 20) return Math.max(9 / 16, Math.min(21 / 9, r.width / r.height));
  return 4 / 3;
}
async function generateImage(prompt, ratio, signal) {
  const long = 1280;
  const w = ratio >= 1 ? long : Math.round(long * ratio);
  const h = ratio >= 1 ? Math.round(long / ratio) : long;
  const full = `${prompt}, professional photograph, natural light, sharp focus, no text, no watermark`;
  const res = await shoot({
    prompt: full, w, h, seed: Math.floor(Math.random() * 1e9), engine: 'auto', signal,
    onWait: (ms) => status(`Pollinations allows one image every 45 seconds. Next one in ${Math.ceil(ms / 1000)} s.`, null),
  });
  let c = res.image;
  if (!(c instanceof HTMLCanvasElement)) {
    const cc = document.createElement('canvas');
    cc.width = c.width;
    cc.height = c.height;
    cc.getContext('2d').drawImage(c, 0, 0);
    c = cc;
  }
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88));
  return await addAsset(blob, { w: c.width, h: c.height, name: prompt.slice(0, 60) });
}

async function fillImages() {
  if (state.fillCtl) return;
  const slots = emptySlots();
  if (!slots.length) return;
  const ctl = new AbortController();
  state.fillCtl = ctl;
  $('#status-cancel').hidden = false;
  let done = 0;
  try {
    for (const [k, slot] of slots.entries()) {
      if (ctl.signal.aborted) break;
      status(`Making image ${k + 1} of ${slots.length}`, k / slots.length);
      try {
        const ref = await generateImage(slot.prompt, ratioFor(slot.path), ctl.signal);
        mutate((site) => writePath(site, `${slot.path}.src`, ref), { render: renderHintFor(slot.path), panels: false });
        done++;
      } catch (e) {
        if (ctl.signal.aborted) break;
        toast(`Image ${k + 1}: ${e.message}`, 'error');
        if (e.cap) break;
      }
    }
  } finally {
    state.fillCtl = null;
    $('#status-cancel').hidden = true;
    hideStatus();
    renderPanels();
    if (done) toast(`Added ${done} image${done > 1 ? 's' : ''}. Click any image to swap it.`);
  }
}

function status(text, progress) {
  $('#status').hidden = false;
  $('#status-text').textContent = text;
  const m = document.querySelector('.ws-meter');
  m.classList.toggle('indeterminate', progress == null);
  $('#meter').style.width = progress == null ? '' : `${Math.round(progress * 100)}%`;
}
function hideStatus() { $('#status').hidden = true; }

async function renderSites() {
  let items = [];
  try { items = (await store.all()).filter((x) => x.kind === 'site').sort((a, b) => b.updated - a.updated); } catch { /* private mode */ }
  $('#sites-wrap').hidden = !items.length;
  $('#sites').replaceChildren(...items.map((it) => el('li', { class: `ws-site${it.id === state.id ? ' on' : ''}` },
    el('button', { type: 'button', class: 'open', onclick: () => openProject(it.id) }, el('strong', {}, it.name || 'Untitled'), el('small', {}, `${new Date(it.updated).toLocaleString()}${it.id === state.id ? ' · open' : ''}`)),
    el('button', { type: 'button', class: 'ws-mini danger', 'aria-label': `Delete ${it.name}`, onclick: async () => {
      if (!confirm(`Delete “${it.name}” from this browser?`)) return;
      await store.del(it.id);
      if (it.id === state.id) { state.id = null; state.demo = true; }
      renderSites();
    } }, 'Delete'))));
}

async function openProject(id) {
  commitEdit();
  if (state.id && !state.demo) await save();
  const rec = await store.get(id);
  if (!rec) return;
  loadRecord(rec);
}
function loadRecord(rec) {
  for (const a of state.assets.values()) URL.revokeObjectURL(a.url);
  const assets = new Map();
  for (const [aid, a] of Object.entries(rec.assets || {})) if (a?.blob) assets.set(aid, { ...a, url: URL.createObjectURL(a.blob) });
  const fallback = templateSite({ prompt: rec.spec?.prompt || '', kind: rec.spec?.kind || 'business', style: rec.spec?.theme?.style });
  const site = sanitizeSite(rec.spec, fallback, { source: 'user', assets: new Set(assets.keys()) });
  newProject(site);
  state.assets = assets;
  state.id = rec.id;
  state.created = rec.created || Date.now();
  $('#prompt').value = site.prompt || '';
  syncCreate();
  renderPreview('full');
  renderPanels();
  renderSites();
  $('#saved').textContent = 'Saved';
}

// ---------------------------------------------------------------------------------------------
// Templates: one-click example sites (the picker in Create, the dialog, and /website?template=<id>)
// ---------------------------------------------------------------------------------------------

function templateCard(t, big = false) {
  return el('button', { type: 'button', class: `ws-tpl${big ? ' big' : ''}`, 'data-template': t.id, 'aria-current': String(state.template === t.id), onclick: () => openTemplate(t.id) },
    el('span', { class: 'ws-tpl-img' }, el('img', { src: t.thumb, alt: '', width: 640, height: 400, loading: 'lazy', decoding: 'async' }), t.isNew ? el('span', { class: 'ws-tpl-new' }, 'New') : null),
    el('strong', {}, t.title), el('small', {}, t.description));
}
function renderTemplates() {
  $('#tpl-strip').replaceChildren(...TEMPLATES_LIST.map((t) => templateCard(t)));
  $('#tpl-grid').replaceChildren(...TEMPLATES_LIST.map((t) => templateCard(t, true)));
}
async function openTemplate(id) {
  const site = buildTemplate(id);
  if (!site) return false;
  commitEdit();
  if (state.id && !state.demo) await save();
  newProject(site, { demo: true });
  state.template = id;
  $('#prompt').value = site.prompt || '';
  syncCreate();
  if ($('#tpl-dialog').open) $('#tpl-dialog').close();
  renderTemplates();
  toast(`${TEMPLATES[id].title}: an example site. Click any text to make it yours; it saves once you edit.`);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Image dialog
// ---------------------------------------------------------------------------------------------

function openImage(path, node) {
  commitEdit();
  state.imgPath = path;
  state.imgRatio = ratioFor(path, node);
  const slot = readPath(path) || {};
  $('#img-prompt').value = slot.prompt || '';
  $('#img-alt').value = slot.alt || '';
  $('#img-deco').checked = !!slot.decorative;
  imgPreview();
  $('#img-dialog').showModal();
}
function imgPreview() {
  const slot = readPath(state.imgPath) || {};
  const url = assetUrl(slot.src);
  $('#img-prev').replaceChildren(url ? el('img', { src: url, alt: slot.alt || '' }) : el('span', {}, 'No image yet. Upload one or generate it.'));
}
async function setImage(ref, extra = {}) {
  const path = state.imgPath;
  mutate((site) => {
    const slot = readPath(path, site) || {};
    const next = { src: ref, alt: slot.alt || '', prompt: slot.prompt || '', ...(slot.decorative ? { decorative: true } : {}), ...extra };
    writePath(site, path, next);
  }, { render: renderHintFor(path) });
  imgPreview();
}

// ---------------------------------------------------------------------------------------------
// Export, share, preview
// ---------------------------------------------------------------------------------------------

function openExport() {
  commitEdit();
  const list = checklist(state.site);
  $('#checklist').replaceChildren(...(list.length ? list.map((x) => el('li', { class: x.level }, x.text)) : [el('li', { class: 'ok' }, 'Nothing to fix. Ready to publish.')]));
  $('#credit').checked = !!state.site.credit;
  $('#export-dialog').showModal();
}
async function doZip() {
  commitEdit();
  const btn = $('#dl-zip');
  btn.disabled = true;
  btn.textContent = 'Building…';
  try {
    const { blob, files } = await exportZip(state.site, state.assets, { doc: frame.contentDocument });
    download(blob, `${slugify(state.site.name) || 'site'}.zip`);
    toast(`${files.length} files, ${(blob.size / 1024).toFixed(0)} KB. Unzip it, or drop it straight onto Cloudflare Pages or Netlify.`);
    window.mzSite.lastZip = { files };
  } catch (e) {
    toast(`Export failed: ${e.message}`, 'error');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download ZIP';
  }
}
async function doSingle() {
  commitEdit();
  try {
    const blob = await exportSingle(state.site, state.assets);
    download(blob, `${slugify(state.site.name) || 'site'}.html`);
  } catch (e) {
    toast(`Export failed: ${e.message}`, 'error');
  }
}
async function doShare() {
  commitEdit();
  const url = await shareUrl(state.site);
  $('#share-url').value = url;
  const imgs = [...JSON.stringify(state.site).matchAll(/asset:/g)].length;
  $('#share-size').textContent = `${(url.length / 1024).toFixed(1)} KB link.${imgs ? ` ${imgs} image${imgs > 1 ? 's' : ''} stay in your browser.` : ''}`;
  $('#share-dialog').showModal();
  $('#share-url').select();
}
function openPreview() {
  commitEdit();
  const html = renderSingle(state.site, { src: assetUrl, imgInfo: previewOpts.imgInfo, faviconHref: `data:image/svg+xml,${encodeURIComponent(faviconSvg(state.site))}` });
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const h = here();
  window.open(`${url}#/${h.key}`, '_blank');
}

function replayMotion() {
  commitEdit();
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (state.site.theme.motion === 'none') { toast('Motion is off. Pick Subtle or Lively first.'); return; }
  const p = renderParts(state.site, here(), { ...previewOpts, forceMotion: true });
  state.replaying = true;
  doc.documentElement.classList.remove('editing');
  doc.documentElement.classList.add('rv');
  doc.body.innerHTML = p.body;
  win.scrollTo(0, 0);
  const io = new win.IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  doc.querySelectorAll('[data-rv]').forEach((n) => io.observe(n));
  toast('Scroll the preview to watch sections reveal. Click it to go back to editing.');
}

// ---------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------

function buildLibrary() {
  const groups = SECTION_GROUPS.map((g) => {
    const types = Object.entries(SECTIONS).filter(([, d]) => d.group === g);
    if (!types.length) return null;
    const ic = { hero: 'layers', logos: 'globe', features: 'sparkle', about: 'book', gallery: 'camera', testimonials: 'chat', pricing: 'ticket', faq: 'compass', team: 'users', timeline: 'clock', stats: 'chart', cta: 'bolt', contact: 'mail', signup: 'heart', embed: 'play', posts: 'pen', listings: 'home', listing: 'key', tracks: 'music', schedule: 'calendar', menu: 'utensils', footer: 'layers', statement: 'pen', lookbook: 'camera', products: 'gift', chapters: 'book', cases: 'clock', annotated: 'sparkle' };
    return el('section', {}, el('h3', {}, g), el('div', { class: 'ws-lib-grid' }, ...types.map(([t, d]) => el('button', { type: 'button', 'data-type': t, onclick: () => addSection(t) }, el('span', { class: 'ico', html: icon(ic[t] || 'sparkle', 'i') }), el('span', {}, el('strong', {}, d.name), el('small', {}, d.hint))))));
  }).filter(Boolean);
  $('#lib').replaceChildren(...groups);
}

function wire() {
  bindDialogs();
  document.querySelectorAll('[role="tab"][id^="t-"]').forEach((b) => b.addEventListener('click', () => switchTab(b.id.slice(2))));
  $('.ws-tabs').addEventListener('keydown', (e) => {
    const tabs = [...document.querySelectorAll('.ws-tabs [role="tab"]')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0 || !['ArrowRight', 'ArrowLeft'].includes(e.key)) return;
    const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    n.focus();
    switchTab(n.id.slice(2));
  });
  $('#prompt').addEventListener('input', syncCreate);
  $('#all-templates').addEventListener('click', () => $('#tpl-dialog').showModal());
  $('#generate').addEventListener('click', generate);
  $('#fill-images').addEventListener('click', fillImages);
  $('#status-cancel').addEventListener('click', () => state.fillCtl?.abort());
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  document.addEventListener('keydown', hotkeys);
  document.querySelectorAll('[data-bp]').forEach((b) => b.addEventListener('click', () => setBreakpoint(b.dataset.bp)));
  $('#page-select').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v.startsWith('@')) return;
    goPage(v);
  });
  $('#add-page').addEventListener('click', addPage);
  $('#add-section').addEventListener('click', () => openAdd(null));
  $('#share').addEventListener('click', doShare);
  $('#copy-share').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#share-url').value); toast('Link copied.'); } catch { $('#share-url').select(); toast('Select the link and copy it.'); }
  });
  $('#preview-btn').addEventListener('click', openPreview);
  $('#export-btn').addEventListener('click', openExport);
  $('#nav-export').addEventListener('click', openExport);
  $('#host-btn').addEventListener('click', () => $('#host-dialog').showModal());
  $('#to-host').addEventListener('click', () => { $('#export-dialog').close(); $('#host-dialog').showModal(); });
  $('#dl-zip').addEventListener('click', doZip);
  $('#dl-html').addEventListener('click', doSingle);
  $('#credit').addEventListener('change', (e) => mutate((site) => { site.credit = e.target.checked; }));
  $('#replay').addEventListener('click', replayMotion);
  $('#accent').addEventListener('input', (e) => setTheme((th) => { th.accent = e.target.value; }, 'theme', 'accent'));
  $('#font-h').addEventListener('change', (e) => setTheme((th) => { th.heading = e.target.value; th.hw = FONTS[e.target.value].dw; }));
  $('#font-b').addEventListener('change', (e) => setTheme((th) => { th.body = e.target.value; }));
  $('#radius').addEventListener('input', (e) => setTheme((th) => { th.radius = Number(e.target.value); }, 'theme', 'radius'));
  // image dialog
  $('#img-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const blob = await imageFileToBlob(f);
      const ref = await addAsset(blob, { name: f.name });
      const slot = readPath(state.imgPath) || {};
      await setImage(ref, slot.alt ? {} : { alt: f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').slice(0, 120) });
      $('#img-alt').value = (readPath(state.imgPath) || {}).alt || '';
      $('#img-alt').focus();
    } catch (err) {
      toast(`Could not read that image: ${err.message}`, 'error');
    }
  });
  $('#img-gen').addEventListener('click', async () => {
    const prompt = $('#img-prompt').value.trim();
    if (!prompt) { toast('Describe the image first.'); return; }
    const b = $('#img-gen');
    b.disabled = true;
    b.textContent = 'Generating…';
    try {
      const ref = await generateImage(prompt, state.imgRatio);
      await setImage(ref, { prompt });
    } catch (e) {
      toast(`The image engine is unavailable: ${e.message}`, 'error');
    } finally {
      b.disabled = false;
      b.textContent = 'Generate with Image';
      hideStatus();
    }
  });
  $('#img-alt').addEventListener('input', (e) => mutate((site) => writePath(site, `${state.imgPath}.alt`, e.target.value.slice(0, 160)), { render: renderHintFor(state.imgPath), key: `alt:${state.imgPath}`, panels: false }));
  $('#img-deco').addEventListener('change', (e) => mutate((site) => { const slot = readPath(state.imgPath, site); if (slot) { if (e.target.checked) slot.decorative = true; else delete slot.decorative; } }, { render: renderHintFor(state.imgPath), panels: false }));
  $('#img-remove').addEventListener('click', () => setImage(''));
  $('#img-done').addEventListener('click', () => $('#img-dialog').close());
  $('#img-dialog').addEventListener('close', () => renderPanels());
  new ResizeObserver(layoutFrame).observe($('#canvas'));
  window.addEventListener('beforeunload', () => { if (state.id && !state.demo) save(); });
}

async function boot() {
  wire();
  buildLibrary();
  renderCreate();
  renderTemplates();
  layoutFrame();
  await initFrame();
  let opened = false;
  const m = location.hash.match(/^#s=([\w-]+)$/);
  if (m) {
    try {
      const raw = await decodeSite(m[1]);
      const fallback = templateSite({ prompt: raw?.prompt || '', kind: raw?.kind || 'business', style: raw?.theme?.style });
      const site = sanitizeSite(raw, fallback, { source: 'user' });
      newProject(site);
      $('#prompt').value = site.prompt || '';
      scheduleSave();
      toast('Opened a shared site. It is your own copy now: edits stay in this browser.');
      opened = true;
    } catch (e) {
      toast(`That share link could not be opened (${e.message}).`, 'error');
    }
    history.replaceState(null, '', location.pathname + location.search);
  }
  const tpl = new URLSearchParams(location.search).get('template');
  if (tpl) {
    if (!opened) {
      opened = await openTemplate(tpl);
      if (!opened) toast('That template was not found. Pick one under Start from a template.', 'error');
    }
    const q = new URLSearchParams(location.search);
    q.delete('template');
    history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash);
  }
  if (!opened) {
    let recent = null;
    try { recent = (await store.all()).filter((x) => x.kind === 'site').sort((a, b) => b.updated - a.updated)[0]; } catch { /* private mode */ }
    if (recent) { loadRecord(recent); opened = true; }
  }
  if (!opened) {
    // a first example straight away, from the template (no model call until the visitor asks)
    newProject(buildTemplate('local-business'), { demo: true });
  }
  syncCreate();
  renderSites();
  switchTab('create');
  // tiny subset of each style's heading font for the style cards ("Aa" only)
  const fams = new Map();
  for (const st of Object.values(STYLES)) {
    const f = FONTS[st.heading];
    const fam = fontFamily(st.heading);
    const cur = fams.get(fam) || new Set();
    cur.add(`${f.wdth || 100},${Math.min(st.hw, f.w[1])}`);
    fams.set(fam, cur);
  }
  const q = [...fams].map(([fam, t]) => {
    const tuples = [...t].map((x) => x.split(',').map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const wide = tuples.some(([d]) => d !== 100);
    return `family=${fam.replace(/ /g, '+')}:${wide ? `wdth,wght@${tuples.map((x) => x.join(',')).join(';')}` : `wght@${tuples.map((x) => x[1]).join(';')}`}`;
  });
  document.head.append(el('link', { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?${q.join('&')}&text=Aa&display=swap` }));
  window.mzSite = {
    state, mutate, undo, redo, generate, select, setBreakpoint, goPage, openItem, renderPreview, readPath, here, commitEdit,
    apply: (site) => { newProject(site); scheduleSave(); },
    zip: () => exportZip(state.site, state.assets, { doc: frame.contentDocument }),
    single: () => exportSingle(state.site, state.assets),
    share: () => shareUrl(state.site),
    emptySlots, fillImages, addSection, openImage, save, tokens, headingWeight, openTemplate, templates: TEMPLATES_LIST,
  };
  document.body.dataset.ready = '1';
}

boot();
