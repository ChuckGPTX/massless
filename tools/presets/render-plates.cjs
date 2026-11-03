// Render the procedural plates and sample products with tools/presets/plates (three.js, accumulated in a float
// buffer), save them as WebP under public/presets, and record their placement data in tools/presets/plates/out.
//   node tools/workflow-loops/serve.mjs . 8788 &        (from the repo root: serves /tools and /public)
//   node tools/presets/render-plates.cjs [scene|product|mockup] [id ...] [--frames N] [--draft]
// Uses Playwright's Chromium and Python Pillow; neither is a project dependency.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const BASE = process.env.BASE || 'http://localhost:8788';
const OUT = path.join(__dirname, 'plates', 'out');
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const kind = ['scene', 'product', 'mockup'].includes(args[0]) ? args.shift() : 'scene';
const fi = args.indexOf('--frames'); const frames = fi >= 0 ? +args.splice(fi, 2)[1] : 0;
const draft = args.includes('--draft'); const only = args.filter((a) => !a.startsWith('--'));
const SIZES = { scene: [2160, 1440], mockup: [2160, 1440] };
function webp(png, dst, { q = 80, alpha = false, crop = null, max = 0 } = {}) {
  execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image
im = Image.open(sys.argv[1]); im = im.convert('RGBA' if sys.argv[3]=='1' else 'RGB')
c = sys.argv[4]
if c != '-': x0,y0,x1,y1 = map(int, c.split(',')); im = im.crop((x0,y0,x1,y1))
im.save(sys.argv[2], 'WEBP', quality=int(sys.argv[5]), method=6, alpha_quality=90)
`, png, dst, alpha ? '1' : '0', crop ? crop.join(',') : '-', String(q)]);
  let qq = q;
  while (max && fs.statSync(dst).size > max && qq > 50) { qq -= 6; webp(png, dst, { q: qq, alpha, crop }); }
  return fs.statSync(dst).size;
}
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1200, height: 800 } });
  pg.on('pageerror', (e) => console.log('pageerror', e.message));
  pg.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
  await pg.goto(`${BASE}/tools/presets/plates/index.html`);
  await pg.waitForFunction(() => window.ready, null, { timeout: 120000 });
  const ids = only.length ? only : await pg.evaluate((k) => import('./' + (k === 'product' ? 'products' : k === 'mockup' ? 'mockups' : 'scenes') + '.js').then((m) => Object.keys(Object.values(m)[0])), kind);
  const metaFile = path.join(OUT, `${kind}.json`);
  const all = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
  for (const id of ids) {
    const size = kind === 'product' ? await pg.evaluate((id) => import('./products.js').then((m) => m.PRODUCTS[id].size), id) : SIZES[kind];
    const [W, H] = draft ? size.map((v) => Math.round(v / 3)) : size;
    const passes = kind === 'mockup' ? ['white', 'dark'] : ['white'];
    const res = {};
    for (const pass of passes) {
      const r = await pg.evaluate(async ([k, id, W, H, f, pass]) => {
        const out = await window.renderPlate(k, id, W, H, f, pass);
        return out;
      }, [kind, id, W, H, draft ? 8 : frames, pass]);
      const png = path.join(OUT, `${kind}-${id}-${pass}${draft ? '-draft' : ''}.png`);
      fs.writeFileSync(png, Buffer.from(r.png.split(',')[1], 'base64'));
      res[pass] = { png, meta: r.meta, ms: r.ms };
    }
    const meta = res.white.meta;
    if (!draft) {
      if (kind === 'scene') meta.bytes = webp(res.white.png, path.join(ROOT, 'public/presets/plates', `${id}.webp`), { q: 80, max: 260000 });
      if (kind === 'product') meta.bytes = webp(res.white.png, path.join(ROOT, 'public/presets/samples', `${id}.webp`), { q: 88, alpha: true, max: 140000 });
      if (kind === 'mockup') {
        meta.bytes = webp(res.white.png, path.join(ROOT, 'public/presets/plates', `mockup-${id}.webp`), { q: 82, max: 280000 });
        const xs = meta.quad.map((p) => p[0] * W), ys = meta.quad.map((p) => p[1] * H);
        const box = [Math.max(0, Math.floor(Math.min(...xs)) - 4), Math.max(0, Math.floor(Math.min(...ys)) - 4), Math.min(W, Math.ceil(Math.max(...xs)) + 4), Math.min(H, Math.ceil(Math.max(...ys)) + 4)];
        meta.darkBox = box.map((v, i) => +(v / (i % 2 ? H : W)).toFixed(5));
        meta.darkBytes = webp(res.dark.png, path.join(ROOT, 'public/presets/plates', `mockup-${id}-dark.webp`), { q: 82, crop: box, max: 160000 });
      }
    }
    meta.size = [W, H];
    all[id] = meta;
    console.log(kind, id, `${W}x${H}`, res.white.ms + 'ms', JSON.stringify(meta));
    fs.writeFileSync(metaFile, JSON.stringify(all, null, 1));
  }
  await b.close();
})();
