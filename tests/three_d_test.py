"""3D page test: depth splat from a sample, then the Idol path against a mocked local server.
python3 tests/three_d_test.py [out_dir]"""
import http.server, threading, socketserver, os, sys, functools, json, struct, math, random
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'out'); os.makedirs(OUT, exist_ok=True)
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

def fake_ply(n=20000):
    """A colored ball in the usual 3DGS convention (y down), standing in for Idol output."""
    props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3']
    head = ('ply\nformat binary_little_endian 1.0\nelement vertex %d\n' % n + ''.join('property float %s\n' % p for p in props) + 'end_header\n').encode()
    body = bytearray(); rnd = random.Random(1)
    for i in range(n):
        z = rnd.uniform(-1, 1); a = rnd.uniform(0, 2 * math.pi); r = math.sqrt(1 - z * z)
        x, y = r * math.cos(a), r * math.sin(a)
        body += struct.pack('<14f', x * 0.5, -y * 0.5 - 0.2 * (y > 0.6), z * 0.5, (x + 1) * 1.5 - 1.5, (z + 1) * 1.5 - 1.5, 0.8, 3.0, -4.2, -4.2, -4.2, 1, 0, 0, 0)
    return head + bytes(body)

res = {}; errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800}); pg.set_default_timeout(0)
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(m.text[:200]))
    ply = fake_ply()
    def idol(route):
        u = route.request.url
        hdr = {'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type'}
        if route.request.method == 'OPTIONS': return route.fulfill(status=204, headers=hdr)
        if u.endswith('/health'): return route.fulfill(status=200, headers=hdr, content_type='application/json', body=json.dumps({'ok': True, 'device': 'Mock GPU'}))
        res['idol_request'] = {'url': u.split('?', 1)[1], 'bytes': len(route.request.post_data_buffer or b'')}
        return route.fulfill(status=200, headers=hdr, content_type='application/octet-stream', body=ply)
    pg.route('http://127.0.0.1:7861/**', idol)
    pg.goto(f'http://127.0.0.1:{port}/3d?sample=lighthouse', wait_until='domcontentloaded')
    pg.wait_for_function('window.massless && window.massless.mesh && !window.massless.state.busy', timeout=300000)
    res['depth'] = pg.evaluate("({ splats: document.querySelector('#hud-count').textContent, name: document.querySelector('#hud-name').textContent, src: document.querySelector('#src-label').textContent, download: !document.querySelector('#download').disabled })")
    pg.wait_for_timeout(1500)
    pg.evaluate('massless.state.recording = true'); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/3d-depth.png', timeout=120000)
    pg.evaluate('massless.state.recording = false')
    pg.click('#t-idol'); pg.wait_for_function("document.querySelector('#o-idol').textContent.includes('ready')", timeout=30000)
    pg.click('#build'); pg.wait_for_function("document.querySelector('#hud-name').textContent.includes('Idol') && !massless.state.busy", timeout=300000)
    res['idol'] = pg.evaluate("({ splats: document.querySelector('#hud-count').textContent, src: document.querySelector('#src-label').textContent, mode: massless.state.mode, flip: !document.querySelector('#p-flip').hidden })")
    pg.wait_for_timeout(1500)
    pg.evaluate('massless.state.recording = true'); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{OUT}/3d-idol.png', timeout=120000)
    b.close()
print(json.dumps(res, indent=1)); print('errors:', errors)
sys.exit(1 if errors or 'idol' not in res else 0)
