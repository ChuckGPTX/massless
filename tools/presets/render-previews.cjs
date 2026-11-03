// Render each preset's gallery loop with the preset itself: 3 to 5.5 s, silent H.264 (<= 300 KB) plus a WebP
// poster (<= 40 KB), into public/media/presets, and record them in public/media/templates/provenance.json.
//   node tools/workflow-loops/serve.mjs public 8790 &
//   node tools/presets/render-previews.cjs [preset ids...] [--sheet out.jpg]   (--sheet: a frame strip, no video)
// Uses Playwright's Chromium, ffmpeg and Pillow; none of them is a project dependency.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const BASE = process.env.BASE || 'http://localhost:8790';
const OUT = path.join(ROOT, 'public', 'media', 'presets');
const TMP = path.join(require('os').tmpdir(), 'chucksi-previews');
const FPS = 24;
const args = process.argv.slice(2);
const si = args.indexOf('--sheet'); const sheet = si >= 0 ? args.splice(si, 2)[1] : null;
const ei = args.indexOf('--encode-only'); const encodeOnly = ei >= 0 && !!args.splice(ei, 1);
const MAX = 160 * 1024; // keeps the whole gallery's loops under its 16 MB budget
fs.mkdirSync(OUT, { recursive: true });
function encode(dir, dst, crf) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dir, '%04d.jpg'), '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst]);
  return fs.statSync(dst).size;
}
(async () => {
  const { PRESETS } = await import(path.join(ROOT, 'public/js/presets/catalog.js'));
  const ids = args.length ? args : PRESETS.map((p) => p.id);
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on('pageerror', (e) => console.log('  pageerror', e.message));
  const done = [];
  const strip = [];
  for (const id of ids) {
    const t0 = Date.now();
    const dir = path.join(TMP, id);
    let info, n;
    if (encodeOnly && fs.existsSync(dir)) {
      n = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length;
      info = { duration: n / FPS };
    } else {
    await pg.goto(`${BASE}/workflows?preset=${id}&capture=1`);
    await pg.waitForFunction(() => window.__presetCapture && /Ready|playing/.test(document.querySelector('.maker-status')?.textContent || ''), null, { timeout: 120000 });
    info = await pg.evaluate(() => window.__presetCapture.setup());
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    n = sheet ? 6 : Math.round(info.duration * FPS);
    for (let i = 0; i < n; i++) {
      const t = sheet ? (i / n) * info.duration + 0.2 : i / FPS;
      const url = await pg.evaluate(([t, d]) => window.__presetCapture.frame(t, d), [t, info.duration]);
      fs.writeFileSync(path.join(dir, `${String(i).padStart(4, '0')}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
    }
    }
    if (sheet) { strip.push(dir); console.log(id, 'frames', Date.now() - t0, 'ms'); continue; }
    const mp4 = path.join(OUT, `${id}.mp4`);
    let crf = 28, size = encode(dir, mp4, crf);
    while (size > MAX && crf < 40) { crf += 2; size = encode(dir, mp4, crf); }
    // poster: a settled frame
    const spec = PRESETS.find((p) => p.id === id);
    const pick = Math.min(n - 1, Math.round(n * (spec.preview.posterAt ?? (spec.preview.loop === 'samples' ? 0.2 : 0.62))));
    const webp = path.join(OUT, `${id}.webp`);
    execFileSync('python3', ['-I', '-c', `
import sys, os
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
for q in (80, 72, 64, 56, 48, 40):
    im.save(sys.argv[2], 'WEBP', quality=q, method=6)
    if os.path.getsize(sys.argv[2]) <= 40 * 1024: break
`, path.join(dir, `${String(pick).padStart(4, '0')}.jpg`), webp]);
    done.push({ id, info, files: [mp4, webp] });
    console.log(id, `${(size / 1024).toFixed(0)} KB crf${crf}`, `poster ${(fs.statSync(webp).size / 1024).toFixed(0)} KB`, `${info.duration.toFixed(1)} s`, Date.now() - t0, 'ms');
  }
  await b.close();
  if (sheet) {
    execFileSync('python3', ['-I', '-c', `
import sys, glob
from PIL import Image
rows = []
for d in sys.argv[2:]:
    ims = [Image.open(f) for f in sorted(glob.glob(d + '/*.jpg'))]
    h = 300; ims = [i.resize((int(i.width * h / i.height), h)) for i in ims]
    rows.append(ims)
W = max(sum(i.width + 4 for i in r) for r in rows); s = Image.new('RGB', (W, len(rows) * 304), 'white')
for y, r in enumerate(rows):
    x = 0
    for i in r: s.paste(i, (x, y * 304)); x += i.width + 4
s.save(sys.argv[1], quality=80)
`, sheet, ...strip]);
    return;
  }
  // provenance, next to the other gallery loops
  const pf = path.join(ROOT, 'public/media/templates/provenance.json');
  const prov = JSON.parse(fs.readFileSync(pf, 'utf8'));
  const source = 'preset-factory';
  prov.sources[source] = 'Preset gallery loops rendered on device by each preset\'s own engine through /workflows?preset=<id>&capture=1 (tools/presets/render-previews.cjs), from the bundled sample inputs (public/presets/provenance.json). Encoded with ffmpeg; no external footage.';
  const keep = new Set(done.flatMap((d) => d.files.map((f) => path.relative(path.join(ROOT, 'public'), f))));
  prov.files = prov.files.filter((f) => !keep.has(f.path));
  for (const d of done) for (const f of d.files) {
    const data = fs.readFileSync(f);
    prov.files.push({ path: path.relative(path.join(ROOT, 'public'), f), bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), card: `preset-${d.id}`, source, recorded_from: `/workflows?preset=${d.id}` });
  }
  fs.writeFileSync(pf, JSON.stringify(prov, null, 1) + '\n');
})();
