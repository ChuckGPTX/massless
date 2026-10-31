"""Master check in headless Chromium: a mix in, a report, four destinations, fair A/B, 24-bit WAV and MP3 out.

Serves public/ on a random port (with /audio -> /audio/index.html). The MP3 encoder (wasm-media-encoders 0.7.0 on
jsDelivr) is fetched once by this script, checked against the SHA-256 pinned in public/js/extract-worker.js, and
served to the page from that copy. Test media are written here: a 16 s stereo 44.1 kHz "mix" (kick, bass, a
chord, hats and a little noise) mastered from about -22 LUFS, and a near-silent file. Checks:
  - no request leaves 127.0.0.1 except the two pinned encoder files;
  - the report names loudness, true peak, loudness range, tone, stereo and clipping in plain words;
  - every destination (Streaming -14, Podcast -16, Broadcast -23, Loud -9 LUFS, all -1 dBTP) measures within
    0.5 LU in the page and in the exported 24-bit WAV (ffmpeg ebur128, an independent meter), true peak at or
    under -1 dBTP; the WAV header says 24-bit and the length matches the source;
  - MP3 320 kbps: decoded by ffmpeg, within 0.5 LU of -14 and true peak under -1 dBTP; the page reports the
    numbers it measured on the file itself;
  - A/B plays both versions at once and switches by gain, matched in loudness unless unticked;
  - the export lands in the local library (engine local-master);
  - a near-silent file says "Too quiet to master" and the Master button stays off;
  - screenshots at 1440x900 and 390x844 in tests/out/master/, no horizontal overflow, no page errors.

  python3 tests/master_test.py
"""
import array, base64, functools, hashlib, http.server, math, os, random, re, socketserver, struct, subprocess, sys, tempfile, threading, urllib.request, wave
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'public')
OUT = os.path.join(HERE, 'out', 'master')
os.makedirs(OUT, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/audio', '/library'):
            p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)

    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}'

worker_src = open(os.path.join(ROOT, 'js', 'extract-worker.js'), encoding='utf-8').read()
CDN = re.search(r"LAME_BASE = '([^']+)'", worker_src).group(1)
PINS = dict(re.findall(r"url: `\$\{LAME_BASE\}([^`]+)`, sha256: '([^']+)'", worker_src))
CDN_FILES = {}
for rel, pin in PINS.items():
    body = urllib.request.urlopen(CDN + rel, timeout=60).read()
    got = base64.b64encode(hashlib.sha256(body).digest()).decode()
    assert got == pin, f'{rel}: jsDelivr serves {got}, the worker pins {pin}'
    CDN_FILES[rel] = (body, 'application/wasm' if rel.endswith('.wasm') else 'application/javascript; charset=utf-8')

tmp = tempfile.mkdtemp(prefix='massless-master-')
RATE = 44100
SECONDS = 16


def write_wav(path, L, R, rate=RATE):
    data = array.array('h')
    for a, b in zip(L, R):
        data.append(max(-32768, min(32767, int(round(a * 32767)))))
        data.append(max(-32768, min(32767, int(round(b * 32767)))))
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(data.tobytes())


rng = random.Random(5)
n = RATE * SECONDS
L, R = [0.0] * n, [0.0] * n
beat = RATE // 2  # 120 bpm
for i in range(n):
    t = i / RATE
    k = i % beat
    kick = math.exp(-k / (0.05 * RATE)) * math.sin(2 * math.pi * (50 + 80 * math.exp(-k / (0.01 * RATE))) * k / RATE)
    bass = 0.25 * math.sin(2 * math.pi * 55 * t) * (0.6 + 0.4 * math.sin(2 * math.pi * 0.5 * t))
    chord = 0.06 * (math.sin(2 * math.pi * 220 * t) + math.sin(2 * math.pi * 277.2 * t) + math.sin(2 * math.pi * 329.6 * t))
    h = i % (beat // 2)
    hat = 0.08 * math.exp(-h / (0.004 * RATE)) * (rng.random() * 2 - 1)
    noise = 0.004 * (rng.random() * 2 - 1)
    L[i] = 0.5 * kick + bass + chord * 1.1 + hat + noise
    R[i] = 0.5 * kick + bass + chord * 0.9 - 0.6 * hat + noise
peak = max(max(abs(x) for x in L), max(abs(x) for x in R))
scale = 0.35 / peak
MIX = os.path.join(tmp, 'demo-mix.wav')
write_wav(MIX, [x * scale for x in L], [x * scale for x in R])
QUIET = os.path.join(tmp, 'room-tone.wav')
write_wav(QUIET, [2e-5 * (rng.random() * 2 - 1) for _ in range(RATE * 3)], [2e-5 * (rng.random() * 2 - 1) for _ in range(RATE * 3)])


def loudness(path):
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    summary = err[err.rfind('Summary:'):]
    lufs = float(re.search(r'I:\s+(-?[\d.]+) LUFS', summary).group(1))
    true = float(re.search(r'True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS', summary).group(1))
    return lufs, true


print('source', loudness(MIX))
errors, requests = [], []


def watch(page, tag):
    page.on('pageerror', lambda e: errors.append(f'{tag} pageerror: {e}'))
    page.on('console', lambda m: m.type == 'error' and 'favicon' not in m.text and errors.append(f'{tag} console: {m.text[:200]}'))


def on_cdn(route):
    rel = route.request.url[len(CDN):]
    if rel not in CDN_FILES:
        return route.fulfill(status=404, body='not pinned')
    body, ctype = CDN_FILES[rel]
    route.fulfill(status=200, body=body, headers={'content-type': ctype, 'access-control-allow-origin': '*'})


def shot(page, name):
    page.wait_for_timeout(300)
    path = os.path.join(OUT, f'{name}.png')
    page.screenshot(path=path)
    print('shot', path)


def save_download(page, selector, timeout=120000):
    with page.expect_download(timeout=timeout) as dl:
        page.click(selector)
    d = dl.value
    path = os.path.join(tmp, d.suggested_filename)
    d.save_as(path)
    return d.suggested_filename, path


def idle(page, timeout=120000):
    page.wait_for_function('() => !document.querySelector("#gen-master").classList.contains("busy")', timeout=timeout)


DESTS = {'streaming': -14, 'podcast': -16, 'broadcast': -23, 'loud': -9}

with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    ctx.on('request', lambda r: requests.append(r.url))
    ctx.route(CDN + '**', on_cdn)
    page = ctx.new_page()
    watch(page, 'desktop')
    page.goto(f'{BASE}/audio?tab=master')
    page.wait_for_selector('#master-view:not([hidden])')
    assert page.locator('#mst-chars .engine').count() == 3
    assert page.locator('#mst-dests .engine').count() == 4
    assert 'LUFS' in page.inner_text('.mst-hint')
    shot(page, 'empty-1440')
    assert not [u for u in requests if not u.startswith(BASE)], 'nothing loads from elsewhere before a file is added'

    page.set_input_files('#mst-in', MIX)
    page.wait_for_selector('#mst-out:not([hidden])', timeout=120000)
    idle(page)
    report = page.inner_text('#mst-report')
    for word in ['Loudness', 'LUFS', 'True peak', 'dBTP', 'Loudness range', 'LU', 'Tone', 'Stereo', 'Clipping']:
        assert word in report, (word, report)
    src = page.evaluate('() => window.massless.master.report.lufs')
    print('page source loudness', src)
    shot(page, 'mastered-1440')

    results = {}
    for dest, target in DESTS.items():
        page.click(f'#mst-dests .engine[data-id="{dest}"]')
        page.wait_for_function('(d) => window.massless.master.key.endsWith(d + "|false") || window.massless.master.key.split("|")[1] === d', arg=dest, timeout=120000)
        idle(page)
        r = page.evaluate('() => ({ lufs: window.massless.master.result.lufs, tp: window.massless.master.result.truePeak, frames: window.massless.master.result.buf.length })')
        assert abs(r['lufs'] - target) <= 0.5, (dest, r)
        assert r['tp'] <= -1, (dest, r)
        assert r['frames'] == RATE * SECONDS, r
        name, path = save_download(page, '#mst-wav')
        idle(page)
        assert name.endswith(f'(master, {dest}).wav'), name
        with wave.open(path) as w:
            assert w.getsampwidth() == 3 and w.getnchannels() == 2 and w.getframerate() == RATE, (w.getsampwidth(), w.getnchannels(), w.getframerate())
            assert w.getnframes() == RATE * SECONDS
        lufs, tp = loudness(path)
        measured = page.inner_text('#mst-measured')
        assert 'Measured on the WAV file' in measured, measured
        print(dest, 'page', round(r['lufs'], 2), round(r['tp'], 2), '| ffmpeg', lufs, tp, '|', measured)
        assert abs(lufs - target) <= 0.5, (dest, lufs)
        assert tp <= -1.0 + 0.05, (dest, tp)  # ffmpeg prints one decimal
        results[dest] = (lufs, tp)

    # MP3 for streaming
    page.click('#mst-dests .engine[data-id="streaming"]')
    page.wait_for_function('() => window.massless.master.key.split("|")[1] === "streaming"', timeout=120000)
    idle(page)
    name, path = save_download(page, '#mst-mp3')
    idle(page)
    assert name.endswith('.mp3'), name
    lufs, tp = loudness(path)
    print('mp3 ffmpeg', lufs, tp, page.inner_text('#mst-measured'))
    assert abs(lufs + 14) <= 0.5, lufs
    assert tp <= -1.0, tp
    last = page.evaluate('() => window.massless.lastMaster')
    assert last['format'] == 'mp3' and last['saved'], last
    assert last['truePeak'] <= -1, last

    # the library has the exports
    saved = page.evaluate("""async () => { const s = await import('/js/store.js'); return (await s.all()).filter((x) => x.engine === 'local-master').map((x) => x.name); }""")
    assert len(saved) >= 5 and any(x.endswith('.mp3') for x in saved), saved

    # fair A/B: both play at once, switching is a gain change
    page.click('#mst-play')
    page.wait_for_timeout(400)
    ab = page.evaluate('() => { const p = window.massless.master.play; return { on: !!p, a: p.ga.gain.value, b: p.gb.gain.value }; }')
    assert ab['on'] and ab['a'] < 0.01 and ab['b'] > 0.1, ab
    page.click('#mst-a')
    page.wait_for_timeout(80)
    ab2 = page.evaluate('() => { const p = window.massless.master.play; return { a: p.ga.gain.value, b: p.gb.gain.value, pos: p.ctx.currentTime - p.t0 }; }')
    assert ab2['b'] < 0.01 and ab2['a'] > 0.1, ab2
    m = page.evaluate('() => ({ o: window.massless.master.report.lufs, t: window.massless.master.result.lufs })')
    want = 10 ** ((min(m['o'], m['t']) - m['o']) / 20)
    assert abs(ab2['a'] - want) < 0.02, (ab2, want)
    assert 'turned down' not in page.inner_text('#mst-ab-note') or m['o'] > m['t']
    page.uncheck('#mst-fair')
    page.wait_for_timeout(80)
    assert abs(page.evaluate('() => window.massless.master.play.ga.gain.value') - 1) < 0.02
    page.check('#mst-fair')
    page.click('#mst-b')
    shot(page, 'ab-1440')
    page.click('#mst-play')

    # phone layout
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(300)
    over = page.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
    assert over <= 0, f'horizontal overflow {over}px at 390'
    shot(page, 'mastered-390')
    page.evaluate('() => document.querySelector("#tab-master").scrollIntoView()')
    shot(page, 'controls-390')

    # near-silence
    page.set_input_files('#mst-in', QUIET)
    page.wait_for_selector('#mst-quiet:not([hidden])', timeout=60000)
    idle(page)
    assert page.is_disabled('#gen-master')
    assert page.locator('#mst-out').is_hidden()
    assert 'Too quiet to master' in page.inner_text('#mst-quiet')
    over = page.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
    assert over <= 0, over
    shot(page, 'too-quiet-390')
    b.close()

outside = [u for u in requests if not u.startswith(BASE) and not u.startswith(CDN)]
assert not outside, outside
assert not errors, errors
print('master: ok', results)
