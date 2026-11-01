"""Website template thumbnails: render each template's example site (the same code the builder exports) at
1440 x 900, screenshot the first screen and save a 640 x 400 WebP to public/media/website/tpl-<id>.webp.
python3 tests/website_thumbs.py [id ...]   (needs network for Google Fonts; files stay under ~80 KB)"""
import http.server, threading, socketserver, os, sys, functools, io
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
OUT = os.path.join(ROOT, 'media', 'website')


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
BASE = f'http://127.0.0.1:{srv.server_address[1]}'
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.goto(f'{BASE}/privacy.html')
    ids = pg.evaluate("import('/js/website/templates-list.js').then(m => m.TEMPLATES_LIST.map(t => t.id))")
    want = sys.argv[1:] or ids
    for tid in want:
        pg.goto(f'{BASE}/privacy.html')
        html = pg.evaluate("""async (id) => {
          const [{ buildTemplate }, { renderSingle }] = await Promise.all([import('/js/website/templates.js'), import('/js/website/render.js')]);
          return renderSingle(buildTemplate(id), {});
        }""", tid)
        pg.set_content(html, wait_until='load')
        pg.evaluate('document.fonts.ready')
        pg.wait_for_timeout(1600)
        im = Image.open(io.BytesIO(pg.screenshot())).convert('RGB').resize((640, 400), Image.LANCZOS)
        path = os.path.join(OUT, f'tpl-{tid}.webp')
        for q in (82, 74, 66, 58):
            im.save(path, 'WEBP', quality=q, method=6)
            if os.path.getsize(path) < 80 * 1024: break
        print(tid, os.path.getsize(path), 'bytes')
    b.close()
