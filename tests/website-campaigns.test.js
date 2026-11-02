import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { templateSite, sanitizeSite } from '../public/js/website/spec.js';
import { renderPage, sitePages } from '../public/js/website/render.js';
import { HERO_JS, GEN_JS } from '../public/js/website/runtime.js';
import { usedPhotos } from '../public/js/website/export.js';
import { htmlProblem } from '../src/sites.js';

const photos = [
  'app-landing/glass', 'app-landing/window', 'app-landing/motion',
  'app-waitlist/phone', 'app-waitlist/porch', 'app-waitlist/road', 'conference/hall',
].map((name, i) => ({ src: `/media/website/${name}.webp`, alt: `Campaign photograph ${i + 1}`, prompt: '' }));

function campaign(variant) {
  const raw = templateSite({ kind: 'portfolio', prompt: 'A portfolio for Example Studio' });
  Object.assign(raw.pages[0].sections[0], { variant, image: photos[0], images: photos.slice(1).map(image => ({ image })) });
  return sanitizeSite(raw, raw, { source: 'user' });
}

test('campaign heroes preserve editable image paths and export through the hosting validator', () => {
  for (const variant of ['mosaic', 'object']) {
    const site = campaign(variant), hero = site.pages[0].sections[0], home = sitePages(site)[0];
    assert.equal(hero.variant, variant);
    const edit = renderPage(site, home, { mode: 'edit' });
    assert.ok(edit.includes(`data-edit="${hero.id}:title"`));
    assert.ok(edit.includes(`data-img="${hero.id}:image"`));
    assert.doesNotMatch(edit, /<div[^>]* data-hero-motion/, 'ordinary editing is still');
    if (variant === 'mosaic') {
      for (let i = 0; i < 6; i++) assert.ok(edit.includes(`data-img="${hero.id}:images.${i}.image"`));
      for (const photo of photos) assert.ok(usedPhotos(site).has(photo.src), 'nested photos are included in export');
    }
    const live = renderPage(site, home, { mode: 'zip' });
    assert.equal(htmlProblem(live), null, 'new markup uses the existing hosted runtime');
    assert.match(live, /<div[^>]* data-hero-motion/);
    assert.ok(!live.includes('data-img='));
    site.theme.motion = 'none';
    const still = renderPage(site, home, { mode: 'zip' });
    assert.doesNotMatch(still, /<div[^>]* data-hero-motion/);
    for (const photo of variant === 'mosaic' ? photos : [photos[0]]) assert.ok(still.includes(`src="${photo.src}"`), 'pictures remain present without animation');
  }
});

test('mosaic image arrays survive old drafts and reject invalid image sources', () => {
  const site = campaign('mosaic'), hero = site.pages[0].sections[0];
  hero.images = Array.from({ length: 20 }, () => ({ image: { src: 'javascript:alert(1)', alt: 'Safe caption' } }));
  const safe = sanitizeSite(site, site, { source: 'user' }).pages[0].sections[0];
  assert.equal(safe.images.length, 6);
  assert.ok(safe.images.every(item => item.image.src === ''));
  delete hero.images;
  assert.deepEqual(sanitizeSite(site, site, { source: 'user' }).pages[0].sections[0].images, []);
  assert.deepEqual(templateSite({ kind: 'business' }).pages[0].sections[0].images, []);
});

function motionHarness({ reduced = false, fine = true, motion = 'lively' } = {}) {
  const events = () => ({ listeners: {}, addEventListener(type, fn, options) {
    (this.listeners[type] ||= []).push(fn);
    options?.signal?.addEventListener('abort', () => { this.listeners[type] = this.listeners[type].filter(item => item !== fn); }, { once: true });
  }, fire(type, event) { for (const fn of this.listeners[type] || []) fn(event); } });
  const classes = new Set(), attrs = new Map(), values = new Map(), frames = new Map();
  const hero = Object.assign(events(), {
    classList: { contains: key => classes.has(key), toggle: (key, on) => on ? classes.add(key) : classes.delete(key), remove: key => classes.delete(key) },
    style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) },
    setAttribute: (key, value) => attrs.set(key, value),
    removeAttribute: key => attrs.delete(key),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }),
  });
  const media = Object.assign(events(), { matches: !reduced });
  const pointer = Object.assign(events(), { matches: fine });
  const doc = Object.assign(events(), { hidden: false, documentElement: { dataset: { motion } }, querySelectorAll: () => [hero] });
  let observer, frameId = 0;
  const observers = [];
  class Observer { constructor(callback) { this.callback = callback; observer = this; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  const context = {
    document: doc, window: { IntersectionObserver: Observer }, IntersectionObserver: Observer,
    AbortController,
    matchMedia: query => query.includes('prefers-reduced-motion') ? media : pointer,
    requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id),
  };
  runInNewContext(HERO_JS, context);
  return { hero, doc, media, pointer, values, frames, context, observers,
    visible: on => observer.callback([{ target: hero, isIntersecting: on }]),
    flush: () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); },
  };
}

test('campaign motion pauses offscreen, while hidden and when preferences change', () => {
  const h = motionHarness();
  assert.ok(!h.hero.classList.contains('hero-live'));
  h.visible(true);
  assert.ok(h.hero.classList.contains('hero-live'));
  h.doc.hidden = true; h.doc.fire('visibilitychange');
  assert.ok(!h.hero.classList.contains('hero-live'));
  h.doc.hidden = false; h.doc.fire('visibilitychange');
  assert.ok(h.hero.classList.contains('hero-live'));
  h.visible(false);
  assert.ok(!h.hero.classList.contains('hero-live'));
  h.visible(true); h.media.matches = false; h.media.fire('change');
  assert.ok(!h.hero.classList.contains('hero-live'));
  for (const options of [{ reduced: true }, { motion: 'none' }]) {
    const still = motionHarness(options); still.visible(true);
    assert.ok(!still.hero.classList.contains('hero-live'));
  }
});

test('pointer motion is frame-limited, fine-pointer only and cancels when leaving', () => {
  const h = motionHarness(); h.visible(true);
  h.hero.fire('pointermove', { clientX: 100, clientY: 50 });
  h.hero.fire('pointermove', { clientX: 400, clientY: 200 });
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.equal(h.values.get('--mx'), '1.000');
  assert.equal(h.values.get('--my'), '1.000');
  h.pointer.matches = false; h.pointer.fire('change');
  assert.equal(h.values.size, 0);
  h.hero.fire('pointermove', { clientX: 400, clientY: 200 }); h.flush();
  assert.equal(h.values.size, 0);
  h.pointer.matches = true; h.pointer.fire('change');
  h.hero.fire('pointermove', { clientX: 400, clientY: 200 });
  h.hero.fire('pointerleave'); h.flush();
  assert.equal(h.values.size, 0);
  h.hero.fire('pointermove', { clientX: 400, clientY: 200 }); h.visible(false); h.flush();
  assert.equal(h.values.size, 0);
  runInNewContext(HERO_JS, h.context);
  assert.equal(h.hero.listeners.pointermove.length, 1, 'replaying does not bind duplicate handlers');
});

test('campaign teardown releases observers, listeners and pending frames before restarting', () => {
  const h = motionHarness(); h.visible(true);
  h.hero.fire('pointermove', { clientX: 400, clientY: 200 });
  h.doc._heroStop();
  assert.equal(h.frames.size, 0);
  assert.ok(h.observers[0].disconnected);
  assert.equal(h.hero.listeners.pointermove.length, 0);
  assert.equal(h.doc.listeners.visibilitychange.length, 0);
  assert.equal(h.media.listeners.change.length, 0);
  assert.equal(h.pointer.listeners.change.length, 0);
  assert.ok(!h.hero.classList.contains('hero-live'));
  runInNewContext(HERO_JS, h.context); h.visible(true);
  assert.ok(h.hero.classList.contains('hero-live'));
  assert.equal(h.doc.listeners.visibilitychange.length, 1);
  runInNewContext(HERO_JS, h.context);
  assert.ok(h.observers[1].disconnected);
  assert.equal(h.doc.listeners.visibilitychange.length, 1);
});

test('the editor bootstrap starts campaign motion without a canvas and cleans up when removed', () => {
  const source = readFileSync(new URL('../public/js/pages/website.js', import.meta.url), 'utf8');
  const from = source.indexOf('function startMotion(doc) {');
  const implementation = source.slice(from, source.indexOf('\n}', from) + 2);
  const startMotion = new Function('GEN_JS', 'HERO_JS', `return (${implementation});`)(GEN_JS, HERO_JS);
  const h = motionHarness(); h.doc._heroStop();
  let exists = true;
  h.doc.querySelector = query => query === '[data-hero-motion]' && exists ? h.hero : null;
  h.doc.createElement = () => ({ textContent: '', remove() {} });
  h.doc.body = { appendChild: script => runInNewContext(script.textContent, h.context) };
  startMotion(h.doc); h.visible(true);
  assert.ok(h.hero.classList.contains('hero-live'), 'Replay initializes a photo hero with no canvas');
  exists = false;
  startMotion(h.doc);
  assert.ok(!h.hero.classList.contains('hero-live'));
  assert.equal(h.doc.listeners.visibilitychange.length, 0);
});
