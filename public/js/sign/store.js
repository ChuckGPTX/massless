// Massless Sign local storage (IndexedDB, this browser only): envelopes you sent, Deals and their files.
// Envelope records hold the owner token, the signer tokens and the key, so this device can show status,
// share links again and build the final PDF. Export a Deal as an encrypted file to move it.

const DB = 'massless-sign';
const VERSION = 1;
const STORES = ['envelopes', 'deals', 'files'];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error || new Error('This browser blocked local storage.')); };
  });
  return dbp;
}

function run(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage was blocked.'));
  }));
}

export const all = (store) => run(store, 'readonly', (s) => s.getAll()).then((r) => r || []);
export const get = (store, id) => run(store, 'readonly', (s) => s.get(id)).then((r) => r || null);
export const put = (store, item) => run(store, 'readwrite', (s) => s.put({ ...item, updated: Date.now() }));
export const del = (store, id) => run(store, 'readwrite', (s) => s.delete(id));

export const envelopes = {
  all: () => all('envelopes').then((l) => l.sort((a, b) => b.created - a.created)),
  get: (id) => get('envelopes', id),
  put: (e) => put('envelopes', e),
  del: (id) => del('envelopes', id),
};
export const deals = {
  all: () => all('deals').then((l) => l.sort((a, b) => (b.updated || 0) - (a.updated || 0))),
  get: (id) => get('deals', id),
  put: (d) => put('deals', d),
  del: async (id) => {
    const d = await get('deals', id);
    for (const f of d?.files || []) await del('files', f);
    return del('deals', id);
  },
};
export const files = {
  get: (id) => get('files', id),
  put: (f) => put('files', f),
  del: (id) => del('files', id),
};
