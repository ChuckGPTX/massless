// /sign: open an envelope from its link, decrypt it here, take ESIGN consent, guide the signer through
// their fields, and post only ciphertext back. Also: the sender's manage view (owner link), in-person
// signing on a shared device, the final PDF with its Certificate of Completion, and Verify.

import { el, toast, download, bindDialogs } from '../ui.js';
import * as T from '../pdf-tools.js';
import * as C from './crypto.js';
import { Envelope, SignError } from './api.js';
import { FIELD_TYPES, roleColor, localLongDate } from './fields.js';
import { adoptSignature, loadSigFonts } from './sigpad.js';
import { finalize, EVENT_LABEL, utcStamp, signerForRole } from './final.js';
import { mountVerify } from './verify.js';
import { signerLinkCard, copyText } from './delivery.js';
import { envelopes as local } from './store.js';

export const DISCLOSURE = 'massless-esign-2026-10';
export const EXCLUDED = 'U.S. e-signature law (the ESIGN Act and UETA) does not cover wills, codicils and testamentary trusts; adoption, divorce and other family-law matters; court orders, notices and official court papers; notices of utility shutoff, default, foreclosure, eviction or repossession of a primary residence; cancellation of health or life insurance; product recall notices; and papers that must travel with hazardous materials. Deeds for recording, notarized or witnessed documents and some other instruments may need wet ink, a notary or a set process. Check before you send.';
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const bar = $('#bar');
const S = { values: {}, attach: {}, adopted: null, cur: null };
const svg = (p, cls = '') => `<svg viewBox="0 0 16 16" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${p}</svg>`;
const I = {
  lock: svg('<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>'),
  check: svg('<path d="M3.5 8.5l3 3 6-7"/>'),
  left: svg('<path d="M10 3L5 8l5 5"/>'),
  right: svg('<path d="M6 3l5 5-5 5"/>'),
  dl: svg('<path d="M8 2v9M4.5 7.5L8 11l3.5-3.5M3 14h10"/>'),
  more: svg('<circle cx="3.5" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="12.5" cy="8" r="1"/>'),
  clip: svg('<path d="M10.5 5L6 9.5a1.5 1.5 0 002.1 2.1l5-5a3 3 0 00-4.2-4.2l-5 5a4.5 4.5 0 006.4 6.4L13.5 10"/>'),
  x: svg('<path d="M4 4l8 8M12 4l-8 8"/>'),
};
const b64ToData = (b) => `data:image/png;base64,${String(b).replace(/-/g, '+').replace(/_/g, '/')}${'==='.slice((String(b).length + 3) % 4)}`;
const nameOf = (s) => (s && s.name) || (s ? `Signer ${s.index + 1}` : 'Someone');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ======================================================================
// boot
// ======================================================================
function readFragment() {
  let h = location.hash.slice(1);
  if (h && h !== 'verify' && /(^|&)e=/.test(h)) {
    try { sessionStorage.setItem('ms-sign', h); } catch { /* private mode */ }
    // keep the key out of the address bar, screenshots and synced history
    history.replaceState(null, '', location.pathname + location.search);
  } else if (!h) {
    try { h = sessionStorage.getItem('ms-sign') || ''; } catch { h = ''; }
  }
  return C.parseFragment(h);
}
window.addEventListener('hashchange', () => location.reload());

async function boot() {
  bindDialogs();
  const verifyOnly = location.hash === '#verify';
  const f = verifyOnly ? {} : readFragment();
  if (!f.e) return landing(verifyOnly);
  if (!f.k || !(f.s || f.o)) return fail('This link is incomplete', 'Part of the link is missing. Copy the whole link from the message and open it again.');
  Object.assign(S, { f, owner: !!f.o, inPerson: f.p === '1', queue: String(f.q || '').split(',').filter(Boolean) });
  loading('Opening your envelope', 'Opening your document…');
  try {
    S.key = await C.importKey(f.k);
    S.api = new Envelope(f.e, f.s || f.o);
    S.env = await S.api.get();
    const { meta, pdf } = C.unpack(await C.decrypt(S.key, C.unb64u(S.env.doc), C.AAD.doc));
    S.meta = meta;
    S.pdf = pdf;
    delete S.env.doc;
    S.docHash = await C.sha256Hex(pdf);
    if (S.docHash !== S.env.docHash) throw new Error('This document does not match its fingerprint. Do not sign it. Ask the sender for a new link.');
    S.payloads = [];
    for (const p of S.env.payloads || []) S.payloads[p.index] = await C.decryptJson(S.key, C.unb64u(p.data), C.AAD.signer(p.index));
    delete S.env.payloads;
  } catch (e) {
    if (e instanceof SignError) {
      if (e.status === 410) return fail('This envelope expired', 'Unsigned envelopes are deleted after 30 days and completed ones after 90. Ask the sender to send it again.');
      if (e.status === 404) return fail('This envelope is gone', 'It was deleted by the sender or it never existed. Ask the sender for a new link.');
      if (e.status === 403 || e.status === 401) return fail('This link does not open this envelope', 'The access token in the link is wrong. Copy the whole link and try again.');
      return fail('Could not open the envelope', e.message);
    }
    return fail('Could not open the envelope', e.message || String(e));
  }
  document.title = `${S.meta.name || 'Document'} | Chucksi Sign`;
  if (S.owner) return manage();
  S.me = S.meta.signers.find((s) => s.index === S.env.you.index) || { index: S.env.you.index, role: `r${S.env.you.index}` };
  S.mine = (S.meta.fields || []).filter((x) => x.role === S.me.role).sort(byPosition);
  S.api.event('viewed', { docHash: S.docHash }).catch(() => {});
  route();
}
const byPosition = (a, b) => a.page - b.page || a.y - b.y || a.x - b.x;

function route() {
  hideBar();
  const me = S.env.signers.find((s) => s.index === S.me.index);
  if (S.env.status === 'declined') return declinedView();
  if (S.env.status === 'completed') return completedView();
  if (me.status === 'signed') return signedView();
  if (me.status === 'declined') return declinedView();
  if (!S.env.you.turn) return waitingView();
  if (S.inPerson && !S.confirmedName) return handoffView();
  if (!me.consentedAt && !S.consented) return consentView();
  return signingView();
}

// ======================================================================
// small views
// ======================================================================
function screen(cls, ...kids) {
  app.className = `sg-app ${cls}`;
  app.replaceChildren(...kids);
  window.scrollTo(0, 0);
}
function loading(title, sub) {
  screen('center', el('div', { class: 'sg-status' }, el('span', { class: 'sg-spin', 'aria-hidden': 'true' }), el('h1', { class: 'display' }, title), el('p', { class: 'muted' }, sub)));
}
function fail(title, sub) {
  screen('center', el('div', { class: 'sg-status bad' }, el('span', { class: 'sg-badge bad', html: I.x }), el('h1', { class: 'display' }, title), el('p', { class: 'muted' }, sub), el('a', { class: 'btn-ghost', href: '/sign' }, 'Chucksi Sign home')));
  try { sessionStorage.removeItem('ms-sign'); } catch { /* fine */ }
}

function docHead(extra) {
  const m = S.meta;
  const who = S.owner ? 'You sent this envelope' : `For ${esc(S.me.name || nameOf(S.me))}${S.me.roleLabel ? ` · ${esc(S.me.roleLabel)}` : ''}`;
  const head = el('header', { class: 'sg-dochead' },
    el('div', { class: 'sg-doctitle' },
      el('span', { class: 'sg-eyebrow', html: `${I.lock}<span>End-to-end encrypted · envelope ${esc(S.env.id.slice(0, 8))}</span>` }),
      el('h1', {}, (m.name || 'Document').replace(/\.pdf$/i, '')),
      el('p', { class: 'muted', html: who })));
  if (m.message && !S.owner) head.append(el('blockquote', { class: 'sg-msg' }, el('span', {}, 'Message from the sender'), m.message));
  if (extra) head.append(extra);
  return head;
}

async function downloadOriginal() {
  download(T.pdfBlob(S.pdf), `${T.baseName(S.meta.name)}.pdf`);
  S.api.event('downloaded', { what: 'original', docHash: S.docHash }).catch(() => {});
}

function landing(focusVerify) {
  document.title = 'Chucksi Sign: free e-signatures';
  const v = el('div', { class: 'sg-verify-box', id: 'verify' });
  screen('landing',
    el('section', { class: 'sg-hero' },
      el('span', { class: 'sg-eyebrow', html: `${I.lock}<span>Free · end-to-end encrypted</span>` }),
      el('h1', { class: 'display' }, 'Sign anything.', el('br'), 'Show no one.'),
      el('p', { class: 'muted' }, 'Send documents for signature. Signers sign on any phone, the final PDF carries a certificate, and anyone can check it.'),
      el('div', { class: 'sg-cta' }, el('a', { class: 'btn-accent', href: '/office?tab=sign' }, 'Send a document'), el('a', { class: 'btn-ghost', href: '#verify', onclick: (e) => { e.preventDefault(); v.scrollIntoView({ behavior: 'smooth' }); } }, 'Verify a PDF'))),
    el('section', { class: 'sg-feats' },
      feat('Private by design', 'Every document is locked with a key that lives only in its link, so only the people you share it with can read it.'),
      feat('Signed in order', 'Signers go one after another or all at once. Every step is recorded with a timestamp.'),
      feat('Proof you can check', 'The final PDF ends with a Certificate of Completion. Chucksi signs the audit trail, and Verify catches a single changed byte.')),
    el('section', { class: 'sg-vsec' }, el('h2', { class: 'display' }, 'Verify'), v),
    el('section', { class: 'sg-feat sg-excl' }, el('h3', {}, 'Not for every document'), el('p', { class: 'muted' }, EXCLUDED)));
  mountVerify(v);
  if (focusVerify) requestAnimationFrame(() => v.scrollIntoView());
}
const feat = (t, p) => el('article', { class: 'sg-feat' }, el('h3', {}, t), el('p', { class: 'muted' }, p));

// ======================================================================
// pages
// ======================================================================
async function mountPages(box, { interactive = false } = {}) {
  const pdf = S.pdfjs || (S.pdfjs = await T.openPdfjs(S.pdf));
  box.replaceChildren();
  S.pageEls = [];
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) paint(S.pageEls[Number(e.target.dataset.page)]); }), { rootMargin: '600px 0px' });
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const wrap = el('div', { class: 'sg-page', 'data-page': i - 1, role: 'group', 'aria-label': `Page ${i} of ${pdf.numPages}` });
    wrap.style.aspectRatio = `${vp.width} / ${vp.height}`;
    const ov = el('div', { class: 'sg-ov' });
    wrap.append(el('canvas', { 'aria-hidden': 'true' }), ov, el('span', { class: 'sg-pno', 'aria-hidden': 'true' }, `${i} / ${pdf.numPages}`));
    const pg = { i: i - 1, page, vp, wrap, ov, w: 0 };
    S.pageEls.push(pg);
    box.append(wrap);
    io.observe(wrap);
  }
  drawFields(interactive);
  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => S.pageEls?.forEach((p) => p.wrap.isConnected && p.w && paint(p, true)), 200); });
}
async function paint(pg, force) {
  const w = pg.wrap.clientWidth;
  if (!w || (!force && pg.w === w) || pg.busy) return;
  pg.busy = true;
  pg.w = w;
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const viewport = pg.page.getViewport({ scale: (w * dpr) / pg.vp.width });
  const c = el('canvas', { 'aria-hidden': 'true' });
  c.width = Math.floor(viewport.width); c.height = Math.floor(viewport.height);
  try { await pg.page.render({ canvas: c, viewport }).promise; pg.wrap.querySelector('canvas').replaceWith(c); } catch { /* cancelled */ }
  pg.busy = false;
}

function fieldValueEl(f, p, v) {
  if (f.type === 'signature' || f.type === 'initials') {
    const im = f.type === 'signature' ? p.signature : p.initialsImg;
    return im && v ? el('img', { src: b64ToData(im.png), alt: f.type === 'signature' ? `Signature of ${p.name || ''}` : `Initials of ${p.name || ''}`, draggable: 'false' }) : null;
  }
  if (f.type === 'checkbox') return v === true ? el('span', { class: 'v check', html: I.check }) : null;
  if (f.type === 'attachment') {
    const a = (p.attachments || []).find((x) => x.field === f.id) || (S.attach[f.id]);
    return a ? el('span', { class: 'v', html: `${I.clip}<span>${esc(a.name)}</span>` }) : null;
  }
  return v ? el('span', { class: 'v' }, String(v)) : null;
}

function drawFields(interactive) {
  for (const pg of S.pageEls) pg.ov.replaceChildren();
  const myPayload = () => ({ name: S.adopted?.name || S.me.name, signature: S.adopted?.signature, initialsImg: S.adopted?.initialsImg, attachments: Object.values(S.attach), values: S.values });
  for (const f of S.meta.fields || []) {
    const pg = S.pageEls[f.page];
    if (!pg) continue;
    const owner = signerForRole(S.meta, f.role);
    const mine = !S.owner && S.me && f.role === S.me.role && interactive;
    const p = mine ? myPayload() : owner ? S.payloads[owner.index] : null;
    if (!mine && !p) continue; // other signers' empty fields stay hidden
    const v = p && p.values ? p.values[f.id] : undefined;
    const n = el(mine ? 'button' : 'div', { class: `sg-f t-${f.type}${mine ? ' mine' : ' theirs'}`, 'data-id': f.id });
    if (mine) { n.type = 'button'; n.addEventListener('click', () => act(f)); }
    Object.assign(n.style, { left: `${(f.x / pg.vp.width) * 100}%`, top: `${(f.y / pg.vp.height) * 100}%`, width: `${(f.w / pg.vp.width) * 100}%`, height: `${(f.h / pg.vp.height) * 100}%` });
    n.style.setProperty('--c', roleColor(owner ? owner.index : 0));
    n.style.setProperty('--fs', String(Math.min(10, Math.max(6, f.h * 0.66)) / pg.vp.width * 100));
    const shown = fieldValueEl(f, p || {}, v);
    if (shown) { n.append(shown); n.classList.add('done'); }
    else if (mine) {
      const def = FIELD_TYPES[f.type];
      n.append(el('span', { class: 'tag' }, f.type === 'text' || f.type === 'dropdown' ? (f.label || def.short) : def.short));
      if (f.required) n.classList.add('req');
    }
    if (mine) n.setAttribute('aria-label', `${FIELD_TYPES[f.type].label}${f.label ? `: ${f.label}` : ''}${f.required ? ', required' : ', optional'}${shown ? ', done' : ''}`);
    if (S.cur === f.id) n.classList.add('cur');
    pg.ov.append(n);
  }
}

// ======================================================================
// consent (ESIGN Act / UETA consumer disclosure)
// ======================================================================
function consentView() {
  const box = el('label', { class: 'check sg-agree' }, el('input', { type: 'checkbox', id: 'agree' }), el('span', {}, el('strong', {}, 'I agree to use electronic records and signatures.'), el('small', {}, 'I can open and read this document on this device, and I have read the disclosure above.')));
  const go = el('button', { type: 'button', class: 'go', id: 'consent-go', disabled: true, html: `<span>Continue</span>${I.right}` });
  box.querySelector('input').addEventListener('change', (e) => { go.disabled = !e.target.checked; });
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.querySelector('span').textContent = 'Saving';
    try {
      await S.api.event('consented', { docHash: S.docHash, disclosure: DISCLOSURE });
      S.consented = true;
      route();
    } catch (e) {
      toast(e.message, 'error');
      go.disabled = false;
      go.querySelector('span').textContent = 'Continue';
      if (e.data?.notYourTurn) refresh();
    }
  });
  const sec = (title, body) => el('section', {}, el('h3', {}, title), el('p', {}, body));
  screen('consent',
    docHead(),
    el('div', { class: 'sg-card sg-consent' },
      el('h2', { class: 'display' }, 'Before you sign'),
      el('p', { class: 'lead' }, `${S.meta.senderName ? esc(S.meta.senderName) : 'The sender'} asks you to review and sign this document electronically. Please read this, then agree to continue.`),
      sec('Electronic records and signatures', 'You agree to receive this document and its signed copy electronically, and to sign with an electronic signature. Your electronic signature means the same as signing on paper. This consent covers this envelope only.'),
      sec('Your right to paper', 'You can ask the sender for a paper copy instead, at any time. Chucksi charges nothing for it; the sender will tell you if they charge a fee. You can also download and print the document below.'),
      sec('Withdrawing consent', 'You can withdraw consent before you finish by choosing Decline, or by telling the sender. Withdrawing does not undo a signature you already gave. If you withdraw, the sender may send the document on paper. Tell the sender if your email or other contact details change.'),
      sec('What you need', 'A current web browser (Chrome, Safari, Edge or Firefox from the last two years) with JavaScript on, a screen that can show PDFs, and a way to save or print files. No account and no app.'),
      sec('Keeping a copy', 'Download the PDF now, and the final signed PDF with its certificate once everyone has signed. Keep your link: it is the only way back in. Completed envelopes are deleted from Chucksi after 90 days.'),
      el('div', { class: 'sg-row' }, el('button', { type: 'button', class: 'btn-ghost', html: `${I.dl}<span>Download the document (PDF)</span>`, onclick: downloadOriginal }), el('button', { type: 'button', class: 'btn-ghost', onclick: () => $('#how')?.showModal() }, 'How Chucksi keeps it private')),
      box,
      go,
      el('button', { type: 'button', class: 'sg-link danger', onclick: declineFlow }, 'Decline to sign')));
}
const notice = () => el('p', { class: 'sg-notice' }, 'Chucksi Sign provides templates and signing tools, not legal advice.');

// ======================================================================
// in-person hand-off
// ======================================================================
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function handoffView() {
  const expected = S.me.name || '';
  const input = el('input', { type: 'text', id: 'confirm-name', autocomplete: 'off', spellcheck: 'false', placeholder: 'Your full name', 'aria-label': 'Type your full name' });
  const go = el('button', { type: 'button', class: 'go', id: 'confirm-go', html: `<span>That's me</span>${I.right}` });
  const check = () => {
    const typed = input.value.trim();
    if (typed.length < 2) { toast('Type your full name.', 'error'); return; }
    if (expected && norm(typed) !== norm(expected)) { toast(`That does not match the name the sender gave for this signer. Type it as "${expected}".`, 'error'); return; }
    S.confirmedName = typed;
    route();
  };
  go.addEventListener('click', check);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
  screen('center handoff',
    el('div', { class: 'sg-card sg-handoff' },
      el('span', { class: 'sg-badge', html: svg('<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M7 12.5h2"/>') }),
      el('p', { class: 'sg-eyebrow' }, 'In-person signing'),
      el('h1', { class: 'display' }, `Hand this device to ${expected || 'the signer'}`),
      el('p', { class: 'muted' }, `${expected ? `${expected}, confirm` : 'Confirm'} it's you by typing your full name. It is recorded with your signature.`),
      input, go));
  input.focus();
}

// ======================================================================
// waiting, signed, declined
// ======================================================================
function refresh() {
  return S.api.get({ status: true }).then((env) => { Object.assign(S.env, env); route(); }).catch((e) => toast(e.message, 'error'));
}
function waitingView() {
  const ahead = S.env.waitingOn.map((i) => S.meta.signers.find((s) => s.index === i)).filter(Boolean);
  const pages = el('div', { class: 'sg-pages' });
  screen('doc',
    docHead(el('div', { class: 'sg-banner' }, el('strong', {}, `${ahead.map(nameOf).join(' and ') || 'Someone else'} signs first`), el('span', {}, 'You can read the document now. Signing opens when it is your turn.'), el('button', { type: 'button', class: 'btn-ghost small', onclick: refresh }, 'Check again'))),
    pages);
  mountPages(pages);
}
function signedView(extra) {
  const pending = S.env.signers.filter((s) => s.status === 'pending').map((s) => S.meta.signers.find((m) => m.index === s.index)).filter(Boolean);
  const next = S.queue.length ? S.queue[0].split('.') : null;
  const nextSigner = next ? S.meta.signers.find((s) => s.index === Number(next[0])) : null;
  const kids = [
    el('span', { class: 'sg-badge ok', html: I.check }),
    el('h1', { class: 'display' }, 'You signed'),
    el('p', { class: 'muted' }, `${(S.meta.name || 'The document').replace(/\.pdf$/i, '')} is signed by you${S.signedAt ? ` at ${new Date(S.signedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}. ${pending.length ? `Waiting for ${pending.map(nameOf).join(', ')}.` : ''}`),
    el('p', { class: 'small muted' }, 'When everyone has signed, open your link again to download the final PDF with its certificate.'),
  ];
  if (extra) kids.push(extra);
  if (nextSigner && S.inPerson) {
    kids.push(el('button', { type: 'button', class: 'go', id: 'next-signer', html: `<span>Next: ${esc(nameOf(nextSigner))}</span>${I.right}`, onclick: () => {
      const q = S.queue.slice(1).join(',');
      location.hash = new URLSearchParams({ e: S.env.id, s: next[1], k: S.f.k, p: '1', ...(q ? { q } : {}) }).toString();
    } }));
  } else if (S.inPerson) kids.push(el('p', { class: 'sg-handback' }, 'Hand the device back to the sender.'));
  kids.push(el('button', { type: 'button', class: 'btn-ghost', html: `${I.dl}<span>Download the document</span>`, onclick: downloadOriginal }));
  screen('center', el('div', { class: 'sg-card sg-done' }, ...kids));
}
async function declinedView() {
  const reasons = [];
  for (const d of S.env.declines || []) {
    let reason = '';
    if (d.reason) { try { reason = (await C.decryptJson(S.key, C.unb64u(d.reason), C.AAD.decline(d.index))).reason; } catch { reason = ''; } }
    reasons.push(el('li', {}, el('strong', {}, nameOf(S.meta.signers.find((s) => s.index === d.index))), reason ? el('span', {}, `“${reason}”`) : el('span', { class: 'muted' }, 'No reason given.')));
  }
  screen('center', el('div', { class: 'sg-card sg-done' },
    el('span', { class: 'sg-badge bad', html: I.x }),
    el('h1', { class: 'display' }, 'Declined'),
    el('p', { class: 'muted' }, 'This envelope was declined, so no one can sign it. The sender can fix the document and send a new one.'),
    el('ul', { class: 'sg-reasons' }, ...reasons),
    S.owner ? null : el('button', { type: 'button', class: 'btn-ghost', html: `${I.dl}<span>Download the document</span>`, onclick: downloadOriginal })));
}

// ======================================================================
// decline
// ======================================================================
function declineFlow() {
  const d = el('dialog', { class: 'sheet sg-sheet' });
  d.innerHTML = '<form method="dialog" class="sheet-head"><h2>Decline to sign</h2><button class="x" aria-label="Close">×</button></form><p>The sender and other signers will see that you declined. No one can sign this envelope after that.</p>';
  const ta = el('textarea', { id: 'decline-reason', rows: 4, maxlength: 1000, placeholder: 'Reason (optional). It is encrypted; only people with the link can read it.', 'aria-label': 'Reason for declining' });
  const go = el('button', { type: 'button', class: 'btn-accent danger', id: 'decline-go' }, 'Decline');
  d.append(el('div', { class: 'field' }, ta), el('div', { class: 'sg-actions' }, el('button', { type: 'button', class: 'btn-ghost', onclick: () => d.close() }, 'Keep signing'), go));
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const reason = ta.value.trim();
      const body = { docHash: S.docHash };
      if (reason) body.reason = C.b64u(await C.encryptJson(S.key, { reason }, C.AAD.decline(S.me.index)));
      await S.api.event('declined', body);
      d.close();
      hideBar();
      await refresh();
    } catch (e) {
      toast(e.message, 'error');
      go.disabled = false;
    }
  });
  d.showModal();
  ta.focus();
}

// ======================================================================
// signing
// ======================================================================
const draftKey = () => `ms-draft-${S.env.id}-${S.me.index}`;
function saveDraft() {
  try { sessionStorage.setItem(draftKey(), JSON.stringify({ values: S.values, adopted: S.adopted && { ...S.adopted, preview: undefined } })); } catch { /* full or private */ }
}
function loadDraft() {
  try { const d = JSON.parse(sessionStorage.getItem(draftKey()) || 'null'); if (d) { S.values = d.values || {}; S.adopted = d.adopted || null; } } catch { /* none */ }
}
const isDone = (f) => {
  const v = S.values[f.id];
  if (f.type === 'checkbox') return v === true;
  if (f.type === 'attachment') return !!S.attach[f.id];
  return v != null && v !== false && String(v).trim() !== '';
};
const required = () => S.mine.filter((f) => f.required);
const remaining = () => required().filter((f) => !isDone(f));

async function signingView() {
  loadDraft();
  const today = localLongDate();
  for (const f of S.mine) {
    if (f.type === 'date') S.values[f.id] = today;
    if (f.type === 'name' && !S.values[f.id]) S.values[f.id] = S.adopted?.name || S.confirmedName || S.me.name || '';
    if (f.type === 'checkbox' && S.values[f.id] == null) S.values[f.id] = false;
  }
  const pages = el('div', { class: 'sg-pages' });
  screen('doc signing', docHead(), pages, notice());
  showBar();
  loadSigFonts();
  T.loadPdfLib().catch(() => {});
  await mountPages(pages, { interactive: true });
  if (!S.mine.length) toast('The sender placed no fields for you. Press Finish to sign.');
  focusField(remaining()[0] || null, false);
}

function focusField(f, scroll = true) {
  S.cur = f ? f.id : null;
  document.querySelectorAll('.sg-f.cur').forEach((n) => n.classList.remove('cur'));
  if (f) {
    const n = document.querySelector(`.sg-f[data-id="${CSS.escape(f.id)}"]`);
    if (n) {
      n.classList.add('cur');
      if (scroll) n.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    }
  }
  syncBar();
}

function showBar() {
  bar.hidden = false;
  document.body.classList.add('has-bar');
  bar.replaceChildren(
    el('div', { class: 'sg-prog' }, el('div', { class: 'sg-meter' }, el('i', { id: 'meter' })), el('span', { id: 'prog' })),
    el('div', { class: 'sg-bar-acts' },
      el('button', { type: 'button', class: 'sg-ibtn', id: 'prev', 'aria-label': 'Previous field', html: I.left, onclick: () => step(-1) }),
      el('button', { type: 'button', class: 'go sg-main', id: 'main', onclick: mainAction }),
      el('button', { type: 'button', class: 'sg-ibtn', id: 'nextf', 'aria-label': 'Next field', html: I.right, onclick: () => step(1) }),
      el('button', { type: 'button', class: 'sg-ibtn', id: 'more', 'aria-label': 'More options', 'aria-haspopup': 'menu', html: I.more, onclick: moreMenu })));
  syncBar();
}
function hideBar() { bar.hidden = true; document.body.classList.remove('has-bar'); }

function syncBar() {
  if (bar.hidden) return;
  const req = required();
  const done = req.filter(isDone).length;
  $('#prog').textContent = req.length ? `${done} of ${req.length} required done` : 'Nothing required';
  $('#meter').style.width = `${req.length ? (done / req.length) * 100 : 100}%`;
  const f = S.mine.find((x) => x.id === S.cur);
  const main = $('#main');
  let label;
  if (!remaining().length && (!f || isDone(f))) label = 'Finish';
  else if (!f) label = 'Next field';
  else if (f.type === 'signature') label = isDone(f) ? 'Next field' : 'Sign here';
  else if (f.type === 'initials') label = isDone(f) ? 'Next field' : 'Initial here';
  else if (f.type === 'checkbox') label = isDone(f) ? 'Uncheck' : 'Check';
  else if (f.type === 'attachment') label = isDone(f) ? 'Replace file' : 'Attach file';
  else if (f.type === 'dropdown') label = `Choose ${f.label || 'an option'}`;
  else if (f.type === 'date') label = 'Next field';
  else label = isDone(f) ? `Edit ${f.label || FIELD_TYPES[f.type].label}` : `Fill in ${f.label || FIELD_TYPES[f.type].label}`;
  main.innerHTML = `<span>${esc(label)}</span>${label === 'Finish' ? I.check : I.right}`;
  main.classList.toggle('finish', label === 'Finish');
  main.dataset.action = label === 'Finish' ? 'finish' : label === 'Next field' ? 'next' : 'act';
}

function step(dir) {
  const list = S.mine;
  if (!list.length) return;
  const i = list.findIndex((x) => x.id === S.cur);
  const j = i < 0 ? 0 : (i + dir + list.length) % list.length;
  focusField(list[j]);
}
function advance() {
  const next = remaining()[0];
  if (next) focusField(next);
  else { focusField(null, false); syncBar(); }
}
function mainAction() {
  const a = $('#main').dataset.action;
  if (a === 'finish') return finishFlow();
  if (a === 'next') return advance();
  const f = S.mine.find((x) => x.id === S.cur);
  if (f) act(f);
}

async function act(f) {
  if (S.cur !== f.id) focusField(f, false);
  if (f.type === 'signature' || f.type === 'initials') {
    if (isDone(f)) { delete S.values[f.id]; saveDraft(); drawFields(true); syncBar(); toast(`${FIELD_TYPES[f.type].label} removed. Tap the field to add it again.`); return; }
    if (!S.adopted) {
      const a = await adoptSignature({ name: S.confirmedName || S.me.name || '', needInitials: S.mine.some((x) => x.type === 'initials') });
      if (!a) return;
      S.adopted = a;
      for (const x of S.mine) if (x.type === 'name' && (!S.values[x.id] || S.values[x.id] === S.me.name)) S.values[x.id] = a.name;
    }
    S.values[f.id] = true;
    saveDraft();
    drawFields(true);
    advance();
    return;
  }
  if (f.type === 'checkbox') { S.values[f.id] = !(S.values[f.id] === true); saveDraft(); drawFields(true); if (S.values[f.id]) advance(); else syncBar(); return; }
  if (f.type === 'date') { toast('The date fills in by itself when you sign.'); return; }
  if (f.type === 'attachment') return pickAttachment(f);
  editField(f);
}

function editField(f) {
  const d = el('dialog', { class: 'sheet sg-sheet sg-edit' });
  const label = f.label || FIELD_TYPES[f.type].label;
  d.innerHTML = `<form method="dialog" class="sheet-head"><h2>${esc(label)}</h2><button class="x" aria-label="Close">×</button></form>`;
  let input;
  if (f.type === 'dropdown') {
    input = el('select', { id: 'edit-in', 'aria-label': label }, el('option', { value: '' }, 'Choose…'), ...(f.options || []).map((o) => el('option', { value: o }, o)));
  } else {
    input = el('input', { type: 'text', id: 'edit-in', maxlength: 200, 'aria-label': label, autocomplete: f.type === 'name' ? 'name' : 'off' });
  }
  input.value = S.values[f.id] || '';
  const save = el('button', { type: 'button', class: 'btn-accent', id: 'edit-save' }, 'Save');
  d.append(el('p', { class: 'small muted' }, f.required ? 'Required' : 'Optional'), el('div', { class: 'field' }, input), el('div', { class: 'sg-actions' }, el('button', { type: 'button', class: 'btn-ghost', onclick: () => { input.value = ''; } }, 'Clear'), save));
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  const commit = () => {
    const v = input.value.trim();
    if (v) S.values[f.id] = v; else delete S.values[f.id];
    saveDraft();
    d.close();
    drawFields(true);
    if (v) advance(); else syncBar();
  };
  save.addEventListener('click', commit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  d.showModal();
  input.focus();
}

function pickAttachment(f) {
  const inp = el('input', { type: 'file', accept: 'application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg', hidden: true });
  document.body.append(inp);
  inp.addEventListener('change', async () => {
    const file = inp.files[0];
    inp.remove();
    if (!file) return;
    const used = Object.values(S.attach).reduce((a, x) => a + x.size, 0);
    const budget = Math.min(4 * 1024 * 1024, Math.max(0, (S.env.bytesLeft || 0) - 300 * 1024 - used));
    if (file.size > budget) { toast(`That file is too big. You have about ${T.fmtBytes(budget)} left in this envelope.`, 'error'); return; }
    S.attach[f.id] = { field: f.id, name: file.name.slice(0, 120), type: file.type || 'application/octet-stream', size: file.size, data: C.b64u(new Uint8Array(await file.arrayBuffer())) };
    S.values[f.id] = file.name;
    drawFields(true);
    advance();
  });
  inp.click();
}

function moreMenu() {
  const d = el('dialog', { class: 'sheet sg-sheet sg-menu' });
  d.innerHTML = '<form method="dialog" class="sheet-head"><h2>Options</h2><button class="x" aria-label="Close">×</button></form>';
  const item = (label, fn, cls = '') => el('button', { type: 'button', class: `sg-mitem ${cls}`, onclick: () => { d.close(); fn(); } }, label);
  d.append(
    item('Download the document', downloadOriginal),
    item(S.adopted ? 'Change my signature' : 'Adopt my signature', async () => {
      const a = await adoptSignature({ name: S.adopted?.name || S.confirmedName || S.me.name || '', needInitials: S.mine.some((x) => x.type === 'initials') });
      if (a) { S.adopted = a; saveDraft(); drawFields(true); }
    }),
    item('How Chucksi keeps this private', () => $('#how')?.showModal()),
    item('Decline to sign', declineFlow, 'danger'));
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.showModal();
}

function finishFlow() {
  const left = remaining();
  if (left.length) { toast(`${left.length} required field${left.length === 1 ? ' is' : 's are'} still empty.`, 'error'); focusField(left[0]); return; }
  if (S.mine.some((f) => f.type === 'signature' || f.type === 'initials') && !S.adopted) { toast('Adopt your signature first.', 'error'); return; }
  const d = el('dialog', { class: 'sheet sg-sheet sg-finish' });
  const n = S.mine.filter(isDone).length;
  d.innerHTML = `<form method="dialog" class="sheet-head"><h2>Ready to finish?</h2><button class="x" aria-label="Close">×</button></form>
    <ul class="sg-sum"><li><span>Signing as</span><strong>${esc(S.adopted?.name || S.confirmedName || S.me.name || nameOf(S.me))}</strong></li>${S.me.roleLabel ? `<li><span>Role</span><strong>${esc(S.me.roleLabel)}</strong></li>` : ''}<li><span>Fields</span><strong>${n} filled</strong></li></ul>
    ${S.adopted ? `<div class="sg-sigprev"><img alt="Your signature" src="${S.adopted.preview?.sig || b64ToData(S.adopted.signature.png)}"></div>` : ''}
    <p class="sg-legal">By selecting <strong>Finish</strong>, I agree to sign this document electronically, and that my electronic signature is as valid as my handwritten signature. Your fields are encrypted on this device before they are sent.</p>`;
  const go = el('button', { type: 'button', class: 'go', id: 'finish-go', html: `<span>Finish</span>${I.check}` });
  d.append(el('div', { class: 'sg-actions col' }, go, el('button', { type: 'button', class: 'btn-ghost', onclick: () => d.close() }, 'Review again')));
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  go.addEventListener('click', async () => {
    go.disabled = true;
    go.querySelector('span').textContent = 'Encrypting and sending';
    try {
      await submit();
      d.close();
    } catch (e) {
      toast(e.message, 'error');
      go.disabled = false;
      go.querySelector('span').textContent = 'Finish';
    }
  });
  d.showModal();
}

async function submit() {
  const values = {};
  for (const f of S.mine) if (isDone(f) || f.type === 'checkbox') values[f.id] = f.type === 'date' ? localLongDate() : S.values[f.id];
  const a = S.adopted;
  const payload = {
    v: 1, index: S.me.index, role: S.me.role,
    name: a?.name || S.confirmedName || S.me.name || '', initials: a?.initials || '',
    signature: a?.signature ? { png: a.signature.png, w: a.signature.w, h: a.signature.h, mode: a.signature.mode, font: a.signature.font } : null,
    initialsImg: a?.initialsImg ? { png: a.initialsImg.png, w: a.initialsImg.w, h: a.initialsImg.h } : null,
    values, attachments: Object.values(S.attach),
    signedAt: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    inPerson: !!S.inPerson, confirmedName: S.confirmedName || undefined,
  };
  const plain = C.utf8(JSON.stringify(payload));
  const enc = await C.encrypt(S.key, plain, C.AAD.signer(S.me.index));
  const r = await S.api.event('signed', { docHash: S.docHash, payload: C.b64u(enc), fields: Object.keys(values).length, valuesHash: await C.sha256Hex(plain), inPerson: !!S.inPerson });
  try { sessionStorage.removeItem(draftKey()); } catch { /* fine */ }
  S.signedAt = Date.now();
  S.payloads[S.me.index] = payload;
  hideBar();
  const env = await S.api.get({ status: true });
  Object.assign(S.env, env);
  if (r.status === 'completed') return completedView(true);
  signedView();
}

// ======================================================================
// completed: build, seal and download the final PDF
// ======================================================================
async function buildFinal() {
  if (S.final) return S.final;
  const lib = await T.loadPdfLib();
  if (S.payloads.filter(Boolean).length < S.env.signers.length) {
    const full = await S.api.get();
    for (const p of full.payloads || []) if (!S.payloads[p.index]) S.payloads[p.index] = await C.decryptJson(S.key, C.unb64u(p.data), C.AAD.signer(p.index));
    Object.assign(S.env, { attest: full.attest, seal: full.seal, completedAt: full.completedAt });
  }
  S.final = await finalize(lib, { pdf: S.pdf, meta: S.meta, payloads: S.payloads, envelope: S.env, post: (type, body) => S.api.event(type, body) });
  if (S.final.seal) S.env.seal = S.final.seal;
  if (S.final.attest) S.env.attest = S.final.attest;
  return S.final;
}
function finalName() { return `${T.baseName(S.meta.name)}-signed.pdf`; }
async function downloadFinal() {
  const f = await buildFinal();
  download(T.pdfBlob(f.bytes), finalName());
  S.api.event('downloaded', { what: 'final', docHash: f.finalHash }).catch(() => {});
}

async function completedView(justSigned = false) {
  const state = el('div', { class: 'sg-sealing', 'aria-live': 'polite' }, el('span', { class: 'sg-spin small', 'aria-hidden': 'true' }), el('span', {}, 'Building the final PDF and its certificate…'));
  const dl = el('button', { type: 'button', class: 'go', id: 'dl-final', disabled: true, html: `<span>Download signed PDF</span>${I.dl}` });
  dl.addEventListener('click', () => downloadFinal().catch((e) => toast(e.message, 'error')));
  const signers = el('ol', { class: 'sg-slist' }, ...S.env.signers.map((s) => {
    const m = S.meta.signers.find((x) => x.index === s.index) || {};
    const p = S.payloads[s.index];
    return el('li', {}, el('span', { class: 'sg-dot', style: `--c:${roleColor(s.index)}` }, String(s.order)), el('span', {}, el('strong', {}, (p && p.name) || nameOf(m)), el('small', {}, `${m.roleLabel ? `${m.roleLabel} · ` : ''}signed ${utcStamp(s.signedAt)}`)));
  }));
  screen('center', el('div', { class: 'sg-card sg-done wide' },
    el('span', { class: 'sg-badge ok', html: I.check }),
    el('h1', { class: 'display' }, justSigned ? 'Done. Everyone signed.' : 'Completed'),
    el('p', { class: 'muted' }, `${(S.meta.name || 'The document').replace(/\.pdf$/i, '')} is signed by everyone. The final PDF adds a Certificate of Completion with the audit trail, sealed by Chucksi.`),
    signers, state, dl,
    el('div', { class: 'sg-row center' },
      el('button', { type: 'button', class: 'btn-ghost small', html: `${I.dl}<span>Original PDF</span>`, onclick: downloadOriginal }),
      el('a', { class: 'btn-ghost small', href: '/sign#verify', target: '_blank', rel: 'noopener' }, 'Verify a PDF')),
    S.inPerson ? el('p', { class: 'sg-handback' }, 'Hand the device back to the sender.') : null));
  try {
    const f = await buildFinal();
    state.className = `sg-sealing ${f.matches ? 'ok' : 'warn'}`;
    state.innerHTML = f.matches
      ? `${I.check}<span>Sealed and ready to download.</span>`
      : `${I.x}<span>Your rebuilt copy differs from the sealed copy. Ask the sender for the sealed file.</span>`;
    dl.disabled = false;
  } catch (e) {
    state.className = 'sg-sealing warn';
    state.innerHTML = `${I.x}<span>${esc(e.message || 'Could not build the final PDF.')}</span>`;
    const retry = el('button', { type: 'button', class: 'btn-ghost small', onclick: () => { S.final = null; completedView(); } }, 'Try again');
    state.append(retry);
  }
}

// ======================================================================
// manage (owner link)
// ======================================================================
async function manage() {
  const env = S.env;
  const rec = await local.get(env.id).catch(() => null);
  const statusText = env.status === 'completed' ? 'Completed' : env.status === 'declined' ? 'Declined' : `Waiting for ${env.waitingOn.map((i) => nameOf(S.meta.signers.find((s) => s.index === i))).join(' and ') || 'signers'}`;
  const pill = el('span', { class: `sg-pill ${env.status}` }, statusText);
  const timeline = el('ol', { class: 'sg-timeline' }, ...env.signers.map((s) => {
    const m = S.meta.signers.find((x) => x.index === s.index) || {};
    const steps = [['Opened', s.viewedAt], ['Agreed', s.consentedAt], [s.status === 'declined' ? 'Declined' : 'Signed', s.signedAt || s.declinedAt]];
    return el('li', { class: s.status },
      el('span', { class: 'sg-dot', style: `--c:${roleColor(s.index)}` }, String(s.order)),
      el('div', {}, el('strong', {}, nameOf(m)), el('small', {}, [m.roleLabel, m.email].filter(Boolean).join(' · '))),
      el('div', { class: 'sg-steps' }, ...steps.map(([k, t]) => el('span', { class: t ? 'on' : '' }, el('b', {}, k), el('small', {}, t ? utcStamp(t).replace(':00 UTC', ' UTC').slice(5) : '·')))));
  }));
  const actions = el('div', { class: 'sg-row' },
    el('button', { type: 'button', class: 'btn-ghost small', html: `${I.dl}<span>Original PDF</span>`, onclick: downloadOriginal }),
    env.status === 'completed' ? el('button', { type: 'button', class: 'btn-accent small', id: 'dl-final', html: `${I.dl}<span>Signed PDF</span>`, onclick: (e) => { const b = e.currentTarget; b.disabled = true; downloadFinal().catch((x) => toast(x.message, 'error')).finally(() => { b.disabled = false; }); } }) : null,
    el('button', { type: 'button', class: 'btn-ghost small', onclick: () => location.reload() }, 'Refresh'),
    el('button', { type: 'button', class: 'btn-ghost small danger', id: 'delete-env', onclick: deleteEnvelope }, 'Delete envelope'));
  const links = el('section', { class: 'sg-sec' }, el('h2', {}, 'Signer links'));
  if (rec && env.status === 'sent') {
    for (const s of rec.signers) links.append(signerLinkCard({ origin: location.origin, envelopeId: env.id, key: S.f.k, signer: s, message: S.meta.message, docName: S.meta.name, all: rec.signers }));
  } else if (env.status === 'sent') {
    links.append(el('p', { class: 'muted small' }, 'Signer links are only on the device that created the envelope (Office > Sign > Envelopes).'));
  } else links.hidden = true;
  const auditBox = el('section', { class: 'sg-sec' }, el('h2', {}, 'Audit trail'), el('p', { class: 'muted small' }, 'Loading…'));
  const declined = el('div', { class: 'sg-reasons-box' });
  for (const d of env.declines || []) {
    let reason = '';
    if (d.reason) { try { reason = (await C.decryptJson(S.key, C.unb64u(d.reason), C.AAD.decline(d.index))).reason; } catch { reason = ''; } }
    declined.append(el('div', { class: 'sg-banner bad' }, el('strong', {}, `${nameOf(S.meta.signers.find((s) => s.index === d.index))} declined`), el('span', {}, reason ? `“${reason}”` : 'No reason given.')));
  }
  screen('manage',
    docHead(el('div', { class: 'sg-mstat' }, pill, el('span', { class: 'muted small' }, `Created ${utcStamp(env.createdAt)} · ${env.status === 'completed' ? 'kept until' : 'expires'} ${utcStamp(env.expiresAt).slice(0, 10)}`))),
    declined,
    el('section', { class: 'sg-sec' }, el('h2', {}, env.routing === 'parallel' ? 'Signers · any order' : 'Signers · in order'), timeline, actions),
    links, auditBox);
  try {
    const a = await S.api.audit();
    const rows = a.events.map((e) => el('tr', {}, el('td', {}, String(e.seq)), el('td', {}, utcStamp(e.at)), el('td', {}, el('strong', {}, EVENT_LABEL[e.type] || e.type)), el('td', {}, e.actor === 'owner' ? 'Sender' : e.actor === 'server' ? 'Chucksi' : nameOf(S.meta.signers.find((s) => s.index === e.signer))), el('td', { class: 'mono' }, e.ip || ''), el('td', { class: 'ua' }, e.ua || '')));
    auditBox.replaceChildren(el('h2', {}, 'Audit trail'), el('div', { class: 'sg-tablewrap' }, el('table', { class: 'sg-table' }, el('thead', {}, el('tr', {}, ...['#', 'Time', 'Event', 'By', 'IP', 'Device'].map((h) => el('th', {}, h)))), el('tbody', {}, ...rows))));
  } catch (e) { auditBox.querySelector('p').textContent = e.message; }
  if (rec) local.put({ ...rec, status: env.status, statusText, checked: Date.now() }).catch(() => {});
}

async function deleteEnvelope() {
  if (!confirm('Delete this envelope for everyone? The document, signatures and audit trail are erased from Chucksi. Links stop working. A seal with fingerprints only (no names, no content) stays so copies already downloaded can still be verified.')) return;
  try {
    await S.api.remove();
    const rec = await local.get(S.env.id).catch(() => null);
    if (rec) await local.put({ ...rec, status: 'deleted', statusText: 'Deleted' });
    try { sessionStorage.removeItem('ms-sign'); } catch { /* fine */ }
    screen('center', el('div', { class: 'sg-card sg-done' }, el('span', { class: 'sg-badge', html: I.check }), el('h1', { class: 'display' }, 'Deleted'), el('p', { class: 'muted' }, 'The envelope has been deleted from Chucksi.'), el('a', { class: 'btn-ghost', href: '/office?tab=sign' }, 'Back to Office')));
  } catch (e) { toast(e.message, 'error'); }
}

// test and debugging hook, like window.massless on other pages
window.masslessSign = { state: S, copyText };
boot().catch((e) => fail('Something went wrong', e.message || String(e)));
