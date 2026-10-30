"""Functional smoke test for the multi-page site: python3 tests/pages_test.py [video] [audio] [voice]"""
import http.server, threading, socketserver, os, sys, functools, json, time
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/image', '/video', '/audio'): p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
want = set(sys.argv[1:]) or {'video', 'audio'}
res = {}; errors = []
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True)
    def page(path):
        pg = ctx.new_page(); pg.set_default_timeout(0)
        pg.on('pageerror', lambda e: errors.append(f'{path}: {e}'))
        pg.goto(f'http://127.0.0.1:{port}{path}', wait_until='domcontentloaded')
        return pg
    if 'audio' in want:
        pg = page('/audio')
        pg.click('#t-bed'); pg.click('.bed[data-id="ocean"]'); pg.fill('#length', '5'); pg.dispatch_event('#length', 'input')
        t = time.time(); pg.click('#gen-bed'); pg.wait_for_selector('.hrow', timeout=60000)
        res['bed'] = {'s': round(time.time() - t, 1), 'rows': pg.locator('.hrow').count(), 'sub': pg.inner_text('.hrow .t span')}
        if 'voice' in want:
            pg.click('#t-voice'); t = time.time(); pg.click('#gen-voice')
            pg.wait_for_function("document.querySelectorAll('.hrow').length >= 2", timeout=600000)
            res['voice'] = {'s': round(time.time() - t, 1), 'sub': pg.inner_text('.hrow .t span'), 'src': pg.inner_text('#src-label')}
        pg.close()
    if 'video' in want:
        pg = page('/video?sample=rider&move=crash-zoom')
        pg.wait_for_function("window.massless && window.massless.state.current && window.massless.state.current.depth", timeout=180000)
        res['loaded'] = pg.evaluate("({move: massless.state.move, ref: massless.state.current.ref, src: document.querySelector('#src-label').textContent, cards: document.querySelectorAll('.mcard').length})")
        pg.evaluate("massless.state.duration = 1; massless.state.fps = 12")
        t = time.time()
        with pg.expect_download(timeout=600000) as d: pg.click('#record')
        res['record'] = {'s': round(time.time() - t, 1), 'file': d.value.suggested_filename, 'clips': pg.locator('.clip').count()}
        pg.click('#board-add'); pg.wait_for_function("document.querySelectorAll('.bcard').length === 1")
        pg.evaluate("massless.selectMove('arc-left'); massless.state.duration = 1")
        pg.click('#board-add'); pg.wait_for_function("document.querySelectorAll('.bcard').length === 2")
        for c in pg.evaluate("massless.state.board.map(c => c.uid)"): pass
        pg.evaluate("massless.state.board.forEach(c => c.duration = 1)")
        pg.click('#t-board'); t = time.time()
        with pg.expect_download(timeout=600000) as d: pg.click('#board-export')
        res['export'] = {'s': round(time.time() - t, 1), 'file': d.value.suggested_filename, 'board': pg.inner_text('#board-total')}
        pg.reload(wait_until='domcontentloaded'); pg.wait_for_timeout(4000)
        res['restored'] = pg.evaluate("document.querySelectorAll('.bcard').length")
        pg.close()
    b.close()
print(json.dumps(res, indent=1)); print('errors:', errors)
