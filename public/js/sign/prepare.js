// Office > Sign: prepare and send envelopes, track them, keep Deals, verify signed PDFs.
// Templates render to PDF in the browser (template.js); fields are placed by drag and drop or come from
// the template's [[markers]]. Create envelope encrypts everything here and uploads only ciphertext.

import * as T from '../pdf-tools.js';
import { el, toast } from '../ui.js';
import * as C from './crypto.js';
import { dryRun, createEnvelope as apiCreate, Envelope, SignError } from './api.js';
import { FIELD_TYPES, FIELD_ORDER, roleColor } from './fields.js';
import * as TPL from './template.js';
import { mountVerify } from './verify.js';
import { signerLinkCard, copyText, ICONS } from './delivery.js';
import { envelopes as localEnv, deals as localDeals } from './store.js';
import { mountDeals } from './deals.js';

const $ = (s, r = document) => r.querySelector(s);
const svg = (p) => `<svg viewBox="0 0 16 16" aria-hidden="true">${p}</svg>`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MAX_PER_PAGE = 50;
const MAX_SIGNERS = 10;
const MAX_BYTES = 10 * 1024 * 1024;
let n = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;

const COPY = {
  prepare: ['Send for<br>signature', 'Start from a contract template or your own PDF, place fields for each signer, then send. Everything is encrypted in this browser before it is uploaded.'],
  envelopes: ['Your<br>envelopes', 'Envelopes created on this device. Status comes from Chucksi; the links and keys stay here.'],
  deals: ['Deals', 'One place per deal: envelopes, documents, people and a checklist. Stored in this browser. Export it as an encrypted file to move it.'],
  verify: ['Verify a<br>signed PDF', 'Drop a final PDF. Its fingerprint is computed here and checked against the sealed record.'],
};

const P = {
  sv: 'prepare', mode: null, tpl: null, values: {}, omit: [], name: '', bytes: null, sizes: [],
  markers: [], overrides: {}, manual: [], signers: [], routing: 'sequential', message: '', from: '', dealId: '',
  active: 0, sel: null, zoom: 1, fit: true, armed: null, busy: false, index: null, cat: 'all', query: '', highlight: true,
  pdf: null, pages: [], sent: null,
};
let host = null;

// ======================================================================
// sub-views
// ======================================================================
export function initSign(h) {
  host = h;
  document.querySelectorAll('.sg-subnav [data-sv]').forEach((b) => b.addEventListener('click', () => setSv(b.dataset.sv)));
  $('#sign-go').addEventListener('click', goAction);
  const input = el('input', { type: 'file', id: 'sg-pdf-in', accept: 'application/pdf,.pdf', hidden: true });
  input.addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) openUpload(f); });
  document.body.append(input);
  renderSide();
  renderStage();
  refreshEnvCount();
  document.addEventListener('keydown', onKey);
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (P.pdf && P.fit && host.tab() === 'sign' && P.sv === 'prepare') fitZoom(); }, 150); });
  return { onShow, handleFiles, setSv, state: P, api: { openTemplate, openUploadBytes, createEnvelope, allFields, addField, setRouting, addSigner, setValue } };
}

function onShow() {
  setSv(P.sv);
  if (P.pdf && P.sv === 'prepare') requestAnimationFrame(() => (P.fit ? fitZoom() : null));
}

function setSv(sv) {
  P.sv = sv;
  document.querySelectorAll('.sg-subnav [data-sv]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sv === sv)));
  for (const k of ['prepare', 'envelopes', 'deals', 'verify']) {
    $(`#sv-${k}`).hidden = k !== sv;
    $(`#sg-${k}`).hidden = k !== sv;
  }
  host.setStage(...COPY[sv]);
  syncGo();
  if (sv === 'envelopes') renderEnvelopes();
  if (sv === 'deals') ensureDeals();
  if (sv === 'verify' && !verifyHandle) {
    verifyBox();
    $('#sv-verify').replaceChildren(
      el('div', { class: 'row-sel' }, el('span', {}, el('small', {}, 'What gets checked'), el('strong', {}, 'Fingerprint, seal and audit trail'))),
      el('p', { class: 'side-note' }, 'Verify computes the PDF\'s SHA-256 in this browser and sends only that number. Chucksi returns the sealed record, and this page checks the ES256 signature with the public key at /api/sign/key.'),
      el('p', { class: 'side-note' }, 'Re-saving, printing to PDF or editing a signed file changes its fingerprint, so it no longer verifies. Keep the file you downloaded.'),
      noticeEl());
  }
  if (sv === 'prepare' && P.pdf) requestAnimationFrame(() => (P.fit ? fitZoom() : null));
}

function syncGo() {
  const foot = $('#foot-sign');
  const go = $('#sign-go');
  const label = $('#sign-go-label');
  foot.hidden = host.tab() !== 'sign' || P.sv === 'verify';
  if (P.sv === 'prepare') {
    label.textContent = P.busy ? label.textContent : P.sent ? 'Start another' : 'Create envelope';
    go.disabled = P.busy || (!P.sent && !P.mode);
  } else if (P.sv === 'envelopes') { label.textContent = 'New envelope'; go.disabled = false; }
  else if (P.sv === 'deals') { label.textContent = 'New deal'; go.disabled = false; }
}
function goAction() {
  if (P.sv === 'prepare') return P.sent ? reset() : createEnvelope();
  if (P.sv === 'envelopes') { setSv('prepare'); return null; }
  if (P.sv === 'deals') return dealsApi?.newDeal();
  return null;
}

function handleFiles(list) {
  const pdf = list.find(T.isPdf);
  if (P.sv === 'verify') { if (pdf) verifyBox()?.run(pdf); return; }
  if (P.sv === 'deals') { dealsApi?.addFiles(list); return; }
  if (!pdf) { toast('Drop a PDF to send it for signature.', 'error'); return; }
  setSv('prepare');
  openUpload(pdf);
}
let verifyHandle = null;
function verifyBox() {
  if (!verifyHandle) { $('#sg-verify').replaceChildren(); verifyHandle = mountVerify($('#sg-verify')); }
  return verifyHandle;
}

const EXCLUDED = 'U.S. e-signature law (the ESIGN Act and UETA) does not cover wills, codicils and testamentary trusts; adoption, divorce and other family-law matters; court orders, notices and official court papers; notices of utility shutoff, default, foreclosure, eviction or repossession of a primary residence; cancellation of health or life insurance; product recall notices; and papers that must travel with hazardous materials. Deeds for recording, notarized or witnessed documents and some other instruments may need wet ink, a notary or a set process. Check before you send.';
const noticeEl = () => el('div', { class: 'side-note sg-legal-note' },
  el('span', { html: svg('<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4M8 4.8v.2"/>') }),
  el('span', {}, 'Chucksi Sign provides templates and signing tools, not legal advice. ',
    el('details', { class: 'sg-excl-d' }, el('summary', {}, 'Documents it should not be used for'), el('span', {}, EXCLUDED))));

// ======================================================================
// documents
// ======================================================================
async function openTemplate(id) {
  let tpl;
  try { tpl = await TPL.loadTemplate(id); } catch (e) { toast(e.message, 'error'); return false; }
  P.mode = 'template';
  P.tpl = tpl;
  P.values = TPL.initialValues(tpl);
  P.omit = [];
  P.overrides = {};
  P.manual = [];
  P.sent = null;
  P.signers = tpl.roles.map((r) => {
    const v = TPL.roleVariable(tpl, r.id);
    return { uid: uid('p'), name: v ? String(P.values[v.id] || '') : '', email: '', role: r.id, roleLabel: r.label, fixed: true, nameAuto: true };
  });
  if (!P.signers.length) P.signers = [{ uid: uid('p'), name: '', email: '', role: 's1', roleLabel: 'Signer 1', nameAuto: false }];
  P.active = 0;
  P.sel = null;
  renderSide();
  await renderPreview();
  host.setSrc(`${tpl.title} · template ${tpl.id} v${tpl.version} · on this device`);
  return true;
}

async function openUpload(file) {
  if (!T.isPdf(file)) { toast('Choose a PDF file.', 'error'); return; }
  if (file.size > MAX_BYTES - 200 * 1024) { toast('That PDF is over 10 MB. Compress it in Convert first.', 'error'); return; }
  await openUploadBytes(file.name, new Uint8Array(await file.arrayBuffer()));
}
async function openUploadBytes(name, bytes) {
  try {
    const lib = await T.loadPdfLib();
    await lib.PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    toast(/encrypt/i.test(String(e.message)) ? 'This PDF is password protected. Remove the password first.' : "This file doesn't look like a PDF we can sign.", 'error');
    return false;
  }
  P.mode = 'upload';
  P.tpl = null;
  P.values = {};
  P.markers = [];
  P.overrides = {};
  P.manual = [];
  P.sent = null;
  P.name = name;
  P.bytes = bytes;
  if (!P.signers.length || P.signers.some((s) => s.fixed)) P.signers = [{ uid: uid('p'), name: '', email: '', role: 's1', roleLabel: 'Signer 1' }];
  P.active = 0;
  P.sel = null;
  renderSide();
  await loadPdf(bytes);
  host.setSrc(`${name} · ${P.pages.length} page${P.pages.length === 1 ? '' : 's'} · on this device`);
  toast('Pick a signer, then drag fields onto the pages.');
  return true;
}

function reset() {
  if ((P.manual.length || P.mode) && !P.sent && !confirm('Start over? The fields you placed will be lost.')) return;
  P.mode = null; P.tpl = null; P.bytes = null; P.markers = []; P.manual = []; P.overrides = {}; P.sent = null; P.sel = null;
  P.signers = []; P.message = ''; P.from = P.from || ''; P.dealId = '';
  if (P.pdf) { T.closePdf(P.pdf); P.pdf = null; }
  P.pages = [];
  host.setSrc('pdf.js and pdf-lib · load on first use');
  renderSide();
  renderStage();
}

// ---------- template preview ----------
let rendering = null, again = false;
function partiesMap() {
  const out = {};
  for (const s of P.signers) if (s.name) out[s.role] = s.name;
  return out;
}
async function renderPreview() {
  if (P.mode !== 'template') return;
  if (rendering) { again = true; return; }
  rendering = (async () => {
    const lib = await T.loadPdfLib();
    const r = await TPL.renderTemplate(lib, P.tpl, P.values, { preview: P.highlight, omit: P.omit, parties: partiesMap() });
    P.markers = r.fields;
    P.bytes = r.bytes;
    P.name = r.name;
    await loadPdf(r.bytes);
  })();
  try { await rendering; } catch (e) { toast(`Preview failed: ${e.message}`, 'error'); }
  rendering = null;
  if (again) { again = false; await renderPreview(); }
}
let previewTimer;
const schedulePreview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(renderPreview, 280); };

// ======================================================================
// side panel
// ======================================================================
function renderSide() {
  const box = $('#sv-prepare');
  const kids = [];
  if (P.sent) {
    kids.push(
      el('div', { class: 'row-sel' }, el('span', {}, el('small', {}, 'Envelope created'), el('strong', {}, P.sent.name))),
      el('p', { class: 'side-note' }, 'Send each signer their link. Keep your manage link private: it opens the envelope and the audit trail.'),
      el('button', { type: 'button', class: 'btn-ghost wide', onclick: () => setSv('envelopes') }, 'See all envelopes'),
      noticeEl());
    box.replaceChildren(...kids);
    syncGo();
    return;
  }
  const docName = P.mode === 'template' ? P.tpl.title : P.mode === 'upload' ? P.name : 'No document yet';
  kids.push(el('div', { class: 'row-sel sg-docrow' },
    el('span', {}, el('small', {}, P.mode === 'template' ? `Template · v${P.tpl.version}${P.tpl.jurisdiction ? ` · ${P.tpl.jurisdiction}` : ''}` : 'Document'), el('strong', { id: 'sg-docname' }, docName)),
    P.mode ? el('button', { type: 'button', class: 'btn-ghost small', onclick: reset }, 'Change') : el('label', { class: 'btn-ghost small', for: 'sg-pdf-in' }, 'Upload PDF')));
  kids.push(noticeEl());
  if (!P.mode) {
    kids.push(el('p', { class: 'side-note' }, 'Pick a contract template on the right and fill in the details, or upload any PDF and place the fields yourself.'));
    kids.push(el('ol', { class: 'sg-howto' },
      el('li', {}, el('strong', {}, 'Choose'), ' a template or your own PDF.'),
      el('li', {}, el('strong', {}, 'Fill in'), ' the details and add signers.'),
      el('li', {}, el('strong', {}, 'Place fields'), ' by dragging them onto the pages.'),
      el('li', {}, el('strong', {}, 'Create'), ' the envelope and share each signer\'s link.')));
  }
  if (P.mode === 'template') kids.push(aboutEl(), el('div', { id: 'sg-state-notes' }), detailsEl());
  if (P.mode) kids.push(signersEl(), messageEl());
  box.replaceChildren(...kids);
  syncGo();
}

function aboutEl() {
  const t = P.tpl;
  const d = el('details', { class: 'adv sg-about' }, el('summary', {}, 'About this template', el('span', { class: 'muted' }, TPL.CATEGORIES[t.category] || '')));
  if (t.summary) d.append(el('p', {}, t.summary));
  if (t.useWhen) d.append(el('p', {}, el('strong', {}, 'Use it when: '), t.useWhen));
  if (t.watchOuts?.length) d.append(el('p', {}, el('strong', {}, 'Watch out for:')), el('ul', {}, ...t.watchOuts.map((w) => el('li', {}, w))));
  if (t.stateAware) d.append(el('p', { class: 'warnline' }, 'Rules differ by state. Check the governing state\'s requirements.'));
  if (t.sources?.length) d.append(el('p', {}, el('strong', {}, 'Sources: '), ...t.sources.flatMap((s, i) => [i ? ', ' : '', el('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title)])));
  d.append(el('p', { class: 'muted small' }, [t.license && `License ${t.license}`, t.lastReviewed && `reviewed ${t.lastReviewed}`].filter(Boolean).join(' · ')));
  return d;
}

function detailsEl() {
  const t = P.tpl;
  const wrap = el('div', { class: 'stack sg-details' });
  const head = el('div', { class: 'sg-side-h' }, el('h3', {}, 'Details'), el('output', { id: 'sg-missing' }));
  wrap.append(head);
  for (const x of t.variables) wrap.append(varInput(x));
  const opt = t.sections.filter((s) => s.optional);
  if (opt.length) {
    wrap.append(el('div', { class: 'sg-side-h' }, el('h3', {}, 'Optional sections')));
    for (const s of opt) {
      const cb = el('input', { type: 'checkbox', checked: !P.omit.includes(s.id) || null });
      cb.addEventListener('change', () => { P.omit = cb.checked ? P.omit.filter((id) => id !== s.id) : [...P.omit, s.id]; schedulePreview(); });
      wrap.append(el('label', { class: 'check' }, cb, el('span', {}, el('strong', {}, s.title.replace(/^\s*\d+[.)]?\s*/, '')), s.showIf ? el('small', {}, 'Shown only when its condition is met') : null)));
    }
  }
  const hl = el('input', { type: 'checkbox', checked: P.highlight || null });
  hl.addEventListener('change', () => { P.highlight = hl.checked; renderPreview(); });
  wrap.append(el('label', { class: 'check' }, hl, el('span', {}, el('strong', {}, 'Highlight filled-in details'), el('small', {}, 'Preview only. The sent PDF has no highlights.'))));
  requestAnimationFrame(() => { syncMissing(); syncStateNotes(); });
  return wrap;
}

function syncMissing() {
  if (P.mode !== 'template') return;
  const miss = TPL.missingRequired(P.tpl, P.values, P.omit);
  const out = $('#sg-missing');
  if (out) { out.textContent = miss.length ? `${miss.length} required left` : 'All set'; out.classList.toggle('ok', !miss.length); }
  document.querySelectorAll('.sg-var').forEach((n) => n.classList.toggle('missing', miss.some((m) => m.id === n.dataset.var)));
}

// State notes from the contract library (states.json): e-signature and notarization rules first.
const STATE_LABELS = { eSignatureAndNotarization: 'E-signatures and notarization', sellerDisclosure: 'Seller disclosure', purchaseContractForms: 'Purchase contract forms', closingPractice: 'Closing', executoryContracts: 'Contracts for deed and lease-options', wholesaling: 'Wholesaling', landlordTenant: 'Landlord and tenant' };
let statesP = null;
const stateVar = () => P.tpl?.variables.find((x) => x.id === 'state' || x.id === 'property_state' || x.id === 'governing_state');
async function syncStateNotes() {
  const box = $('#sg-state-notes');
  if (!box) return;
  const sv = stateVar();
  const code = sv && String(P.values[sv.id] || '').toUpperCase();
  if (!P.tpl?.stateAware || !code) { box.replaceChildren(); return; }
  statesP ||= fetch(`${TPL.CONTRACTS_BASE}states.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const data = await statesP;
  const st = data?.states?.[code];
  if (!st) { box.replaceChildren(); return; }
  const keys = Object.keys(STATE_LABELS).filter((k) => st[k]);
  const d = el('details', { class: 'adv sg-about sg-state' }, el('summary', {}, `State notes: ${st.name}`, el('span', { class: 'muted' }, `checked ${st.lastChecked || data.lastChecked || ''}`)));
  for (const k of keys) {
    const v = st[k];
    const head = [v.status, v.type, v.ueta, v.ron, v.statute, v.law, v.citation].filter(Boolean).join(' · ');
    d.append(el('p', {}, el('strong', {}, `${STATE_LABELS[k]}: `), head ? `${head}. ` : '', v.note || v.summary || ''));
    if (v.sources?.length) d.append(el('p', { class: 'small' }, ...v.sources.slice(0, 2).flatMap((x, i) => [i ? ' · ' : '', el('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.title)])));
  }
  d.append(el('p', { class: 'muted small' }, data.disclaimer || 'Summaries, not legal advice. Check the sources.'));
  box.replaceChildren(d);
}

function setValue(id, v) {
  P.values[id] = v;
  if (stateVar()?.id === id) syncStateNotes();
  const x = P.tpl?.variables.find((y) => y.id === id);
  if (x && P.tpl) {
    const role = P.tpl.roles.find((r) => TPL.roleVariable(P.tpl, r.id)?.id === id);
    const s = role && P.signers.find((p) => p.role === role.id);
    if (s && s.nameAuto) { s.name = String(v || ''); const inp = document.querySelector(`.sg-srow[data-uid="${s.uid}"] .sg-sname`); if (inp) inp.value = s.name; syncRolePick(); }
  }
  syncMissing();
  schedulePreview();
}

function varInput(x) {
  const id = `sgv-${x.id}`;
  const label = el('span', {}, x.label, x.required ? el('b', { class: 'req', 'aria-hidden': 'true' }, ' *') : null);
  const val = P.values[x.id];
  let input;
  if (x.type === 'bool') {
    input = el('input', { type: 'checkbox', id, checked: val === true || null });
    input.addEventListener('change', () => setValue(x.id, input.checked));
    return el('label', { class: 'check sg-var', 'data-var': x.id }, input, el('span', {}, el('strong', {}, x.label), x.help ? el('small', {}, x.help) : null));
  }
  if (x.type === 'select') {
    input = el('select', { id }, x.required ? null : el('option', { value: '' }, '—'), ...TPL.options(x).map((o) => el('option', { value: o.value }, o.label)));
    input.value = val ?? '';
  } else if (x.type === 'longtext' || x.type === 'address') {
    input = el('textarea', { id, rows: x.type === 'address' ? 2 : 3, maxlength: 2000 });
    input.value = val ?? '';
  } else {
    const type = x.type === 'date' ? 'date' : x.type === 'email' ? 'email' : 'text';
    input = el('input', { type, id, maxlength: 300, inputmode: ['money', 'number', 'percent'].includes(x.type) ? 'decimal' : null, autocomplete: 'off', spellcheck: x.type === 'text' || x.type === 'party' ? 'true' : 'false', placeholder: x.type === 'party' ? 'Full legal name' : x.type === 'money' ? '0.00' : x.type === 'percent' ? '0' : '' });
    input.value = val ?? '';
  }
  input.classList.add('sg-vin');
  input.setAttribute('aria-label', x.label);
  input.addEventListener('input', () => setValue(x.id, input.value));
  const affix = x.type === 'money' ? el('span', { class: 'sg-affix' }, '$') : x.type === 'percent' ? el('span', { class: 'sg-affix r' }, '%') : null;
  return el('div', { class: `field sg-var t-${x.type}`, 'data-var': x.id },
    el('label', { class: 'f-head', for: id }, label),
    el('div', { class: `sg-vwrap${affix ? (x.type === 'percent' ? ' suf' : ' pre') : ''}` }, affix, input),
    x.help ? el('small', { class: 'sg-help' }, x.help) : null);
}

function signersEl() {
  const wrap = el('div', { class: 'stack', id: 'sg-signers-box' });
  wrap.append(el('div', { class: 'sg-side-h' }, el('h3', {}, 'Signers'), el('output', {}, `${P.signers.length} of ${MAX_SIGNERS}`)));
  const routing = el('div', { class: 'groups sg-routing', role: 'radiogroup', 'aria-label': 'Signing order' },
    ...[['sequential', 'One after another'], ['parallel', 'All at once']].map(([k, l]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(P.routing === k), 'aria-selected': String(P.routing === k), 'data-routing': k, onclick: () => setRouting(k) }, l)));
  wrap.append(routing);
  const list = el('ol', { class: 'sg-signers' });
  P.signers.forEach((s, i) => list.append(signerRow(s, i)));
  wrap.append(list);
  if (P.mode === 'template') {
    for (const r of P.tpl.roles) if (!P.signers.some((s) => s.role === r.id)) {
      wrap.append(el('button', { type: 'button', class: 'btn-ghost wide sg-unassigned', onclick: () => { P.signers.push({ uid: uid('p'), name: '', email: '', role: r.id, roleLabel: r.label, fixed: true, nameAuto: true }); renderSide(); drawOverlays(); } }, `Add a signer for ${r.label}`));
    }
  }
  wrap.append(el('button', { type: 'button', class: 'btn-ghost wide', id: 'sg-add-signer', disabled: P.signers.length >= MAX_SIGNERS || null, html: `${svg('<path d="M8 3v10M3 8h10"/>')}<span>Add signer</span>`, onclick: () => addSigner() }));
  wrap.append(el('p', { class: 'side-note' }, P.routing === 'sequential' ? 'Each signer can sign only after the ones above have signed. Chucksi enforces the order.' : 'Everyone can sign at the same time, in any order.'));
  return wrap;
}

function setRouting(k) { P.routing = k; renderSide(); drawOverlays(); }

function addSigner(name = '', email = '') {
  if (P.signers.length >= MAX_SIGNERS) { toast(`An envelope can have up to ${MAX_SIGNERS} signers.`, 'error'); return null; }
  let k = P.signers.length + 1;
  while (P.signers.some((s) => s.role === `s${k}`)) k++;
  const s = { uid: uid('p'), name, email, role: `s${k}`, roleLabel: P.mode === 'template' ? '' : `Signer ${k}`, custom: true };
  P.signers.push(s);
  P.active = P.signers.length - 1;
  renderSide();
  syncRolePick();
  return s;
}

function signerRow(s, i) {
  const color = roleColor(i);
  const row = el('li', { class: `sg-srow${P.active === i ? ' on' : ''}`, 'data-uid': s.uid });
  row.style.setProperty('--c', color);
  const name = el('input', { type: 'text', class: 'sg-sname', placeholder: 'Full name', value: s.name, maxlength: 80, 'aria-label': `Signer ${i + 1} name`, autocomplete: 'off' });
  name.addEventListener('input', () => {
    s.name = name.value; s.nameAuto = false;
    if (P.mode === 'template') {
      const v = TPL.roleVariable(P.tpl, s.role);
      if (v && (!P.values[v.id] || P.values[v.id] === s._lastSync)) { P.values[v.id] = s.name; s._lastSync = s.name; const vi = $(`#sgv-${CSS.escape(v.id)}`); if (vi) vi.value = s.name; syncMissing(); }
      schedulePreview();
    }
    syncRolePick();
    drawOverlays();
  });
  const email = el('input', { type: 'email', class: 'sg-semail', placeholder: 'Email (optional)', value: s.email, maxlength: 120, 'aria-label': `Signer ${i + 1} email`, autocomplete: 'off' });
  email.addEventListener('input', () => { s.email = email.value.trim(); });
  let role;
  if (s.fixed) role = el('span', { class: 'sg-rolefix' }, s.roleLabel);
  else {
    role = el('input', { type: 'text', class: 'sg-srole', placeholder: 'Role, e.g. Witness', value: s.roleLabel, maxlength: 60, 'aria-label': `Signer ${i + 1} role` });
    role.addEventListener('input', () => { s.roleLabel = role.value; syncRolePick(); });
  }
  const ctl = (label, html, fn, dis) => el('button', { type: 'button', 'aria-label': label, title: label, html, onclick: fn, disabled: dis || null });
  row.append(
    el('button', { type: 'button', class: 'sg-dot', title: 'Place fields for this signer', 'aria-label': `Place fields for signer ${i + 1}`, onclick: () => { P.active = i; renderSide(); syncRolePick(); } }, P.routing === 'sequential' ? String(i + 1) : '•'),
    el('div', { class: 'sg-sfields' }, name, email, role),
    el('div', { class: 'sg-sctl' },
      ctl('Move up', '↑', () => moveSigner(i, -1), i === 0),
      ctl('Move down', '↓', () => moveSigner(i, 1), i === P.signers.length - 1),
      ctl('Remove signer', '×', () => removeSigner(i))));
  return row;
}
function moveSigner(i, d) {
  const j = i + d;
  if (j < 0 || j >= P.signers.length) return;
  [P.signers[i], P.signers[j]] = [P.signers[j], P.signers[i]];
  if (P.active === i) P.active = j; else if (P.active === j) P.active = i;
  renderSide(); syncRolePick(); drawOverlays();
}
function removeSigner(i) {
  const s = P.signers[i];
  const count = allFields().filter((f) => f.role === s.role).length;
  if (count && !confirm(`Remove ${s.name || `signer ${i + 1}`}? Their ${count} field${count === 1 ? '' : 's'} will have no signer.`)) return;
  P.signers.splice(i, 1);
  if (s.custom) P.manual = P.manual.filter((f) => f.role !== s.role);
  P.active = Math.max(0, Math.min(P.active, P.signers.length - 1));
  renderSide(); syncRolePick(); drawOverlays();
}

function messageEl() {
  const msg = el('textarea', { id: 'sg-message', rows: 3, maxlength: 1000, placeholder: 'Add a short note for signers (optional)', 'aria-label': 'Message to signers' });
  msg.value = P.message;
  msg.addEventListener('input', () => { P.message = msg.value; });
  const from = el('input', { type: 'text', id: 'sg-from', class: 'text-in sg-ti', maxlength: 80, placeholder: 'Your name (optional)', 'aria-label': 'Your name', value: P.from });
  from.addEventListener('input', () => { P.from = from.value; });
  const deal = el('select', { id: 'sg-deal', 'aria-label': 'Add to a deal' }, el('option', { value: '' }, 'No deal'));
  localDeals.all().then((ds) => { for (const d of ds) deal.append(el('option', { value: d.id }, d.title)); deal.value = P.dealId || ''; }).catch(() => {});
  deal.addEventListener('change', () => { P.dealId = deal.value; });
  return el('div', { class: 'stack' },
    el('div', { class: 'sg-side-h' }, el('h3', {}, 'Message')),
    el('div', { class: 'field' }, el('div', { class: 'f-head' }, el('span', {}, 'From')), from),
    el('div', { class: 'field' }, el('div', { class: 'f-head' }, el('span', {}, 'Note to signers')), msg),
    el('label', { class: 'row-sel sel' }, el('small', {}, 'Deal'), deal));
}

// ======================================================================
// stage: gallery or editor
// ======================================================================
function renderStage() {
  const box = $('#sg-prepare');
  if (P.sent) { box.replaceChildren(sentView()); return; }
  if (!P.mode) { box.replaceChildren(gallery()); loadGallery(); return; }
  box.replaceChildren(editor());
}

function gallery() {
  const g = el('div', { class: 'sg-gallery' });
  const search = el('input', { type: 'search', class: 'sg-search', placeholder: 'Search templates', 'aria-label': 'Search templates', value: P.query });
  search.addEventListener('input', () => { P.query = search.value; drawCards(); });
  g.append(el('div', { class: 'sg-gtop' }, search, el('div', { class: 'groups sg-cats', role: 'tablist', 'aria-label': 'Template category', id: 'sg-cats' })), el('div', { class: 'sg-gal', id: 'sg-gal' }));
  return g;
}
async function loadGallery() {
  if (!P.index) {
    try { P.index = await TPL.loadIndex(); } catch { P.index = []; P.indexError = true; }
  }
  drawCards();
}
function drawCards() {
  const gal = $('#sg-gal');
  if (!gal) return;
  const cats = ['all', ...Object.keys(TPL.CATEGORIES).filter((c) => (P.index || []).some((t) => t.category === c))];
  $('#sg-cats').replaceChildren(...cats.map((c) => el('button', { type: 'button', role: 'tab', 'aria-selected': String(P.cat === c), onclick: () => { P.cat = c; drawCards(); } }, c === 'all' ? 'All' : TPL.CATEGORIES[c])));
  const q = P.query.trim().toLowerCase();
  const list = (P.index || []).filter((t) => (P.cat === 'all' || t.category === P.cat) && (!q || `${t.title} ${t.summary} ${(t.tags || []).join(' ')}`.toLowerCase().includes(q)));
  const upload = el('label', { class: 'sg-tcard upload', for: 'sg-pdf-in', html: `<span class="sg-tico">${svg('<path d="M4 1.5h5.5l3 3v10h-8.5z"/><path d="M9.5 1.5v3h3M8.5 12V7.5M6.5 9.5l2-2 2 2"/>')}</span><strong>Upload a PDF</strong><span class="muted">Your own contract or form. Place the fields by hand.</span><span class="sg-tuse">Choose file →</span>` });
  const cards = list.map((t) => {
    const b = el('button', { type: 'button', class: 'sg-tcard', 'data-template': t.id, html: `<span class="sg-tcat c-${esc(t.category)}">${esc(TPL.CATEGORIES[t.category] || t.category || 'Template')}</span><strong>${esc(t.title)}</strong><span class="muted">${esc(t.summary || '')}</span>${t.tags?.length ? `<span class="sg-ttags">${t.tags.slice(0, 4).map((x) => `<i>${esc(x)}</i>`).join('')}</span>` : ''}<span class="sg-tuse">Use template →</span>` });
    b.addEventListener('click', async () => { b.classList.add('loading'); await openTemplate(t.id); b.classList.remove('loading'); });
    return b;
  });
  gal.replaceChildren(upload, ...cards);
  if (!list.length) gal.append(el('p', { class: 'muted sg-empty' }, P.indexError ? 'The contract library is not available yet. Upload a PDF to send it for signature.' : 'No templates match. Try another word, or upload a PDF.'));
}

function editor() {
  const wrap = el('div', { class: 'sg-editor' });
  const pal = el('div', { class: 'tool-group sg-palette', role: 'toolbar', 'aria-label': 'Fields' });
  for (const t of FIELD_ORDER) {
    const def = FIELD_TYPES[t];
    const b = el('button', { type: 'button', class: 'tbtn sg-pal', 'data-type': t, title: `${def.label}: drag onto a page, or click then click a page`, 'aria-label': `${def.label} field`, html: `${svg(def.icon)}<span>${t === 'date' ? 'Date' : t === 'attachment' ? 'Attach' : def.label}</span>` });
    bindPalette(b, t);
    pal.append(b);
  }
  const rolePick = el('label', { class: 'sg-rolepick', id: 'sg-rolepick' }, el('span', { class: 'sg-rdot', 'aria-hidden': 'true' }), el('select', { id: 'sg-role', 'aria-label': 'Place fields for' }));
  rolePick.querySelector('select').addEventListener('change', (e) => { P.active = Number(e.target.value); renderSide(); syncRolePick(); });
  const tools = el('div', { class: 'tools sg-tools' },
    el('div', { class: 'tool-group' }, el('span', { class: 'sg-for' }, 'For'), rolePick),
    pal,
    el('div', { class: 'tool-group right' },
      el('button', { type: 'button', class: 'tbtn icon', 'aria-label': 'Zoom out', html: svg('<path d="M4 8h8"/>'), onclick: () => setZoom(P.zoom / 1.2) }),
      el('output', { class: 'zoom', id: 'sg-zoom', ondblclick: fitZoom }, '100%'),
      el('button', { type: 'button', class: 'tbtn icon', 'aria-label': 'Zoom in', html: svg('<path d="M4 8h8M8 4v8"/>'), onclick: () => setZoom(P.zoom * 1.2) })));
  wrap.append(el('div', { class: 'sg-sticky' }, tools, el('div', { class: 'sg-inspector', id: 'sg-insp', hidden: true })), el('div', { class: 'pages sg-ppages', id: 'sg-pages' }));
  requestAnimationFrame(() => { syncRolePick(); if (P.pdf) buildPages(); });
  return wrap;
}

function syncRolePick() {
  const sel = $('#sg-role');
  if (!sel) return;
  sel.replaceChildren(...P.signers.map((s, i) => el('option', { value: i }, `${s.name || s.roleLabel || `Signer ${i + 1}`}${s.name && s.roleLabel ? ` · ${s.roleLabel}` : ''}`)));
  sel.value = String(P.active);
  $('#sg-rolepick').style.setProperty('--c', roleColor(P.active));
  document.querySelectorAll('.sg-pal').forEach((b) => b.style.setProperty('--c', roleColor(P.active)));
}

// ---------- pdf pages ----------
async function loadPdf(bytes) {
  const pdf = await T.openPdfjs(bytes);
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    pages.push({ page, vp: page.getViewport({ scale: 1 }) });
  }
  const same = P.pages.length === pages.length && P.pages.every((p, i) => Math.abs(p.vp.width - pages[i].vp.width) < 0.5 && Math.abs(p.vp.height - pages[i].vp.height) < 0.5);
  const old = P.pdf;
  P.pdf = pdf;
  P.sizes = pages.map((p) => ({ w: p.vp.width, h: p.vp.height }));
  if (same && $('#sg-pages')?.childElementCount) {
    pages.forEach((p, i) => { Object.assign(P.pages[i], { page: p.page, vp: p.vp, rz: 0, wantZ: 0 }); });
    P.pages.forEach((pg) => pg.visible && paint(pg));
    drawOverlays();
  } else {
    P.pages = pages;
    renderStage();
  }
  if (old) T.closePdf(old);
}

let io;
function buildPages() {
  const box = $('#sg-pages');
  if (!box) return;
  box.replaceChildren();
  io?.disconnect();
  io = new IntersectionObserver((es) => es.forEach((e) => { const pg = P.pages[Number(e.target.dataset.page)]; if (!pg) return; pg.visible = e.isIntersecting; if (e.isIntersecting) paint(pg); }), { rootMargin: '700px 0px' });
  P.pages.forEach((pg, i) => {
    pg.canvas = el('canvas', { 'aria-hidden': 'true' });
    pg.ov = el('div', { class: 'ov sg-pov', 'data-page': i });
    pg.wrap = el('div', { class: 'pg', 'data-page': i, role: 'group', 'aria-label': `Page ${i + 1}` }, pg.canvas, pg.ov, el('span', { class: 'pg-no', 'aria-hidden': 'true' }, String(i + 1)));
    pg.rz = 0;
    bindOverlay(pg.ov, i);
    box.append(pg.wrap);
    io.observe(pg.wrap);
  });
  fitZoom();
}
function fitZoom() {
  const box = $('#sg-pages');
  if (!box || !P.pages.length) return;
  const avail = Math.max(240, box.clientWidth - 24);
  setZoom(Math.min(1.25, avail / Math.max(...P.pages.map((p) => p.vp.width))), true);
}
function setZoom(z, fit = false) {
  P.zoom = Math.max(0.3, Math.min(3, Math.round(z * 100) / 100));
  P.fit = fit;
  const out = $('#sg-zoom');
  if (out) out.textContent = `${Math.round(P.zoom * 100)}%`;
  for (const pg of P.pages) {
    if (!pg.wrap) continue;
    pg.wrap.style.width = `${pg.vp.width * P.zoom}px`;
    pg.wrap.style.height = `${pg.vp.height * P.zoom}px`;
  }
  drawOverlays();
  P.pages.forEach((pg) => pg.visible && paint(pg));
}
async function paint(pg) {
  const z = P.zoom;
  if (!pg.wrap || pg.rz === z || pg.wantZ === z) return;
  pg.wantZ = z;
  pg.task?.cancel();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const viewport = pg.page.getViewport({ scale: z * dpr });
  const c = el('canvas', { 'aria-hidden': 'true' });
  c.width = Math.max(1, Math.floor(viewport.width)); c.height = Math.max(1, Math.floor(viewport.height));
  const task = pg.page.render({ canvas: c, viewport });
  pg.task = task;
  try { await task.promise; } catch { if (pg.wantZ === z) pg.wantZ = 0; return; }
  if (pg.wantZ !== z) return;
  pg.canvas.replaceWith(c);
  pg.canvas = c;
  pg.rz = z;
  pg.wantZ = 0;
}

// ---------- fields ----------
function allFields() {
  const out = [];
  for (const m of P.markers) {
    const o = P.overrides[m.id] || {};
    if (o.removed) continue;
    out.push({ ...m, ...o, id: m.id, source: 'template' });
  }
  return out.concat(P.manual);
}
const signerIndexForRole = (role) => P.signers.findIndex((s) => s.role === role);
function findField(id) { return P.manual.find((f) => f.id === id) || allFields().find((f) => f.id === id); }
function patchField(id, patch) {
  const m = P.manual.find((f) => f.id === id);
  if (m) Object.assign(m, patch);
  else P.overrides[id] = { ...(P.overrides[id] || {}), ...patch };
}

function addField(type, page, x, y, opts = {}) {
  const def = FIELD_TYPES[type];
  const s = P.signers[P.active];
  if (!s) { toast('Add a signer first.', 'error'); return null; }
  if (allFields().filter((f) => f.page === page).length >= MAX_PER_PAGE) { toast(`A page can hold up to ${MAX_PER_PAGE} fields.`, 'error'); return null; }
  const size = P.sizes[page];
  const w = opts.w || def.w, h = opts.h || def.h;
  const f = {
    id: uid('f'), type, role: s.role, page,
    x: Math.max(0, Math.min(size.w - w, x)), y: Math.max(0, Math.min(size.h - h, y)), w, h,
    required: opts.required ?? def.required, label: opts.label || (type === 'text' ? 'Text' : type === 'dropdown' ? 'Choose one' : type === 'attachment' ? 'Attachment' : type === 'checkbox' ? '' : ''),
    options: type === 'dropdown' ? ['Option 1', 'Option 2'] : undefined, source: 'manual',
  };
  P.manual.push(f);
  P.sel = f.id;
  drawOverlays();
  return f;
}

function fieldEl(f) {
  const i = signerIndexForRole(f.role);
  const s = P.signers[i];
  const def = FIELD_TYPES[f.type];
  const z = P.zoom;
  const n = el('div', { class: `pf t-${f.type}${P.sel === f.id ? ' sel' : ''}${i < 0 ? ' orphan' : ''}`, 'data-id': f.id, title: `${def.label}${s ? ` · ${s.name || s.roleLabel}` : ' · no signer'}` });
  n.style.setProperty('--c', i < 0 ? '#9b9ba2' : roleColor(i));
  Object.assign(n.style, { left: `${f.x * z}px`, top: `${f.y * z}px`, width: `${f.w * z}px`, height: `${f.h * z}px` });
  if (f.type !== 'checkbox') n.append(el('span', { class: 'pf-l', html: `${svg(def.icon)}<span>${esc(f.type === 'text' || f.type === 'dropdown' ? (f.label || def.short) : def.short)}${f.required ? '*' : ''}</span>` }));
  if (P.sel === f.id) n.append(el('span', { class: 'rh', 'aria-hidden': 'true' }));
  return n;
}
function drawOverlays() {
  const fields = allFields();
  P.pages.forEach((pg, i) => { if (pg.ov) pg.ov.replaceChildren(...fields.filter((f) => f.page === i).map(fieldEl)); });
  inspector();
}

function inspector() {
  const box = $('#sg-insp');
  if (!box) return;
  const f = P.sel && findField(P.sel);
  if (!f) { box.hidden = true; box.replaceChildren(); return; }
  box.hidden = false;
  const def = FIELD_TYPES[f.type];
  const who = el('select', { 'aria-label': 'Signer for this field' }, ...P.signers.map((s, i) => el('option', { value: s.role }, s.name || s.roleLabel || `Signer ${i + 1}`)));
  if (signerIndexForRole(f.role) < 0) who.prepend(el('option', { value: f.role }, 'No signer'));
  who.value = f.role;
  who.addEventListener('change', () => { patchField(f.id, { role: who.value }); drawOverlays(); });
  const req = el('input', { type: 'checkbox', checked: f.required || null });
  req.addEventListener('change', () => { patchField(f.id, { required: req.checked }); drawOverlays(); });
  const kids = [el('strong', { class: 'sg-itype', html: `${svg(def.icon)}<span>${def.label}</span>` }), el('label', {}, el('span', {}, 'Signer'), who)];
  if (f.type !== 'date') kids.push(el('label', { class: 'sg-ichk' }, req, el('span', {}, 'Required')));
  if (['text', 'checkbox', 'dropdown', 'attachment'].includes(f.type)) {
    const lab = el('input', { type: 'text', value: f.label || '', maxlength: 60, placeholder: 'Label', 'aria-label': 'Field label' });
    lab.addEventListener('input', () => { patchField(f.id, { label: lab.value }); const l = document.querySelector(`.pf[data-id="${CSS.escape(f.id)}"] .pf-l span`); if (l && f.type !== 'checkbox') l.textContent = (lab.value || def.short) + (findField(f.id).required ? '*' : ''); });
    kids.push(el('label', {}, el('span', {}, 'Label'), lab));
  }
  if (f.type === 'dropdown') {
    const opts = el('input', { type: 'text', value: (f.options || []).join(', '), maxlength: 400, placeholder: 'Choices, comma-separated', 'aria-label': 'Dropdown choices' });
    opts.addEventListener('change', () => patchField(f.id, { options: opts.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 30) }));
    kids.push(el('label', { class: 'wide' }, el('span', {}, 'Choices'), opts));
  }
  kids.push(el('button', { type: 'button', class: 'tbtn sg-idel', html: `${svg('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9"/>')}<span>Delete</span>`, onclick: () => removeField(f.id) }));
  box.replaceChildren(...kids);
}
function removeField(id) {
  if (P.manual.some((f) => f.id === id)) P.manual = P.manual.filter((f) => f.id !== id);
  else P.overrides[id] = { ...(P.overrides[id] || {}), removed: true };
  if (P.sel === id) P.sel = null;
  drawOverlays();
}

// ---------- pointer: palette drag, place, move, resize ----------
function drag(onMove, onUp) {
  const move = (e) => { e.preventDefault(); onMove(e); };
  const up = (e) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onUp(e);
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
function bindPalette(b, type) {
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const def = FIELD_TYPES[type];
    const z = P.zoom;
    let ghost = null;
    const x0 = e.clientX, y0 = e.clientY;
    drag((ev) => {
      if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      if (!ghost) {
        ghost = el('div', { class: `pf ghost t-${type}`, html: `<span class="pf-l">${svg(def.icon)}<span>${def.short}</span></span>` });
        ghost.style.setProperty('--c', roleColor(P.active));
        Object.assign(ghost.style, { width: `${def.w * z}px`, height: `${def.h * z}px` });
        document.body.append(ghost);
      }
      ghost.style.transform = `translate(${ev.clientX - (def.w * z) / 2}px, ${ev.clientY - (def.h * z) / 2}px)`;
    }, (ev) => {
      if (!ghost) { arm(type); return; }
      ghost.remove();
      const ov = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n.classList?.contains('sg-pov'));
      if (!ov) return;
      const r = ov.getBoundingClientRect();
      addField(type, Number(ov.dataset.page), (ev.clientX - r.left) / z - def.w / 2, (ev.clientY - r.top) / z - def.h / 2);
    });
  });
}
function arm(type) {
  P.armed = P.armed === type ? null : type;
  document.querySelectorAll('.sg-pal').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === P.armed)));
  $('#sg-pages')?.classList.toggle('armed', !!P.armed);
  if (P.armed) toast(`Click a page to place ${FIELD_TYPES[type].label.toLowerCase()}.`);
}
function bindOverlay(ov, pi) {
  ov.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = ov.getBoundingClientRect();
    const z = P.zoom;
    const x = (e.clientX - r.left) / z, y = (e.clientY - r.top) / z;
    const n = e.target.closest('.pf');
    if (P.armed && !n) {
      e.preventDefault();
      const def = FIELD_TYPES[P.armed];
      addField(P.armed, pi, x - def.w / 2, y - def.h / 2);
      arm(P.armed);
      return;
    }
    if (!n) { if (P.sel) { P.sel = null; drawOverlays(); } return; }
    e.preventDefault();
    const f = findField(n.dataset.id);
    if (!f) return;
    if (P.sel !== f.id) { P.sel = f.id; drawOverlays(); }
    const node = ov.querySelector(`.pf[data-id="${CSS.escape(f.id)}"]`);
    const size = P.sizes[pi];
    if (e.target.classList.contains('rh')) {
      const ow = f.w, oh = f.h;
      drag((ev) => {
        const w = Math.max(10, Math.min(size.w - f.x, ow + ((ev.clientX - r.left) / z - x)));
        const h = f.type === 'checkbox' ? w : Math.max(10, Math.min(size.h - f.y, oh + ((ev.clientY - r.top) / z - y)));
        Object.assign(node.style, { width: `${w * z}px`, height: `${h * z}px` });
        node.dataset.w = w; node.dataset.h = h;
      }, () => { if (node.dataset.w) patchField(f.id, { w: Number(node.dataset.w), h: Number(node.dataset.h) }); drawOverlays(); });
      return;
    }
    const ox = f.x, oy = f.y;
    let moved = false;
    drag((ev) => {
      const dx = (ev.clientX - r.left) / z - x, dy = (ev.clientY - r.top) / z - y;
      if (!moved && Math.hypot(dx, dy) * z < 3) return;
      moved = true;
      const nx = Math.max(0, Math.min(size.w - f.w, ox + dx)), ny = Math.max(0, Math.min(size.h - f.h, oy + dy));
      Object.assign(node.style, { left: `${nx * z}px`, top: `${ny * z}px` });
      node.dataset.x = nx; node.dataset.y = ny;
    }, () => { if (moved) { patchField(f.id, { x: Number(node.dataset.x), y: Number(node.dataset.y) }); drawOverlays(); } });
  });
}
function onKey(e) {
  if (host.tab() !== 'sign' || P.sv !== 'prepare' || !P.mode) return;
  const t = e.target;
  if (t.closest?.('input, textarea, select, [contenteditable], dialog')) return;
  if (e.key === 'Escape') { if (P.armed) arm(P.armed); else if (P.sel) { P.sel = null; drawOverlays(); } return; }
  if (!P.sel) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeField(P.sel); return; }
  const step = e.shiftKey ? 10 : 1;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (d) { e.preventDefault(); const f = findField(P.sel); patchField(f.id, { x: f.x + d[0], y: f.y + d[1] }); drawOverlays(); }
}

// ======================================================================
// create
// ======================================================================
function busy(on, text) {
  P.busy = on;
  const go = $('#sign-go');
  go.disabled = on;
  go.classList.toggle('busy', on);
  if (on) $('#sign-go-label').textContent = text;
  else syncGo();
}

async function createEnvelope() {
  if (P.busy) return null;
  if (!P.mode) { toast('Pick a template or upload a PDF first.', 'error'); return null; }
  if (!P.signers.length) { toast('Add at least one signer.', 'error'); return null; }
  if (P.mode === 'template') {
    const miss = TPL.missingRequired(P.tpl, P.values, P.omit);
    if (miss.length) { toast(`Fill in the required details first: ${miss.slice(0, 3).map((m) => m.label).join(', ')}${miss.length > 3 ? '…' : ''}`, 'error'); document.querySelector(`.sg-var[data-var="${CSS.escape(miss[0].id)}"]`)?.scrollIntoView({ block: 'center' }); return null; }
  }
  for (const [i, s] of P.signers.entries()) {
    if (s.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) { toast(`Signer ${i + 1}'s email does not look right.`, 'error'); return null; }
  }
  busy(true, 'Preparing');
  try {
    let pdf = P.bytes;
    let fields = allFields();
    if (P.mode === 'template') {
      const lib = await T.loadPdfLib();
      const r = await TPL.renderTemplate(lib, P.tpl, P.values, { preview: false, omit: P.omit, parties: partiesMap() });
      pdf = r.bytes;
      fields = r.fields.map((m) => { const o = P.overrides[m.id] || {}; return o.removed ? null : { ...m, ...o, id: m.id, source: 'template' }; }).filter(Boolean).concat(P.manual);
      P.sizes = r.pages.map((p) => ({ w: p.w, h: p.h }));
    }
    const orphans = fields.filter((f) => signerIndexForRole(f.role) < 0);
    if (orphans.length) throw new Error(`${orphans.length} field${orphans.length === 1 ? ' has' : 's have'} no signer. Add a signer for ${[...new Set(orphans.map((f) => P.tpl?.roles.find((r) => r.id === f.role)?.label || f.role))].join(', ')}, or delete those fields.`);
    const empty = P.signers.filter((s) => !fields.some((f) => f.role === s.role));
    if (empty.length) throw new Error(`${empty.map((s) => s.name || s.roleLabel || 'A signer').join(', ')} ${empty.length === 1 ? 'has' : 'have'} no fields. Add at least a signature for each signer.`);
    const perPage = {};
    for (const f of fields) perPage[f.page] = (perPage[f.page] || 0) + 1;
    if (Object.values(perPage).some((c) => c > MAX_PER_PAGE)) throw new Error(`A page can hold up to ${MAX_PER_PAGE} fields.`);
    if (pdf.length > MAX_BYTES - 256 * 1024) throw new Error('This PDF is over 10 MB. Compress it in Convert first.');
    busy(true, 'Encrypting');
    const docHash = await C.sha256Hex(pdf);
    const { key, raw } = await C.newKey();
    const signers = P.signers.map((s, i) => ({ index: i, name: s.name.trim(), email: s.email.trim(), role: s.role, roleLabel: s.roleLabel || (P.tpl?.roles.find((r) => r.id === s.role)?.label) || `Signer ${i + 1}`, order: P.routing === 'parallel' ? 1 : i + 1 }));
    const name = P.mode === 'template' ? `${P.tpl.title}.pdf` : P.name;
    const meta = {
      v: 1, name, docHash, routing: P.routing, message: P.message.trim(), senderName: P.from.trim(), createdAt: new Date().toISOString(),
      pages: P.sizes, fields: fields.map((f) => ({ id: f.id, type: f.type, role: f.role, page: f.page, x: round(f.x), y: round(f.y), w: round(f.w), h: round(f.h), required: !!f.required, label: f.label || '', options: f.options, source: f.source })),
      signers,
      template: P.mode === 'template' ? { id: P.tpl.id, version: P.tpl.version, title: P.tpl.title, variables: P.values, omit: P.omit } : null,
    };
    const blob = await C.encrypt(key, C.pack(meta, pdf), C.AAD.doc);
    busy(true, 'Checking');
    const check = await dryRun();
    if (check.remainingToday <= 0) throw new Error("You've made today's free envelopes. More tomorrow (midnight UTC).");
    busy(true, 'Uploading');
    const res = await apiCreate({ v: 1, docHash, routing: P.routing, signers: signers.map((s) => ({ order: s.order })) }, blob);
    const rec = {
      id: res.id, name, created: Date.now(), key: raw, ownerToken: res.ownerToken, routing: P.routing, docHash, dealId: P.dealId || null, message: meta.message, expiresAt: res.expiresAt,
      signers: signers.map((s, i) => ({ ...s, token: res.signerTokens[i], color: roleColor(i) })), status: 'sent', statusText: `Waiting for ${signers[0].name || 'Signer 1'}`,
    };
    try { await localEnv.put(rec); } catch { toast('This browser blocked local storage, so keep the links below somewhere safe.', 'error'); }
    if (P.dealId) {
      const d = await localDeals.get(P.dealId).catch(() => null);
      if (d) await localDeals.put({ ...d, envelopes: [...new Set([...(d.envelopes || []), rec.id])] });
    }
    P.sent = rec;
    renderSide();
    renderStage();
    refreshEnvCount();
    toast('Envelope created. Share each signer\'s link.');
    return rec;
  } catch (e) {
    toast(e instanceof SignError ? e.message : e.message || String(e), 'error');
    return null;
  } finally {
    busy(false);
  }
}
const round = (v) => Math.round(v * 100) / 100;

function manageUrl(rec) { return C.manageLink(location.origin, rec.id, rec.ownerToken, rec.key); }

function sentView() {
  const rec = P.sent;
  const cards = rec.signers.map((s) => signerLinkCard({ origin: location.origin, envelopeId: rec.id, key: rec.key, signer: s, message: rec.message, docName: rec.name, all: rec.signers }));
  const manage = manageUrl(rec);
  const owner = el('article', { class: 'sg-lcard owner' },
    el('div', { class: 'sg-lhead' }, el('span', { class: 'sg-dot', html: svg('<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>') }), el('span', { class: 'sg-lwho' }, el('strong', {}, 'Your manage link'), el('small', {}, 'Status, audit trail and the final PDF. Keep it private.'))),
    el('div', { class: 'sg-llink' }, el('input', { type: 'text', readonly: true, value: manage, 'aria-label': 'Manage link', onfocus: (e) => e.target.select() })),
    el('div', { class: 'sg-lacts' },
      el('button', { type: 'button', class: 'btn-ghost small', html: `${ICONS.copy}<span>Copy</span>`, onclick: () => copyText(manage, 'Manage link') }),
      el('a', { class: 'btn-ghost small', href: manage, target: '_blank', rel: 'noopener', html: `${ICONS.open}<span>Open status</span>` })));
  const first = rec.signers[0];
  const hint = rec.routing === 'sequential' && rec.signers.length > 1
    ? `Send ${first.name || 'the first signer'}'s link now. The others can open theirs any time, but each can sign only after the people before them.`
    : 'Everyone can sign now, in any order.';
  return el('div', { class: 'sg-sent' },
    el('div', { class: 'sg-sent-head' },
      el('span', { class: 'sg-badge ok', html: svg('<path d="M3.5 8.5l3 3 6-7"/>') }),
      el('div', {}, el('h2', { class: 'display' }, 'Envelope created'), el('p', { class: 'muted' }, `${rec.name.replace(/\.pdf$/i, '')} · ${rec.signers.length} signer${rec.signers.length === 1 ? '' : 's'} · envelope ${rec.id.slice(0, 8)}. Each link carries its own key, so only people you send it to can read the document.`))),
    el('p', { class: 'sg-hintline' }, hint),
    el('div', { class: 'sg-sent-grid' }, ...cards),
    owner,
    el('p', { class: 'side-note muted' }, 'Chucksi sends no email in this version. Copy, share, show the QR code, or hand your device to the signer.'));
}

// ======================================================================
// envelopes list
// ======================================================================
async function refreshEnvCount() {
  const list = await localEnv.all().catch(() => []);
  const c = $('#env-count');
  if (c) { c.hidden = !list.length; c.textContent = String(list.length); }
}
async function renderEnvelopes() {
  const stage = $('#sg-envelopes');
  const side = $('#sv-envelopes');
  const list = await localEnv.all().catch(() => []);
  const tally = el('div', { class: 'grid2', id: 'sg-env-tally' });
  const drawTally = (rs) => {
    const counts = { sent: 0, completed: 0 };
    rs.forEach((r) => { if (counts[r.status] != null) counts[r.status]++; });
    tally.replaceChildren(el('div', { class: 'chk' }, el('strong', {}, String(counts.sent)), el('span', {}, 'Out for signature')), el('div', { class: 'chk ok' }, el('strong', {}, String(counts.completed)), el('span', {}, 'Completed')));
  };
  drawTally(list);
  side.replaceChildren(
    tally,
    el('button', { type: 'button', class: 'btn-ghost wide', id: 'sg-env-refresh', onclick: () => renderEnvelopes() }, 'Refresh status'),
    el('p', { class: 'side-note' }, 'This list lives in this browser. It holds each envelope\'s key and links, so status and downloads work from here. Export a Deal to carry envelopes to another device.'),
    noticeEl());
  if (!list.length) {
    stage.replaceChildren(el('div', { class: 'dropzone small' }, el('strong', { class: 'display' }, 'No envelopes yet'), el('span', { class: 'muted' }, 'Envelopes you create on this device show up here with their status.'), el('div', { class: 'dz-actions' }, el('button', { type: 'button', class: 'btn-accent', onclick: () => setSv('prepare') }, 'Prepare an envelope'))));
    return;
  }
  const deals = Object.fromEntries((await localDeals.all().catch(() => [])).map((d) => [d.id, d.title]));
  stage.replaceChildren(el('div', { class: 'sg-elist' }, ...list.map((r) => envCard(r, deals))));
  for (const r of list) {
    if (r.status === 'deleted' || r.status === 'expired') continue;
    try {
      const st = await new Envelope(r.id, r.ownerToken).get({ status: true });
      const signed = st.signers.filter((s) => s.status === 'signed').length;
      const text = st.status === 'completed' ? 'Completed' : st.status === 'declined' ? 'Declined' : `Waiting for ${st.waitingOn.map((i) => r.signers[i]?.name || `Signer ${i + 1}`).join(' and ')}`;
      await localEnv.put({ ...r, status: st.status, statusText: text, signed, checked: Date.now() });
      const card = document.querySelector(`.sg-ecard[data-id="${CSS.escape(r.id)}"]`);
      if (card) card.replaceWith(envCard({ ...r, status: st.status, statusText: text, signed }, deals));
    } catch (e) {
      if (e.status === 410 || e.status === 404) {
        const status = e.status === 410 ? 'expired' : 'deleted';
        await localEnv.put({ ...r, status, statusText: status === 'expired' ? 'Expired' : 'Deleted' });
        const card = document.querySelector(`.sg-ecard[data-id="${CSS.escape(r.id)}"]`);
        if (card) card.replaceWith(envCard({ ...r, status, statusText: status === 'expired' ? 'Expired' : 'Deleted' }, deals));
      }
    }
  }
  drawTally(await localEnv.all().catch(() => list));
}
function envCard(r, deals = {}) {
  const links = el('div', { class: 'sg-elinks', hidden: true });
  const card = el('article', { class: `sg-ecard ${r.status}`, 'data-id': r.id },
    el('div', { class: 'sg-ehead' },
      el('div', { class: 'sg-ewho' }, el('strong', {}, r.name.replace(/\.pdf$/i, '')), el('small', {}, [new Date(r.created).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }), `${r.signers.length} signer${r.signers.length === 1 ? '' : 's'}`, r.routing === 'parallel' ? 'any order' : 'in order', r.dealId && deals[r.dealId] ? `Deal: ${deals[r.dealId]}` : null].filter(Boolean).join(' · '))),
      el('span', { class: `sg-pill ${r.status}` }, r.statusText || r.status)),
    el('div', { class: 'sg-esigners' }, ...r.signers.map((s, i) => el('span', { class: 'sg-chip', style: `--c:${roleColor(i)}` }, el('i'), s.name || s.roleLabel || `Signer ${i + 1}`))),
    el('div', { class: 'sg-lacts' },
      r.status === 'sent' ? el('button', { type: 'button', class: 'btn-ghost small', onclick: () => { links.hidden = !links.hidden; if (!links.childElementCount) links.append(...r.signers.map((s) => signerLinkCard({ origin: location.origin, envelopeId: r.id, key: r.key, signer: s, message: r.message, docName: r.name, all: r.signers }))); } }, 'Signer links') : null,
      ['deleted', 'expired'].includes(r.status) ? null : el('a', { class: 'btn-ghost small', href: manageUrl(r), target: '_blank', rel: 'noopener', html: `${ICONS.open}<span>${r.status === 'completed' ? 'Download signed PDF' : 'Status'}</span>` }),
      el('button', { type: 'button', class: 'btn-ghost small', onclick: () => copyText(manageUrl(r), 'Manage link') }, 'Copy manage link'),
      el('button', { type: 'button', class: 'btn-ghost small danger', onclick: async () => { if (!confirm('Forget this envelope on this device? It stays on Chucksi until it expires or you delete it from its status page. Without this record you will need the manage link to reach it.')) return; await localEnv.del(r.id); renderEnvelopes(); refreshEnvCount(); } }, 'Forget')),
    links);
  return card;
}

// ======================================================================
// deals
// ======================================================================
let dealsApi = null;
function ensureDeals() {
  if (!dealsApi) {
    dealsApi = mountDeals({
      side: $('#sv-deals'), stage: $('#sg-deals'),
      envelopes: () => localEnv.all(),
      manageUrl,
      newEnvelope: (dealId, people) => {
        P.dealId = dealId;
        setSv('prepare');
        if (people?.length && P.mode) for (const p of people) if (!P.signers.some((s) => s.name === p.name)) addSigner(p.name, p.email || '');
        renderSide();
        toast(P.mode ? 'The envelope will be added to this deal.' : 'Pick a template or upload a PDF. The envelope will be added to this deal.');
      },
    });
  } else dealsApi.refresh();
}
