// Section renderers: each turns one section of the spec into semantic, static HTML. The same code renders the
// editor preview (with data-edit / data-img hooks) and the exported site (without them).

import { icon } from './icons.js';
import { SECTIONS, COLLECTIONS, embedFor, safeEmail } from './spec.js';
import { placeholderArt, motifSvg, ambientSvg } from './art.js';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline text: escaped, *words* become <em>, and [placeholders] are marked in the editor. */
export function inline(s, c) {
  let h = esc(s).replace(/\*([^*\n]{1,90})\*/g, '<em>$1</em>');
  if (c?.edit) h = h.replace(/\[([^\]\n]{1,60})\]/g, '<span class="mz-ph">[$1]</span>');
  return h.replace(/\n/g, '<br>');
}
/** Paragraphs from text with blank lines between them. */
export function paras(s, c) {
  return String(s ?? '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${inline(p, c)}</p>`).join('');
}
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const ARROW = '<svg class="arr" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12h15M13 6l6 6-6 6"/></svg>';
const LABELS = { eyebrow: 'Add a label', title: 'Add a title', subtitle: 'Add an intro', text: 'Add text', note: 'Add small print', caption: 'Add a caption', tagline: 'Add a tagline', hours: 'Add opening hours', quote: 'Add a quote', bio: 'Add a short bio', role: 'Add a role', a: 'Add an answer', q: 'Add a question' };

/** An editable piece of text. path is "<sectionId>:<key>" (or "@col:id:key", "$:key"). */
function T(c, obj, key, path, tag = 'p', cls = '', o = {}) {
  const v = obj?.[key] ?? '';
  if (!String(v).trim() && !c.edit) return '';
  const empty = !String(v).trim();
  const attrs = c.edit ? ` data-edit="${esc(path)}"${o.ml ? ' data-ml=""' : ''}${empty ? ` data-empty="" data-ph="${esc(o.ph || LABELS[key] || 'Add text')}"` : ''}` : '';
  const body = o.ml === 'p' ? paras(v, c) : inline(v, c);
  return `<${tag}${cls ? ` class="${cls}"` : ''}${attrs}>${body}</${tag}>`;
}
/** A heading: the first hero title on a page is the only h1. */
function H(c, obj, key, path, level, cls = '') {
  let tag = `h${level}`;
  if (level === 1) { if (c.h1.used) tag = 'h2'; c.h1.used = true; }
  return T(c, obj, key, path, tag, cls);
}
const P = (s, key) => `${s.id}:${key}`;
const PI = (s, list, i, key) => `${s.id}:${list}.${i}.${key}`;

function btn(c, l, path, cls = 'btn') {
  if (!l || !String(l.label || '').trim()) return '';
  const e = c.edit ? ` data-edit="${esc(path)}.label"` : '';
  return `<a class="${cls}" href="${esc(c.href(l.href || '#'))}"><span${e}>${inline(l.label, c)}</span>${cls.includes('alt') || cls.includes('link') ? '' : ARROW}</a>`;
}
function actions(c, s, a = 'cta', b = 'cta2', extra = '') {
  const h = btn(c, s[a], P(s, a)) + btn(c, s[b], P(s, b), 'btn alt');
  return h ? `<div class="actions${extra}">${h}</div>` : '';
}

const ratioOf = (ar) => { const m = String(ar || '').match(/^([\d.]+)\s*\/\s*([\d.]+)$/); return m ? +m[1] / +m[2] : 0; };

/** An image slot as a framed media box. Empty slots get generated art that follows the suggested photo (decorative). */
function media(c, slot, path, o = {}) {
  const ar = o.ar ? ` style="aspect-ratio:${o.ar}"` : '';
  const cls = `media${o.cls ? ` ${o.cls}` : ''}`;
  const url = slot && slot.src ? c.src(slot.src) : '';
  const hook = c.edit ? ` data-img="${esc(path)}"` : '';
  if (!url) {
    const v = hash(path) % 5;
    const art = placeholderArt(slot?.prompt || slot?.alt || '', path, o.ratio || ratioOf(o.ar) || 1.6, o.art);
    const cta = c.edit ? `<span class="mz-ph-img">${icon('camera', 'mz-ic')}<b>Add image</b></span>` : '';
    return `<div class="${cls}"${ar}><div class="ph ph-${v}" aria-hidden="true"${hook}>${art}${cta}</div></div>`;
  }
  const info = c.imgInfo(slot.src) || {};
  const srcset = c.srcset ? c.srcset(slot.src) : '';
  const sizes = srcset && o.sizes ? ` sizes="${o.sizes}"` : '';
  const alt = slot.decorative ? '' : slot.alt || '';
  const focus = Number.isFinite(info.focalX) ? ` style="object-position:${Math.max(0, Math.min(100, info.focalX))}% 50%"` : '';
  const load = o.eager ? ' fetchpriority="high"' : ' loading="lazy"';
  return `<div class="${cls}"${ar}><img src="${esc(url)}"${srcset ? ` srcset="${esc(srcset)}"${sizes}` : ''} alt="${esc(alt)}" width="${info.w || 1600}" height="${info.h || 1067}"${load} decoding="async"${focus}${hook}></div>`;
}
const hasImg = (slot) => !!(slot && (slot.src || slot.prompt));

function head(c, s, o = {}) {
  const has = s.eyebrow || s.title || s.subtitle;
  if (!has && !c.edit) return '';
  return `<div class="sec-head${o.center ? ' center' : ''}${has ? '' : ' mz-only'}">${T(c, s, 'eyebrow', P(s, 'eyebrow'), 'p', 'eyebrow')}${H(c, s, 'title', P(s, 'title'), 2, 'h2')}${'subtitle' in s ? T(c, s, 'subtitle', P(s, 'subtitle'), 'p', 'lead') : ''}</div>`;
}
const rv = (c, i = 0) => (c.motion ? ` data-rv style="--i:${i}"` : '');
function phAttr(c, it) { return it.ph ? ` data-ph-item=""` : ''; }

const R = {};

// ---------------------------------------------------------------------------------------------
R.hero = (s, c) => {
  const v = s.variant;
  const eb = T(c, s, 'eyebrow', P(s, 'eyebrow'), 'p', 'eyebrow');
  const note = s.note || c.edit ? `<p class="note"${c.edit ? ` data-edit="${P(s, 'note')}"${s.note ? '' : ' data-empty="" data-ph="Add small print"'}` : ''}>${s.note ? icon('check') + inline(s.note, c) : ''}</p>` : '';
  if (v === 'banner') {
    return `<div class="wrap hero-in">${eb}${H(c, s, 'title', P(s, 'title'), 1, 'h1 h1-sm')}${T(c, s, 'subtitle', P(s, 'subtitle'), 'p', 'lead')}${actions(c, s)}</div>`;
  }
  const par = c.motion ? ' data-scrub="par"' : '';
  if (v === 'runway') {
    const chip = s.note || c.edit ? `<p class="chip-note"${c.edit ? ` data-edit="${P(s, 'note')}"${s.note ? '' : ' data-empty="" data-ph="Add small print"'}` : ''}>${inline(s.note, c)}</p>` : '';
    return `<div class="runway"><div class="runway-copy">${eb}${H(c, s, 'title', P(s, 'title'), 1, 'h1 runway-t')}${T(c, s, 'subtitle', P(s, 'subtitle'), 'p', 'lead')}${actions(c, s)}${chip}</div><div class="runway-media"${par}>${media(c, s.image, P(s, 'image'), { ar: '4/5', eager: true, sizes: '(max-width: 900px) 100vw, 60vw', cls: 'runway-img' })}</div></div>`;
  }
  if (v === 'minimal') {
    const links = [btn(c, s.cta, P(s, 'cta'), 'mlink'), btn(c, s.cta2, P(s, 'cta2'), 'mlink')].join('');
    return `<div class="wrap min-grid"><div class="min-main">${H(c, s, 'title', P(s, 'title'), 1, 'h1 min-t')}${T(c, s, 'subtitle', P(s, 'subtitle'), 'p', 'min-sub')}</div><div class="min-side">${eb}${links ? `<p class="min-links">${links}</p>` : ''}</div></div>`;
  }
  if (v === 'editorial') {
    return `<div class="wrap hero-in">${eb}${H(c, s, 'title', P(s, 'title'), 1, 'h1 h1-xl')}<div class="ed-row">${T(c, s, 'subtitle', P(s, 'subtitle'), 'p', 'lead')}<div>${actions(c, s)}${note}</div></div>${hasImg(s.image) || c.edit ? media(c, s.image, P(s, 'image'), { ar: '21/9', eager: true, sizes: '100vw', cls: 'ed-media' }) : ''}</div>`;
  }
  const copy = `${eb}${H(c, s, 'title', P(s, 'title'), 1, 'h1')}${T(c, s, 'subtitle', P(s, 'subtitle'), 'p', 'lead')}${actions(c, s)}${note}`;
  if (v === 'cover') {
    return `<div class="cover-media"${par}>${media(c, s.image, P(s, 'image'), { eager: true, sizes: '100vw' })}</div><div class="cover-shade" aria-hidden="true"></div><div class="wrap hero-in">${copy}</div>`;
  }
  if (v === 'centered') {
    const m = hasImg(s.image) || c.edit ? `<div class="hero-shot">${media(c, s.image, P(s, 'image'), { ar: '16/9', eager: true, sizes: '(max-width: 1240px) 100vw, 1200px' })}</div>` : '';
    return `<div class="hero-glow" aria-hidden="true"></div><div class="wrap hero-in center">${copy}</div>${m ? `<div class="wrap">${m}</div>` : ''}`;
  }
  if (v === 'portrait') {
    return `<div class="wrap hero-in center">${copy}</div><div class="portrait-stage"${par}>${media(c, s.image, P(s, 'image'), { ar: '4/5', eager: true, sizes: '(max-width: 700px) 100vw, 680px', cls: 'portrait-media' })}</div>`;
  }
  if (v === 'ambient') {
    const photo = s.image?.src ? `<div class="amb-photo"${par}>${media(c, s.image, P(s, 'image'), { ratio: 16 / 9, eager: true, sizes: '100vw', cls: 'amb-media' })}</div>` : '';
    return `<div class="gen" aria-hidden="true">${photo}${ambientSvg(s.id)}<canvas data-gen></canvas></div><div class="wrap hero-in center">${copy}</div><p class="scroll-cue" aria-hidden="true"><span></span>Scroll</p>`;
  }
  return `<div class="wrap hero-grid"><div class="hero-in">${copy}</div><div class="hero-art"${par}>${media(c, s.image, P(s, 'image'), { ar: '4/5', eager: true, sizes: '(max-width: 900px) 100vw, 50vw' })}<span class="hero-blob" aria-hidden="true"></span></div></div>`;
};

R.logos = (s, c) => {
  const items = s.items.map((it, i) => `<li${phAttr(c, it)}>${T(c, it, 'name', PI(s, 'items', i, 'name'), 'span')}</li>`).join('');
  const t = T(c, s, 'title', P(s, 'title'), 'p', 'logos-title');
  if (s.variant === 'marquee') {
    const dup = s.items.map((it) => `<li>${inline(it.name)}</li>`).join('');
    return `<div class="wrap">${t}</div><div class="marquee"><div class="marquee-track"><ul class="logos">${items}</ul><ul class="logos" aria-hidden="true">${dup}</ul></div></div>`;
  }
  return `<div class="wrap">${t}<ul class="logos">${items}</ul></div>`;
};

R.features = (s, c) => {
  const v = s.variant;
  const items = s.items;
  if (v === 'rows') {
    const rows = items.map((it, i) => `<article class="frow"${rv(c, 0)}>${media(c, it.image, PI(s, 'items', i, 'image'), { ar: '4/3', sizes: '(max-width: 900px) 100vw, 50vw' })}<div class="frow-copy"><span class="num">${String(i + 1).padStart(2, '0')}</span>${T(c, it, 'title', PI(s, 'items', i, 'title'), 'h3', 'h3 lg')}${T(c, it, 'text', PI(s, 'items', i, 'text'), 'p', 'body-l')}</div></article>`).join('');
    return `<div class="wrap">${head(c, s)}<div class="frows">${rows}</div></div>`;
  }
  if (v === 'bento') {
    // spans across three columns: 2+1, 1+2, ... and the last cell fills its row
    const spans = [];
    let col = 0;
    items.forEach((_, i) => { let sp = [2, 1, 1, 2][i % 4]; if (col + sp > 3) sp = 3 - col; spans.push(sp); col = (col + sp) % 3; });
    if (col !== 0) spans[spans.length - 1] += 3 - col;
    const cells = items.map((it, i) => {
      const wide = spans[i] >= 2;
      return `<article class="bento-cell${spans[i] === 3 ? ' full' : wide ? ' wide' : ''}"${rv(c, i)}>${wide ? media(c, it.image, PI(s, 'items', i, 'image'), { ar: '16/9', sizes: '(max-width: 900px) 100vw, 66vw' }) : `<span class="ibadge">${icon(it.icon)}</span>`}<div class="bento-copy">${T(c, it, 'title', PI(s, 'items', i, 'title'), 'h3', 'h3')}${T(c, it, 'text', PI(s, 'items', i, 'text'), 'p', 'muted')}</div></article>`;
    }).join('');
    return `<div class="wrap">${head(c, s)}<div class="bento">${cells}</div></div>`;
  }
  const cls = v === 'icons' ? 'ficons' : 'fcards';
  const cells = items.map((it, i) => `<article class="${v === 'icons' ? 'fic' : 'card fcard'}"${rv(c, i)}><span class="ibadge">${icon(it.icon)}</span>${T(c, it, 'title', PI(s, 'items', i, 'title'), 'h3', 'h3')}${T(c, it, 'text', PI(s, 'items', i, 'text'), 'p', 'muted')}</article>`).join('');
  return `<div class="wrap">${head(c, s)}<div class="${cls} n${Math.min(items.length, 4)}">${cells}</div></div>`;
};

R.about = (s, c) => {
  const pts = s.points.length || c.edit ? `<ul class="checks">${s.points.map((p, i) => `<li${phAttr(c, p)}>${icon('check')}${T(c, p, 'text', PI(s, 'points', i, 'text'), 'span')}</li>`).join('')}</ul>` : '';
  const copy = `${T(c, s, 'eyebrow', P(s, 'eyebrow'), 'p', 'eyebrow')}${H(c, s, 'title', P(s, 'title'), 2, 'h2')}${T(c, s, 'text', P(s, 'text'), 'div', 'prose', { ml: 'p' })}${s.points.length ? pts : ''}${actions(c, s, 'cta', 'none')}`;
  if (s.variant === 'centered') {
    return `<div class="wrap narrow center">${copy}</div>${hasImg(s.image) ? `<div class="wrap">${media(c, s.image, P(s, 'image'), { ar: '21/9', sizes: '100vw', cls: 'about-wide' })}</div>` : ''}`;
  }
  return `<div class="wrap split">${media(c, s.image, P(s, 'image'), { ar: '4/5', sizes: '(max-width: 900px) 100vw, 50vw', cls: 'about-media' })}<div class="split-copy"${rv(c)}>${copy}</div></div>`;
};

R.gallery = (s, c) => {
  const v = s.variant;
  const ars = ['4/5', '1/1', '3/4', '4/3', '4/5', '1/1', '3/4', '5/4'];
  const figs = s.items.map((it, i) => {
    const ar = v === 'masonry' ? ars[i % ars.length] : v === 'strip' ? '3/4' : '4/3';
    const cap = it.caption || c.edit ? `<figcaption>${T(c, it, 'caption', PI(s, 'items', i, 'caption'), 'span')}</figcaption>` : '';
    return `<figure${rv(c, i % 4)}>${media(c, it.image, PI(s, 'items', i, 'image'), { ar, sizes: v === 'strip' ? '420px' : '(max-width: 700px) 100vw, 33vw' })}${cap}</figure>`;
  }).join('');
  if (v === 'strip') return `<div class="wrap">${head(c, s)}</div><div class="strip" tabindex="0" role="region" aria-label="${esc(String(s.title || 'Gallery').replace(/\*/g, ''))}">${figs}</div>`;
  return `<div class="wrap">${head(c, s)}<div class="gal-${v}">${figs}</div></div>`;
};

R.testimonials = (s, c) => {
  const initials = (n) => String(n || '?').replace(/\[|\]/g, '').split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();
  const fig = (it, i, big) => `<figure class="quote${big ? ' big' : ' card'}${it.ph ? ' is-ph' : ''}"${rv(c, i)}>${it.ph ? '<span class="ph-tag">Placeholder</span>' : ''}${big ? '' : '<span class="qmark" aria-hidden="true">“</span>'}<blockquote>${T(c, it, 'quote', PI(s, 'items', i, 'quote'), 'p')}</blockquote><figcaption><span class="avatar" aria-hidden="true">${esc(initials(it.name))}</span><span>${T(c, it, 'name', PI(s, 'items', i, 'name'), 'b')}${T(c, it, 'role', PI(s, 'items', i, 'role'), 'small')}</span></figcaption></figure>`;
  if (s.variant === 'single') {
    const it = s.items[0];
    return `<div class="wrap narrow center">${head(c, s, { center: true })}${it ? fig(it, 0, true) : ''}</div>`;
  }
  return `<div class="wrap">${head(c, s)}<div class="quotes n${Math.min(s.items.length, 3)}">${s.items.map((it, i) => fig(it, i)).join('')}</div></div>`;
};

R.pricing = (s, c) => {
  if (s.variant === 'list') {
    const rows = s.items.map((it, i) => `<li class="prow"${phAttr(c, it)}${rv(c, i)}><div>${T(c, it, 'name', PI(s, 'items', i, 'name'), 'h3', 'h3')}${T(c, it, 'text', PI(s, 'items', i, 'text'), 'p', 'muted')}</div><span class="leader" aria-hidden="true"></span><p class="prow-price">${T(c, it, 'price', PI(s, 'items', i, 'price'), 'span')}${T(c, it, 'period', PI(s, 'items', i, 'period'), 'small')}</p></li>`).join('');
    return `<div class="wrap narrow">${head(c, s, { center: true })}<ul class="plist">${rows}</ul>${T(c, s, 'note', P(s, 'note'), 'p', 'fine center')}</div>`;
  }
  const cards = s.items.map((it, i) => {
    const feats = String(it.features || '').split('\n').filter(Boolean);
    return `<article class="tier card${it.featured ? ' featured' : ''}"${phAttr(c, it)}${rv(c, i)}>${it.featured ? '<span class="tier-badge">Recommended</span>' : ''}${T(c, it, 'name', PI(s, 'items', i, 'name'), 'h3', 'h3')}<p class="price">${T(c, it, 'price', PI(s, 'items', i, 'price'), 'span', 'amount')}${T(c, it, 'period', PI(s, 'items', i, 'period'), 'span', 'per')}</p>${T(c, it, 'text', PI(s, 'items', i, 'text'), 'p', 'muted')}${feats.length ? `<ul class="checks sm">${feats.map((f) => `<li>${icon('check')}<span>${inline(f, c)}</span></li>`).join('')}</ul>` : ''}${btn(c, it.cta, PI(s, 'items', i, 'cta'), it.featured ? 'btn wide' : 'btn alt wide')}</article>`;
  }).join('');
  return `<div class="wrap">${head(c, s, { center: true })}<div class="tiers n${Math.min(s.items.length, 4)}">${cards}</div>${T(c, s, 'note', P(s, 'note'), 'p', 'fine center')}</div>`;
};

R.faq = (s, c) => {
  if (s.variant === 'columns') {
    const items = s.items.map((it, i) => `<div class="qa"${rv(c, i % 2)}>${T(c, it, 'q', PI(s, 'items', i, 'q'), 'h3', 'h3')}${T(c, it, 'a', PI(s, 'items', i, 'a'), 'div', 'prose muted', { ml: 'p' })}</div>`).join('');
    return `<div class="wrap">${head(c, s)}<div class="qa-grid">${items}</div></div>`;
  }
  const items = s.items.map((it, i) => `<details class="faq-item"${i === 0 && c.edit ? ' open' : ''}><summary>${T(c, it, 'q', PI(s, 'items', i, 'q'), 'span')}<span class="pm" aria-hidden="true"></span></summary>${T(c, it, 'a', PI(s, 'items', i, 'a'), 'div', 'prose muted', { ml: 'p' })}</details>`).join('');
  const hd = head(c, s);
  return `<div class="wrap${s.eyebrow || s.title || s.subtitle ? ' faq-wrap' : ' narrow'}">${hd}<div class="faq">${items}</div></div>`;
};

R.team = (s, c) => {
  if (s.variant === 'list') {
    const rows = s.items.map((it, i) => `<li class="person-row"${phAttr(c, it)}${rv(c, i)}>${media(c, it.image, PI(s, 'items', i, 'image'), { ar: '1/1', sizes: '120px', cls: 'round' })}<div>${T(c, it, 'name', PI(s, 'items', i, 'name'), 'h3', 'h3')}${T(c, it, 'role', PI(s, 'items', i, 'role'), 'p', 'role')}${T(c, it, 'bio', PI(s, 'items', i, 'bio'), 'p', 'muted')}</div></li>`).join('');
    return `<div class="wrap narrow">${head(c, s)}<ul class="people-list">${rows}</ul></div>`;
  }
  const cards = s.items.map((it, i) => `<article class="person"${phAttr(c, it)}${rv(c, i)}>${media(c, it.image, PI(s, 'items', i, 'image'), { ar: '4/5', sizes: '(max-width: 700px) 50vw, 25vw' })}${T(c, it, 'name', PI(s, 'items', i, 'name'), 'h3', 'h3')}${T(c, it, 'role', PI(s, 'items', i, 'role'), 'p', 'role')}${T(c, it, 'bio', PI(s, 'items', i, 'bio'), 'p', 'muted sm')}</article>`).join('');
  return `<div class="wrap">${head(c, s)}<div class="people n${Math.min(s.items.length, 4)}">${cards}</div></div>`;
};

R.timeline = (s, c) => {
  if (s.variant === 'vertical') {
    const items = s.items.map((it, i) => `<li${rv(c, 0)}>${T(c, it, 'date', PI(s, 'items', i, 'date'), 'p', 'tl-date')}<div>${T(c, it, 'title', PI(s, 'items', i, 'title'), 'h3', 'h3')}${T(c, it, 'text', PI(s, 'items', i, 'text'), 'p', 'muted')}</div></li>`).join('');
    return `<div class="wrap narrow">${head(c, s)}<ol class="tl">${items}</ol></div>`;
  }
  const items = s.items.map((it, i) => `<li class="step"${rv(c, i)}>${T(c, it, 'date', PI(s, 'items', i, 'date'), 'p', 'step-num')}${T(c, it, 'title', PI(s, 'items', i, 'title'), 'h3', 'h3')}${T(c, it, 'text', PI(s, 'items', i, 'text'), 'p', 'muted')}</li>`).join('');
  return `<div class="wrap">${head(c, s)}<ol class="steps n${Math.min(s.items.length, 4)}">${items}</ol></div>`;
};

R.stats = (s, c) => {
  const items = s.items.map((it, i) => `<div class="stat${s.variant === 'cards' ? ' card' : ''}"${phAttr(c, it)}${rv(c, i)}>${T(c, it, 'value', PI(s, 'items', i, 'value'), 'p', String(it.value || '').length > 7 ? 'stat-v long' : 'stat-v')}${T(c, it, 'label', PI(s, 'items', i, 'label'), 'p', 'stat-l')}</div>`).join('');
  return `<div class="wrap">${head(c, s)}<div class="stats n${Math.min(s.items.length, 4)}">${items}</div></div>`;
};

R.cta = (s, c) => {
  const body = `${H(c, s, 'title', P(s, 'title'), 2, 'h2 xl')}${T(c, s, 'text', P(s, 'text'), 'p', 'lead')}${actions(c, s, 'cta', 'cta2', ' center')}`;
  if (s.variant === 'card') return `<div class="wrap"><div class="cta-card"${rv(c)}><div class="cta-art ph ph-${hash(s.id) % 5}" aria-hidden="true"></div><div class="cta-in center">${body}</div></div></div>`;
  return `<div class="wrap narrow center"${rv(c)}>${body}</div>`;
};

/** Where a form posts: the site's form service URL, or the visitor's mail app (mailto:). */
function formAttrs(c, subject) {
  const form = c.site.contact?.form;
  const email = safeEmail(c.site.contact?.email);
  if (form) return ` action="${esc(form)}" method="post"`;
  if (email) return ` action="mailto:${esc(email)}" method="post" enctype="text/plain" data-mailto="${esc(email)}" data-subject="${esc(subject)}"`;
  return ' action="#" data-unconnected=""';
}

R.contact = (s, c) => {
  const ct = c.site.contact || {};
  const id = (k) => `f-${s.id}-${k}`;
  const list = [
    ct.email && `<li>${icon('mail')}<a href="mailto:${esc(ct.email)}">${esc(ct.email)}</a></li>`,
    ct.phone && `<li>${icon('phone')}<a href="tel:${esc(ct.phone.replace(/[^\d+]/g, ''))}">${esc(ct.phone)}</a></li>`,
    ct.address && `<li>${icon('pin')}<span>${esc(ct.address)}</span></li>`,
    (s.hours || c.edit) && `<li>${icon('clock')}${T(c, s, 'hours', P(s, 'hours'), 'span', '', { ph: 'Add opening hours' })}</li>`,
  ].filter(Boolean).join('');
  const unconnected = !ct.form && !safeEmail(ct.email);
  const form = `<form class="form card"${formAttrs(c, `Message from ${c.site.name || 'your website'}`)}>
<div class="field"><label for="${id('n')}">Name</label><input id="${id('n')}" name="name" autocomplete="name" required></div>
<div class="field"><label for="${id('e')}">Email</label><input id="${id('e')}" name="email" type="email" autocomplete="email" required></div>
<div class="field"><label for="${id('m')}">Message</label><textarea id="${id('m')}" name="message" rows="5" required></textarea></div>
<button class="btn wide" type="submit"><span${c.edit ? ` data-edit="${P(s, 'button')}"` : ''}>${inline(s.button || 'Send message', c)}</span>${ARROW}</button>
${unconnected ? `<p class="form-note" data-note="">${c.edit ? 'Not connected yet: add an email or a form URL in Settings.' : ''}</p>` : `<p class="form-note">${ct.form ? '' : 'Opens your email app with the message ready to send.'}</p>`}
</form>`;
  if (s.variant === 'centered') return `<div class="wrap narrow">${head(c, s, { center: true })}${T(c, s, 'text', P(s, 'text'), 'p', 'lead center')}${form}${list ? `<ul class="clist inline">${list}</ul>` : ''}</div>`;
  return `<div class="wrap split contact-split"><div class="split-copy">${T(c, s, 'eyebrow', P(s, 'eyebrow'), 'p', 'eyebrow')}${H(c, s, 'title', P(s, 'title'), 2, 'h2')}${T(c, s, 'text', P(s, 'text'), 'p', 'lead')}${list ? `<ul class="clist">${list}</ul>` : ''}</div>${form}</div>`;
};

R.signup = (s, c) => {
  const id = `f-${s.id}-e`;
  const form = `<form class="sform"${formAttrs(c, `Sign up from ${c.site.name || 'your website'}`)}><label class="sr-only" for="${id}">Email address</label><input id="${id}" name="email" type="email" autocomplete="email" placeholder="you@example.com" required><button class="btn" type="submit"><span${c.edit ? ` data-edit="${P(s, 'button')}"` : ''}>${inline(s.button || 'Sign up', c)}</span>${ARROW}</button></form>${T(c, s, 'note', P(s, 'note'), 'p', 'fine')}`;
  if (s.variant === 'card') return `<div class="wrap"><div class="signup-card card"${rv(c)}><div>${T(c, s, 'eyebrow', P(s, 'eyebrow'), 'p', 'eyebrow')}${H(c, s, 'title', P(s, 'title'), 2, 'h2')}${T(c, s, 'text', P(s, 'text'), 'p', 'lead')}</div><div>${form}</div></div></div>`;
  return `<div class="wrap narrow center"${rv(c)}>${T(c, s, 'eyebrow', P(s, 'eyebrow'), 'p', 'eyebrow')}${H(c, s, 'title', P(s, 'title'), 2, 'h2 xl')}${T(c, s, 'text', P(s, 'text'), 'p', 'lead')}${form}</div>`;
};

R.embed = (s, c) => {
  const e = embedFor(s.url);
  let box = '';
  if (e) {
    const label = e.kind === 'map' ? 'Load map' : e.kind === 'video' ? 'Play video' : 'Load player';
    const ic = e.kind === 'map' ? 'pin' : e.kind === 'video' ? 'play' : 'music';
    box = `<div class="embed embed-${e.kind}"><button class="embed-facade" type="button" data-embed="${esc(e.src)}" data-title="${esc(e.title)}"><span class="ph ph-${hash(s.id) % 5}" aria-hidden="true"></span><span class="facade-btn">${icon(ic)}<b>${label}</b></span>${e.label ? `<span class="facade-cap">${esc(e.label)}</span>` : ''}</button></div>`;
  } else if (c.edit) {
    box = '<div class="embed"><p class="mz-hint">Paste a YouTube, Vimeo, Spotify or SoundCloud link in the panel, or type map: and an address.</p></div>';
  }
  return `<div class="wrap${s.variant === 'contained' ? ' narrow' : ''}">${head(c, s, { center: s.variant === 'contained' })}${box}${T(c, s, 'caption', P(s, 'caption'), 'p', 'fine center')}</div>`;
};

const colItems = (c, key) => (c.site.collections?.[key] || []);
const CP = (col, it, key) => `@${col}:${it.id}:${key}`;
function emptyCol(c, key) {
  return c.edit ? `<p class="mz-hint">The ${COLLECTIONS[key].name} collection is empty. Add items in the Content tab.</p>` : '';
}

R.posts = (s, c) => {
  const items = colItems(c, 'posts');
  if (!items.length) return `<div class="wrap">${head(c, s)}${emptyCol(c, 'posts')}</div>`;
  if (s.variant === 'list') {
    const rows = items.map((it, i) => `<li${rv(c, 0)}><a class="post-row" href="${esc(c.itemHref('posts', it))}">${T(c, it, 'date', CP('posts', it, 'date'), 'span', 'date')}<span>${T(c, it, 'title', CP('posts', it, 'title'), 'span', 'h3')}${T(c, it, 'excerpt', CP('posts', it, 'excerpt'), 'span', 'muted')}</span>${ARROW}</a></li>`).join('');
    return `<div class="wrap narrow">${head(c, s)}<ul class="post-list">${rows}</ul></div>`;
  }
  const cards = items.map((it, i) => `<article class="post"${rv(c, i)}><a href="${esc(c.itemHref('posts', it))}">${media(c, it.image, CP('posts', it, 'image'), { ar: '16/10', sizes: '(max-width: 700px) 100vw, 33vw' })}${T(c, it, 'date', CP('posts', it, 'date'), 'p', 'date')}${T(c, it, 'title', CP('posts', it, 'title'), 'h3', 'h3')}${T(c, it, 'excerpt', CP('posts', it, 'excerpt'), 'p', 'muted')}<span class="more">Read ${ARROW}</span></a></article>`).join('');
  return `<div class="wrap">${head(c, s)}<div class="posts n${Math.min(items.length, 3)}">${cards}</div></div>`;
};

function facts(c, it, path, keys = ['beds', 'baths', 'sqft']) {
  const ic = { beds: 'bed', baths: 'bath', sqft: 'area', lot: 'leaf', year: 'calendar' };
  const lab = { beds: 'Beds', baths: 'Baths', sqft: 'Sq ft', lot: 'Lot', year: 'Built' };
  return keys.filter((k) => it[k] || c.edit).map((k) => `<li>${icon(ic[k])}<span>${T(c, it, k, path(k), 'b')}<small>${lab[k]}</small></span></li>`).join('');
}

R.listings = (s, c) => {
  const items = colItems(c, 'listings');
  if (!items.length) return `<div class="wrap">${head(c, s)}${emptyCol(c, 'listings')}</div>`;
  const cards = items.map((it, i) => `<article class="home-card${s.variant === 'rows' ? ' row' : ''}"${phAttr(c, it)}${rv(c, i)}><a href="${esc(c.itemHref('listings', it))}"><div class="home-media">${media(c, it.image, CP('listings', it, 'image'), { ar: '4/3', sizes: '(max-width: 700px) 100vw, 33vw' })}${it.status ? `<span class="pill">${esc(it.status)}</span>` : ''}</div><div class="home-copy">${T(c, it, 'price', CP('listings', it, 'price'), 'p', 'home-price')}${T(c, it, 'title', CP('listings', it, 'title'), 'h3', 'h3')}${T(c, it, 'address', CP('listings', it, 'address'), 'p', 'muted')}<ul class="facts sm">${facts(c, it, (k) => CP('listings', it, k))}</ul></div></a></article>`).join('');
  return `<div class="wrap">${head(c, s)}<div class="homes${s.variant === 'rows' ? ' rows' : ''} n${Math.min(items.length, 3)}">${cards}</div></div>`;
};

R.listing = (s, c) => {
  const ph = (i) => s.photos[i];
  const shot = (i, o) => (ph(i) ? media(c, ph(i).image, PI(s, 'photos', i, 'image'), o) : '');
  const factList = `<ul class="facts">${facts(c, s, (k) => P(s, k), ['beds', 'baths', 'sqft', 'lot', 'year'])}</ul>`;
  const pts = s.points.length ? `<h3 class="h3">Features</h3><ul class="checks cols">${s.points.map((p, i) => `<li>${icon('check')}${T(c, p, 'text', PI(s, 'points', i, 'text'), 'span')}</li>`).join('')}</ul>` : '';
  const ct = c.site.contact || {};
  const aside = `<aside class="card listing-aside">${T(c, s, 'status', P(s, 'status'), 'p', 'pill')}${T(c, s, 'price', P(s, 'price'), 'p', 'listing-price')}${T(c, s, 'address', P(s, 'address'), 'p', 'muted')}${btn(c, s.cta, P(s, 'cta'), 'btn wide')}${ct.phone ? `<a class="btn alt wide" href="tel:${esc(ct.phone.replace(/[^\d+]/g, ''))}">${icon('phone')}${esc(ct.phone)}</a>` : ''}${ct.email ? `<a class="btn alt wide" href="mailto:${esc(ct.email)}">${icon('mail')}Email</a>` : ''}</aside>`;
  const main = `<div class="listing-main">${factList}${T(c, s, 'text', P(s, 'text'), 'div', 'prose body-l', { ml: 'p' })}${pts}</div>`;
  if (s.variant === 'showcase') {
    const rest = s.photos.slice(1).map((p, k) => media(c, p.image, PI(s, 'photos', k + 1, 'image'), { ar: '4/3', sizes: '(max-width: 700px) 100vw, 33vw' })).join('');
    return `<div class="wrap">${shot(0, { ar: '21/9', sizes: '100vw', cls: 'listing-hero' })}<div class="listing-body">${main}${aside}</div>${rest ? `<div class="listing-more">${rest}</div>` : ''}</div>`;
  }
  const mosaic = `<div class="mosaic n${Math.min(s.photos.length, 5)}">${s.photos.slice(0, 5).map((p, i) => media(c, p.image, PI(s, 'photos', i, 'image'), { sizes: i ? '25vw' : '(max-width: 900px) 100vw, 50vw' })).join('')}</div>`;
  return `<div class="wrap">${mosaic}<div class="listing-body">${main}${aside}</div></div>`;
};

R.tracks = (s, c) => {
  const items = colItems(c, 'tracks');
  const list = items.length ? `<ol class="tracks">${items.map((it, i) => {
    const src = it.audio ? c.src(it.audio) : '';
    const play = src ? `<button class="tplay" type="button" data-audio="${esc(src)}" aria-label="Play ${esc(it.title)}">${icon('play', 'ic i-play')}${icon('pause', 'ic i-pause')}</button>` : `<span class="tnum">${String(i + 1).padStart(2, '0')}</span>`;
    const lnk = it.link ? `<a class="tlink" href="${esc(it.link)}">Listen</a>` : '';
    return `<li class="track"${phAttr(c, it)}>${play}<span class="tmeta">${T(c, it, 'title', CP('tracks', it, 'title'), 'b')}${it.note || c.edit ? T(c, it, 'note', CP('tracks', it, 'note'), 'small', 'muted') : ''}</span>${lnk}${T(c, it, 'length', CP('tracks', it, 'length'), 'span', 'tlen')}<span class="tbar" aria-hidden="true"><i></i></span></li>`;
  }).join('')}</ol>` : emptyCol(c, 'tracks');
  const cover = media(c, s.image, P(s, 'image'), { ar: '1/1', sizes: '(max-width: 900px) 100vw, 40vw', cls: 'cover-art' });
  if (s.variant === 'cover') return `<div class="wrap narrow center">${head(c, s, { center: true })}<div class="tracks-cover">${cover}</div>${list}</div>`;
  return `<div class="wrap split tracks-split">${cover}<div>${head(c, s)}${list}</div></div>`;
};

R.schedule = (s, c) => {
  const groups = [];
  s.items.forEach((it, i) => {
    const last = groups[groups.length - 1];
    if (last && last.day === it.day && s.variant !== 'list-flat') last.items.push([it, i]);
    else groups.push({ day: it.day, items: [[it, i]] });
  });
  const row = ([it, i]) => `<li class="slot"${phAttr(c, it)}>${T(c, it, 'time', PI(s, 'items', i, 'time'), 'span', 'slot-time')}<div class="slot-body">${T(c, it, 'title', PI(s, 'items', i, 'title'), 'h3', 'h3')}${T(c, it, 'text', PI(s, 'items', i, 'text'), 'p', 'muted')}</div>${btn(c, it.link, PI(s, 'items', i, 'link'), 'btn alt sm')}</li>`;
  const sameDayEverywhere = groups.length === s.items.length && s.items.every((x) => !x.day || /^\[.*\]$/.test(x.day));
  if (s.variant === 'columns') {
    return `<div class="wrap">${head(c, s)}<div class="days">${groups.map((g, k) => `<div class="day card"${rv(c, k)}>${g.day ? `<h3 class="day-h">${inline(g.day, c)}</h3>` : ''}<ul class="slots">${g.items.map(row).join('')}</ul></div>`).join('')}</div></div>`;
  }
  if (sameDayEverywhere) {
    // tour dates: the day sits in the time column
    const rows = s.items.map((it, i) => `<li class="slot"${phAttr(c, it)}>${T(c, it, 'day', PI(s, 'items', i, 'day'), 'span', 'slot-time')}<div class="slot-body">${T(c, it, 'title', PI(s, 'items', i, 'title'), 'h3', 'h3')}${T(c, it, 'text', PI(s, 'items', i, 'text'), 'p', 'muted')}</div>${btn(c, it.link, PI(s, 'items', i, 'link'), 'btn alt sm')}</li>`).join('');
    return `<div class="wrap narrow">${head(c, s)}<ul class="slots">${rows}</ul></div>`;
  }
  return `<div class="wrap narrow">${head(c, s)}${groups.map((g) => `${g.day ? `<h3 class="day-h">${inline(g.day, c)}</h3>` : ''}<ul class="slots">${g.items.map(row).join('')}</ul>`).join('')}</div>`;
};

R.menu = (s, c) => {
  const items = colItems(c, 'menu');
  if (!items.length) return `<div class="wrap">${head(c, s)}${emptyCol(c, 'menu')}</div>`;
  const cats = [];
  for (const it of items) {
    const k = it.category || 'Menu';
    let g = cats.find((x) => x.k === k);
    if (!g) cats.push((g = { k, items: [] }));
    g.items.push(it);
  }
  const block = (g, k) => `<div class="mcat"${rv(c, k)}><h3 class="mcat-h">${inline(g.k, c)}</h3><ul>${g.items.map((it) => `<li class="dish"${phAttr(c, it)}><p class="dish-top">${T(c, it, 'title', CP('menu', it, 'title'), 'b')}${it.price || c.edit ? '<span class="leader" aria-hidden="true"></span>' : ''}${T(c, it, 'price', CP('menu', it, 'price'), 'span', 'dish-price', { ph: 'Price' })}</p>${T(c, it, 'text', CP('menu', it, 'text'), 'p', 'muted')}</li>`).join('')}</ul></div>`;
  return `<div class="wrap${s.variant === 'list' ? ' narrow' : ''}">${head(c, s, { center: s.variant === 'list' })}<div class="menu ${s.variant}">${cats.map(block).join('')}</div></div>`;
};

// ---------------------------------------------------------------------------------------------
// Template sections: statement, lookbook, products, chapters, case studies, annotated image
// ---------------------------------------------------------------------------------------------

R.statement = (s, c) => {
  const v = s.variant;
  const eb = T(c, s, 'eyebrow', P(s, 'eyebrow'), 'p', 'eyebrow');
  if (v === 'framed') {
    const mark = s.mark || c.edit ? `<span class="stmt-mark"${c.edit ? ` data-edit="${P(s, 'mark')}"${s.mark ? '' : ' data-empty="" data-ph="Add a numeral"'}` : ' aria-hidden="true"'}>${esc(s.mark)}</span>` : '';
    return `<div class="wrap"><figure class="stmt-frame"${rv(c)}>${mark}<div class="stmt-body">${eb}<blockquote>${T(c, s, 'text', P(s, 'text'), 'p', 'stmt-q')}</blockquote>${s.note || c.edit ? `<figcaption>${T(c, s, 'note', P(s, 'note'), 'span', '', { ph: 'Add a name' })}</figcaption>` : ''}</div></figure></div>`;
  }
  let text;
  if (v === 'reveal' && !c.edit) {
    let i = 0;
    const html = inline(s.text, c).replace(/(<[^>]+>)|([^\s<]+)/g, (m, tag, w) => tag || `<span class="w" style="--k:${i++}">${w}</span>`);
    text = `<p class="stmt-t" style="--n:${i}">${html}</p>`;
  } else text = T(c, s, 'text', P(s, 'text'), 'p', 'stmt-t');
  const scrub = v === 'reveal' && c.motion ? ' data-scrub=""' : rv(c);
  return `<div class="wrap stmt${v === 'left' ? '' : ' center'}"${scrub}>${eb}${text}${T(c, s, 'note', P(s, 'note'), 'p', 'stmt-note')}</div>`;
};

R.lookbook = (s, c) => {
  const v = s.variant;
  const n = s.items.length;
  const pad = (k) => String(k).padStart(2, '0');
  const figs = s.items.map((it, i) => {
    const ar = v === 'full' ? '16/9' : v === 'pair' ? ['4/5', '3/4', '3/4', '4/5'][i % 4] : ['4/5', '3/4', '1/1'][i % 3];
    const cap = `<figcaption class="lb-cap"><span class="lb-n">${pad(i + 1)} / ${pad(n)}</span>${T(c, it, 'caption', PI(s, 'items', i, 'caption'), 'span', 'lb-t')}${T(c, it, 'note', PI(s, 'items', i, 'note'), 'span', 'lb-note', { ph: 'Add a note' })}</figcaption>`;
    return `<figure class="lb-item"${v === 'full' ? (c.motion ? ' data-scrub="par"' : '') : rv(c, i % 2)}>${media(c, it.image, PI(s, 'items', i, 'image'), { ar, sizes: v === 'full' ? '100vw' : '(max-width: 700px) 100vw, 50vw', cls: 'lb-media' })}${cap}</figure>`;
  }).join('');
  const hd = head(c, s);
  if (v === 'full') return `${hd ? `<div class="wrap">${hd}</div>` : ''}<div class="lb-full">${figs}</div>`;
  return `<div class="wrap">${hd}<div class="lb-${v}">${figs}</div></div>`;
};

R.products = (s, c) => {
  const v = s.variant;
  const n = s.items.length;
  const cards = s.items.map((it, i) => {
    const inner = `${media(c, it.image, PI(s, 'items', i, 'image'), { ar: v === 'lineup' ? '9/20' : '3/4', sizes: v === 'lineup' ? '200px' : '(max-width: 700px) 50vw, 25vw', cls: 'prod-media' })}<div class="prod-meta">${T(c, it, 'name', PI(s, 'items', i, 'name'), 'h3', 'prod-name')}${T(c, it, 'price', PI(s, 'items', i, 'price'), 'p', 'prod-price', { ph: 'Price' })}${T(c, it, 'note', PI(s, 'items', i, 'note'), 'p', 'prod-note', { ph: 'Colour or size' })}</div>`;
    const href = it.link?.href;
    return `<li class="prod"${phAttr(c, it)}${rv(c, i % 4)}>${href && !c.edit ? `<a class="prod-a" href="${esc(c.href(href))}">${inner}</a>` : inner}</li>`;
  }).join('');
  const has = s.eyebrow || s.title || s.subtitle;
  const count = `<p class="prod-count"><span>${v === 'lineup' ? 'Pieces' : 'Products'}</span><b>${String(n).padStart(2, '0')}</b></p>`;
  const hd = has || c.edit ? `<div class="prod-head">${head(c, s)}${has ? count : ''}</div>` : '';
  const more = btn(c, s.cta, P(s, 'cta'), 'btn alt');
  return `<div class="wrap">${hd}<ul class="prods ${v}${v === 'lineup' ? '' : ` n${Math.min(n, 4)}`}"${v === 'lineup' ? ' tabindex="0"' : ''}>${cards}</ul>${more ? `<div class="actions center">${more}</div>` : ''}</div>`;
};

R.chapters = (s, c) => {
  const v = s.variant;
  const items = s.items.map((it, i) => {
    const art = it.motif && it.motif !== 'none' ? `<div class="ch-art">${motifSvg(it.motif, `${s.id}${i}`)}</div>` : '';
    return `<li class="ch"${rv(c)}>${v === 'split' ? `<span class="ch-n" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>` : ''}<div class="ch-body">${art}${T(c, it, 'title', PI(s, 'items', i, 'title'), 'h2', 'ch-t')}${T(c, it, 'text', PI(s, 'items', i, 'text'), 'div', 'ch-p prose', { ml: 'p' })}</div></li>`;
  }).join('');
  return `<div class="wrap${v === 'stack' ? ' narrow center' : ''}">${head(c, s, { center: v === 'stack' })}<ol class="chs ${v}">${items}</ol></div>`;
};

R.cases = (s, c) => {
  const v = s.variant;
  const meta = (it, i) => {
    const credits = String(it.credits || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const sub = [T(c, it, 'role', PI(s, 'items', i, 'role'), 'span'), T(c, it, 'client', PI(s, 'items', i, 'client'), 'span'), v === 'rail' ? T(c, it, 'year', PI(s, 'items', i, 'year'), 'span') : ''].filter(Boolean).join('');
    return `<div class="case-meta">${T(c, it, 'title', PI(s, 'items', i, 'title'), 'h3', 'case-t')}${sub ? `<p class="case-sub">${sub}</p>` : ''}${T(c, it, 'text', PI(s, 'items', i, 'text'), 'p', 'case-p')}${credits.length ? `<ul class="case-credits">${credits.map((x) => `<li>${inline(x, c)}</li>`).join('')}</ul>` : ''}${btn(c, it.link, PI(s, 'items', i, 'link'), 'mlink')}</div>`;
  };
  if (v === 'list') {
    const rows = s.items.map((it, i) => `<li class="case-row"${phAttr(c, it)}${rv(c)}>${T(c, it, 'year', PI(s, 'items', i, 'year'), 'p', 'case-year')}<div class="case-main">${media(c, it.image, PI(s, 'items', i, 'image'), { ar: '16/10', sizes: '(max-width: 900px) 100vw, 60vw', cls: 'case-media' })}${meta(it, i)}</div></li>`).join('');
    return `<div class="wrap">${head(c, s)}<ol class="case-list">${rows}</ol></div>`;
  }
  const cards = s.items.map((it, i) => `<li class="case" data-year="${esc(it.year)}"${phAttr(c, it)}>${media(c, it.image, PI(s, 'items', i, 'image'), { ar: i % 3 === 1 ? '3/4' : '4/3', sizes: '(max-width: 900px) 80vw, 46vw', cls: 'case-media' })}${meta(it, i)}</li>`).join('');
  return `<div class="rail"${c.motion ? ' data-rail=""' : ''}><div class="rail-in"><div class="wrap rail-head">${head(c, s)}<p class="rail-year" aria-hidden="true"><span data-year-out>${esc(s.items[0]?.year || '')}</span></p></div><ol class="rail-track" tabindex="0" aria-label="${esc(String(s.title || 'Case studies').replace(/\*/g, ''))}">${cards}</ol></div></div>`;
};

R.annotated = (s, c) => {
  const tags = s.items.map((it, i) => `<li class="tag tg${i % 6}" style="--k:${i}">${icon('check')}${T(c, it, 'label', PI(s, 'items', i, 'label'), 'span')}</li>`).join('');
  const status = s.status || c.edit ? `<p class="ann-status"><span class="spin" aria-hidden="true"></span>${T(c, s, 'status', P(s, 'status'), 'span', '', { ph: 'Add a status' })}</p>` : '';
  const ar = s.variant === 'wide' ? '16/9' : '4/5';
  return `<div class="ann ${s.variant}"${c.motion ? ' data-scrub=""' : ''} style="--n:${s.items.length}"><div class="ann-in"><div class="wrap ann-head">${head(c, s, { center: true })}</div><div class="ann-stage">${status}${media(c, s.image, P(s, 'image'), { ar, sizes: '(max-width: 700px) 100vw, 640px', cls: 'ann-media' })}<ul class="ann-tags">${tags}</ul></div></div></div>`;
};

R.footer = (s, c) => {
  const site = c.site;
  const ct = site.contact || {};
  const links = c.navLinks.map((l) => `<li><a href="${esc(l.href)}">${esc(l.label)}</a></li>`).join('');
  const social = s.social.filter((x) => x.label && x.href).map((x) => `<li><a href="${esc(c.href(x.href))}">${esc(x.label)}</a></li>`).join('');
  const contact = [ct.email && `<li><a href="mailto:${esc(ct.email)}">${esc(ct.email)}</a></li>`, ct.phone && `<li><a href="tel:${esc(ct.phone.replace(/[^\d+]/g, ''))}">${esc(ct.phone)}</a></li>`, ct.address && `<li>${esc(ct.address)}</li>`].filter(Boolean).join('');
  const credit = site.credit ? ` <span class="credit">Made with <a href="https://chucksi.com/website">Chucksi</a></span>` : '';
  const brand = `<p class="f-brand"${c.edit ? ' data-edit="$:name"' : ''}>${inline(site.name)}</p>`;
  const bottom = `<div class="f-bottom"><p>© ${new Date().getFullYear()} ${esc(site.name)}.${credit}</p></div>`;
  if (s.variant === 'simple') {
    return `<div class="wrap center f-simple">${brand}${T(c, s, 'tagline', P(s, 'tagline'), 'p', 'muted', { ph: 'Add a tagline' })}<nav aria-label="Footer"><ul class="f-links">${links}${social}</ul></nav>${bottom}</div>`;
  }
  return `<div class="wrap"><div class="f-grid"><div class="f-about">${brand}${T(c, s, 'tagline', P(s, 'tagline'), 'p', 'muted', { ph: 'Add a tagline' })}${contact ? `<ul class="f-contact">${contact}</ul>` : ''}</div><nav aria-label="Footer"><p class="f-h">Pages</p><ul class="f-links col">${links}</ul></nav>${social || c.edit ? `<div><p class="f-h">Follow</p><ul class="f-links col">${social || (c.edit ? '<li class="mz-hint">Add links in the panel</li>' : '')}</ul></div>` : ''}</div>${bottom}</div>`;
};

/** One section as HTML. Footer sections render as <footer>, everything else as <section>. */
export function renderSection(s, c) {
  const def = SECTIONS[s.type];
  if (!def || !R[s.type]) return '';
  if (s.hidden && !c.edit) return '';
  const tone = s.tone && s.tone !== 'base' ? ` t-${s.tone}` : '';
  const tag = s.type === 'footer' ? 'footer' : 'section';
  const label = s.type !== 'footer' && !s.title && s.type !== 'hero' ? ` aria-label="${esc(def.name)}"` : '';
  const attrs = `${s.anchor && s.type !== 'footer' ? ` id="${esc(s.anchor)}"` : ''}${c.edit ? ` data-sid="${s.id}"${s.hidden ? ' data-hidden=""' : ''}` : ''}${label}`;
  return `<${tag} class="sec s-${s.type} v-${s.variant}${tone}"${attrs}>${R[s.type](s, c)}</${tag}>`;
}

function contactHref(site) {
  for (const [i, p] of site.pages.entries()) {
    const sx = p.sections.find((x) => x.type === 'contact' && !x.hidden);
    if (sx) return `/${i === 0 ? '' : p.slug}#${sx.anchor || 'contact'}`;
  }
  return '/';
}

/** Collection item pages (a post, a listing). */
export function renderItemPage(col, it, c) {
  const back = `<a class="back" href="${esc(c.href(c.listPage(col)))}">${ARROW}<span>${col === 'posts' ? 'All posts' : 'All listings'}</span></a>`;
  if (col === 'posts') {
    return `<article class="sec s-article"><div class="wrap narrow">${back}${T(c, it, 'date', CP('posts', it, 'date'), 'p', 'eyebrow')}${H(c, it, 'title', CP('posts', it, 'title'), 1, 'h1 h1-sm')}${T(c, it, 'excerpt', CP('posts', it, 'excerpt'), 'p', 'lead')}</div><div class="wrap">${hasImg(it.image) ? media(c, it.image, CP('posts', it, 'image'), { ar: '16/9', eager: true, sizes: '100vw', cls: 'article-media' }) : ''}</div><div class="wrap narrow">${T(c, it, 'body', CP('posts', it, 'body'), 'div', 'prose body-l article-body', { ml: 'p' })}</div></article>`;
  }
  return `<article class="sec s-article"><div class="wrap">${back}${it.status ? `<p class="pill">${esc(it.status)}</p>` : ''}${H(c, it, 'title', CP('listings', it, 'title'), 1, 'h1 h1-sm')}${T(c, it, 'address', CP('listings', it, 'address'), 'p', 'lead')}${media(c, it.image, CP('listings', it, 'image'), { ar: '16/9', eager: true, sizes: '100vw', cls: 'article-media' })}<div class="listing-body"><div class="listing-main"><ul class="facts">${facts(c, it, (k) => CP('listings', it, k))}</ul>${T(c, it, 'text', CP('listings', it, 'text'), 'div', 'prose body-l', { ml: 'p' })}</div><aside class="card listing-aside">${T(c, it, 'price', CP('listings', it, 'price'), 'p', 'listing-price')}<a class="btn wide" href="${esc(c.href(contactHref(c.site)))}">Ask about this home${ARROW}</a></aside></div></div></article>`;
}
