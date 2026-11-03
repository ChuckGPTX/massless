import { CHUCKSI_TOOLS, CHUCKSI_PRESETS, CHUCKSI_WORKFLOWS, INTEGRATION_CAPABILITIES } from '../public/js/integration-catalog.js';

const collections = { tools: CHUCKSI_TOOLS, presets: CHUCKSI_PRESETS, workflows: CHUCKSI_WORKFLOWS };
const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'cache-control': 'public, max-age=300',
  'x-content-type-options': 'nosniff',
};
export function integrationAPI(request) {
  const url = new URL(request.url);
  const send = (data, status = 200, extra = {}) => new Response(request.method === 'HEAD' ? null : JSON.stringify(data), { status, headers: { ...headers, ...(status >= 400 ? { 'cache-control': 'no-store' } : {}), ...extra } });
  const match = url.pathname.match(/^\/api\/v1\/(capabilities|tools|presets|workflows)(?:\/([a-z0-9-]{1,80}))?\/?$/);
  if (!match || (match[1] === 'capabilities' && match[2])) return send({ error: 'Resource not found.' }, 404);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['GET', 'HEAD'].includes(request.method)) return send({ error: 'Public discovery supports GET, HEAD and OPTIONS. Remote execution is not available.' }, 405, { allow: 'GET, HEAD, OPTIONS' });
  const [, type, id] = match;
  if (type === 'capabilities') return send(INTEGRATION_CAPABILITIES);
  const version = INTEGRATION_CAPABILITIES.version;
  if (id) {
    const item = collections[type].find(item => item.id === id);
    return item ? send({ version, item }) : send({ error: 'Resource not found.' }, 404);
  }
  const query = (url.searchParams.get('q') || '').trim().toLowerCase();
  const category = url.searchParams.get('category');
  if (query.length > 100 || (category && category.length > 40)) return send({ error: 'Search is limited to 100 characters; category to 40.' }, 400);
  const items = collections[type].filter(item => (!category || item.category === category) && (!query || [item.id, item.name, item.description].join(' ').toLowerCase().includes(query)));
  return send({ version, count: items.length, items });
}
