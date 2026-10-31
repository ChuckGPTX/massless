// The reel lives in IndexedDB, in this browser only.

const DB = 'massless';
const STORE = 'shots';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    let out;
    t.oncomplete = () => { db.close(); resolve(out?.result); };
    t.onabort = () => { db.close(); reject(t.error || new DOMException('The save was cancelled.', 'AbortError')); };
    try { out = fn(t.objectStore(STORE)); }
    catch (error) { t.abort(); db.close(); reject(error); }
  });
}

export async function all() {
  const db = await open();
  return await tx(db, 'readonly', (s) => s.getAll());
}

export async function put(item) {
  const db = await open();
  await tx(db, 'readwrite', (s) => s.put(item));
  // A display limit must never delete the user's originals. Only del() removes saved work.
}

export async function get(id) {
  const db = await open();
  return (await tx(db, 'readonly', (s) => s.get(id))) ?? null;
}

export async function del(id) {
  const db = await open();
  await tx(db, 'readwrite', (s) => s.delete(id));
}
