import { loadRig, compilePrompt, pick, DEFAULT_SEL } from '../rig.js';
import { shoot, ENGINES } from '../engines.js';
import * as store from '../store.js';
import { autoplayVideos, bindDialogs, toast, el, download, SAMPLES } from '../ui.js';

const $ = (s) => document.querySelector(s);

const LOOKS = {
  rider: { camera: '65mm', lens: 'spherical', focal: 24, aperture: '11', shot: 'ews', angle: 'low', light: 'golden', stock: 'negative', aspect: '239', genre: 'western', palette: 'earth' },
  samurai: { camera: '35mm', lens: 'anamorphic', focal: 35, aperture: '1.4', shot: 'ws', angle: 'low', light: 'neon', stock: 'blockbuster', aspect: '916', genre: 'thriller', palette: 'neon' },
  lighthouse: { camera: '16mm', lens: 'vintage', focal: 24, aperture: '2.8', shot: 'ews', angle: 'eye', light: 'blue', stock: 'bleach', aspect: '169', genre: 'thriller', palette: 'steel' },
  dancer: { camera: 's35-digital', lens: 'vintage', focal: 35, aperture: '2.8', shot: 'ws', angle: 'eye', light: 'haze', stock: 'faded', aspect: '169', genre: 'romance', palette: 'crimson' },
  neon: { camera: 's35-digital', lens: 'anamorphic', focal: 85, aperture: '1.4', shot: 'cu', angle: 'eye', light: 'neon', stock: 'blockbuster', aspect: '169', genre: 'noir', palette: 'neon' },
  train: { camera: '65mm', lens: 'spherical', focal: 50, aperture: '5.6', shot: 'ws', angle: 'eye', light: 'noon', stock: 'slide', aspect: '239', genre: 'scifi', palette: 'earth' },
  fisherman: { camera: '35mm', lens: 'vintage', focal: 50, aperture: '2.8', shot: 'ms', angle: 'high', light: 'golden', stock: 'negative', aspect: '45', genre: 'documentary', palette: 'amber' },
  jellyfish: { camera: 'lf-digital', lens: 'spherical', focal: 24, aperture: '5.6', shot: 'ws', angle: 'low', light: 'haze', stock: 'slide', aspect: '916', genre: 'fantasy', palette: 'teal' },
  diner: { camera: '35mm', lens: 'anamorphic', focal: 35, aperture: '2.8', shot: 'ms', angle: 'eye', light: 'neon', stock: 'cross', aspect: '169', genre: 'noir', palette: 'neon' },
  summit: { camera: '65mm', lens: 'spherical', focal: 14, aperture: '11', shot: 'ews', angle: 'high', light: 'golden', stock: 'slide', aspect: '916', genre: 'documentary', palette: 'natural' },
  bmx: { camera: '16mm', lens: 'spherical', focal: 14, aperture: '5.6', shot: 'ws', angle: 'low', light: 'silhouette', stock: 'faded', aspect: '169', genre: 'musicvideo', palette: 'amber' },
  astronaut: { camera: 'lf-digital', lens: 'spherical', focal: 35, aperture: '5.6', shot: 'ews', angle: 'eye', light: 'golden', stock: 'negative', aspect: '239', genre: 'scifi', palette: 'amber' },
  cinema: { camera: '35mm', lens: 'anamorphic', focal: 35, aperture: '1.4', shot: 'ms', angle: 'eye', light: 'tungsten', stock: 'blockbuster', aspect: '169', genre: 'none', palette: 'neon' },
  canyon: { camera: '65mm', lens: 'spherical', focal: 24, aperture: '11', shot: 'ews', angle: 'top', light: 'golden', stock: 'negative', aspect: '239', genre: 'western', palette: 'earth' },
};

const state = { rig: null, sel: { ...DEFAULT_SEL }, takes: 1, edited: false, busy: false, engine: 'auto' };

// ---------- prompt ----------
function refreshPrompt(force = false) {
  if (state.edited && !force) return;
  $('#compiled').value = compilePrompt(state.rig, $('#subject').value, state.sel);
  state.edited = false;
}

function updateChips() {
  const R = state.rig;
  $('#chip-camera').textContent = pick(R, 'camera', state.sel.camera).name;
  $('#chip-lens').textContent = pick(R, 'lens', state.sel.lens).name;
  $('#chip-focal').textContent = `${state.sel.focal}mm`;
  $('#chip-aperture').textContent = `f/${state.sel.aperture}`;
  $('#chip-aspect').textContent = pick(R, 'aspect', state.sel.aspect).name;
  $('#chip-engine').textContent = state.engine === 'comfy' ? 'FLUX.1 schnell · ComfyUI' : 'FLUX.1 schnell';
  $('#takes-n').textContent = state.takes;
}

// ---------- popovers ----------
let popOwner = null;
function closePop() {
  $('#pop').hidden = true;
  popOwner?.setAttribute('aria-expanded', 'false');
  popOwner = null;
}

function optGroup(items, key, render, current, onPick, chips = false) {
  const wrap = el('div', { class: `opts${chips ? ' chips' : ''}`, role: 'radiogroup' });
  for (const it of items) {
    const k = String(key(it));
    const b = el('button', { type: 'button', class: 'opt', role: 'radio', 'aria-checked': String(k === String(current)), 'data-key': k }, ...render(it));
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.opt').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      onPick(k);
    });
    wrap.append(b);
  }
  return wrap;
}

const NOTE = { '1.4': 'Very shallow focus', '2.8': 'Shallow focus', '5.6': 'Moderate depth', '11': 'Everything sharp' };
const FOCAL_NOTE = { 8: 'Fisheye', 14: 'Ultra-wide', 24: 'Wide', 35: 'Natural', 50: 'Normal', 85: 'Portrait', 135: 'Telephoto' };

function setSel(group, k, close = true) {
  state.sel[group] = group === 'focal' ? Number(k) : k;
  updateChips();
  refreshPrompt();
  if (close) closePop();
}

function openPop(kind, chip) {
  if (popOwner === chip) { closePop(); return; }
  closePop();
  const R = state.rig;
  const pop = $('#pop');
  pop.innerHTML = '';
  const nameNote = (x) => [el('strong', {}, x.name), el('small', {}, x.note || '')];
  if (kind === 'camera') pop.append(el('h3', {}, 'Camera body'), optGroup(R.camera, (x) => x.id, nameNote, state.sel.camera, (k) => setSel('camera', k)));
  if (kind === 'lens') pop.append(el('h3', {}, 'Lens'), optGroup(R.lens, (x) => x.id, nameNote, state.sel.lens, (k) => setSel('lens', k)));
  if (kind === 'focal') pop.append(el('h3', {}, 'Focal length'), optGroup(R.focal, (x) => x.mm, (x) => [el('strong', {}, `${x.mm}mm`), el('small', {}, FOCAL_NOTE[x.mm])], state.sel.focal, (k) => setSel('focal', k)));
  if (kind === 'aperture') pop.append(el('h3', {}, 'Aperture'), optGroup(R.aperture, (x) => x.f, (x) => [el('strong', {}, `f/${x.f}`), el('small', {}, NOTE[x.f])], state.sel.aperture, (k) => setSel('aperture', k)));
  if (kind === 'aspect') pop.append(el('h3', {}, 'Frame'), optGroup(R.aspect, (x) => x.id, (x) => [el('strong', {}, x.name), el('small', {}, x.ratio >= 1 ? 'Landscape' : 'Portrait')], state.sel.aspect, (k) => setSel('aspect', k)));
  if (kind === 'scene') {
    pop.append(el('h3', {}, 'Scene'));
    for (const [group, label] of [['genre', 'Genre'], ['shot', 'Shot size'], ['angle', 'Angle'], ['light', 'Light'], ['palette', 'Color palette'], ['stock', 'Film stock and grade']]) {
      pop.append(el('h4', {}, label), optGroup(R[group], (x) => x.id, (x) => [x.name], state.sel[group], (k) => setSel(group, k, false), true));
    }
  }
  if (kind === 'engine') {
    pop.append(el('h3', {}, 'Engine'));
    const items = Object.entries(ENGINES).map(([id, e]) => ({ id, ...e }));
    pop.append(optGroup(items, (x) => x.id, (x) => [el('strong', {}, x.name), el('small', {}, x.detail)], state.engine, (k) => {
      state.engine = k;
      try { localStorage.setItem('massless.engine', k); } catch {}
      updateChips();
      closePop();
      if (k === 'comfy') openPop('engine', chip);
    }));
    if (state.engine === 'comfy') {
      const url = el('input', { value: localStorage.getItem('massless.comfy-url') || 'http://127.0.0.1:8188', inputmode: 'url' });
      const ck = el('input', { value: localStorage.getItem('massless.comfy-ckpt') || 'flux1-schnell-fp8.safetensors' });
      url.addEventListener('change', () => { try { localStorage.setItem('massless.comfy-url', url.value); } catch {} });
      ck.addEventListener('change', () => { try { localStorage.setItem('massless.comfy-ckpt', ck.value); } catch {} });
      pop.append(el('label', { class: 'f' }, 'ComfyUI address', url), el('label', { class: 'f' }, 'Checkpoint', ck));
      pop.append(el('p', { class: 'note', html: 'Start ComfyUI with <code>--enable-cors-header</code>. <a href="/comfy/massless_shot_flux_schnell.api.json" download style="color:var(--accent)">Download the workflow</a>.' }));
    }
    pop.append(el('p', { class: 'note' }, 'Every engine runs FLUX.1 schnell, an open-weight model under Apache-2.0.'));
  }
  pop.hidden = false;
  chip.setAttribute('aria-expanded', 'true');
  popOwner = chip;
  pop.querySelector('[aria-checked="true"]')?.focus({ preventScroll: true });
}

// ---------- results ----------
async function thumbOf(image, max = 520) {
  const s = max / Math.max(image.width, image.height);
  const c = document.createElement('canvas');
  c.width = Math.round(image.width * s);
  c.height = Math.round(image.height * s);
  c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
  return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.84));
}
async function toJpeg(image) {
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  c.getContext('2d').drawImage(image, 0, 0);
  return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
}

function shotCard(item, fresh = false) {
  const url = URL.createObjectURL(item.thumb || item.blob);
  const label = item.engine === 'upload' ? 'Your still' : { pollinations: 'Pollinations', workers: 'Cloudflare', comfy: 'ComfyUI' }[item.engine] || 'Shot';
  const card = el('div', { class: `shot${fresh ? ' fresh' : ''}`, 'data-id': item.id },
    el('img', { src: url, alt: item.prompt ? item.prompt.slice(0, 120) : 'Shot' }),
    el('span', { class: 'tag' }, label),
    el('div', { class: 'acts' },
      el('a', { class: 'go', href: `/video?shot=${encodeURIComponent(item.id)}` }, 'Animate'),
      el('button', { type: 'button', onclick: () => download(item.blob, `${item.id}.jpg`) }, 'Download'),
      item.prompt ? el('button', { type: 'button', onclick: () => { $('#compiled').value = item.prompt; state.edited = true; $('#prompt-peek').open = true; toast('Prompt loaded. Press Generate to shoot it again.'); } }, 'Reuse prompt') : null,
      el('button', { type: 'button', 'aria-label': 'Delete shot', onclick: async () => { await store.del(item.id).catch(() => {}); card.remove(); if (!$('#results').children.length) $('#results-wrap').hidden = true; } }, '×')));
  return card;
}

async function addShot(image, meta) {
  const id = `shot-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const item = { id, kind: 'shot', created: Date.now(), ...meta, blob: await toJpeg(image), thumb: await thumbOf(image) };
  await store.put(item).catch(() => {});
  return item;
}

async function restore() {
  const items = (await store.all().catch(() => [])).filter((x) => x.kind === 'shot').sort((a, b) => b.created - a.created);
  if (!items.length) return;
  $('#results-wrap').hidden = false;
  for (const it of items.slice(0, 24)) $('#results').append(shotCard(it));
}

// ---------- shooting ----------
async function doShoot(e) {
  e?.preventDefault();
  if (state.busy) return;
  closePop();
  const prompt = $('#compiled').value.trim() || compilePrompt(state.rig, $('#subject').value, state.sel);
  const aspect = pick(state.rig, 'aspect', state.sel.aspect);
  state.busy = true;
  const btn = $('#shoot');
  btn.disabled = true;
  $('#results-wrap').hidden = false;
  const grid = $('#results');
  const pendings = [];
  for (let i = 0; i < state.takes; i++) {
    const p = el('div', { class: 'shot pending' }, state.takes > 1 ? `Take ${i + 1} rendering` : 'Rendering');
    p.style.aspectRatio = `${aspect.w} / ${aspect.h}`;
    grid.prepend(p);
    pendings.unshift(p);
  }
  $('#results-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  let done = 0;
  try {
    for (let i = 0; i < state.takes; i++) {
      $('#shoot-label').textContent = state.takes > 1 ? `Take ${i + 1}/${state.takes}` : 'Shooting';
      const res = await shoot({
        engine: state.engine,
        prompt,
        w: aspect.w,
        h: aspect.h,
        seed: Math.floor(Math.random() * 2 ** 31),
        comfyUrl: localStorage.getItem('massless.comfy-url') || 'http://127.0.0.1:8188',
        ckpt: localStorage.getItem('massless.comfy-ckpt') || 'flux1-schnell-fp8.safetensors',
        onWait: (ms) => ms > 0 && (pendings[i].textContent = `Free tier: next frame in ${Math.ceil(ms / 1000)} s`),
        onFallback: () => (pendings[i].textContent = 'Switching to Cloudflare Workers AI'),
      });
      const item = await addShot(res.image, { prompt, engine: res.engine, rig: { ...state.sel } });
      pendings[i].replaceWith(shotCard(item, true));
      done++;
    }
    toast(state.takes > 1 ? `${done} takes ready. Hover one and press Animate to move the camera.` : 'Shot ready. Hover it and press Animate to move the camera.');
  } catch (err) {
    pendings.slice(done).forEach((p) => p.remove());
    toast(err.message || 'The shot failed. Try again.', 'error');
  } finally {
    state.busy = false;
    btn.disabled = false;
    $('#shoot-label').textContent = 'Generate';
  }
}

async function loadUpload(file) {
  if (!file || !file.type.startsWith('image/')) { toast('That file is not an image. Use a JPEG, PNG or WebP.', 'error'); return; }
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const item = await addShot(c, { prompt: '', engine: 'upload' });
  $('#results-wrap').hidden = false;
  $('#results').prepend(shotCard(item, true));
  toast('Still added. Press Animate on it to move the camera.');
}

// ---------- inspiration ----------
function buildInspo() {
  const grid = $('#inspo');
  for (const s of SAMPLES) {
    const look = LOOKS[s.key];
    const b = el('button', { type: 'button', class: 'look' },
      el('img', { loading: 'lazy', src: `/media/art/${s.key}.jpg`, alt: s.prompt }),
      el('span', {}, s.name, el('em', {}, `${pick(state.rig, 'camera', look.camera).name}, ${look.focal}mm, f/${look.aperture}`)));
    b.addEventListener('click', () => {
      $('#subject').value = s.prompt;
      Object.assign(state.sel, look);
      updateChips();
      refreshPrompt(true);
      autoGrow();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      $('#subject').focus({ preventScroll: true });
      toast(`${s.name} loaded. Press Generate to shoot your own take.`);
    });
    grid.append(b);
  }
}

function autoGrow() {
  const t = $('#subject');
  t.style.height = 'auto';
  t.style.height = `${Math.min(160, t.scrollHeight)}px`;
}

async function init() {
  state.rig = await loadRig();
  try { state.engine = localStorage.getItem('massless.engine') || 'auto'; } catch {}
  updateChips();
  refreshPrompt(true);
  buildInspo();
  restore();
  bindDialogs();
  autoplayVideos(document.querySelectorAll('video[data-src]'));

  $('#pbar').addEventListener('submit', doShoot);
  $('#subject').addEventListener('input', () => { autoGrow(); refreshPrompt(); });
  $('#subject').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doShoot(); } });
  $('#compiled').addEventListener('input', () => (state.edited = true));
  $('#hero-cta').addEventListener('click', () => $('#subject').focus());
  $('#upload').addEventListener('change', (e) => loadUpload(e.target.files[0]));
  $('#takes-minus').addEventListener('click', () => { state.takes = Math.max(1, state.takes - 1); updateChips(); });
  $('#takes-plus').addEventListener('click', () => { state.takes = Math.min(4, state.takes + 1); updateChips(); });
  document.querySelectorAll('[data-pop]').forEach((c) => c.addEventListener('click', () => openPop(c.dataset.pop, c)));
  document.addEventListener('click', (e) => { if (popOwner && !$('#pop').contains(e.target) && !popOwner.contains(e.target)) closePop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popOwner) { const c = popOwner; closePop(); c.focus(); } });
  const params = new URLSearchParams(location.search);
  if (params.get('prompt')) { $('#subject').value = params.get('prompt'); refreshPrompt(true); autoGrow(); }
  window.massless = { state };
}

init();
