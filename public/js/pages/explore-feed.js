// /explore: the public feed of things people made and shared from Chucksi tools (src/explore.js serves the API).
// A moving masonry of looping videos and images with the Workflows gallery's motion rules (lazy posters and loops,
// at most 6 playing, posters only with reduced motion or Save-Data), tool chips, New/Top, and a detail sheet with
// the creator, likes, Remix (the tool, opened with the same settings) and Report.

import { createLoopPlayer } from '../workflow-gallery.js';
import { EXPLORE_TOOLS, POST_ID, remixHref } from '../explore-tools.js';
import { session, accessToken } from '../cloud.js';
import { apiFetch } from '../human.js';

const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
};
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const grid = $('#ex-grid');
const statusEl = $('#ex-status');
const moreBtn = $('#ex-more');
const player = createLoopPlayer();
const params = new URLSearchParams(location.search);
const state = {
  tool: EXPLORE_TOOLS.some((t) => t.id === params.get('tool')) ? params.get('tool') : '',
  sort: params.get('sort') === 'top' ? 'top' : 'new',
  cursor: null,
  loading: false,
  done: false,
  gen: 0,
  posts: new Map(),
};

async function authHeaders() {
  if (!session()) return {};
  try { return { authorization: `Bearer ${await accessToken()}` }; } catch { return {}; }
}
async function api(path, init = {}, { auth = false, human = false } = {}) {
  const headers = { ...(init.headers || {}), ...(auth ? await authHeaders() : {}) };
  const res = await (human ? apiFetch : fetch)(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Explore answered ${res.status}.`); e.status = res.status; throw e; }
  return data;
}

// ---------- masonry: each card spans as many 2px rows as its aspect ratio needs ----------
function layout() {
  const cs = getComputedStyle(grid);
  const cols = cs.gridTemplateColumns.split(' ').length;
  const gap = parseFloat(cs.columnGap) || 0;
  const colW = (grid.clientWidth - gap * (cols - 1)) / cols;
  for (const c of grid.children) {
    const [w, hh] = c.style.getPropertyValue('--ar').split('/').map(Number);
    c.style.gridRowEnd = `span ${Math.ceil(((colW * hh) / w + gap) / 2)}`;
  }
}
new ResizeObserver(layout).observe(grid);

const enter = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); enter.unobserve(e.target); }
}, { rootMargin: '0px 0px -40px 0px' });
if (!reduce.matches) grid.classList.add('wf-enter');

function card(p, i = 0) {
  const a = h('a', { class: 'wf-card ex-card', href: `/explore?p=${p.id}`, role: 'listitem', 'data-id': p.id, 'data-tool': p.tool, 'aria-label': `${p.title} by ${p.author}. ${p.toolLabel}. ${p.likes} likes` });
  a.style.setProperty('--ar', `${p.width}/${p.height}`);
  a.style.setProperty('--d', `${(i % 8) * 50}ms`);
  let visual;
  if (p.kind === 'video') {
    visual = h('video', { muted: true, loop: true, playsinline: true, preload: 'none', 'aria-hidden': 'true', disablepictureinpicture: true });
    visual.muted = true;
    visual.dataset.src = p.media;
    visual.dataset.poster = p.poster;
  } else visual = h('img', { src: p.poster, alt: '', loading: 'lazy', decoding: 'async', width: p.width, height: p.height });
  const meta = h('span', { class: 'ex-meta' }, h('span', { class: 'ex-author', text: p.author }), h('span', { class: 'ex-likes', 'aria-hidden': 'true', text: `♥ ${p.likes}` }));
  const inner = h('span', { class: 'wf-inner' }, visual, h('span', { class: 'ex-tool', text: p.toolLabel }), h('span', { class: 'ex-name' }, h('span', { class: 'ex-title', text: p.title }), meta));
  a.append(inner);
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    openSheet(p.id, { push: true });
  });
  if (p.kind === 'video') player.add(visual);
  return a;
}

function setStatus(text) { statusEl.textContent = text || ''; statusEl.hidden = !text; }

async function load(reset = false) {
  if (reset) {
    state.gen++;
    state.cursor = null;
    state.done = false;
    state.loading = false;
    grid.replaceChildren();
  }
  if (state.loading || state.done) return;
  state.loading = true;
  const gen = state.gen;
  moreBtn.hidden = true;
  setStatus(grid.children.length ? '' : 'Loading…');
  const q = new URLSearchParams({ sort: state.sort });
  if (state.tool) q.set('tool', state.tool);
  if (state.cursor) q.set('cursor', state.cursor);
  try {
    const data = await api(`/api/explore?${q}`);
    if (gen !== state.gen) return;
    const start = grid.children.length;
    const frag = document.createDocumentFragment();
    data.posts.forEach((p, i) => { state.posts.set(p.id, p); frag.append(card(p, start + i)); });
    grid.append(frag);
    for (const c of [...grid.children].slice(start)) enter.observe(c);
    layout();
    player.sync();
    state.cursor = data.cursor;
    state.done = !data.cursor;
    moreBtn.hidden = state.done;
    setStatus(grid.children.length ? '' : state.tool ? 'Nothing from this tool yet. Be the first: share a result from it.' : 'Nothing here yet. Be the first: share a result from any tool.');
  } catch (e) {
    if (gen !== state.gen) return;
    setStatus(`${e.message} `);
    statusEl.append(h('button', { type: 'button', class: 'ex-link', text: 'Try again', onclick: () => load() }));
    moreBtn.hidden = true;
  } finally {
    if (gen === state.gen) state.loading = false;
  }
}

// infinite scroll, with the button as the fallback
new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) load(); }, { rootMargin: '800px 0px' }).observe(moreBtn);
moreBtn.addEventListener('click', () => load());

function syncUrl() {
  const q = new URLSearchParams(location.search);
  state.tool ? q.set('tool', state.tool) : q.delete('tool');
  state.sort === 'top' ? q.set('sort', 'top') : q.delete('sort');
  const s = q.toString();
  history.replaceState(history.state, '', `/explore${s ? `?${s}` : ''}`);
}

// ---------- chips and sort ----------
const chips = $('#ex-chips');
for (const t of [{ id: '', label: 'All' }, ...EXPLORE_TOOLS]) {
  const b = h('button', { type: 'button', class: 'wf-chip', 'data-tool': t.id, 'aria-pressed': String(t.id === state.tool), text: t.label });
  b.addEventListener('click', () => {
    if (state.tool === t.id) return;
    state.tool = t.id;
    for (const c of chips.children) c.setAttribute('aria-pressed', String(c.dataset.tool === t.id));
    syncUrl();
    load(true);
  });
  chips.append(b);
}
for (const b of document.querySelectorAll('.ex-sort-btn')) {
  b.setAttribute('aria-pressed', String(b.dataset.sort === state.sort));
  b.addEventListener('click', () => {
    if (state.sort === b.dataset.sort) return;
    state.sort = b.dataset.sort;
    for (const x of document.querySelectorAll('.ex-sort-btn')) x.setAttribute('aria-pressed', String(x === b));
    syncUrl();
    load(true);
  });
}

// ---------- the detail sheet ----------
const sheet = $('#ex-sheet');
const msg = $('#ex-sheet-msg');
let current = null;
const say = (t, kind = '') => { msg.textContent = t || ''; msg.dataset.kind = kind; };
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

function fill(p) {
  current = p;
  const media = $('#ex-sheet-media');
  media.style.setProperty('--ar', `${p.width}/${p.height}`);
  if (p.kind === 'video') {
    const v = h('video', { src: p.media, poster: p.poster, muted: true, loop: true, playsinline: true, controls: true, preload: 'metadata' });
    v.muted = true;
    if (!reduce.matches && !navigator.connection?.saveData) { v.autoplay = true; v.play()?.catch(() => {}); }
    media.replaceChildren(v);
  } else media.replaceChildren(h('img', { src: p.media, alt: p.title }));
  $('#ex-sheet-tool').textContent = p.toolLabel;
  $('#ex-sheet-title').textContent = p.title;
  const when = p.createdAt ? new Date(p.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  $('#ex-sheet-by').textContent = `by ${p.author}${when ? ` · ${when}` : ''}`;
  $('#ex-sheet-tags').replaceChildren(...(p.tags || []).map((t) => h('span', { class: 'ex-tag', text: `#${t}` })));
  $('#ex-remix').href = remixHref(p.remix, p.id);
  $('#ex-remix').textContent = `Remix in ${p.toolLabel} ↗`;
  const live = $('#ex-live');
  live.hidden = !p.link;
  if (p.link) live.href = p.link;
  syncLike(p);
  $('#ex-sheet-stats').textContent = `${p.remixes} ${p.remixes === 1 ? 'remix' : 'remixes'}`;
  $('#ex-delete').hidden = !p.mine;
  $('#ex-report-open').hidden = !!p.mine;
  $('#ex-report').hidden = true;
  say(p.status === 'held' ? 'Only people with the link can see this for now. It joins the feed once your account is a day old.' : p.status === 'hidden' ? 'Hidden after reports while it is reviewed. Only you can see it.' : '');
}
function syncLike(p) {
  const b = $('#ex-like');
  b.setAttribute('aria-pressed', String(!!p.liked));
  b.setAttribute('aria-label', `${p.liked ? 'Unlike' : 'Like'}. ${plural(p.likes, 'like')}`);
  $('#ex-like-n').textContent = String(p.likes);
}

async function openSheet(id, { push = false } = {}) {
  if (!POST_ID.test(id)) return;
  const known = state.posts.get(id);
  if (known) fill(known);
  else {
    $('#ex-sheet-media').replaceChildren(h('p', { class: 'ex-wait', text: 'Loading…' }));
    for (const s of ['#ex-sheet-title', '#ex-sheet-by', '#ex-sheet-tool', '#ex-sheet-stats']) $(s).textContent = '';
    say('');
  }
  if (!sheet.open) sheet.showModal();
  if (push) history.pushState({ p: id }, '', `/explore?p=${id}`);
  try {
    const { post } = await api(`/api/explore/${id}`, {}, { auth: true });
    state.posts.set(id, post);
    if (sheet.open && (!current || current.id === id || !known)) fill(post);
  } catch (e) {
    if (!known) { $('#ex-sheet-media').replaceChildren(); $('#ex-sheet-title').textContent = e.status === 410 ? 'Unavailable' : 'Not found'; say(e.message, 'error'); $('#ex-remix').removeAttribute('href'); }
  }
}
function closeSheet() {
  if (sheet.open) sheet.close();
}
sheet.addEventListener('close', () => {
  $('#ex-sheet-media').replaceChildren();
  current = null;
  if (new URLSearchParams(location.search).has('p')) {
    const q = new URLSearchParams(location.search);
    q.delete('p');
    const s = q.toString();
    history.replaceState(null, '', `/explore${s ? `?${s}` : ''}`);
  }
});
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
$('#ex-close').addEventListener('click', closeSheet);
window.addEventListener('popstate', () => {
  const id = new URLSearchParams(location.search).get('p');
  if (id) openSheet(id); else closeSheet();
});

function goSignIn() {
  try { sessionStorage.setItem('chucksi.after-signin', '/explore/'); } catch { /* private mode */ }
  location.href = '/projects/#account';
}

$('#ex-like').addEventListener('click', async () => {
  const p = current;
  if (!p) return;
  if (!session()) { say('Sign in to like posts. '); msg.append(h('button', { type: 'button', class: 'ex-link', text: 'Sign in', onclick: goSignIn })); return; }
  const on = !p.liked;
  p.liked = on;
  p.likes = Math.max(0, p.likes + (on ? 1 : -1));
  syncLike(p);
  try {
    const r = await api(`/api/explore/${p.id}/like`, { method: on ? 'POST' : 'DELETE' }, { auth: true });
    p.likes = r.likes;
    p.liked = r.liked;
    if (current === p) syncLike(p);
    const c = grid.querySelector(`[data-id="${p.id}"] .ex-likes`);
    if (c) c.textContent = `♥ ${p.likes}`;
  } catch (e) {
    p.liked = !on;
    p.likes = Math.max(0, p.likes + (on ? -1 : 1));
    if (current === p) syncLike(p);
    say(e.status === 401 ? 'Please sign in again to like posts.' : e.message, 'error');
  }
});

$('#ex-copy').addEventListener('click', async () => {
  if (!current) return;
  const url = `${location.origin}/explore?p=${current.id}`;
  try { await navigator.clipboard.writeText(url); say('Link copied.'); } catch { say(url); }
});

$('#ex-report-open').addEventListener('click', () => { $('#ex-report').hidden = false; $('#ex-report input')?.focus(); });
$('#ex-report-cancel').addEventListener('click', () => { $('#ex-report').hidden = true; });
$('#ex-report').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p = current;
  const reason = new FormData(e.target).get('reason');
  if (!p) return;
  if (!reason) { say('Pick what is wrong.', 'error'); return; }
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    await api(`/api/explore/${p.id}/report`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason, details: $('#ex-report-details').value }) }, { human: true });
    e.target.hidden = true;
    e.target.reset();
    say('Thanks. We will review it.');
  } catch (err) {
    say(err.message, 'error');
  } finally { btn.disabled = false; }
});

$('#ex-delete').addEventListener('click', async () => {
  const p = current;
  if (!p || !p.mine) return;
  if (!confirm('Delete this post from Explore? Its image or video is removed right away.')) return;
  try {
    await api(`/api/explore/${p.id}`, { method: 'DELETE' }, { auth: true });
    state.posts.delete(p.id);
    grid.querySelector(`[data-id="${p.id}"]`)?.remove();
    layout();
    closeSheet();
    setStatus(grid.children.length ? '' : 'Nothing here yet. Be the first: share a result from any tool.');
  } catch (e) { say(e.message, 'error'); }
});

// a new post from this page (a share that waited for sign-in) shows up first
window.addEventListener('explore-posted', (e) => {
  const p = e.detail;
  if (!p || p.status === 'held' || state.sort !== 'new' || (state.tool && state.tool !== p.tool)) return;
  state.posts.set(p.id, p);
  const c = card(p);
  c.classList.add('is-in');
  grid.prepend(c);
  layout();
  setStatus('');
});

load(true);
const first = params.get('p');
if (first) openSheet(first);
// back from signing in with a share waiting: open it again
if (session()) import('../explore-share.js').then((m) => m.resumePendingShare()).catch(() => {});
window.chucksiExplore = { state, load, openSheet, player };
