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
const PHOTO = path.join(__dirname, '..', 'public', 'media', 'art', 'canyon.jpg');

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
  for (const width of widths) for (const id of ids) {
    const spec = PRESETS.find((p) => p.id === id);
    const t0 = Date.now();
    const ctx = await browser.newContext({ viewport: { width, height: width > 600 ? 1000 : 844 }, acceptDownloads: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url()));
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/tts')) errors.push(`${r.status()}: ${r.url()}`); });
    await page.route('**/api/tts', (r) => r.fulfill({ status: 200, contentType: 'audio/wav', body: wav() }));
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
      await page.screenshot({ path: path.join(out, `${id}-${width}.jpg`), quality: 70, type: 'jpeg', fullPage: false });
      await step('make it', async () => {
        await page.locator('.maker-side-foot .btn-accent').click();
        await page.waitForFunction(() => /^Done|^Couldn/.test(document.querySelector('.maker-status')?.textContent || ''), null, { timeout: 600000 });
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
