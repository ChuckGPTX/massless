import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplate, TEMPLATES_LIST } from '../public/js/website/templates.js';
import { filterTemplates, personalizeSite, launchReview } from '../public/js/website/studio-tools.js';
import { renderSingle } from '../public/js/website/render.js';
import { usedPhotos } from '../public/js/website/export.js';

const ids = ['wellness-studio', 'music-artist', 'property-story'];
test('goal and search filters combine; empty searches preserve all designs', () => {
  assert.equal(filterTemplates(TEMPLATES_LIST).length, TEMPLATES_LIST.length);
  assert.deepEqual(filterTemplates(TEMPLATES_LIST, { category: 'property' }).map(t => t.id), ['property-story']);
  assert.deepEqual(filterTemplates(TEMPLATES_LIST, { category: 'creative', query: '  MUSIC  ' }).map(t => t.id), ['music-artist']);
  assert.equal(filterTemplates(TEMPLATES_LIST, { category: 'business', query: 'Music' }).length, 0);
  assert.equal(filterTemplates(TEMPLATES_LIST, { query: 'no-such-design' }).length, 0);
});

test('personalization is non-mutating and preserves sections, images and destinations', () => {
  for (const id of ids) {
    const site = buildTemplate(id), original = structuredClone(site);
    const next = personalizeSite(site, { name: 'New Chapter', description: 'A new idea for our community.', email: 'hello@example.com' });
    assert.deepEqual(site, original);
    assert.equal(next.name, 'New Chapter');
    assert.match(next.seo.title, /New Chapter/);
    assert.equal(next.seo.description, 'A new idea for our community.');
    assert.equal(next.contact.email, 'hello@example.com');
    assert.equal(next.pages[0].sections[0].subtitle, 'A new idea for our community.');
    assert.deepEqual(next.pages.map(p => p.sections.map(s => s.id)), site.pages.map(p => p.sections.map(s => s.id)));
    assert.deepEqual([...usedPhotos(next)], [...usedPhotos(site)]);
    assert.deepEqual(next.nav, site.nav);
    const html = renderSingle(next);
    assert.match(html, /mailto:hello@example.com/);
    assert.doesNotMatch(html, /data-edit=/);
  }
});

test('personalization validates contact inputs and strips markup without affecting links', () => {
  const site = buildTemplate('music-artist');
  assert.throws(() => personalizeSite(site, { name: '  ' }), /name/);
  assert.throws(() => personalizeSite(site, { name: 'Valid', email: 'bad email' }), /email/);
  const next = personalizeSite(site, { name: '<script>alert(1)</script>', description: '<img src=x onerror=alert(1)>' });
  const html = renderSingle(next);
  assert.doesNotMatch(html, /<script>alert\(1\)|<img src=x onerror/);
  assert.equal(next.nav.cta.href, '#contact');
});

test('launch review catches missing contact, example facts, external forms and unfinished links', () => {
  const music = buildTemplate('music-artist');
  assert.ok(launchReview(music).some(i => /nowhere to send/.test(i.text)));
  const complete = personalizeSite(music, { name: 'After Hours', email: 'hello@example.com' });
  assert.deepEqual(launchReview(complete), []);
  complete.nav.cta.href = '#';
  complete.contact.form = 'https://example.com/form';
  const checks = launchReview(complete);
  assert.ok(checks.some(i => /destination/.test(i.text)));
  assert.ok(checks.some(i => /Free subdomain/.test(i.text)));
  assert.ok(!checks.some(i => /Add your site address/.test(i.text)), 'hosting assigns an address');
  assert.ok(launchReview(buildTemplate('property-story')).some(i => /placeholder/.test(i.text)), 'example property facts require review');
});

test('new starters have distinct photography and valid internal destinations', () => {
  const photoSets = ids.map(id => [...usedPhotos(buildTemplate(id))]);
  assert.equal(new Set(photoSets.flat()).size, 6);
  for (const id of ids) {
    const site = buildTemplate(id), html = renderSingle(site);
    if (id === 'music-artist') {
      assert.match(html, /object-position:80% 50%/, 'the performer stays visible in narrow exported views');
      const remapped = renderSingle(site, { imgInfo: () => ({ w: 800, h: 450 }) });
      assert.match(remapped, /object-position:80% 50%/, 'export dimension metadata preserves the bundled focal point');
    }
    for (const [, target] of html.matchAll(/href="#([^"?]+)"/g)) {
      if (target.startsWith('/')) continue; // the single-file page router
      assert.ok(html.includes(`id="${target}"`), `${id}: #${target} must exist`);
    }
  }
});
