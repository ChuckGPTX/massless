// Verify a final Massless Sign PDF: hash it in the browser, look up the sealed record, check the Worker's
// ES256 signatures, and show pass or fail. Changing a single byte of the file changes its SHA-256, so
// no sealed record matches and the check fails.

import { el, toast } from '../ui.js';
import { sha256Hex, verifySignature } from './crypto.js';
import { verifyHash, publicKey } from './api.js';
import { claimedEnvelope, utcStamp } from './final.js';
import { loadPdfLib } from '../pdf-tools.js';

const ICON = {
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg>',
  bad: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/></svg>',
  wait: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/></svg>',
};

/** Check one file. Returns { ok, reason, steps, seal, audit, hash, claimed }. */
export async function verifyFile(bytes) {
  const steps = [];
  const step = (ok, label, detail) => steps.push({ ok, label, detail });
  const hash = await sha256Hex(bytes);
  step(true, 'Fingerprint computed in this browser', hash);
  let claimed = { id: null };
  try { claimed = await claimedEnvelope(await loadPdfLib(), bytes); } catch { /* not a PDF pdf-lib can read */ }
  const res = await verifyHash(hash, claimed.id);
  if (!res.found) {
    if (res.known) {
      step(false, 'Sealed record found', `This file says it is envelope ${res.envelopeId}, sealed ${utcStamp(res.sealedAt)}, but its fingerprint does not match the sealed copy.`);
      return { ok: false, reason: 'changed', steps, hash, claimed };
    }
    step(false, 'Sealed record found', claimed.id ? `No sealed record for envelope ${claimed.id}. It may be unfinished, or the record was never sealed.` : 'No Massless Sign record matches this file.');
    return { ok: false, reason: 'unknown', steps, hash, claimed };
  }
  step(true, 'Sealed record found', `Envelope ${res.envelopeId}`);
  const key = await publicKey();
  const keys = [key, ...(key.keys || [])];
  const sealRec = JSON.parse(res.seal.json);
  const sealKey = keys.find((k) => k.kid === res.seal.kid) || key;
  const sealOk = await verifySignature(sealKey, res.seal.json, res.seal.sig);
  const hashOk = sealRec.finalHash === hash;
  step(sealOk && hashOk, 'Massless signature on the seal is valid', sealOk ? `ES256 · key ${res.seal.kid}` : 'The seal signature does not check out.');
  let audit = null;
  if (res.audit) {
    const rec = JSON.parse(res.audit.json);
    const auditKey = keys.find((k) => k.kid === rec.kid) || key;
    const aOk = await verifySignature(auditKey, res.audit.json, res.audit.sig) && (await sha256Hex(new TextEncoder().encode(res.audit.json))) === sealRec.auditHash;
    step(aOk, 'Audit trail is intact', aOk ? `${rec.events.length} events · ${rec.signers.length} signer${rec.signers.length === 1 ? '' : 's'}` : 'The audit record does not match the seal.');
    audit = rec;
  } else {
    step(true, 'Audit trail', 'The detailed audit trail was deleted after the retention period. The certificate page in the PDF has the details; the seal still proves the file.');
  }
  const ok = steps.every((s) => s.ok);
  return { ok, reason: ok ? 'match' : 'signature', steps, seal: sealRec, audit, hash, claimed };
}

/** Mount a Verify panel into `box`. */
export function mountVerify(box, { compact = false } = {}) {
  const input = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true, id: `vf-in-${Math.random().toString(36).slice(2, 8)}` });
  const drop = el('label', { class: 'sg-vdrop', for: input.id, html: `
    <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 5l15 6v11c0 9.5-6.4 17.4-15 20-8.6-2.6-15-10.5-15-20V11z"/><path d="M17 24l5 5 9-10"/></svg>
    <strong class="display">Verify a signed PDF</strong>
    <span class="muted">Drop the final PDF here. Its fingerprint is computed on this device; only the SHA-256 is sent to look up the seal.</span>
    <span class="btn-ghost small">Choose PDF</span>` });
  const out = el('div', { class: 'sg-vout', 'aria-live': 'polite' });
  box.replaceChildren(drop, input, out);
  if (compact) drop.classList.add('compact');
  const run = async (file) => {
    if (!file) return;
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast('Choose a PDF file.', 'error'); return; }
    out.replaceChildren(el('div', { class: 'sg-vcard wait', html: `${ICON.wait}<div><strong>Checking ${escapeHtml(file.name)}…</strong><span>Computing its SHA-256 here, then checking the seal.</span></div>` }));
    try {
      const r = await verifyFile(new Uint8Array(await file.arrayBuffer()));
      out.replaceChildren(resultCard(file.name, r));
    } catch (e) {
      out.replaceChildren(el('div', { class: 'sg-vcard bad', html: `${ICON.bad}<div><strong>Could not check this file</strong><span>${escapeHtml(e.message || String(e))}</span></div>` }));
    }
  };
  input.addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; run(f); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); run(e.dataTransfer.files[0]); });
  return { run, input };
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function resultCard(name, r) {
  const title = r.ok ? 'Authentic and unchanged' : r.reason === 'changed' ? 'This file was changed after signing' : r.reason === 'unknown' ? 'Not a sealed Massless Sign file' : 'The seal does not check out';
  const sub = r.ok
    ? `${escapeHtml(name)} is byte-for-byte the copy sealed on ${escapeHtml(utcStamp(r.seal.sealedAt))}.`
    : r.reason === 'changed' ? 'At least one byte differs from the sealed copy. Ask the sender for the original.' : r.reason === 'unknown' ? 'No sealed record matches this file. It may have been edited, re-saved or printed to PDF, or it was never sealed.' : 'Do not rely on this file.';
  const card = el('div', { class: `sg-vcard ${r.ok ? 'ok' : 'bad'}` });
  card.innerHTML = `${r.ok ? ICON.ok : ICON.bad}<div><strong>${title}</strong><span>${sub}</span></div>`;
  const list = el('ol', { class: 'sg-vsteps' }, ...r.steps.map((s) => el('li', { class: s.ok ? 'ok' : 'bad' }, el('strong', {}, s.label), el('span', {}, s.detail || ''))));
  const wrap = el('div', { class: 'sg-vresult' }, card, list);
  if (r.ok) {
    const rows = [
      ['Envelope', r.seal.envelopeId], ['Signers', String(r.seal.signers)], ['Completed', utcStamp(r.seal.completedAt)], ['Sealed', utcStamp(r.seal.sealedAt)],
      ['Original SHA-256', r.seal.originalHash], ['Final SHA-256', r.seal.signedHash], ['File SHA-256', r.hash],
    ];
    wrap.append(el('dl', { class: 'sg-vfacts' }, ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', { class: /SHA/.test(k) ? 'mono' : '' }, v)])));
    if (r.audit) {
      wrap.append(el('div', { class: 'sg-vaudit' }, el('strong', {}, 'Signers on record'), ...r.audit.signers.map((s) => el('span', {}, `#${s.order} · signed ${utcStamp(s.signedAt)} · ${s.ip || 'no IP'}${s.inPerson ? ' · in person' : ''}`))));
    }
  } else {
    wrap.append(el('p', { class: 'small muted sg-vhash' }, 'File SHA-256: ', el('code', {}, r.hash)));
  }
  return wrap;
}
