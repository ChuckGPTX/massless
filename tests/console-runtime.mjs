import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import assert from 'node:assert/strict';

const compiled=await build({entryPoints:['src/index.js'],bundle:true,format:'esm',platform:'browser',write:false,conditions:['workerd','worker','browser'],external:['cloudflare:workers','node:async_hooks']});
const mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:'console-test',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-10-01',durableObjects:{WEBSITE_AI_LIMITS:{className:'WebsiteAiLimits',useSQLite:true}}}]}));
const client=new Client({name:'chucksi-verification',version:'1.0.0'});
try {
  const transport=new StreamableHTTPClientTransport(new URL('https://console.chucksi.com/mcp'),{fetch:(url,opts)=>mf.dispatchFetch(String(url),opts)});
  await client.connect(transport);
  const listed=await client.listTools();
  assert.deepEqual(listed.tools.map(t=>t.name).sort(),['get_help','get_template','list_templates']);
  assert.ok(listed.tools.every(t=>t.annotations.readOnlyHint && !t.annotations.destructiveHint));
  const catalog=await client.callTool({name:'list_templates',arguments:{}});
  assert.equal(catalog.structuredContent.count,32);
  const item=await client.callTool({name:'get_template',arguments:{id:'fern-gardens'}});
  assert.ok(item.structuredContent.site.pages.length);
  assert.ok(item.structuredContent.template.href.startsWith('https://chucksi.com/'));
  assert.equal((await client.callTool({name:'get_template',arguments:{id:'not-a-template'}})).isError,true);
  const rejected=await mf.dispatchFetch('https://console.chucksi.com/mcp',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
  assert.equal(rejected.status,403);
  console.log('MCP runtime: real SDK initialize, discovery, catalog, template, missing template and origin checks passed.');
} finally {await client.close();await mf.dispose();}

const limit=await build({entryPoints:['src/website-assistant.js'],bundle:true,format:'esm',platform:'browser',write:false});
const lm=new Miniflare(convertV4MiniflareOptions({workers:[{name:'limit-test',modules:true,script:limit.outputFiles[0].text+`\nexport default {fetch(req,env){return env.LIMIT.get(env.LIMIT.idFromName('test')).fetch(req)}};`,compatibilityDate:'2026-10-01',durableObjects:{LIMIT:{className:'WebsiteAiLimits',useSQLite:true}}}]}));
try {
  const submit=visitor=>lm.dispatchFetch('https://limit.test',{method:'POST',body:JSON.stringify({visitor})});
  const duplicate=await Promise.all(Array.from({length:8},()=>submit('one')));
  assert.equal(duplicate.filter(r=>r.status===200).length,1);
  const burst=await Promise.all(Array.from({length:45},(_,i)=>submit('visitor-'+i)));
  assert.equal(burst.filter(r=>r.status===200).length,39);
  assert.equal((await submit('last')).status,429);
  console.log('SQLite assistant limit: same-visitor cooldown and shared 40-request allowance survive concurrent requests.');
} finally {await lm.dispose();}
