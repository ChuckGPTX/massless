// Chucksi Sign crypto, shared by the sender (Office > Sign), the signer page (/sign) and the tests.
// Everything here is Web Crypto: AES-GCM 256 for envelopes, SHA-256 fingerprints, ECDSA P-256 to check
// the Worker's attestation, PBKDF2 for encrypted Deals exports. The envelope key never leaves the browser:
// it travels only in the link fragment (#k=...), which browsers never send to a server.

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

export const AAD = {
  doc: 'massless-sign:v1:doc',
  signer: (i) => `massless-sign:v1:signer:${i}`,
  decline: (i) => `massless-sign:v1:decline:${i}`,
  deals: 'massless-sign:v1:deals',
};

// ---------- encodings ----------
export function b64u(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s) {
  const t = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const hex = (bytes) => [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, '0')).join('');
export const utf8 = (s) => enc.encode(s);
export const fromUtf8 = (b) => dec.decode(b);

export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

// ---------- fingerprints ----------
export async function sha256(bytes) {
  return new Uint8Array(await subtle().digest('SHA-256', typeof bytes === 'string' ? enc.encode(bytes) : bytes));
}
export const sha256Hex = async (bytes) => hex(await sha256(bytes));

/** Stable JSON: keys sorted, no whitespace. The Worker signs exactly this form. */
export function canonical(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}

// ---------- envelope key ----------
/** A fresh random AES-GCM 256 key. `raw` is the base64url form that goes in the link fragment. */
export async function newKey() {
  const raw = randomBytes(32);
  return { key: await importKey(raw), raw: b64u(raw) };
}
export async function importKey(raw) {
  const bytes = typeof raw === 'string' ? unb64u(raw) : raw;
  if (bytes.length !== 32) throw new Error('This link has a broken key. Ask the sender for a new link.');
  return subtle().importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypt: [1 byte version][12 byte IV][ciphertext + 16 byte tag]. `aad` binds the blob to its purpose. */
export async function encrypt(key, bytes, aad) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, typeof bytes === 'string' ? enc.encode(bytes) : bytes));
  const out = new Uint8Array(13 + ct.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(ct, 13);
  return out;
}
export async function decrypt(key, data, aad) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (b[0] !== 1 || b.length < 29) throw new Error('This envelope is in a format this page does not know.');
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: b.subarray(1, 13), additionalData: enc.encode(aad) }, key, b.subarray(13)));
  } catch {
    throw new Error('This link cannot open the envelope. The key in the link is wrong or the envelope was changed.');
  }
}
export const encryptJson = (key, obj, aad) => encrypt(key, enc.encode(JSON.stringify(obj)), aad);
export const decryptJson = async (key, data, aad) => JSON.parse(dec.decode(await decrypt(key, data, aad)));

// ---------- envelope bundle: "MSB1" + uint32 meta length + meta JSON + PDF bytes ----------
export function pack(meta, pdf) {
  const m = enc.encode(JSON.stringify(meta));
  const out = new Uint8Array(8 + m.length + pdf.length);
  out.set([0x4d, 0x53, 0x42, 0x31], 0);
  new DataView(out.buffer).setUint32(4, m.length);
  out.set(m, 8);
  out.set(pdf, 8 + m.length);
  return out;
}
export function unpack(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b[0] !== 0x4d || b[1] !== 0x53 || b[2] !== 0x42 || b[3] !== 0x31) throw new Error('This envelope is in a format this page does not know.');
  const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(4);
  return { meta: JSON.parse(dec.decode(b.subarray(8, 8 + n))), pdf: b.slice(8 + n) };
}

// ---------- links ----------
export function parseFragment(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  return Object.fromEntries(p.entries());
}
export function signLink(origin, id, token, key, extra = {}) {
  const q = new URLSearchParams({ e: id, s: token, k: key, ...extra });
  return `${origin}/sign#${q.toString()}`;
}
export function manageLink(origin, id, owner, key) {
  return `${origin}/sign#${new URLSearchParams({ e: id, o: owner, k: key }).toString()}`;
}

// ---------- attestation ----------
const keyCache = new Map();
/** Check the Worker's ECDSA P-256 signature (IEEE P1363, base64url) over a canonical JSON string. */
export async function verifySignature(jwk, text, sigB64u) {
  const id = `${jwk.x}.${jwk.y}`;
  let key = keyCache.get(id);
  if (!key) {
    key = await subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    keyCache.set(id, key);
  }
  try {
    return await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64u(sigB64u), enc.encode(text));
  } catch {
    return false;
  }
}
/** RFC 7638 thumbprint of an EC public key: the key ID printed on certificates. */
export async function thumbprint(jwk) {
  return b64u(await sha256(canonical({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })));
}

// ---------- passphrase encryption for Deals exports ----------
export async function passKey(pass, salt, iterations = 310000) {
  const base = await subtle().importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
