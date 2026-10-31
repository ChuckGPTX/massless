import {cloudConfig} from '../cloud.js';
import { loadRig, compilePrompt, pick, DEFAULT_SEL } from '../rig.js';
import { shoot, MODELS, MODEL_GROUPS, DEFAULT_MODEL, negativeFor } from '../engines.js';
import * as store from '../store.js';
import { autoplayVideos, bindDialogs, toast, el, download, SAMPLES } from '../ui.js';

const $ = (s) => document.querySelector(s);
const ls = {
  get(k, d = '') { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const COMFY_URL = 'http://127.0.0.1:8188';
const COMFY_CKPT = 'flux1-schnell-fp8.safetensors';

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

let connectedConfig={models:{}};
const state = { rig: null, sel: { ...DEFAULT_SEL }, takes: 1, edited: false, busy: false, model: DEFAULT_MODEL };

// ---------- prompt ----------
function refreshPrompt(force = false) {
  if (state.edited && !force) return;
  $('#compiled').value = compilePrompt(state.rig, $('#subject').value, state.sel);
  if (state.model === 'moss-image-sft') $('#compiled').value = $('#compiled').value.replace(/, no text$/, '');
  state.edited = false;
  updateNegative();
}

/** Show the negative prompt SDXL-family models receive, so the prompt peek stays the whole truth. */
function updateNegative() {
  const neg = negativeFor(state.model, $('#compiled').value);
  $('#neg-line').hidden = !neg;
  $('#neg-model').textContent = MODELS[state.model].short;
  $('#neg').textContent = neg;
}

function comfyLabel(ckpt = COMFY_CKPT) {
  return /schnell/i.test(ckpt) ? MODELS.comfy.short : `ComfyUI · ${ckpt.replace(/\.(safetensors|ckpt|gguf|pt)$/i, '')}`;
}

function updateChips() {
  const R = state.rig;
  $('#chip-camera').textContent = pick(R, 'camera', state.sel.camera).name;
  $('#chip-lens').textContent = pick(R, 'lens', state.sel.lens).name;
  $('#chip-focal').textContent = `${state.sel.focal}mm`;
  $('#chip-aperture').textContent = `f/${state.sel.aperture}`;
  $('#chip-aspect').textContent = pick(R, 'aspect', state.sel.aspect).name;
  $('#chip-model').textContent = state.model === 'comfy' ? comfyLabel(ls.get('massless.comfy-ckpt', COMFY_CKPT)) : MODELS[state.model].short;
  $('#takes-n').textContent = state.takes;
  $('#takes-n').dataset.unit = state.takes === 1 ? 'take' : 'takes';
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

function pickModel(k, chip) {
  if (!MODELS[k]) return;
  state.model = k;
  ls.set('massless.image-model', k);
  updateChips();
  refreshPrompt();
  updateNegative();
  closePop();
  if (k === 'comfy') { openPop('model', chip); $('#pop').scrollTop = $('#pop').scrollHeight; }
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
  if (kind === 'model') {
    pop.append(el('h3', {}, 'Model'));
    const groups = MODEL_GROUPS.map((g) => {
      const items = Object.entries(MODELS).filter(([, m]) => m.group === g.id).map(([id, m]) => ({ id, ...m }));
      const opts = optGroup(items, (x) => x.id, (x) => [el('strong', {}, x.name), el('small', {}, x.id==='moss-image-sft'&&!connectedConfig.models?.['moss-image-sft']?'Connection being prepared · other models are ready':x.note), el('small', { class: 'lic' }, x.licence)], state.model, (k) => pickModel(k, chip));
      opts.classList.add('models');
      opts.setAttribute('aria-label', g.name);
      return el('div', { class: 'mgroup' }, el('h4', {}, g.name), opts);
    });
    // Cloudflare's four get the full width; the two single options share a row.
    pop.append(groups[0], ...groups.slice(1));
    if (state.model === 'moss-image-sft') pop.append(el('a',{href:'/projects/',class:'btn-ghost'},'Sign in to try MOSS Image ↗'));
    if (state.model === 'comfy') {
      const url = el('input', { value: ls.get('massless.comfy-url', COMFY_URL), inputmode: 'url' });
      const ck = el('input', { value: ls.get('massless.comfy-ckpt', COMFY_CKPT) });
      url.addEventListener('change', () => ls.set('massless.comfy-url', url.value));
      ck.addEventListener('change', () => { ls.set('massless.comfy-ckpt', ck.value); updateChips(); });
      pop.append(el('label', { class: 'f' }, 'ComfyUI address', url), el('label', { class: 'f' }, 'Checkpoint', ck));
      pop.append(el('p', { class: 'note', html: 'Start ComfyUI with <code>--enable-cors-header</code>. <a href="/comfy/massless_shot_flux_schnell.api.json" download style="color:var(--accent)">Download the workflow</a>.' }));
    }
    pop.append(el('p', { class: 'note' }, 'Browser tools and the Cloudflare allowance remain free. Connected models have their own limited preview allowance.'));
  }
  pop.setAttribute('aria-label', pop.querySelector('h3')?.textContent || 'Options');
  pop.hidden = false;
  chip.setAttribute('aria-expanded', 'true');
  popOwner = chip;
  fitPop();
  const checked = pop.querySelector('[aria-checked="true"]');
  if (checked) {
    if (checked.offsetTop + checked.offsetHeight > pop.clientHeight) pop.scrollTop = checked.offsetTop - 48;
    checked.focus({ preventScroll: true });
  }
}

/** Popovers open upward: keep them below the sticky nav, scrolling the page up or capping the height. */
function fitPop() {
  const pop = $('#pop');
  pop.style.maxHeight = '';
  pop.scrollTop = 0;
  const cap = parseFloat(getComputedStyle(pop).maxHeight);
  const want = Math.min(pop.scrollHeight, Number.isFinite(cap) ? cap : Infinity);
  const navBottom = document.querySelector('.nav')?.getBoundingClientRect().bottom || 0;
  const room = () => $('#pbar').getBoundingClientRect().top - 10 - navBottom - 8;
  if (room() < want && window.scrollY > 0) window.scrollBy({ top: -Math.min(window.scrollY, want - room()), behavior: 'instant' });
  if (room() < want) pop.style.maxHeight = `${Math.max(180, Math.floor(room()))}px`;
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

/** The model that actually rendered a shot. Older saved shots only know their engine. */
function shotLabel(item) {
  if (item.engine === 'upload') return 'Your still';
  if (item.model === 'comfy' || item.engine === 'comfy') return comfyLabel(item.ckpt);
  if (MODELS[item.model]) return MODELS[item.model].short;
  return { pollinations: 'Pollinations', workers: 'FLUX.1 schnell' }[item.engine] || 'Shot';
}

function shotCard(item, fresh = false) {
  const url = URL.createObjectURL(item.thumb || item.blob);
  const label = shotLabel(item) + (item.unsaved ? ' · Not saved — download before leaving' : '');
  const card = el('div', { class: `shot${fresh ? ' fresh' : ''}`, 'data-id': item.id, 'data-model': item.model || item.engine || '', 'data-seed': item.seed ?? '' },
    el('img', { src: url, alt: item.prompt ? item.prompt.slice(0, 120) : 'Shot' }),
    el('span', { class: 'tag', title: item.seed != null ? `${label}, seed ${item.seed}` : label }, label),
    el('div', { class: 'acts' },
      item.unsaved ? null : el('a', { class: 'go', href: `/video?shot=${encodeURIComponent(item.id)}` }, 'Animate'),
      item.unsaved ? null : el('a', { href: `/3d?shot=${encodeURIComponent(item.id)}` }, '3D'),
      el('button', { type: 'button', onclick: () => download(item.blob, `${item.id}.jpg`) }, 'Download'),
      item.prompt ? el('button', { type: 'button', onclick: () => { $('#compiled').value = item.prompt; state.edited = true; $('#prompt-peek').open = true; toast('Prompt loaded. Press Generate to shoot it again.'); } }, 'Reuse prompt') : null,
      el('button', { type: 'button', 'aria-label': 'Delete shot', onclick: async () => {
        try { if (!item.unsaved) await store.del(item.id); }
        catch { toast('Could not delete this shot. Try again.', 'error'); return; }
        URL.revokeObjectURL(url);
        card.remove();
        if (!$('#results').children.length) loadOlderShots();
        if (!$('#results').children.length) $('#results-wrap').hidden = true;
      } }, '×')));
  return card;
}

async function addShot(image, meta) {
  const id = `shot-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const item = { id, kind: 'shot', created: Date.now(), ...meta, blob: await toJpeg(image), thumb: await thumbOf(image) };
  try { await store.put(item); } catch { item.unsaved = true; }
  return item;
}

let olderShots = [];
function loadOlderShots() {
  for (const item of olderShots.splice(0, 24)) $('#results').append(shotCard(item));
  $('#more-shots').hidden = olderShots.length === 0;
}

async function restore() {
  let saved;
  try { saved = await store.all(); }
  catch { toast('Could not open your saved shots. Try reloading this page.', 'error'); return; }
  const items = saved.filter((x) => (x.kind || 'shot') === 'shot').sort((a, b) => b.created - a.created);
  if (!items.length) return;
  $('#results-wrap').hidden = false;
  olderShots = items;
  loadOlderShots();
}

// ---------- shooting ----------
/** Pollinations' free tier spaces images 45 s apart; count the wait down on the pending card. */
function countdown(node, ms, after) {
  const end = Date.now() + ms;
  const tick = () => {
    const s = Math.ceil((end - Date.now()) / 1000);
    if (s <= 0 || !node.isConnected) { clearInterval(timer); if (node.isConnected) node.textContent = after; return; }
    node.textContent = `Pollinations allows 1 image per 45 s. Next one in ${s} s`;
  };
  const timer = setInterval(tick, 1000);
  tick();
}

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
  const model = state.model;
  const name = model === 'comfy' ? comfyLabel(ls.get('massless.comfy-ckpt', COMFY_CKPT)) : MODELS[model].short;
  for (let i = 0; i < state.takes; i++) {
    const p = el('div', { class: 'shot pending' }, i === 0 ? `${state.takes > 1 ? 'Take 1 rendering' : 'Rendering'} · ${name}` : `Take ${i + 1} queued`);
    p.style.aspectRatio = `${aspect.w} / ${aspect.h}`;
    grid.prepend(p);
    pendings.unshift(p);
  }
  $('#results-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const negative = negativeFor(model, prompt);
  const comfyUrl = ls.get('massless.comfy-url', COMFY_URL);
  const ckpt = ls.get('massless.comfy-ckpt', COMFY_CKPT);
  // Distinct seeds per take: one random base, then fixed prime steps.
  const base = Math.floor(Math.random() * 2 ** 31);
  let done = 0;
  let unsaved = 0;
  try {
    for (let i = 0; i < state.takes; i++) {
      $('#shoot-label').textContent = state.takes > 1 ? `Take ${i + 1}/${state.takes}` : 'Shooting';
      if (i > 0) pendings[i].textContent = `Take ${i + 1} rendering · ${name}`;
      const seed = (base + i * 104729) % 2 ** 31;
      const res = await shoot({
        model,
        prompt,
        negative,
        w: aspect.w,
        h: aspect.h,
        seed,
        comfyUrl,
        ckpt,
        onWait: (ms, phase) => {if(ms>0)countdown(pendings[i],ms,`Rendering · ${name}`);else if(phase)pendings[i].textContent=(phase==='IN_QUEUE'?'Preparing your image':'Rendering your image')+' · '+name;},
      });
      const item = await addShot(res.image, { prompt, negative: negative || undefined, engine: res.engine, model: res.model, seed, ckpt: res.engine === 'comfy' ? ckpt : undefined, rig: { ...state.sel } });
      if (item.unsaved) unsaved++;
      pendings[i].replaceWith(shotCard(item, true));
      done++;
    }
    if (unsaved) toast('Browser storage could not save every shot. Download the shots marked Not saved before leaving.', 'error');
    else toast(state.takes > 1 ? `${done} takes ready. Hover one and press Animate to move the camera.` : 'Shot ready. Hover it and press Animate to move the camera.');
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
  toast(item.unsaved ? 'This still could not be saved. Download it before leaving.' : 'Still added. Press Animate on it to move the camera.', item.unsaved ? 'error' : undefined);
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
  connectedConfig=await cloudConfig();
  state.rig = await loadRig();
  const params = new URLSearchParams(location.search);
  // Remembered model; earlier visits stored an engine instead.
  const legacy = { pollinations: 'sana', comfy: 'comfy' }[ls.get('massless.engine')];
  const saved = ls.get('massless.image-model') || legacy;
  if (Object.hasOwn(MODELS, saved)) state.model = saved;
  const linkedModel = params.get('model');
  if (Object.hasOwn(MODELS, linkedModel)) state.model = linkedModel;
  updateChips();
  refreshPrompt(true);
  buildInspo();
  $('#more-shots').addEventListener('click', loadOlderShots);
  await restore();
  bindDialogs();
  autoplayVideos(document.querySelectorAll('video[data-src]'));

  $('#pbar').addEventListener('submit', doShoot);
  $('#subject').addEventListener('input', () => { autoGrow(); refreshPrompt(); });
  $('#subject').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doShoot(); } });
  $('#compiled').addEventListener('input', () => { state.edited = true; updateNegative(); });
  $('#hero-cta').addEventListener('click', () => $('#subject').focus());
  $('#upload').addEventListener('change', (e) => loadUpload(e.target.files[0]));
  $('#takes-minus').addEventListener('click', () => { state.takes = Math.max(1, state.takes - 1); updateChips(); });
  $('#takes-plus').addEventListener('click', () => { state.takes = Math.min(4, state.takes + 1); updateChips(); });
  document.querySelectorAll('[data-pop]').forEach((c) => c.addEventListener('click', () => openPop(c.dataset.pop, c)));
  // A click inside a popover that rebuilt itself (ComfyUI settings) lands on a detached node: not outside.
  document.addEventListener('click', (e) => { if (popOwner && e.target.isConnected && !$('#pop').contains(e.target) && !popOwner.contains(e.target)) closePop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popOwner) { const c = popOwner; closePop(); c.focus(); } });
  if (params.get('prompt')) { $('#subject').value = params.get('prompt'); refreshPrompt(true); autoGrow(); }
  const panel = params.get('panel');
  if (panel === 'prompt') $('#subject').focus();
  else if (['model', 'camera', 'lens', 'aspect', 'scene'].includes(panel) || linkedModel === 'comfy') {
    const kind = linkedModel === 'comfy' ? 'model' : panel;
    const chip = document.querySelector(`[data-pop="${kind}"]`);
    chip.focus();
    openPop(kind, chip);
  }
  window.massless = { state };
}

init();
