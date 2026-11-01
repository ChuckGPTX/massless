// The one-click design workflow shell: /workflows?make=<id>.
// It shows a workflow's fields, renders its artboards straight away from bundled sample frames (zero AI calls),
// and repaints with FLUX.1 schnell (/api/shot) when you press Make it or Surprise me. Text edits re-render live
// without spending frames. Every artboard downloads as PNG (print pieces also as PDF) and saves to My library.

import { DESIGN_WORKFLOWS } from '../workflow-data.js';
import { loadFonts, flux, toBlob, pdfFromJpegs, zipStore, slug, loadImage, rng, hashStr } from './kit.js';
import { saveAsset, downloadBlob } from '../assets.js';
import { toast } from '../ui.js';

const LOADERS = {
  map: () => import('./map.js'),
  identity: () => import('./identity.js'),
  'film-poem': () => import('./filmpoem.js'),
  poetry: () => import('./poetry.js'),
  festival: () => import('./festival.js'),
};
export const MAKER_IDS = Object.keys(LOADERS);

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

export async function start(id, root) {
  const meta = DESIGN_WORKFLOWS.find((w) => w.id === id);
  if (!meta || !LOADERS[id]) return false;
  const mod = (await LOADERS[id]()).default;
  document.title = `${meta.name} — Chucksi workflows`;

  let state = structuredClone(mod.presets[0].state);
  let samples = { ...mod.presets[0].samples };
  const params = new URLSearchParams(location.search);
  // /workflows?make=<id>&example=<showcase id> opens a Made-with-Chucksi example ready to remix.
  const exampleId = params.get('example');
  if (exampleId) {
    try {
      const x = (await (await fetch('/data/showcase.json')).json()).find((e) => e.id === exampleId && e.workflow === id);
      if (x) { state = { ...state, ...structuredClone(x.state) }; samples = { ...x.samples }; }
    } catch { /* fall back to the default example */ }
  }
  for (const f of mod.fields) if (params.has(f.key)) state[f.key] = f.type === 'range' ? Number(params.get(f.key)) : params.get(f.key).slice(0, f.max || 400);

  const cache = new Map(); // prompt|size|seed -> image
  const lastBySlot = new Map(); // slot -> image last shown there
  const sampleImages = new Map(); // url -> image
  let token = 0, result = null, warned = false;

  // ---------- layout ----------
  const status = h('p', { class: 'maker-status', role: 'status', 'aria-live': 'polite' }, 'Loading fonts…');
  const form = h('form', { class: 'maker-form', onsubmit: (e) => { e.preventDefault(); render('generate'); } });
  const makeBtn = h('button', { class: 'btn-accent', type: 'submit' }, 'Make it ↗');
  const surpriseBtn = h('button', { class: 'btn-ghost', type: 'button', onclick: surprise }, 'Surprise me');
  const budget = h('p', { class: 'maker-budget' });
  const player = h('div', { class: 'maker-player', hidden: true });
  const boards = h('div', { class: 'maker-boards' });
  const zipBtn = h('button', { class: 'btn-accent', type: 'button', onclick: downloadAll }, 'Download all (.zip)');
  const saveBtn = h('button', { class: 'btn-ghost', type: 'button', onclick: saveAll }, 'Save to My library');
  const showcase = h('div', { class: 'maker-showcase-row' });

  for (const f of mod.fields) form.append(field(f));
  form.append(h('div', { class: 'maker-side-foot' }, budget, h('div', { class: 'maker-buttons' }, makeBtn, surpriseBtn)));

  root.replaceChildren(
    h('div', { class: 'maker-head' },
      h('div', {},
        h('a', { class: 'maker-back', href: '/workflows/#design' }, '← All workflows'),
        h('p', { class: 'eyebrow' }, meta.tag),
        h('h1', {}, meta.name),
        h('p', { class: 'maker-lede' }, meta.description)),
      h('p', { class: 'maker-output' }, h('small', {}, 'YOU LEAVE WITH'), meta.output)),
    h('div', { class: 'maker-body' },
      h('aside', { class: 'maker-side', 'aria-label': 'Workflow settings' }, form),
      h('section', { class: 'maker-stage', 'aria-label': 'Result' },
        status, player, boards,
        h('div', { class: 'maker-actions' }, zipBtn, saveBtn, h('a', { class: 'btn-ghost', href: '/library/' }, 'Open My library ↗')))),
    h('section', { class: 'maker-showcase', 'aria-label': 'Made with Chucksi' },
      h('div', { class: 'maker-showcase-head' }, h('p', { class: 'eyebrow' }, 'MADE WITH CHUCKSI'), h('h2', {}, 'Start from an example'), h('p', {}, 'Each one opens with its own words and frames, ready to remix.')),
      showcase),
  );
  root.hidden = false;
  syncForm();
  loadShowcase();

  function field(f) {
    const id = `mk-${f.key}`;
    let input;
    if (f.type === 'textarea') input = h('textarea', { id, rows: f.rows || 4, maxlength: f.max || 1200, spellcheck: 'true' });
    else if (f.type === 'select') { input = h('select', { id }); for (const [v, l] of f.options) input.append(h('option', { value: v }, l)); }
    else if (f.type === 'range') input = h('input', { id, type: 'range', min: f.min, max: f.max, step: f.step || 1 });
    else if (f.type === 'check') input = h('input', { id, type: 'checkbox' });
    else input = h('input', { id, type: 'text', maxlength: f.max || 120, autocomplete: 'off' });
    input.dataset.key = f.key;
    const out = f.type === 'range' ? h('output', { for: id }) : null;
    const onChange = () => {
      state[f.key] = f.type === 'check' ? input.checked : f.type === 'range' ? Number(input.value) : input.value;
      if (out) out.textContent = f.format ? f.format(state[f.key]) : state[f.key];
      updateBudget();
      liveSoon();
    };
    input.addEventListener('input', onChange);
    input.addEventListener('change', onChange);
    if (f.type === 'check') return h('label', { class: 'maker-check', for: id }, input, h('span', {}, f.label, f.hint ? h('small', {}, f.hint) : null));
    return h('label', { class: 'maker-field', for: id }, h('span', {}, f.label, out), input, f.hint ? h('small', {}, f.hint) : null);
  }
  function syncForm() {
    for (const f of mod.fields) {
      const input = form.querySelector(`[data-key="${f.key}"]`);
      if (!input) continue;
      if (f.type === 'check') input.checked = !!state[f.key];
      else input.value = state[f.key] ?? '';
      const out = input.parentElement.querySelector('output');
      if (out) out.textContent = f.format ? f.format(state[f.key]) : state[f.key];
    }
    updateBudget();
  }
  function updateBudget() {
    const n = mod.frames(state);
    budget.textContent = n
      ? `Make it paints ${n} new FLUX.1 schnell frame${n === 1 ? '' : 's'} (free, ${n === 1 ? 'it counts' : 'they count'} toward 12 a day). Editing words never spends frames.`
      : 'Everything here is drawn in your browser. No AI frames are used.';
  }

  // ---------- images ----------
  async function sample(url) {
    if (!sampleImages.has(url)) sampleImages.set(url, loadImage(url));
    return sampleImages.get(url);
  }
  function sampleFor(slot, index) {
    const keys = Object.keys(samples);
    const url = samples[slot] || (keys.length ? samples[keys[index % keys.length]] : null) || Object.values(mod.presets[0].samples)[0];
    return sample(url);
  }
  function makeIO(mode) {
    let index = 0;
    const io = {
      used: false,
      status: (t) => (status.textContent = t),
      async image(slot, prompt, w, hgt, seed) {
        const i = index++;
        const key = `${prompt}|${w}x${hgt}|${seed}`;
        let img = cache.get(key);
        if (!img && mode === 'generate') {
          status.textContent = `Painting frame ${i + 1} with FLUX.1 schnell…`;
          try {
            img = await flux({ prompt, w, h: hgt, seed });
            cache.set(key, img);
            io.used = true;
          } catch (e) {
            if (!warned) toast(e.cap ? "Today's free FLUX frames are used up, so this uses a sample frame. Your words and layout still apply." : `FLUX could not paint this frame (${e.message}). Using a sample frame instead.`, 'error');
            warned = true;
          }
        }
        if (!img) img = (mode !== 'sample' && lastBySlot.get(slot)) || (await sampleFor(slot, i));
        if (cache.get(key) === img) io.used = true;
        lastBySlot.set(slot, img);
        return img;
      },
    };
    return io;
  }

  // ---------- render ----------
  let liveTimer = 0;
  function liveSoon() { clearTimeout(liveTimer); liveTimer = setTimeout(() => render('live'), 260); }
  async function render(mode) {
    const mine = ++token;
    makeBtn.disabled = surpriseBtn.disabled = true;
    root.classList.add('is-busy');
    try {
      status.textContent = mode === 'generate' ? 'Starting…' : 'Laying out…';
      await loadFonts();
      const io = makeIO(mode);
      const out = await mod.build(structuredClone(state), io);
      if (mine !== token) return;
      result = out;
      if (out.patch) Object.assign(state, out.patch);
      out.usedFlux = io.used;
      show(out);
      warned = false;
      status.textContent = out.note || (mode === 'generate' ? 'Done. Edit any words and it updates instantly; press Make it again for new frames.' : 'Ready. Edit any words to update, or press Make it to paint new frames.');
    } catch (e) {
      if (mine === token) { status.textContent = `Something went wrong: ${e.message}`; console.warn(e); }
    } finally {
      if (mine === token) { makeBtn.disabled = surpriseBtn.disabled = false; root.classList.remove('is-busy'); }
    }
  }
  function surprise() {
    const r = rng(Date.now() ^ hashStr(String(Math.random())));
    state = { ...state, ...mod.surprise(r, state) };
    syncForm();
    render('generate');
  }

  function show(out) {
    stopFilm();
    player.hidden = !out.film;
    if (out.film) mountPlayer(out.film);
    boards.className = `maker-boards layout-${out.layout || 'grid'}`;
    boards.replaceChildren(...out.boards.filter((b) => !b.hidden).map(boardFigure));
  }
  function boardFigure(b) {
    b.canvas.classList.add('maker-canvas');
    b.canvas.setAttribute('role', 'img');
    b.canvas.setAttribute('aria-label', b.label);
    const fig = h('figure', { class: `maker-board size-${b.size || 'tile'}` }, b.canvas,
      h('figcaption', {},
        h('span', {}, b.label, h('small', {}, `${b.canvas.width} × ${b.canvas.height}`)),
        h('span', { class: 'maker-board-acts' },
          h('button', { type: 'button', class: 'btn-ghost small', onclick: async () => downloadBlob(await toBlob(b.canvas), fileName(b, 'png')) }, 'PNG'),
          b.print ? h('button', { type: 'button', class: 'btn-ghost small', onclick: async () => downloadBlob(await pdfOf([b]), fileName(b, 'pdf')) }, 'PDF') : null)));
    if (b.drag) bindDrag(b);
    return fig;
  }
  const fileName = (b, ext) => `${slug(result?.name)}-${slug(b.id)}.${ext}`;
  async function pdfOf(list) {
    const pages = [];
    for (const b of list) pages.push({ bytes: new Uint8Array(await (await toBlob(b.canvas, 'image/jpeg', 0.94)).arrayBuffer()), width: b.canvas.width, height: b.canvas.height });
    return new Blob([pdfFromJpegs(pages, 300)], { type: 'application/pdf' });
  }

  function bindDrag(b) {
    const c = b.canvas;
    let idx = -1, raf = 0;
    const pos = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    c.classList.add('is-draggable');
    c.addEventListener('pointerdown', (e) => {
      idx = b.drag.hit(state, ...pos(e));
      if (idx < 0) return;
      c.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      if (idx < 0) { c.style.cursor = b.drag.hit(state, ...pos(e)) >= 0 ? 'grab' : ''; return; }
      b.drag.move(state, idx, ...pos(e));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => b.drag.redraw(state, c));
    });
    const end = () => { if (idx >= 0) { idx = -1; syncForm(); } };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  // ---------- film player ----------
  let playing = false, t0 = 0, raf = 0, audio = null, audioURL = '';
  function stopFilm() {
    playing = false;
    cancelAnimationFrame(raf);
    audio?.pause();
  }
  function mountPlayer(film) {
    const prev = h('canvas', { class: 'maker-film', width: film.preview[0], height: film.preview[1], 'aria-label': 'Film preview' });
    const ctx = prev.getContext('2d');
    const scrub = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Position' });
    const tc = h('output', {}, '0.0 s');
    const play = h('button', { type: 'button', class: 'btn-ghost small' }, 'Play');
    const exportBtn = h('button', { type: 'button', class: 'btn-accent' }, 'Export video');
    const out = h('div', { class: 'maker-film-out' });
    const k = film.preview[0] / film.w;
    const draw = (t) => { ctx.setTransform(k, 0, 0, k, 0, 0); film.draw(ctx, t); tc.textContent = `${t.toFixed(1)} / ${film.duration.toFixed(1)} s`; scrub.value = String(Math.round((t / film.duration) * 1000)); };
    draw(Math.min(film.duration, film.cover ?? 1.5));
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= film.duration) { stopFilm(); play.textContent = 'Play'; draw(film.duration - 0.01); return; }
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    play.onclick = async () => {
      if (playing) { stopFilm(); play.textContent = 'Play'; return; }
      playing = true;
      play.textContent = 'Pause';
      const from = (Number(scrub.value) / 1000) * film.duration;
      t0 = performance.now() - (from >= film.duration - 0.05 ? 0 : from) * 1000;
      if (film.audio) {
        try {
          const a = await film.audio();
          if (a && playing) {
            if (audio?.src !== a.url) { audio?.pause(); audio = new Audio(a.url); audio.volume = 0.8; }
            audio.currentTime = (performance.now() - t0) / 1000;
            audio.play().catch(() => {});
          }
        } catch { /* sound is optional */ }
      }
      loop();
    };
    scrub.oninput = () => { stopFilm(); play.textContent = 'Play'; draw((Number(scrub.value) / 1000) * film.duration); };
    exportBtn.onclick = async () => {
      stopFilm();
      play.textContent = 'Play';
      exportBtn.disabled = true;
      try {
        const blob = await film.export((f) => (exportBtn.textContent = `Exporting ${Math.round(f * 100)}%`));
        const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
        const name = `${slug(result.name)}-film-poem.${ext}`;
        if (audioURL) URL.revokeObjectURL(audioURL);
        audioURL = URL.createObjectURL(blob);
        let saved = true;
        await saveAsset(blob, { name, engine: 'design-kit', ...(result.usedFlux ? { model: 'flux-1-schnell' } : {}), prompt: result.prompt || '', settings: { workflow: id, ...state } }).catch(() => (saved = false));
        out.replaceChildren(h('video', { src: audioURL, controls: true, playsinline: true }),
          h('p', {}, saved ? 'Saved to My library. ' : 'Ready (could not save locally, download it now). ', h('a', { href: audioURL, download: name }, `Download ${ext.toUpperCase()} ↓`)));
        toast(`Film exported: ${film.w} × ${film.h}, ${film.duration.toFixed(1)} s.`);
      } catch (e) {
        toast(`Export failed: ${e.message}`, 'error');
      } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = 'Export video';
      }
    };
    player.replaceChildren(h('div', { class: 'maker-film-frame', style: `aspect-ratio:${film.w}/${film.h}` }, prev),
      h('div', { class: 'maker-transport' }, play, scrub, tc), h('div', { class: 'maker-buttons' }, exportBtn, h('small', {}, film.exportNote || '')), out);
  }

  // ---------- downloads and library ----------
  async function downloadAll() {
    if (!result) return;
    zipBtn.disabled = true;
    try {
      const files = [];
      for (const b of result.boards) files.push({ name: `${slug(b.id)}.png`, bytes: new Uint8Array(await (await toBlob(b.canvas)).arrayBuffer()) });
      const print = result.boards.filter((b) => b.print);
      if (print.length) files.push({ name: `${slug(result.name)}-print.pdf`, bytes: new Uint8Array(await (await pdfOf(print)).arrayBuffer()) });
      for (const f of result.files || []) files.push({ name: f.name, bytes: typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data });
      files.push({ name: 'recipe.json', bytes: new TextEncoder().encode(JSON.stringify({ workflow: id, version: 1, state, made: new Date().toISOString() }, null, 2)) });
      downloadBlob(new Blob([zipStore(files)], { type: 'application/zip' }), `${slug(result.name)}-${id}.zip`);
    } catch (e) {
      toast(`Could not build the ZIP: ${e.message}`, 'error');
    } finally {
      zipBtn.disabled = false;
    }
  }
  async function saveAll() {
    if (!result) return;
    saveBtn.disabled = true;
    try {
      const list = result.boards.filter((b) => b.save !== false);
      for (const b of list) {
        await saveAsset(await toBlob(b.canvas, 'image/png'), { name: `${result.name} · ${b.label}`, engine: 'design-kit', ...(result.usedFlux ? { model: 'flux-1-schnell' } : {}), prompt: result.prompt || '', settings: { workflow: id, board: b.id, ...state } });
      }
      toast(`Saved ${list.length} artboard${list.length === 1 ? '' : 's'} to My library.`);
    } catch (e) {
      toast(`Could not save in this browser: ${e.message}. Download the ZIP instead.`, 'error');
    } finally {
      saveBtn.disabled = false;
    }
  }

  // ---------- Made with Chucksi ----------
  async function loadShowcase() {
    let list = [];
    try { list = (await (await fetch('/data/showcase.json')).json()).filter((x) => x.workflow === id); } catch { /* the strip is optional */ }
    showcase.closest('.maker-showcase').hidden = !list.length;
    showcase.replaceChildren(...list.map((x) => h('button', { type: 'button', class: 'maker-example', onclick: () => {
      state = { ...structuredClone(mod.presets[0].state), ...structuredClone(x.state) };
      samples = { ...x.samples };
      syncForm();
      render('sample');
      root.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    } }, h('img', { src: x.image, alt: '', loading: 'lazy', width: x.width || 600, height: x.height || 750 }), h('span', {}, h('strong', {}, x.title), h('small', {}, x.note || '')))));
  }

  await render('sample');
  return true;
}
