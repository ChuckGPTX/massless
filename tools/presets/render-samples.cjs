// Render the example inputs that other presets start from, with the presets themselves:
// product shots (a scene preset's result plus the product's matte, for rains and transitions) and sample designs
// (social presets' results, for the mockups). Run with the site served at BASE (default http://localhost:8790):
//   node tools/workflow-loops/serve.mjs public 8790 &  then  node tools/presets/render-samples.cjs
// Uses Playwright's Chromium and Pillow; neither is a project dependency.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const BASE = process.env.BASE || 'http://localhost:8790';
const OUT = path.join(__dirname, '..', '..', 'public', 'presets', 'samples');
const SHOTS = [
  ['serum-marble', 'scene-marble-podium', 0, { brand: '', tagline: '' }], ['sneaker-pop', 'scene-pop-blocks', 0, { brand: '', tagline: '' }],
  ['perfume-arches', 'scene-pastel-arches', 0, { brand: '', tagline: '' }], ['candle-bokeh', 'scene-bokeh-night', 0, { brand: '', tagline: '' }],
  ['mug-terrazzo', 'scene-terrazzo', 0, { brand: '', tagline: '' }], ['headphones-gloss', 'scene-black-gloss', 0, { brand: '', tagline: '' }],
  ['can-ice', 'scene-ice-cubes', 0, { brand: '', tagline: '' }],
];
const DESIGNS = [['design-launch', 'social-launch', 1080, 1350, {}], ['design-sale', 'social-sale', 1080, 1350, {}], ['design-app', 'social-stat', 1080, 1920, {}], ['design-wide-launch', 'social-launch', 1920, 820, {}], ['design-wide-sale', 'social-sale', 1920, 960, {}]];
const only = process.argv.slice(2);
function save(dataURL, file, maxBytes, gray = false) {
  const tmp = file + '.tmp.png';
  fs.writeFileSync(tmp, Buffer.from(dataURL.split(',')[1], 'base64'));
  execFileSync('python3', ['-I', '-c', `
import sys, os
from PIL import Image
im = Image.open(sys.argv[1]).convert('L' if sys.argv[4] == '1' else 'RGB')
if sys.argv[4] == '1': im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS).convert('RGB')
q = 84
while True:
    im.save(sys.argv[2], 'WEBP', quality=q, method=6)
    if os.path.getsize(sys.argv[2]) <= int(sys.argv[3]) or q < 40: break
    q -= 6
`, tmp, file, String(maxBytes), gray ? '1' : '0']);
  fs.unlinkSync(tmp);
  console.log(path.basename(file), fs.statSync(file).size >> 10, 'KB');
}
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
  pg.on('pageerror', (e) => console.log('pageerror', e.message));
  const open = async (preset, sample) => {
    await pg.goto(`${BASE}/workflows?preset=${preset}&capture=1`);
    await pg.waitForFunction(() => window.__presetCapture && /Ready|playing/.test(document.querySelector('.maker-status')?.textContent || ''), null, { timeout: 90000 });
    if (sample) { await pg.locator('.pz-samples').first().locator('.pz-sample').nth(sample).click(); await pg.waitForFunction(() => /Ready|playing/.test(document.querySelector('.maker-status')?.textContent || ''), null, { timeout: 60000 }); await pg.waitForTimeout(200); }
  };
  for (const [id, preset, sample, over] of SHOTS) {
    if (only.length && !only.includes(id)) continue;
    await open(preset, sample);
    save(await pg.evaluate((o) => window.__presetCapture.still(1080, 1350, o), over), path.join(OUT, `shot-${id}.webp`), 160000);
    save(await pg.evaluate((o) => window.__presetCapture.still(1080, 1350, { ...o, _matte: true }, 'image/png'), over), path.join(OUT, `shot-${id}-matte.webp`), 20000, true);
  }
  for (const [id, preset, w, h, over] of DESIGNS) {
    if (only.length && !only.includes(id)) continue;
    await open(preset, 0);
    save(await pg.evaluate(([w, h, o]) => window.__presetCapture.still(w, h, o), [w, h, over]), path.join(OUT, `${id}.webp`), 140000);
  }
  await b.close();
})();
