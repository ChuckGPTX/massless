from playwright.sync_api import sync_playwright
from PIL import Image
import os
D=os.path.dirname(os.path.abspath(__file__))
with sync_playwright() as p:
    b=p.chromium.launch()
    pg=b.new_page(viewport={'width':1200,'height':630}, device_scale_factor=2)
    pg.goto('file://'+D+'/og.html'); pg.wait_for_timeout(800)
    pg.screenshot(path=D+'/og@2x.png')
    for s in (16,32,48,180,192,512):
        q=b.new_page(viewport={'width':s,'height':s}, device_scale_factor=1)
        svg=open(D+'/favicon.svg').read()
        q.set_content(f"<html><body style='margin:0;background:transparent'><img src='data:image/svg+xml;utf8,{svg.replace(chr(35),'%23').replace(chr(10),' ')}' width='{s}' height='{s}' style='display:block'></body></html>")
        q.wait_for_timeout(150)
        q.screenshot(path=f'{D}/icon-{s}.png', omit_background=True)
    b.close()
im=Image.open(D+'/og@2x.png').convert('RGB').resize((1200,630), Image.LANCZOS); im.save(D+'/og.jpg', quality=90, optimize=True, progressive=True)
ims=[Image.open(f'{D}/icon-{s}.png').convert('RGBA') for s in (16,32,48)]
ims[2].save(D+'/favicon.ico', sizes=[(16,16),(32,32),(48,48)], append_images=ims[:2])
print('done', os.path.getsize(D+'/og.jpg'))
