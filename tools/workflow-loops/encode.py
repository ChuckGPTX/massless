"""Encode a recorded frame folder into a seamless H.264 loop + WebP poster under public/media/templates.
python3 encode.py <id> <src> [--mode pingpong|xfade|plain] [--fps 24] [--w 640 --h 360] [--crop x:y:w:h] [--trim a:b] [--xf 0.5] [--crf 30] [--poster 0.5]
src: a folder of f%04d.jpg (24 fps), a folder with list.txt (ffconcat), or a video file."""
import argparse, os, subprocess, json, sys, tempfile
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'media', 'templates')
ap = argparse.ArgumentParser()
ap.add_argument('id'); ap.add_argument('src')
ap.add_argument('--mode', default='xfade'); ap.add_argument('--fps', type=float, default=24)
ap.add_argument('--w', type=int, default=640); ap.add_argument('--h', type=int, default=360)
ap.add_argument('--crop'); ap.add_argument('--trim'); ap.add_argument('--xf', type=float, default=0.5)
ap.add_argument('--crf', type=int, default=30); ap.add_argument('--poster', type=float, default=0.4)
ap.add_argument('--maxbytes', type=int, default=390_000)
ap.add_argument('--interp', action='store_true', help='motion-interpolate slow captures up to 24 fps')
a = ap.parse_args()
os.makedirs(OUT, exist_ok=True)
if os.path.isdir(a.src) and os.path.exists(os.path.join(a.src, 'list.txt')):
    inp = ['-f', 'concat', '-safe', '0', '-i', os.path.join(a.src, 'list.txt')]
elif os.path.isdir(a.src):
    inp = ['-framerate', str(a.fps), '-i', os.path.join(a.src, 'f%04d.jpg')]
else:
    inp = ['-i', a.src]
pre = []
if a.trim:
    s, e = a.trim.split(':'); pre.append(f'trim={s}:{e},setpts=PTS-STARTPTS')
pre.append('minterpolate=fps=24:mi_mode=mci:mc_mode=aobmc' if a.interp else 'fps=24')
if a.crop: pre.append('crop=' + a.crop)
pre.append(f'scale={a.w}:{a.h}:force_original_aspect_ratio=increase:flags=lanczos,crop={a.w}:{a.h},setsar=1,format=yuv420p')
base = ','.join(pre)
tmp = tempfile.mkdtemp()
mid = os.path.join(tmp, 'mid.mp4')
subprocess.run(['ffmpeg', '-v', 'error', '-y', *inp, '-vf', base, '-an', '-c:v', 'libx264', '-crf', '14', '-preset', 'veryfast', mid], check=True)
dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mid]))
if a.mode == 'pingpong':
    fc = '[0:v]split[a][b];[b]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1,trim=end_frame=%d[v]' % (int(round(dur * 24)) * 2 - 2)
elif a.mode == 'xfade':
    F = a.xf
    fc = (f'[0:v]split[m][h];[m]trim=start={F},setpts=PTS-STARTPTS[main];[h]trim=0:{F},setpts=PTS-STARTPTS[head];'
          f'[main][head]xfade=transition=fade:duration={F}:offset={dur - 2 * F:.3f}[v]')
else:
    fc = '[0:v]null[v]'
dst = os.path.join(OUT, a.id + '.mp4')
crf = a.crf
while True:
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', mid, '-filter_complex', fc, '-map', '[v]', '-an', '-c:v', 'libx264', '-profile:v', 'high',
                    '-preset', 'slow', '-crf', str(crf), '-pix_fmt', 'yuv420p', '-g', '48', '-movflags', '+faststart', dst], check=True)
    if os.path.getsize(dst) <= a.maxbytes or crf >= 40: break
    crf += 2
d2 = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', dst]))
poster = os.path.join(OUT, a.id + '.webp')
q = 72
while True:
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{d2 * a.poster:.2f}', '-i', dst, '-frames:v', '1', '-c:v', 'libwebp', '-quality', str(q), poster], check=True)
    if os.path.getsize(poster) <= 38_000 or q <= 30: break
    q -= 8
print(json.dumps({'id': a.id, 'bytes': os.path.getsize(dst), 'dur': round(d2, 2), 'crf': crf, 'poster': os.path.getsize(poster), 'w': a.w, 'h': a.h}))
