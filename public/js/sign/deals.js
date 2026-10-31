// Deals: one workspace per property, song or project. Envelopes, documents, people, a checklist and notes,
// stored in this browser (IndexedDB). Export a deal as a passphrase-encrypted file to move or back it up.

import { el, toast, download } from '../ui.js';
import * as C from './crypto.js';
import { deals as store, files as fileStore, envelopes as envStore } from './store.js';
import { roleColor } from './fields.js';

const svg = (p) => `<svg viewBox="0 0 16 16" aria-hidden="true">${p}</svg>`;
const uid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const PRESETS = {
  residential: {
    label: 'Residential purchase', titleLabel: 'Property address', placeholder: '1428 Elm Street, Springfield',
    roles: ['Buyer', 'Seller', "Buyer's agent", "Listing agent", 'Lender', 'Title or escrow'],
    tasks: ['Purchase agreement signed by buyer and seller', 'Earnest money deposited', "Seller's property disclosure delivered", 'Lead-based paint disclosure (homes built before 1978)', 'Inspection done', 'Repair request or inspection addendum signed', 'Appraisal ordered and received', 'Loan commitment received', 'Title commitment reviewed', 'HOA documents received (if any)', 'Closing disclosure received 3 days before closing', 'Final walkthrough', 'Deed and settlement statement signed', 'Keys handed over'],
  },
  subto: {
    label: 'Subject-to closing', titleLabel: 'Property address', placeholder: '77 Lakeview Drive, Austin',
    roles: ['Buyer', 'Seller', 'Title or escrow', 'Loan servicer'],
    tasks: ['Purchase agreement with subject-to terms signed', 'Subject-to addendum signed', 'Seller acknowledgment: the existing loan stays in their name', 'Due-on-sale clause risk disclosed in writing', 'Authorization to release loan information signed', 'Latest mortgage statement and payoff estimate collected', 'Title search and lien check', 'Insurance updated (new policy or buyer added)', 'Loan payments set up (servicing or autopay)', 'Deed signed, notarized and recorded', 'Limited power of attorney signed (if used)', 'Utilities and HOA transferred'],
  },
  lease: {
    label: 'Lease', titleLabel: 'Property address', placeholder: 'Unit 4B, 220 Pine Street',
    roles: ['Landlord', 'Tenant', 'Co-tenant', 'Guarantor', 'Property manager'],
    tasks: ['Rental application received', 'Consent for background and credit check signed', 'Lease agreement signed', 'Lead-based paint disclosure (built before 1978)', 'Rules or HOA addendum signed', 'Security deposit received and receipt sent', "Renter's insurance proof received", 'Move-in condition checklist signed', 'Move-in photos saved', 'Keys and access handed over'],
  },
  music: {
    label: 'Music release', titleLabel: 'Song or project title', placeholder: 'Midnight Static (single)',
    roles: ['Artist', 'Songwriter', 'Producer', 'Featured artist', 'Cover artist', 'Manager'],
    tasks: ['Split sheet signed by every writer', 'Producer agreement signed (fee, points, credit)', 'Feature agreement signed', 'Cover art license or work-for-hire signed', 'Samples cleared (if any)', 'Masters delivered (WAV and stems)', 'Credits and metadata confirmed', 'ISRC codes assigned', 'Uploaded to distribution with a release date', 'Registered with each PRO and publisher', 'Mechanical rights registered (The MLC)', 'Release-day assets ready'],
  },
  sync: {
    label: 'Sync deal', titleLabel: 'Song and placement', placeholder: '"Blue Hour" in a car commercial',
    roles: ['Music supervisor', 'Master owner', 'Publisher', 'Writer', 'Artist'],
    tasks: ['Brief received: media, term, territory, exclusivity', 'Quote agreed', 'Master use license signed', 'Sync license (publishing) signed', 'Every owner approved', 'Files delivered (WAV, stems, instrumental)', 'Invoice sent', 'Payment received', 'Cue sheet filed', 'Air date and credit noted'],
  },
  blank: { label: 'Blank', titleLabel: 'Deal name', placeholder: 'My deal', roles: ['Party'], tasks: [] },
};

export function newDealObject(preset, title) {
  const p = PRESETS[preset] || PRESETS.blank;
  return { id: uid('d'), title: title || p.placeholder, preset, created: Date.now(), tasks: p.tasks.map((t) => ({ id: uid('t'), text: t, done: false })), people: [], envelopes: [], files: [], notes: '' };
}

// ---------- encrypted export / import ----------
export async function exportDeals(ids, pass) {
  const deals = (await Promise.all(ids.map((id) => store.get(id)))).filter(Boolean);
  const envIds = new Set(deals.flatMap((d) => d.envelopes || []));
  const envelopes = (await envStore.all()).filter((e) => envIds.has(e.id));
  const files = [];
  for (const d of deals) for (const fid of d.files || []) {
    const f = await fileStore.get(fid);
    if (f) files.push({ ...f, blob: undefined, data: C.b64u(new Uint8Array(await f.blob.arrayBuffer())) });
  }
  const plain = C.utf8(JSON.stringify({ kind: 'massless-sign/deals', v: 1, exported: new Date().toISOString(), deals, envelopes, files }));
  const salt = C.randomBytes(16);
  const iter = 310000;
  const key = await C.passKey(pass, salt, iter);
  const data = await C.encrypt(key, plain, C.AAD.deals);
  return new Blob([JSON.stringify({ kind: 'massless-sign/deals-export', v: 1, kdf: 'PBKDF2-SHA256', iter, salt: C.b64u(salt), cipher: 'AES-256-GCM', data: C.b64u(data) })], { type: 'application/json' });
}
export async function importDeals(text, pass) {
  let wrap;
  try { wrap = JSON.parse(text); } catch { throw new Error('That is not a Chucksi Deals file.'); }
  if (wrap.kind !== 'massless-sign/deals-export') throw new Error('That is not a Chucksi Deals file.');
  const key = await C.passKey(pass, C.unb64u(wrap.salt), wrap.iter || 310000);
  let plain;
  try { plain = await C.decrypt(key, C.unb64u(wrap.data), C.AAD.deals); } catch { throw new Error('Wrong passphrase, or the file was changed.'); }
  const body = JSON.parse(C.fromUtf8(plain));
  for (const f of body.files || []) await fileStore.put({ ...f, data: undefined, blob: new Blob([C.unb64u(f.data)], { type: f.type || 'application/octet-stream' }) });
  for (const e of body.envelopes || []) { const have = await envStore.get(e.id); if (!have) await envStore.put(e); }
  for (const d of body.deals || []) await store.put(d);
  return body.deals || [];
}

function askPass({ title, confirm: twice, action }) {
  return new Promise((resolve) => {
    const d = el('dialog', { class: 'sheet sg-sheet' });
    d.innerHTML = `<form method="dialog" class="sheet-head"><h2>${title}</h2><button class="x" aria-label="Close">×</button></form>`;
    const a = el('input', { type: 'password', id: 'deal-pass', autocomplete: 'new-password', placeholder: 'Passphrase, 8 characters or more', 'aria-label': 'Passphrase' });
    const b = twice ? el('input', { type: 'password', id: 'deal-pass2', autocomplete: 'new-password', placeholder: 'Type it again', 'aria-label': 'Repeat passphrase' }) : null;
    const go = el('button', { type: 'button', class: 'btn-accent', id: 'deal-pass-go' }, action);
    d.append(
      el('p', {}, twice ? 'The file is encrypted with AES-256 using a key made from this passphrase. Chucksi never sees it, and nobody can open the file without it.' : 'Type the passphrase used when the file was exported.'),
      el('div', { class: 'field stack' }, a, b),
      el('div', { class: 'sg-actions' }, el('button', { type: 'button', class: 'btn-ghost', onclick: () => d.close() }, 'Cancel'), go));
    document.body.append(d);
    let val = null;
    const ok = () => {
      if (a.value.length < 8) { toast('Use at least 8 characters.', 'error'); return; }
      if (b && a.value !== b.value) { toast('The passphrases do not match.', 'error'); return; }
      val = a.value;
      d.close();
    };
    go.addEventListener('click', ok);
    [a, b].forEach((x) => x?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }));
    d.addEventListener('close', () => { d.remove(); resolve(val); });
    d.showModal();
    a.focus();
  });
}

// ---------- UI ----------
export function mountDeals({ side, stage, envelopes, manageUrl, newEnvelope }) {
  let current = null;
  const preset = el('select', { id: 'deal-preset', 'aria-label': 'Deal type' }, ...Object.entries(PRESETS).map(([k, p]) => el('option', { value: k }, p.label)));
  const title = el('input', { type: 'text', id: 'deal-title', class: 'text-in sg-ti', maxlength: 120, placeholder: PRESETS.residential.placeholder, 'aria-label': 'Deal name' });
  const titleLabel = el('span', {}, PRESETS.residential.titleLabel);
  preset.addEventListener('change', () => { const p = PRESETS[preset.value]; title.placeholder = p.placeholder; titleLabel.textContent = p.titleLabel; });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') newDeal(); });
  const importIn = el('input', { type: 'file', accept: '.json,.chucksi-deal,.massless-deal,application/json', hidden: true, id: 'deal-import-in' });
  importIn.addEventListener('change', async () => {
    const f = importIn.files[0];
    importIn.value = '';
    if (!f) return;
    const pass = await askPass({ title: 'Import deals', action: 'Import' });
    if (!pass) return;
    try {
      const ds = await importDeals(await f.text(), pass);
      toast(`Imported ${ds.length} deal${ds.length === 1 ? '' : 's'}.`);
      current = ds[0]?.id || null;
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  });
  side.replaceChildren(
    el('label', { class: 'row-sel sel' }, el('small', {}, 'Deal type'), preset),
    el('div', { class: 'field' }, el('div', { class: 'f-head' }, titleLabel), title),
    el('p', { class: 'side-note' }, 'Each type starts with a checklist you can edit. Press New deal below.'),
    el('div', { class: 'grid2' }, el('label', { class: 'btn-ghost', for: 'deal-import-in' }, 'Import'), el('button', { type: 'button', class: 'btn-ghost', id: 'deal-export-all', onclick: async () => { const all = await store.all(); if (!all.length) { toast('No deals to export yet.', 'error'); return; } exportFlow(all.map((d) => d.id), 'chucksi-deals'); } }, 'Export all')),
    importIn,
    el('p', { class: 'side-note' }, 'Deals live only in this browser. Exports are encrypted with your passphrase.'));

  async function newDeal() {
    const d = newDealObject(preset.value, title.value.trim());
    await store.put(d);
    title.value = '';
    current = d.id;
    refresh();
    toast(`Deal "${d.title}" created with ${d.tasks.length} checklist items.`);
    return d;
  }
  async function exportFlow(ids, base) {
    const pass = await askPass({ title: 'Export encrypted', confirm: true, action: 'Export' });
    if (!pass) return;
    try {
      const blob = await exportDeals(ids, pass);
      download(blob, `${base.replace(/[^\w.-]+/g, '-').slice(0, 60)}.chucksi-deal.json`);
      toast('Exported. Keep the passphrase: there is no way to recover it.');
    } catch (e) { toast(e.message, 'error'); }
  }

  async function refresh() {
    const all = await store.all();
    if (current && !all.some((d) => d.id === current)) current = null;
    if (!current) return renderList(all);
    return renderDeal(all.find((d) => d.id === current));
  }

  function renderList(all) {
    if (!all.length) {
      stage.replaceChildren(el('div', { class: 'dropzone small' },
        el('span', { html: svg('<path d="M2.5 4.5h4l1.5 1.5h5.5v7.5h-11z"/>'), class: 'sg-dz-ico' }),
        el('strong', { class: 'display' }, 'No deals yet'),
        el('span', { class: 'muted' }, 'A deal keeps the envelopes, documents, people and to-dos for one property, song or project together.'),
        el('div', { class: 'dz-actions' }, el('button', { type: 'button', class: 'btn-accent', onclick: () => title.focus() }, 'Start a deal'))));
      return;
    }
    stage.replaceChildren(el('div', { class: 'sg-dgrid' }, ...all.map((d) => {
      const done = d.tasks.filter((t) => t.done).length;
      const b = el('button', { type: 'button', class: 'sg-dcard', 'data-deal': d.id },
        el('span', { class: 'sg-tcat' }, PRESETS[d.preset]?.label || 'Deal'),
        el('strong', {}, d.title),
        el('span', { class: 'sg-dbar' }, el('i', { style: `width:${d.tasks.length ? (done / d.tasks.length) * 100 : 0}%` })),
        el('small', {}, `${done} of ${d.tasks.length} done · ${(d.envelopes || []).length} envelope${(d.envelopes || []).length === 1 ? '' : 's'} · ${(d.people || []).length} ${(d.people || []).length === 1 ? 'person' : 'people'}`));
      b.addEventListener('click', () => { current = d.id; refresh(); });
      return b;
    })));
  }

  async function save(d) { await store.put(d); }

  async function renderDeal(d) {
    const envs = await envelopes().catch(() => []);
    const mine = envs.filter((e) => (d.envelopes || []).includes(e.id));
    const others = envs.filter((e) => !(d.envelopes || []).includes(e.id));
    const done = d.tasks.filter((t) => t.done).length;
    const titleIn = el('input', { type: 'text', class: 'sg-dtitle', value: d.title, maxlength: 120, 'aria-label': 'Deal name' });
    titleIn.addEventListener('change', async () => { d.title = titleIn.value.trim() || d.title; await save(d); });

    // checklist
    const tasks = el('ul', { class: 'sg-tasks' });
    const drawTasks = () => {
      tasks.replaceChildren(...d.tasks.map((t) => {
        const cb = el('input', { type: 'checkbox', checked: t.done || null, 'aria-label': t.text });
        cb.addEventListener('change', async () => { t.done = cb.checked; t.doneAt = cb.checked ? Date.now() : null; await save(d); li.classList.toggle('done', t.done); syncProg(); });
        const li = el('li', { class: t.done ? 'done' : '' }, el('label', {}, cb, el('span', {}, t.text)),
          el('button', { type: 'button', class: 'sg-x', 'aria-label': `Remove ${t.text}`, html: '×', onclick: async () => { d.tasks = d.tasks.filter((x) => x !== t); await save(d); drawTasks(); syncProg(); } }));
        return li;
      }));
    };
    const prog = el('span', { class: 'sg-dbar big' }, el('i'));
    const progText = el('small', { class: 'muted' });
    const syncProg = () => { const n = d.tasks.filter((t) => t.done).length; prog.firstChild.style.width = `${d.tasks.length ? (n / d.tasks.length) * 100 : 0}%`; progText.textContent = `${n} of ${d.tasks.length} done`; };
    drawTasks(); syncProg();
    const addTask = el('input', { type: 'text', placeholder: 'Add a to-do and press Enter', maxlength: 200, 'aria-label': 'New to-do', class: 'sg-addin' });
    addTask.addEventListener('keydown', async (e) => { if (e.key !== 'Enter' || !addTask.value.trim()) return; d.tasks.push({ id: uid('t'), text: addTask.value.trim(), done: false }); addTask.value = ''; await save(d); drawTasks(); syncProg(); });

    // envelopes
    const envList = el('div', { class: 'sg-dlist' }, ...(mine.length ? mine.map((e) => el('div', { class: 'sg-drow' },
      el('span', {}, el('strong', {}, e.name.replace(/\.pdf$/i, '')), el('small', {}, e.signers.map((s) => s.name || s.roleLabel).join(', '))),
      el('span', { class: `sg-pill ${e.status}` }, e.statusText || e.status),
      ['deleted', 'expired'].includes(e.status) ? el('span') : el('a', { class: 'btn-ghost small', href: manageUrl(e), target: '_blank', rel: 'noopener' }, 'Open'))) : [el('p', { class: 'muted small' }, 'No envelopes in this deal yet.')]));
    const link = el('select', { 'aria-label': 'Add an existing envelope' }, el('option', { value: '' }, 'Add an existing envelope…'), ...others.map((e) => el('option', { value: e.id }, e.name)));
    link.addEventListener('change', async () => { if (!link.value) return; d.envelopes = [...new Set([...(d.envelopes || []), link.value])]; await save(d); renderDeal(d); });

    // documents
    const docList = el('div', { class: 'sg-dlist' });
    const drawDocs = async () => {
      const fs = (await Promise.all((d.files || []).map((id) => fileStore.get(id)))).filter(Boolean);
      docList.replaceChildren(...(fs.length ? fs.map((f) => el('div', { class: 'sg-drow' },
        el('span', {}, el('strong', {}, f.name), el('small', {}, `${fmt(f.size)} · added ${new Date(f.created).toLocaleDateString()}`)),
        el('button', { type: 'button', class: 'btn-ghost small', onclick: () => download(f.blob, f.name) }, 'Download'),
        el('button', { type: 'button', class: 'sg-x', 'aria-label': `Remove ${f.name}`, html: '×', onclick: async () => { d.files = d.files.filter((x) => x !== f.id); await fileStore.del(f.id); await save(d); drawDocs(); } }))) : [el('p', { class: 'muted small' }, 'Drop files here or add them: disclosures, inspection reports, stems, artwork.')]));
    };
    const docIn = el('input', { type: 'file', multiple: true, hidden: true, id: `deal-doc-${d.id}` });
    docIn.addEventListener('change', async () => { const list = [...docIn.files]; docIn.value = ''; await addFiles(list); });
    drawDocs();

    // people
    const people = el('div', { class: 'sg-dlist' });
    const drawPeople = () => people.replaceChildren(...(d.people.length ? d.people.map((p, i) => el('div', { class: 'sg-drow' },
      el('span', { class: 'sg-chip', style: `--c:${roleColor(i)}` }, el('i'), p.role || 'Party'),
      el('span', {}, el('strong', {}, p.name), el('small', {}, [p.email, p.phone].filter(Boolean).join(' · ') || 'No contact details')),
      el('button', { type: 'button', class: 'sg-x', 'aria-label': `Remove ${p.name}`, html: '×', onclick: async () => { d.people = d.people.filter((x) => x !== p); await save(d); drawPeople(); } }))) : [el('p', { class: 'muted small' }, 'Add the people in this deal. They become signers with one click.')]));
    drawPeople();
    const roleSel = el('select', { 'aria-label': 'Role' }, ...(PRESETS[d.preset]?.roles || ['Party']).map((r) => el('option', { value: r }, r)));
    const pName = el('input', { type: 'text', placeholder: 'Name', maxlength: 80, 'aria-label': 'Name' });
    const pEmail = el('input', { type: 'email', placeholder: 'Email (optional)', maxlength: 120, 'aria-label': 'Email' });
    const pPhone = el('input', { type: 'tel', placeholder: 'Phone (optional)', maxlength: 40, 'aria-label': 'Phone' });
    const addPerson = async () => { if (!pName.value.trim()) { toast('Type a name.', 'error'); return; } d.people.push({ id: uid('p'), name: pName.value.trim(), email: pEmail.value.trim(), phone: pPhone.value.trim(), role: roleSel.value }); pName.value = pEmail.value = pPhone.value = ''; await save(d); drawPeople(); };
    pName.addEventListener('keydown', (e) => { if (e.key === 'Enter') addPerson(); });

    const notes = el('textarea', { rows: 4, maxlength: 5000, placeholder: 'Notes: dates, numbers, who said what.', 'aria-label': 'Notes' });
    notes.value = d.notes || '';
    notes.addEventListener('change', async () => { d.notes = notes.value; await save(d); });

    const card = (title, ...kids) => el('section', { class: 'sg-dsec' }, el('h3', {}, title), ...kids);
    stage.replaceChildren(el('div', { class: 'sg-deal', 'data-deal': d.id },
      el('div', { class: 'sg-dhead' },
        el('button', { type: 'button', class: 'btn-ghost small', onclick: () => { current = null; refresh(); }, html: `${svg('<path d="M10 3L5 8l5 5"/>')}<span>All deals</span>` }),
        el('span', { class: 'sg-tcat' }, PRESETS[d.preset]?.label || 'Deal'),
        el('span', { class: 'grow' }),
        el('button', { type: 'button', class: 'btn-accent small', id: 'deal-new-env', onclick: () => newEnvelope(d.id, d.people) }, 'New envelope for this deal'),
        el('button', { type: 'button', class: 'btn-ghost small', id: 'deal-export', onclick: () => exportFlow([d.id], d.title) }, 'Export'),
        el('button', { type: 'button', class: 'btn-ghost small danger', onclick: async () => { if (!confirm(`Delete the deal "${d.title}" and its documents from this browser? Envelopes stay on Chucksi.`)) return; await store.del(d.id); current = null; refresh(); } }, 'Delete')),
      el('label', { class: 'sg-dtitle-wrap' }, el('small', {}, PRESETS[d.preset]?.titleLabel || 'Deal'), titleIn),
      el('div', { class: 'sg-dprog' }, prog, progText),
      el('div', { class: 'sg-dcols' },
        el('div', { class: 'stack' }, card('Checklist', tasks, addTask), card('Notes', el('div', { class: 'field' }, notes))),
        el('div', { class: 'stack' },
          card('Envelopes', envList, others.length ? el('label', { class: 'row-sel sel' }, el('small', {}, 'Link'), link) : null),
          card('Documents', docList, el('label', { class: 'btn-ghost small', for: docIn.id }, 'Add documents'), docIn),
          card('People', people, el('div', { class: 'sg-padd' }, roleSel, pName, pEmail, pPhone, el('button', { type: 'button', class: 'btn-ghost small', onclick: addPerson }, 'Add person')))))));
  }

  async function addFiles(list) {
    const d = current && await store.get(current);
    if (!d) { toast('Open a deal first, then drop documents into it.', 'error'); return; }
    for (const f of list) {
      if (f.size > 25 * 1024 * 1024) { toast(`${f.name} is over 25 MB and was skipped.`, 'error'); continue; }
      const rec = { id: uid('f'), dealId: d.id, name: f.name, type: f.type, size: f.size, created: Date.now(), blob: f };
      await fileStore.put(rec);
      d.files = [...(d.files || []), rec.id];
    }
    await store.put(d);
    refresh();
  }

  refresh();
  return { refresh, newDeal, addFiles, open: (id) => { current = id; return refresh(); } };
}
const fmt = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
