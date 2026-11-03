// Edit with words in the browser: shrink the pictures, send them with the instruction, show before / after.
// Used by the Image page (mountWordEdit) and the Image workroom (requestEdit, sharpen, pickFromLibrary).
import { apiFetch } from './human.js';
import * as store from './store.js';
import { saveAsset, downloadBlob } from './assets.js';
import { INPUT_BYTES, MAX_IMAGES, MAX_INSTRUCTION, EDIT_SIZES, fitInside, editRefusal } from './edit-words.js';

export const IDEAS = ['Make it sunset', 'Remove the people', 'Put it on a marble table', 'Turn it into a watercolor', 'Make it snow'];
export const PRIVACY_NOTE = 'Your pictures and instruction are sent to our AI provider to make the edit.';

const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
const toBlob = (c, type = 'image/png', q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t prepare this picture. Try another one.'))), type, q));
const sourceSize = (s) => ({ w: s.naturalWidth || s.videoWidth || s.width, h: s.naturalHeight || s.videoHeight || s.height });

/** A picture as something drawable: Blobs become ImageBitmaps, canvases and bitmaps pass through. */
export async function drawable(source) {
  if (source instanceof Blob) {
    if (!/^image\//.test(source.type)) throw new Error('That file isn’t a picture. Use a JPEG, PNG or WebP.');
    try { return await createImageBitmap(source); } catch { throw new Error('Couldn’t open this picture. Try a JPEG, PNG or WebP.'); }
  }
  return source;
}

/** Shrink a picture to under 512 px on each side (keeping its shape) as a JPEG of at most 1 MB. */
export async function shrinkForEdit(source) {
  const img = await drawable(source);
  const { w, h } = sourceSize(img);
  if (!w || !h) throw new Error('Couldn’t open this picture. Try another one.');
  const fit = fitInside(w, h);
  const c = canvasOf(fit.w, fit.h);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; // JPEG has no transparency: cutouts sit on white
  g.fillRect(0, 0, fit.w, fit.h);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, fit.w, fit.h);
  for (const q of [0.92, 0.8, 0.65]) {
    const blob = await toBlob(c, 'image/jpeg', q);
    if (blob.size <= INPUT_BYTES) return { blob, w: fit.w, h: fit.h };
  }
  throw new Error('This picture is too detailed to send. Try another one.');
}

/**
 * Run one edit. images[0] is the picture to change, the rest are references. Resolves to
 * { blob, left } where left is the visitor's free edits left today (or null).
 */
export async function requestEdit({ prompt, images, size = 'match', signal }) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('Say what to change first, like “make it sunset”.');
  if (text.length > MAX_INSTRUCTION) throw new Error(`Keep the instruction under ${MAX_INSTRUCTION} characters.`);
  const refusal = editRefusal(text);
  if (refusal) throw Object.assign(new Error(refusal), { refused: true });
  if (!images?.length) throw new Error('Add a picture to edit first.');
  if (images.length > MAX_IMAGES) throw new Error('Use one picture plus up to three references.');
  const form = new FormData();
  form.append('prompt', text);
  form.append('size', Object.hasOwn(EDIT_SIZES, size) ? size : 'match');
  const shrunk = await Promise.all(images.map(shrinkForEdit));
  shrunk.forEach((s, i) => form.append(`input_image_${i}`, s.blob, `picture-${i}.jpg`));
  let res;
  try {
    res = await apiFetch('/api/edit', { method: 'POST', body: form, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error('Couldn’t reach the editor. Check your connection and try again.');
  }
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw Object.assign(new Error((j && j.error) || 'Couldn’t make this edit. Try again, or say it a different way.'), { status: res.status, cap: res.status === 429 });
  }
  const blob = await res.blob();
  if (!/^image\//.test(blob.type)) throw new Error('Couldn’t make this edit. Try again, or say it a different way.');
  const left = res.headers.get('x-massless-remaining-today');
  return { blob, left: left === null ? null : Number(left) };
}

/** Double the size of a result with the in-browser upscaler (the edit itself is at most 1024 px). */
export async function sharpen(source, onProgress) {
  const { runJob } = await import('./image-ai.js');
  const img = await drawable(source);
  const { w, h } = sourceSize(img);
  const c = canvasOf(w, h);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, w, h);
  const res = await runJob('upscale', { rgba: data, w, h, factor: 2 }, { transfer: [data.buffer], onProgress });
  const out = canvasOf(res.w, res.h);
  out.getContext('2d').putImageData(new ImageData(res.data, res.w, res.h), 0, 0);
  return out;
}

const node = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
  return n;
};

/** Pick a picture from My library (this browser). Resolves to { blob, id } or null. */
export async function pickFromLibrary() {
  let items = [];
  try { items = (await store.all()).filter((x) => x.blob?.type?.startsWith('image/')).sort((a, b) => b.created - a.created).slice(0, 60); }
  catch { /* storage off: shown as empty */ }
  return await new Promise((resolve) => {
    const urls = [];
    const close = (value) => { dlg.close(); dlg.remove(); urls.forEach(URL.revokeObjectURL); resolve(value); };
    const grid = node('div', { class: 'we-lib-grid' });
    for (const it of items) {
      const u = URL.createObjectURL(it.thumb || it.blob);
      urls.push(u);
      grid.append(node('button', { type: 'button', class: 'we-lib-item', 'aria-label': it.name || it.prompt?.slice(0, 80) || 'Saved picture', onclick: () => close({ blob: it.blob, id: it.id }) }, node('img', { src: u, alt: '' })));
    }
    const dlg = node('dialog', { class: 'sheet we-lib', 'aria-label': 'My library' },
      node('div', { class: 'sheet-head' }, node('h2', { text: 'My library' }), node('button', { type: 'button', class: 'x', 'aria-label': 'Close', onclick: () => close(null) }, '×')),
      items.length ? grid : node('p', { text: 'Nothing saved in this browser yet. Create or open a picture first.' }));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(null); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Files dropped or pasted: the image ones. */
export const imageFiles = (list) => [...(list || [])].filter((f) => f && /^image\//.test(f.type));

// ---------------------------------------------------------------------------------------------
// The full Edit with words panel (Image page)
// ---------------------------------------------------------------------------------------------

/**
 * Build the panel inside root. Returns { load(blob, id) } so other parts of the page can send a picture in.
 * onSaved(item) runs after Save to library.
 */
export function mountWordEdit(root, { onSaved } = {}) {
  const S = { cur: null, sourceId: null, result: null, refs: [], history: [], busy: false, ctl: null, lastPrompt: '' };
  const urls = new WeakMap();
  const urlOf = (blob) => { if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob)); return urls.get(blob); };

  const fileIn = node('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, id: 'we-file' });
  const refIn = node('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true, multiple: true, id: 'we-ref-file' });
  const prompt = node('textarea', { id: 'we-prompt', rows: '3', maxlength: String(MAX_INSTRUCTION), placeholder: 'Make it sunset' });
  const sizeSel = node('select', { id: 'we-size' }, ...Object.entries(EDIT_SIZES).map(([k, v]) => node('option', { value: k, text: v.label })));
  const go = node('button', { type: 'submit', class: 'btn-accent we-go', id: 'we-go' }, 'Edit');
  const status = node('p', { class: 'we-status', role: 'status', id: 'we-status' });
  const refsRow = node('div', { class: 'we-refs', id: 'we-refs' });
  const source = node('div', { class: 'we-source', id: 'we-source' });

  const before = node('img', { alt: 'Before', class: 'we-before' });
  const after = node('img', { alt: 'After', class: 'we-after' });
  const slider = node('input', { type: 'range', min: '0', max: '100', value: '50', class: 'we-slider', 'aria-label': 'Before and after' });
  const viewer = node('div', { class: 'we-viewer', id: 'we-viewer' }, after, before, node('div', { class: 'we-handle', 'aria-hidden': 'true' }), slider,
    node('span', { class: 'we-tag we-tag-l', text: 'Before' }), node('span', { class: 'we-tag we-tag-r', text: 'After' }));
  const empty = node('div', { class: 'we-empty', id: 'we-empty' },
    node('strong', { text: 'Drop a picture here' }),
    node('span', { text: 'Then say what to change. Your words do the editing.' }),
    node('div', { class: 'we-empty-acts' },
      node('button', { type: 'button', class: 'btn-accent', onclick: () => fileIn.click() }, 'Choose a picture'),
      node('button', { type: 'button', class: 'btn-ghost', onclick: () => fromLibrary() }, 'From my library')));
  const working = node('div', { class: 'we-working', hidden: true }, node('span', { class: 'we-spin', 'aria-hidden': 'true' }), node('span', { text: 'Editing…' }));
  const btn = (id, label, fn, cls = 'btn-ghost') => node('button', { type: 'button', class: cls, id, onclick: fn, disabled: true }, label);
  const keep = btn('we-keep', 'Keep editing', () => keepEditing());
  const undo = btn('we-undo', 'Undo', () => undoStep());
  const sharp = btn('we-sharpen', 'Sharpen result', () => sharpenResult());
  const dl = btn('we-download', 'Download', () => S.result && downloadBlob(S.result, 'chucksi-edit.' + (S.result.type.includes('png') ? 'png' : 'jpg')));
  const save = btn('we-save', 'Save to library', () => saveResult(), 'btn-accent');

  const ideas = node('div', { class: 'we-ideas', role: 'group', 'aria-label': 'Ideas' }, ...IDEAS.map((t) => node('button', { type: 'button', class: 'we-idea', onclick: () => { prompt.value = t; prompt.focus(); } }, t)));
  const form = node('form', { class: 'we-side', autocomplete: 'off', onsubmit: (e) => { e.preventDefault(); run(); } },
    node('div', { class: 'we-field' }, node('span', { class: 'we-label', text: 'Picture' }), source),
    node('label', { class: 'we-field', for: 'we-prompt' }, node('span', { class: 'we-label', text: 'What should change?' })), prompt, ideas,
    node('div', { class: 'we-field' }, node('span', { class: 'we-label', text: 'Use another picture too (optional)' }),
      node('span', { class: 'we-sub', text: 'Add up to three, like “use the style of this” or “put this logo on the mug”.' }), refsRow),
    node('label', { class: 'we-field', for: 'we-size' }, node('span', { class: 'we-label', text: 'Shape' })), sizeSel,
    go, node('p', { class: 'we-note', text: PRIVACY_NOTE }, ' ', node('a', { href: '/privacy.html', text: 'Privacy' })),
    fileIn, refIn);
  const stage = node('div', { class: 'we-stage' }, node('div', { class: 'we-canvas' }, empty, viewer, working),
    node('div', { class: 'we-acts' }, keep, undo, sharp, dl, save), status);
  root.replaceChildren(node('div', { class: 'we-grid' }, form, stage));

  const say = (t, kind = '') => { status.textContent = t; status.dataset.kind = kind; };
  const snapshot = () => S.history.push({ cur: S.cur, result: S.result, sourceId: S.sourceId });

  function render() {
    // the source thumbnail
    source.replaceChildren();
    if (S.cur) {
      source.append(node('img', { src: urlOf(S.cur), alt: 'Picture to edit' }),
        node('div', { class: 'we-source-acts' },
          node('button', { type: 'button', class: 'btn-ghost', onclick: () => fileIn.click() }, 'Replace'),
          node('button', { type: 'button', class: 'btn-ghost', onclick: () => fromLibrary() }, 'From my library')));
    } else {
      source.append(node('div', { class: 'we-source-acts' },
        node('button', { type: 'button', class: 'btn-ghost', onclick: () => fileIn.click() }, 'Choose a picture'),
        node('button', { type: 'button', class: 'btn-ghost', onclick: () => fromLibrary() }, 'From my library')));
    }
    refsRow.replaceChildren(...S.refs.map((r, i) => node('div', { class: 'we-ref' }, node('img', { src: urlOf(r), alt: `Reference ${i + 1}` }),
      node('button', { type: 'button', class: 'we-ref-x', 'aria-label': `Remove reference ${i + 1}`, onclick: () => { S.refs.splice(i, 1); render(); } }, '×'))));
    if (S.refs.length < MAX_IMAGES - 1) refsRow.append(node('button', { type: 'button', class: 'we-ref-add', 'aria-label': 'Add a reference picture', onclick: () => refIn.click() }, '+'));
    // the stage
    empty.hidden = !!S.cur;
    viewer.hidden = !S.cur;
    if (S.cur) {
      before.src = urlOf(S.cur);
      after.src = urlOf(S.result || S.cur);
      viewer.classList.toggle('compare', !!S.result);
    }
    working.hidden = !S.busy;
    go.disabled = S.busy || !S.cur;
    go.textContent = S.busy ? 'Editing…' : 'Edit';
    keep.disabled = S.busy || !S.result;
    undo.disabled = S.busy || !S.history.length;
    sharp.disabled = S.busy || !S.result;
    dl.disabled = S.busy || !S.result;
    save.disabled = S.busy || !S.result;
    setSplit();
  }
  function setSplit() {
    const v = Number(slider.value);
    viewer.style.setProperty('--split', `${v}%`);
  }
  slider.addEventListener('input', setSplit);

  async function load(blob, id = null) {
    if (S.busy) return;
    try {
      const img = await drawable(blob);
      img.close?.();
    } catch (e) { say(e.message, 'error'); return; }
    if (S.cur) snapshot();
    S.cur = blob;
    S.sourceId = id;
    S.result = null;
    slider.value = '50';
    render();
    say('Ready. Say what to change, then press Edit.');
  }
  async function fromLibrary() {
    const pick = await pickFromLibrary();
    if (pick) await load(pick.blob, pick.id);
  }
  function addRefs(files) {
    for (const f of imageFiles(files)) if (S.refs.length < MAX_IMAGES - 1) S.refs.push(f);
    render();
  }

  async function run() {
    if (S.busy) return;
    if (!S.cur) { say('Add a picture to edit first.', 'error'); return; }
    const text = prompt.value.trim();
    const refusal = text && editRefusal(text);
    if (refusal) { say(refusal, 'error'); return; }
    if (!text) { say('Say what to change first, like “make it sunset”.', 'error'); prompt.focus(); return; }
    S.busy = true;
    render();
    say('Editing… this takes a few seconds.');
    S.ctl = new AbortController();
    try {
      const { blob, left } = await requestEdit({ prompt: text, images: [S.cur, ...S.refs], size: sizeSel.value, signal: S.ctl.signal });
      snapshot();
      S.result = blob;
      S.lastPrompt = text;
      slider.value = '50';
      say(`Done. Drag the slider to compare.${Number.isFinite(left) ? ` ${left} free edit${left === 1 ? '' : 's'} left today.` : ''}`);
    } catch (e) {
      say(e.message, 'error');
    } finally {
      S.busy = false;
      render();
    }
  }
  function keepEditing() {
    if (!S.result) return;
    snapshot();
    S.cur = S.result;
    S.result = null;
    prompt.value = '';
    render();
    prompt.focus();
    say('Now editing the result. Say what to change next.');
  }
  function undoStep() {
    const prev = S.history.pop();
    if (!prev) return;
    Object.assign(S, prev);
    render();
    say('Undone.');
  }
  async function sharpenResult() {
    if (!S.result || S.busy) return;
    S.busy = true;
    render();
    say('Sharpening… the first time takes a moment to get ready.');
    try {
      const c = await sharpen(S.result, (f, label) => label && say(label));
      snapshot();
      S.result = await toBlob(c, 'image/png');
      say(`Sharpened to ${c.width} × ${c.height}.`);
    } catch (e) {
      say(e.message || 'Couldn’t sharpen this result. Try again.', 'error');
    } finally {
      S.busy = false;
      render();
    }
  }
  async function saveResult() {
    if (!S.result) return;
    try {
      const item = await saveAsset(S.result, { name: S.lastPrompt ? `Edited: ${S.lastPrompt.slice(0, 60)}` : 'Edited with words', engine: 'word-edit', prompt: S.lastPrompt, sourceId: S.sourceId, settings: { tool: 'words', size: sizeSel.value, references: S.refs.length } });
      say('Saved to your library.');
      onSaved?.(item);
    } catch (e) {
      say(e.message || 'Couldn’t save. Download it instead.', 'error');
    }
  }

  fileIn.addEventListener('change', () => { const f = imageFiles(fileIn.files)[0]; fileIn.value = ''; if (f) load(f); });
  refIn.addEventListener('change', () => { addRefs(refIn.files); refIn.value = ''; });
  prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); } });
  for (const zone of [stage, source]) {
    zone.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); stage.classList.add('drop'); } });
    zone.addEventListener('dragleave', () => stage.classList.remove('drop'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); stage.classList.remove('drop'); const f = imageFiles(e.dataTransfer?.files); if (f[0]) load(f[0]); if (f.length > 1) addRefs(f.slice(1)); });
  }
  refsRow.addEventListener('dragover', (e) => e.preventDefault());
  refsRow.addEventListener('drop', (e) => { e.preventDefault(); addRefs(e.dataTransfer?.files); });
  root.addEventListener('paste', (e) => { const f = imageFiles([...(e.clipboardData?.items || [])].map((i) => i.getAsFile())); if (f[0]) { e.preventDefault(); load(f[0]); } });
  render();
  return { load, state: S, run };
}
