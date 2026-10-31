// Build the final signed PDF in the browser, the same way for every party who has the key.
// 1. buildSigned: the original PDF with every signer's fields drawn into the pages (flattened).
// 2. The Worker signs the audit trail, including the SHA-256 of step 1 ("attest").
// 3. buildFinal: step 1 plus a Certificate of Completion and the signed audit record as an attachment.
// 4. The Worker records the SHA-256 of step 3 ("seal"), which is what Verify looks up.
// Output is deterministic: same inputs, same bytes, so anyone can rebuild the sealed copy exactly.

import { b64u, unb64u, sha256Hex, fromUtf8 } from './crypto.js';
import { FIELD_TYPES } from './fields.js';

const INK = [0.09, 0.09, 0.11];
const SOFT = [0.42, 0.42, 0.46];
const RULE = [0.84, 0.84, 0.86];
const AMBER = [1, 0.75, 0.18];

/** Map view units (top-left origin, as pdf.js shows the page at scale 1) to PDF user space. */
export function viewMap(page) {
  const cb = page.getCropBox();
  const rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
  const W = cb.width, H = cb.height;
  const map = (vx, vy) => {
    if (rot === 90) return [cb.x + vy, cb.y + vx];
    if (rot === 180) return [cb.x + W - vx, cb.y + vy];
    if (rot === 270) return [cb.x + W - vy, cb.y + H - vx];
    return [cb.x + vx, cb.y + H - vy];
  };
  return { map, rot, viewW: rot % 180 ? H : W, viewH: rot % 180 ? W : H };
}

export function utcStamp(isoStr) {
  if (!isoStr) return '';
  return `${String(isoStr).slice(0, 19).replace('T', ' ')} UTC`;
}

function safeText(font, s, memo = new Map()) {
  let out = '';
  for (const ch of String(s ?? '').replace(/[\r\t]/g, ' ')) {
    if (!memo.has(ch)) {
      try { font.encodeText(ch); memo.set(ch, ch); } catch { memo.set(ch, { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ' }[ch] || '?'); }
    }
    out += memo.get(ch);
  }
  return out;
}

function wrap(font, size, text, maxW, memo) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(safeText(font, t, memo), size) > maxW && line) { out.push(line); line = word; } else line = t;
      while (font.widthOfTextAtSize(safeText(font, line, memo), size) > maxW && line.length > 1) {
        let n = line.length - 1;
        while (n > 1 && font.widthOfTextAtSize(safeText(font, line.slice(0, n), memo), size) > maxW) n--;
        out.push(line.slice(0, n));
        line = line.slice(n);
      }
    }
    out.push(line);
  }
  return out;
}
const chunk = (s, n) => (String(s || '').match(new RegExp(`.{1,${n}}`, 'g')) || ['']);

/** Which signer owns a role. */
export const signerForRole = (meta, role) => (meta.signers || []).find((s) => s.role === role);

/** Draw every signer's values into the original PDF. payloads[i] is signer i's decrypted payload. */
export async function buildSigned(lib, { pdf, meta, payloads, envelopeId, completedAt }) {
  const { PDFDocument, StandardFonts, rgb, degrees } = lib;
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontB = await doc.embedFont(StandardFonts.HelveticaBold);
  const memo = new Map();
  const pages = doc.getPages();
  const imgCache = new Map();
  const png = async (b64) => {
    if (!imgCache.has(b64)) imgCache.set(b64, await doc.embedPng(unb64u(b64)));
    return imgCache.get(b64);
  };
  const ink = rgb(0.08, 0.1, 0.16);
  const tag = `Chucksi Sign  ${String(envelopeId || '').slice(0, 10)}`;
  const attachments = [];

  for (const f of meta.fields || []) {
    const page = pages[f.page];
    if (!page) continue;
    const s = signerForRole(meta, f.role);
    const p = s ? payloads[s.index] : null;
    if (!p) continue;
    const { map, rot } = viewMap(page);
    const angle = degrees(rot);
    const v = p.values ? p.values[f.id] : undefined;
    if (f.type === 'signature' || f.type === 'initials') {
      if (!v) continue;
      const im = f.type === 'signature' ? p.signature : p.initialsImg;
      if (!im || !im.png) continue;
      const img = await png(im.png);
      const top = f.type === 'signature' ? 6 : 0;
      const k = Math.min((f.w - 4) / im.w, (f.h - top) / im.h);
      const dw = im.w * k, dh = im.h * k;
      const [x, y] = map(f.x + 2, f.y + f.h + 1);
      page.drawImage(img, { x, y, width: dw, height: dh, rotate: angle });
      if (f.type === 'signature') {
        const [tx, ty] = map(f.x + 2, f.y + 4.2);
        page.drawText(safeText(font, tag, memo), { x: tx, y: ty, size: 4.6, font, color: rgb(0.45, 0.45, 0.5), rotate: angle });
      }
      continue;
    }
    if (f.type === 'checkbox') {
      if (f.source !== 'template') {
        const [bx, by] = map(f.x, f.y + f.h);
        page.drawRectangle({ x: bx, y: by, width: f.w, height: f.h, borderColor: rgb(...INK), borderWidth: 0.8, rotate: angle });
      }
      if (v === true) {
        const [cx, cy] = map(f.x, f.y);
        const s2 = Math.min(f.w, f.h);
        page.drawSvgPath(`M ${s2 * 0.18} ${s2 * 0.52} L ${s2 * 0.42} ${s2 * 0.78} L ${s2 * 0.84} ${s2 * 0.2}`, { x: cx, y: cy, borderColor: ink, borderWidth: Math.max(1, s2 * 0.14), rotate: angle });
      }
      continue;
    }
    let text = '';
    if (f.type === 'attachment') {
      const a = (p.attachments || []).find((x) => x.field === f.id);
      if (!a) continue;
      text = `Attached: ${a.name}`;
      attachments.push({ ...a, label: f.label || 'Attachment', signer: p.name || s.name || `Signer ${s.index + 1}` });
    } else {
      text = v == null ? '' : String(v);
    }
    if (!text.trim()) continue;
    text = safeText(font, text.replace(/\s*\n\s*/g, ' '), memo);
    let size = Math.min(10, Math.max(6, f.h * 0.66));
    while (size > 5.5 && font.widthOfTextAtSize(text, size) > f.w - 3) size -= 0.25;
    while (text.length > 1 && font.widthOfTextAtSize(text, size) > f.w - 3) text = `${text.slice(0, -2)}…`.replace(/…+$/, '') ;
    const [x, y] = map(f.x + 1.5, f.y + f.h - Math.max(2.5, (f.h - size) / 2 - 0.5));
    page.drawText(text, { x, y, size, font, color: ink, rotate: angle });
  }

  // Attachments go after the document: images and PDFs as pages, anything else as an embedded file.
  if (attachments.length) {
    const first = pages[0];
    const [PW, PH] = first ? [Math.min(first.getWidth(), 842), Math.min(first.getHeight(), 1191)] : [612, 792];
    for (const a of attachments) {
      const bytes = unb64u(a.data);
      const head = `Attachment · ${a.label} · from ${a.signer} · ${a.name}`;
      let placed = false;
      try {
        if (/pdf/i.test(a.type) || /\.pdf$/i.test(a.name)) {
          const src = await PDFDocument.load(bytes, { updateMetadata: false });
          const copied = await doc.copyPages(src, src.getPageIndices());
          copied.forEach((pg, i) => {
            doc.addPage(pg);
            if (i === 0) pg.drawText(safeText(font, head, memo), { x: 18, y: pg.getHeight() - 14, size: 6.5, font, color: rgb(...SOFT) });
          });
          placed = true;
        } else if (/png|jpe?g/i.test(a.type)) {
          const img = /png/i.test(a.type) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
          const pg = doc.addPage([PW, PH]);
          pg.drawText(safeText(fontB, 'ATTACHMENT', memo), { x: 54, y: PH - 52, size: 7, font: fontB, color: rgb(...SOFT) });
          pg.drawText(safeText(font, head.replace(/^Attachment · /, ''), memo), { x: 54, y: PH - 66, size: 10, font, color: rgb(...INK) });
          const k = Math.min((PW - 108) / img.width, (PH - 150) / img.height, 1.5);
          pg.drawImage(img, { x: (PW - img.width * k) / 2, y: PH - 90 - img.height * k, width: img.width * k, height: img.height * k });
          placed = true;
        }
      } catch { placed = false; }
      if (!placed) await doc.attach(bytes, a.name, { mimeType: a.type || 'application/octet-stream', description: head, creationDate: new Date(completedAt), modificationDate: new Date(completedAt) });
    }
  }

  stamp(doc, meta, envelopeId, completedAt);
  return doc.save();
}

function stamp(doc, meta, envelopeId, completedAt) {
  const when = new Date(completedAt || 0);
  doc.setTitle(String(meta.name || 'Document').replace(/\.pdf$/i, ''));
  doc.setSubject(`Chucksi Sign envelope ${envelopeId}`);
  doc.setKeywords([`massless-sign:${envelopeId}`]);
  doc.setProducer('Chucksi Sign');
  doc.setCreator('Chucksi Sign (chucksi.com)');
  doc.setCreationDate(when);
  doc.setModificationDate(when);
}

const EVENT_LABEL = {
  created: 'Envelope created', viewed: 'Opened', consented: 'Agreed to sign electronically', signed: 'Signed',
  declined: 'Declined', completed: 'Completed', downloaded: 'Downloaded', sealed: 'Sealed',
};

/** The signed PDF plus a Certificate of Completion. */
export async function buildFinal(lib, { signedBytes, meta, payloads, envelopeId, attest }) {
  const { PDFDocument, StandardFonts, rgb } = lib;
  const rec = JSON.parse(attest.json);
  const doc = await PDFDocument.load(signedBytes, { updateMetadata: false });
  const F = {
    r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold),
    m: await doc.embedFont(StandardFonts.Courier),
  };
  const memo = new Map();
  const S = (f, s) => safeText(f, s, memo);
  const C = (c) => rgb(c[0], c[1], c[2]);
  const docPages = doc.getPageCount();
  const PW = 612, PH = 792, ML = 54, MR = 54, MT = 54, MB = 64;
  const W = PW - ML - MR;
  const certPages = [];
  let page, y;
  const newPage = () => { page = doc.addPage([PW, PH]); certPages.push(page); y = PH - MT; };
  const ensure = (h) => { if (y - h < MB) { newPage(); y -= 6; } };
  const text = (s, x, yy, size = 8.5, f = F.r, color = INK) => page.drawText(S(f, s), { x, y: yy, size, font: f, color: C(color) });
  const label = (s, x, yy) => text(String(s).toUpperCase(), x, yy, 6.6, F.b, SOFT);
  const rule = (yy, c = RULE, t = 0.6) => page.drawLine({ start: { x: ML, y: yy }, end: { x: PW - MR, y: yy }, thickness: t, color: C(c) });
  const section = (title) => { ensure(40); y -= 18; text(title.toUpperCase(), ML, y, 8, F.b, INK); y -= 7; rule(y, INK, 0.8); y -= 4; };

  newPage();
  // header
  page.drawRectangle({ x: ML, y: y - 14, width: 14, height: 14, color: C(AMBER) });
  page.drawCircle({ x: ML + 7, y: y - 7, size: 3.6, borderColor: C(INK), borderWidth: 1.4 });
  text('CHUCKSI SIGN', ML + 22, y - 10.5, 8, F.b, INK);
  text('chucksi.com/sign', PW - MR - F.r.widthOfTextAtSize('chucksi.com/sign', 7.5), y - 10.5, 7.5, F.r, SOFT);
  y -= 46;
  text('Certificate of Completion', ML, y, 22, F.b, INK);
  y -= 18;
  for (const l of wrap(F.r, 11, meta.name || 'Document', W, memo).slice(0, 2)) { text(l, ML, y, 11, F.r, SOFT); y -= 14; }
  y -= 8;

  // summary grid
  const signedCount = rec.signers.filter((s) => s.status === 'signed').length;
  const grid = [
    ['Envelope ID', rec.envelopeId], ['Status', `Completed · ${signedCount} of ${rec.signers.length} signed`],
    ['Created', utcStamp(rec.createdAt)], ['Completed', utcStamp(rec.completedAt)],
    ['Pages', `${docPages} signed page${docPages === 1 ? '' : 's'}, then this certificate`], ['Signing order', rec.routing === 'parallel' ? 'Any order (parallel)' : 'One after another (sequential)'],
  ];
  const colW = W / 2;
  rule(y + 6);
  for (let i = 0; i < grid.length; i += 2) {
    y -= 12;
    grid.slice(i, i + 2).forEach(([k, v], j) => { label(k, ML + j * colW, y); text(v, ML + j * colW, y - 11, 9, F.r, INK); });
    y -= 20;
  }
  y -= 2;
  rule(y);

  // fingerprints
  section('Fingerprints (SHA-256)');
  const fp = [['Original document', rec.originalHash, 'as sent for signature'], ['Final document', rec.signedHash, `pages 1–${docPages} as signed, before this certificate`]];
  for (const [k, h, note] of fp) {
    ensure(30);
    y -= 13;
    text(k, ML, y, 8.5, F.b, INK);
    text(note, ML, y - 10, 7, F.r, SOFT);
    text(h, ML + 150, y, 8.2, F.m, INK);
    y -= 14;
  }

  // signers
  section('Signers');
  for (const sr of rec.signers) {
    const m = (meta.signers || []).find((s) => s.index === sr.index) || {};
    const p = payloads[sr.index] || {};
    const name = p.name || m.name || `Signer ${sr.index + 1}`;
    const ua = wrap(F.r, 7.5, sr.ua || 'Not recorded', W - 230, memo).slice(0, 3);
    const rows = [
      ['Role', m.roleLabel || m.role || ''],
      ['Email', m.email || 'Not given'],
      ['Agreed to sign electronically', utcStamp(sr.consentedAt)],
      ['Signed', utcStamp(sr.signedAt)],
      ['IP address', sr.ip || 'Not recorded'],
      ['Device', ua.join('\n')],
      ['Method', sr.inPerson ? `In person on a shared device; typed name "${p.confirmedName || name}" to confirm identity` : 'Own link (envelope ID and private token)'],
    ];
    const rowH = rows.map(([, v]) => Math.max(1, String(v).split('\n').length) * 9.5 + 3.5);
    const cardH = 30 + rowH.reduce((a, b) => a + b, 0) + 6;
    ensure(cardH + 8);
    y -= 8;
    const top = y;
    page.drawRectangle({ x: ML, y: top - cardH, width: W, height: cardH, color: rgb(0.975, 0.975, 0.978), borderColor: C(RULE), borderWidth: 0.6 });
    page.drawRectangle({ x: ML + 12, y: top - 26, width: 16, height: 16, color: C(INK) });
    const ord = String(sr.order);
    text(ord, ML + 20 - F.b.widthOfTextAtSize(ord, 9) / 2, top - 21.5, 9, F.b, [1, 1, 1]);
    text(name, ML + 36, top - 21.5, 12, F.b, INK);
    let ry = top - 40;
    rows.forEach(([k, v], i) => {
      text(k, ML + 36, ry, 7.5, F.r, SOFT);
      String(v).split('\n').forEach((l, li) => text(l, ML + 170, ry - li * 9.5, 7.5, F.r, INK));
      ry -= rowH[i];
    });
    // adopted signature, framed
    const boxW = 150, boxH = 56, bx = PW - MR - boxW - 12, by = top - 14 - boxH;
    page.drawRectangle({ x: bx, y: by, width: boxW, height: boxH, color: rgb(1, 1, 1), borderColor: C(RULE), borderWidth: 0.6 });
    if (p.signature && p.signature.png) {
      try {
        const img = await doc.embedPng(unb64u(p.signature.png));
        const k = Math.min((boxW - 16) / p.signature.w, (boxH - 18) / p.signature.h);
        page.drawImage(img, { x: bx + 8, y: by + 12, width: p.signature.w * k, height: p.signature.h * k });
      } catch { /* a broken image is left out; the hash still covers it */ }
    }
    text(p.signature ? `Adopted signature · ${p.signature.mode === 'type' ? 'typed' : p.signature.mode === 'upload' ? 'uploaded' : 'drawn'}` : 'No signature image', bx + 8, by + 4, 6, F.r, SOFT);
    y = top - cardH;
  }

  // audit trail
  section('Audit trail');
  const cols = [ML, ML + 20, ML + 112, ML + 238, ML + 352];
  const header = () => {
    y -= 12;
    ['#', 'Time (UTC)', 'Event', 'By', 'IP address'].forEach((h, i) => label(h, cols[i], y));
    y -= 5;
    rule(y);
  };
  header();
  const who = (ev) => {
    if (ev.actor === 'owner') return 'Sender';
    if (ev.actor === 'server') return 'Chucksi';
    const i = ev.signer;
    const m = (meta.signers || []).find((s) => s.index === i) || {};
    return (payloads[i] && payloads[i].name) || m.name || `Signer ${i + 1}`;
  };
  for (const ev of rec.events) {
    if (y - 13 < MB) { newPage(); header(); }
    y -= 11.5;
    const row = [String(ev.seq), utcStamp(ev.at).replace(' UTC', ''), EVENT_LABEL[ev.type] || ev.type, who(ev), ev.ip || ''];
    row.forEach((v, i) => {
      let t = v;
      const maxW = (cols[i + 1] || PW - MR) - cols[i] - 6;
      while (t.length > 1 && F.r.widthOfTextAtSize(S(F.r, t), 7.6) > maxW) t = t.slice(0, -1);
      text(t, cols[i], y, 7.6, i === 2 ? F.b : F.r, i === 0 ? SOFT : INK);
    });
    y -= 3;
    page.drawLine({ start: { x: ML, y }, end: { x: PW - MR, y }, thickness: 0.3, color: C([0.9, 0.9, 0.91]) });
  }

  // attestation
  section('Attestation');
  const recHash = await sha256Hex(new TextEncoder().encode(attest.json));
  const intro = 'Chucksi signed the audit trail above (envelope, fingerprints, signers and events) with ECDSA P-256 (ES256). The exact record is embedded in this PDF as massless-sign-audit.json. Its public key is at chucksi.com/api/sign/key.';
  const il = wrap(F.r, 8, intro, W, memo);
  ensure(il.length * 10.5 + 70);
  y -= 6;
  for (const l of il) { y -= 10.5; text(l, ML, y, 8, F.r, INK); }
  y -= 6;
  const att = [['Key ID', rec.kid], ['Record SHA-256', recHash], ['Signature', null]];
  for (const [k, v] of att) {
    y -= 12;
    text(k, ML, y, 7.5, F.b, SOFT);
    if (v) text(v, ML + 90, y, 7.6, F.m, INK);
    else chunk(attest.sig, 64).forEach((l, i) => { if (i) y -= 9.5; text(l, ML + 90, y, 7.6, F.m, INK); });
  }

  // verify
  section('Check this file');
  const vt = 'Open chucksi.com/sign, choose Verify and drop in this PDF. Chucksi recomputes the file\'s SHA-256 in your browser and looks for the sealed record. Changing any byte of this file makes the check fail.';
  const vl = wrap(F.r, 8, vt, W, memo);
  ensure(vl.length * 10.5 + 8);
  for (const l of vl) { y -= 10.5; text(l, ML, y, 8, F.r, INK); }

  // footers
  certPages.forEach((p, i) => {
    p.drawLine({ start: { x: ML, y: 44 }, end: { x: PW - MR, y: 44 }, thickness: 0.4, color: C(RULE) });
    p.drawText(S(F.r, 'Chucksi Sign provides templates and signing tools, not legal advice.'), { x: ML, y: 32, size: 6.8, font: F.r, color: C(SOFT) });
    const r = `Envelope ${rec.envelopeId}  ·  Certificate ${i + 1} of ${certPages.length}`;
    p.drawText(S(F.r, r), { x: PW - MR - F.r.widthOfTextAtSize(r, 6.8), y: 32, size: 6.8, font: F.r, color: C(SOFT) });
  });

  const when = new Date(rec.completedAt);
  await doc.attach(new TextEncoder().encode(JSON.stringify({ kind: 'massless-sign/attestation', envelopeId, kid: rec.kid, alg: 'ES256', record: attest.json, sig: attest.sig }, null, 2)), 'massless-sign-audit.json', {
    mimeType: 'application/json', description: 'Chucksi Sign audit record and ES256 signature', creationDate: when, modificationDate: when,
  });
  stamp(doc, meta, envelopeId, rec.completedAt);
  return doc.save();
}

/** Read the envelope ID a final PDF says it belongs to (from its metadata). */
export async function claimedEnvelope(lib, bytes) {
  try {
    const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    const m = String(doc.getSubject() || '').match(/(?:Chucksi|Massless) Sign envelope ([A-Za-z0-9_-]{22})/) || String(doc.getKeywords() || '').match(/massless-sign:([A-Za-z0-9_-]{22})/);
    return { id: m ? m[1] : null, title: doc.getTitle() || null, pages: doc.getPageCount() };
  } catch {
    return { id: null, title: null, pages: 0 };
  }
}

/**
 * Run steps 1–4. `post(type, body)` posts an event to the Worker and returns its JSON.
 * Returns { bytes, finalHash, signedHash, attest, seal, matches }.
 */
export async function finalize(lib, { pdf, meta, payloads, envelope, post }) {
  const signed = await buildSigned(lib, { pdf, meta, payloads, envelopeId: envelope.id, completedAt: envelope.completedAt });
  const signedHash = await sha256Hex(signed);
  let attest = envelope.attest;
  if (!attest) {
    const r = await post('attest', { signedHash });
    attest = r.attest;
  }
  const bytes = await buildFinal(lib, { signedBytes: signed, meta, payloads, envelopeId: envelope.id, attest });
  const finalHash = await sha256Hex(bytes);
  let seal = envelope.seal;
  if (!seal) {
    const r = await post('seal', { finalHash });
    seal = r.seal;
  }
  return { bytes, finalHash, signedHash, attest, seal, matches: !!seal && seal.finalHash === finalHash && attest.signedHash === signedHash };
}

export { EVENT_LABEL, FIELD_TYPES, b64u, fromUtf8 };
