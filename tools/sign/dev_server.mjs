// Local server for Chucksi Sign: serves public/ like the Worker does and mounts src/sign.js on
// in-memory R2 and D1 (tools/sign/fakes.mjs). For development and the Playwright test.
//   node tools/sign/dev_server.mjs [--port 8788] [--contracts tests/fixtures/contracts] [--test]
// Prints "READY http://127.0.0.1:<port>" once listening. --test adds GET /__sign/dump (every stored
// R2 object and D1 row) so tests can check that nothing readable was stored.

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { signApi, signGated } from '../../src/sign.js';
import { fakeEnv } from './fakes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', 'public');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const PORT = Number(arg('port', 8788));
const CONTRACTS = arg('contracts', null) ? resolve(arg('contracts')) : null;
const TEST = process.argv.includes('--test');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webp': 'image/webp', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const PAGES = { '/': '/index.html', '/office': '/office/index.html', '/sign': '/sign/index.html', '/image': '/image/index.html', '/video': '/video/index.html', '/audio': '/audio/index.html', '/3d': '/3d/index.html', '/film': '/film/index.html' };

const env = await fakeEnv();
const gatedHits = [];

async function serveStatic(path, res) {
  let p = decodeURIComponent(path);
  const route = p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  if (PAGES[route]) p = PAGES[route];
  let base = ROOT;
  if (CONTRACTS && p.startsWith('/office/contracts/')) {
    const rel = p.slice('/office/contracts'.length);
    // fixture templates first; anything they lack (states.json) comes from the real library
    try { if ((await stat(normalize(join(CONTRACTS, rel)))).isFile()) { base = CONTRACTS; p = rel; } } catch { /* fall back */ }
  }
  const file = normalize(join(base, p));
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  try {
    let s = await stat(file);
    let target = file;
    if (s.isDirectory()) { target = join(file, 'index.html'); s = await stat(target); }
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': TYPES[extname(target)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' });
    res.end(await readFile(target));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);
  try {
    if (url.pathname === '/api/human') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ on: false, sitekey: null, passed: true })); return; }
    if (TEST && url.pathname === '/__sign/dump') {
      const r2 = Object.fromEntries([...env.SIGN_BUCKET.objects.entries()].map(([k, o]) => [k, Buffer.from(o.bytes).toString('base64')]));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ r2, d1: env.SIGN_DB.dump(), gated: gatedHits }));
      return;
    }
    if (url.pathname.startsWith('/api/sign/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
      headers.set('cf-connecting-ip', (req.socket.remoteAddress || '127.0.0.1').replace(/^::ffff:/, ''));
      if (req.method === 'POST' && signGated(url.pathname)) gatedHits.push(url.pathname.replace(/[A-Za-z0-9_-]{22}/, ':id'));
      const request = new Request(url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const out = await signApi(request, env, { waitUntil: () => {} });
      const h = Object.fromEntries(out.headers.entries());
      res.writeHead(out.status, h);
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    if (url.pathname.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"Not found"}'); return; }
    await serveStatic(url.pathname, res);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e && e.stack || e));
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`READY http://127.0.0.1:${server.address().port}`);
});
