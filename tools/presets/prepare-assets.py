"""Turn the generated source photos for the presets into site assets, and record where each came from.

  python3 -I tools/presets/prepare-assets.py <generated dir> <birefnet-lite-512.onnx>

Source photos were made once, as example inputs and backdrops only, with a text-to-image service (no people's
likeness, no brands, no text). Gallery previews and every visitor's result are rendered by Chucksi's own engines.
Writes public/presets/plates/*.webp, public/presets/samples/*.webp and public/presets/provenance.json.
Cut-outs and photo mattes use BiRefNet lite (MIT), the same model the Image workroom offers on device.
Needs Pillow, numpy and onnxruntime.
"""
import hashlib, json, sys, os, csv
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / 'public'
GEN = Path(sys.argv[1])
MODEL = sys.argv[2]
LEDGER = GEN.parent / 'hf-ledger.tsv'

# asset -> (source file, how to process)
PLATES = {
    'marble-podium': ('p-1', 'l-0'), 'beach-rocks': ('p-1', 'l-0'), 'kitchen-counter': ('p-3', 'l-0'), 'studio-sweep': ('p-1', 'l-3'),
    'botanical-shadows': ('p-1', 'l-0'), 'water-splash': ('p-1', 'l-3'), 'sand-dune': ('p-1', 'l-3'), 'neon-shelf': ('p-1', 'l-0'),
    'linen': ('p-0', 'l-0'), 'terrazzo': ('p-1', 'l-0'), 'pastel-arches': ('p-2', 'l-0'), 'concrete-plinth': ('p-1', 'l-0'),
    'black-gloss': ('p-1', 'l-0'), 'wood-window': ('p-0', 'l-0'), 'stone-steps': ('p-2', 'l-0'), 'sky-clouds': ('p-1', 'l-0'),
    'ice-cubes': ('p-3', 'l-2'), 'tropical-leaves': ('p-1', 'l-0'), 'pop-blocks': ('p-0', 'l-0'), 'bokeh-night': ('p-0', 'l-0'),
}
MOCKUPS = {'billboard': 'mockup-billboard-3', 'box-truck': 'mockup-box-truck-3', 'phone': 'mockup-phone-hand-1', 'street-poster': 'mockup-street-poster-1', 'storefront': 'mockup-storefront-0'}
EARTH = ['earth-1-1', 'earth-2-0', 'earth-3-2', 'earth-4-1', 'earth-5-0']
PRODUCTS = {'serum': ('product-serum-0', 0), 'sneaker': ('product-sneaker-3', 90), 'headphones': ('product-headphones-3', 0), 'can': ('product-can-1', 0),
            'candle': ('product-candle-2', 0), 'mug': ('product-mug-3', 0), 'perfume': ('product-perfume-0', 0)}
PRESENTERS = {'ava': 'presenter-ava-1', 'leo': 'presenter-leo-2', 'mei': 'presenter-mei-1'}
MATTES = ['astronaut', 'dancer', 'summit', 'lighthouse', 'fisherman', 'rider', 'canyon', 'train', 'jellyfish', 'diner', 'neon']

ledger = {}
if LEDGER.exists():
    for row in csv.DictReader(open(LEDGER), delimiter='\t'):
        if row['status'] == 'submitted': ledger[row['name']] = row
prov = {'about': 'Example inputs and backdrops for the presets. Made once for Chucksi with a text-to-image service from the prompts below (about $0.006 a picture); no people\'s likeness, brands or text. Every preview loop and every visitor\'s result is rendered on device by Chucksi\'s preset engines.', 'files': []}

import onnxruntime as ort
sess = ort.InferenceSession(MODEL)

def matte(im):
    x = np.asarray(im.convert('RGB').resize((512, 512), Image.BICUBIC), dtype=np.float32) / 255
    x = (x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    y = sess.run(None, {'input_image': x.transpose(2, 0, 1)[None].astype(np.float32)})[0][0, 0]
    m = 1 / (1 + np.exp(-y))
    return Image.fromarray((m * 255).clip(0, 255).astype(np.uint8)).resize(im.size, Image.BICUBIC)

def save_webp(im, dst, max_bytes, q=82, lossless_alpha=False):
    dst.parent.mkdir(parents=True, exist_ok=True)
    while True:
        im.save(dst, 'WEBP', quality=q, method=6, alpha_quality=88 if lossless_alpha else 80)
        if dst.stat().st_size <= max_bytes: break
        if q <= 40: im = im.resize((round(im.width * 0.92), round(im.height * 0.92)), Image.LANCZOS)
        else: q -= 4
    return q

def record(dst, source, note):
    data = dst.read_bytes()
    base = source.rsplit('-', 1)[0] if source and source[-1].isdigit() else source
    src = ledger.get(base, {})
    prompt = ''
    pj = GEN / f'{base}.json'
    if pj.exists(): prompt = json.loads(pj.read_text())['prompt']
    prov['files'].append({'path': str(dst.relative_to(PUB)), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                          'source': source, 'request': src.get('request_id', ''), 'prompt': prompt, 'processing': note})
    print(dst.relative_to(PUB), len(data) // 1024, 'KB', flush=True)

def fit(im, w, h):
    k = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))

only = set(sys.argv[3:])
want = lambda k: not only or k in only
for sid, (p, l) in PLATES.items():
    if not want('plates'): break
    for o, pick, size in (('p', p, (1080, 1920)), ('l', l, (1920, 1080))):
        src = f'scene-{sid}-{pick}'
        dst = PUB / f'presets/plates/{sid}-{o}.webp'
        q = save_webp(fit(Image.open(GEN / f'{src}.png').convert('RGB'), *size), dst, 200_000)
        record(dst, src, f'resized to {size[0]}x{size[1]}, WebP q{q}')
for mid, src in MOCKUPS.items():
    if not want('mockups'): break
    im = Image.open(GEN / f'{src}.png').convert('RGB')
    size = (1920, 1080) if im.width > im.height else (1080, 1440)
    dst = PUB / f'presets/plates/mockup-{mid}.webp'
    q = save_webp(fit(im, *size), dst, 200_000)
    record(dst, src, f'resized to {size[0]}x{size[1]}, WebP q{q}')
for i, src in enumerate(EARTH):
    if not want('earth'): break
    dst = PUB / f'presets/plates/earth-{i + 1}.webp'
    q = save_webp(fit(Image.open(GEN / f'{src}.png').convert('RGB'), 1080, 1920), dst, 200_000)
    record(dst, src, f'resized to 1080x1920, WebP q{q}')
for pid, (src, rot) in PRODUCTS.items():
    if not want('products'): break
    im = Image.open(GEN / f'{src}.png').convert('RGB')
    if rot: im = im.rotate(rot, expand=True)
    m = np.asarray(matte(im), dtype=np.float32) / 255
    if pid == 'headphones':  # let the cable fade out instead of ending at the photo's edge
        ys = np.where(m.max(1) > 0.5)[0]
        h = m.shape[0]; fade = np.clip((h * 0.9 - np.arange(h)) / (h * 0.06), 0, 1)
        m = m * fade[:, None]
    m = np.where(m < 0.04, 0, m)
    a = Image.fromarray((m * 255).astype(np.uint8))
    rgba = im.copy(); rgba.putalpha(a)
    box = a.point(lambda v: 255 if v > 10 else 0).getbbox()
    rgba = rgba.crop((max(0, box[0] - 6), max(0, box[1] - 6), min(im.width, box[2] + 6), min(im.height, box[3] + 6)))
    k = 900 / max(rgba.size)
    if k < 1: rgba = rgba.resize((round(rgba.width * k), round(rgba.height * k)), Image.LANCZOS)
    dst = PUB / f'presets/samples/{pid}.webp'
    q = save_webp(rgba, dst, 140_000, q=86, lossless_alpha=True)
    record(dst, src, f'background removed with BiRefNet lite, trimmed, {rgba.width}x{rgba.height}, WebP q{q}' + (', rotated to stand on its sole' if rot else ''))
for pid, src in PRESENTERS.items():
    if not want('presenters'): break
    dst = PUB / f'presets/samples/presenter-{pid}.webp'
    q = save_webp(fit(Image.open(GEN / f'{src}.png').convert('RGB'), 1080, 1440), dst, 160_000)
    record(dst, src, f'resized to 1080x1440, WebP q{q}')
for key in MATTES:
    if not want('mattes'): break
    im = Image.open(PUB / f'media/art/{key}.jpg').convert('RGB')
    m = matte(im)
    k = 720 / max(m.size)
    m = m.resize((round(m.width * k), round(m.height * k)), Image.LANCZOS)
    dst = PUB / f'presets/samples/matte-{key}.webp'
    q = save_webp(m.convert('RGB'), dst, 30_000, q=80)
    record(dst, f'media/art/{key}.jpg', f'subject matte from BiRefNet lite, {m.width}x{m.height}, WebP q{q}')

pf = PUB / 'presets/provenance.json'
old = json.loads(pf.read_text()) if pf.exists() else {'files': []}
paths = {f['path'] for f in prov['files']}
prov['files'] = sorted([f for f in old.get('files', []) if f['path'] not in paths] + prov['files'], key=lambda f: f['path'])
pf.write_text(json.dumps(prov, indent=1) + '\n')
