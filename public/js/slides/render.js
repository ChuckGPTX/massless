// Deck spec -> slide HTML. Pure string building (no DOM), so the builder, the presenter, the single-file
// player and the Node tests all render the exact same markup. Every slide is a fixed 1280 x 720 box that
// the caller scales. Marks used elsewhere:
//   data-k="path"   an editable field (the builder makes it contenteditable)
//   data-tb         a text block (the PDF/PPTX exporters read its words and font from the DOM)
//   data-a="…"      an entrance animation target: t (text), img, n (count-up number), bar, line, dot
//   data-morph      an element a Morph transition carries from slide to slide
//   data-img="path" an image slot

import { LAYOUTS, runs, plain, SLIDE_W, SLIDE_H } from './spec.js';
import { themeById, tokens, styleAttr } from './themes.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rich = (s) => runs(s).map((r) => (r.em ? `<em>${esc(r.text)}</em>` : esc(r.text))).join('').replace(/\n/g, '<br>');

/** A display size that keeps long headlines inside the slide: base px scaled down by length and the face's width. */
export function fitSize(text, base, scale = 1) {
  const n = plain(text).length;
  const k = n <= 12 ? 1 : n <= 22 ? 0.86 : n <= 36 ? 0.72 : n <= 56 ? 0.6 : n <= 84 ? 0.5 : 0.42;
  return Math.round(base * k * scale);
}

/** "$4.2M" -> { prefix: '$', value: 4.2, decimals: 1, suffix: 'M', comma: false } (null when there is no number). */
export function parseCount(s) {
  const m = String(s || '').match(/^(\D*?)(-?\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const raw = m[2];
  const value = parseFloat(raw.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return { prefix: m[1], value, decimals: (raw.split('.')[1] || '').length, suffix: m[3], comma: raw.includes(',') };
}

export function formatValue(n, prefix = '', suffix = '') {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(Math.round(n * 10) / 10);
  return `${prefix}${s}${suffix}`;
}
const niceCeil = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
};

/** Chart geometry in a w x h box: bars, line paths and labels. Pure, so tests check it directly. */
export function chartGeometry(chart, w, h) {
  const top = 40, bottom = 48, left = 8, right = 8;
  const ph = h - top - bottom, pw = w - left - right;
  const all = chart.series.flatMap((s) => s.values);
  const max = niceCeil(Math.max(...all, 0) * 1.08);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const yOf = (v) => top + ph - ((v - min) / span) * ph;
  const n = chart.labels.length, slot = pw / n;
  const grid = [0, 0.5, 1].map((f) => ({ y: +(top + ph - f * ph).toFixed(1), v: min + f * span }));
  const labels = chart.labels.map((l, i) => ({ x: +(left + slot * (i + 0.5)).toFixed(1), y: h - 14, text: l }));
  const bars = [], lines = [];
  if (chart.type === 'bar') {
    const ns = chart.series.length, gw = Math.min(slot * 0.62, 140), bw = gw / ns;
    chart.series.forEach((s, si) => s.values.forEach((v, i) => {
      const x = left + slot * (i + 0.5) - gw / 2 + si * bw, y0 = yOf(Math.max(0, v)), y1 = yOf(Math.min(0, v));
      bars.push({ s: si, i, x: +(x + (ns > 1 ? 3 : 0)).toFixed(1), y: +y0.toFixed(1), w: +(bw - (ns > 1 ? 6 : 0)).toFixed(1), h: +Math.max(1, y1 - y0).toFixed(1), v, label: formatValue(v, chart.prefix, chart.suffix) });
    }));
  } else {
    chart.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => [+(left + slot * (i + 0.5)).toFixed(1), +yOf(v).toFixed(1), v]);
      lines.push({ s: si, d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' '), points: pts.map(([x, y, v]) => ({ x, y, v, label: formatValue(v, chart.prefix, chart.suffix) })) });
    });
  }
  return { w, h, max, min, grid, labels, bars, lines };
}

export function chartSVG(chart, w, h) {
  const g = chartGeometry(chart, w, h);
  const out = [`<svg class="chart" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" data-chart="${esc(JSON.stringify(chart))}" role="img" aria-label="${esc(chart.type === 'bar' ? 'Bar chart' : 'Line chart')}: ${esc(chart.labels.join(', '))}">`];
  for (const gl of g.grid) out.push(`<line class="grid" x1="0" x2="${w}" y1="${gl.y}" y2="${gl.y}"/>`);
  for (const b of g.bars) {
    out.push(`<rect class="bar s${b.s}" data-a="bar" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${Math.min(6, b.w / 6).toFixed(1)}"/>`);
    out.push(`<text class="val" data-a="dot" x="${(b.x + b.w / 2).toFixed(1)}" y="${(b.y - 12).toFixed(1)}" text-anchor="middle">${esc(b.label)}</text>`);
  }
  for (const l of g.lines) {
    out.push(`<path class="ln s${l.s}" data-a="line" d="${l.d}"/>`);
    l.points.forEach((p, i) => {
      out.push(`<circle class="pt s${l.s}" data-a="dot" cx="${p.x}" cy="${p.y}" r="7"/>`);
      if (g.lines.length === 1 || i === l.points.length - 1) out.push(`<text class="val" data-a="dot" x="${p.x}" y="${(p.y - 18).toFixed(1)}" text-anchor="middle">${esc(p.label)}</text>`);
    });
  }
  for (const lb of g.labels) out.push(`<text class="lbl" x="${lb.x}" y="${lb.y}" text-anchor="middle">${esc(lb.text)}</text>`);
  out.push('</svg>');
  if (chart.series.length > 1) out.push(`<div class="legend">${chart.series.map((s, i) => `<span data-tb><i class="sw s${i}"></i>${esc(s.name)}</span>`).join('')}</div>`);
  return out.join('');
}

// ---------- slide parts ----------
function ctx(slide, deck, opts) {
  const theme = themeById(deck.theme);
  const edit = !!opts.edit;
  const resolve = opts.resolve || ((s) => s);
  const T = (tag, cls, path, value, o = {}) => {
    const v = path ? getPath(slide, path) : value;
    const val = v ?? '';
    if (!edit && !String(val).trim() && !o.keep) return '';
    const attrs = [`class="${cls}"`, 'data-tb'];
    if (path && edit) attrs.push(`data-k="${path}"`, `data-ph="${esc(o.ph || 'Type here')}"`);
    if (o.a !== false) attrs.push(`data-a="${o.a || 't'}"`);
    if (o.morph) attrs.push(`data-morph="${o.morph}"`);
    if (o.style) attrs.push(`style="${o.style}"`);
    if (o.count) { const c = parseCount(val); if (c) attrs.push(`data-count="${esc(String(val))}"`); }
    const inner = o.list ? (Array.isArray(val) ? val : []).map((x) => `<span class="li"><i class="ck"></i>${esc(x)}</span>`).join('') : o.rich === false ? esc(val) : rich(val);
    return `<${tag} ${attrs.join(' ')}>${inner}</${tag}>`;
  };
  const IMG = (path, cls = 'media', o = {}) => {
    const im = getPath(slide, path) || {};
    const src = im.src ? resolve(im.src) : '';
    const pos = `object-position:${im.x ?? 50}% ${im.y ?? 50}%`;
    if (src) return `<div class="${cls}" data-a="img"><img src="${esc(src)}" alt="${esc(im.alt || '')}" data-img="${path}" style="${pos}" draggable="false"${opts.lazy ? ' loading="lazy"' : ''}></div>`;
    if (edit) return `<div class="${cls} ph" data-img="${path}" data-a="img"><span class="ph-in"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 15l5-4.5 4 3.5 3-2.5 5 4"/><circle cx="15.5" cy="9" r="1.6"/></svg>Add image</span></div>`;
    if (o.fallback === 'none') return '';
    return `<div class="${cls} fill" data-a="img"><i class="fill-orb"></i><i class="fill-orb b"></i></div>`;
  };
  return { theme, edit, T, IMG };
}
function getPath(obj, path) { return String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
const has = (slide, path) => !!getPath(slide, path)?.src;

function deco(theme, layout) {
  if (!['title', 'statement', 'closing', 'bignumber'].includes(layout)) return '';
  const n = { grid: 12, blob: 2, stripe: 3 }[theme.deco] || 1;
  return `<div class="deco deco-${theme.deco}" aria-hidden="true">${'<i></i>'.repeat(n)}</div>`;
}

const LAYOUT_HTML = {
  title(s, c) {
    const v = s.variant === 'split' && !has(s, 'image') && !c.edit ? 'plain' : s.variant;
    const size = fitSize(s.title, v === 'split' ? 104 : 128, c.theme.display.scale);
    const text = `<div class="tx">${c.T('p', 'k', 'eyebrow', null, { ph: 'Eyebrow' })}${c.T('h1', 'h', 'title', null, { morph: 'title', style: `font-size:${size}px`, ph: 'Headline', keep: true })}${c.T('p', 'p lead', 'subtitle', null, { ph: 'Subtitle' })}${c.T('p', 'meta', 'meta', null, { ph: 'Presenter · date', rich: false })}</div>`;
    if (v === 'full') return { v, html: `${c.IMG('image', 'media bleed')}<div class="scrim"></div>${text}` };
    if (v === 'split') return { v, html: `${text}${c.IMG('image', 'media mside')}` };
    return { v, html: text };
  },
  statement(s, c) {
    return { html: `<div class="tx">${c.T('p', 'k', 'eyebrow', null, { ph: 'Eyebrow' })}${c.T('h2', 'h', 'title', null, { morph: 'title', style: `font-size:${fitSize(s.title, 108, c.theme.display.scale)}px`, keep: true, ph: 'Your statement' })}${c.T('p', 'p lead', 'subtitle', null, { ph: 'Supporting line' })}</div>` };
  },
  bignumber(s, c) {
    const n = plain(s.value).length;
    const size = Math.round((n <= 3 ? 280 : n <= 5 ? 236 : n <= 7 ? 190 : 150) * Math.min(1.05, c.theme.display.scale));
    const stats = (s.items || []).length || c.edit ? `<div class="stats">${(s.items || []).map((it, i) => `<div class="stat">${c.T('strong', 'sv', `items.${i}.value`, null, { a: 'n', count: true, rich: false, keep: true, ph: '0' })}${c.T('span', 'sl-l', `items.${i}.label`, null, { ph: 'Label' })}</div>`).join('')}</div>` : '';
    return { html: `<div class="tx">${c.T('p', 'k', 'eyebrow', null, { ph: 'Eyebrow' })}${c.T('div', 'num', 'value', null, { a: 'n', count: true, rich: false, keep: true, style: `font-size:${size}px`, ph: '00', morph: 'title' })}${c.T('p', 'nl', 'label', null, { ph: 'What the number means' })}${c.T('p', 'p', 'text', null, { ph: 'Context' })}</div>${stats}` };
  },
  imagetext(s, c) {
    const items = (s.items || []).length ? `<ul class="bul">${s.items.map((it, i) => `<li><i class="mk" data-a="dot"></i>${c.T('span', 'bt', `items.${i}.text`, null, { ph: 'Point' })}</li>`).join('')}</ul>` : '';
    return { html: `${c.IMG('image', 'media half')}<div class="tx">${c.T('p', 'k', 'eyebrow', null, { ph: 'Eyebrow' })}${c.T('h2', 'h', 'title', null, { morph: 'title', style: `font-size:${fitSize(s.title, 76, c.theme.display.scale)}px`, keep: true, ph: 'Headline' })}${c.T('p', 'p', 'text', null, { ph: 'A few sentences' })}${items}</div>` };
  },
  twocol(s, c) {
    const items = (s.items || []).map((it, i) => `<div class="col"><span class="no" data-tb data-a="t">${String(i + 1).padStart(2, '0')}</span>${c.T('h3', 'ct', `items.${i}.title`, null, { keep: true, ph: 'Point' })}${c.T('p', 'p', `items.${i}.text`, null, { ph: 'Explain it' })}</div>`).join('');
    return { html: `<div class="hd">${c.T('p', 'k', 'eyebrow', null, { ph: 'Eyebrow' })}${c.T('h2', 'h', 'title', null, { morph: 'title', style: `font-size:${fitSize(s.title, 72, c.theme.display.scale)}px`, keep: true, ph: 'Headline' })}</div><div class="cols n${(s.items || []).length}">${items}</div>` };
  },
  agenda(s, c) {
    const items = (s.items || []).map((it, i) => `<li>${s.variant === 'numbered' ? `<span class="no" data-tb data-a="t">${String(i + 1).padStart(2, '0')}</span>` : '<i class="dash"></i>'}<div>${c.T('strong', 'at', `items.${i}.title`, null, { keep: true, ph: 'Item' })}${c.T('span', 'ad', `items.${i}.text`, null, { ph: 'Detail' })}</div></li>`).join('');
    return { html: `<div class="hd">${c.T('p', 'k', 'eyebrow', null, { ph: 'Eyebrow' })}${c.T('h2', 'h', 'title', null, { morph: 'title', style: `font-size:${fitSize(s.title, 76, c.theme.display.scale)}px`, keep: true, ph: 'Headline' })}</div><ol class="list n${(s.items || []).length}">${items}</ol>` };
  },
  quote(s, c) {
    const portrait = s.variant === 'portrait';
    const n = plain(s.quote).length;
    const size = Math.round((portrait ? 52 : 62) * (n <= 50 ? 1.15 : n <= 90 ? 1 : n <= 140 ? 0.84 : n <= 220 ? 0.7 : 0.58) * Math.min(1, c.theme.display.scale));
    return { html: `${portrait ? c.IMG('image', 'media face', { fallback: 'none' }) : ''}<div class="tx"><span class="qm" data-tb data-a="t" aria-hidden="true">“</span>${c.T('blockquote', 'h q', 'quote', null, { morph: 'title', style: `font-size:${size}px`, keep: true, ph: 'The quote' })}<p class="by">${c.T('strong', 'bn', 'name', null, { ph: 'Name', rich: false })}${c.T('span', 'br', 'role', null, { ph: 'Role', rich: false })}</p></div>` };
  },
  timeline(s, c) {
    const items = (s.items || []).map((it, i) => `<li><i class="tl-dot" data-a="dot"></i>${c.T('span', 'td', `items.${i}.date`, null, { ph: 'When', rich: false })}${c.T('strong', 'tt', `items.${i}.title`, null, { keep: true, ph: 'Milestone' })}${c.T('p', 'p', `items.${i}.text`, null, { ph: 'Detail' })}</li>`).join('');
    return { html: `<div class="hd">${c.T('p', 'k', 'eyebrow', null, { ph: 'Eyebrow' })}${c.T('h2', 'h', 'title', null, { morph: 'title', style: `font-size:${fitSize(s.title, 72, c.theme.display.scale)}px`, keep: true, ph: 'Headline' })}</div><div class="tl"><div class="tl-wrap"><i class="tl-line" data-a="rule"></i><ol class="n${(s.items || []).length}">${items}</ol></div></div>` };
  },
  team(s, c) {
    const items = (s.items || []).map((it, i) => {
      const initials = plain(it.name).split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '·';
      const photo = it.image?.src || c.edit ? c.IMG(`items.${i}.image`, 'media ph-person') : `<div class="media ph-person ini" data-a="img"><span data-tb>${esc(initials)}</span></div>`;
      return `<li>${photo}${c.T('strong', 'pn', `items.${i}.name`, null, { keep: true, ph: 'Name', rich: false })}${c.T('span', 'pr', `items.${i}.role`, null, { ph: 'Role', rich: false })}</li>`;
    }).join('');
    return { html: `<div class="hd">${c.T('p', 'k', 'eyebrow', null, { ph: 'Eyebrow' })}${c.T('h2', 'h', 'title', null, { morph: 'title', style: `font-size:${fitSize(s.title, 68, c.theme.display.scale)}px`, keep: true, ph: 'Headline' })}</div><ul class="people n${(s.items || []).length}">${items}</ul>` };
  },
  pricing(s, c) {
    const items = (s.items || []).map((it, i) => `<li class="plan${it.featured ? ' feat' : ''}" data-a="t">${c.T('span', 'pn', `items.${i}.name`, null, { a: false, keep: true, ph: 'Plan', rich: false })}<div class="pp">${c.T('strong', 'pv', `items.${i}.price`, null, { a: false, keep: true, ph: '$0', rich: false })}${c.T('span', 'pd', `items.${i}.period`, null, { a: false, ph: '/mo', rich: false })}</div>${c.T('div', 'feats', `items.${i}.features`, null, { a: false, list: true, ph: 'One feature per line' })}</li>`).join('');
    return { html: `<div class="hd">${c.T('p', 'k', 'eyebrow', null, { ph: 'Eyebrow' })}${c.T('h2', 'h', 'title', null, { morph: 'title', style: `font-size:${fitSize(s.title, 64, c.theme.display.scale)}px`, keep: true, ph: 'Headline' })}</div><ul class="plans n${(s.items || []).length}">${items}</ul>${c.T('p', 'note', 'note', null, { ph: 'Small print' })}` };
  },
  chart(s, c) {
    const side = s.variant === 'side';
    const [w, h] = side ? [640, 480] : [1104, 400];
    return { html: `<div class="hd">${c.T('p', 'k', 'eyebrow', null, { ph: 'Eyebrow' })}${c.T('h2', 'h', 'title', null, { morph: 'title', style: `font-size:${fitSize(s.title, side ? 64 : 60, c.theme.display.scale)}px`, keep: true, ph: 'Headline' })}${c.T('p', 'p', 'text', null, { ph: 'What the chart shows' })}</div><div class="cbox" data-chart-path="chart">${chartSVG(s.chart, w, h)}</div>` };
  },
  gallery(s, c) {
    const items = (s.items || []).map((it, i) => `<figure>${c.IMG(`items.${i}.image`, 'media gi')}${c.T('figcaption', 'cap', `items.${i}.caption`, null, { ph: 'Caption', rich: false })}</figure>`).join('');
    return { html: `<div class="hd">${c.T('p', 'k', 'eyebrow', null, { ph: 'Eyebrow' })}${c.T('h2', 'h', 'title', null, { morph: 'title', style: `font-size:${fitSize(s.title, 56, c.theme.display.scale)}px`, keep: true, ph: 'Headline' })}</div><div class="grid n${(s.items || []).length}">${items}</div>` };
  },
  closing(s, c) {
    const split = s.variant === 'split' && (has(s, 'image') || c.edit);
    const text = `<div class="tx">${c.T('p', 'k', 'eyebrow', null, { ph: 'Eyebrow' })}${c.T('h2', 'h', 'title', null, { morph: 'title', style: `font-size:${fitSize(s.title, split ? 96 : 120, c.theme.display.scale)}px`, keep: true, ph: 'Closing line' })}${c.T('p', 'p lead', 'subtitle', null, { ph: 'Next step' })}<div class="act">${c.T('span', 'cta', 'cta', null, { ph: 'Button', rich: false })}${c.T('span', 'contact', 'contact', null, { ph: 'email or website', rich: false })}</div></div>`;
    return { v: split ? 'split' : 'center', html: split ? `${c.IMG('image', 'media mside')}${text}` : text };
  },
};

/** One slide as an HTML string. opts: { index, total, edit, resolve(src) -> url, lazy } */
export function renderSlide(slide, deck, opts = {}) {
  const c = ctx(slide, deck, opts);
  const L = LAYOUT_HTML[slide.layout] || LAYOUT_HTML.statement;
  const { html, v } = L(slide, c);
  const variant = v || slide.variant;
  const tone = slide.layout === 'title' && variant === 'full' && has(slide, 'image') ? 'photo' : slide.tone;
  const vars = tokens(c.theme, tone === 'photo' ? 'ink' : slide.tone);
  if (tone === 'photo') Object.assign(vars, { '--scrim': 'rgba(8, 8, 12, 0.5)', '--ink': '#ffffff', '--muted': 'rgba(255, 255, 255, 0.86)', '--accent': '#ffffff' });
  const foot = deck.footer && !['title', 'closing'].includes(slide.layout) && opts.total
    ? `<footer class="sf"><span data-tb>${esc(plain(deck.title))}</span><span data-tb>${String((opts.index || 0) + 1).padStart(2, '0')} / ${String(opts.total).padStart(2, '0')}</span></footer>` : '';
  const anim = deck.motion === false ? 'none' : slide.anim || 'rise';
  return `<section class="sl sl-${slide.layout} v-${variant} tone-${tone} th-${c.theme.id}" data-id="${esc(slide.id)}" data-layout="${slide.layout}" data-anim="${anim}" data-tr="${slide.transition || deck.transition || 'fade'}" style="${styleAttr(vars)}" aria-roledescription="slide" aria-label="Slide ${(opts.index || 0) + 1}">${deco(c.theme, slide.layout)}<div class="in">${html}</div>${foot}</section>`;
}

export const slideSize = { w: SLIDE_W, h: SLIDE_H };
export { LAYOUTS };
