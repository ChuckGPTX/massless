"""Website builder (/website, the Website tab of Build) in a real browser: the page at desktop and phone width, Generate
for several kinds of site, edit a heading in place, add and duplicate sections (unique anchors), switch style, undo/redo,
Fill images through a mocked /api/shot, the share link round trip, and both exports (ZIP and one HTML file, the second
opened from file:// with the network blocked).
python3 tests/website_test.py [out_dir]   (screenshots: tests/out/website/)"""
import http.server, threading, socketserver, os, sys, functools, json, io, zipfile
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'out', 'website')
os.makedirs(OUT, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/games', '/website', '/build', '/library'): p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)

    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
BASE = f'http://127.0.0.1:{srv.server_address[1]}'
threading.Thread(target=srv.serve_forever, daemon=True).start()
SITE = f'{BASE}/website/'

checks, errors = {}, []


def check(name, ok, detail=None):
    checks[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, '' if detail is None else json.dumps(detail)[:400], flush=True)


def watch(pg, label):
    pg.on('pageerror', lambda e: errors.append(f'{label}: {e}'))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(f'{label}: {m.text[:200]}'))
    # fonts.googleapis.com may be unreachable from a test machine; anything local that is missing is a bug
    pg.on('response', lambda r: r.status >= 400 and r.url.startswith(BASE) and '/api/' not in r.url and errors.append(f'{label}: {r.status} {r.url}'))


def png(w=640, h=400):
    b = io.BytesIO()
    Image.new('RGB', (w, h), (120, 170, 110)).save(b, 'PNG')
    return b.getvalue()


def frame_text(pg):
    return pg.evaluate("document.querySelector('#preview').contentDocument.body.innerText")


with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------- 1. the page at desktop and phone width ----------
    for label, opts in [('1440', dict(viewport={'width': 1440, 'height': 900})), ('390', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))]:
        ctx = b.new_context(**opts)
        pg = ctx.new_page()
        watch(pg, label)
        pg.goto(SITE, wait_until='domcontentloaded')
        pg.wait_for_selector('body[data-ready="1"]', timeout=60000)
        pg.wait_for_timeout(800)
        info = pg.evaluate("""({ sw: document.documentElement.scrollWidth, tab: document.querySelector('.build-tabs a[aria-current=page]')?.textContent,
          nav: document.querySelector('.nav-links a[href="/website/"][aria-current=page]')?.textContent, kinds: document.querySelectorAll('#kinds button').length,
          styles: document.querySelectorAll('#styles [role=radio], #styles button').length, sections: document.querySelector('#preview').contentDocument.querySelectorAll('[data-sid]').length,
          footer: !!document.querySelector('footer.foot a[href="/privacy.html"]') && !!document.querySelector('footer.foot a[href="/terms.html"]') })""")
        pg.screenshot(path=f'{OUT}/website-{label}.png')
        pg.screenshot(path=f'{OUT}/website-{label}-full.png', full_page=True)
        w = opts['viewport']['width']
        check(f'page {label}: Website tab and nav link current, example site in the preview, footer, no sideways scroll',
              info['sw'] <= w and info['tab'] == 'Website' and info['nav'] == 'Website' and info['kinds'] >= 8 and info['sections'] >= 4 and info['footer'], info)
        ctx.close()

    # ---------- 2. generate several kinds of site ----------
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page()
    watch(pg, 'flow')
    api = []
    pg.route('**/api/site', lambda r: (api.append(r.request.url), r.fulfill(status=404, body='{}')))
    pg.goto(SITE, wait_until='domcontentloaded')
    pg.wait_for_selector('body[data-ready="1"]', timeout=60000)
    kinds = pg.evaluate("[...document.querySelectorAll('#kinds button')].map(b => [b.dataset.kind, b.textContent])")
    made = {}
    for kind, prompt, word in [('business', 'A site for my lawn care business in Cedar Rapids', 'Cedar Rapids'), ('restaurant', 'A family taco restaurant in Austin called Casa Verde', 'Casa Verde'),
                               ('band', 'The Night Owls, a jazz trio from Chicago', 'Night Owls'), ('event', 'Prairie Code, a one-day developer conference in Omaha', 'Prairie Code')]:
        if not any(k == kind for k, _ in kinds): kind = kinds[0][0]
        pg.click(f'#kinds [data-kind="{kind}"]')
        pg.fill('#prompt', prompt)
        pg.click('#generate')
        pg.wait_for_function("!window.mzSite.state.busy && !document.querySelector('#generate').disabled", timeout=60000)
        pg.wait_for_timeout(500)
        st = pg.evaluate("({ name: mzSite.state.site.name, pages: mzSite.state.site.pages.length, sections: mzSite.state.site.pages.reduce((n, p) => n + p.sections.length, 0), kind: mzSite.state.site.kind })")
        txt = frame_text(pg)
        made[kind] = {**st, 'wordInPreview': word.lower() in txt.lower()}
        pg.screenshot(path=f'{OUT}/website-generated-{kind}.png')
    check('generate: every kind gets a multi-section site from the built-in writer, prompt words in the preview, no server call',
          all(v['sections'] >= 5 and v['wordInPreview'] for v in made.values()) and not api, {'sites': made, 'apiCalls': api})

    # ---------- 3. edit in place, add and duplicate, undo/redo, style ----------
    fr = pg.frame_locator('#preview')
    h1 = fr.locator('h1[data-edit]').first
    h1.click()
    pg.wait_for_timeout(200)
    editing = pg.evaluate("!!mzSite.state.editing")
    pg.keyboard.press('Control+A')
    pg.keyboard.type('Fresh tacos, every single day')
    pg.evaluate('mzSite.commitEdit()')
    pg.wait_for_timeout(300)
    edited = 'fresh tacos, every single day' in frame_text(pg).lower() and 'Fresh tacos, every single day' in json.dumps(pg.evaluate('mzSite.state.site'))
    pg.evaluate('mzSite.undo()')
    pg.wait_for_timeout(300)
    undone = 'Fresh tacos, every single day' not in json.dumps(pg.evaluate('mzSite.state.site'))
    pg.evaluate('mzSite.redo()')
    pg.wait_for_timeout(300)
    redone = 'Fresh tacos, every single day' in json.dumps(pg.evaluate('mzSite.state.site'))
    check('edit: click a heading, type, commit; undo and redo', editing and edited and undone and redone, {'editing': editing, 'edited': edited, 'undone': undone, 'redone': redone})

    n0 = pg.evaluate('mzSite.state.site.pages[0].sections.length')
    f0 = pg.evaluate("mzSite.state.site.pages[0].sections.filter(s => s.type === 'faq').length")
    pg.evaluate("mzSite.addSection('faq')")
    pg.wait_for_timeout(300)
    sid = pg.evaluate("mzSite.state.site.pages[0].sections.find(s => s.type === 'faq').id")
    fr.locator(f'[data-sid="{sid}"]').first.hover(position={'x': 30, 'y': 30})
    pg.wait_for_timeout(300)
    # the floating section bar follows the pointer, so press its Duplicate button directly
    fr.locator(f'[data-sid="{sid}"] .mz-bar [data-act="dup"]').first.dispatch_event('click')
    pg.wait_for_timeout(400)
    secs = pg.evaluate("mzSite.state.site.pages[0].sections.map(s => [s.type, s.anchor || ''])")
    anchors = [a for _, a in secs if a]
    faqs = [a for t, a in secs if t == 'faq']
    check('sections: add an FAQ, duplicate it from its toolbar, anchors stay unique', len(secs) == n0 + 2 and len(faqs) == f0 + 2 and len(set(anchors)) == len(anchors), {'faqAnchors': faqs, 'count': [n0, len(secs)]})

    pg.click('#t-theme')
    styles = pg.evaluate("[...document.querySelectorAll('#theme-styles [data-style]')].map(b => b.dataset.style)")
    target = [s for s in styles if s != pg.evaluate('mzSite.state.site.theme.style')][0] if styles else None
    if target: pg.click(f'#theme-styles [data-style="{target}"]')
    pg.wait_for_timeout(500)
    now = pg.evaluate("({ style: mzSite.state.site.theme.style, attr: document.querySelector('#preview').contentDocument.documentElement.dataset.style })")
    pg.screenshot(path=f'{OUT}/website-restyled.png')
    check('theme: switching style restyles the preview', target and now['style'] == target and now['attr'] == target, {'styles': styles, **now})

    # ---------- 4. fill images through the Image engine (mocked /api/shot) ----------
    shots = []
    pg.route('**/api/shot', lambda r: (shots.append(1), r.fulfill(status=200, content_type='image/png', body=png(), headers={'x-massless-model': '@cf/black-forest-labs/flux-1-schnell'})))
    empty0 = pg.evaluate('mzSite.emptySlots().length')
    pg.evaluate('mzSite.fillImages()')
    pg.wait_for_function('mzSite.emptySlots().length === 0 && !mzSite.state.fillCtl', timeout=120000)
    imgs = pg.evaluate("[...document.querySelector('#preview').contentDocument.querySelectorAll('img')].filter(i => i.complete && i.naturalWidth > 0).length")
    pg.unroute('**/api/shot')
    pg.screenshot(path=f'{OUT}/website-images.png')
    check('images: Fill images paints every empty slot through /api/shot', empty0 > 0 and len(shots) >= empty0 and imgs >= 1, {'emptyBefore': empty0, 'shots': len(shots), 'loadedImgs': imgs})

    # ---------- 5. share link ----------
    pg.click('#share')
    pg.wait_for_function("document.querySelector('#share-url').value.includes('#s=')", timeout=30000)
    url = pg.input_value('#share-url')
    pg.keyboard.press('Escape')
    name = pg.evaluate('mzSite.state.site.name')
    pg2 = ctx.new_page()
    watch(pg2, 'share')
    pg2.goto(url.replace('https://chucksi.com', BASE).replace(f'{BASE}/website#', f'{BASE}/website/#'), wait_until='domcontentloaded')
    pg2.wait_for_selector('body[data-ready="1"]', timeout=60000)
    back = pg2.evaluate('mzSite.state.site.name')
    pg2.close()
    check('share: the link opens an editable copy of the same site', back == name and '#s=' in url, {'name': name, 'back': back, 'linkBytes': len(url)})

    # ---------- 6. export: ZIP and one HTML file ----------
    pg.click('#export-btn')
    pg.wait_for_timeout(300)
    checklist = pg.evaluate("document.querySelectorAll('#checklist li').length")
    with pg.expect_download(timeout=120000) as d:
        pg.click('#dl-zip')
    zpath = os.path.join(OUT, d.value.suggested_filename)
    d.value.save_as(zpath)
    with zipfile.ZipFile(zpath) as z:
        names = z.namelist()
        index = z.read('index.html').decode('utf-8')
    with pg.expect_download(timeout=120000) as d:
        pg.click('#dl-html')
    hpath = os.path.join(OUT, d.value.suggested_filename)
    d.value.save_as(hpath)
    pg.keyboard.press('Escape')
    check('export ZIP: index, pages, sitemap, robots, assets', 'index.html' in names and 'sitemap.xml' in names and 'robots.txt' in names and any(n.startswith('assets/') for n in names) and name.split()[0] in index,
          {'files': len(names), 'sample': names[:12], 'checklistItems': checklist})

    off = b.new_context(viewport={'width': 390, 'height': 844})
    net = []
    off.route('**/*', lambda r: (net.append(r.request.url), r.abort()) if not r.request.url.startswith(('file:', 'data:', 'blob:')) else r.continue_())
    op = off.new_page()
    local_err = []
    op.on('pageerror', lambda e: local_err.append(str(e)))
    op.goto('file://' + os.path.abspath(hpath), wait_until='load')
    op.wait_for_timeout(600)
    single = op.evaluate("({ blocks: document.querySelectorAll('[data-page]').length, text: document.body.innerText.length, sw: document.documentElement.scrollWidth, imgs: [...document.images].filter(i => i.naturalWidth > 0).length })")
    op.screenshot(path=f'{OUT}/website-export-single-390.png', full_page=True)
    off.close()
    check('export HTML: one file that works from file:// at phone width (only web fonts need the network)', single['blocks'] >= 1 and single['text'] > 200 and single['sw'] <= 390 and not local_err and all('fonts.g' in u for u in net),
          {**single, 'blocked': net[:4], 'errors': local_err[:3]})
    ctx.close()
    b.close()

print('errors:', errors)
failed = [k for k, v in checks.items() if not v]
print(f'{len(checks) - len(failed)}/{len(checks)} checks passed', 'FAILED: ' + ', '.join(failed) if failed else '')
sys.exit(1 if failed or errors else 0)
