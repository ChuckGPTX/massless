"""Massless GPU worker: a RunPod Serverless handler that drives ComfyUI. MIT License (see workers/gpu/LICENSE).

One job per call. The input is {"job": "<type>", ...fields}; the output is
{type, mime, data (base64), width, height, duration, seconds, model, seed, ...}, or {"error": "..."}.

  Main image (MASSLESS_IMAGE=main, 80 GB GPU, weights on a RunPod network volume):
    animate        image -> video (Wan 2.2 I2V-A14B) or text -> video (T2V-A14B), 5 s at 16 fps, 480p or 720p;
                   mode "quick" (Wan2.2-Lightning LoRA, 4-8 steps) or "best" (full steps with CFG)
    motion         reference image + driving clip (<= 10 s) -> the character performing that motion (Wan-Animate-2)
    lipsync        face image + speech (<= 10 s) -> a talking video with that speech (Wan 2.2 S2V-14B)
    upscale_video  clip (<= 10 s) -> up to 1920x1080 (SeedVR2 7B, one step), sound kept
    music          style tags (+ lyrics) -> MP3 with ACE-Step 1.5 turbo
    upscale        image -> 2x or 4x JPEG/WebP with Real-ESRGAN x4plus
    prepare        (operator only; the site never sends it) fill or check the model volume
  Lab image (MASSLESS_IMAGE=lab; research licenses, results marked commercial: false):
    sound    MP4 (<= 10 s) + optional text -> the clip with generated foley muxed in, plus the audio alone
             (MMAudio, or HunyuanVideo-Foley)
    fibo     structured caption, Massless rig shot or text -> image, or an image edit (Fibo 2.0 edit turbo)

ComfyUI (GPL-3.0, installed separately, not part of this file) is started once per worker and kept
warm. Each job loads an API-format graph from workflows/, sets its named input nodes, submits it over
ComfyUI's HTTP API and follows it on the websocket (with /history polling as a fallback) until it
finishes, fails or times out. Uploaded inputs and rendered outputs are deleted after every job.

Environment (all optional):
    COMFY_DIR          ComfyUI checkout (/opt/ComfyUI). Inputs/outputs are cleaned up under it.
    COMFY_HOST         host:port ComfyUI listens on (127.0.0.1:8188)
    COMFY_START        1 = start ComfyUI from this process (default); 0 = use one that is already running
    COMFY_CMD          full command to start ComfyUI instead of the default (used by the tests)
    COMFY_ARGS         extra arguments appended to the default ComfyUI command
    COMFY_STARTUP_TIMEOUT  seconds to wait for ComfyUI to answer (180)
    MASSLESS_IMAGE     main or lab: which job types this image serves (main)
    MASSLESS_VOLUME    where the model volume keeps its files (/runpod-volume/massless); "off" = the
                       weights are already in ComfyUI's models folder (the Lab image, local runs)
    MASSLESS_MANIFEST  models.json to use (next to this file)
    MASSLESS_MODEL_WAIT  seconds a job waits for its model files to arrive on the volume (0: fail at once)
    MASSLESS_WORKFLOWS directory of workflow JSON files (workflows/ next to this file)
    MASSLESS_TIMEOUT_SCALE  multiply every job timeout (1.0)
    MASSLESS_MAX_RESULT_MB  largest base64 result in MB (15)
    MASSLESS_RIG       rig.json for fibo shots (next to this file, or public/data/rig.json in the repo)
    FFMPEG, FFPROBE    binaries for the video and audio jobs (ffmpeg, ffprobe)
"""
import base64
import binascii
import copy
import io
import json
import math
import os
import random
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid

import requests
from PIL import Image, ImageOps

try:  # websocket-client; without it the handler polls /history
    import websocket
except ImportError:  # pragma: no cover
    websocket = None

try:
    import runpod
except ImportError:  # the tests and local runs do not need the SDK
    runpod = None

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import volume as volume_mod  # noqa: E402  (workers/gpu/volume.py, next to this file)

COMFY_DIR = os.environ.get('COMFY_DIR', '/opt/ComfyUI')
COMFY_HOST = os.environ.get('COMFY_HOST', '127.0.0.1:8188')
COMFY_START = os.environ.get('COMFY_START', '1') == '1'
STARTUP_TIMEOUT = float(os.environ.get('COMFY_STARTUP_TIMEOUT', '180'))
IMAGE_KIND = os.environ.get('MASSLESS_IMAGE', 'main')
WORKFLOWS = os.environ.get('MASSLESS_WORKFLOWS', os.path.join(HERE, 'workflows'))
TIMEOUT_SCALE = float(os.environ.get('MASSLESS_TIMEOUT_SCALE', '1'))
MAX_RESULT_B64 = int(float(os.environ.get('MASSLESS_MAX_RESULT_MB', '15')) * 1_000_000)
VOLUME_DIR = os.environ.get('MASSLESS_VOLUME', '/runpod-volume/massless' if IMAGE_KIND == 'main' else 'off')
MANIFEST = os.environ.get('MASSLESS_MANIFEST', os.path.join(HERE, 'models.json'))
MODEL_WAIT = float(os.environ.get('MASSLESS_MODEL_WAIT', '0'))
FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
FFPROBE = os.environ.get('FFPROBE', 'ffprobe')

MAX_INPUT_B64 = 9_500_000      # RunPod /run bodies are limited to 10 MB
MAX_INPUT_SIDE = 2048           # the site sends JPEG <= 1536 px; a little headroom
MAX_INPUT_PIXELS = 2048 * 2048
MAX_UPSCALE_SIDE = 4096
MAX_MEDIA_B64 = 9_400_000       # a clip or a sound file plus the rest of the request under RunPod's 10 MB
MAX_MEDIA_BYTES = 7_050_000
MAX_CLIP_SECONDS = 10.0
SEED_MAX = 2**32 - 1
Image.MAX_IMAGE_PIXELS = 64_000_000  # Pillow's own bomb guard, on top of our size checks


class Invalid(ValueError):
    """Bad input: reported to the caller as is."""


class Deadline(Exception):
    """The job ran past its timeout."""


class JobError(RuntimeError):
    """ComfyUI or the worker failed: reported to the caller as is."""

    def __init__(self, message, refresh=False):
        super().__init__(message)
        self.refresh = refresh


# ---------------------------------------------------------------- input validation helpers

def _fields(inp, allowed):
    extra = sorted(set(inp) - set(allowed) - {'job'})
    if extra:
        raise Invalid(f"Unknown field{'s' if len(extra) > 1 else ''} {', '.join(extra)}. Allowed: {', '.join(sorted(allowed))}.")


def _int(inp, key, lo, hi, default):
    v = inp.get(key, None)
    if v is None:
        return default
    if isinstance(v, bool) or not isinstance(v, (int, float)) or (isinstance(v, float) and not v.is_integer()):
        raise Invalid(f'{key} must be a whole number.')
    v = int(v)
    if not lo <= v <= hi:
        raise Invalid(f'{key} must be between {lo} and {hi}.')
    return v


def _num(inp, key, lo, hi, default):
    v = inp.get(key, None)
    if v is None:
        return default
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        raise Invalid(f'{key} must be a number.')
    if not lo <= v <= hi:
        raise Invalid(f'{key} must be between {lo:g} and {hi:g}.')
    return float(v)


def _text(inp, key, maxlen, default='', required=False):
    v = inp.get(key, None)
    if v is None or (isinstance(v, str) and not v.strip()):
        if required:
            raise Invalid(f'{key} is required.')
        return default
    if not isinstance(v, str):
        raise Invalid(f'{key} must be text.')
    v = ''.join(c for c in v if c in '\n\t' or c.isprintable()).strip()
    if len(v) > maxlen:
        raise Invalid(f'{key} is {len(v)} characters; the limit is {maxlen}.')
    return v


def _choice(inp, key, options, default):
    v = inp.get(key, None)
    if v is None:
        return default
    if isinstance(v, (int, float)) and not isinstance(v, bool) and str(int(v)) in options and v == int(v):
        v = str(int(v))
    if v not in options:
        raise Invalid(f"{key} must be one of {', '.join(map(str, options))}.")
    return v


def _seed(inp):
    v = _int(inp, 'seed', 0, SEED_MAX, None)
    return random.SystemRandom().randint(0, SEED_MAX) if v is None else v


def _sniff(raw):
    if raw[:3] == b'\xff\xd8\xff':
        return 'JPEG'
    if raw[:8] == b'\x89PNG\r\n\x1a\n':
        return 'PNG'
    if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
        return 'WEBP'
    return None


def media_kind(raw):
    """Container of a clip or a sound file, from its first bytes."""
    if len(raw) >= 12 and raw[4:8] == b'ftyp':
        brand = raw[8:12]
        return 'm4a' if brand in (b'M4A ', b'M4B ') else 'mov' if brand == b'qt  ' else 'mp4'
    if raw[:4] == b'\x1aE\xdf\xa3':
        return 'webm'
    if raw[:4] == b'RIFF' and raw[8:12] == b'WAVE':
        return 'wav'
    if raw[:4] == b'OggS':
        return 'ogg'
    if raw[:4] == b'fLaC':
        return 'flac'
    if raw[:3] == b'ID3' or (len(raw) > 1 and raw[0] == 0xFF and raw[1] & 0xE0 == 0xE0):
        return 'mp3'
    return None


def decode_b64(value, key, limit=MAX_INPUT_B64):
    if not isinstance(value, str) or not value:
        raise Invalid(f'{key} is required: a base64 string.')
    if value.startswith('data:'):
        head, _, value = value.partition(',')
        if ';base64' not in head:
            raise Invalid(f'{key} must be base64 (a data: URL needs ;base64).')
    value = ''.join(value.split())
    if len(value) > limit:
        raise Invalid(f'{key} is {len(value) / 1e6:.1f} MB as base64; the limit is {limit / 1e6:.1f} MB.')
    try:
        return base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        raise Invalid(f'{key} is not valid base64.') from None


def decode_image(value, key='image', min_side=64):
    """Base64 JPEG/PNG/WebP -> RGB PIL image, upright (EXIF orientation applied)."""
    raw = decode_b64(value, key)
    fmt = _sniff(raw)
    if not fmt:
        raise Invalid(f'{key} must be a JPEG, PNG or WebP image.')
    try:
        im = Image.open(io.BytesIO(raw))
        if im.format != fmt:
            raise Invalid(f'{key} is not a readable {fmt} image.')
        w, h = im.size
        if max(w, h) > MAX_INPUT_SIDE or w * h > MAX_INPUT_PIXELS:
            raise Invalid(f'{key} is {w}x{h}; the limit is {MAX_INPUT_SIDE} px on the long side.')
        if min(w, h) < min_side:
            raise Invalid(f'{key} is {w}x{h}; it must be at least {min_side} px on each side.')
        im.load()
        im = ImageOps.exif_transpose(im)
    except Invalid:
        raise
    except Exception:
        raise Invalid(f'{key} could not be decoded (truncated or corrupt {fmt}).') from None
    if im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info):
        im = im.convert('RGBA')
        flat = Image.new('RGB', im.size, (0, 0, 0))
        flat.paste(im, mask=im.getchannel('A'))
        return flat
    return im.convert('RGB')


def decode_media(value, key, kinds):
    """Base64 clip or sound file -> (bytes, kind). Checks the size before decoding."""
    if isinstance(value, str) and len(value) * 3 // 4 > MAX_MEDIA_BYTES:
        raise Invalid(f'{key} is {len(value) * 3 / 4e6:.1f} MB; the limit is {MAX_MEDIA_BYTES / 1e6:.0f} MB.')
    raw = decode_b64(value, key, MAX_MEDIA_B64 + 1000)
    kind = media_kind(raw)
    if kind not in kinds:
        raise Invalid(f"{key} must be {', '.join(k.upper() for k in kinds[:-1])} or {kinds[-1].upper()}.")
    return raw, kind


def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, 'PNG', compress_level=1)
    return buf.getvalue()


def cover(im, w, h):
    """Center-crop to the w:h aspect and resize to exactly w x h."""
    return ImageOps.fit(im, (w, h), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))


# ---------------------------------------------------------------- ffmpeg

def _run(cmd, timeout=120, what='ffmpeg'):
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except FileNotFoundError:
        raise JobError(f'{what} is not installed in this image.') from None
    except subprocess.TimeoutExpired:
        raise JobError(f'{what} took too long.') from None
    if r.returncode != 0:
        tail = r.stderr.decode('utf-8', 'replace').strip().splitlines()[-1:] or ['failed']
        raise Invalid(f'The file could not be read ({tail[0][:160]}).') if what == 'ffprobe' else JobError(f'{what} failed: {tail[0][:200]}')
    return r.stdout


def probe(path):
    """Duration, size, fps, frame count and tracks of a clip or a sound file."""
    info = json.loads(_run([FFPROBE, '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], 30, 'ffprobe') or b'{}')
    streams = info.get('streams', [])
    video = next((st for st in streams if st.get('codec_type') == 'video' and not (st.get('disposition') or {}).get('attached_pic')), None)
    audio = next((st for st in streams if st.get('codec_type') == 'audio'), None)
    duration = float((video or audio or {}).get('duration') or (info.get('format') or {}).get('duration') or 0)
    fps = 0.0
    if video:
        num, _, den = str(video.get('avg_frame_rate') or video.get('r_frame_rate') or '0/1').partition('/')
        try:
            fps = float(num) / float(den or 1)
        except (ValueError, ZeroDivisionError):
            fps = 0.0
    return {'width': int((video or {}).get('width') or 0), 'height': int((video or {}).get('height') or 0), 'duration': duration,
            'fps': fps, 'codec': (video or audio or {}).get('codec_name'), 'has_video': video is not None, 'has_audio': audio is not None,
            'frames': int((video or {}).get('nb_frames') or 0)}


def probe_video(path):
    info = probe(path)
    if not info['has_video']:
        raise Invalid('video has no video track.')
    return info


def count_frames(path):
    out = _run([FFPROBE, '-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets',
                '-of', 'csv=p=0', path], 60, 'ffprobe')
    try:
        return int(out.decode().strip().split(',')[0])
    except ValueError:
        raise JobError('Could not count the frames of the prepared clip.') from None


def fit_video(data, duration, tmp):
    """Re-encode an MP4 that would be over the result limit as base64, at a bitrate that fits."""
    if len(data) * 4 / 3 <= MAX_RESULT_B64 * 0.98:
        return data, False
    src, dst = os.path.join(tmp, 'big.mp4'), os.path.join(tmp, 'fit.mp4')
    with open(src, 'wb') as f:
        f.write(data)
    kbps = max(300, int(MAX_RESULT_B64 * 0.75 * 0.9 * 8 / max(duration, 0.5) / 1000) - 160)
    _run([FFMPEG, '-v', 'error', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'medium', '-b:v', f'{kbps}k',
          '-maxrate', f'{kbps}k', '-bufsize', f'{2 * kbps}k', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', dst], 300)
    with open(dst, 'rb') as f:
        return f.read(), True


# ---------------------------------------------------------------- job specs

class Spec:
    """What to run: a workflow, the inputs to set on it, uploads, the model files it needs and how to package the result."""

    def __init__(self, job, workflow, sets, out_node, timeout, meta, upload=None, finish=None, stages=None, cleanup=None,
                 uploads=None, models=(), edit=None):
        self.job = job
        self.workflow = workflow
        self.sets = sets          # {node_id: {input: value}}; '$upload' / '$upload:<key>' become the uploaded names
        self.out_node = out_node
        self.timeout = timeout * TIMEOUT_SCALE
        self.meta = meta          # merged into the result
        self.uploads = dict(uploads or {})  # {key: (bytes, extension, mime)} for Load* nodes
        if upload is not None:
            self.uploads['main'] = upload
        self.finish = finish or (lambda raw, fn: (raw, meta['mime']))
        self.stages = stages or {}
        self.cleanup = cleanup    # called once the job is over, success or not
        self.models = list(models)  # manifest ids that must be on the volume
        self.edit = edit          # graph -> None: rewires the loaded workflow (modes, extra chunks)


def needs(*jobs_or_ids, manifest=None):
    """Manifest ids for a list of ids (kept) and job kinds (expanded)."""
    m = manifest or _manifest()
    ids = {e['id'] for e in m['models']}
    out = []
    for x in jobs_or_ids:
        out += [x] if x in ids else [e['id'] for e in m['models'] if x in e['jobs']]
    return list(dict.fromkeys(out))


_manifest_cache = None


def _manifest():
    global _manifest_cache
    if _manifest_cache is None:
        _manifest_cache = volume_mod.load_manifest(MANIFEST)
    return _manifest_cache


def _rewire(graph, drop, node, inp, src):
    for d in drop:
        graph.pop(d, None)
    graph[node]['inputs'][inp] = [src, 0]


def _ceil30(x):
    return 30 * math.ceil(x / 30 - 1e-9)


# Timing model for an A100 80 GB (the slower of the endpoint's two GPU types; an H100 runs about twice as fast).
# One Wan 14B forward pass over an 81-frame clip: ~11 s at 480p, ~40 s at 720p. "best" runs CFG (cond and uncond
# batched, ~1.8x a pass). The timeout is the cold model load from the volume + 1.5x the warm estimate, rounded up
# to 30 s. src/gpu-jobs.js mirrors these numbers (tests/fixtures/gpu_timeouts.json is checked against both).
COLD_LOAD = {'animate': 120, 'motion': 120, 'lipsync': 90, 'upscale_video': 60}
WAN_PASS = {'480p': 11.0, '720p': 40.0}
WAN_OVERHEAD = {'480p': 20, '720p': 45}
STEPS = {('animate', 'quick'): (4, 8, 4), ('animate', 'best', '480p'): (10, 30, 20), ('animate', 'best', '720p'): (10, 20, 20),
         ('lipsync', 'quick'): (4, 8, 4), ('lipsync', 'best'): (10, 20, 20), ('motion',): (6, 12, 10)}
MOTION_PASS = 15.0     # one Wan-Animate-2 pass over a 21-latent-frame window at 480p (reference frame + pose branch)
S2V_PASS = 13.0        # one S2V pass over a 77-frame chunk at 480p (audio and reference conditioning)
SEEDVR2_FRAME = 0.9    # seconds per 1920x1080 output frame (VAE encode + one 7B step + VAE decode)


def _evals(mode, steps):
    return steps if mode == 'quick' else steps * 1.8


def animate_estimate(mode, resolution, steps):
    return WAN_OVERHEAD[resolution] + WAN_PASS[resolution] * _evals(mode, steps)


def motion_windows(frames):
    latent = (frames - 1) // 4 + 1 + 1  # + the reference frame
    return 1 if latent <= 21 else 1 + math.ceil((latent - 21) / 13)


def motion_estimate(steps, frames=161):
    return 40 + MOTION_PASS * motion_windows(frames) * steps


def lipsync_estimate(mode, steps, chunks=3):
    return 30 + S2V_PASS * chunks * _evals(mode, steps)


def upscale_video_estimate(frames=300, pixels=1920 * 1080):
    return 20 + SEEDVR2_FRAME * frames * pixels / (1920 * 1080)


def job_timeout(job, warm):
    return COLD_LOAD[job] + _ceil30(1.5 * warm)


DEFAULT_PROMPT = 'smooth natural motion, cinematic, steady camera'
ANIMATE_SIZES = {
    ('480p', '16:9'): (832, 480), ('480p', '9:16'): (480, 832), ('480p', '1:1'): (640, 640),
    ('720p', '16:9'): (1280, 720), ('720p', '9:16'): (720, 1280), ('720p', '1:1'): (960, 960),
}
WAN_FPS = 16
ANIMATE_FRAMES = 81  # 5 s at 16 fps; Wan's frame count is 4n+1
STAGES_ANIMATE = {'unet_high': (2, 'Loading the video model'), 'clip': (10, 'Loading the text encoder'), 'vae': (14, 'Loading the VAE'),
                  'prompt': (16, 'Reading the prompt'), 'negative': (17, 'Reading the prompt'), 'latent': (18, 'Preparing the first frame'),
                  'sampler_high': (20, 'Rendering the motion'), 'sampler_low': (55, 'Rendering the detail'), 'decode': (88, 'Decoding frames'),
                  'video': (94, 'Encoding the video'), 'save': (95, 'Encoding the video')}


def _steps(inp, key):
    lo, hi, default = STEPS[key]
    return _int(inp, 'steps', lo, hi, default)


def spec_animate(inp):
    if inp.get('model') is not None:
        raise Invalid('model is gone: animate always runs Wan 2.2 A14B. Choose mode "quick" or "best".')
    _fields(inp, ['image', 'prompt', 'negative', 'resolution', 'aspect', 'seed', 'steps', 'mode', 'cfg'])
    mode = _choice(inp, 'mode', ['quick', 'best'], 'quick')
    resolution = _choice(inp, 'resolution', ['480p', '720p'], '480p')
    aspect = _choice(inp, 'aspect', ['16:9', '9:16', '1:1'], '16:9')
    t2v = inp.get('image') is None
    prompt = _text(inp, 'prompt', 1200, None if t2v else DEFAULT_PROMPT, required=t2v)
    if mode == 'quick':
        steps = _steps(inp, ('animate', 'quick'))
        if inp.get('cfg') is not None:
            raise Invalid('cfg needs mode "best" (the quick LoRA runs without guidance).')
        if inp.get('negative'):
            raise Invalid('negative needs mode "best" (the quick LoRA runs without guidance, so it would be ignored).')
        cfg, negative = 1.0, None
    else:
        steps = _steps(inp, ('animate', 'best', resolution))
        cfg = round(_num(inp, 'cfg', 1.5, 8.0, 3.5), 2)
        negative = _text(inp, 'negative', 600, None)
    seed = _seed(inp)
    w, h = ANIMATE_SIZES[(resolution, aspect)]
    split = math.ceil(steps / 2)  # the high-noise expert takes the first half, as in ComfyUI's template
    sets = {
        'prompt': {'text': prompt},
        'latent': {'width': w, 'height': h, 'length': ANIMATE_FRAMES},
        'sampler_high': {'noise_seed': seed, 'steps': steps, 'cfg': cfg, 'end_at_step': split},
        'sampler_low': {'steps': steps, 'cfg': cfg, 'start_at_step': split},
        'save': {'format.codec.encoding.crf': 19.0 if resolution == '480p' else 20.0},
    }
    if negative:
        sets['negative'] = {'text': negative}
    kind = 't2v' if t2v else 'i2v'
    uploads = {}
    if not t2v:
        im = cover(decode_image(inp.get('image'), 'image', min_side=128), w, h)
        uploads['main'] = (png_bytes(im), 'png', 'image/png')
        sets['image_in'] = {'image': '$upload'}
    models = needs('umt5_xxl_fp8', 'wan21_vae', f'wan22_{kind}_high', f'wan22_{kind}_low', *([f'lightx2v_{kind}_high', f'lightx2v_{kind}_low'] if mode == 'quick' else []))

    def edit(graph):
        if mode == 'best':  # no LoRA: the experts at full strength, with CFG
            _rewire(graph, ['lora_high'], 'shift_high', 'model', 'unet_high')
            _rewire(graph, ['lora_low'], 'shift_low', 'model', 'unet_low')

    meta = {'type': 'video', 'mime': 'video/mp4', 'width': w, 'height': h, 'duration': round(ANIMATE_FRAMES / WAN_FPS, 3),
            'fps': WAN_FPS, 'frames': ANIMATE_FRAMES, 'model': f'wan2.2-{kind}-a14b' + ('-lightning-4step' if mode == 'quick' else ''),
            'seed': seed, 'steps': steps, 'cfg': cfg, 'mode': mode, 'resolution': resolution, 'aspect': aspect, 'source': 'text' if t2v else 'image'}

    def finish(raw, filename):
        tmp = tempfile.mkdtemp(prefix='massless-animate-')
        try:
            data, meta['reencoded'] = fit_video(raw, meta['duration'], tmp)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        return data, 'video/mp4'

    timeout = job_timeout('animate', animate_estimate(mode, resolution, steps))
    return Spec('animate', f'animate_{kind}.json', sets, 'save', timeout, meta, uploads=uploads, stages=STAGES_ANIMATE, models=models, edit=edit, finish=finish)


def _orient(w, h):
    r = w / max(h, 1)
    return '1:1' if 0.8 <= r <= 1.25 else '16:9' if r > 1 else '9:16'


def _clip_in(inp, key, kinds, tmp):
    """Write an input clip to tmp, probe it, and check its length."""
    raw, kind = decode_media(inp.get(key), key, kinds)
    src = os.path.join(tmp, f'source.{kind}')
    with open(src, 'wb') as f:
        f.write(raw)
    info = probe_video(src)
    if info['duration'] > MAX_CLIP_SECONDS + 0.05:
        raise Invalid(f"{key} is {info['duration']:.1f} s; the limit is {MAX_CLIP_SECONDS:.0f} s.")
    if info['duration'] < 1:
        raise Invalid(f'{key} must be at least 1 s long.')
    if info['width'] < 64 or info['height'] < 64:
        raise Invalid(f"{key} is {info['width']}x{info['height']}; it must be at least 64 px on each side.")
    return src, info


STAGES_MOTION = {'unet': (2, 'Loading Wan-Animate-2'), 'clip': (10, 'Loading the text encoder'), 'video_in': (14, 'Reading the driving clip'),
                 'see_ref': (16, 'Looking at the character'), 'animate': (18, 'Reading the motion'), 'sampler': (24, 'Animating the character'),
                 'decode': (88, 'Decoding frames'), 'save': (95, 'Encoding the video')}


def spec_motion(inp):
    _fields(inp, ['image', 'video', 'prompt', 'seed', 'steps', 'keep_audio'])
    steps = _steps(inp, ('motion',))
    prompt = _text(inp, 'prompt', 1200, 'Character description: the person in the reference image\nBackground description: the same place as the reference image')
    seed = _seed(inp)
    keep_audio = inp.get('keep_audio', True)
    if not isinstance(keep_audio, bool):
        raise Invalid('keep_audio must be true or false.')
    im = decode_image(inp.get('image'), 'image', min_side=128)
    tmp = tempfile.mkdtemp(prefix='massless-motion-')
    try:
        src, info = _clip_in(inp, 'video', ['mp4', 'mov', 'webm'], tmp)
        w, h = ANIMATE_SIZES[('480p', _orient(info['width'], info['height']))]
        drive = os.path.join(tmp, 'drive.mp4')
        # what the model reads: 16 fps (Wan's rate), the first 10 s, small enough to upload fast, no sound
        _run([FFMPEG, '-v', 'error', '-y', '-i', src, '-t', f'{MAX_CLIP_SECONDS:g}', '-an', '-vf',
              f"fps={WAN_FPS},scale='if(gt(iw,ih),-2,{max(w, h)})':'if(gt(iw,ih),{max(w, h)},-2)'",
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', drive], 180)
        frames = count_frames(drive)
        if frames < 17:
            raise Invalid('video must be at least 1 s long.')
        length = (frames - 1) // 4 * 4 + 1
        sound = None
        if keep_audio and info['has_audio']:
            sound = os.path.join(tmp, 'drive.m4a')
            _run([FFMPEG, '-v', 'error', '-y', '-i', src, '-t', f'{length / WAN_FPS:.3f}', '-vn', '-c:a', 'aac', '-b:a', '160k', sound], 60)
        with open(drive, 'rb') as f:
            drive_bytes = f.read()
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    duration = round(length / WAN_FPS, 3)
    meta = {'type': 'video', 'mime': 'video/mp4', 'width': w, 'height': h, 'duration': duration, 'fps': WAN_FPS, 'frames': length,
            'model': 'wan-animate-2-14b-distill', 'seed': seed, 'steps': steps, 'resolution': '480p', 'kept_audio': sound is not None}

    def finish(raw, filename):
        out = os.path.join(tmp, 'motion.mp4')
        with open(out, 'wb') as f:
            f.write(raw)
        if sound:
            muxed = os.path.join(tmp, 'motion_sound.mp4')
            _run([FFMPEG, '-v', 'error', '-y', '-i', out, '-i', sound, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-shortest',
                  '-movflags', '+faststart', muxed], 60)
            out = muxed
        with open(out, 'rb') as f:
            data = f.read()
        data, meta['reencoded'] = fit_video(data, duration, tmp)
        return data, 'video/mp4'

    sets = {'image_in': {'image': '$upload'}, 'video_in': {'file': '$upload:video'}, 'prompt': {'text': prompt},
            'pose': {'resize_type.width': w, 'resize_type.height': h},
            'animate': {'width': w, 'height': h, 'length': length}, 'sigmas': {'steps': steps}, 'sampler': {'noise_seed': seed}}
    uploads = {'main': (png_bytes(cover(im, w, h)), 'png', 'image/png'), 'video': (drive_bytes, 'mp4', 'video/mp4')}
    timeout = job_timeout('motion', motion_estimate(steps, length))
    return Spec('motion', 'motion_animate2.json', sets, 'save', timeout, meta, uploads=uploads, finish=finish, stages=STAGES_MOTION,
                cleanup=lambda: shutil.rmtree(tmp, ignore_errors=True), models=needs('motion'))


S2V_CHUNK = 77  # frames per S2V chunk (the length of the official code)
STAGES_LIPSYNC = {'unet': (2, 'Loading Wan 2.2 S2V'), 'audio_encoder': (8, 'Loading the speech encoder'), 'listen': (12, 'Listening'),
                  'clip': (14, 'Loading the text encoder'), 'latent': (18, 'Looking at the face'), 'sampler': (20, 'Animating the face'),
                  'decode': (90, 'Decoding frames'), 'save': (95, 'Encoding the video')}


def spec_lipsync(inp):
    _fields(inp, ['image', 'audio', 'prompt', 'aspect', 'seed', 'steps', 'mode'])
    mode = _choice(inp, 'mode', ['quick', 'best'], 'quick')
    steps = _steps(inp, ('lipsync', mode))
    cfg = 1.0 if mode == 'quick' else 6.0
    prompt = _text(inp, 'prompt', 1200, 'The person is talking to the camera, natural expressions and gestures.')
    seed = _seed(inp)
    im = decode_image(inp.get('image'), 'image', min_side=128)
    aspect = _choice(inp, 'aspect', ['16:9', '9:16', '1:1'], _orient(im.width, im.height))
    w, h = ANIMATE_SIZES[('480p', aspect)]
    raw, kind = decode_media(inp.get('audio'), 'audio', ['mp3', 'wav', 'm4a', 'ogg', 'flac'])
    tmp = tempfile.mkdtemp(prefix='massless-lipsync-')
    try:
        src = os.path.join(tmp, f'input.{kind}')
        with open(src, 'wb') as f:
            f.write(raw)
        info = probe(src)
        if not info['has_audio']:
            raise Invalid('audio has no sound track.')
        if info['duration'] > MAX_CLIP_SECONDS + 0.05:
            raise Invalid(f"audio is {info['duration']:.1f} s; the limit is {MAX_CLIP_SECONDS:.0f} s.")
        if info['duration'] < 1:
            raise Invalid('audio must be at least 1 s long.')
        wav = os.path.join(tmp, 'speech.wav')
        _run([FFMPEG, '-v', 'error', '-y', '-i', src, '-t', f'{MAX_CLIP_SECONDS:g}', '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', wav], 60)
        with open(wav, 'rb') as f:
            wav_bytes = f.read()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    seconds = min(info['duration'], MAX_CLIP_SECONDS)
    frames = max(1, math.ceil(seconds * WAN_FPS))
    chunks = math.ceil(frames / S2V_CHUNK)

    def edit(graph):
        if mode == 'best':
            _rewire(graph, ['lora'], 'shift', 'model', 'unet')
        prev = 'sampler'
        for k in range(1, chunks):
            ext, smp, cat = f'extend_{k}', f'sampler_{k}', f'concat_{k}'
            graph[ext] = {'class_type': 'WanSoundImageToVideoExtend', '_meta': {'title': f'Chunk {k + 1}: the next {S2V_CHUNK} frames'},
                          'inputs': {'positive': ['prompt', 0], 'negative': ['negative', 0], 'vae': ['vae', 0], 'length': S2V_CHUNK,
                                     'video_latent': [prev, 0], 'audio_encoder_output': ['listen', 0], 'ref_image': ['image_in', 0]}}
            graph[smp] = {'class_type': 'KSampler', '_meta': {'title': f'Chunk {k + 1}'},
                          'inputs': dict(graph['sampler']['inputs'], seed=(seed + k) % (SEED_MAX + 1), steps=steps, cfg=cfg,
                                                positive=[ext, 0], negative=[ext, 1], latent_image=[ext, 2])}
            graph[cat] = {'class_type': 'LatentConcat', '_meta': {'title': f'Chunks 1-{k + 1}'},
                          'inputs': {'samples1': [prev, 0], 'samples2': [smp, 0], 'dim': 't'}}
            prev = cat
        graph['joined']['inputs']['samples2'] = [prev, 0]

    sets = {'image_in': {'image': '$upload'}, 'audio_in': {'audio': '$upload:audio'}, 'prompt': {'text': prompt},
            'latent': {'width': w, 'height': h, 'length': S2V_CHUNK}, 'sampler': {'seed': seed, 'steps': steps, 'cfg': cfg},
            'frames': {'length': frames}}
    meta = {'type': 'video', 'mime': 'video/mp4', 'width': w, 'height': h, 'duration': round(frames / WAN_FPS, 3), 'fps': WAN_FPS, 'frames': frames,
            'model': 'wan2.2-s2v-14b' + ('-lightning-4step' if mode == 'quick' else ''), 'seed': seed, 'steps': steps, 'cfg': cfg, 'mode': mode,
            'aspect': aspect, 'chunks': chunks, 'resolution': '480p'}

    def finish(raw, filename):
        t = tempfile.mkdtemp(prefix='massless-lipsync-')
        try:
            data, meta['reencoded'] = fit_video(raw, meta['duration'], t)
        finally:
            shutil.rmtree(t, ignore_errors=True)
        return data, 'video/mp4'

    uploads = {'main': (png_bytes(cover(im, w, h)), 'png', 'image/png'), 'audio': (wav_bytes, 'wav', 'audio/wav')}
    models = needs('umt5_xxl_fp8', 'wan21_vae', 'wan22_s2v', 'wav2vec2_large_en', *(['lightx2v_t2v_high'] if mode == 'quick' else []))
    timeout = job_timeout('lipsync', lipsync_estimate(mode, steps, chunks))
    return Spec('lipsync', 'lipsync_s2v.json', sets, 'save', timeout, meta, uploads=uploads, finish=finish, stages=STAGES_LIPSYNC, models=models, edit=edit)


UPSCALE_VIDEO_MAX = (1920, 1080)  # long side, short side
UPSCALE_VIDEO_FPS = 30
STAGES_UPSCALE_VIDEO = {'unet': (2, 'Loading SeedVR2'), 'video_in': (8, 'Reading the clip'), 'resize': (10, 'Resizing'), 'encode': (14, 'Encoding frames'),
                        'sampler': (40, 'Restoring detail'), 'decode': (60, 'Decoding frames'), 'post': (88, 'Matching colors'), 'save': (93, 'Encoding the video')}


def upscale_video_size(w, h, scale):
    long_max, short_max = UPSCALE_VIDEO_MAX
    s = min(scale, long_max / max(w, h), short_max / min(w, h))
    return 2 * max(1, round(w * s / 2)), 2 * max(1, round(h * s / 2))


def spec_upscale_video(inp):
    _fields(inp, ['video', 'scale', 'seed'])
    scale = _int(inp, 'scale', 2, 4, 2)
    if scale not in (2, 4):
        raise Invalid('scale must be 2 or 4.')
    seed = _seed(inp)
    tmp = tempfile.mkdtemp(prefix='massless-vup-')
    try:
        src, info = _clip_in(inp, 'video', ['mp4', 'mov', 'webm'], tmp)
        w, h = upscale_video_size(info['width'], info['height'], scale)
        if w <= info['width'] * 1.05 and h <= info['height'] * 1.05:
            raise Invalid(f"video is {info['width']}x{info['height']}; it is already as large as this job makes ({UPSCALE_VIDEO_MAX[0]}x{UPSCALE_VIDEO_MAX[1]} at most).")
        fps = info['fps'] if 0 < info['fps'] <= UPSCALE_VIDEO_FPS + 0.01 else UPSCALE_VIDEO_FPS
        clip = os.path.join(tmp, 'clip.mp4')
        _run([FFMPEG, '-v', 'error', '-y', '-i', src, '-t', f'{MAX_CLIP_SECONDS:g}', '-map', '0:v:0', '-map', '0:a:0?', '-vf', f'fps={fps:.6g}',
              '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', clip], 180)
        frames = count_frames(clip)
        with open(clip, 'rb') as f:
            clip_bytes = f.read()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    duration = round(frames / fps, 3)
    meta = {'type': 'video', 'mime': 'video/mp4', 'width': w, 'height': h, 'duration': duration, 'fps': round(fps, 3), 'frames': frames,
            'model': 'seedvr2-7b', 'seed': seed, 'scale': round(w / info['width'], 3), 'source': [info['width'], info['height']]}

    def finish(raw, filename):
        t = tempfile.mkdtemp(prefix='massless-vup-')
        try:
            data, meta['reencoded'] = fit_video(raw, duration, t)
        finally:
            shutil.rmtree(t, ignore_errors=True)
        return data, 'video/mp4'

    sets = {'video_in': {'file': '$upload:video'}, 'resize': {'resize_type.width': w, 'resize_type.height': h}, 'sampler': {'seed': seed}}
    timeout = job_timeout('upscale_video', upscale_video_estimate(frames, w * h))
    return Spec('upscale_video', 'upscale_video_seedvr2.json', sets, 'save', timeout, meta, uploads={'video': (clip_bytes, 'mp4', 'video/mp4')},
                finish=finish, stages=STAGES_UPSCALE_VIDEO, models=needs('upscale_video'))


KEYSCALES = [f'{root} {q}' for q in ('major', 'minor') for root in
             ('C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B')]
LANGUAGES = ['ar', 'az', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fr', 'he', 'hi', 'hr', 'ht', 'hu', 'id',
             'is', 'it', 'ja', 'ko', 'la', 'lt', 'ms', 'ne', 'nl', 'no', 'pa', 'pl', 'pt', 'ro', 'ru', 'sa', 'sk', 'sr', 'sv', 'sw',
             'ta', 'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'yue', 'zh', 'unknown']
STAGES_MUSIC = {'unet': (2, 'Loading the music model'), 'clip': (10, 'Loading the planner'), 'vae': (18, 'Loading the VAE'),
                'text': (20, 'Planning the song'), 'latent': (55, 'Composing'), 'sampler': (56, 'Composing'),
                'decode': (85, 'Mixing down'), 'save': (95, 'Encoding the MP3')}


def spec_music(inp):
    _fields(inp, ['tags', 'lyrics', 'duration', 'bpm', 'key', 'timesignature', 'language', 'seed'])
    tags = _text(inp, 'tags', 600, required=True)
    lyrics = _text(inp, 'lyrics', 4000, '') or '[Instrumental]'
    duration = round(_num(inp, 'duration', 10, 180, 30.0), 1)
    bpm = _int(inp, 'bpm', 40, 220, 120)
    key = _choice(inp, 'key', KEYSCALES, 'C major')
    ts = _choice(inp, 'timesignature', ['2', '3', '4', '6'], '4')
    language = _choice(inp, 'language', LANGUAGES, 'en')
    seed = _seed(inp)
    sets = {
        'text': {'tags': tags, 'lyrics': lyrics, 'seed': seed, 'bpm': bpm, 'duration': duration,
                 'timesignature': ts, 'language': language, 'keyscale': key},
        'latent': {'seconds': duration},
        'sampler': {'seed': seed},
    }
    meta = {'type': 'audio', 'mime': 'audio/mpeg', 'width': None, 'height': None, 'duration': duration,
            'model': 'ace-step-1.5-turbo', 'seed': seed, 'bpm': bpm, 'key': key, 'instrumental': lyrics == '[Instrumental]'}
    return Spec('music', 'music_ace15.json', sets, 'save', 90 + duration, meta, stages=STAGES_MUSIC, models=needs('music'))


STAGES_UPSCALE = {'model': (5, 'Loading Real-ESRGAN'), 'image_in': (10, 'Reading the image'), 'upscale': (12, 'Upscaling'),
                  'resize': (85, 'Resizing'), 'save': (92, 'Saving')}


def upscale_size(w, h, scale):
    s = min(scale, MAX_UPSCALE_SIDE / max(w, h))
    return max(1, round(w * s)), max(1, round(h * s))


def encode_still(png, fmt):
    im = Image.open(io.BytesIO(png))
    im.load()
    im = im.convert('RGB')
    for q in (92, 86, 80, 72):
        buf = io.BytesIO()
        if fmt == 'webp':
            im.save(buf, 'WEBP', quality=q, method=4)
        else:
            im.save(buf, 'JPEG', quality=q, optimize=True, progressive=True, subsampling='4:2:0' if q < 90 else '4:4:4')
        if len(buf.getvalue()) * 4 / 3 <= MAX_RESULT_B64:
            return buf.getvalue(), q
    return buf.getvalue(), q


def spec_upscale(inp):
    _fields(inp, ['image', 'scale', 'format'])
    scale = _int(inp, 'scale', 2, 4, 2)
    if scale not in (2, 4):
        raise Invalid('scale must be 2 or 4.')
    fmt = _choice(inp, 'format', ['jpeg', 'webp'], 'jpeg')
    im = decode_image(inp.get('image'), 'image', min_side=16)
    w, h = upscale_size(im.width, im.height, scale)
    mime = 'image/webp' if fmt == 'webp' else 'image/jpeg'
    meta = {'type': 'image', 'mime': mime, 'width': w, 'height': h, 'duration': None, 'model': 'realesrgan-x4plus', 'seed': None,
            'scale': round(w / im.width, 3), 'source': [im.width, im.height]}

    def finish(raw, filename):
        data, q = encode_still(raw, fmt)
        meta['quality'] = q
        return data, mime

    sets = {'image_in': {'image': '$upload'}, 'resize': {'width': w, 'height': h}}
    return Spec('upscale', 'upscale_esrgan.json', sets, 'save', 150, meta, upload=(png_bytes(im), 'png', 'image/png'), finish=finish, stages=STAGES_UPSCALE, models=needs('upscale'))



# ---------------------------------------------------------------- Lab jobs (research licenses, MASSLESS_IMAGE=lab)
# Every Lab result carries license and commercial: false so the site can label it.

MAX_VIDEO_B64, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS = MAX_MEDIA_B64, MAX_MEDIA_BYTES, MAX_CLIP_SECONDS
SOUND_FPS = 25                 # MMAudio's sync encoder samples 25 fps and its node does not resample
SOUND_SIDE = 512               # the visual encoders look at 384-512 px; smaller uploads, same result
SOUND_MODELS = {
    'mmaudio': {'workflow': 'sound_mmaudio.json', 'model': 'mmaudio-large-44k-v2', 'steps': (10, 50, 25),
                'license': 'CC-BY-NC-4.0', 'licenses': ['CC-BY-NC-4.0 (MMAudio weights)', 'Apple-AMLR (DFN5B CLIP)', 'MIT (MMAudio code, BigVGAN v2)'],
                'license_url': 'https://huggingface.co/hkchengrex/MMAudio'},
    'foley': {'workflow': 'sound_foley.json', 'model': 'hunyuanvideo-foley-xxl-fp8', 'steps': (10, 60, 50),
              'license': 'Tencent-Hunyuan-Community', 'licenses': ['Tencent Hunyuan Community License (not licensed in the EU, UK or South Korea)', 'Apache-2.0 (SigLIP2, CLAP)'],
              'license_url': 'https://huggingface.co/tencent/HunyuanVideo-Foley/blob/main/LICENSE'},
}
STAGES_SOUND = {'video_in': (3, 'Reading the clip'), 'frames': (6, 'Reading the clip'), 'model': (10, 'Loading the sound model'),
                'features': (18, 'Loading the encoders'), 'deps': (18, 'Loading the encoders'), 'sampler': (28, 'Listening and generating sound'),
                'save': (92, 'Mixing the track into the clip')}


def spec_sound(inp):
    import shutil
    import tempfile
    _fields(inp, ['video', 'prompt', 'negative', 'model', 'seed', 'steps'])
    model = _choice(inp, 'model', list(SOUND_MODELS), 'mmaudio')
    cfg = SOUND_MODELS[model]
    lo, hi, default_steps = cfg['steps']
    steps = _int(inp, 'steps', lo, hi, default_steps)
    prompt = _text(inp, 'prompt', 400, '')
    negative = _text(inp, 'negative', 300, '' if model == 'mmaudio' else 'noisy, harsh, distorted')
    seed = _seed(inp)
    value = inp.get('video')
    if isinstance(value, str) and len(value) * 3 // 4 > MAX_VIDEO_BYTES:
        raise Invalid(f'video is {len(value) * 3 / 4e6:.1f} MB; the limit is {MAX_VIDEO_BYTES / 1e6:.0f} MB.')
    raw = decode_b64(value, 'video', MAX_VIDEO_B64 + 1000)
    if len(raw) < 12 or raw[4:8] != b'ftyp':
        raise Invalid('video must be an MP4 file.')
    tmp = tempfile.mkdtemp(prefix='massless-sound-')
    try:
        src = os.path.join(tmp, 'source.mp4')
        with open(src, 'wb') as f:
            f.write(raw)
        info = probe_video(src)
        if info['duration'] > MAX_VIDEO_SECONDS + 0.05:
            raise Invalid(f"video is {info['duration']:.1f} s; the limit is {MAX_VIDEO_SECONDS:.0f} s.")
        if info['duration'] < 1:
            raise Invalid('video must be at least 1 s long.')
        # what the models look at: 25 fps, at most 512 px on the short side, no audio
        small = os.path.join(tmp, 'frames.mp4')
        scale = f"scale='trunc(min(iw,iw*{SOUND_SIDE}/min(iw,ih))/2)*2':'trunc(min(ih,ih*{SOUND_SIDE}/min(iw,ih))/2)*2'"
        _run([FFMPEG, '-v', 'error', '-y', '-i', src, '-an', '-vf', f'fps={SOUND_FPS},{scale}', '-c:v', 'libx264', '-preset', 'veryfast',
              '-crf', '16', '-pix_fmt', 'yuv420p', small], 120)
        with open(small, 'rb') as f:
            frames = f.read()
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    duration = round(min(info['duration'], MAX_VIDEO_SECONDS), 2)
    meta = {'type': 'video', 'mime': 'video/mp4', 'width': info['width'], 'height': info['height'], 'duration': duration,
            'model': cfg['model'], 'seed': seed, 'steps': steps, 'license': cfg['license'], 'licenses': cfg['licenses'],
            'license_url': cfg['license_url'], 'commercial': False, 'replaced_audio': info['has_audio']}

    def finish(flac, filename):
        audio = os.path.join(tmp, 'sound.flac')
        with open(audio, 'wb') as f:
            f.write(flac)
        muxed, alone = os.path.join(tmp, 'with_sound.mp4'), os.path.join(tmp, 'sound.m4a')
        # the original picture untouched (stream copy), the new sound as AAC; any old audio track is dropped
        _run([FFMPEG, '-v', 'error', '-y', '-i', src, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac',
              '-b:a', '192k', '-shortest', '-movflags', '+faststart', muxed], 120)
        _run([FFMPEG, '-v', 'error', '-y', '-i', muxed, '-map', '0:a:0', '-c:a', 'copy', '-movflags', '+faststart', alone], 60)
        with open(muxed, 'rb') as f:
            video = f.read()
        with open(alone, 'rb') as f:
            m4a = f.read()
        meta['audio'] = {'mime': 'audio/mp4', 'data': base64.b64encode(m4a).decode('ascii'), 'bytes': len(m4a)}
        return video, 'video/mp4'

    sets = {'video_in': {'file': '$upload'},
            'sampler': {'duration': duration, 'seed': seed, 'steps': steps, 'prompt': prompt,
                        'negative_prompt': negative}}
    timeout = 120 if model == 'mmaudio' else 210
    return Spec('sound', cfg['workflow'], sets, 'save', timeout, meta, upload=(frames, 'mp4', 'video/mp4'), finish=finish,
                stages=STAGES_SOUND, cleanup=lambda: shutil.rmtree(tmp, ignore_errors=True))


# ---- Fibo 2.0: text-to-image and edit from a structured (VGL) caption

FIBO_LICENSE = {'license': 'CC-BY-NC-4.0', 'licenses': ['CC BY-NC 4.0 (Fibo 2.0 weights, Bria AI)', 'Apache-2.0 (Qwen3-VL-4B, FLUX.2 VAE)'],
                'license_url': 'https://huggingface.co/Comfy-Org/Fibo-2.0', 'commercial': False}
FIBO_ASPECTS = {'1:1': 1.0, '16:9': 16 / 9, '9:16': 9 / 16, '4:5': 0.8, '5:4': 1.25, '3:2': 1.5, '2:3': 2 / 3, '2.39:1': 2.39, '1.85:1': 1.85}
RIG_ASPECTS = {'239': '2.39:1', '185': '1.85:1', '169': '16:9', '45': '4:5', '916': '9:16', '11': '1:1'}
VGL_KEYS = {'short_description', 'objects', 'background_setting', 'lighting', 'aesthetics', 'photographic_characteristics',
            'style_medium', 'text_render', 'context', 'artistic_style', 'edit_instruction'}
RIG_DEFAULTS = {'camera': '35mm', 'lens': 'anamorphic', 'focal': 50, 'aperture': '1.4', 'shot': 'ms', 'angle': 'eye',
                'light': 'golden', 'stock': 'negative', 'aspect': '169', 'genre': 'none', 'palette': 'natural'}  # public/js/rig.js
LIGHT_SPLIT = {  # rig light id -> (conditions, direction, shadows)
    'golden': ('golden hour sunlight', 'backlit by the low sun, warm rim light', 'long, warm shadows'),
    'blue': ('blue hour twilight, the first city lights coming on', 'soft ambient light from the sky', 'soft, faint shadows'),
    'overcast': ('soft overcast daylight', 'diffuse, even light from above', 'minimal, soft shadows'),
    'noon': ('harsh midday sun', 'top-lit by the overhead sun', 'hard, sharply defined shadows, high contrast'),
    'neon': ('neon-lit night, magenta and cyan signage', 'mixed colored light from the signs', 'deep shadows, colored reflections on wet streets'),
    'tungsten': ('warm tungsten practical lamps, interior', 'side-lit by practical lamps', 'cozy pools of light falling off into shadow'),
    'moon': ('moonlit night', 'cold blue key light from above', 'deep, dark shadows'),
    'candle': ('flickering candlelight', 'low, warm light from the candles', 'chiaroscuro, faces emerging from darkness'),
    'silhouette': ('strong backlight against a bright sky', 'backlit', 'the subject in full silhouette'),
    'haze': ('volumetric light shafts through haze', 'beams from one side cutting through the haze', 'soft, atmospheric shadows with depth'),
}
SHOT_SIZE = {'ews': 'small within frame', 'ws': 'medium', 'ms': 'medium-to-large', 'mcu': 'large within frame',
             'cu': 'large within frame', 'ecu': 'fills the frame'}
APERTURE_SPLIT = {'1.4': ('very shallow, creamy bokeh', 'sharp focus on the subject, background melted away'),
                  '2.8': ('shallow', 'sharp focus on the subject'), '5.6': ('moderate', 'sharp focus on the subject'),
                  '11': ('deep', 'everything in sharp focus')}
LENS_FOCUS = {'macro': 'razor-thin focus plane on the closest detail', 'tiltshift': 'a narrow band of focus, miniature effect'}
CAMERA_MEDIUM = {'lf-digital': ('photograph', ''), 's35-digital': ('photograph', ''), '65mm': ('film photograph', 'fine-grain 65mm film'),
                 '35mm': ('film photograph', 'organic 35mm grain'), '16mm': ('film photograph', 'grainy 16mm film'),
                 'super8': ('film photograph', 'Super 8 home movie'), 'vhs': ('analog video still', 'VHS, analog, lo-fi')}
_rig = None


def rig():
    global _rig
    if _rig is None:
        path = os.environ.get('MASSLESS_RIG') or next((p for p in (os.path.join(HERE, 'rig.json'), os.path.join(HERE, '..', '..', 'public', 'data', 'rig.json')) if os.path.exists(p)), None)
        if not path:
            raise JobError('rig.json is missing from this image.')
        with open(path, encoding='utf-8') as f:
            _rig = json.load(f)
    return _rig


def _rig_pick(group, value):
    for item in rig()[group]:
        if str(item.get('id', item.get('mm', item.get('f')))) == str(value):
            return item
    options = [str(i.get('id', i.get('mm', i.get('f')))) for i in rig()[group]]
    raise Invalid(f"shot.{group} must be one of {', '.join(options)}.")


def shot_to_caption(shot):
    """A Massless rig selection (public/js/rig.js: subject + camera, lens, focal, aperture, shot, angle, light, stock,
    genre, palette, aspect ids) as a Fibo 2.0 structured caption. The phrases are rig.json's own prompt text,
    split into the fields Fibo's caption format (Bria VGL) has for them."""
    if not isinstance(shot, dict):
        raise Invalid('shot must be an object.')
    extra = sorted(set(shot) - set(RIG_DEFAULTS) - {'subject'})
    if extra:
        raise Invalid(f"Unknown shot field{'s' if len(extra) > 1 else ''} {', '.join(extra)}.")
    sel = {**RIG_DEFAULTS, **{k: v for k, v in shot.items() if v is not None}}
    subject = _text({'subject': shot.get('subject')}, 'subject', 600, 'a lone traveler with a lantern on a desert ridge at dusk').rstrip('. ')
    p = {g: _rig_pick(g, sel[g]) for g in RIG_DEFAULTS}
    light = LIGHT_SPLIT.get(p['light']['id'], (p['light']['prompt'], '', ''))
    dof, focus = APERTURE_SPLIT.get(str(p['aperture']['f']), (p['aperture']['prompt'], ''))
    focus = LENS_FOCUS.get(p['lens']['id'], focus)
    medium, style = CAMERA_MEDIUM.get(p['camera']['id'], ('photograph', ''))
    genre = p['genre']['prompt']
    palette = ', '.join(x for x in (p['palette']['prompt'], p['stock']['prompt']) if x)
    composition = p['shot']['prompt'] + ('; over-the-shoulder framing' if p['angle']['id'] == 'ots' else '') + f", {p['aspect']['name']} frame"
    caption = {
        'short_description': ', '.join(x for x in (subject, p['shot']['prompt'], light[0], genre) if x),
        'objects': [{'description': subject, 'location': 'foreground, seen over a shoulder' if p['angle']['id'] == 'ots' else 'center',
                     'relative_size': SHOT_SIZE.get(p['shot']['id'], 'medium')}],
        'background_setting': '',
        'lighting': {'conditions': light[0], 'direction': light[1], 'shadows': light[2]},
        'aesthetics': {'composition': composition, 'color_scheme': palette, 'mood_atmosphere': genre or p['light']['prompt']},
        'photographic_characteristics': {'depth_of_field': dof, 'focus': focus, 'camera_angle': p['angle']['prompt'],
                                         'lens_focal_length': f"{p['focal']['prompt']}; {p['lens']['prompt']}"},
        'style_medium': medium,
        'artistic_style': style,
        'context': 'This is a cinematic film still' + (f" from a {p['genre']['name'].lower()} film" if p['genre']['id'] != 'none' else '') + f", {p['camera']['prompt']}.",
        'text_render': [],
    }
    return caption, RIG_ASPECTS.get(str(sel['aspect']), '16:9')


def fibo_size(ratio):
    """Fibo 2.0's trained size for an aspect ratio (as ComfyUI's TextEncodeFibo2 picks it): of the multiples of 16
    within 10% of 1 MP, the least cropping, then the closest to 1 MP."""
    import math
    area = 1024 * 1024
    sizes = [(w, h) for w in range(64, 2 * area // 64, 16)
             for h in range(max(64, 16 * math.ceil(0.9 * area / w / 16)), 16 * math.floor(1.1 * area / w / 16) + 1, 16)]
    return min(sizes, key=lambda s: (round(1 - min(s[0] / s[1] / ratio, ratio * s[1] / s[0]), 9), abs(s[0] * s[1] - area), -s[0]))


def _caption(value):
    if not isinstance(value, dict):
        raise Invalid('prompt must be text or a JSON caption object.')
    extra = sorted(set(value) - VGL_KEYS)
    if extra:
        raise Invalid(f"Unknown caption field{'s' if len(extra) > 1 else ''} {', '.join(extra)}. Fibo 2.0 captions use {', '.join(sorted(VGL_KEYS))}.")
    text = json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    if len(text) > 12000:
        raise Invalid('The caption is over 12 kB.')
    return value


STAGES_FIBO = {'unet': (3, 'Loading Fibo 2.0'), 'clip': (15, 'Loading the caption encoder'), 'vae': (25, 'Loading the VAE'),
               'image_in': (27, 'Reading the image'), 'text': (30, 'Reading the caption'), 'sampler': (45, 'Rendering'),
               'decode': (88, 'Decoding'), 'save': (95, 'Saving')}


def spec_fibo(inp):
    _fields(inp, ['mode', 'prompt', 'shot', 'image', 'aspect', 'seed', 'steps'])
    mode = _choice(inp, 'mode', ['generate', 'edit'], 'generate')
    steps = _int(inp, 'steps', 2, 8, 4)
    seed = _seed(inp)
    prompt, shot = inp.get('prompt'), inp.get('shot')
    if prompt is None and shot is None:
        raise Invalid('prompt or shot is required.')
    aspect = None
    caption = None
    if shot is not None:
        caption, aspect = shot_to_caption(shot)
        if isinstance(prompt, str) and prompt.strip():
            text = _text(inp, 'prompt', 4000)
            if mode == 'edit':
                caption['edit_instruction'] = text
            else:
                caption['short_description'] += f'. {text}'
        elif prompt is not None:
            raise Invalid('With shot, prompt must be text (extra detail, or the edit instruction).')
    elif isinstance(prompt, dict):
        caption = _caption(prompt)
    else:
        text = _text(inp, 'prompt', 4000, required=True)
    sent = json.dumps(caption, ensure_ascii=False, separators=(',', ':')) if caption is not None else text
    aspect = _choice(inp, 'aspect', list(FIBO_ASPECTS), aspect or '1:1')
    sets = {'text': {'prompt': sent}, 'sampler': {'seed': seed, 'steps': steps}}
    upload = None
    if mode == 'edit':
        if caption is not None and not caption.get('edit_instruction'):
            raise Invalid('An edit needs an instruction: prompt text, or edit_instruction in the caption.')
        im = decode_image(inp.get('image'), 'image', min_side=64)
        w, h = fibo_size(im.width / im.height)
        upload = (png_bytes(im), 'png', 'image/png')
        sets['image_in'] = {'image': '$upload'}
        sets['text'].update({'width': 0, 'height': 0})  # the trained size for the image's shape, image cropped to it
        workflow = 'fibo_edit.json'
    else:
        if inp.get('image') is not None:
            raise Invalid('image is only for mode "edit".')
        w, h = fibo_size(FIBO_ASPECTS[aspect])
        sets['text'].update({'width': w, 'height': h})
        workflow = 'fibo_generate.json'
    meta = {'type': 'image', 'mime': 'image/jpeg', 'width': w, 'height': h, 'duration': None, 'model': 'fibo-2.0-edit-turbo',
            'seed': seed, 'steps': steps, 'mode': mode, 'aspect': aspect if mode == 'generate' else None,
            'caption': caption if caption is not None else sent, **FIBO_LICENSE}

    def finish(png, filename):
        data, q = encode_still(png, 'jpeg')
        meta['quality'] = q
        return data, 'image/jpeg'

    return Spec('fibo', workflow, sets, 'save', 240, meta, upload=upload, finish=finish, stages=STAGES_FIBO)


JOBS = {'main': {'animate': spec_animate, 'motion': spec_motion, 'lipsync': spec_lipsync, 'upscale_video': spec_upscale_video,
                 'music': spec_music, 'upscale': spec_upscale},
        'lab': {'sound': spec_sound, 'fibo': spec_fibo}}


def build_spec(inp):
    if not isinstance(inp, dict):
        raise Invalid('input must be a JSON object.')
    job = inp.get('job')
    served = JOBS.get(IMAGE_KIND, {})
    if job not in served:
        other = [k for k, v in JOBS.items() if job in v and k != IMAGE_KIND]
        if other:
            raise Invalid(f'job "{job}" runs on the {other[0]} endpoint, not this one.')
        raise Invalid(f"job must be one of {', '.join(served)}.")
    return served[job](inp)


_wf_cache = {}


def load_workflow(name):
    if name not in _wf_cache:
        with open(os.path.join(WORKFLOWS, name), encoding='utf-8') as f:
            _wf_cache[name] = json.load(f)
    return copy.deepcopy(_wf_cache[name])


def apply_sets(graph, sets, names=None):
    """Set named inputs. '$upload' is the main upload's name in ComfyUI's input folder, '$upload:<key>' another one's."""
    names = names if isinstance(names, dict) else {'main': names}
    for node, values in sets.items():
        if node not in graph:
            raise JobError(f'workflow has no node "{node}"')
        for k, v in values.items():
            if k not in graph[node]['inputs']:
                raise JobError(f'workflow node "{node}" has no input "{k}"')
            if isinstance(v, str) and (v == '$upload' or v.startswith('$upload:')):
                v = names.get(v.partition(':')[2] or 'main')
                if v is None:
                    raise JobError(f'workflow node "{node}" wants an upload the job did not make')
            graph[node]['inputs'][k] = v
    return graph


# ---------------------------------------------------------------- ComfyUI process and client

class Comfy:
    def __init__(self, host=COMFY_HOST):
        self.host = host
        self.base = f'http://{host}'
        self.proc = None
        self.lock = threading.Lock()
        self.http = requests.Session()

    def command(self):
        if os.environ.get('COMFY_CMD'):
            return shlex.split(os.environ['COMFY_CMD'])
        h, _, p = self.host.rpartition(':')
        cmd = [sys.executable, 'main.py', '--listen', h, '--port', p, '--disable-auto-launch', '--disable-metadata',
               '--disable-partner-nodes', '--log-stdout']
        if IMAGE_KIND == 'main':
            cmd.append('--disable-all-custom-nodes')  # the Lab image loads its pinned custom nodes
        if VOLUME is not None:
            cmd += ['--extra-model-paths-config', MODEL_PATHS]
        return cmd + shlex.split(os.environ.get('COMFY_ARGS', ''))

    def start(self):
        """Start ComfyUI once (no-op when it is running or COMFY_START=0). Safe to call from any thread."""
        with self.lock:
            if not COMFY_START or (self.proc and self.proc.poll() is None):
                return
            self.proc = subprocess.Popen(self.command(), cwd=COMFY_DIR if os.path.isdir(COMFY_DIR) else None)

    def alive(self):
        try:
            return self.http.get(f'{self.base}/system_stats', timeout=3).ok
        except requests.RequestException:
            return False

    def ready(self, timeout=STARTUP_TIMEOUT):
        self.start()
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if self.alive():
                return
            if COMFY_START and self.proc and self.proc.poll() is not None:
                raise JobError(f'ComfyUI exited during startup (code {self.proc.returncode}).', refresh=True)
            time.sleep(0.5)
        raise JobError(f'ComfyUI did not start within {timeout:.0f} s.', refresh=True)

    def restart(self):
        with self.lock:
            if self.proc and self.proc.poll() is None:
                self.proc.kill()
                try:
                    self.proc.wait(20)
                except subprocess.TimeoutExpired:
                    pass
            self.proc = None

    def upload(self, data, name, mime='image/png'):
        r = self.http.post(f'{self.base}/upload/image', files={'image': (name, data, mime)},
                           data={'type': 'input', 'overwrite': 'true'}, timeout=60)
        if not r.ok:
            raise JobError(f'ComfyUI refused the upload ({r.status_code}).')
        j = r.json()
        return (j.get('subfolder') + '/' if j.get('subfolder') else '') + j['name']

    def submit(self, graph, prompt_id, client_id):
        r = self.http.post(f'{self.base}/prompt', json={'prompt': graph, 'prompt_id': prompt_id, 'client_id': client_id}, timeout=60)
        if r.status_code == 200:
            return
        try:
            j = r.json()
        except ValueError:
            raise JobError(f'ComfyUI rejected the workflow ({r.status_code}).') from None
        err = j.get('error') or {}
        msg = err.get('message', 'invalid workflow') if isinstance(err, dict) else str(err)
        details = []
        for node, e in (j.get('node_errors') or {}).items():
            for x in e.get('errors', []):
                details.append(f"{node} ({e.get('class_type', '?')}): {x.get('message', '')} {x.get('details', '')}".strip())
        raise JobError('ComfyUI rejected the workflow: ' + msg + (' | ' + '; '.join(details) if details else ''))

    def history(self, prompt_id):
        r = self.http.get(f'{self.base}/history/{prompt_id}', timeout=30)
        r.raise_for_status()
        return r.json().get(prompt_id)

    def view(self, f):
        r = self.http.get(f'{self.base}/view', params={'filename': f['filename'], 'subfolder': f.get('subfolder', ''),
                                                       'type': f.get('type', 'output')}, timeout=120)
        if not r.ok:
            raise JobError(f"Could not read the result {f['filename']} from ComfyUI ({r.status_code}).")
        return r.content

    def cancel(self, prompt_id):
        for path, body in (('/queue', {'delete': [prompt_id]}), ('/interrupt', {'prompt_id': prompt_id})):
            try:
                self.http.post(self.base + path, json=body, timeout=10)
            except requests.RequestException:
                pass

    def forget(self, prompt_id):
        try:
            self.http.post(f'{self.base}/history', json={'delete': [prompt_id]}, timeout=10)
        except requests.RequestException:
            pass

    def open_ws(self, client_id):
        if websocket is None:
            return None
        try:
            ws = websocket.create_connection(f'ws://{self.host}/ws?clientId={client_id}', timeout=10)
            ws.settimeout(1.0)
            return ws
        except Exception:
            return None


def history_error(entry):
    for name, data in (entry.get('status') or {}).get('messages', []):
        if name == 'execution_error':
            return exec_error_text(data)
        if name == 'execution_interrupted':
            return 'The render was interrupted.'
    return 'ComfyUI reported an error.'


def exec_error_text(d):
    node = d.get('node_type') or d.get('node_id') or 'a node'
    msg = (d.get('exception_message') or '').strip().splitlines()
    msg = msg[-1] if msg else d.get('exception_type', 'error')
    if 'out of memory' in msg.lower() or 'OutOfMemory' in str(d.get('exception_type', '')):
        return f'The GPU ran out of memory in {node}. Try 480p or a shorter duration.'
    return f'{node} failed: {msg}'[:600]


class Progress:
    def __init__(self, job, stages, report):
        self.job, self.stages, self.report = job, stages, report
        self.percent, self.text, self.sent = 0, 'Starting', 0.0

    def stage(self, node):
        if node in self.stages:
            p, self.text = self.stages[node]
            self.percent = max(self.percent, p)
            self.push(force=True)

    def step(self, node, value, total):
        if node not in self.stages or not total:
            return
        start = self.stages[node][0]
        later = [p for p, _ in self.stages.values() if p > start]
        end = min(later) if later else 99
        self.percent = max(self.percent, int(start + (end - start) * min(1.0, value / total)))
        self.text = f'{self.stages[node][1]} ({value}/{total})'
        self.push()

    def push(self, force=False):
        now = time.monotonic()
        if self.report and (force or now - self.sent >= 2.0):
            self.sent = now
            self.report({'text': self.text, 'percent': self.percent, 'job': self.job})


def wait_for(comfy, ws, prompt_id, deadline, progress):
    """Follow one prompt until it finishes. Returns its /history entry; raises JobError on failure."""
    last_poll = 0.0
    done_seen = None
    while True:
        now = time.monotonic()
        if now > deadline:
            raise Deadline
        if ws is not None:
            try:
                raw = ws.recv()
            except websocket.WebSocketTimeoutException:
                raw = None
            except Exception:
                ws = None  # dropped; keep going on /history polling
                raw = None
            if isinstance(raw, str) and raw:
                try:
                    msg = json.loads(raw)
                except ValueError:
                    msg = {}
                t, d = msg.get('type'), msg.get('data') or {}
                if d.get('prompt_id') not in (None, prompt_id):
                    continue
                if t == 'executing':
                    if d.get('node') is None and d.get('prompt_id') == prompt_id:
                        done_seen = done_seen or now
                    else:
                        progress.stage(d.get('node'))
                elif t == 'progress':
                    progress.step(d.get('node'), d.get('value', 0), d.get('max', 0))
                elif t == 'execution_success':
                    done_seen = done_seen or now
                elif t == 'execution_error':
                    raise JobError(exec_error_text(d))
                elif t == 'execution_interrupted':
                    raise JobError('The render was interrupted.')
        else:
            time.sleep(min(1.0, max(0.05, deadline - now)))
        now = time.monotonic()
        if done_seen or ws is None or now - last_poll >= 5.0:
            last_poll = now
            entry = comfy.history(prompt_id)
            if entry:
                status = entry.get('status') or {}
                if status.get('status_str') == 'error':
                    raise JobError(history_error(entry))
                if status.get('completed', True):
                    return entry
            if done_seen and now - done_seen > 15:
                raise JobError('ComfyUI finished but did not record the result.')


def output_files(entry, node):
    out = (entry.get('outputs') or {}).get(node) or {}
    files = []
    for key in ('images', 'videos', 'gifs', 'audio'):
        files += [f for f in out.get(key, []) if isinstance(f, dict) and f.get('filename')]
    return files


def _safe_unlink(base, *parts):
    base = os.path.realpath(base)
    path = os.path.realpath(os.path.join(base, *[p for p in parts if p]))
    if path.startswith(base + os.sep) and os.path.isfile(path):
        try:
            os.remove(path)
        except OSError:
            pass


def cleanup(uploads, files, max_age=600):
    """Delete this job's uploads and outputs, plus anything of ours older than max_age seconds that a
    failed job left behind (outputs a crashed run never reported, for example)."""
    for name in ([uploads] if isinstance(uploads, str) else uploads or []):
        if name:
            _safe_unlink(os.path.join(COMFY_DIR, 'input'), name)
    for f in files:
        _safe_unlink(os.path.join(COMFY_DIR, f.get('type', 'output')), f.get('subfolder', ''), f['filename'])
    cutoff = time.time() - max_age
    for d in (os.path.join(COMFY_DIR, 'output', 'massless'), os.path.join(COMFY_DIR, 'temp'), os.path.join(COMFY_DIR, 'input')):
        try:
            names = os.listdir(d)
        except OSError:
            continue
        for n in names:
            p = os.path.join(d, n)
            try:
                if (d.endswith('input') and not n.startswith('massless_')) or not os.path.isfile(p) or os.path.getmtime(p) > cutoff:
                    continue
                os.remove(p)
            except OSError:
                pass


COMFY = Comfy()
VOLUME = None if VOLUME_DIR == 'off' else volume_mod.Volume(VOLUME_DIR, _manifest())
MODEL_PATHS = os.path.join(tempfile.gettempdir(), 'massless_extra_model_paths.yaml')


def write_model_paths():
    """ComfyUI reads its model folders from the volume (passed as --extra-model-paths-config)."""
    if VOLUME is None:
        return None
    with open(MODEL_PATHS, 'w', encoding='utf-8') as f:
        f.write(volume_mod.comfy_paths_yaml(VOLUME.root))
    return MODEL_PATHS


def volume_problem():
    if VOLUME is None:
        return None
    if not os.path.isdir(os.path.dirname(VOLUME.root.rstrip('/')) or '/'):
        return f'No network volume is mounted at {os.path.dirname(VOLUME.root.rstrip("/"))}. Attach the model volume to this endpoint (workers/gpu/README.md).'
    return None


def require_models(spec):
    """Every file the job needs must be on the volume (checked against its sha256 when it arrived)."""
    if VOLUME is None or not spec.models:
        return
    problem = volume_problem()
    if problem:
        raise JobError(problem)
    missing = VOLUME.missing(spec.models)
    if not missing:
        return
    VOLUME.start_background(missing + [i for i in VOLUME.ids_for() if i not in missing])
    end = time.monotonic() + MODEL_WAIT
    while missing and time.monotonic() < end:
        time.sleep(min(2.0, max(0.05, end - time.monotonic())))
        missing = VOLUME.missing(spec.models)
    if missing:
        s = VOLUME.status(spec.models)
        raise JobError(f'The {spec.job} models are not on the GPU volume yet ({s["bytes_ready"] / 1e9:.1f} of {s["bytes"] / 1e9:.1f} GB; '
                       f'missing {", ".join(missing)}). They download once after setup: run the prepare job (workers/gpu/README.md), then try again.')


def run(spec, report=None):
    """Run a validated Spec on ComfyUI and return the job output."""
    t0 = time.monotonic()
    progress = Progress(spec.job, spec.stages, report)
    progress.push(force=True)
    require_models(spec)
    COMFY.ready()
    deadline = time.monotonic() + spec.timeout
    graph = load_workflow(spec.workflow)
    if spec.edit:
        spec.edit(graph)
    names, files, prompt_id = {}, [], str(uuid.uuid4())
    client_id = uuid.uuid4().hex
    ws = None
    try:
        for key, (data, ext, mime) in spec.uploads.items():
            names[key] = COMFY.upload(data, f'massless_{prompt_id}_{key}.{ext}', mime)
        apply_sets(graph, spec.sets, names)
        ws = COMFY.open_ws(client_id)
        COMFY.submit(graph, prompt_id, client_id)
        try:
            entry = wait_for(COMFY, ws, prompt_id, deadline, progress)
        except Deadline:
            COMFY.cancel(prompt_id)
            if not COMFY.alive():
                COMFY.restart()
            raise JobError(f'The {spec.job} job timed out after {spec.timeout:.0f} s and was stopped.') from None
        files = output_files(entry, spec.out_node)
        if not files:
            raise JobError('ComfyUI finished without producing a file.')
        raw = COMFY.view(files[0])
        data, mime = spec.finish(raw, files[0]['filename'])
        b64 = base64.b64encode(data).decode('ascii')
        total = len(b64) + sum(len(v.get('data', '')) for v in spec.meta.values() if isinstance(v, dict))
        if total > MAX_RESULT_B64:
            raise JobError(f'The result is {total / 1e6:.1f} MB as base64, over the {MAX_RESULT_B64 / 1e6:.0f} MB limit.')
        progress.percent, progress.text = 100, 'Done'
        out = dict(spec.meta)
        out.update({'mime': mime, 'data': b64, 'bytes': len(data), 'seconds': round(time.monotonic() - t0, 2)})
        return out
    except requests.RequestException as e:
        raise JobError(f'Lost contact with ComfyUI: {e.__class__.__name__}.', refresh=not COMFY.alive()) from None
    finally:
        if ws is not None:
            try:
                ws.close()
            except Exception:
                pass
        cleanup(list(names.values()), files)
        COMFY.forget(prompt_id)
        if spec.cleanup:
            spec.cleanup()
            spec.cleanup = None


def prepare(inp, report=None):
    """Operator job: download every missing model file to the volume (or with check: true, only report).
    Send it with a long executionTimeout; the site never sends it (src/gpu-jobs.js does not know it)."""
    _fields(inp, ['jobs', 'check'])
    if VOLUME is None:
        raise Invalid('This image does not use a model volume.')
    problem = volume_problem()
    if problem:
        raise JobError(problem)
    jobs = inp.get('jobs')
    if jobs is not None and (not isinstance(jobs, list) or not jobs or not set(jobs) <= set(JOBS.get(IMAGE_KIND, {}))):
        raise Invalid(f"jobs must be a list of {', '.join(JOBS.get(IMAGE_KIND, {}))}.")
    ids = VOLUME.ids_for(jobs)
    t0 = time.monotonic()
    failed = []
    if not inp.get('check'):
        done = threading.Event()

        def work():
            failed.extend(VOLUME.ensure_all(ids))
            done.set()
        threading.Thread(target=work, daemon=True).start()
        while not done.wait(5.0):
            if report:
                s = VOLUME.status(ids)
                report({'text': f"Copying models to the volume: {s['bytes_ready'] / 1e9:.1f} of {s['bytes'] / 1e9:.1f} GB",
                        'percent': int(100 * s['bytes_ready'] / max(1, s['bytes'])), 'job': 'prepare'})
    s = VOLUME.status(ids)
    free = shutil.disk_usage(VOLUME.root).free if os.path.isdir(VOLUME.root) else None
    out = {'type': 'status', 'mime': 'application/json', 'volume': VOLUME.root, 'free_bytes': free, 'seconds': round(time.monotonic() - t0, 1), **s}
    if failed:
        out['error'] = '; '.join(f'{i}: {msg}' for i, msg in failed)[:1500]
    return out


def handler(job):
    """RunPod entry point."""
    report = None
    if runpod is not None and job.get('id'):
        report = lambda p: runpod.serverless.progress_update(job, p)  # noqa: E731
    spec = None
    try:
        inp = job.get('input')
        if isinstance(inp, dict) and inp.get('job') == 'prepare':
            return prepare(inp, report)
        spec = build_spec(inp)
        return run(spec, report)
    except Invalid as e:
        return {'error': str(e)}
    except JobError as e:
        return {'error': str(e), 'refresh_worker': True} if e.refresh else {'error': str(e)}
    except Exception as e:  # never leak a traceback to the site, but keep it in the worker log
        import traceback
        traceback.print_exc()
        return {'error': f'Worker error: {e.__class__.__name__}.'}
    finally:
        if spec is not None and spec.cleanup:
            spec.cleanup()
            spec.cleanup = None


def boot():
    """Worker start: point ComfyUI at the volume, bring any missing weights in, start ComfyUI."""
    if VOLUME is not None:
        write_model_paths()
        problem = volume_problem()
        if problem:
            print(f'[massless] {problem}', flush=True)
        else:
            VOLUME.start_background()
    COMFY.start()  # boot ComfyUI while RunPod hands us the first job


if __name__ == '__main__':
    boot()
    if runpod is None:
        raise SystemExit('The runpod package is not installed.')
    runpod.serverless.start({'handler': handler})
