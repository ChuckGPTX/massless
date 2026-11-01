// Massless Sign: Worker routes for end-to-end encrypted e-signature envelopes (imported by src/index.js).
//
// The browser encrypts the PDF, the field layout, the variables and every signer's fields with a random
// AES-GCM 256 key that lives only in the link fragment (#k=...). This Worker stores ciphertext in R2,
// bookkeeping in D1, enforces signing order, adds the server time, IP and user agent to every event, and
// signs the audit trail with an ECDSA P-256 key so anyone can check a final PDF later.
//
// What the server sees: envelope IDs, ciphertext sizes, SHA-256 fingerprints, signer counts and order,
// event types and times, IP addresses and user agents. What it never sees: document text, field values,
// names or emails, signatures, the sender's message or decline reasons.
//
// Access is by capability, not account: the owner token (sender) and one token per signer are random
// 32-byte values; only their SHA-256 is stored. Signers never need an account.
//
// Bindings: SIGN_BUCKET (R2), SIGN_DB (D1, migrations/sign), secret SIGN_KEY (a private ECDSA P-256 JWK;
// make one with `node tools/sign/keygen.mjs`). Optional vars: SIGN_CAP (envelopes per day, everyone),
// PER_VISITOR_SIGN (per visitor per day), SIGN_OLD_KEYS (JSON array of retired public JWKs).

export const SIGN_LIMITS = {
  maxBytes: 10 * 1024 * 1024, // all ciphertext for one envelope: the document plus every signer's fields
  maxSigners: 10,
  maxFieldsPerPage: 50, // checked in the browser; the server cannot see the layout
  unsignedDays: 30,
  completedDays: 90,
  perVisitorDaily: 20,
  totalDaily: 2000,
  maxEvents: 300,
};
const DAY = 86400000;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const B64U_RE = /^[A-Za-z0-9_-]*$/;

// Test hook: the Node harness swaps the clock to check expiry.
let clock = () => Date.now();
export function _setClock(fn) { clock = fn || (() => Date.now()); }

// ---------- helpers (these mirror json(), hashIp() and today() in src/index.js) ----------
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
const enc = new TextEncoder();
const hexOf = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (data) => hexOf(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

function b64u(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const randomToken = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));

/** Stable JSON: keys sorted, no whitespace (the same function as public/js/sign/crypto.js). */
export function canonical(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}

function sameString(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hashIp(ip) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(`massless:${ip}`));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const today = () => new Date(clock()).toISOString().slice(0, 10);
const clientIp = (request) => request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
const clientUa = (request) => (request.headers.get('user-agent') || '').slice(0, 300);

/** POSTs that go behind the Turnstile human check (add to GATED in src/index.js). */
export function signGated(path) {
  return path === '/api/sign/envelopes' || path === '/api/sign/verify' || /^\/api\/sign\/envelopes\/[A-Za-z0-9_-]{22}\/events$/.test(path);
}

// ---------- attestation key ----------
let keyMemo = null;
async function signingKey(env) {
  if (!env.SIGN_KEY) return null;
  if (keyMemo && keyMemo.src === env.SIGN_KEY) return keyMemo;
  let jwk;
  try { jwk = typeof env.SIGN_KEY === 'string' ? JSON.parse(env.SIGN_KEY) : env.SIGN_KEY; } catch { return null; }
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d) return null;
  const priv = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const pub = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  const kid = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(canonical(pub)))));
  keyMemo = { src: env.SIGN_KEY, priv, pub: { ...pub, alg: 'ES256', use: 'sig', kid }, kid };
  return keyMemo;
}
async function signText(k, text) {
  return b64u(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.priv, enc.encode(text))));
}

async function publicKey(request, env) {
  const k = await signingKey(env);
  if (!k) return json({ error: "Signing isn't available right now. Try again later." }, 503);
  const want = new URL(request.url).searchParams.get('kid');
  let old = [];
  try { old = JSON.parse(env.SIGN_OLD_KEYS || '[]'); } catch { /* none */ }
  const keys = [k.pub, ...old.filter((x) => x && x.kid)];
  const pick = want ? keys.find((x) => x.kid === want) : k.pub;
  if (!pick) return json({ error: 'No key with that ID.' }, 404);
  return json({ ...pick, keys }, 200, { 'cache-control': 'public, max-age=3600' });
}

// ---------- storage ----------
const blobKey = (id, part) => `e/${id}/${part}`;

async function purge(env, id) {
  const listed = await env.SIGN_BUCKET.list({ prefix: `e/${id}/` });
  const keys = (listed.objects || []).map((o) => o.key);
  if (keys.length) await env.SIGN_BUCKET.delete(keys);
  await env.SIGN_DB.batch([
    env.SIGN_DB.prepare('DELETE FROM sign_events WHERE envelope_id = ?').bind(id),
    env.SIGN_DB.prepare('DELETE FROM sign_signers WHERE envelope_id = ?').bind(id),
    env.SIGN_DB.prepare('DELETE FROM sign_envelopes WHERE id = ?').bind(id),
  ]);
}

/** Delete expired envelopes (unsigned after 30 days, completed after 90). Run from a cron or opportunistically. */
export async function signCleanup(env, limit = 50) {
  if (!env.SIGN_DB || !env.SIGN_BUCKET) return 0;
  const now = clock();
  const { results } = await env.SIGN_DB.prepare('SELECT id FROM sign_envelopes WHERE expires_at <= ? LIMIT ?').bind(now, limit).all();
  for (const r of results || []) await purge(env, r.id);
  await env.SIGN_DB.prepare('DELETE FROM sign_quota WHERE day < ?').bind(new Date(now - 2 * DAY).toISOString().slice(0, 10)).run();
  return (results || []).length;
}

async function addEvent(env, id, ev, request) {
  const row = await env.SIGN_DB.prepare(
    `INSERT INTO sign_events (envelope_id, seq, type, actor, signer_idx, at, ip, ua, doc_hash, detail)
     SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ? FROM sign_events WHERE envelope_id = ? RETURNING seq`,
  ).bind(id, ev.type, ev.actor, ev.signer ?? null, ev.at ?? clock(), request ? clientIp(request) : null, request ? clientUa(request) : null, ev.docHash || null, ev.detail ? JSON.stringify(ev.detail) : null, id).first();
  await env.SIGN_DB.prepare('UPDATE sign_envelopes SET event_count = event_count + 1 WHERE id = ?').bind(id).run();
  return row?.seq;
}

function eventOut(e) {
  return { seq: e.seq, type: e.type, actor: e.actor, signer: e.signer_idx, at: iso(e.at), ip: e.ip, ua: e.ua, docHash: e.doc_hash, detail: e.detail ? JSON.parse(e.detail) : null };
}
function signerOut(s) {
  return { index: s.idx, order: s.ord, status: s.status, viewedAt: iso(s.viewed_at), consentedAt: iso(s.consented_at), signedAt: iso(s.signed_at), declinedAt: iso(s.declined_at) };
}

// ---------- auth ----------
async function authorize(request, env, id) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+([A-Za-z0-9_-]{43})$/);
  if (!m) return { stop: json({ error: "This link is incomplete. Open the full link you were sent." }, 401) };
  const row = await env.SIGN_DB.prepare('SELECT * FROM sign_envelopes WHERE id = ?').bind(id).first();
  if (!row) return { stop: json({ error: 'This envelope does not exist or was deleted.' }, 404) };
  if (row.expires_at <= clock()) {
    await purge(env, id);
    return { stop: json({ error: 'This envelope expired and was deleted.', expired: true }, 410) };
  }
  const h = await sha256Hex(m[1]);
  if (sameString(h, row.owner_hash)) return { env: row, who: { kind: 'owner' } };
  const s = await env.SIGN_DB.prepare('SELECT * FROM sign_signers WHERE envelope_id = ? AND token_hash = ?').bind(id, h).first();
  if (!s) return { stop: json({ error: 'This link is not valid for this envelope.' }, 403) };
  return { env: row, who: { kind: 'signer', index: s.idx, signer: s } };
}

const allSigners = async (env, id) => (await env.SIGN_DB.prepare('SELECT * FROM sign_signers WHERE envelope_id = ? ORDER BY idx').bind(id).all()).results || [];

/** Sequential routing: a signer's turn comes when everyone with a lower order number has signed. */
function isTurn(signers, s, row) {
  if (row.status !== 'sent' || s.status !== 'pending') return false;
  return signers.every((o) => o.ord >= s.ord || o.status === 'signed');
}
function waitingOn(signers, row) {
  if (row.status !== 'sent') return [];
  return signers.filter((s) => isTurn(signers, s, row)).map((s) => s.idx);
}

// ---------- quota (D1, atomic; KV's free tier allows only 1,000 writes a day) ----------
async function quotaLeft(request, env) {
  const day = today();
  const who = await hashIp(clientIp(request));
  const [mine, total] = await Promise.all([
    env.SIGN_DB.prepare('SELECT n FROM sign_quota WHERE day = ? AND who = ?').bind(day, who).first('n'),
    env.SIGN_DB.prepare('SELECT n FROM sign_quota WHERE day = ? AND who = ?').bind(day, '*').first('n'),
  ]);
  const per = Number(env.PER_VISITOR_SIGN || SIGN_LIMITS.perVisitorDaily);
  const cap = Number(env.SIGN_CAP || SIGN_LIMITS.totalDaily);
  return { day, who, left: Math.max(0, Math.min(per - (mine || 0), cap - (total || 0))) };
}
async function quotaUse(env, q) {
  const up = 'INSERT INTO sign_quota (day, who, n) VALUES (?, ?, 1) ON CONFLICT(day, who) DO UPDATE SET n = n + 1';
  await env.SIGN_DB.batch([env.SIGN_DB.prepare(up).bind(q.day, q.who), env.SIGN_DB.prepare(up).bind(q.day, '*')]);
}

const publicLimits = () => ({ maxBytes: SIGN_LIMITS.maxBytes, maxSigners: SIGN_LIMITS.maxSigners, maxFieldsPerPage: SIGN_LIMITS.maxFieldsPerPage, unsignedDays: SIGN_LIMITS.unsignedDays, completedDays: SIGN_LIMITS.completedDays });

// ---------- POST /api/sign/envelopes ----------
async function createEnvelope(request, env, ctx) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    // Dry run: checks the daily cap and earns the human pass before the browser uploads a large file.
    let body = {};
    try { body = await request.json(); } catch { /* empty */ }
    if (!body || body.dryRun !== true) return json({ error: 'Send the envelope as form data with meta and blob.' }, 400);
    const q = await quotaLeft(request, env);
    return json({ ok: true, dryRun: true, remainingToday: q.left, limits: publicLimits() });
  }
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > SIGN_LIMITS.maxBytes + 256 * 1024) return json({ error: 'This envelope is over 10 MB. Compress the PDF in Convert and try again.' }, 413);
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'Send the envelope as form data with meta and blob.' }, 400); }
  let meta;
  try { meta = JSON.parse(String(form.get('meta') || '')); } catch { return json({ error: 'The envelope details are not valid JSON.' }, 400); }
  const file = form.get('blob');
  if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'The encrypted document is missing.' }, 400);
  const blob = new Uint8Array(await file.arrayBuffer());
  if (blob.length > SIGN_LIMITS.maxBytes) return json({ error: 'This envelope is over 10 MB. Compress the PDF in Convert and try again.' }, 413);
  if (blob.length < 64 || blob[0] !== 1) return json({ error: 'The document must be encrypted in the browser first.' }, 400);
  if (!HASH_RE.test(String(meta.docHash || ''))) return json({ error: 'The document fingerprint is missing.' }, 400);
  const signers = Array.isArray(meta.signers) ? meta.signers : [];
  if (!signers.length) return json({ error: 'Add at least one signer.' }, 400);
  if (signers.length > SIGN_LIMITS.maxSigners) return json({ error: `An envelope can have up to ${SIGN_LIMITS.maxSigners} signers.` }, 400);
  const routing = meta.routing === 'parallel' ? 'parallel' : 'sequential';
  const orders = signers.map((s, i) => (routing === 'parallel' ? 1 : Math.max(1, Math.min(SIGN_LIMITS.maxSigners, Math.floor(Number(s && s.order) || i + 1)))));

  const q = await quotaLeft(request, env);
  if (q.left <= 0) return json({ error: `You've made the ${Number(env.PER_VISITOR_SIGN || SIGN_LIMITS.perVisitorDaily)} free envelopes allowed today. More tomorrow (midnight UTC).` }, 429);

  const now = clock();
  const id = randomToken(16);
  const ownerToken = randomToken(32);
  const signerTokens = signers.map(() => randomToken(32));
  const expiresAt = now + SIGN_LIMITS.unsignedDays * DAY;
  await env.SIGN_BUCKET.put(blobKey(id, 'doc'), blob, { httpMetadata: { contentType: 'application/octet-stream' } });
  const stmts = [
    env.SIGN_DB.prepare('INSERT INTO sign_envelopes (id, owner_hash, status, routing, doc_hash, signer_count, bytes, created_at, expires_at) VALUES (?, ?, \'sent\', ?, ?, ?, ?, ?, ?)')
      .bind(id, await sha256Hex(ownerToken), routing, meta.docHash, signers.length, blob.length, now, expiresAt),
  ];
  for (const [i, t] of signerTokens.entries()) {
    stmts.push(env.SIGN_DB.prepare('INSERT INTO sign_signers (envelope_id, idx, token_hash, ord) VALUES (?, ?, ?, ?)').bind(id, i, await sha256Hex(t), orders[i]));
  }
  await env.SIGN_DB.batch(stmts);
  await addEvent(env, id, { type: 'created', actor: 'owner', at: now, docHash: meta.docHash, detail: { signers: signers.length, routing, bytes: blob.length } }, request);
  await quotaUse(env, q);
  if (ctx && ctx.waitUntil) ctx.waitUntil(signCleanup(env, 20).catch(() => {}));
  return json({ id, ownerToken, signerTokens, routing, orders, expiresAt: iso(expiresAt), remainingToday: q.left - 1, limits: publicLimits() }, 201);
}

// ---------- GET /api/sign/envelopes/:id ----------
async function attestOut(row) {
  return row.attest_json ? { json: row.attest_json, sig: row.attest_sig, signedHash: row.signed_hash } : null;
}
async function sealOut(env, row) {
  if (!row.final_hash) return null;
  const s = await env.SIGN_DB.prepare('SELECT * FROM sign_seals WHERE final_hash = ?').bind(row.final_hash).first();
  return s ? { json: s.seal_json, sig: s.seal_sig, kid: s.kid, finalHash: s.final_hash } : null;
}

async function getEnvelope(request, env, id) {
  const a = await authorize(request, env, id);
  if (a.stop) return a.stop;
  const row = a.env;
  const signers = await allSigners(env, id);
  const waiting = waitingOn(signers, row);
  const out = {
    id, status: row.status, routing: row.routing, docHash: row.doc_hash,
    createdAt: iso(row.created_at), completedAt: iso(row.completed_at), declinedAt: iso(row.declined_at), expiresAt: iso(row.expires_at),
    bytes: row.bytes, bytesLeft: Math.max(0, SIGN_LIMITS.maxBytes - row.bytes),
    you: a.who.kind === 'owner' ? { kind: 'owner' } : { kind: 'signer', index: a.who.index, turn: waiting.includes(a.who.index) },
    waitingOn: waiting,
    signers: signers.map(signerOut),
    attest: await attestOut(row),
    seal: await sealOut(env, row),
    limits: publicLimits(),
  };
  const declines = (await env.SIGN_DB.prepare("SELECT signer_idx, detail FROM sign_events WHERE envelope_id = ? AND type = 'declined'").bind(id).all()).results || [];
  out.declines = declines.map((d) => ({ index: d.signer_idx, reason: (d.detail && JSON.parse(d.detail).reason) || null }));
  if (new URL(request.url).searchParams.get('parts') !== 'status') {
    const doc = await env.SIGN_BUCKET.get(blobKey(id, 'doc'));
    if (!doc) return json({ error: 'The encrypted document is missing from storage.' }, 500);
    out.doc = b64u(new Uint8Array(await doc.arrayBuffer()));
    out.payloads = [];
    for (const s of signers) {
      if (s.status !== 'signed') continue;
      const p = await env.SIGN_BUCKET.get(blobKey(id, `s${s.idx}`));
      if (p) out.payloads.push({ index: s.idx, data: b64u(new Uint8Array(await p.arrayBuffer())) });
    }
  }
  return json(out);
}

// ---------- the audit record the Worker signs ----------
async function auditRecord(env, row, k, signedHash, now) {
  const signers = await allSigners(env, row.id);
  const events = ((await env.SIGN_DB.prepare('SELECT * FROM sign_events WHERE envelope_id = ? ORDER BY seq').bind(row.id).all()).results || []).map(eventOut);
  return {
    v: 1, kind: 'massless-sign/audit', envelopeId: row.id, kid: k.kid, routing: row.routing,
    createdAt: iso(row.created_at), completedAt: iso(row.completed_at), attestedAt: iso(now),
    originalHash: row.doc_hash, signedHash,
    signers: signers.map((s) => {
      const signed = events.find((e) => e.type === 'signed' && e.signer === s.idx);
      return { ...signerOut(s), ip: signed ? signed.ip : null, ua: signed ? signed.ua : null, inPerson: !!(signed && signed.detail && signed.detail.inPerson) };
    }),
    events,
  };
}

// ---------- POST /api/sign/envelopes/:id/events ----------
const SIGNER_EVENTS = new Set(['viewed', 'consented', 'signed', 'declined', 'downloaded', 'attest', 'seal']);
const OWNER_EVENTS = new Set(['viewed', 'downloaded', 'attest', 'seal']);

async function postEvent(request, env, id) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > Math.ceil(SIGN_LIMITS.maxBytes * 1.37) + 65536) return json({ error: 'That is over the 10 MB envelope limit.' }, 413);
  const a = await authorize(request, env, id);
  if (a.stop) return a.stop;
  let body;
  try { body = JSON.parse(await request.text()); } catch { return json({ error: 'Send JSON: { "type": "...", "docHash": "..." }' }, 400); }
  const type = String(body.type || '');
  const row = a.env;
  const who = a.who;
  if (!(who.kind === 'owner' ? OWNER_EVENTS : SIGNER_EVENTS).has(type)) return json({ error: `"${type}" is not an event this link can record.` }, 400);
  if (row.event_count >= SIGN_LIMITS.maxEvents) return json({ error: 'This envelope has recorded the most events it can.' }, 429);
  const actor = who.kind === 'owner' ? 'owner' : `signer:${who.index}`;
  const now = clock();
  const docHash = String(body.docHash || '');
  const needsDoc = ['viewed', 'consented', 'signed', 'declined'].includes(type);
  if (needsDoc && docHash !== row.doc_hash) return json({ error: 'The document you have open does not match the one that was sent. Reload the link.', mismatch: true }, 409);

  if (type === 'viewed') {
    const last = await env.SIGN_DB.prepare('SELECT type, at FROM sign_events WHERE envelope_id = ? AND actor = ? ORDER BY seq DESC LIMIT 1').bind(id, actor).first();
    if (last && last.type === 'viewed' && now - last.at < 10 * 60000) return json({ ok: true, deduped: true });
    if (who.kind === 'signer') await env.SIGN_DB.prepare('UPDATE sign_signers SET viewed_at = COALESCE(viewed_at, ?) WHERE envelope_id = ? AND idx = ?').bind(now, id, who.index).run();
    const seq = await addEvent(env, id, { type, actor, signer: who.index, at: now, docHash }, request);
    return json({ ok: true, seq });
  }

  if (type === 'downloaded') {
    const what = ['original', 'final', 'certificate'].includes(body.what) ? body.what : 'final';
    const seq = await addEvent(env, id, { type, actor, signer: who.index, at: now, docHash: HASH_RE.test(docHash) ? docHash : null, detail: { what } }, request);
    return json({ ok: true, seq });
  }

  if (type === 'consented' || type === 'signed' || type === 'declined') {
    const signers = await allSigners(env, id);
    const me = signers.find((s) => s.idx === who.index);
    if (row.status === 'declined') return json({ error: 'This envelope was declined, so it can no longer be signed.' }, 409);
    if (row.status === 'completed' || me.status === 'signed') return json({ error: 'You have already signed this envelope.' }, 409);
    if (me.status === 'declined') return json({ error: 'You declined this envelope.' }, 409);

    if (type === 'declined') {
      const reason = body.reason == null ? null : String(body.reason);
      if (reason && (reason.length > 6000 || !B64U_RE.test(reason))) return json({ error: 'The decline reason must be encrypted and under 4 KB.' }, 400);
      const ch = await env.SIGN_DB.prepare("UPDATE sign_signers SET status = 'declined', declined_at = ? WHERE envelope_id = ? AND idx = ? AND status = 'pending'").bind(now, id, who.index).run();
      if (!ch.meta || ch.meta.changes !== 1) return json({ error: 'You can no longer decline this envelope.' }, 409);
      await env.SIGN_DB.prepare("UPDATE sign_envelopes SET status = 'declined', declined_at = ? WHERE id = ? AND status = 'sent'").bind(now, id).run();
      const seq = await addEvent(env, id, { type, actor, signer: who.index, at: now, docHash, detail: reason ? { reason } : null }, request);
      return json({ ok: true, seq, status: 'declined' });
    }

    if (!isTurn(signers, me, row)) {
      const ahead = signers.filter((s) => s.ord < me.ord && s.status !== 'signed').map((s) => s.idx);
      return json({ error: 'It is not your turn yet. Someone earlier in the signing order still has to sign.', notYourTurn: true, waitingOn: ahead }, 409);
    }

    if (type === 'consented') {
      if (me.consented_at) return json({ ok: true, already: true });
      await env.SIGN_DB.prepare('UPDATE sign_signers SET consented_at = ? WHERE envelope_id = ? AND idx = ?').bind(now, id, who.index).run();
      const disclosure = String(body.disclosure || '').slice(0, 64) || null;
      const seq = await addEvent(env, id, { type, actor, signer: who.index, at: now, docHash, detail: disclosure ? { disclosure } : null }, request);
      return json({ ok: true, seq });
    }

    // signed
    if (!me.consented_at) return json({ error: 'Agree to sign electronically first.' }, 409);
    const payload = String(body.payload || '');
    if (!payload || !B64U_RE.test(payload)) return json({ error: 'Your fields must be encrypted before they are sent.' }, 400);
    const bytes = unb64u(payload);
    if (bytes[0] !== 1 || bytes.length < 29) return json({ error: 'Your fields must be encrypted before they are sent.' }, 400);
    if (row.bytes + bytes.length > SIGN_LIMITS.maxBytes) return json({ error: 'Your attachments push this envelope over 10 MB. Use smaller files.' }, 413);
    const fields = Math.max(0, Math.min(10000, Math.floor(Number(body.fields) || 0)));
    const valuesHash = HASH_RE.test(String(body.valuesHash || '')) ? body.valuesHash : null;
    const inPerson = body.inPerson === true;
    await env.SIGN_BUCKET.put(blobKey(id, `s${who.index}`), bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
    const ch = await env.SIGN_DB.prepare("UPDATE sign_signers SET status = 'signed', signed_at = ?, payload_bytes = ? WHERE envelope_id = ? AND idx = ? AND status = 'pending' AND consented_at IS NOT NULL").bind(now, bytes.length, id, who.index).run();
    if (!ch.meta || ch.meta.changes !== 1) return json({ error: 'You have already signed this envelope.' }, 409);
    await env.SIGN_DB.prepare('UPDATE sign_envelopes SET bytes = bytes + ? WHERE id = ?').bind(bytes.length, id).run();
    const seq = await addEvent(env, id, { type, actor, signer: who.index, at: now, docHash, detail: { fields, valuesHash, inPerson } }, request);
    const left = await env.SIGN_DB.prepare("SELECT COUNT(*) AS n FROM sign_signers WHERE envelope_id = ? AND status != 'signed'").bind(id).first('n');
    let status = 'sent';
    if (left === 0) {
      const done = await env.SIGN_DB.prepare("UPDATE sign_envelopes SET status = 'completed', completed_at = ?, expires_at = ? WHERE id = ? AND status = 'sent'").bind(now, now + SIGN_LIMITS.completedDays * DAY, id).run();
      if (done.meta && done.meta.changes === 1) await addEvent(env, id, { type: 'completed', actor: 'server', at: now, docHash: row.doc_hash, detail: { signers: row.signer_count } }, null);
      status = 'completed';
    }
    return json({ ok: true, seq, status });
  }

  // attest: the first party to build the signed PDF registers its fingerprint; the Worker signs the audit trail.
  if (type === 'attest') {
    if (row.status !== 'completed') return json({ error: 'Everyone has to sign before the envelope can be sealed.' }, 409);
    const signedHash = String(body.signedHash || '');
    if (!HASH_RE.test(signedHash)) return json({ error: 'The signed document fingerprint is missing.' }, 400);
    if (row.attest_json) return json({ ok: true, already: true, matches: row.signed_hash === signedHash, attest: await attestOut(row) });
    const k = await signingKey(env);
    if (!k) return json({ error: "Signing isn't available right now. Try again later." }, 503);
    const text = canonical(await auditRecord(env, row, k, signedHash, now));
    const sig = await signText(k, text);
    const ch = await env.SIGN_DB.prepare('UPDATE sign_envelopes SET signed_hash = ?, attest_json = ?, attest_sig = ? WHERE id = ? AND attest_json IS NULL').bind(signedHash, text, sig, id).run();
    if (!ch.meta || ch.meta.changes !== 1) {
      const again = await env.SIGN_DB.prepare('SELECT * FROM sign_envelopes WHERE id = ?').bind(id).first();
      return json({ ok: true, already: true, matches: again.signed_hash === signedHash, attest: await attestOut(again) });
    }
    return json({ ok: true, matches: true, attest: { json: text, sig, signedHash } });
  }

  // seal: register the final file's fingerprint (signed pages + certificate), so Verify can find it.
  if (type === 'seal') {
    if (!row.attest_json) return json({ error: 'Build the signed document first.' }, 409);
    const finalHash = String(body.finalHash || '');
    if (!HASH_RE.test(finalHash)) return json({ error: 'The final document fingerprint is missing.' }, 400);
    if (row.final_hash) return json({ ok: true, already: true, matches: row.final_hash === finalHash, seal: await sealOut(env, row) });
    const k = await signingKey(env);
    if (!k) return json({ error: "Signing isn't available right now. Try again later." }, 503);
    const audit = JSON.parse(row.attest_json);
    const seal = {
      v: 1, kind: 'massless-sign/seal', envelopeId: id, kid: k.kid,
      originalHash: row.doc_hash, signedHash: row.signed_hash, finalHash,
      auditHash: await sha256Hex(row.attest_json), auditSig: row.attest_sig,
      createdAt: iso(row.created_at), completedAt: iso(row.completed_at), sealedAt: iso(now),
      signers: row.signer_count, routing: row.routing, auditKid: audit.kid,
    };
    const text = canonical(seal);
    const sig = await signText(k, text);
    const ch = await env.SIGN_DB.prepare('UPDATE sign_envelopes SET final_hash = ? WHERE id = ? AND final_hash IS NULL').bind(finalHash, id).run();
    if (!ch.meta || ch.meta.changes !== 1) {
      const again = await env.SIGN_DB.prepare('SELECT * FROM sign_envelopes WHERE id = ?').bind(id).first();
      return json({ ok: true, already: true, matches: again.final_hash === finalHash, seal: await sealOut(env, again) });
    }
    await env.SIGN_DB.prepare('INSERT OR IGNORE INTO sign_seals (final_hash, envelope_id, seal_json, seal_sig, kid, sealed_at) VALUES (?, ?, ?, ?, ?, ?)').bind(finalHash, id, text, sig, k.kid, now).run();
    await addEvent(env, id, { type: 'sealed', actor, signer: who.index, at: now, docHash: finalHash, detail: null }, request);
    return json({ ok: true, matches: true, seal: { json: text, sig, kid: k.kid, finalHash } });
  }
  return json({ error: 'Unknown event.' }, 400);
}

// ---------- GET /api/sign/envelopes/:id/audit ----------
async function getAudit(request, env, id) {
  const a = await authorize(request, env, id);
  if (a.stop) return a.stop;
  const row = a.env;
  const events = ((await env.SIGN_DB.prepare('SELECT * FROM sign_events WHERE envelope_id = ? ORDER BY seq').bind(id).all()).results || []).map(eventOut);
  const signers = await allSigners(env, id);
  return json({ id, status: row.status, routing: row.routing, docHash: row.doc_hash, createdAt: iso(row.created_at), completedAt: iso(row.completed_at), expiresAt: iso(row.expires_at), signers: signers.map(signerOut), events, attest: await attestOut(row), seal: await sealOut(env, row) });
}

// ---------- DELETE /api/sign/envelopes/:id ----------
async function deleteEnvelope(request, env, id) {
  const a = await authorize(request, env, id);
  if (a.stop) return a.stop;
  if (a.who.kind !== 'owner') return json({ error: 'Only the sender can delete this envelope.' }, 403);
  await purge(env, id);
  // The seal (fingerprints and dates, no names or content) stays, so copies people already downloaded still verify.
  return json({ ok: true, deleted: true });
}

// ---------- POST /api/sign/verify ----------
async function verify(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON: { "sha256": "..." }' }, 400); }
  const hash = String(body.sha256 || '').toLowerCase();
  if (!HASH_RE.test(hash)) return json({ error: 'Send the SHA-256 of the PDF as 64 hex characters.' }, 400);
  const s = await env.SIGN_DB.prepare('SELECT * FROM sign_seals WHERE final_hash = ?').bind(hash).first();
  if (s) {
    const row = await env.SIGN_DB.prepare('SELECT attest_json, attest_sig FROM sign_envelopes WHERE id = ?').bind(s.envelope_id).first();
    return json({ found: true, envelopeId: s.envelope_id, seal: { json: s.seal_json, sig: s.seal_sig, kid: s.kid }, audit: row && row.attest_json ? { json: row.attest_json, sig: row.attest_sig } : null });
  }
  const claimed = String(body.envelopeId || '');
  if (ID_RE.test(claimed)) {
    const other = await env.SIGN_DB.prepare('SELECT sealed_at FROM sign_seals WHERE envelope_id = ? ORDER BY sealed_at LIMIT 1').bind(claimed).first();
    if (other) return json({ found: false, known: true, envelopeId: claimed, sealedAt: iso(other.sealed_at) });
  }
  return json({ found: false, known: false });
}

// ---------- router ----------
export async function signApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== url.host) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  }
  if (path === '/api/sign/key') return method === 'GET' ? publicKey(request, env) : json({ error: 'Use GET.' }, 405);
  if (!env.SIGN_DB || !env.SIGN_BUCKET) return json({ error: 'Massless Sign is not switched on here yet.' }, 501);
  try {
    if (path === '/api/sign/verify') return method === 'POST' ? await verify(request, env) : json({ error: 'Use POST.' }, 405);
    if (path === '/api/sign/envelopes') return method === 'POST' ? await createEnvelope(request, env, ctx) : json({ error: 'Use POST.' }, 405);
    const m = path.match(/^\/api\/sign\/envelopes\/([^/]+)(\/events|\/audit)?$/);
    if (!m) return json({ error: 'Not found' }, 404);
    const id = m[1];
    if (!ID_RE.test(id)) return json({ error: 'This envelope does not exist or was deleted.' }, 404);
    if (!m[2]) {
      if (method === 'GET') return await getEnvelope(request, env, id);
      if (method === 'DELETE') return await deleteEnvelope(request, env, id);
      return json({ error: 'Use GET or DELETE.' }, 405);
    }
    if (m[2] === '/events') return method === 'POST' ? await postEvent(request, env, id) : json({ error: 'Use POST.' }, 405);
    return method === 'GET' ? await getAudit(request, env, id) : json({ error: 'Use GET.' }, 405);
  } catch (e) {
    console.error('sign failed:', e?.message || e);
    return json({ error: 'Something went wrong with Chucksi Sign. Try again in a minute.' }, 500);
  }
}

// ---------- email invites (later) ----------
// v1 sends no email: links go out by copy, share sheet, QR code or in person. Cloudflare Email Service
// needs the Workers Paid plan. When it is on, add a gated POST /api/sign/envelopes/:id/invite that takes
// { index, to } from the owner and calls sendInvite(env, ...). Keep the key out of the mail path: send a
// link without #k= and let the sender share the key (or a short passphrase that wraps it) by another route,
// so the Worker and the mail provider still never see a readable document.
export async function sendInvite(env, { to, envelopeId, index, link }) {
  if (!env.SIGN_EMAIL) return { sent: false, reason: 'Email invites are not switched on.' };
  void to; void envelopeId; void index; void link;
  return { sent: false, reason: 'Not built yet.' };
}
