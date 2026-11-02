// Whole documents: <head> with SEO and fonts, the header and mobile menu, the sections, the footer and a
// tiny runtime (scroll reveal, click-to-load embeds, the music player, mailto forms). Three modes:
//   edit   - the editor preview (data-edit hooks, editor overlay CSS, links stay as written)
//   zip    - one index.html per page, relative links and assets, shared assets/style.css and site.js
//   single - every page in one file, a hash router, everything inline

import { BASE_CSS, EDIT_CSS } from './css.js';
import { themeCss, fontsHref, tokens } from './theme.js';
import { renderSection, renderItemPage, esc } from './sections.js';
import { SECTIONS, COLLECTIONS } from './spec.js';
import { photoInfo } from './photos.js';
import { GEN_JS, SITE_JS, HEAD_BOOT, GENERATOR } from './runtime.js';

export { GEN_JS, SITE_JS, HEAD_BOOT, GENERATOR };

/** The single-file router: #/slug shows a page, #/slug:anchor scrolls to a section on it. */
const ROUTER_JS = `(function(){var d=document,pages=[].slice.call(d.querySelectorAll('[data-page]'));
function show(){var h=decodeURIComponent(location.hash.slice(1)),path=null,anchor='';if(h.charAt(0)==='/'){var i=h.indexOf(':');path=i<0?h.slice(1):h.slice(1,i);anchor=i<0?'':h.slice(i+1)}else anchor=h;
var vis=pages.filter(function(p){return !p.hidden})[0];
if(path!==null){var hit=pages.filter(function(p){return p.getAttribute('data-page')===path})[0]||pages[0];pages.forEach(function(p){p.hidden=p!==hit});vis=hit;d.title=hit.getAttribute('data-title')||d.title;if(!anchor)window.scrollTo(0,0)}
if(anchor&&vis){var el=vis.querySelector('#'+anchor.replace(/[^\\w-]/g,''));if(el)el.scrollIntoView()}}
addEventListener('hashchange',show);show()})();`;


/** Every page of a site with its path: the site's pages, then one page per CMS item that has a list on the site. */
export function sitePages(site) {
  const out = site.pages.map((p, i) => ({ kind: 'page', page: p, path: i === 0 ? '' : `${p.slug}/`, key: i === 0 ? '' : p.slug, depth: i === 0 ? 0 : 1, title: p.title }));
  for (const [col, def] of Object.entries(COLLECTIONS)) {
    if (!def.detail) continue;
    if (!usedCollection(site, col)) continue;
    for (const it of site.collections[col] || []) out.push({ kind: 'item', col, item: it, path: `${col}/${it.slug}/`, key: `${col}/${it.slug}`, depth: 2, title: it.title });
  }
  return out;
}
export const usedCollection = (site, col) => site.pages.some((p) => p.sections.some((s) => !s.hidden && SECTIONS[s.type].collection === col));

/** Map a link written in the spec ("/about#team", "#contact", "https://…") to one that works in this mode. */
function mapHref(h, here, site, opts) {
  const s = String(h || '').trim();
  if (!s) return '#';
  if (opts.mode === 'edit') return s;
  const m = s.match(/^\/([\w-]*(?:\/[\w-]+)?)(?:#([\w-]+))?$/);
  if (!m) return s;
  const target = m[1].replace(/\/$/, '');
  const anchor = m[2] || '';
  const isHere = target === here.key;
  if (opts.mode === 'single') {
    if (isHere) return anchor ? `#${anchor}` : `#/${target}`;
    return `#/${target}${anchor ? `:${anchor}` : ''}`;
  }
  // zip: relative folders, so the site works on any host, in a subfolder, and from disk
  if (isHere) return anchor ? `#${anchor}` : './';
  const base = `${'../'.repeat(here.depth)}${target ? `${target}/` : ''}` || './';
  return anchor ? `${base}#${anchor}` : base;
}

function navLinksFor(site, here, c) {
  if (site.pages.length > 1) {
    return site.pages.map((p, i) => ({ label: p.title, href: c.href(i === 0 ? '/' : `/${p.slug}`), current: here.kind === 'page' && here.page === p }));
  }
  // one-page site: link to the main sections on the page
  const want = ['products', 'lookbook', 'chapters', 'cases', 'annotated', 'features', 'about', 'gallery', 'pricing', 'menu', 'tracks', 'schedule', 'listing', 'faq', 'contact'];
  // untitled photo bands (a lookbook used as a breather) are not destinations
  const secs = site.pages[0].sections.filter((s) => s.anchor && want.includes(s.type) && !s.hidden && !(s.type === 'lookbook' && !s.title));
  return secs.slice(0, 4).map((s) => ({ label: navLabel(s), href: c.href(`#${s.anchor}`), current: false }));
}
function navLabel(s) {
  const map = { products: 'Shop', lookbook: 'Lookbook', chapters: 'Read', cases: 'Work', annotated: 'How it works', features: 'Features', about: 'About', gallery: 'Gallery', pricing: 'Pricing', menu: 'Menu', tracks: 'Music', schedule: 'Schedule', listing: 'Details', faq: 'FAQ', contact: 'Contact' };
  if (s.type === 'features' && /servic/i.test(s.eyebrow || '')) return 'Services';
  return map[s.type] || SECTIONS[s.type].name;
}

/** Rendering context shared by every section on a page. */
export function makeContext(site, here, opts = {}) {
  const c = {
    site,
    edit: opts.mode === 'edit',
    mode: opts.mode || 'zip',
    motion: site.theme.motion !== 'none' && (opts.mode !== 'edit' || !!opts.forceMotion),
    h1: { used: false },
    here,
    src: (src) => (opts.src ? opts.src(src, here) : /^\/media\//.test(src) ? src : ''),
    imgInfo: (src) => ({ ...photoInfo(src), ...(opts.imgInfo && opts.imgInfo(src)) }),
    // bundled template photos carry a small copy; exports map both through their own plan
    srcset: opts.srcset ? (src) => opts.srcset(src, here) : (src) => { const p = photoInfo(src); return p && opts.mode !== 'single' ? `${c.src(p.sm)} ${p.smW}w, ${c.src(src)} ${p.w}w` : ''; },
    href: (h) => mapHref(h, here, site, opts),
  };
  c.itemHref = (col, it) => c.href(`/${col}/${it.slug}`);
  c.listPage = (col) => {
    const p = site.pages.find((x) => x.sections.some((s) => SECTIONS[s.type].collection === col));
    return p ? (site.pages.indexOf(p) === 0 ? '/' : `/${p.slug}`) : '/';
  };
  c.navLinks = navLinksFor(site, here, c);
  return c;
}

function header(site, c) {
  const home = c.href('/');
  const links = c.navLinks.map((l) => `<li><a href="${esc(l.href)}"${l.current ? ' aria-current="page"' : ''}>${esc(l.label)}</a></li>`).join('');
  const cta = site.nav?.cta?.label ? `<a class="btn sm head-cta" href="${esc(c.href(site.nav.cta.href))}">${esc(site.nav.cta.label)}</a>` : '';
  const ctaM = site.nav?.cta?.label ? `<a class="btn wide" href="${esc(c.href(site.nav.cta.href))}">${esc(site.nav.cta.label)}</a>` : '';
  const initial = esc(String(site.name || '?').replace(/^the\s+/i, '').trim().charAt(0).toUpperCase() || '•');
  const menu = links || cta ? `<details class="menu"><summary aria-label="Menu"><span></span></summary><nav class="menu-panel" aria-label="Menu">${c.navLinks.map((l) => `<a href="${esc(l.href)}"${l.current ? ' aria-current="page"' : ''}>${esc(l.label)}</a>`).join('')}${ctaM}</nav></details>` : '';
  return `<header class="site-head"><div class="wrap"><a class="brand" href="${esc(home)}"><span class="brand-mark" aria-hidden="true">${initial}</span><span class="brand-name"${c.edit ? ' data-edit="$:name"' : ''}>${esc(site.name)}</span></a>${links ? `<nav aria-label="Main"><ul class="nav-list">${links}</ul></nav>` : ''}${cta}${menu}</div></header>`;
}

function jsonLd(site, here, url) {
  if (here.kind !== 'page' || here.depth !== 0) return '';
  const type = { business: 'LocalBusiness', restaurant: 'Restaurant', band: 'MusicGroup', portfolio: 'Person', realestate: 'Residence', event: 'Organization' }[site.kind] || 'Organization';
  const o = { '@context': 'https://schema.org', '@type': type, name: site.name };
  if (site.seo.description) o.description = site.seo.description;
  if (url) o.url = `${url}/`;
  if (site.contact.email && type !== 'Residence') o.email = site.contact.email;
  if (site.contact.phone && type !== 'Residence') o.telephone = site.contact.phone;
  if (site.contact.address && (type === 'LocalBusiness' || type === 'Restaurant' || type === 'Residence')) o.address = site.contact.address;
  return `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
}

/** The pieces of one page: <html> attributes, <head> inner HTML and <body> inner HTML. */
export function renderParts(site, here, opts = {}) {
  const c = makeContext(site, here, opts);
  const mode = opts.mode || 'zip';
  const t = site.theme;
  const htmlAttrs = { lang: site.seo.lang || 'en', 'data-style': t.style, 'data-mode': t.mode, 'data-motion': t.motion };
  let main = '';
  let foot = '';
  if (here.kind === 'item') {
    main = renderItemPage(here.col, here.item, c);
    const f = site.pages[0].sections.find((s) => s.type === 'footer');
    if (f) foot = renderSection(f, c);
  } else {
    const secs = here.page.sections;
    const hasHero = secs.some((s) => s.type === 'hero' && !s.hidden);
    if (!hasHero) { main += `<h1 class="sr-only">${esc(here.page.title)}</h1>`; c.h1.used = true; }
    for (const s of secs) {
      const html = renderSection(s, c);
      if (s.type === 'footer') foot += html;
      else main += html;
    }
  }
  const body = `<a class="skip" href="#main${mode === 'single' ? `-${esc(here.key.replace(/\//g, '-')) || 'home'}` : ''}">Skip to content</a>${header(site, c)}<main id="main${mode === 'single' ? `-${esc(here.key.replace(/\//g, '-')) || 'home'}` : ''}">${main}</main>${foot}`;

  // <head>
  const pageTitle = here.kind === 'item' ? `${here.item.title} | ${site.name}` : here.depth === 0 ? site.seo.title || site.name : here.page.seo?.title || `${here.page.title} | ${site.name}`;
  const desc = here.kind === 'item' ? here.item.excerpt || String(here.item.text || '').slice(0, 155) || site.seo.description : here.page.seo?.description || site.seo.description;
  const url = site.seo.url ? site.seo.url.replace(/\/+$/, '') : '';
  const prefix = '../'.repeat(here.depth);
  const og = opts.ogUrl ? opts.ogUrl(here) : url ? `${url}/og.jpg` : mode === 'zip' ? `${prefix}og.jpg` : '';
  const bg = tokens(t).base.bg;
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    mode !== 'edit' ? `<meta name="generator" content="${GENERATOR}">` : '',
    `<title>${esc(pageTitle)}</title>`,
    desc ? `<meta name="description" content="${esc(desc)}">` : '',
    url && mode === 'zip' ? `<link rel="canonical" href="${esc(`${url}/${here.path}`)}">` : '',
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${esc(site.name)}">`,
    `<meta property="og:title" content="${esc(pageTitle)}">`,
    desc ? `<meta property="og:description" content="${esc(desc)}">` : '',
    mode !== 'edit' && og ? `<meta property="og:image" content="${esc(og)}">` : '',
    mode !== 'edit' && og ? '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' : '',
    url && mode === 'zip' ? `<meta property="og:url" content="${esc(`${url}/${here.path}`)}">` : '',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="theme-color" content="${bg}">`,
    mode === 'zip' ? `<link rel="icon" href="${prefix}favicon.svg" type="image/svg+xml">` : opts.faviconHref ? `<link rel="icon" href="${esc(opts.faviconHref)}" type="image/svg+xml">` : '',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${esc(fontsHref(t))}" id="mz-fonts">`,
    `<style id="mz-theme">${themeCss(t)}</style>`,
    mode === 'zip' ? `<link rel="stylesheet" href="${prefix}assets/style.css">` : `<style id="mz-base">${BASE_CSS}</style>`,
    mode === 'edit' ? `<style id="mz-edit">${EDIT_CSS}</style>` : HEAD_BOOT,
    mode !== 'edit' ? jsonLd(site, here, url) : '',
  ].filter(Boolean).join('\n');
  return { htmlAttrs, head, body, title: pageTitle, c };
}

const attrs = (o) => Object.entries(o).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');

/** One complete page (zip and edit modes). */
export function renderPage(site, here, opts = {}) {
  const p = renderParts(site, here, opts);
  const script = opts.mode === 'zip' ? `<script src="${'../'.repeat(here.depth)}assets/site.js" defer></script>` : `<script>${SITE_JS}</script>`;
  const cls = opts.mode === 'edit' ? ' class="editing"' : '';
  return `<!doctype html>\n<html${attrs(p.htmlAttrs)}${cls}>\n<head>\n${p.head}\n</head>\n<body>\n${p.body}\n${opts.mode === 'edit' ? '' : script}\n</body>\n</html>\n`;
}

/** The whole site in one HTML file: every page in a [data-page] block, a hash router, everything inline. */
export function renderSingle(site, opts = {}) {
  const pages = sitePages(site);
  let head = '';
  let htmlAttrs = null;
  const blocks = pages.map((here, i) => {
    const p = renderParts(site, here, { ...opts, mode: 'single' });
    if (i === 0) { head = p.head; htmlAttrs = p.htmlAttrs; }
    return `<div data-page="${esc(here.key)}" data-title="${esc(p.title)}"${i ? ' hidden' : ''}>${p.body}</div>`;
  }).join('\n');
  return `<!doctype html>\n<html${attrs(htmlAttrs)}>\n<head>\n${head}\n</head>\n<body>\n${blocks}\n<script>${ROUTER_JS}</script>\n<script>${SITE_JS}</script>\n</body>\n</html>\n`;
}
