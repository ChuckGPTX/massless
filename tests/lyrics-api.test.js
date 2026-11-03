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
