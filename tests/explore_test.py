"""Explore (/explore) and Share to Explore in a real browser, with /api/explore mocked by a small stand-in fed with the
seed posts (tools/explore/seed/seed.sql) and media served from public/media/templates. Checks, at 1440 and 390 wide:
the masonry feed renders, at most 6 loops play, reduced motion plays none, tool chips and New/Top refetch, the detail
sheet (creator, likes, Remix link with ?from=, report), liking signed out asks to sign in; the share sheet posts the
media and details, a signed-out share waits through sign-in and reopens on /explore; the Website builder's Explore
button opens the sheet with its picture. No console errors, no sideways scroll.
python3 tests/explore_test.py [out_dir]   (screenshots: tests/out/explore/)"""
import http.server, threading, socketserver, os, sys, functools, json, re, time
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'public')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out', 'explore')
os.makedirs(OUT, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/explore', '/website', '/projects'): p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)

    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
BASE = f'http://127.0.0.1:{srv.server_address[1]}'
threading.Thread(target=srv.serve_forever, daemon=True).start()

checks, errors = {}, []


def check(name, ok, detail=None):
    checks[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, '' if detail is None else json.dumps(detail)[:300], flush=True)


# seed rows -> posts, as GET /api/explore returns them
COLS = None
ROWS = []
for line in open(os.path.join(HERE, '..', 'tools', 'explore', 'seed', 'seed.sql')):
    m = re.match(r"INSERT OR IGNORE INTO explore_posts \(([^)]*)\) VALUES \((.*)\);$", line.strip())
    if not m: continue
    COLS = [c.strip() for c in m.group(1).split(',')]
    vals = re.findall(r"'((?:[^']|'')*)'|(NULL)|(-?\d+)", m.group(2))
    ROWS.append({c: (a.replace("''", "'") if a or (not n and not d) else None if n else int(d)) for c, (a, n, d) in zip(COLS, vals)})
LABEL = {'video': 'Video', 'image': 'Image', 'design': 'Design', 'website': 'Website', 'games': 'Games', 'slides': 'Slides', '3d': '3D'}
TEMPL = {}
for line in open(os.path.join(HERE, '..', 'tools', 'explore', 'seed', 'apply.sh')):
    m = re.search(r'explore/(\w+)/(media|poster)\.(\w+) --file public(\S+)', line)
    if m: TEMPL[(m.group(1), m.group(2))] = m.group(4)


def post_of(r):
    return {'id': r['id'], 'title': r['title'], 'tool': r['tool'], 'toolLabel': LABEL[r['tool']], 'kind': r['kind'],
            'media': f"/explore-media/{r['id']}/media.{r['media_ext']}", 'poster': f"/explore-media/{r['id']}/poster.{r['poster_ext']}",
            'width': r['width'], 'height': r['height'], 'remix': r['remix'], 'link': '', 'tags': r['tags'].split(',') if r['tags'] else [],
            'author': r['author'], 'likes': 0, 'remixes': 0, 'createdAt': '2026-11-01T12:00:00.000Z'}


SESSION = {'access_token': 'test-token', 'refresh_token': 'r', 'expires_at': int(time.time()) + 3600, 'user': {'id': 'u1', 'email': 'me@example.com'}}


class Api:
    def __init__(self):
        self.calls, self.posts = [], [post_of(r) for r in ROWS]

    def handle(self, route):
        req = route.request
        path = '/' + req.url.split('/', 3)[3].split('?')[0]
        q = dict(re.findall(r'[?&]([^=&]+)=([^&]*)', req.url))
        reply = lambda body, status=200: route.fulfill(status=status, content_type='application/json', body=json.dumps(body))
        if path.startswith('/explore-media/'):
            m = re.match(r'/explore-media/(\w+)/(media|poster)\.\w+', path)
            f = TEMPL.get((m.group(1), m.group(2))) if m else None
            if not f: return route.fulfill(status=404, body='')
            return route.fulfill(path=os.path.join(ROOT, f.lstrip('/')))
        if path == '/api/config':
            return reply({'cloud': True, 'supabaseUrl': 'https://sb.test', 'publishableKey': 'pk', 'models': {}, 'gpu': {'on': False}, 'promoVideo': {'on': False}})
        if path == '/api/human':
            return reply({'on': False, 'passed': True})
        if not path.startswith('/api/explore'):
            return reply({'error': 'Not found'}, 404)
        auth = req.headers.get('authorization', '')
        self.calls.append({'method': req.method, 'path': path, 'q': q, 'auth': auth, 'body': req.post_data_buffer if req.method == 'POST' else None})
        if path == '/api/explore' and req.method == 'GET':
            items = [p for p in self.posts if not q.get('tool') or p['tool'] == q['tool']]
            if q.get('sort') == 'top': items = sorted(items, key=lambda p: -p['likes'])
            start = int(q.get('cursor') or 0)
            page = items[start:start + 24]
            return reply({'posts': page, 'cursor': str(start + 24) if start + 24 < len(items) else None})
        if path == '/api/explore' and req.method == 'POST':
            if auth != 'Bearer test-token': return reply({'error': 'Sign in to share on Explore.', 'signIn': True}, 401)
            meta = json.loads(re.search(rb'name="meta"\r\n\r\n(.*?)\r\n--', req.post_data_buffer, re.S).group(1))
            self.calls[-1]['meta'] = meta
            post = {**post_of(ROWS[0]), 'id': 'newpost0001', 'title': meta['title'], 'tool': meta['tool'], 'remix': meta['remix'], 'author': 'Me', 'mine': True, 'status': 'live'}
            return reply({'ok': True, 'post': post}, 201)
        m = re.match(r'/api/explore/(\w+)(?:/(\w+))?$', path)
        post = next((p for p in self.posts if m and p['id'] == m.group(1)), None)
        if not post: return reply({'error': 'That post is not on Explore.'}, 404)
        if not m.group(2): return reply({'post': {**post, **({'liked': False, 'mine': False} if auth else {})}})
        if m.group(2) == 'report': return reply({'ok': True, 'hidden': False})
        if m.group(2) == 'remix': return reply({'ok': True, 'counted': True})
        if m.group(2) == 'like':
            if not auth: return reply({'error': 'Sign in', 'signIn': True}, 401)
            post['likes'] += 1
            return reply({'ok': True, 'liked': True, 'likes': post['likes']})
        return reply({'error': 'Not found'}, 404)


def wire(ctx, api):
    ctx.route('**/api/**', api.handle)
    ctx.route('**/explore-media/**', api.handle)
    ctx.route('https://sb.test/**', lambda r: r.abort())
    ctx.route(re.compile(r'https://(fonts\.(googleapis|gstatic)\.com|challenges\.cloudflare\.com)/.*'), lambda r: r.abort())


def watch(pg, label):
    pg.on('pageerror', lambda e: errors.append(f'{label}: {e}'))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(f'{label}: {m.text[:200]}'))


def no_sideways(pg):
    return pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')


with sync_playwright() as p:
    browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    for w, h in [(1440, 900), (390, 844)]:
        tag = f'{w}'
        api = Api()
        ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1)
        wire(ctx, api)
        pg = ctx.new_page()
        watch(pg, f'explore {tag}')
        pg.goto(BASE + '/explore/')
        pg.wait_for_selector('.ex-card')
        pg.wait_for_timeout(1500)
        n = pg.locator('.ex-card').count()
        check(f'{tag}: feed shows the first page', n == 24, n)
        cols = pg.evaluate("getComputedStyle(document.querySelector('#ex-grid')).gridTemplateColumns.split(' ').length")
        check(f'{tag}: masonry columns', cols == (5 if w >= 1360 else 2), cols)
        playing = pg.evaluate("chucksiExplore.player.playing")
        check(f'{tag}: at most 6 loops play', 0 < playing <= 6, playing)
        check(f'{tag}: nav has Explore after Workflows', pg.evaluate("""(() => { const a = [...document.querySelectorAll('.nav-links > a')].map(x => x.textContent); return a.indexOf('Explore') === a.indexOf('Workflows') + 1 && document.querySelector('.nav-links a[href="/explore/"]').getAttribute('aria-current') === 'page'; })()"""))
        check(f'{tag}: no sideways scroll', no_sideways(pg))
        pg.screenshot(path=os.path.join(OUT, f'feed-{tag}.png'))
        pg.evaluate('scrollTo(0, document.body.scrollHeight)')
        pg.wait_for_function(f"document.querySelectorAll('.ex-card').length === {len(ROWS)}", timeout=10000)
        check(f'{tag}: scrolling loads the next page', any(c['q'].get('cursor') == '24' for c in api.calls))
        pg.evaluate('scrollTo(0, 0)')

        pg.click('.wf-chip[data-tool="games"]')
        pg.wait_for_function("document.querySelectorAll('.ex-card').length && [...document.querySelectorAll('.ex-card')].every(c => c.dataset.tool === 'games')")
        check(f'{tag}: tool chip refetches', any(c['q'].get('tool') == 'games' for c in api.calls), [c['q'] for c in api.calls][-1])
        check(f'{tag}: chip in the address', 'tool=games' in pg.url, pg.url)
        pg.click('.ex-sort-btn[data-sort="top"]')
        pg.wait_for_timeout(300)
        check(f'{tag}: Top refetches', api.calls[-1]['q'].get('sort') == 'top' and api.calls[-1]['q'].get('tool') == 'games', api.calls[-1]['q'])
        pg.click('.wf-chip[data-tool=""]')
        pg.click('.ex-sort-btn[data-sort="new"]')
        pg.wait_for_function("document.querySelectorAll('.ex-card').length >= 24 && !document.querySelector('.ex-card[data-tool=games]:only-child')")

        first = ROWS[0]
        pg.click(f'.ex-card[data-id="{first["id"]}"]')
        pg.wait_for_selector('#ex-sheet[open]')
        pg.wait_for_timeout(500)
        title = pg.text_content('#ex-sheet-title')
        check(f'{tag}: sheet shows the post', title == first['title'] and 'Chucksi' in pg.text_content('#ex-sheet-by'), title)
        href = pg.get_attribute('#ex-remix', 'href')
        check(f'{tag}: Remix opens the tool with ?from=', href.startswith('/video?') and f'from={first["id"]}' in href and 'effect=hologram' in href, href)
        check(f'{tag}: sheet is in the address', f'p={first["id"]}' in pg.url, pg.url)
        check(f'{tag}: sheet fits the screen', pg.evaluate("(() => { const r = document.querySelector('#ex-sheet').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; })()"))
        pg.screenshot(path=os.path.join(OUT, f'sheet-{tag}.png'))
        pg.click('#ex-like')
        pg.wait_for_timeout(200)
        check(f'{tag}: liking signed out asks to sign in', 'Sign in' in pg.text_content('#ex-sheet-msg'))
        pg.click('#ex-report-open')
        pg.check('#ex-report input[value="spam"]')
        pg.fill('#ex-report-details', 'Looks like spam')
        pg.click('#ex-report [type=submit]')
        pg.wait_for_timeout(400)
        rep = [c for c in api.calls if c['path'].endswith('/report')]
        check(f'{tag}: report is sent', rep and json.loads(rep[-1]['body'])['reason'] == 'spam' and 'Thanks' in pg.text_content('#ex-sheet-msg'))
        pg.keyboard.press('Escape')
        pg.wait_for_timeout(300)
        check(f'{tag}: closing the sheet tidies the address', 'p=' not in pg.url, pg.url)

        # opening a Remix link counts it and drops ?from=
        pg.goto(BASE + f'/explore/?from={first["id"]}')
        pg.wait_for_selector('.ex-card')
        pg.wait_for_timeout(300)
        check(f'{tag}: remix open is counted', any(c['path'].endswith(f'{first["id"]}/remix') for c in api.calls) and 'from=' not in pg.url, pg.url)

        # deep link straight to a post
        pg.goto(BASE + f'/explore?p={ROWS[3]["id"]}')
        pg.wait_for_selector('#ex-sheet[open]')
        pg.wait_for_function(f"document.querySelector('#ex-sheet-title').textContent === {json.dumps(ROWS[3]['title'])}")
        check(f'{tag}: deep link opens the sheet', True)
        ctx.close()

        # reduced motion: posters only
        ctx = browser.new_context(viewport={'width': w, 'height': h}, reduced_motion='reduce')
        wire(ctx, Api())
        pg = ctx.new_page()
        watch(pg, f'reduced {tag}')
        pg.goto(BASE + '/explore/')
        pg.wait_for_selector('.ex-card')
        pg.wait_for_timeout(1200)
        check(f'{tag}: reduced motion plays nothing', pg.evaluate('chucksiExplore.player.playing') == 0 and pg.evaluate("[...document.querySelectorAll('.ex-card video')].some(v => v.poster)"))
        ctx.close()

        # share: signed in, the sheet posts media + details
        api = Api()
        ctx = browser.new_context(viewport={'width': w, 'height': h})
        wire(ctx, api)
        pg = ctx.new_page()
        watch(pg, f'share {tag}')
        pg.goto(BASE + '/explore/')
        pg.evaluate(f"localStorage.setItem('massless.cloud-session', {json.dumps(json.dumps(SESSION))})")
        pg.wait_for_selector('.ex-card')
        pg.evaluate("""(async () => {
          const c = document.createElement('canvas'); c.width = 1200; c.height = 800;
          const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 1200, 800); gr.addColorStop(0, '#ffbf2f'); gr.addColorStop(1, '#3a0ca3'); g.fillStyle = gr; g.fillRect(0, 0, 1200, 800);
          const m = await import('/js/explore-share.js');
          window.__shared = m.shareToExplore({ blob: c, title: 'Sunset gradient', tool: 'image', remixUrl: '/image?prompt=sunset&from=zzz', tags: 'sunset, gradient' });
        })()""")
        pg.wait_for_selector('.xs-dialog[open] .xs-preview img')
        pg.wait_for_function("!document.querySelector('.xs-go').disabled")
        check(f'{tag}: share sheet fits', pg.evaluate("(() => { const r = document.querySelector('.xs-dialog').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; })()"))
        pg.screenshot(path=os.path.join(OUT, f'share-{tag}.png'))
        pg.fill('#xs-name', 'Sunset, remixed')
        pg.click('.xs-go')
        pg.wait_for_selector('.xs-done')
        post = [c for c in api.calls if c['method'] == 'POST' and c['path'] == '/api/explore']
        meta = post[-1].get('meta', {}) if post else {}
        body = post[-1]['body'] if post else b''
        check(f'{tag}: share posts meta, media and poster', meta.get('title') == 'Sunset, remixed' and meta.get('remix') == '/image?prompt=sunset' and meta.get('tool') == 'image' and post[-1]['auth'] == 'Bearer test-token'
              and b'name="media"' in body and b'name="poster"' in body and meta.get('width') == 1200, meta)
        check(f'{tag}: posted view links to the post', pg.get_attribute('.xs-done a.btn-accent', 'href') == '/explore?p=newpost0001')
        pg.screenshot(path=os.path.join(OUT, f'posted-{tag}.png'))
        pg.goto(BASE + '/explore/')
        ctx.close()

        # share: signed out waits through sign-in, then reopens on /explore
        api = Api()
        ctx = browser.new_context(viewport={'width': w, 'height': h})
        wire(ctx, api)
        pg = ctx.new_page()
        watch(pg, f'signed-out share {tag}')
        pg.goto(BASE + '/explore/')
        pg.wait_for_selector('.ex-card')
        pg.evaluate("""(async () => {
          const c = document.createElement('canvas'); c.width = 640; c.height = 640; const g = c.getContext('2d'); g.fillStyle = '#0a9396'; g.fillRect(0, 0, 640, 640);
          const m = await import('/js/explore-share.js');
          m.shareToExplore({ blob: c, title: 'Teal square', tool: 'design', remixUrl: '/workflows?make=map' });
        })()""")
        pg.wait_for_function("document.querySelector('.xs-go') && document.querySelector('.xs-go').textContent === 'Sign in to post' && !document.querySelector('.xs-go').disabled")
        pg.click('.xs-go')
        pg.wait_for_url(re.compile(r'.*/projects/#account$'))
        check(f'{tag}: signed out goes to sign in', pg.evaluate("sessionStorage.getItem('chucksi.after-signin')") == '/explore/')
        pg.evaluate(f"localStorage.setItem('massless.cloud-session', {json.dumps(json.dumps(SESSION))})")
        pg.goto(BASE + '/explore/')
        pg.wait_for_selector('.xs-dialog[open]')
        pg.wait_for_function("!document.querySelector('.xs-go').disabled")
        check(f'{tag}: the waiting share reopens after sign-in', pg.input_value('#xs-name') == 'Teal square')
        pg.click('.xs-go')
        pg.wait_for_selector('.xs-done')
        post = [c for c in api.calls if c['method'] == 'POST' and c['path'] == '/api/explore']
        check(f'{tag}: and posts', post and post[-1]['meta']['remix'] == '/workflows?make=map')
        ctx.close()

        # a tool's own button: the Website builder
        api = Api()
        ctx = browser.new_context(viewport={'width': w, 'height': h})
        wire(ctx, api)
        pg = ctx.new_page()
        watch(pg, f'website {tag}')
        pg.goto(BASE + '/website/')
        pg.wait_for_selector('body[data-ready="1"]', timeout=30000)
        pg.evaluate(f"localStorage.setItem('massless.cloud-session', {json.dumps(json.dumps(SESSION))})")
        btn = pg.locator('#explore-share')
        if not btn.is_visible():
            pg.evaluate("document.querySelector('#explore-share').click()")
        else:
            btn.click()
        pg.wait_for_selector('.xs-dialog[open] .xs-preview img', timeout=20000)
        pg.wait_for_function("!document.querySelector('.xs-go').disabled")
        check(f'{tag}: website builder opens the share sheet', pg.input_value('#xs-name') != '')
        pg.click('.xs-go')
        pg.wait_for_selector('.xs-done')
        post = [c for c in api.calls if c['method'] == 'POST' and c['path'] == '/api/explore']
        check(f'{tag}: website share carries a #s= remix', post and post[-1]['meta']['tool'] == 'website' and re.match(r'^/website(#s=|\?template=|$)', post[-1]['meta']['remix']), post[-1]['meta'] if post else None)
        pg.screenshot(path=os.path.join(OUT, f'website-share-{tag}.png'))
        ctx.close()
    browser.close()

check('zero console errors', not errors, errors[:5])
failed = [k for k, v in checks.items() if not v]
print(f'\n{len(checks) - len(failed)}/{len(checks)} passed' + (f'; failed: {failed}' if failed else ''))
sys.exit(1 if failed else 0)
