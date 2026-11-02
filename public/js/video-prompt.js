// One generation form in the sidebar; completed clips belong on the stage.
import { accessToken, cloudConfig, gpuBudget, gpuJob, promoBudget, promoVideoJob, session } from './cloud.js';
const KEEP = 'chucksi.video-prompt';
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) if (v !== undefined && v !== false) k === 'text' ? e.textContent = v : e.setAttribute(k, v === true ? '' : v);
  e.append(...kids); return e;
};
const IDEAS = ['A fox trotting through fresh snow at sunrise, gentle tracking shot', 'A paper boat drifting down a rainy street at dusk, low-angle close-up', 'Cream swirling into a glass of iced coffee, warm window light, slow push in', 'A red balloon rising over city rooftops, cinematic aerial shot', 'A slow walk through a sunlit greenhouse, leaves stirring in the breeze'];
const store = {
  get: () => { try { return localStorage.getItem(KEEP) || ''; } catch { return ''; } },
  set: v => { try { v ? localStorage.setItem(KEEP,v) : localStorage.removeItem(KEEP); } catch {} },
};
async function frameData(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.');
  if (file.size > 20_000_000) throw new Error('Choose an image smaller than 20 MB.');
  const bmp = await createImageBitmap(file, { imageOrientation:'from-image' });
  const scale = Math.min(1,1536/Math.max(bmp.width,bmp.height));
  const canvas = h('canvas',{width:Math.round(bmp.width*scale),height:Math.round(bmp.height*scale)});
  const ctx = canvas.getContext('2d'); ctx.fillStyle='#111'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(bmp,0,0,canvas.width,canvas.height); bmp.close();
  const data = canvas.toDataURL('image/jpeg',.85);
  if (data.length>2_500_000) throw new Error('This image is too detailed. Try a smaller version.');
  return data;
}
async function mount(el) {
  const c = await cloudConfig();
  const engines = [];
  // Prefer the site's open video model. Only offer a hosted alternative when enabled.
  if (c.gpu?.on) engines.push({id:c.gpu.managedVideo?'managed-wan':'gpu',label:'Creative',hint:'Allow a few minutes for your video.'});
  if (c.promoVideo?.on) engines.push({id:'free',label:'Fast',hint:'Your video will appear here when it is ready.'});
  const prompt = h('textarea',{id:'vp-prompt',rows:5,maxlength:1200,placeholder:'Describe the scene, the movement, the feeling…','aria-label':'Describe your video'}); prompt.value=store.get();
  const engine = h('select',{id:'vp-engine','aria-label':'Generation mode'},...engines.map(e=>h('option',{value:e.id,text:e.label})));
  const shape = h('select',{id:'vp-shape','aria-label':'Aspect ratio'},h('option',{value:'16:9',text:'Landscape · 16:9'}),h('option',{value:'9:16',text:'Portrait · 9:16'}),h('option',{value:'1:1',text:'Square · 1:1'}));
  const resolution = h('select',{'aria-label':'Video resolution'},h('option',{value:'480p',text:'480p'}),h('option',{value:'720p',text:'720p'}));
  const go = h('button',{type:'submit',class:'btn-accent vp-go',form:'video-create-form'},'Generate video ↗');
  const stop = h('button',{type:'button',class:'btn-ghost',text:'Stop waiting',hidden:true});
  const status = h('p',{class:'vp-status',role:'status','aria-live':'polite'});
  const allowance = h('p',{class:'vp-allowance'});
  const idea = h('button',{type:'button',class:'vp-idea',text:'✦ Surprise me'});
  const file = h('input',{type:'file',accept:'image/jpeg,image/png,image/webp',id:'vp-frame',hidden:true});
  const image = h('img',{alt:'Your first frame',hidden:true});
  const uploadText = h('span',{},h('b',{text:'+ Add a first frame'}),h('small',{text:'Optional · start with your own image'}));
  const upload = h('label',{class:'vp-upload',for:'vp-frame'},image,uploadText,file);
  const remove = h('button',{type:'button',class:'vp-idea',text:'Remove image',hidden:true});
  const hint = h('p',{class:'vp-hint'});
  const form = h('form',{id:'video-create-form',class:'vp-form'},
    h('div',{class:'vp-cover'},h('img',{src:'/media/showcase/glass-tide.jpg',alt:''}),h('span',{},h('small',{text:'YOUR VISION, IN MOTION'}),h('strong',{text:'Create a scene.'}))),
    upload,remove,h('label',{class:'vp-field'},h('span',{text:'Prompt'}),prompt),idea,
    h('div',{class:'vp-options'},h('label',{class:'vp-field'},h('span',{text:'Mode'}),engine),h('label',{class:'vp-field'},h('span',{text:'Resolution'}),resolution)),
    h('label',{class:'vp-field',id:'vp-shape-field'},h('span',{text:'Frame'}),shape),h('div',{class:'vp-duration'},h('span',{text:'Duration'}),h('strong',{text:'5 seconds'})),hint);
  el.replaceChildren(form,h('div',{class:'vp-footer'},status,allowance,go,stop));
  const out=document.querySelector('#vp-output');
  let ctl,busy=false,frame=null,frameVersion=0,outputUrl;
  const setStatus=(text,error=false)=>{status.textContent=text;status.classList.toggle('is-error',error);};
  const sync=()=>{const managed=engine.value==='managed-wan';resolution.querySelector('[value=\"480p\"]').disabled=managed;shape.querySelector('[value=\"1:1\"]').disabled=managed;if(managed){resolution.value='720p';if(shape.value==='1:1')shape.value='16:9';}hint.textContent=engines.find(e=>e.id===engine.value)?.hint||'';shape.closest('label').hidden=engine.value==='free';};
  const refresh=async()=>{
    sync(); if(busy)return;
    if(!engines.length){go.disabled=true;allowance.textContent='Generation is temporarily unavailable. Try Effects to animate a still.';return;}
    if(!session()){allowance.replaceChildren(h('a',{href:'/projects/#account',text:'Sign in'}),' to generate. It’s free.');return;}
    const budget=await (engine.value==='free'?promoBudget():gpuBudget()).catch(()=>null);
    if(busy)return;
    const n=engine.value==='free'?budget?.clipsLeftForYou:budget?.jobsLeftForYou;
    allowance.textContent=Number.isFinite(n)?`${n} creations left today`:'';
    go.disabled=n===0;
    if(n===0)allowance.textContent='Today’s free creations are used up. Try Effects or return tomorrow.';
  };
  const useIdea=text=>{prompt.value=text;store.set(text);prompt.focus();};
  idea.addEventListener('click',()=>useIdea(IDEAS[Math.floor(Math.random()*IDEAS.length)]));
  document.querySelectorAll('[data-video-idea]').forEach(b=>b.addEventListener('click',()=>{document.querySelector('#t-create').click();useIdea(b.dataset.videoIdea);}));
  prompt.addEventListener('input',()=>store.set(prompt.value));
  engine.addEventListener('change',refresh);
  file.addEventListener('change',async()=>{const v=++frameVersion; if(!file.files[0])return;try{const data=await frameData(file.files[0]);if(v!==frameVersion)return;frame=data;image.src=data;image.hidden=false;uploadText.hidden=true;remove.hidden=false;setStatus('');}catch(e){if(v===frameVersion)setStatus(e.message,true);}});
  remove.addEventListener('click',()=>{frameVersion++;frame=null;file.value='';image.removeAttribute('src');image.hidden=true;uploadText.hidden=false;remove.hidden=true;});
  form.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;
    const text=prompt.value.trim();if(text.length<3){setStatus('Describe your video first.',true);prompt.focus();return;}
    store.set(text);
    if(!session()){try{sessionStorage.setItem('chucksi.after-signin','/video');}catch{}location.href='/projects/#account';return;}
    const selected=engine.value,selectedShape=selected==='free'?'16:9':shape.value,selectedResolution=resolution.value,startFrame=frame;
    busy=true;ctl=new AbortController();go.disabled=true;stop.hidden=false;
    for(const control of form.elements)control.disabled=true;
    out.hidden=false;out.replaceChildren(h('div',{class:'vp-progress'},h('span',{class:'vp-spinner','aria-hidden':true}),h('h2',{text:'Your idea is becoming a film.'}),h('p',{text:'You can explore the effects while this finishes. Keep this page open.'})));
    const progress=message=>{setStatus(message);out.querySelector('.vp-progress p').textContent=message;};
    try{
      await accessToken();progress('Starting your video…');
      const result=selected==='free'?await promoVideoJob({prompt:text,duration:5,resolution:selectedResolution,image:startFrame||undefined,signal:ctl.signal,onProgress:progress}):await gpuJob({job:'animate',engine:selected==='managed-wan'?selected:undefined,input:{prompt:text,mode:'quick',resolution:selectedResolution,aspect:selectedShape,...(startFrame?{image:startFrame.split(',')[1]}:{})},signal:ctl.signal,onProgress:p=>progress(p.message)});
      if(!result.blob?.size)throw new Error('The video was empty. Please try again.');
      if(outputUrl)URL.revokeObjectURL(outputUrl);outputUrl=URL.createObjectURL(result.blob);
      out.replaceChildren(h('div',{class:'vp-result-heading'},h('div',{},h('p',{class:'video-eyebrow',text:'READY FOR YOUR NEXT CHAPTER'}),h('h2',{text:'Your film is ready.'})),h('a',{href:outputUrl,download:'chucksi-video.mp4',class:'btn-accent',text:'Download MP4 ↓'})),h('video',{src:outputUrl,controls:true,autoplay:true,muted:true,loop:true,playsinline:true,'aria-label':'Generated video'}),h('p',{class:'vp-result-prompt',text}),h('div',{class:'vp-result-actions'},h('a',{href:'/cut/',class:'pill',text:'Caption & trim ↗'}),h('a',{href:'/library/',class:'pill',text:'My library ↗'})));
      out.querySelector('video').muted=true;
      document.querySelector('#video-welcome').hidden=true;
      setStatus('Ready. Saving to My library…');
      try{const {saveAsset}=await import('./assets.js');await saveAsset(result.blob,{name:'chucksi-video.mp4',engine:selected==='free'?c.promoVideo.model:'wan-2.2',settings:{prompt:text,resolution:selectedResolution,aspect:selectedShape}});setStatus('Ready. Saved to My library.');}catch{setStatus('Ready. Download your video before leaving; it couldn’t be saved.',true);}
      store.set('');
    }catch(err){setStatus(err.name==='AbortError'?'Stopped waiting. A video that already started may still count toward today’s creations.':err.message||'Couldn’t create the video. Please try again.',true);out.hidden=true;}
    finally{busy=false;stop.hidden=true;for(const control of form.elements)control.disabled=false;go.disabled=false;refresh();}
  });
  stop.addEventListener('click',()=>ctl?.abort());
  window.addEventListener('massless-session',refresh);
  window.addEventListener('pagehide',()=>{if(outputUrl)URL.revokeObjectURL(outputUrl);});
  await refresh();
}
for(const el of document.querySelectorAll('[data-video-prompt]'))mount(el);
