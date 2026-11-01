// Recording kit for the Workflows gallery loops (public/media/templates). Run from the repo root:
//   node tools/workflow-loops/serve.mjs public 8787 &        # static server with the Worker's clean URLs
//   node tools/workflow-loops/record-video.cjs tools/workflow-loops/jobs/video.json   # effects + camera moves -> rec/<id>
//   node tools/workflow-loops/record-design.cjs               # design workflow artboards / film poem -> design/<id>
//   node tools/workflow-loops/record-steps.cjs tools/workflow-loops/jobs/websites.js  # also jobs/tools.js, office.js, animated.js
//   python3 tools/workflow-loops/slides.py design/<id> slides/<id>
//   python3 tools/workflow-loops/encode.py <card id> <frames dir> [--mode xfade|pingpong|plain] ...
//   node tools/workflow-loops/provenance.mjs
// Uses Playwright's Chromium (require('playwright')) and ffmpeg; neither is a project dependency.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = process.argv[2], PORT = +process.argv[3] || 8787;
const T = {html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp4:'video/mp4',webm:'video/webm',mp3:'audio/mpeg',wav:'audio/wav',woff2:'font/woff2',wasm:'application/wasm',onnx:'application/octet-stream',bin:'application/octet-stream',glb:'model/gltf-binary',ply:'application/octet-stream',pdf:'application/pdf',txt:'text/plain',ico:'image/x-icon'};
http.createServer((req,res)=>{
  let p = decodeURIComponent(new URL(req.url,'http://x').pathname);
  if (p.startsWith('/api/')) { res.writeHead(404); return res.end('{}'); }
  let f = path.join(ROOT,p);
  try { if (fs.statSync(f).isDirectory()) f = path.join(f,'index.html'); } catch { if (fs.existsSync(f+'/index.html')) f=f+'/index.html'; }
  if (p==='/templates'||p==='/templates/') f = path.join(ROOT,'workflows/index.html');
  fs.readFile(f,(e,b)=>{ if(e){res.writeHead(404);return res.end('nf');}
    const ext=f.split('.').pop(); const h={'content-type':T[ext]||'application/octet-stream','accept-ranges':'bytes'};
    const r=req.headers.range&&req.headers.range.match(/bytes=(\d*)-(\d*)/);
    if(r){const s=+r[1]||0,en=r[2]?+r[2]:b.length-1;h['content-range']=`bytes ${s}-${en}/${b.length}`;res.writeHead(206,h);return res.end(b.subarray(s,en+1));}
    res.writeHead(200,h);res.end(b);});
}).listen(PORT,()=>console.log('on',PORT));
