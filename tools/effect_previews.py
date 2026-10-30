"""Render the looping effect tiles for the Video page's library.

python3 tools/effect_previews.py [effect ...]   -> public/media/clips/effect-<id>.mp4 and .jpg

Same format as the move tiles: 480x270, 24 fps H.264, no audio, plus a poster frame. Each clip is
drawn by the page's own effect engine and encoded by its recorder (WebCodecs) in headless Chromium,
then squeezed with ffmpeg so the library stays light.
"""
import http.server, threading, socketserver, os, sys, functools, base64, subprocess, tempfile, io
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
OUT = os.path.join(ROOT, 'media', 'clips')
# effect: (sample still, look, clip seconds, poster t)
TILES = {
    'lidar': ('canyon', 'cyan', 4.5, 0.45),
    'vanish': ('dancer', 'embers', 4.0, 0.42),
    'freeze': ('astronaut', '', 4.0, 0.5),
    'clones': ('neon', 'rainbow', 4.0, 0.5),
}


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') == '/video': p = '/video/index.html'
        return super().translate_path(p)

    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

RECORD = """async ([dur, posterT]) => {
  const m = window.massless;
  const { recordSegments } = await import('/js/recorder.js');
  m.state.recording = true;
  m.state.duration = dur;
  m.state.fps = 24;
  m.renderer.setSize(480, 270);
  const res = await recordSegments(m.renderer.canvas, { fps: 24, segments: [{ duration: dur, draw: (t, time) => m.drawFrame(t, time) }] });
  const buf = new Uint8Array(await res.blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  m.drawFrame(posterT, posterT * dur);
  const poster = m.renderer.canvas.toDataURL('image/png').split(',')[1];
  return { mp4: btoa(bin), poster, ext: res.ext };
}"""

want = sys.argv[1:] or list(TILES)
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    for eid in want:
        sample, look, dur, poster_t = TILES[eid]
        pg = b.new_page(viewport={'width': 1280, 'height': 800})
        pg.set_default_timeout(0)
        pg.goto(f'http://127.0.0.1:{port}/video?sample={sample}&effect={eid}&look={look}', wait_until='domcontentloaded')
        pg.wait_for_function('window.massless && massless.state.current && massless.state.current.depth && massless.effects.prep', timeout=300000)
        r = pg.evaluate(RECORD, [dur, poster_t])
        assert r['ext'] == 'mp4', r['ext']
        with tempfile.TemporaryDirectory() as tmp:
            raw = os.path.join(tmp, 'raw.mp4')
            open(raw, 'wb').write(base64.b64decode(r['mp4']))
            dst = os.path.join(OUT, f'effect-{eid}.mp4')
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '30',
                            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst], check=True)
        Image.open(io.BytesIO(base64.b64decode(r['poster']))).convert('RGB').save(os.path.join(OUT, f'effect-{eid}.jpg'), quality=82, optimize=True)
        print(eid, sample, look or '-', os.path.getsize(dst), 'bytes', flush=True)
        pg.close()
    b.close()
