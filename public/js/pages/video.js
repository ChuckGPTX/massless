import { Renderer, OVERSCAN } from '../renderer.js';
import { MOVES, GROUPS, moveById } from '../moves.js';
import { EFFECTS, effectById, defaultLook, EffectEngine } from '../effects.js';
import { estimateDepth, depthStats, depthBackend, backgroundLayer } from '../depth.js';
import { recordSegments } from '../recorder.js';
import { loadRig, finishFor, apertureBlur, pick, DEPTH_RANGE } from '../rig.js';
import * as store from '../store.js';
import { autoplayVideos, bindDialogs, toast, el, download, SAMPLES } from '../ui.js';

const $ = (s) => document.querySelector(s);
const GROUP_LABEL = { effects: 'Effect', push: 'Push and pull', orbit: 'Orbit', rise: 'Crane and tilt', slide: 'Slide and pan', feel: 'Texture' };
const FINISH_CONTROLS = [
  ['dof', 'Added depth of field', 0, 1, 0.01], ['grain', 'Grain', 0, 1, 0.01], ['halation', 'Halation', 0, 1, 0.01],
  ['streak', 'Streak flares', 0, 1, 0.01], ['ca', 'Chromatic aberration', 0, 1, 0.01], ['vignette', 'Vignette', 0, 1, 0.01],
  ['distort', 'Lens distortion', 0, 0.8, 0.01], ['exposure', 'Exposure', 0.6, 1.5, 0.01], ['contrast', 'Contrast', 0.6, 1.5, 0.01],
  ['sat', 'Saturation', 0, 1.6, 0.01], ['warm', 'Warmth', -0.8, 0.8, 0.01], ['fade', 'Lifted blacks', 0, 0.3, 0.005], ['vhs', 'Tape', 0, 1, 0.01],
];

const state = {
  rig: null,
  look: { camera: '35mm', lens: 'spherical', stock: 'negative', aperture: '5.6', focal: 35, light: 'golden' },
  move: 'dolly-in', effect: null, effectLook: '', duration: 4, intensity: 1, outSize: 1280, fps: 24, playing: true,
  overrides: {}, focusOverride: null, stats: { subject: 0.7, near: 0.95, far: 0.1 }, zoom: 1, gradeMix: 0.45,
  current: null, // { ref, name, image, depth }
  board: [], boardBusy: false, recording: false, activeCard: null, group: 'all',
};

let renderer;
let effects;
let rafId = 0;
let loopStart = performance.now();
const depthCache = new Map();

// ---------- camera ----------
const fx = () => ({ ...finishFor(state.rig, state.look, state.gradeMix), ...state.overrides });
const blur = () => apertureBlur(state.rig, state.look, fx().dof ?? 1);
const range = () => DEPTH_RANGE[state.look.focal] || [0.55, 1.5];

function ctxFor(stats, k, b, focus) {
  return { D: renderer.restDistance, sSub: renderer.sFor(stats.subject), focusSub: focus ?? stats.subject, focusNear: stats.near, focusFar: stats.far, k, blur: b };
}
const liveCtx = () => ctxFor(state.stats, state.intensity, blur(), state.focusOverride);

function zoomFor(move, ctx) {
  const cams = [];
  for (let i = 0; i <= 30; i++) cams.push(move.fn(i / 30, ctx));
  return renderer.requiredZoom(cams, renderer.canvas.width / renderer.canvas.height);
}
const tighten = (cam, z) => (z > 1 ? { ...cam, fov: (2 * Math.atan(Math.tan((cam.fov * Math.PI) / 360) / z) * 180) / Math.PI } : cam);
function updateZoom() { state.zoom = zoomFor(moveById(state.move), liveCtx()); }

function drawFrame(t, time) {
  if (state.effect && effects?.prep && effects.prep.image === state.current?.image) effects.draw(state.effect, state.effectLook, t, liveCtx(), fx(), time, state.duration);
  else renderer.render(tighten(moveById(state.move).fn(state.effect ? 0 : t, liveCtx()), state.zoom), fx(), time);
}

// Never queue a preview frame while the last one is still drawing: a slow GPU would otherwise pile
// up seconds of work, and the next export or screenshot would wait for all of it.
let inFlight = null;
function gpuBusy() {
  if (!inFlight) return false;
  const gl = renderer.gl;
  if (gl.getSyncParameter(inFlight, gl.SYNC_STATUS) !== gl.SIGNALED) return true;
  gl.deleteSync(inFlight);
  inFlight = null;
  return false;
}
function frameSent() {
  const gl = renderer.gl;
  inFlight = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
}

function loop(now) {
  rafId = requestAnimationFrame(loop);
  if (state.recording || !state.current || gpuBusy()) return;
  const period = state.duration + (!state.effect && state.move === 'float' ? 0 : 0.7);
  const el2 = (now - loopStart) / 1000;
  drawFrame(state.playing ? Math.min(1, (el2 % period) / state.duration) : 0, now / 1000);
  frameSent();
}
function startLoop() { cancelAnimationFrame(rafId); loopStart = performance.now(); rafId = requestAnimationFrame(loop); }

const sizeFor = (aspect, long) => (aspect >= 1 ? [long, long / aspect] : [long * aspect, long]);
function setPreviewSize() {
  const [w, h] = sizeFor(renderer.aspect, Math.min(state.outSize, window.innerWidth < 760 ? 960 : 1280));
  renderer.setSize(w, h);
  $('#viewfinder').style.aspectRatio = `${renderer.aspect}`;
  // width: 100% wins over aspect-ratio once max-height clamps, which stretched portrait stills
  $('#viewfinder').style.width = `min(100%, calc(64vh * ${renderer.aspect}))`;
}

// ---------- status ----------
function status(text, fraction = null) {
  const box = $('#vf-status');
  if (!text) { box.hidden = true; return; }
  box.hidden = false;
  $('#vf-status-text').textContent = text;
  const meter = box.querySelector('.meter');
  meter.classList.toggle('indeterminate', fraction == null);
  $('#meter-fill').style.width = fraction == null ? '' : `${Math.round(fraction * 100)}%`;
}

// ---------- start frames ----------
async function bitmapFrom(url) { return await createImageBitmap(await (await fetch(url)).blob()); }

async function precomputedDepth(key) {
  try {
    const res = await fetch(`/media/depth/${key}.png`);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const data = new Uint8Array(c.width * c.height);
    for (let i = 0; i < data.length; i++) data[i] = px[i * 4];
    return { data, w: c.width, h: c.height, source: 'precomputed' };
  } catch { return null; }
}

function useDepth(d, image) {
  if (!d.bg) {
    const layer = backgroundLayer(image, d.data, d.w, d.h);
    d.bg = layer.bgDepth;
    d.bgColor = layer.bgColor;
  }
  renderer.setDepth(d.data, d.w, d.h, d.bg);
  renderer.setBackgroundColor(d.bgColor);
  d.stats = d.stats || depthStats(d.data, d.w, d.h);
  state.stats = d.stats;
  state.focusOverride = null;
  updateZoom();
  if (state.effect) prepareEffect();
}

/** ref: 'sample:key' | 'shot:id' | 'upload:n'. */
async function loadFrame({ ref, name, image, sub, look, gradeMix = 0.45, depth = null, thumbUrl }) {
  state.current = { ref, name, image, depth: null, thumbUrl };
  if (look) {
    Object.assign(state.look, look);
    syncLookControls();
  }
  state.gradeMix = gradeMix;
  state.overrides = {};
  buildFinishSliders();
  renderer.setImage(image);
  renderer.setBackgroundColor(image);
  renderer.setDepthRange(...range());
  setPreviewSize();
  $('#frame-img').src = thumbUrl || '';
  $('#frame-name').textContent = name;
  $('#frame-sub').textContent = sub || 'Start frame';
  let d = depth || depthCache.get(ref);
  if (!d) {
    renderer.setDepth(new Uint8Array([128]), 1, 1);
    state.stats = { subject: 0.5, near: 0.5, far: 0.5 };
    updateZoom();
    status('Reading depth on your device', null);
    d = await estimateDepth(image, (f, msg) => status(msg, f));
    status(null);
    if (d.source === 'estimate') toast('The depth model could not load here, so Massless guessed the depth. Moves still work, with less accuracy.', 'error');
  }
  depthCache.set(ref, d);
  state.current.depth = d;
  if (state.current.ref !== ref) return; // a newer frame was chosen meanwhile
  useDepth(d, image);
  $('#src-label').textContent = d.source === 'precomputed' ? 'Sample · depth precomputed' : d.source === 'model' ? `Depth Anything V2 on ${depthBackend() || 'your device'}` : 'Estimated depth';
}

async function loadSample(key) {
  const s = SAMPLES.find((x) => x.key === key) || SAMPLES[0];
  const [image, depth] = await Promise.all([bitmapFrom(`/media/art/${s.key}.jpg`), depthCache.get(`sample:${s.key}`) || precomputedDepth(s.key)]);
  await loadFrame({ ref: `sample:${s.key}`, name: s.name, sub: 'Sample still', image, depth, thumbUrl: `/media/art/${s.key}.jpg`, gradeMix: 0.45 });
}

async function loadShot(id) {
  const item = await store.get(id).catch(() => null);
  if (!item) { toast('That shot is no longer in this browser. Showing a sample instead.', 'error'); return loadSample('rider'); }
  const image = await createImageBitmap(item.blob);
  const look = item.rig ? { camera: item.rig.camera, lens: item.rig.lens, stock: item.rig.stock, aperture: item.rig.aperture, focal: item.rig.focal, light: item.rig.light } : null;
  await loadFrame({ ref: `shot:${id}`, name: item.engine === 'upload' ? 'Your still' : 'Your shot', sub: item.prompt ? item.prompt.slice(0, 60) + (item.prompt.length > 60 ? '…' : '') : 'Start frame', image, look, gradeMix: item.engine === 'upload' ? 1 : 0.45, thumbUrl: URL.createObjectURL(item.thumb || item.blob) });
}

async function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('That file is not an image. Use a JPEG, PNG or WebP.', 'error'); return; }
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  const id = `shot-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await store.put({ id, kind: 'shot', created: Date.now(), prompt: '', engine: 'upload', blob, thumb: blob }).catch(() => {});
  $('#picker').close();
  await loadFrame({ ref: `shot:${id}`, name: 'Your still', sub: file.name, image: c, gradeMix: 1, thumbUrl: URL.createObjectURL(blob) });
}

async function openPicker() {
  const mine = $('#pick-mine');
  mine.innerHTML = '';
  const items = (await store.all().catch(() => [])).filter((x) => x.kind === 'shot').sort((a, b) => b.created - a.created).slice(0, 18);
  $('#mine-head').hidden = !items.length;
  for (const it of items) {
    const b = el('button', { type: 'button', class: 'pick' }, el('img', { src: URL.createObjectURL(it.thumb || it.blob), alt: it.prompt || 'Your shot' }));
    b.addEventListener('click', () => { $('#picker').close(); loadShot(it.id); });
    mine.append(b);
  }
  $('#picker').showModal();
}

function buildSamples() {
  const box = $('#pick-samples');
  for (const s of SAMPLES) {
    const b = el('button', { type: 'button', class: 'pick' }, el('img', { loading: 'lazy', src: `/media/art/${s.key}.jpg`, alt: s.prompt }), el('span', {}, s.name));
    b.addEventListener('click', () => { $('#picker').close(); loadSample(s.key); });
    box.append(b);
  }
}

// ---------- look controls ----------
function fillSelect(sel, items, key, label, current) {
  sel.innerHTML = '';
  for (const it of items) sel.append(el('option', { value: key(it), selected: String(key(it)) === String(current) }, label(it)));
}
function syncLookControls() {
  const R = state.rig;
  fillSelect($('#look-camera'), R.camera, (x) => x.id, (x) => x.name, state.look.camera);
  fillSelect($('#look-lens'), R.lens, (x) => x.id, (x) => x.name, state.look.lens);
  fillSelect($('#look-stock'), R.stock, (x) => x.id, (x) => x.name, state.look.stock);
  fillSelect($('#look-aperture'), R.aperture, (x) => x.f, (x) => `f/${x.f}`, state.look.aperture);
  updateHud();
}
function buildFinishSliders() {
  const box = $('#finish-sliders');
  box.innerHTML = '';
  const f = fx();
  for (const [key, label, min, max, step] of FINISH_CONTROLS) {
    const out = el('output', {}, Number(f[key] ?? 0).toFixed(2));
    const input = el('input', { type: 'range', min, max, step, value: f[key] ?? 0, 'aria-label': label });
    input.addEventListener('input', () => { state.overrides[key] = Number(input.value); out.textContent = Number(input.value).toFixed(2); });
    box.append(el('label', {}, el('span', {}, label, out), input));
  }
}
function updateHud() {
  const name = currentName();
  $('#hud-move').textContent = name;
  $('#move-name').textContent = name;
  $('#move-kind').textContent = state.effect ? 'Effect' : 'Camera move';
  $('#hud-lens').textContent = `${pick(state.rig, 'lens', state.look.lens).name} · ${state.look.focal}mm · f/${state.look.aperture}`;
}

// ---------- move library ----------
function selectMove(id, { scroll = false } = {}) {
  const m = moveById(id);
  state.move = m.id;
  state.effect = null;
  $('#look-field').hidden = true;
  state.duration = m.duration;
  $('#duration').value = m.duration;
  $('#o-duration').textContent = `${m.duration.toFixed(1)} s`;
  markCards(m.id);
  updateZoom();
  updateHud();
  state.playing = true;
  $('#play').textContent = 'Pause';
  startLoop();
  if (scroll) $('#preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const currentName = () => {
  if (!state.effect) return moveById(state.move).name;
  const e = effectById(state.effect);
  const look = e.looks.find((l) => l.id === state.effectLook);
  return look ? `${e.name} · ${look.name}` : e.name;
};

function markCards(key) {
  document.querySelectorAll('.mcard').forEach((x) => {
    const on = x.dataset.key === key;
    x.setAttribute('aria-checked', String(on));
    x.querySelector('.use').textContent = on ? 'Selected' : x.dataset.group === 'effects' ? 'Use effect' : 'Use move';
  });
}

// ---------- effects ----------
async function prepareEffect() {
  const cur = state.current;
  if (!cur?.depth || !state.effect) return;
  if (!cur.depth.fxPrep || cur.depth.fxPrep.image !== cur.image) {
    status('Finding the subject', null);
    await new Promise((r) => setTimeout(r, 30));
    if (state.current !== cur) return;
  }
  try { effects.prepare(cur.image, cur.depth); } catch (e) { toast(`Effect failed: ${e.message}`, 'error'); }
  status(null);
}

function buildLooks() {
  const box = $('#fx-looks');
  box.innerHTML = '';
  const e = effectById(state.effect);
  $('#look-field').hidden = !e || !e.looks.length;
  if (!e) return;
  for (const l of e.looks) {
    const b = el('button', { type: 'button', role: 'radio', 'aria-checked': String(l.id === state.effectLook) }, l.name);
    b.addEventListener('click', () => {
      state.effectLook = l.id;
      box.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      updateHud();
      startLoop();
    });
    box.append(b);
  }
}

async function selectEffect(id, look, { scroll = false } = {}) {
  const e = effectById(id);
  if (!e) return;
  state.effect = e.id;
  state.effectLook = e.looks.some((l) => l.id === look) ? look : defaultLook(e.id);
  state.duration = e.duration;
  $('#duration').value = e.duration;
  $('#o-duration').textContent = `${e.duration.toFixed(1)} s`;
  markCards(e.id);
  buildLooks();
  updateHud();
  state.playing = true;
  $('#play').textContent = 'Pause';
  if (scroll) $('#preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  await prepareEffect();
  startLoop();
}

function buildLibrary() {
  const groups = $('#groups');
  const lib = $('#lib');
  const tabs = [GROUPS[0], { id: 'effects', name: 'Effects' }, ...GROUPS.slice(1)];
  for (const g of tabs) {
    const b = el('button', { type: 'button', role: 'tab', 'aria-selected': String(g.id === 'all') }, g.name);
    b.addEventListener('click', () => {
      groups.querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      lib.querySelectorAll('.mcard').forEach((x) => (x.hidden = g.id !== 'all' && x.dataset.group !== g.id));
    });
    groups.append(b);
  }
  for (const e of EFFECTS) {
    const card = el('button', { type: 'button', class: 'mcard', role: 'radio', 'aria-checked': 'false', 'data-key': e.id, 'data-group': 'effects', title: e.hint },
      el('div', { class: 'frame' }, el('video', { muted: true, loop: true, playsinline: true, preload: 'none', poster: `/media/clips/effect-${e.id}.jpg`, 'data-src': `/media/clips/effect-${e.id}.mp4` }), el('span', { class: 'badge' }, 'Effect'), el('span', { class: 'use' }, 'Use effect')),
      el('strong', {}, e.name), el('span', {}, `${GROUP_LABEL.effects} · ${e.hint}`));
    card.addEventListener('click', () => selectEffect(e.id, state.effect === e.id ? state.effectLook : null, { scroll: true }));
    lib.append(card);
  }
  for (const m of MOVES) {
    const card = el('button', { type: 'button', class: 'mcard', role: 'radio', 'aria-checked': String(m.id === state.move), 'data-key': m.id, 'data-group': m.group, title: m.hint },
      el('div', { class: 'frame' }, el('video', { muted: true, loop: true, playsinline: true, preload: 'none', poster: `/media/clips/move-${m.id}.jpg`, 'data-src': `/media/clips/move-${m.id}.mp4` }), el('span', { class: 'use' }, m.id === state.move ? 'Selected' : 'Use move')),
      el('strong', {}, m.name), el('span', {}, `${GROUP_LABEL[m.group]} · ${m.hint}`));
    card.addEventListener('click', () => selectMove(m.id, { scroll: true }));
    lib.append(card);
  }
  lib.querySelectorAll('video').forEach((v) => { v.muted = true; });
  autoplayVideos(lib.querySelectorAll('video'));
}

// ---------- clips ----------
function timecode(sec, fps) {
  const s = Math.floor(sec);
  const f = Math.floor((sec - s) * fps);
  const p = (n) => String(n).padStart(2, '0');
  return `00:${p(s)}:${p(f)}`;
}
function addClip(blob, ext, label) {
  $('#clips-wrap').hidden = false;
  const url = URL.createObjectURL(blob);
  const v = el('video', { src: url, muted: true, loop: true, playsinline: true, autoplay: true });
  v.muted = true;
  $('#clips').prepend(el('div', { class: 'clip fresh' }, v, el('div', { class: 'meta' }, el('span', {}, label), el('a', { class: 'dl', href: url, download: `massless-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now() % 1e6}.${ext}` }, 'Download'))));
  $('#clips-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function doRecord() {
  if (state.recording || !state.current?.depth) return;
  state.recording = true;
  const btn = $('#record');
  btn.classList.add('busy');
  btn.disabled = true;
  $('#tally').hidden = false;
  const [w, h] = sizeFor(renderer.aspect, state.outSize);
  renderer.setSize(w, h);
  updateZoom();
  const label = currentName();
  try {
    const res = await recordSegments(renderer.canvas, {
      segments: [{ duration: state.duration, draw: (t, time) => { drawFrame(t, time); $('#timecode').textContent = timecode(time, state.fps); } }],
      fps: state.fps,
      onProgress: (f) => ($('#record-label').textContent = `Rendering ${Math.round(f * 100)}%`),
    });
    addClip(res.blob, res.ext, `${label}, ${state.duration}s`);
    toast(`Clip rendered as ${res.ext.toUpperCase()}. Download it under Your clips.`);
  } catch (e) {
    toast(`Render failed: ${e.message}`, 'error');
  } finally {
    state.recording = false;
    btn.classList.remove('busy');
    btn.disabled = false;
    $('#record-label').textContent = 'Render clip';
    $('#tally').hidden = true;
    setPreviewSize();
    updateZoom();
    startLoop();
  }
}

// ---------- storyboard ----------
function saveBoard() {
  const slim = state.board.map(({ uid, ref, name, move, effect, effectLook, duration, intensity, fx: f, blur: b, focus, range: r, look }) => ({ uid, ref, name, move, effect, effectLook, duration, intensity, fx: f, blur: b, focus, range: r, look }));
  try { localStorage.setItem('massless.board2', JSON.stringify(slim)); } catch {}
}
const boardTotal = () => state.board.reduce((a, c) => a + c.duration, 0);

function renderBoard() {
  const list = $('#board-list');
  list.innerHTML = '';
  const n = state.board.length;
  $('#board-empty').hidden = n > 0;
  $('#board-play').disabled = n === 0;
  $('#board-export').disabled = n === 0;
  const count = $('#board-count');
  count.textContent = n;
  count.classList.toggle('on', n > 0);
  $('#board-total').textContent = n ? `${n} shot${n > 1 ? 's' : ''}, ${boardTotal().toFixed(1)} s total` : '';
  state.board.forEach((c, i) => {
    list.append(el('li', { class: `bcard${state.activeCard === c.uid ? ' active' : ''}`, 'data-uid': c.uid },
      el('button', { type: 'button', class: 'th', title: 'Open this shot', onclick: () => openCard(c) }, el('img', { src: c.thumbUrl || '', alt: `Shot ${i + 1}` })),
      el('div', { class: 'meta' }, el('strong', {}, `${i + 1}. ${cardName(c)}`), el('span', {}, `${c.name}, ${c.duration.toFixed(1)} s`)),
      el('div', { class: 'ctrl' },
        el('button', { type: 'button', 'aria-label': `Move shot ${i + 1} up`, disabled: i === 0, onclick: () => moveCard(i, -1) }, '↑'),
        el('button', { type: 'button', 'aria-label': `Move shot ${i + 1} down`, disabled: i === n - 1, onclick: () => moveCard(i, 1) }, '↓'),
        el('button', { type: 'button', 'aria-label': `Remove shot ${i + 1}`, onclick: () => { state.board.splice(i, 1); saveBoard(); renderBoard(); } }, '×'))));
  });
}
const cardName = (c) => (c.effect && effectById(c.effect) ? effectById(c.effect).name : moveById(c.move).name);
function moveCard(i, d) {
  const j = i + d;
  if (j < 0 || j >= state.board.length) return;
  [state.board[i], state.board[j]] = [state.board[j], state.board[i]];
  saveBoard();
  renderBoard();
}

async function thumbCanvas(src, max = 320) {
  const s = max / Math.max(src.width, src.height);
  const c = document.createElement('canvas');
  c.width = Math.round(src.width * s);
  c.height = Math.round(src.height * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return URL.createObjectURL(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.84)));
}

async function addToBoard() {
  const cur = state.current;
  if (!cur?.depth) { toast('Wait for depth to finish, then add the shot.', 'error'); return; }
  const was = state.recording;
  state.recording = true;
  drawFrame(0.7, 0);
  const thumbUrl = await thumbCanvas(renderer.canvas);
  state.recording = was;
  const card = {
    uid: `c${Date.now()}${Math.floor(Math.random() * 1e3)}`, ref: cur.ref, name: cur.name, image: cur.image, depth: cur.depth,
    move: state.move, effect: state.effect, effectLook: state.effectLook, duration: state.duration, intensity: state.intensity, fx: fx(), blur: blur(),
    focus: state.focusOverride ?? state.stats.subject, range: [...range()], look: { ...state.look }, thumbUrl,
  };
  state.board.push(card);
  state.activeCard = card.uid;
  saveBoard();
  renderBoard();
  toast(`Shot ${state.board.length} added: ${cardName(card)}, ${card.duration.toFixed(1)} s.`);
}

async function ensureCard(card, i, n) {
  if (!card.image) {
    const [kind, key] = card.ref.split(':');
    if (kind === 'sample') card.image = await bitmapFrom(`/media/art/${key}.jpg`);
    else {
      const item = await store.get(key).catch(() => null);
      if (!item) throw new Error(`Shot ${i + 1}'s picture is no longer in this browser. Remove it and add it again.`);
      card.image = await createImageBitmap(item.blob);
    }
  }
  if (!card.depth) {
    card.depth = depthCache.get(card.ref) || (card.ref.startsWith('sample:') ? await precomputedDepth(card.ref.slice(7)) : null);
    if (!card.depth) {
      status(`Reading depth for shot ${i + 1} of ${n}`, null);
      card.depth = await estimateDepth(card.image, (f, msg) => status(`${msg} (shot ${i + 1} of ${n})`, f));
    }
    depthCache.set(card.ref, card.depth);
  }
  if (!card.depth.bg) {
    const layer = backgroundLayer(card.image, card.depth.data, card.depth.w, card.depth.h);
    card.depth.bg = layer.bgDepth;
    card.depth.bgColor = layer.bgColor;
  }
  card.depth.stats = card.depth.stats || depthStats(card.depth.data, card.depth.w, card.depth.h);
}
async function prepareBoard() {
  for (let i = 0; i < state.board.length; i++) await ensureCard(state.board[i], i, state.board.length);
  status(null);
}
function enterCard(card) {
  renderer.setImage(card.image);
  renderer.setBackgroundColor(card.depth.bgColor || card.image);
  renderer.setDepthRange(card.range[0], card.range[1]);
  renderer.setDepth(card.depth.data, card.depth.w, card.depth.h, card.depth.bg);
  card.ctx = ctxFor(card.depth.stats, card.intensity, card.blur, card.focus);
  card.zoom = zoomFor(moveById(card.move), card.ctx);
  if (card.effect && effectById(card.effect)) effects.prepare(card.image, card.depth);
}
function drawCard(card, t, time) {
  if (card.effect && effectById(card.effect)) effects.draw(card.effect, card.effectLook, t, card.ctx, card.fx, time, card.duration);
  else renderer.render(tighten(moveById(card.move).fn(t, card.ctx), card.zoom), card.fx, time);
}
function enterLive() {
  const cur = state.current;
  if (!cur) return;
  renderer.setImage(cur.image);
  renderer.setDepthRange(...range());
  if (cur.depth) { renderer.setDepth(cur.depth.data, cur.depth.w, cur.depth.h, cur.depth.bg); renderer.setBackgroundColor(cur.depth.bgColor || cur.image); }
  setPreviewSize();
  updateZoom();
  if (state.effect && cur.depth) effects.prepare(cur.image, cur.depth);
}
const markPlaying = (uid) => document.querySelectorAll('.bcard').forEach((x) => x.classList.toggle('playing', x.dataset.uid === uid));

async function openCard(card) {
  if (state.boardBusy) return;
  try { await ensureCard(card, state.board.indexOf(card), state.board.length); status(null); } catch (e) { toast(e.message, 'error'); return; }
  const [kind, key] = card.ref.split(':');
  const thumbUrl = kind === 'sample' ? `/media/art/${key}.jpg` : card.thumbUrl;
  await loadFrame({ ref: card.ref, name: card.name, image: card.image, depth: card.depth, look: card.look, thumbUrl, gradeMix: state.gradeMix });
  state.overrides = { ...card.fx };
  state.focusOverride = card.focus;
  state.intensity = card.intensity;
  $('#intensity').value = card.intensity;
  $('#o-intensity').textContent = `${Math.round(card.intensity * 100)}%`;
  if (card.effect && effectById(card.effect)) await selectEffect(card.effect, card.effectLook);
  else selectMove(card.move);
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
  $('#board-play').textContent = 'Stop';
  $('#preview').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    await prepareBoard();
    for (const card of state.board) {
      if (state.stopBoard) break;
      enterCard(card);
      markPlaying(card.uid);
      const start = performance.now();
      await new Promise((resolve) => {
        const step = (now) => {
          const e = (now - start) / 1000;
          if (state.stopBoard || e >= card.duration) { resolve(); return; }
          if (!gpuBusy()) { drawCard(card, e / card.duration, now / 1000); frameSent(); }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }
  } catch (e) { toast(e.message, 'error'); } finally {
    markPlaying(null);
    status(null);
    $('#board-play').textContent = 'Play storyboard';
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
  btn.classList.add('busy');
  $('#tally').hidden = false;
  try {
    await prepareBoard();
    const first = state.board[0];
    renderer.setSize(...sizeFor(first.image.width / first.image.height, state.outSize));
    let filmTime = 0;
    const segments = state.board.map((card) => ({
      duration: card.duration,
      enter: async () => { enterCard(card); markPlaying(card.uid); },
      draw: (t, time) => { drawCard(card, t, time); $('#timecode').textContent = timecode(filmTime + time, state.fps); if (t >= 1) filmTime += card.duration; },
    }));
    const res = await recordSegments(renderer.canvas, { segments, fps: state.fps, onProgress: (f) => ($('#export-label').textContent = `Exporting ${Math.round(f * 100)}%`) });
    addClip(res.blob, res.ext, `Film, ${state.board.length} shots`);
    toast(`Film exported: ${state.board.length} shots, ${boardTotal().toFixed(1)} s, ${res.ext.toUpperCase()}.`);
  } catch (e) { toast(`Export failed: ${e.message}`, 'error'); } finally {
    markPlaying(null);
    status(null);
    $('#tally').hidden = true;
    btn.disabled = false;
    btn.classList.remove('busy');
    $('#export-label').textContent = 'Export film';
    state.boardBusy = false;
    state.recording = false;
    enterLive();
    startLoop();
  }
}

async function restoreBoard() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('massless.board2') || '[]'); } catch {}
  for (const c of saved) {
    let thumbUrl = '';
    const [kind, key] = (c.ref || '').split(':');
    if (kind === 'sample') thumbUrl = `/media/art/${key}.jpg`;
    else {
      const item = await store.get(key).catch(() => null);
      if (!item) continue;
      thumbUrl = URL.createObjectURL(item.thumb || item.blob);
    }
    state.board.push({ ...c, image: null, depth: null, thumbUrl });
  }
  renderBoard();
}

// ---------- tabs and bindings ----------
function showTab(which) {
  const board = which === 'board';
  $('#t-move').setAttribute('aria-selected', String(!board));
  $('#t-board').setAttribute('aria-selected', String(board));
  $('#tab-move').hidden = board;
  $('#tab-board').hidden = !board;
  $('#foot-move').hidden = board;
  $('#foot-board').hidden = !board;
}

function bind() {
  $('#t-move').addEventListener('click', () => showTab('move'));
  $('#t-board').addEventListener('click', () => showTab('board'));
  $('#frame-card').addEventListener('click', openPicker);
  $('#move-sel').addEventListener('click', () => $('#library').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('#upload').addEventListener('change', (e) => loadFile(e.target.files[0]));
  $('#duration').addEventListener('input', (e) => { state.duration = Number(e.target.value); $('#o-duration').textContent = `${state.duration.toFixed(1)} s`; });
  $('#intensity').addEventListener('input', (e) => { state.intensity = Number(e.target.value); $('#o-intensity').textContent = `${Math.round(state.intensity * 100)}%`; updateZoom(); });
  for (const [id, key] of [['look-camera', 'camera'], ['look-lens', 'lens'], ['look-stock', 'stock'], ['look-aperture', 'aperture']]) {
    $(`#${id}`).addEventListener('change', (e) => { state.look[key] = e.target.value; state.overrides = {}; buildFinishSliders(); updateHud(); });
  }
  $('#out-size').addEventListener('change', (e) => { state.outSize = Number(e.target.value); setPreviewSize(); updateZoom(); });
  $('#out-fps').addEventListener('change', (e) => (state.fps = Number(e.target.value)));
  $('#finish-reset').addEventListener('click', () => { state.overrides = {}; buildFinishSliders(); });
  $('#play').addEventListener('click', () => { state.playing = !state.playing; $('#play').textContent = state.playing ? 'Pause' : 'Play'; startLoop(); });
  $('#still').addEventListener('click', async () => download(await renderer.readPixelsPNG(), `massless-frame-${Date.now()}.png`));
  $('#record').addEventListener('click', doRecord);
  $('#board-add').addEventListener('click', addToBoard);
  $('#board-play').addEventListener('click', playBoard);
  $('#board-export').addEventListener('click', exportBoard);

  const canvas = $('#view');
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const u = 0.5 + ((e.clientX - r.left) / r.width - 0.5) / OVERSCAN / state.zoom;
    const v = 0.5 + ((1 - (e.clientY - r.top) / r.height) - 0.5) / OVERSCAN / state.zoom;
    state.focusOverride = renderer.depthAt(u, v);
    const mark = el('div', { class: 'focus-mark' });
    mark.style.left = `${e.clientX - r.left}px`;
    mark.style.top = `${e.clientY - r.top}px`;
    $('#viewfinder').append(mark);
    setTimeout(() => mark.remove(), 950);
  });
  const vf = $('#viewfinder');
  ['dragenter', 'dragover'].forEach((t) => vf.addEventListener(t, (e) => { e.preventDefault(); $('#drop-hint').hidden = false; }));
  ['dragleave', 'drop'].forEach((t) => vf.addEventListener(t, (e) => { e.preventDefault(); $('#drop-hint').hidden = true; }));
  vf.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
  document.addEventListener('paste', (e) => { const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/')); if (it) loadFile(it.getAsFile()); });
  window.addEventListener('resize', () => { if (!state.recording) setPreviewSize(); });
  window.addEventListener('hashchange', route);
}

function route() {
  if (location.hash === '#storyboard') showTab('board');
  if (location.hash === '#library') $('#library').scrollIntoView({ block: 'start' });
}

async function init() {
  try { renderer = new Renderer($('#view')); effects = new EffectEngine(renderer); } catch (e) { status(e.message); return; }
  state.rig = await loadRig();
  syncLookControls();
  buildFinishSliders();
  buildLibrary();
  buildSamples();
  bind();
  bindDialogs();
  const p = new URLSearchParams(location.search);
  if (p.get('move')) selectMove(p.get('move'));
  if (p.get('effect') && effectById(p.get('effect'))) selectEffect(p.get('effect'), p.get('look'));
  startLoop();
  route();
  if (p.get('shot')) await loadShot(p.get('shot'));
  else await loadSample(p.get('sample') || 'rider');
  restoreBoard();
  window.massless = { state, renderer, effects, drawFrame, updateZoom, selectMove, selectEffect, addToBoard, prepareBoard, enterCard, drawCard, enterLive, loadSample };
}

init();
