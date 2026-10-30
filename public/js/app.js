import { Renderer, OVERSCAN } from './renderer.js';
import { MOVES, GROUPS, moveById } from './moves.js';
import { estimateDepth, depthStats, depthBackend, backgroundLayer, refine } from './depth.js';
import { shoot, ENGINES } from './engines.js';
import { recordMove, recordSegments } from './recorder.js';
import { calibrationScene } from './scene.js';
import * as store from './store.js';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) n.append(k);
  return n;
};

const DEPTH_RANGE = { 8: [0.38, 1.9], 14: [0.42, 1.75], 24: [0.5, 1.6], 35: [0.55, 1.5], 50: [0.6, 1.42], 85: [0.7, 1.28], 135: [0.8, 1.18] };

const FINISH_CONTROLS = [
  { key: 'dof', label: 'Added depth of field', min: 0, max: 1, step: 0.01 },
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.01 },
  { key: 'halation', label: 'Halation', min: 0, max: 1, step: 0.01 },
  { key: 'streak', label: 'Streak flares', min: 0, max: 1, step: 0.01 },
  { key: 'ca', label: 'Chromatic aberration', min: 0, max: 1, step: 0.01 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01 },
  { key: 'distort', label: 'Lens distortion', min: 0, max: 0.8, step: 0.01 },
  { key: 'exposure', label: 'Exposure', min: 0.6, max: 1.5, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: 0.6, max: 1.5, step: 0.01 },
  { key: 'sat', label: 'Saturation', min: 0, max: 1.6, step: 0.01 },
  { key: 'warm', label: 'Warmth', min: -0.8, max: 0.8, step: 0.01 },
  { key: 'fade', label: 'Lifted blacks', min: 0, max: 0.3, step: 0.005 },
  { key: 'vhs', label: 'Tape', min: 0, max: 1, step: 0.01 },
];

const state = {
  rig: null,
  sel: { camera: '35mm', lens: 'anamorphic', focal: 50, aperture: '1.4', shot: 'ms', angle: 'eye', light: 'neon', stock: 'blockbuster', aspect: '239', genre: 'none', palette: 'natural' },
  takes: 1,
  board: [],
  moveGroup: 'all',
  boardBusy: false,
  activeCard: null,
  promptEdited: false,
  move: 'dolly-in',
  duration: 4,
  intensity: 1,
  outSize: 1280,
  fps: 24,
  playing: true,
  overrides: {},
  focusOverride: null,
  stats: { subject: 0.7, near: 0.95, far: 0.1 },
  zoom: 1,
  gradeMix: 1,
  source: 'Calibration scene',
  busy: false,
  presetIndex: 0,
  current: null, // { id, image, depth }
  recording: false,
};

let renderer;
let rafId = 0;
let loopStart = performance.now();

// ---------- rig data and prompt compiler ----------

const find = (group, key) => {
  const list = state.rig[group];
  if (group === 'focal') return list.find((x) => x.mm === Number(key));
  if (group === 'aperture') return list.find((x) => x.f === String(key));
  return list.find((x) => x.id === key);
};

function compilePrompt() {
  const s = state.sel;
  const subject = $('#subject').value.trim() || 'a lone traveler with a lantern on a desert ridge at dusk';
  const parts = [
    subject.replace(/[.\s]+$/, ''),
    find('genre', s.genre).prompt,
    find('shot', s.shot).prompt,
    find('angle', s.angle).prompt,
    find('camera', s.camera).prompt,
    find('lens', s.lens).prompt,
    find('focal', s.focal).prompt,
    find('aperture', s.aperture).prompt,
    find('light', s.light).prompt,
    find('stock', s.stock).prompt,
    find('palette', s.palette).prompt,
    'cinematic film still, high detail, no text',
  ];
  return parts.filter(Boolean).join(', ');
}

function refreshPrompt(force = false) {
  if (!state.promptEdited || force) {
    $('#compiled-text').value = compilePrompt();
    state.promptEdited = false;
  }
}

// ---------- finishing ----------

function rigFinish() {
  const s = state.sel;
  const cam = find('camera', s.camera);
  const lens = find('lens', s.lens);
  const stock = find('stock', s.stock);
  const light = find('light', s.light);
  const focal = find('focal', s.focal);
  const g = state.gradeMix;
  return {
    grain: cam.finish.grain,
    weave: cam.finish.weave,
    vhs: cam.finish.vhs,
    fade: Math.max(cam.finish.fade, stock.grade.fade) * g,
    halation: lens.finish.halation,
    streak: lens.finish.streak,
    ovalBokeh: lens.finish.ovalBokeh,
    ca: lens.finish.ca,
    soft: lens.finish.soft,
    tilt: lens.id === 'tiltshift' ? 1 : 0,
    distort: focal.distort,
    sat: 1 + (stock.grade.sat - 1) * g,
    contrast: 1 + (stock.grade.contrast - 1) * g,
    tealOrange: stock.grade.tealOrange * g,
    mono: stock.grade.mono * g,
    warm: (stock.grade.warm + light.warm * 0.35) * g,
    vignette: 0.25 + cam.finish.grain * 0.2,
    exposure: 1,
    // generated frames already carry the model's own depth of field, so add less on top
    dof: g < 1 ? 0.35 : 1,
  };
}

function finish() {
  return { ...rigFinish(), ...state.overrides };
}

function apertureBlur() {
  const lens = find('lens', state.sel.lens);
  let b = find('aperture', state.sel.aperture).blur;
  if (lens.id === 'macro') b = Math.min(1, b * 1.25 + 0.1);
  if (lens.id === 'tiltshift') b = Math.max(b, 0.7);
  return b * (finish().dof ?? 1);
}

// ---------- camera ----------

function moveCtx() {
  return {
    D: renderer.restDistance,
    sSub: renderer.sFor(state.stats.subject),
    focusSub: state.focusOverride ?? state.stats.subject,
    focusNear: state.stats.near,
    focusFar: state.stats.far,
    k: state.intensity,
    blur: apertureBlur(),
  };
}

function applyZoom(cam) {
  if (state.zoom <= 1) return cam;
  const f = (2 * Math.atan(Math.tan((cam.fov * Math.PI) / 360) / state.zoom) * 180) / Math.PI;
  return { ...cam, fov: f };
}

function updateZoom() {
  const move = moveById(state.move);
  const ctx = moveCtx();
  const cams = [];
  for (let i = 0; i <= 30; i++) cams.push(move.fn(i / 30, ctx));
  state.zoom = renderer.requiredZoom(cams, renderer.canvas.width / renderer.canvas.height);
}

function applyDepthRange() {
  const [n, f] = DEPTH_RANGE[state.sel.focal] || [0.55, 1.5];
  renderer.setDepthRange(n, f);
}

function drawFrame(t, time) {
  const move = moveById(state.move);
  const cam = applyZoom(move.fn(t, moveCtx()));
  renderer.render(cam, finish(), time);
}

// ---------- storyboard shots: everything needed to render a shot on its own ----------

function cardCtx(card) {
  return {
    D: renderer.restDistance,
    sSub: renderer.sFor(card.stats.subject),
    focusSub: card.focus ?? card.stats.subject,
    focusNear: card.stats.near,
    focusFar: card.stats.far,
    k: card.intensity,
    blur: card.blur,
  };
}

function zoomFor(move, ctx) {
  const cams = [];
  for (let i = 0; i <= 30; i++) cams.push(move.fn(i / 30, ctx));
  return renderer.requiredZoom(cams, renderer.canvas.width / renderer.canvas.height);
}

/** Load a card's picture and depth into the renderer and fit its move to the current canvas. */
function enterCard(card) {
  renderer.setImage(card.image);
  renderer.setBackgroundColor(card.depth.bgColor || card.image);
  renderer.setDepthRange(card.range[0], card.range[1]);
  renderer.setDepth(card.depth.data, card.depth.w, card.depth.h, card.depth.bg);
  card.zoom = zoomFor(moveById(card.move), cardCtx(card));
}

function drawCard(card, t, time) {
  let cam = moveById(card.move).fn(t, cardCtx(card));
  if (card.zoom > 1) cam = { ...cam, fov: (2 * Math.atan(Math.tan((cam.fov * Math.PI) / 360) / card.zoom) * 180) / Math.PI };
  renderer.render(cam, card.fx, time);
}

/** Put the shot being edited back into the renderer. */
function enterLive() {
  const cur = state.current;
  if (!cur) return;
  renderer.setImage(cur.image);
  renderer.setBackgroundColor(cur.depth?.bgColor || cur.image);
  applyDepthRange();
  if (cur.depth) renderer.setDepth(cur.depth.data, cur.depth.w, cur.depth.h, cur.depth.bg);
  setPreviewSize();
  updateZoom();
}

function loop(now) {
  rafId = requestAnimationFrame(loop);
  if (state.recording) return;
  const move = moveById(state.move);
  const hold = move.id === 'float' ? 0 : 0.7;
  const period = state.duration + hold;
  const el = (now - loopStart) / 1000;
  const t = state.playing ? Math.min(1, (el % period) / state.duration) : 0;
  drawFrame(t, now / 1000);
}

function startLoop() {
  cancelAnimationFrame(rafId);
  loopStart = performance.now();
  rafId = requestAnimationFrame(loop);
}

// ---------- canvas sizing ----------

function sizeFor(aspect, longSide) {
  return aspect >= 1 ? [longSide, longSide / aspect] : [longSide * aspect, longSide];
}

function setPreviewSize() {
  const long = Math.min(state.outSize, window.innerWidth < 760 ? 1024 : 1280);
  const [w, h] = sizeFor(renderer.aspect, long);
  renderer.setSize(w, h);
  $('#viewfinder').style.aspectRatio = `${renderer.aspect}`;
}

// ---------- loading images ----------

function status(text, fraction = null) {
  const box = $('#vf-status');
  if (!text) { box.hidden = true; return; }
  box.hidden = false;
  $('#vf-status-text').textContent = text;
  const meter = box.querySelector('.meter');
  if (fraction == null) {
    meter.classList.add('indeterminate');
    $('#meter-fill').style.width = '';
  } else {
    meter.classList.remove('indeterminate');
    $('#meter-fill').style.width = `${Math.round(fraction * 100)}%`;
  }
}

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), kind === 'error' ? 7000 : 3800);
}

function setSourceLabel(label) {
  state.source = label;
  $('#hud-source').textContent = label;
}

async function useDepth(depth) {
  if (!depth.bg && state.current?.image) {
    const layer = backgroundLayer(state.current.image, depth.data, depth.w, depth.h);
    depth.bg = layer.bgDepth;
    depth.bgColor = layer.bgColor;
  }
  renderer.setDepth(depth.data, depth.w, depth.h, depth.bg);
  if (depth.bgColor) renderer.setBackgroundColor(depth.bgColor);
  state.stats = depthStats(depth.data, depth.w, depth.h);
  state.focusOverride = null;
  updateZoom();
}

async function loadImage(image, { label, gradeMix = 1, depth = null, id = null } = {}) {
  renderer.setImage(image);
  renderer.setBackgroundColor(image);
  state.gradeMix = gradeMix;
  setPreviewSize();
  applyDepthRange();
  setSourceLabel(label);
  state.current = { id, image, depth };
  if (depth) {
    await useDepth(depth);
    return;
  }
  // render immediately with flat depth while the model works
  const flat = { data: new Uint8Array([128]), w: 1, h: 1 };
  renderer.setDepth(flat.data, 1, 1);
  state.stats = { subject: 0.5, near: 0.5, far: 0.5 };
  updateZoom();
  status('Reading depth on your device', null);
  const d = await estimateDepth(image, (f, msg) => status(msg, f));
  status(null);
  if (d.source === 'estimate') {
    toast('The depth model could not load here, so Massless guessed the depth. Moves still work, with less accuracy.', 'error');
  } else if (depthBackend()) {
    $('#hud-source').textContent = `${label}, depth on ${depthBackend()}`;
  }
  state.current.depth = d;
  if (id) depthCache.set(id, d);
  await useDepth(d);
  return d;
}

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    toast('That file is not an image. Use a JPEG, PNG or WebP.', 'error');
    return;
  }
  try {
    const bmp = await createImageBitmap(file);
    const max = 2048;
    let src = bmp;
    if (Math.max(bmp.width, bmp.height) > max) {
      const s = max / Math.max(bmp.width, bmp.height);
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s);
      c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      src = c;
    }
    const id = await addShot(src, { prompt: file.name, engine: 'upload' });
    await loadImage(src, { label: 'Your still', gradeMix: 1, id });
  } catch (e) {
    toast(`Could not open that image: ${e.message}`, 'error');
  }
}

// ---------- shooting ----------

const ENGINE_LABEL = { pollinations: 'FLUX.1 schnell via Pollinations', workers: 'FLUX.1 schnell via Cloudflare', comfy: 'FLUX.1 schnell on your ComfyUI' };

function renderTakes(takes, total, chosenId) {
  const strip = $('#takes-strip');
  const list = $('#takes-list');
  if (total <= 1) { strip.hidden = true; return; }
  strip.hidden = false;
  $('#takes-label').textContent = takes.length < total ? `Takes: ${takes.length} of ${total} ready. Click one to make it the hero frame.` : 'Takes. Click one to make it the hero frame.';
  list.innerHTML = '';
  takes.forEach((tk, i) => {
    const b = el('button', { type: 'button', class: 'take', 'aria-pressed': String(tk.id === chosenId), title: `Use take ${i + 1}` }, el('img', { src: tk.thumbUrl, alt: `Take ${i + 1}` }), el('span', {}, `Take ${i + 1}`));
    b.addEventListener('click', async () => {
      list.querySelectorAll('.take').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      await loadTake(tk);
    });
    list.append(el('li', {}, b));
  });
  for (let i = takes.length; i < total; i++) list.append(el('li', {}, el('div', { class: 'take pending' }, `Take ${i + 1} rendering`)));
}

async function loadTake(tk) {
  const cached = depthCache.get(tk.id);
  await loadImage(tk.image, { label: tk.label, gradeMix: 0.45, depth: cached, id: tk.id });
}

async function doShoot(e) {
  e?.preventDefault();
  if (state.busy) return;
  state.busy = true;
  const btn = $('#shoot');
  btn.disabled = true;
  const prompt = $('#compiled-text').value.trim() || compilePrompt();
  const aspect = find('aspect', state.sel.aspect);
  const engine = $('#engine').value;
  const total = state.takes;
  const takes = [];
  let firstLoad = null;
  renderTakes(takes, total, null);
  try {
    for (let i = 0; i < total; i++) {
      btn.textContent = total > 1 ? `Take ${i + 1} of ${total}` : 'Shooting';
      status(total > 1 ? `Rendering take ${i + 1} of ${total} with ${ENGINES[engine].name}` : `Rendering with ${ENGINES[engine].name}`, null);
      const res = await shoot({
        engine,
        prompt,
        w: aspect.w,
        h: aspect.h,
        seed: Math.floor(Math.random() * 2 ** 31),
        comfyUrl: $('#comfy-url').value,
        ckpt: $('#comfy-ckpt').value,
        onWait: (ms) => ms > 0 && status(`Free tier: next frame in ${Math.ceil(ms / 1000)} s`, null),
        onFallback: () => status('Pollinations is busy, switching to Cloudflare Workers AI', null),
      });
      const label = ENGINE_LABEL[res.engine];
      const id = await addShot(res.image, { prompt, engine: res.engine, rig: { ...state.sel } });
      const thumbUrl = URL.createObjectURL(await thumbOf(res.image, 240));
      takes.push({ id, image: res.image, label, thumbUrl });
      renderTakes(takes, total, takes[0].id);
      if (i === 0) {
        status(null);
        // show the first take right away; later takes keep rendering meanwhile
        firstLoad = loadImage(res.image, { label, gradeMix: 0.45, id });
      }
    }
    await firstLoad;
    toast(total > 1 ? `${total} takes ready. Pick your hero frame, then a camera move.` : 'Shot ready. Pick a camera move, then record or add it to the storyboard.');
  } catch (err) {
    status(null);
    toast(err.message || 'The shot failed. Try again.', 'error');
    renderTakes(takes, takes.length, takes[0]?.id);
  } finally {
    state.busy = false;
    btn.disabled = false;
    btn.textContent = 'Shoot';
  }
}

// ---------- reel ----------

async function thumbOf(image, max = 360) {
  const s = max / Math.max(image.width, image.height);
  const c = document.createElement('canvas');
  c.width = Math.round(image.width * s);
  c.height = Math.round(image.height * s);
  c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
  return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
}

async function toJpeg(image) {
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  c.getContext('2d').drawImage(image, 0, 0);
  return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
}

async function addShot(image, meta) {
  const id = `shot-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const item = { id, kind: 'shot', created: Date.now(), ...meta, blob: await toJpeg(image), thumb: await thumbOf(image) };
  await store.put(item).catch(() => {});
  renderReelItem(item, true);
  return id;
}

function renderReelItem(item, prepend = false) {
  $('#reel-empty').hidden = true;
  const list = $('#reel-list');
  const url = URL.createObjectURL(item.thumb || item.blob);
  let li;
  if (item.kind === 'clip') {
    const vurl = URL.createObjectURL(item.blob);
    li = el('li', { class: 'reel-item' },
      el('video', { src: vurl, muted: true, loop: true, playsinline: true, autoplay: true }),
      el('div', { class: 'meta' }, el('span', {}, `${item.move}, ${item.seconds}s`), el('a', { href: vurl, download: `massless-${item.moveId || 'clip'}.${item.ext}` }, 'Download')));
  } else {
    li = el('li', { class: 'reel-item' },
      el('button', { class: 'thumb', type: 'button', title: 'Load this shot', onclick: () => reloadShot(item) }, el('img', { src: url, alt: item.prompt || 'Shot' })),
      el('div', { class: 'meta' }, el('span', {}, item.engine === 'upload' ? 'Your still' : 'Shot'), el('a', { href: URL.createObjectURL(item.blob), download: `${item.id}.jpg` }, 'JPEG')));
  }
  if (prepend) list.prepend(li);
  else list.append(li);
}

async function reloadShot(item) {
  if (state.current?.id === item.id) return;
  const bmp = await createImageBitmap(item.blob);
  const cached = depthCache.get(item.id);
  const label = item.engine === 'upload' ? 'Your still' : 'Shot from the reel';
  const d = await loadImage(bmp, { label, gradeMix: item.engine === 'upload' ? 1 : 0.45, depth: cached, id: item.id });
  if (d) depthCache.set(item.id, d);
}

const depthCache = new Map();

// ---------- UI construction ----------

function radioGroup(container, items, getKey, render, onPick, current) {
  const wrap = el('div', { class: 'opts', role: 'radiogroup' });
  for (const it of items) {
    const key = getKey(it);
    const b = el('button', { type: 'button', class: 'opt', role: 'radio', 'aria-checked': String(String(key) === String(current)), 'data-key': key }, ...render(it));
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.opt').forEach((x) => x.setAttribute('aria-checked', 'false'));
      b.setAttribute('aria-checked', 'true');
      onPick(key);
    });
    wrap.append(b);
  }
  container.append(wrap);
  return wrap;
}

function setGroupValue(container, key) {
  container.querySelectorAll('.opt').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.key === String(key))));
}

function onRigChange(group, key) {
  state.sel[group] = group === 'focal' ? Number(key) : key;
  refreshPrompt();
  updateHud();
  if (group === 'focal') {
    applyDepthRange();
    updateZoom();
  }
  if (['camera', 'lens', 'stock', 'light', 'focal'].includes(group)) {
    state.overrides = {};
    buildFinishSliders();
  }
}

const APERTURE_NOTE = { '1.4': 'Very shallow focus', '2.8': 'Shallow focus', '5.6': 'Moderate depth', '11': 'Deep focus' };

function popGroups() {
  const R = state.rig;
  return {
    camera: { title: 'Camera body', items: R.camera, key: (x) => x.id, render: (x) => [el('strong', {}, x.name), el('small', {}, x.note)] },
    lens: { title: 'Lens', items: R.lens, key: (x) => x.id, render: (x) => [el('strong', {}, x.name), el('small', {}, x.note)] },
    aperture: { title: 'Aperture', items: R.aperture, key: (x) => x.f, render: (x) => [el('strong', {}, `f/${x.f}`), el('small', {}, APERTURE_NOTE[x.f] || '')] },
    aspect: { title: 'Frame', items: R.aspect, key: (x) => x.id, render: (x) => [el('strong', {}, x.name), el('small', {}, x.ratio >= 1 ? 'Landscape' : 'Portrait')] },
  };
}

function updateChips() {
  $('#chip-camera').textContent = find('camera', state.sel.camera).name;
  $('#chip-lens').textContent = find('lens', state.sel.lens).name;
  $('#chip-aperture').textContent = `f/${state.sel.aperture}`;
  $('#chip-aspect').textContent = find('aspect', state.sel.aspect).name;
}

let popOwner = null;
function closePop() {
  $('#pop').hidden = true;
  if (popOwner) popOwner.setAttribute('aria-expanded', 'false');
  popOwner = null;
}

function openPop(group, chip) {
  if (popOwner === chip) { closePop(); return; }
  closePop();
  const g = popGroups()[group];
  const pop = $('#pop');
  pop.innerHTML = '';
  pop.append(el('h3', {}, g.title));
  radioGroup(pop, g.items, g.key, g.render, (k) => {
    onRigChange(group, k);
    updateChips();
    closePop();
    chip.focus();
  }, state.sel[group]);
  const composer = $('#slate');
  const left = Math.max(10, Math.min(chip.offsetLeft, composer.clientWidth - Math.min(560, composer.clientWidth - 20) - 10));
  pop.style.left = `${left}px`;
  pop.style.top = `${chip.offsetTop + chip.offsetHeight + 8}px`;
  pop.hidden = false;
  chip.setAttribute('aria-expanded', 'true');
  popOwner = chip;
  pop.querySelector('[aria-checked="true"]')?.focus();
}

function buildRig() {
  const R = state.rig;
  radioGroup($('#g-genre'), R.genre, (x) => x.id, (x) => [x.name], (k) => onRigChange('genre', k), state.sel.genre);
  radioGroup($('#g-shot'), R.shot, (x) => x.id, (x) => [x.name], (k) => onRigChange('shot', k), state.sel.shot);
  radioGroup($('#g-angle'), R.angle, (x) => x.id, (x) => [x.name], (k) => onRigChange('angle', k), state.sel.angle);
  radioGroup($('#g-light'), R.light, (x) => x.id, (x) => [x.name], (k) => onRigChange('light', k), state.sel.light);
  radioGroup($('#g-palette'), R.palette, (x) => x.id, (x) => [x.name], (k) => onRigChange('palette', k), state.sel.palette);
  radioGroup($('#g-stock'), R.stock, (x) => x.id, (x) => [x.name], (k) => onRigChange('stock', k), state.sel.stock);
  document.querySelectorAll('[data-pop]').forEach((chip) => chip.addEventListener('click', () => openPop(chip.dataset.pop, chip)));
  document.addEventListener('click', (e) => {
    if (!popOwner) return;
    if ($('#pop').contains(e.target) || popOwner.contains(e.target)) return;
    closePop();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popOwner) { const c = popOwner; closePop(); c.focus(); } });
  updateChips();

  const ring = $('#lens-ring');
  for (const f of R.focal) {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(f.mm === state.sel.focal), 'aria-label': `${f.mm} millimeter`, 'data-key': f.mm }, String(f.mm));
    b.addEventListener('click', () => pickFocal(f.mm));
    ring.append(b);
  }
  ring.addEventListener('keydown', (e) => {
    const list = R.focal.map((x) => x.mm);
    const i = list.indexOf(state.sel.focal);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); pickFocal(list[Math.min(list.length - 1, i + 1)], true); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); pickFocal(list[Math.max(0, i - 1)], true); }
  });
  // drag across the ring to scrub focal length
  let dragging = false;
  const scrub = (x) => {
    const rect = ring.getBoundingClientRect();
    const fr = Math.min(0.999, Math.max(0, (x - rect.left) / rect.width));
    pickFocal(R.focal[Math.floor(fr * R.focal.length)].mm);
  };
  ring.addEventListener('pointerdown', (e) => { dragging = true; ring.setPointerCapture(e.pointerId); scrub(e.clientX); });
  ring.addEventListener('pointermove', (e) => dragging && scrub(e.clientX));
  ring.addEventListener('pointerup', () => (dragging = false));
}

function pickFocal(mm, focus = false) {
  if (mm === state.sel.focal) return;
  const ring = $('#lens-ring');
  ring.querySelectorAll('button').forEach((b) => {
    const on = Number(b.dataset.key) === mm;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  onRigChange('focal', mm);
}

function selectMove(id) {
  const m = moveById(id);
  $('#move-grid').querySelectorAll('.move').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.key === m.id)));
  state.move = m.id;
  state.duration = m.duration;
  $('#duration').value = m.duration;
  $('#o-duration').textContent = `${m.duration.toFixed(1)} s`;
  updateZoom();
  updateHud();
  state.playing = true;
  $('#play').textContent = 'Pause preview';
  startLoop();
}

function buildMoves() {
  const grid = $('#move-grid');
  const groups = $('#move-groups');
  for (const g of GROUPS) {
    const b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(g.id === state.moveGroup), 'data-group': g.id }, g.name);
    b.addEventListener('click', () => {
      state.moveGroup = g.id;
      groups.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      grid.querySelectorAll('.move').forEach((x) => (x.hidden = g.id !== 'all' && x.dataset.group !== g.id));
    });
    groups.append(b);
  }
  for (const m of MOVES) {
    const svg = `<svg viewBox="6 6 36 28" aria-hidden="true"><rect class="stage" x="9" y="9" width="30" height="22" rx="3"/><path class="path" d="${m.icon}"/></svg>`;
    const b = el('button', { type: 'button', class: 'move', role: 'radio', 'aria-checked': String(m.id === state.move), title: m.hint, 'data-key': m.id, 'data-group': m.group });
    b.innerHTML = `${svg}<span>${m.name}</span>`;
    b.addEventListener('click', () => selectMove(m.id));
    grid.append(b);
  }
}

function buildFinishSliders() {
  const box = $('#finish-sliders');
  box.innerHTML = '';
  const f = finish();
  for (const c of FINISH_CONTROLS) {
    const out = el('output', {}, Number(f[c.key] ?? 0).toFixed(2));
    const input = el('input', { type: 'range', min: c.min, max: c.max, step: c.step, value: f[c.key] ?? 0, 'aria-label': c.label });
    input.addEventListener('input', () => {
      state.overrides[c.key] = Number(input.value);
      out.textContent = Number(input.value).toFixed(2);
    });
    box.append(el('label', { class: 'slider' }, el('span', {}, c.label, out), input));
  }
}

function updateHud() {
  $('#hud-focal').textContent = state.sel.focal;
  $('#hud-f').textContent = state.sel.aperture;
  const a = find('aspect', state.sel.aspect).name.split(':');
  $('#hud-aspect').textContent = a[0];
  $('#hud-aspect-unit').textContent = `:${a[1]}`;
  $('#hud-move').textContent = moveById(state.move).name;
}

function applyPreset(p) {
  $('#subject').value = p.subject;
  for (const [g, k] of Object.entries(p.rig)) {
    state.sel[g] = g === 'focal' ? Number(k) : k;
    const box = $(`#g-${g}`);
    if (box) setGroupValue(box, k);
  }
  $('#lens-ring').querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.key) === state.sel.focal)));
  updateChips();
  state.overrides = {};
  refreshPrompt(true);
  updateHud();
  applyDepthRange();
  updateZoom();
  buildFinishSliders();
  toast(`${p.name} loaded. Press Shoot to render it.`);
}

function bindUI() {
  $('#slate').addEventListener('submit', doShoot);
  $('#subject').addEventListener('input', () => refreshPrompt());
  $('#subject').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) doShoot(e);
  });
  $('#compiled-text').addEventListener('input', () => (state.promptEdited = true));
  $('#surprise').addEventListener('click', () => {
    const list = state.rig.presets;
    applyPreset(list[state.presetIndex % list.length]);
    state.presetIndex++;
  });
  $('#upload').addEventListener('change', (e) => loadFile(e.target.files[0]));
  $('#engine').addEventListener('change', (e) => {
    $('#comfy-settings').hidden = e.target.value !== 'comfy';
    try { localStorage.setItem('massless.engine', e.target.value); } catch {}
  });
  for (const id of ['comfy-url', 'comfy-ckpt']) {
    $(`#${id}`).addEventListener('change', (e) => { try { localStorage.setItem(`massless.${id}`, e.target.value); } catch {} });
  }

  $('#duration').addEventListener('input', (e) => {
    state.duration = Number(e.target.value);
    $('#o-duration').textContent = `${state.duration.toFixed(1)} s`;
  });
  $('#intensity').addEventListener('input', (e) => {
    state.intensity = Number(e.target.value);
    $('#o-intensity').textContent = `${Math.round(state.intensity * 100)}%`;
    updateZoom();
  });
  $('#out-size').addEventListener('change', (e) => { state.outSize = Number(e.target.value); setPreviewSize(); updateZoom(); });
  $('#out-fps').addEventListener('change', (e) => (state.fps = Number(e.target.value)));
  $('#play').addEventListener('click', () => {
    state.playing = !state.playing;
    $('#play').textContent = state.playing ? 'Pause preview' : 'Play preview';
    startLoop();
  });
  $('#record').addEventListener('click', doRecord);
  document.querySelectorAll('[data-takes]').forEach((b) => b.addEventListener('click', () => {
    state.takes = Number(b.dataset.takes);
    document.querySelectorAll('[data-takes]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  }));
  $('#board-add').addEventListener('click', addToBoard);
  $('#board-play').addEventListener('click', playBoard);
  $('#board-export').addEventListener('click', exportBoard);
  $('#still').addEventListener('click', async () => {
    const blob = await renderer.readPixelsPNG();
    download(blob, `massless-frame-${Date.now()}.png`);
  });
  $('#finish-reset').addEventListener('click', () => { state.overrides = {}; buildFinishSliders(); });

  // tap to focus
  const canvas = $('#view');
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const cx = (e.clientX - r.left) / r.width;
    const cy = 1 - (e.clientY - r.top) / r.height;
    const u = 0.5 + (cx - 0.5) / OVERSCAN / state.zoom;
    const v = 0.5 + (cy - 0.5) / OVERSCAN / state.zoom;
    state.focusOverride = renderer.depthAt(u, v);
    const mark = el('div', { class: 'focus-mark' });
    mark.style.left = `${e.clientX - r.left}px`;
    mark.style.top = `${e.clientY - r.top}px`;
    $('#viewfinder').append(mark);
    setTimeout(() => mark.remove(), 950);
  });

  // drag and drop, paste
  const vf = $('#viewfinder');
  const hint = $('#drop-hint');
  ['dragenter', 'dragover'].forEach((t) => vf.addEventListener(t, (e) => { e.preventDefault(); hint.hidden = false; }));
  ['dragleave', 'drop'].forEach((t) => vf.addEventListener(t, (e) => { e.preventDefault(); hint.hidden = true; }));
  vf.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });

  // dialogs
  document.querySelectorAll('[data-dialog]').forEach((b) => b.addEventListener('click', () => $(`#${b.dataset.dialog}`).showModal()));
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

  // phone tabs
  const tabs = [...document.querySelectorAll('.tabs [role=tab]')];
  const showTab = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
  };
  tabs.forEach((t) => t.addEventListener('click', () => showTab(t)));
  const mq = window.matchMedia('(max-width: 760px)');
  const syncTabs = () => {
    if (mq.matches) showTab(tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0]);
    else tabs.forEach((t) => (document.getElementById(t.getAttribute('aria-controls')).hidden = false));
  };
  mq.addEventListener('change', syncTabs);
  syncTabs();

  window.addEventListener('resize', () => setPreviewSize());
}

function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

function timecode(sec, fps) {
  const s = Math.floor(sec);
  const f = Math.floor((sec - s) * fps);
  const pad = (n) => String(n).padStart(2, '0');
  return `00:${pad(s)}:${pad(f)}`;
}

async function doRecord() {
  if (state.recording) return;
  if (!renderer.hasImage) return;
  state.recording = true;
  const btn = $('#record');
  btn.classList.add('is-recording');
  btn.disabled = true;
  $('#tally').hidden = false;
  const [w, h] = sizeFor(renderer.aspect, state.outSize);
  renderer.setSize(w, h);
  updateZoom();
  const move = moveById(state.move);
  try {
    const res = await recordMove(renderer.canvas, {
      duration: state.duration,
      fps: state.fps,
      draw: (t, time) => {
        drawFrame(t, time);
        $('#timecode').textContent = timecode(time, state.fps);
      },
      onProgress: (f) => (btn.lastChild.textContent = `Recording ${Math.round(f * 100)}%`),
    });
    const item = { id: `clip-${Date.now()}`, kind: 'clip', blob: res.blob, ext: res.ext, move: move.name, moveId: move.id, seconds: state.duration };
    renderReelItem(item, true);
    download(res.blob, `massless-${move.id}-${Date.now()}.${res.ext}`);
    toast(`Clip saved as ${res.ext.toUpperCase()} and added to the reel.`);
  } catch (e) {
    toast(`Recording failed: ${e.message}`, 'error');
  } finally {
    state.recording = false;
    btn.classList.remove('is-recording');
    btn.disabled = false;
    btn.lastChild.textContent = 'Record clip';
    $('#tally').hidden = true;
    setPreviewSize();
    updateZoom();
    startLoop();
  }
}

// ---------- storyboard ----------

let calibrationCache = null;
function calibrationImage() {
  if (!calibrationCache) {
    const scene = calibrationScene(1344, 560);
    calibrationCache = { image: scene.canvas, depth: { ...refine(scene.depth.data, scene.depth.w, scene.depth.h), source: 'exact' } };
  }
  return calibrationCache;
}

function saveBoard() {
  const slim = state.board.map(({ uid, shotId, move, duration, intensity, fx, blur, focus, range, label }) => ({ uid, shotId, move, duration, intensity, fx, blur, focus, range, label }));
  try { localStorage.setItem('massless.board', JSON.stringify(slim)); } catch {}
}

function boardTotal() {
  return state.board.reduce((a, c) => a + c.duration, 0);
}

function renderBoard() {
  const list = $('#board-list');
  list.innerHTML = '';
  $('#board-empty').hidden = state.board.length > 0;
  $('#board-play').disabled = state.board.length === 0;
  $('#board-export').disabled = state.board.length === 0;
  $('#board-total').textContent = state.board.length ? `${state.board.length} shot${state.board.length > 1 ? 's' : ''}, ${boardTotal().toFixed(1)} s` : '';
  state.board.forEach((card, i) => {
    const move = moveById(card.move);
    const li = el('li', { class: `shot-card${state.activeCard === card.uid ? ' active' : ''}`, 'data-uid': card.uid },
      el('button', { type: 'button', class: 'thumb', title: 'Open this shot', onclick: () => openCard(card) }, el('img', { src: card.thumbUrl || '', alt: `Shot ${i + 1}` })),
      el('div', { class: 'meta' }, el('strong', {}, String(i + 1)), el('span', {}, `${move.name}, ${card.duration.toFixed(1)} s`)),
      el('div', { class: 'ctrl' },
        el('button', { type: 'button', 'aria-label': `Move shot ${i + 1} earlier`, onclick: () => moveCard(i, -1), disabled: i === 0 }, '←'),
        el('button', { type: 'button', 'aria-label': `Move shot ${i + 1} later`, onclick: () => moveCard(i, 1), disabled: i === state.board.length - 1 }, '→'),
        el('button', { type: 'button', 'aria-label': `Remove shot ${i + 1}`, onclick: () => removeCard(i) }, '×')));
    list.append(li);
  });
}

function moveCard(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= state.board.length) return;
  [state.board[i], state.board[j]] = [state.board[j], state.board[i]];
  saveBoard();
  renderBoard();
}

function removeCard(i) {
  state.board.splice(i, 1);
  saveBoard();
  renderBoard();
}

async function addToBoard() {
  const cur = state.current;
  if (!cur?.depth) {
    toast('Wait for depth to finish, then add the shot.', 'error');
    return;
  }
  const card = {
    uid: `c${Date.now()}${Math.floor(Math.random() * 1e3)}`,
    shotId: cur.id,
    image: cur.image,
    depth: cur.depth,
    stats: { ...state.stats },
    move: state.move,
    duration: state.duration,
    intensity: state.intensity,
    fx: finish(),
    blur: apertureBlur(),
    focus: state.focusOverride ?? state.stats.subject,
    range: [...(DEPTH_RANGE[state.sel.focal] || [0.55, 1.5])],
    label: state.source,
    thumbUrl: null,
  };
  // thumbnail: the move's own framing, rendered at 70% through
  const wasRecording = state.recording;
  state.recording = true;
  drawFrame(0.7, 0);
  card.thumbUrl = URL.createObjectURL(await thumbOf(renderer.canvas, 320));
  state.recording = wasRecording;
  state.board.push(card);
  state.activeCard = card.uid;
  saveBoard();
  renderBoard();
  toast(`Shot ${state.board.length} added: ${moveById(card.move).name}, ${card.duration.toFixed(1)} s.`);
  $('#board-list').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
}

async function ensureCardReady(card, i, n) {
  if (!card.image) return false;
  if (!card.depth) {
    card.depth = depthCache.get(card.shotId) || null;
    if (!card.depth) {
      status(`Reading depth for shot ${i + 1} of ${n}`, null);
      const d = await estimateDepth(card.image, (f, msg) => status(`${msg} (shot ${i + 1} of ${n})`, f));
      card.depth = d;
      depthCache.set(card.shotId, d);
    }
  }
  if (!card.depth.bg) {
    const layer = backgroundLayer(card.image, card.depth.data, card.depth.w, card.depth.h);
    card.depth.bg = layer.bgDepth;
    card.depth.bgColor = layer.bgColor;
  }
  if (!card.stats) card.stats = depthStats(card.depth.data, card.depth.w, card.depth.h);
  return true;
}

async function prepareBoard() {
  const n = state.board.length;
  for (let i = 0; i < n; i++) {
    const ok = await ensureCardReady(state.board[i], i, n);
    if (!ok) throw new Error(`Shot ${i + 1} is missing its picture. Remove it and add it again.`);
  }
  status(null);
}

function markPlaying(uid) {
  document.querySelectorAll('.shot-card').forEach((x) => x.classList.toggle('playing', x.dataset.uid === uid));
}

async function openCard(card) {
  if (state.boardBusy) return;
  const i = state.board.indexOf(card);
  try {
    await ensureCardReady(card, i, state.board.length);
    status(null);
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  await loadImage(card.image, { label: card.label || 'Storyboard shot', gradeMix: 1, depth: card.depth, id: card.shotId });
  state.overrides = { ...card.fx };
  state.focusOverride = card.focus;
  state.intensity = card.intensity;
  $('#intensity').value = card.intensity;
  $('#o-intensity').textContent = `${Math.round(card.intensity * 100)}%`;
  selectMove(card.move);
  state.duration = card.duration;
  $('#duration').value = card.duration;
  $('#o-duration').textContent = `${card.duration.toFixed(1)} s`;
  buildFinishSliders();
  state.activeCard = card.uid;
  renderBoard();
}

async function playBoard() {
  if (state.boardBusy) { state.stopBoard = true; return; }
  if (!state.board.length) return;
  state.boardBusy = true;
  state.stopBoard = false;
  state.recording = true;
  const btn = $('#board-play');
  btn.textContent = 'Stop';
  try {
    await prepareBoard();
    for (const card of state.board) {
      if (state.stopBoard) break;
      enterCard(card);
      markPlaying(card.uid);
      const start = performance.now();
      await new Promise((resolve) => {
        const step = (now) => {
          const el2 = (now - start) / 1000;
          if (state.stopBoard || el2 >= card.duration) { resolve(); return; }
          drawCard(card, el2 / card.duration, now / 1000);
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    markPlaying(null);
    status(null);
    btn.textContent = 'Play';
    state.boardBusy = false;
    state.recording = false;
    enterLive();
    startLoop();
  }
}

async function exportBoard() {
  if (state.boardBusy || !state.board.length) return;
  state.boardBusy = true;
  state.recording = true;
  const btn = $('#board-export');
  btn.disabled = true;
  $('#tally').hidden = false;
  try {
    await prepareBoard();
    const first = state.board[0];
    const [w, h] = sizeFor(first.image.width / first.image.height, state.outSize);
    renderer.setSize(w, h);
    let filmTime = 0;
    const segments = state.board.map((card) => ({
      duration: card.duration,
      enter: async () => { enterCard(card); markPlaying(card.uid); },
      draw: (t, time) => {
        drawCard(card, t, time);
        $('#timecode').textContent = timecode(filmTime + time, state.fps);
        if (t >= 1) filmTime += card.duration;
      },
    }));
    const res = await recordSegments(renderer.canvas, {
      segments,
      fps: state.fps,
      onProgress: (f) => (btn.lastChild.textContent = `Exporting ${Math.round(f * 100)}%`),
    });
    const item = { id: `film-${Date.now()}`, kind: 'clip', blob: res.blob, ext: res.ext, move: `Film, ${state.board.length} shots`, moveId: 'film', seconds: Math.round(boardTotal() * 10) / 10 };
    renderReelItem(item, true);
    download(res.blob, `massless-film-${Date.now()}.${res.ext}`);
    toast(`Film exported: ${state.board.length} shots, ${boardTotal().toFixed(1)} s, ${res.ext.toUpperCase()}.`);
  } catch (e) {
    toast(`Export failed: ${e.message}`, 'error');
  } finally {
    markPlaying(null);
    status(null);
    $('#tally').hidden = true;
    btn.disabled = false;
    btn.lastChild.textContent = 'Export film';
    state.boardBusy = false;
    state.recording = false;
    enterLive();
    startLoop();
  }
}

async function restoreBoard() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('massless.board') || '[]'); } catch {}
  for (const c of saved) {
    let image = null;
    let thumb = null;
    if (c.shotId === 'calibration') {
      const cal = calibrationImage();
      image = cal.image;
      depthCache.set('calibration', cal.depth);
    } else {
      const item = await store.get(c.shotId).catch(() => null);
      if (!item) continue;
      image = await createImageBitmap(item.blob);
      thumb = item.thumb;
    }
    state.board.push({ ...c, image, depth: null, stats: null, thumbUrl: URL.createObjectURL(thumb || (await thumbOf(image, 320))) });
  }
  renderBoard();
}

async function restoreReel() {
  try {
    const items = await store.all();
    items.sort((a, b) => b.created - a.created);
    for (const it of items.slice(0, 24)) renderReelItem(it);
  } catch {
    /* storage unavailable */
  }
}

async function init() {
  try {
    renderer = new Renderer($('#view'));
  } catch (e) {
    status(e.message);
    return;
  }
  state.rig = await fetch(new URL('../data/rig.json', import.meta.url)).then((r) => r.json());
  try {
    const eng = localStorage.getItem('massless.engine');
    if (eng) { $('#engine').value = eng; $('#comfy-settings').hidden = eng !== 'comfy'; }
    const cu = localStorage.getItem('massless.comfy-url');
    if (cu) $('#comfy-url').value = cu;
    const ck = localStorage.getItem('massless.comfy-ckpt');
    if (ck) $('#comfy-ckpt').value = ck;
  } catch {}
  buildRig();
  buildMoves();
  bindUI();
  refreshPrompt(true);
  updateHud();
  buildFinishSliders();

  const cal = calibrationImage();
  depthCache.set('calibration', cal.depth);
  await loadImage(cal.image, { label: 'Calibration scene', gradeMix: 0.5, depth: cal.depth, id: 'calibration' });
  startLoop();
  restoreReel();
  restoreBoard();
  window.massless = { state, renderer, drawFrame, updateZoom, loadImage, addToBoard, selectMove, enterLive, drawCard, enterCard, prepareBoard };
}

init();
