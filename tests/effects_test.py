"""Effects on the Video page: LiDAR scan, Vanish, Bullet time freeze, Clones.

python3 tests/effects_test.py [out_dir]

For every effect and look on a sample still, renders t = 0, .25, .5, .75, 1 into a contact sheet
(tests/out/effects/), and checks that frames are not blank, change over time, that Vanish ends on
the background where the subject was while the rest of the frame stays put, and that LiDAR scan and
Bullet time freeze start and end on the photo. Then exports a short MP4 of each effect through the
page UI, and takes desktop and phone screenshots (no horizontal overflow, no page errors).
"""
import http.server, threading, socketserver, os, sys, functools, json, base64, io, time
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'effects')
os.makedirs(OUT, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/image', '/video', '/audio', '/3d', '/film', '/office'): p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)

    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

# effect: (sample still, looks)
CASES = {
    'lidar': ('canyon', ['cyan', 'thermal', 'white']),
    'vanish': ('dancer', ['ash', 'embers', 'pixels']),
    'freeze': ('astronaut', ['']),
    'clones': ('neon', ['natural', 'rainbow', 'ghost']),
}
TS = [0, 0.25, 0.5, 0.75, 1]
W = 512

# Renders one frame at t and returns stats against a reference, plus a PNG for the sheet.
# Masks come from the effect's own matte, mapped through the rest camera's overscan crop.
FRAME = """([t, useRef]) => {
  const m = window.massless;
  const ref = useRef ? { px: window.__ref } : null;
  const r = m.renderer;
  const gl = r.gl;
  const dur = m.state.duration;
  m.drawFrame(t, t * dur);
  const w = r.canvas.width, h = r.canvas.height;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const png = r.canvas.toDataURL('image/png').split(',')[1];
  let sum = 0, sum2 = 0, nan = 0;
  for (let i = 0; i < px.length; i += 4) { const l = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114; sum += l; sum2 += l * l; }
  const n = px.length / 4;
  const mean = sum / n;
  const out = { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
  if (ref) {
    const p = m.effects.prep;
    let din = 0, nin = 0, dout = 0, nout = 0, dall = 0;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        let d = 0;
        for (let c = 0; c < 3; c++) d += Math.abs(px[i + c] - ref.px[i + c]);
        d /= 3;
        dall += d;
        // canvas rows run bottom-up; the rest camera shows the middle 1/1.08 of the image
        const u = 0.5 + ((x + 0.5) / w - 0.5) / 1.08;
        const v = 0.5 + ((y + 0.5) / h - 0.5) / 1.08;
        const X = Math.min(p.W - 1, Math.floor(u * p.W));
        const Y = Math.min(p.H - 1, Math.floor((1 - v) * p.H));
        const k = (Y * p.W + X) * 4;
        if (p.fx[k] > 160) { din += d; nin++; } else if (p.fx[k + 3] < 4 && p.fx[k + 1] < 4) { dout += d; nout++; }
      }
    }
    Object.assign(out, { dIn: nin ? din / nin : 0, dOut: nout ? dout / nout : 0, dAll: dall / (w * h / 4), nIn: nin });
  }
  return { ...out, png };
}"""

REF = """(time) => {
  // the photo through the rest camera, same finish and grain time: what 'back to the photo' means
  const m = window.massless;
  const s = m.state;
  const keep = [s.effect, s.move];
  s.effect = null; s.move = 'breathe';
  m.updateZoom();
  m.drawFrame(0, time);
  const r = m.renderer, gl = r.gl;
  const px = new Uint8Array(r.canvas.width * r.canvas.height * 4);
  gl.readPixels(0, 0, r.canvas.width, r.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  [s.effect, s.move] = keep;
  window.__ref = px;
}"""

res = {'frames': {}, 'export': {}, 'shots': {}}
errors = []
fails = []
rows = []


def check(cond, msg):
    if not cond: fails.append(msg)


with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'])

    def page(path, w=1280, h=800):
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1 if w > 600 else 2, accept_downloads=True)
        pg.set_default_timeout(0)
        pg.on('pageerror', lambda e: errors.append(f'{path}: {e}'))
        pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(f'{path}: {m.text[:200]}'))
        pg.goto(f'http://127.0.0.1:{port}{path}', wait_until='domcontentloaded')
        return pg

    # ---------- frames ----------
    for eid, (sample, looks) in CASES.items():
        pg = page(f'/video?sample={sample}&effect={eid}')
        pg.wait_for_function('window.massless && massless.state.current && massless.state.current.depth && massless.effects.prep', timeout=300000)
        info = pg.evaluate(f"""() => {{
          const m = window.massless; m.state.recording = true; m.effects.density = 0.6;
          const a = m.renderer.aspect; m.renderer.setSize(a >= 1 ? {W} : {W} * a, a >= 1 ? {W} / a : {W});
          const p = m.effects.prep;
          return {{ prepMs: p.ms, area: +p.area.toFixed(3), fallback: p.fallback, duration: m.state.duration }};
        }}""")
        dur = info['duration']
        for look in looks:
            if look:
                pg.click(f'#fx-looks button:has-text("{dict(cyan="Cyan", thermal="Thermal", white="White", ash="Ash", embers="Embers", pixels="Pixels", natural="Natural", rainbow="Rainbow", ghost="Ghost glow")[look]}")')
                pg.evaluate('massless.state.recording = true')
            key = f'{eid}:{look or "-"}'
            stats = []
            imgs = []
            t0 = time.time()
            for t in TS:
                pg.evaluate(REF, t * dur)
                s = pg.evaluate(FRAME, [t, True])
                imgs.append(Image.open(io.BytesIO(base64.b64decode(s.pop('png')))).convert('RGB'))
                stats.append({k: round(v, 2) if isinstance(v, float) else v for k, v in s.items()})
            ms = (time.time() - t0) / len(TS) * 1000
            res['frames'][key] = {'sample': sample, **info, 'msPerFrame': round(ms), 'stats': stats}
            for i, s in enumerate(stats):
                check(s['std'] > 4 and 3 < s['mean'] < 250, f'{key} t={TS[i]} looks blank (mean {s["mean"]}, std {s["std"]})')
            # Vanish only touches the subject, so judge it there
            moved = max(s['dIn'] if eid == 'vanish' else s['dAll'] for s in stats[1:4])
            check(moved > 6, f'{key}: frames barely change over time ({moved})')
            check(len(set(round(s['mean'], 1) for s in stats)) > 2, f'{key}: frames look identical')
            if eid in ('lidar', 'freeze'):
                check(stats[0]['dAll'] < 3, f'{key}: first frame is not the photo (diff {stats[0]["dAll"]})')
                check(stats[-1]['dAll'] < 3, f'{key}: last frame is not the photo (diff {stats[-1]["dAll"]})')
                check(stats[2]['dAll'] > 12, f'{key}: the middle of the effect looks like the photo')
            if eid == 'vanish':
                check(stats[0]['dAll'] < 3, f'{key}: first frame is not the photo')
                for i in (3, 4):
                    check(stats[i]['dIn'] > 10, f'{key} t={TS[i]}: the subject is still there (diff inside {stats[i]["dIn"]})')
                check(stats[4]['dOut'] < 3, f'{key}: the rest of the frame changed at the end (diff outside {stats[4]["dOut"]})')
                check(stats[3]['dOut'] < 8, f'{key}: the rest of the frame changed at t=.75 (diff outside {stats[3]["dOut"]})')
            if eid == 'clones':
                check(stats[0]['dAll'] < 3, f'{key}: first frame is not the photo')
            # contact sheet row
            w, h = imgs[0].size
            row = Image.new('RGB', (w * len(TS) + 150, h), (12, 12, 14))
            d = ImageDraw.Draw(row)
            d.text((8, 8), f'{eid}\n{look or "-"}\n{sample}', fill=(255, 200, 60))
            for i, im in enumerate(imgs):
                ImageDraw.Draw(im).text((6, 4), f't={TS[i]}', fill=(255, 255, 0))
                row.paste(im, (150 + i * w, 0))
            row.save(os.path.join(OUT, f'{eid}-{look or "default"}.jpg'), quality=86)
            rows.append(row)
            print(key, json.dumps({'msPerFrame': round(ms), 'dAll': [s['dAll'] for s in stats], 'dIn': [s.get('dIn') for s in stats], 'dOut': [s.get('dOut') for s in stats]}), flush=True)
        pg.close()
    if rows:
        Wm = max(r.width for r in rows)
        sheet = Image.new('RGB', (Wm, sum(r.height for r in rows) + 4 * len(rows)), (0, 0, 0))
        y = 0
        for r in rows:
            sheet.paste(r, (0, y)); y += r.height + 4
        sheet.save(os.path.join(OUT, 'contact-sheet.jpg'), quality=86)

    # ---------- export through the UI ----------
    pg = page('/video?sample=neon')
    pg.wait_for_function('window.massless && massless.state.current && massless.state.current.depth', timeout=300000)
    for i, eid in enumerate(CASES):
        pg.click(f'.mcard[data-key="{eid}"]')
        pg.wait_for_function(f'massless.state.effect === "{eid}" && massless.effects.prep', timeout=300000)
        # earlier clips autoplay in Your clips; pause them so they do not compete with the encoder
        pg.evaluate("massless.state.duration = 1; massless.state.fps = 12; document.querySelectorAll('video').forEach((v) => v.pause())")
        t0 = time.time()
        pg.click('#record')
        pg.wait_for_function(f'document.querySelectorAll(".clip").length === {i + 1} && !massless.state.recording', timeout=900000)
        clip = pg.evaluate("""async () => {
          const a = document.querySelector('.clip a.dl');
          const blob = await (await fetch(a.href)).blob();
          return { file: a.getAttribute('download'), bytes: blob.size, type: blob.type, label: document.querySelector('.clip .meta span').textContent };
        }""")
        clip['s'] = round(time.time() - t0, 1)
        res['export'][eid] = clip
        check(clip['file'].endswith('.mp4') and clip['bytes'] > 20000, f'export {eid}: {clip}')
        print('export', eid, clip, flush=True)
    check(not pg.evaluate("document.querySelector('#clips-wrap').hidden"), 'Your clips is hidden after exporting')
    pg.close()

    # ---------- screenshots ----------
    for (w, h, name) in [(1440, 900, 'desktop'), (390, 844, 'phone')]:
        pg = page('/video?sample=samurai&effect=lidar&look=thermal', w, h)
        pg.wait_for_function('window.massless && massless.state.current && massless.state.current.depth && massless.effects.prep', timeout=300000)
        pg.evaluate('massless.state.recording = true; massless.drawFrame(0.5, 3)')
        pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(OUT, f'video-effect-{name}.png'), timeout=150000)
        pg.evaluate("massless.state.recording = false; document.querySelector('#groups button:nth-child(2)').click(); document.querySelector('#library').scrollIntoView()")
        pg.wait_for_timeout(1500)
        pg.evaluate('massless.state.recording = true')
        pg.screenshot(path=os.path.join(OUT, f'video-library-{name}.png'), timeout=150000)
        over = pg.evaluate('document.documentElement.scrollWidth - window.innerWidth')
        res['shots'][name] = {'overflow': over, 'effectCards': pg.evaluate("[...document.querySelectorAll('.mcard')].filter(c => !c.hidden).length")}
        check(over <= 0, f'{name}: horizontal overflow {over}px')
        check(res['shots'][name]['effectCards'] == 4, f'{name}: Effects tab shows {res["shots"][name]["effectCards"]} cards')
        pg.close()
    b.close()

json.dump(res, open(os.path.join(OUT, 'results.json'), 'w'), indent=1)
print(json.dumps({'export': res['export'], 'shots': res['shots']}, indent=1))
print('errors:', errors)
print('failures:', fails)
sys.exit(1 if errors or fails else 0)
