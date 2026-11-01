import { Renderer } from '/js/renderer.js';
import { EffectEngine } from '/js/effects.js';
import { OPTICAL_EFFECTS } from '/js/effect-presets.js';
import { recordSegments } from '/js/recorder.js';
import { loadRig, finishFor } from '/js/rig.js';
const $=s=>document.querySelector(s), canvas=$('#view'), r=new Renderer(canvas), engine=new EffectEngine(r);
const rig=await loadRig();
const finish=finishFor(rig,{camera:'35mm',lens:'spherical',stock:'negative',aperture:'5.6',focal:35,light:'golden'},.45);
const neutral={vignette:0,grain:0,exposure:1};
const ctx={k:1}; let running=false,anim=0;
for(const e of OPTICAL_EFFECTS) $('#effect').add(new Option(e.name,e.id));
function image(src){return new Promise((yes,no)=>{const i=new Image;i.onload=()=>yes(i);i.onerror=()=>no(new Error('Missing '+src));i.src=src;});}
async function load(e,portrait=false){
 const img=await image('/media/art/'+e.sample+'.jpg'); r.setImage(img); r.setBackgroundColor(img);
 r.setDepth(new Uint8Array([128]),1,1);
 // A bundled depth map is optional for optical effects; a flat map still supports the complete pack.
 try {const dep=await image('/media/depth/'+e.sample+'.png');const c=document.createElement('canvas');c.width=dep.width;c.height=dep.height;const g=c.getContext('2d');g.drawImage(dep,0,0);const rgba=g.getImageData(0,0,c.width,c.height).data;r.setDepth(Uint8Array.from({length:c.width*c.height},(_,i)=>rgba[i*4]),c.width,c.height);}catch{}
 const ar=portrait?9/16:img.width/img.height; const w=ar>=1?640:Math.round(640*ar); r.setSize(w,ar>=1?640/ar:640);
}
function draw(e,t,k=1,fx=finish,look=e.looks[0].id){engine.draw(e.id,look,t,{...ctx,k},fx,t*e.duration,e.duration);}
function pixels(){const a=new Uint8Array(canvas.width*canvas.height*4);r.gl.readPixels(0,0,canvas.width,canvas.height,r.gl.RGBA,r.gl.UNSIGNED_BYTE,a);return a;}
function diff(a,b){let sum=0;for(let i=0;i<a.length;i+=4)sum+=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);return sum/(a.length*.75);}
function blob(type='image/png'){return new Promise(res=>canvas.toBlob(res,type,.9));}
async function save(name,data){const resp=await fetch('/review-output/'+name,{method:'POST',body:data});if(!resp.ok)throw new Error('Save failed '+name);}
function log(s){$('#results').textContent+=s+'\n';}
function stop(){cancelAnimationFrame(anim);}
function signature(e){draw(e,e.posterTime);$('#status').textContent=e.name+' · signature frame';}
async function lock(fn){if(running)return;running=true;stop();document.querySelectorAll('button,select').forEach(x=>x.disabled=true);try{await fn();}catch(e){$('#status').textContent='FAILED: '+e.message;log(e.stack);console.error(e);}finally{running=false;document.querySelectorAll('button,select').forEach(x=>x.disabled=false);}}
$('#checks').onclick=()=>lock(async()=>{
 $('#results').textContent='';$('#gallery').replaceChildren();const reports=[];
 for(const e of OPTICAL_EFFECTS){await load(e);draw(e,0,1,neutral);const base=pixels();draw(e,1,1,neutral);const end=diff(base,pixels());draw(e,e.posterTime,0,neutral);const zero=diff(base,pixels());draw(e,e.posterTime,1,neutral);const active=pixels(),change=diff(base,active);draw(e,e.posterTime,1,neutral);const repeat=diff(active,pixels());let lookMin=null;for(const look of e.looks.slice(1)){draw(e,e.posterTime,1,neutral,look.id);const d=diff(active,pixels());lookMin=lookMin===null?d:Math.min(lookMin,d);}
 r.setSize(640,360);draw(e,e.posterTime);const landscapeError=r.gl.getError();r.setSize(360,640);draw(e,e.posterTime);const glError=r.gl.getError();await load(e);signature(e);
 const pass=end<.02&&zero<.02&&repeat<.02&&change>.5&&glError===0&&landscapeError===0&&(lookMin===null||lookMin>.1);
 const result={id:e.id,pass,end,zero,repeat,change,lookMin,glError,landscapeError};reports.push(result);log(`${pass?'PASS':'FAIL'} ${e.name}: difference ${change.toFixed(2)}, endpoints ${end.toFixed(3)}, zero ${zero.toFixed(3)}, repeat ${repeat.toFixed(3)}, GL ${glError}`);
 const img=new Image;img.src=canvas.toDataURL('image/png');img.alt=e.name;const fig=document.createElement('figure'),cap=document.createElement('figcaption');cap.textContent=e.name;fig.append(img,cap);$('#gallery').append(fig);await save(e.id+'.png',await blob());
 }
 await save('checks.json',new Blob([JSON.stringify(reports,null,2)]));$('#status').textContent=reports.every(x=>x.pass)?'PASS: all 15 effects · endpoints, zero strength, repeatability, active frames and portrait output':'FAILED render checks';
});
$('#render').onclick=()=>lock(async()=>{
 const manifest=[];
 for(const e of OPTICAL_EFFECTS){await load(e);signature(e);await save(e.id+'.png',await blob());const start=performance.now();const clip=await recordSegments(canvas,{fps:24,segments:[{duration:e.duration,draw:t=>draw(e,t)}],onProgress:p=>{$('#status').textContent=`Rendering ${e.name} · ${Math.round(p*100)}%`;}});await save(e.id+'.'+clip.ext,clip.blob);manifest.push({id:e.id,look:e.looks[0].id,sample:e.sample,duration:e.duration,width:canvas.width,height:canvas.height,bytes:clip.blob.size,ext:clip.ext,ms:Math.round(performance.now()-start)});log('Rendered '+e.name+' · '+clip.blob.size+' bytes');}
 await save('manifest.json',new Blob([JSON.stringify(manifest,null,2)]));$('#status').textContent='COMPLETE: 15 animated previews exported';
});
$('#play').onclick=async()=>{stop();const e=OPTICAL_EFFECTS.find(x=>x.id===$('#effect').value);await load(e);const start=performance.now();const frame=now=>{draw(e,((now-start)/1000%e.duration)/e.duration);anim=requestAnimationFrame(frame);};anim=requestAnimationFrame(frame);$('#status').textContent='Playing '+e.name;};
$('#frame').onclick=()=>lock(async()=>{const e=OPTICAL_EFFECTS.find(x=>x.id===$('#effect').value);await load(e);signature(e);});
await load(OPTICAL_EFFECTS[0]);signature(OPTICAL_EFFECTS[0]);
