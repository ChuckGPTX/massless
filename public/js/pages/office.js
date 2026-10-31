import * as T from '../pdf-tools.js';
import { bindDialogs, toast, el, download } from '../ui.js';
import { apiFetch, warmHuman } from '../human.js';
import { initSign } from '../sign/prepare.js';

const $ = (s) => document.querySelector(s);
const svg = (paths, cls = '') => `<svg viewBox="0 0 16 16" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${paths}</svg>`;

const TOOLS = [
  { id: 'select', label: 'Select', icon: '<path d="M4 2.5l8.5 5.2-3.9.9-1.6 3.9z"/>' },
  { id: 'highlight', label: 'Highlight', icon: '<path d="M2.5 14h11"/><path d="M4.5 11.5l1.2-3.8 5.6-5.2 2.2 2.2-5.2 5.6z"/>' },
  { id: 'text', label: 'Text', icon: '<path d="M3 3.5h10M8 3.5v9.5M6 13h4"/>' },
  { id: 'draw', label: 'Draw', icon: '<path d="M2.5 12c2-3 3.4-6.5 5-6.5s.4 5.5 2.4 5.5 2.1-3 3.6-4"/>' },
  { id: 'sign', label: 'Sign', icon: '<path d="M2 11.5c1.5-1 2.8-5 4.3-5S6 11 7.5 11s1.9-2.6 3-2.6.6 1.8 1.6 1.8 1.4-.8 1.9-1.3M2 14h12"/>' },
  { id: 'note', label: 'Note', icon: '<path d="M3 2.5h10v7.5l-3 3.5H3z"/><path d="M10 13.5V10h3"/>' },
];
const HL = [['amber', 'Amber', '#ffbf2f'], ['pink', 'Pink', '#ff69b4'], ['green', 'Green', '#5ce673']];
const INK = [['black', 'Black', '#141419'], ['blue', 'Blue', '#215cdb'], ['red', 'Red', '#db2633']];
const CSS = Object.fromEntries([...HL, ...INK].map(([k, , c]) => [k, c]));
const hexA = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;

const OPS = [
  { id: 'images', name: 'Images to PDF', note: 'JPG, PNG, WebP', kind: 'image', go: 'Make PDF', drop: ['Drop images here', 'JPG, PNG or WebP. One page per image, in this order.'], side: 'Drop images in the order you want the pages. Files stay in this browser.' },
  { id: 'toimg', name: 'PDF to images', note: 'PNG or JPG', kind: 'pdf', go: 'Export images', drop: ['Drop a PDF here', 'Every page becomes an image. Several pages come as one .zip.'], side: 'Each page is drawn at the scale you pick. 2x is sharper and bigger.' },
  { id: 'merge', name: 'Merge PDFs', note: 'Join in order', kind: 'pdf', go: 'Merge PDFs', drop: ['Drop PDFs here', 'Add two or more, then use the arrows to set the order.'], side: 'Pages are copied as they are, so text stays sharp and searchable.' },
  { id: 'split', name: 'Split pages', note: 'Keep or separate', kind: 'pdf', go: 'Split PDF', drop: ['Drop a PDF here', 'Pick pages like 1-3, 5 on the left.'], side: 'Leave pages blank to use every page. Ranges can run backwards, like 5-1.' },
  { id: 'rotate', name: 'Rotate pages', note: '90, 180, 270°', kind: 'pdf', go: 'Rotate PDF', drop: ['Drop a PDF here', 'Turn every page, or just the ones you list.'], side: 'Rotation is saved in the file, so it sticks in every reader.' },
  { id: 'compress', name: 'Compress', note: 'Smaller file', kind: 'pdf', go: 'Compress PDF', drop: ['Drop a PDF here', 'Best for scans and image-heavy files.'], side: 'Lower quality makes a smaller file. Pages are rebuilt as JPEG pictures.' },
  { id: 'text', name: 'Extract text', note: 'Save as .txt', kind: 'pdf', go: 'Extract text', drop: ['Drop a PDF here', 'Pulls out the words so you can copy or save them.'], side: 'Scanned pages have no text layer, so they come out empty.' },
];

const COPY = {
  edit: ['Edit any<br>PDF', 'Highlight, write, draw, sign and leave notes, then save a real PDF. Your file stays in this browser; nothing is uploaded.'],
  convert: ['Convert and<br>combine', 'Images to PDF, PDF to images, merge, split, rotate, compress and pull out text. All of it runs on your device.'],
  ask: ['Ask your<br>PDF', 'Ask a question about the PDF open in Edit. Only its text, up to 12,000 characters, is sent to an open model to answer.'],
  sign: ['Send for<br>signature', 'Start from a contract template or your own PDF, place fields for each signer, then send. Everything is encrypted in this browser before it is uploaded.'],
};
const TABS = ['edit', 'convert', 'ask', 'sign'];
let sign = null;

const state = {
  tab: 'edit', tool: 'select', hl: 'amber', ink: 'black', size: 14, pen: 2,
  doc: null, items: [], undo: [], sel: null, zoom: 1, fit: true, signature: null,
  busy: false, op: 'images', queue: [], results: [], askText: null, answers: 0,
};
let uid = 0;
const nid = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

// ---------- tabs ----------
function showTab(which) {
  state.tab = which;
  for (const t of TABS) {
    const on = t === which;
    $(`#t-${t}`).setAttribute('aria-selected', String(on));
    $(`#tab-${t}`).hidden = !on;
    $(`#foot-${t}`).hidden = !on;
    $(`#view-${t}`).hidden = !on;
    $(`#p-${t}`).classList.toggle('on', on);
  }
  $('#stage-title').innerHTML = COPY[which][0];
  $('#stage-sub').textContent = COPY[which][1];
  if (which === 'ask') { syncAskDoc(); warmHuman(); }
  if (which === 'sign') { sign.onShow(); warmHuman(); }
  if (which === 'edit' && state.doc) requestAnimationFrame(() => (state.fit ? fitZoom() : renderVisible()));
}

const setSrc = (s) => ($('#src-label').textContent = s);
function busy(btn, label, on, text, idle) {
  state.busy = on;
  btn.disabled = on;
  btn.classList.toggle('busy', on);
  label.textContent = on ? text || 'Working…' : idle;
}
const progressTo = (label) => (f, text) => { label.textContent = text || `Working ${Math.round(f * 100)}%`; };

// ======================================================================
// Edit
// ======================================================================
async function openFile(file) {
  if (!T.isPdf(file)) { toast("That isn't a PDF. Edit opens .pdf files.", 'error'); return; }
  await openBytes(file.name, new Uint8Array(await file.arrayBuffer()));
}

async function openBytes(name, bytes) {
  setSrc('Loading pdf.js');
  $('#doc-name').textContent = 'Opening…';
  let pdf;
  try {
    pdf = await T.openPdfjs(bytes);
  } catch (e) {
    $('#doc-name').textContent = state.doc ? state.doc.name : 'No PDF open';
    setSrc(state.doc ? docLabel() : 'pdf.js and pdf-lib · load on first use');
    toast(e.message || 'Could not open that PDF.', 'error');
    return false;
  }
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    pages.push({ page, vp1: page.getViewport({ scale: 1 }) });
  }
  if (state.doc) { state.doc.pages.forEach((p) => p.task?.cancel()); T.closePdf(state.doc.pdf); }
  state.doc = { name, bytes, pdf, pages };
  state.items = []; state.undo = []; state.sel = null; state.askText = null;
  $('#doc-name').textContent = name;
  $('#edit-drop').hidden = true;
  $('#editor').hidden = false;
  setSrc(docLabel());
  buildPages();
  syncButtons();
  syncAskDoc();
  T.loadPdfLib().catch(() => {}); // warm up the writer for Save
  return true;
}
const docLabel = () => `${state.doc.name} · ${state.doc.pages.length} page${state.doc.pages.length === 1 ? '' : 's'} · on this device`;

let renderIO, countIO;
const ratios = new Map();
function buildPages() {
  const box = $('#pages');
  box.innerHTML = '';
  renderIO?.disconnect(); countIO?.disconnect(); ratios.clear();
  renderIO = new IntersectionObserver((es) => es.forEach((e) => {
    const pg = state.doc?.pages[Number(e.target.dataset.page)];
    if (!pg) return;
    pg.visible = e.isIntersecting;
    if (e.isIntersecting) renderCanvas(pg);
  }), { rootMargin: '800px 0px' });
  countIO = new IntersectionObserver((es) => {
    es.forEach((e) => ratios.set(Number(e.target.dataset.page), e.intersectionRatio));
    let best = 0, cur = 0;
    ratios.forEach((r, i) => { if (r > best) { best = r; cur = i; } });
    $('#page-no').textContent = `${cur + 1} / ${state.doc.pages.length}`;
  }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
  for (const [i, pg] of state.doc.pages.entries()) {
    pg.canvas = el('canvas', { 'aria-hidden': 'true' });
    pg.ov = el('div', { class: 'ov', 'data-page': i });
    pg.wrap = el('div', { class: 'pg', 'data-page': i, role: 'group', 'aria-label': `Page ${i + 1}` }, pg.canvas, pg.ov, el('span', { class: 'pg-no', 'aria-hidden': 'true' }, String(i + 1)));
    pg.rz = 0;
    bindOverlay(pg.ov, i);
    box.append(pg.wrap);
    renderIO.observe(pg.wrap);
    countIO.observe(pg.wrap);
  }
  $('#page-no').textContent = `1 / ${state.doc.pages.length}`;
  state.fit = true;
  fitZoom();
}

function fitZoom() {
  if (!state.doc) return;
  const avail = Math.max(200, $('#pages').clientWidth - 24);
  const maxW = Math.max(...state.doc.pages.map((p) => p.vp1.width));
  setZoom(Math.min(1.4, avail / maxW), true);
}
function setZoom(z, fit = false) {
  state.zoom = Math.max(0.25, Math.min(3, Math.round(z * 100) / 100));
  state.fit = fit;
  $('#zoom-label').textContent = `${Math.round(state.zoom * 100)}%`;
  for (const pg of state.doc.pages) {
    pg.wrap.style.width = `${pg.vp1.width * state.zoom}px`;
    pg.wrap.style.height = `${pg.vp1.height * state.zoom}px`;
  }
  state.doc.pages.forEach((_, i) => renderOverlay(i));
  renderVisible();
}
function renderVisible() {
  state.doc?.pages.forEach((pg) => pg.visible && renderCanvas(pg));
}

async function renderCanvas(pg) {
  const z = state.zoom;
  if (pg.rz === z || pg.wantZ === z) return;
  pg.wantZ = z;
  pg.task?.cancel();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const viewport = pg.page.getViewport({ scale: z * dpr });
  const c = el('canvas', { 'aria-hidden': 'true' });
  c.width = Math.max(1, Math.floor(viewport.width));
  c.height = Math.max(1, Math.floor(viewport.height));
  const task = pg.page.render({ canvas: c, viewport });
  pg.task = task;
  try {
    await task.promise;
  } catch (e) {
    if (pg.wantZ === z) pg.wantZ = 0;
    if (e?.name !== 'RenderingCancelledException') toast(`Page ${pg.page.pageNumber} could not be drawn: ${e.message}`, 'error');
    return;
  }
  if (pg.wantZ !== z) return;
  pg.canvas.replaceWith(c);
  pg.canvas = c;
  pg.rz = z;
  pg.wantZ = 0;
}

// ---------- items ----------
const clone = () => state.items.map((i) => ({ ...i, points: i.points?.map((p) => [...p]) }));
function pushUndo(snapshot = clone()) {
  state.undo.push(snapshot);
  if (state.undo.length > 100) state.undo.shift();
  syncButtons();
}
function undo() {
  if (!state.undo.length) return;
  finishEditing();
  const prev = state.undo.pop();
  const pagesTouched = new Set([...state.items, ...prev].map((i) => i.page));
  state.items = prev;
  if (!state.items.some((i) => i.id === state.sel)) state.sel = null;
  pagesTouched.forEach(renderOverlay);
  syncButtons();
}
function removeSelected() {
  const it = state.items.find((i) => i.id === state.sel);
  if (!it) return;
  pushUndo();
  state.items = state.items.filter((i) => i !== it);
  state.sel = null;
  renderOverlay(it.page);
  syncButtons();
}
function select(id) {
  const prev = state.items.find((i) => i.id === state.sel);
  state.sel = id;
  const it = state.items.find((i) => i.id === id);
  if (prev && prev.page !== it?.page) renderOverlay(prev.page);
  if (it) renderOverlay(it.page);
  syncButtons();
}
function syncButtons() {
  $('#undo').disabled = !state.undo.length;
  $('#delete').disabled = !state.sel;
  const n = state.items.length;
  $('#save-label').textContent = state.busy ? $('#save-label').textContent : n ? `Save PDF · ${n} edit${n === 1 ? '' : 's'}` : 'Save PDF';
}

function bbox(points, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad];
}
const pathD = (pts) => pts.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');

function itemEl(it) {
  let n;
  if (it.type === 'highlight') {
    n = el('div', { class: 'it hl' });
    n.style.background = hexA(CSS[it.color], 0.38);
  } else if (it.type === 'text') {
    n = el('div', { class: 'it tx' }, it.text);
    n.style.color = CSS[it.color];
  } else if (it.type === 'ink') {
    n = el('div', { class: 'it ink' });
  } else if (it.type === 'sign') {
    n = el('div', { class: 'it sg' }, el('img', { src: it.src, alt: 'Signature', draggable: 'false' }));
  } else if (it.type === 'note') {
    n = el('div', { class: 'it nt' }, el('span', { class: 'nt-icon', html: svg('<path d="M3 3h10v7l-3 3H3z"/><path d="M10 13v-3h3"/>') }), el('span', { class: 'nt-body' }, it.text));
    n.style.setProperty('--nc', CSS[it.color]);
  }
  n.dataset.id = it.id;
  if (state.sel === it.id) {
    n.classList.add('sel');
    if (it.type === 'sign' || it.type === 'highlight') n.append(el('span', { class: 'rh', 'aria-hidden': 'true' }));
  }
  place(n, it);
  return n;
}
function place(n, it) {
  const z = state.zoom;
  if (it.type === 'ink') {
    const [bx, by, bw, bh] = bbox(it.points, it.width / 2 + 4);
    Object.assign(n.style, { left: `${bx * z}px`, top: `${by * z}px`, width: `${bw * z}px`, height: `${bh * z}px` });
    const d = pathD(it.points);
    n.innerHTML = `<svg viewBox="${bx} ${by} ${bw} ${bh}" preserveAspectRatio="none"><path class="hit" d="${d}" stroke-width="${Math.max(it.width, 12 / z)}"/><path d="${d}" stroke="${CSS[it.color]}" stroke-width="${it.width}"/></svg>`;
    return;
  }
  n.style.left = `${it.x * z}px`;
  n.style.top = `${it.y * z}px`;
  if (it.type === 'text') { n.style.fontSize = `${it.size * z}px`; return; }
  if (it.type === 'note') { n.style.setProperty('--z', z); return; }
  n.style.width = `${it.w * z}px`;
  n.style.height = `${it.h * z}px`;
}
function renderOverlay(pi) {
  const pg = state.doc?.pages[pi];
  if (!pg) return;
  pg.ov.replaceChildren(...state.items.filter((i) => i.page === pi).map(itemEl));
}
const elFor = (it) => state.doc.pages[it.page].ov.querySelector(`[data-id="${it.id}"]`);

// ---------- pointer interaction ----------
function pt(ov, e) {
  const r = ov.getBoundingClientRect();
  return [(e.clientX - r.left) / state.zoom, (e.clientY - r.top) / state.zoom];
}
function drag(onMove, onUp) {
  const move = (e) => { e.preventDefault(); const list = e.getCoalescedEvents?.() || []; (list.length ? list : [e]).forEach(onMove); };
  const up = (e) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onUp(e);
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function bindOverlay(ov, pi) {
  ov.addEventListener('pointerdown', (e) => onDown(e, ov, pi));
  ov.addEventListener('click', (e) => onClick(e, ov, pi));
  ov.addEventListener('dblclick', (e) => {
    const it = hitItem(e);
    if (it && (it.type === 'text' || it.type === 'note')) editItem(it, false);
  });
}
function hitItem(e) {
  const n = e.target.closest?.('.it');
  return n ? state.items.find((i) => i.id === n.dataset.id) : null;
}

let closingEdit = false;
function onDown(e, ov, pi) {
  if (e.button !== 0 || e.target.closest('.editing')) return;
  closingEdit = !!editing; // this click only finishes the open text box
  const [x, y] = pt(ov, e);
  const hit = hitItem(e);
  const tool = state.tool;
  if (e.target.classList.contains('rh') && hit) { e.preventDefault(); return startResize(e, ov, hit); }
  if (tool === 'highlight') { e.preventDefault(); return startHighlight(ov, pi, x, y); }
  if (tool === 'draw') { e.preventDefault(); return startInk(ov, pi, x, y); }
  if (tool === 'sign' && !hit) {
    e.preventDefault();
    if (!state.signature) { openSig(); return; }
    const s = state.signature;
    const w = Math.min(180, state.doc.pages[pi].vp1.width * 0.4);
    const h = w / s.ratio;
    const it = { id: nid('s'), type: 'sign', page: pi, x: x - w / 2, y: y - h / 2, w, h, src: s.src };
    pushUndo();
    state.items.push(it);
    state.sel = it.id;
    renderOverlay(pi);
    setTool('select');
    syncButtons();
    return;
  }
  if (tool === 'select' || tool === 'sign' || (hit && hit.type === tool)) {
    if (!hit) { if (state.sel) select(null); return; }
    if (tool !== 'select' && (hit.type === 'text' || hit.type === 'note')) return; // the click handler edits it
    e.preventDefault();
    select(hit.id);
    return startMove(ov, hit, x, y);
  }
}

function onClick(e, ov, pi) {
  if (e.target.closest('.editing')) return;
  const tool = state.tool;
  if (closingEdit) { closingEdit = false; return; }
  if (tool !== 'text' && tool !== 'note') return;
  const hit = hitItem(e);
  if (hit && hit.type === tool) { editItem(hit, false); return; }
  const [x, y] = pt(ov, e);
  const it = tool === 'text'
    ? { id: nid('t'), type: 'text', page: pi, x, y: y - state.size * 0.6, size: state.size, color: state.ink, text: '' }
    : { id: nid('n'), type: 'note', page: pi, x: x - 11, y: y - 11, color: state.hl, text: '' };
  state.items.push(it);
  renderOverlay(pi);
  editItem(it, true);
}

function startMove(ov, it, x0, y0) {
  const before = clone();
  const orig = { x: it.x, y: it.y, points: it.points?.map((p) => [...p]) };
  const n = elFor(it);
  let moved = false;
  drag((e) => {
    const [x, y] = pt(ov, e);
    const dx = x - x0, dy = y - y0;
    if (!moved && Math.hypot(dx, dy) * state.zoom < 3) return;
    moved = true;
    if (it.points) it.points = orig.points.map(([px, py]) => [px + dx, py + dy]);
    else { it.x = orig.x + dx; it.y = orig.y + dy; }
    place(n, it);
  }, () => { if (moved) { pushUndo(before); renderOverlay(it.page); } });
}

function startResize(e, ov, it) {
  const before = clone();
  const [x0, y0] = pt(ov, e);
  const ow = it.w, oh = it.h;
  const n = elFor(it);
  drag((ev) => {
    const [x, y] = pt(ov, ev);
    if (it.type === 'sign') { it.w = Math.max(24, ow + (x - x0)); it.h = it.w * (oh / ow); } else { it.w = Math.max(4, ow + (x - x0)); it.h = Math.max(4, oh + (y - y0)); }
    place(n, it);
  }, () => { pushUndo(before); renderOverlay(it.page); });
}

function startHighlight(ov, pi, x0, y0) {
  const prev = el('div', { class: 'it hl live' });
  prev.style.background = hexA(CSS[state.hl], 0.38);
  ov.append(prev);
  let r = { x: x0, y: y0, w: 0, h: 0 };
  const pg = state.doc.pages[pi].vp1;
  drag((e) => {
    let [x, y] = pt(ov, e);
    x = Math.max(0, Math.min(pg.width, x)); y = Math.max(0, Math.min(pg.height, y));
    r = { x: Math.min(x0, x), y: Math.min(y0, y), w: Math.abs(x - x0), h: Math.abs(y - y0) };
    place(prev, { type: 'highlight', ...r });
  }, () => {
    prev.remove();
    if (r.w * state.zoom < 4 || r.h * state.zoom < 4) return;
    pushUndo();
    state.items.push({ id: nid('h'), type: 'highlight', page: pi, color: state.hl, ...r });
    renderOverlay(pi);
    syncButtons();
  });
}

function startInk(ov, pi, x0, y0) {
  const it = { id: nid('i'), type: 'ink', page: pi, color: state.ink, width: state.pen, points: [[x0, y0]] };
  const live = el('div', { class: 'it ink live' });
  ov.append(live);
  place(live, it);
  let last = [x0, y0];
  drag((e) => {
    const p = pt(ov, e);
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) * state.zoom < 1.5) return;
    it.points.push(p);
    last = p;
    place(live, it);
  }, () => {
    live.remove();
    if (it.points.length === 1) it.points.push([x0 + 0.01, y0]); // a tap leaves a dot
    it.points = it.points.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    pushUndo();
    state.items.push(it);
    renderOverlay(pi);
    syncButtons();
  });
}

// ---------- text and note editing ----------
let editing = null;
function editItem(it, isNew) {
  finishEditing();
  const before = clone().filter((i) => !(isNew && i.id === it.id));
  const n = elFor(it);
  if (!n) return;
  const box = it.type === 'note' ? n.querySelector('.nt-body') : n;
  n.classList.add('editing');
  try { box.contentEditable = 'plaintext-only'; } catch { /* older engines */ }
  if (box.contentEditable !== 'plaintext-only') box.contentEditable = 'true';
  box.spellcheck = false;
  box.setAttribute('role', 'textbox');
  box.setAttribute('aria-label', it.type === 'note' ? 'Note text' : 'Text');
  box.dataset.placeholder = it.type === 'note' ? 'Write a note' : 'Type here';
  const orig = it.text;
  const done = () => {
    if (editing?.it !== it) return;
    editing = null;
    const text = box.innerText.replace(/\r/g, '').replace(/\n$/, '');
    if (!text.trim()) {
      state.items = state.items.filter((i) => i !== it);
      if (!isNew) pushUndo(before);
      if (state.sel === it.id) state.sel = null;
    } else if (isNew || text !== orig) {
      pushUndo(before);
      it.text = text;
    }
    renderOverlay(it.page);
    syncButtons();
  };
  editing = { it, done };
  box.addEventListener('blur', done, { once: true });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); box.blur(); }
    e.stopPropagation();
  });
  box.focus();
  const range = document.createRange();
  range.selectNodeContents(box);
  if (isNew) range.collapse(false);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(range);
}
function finishEditing() { editing?.done(); }

function setTool(id) {
  finishEditing();
  state.tool = id;
  document.querySelectorAll('.tbtn[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === id)));
  $('#pages').dataset.tool = id;
  if (id !== 'select' && state.sel) select(null);
  if (id === 'sign' && !state.signature) openSig();
}

// ---------- save ----------
async function editedBytes() {
  finishEditing();
  const pages = state.doc.pages;
  return T.writeAnnotations(state.doc.bytes, state.items, (pi, x, y) => pages[pi].vp1.convertToPdfPoint(x, y));
}
async function save() {
  if (!state.doc) { toast('Open a PDF first.', 'error'); return; }
  if (state.busy) return;
  busy($('#save'), $('#save-label'), true, 'Saving');
  try {
    const out = await editedBytes();
    const name = `${T.baseName(state.doc.name)}-edited.pdf`;
    download(T.pdfBlob(out), name);
    state.lastSave = { name, size: out.length };
    toast(`Saved ${name} (${T.fmtBytes(out.length)}). It stays on your device.`);
  } catch (e) {
    toast(`Save failed: ${e.message}`, 'error');
  } finally {
    busy($('#save'), $('#save-label'), false, '', 'Save PDF');
    syncButtons();
  }
}

// ---------- sample ----------
async function makeSample() {
  const { PDFDocument, StandardFonts, rgb } = await T.loadPdfLib();
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  const fb = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.12), soft = rgb(0.42, 0.42, 0.46), amber = rgb(1, 0.75, 0.18);
  const pages = [
    ['A free PDF toolkit', ['Massless Office opens, edits and converts PDFs in your browser.', 'Nothing is uploaded. Pick a tool above the page and try it here:', '', 'Highlight this line with the marker.', 'Click anywhere with Text and type a sentence.', 'Circle something with Draw.', 'Leave a sticky Note in the margin.']],
    ['Convert anything', ['Turn photos into a PDF, or every page into a PNG.', 'Merge several files, split out the pages you need,', 'rotate sideways scans and shrink big files.', '', 'Extract text pulls the words out as a .txt file.']],
    ['Sign here', ['Make a signature once with Sign, then click the line below.', 'Drag to move it, pull the corner to resize, then press Save PDF.']],
  ];
  pages.forEach(([title, lines], i) => {
    const p = doc.addPage([612, 792]);
    p.drawRectangle({ x: 0, y: 760, width: 612, height: 32, color: amber });
    p.drawText('MASSLESS OFFICE', { x: 56, y: 771, size: 10, font: fb, color: rgb(0.11, 0.08, 0) });
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: 480, y: 771, size: 10, font: f, color: rgb(0.11, 0.08, 0) });
    p.drawText(title, { x: 56, y: 680, size: 34, font: fb, color: ink });
    lines.forEach((l, k) => l && p.drawText(l, { x: 56, y: 630 - k * 26, size: 14, font: f, color: k ? soft : ink }));
    if (i === 2) {
      p.drawLine({ start: { x: 56, y: 360 }, end: { x: 330, y: 360 }, thickness: 1, color: ink });
      p.drawText('Signature', { x: 56, y: 342, size: 10, font: f, color: soft });
      p.drawLine({ start: { x: 380, y: 360 }, end: { x: 556, y: 360 }, thickness: 1, color: ink });
      p.drawText('Date', { x: 380, y: 342, size: 10, font: f, color: soft });
    }
  });
  return doc.save();
}
async function openSample() {
  const b = $('#sample');
  b.disabled = true;
  try { await openBytes('massless-sample.pdf', await makeSample()); } catch (e) { toast(`Could not make the sample: ${e.message}`, 'error'); } finally { b.disabled = false; }
}

// ---------- signature pad ----------
const sig = { mode: 'draw', strokes: [], typed: '' };
function openSig() { $('#sig').showModal(); drawPad(); }
function padCtx() { return $('#sig-pad').getContext('2d'); }
function drawPad() {
  const c = $('#sig-pad'), g = padCtx();
  g.clearRect(0, 0, c.width, c.height);
  g.strokeStyle = g.fillStyle = CSS[state.ink];
  g.lineCap = g.lineJoin = 'round';
  g.lineWidth = 6;
  if (sig.mode === 'draw') {
    for (const s of sig.strokes) {
      g.beginPath();
      s.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
      if (s.length === 1) g.lineTo(s[0][0] + 0.1, s[0][1]);
      g.stroke();
    }
  } else if (sig.typed.trim()) {
    let size = 150;
    const font = (s) => `italic 400 ${s}px "Segoe Script", "Brush Script MT", "Snell Roundhand", "Apple Chancery", "URW Chancery L", cursive`;
    g.font = font(size);
    while (g.measureText(sig.typed).width > c.width - 80 && size > 30) { size -= 6; g.font = font(size); }
    g.textBaseline = 'alphabetic';
    g.fillText(sig.typed, 40, c.height * 0.7);
  }
  $('#sig-hint').hidden = sig.mode === 'draw' ? sig.strokes.length > 0 : !!sig.typed.trim();
  $('#sig-hint').textContent = sig.mode === 'draw' ? 'Sign with your mouse, finger or pen' : 'Your typed name shows here';
}
function bindPad() {
  const c = $('#sig-pad');
  const at = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
  c.addEventListener('pointerdown', (e) => {
    if (sig.mode !== 'draw') return;
    e.preventDefault();
    const s = [at(e)];
    sig.strokes.push(s);
    drawPad();
    drag((ev) => { s.push(at(ev)); drawPad(); }, () => drawPad());
  });
  const setMode = (m) => {
    sig.mode = m;
    $('#sig-t-draw').setAttribute('aria-selected', String(m === 'draw'));
    $('#sig-t-type').setAttribute('aria-selected', String(m === 'type'));
    $('#sig-type-wrap').hidden = m !== 'type';
    $('#sig-pad-wrap').classList.toggle('typing', m === 'type');
    drawPad();
    if (m === 'type') $('#sig-text').focus();
  };
  $('#sig-t-draw').addEventListener('click', () => setMode('draw'));
  $('#sig-t-type').addEventListener('click', () => setMode('type'));
  $('#sig-text').addEventListener('input', (e) => { sig.typed = e.target.value; drawPad(); });
  $('#sig-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); useSig(); } });
  $('#sig-clear').addEventListener('click', () => { if (sig.mode === 'draw') sig.strokes = []; else { sig.typed = ''; $('#sig-text').value = ''; } drawPad(); });
  $('#sig-use').addEventListener('click', useSig);
}
function trimmedPad() {
  const c = $('#sig-pad');
  const d = padCtx().getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
  const out = el('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { src: out.toDataURL('image/png'), ratio: out.width / out.height };
}
function useSig() {
  const t = trimmedPad();
  if (!t) { toast(sig.mode === 'draw' ? 'Draw your signature first.' : 'Type your name first.', 'error'); return; }
  state.signature = { ...t, mode: sig.mode };
  $('#sig-name').textContent = sig.mode === 'draw' ? 'Drawn · ready to place' : `Typed · ${sig.typed.trim()}`;
  $('#sig').close();
  if (!state.doc) { toast('Signature saved. Open a PDF to place it.'); return; }
  setTool('sign');
  toast('Click a page to place your signature.');
}

// ======================================================================
// Convert
// ======================================================================
const curOp = () => OPS.find((o) => o.id === state.op);
function buildOps() {
  const box = $('#ops');
  for (const o of OPS) {
    const b = el('button', { type: 'button', class: 'bed op', role: 'radio', 'aria-checked': String(o.id === state.op), 'data-op': o.id }, el('strong', {}, o.name), el('span', {}, o.note));
    b.addEventListener('click', () => selectOp(o.id));
    box.append(b);
  }
}
function selectOp(id) {
  state.op = id;
  const o = curOp();
  document.querySelectorAll('.op').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.op === id)));
  document.querySelectorAll('#tab-convert .stack[data-op]').forEach((s) => (s.hidden = s.dataset.op !== id));
  $('#convert-label').textContent = o.go;
  $('#conv-drop-title').textContent = o.drop[0];
  $('#conv-drop-sub').textContent = o.drop[1];
  $('#op-note').textContent = o.side;
  $('#conv-in').accept = o.kind === 'image' ? 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp' : 'application/pdf,.pdf';
  $('#conv-in').multiple = true;
  $('#conv-add').textContent = o.kind === 'image' ? 'Add images' : o.id === 'merge' ? 'Add PDFs' : 'Add PDF';
  $('#text-out-wrap').hidden = id !== 'text' || !$('#text-out').value;
  renderQueue();
}

function addToQueue(files) {
  let added = 0, skipped = 0;
  for (const f of files) {
    const kind = T.isPdf(f) ? 'pdf' : T.isImage(f) ? 'image' : null;
    if (!kind) { skipped++; continue; }
    state.queue.push({ id: nid('q'), file: f, kind, url: kind === 'image' ? URL.createObjectURL(f) : null });
    added++;
  }
  if (skipped) toast(`${skipped} file${skipped === 1 ? ' was' : 's were'} skipped. Use PDF, JPG, PNG or WebP.`, 'error');
  const o = curOp();
  if (added && !state.queue.some((q) => q.kind === o.kind)) {
    const want = state.queue.at(-1).kind;
    selectOp(want === 'image' ? 'images' : 'merge');
    toast(want === 'image' ? 'Switched to Images to PDF for those images.' : 'Switched to Merge PDFs for those files.');
  }
  renderQueue();
}
function renderQueue() {
  const o = curOp();
  const box = $('#queue');
  box.replaceChildren(...state.queue.map((q, i) => {
    const off = q.kind !== o.kind;
    const ctl = (label, html, fn, dis) => el('button', { type: 'button', 'aria-label': `${label} ${q.file.name}`, title: label, html, onclick: fn, disabled: dis || null });
    return el('li', { class: `qrow${off ? ' off' : ''}`, 'data-id': q.id },
      q.url ? el('img', { class: 'qthumb', src: q.url, alt: '' }) : el('span', { class: 'qthumb pdf' }, 'PDF'),
      el('span', { class: 't' }, el('strong', { title: q.file.name }, q.file.name), el('span', {}, off ? `Not used by ${o.name}` : `${i + 1} · ${T.fmtBytes(q.file.size)}`)),
      el('span', { class: 'ctrl' },
        ctl('Move up', '↑', () => moveQ(i, -1), i === 0),
        ctl('Move down', '↓', () => moveQ(i, 1), i === state.queue.length - 1),
        ctl('Remove', '×', () => { if (q.url) URL.revokeObjectURL(q.url); state.queue.splice(i, 1); renderQueue(); })));
  }));
  $('#queue-head').hidden = !state.queue.length;
  $('#conv-drop').classList.toggle('compact', state.queue.length > 0);
}
function moveQ(i, d) {
  const j = i + d;
  if (j < 0 || j >= state.queue.length) return;
  [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
  renderQueue();
}

function addResult({ name, blob, meta }) {
  const r = { id: nid('r'), name, blob, meta, size: blob.size };
  state.results.unshift(r);
  const isZip = /\.zip$/.test(name), ext = name.split('.').pop().toUpperCase();
  const card = el('article', { class: 'rcard fresh', 'data-id': r.id },
    el('span', { class: `rtype${isZip ? ' zip' : ''}` }, ext),
    el('span', { class: 't' }, el('strong', { title: name }, name), el('span', {}, `${T.fmtBytes(blob.size)}${meta ? ` · ${meta}` : ''}`)),
    el('button', { type: 'button', class: 'btn-accent small dl', onclick: () => download(blob, name) }, 'Download'));
  $('#results').querySelectorAll('.rcard.fresh').forEach((c) => c.classList.remove('fresh'));
  $('#results').prepend(card);
  $('#results-head').hidden = false;
  return r;
}

const pad = (n, total) => String(n).padStart(String(total).length, '0');
async function runConvert() {
  if (state.busy) return;
  const o = curOp();
  const items = state.queue.filter((q) => q.kind === o.kind).map((q) => q.file);
  if (!items.length) { toast(o.kind === 'image' ? 'Add at least one image first.' : 'Add a PDF first.', 'error'); return; }
  if (o.id === 'merge' && items.length < 2) { toast('Add at least two PDFs to merge.', 'error'); return; }
  const label = $('#convert-label');
  busy($('#convert'), label, true, 'Loading tools');
  const onProgress = progressTo(label);
  const made = [];
  const keep = (r) => made.push(addResult(r));
  try {
    const read = async (f) => new Uint8Array(await f.arrayBuffer());
    if (o.id === 'images') {
      const bytes = await T.imagesToPdf(items, { size: $('#img-size').value, onProgress });
      keep({ name: items.length === 1 ? `${T.baseName(items[0].name)}.pdf` : 'images.pdf', blob: T.pdfBlob(bytes), meta: `${items.length} page${items.length === 1 ? '' : 's'}` });
    } else if (o.id === 'merge') {
      const { bytes, pages } = await T.mergePdfs(await Promise.all(items.map(read)), { onProgress });
      keep({ name: `${T.baseName(items[0].name)}-merged.pdf`, blob: T.pdfBlob(bytes), meta: `${pages} pages from ${items.length} files` });
    } else {
      for (const f of items) {
        const b = T.baseName(f.name);
        const bytes = await read(f);
        if (o.id === 'toimg') {
          const fmt = $('#img-format').value, ext = fmt === 'jpeg' ? 'jpg' : 'png';
          const imgs = await T.pdfToImages(bytes, { format: fmt, scale: Number($('#img-scale').value), onProgress });
          if (imgs.length === 1) keep({ name: `${b}.${ext}`, blob: imgs[0].blob, meta: `${imgs[0].width}×${imgs[0].height}` });
          else {
            onProgress(1, 'Zipping');
            const zip = await T.zipFiles(imgs.map((im) => ({ name: `${b}-page-${pad(im.page, imgs.length)}.${ext}`, blob: im.blob })));
            keep({ name: `${b}-images.zip`, blob: zip, meta: `${imgs.length} ${ext.toUpperCase()} images` });
          }
        } else if (o.id === 'split') {
          const perPage = $('#split-each').checked;
          const parts = await T.splitPdf(bytes, $('#split-ranges').value, { perPage, onProgress });
          if (perPage && parts.length > 1) {
            onProgress(1, 'Zipping');
            const zip = await T.zipFiles(parts.map((p) => ({ name: `${b}-${p.label}.pdf`, bytes: p.bytes })));
            keep({ name: `${b}-pages.zip`, blob: zip, meta: `${parts.length} single-page PDFs` });
          } else {
            const p = parts[0];
            keep({ name: `${b}-${p.label}.pdf`, blob: T.pdfBlob(p.bytes), meta: `${p.pages} page${p.pages === 1 ? '' : 's'}` });
          }
        } else if (o.id === 'rotate') {
          onProgress(0, 'Rotating');
          const out = await T.rotatePdf(bytes, Number($('#rot-angle').value), $('#rot-ranges').value);
          keep({ name: `${b}-rotated.pdf`, blob: T.pdfBlob(out), meta: `turned ${$('#rot-angle').value}°` });
        } else if (o.id === 'compress') {
          const out = await T.compressPdf(bytes, { quality: Number($('#quality').value), onProgress });
          const pct = Math.round((1 - out.length / bytes.length) * 100);
          keep({ name: `${b}-compressed.pdf`, blob: T.pdfBlob(out), meta: pct > 0 ? `${pct}% smaller` : `was ${T.fmtBytes(bytes.length)}, already lean` });
        } else if (o.id === 'text') {
          const text = await T.extractText(bytes, { onProgress });
          keep({ name: `${b}.txt`, blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), meta: `${text.length.toLocaleString()} characters` });
          $('#text-out').value = text;
          $('#o-text-len').textContent = `${b}.txt`;
          $('#text-out-wrap').hidden = false;
        }
      }
    }
    toast(made.length === 1 ? `${made[0].name} is ready. Press Download to save it.` : `${made.length} files are ready to download.`);
  } catch (e) {
    toast(`${o.name} failed: ${e.message}`, 'error');
  } finally {
    busy($('#convert'), label, false, '', o.go);
  }
  return made;
}

// ======================================================================
// Ask
// ======================================================================
function syncAskDoc() {
  $('#ask-doc-name').textContent = state.doc ? state.doc.name : 'no PDF yet';
}
function answerCard(q, body, meta, kind = '') {
  const card = el('article', { class: `acard ${kind}` }, el('strong', { class: 'q' }, q), el('p', {}, body), meta ? el('span', { class: 'meta' }, meta) : null);
  $('#answers').prepend(card);
  $('#answers-empty').hidden = true;
  return card;
}
async function ask() {
  if (state.busy) return;
  const q = $('#question').value.trim();
  if (!state.doc) { toast('Open a PDF in Edit first, then ask about it.', 'error'); return; }
  if (!q) { toast('Type a question first.', 'error'); $('#question').focus(); return; }
  const label = $('#ask-label');
  busy($('#ask'), label, true, 'Reading the PDF');
  try {
    if (state.askText == null) {
      const raw = await T.extractText(state.doc.bytes, { maxChars: 14000, pdf: state.doc.pdf });
      state.askText = raw.replace(/--- Page (\d+) ---\n\(no text on this page\)\n?/g, '').trim().slice(0, 12000);
    }
    if (state.askText.replace(/--- Page \d+ ---/g, '').trim().length < 20) {
      answerCard(q, "This PDF has no text to read. It may be a scan or a picture of text, which Ask can't read yet.", '', 'warn');
      return;
    }
    label.textContent = 'Thinking';
    let res;
    try {
      res = await apiFetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q, text: state.askText }) });
    } catch {
      answerCard(q, "Couldn't reach the server. Check your connection and try again.", '', 'warn');
      return;
    }
    let data = {};
    try { data = await res.json(); } catch { /* not JSON */ }
    if (res.status === 404 || res.status === 405 || res.status === 501) {
      answerCard(q, "Ask isn't switched on yet. Edit and Convert work fully in your browser in the meantime.", '', 'warn');
      return;
    }
    if (!res.ok || !data.answer) {
      const msg = res.status === 429 ? data.error || "Today's free questions are used up. Try again tomorrow."
        : res.status === 502 ? data.error || "The model didn't answer this time. Try again in a minute."
          : data.error || `Something went wrong (${res.status}). Try again.`;
      answerCard(q, msg, '', 'warn');
      return;
    }
    const model = String(data.model || 'Llama 3.3 70B').replace(/^@cf\/meta\//, '');
    answerCard(q, data.answer, `${model} · read ${state.askText.length.toLocaleString()} characters`);
    state.answers++;
  } catch (e) {
    toast(`Ask failed: ${e.message}`, 'error');
  } finally {
    busy($('#ask'), label, false, '', 'Ask');
  }
}

// ======================================================================
// Shared: files and drag and drop
// ======================================================================
function handleFiles(files) {
  const list = [...files];
  if (!list.length) return;
  if (state.tab === 'convert') { addToQueue(list); return; }
  if (state.tab === 'sign') { sign.handleFiles(list); return; }
  const pdf = list.find(T.isPdf);
  if (pdf) { openFile(pdf); return; }
  if (list.some(T.isImage)) {
    showTab('convert');
    selectOp('images');
    addToQueue(list);
    return;
  }
  toast('Drop a PDF to edit it, or images to turn them into a PDF.', 'error');
}
function bindDrop() {
  const stage = $('.stage');
  let depth = 0;
  const has = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  stage.addEventListener('dragenter', (e) => { if (!has(e)) return; e.preventDefault(); depth++; stage.classList.add('dragging'); });
  stage.addEventListener('dragover', (e) => { if (has(e)) e.preventDefault(); });
  stage.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; stage.classList.remove('dragging'); } });
  stage.addEventListener('drop', (e) => {
    if (!has(e)) return;
    e.preventDefault();
    depth = 0;
    stage.classList.remove('dragging');
    handleFiles(e.dataTransfer.files);
  });
}

function buildDots(box, list, key, out) {
  for (const [id, name, color] of list) {
    const b = el('button', { type: 'button', class: 'dot', role: 'radio', 'aria-checked': String(state[key] === id), 'aria-label': name, title: name, 'data-id': id });
    b.style.setProperty('--c', color);
    b.addEventListener('click', () => {
      state[key] = id;
      box.querySelectorAll('.dot').forEach((d) => d.setAttribute('aria-checked', String(d === b)));
      $(out).textContent = name;
      const it = state.items.find((i) => i.id === state.sel);
      const fits = it && (key === 'hl' ? ['highlight', 'note'] : ['text', 'ink']).includes(it.type);
      if (fits && it.color !== id) { pushUndo(); it.color = id; renderOverlay(it.page); }
      if (key === 'ink' && $('#sig').open) drawPad();
    });
    box.append(b);
  }
}

// ---------- init ----------
function init() {
  bindDialogs();
  const tb = $('#tool-buttons');
  for (const t of TOOLS) {
    const b = el('button', { type: 'button', class: 'tbtn', 'data-tool': t.id, 'aria-pressed': String(t.id === state.tool), 'aria-label': t.label, title: t.label, html: `${svg(t.icon)}<span>${t.label}</span>` });
    b.addEventListener('click', () => setTool(t.id));
    tb.append(b);
  }
  $('#pages').dataset.tool = state.tool;
  buildDots($('#hl-colors'), HL, 'hl', '#o-hl');
  buildDots($('#ink-colors'), INK, 'ink', '#o-ink');
  buildOps();
  selectOp('images');
  bindPad();
  bindDrop();

  sign = initSign({ tab: () => state.tab, setSrc, setStage: (t, s) => { if (state.tab !== 'sign') return; $('#stage-title').innerHTML = t; $('#stage-sub').textContent = s; } });
  for (const t of TABS) {
    $(`#t-${t}`).addEventListener('click', () => showTab(t));
    $(`#p-${t}`).addEventListener('click', () => showTab(t));
  }
  $('#pdf-in').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { if (state.tab === 'convert') showTab('edit'); openFile(f); } });
  $('#conv-in').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; addToQueue(fs); });
  $('#sample').addEventListener('click', openSample);
  $('#sig-sel').addEventListener('click', openSig);
  $('#undo').addEventListener('click', undo);
  $('#delete').addEventListener('click', removeSelected);
  $('#zoom-in').addEventListener('click', () => state.doc && setZoom(state.zoom * 1.2));
  $('#zoom-out').addEventListener('click', () => state.doc && setZoom(state.zoom / 1.2));
  $('#zoom-label').addEventListener('dblclick', fitZoom);
  $('#save').addEventListener('click', save);
  $('#convert').addEventListener('click', runConvert);
  $('#ask').addEventListener('click', ask);
  $('#queue-clear').addEventListener('click', () => { state.queue.forEach((q) => q.url && URL.revokeObjectURL(q.url)); state.queue = []; renderQueue(); });
  $('#results-clear').addEventListener('click', () => { state.results = []; $('#results').innerHTML = ''; $('#results-head').hidden = true; $('#text-out').value = ''; $('#text-out-wrap').hidden = true; });

  const bindRange = (id, out, fmt, key) => $(id).addEventListener('input', (e) => {
    const v = Number(e.target.value);
    if (key) state[key] = v;
    $(out).textContent = fmt(v);
  });
  bindRange('#text-size', '#o-size', (v) => `${v} pt`, 'size');
  bindRange('#pen-width', '#o-pen', (v) => `${v} pt`, 'pen');
  bindRange('#quality', '#o-quality', (v) => `${Math.round(v * 100)}%`);
  const qChars = () => ($('#o-q').textContent = `${$('#question').value.length} / 500`);
  $('#question').addEventListener('input', qChars);
  $('#question').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (state.tab !== 'edit' || !state.doc || t.closest?.('input, textarea, select, [contenteditable], dialog')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel) { e.preventDefault(); removeSelected(); }
    else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key === 'Escape' && state.sel) select(null);
    else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const k = { v: 'select', h: 'highlight', t: 'text', d: 'draw', s: 'sign', n: 'note' }[e.key.toLowerCase()];
      if (k) setTool(k);
    }
  });
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (state.doc && state.fit && state.tab === 'edit') fitZoom(); }, 150); });

  const p = new URLSearchParams(location.search);
  const tab = p.get('tab') || location.hash.slice(1);
  if (['convert', 'ask', 'sign'].includes(tab)) showTab(tab);
  if (p.get('op') && OPS.some((o) => o.id === p.get('op'))) selectOp(p.get('op'));
  if (p.has('sample')) openSample();

  window.massless = { state: { ...state, recording: false }, live: state, T, openBytes, makeSample, editedBytes, runConvert, setTool, selectOp, showTab, addToQueue, ask, sign };
}

init();
