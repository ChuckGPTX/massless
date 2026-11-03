// "Share to Explore" for any tool: shareToExplore({ blob, poster, title, tool, remixUrl }) opens a small sheet,
// fits the media to Explore's limits (images re-encoded to at most 3 MB, a poster made when none is given), and posts
// it to /api/explore (signed in, with the human check). Signed out, the post waits in this browser (IndexedDB) while
// the visitor signs in; they come back to /explore and the same sheet opens again, ready to post.
//
//   import { shareToExplore, shareButton } from '/js/explore-share.js';
//   shareToExplore({ blob, poster, title: 'Glass koi', tool: 'video', remixUrl: '/video?move=arc-right' });
//   el.append(shareButton(async () => ({ blob, title, tool: 'image', remixUrl: '/image?prompt=…' })));
//
// blob and poster may be Blobs or canvases. Optional: width, height, tags (array or "a, b"), link (a v2web.site address).

import { apiFetch } from './human.js';
import { session, accessToken } from './cloud.js';
import { checkRemix, checkLink, toolLabel } from './explore-tools.js';

const MAX_IMAGE = 3 * 1024 * 1024;
const MAX_VIDEO = 8 * 1024 * 1024;
const MAX_POSTER = 600 * 1024;
const AFTER = 'chucksi.after-signin';

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
};

// ---------- media ----------
const canvasBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));
async function asBlob(x) {
  if (!x) return null;
  if (x instanceof Blob) return x;
  if (typeof HTMLCanvasElement !== 'undefined' && x instanceof HTMLCanvasElement) return canvasBlob(x, 'image/png');
  if (typeof OffscreenCanvas !== 'undefined' && x instanceof OffscreenCanvas) return x.convertToBlob({ type: 'image/png' });
  throw new Error('Share an image or a video.');
}
async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}
/** Draw an image at most `long` px on its long side and encode it, WebP when the browser can, else JPEG. */
async function encodeImage(src, long, q) {
  const w = src.width || src.naturalWidth, hh = src.height || src.naturalHeight;
  const s = Math.min(1, long / Math.max(w, hh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(hh * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  let out = await canvasBlob(c, 'image/webp', q);
  if (!out || out.type !== 'image/webp') out = await canvasBlob(c, 'image/jpeg', q);
  return out;
}
async function fitImage(blob, max, long) {
  const src = await decode(blob);
  const w = src.width || src.naturalWidth, hh = src.height || src.naturalHeight;
  if (['image/webp', 'image/jpeg', 'image/png'].includes(blob.type) && blob.size <= max && Math.max(w, hh) <= long) return { blob, width: w, height: hh };
  for (const [l, q] of [[long, 0.9], [long, 0.8], [Math.round(long * 0.75), 0.8], [Math.round(long * 0.5), 0.75]]) {
    const out = await encodeImage(src, l, q);
    if (out && out.size <= max) return { blob: out, width: w, height: hh };
  }
  throw new Error('This image is too big to share. Try a smaller one.');
}
/** The first frame of a video, as a poster. */
async function videoFrame(blob) {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  const url = URL.createObjectURL(blob);
  try {
    v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('This video could not be read.')); setTimeout(() => rej(new Error('This video took too long to read.')), 15000); });
    if (v.duration > 0.2) await new Promise((res) => { v.onseeked = res; v.currentTime = Math.min(0.5, v.duration / 3); setTimeout(res, 3000); });
    const c = document.createElement('canvas');
    c.width = v.videoWidth || 640;
    c.height = v.videoHeight || 360;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return { canvas: c, width: c.width, height: c.height };
  } finally { URL.revokeObjectURL(url); }
}

/** Fit a share to Explore's limits: { media, poster, kind, width, height } or throws a readable error. */
export async function prepareMedia({ blob, poster, width, height }) {
  const media = await asBlob(blob);
  if (!media || !media.size) throw new Error('There is nothing to share yet.');
  let posterBlob = await asBlob(poster);
  if (media.type.startsWith('video/')) {
    if (!['video/mp4', 'video/webm'].includes(media.type.split(';')[0])) throw new Error('Explore takes MP4 or WebM videos.');
    if (media.size > MAX_VIDEO) throw new Error(`This clip is ${(media.size / 1048576).toFixed(1)} MB. Explore takes videos up to 8 MB: render a shorter or smaller one.`);
    let w = width, hh = height;
    if (!posterBlob) { const f = await videoFrame(media); posterBlob = await encodeImage(f.canvas, 720, 0.8); w ||= f.width; hh ||= f.height; }
    const p = await fitImage(posterBlob, MAX_POSTER, 720);
    return { media, poster: p.blob, kind: 'video', width: w || p.width, height: hh || p.height };
  }
  if (!media.type.startsWith('image/')) throw new Error('Share an image or a video.');
  const img = await fitImage(media, MAX_IMAGE, 2048);
  const p = await fitImage(posterBlob || img.blob, MAX_POSTER, 720);
  return { media: img.blob, poster: p.blob, kind: 'image', width: width || img.width, height: height || img.height };
}

// ---------- waiting while the visitor signs in ----------
const DB = 'chucksi-explore';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('pending');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function pendingOp(mode, fn) {
  const d = await idb();
  try {
    return await new Promise((res, rej) => {
      const tx = d.transaction('pending', mode);
      const req = fn(tx.objectStore('pending'));
      tx.oncomplete = () => res(req?.result);
      tx.onerror = () => rej(tx.error);
    });
  } finally { d.close(); }
}
const savePending = (v) => pendingOp('readwrite', (s) => s.put(v, 'share'));
const readPending = () => pendingOp('readonly', (s) => s.get('share'));
const clearPending = () => pendingOp('readwrite', (s) => s.delete('share'));

// ---------- the sheet ----------
let dialog = null;
function ensureStyles() {
  if (document.querySelector('link[data-explore-share]')) return;
  document.head.append(h('link', { rel: 'stylesheet', href: '/css/explore-share.css', 'data-explore-share': '' }));
}

async function postIt(prepared, fields) {
  const meta = { title: fields.title, tool: fields.tool, remix: fields.remix, tags: fields.tags, link: fields.link || '', width: prepared.width, height: prepared.height };
  const token = await accessToken();
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  const ext = (b) => ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4', 'video/webm': 'webm' })[b.type.split(';')[0]] || 'bin';
  form.append('media', prepared.media, `media.${ext(prepared.media)}`);
  form.append('poster', prepared.poster, `poster.${ext(prepared.poster)}`);
  const res = await apiFetch('/api/explore', { method: 'POST', body: form, headers: { authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Explore answered ${res.status}.`); e.status = res.status; e.data = data; throw e; }
  return data.post;
}

/**
 * Open the Share to Explore sheet. Resolves with the new post, or null when the visitor closes it.
 * opts: { blob, poster?, title, tool, remixUrl, width?, height?, tags?, link? }
 */
export async function shareToExplore(opts) {
  ensureStyles();
  const remix = checkRemix(opts.tool, opts.remixUrl);
  if (remix.error) throw new Error(remix.error);
  const link = checkLink(opts.link);
  dialog?.remove();
  const dlg = (dialog = h('dialog', { class: 'xs-dialog', 'aria-labelledby': 'xs-title' }));
  const close = h('button', { type: 'button', class: 'xs-x', 'aria-label': 'Close', text: '×', onclick: () => dlg.close() });
  const preview = h('div', { class: 'xs-preview' }, h('p', { class: 'xs-wait', text: 'Getting it ready…' }));
  const title = h('input', { id: 'xs-name', type: 'text', maxlength: 80, required: true, autocomplete: 'off', value: String(opts.title || '').slice(0, 80) });
  const tags = h('input', { id: 'xs-tags', type: 'text', maxlength: 140, autocomplete: 'off', placeholder: 'e.g. neon, portrait', value: Array.isArray(opts.tags) ? opts.tags.join(', ') : opts.tags || '' });
  const msg = h('p', { class: 'xs-msg', role: 'status', 'aria-live': 'polite' });
  const go = h('button', { type: 'submit', class: 'btn-accent xs-go', disabled: true, text: 'Post to Explore' });
  const signed = !!session();
  const form = h('form', { class: 'xs-form', method: 'dialog' },
    h('label', { for: 'xs-name', text: 'Title' }), title,
    h('label', { for: 'xs-tags' }, 'Tags ', h('small', { text: '(optional, up to 5)' })), tags,
    h('p', { class: 'xs-note' }, 'Posts are public: anyone can see it and open ', h('b', { text: toolLabel(opts.tool) }), ' with the same settings. Your display name is shown, never your email. Delete it any time from Explore. ', h('a', { href: '/terms.html#explore', target: '_blank', text: 'Rules' })),
    msg,
    h('div', { class: 'xs-acts' }, h('button', { type: 'button', class: 'btn-ghost', text: 'Cancel', onclick: () => dlg.close() }), go));
  const body = h('div', { class: 'xs-body' }, preview, form);
  dlg.append(h('div', { class: 'xs-head' }, h('h2', { id: 'xs-title', text: 'Share to Explore' }), close), body);
  document.body.append(dlg);
  dlg.showModal();

  let prepared = null;
  try {
    prepared = await prepareMedia(opts);
    const url = URL.createObjectURL(prepared.kind === 'video' ? prepared.media : prepared.poster);
    preview.replaceChildren(prepared.kind === 'video'
      ? h('video', { src: url, muted: true, loop: true, autoplay: !matchMedia('(prefers-reduced-motion: reduce)').matches, playsinline: true, poster: URL.createObjectURL(prepared.poster) })
      : h('img', { src: url, alt: '' }));
    preview.querySelector('video')?.setAttribute('muted', '');
    go.disabled = false;
  } catch (e) {
    preview.replaceChildren(h('p', { class: 'xs-wait', text: 'Nothing to preview.' }));
    msg.textContent = e.message;
    msg.dataset.kind = 'error';
  }
  if (!signed && prepared) {
    go.textContent = 'Sign in to post';
    msg.textContent = 'Sign in first. It’s free, and we bring you back with this ready to post.';
  }

  return new Promise((resolve) => {
    let done = null;
    dlg.addEventListener('close', () => { dlg.remove(); if (dialog === dlg) dialog = null; resolve(done); }, { once: true });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!prepared) return;
      const name = title.value.trim();
      if (!name) { msg.textContent = 'Give it a title.'; title.focus(); return; }
      const fields = { title: name, tool: opts.tool, remix: remix.url, tags: tags.value, link: link.url || '' };
      if (!session()) {
        try {
          await savePending({ ...fields, media: prepared.media, poster: prepared.poster, kind: prepared.kind, width: prepared.width, height: prepared.height, at: Date.now() });
          sessionStorage.setItem(AFTER, '/explore/');
        } catch { /* private mode: sign in anyway */ }
        location.href = '/projects/#account';
        return;
      }
      go.disabled = true;
      go.textContent = 'Posting…';
      msg.dataset.kind = '';
      msg.textContent = '';
      try {
        const post = await postIt(prepared, fields);
        done = post;
        await clearPending().catch(() => {});
        const at = `/explore?p=${post.id}`;
        body.replaceChildren(h('div', { class: 'xs-done' },
          h('h3', { text: 'Posted' }),
          h('p', { text: post.status === 'held' ? 'It is live at its link now, and joins the public feed once your account is a day old.' : 'It is in the Explore feed now. Anyone can open it and remix.' }),
          h('div', { class: 'xs-acts' },
            h('button', { type: 'button', class: 'btn-ghost', text: 'Copy link', onclick: async (ev) => { try { await navigator.clipboard.writeText(location.origin + at); ev.target.textContent = 'Copied'; } catch { ev.target.textContent = location.origin + at; } } }),
            h('a', { class: 'btn-accent', href: at, text: 'View on Explore ↗' }))));
        window.dispatchEvent(new CustomEvent('explore-posted', { detail: post }));
      } catch (err) {
        go.disabled = false;
        go.textContent = 'Post to Explore';
        msg.dataset.kind = 'error';
        msg.textContent = err.status === 401 ? 'Please sign in again, then post.' : err.message;
      }
    });
  });
}

function note(text) {
  ensureStyles();
  const t = h('div', { class: 'xs-toast', role: 'alert', text });
  document.body.append(t);
  setTimeout(() => t.remove(), 6000);
}

/** A ready-made "Share to Explore" button. getOpts() is called on click and returns shareToExplore's options. */
export function shareButton(getOpts, { label = 'Share to Explore', className = 'btn-ghost' } = {}) {
  const b = h('button', { type: 'button', class: `${className} xs-share-btn`, 'data-explore-share': '' }, label);
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const opts = await getOpts();
      if (opts) await shareToExplore(opts);
    } catch (e) {
      note(e.message || 'Could not share this.');
    } finally { b.disabled = false; }
  });
  return b;
}

/** On /explore after signing in: reopen the share that was waiting. Returns true when one was waiting. */
export async function resumePendingShare() {
  let p = null;
  try { p = await readPending(); } catch { return false; }
  if (!p || !p.media) return false;
  if (Date.now() - (p.at || 0) > 86400000 || !session()) { if (session()) await clearPending().catch(() => {}); return false; }
  shareToExplore({ blob: p.media, poster: p.poster, title: p.title, tool: p.tool, remixUrl: p.remix, width: p.width, height: p.height, tags: p.tags, link: p.link })
    .catch(() => {})
    .finally(() => clearPending().catch(() => {}));
  return true;
}
