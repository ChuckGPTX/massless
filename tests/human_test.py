"""Proof-of-human flow in the browser: an API call answered with 401 {human: true} runs Turnstile once
(stubbed here), posts the token to /api/human, and retries; concurrent calls share one check; a failed
check comes back as a readable 403. python3 tests/human_test.py"""
import http.server, threading, socketserver, os, sys, functools, json
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

STUB = """window.turnstile = { _n: 0,
  render(box, o) { const id = ++this._n; window.__renders = (window.__renders || 0) + 1;
    setTimeout(() => (window.__fail ? o['error-callback']() : o.callback('tok-' + id)), 50); return id; },
  remove() {} };"""
state = {'passed': False, 'human_posts': 0, 'api_calls': 0}
def api(route):
    state['api_calls'] += 1
    if not state['passed']:
        return route.fulfill(status=401, content_type='application/json', body=json.dumps({'error': 'check', 'human': True, 'sitekey': 'site-1'}))
    route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'echo': route.request.post_data}))
def human(route):
    state['human_posts'] += 1
    tok = json.loads(route.request.post_data)['token']
    if tok.startswith('tok-'):
        state['passed'] = True
        return route.fulfill(status=200, content_type='application/json', body='{"ok":true}')
    route.fulfill(status=403, content_type='application/json', body='{"error":"nope"}')

fails = []
def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond: fails.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    errors = []; pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.route('https://challenges.cloudflare.com/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=STUB))
    pg.route('**/api/human', human)
    pg.route('**/api/tts', api)
    pg.goto(f'http://127.0.0.1:{port}/index.html')
    out = pg.evaluate("""async () => {
      const { apiFetch } = await import('/js/human.js');
      const go = (i) => apiFetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ i }) }).then(async (r) => ({ s: r.status, j: await r.json() }));
      const res = await Promise.all([go(1), go(2), go(3)]);
      const again = await go(4);
      return { res, again, renders: window.__renders, widgets: document.querySelectorAll('[aria-label="Human check"]').length };
    }""")
    check(all(r['s'] == 200 for r in out['res']), f"three concurrent calls all succeed after one check: {[r['s'] for r in out['res']]}")
    check([json.loads(r['j']['echo'])['i'] for r in out['res']] == [1, 2, 3], 'each retry re-sends its own body')
    check(out['renders'] == 1 and state['human_posts'] == 1, f"one Turnstile render and one /api/human post (renders={out['renders']}, posts={state['human_posts']})")
    check(out['again']['s'] == 200, 'later call goes straight through')
    check(out['widgets'] == 0, 'the widget is removed afterwards')
    # failure path: fresh page, Turnstile errors
    state.update(passed=False, human_posts=0)
    pg2 = b.new_page()
    pg2.route('https://challenges.cloudflare.com/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=STUB))
    pg2.route('**/api/human', human); pg2.route('**/api/tts', api)
    pg2.goto(f'http://127.0.0.1:{port}/index.html')
    bad = pg2.evaluate("""async () => { window.__fail = true; const { apiFetch } = await import('/js/human.js');
      const r = await apiFetch('/api/tts', { method: 'POST', body: '{}' }); return { s: r.status, j: await r.json() }; }""")
    check(bad['s'] == 403 and 'human check failed' in bad['j']['error'], f"a failed check returns a readable 403: {bad}")
    # script blocked
    pg3 = b.new_page()
    pg3.route('https://challenges.cloudflare.com/**', lambda r: r.abort())
    pg3.route('**/api/tts', api)
    pg3.goto(f'http://127.0.0.1:{port}/index.html')
    blocked = pg3.evaluate("""async () => { const { apiFetch } = await import('/js/human.js');
      const r = await apiFetch('/api/tts', { method: 'POST', body: '{}' }); return { s: r.status, j: await r.json() }; }""")
    check(blocked['s'] == 403 and 'could not load' in blocked['j']['error'], f"a blocked Turnstile script returns a readable 403: {blocked['j']['error']}")
    check(not errors, f'no page errors {errors}')
    b.close()
print('FAILED' if fails else 'OK'); sys.exit(1 if fails else 0)
