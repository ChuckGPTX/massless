"""Turn captured artboards into a seamless 4:5 carousel loop: each board holds with a slow push-in, then slides."""
import sys, glob, os, math
from PIL import Image, ImageFilter
src, dst = sys.argv[1], sys.argv[2]
W, H = 432, 540
HOLD, SLIDE = 1.0, 0.4
boards = [Image.open(f).convert('RGB') for f in sorted(glob.glob(src + '/b*.jpg'))][:4]
if len(boards) == 1:  # one poster: a slow push-in and drift across it
    boards = boards * 1
BG = (20, 20, 23)
def panel(img, z):
    k = min(W * 0.84 / img.width, H * 0.86 / img.height) * z
    im = img.resize((max(1, int(img.width * k)), max(1, int(img.height * k))), Image.LANCZOS)
    p = Image.new('RGB', (W, H), BG)
    p.paste(im, ((W - im.width) // 2, (H - im.height) // 2))
    return p
os.makedirs(dst, exist_ok=True)
fps = 24
frames = []
if len(boards) == 1:
    img = boards[0]
    n = int(5.0 * fps)
    for i in range(n):
        t = i / n
        z = 1.18 + 0.12 * (0.5 - 0.5 * math.cos(2 * math.pi * t))
        k = max(W / img.width, H / img.height) * z
        im = img.resize((int(img.width * k), int(img.height * k)), Image.LANCZOS)
        ox = (im.width - W) * (0.5 + 0.35 * math.sin(2 * math.pi * t))
        oy = (im.height - H) * (0.5 + 0.35 * math.cos(2 * math.pi * t))
        frames.append(im.crop((int(ox), int(oy), int(ox) + W, int(oy) + H)))
else:
    N = len(boards)
    seg = HOLD + SLIDE
    n = int(round(N * seg * fps))
    for i in range(n):
        t = i / fps
        j = int(t // seg) % N
        u = t - (t // seg) * seg
        z = 1.0 + 0.05 * (u / seg)
        a = panel(boards[j], z)
        if u < HOLD:
            frames.append(a)
        else:
            s = (u - HOLD) / SLIDE
            s = s * s * (3 - 2 * s)
            b = panel(boards[(j + 1) % N], 1.0)
            f = Image.new('RGB', (W, H), BG)
            dx = int(round(W * s))
            f.paste(a, (-dx, 0)); f.paste(b, (W - dx, 0))
            frames.append(f)
for i, f in enumerate(frames):
    f.save(f'{dst}/f{i:04d}.jpg', quality=92)
print(src, len(frames))
