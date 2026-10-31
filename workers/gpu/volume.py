"""Model weights on a RunPod network volume. MIT License (see workers/gpu/LICENSE).

The worker image carries no weights. Each file in models.json lives on the volume at
<root>/models/<target>; this module makes sure it is there and correct:

  * a file counts as present only when its size matches and a marker in <root>/.verified/ records the
    sha256 it was checked against, with the file's size and mtime (so a later boot never re-hashes 150 GB);
  * a missing file is downloaded from its pinned Hugging Face revision to <root>/.incoming/<id>.part,
    resuming a partial download, then checked (size and sha256) and moved into place with os.replace;
  * one worker downloads a given file at a time: <root>/.incoming/<id>.lock is created with O_EXCL, its
    mtime is refreshed every few seconds while the download runs, and a lock nobody refreshed for
    MASSLESS_LOCK_STALE seconds (300) is taken over (the worker holding it died);
  * a file with the right size but no marker (copied in by hand, or a crash between rename and marker)
    is hashed once and kept if it matches; a file that does not match is removed and fetched again.

Run on its own to fill a volume from a cheap CPU pod (no GPU billed):
    python volume.py --root /runpod-volume/massless [--jobs animate,music] [--status]
"""
import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import uuid

try:
    import requests
except ImportError:  # pragma: no cover - the image always has it
    requests = None

HERE = os.path.dirname(os.path.abspath(__file__))
CHUNK = 8 * 1024 * 1024
NET_CHUNK = 1024 * 1024  # what a dropped connection can lose; the rest of the .part is resumed
FOLDERS = ('diffusion_models', 'loras', 'text_encoders', 'vae', 'clip_vision', 'audio_encoders', 'upscale_models')


class NotReady(RuntimeError):
    """A file is not on the volume yet (still downloading elsewhere, or the wait ran out)."""


class VolumeError(RuntimeError):
    """The volume or the download failed in a way a retry will not fix by itself."""


def load_manifest(path=None):
    with open(path or os.path.join(HERE, 'models.json'), encoding='utf-8') as f:
        return json.load(f)


def sha256_file(path, progress=None):
    h = hashlib.sha256()
    done = 0
    with open(path, 'rb') as f:
        while True:
            b = f.read(CHUNK)
            if not b:
                break
            h.update(b)
            done += len(b)
            if progress:
                progress(done)
    return h.hexdigest()


class Volume:
    def __init__(self, root, manifest, log=None, downloader=None, heartbeat=None, stale=None, session=None):
        self.root = root
        self.manifest = manifest
        self.models = {e['id']: e for e in manifest['models']}
        self.log = log or (lambda msg: print(f'[volume] {msg}', flush=True))
        self.downloader = downloader or os.environ.get('MASSLESS_DOWNLOADER', 'auto')
        self.heartbeat = float(heartbeat if heartbeat is not None else os.environ.get('MASSLESS_LOCK_HEARTBEAT', '10'))
        self.stale = float(stale if stale is not None else os.environ.get('MASSLESS_LOCK_STALE', '300'))
        self.session = session
        self.me = f'{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}'
        self.state = {}          # id -> {'state': 'ready'|'downloading'|'waiting'|'failed', 'done': bytes, 'error': str}
        self.lock = threading.Lock()
        self._background = None

    # ------------------------------------------------------------------ paths
    def path(self, e):
        return os.path.join(self.root, 'models', e['target'])

    def part(self, e):
        return os.path.join(self.root, '.incoming', e['id'] + '.part')

    def lockfile(self, e):
        return os.path.join(self.root, '.incoming', e['id'] + '.lock')

    def marker(self, e):
        return os.path.join(self.root, '.verified', e['id'] + '.json')

    def _set(self, e, **kw):
        with self.lock:
            self.state.setdefault(e['id'], {}).update(kw)

    # ------------------------------------------------------------------ checks
    def ready(self, e):
        """True when the file is in place, the right size, and a marker says its sha256 was checked."""
        try:
            st = os.stat(self.path(e))
        except OSError:
            return False
        if st.st_size != e['size']:
            return False
        try:
            with open(self.marker(e), encoding='utf-8') as f:
                m = json.load(f)
        except (OSError, ValueError):
            return False
        return m.get('sha256') == e['sha256'] and m.get('size') == st.st_size and m.get('mtime_ns') == st.st_mtime_ns

    def _write_marker(self, e):
        st = os.stat(self.path(e))
        os.makedirs(os.path.dirname(self.marker(e)), exist_ok=True)
        tmp = self.marker(e) + f'.{uuid.uuid4().hex[:8]}.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump({'id': e['id'], 'sha256': e['sha256'], 'size': st.st_size, 'mtime_ns': st.st_mtime_ns,
                       'url': e['url'], 'checked_at': int(time.time()), 'by': self.me}, f)
        os.replace(tmp, self.marker(e))

    def adopt(self, e):
        """A file of the right size without a marker: hash it once. Returns True if kept."""
        p = self.path(e)
        try:
            if os.path.getsize(p) != e['size']:
                raise OSError
        except OSError:
            return False
        self.log(f"{e['id']}: checking an existing file ({e['size'] / 1e9:.2f} GB)")
        if sha256_file(p) == e['sha256']:
            self._write_marker(e)
            return True
        self.log(f"{e['id']}: existing file does not match its sha256; removing it")
        try:
            os.remove(p)
        except OSError:
            pass
        return False

    # ------------------------------------------------------------------ locking
    def _try_lock(self, e):
        lf = self.lockfile(e)
        os.makedirs(os.path.dirname(lf), exist_ok=True)
        try:
            fd = os.open(lf, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            try:
                age = time.time() - os.stat(lf).st_mtime
            except OSError:
                return self._try_lock(e)  # it was released just now
            if age < self.stale:
                return False
            # nobody refreshed it: the worker that held it is gone. Only one taker wins the rename.
            grave = f'{lf}.stale.{uuid.uuid4().hex[:8]}'
            try:
                os.rename(lf, grave)
            except OSError:
                return False
            self.log(f"{e['id']}: took over a lock nobody refreshed for {age:.0f} s")
            try:
                os.remove(grave)
            except OSError:
                pass
            return self._try_lock(e)
        with os.fdopen(fd, 'w') as f:
            json.dump({'by': self.me, 'at': int(time.time())}, f)
        return True

    def _hold(self, e):
        """Refresh the lock's mtime until the returned event is set."""
        stop = threading.Event()

        def beat():
            while not stop.wait(self.heartbeat):
                try:
                    os.utime(self.lockfile(e), None)
                except OSError:
                    pass
        threading.Thread(target=beat, daemon=True, name=f'lock-{e["id"]}').start()
        return stop

    def _unlock(self, e):
        try:
            with open(self.lockfile(e), encoding='utf-8') as f:
                mine = json.load(f).get('by') == self.me
        except (OSError, ValueError):
            mine = False
        if mine:
            try:
                os.remove(self.lockfile(e))
            except OSError:
                pass

    # ------------------------------------------------------------------ download
    def _http(self):
        if self.session is None:
            if requests is None:
                raise VolumeError('requests is not installed.')
            self.session = requests.Session()
            self.session.headers['user-agent'] = 'massless-gpu-worker'
            if os.environ.get('HF_TOKEN'):
                self.session.headers['authorization'] = 'Bearer ' + os.environ['HF_TOKEN']
        return self.session

    def _use_aria2(self):
        if self.downloader == 'python':
            return False
        found = shutil.which(os.environ.get('ARIA2C', 'aria2c'))
        if self.downloader == 'aria2c' and not found:
            raise VolumeError('MASSLESS_DOWNLOADER=aria2c but aria2c is not installed.')
        return bool(found)

    def _download_python(self, e, part, progress):
        """Stream into part, resuming what is there; hashes as it goes. Returns the sha256."""
        have = os.path.getsize(part) if os.path.exists(part) else 0
        if have > e['size']:
            os.remove(part)
            have = 0
        h = hashlib.sha256()
        if have:
            with open(part, 'rb') as f:
                while True:
                    b = f.read(CHUNK)
                    if not b:
                        break
                    h.update(b)
        if have == e['size']:
            return h.hexdigest()
        headers = {'range': f'bytes={have}-'} if have else {}
        r = self._http().get(e['url'], headers=headers, stream=True, timeout=(20, 120), allow_redirects=True)
        try:
            if have and r.status_code == 200:  # the server ignored the range: start over
                have, h = 0, hashlib.sha256()
            elif have and r.status_code == 206:
                start = (r.headers.get('content-range') or '').split(' ')[-1].split('-')[0]
                if start != str(have):
                    raise VolumeError(f"{e['id']}: the server resumed at {start}, not {have}")
            elif r.status_code == 416:
                raise VolumeError(f"{e['id']}: the server refused to resume at {have} bytes")
            elif r.status_code != 200:
                raise VolumeError(f"{e['id']}: download failed with HTTP {r.status_code}")
            with open(part, 'ab' if have else 'wb') as f:
                done = have
                for b in r.iter_content(NET_CHUNK):
                    if not b:
                        continue
                    f.write(b)
                    h.update(b)
                    done += len(b)
                    if done > e['size']:
                        raise VolumeError(f"{e['id']}: the download is larger than the {e['size']} bytes recorded")
                    if progress:
                        progress(done)
                f.flush()
                os.fsync(f.fileno())
        finally:
            r.close()
        return h.hexdigest()

    def _download_aria2(self, e, part, progress):
        cmd = [shutil.which(os.environ.get('ARIA2C', 'aria2c')), '--continue=true', '--allow-overwrite=true', '--auto-file-renaming=false',
               '--max-connection-per-server=16', '--split=16', '--min-split-size=64M', '--file-allocation=none',
               '--console-log-level=warn', '--summary-interval=0', '--max-tries=5', '--retry-wait=5',
               '-d', os.path.dirname(part), '-o', os.path.basename(part), e['url']]
        if os.environ.get('HF_TOKEN'):
            cmd[1:1] = ['--header', 'Authorization: Bearer ' + os.environ['HF_TOKEN']]
        p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        while p.poll() is None:
            time.sleep(2)
            if progress and os.path.exists(part):
                progress(min(os.path.getsize(part), e['size']))
        err = p.stderr.read().decode('utf-8', 'replace').strip().splitlines()
        if p.returncode != 0:
            raise VolumeError(f"{e['id']}: aria2c failed ({err[-1][:200] if err else p.returncode})")
        try:
            os.remove(part + '.aria2')
        except OSError:
            pass
        return sha256_file(part)

    def _fetch(self, e):
        part, final = self.part(e), self.path(e)
        os.makedirs(os.path.dirname(part), exist_ok=True)
        os.makedirs(os.path.dirname(final), exist_ok=True)
        have = os.path.getsize(part) if os.path.exists(part) else 0
        need = e['size'] - have
        free = shutil.disk_usage(self.root).free
        if need > free:
            raise VolumeError(f"The volume is full: {e['id']} needs {need / 1e9:.1f} GB more and only {free / 1e9:.1f} GB is free. "
                              'Make the network volume larger (see workers/gpu/README.md).')

        def progress(done):
            self._set(e, done=done)
        attempts, mismatches = 0, 0
        while True:
            attempts += 1
            self._set(e, state='downloading', done=have)
            self.log(f"{e['id']}: downloading {e['size'] / 1e9:.2f} GB" + (f' (resuming at {have / 1e9:.2f} GB)' if have else ''))
            try:
                digest = (self._download_aria2 if self._use_aria2() else self._download_python)(e, part, progress)
            except VolumeError:
                raise
            except Exception as ex:  # network trouble: resume from what we have
                if attempts >= 4:
                    raise VolumeError(f"{e['id']}: download failed after {attempts} tries ({ex.__class__.__name__})") from None
                self.log(f"{e['id']}: {ex.__class__.__name__}, retrying")
                time.sleep(min(30, 2 ** attempts))
                have = os.path.getsize(part) if os.path.exists(part) else 0
                continue
            size = os.path.getsize(part)
            if size == e['size'] and digest == e['sha256']:
                break
            os.remove(part)  # wrong bytes: never resume from them
            mismatches += 1
            if mismatches >= 2:
                raise VolumeError(f"{e['id']}: downloaded twice and it does not match the pinned sha256 ({size} bytes)")
            self.log(f"{e['id']}: {size} bytes, sha256 {digest[:12]} does not match {e['sha256'][:12]}; downloading again")
            have = 0
        os.replace(part, final)
        self._write_marker(e)
        self.log(f"{e['id']}: ready")

    # ------------------------------------------------------------------ public
    def ensure(self, e, wait=None, poll=2.0):
        """Make one file present. Downloads it, or waits for the worker that is (up to `wait` seconds; None = forever)."""
        if isinstance(e, str):
            e = self.models[e]
        end = None if wait is None else time.monotonic() + wait
        while True:
            if self.ready(e):
                self._set(e, state='ready', done=e['size'])
                return
            if self._try_lock(e):
                stop = self._hold(e)
                try:
                    if self.ready(e):
                        continue
                    if not self.adopt(e):
                        self._fetch(e)
                except Exception as ex:
                    self._set(e, state='failed', error=str(ex))
                    raise
                finally:
                    stop.set()
                    self._unlock(e)
                continue
            self._set(e, state='waiting')
            if end is not None and time.monotonic() >= end:
                raise NotReady(f"{e['id']} is being downloaded by another worker")
            time.sleep(poll if end is None else max(0.01, min(poll, end - time.monotonic())))

    def ids_for(self, jobs=None):
        return [e['id'] for e in self.manifest['models'] if jobs is None or set(e['jobs']) & set(jobs)]

    def ensure_all(self, ids=None, wait=None):
        failed = []
        for i in ids or self.ids_for():
            try:
                self.ensure(i, wait=wait)
            except (NotReady, VolumeError, OSError) as ex:
                failed.append((i, str(ex)))
                self.log(f'{i}: {ex}')
        return failed

    def missing(self, ids):
        return [i for i in ids if not self.ready(self.models[i])]

    def start_background(self, ids=None):
        """Bring every file in, in manifest order, on a daemon thread (what a worker does on boot)."""
        if self._background and self._background.is_alive():
            return self._background
        todo = [i for i in (ids or self.ids_for()) if not self.ready(self.models[i])]
        if not todo:
            return None
        self.log(f"{len(todo)} model file(s) missing on the volume; fetching them in the background")
        self._background = threading.Thread(target=self.ensure_all, args=(todo,), daemon=True, name='volume-bootstrap')
        self._background.start()
        return self._background

    def status(self, ids=None):
        ids = ids or self.ids_for()
        rows, ready_bytes, total = [], 0, 0
        for i in ids:
            e = self.models[i]
            ok = self.ready(e)
            s = dict(self.state.get(i, {}))
            done = e['size'] if ok else s.get('done') or (os.path.getsize(self.part(e)) if os.path.exists(self.part(e)) else 0)
            total += e['size']
            ready_bytes += e['size'] if ok else 0
            rows.append({'id': i, 'ready': ok, 'bytes': e['size'], 'done': min(done, e['size']), 'state': 'ready' if ok else s.get('state', 'missing'),
                         **({'error': s['error']} if s.get('error') and not ok else {})})
        return {'ready': all(r['ready'] for r in rows), 'files': len(rows), 'files_ready': sum(r['ready'] for r in rows),
                'bytes': total, 'bytes_ready': ready_bytes, 'models': rows}


def comfy_paths_yaml(root):
    """extra_model_paths.yaml for ComfyUI: every model folder it uses, on the volume."""
    lines = ['# Written by workers/gpu/handler.py at worker start: model folders on the RunPod network volume.',
             'massless_volume:', f'  base_path: {os.path.join(root, "models")}', '  is_default: true']
    lines += [f'  {f}: {f}' for f in FOLDERS]
    return '\n'.join(lines) + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description='Fill or check the Massless model volume.')
    ap.add_argument('--root', default=os.environ.get('MASSLESS_VOLUME', '/runpod-volume/massless'))
    ap.add_argument('--manifest', default=os.path.join(HERE, 'models.json'))
    ap.add_argument('--jobs', help='comma-separated job kinds (default: all)')
    ap.add_argument('--status', action='store_true', help='only report what is there')
    a = ap.parse_args(argv)
    v = Volume(a.root, load_manifest(a.manifest))
    ids = v.ids_for(a.jobs.split(',') if a.jobs else None)
    if not a.status:
        failed = v.ensure_all(ids)
        if failed:
            for i, msg in failed:
                print(f'FAILED {i}: {msg}', file=sys.stderr)
    s = v.status(ids)
    print(json.dumps({k: s[k] for k in ('ready', 'files', 'files_ready', 'bytes', 'bytes_ready')}))
    return 0 if s['ready'] else 1


if __name__ == '__main__':
    sys.exit(main())
