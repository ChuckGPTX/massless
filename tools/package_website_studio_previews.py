"""Package real browser screenshots as template thumbnails and short scroll previews.
Capture <id>.png and <id>-full.png through the browser first, then pass that directory.
"""
from pathlib import Path
from PIL import Image, ImageOps
import argparse, subprocess, hashlib, json
parser=argparse.ArgumentParser(); parser.add_argument('screenshots',type=Path); args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
ids=['wellness-studio','music-artist','property-story']
provenance=root/'public/media/templates/provenance.json'; data=json.loads(provenance.read_text())
data['sources']['website-studio-screenshots']='Actual complete template pages captured in Chrome through CUA with reduced motion, then cropped into a six-second forward/back scroll using ffmpeg. Original generated photography and original template code. No external footage.'
for id in ids:
    screen=Image.open(args.screenshots/f'{id}.png').convert('RGB')
    ImageOps.fit(screen,(640,400),centering=(.5,0)).save(root/f'public/media/website/tpl-{id}.webp',quality=80,method=6)
    card='site-'+id
    ImageOps.fit(screen,(768,432),centering=(.5,0)).save(root/f'public/media/templates/{card}.webp',quality=72,method=6)
    dest=root/f'public/media/templates/{card}.mp4'
    subprocess.run(['ffmpeg','-y','-loglevel','error','-loop','1','-framerate','24','-i',str(args.screenshots/f'{id}-full.png'),'-vf',"scale=854:-2,crop=854:480:0:'min(ih-480,680)*(1-cos(2*PI*t/6))/2',setsar=1,format=yuv420p",'-t','6','-an','-c:v','libx264','-crf','29','-preset','slow','-movflags','+faststart',str(dest)],check=True)
    for path in [dest,root/f'public/media/templates/{card}.webp']:
        rel=str(path.relative_to(root/'public'));data['files']=[f for f in data['files'] if f['path']!=rel]
        data['files'].append(dict(path=rel,bytes=path.stat().st_size,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),card=card,source='website-studio-screenshots',recorded_from=f'/website?template={id}'))
provenance.write_text(json.dumps(data,indent=1)+'\n')
