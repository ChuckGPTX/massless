// In-memory stand-ins for the Chucksi Sign bindings, for tests and local development.
// FakeD1 runs office/sign_schema.sql on an in-memory SQLite (node:sqlite), so the real SQL is exercised.
// FakeR2 keeps objects in a Map. Neither touches the disk.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { DatabaseSync } = await import('node:sqlite').catch(() => {
  throw new Error('FakeD1 needs Node 22.5 or newer (node:sqlite).');
});

const params = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a));
const plain = (row) => (row ? { ...row } : row);

class Stmt {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.db, this.sql, args); }
  #st() { return this.db.sqlite.prepare(this.sql); }
  async first(col) {
    const row = plain(this.#st().get(...params(this.args)));
    if (row == null) return null;
    return col ? (row[col] ?? null) : row;
  }
  async all() { return { success: true, results: this.#st().all(...params(this.args)).map(plain), meta: {} }; }
  async run() { return this._runSync(); }
  _runSync() {
    if (/\bRETURNING\b/i.test(this.sql)) {
      const results = this.#st().all(...params(this.args)).map(plain);
      return { success: true, results, meta: { changes: results.length } };
    }
    const r = this.#st().run(...params(this.args));
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async raw() { return this.#st().all(...params(this.args)).map((r) => Object.values(r)); }
}

export class FakeD1 {
  constructor(schemaPath = join(HERE, '..', '..', 'migrations', 'sign', '0001_init.sql')) {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(readFileSync(schemaPath, 'utf8'));
  }
  prepare(sql) { return new Stmt(this, sql); }
  async batch(stmts) {
    this.sqlite.exec('BEGIN');
    try {
      const out = stmts.map((s) => s._runSync());
      this.sqlite.exec('COMMIT');
      return out;
    } catch (e) {
      this.sqlite.exec('ROLLBACK');
      throw e;
    }
  }
  async exec(sql) { this.sqlite.exec(sql); return { count: 1 }; }
  /** Every row of every table, for tests that look for plaintext. */
  dump() {
    const tables = this.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    return Object.fromEntries(tables.map((t) => [t, this.sqlite.prepare(`SELECT * FROM ${t}`).all().map(plain)]));
  }
}

const toBytes = async (v) => {
  if (v instanceof Uint8Array) return new Uint8Array(v);
  if (v instanceof ArrayBuffer) return new Uint8Array(v.slice(0));
  if (typeof v === 'string') return new TextEncoder().encode(v);
  if (v && typeof v.arrayBuffer === 'function') return new Uint8Array(await v.arrayBuffer());
  throw new Error('FakeR2.put: unsupported value');
};

export class FakeR2 {
  constructor() { this.objects = new Map(); }
  async put(key, value, opts = {}) {
    const bytes = await toBytes(value);
    this.objects.set(key, { bytes, httpMetadata: opts.httpMetadata || {}, uploaded: new Date() });
    return { key, size: bytes.length };
  }
  async get(key) {
    const o = this.objects.get(key);
    if (!o) return null;
    return {
      key, size: o.bytes.length, httpMetadata: o.httpMetadata, uploaded: o.uploaded,
      arrayBuffer: async () => o.bytes.slice().buffer,
      text: async () => new TextDecoder().decode(o.bytes),
      get body() { return new Blob([o.bytes]).stream(); },
    };
  }
  async head(key) { const o = this.objects.get(key); return o ? { key, size: o.bytes.length } : null; }
  async delete(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k); }
  async list({ prefix = '', limit = 1000 } = {}) {
    const objects = [...this.objects.entries()].filter(([k]) => k.startsWith(prefix)).slice(0, limit).map(([key, o]) => ({ key, size: o.bytes.length }));
    return { objects, truncated: false };
  }
}

/** A fresh ECDSA P-256 private JWK as a string, the format SIGN_KEY expects. */
export async function makeSignKey() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  return JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });
}

export async function fakeEnv(extra = {}) {
  return { SIGN_DB: new FakeD1(), SIGN_BUCKET: new FakeR2(), SIGN_KEY: await makeSignKey(), ...extra };
}
