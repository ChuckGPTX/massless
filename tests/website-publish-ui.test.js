// Unit-test the dialog controller with small DOM/storage doubles; no browser or production writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initPublish } from '../public/js/website/publish.js';

function ui(t) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', textContent: '', hidden: true, disabled: false, dataset: {}, events: {}, addEventListener(type, f) { this.events[type] = f; }, showModal() { this.open = true; }, focus() {}, select() {} });
    return nodes.get(id);
  };
  const saved = new Map();
  const replacements = {
    document: { querySelector: node },
    localStorage: { getItem: () => null },
    sessionStorage: { getItem: k => saved.get(k), setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) },
    location: { href: '/website/' },
  };
  const old = Object.fromEntries(Object.keys(replacements).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, value] of Object.entries(replacements)) Object.defineProperty(globalThis, k, { value, configurable: true });
  t.after(() => { for (const k of Object.keys(replacements)) { if (old[k]) Object.defineProperty(globalThis, k, old[k]); else delete globalThis[k]; } });
  return { node, saved, location: replacements.location };
}

test('sign-in waits for a durable draft and stays in the editor on failure', async t => {
  const { node, saved, location } = ui(t);
  let fail = true, saves = 0;
  const app = { persist: async () => { saves++; if (fail) throw new Error('Device storage is full. Export a copy.'); }, commitEdit() {} };
  const controller = initPublish(app);
  await controller.open();
  assert.equal(node('#pub-out').hidden, false);
  await node('#pub-signin').events.click();
  assert.equal(location.href, '/website/');
  assert.equal(saved.size, 0);
  assert.match(node('#pub-msg').textContent, /storage is full/);
  assert.equal(node('#pub-msg').hidden, false);
  fail = false;
  await node('#pub-signin').events.click();
  assert.equal(saves, 2);
  assert.equal(saved.get('chucksi.publish-reopen'), '1');
  assert.equal(saved.get('chucksi.after-signin'), '/website/');
  assert.equal(location.href, '/projects/#account');
});

test('an account disappearing before Publish returns to sign-in before exporting', async t => {
  const { node } = ui(t);
  let saves = 0;
  initPublish({ persist: async () => { saves++; }, commitEdit() {} });
  node('#pub-slug').value = 'demo-site';
  await node('#pub-go').events.click();
  assert.equal(saves, 0);
  assert.equal(node('#pub-out').hidden, false);
  assert.equal(node('#pub-new').hidden, true);
});
