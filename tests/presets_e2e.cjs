// End-to-end check of every one-tap preset in a real browser, at desktop and phone widths:
// open it, see the instant preview, add your own photo (desktop), Make it, check every file, download a file and
// the ZIP, and save to My library. Fails on any console error or failed request.
//   node tools/workflow-loops/serve.mjs public 8790 &
//   node tests/presets_e2e.cjs [--widths 1440,390] [--out dir] [preset ids...]
// Uses Playwright's Chromium (require('playwright')); it is not a project dependency.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:8790';
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const widths = opt('--widths', '1440,390').split(',').map(Number);
const out = opt('--out', path.join(require('os').tmpdir(), 'chucksi-presets-e2e'));
fs.mkdirSync(out, { recursive: true });
const PRODUCT = path.join(__dirname, 'fixtures', 'preset-product.jpg');
const PHOTO = path.join(__dirname, '..', 'public', 'media', 'art', 'botanical.jpg');

// Earth zoom out over a real place: the place search and the satellite views are stubbed here (the real ones go
// through chucksi.com, see src/place.js). Test tiles are drawn on demand from a made-up planet that is the same at
// every zoom, so the nested views line up as real imagery would.
const PLACES = { lisbon: { name: 'Lisboa', full: 'Lisboa, Grande Lisboa, Portugal', lat: 38.70775, lon: -9.13659 } };
function drawTestTile([z, x, y]) {
  const c = new OffscreenCanvas(256, 256), g = c.getContext('2d'), img = g.createImageData(256, 256), d = img.data, n = 256 * 2 ** z;
  const dirs = [[0.8, 0.5, 0.3, 3, 0.2], [-0.4, 0.9, 0.1, 5, 1.1], [0.2, -0.3, 0.95, 9, 2.3], [0.6, -0.7, 0.4, 17, 0.7], [-0.5, -0.2, 0.8, 33, 1.9], [0.1, 0.6, -0.8, 71, 0.4], [0.9, 0.1, -0.4, 150, 2.8], [-0.3, 0.4, 0.9, 400, 1.3]];
  const L0 = (38.70775 * Math.PI) / 180, N0 = (-9.13659 * Math.PI) / 180;
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const X = (x * 256 + i + 0.5) / n, Y = (y * 256 + j + 0.5) / n;
    const lon = X * 2 * Math.PI - Math.PI, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * Y)));
    const p = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    let h = 0;
    for (const [a, b, cc, f, ph] of dirs) h += Math.sin(f * (a * p[0] + b * p[1] + cc * p[2]) + ph) / Math.sqrt(f);
    const km = 6371 * Math.acos(Math.min(1, Math.sin(lat) * Math.sin(L0) + Math.cos(lat) * Math.cos(L0) * Math.cos(lon - N0)));
    let r, gg, b;
    if (Math.abs(lat) > 1.25) { r = 225; gg = 232; b = 238; }
    else if (h < -0.05 && km > 12) { const k = Math.max(0, Math.min(1, -h)); r = 12; gg = 40 + 30 * (1 - k); b = 70 + 50 * (1 - k); }
    else if (km < 12) {
      // a grey town with a street grid around the test place
      const mx = (X * n * 2 ** (16 - z)) % 48, my = (Y * n * 2 ** (16 - z)) % 48, street = mx < 5 || my < 5;
      const v = street ? 70 : 150 + ((Math.floor(X * n * 2 ** (16 - z) / 48) * 37 + Math.floor(Y * n * 2 ** (16 - z) / 48) * 11) % 60);
      r = v + 15; gg = v; b = v - 10;
    } else { const k = Math.max(0, Math.min(1, h)); r = 60 + 110 * k; gg = 95 + 50 * k; b = 45 + 30 * k; }
    const o = (j * 256 + i) * 4; d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }).then((bl) => bl.arrayBuffer()).then((ab) => { let s = ''; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
}

// a short spoken-sounding WAV for the voice request (the real one is made by the site)
function wav(seconds = 6, rate = 24000) {
  const n = seconds * rate, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / rate, env = Math.max(0, Math.sin(t * Math.PI * 3.1)) * (t < seconds - 0.4 ? 1 : 0); b.writeInt16LE(Math.round(Math.sin(t * 2 * Math.PI * (140 + 40 * Math.sin(t * 7))) * env * 12000), 44 + i * 2); }
  return b;
}

(async () => {
  const { PRESETS } = await import(path.join(__dirname, '..', 'public/js/presets/catalog.js'));
  const ids = args.length ? args : PRESETS.map((p) => p.id);
  const browser = await chromium.launch();
  const failures = [], report = [];
  const tilePage = await browser.newPage(), testTiles = new Map();
  const testTile = (z, x, y) => {
    const k = `${z}/${x}/${y}`;
    if (!testTiles.has(k)) testTiles.set(k, tilePage.evaluate(`(${drawTestTile})([${z}, ${x}, ${y}])`).then((b) => Buffer.from(b, 'base64')));
    return testTiles.get(k);
  };
  for (const width of widths) for (const id of ids) {
    const spec = PRESETS.find((p) => p.id === id);
    const t0 = Date.now();
    const ctx = await browser.newContext({ viewport: { width, height: width > 600 ? 1000 : 844 }, acceptDownloads: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    let expected = null; // errors a step provokes on purpose (a place that is not found, the connection dropping)
    const note = (e) => { if (!(expected && expected.test(e))) errors.push(e); };
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') note('console: ' + m.text()); });
    // a media element dropping its own range request for a result it is about to replace is not a failure
    page.on('requestfailed', (r) => { if (!(r.url().startsWith('blob:') && /ABORTED/.test(r.failure()?.errorText || ''))) note(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/tts')) note(`${r.status()}: ${r.url()}`); });
    await page.route('**/api/tts', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: wav() }));
    const placeAsks = [];
    let tilesDown = false;
    await page.route('**/api/place?*', (r) => {
      const q = new URL(r.request().url()).searchParams.get('q');
      placeAsks.push(q);
      const hit = PLACES[q.trim().toLowerCase()];
      return hit ? r.fulfill({ json: hit }) : r.fulfill({ status: 404, json: { error: 'We couldn’t find that place.', notFound: true } });
    });
    await page.route('**/earth-tiles/**', async (r) => {
      if (tilesDown) return r.abort('internetdisconnected');
      const m = new URL(r.request().url()).pathname.match(/^\/earth-tiles\/(\d+)\/(\d+)\/(\d+)\.jpg$/);
      if (!m) return r.fulfill({ status: 404, body: 'Not found' });
      return r.fulfill({ contentType: 'image/jpeg', body: await testTile(...m.slice(1).map(Number)) });
    });
    const step = async (name, fn) => { try { await fn(); } catch (e) { throw new Error(`${name}: ${e.message.split('\n')[0]}`); } };
    const ready = () => page.waitForFunction(() => /Ready|playing/.test(document.querySelector('.maker-status')?.textContent || ''), null, { timeout: 120000 });
    const stageHash = () => page.evaluate(() => { const c = document.querySelector('.pz-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0, s = 0, s2 = 0; for (let i = 0; i < d.length; i += 4 * 97) { h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) % 1e9; const l = d[i] + d[i + 1] + d[i + 2]; s += l; s2 += l * l; } const n = d.length / (4 * 97); return { h, sd: Math.sqrt(s2 / n - (s / n) ** 2) }; });
    const r = { id, width, files: [] };
    try {
      await step('open', async () => { await page.goto(`${BASE}/workflows?preset=${id}`); await ready(); });
      await step('instant preview', async () => {
        const { sd } = await stageHash();
        if (!(sd > 4)) throw new Error(`the preview looks blank (sd ${sd.toFixed(1)})`);
        const box = await page.locator('.pz-canvas').boundingBox();
        if (!box || box.width < 120 || box.x < 0 || box.x + box.width > width + 1) throw new Error('the preview does not fit the screen');
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (scroll > 1) throw new Error(`the page scrolls sideways by ${scroll}px`);
      });
      if (width > 600) await step('your own photo', async () => {
        const input = spec.inputs.find((i) => i.type === 'image');
        if (!input) return;
        const before = await stageHash();
        const file = input.prep?.includes('removeBackground') ? PRODUCT : PHOTO;
        await page.locator(`input[type=file][data-key="${input.key}"]`).setInputFiles(file);
        await page.waitForTimeout(400);
        await ready();
        await page.waitForTimeout(500);
        const after = await stageHash();
        if (after.h === before.h) throw new Error('the preview did not change after the upload');
      });
      if (spec.inputs.some((i) => i.key === 'where')) await step('a real place', async () => {
        const fly = async (words, want) => {
          await page.locator('#pz-where').fill('');
          await page.locator('#pz-where').pressSequentially(words, { delay: 15 });
          await page.waitForTimeout(300);
          if (placeAsks.length !== asked) throw new Error('the place was sent while typing');
          await page.locator('.pz-go button').click();
          await page.waitForFunction((re) => new RegExp(re).test(document.querySelector('.maker-status')?.textContent || ''), want.source, { timeout: 120000 });
          asked = placeAsks.length;
        };
        let asked = placeAsks.length;
        const box = await page.locator('.pz-go').boundingBox();
        if (!box || box.x + box.width > width + 1) throw new Error('the place field does not fit the screen');
        expected = /status of 404|404: .*\/api\/place/;
        await fly('Qwxzzy', /couldn’t find “Qwxzzy”/);
        expected = /INTERNET_DISCONNECTED|earth-tiles/;
        tilesDown = true;
        await fly('Lisbon', /couldn’t reach the satellite views/);
        expected = null; tilesDown = false;
        const before = await stageHash();
        await page.locator('#pz-where').press('Enter');
        await page.waitForFunction(() => /Flying out over Lisboa/.test(document.querySelector('.maker-status')?.textContent || ''), null, { timeout: 120000 });
        if (placeAsks.length > 3) throw new Error(`the place was asked for ${placeAsks.length} times`);
        await page.waitForTimeout(600);
        if ((await stageHash()).h === before.h) throw new Error('the preview did not change for the real place');
        if (!/EOxCloudless 2016/.test(await page.locator('.pz-note').textContent())) throw new Error('the imagery credit is not shown beside the result');
      });
      await page.screenshot({ path: path.join(out, `${id}-${width}.jpg`), quality: 70, type: 'jpeg', fullPage: false });
      await step('make it', async () => {
        await page.locator('.maker-side-foot .btn-accent').click();
        await page.waitForFunction(() => /^Done|^Couldn/.test(document.querySelector('.maker-status')?.textContent || ''), null, { timeout: 1200000 });
        const status = await page.locator('.maker-status').textContent();
        if (!status.startsWith('Done')) throw new Error(status);
        const n = await page.locator('.pz-result').count();
        const want = spec.outputs.reduce((a, o) => a + o.sizes.length, 0);
        if (n !== want) throw new Error(`${n} files, expected ${want}`);
      });
      await step('download', async () => {
        const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.pz-result button').first().click()]);
        const f = path.join(out, `${id}-${width}-${dl.suggestedFilename()}`);
        await dl.saveAs(f);
        if (fs.statSync(f).size < 1000) throw new Error('empty file');
        r.files.push(f);
        // keep one of each kind for the contact sheet
        const all = await page.locator('.pz-result button').count();
        for (let i = 1; i < all && width > 600; i++) {
          const [d2] = await Promise.all([page.waitForEvent('download'), page.locator('.pz-result button').nth(i).click()]);
          const f2 = path.join(out, `${id}-${width}-${d2.suggestedFilename()}`);
          await d2.saveAs(f2); r.files.push(f2);
        }
        const [zip] = await Promise.all([page.waitForEvent('download'), page.locator('.maker-actions button', { hasText: 'Download all' }).click()]);
        const z = path.join(out, `${id}-${width}.zip`);
        await zip.saveAs(z);
        if (fs.readFileSync(z).subarray(0, 2).toString() !== 'PK') throw new Error('the ZIP is not a ZIP');
        fs.unlinkSync(z);
      });
      if (width > 600) await step('share to Explore', async () => {
        await page.locator('.maker-actions button', { hasText: 'Share to Explore' }).click();
        await page.locator('dialog.xs-dialog[open]').waitFor({ timeout: 30000 });
        await page.waitForFunction(() => { const b = document.querySelector('dialog.xs-dialog .xs-go'); return b && !b.disabled; }, null, { timeout: 30000 });
        const remix = await page.evaluate(() => document.querySelector('dialog.xs-dialog .xs-note')?.textContent || '');
        if (!/Design/.test(remix)) throw new Error('the share sheet does not name the tool');
        await page.locator('dialog.xs-dialog .xs-x').click();
      });
      await step('save to My library', async () => {
        await page.locator('.maker-actions button', { hasText: 'Save to My library' }).click();
        await page.waitForFunction(() => /Saved \d+ file/.test(document.body.textContent), null, { timeout: 30000 });
      });
      if (id === 'talking-ad') {
        const mp4 = r.files.find((f) => f.endsWith('.mp4'));
        if (mp4 && !fs.readFileSync(mp4).includes('soun')) throw new Error('the talking ad has no sound track');
      }
      const real = errors.filter((e) => !/GPU stall|GL Driver/.test(e));
      if (real.length) throw new Error(real.slice(0, 4).join(' | '));
      r.ok = true;
    } catch (e) {
      r.ok = false; r.error = e.message;
      failures.push(`${id} @${width}: ${e.message}`);
      await page.screenshot({ path: path.join(out, `${id}-${width}-fail.jpg`), type: 'jpeg', quality: 60 }).catch(() => {});
    }
    r.ms = Date.now() - t0;
    report.push(r);
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${id} @${width} ${(r.ms / 1000).toFixed(1)}s${r.ok ? '' : ' ' + r.error}`);
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`${report.filter((r) => r.ok).length}/${report.length} passed`);
  if (failures.length) { console.log(failures.join('\n')); process.exit(1); }
})();
