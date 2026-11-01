// Deck specs: the JSON a slide deck is made of. A deck is a theme plus an ordered list of slides; each slide
// names a layout and carries only that layout's fields. sanitizeDeck() turns anything (writer output, a
// shared link, an old save) into a valid, safe deck; validateDeck() lists what is wrong with a deck as-is.

import { THEME_IDS, DEFAULT_THEME } from './themes.js';

export const DECK_VERSION = 1;
export const SLIDE_W = 1280;
export const SLIDE_H = 720;
export const MAX_SLIDES = 40;

// Field types: text (one line), para (multi-line), list (one entry per line), image {src, alt, prompt},
// bool, chart {type, labels, series, prefix, suffix}, and item arrays { max, item: {...} }.
const IMG = 'image';
export const LAYOUTS = {
  title: { name: 'Title', hint: 'Cover with a big headline', variants: { split: 'Split', full: 'Full photo', plain: 'Type only' },
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para', meta: 'text', image: IMG } },
  statement: { name: 'Statement', hint: 'One big idea', variants: { left: 'Left', center: 'Centered' },
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para' } },
  bignumber: { name: 'Big number', hint: 'A headline figure that counts up', variants: { left: 'Left', center: 'Centered' },
    fields: { eyebrow: 'text', value: 'text', label: 'text', text: 'para', items: { max: 3, item: { value: 'text', label: 'text' } } } },
  imagetext: { name: 'Image + text', hint: 'A photo beside a short story', variants: { right: 'Image right', left: 'Image left' },
    fields: { eyebrow: 'text', title: 'text', text: 'para', items: { max: 4, item: { text: 'text' } }, image: IMG } },
  twocol: { name: 'Columns', hint: 'Two or three points side by side', variants: { cards: 'Cards', plain: 'Plain' },
    fields: { eyebrow: 'text', title: 'text', items: { max: 3, item: { title: 'text', text: 'para' } } } },
  agenda: { name: 'List', hint: 'Agenda, steps or takeaways', variants: { numbered: 'Numbered', plain: 'Plain' },
    fields: { eyebrow: 'text', title: 'text', items: { max: 6, item: { title: 'text', text: 'text' } } } },
  quote: { name: 'Quote', hint: 'A testimonial or a line worth repeating', variants: { large: 'Large', portrait: 'With portrait' },
    fields: { quote: 'para', name: 'text', role: 'text', image: IMG } },
  timeline: { name: 'Timeline', hint: 'Milestones, roadmap or schedule', variants: { line: 'Line', steps: 'Steps' },
    fields: { eyebrow: 'text', title: 'text', items: { max: 5, item: { date: 'text', title: 'text', text: 'para' } } } },
  team: { name: 'Team', hint: 'People with photos', variants: { grid: 'Grid' },
    fields: { eyebrow: 'text', title: 'text', items: { max: 4, item: { name: 'text', role: 'text', image: IMG } } } },
  pricing: { name: 'Pricing', hint: 'Plans, packages or tickets', variants: { cards: 'Cards' },
    fields: { eyebrow: 'text', title: 'text', items: { max: 3, item: { name: 'text', price: 'text', period: 'text', features: 'list', featured: 'bool' } }, note: 'text' } },
  chart: { name: 'Chart', hint: 'A bar or line chart from your numbers', variants: { wide: 'Wide', side: 'With takeaway' },
    fields: { eyebrow: 'text', title: 'text', text: 'para', chart: 'chart' } },
  gallery: { name: 'Gallery', hint: 'Up to six photos with captions', variants: { grid: 'Grid' },
    fields: { eyebrow: 'text', title: 'text', items: { max: 6, item: { image: IMG, caption: 'text' } } } },
  closing: { name: 'Closing', hint: 'The ask, next steps and contact', variants: { center: 'Centered', split: 'With photo' },
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para', cta: 'text', contact: 'text', image: IMG } },
};
export const LAYOUT_IDS = Object.keys(LAYOUTS);
export const TONES = { base: 'Page', alt: 'Soft', ink: 'Inverse', accent: 'Accent' };
export const TRANSITIONS = { fade: 'Fade', push: 'Push', zoom: 'Zoom', morph: 'Morph', none: 'None' };
export const ANIMS = { rise: 'Rise', fade: 'Fade', pop: 'Pop', none: 'None' };
export const LIMITS = { text: 160, para: 560, list: 10, listLine: 90, notes: 2400, title: 120, chartLabels: 8, chartSeries: 2 };

let uidN = 0;
export const uid = (p = 's') => `${p}${Date.now().toString(36).slice(-5)}${(uidN++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

// ---------- cleaning ----------
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
export function clean(v, max = LIMITS.text, multiline = false) {
  let s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '';
  s = s.replace(CTRL, '').replace(/\r\n?/g, '\n');
  s = multiline ? s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s*\n\s*/g, ' ');
  return s.trim().slice(0, max);
}
/** Image sources a deck may hold: local assets, site media, or nothing. Never script or remote URLs. */
export function safeSrc(src) {
  const s = typeof src === 'string' ? src.trim() : '';
  if (/^asset:[\w-]{1,64}$/.test(s)) return s;
  if (/^\/media\/[\w./-]{1,160}\.(?:jpe?g|png|webp)$/i.test(s) && !s.includes('..')) return s;
  return '';
}
const cleanImage = (v) => {
  const o = v && typeof v === 'object' ? v : {};
  const out = { src: safeSrc(o.src), alt: clean(o.alt, 160), prompt: clean(o.prompt, 400) };
  const fx = Number(o.x), fy = Number(o.y);
  if (Number.isFinite(fx) && fx !== 50) out.x = Math.max(0, Math.min(100, Math.round(fx)));
  if (Number.isFinite(fy) && fy !== 50) out.y = Math.max(0, Math.min(100, Math.round(fy)));
  return out;
};
const cleanList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [])
  .map((x) => clean(x, LIMITS.listLine)).filter(Boolean).slice(0, LIMITS.list);
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^\d.eE+-]/g, '')); return Number.isFinite(n) ? Math.max(-1e12, Math.min(1e12, n)) : 0; };
export function cleanChart(v) {
  const o = v && typeof v === 'object' ? v : {};
  let labels = (Array.isArray(o.labels) ? o.labels : []).map((x) => clean(x, 24)).slice(0, LIMITS.chartLabels);
  if (!labels.length) labels = ['A', 'B', 'C'];
  const series = (Array.isArray(o.series) ? o.series : []).slice(0, LIMITS.chartSeries).map((s, i) => ({
    name: clean(s?.name, 40) || `Series ${i + 1}`,
    values: labels.map((_, k) => num(Array.isArray(s?.values) ? s.values[k] : 0)),
  }));
  if (!series.length) series.push({ name: 'Value', values: labels.map(() => 0) });
  return { type: o.type === 'line' ? 'line' : 'bar', labels, series, prefix: clean(o.prefix, 4), suffix: clean(o.suffix, 6) };
}
function cleanField(type, v) {
  if (type === 'text') return clean(v, LIMITS.text);
  if (type === 'para') return clean(v, LIMITS.para, true);
  if (type === 'list') return cleanList(v);
  if (type === 'bool') return v === true;
  if (type === 'image') return cleanImage(v);
  if (type === 'chart') return cleanChart(v);
  if (type && typeof type === 'object') {
    return (Array.isArray(v) ? v : []).slice(0, type.max).filter((x) => x && typeof x === 'object')
      .map((x) => Object.fromEntries(Object.entries(type.item).map(([k, t]) => [k, cleanField(t, x[k])])));
  }
  return '';
}

/** A slide with only its layout's fields, every field present and clean. */
export function sanitizeSlide(raw, ids = new Set()) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const layout = LAYOUTS[r.layout] ? r.layout : 'statement';
  const L = LAYOUTS[layout];
  let id = typeof r.id === 'string' && /^[\w-]{2,40}$/.test(r.id) && !ids.has(r.id) ? r.id : uid('s');
  while (ids.has(id)) id = uid('s');
  ids.add(id);
  const s = {
    id, layout,
    variant: L.variants[r.variant] ? r.variant : Object.keys(L.variants)[0],
    tone: TONES[r.tone] ? r.tone : 'base',
    transition: TRANSITIONS[r.transition] ? r.transition : '',
    anim: ANIMS[r.anim] ? r.anim : '',
  };
  for (const [k, t] of Object.entries(L.fields)) s[k] = cleanField(t, r[k]);
  s.notes = clean(r.notes, LIMITS.notes, true);
  return s;
}

export function sanitizeDeck(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const ids = new Set();
  const slides = (Array.isArray(r.slides) ? r.slides : []).slice(0, MAX_SLIDES).map((s) => sanitizeSlide(s, ids));
  if (!slides.length) slides.push(sanitizeSlide(newSlide('title'), ids));
  return {
    v: DECK_VERSION,
    id: typeof r.id === 'string' && /^[\w-]{4,40}$/.test(r.id) ? r.id : uid('d'),
    title: clean(r.title, LIMITS.title) || clean(slides[0].title, LIMITS.title) || 'Untitled deck',
    kind: clean(r.kind, 20),
    theme: THEME_IDS.includes(r.theme) ? r.theme : DEFAULT_THEME,
    transition: TRANSITIONS[r.transition] && r.transition ? r.transition : 'fade',
    motion: r.motion !== false,
    footer: r.footer !== false,
    slides,
  };
}

/** Problems with a deck as given (empty when it is valid). Used by tests and before sharing. */
export function validateDeck(deck) {
  const out = [];
  if (!deck || typeof deck !== 'object') return ['deck is not an object'];
  if (deck.v !== DECK_VERSION) out.push(`version ${deck.v} is not ${DECK_VERSION}`);
  if (!THEME_IDS.includes(deck.theme)) out.push(`unknown theme ${deck.theme}`);
  if (!TRANSITIONS[deck.transition] || deck.transition === '') out.push(`unknown deck transition ${deck.transition}`);
  if (!clean(deck.title)) out.push('deck has no title');
  if (!Array.isArray(deck.slides) || !deck.slides.length) return [...out, 'deck has no slides'];
  if (deck.slides.length > MAX_SLIDES) out.push(`${deck.slides.length} slides is over ${MAX_SLIDES}`);
  const ids = new Set();
  deck.slides.forEach((s, i) => {
    const at = `slide ${i + 1}`;
    const L = LAYOUTS[s.layout];
    if (!L) { out.push(`${at}: unknown layout ${s.layout}`); return; }
    if (ids.has(s.id)) out.push(`${at}: duplicate id ${s.id}`);
    ids.add(s.id);
    if (!L.variants[s.variant]) out.push(`${at}: unknown variant ${s.variant}`);
    if (!TONES[s.tone]) out.push(`${at}: unknown tone ${s.tone}`);
    if (s.transition && !TRANSITIONS[s.transition]) out.push(`${at}: unknown transition ${s.transition}`);
    if (s.anim && !ANIMS[s.anim]) out.push(`${at}: unknown animation ${s.anim}`);
    const main = s.layout === 'quote' ? s.quote : s.layout === 'bignumber' ? s.value : s.title;
    if (!clean(main, 1000, true)) out.push(`${at}: the main text is empty`);
    for (const [k, t] of Object.entries(L.fields)) {
      if (!(k in s)) { out.push(`${at}: missing ${k}`); continue; }
      const v = s[k];
      if (t === 'text' && (typeof v !== 'string' || v.length > LIMITS.text)) out.push(`${at}: ${k} is not short text`);
      if (t === 'para' && (typeof v !== 'string' || v.length > LIMITS.para)) out.push(`${at}: ${k} is not a paragraph`);
      if (t === 'image' && (typeof v !== 'object' || v.src !== safeSrc(v.src))) out.push(`${at}: ${k} has an unsafe image source`);
      if (t === 'chart') {
        if (!v || !Array.isArray(v.labels) || !v.labels.length || v.labels.length > LIMITS.chartLabels) out.push(`${at}: chart needs 1-${LIMITS.chartLabels} labels`);
        else for (const se of v.series || []) if (!Array.isArray(se.values) || se.values.length !== v.labels.length || !se.values.every(Number.isFinite)) out.push(`${at}: chart series ${se.name} does not match its labels`);
      }
      if (t && typeof t === 'object') {
        if (!Array.isArray(v)) out.push(`${at}: ${k} is not a list`);
        else if (v.length > t.max) out.push(`${at}: ${v.length} ${k} is over ${t.max}`);
        else v.forEach((it, j) => { for (const [ik, itp] of Object.entries(t.item)) if (itp === 'image' && it[ik]?.src !== safeSrc(it[ik]?.src)) out.push(`${at}: item ${j + 1} has an unsafe image`); });
      }
    }
  });
  return out;
}

// ---------- new slides and layout changes ----------
const img = (prompt = '', src = '', alt = '') => ({ src, alt, prompt });
const DEFAULTS = {
  title: () => ({ variant: 'split', eyebrow: 'Presentation', title: 'Your big *headline*', subtitle: 'One line that says why this matters.', meta: 'Your name · Date', image: img('soft abstract light, editorial photograph') }),
  statement: () => ({ eyebrow: 'The idea', title: 'Say one thing, *clearly.*', subtitle: '' }),
  bignumber: () => ({ value: '87%', label: 'of people remember a number over a sentence', text: '', items: [] }),
  imagetext: () => ({ eyebrow: 'Section', title: 'A photo and a short story', text: 'Two or three sentences that explain the picture and why it matters.', items: [], image: img('editorial photograph, natural light') }),
  twocol: () => ({ eyebrow: 'Compare', title: 'Two sides, one decision', items: [{ title: 'First point', text: 'Explain it in a sentence or two.' }, { title: 'Second point', text: 'Explain it in a sentence or two.' }] }),
  agenda: () => ({ eyebrow: 'Agenda', title: 'What we will cover', items: [{ title: 'Where we are', text: '' }, { title: 'What we learned', text: '' }, { title: 'What happens next', text: '' }] }),
  quote: () => ({ quote: 'A line worth repeating goes here.', name: 'Name Surname', role: 'Role, Company', image: img() }),
  timeline: () => ({ eyebrow: 'Roadmap', title: 'How we get there', items: [{ date: 'Q1', title: 'Start', text: '' }, { date: 'Q2', title: 'Build', text: '' }, { date: 'Q3', title: 'Launch', text: '' }, { date: 'Q4', title: 'Grow', text: '' }] }),
  team: () => ({ eyebrow: 'Team', title: 'The people behind it', items: [{ name: 'Name Surname', role: 'Role', image: img() }, { name: 'Name Surname', role: 'Role', image: img() }, { name: 'Name Surname', role: 'Role', image: img() }] }),
  pricing: () => ({ eyebrow: 'Pricing', title: 'Simple plans', items: [{ name: 'Starter', price: '$0', period: '/mo', features: ['The basics', 'One user'], featured: false }, { name: 'Pro', price: '$24', period: '/mo', features: ['Everything in Starter', 'Unlimited projects', 'Priority help'], featured: true }, { name: 'Team', price: '$79', period: '/mo', features: ['Everything in Pro', 'Up to 10 seats'], featured: false }], note: '' }),
  chart: () => ({ variant: 'side', eyebrow: 'Growth', title: 'Up and to the right', text: 'One sentence on what the chart shows.', chart: { type: 'bar', labels: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: 'Revenue', values: [12, 19, 27, 41] }], prefix: '$', suffix: 'k' } }),
  gallery: () => ({ eyebrow: 'Gallery', title: 'Selected work', items: [{ image: img(), caption: 'Caption' }, { image: img(), caption: 'Caption' }, { image: img(), caption: 'Caption' }] }),
  closing: () => ({ eyebrow: 'Next steps', title: 'Thank *you.*', subtitle: 'What should people do now?', cta: 'Get in touch', contact: 'hello@example.com', image: img() }),
};
export function newSlide(layout = 'statement', extra = {}) {
  const l = LAYOUTS[layout] ? layout : 'statement';
  return sanitizeSlide({ layout: l, ...DEFAULTS[l](), ...extra });
}

const firstText = (s) => s.title || s.quote || s.value || '';
/** The same content in another layout: headline, text, image and items carry over where they fit. */
export function changeLayout(slide, layout) {
  if (!LAYOUTS[layout] || slide.layout === layout) return slide;
  const base = newSlide(layout);
  const L = LAYOUTS[layout].fields;
  const out = { ...base, id: slide.id, tone: slide.tone, transition: slide.transition, anim: slide.anim, notes: slide.notes };
  if ('eyebrow' in L && slide.eyebrow) out.eyebrow = slide.eyebrow;
  const head = firstText(slide);
  if ('title' in L && head) out.title = head;
  if (layout === 'quote' && head) out.quote = head.replace(/\*/g, '');
  if (layout === 'bignumber') { if (slide.value) out.value = slide.value; if (slide.title) out.label = slide.title.replace(/\*/g, ''); }
  const body = slide.subtitle || slide.text || slide.label || '';
  for (const k of ['subtitle', 'text']) if (k in L && body) out[k] = body;
  if ('image' in L && slide.image?.src) out.image = { ...slide.image };
  if (L.items && Array.isArray(slide.items) && slide.items.length) {
    const want = L.items.item, max = L.items.max;
    out.items = slide.items.slice(0, max).map((it, i) => {
      const o = { ...(base.items?.[i] || base.items?.[0] || {}) };
      const txt = it.title || it.name || it.date || it.value || it.caption || it.text || '';
      const sub = it.text || it.role || it.label || it.caption || '';
      for (const [k, t] of Object.entries(want)) {
        if (t === 'image') o[k] = it.image?.src ? { ...it.image } : o[k] || img();
        else if (['title', 'name', 'value', 'caption', 'date'].includes(k)) o[k] = txt || o[k];
        else if (['text', 'role', 'label'].includes(k)) o[k] = sub && sub !== txt ? sub : k === 'text' ? '' : o[k];
        else if (k === 'features') o[k] = Array.isArray(it.features) ? it.features : sub ? [sub] : o[k] || [];
      }
      return o;
    });
  }
  return sanitizeSlide(out, new Set());
}

/** "*word*" emphasis spans (accent colour / italic) -> [{text, em}] runs. */
export function runs(s) {
  const out = [];
  String(s || '').split(/(\*[^*\n]+\*)/g).forEach((part) => {
    if (!part) return;
    if (/^\*[^*\n]+\*$/.test(part)) out.push({ text: part.slice(1, -1), em: true });
    else out.push({ text: part, em: false });
  });
  return out;
}
export const plain = (s) => String(s || '').replace(/\*([^*\n]+)\*/g, '$1');

/** Every image slot on a slide as [path, image]. */
export function imageSlots(slide) {
  const out = [];
  const L = LAYOUTS[slide.layout]?.fields || {};
  for (const [k, t] of Object.entries(L)) {
    if (t === 'image') out.push([k, slide[k]]);
    if (t && typeof t === 'object') (slide[k] || []).forEach((it, i) => { for (const [ik, itp] of Object.entries(t.item)) if (itp === 'image') out.push([`${k}.${i}.${ik}`, it[ik]]); });
  }
  return out;
}
export function getIn(obj, path) { return String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
export function setIn(obj, path, value) {
  const keys = String(path).split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) { if (o[k] == null) return; o = o[k]; }
  o[keys.at(-1)] = value;
}
/** Field type at a path like "items.1.features". */
export function fieldType(slide, path) {
  const keys = String(path).split('.');
  let t = LAYOUTS[slide.layout]?.fields?.[keys[0]];
  if (keys.length >= 3 && t && typeof t === 'object') t = t.item[keys[2]];
  return t || null;
}
