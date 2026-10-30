"""Bake depth maps for the sample stills so the Video page loads them instantly.

python3 tools/bake_depth.py [key ...]   -> public/media/depth/<key>.png (8-bit grayscale, refined)

Runs Depth Anything V2 Small through the same depth.js the site uses, in headless Chromium.
"""
import http.server, threading, socketserver, os, sys, functools, base64, json
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
OUT = os.path.join(ROOT, 'media', 'depth'); os.makedirs(OUT, exist_ok=True)
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]
keys = sys.argv[1:] or sorted(f[:-4] for f in os.listdir(os.path.join(ROOT, 'media', 'art')) if f.endswith('.jpg'))
JS = """async (key) => {
  const { estimateDepth } = await import('/js/depth.js');
  const bmp = await createImageBitmap(await (await fetch(`/media/art/${key}.jpg`)).blob());
  const d = await estimateDepth(bmp);
  const c = document.createElement('canvas'); c.width = d.w; c.height = d.h;
  const g = c.getContext('2d'); const im = g.createImageData(d.w, d.h);
  for (let i = 0; i < d.data.length; i++) { im.data[i*4] = im.data[i*4+1] = im.data[i*4+2] = d.data[i]; im.data[i*4+3] = 255; }
  g.putImageData(im, 0, 0);
  const url = c.toDataURL('image/png');
  return { source: d.source, w: d.w, h: d.h, b64: url.slice(url.indexOf(',') + 1) };
}"""
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(); pg.set_default_timeout(0)
    pg.goto(f'http://127.0.0.1:{port}/media/')  # any HTML page on the same origin
    for k in keys:
        r = pg.evaluate(JS, k)
        if r['source'] != 'model': print(k, 'SKIPPED: depth model unavailable'); continue
        open(os.path.join(OUT, f'{k}.png'), 'wb').write(base64.b64decode(r['b64']))
        print(k, r['w'], 'x', r['h'], flush=True)
    b.close()
