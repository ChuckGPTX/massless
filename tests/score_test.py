"""Score engine test: every style renders a film-length, beat-locked, mastered score in headless Chromium.

Serves public/ on a random port, opens a blank page from it, imports /js/score.js (and /js/film.js for the
template beat sheet) and, for every style at two tempos and two seeds, checks:
  - length, sample rate and duration match the film (beats * 60 / bpm + 1.2 s); no NaN or Inf;
  - peak <= -1 dBFS (0.891); loudness sensible (not silent, not crushed);
  - determinism: the same seed gives identical samples, a different seed different ones;
  - after the drop, onsets on the beat are clearly stronger than half-way between beats;
  - energy below 150 Hz is much higher in the 4 beats after the drop than in the 4 before;
  - the outro rings out after the final hit: it decays, but neither cuts to silence nor stays loud.
Then a sparse, off-grid cut list on the quiet trailer build checks every cut's transient (a whoosh's peak)
lands within 5 ms of its beat, and a 55 s film at 150 BPM checks render time.
Writes one WAV per style to tests/out/score/, prints a table, exits non-zero on failure.

  python3 tests/score_test.py [out_dir]
"""
import base64, functools, http.server, json, os, socketserver, sys, threading, time, wave
import numpy as np
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
BLANK = '/__score_test__.html'
args = [a for a in sys.argv[1:] if not a.startswith('--')]
OUT = args[0] if args else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'score')
os.makedirs(OUT, exist_ok=True)
SR = 48000
PEAK_MAX = 0.891  # -1 dBFS
BRIEF = 'A free AI film studio in your browser. 28 camera moves, voiceover, 3D and launch films, all on open models. No account, no credits, $0.'
ALT_BPM = {'phonk': 140, 'drive': 104, 'trailer': 84, 'trap': 150, 'house': 128}


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == BLANK:
            body = b'<!doctype html><meta charset="utf-8"><title>score test</title>'
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

# Browser side: build the template film's beat grid, render, and hand back exact checks plus 16-bit PCM.
SETUP = """async (brief) => {
  window.__score = await import('/js/score.js');
  window.__film = await import('/js/film.js');
  window.__render = async ({ style, bpm, seed, length = 'standard', minBeats = 0, cuts = null, pcm = true }) => {
    const { templateSpec, layout } = __film;
    const spec = templateSpec({ name: 'Massless', brief, style, bpm, length });
    while (layout(spec).beats < minBeats) spec.blocks.splice(spec.blocks.length - 1, 0, { type: 'words', beats: 4, words: ['ONE', 'TWO', 'THREE', 'FOUR'] });
    const lay = layout(spec);
    const t0 = performance.now();
    const r = await __score.renderScore({ style, bpm, beats: lay.beats, dropBeat: lay.dropBeat, endBeat: lay.endBeat, cuts: cuts || lay.cuts, seed });
    const ms = performance.now() - t0;
    const [L, R] = r.channels;
    let finite = true, peak = 0, h = 2166136261;
    for (const x of [L, R]) {
      const u = new Uint32Array(x.buffer, x.byteOffset, x.length);
      for (let i = 0; i < x.length; i++) {
        const v = x[i];
        if (!Number.isFinite(v)) finite = false;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
        h = Math.imul(h ^ u[i], 16777619);
      }
    }
    let b64 = null;
    if (pcm) {
      const pcm16 = new Int16Array(L.length * 2);
      for (let i = 0; i < L.length; i++) { pcm16[2 * i] = Math.round(Math.max(-1, Math.min(1, L[i])) * 32767); pcm16[2 * i + 1] = Math.round(Math.max(-1, Math.min(1, R[i])) * 32767); }
      const b = new Uint8Array(pcm16.buffer);
      let s = '';
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      b64 = btoa(s);
    }
    return { ms, bpm, sampleRate: r.sampleRate, frames: L.length, channels: r.channels.length, duration: r.duration, finite, peak, hash: (h >>> 0).toString(16), info: r.info,
             beats: lay.beats, drop: lay.dropBeat, end: lay.endBeat, cuts: (cuts || lay.cuts).length, b64 };
  };
}"""


def pcm(b64):
    a = np.frombuffer(base64.b64decode(b64), dtype='<i2').astype(np.float64) / 32767
    return a[0::2], a[1::2]


def write_wav(path, b64):
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(base64.b64decode(b64))


def ms_energy(x, t0, t1):
    a, b = max(0, int(round(t0 * SR))), min(len(x), int(round(t1 * SR)))
    return float(np.mean(x[a:b] ** 2)) if b > a else 0.0


def dbfs(p):
    return 10 * np.log10(max(p, 1e-20))


def lowband(x, t0, t1, fc=150.0):
    """Energy below fc in [t0, t1), from the FFT of the Hann-windowed segment."""
    a, b = max(0, int(t0 * SR)), min(len(x), int(t1 * SR))
    seg = x[a:b] * np.hanning(b - a)
    spec = np.abs(np.fft.rfft(seg)) ** 2
    f = np.fft.rfftfreq(b - a, 1 / SR)
    return float(spec[(f > 20) & (f < fc)].sum())


def onset_strength(x, t, w=0.025):
    """How much the energy rises across t: the 25 ms after it minus the 25 ms before (never negative)."""
    return max(0.0, ms_energy(x, t, t + w) - ms_energy(x, t - w, t))


def metrics(r):
    L, R = pcm(r['b64'])
    x = 0.5 * (L + R)
    spb = 60 / r['bpm']
    drop, end, beats = r['drop'], r['end'], r['beats']
    t_drop, t_end, dur = drop * spb, end * spb, r['duration']
    st = np.concatenate([L, R])
    rms = dbfs(np.mean(st ** 2))
    main = np.concatenate([L[int(t_drop * SR):int(t_end * SR)], R[int(t_drop * SR):int(t_end * SR)]])
    rms_main = dbfs(np.mean(main ** 2))
    crest = 20 * np.log10(r['peak'] + 1e-12) - rms_main
    hot = float(np.mean(np.abs(main) > 0.8))
    on = sum(onset_strength(x, b * spb) for b in range(int(np.ceil(drop)), int(end)))
    off = sum(onset_strength(x, (b + 0.5) * spb) for b in range(int(np.ceil(drop)), int(end)))
    lf_after = lowband(x, t_drop, t_drop + 4 * spb)
    lf_before = lowband(x, max(0, t_drop - 4 * spb), t_drop)
    # outro: four windows from the final hit to the start of the master fade
    o0, o1 = t_end, dur - 0.3
    q = [(o0 + (o1 - o0) * k / 4, o0 + (o1 - o0) * (k + 1) / 4) for k in range(4)]
    ring = [dbfs(ms_energy(x, a, b)) - dbfs(ms_energy(x, t_drop, t_end)) for a, b in q]
    tail_end = float(np.max(np.abs(x[-48:])))
    return {
        'rms': round(rms, 1), 'rms_main': round(rms_main, 1), 'crest': round(crest, 1), 'hot': round(hot * 100, 2),
        'onset': round(on / max(off, 1e-12), 2), 'lf_db': round(10 * np.log10(max(lf_after, 1e-20) / max(lf_before, 1e-20)), 1),
        'ring': [round(v, 1) for v in ring], 'tail_end': tail_end,
    }


def checks_for(r, mt):
    exp_dur = r['beats'] * 60 / r['bpm'] + 1.2
    ring = mt['ring']
    return {
        'length': r['frames'] == round(exp_dur * SR) and abs(r['duration'] - exp_dur) < 1e-9 and r['channels'] == 2,
        'rate': r['sampleRate'] == SR,
        'finite': r['finite'],
        'peak': r['peak'] <= PEAK_MAX,
        'loud': -20 <= mt['rms_main'] <= -8,
        'not_crushed': mt['crest'] >= 7 and mt['hot'] < 2,
        'onset_on_beat': mt['onset'] >= 2,
        'lf_drop': mt['lf_db'] >= 10,
        'ring_decays': all(ring[k + 1] <= ring[k] + 1 for k in range(3)) and ring[3] < ring[0] - 3,
        'ring_not_silent': ring[3] > -45,
        'ring_not_loud': ring[1] <= -3 and ring[3] <= -12,
        'faded_end': mt['tail_end'] < 0.01,
    }


def analytic_envelope(x, lo=0.0):
    """|analytic signal| of x, optionally high-passed above lo Hz first (FFT domain)."""
    n = len(x)
    X = np.fft.fft(x)
    f = np.abs(np.fft.fftfreq(n, 1 / SR))
    if lo:
        X[f < lo] = 0
    h = np.zeros(n)
    h[0] = 1
    if n % 2 == 0:
        h[n // 2] = 1
        h[1:n // 2] = 2
    else:
        h[1:(n + 1) // 2] = 2
    return np.abs(np.fft.ifft(X * h))


def smooth(x, ms):
    k = max(1, int(ms * SR / 1000))
    return np.convolve(x, np.ones(k) / k, mode='same')


def cut_timing(pg):
    """Sparse cuts on the trailer's quiet build, each half-way between 16ths so no note shares its window.
    A transient is where the >500 Hz envelope first crosses half-way from the background to its local peak;
    a whoosh is the peak of its 5 ms-smoothed envelope."""
    kinds = ['hit', 'snap', 'tick', 'click', 'boom', 'glitch', 'whoosh']
    cuts = [{'beat': 1.125 + 1.75 * k, 'kind': kind, 'gain': 0.8} for k, kind in enumerate(kinds)]
    r = pg.evaluate('(o) => __render(o)', {'style': 'trailer', 'bpm': 96, 'seed': 7, 'cuts': cuts})
    L, R = pcm(r['b64'])
    x = 0.5 * (L + R)
    spb = 60 / 96
    out = []
    for c in cuts:
        t = c['beat'] * spb
        a = int((t - 0.12) * SR)
        seg = x[a:a + int(0.24 * SR)]
        mid = int(0.12 * SR)
        w0, w1 = mid - int(0.04 * SR), mid + int(0.04 * SR)
        if c['kind'] == 'whoosh':
            env = smooth(analytic_envelope(seg, 200), 5)
            k = w0 + int(np.argmax(env[w0:w1]))
        else:
            env = smooth(analytic_envelope(seg, 500), 0.5)
            bg = float(np.median(env[w0:mid - int(0.02 * SR)]))
            pk = float(np.max(env[w0:w1]))
            k = w0 + int(np.argmax(env[w0:w1] > bg + 0.5 * (pk - bg)))
        found = (a + k) / SR
        out.append({'kind': c['kind'], 'beat': c['beat'], 'err_ms': round((found - t) * 1000, 2)})
    return out, all(abs(o['err_ms']) <= 5 for o in out)


summary = {'ok': True, 'runs': [], 'errors': []}
failures = []
t_start = time.time()
with sync_playwright() as p:
    browser = p.chromium.launch()
    pg = browser.new_page()
    pg.set_default_timeout(0)
    pg.on('pageerror', lambda e: summary['errors'].append(f'pageerror: {e}'))
    pg.on('console', lambda m: m.type == 'error' and summary['errors'].append(m.text[:300]))
    pg.goto(f'http://127.0.0.1:{port}{BLANK}')
    summary['browser'] = browser.version
    pg.evaluate(SETUP, BRIEF)
    styles = pg.evaluate('__score.STYLES')
    ids = [s['id'] for s in styles]
    for need in ['phonk', 'drive', 'trailer', 'trap', 'house']:
        if need not in ids:
            failures.append(f'missing style {need}')
    defaults = {'phonk': 150, 'drive': 118, 'trailer': 96, 'trap': 140, 'house': 124}
    summary['styles_ok'] = all(next((s['bpm'] for s in styles if s['id'] == k), None) == v for k, v in defaults.items())
    if not summary['styles_ok']:
        failures.append('style bpm defaults')

    for s in styles:
        sid = s['id']
        hashes = {}
        for bpm in [s['bpm'], ALT_BPM.get(sid, s['bpm'] + 10)]:
            for seed in [1, 2]:
                r = pg.evaluate('(o) => __render(o)', {'style': sid, 'bpm': bpm, 'seed': seed})
                mt = metrics(r)
                ck = checks_for(r, mt)
                hashes[(bpm, seed)] = r['hash']
                if bpm == s['bpm'] and seed == 1:
                    write_wav(os.path.join(OUT, f'{sid}.wav'), r['b64'])
                    again = pg.evaluate('(o) => __render(o)', {'style': sid, 'bpm': bpm, 'seed': seed, 'pcm': False})
                    ck['deterministic'] = again['hash'] == r['hash']
                if seed == 2:
                    ck['seed_varies'] = r['hash'] != hashes[(bpm, 1)]
                run = {'style': sid, 'bpm': bpm, 'seed': seed, 'dur': round(r['duration'], 2), 'render_s': round(r['ms'] / 1000, 2),
                       'peak': round(r['peak'], 3), 'key': r['info']['key'], 'chords': r['info']['chords'], 'lufs': r['info']['lufs'],
                       'limiter_db': r['info']['limiterDb'], **mt, 'checks': ck, 'ok': all(ck.values())}
                summary['runs'].append(run)
                if not run['ok']:
                    failures.append(f'{sid}@{bpm}/{seed}: ' + ','.join(k for k, v in ck.items() if not v))

    timing, timing_ok = cut_timing(pg)
    summary['cut_timing'] = timing
    if not timing_ok:
        failures.append('cut timing')

    long_runs = []
    for sid in ids:
        r = pg.evaluate('(o) => __render(o)', {'style': sid, 'bpm': 150, 'seed': 3, 'length': 'long', 'minBeats': 134, 'pcm': False})
        long_runs.append({'style': sid, 'dur': round(r['duration'], 1), 'render_s': round(r['ms'] / 1000, 2), 'phases_ms': r['info'].get('ms'), 'peak': round(r['peak'], 3), 'finite': r['finite']})
    summary['long_150bpm'] = long_runs
    if any(lr['render_s'] > 10 or not lr['finite'] or lr['peak'] > PEAK_MAX for lr in long_runs):
        failures.append('55 s render')
    browser.close()
httpd.shutdown()

if summary['errors']:
    failures.append('page errors')
summary['ok'] = not failures
summary['failures'] = failures
summary['total_s'] = round(time.time() - t_start, 1)

# ---- compact table ----
cols = ['style', 'bpm', 'seed', 'dur', 'render_s', 'key', 'lufs', 'rms_main', 'peak', 'crest', 'limiter_db', 'onset', 'lf_db', 'ring', 'ok']
print(' '.join(f'{c:>10}' if c != 'key' else f'{c:>12}' for c in cols))
for run in summary['runs']:
    row = []
    for c in cols:
        v = run[c]
        if c == 'ring':
            v = '/'.join(f'{int(round(x))}' for x in v)
        row.append(f'{str(v):>12}' if c == 'key' else f'{str(v):>10}')
    print(' '.join(row))
print('cut timing (ms):', ', '.join(f"{o['kind']} {o['err_ms']:+.2f}" for o in summary['cut_timing']))
print('55 s at 150 BPM:', ', '.join(f"{lr['style']} {lr['render_s']} s" for lr in summary['long_150bpm']))
for lr in summary['long_150bpm']:
    print(f"  {lr['style']:>8}: {lr['phases_ms']}")
print('WAVs:', OUT)
for run in summary['runs']:
    run.pop('checks') if run['ok'] else None
print(json.dumps({k: v for k, v in summary.items() if k not in ('runs',)}, indent=1))
sys.exit(0 if summary['ok'] else 1)
