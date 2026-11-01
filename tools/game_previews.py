"""Art and preview clips for the Games gallery.

python3 tools/game_previews.py assets          -> public/media/games/t1-*.png|jpg, tp-greenhouse.jpg
python3 tools/game_previews.py [record] [id ...] -> public/media/games/<id>.mp4 and .jpg

assets: cuts the T1 Vendetta sprite strips (Tone's run, jump and hurt frames; three rivals' walk and hurt
frames) from the game's animated sheets into fixed 128x112 cells, feet on a common baseline, and copies four
stage backgrounds and the Tiny Prompters greenhouse. Needs /home/claude/t1-vendetta (or T1_DIR).

record: opens /games in headless Chromium, starts each gallery game with its own bot playing, steps the game
at exactly 30 fps after a short pre-roll, composites its canvases (three.js layer included) into a 360x640
frame and encodes it with the page's WebCodecs recorder, then ffmpeg crops it to the cards' 3:4 and squeezes
it. Every frame is a function of the game's fixed step, so a clip is the same every time it is recorded.
"""
import http.server, threading, socketserver, os, sys, functools, base64, subprocess, tempfile, io, json
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
OUT = os.path.join(ROOT, 'media', 'games')
T1 = os.environ.get('T1_DIR', '/home/claude/t1-vendetta')
CELL = (128, 112)
BASE = (64, 108)  # where a frame's body anchor (x) and feet (y) land in its cell
RIVALS = ['bigd', 'dachaman', 'streetguy']
STAGES = ['jstreet', 'plaza', 'navypier', 'ironbloom']
# id: (pre-roll seconds, clip seconds, poster fraction, crop top in the 640-tall frame)
CLIPS = {
    't1-street-run': (4.0, 7.0, 0.45, 96), 'sky-tower': (9.0, 7.0, 0.6, 80), 'star-hornets': (9.0, 7.0, 0.5, 40),
    'tp-robot-match': (1.5, 7.0, 0.15, 76), 'deep-snack': (14.0, 7.0, 0.5, 80), 'cheese-quest': (2.5, 7.0, 0.5, 70),
    'dune-rover': (6.0, 7.0, 0.4, 96), 'pancake-panic': (8.0, 7.0, 0.6, 80), 'jelly-storm': (10.0, 7.0, 0.5, 40),
    'crystal-caves': (3.0, 7.0, 0.5, 76), 'planet-muncher': (14.0, 7.0, 0.5, 80), 'night-circuit': (2.5, 7.0, 0.5, 70),
}


def strip(sheet_name, anims, meta, rows=False):
    """Cut frames into fixed cells, aligned on the body anchor and the feet."""
    im = Image.open(os.path.join(T1, 'src/assets/animated', f'{sheet_name}.png')).convert('RGBA')
    m = meta[sheet_name]
    frames = []
    for name, take in anims:
        idx = m['animations'][name]
        idx = idx if take is None else [idx[i] for i in take]
        for i in idx:
            f = m['frames'][i]
            crop = im.crop((f['x'], f['y'], f['x'] + f['width'], f['y'] + f['height']))
            cell = Image.new('RGBA', CELL, (0, 0, 0, 0))
            ax = f.get('bodyAnchorX', f['anchorX'])
            cell.paste(crop, (round(BASE[0] - ax), round(BASE[1] - f['anchorY'])), crop)
            frames.append(cell)
    return frames


def assets():
    os.makedirs(OUT, exist_ok=True)
    meta = json.load(open(os.path.join(T1, 'src/assets/animated/animation-meta.json')))
    tone = strip('tone', [('walk', None), ('jump', None), ('hurt', [1, 2])], meta)
    sheet = Image.new('RGBA', (CELL[0] * len(tone), CELL[1]), (0, 0, 0, 0))
    for i, f in enumerate(tone): sheet.paste(f, (i * CELL[0], 0))
    sheet.save(os.path.join(OUT, 't1-tone.png'), optimize=True)
    rivals = Image.new('RGBA', (CELL[0] * 10, CELL[1] * len(RIVALS)), (0, 0, 0, 0))
    for r, name in enumerate(RIVALS):
        for i, f in enumerate(strip(name, [('walk', None), ('hurt', [1, 2])], meta)):
            rivals.paste(f, (i * CELL[0], r * CELL[1]))
    rivals.save(os.path.join(OUT, 't1-rivals.png'), optimize=True)
    for s in STAGES:
        Image.open(os.path.join(T1, 'src/assets/arcade', f'{s}.png')).convert('RGB').save(os.path.join(OUT, f't1-{s}.jpg'), quality=82, optimize=True, progressive=True)
    g = Image.open(os.path.join(ROOT, 'media/art/tp-greenhouse.jpg')).convert('RGB')
    w = round(g.height * 9 / 16)
    g.crop(((g.width - w) // 2, 0, (g.width - w) // 2 + w, g.height)).resize((540, 960), Image.LANCZOS).save(os.path.join(OUT, 'tp-greenhouse.jpg'), quality=80, optimize=True, progressive=True)
    for f in sorted(os.listdir(OUT)):
        if f.startswith(('t1-', 'tp-')): print(f, os.path.getsize(os.path.join(OUT, f)), 'bytes')


RECORD = """async ([id, pre, dur, posterAt]) => {
  const m = window.massless;
  const mount = await m.openGallery(id, { bot: true, autostart: true, noMusic: true });
  const g = mount.game;
  g.stop();
  const W = 360, H = 640;
  mount.canvas.width = W; mount.canvas.height = H;
  if (g.world.gl) {
    g.world.gl.renderer.setPixelRatio(1); g.world.gl.renderer.setSize(W, H, false);
  }
  g.advance(pre);
  const rec = document.createElement('canvas'); rec.width = W; rec.height = H;
  const ctx = rec.getContext('2d');
  const compose = () => { g.render(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); for (const c of mount.frame.querySelectorAll('canvas')) ctx.drawImage(c, 0, 0, W, H); };
  const { recordSegments } = await import('/js/recorder.js');
  let poster = null;
  const t0 = g.time;
  const res = await recordSegments(rec, { fps: 30, segments: [{ duration: dur, draw: (t, time) => {
    while (g.time < t0 + time - 1e-6 && (g.state === 'play' || g.state === 'ending')) g.step();
    compose();
    if (!poster && t >= posterAt) poster = rec.toDataURL('image/png').split(',')[1];
  } }] });
  const buf = new Uint8Array(await res.blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  const info = { state: g.state, score: g.score, time: g.time };
  m.closeGame();
  return { mp4: btoa(bin), poster, ext: res.ext, info };
}"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/games', '/build'): p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)

    def log_message(self, *a): pass


def record(ids):
    from playwright.sync_api import sync_playwright
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Handler, directory=ROOT))
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'])
        pg = b.new_page(viewport={'width': 1280, 'height': 900})
        pg.set_default_timeout(0)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://127.0.0.1:{port}/games/', wait_until='domcontentloaded')
        pg.wait_for_function('window.massless && window.massless.openGallery', timeout=60000)
        for gid in ids:
            pre, dur, poster_at, top = CLIPS[gid]
            r = pg.evaluate(RECORD, [gid, pre, dur, poster_at])
            assert r['ext'] == 'mp4', r['ext']
            with tempfile.TemporaryDirectory() as tmp:
                raw = os.path.join(tmp, 'raw.mp4')
                open(raw, 'wb').write(base64.b64decode(r['mp4']))
                dst = os.path.join(OUT, f'{gid}.mp4')
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-an', '-vf', f'crop=360:480:0:{top}', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30',
                                '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst], check=True)
            Image.open(io.BytesIO(base64.b64decode(r['poster']))).convert('RGB').crop((0, top, 360, top + 480)).save(os.path.join(OUT, f'{gid}.jpg'), quality=80, optimize=True, progressive=True)
            print(gid, os.path.getsize(dst), 'bytes', r['info'], flush=True)
        b.close()
        if errors: print('page errors:', errors)


if __name__ == '__main__':
    args = sys.argv[1:]
    if args[:1] == ['assets']:
        assets()
    else:
        ids = [a for a in args if a != 'record'] or list(CLIPS)
        record(ids)
