import test from 'node:test';
import assert from 'node:assert/strict';
import {drawMotion,planScenes,autoPictureCount,MOTION_LOOKS} from '../public/js/lyric-motion.js';
import {fallbackPrompts,sceneLines,paintScenes} from '../public/js/lyric-scenes.js';

function fakeCanvas(w=1280,h=720){
  const calls=[];let font='';
  const grad={addColorStop(){}};
  const ctx=new Proxy({set font(x){font=x;},get font(){return font;},measureText:s=>({width:s.length*(parseFloat(font.match(/([\d.]+)px/)?.[1])||12)*.55}),
    fillText:(text,x,y)=>{assert(Number.isFinite(x)&&Number.isFinite(y));calls.push(['text',text]);},drawImage:(...a)=>{assert(a.slice(1).every(Number.isFinite));calls.push(['image']);},
    translate:(x,y)=>assert(Number.isFinite(x)&&Number.isFinite(y)),scale:(x,y)=>assert(Number.isFinite(x)&&Number.isFinite(y)),rotate:a=>assert(Number.isFinite(a)),
    createLinearGradient:()=>grad,createRadialGradient:()=>grad},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>{o[k]=v;return true;}});
  return {width:w,height:h,getContext:()=>ctx,calls};
}
const cues=[{start:1,end:4,text:'Drop your song in, hit upload',words:'Drop your song in, hit upload'.split(' ').map((t,i)=>({text:t,start:1+i*.4,end:1.3+i*.4}))},{start:4,end:8,text:'Every word you sing',emphasis:true},{start:20,end:24,text:'Last line'}];

test('the requested number of pictures becomes that many scenes, cut between lines or in instrumentals',()=>{
  const s=planScenes(cues,48,6);assert.equal(s.length,6);assert.equal(s[0].start,0);assert.equal(s.at(-1).end,48);
  for(let i=1;i<s.length;i++){assert.ok(s[i].start>s[i-1].start);assert.equal(s[i].start,s[i-1].end);assert.ok(!cues.some(c=>s[i].start>c.start&&s[i].start<c.end),'never cuts inside a line');}
  assert.ok(new Set(s.map(x=>x.move)).has('spin'));
  assert.equal(planScenes([],30,6).length,1);
  assert.equal(autoPictureCount(48),6);assert.equal(autoPictureCount(10),4);assert.equal(autoPictureCount(360),10);
});
test('every look draws letters, pictures and transitions in all three shapes, with motion on or off',()=>{
  const img={width:1024,height:1024};const scenes=planScenes(cues,30,4);
  for(const look of Object.keys(MOTION_LOOKS))for(const [w,h] of [[1280,720],[720,1280],[720,720]])for(const motion of [true,false])for(const t of [.3,2.2,4.1,8.2,15,21]){
    const c=fakeCanvas(w,h);drawMotion(c,t,{cues,look,title:'Song',artist:'Me',scenes,images:[img,null,img,null],duration:30,motion,analysis:{fps:50,bands:[new Float32Array(1500).fill(.5),new Float32Array(1500).fill(.4),new Float32Array(1500).fill(.3)],beat:{bpm:120,offset:.1,period:.5}}});
    if(t>2&&t<4)assert.ok(c.calls.some(x=>x[0]==='text'&&/[A-Za-z]/.test(x[1])),`${look} draws sung letters at ${t}`);
  }
});
test('a frame is a pure function of time, so preview and export match',()=>{
  const run=()=>{const c=fakeCanvas();drawMotion(c,2.71,{cues,look:'matter',scenes:planScenes(cues,30,3),images:[],duration:30});return JSON.stringify(c.calls);};
  assert.equal(run(),run());
});
test('words are not shown before they are sung',()=>{
  const c=fakeCanvas();drawMotion(c,1.05,{cues,look:'kinetic',scenes:planScenes(cues,30,1),duration:30});
  const letters=c.calls.filter(x=>x[0]==='text').map(x=>x[1]).join('');
  assert.ok(letters.includes('D'));assert.ok(!letters.includes('U'),'UPLOAD has not been sung yet');
});
test('built-in picture prompts never ask the image model for text',()=>{
  const p=fallbackPrompts(planScenes(cues,30,3),cues,'Song');assert.equal(p.length,3);
  for(const x of p){assert.match(x,/No text/);assert.doesNotMatch(x.split('No text')[0],/lyric|letter|upload|song/i);}
  assert.deepEqual(sceneLines([{start:0,end:5},{start:5,end:30}],cues),[['Drop your song in, hit upload','Every word you sing'],['Every word you sing','Last line']]);
});
test('painting stops at the daily limit and keeps what was already painted',async()=>{
  let calls=0;const apiFetch=async()=>{calls++;return calls<=2?new Response(new Blob(['img'],{type:'image/jpeg'})):new Response(JSON.stringify({error:'limit'}),{status:429});};
  globalThis.createImageBitmap=async()=>({width:4,height:4});
  const r=await paintScenes({prompts:['a','b','c','d','e'],apiFetch,concurrency:1});
  assert.equal(r.pictures.filter(Boolean).length,2);assert.equal(r.limitHit,'limit');assert.ok(calls<=3);
  delete globalThis.createImageBitmap;
});
