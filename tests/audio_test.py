"""Audio engine check in headless Chromium: Kokoro voice and procedural ambience beds.

Serves public/ on a random port, opens a blank page from it, imports /js/audio-engine.js and checks:
  - the voice model loads and speak() returns a WAV longer than 1.5 s, clearly above silence;
  - every bed renders a 5 s, non-silent, stereo WAV with faded ends.
WAVs are decoded here with Python's wave module, so the encoder is checked independently.
Prints a JSON summary and exits non-zero on failure.

  python3 tests/audio_test.py [--skip-voice] [--seconds 5] [--out DIR]
"""
import argparse, base64, functools, http.server, io, json, math, os, socketserver, sys, threading, time, wave
from array import array
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
BLANK = '/__audio_test__.html'
SPEECH = 'Massless is a free cinema camera for AI shots.'
VOICE_TIMEOUT_MS = 15 * 60 * 1000  # first load downloads ~115 MB on WebAssembly

ap = argparse.ArgumentParser()
ap.add_argument('--skip-voice', action='store_true', help='only check the ambience beds')
ap.add_argument('--seconds', type=float, default=5.0, help='bed length to render')
ap.add_argument('--out', help='directory to save the rendered WAVs into')
args = ap.parse_args()


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == BLANK:
            body = b'<!doctype html><meta charset="utf-8"><title>audio test</title>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Handler, directory=ROOT))
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()

# Browser-side helper: blob -> base64, so Python can decode the exact bytes the engine produced.
TO_B64 = """async (blob) => {
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}"""


def wav_stats(data):
    """Decode a 16-bit PCM WAV and measure it per channel."""
    with wave.open(io.BytesIO(data)) as w:
        ch, width, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        frames = w.readframes(n)
    assert width == 2, f'expected 16-bit samples, got {8 * width}-bit'
    a = array('h')
    a.frombytes(frames)
    if sys.byteorder == 'big':
        a.byteswap()
    chans = [a[c::ch] for c in range(ch)]
    rms = [math.sqrt(sum(x * x for x in c) / max(1, len(c))) / 32768 for c in chans]
    peak = [max((abs(x) for x in c), default=0) / 32768 for c in chans]
    edge = [max(abs(c[0]), abs(c[-1])) / 32768 if len(c) else 0 for c in chans]
    out = {
        'channels': ch, 'sample_rate': rate, 'frames': n, 'duration': round(n / rate, 4),
        'rms_dbfs': [round(20 * math.log10(max(r, 1e-9)), 1) for r in rms], 'peak': [round(p, 3) for p in peak],
        'edge_max': round(max(edge), 4), '_rms': rms,
    }
    if ch == 2:
        l, r = chans
        sll = sum(x * x for x in l)
        srr = sum(x * x for x in r)
        out['lr_correlation'] = round(sum(x * y for x, y in zip(l, r)) / math.sqrt(max(1, sll * srr)), 3)
    return out


def save(name, data):
    if args.out:
        os.makedirs(args.out, exist_ok=True)
        with open(os.path.join(args.out, name), 'wb') as f:
            f.write(data)


summary = {'ok': True, 'voice': None, 'beds': [], 'errors': [], 'failed_requests': []}
failures = []
t_start = time.time()

with sync_playwright() as p:
    browser = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    pg = browser.new_page()
    pg.on('pageerror', lambda e: summary['errors'].append(f'pageerror: {e}'))
    pg.on('console', lambda m: m.type == 'error' and summary['errors'].append(m.text[:300]))
    pg.on('requestfailed', lambda r: summary['failed_requests'].append(f'{r.url[:160]} {r.failure}'))
    pg.goto(f'http://127.0.0.1:{port}{BLANK}')
    summary['browser'] = browser.version
    pg.evaluate("async () => { window.__m = await import('/js/audio-engine.js'); }")
    pg.evaluate(f'() => {{ window.__toB64 = {TO_B64}; }}')
    voices = pg.evaluate('__m.VOICES')
    beds = pg.evaluate('__m.BEDS')
    summary['voice_ids'] = [v['id'] for v in voices]

    # ---- voice ----
    if args.skip_voice:
        summary['voice'] = {'skipped': True}
    else:
        v = {'voice': voices[0]['id'], 'text': SPEECH}
        try:
            t = time.time()
            load = pg.evaluate("""async (ms) => {
              const steps = [];
              const timeout = new Promise((_, no) => setTimeout(() => no(new Error(`voice model load timed out after ${ms} ms`)), ms));
              await Promise.race([__m.loadVoiceModel((f, label) => steps.push([Math.round(f * 100), label])), timeout]);
              const labels = [...new Set(steps.map((s) => s[1]))];
              return { backend: __m.voiceBackend(), labels, progress_events: steps.length, last: steps.at(-1) };
            }""", VOICE_TIMEOUT_MS)
            v.update(load)
            v['load_s'] = round(time.time() - t, 1)
            t = time.time()
            out = pg.evaluate("""async ({ text, voice }) => {
              const r = await __m.speak(text, { voice });
              return { duration: r.duration, sampleRate: r.sampleRate, type: r.blob.type, size: r.blob.size, isBlobUrl: r.url.startsWith('blob:'), b64: await __toB64(r.blob) };
            }""", {'text': SPEECH, 'voice': voices[0]['id']})
            v['generate_s'] = round(time.time() - t, 1)
            data = base64.b64decode(out.pop('b64'))
            save(f"voice-{voices[0]['id']}.wav", data)
            st = wav_stats(data)
            rms = st.pop('_rms')
            v.update({k: out[k] for k in ('duration', 'sampleRate', 'type', 'size', 'isBlobUrl')})
            v['wav'] = st
            v['realtime_factor'] = round(v['generate_s'] / max(1e-6, st['duration']), 2)
            checks = {
                'backend': v['backend'] in ('WebGPU', 'WebAssembly'),
                'mime': out['type'] == 'audio/wav' and out['isBlobUrl'],
                'mono_24k': st['channels'] == 1 and st['sample_rate'] == 24000,
                'longer_than_1_5s': st['duration'] > 1.5,
                'duration_matches': abs(st['duration'] - out['duration']) < 0.01,
                'rms_above_silence': rms[0] > 0.02,
            }
            v['checks'] = checks
            v['ok'] = all(checks.values())
        except Exception as e:  # report exactly what failed, then carry on with the beds
            v['ok'] = False
            v['error'] = str(e).split('\n')[0][:600]
        summary['voice'] = v
        if not v['ok']:
            failures.append('voice')

    # ---- beds ----
    for bed in beds:
        b = {'id': bed['id']}
        try:
            t = time.time()
            out = pg.evaluate("""async ({ id, seconds }) => {
              const t0 = performance.now();
              const r = await __m.renderBed(id, seconds, { intensity: 0.7, seed: 20261030 });
              const ms = performance.now() - t0;
              return { ms, duration: r.duration, type: r.blob.type, isBlobUrl: r.url.startsWith('blob:'), b64: await __toB64(r.blob) };
            }""", {'id': bed['id'], 'seconds': args.seconds})
            b['render_s'] = round(out['ms'] / 1000, 2)
            data = base64.b64decode(out['b64'])
            save(f"bed-{bed['id']}.wav", data)
            st = wav_stats(data)
            rms = st.pop('_rms')
            b.update(st)
            checks = {
                'mime': out['type'] == 'audio/wav' and out['isBlobUrl'],
                'stereo_48k': st['channels'] == 2 and st['sample_rate'] == 48000,
                'duration': abs(st['duration'] - args.seconds) < 1 / 48000 + 1e-6 and abs(out['duration'] - args.seconds) < 1e-3,
                'non_silent': min(rms) > 1e-3,
                'true_stereo': st['lr_correlation'] < 0.999,
                'no_hard_clip': max(st['peak']) < 0.9999,
                'faded_ends': st['edge_max'] < 0.01,
            }
            b['checks'] = checks
            b['ok'] = all(checks.values())
        except Exception as e:
            b['ok'] = False
            b['error'] = str(e).split('\n')[0][:600]
        summary['beds'].append(b)
        if not b['ok']:
            failures.append(f"bed:{bed['id']}")
    browser.close()

httpd.shutdown()
summary['ok'] = not failures
summary['failures'] = failures
summary['total_s'] = round(time.time() - t_start, 1)
for b in summary['beds']:
    if b.get('ok'):
        b.pop('checks', None)  # keep the summary short; failing beds keep their checks
print(json.dumps(summary, indent=2))
sys.exit(0 if summary['ok'] else 1)
