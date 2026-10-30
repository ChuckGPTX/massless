"""Screenshot pages: python3 tests/shots.py out_dir path[@WxH] ...  (serves ./public with SPA routes)"""
import http.server, threading, socketserver, os, sys, functools
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/image', '/video', '/audio', '/3d'): p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    for spec in sys.argv[2:]:
        path, _, size = spec.partition('@')
        w, h = (int(x) for x in (size or '1440x900').split('x'))
        full = path.endswith('!'); path = path.rstrip('!')
        pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1 if w > 600 else 2)
        pg.on('pageerror', lambda e, s=spec: errors.append(f'{s}: {e}'))
        pg.on('console', lambda m, s=spec: m.type == 'error' and errors.append(f'{s}: {m.text[:160]}'))
        pg.goto(f'http://127.0.0.1:{port}{path}', wait_until='domcontentloaded')
        pg.wait_for_timeout(int(os.environ.get("WAIT","2500")))
        pg.evaluate('window.massless && (window.massless.state.recording = true)')
        pg.wait_for_timeout(400)
        name = (path.strip('/').replace('/', '_').replace('?', '_') or 'explore') + f'-{w}' + ('-full' if full else '')
        pg.screenshot(path=f'{out}/{name}.png', full_page=full, timeout=150000, caret='initial')
        print('shot', name)
        pg.close()
    b.close()
print('errors:', errors)
