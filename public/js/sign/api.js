// Client for the Chucksi Sign Worker routes. Every POST goes through apiFetch, which answers the
// Turnstile human check once and retries. Tokens travel in the Authorization header; keys never leave.

import { apiFetch } from '../human.js';
import { b64u, unb64u } from './crypto.js';

export class SignError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data || {}; }
}

async function read(res) {
  let data = {};
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    let msg = data.error;
    if (!msg) {
      if (res.status === 404 && !data.error) msg = 'Chucksi Sign is not switched on here yet.';
      else if (res.status >= 500) msg = 'The signing server had a problem. Try again in a minute.';
      else msg = `Something went wrong (${res.status}). Try again.`;
    }
    if (res.status === 501) msg = data.error || 'Chucksi Sign is not switched on here yet.';
    throw new SignError(msg, res.status, data);
  }
  return data;
}
async function req(url, init) {
  let res;
  try { res = await apiFetch(url, init); } catch { throw new SignError("Couldn't reach the server. Check your connection and try again.", 0); }
  return read(res);
}

/** Check the daily allowance and earn the human pass before uploading. */
export const dryRun = () => req('/api/sign/envelopes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dryRun: true }) });

/** Create an envelope from ciphertext. Returns { id, ownerToken, signerTokens, expiresAt }. */
export function createEnvelope(meta, blob) {
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  form.append('blob', new Blob([blob], { type: 'application/octet-stream' }), 'envelope.bin');
  return req('/api/sign/envelopes', { method: 'POST', body: form });
}

export const verifyHash = (sha256, envelopeId) => req('/api/sign/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sha256, envelopeId: envelopeId || undefined }) });

let keyP = null;
export function publicKey() {
  return (keyP ||= fetch('/api/sign/key').then(read).catch((e) => { keyP = null; throw e; }));
}

export class Envelope {
  constructor(id, token) { this.id = id; this.token = token; this.base = `/api/sign/envelopes/${encodeURIComponent(id)}`; }
  headers(extra = {}) { return { authorization: `Bearer ${this.token}`, ...extra }; }
  async get({ status = false } = {}) {
    let res;
    try { res = await fetch(`${this.base}${status ? '?parts=status' : ''}`, { headers: this.headers(), cache: 'no-store' }); } catch { throw new SignError("Couldn't reach the server. Check your connection and try again.", 0); }
    return read(res);
  }
  async audit() {
    let res;
    try { res = await fetch(`${this.base}/audit`, { headers: this.headers(), cache: 'no-store' }); } catch { throw new SignError("Couldn't reach the server.", 0); }
    return read(res);
  }
  event(type, body = {}) {
    return req(`${this.base}/events`, { method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ type, ...body }) });
  }
  async remove() {
    let res;
    try { res = await fetch(this.base, { method: 'DELETE', headers: this.headers() }); } catch { throw new SignError("Couldn't reach the server.", 0); }
    return read(res);
  }
}

export { b64u, unb64u };
