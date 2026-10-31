"""Massless GPU worker: a RunPod Serverless handler that drives ComfyUI. MIT License (see gpu/LICENSE).

One job per call. The input is {"job": "<type>", ...fields}; the output is
{type, mime, data (base64), width, height, duration, seconds, model, seed, ...}, or {"error": "..."}.

    animate  image -> 5 s MP4 with Wan 2.2 TI2V-5B (3-step FastWan distill by default)
    music    style tags (+ lyrics) -> MP3 with ACE-Step 1.5 turbo
    upscale  image -> 2x or 4x JPEG/WebP with Real-ESRGAN x4plus
  Lab image (MASSLESS_IMAGE=lab; research licenses, results marked commercial: false):
    sound    MP4 (<= 10 s) + optional text -> the clip with generated foley muxed in, plus the audio alone
             (MMAudio, or HunyuanVideo-Foley)
    fibo     structured caption, Massless rig shot or text -> image, or an image edit (Fibo 2.0 edit turbo)

ComfyUI (GPL-3.0, installed separately, not part of this file) is started once per worker and kept
warm. Each job loads an API-format graph from gpu/workflows, sets its named input nodes, submits it over
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
    MASSLESS_WORKFLOWS directory of workflow JSON files (gpu/workflows next to this file)
    MASSLESS_TIMEOUT_SCALE  multiply every job timeout (1.0)
    MASSLESS_MAX_RESULT_MB  largest base64 result in MB (15)
    MASSLESS_RIG       rig.json for fibo shots (next to this file, or public/data/rig.json in the repo)
    FFMPEG, FFPROBE    binaries for the Lab sound job (ffmpeg, ffprobe)
"""
import base64
import binascii
import copy
import io
import json
import os
import random
import shlex
import subprocess
import sys
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
COMFY_DIR = os.environ.get('COMFY_DIR', '/opt/ComfyUI')
COMFY_HOST = os.environ.get('COMFY_HOST', '127.0.0.1:8188')
COMFY_START = os.environ.get('COMFY_START', '1') == '1'
STARTUP_TIMEOUT = float(os.environ.get('COMFY_STARTUP_TIMEOUT', '180'))
IMAGE_KIND = os.environ.get('MASSLESS_IMAGE', 'main')
WORKFLOWS = os.environ.get('MASSLESS_WORKFLOWS', os.path.join(HERE, 'workflows'))
TIMEOUT_SCALE = float(os.environ.get('MASSLESS_TIMEOUT_SCALE', '1'))
MAX_RESULT_B64 = int(float(os.environ.get('MASSLESS_MAX_RESULT_MB', '15')) * 1_000_000)

MAX_INPUT_B64 = 9_500_000      # RunPod /run bodies are limited to 10 MB
MAX_INPUT_SIDE = 2048           # the site sends JPEG <= 1536 px; a little headroom
MAX_INPUT_PIXELS = 2048 * 2048
MAX_UPSCALE_SIDE = 4096
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
    return _int(inp, 'seed', 0, SEED_MAX, None)


def _sniff(raw):
    if raw[:3] == b'\xff\xd8\xff':
        return 'JPEG'
    if raw[:8] == b'\x89PNG\r\n\x1a\n':
        return 'PNG'
    if raw[:4] == b'RIFF' and raw[8:12] == b'WEBP':
        return 'WEBP'
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


def png_bytes(im):
    buf = io.BytesIO()
    im.save(buf, 'PNG', compress_level=1)
    return buf.getvalue()


def cover(im, w, h):
    """Center-crop to the w:h aspect and resize to exactly w x h."""
    return ImageOps.fit(im, (w, h), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))


# ---------------------------------------------------------------- job specs

class Spec:
    """What to run: a workflow, the inputs to set on it, an optional upload and how to package the result."""

    def __init__(self, job, workflow, sets, out_node, timeout, meta, upload=None, finish=None, stages=None, cleanup=None):
        self.job = job
        self.workflow = workflow
        self.sets = sets          # {node_id: {input: value}}; '$upload' is replaced by the uploaded name
        self.out_node = out_node
        self.timeout = timeout * TIMEOUT_SCALE
        self.meta = meta          # merged into the result
        self.upload = upload      # (bytes, extension, mime) for a Load* node, or None
        self.finish = finish or (lambda raw, fn: (raw, meta['mime']))
        self.stages = stages or {}
        self.cleanup = cleanup    # called once the job is over, success or not


ANIMATE_SIZES = {
    ('480p', '16:9'): (832, 480), ('480p', '9:16'): (480, 832), ('480p', '1:1'): (640, 640),
    ('720p', '16:9'): (1280, 704), ('720p', '9:16'): (704, 1280), ('720p', '1:1'): (960, 960),
}
ANIMATE_FPS = 24
ANIMATE_FRAMES = 121  # 5 s at 24 fps; Wan's frame count is 4n+1
ANIMATE_MODELS = {
    'wan-fast': ('animate_wan_fast.json', 'wan2.2-ti2v-5b-fastwan-3step'),
    'wan': ('animate_wan.json', 'wan2.2-ti2v-5b'),
}
DEFAULT_PROMPT = 'smooth natural motion, cinematic, steady camera'
STAGES_ANIMATE = {'unet': (2, 'Loading the video model'), 'clip': (12, 'Loading the text encoder'), 'vae': (16, 'Loading the VAE'),
                  'prompt': (18, 'Reading the prompt'), 'negative': (19, 'Reading the prompt'), 'latent': (20, 'Encoding the first frame'),
                  'sampler': (24, 'Rendering frames'), 'decode': (80, 'Decoding frames'), 'video': (94, 'Encoding the video'), 'save': (95, 'Encoding the video')}


def animate_timeout(model, resolution, steps):
    # first job on a cold worker also loads about 18 GB of weights; generous, and enforced
    if model == 'wan-fast':
        return 240 if resolution == '480p' else 420
    return (120 + 12 * steps) if resolution == '480p' else (180 + 36 * steps)


def spec_animate(inp):
    _fields(inp, ['image', 'prompt', 'negative', 'resolution', 'aspect', 'seed', 'steps', 'model'])
    model = inp.get('model', 'wan-fast')
    if model == 'ltx':
        raise Invalid('LTX-2.5 is not in this image (gated download, and it does not fit a 24 GB GPU). Use model "wan-fast" or "wan".')
    model = _choice(inp, 'model', list(ANIMATE_MODELS), 'wan-fast')
    resolution = _choice(inp, 'resolution', ['480p', '720p'], '480p')
    aspect = _choice(inp, 'aspect', ['16:9', '9:16', '1:1'], '16:9')
    prompt = _text(inp, 'prompt', 1200, DEFAULT_PROMPT)
    if model == 'wan-fast':
        if inp.get('steps') not in (None, 3):
            raise Invalid('steps: the fast model runs exactly 3 steps. Send model "wan" for 4 to 40 steps.')
        steps = 3
        if inp.get('negative'):
            raise Invalid('negative needs model "wan" (the fast model runs without CFG, so it would be ignored).')
        negative = None
    else:
        steps = _int(inp, 'steps', 4, 40, 20)
        negative = _text(inp, 'negative', 600, None)
    seed = _seed(inp)
    seed = random.SystemRandom().randint(0, SEED_MAX) if seed is None else seed
    w, h = ANIMATE_SIZES[(resolution, aspect)]
    im = cover(decode_image(inp.get('image'), 'image', min_side=128), w, h)
    workflow, model_id = ANIMATE_MODELS[model]
    sets = {
        'image_in': {'image': '$upload'},
        'prompt': {'text': prompt},
        'latent': {'width': w, 'height': h, 'length': ANIMATE_FRAMES},
        'save': {'format.codec.encoding.crf': 19.0 if resolution == '480p' else 20.0},
    }
    if model == 'wan-fast':
        sets['noise'] = {'noise_seed': seed}
    else:
        sets['sampler'] = {'seed': seed, 'steps': steps}
        if negative:
            sets['negative'] = {'text': negative}
    meta = {'type': 'video', 'mime': 'video/mp4', 'width': w, 'height': h, 'duration': round(ANIMATE_FRAMES / ANIMATE_FPS, 3),
            'fps': ANIMATE_FPS, 'frames': ANIMATE_FRAMES, 'model': model_id, 'seed': seed, 'steps': steps,
            'resolution': resolution, 'aspect': aspect}
    return Spec('animate', workflow, sets, 'save', animate_timeout(model, resolution, steps), meta, upload=(png_bytes(im), 'png', 'image/png'), stages=STAGES_ANIMATE)


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
    seed = random.SystemRandom().randint(0, SEED_MAX) if seed is None else seed
    sets = {
        'text': {'tags': tags, 'lyrics': lyrics, 'seed': seed, 'bpm': bpm, 'duration': duration,
                 'timesignature': ts, 'language': language, 'keyscale': key},
        'latent': {'seconds': duration},
        'sampler': {'seed': seed},
    }
    meta = {'type': 'audio', 'mime': 'audio/mpeg', 'width': None, 'height': None, 'duration': duration,
            'model': 'ace-step-1.5-turbo', 'seed': seed, 'bpm': bpm, 'key': key, 'instrumental': lyrics == '[Instrumental]'}
    return Spec('music', 'music_ace15.json', sets, 'save', 90 + duration, meta, stages=STAGES_MUSIC)


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
    return Spec('upscale', 'upscale_esrgan.json', sets, 'save', 150, meta, upload=(png_bytes(im), 'png', 'image/png'), finish=finish, stages=STAGES_UPSCALE)



# ---------------------------------------------------------------- Lab jobs (research licenses, MASSLESS_IMAGE=lab)
# Every Lab result carries license and commercial: false so the site can label it.

FFMPEG = os.environ.get('FFMPEG', 'ffmpeg')
FFPROBE = os.environ.get('FFPROBE', 'ffprobe')
MAX_VIDEO_B64 = 9_400_000      # about a 7 MB MP4 plus the rest of the request under RunPod's 10 MB
MAX_VIDEO_BYTES = 7_050_000
MAX_VIDEO_SECONDS = 10.0
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


def _run(cmd, timeout=120, what='ffmpeg'):
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except FileNotFoundError:
        raise JobError(f'{what} is not installed in this image.') from None
    except subprocess.TimeoutExpired:
        raise JobError(f'{what} took too long.') from None
    if r.returncode != 0:
        tail = r.stderr.decode('utf-8', 'replace').strip().splitlines()[-1:] or ['failed']
        raise Invalid(f'The video could not be read ({tail[0][:160]}).') if what == 'ffprobe' else JobError(f'{what} failed: {tail[0][:200]}')
    return r.stdout


def probe_video(path):
    info = json.loads(_run([FFPROBE, '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], 30, 'ffprobe') or b'{}')
    video = next((st for st in info.get('streams', []) if st.get('codec_type') == 'video'), None)
    if video is None:
        raise Invalid('video has no video track.')
    duration = float(video.get('duration') or (info.get('format') or {}).get('duration') or 0)
    return {'width': int(video.get('width') or 0), 'height': int(video.get('height') or 0), 'duration': duration,
            'codec': video.get('codec_name'), 'has_audio': any(st.get('codec_type') == 'audio' for st in info.get('streams', []))}


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
    seed = random.SystemRandom().randint(0, SEED_MAX) if seed is None else seed
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
    seed = random.SystemRandom().randint(0, SEED_MAX) if seed is None else seed
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


JOBS = {'main': {'animate': spec_animate, 'music': spec_music, 'upscale': spec_upscale},
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


def apply_sets(graph, sets, upload_name=None):
    for node, values in sets.items():
        if node not in graph:
            raise JobError(f'workflow has no node "{node}"')
        for k, v in values.items():
            if k not in graph[node]['inputs']:
                raise JobError(f'workflow node "{node}" has no input "{k}"')
            graph[node]['inputs'][k] = upload_name if v == '$upload' else v
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


def cleanup(upload_name, files, max_age=600):
    """Delete this job's upload and outputs, plus anything of ours older than max_age seconds that a
    failed job left behind (outputs a crashed run never reported, for example)."""
    if upload_name:
        _safe_unlink(os.path.join(COMFY_DIR, 'input'), upload_name)
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


def run(spec, report=None):
    """Run a validated Spec on ComfyUI and return the job output."""
    t0 = time.monotonic()
    progress = Progress(spec.job, spec.stages, report)
    progress.push(force=True)
    COMFY.ready()
    deadline = time.monotonic() + spec.timeout
    graph = load_workflow(spec.workflow)
    upload_name, files, prompt_id = None, [], str(uuid.uuid4())
    client_id = uuid.uuid4().hex
    ws = None
    try:
        if spec.upload is not None:
            data, ext, mime = spec.upload
            upload_name = COMFY.upload(data, f'massless_{prompt_id}.{ext}', mime)
        apply_sets(graph, spec.sets, upload_name)
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
        cleanup(upload_name, files)
        COMFY.forget(prompt_id)
        if spec.cleanup:
            spec.cleanup()
            spec.cleanup = None


def handler(job):
    """RunPod entry point."""
    report = None
    if runpod is not None and job.get('id'):
        report = lambda p: runpod.serverless.progress_update(job, p)  # noqa: E731
    spec = None
    try:
        spec = build_spec(job.get('input'))
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


if __name__ == '__main__':
    COMFY.start()  # boot ComfyUI while RunPod hands us the first job
    if runpod is None:
        raise SystemExit('The runpod package is not installed.')
    runpod.serverless.start({'handler': handler})
