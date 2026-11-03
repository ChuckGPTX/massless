import test from 'node:test';
import assert from 'node:assert/strict';
import { editableFields, validateFields, validateProposal, applyProposal, NEMOTRON_MODEL } from '../public/js/website/assistant.js';
import { buildTemplate, TEMPLATES_LIST } from '../public/js/website/templates.js';
import { websiteAssistant, WebsiteAiLimits } from '../src/website-assistant.js';

test('all 32 templates expose bounded edits that apply without changing media, URLs or section IDs', () => {
  for (const t of TEMPLATES_LIST) {
    const site = buildTemplate(t.id);
    for (const p of site.pages) {
      const fields = validateFields(editableFields(site, p.id));
      assert.ok(fields.length && fields.length <= 50, t.id);
      assert.ok(fields.every(f => !/\.(href|src|image|id)$/.test(f.path)));
      const copy = structuredClone(site);
      const edits = fields.filter(f => f.path !== 'theme.accent' && !f.choices).map(f => ({ path: f.path, value: 'New copy' }));
      applyProposal(copy, { summary: 'Update copy', changes: edits }, fields);
      assert.equal(copy.pages[0].id, site.pages[0].id);
      assert.equal(copy.name, 'New copy');
    }
  }
});

test('assistant rejects arbitrary paths, duplicate edits, HTML, oversize strings, invalid colours and layouts', () => {
  const fields = editableFields(buildTemplate('fern-gardens'));
  for (const path of ['__proto__.polluted', 'pages.0.sections.0.constructor.x', 'account.token']) {
    assert.throws(() => validateFields([{ path, value: '', label: 'bad', maxLength: 50 }]));
  }
  const bad = [
    [{path:'unknown',value:'no'}], [{path:'name',value:'<script>'}], [{path:'name',value:'a'.repeat(81)}],
    [{path:'name',value:'A'},{path:'name',value:'B'}], [{path:'theme.accent',value:'red'}],
  ];
  for (const changes of bad) assert.throws(() => validateProposal({summary:'bad',changes}, fields));
  const f = fields.find(f => f.choices);
  if (f) assert.throws(() => validateProposal({summary:'bad', changes:[{path:f.path,value:'not-a-layout'}]},fields));
  assert.equal(validateProposal({summary:'same',changes:[{path:'name',value:fields[0].value}]}, fields).changes.length,0);
});

const body = () => ({ consent:true, instruction:'Make the headline clear', fields:editableFields(buildTemplate('fern-gardens')) });
const request = (input=body(), origin='https://chucksi.com') => new Request('https://chucksi.com/api/website-assistant', {method:'POST',headers:{origin,'cf-connecting-ip':'192.0.2.5'},body:JSON.stringify(input)});
const env = (status=200) => ({OPENROUTER_API_KEY:'test-only',PASS_KEY:'test-only',WEBSITE_AI_LIMITS:{idFromName:x=>x,get:()=>({fetch:async()=>Response.json({allowed:status===200},{status})})}});

test('missing configuration, missing consent, huge payload and wrong origin never call inference', async () => {
  assert.equal((await websiteAssistant(request(),{})).status,503);
  assert.equal((await websiteAssistant(request({...body(),consent:false}),env())).status,400);
  assert.equal((await websiteAssistant(request({...body(),padding:'x'.repeat(46000)}),env())).status,400);
  assert.equal((await websiteAssistant(request(body(),'https://other.example'),env())).status,403);
  assert.equal((await websiteAssistant(request(),env(429))).status,429);
});

test('per-visitor allowance resets on the next UTC day', async t => {
  let now=Date.UTC(2026,10,2,12), record, alarm;
  t.mock.method(Date,'now',()=>now);
  const storage={get:async()=>record,put:async(_,value)=>{record=value;},setAlarm:async value=>{alarm=value;},deleteAll:async()=>{record=undefined;}};
  storage.transaction=fn=>fn(storage);
  const limiter=new WebsiteAiLimits({storage});
  const submit=()=>limiter.fetch(new Request('https://limits/reserve',{method:'POST',body:JSON.stringify({visitor:'one'})}));
  for(let i=0;i<5;i++){assert.equal((await submit()).status,200);now+=30001;}
  assert.equal((await submit()).status,429);
  now=Date.UTC(2026,10,3,0);assert.equal((await submit()).status,200);
  assert.equal(alarm,Date.UTC(2026,10,5,0));
  await limiter.alarm();assert.equal(record,undefined);
});

test('inference pins zero-priced Nemotron, validates outputs and never retries paid models', async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,opts)=>{calls.push({url,opts});return Response.json({choices:[{message:{content:JSON.stringify({summary:'Clearer name',changes:[{path:'name',value:'Cedar Studio'}]})}}]});});
  const response=await websiteAssistant(request(),env());
  assert.equal(response.status,200); assert.equal((await response.json()).changes[0].value,'Cedar Studio');
  const sent=JSON.parse(calls[0].opts.body);
  assert.equal(sent.model,NEMOTRON_MODEL); assert.deepEqual(sent.provider,{allow_fallbacks:false,max_price:{prompt:0,completion:0}});
  assert.equal(calls.length,1);
  globalThis.fetch.mock.mockImplementation(async()=>Response.json({error:'private provider details'},{status:429}));
  assert.equal((await websiteAssistant(request(),env())).status,429);
  globalThis.fetch.mock.mockImplementation(async()=>Response.json({choices:[{message:{content:'{"summary":"bad","changes":[{"path":"private.token","value":"bad"}]}'}}]}));
  const invalid=await websiteAssistant(request(),env());assert.equal(invalid.status,502);assert.ok(!(await invalid.text()).includes('private.token'));
});
