"""Film page test: template film renders, every block draws, a short export produces an MP4 (with sound when score.js exists).
python3 tests/film_test.py [out_dir]"""
import http.server, threading, socketserver, os, sys, functools, json, base64
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
NO_EXPORT = '--no-export' in sys.argv
OUT = args[0] if args else os.path.join(os.path.dirname(__file__), 'out'); os.makedirs(OUT, exist_ok=True)
class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/image', '/video', '/audio', '/3d', '/film'): p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
res = {}; errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    pg = b.new_page(viewport={'width': 1440, 'height': 900}); pg.set_default_timeout(0)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(m.text[:200]))
    pg.goto(f'http://127.0.0.1:{port}/film', wait_until='domcontentloaded')
    pg.wait_for_function('window.massless && window.massless.state.lay', timeout=120000)
    res['template'] = pg.evaluate("({ blocks: massless.state.lay.blocks.map(b => b.type + ':' + b.beats), beats: massless.state.lay.beats, drop: massless.state.lay.dropBeat, cuts: massless.state.lay.cuts.length, score: !!massless.state.score, checks: [...document.querySelectorAll('.chk')].map(c => c.innerText.replace(/\\n/g, ' ')) })")
    pg.screenshot(path=f'{OUT}/film-page.png', timeout=120000)
    # a contact sheet: the middle of every block at 640x360
    shots = pg.evaluate("""async () => {
      const { FilmRenderer } = await import('/js/film.js');
      const c = document.createElement('canvas'); c.width = 640; c.height = 360;
      const r = new FilmRenderer(c); Object.assign(r.images, massless.renderer.images); r.setSpec(massless.state.spec);
      const bs = 60 / massless.state.spec.bpm; const out = [];
      for (const blk of r.lay.blocks) for (const f of [0.15, 0.6]) { r.render((blk.start + blk.beats * f) * bs, { samples: 3, fps: 30 }); out.push([blk.type, c.toDataURL('image/jpeg', 0.8)]); }
      return out;
    }""")
    from PIL import Image
    import io
    tiles = [Image.open(io.BytesIO(base64.b64decode(u.split(',')[1]))) for _, u in shots]
    cols = 4; rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * 320, rows * 180), 'black')
    for i, t in enumerate(tiles): sheet.paste(t.resize((320, 180)), ((i % cols) * 320, (i // cols) * 180))
    sheet.save(f'{OUT}/film-blocks.jpg', quality=85)
    res['frames'] = len(tiles)
    if NO_EXPORT:
        b.close(); print(json.dumps(res, indent=1)); print('errors:', errors); sys.exit(1 if errors else 0)
    # short export: a 3-block film at 720p
    pg.evaluate("""async () => {
      const s = massless.state.spec;
      const spec = { ...s, blocks: [ { type: 'words', beats: 4, words: ['ONE', 'TWO', 'THREE', 'FOUR'] }, { type: 'hero', beats: 4, text: s.title, drop: true }, { type: 'logo', beats: 4, text: s.title, sub: 'test' } ] };
      document.querySelector('#quality').value = '720';
      await massless.applySpec(spec);
    }""")
    pg.click('#export')
    pg.wait_for_function("document.querySelectorAll('.clip').length === 1 && !massless.state.recording", timeout=900000)
    info = pg.evaluate("""async () => { const a = document.querySelector('.clip a.dl'); const blob = await (await fetch(a.href)).blob(); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < Math.min(buf.length, 4000000); i++) s += String.fromCharCode(buf[i]); return { name: a.download, bytes: blob.size, hasAudio: s.includes('mp4a') || s.includes('Opus'), meta: document.querySelector('.clip .meta span').textContent, b64: btoa(s.slice(0, 2_000_000)).length }; }""")
    res['export'] = {k: v for k, v in info.items() if k != 'b64'}
    url = pg.evaluate("document.querySelector('.clip a.dl').href")
    data = pg.evaluate("async (u) => { const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); let s=''; for (let i=0;i<b.length;i+=0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i+0x8000)); return btoa(s); }", url)
    open(f'{OUT}/film-export.mp4', 'wb').write(base64.b64decode(data))
    b.close()
print(json.dumps(res, indent=1)); print('errors:', errors)
sys.exit(1 if errors or 'export' not in res else 0)
