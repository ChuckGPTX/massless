"""Edit page image tools in headless Chromium: remove background, upscale and erase, with real models.

    python3 tests/edit_tools_test.py            # MODNet, Real-ESRGAN, MI-GAN and texture copy
    python3 tests/edit_tools_test.py heavy      # also BiRefNet lite (192 MB download, ~3 GB of memory)
    python3 tests/edit_tools_test.py live       # fetch from the real CDNs instead of the local mirror

By default the runtime and model downloads (jsDelivr, Hugging Face) are answered by a local HTTPS mirror
that serves a cache keyed by SHA-256 (MASSLESS_MODEL_CACHE, default ~/.cache/massless-models); missing files
are fetched once with urllib and checked. The page still verifies every file itself and stores it in the Cache API, which this test checks
by counting the page's requests across a reload. Headless Chromium has no WebGPU here, so models run on
WebAssembly, one thread: the slowest path a visitor can get.
Screenshots: tests/out/edit-tools/*.png
"""
import functools, hashlib, http.server, json, os, re, socketserver, sys, threading, time, urllib.request
from io import BytesIO
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'public')
OUT = os.path.join(HERE, 'out', 'edit-tools')
CACHE = os.environ.get('MASSLESS_MODEL_CACHE', os.path.expanduser('~/.cache/massless-models'))
HEAVY = 'heavy' in sys.argv[1:]
LIVE = 'live' in sys.argv[1:]  # download from the real jsDelivr and Hugging Face instead of the local mirror
os.makedirs(OUT, exist_ok=True)
os.makedirs(CACHE, exist_ok=True)

# url -> sha256, from the page's own manifest
src = open(os.path.join(ROOT, 'js', 'image-models.js')).read()
ORT = re.search(r"const ORT = '([^']+)'", src).group(1)
PINNED = {}
for m in re.finditer(r"url: (?:`\$\{ORT\}([^`]+)`|HF\('([^']+)', '([0-9a-f]{40})', '([^']+)'\)|'(/models/[^']+)'), sha256: '([0-9a-f]{64})', size: (\d+)", src):
    if m.group(1): url = ORT + m.group(1)
    elif m.group(2): url = f'https://huggingface.co/{m.group(2)}/resolve/{m.group(3)}/{m.group(4)}'
    else: continue  # served by this site
    PINNED[url] = (m.group(6), int(m.group(7)))
assert len(PINNED) == 6, PINNED


def cached(url):
    sha, size = PINNED[url]
    path = os.path.join(CACHE, sha)
    if not os.path.exists(path):
        print('downloading', url, file=sys.stderr)
        data = urllib.request.urlopen(url, timeout=600).read()
        assert hashlib.sha256(data).hexdigest() == sha, url
        open(path, 'wb').write(data)
    return path


class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.js': 'text/javascript', '.onnx': 'application/octet-stream'}

    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/edit', '/library'): p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)

    def log_message(self, *a): pass


class Mirror(http.server.BaseHTTPRequestHandler):
    """Stands in for jsDelivr and Hugging Face over HTTPS (Chromium maps both hosts here), streaming files from
    the cache. route.fulfill would push a 192 MB body through the DevTools protocol, which crashes the page."""
    protocol_version = 'HTTP/1.1'

    def do_GET(self):
        url = f"https://{self.headers['host'].split(':')[0]}{self.path}"
        if url not in PINNED:
            self.send_response(404); self.send_header('content-length', '0'); self.end_headers(); return
        path = cached(url)
        self.send_response(200)
        self.send_header('access-control-allow-origin', '*')
        self.send_header('content-type', 'application/octet-stream')
        self.send_header('content-length', str(os.path.getsize(path)))
        self.end_headers()
        with open(path, 'rb') as f:
            while chunk := f.read(1 << 20):
                self.wfile.write(chunk)

    def log_message(self, *a): pass


def mirror_server():
    import ssl, subprocess, tempfile
    d = tempfile.mkdtemp()
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=mirror',
                    '-keyout', f'{d}/k.pem', '-out', f'{d}/c.pem'], check=True, capture_output=True)
    sctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    sctx.load_cert_chain(f'{d}/c.pem', f'{d}/k.pem')
    m = socketserver.ThreadingTCPServer(('127.0.0.1', 0), Mirror)
    m.daemon_threads = True
    m.socket = sctx.wrap_socket(m.socket, server_side=True)
    threading.Thread(target=m.serve_forever, daemon=True).start()
    return m


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{port}'


def png_bytes(w, h, seed=0):
    """A small product-style photo: the site's ceramics image, cropped and scaled."""
    im = Image.open(os.path.join(ROOT, 'media', 'website', 'ceramics.jpg')).convert('RGB')
    W, H = im.size
    im = im.crop((W // 2 - H // 2, 0, W // 2 + H // 2, H)).resize((w, h), Image.LANCZOS)
    b = BytesIO(); im.save(b, 'PNG'); return b.getvalue()


def write(name, data):
    p = os.path.join(OUT, name); open(p, 'wb').write(data); return p


res, errors, checks, net = {}, [], [], {}


def check(name, ok, detail=''):
    checks.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail and not ok else ''), flush=True)


small = write('input-256.png', png_bytes(256, 256))
_person = Image.open(os.path.join(ROOT, 'media', 'art', 'samurai.jpg')).convert('RGB')
_person = _person.resize((round(_person.width * 512 / _person.height), 512), Image.LANCZOS)
PERSON_SIZE = list(_person.size)
_b = BytesIO(); _person.save(_b, 'PNG'); person = write('input-person.png', _b.getvalue())
big = write('input-1100.png', png_bytes(1100, 800))

with sync_playwright() as p:
    if LIVE:
        mirror = None
        b = p.chromium.launch()
    else:
        mirror = mirror_server()
        mport = mirror.server_address[1]
        b = p.chromium.launch(args=[
            '--no-proxy-server',
            f'--host-resolver-rules=MAP cdn.jsdelivr.net:443 127.0.0.1:{mport},MAP huggingface.co:443 127.0.0.1:{mport}',
            '--ignore-certificate-errors',
        ])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)

    def count(r):
        if r.url in PINNED:
            net[r.url] = net.get(r.url, 0) + 1
    ctx.on('request', count)

    def page(path):
        pg = ctx.new_page(); pg.set_default_timeout(0)
        pg.on('pageerror', lambda e: errors.append(f'{path}: {e}'))
        pg.on('console', lambda m: m.type == 'error' and errors.append(f'{path} console: {m.text}'))
        pg.goto(BASE + path, wait_until='domcontentloaded')
        pg.wait_for_function("window.massless && window.massless.edit.base", timeout=30000)
        return pg

    def open_image(pg, path):
        pg.set_input_files('#image-file', path)
        pg.wait_for_function("document.querySelector('#status').textContent.startsWith('Ready')", timeout=30000)

    def run(pg, button, done, timeout=900000):
        t = time.time()
        pg.click(button)
        pg.wait_for_function(f"!window.massless.edit.busy && /{done}|error|failed|memory|not/i.test(document.querySelector('#status').textContent)", timeout=timeout)
        return round(time.time() - t, 1), pg.inner_text('#status')

    alpha_stats = """() => { const c = document.querySelector('#art'); const r = window.massless.edit.result;
        const d = r.getContext('2d').getImageData(0, 0, r.width, r.height).data; let clear = 0, solid = 0;
        for (let i = 3; i < d.length; i += 4) { if (d[i] < 10) clear++; else if (d[i] > 245) solid++; }
        return { w: r.width, h: r.height, clear: clear / (d.length / 4), solid: solid / (d.length / 4) }; }"""

    # ---------------- Remove background ----------------
    pg = page('/edit/?tool=remove-bg')
    check('deep_link_selects_tab', pg.get_attribute('#tab-remove-bg', 'aria-selected') == 'true' and pg.is_visible('#bg-run'))
    open_image(pg, person)
    pg.wait_for_function("document.querySelector('[data-note=\"remove-bg\"]').textContent.includes('MB')")
    note = pg.inner_text('[data-note="remove-bg"]')
    check('note_states_size_and_local', 'nothing is uploaded' in note and 'MB' in note, note)
    pg.select_option('#bg-model', 'modnet')
    pg.wait_for_function("document.querySelector('[data-note=\"remove-bg\"]').textContent.includes('MODNet')")
    res['modnet_note'] = pg.inner_text('[data-note="remove-bg"]')
    s, status = run(pg, '#bg-run', 'Background removed')
    res['modnet_first'] = {'s': s, 'status': status}
    check('modnet_runs', 'Background removed' in status, status)
    st = pg.evaluate(alpha_stats)
    res['modnet_alpha'] = st
    check('cutout_is_transparent_png', st['clear'] > 0.3 and st['solid'] > 0.05 and [st['w'], st['h']] == PERSON_SIZE, st)
    check('compare_and_actions_shown', pg.is_visible('#compare-row') and pg.is_visible('#tool-save'))
    pg.select_option('#bg-fill', 'color')
    pg.wait_for_selector('#bg-color', state='visible')
    pg.wait_for_timeout(200)
    st2 = pg.evaluate(alpha_stats)
    check('replace_with_color_is_opaque', st2['solid'] > 0.99, st2)
    pg.select_option('#bg-fill', 'botanical'); pg.wait_for_timeout(150)
    pg.select_option('#bg-fill', 'blur'); pg.wait_for_timeout(150)
    pg.select_option('#bg-fill', 'transparent'); pg.wait_for_timeout(150)
    pg.fill('#bg-feather', '0'); pg.dispatch_event('#bg-feather', 'input'); pg.wait_for_timeout(200)
    hard = pg.evaluate(alpha_stats)
    pg.fill('#bg-feather', '10'); pg.dispatch_event('#bg-feather', 'input'); pg.wait_for_timeout(200)
    soft = pg.evaluate(alpha_stats)
    check('edge_softness_changes_matte', soft['clear'] + soft['solid'] < hard['clear'] + hard['solid'], (hard, soft))
    pg.fill('#bg-feather', '1'); pg.dispatch_event('#bg-feather', 'input'); pg.wait_for_timeout(200)
    pg.fill('#compare', '0'); pg.dispatch_event('#compare', 'input')
    pg.screenshot(path=os.path.join(OUT, 'remove-bg-1440.png'))
    # library save and download
    pg.click('#tool-save'); pg.wait_for_function("document.querySelector('#status').textContent.startsWith('Saved')")
    saved = pg.evaluate("import('/js/store.js').then(s => s.all()).then(a => a.map(i => ({ id: i.id, engine: i.engine, type: i.blob.type, size: i.blob.size, tool: i.settings && i.settings.tool })))")
    rb = [i for i in saved if i['tool'] == 'remove-bg']
    check('saved_to_library', len(rb) == 1 and rb[0]['type'] == 'image/png' and 'MODNet' in rb[0]['engine'], saved)
    check('next_links_after_save', pg.locator('#next a').count() == 3)
    with pg.expect_download() as d:
        pg.click('#tool-download')
    dl = d.value
    path = dl.path()
    check('download_png', dl.suggested_filename == 'chucksi-remove-bg.png' and os.path.getsize(path) > 1000 and open(path, 'rb').read(4) == b'\x89PNG', dl.suggested_filename)
    # second use: everything comes from this browser's Cache API
    model_url = [u for u in PINNED if 'modnet' in u][0]
    before = dict(net)
    pg.reload(wait_until='domcontentloaded'); pg.wait_for_function("window.massless && window.massless.edit.base")
    pg.select_option('#bg-model', 'modnet')
    pg.wait_for_function("document.querySelector('[data-note=\"remove-bg\"]').textContent.includes('saved on this device')")
    s, status = run(pg, '#bg-run', 'Background removed')
    res['modnet_cached'] = {'s': s}
    check('second_visit_uses_cache', net.get(model_url) == 1 and net == before, {k: v for k, v in net.items()})
    if HEAVY:
        open_image(pg, small)
        pg.select_option('#bg-model', 'birefnet')
        s, status = run(pg, '#bg-run', 'Background removed')
        res['birefnet_first'] = {'s': s, 'status': status}
        check('birefnet_runs', 'Background removed' in status, status)
        st = pg.evaluate(alpha_stats)
        res['birefnet_alpha'] = st
        check('birefnet_cutout', st['clear'] > 0.05 and st['solid'] > 0.05, st)
        pg.fill('#compare', '0'); pg.dispatch_event('#compare', 'input')
        pg.screenshot(path=os.path.join(OUT, 'remove-bg-birefnet-1440.png'))
    library_id = rb[0]['id'] if rb else None
    pg.close()

    # ---------------- Upscale ----------------
    pg = page('/edit/?tool=upscale')
    open_image(pg, big)
    pg.wait_for_function("document.querySelector('#up-run').disabled")
    check('upscale_cap_message', '1024 px' in pg.inner_text('#up-size') and pg.is_disabled('#up-run'), pg.inner_text('#up-size'))
    open_image(pg, small)
    check('upscale_size_hint', pg.inner_text('#up-size') == '256 × 256 → 512 × 512 px', pg.inner_text('#up-size'))
    s, status = run(pg, '#up-run', 'Upscaled')
    res['upscale_2x'] = {'s': s, 'status': status}
    dims = pg.evaluate("[window.massless.edit.result.width, window.massless.edit.result.height]")
    check('upscale_2x', dims == [512, 512] and 'Upscaled 2×' in status, (dims, status))
    pg.check('[name="up-factor"][value="4"]')
    s, status = run(pg, '#up-run', 'Upscaled')
    res['upscale_4x'] = {'s': s, 'status': status}
    dims = pg.evaluate("[window.massless.edit.result.width, window.massless.edit.result.height]")
    check('upscale_4x', dims == [1024, 1024], dims)
    pg.screenshot(path=os.path.join(OUT, 'upscale-1440.png'))
    with pg.expect_download() as d:
        pg.click('#tool-download')
    check('upscale_download', d.value.suggested_filename == 'chucksi-upscale.png')
    pg.close()

    # ---------------- Erase ----------------
    pg = page('/edit/?tool=erase')
    open_image(pg, small)
    pg.click('#er-run'); pg.wait_for_timeout(200)
    check('erase_asks_for_strokes', 'Paint over' in pg.inner_text('#status'), pg.inner_text('#status'))
    box = pg.locator('#art').bounding_box()

    def paint():
        # a stroke across the middle vase, in screen space (the page maps it into the image)
        x0, y0 = box['x'] + box['width'] * 0.40, box['y'] + box['height'] * 0.45
        pg.mouse.move(x0, y0); pg.mouse.down()
        for k in range(1, 11):
            pg.mouse.move(x0 + box['width'] * 0.02 * k, y0 + box['height'] * 0.015 * k)
        pg.mouse.up()
    pg.fill('#er-brush', '30'); pg.dispatch_event('#er-brush', 'input')
    paint()
    painted = pg.evaluate("(() => { const s = window.massless.edit.strokes; const d = s.getContext('2d').getImageData(0, 0, s.width, s.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 24) n++; return n; })()")
    check('brush_paints_mask', painted > 200, painted)
    pg.screenshot(path=os.path.join(OUT, 'erase-strokes-1440.png'))
    pg.select_option('#er-method', 'patch')
    s, status = run(pg, '#er-run', 'Erased')
    res['erase_patch'] = {'s': s, 'status': status}
    diff = """() => { const e = window.massless.edit; const a = e.base.getContext('2d').getImageData(0, 0, 256, 256).data;
        const b = e.result.getContext('2d').getImageData(0, 0, 256, 256).data; let changed = 0;
        for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed++;
        return changed; }"""
    changed = pg.evaluate(diff)
    check('texture_copy_fills_only_the_hole', painted * 0.8 < changed < painted * 3, (painted, changed))
    check('undo_enabled', not pg.is_disabled('#er-undo'))
    pg.click('#er-undo')
    check('undo_restores', pg.evaluate("window.massless.edit.result") is None)
    paint()
    pg.select_option('#er-method', 'migan')
    pg.wait_for_function("document.querySelector('[data-note=\"erase\"]').textContent.includes('MI-GAN')")
    s, status = run(pg, '#er-run', 'Erased')
    res['erase_migan'] = {'s': s, 'status': status}
    changed = pg.evaluate(diff)
    check('migan_fills_only_the_hole', 'Erased' in status and painted * 0.8 < changed < painted * 3, (status, painted, changed))
    pg.fill('#compare', '0'); pg.dispatch_event('#compare', 'input')
    pg.screenshot(path=os.path.join(OUT, 'erase-1440.png'))
    # results chain: switch tools and the erased image becomes the new start
    pg.click('#tab-compose')
    pg.wait_for_function("window.massless.edit.tool === 'compose' && !window.massless.edit.result")
    check('result_carries_to_compose', pg.evaluate("location.search") == '')
    pg.close()

    # ---------------- Library pick ----------------
    if library_id:
        pg = page(f'/edit/?tool=upscale&shot={library_id}')
        pg.wait_for_function("document.querySelector('#status').textContent.startsWith('Ready')")
        check('opens_library_image', pg.evaluate("[window.massless.edit.base.width, window.massless.edit.base.height, window.massless.edit.tool]") == PERSON_SIZE + ['upscale'])
        pg.close()

    # ---------------- 390 px ----------------
    m = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    m.on('request', count)
    for t in ['compose', 'remove-bg', 'upscale', 'erase']:
        pg = m.new_page(); pg.set_default_timeout(0)
        pg.on('pageerror', lambda e: errors.append(f'390 {t}: {e}'))
        pg.goto(f'{BASE}/edit/?tool={t}', wait_until='domcontentloaded')
        pg.wait_for_function("window.massless && window.massless.edit.base", timeout=30000)
        pg.wait_for_timeout(400)
        sw = pg.evaluate("document.documentElement.scrollWidth")
        check(f'no_sideways_scroll_390_{t}', sw <= 390, sw)
        if t == 'remove-bg':
            pg.select_option('#bg-model', 'modnet')
            pg.set_input_files('#image-file', person)
            pg.wait_for_function("document.querySelector('#status').textContent.startsWith('Ready')")
            pg.click('#bg-run')
            pg.wait_for_function("!window.massless.edit.busy && window.massless.edit.result", timeout=600000)
            sw = pg.evaluate("document.documentElement.scrollWidth")
            check('no_sideways_scroll_390_with_result', sw <= 390, sw)
        pg.screenshot(path=os.path.join(OUT, f'{t}-390.png'))
        pg.close()
    m.close()
    b.close()

srv.shutdown()
if mirror: mirror.shutdown()
ok = all(c[1] for c in checks)
print(json.dumps(res, indent=1))
print('network:', json.dumps(net, indent=1))
print('errors:', errors)
print(f"{sum(c[1] for c in checks)}/{len(checks)} checks passed")
sys.exit(0 if ok and not errors else 1)
