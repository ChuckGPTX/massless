import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TEMPLATES, TEMPLATES_LIST, buildTemplate } from '../public/js/website/templates.js';
import { TEMPLATE_CATEGORIES, templateCategory } from '../public/js/website/studio-tools.js';

// Exercise the page's gallery controller with DOM/storage doubles, without booting its editor iframe.
const page = readFileSync(new URL('../public/js/pages/website.js', import.meta.url), 'utf8');
const gallery = page.slice(page.indexOf('function templateCard('), page.indexOf('// Image dialog'));

function setup({ reduce = false, saveData = false, persist = async () => {} } = {}) {
  const nodes = new Map(), calls = [], preferences = { reduce, saveData };
  function node(id) {
    if (!nodes.has(id)) {
      const attrs = new Map(), events = new Map();
      nodes.set(id, {
        hidden: false, disabled: false, open: false, textContent: '', value: '', children: [], currentTime: 0,
        events, pauses: 0, plays: 0, loads: 0,
        addEventListener(type, fn) { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); },
        async emit(type) { for (const fn of events.get(type) || []) await fn({ target: this }); },
        setAttribute(k, v) { attrs.set(k, v); }, getAttribute(k) { return attrs.get(k) ?? null; }, removeAttribute(k) { attrs.delete(k); },
        set src(v) { attrs.set('src', v); }, get src() { return attrs.get('src') || ''; },
        replaceChildren(...children) { this.children = children; },
        showModal() { this.open = true; }, close() { this.open = false; void this.emit('close'); },
        pause() { this.pauses++; }, play() { this.plays++; return Promise.resolve(); }, load() { this.loads++; },
      });
    }
    return nodes.get(id);
  }
  const media = node('motion');
  Object.defineProperty(media, 'matches', { get: () => preferences.reduce });
  const connection = node('connection');
  Object.defineProperty(connection, 'saveData', { get: () => preferences.saveData });
  const document = node('document');
  const original = { name: 'My existing draft' };
  const state = { site: original, id: 'existing', demo: false, template: null };
  const context = {
    $: node, state, TEMPLATES, TEMPLATES_LIST, buildTemplate, TEMPLATE_CATEGORIES, templateCategory,
    window: { matchMedia: () => media }, navigator: { connection }, document,
    el: (tag, attrs, ...children) => ({ tag, attrs, children }),
    commitEdit: () => calls.push('commit'),
    save: async options => { calls.push(['save', options.strict]); await persist(); },
    newProject: (site, options) => { calls.push(['replace', site.name]); state.site = site; state.demo = options.demo; },
    syncCreate: () => calls.push('sync'), toast: (...args) => calls.push(['toast', ...args]),
  };
  const api = vm.runInNewContext(`${gallery}\nrenderTemplates = () => {};\n({ templateCard, previewTemplate, useTemplatePreview, openTemplate, wireTemplatePreview });`, context);
  api.wireTemplatePreview();
  return { ...api, node, calls, state, original, media, connection, document, preferences };
}

test('a gallery card previews the bundled clip without changing or saving the draft', () => {
  const app = setup();
  const template = TEMPLATES_LIST[0], card = app.templateCard(template);
  assert.equal(card.attrs['aria-haspopup'], 'dialog');
  card.attrs.onclick();
  assert.equal(app.state.site, app.original);
  assert.equal(app.calls.length, 0);
  assert.equal(app.node('#tpl-detail-dialog').open, true);
  assert.equal(app.node('#tpl-detail-title').textContent, template.title);
  assert.equal(app.node('#tpl-detail-video').src, `/media/templates/site-${template.id}.mp4`);
  assert.equal(app.node('#tpl-detail-video').poster, template.thumb);
  assert.equal(app.node('#tpl-detail-video').plays, 1);
  assert.equal(app.node('#tpl-detail-includes').children.length, 4);
  assert.equal(card.children.some(child => child?.tag === 'video'), false);
});

test('motion and data preferences prevent autoplay and preloading; players unload on close/change', async () => {
  for (const options of [{ reduce: true }, { saveData: true }]) {
    const app = setup(options), video = app.node('#tpl-detail-video');
    app.previewTemplate(TEMPLATES_LIST[0].id);
    assert.equal(video.plays, 0);
    assert.equal(video.preload, 'none');
    video.currentTime = 8;
    app.previewTemplate(TEMPLATES_LIST[1].id);
    assert.equal(video.currentTime, 0);
    assert.equal(video.src, `/media/templates/site-${TEMPLATES_LIST[1].id}.mp4`);
    app.node('#tpl-detail-dialog').close();
    assert.equal(video.src, '');
    assert.equal(video.currentTime, 0);
    assert.ok(video.pauses >= 3);
    assert.equal(app.media.events.get('change').length, 1, 'opening previews does not add preference listeners');
  }
  const app = setup(), video = app.node('#tpl-detail-video');
  app.previewTemplate(TEMPLATES_LIST[0].id);
  const before = video.pauses;
  app.preferences.reduce = true;
  await app.media.emit('change');
  app.document.hidden = true;
  await app.document.emit('visibilitychange');
  assert.equal(video.pauses, before + 2);
});

test('choosing a design saves strictly and preserves the draft and dialog when storage fails', async () => {
  const app = setup({ persist: async () => { throw new Error('Device storage is full. Export a copy.'); } });
  app.previewTemplate(TEMPLATES_LIST[0].id);
  await app.useTemplatePreview();
  assert.equal(app.state.site, app.original);
  assert.equal(app.state.id, 'existing');
  assert.equal(app.node('#tpl-detail-dialog').open, true);
  assert.equal(app.node('#tpl-detail-error').hidden, false);
  assert.match(app.node('#tpl-detail-error').textContent, /storage is full/);
  assert.equal(app.node('#tpl-detail-use').disabled, false);
  assert.ok(app.calls.some(call => call[0] === 'save' && call[1] === true));
  assert.ok(!app.calls.some(call => call[0] === 'replace'));
});

test('successful selection waits for durable saving, rejects duplicate clicks, then closes previews', async () => {
  let resolveSave;
  const app = setup({ persist: () => new Promise(resolve => { resolveSave = resolve; }) });
  const id = TEMPLATES_LIST[0].id;
  app.node('#tpl-dialog').showModal();
  app.previewTemplate(id);
  const pending = app.useTemplatePreview();
  await app.useTemplatePreview();
  assert.equal(app.state.site, app.original);
  assert.equal(app.node('#tpl-detail-use').disabled, true);
  assert.equal(app.calls.filter(call => call[0] === 'save').length, 1);
  resolveSave();
  await pending;
  assert.equal(app.state.template, id);
  assert.notEqual(app.state.site, app.original);
  assert.equal(app.node('#tpl-dialog').open, false);
  assert.equal(app.node('#tpl-detail-dialog').open, false);
  assert.equal(app.node('#tpl-detail-video').src, '');
  assert.ok(app.calls.findIndex(call => call[0] === 'save') < app.calls.findIndex(call => call[0] === 'replace'));
});

test('dismissing or changing a preview while saving cancels replacement', async () => {
  for (const action of ['dismiss', 'change']) {
    let resolveSave;
    const app = setup({ persist: () => new Promise(resolve => { resolveSave = resolve; }) });
    app.previewTemplate(TEMPLATES_LIST[0].id);
    const pending = app.useTemplatePreview();
    if (action === 'dismiss') app.node('#tpl-detail-dialog').close();
    else app.previewTemplate(TEMPLATES_LIST[1].id);
    resolveSave();
    await pending;
    assert.equal(app.state.site, app.original);
    assert.ok(!app.calls.some(call => call[0] === 'replace'));
  }
});

test('existing direct template opening still works and rejects unknown IDs', async () => {
  const app = setup();
  assert.equal(await app.openTemplate('no-such-template'), false);
  assert.equal(await app.openTemplate(TEMPLATES_LIST[0].id), true);
  assert.equal(app.state.template, TEMPLATES_LIST[0].id);
  assert.equal(app.node('#tpl-detail-dialog').open, false);
});
