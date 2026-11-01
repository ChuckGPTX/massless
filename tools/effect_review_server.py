"""Local-only effect review. Run from the repository root, then open /review/optical-effects.html."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit
import re
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/out/optical-effects'
OUT.mkdir(parents=True, exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = urlsplit(path).path
        if path.startswith('/review/'):
            target = (ROOT / 'tests' / path.removeprefix('/review/')).resolve()
            return str(target) if target.parent == ROOT / 'tests' else '/dev/null'
        return super().translate_path(path)
    def do_POST(self):
        name = self.path.removeprefix('/review-output/')
        if self.headers.get('Origin') != 'http://127.0.0.1:8776' or not self.path.startswith('/review-output/') or not re.fullmatch(r'[a-z-]+\.(png|mp4|webm|json)', name):
            self.send_error(403); return
        length = int(self.headers.get('Content-Length', 0))
        if not 0 < length <= 30_000_000:
            self.send_error(413); return
        (OUT / name).write_bytes(self.rfile.read(length))
        self.send_response(201); self.end_headers(); self.wfile.write(b'Saved')
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT/'public'),**kwargs)
ThreadingHTTPServer(('127.0.0.1',8776),Handler).serve_forever()
