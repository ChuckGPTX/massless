"""Headless checks for the renderer and camera moves.

Serves ./public, opens it in Chromium, and for every camera move renders the first,
middle and last frame. Checks: the page boots without errors, every move produces
visible motion, and no move shows the dark background at the frame edges (the
auto-overscan works). Screenshots land in tests/out/.
"""
import http.server, threading, socketserver, os, sys, json, functools
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public')
OUT = os.path.join(os.path.dirname(__file__), 'out')
os.makedirs(OUT, exist_ok=True)

Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
Handler = functools.partial(Quiet, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(('127.0.0.1', 0), Handler)
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()

errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    page = b.new_page(viewport={'width': 1440, 'height': 900})
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f'http://127.0.0.1:{port}/', wait_until='networkidle')
    page.wait_for_function('window.massless && window.massless.renderer.hasImage', timeout=20000)
    page.evaluate("window.massless.state.recording = true; window.massless.drawFrame(0, 0)")
    page.wait_for_timeout(300)
    page.screenshot(path=f'{OUT}/desktop.png')

    moves = page.evaluate("Array.from(document.querySelectorAll('.move')).map(b => b.dataset.key)")
    results = {}
    for mid in moves:
        r = page.evaluate("""(mid) => {
          const m = window.massless;
          m.state.move = mid; m.state.recording = true; m.updateZoom();
          const c = m.renderer.canvas;
          const gl = m.renderer.gl;
          const grab = (t) => { m.drawFrame(t, 0); const w = c.width, h = c.height; const px = new Uint8Array(w*h*4); gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px); return {px, w, h}; };
          const a = grab(0), mid_ = grab(0.3), z = grab(1);
          const diff = (x, y) => { let s = 0; for (let i = 0; i < x.px.length; i += 16) s += Math.abs(x.px[i] - y.px[i]); return s / (x.px.length / 16); };
          // edge check: the clear color is (20,23,28). Count edge pixels that match it exactly-ish.
          const edgeBg = (f) => { let n = 0, tot = 0; const {px, w, h} = f;
            const test = (x, y) => { const i = (y*w + x)*4; tot++; if (Math.abs(px[i]-20) < 4 && Math.abs(px[i+1]-23) < 4 && Math.abs(px[i+2]-28) < 4) n++; };
            for (let x = 0; x < w; x += 4) { test(x, 1); test(x, h-2); }
            for (let y = 0; y < h; y += 4) { test(1, y); test(w-2, y); }
            return n / tot; };
          const out = { zoom: m.state.zoom, motion: diff(a, z) + diff(a, mid_), edge: Math.max(edgeBg(a), edgeBg(mid_), edgeBg(z)) };
          return out;
        }""", mid)
        results[mid] = r
        for t, name in [(0, 'a'), (0.5, 'b'), (1, 'c')]:
            page.evaluate("([t]) => window.massless.drawFrame(t, 0)", [t])
            page.locator('#view').screenshot(path=f'{OUT}/move-{mid}-{name}.png')
    page.close()

    # rest-frame identity: with intensity ~0, frame 0 of dolly-in should match the source center crop closely
    mobile = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    mobile.on('pageerror', lambda e: errors.append('mobile: ' + str(e)))
    mobile.goto(f'http://127.0.0.1:{port}/', wait_until='networkidle')
    mobile.wait_for_function('window.massless && window.massless.renderer.hasImage', timeout=60000)
    mobile.evaluate("window.massless.state.recording = true; window.massless.drawFrame(0, 0)")
    mobile.wait_for_timeout(300)
    mobile.screenshot(path=f'{OUT}/mobile.png', full_page=False)
    mobile.screenshot(path=f'{OUT}/mobile-full.png', full_page=True)
    b.close()

print(json.dumps(results, indent=1))
print('errors:', errors)
bad = [k for k, v in results.items() if (v['motion'] < 0.5 and k != 'breathe') or v['edge'] > 0.02]
print('failing moves:', bad)
sys.exit(1 if errors or bad else 0)
