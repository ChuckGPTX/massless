#!/usr/bin/env python3
"""Download one model file at image build time and verify it. Part of Massless (MIT).

    fetch_model.py URL SHA256 SIZE DEST [--convert diffusers-wan]
    fetch_model.py --summary MANIFEST.json [MANIFEST.json ...]

Each Dockerfile layer calls this once with the values from gpu/models.json written out in full, so a
layer's cache key is exactly one model and editing the manifest or the handler never re-downloads the
others. Uses aria2c (parallel connections) when installed, otherwise curl. The byte size and SHA-256
of the download are checked before the file is moved into place; nothing unverified is kept.

--convert diffusers-wan renames the tensors of a diffusers-layout Wan 2.x transformer to the names
ComfyUI's core loader uses. Only the safetensors header changes; the tensor bytes stay where they are,
so the file is rewritten in place when the new header fits (it does for Wan: the new names are shorter).

MASSLESS_SKIP_MODELS=1 writes nothing, for quick local builds of everything but the weights.
Standard library only (it runs before the Python environment is installed).
"""
import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import urllib.request

CHUNK = 16 * 1024 * 1024

# diffusers WanTransformer3DModel -> ComfyUI WanModel. Checked against Comfy-Org's own 5B file in
# tests/gpu_handler_test.py (same 825 names, same shapes).
WAN_TOP = [
    ('condition_embedder.text_embedder.linear_1.', 'text_embedding.0.'),
    ('condition_embedder.text_embedder.linear_2.', 'text_embedding.2.'),
    ('condition_embedder.time_embedder.linear_1.', 'time_embedding.0.'),
    ('condition_embedder.time_embedder.linear_2.', 'time_embedding.2.'),
    ('condition_embedder.time_proj.', 'time_projection.1.'),
    ('condition_embedder.image_embedder.', 'img_emb.'),
    ('proj_out.', 'head.head.'),
    ('scale_shift_table', 'head.modulation'),
    ('patch_embedding.', 'patch_embedding.'),
]
WAN_BLOCK = [
    ('attn1.to_q.', 'self_attn.q.'), ('attn1.to_k.', 'self_attn.k.'), ('attn1.to_v.', 'self_attn.v.'),
    ('attn1.to_out.0.', 'self_attn.o.'), ('attn1.norm_q.', 'self_attn.norm_q.'), ('attn1.norm_k.', 'self_attn.norm_k.'),
    ('attn2.to_q.', 'cross_attn.q.'), ('attn2.to_k.', 'cross_attn.k.'), ('attn2.to_v.', 'cross_attn.v.'),
    ('attn2.to_out.0.', 'cross_attn.o.'), ('attn2.norm_q.', 'cross_attn.norm_q.'), ('attn2.norm_k.', 'cross_attn.norm_k.'),
    ('ffn.net.0.proj.', 'ffn.0.'), ('ffn.net.2.', 'ffn.2.'), ('norm2.', 'norm3.'), ('scale_shift_table', 'modulation'),
]
BLOCK = re.compile(r'^blocks\.(\d+)\.(.+)$')


def wan_diffusers_to_comfy(name):
    """New tensor name, or None when the name is not part of the known layout."""
    m = BLOCK.match(name)
    if m:
        for a, b in WAN_BLOCK:
            if m.group(2).startswith(a):
                return f'blocks.{m.group(1)}.{b}{m.group(2)[len(a):]}'
        return None
    for a, b in WAN_TOP:
        if name.startswith(a):
            return b + name[len(a):]
    return None


CONVERTERS = {'diffusers-wan': wan_diffusers_to_comfy}


def read_header(path):
    with open(path, 'rb') as f:
        n = struct.unpack('<Q', f.read(8))[0]
        if n > 100 * 1024 * 1024:
            raise ValueError(f'{path}: safetensors header of {n} bytes is not plausible')
        return n, json.loads(f.read(n))


def rekey_safetensors(path, rename):
    """Rename every tensor in a safetensors file. Data offsets are relative to the end of the header,
    so the tensor bytes never move: a header that fits in the old one is padded with spaces (allowed by
    the format) and written over it; a longer one goes into a copy of the file."""
    n, header = read_header(path)
    meta = header.pop('__metadata__', None)
    out = {}
    for key, info in header.items():
        new = rename(key)
        if new is None:
            raise ValueError(f'{path}: no mapping for tensor {key!r}')
        if new in out:
            raise ValueError(f'{path}: two tensors map to {new!r}')
        out[new] = info
    if meta is not None:
        out['__metadata__'] = meta
    blob = json.dumps(out, separators=(',', ':')).encode('utf-8')
    if len(blob) <= n:
        with open(path, 'r+b') as f:
            f.seek(8)
            f.write(blob + b' ' * (n - len(blob)))
        return len(out)
    blob += b' ' * (-len(blob) % 8)
    tmp = path + '.rekey'
    with open(path, 'rb') as src, open(tmp, 'wb') as dst:
        dst.write(struct.pack('<Q', len(blob)))
        dst.write(blob)
        src.seek(8 + n)
        shutil.copyfileobj(src, dst, CHUNK)
    os.replace(tmp, path)
    return len(out)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            b = f.read(CHUNK)
            if not b:
                return h.hexdigest()
            h.update(b)


def download(url, dest):
    if shutil.which('aria2c'):
        cmd = ['aria2c', '--console-log-level=warn', '--summary-interval=30', '--max-tries=8', '--retry-wait=5',
               '--max-connection-per-server=16', '--split=16', '--min-split-size=32M', '--file-allocation=none',
               '--allow-overwrite=true', '--auto-file-renaming=false', '--dir', os.path.dirname(dest),
               '--out', os.path.basename(dest), url]
    elif shutil.which('curl'):
        cmd = ['curl', '-fL', '--retry', '8', '--retry-delay', '5', '--retry-all-errors', '-sS', '-o', dest, url]
    else:
        with urllib.request.urlopen(url) as r, open(dest, 'wb') as f:
            shutil.copyfileobj(r, f, CHUNK)
        return
    subprocess.run(cmd, check=True)


def fetch(url, sha256, size, dest, convert=None):
    if os.environ.get('MASSLESS_SKIP_MODELS') == '1':
        print(f'skip (MASSLESS_SKIP_MODELS=1): {dest}')
        return
    if not re.fullmatch(r'[0-9a-f]{64}', sha256):
        raise SystemExit(f'bad sha256 for {dest}')
    if convert and convert not in CONVERTERS:
        raise SystemExit(f'unknown converter {convert}')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    part = dest + '.part'
    print(f'fetch {url}\n   -> {dest} ({size / 1e9:.2f} GB)', flush=True)
    download(url, part)
    got = os.path.getsize(part)
    if got != size:
        os.remove(part)
        raise SystemExit(f'{dest}: expected {size} bytes, got {got}')
    digest = sha256_of(part)
    if digest != sha256:
        os.remove(part)
        raise SystemExit(f'{dest}: sha256 mismatch, expected {sha256}, got {digest}')
    if convert:
        count = rekey_safetensors(part, CONVERTERS[convert])
        print(f'   renamed {count} tensors ({convert})')
    os.replace(part, dest)
    print(f'   ok sha256 {sha256}', flush=True)


def summary(paths):
    total = 0
    for p in paths:
        with open(p) as f:
            m = json.load(f)
        for e in m['models']:
            total += e['size']
            print(f"{e['size'] / 1e9:7.2f} GB  {e['target']}  [{e['license']}]")
    print(f'{total / 1e9:7.2f} GB  model weights in total')


def main(argv):
    if argv and argv[0] == '--summary':
        return summary(argv[1:])
    convert = None
    if '--convert' in argv:
        i = argv.index('--convert')
        convert = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    if len(argv) != 4:
        raise SystemExit(__doc__)
    url, sha256, size, dest = argv
    fetch(url, sha256, int(size), dest, convert)


if __name__ == '__main__':
    main(sys.argv[1:])
