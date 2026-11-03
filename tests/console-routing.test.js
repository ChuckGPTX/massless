import test from 'node:test';
import assert from 'node:assert/strict';
import { consoleTarget } from '../src/console-routing.js';
import worker from '../src/index.js';
test('console has its own root and docs while old links preserve their destination', async () => {
  assert.equal(consoleTarget(new Request('https://chucksi.com/console/?kind=business')).redirect,'https://console.chucksi.com/?kind=business');
  assert.equal(consoleTarget(new Request('https://chucksi.com/console/index.html')).redirect,'https://console.chucksi.com/');
  assert.equal(consoleTarget(new Request('https://chucksi.com/website/')),null);
  for (const [path,asset] of [['/','/console/index.html'],['/docs/','/console/docs/index.html'],['/docs/connect-mcp/','/console/docs/connect-mcp/index.html'],['/llms.txt','/console/llms.txt']]) {
    const r=await worker.fetch(new Request('https://console.chucksi.com'+path),{ASSETS:{fetch:async req=>new Response(new URL(req.url).pathname)}},{});
    assert.equal(await r.text(),asset);
  }
  for(const path of ['/api/sites','/api/config','/api/website-assistant','/api/human']) {
    assert.equal((await worker.fetch(new Request('https://console.chucksi.com'+path),{},{})).status,404);
  }
  assert.equal((await worker.fetch(new Request('https://console.chucksi.com/api/v1/templates'),{},{})).status,200);
});
