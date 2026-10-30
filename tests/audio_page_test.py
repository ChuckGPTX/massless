"""Audio page check in headless Chromium: MeloTTS voices and Whisper captions, with both endpoints mocked.

Serves public/ on a random port (with /audio -> /audio/index.html), mocks /api/tts and /api/transcribe with
page.route and checks:
  - MeloTTS: the language grid replaces the Kokoro voices, a long Spanish script is sent in sentence chunks
    under 1,000 characters with lang=es, and the joined 44.1 kHz WAV lands in the history as "MeloTTS · Spanish";
  - Captions: nothing is uploaded before the button is pressed; a 20 s webm video goes up as one 16 kHz mono WAV;
    the transcript, .txt, .srt and .vtt are right (two lines of at most 42 characters, ordered timestamps) and
    follow edits; a 10-minute WAV goes up in two parts with lang and translate set, and the second part's
    timestamps are shifted by the first part's length;
  - errors from the server reach the visitor; no page errors anywhere.
Chromium does not pass very large request bodies (the 15 MB parts) to page.route, so the static server answers
those POSTs with the same mock. Screenshots of each tab at 1440x900 and 390x844 go to tests/out/audio-page/.

  python3 tests/audio_page_test.py
"""
import base64, functools, http.server, io, json, math, os, re, socketserver, struct, subprocess, sys, tempfile, threading, wave
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'public')
OUT = os.path.join(HERE, 'out', 'audio-page')
os.makedirs(OUT, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/image', '/video', '/audio', '/3d', '/film', '/office'):
            p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)

    def do_POST(self):
        # Chromium does not hand very large request bodies to page.route, so the same mock also answers here.
        data = self.rfile.read(int(self.headers.get('content-length') or 0))
        path = urlparse(self.path).path
        if path not in ('/api/tts', '/api/transcribe'):
            return self.send_error(404)
        status, headers, body = mock(path, self.path, data, self.headers.get('content-type'), 'server')
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, v)
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
srv.daemon_threads = True
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{port}'

# ---------- test media ----------
tmp = tempfile.mkdtemp(prefix='massless-audio-')
CLIP = os.path.join(tmp, 'interview.webm')
LONG = os.path.join(tmp, 'long-talk.wav')
ff = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y']
# 20 s video with a speech-like tone: a 180 Hz buzz with formant-ish harmonics, chopped into syllables
subprocess.run(ff + ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=20',
                     '-f', 'lavfi', '-i', "aevalsrc='(0.5*sin(2*PI*180*t)+0.3*sin(2*PI*540*t)+0.2*sin(2*PI*1260*t))*(0.5+0.5*sin(2*PI*4*t))*gt(mod(t,3),0.4)':s=48000:d=20",
                     '-ac', '2', '-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libopus', '-shortest', CLIP], check=True)
# 10 minutes of quiet noise with a short tone every 30 s, 8 kHz mono (9.6 MB): becomes 19.2 MB at 16 kHz
subprocess.run(ff + ['-f', 'lavfi', '-i', "aevalsrc='0.01*(random(0)-0.5)+0.3*sin(2*PI*300*t)*lt(mod(t,30),1)':s=8000:d=600",
                     '-c:a', 'pcm_s16le', LONG], check=True)


def make_wav(seconds=1.0, rate=44100, freq=300.0):
    n = int(seconds * rate)
    b = io.BytesIO()
    with wave.open(b, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<h', int(12000 * math.sin(2 * math.pi * freq * i / rate))) for i in range(n)))
    return b.getvalue()


TTS_WAV = make_wav(1.0)


def read_wav(data):
    with wave.open(io.BytesIO(data)) as w:
        return {'channels': w.getnchannels(), 'rate': w.getframerate(), 'width': w.getsampwidth(), 'frames': w.getnframes(),
                'duration': w.getnframes() / w.getframerate()}


SEGS = [
    (0.0, 4.2, ' The road ran straight for ninety miles.'),
    (4.2, 9.8, ' No towns, no signs, just heat on the asphalt and one rider chasing the last of the light.'),
    (10.4, 19.0, ' She stopped at the diner. The coffee was cold, the radio was loud, and nobody asked where she was going. She liked it that way.'),
]


def vtt_for(segs):
    """Word-level WebVTT like the live endpoint: one cue per word, for the first segment only."""
    out = ['WEBVTT', '']
    s, e, text = segs[0]
    words = text.split()
    step = (e - s) / len(words)
    for i, w in enumerate(words):
        a, b = s + i * step, s + (i + 1) * step
        f = lambda t: f'{int(t // 60):02d}:{t % 60:06.3f}'
        out += [f'{f(a)} --> {f(b)}', f' {w}', '']
    return '\n'.join(out)


tts_calls, asr_calls, errors = [], [], []
fail_next_tts = []


def tts_reply(post_data):
    body = json.loads(post_data)
    tts_calls.append(body)
    if fail_next_tts:
        fail_next_tts.pop()
        return 429, {'content-type': 'application/json'}, json.dumps({'error': 'This free tool is resting for today. It resets at midnight UTC.'}).encode()
    assert body['lang'] in ('en', 'es', 'fr', 'zh', 'jp', 'kr'), body
    assert 0 < len(body['text']) < 1000, len(body['text'])
    return 200, {'content-type': 'audio/wav', 'x-massless-model': '@cf/myshell-ai/melotts'}, TTS_WAV


def asr_reply(url, data, ctype, via):
    info = read_wav(data)
    q = parse_qs(urlparse(url).query)
    asr_calls.append({'query': {k: v[0] for k, v in q.items()}, 'bytes': len(data), **info, 'ctype': ctype, 'via': via})
    d = info['duration']
    segs = [s for s in SEGS if s[1] <= d]
    body = {'text': ''.join(s[2] for s in segs).strip(), 'vtt': vtt_for(segs), 'segments': [{'start': a, 'end': b, 'text': t} for a, b, t in segs],
            'language': q.get('lang', ['en'])[0], 'duration': d, 'model': '@cf/openai/whisper-large-v3-turbo'}
    return 200, {'content-type': 'application/json'}, json.dumps(body).encode()


def mock(path, url, data, ctype, via):
    try:
        if path == '/api/tts':
            return tts_reply(data)
        return asr_reply(url, data, ctype, via)
    except Exception as e:  # report and answer, so a failed check never hangs the page
        import traceback
        errors.append(f'mock {path}: {e!r}\n{traceback.format_exc()}')
        return 500, {'content-type': 'application/json'}, json.dumps({'error': f'mock failed: {e!r}'}).encode()


def on_route(route):
    req = route.request
    assert req.method == 'POST'
    status, headers, body = mock(urlparse(req.url).path, req.url, req.post_data_buffer, req.headers.get('content-type'), 'route')
    route.fulfill(status=status, headers=headers, body=body)


def srt_cues(srt):
    cues = []
    for block in srt.strip().split('\n\n'):
        lines = block.split('\n')
        m = re.match(r'(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)$', lines[1])
        assert lines[0].isdigit() and m, block
        g = [int(x) for x in m.groups()]
        cues.append({'start': g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000, 'end': g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000, 'lines': lines[2:]})
    return cues


def check_cues(cues):
    prev = -1
    for c in cues:
        assert 1 <= len(c['lines']) <= 2, c
        assert all(len(l) <= 42 for l in c['lines']), c
        assert c['end'] > c['start'] >= prev - 1e-6, c
        prev = c['end']


def save_download(page, selector):
    with page.expect_download() as dl:
        page.click(selector)
    d = dl.value
    path = os.path.join(tmp, d.suggested_filename)
    d.save_as(path)
    return d.suggested_filename, open(path, encoding='utf-8').read()


def shot(page, name):
    page.wait_for_timeout(250)
    path = os.path.join(OUT, f'{name}.png')
    page.screenshot(path=path)
    print('shot', path)


def watch(page, tag):
    page.on('pageerror', lambda e: errors.append(f'{tag} pageerror: {e}'))
    page.on('console', lambda m: m.type == 'error' and 'favicon' not in m.text and 'status of 429' not in m.text and errors.append(f'{tag} console: {m.text[:200]}'))
    page.route('**/api/tts', on_route)
    page.route('**/api/transcribe', on_route)


LONG_TEXT = ' '.join([
    'La carretera seguía recta durante noventa millas, sin pueblos ni señales, solo el calor sobre el asfalto.',
    'Una motorista perseguía la última luz del día, con el polvo levantándose detrás de ella como una nube dorada.',
] * 9)
assert 1000 < len(LONG_TEXT) < 2000, len(LONG_TEXT)

def main(p):
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    page = ctx.new_page()
    watch(page, 'desktop')
    page.goto(f'{BASE}/audio', wait_until='domcontentloaded')
    page.wait_for_selector('#voices .vcard')
    assert page.locator('#voices .vcard').count() == 8
    assert page.is_hidden('#langs')
    shot(page, 'voice-kokoro-1440')

    # ---------- MeloTTS ----------
    page.click('.engine[data-id="melo"]')
    assert page.is_visible('#langs') and page.is_hidden('#voices')
    assert page.locator('#langs .vcard').count() == 6
    assert page.is_disabled('#speed') and page.is_visible('#speed-note')
    assert page.inner_text('#voices-title').lower() == 'languages'
    page.click('#langs .vcard[data-id="es"]')
    assert 'Spanish' in page.inner_text('#voice-name')
    assert page.inner_text('#voice-avatar') == 'ES'
    page.fill('#script', LONG_TEXT)
    assert not tts_calls, 'nothing should be sent before Generate'
    page.click('#gen-voice')
    page.wait_for_selector('#history .hrow:has-text("MeloTTS · Spanish")', timeout=20000)
    assert len(tts_calls) == 3, [len(c['text']) for c in tts_calls]  # 1,9xx characters of ~107-character sentences
    assert all(c['lang'] == 'es' for c in tts_calls)
    assert all(c['text'].endswith('.') for c in tts_calls), 'chunks should end on a sentence'
    assert ' '.join(c['text'] for c in tts_calls) == LONG_TEXT
    row_sub = page.inner_text('#history .hrow >> nth=0 >> .t span')
    href = page.get_attribute('#history .hrow >> nth=0 >> a', 'href')
    wav_b64 = page.evaluate("""async (u) => { const b = new Uint8Array(await (await fetch(u)).arrayBuffer()); let s=''; for (let i=0;i<b.length;i+=0x8000) s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000)); return btoa(s); }""", href)
    joined = read_wav(base64.b64decode(wav_b64))
    assert joined['rate'] == 44100 and joined['channels'] == 1, joined
    assert 3.3 < joined['duration'] < 3.7, joined  # three 1 s chunks plus two 0.25 s pauses
    print('melo:', [len(c['text']) for c in tts_calls], row_sub, joined)
    page.evaluate("document.querySelector('#history .hrow').scrollIntoView({block: 'center'})")
    page.evaluate('document.querySelector(".stage").scrollTo(0, 0)')
    shot(page, 'voice-melo-1440')

    # the daily cap message reaches the visitor
    fail_next_tts.append(1)
    page.fill('#script', 'Hola.')
    page.click('#gen-voice')
    page.wait_for_selector('#toast.error', timeout=10000)
    assert 'resting for today' in page.inner_text('#toast'), page.inner_text('#toast')
    assert page.locator('#history .hrow').count() == 1

    # ---------- Captions: one part ----------
    page.click('#t-cap')
    assert page.is_visible('#cap-drop') and page.is_hidden('#voices-head') and page.is_hidden('#history')
    assert page.is_disabled('#gen-cap')
    assert 'not stored' in page.inner_text('#tab-cap')
    shot(page, 'captions-empty-1440')
    page.set_input_files('#cap-in', CLIP)
    page.wait_for_function("!document.querySelector('#gen-cap').disabled", timeout=20000)
    assert not asr_calls, 'nothing should be uploaded before Transcribe'
    assert 'interview.webm' in page.inner_text('#cap-drop').lower(), page.inner_text('#cap-drop')
    print('drop:', page.inner_text('#cap-drop-sub'))
    page.click('#gen-cap')
    page.wait_for_selector('#cap-result:not([hidden])', timeout=20000)
    assert len(asr_calls) == 1, asr_calls
    c = asr_calls[0]
    assert c['channels'] == 1 and c['rate'] == 16000 and c['width'] == 2, c
    assert abs(c['duration'] - 20.0) < 0.1, c
    assert c['bytes'] == 44 + c['frames'] * 2 and c['ctype'] == 'audio/wav', c
    assert c['query'] == {}, c
    text = page.input_value('#cap-text')
    assert text.splitlines()[0] == '[00:00.0 → 00:04.2] The road ran straight for ninety miles.', text
    assert len(text.splitlines()) == 3
    name, txt = save_download(page, '#cap-txt')
    assert name == 'interview.txt' and txt.startswith('The road ran straight') and len(txt.strip().splitlines()) == 3, (name, txt)
    name, srt = save_download(page, '#cap-srt')
    cues = srt_cues(srt)
    check_cues(cues)
    assert name == 'interview.srt'
    assert srt.startswith('1\n00:00:00,000 --> 00:00:04,200\nThe road ran straight for ninety miles.'), srt[:120]
    # the long segment is split into sentences
    assert any(cc['lines'] == ['She stopped at the diner.'] for cc in cues), cues
    assert any('She liked it that way.' in ' '.join(cc['lines']) for cc in cues)
    assert abs(cues[-1]['end'] - 19.0) < 0.01, cues[-1]
    name, vtt = save_download(page, '#cap-vtt')
    assert vtt.startswith('WEBVTT\n\n00:00:00.000 --> 00:00:04.200\n'), vtt[:80]
    # edits flow into the captions
    page.fill('#cap-text', text.replace('ninety miles', '90 miles'))
    _, srt2 = save_download(page, '#cap-srt')
    assert 'ran straight for 90 miles.' in srt2 and 'ninety' not in srt2
    assert 'No towns, no signs, just\nheat on the asphalt\n' in srt2 and '\nand one rider chasing\nthe last of the light.\n' in srt2, 'long sentences split evenly'
    print('captions srt:\n' + srt2)
    # languages without spaces: captions and MeloTTS chunks still fit
    cjk = page.evaluate("""async () => {
      const T = await import('/js/transcribe.js');
      const A = await import('/js/audio-engine.js');
      const zh = '我们今天去了很多地方，看了很多风景，吃了很多好吃的东西，也认识了很多新朋友。这是一个非常美好的旅程，我们都很开心，希望明年还能再来一次。';
      const cues = T.buildCues([{ start: 0, end: 20, text: zh }]);
      const chunks = A.splitForMelo(zh.repeat(30));
      return { lines: cues.flatMap((c) => c.lines), n: cues.length, chunks: chunks.map((c) => c.text.length), joined: chunks.map((c) => c.text).join('') === zh.repeat(30) };
    }""")
    assert all(len(l) <= 42 for l in cjk['lines']) and cjk['n'] >= 2, cjk
    assert all(0 < n < 1000 for n in cjk['chunks']) and len(cjk['chunks']) >= 3 and cjk['joined'], cjk
    print('cjk:', cjk['n'], 'cues,', 'melo chunks', cjk['chunks'])
    shot(page, 'captions-result-1440')

    # ---------- Captions: ten minutes in two parts ----------
    page.select_option('#cap-lang', 'es')
    page.check('#cap-translate')
    page.set_input_files('#cap-in', LONG)
    page.wait_for_function("!document.querySelector('#gen-cap').disabled", timeout=60000)
    assert page.locator('#cap-parts .part').count() == 2
    assert len(asr_calls) == 1
    shot(page, 'captions-parts-1440')
    page.click('#gen-cap')
    page.wait_for_function("document.querySelectorAll('#cap-parts .part.done').length === 2", timeout=60000)
    page.wait_for_function("document.querySelector('#cap-text').value.split('\\n').length === 6", timeout=10000)
    long_calls = asr_calls[1:]
    assert len(long_calls) == 2, long_calls
    for lc in long_calls:
        assert lc['query'] == {'lang': 'es', 'task': 'translate'}, lc
        assert lc['rate'] == 16000 and lc['channels'] == 1
        assert lc['bytes'] <= 18e6 and lc['duration'] <= 480, lc
    d1, d2 = long_calls[0]['duration'], long_calls[1]['duration']
    assert abs(d1 + d2 - 600) < 0.05, (d1, d2)
    assert 'Spanish → English' in page.inner_text('#cap-count'), page.inner_text('#cap-count')
    assert page.is_hidden('#cap-go-inline'), 'the inline button is for phones only'
    lines = page.input_value('#cap-text').splitlines()
    m = re.match(r'\[(\d+):(\d+\.\d)', lines[3])
    assert m and abs(int(m.group(1)) * 60 + float(m.group(2)) - d1) < 0.06, (lines[3], d1)
    _, srt3 = save_download(page, '#cap-srt')
    cues3 = srt_cues(srt3)
    check_cues(cues3)
    second = [cc for cc in cues3 if cc['start'] >= d1 - 0.01]
    assert second and abs(second[0]['start'] - d1) < 0.01, (second[:1], d1)
    assert abs(cues3[-1]['end'] - (d1 + 19.0)) < 0.01, cues3[-1]
    print('long parts:', round(d1, 2), round(d2, 2), 'second part starts at', second[0]['start'])
    page.evaluate('document.querySelector(".stage").scrollTo(0, 0)')
    shot(page, 'captions-long-1440')

    page.click('#t-bed')
    shot(page, 'beds-1440')
    page.close()

    # ---------- phone ----------
    m = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, accept_downloads=True, is_mobile=True, has_touch=True)
    pg = m.new_page()
    watch(pg, 'phone')
    pg.goto(f'{BASE}/audio', wait_until='domcontentloaded')
    pg.wait_for_selector('#voices .vcard')
    shot(pg, 'voice-kokoro-390')
    pg.click('.engine[data-id="melo"]')
    pg.evaluate("scrollTo(0, document.querySelector('#engines').getBoundingClientRect().top + scrollY - 380)")
    shot(pg, 'voice-melo-panel-390')
    pg.evaluate('scrollTo(0, 0)')
    pg.click('#t-cap')
    pg.evaluate('scrollTo(0, 0)')
    shot(pg, 'captions-empty-390')
    pg.set_input_files('#cap-in', CLIP)
    pg.wait_for_function("!document.querySelector('#gen-cap').disabled", timeout=20000)
    assert pg.is_visible('#cap-go-inline')
    pg.click('#cap-go-inline')
    pg.wait_for_selector('#cap-result:not([hidden])', timeout=20000)
    pg.evaluate('scrollTo(0, 0)')
    shot(pg, 'captions-result-390')
    pg.evaluate("scrollTo(0, document.querySelector('#tab-cap').getBoundingClientRect().top + scrollY - 120)")
    shot(pg, 'captions-panel-390')
    pg.evaluate('scrollTo(0, 0)')
    pg.click('#t-bed')
    shot(pg, 'beds-390')
    overflow = pg.evaluate('document.documentElement.scrollWidth - innerWidth')
    assert overflow <= 0, f'horizontal overflow {overflow}px on phone'
    b.close()

with sync_playwright() as pw:
    try:
        main(pw)
    finally:
        if errors:
            print('ERRORS:\n' + '\n'.join(errors))

print('tts calls:', len(tts_calls), 'transcribe calls:', len(asr_calls))
if errors:
    sys.exit(1)
print('OK')
