"""Package the browser-rendered effect review outputs into small, traceable site assets."""
from pathlib import Path
import hashlib, json, subprocess
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/out/optical-effects'
PUB=ROOT/'public'
manifest=json.loads((OUT/'manifest.json').read_text())
assert len(manifest)==15
prov_path=PUB/'media/templates/provenance.json'
prov=json.loads(prov_path.read_text())
source='optical-effects-pack'
prov['sources'][source]="15 original browser effects rendered by EffectEngine and the existing recordSegments exporter through tests/optical-effects.html. Bundled sample stills and depth maps only; no external footage, generation API or provider model. Each loop returns to its original frame. Packaged with tools/package_effect_previews.py."
prov['files']=[f for f in prov['files'] if f.get('source')!=source]
for entry in manifest:
    id=entry['id']; card=f"fx-{id}-{entry['look']}"
    video=PUB/f'media/templates/{card}.mp4'; poster=PUB/f'media/templates/{card}.webp'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(OUT/f"{id}.{entry['ext']}"),'-an','-c:v','libx264','-preset','slow','-crf','30','-maxrate','420k','-bufsize','840k','-pix_fmt','yuv420p','-movflags','+faststart',str(video)],check=True)
    image=Image.open(OUT/f'{id}.png').convert('RGB')
    for quality in [73,65,55,45,35]:
        image.save(poster,'WEBP',quality=quality,method=6)
        if poster.stat().st_size<=40*1024: break
    for f in [video,poster]:
        data=f.read_bytes()
        prov['files'].append({'path':str(f.relative_to(PUB)),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'card':card,'source':source,'recorded_from':f"/video?effect={id}&look={entry['look']}&sample={entry['sample']}"})
    print(f"{card}: video {video.stat().st_size//1024} KB, poster {poster.stat().st_size//1024} KB",flush=True)
prov_path.write_text(json.dumps(prov,indent=1)+'\n')
