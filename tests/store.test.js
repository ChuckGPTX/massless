import { beforeEach, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import * as store from '../public/js/store.js';

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });
const item = (n, kind = 'shot') => ({ id: `${kind}-${n}`, kind, created: n, blob: new Blob([`original-${n}`]) });

test('saving beyond 24 shots preserves every original and its bytes', async () => {
  for (let n = 0; n < 30; n++) await store.put(item(n));
  assert.equal((await store.all()).length, 30);
  assert.equal(await (await store.get('shot-0')).blob.text(), 'original-0');
});

test('saving beyond 24 audio items does not remove audio or shots', async () => {
  await store.put(item(0));
  for (let n = 0; n < 26; n++) await store.put(item(n, 'audio'));
  assert.equal((await store.all()).length, 27);
  assert.ok(await store.get('audio-0'));
  assert.ok(await store.get('shot-0'));
});

test('legacy shots without kind survive new saves', async () => {
  await store.put({ id: 'legacy', created: 0, prompt: 'original' });
  for (let n = 0; n < 25; n++) await store.put(item(n));
  assert.equal((await store.get('legacy')).prompt, 'original');
});

test('concurrent saves preserve all items', async () => {
  await Promise.all(Array.from({ length: 40 }, (_, n) => store.put(item(n))));
  assert.equal((await store.all()).length, 40);
});

test('updating an existing item replaces only that item', async () => {
  await store.put(item(0));
  await store.put(item(1));
  await store.put({ ...item(0), prompt: 'revised' });
  assert.equal((await store.all()).length, 2);
  assert.equal((await store.get('shot-0')).prompt, 'revised');
  assert.equal(await (await store.get('shot-1')).blob.text(), 'original-1');
});

test('explicit deletion removes only the selected item', async () => {
  await store.put(item(0));
  await store.put(item(1));
  await store.del('shot-0');
  assert.equal(await store.get('shot-0'), null);
  assert.equal((await store.all()).length, 1);
});

test('a missing item returns null', async () => {
  assert.equal(await store.get('missing'), null);
});

test('an aborted write rejects and leaves existing data intact', async () => {
  await store.put(item(0));
  const original = IDBObjectStore.prototype.put;
  const stub = mock.method(IDBObjectStore.prototype, 'put', function(value) {
    const request = original.call(this, value);
    this.transaction.abort();
    return request;
  });
  try { await assert.rejects(store.put(item(1)), { name: 'AbortError' }); }
  finally { stub.mock.restore(); }
  assert.equal((await store.all()).length, 1);
  assert.ok(await store.get('shot-0'));
  assert.equal(await store.get('shot-1'), null);
});

test('uncloneable data rejects without damaging the saved library', async () => {
  await store.put(item(0));
  await assert.rejects(store.put({ id: 'bad', callback: () => {} }), { name: 'DataCloneError' });
  assert.equal((await store.all()).length, 1);
});

test('finished operations close their connections so a schema upgrade can proceed', async () => {
  await store.put(item(0));
  await store.all();
  await store.get('shot-0');
  await store.del('shot-0');
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('massless', 2);
    request.onblocked = () => reject(new Error('A completed operation left a connection open'));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
});
