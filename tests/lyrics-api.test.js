import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('song transcription preserves vocals and speech transcription keeps its existing settings',async()=>{
 const calls=[];const counters=new Map();
 const env={AI:{run:async(model,input)=>{calls.push({model,input});return {text:'Our original line',segments:[{start:1,end:3,text:'Our original line'}]};}},MASSLESS_KV:{get:async k=>counters.get(k)||null,put:async(k,v)=>counters.set(k,v)}};
 for(const mode of ['lyrics','speech']){
  const res=await worker.fetch(new Request('https://massless.test/api/transcribe?mode='+mode,{method:'POST',headers:{'content-type':'audio/wav','cf-connecting-ip':'1.2.3.4'},body:new Uint8Array(1024)}),env,{waitUntil(){}});
  assert.equal(res.status,200);assert.equal((await res.json()).segments[0].start,1);
 }
 assert.equal(calls[0].model,'@cf/openai/whisper-large-v3-turbo');assert.equal(calls[0].input.vad_filter,false);assert.equal(calls[0].input.condition_on_previous_text,false);
 assert.equal(calls[1].input.vad_filter,true);assert.equal(calls[1].input.condition_on_previous_text,undefined);
});

const kv=()=>{const m=new Map();return {get:async k=>m.get(k)||null,put:async(k,v)=>m.set(k,v),m};};
const post=(path,body)=>new Request('https://massless.test'+path,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'5.6.7.8'},body:JSON.stringify(body)});

test('the scene writer returns one picture prompt per scene and refuses short answers',async()=>{
 let reply={response:{prompts:['A neon rooftop at night','Waves from above']}};const env={AI:{run:async()=>reply},MASSLESS_KV:kv()};
 let res=await worker.fetch(post('/api/lyric-scenes',{title:'Test',scenes:[['line one'],['line two']]}),env,{waitUntil(){}});
 assert.equal(res.status,200);assert.deepEqual((await res.json()).prompts,['A neon rooftop at night','Waves from above']);
 reply={response:'{"prompts":["only one"]}'};
 res=await worker.fetch(post('/api/lyric-scenes',{scenes:[['a'],['b']]}),env,{waitUntil(){}});assert.equal(res.status,502);
 res=await worker.fetch(post('/api/lyric-scenes',{scenes:[]}),env,{waitUntil(){}});assert.equal(res.status,400);
});

test('lyric pictures use their own daily allowance, separate from Image studio',async()=>{
 const store=kv();const env={AI:{run:async()=>({image:btoa('x'.repeat(200))})},MASSLESS_KV:store,PER_VISITOR_LYRIC_IMG:'2',PER_VISITOR_CAP:'1'};
 for(let i=0;i<2;i++)assert.equal((await worker.fetch(post('/api/shot',{prompt:'sunset',purpose:'lyrics'}),env,{waitUntil(){}})).status,200);
 const third=await worker.fetch(post('/api/shot',{prompt:'sunset',purpose:'lyrics'}),env,{waitUntil(){}});assert.equal(third.status,429);assert.match((await third.json()).error,/lyric video pictures/);
 // Image studio's own allowance is untouched.
 assert.equal((await worker.fetch(post('/api/shot',{prompt:'sunset'}),env,{waitUntil(){}})).status,200);
});
