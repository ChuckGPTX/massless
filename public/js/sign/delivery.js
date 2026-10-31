// Getting links to signers. v1 has no email: copy the link, use the phone's share sheet, show a QR code,
// or sign in person on this device. Email invites plug in at EMAIL below once the Worker can send mail
// (Cloudflare Email Service needs the Workers Paid plan; see sendInvite in office/sign_routes.js).

import { el, toast } from '../ui.js';
import { qrSvg } from './qr.js';
import { signLink } from './crypto.js';

/** Future hook: async ({ to, envelopeId, index, link }) => { sent }. Null means email is off. */
export const EMAIL = null;

export async function copyText(text, what = 'Link') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied.`);
    return true;
  } catch {
    const t = el('textarea', { readonly: true, style: 'position:fixed;opacity:0;top:0;left:0' });
    t.value = text;
    document.body.append(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* no clipboard */ }
    t.remove();
    toast(ok ? `${what} copied.` : 'Copy did not work here. Press and hold the link to copy it.', ok ? '' : 'error');
    return ok;
  }
}

export async function shareLink({ title, text, url }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return true; } catch (e) { if (e && e.name === 'AbortError') return false; }
  }
  return copyText(`${text ? `${text}\n` : ''}${url}`, 'Invite');
}

let qrDialog = null;
export function showQr(url, { title = 'Scan to sign', sub = '' } = {}) {
  if (!qrDialog) {
    qrDialog = el('dialog', { class: 'sheet sg-sheet sg-qr', 'aria-labelledby': 'sg-qr-h' });
    qrDialog.innerHTML = '<form method="dialog" class="sheet-head"><h2 id="sg-qr-h"></h2><button class="x" aria-label="Close">×</button></form><div class="sg-qr-code"></div><p class="sg-qr-sub"></p><p class="small muted">The code holds the full private link, key included. Show it only to this signer.</p>';
    qrDialog.addEventListener('click', (e) => { if (e.target === qrDialog) qrDialog.close(); });
    document.body.append(qrDialog);
  }
  qrDialog.querySelector('#sg-qr-h').textContent = title;
  qrDialog.querySelector('.sg-qr-sub').textContent = sub;
  qrDialog.querySelector('.sg-qr-code').innerHTML = qrSvg(url, { ecl: 'M', title });
  qrDialog.showModal();
}

const svg = (p) => `<svg viewBox="0 0 16 16" aria-hidden="true">${p}</svg>`;
export const ICONS = {
  copy: svg('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 3.5V3a.5.5 0 00-.5-.5H3a.5.5 0 00-.5.5v7a.5.5 0 00.5.5h.5"/>'),
  share: svg('<path d="M8 2v8M5 4.5L8 1.5l3 3M3.5 7.5v6h9v-6"/>'),
  qr: svg('<path d="M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h1.5v1.5M13.5 9.5v1.5M9.5 13.5h4M12 12h1.5"/>'),
  person: svg('<circle cx="8" cy="5" r="2.5"/><path d="M3 13.5c.8-2.8 2.7-4.2 5-4.2s4.2 1.4 5 4.2"/>'),
  open: svg('<path d="M9 2.5h4.5V7M13.5 2.5L7 9M11.5 9.5v4h-9v-9h4"/>'),
};

/**
 * A card for one signer: who they are, their private link and the ways to send it.
 * opts: { origin, envelopeId, key, signer: { index, name, email, roleLabel, token, color, order }, message, docName, routing, all }
 */
export function signerLinkCard(opts) {
  const { origin, envelopeId, key, signer, message, docName } = opts;
  const link = signLink(origin, envelopeId, signer.token, key);
  const nameText = signer.name || `Signer ${signer.index + 1}`;
  const invite = `${message ? `${message}\n\n` : ''}Please review and sign "${docName}" with Massless Sign:`;
  const card = el('article', { class: 'sg-lcard', 'data-signer': signer.index });
  card.style.setProperty('--c', signer.color || '#f5a524');
  const btn = (label, icon, fn, cls = 'btn-ghost small') => el('button', { type: 'button', class: cls, html: `${icon}<span>${label}</span>`, onclick: fn });
  // In-person: this device opens the signer's link in a hand-off mode; later signers queue behind.
  const inPerson = () => {
    const rest = (opts.all || []).filter((s) => s.index !== signer.index && s.order >= signer.order && s.token);
    const q = rest.map((s) => `${s.index}.${s.token}`).join(',');
    const url = signLink(origin, envelopeId, signer.token, key, q ? { p: '1', q } : { p: '1' });
    window.open(url, '_blank', 'noopener');
  };
  card.append(
    el('div', { class: 'sg-lhead' },
      el('span', { class: 'sg-dot', 'aria-hidden': 'true' }, String(signer.order || signer.index + 1)),
      el('span', { class: 'sg-lwho' }, el('strong', {}, nameText), el('small', {}, [signer.roleLabel, signer.email].filter(Boolean).join(' · ') || 'No email given'))),
    el('div', { class: 'sg-llink' }, el('input', { type: 'text', readonly: true, value: link, 'aria-label': `Signing link for ${nameText}`, onfocus: (e) => e.target.select() })),
    el('div', { class: 'sg-lacts' },
      btn('Copy link', ICONS.copy, () => copyText(link)),
      btn('Share', ICONS.share, () => shareLink({ title: `Sign: ${docName}`, text: invite, url: link })),
      btn('QR code', ICONS.qr, () => showQr(link, { title: `Scan to sign`, sub: `${nameText} · ${docName}` })),
      btn('Sign in person', ICONS.person, inPerson)),
  );
  return card;
}
