"""GPU worker tests, no GPU needed. python3 tests/gpu_handler_test.py

1. Every workflow in gpu/workflows (and gpu/lab/workflows) is checked against the pinned ComfyUI's own source
   (read with ast, never imported): each class_type is a node ComfyUI or a pinned custom node registers,
   no deprecated nodes, every required input is set, no unknown inputs, literal values match their
   type and combo options, links point at real outputs of the right type, every node feeds an output,
   and every model file a loader names is in the manifest under the right folder.
2. The manifests: fields, licenses, Dockerfile layers match them exactly, every URL answers a HEAD with
   the recorded size and sha256 (network), the FastWan rename gives exactly Comfy-Org's 5B tensor names
   and shapes (network, header bytes only) and the in-place rename works on a synthetic file.
3. The handler end to end against a fake ComfyUI written here (HTTP /prompt /history /view /upload/image
   /interrupt /queue, and a real websocket on /ws): every job type, input validation, progress, timeouts,
   ComfyUI errors, the polling fallback, cleanup of inputs and outputs, and starting ComfyUI once per worker.

Requires requests and Pillow; websocket-client is optional (the websocket path is skipped without it).
GPU_TEST_OFFLINE=1 skips the network checks. COMFYUI_SRC=/path/to/ComfyUI uses a local checkout instead of
fetching the pinned files from GitHub (cached in tests/out/).
"""
import ast
import base64
import hashlib
import io
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import types
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from email.parser import BytesParser
from email.policy import default as email_policy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GPU = os.path.join(ROOT, 'workers', 'gpu')
OUT = os.path.join(ROOT, 'tests', 'out')
OFFLINE = os.environ.get('GPU_TEST_OFFLINE') == '1'

fails = []
skips = []


def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        fails.append(msg)
    return cond


def skip(msg):
    print('skip ' + msg)
    skips.append(msg)


def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# =============================================================================================
# Fake ComfyUI
# =============================================================================================

WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
SAMPLING = {'KSampler', 'KSamplerAdvanced', 'SamplerCustom', 'SamplerCustomAdvanced', 'TextEncodeAceStepAudio1.5', 'ImageUpscaleWithModel', 'MMAudioSampler', 'HunyuanFoleySampler'}


def ws_frame(text):
    data = text.encode('utf-8')
    n = len(data)
    if n < 126:
        head = struct.pack('!BB', 0x81, n)
    elif n < 65536:
        head = struct.pack('!BBH', 0x81, 126, n)
    else:
        head = struct.pack('!BBQ', 0x81, 127, n)
    return head + data


_mp4_cache = {}


def fake_mp4(seconds=1, size='128x72', crf=30):
    """A real (small) H.264 MP4 when ffmpeg is here, so the handler's ffmpeg steps can read it; else just the header."""
    key = (seconds, size, crf)
    if key not in _mp4_cache:
        if shutil.which('ffmpeg'):
            _mp4_cache[key] = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'testsrc2=size={size}:rate=16:duration={seconds}', '-vf', 'noise=alls=40:allf=t',
                                              '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', str(crf), '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov',
                                              '-f', 'mp4', '-'], capture_output=True, check=True).stdout
        else:
            _mp4_cache[key] = b'\x00\x00\x00\x20ftypisom' + os.urandom(3000)
    return _mp4_cache[key]


class FakeComfy:
    """Just enough of ComfyUI's server API for the handler, plus a /_test/ control surface."""

    def __init__(self, root, port=0):
        self.root = root
        for d in ('input', 'output', 'temp'):
            os.makedirs(os.path.join(root, d), exist_ok=True)
        self.scenario = {'mode': 'ok', 'ws': True, 'delay': 0.003}
        self.prompts, self.history, self.calls, self.clients, self.uploads = {}, {}, [], {}, []
        self.interrupted = threading.Event()
        self.lock = threading.Lock()
        fake = self

        class H(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *a):
                pass

            def body(self):
                n = int(self.headers.get('content-length') or 0)
                return self.rfile.read(n) if n else b''

            def send(self, status, payload, ctype='application/json'):
                data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
                self.send_response(status)
                self.send_header('content-type', ctype)
                self.send_header('content-length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                u = urlparse(self.path)
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                fake.calls.append(('GET', u.path, q))
                if u.path == '/system_stats':
                    return self.send(200, {'system': {'os': 'fake', 'comfyui_version': '0.42.5', 'pid': os.getpid()}, 'devices': []})
                if u.path.startswith('/history/'):
                    pid = u.path.split('/', 2)[2]
                    with fake.lock:
                        entry = fake.history.get(pid)
                    return self.send(200, {pid: entry} if entry else {})
                if u.path == '/view':
                    p = os.path.join(fake.root, q.get('type', 'output'), q.get('subfolder', ''), q.get('filename', ''))
                    if not os.path.isfile(p):
                        return self.send(404, {'error': 'not found'})
                    with open(p, 'rb') as f:
                        return self.send(200, f.read(), 'application/octet-stream')
                if u.path == '/ws':
                    return self.websocket(q.get('clientId', ''))
                if u.path == '/_test/state':
                    return self.send(200, {'prompts': fake.prompts, 'calls': [c[:2] for c in fake.calls], 'pid': os.getpid()})
                return self.send(404, {'error': 'no route'})

            def websocket(self, cid):
                if not fake.scenario.get('ws', True):
                    return self.send(403, {'error': 'no websocket here'})
                key = self.headers.get('Sec-WebSocket-Key', '')
                accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
                self.send_response(101)
                self.send_header('Upgrade', 'websocket')
                self.send_header('Connection', 'Upgrade')
                self.send_header('Sec-WebSocket-Accept', accept)
                self.end_headers()
                self.wfile.flush()
                sock = self.connection
                lock = threading.Lock()
                fake.clients[cid] = (sock, lock)
                fake.ws_send(cid, {'type': 'status', 'data': {'status': {'exec_info': {'queue_remaining': 0}}, 'sid': cid}})
                try:
                    while True:  # read (and ignore) client frames until it closes
                        b = sock.recv(4096)
                        if not b or (b[0] & 0x0F) == 0x8:
                            break
                except OSError:
                    pass
                fake.clients.pop(cid, None)
                self.close_connection = True

            def do_POST(self):
                u = urlparse(self.path)
                raw = self.body()
                fake.calls.append(('POST', u.path, raw[:200]))
                if u.path == '/upload/image':
                    ctype = self.headers.get('content-type', '')
                    msg = BytesParser(policy=email_policy).parsebytes(b'Content-Type: ' + ctype.encode() + b'\r\n\r\n' + raw)
                    for part in msg.iter_parts():
                        if part.get_param('name', header='content-disposition') == 'image':
                            name = os.path.basename(part.get_filename())
                            payload = part.get_payload(decode=True)
                            with open(os.path.join(fake.root, 'input', name), 'wb') as f:
                                f.write(payload)
                            fake.uploads.append((name, part.get_content_type(), payload))
                            return self.send(200, {'name': name, 'subfolder': '', 'type': 'input'})
                    return self.send(400, {'error': 'no image part'})
                if u.path == '/prompt':
                    j = json.loads(raw)
                    return fake.post_prompt(self, j)
                if u.path == '/interrupt':
                    fake.interrupted.set()
                    return self.send(200, b'', 'text/plain')
                if u.path in ('/queue', '/history'):
                    j = json.loads(raw or b'{}')
                    if u.path == '/history':
                        with fake.lock:
                            for pid in j.get('delete', []):
                                fake.history.pop(pid, None)
                    return self.send(200, b'', 'text/plain')
                if u.path == '/_test/scenario':
                    fake.scenario.update(json.loads(raw))
                    return self.send(200, {'ok': True})
                return self.send(404, {'error': 'no route'})

        self.server = ThreadingHTTPServer(('127.0.0.1', port), H)
        self.server.daemon_threads = True
        self.port = self.server.server_address[1]
        self.host = f'127.0.0.1:{self.port}'

    def start(self):
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return self

    def stop(self):
        self.server.shutdown()

    def reset(self, **scenario):
        self.scenario = {'mode': 'ok', 'ws': True, 'delay': 0.003}
        self.scenario.update(scenario)
        self.interrupted.clear()

    def ws_send(self, cid, msg):
        c = self.clients.get(cid)
        if not c:
            return
        sock, lock = c
        try:
            with lock:
                sock.sendall(ws_frame(json.dumps(msg)))
        except OSError:
            pass

    def ws_drop(self, cid):
        c = self.clients.pop(cid, None)
        if c:
            try:
                c[0].shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def post_prompt(self, h, j):
        graph, pid, cid = j.get('prompt'), j.get('prompt_id'), j.get('client_id', '')
        if not isinstance(graph, dict) or not re.fullmatch(r'[0-9a-f-]{36}', pid or ''):
            return h.send(400, {'error': {'type': 'bad', 'message': 'bad request'}, 'node_errors': {}})
        for nid, node in graph.items():  # the server also refuses dangling links, like the real one
            for v in node['inputs'].values():
                if isinstance(v, list) and (len(v) != 2 or v[0] not in graph):
                    return h.send(400, {'error': {'type': 'bad_link', 'message': f'bad link in {nid}'}, 'node_errors': {}})
        self.prompts[pid] = graph
        mode = self.scenario.get('mode')
        if mode == 'reject':
            first = next(iter(graph))
            return h.send(400, {'error': {'type': 'prompt_outputs_failed_validation', 'message': 'Prompt outputs failed validation', 'details': ''},
                                'node_errors': {first: {'errors': [{'message': 'Value not in list', 'details': "unet_name: 'x' not in []"}],
                                                        'class_type': graph[first]['class_type']}}})
        threading.Thread(target=self.execute, args=(pid, graph, cid), daemon=True).start()
        return h.send(200, {'prompt_id': pid, 'number': 1, 'node_errors': {}})

    def order(self, graph):
        seen, out = set(), []

        def visit(n):
            if n in seen:
                return
            seen.add(n)
            for v in graph[n]['inputs'].values():
                if isinstance(v, list):
                    visit(v[0])
            out.append(n)
        for n in graph:
            visit(n)
        return out

    def write_output(self, graph, nid):
        node = graph[nid]
        ct, prefix = node['class_type'], node['inputs'].get('filename_prefix', 'ComfyUI')
        sub, base = os.path.split(prefix)
        os.makedirs(os.path.join(self.root, 'output', sub), exist_ok=True)
        if ct == 'SaveVideo':
            name, key = f'{base}_00001_.mp4', 'images'
            data = fake_mp4(self.scenario.get('video_seconds', 1), self.scenario.get('video_size', '128x72'), self.scenario.get('video_crf', 30))
        elif ct in ('SaveAudioAdvanced', 'SaveAudioMP3') and node['inputs'].get('format') == 'flac':
            secs = graph.get('sampler', {}).get('inputs', {}).get('duration', 3)
            data = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'sine=frequency=440:duration={secs}:sample_rate=44100',
                                   '-ac', '2', '-c:a', 'flac', '-f', 'flac', '-'], capture_output=True, check=True).stdout
            name, key = f'{base}_00001_.flac', 'audio'
        elif ct in ('SaveAudioAdvanced', 'SaveAudioMP3'):
            name, data, key = f'{base}_00001_.mp3', b'ID3\x04\x00' + os.urandom(3000), 'audio'
        elif ct == 'SaveImage':
            from PIL import Image
            src = graph[node['inputs']['images'][0]]['inputs']
            w, h = int(src.get('width', 64)), int(src.get('height', 64))
            buf = io.BytesIO()
            Image.new('RGB', (w, h), (40, 120, 200)).save(buf, 'PNG')
            name, data, key = f'{base}_00001_.png', buf.getvalue(), 'images'
        else:
            name, data, key = f'{base}_00001_.bin', os.urandom(100), 'images'
        with open(os.path.join(self.root, 'output', sub, name), 'wb') as f:
            f.write(data)
        out = {key: [{'filename': name, 'subfolder': sub, 'type': 'output'}]}
        if ct == 'SaveVideo':
            out['animated'] = [True]
        return out

    def execute(self, pid, graph, cid):
        delay, mode = self.scenario.get('delay', 0.003), self.scenario.get('mode')
        send = lambda t, d: self.ws_send(cid, {'type': t, 'data': dict(d, prompt_id=pid)})  # noqa: E731
        send('execution_start', {'timestamp': time.time()})
        if mode == 'drop_ws':
            self.ws_drop(cid)
        outputs = {}
        for nid in self.order(graph):
            time.sleep(delay)
            send('executing', {'node': nid, 'display_node': nid})
            ct = graph[nid]['class_type']
            if ct in SAMPLING:
                if mode == 'hang':
                    self.interrupted.wait(60)
                    send('execution_interrupted', {'node_id': nid, 'node_type': ct})
                    with self.lock:
                        self.history[pid] = {'outputs': {}, 'status': {'status_str': 'error', 'completed': False,
                                                                       'messages': [['execution_interrupted', {'prompt_id': pid}]]}}
                    return
                if mode in ('oom', 'error_history_only'):
                    err = {'prompt_id': pid, 'node_id': nid, 'node_type': ct, 'exception_type': 'torch.OutOfMemoryError',
                           'exception_message': 'CUDA out of memory. Tried to allocate 2.00 GiB', 'traceback': []}
                    if mode == 'oom':
                        send('execution_error', err)
                    with self.lock:
                        self.history[pid] = {'outputs': {}, 'status': {'status_str': 'error', 'completed': False, 'messages': [['execution_error', err]]}}
                    return
                for i in range(1, 5):
                    send('progress', {'value': i, 'max': 4, 'node': nid})
            if (ct.startswith('Save') or ct.startswith('VHS_Video')) and mode != 'no_file':
                outputs[nid] = self.write_output(graph, nid)
                send('executed', {'node': nid, 'output': outputs[nid]})
        with self.lock:
            self.history[pid] = {'outputs': outputs, 'status': {'status_str': 'success', 'completed': True,
                                                                'messages': [['execution_success', {'prompt_id': pid}]]}}
        send('executing', {'node': None})
        send('execution_success', {})


# =============================================================================================
# ComfyUI source index (ast only; nothing is imported or executed)
# =============================================================================================

def custom_node_source(node):
    """Python files of a pinned custom node (only the ones that register nodes), cached in tests/out/."""
    owner_repo = node['repo'].replace('https://github.com/', '')
    dest = os.path.join(OUT, f"node-src-{node['name']}-{node['commit'][:12]}")
    marker = os.path.join(dest, '.complete')
    if os.path.exists(marker):
        return dest
    if OFFLINE:
        return None
    try:
        os.makedirs(dest, exist_ok=True)
        with urllib.request.urlopen(f"https://raw.githubusercontent.com/{owner_repo}/{node['commit']}/nodes.py", timeout=60) as r, open(os.path.join(dest, 'nodes.py'), 'wb') as f:
            f.write(r.read())
    except Exception as e:  # pragma: no cover
        print(f'     (could not fetch {owner_repo}: {e})')
        return None
    open(marker, 'w').close()
    return dest


def comfy_source(commit, extra_files=()):
    """Path to a directory holding the pinned ComfyUI's node sources."""
    if os.environ.get('COMFYUI_SRC') and commit == os.environ.get('COMFYUI_SRC_COMMIT', commit):
        return os.environ['COMFYUI_SRC']
    dest = os.path.join(OUT, f'comfyui-src-{commit[:12]}')
    marker = os.path.join(dest, '.complete')
    if os.path.exists(marker):
        return dest
    if OFFLINE:
        return None
    raw = f'https://raw.githubusercontent.com/comfyanonymous/ComfyUI/{commit}/'

    def get(rel):
        p = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with urllib.request.urlopen(raw + rel, timeout=60) as r, open(p, 'wb') as f:
            f.write(r.read())
        return p
    try:
        with open(get('nodes.py'), encoding='utf-8') as f:
            extras = extras_list(ast.parse(f.read()))
        files = ['comfy_api/latest/_io.py', 'comfy/samplers.py'] + [f'comfy_extras/{x}' for x in extras]
        with ThreadPoolExecutor(16) as ex:
            list(ex.map(get, files))
    except Exception as e:  # pragma: no cover
        print(f'     (could not fetch ComfyUI sources: {e})')
        return None
    open(marker, 'w').close()
    return dest


def extras_list(tree):
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) and fn.name == 'init_builtin_extra_nodes':
            for node in ast.walk(fn):
                if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'extras_files' for t in node.targets):
                    return [e.value for e in node.value.elts if isinstance(e, ast.Constant)]
    return []


class Inp:
    def __init__(self, name, type_, required, options=None, folder=None, dynamic=False):
        self.name, self.type, self.required, self.options, self.folder, self.dynamic = name, type_, required, options, folder, dynamic


class NodeDef:
    def __init__(self, name, src):
        self.name, self.src = name, src
        self.inputs, self.outputs, self.output_node, self.deprecated, self.parsed = {}, [], False, False, True


SPECIAL_OPTIONS = {}


def literal_list(node):
    if isinstance(node, (ast.List, ast.Tuple)) and all(isinstance(e, ast.Constant) for e in node.elts):
        return [e.value for e in node.elts]
    return None


def dotted(node):
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return '.'.join(reversed(parts))


class Index:
    def __init__(self, src, extra_dirs=()):
        self.nodes = {}
        self.iotypes = {}
        self.samplers, self.schedulers = None, None
        self._io(os.path.join(src, 'comfy_api/latest/_io.py'))
        self._samplers(os.path.join(src, 'comfy/samplers.py'))
        with open(os.path.join(src, 'nodes.py'), encoding='utf-8') as f:
            tree = ast.parse(f.read())
        self.module(tree, 'nodes.py')
        for x in extras_list(tree):
            p = os.path.join(src, 'comfy_extras', x)
            if os.path.exists(p):
                with open(p, encoding='utf-8-sig') as f:
                    self.module(ast.parse(f.read()), f'comfy_extras/{x}')
        for d in extra_dirs:  # pinned custom nodes (Lab image)
            for base, _, names in os.walk(d):
                for n in names:
                    if n.endswith('.py'):
                        with open(os.path.join(base, n), encoding='utf-8-sig', errors='replace') as f:
                            try:
                                self.module(ast.parse(f.read()), os.path.join(os.path.basename(d), os.path.relpath(os.path.join(base, n), d)))
                            except SyntaxError:
                                pass

    def _io(self, path):
        with open(path, encoding='utf-8') as f:
            tree = ast.parse(f.read())
        for c in ast.walk(tree):
            if isinstance(c, ast.ClassDef):
                for d in c.decorator_list:
                    if isinstance(d, ast.Call) and getattr(d.func, 'id', '') == 'comfytype':
                        for kw in d.keywords:
                            if kw.arg == 'io_type' and isinstance(kw.value, ast.Constant):
                                self.iotypes[c.name] = kw.value.value

    def _samplers(self, path):
        with open(path, encoding='utf-8') as f:
            tree = ast.parse(f.read())
        names = {}
        for node in tree.body:
            if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
                names[node.targets[0].id] = node.value
        ks = literal_list(names.get('KSAMPLER_NAMES')) or []
        extra = names.get('SAMPLER_NAMES')
        if isinstance(extra, ast.BinOp):
            ks = ks + (literal_list(extra.right) or [])
        self.samplers = ks
        sh = names.get('SCHEDULER_HANDLERS')
        self.schedulers = [k.value for k in sh.keys] if isinstance(sh, ast.Dict) else None
        SPECIAL_OPTIONS.update({'comfy.samplers.KSampler.SAMPLERS': self.samplers, 'comfy.samplers.SAMPLER_NAMES': self.samplers,
                                'comfy.samplers.KSampler.SCHEDULERS': self.schedulers, 'comfy.samplers.SCHEDULER_NAMES': self.schedulers})

    # ---- one module
    def module(self, tree, src):
        classes = {c.name: c for c in tree.body if isinstance(c, ast.ClassDef)}
        funcs = {f.name: f for f in tree.body if isinstance(f, ast.FunctionDef)}
        consts = {}
        for node in tree.body:
            if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
                consts[node.targets[0].id] = node.value
        for c in classes.values():  # v3 nodes
            for fn in c.body:
                if isinstance(fn, ast.FunctionDef) and fn.name == 'define_schema':
                    self.v3(c, fn, src, funcs, consts)
        for node in tree.body:  # legacy NODE_CLASS_MAPPINGS
            if isinstance(node, ast.Assign) and any(getattr(t, 'id', '') == 'NODE_CLASS_MAPPINGS' for t in node.targets) and isinstance(node.value, ast.Dict):
                for k, v in zip(node.value.keys, node.value.values):
                    if isinstance(k, ast.Constant) and isinstance(v, ast.Name) and v.id in classes:
                        self.legacy(k.value, classes[v.id], classes, src, consts)

    def v3(self, c, fn, src, funcs, consts):
        schema = None
        for node in ast.walk(fn):
            if isinstance(node, ast.Call) and dotted(node.func).endswith('Schema') and any(k.arg == 'node_id' for k in node.keywords):
                schema = node
                break
        if schema is None:
            return
        kw = {k.arg: k.value for k in schema.keywords}
        if not isinstance(kw['node_id'], ast.Constant):
            return
        d = NodeDef(kw['node_id'].value, src)
        d.output_node = isinstance(kw.get('is_output_node'), ast.Constant) and kw['is_output_node'].value is True
        d.deprecated = isinstance(kw.get('is_deprecated'), ast.Constant) and kw['is_deprecated'].value is True
        for e in getattr(kw.get('inputs'), 'elts', []) or []:
            i = self.v3_input(e, funcs, consts)
            if i is None:
                d.parsed = False
            else:
                d.inputs[i.name] = i
        for e in getattr(kw.get('outputs'), 'elts', []) or []:
            d.outputs.append(self.v3_type(e.func.value) if isinstance(e, ast.Call) and isinstance(e.func, ast.Attribute) else '*')
        if kw.get('inputs') is not None and not isinstance(kw.get('inputs'), ast.List):
            d.parsed = False
        self.nodes[d.name] = d

    def v3_type(self, node):
        if isinstance(node, ast.Call) and dotted(node.func).endswith('Custom') and node.args and isinstance(node.args[0], ast.Constant):
            return node.args[0].value
        if isinstance(node, ast.Attribute):
            return self.iotypes.get(node.attr, node.attr.upper())
        return '*'

    def v3_input(self, e, funcs, consts):
        if not isinstance(e, ast.Call):
            return None
        if isinstance(e.func, ast.Name) and e.func.id in funcs:  # helper that returns an Input
            ret = [r.value for r in ast.walk(funcs[e.func.id]) if isinstance(r, ast.Return) and isinstance(r.value, ast.Call)]
            if not ret:
                return None
            i = self.v3_input(ret[-1], funcs, consts)
            if i is not None:
                for k in e.keywords:
                    if k.arg == 'optional' and isinstance(k.value, ast.Constant):
                        i.required = not k.value.value
            return i
        if not (isinstance(e.func, ast.Attribute) and e.func.attr == 'Input') or not e.args or not isinstance(e.args[0], ast.Constant):
            return None
        kw = {k.arg: k.value for k in e.keywords}
        optional = isinstance(kw.get('optional'), ast.Constant) and kw['optional'].value is True
        t = self.v3_type(e.func.value)
        options, folder = None, None
        if t == 'COMBO' and 'options' in kw:
            options, folder = self.combo(kw['options'], consts)
        dynamic = t.startswith('COMFY_DYNAMIC') or t == 'COMFY_AUTOGROW_V3'
        return Inp(e.args[0].value, t, not optional and t != 'COMFY_AUTOGROW_V3', options, folder, dynamic=dynamic)

    def combo(self, node, consts, cls_attrs=None):
        lit = literal_list(node)
        if lit is not None:
            return lit, None
        if isinstance(node, ast.Call) and dotted(node.func).endswith('get_filename_list') and node.args and isinstance(node.args[0], ast.Constant):
            return None, node.args[0].value
        if isinstance(node, ast.Call) and dotted(node.func) == 'sorted' and node.args:
            return self.combo(node.args[0], consts, cls_attrs)
        if isinstance(node, ast.ListComp) and node.generators:  # [f for f in get_filename_list("x") if ...]
            return None, self.combo(node.generators[0].iter, consts, cls_attrs)[1]
        name = dotted(node)
        if name in SPECIAL_OPTIONS:
            return SPECIAL_OPTIONS[name], None
        if isinstance(node, ast.Name) and node.id in consts:
            return self.combo(consts[node.id], consts, cls_attrs)
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id in ('s', 'cls', 'self') and cls_attrs and node.attr in cls_attrs:
            return self.combo(cls_attrs[node.attr], consts, cls_attrs)
        return None, None

    def legacy(self, name, c, classes, src, consts):
        d = NodeDef(name, src)
        attrs = self.class_attrs(c, classes)
        d.output_node = isinstance(attrs.get('OUTPUT_NODE'), ast.Constant) and attrs['OUTPUT_NODE'].value is True
        d.deprecated = isinstance(attrs.get('DEPRECATED'), ast.Constant) and attrs['DEPRECATED'].value is True
        rt = attrs.get('RETURN_TYPES')
        if isinstance(rt, ast.Tuple):
            for e in rt.elts:
                d.outputs.append(e.value if isinstance(e, ast.Constant) else (e.attr if isinstance(e, ast.Attribute) else '*'))
        it = self.find_method(c, classes, 'INPUT_TYPES')
        spec = None
        if it is not None:
            local = {}
            for node in ast.walk(it):
                if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
                    local[node.targets[0].id] = node.value
            rets = [r.value for r in ast.walk(it) if isinstance(r, ast.Return)]
            if rets:
                spec = rets[-1]
                if isinstance(spec, ast.Name):
                    spec = local.get(spec.id)
        if not isinstance(spec, ast.Dict):
            d.parsed = False
            self.nodes[name] = d
            return
        for k, v in zip(spec.keys, spec.values):
            if not isinstance(k, ast.Constant) or k.value not in ('required', 'optional') or not isinstance(v, ast.Dict):
                if isinstance(k, ast.Constant) and k.value in ('required', 'optional'):
                    d.parsed = False
                continue
            for ik, iv in zip(v.keys, v.values):
                if not isinstance(ik, ast.Constant) or not isinstance(iv, ast.Tuple) or not iv.elts:
                    d.parsed = False
                    continue
                t = iv.elts[0]
                options, folder, typ = None, None, '*'
                if isinstance(t, ast.Constant) and isinstance(t.value, str):
                    typ = t.value
                elif isinstance(t, ast.Attribute) and dotted(t).split('.')[0] == 'IO':
                    typ = t.attr
                else:
                    typ = 'COMBO'
                    options, folder = self.combo(t, consts, attrs)
                d.inputs[ik.value] = Inp(ik.value, typ, k.value == 'required', options, folder)
        self.nodes[name] = d

    def class_attrs(self, c, classes, seen=None):
        seen = seen or set()
        out = {}
        for b in c.bases:
            if isinstance(b, ast.Name) and b.id in classes and b.id not in seen:
                seen.add(b.id)
                out.update(self.class_attrs(classes[b.id], classes, seen))
        for node in c.body:
            if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
                out[node.targets[0].id] = node.value
        return out

    def find_method(self, c, classes, name):
        for node in c.body:
            if isinstance(node, ast.FunctionDef) and node.name == name:
                return node
        for b in c.bases:
            if isinstance(b, ast.Name) and b.id in classes:
                m = self.find_method(classes[b.id], classes, name)
                if m is not None:
                    return m
        return None


def literal_ok(inp, v):
    t = inp.type
    if t == 'INT':
        return isinstance(v, int) and not isinstance(v, bool)
    if t == 'FLOAT':
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if t == 'STRING':
        return isinstance(v, str)
    if t == 'BOOLEAN':
        return isinstance(v, bool)
    if t == 'COMBO' or inp.dynamic:
        return inp.options is None or v in inp.options
    return False  # a MODEL/CLIP/... input must be a link


def validate_workflow(name, graph, index, targets):
    """Returns a list of problems (empty = valid)."""
    errs = []
    for nid, node in graph.items():
        if not re.fullmatch(r'[a-z][a-z0-9_]*', nid):
            errs.append(f'{nid}: node ids are lower_snake_case names')
        ct = node.get('class_type')
        d = index.nodes.get(ct)
        if d is None:
            errs.append(f'{nid}: {ct} is not a core ComfyUI node in the pinned version')
            continue
        if d.deprecated:
            errs.append(f'{nid}: {ct} is deprecated')
        if not d.parsed:
            errs.append(f'{nid}: could not read the inputs of {ct} from {d.src}')
            continue
        ins = node.get('inputs', {})
        for iname, v in ins.items():
            root = iname.split('.')[0]
            spec = d.inputs.get(iname) or d.inputs.get(root)
            if spec is None or (iname != root and not spec.dynamic):
                errs.append(f'{nid}.{iname}: {ct} has no such input')
                continue
            if isinstance(v, list):
                if len(v) != 2 or v[0] not in graph or not isinstance(v[1], int):
                    errs.append(f'{nid}.{iname}: bad link {v}')
                    continue
                src = index.nodes.get(graph[v[0]]['class_type'])
                if src is None:
                    continue
                if v[1] >= len(src.outputs):
                    errs.append(f'{nid}.{iname}: {graph[v[0]]["class_type"]} has no output {v[1]}')
                    continue
                st = src.outputs[v[1]]
                wild = ('*', 'COMBO', 'COMFY_MATCHTYPE_V3')  # MatchType: the type of whatever is connected (ResizeImageMaskNode)
                if iname == root and spec.type not in wild and st not in wild and st != spec.type:
                    errs.append(f'{nid}.{iname}: expects {spec.type}, gets {st} from {v[0]}')
            elif iname == root:
                if not literal_ok(spec, v):
                    errs.append(f'{nid}.{iname}: {v!r} is not a valid {spec.type}' + (f' (options {spec.options[:8]}...)' if spec.options else ''))
                if spec.folder and f'{spec.folder}/{v}' not in targets:
                    errs.append(f'{nid}.{iname}: {spec.folder}/{v} is not in the models manifest')
        for iname, spec in d.inputs.items():
            if spec.required and iname not in ins:
                errs.append(f'{nid}: required input {iname} of {ct} is missing')
    # every node must feed an output node; no cycles
    outs = [n for n, node in graph.items() if index.nodes.get(node.get('class_type')) and index.nodes[node['class_type']].output_node]
    if not outs:
        errs.append('no output node')
    reach, stack = set(), list(outs)
    while stack:
        n = stack.pop()
        if n in reach:
            continue
        reach.add(n)
        stack += [v[0] for v in graph[n]['inputs'].values() if isinstance(v, list) and v and v[0] in graph]
    for n in graph:
        if n not in reach:
            errs.append(f'{n}: does not feed any output')
    state = {}

    def cyc(n):
        if state.get(n) == 1:
            return True
        if state.get(n) == 2:
            return False
        state[n] = 1
        r = any(cyc(v[0]) for v in graph[n]['inputs'].values() if isinstance(v, list) and v and v[0] in graph)
        state[n] = 2
        return r
    if any(cyc(n) for n in graph):
        errs.append('the graph has a cycle')
    return errs


# =============================================================================================
# 1. workflows against the pinned ComfyUI source
# =============================================================================================

def manifest_targets(path):
    m = load_json(path)
    return m, {e['target'] for e in m['models'] if e.get('root', 'models') == 'models'}


def test_workflows(manifest_path, wf_dir, label, custom_dirs=()):
    m, targets = manifest_targets(manifest_path)
    src = comfy_source(m['comfyui']['commit'])
    dirs = [custom_node_source(n) for n in m.get('custom_nodes', [])]
    if not src or None in dirs:
        return skip(f'{label}: workflow validation needs the ComfyUI {m["comfyui"]["version"]} and custom node sources (offline)')
    index = Index(src, dirs)
    for n, d in zip(m.get('custom_nodes', []), dirs):
        found = sorted(k for k, x in index.nodes.items() if n['name'] in x.src)
        check(len(found) >= 3, f"{label}: custom node {n['name']} at {n['commit'][:12]} ({n['license']}) registers {', '.join(found)}")
    check(len(index.nodes) > 300 and 'KSampler' in index.nodes and 'Wan22ImageToVideoLatent' in index.nodes,
          f'{label}: indexed {len(index.nodes)} nodes from ComfyUI {m["comfyui"]["version"]} ({m["comfyui"]["commit"][:12]}) source')
    used = set()
    for fn in sorted(os.listdir(wf_dir)):
        if not fn.endswith('.json'):
            continue
        graph = load_json(os.path.join(wf_dir, fn))
        errs = validate_workflow(fn, graph, index, targets)
        check(not errs, f'{label}: {fn}: {len(graph)} nodes, all core/pinned classes, inputs set and wired' + ('' if not errs else ' -> ' + '; '.join(errs)))
        for node in graph.values():
            for k, v in node['inputs'].items():
                if isinstance(v, str):
                    for t in targets:
                        if t.endswith('/' + v):
                            used.add(t)
    unused = targets - used - {e['target'] for e in m['models'] if e.get('implicit')}
    check(not unused, f'{label}: every model in the manifest is used by a workflow' + (f' (unused: {sorted(unused)})' if unused else ''))
    return index


def test_validator_catches_mistakes(index, wf_path, targets):
    """The checker itself: each broken copy of a good workflow must be reported."""
    good = load_json(wf_path)
    loader = next(n for n, v in good.items() if v['class_type'] == 'UNETLoader')
    sampler = next(n for n, v in good.items() if v['class_type'] in ('KSampler', 'KSamplerAdvanced', 'SamplerCustomAdvanced'))
    first_link = next(k for k, v in good[sampler]['inputs'].items() if isinstance(v, list))
    cases = {
        'an unknown node class': lambda g: g[loader].update(class_type='UNETLoaderPlus'),
        'a missing required input': lambda g: g[loader]['inputs'].pop('unet_name'),
        'an unknown input name': lambda g: g[loader]['inputs'].update(unet_nam='x'),
        'a model file not in the manifest': lambda g: g[loader]['inputs'].update(unet_name='other.safetensors'),
        'a combo value not in its options': lambda g: g[loader]['inputs'].update(weight_dtype='fp4'),
        'a link to a missing node': lambda g: g[sampler]['inputs'].update({first_link: ['nope', 0]}),
        'a link to an output that does not exist': lambda g: g[sampler]['inputs'].update({first_link: [loader, 3]}),
        'a link of the wrong type': lambda g: g[sampler]['inputs'].update({first_link: ['vae', 0]}),
        'a literal where a link is needed': lambda g: g[sampler]['inputs'].update({first_link: 'MODEL'}),
        'a string where an INT goes': lambda g: g['latent']['inputs'].update(width='832'),
        'a node feeding nothing': lambda g: g.update(stray={'class_type': 'VAELoader', 'inputs': {'vae_name': 'wan_2.1_vae.safetensors'}}),
    }
    for what, mutate in cases.items():
        g = json.loads(json.dumps(good))
        mutate(g)
        check(bool(validate_workflow('x', g, index, targets)), f'the workflow checker catches {what}')


# =============================================================================================
# 2. manifests, Dockerfile, URLs, the FastWan rename
# =============================================================================================

LICENSES_OK = {'Apache-2.0', 'MIT', 'BSD-3-Clause'}


def dockerfile_fetches(path):
    with open(path, encoding='utf-8') as f:
        text = f.read().replace('\\\n', ' ')
    rows = []
    for line in text.splitlines():
        if 'fetch_model.py' in line and line.strip().startswith('RUN') and '--summary' not in line:
            parts = line.split('fetch_model.py', 1)[1].split()
            rows.append(parts)
    return text, rows


def test_manifest(manifest_path, dockerfile, commercial, baked=True):
    m = load_json(manifest_path)
    name = os.path.basename(manifest_path)
    ids = [e['id'] for e in m['models']]
    check(len(ids) == len(set(ids)), f'{name}: model ids are unique')
    for e in m['models']:
        ok = (re.fullmatch(r'https://huggingface\.co/[\w.-]+/[\w.-]+/resolve/[0-9a-f]{40}/.+', e['url']) and re.fullmatch(r'[0-9a-f]{64}', e['sha256'])
              and isinstance(e['size'], int) and e['size'] > 0 and e.get('license') and e.get('card', '').startswith('https://huggingface.co/')
              and not e['target'].startswith('/') and '..' not in e['target'] and e.get('commercial') is commercial)
        check(bool(ok), f"{name}: {e['id']}: URL pinned to a commit, sha256, size, target, license {e.get('license')}, commercial={e.get('commercial')}")
        if commercial:
            check(e['license'] in LICENSES_OK, f"{name}: {e['id']}: license {e['license']} allows commercial use")
    text, rows = dockerfile_fetches(dockerfile)
    if baked:
        by_dest = {r[3]: r for r in rows if len(r) >= 4}
        for e in m['models']:
            dest = f"/{e.get('root', 'models')}/{e['target']}"
            check(by_dest.get(dest) == [e['url'], e['sha256'], str(e['size']), dest], f"{os.path.basename(dockerfile)}: layer for {e['id']} matches the manifest exactly")
        check(len(rows) == len(m['models']), f'{os.path.basename(dockerfile)}: one fetch layer per model ({len(rows)} layers, {len(m["models"])} models)')
    else:
        check(not rows and 'volume.py' in text and 'MASSLESS_VOLUME=/runpod-volume/massless' in text and 'ffmpeg' in text,
              f'{os.path.basename(dockerfile)}: no weights in the image; it ships volume.py and points at /runpod-volume (and has ffmpeg)')
        folders = {e['target'].split('/')[0] for e in m['models']}
        check(all(e['target'].count('/') == 1 for e in m['models']) and folders <= {'diffusion_models', 'loras', 'text_encoders', 'vae', 'clip_vision', 'audio_encoders', 'upscale_models'},
              f'{name}: every target is <ComfyUI model folder>/<file> ({sorted(folders)})')
        lic = {e['license'] for e in m['models']}
        check(lic <= LICENSES_OK, f'{name}: licenses {sorted(lic)} (Apache-2.0/MIT/BSD only on the main endpoint)')
    check(m['comfyui']['commit'] in text, f'{os.path.basename(dockerfile)}: installs ComfyUI at the pinned commit {m["comfyui"]["commit"][:12]}')
    for n in m.get('custom_nodes', []):
        check(n['commit'] in text and n['repo'] in text, f"{os.path.basename(dockerfile)}: installs {n['name']} at the pinned commit {n['commit'][:12]}")
    for r in m.get('hf_refs', []):
        check(f"models--{r['repo'].replace('/', '--')}/refs/main" in text and r['revision'] in text, f"{os.path.basename(dockerfile)}: writes the Hugging Face cache ref for {r['repo']}")
    total = sum(e['size'] for e in m['models'])
    print(f'     {name}: {len(m["models"])} files, {total / 1e9:.2f} GB of weights')
    return m


def head(url):
    req = urllib.request.Request(url, method='HEAD', headers={'user-agent': 'massless-tests'})

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    try:
        r = opener.open(req, timeout=30)
        return r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers)


def test_urls(m):
    if OFFLINE:
        return skip('model URL HEAD checks (offline)')

    def one(e):
        try:
            status, h = head(e['url'])
            if e['size'] < 5_000_000:  # small files are not in LFS (their etag is a git sha1): fetch and hash them
                with urllib.request.urlopen(urllib.request.Request(e['url'], headers={'user-agent': 'massless-tests'}), timeout=60) as r:
                    body = r.read()
                h = dict(h, **{'x-linked-size': str(len(body)), 'x-linked-etag': hashlib.sha256(body).hexdigest()})
        except Exception as ex:
            return e, None, str(ex)
        return e, status, h
    with ThreadPoolExecutor(8) as ex:
        for e, status, h in ex.map(one, m['models']):
            if status is None:
                check(False, f"HEAD {e['id']}: {h}")
                continue
            hl = {k.lower(): v for k, v in h.items()}
            size = int(hl.get('x-linked-size') or hl.get('content-length') or -1)
            etag = (hl.get('x-linked-etag') or hl.get('etag') or '').strip('"')
            check(status in (200, 302, 307) and size == e['size'] and (etag == e['sha256'] or not hl.get('x-linked-etag')),
                  f"HEAD {e['id']}: {status}, {size} bytes" + (', sha256 matches' if etag == e['sha256'] else ''))


# =============================================================================================
# 2b. the model volume: download, verify, resume, lock (workers/gpu/volume.py) against a fake Hugging Face
# =============================================================================================

class FakeHF:
    """Serves model files with Range support. Per file: corrupt (wrong bytes, same size), drop (close after N bytes
    once), slow (seconds per 64 KB), no_range (ignore Range, always 200), extra (serve more bytes than recorded)."""

    def __init__(self, files):
        self.files = dict(files)  # name -> bytes
        self.gets, self.ranges, self.rules = {}, {}, {}
        self.lock = threading.Lock()
        fake = self

        class H(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *a):
                pass

            def do_GET(self):
                name = self.path.lstrip('/')
                data = fake.files.get(name)
                with fake.lock:
                    fake.gets[name] = fake.gets.get(name, 0) + 1
                    fake.ranges.setdefault(name, []).append(self.headers.get('Range'))
                    rule = dict(fake.rules.get(name, {}))
                if data is None:
                    self.send_response(404)
                    self.send_header('content-length', '0')
                    self.end_headers()
                    return
                if rule.get('corrupt'):
                    data = bytes(b ^ 0x55 for b in data)
                if rule.get('extra'):
                    data = data + b'x' * 1000
                start = 0
                rng = self.headers.get('Range')
                if rng and not rule.get('no_range'):
                    start = int(rng.split('=')[1].split('-')[0])
                    body = data[start:]
                    self.send_response(206)
                    self.send_header('content-range', f'bytes {start}-{len(data) - 1}/{len(data)}')
                else:
                    body = data
                    self.send_response(200)
                self.send_header('content-length', str(len(body)))
                self.end_headers()
                drop = rule.get('drop')
                if drop and fake.gets[name] == 1:
                    self.wfile.write(body[:drop])
                    self.wfile.flush()
                    self.close_connection = True
                    try:
                        self.connection.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                    return
                for i in range(0, len(body), 65536):
                    if rule.get('slow'):
                        time.sleep(rule['slow'])
                    self.wfile.write(body[i:i + 65536])

        self.server = ThreadingHTTPServer(('127.0.0.1', 0), H)
        self.server.daemon_threads = True
        self.base = f'http://127.0.0.1:{self.server.server_address[1]}'
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.server.shutdown()


def tiny_manifest(real, base, size=120_000):
    """The real manifest's ids, jobs and targets, with small deterministic files served by FakeHF."""
    files, models = {}, []
    for i, e in enumerate(real['models']):
        data = hashlib.sha256(e['id'].encode()).digest() * (size // 32 + i)
        files[e['id']] = data
        models.append(dict(e, url=f"{base}/{e['id']}", size=len(data), sha256=hashlib.sha256(data).hexdigest()))
    return dict(real, models=models), files


def test_volume():
    sys.path.insert(0, GPU)
    import volume as V
    sys.path.remove(GPU)
    real = load_json(os.path.join(GPU, 'models.json'))
    hf = FakeHF({})
    m, files = tiny_manifest(real, hf.base)
    hf.files.update(files)
    root = tempfile.mkdtemp()
    logs = []
    mk = lambda **kw: V.Volume(root, m, log=logs.append, downloader='python', **kw)  # noqa: E731
    try:
        v = mk()
        failed = v.ensure_all()
        ok = not failed and all(os.path.getsize(os.path.join(root, 'models', e['target'])) == e['size'] for e in m['models'])
        check(ok and all(hf.gets[e['id']] == 1 for e in m['models']), f"volume: a fresh volume gets all {len(m['models'])} files, one download each, verified by sha256")
        check(all(os.path.exists(os.path.join(root, '.verified', e['id'] + '.json')) for e in m['models']) and not os.listdir(os.path.join(root, '.incoming')),
              'volume: a marker per verified file; no .part or .lock left behind')
        st = v.status()
        check(st['ready'] and st['bytes_ready'] == st['bytes'] == sum(e['size'] for e in m['models']), f"volume: status reports {st['files_ready']}/{st['files']} files ready")

        # a second boot: stat + marker only, nothing downloaded or hashed again
        hashed = []
        real_sha = V.sha256_file
        V.sha256_file = lambda p, progress=None: hashed.append(p) or real_sha(p)
        before = dict(hf.gets)
        failed = mk().ensure_all()
        V.sha256_file = real_sha
        check(not failed and hf.gets == before and not hashed, 'volume: the next worker start downloads and hashes nothing (size + marker)')

        # a file changed on the volume after it was verified: hashed again, replaced when wrong
        e = m['models'][0]
        p = os.path.join(root, 'models', e['target'])
        with open(p, 'r+b') as f:
            f.write(b'\0' * 64)
        check(not mk().ready(e), 'volume: a file whose mtime no longer matches its marker is not trusted')
        mk().ensure(e)
        with open(p, 'rb') as f:
            check(hashlib.sha256(f.read()).hexdigest() == e['sha256'] and hf.gets[e['id']] == 2, 'volume: a damaged file is hashed, removed and fetched again')

        # a correct file copied in by hand (no marker): adopted after one hash, no download
        e = m['models'][1]
        os.remove(os.path.join(root, '.verified', e['id'] + '.json'))
        n = hf.gets[e['id']]
        mk().ensure(e)
        check(hf.gets[e['id']] == n and os.path.exists(os.path.join(root, '.verified', e['id'] + '.json')), 'volume: a right file without a marker is kept after one hash')

        def reset(e):
            for q in (os.path.join(root, 'models', e['target']), os.path.join(root, '.verified', e['id'] + '.json')):
                if os.path.exists(q):
                    os.remove(q)

        # resume: a partial .part continues with a Range request
        e = m['models'][2]
        reset(e)
        os.makedirs(os.path.join(root, '.incoming'), exist_ok=True)
        with open(os.path.join(root, '.incoming', e['id'] + '.part'), 'wb') as f:
            f.write(files[e['id']][:50_000])
        mk().ensure(e)
        check(hf.ranges[e['id']][-1] == 'bytes=50000-' and mk().ready(e), 'volume: a partial download resumes from where it stopped (Range: bytes=50000-)')

        # a server that ignores Range: starts over, still right
        e = m['models'][3]
        reset(e)
        with open(os.path.join(root, '.incoming', e['id'] + '.part'), 'wb') as f:
            f.write(b'junk' * 1000)
        hf.rules[e['id']] = {'no_range': True}
        mk().ensure(e)
        check(mk().ready(e), 'volume: when the server ignores Range, the download starts over and verifies')

        # the connection drops mid-file: retried, resumed, verified
        e = m['models'][4]
        reset(e)
        hf.gets[e['id']] = 0
        hf.rules[e['id']] = {'drop': 30_000}
        V.NET_CHUNK, real_sleep = 16384, V.time.sleep
        V.time.sleep = lambda s: None
        try:
            mk().ensure(e)
        finally:
            V.time.sleep, V.NET_CHUNK = real_sleep, 1024 * 1024
        check(mk().ready(e) and hf.gets[e['id']] == 2 and (hf.ranges[e['id']][-1] or '').startswith('bytes=') and hf.ranges[e['id']][-1] != 'bytes=0-',
              f"volume: a dropped connection is retried and resumed ({hf.ranges[e['id']][-1]})")

        # wrong bytes: never kept, never resumed from, refused after a second try
        e = m['models'][5]
        reset(e)
        hf.gets[e['id']] = 0
        hf.rules[e['id']] = {'corrupt': True}
        try:
            mk().ensure(e)
            got = None
        except V.VolumeError as ex:
            got = str(ex)
        check(got and 'does not match the pinned sha256' in got and hf.gets[e['id']] == 2 and not os.path.exists(os.path.join(root, '.incoming', e['id'] + '.part'))
              and not os.path.exists(os.path.join(root, 'models', e['target'])), f'volume: a hash mismatch is downloaded once more, then refused: "{got}"')
        check(not os.path.exists(os.path.join(root, '.incoming', e['id'] + '.lock')), 'volume: the lock is released after a failure')
        hf.rules[e['id']] = {'extra': True}
        try:
            mk().ensure(e)
            got = None
        except V.VolumeError as ex:
            got = str(ex)
        check(got and 'larger than' in got, 'volume: a download longer than the recorded size is refused')
        hf.rules.pop(e['id'])
        mk().ensure(e)

        # two workers want the same file: one downloads, the other waits for it
        e = m['models'][6]
        reset(e)
        hf.gets[e['id']] = 0
        hf.rules[e['id']] = {'slow': 0.4}
        la, lb = [], []
        a = V.Volume(root, m, log=la.append, downloader='python', heartbeat=0.05)
        b = V.Volume(root, m, log=lb.append, downloader='python', heartbeat=0.05)
        errs = []

        def go(v):
            try:
                v.ensure(e, poll=0.05)
            except Exception as ex:  # pragma: no cover
                errs.append(ex)
        ta, tb = threading.Thread(target=go, args=(a,)), threading.Thread(target=go, args=(b,))
        ta.start()
        time.sleep(0.1)
        tb.start()
        ta.join(30)
        tb.join(30)
        check(not errs and hf.gets[e['id']] == 1 and a.ready(e) and b.state[e['id']]['state'] == 'ready'
              and any('downloading' in x for x in la) and not any('downloading' in x for x in lb),
              f"volume: two workers, one file: one download, the other waited on the lock ({hf.gets[e['id']]} GET)")
        hf.rules.pop(e['id'])

        # a fresh lock held by someone else: wait, then NotReady; a stale one is taken over
        e = m['models'][7]
        reset(e)
        lf = os.path.join(root, '.incoming', e['id'] + '.lock')
        with open(lf, 'w') as f:
            f.write('{"by": "another-worker"}')
        try:
            mk(stale=300).ensure(e, wait=0.3, poll=0.05)
            got = None
        except V.NotReady as ex:
            got = str(ex)
        check(got and 'another worker' in got, 'volume: a live lock is respected (the job gets NotReady instead of a second download)')
        os.utime(lf, (time.time() - 1000, time.time() - 1000))
        mk(stale=300).ensure(e)
        check(mk().ready(e) and not os.path.exists(lf), 'volume: a lock nobody refreshed for 300 s is taken over (its worker died)')

        # a full volume is a clear error
        e = m['models'][8]
        reset(e)
        real_du = V.shutil.disk_usage
        V.shutil.disk_usage = lambda path: types.SimpleNamespace(total=10, used=10, free=1000)
        try:
            mk().ensure(e)
            got = None
        except V.VolumeError as ex:
            got = str(ex)
        finally:
            V.shutil.disk_usage = real_du
        check(got and 'The volume is full' in got, f'volume: not enough free space says so: "{(got or "")[:80]}"')
        mk().ensure(e)

        # aria2c path (a stand-in binary that downloads with urllib), hashed after
        e = m['models'][9]
        reset(e)
        bindir = tempfile.mkdtemp()
        fake_aria = os.path.join(bindir, 'aria2c')
        with open(fake_aria, 'w') as f:
            f.write(f"""#!{sys.executable}
import sys, os, urllib.request
a = sys.argv[1:]
d, o, url = a[a.index('-d') + 1], a[a.index('-o') + 1], a[-1]
assert '--continue=true' in a and '--split=16' in a
with urllib.request.urlopen(url) as r, open(os.path.join(d, o), 'wb') as f:
    f.write(r.read())
""")
        os.chmod(fake_aria, 0o755)
        os.environ['ARIA2C'] = fake_aria
        try:
            V.Volume(root, m, log=logs.append, downloader='aria2c').ensure(e)
        finally:
            os.environ.pop('ARIA2C', None)
            shutil.rmtree(bindir, ignore_errors=True)
        check(mk().ready(e), 'volume: the aria2c downloader (16 connections, resumable) is used when installed, and its file is verified')

        # ComfyUI's model folders on the volume
        y = V.comfy_paths_yaml(root)
        try:
            import yaml
            cfg = yaml.safe_load(y)['massless_volume']
            ok = cfg['base_path'] == os.path.join(root, 'models') and cfg['is_default'] is True and all(cfg[k] == k for k in V.FOLDERS)
        except ImportError:
            ok = f'base_path: {os.path.join(root, "models")}' in y
        check(ok, 'volume: extra_model_paths.yaml points every ComfyUI model folder at the volume')
        folders = {e['target'].split('/')[0] for e in real['models']}
        check(folders <= set(V.FOLDERS), f'volume: the YAML covers every folder the manifest uses ({sorted(folders)})')
        with open(os.path.join(root, 'm.json'), 'w') as f:
            json.dump(m, f)
        rc = V.main(['--root', root, '--manifest', os.path.join(root, 'm.json'), '--status'])
        check(rc == 0, 'volume: python volume.py --status (for a CPU pod) reports a complete volume')
    finally:
        hf.stop()
        shutil.rmtree(root, ignore_errors=True)
    return m, files


# =============================================================================================
# 3. the handler against the fake ComfyUI
# =============================================================================================

def b64_image(w, h, fmt='JPEG', mode='RGB', color=(200, 80, 40)):
    from PIL import Image
    buf = io.BytesIO()
    Image.new(mode, (w, h), color if mode == 'RGB' else color + (128,)).save(buf, fmt)
    return base64.b64encode(buf.getvalue()).decode()


class StubRunpod:
    def __init__(self):
        self.updates = []
        self.serverless = types.SimpleNamespace(progress_update=lambda job, p: self.updates.append(p), start=lambda cfg: None)


def import_handler(fake_host, comfy_dir, image='main', workflows=None, volume='off', manifest=None):
    stub = StubRunpod()
    sys.modules['runpod'] = stub  # never talk to RunPod from the tests
    os.environ.update({'COMFY_DIR': comfy_dir, 'COMFY_HOST': fake_host, 'COMFY_START': '0', 'MASSLESS_IMAGE': image,
                       'MASSLESS_WORKFLOWS': workflows or os.path.join(GPU, 'workflows'), 'MASSLESS_VOLUME': volume,
                       'MASSLESS_MANIFEST': manifest or os.path.join(GPU, 'models.json'), 'MASSLESS_MODEL_WAIT': '0'})
    sys.modules.pop('volume', None)
    sys.path.insert(0, GPU)
    sys.modules.pop('handler', None)
    import handler
    sys.path.remove(GPU)
    return handler, stub


def run_job(h, inp, job_id='job-1'):
    return h.handler({'id': job_id, 'input': inp})


def leftovers(root):
    out = []
    for d in ('input', 'output'):
        for base, _, names in os.walk(os.path.join(root, d)):
            out += [os.path.join(base, n) for n in names]
    return out


def make_audio(path, seconds=3, rate=44100):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'sine=frequency=220:duration={seconds}:sample_rate={rate}', path], check=True)
    with open(path, 'rb') as f:
        return f.read()


def graph_ok(index, graph, what):
    """A graph the handler built (modes rewired, chunks added) is checked like the workflow files."""
    if index is None:
        return
    targets = {e['target'] for e in load_json(os.path.join(GPU, 'models.json'))['models']}
    g = json.loads(json.dumps(graph))
    errs = validate_workflow(what, g, index, targets)
    check(not errs, f'{what}: the submitted graph passes the ComfyUI source check' + ('' if not errs else ' -> ' + '; '.join(errs)))


def test_handler_main(index=None):
    tmp = tempfile.mkdtemp()
    fake = FakeComfy(tmp).start()
    sys.path.insert(0, GPU)
    import volume as V
    sys.path.remove(GPU)
    hf = FakeHF({})
    vm, vfiles = tiny_manifest(load_json(os.path.join(GPU, 'models.json')), hf.base, size=4000)
    hf.files.update(vfiles)
    vol = os.path.join(tmp, 'runpod-volume', 'massless')
    os.makedirs(vol)
    mpath = os.path.join(tmp, 'models.test.json')
    with open(mpath, 'w') as f:
        json.dump(vm, f)
    V.Volume(vol, vm, log=lambda m: None, downloader='python').ensure_all()
    media = shutil.which('ffmpeg') and shutil.which('ffprobe')
    try:
        h, stub = import_handler(fake.host, tmp, volume=vol, manifest=mpath)
        h.VOLUME.downloader = 'python'
        h.VOLUME.log = lambda m: None
        has_ws = h.websocket is not None
        if not has_ws:
            skip('websocket path (pip install websocket-client); the /history polling path is still tested')
        last = lambda: list(fake.prompts.values())[-1]  # noqa: E731

        # ---- animate: image to video, Quick (Wan2.2-Lightning LoRA, 4 steps, no CFG)
        img = b64_image(1000, 700)
        out = run_job(h, {'job': 'animate', 'image': img, 'prompt': 'the sea breathes', 'seed': 42})
        ok = 'error' not in out and out['type'] == 'video' and out['mime'] == 'video/mp4' and base64.b64decode(out['data'])[4:8] == b'ftyp'
        check(ok, f"animate (i2v quick): {out.get('error') or out['model']}, {out.get('width')}x{out.get('height')}, {out.get('duration')} s, {out.get('seconds')} s wall")
        g = last()
        hi, lo = g['sampler_high']['inputs'], g['sampler_low']['inputs']
        check(hi['noise_seed'] == 42 and (hi['steps'], hi['cfg'], hi['end_at_step']) == (4, 1.0, 2) and (lo['steps'], lo['cfg'], lo['start_at_step']) == (4, 1.0, 2)
              and g['prompt']['inputs']['text'] == 'the sea breathes' and (g['latent']['inputs']['width'], g['latent']['inputs']['height'], g['latent']['inputs']['length']) == (832, 480, 81)
              and g['image_in']['inputs']['image'].startswith('massless_') and g['shift_high']['inputs']['model'] == ['lora_high', 0]
              and g['unet_high']['inputs']['unet_name'] == 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
              'animate quick: high-noise expert steps 0-2 and low-noise 2-4 with the 4-step LoRA, cfg 1, 832x480x81, seed, prompt and upload set')
        check(all(k in out for k in ('type', 'mime', 'data', 'width', 'height', 'duration', 'seconds', 'model', 'seed')) and out['seed'] == 42 and out['steps'] == 4
              and out['fps'] == 16 and out['model'] == 'wan2.2-i2v-a14b-lightning-4step', 'animate: output has type, mime, data, width, height, duration, seconds, model, seed (16 fps)')
        graph_ok(index, g, 'animate i2v quick')
        check(not leftovers(tmp), 'animate: the uploaded frame and the rendered MP4 are deleted afterwards')
        pct = [u['percent'] for u in stub.updates]
        check(len(stub.updates) >= 3 and pct == sorted(pct) and any('Rendering' in u['text'] for u in stub.updates) if has_ws else len(stub.updates) >= 1,
              f'progress: {len(stub.updates)} runpod progress updates, percent never goes down ({pct[:3]}..{pct[-1:]})')
        check(len([c for c in fake.calls if c[1] == '/upload/image']) == 1, 'animate: one upload per job')

        # ---- animate: Best (no LoRA, CFG, full steps), 720p portrait
        out = run_job(h, {'job': 'animate', 'image': img, 'mode': 'best', 'resolution': '720p', 'aspect': '9:16', 'steps': 12, 'cfg': 4, 'negative': 'blurry', 'seed': 7})
        g = last()
        check('error' not in out and (out['width'], out['height']) == (720, 1280) and 'lora_high' not in g and 'lora_low' not in g
              and g['shift_high']['inputs']['model'] == ['unet_high', 0] and g['shift_low']['inputs']['model'] == ['unet_low', 0]
              and (g['sampler_high']['inputs']['steps'], g['sampler_high']['inputs']['end_at_step'], g['sampler_low']['inputs']['start_at_step'], g['sampler_high']['inputs']['cfg']) == (12, 6, 6, 4.0)
              and g['negative']['inputs']['text'] == 'blurry' and g['save']['inputs']['format.codec.encoding.crf'] == 20.0 and out['model'] == 'wan2.2-i2v-a14b',
              f"animate best (720p 9:16, 12 steps, cfg 4): LoRAs removed, experts at full strength: {out.get('error') or out['model']}")
        graph_ok(index, g, 'animate i2v best')

        # ---- animate: text to video
        n_up = len(fake.uploads)
        out = run_job(h, {'job': 'animate', 'prompt': 'a paper boat drifting down a rainy street', 'resolution': '720p'})
        g = last()
        check('error' not in out and 'image_in' not in g and g['latent']['class_type'] == 'EmptyHunyuanLatentVideo' and (out['width'], out['height']) == (1280, 720)
              and g['unet_low']['inputs']['unet_name'].startswith('wan2.2_t2v_low') and g['lora_low']['inputs']['lora_name'].startswith('wan2.2_t2v_lightx2v')
              and len(fake.uploads) == n_up and out['source'] == 'text', f"animate t2v (no image): T2V-A14B, nothing uploaded: {out.get('error') or out['model']}")
        graph_ok(index, g, 'animate t2v quick')

        # ---- music
        out = run_job(h, {'job': 'music', 'tags': 'synthwave, driving bass', 'lyrics': '[verse]\nneon on the water', 'duration': 45, 'bpm': 104, 'key': 'A minor', 'seed': 5})
        g = last()
        check('error' not in out and out['mime'] == 'audio/mpeg' and base64.b64decode(out['data'])[:3] == b'ID3' and out['duration'] == 45.0
              and g['text']['inputs']['bpm'] == 104 and g['text']['inputs']['keyscale'] == 'A minor' and g['latent']['inputs']['seconds'] == 45.0
              and g['text']['inputs']['duration'] == 45.0 and g['sampler']['inputs']['seed'] == 5,
              f"music: {out.get('error') or out['model']}, {out.get('duration')} s, tags/lyrics/bpm/key/seconds set")
        out = run_job(h, {'job': 'music', 'tags': 'ambient pads'})
        g = last()
        check('error' not in out and g['text']['inputs']['lyrics'] == '[Instrumental]' and out['instrumental'] and out['duration'] == 30.0,
              'music: no lyrics means an instrumental, 30 s by default')

        # ---- upscale
        from PIL import Image
        out = run_job(h, {'job': 'upscale', 'image': b64_image(300, 200, 'PNG'), 'scale': 2})
        im = Image.open(io.BytesIO(base64.b64decode(out['data']))) if 'data' in out else None
        check(im is not None and im.format == 'JPEG' and im.size == (600, 400) and out['mime'] == 'image/jpeg' and out['quality'] == 92,
              f"upscale 2x PNG -> JPEG q92: {out.get('error') or im.size}")
        out = run_job(h, {'job': 'upscale', 'image': b64_image(1536, 1024), 'scale': 4, 'format': 'webp'})
        im = Image.open(io.BytesIO(base64.b64decode(out['data']))) if 'data' in out else None
        check(im is not None and im.format == 'WEBP' and im.size == (4096, 2731) and out['scale'] < 4,
              f"upscale 4x of 1536 px is capped at 4096 on the long side, WebP: {out.get('error') or im.size}")
        check(not leftovers(tmp), 'cleanup after every job type')
        stale = os.path.join(tmp, 'output', 'massless', 'orphan_00001_.mp4')
        os.makedirs(os.path.dirname(stale), exist_ok=True)
        open(stale, 'wb').close()
        os.utime(stale, (time.time() - 3600, time.time() - 3600))
        run_job(h, {'job': 'music', 'tags': 'x'})
        check(not os.path.exists(stale), 'files a crashed job left behind are swept after the next job')

        if not media:
            skip('motion, lipsync and upscale_video (need ffmpeg and ffprobe)')
        else:
            # ---- motion: reference image + driving clip (30 fps, with sound) -> 16 fps 4n+1 frames, sound added back
            drive = base64.b64encode(make_mp4(os.path.join(tmp, 'drive.mp4'), seconds=3, size='640x360', fps=30)).decode()
            n_up = len(fake.uploads)
            out = run_job(h, {'job': 'motion', 'image': b64_image(600, 800), 'video': drive, 'prompt': 'Character description: a knight', 'seed': 9, 'steps': 8})
            g = last()
            ups = fake.uploads[n_up:]
            vid_up = [u for u in ups if u[1] == 'video/mp4']
            info = ffprobe(vid_up[0][2]) if vid_up else {'streams': []}
            vs = [x for x in info['streams'] if x['codec_type'] == 'video']
            check('error' not in out and len(ups) == 2 and vs and vs[0]['r_frame_rate'] == '16/1' and len(info['streams']) == 1
                  and g['image_in']['inputs']['image'].endswith('_main.png') and g['video_in']['inputs']['file'].endswith('_video.mp4'),
                  f"motion: the still and the driving clip are uploaded; ComfyUI gets the clip at 16 fps with no sound ({out.get('error') or vs[0]['r_frame_rate']})")
            n = out.get('frames', 0)
            check(g['animate']['inputs']['length'] == n and (n - 1) % 4 == 0 and 40 <= n <= 49 and (g['animate']['inputs']['width'], g['animate']['inputs']['height']) == (832, 480)
                  and (g['pose']['inputs']['resize_type.width'], g['pose']['inputs']['resize_type.height']) == (832, 480) and g['sigmas']['inputs']['steps'] == 8
                  and g['sampler']['inputs']['noise_seed'] == 9, f'motion: {n} frames (4n+1 of a 3 s clip at 16 fps), landscape 832x480, 8 steps, seed set')
            res = ffprobe(base64.b64decode(out['data'])) if 'data' in out else {'streams': []}
            check(sorted(x['codec_type'] for x in res['streams']) == ['audio', 'video'] and out['kept_audio'] is True and out['model'] == 'wan-animate-2-14b-distill',
                  "motion: the driving clip's sound is muxed back into the result")
            graph_ok(index, g, 'motion')
            portrait = base64.b64encode(make_mp4(os.path.join(tmp, 'tall.mp4'), seconds=2, size='360x640', fps=24, audio=False)).decode()
            out = run_job(h, {'job': 'motion', 'image': img, 'video': portrait, 'keep_audio': False})
            res = ffprobe(base64.b64decode(out['data'])) if 'data' in out else {'streams': [1, 2]}
            check('error' not in out and (out['width'], out['height']) == (480, 832) and len(res['streams']) == 1 and out['kept_audio'] is False,
                  f"motion: a portrait clip gives 480x832, silent: {out.get('error') or (out['width'], out['height'])}")
            check(not [d for d in os.listdir(tempfile.gettempdir()) if d.startswith('massless-motion-')], 'motion: its temp folder is removed')

            # ---- lipsync: face + 7 s of speech -> two 77-frame S2V chunks, trimmed to the speech
            speech = base64.b64encode(make_audio(os.path.join(tmp, 'speech.mp3'), seconds=7)).decode()
            n_up = len(fake.uploads)
            out = run_job(h, {'job': 'lipsync', 'image': b64_image(800, 800), 'audio': speech, 'seed': 3})
            g = last()
            wav = [u for u in fake.uploads[n_up:] if u[1] == 'audio/wav']
            a = ffprobe(wav[0][2], '.wav')['streams'][0] if wav else {}
            check('error' not in out and a.get('sample_rate') == '48000' and a.get('channels') == 2 and g['audio_in']['inputs']['audio'].endswith('_audio.wav'),
                  f"lipsync: the speech goes to ComfyUI as 48 kHz stereo WAV ({out.get('error') or a.get('sample_rate')})")
            check(out.get('chunks') == 2 and 'extend_1' in g and g['concat_1']['inputs']['samples1'] == ['sampler', 0] and g['joined']['inputs']['samples2'] == ['concat_1', 0]
                  and g['sampler_1']['inputs']['seed'] == 4 and g['frames']['inputs']['length'] == out['frames'] and 112 <= out['frames'] <= 114
                  and (out['width'], out['height']) == (640, 640) and g['shift']['inputs']['model'] == ['lora', 0] and g['sampler']['inputs']['cfg'] == 1.0,
                  f"lipsync quick: 7 s of speech -> 2 chunks chained, {out.get('frames')} frames, square face -> 640x640, LoRA, cfg 1")
            graph_ok(index, g, 'lipsync quick (2 chunks)')
            speech10 = base64.b64encode(make_audio(os.path.join(tmp, 'speech10.wav'), seconds=10)).decode()
            out = run_job(h, {'job': 'lipsync', 'image': img, 'audio': speech10, 'mode': 'best', 'steps': 12})
            g = last()
            check('error' not in out and out['chunks'] == 3 and 'lora' not in g and g['shift']['inputs']['model'] == ['unet', 0] and g['sampler_2']['inputs']['cfg'] == 6.0
                  and g['sampler_2']['inputs']['steps'] == 12 and g['joined']['inputs']['samples2'] == ['concat_2', 0] and out['aspect'] == '16:9',
                  f"lipsync best: 10 s -> 3 chunks, no LoRA, cfg 6, 12 steps: {out.get('error') or out['model']}")
            graph_ok(index, g, 'lipsync best (3 chunks)')

            # ---- upscale_video: SeedVR2, 2x or 4x up to 1920x1080, at most 30 fps
            clip60 = base64.b64encode(make_mp4(os.path.join(tmp, 'c60.mp4'), seconds=2, size='320x180', fps=60)).decode()
            n_up = len(fake.uploads)
            out = run_job(h, {'job': 'upscale_video', 'video': clip60, 'seed': 1})
            g = last()
            up = ffprobe(fake.uploads[-1][2]) if len(fake.uploads) > n_up else {'streams': []}
            vs = [x for x in up['streams'] if x['codec_type'] == 'video']
            check('error' not in out and (g['resize']['inputs']['resize_type.width'], g['resize']['inputs']['resize_type.height']) == (640, 360)
                  and vs and vs[0]['r_frame_rate'] == '30/1' and any(x['codec_type'] == 'audio' for x in up['streams']) and out['fps'] == 30 and 59 <= out['frames'] <= 61,
                  f"upscale_video: 320x180 at 60 fps -> 640x360, re-timed to 30 fps, sound kept ({out.get('error') or out['frames']} frames)")
            graph_ok(index, g, 'upscale_video')
            out = run_job(h, {'job': 'upscale_video', 'video': base64.b64encode(make_mp4(os.path.join(tmp, 'c4.mp4'), seconds=1, size='640x360', fps=24)).decode(), 'scale': 4})
            check((out.get('width'), out.get('height')) == (1920, 1080), f"upscale_video 4x of 640x360 is capped at 1920x1080: {out.get('error') or (out['width'], out['height'])}")
            big = base64.b64encode(make_mp4(os.path.join(tmp, 'c1080.mp4'), seconds=1, size='1920x1080', fps=24, audio=False)).decode()
            check('already as large' in run_job(h, {'job': 'upscale_video', 'video': big}).get('error', ''), 'upscale_video refuses a clip that is already 1080p')

            # ---- a video over the result limit is re-encoded to fit
            fake.reset(video_seconds=3, video_size='640x360', video_crf=4)
            h.MAX_RESULT_B64 = 400_000
            out = run_job(h, {'job': 'animate', 'image': img})
            h.MAX_RESULT_B64 = 15_000_000
            fake.reset()
            check('error' not in out and out.get('reencoded') is True and len(out['data']) <= 400_000 and ffprobe(base64.b64decode(out['data']))['streams'][0]['codec_name'] == 'h264',
                  f"a video over the result limit is re-encoded to fit ({out.get('error') or len(out['data'])} base64 bytes)")

        # ---- validation (none of these reach ComfyUI)
        n_prompts = len(fake.prompts)
        clip = base64.b64encode(fake_mp4()).decode()
        bad = [
            ({'job': 'paint'}, 'job must be one of'),
            ('not a dict', 'input must be a JSON object'),
            ({'job': 'animate'}, 'prompt is required'),
            ({'job': 'animate', 'image': 'abc$%^'}, 'not valid base64'),
            ({'job': 'animate', 'image': base64.b64encode(b'GIF89a' + b'\x00' * 100).decode()}, 'JPEG, PNG or WebP'),
            ({'job': 'animate', 'image': base64.b64encode(base64.b64decode(img)[:200]).decode()}, 'could not be decoded'),
            ({'job': 'animate', 'image': 'A' * 9_600_000}, 'limit is 9.5 MB'),
            ({'job': 'animate', 'image': b64_image(2400, 1000)}, 'limit is 2048 px'),
            ({'job': 'animate', 'image': b64_image(100, 100)}, 'at least 128 px'),
            ({'job': 'animate', 'image': img, 'resolution': '1080p'}, 'resolution must be one of'),
            ({'job': 'animate', 'image': img, 'aspect': '4:3'}, 'aspect must be one of'),
            ({'job': 'animate', 'image': img, 'mode': 'fast'}, 'mode must be one of'),
            ({'job': 'animate', 'image': img, 'steps': 3}, 'between 4 and 8'),
            ({'job': 'animate', 'image': img, 'mode': 'best', 'steps': 31}, 'between 10 and 30'),
            ({'job': 'animate', 'image': img, 'mode': 'best', 'resolution': '720p', 'steps': 25}, 'between 10 and 20'),
            ({'job': 'animate', 'image': img, 'mode': 'best', 'cfg': 9}, 'between 1.5 and 8'),
            ({'job': 'animate', 'image': img, 'cfg': 3}, 'cfg needs mode "best"'),
            ({'job': 'animate', 'image': img, 'model': 'wan'}, 'model is gone'),
            ({'job': 'animate', 'image': img, 'negative': 'blur'}, 'negative needs mode "best"'),
            ({'job': 'animate', 'image': img, 'seed': -1}, 'between 0 and'),
            ({'job': 'animate', 'image': img, 'seed': True}, 'whole number'),
            ({'job': 'animate', 'image': img, 'seed': 1.5}, 'whole number'),
            ({'job': 'animate', 'image': img, 'prompt': 'x' * 1201}, 'limit is 1200'),
            ({'job': 'animate', 'image': img, 'prompt': 42}, 'must be text'),
            ({'job': 'animate', 'image': img, 'fps': 30}, 'Unknown field fps'),
            ({'job': 'motion', 'image': img}, 'video is required'),
            ({'job': 'motion', 'video': clip}, 'image is required'),
            ({'job': 'motion', 'image': img, 'video': img}, 'video must be MP4, MOV or WEBM'),
            ({'job': 'motion', 'image': img, 'video': clip, 'steps': 20}, 'between 6 and 12'),
            ({'job': 'motion', 'image': img, 'video': clip, 'keep_audio': 'yes'}, 'true or false'),
            ({'job': 'motion', 'image': img, 'video': base64.b64encode(fake_mp4()[:8] + os.urandom(7_100_000)).decode()}, 'limit is 7 MB'),
            ({'job': 'lipsync', 'image': img}, 'audio is required'),
            ({'job': 'lipsync', 'image': img, 'audio': clip}, 'audio must be MP3, WAV, M4A, OGG or FLAC'),
            ({'job': 'lipsync', 'image': img, 'audio': clip, 'mode': 'best', 'steps': 30}, 'between 10 and 20'),
            ({'job': 'upscale_video'}, 'video is required'),
            ({'job': 'upscale_video', 'video': clip, 'scale': 3}, 'scale must be 2 or 4'),
            ({'job': 'music'}, 'tags is required'),
            ({'job': 'music', 'tags': 'x', 'duration': 5}, 'between 10 and 180'),
            ({'job': 'music', 'tags': 'x', 'duration': 200}, 'between 10 and 180'),
            ({'job': 'music', 'tags': 'x', 'duration': '30'}, 'must be a number'),
            ({'job': 'music', 'tags': 'x', 'bpm': 300}, 'between 40 and 220'),
            ({'job': 'music', 'tags': 'x', 'key': 'H major'}, 'key must be one of'),
            ({'job': 'music', 'tags': 'x', 'lyrics': 'la ' * 2000}, 'limit is 4000'),
            ({'job': 'upscale', 'image': img, 'scale': 3}, 'scale must be 2 or 4'),
            ({'job': 'upscale', 'image': img, 'format': 'png'}, 'format must be one of'),
            ({'job': 'sound', 'video': 'x'}, 'runs on the lab endpoint'),
            ({'job': 'prepare', 'jobs': ['paint']}, 'jobs must be a list of'),
        ]
        if media:
            long_clip = base64.b64encode(make_mp4(os.path.join(tmp, 'long.mp4'), seconds=12, size='160x120', audio=False)).decode()
            long_audio = base64.b64encode(make_audio(os.path.join(tmp, 'long.mp3'), seconds=12)).decode()
            bad += [({'job': 'motion', 'image': img, 'video': long_clip}, 'limit is 10 s'),
                    ({'job': 'upscale_video', 'video': long_clip}, 'limit is 10 s'),
                    ({'job': 'lipsync', 'image': img, 'audio': long_audio}, 'limit is 10 s'),
                    ({'job': 'motion', 'image': img, 'video': base64.b64encode(fake_mp4()[:24] + b'\x00' * 400).decode()}, 'could not be read')]
        for inp, want in bad:
            got = run_job(h, inp).get('error', '')
            check(want in got, f'rejects {str(inp)[:60]!r}: "{got[:90]}"')
        check(len(fake.prompts) == n_prompts, 'invalid input never reaches ComfyUI')
        good_data_url = run_job(h, {'job': 'upscale', 'image': 'data:image/jpeg;base64,' + b64_image(64, 64)})
        check('error' not in good_data_url, 'a data: URL image is accepted')

        # ---- the model volume, as the handler sees it
        cmd = h.COMFY.command() if not os.environ.get('COMFY_CMD') else []
        check('--extra-model-paths-config' in cmd and h.write_model_paths() == h.MODEL_PATHS and f'base_path: {os.path.join(vol, "models")}' in open(h.MODEL_PATHS).read(),
              'ComfyUI is started with --extra-model-paths-config pointing at the volume')
        lora = next(e for e in vm['models'] if e['id'] == 'lightx2v_i2v_high')
        os.remove(os.path.join(vol, 'models', lora['target']))
        out = run_job(h, {'job': 'animate', 'image': img, 'mode': 'best'})
        check('error' not in out and h.VOLUME._background is None, 'Best mode needs no LoRA, so it runs while the LoRA file is missing')
        n_prompts = len(fake.prompts)
        got = run_job(h, {'job': 'animate', 'image': img}).get('error', '')
        check('not on the GPU volume yet' in got and 'lightx2v_i2v_high' in got and 'prepare job' in got and len(fake.prompts) == n_prompts,
              f'a job whose model file is missing fails at once, before ComfyUI: "{got[:110]}"')
        if h.VOLUME._background:
            h.VOLUME._background.join(10)
        check(h.VOLUME.ready(lora), 'the missing file is fetched in the background meanwhile')
        os.remove(os.path.join(vol, 'models', lora['target']))
        st = run_job(h, {'job': 'prepare', 'check': True})
        check(st.get('type') == 'status' and st['ready'] is False and st['files_ready'] == st['files'] - 1, f"prepare (check): {st.get('files_ready')}/{st.get('files')} files ready")
        stub.updates.clear()
        st = run_job(h, {'job': 'prepare', 'jobs': ['animate']})
        check(st.get('ready') is True and st['files'] == len(h.needs('animate')) and 'error' not in st, f"prepare (animate): downloads what is missing, {st.get('files')} files ready")
        os.remove(os.path.join(vol, 'models', lora['target']))
        hf.rules['lightx2v_i2v_high'] = {'slow': 0.2}
        h.MODEL_WAIT = 30
        out = run_job(h, {'job': 'animate', 'image': img})
        h.MODEL_WAIT = 0
        hf.rules.clear()
        check('error' not in out, f"MASSLESS_MODEL_WAIT: a job waits for its file to arrive, then runs ({out.get('error') or 'ok'})")

        # ---- ComfyUI failures
        fake.reset(mode='reject')
        got = run_job(h, {'job': 'music', 'tags': 'x'}).get('error', '')
        check('ComfyUI rejected the workflow' in got and 'Value not in list' in got, f'a 400 from /prompt names the node: "{got[:100]}"')
        fake.reset(mode='oom')
        got = run_job(h, {'job': 'animate', 'image': img})
        check('ran out of memory' in got.get('error', '') and not leftovers(tmp), f'an execution error on the websocket becomes a clear message: "{got.get("error", "")[:80]}"')
        fake.reset(mode='drop_ws')
        got = run_job(h, {'job': 'music', 'tags': 'x'})
        check('error' not in got, f'websocket dropped mid-job: finishes by polling /history ({got.get("seconds")} s)')
        fake.reset(mode='error_history_only', ws=False)
        got = run_job(h, {'job': 'music', 'tags': 'x'})
        check('ran out of memory' in got.get('error', ''), 'no websocket at all: errors are read from /history')
        fake.reset(ws=False)
        got = run_job(h, {'job': 'upscale', 'image': img})
        check('error' not in got, 'no websocket at all: a job still completes by polling')
        fake.reset(mode='no_file')
        got = run_job(h, {'job': 'music', 'tags': 'x'})
        check('without producing a file' in got.get('error', ''), 'a run with no output file is an error')

        # ---- timeout: interrupt + dequeue, clear message, cleanup
        fake.reset(mode='hang')
        h.TIMEOUT_SCALE = 0.01  # animate quick 480p: 240 s -> 2.4 s
        t = time.monotonic()
        got = run_job(h, {'job': 'animate', 'image': img})
        took = time.monotonic() - t
        h.TIMEOUT_SCALE = 1.0
        posts = [c[1] for c in fake.calls if c[0] == 'POST']
        check('timed out after 2 s' in got.get('error', '') and '/interrupt' in posts and took < 15 and not leftovers(tmp),
              f'timeout: "{got.get("error")}", /interrupt and /queue delete sent, {took:.1f} s, inputs cleaned')
        fake.reset()

        # ---- result too large
        h.MAX_RESULT_B64 = 1000
        got = run_job(h, {'job': 'music', 'tags': 'x'})
        h.MAX_RESULT_B64 = 15_000_000
        check('over the' in got.get('error', ''), 'a result over the size limit is refused')

        # ---- ComfyUI is down
        h.COMFY = h.Comfy('127.0.0.1:9')  # nothing listens there
        h.STARTUP_TIMEOUT = 1
        got = h.handler({'id': 'x', 'input': {'job': 'music', 'tags': 'x'}})
        check('did not start' in got.get('error', '') and got.get('refresh_worker') is True, 'ComfyUI unreachable: clear error and refresh_worker')

        # ---- no volume attached
        h2, _ = import_handler(fake.host, tmp, volume=os.path.join(tmp, 'not-mounted', 'massless'), manifest=mpath)
        got = run_job(h2, {'job': 'music', 'tags': 'x'}).get('error', '')
        check('No network volume is mounted' in got, f'an endpoint without its volume says so: "{got[:90]}"')
    finally:
        fake.stop()
        hf.stop()
        shutil.rmtree(tmp, ignore_errors=True)


def make_mp4(path, seconds=3, size='320x240', fps=24, audio=True):
    cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'testsrc2=size={size}:rate={fps}:duration={seconds}']
    if audio:
        cmd += ['-f', 'lavfi', '-i', f'anoisesrc=d={seconds}:c=pink:a=0.1']
    cmd += ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'] + (['-c:a', 'aac', '-shortest'] if audio else []) + [path]
    subprocess.run(cmd, check=True)
    with open(path, 'rb') as f:
        return f.read()


def ffprobe(data, suffix='.mp4'):
    with tempfile.NamedTemporaryFile(suffix=suffix) as f:
        f.write(data)
        f.flush()
        out = subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', f.name], capture_output=True, check=True).stdout
    return json.loads(out)


def test_handler_lab():
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        return skip('Lab sound job (needs ffmpeg and ffprobe)')
    tmp = tempfile.mkdtemp()
    fake = FakeComfy(tmp).start()
    try:
        h, stub = import_handler(fake.host, tmp, image='lab', workflows=os.path.join(GPU, 'lab', 'workflows'))
        clip = make_mp4(os.path.join(tmp, 'clip.mp4'), seconds=3, size='640x360', fps=24)
        b64 = base64.b64encode(clip).decode()

        # ---- sound, MMAudio
        out = run_job(h, {'job': 'sound', 'video': b64, 'prompt': 'rain on a tin roof', 'seed': 11})
        ok = 'error' not in out
        check(ok, f"sound (mmaudio): {out.get('error') or out['model']}, {out.get('width')}x{out.get('height')}, {out.get('duration')} s")
        if ok:
            v = ffprobe(base64.b64decode(out['data']))
            streams = {st['codec_type']: st for st in v['streams']}
            check(set(streams) == {'video', 'audio'} and streams['video']['codec_name'] == 'h264' and streams['video']['width'] == 640
                  and streams['audio']['codec_name'] == 'aac' and abs(float(v['format']['duration']) - 3) < 0.2,
                  'sound: the original picture (stream copy, 640x360) with the new sound as AAC; the old noise track is replaced')
            a = ffprobe(base64.b64decode(out['audio']['data']), '.m4a')
            check(out['audio']['mime'] == 'audio/mp4' and [st['codec_type'] for st in a['streams']] == ['audio'], 'sound: the audio alone comes back as M4A (AAC)')
            check(out['license'] == 'CC-BY-NC-4.0' and out['commercial'] is False and out['replaced_audio'] is True and out['seed'] == 11,
                  f"sound: labelled license {out['license']}, commercial false")
            name, ctype, payload = fake.uploads[-1]
            up = ffprobe(payload)['streams']
            vs = [st for st in up if st['codec_type'] == 'video'][0]
            check(ctype == 'video/mp4' and vs['r_frame_rate'] == '25/1' and min(vs['width'], vs['height']) <= 512 and len(up) == 1,
                  f"sound: ComfyUI gets the clip re-timed to 25 fps, {vs['width']}x{vs['height']}, no audio (MMAudio's node assumes 25 fps)")
            g = list(fake.prompts.values())[-1]
            check(g['sampler']['inputs']['duration'] == 3.0 and g['sampler']['inputs']['prompt'] == 'rain on a tin roof' and g['sampler']['inputs']['seed'] == 11
                  and g['video_in']['inputs']['file'].endswith('.mp4') and g['model']['class_type'] == 'MMAudioModelLoader',
                  'sound: duration from the clip, prompt and seed set on the named nodes')
        check(not leftovers(tmp), 'sound: uploads and outputs cleaned up')
        check(not [d for d in os.listdir(tempfile.gettempdir()) if d.startswith('massless-sound-')], 'sound: the temp folder is removed')

        # ---- sound, Foley
        out = run_job(h, {'job': 'sound', 'video': b64, 'model': 'foley', 'steps': 30})
        g = list(fake.prompts.values())[-1]
        check('error' not in out and out['model'] == 'hunyuanvideo-foley-xxl-fp8' and out['license'] == 'Tencent-Hunyuan-Community' and out['commercial'] is False
              and g['sampler']['inputs']['steps'] == 30 and g['sampler']['inputs']['frame_rate'] == 25.0,
              f"sound (foley): {out.get('error') or out['model']}, 30 steps, frame_rate 25, labelled {out.get('license')}")

        # ---- sound validation
        long_clip = base64.b64encode(make_mp4(os.path.join(tmp, 'long.mp4'), seconds=12, size='160x120', audio=False)).decode()
        bad = [
            ({'job': 'sound'}, 'video is required'),
            ({'job': 'sound', 'video': b64_image(64, 64)}, 'must be an MP4'),
            ({'job': 'sound', 'video': long_clip}, 'limit is 10 s'),
            ({'job': 'sound', 'video': base64.b64encode(clip[:24] + b'\x00' * 400).decode()}, 'could not be read'),
            ({'job': 'sound', 'video': base64.b64encode(clip[:8] + os.urandom(7_100_000)).decode()}, 'limit is 7 MB'),
            ({'job': 'sound', 'video': b64, 'model': 'audiogen'}, 'model must be one of'),
            ({'job': 'sound', 'video': b64, 'steps': 80}, 'between 10 and 50'),
            ({'job': 'sound', 'video': b64, 'model': 'foley', 'steps': 70}, 'between 10 and 60'),
            ({'job': 'sound', 'video': b64, 'prompt': 'x' * 401}, 'limit is 400'),
            ({'job': 'animate', 'image': b64_image(300, 300)}, 'runs on the main endpoint'),
        ]
        n = len(fake.prompts)
        for inp, want in bad:
            got = run_job(h, inp).get('error', '')
            check(want in got, f'lab rejects {str(inp)[:50]!r}: "{got[:90]}"')
        check(len(fake.prompts) == n, 'invalid Lab input never reaches ComfyUI')

        # ---- fibo from a Massless rig shot
        shot = {'subject': 'a lighthouse keeper climbing a spiral staircase', 'camera': '16mm', 'lens': 'vintage', 'focal': 24, 'aperture': '2.8',
                'shot': 'ws', 'angle': 'low', 'light': 'moon', 'stock': 'faded', 'genre': 'noir', 'palette': 'steel', 'aspect': '239'}
        out = run_job(h, {'job': 'fibo', 'shot': shot, 'seed': 5})
        g = list(fake.prompts.values())[-1]
        cap = json.loads(g['text']['inputs']['prompt']) if 'error' not in out else {}
        want_keys = {'short_description', 'objects', 'background_setting', 'lighting', 'aesthetics', 'photographic_characteristics', 'style_medium', 'text_render', 'context', 'artistic_style'}
        check('error' not in out and set(cap) == want_keys and cap['lighting']['conditions'] == 'moonlit night' and cap['photographic_characteristics']['lens_focal_length'].startswith('24mm wide-angle lens')
              and cap['photographic_characteristics']['camera_angle'] == 'low-angle camera looking up, heroic' and cap['style_medium'] == 'film photograph'
              and 'noir' in cap['context'] and cap['text_render'] == [] and cap['objects'][0]['relative_size'] == 'medium',
              f"fibo: a rig shot becomes a Fibo caption with all ten VGL fields ({out.get('error') or cap.get('short_description', '')[:70]}...)")
        w, h2 = g['text']['inputs']['width'], g['text']['inputs']['height']
        check((out.get('width'), out.get('height')) == (w, h2) and abs(w / h2 - 2.39) < 0.12 and abs(w * h2 - 1048576) < 0.11 * 1048576 and w % 16 == 0 and h2 % 16 == 0,
              f'fibo: the shot\'s 2.39:1 aspect becomes Fibo\'s trained size {w}x{h2} (about 1 MP)')
        im = Image.open(io.BytesIO(base64.b64decode(out['data']))) if 'data' in out else None
        check(im is not None and im.format == 'JPEG' and out['license'] == 'CC-BY-NC-4.0' and out['commercial'] is False and out['caption'] == cap and g['sampler']['inputs']['steps'] == 4,
              'fibo: JPEG result labelled CC-BY-NC-4.0, commercial false, with the caption it was given')
        out = run_job(h, {'job': 'fibo', 'prompt': 'a red bicycle against a white wall', 'aspect': '9:16'})
        g = list(fake.prompts.values())[-1]
        check('error' not in out and g['text']['inputs']['prompt'] == 'a red bicycle against a white wall' and g['text']['inputs']['height'] > g['text']['inputs']['width'],
              f"fibo: plain text prompt, 9:16 -> {g['text']['inputs']['width']}x{g['text']['inputs']['height']}")
        vgl = {'short_description': 'a cat', 'objects': [{'description': 'a cat', 'location': 'center'}], 'lighting': {'conditions': 'studio'}}
        out = run_job(h, {'job': 'fibo', 'prompt': vgl})
        check('error' not in out and json.loads(list(fake.prompts.values())[-1]['text']['inputs']['prompt']) == vgl, 'fibo: a JSON caption is passed through as is')
        out = run_job(h, {'job': 'fibo', 'mode': 'edit', 'image': b64_image(800, 600), 'prompt': 'make it night'})
        g = list(fake.prompts.values())[-1]
        check('error' not in out and g['text']['inputs']['images.image_1'] == ['image_in', 0] and g['text']['inputs']['width'] == 0 and g['image_in']['inputs']['image'].startswith('massless_')
              and (out['width'], out['height']) == h.fibo_size(800 / 600), f"fibo edit: image uploaded, instruction sent, result at the trained size {out.get('width')}x{out.get('height')}")
        out = run_job(h, {'job': 'fibo', 'mode': 'edit', 'image': b64_image(800, 600), 'shot': {'subject': 'a cat', 'light': 'neon'}, 'prompt': 'turn the lights to neon'})
        cap = json.loads(list(fake.prompts.values())[-1]['text']['inputs']['prompt'])
        check('error' not in out and cap['edit_instruction'] == 'turn the lights to neon' and cap['lighting']['conditions'].startswith('neon'), 'fibo edit: shot + instruction becomes a caption with edit_instruction')
        bad = [
            ({'job': 'fibo'}, 'prompt or shot is required'),
            ({'job': 'fibo', 'mode': 'edit', 'prompt': 'x'}, 'image is required'),
            ({'job': 'fibo', 'prompt': 'x', 'image': b64_image(64, 64)}, 'only for mode "edit"'),
            ({'job': 'fibo', 'shot': {'subject': 'x', 'camera': 'imax'}}, 'shot.camera must be one of'),
            ({'job': 'fibo', 'shot': {'subject': 'x', 'zoom': 3}}, 'Unknown shot field zoom'),
            ({'job': 'fibo', 'prompt': {'short_description': 'x', 'score': 9}}, 'Unknown caption field score'),
            ({'job': 'fibo', 'prompt': 'x', 'aspect': '21:9'}, 'aspect must be one of'),
            ({'job': 'fibo', 'prompt': 'x', 'steps': 12}, 'between 2 and 8'),
            ({'job': 'fibo', 'mode': 'edit', 'image': b64_image(200, 200), 'prompt': {'short_description': 'x'}}, 'needs an instruction'),
        ]
        for inp, want in bad:
            got = run_job(h, inp).get('error', '')
            check(want in got, f'lab rejects {str(inp)[:60]!r}: "{got[:90]}"')
        sizes = {a: h.fibo_size(r) for a, r in h.FIBO_ASPECTS.items()}
        check(sizes['1:1'] == (1024, 1024) and all(w % 16 == 0 and h_ % 16 == 0 and 0.9 * 1048576 <= w * h_ <= 1.1 * 1048576 for w, h_ in sizes.values()),
              f'fibo: trained sizes {sizes}')
    finally:
        fake.stop()
        shutil.rmtree(tmp, ignore_errors=True)


def test_warm_start():
    """The handler starts ComfyUI itself, once, and starts it again if it dies."""
    tmp = tempfile.mkdtemp()
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    h, _ = import_handler(f'127.0.0.1:{port}', tmp)
    os.environ['COMFY_CMD'] = f'{sys.executable} {os.path.abspath(__file__)} --serve {port} {tmp}'
    h.COMFY_START = True
    c = h.Comfy(f'127.0.0.1:{port}')
    h.COMFY = c
    try:
        out1 = h.handler({'id': 'a', 'input': {'job': 'music', 'tags': 'x'}})
        pid1 = c.proc.pid
        out2 = h.handler({'id': 'b', 'input': {'job': 'upscale', 'image': b64_image(64, 64)}})
        check('error' not in out1 and 'error' not in out2 and c.proc.pid == pid1, f'ComfyUI started once and reused for the next job (pid {pid1})')
        c.proc.kill()
        c.proc.wait()
        out3 = h.handler({'id': 'c', 'input': {'job': 'music', 'tags': 'x'}})
        check('error' not in out3 and c.proc.pid != pid1, 'a dead ComfyUI is started again on the next job')
    finally:
        if c.proc and c.proc.poll() is None:
            c.proc.kill()
        os.environ.pop('COMFY_CMD', None)
        shutil.rmtree(tmp, ignore_errors=True)


def serve(port, root):
    FakeComfy(root, int(port)).server.serve_forever()


def main():
    if len(sys.argv) >= 4 and sys.argv[1] == '--serve':
        return serve(sys.argv[2], sys.argv[3])
    print('== workflows vs the pinned ComfyUI source')
    index = test_workflows(os.path.join(GPU, 'models.json'), os.path.join(GPU, 'workflows'), 'main')
    if index:
        test_validator_catches_mistakes(index, os.path.join(GPU, 'workflows', 'animate_i2v.json'), manifest_targets(os.path.join(GPU, 'models.json'))[1])
    print('== Lab workflows vs ComfyUI v0.43.1 and the pinned custom nodes')
    test_workflows(os.path.join(GPU, 'models.lab.json'), os.path.join(GPU, 'lab', 'workflows'), 'lab')
    print('== manifests and Dockerfiles')
    m = test_manifest(os.path.join(GPU, 'models.json'), os.path.join(GPU, 'Dockerfile'), commercial=True, baked=False)
    lab = test_manifest(os.path.join(GPU, 'models.lab.json'), os.path.join(GPU, 'Dockerfile.lab'), commercial=False)
    test_urls(m)
    test_urls(lab)
    print('== the model volume (download, verify, resume, lock) against a fake Hugging Face')
    test_volume()
    print('== handler against a fake ComfyUI')
    test_handler_main(index)
    test_warm_start()
    print('== Lab image: handler (sound, fibo) against a fake ComfyUI')
    test_handler_lab()
    print(f'\n{len(fails)} failed, {len(skips)} skipped')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
