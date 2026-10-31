#!/usr/bin/env python3
"""Download one model file at image build time and verify it. Part of Massless (MIT).

    fetch_model.py URL SHA256 SIZE DEST
    fetch_model.py --summary MANIFEST.json [MANIFEST.json ...]

Used by the Lab image (Dockerfile.lab), which bakes its weights in; the main image keeps its weights on a
network volume instead (volume.py). Each Dockerfile layer calls this once with the values from
models.lab.json written out in full, so a layer's cache key is exactly one model and editing the
manifest or the handler never re-downloads the others. Uses aria2c (parallel connections) when installed, otherwise curl. The byte size and SHA-256
of the download are checked before the file is moved into place; nothing unverified is kept.

MASSLESS_SKIP_MODELS=1 writes nothing, for quick local builds of everything but the weights.
Standard library only (it runs before the Python environment is installed).
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request

CHUNK = 16 * 1024 * 1024

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


def fetch(url, sha256, size, dest):
    if os.environ.get('MASSLESS_SKIP_MODELS') == '1':
        print(f'skip (MASSLESS_SKIP_MODELS=1): {dest}')
        return
    if not re.fullmatch(r'[0-9a-f]{64}', sha256):
        raise SystemExit(f'bad sha256 for {dest}')
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
    if len(argv) != 4:
        raise SystemExit(__doc__)
    url, sha256, size, dest = argv
    fetch(url, sha256, int(size), dest)


if __name__ == '__main__':
    main(sys.argv[1:])
