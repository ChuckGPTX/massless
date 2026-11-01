"""Website builder Publish (free hosting at <name>.v2web.site) in a real browser, with the /api/sites API mocked:
signed out (prompt, sign-in round trip back to the builder with the dialog reopened), signed in (address prefilled from
the site name, live availability check, a refused name, publish with the exported files, live link and copy),
reopening finds the published site, Update (PUT), Unpublish (DELETE), a form URL blocks publishing, desktop and phone.
python3 tests/website_publish_test.py [out_dir]   (screenshots: tests/out/website-publish/)"""
import http.server, threading, socketserver, os, sys, functools, json, time, re
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'out', 'website-publish')
os.makedirs(OUT, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/website', '/projects'): p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)

    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
BASE = f'http://127.0.0.1:{srv.server_address[1]}'
threading.Thread(target=srv.serve_forever, daemon=True).start()

checks, errors = {}, []


def check(name, ok, detail=None):
    checks[name] = bool(ok)
    print(('PASS ' if ok else 'FAIL ') + name, '' if detail is None else json.dumps(detail)[:400], flush=True)


class Api:
    """A tiny stand-in for src/sites.js."""
    def __init__(self):
        self.sites, self.calls = {}, []

    def site(self, slug, version):
        return {'slug': slug, 'url': f'https://{slug}.v2web.site', 'version': version, 'status': 'live', 'size': 1000, 'files': 10,
                'createdAt': '2026-11-01T10:00:00.000Z', 'updatedAt': '2026-11-01T10:00:00.000Z'}

    def handle(self, route):
        req = route.request
        url = req.url
        path = '/' + url.split('/', 3)[3].split('?')[0]
        reply = lambda body, status=200: route.fulfill(status=status, content_type='application/json', body=json.dumps(body))
        if path == '/api/config':
            return reply({'cloud': True, 'supabaseUrl': 'https://sb.test', 'publishableKey': 'pk', 'models': {}, 'gpu': {'on': False}, 'promoVideo': {'on': False}})
        if path == '/api/human':
            return reply({'on': False, 'passed': True})
        if not path.startswith('/api/sites'):
            return reply({'error': 'Not found'}, 404)
        auth = req.headers.get('authorization', '')
        self.calls.append({'method': req.method, 'path': path, 'auth': auth, 'body': req.post_data_buffer if req.method in ('POST', 'PUT') else None})
        if path == '/api/sites/check':
            slug = url.split('slug=')[1]
            if slug == 'taken-name': return reply({'slug': slug, 'available': False, 'taken': True, 'reason': 'That address is taken.'})
            if 'paypal' in slug: return reply({'slug': slug, 'available': False, 'reason': 'Addresses that look like a brand, sign-in or payment page are not allowed.'})
            return reply({'slug': slug, 'available': slug not in self.sites})
        if auth != 'Bearer test-token':
            return reply({'error': 'Sign in to publish your site.', 'signIn': True}, 401)
        if path == '/api/sites' and req.method == 'GET':
            return reply({'sites': list(self.sites.values()), 'limits': {'maxSites': 5}})
        if path == '/api/sites' and req.method == 'POST':
            meta = json.loads(re.search(rb'name="meta"\r\n\r\n(.*?)\r\n--', req.post_data_buffer, re.S).group(1))
            self.sites[meta['slug']] = self.site(meta['slug'], 1)
            self.calls[-1]['meta'] = meta
            return reply({'ok': True, 'site': self.sites[meta['slug']]}, 201)
        slug = path.rsplit('/', 1)[1]
        if req.method == 'PUT':
            self.sites[slug] = self.site(slug, self.sites[slug]['version'] + 1)
            return reply({'ok': True, 'site': self.sites[slug]})
        if req.method == 'DELETE':
            self.sites.pop(slug, None)
            return reply({'ok': True, 'slug': slug})
        return reply({'error': 'Not found'}, 404)


SESSION = json.dumps({'access_token': 'test-token', 'refresh_token': 'r', 'expires_in': 3600, 'expires_at': int(time.time()) + 36000, 'user': {'id': 'u1', 'email': 'a@example.com'}})


def watch(pg, label):
    pg.on('pageerror', lambda e: errors.append(f'{label}: {e}'))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(f'{label}: {m.text[:200]}'))


def open_builder(pg):
    pg.goto(f'{BASE}/website/', wait_until='domcontentloaded')
    pg.wait_for_selector('body[data-ready="1"]', timeout=60000)


def visible(pg, sel):
    return pg.evaluate(f"(() => {{ const e = document.querySelector('{sel}'); return !!e && !e.hidden && e.getClientRects().length > 0; }})()")


with sync_playwright() as p:
    b = p.chromium.launch()
    for label, opts in [('1440', dict(viewport={'width': 1440, 'height': 900})), ('390', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))]:
        api = Api()
        ctx = b.new_context(**opts)
        ctx.route('**/api/**', api.handle)
        ctx.route('https://sb.test/**', lambda r: r.abort())
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.abort())
        ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=BASE)
        pg = ctx.new_page()
        watch(pg, label)
        pg.on('dialog', lambda d: d.accept())

        # ---------- signed out ----------
        open_builder(pg)
        pg.click('#publish-btn')
        pg.wait_for_selector('#pub-out:not([hidden])')
        check(f'{label}: signed out shows only the sign-in prompt', visible(pg, '#pub-signin') and not visible(pg, '#pub-new') and not visible(pg, '#pub-live'))
        pg.screenshot(path=f'{OUT}/signed-out-{label}.png')
        pg.click('#pub-signin')
        pg.wait_for_url('**/projects/**')
        nxt = pg.evaluate("[sessionStorage.getItem('chucksi.after-signin'), sessionStorage.getItem('chucksi.publish-reopen')]")
        check(f'{label}: sign-in returns to the builder', nxt == ['/website/', '1'], nxt)

        # ---------- signed in: back in the builder, the dialog reopens ----------
        pg.evaluate(f"localStorage.setItem('massless.cloud-session', {json.dumps(SESSION)})")
        pg.evaluate("sessionStorage.removeItem('chucksi.after-signin')")
        open_builder(pg)
        pg.wait_for_selector('#publish-dialog[open] #pub-new:not([hidden])', timeout=10000)
        pg.wait_for_function("document.querySelector('#pub-check').textContent === 'Available'", timeout=10000)
        info = pg.evaluate("({ slug: document.querySelector('#pub-slug').value, name: window.mzSite.state.site.name, go: document.querySelector('#pub-go').disabled, sw: document.documentElement.scrollWidth })")
        check(f'{label}: reopened after sign-in, address prefilled from the site name and available', info['slug'] and info['slug'] in re.sub(r'[^a-z0-9]+', '-', info['name'].lower()) and not info['go'] and info['sw'] <= opts['viewport']['width'], info)
        pg.screenshot(path=f'{OUT}/address-{label}.png')

        pg.fill('#pub-slug', 'Taken Name')
        pg.wait_for_function("document.querySelector('#pub-check').textContent.includes('taken')", timeout=5000)
        check(f'{label}: typing is cleaned into an address; a taken one disables Publish', pg.input_value('#pub-slug') == 'taken-name' and pg.is_disabled('#pub-go'))
        pg.fill('#pub-slug', 'paypal-help')
        pg.wait_for_function("document.querySelector('#pub-check').textContent.includes('brand')", timeout=5000)
        check(f'{label}: brand-like address refused', pg.is_disabled('#pub-go'))
        pg.fill('#pub-slug', 'ab')
        check(f'{label}: too short checked in the page', 'least 3' in pg.text_content('#pub-check') and pg.is_disabled('#pub-go'))

        pg.fill('#pub-slug', 'my-test-site')
        pg.wait_for_function("document.querySelector('#pub-check').textContent === 'Available'", timeout=5000)
        pg.click('#pub-go')
        pg.wait_for_selector('#pub-live:not([hidden])', timeout=60000)
        post = next(c for c in api.calls if c['method'] == 'POST')
        paths = post['meta']['paths']
        body = post['body']
        live = pg.evaluate("({ link: document.querySelector('#pub-link').href, text: document.querySelector('#pub-link').textContent, url: document.querySelector('#pub-url').value, msg: document.querySelector('#pub-msg').textContent })")
        check(f'{label}: publish sends the exported files with the sign-in token',
              post['auth'] == 'Bearer test-token' and post['meta']['slug'] == 'my-test-site' and 'index.html' in paths and 'assets/site.js' in paths and 'assets/style.css' in paths
              and 'sitemap.xml' in paths and '.nojekyll' not in paths and b'<meta name="generator" content="Chucksi Website">' in body and b'https://my-test-site.v2web.site' in body,
              {'paths': paths[:12], 'n': len(paths)})
        check(f'{label}: live link shown', live['link'] == 'https://my-test-site.v2web.site/' and live['text'] == 'my-test-site.v2web.site' and live['url'] == 'https://my-test-site.v2web.site' and 'live' in live['msg'], live)
        pg.click('#pub-copy')
        pg.wait_for_timeout(200)
        clip = pg.evaluate('navigator.clipboard.readText()')
        check(f'{label}: copy puts the address on the clipboard', clip == 'https://my-test-site.v2web.site', clip)
        pg.screenshot(path=f'{OUT}/live-{label}.png')

        # ---------- reopen: the project remembers its address; Update; Unpublish ----------
        pg.keyboard.press('Escape')
        pg.click('#publish-btn')
        pg.wait_for_selector('#pub-live:not([hidden])', timeout=10000)
        check(f'{label}: reopening shows the published site', pg.text_content('#pub-link') == 'my-test-site.v2web.site')
        pg.click('#pub-update')
        pg.wait_for_function("document.querySelector('#pub-msg').textContent.includes('Updated')", timeout=60000)
        put = [c for c in api.calls if c['method'] == 'PUT']
        check(f'{label}: Update republishes to the same address', len(put) == 1 and put[0]['path'] == '/api/sites/my-test-site' and api.sites['my-test-site']['version'] == 2)
        pg.click('#pub-unpublish')
        pg.wait_for_selector('#pub-new:not([hidden])', timeout=10000)
        dels = [c for c in api.calls if c['method'] == 'DELETE']
        check(f'{label}: Unpublish deletes the site and offers the address again', len(dels) == 1 and 'my-test-site' not in api.sites and pg.input_value('#pub-slug') == 'my-test-site')

        # ---------- a form that posts to another website can't be hosted ----------
        pg.keyboard.press('Escape')
        pg.evaluate("window.mzSite.mutate((s) => { s.contact.form = 'https://formspree.io/f/abc'; })")
        pg.click('#publish-btn')
        pg.wait_for_selector('#pub-new:not([hidden])')
        pg.wait_for_timeout(600)
        check(f'{label}: an outside form URL blocks publishing with a clear note', pg.is_disabled('#pub-go') and 'form' in pg.text_content('#pub-msg').lower())
        pg.screenshot(path=f'{OUT}/form-blocked-{label}.png')
        ctx.close()
    b.close()

print('errors:', errors)
failed = [k for k, v in checks.items() if not v]
print(f'{len(checks) - len(failed)}/{len(checks)} checks passed', 'FAILED: ' + ', '.join(failed) if failed else '')
sys.exit(1 if failed or errors else 0)
