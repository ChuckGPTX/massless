"""Feature walkthrough with screenshots: pickers, move categories, storyboard, film export, phone layout."""
import http.server, threading, socketserver, functools, os, sys, json, time
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public')
OUT = os.path.join(os.path.dirname(__file__), 'out')
os.makedirs(OUT, exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()

errors = []
checks = {}
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = b.new_page(viewport={'width': 1440, 'height': 960})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errors.append(m.text[:200]))
    pg.goto(f'http://127.0.0.1:{port}/', wait_until='networkidle')
    pg.wait_for_function('window.massless && window.massless.renderer.hasImage', timeout=30000)
    pg.evaluate("localStorage.removeItem('massless.board')")
    pg.evaluate("window.massless.state.outSize = 640")
    # freeze the live loop so screenshots are quick on software GL
    freeze = "window.massless.state.recording = true; window.massless.drawFrame(0.5, 0)"
    pg.evaluate(freeze)
    pg.screenshot(path=f'{OUT}/f1-studio.png')

    # camera picker
    pg.click('[data-pop="camera"]')
    pg.wait_for_selector('#pop:not([hidden])')
    pg.screenshot(path=f'{OUT}/f2-camera-picker.png')
    pg.click('#pop .opt[data-key="16mm"]')
    checks['camera_chip'] = pg.inner_text('#chip-camera')
    checks['prompt_has_16mm'] = '16mm film' in pg.input_value('#compiled-text')
    pg.click('[data-pop="lens"]'); pg.click('#pop .opt[data-key="vintage"]')
    checks['lens_chip'] = pg.inner_text('#chip-lens')

    # genre + palette
    pg.click('#g-genre .opt[data-key="noir"]')
    pg.click('#g-palette .opt[data-key="steel"]')
    pr = pg.input_value('#compiled-text')
    checks['genre_in_prompt'] = 'film noir' in pr
    checks['palette_in_prompt'] = 'steel blue' in pr

    # move categories
    pg.click('#move-groups button[data-group="orbit"]')
    checks['orbit_visible'] = pg.evaluate("[...document.querySelectorAll('.move')].filter(x=>!x.hidden).map(x=>x.dataset.key)")
    pg.click('#move-groups button[data-group="all"]')
    checks['moves_total'] = pg.evaluate("document.querySelectorAll('.move').length")

    # storyboard: three shots with different moves
    for mid, dur in [('dolly-zoom', 2), ('arc-right', 2), ('crash-zoom', 2)]:
        pg.evaluate(f"window.massless.selectMove('{mid}'); window.massless.state.recording = true;")
        pg.evaluate(f"document.querySelector('#duration').value={dur}; document.querySelector('#duration').dispatchEvent(new Event('input'))")
        pg.click('#board-add')
        pg.wait_for_function(f"document.querySelectorAll('#board-list li').length >= 1")
    pg.wait_for_function("document.querySelectorAll('#board-list li').length === 3")
    checks['board_total'] = pg.inner_text('#board-total')
    pg.evaluate(freeze)
    pg.locator('.board').scroll_into_view_if_needed()
    pg.screenshot(path=f'{OUT}/f3-storyboard.png', full_page=True)

    # reorder and remove
    pg.click('#board-list li:nth-child(2) .ctrl button:nth-child(1)')
    checks['after_reorder'] = pg.evaluate("[...document.querySelectorAll('#board-list li .meta span')].map(x=>x.textContent)")

    # export film (stubs the download so nothing is written)
    pg.evaluate("window.__dl = []; HTMLAnchorElement.prototype.click = function(){ window.__dl.push(this.download) }")
    t = time.time()
    pg.click('#board-export')
    pg.wait_for_function("!window.massless.state.boardBusy && document.querySelector('#board-export').textContent.includes('Export film') && window.__dl.length > 0", timeout=300000)
    checks['export_secs'] = round(time.time() - t, 1)
    checks['download'] = pg.evaluate("window.__dl")
    checks['film_reel_item'] = pg.evaluate("[...document.querySelectorAll('#reel-list .meta span')].map(x=>x.textContent)[0]")
    checks['film_duration'] = pg.evaluate("""(async () => { const v = document.querySelector('#reel-list video'); if (!v) return null; if (!v.duration || isNaN(v.duration)) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true })); return Math.round(v.duration * 10) / 10; })()""")
    pg.evaluate(freeze)
    pg.close()

    # phone
    m = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    m.on('pageerror', lambda e: errors.append('mobile: ' + str(e)))
    m.goto(f'http://127.0.0.1:{port}/', wait_until='networkidle')
    m.wait_for_function('window.massless && window.massless.renderer.hasImage', timeout=60000)
    m.evaluate(freeze)
    m.screenshot(path=f'{OUT}/f4-phone.png')
    m.click('#tab-move')
    m.evaluate(freeze)
    m.screenshot(path=f'{OUT}/f5-phone-moves.png', full_page=True)
    b.close()

print(json.dumps(checks, indent=1))
print('errors:', errors)
ok = (checks.get('moves_total') == 28 and checks.get('genre_in_prompt') and checks.get('palette_in_prompt') and checks.get('download') and not errors)
sys.exit(0 if ok else 1)
