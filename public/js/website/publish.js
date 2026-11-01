// Publish: a free live address for a site, <name>.v2web.site, hosted by the Chucksi Worker (src/sites.js).
// Signed-in only. The files are exactly the ZIP export's; the Worker checks them, stores them and serves them.
// The address a project was published to is remembered in this browser (localStorage), and the account's
// list of sites (GET /api/sites) lets another browser find it again.

import { apiFetch } from '../human.js';
import { session, accessToken } from '../cloud.js';
import { exportFiles } from './export.js';

export const DOMAIN = 'v2web.site';
const LINK_KEY = (id) => `chucksi.site-slug:${id}`;
const REOPEN = 'chucksi.publish-reopen';
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

/** Turn whatever someone types into an address: lowercase, hyphens, 40 characters. */
export function toSlug(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-/, '').slice(0, 40);
}

const readLink = (id) => { try { return id ? localStorage.getItem(LINK_KEY(id)) || '' : ''; } catch { return ''; } };
const writeLink = (id, slug) => { try { if (!id) return; if (slug) localStorage.setItem(LINK_KEY(id), slug); else localStorage.removeItem(LINK_KEY(id)); } catch { /* private mode */ } };

async function api(path, init = {}) {
  const token = await accessToken();
  const res = await apiFetch(path, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${token}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Hosting answered ${res.status}.`); e.status = res.status; e.data = data; throw e; }
  return data;
}

/**
 * Wire the Publish dialog. app: { getSite, getAssets, getDoc, projectId, persist, commitEdit, toast }
 *   getSite() the current spec, getAssets() the asset Map, getDoc() the preview document (for the social image),
 *   projectId() this project's local id (after persist()), persist() saves the project so it survives sign-in.
 */
export function initPublish(app) {
  const $ = (s) => document.querySelector(s);
  const dlg = $('#publish-dialog');
  if (!dlg) return null;
  const views = { out: $('#pub-out'), form: $('#pub-new'), live: $('#pub-live') };
  const slugIn = $('#pub-slug');
  const check = $('#pub-check');
  const msg = $('#pub-msg');
  const go = $('#pub-go');
  let mine = [];
  let current = '';
  let timer = 0;
  let checking = 0;
  let busy = false;

  const show = (name) => { for (const [k, v] of Object.entries(views)) v.hidden = k !== name; };
  const say = (text, kind = '') => { msg.textContent = text || ''; msg.className = `ws-note pub-msg ${kind}`; msg.hidden = !text; };
  const urlOf = (slug) => `https://${slug}.${DOMAIN}`;
  const owned = (slug) => mine.find((s) => s.slug === slug);

  function formProblem() {
    const site = app.getSite();
    if (site?.contact?.form) return 'Your form sends to another website, which hosted sites can\'t do. Clear the form URL in Settings (email works).';
    return '';
  }

  function showLive(site) {
    current = site.slug;
    const link = $('#pub-link');
    link.href = site.url || urlOf(site.slug);
    link.textContent = `${site.slug}.${DOMAIN}`;
    $('#pub-url').value = site.url || urlOf(site.slug);
    $('#pub-state').textContent = site.status === 'paused' ? 'Paused for review after reports.' : site.status === 'blocked' ? 'Taken down. It breaks the hosting rules.' : site.updatedAt ? `Updated ${new Date(site.updatedAt).toLocaleString()}` : '';
    $('#pub-update').disabled = site.status && site.status !== 'live';
    show('live');
  }

  function showForm(prefill) {
    current = '';
    show('form');
    slugIn.value = prefill || toSlug(app.getSite()?.name || '') || '';
    $('#pub-count').textContent = mine.length ? `${mine.length} of 5 sites used` : '';
    const problem = formProblem();
    if (problem) say(problem, 'warn');
    queueCheck(0);
  }

  async function open() {
    app.commitEdit();
    say('');
    dlg.showModal();
    if (!session()) { show('out'); return; }
    show('form');
    check.textContent = 'Loading your sites…';
    go.disabled = true;
    try {
      mine = (await api('/api/sites')).sites || [];
    } catch (e) {
      if (e.status === 401) { show('out'); return; }
      mine = [];
      say(e.message, 'error');
    }
    const linked = readLink(app.projectId());
    const site = linked && owned(linked);
    if (site) showLive(site);
    else { if (linked) writeLink(app.projectId(), ''); showForm(); }
  }

  function queueCheck(delay = 300) {
    clearTimeout(timer);
    const slug = slugIn.value;
    go.disabled = true;
    go.textContent = 'Publish';
    if (!slug) { check.textContent = ''; return; }
    if (!SLUG_RE.test(slug) || slug.includes('--')) { check.textContent = slug.length < 3 ? 'At least 3 characters.' : 'Letters, numbers and single hyphens; start and end with a letter or number.'; check.dataset.state = 'bad'; return; }
    if (owned(slug)) { check.textContent = 'Your site. Publishing replaces it.'; check.dataset.state = 'ok'; go.textContent = 'Update'; go.disabled = !!formProblem(); return; }
    check.textContent = 'Checking…';
    check.dataset.state = '';
    timer = setTimeout(async () => {
      const n = ++checking;
      try {
        const r = await fetch(`/api/sites/check?slug=${encodeURIComponent(slug)}`);
        const j = await r.json().catch(() => ({}));
        if (n !== checking || slugIn.value !== slug) return;
        if (!r.ok) { check.textContent = j.error || 'Could not check that address.'; check.dataset.state = 'bad'; return; }
        check.textContent = j.available ? 'Available' : j.reason || 'Not available';
        check.dataset.state = j.available ? 'ok' : 'bad';
        go.disabled = !j.available || !!formProblem() || mine.length >= 5;
        if (j.available && mine.length >= 5) check.textContent = 'You have 5 sites. Unpublish one to make room.';
      } catch {
        if (n === checking) { check.textContent = 'Could not check that address.'; check.dataset.state = 'bad'; }
      }
    }, delay);
  }

  async function filesFor(slug) {
    const site = structuredClone(app.getSite());
    if (!site.seo.url) site.seo.url = urlOf(slug);
    const files = (await exportFiles(site, app.getAssets(), { doc: app.getDoc() })).filter((f) => f.name !== '.nojekyll');
    if (files.some((f) => f.name.startsWith('assets/audio/'))) throw new Error('Audio tracks can\'t be hosted yet. Remove them from the music section, or export the ZIP and host it yourself.');
    const form = new FormData();
    form.append('meta', JSON.stringify({ slug, title: site.name, paths: files.map((f) => f.name) }));
    files.forEach((f, i) => form.append(`f${i}`, f.data instanceof Blob ? f.data : new Blob([f.data]), f.name.split('/').pop()));
    return form;
  }

  async function publish(slug, update) {
    if (busy) return;
    const problem = formProblem();
    if (problem) { say(problem, 'warn'); return; }
    busy = true;
    const btn = update ? (views.live.hidden ? go : $('#pub-update')) : go;
    const label = btn.textContent;
    btn.disabled = true;
    slugIn.disabled = true;
    btn.textContent = update ? 'Updating…' : 'Publishing…';
    say('');
    try {
      await app.persist();
      const body = await filesFor(slug);
      const r = await api(update ? `/api/sites/${slug}` : '/api/sites', { method: update ? 'PUT' : 'POST', body });
      writeLink(app.projectId(), slug);
      mine = [...mine.filter((s) => s.slug !== slug), r.site];
      showLive(r.site);
      say(update ? 'Updated. Changes are live.' : 'Published. Your site is live.', 'ok');
    } catch (e) {
      if (e.status === 401 && e.data?.signIn) { show('out'); return; }
      if (e.status === 409 && e.data?.mine) { mine = [...mine, { slug }]; queueCheck(0); }
      say(e.message, 'error');
    } finally {
      busy = false;
      slugIn.disabled = false;
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  async function unpublish() {
    if (!current || busy) return;
    if (!confirm(`Take ${current}.${DOMAIN} offline? The address becomes free for anyone.`)) return;
    busy = true;
    const btn = $('#pub-unpublish');
    btn.disabled = true;
    try {
      await api(`/api/sites/${current}`, { method: 'DELETE' });
      writeLink(app.projectId(), '');
      mine = mine.filter((s) => s.slug !== current);
      showForm(current);
      say('Unpublished. The site is offline.', 'ok');
    } catch (e) {
      say(e.message, 'error');
    } finally {
      busy = false;
      btn.disabled = false;
    }
  }

  slugIn.addEventListener('input', () => {
    const v = toSlug(slugIn.value);
    if (v !== slugIn.value) slugIn.value = v;
    say(formProblem(), 'warn');
    queueCheck();
  });
  slugIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) { e.preventDefault(); go.click(); } });
  go.addEventListener('click', () => publish(slugIn.value, !!owned(slugIn.value)));
  $('#pub-update').addEventListener('click', () => publish(current, true));
  $('#pub-unpublish').addEventListener('click', unpublish);
  $('#pub-other').addEventListener('click', () => { writeLink(app.projectId(), ''); say(''); showForm(''); slugIn.focus(); });
  $('#pub-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('#pub-url').value); app.toast('Link copied.'); } catch { $('#pub-url').select(); }
  });
  $('#pub-signin').addEventListener('click', async () => {
    try { await app.persist(); } catch { /* still go */ }
    try { sessionStorage.setItem('chucksi.after-signin', '/website/'); sessionStorage.setItem(REOPEN, '1'); } catch { /* private mode */ }
    location.href = '/projects/#account';
  });
  // back from signing in: pick up where the visitor left off
  let again = false;
  try { again = sessionStorage.getItem(REOPEN) === '1'; sessionStorage.removeItem(REOPEN); } catch { /* private mode */ }
  if (again && session()) open();
  return { open };
}
