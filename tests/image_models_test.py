"""Image page model picker in headless Chromium, with /api/shot and Pollinations mocked.

python3 tests/image_models_test.py [out_dir]   (screenshots go to tests/out/image-models by default)

For each free Cloudflare model: pick it in the model popover, pick a frame, shoot 2 takes and check the
request bodies (model, width/height for the frame, negative prompt for SDXL-family models, distinct
seeds) and the two result cards (model tag, seeds, cropped aspect). Then a 429 and a 502 from the
Worker, a 402 from Pollinations, that the choice survives a reload, and screenshots with the popover open.
"""
import functools, http.server, io, json, os, socketserver, sys, threading
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'public')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out', 'image-models')
os.makedirs(OUT, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/image', '/video', '/audio', '/3d', '/film', '/office'): p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)
    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{port}'

# model -> (chip/tag label, Workers AI id, response format, frame to test with, expected request size)
MODELS = {
    'flux-1-schnell': ('FLUX.1 schnell', '@cf/black-forest-labs/flux-1-schnell', 'JPEG', '169', (1024, 576)),
    'sdxl-lightning': ('SDXL-Lightning', '@cf/bytedance/stable-diffusion-xl-lightning', 'JPEG', '239', (1216, 512)),
    'dreamshaper-8-lcm': ('DreamShaper 8', '@cf/lykon/dreamshaper-8-lcm', 'PNG', '916', (448, 768)),  # SD 1.5 model: 768 long side
    'sdxl-base': ('SDXL 1.0', '@cf/stabilityai/stable-diffusion-xl-base-1.0', 'PNG', '11', (1024, 1024)),
}
FRAME = {'169': 1280 / 720, '239': 1344 / 560, '916': 720 / 1280, '11': 1.0}
CAP_MSG = "You've used your 12 free Cloudflare frames for today. Pollinations or your own ComfyUI still work."
FAIL_MSG = 'Workers AI could not render this frame: 3010: model is warming up'
POLL_MSG = 'Free limit reached: 1 image every 45 seconds per IP. Retry after 25s, or get unlimited images with a pollen key at https://enter.pollinations.ai/?ref=classic'

mock = {'mode': 'ok', 'shots': [], 'poll': []}
errors, failures = [], []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond: failures.append(msg)


def frame_bytes(w, h, seed, fmt, label):
    img = Image.new('RGB', (w, h), ((seed * 37) % 200 + 30, (seed * 91) % 200 + 30, (seed * 53) % 200 + 30))
    d = ImageDraw.Draw(img)
    for i in range(0, max(w, h), 64): d.line([(i, 0), (0, i)], fill=(255, 255, 255), width=2)
    d.rectangle([w // 2 - 40, h // 2 - 40, w // 2 + 40, h // 2 + 40], outline=(255, 191, 47), width=6)
    d.text((16, 16), f'{label} {w}x{h} seed {seed}', fill=(255, 255, 255))
    buf = io.BytesIO(); img.save(buf, fmt); return buf.getvalue()


def on_shot(route, request):
    body = request.post_data_json
    mock['shots'].append(body)
    if mock['mode'] == '429':
        return route.fulfill(status=429, content_type='application/json', body=json.dumps({'error': CAP_MSG}))
    if mock['mode'] == '502':
        return route.fulfill(status=502, content_type='application/json', body=json.dumps({'error': FAIL_MSG}))
    m = MODELS.get(body.get('model'), MODELS['flux-1-schnell'])
    w, h = (1024, 1024) if body.get('model') == 'flux-1-schnell' else (body['width'], body['height'])  # FLUX ignores the size
    fmt = m[2]
    route.fulfill(status=200, headers={'content-type': f'image/{fmt.lower()}', 'x-massless-model': m[1], 'cache-control': 'no-store'},
                  body=frame_bytes(w, h, int(body.get('seed') or 0), fmt, m[0]))


def on_pollinations(route, request):
    mock['poll'].append(request.url)
    route.fulfill(status=402, headers={'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'retry-after': '25',
                                       'access-control-expose-headers': 'Retry-After'},
                  body=json.dumps({'status': 402, 'success': False, 'error': {'code': 'FREE_LIMIT', 'message': POLL_MSG}}))


def open_page(ctx, path='/image'):
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    # failed /api/shot responses (429/502) are logged by Chromium as resource errors; those are expected
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(f'console: {m.text[:200]}'))
    pg.route('**/api/shot', on_shot)
    pg.route('https://image.pollinations.ai/**', on_pollinations)
    pg.goto(BASE + path, wait_until='domcontentloaded')
    pg.wait_for_function("window.massless && window.massless.state.rig && document.querySelector('#compiled').value.length > 20")
    return pg


def pick(pg, pop, key):
    pg.click(f'.chip[data-pop="{pop}"]')
    pg.wait_for_selector('#pop:not([hidden])')
    pg.click(f'#pop .opt[data-key="{key}"]')
    pg.wait_for_selector('#pop', state='hidden')


def set_takes(pg, n):
    while int(pg.inner_text('#takes-n')) < n: pg.click('#takes-plus')
    while int(pg.inner_text('#takes-n')) > n: pg.click('#takes-minus')


def shoot_and_wait(pg):
    pg.click('#shoot')
    pg.wait_for_function("!window.massless.state.busy && !document.querySelector('.shot.pending')", timeout=60000)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    pg = open_page(ctx)

    print('popover')
    pg.click('.chip[data-pop="model"]')
    pg.wait_for_selector('#pop:not([hidden])')
    heads = pg.eval_on_selector_all('#pop h4', 'n => n.map(x => x.textContent)')
    check(heads == ['Free on Cloudflare', 'Community', 'Your GPU'], f'groups {heads}')
    opts = pg.eval_on_selector_all('#pop .opt', 'n => n.map(x => [x.dataset.key, x.querySelector("strong").textContent, x.querySelector("small.lic").textContent])')
    check([o[0] for o in opts] == ['flux-1-schnell', 'sdxl-lightning', 'dreamshaper-8-lcm', 'sdxl-base', 'sana', 'comfy'], f'options {[o[0] for o in opts]}')
    lic = {o[0]: o[2] for o in opts}
    check(lic['flux-1-schnell'] == 'Apache-2.0' and lic['sdxl-lightning'] == 'OpenRAIL++' and lic['dreamshaper-8-lcm'] == 'CreativeML OpenRAIL-M'
          and lic['sdxl-base'] == 'OpenRAIL++' and 'NVIDIA' in lic['sana'] and lic['comfy'] == 'Your choice', f'licences {lic}')
    sana = [o for o in opts if o[0] == 'sana'][0]
    check('Sana' in sana[1] and 'FLUX' not in pg.inner_text('#pop .opt[data-key="sana"]'), f'Pollinations labelled honestly: {sana[1]!r}')
    check(pg.get_attribute('#pop .opt[aria-checked="true"]', 'data-key') == 'flux-1-schnell', 'FLUX.1 schnell on Cloudflare is the default')
    pg.keyboard.press('Escape')
    pg.wait_for_selector('#pop', state='hidden')

    pg.click('#prompt-peek summary')  # open "Prompt sent to the model" so the negative prompt line can be read
    set_takes(pg, 2)
    unit = pg.evaluate("getComputedStyle(document.querySelector('#takes-n'), '::after').content")
    check(unit == '" takes"', f'stepper unit {unit}')
    for model, (label, cf, fmt, aspect, size) in MODELS.items():
        print(model)
        pick(pg, 'model', model)
        pick(pg, 'aspect', aspect)
        check(pg.inner_text('#chip-model') == label, f'chip shows {pg.inner_text("#chip-model")!r}')
        neg_shown = pg.is_visible('#neg-line')
        check(neg_shown == (model != 'flux-1-schnell'), f'negative prompt line visible={neg_shown}')
        before = pg.locator('.shot:not(.pending)').count()
        mock['shots'].clear()
        shoot_and_wait(pg)
        reqs = list(mock['shots'])
        compiled = pg.input_value('#compiled').strip()
        check(len(reqs) == 2, f'{len(reqs)} requests')
        check(all(r['model'] == model for r in reqs), f'request model {[r["model"] for r in reqs]}')
        check(all((r['width'], r['height']) == size for r in reqs), f'request size {[(r["width"], r["height"]) for r in reqs]} want {size}')
        check(all(r['prompt'] == compiled for r in reqs), 'request prompt matches the visible prompt')
        seeds = [r['seed'] for r in reqs]
        check(len(set(seeds)) == 2 and all(isinstance(s, int) and s >= 0 for s in seeds), f'distinct seeds {seeds}')
        if model == 'flux-1-schnell':
            check(all('negative' not in r for r in reqs), 'no negative prompt for FLUX')
        else:
            negs = [r.get('negative', '') for r in reqs]
            check(all('blurry' in n and 'watermark' in n for n in negs), f'negative prompt {negs[0]!r}')
            check(pg.inner_text('#neg') == negs[0], 'visible negative prompt matches the request')
        check(pg.locator('.shot:not(.pending)').count() == before + 2, 'two new result cards')
        cards = pg.eval_on_selector_all('.shot:not(.pending)', 'n => n.slice(0, 2).map(x => ({tag: x.querySelector(".tag").textContent, model: x.dataset.model, seed: Number(x.dataset.seed), w: x.querySelector("img").naturalWidth, h: x.querySelector("img").naturalHeight}))')
        check(all(c['tag'] == label and c['model'] == model for c in cards), f'card tags {[c["tag"] for c in cards]}')
        check(sorted(c['seed'] for c in cards) == sorted(seeds), f'card seeds {[c["seed"] for c in cards]}')
        ratios = [c['w'] / c['h'] for c in cards if c['h']]
        check(len(ratios) == 2 and all(abs(r / FRAME[aspect] - 1) < 0.02 for r in ratios), f'cropped to {aspect}: {[round(r, 3) for r in ratios]}')

    print('429 from the Worker')
    mock['mode'] = '429'
    before = pg.locator('.shot:not(.pending)').count()
    shoot_and_wait(pg)
    pg.wait_for_selector('#toast.error:not([hidden])')
    check(pg.inner_text('#toast') == CAP_MSG, f'toast {pg.inner_text("#toast")!r}')
    check(pg.locator('.shot:not(.pending)').count() == before, 'no card added, pending cards removed')
    ready = pg.evaluate("[document.querySelector('#shoot-label').textContent, document.querySelector('#shoot').disabled]")
    check(ready == ['Generate', False], f'Generate is ready again {ready}')

    print('502 from the Worker')
    mock['mode'] = '502'
    shoot_and_wait(pg)
    pg.wait_for_selector('#toast.error:not([hidden])')
    check(pg.inner_text('#toast') == FAIL_MSG, f'toast {pg.inner_text("#toast")!r}')
    mock['mode'] = 'ok'

    print('Pollinations 402')
    set_takes(pg, 1)
    pick(pg, 'model', 'sana')
    check(pg.inner_text('#chip-model') == 'Sana', f'chip shows {pg.inner_text("#chip-model")!r}')
    check(not pg.is_visible('#neg-line'), 'no negative prompt line for Sana')
    shoot_and_wait(pg)
    pg.wait_for_selector('#toast.error:not([hidden])')
    toast = pg.inner_text('#toast')
    check(toast.startswith('Pollinations: Free limit reached') and 'Retry after 25s' in toast, f'toast {toast[:90]!r}')
    check(len(mock['poll']) == 1 and 'model=sana' in mock['poll'][0], f'Pollinations asked for {mock["poll"][0].split("?")[-1][:80] if mock["poll"] else None}')

    print('remembered choice')
    pick(pg, 'model', 'sdxl-lightning')
    pg.reload(wait_until='domcontentloaded')
    pg.wait_for_function("window.massless && window.massless.state.rig")
    check(pg.inner_text('#chip-model') == 'SDXL-Lightning', f'after reload chip shows {pg.inner_text("#chip-model")!r}')
    tags = pg.eval_on_selector_all('.shot .tag', 'n => [...new Set(n.map(x => x.textContent))]')
    check(sorted(tags) == sorted(m[0] for m in MODELS.values()), f'restored cards keep their model tags {tags}')

    print('screenshots')
    pg.evaluate("window.scrollTo(0, 0)")
    pg.click('#prompt-peek summary')
    pg.click('.chip[data-pop="model"]'); pg.wait_for_selector('#pop:not([hidden])'); pg.wait_for_timeout(300)
    box = pg.eval_on_selector('#pop', 'n => { const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, scroll: n.scrollHeight > n.clientHeight }; }')
    nav = pg.eval_on_selector('.nav', 'n => n.getBoundingClientRect().bottom')
    check(box['top'] >= nav and not box['scroll'], f'desktop popover below the nav and unscrolled {box}')
    pg.screenshot(path=f'{OUT}/image-models-1440.png')
    pg.close(); ctx.close()

    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = open_page(ctx)
    pick(pg, 'model', 'dreamshaper-8-lcm')
    pg.click('.chip[data-pop="model"]'); pg.wait_for_selector('#pop:not([hidden])'); pg.wait_for_timeout(300)
    box = pg.eval_on_selector('#pop', 'n => { const r = n.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom }; }')
    nav = pg.eval_on_selector('.nav', 'n => n.getBoundingClientRect().bottom')
    check(box['left'] >= 0 and box['right'] <= 390 and box['top'] >= nav, f'popover inside the viewport on a phone {box}')
    check(pg.evaluate('document.documentElement.scrollWidth') <= 390, 'no horizontal page scroll on a phone')
    pg.screenshot(path=f'{OUT}/image-models-390.png')
    pg.close(); ctx.close()
    b.close()

print('screenshots:', f'{OUT}/image-models-1440.png', f'{OUT}/image-models-390.png')
print('errors:', errors)
if errors or failures:
    print(f'FAILED: {len(failures)} checks, {len(errors)} page errors'); sys.exit(1)
print('PASS')
