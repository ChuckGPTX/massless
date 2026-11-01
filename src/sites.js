// Chucksi hosting: free static sites at <slug>.v2web.site, published from the Website builder (imported by
// src/index.js). The builder exports the same files as its ZIP; this Worker checks them, stores them in R2 and
// serves them by host name with a strict Content Security Policy and a small "Made with Chucksi · Report" badge.
//
// API (on chucksi.com):
//   GET    /api/sites                 your sites (signed in)
//   GET    /api/sites/check?slug=x    is an address free (public; no account needed)
//   POST   /api/sites                 publish a new site (signed in, human check)       form: meta + f0..fN
//   PUT    /api/sites/:slug           republish (owner only, human check)               form: meta + f0..fN
//   DELETE /api/sites/:slug           unpublish (owner only)
//   POST   /api/sites/report          report a site (anyone, human check)               JSON
// Serving: <slug>.v2web.site/* from R2; v2web.site and www.v2web.site redirect to chucksi.com/website.
//
// Abuse rules (free hosts attract phishing): addresses that look like brands, sign-in or banking pages are
// refused; pages must carry the builder's generator tag; password, payment and unknown form fields, forms that
// post to other sites, scripts other than the builder's own, frames, plugins and meta refreshes are refused;
// the only JavaScript served is the builder runtime (this Worker's own copy, not the upload). Daily publish
// limits per account and per IP. Takedown: KV key `site-block:<slug>` (any value) makes the site unavailable;
// enough reports from different people set it automatically ("reports"). See docs/SITE-HOSTING.md.
//
// Bindings: SITES_BUCKET (R2, bucket chucksi-sites), SITES_DB (D1, migrations/sites; falls back to SIGN_DB),
// MASSLESS_KV (blocks), SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (sign-in). Optional vars: SITES_DOMAIN,
// SITES_PER_ACCOUNT_DAILY, SITES_PER_IP_DAILY, SITES_REPORT_PAUSE (0 turns automatic pausing off),
// SITES_PAUSED ("1" stops new publishes and updates; serving continues).

import { SITE_JS, HEAD_BOOT, GENERATOR } from '../public/js/website/runtime.js';

export const SITES_LIMITS = {
  maxSites: 5, // per account
  maxBytes: 10 * 1024 * 1024, // per site, all files
  maxFiles: 60,
  maxPath: 160,
  perAccountDaily: 30, // publishes and updates per account per day
  perIpDaily: 60, // publishes and updates per IP per day
  reportsPerIpDaily: 10,
  pauseAfterReports: 5, // distinct reporters before a site is paused for review
};
const DOMAIN = 'v2web.site';
const DAY = 86400000;

// Test hook: the Node harness swaps the clock.
let clock = () => Date.now();
export function _setClock(fn) { clock = fn || (() => Date.now()); }

const enc = new TextEncoder();
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async (data) => hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? enc.encode(data) : data));
const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); };
const today = () => new Date(clock()).toISOString().slice(0, 10);
const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const clientIp = (request) => request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
async function hashIp(ip) { return (await sha256Hex(`massless:${ip}`)).slice(0, 16); }
const db = (env) => env.SITES_DB || env.SIGN_DB;
const domainOf = (env) => String(env.SITES_DOMAIN || DOMAIN).toLowerCase();
const siteUrl = (env, slug) => `https://${slug}.${domainOf(env)}`;
const limit = (env, name, def) => { const n = Number(env[name]); return Number.isFinite(n) && n >= 0 && env[name] !== undefined && env[name] !== '' ? n : def; };

// ---------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------

/** Never handed out: mail and Microsoft 365 records, infrastructure and our own names. */
export const RESERVED = new Set(`www www1 www2 mail email webmail smtp imap pop pop3 mx ns ns1 ns2 ns3 dns ftp sftp ssh vpn
autodiscover autoconfig sip lyncdiscover msoid enterpriseenrollment enterpriseregistration selector1 selector2 dkim dmarc spf
api apis admin administrator root app apps dashboard console portal panel cpanel static cdn assets media img images files
upload uploads download downloads status health test testing staging stage dev demo preview beta sandbox local localhost
chucksi massless v2web hosting host sites site report abuse postmaster hostmaster webmaster noc security billing help
support docs about legal terms privacy contact blog news shop store pay payment payments auth oauth sso login logout signin
signup register account accounts user users my me official team staff`.split(/\s+/));

// Brands and words phishing pages hide behind. LONG ones are refused anywhere in the address (also with digits
// swapped for letters: paypa1, g00gle); WORD ones only as a whole hyphen-separated word, so "bankside-bakery" or
// "pineapple-cafe" still work while "my-bank" and "apple-id" do not.
const BRAND_LONG = `paypal google gmail microsoft outlook office365 hotmail onedrive sharepoint icloud appleid amazon facebook
instagram whatsapp messenger netflix coinbase binance metamask trustwallet blockchain kraken robinhood wellsfargo bankofamerica
chase citibank hsbc barclays santander natwest lloyds revolut monzo americanexpress mastercard docusign dropbox adobe yahoo
linkedin twitter tiktok snapchat telegram discord roblox steamcommunity epicgames playstation xbox nintendo ebay walmart costco
target bestbuy venmo cashapp zelle stripe shopify fedex usps royalmail dhlexpress irs hmrc govuk socialsecurity medicare
password passwd signin login logon verify verification authenticate recovery unlock suspended wallet seedphrase airdrop
giveaway chucksi massless v2web cloudflare supabase github`.split(/\s+/);
const BRAND_WORD = new Set(`apple meta live bank banking secure security account accounts update support helpdesk service
billing invoice refund claim prize crypto bitcoin btc eth usdt nft token ledger trezor gov police tax dhl ups visa amex citi
okta auth sso id admin official`.split(/\s+/));
const LEET = { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' };

/** Why an address can't be used, or null when it is fine. */
export function slugProblem(raw) {
  const slug = String(raw ?? '');
  if (slug.length < 3 || slug.length > 40) return 'Use 3 to 40 characters.';
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Use lowercase letters, numbers and hyphens only.';
  if (slug.startsWith('-') || slug.endsWith('-')) return 'Start and end with a letter or number.';
  if (slug.includes('--')) return 'Use single hyphens only.';
  if (/^\d+$/.test(slug)) return 'Include at least one letter.';
  if (RESERVED.has(slug)) return 'That address is reserved.';
  const flat = slug.replace(/-/g, '');
  const unleet = flat.replace(/[0-9]/g, (d) => LEET[d] || d);
  if (BRAND_LONG.some((b) => flat.includes(b) || unleet.includes(b))) return 'Addresses that look like a brand, sign-in or payment page are not allowed.';
  if (slug.split('-').some((w) => BRAND_WORD.has(w) || BRAND_WORD.has(w.replace(/[0-9]/g, (d) => LEET[d] || d)))) return 'Addresses that look like a brand, sign-in or payment page are not allowed.';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

export const TYPES = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
};
const TEXT = new Set(['html', 'css', 'js', 'json', 'xml', 'txt', 'svg']);
const PATH_RE = /^(?:[A-Za-z0-9_][A-Za-z0-9._-]*\/){0,4}[A-Za-z0-9_][A-Za-z0-9._-]*\.([A-Za-z0-9]+)$/;
const RUNTIME_PATH = 'assets/site.js';
const RUNTIME = `${SITE_JS}\n`;
const extOf = (path) => (path.match(/\.([A-Za-z0-9]+)$/) || [])[1]?.toLowerCase() || '';

const startsWith = (b, sig, at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
function sniffOk(bytes, ext) {
  if (ext === 'png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (ext === 'jpg' || ext === 'jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (ext === 'webp') return startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8);
  if (ext === 'gif') return startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'));
  if (ext === 'ico') return startsWith(bytes, [0, 0, 1, 0]);
  if (ext === 'woff2') return startsWith(bytes, ascii('wOF2'));
  return true;
}

// Embeds the builder can make (spec.js embedFor); data-embed becomes an iframe when a visitor clicks.
const EMBED_RE = /^https:\/\/(?:www\.youtube-nocookie\.com\/embed\/|player\.vimeo\.com\/video\/|open\.spotify\.com\/embed\/|w\.soundcloud\.com\/player\/|maps\.google\.com\/maps\?|www\.openstreetmap\.org\/export\/embed\.html)/;
const FRAME_HOSTS = 'https://www.youtube-nocookie.com https://player.vimeo.com https://open.spotify.com https://w.soundcloud.com https://maps.google.com https://www.google.com https://www.openstreetmap.org';

// Words that only belong in a sign-in or payment form. Checked in form fields and in the text of every form.
const SENSITIVE = /pass(?:word|wd|code|phrase)|card.?(?:number|no\b|holder)|credit.?card|debit.?card|\bcvv2?\b|\bcvc\b|\bcsc\b|security.?code|expir(?:y|ation)|\biban\b|routing.?number|account.?number|sort.?code|\bssn\b|social.?security|seed.?phrase|recovery.?phrase|secret.?phrase|private.?key|mnemonic|\bpin\b|one.?time.?(?:code|password)|\botp\b|2fa|verification.?code|mother'?s.?maiden/i;
const FIELD_NAMES = { input: new Set(['name', 'email', 'message']), textarea: new Set(['message']) };
const INPUT_TYPES = new Set(['', 'text', 'email']);
const AUTOCOMPLETE = new Set(['', 'name', 'email', 'off', 'on']);

const TAG_RE = /<([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/y;
const ATTR_RE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const decodeEntities = (s) => s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (m, d, h, n) => (d ? String.fromCodePoint(Number(d)) : h ? String.fromCodePoint(parseInt(h, 16)) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[n.toLowerCase()]));
function parseAttrs(src) {
  const out = new Map();
  for (const m of src.matchAll(ATTR_RE)) out.set(m[1].toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  return out;
}
const SCHEME_RE = /^\s*([a-z][a-z0-9+.-]*):/i;
const isExternal = (url) => { const u = String(url).trim(); const s = u.match(SCHEME_RE); return u.startsWith('//') || u.startsWith('\\') || (!!s && s[1].toLowerCase() !== 'mailto'); };
const isScriptUrl = (url) => /^\s*(?:javascript|vbscript|data\s*:\s*text\/html)/i.test(String(url).replace(/[\u0000- ]+/g, ''));
const headBootBody = HEAD_BOOT.replace(/^<script>/, '').replace(/<\/script>$/, '');

/** Why a page can't be hosted, or null. Pages come from the builder; this refuses anything a builder page never has. */
export function htmlProblem(html) {
  if (!new RegExp(`<meta name="generator" content="${GENERATOR}[^"]*">`).test(html)) return 'Only sites made with the Chucksi website builder can be published.';
  // scripts: the builder runtime (external), the one inline boot script, and JSON-LD data
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  if (scripts.length !== (html.match(/<script\b/gi) || []).length) return 'This page has a script the builder did not write.';
  for (const [whole, attrs, body] of scripts) {
    if (/^\s+src="(?:\.\.\/)*assets\/site\.js"\s+defer\s*$/.test(attrs) && !body.trim()) continue;
    if (whole === HEAD_BOOT) continue;
    if (/^\s+type="application\/ld\+json"\s*$/.test(attrs)) { try { JSON.parse(body); continue; } catch { /* not data */ } }
    return 'This page has a script the builder did not write.';
  }
  const forms = [];
  let open = null;
  for (let i = html.indexOf('<'); i >= 0; i = html.indexOf('<', i + 1)) {
    const next = html[i + 1] || '';
    if (next === '/') {
      if (/^<\/form\s*>/i.test(html.slice(i, i + 8)) && open !== null) { forms.push(html.slice(open, i)); open = null; }
      continue;
    }
    if (!/[A-Za-z]/.test(next)) continue; // <!doctype>, <!-- -->, a lone "<" in text
    TAG_RE.lastIndex = i;
    const m = TAG_RE.exec(html);
    if (!m) return 'This page has HTML the builder did not write.';
    const tag = m[1].toLowerCase();
    const a = parseAttrs(m[2]);
    if (['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'portal', 'select'].includes(tag)) return `Hosted pages can't use <${tag}>.`;
    if (tag === 'meta' && a.has('http-equiv')) return 'Hosted pages cannot redirect or refresh themselves.';
    for (const [k, v] of a) {
      if (k.startsWith('on')) return 'This page has a script the builder did not write.';
      if (k === 'srcdoc') return 'This page has HTML the builder did not write.';
      if (['href', 'src', 'action', 'formaction', 'xlink:href', 'data', 'poster'].includes(k) && isScriptUrl(v)) return 'This page has a script link the builder did not write.';
      if (k === 'formaction' && isExternal(v)) return 'Forms on hosted sites cannot send to other websites. Use email instead (Settings, Contact).';
      if (k === 'data-embed' && !EMBED_RE.test(v)) return 'This page embeds something the builder does not support.';
    }
    if (tag === 'form') {
      if (a.has('action') && isExternal(a.get('action'))) return 'Forms on hosted sites cannot send to other websites. Use email instead (Settings, Contact).';
      if (open === null) open = i;
    }
    if (tag === 'input' || tag === 'textarea') {
      const type = (a.get('type') || '').toLowerCase();
      const words = [a.get('name'), a.get('id'), a.get('placeholder'), a.get('autocomplete'), a.get('aria-label'), a.get('title')].filter(Boolean).join(' ');
      if (type === 'password' || /password/i.test(a.get('autocomplete') || '')) return 'Password fields are not allowed on hosted sites.';
      if (/^cc-|one-time-code/i.test(a.get('autocomplete') || '') || SENSITIVE.test(words)) return 'Payment, password and account-number fields are not allowed on hosted sites.';
      if (tag === 'input' && !INPUT_TYPES.has(type)) return 'Hosted sites can only use the builder\'s contact and sign-up forms.';
      if (!FIELD_NAMES[tag].has(a.get('name') || '') || !AUTOCOMPLETE.has((a.get('autocomplete') || '').toLowerCase())) return 'Hosted sites can only use the builder\'s contact and sign-up forms.';
    }
    if (tag === 'script' || tag === 'style') {
      // skip to the end of the element so CSS or JSON with "<" is not read as tags
      const end = html.toLowerCase().indexOf(`</${tag}`, TAG_RE.lastIndex);
      if (end < 0) return 'This page has HTML the builder did not write.';
      i = end;
      continue;
    }
    i = TAG_RE.lastIndex - 1;
  }
  if (open !== null) forms.push(html.slice(open));
  for (const f of forms) {
    const text = decodeEntities(f.replace(/<[^>]*>/g, ' '));
    if (SENSITIVE.test(text)) return 'Forms that ask for passwords, payment cards or account numbers are not allowed on hosted sites.';
  }
  return null;
}

/** Why an SVG can't be hosted, or null. No scripts, no foreign content, no links out. */
export function svgProblem(svg) {
  if (!/<svg[\s>]/i.test(svg)) return 'This is not an SVG image.';
  if (/<script|<foreignObject|<iframe|<embed|<object|<!ENTITY|<!DOCTYPE|<\?xml-stylesheet|javascript:|\bon[a-z]+\s*=|<(?:a|use|image|feImage)\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:|\/\/|data:)|@import/i.test(svg)) return 'SVG images with scripts or outside links are not allowed.';
  return null;
}

function cssProblem(css) {
  if (/javascript:|expression\s*\(|-moz-binding|(?<![\w-])behavior\s*:/i.test(css)) return 'This stylesheet has code in it.';
  return null;
}

/**
 * Check a set of uploaded files. files: [{ path, bytes: Uint8Array }].
 * Returns { files: [{ path, bytes, type, size, etag }], size } or { error, status }.
 */
export async function checkFiles(files) {
  const fail = (error, status = 400) => ({ error, status });
  if (!Array.isArray(files) || !files.length) return fail('The site has no files.');
  if (files.length > SITES_LIMITS.maxFiles) return fail(`A site can have up to ${SITES_LIMITS.maxFiles} files.`, 413);
  const seen = new Set();
  const out = [];
  let size = 0;
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  for (const f of files) {
    const path = String(f.path || '');
    if (path.length > SITES_LIMITS.maxPath || !PATH_RE.test(path) || path.includes('..')) return fail(`"${path.slice(0, 80)}" is not a file name hosting accepts.`);
    const ext = extOf(path);
    if (!TYPES[ext]) return fail(`${path}: .${ext} files can't be hosted. Images, pages, styles and the builder's own script can.`);
    const key = path.toLowerCase();
    if (seen.has(key)) return fail(`${path} is in the upload twice.`);
    seen.add(key);
    let bytes = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes || []);
    if (ext === 'js') {
      if (path !== RUNTIME_PATH) return fail(`${path}: hosted sites run only the builder's own script.`);
      bytes = enc.encode(RUNTIME); // always our copy, never the upload
    }
    if (TEXT.has(ext) && ext !== 'js') {
      let text;
      try { text = utf8.decode(bytes); } catch { return fail(`${path} is not valid UTF-8 text.`); }
      const problem = ext === 'html' ? htmlProblem(text) : ext === 'svg' ? svgProblem(text) : ext === 'css' ? cssProblem(text) : null;
      if (problem) return fail(`${path}: ${problem}`, 422);
      if (ext === 'json') { try { JSON.parse(text); } catch { return fail(`${path} is not valid JSON.`); } }
    } else if (!sniffOk(bytes, ext)) return fail(`${path} is not really a .${ext} file.`);
    size += bytes.length;
    if (size > SITES_LIMITS.maxBytes) return fail('Sites can be up to 10 MB. Use fewer or smaller images.', 413);
    out.push({ path, bytes, type: TYPES[ext], size: bytes.length, etag: (await sha256Hex(bytes)).slice(0, 32) });
  }
  if (!seen.has('index.html')) return fail('The site needs an index.html home page.');
  return { files: out, size };
}

// ---------------------------------------------------------------------------------------------
// Sign-in (Supabase), the same check as src/generations.js
// ---------------------------------------------------------------------------------------------

async function currentUser(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return { stop: json({ error: 'Sign-in is being connected. Try again later.' }, 503) };
  const bearer = request.headers.get('authorization') || '';
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(bearer)) return { stop: json({ error: 'Sign in to publish your site.', signIn: true }, 401) };
  let res;
  try {
    res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: bearer }, signal: AbortSignal.timeout(10000) });
  } catch {
    return { stop: json({ error: 'Sign-in could not be checked. Please try again.' }, 503) };
  }
  if (!res.ok) return { stop: json({ error: 'Please sign in again.', signIn: true }, 401) };
  const user = await res.json().catch(() => ({}));
  if (!user || typeof user.id !== 'string' || !user.id) return { stop: json({ error: 'Please sign in again.', signIn: true }, 401) };
  if (!(user.email_confirmed_at || user.confirmed_at || user.phone_confirmed_at)) return { stop: json({ error: 'Confirm your email address first, then publish.' }, 403) };
  return { user: { id: user.id } };
}

// ---------------------------------------------------------------------------------------------
// Storage: R2 sites/<slug>/manifest.json and sites/<slug>/v<version>/<path>; D1 table `sites` (migrations/sites)
// ---------------------------------------------------------------------------------------------

const manifestKey = (slug) => `sites/${slug}/manifest.json`;
const fileKey = (slug, version, path) => `sites/${slug}/v${version}/${path}`;

async function deletePrefix(bucket, prefix) {
  let cursor;
  do {
    const listed = await bucket.list({ prefix, cursor });
    const keys = (listed.objects || []).map((o) => o.key);
    if (keys.length) await bucket.delete(keys);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

async function writeVersion(env, slug, version, files) {
  for (const f of files) await env.SITES_BUCKET.put(fileKey(slug, version, f.path), f.bytes, { httpMetadata: { contentType: f.type } });
}

function manifestOf(row, files, size) {
  return {
    v: 1, slug: row.slug, owner: row.owner, version: row.version, size, generator: GENERATOR,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    files: Object.fromEntries(files.map((f) => [f.path, { size: f.size, type: f.type, etag: f.etag }])),
  };
}

// In-isolate memos keep each page view to one R2 read: manifests for 15 s, blocks for 30 s.
const memo = { manifest: new Map(), block: new Map() };
export function _resetSiteCaches() { memo.manifest.clear(); memo.block.clear(); }
async function cached(map, key, ttl, load) {
  const hit = map.get(key);
  if (hit && hit.until > clock()) return hit.value;
  const value = await load();
  if (map.size > 2000) map.clear();
  map.set(key, { value, until: clock() + ttl });
  return value;
}
async function readManifest(env, slug) {
  return cached(memo.manifest, slug, 15000, async () => {
    const o = await env.SITES_BUCKET.get(manifestKey(slug));
    if (!o) return null;
    try { return JSON.parse(await o.text()); } catch { return null; }
  });
}
/** The takedown flag: KV `site-block:<slug>`. Any value blocks; "reports" means paused by visitor reports. */
async function blockOf(env, slug) {
  if (!env.MASSLESS_KV) return null;
  return cached(memo.block, slug, 30000, async () => {
    try { return await env.MASSLESS_KV.get(`site-block:${slug}`, { cacheTtl: 60 }); } catch { return null; }
  });
}

// Daily counters in D1 (atomic; KV's free tier allows only 1,000 writes a day).
async function quotaCount(env, who) {
  return (await db(env).prepare('SELECT n FROM site_quota WHERE day = ? AND who = ?').bind(today(), who).first('n')) || 0;
}
async function quotaUse(env, ...whos) {
  const up = 'INSERT INTO site_quota (day, who, n) VALUES (?, ?, 1) ON CONFLICT(day, who) DO UPDATE SET n = n + 1';
  await db(env).batch(whos.map((w) => db(env).prepare(up).bind(today(), w)));
}
async function sweepQuota(env) {
  await db(env).prepare('DELETE FROM site_quota WHERE day < ?').bind(new Date(clock() - 2 * DAY).toISOString().slice(0, 10)).run();
}

// ---------------------------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------------------------

/** Read the multipart upload: meta (JSON: { slug, title?, paths: [...] }) and one part per path, f0..fN. */
async function readUpload(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > SITES_LIMITS.maxBytes + 1024 * 1024) return { stop: json({ error: 'Sites can be up to 10 MB. Use fewer or smaller images.' }, 413) };
  let form;
  try { form = await request.formData(); } catch { return { stop: json({ error: 'Send the site as form data: meta plus one part per file.' }, 400) }; }
  let meta;
  try { meta = JSON.parse(String(form.get('meta') || '')); } catch { return { stop: json({ error: 'The site details are not valid JSON.' }, 400) }; }
  if (!meta || typeof meta !== 'object') return { stop: json({ error: 'The site details are missing.' }, 400) };
  const paths = Array.isArray(meta.paths) ? meta.paths : [];
  if (!paths.length) return { stop: json({ error: 'The site has no files.' }, 400) };
  if (paths.length > SITES_LIMITS.maxFiles) return { stop: json({ error: `A site can have up to ${SITES_LIMITS.maxFiles} files.` }, 413) };
  const files = [];
  let total = 0;
  for (const [i, path] of paths.entries()) {
    const part = form.get(`f${i}`);
    if (!part || typeof part.arrayBuffer !== 'function') return { stop: json({ error: `The file ${String(path).slice(0, 80)} is missing from the upload.` }, 400) };
    const bytes = new Uint8Array(await part.arrayBuffer());
    total += bytes.length;
    if (total > SITES_LIMITS.maxBytes) return { stop: json({ error: 'Sites can be up to 10 MB. Use fewer or smaller images.' }, 413) };
    files.push({ path: String(path), bytes });
  }
  return { meta, files };
}

const siteOut = (env, row, block) => ({
  slug: row.slug, url: siteUrl(env, row.slug), title: row.title || '', version: row.version, size: row.bytes, files: row.files,
  createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  status: !block ? 'live' : block === 'reports' ? 'paused' : 'blocked',
});
const publicLimits = (env) => ({
  maxSites: SITES_LIMITS.maxSites, maxBytes: SITES_LIMITS.maxBytes, maxFiles: SITES_LIMITS.maxFiles,
  perAccountDaily: limit(env, 'SITES_PER_ACCOUNT_DAILY', SITES_LIMITS.perAccountDaily), domain: domainOf(env),
});

async function publish(request, env, ctx, user, slugFromPath) {
  if (env.SITES_PAUSED === '1' || env.SITES_PAUSED === 'true') return json({ error: 'Publishing is paused for maintenance. Your published sites stay online.' }, 503);
  const up = await readUpload(request);
  if (up.stop) return up.stop;
  const slug = slugFromPath || String(up.meta.slug || '').trim().toLowerCase();
  if (slugFromPath && up.meta.slug && String(up.meta.slug).toLowerCase() !== slugFromPath) return json({ error: 'The address in the request does not match.' }, 400);
  const bad = slugProblem(slug);
  if (bad) return json({ error: bad, field: 'slug' }, 400);
  if (await blockOf(env, slug)) return json({ error: 'That address is not available.', field: 'slug' }, 403);

  // daily limits (counted for every checked upload, including refused ones)
  const ipWho = `ip:${await hashIp(clientIp(request))}`;
  const userWho = `u:${user.id}`;
  const [mine, ipn] = await Promise.all([quotaCount(env, userWho), quotaCount(env, ipWho)]);
  if (mine >= limit(env, 'SITES_PER_ACCOUNT_DAILY', SITES_LIMITS.perAccountDaily) || ipn >= limit(env, 'SITES_PER_IP_DAILY', SITES_LIMITS.perIpDaily)) {
    return json({ error: 'You have published a lot today. Try again tomorrow (midnight UTC).' }, 429);
  }

  const row = await db(env).prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (slugFromPath) {
    if (!row) return json({ error: 'There is no site at that address. Publish it first.' }, 404);
    if (row.owner !== user.id) return json({ error: 'That site belongs to another account.' }, 403);
  } else if (row) {
    return row.owner === user.id
      ? json({ error: 'You already own this address. Update it instead.', mine: true, field: 'slug' }, 409)
      : json({ error: 'That address is taken. Try another.', field: 'slug' }, 409);
  }

  const checked = await checkFiles(up.files);
  await quotaUse(env, userWho, ipWho);
  if (checked.error) return json({ error: checked.error }, checked.status);

  const now = clock();
  const title = String(up.meta.title || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  if (!slugFromPath) {
    // claim the address and a seat under the 5-site limit in one statement: first come, first served
    const claim = await db(env).prepare(
      `INSERT INTO sites (slug, owner, version, bytes, files, title, created_at, updated_at)
       SELECT ?, ?, 1, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM sites WHERE owner = ?) < ?
       ON CONFLICT(slug) DO NOTHING`,
    ).bind(slug, user.id, checked.size, checked.files.length, title, now, now, user.id, SITES_LIMITS.maxSites).run();
    if (!claim.meta || !claim.meta.changes) {
      const again = await db(env).prepare('SELECT owner FROM sites WHERE slug = ?').bind(slug).first();
      if (again) return json({ error: 'That address is taken. Try another.', field: 'slug' }, 409);
      return json({ error: `You can have up to ${SITES_LIMITS.maxSites} sites. Unpublish one to make room.` }, 403);
    }
    const fresh = { slug, owner: user.id, version: 1, created_at: now, updated_at: now };
    try {
      await writeVersion(env, slug, 1, checked.files);
      await env.SITES_BUCKET.put(manifestKey(slug), JSON.stringify(manifestOf(fresh, checked.files, checked.size)), { httpMetadata: { contentType: 'application/json' } });
    } catch (e) {
      await deletePrefix(env.SITES_BUCKET, `sites/${slug}/`).catch(() => {});
      await db(env).prepare('DELETE FROM sites WHERE slug = ? AND owner = ?').bind(slug, user.id).run();
      return json({ error: `The site could not be stored: ${e.message || e}` }, 500);
    }
    memo.manifest.delete(slug);
    if (ctx && ctx.waitUntil) ctx.waitUntil(sweepQuota(env).catch(() => {}));
    return json({ ok: true, site: siteOut(env, { ...fresh, title, bytes: checked.size, files: checked.files.length }, null) }, 201);
  }

  // republish: write the new version beside the old one, switch the manifest, then delete the old files
  const version = row.version + 1;
  await writeVersion(env, slug, version, checked.files);
  const moved = await db(env).prepare('UPDATE sites SET version = ?, bytes = ?, files = ?, title = ?, updated_at = ? WHERE slug = ? AND owner = ? AND version = ?')
    .bind(version, checked.size, checked.files.length, title || row.title || '', now, slug, user.id, row.version).run();
  if (!moved.meta || !moved.meta.changes) {
    await deletePrefix(env.SITES_BUCKET, `sites/${slug}/v${version}/`).catch(() => {});
    return json({ error: 'This site changed while you were publishing. Try again.' }, 409);
  }
  const next = { ...row, version, updated_at: now, title: title || row.title || '', bytes: checked.size, files: checked.files.length };
  await env.SITES_BUCKET.put(manifestKey(slug), JSON.stringify(manifestOf(next, checked.files, checked.size)), { httpMetadata: { contentType: 'application/json' } });
  memo.manifest.delete(slug);
  const cleanup = deletePrefix(env.SITES_BUCKET, `sites/${slug}/v${row.version}/`).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(cleanup); else await cleanup;
  return json({ ok: true, site: siteOut(env, next, await blockOf(env, slug)) });
}

async function unpublish(env, user, slug) {
  const row = await db(env).prepare('SELECT * FROM sites WHERE slug = ?').bind(slug).first();
  if (!row) return json({ error: 'There is no site at that address.' }, 404);
  if (row.owner !== user.id) return json({ error: 'That site belongs to another account.' }, 403);
  await deletePrefix(env.SITES_BUCKET, `sites/${slug}/`);
  await db(env).prepare('DELETE FROM sites WHERE slug = ? AND owner = ?').bind(slug, user.id).run();
  memo.manifest.delete(slug);
  return json({ ok: true, slug });
}

async function mySites(env, user) {
  const { results } = await db(env).prepare('SELECT * FROM sites WHERE owner = ? ORDER BY created_at').bind(user.id).all();
  const rows = results || [];
  const blocks = await Promise.all(rows.map((r) => blockOf(env, r.slug)));
  return json({ sites: rows.map((r, i) => siteOut(env, r, blocks[i])), limits: publicLimits(env) });
}

async function checkSlug(env, url) {
  const slug = String(url.searchParams.get('slug') || '').trim().toLowerCase();
  const bad = slugProblem(slug);
  if (bad) return json({ slug, available: false, reason: bad });
  if (await blockOf(env, slug)) return json({ slug, available: false, reason: 'That address is not available.' });
  const row = await db(env).prepare('SELECT slug FROM sites WHERE slug = ?').bind(slug).first();
  return json(row ? { slug, available: false, taken: true, reason: 'That address is taken.' } : { slug, available: true, url: siteUrl(env, slug) });
}

// ---------------------------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------------------------

export const REPORT_REASONS = ['phishing', 'scam', 'malware', 'impersonation', 'spam', 'illegal', 'copyright', 'other'];

async function report(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send JSON: { "site": "...", "reason": "..." }' }, 400); }
  const slug = String(body.site || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(new RegExp(`\\.${domainOf(env).replace(/\./g, '\\.')}.*$`), '');
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return json({ error: 'Enter the site address you are reporting.', field: 'site' }, 400);
  const reason = String(body.reason || '');
  if (!REPORT_REASONS.includes(reason)) return json({ error: 'Pick a reason.', field: 'reason' }, 400);
  const details = String(body.details || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 2000);
  const contact = String(body.contact || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  const row = await db(env).prepare('SELECT slug, created_at FROM sites WHERE slug = ?').bind(slug).first();
  if (!row) return json({ error: 'There is no site at that address.', field: 'site' }, 404);
  const who = `r:${await hashIp(clientIp(request))}`;
  if ((await quotaCount(env, who)) >= SITES_LIMITS.reportsPerIpDaily) return json({ error: 'Thanks. You have sent many reports today; we will look at those first.' }, 429);
  const now = clock();
  await db(env).batch([
    db(env).prepare('INSERT INTO site_reports (slug, reason, details, contact, who, at) VALUES (?, ?, ?, ?, ?, ?)').bind(slug, reason, details, contact, who, now),
    db(env).prepare('UPDATE sites SET reports = reports + 1, flagged_at = COALESCE(flagged_at, ?) WHERE slug = ?').bind(now, slug),
    db(env).prepare('INSERT INTO site_quota (day, who, n) VALUES (?, ?, 1) ON CONFLICT(day, who) DO UPDATE SET n = n + 1').bind(today(), who),
  ]);
  // enough different people reporting a site pauses it until someone reviews it
  const pauseAt = limit(env, 'SITES_REPORT_PAUSE', SITES_LIMITS.pauseAfterReports);
  if (pauseAt > 0 && env.MASSLESS_KV) {
    const n = await db(env).prepare('SELECT COUNT(DISTINCT who) AS n FROM site_reports WHERE slug = ? AND at >= ?').bind(slug, row.created_at).first('n');
    if (n >= pauseAt && !(await env.MASSLESS_KV.get(`site-block:${slug}`))) {
      await env.MASSLESS_KV.put(`site-block:${slug}`, 'reports');
      memo.block.delete(slug);
    }
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------------------------------------
// API router
// ---------------------------------------------------------------------------------------------

/** Writes that go behind the Turnstile human check (see needsHuman in src/index.js). */
export function sitesGated(method, path) {
  if (method === 'POST') return path === '/api/sites' || path === '/api/sites/report';
  if (method === 'PUT') return /^\/api\/sites\/[^/]+$/.test(path);
  return false;
}

export async function sitesApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin) {
      let ok = false;
      try { ok = new URL(origin).host === url.host; } catch { /* bad origin */ }
      if (!ok) return json({ error: 'Cross-site requests are not allowed.' }, 403);
    }
  }
  if (!env.SITES_BUCKET || !db(env)) return json({ error: 'Free hosting is not switched on here yet.' }, 501);
  try {
    if (path === '/api/sites/check') return method === 'GET' ? await checkSlug(env, url) : json({ error: 'Use GET.' }, 405);
    if (path === '/api/sites/report') return method === 'POST' ? await report(request, env) : json({ error: 'Use POST.' }, 405);
    if (path === '/api/sites') {
      if (method !== 'GET' && method !== 'POST') return json({ error: 'Use GET or POST.' }, 405);
      const a = await currentUser(request, env);
      if (a.stop) return a.stop;
      return method === 'GET' ? await mySites(env, a.user) : await publish(request, env, ctx, a.user, null);
    }
    const m = path.match(/^\/api\/sites\/([^/]+)$/);
    if (!m) return json({ error: 'Not found' }, 404);
    const slug = decodeURIComponent(m[1]).toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) return json({ error: 'There is no site at that address.' }, 404);
    if (method !== 'PUT' && method !== 'DELETE') return json({ error: 'Use PUT or DELETE.' }, 405);
    const a = await currentUser(request, env);
    if (a.stop) return a.stop;
    return method === 'PUT' ? await publish(request, env, ctx, a.user, slug) : await unpublish(env, a.user, slug);
  } catch (e) {
    return json({ error: `Hosting hit a server error: ${e.message || e}` }, 500);
  }
}

// ---------------------------------------------------------------------------------------------
// Serving <slug>.v2web.site
// ---------------------------------------------------------------------------------------------

/** Which hosted-site host this is, or null for every other host. */
export function siteHost(hostname, env = {}) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  const domain = domainOf(env);
  if (host === domain) return { kind: 'apex' };
  if (!host.endsWith(`.${domain}`)) return null;
  const label = host.slice(0, -(domain.length + 1));
  if (label === 'www') return { kind: 'apex' };
  if (!/^[a-z0-9-]{1,63}$/.test(label)) return { kind: 'bad' };
  return { kind: 'site', slug: label };
}

let cspMemo = null;
async function siteCsp() {
  if (cspMemo) return cspMemo;
  const boot = b64(await crypto.subtle.digest('SHA-256', enc.encode(headBootBody)));
  cspMemo = [
    "default-src 'none'",
    `script-src 'self' 'sha256-${boot}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "media-src 'self'",
    `frame-src ${FRAME_HOSTS}`,
    "connect-src 'self'",
    "manifest-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  return cspMemo;
}
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'";

function baseHeaders(h, csp) {
  h.set('content-security-policy', csp);
  h.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  h.set('x-content-type-options', 'nosniff');
  h.set('x-frame-options', 'DENY');
  h.set('referrer-policy', 'strict-origin-when-cross-origin');
  h.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=()');
  h.set('cross-origin-opener-policy', 'same-origin');
  return h;
}

const BADGE_VERSION = 'b1';
export function badgeHtml(slug) {
  const s = 'all:initial!important;';
  const a = `${s}color:#fff!important;font:inherit!important;cursor:pointer!important;text-decoration:none!important;`;
  return `<v2web-badge style="${s}position:fixed!important;right:12px!important;bottom:12px!important;z-index:2147483647!important;display:flex!important;align-items:center!important;gap:7px!important;padding:7px 12px!important;border-radius:999px!important;background:rgba(18,18,22,.9)!important;color:#fff!important;font:500 12px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif!important;box-shadow:0 4px 16px rgba(0,0,0,.25)!important;visibility:visible!important;opacity:1!important;transform:none!important;pointer-events:auto!important"><a style="${a}" href="https://chucksi.com/website" target="_blank" rel="noopener">Made with Chucksi</a><span style="${s}color:#fff!important;opacity:.5!important" aria-hidden="true">·</span><a style="${a}opacity:.8!important" href="https://chucksi.com/report?site=${slug}" target="_blank" rel="noopener">Report</a></v2web-badge>`;
}
function withBadge(html, slug) {
  const at = html.toLowerCase().lastIndexOf('</body>');
  const badge = badgeHtml(slug);
  return at < 0 ? html + badge : html.slice(0, at) + badge + html.slice(at);
}

const shell = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0c;color:#f4f4f1;font:16px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;padding:24px;box-sizing:border-box}
main{max-width:520px;text-align:center}h1{font-size:clamp(28px,6vw,40px);line-height:1.1;margin:0 0 12px;letter-spacing:-.02em}p{color:#b9b9bf;margin:0 0 24px}
code{color:#f4f4f1;background:#1b1b20;padding:2px 8px;border-radius:6px}a.btn{display:inline-block;background:#f4f4f1;color:#0b0b0c;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:999px}
small{display:block;margin-top:28px;color:#77777f}small a{color:#b9b9bf}</style></head>
<body><main>${body}</main></body></html>
`;

function ourPage(request, status, title, body) {
  const h = baseHeaders(new Headers({ 'content-type': TYPES.html, 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }), PAGE_CSP);
  return new Response(request.method === 'HEAD' ? null : shell(title, body), { status, headers: h });
}
const freePage = (request, env, slug) => ourPage(request, 404, 'This address is free',
  `<h1>This address is free</h1><p>${slug ? `<code>${slug}.${domainOf(env)}</code> isn't taken yet. ` : ''}Build a site in minutes and publish it here for free.</p><a class="btn" href="https://chucksi.com/website">Build your site on Chucksi</a><small>Free hosting by <a href="https://chucksi.com">Chucksi</a></small>`);
const blockedPage = (request) => ourPage(request, 410, 'This site is unavailable',
  `<h1>This site is unavailable</h1><p>It was taken down or paused for review.</p><small><a href="https://chucksi.com/terms.html">Hosting rules</a></small>`);

/** Serve a hosted site (or the landing redirect) for a host siteHost() recognised. */
export async function serveSite(request, env, ctx, host) {
  if (host.kind === 'apex') return new Response(null, { status: 302, headers: baseHeaders(new Headers({ location: 'https://chucksi.com/website', 'cache-control': 'public, max-age=3600' }), PAGE_CSP) });
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: baseHeaders(new Headers({ allow: 'GET, HEAD' }), PAGE_CSP) });
  if (host.kind !== 'site' || !/^[a-z0-9-]{3,40}$/.test(host.slug)) return freePage(request, env, '');
  const slug = host.slug;
  // only name the address on the "free" page when someone could actually publish there
  const offer = slugProblem(slug) ? '' : slug;
  if (!env.SITES_BUCKET) return freePage(request, env, offer);
  if (await blockOf(env, slug)) return blockedPage(request);
  const manifest = await readManifest(env, slug);
  if (!manifest || !manifest.files) return freePage(request, env, offer);

  const url = new URL(request.url);
  let path;
  try { path = decodeURIComponent(url.pathname); } catch { path = '/'; }
  if (path.includes('..') || path.includes('\\') || path.includes('\0')) return notHere(request, env, manifest);
  let rel = path.replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  if (!manifest.files[rel]) {
    if (manifest.files[`${rel}/index.html`]) {
      return new Response(null, { status: 301, headers: baseHeaders(new Headers({ location: `${url.pathname}/${url.search}`, 'cache-control': 'public, max-age=600' }), await siteCsp()) });
    }
    return notHere(request, env, manifest);
  }
  return sendFile(request, env, manifest, rel, 200);
}

async function notHere(request, env, manifest) {
  if (manifest.files['404.html']) return sendFile(request, env, manifest, '404.html', 404);
  return ourPage(request, 404, 'Page not found', '<h1>Page not found</h1><p>This page is not on this site.</p><a class="btn" href="/">Go to the home page</a>');
}

async function sendFile(request, env, manifest, rel, status) {
  const info = manifest.files[rel];
  const ext = extOf(rel);
  const html = ext === 'html';
  const etag = `"${info.etag}${html ? `-${BADGE_VERSION}` : ''}"`;
  const headers = baseHeaders(new Headers({
    'content-type': TYPES[ext] || 'application/octet-stream',
    'cache-control': html ? 'public, max-age=0, must-revalidate' : 'public, max-age=600',
    etag,
  }), await siteCsp());
  if (status === 200 && (request.headers.get('if-none-match') || '').split(/\s*,\s*/).includes(etag)) return new Response(null, { status: 304, headers });
  const obj = await env.SITES_BUCKET.get(fileKey(manifest.slug, manifest.version, rel));
  if (!obj) {
    memo.manifest.delete(manifest.slug);
    return new Response('Not found', { status: 404, headers: baseHeaders(new Headers({ 'cache-control': 'no-store' }), PAGE_CSP) });
  }
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  if (html) return new Response(withBadge(await obj.text(), manifest.slug), { status, headers });
  return new Response(obj.body, { status, headers });
}
