"""Edit by text on the Cut page, in headless Chromium: transcribe (stubbed), strike words, clean up, export.

Serves public/ on a random port and answers /api/transcribe itself with Whisper-style word timings for a synthetic
recording: each "word" is a tone burst with soft edges at its own pitch, so the test can tell from the exported
audio which words survived. The recording has fillers ("um,", "like,", "uh"), a stutter ("I I"), two long pauses
(one holding an unworded sound) and a long tail. The timings sent back are a little off, as Whisper's are, so
cuts must find the quiet points themselves. The MP3 encoder is served from a copy checked against its pinned
SHA-256. Checks:
  - the request carries the verbatim initial prompt and the language; nothing else leaves 127.0.0.1;
  - counts: 3 fillers, 1 repeat, 3 long pauses (the one with sound inside is flagged and left out by default);
  - a clicked word strikes with Delete, Undo and Redo (buttons and Ctrl+Z) restore and redo it;
  - Remove fillers / repeats / Shorten pauses review lists apply what is ticked;
  - the WAV is as long as the page says (within 20 ms), the struck pitches are gone, kept ones and the flagged
    sound remain, and no sample jumps at any cut (second difference far below a click);
  - the MP3 decodes to the same length (within 20 ms); SRT and VTT cues start where their first words land on
    the edited timeline and hold no struck words;
  - playback of the edit moves the current-word highlight; clicking a word seeks there;
  - a webm video is edited and exported as MP4 with the edited length (within one frame) and a sound track;
  - exports land in the local library; no page errors; no horizontal scroll at 390 px;
  - screenshots at 1440x900 and 390x844 in tests/out/cut-edit/.

  python3 tests/cut_edit_test.py
"""
import array, base64, functools, hashlib, http.server, json, math, os, random, re, socketserver, subprocess, tempfile, threading, urllib.parse, urllib.request, wave
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'public')
OUT = os.path.join(HERE, 'out', 'cut-edit')
os.makedirs(OUT, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/cut', '/library'):
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
    assert base64.b64encode(hashlib.sha256(body).digest()).decode() == pin, rel
    CDN_FILES[rel] = (body, 'application/wasm' if rel.endswith('.wasm') else 'application/javascript; charset=utf-8')

tmp = tempfile.mkdtemp(prefix='massless-cut-')
RATE = 44100
DUR = 12.0
# (text, start, end, pitch Hz): the true positions in the recording
WORDS = [
    (' So', 0.50, 0.80, 300), (' um,', 1.00, 1.40, 180), (' I', 1.60, 1.80, 320), (' I', 1.90, 2.10, 320),
    (' think', 2.25, 2.65, 360), (' this', 2.80, 3.10, 400), (' works.', 3.25, 3.75, 420),
    (' It', 5.75, 6.00, 440), (' was,', 6.10, 6.45, 460), (' like,', 6.75, 7.05, 250), (' huge.', 7.30, 7.80, 480),
    (' uh', 9.80, 10.10, 170), (' the', 10.30, 10.50, 500), (' end.', 10.65, 11.20, 520),
]
SOUND = (8.60, 8.90, 210)  # an unworded sound inside the second long pause
SEGS = [(0, 7), (7, 11), (11, 14)]


def burst(buf, a, b, f, amp=0.3):
    edge = 0.012
    for i in range(int(a * RATE), int(b * RATE)):
        t = i / RATE
        e = min(1.0, (t - a) / edge, (b - t) / edge)
        e = 0.5 - 0.5 * math.cos(math.pi * max(0.0, e))
        buf[i] += amp * e * math.sin(2 * math.pi * f * t)


rng = random.Random(3)
sig = [2e-4 * (rng.random() * 2 - 1) for _ in range(int(DUR * RATE))]
for _, a, b, f in WORDS:
    burst(sig, a, b, f)
burst(sig, SOUND[0], SOUND[1], SOUND[2], 0.2)
AUDIO = os.path.join(tmp, 'talk.wav')
with wave.open(AUDIO, 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(array.array('h', [max(-32768, min(32767, int(round(x * 32767)))) for x in sig]).tobytes())
VIDEO = os.path.join(tmp, 'talk.webm')
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=12', '-i', AUDIO,
                '-c:v', 'libvpx', '-b:v', '600k', '-g', '30', '-c:a', 'libopus', '-b:a', '96k', '-shortest', VIDEO], check=True)


def whisper(offset=0.0):
    """What the stub transcriber answers: word timings a little off, as Whisper's are."""
    jitter = [0.03, -0.02, 0.0, 0.02, -0.03, 0.01, 0.02, -0.01, 0.03, -0.02, 0.0, 0.02, -0.02, 0.01]
    segs = []
    for a, b in SEGS:
        ws = [{'word': t, 'start': round(s + jitter[k] + offset, 3), 'end': round(e - jitter[k] / 2 + offset, 3)} for k, (t, s, e, _) in enumerate(WORDS) if a <= k < b]
        segs.append({'start': ws[0]['start'], 'end': ws[-1]['end'], 'text': ''.join(x['word'] for x in ws).strip(), 'words': ws, 'avg_logprob': -0.3 if a else -1.4, 'no_speech_prob': 0.01})
    return {'text': ' '.join(s['text'] for s in segs), 'vtt': '', 'segments': segs, 'language': 'en', 'duration': DUR, 'model': '@cf/openai/whisper-large-v3-turbo'}


def read_wav(path):
    with wave.open(path) as w:
        n, ch, width, rate = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = array.array('h', w.readframes(n))
    return [raw[i] / 32768 for i in range(0, len(raw), ch)], rate


def decode(path):
    raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', path, '-ac', '1', '-f', 's16le', '-acodec', 'pcm_s16le', '-'], capture_output=True, check=True).stdout
    a = array.array('h', raw)
    return [x / 32768 for x in a]


def goertzel(x, rate, f):
    w = 2 * math.pi * f / rate
    c = 2 * math.cos(w)
    s1 = s2 = 0.0
    for v in x:
        s0 = v + c * s1 - s2
        s2, s1 = s1, s0
    return math.sqrt(max(0.0, s1 * s1 + s2 * s2 - c * s1 * s2)) / max(1, len(x))


errors, requests, asr_calls = [], [], []


def watch(page, tag):
    page.on('pageerror', lambda e: errors.append(f'{tag} pageerror: {e}'))
    page.on('console', lambda m: m.type == 'error' and 'favicon' not in m.text and errors.append(f'{tag} console: {m.text[:200]}'))


def on_cdn(route):
    rel = route.request.url[len(CDN):]
    if rel not in CDN_FILES:
        return route.fulfill(status=404, body='not pinned')
    body, ctype = CDN_FILES[rel]
    route.fulfill(status=200, body=body, headers={'content-type': ctype, 'access-control-allow-origin': '*'})


def on_asr(route):
    q = urllib.parse.parse_qs(urllib.parse.urlparse(route.request.url).query)
    asr_calls.append(q)
    route.fulfill(status=200, body=json.dumps(whisper()), headers={'content-type': 'application/json'})


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


def idle(page, timeout=180000):
    page.wait_for_function('() => !document.querySelector("#te-mp3").disabled', timeout=timeout)


def count(page, tool):
    return int(page.inner_text(f'#te-{tool} output'))


def word(page, i):
    return f'#te-words .w[data-i="{i}"]'


with sync_playwright() as p:
    b = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    ctx.on('request', lambda r: requests.append(r.url))
    ctx.route(CDN + '**', on_cdn)
    ctx.route('**/api/transcribe**', on_asr)
    page = ctx.new_page()
    watch(page, 'desktop')
    page.goto(f'{BASE}/cut/')
    page.wait_for_function('() => /Ready/.test(document.querySelector("#status").textContent)', timeout=30000)
    page.set_input_files('#file', AUDIO)
    page.wait_for_function('() => /Ready\\. Transcribe/.test(document.querySelector("#status").textContent)', timeout=30000)
    assert page.eval_on_selector('.stage', 'e => e.classList.contains("audio-only")')
    assert 'Only the sound' in page.inner_text('#te-privacy')
    page.select_option('#te-lang', 'en')
    page.click('#te-go')
    page.wait_for_selector('#te:not([hidden])', timeout=60000)
    assert len(asr_calls) == 1 and asr_calls[0]['lang'] == ['en'], asr_calls
    assert 'um' in asr_calls[0]['prompt'][0].lower() and 'uh' in asr_calls[0]['prompt'][0].lower(), asr_calls
    assert page.locator('#te-words .w').count() == len(WORDS)
    assert page.locator('#te-words .w.filler').count() == 3
    assert page.locator('#te-words .w.low').count() == 7, 'the unsure first segment is marked'
    assert (count(page, 'fillers'), count(page, 'repeats'), count(page, 'pauses')) == (3, 1, 3), (count(page, 'fillers'), count(page, 'repeats'), count(page, 'pauses'))
    full = page.evaluate('() => massless.edit.length()')
    assert abs(full - DUR) < 0.01, full

    # strike, undo, redo
    page.click(word(page, 5))
    page.keyboard.press('Delete')
    assert 'struck' in page.get_attribute(word(page, 5), 'class')
    cut1 = page.evaluate('() => massless.edit.length()')
    assert cut1 < DUR - 0.2, cut1
    page.click('#te-undo')
    assert 'struck' not in page.get_attribute(word(page, 5), 'class')
    page.click('#te-redo')
    assert 'struck' in page.get_attribute(word(page, 5), 'class')
    page.keyboard.press('Control+z')
    assert 'struck' not in page.get_attribute(word(page, 5), 'class')
    page.keyboard.press('Control+Shift+z')
    assert 'struck' in page.get_attribute(word(page, 5), 'class')
    page.keyboard.press('Control+z')
    assert abs(page.evaluate('() => massless.edit.length()') - DUR) < 0.01

    # keyboard selection
    page.focus('#te-words')
    page.keyboard.press('Home')
    page.keyboard.press('Shift+ArrowRight')
    assert page.evaluate('() => massless.edit.S.sel') == {'a': 0, 'b': 1}
    page.keyboard.press('Escape')
    assert page.evaluate('() => massless.edit.S.sel') is None

    # clean-up tools with review
    page.click('#te-fillers')
    page.wait_for_selector('#te-review:not([hidden])')
    assert page.locator('#te-review-list li').count() == 3
    assert page.locator('#te-review-list input:checked').count() == 3, 'none of these fillers is glued to a word'
    shot(page, 'review-1440')
    page.click('#te-review-apply')
    page.click('#te-repeats')
    assert page.locator('#te-review-list li').count() == 1
    page.click('#te-review-apply')
    page.click('#te-pauses')
    assert page.locator('#te-review-list li').count() == 3
    assert page.locator('#te-review-list input:checked').count() == 2, 'the pause with a sound in it is left out'
    assert 'sound inside' in page.inner_text('#te-review-list')
    page.click('#te-review-apply')
    assert (count(page, 'fillers'), count(page, 'repeats'), count(page, 'pauses')) == (0, 0, 1)
    struck = page.evaluate('() => [...massless.edit.S.state.struck].sort((a, b) => a - b)')
    assert struck == [1, 2, 9, 11], struck
    new_len = page.evaluate('() => massless.edit.length()')
    keep = page.evaluate('() => massless.edit.keep()')
    print('edited length', round(new_len, 3), 'keep', [[round(a, 3), round(b, 3)] for a, b in keep])
    # independent estimate: each struck run goes with the silences around it except the longer of the two that
    # touch the kept words; capped pauses keep 0.5 s. "So" 0.8 .. "I" 1.9 keeps 0.2 s; "was," 6.45 .. "huge." 7.3
    # keeps 0.3 s; "huge." 7.8 .. "the" 10.3 keeps the 2 s pause with the sound in it; the 2 s pause and the 0.8 s
    # tail keep 0.5 s each.
    est = DUR - (1.1 - 0.2) - (0.85 - 0.3) - (2.5 - 2.0) - (2.0 - 0.5) - (0.8 - 0.5)
    assert abs(new_len - est) < 0.35, (new_len, est)
    assert 'new length' in page.inner_text('#te-summary')

    # playback with the current-word highlight, and click to seek
    page.click('#te-play')
    page.wait_for_function('() => (massless.edit.playing()?.pos || 0) > 0.6', timeout=10000)
    page.wait_for_selector('#te-words .w.now', timeout=5000)
    page.click(word(page, 12))
    pos = page.evaluate('() => massless.edit.playing().pos')
    want = page.evaluate('async () => { const E = await import("/js/textedit.js"); return E.srcToOut(massless.edit.S.words[12].s, massless.edit.keep()); }')
    assert abs(pos - want) < 0.3, (pos, want)
    shot(page, 'playing-1440')
    page.click('#te-play')
    assert page.evaluate('() => massless.edit.playing()') is None

    # WAV
    name, path = save_download(page, '#te-wav')
    idle(page)
    assert name == 'talk (edited).wav', name
    x, rate = read_wav(path)
    got = len(x) / rate
    print('wav', round(got, 4), 'page', round(new_len, 4))
    assert abs(got - new_len) <= 0.02, (got, new_len)
    gone = {f: goertzel(x, rate, f) for f in (180, 250, 170)}
    kept = {f: goertzel(x, rate, f) for f in (300, 360, 400, 520, 210)}
    print('gone', {k: round(v, 5) for k, v in gone.items()}, 'kept', {k: round(v, 5) for k, v in kept.items()})
    assert max(gone.values()) < 0.05 * min(kept.values()), (gone, kept)
    d2 = max(abs(x[i] - 2 * x[i - 1] + x[i - 2]) for i in range(2, len(x)))
    assert d2 < 0.03, f'a click: second difference {d2}'
    # MP3
    name, path = save_download(page, '#te-mp3')
    idle(page)
    y = decode(path)
    print('mp3', round(len(y) / RATE, 4))
    assert abs(len(y) / RATE - new_len) <= 0.02, (len(y) / RATE, new_len)
    # captions on the edited timeline
    for kind in ('srt', 'vtt'):
        name, path = save_download(page, f'#te-{kind}')
        text = open(path, encoding='utf-8').read()
        assert not re.search(r'\b(um|uh|like),?\b', text), text
        stamps = re.findall(r'(\d\d):(\d\d):(\d\d)[,.](\d\d\d) --> (\d\d):(\d\d):(\d\d)[,.](\d\d\d)', text)
        starts = [int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000 for h, m, s, ms, *_ in stamps]
        ends = [int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000 for *_, h, m, s, ms in stamps]
        firsts = page.evaluate('''async () => { const E = await import("/js/textedit.js"); const T = await import("/js/transcribe.js");
          const st = massless.edit.S.state; const k = massless.edit.keep();
          return T.buildCues(E.editedSegments(massless.edit.S.words, k, st)).map((c) => c.start); }''')
        assert len(starts) == len(firsts) >= 3, (starts, firsts)
        assert all(abs(a - b) <= 0.0015 for a, b in zip(starts, firsts)), (starts, firsts)
        it_was = page.evaluate('async () => { const E = await import("/js/textedit.js"); return E.srcToOut(massless.edit.S.words[7].s, massless.edit.keep()); }')
        assert any(abs(s - it_was) < 0.002 for s in starts), (starts, it_was)
        assert max(ends) <= new_len + 0.001, (ends, new_len)
        if kind == 'vtt':
            assert text.startswith('WEBVTT')
    name, path = save_download(page, '#te-edl')
    edl = open(path).read()
    assert edl.startswith('TITLE:') and edl.count('* FROM CLIP NAME: talk.wav') == len(keep), edl

    saved = page.evaluate("""async () => { const s = await import('/js/store.js'); return (await s.all()).filter((x) => x.engine === 'local-text-edit').map((x) => x.name); }""")
    assert 'talk (edited).wav' in saved and 'talk (edited).mp3' in saved, saved

    over = page.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
    assert over <= 0, over
    page.evaluate('() => document.querySelector("#te").scrollIntoView()')
    shot(page, 'edited-1440')

    # phone
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(300)
    over = page.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
    assert over <= 0, f'horizontal overflow {over}px at 390'
    page.evaluate('() => document.querySelector("#te").scrollIntoView()')
    shot(page, 'edited-390')
    page.evaluate('() => document.querySelector(".te-side").scrollIntoView()')
    shot(page, 'controls-390')
    page.set_viewport_size({'width': 1440, 'height': 900})

    # video: the same talk with a picture
    page.set_input_files('#file', VIDEO)
    page.wait_for_function('() => /Ready\\. Transcribe to edit by text/.test(document.querySelector("#status").textContent)', timeout=30000)
    assert page.is_visible('#source') and page.is_visible('#caption-canvas')
    page.click('#te-go')
    page.wait_for_selector('#te-video:not([hidden])')
    page.wait_for_function('() => massless.edit.S.words.length === 14', timeout=60000)
    page.click('#te-fillers')
    page.click('#te-review-apply')
    page.click('#te-pauses')
    page.click('#te-review-apply')
    vlen = page.evaluate('() => massless.edit.length()')
    name, path = save_download(page, '#te-video', timeout=240000)
    idle(page, 240000)
    assert name == 'talk (edited).mp4', name
    info = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], capture_output=True, text=True, check=True).stdout)
    kinds = {s['codec_type']: s for s in info['streams']}
    assert 'video' in kinds and 'audio' in kinds, kinds.keys()
    vdur = float(kinds['video']['duration'])
    print('mp4 video', vdur, 'audio', kinds['audio']['codec_name'], kinds['audio'].get('duration'), 'edit', round(vlen, 3))
    assert abs(vdur - vlen) <= 1 / 30 + 0.02, (vdur, vlen)
    adur = float(kinds['audio'].get('duration') or info['format']['duration'])
    assert abs(adur - vlen) <= 0.05, (adur, vlen)
    # captions are burned in: the caption box darkens the lower band of a frame where a cue shows
    def gray(path, t):
        raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-ss', str(t), '-i', path, '-frames:v', '1', '-vf', 'scale=320:180', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True, check=True).stdout
        return raw
    def band_dark(raw):
        px = [raw[y * 320 + x] for y in range(132, 156) for x in range(24, 296)]
        return sum(1 for v in px if v < 45) / len(px), sum(1 for v in px if v > 215) / len(px)
    t_src = page.evaluate('async () => { const E = await import("/js/textedit.js"); return E.outToSrc(1.0, massless.edit.keep()); }')
    with_cap, without = band_dark(gray(path, 1.0)), band_dark(gray(VIDEO, t_src))
    print('caption band (dark, white): edited', with_cap, 'source', without)
    assert with_cap[0] > without[0] + 0.3 and with_cap[1] > 0.01, (with_cap, without)
    shot(page, 'video-1440')
    b.close()

outside = [u for u in requests if not u.startswith(BASE) and not u.startswith(CDN) and not u.startswith('blob:' + BASE)]
assert not outside, outside
assert not errors, errors
print('cut edit: ok')
