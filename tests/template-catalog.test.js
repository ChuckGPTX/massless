import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { templateCatalog } from '../src/template-catalog.js';
import { TEMPLATES_LIST } from '../public/js/website/templates-list.js';
import { sanitizeSite } from '../public/js/website/spec.js';
import { renderSingle } from '../public/js/website/render.js';
const request=(path='',method='GET')=>templateCatalog(new Request('https://chucksi.com/api/v1/templates'+path,{method}));

test('public catalog lists 32 unique usable designs and supports kind filtering', async()=>{
  const response=request(), data=await response.json();
  assert.equal(response.status,200); assert.equal(response.headers.get('access-control-allow-origin'),'*');
  assert.equal(data.count,32); assert.equal(new Set(data.templates.map(t=>t.id)).size,32);
  for(const t of data.templates){assert.ok(t.title && t.thumb && t.href && t.motion); assert.equal(t.api,'/api/v1/templates/'+t.id);}
  const filtered=await request('?kind=business').json();
  assert.ok(filtered.count>0);assert.ok(filtered.templates.every(t=>t.kind==='business'));
  assert.equal((await request('?kind=unknown').json()).count,0);
});

test('every returned site survives sanitation, renders, and has stable valid IDs', async()=>{
  for(const t of TEMPLATES_LIST){
    const data=await request('/'+t.id).json(), again=await request('/'+t.id).json();
    assert.deepEqual(data,again,t.id+' deterministic response');
    const safe=sanitizeSite(data.site,data.site,{source:'user'});
    assert.deepEqual(safe,data.site,t.id+' is schema-valid');
    const ids=[];const collect=v=>{if(!v||typeof v!=='object')return;if(v.id)ids.push(v.id);Object.values(v).forEach(collect);};collect(safe);
    assert.ok(ids.every(id=>/^[\w-]{2,24}$/.test(id)));assert.equal(ids.length,new Set(ids).size);
    assert.ok(renderSingle(safe).includes('<!doctype html>'));assert.equal(data.mediaBase,'https://chucksi.com');
  }
});

test('catalog refuses mutations, handles unknown templates and implements HEAD/OPTIONS',async()=>{
  for(const method of ['POST','PUT','DELETE']){const r=request('',method);assert.equal(r.status,405);assert.equal(r.headers.get('cache-control'),'no-store');}
  for(const path of ['/missing','/../../account','/%3Cscript%3E','/fern-gardens/extra'])assert.equal(request(path).status,404);
  assert.equal(request('','OPTIONS').status,204);assert.equal(await request('','HEAD').text(),'');
  assert.equal(request('/fern-gardens','HEAD').status,200);assert.equal(await request('/fern-gardens','HEAD').text(),'');
});

test('OpenAPI describes the implemented public routes without promising write tools',()=>{
  const spec=JSON.parse(readFileSync(new URL('../public/console/openapi.json',import.meta.url)));
  assert.equal(spec.openapi,'3.1.0');
  assert.deepEqual(Object.keys(spec.paths),['/api/v1/templates','/api/v1/templates/{id}']);
  assert.ok(Object.values(spec.paths).every(p=>Object.keys(p).join()==='get'));
});

test('Worker routes the catalog and specification before protected generation endpoints',async()=>{
  const { default: worker }=await import('../src/index.js');
  const spec=readFileSync(new URL('../public/console/openapi.json',import.meta.url),'utf8');
  const env={ASSETS:{fetch:async r=>{
    assert.equal(new URL(r.url).pathname,'/console/openapi.json');
    return new Response(r.method==='HEAD'?null:spec,{headers:{'content-type':'application/json'}});
  }}};
  const response=await worker.fetch(new Request('https://chucksi.com/api/v1/templates'),env,{});
  assert.equal((await response.json()).count,32);
  const openapi=await worker.fetch(new Request('https://chucksi.com/api/v1/openapi.json'),env,{});
  assert.equal(openapi.status,200);assert.equal(openapi.headers.get('access-control-allow-origin'),'*');
  assert.equal((await openapi.json()).openapi,'3.1.0');
});
