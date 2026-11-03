// "My library" inside a preset: a sheet of the visitor's saved pictures that this preset can use. Picking one feeds
// it in exactly like an upload. libraryChoices() is pure, so tests/library-pick.test.js runs it in Node.
import { mediaKind } from '../assets.js';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'];
const MAX_BYTES = 25e6;

/** The media kinds an input takes: pictures for image inputs, pictures and clips for media inputs. */
export const acceptKinds = (input) => (input?.type === 'media' ? ['image', 'video'] : input?.type === 'image' ? ['image'] : []);

/** Saved items an input can use, newest first (at most 60). */
export function libraryChoices(items, input) {
  const kinds = acceptKinds(input);
  return (items || [])
    .filter((it) => {
      const b = it?.blob, k = mediaKind(b);
      if (!b || !b.size || b.size > MAX_BYTES || !kinds.includes(k)) return false;
      return k !== 'image' || IMAGE_TYPES.includes(b.type);
    })
    .sort((a, b) => (b.created || 0) - (a.created || 0))
    .slice(0, 60);
}

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v != null) n.setAttribute(k, v); }
  n.append(...kids.filter((k) => k != null));
  return n;
};

/** Open the sheet; resolves with the chosen saved item, or null. */
export async function pickFromLibrary(input) {
  let items = [];
  try { const { all } = await import('../store.js'); items = libraryChoices(await all(), input); } catch { /* storage off: shown as empty */ }
  const what = acceptKinds(input).includes('video') ? 'pictures or clips' : 'pictures';
  return new Promise((resolve) => {
    const urls = [];
    const close = (value) => { dlg.close(); dlg.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); resolve(value); };
    const grid = el('div', { class: 'pz-lib-grid', role: 'list' });
    for (const it of items) {
      const u = URL.createObjectURL(it.thumb || it.blob);
      urls.push(u);
      const label = it.name || it.title || it.prompt?.slice(0, 80) || 'Saved picture';
      const media = mediaKind(it.blob) === 'video' ? el('video', { src: u, muted: '', playsinline: '', preload: 'metadata' }) : el('img', { src: u, alt: '', loading: 'lazy' });
      grid.append(el('button', { type: 'button', class: 'pz-lib-item', role: 'listitem', title: label, 'aria-label': label, 'data-id': it.id, onclick: () => close(it) }, media, el('small', {}, label)));
    }
    const empty = el('div', { class: 'pz-lib-empty' },
      el('p', {}, `No saved ${what} yet.`),
      el('p', {}, 'Save something to My library from any tool, or add your own on the My library page, and it shows up here.'),
      el('a', { class: 'btn-ghost', href: '/library/' }, 'Open My library ↗'));
    const dlg = el('dialog', { class: 'sheet pz-lib', 'aria-label': 'My library' },
      el('div', { class: 'sheet-head' }, el('h2', {}, 'My library'), el('button', { type: 'button', class: 'x', 'aria-label': 'Close', onclick: () => close(null) }, '×')),
      el('p', { class: 'pz-lib-note' }, items.length ? `Pick one of your saved ${what}. It stays on this device.` : ''),
      items.length ? grid : empty);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(null); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** A saved item by id (for ?asset=<id>), or null. */
export async function savedItem(id) {
  if (!id) return null;
  try { const { get } = await import('../store.js'); return await get(id); } catch { return null; }
}
