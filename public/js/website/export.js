// Export: a ZIP of static files (one index.html per page, assets, sitemap.xml, robots.txt, og.jpg, favicon)
// or one self-contained HTML file. The ZIP writer is our own (CRC-32 plus the browser's deflate-raw), so
// nothing is loaded from a CDN. Everything runs in the visitor's browser.

import { renderPage, renderSingle, sitePages, SITE_JS } from './render.js';
import { BASE_CSS } from './css.js';
import { tokens, themeCss, fontsHref, headingWeight, FONTS } from './theme.js';
import { slugify, COLLECTIONS, SECTIONS } from './spec.js';
import { esc } from './sections.js';

// ---------------------------------------------------------------------------------------------
// ZIP (PKZIP 2.0: stored or deflated entries, UTF-8 names)
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  } catch {
    return null;
  }
}

/** files: [{ name, data: string | Uint8Array | Blob, compress? }] -> Blob (application/zip) */
export async function zip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const local = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data instanceof Blob ? new Uint8Array(await f.data.arrayBuffer()) : f.data;
    const crc = crc32(data);
    let method = 0;
    let body = data;
    if (f.compress !== false && data.length > 200) {
      const d = await deflateRaw(data);
      if (d && d.length < data.length) { method = 8; body = d; }
    }
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, method, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, body.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    local.push(new Uint8Array(lh.buffer), name, body);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, method, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, body.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...local, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

// ---------------------------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------------------------

/** Every asset id the site uses, with a readable name from its alt text. */
export function usedAssets(site) {
  const out = new Map();
  const visit = (o, hint) => {
    if (Array.isArray(o)) { o.forEach((x) => visit(x, hint)); return; }
    if (!o || typeof o !== 'object') return;
    if (typeof o.src === 'string' && o.src.startsWith('asset:') && !out.has(o.src)) out.set(o.src, { kind: 'image', hint: o.alt || o.prompt || hint });
    if (typeof o.audio === 'string' && o.audio.startsWith('asset:') && !out.has(o.audio)) out.set(o.audio, { kind: 'audio', hint: o.title || 'track' });
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') visit(v, o.title || o.name || hint || k);
  };
  for (const p of site.pages) for (const s of p.sections) if (!s.hidden) visit(s, s.type);
  for (const key of Object.keys(COLLECTIONS)) if (site.pages.some((p) => p.sections.some((s) => !s.hidden && SECTIONS[s.type].collection === key))) visit(site.collections[key], key);
  if (site.seo.image?.src) visit(site.seo.image, 'social');
  return out;
}

async function toBitmap(blob) {
  return await createImageBitmap(blob);
}
function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
const toBlob = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));

/** A resized copy of an image (never upscaled). Keeps PNG for images with transparency. */
async function resized(blob, maxW, type) {
  const bmp = await toBitmap(blob);
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = canvasOf(w, h);
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const out = await toBlob(c, type, 0.84);
  return { blob: out, w, h };
}

/**
 * Plan the image files: a full size (max 1600 px) and an 800 px copy for srcset.
 * assets: Map(id -> { blob, w, h, type }). Returns Map('asset:id' -> { path, small, w, h, smallW, files, dataUrl? })
 */
async function planImages(site, assets, { inline = false } = {}) {
  const used = usedAssets(site);
  const plan = new Map();
  const names = new Set();
  for (const [ref, meta] of used) {
    const a = assets.get(ref.slice(6));
    if (!a) continue;
    let base = slugify(meta.hint, 40) || meta.kind;
    while (names.has(base)) base = `${base}-2`;
    names.add(base);
    if (meta.kind === 'audio') {
      const ext = (a.type || '').includes('mpeg') ? 'mp3' : (a.type || '').includes('wav') ? 'wav' : (a.type || '').includes('ogg') ? 'ogg' : (a.type || '').includes('mp4') || (a.type || '').includes('aac') ? 'm4a' : 'mp3';
      const path = `assets/audio/${base}.${ext}`;
      plan.set(ref, { kind: 'audio', path, blob: a.blob, dataUrl: inline ? await blobToDataUrl(a.blob) : '' });
      continue;
    }
    const png = (a.type || '') === 'image/png';
    const type = png ? 'image/png' : 'image/jpeg';
    const ext = png ? 'png' : 'jpg';
    if ((a.type || '') === 'image/svg+xml' || (a.type || '') === 'image/gif') {
      const e2 = a.type === 'image/gif' ? 'gif' : 'svg';
      plan.set(ref, { kind: 'image', path: `assets/img/${base}.${e2}`, w: a.w || 1200, h: a.h || 800, files: [{ name: `assets/img/${base}.${e2}`, data: a.blob, compress: e2 === 'svg' }], dataUrl: inline ? await blobToDataUrl(a.blob) : '' });
      continue;
    }
    const full = await resized(a.blob, 1600, type);
    const entry = { kind: 'image', path: `assets/img/${base}.${ext}`, w: full.w, h: full.h, files: [{ name: `assets/img/${base}.${ext}`, data: full.blob, compress: false }] };
    if (inline) {
      entry.dataUrl = await blobToDataUrl(full.blob);
    } else if (full.w > 900) {
      const small = await resized(a.blob, 800, type);
      entry.small = `assets/img/${base}-800.${ext}`;
      entry.smallW = small.w;
      entry.files.push({ name: entry.small, data: small.blob, compress: false });
    }
    plan.set(ref, entry);
  }
  return plan;
}

export function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------------------------
// Social image, favicon, sitemap and robots
// ---------------------------------------------------------------------------------------------

function wrapLines(g, text, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else cur = t;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[,.;:]?\s*\S*$/, '')}…`;
  return lines;
}

/** The 1200 x 630 link preview. Drawn in `doc` (the preview frame) so the site's own fonts are used. */
export async function ogImage(site, assets, doc = document) {
  const W = 1200;
  const H = 630;
  const c = doc.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const tk = tokens(site.theme).base;
  const hw = headingWeight(site.theme);
  const hf = `'${site.theme.heading}', ${(FONTS[site.theme.heading] || FONTS.Inter).fb}`;
  const bf = `'${site.theme.body}', system-ui, sans-serif`;
  try {
    await Promise.all([doc.fonts.load(`${hw} 96px '${site.theme.heading}'`), doc.fonts.load(`500 34px '${site.theme.body}'`)]);
  } catch { /* fall back to system fonts */ }
  // the chosen social image, else the first hero image
  let ref = site.seo.image?.src;
  if (!ref) {
    const hero = site.pages[0].sections.find((s) => s.type === 'hero');
    ref = hero?.image?.src || '';
  }
  const a = ref && ref.startsWith('asset:') ? assets.get(ref.slice(6)) : null;
  let ink = tk.text;
  let sub = tk.muted;
  if (a) {
    const bmp = await toBitmap(a.blob);
    const s = Math.max(W / bmp.width, H / bmp.height);
    g.drawImage(bmp, (W - bmp.width * s) / 2, (H - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0.78)');
    grad.addColorStop(0.65, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0.1)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    ink = '#ffffff';
    sub = 'rgba(255,255,255,0.86)';
  } else {
    g.fillStyle = tk.bg;
    g.fillRect(0, 0, W, H);
    const r1 = g.createRadialGradient(W * 0.86, H * 0.9, 0, W * 0.86, H * 0.9, 520);
    r1.addColorStop(0, tk.accent);
    r1.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.75;
    g.fillStyle = r1;
    g.fillRect(0, 0, W, H);
    const r2 = g.createRadialGradient(W * 0.62, H * 1.05, 0, W * 0.62, H * 1.05, 380);
    r2.addColorStop(0, tk['accent-2']);
    r2.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.55;
    g.fillStyle = r2;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = 1;
  }
  const pad = 84;
  g.fillStyle = a ? '#ffffff' : tk.accent;
  g.fillRect(pad, pad, 64, 6);
  // name, shrunk to fit two lines
  let size = 112;
  g.textBaseline = 'alphabetic';
  let lines;
  const name = site.theme.style === 'bold' ? site.name.toUpperCase() : site.name;
  do {
    g.font = `${hw} ${size}px ${hf}`;
    lines = wrapLines(g, name, W - pad * 2, 2);
    size -= 6;
  } while ((lines.length > 2 || lines.some((l) => g.measureText(l).width > W - pad * 2)) && size > 48);
  g.fillStyle = ink;
  let y = 250;
  for (const l of lines) { g.fillText(l, pad, y); y += size * 1.02; }
  g.font = `500 34px ${bf}`;
  g.fillStyle = sub;
  const tag = site.tagline || site.seo.description || '';
  for (const l of wrapLines(g, tag, W - pad * 2 - 120, 2)) { g.fillText(l, pad, y + 30); y += 46; }
  if (site.seo.url) {
    g.font = `600 26px ${bf}`;
    g.fillStyle = sub;
    g.fillText(site.seo.url.replace(/^https?:\/\//, ''), pad, H - pad + 10);
  }
  return await toBlob(c, 'image/jpeg', 0.88);
}

export function faviconSvg(site) {
  const tk = tokens(site.theme).base;
  const ch = esc(String(site.name || '?').replace(/^the\s+/i, '').trim().charAt(0).toUpperCase() || 'M');
  const r = Math.min(18, Math.max(6, Number(site.theme.radius) || 0));
  const serif = (FONTS[site.theme.heading] || {}).cat === 'serif';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${r}" fill="${tk.accent}"/><text x="32" y="44" text-anchor="middle" font-family="${serif ? 'Georgia, serif' : 'Arial, Helvetica, sans-serif'}" font-size="36" font-weight="700" fill="${tk['accent-ink']}">${ch}</text></svg>`;
}

const PLACEHOLDER_URL = 'https://example.com';
export function sitemapXml(site, pages, today = new Date().toISOString().slice(0, 10)) {
  const base = site.seo.url || PLACEHOLDER_URL;
  const note = site.seo.url ? '' : `\n<!-- Replace ${PLACEHOLDER_URL} with your site's address (Chucksi: Settings, Site address). -->`;
  const urls = pages.map((p) => `  <url><loc>${esc(`${base}/${p.path}`)}</loc><lastmod>${today}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>${note}\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
export function robotsTxt(site) {
  return `User-agent: *\nAllow: /\n\nSitemap: ${site.seo.url || PLACEHOLDER_URL}/sitemap.xml\n`;
}

function notFoundPage(site) {
  const home = site.seo.url ? `${site.seo.url}/` : '/';
  return `<!doctype html>\n<html lang="${esc(site.seo.lang || 'en')}" data-style="${esc(site.theme.style)}" data-mode="${esc(site.theme.mode)}" data-motion="none">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Page not found | ${esc(site.name)}</title>\n<meta name="robots" content="noindex">\n<link rel="stylesheet" href="${esc(fontsHref(site.theme))}">\n<style>${themeCss(site.theme)}${BASE_CSS}</style>\n</head>\n<body>\n<main id="main" class="sec"><div class="wrap narrow center" style="padding-block:12vh"><p class="eyebrow">404</p><h1 class="h1 h1-sm" style="margin-top:16px">This page is not here.</h1><p class="lead" style="margin-top:20px">It may have moved. The home page is a good place to start.</p><div class="actions center"><a class="btn" href="${esc(home)}">Go to ${esc(site.name)}</a></div></div></main>\n</body>\n</html>\n`;
}

// ---------------------------------------------------------------------------------------------
// The two exports
// ---------------------------------------------------------------------------------------------

/** Build the ZIP. Returns { blob, files: [names] }. */
export async function exportZip(site, assets, { doc = document } = {}) {
  const plan = await planImages(site, assets);
  const pages = sitePages(site);
  const rel = (path, here) => `${'../'.repeat(here.depth)}${path}`;
  const opts = {
    mode: 'zip',
    src: (src, here) => { const e = plan.get(src); return e ? rel(e.path, here) : ''; },
    imgInfo: (src) => { const e = plan.get(src); return e ? { w: e.w, h: e.h } : null; },
    srcset: (src, here) => { const e = plan.get(src); return e && e.small ? `${rel(e.small, here)} ${e.smallW}w, ${rel(e.path, here)} ${e.w}w` : ''; },
  };
  const files = [];
  for (const here of pages) files.push({ name: `${here.path}index.html`, data: renderPage(site, here, opts) });
  files.push({ name: '404.html', data: notFoundPage(site) });
  files.push({ name: 'assets/style.css', data: BASE_CSS.trim() + '\n' });
  files.push({ name: 'assets/site.js', data: `${SITE_JS}\n` });
  for (const e of plan.values()) {
    if (e.kind === 'audio') files.push({ name: e.path, data: e.blob, compress: false });
    else files.push(...e.files);
  }
  files.push({ name: 'og.jpg', data: await ogImage(site, assets, doc), compress: false });
  files.push({ name: 'favicon.svg', data: faviconSvg(site) });
  files.push({ name: 'sitemap.xml', data: sitemapXml(site, pages) });
  files.push({ name: 'robots.txt', data: robotsTxt(site) });
  files.push({ name: '.nojekyll', data: '' });
  return { blob: await zip(files), files: files.map((f) => f.name) };
}

/** Build the one-file version: every page, image and the runtime inline. */
export async function exportSingle(site, assets) {
  const plan = await planImages(site, assets, { inline: true });
  const html = renderSingle(site, {
    src: (src) => plan.get(src)?.dataUrl || '',
    imgInfo: (src) => { const e = plan.get(src); return e ? { w: e.w, h: e.h } : null; },
    faviconHref: `data:image/svg+xml,${encodeURIComponent(faviconSvg(site))}`,
    ogUrl: () => (site.seo.url ? `${site.seo.url}/og.jpg` : ''),
  });
  return new Blob([html], { type: 'text/html' });
}

/**
 * Hosting hook. Hosting on a Chucksi domain is off for now (abuse risk); when it ships, a target here
 * will receive the ZIP and return a URL, behind the human check, a size cap, a content scan and takedowns.
 */
export const HOSTS = [
  { id: 'chucksi', name: 'Chucksi hosting (not offered)', available: false, publish: async () => { throw new Error('Hosting on a Chucksi domain is not available.'); } },
];
