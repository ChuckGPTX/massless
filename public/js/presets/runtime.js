// The preset shell: /workflows?preset=<id>. Pick a sample or add your own photo and words, see the result at once,
// press Make it for every size (PNG, MP4 or a ZIP of all), and save to My library. Everything renders on this
// device; only the talking ad asks the site for a voice.

import { presetById, presetURL, PRESETS, SCENES } from './catalog.js';
import { defaults, outputList } from './spec.js';
import { canvas, loadImage, fileToImage, hasTransparency, quickCutout, applyMatte, trim, toBlob, encodeMP4, canExportVideo, clamp } from './common.js';
import { bump } from './popular.js';
import { saveAsset, downloadBlob } from '../assets.js';
import { pickFromLibrary, libraryChoices, savedItem } from './library-pick.js';
import { toast } from '../ui.js';
import { loadFonts, zipStore, slug } from '../make/kit.js';

const CAT = { ads: ['Ads & products', 'ads'], effects: ['Effects', 'effects'], social: ['Social', 'social'] };
const SIZE_NAMES = { '1080x1350': 'Feed 4:5', '1080x1920': 'Story 9:16', '1200x628': 'Link ad', '1080x1080': 'Square', '1280x720': 'Thumbnail', '1920x1080': 'Wide 16:9', '1080x1440': 'Portrait 3:4' };
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
};
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Loads an engine module by name. */
export const engineFor = (name) => import(`./engines/${name}.js`);

export async function start(id, root, { capture = new URLSearchParams(location.search).has('capture') } = {}) {
  const spec = presetById(id);
  if (!spec) return false;
  const engine = await engineFor(spec.engine);
  document.title = `${spec.title} | Chucksi workflows`;
  const params = { ...defaults(spec), dx: 0, dy: 0 };
  const q = new URLSearchParams(location.search);
  for (const i of spec.inputs) if (q.has(i.key) && i.type !== 'image' && (i.type !== 'choice' || i.options.some((o) => o.id === q.get(i.key))) && (i.type !== 'color' || /^#[0-9a-f]{6}$/i.test(q.get(i.key)))) params[i.key] = i.type === 'range' ? clamp(Number(q.get(i.key)) || i.default, i.min, i.max) : i.type === 'toggle' ? q.get(i.key) === '1' : String(q.get(i.key)).slice(0, i.max || 80);
  // image inputs: { kind: 'sample', index } or { kind: 'file', name, image } ; optional inputs start empty
  const picks = {};
  for (const i of spec.inputs) if (i.type === 'image') picks[i.key] = i.optional ? null : { kind: 'sample', index: 0 };
  const outputs = outputList(spec);
  let current = 0; // selected output tab
  let ctx = null, token = 0, results = [], playing = !reduceMotion(), raf = 0, t0 = performance.now();
  const cache = new Map(); // image + cut-out work, by source
  const fromLibrary = {}; // input key -> (saved item) => use it like an upload

  // ---------- inputs ----------
  const sourceOf = (key) => {
    const input = spec.inputs.find((i) => i.key === key);
    const p = picks[key];
    if (!p) return null;
    if (p.kind === 'sample') return { ...input.samples[p.index], id: `s:${input.samples[p.index].src}` };
    return { id: `f:${p.stamp}`, image: p.image, label: p.name };
  };
  async function getImage(key) {
    const s = sourceOf(key);
    if (!s) return null;
    return s.image || loadImage(s.src);
  }
  const io = {
    params,
    status: (t) => (status.textContent = t),
    image: getImage,
    has: (key) => !!picks[key],
    /** { img, cut, full, rough }: the input with its background removed. */
    async cutout(key) {
      const s = sourceOf(key);
      if (!s) return null;
      const k = `cut|${s.id}|${picks[key]?.precise ? 1 : 0}`;
      if (!cache.has(k)) cache.set(k, (async () => {
        const img = await getImage(key);
        if (picks[key]?.precise) return { img, ...(await preciseCut(img)), rough: false };
        if (s.src || hasTransparency(img)) {
          const c = canvas(img.width, img.height); c.getContext('2d').drawImage(img, 0, 0);
          return { img, cut: trim(c), full: c, rough: false };
        }
        return { img, ...quickCutout(img) };
      })());
      const r = await cache.get(k);
      noteRough(key, r.rough);
      return r;
    },
    /** { img, matte }: the photo and a canvas whose alpha is the subject (for depth effects). */
    async layers(key) {
      const s = sourceOf(key);
      if (!s) return null;
      const k = `layers|${s.id}|${picks[key]?.precise ? 1 : 0}`;
      if (!cache.has(k)) cache.set(k, (async () => {
        const img = await getImage(key);
        if (s.matte) {
          const m = await loadImage(s.matte).catch(() => null);
          if (m) return { img, matte: lumaToAlpha(m, img.width, img.height) };
        }
        if (picks[key]?.precise) { const r = await preciseCut(img); return { img, matte: r.full }; }
        const r = quickCutout(img);
        return { img, matte: r.rough ? null : r.full, rough: r.rough };
      })());
      const r = await cache.get(k);
      noteRough(key, r.rough);
      return r;
    },
  };
  function lumaToAlpha(m, w, hh) {
    const c = canvas(m.width, m.height), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(m, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i + 3] = d.data[i]; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; }
    g.putImageData(d, 0, 0);
    const out = canvas(w, hh), og = out.getContext('2d');
    og.imageSmoothingQuality = 'high';
    og.drawImage(c, 0, 0, w, hh);
    return out;
  }
  async function preciseCut(img) {
    const { runJob } = await import('../image-ai.js');
    const { resizeChannel } = await import('../image-tools.js');
    const small = canvas(512, 512), g = small.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, 512, 512); g.drawImage(img, 0, 0, 512, 512);
    const px = g.getImageData(0, 0, 512, 512).data;
    status.textContent = 'Cutting out precisely…';
    const res = await runJob('remove-bg', { model: 'birefnet', rgba: px, w: 512, h: 512 }, { transfer: [px.buffer], onProgress: (f, label) => (status.textContent = `${label || 'Preparing'}… ${Math.round((f || 0) * 100)}%`) });
    const W = Math.min(img.width, 1600), H = Math.round((img.height * W) / img.width);
    const m = resizeChannel(res.matte, res.w, res.h, W, H);
    const f = new Float32Array(m.length);
    for (let i = 0; i < m.length; i++) f[i] = m[i] / 255;
    return applyMatte(img, f, W, H);
  }

  // ---------- layout ----------
  const status = h('p', { class: 'maker-status', role: 'status', 'aria-live': 'polite' }, 'Loading…');
  const stageCanvas = h('canvas', { class: 'pz-canvas', role: 'img', 'aria-label': `${spec.title} preview` });
  const frame = h('div', { class: 'pz-frame' }, stageCanvas);
  const tabs = h('div', { class: 'pz-tabs', role: 'tablist', 'aria-label': 'Sizes' });
  const playBtn = h('button', { type: 'button', class: 'btn-ghost small pz-play', onclick: () => { playing = !playing; syncPlay(); } }, 'Pause');
  const makeBtn = h('button', { class: 'btn-accent', type: 'button', onclick: makeAll }, 'Make it ↗');
  const zipBtn = h('button', { class: 'btn-ghost', type: 'button', onclick: downloadZip, disabled: true }, 'Download all (.zip)');
  const saveBtn = h('button', { class: 'btn-ghost', type: 'button', onclick: saveAll, disabled: true }, 'Save to My library');
  const shareBtn = h('button', { class: 'btn-ghost', type: 'button', onclick: shareExplore, disabled: true }, 'Share to Explore');
  const resultsBox = h('div', { class: 'pz-results', 'aria-live': 'polite' });
  const form = h('form', { class: 'maker-form', onsubmit: (e) => { e.preventDefault(); makeAll(); } });
  const costNote = h('p', { class: 'maker-budget' }, spec.cost.tier === 'free' ? 'Free. Made on your device; your photos are not uploaded.' : 'Free, a few a day. The voice is made by Chucksi; your photos stay on your device.');
  const cat = CAT[spec.category];
  const outLine = [...new Set(outputs.map((o) => (o.type === 'video' ? 'MP4' : 'PNG')))].join(' + ') + ` · ${outputs.length} size${outputs.length > 1 ? 's' : ''}`;
  root.replaceChildren(
    h('div', { class: 'maker-head' },
      h('div', {},
        h('a', { class: 'maker-back', href: `/workflows#${cat[1]}` }, '← All workflows'),
        h('p', { class: 'eyebrow' }, cat[0].toUpperCase(), spec.badge ? h('span', { class: `wf-badge is-${spec.badge}` }, spec.badge === 'new' ? 'NEW' : 'TRENDING') : null),
        h('h1', {}, spec.title),
        h('p', { class: 'maker-lede' }, spec.description)),
      h('p', { class: 'maker-output' }, h('small', {}, 'YOU LEAVE WITH'), outLine)),
    h('div', { class: 'maker-body' },
      h('aside', { class: 'maker-side', 'aria-label': 'Preset settings' }, form),
      h('section', { class: 'maker-stage', 'aria-label': 'Preview' },
        status, tabs, frame,
        h('div', { class: 'pz-under' }, engine.kind === 'video' || outputs.some((o) => o.type === 'video') ? playBtn : null, spec.safety.disclosure ? h('small', { class: 'pz-disclosure' }, spec.safety.disclosure) : null, spec.note ? h('small', { class: 'pz-note' }, spec.note) : null),
        resultsBox,
        h('div', { class: 'maker-actions' }, h('button', { class: 'btn-accent pz-make-here', type: 'button', onclick: () => makeAll() }, 'Make it ↗'), zipBtn, saveBtn, shareBtn, h('a', { class: 'btn-ghost', href: '/library/' }, 'Open My library ↗')))),
    (spec.engine === 'scene' ? sceneStrip() : related()) || '',
  );
  root.hidden = false;
  function sceneStrip() {
    return h('section', { class: 'maker-showcase', 'aria-label': 'More scenes' },
      h('div', { class: 'maker-showcase-head' }, h('p', { class: 'eyebrow' }, 'SAME PRODUCT, NEW PLACE'), h('h2', {}, 'Try another scene')),
      h('div', { class: 'pz-strip' }, ...SCENES.map((s) => h('a', { class: `pz-scene${'scene-' + s.id === id ? ' is-on' : ''}`, href: presetURL('scene-' + s.id), onclick: (e) => { e.preventDefault(); switchScene('scene-' + s.id); } },
        h('img', { src: `/presets/plates/${s.id}-p.webp`, alt: '', loading: 'lazy', width: 108, height: 192 }), h('span', {}, s.title)))));
  }
  function related() {
    const list = PRESETS.filter((p) => p.category === spec.category && p.id !== id && p.engine === spec.engine).slice(0, 10);
    if (!list.length) return null;
    return h('section', { class: 'maker-showcase', 'aria-label': 'Related presets' },
      h('div', { class: 'maker-showcase-head' }, h('p', { class: 'eyebrow' }, 'MORE LIKE THIS'), h('h2', {}, 'Try another')),
      h('div', { class: 'pz-strip' }, ...list.map((p) => h('a', { class: 'pz-scene is-card', href: presetURL(p.id) },
        h('img', { src: p.preview.poster, alt: '', loading: 'lazy' }), h('span', {}, p.title)))));
  }
  function switchScene(next) {
    const keep = picks.product?.kind === 'file' ? picks.product : null;
    const u = new URL(location.href);
    u.searchParams.set('preset', next);
    for (const k of ['brand', 'tagline', 'size']) u.searchParams.set(k, String(params[k] ?? ''));
    history.replaceState(null, '', u.pathname + u.search);
    stopLoop();
    start(next, root, { capture }).then(() => { if (keep) window.__presetKeep?.(keep); });
  }

  // ---------- form ----------
  const rough = {};
  const edited = new Set();
  const unsent = {};
  function noteRough(key, isRough) {
    const box = rough[key];
    if (!box) return;
    box.hidden = !isRough;
  }
  for (const input of spec.inputs) form.append(field(input));
  form.append(h('div', { class: 'maker-side-foot' }, costNote, h('div', { class: 'maker-buttons' }, makeBtn)));

  function field(input) {
    const fid = `pz-${input.key}`;
    if (input.type === 'image') return imageField(input);
    let el;
    if (input.type === 'textarea') el = h('textarea', { id: fid, rows: 4, maxlength: input.max });
    else if (input.type === 'choice') {
      const wrap = h('div', { class: 'pz-choices', role: 'radiogroup', 'aria-label': input.label });
      for (const o of input.options) {
        const b = h('button', { type: 'button', class: 'pz-choice', role: 'radio', 'aria-checked': String(params[input.key] === o.id), 'data-id': o.id, onclick: () => {
          params[input.key] = o.id;
          for (const x of wrap.children) x.setAttribute('aria-checked', String(x.dataset.id === o.id));
          changed(input);
        } }, o.label);
        wrap.append(b);
      }
      return h('div', { class: 'maker-field' }, h('span', {}, input.label), wrap);
    } else if (input.type === 'range') el = h('input', { id: fid, type: 'range', min: input.min, max: input.max, step: input.step });
    else if (input.type === 'toggle') el = h('input', { id: fid, type: 'checkbox' });
    else if (input.type === 'color') el = h('input', { id: fid, type: 'color' });
    else el = h('input', { id: fid, type: 'text', maxlength: input.max, autocomplete: 'off', placeholder: input.placeholder || '' });
    el.dataset.key = input.key;
    if (input.type === 'toggle') el.checked = !!params[input.key];
    else el.value = params[input.key] ?? '';
    // A text field with a button (input.go): the words reach the engine only when the visitor presses the button,
    // presses Enter or presses Make it, never while typing.
    if (input.go) {
      unsent[input.key] = () => el.value !== (params[input.key] ?? '');
      const go = () => { params[input.key] = el.value; edited.add(input.key); changed(input, true); };
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      return h('label', { class: 'maker-field', for: fid }, h('span', {}, input.label), h('span', { class: 'pz-go' }, el, h('button', { type: 'button', class: 'btn-ghost small', onclick: go }, input.go)), input.hint ? h('small', {}, input.hint) : null);
    }
    const on = () => { params[input.key] = input.type === 'toggle' ? el.checked : input.type === 'range' ? Number(el.value) : el.value; edited.add(input.key); changed(input); };
    el.addEventListener('input', on);
    el.addEventListener('change', on);
    if (input.type === 'toggle') return h('label', { class: 'maker-check', for: fid }, el, h('span', {}, input.label));
    return h('label', { class: 'maker-field', for: fid }, h('span', {}, input.label), el, input.hint ? h('small', {}, input.hint) : null);
  }
  function imageField(input) {
    const strip = h('div', { class: 'pz-samples', role: 'radiogroup', 'aria-label': `${input.label}: samples` });
    const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, 'data-key': input.key });
    const upload = h('label', { class: 'pz-sample pz-upload', title: 'Add your own' }, file, h('span', { 'aria-hidden': 'true' }, '+'), h('small', {}, 'Yours'));
    const draw = () => {
      for (const b of strip.querySelectorAll('.pz-sample[data-i]')) b.setAttribute('aria-checked', String(picks[input.key]?.kind === 'sample' && picks[input.key].index === Number(b.dataset.i)));
      upload.classList.toggle('is-on', picks[input.key]?.kind === 'file' && !picks[input.key].lib);
      lib.classList.toggle('is-on', !!picks[input.key]?.lib);
      none?.setAttribute('aria-checked', String(!picks[input.key]));
    };
    let none = null;
    if (input.optional) {
      none = h('button', { type: 'button', class: 'pz-sample pz-none', role: 'radio', title: 'None', onclick: () => { picks[input.key] = null; draw(); changed(input, true); } }, h('span', { 'aria-hidden': 'true' }, '–'), h('small', {}, 'None'));
      strip.append(none);
    }
    input.samples.forEach((s, i) => strip.append(h('button', { type: 'button', class: 'pz-sample', role: 'radio', 'data-i': i, title: s.label, onclick: () => {
      picks[input.key] = { kind: 'sample', index: i };
      if (s.params) for (const [k, v] of Object.entries(s.params)) if (!edited.has(k)) params[k] = v;
      draw(); syncFields(); changed(input, true);
    } }, h('img', { src: s.src, alt: '', loading: 'lazy' }), h('small', {}, s.label))));
    // My library: the visitor's saved pictures, used exactly like an upload
    const lib = h('button', { type: 'button', class: 'pz-sample pz-upload pz-lib-open', title: 'Choose from My library', 'data-key': input.key, onclick: async () => {
      const it = await pickFromLibrary(input);
      if (it) await fromLibrary[input.key](it);
    } }, h('span', { 'aria-hidden': 'true' }, '▤'), h('small', {}, 'My library'));
    strip.append(upload, lib);
    const use = async (blob, name, libId = null, render = true) => {
      try {
        const image = await fileToImage(blob);
        picks[input.key] = { kind: 'file', name, image, stamp: Date.now(), lib: libId };
        draw(); if (render) changed(input, true);
      } catch (e) { toast(e.message, 'error'); }
    };
    fromLibrary[input.key] = (it, render) => use(it.blob, it.name || 'My library', it.id, render);
    file.addEventListener('change', async () => {
      const f = file.files[0];
      file.value = '';
      if (f) await use(f, f.name);
    });
    const precise = h('div', { class: 'pz-rough', hidden: true },
      h('small', {}, 'The background looks busy, so the edges may be rough.'),
      h('button', { type: 'button', class: 'btn-ghost small', onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          const { downloadNote } = await import('../image-ai.js');
          const note = await downloadNote('birefnet');
          if (note.bytes && !confirm(`${note.text}\n\nCut out precisely now?`)) return;
          picks[input.key] = { ...picks[input.key], precise: true };
          precise.hidden = true;
          changed(input, true);
        } catch (err) { toast(`Couldn’t cut it out precisely: ${err.message}`, 'error'); } finally { b.disabled = false; }
      } }, 'Cut out precisely'));
    if (input.prep?.length) rough[input.key] = precise;
    window.__presetKeep = (keep) => { picks[input.key] = keep; draw(); changed(input, true); };
    draw();
    return h('div', { class: 'maker-field pz-image' }, h('span', {}, input.label), strip, precise, input.hint ? h('small', {}, input.hint) : null);
  }
  function syncFields() {
    for (const input of spec.inputs) {
      const el = form.querySelector(`[data-key="${input.key}"]:not([type=file])`);
      if (!el) continue;
      if (input.type === 'toggle') el.checked = !!params[input.key]; else el.value = params[input.key] ?? '';
    }
  }

  // ---------- render ----------
  let prepTimer = 0;
  function changed(input, heavy = false) {
    results = []; resultsBox.replaceChildren(); zipBtn.disabled = saveBtn.disabled = shareBtn.disabled = true;
    if (heavy || input?.heavy || engine.heavy?.includes(input?.key)) { clearTimeout(prepTimer); prepTimer = setTimeout(prepare, 30); }
    else drawNow();
  }
  async function prepare() {
    const mine = ++token;
    root.classList.add('is-busy');
    status.textContent = 'Getting it ready…';
    try {
      await loadFonts();
      const c = await engine.prepare(spec, io, params);
      if (mine !== token) return;
      ctx = c;
      status.textContent = (engine.kind === 'video' ? 'Preview is playing. Press Make it for the full-size files.' : 'Ready. Change anything and it updates; press Make it for every size.') + (c.note ? ` ${c.note}` : '');
      drawNow();
      startLoop();
    } catch (e) {
      if (mine === token) { status.textContent = `Something went wrong: ${e.message}`; console.warn(e); }
    } finally {
      if (mine === token) root.classList.remove('is-busy');
    }
  }
  const out = () => outputs[current];
  const loopDur = () => (engine.duration && ctx ? engine.duration(ctx, params, out()) : out().duration);
  const isMoving = () => out().type === 'video';
  function sizeStage() {
    const o = out();
    const k = Math.min(1, 900 / Math.max(o.w, o.h));
    const W = Math.round(o.w * k), H = Math.round(o.h * k);
    if (stageCanvas.width !== W || stageCanvas.height !== H) { stageCanvas.width = W; stageCanvas.height = H; }
    frame.style.aspectRatio = `${o.w} / ${o.h}`;
    frame.classList.toggle('is-tall', o.h / o.w > 1.3);
    frame.classList.toggle('is-wide', o.w / o.h > 1.3);
  }
  function drawNow(t = null) {
    if (!ctx) return;
    sizeStage();
    const o = out();
    try {
      engine.render(ctx, stageCanvas, { w: stageCanvas.width, h: stageCanvas.height, t: isMoving() ? (t ?? 0) : null, duration: loopDur(), params, preview: true });
      void o;
    } catch (e) { console.warn(e); status.textContent = `Something went wrong: ${e.message}`; }
  }
  function startLoop() { cancelAnimationFrame(raf); syncPlay(); }
  function stopLoop() { cancelAnimationFrame(raf); playing = false; }
  function syncPlay() {
    playBtn.hidden = !isMoving();
    playBtn.textContent = playing ? 'Pause' : 'Play';
    if (playing && isMoving()) { cancelAnimationFrame(raf); t0 = performance.now(); raf = requestAnimationFrame(function f(now) { if (!playing || !isMoving()) return; drawNow(((now - t0) / 1000) % loopDur()); raf = requestAnimationFrame(f); }); }
    else if (isMoving()) drawNow(Math.min(loopDur() * 0.45, 2.5));
  }
  outputs.forEach((o, i) => tabs.append(h('button', { type: 'button', role: 'tab', class: 'pz-tab', 'aria-selected': String(i === current), onclick: () => {
    current = i;
    for (const [j, b] of [...tabs.children].entries()) b.setAttribute('aria-selected', String(j === i));
    drawNow(); startLoop();
  } }, SIZE_NAMES[o.size] || o.size, o.type === 'video' ? h('small', {}, ' · video') : null)));

  // drag the product around on scene presets
  if (engine.drag) {
    let grab = null;
    stageCanvas.classList.add('is-draggable');
    const pos = (e) => { const r = stageCanvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    stageCanvas.addEventListener('pointerdown', (e) => {
      if (!ctx?.hit) return;
      const [x, y] = pos(e);
      const r = ctx.hit;
      if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) return;
      grab = { x, y, dx: params.dx, dy: params.dy };
      stageCanvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    stageCanvas.addEventListener('pointermove', (e) => {
      if (!grab) return;
      const [x, y] = pos(e);
      params.dx = clamp(grab.dx + (x - grab.x), -0.4, 0.4);
      params.dy = clamp(grab.dy + (y - grab.y), -0.3, 0.3);
      drawNow();
    });
    const end = () => { if (grab) { grab = null; changed(null); } };
    stageCanvas.addEventListener('pointerup', end);
    stageCanvas.addEventListener('pointercancel', end);
  }

  // ---------- make, download, save ----------
  async function renderOutput(o, onProgress) {
    const c = canvas(o.w, o.h);
    if (o.type === 'image') {
      engine.render(ctx, c, { w: o.w, h: o.h, t: null, params, preview: false });
      return toBlob(c, 'image/png');
    }
    const audio = engine.audio ? await engine.audio(ctx, params) : null;
    const duration = engine.duration ? engine.duration(ctx, params, o) : o.duration;
    return encodeMP4(c, { duration, fps: o.fps, audio, onProgress, bitrate: engine.bitrate || 0, draw: (cv, t) => engine.render(ctx, cv, { w: o.w, h: o.h, t, duration, params, preview: false }) });
  }
  async function makeAll() {
    // Make it also submits words typed into a field with a button but not sent yet.
    if (spec.inputs.some((i) => unsent[i.key]?.())) {
      for (const i of spec.inputs) if (unsent[i.key]?.()) params[i.key] = form.querySelector(`[data-key="${i.key}"]`).value;
      await prepare();
    }
    if (!ctx) return;
    if (outputs.some((o) => o.type === 'video') && !canExportVideo()) toast('Video export needs a recent Chrome, Edge or Safari. Stills still download.', 'error');
    makeBtn.disabled = true;
    for (const b of root.querySelectorAll('.pz-make-here')) b.disabled = true;
    const was = playing; playing = false; cancelAnimationFrame(raf);
    results = [];
    resultsBox.replaceChildren();
    root.classList.add('is-busy');
    try {
      for (const [i, o] of outputs.entries()) {
        if (o.type === 'video' && !canExportVideo()) continue;
        const label = `${SIZE_NAMES[o.size] || o.size}${o.type === 'video' ? ' video' : ''}`;
        status.textContent = `Making ${label} (${i + 1} of ${outputs.length})…`;
        const blob = await renderOutput(o, (f) => (status.textContent = `Making ${label} (${i + 1} of ${outputs.length})… ${Math.round(f * 100)}%`));
        const r = { ...o, blob, label, url: URL.createObjectURL(blob), file: `${slug(params.brand || spec.title)}-${o.w}x${o.h}.${o.type === 'video' ? 'mp4' : 'png'}` };
        results.push(r);
        resultsBox.append(resultCard(r));
      }
      bump(spec.id, 2);
      zipBtn.disabled = saveBtn.disabled = shareBtn.disabled = !results.length;
      status.textContent = `Done: ${results.length} file${results.length === 1 ? '' : 's'}. Download them one by one, as a ZIP, or save them to My library.`;
      if (spec.engine === 'talking' && ctx?.voiceNote) status.textContent += ` ${ctx.voiceNote}`;
      if (ctx?.note) status.textContent += ` ${ctx.note}`;
    } catch (e) {
      status.textContent = `Couldn’t finish: ${e.message}`;
      console.warn(e);
    } finally {
      makeBtn.disabled = false;
      for (const b of root.querySelectorAll('.pz-make-here')) b.disabled = false;
      root.classList.remove('is-busy');
      playing = was; syncPlay();
    }
  }
  function resultCard(r) {
    const media = r.type === 'video' ? h('video', { src: r.url, controls: true, playsinline: true, muted: true, loop: true }) : h('img', { src: r.url, alt: `${spec.title}, ${r.label}` });
    return h('figure', { class: 'pz-result' }, media,
      h('figcaption', {}, h('span', {}, r.label, h('small', {}, `${r.w} × ${r.h}${r.type === 'video' ? ' · MP4' : ' · PNG'}`)),
        h('button', { type: 'button', class: 'btn-ghost small', onclick: () => downloadBlob(r.blob, r.file) }, r.type === 'video' ? 'MP4 ↓' : 'PNG ↓')));
  }
  async function downloadZip() {
    if (!results.length) return;
    const files = [];
    for (const r of results) files.push({ name: r.file, bytes: new Uint8Array(await r.blob.arrayBuffer()) });
    files.push({ name: 'recipe.json', bytes: new TextEncoder().encode(JSON.stringify({ preset: spec.id, version: 1, settings: params, made: new Date().toISOString() }, null, 2)) });
    downloadBlob(new Blob([zipStore(files)], { type: 'application/zip' }), `${slug(params.brand || spec.title)}-${spec.id}.zip`);
  }
  // Share to Explore: the first result, and a Remix link that reopens this preset with the same words and choices.
  async function shareExplore() {
    const r = results.find((x) => x.type === 'video' && x.blob.size <= 8 * 1048576) || results.find((x) => x.type === 'image');
    if (!r) { toast(results.length ? 'This clip is too big to share to Explore (8 MB at most). Download it instead.' : 'Press Make it first, then share it.'); return; }
    const q = new URLSearchParams({ preset: spec.id });
    for (const i of spec.inputs) {
      const v = params[i.key];
      if (i.type === 'image' || v === undefined || v === null || v === '') continue;
      q.set(i.key, i.type === 'toggle' ? (v ? '1' : '0') : String(v));
    }
    let remixUrl = `/workflows?${q}`;
    if (remixUrl.length > 6000) remixUrl = presetURL(spec.id);
    try {
      const m = await import('../explore-share.js');
      await m.shareToExplore({ blob: r.blob, title: params.brand || spec.title, tool: 'design', remixUrl, width: r.w, height: r.h, tags: spec.tags.slice(0, 3) });
    } catch (e) { toast(e.message, 'error'); }
  }
  async function saveAll() {
    if (!results.length) return;
    saveBtn.disabled = true;
    try {
      for (const r of results) await saveAsset(r.blob, { name: `${spec.title} · ${r.label}`, engine: 'preset', prompt: '', settings: { preset: spec.id, size: r.size, ...params } });
      toast(`Saved ${results.length} file${results.length === 1 ? '' : 's'} to My library.`);
    } catch {
      toast('Couldn’t save here. Download the ZIP instead.', 'error');
    } finally { saveBtn.disabled = false; }
  }

  // ---------- gallery loop capture (tools/presets/render-previews.cjs) ----------
  if (capture) window.__presetCapture = captureAPI();
  function captureAPI() {
    const SIZES = { '16/9': [768, 432], '9/16': [406, 720], '4/5': [432, 540], '3/4': [432, 576], '1/1': [540, 540] };
    const size = SIZES[spec.preview.ar] || [432, 540];
    const c = canvas(size[0], size[1]);
    const prevOut = outputs.find((o) => o.type === 'video') || outputs[0];
    const variants = [];
    return {
      size, canvas: c,
      /** One full-size still of the current settings (sample 0), with optional parameter overrides. */
      async still(w, hh, over = {}, type = 'image/webp', q = 0.9) {
        await loadFonts();
        const p = { ...params, ...over };
        const cx = await engine.prepare(spec, io, p);
        const cv = canvas(w, hh);
        engine.render(cx, cv, { w, h: hh, t: over._t ?? null, duration: 6, params: p, preview: false });
        return cv.toDataURL(type, q);
      },
      async setup() {
        const loopSamples = spec.preview.loop === 'samples';
        const key = spec.inputs.find((i) => i.type === 'image')?.key;
        const n = loopSamples ? Math.min(3, spec.inputs.find((i) => i.key === key).samples.length) : 1;
        for (let k = 0; k < n; k++) {
          picks[key] = { kind: 'sample', index: k };
          const s = spec.inputs.find((i) => i.key === key).samples[k];
          const p = { ...params, ...(s.params || {}) };
          await loadFonts();
          variants.push({ ctx: await engine.prepare(spec, io, p), params: p });
        }
        const moving = !loopSamples;
        const dur = engine.galleryDuration ? engine.galleryDuration(variants[0].ctx, variants[0].params) : moving ? Math.min(5.5, prevOut.duration || 5) : 4.8;
        return { duration: dur, moving };
      },
      frame(t, dur) {
        const g = c.getContext('2d');
        if (variants.length > 1) {
          const seg = dur / variants.length, i = Math.floor(t / seg) % variants.length, local = (t % seg) / seg;
          const drawVar = (v, lt, alpha) => {
            const tmp = canvas(c.width, c.height);
            engine.render(v.ctx, tmp, { w: c.width, h: c.height, t: null, params: v.params, preview: true });
            g.save(); g.globalAlpha = alpha;
            const z = 1 + 0.04 * lt;
            g.translate(c.width / 2, c.height / 2); g.scale(z, z); g.drawImage(tmp, -c.width / 2, -c.height / 2); g.restore();
          };
          drawVar(variants[i], local, 1);
          const fade = 0.14;
          if (local > 1 - fade) drawVar(variants[(i + 1) % variants.length], 0, (local - (1 - fade)) / fade);
          return c.toDataURL('image/jpeg', 0.9);
        }
        const v = variants[0];
        const D = engine.galleryDuration ? dur : prevOut.type === 'video' ? prevOut.duration : dur;
        engine.render(v.ctx, c, { w: c.width, h: c.height, t: prevOut.type === 'video' ? (t / dur) * D : null, duration: D, params: v.params, preview: true, gallery: true });
        return c.toDataURL('image/jpeg', 0.9);
      },
    };
  }

  // ?asset=<id>: open with a saved item from My library already chosen
  const asset = await savedItem(q.get('asset'));
  const takes = asset && spec.inputs.find((i) => fromLibrary[i.key] && libraryChoices([asset], i).length);
  if (takes) await fromLibrary[takes.key](asset, false);
  // the first tab is the most useful: for social, the post; otherwise the first size
  await prepare();
  return true;
}
