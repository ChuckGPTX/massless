"""Extract audio check in headless Chromium: files in, MP3 / M4A / WAV out, all in the browser.

Serves public/ on a random port (with /audio -> /audio/index.html). The MP3 encoder (wasm-media-encoders 0.7.0 on
jsDelivr) is fetched once by this script, checked against the SHA-256 pinned in public/js/extract-worker.js, and
served to the page from that copy, so the run is repeatable. Test media come from ffmpeg: a 20 s mp4 (H.264 + AAC
stereo, a left tone that steps 440 -> 550 -> 660 -> 770 Hz every 5 s over a steady 330 Hz right tone), a quiet 3 s
44.1 kHz wav with loud clicks, MP3/MOV/M4A/24-bit WAV variants for the decoder comparison, a 10-minute AAC file for
the speed check, a video with no sound track and a corrupt mp4. Checks:
  - no request leaves 127.0.0.1 except the two pinned encoder files, and those only once a file is added;
  - the streaming decoders (WebCodecs for MP4/MOV/M4A and MP3, PCM for WAV) give exactly what the browser's
    decodeAudioData gives, sample for sample, without reading the whole file;
  - MP3 192 kbps: right codec, rate, bitrate, stereo kept (left and right tones), length 20.0 s (the LAME tag
    makes decoders trim the encoder delay exactly);
  - trim (by dragging the waveform and typing times) and 2 s fades, as 16-bit WAV: header fields, exact length,
    the trimmed tones and the fade envelope;
  - Even out loudness on a queue of two files: both land at -14 LUFS (+/- 0.7, ffmpeg ebur128) with sample peaks at
    or under -1 dBFS; Download all saves both, named after the originals;
  - M4A: AAC when this browser can encode it; otherwise the card says so and the same mp4 muxing path is checked with
    Opus; mono MP3 at 128 kbps; a 16-bit WAV with nothing to do comes back sample for sample;
  - the corrupt file, a video with no sound track and a text file get readable errors; a file dropped on the stage
    joins the list; the selection plays as a preview; encode speed for 10 minutes to MP3 192 kbps;
  - screenshots at 1440x900 and 390x844 in tests/out/extract-audio/, no horizontal overflow, no page errors.

  python3 tests/extract_audio_test.py
"""
import array, base64, functools, hashlib, http.server, json, math, os, re, socketserver, struct, subprocess, sys, tempfile, threading, time, urllib.request, wave
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'public')
OUT = os.path.join(HERE, 'out', 'extract-audio')
os.makedirs(OUT, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.startswith('/__media/'):  # the generated test media, for the decoder comparison
            return os.path.join(tmp, os.path.basename(p))
        if p.rstrip('/') in ('/image', '/video', '/audio', '/3d', '/film', '/office'):
            p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)

    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}'

# ---------- the pinned encoder ----------
worker_src = open(os.path.join(ROOT, 'js', 'extract-worker.js'), encoding='utf-8').read()
CDN = re.search(r"LAME_BASE = '([^']+)'", worker_src).group(1)
assert re.match(r'^https://cdn\.jsdelivr\.net/npm/wasm-media-encoders@\d+\.\d+\.\d+/$', CDN), CDN
PINS = dict(re.findall(r"url: `\$\{LAME_BASE\}([^`]+)`, sha256: '([^']+)'", worker_src))
assert set(PINS) == {'dist/umd/WasmMediaEncoder.min.js', 'wasm/mp3.wasm'}, PINS
CDN_FILES = {}
for rel, pin in PINS.items():
    body = urllib.request.urlopen(CDN + rel, timeout=60).read()
    got = base64.b64encode(hashlib.sha256(body).digest()).decode()
    assert got == pin, f'{rel}: jsDelivr serves {got}, the worker pins {pin}'
    CDN_FILES[rel] = (body, 'application/wasm' if rel.endswith('.wasm') else 'application/javascript; charset=utf-8')
print('encoder pinned:', CDN, {k: len(v[0]) for k, v in CDN_FILES.items()})

# ---------- test media ----------
tmp = tempfile.mkdtemp(prefix='massless-extract-')
CLIP = os.path.join(tmp, 'interview.mp4')
TONE = os.path.join(tmp, 'tone.wav')
LONG = os.path.join(tmp, 'ten-minutes.m4a')
BROKEN = os.path.join(tmp, 'broken.mp4')
SILENT = os.path.join(tmp, 'silent-film.mp4')
NOTES = os.path.join(tmp, 'notes.txt')
VARIANTS = ['podcast.mp3', 'podcast-id3.mp3', 'podcast-vbr.mp3', 'clip.mov', 'mono.m4a', 'deep.wav']
ff = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y']
subprocess.run(ff + ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=20',
                     '-f', 'lavfi', '-i', "aevalsrc='0.25*sin(2*PI*(440+110*floor(t/5))*t)|0.25*sin(2*PI*330*t)':s=48000:d=20",
                     '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', CLIP], check=True)
subprocess.run(ff + ['-f', 'lavfi', '-i', "aevalsrc='0.03*sin(2*PI*500*t)+0.6*sin(2*PI*2000*t)*lt(mod(t,0.5),0.006)|0.03*sin(2*PI*600*t)':s=44100:d=3",
                     '-c:a', 'pcm_s16le', TONE], check=True)
subprocess.run(ff + ['-f', 'lavfi', '-i', "aevalsrc='0.2*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.5*t))+0.05*(random(0)-0.5)|0.2*sin(2*PI*330*t)+0.05*(random(1)-0.5)':s=44100:d=600",
                     '-c:a', 'aac', '-b:a', '128k', LONG], check=True)
subprocess.run(ff + ['-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=5:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', SILENT], check=True)
with open(BROKEN, 'wb') as f:
    f.write(b'\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2' + os.urandom(64 * 1024))
with open(NOTES, 'w') as f:
    f.write('not audio')
SWEEP = "aevalsrc='0.3*sin(2*PI*(300+200*t)*t)|0.25*sin(2*PI*(500-60*t)*t)':s=44100:d=4.3"
subprocess.run(ff + ['-f', 'lavfi', '-i', SWEEP, '-c:a', 'libmp3lame', '-b:a', '128k', os.path.join(tmp, 'podcast.mp3')], check=True)
subprocess.run(ff + ['-i', os.path.join(tmp, 'podcast.mp3'), '-c', 'copy', '-metadata', 'title=Episode 1', os.path.join(tmp, 'podcast-id3.mp3')], check=True)
subprocess.run(ff + ['-f', 'lavfi', '-i', SWEEP, '-c:a', 'libmp3lame', '-q:a', '2', os.path.join(tmp, 'podcast-vbr.mp3')], check=True)
subprocess.run(ff + ['-i', CLIP, '-c', 'copy', '-movflags', '+faststart', os.path.join(tmp, 'clip.mov')], check=True)
subprocess.run(ff + ['-f', 'lavfi', '-i', SWEEP, '-ac', '1', '-c:a', 'aac', os.path.join(tmp, 'mono.m4a')], check=True)
subprocess.run(ff + ['-f', 'lavfi', '-i', SWEEP, '-c:a', 'pcm_s24le', os.path.join(tmp, 'deep.wav')], check=True)


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration,bit_rate,format_name:stream=codec_name,codec_type,sample_rate,channels,bit_rate',
                          '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    d = json.loads(out)
    a = [s for s in d['streams'] if s['codec_type'] == 'audio'][0]
    return {'format': d['format']['format_name'], 'duration': float(d['format']['duration']), 'bit_rate': int(d['format'].get('bit_rate') or 0),
            'codec': a['codec_name'], 'rate': int(a['sample_rate']), 'channels': int(a['channels'])}


def pcm(path, channels):
    """Decode with ffmpeg (which honours the LAME delay and padding) to interleaved float32."""
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', str(channels), '-'], capture_output=True, check=True).stdout
    x = array.array('f')
    x.frombytes(raw)
    return x


def chan(x, n, c):
    return x[c::n]


def rms(x, a, b):
    seg = x[a:b]
    return math.sqrt(sum(v * v for v in seg) / max(1, len(seg)))


def freq(x, a, b, rate):
    """Tone frequency from zero crossings."""
    seg = x[a:b]
    z = sum(1 for i in range(1, len(seg)) if (seg[i - 1] < 0) != (seg[i] < 0))
    return z / 2 / ((b - a) / rate)


def loudness(path):
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-filter_complex', 'ebur128=peak=sample+true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    summary = err[err.rfind('Summary:'):]
    lufs = float(re.search(r'I:\s+(-?[\d.]+) LUFS', summary).group(1))
    sample = float(re.search(r'Sample peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS', summary).group(1))
    true = float(re.search(r'True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS', summary).group(1))
    return lufs, sample, true


errors, requests = [], []


def watch(page, tag):
    page.on('pageerror', lambda e: errors.append(f'{tag} pageerror: {e}'))
    page.on('console', lambda m: m.type == 'error' and 'favicon' not in m.text and errors.append(f'{tag} console: {m.text[:200]}'))


def on_cdn(route):
    rel = route.request.url[len(CDN):]
    if rel not in CDN_FILES:
        return route.fulfill(status=404, body='not pinned')
    body, ctype = CDN_FILES[rel]
    route.fulfill(status=200, body=body, headers={'content-type': ctype, 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000, immutable'})


def new_context(b, **kw):
    ctx = b.new_context(accept_downloads=True, **kw)
    ctx.on('request', lambda r: requests.append(r.url))
    ctx.route(CDN + '**', on_cdn)
    return ctx


def shot(page, name):
    page.wait_for_timeout(300)
    path = os.path.join(OUT, f'{name}.png')
    page.screenshot(path=path)
    print('shot', path)


def save_download(page, selector):
    with page.expect_download() as dl:
        page.click(selector)
    d = dl.value
    path = os.path.join(tmp, d.suggested_filename)
    d.save_as(path)
    return d.suggested_filename, path


def blob_to_file(page, expr, name):
    """Save a Blob the page holds (expr evaluates to it) and return the path."""
    b64 = page.evaluate("""async (expr) => { const blob = await (0, eval)(expr); const b = new Uint8Array(await blob.arrayBuffer()); let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }""", expr)
    path = os.path.join(tmp, name)
    open(path, 'wb').write(base64.b64decode(b64))
    return path


def card(page, name):
    return f'.xcard:has(.xc-head strong:text-is("{name}"))'


def wait_done(page, name, timeout=60000):
    page.wait_for_selector(f'{card(page, name)}.done', timeout=timeout)


def set_range(page, sel, value):
    page.eval_on_selector(sel, '(e, v) => { e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }', str(value))


def no_overflow(page, tag):
    o = page.evaluate('document.documentElement.scrollWidth - innerWidth')
    assert o <= 0, f'{tag}: horizontal overflow {o}px'
    s = page.evaluate("(() => { const s = document.querySelector('.stage'); return s.scrollWidth - s.clientWidth; })()")
    assert s <= 0, f'{tag}: the stage scrolls sideways by {s}px'


def main(p):
    b = p.chromium.launch()
    ctx = new_context(b, viewport={'width': 1440, 'height': 900})
    page = ctx.new_page()
    watch(page, 'desktop')
    page.goto(f'{BASE}/audio?tab=extract', wait_until='domcontentloaded')
    page.wait_for_selector('#ext-view:not([hidden])')
    assert page.get_attribute('#t-ext', 'aria-selected') == 'true'
    assert page.is_visible('#ext-drop') and page.is_hidden('#history-view') and page.is_hidden('#voice-view-cards')
    assert 'you have the rights to' in page.inner_text('#ext-view') and 'YouTube Studio' in page.inner_text('#ext-view')
    assert page.is_disabled('#gen-ext')
    # all four side tabs fit the panel
    fit = page.evaluate("(() => { const s = document.querySelector('.side').getBoundingClientRect(); return [...document.querySelectorAll('.side-tabs button')].map((b) => s.right - b.getBoundingClientRect().right); })()")
    assert min(fit) >= 0, f'side tabs overflow the panel: {fit}'
    # the Tips dialog keeps the rights note; the Credits page names the encoder and its license
    assert 'YouTube Studio' in page.text_content('#how') and 'LAME' not in page.text_content('#how')
    credits = open(os.path.join(ROOT, 'credits.html')).read()
    assert 'LAME 3.100' in credits and 'wasm-media-encoders' in credits and 'LGPL' in credits
    assert 'Audio' in page.title()
    page.wait_for_function('massless.ext.aac !== null', timeout=10000)
    aac = page.evaluate('massless.ext.aac')
    print('aac bitrates in this browser:', aac)
    assert not [u for u in requests if u.startswith('https://')], 'nothing should be fetched before a file is added'
    shot(page, 'extract-empty-1440')

    # ---------- the streaming decoders match decodeAudioData ----------
    for n in ['interview.mp4', 'tone.wav'] + VARIANTS:
        r = page.evaluate("""async (n) => {
          const X = massless.extract;
          const file = new File([await (await fetch('/__media/' + n)).blob()], n);
          const info = await X.probe(file);
          const rate = X.workRate(info.sampleRate, 'wav');
          const a = await X.decode(file, rate);
          const b = await new OfflineAudioContext(1, 1, rate).decodeAudioData(await file.arrayBuffer());
          let diff = 0;
          for (let c = 0; c < b.numberOfChannels; c++) {
            const A = a.getChannelData(c), B = b.getChannelData(c);
            for (let i = 0; i < Math.min(A.length, B.length); i++) diff = Math.max(diff, Math.abs(A[i] - B[i]));
          }
          return { streamed: a.constructor.name !== 'AudioBuffer', rate, len: [a.length, b.length], ch: [a.numberOfChannels, b.numberOfChannels], diff };
        }""", n)
        print('decode', n, r)
        assert r['streamed'] and r['len'][0] == r['len'][1] and r['ch'][0] == r['ch'][1] and r['diff'] < 1e-6, (n, r)

    # ---------- MP3 192 kbps, stereo kept ----------
    page.set_input_files('#ext-in', CLIP)
    page.wait_for_selector(f'{card(page, "interview.mp4")}:not(.reading)', timeout=30000)
    meta = page.inner_text(f'{card(page, "interview.mp4")} .xc-meta')
    assert meta.startswith('00:20.0') and 'Stereo' in meta and '48 kHz' in meta, meta
    assert page.text_content('#gen-ext-label') == 'Convert' and page.is_enabled('#gen-ext')
    assert page.get_attribute('#ext-kbps [aria-checked="true"]', 'data-kbps') == '192'
    t0 = time.time()
    page.click('#gen-ext')
    wait_done(page, 'interview.mp4')
    print(f'mp3: 20 s in {time.time() - t0:.1f} s (includes loading the encoder)')
    name, path = save_download(page, f'{card(page, "interview.mp4")} .xc-dl')
    assert name == 'interview.mp3', name
    info = probe(path)
    print('mp3:', info)
    assert info['codec'] == 'mp3' and info['rate'] == 48000 and info['channels'] == 2, info
    assert abs(info['bit_rate'] - 192000) < 2000, info
    assert abs(info['duration'] - 20.0) <= 0.1, info
    x = pcm(path, 2)
    L, R = chan(x, 2, 0), chan(x, 2, 1)
    assert abs(len(L) / 48000 - 20.0) < 0.005, len(L) / 48000  # the LAME tag trims the encoder delay and padding
    fl, fr = freq(L, 48000, 96000, 48000), freq(R, 48000, 96000, 48000)
    assert abs(fl - 440) < 8 and abs(fr - 330) < 8, (fl, fr)
    assert abs(freq(L, 17 * 48000, 18 * 48000, 48000) - 770) < 8
    print(f'mp3 decodes to {len(L) / 48000:.4f} s; left {fl:.0f} Hz, right {fr:.0f} Hz')
    # the selection plays as a preview, with a playhead
    c = card(page, 'interview.mp4')
    page.click(f'{c} .xc-row .vplay')
    page.wait_for_selector(f'{c} .xc-ph:not([hidden])', timeout=10000)
    page.wait_for_function("parseFloat(document.querySelector('.xc-ph').style.left) > 0", timeout=10000)
    page.click(f'{c} .xc-row .vplay')
    page.wait_for_selector(f'{c} .xc-ph', state='hidden', timeout=5000)

    # ---------- trim + fades, as WAV ----------
    page.click('.engine[data-fmt="wav"]')
    assert page.inner_text('#o-ext-q') == '16-bit PCM'
    # the format cards and the voice engine cards are separate radio groups
    assert page.get_attribute('.engine[data-fmt="wav"]', 'aria-checked') == 'true' and page.locator('#ext-fmts [aria-checked="true"]').count() == 1
    assert page.get_attribute('.engine[data-id="kokoro"]', 'aria-checked') == 'true' and page.locator('#engines [aria-checked="true"]').count() == 1
    assert page.text_content('#gen-ext-label') == 'Convert'  # a new format makes the file need converting again
    c = card(page, 'interview.mp4')
    # drag the start handle to a quarter of the way in
    box = page.locator(f'{c} .xc-wave').bounding_box()
    page.mouse.move(box['x'] + 2, box['y'] + box['height'] / 2)
    page.mouse.down()
    page.mouse.move(box['x'] + box['width'] * 0.15, box['y'] + box['height'] / 2, steps=4)
    page.mouse.move(box['x'] + box['width'] * 0.25, box['y'] + box['height'] / 2, steps=4)
    page.mouse.up()
    start = page.input_value(f'{c} .xc-time:nth-of-type(1) .xt')
    assert start == '00:05.0', start
    page.fill(f'{c} .xc-time:nth-of-type(2) .xt', '15')
    page.press(f'{c} .xc-time:nth-of-type(2) .xt', 'Enter')
    assert page.inner_text(f'{c} .xc-len') == '00:10.0', page.inner_text(f'{c} .xc-len')
    # the keyboard moves a handle by 0.1 s
    page.focus(f'{c} .xc-h.end')
    page.keyboard.press('ArrowRight')
    page.keyboard.press('ArrowLeft')
    assert page.get_attribute(f'{c} .xc-h.end', 'aria-valuenow') == '15.0'
    set_range(page, '#ext-fi', 2)
    set_range(page, '#ext-fo', 2)
    assert page.inner_text('#o-ext-fi') == '2 s'
    shot(page, 'extract-trim-1440')
    page.click('#gen-ext')
    wait_done(page, 'interview.mp4')
    name, path = save_download(page, f'{c} .xc-dl')
    assert name == 'interview.wav', name
    data = open(path, 'rb').read()
    hdr = struct.unpack('<4sI4s4sIHHIIHH4sI', data[:44])
    assert hdr[0] == b'RIFF' and hdr[1] == len(data) - 8 and hdr[2] == b'WAVE' and hdr[3] == b'fmt ' and hdr[4] == 16, hdr
    assert hdr[5] == 1 and hdr[6] == 2 and hdr[7] == 48000 and hdr[8] == 48000 * 4 and hdr[9] == 4 and hdr[10] == 16, hdr
    assert hdr[11] == b'data' and hdr[12] == len(data) - 44, hdr
    frames = hdr[12] // 4
    assert frames == 480000, frames  # exactly 10.000 s
    with wave.open(path) as w:
        raw = w.readframes(w.getnframes())
    s16 = array.array('h')
    s16.frombytes(raw)
    L = [v / 32768 for v in s16[0::2]]
    steady = rms(L, 4 * 48000, 6 * 48000)
    head, ramp, tail = rms(L, 0, 4800), rms(L, 48000, 52800), rms(L, frames - 4800, frames)
    print(f'wav: steady {steady:.3f}, first 0.1 s {head:.4f}, at 1 s {ramp:.3f}, last 0.1 s {tail:.4f}')
    assert abs(steady - 0.25 / math.sqrt(2)) < 0.01, steady
    assert head < 0.02 * steady and tail < 0.02 * steady, (head, tail)
    assert 0.35 * steady < ramp < 0.65 * steady, ramp  # halfway through a 2 s fade
    f1, f2 = freq(L, int(2.5 * 48000), 3 * 48000, 48000), freq(L, 7 * 48000, int(7.5 * 48000), 48000)
    assert abs(f1 - 550) < 8 and abs(f2 - 660) < 8, (f1, f2)  # source 7.5 s and 12 s: the trim starts at 5 s
    print(f'wav: trimmed tones {f1:.0f} Hz then {f2:.0f} Hz')
    shot(page, 'extract-wav-1440')

    # ---------- a queue of two, Even out loudness, Download all ----------
    page.click('#ext-clear')
    assert page.is_hidden('#ext-files')
    set_range(page, '#ext-fi', 0)
    set_range(page, '#ext-fo', 0)
    page.click('.engine[data-fmt="mp3"]')
    page.check('#ext-loud')
    page.set_input_files('#ext-in', [CLIP, TONE])
    page.wait_for_function("document.querySelectorAll('.xcard:not(.reading)').length === 2", timeout=30000)
    meta = page.inner_text(f'{card(page, "tone.wav")} .xc-meta')
    assert meta.startswith('00:03.0') and '44.1 kHz' in meta and 'Stereo' in meta, meta
    assert page.text_content('#gen-ext-label') == 'Convert 2 files'
    page.click('#gen-ext')
    page.wait_for_function("document.querySelector('#gen-ext-label').textContent.includes('of 2')", timeout=10000)
    shot(page, 'extract-converting-1440')
    wait_done(page, 'interview.mp4')
    wait_done(page, 'tone.wav')
    assert page.is_visible('#ext-all')
    status = page.inner_text(f'{card(page, "tone.wav")} .xc-status')
    assert re.search(r'\+\d+\.\d dB', status), status  # the quiet file was lifted
    got = []
    page.on('download', lambda d: got.append(d))
    page.click('#ext-all')
    for _ in range(100):
        if len(got) >= 2:
            break
        page.wait_for_timeout(100)
    names = []
    for d in got:
        names.append(d.suggested_filename)
        d.save_as(os.path.join(tmp, 'all-' + d.suggested_filename))
    assert sorted(names) == ['interview.mp3', 'tone.mp3'], names
    for n, rate, dur in (('interview.mp3', 48000, 20.0), ('tone.mp3', 44100, 3.0)):
        path = os.path.join(tmp, 'all-' + n)
        info = probe(path)
        lufs, sp, tp = loudness(path)
        print(f'{n}: {lufs} LUFS, sample peak {sp} dBFS, true peak {tp} dBTP, {info}')
        assert info['rate'] == rate and info['channels'] == 2 and abs(info['duration'] - dur) <= 0.1, info
        assert abs(lufs + 14) <= 0.7, lufs
        assert sp <= -1.0, sp
    shot(page, 'extract-queue-1440')

    # ---------- M4A ----------
    m4a = page.locator('.engine[data-fmt="m4a"]')
    if aac:
        page.uncheck('#ext-loud')
        m4a.click()
        page.click('#gen-ext')
        wait_done(page, 'interview.mp4')
        name, path = save_download(page, f'{card(page, "interview.mp4")} .xc-dl')
        info = probe(path)
        print('m4a:', name, info)
        assert name == 'interview.m4a' and info['codec'] == 'aac' and info['channels'] == 2 and abs(info['duration'] - 20.0) <= 0.1, info
        page.click('.engine[data-fmt="mp3"]')
    else:
        assert m4a.get_attribute('aria-disabled') == 'true' and 'Not in this browser' in m4a.inner_text()
        m4a.click(force=True)  # aria-disabled, but still clickable: it explains itself
        page.wait_for_function("document.querySelector('#toast').textContent.includes('M4A')", timeout=5000)
        assert page.get_attribute('.engine[data-fmt="mp3"]', 'aria-checked') == 'true'
        # the same AudioEncoder + mp4-muxer path, with Opus (Chromium on Linux has no AAC encoder)
        page.evaluate("""async () => { const it = massless.ext.items.find((x) => x.name === 'interview.mp4');
          window.__m4a = (await massless.extract.convert(it, { format: 'm4a', kbps: 128, codec: 'opus' })).blob; }""")
        path = blob_to_file(page, 'window.__m4a', 'interview-opus.m4a')
        info = probe(path)
        print('m4a (opus stand-in):', info)
        assert 'mp4' in info['format'] and info['codec'] == 'opus' and info['channels'] == 2 and abs(info['duration'] - 20.0) <= 0.1, info
    # mono MP3 at 128 kbps through the same API
    page.evaluate("""async () => { const it = massless.ext.items.find((x) => x.name === 'tone.wav');
      window.__mono = (await massless.extract.convert(it, { format: 'mp3', kbps: 128, mono: true })).blob; }""")
    info = probe(blob_to_file(page, 'window.__mono', 'tone-mono.mp3'))
    print('mono mp3:', info)
    assert info['channels'] == 1 and abs(info['bit_rate'] - 128000) < 2000 and info['rate'] == 44100, info
    # with nothing to do, a 16-bit WAV comes back out sample for sample
    page.evaluate("""async () => { const it = massless.ext.items.find((x) => x.name === 'tone.wav');
      window.__wav = (await massless.extract.convert(it, { format: 'wav' })).blob; }""")
    with wave.open(blob_to_file(page, 'window.__wav', 'tone-copy.wav')) as wa, wave.open(TONE) as wb:
        assert wa.getparams()[:3] == wb.getparams()[:3] and wa.readframes(wa.getnframes()) == wb.readframes(wb.getnframes()), 'WAV round trip changed the samples'
    print('wav round trip: identical')

    # ---------- a corrupt file ----------
    page.set_input_files('#ext-in', BROKEN)
    page.wait_for_selector(f'{card(page, "broken.mp4")}.error', timeout=20000)
    msg = page.inner_text(f'{card(page, "broken.mp4")} .xc-status')
    print('corrupt:', msg)
    assert 'Couldn’t read audio from this file' in msg, msg
    assert 'broken.mp4' in page.inner_text('#toast')
    assert page.text_content('#gen-ext-label') == 'Convert'  # the broken file is not counted
    page.set_input_files('#ext-in', SILENT)
    page.wait_for_selector(f'{card(page, "silent-film.mp4")}.error', timeout=20000)
    msg = page.inner_text(f'{card(page, "silent-film.mp4")} .xc-status')
    assert 'no sound track' in msg, msg
    n = page.locator('.xcard').count()
    page.set_input_files('#ext-in', NOTES)
    page.wait_for_function("document.querySelector('#toast').textContent.includes('Choose a video or audio file')", timeout=5000)
    assert page.locator('.xcard').count() == n
    # a file dropped anywhere on the stage joins the list
    dt = page.evaluate_handle("""() => {
      const rate = 22050, n = rate, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
      const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
      v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
      w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(8000 * Math.sin(2 * Math.PI * 300 * i / rate)), true);
      const dt = new DataTransfer(); dt.items.add(new File([b], 'dropped.wav', { type: 'audio/wav' })); return dt; }""")
    for ev in ('dragenter', 'dragover', 'drop'):
        page.dispatch_event('.stage', ev, {'dataTransfer': dt})
    page.wait_for_selector(f'{card(page, "dropped.wav")}:not(.reading)', timeout=10000)
    meta = page.inner_text(f'{card(page, "dropped.wav")} .xc-meta')
    assert meta.startswith('00:01.0') and 'Mono' in meta and '22.05 kHz' in meta, meta
    page.evaluate('document.querySelector(".stage").scrollTo(0, 99999)')
    shot(page, 'extract-error-1440')
    no_overflow(page, 'desktop')

    # ---------- speed: ten minutes to MP3 192 kbps ----------
    page.uncheck('#ext-loud')
    page.click('#ext-clear')
    t0 = time.time()
    page.set_input_files('#ext-in', LONG)
    page.wait_for_selector(f'{card(page, "ten-minutes.m4a")}:not(.reading)', timeout=120000)
    read_s = time.time() - t0
    t0 = time.time()
    page.click('#gen-ext')
    wait_done(page, 'ten-minutes.m4a', timeout=600000)
    enc_s = time.time() - t0
    print(f'speed: read 10 min in {read_s:.1f} s, MP3 192 kbps in {enc_s:.1f} s ({600 / enc_s:.0f}x real time)')
    path = blob_to_file(page, "massless.ext.items[0].result.blob", 'ten-minutes.mp3')
    info = probe(path)
    assert abs(info['duration'] - 600) <= 0.1 and info['rate'] == 44100, info
    page.close()

    # ---------- phone ----------
    m = new_context(b, viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = m.new_page()
    watch(pg, 'phone')
    pg.goto(f'{BASE}/audio?tab=extract', wait_until='domcontentloaded')
    pg.wait_for_selector('#ext-view:not([hidden])')
    shot(pg, 'extract-empty-390')
    pg.set_input_files('#ext-in', [CLIP, TONE])
    pg.wait_for_function("document.querySelectorAll('.xcard:not(.reading)').length === 2", timeout=30000)
    assert pg.is_visible('#ext-go-inline') and pg.text_content('#ext-go-inline') == 'Convert 2 files'
    pg.click('#ext-go-inline')
    pg.wait_for_function("document.querySelectorAll('.xcard.done').length === 2", timeout=60000)
    pg.evaluate("scrollTo(0, document.querySelector('#ext-files').getBoundingClientRect().top + scrollY - 70)")
    shot(pg, 'extract-files-390')
    pg.evaluate("scrollTo(0, document.querySelector('#tab-ext').getBoundingClientRect().top + scrollY - 70)")
    shot(pg, 'extract-panel-390')
    no_overflow(pg, 'phone')
    b.close()


with sync_playwright() as pw:
    try:
        main(pw)
    finally:
        if errors:
            print('ERRORS:\n' + '\n'.join(errors))

outside = sorted({u for u in requests if not u.startswith(BASE) and not u.startswith(('data:', 'blob:'))})
print('requests outside 127.0.0.1:', outside)
assert outside and all(u.startswith(CDN) and u[len(CDN):] in CDN_FILES for u in outside), outside
if errors:
    sys.exit(1)
print('OK')
