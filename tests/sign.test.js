// Chucksi Sign: Worker routes (src/sign.js) on in-memory R2 and D1 (SQLite running migrations/sign),
// the Worker wiring in src/index.js, and the encrypted Deals export. Runs with `npm test`.
// Covers create, caps, signing order, consent, decline, completion, attestation and seal signatures,
// verify pass and tamper fail, expiry and cleanup, delete, and that storage never holds plaintext.
// The browser side is played by public/js/sign/crypto.js, the same module the pages use.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { IDBFactory } from 'fake-indexeddb';
import worker from '../src/index.js';
import { signApi, signGated, signCleanup, _setClock, SIGN_LIMITS } from '../src/sign.js';
import { fakeEnv } from '../tools/sign/fakes.mjs';
import * as C from '../public/js/sign/crypto.js';

test('Sign routes: envelopes, order, consent, decline, attestation, verify, expiry, caps, privacy', async () => {
  const results = [];
  const failed = [];
  function check(name, cond, detail) {
    results.push({ name, ok: !!cond });
    if (!cond) failed.push(`${name}${detail !== undefined ? ` :: ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
    return cond;
  }

  const ORIGIN = 'https://chucksi.com';
  const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);
  let now = T0;
  _setClock(() => now);
  const DAY = 86400000;
  const waits = [];
  const ctx = { waitUntil: (p) => waits.push(p) };

  async function call(env, method, path, { token, json, form, ip = '203.0.113.7', ua = 'TestAgent/1.0', origin } = {}) {
    const headers = { 'cf-connecting-ip': ip, 'user-agent': ua };
    if (token) headers.authorization = `Bearer ${token}`;
    if (origin) headers.origin = origin;
    let body;
    if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) body = form;
    const res = await signApi(new Request(ORIGIN + path, { method, headers, body }), env, ctx);
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    return { status: res.status, data };
  }

  // ---------- the "browser": build an encrypted envelope like Office > Sign does ----------
  const SECRETS = {
    text: 'SECRET-CONTRACT-TEXT confidential terms 7731',
    names: ['Alice Example', 'Bob Sample'],
    emails: ['alice@example.com', 'bob@example.org'],
    message: 'Please sign the purple hippo agreement',
    typed: 'Typed Title Value 4242',
    reason: 'Decline reason: the price is wrong 9001',
  };
  const fakePdf = C.utf8(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n% ${SECRETS.text}\n%%EOF\n`);

  async function makeEnvelope(env, { signers = 2, routing = 'sequential', ip, pdf = fakePdf } = {}) {
    const { key, raw } = await C.newKey();
    const docHash = await C.sha256Hex(pdf);
    const meta = {
      v: 1, name: 'Purple Hippo NDA.pdf', docHash, routing, message: SECRETS.message,
      signers: Array.from({ length: signers }, (_, i) => ({ index: i, name: SECRETS.names[i % 2], email: SECRETS.emails[i % 2], role: `party${i}`, order: i + 1 })),
      fields: [{ id: 'f1', type: 'signature', role: 'party0', page: 0, x: 72, y: 600, w: 180, h: 40 }],
    };
    const blob = await C.encrypt(key, C.pack(meta, pdf), C.AAD.doc);
    const form = new FormData();
    form.append('meta', JSON.stringify({ v: 1, docHash, routing, signers: meta.signers.map((s) => ({ order: s.order })) }));
    form.append('blob', new Blob([blob]), 'envelope.bin');
    const r = await call(env, 'POST', '/api/sign/envelopes', { form, ip });
    return { ...r, key, raw, docHash, meta, blob };
  }

  async function signAs(env, e, i, { inPerson = false } = {}) {
    const token = e.data.signerTokens[i];
    const path = `/api/sign/envelopes/${e.data.id}/events`;
    const c = await call(env, 'POST', path, { token, json: { type: 'consented', docHash: e.docHash, disclosure: 'esign-2026-10' } });
    const values = { f1: { kind: 'signature', png: 'iVBORw0KGgo-fake' }, title: SECRETS.typed, name: SECRETS.names[i % 2] };
    const payload = C.b64u(await C.encryptJson(e.key, { values }, C.AAD.signer(i)));
    const s = await call(env, 'POST', path, { token, json: { type: 'signed', docHash: e.docHash, payload, fields: 3, valuesHash: await C.sha256Hex(C.canonical(values)), inPerson } });
    return { c, s };
  }

  const env = await fakeEnv();

  // ---------- key ----------
  {
    const k = await call(env, 'GET', '/api/sign/key');
    check('key: served as a public JWK', k.status === 200 && k.data.kty === 'EC' && k.data.crv === 'P-256' && !k.data.d, k.data);
    check('key: kid is the RFC 7638 thumbprint', k.data.kid === await C.thumbprint(k.data));
    const noKey = await call({ ...env, SIGN_KEY: undefined }, 'GET', '/api/sign/key');
    check('key: 503 without SIGN_KEY', noKey.status === 503);
    const off = await call({}, 'POST', '/api/sign/envelopes', { json: { dryRun: true } });
    check('router: 501 without bindings', off.status === 501);
  }

  // ---------- gating and origin ----------
  check('gated: create, verify and events', signGated('/api/sign/envelopes') && signGated('/api/sign/verify') && signGated('/api/sign/envelopes/AAAAAAAAAAAAAAAAAAAAAA/events'));
  check('gated: GETs are not', !signGated('/api/sign/key') && !signGated('/api/sign/envelopes/AAAAAAAAAAAAAAAAAAAAAA'));
  {
    const x = await call(env, 'POST', '/api/sign/envelopes', { json: { dryRun: true }, origin: 'https://evil.example' });
    check('origin: cross-site POST refused', x.status === 403);
  }

  // ---------- create: validation ----------
  {
    const dry = await call(env, 'POST', '/api/sign/envelopes', { json: { dryRun: true } });
    check('create: dry run reports the daily allowance', dry.status === 200 && dry.data.remainingToday === SIGN_LIMITS.perVisitorDaily && dry.data.limits.maxBytes === SIGN_LIMITS.maxBytes, dry.data);
    const bad = await call(env, 'POST', '/api/sign/envelopes', { json: { hello: 1 } });
    check('create: JSON without dryRun is refused', bad.status === 400);
    const mk = (meta, blob) => { const f = new FormData(); f.append('meta', JSON.stringify(meta)); f.append('blob', new Blob([blob])); return f; };
    const h = 'a'.repeat(64);
    const ct = new Uint8Array(100); ct[0] = 1;
    check('create: no signers', (await call(env, 'POST', '/api/sign/envelopes', { form: mk({ docHash: h, signers: [] }, ct) })).status === 400);
    check('create: 11 signers', (await call(env, 'POST', '/api/sign/envelopes', { form: mk({ docHash: h, signers: Array(11).fill({}) }, ct) })).status === 400);
    check('create: plaintext PDF refused', (await call(env, 'POST', '/api/sign/envelopes', { form: mk({ docHash: h, signers: [{}] }, fakePdf) })).status === 400);
    check('create: missing fingerprint', (await call(env, 'POST', '/api/sign/envelopes', { form: mk({ signers: [{}] }, ct) })).status === 400);
    const big = new Uint8Array(SIGN_LIMITS.maxBytes + 10); big[0] = 1;
    check('create: over 10 MB refused', (await call(env, 'POST', '/api/sign/envelopes', { form: mk({ docHash: h, signers: [{}] }, big) })).status === 413);
  }

  // ---------- sequential envelope, end to end ----------
  const e = await makeEnvelope(env);
  check('create: 201 with id, owner token and one token per signer', e.status === 201 && /^[A-Za-z0-9_-]{22}$/.test(e.data.id) && /^[A-Za-z0-9_-]{43}$/.test(e.data.ownerToken) && e.data.signerTokens.length === 2, e.data);
  check('create: expires in 30 days', e.data.expiresAt === new Date(T0 + 30 * DAY).toISOString());
  check('create: tokens are distinct', new Set([e.data.ownerToken, ...e.data.signerTokens]).size === 3);
  const id = e.data.id;
  const P = `/api/sign/envelopes/${id}`;
  {
    const rows = env.SIGN_DB.dump();
    const stored = JSON.stringify(rows);
    check('tokens: only SHA-256 hashes are stored', ![e.data.ownerToken, ...e.data.signerTokens].some((t) => stored.includes(t)) && rows.sign_envelopes[0].owner_hash === await C.sha256Hex(e.data.ownerToken));
    check('create: logged a created event with IP and user agent', rows.sign_events.length === 1 && rows.sign_events[0].type === 'created' && rows.sign_events[0].ip === '203.0.113.7' && rows.sign_events[0].ua === 'TestAgent/1.0');
  }
  {
    check('auth: no token is 401', (await call(env, 'GET', P)).status === 401);
    check('auth: wrong token is 403', (await call(env, 'GET', P, { token: C.b64u(C.randomBytes(32)) })).status === 403);
    check('auth: unknown envelope is 404', (await call(env, 'GET', '/api/sign/envelopes/BBBBBBBBBBBBBBBBBBBBBB', { token: e.data.ownerToken })).status === 404);
    const own = await call(env, 'GET', P, { token: e.data.ownerToken });
    check('get: owner sees status and ciphertext', own.status === 200 && own.data.you.kind === 'owner' && own.data.doc && own.data.waitingOn.join() === '0', own.data && { ...own.data, doc: undefined });
    const back = C.unpack(await C.decrypt(e.key, C.unb64u(own.data.doc), C.AAD.doc));
    check('get: ciphertext decrypts to the same PDF and layout', C.fromUtf8(back.pdf) === C.fromUtf8(fakePdf) && back.meta.signers[0].name === SECRETS.names[0]);
    const st = await call(env, 'GET', `${P}?parts=status`, { token: e.data.signerTokens[1] });
    check('get: parts=status skips the ciphertext', st.status === 200 && !st.data.doc && st.data.you.kind === 'signer' && st.data.you.index === 1 && st.data.you.turn === false);
    const s0 = await call(env, 'GET', `${P}?parts=status`, { token: e.data.signerTokens[0] });
    check('get: first signer has the turn', s0.data.you.turn === true);
  }
  {
    const t1 = e.data.signerTokens[1];
    const early = await call(env, 'POST', `${P}/events`, { token: t1, json: { type: 'consented', docHash: e.docHash } });
    check('order: second signer cannot consent before the first signs', early.status === 409 && early.data.notYourTurn === true && early.data.waitingOn.join() === '0', early.data);
    const payload = C.b64u(await C.encryptJson(e.key, { values: {} }, C.AAD.signer(1)));
    const earlySign = await call(env, 'POST', `${P}/events`, { token: t1, json: { type: 'signed', docHash: e.docHash, payload } });
    check('order: second signer cannot sign before the first', earlySign.status === 409 && earlySign.data.notYourTurn === true);
    const t0 = e.data.signerTokens[0];
    const wrongDoc = await call(env, 'POST', `${P}/events`, { token: t0, json: { type: 'viewed', docHash: 'b'.repeat(64) } });
    check('events: a different document fingerprint is refused', wrongDoc.status === 409 && wrongDoc.data.mismatch === true);
    const v1 = await call(env, 'POST', `${P}/events`, { token: t0, json: { type: 'viewed', docHash: e.docHash } });
    const v2 = await call(env, 'POST', `${P}/events`, { token: t0, json: { type: 'viewed', docHash: e.docHash } });
    check('events: viewed is logged once per 10 minutes', v1.status === 200 && v1.data.seq === 2 && v2.data.deduped === true);
    const noConsent = await call(env, 'POST', `${P}/events`, { token: t0, json: { type: 'signed', docHash: e.docHash, payload: C.b64u(await C.encryptJson(e.key, {}, C.AAD.signer(0))) } });
    check('consent: signing before consent is refused', noConsent.status === 409);
    const plain = await call(env, 'POST', `${P}/events`, { token: t0, json: { type: 'consented', docHash: e.docHash } });
    const plainSign = await call(env, 'POST', `${P}/events`, { token: t0, json: { type: 'signed', docHash: e.docHash, payload: C.b64u(C.utf8('{"values":{"name":"Alice"}}')) } });
    check('signed: unencrypted fields are refused', plain.status === 200 && plainSign.status === 400);
    const bad = await call(env, 'POST', `${P}/events`, { token: t0, json: { type: 'completed', docHash: e.docHash } });
    check('events: signers cannot post server events', bad.status === 400);
    now += 60000;
    const r0 = await signAs(env, e, 0);
    check('sign: first signer signs, envelope still out', r0.s.status === 200 && r0.s.data.status === 'sent', r0.s.data);
    const dup = await signAs(env, e, 0);
    check('sign: signing twice is refused', dup.s.status === 409);
    const s1 = await call(env, 'GET', `${P}?parts=status`, { token: t1 });
    check('order: second signer gets the turn after the first signs', s1.data.you.turn === true && s1.data.signers[0].status === 'signed');
    const attestEarly = await call(env, 'POST', `${P}/events`, { token: e.data.ownerToken, json: { type: 'attest', signedHash: 'c'.repeat(64) } });
    check('attest: refused before everyone signs', attestEarly.status === 409);
    const ownerSign = await call(env, 'POST', `${P}/events`, { token: e.data.ownerToken, json: { type: 'signed', docHash: e.docHash } });
    check('events: the owner token cannot sign', ownerSign.status === 400);
    now += 60000;
    const r1 = await signAs(env, e, 1, { inPerson: true });
    check('sign: last signature completes the envelope', r1.s.status === 200 && r1.s.data.status === 'completed', r1.s.data);
    const done = await call(env, 'GET', P, { token: e.data.ownerToken });
    check('complete: status, expiry +90 days and both payloads returned', done.data.status === 'completed' && done.data.expiresAt === new Date(now + 90 * DAY).toISOString() && done.data.payloads.length === 2, { ...done.data, doc: undefined, payloads: done.data.payloads?.length });
    const p1 = await C.decryptJson(e.key, C.unb64u(done.data.payloads[1].data), C.AAD.signer(1));
    check('complete: signer payload decrypts in the browser', p1.values.title === SECRETS.typed);
    let swapped = false;
    try { await C.decryptJson(e.key, C.unb64u(done.data.payloads[1].data), C.AAD.signer(0)); swapped = true; } catch { /* expected */ }
    check('crypto: a payload cannot be passed off as another signer\'s', !swapped);
    const audit = await call(env, 'GET', `${P}/audit`, { token: e.data.signerTokens[0] });
    const types = audit.data.events.map((x) => x.type);
    check('audit: every event recorded in order', types.join(',') === 'created,viewed,consented,signed,consented,signed,completed', types);
    check('audit: server adds time, IP and user agent', audit.data.events.every((x) => x.at && (x.type === 'completed' || (x.ip === '203.0.113.7' && x.ua === 'TestAgent/1.0'))));
  }

  // ---------- attestation and seal ----------
  const key = (await call(env, 'GET', '/api/sign/key')).data;
  const signedPdf = C.utf8('%PDF-1.7 signed pages');
  const finalPdf = C.utf8('%PDF-1.7 signed pages + certificate of completion');
  const signedHash = await C.sha256Hex(signedPdf);
  const finalHash = await C.sha256Hex(finalPdf);
  let attest, seal;
  {
    const a = await call(env, 'POST', `${P}/events`, { token: e.data.signerTokens[1], json: { type: 'attest', signedHash } });
    attest = a.data.attest;
    check('attest: returns the signed audit record', a.status === 200 && attest && attest.signedHash === signedHash, a.data);
    check('attest: ECDSA signature verifies with /api/sign/key', await C.verifySignature(key, attest.json, attest.sig));
    const rec = JSON.parse(attest.json);
    check('attest: record has hashes, order, consent and signing times, IP and UA', rec.originalHash === e.docHash && rec.signedHash === signedHash && rec.signers.length === 2 && rec.signers.every((s) => s.consentedAt && s.signedAt && s.ip && s.ua && s.order) && rec.signers[1].inPerson === true && rec.kid === key.kid, rec);
    check('attest: record is canonical JSON', C.canonical(rec) === attest.json);
    const tampered = attest.json.replace('203.0.113.7', '203.0.113.8');
    check('attest: changing one character breaks the signature', tampered !== attest.json && !(await C.verifySignature(key, tampered, attest.sig)));
    const again = await call(env, 'POST', `${P}/events`, { token: e.data.ownerToken, json: { type: 'attest', signedHash: 'd'.repeat(64) } });
    check('attest: first fingerprint wins; a different copy is flagged', again.data.already === true && again.data.matches === false && again.data.attest.json === attest.json);
    const sealEarly = await call(env, 'POST', `/api/sign/envelopes/${(await makeEnvelope(env, { signers: 1 })).data.id}/events`, { token: e.data.ownerToken, json: { type: 'seal', finalHash } });
    check('seal: another envelope\'s owner token is refused', sealEarly.status === 403);
    const s = await call(env, 'POST', `${P}/events`, { token: e.data.ownerToken, json: { type: 'seal', finalHash } });
    seal = s.data.seal;
    check('seal: final fingerprint registered and signed', s.status === 200 && seal.finalHash === finalHash && await C.verifySignature(key, seal.json, seal.sig), s.data);
    const sj = JSON.parse(seal.json);
    check('seal: binds the audit record by hash', sj.auditHash === await C.sha256Hex(attest.json) && sj.originalHash === e.docHash && sj.signedHash === signedHash && sj.finalHash === finalHash);
  }

  // ---------- verify ----------
  {
    const ok = await call(env, 'POST', '/api/sign/verify', { json: { sha256: finalHash } });
    check('verify: the sealed file is found', ok.status === 200 && ok.data.found === true && ok.data.envelopeId === id && ok.data.audit && ok.data.audit.json === attest.json);
    check('verify: seal signature checks out', await C.verifySignature(key, ok.data.seal.json, ok.data.seal.sig) && JSON.parse(ok.data.seal.json).finalHash === finalHash);
    const t = finalPdf.slice(); t[12] ^= 1;
    const bad = await call(env, 'POST', '/api/sign/verify', { json: { sha256: await C.sha256Hex(t), envelopeId: id } });
    check('verify: one changed byte fails', bad.data.found === false && bad.data.known === true && bad.data.envelopeId === id, bad.data);
    const unknown = await call(env, 'POST', '/api/sign/verify', { json: { sha256: 'e'.repeat(64) } });
    check('verify: unknown file fails', unknown.data.found === false && unknown.data.known === false);
    check('verify: rejects a malformed hash', (await call(env, 'POST', '/api/sign/verify', { json: { sha256: 'xyz' } })).status === 400);
    const forged = JSON.parse(ok.data.seal.json); forged.finalHash = await C.sha256Hex(t);
    check('verify: a forged seal does not verify', !(await C.verifySignature(key, C.canonical(forged), ok.data.seal.sig)));
  }

  // ---------- decline ----------
  {
    const d = await makeEnvelope(env);
    const DP = `/api/sign/envelopes/${d.data.id}/events`;
    const reason = C.b64u(await C.encryptJson(d.key, { reason: SECRETS.reason }, C.AAD.decline(1)));
    const plainReason = await call(env, 'POST', DP, { token: d.data.signerTokens[1], json: { type: 'declined', docHash: d.docHash, reason: 'not encrypted, has spaces' } });
    check('decline: an unencrypted reason is refused', plainReason.status === 400);
    const dec = await call(env, 'POST', DP, { token: d.data.signerTokens[1], json: { type: 'declined', docHash: d.docHash, reason } });
    check('decline: a later signer can decline', dec.status === 200 && dec.data.status === 'declined');
    const after = await call(env, 'POST', DP, { token: d.data.signerTokens[0], json: { type: 'consented', docHash: d.docHash } });
    check('decline: nobody can sign a declined envelope', after.status === 409);
    const st = await call(env, 'GET', `/api/sign/envelopes/${d.data.id}?parts=status`, { token: d.data.ownerToken });
    check('decline: owner sees who declined, reason stays encrypted', st.data.status === 'declined' && st.data.signers[1].status === 'declined' && st.data.declines[0].index === 1 && st.data.declines[0].reason === reason && st.data.waitingOn.length === 0);
    const back = await C.decryptJson(d.key, C.unb64u(st.data.declines[0].reason), C.AAD.decline(1));
    check('decline: reason decrypts for people with the key', back.reason === SECRETS.reason);
    check('decline: cannot decline twice', (await call(env, 'POST', DP, { token: d.data.signerTokens[1], json: { type: 'declined', docHash: d.docHash } })).status === 409);
  }

  // ---------- parallel ----------
  {
    const p = await makeEnvelope(env, { signers: 3, routing: 'parallel' });
    const st = await call(env, 'GET', `/api/sign/envelopes/${p.data.id}?parts=status`, { token: p.data.ownerToken });
    check('parallel: everyone can sign at once', st.data.routing === 'parallel' && st.data.waitingOn.join() === '0,1,2');
    const r2 = await signAs(env, p, 2);
    const r0 = await signAs(env, p, 0);
    const r1 = await signAs(env, p, 1);
    check('parallel: any order completes', r2.s.data.status === 'sent' && r0.s.data.status === 'sent' && r1.s.data.status === 'completed');
  }

  // ---------- size budget for signer attachments ----------
  {
    const b = await makeEnvelope(env, { signers: 1 });
    const BP = `/api/sign/envelopes/${b.data.id}/events`;
    await call(env, 'POST', BP, { token: b.data.signerTokens[0], json: { type: 'consented', docHash: b.docHash } });
    const huge = new Uint8Array(SIGN_LIMITS.maxBytes); huge[0] = 1;
    const r = await call(env, 'POST', BP, { token: b.data.signerTokens[0], json: { type: 'signed', docHash: b.docHash, payload: C.b64u(huge) } });
    check('size: attachments cannot push an envelope over 10 MB', r.status === 413);
  }

  // ---------- plaintext never reaches storage ----------
  {
    const blobs = [...env.SIGN_BUCKET.objects.values()].map((o) => o.bytes);
    const latin = blobs.map((b) => Buffer.from(b).toString('latin1'));
    const rows = JSON.stringify(env.SIGN_DB.dump());
    const needles = [SECRETS.text, ...SECRETS.names, ...SECRETS.emails, SECRETS.message, SECRETS.typed, SECRETS.reason, '%PDF', 'Purple Hippo', 'iVBORw0KGgo'];
    const leaks = needles.filter((n) => latin.some((s) => s.includes(n)) || rows.includes(n));
    check('privacy: R2 and D1 hold no document text, names, emails, values, signatures or reasons', leaks.length === 0 && blobs.length >= 5, leaks);
    check('privacy: every R2 object is versioned ciphertext', blobs.every((b) => b[0] === 1 && b.length >= 29));
  }

  // ---------- events cap ----------
  {
    const c = await makeEnvelope(env, { signers: 1 });
    const CP = `/api/sign/envelopes/${c.data.id}/events`;
    let last;
    for (let i = 0; i < SIGN_LIMITS.maxEvents; i++) last = await call(env, 'POST', CP, { token: c.data.ownerToken, json: { type: 'downloaded', what: 'original' } });
    check('limits: events per envelope are capped', last.status === 429);
  }

  // ---------- caps ----------
  {
    const capEnv = await fakeEnv({ PER_VISITOR_SIGN: '3', SIGN_CAP: '5' });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await makeEnvelope(capEnv, { signers: 1, ip: '198.51.100.1' })).status);
    check('caps: per-visitor daily cap', codes.join() === '201,201,201,429', codes);
    const dry = await call(capEnv, 'POST', '/api/sign/envelopes', { json: { dryRun: true }, ip: '198.51.100.1' });
    check('caps: dry run shows nothing left', dry.data.remainingToday === 0);
    const other = [];
    for (let i = 0; i < 3; i++) other.push((await makeEnvelope(capEnv, { signers: 1, ip: '198.51.100.2' })).status);
    check('caps: total daily cap across visitors', other.join() === '201,201,429', other);
    now += DAY;
    check('caps: reset the next day', (await makeEnvelope(capEnv, { signers: 1, ip: '198.51.100.1' })).status === 201);
    now -= DAY;
  }

  // ---------- delete ----------
  {
    const x = await makeEnvelope(env, { signers: 1 });
    const XP = `/api/sign/envelopes/${x.data.id}`;
    await signAs(env, x, 0);
    await call(env, 'POST', `${XP}/events`, { token: x.data.ownerToken, json: { type: 'attest', signedHash } });
    const xs = await call(env, 'POST', `${XP}/events`, { token: x.data.ownerToken, json: { type: 'seal', finalHash: 'f'.repeat(64) } });
    check('delete: setup sealed', xs.status === 200);
    check('delete: signers cannot delete', (await call(env, 'DELETE', XP, { token: x.data.signerTokens[0] })).status === 403);
    const del = await call(env, 'DELETE', XP, { token: x.data.ownerToken });
    check('delete: owner can delete any time', del.status === 200 && del.data.deleted === true);
    check('delete: envelope is gone', (await call(env, 'GET', XP, { token: x.data.ownerToken })).status === 404);
    check('delete: ciphertext is gone from R2', ![...env.SIGN_BUCKET.objects.keys()].some((k) => k.startsWith(`e/${x.data.id}/`)));
    const v = await call(env, 'POST', '/api/sign/verify', { json: { sha256: 'f'.repeat(64) } });
    check('delete: the anonymous seal still verifies downloaded copies', v.data.found === true && v.data.audit === null);
  }

  // ---------- expiry ----------
  {
    const u = await makeEnvelope(env, { signers: 1 });
    const UP = `/api/sign/envelopes/${u.data.id}`;
    now = T0 + 29 * DAY;
    check('expiry: unsigned envelope is open on day 29', (await call(env, 'GET', `${UP}?parts=status`, { token: u.data.ownerToken })).status === 200);
    now = Date.parse(u.data.expiresAt) + 1;
    const gone = await call(env, 'GET', UP, { token: u.data.ownerToken });
    check('expiry: unsigned envelope expires after 30 days', gone.status === 410 && gone.data.expired === true);
    check('expiry: expired ciphertext is deleted', ![...env.SIGN_BUCKET.objects.keys()].some((k) => k.startsWith(`e/${u.data.id}/`)));
    // the completed envelope from above completed at T0 + 2 minutes: kept 90 days
    check('expiry: completed envelope is kept past 30 days', (await call(env, 'GET', `${P}?parts=status`, { token: e.data.ownerToken })).status === 200);
    now = T0 + 89 * DAY;
    check('expiry: completed envelope is kept on day 89', (await call(env, 'GET', `${P}?parts=status`, { token: e.data.ownerToken })).status === 200);
    now = T0 + 91 * DAY;
    const n = await signCleanup(env, 500);
    check('expiry: cleanup sweeps every expired envelope', n >= 1 && env.SIGN_DB.dump().sign_envelopes.every((r) => r.expires_at > now), n);
    check('expiry: completed envelope deleted after 90 days', (await call(env, 'GET', P, { token: e.data.ownerToken })).status === 404);
    const v = await call(env, 'POST', '/api/sign/verify', { json: { sha256: finalHash } });
    check('expiry: the seal outlives the envelope', v.data.found === true && v.data.audit === null && await C.verifySignature(key, v.data.seal.json, v.data.seal.sig));
  }

  await Promise.allSettled(waits);
  _setClock(null);
  assert.deepEqual(failed, [], `${failed.length} of ${results.length} checks failed`);
  assert.ok(results.length >= 85, `ran ${results.length} checks`);
});

test('Sign is wired into the Worker: human check on POSTs, 501 without bindings, key route', async () => {
  const env = { TURNSTILE_SITEKEY: 'site', TURNSTILE_SECRET: 'secret', PASS_KEY: 'k' };
  for (const path of ['/api/sign/envelopes', '/api/sign/verify', '/api/sign/envelopes/AAAAAAAAAAAAAAAAAAAAAA/events']) {
    const r = await worker.fetch(new Request(`https://massless.test${path}`, { method: 'POST', body: '{}' }), env, { waitUntil() {} });
    assert.equal(r.status, 401, path);
    assert.equal((await r.json()).human, true, path);
  }
  const off = await worker.fetch(new Request('https://massless.test/api/sign/envelopes/AAAAAAAAAAAAAAAAAAAAAA'), {}, { waitUntil() {} });
  assert.equal(off.status, 501);
  const key = await worker.fetch(new Request('https://massless.test/api/sign/key'), await fakeEnv(), { waitUntil() {} });
  assert.equal(key.status, 200);
  assert.equal((await key.json()).crv, 'P-256');
  assert.ok(signGated('/api/sign/envelopes') && !signGated('/api/sign/key'));
});

test('Sign cron sweeps expired envelopes', async () => {
  const env = await fakeEnv();
  const ctx = { pending: [], waitUntil(p) { this.pending.push(p); } };
  await worker.scheduled({}, env, ctx);
  await Promise.all(ctx.pending);
  assert.equal(env.SIGN_DB.dump().sign_envelopes.length, 0);
});

test('/sign page is served with pinned scripts and the legal notices', async () => {
  const originalFetch = globalThis.fetch, originalCaches = globalThis.caches;
  const sha = 'b'.repeat(40);
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname.split('/public/')[1];
    try { return new Response(await readFile(new URL(`../public/${path}`, import.meta.url))); } catch { return new Response('missing', { status: 404 }); }
  };
  try {
    for (const route of ['/sign', '/sign/', '/sign/index.html']) {
      const r = await worker.fetch(new Request(`https://massless.test${route}`), { ASSET_REF: sha }, { waitUntil() {} });
      assert.equal(r.status, 200, route);
      const html = await r.text();
      assert.ok(html.includes(`/v/${sha}/js/sign/signer.js`) && html.includes(`/v/${sha}/css/sign.css`), route);
      assert.match(html, /not legal advice/);
      assert.match(html, /wills/);
    }
  } finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
});

test('Deals export is encrypted and imports back with the passphrase only', async () => {
  globalThis.indexedDB = new IDBFactory();
  const { deals, files, envelopes } = await import('../public/js/sign/store.js');
  const { newDealObject, exportDeals, importDeals, PRESETS } = await import('../public/js/sign/deals.js');
  assert.deepEqual(Object.keys(PRESETS), ['residential', 'subto', 'lease', 'music', 'sync', 'blank']);
  const d = newDealObject('music', 'Midnight Static');
  assert.equal(d.tasks.length, 12);
  d.tasks[0].done = true;
  d.people.push({ id: 'p1', name: 'Ava Chen', email: 'ava@example.com', role: 'Songwriter' });
  await files.put({ id: 'f1', dealId: d.id, name: 'stems.txt', type: 'text/plain', size: 5, created: 1, blob: new Blob(['stems']) });
  await envelopes.put({ id: 'AAAAAAAAAAAAAAAAAAAAAA', name: 'Split sheet.pdf', created: 1, key: 'k', ownerToken: 'secret-owner', signers: [] });
  d.files = ['f1'];
  d.envelopes = ['AAAAAAAAAAAAAAAAAAAAAA'];
  await deals.put(d);
  const text = await (await exportDeals([d.id], 'correct horse battery')).text();
  for (const needle of ['Midnight', 'Ava Chen', 'secret-owner', 'stems']) assert.ok(!text.includes(needle), needle);
  await deals.del(d.id);
  await envelopes.del('AAAAAAAAAAAAAAAAAAAAAA');
  await assert.rejects(importDeals(text, 'wrong passphrase'), /Wrong passphrase/);
  const back = await importDeals(text, 'correct horse battery');
  assert.equal(back[0].title, 'Midnight Static');
  const got = await deals.get(d.id);
  assert.equal(got.tasks.filter((t) => t.done).length, 1);
  assert.equal(await (await files.get('f1')).blob.text(), 'stems');
  assert.equal((await envelopes.get('AAAAAAAAAAAAAAAAAAAAAA')).ownerToken, 'secret-owner');
});
