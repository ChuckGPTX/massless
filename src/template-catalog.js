import { TEMPLATES_LIST } from '../public/js/website/templates-list.js';
import { buildTemplate } from '../public/js/website/templates.js';

// Only public, bundled examples are exposed here. Account drafts, media and publishing
// continue through their existing authenticated endpoints; this API never runs a model.
export const CATALOG_VERSION = '2026-11-02';
const BASE = '/api/v1/templates';
const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'cache-control': 'public, max-age=300',
  'x-content-type-options': 'nosniff',
};
const detail = t => ({ ...t, href: new URL(t.href, 'https://chucksi.com').href, thumb: new URL(t.thumb, 'https://chucksi.com').href, api: `${BASE}/${t.id}`, motion: t.motionLabel || 'Reveal and scroll motion' });

export function templateCatalog(request) {
  const url = new URL(request.url);
  const send = (body, status = 200, extra = {}) => new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers: { ...headers, ...extra } });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['GET', 'HEAD'].includes(request.method)) return send({ error: 'This catalog is read-only.' }, 405, { allow: 'GET, HEAD, OPTIONS', 'cache-control': 'no-store' });
  if (url.pathname.replace(/\/$/, '') === BASE) {
    const kind = url.searchParams.get('kind');
    const templates = TEMPLATES_LIST.filter(t => !kind || t.kind === kind).map(detail);
    return send({ version: CATALOG_VERSION, count: templates.length, templates });
  }
  const match = url.pathname.match(/^\/api\/v1\/templates\/([a-z0-9-]+)\/?$/);
  const template = match && TEMPLATES_LIST.find(t => t.id === match[1]);
  if (!template) return send({ error: 'Template not found.' }, 404, { 'cache-control': 'no-store' });
  const site = buildTemplate(template.id);
  // Keep example IDs deterministic and within the site's 24-character schema limit.
  // Links use slugs/anchors, not these internal editor IDs.
  let sequence = 0;
  const prefix = `ex-${TEMPLATES_LIST.indexOf(template)}`;
  function stableIds(value) {
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, 'id')) value.id = `${prefix}-${sequence++}`;
    for (const child of Object.values(value)) stableIds(child);
  }
  stableIds(site);
  return send({ version: CATALOG_VERSION, template: detail(template), site, mediaBase: 'https://chucksi.com', usage: 'An editable example. Add real content, connect forms and review before publishing. Publishing requires a Chucksi account.' });
}
