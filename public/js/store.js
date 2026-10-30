// The reel lives in IndexedDB, in this browser only.

const DB = 'massless';
const STORE = 'shots';
const MAX_ITEMS = 24;

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
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

export async function all() {
  const db = await open();
  return await new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function put(item) {
  const db = await open();
  await tx(db, 'readwrite', (s) => s.put(item));
  const kind = item.kind || 'shot';
  const items = (await all()).filter((x) => (x.kind || 'shot') === kind);
  if (items.length > MAX_ITEMS) {
    items.sort((a, b) => a.created - b.created);
    const extra = items.slice(0, items.length - MAX_ITEMS);
    await tx(db, 'readwrite', (s) => extra.forEach((x) => s.delete(x.id)));
  }
}

export async function get(id) {
  const db = await open();
  return await new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function del(id) {
  const db = await open();
  await tx(db, 'readwrite', (s) => s.delete(id));
}
