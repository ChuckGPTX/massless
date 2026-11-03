import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { integrationAPI } from '../src/integration-api.js';
import { consoleTarget } from '../src/console-routing.js';
import { GALLERY } from '../public/js/workflow-data.js';
const req=(path,method='GET')=>integrationAPI(new Request('https://console.chucksi.com/api/v1/'+path,{method}));

test('tools cover the site and never claim remote execution',async()=>{
  const data=await req('tools').json();
  for(const id of ['image','video','audio','3d','office','website','games'])assert.ok(data.items.some(t=>t.id===id));
  for(const item of data.items){assert.equal(item.remoteExecution,false);assert.equal(item.execution,'studio');assert.ok(item.studioUrl.startsWith('https://chucksi.com/'));}
  const help=await req('capabilities').json();assert.ok(Object.values(help.remoteActions).every(v=>v===false));
});

test('preset recipes stay aligned with actual studio links and media',async()=>{
  const data=await req('presets').json();assert.equal(data.count,53);
  assert.equal(new Set(data.items.map(p=>p.id)).size,data.count);
  for(const preset of data.items){
    const card=GALLERY.find(c=>c.id===preset.id);assert.ok(card);
    assert.equal(preset.studioUrl,new URL(card.href,'https://chucksi.com').href);
    assert.deepEqual(preset.settings,Object.fromEntries(new URL(preset.studioUrl).searchParams));
    for(const value of Object.values(preset.preview))assert.ok(existsSync(new URL('../public'+new URL(value).pathname,import.meta.url)),value);
  }
  const lidar=await req('presets?q=LiDaR').json();assert.ok(lidar.items.some(t=>t.id==='fx-lidar-cyan'));
  const moves=await req('presets?category=moves').json();assert.equal(moves.count,28);
  const vanish=await req('presets/fx-vanish-embers').json();assert.equal(vanish.item.settings.effect,'vanish');
  assert.equal(vanish.item.settings.look,'embers');
  assert.equal((await req('presets?category=unknown').json()).count,0);
});

test('workflow handoffs preserve ordered working studio URLs',async()=>{
  const flow=(await req('workflows/release-teaser').json()).item;
  assert.deepEqual(flow.steps.map(s=>new URL(s.studioUrl).pathname),['/image','/music','/music']);
  const list=await req('workflows').json();assert.equal(list.count,15);
  for(const item of list.items){assert.ok(item.steps.length);assert.equal(item.remoteExecution,false);}
});

test('public API validates requests and only supports safe read methods',async()=>{
  for(const path of ['tools/not-real','tools/a/extra','presets/%3Cscript%3E','capabilities/private'])assert.equal(req(path).status,404);
  assert.equal(req('presets?q='+'a'.repeat(101)).status,400);
  for(const method of ['POST','PUT','DELETE']){const r=req('tools',method);assert.equal(r.status,405);assert.equal(r.headers.get('cache-control'),'no-store');}
  assert.equal(req('tools','OPTIONS').status,204);assert.equal(await req('presets','HEAD').text(),'');
  assert.equal(req('tools').headers.get('access-control-allow-origin'),'*');
});

test('live routing, specification and website guide redirects match the separation',async()=>{
  const {default:worker}=await import('../src/index.js');
  for(const path of ['tools','presets','workflows','capabilities']){
    const r=await worker.fetch(new Request('https://console.chucksi.com/api/v1/'+path),{},{});assert.equal(r.status,200);
  }
  const spec=JSON.parse(readFileSync(new URL('../public/console/openapi.json',import.meta.url)));
  for(const path of ['tools','presets','workflows','capabilities'])assert.ok(spec.paths['/api/v1/'+path]);
  for(const slug of ['website-assistant','publish-and-export'])assert.equal(consoleTarget(new Request('https://console.chucksi.com/docs/'+slug+'/')).redirect,'https://chucksi.com/website/docs/'+slug+'/');
  assert.equal((await worker.fetch(new Request('https://console.chucksi.com/api/generations'),{},{})).status,404);
});
