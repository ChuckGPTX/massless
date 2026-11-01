// Whole documents: <head> with SEO and fonts, the header and mobile menu, the sections, the footer and a
// tiny runtime (scroll reveal, click-to-load embeds, the music player, mailto forms). Three modes:
//   edit   - the editor preview (data-edit hooks, editor overlay CSS, links stay as written)
//   zip    - one index.html per page, relative links and assets, shared assets/style.css and site.js
//   single - every page in one file, a hash router, everything inline

import { BASE_CSS, EDIT_CSS } from './css.js';
import { themeCss, fontsHref, tokens } from './theme.js';
import { renderSection, renderItemPage, esc } from './sections.js';
import { SECTIONS, COLLECTIONS } from './spec.js';

/** The runtime every exported page loads (about 4 KB): reveal, scroll scrub, the case-study rail, the ambient canvas. Kept as a string so it can be inlined or saved. */
export const SITE_JS = `(function(){var d=document,de=d.documentElement;
if(de.classList.contains('rv')&&'IntersectionObserver'in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{rootMargin:'0px 0px -6% 0px',threshold:.06});d.querySelectorAll('[data-rv]').forEach(function(el){io.observe(el)})}
var audio,cur;function set(b,on){b.setAttribute('aria-pressed',on?'true':'false')}
function prog(){var t=cur&&cur.closest('.track'),bar=t&&t.querySelector('.tbar i');if(bar&&audio.duration)bar.style.width=(audio.currentTime/audio.duration*100)+'%'}
function play(b){if(!audio){audio=new Audio();audio.addEventListener('timeupdate',prog);audio.addEventListener('ended',function(){set(cur,false);var all=[].slice.call(d.querySelectorAll('.tplay')),n=all[all.indexOf(cur)+1];if(n)play(n)})}
if(cur===b){if(audio.paused){audio.play();set(b,true)}else{audio.pause();set(b,false)}return}
if(cur)set(cur,false);cur=b;audio.src=b.getAttribute('data-audio');audio.play().catch(function(){});set(b,true)}
d.addEventListener('click',function(e){var t=e.target;if(!t.closest)return;var b=t.closest('[data-embed]');
if(b){var f=d.createElement('iframe');f.src=b.getAttribute('data-embed');f.title=b.getAttribute('data-title')||'Embedded content';f.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';f.setAttribute('allowfullscreen','');b.replaceWith(f);return}
var p=t.closest('.tplay');if(p){e.preventDefault();play(p)}
var m=t.closest('.menu-panel a');if(m){var det=m.closest('details');if(det)det.open=false}});
d.querySelectorAll('form[data-mailto]').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var l=[];new FormData(f).forEach(function(v,k){l.push(k+': '+v)});location.href='mailto:'+f.getAttribute('data-mailto')+'?subject='+encodeURIComponent(f.getAttribute('data-subject')||'Website message')+'&body='+encodeURIComponent(l.join('\\n'))})});
d.querySelectorAll('form[data-unconnected]').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var n=f.querySelector('.form-note');if(n){n.textContent='This form is not connected yet.';n.removeAttribute('hidden')}})});
var rv=de.classList.contains('rv'),wide=matchMedia('(min-width: 900px)'),rails=[].slice.call(d.querySelectorAll('[data-rail]')),scr=[].slice.call(d.querySelectorAll('[data-scrub]')),busy=0;
function lay(){var on=rv&&wide.matches;rails.forEach(function(r){var tr=r.querySelector('.rail-track');r.classList.toggle('on',on);if(!on){r.style.height='';tr.style.transform='';return}r._d=Math.max(0,tr.scrollWidth-innerWidth);r.style.height=(innerHeight+r._d)+'px'});scr.forEach(function(e){if(e.classList.contains('ann'))e.classList.toggle('on',on)});tick()}
function tick(){busy=0;var vh=innerHeight;rails.forEach(function(r){if(!r.classList.contains('on'))return;var b=r.getBoundingClientRect(),p=Math.min(1,Math.max(0,-b.top/(r._d||1))),tr=r.querySelector('.rail-track'),y=r.querySelector('[data-year-out]'),cur;tr.style.transform='translate3d('+(-p*r._d).toFixed(1)+'px,0,0)';var tx=innerWidth*(.2+.6*p),bd=1e9;[].forEach.call(tr.children,function(li){var q=li.getBoundingClientRect(),dd=Math.abs(q.left+q.width/2-tx);if(dd<bd){bd=dd;cur=li}});if(y&&cur&&y.textContent!==cur.getAttribute('data-year'))y.textContent=cur.getAttribute('data-year')});
scr.forEach(function(e){var b=e.getBoundingClientRect(),p=e.classList.contains('on')?-b.top/Math.max(1,b.height-vh):(vh*.92-b.top)/(b.height*.55+vh*.45);e.style.setProperty('--p',Math.min(1,Math.max(0,p)).toFixed(3))})}
if(rv&&(rails.length||scr.length)){addEventListener('scroll',function(){if(!busy){busy=1;requestAnimationFrame(tick)}},{passive:true});addEventListener('resize',lay);if(wide.addEventListener)wide.addEventListener('change',lay);addEventListener('load',lay);lay()}
d.querySelectorAll('canvas[data-gen]').forEach(function(cv){var g=cv.getContext&&cv.getContext('2d');if(!g)return;var box=cv.parentNode,col=getComputedStyle(box).color,W,H,t=Math.random()*90,vis=1,run=rv&&matchMedia('(prefers-reduced-motion: no-preference)').matches,dpr=Math.min(2,window.devicePixelRatio||1);
function size(){W=cv.clientWidth;H=cv.clientHeight;cv.width=W*dpr;cv.height=H*dpr;g.setTransform(dpr,0,0,dpr,0,0);if(!run)draw()}
function draw(){g.clearRect(0,0,W,H);g.strokeStyle=col;g.lineWidth=1;var n=24,cx=W/2,sp=W*.3;for(var k=0;k<n;k++){var y0=H*.52+(k-n/2)*H*.034;g.beginPath();for(var x=-10;x<=W+10;x+=7){var e=Math.exp(-Math.pow((x-cx)/sp,2)),y=y0-e*(H*.07+k*H*.005)*Math.sin(k*.33+x/(W*.17)+t*(.55+k*.015))-e*H*.035*Math.sin(t*.4+k*.21);if(x<0)g.moveTo(x,y);else g.lineTo(x,y)}g.globalAlpha=.08+.42*Math.exp(-Math.pow((k-n/2)/(n/3.2),2));g.stroke()}g.globalAlpha=1}
size();box.classList.add('live');addEventListener('resize',size);if(!run)return;
if('IntersectionObserver'in window)new IntersectionObserver(function(es){vis=es[0].isIntersecting}).observe(cv);
(function loop(){if(vis&&!d.hidden){t+=.0055;draw()}requestAnimationFrame(loop)})()});
if(location.protocol==='file:')d.querySelectorAll('a[href]').forEach(function(a){var h=a.getAttribute('href');if(!/^[a-z][\\w+.-]*:|^#|^\\/\\//i.test(h)&&/\\/(#.*)?$/.test(h))a.setAttribute('href',h.replace(/\\/(#.*)?$/,'/index.html$1'))});
})();`;

/** The single-file router: #/slug shows a page, #/slug:anchor scrolls to a section on it. */
const ROUTER_JS = `(function(){var d=document,pages=[].slice.call(d.querySelectorAll('[data-page]'));
function show(){var h=decodeURIComponent(location.hash.slice(1)),path=null,anchor='';if(h.charAt(0)==='/'){var i=h.indexOf(':');path=i<0?h.slice(1):h.slice(1,i);anchor=i<0?'':h.slice(i+1)}else anchor=h;
var vis=pages.filter(function(p){return !p.hidden})[0];
if(path!==null){var hit=pages.filter(function(p){return p.getAttribute('data-page')===path})[0]||pages[0];pages.forEach(function(p){p.hidden=p!==hit});vis=hit;d.title=hit.getAttribute('data-title')||d.title;if(!anchor)window.scrollTo(0,0)}
if(anchor&&vis){var el=vis.querySelector('#'+anchor.replace(/[^\\w-]/g,''));if(el)el.scrollIntoView()}}
addEventListener('hashchange',show);show()})();`;

const HEAD_BOOT = `<script>(function(d){var m=d.dataset.motion;if(m!=='none'&&'IntersectionObserver'in window&&matchMedia('(prefers-reduced-motion: no-preference)').matches)d.classList.add('rv')})(document.documentElement)</script>`;

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
  const secs = site.pages[0].sections.filter((s) => s.anchor && want.includes(s.type) && !s.hidden);
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
    motion: site.theme.motion !== 'none' && opts.mode !== 'edit',
    h1: { used: false },
    here,
    src: (src) => (opts.src ? opts.src(src, here) : /^\/media\//.test(src) ? src : ''),
    imgInfo: (src) => (opts.imgInfo ? opts.imgInfo(src) : null),
    srcset: opts.srcset ? (src) => opts.srcset(src, here) : null,
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
