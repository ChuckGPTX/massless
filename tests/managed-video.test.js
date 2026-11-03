import test from 'node:test';
import assert from 'node:assert/strict';
import { GenerationLedger, generationAPI } from '../src/generations.js';
import { managedVideoRequest, managedVideoCost, videoResultURL, FRAME_TTL } from '../src/managed-video.js';
const JPEG = '/9j/' + 'A'.repeat(400);
function fixture() {
  const data = new Map(); let tail = Promise.resolve();
  const store = { get: async k => structuredClone(data.get(k)),
    put: async (k,v) => { for(const [a,b] of typeof k === 'object' ? Object.entries(k) : [[k,v]]) data.set(a,structuredClone(b)); },
    delete: async keys => [].concat(keys).forEach(k=>data.delete(k)),
    transaction: fn => { const p=tail.then(()=>fn(store));tail=p.catch(()=>{});return p; } };
  const calls=[];
  const env={RUNPOD_API_KEY:'secret',GPU_ENDPOINT_ID:'custom',GPU_DAILY_BUDGET_CENTS:'70',MANAGED_VIDEO_ENABLED:'true',AI:{run:async()=>({image:JPEG})}};
  const ledger = new GenerationLedger({storage:store},env);
  ledger.provider=async(path,opts,endpoint)=>{calls.push({path,body:opts?.body?JSON.parse(opts.body):null,endpoint});return {id:'rp-test',status:'IN_QUEUE'};};
  const call=(path,body,owner='alice')=>ledger.fetch(new Request('https://chucksi.com'+path,{method:body?'POST':'GET',headers:{'x-owner-id':owner,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}));
  return {ledger,store,calls,call,env};
}
const input={job:'animate',engine:'managed-wan',input:{prompt:'A fox walking in snow',mode:'quick',resolution:'720p',aspect:'16:9',image:JPEG},idempotencyKey:'managed-video-test-00001',rights:true};
test('managed video stays within fixed model, duration and supported dimensions',()=>{
  const r=managedVideoRequest(input.input,'https://example.com/frame');
  assert.equal(r.duration,5);assert.equal(r.num_inference_steps,30);assert.equal(r.enable_safety_checker,true);
  assert.throws(()=>managedVideoRequest({...input.input,aspect:'1:1'},''));
  assert.throws(()=>managedVideoRequest({...input.input,resolution:'480p'},''));
  assert.equal(managedVideoCost({output:{cost:.3}},1),31);
  assert.equal(managedVideoCost({status:'FAILED'},1),1);
  assert.equal(managedVideoCost({status:'COMPLETED'}),null);
  for(const u of ['http://image.runpod.ai/a','https://runpod.ai.evil.test/a','https://127.0.0.1/a','https://x:secret@image.runpod.ai/a'])assert.equal(videoResultURL({result:u}),null);
});
test('managed duplicate submissions spend once and cannot bypass the shared daily budget',async()=>{
  const f=fixture();
  const jobs=await Promise.all([f.call('/api/generations',input),f.call('/api/generations',input)]);
  const j=await jobs[0].json();assert.equal((await jobs[1].json()).id,j.id);
  assert.equal(f.calls.length,1);assert.equal(j.reservedCents,35);
  assert.equal(f.calls[0].endpoint,'wan-2-2-i2v-720');
  assert.equal(f.calls[0].body.input.duration,5);
  assert.equal((await f.call('/api/generations',input,'bob')).status,202);
  assert.equal((await f.call('/api/generations',input,'eve')).status,429);
  assert.equal(f.calls.length,2);
  assert.equal(JSON.stringify(j).includes('frameToken'),false);
});
test('source image needs its expiring capability; output and status need the owning account',async()=>{
  const f=fixture(),j=await (await f.call('/api/generations',input)).json();
  const job=await f.store.get('job:'+j.id);
  const path=`/api/generations/frame/${j.id}/${job.frameToken}`;
  assert.equal((await f.call(path,null,'')).status,200);
  assert.equal((await f.call(path.replace(job.frameToken,crypto.randomUUID()),null,'')).status,404);
  assert.equal((await f.call('/api/generations/'+j.id,null,'bob')).status,404);
  assert.equal((await f.call('/api/generations/'+j.id+'/file',null,'bob')).status,404);
  job.createdAt=Date.now()-FRAME_TTL-1;await f.store.put('job:'+j.id,job);
  assert.equal((await f.call(path,null,'')).status,404);
});
test('completion settles the provider price and keeps credentials and source tokens private',async()=>{
  const f=fixture(),j=await (await f.call('/api/generations',input)).json();
  const done=await f.ledger.updateGpu('job:'+j.id,{status:'COMPLETED',output:{cost:.30,result:'https://image.runpod.ai/wan/result.mp4'}});
  assert.equal(done.costCents,30);assert.equal(done.status,'COMPLETED');
  assert.equal(await f.store.get('day:'+done.day),30);
  const visible=f.ledger.publicJob(done);
  assert.equal(visible.output.mime,'video/mp4');
  assert.equal(visible.resultURL,undefined);assert.equal(visible.frameToken,undefined);
});
test('disabled route and unauthenticated generation cannot start a billable job',async()=>{
  const f=fixture();f.env.MANAGED_VIDEO_ENABLED='false';
  assert.equal((await f.call('/api/generations',input)).status,503);assert.equal(f.calls.length,0);
  const r=await generationAPI(new Request('https://chucksi.com/api/generations',{method:'POST'}),{...f.env,GENERATION_LEDGER:{},SUPABASE_URL:'https://example.test',SUPABASE_PUBLISHABLE_KEY:'public'});
  assert.equal(r.status,401);
});
test('text prompts create one opening frame and failed frame generation never calls Runpod',async()=>{
  const f=fixture();let imageCalls=0;f.env.AI.run=async()=>{imageCalls++;return {image:JPEG};};
  const body={...input,input:{...input.input,image:undefined}};
  const j=await (await f.call('/api/generations',body)).json();
  assert.equal(imageCalls,1);assert.equal(f.calls.length,1);assert.equal((await f.store.get('job:'+j.id)).firstFrameCents,1);
  const g=fixture();g.env.AI.run=async()=>{throw new Error('Unavailable');};
  assert.equal((await g.call('/api/generations',body)).status,502);assert.equal(g.calls.length,0);
});
test('completed video proxy streams bytes, uses Worker-supported redirect mode, and sends no credentials',async()=>{
  const f=fixture(), j=await (await f.call('/api/generations',input)).json();
  await f.ledger.updateGpu('job:'+j.id,{status:'COMPLETED',output:{cost:.3,result:'https://image.runpod.ai/result.mp4'}});
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async(url,options)=>{
      assert.equal(url,'https://image.runpod.ai/result.mp4');
      assert.equal(options.redirect,'manual');assert.equal(options.headers,undefined);
      return new Response(new Uint8Array([0,0,0,24,102,116,121,112]),{headers:{'content-type':'video/mp4'}});
    };
    const response=await f.call('/api/generations/'+j.id+'/file');
    assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'video/mp4');
    assert.equal((await response.arrayBuffer()).byteLength,8);
    globalThis.fetch=async()=>new Response(null,{status:302,headers:{location:'https://untrusted.test/'}});
    assert.equal((await f.call('/api/generations/'+j.id+'/file')).status,502);
  } finally { globalThis.fetch=original; }
});
