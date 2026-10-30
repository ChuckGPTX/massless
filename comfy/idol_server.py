"""Run Idol (speridlabs/idol, Apache-2.0) on your own GPU for the Massless 3D page.

    git clone https://github.com/speridlabs/idol-sdk && pip install -e idol-sdk
    hf auth login            # after requesting access to DINOv3 and FLUX.2-dev on Hugging Face
    python comfy/idol_server.py [--port 7861] [--origin https://massless.chucksi.com]

Then open https://massless.chucksi.com/3d, choose "Idol on your GPU" and press Build 3D.
The browser POSTs the still to /generate and gets a standard 3DGS .ply back. Nothing leaves your machine
except the image the page sends to this server on localhost.
"""
import argparse, json, os, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ap = argparse.ArgumentParser()
ap.add_argument('--host', default='127.0.0.1')
ap.add_argument('--port', type=int, default=7861)
ap.add_argument('--origin', action='append', default=None, help='allowed page origin (repeatable); default: massless.chucksi.com and localhost')
ap.add_argument('--weights', default='speridlabs/idol')
args = ap.parse_args()
ORIGINS = set(args.origin or ['https://massless.chucksi.com', 'http://localhost:8787', 'http://127.0.0.1:8787'])

import torch  # noqa: E402
from idol import IdolPipeline  # noqa: E402

print(f'Loading Idol from {args.weights} ...', flush=True)
pipe = IdolPipeline.from_pretrained(args.weights)
DEVICE = torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'
LOCK = threading.Lock()
print(f'Idol ready on {DEVICE}', flush=True)


class Handler(BaseHTTPRequestHandler):
    def cors(self):
        origin = self.headers.get('Origin')
        if origin in ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'content-type')
        # Chrome asks before a public page may reach a server on this machine
        self.send_header('Access-Control-Allow-Private-Network', 'true')

    def reply(self, code, body, ctype='application/json'):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.cors()
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == '/health':
            return self.reply(200, {'ok': True, 'model': 'speridlabs/idol', 'device': DEVICE})
        self.reply(404, {'error': 'not found'})

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != '/generate':
            return self.reply(404, {'error': 'not found'})
        if self.headers.get('Origin') not in ORIGINS:
            return self.reply(403, {'error': 'origin not allowed; start the server with --origin <page origin>'})
        size = int(self.headers.get('Content-Length') or 0)
        if not 0 < size <= 25 * 1024 * 1024:
            return self.reply(400, {'error': 'send one image up to 25 MB as the request body'})
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        mode = q.get('mode', 'synthetic') if q.get('mode') in ('synthetic', 'real') else 'synthetic'
        seed = int(q.get('seed', 42))
        n = int(q.get('num_gaussians', 262144))
        n = max(32768, min(1048576, n - n % 32))
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 'input.jpg')
            with open(src, 'wb') as f:
                f.write(self.rfile.read(size))
            t0 = time.time()
            try:
                with LOCK:
                    out = pipe(src, mode=mode, seed=seed, num_gaussians=n)
                ply = os.path.join(tmp, 'out.ply')
                out.gaussian.save_ply(ply)
                data = open(ply, 'rb').read()
            except Exception as e:  # report the failure to the page
                return self.reply(500, {'error': f'Idol failed: {e}'})
            print(f'generated {n} gaussians ({mode}, seed {seed}) in {time.time() - t0:.1f}s', flush=True)
            self.reply(200, data, 'application/octet-stream')

    def log_message(self, *a):
        pass


print(f'Massless Idol server on http://{args.host}:{args.port} (allowed origins: {", ".join(sorted(ORIGINS))})', flush=True)
ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
