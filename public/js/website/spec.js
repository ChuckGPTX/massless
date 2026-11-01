// Website specs: the JSON a site is made of. templateSite() writes a complete site from the prompt with no model
// (SITE_RULES is kept for a future model-backed writer); code renders it, and
// sanitizeSite() turns anything (model output, a shared link, an old save) into a valid, safe spec.

import { STYLES, PALETTES, themeFor, isHex, FONTS, MOTION, SPACING } from './theme.js';
import { ICON_NAMES } from './icons.js';
import { MOTIFS } from './art.js';

export const SPEC_VERSION = 1;

export const KINDS = {
  business: { name: 'Business', style: 'friendly', example: 'A site for my lawn care business in Cedar Rapids. Mowing, fertilizing, aeration and fall cleanup.' },
  portfolio: { name: 'Portfolio', style: 'studio', example: 'A portfolio for Ana Ruiz, a wedding and portrait photographer in Austin.' },
  landing: { name: 'Landing page', style: 'swiss', example: 'A landing page for Ledgerly, an app that turns receipts into a tidy monthly budget.' },
  event: { name: 'Event', style: 'bold', example: 'A site for Prairie Code Camp, a one-day developer conference on May 16, 2027 at the Paramount Theatre in Cedar Rapids.' },
  restaurant: { name: 'Restaurant', style: 'luxe', example: 'A site for Casa Verde, a family taqueria in Des Moines with handmade tortillas and a patio.' },
  band: { name: 'Band / artist', style: 'bold', example: 'A site for The Low Lanterns, a four-piece indie folk band from Iowa City. New album and a fall tour.' },
  realestate: { name: 'Real estate listing', style: 'luxe', example: 'A listing site for 1240 Oak Hill Drive, a 4 bed, 3 bath, 2,850 sq ft craftsman in Marion, IA, listed at $485,000.' },
  launch: { name: 'Course / book launch', style: 'editorial', example: 'A launch site for my book "Small Fires", a practical guide to starting a backyard garden, by June Park.' },
  waitlist: { name: 'App waitlist', style: 'aurora', example: 'A waitlist page for Driftwood, an app that plans calm weekend trips within two hours of home.' },
  shop: { name: 'Shop / label', style: 'editorial-shop', example: 'A shop for Kelsa Atelier, a small outerwear label in Lyon making waxed field jackets, wool coats, travel trousers and overshirts.' },
  manifesto: { name: 'Manifesto', style: 'manifesto', example: 'A manifesto for Quiet Hours, a sound studio that believes cities should protect silence as a public good.' },
  cases: { name: 'Case studies', style: 'portfolio-timeline', example: 'A chronological portfolio for Noor Haddad, an interaction designer in Oakland who has shipped maps, cameras, reading apps and a thermostat since 2009.' },
  product: { name: 'AI product launch', style: 'ai-product', example: 'A launch page for Facet, an AI studio that keeps one character looking the same across every photo and video you make.' },
};

// ---------------------------------------------------------------------------------------------
// The section library. Field types: text, para (multi-line), long (article body), link {label, href},
// image {src, alt, prompt}, icon, bool, url, tone, items [{...}], list (one string per line).
// ---------------------------------------------------------------------------------------------

const IMG = 'image';
export const TONES = { base: 'Page', alt: 'Soft', inv: 'Inverse', acc: 'Brand colour' };

export const SECTIONS = {
  hero: {
    name: 'Hero', group: 'Intro', hint: 'Headline, intro and the main button',
    variants: { split: 'Split', centered: 'Centered', cover: 'Full photo', editorial: 'Editorial', banner: 'Page header', portrait: 'Portrait', ambient: 'Ambient', runway: 'Runway', minimal: 'Name card' },
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para', cta: 'link', cta2: 'link', note: 'text', image: IMG },
    labels: { cta: 'Main button', cta2: 'Second button', note: 'Small print' },
  },
  logos: {
    name: 'Logo strip', group: 'Intro', hint: 'Places you serve, platforms, credentials',
    variants: { row: 'Row', marquee: 'Scrolling' },
    fields: { title: 'text', items: { max: 12, item: { name: 'text' } } },
  },
  features: {
    name: 'Features', group: 'Content', hint: 'Services, benefits or what is inside',
    variants: { cards: 'Cards', icons: 'Icons', rows: 'Photo rows', bento: 'Bento' },
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para', items: { max: 8, item: { icon: 'icon', title: 'text', text: 'para', image: IMG } } },
  },
  about: {
    name: 'About', group: 'Content', hint: 'Your story with a photo',
    variants: { split: 'Split', centered: 'Centered' },
    fields: { eyebrow: 'text', title: 'text', text: 'para', points: { max: 6, item: { text: 'text' } }, cta: 'link', image: IMG },
  },
  gallery: {
    name: 'Gallery', group: 'Media', hint: 'A grid of photos',
    variants: { grid: 'Grid', masonry: 'Masonry', strip: 'Scroll strip' },
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para', items: { max: 12, item: { image: IMG, caption: 'text' } } },
  },
  testimonials: {
    name: 'Reviews', group: 'Social proof', hint: 'Placeholders for real reviews you collect',
    variants: { cards: 'Cards', single: 'Big quote' },
    fields: { eyebrow: 'text', title: 'text', items: { max: 6, item: { quote: 'para', name: 'text', role: 'text' } } },
  },
  pricing: {
    name: 'Pricing', group: 'Commerce', hint: 'Plans, packages or tickets',
    variants: { cards: 'Cards', list: 'Price list' },
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para', items: { max: 4, item: { name: 'text', price: 'text', period: 'text', text: 'para', features: 'list', cta: 'link', featured: 'bool' } }, note: 'text' },
  },
  faq: {
    name: 'FAQ', group: 'Content', hint: 'Questions and answers',
    variants: { accordion: 'Accordion', columns: 'Two columns' },
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para', items: { max: 12, item: { q: 'text', a: 'para' } } },
  },
  team: {
    name: 'Team', group: 'Social proof', hint: 'People, speakers or instructors',
    variants: { grid: 'Grid', list: 'List' },
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para', items: { max: 8, item: { name: 'text', role: 'text', bio: 'para', image: IMG } } },
  },
  timeline: {
    name: 'Steps / timeline', group: 'Content', hint: 'How it works, history, curriculum',
    variants: { steps: 'Steps', vertical: 'Timeline' },
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para', items: { max: 8, item: { date: 'text', title: 'text', text: 'para' } } },
  },
  stats: {
    name: 'Stats', group: 'Social proof', hint: 'A few facts as big numbers',
    variants: { row: 'Row', cards: 'Cards' },
    fields: { eyebrow: 'text', title: 'text', items: { max: 4, item: { value: 'text', label: 'text' } } },
  },
  cta: {
    name: 'Call to action', group: 'Contact', hint: 'A closing push to act',
    variants: { band: 'Band', card: 'Card' },
    fields: { title: 'text', text: 'para', cta: 'link', cta2: 'link' },
  },
  contact: {
    name: 'Contact form', group: 'Contact', hint: 'Form, email, phone and hours',
    variants: { split: 'Split', centered: 'Centered' },
    fields: { eyebrow: 'text', title: 'text', text: 'para', hours: 'para', button: 'text' },
  },
  signup: {
    name: 'Email signup', group: 'Contact', hint: 'Waitlist or newsletter',
    variants: { band: 'Band', card: 'Card' },
    fields: { eyebrow: 'text', title: 'text', text: 'para', button: 'text', note: 'text' },
  },
  embed: {
    name: 'Video / map', group: 'Media', hint: 'YouTube, Vimeo, Spotify, SoundCloud or a map',
    variants: { wide: 'Wide', contained: 'Contained' },
    fields: { eyebrow: 'text', title: 'text', url: 'url', caption: 'text' },
  },
  posts: {
    name: 'Blog posts', group: 'CMS', hint: 'Lists the Posts collection, each with its own page',
    variants: { cards: 'Cards', list: 'List' }, collection: 'posts',
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para' },
  },
  listings: {
    name: 'Listings', group: 'CMS', hint: 'Lists the Listings collection, each with its own page',
    variants: { cards: 'Cards', rows: 'Rows' }, collection: 'listings',
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para' },
  },
  listing: {
    name: 'Property details', group: 'Commerce', hint: 'Price, facts, photos and features of one home',
    variants: { details: 'Details', showcase: 'Showcase' },
    fields: { status: 'text', price: 'text', address: 'text', beds: 'text', baths: 'text', sqft: 'text', lot: 'text', year: 'text', text: 'para', points: { max: 12, item: { text: 'text' } }, photos: { max: 8, item: { image: IMG } }, cta: 'link' },
  },
  tracks: {
    name: 'Music player', group: 'CMS', hint: 'Plays the Tracks collection',
    variants: { list: 'List', cover: 'Cover' }, collection: 'tracks',
    fields: { eyebrow: 'text', title: 'text', image: IMG },
  },
  schedule: {
    name: 'Schedule', group: 'Content', hint: 'Agenda, tour dates or class times',
    variants: { list: 'List', columns: 'By day' },
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para', items: { max: 24, item: { day: 'text', time: 'text', title: 'text', text: 'para', link: 'link' } } },
  },
  menu: {
    name: 'Menu', group: 'CMS', hint: 'Lists the Menu collection by category',
    variants: { columns: 'Two columns', list: 'Centered list' }, collection: 'menu',
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para' },
  },
  statement: {
    name: 'Statement', group: 'Content', hint: 'One big sentence, set large',
    variants: { center: 'Centered', left: 'Left', reveal: 'Word by word', framed: 'Framed' },
    fields: { eyebrow: 'text', text: 'para', note: 'text', mark: 'text' },
    labels: { text: 'Statement', note: 'Signed or source', mark: 'Big numeral (framed layout)' },
  },
  lookbook: {
    name: 'Lookbook', group: 'Media', hint: 'Full-bleed editorial photos, one per screen',
    variants: { full: 'Full bleed', pair: 'Pairs', offset: 'Offset' },
    fields: { eyebrow: 'text', title: 'text', items: { max: 8, item: { image: IMG, caption: 'text', note: 'text' } } },
  },
  products: {
    name: 'Products', group: 'Commerce', hint: 'Pieces with prices, as a grid or a lineup',
    variants: { grid: 'Grid', lineup: 'Lineup' },
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para', items: { max: 12, item: { image: IMG, name: 'text', price: 'text', note: 'text', link: 'link' } }, cta: 'link' },
    labels: { cta: 'Button under the grid' },
  },
  chapters: {
    name: 'Chapters', group: 'Content', hint: 'A long read in parts, each with line art',
    variants: { stack: 'Centered', split: 'Numbered' },
    fields: { eyebrow: 'text', title: 'text', items: { max: 10, item: { title: 'text', text: 'para', motif: 'motif' } } },
  },
  cases: {
    name: 'Case studies', group: 'Content', hint: 'Projects in order with year, role and credits',
    variants: { rail: 'Sideways rail', list: 'Year by year' },
    fields: { eyebrow: 'text', title: 'text', items: { max: 12, item: { year: 'text', title: 'text', role: 'text', client: 'text', text: 'para', image: IMG, credits: 'list', link: 'link' } } },
  },
  annotated: {
    name: 'Annotated image', group: 'Media', hint: 'A big image with labels that appear as you scroll',
    variants: { portrait: 'Portrait', wide: 'Wide' },
    fields: { eyebrow: 'text', title: 'text', subtitle: 'para', status: 'text', image: IMG, items: { max: 6, item: { label: 'text' } } },
    labels: { status: 'Status pill' },
  },
  footer: {
    name: 'Footer', group: 'Footer', hint: 'Links, contact and the credit',
    variants: { columns: 'Columns', simple: 'Simple' },
    fields: { tagline: 'para', social: { max: 6, item: { label: 'text', href: 'href' } } },
  },
};
export const SECTION_TYPES = Object.keys(SECTIONS);
export const SECTION_GROUPS = ['Intro', 'Content', 'Media', 'Social proof', 'Commerce', 'CMS', 'Contact', 'Footer'];

export const COLLECTIONS = {
  posts: { name: 'Posts', singular: 'Post', detail: true, fields: { title: 'text', date: 'text', excerpt: 'para', body: 'long', image: IMG } },
  listings: { name: 'Listings', singular: 'Listing', detail: true, fields: { title: 'text', status: 'text', price: 'text', address: 'text', beds: 'text', baths: 'text', sqft: 'text', text: 'long', image: IMG } },
  tracks: { name: 'Tracks', singular: 'Track', fields: { title: 'text', length: 'text', note: 'text', audio: 'audio', link: 'href' } },
  menu: { name: 'Menu', singular: 'Dish', fields: { title: 'text', category: 'text', text: 'para', price: 'text' } },
};

const ANCHORS = { products: 'shop', lookbook: 'lookbook', chapters: 'chapters', cases: 'work', annotated: 'demo', features: 'services', about: 'about', gallery: 'gallery', testimonials: 'reviews', pricing: 'pricing', faq: 'faq', team: 'team', timeline: 'how-it-works', stats: 'facts', contact: 'contact', signup: 'signup', embed: 'watch', posts: 'journal', listings: 'listings', listing: 'details', tracks: 'music', schedule: 'schedule', menu: 'menu' };

// ---------------------------------------------------------------------------------------------
// A system prompt for a model-backed writer (Llama 3.3 70B). Not wired to a server route yet: the page uses templateSite.
// ---------------------------------------------------------------------------------------------

export const SITE_RULES = `You design small, beautiful websites. Reply with JSON only, no prose, no markdown fences:
{"name": string, "tagline": string (max 90 chars), "accent": "#rrggbb" (one brand colour that suits the subject),
 "seo": {"title": string (max 60 chars), "description": string (120 to 155 chars)},
 "contact": {"email": string, "phone": string, "address": string},
 "nav": {"cta": {"label": string, "href": string}},
 "pages": [{"title": "Home", "sections": [section, ...]}, ...],
 "collections": {"posts": [item], "listings": [item], "tracks": [item], "menu": [item]}}
Pages: "Home" first, then 0 to 4 more pages (for example Services, About, Menu, Shows, Contact). Home has 6 to 9 sections; other pages have 3 to 6. Every page starts with a hero (inner pages use the "banner" variant) and ends with a footer.
A section is {"type": string, "variant": string, ...fields}. Image fields are a short photo prompt: subject, setting, light; never text, logos or faces of real people. A link is {"label": max 24 chars, "href": "#contact" | "/about" (a page title in lowercase with dashes) | "mailto:..." | "tel:..." | "https://..."}. Put *asterisks* around one to three words of a title to highlight them.
Section types (variants): fields
- hero (split|centered|cover|editorial|banner): eyebrow, title (max 70 chars), subtitle (max 220 chars), cta, cta2, note, image
- logos (row|marquee): title, items [{name}]: service areas, platforms or credentials named in the prompt; never invented clients, partners or press
- features (cards|icons|rows|bento): eyebrow, title, subtitle, items [{icon, title, text, image}], 3 to 6 items; rows and bento need an image per item
- about (split|centered): eyebrow, title, text (two short paragraphs separated by a blank line), points [{text}], cta, image
- gallery (grid|masonry|strip): eyebrow, title, items [{image, caption}], 4 to 8 items
- testimonials (cards|single): eyebrow, title, items [{"placeholder": true}] x3. Never write quotes or reviewer names; the owner adds real reviews later
- pricing (cards|list): eyebrow, title, subtitle, items [{name, price, period, text, features [strings], cta, featured}], note
- faq (accordion|columns): eyebrow, title, items [{q, a}], 4 to 8 items
- team (grid|list): eyebrow, title, items [{name, role, bio, image}]
- timeline (steps|vertical): eyebrow, title, items [{date, title, text}]; steps use date "01", "02", "03"
- stats (row|cards): items [{value, label}]
- cta (band|card): title, text, cta, cta2
- contact (split|centered): eyebrow, title, text, hours, button
- signup (band|card): eyebrow, title, text, button, note
- embed (wide|contained): title, url: a YouTube, Vimeo, Spotify or SoundCloud link given in the prompt, or "map:" followed by an address or city
- posts (cards|list), listings (cards|rows), tracks (list|cover), menu (columns|list): eyebrow, title, subtitle; they list the matching collection (tracks also takes image)
- listing (details|showcase): status, price, address, beds, baths, sqft, lot, year, text, points [{text}], photos [{image}], cta
- schedule (list|columns): eyebrow, title, items [{day, time, title, text}]
- statement (center|left|reveal|framed): eyebrow, text (one to three sentences, set very large), note, mark (a short numeral for framed)
- lookbook (full|pair|offset): eyebrow, title, items [{image, caption, note}]
- products (grid|lineup): eyebrow, title, subtitle, items [{image, name, price, note, link}], cta; prices only from the prompt
- chapters (stack|split): eyebrow, title, items [{title, text, motif: orbit|wave|horizon|bloom|grid|stairs|none}]
- cases (rail|list): eyebrow, title, items [{year, title, role, client, text, image, credits (one name per line), link}]
- annotated (portrait|wide): eyebrow, title, subtitle, status, image, items [{label}] (2 to 6 short labels)
- hero also has portrait (centered copy over a tall portrait), ambient (a moving line field), runway (a tall editorial photo) and minimal (name card)
- footer (columns|simple): tagline
Icons: leaf sprout sun droplet scissors shield clock calendar pin phone mail heart check sparkle bolt home key users chat camera music mic ticket book cap code chart globe truck wrench brush coffee utensils wine gift smile layers compass rocket pen paw car hammer tooth scale dumbbell lotus bed bath area.
Collection items: posts {title, date, excerpt, body, image}; listings {title, status, price, address, beds, baths, sqft, text, image}; tracks {title, length}; menu {title, category, text, price}. Include a collection only when a section lists it.
Copy: specific, warm and concrete, written for this exact business, person or product, in the language of the prompt. Short sentences. No lorem ipsum, emoji, hashtags or exclamation marks in titles.
Honesty: never invent reviews, testimonials, awards, clients, press, years in business, prices, statistics, phone numbers, emails, addresses or people. Use only facts from the prompt. When a fact is missing, write a short placeholder in square brackets, for example "[Your price]" or "[Your name]", or leave the field out. Use stats only for numbers the prompt gives.`;

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

export const uid = (p = 's') => `${p}${Math.random().toString(36).slice(2, 9)}`;
export function slugify(s, max = 48) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
}
export function getIn(obj, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setIn(obj, path, value) {
  const keys = String(path).split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}
export const isPlaceholder = (s) => /\[[^\]]{1,60}\]/.test(String(s || ''));
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lc = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

const LIMITS = { mark: 12, client: 80, eyebrow: 60, label: 40, value: 24, period: 24, price: 32, time: 32, date: 40, day: 40, length: 12, status: 32, beds: 12, baths: 12, sqft: 16, lot: 24, year: 12, button: 32, name: 80, role: 80, caption: 140, q: 180, tagline: 200, note: 160, title: 140, category: 40, excerpt: 320, alt: 160, prompt: 400 };
const TYPE_LIMIT = { text: 140, para: 1000, long: 12000, list: 1200 };

function clean(v, max = 140, multiline = false) {
  let s = String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/<\/?[a-z][^>]{0,200}>/gi, '');
  if (multiline) s = s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  else s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : s;
}

/** Only links that are safe to put in an href: pages, anchors, http(s), mailto and tel. */
export function safeHref(h) {
  const s = String(h ?? '').trim();
  if (!s) return '';
  if (/^#[\w-]{0,60}$/.test(s)) return s;
  if (/^\/[\w\-/]{0,80}(#[\w-]{0,60})?$/.test(s)) return s.toLowerCase();
  if (/^mailto:[^\s<>"]{3,200}$/i.test(s)) return s;
  if (/^tel:\+?[\d\s().-]{3,30}$/i.test(s)) return s.replace(/\s/g, '');
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' || u.protocol === 'http:') return u.href.slice(0, 400);
  } catch { /* not a URL */ }
  return '';
}
export const safeEmail = (e) => (/^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[a-z]{2,}$/i.test(String(e || '').trim()) ? String(e).trim() : '');
export function safeFormUrl(u) {
  try {
    const x = new URL(String(u || '').trim());
    return x.protocol === 'https:' ? x.href.slice(0, 400) : '';
  } catch {
    return '';
  }
}

/** Embeds we know how to show safely: video, music and maps. Returns { kind, src, title } or null. */
export function embedFor(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^map:/i.test(s)) {
    const q = s.slice(4).trim().slice(0, 160);
    return q ? { kind: 'map', src: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`, title: `Map of ${q}`, label: q } : null;
  }
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let m;
  if (host === 'youtu.be' && (m = u.pathname.match(/^\/([\w-]{6,20})/))) return { kind: 'video', src: `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1`, title: 'Video' };
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{6,20})/) || [])[1];
    if (id && /^[\w-]{6,20}$/.test(id)) return { kind: 'video', src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`, title: 'Video' };
  }
  if (host === 'vimeo.com' && (m = u.pathname.match(/^\/(\d{5,12})/))) return { kind: 'video', src: `https://player.vimeo.com/video/${m[1]}?autoplay=1`, title: 'Video' };
  if (host === 'player.vimeo.com' && (m = u.pathname.match(/^\/video\/(\d{5,12})/))) return { kind: 'video', src: `https://player.vimeo.com/video/${m[1]}?autoplay=1`, title: 'Video' };
  if (host === 'open.spotify.com' && (m = u.pathname.match(/^\/(?:embed\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]{10,30})/))) return { kind: 'audio', src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, title: 'Spotify player' };
  if (host === 'soundcloud.com' && u.pathname.split('/').filter(Boolean).length >= 1) return { kind: 'audio', src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.origin + u.pathname)}&color=%23333333&visual=true`, title: 'SoundCloud player' };
  if (host === 'google.com' && u.pathname.startsWith('/maps')) {
    const q = u.searchParams.get('q') || decodeURIComponent((u.pathname.match(/\/maps\/(?:place|search)\/([^/]+)/) || [])[1] || '').replace(/\+/g, ' ');
    if (q) return embedFor(`map:${q}`);
  }
  if (host === 'openstreetmap.org') return { kind: 'map', src: `https://www.openstreetmap.org/export/embed.html${u.search || ''}`, title: 'Map' };
  return null;
}

// ---------------------------------------------------------------------------------------------
// Reading the prompt (no model): names, places, dates, prices and the kind of business
// ---------------------------------------------------------------------------------------------

const INDUSTRIES = [
  { re: /lawn|landscap|yard|mow|turf|sod\b|garden(ing|er)? (service|care)/i, label: 'Lawn care', noun: 'lawn care', what: 'lawns', accent: '#2e7d4f', cta: 'Get a free quote',
    head: ['Lawn care in {L}, *done right.*', 'A greener yard, *every week.*'],
    sub: '{N} keeps {L|local} lawns thick, green and neatly edged, with dependable weekly service and clear pricing.',
    services: [['leaf', 'Weekly mowing', 'Clean lines, trimmed edges and clippings blown off the drive, on the same day each week.'], ['sprout', 'Fertilizing and weed control', 'A seasonal program that feeds the grass and keeps dandelions and crabgrass out.'], ['droplet', 'Aeration and overseeding', 'Loosen compacted soil and thicken thin patches so the lawn fills in.'], ['sun', 'Spring and fall cleanup', 'Leaves, sticks and beds cleared, so every season starts tidy.']],
    photos: ['a freshly mowed suburban lawn with crisp stripes in soft morning light', 'close up of a string trimmer edging grass along a concrete walkway', 'a lush green backyard with tidy flower beds at golden hour', 'a riding mower crossing a large green lawn under a blue sky', 'fallen autumn leaves raked into a neat pile on green grass', 'a lawn aerator leaving soil plugs on a green lawn'] },
  { re: /clean(ing|er|ers)?\b|maid|janitor/i, label: 'Cleaning', noun: 'cleaning', what: 'homes', accent: '#0e7490', cta: 'Book a clean',
    head: ['A spotless home in {L}, *without lifting a finger.*', 'Come home to *clean.*'],
    sub: '{N} brings careful, consistent cleaning to {L|your} homes and offices, with a checklist you can see.',
    services: [['sparkle', 'Regular cleaning', 'Weekly or every other week: kitchens, bathrooms, floors and dusting, done the same careful way each time.'], ['home', 'Deep cleaning', 'Baseboards, inside appliances and the corners a regular clean skips.'], ['truck', 'Move in, move out', 'Empty-home cleaning that gets a deposit back or a new place ready.'], ['layers', 'Offices', 'After-hours cleaning for small offices and studios.']],
    photos: ['a bright clean modern kitchen with sunlight on the counters', 'neatly folded white towels on a bathroom shelf', 'a tidy living room with plants and soft daylight', 'cleaning supplies in a woven caddy on a wooden floor'] },
  { re: /plumb|hvac|heating|furnace|electric(ian|al)|handyman|roof|contractor|remodel|carpent|construct|builder|paint(ing|er)s?\b|gutter/i, label: 'Home services', noun: 'home repair', what: 'homes', accent: '#c2410c', cta: 'Request a quote',
    head: ['Repairs done right in {L}, *the first time.*', 'Skilled work, *clear quotes.*'],
    sub: '{N} handles {L|local} repairs and projects with tidy work sites, upfront quotes and people who answer the phone.',
    services: [['wrench', 'Repairs', 'Leaks, faults and the small jobs that pile up, fixed properly.'], ['hammer', 'Projects', 'Planned upgrades with a clear scope, timeline and price before we start.'], ['shield', 'Inspections', 'A straight answer on what needs doing now and what can wait.'], ['clock', 'Scheduled visits', 'Arrival windows we keep, and a text when we are on the way.']],
    photos: ['a tradesperson toolbox on a workbench in a bright garage', 'a freshly renovated kitchen with wood cabinets', 'hands holding a level against a newly built wall', 'a tidy work van parked outside a suburban home'] },
  { re: /salon|barber|hair|nail|beauty|spa\b|lash|brow|stylist/i, label: 'Salon', noun: 'salon', what: 'clients', accent: '#c8385e', cta: 'Book an appointment',
    head: ['Hair and beauty in {L}, *made personal.*', 'Look like *you*, only more so.'],
    sub: '{N} is a calm, friendly studio for cuts, colour and care, with time set aside for every appointment.',
    services: [['scissors', 'Cuts and styling', 'A consultation first, then a cut that suits how you actually wear your hair.'], ['brush', 'Colour', 'Glosses, highlights and full colour, tested and talked through.'], ['sparkle', 'Treatments', 'Conditioning and scalp care for hair that needs a reset.'], ['heart', 'Special occasions', 'Weddings, events and photo days, booked ahead.']],
    photos: ['a bright minimal hair salon with mirrors and plants', 'a stylist cutting hair in a sunlit salon, hands and scissors close up', 'salon chairs and warm lighting in a calm studio', 'hair care bottles on a marble shelf'] },
  { re: /gym|fitness|personal train|yoga|pilates|crossfit|boxing|martial|dance studio/i, label: 'Fitness', noun: 'training', what: 'members', accent: '#ff4a1c', cta: 'Book a free class',
    head: ['Get strong in {L}, *at your pace.*', 'Training that *fits your life.*'],
    sub: '{N} offers coached classes and one-to-one sessions for every level, in a space that feels welcoming from the first visit.',
    services: [['dumbbell', 'Strength classes', 'Small groups, real coaching and progress you can track.'], ['bolt', 'Conditioning', 'Short, focused sessions that build fitness without burning you out.'], ['users', 'Personal training', 'A plan built around your goals, schedule and history.'], ['lotus', 'Mobility', 'Stretching and recovery so you keep moving well.']],
    photos: ['a bright modern gym with weights and natural light', 'people stretching on mats in a sunny studio', 'a coach guiding a kettlebell swing, motion blur', 'a calm yoga studio with wooden floors and plants'] },
  { re: /photograph|videograph|filmmak/i, label: 'Photography', noun: 'photography', what: 'clients', accent: '#3b3a36', cta: 'Check availability',
    head: ['Photographs that feel like *the day felt.*', 'Honest, *unposed* photography.'],
    sub: '{N} photographs weddings, families and brands{ in L}, with a calm, documentary approach.',
    services: [['heart', 'Weddings', 'The whole day, from getting ready to the last dance.'], ['users', 'Portraits and families', 'Relaxed sessions at home or somewhere that matters to you.'], ['camera', 'Brands', 'Images for websites, menus and launches.']],
    photos: ['a candid black and white photo of a couple laughing outdoors', 'a family walking through a golden field at sunset', 'a detail shot of wedding rings on linen', 'a portrait in soft window light'] },
  { re: /dent(ist|al)|clinic|chiro|physio|therap(y|ist)|counsel|medical|doctor|vet(erinar)?/i, label: 'Clinic', noun: 'care', what: 'patients', accent: '#0e7490', cta: 'Book a visit',
    head: ['Gentle, modern care in {L}.', 'Care that *takes its time.*'],
    sub: '{N} offers unhurried appointments, clear explanations and a calm space{ in L}.',
    services: [['shield', 'Checkups', 'Thorough, unrushed visits with time for your questions.'], ['heart', 'Treatment', 'Options explained plainly, with costs before we begin.'], ['calendar', 'Easy booking', 'Appointments that fit around work and school.']],
    photos: ['a bright calm clinic waiting room with plants', 'a modern treatment room with soft light', 'a friendly reception desk in a clinic'] },
  { re: /law(yer)?\b|attorney|legal|account(ant|ing)|bookkeep|tax(es)?\b|cpa\b|financial|insurance/i, label: 'Professional services', noun: 'advice', what: 'clients', accent: '#2f54eb', cta: 'Book a consultation',
    head: ['Clear advice in {L}, *in plain English.*', 'Straight answers, *no jargon.*'],
    sub: '{N} helps individuals and small businesses{ in L} make good decisions, with fixed quotes and quick replies.',
    services: [['chat', 'Consultations', 'A first conversation to understand where you are and what you need.'], ['book', 'Ongoing support', 'A steady hand through the year, not just at deadlines.'], ['shield', 'Peace of mind', 'Work checked twice and explained once, clearly.']],
    photos: ['a tidy modern office desk with a notebook and coffee', 'a bright meeting room with a wooden table', 'a calm workspace with plants and daylight'] },
  { re: /pet|dog|groom|cat\b|puppy|kennel/i, label: 'Pet care', noun: 'pet care', what: 'pets', accent: '#c2410c', cta: 'Book a visit',
    head: ['Happy pets in {L}, *every time.*', 'Care your pet *will love.*'],
    sub: '{N} gives {L|local} dogs and cats patient, gentle care, with updates and photos for you.',
    services: [['paw', 'Grooming', 'Baths, trims and nails, at a pace that keeps pets calm.'], ['heart', 'Daycare and walks', 'Exercise and company while you are at work.'], ['home', 'Home visits', 'Feeding, play and fresh water when you are away.']],
    photos: ['a happy freshly groomed dog in soft daylight', 'a dog walker with two dogs on a leafy street', 'a cat lounging in a sunny window'] },
  { re: /auto|mechanic|car (repair|wash)|detailing|tire|garage/i, label: 'Auto', noun: 'auto service', what: 'cars', accent: '#2f54eb', cta: 'Book service',
    head: ['Honest car care in {L}.', 'Your car, *looked after.*'],
    sub: '{N} explains the problem before fixing it, quotes before starting, and has you back on the road quickly.',
    services: [['car', 'Maintenance', 'Oil, brakes, tires and the scheduled service your car needs.'], ['wrench', 'Repairs', 'Diagnostics first, then the fix, with the old parts shown to you.'], ['sparkle', 'Detailing', 'Inside and out, back to that new-car feeling.']],
    photos: ['a clean modern auto repair shop with a car on a lift', 'a mechanic checking an engine with a flashlight', 'a freshly detailed car gleaming in sunlight'] },
  { re: /tutor|lesson|teach|school|class(es)?\b|music lessons|coach(ing)?\b/i, label: 'Lessons', noun: 'lessons', what: 'students', accent: '#6d4aff', cta: 'Book a trial lesson',
    head: ['Lessons in {L} that *actually stick.*', 'Learn with *patience.*'],
    sub: '{N} offers one-to-one and small-group lessons with a plan for every student.',
    services: [['cap', 'One-to-one', 'Lessons shaped around how each student learns.'], ['users', 'Small groups', 'Friendly groups for practice and motivation.'], ['book', 'Progress reports', 'Short notes after lessons so families know what is next.']],
    photos: ['a student and tutor at a bright desk with books', 'hands on a piano keyboard in soft light', 'a cozy study space with notebooks and a lamp'] },
  { re: /design|agency|studio|marketing|consult|brand(ing)?\b|web ?(site)?s?\b|developer/i, label: 'Studio', noun: 'design', what: 'clients', accent: '#2f54eb', cta: 'Start a project',
    head: ['Design that makes *the work clear.*', 'Brands and websites, *built to last.*'],
    sub: '{N} is a small studio{ in L} making brands, websites and campaigns for teams who care about the details.',
    services: [['pen', 'Brand identity', 'Names, logos and systems that hold together everywhere.'], ['code', 'Websites', 'Fast, accessible sites that are easy to update.'], ['chart', 'Campaigns', 'Launch work that is measured, not just admired.']],
    photos: ['a designer desk with sketches, swatches and a laptop', 'a minimal studio with large windows and plants', 'printed brand guidelines spread on a table'] },
  { re: /florist|flower|wedding plann|event plann|bridal/i, label: 'Events', noun: 'events', what: 'clients', accent: '#c8385e', cta: 'Check your date',
    head: ['Flowers and details *for the days that matter.*', 'Celebrations, *beautifully planned.*'],
    sub: '{N} designs flowers and celebrations{ in L}, from first idea to the last petal swept up.',
    services: [['heart', 'Weddings', 'Bouquets, tables and installations designed around your day.'], ['gift', 'Gifts and deliveries', 'Seasonal arrangements, delivered the same day.'], ['sparkle', 'Events', 'Launches, dinners and parties with a clear plan and budget.']],
    photos: ['a lush wedding bouquet with peonies and greenery', 'a long dinner table decorated with candles and flowers', 'a florist arranging flowers in a sunny workshop'] },
];
const GENERIC = { label: 'Local business', noun: 'service', what: 'customers', accent: '#2e7d4f', cta: 'Get in touch',
  head: ['{N}: *done right.*', 'Good work, *close to home.*'],
  sub: '{N} serves {L|local} customers with careful work, fair prices and quick replies.',
  services: [['check', 'Quality work', 'Done carefully, checked twice and finished on time.'], ['clock', 'On schedule', 'Clear dates, and a heads-up if anything changes.'], ['chat', 'Easy to reach', 'Real people who answer messages the same day.']],
  photos: ['a bright welcoming storefront on a main street', 'a craftsperson at work in a tidy workshop', 'a friendly team meeting in a sunny office'] };

const CUISINES = [
  [/taco|taqueria|mexican|burrito/i, 'Mexican', ['Al pastor tacos', 'Carne asada plate', 'Chicken tinga tostadas', 'Elote', 'Horchata', 'Churros'], 'tacos on a rustic table with lime and cilantro'],
  [/pizza|pizzeria|italian|pasta|trattoria/i, 'Italian', ['Margherita', 'Spicy salami', 'Cacio e pepe', 'Burrata and tomatoes', 'Tiramisu', 'Affogato'], 'a wood-fired pizza with blistered crust on a marble counter'],
  [/sushi|ramen|japanese|izakaya/i, 'Japanese', ['Shoyu ramen', 'Spicy miso ramen', 'Salmon nigiri', 'Gyoza', 'Edamame', 'Matcha ice cream'], 'a steaming bowl of ramen with a soft egg'],
  [/thai|vietnam|pho|banh/i, 'Southeast Asian', ['Pho', 'Pad see ew', 'Green curry', 'Banh mi', 'Fresh rolls', 'Mango sticky rice'], 'a bowl of pho with fresh herbs and lime'],
  [/indian|curry|tandoor/i, 'Indian', ['Butter chicken', 'Chana masala', 'Lamb rogan josh', 'Garlic naan', 'Samosas', 'Mango lassi'], 'colorful curries in copper bowls with naan'],
  [/bbq|barbecue|smokehouse/i, 'Barbecue', ['Brisket plate', 'Pulled pork sandwich', 'Smoked ribs', 'Mac and cheese', 'Slaw', 'Banana pudding'], 'smoked brisket slices on butcher paper'],
  [/bak(e|ery)|pastr|patisserie|bread/i, 'Bakery', ['Sourdough loaf', 'Butter croissant', 'Cardamom bun', 'Seasonal galette', 'Cookies', 'Coffee'], 'fresh croissants and bread on a bakery counter in morning light'],
  [/coffee|cafe|café|espresso|roaster/i, 'Café', ['Espresso', 'Flat white', 'Cold brew', 'Avocado toast', 'Granola bowl', 'Pastries'], 'a latte with latte art on a wooden cafe table'],
  [/burger|diner|grill/i, 'Diner', ['Classic smash burger', 'Fried chicken sandwich', 'Fries', 'Milkshake', 'Breakfast plate', 'Pie'], 'a juicy smash burger with fries in a diner booth'],
  [/vegan|plant/i, 'Plant-based', ['Grain bowl', 'Mushroom tacos', 'Cauliflower wings', 'Seasonal salad', 'Smoothie', 'Chocolate tart'], 'a colorful plant-based grain bowl on a linen tablecloth'],
];

const STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC';
const NOT_NAME = /^(A|An|My|Our|Site|Website|Page|Landing|Portfolio|Listing|Launch|Waitlist|For|In|With|And|Of|I|We)$/;

export function readPrompt(prompt = '') {
  const p = String(prompt).replace(/\s+/g, ' ').trim();
  const out = { raw: p };
  const q = p.match(/["“”]([^"“”]{2,60})["“”]/);
  if (q) out.quoted = q[1].trim();
  const called = p.match(/\b(?:called|named)\s+((?:[A-Z0-9][\w&'’.-]*)(?:\s+(?:of|the|and|&|[A-Z0-9][\w&'’.-]*)){0,4})/);
  if (called) out.called = called[1].replace(/[.,]$/, '');
  const forName = p.match(/\bfor\s+((?:[A-Z][\w&'’-]*)(?:\s+(?:of|the|and|&|[A-Z][\w&'’-]*)){0,4})/);
  if (forName && !NOT_NAME.test(forName[1].split(' ')[0])) out.forName = forName[1];
  // "The Night Owls, a jazz trio from Chicago" / "Prairie Code, a developer conference": a name, then what it is
  const lead = p.match(/^((?:The\s+)?[A-Z0-9][\w&'’.-]*(?:\s+(?:of|the|and|&|[A-Z0-9][\w&'’.-]*)){0,4}),\s+(?:a|an|the|our|my)\s/);
  if (lead && !NOT_NAME.test(lead[1].split(' ')[0]) && !/^(A|An|My|Our)$/.test(lead[1])) out.lead = lead[1];
  const loc = p.match(/\b(?:in|near|around|serving|from|based in|located in)\s+((?:[A-Z][a-zA-Z'’-]+)(?:\s+[A-Z][a-zA-Z'’-]+){0,2}(?:,\s*[A-Z]{2}\b)?)/);
  if (loc && !/^(The|My|Our|A)$/.test(loc[1])) out.place = loc[1].replace(/,\s*$/, '');
  const email = p.match(/[\w.+-]+@[\w-]+\.[\w.-]*\w/);
  if (email) out.email = email[0];
  const phone = p.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
  if (phone) out.phone = phone[0];
  const price = p.match(/\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?/);
  if (price) out.price = price[0].replace(/\s/g, '');
  const date = p.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:\s*[–-]\s*\d{1,2})?(?:,?\s*\d{4})?/i);
  if (date) out.date = date[0];
  const addr = p.match(/\b\d{1,6}\s+(?:[A-Z][\w.']*\s+){1,4}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Lane|Ln|Dr|Drive|Way|Ct|Court|Pl|Place|Terrace|Pkwy|Parkway|Circle|Cir)\b\.?/);
  if (addr) out.address = addr[0];
  const beds = p.match(/(\d+(?:\.\d)?)[\s-]*(?:bed(room)?s?|bd|br)\b/i);
  if (beds) out.beds = beds[1];
  const baths = p.match(/(\d+(?:\.\d)?)[\s-]*(?:bath(room)?s?|ba)\b/i);
  if (baths) out.baths = baths[1];
  const sqft = p.match(/([\d,]{3,7})\s*(?:sq\.?\s*ft|square[\s-]feet|sf)\b/i);
  if (sqft) out.sqft = sqft[1];
  const venue = p.match(/\bat\s+(?:the\s+)?((?:[A-Z][\w'’&-]*\s?){1,5})/);
  if (venue) out.venue = venue[1].trim();
  const by = p.match(/\bby\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'’-]+){1,2})/);
  if (by) out.author = by[1];
  const person = p.match(/\b(?:for|by|of|named)\s+([A-Z][a-z]+\s+[A-Z][a-z'’-]+)\b/);
  if (person) out.person = person[1];
  const my = p.match(/\bmy\s+([a-z][a-z\s&-]{2,40}?)\s+(?:business|company|shop|studio|service|services|practice|clinic|salon|restaurant|bakery|cafe|band|app|course|book|agency|firm|store)\b/i);
  if (my) out.topic = my[1].trim();
  const appo = p.match(/,\s+((?:a|an)\s+[^,.;]{4,90}?)(?=\s+(?:on|at|in|from|with|based|that)\b|[,.;]|$)/i);
  if (appo) out.desc = appo[1].trim();
  const withs = p.match(/\bwith\s+([^.;]{4,100})/i);
  if (withs) out.extra = withs[1].trim();
  const sentences = p.split(/(?<=[.!?])\s+/);
  if (sentences.length > 1) out.more = sentences.slice(1).join(' ').slice(0, 200);
  out.industry = INDUSTRIES.find((x) => x.re.test(p)) || null;
  out.cuisine = CUISINES.find(([re]) => re.test(p)) || null;
  out.numbers = (p.match(/\d[\d,.]*/g) || []).map((n) => n.replace(/[,.]+$/, ''));
  return out;
}

function nameFrom(r, kind) {
  const n = r.called || r.quoted || r.forName || r.lead;
  if (n && n.length <= 48) return n;
  if (kind === 'portfolio' && r.person) return r.person;
  if (kind === 'realestate' && r.address) return r.address;
  const ind = r.industry || GENERIC;
  const topic = r.topic ? r.topic.replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  if (kind === 'business') return r.place ? `${r.place.replace(/,.*$/, '')} ${topic || ind.label}` : topic || ind.label;
  if (kind === 'restaurant') return r.cuisine ? `${r.place ? `${r.place.replace(/,.*$/, '')} ` : ''}${r.cuisine[1]} Kitchen` : 'The Kitchen';
  return { portfolio: 'Your Name', landing: 'Your Product', event: 'Your Event', band: 'Your Band', realestate: 'Your Listing', launch: 'Your Book', waitlist: 'Your App' }[kind] || 'Your Site';
}

/** "Turns receipts into a tidy monthly budget" -> "Turns receipts into a *tidy monthly budget.*" */
function emphasizeTail(t) {
  const w = String(t).replace(/[.!]+$/, '').split(' ');
  const k = w.length >= 6 ? 3 : Math.min(2, w.length);
  return `${w.slice(0, w.length - k).join(' ')} *${w.slice(-k).join(' ')}.*`.trim();
}


/** "making waxed jackets, wool coats and travel trousers" -> ['waxed jackets', 'wool coats', 'travel trousers'] */
function nounList(raw) {
  const m = String(raw).match(/\b(?:making|makes|make|selling|sells|sell|offering|offers|designing|designs|stocking|stocks)\s+([^.;]{4,180})/i);
  if (!m) return [];
  return m[1].split(/,\s*|\s+and\s+|\s*&\s*/).map((x) => x.trim().replace(/^(and|or|the|a|an)\s+/i, '')).filter((x) => x && x.split(' ').length <= 5).slice(0, 6);
}
const singular = (s) => String(s).replace(/ies$/i, 'y').replace(/(?<![su])s$/i, '');

const fill = (tpl, N, L) => tpl
  .replace(/\{ in L\}/g, L && !N.includes(L) ? ` in ${L}` : '')
  .replace(/\{L\|([^}]*)\}/g, (_, d) => (L && !N.includes(L) ? L : d))
  .replace(/\{L\}/g, L || 'your area')
  .replace(/\{N\}/g, N);

// ---------------------------------------------------------------------------------------------
// Building blocks for templates (also used when adding a section in the editor)
// ---------------------------------------------------------------------------------------------

const im = (prompt, alt) => ({ src: '', alt: alt || cap(clean(prompt, 120).replace(/^(a|an|the)\s+/i, '')), prompt });
const link = (label, href) => ({ label, href });
const sec = (type, variant, fields = {}, tone = 'base') => ({ id: uid('s'), type, variant, tone, ...fields });
const placeholderReviews = (n = 3) => Array.from({ length: n }, () => ({ quote: 'Placeholder: paste a real review from a customer here, with their permission.', name: 'Customer name', role: 'Placeholder', ph: true }));

/** Default content for a new section of any type (the editor's "Add section"). */
export function newSection(type, site = {}) {
  const N = site.name || 'Your site';
  const photo = (k) => im(`${['a bright modern interior with natural light', 'a detail shot of hands at work', 'an inviting storefront at golden hour', 'a calm landscape at sunrise'][k % 4]}`);
  const make = {
    hero: () => sec('hero', 'split', { eyebrow: 'Welcome', title: `${N}, *at its best.*`, subtitle: 'Say what you do, who it is for and why it is worth a look, in one or two sentences.', cta: link('Get in touch', '#contact'), cta2: link('Learn more', '#services'), note: '', image: photo(0) }),
    logos: () => sec('logos', 'row', { title: 'Proudly serving', items: ['[Town one]', '[Town two]', '[Town three]', '[Town four]'].map((name) => ({ name, ph: true })) }),
    features: () => sec('features', 'cards', { eyebrow: 'What we do', title: 'Everything you *need*', subtitle: '', items: [['sparkle', 'First feature', 'One or two sentences about what it is and why it helps.'], ['shield', 'Second feature', 'One or two sentences about what it is and why it helps.'], ['clock', 'Third feature', 'One or two sentences about what it is and why it helps.']].map(([icon, title, text], k) => ({ icon, title, text, image: photo(k) })) }),
    about: () => sec('about', 'split', { eyebrow: 'About', title: 'The story *so far*', text: 'Tell visitors who you are and how you started.\n\nThen say what you care about, in plain words.', points: [{ text: 'A promise you keep' }, { text: 'Another promise you keep' }], cta: link('Get in touch', '#contact'), image: photo(1) }, 'alt'),
    gallery: () => sec('gallery', 'grid', { eyebrow: 'Gallery', title: 'Recent *work*', subtitle: '', items: [0, 1, 2, 3, 4, 5].map((k) => ({ image: photo(k), caption: '' })) }),
    testimonials: () => sec('testimonials', 'cards', { eyebrow: 'Reviews', title: 'What people *say*', items: placeholderReviews(3) }, 'alt'),
    pricing: () => sec('pricing', 'cards', { eyebrow: 'Pricing', title: 'Simple, *clear* pricing', subtitle: '', note: '', items: [['Starter', ''], ['Standard', 'Recommended'], ['Premium', '']].map(([name, badge], k) => ({ name, price: '[Price]', period: '', text: 'Who this option is for.', features: 'First thing included\nSecond thing included\nThird thing included', cta: link('Choose', '#contact'), featured: k === 1, ph: true })) }),
    faq: () => sec('faq', 'accordion', { eyebrow: 'FAQ', title: 'Questions, *answered*', subtitle: '', items: [['What do you offer?', 'A short, direct answer.'], ['How do I get started?', 'A short, direct answer.'], ['Where are you based?', 'A short, direct answer.']].map(([q, a]) => ({ q, a })) }),
    team: () => sec('team', 'grid', { eyebrow: 'Team', title: 'The *people*', subtitle: '', items: [0, 1, 2].map((k) => ({ name: 'Your name', role: 'Role', bio: '', image: im('a friendly professional portrait in soft window light', 'Portrait'), ph: true })) }),
    timeline: () => sec('timeline', 'steps', { eyebrow: 'How it works', title: 'Three *simple* steps', subtitle: '', items: [['01', 'Get in touch', 'Tell us what you need.'], ['02', 'Get a plan', 'We reply with a clear plan and price.'], ['03', 'Relax', 'We take it from there.']].map(([date, title, text]) => ({ date, title, text })) }),
    stats: () => sec('stats', 'row', { eyebrow: '', title: '', items: [['[0]', 'First fact'], ['[0]', 'Second fact'], ['[0]', 'Third fact']].map(([value, label]) => ({ value, label, ph: true })) }, 'inv'),
    cta: () => sec('cta', 'band', { title: 'Ready when *you* are', text: 'One sentence that makes the next step feel easy.', cta: link('Get in touch', '#contact'), cta2: { label: '', href: '' } }, 'acc'),
    contact: () => sec('contact', 'split', { eyebrow: 'Contact', title: 'Say *hello*', text: 'Send a message and we will reply within one business day.', hours: '', button: 'Send message' }),
    signup: () => sec('signup', 'card', { eyebrow: 'Stay in the loop', title: 'Get the *news* first', text: 'One short email when there is something worth sharing.', button: 'Join the list', note: 'No spam. Unsubscribe any time.' }),
    embed: () => sec('embed', 'contained', { eyebrow: '', title: site.contact?.address ? 'Find *us*' : 'Watch', url: site.contact?.address ? `map:${site.contact.address}` : '', caption: '' }),
    posts: () => sec('posts', 'cards', { eyebrow: 'Journal', title: 'Latest *posts*', subtitle: '' }),
    listings: () => sec('listings', 'cards', { eyebrow: 'Listings', title: 'Homes for *sale*', subtitle: '' }),
    listing: () => sec('listing', 'details', { status: 'For sale', price: '[Price]', address: '[Street address]', beds: '[0]', baths: '[0]', sqft: '[0]', lot: '', year: '', text: 'Describe the home: light, layout, the kitchen, the yard and the street.', points: [{ text: 'A favorite feature' }, { text: 'Another favorite feature' }], photos: [0, 1, 2, 3, 4].map((k) => ({ image: im(['a bright living room with large windows', 'a modern kitchen with an island', 'a cozy bedroom with soft light', 'a backyard with a deck at golden hour', 'a front porch of a craftsman home'][k]) })), cta: link('Schedule a tour', '#contact') }),
    tracks: () => sec('tracks', 'list', { eyebrow: 'Music', title: 'Listen', image: im('an album cover style photo of a guitar leaning on an amp in warm light', 'Album artwork') }),
    schedule: () => sec('schedule', 'list', { eyebrow: 'Schedule', title: 'What is *on*', subtitle: '', items: [['[Day]', '[Time]', 'First item', ''], ['[Day]', '[Time]', 'Second item', '']].map(([day, time, title, text]) => ({ day, time, title, text, link: { label: '', href: '' }, ph: true })) }),
    menu: () => sec('menu', 'columns', { eyebrow: 'Menu', title: 'From the *kitchen*', subtitle: '' }),
    footer: () => sec('footer', 'columns', { tagline: site.tagline || '', social: [] }, 'inv'),
    statement: () => sec('statement', 'center', { eyebrow: '', text: 'Say the one thing you want every visitor to remember, in a sentence or two.', note: '', mark: '' }),
    lookbook: () => sec('lookbook', 'full', { eyebrow: 'Lookbook', title: '', items: [0, 1, 2].map((k) => ({ image: im(['a model in a long coat walking through a concrete courtyard, editorial fashion photograph', 'a close crop of a wool jacket collar in soft daylight', 'two people in neutral outerwear on a city bridge at dusk'][k]), caption: `Look ${String(k + 1).padStart(2, '0')}`, note: '' })) }),
    products: () => sec('products', 'grid', { eyebrow: 'Shop', title: 'New *in*', subtitle: '', cta: { label: '', href: '' }, items: [0, 1, 2, 3].map((k) => ({ image: im(`a studio product photo of piece ${k + 1}, plain backdrop`), name: `Piece ${k + 1}`, price: '[Price]', note: '', link: { label: '', href: '' }, ph: true })) }),
    chapters: () => sec('chapters', 'stack', { eyebrow: 'Manifesto', title: '', items: [['Something is *out of balance*', 'Name the problem plainly, with one fact you can stand behind.', 'wave'], ['What we *believe*', 'Say what you hold to be true, and what you will not compromise on.', 'horizon'], ['What happens *next*', 'Tell people how to be part of it.', 'stairs']].map(([title, text, motif]) => ({ title, text, motif })) }),
    cases: () => sec('cases', 'list', { eyebrow: 'Work', title: 'Selected *projects*', items: [0, 1, 2].map((k) => ({ year: String(new Date().getFullYear() - k * 2), title: `[Project ${k + 1}]`, role: '[Your role]', client: '[Client or team]', text: 'The problem, what you did and what changed, in two sentences.', image: im('an app interface shown on a laptop, clean studio light'), credits: '', link: { label: '', href: '' }, ph: true })) }),
    annotated: () => sec('annotated', 'portrait', { eyebrow: 'How it works', title: 'Every *detail*, kept', subtitle: '', status: 'Working', image: im('a studio portrait in soft daylight, plain warm backdrop'), items: ['First detail', 'Second detail', 'Third detail', 'Fourth detail'].map((label) => ({ label })) }),
  };
  return (make[type] || make.features)();
}

const blankCollections = () => ({ posts: [], listings: [], tracks: [], menu: [] });

/** Minimal sample items for a collection (the CMS "Add" and new list sections). */
export function newItem(col) {
  const base = { id: uid('i') };
  if (col === 'posts') return { ...base, title: 'A new post', date: new Date().toISOString().slice(0, 10), excerpt: 'A sentence or two that makes people want to read on.', body: 'Write the post here.\n\nBlank lines start new paragraphs.', image: im('a calm desk with a notebook and coffee in morning light') };
  if (col === 'listings') return { ...base, title: '[Street address]', status: 'For sale', price: '[Price]', address: '[City, State]', beds: '[0]', baths: '[0]', sqft: '[0]', text: 'Describe the home.', image: im('the front of a modern craftsman house at golden hour'), ph: true };
  if (col === 'tracks') return { ...base, title: '[Song title]', length: '', note: '', audio: '', link: '', ph: true };
  return { ...base, title: 'New dish', category: 'Mains', text: 'What is in it.', price: '' };
}

// ---------------------------------------------------------------------------------------------
// templateSite(): a full site from the prompt with no model
// ---------------------------------------------------------------------------------------------

const page = (title, sections, slug) => ({ id: uid('p'), slug: slug ?? slugify(title), title, seo: { title: '', description: '' }, sections });
const banner = (eyebrow, title, subtitle = '') => sec('hero', 'banner', { eyebrow, title, subtitle, cta: { label: '', href: '' }, cta2: { label: '', href: '' }, note: '', image: im('') });
const footer = (tagline) => sec('footer', 'columns', { tagline, social: [] }, 'inv');
const faqItems = (pairs) => pairs.map(([q, a]) => ({ q, a }));

export function templateSite({ prompt = '', kind = 'business', style } = {}) {
  if (!KINDS[kind]) kind = 'business';
  const r = readPrompt(prompt);
  const N = nameFrom(r, kind);
  const L = r.place || '';
  const ind = r.industry || GENERIC;
  const styleId = STYLES[style] ? style : KINDS[kind].style;
  const P = (k) => ind.photos[k % ind.photos.length];
  const contactSec = (title = `Talk to *${N}*`, text = 'Send a message and we will get back to you within one business day.') => sec('contact', 'split', { eyebrow: 'Contact', title, text, hours: '', button: 'Send message' });
  let pages;
  let tagline = '';
  let accent = ind.accent;
  let navCta = link(ind.cta, '/contact');
  const collections = blankCollections();

  if (kind === 'business') {
    tagline = fill(`${ind.label}${L ? ' in {L}' : ''}, done with care.`, N, L);
    const services = ind.services.map(([icon, title, text], k) => ({ icon, title, text, image: im(P(k + 1)) }));
    pages = [
      page('Home', [
        sec('hero', 'split', { eyebrow: L ? `${ind.label} · ${L}` : ind.label, title: fill(L ? ind.head[0] : ind.head[1], N, L), subtitle: fill(ind.sub, N, L), cta: link(ind.cta, '/contact'), cta2: link('See services', '/services'), note: L ? `Serving ${L} and nearby` : '', image: im(P(0)) }),
        sec('features', 'cards', { eyebrow: 'Services', title: `Everything your ${ind.what === 'lawns' ? 'yard' : ind.what.replace(/s$/, '')} *needs*`, subtitle: `One team for the jobs that keep ${ind.what} looking their best.`, items: services }),
        sec('about', 'split', { eyebrow: `About ${N}`, title: 'Local, careful and *on time*', text: fill(`${N} is a ${L ? '{L} ' : ''}${ind.noun} company. [Add a line about how you started and who does the work.]\n\nWe keep it simple: clear quotes, tidy work and messages answered the same day.`, N, L), points: [{ text: 'Clear quotes before any work starts' }, { text: 'A text when we are on the way' }, { text: 'Photos when the job is done' }], cta: link('More about us', '/about'), image: im(P(2)) }, 'alt'),
        sec('timeline', 'steps', { eyebrow: 'How it works', title: 'Three steps to *done*', subtitle: '', items: [['01', 'Tell us what you need', 'A few details and a photo or two is plenty.'], ['02', 'Get a clear quote', 'A fixed price and a date, usually the same day.'], ['03', 'We take care of it', 'You get a message and photos when it is finished.']].map(([date, title, text]) => ({ date, title, text })) }),
        sec('testimonials', 'cards', { eyebrow: 'Reviews', title: 'What neighbors *say*', items: placeholderReviews(3) }, 'alt'),
        sec('faq', 'accordion', { eyebrow: 'FAQ', title: 'Good *questions*', subtitle: '', items: faqItems([['Which areas do you serve?', L ? `We work across ${L} and nearby towns. [List your service area.]` : '[List the towns and neighborhoods you serve.]'], ['How do quotes work?', 'Tell us about the job and we send a fixed price before any work starts.'], ['Do I need to be home?', 'Usually not. We text when we arrive and again when we are done.'], ['How do I pay?', '[Say how customers pay: card, transfer, invoice.]']]) }),
        sec('cta', 'band', { title: `Ready for ${ind.what === 'lawns' ? 'a lawn' : 'work'} you are *proud of*?`, text: 'Tell us what you need and get a clear quote, usually the same day.', cta: link(ind.cta, '/contact'), cta2: { label: '', href: '' } }, 'acc'),
        footer(tagline),
      ], ''),
      page('Services', [
        banner('Services', `What *${N}* does`, fill(ind.sub, N, L)),
        sec('features', 'rows', { eyebrow: '', title: '', subtitle: '', items: services }),
        sec('faq', 'columns', { eyebrow: 'Details', title: 'Before you *book*', subtitle: '', items: faqItems([['Is there a minimum job size?', '[Say if there is a minimum.]'], ['Do you offer regular plans?', 'Yes. Weekly and every-other-week plans are easiest to schedule.'], ['What if the weather turns?', 'We reschedule to the next clear day and let you know.'], ['Are supplies included?', '[Say what is included in the price.]']]) }),
        sec('cta', 'card', { title: 'Get a *clear quote*', text: 'Tell us about the job. We reply with a price and a date.', cta: link(ind.cta, '/contact'), cta2: { label: '', href: '' } }),
        footer(tagline),
      ]),
      page('About', [
        banner('About', `Meet *${N}*`, ''),
        sec('about', 'centered', { eyebrow: '', title: 'Small team, *high standards*', text: fill('[Tell your story: who started it, when and why.]\n\nWe treat every {L|} property like our own and finish every job the way we would want it done at home.', N, L), points: [], cta: { label: '', href: '' }, image: im(P(3)) }),
        sec('team', 'grid', { eyebrow: 'The team', title: 'Who you will *meet*', subtitle: '', items: [['Owner'], ['Crew lead'], ['Office and scheduling']].map(([role]) => ({ name: 'Your name', role, bio: '', image: im('a friendly worker portrait outdoors in soft light', 'Team member portrait'), ph: true })) }),
        sec('cta', 'band', { title: 'Let us take it *off your list*', text: '', cta: link(ind.cta, '/contact'), cta2: { label: '', href: '' } }, 'acc'),
        footer(tagline),
      ]),
      page('Contact', [
        banner('Contact', `Get a *free quote*`, 'Tell us about the job. We usually reply the same day.'),
        contactSec('Tell us about *the job*'),
        ...(L || r.address ? [sec('embed', 'contained', { eyebrow: '', title: `Serving *${L || r.address}*`, url: `map:${r.address || L}`, caption: '' })] : []),
        footer(tagline),
      ]),
    ];
    if (ind.cta === GENERIC.cta && !r.industry) navCta = link('Get in touch', '/contact');
  } else if (kind === 'portfolio') {
    const who = r.person || N;
    const role = (r.raw.match(/\b(?:a|an)\s+([a-z][a-z\s&-]{3,40}?(?:photographer|designer|illustrator|artist|writer|developer|architect|filmmaker|stylist|maker|ceramicist|painter))\b/i) || [])[1] || (r.industry ? r.industry.label.toLowerCase() : 'designer and maker');
    tagline = `${cap(role)}${L ? ` in ${L}` : ''}.`;
    accent = '#3b3a36';
    navCta = link('Get in touch', '/contact');
    const work = (r.industry || INDUSTRIES[5]).photos;
    pages = [
      page('Home', [
        sec('hero', 'editorial', { eyebrow: `${cap(role)}${L ? ` · ${L}` : ''}`, title: r.industry ? fill(r.industry.head[0], who, L) : `${who}, *${role.split(' ').slice(-1)[0]}*`, subtitle: `${who} is a ${role}${L ? ` in ${L}` : ''}. Calm, careful work for people who notice the details. Taking commissions now.`, cta: link('See the work', '/work'), cta2: link('Get in touch', '/contact'), note: '', image: im(work[0]) }),
        sec('gallery', 'masonry', { eyebrow: 'Selected work', title: 'Recent *projects*', subtitle: '', items: [0, 1, 2, 3, 4, 5].map((k) => ({ image: im(work[k % work.length]), caption: '' })) }),
        sec('about', 'split', { eyebrow: 'About', title: `Hi, I am *${who.split(' ')[0]}*`, text: `I am a ${role}${L ? ` based in ${L}` : ''}. [Add a sentence about your background and what you love to make.]\n\nI keep projects small enough to give each one my full attention.`, points: [], cta: link('More about me', '/about'), image: im('a natural portrait of a creative professional in their studio, soft window light', `Portrait of ${who}`) }, 'alt'),
        sec('features', 'icons', { eyebrow: 'Services', title: 'How I can *help*', subtitle: '', items: (r.industry || INDUSTRIES[5]).services.slice(0, 3).map(([icon, title, text]) => ({ icon, title, text, image: im('') })) }),
        sec('testimonials', 'single', { eyebrow: 'Kind words', title: '', items: placeholderReviews(1) }),
        sec('cta', 'band', { title: 'Have a project *in mind*?', text: 'Tell me about it. I reply to every message within two days.', cta: link('Start a conversation', '/contact'), cta2: { label: '', href: '' } }, 'inv'),
        footer(tagline),
      ], ''),
      page('Work', [
        banner('Work', 'Selected *projects*', ''),
        sec('gallery', 'grid', { eyebrow: '', title: '', subtitle: '', items: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ image: im(work[k % work.length]), caption: `[Project ${k + 1}]` })) }),
        sec('cta', 'card', { title: 'Want something *like this*?', text: '', cta: link('Get in touch', '/contact'), cta2: { label: '', href: '' } }),
        footer(tagline),
      ]),
      page('Journal', [
        banner('Journal', 'Notes from the *studio*', 'Process, behind the scenes and things I am learning.'),
        sec('posts', 'cards', { eyebrow: '', title: '', subtitle: '' }),
        footer(tagline),
      ]),
      page('Contact', [
        banner('Contact', `Work with *${who.split(' ')[0]}*`, 'Share a date, a place and a little about what you have in mind.'),
        sec('contact', 'centered', { eyebrow: '', title: 'Send a *note*', text: 'I reply within two days.', hours: '', button: 'Send' }),
        footer(tagline),
      ]),
    ];
    collections.posts = [['How I prepare for a shoot', 'The checklist I run through the night before.'], ['Light I keep coming back to', 'Why I plan around the last hour of the day.'], ['A day in the studio', 'What happens between the work you see.']].map(([title, excerpt], k) => ({ id: uid('i'), title, date: '', excerpt, body: `${excerpt}\n\n[Write the post here.]`, image: im(work[(k + 2) % work.length]), ph: true }));
  } else if (kind === 'landing' || kind === 'waitlist') {
    const what = (r.raw.match(/\b(?:app|tool|product|platform|service)\s+(?:that|which|to|for)\s+([^.]{6,120})/i) || [])[1] || 'does one thing really well';
    const wait = kind === 'waitlist';
    tagline = cap(`${N} ${lc(what)}.`.replace(/\.\.$/, '.'));
    accent = '#7c5cff';
    navCta = link(wait ? 'Join the waitlist' : 'Get started', wait ? '#signup' : '#pricing');
    const feats = [['bolt', 'Fast from the first minute', `Set up in moments. ${N} does the busywork so you do not have to.`], ['shield', 'Private by design', 'Your data stays yours. No ads, no selling, no surprises.'], ['layers', 'Everything in one place', 'One calm home for what used to live in five tabs.'], ['sparkle', 'Thoughtful details', 'Small touches that make it a pleasure to come back to.']];
    pages = [
      page('Home', [
        sec('hero', 'centered', { eyebrow: wait ? 'Coming soon' : 'New', title: emphasizeTail(`${N} ${lc(what)}`), subtitle: `${N} ${lc(what)}. ${wait ? 'Join the waitlist and be first in line.' : 'Start free and see the difference in a day.'}`, cta: link(wait ? 'Join the waitlist' : 'Get started', wait ? '#signup' : '#pricing'), cta2: link('How it works', '#how-it-works'), note: wait ? 'Early access is free' : '', image: im(`a clean product screenshot style mockup of a modern app on a laptop, soft gradient background`) }),
        sec('features', 'bento', { eyebrow: 'Why it is different', title: `Built for *calm*`, subtitle: '', items: feats.map(([icon, title, text], k) => ({ icon, title, text, image: im(['an abstract soft gradient with glass shapes', 'a phone showing a minimal app interface on a desk', 'a person relaxing with a phone by a window', 'abstract light trails in violet and cyan'][k]) })) }),
        sec('timeline', 'steps', { eyebrow: 'How it works', title: 'Three steps, *that is it*', subtitle: '', items: [['01', wait ? 'Join the list' : 'Sign up', wait ? 'Leave your email. We will invite people in small groups.' : 'Create an account in under a minute.'], ['02', 'Tell it what you want', `Answer a few questions so ${N} fits the way you work.`], ['03', 'Get your time back', 'Open it when you need it. It is ready.']].map(([date, title, text]) => ({ date, title, text })) }),
        ...(wait ? [] : [sec('pricing', 'cards', { eyebrow: 'Pricing', title: 'Start free, *upgrade later*', subtitle: '', note: '', items: [['Free', '$0', 'For trying it out', false], ['Pro', '[Price]', 'For everyday use', true], ['Team', '[Price]', 'For small teams', false]].map(([name, price, text, featured]) => ({ name, price, period: price === '$0' ? '' : '/ month', text, features: 'Everything you need to start\nUnlimited projects\nEmail support', cta: link(featured ? 'Start free trial' : 'Get started', '#signup'), featured, ph: price !== '$0' })) }, 'alt')]),
        sec('testimonials', 'cards', { eyebrow: wait ? 'Early testers' : 'Reviews', title: 'Words from *real users*', items: placeholderReviews(3) }),
        sec('faq', 'accordion', { eyebrow: 'FAQ', title: 'Questions, *answered*', subtitle: '', items: faqItems([[`When does ${N} launch?`, wait ? '[Add your launch window.] Waitlist members get in first.' : 'It is live today.'], ['Is it free?', wait ? 'Early access is free. [Say how pricing will work.]' : 'There is a free plan. Paid plans add more.'], ['Which devices does it work on?', '[List platforms: web, iPhone, Android.]'], ['What happens to my data?', 'It stays private. You can export or delete it at any time.']]) }),
        sec('signup', wait ? 'card' : 'band', { eyebrow: wait ? 'Waitlist' : 'Updates', title: wait ? `Be first to try *${N}*` : 'Get product *updates*', text: wait ? 'We are letting people in a few at a time. Leave your email and we will send your invite.' : 'One short email when something new ships.', button: wait ? 'Join the waitlist' : 'Subscribe', note: 'No spam. Unsubscribe any time.' }, wait ? 'base' : 'acc'),
        footer(tagline),
      ], ''),
    ];
  } else if (kind === 'event') {
    const D = r.date || '[Date]';
    const V = r.venue && !/^(The )?$/.test(r.venue) ? r.venue : '';
    tagline = `${D}${L ? ` · ${L}` : ''}`;
    accent = '#ff4a1c';
    navCta = link('Get tickets', '/#tickets');
    pages = [
      page('Home', [
        sec('hero', 'cover', { eyebrow: [D, V, L].filter(Boolean).join(' · '), title: `${N}`, subtitle: `${r.desc ? cap(r.desc) : 'A day of talks and workshops'}${L ? ` in ${L}` : ''}. Come for the talks, stay for the conversations in between.`, cta: link('Get tickets', '#tickets'), cta2: link('See the schedule', '/schedule'), note: '', image: im('a packed conference hall with stage lights and an audience, wide angle, warm light') }),
        sec('stats', 'row', { eyebrow: '', title: '', items: [[D, 'Date'], [V || '[Venue]', 'Venue'], [L || '[City]', 'City']].map(([value, label]) => ({ value, label, ph: isPlaceholder(value) })) }, 'inv'),
        sec('about', 'split', { eyebrow: 'About', title: 'Why *come*', text: `${N} brings people together for a day of practical ideas, hands-on sessions and the hallway conversations that make events worth it.\n\n[Add who should come and what they will leave with.]`, points: [{ text: 'Talks and hands-on workshops' }, { text: 'Lunch and coffee included' }, { text: 'Time to meet people' }], cta: link('See the schedule', '/schedule'), image: im('people talking and laughing during a coffee break at a conference') }),
        sec('team', 'grid', { eyebrow: 'Speakers', title: 'Who is *speaking*', subtitle: '[Announcing soon.]', items: [0, 1, 2, 3].map(() => ({ name: 'Speaker name', role: 'Talk title', bio: '', image: im('a speaker on stage with a microphone, dramatic lighting', 'Speaker portrait'), ph: true })) }, 'alt'),
        { ...sec('pricing', 'cards', { eyebrow: 'Tickets', title: 'Get your *ticket*', subtitle: '', note: '', items: [['General', '[Price]', 'All talks, lunch and the after-party', true], ['Student', '[Price]', 'With a valid student ID', false]].map(([name, price, text, featured]) => ({ name, price, period: '', text, features: 'All sessions\nLunch and coffee\nAfter-party', cta: link('Get tickets', '#tickets'), featured, ph: true })) }), anchor: 'tickets' },
        sec('faq', 'columns', { eyebrow: 'FAQ', title: 'Good to *know*', subtitle: '', items: faqItems([['Where is it?', V ? `${V}${L ? `, ${L}` : ''}.` : '[Venue and address.]'], ['Is there parking?', '[Parking and transit details.]'], ['Can I get a refund?', '[Your refund policy.]'], ['Is it accessible?', '[Accessibility details.]']]) }),
        ...(V || L ? [sec('embed', 'contained', { eyebrow: 'Venue', title: V ? `See you at *${V}*` : `See you in *${L}*`, url: `map:${[V, L].filter(Boolean).join(', ')}`, caption: '' })] : []),
        sec('signup', 'band', { eyebrow: 'News', title: 'Hear about *speakers* first', text: 'One email when the line-up is announced.', button: 'Sign up', note: 'No spam. Unsubscribe any time.' }, 'acc'),
        footer(tagline),
      ], ''),
      page('Schedule', [
        banner('Schedule', `The *day* at a glance`, `${D}${V ? ` · ${V}` : ''}`),
        sec('schedule', 'list', { eyebrow: '', title: '', subtitle: '', items: [['', '08:30', 'Doors and coffee'], ['', '09:15', 'Opening talk'], ['', '10:00', 'Morning sessions'], ['', '12:30', 'Lunch'], ['', '13:30', 'Workshops'], ['', '16:30', 'Closing talk'], ['', '17:30', 'After-party']].map(([day, time, title]) => ({ day, time, title, text: '', link: { label: '', href: '' }, ph: true })) }),
        sec('cta', 'band', { title: 'Grab a *ticket*', text: '', cta: link('Get tickets', '/#tickets'), cta2: { label: '', href: '' } }, 'acc'),
        footer(tagline),
      ]),
    ];
  } else if (kind === 'restaurant') {
    const c = r.cuisine || CUISINES[0];
    tagline = `${c[1]} kitchen${L ? ` in ${L}` : ''}.`;
    accent = '#c9a45c';
    navCta = link('Book a table', '/visit');
    const cats = ['To start', 'Mains', 'Mains', 'To start', 'Drinks', 'Dessert'];
    collections.menu = c[2].map((title, k) => ({ id: uid('i'), title, category: cats[k] || 'Mains', text: '[Short description]', price: '', ph: true }));
    const food = [c[3], `a warm ${c[1].toLowerCase()} restaurant interior at night with candles`, `chefs plating food in an open kitchen`, `a sunny patio with tables and string lights`, `fresh ingredients on a wooden board`];
    pages = [
      page('Home', [
        sec('hero', 'cover', { eyebrow: `${c[1]}${L ? ` · ${L}` : ''}`, title: `${N}`, subtitle: `${r.desc ? cap(r.desc) : `${c[1]} cooking`}${L ? ` in ${L}` : ''}.${r.extra ? ` ${cap(r.extra.replace(/\.$/, ''))}.` : ' [One line about the food and the room.]'}`, cta: link('Book a table', '/visit'), cta2: link('See the menu', '/menu'), note: '', image: im(food[1]) }),
        sec('about', 'split', { eyebrow: 'Our kitchen', title: 'Made by hand, *every day*', text: `${N} is a ${c[1].toLowerCase()} kitchen${L ? ` in ${L}` : ''}. [Tell the story: who cooks, where the recipes come from.]\n\nCome hungry, stay a while.`, points: [], cta: link('See the menu', '/menu'), image: im(food[2]) }),
        sec('menu', 'list', { eyebrow: 'Menu', title: 'A few *favorites*', subtitle: '' }, 'alt'),
        sec('gallery', 'strip', { eyebrow: '', title: 'At the *table*', subtitle: '', items: [0, 1, 2, 3, 4].map((k) => ({ image: im(food[k]), caption: '' })) }),
        sec('contact', 'split', { eyebrow: 'Visit', title: 'Come *eat with us*', text: r.address || L ? `Find us at ${r.address || L}.` : '[Your address.]', hours: '[Mon–Thu 11–9\nFri–Sat 11–10\nSun closed]', button: 'Ask about a booking' }),
        sec('cta', 'band', { title: 'Hungry *yet*?', text: '', cta: link('Book a table', '/visit'), cta2: link('See the menu', '/menu') }, 'acc'),
        footer(tagline),
      ], ''),
      page('Menu', [banner('Menu', 'The *menu*', '[Note on allergies and dietary options.]'), sec('menu', 'columns', { eyebrow: '', title: '', subtitle: '' }), footer(tagline)]),
      page('Visit', [
        banner('Visit', 'Find *us*', ''),
        sec('contact', 'split', { eyebrow: 'Bookings', title: 'Book a *table*', text: 'Send us your date, time and party size. We confirm by email.', hours: '[Mon–Thu 11–9\nFri–Sat 11–10\nSun closed]', button: 'Request a table' }),
        ...(r.address || L ? [sec('embed', 'wide', { eyebrow: '', title: '', url: `map:${r.address || L}`, caption: '' })] : []),
        footer(tagline),
      ]),
    ];
  } else if (kind === 'band') {
    const genre = (r.raw.match(/\b(indie(?:[ -](?:folk|rock|pop))?|folk|rock|jazz|hip[- ]hop|rap|pop|punk|metal|country|soul|r&b|electronic|ambient|bluegrass|blues|classical|choir)\b/i) || [])[0] || 'band';
    tagline = `${cap(genre)}${L ? ` from ${L}` : ''}.`;
    accent = '#ff4a1c';
    navCta = link('Listen', '/#music');
    collections.tracks = [1, 2, 3, 4, 5].map((k) => ({ id: uid('i'), title: `[Song title ${k}]`, length: '', note: '', audio: '', link: '', ph: true }));
    pages = [
      page('Home', [
        sec('hero', 'cover', { eyebrow: cap(genre) + (L ? ` · ${L}` : ''), title: N, subtitle: `${r.desc ? cap(r.desc) : cap(genre)}${L ? ` from ${L}` : ''}.${r.more ? ` ${r.more}` : ''}`, cta: link('Listen now', '#music'), cta2: link('Tour dates', '/shows'), note: '', image: im(`a ${genre} band performing on a small stage with warm lights and haze`) }),
        sec('tracks', 'cover', { eyebrow: 'Music', title: 'The new *record*', image: im(`album cover art: a moody landscape at dusk, film grain, ${genre} mood`, 'Album artwork') }, 'inv'),
        sec('schedule', 'list', { eyebrow: 'On tour', title: 'See us *live*', subtitle: '', items: [1, 2, 3, 4].map(() => ({ day: '[Date]', time: '', title: '[Venue]', text: '[City]', link: link('Tickets', '#'), ph: true })) }),
        sec('gallery', 'strip', { eyebrow: '', title: 'On the *road*', subtitle: '', items: [`a band loading gear into a van at sunset`, `a crowd with raised hands at a small venue`, `a guitarist silhouetted against stage lights`, `a drum kit on a dark stage`, `a band laughing backstage`].map((p) => ({ image: im(p), caption: '' })) }),
        sec('signup', 'band', { eyebrow: 'Mailing list', title: 'Get *new music* first', text: 'Tour dates and new songs, a few times a year.', button: 'Join', note: 'No spam. Unsubscribe any time.' }, 'acc'),
        footer(tagline),
      ], ''),
      page('Shows', [banner('Shows', 'Tour *dates*', ''), sec('schedule', 'list', { eyebrow: '', title: '', subtitle: '', items: [1, 2, 3, 4, 5, 6].map(() => ({ day: '[Date]', time: '[Doors]', title: '[Venue]', text: '[City]', link: link('Tickets', '#'), ph: true })) }), footer(tagline)]),
      page('About', [banner('About', `About *${N}*`, ''), sec('about', 'centered', { eyebrow: '', title: '[How the band started]', text: '[Who is in the band, where you are from, what the music sounds like.]', points: [], cta: { label: '', href: '' }, image: im('') }), sec('gallery', 'grid', { eyebrow: '', title: '', subtitle: '', items: [0, 1, 2, 3, 4, 5].map((k) => ({ image: im([`a band portrait in an old brick alley`, `a vinyl record spinning on a turntable`, `a microphone close up with stage lights`][k % 3]), caption: '' })) }), footer(tagline)]),
    ];
  } else if (kind === 'realestate') {
    const A = r.address || N;
    const price = r.price || '[Price]';
    tagline = `${A}${L ? `, ${L}` : ''}`;
    accent = '#c9a45c';
    navCta = link('Schedule a tour', '#contact');
    const facts = [r.beds && `${r.beds} bedrooms`, r.baths && `${r.baths} bathrooms`, r.sqft && `${r.sqft} sq ft`].filter(Boolean).join(' · ');
    const style2 = (r.raw.match(/craftsman|colonial|ranch|victorian|modern|farmhouse|bungalow|townhome|condo|loft|cottage|tudor/i) || [])[0] || 'home';
    pages = [
      page('Home', [
        sec('hero', 'cover', { eyebrow: `For sale${L ? ` · ${L}` : ''}`, title: A, subtitle: `${facts ? `${facts}. ` : ''}A ${style2.toLowerCase()} with room to grow. Listed at ${price}.`, cta: link('Schedule a tour', '#contact'), cta2: link('See photos', '#gallery'), note: '', image: im(`the front of a ${style2} house at golden hour with a manicured lawn`) }),
        sec('listing', 'details', { status: 'For sale', price, address: `${A}${L ? `, ${L}` : ''}`, beds: r.beds || '[0]', baths: r.baths || '[0]', sqft: r.sqft || '[0]', lot: '', year: '', text: `[Describe the home: the light, the layout, the kitchen, the yard and the street.]`, points: ['[A favorite feature]', '[Another favorite feature]', '[Updates and upgrades]', '[Garage and storage]'].map((text) => ({ text })), photos: [`a bright living room with large windows and wood floors in a ${style2} house`, 'a modern kitchen with an island and pendant lights', 'a calm primary bedroom with soft morning light', 'a spa-like bathroom with a soaking tub', 'a backyard deck at golden hour'].map((p) => ({ image: im(p) })), cta: link('Schedule a tour', '#contact') }),
        sec('gallery', 'masonry', { eyebrow: 'Photos', title: 'Take a *look around*', subtitle: '', items: ['a dining room with a statement light fixture', 'a cozy reading nook by a window', 'a finished basement family room', 'a front porch with rocking chairs', 'a two-car garage with storage', 'a tree-lined neighborhood street'].map((p) => ({ image: im(p), caption: '' })) }, 'alt'),
        sec('embed', 'wide', { eyebrow: 'Location', title: 'The *neighborhood*', url: `map:${A}${L ? `, ${L}` : ''}`, caption: '' }),
        sec('contact', 'split', { eyebrow: 'Tours', title: 'Schedule a *private tour*', text: 'Pick a time that works and we will meet you at the door. [Add the agent name and brokerage.]', hours: '[Open house: Saturday 1–3 pm]', button: 'Request a tour' }),
        footer(tagline),
      ], ''),
    ];
  } else if (kind === 'shop') {
    const fashion = /wear|cloth|apparel|fashion|jacket|coat|dress|knit|denim|label|trouser|shirt|garment|parka/i.test(r.raw);
    const goods = nounList(r.raw).map((g) => cap(singular(g)));
    const pieces = goods.length ? goods : fashion ? ['Field jacket', 'Wool coat', 'Travel trouser', 'Overshirt'] : ['[Product one]', '[Product two]', '[Product three]', '[Product four]'];
    const colours = fashion ? ['Black', 'Olive', 'Rust', 'Stone', 'Navy', 'Chalk'] : ['Natural', 'Charcoal', 'Sand', 'Clay', 'Ink', 'Moss'];
    const shot = (k) => (fashion ? `a model wearing a ${lc(colours[k % colours.length])} ${lc(pieces[k % pieces.length])}, full length, plain studio backdrop` : `a studio product photo of a ${lc(colours[k % colours.length])} ${lc(pieces[k % pieces.length])}, plain backdrop`);
    const products = (n) => Array.from({ length: n }, (_, k) => ({ image: im(shot(k)), name: pieces[k % pieces.length], price: r.price || '[Price]', note: colours[k % colours.length], link: { label: '', href: '' }, ...(r.price ? {} : { ph: true }) }));
    const what = r.desc ? r.desc.replace(/^(a|an)\s+/i, '') : fashion ? 'a small clothing label' : 'a small shop';
    tagline = cap(`${what.replace(/\s+(making|selling|with)\s.*$/i, '')}${L && !what.includes(L) ? ` in ${L}` : ''}.`);
    accent = '#111111';
    navCta = link('Shop', '/shop');
    const looks = fashion ? ['a model in a long coat walking through a concrete courtyard, editorial fashion photograph, soft daylight', 'a close crop of a waxed cotton collar and brass snaps in hard sunlight', 'two people in neutral outerwear standing on a city bridge at dusk', 'a model sitting on stone steps in wide trousers, overcast light', 'a rail of jackets in a bright white studio'] : ['the shop interior with objects on plinths, soft daylight', 'a close crop of hands holding a finished piece', 'a still life of the collection on linen', 'a workshop bench with tools and materials', 'the storefront at dusk'];
    const plural = (goods.length ? nounList(r.raw).map(lc) : fashion ? ['field jackets', 'wool coats', 'travel trousers'] : ['a few good things']).slice(0, 3);
    const statement = `${N} makes ${plural.join(', ').replace(/, ([^,]*)$/, ' and $1')}${L ? ` in ${L}` : ''}, in small runs. Made to be used hard, cut to last for years, and sold without the noise.`;
    pages = [
      page('Home', [
        sec('hero', 'runway', { eyebrow: `Collection 01${L ? ` · ${L}` : ''}`, title: N, subtitle: cap(`${what}.`.replace(/\.\.$/, '.')), cta: link('Shop the collection', '/shop'), cta2: link('Lookbook', '/lookbook'), note: `${pieces.length * 2} pieces`, image: im(looks[0]) }),
        sec('products', 'grid', { eyebrow: 'New in', title: 'Collection', subtitle: '', items: products(8), cta: link('See every piece', '/shop') }),
        sec('statement', 'center', { eyebrow: '', text: statement, note: '', mark: '' }),
        sec('lookbook', 'full', { eyebrow: 'Lookbook', title: 'Season one', items: looks.slice(1, 4).map((p, k) => ({ image: im(p), caption: `Look ${String(k + 1).padStart(2, '0')}`, note: pieces[k % pieces.length] })) }),
        sec('products', 'lineup', { eyebrow: 'Shop by piece', title: 'The *line-up*', subtitle: '', items: products(Math.min(8, pieces.length * 2)), cta: { label: '', href: '' } }),
        sec('signup', 'band', { eyebrow: 'Letters', title: 'First look at *new pieces*', text: 'One short email when something new is ready. Nothing else.', button: 'Subscribe', note: 'Unsubscribe any time.' }),
        footer(tagline),
      ], ''),
      page('Shop', [banner('Shop', 'All *pieces*', `${pieces.length * 3} pieces in ${colours.length} colours.`), sec('products', 'grid', { eyebrow: '', title: '', subtitle: '', items: products(12), cta: { label: '', href: '' } }), footer(tagline)]),
      page('Lookbook', [banner('Lookbook', 'Season *one*', ''), sec('lookbook', 'pair', { eyebrow: '', title: '', items: looks.map((p, k) => ({ image: im(p), caption: `Look ${String(k + 1).padStart(2, '0')}`, note: pieces[k % pieces.length] })) }), sec('statement', 'left', { eyebrow: 'Notes', text: '[A few lines on the season: where it was shot, what it is about.]', note: '', mark: '' }), footer(tagline)]),
      page('About', [
        banner('About', `About *${N}*`, ''),
        sec('about', 'split', { eyebrow: 'Studio', title: 'Made in *small runs*', text: `${N} is ${r.desc ? lc(r.desc) : what}${L && !what.includes(L) ? ` in ${L}` : ''}. [Add who makes the pieces and where.]\n\nWe make a few things well, repair what we sell, and keep every piece in production for as long as people want it.`, points: [{ text: 'Small runs, no seasons of waste' }, { text: 'Free repairs for the first year' }, { text: '[Where the fabric comes from]' }], cta: { label: '', href: '' }, image: im(looks[4]) }),
        sec('faq', 'columns', { eyebrow: 'Service', title: 'Shipping, returns and *care*', subtitle: '', items: faqItems([['Where do you ship?', '[List the countries you ship to.]'], ['How do returns work?', '[Your return window and how to start one.]'], ['How do the pieces fit?', '[A line on fit, and where to find the size guide.]'], ['How do I care for it?', '[Washing and care, in plain words.]']]) }),
        sec('contact', 'centered', { eyebrow: '', title: 'Write to *us*', text: 'Questions about sizing, orders or stockists. We reply within a day.', hours: '', button: 'Send' }),
        footer(tagline),
      ]),
    ];
  } else if (kind === 'manifesto') {
    const belief = (r.raw.match(/\bbelieves?\s+(?:that\s+)?([^.;]{6,160})/i) || [])[1];
    const thesis = belief ? cap(belief.replace(/[.\s]+$/, '')) : 'There is a better way to live with the things we make';
    const what = r.desc ? r.desc.replace(/\s+(?:that|who)\s+believes?.*$/i, '') : 'a small group of people';
    const year = (r.raw.match(/\b(19|20)\d\d\b/) || [])[0] || String(new Date().getFullYear());
    tagline = `${thesis}.`;
    accent = '#ff5a1f';
    navCta = link('Join us', '#signup');
    pages = [
      page('Home', [
        sec('hero', 'ambient', { eyebrow: `${N} · Manifesto`, title: emphasizeTail(thesis), subtitle: `Why ${N} exists, what we believe, and what we are going to do about it.`, cta: link('Read the manifesto', '#chapters'), cta2: { label: '', href: '' }, note: '', image: im('') }),
        sec('statement', 'reveal', { eyebrow: '', text: `We built a world that moves faster than we do. ${N} is ${lc(what)}, and this is what we believe.`, note: '', mark: '' }),
        sec('chapters', 'stack', { eyebrow: '', title: '', items: [
          ['Something is *out of balance*', `${thesis}. Most of us feel it long before we can name it. [Add one fact or story that shows the problem.]`, 'wave'],
          ['The old answers are *not enough*', 'Good intentions and small fixes have not changed the outcome. The tools we keep reaching for were made for a different time.', 'grid'],
          ['What we *believe*', `${thesis}. We say it in public so that you can hold us to it.`, 'horizon'],
          ['What we are *building*', `${N} is ${lc(what)}. [Say plainly what you make or do, and who it is for.]`, 'orbit'],
          ['What happens *next*', 'Change starts small: one person, one street, one decision at a time. Here is how to be part of it.', 'stairs'],
        ].map(([title, text, motif]) => ({ title, text, motif })) }),
        sec('statement', 'framed', { eyebrow: 'Our promise', text: `${thesis}.`, note: N, mark: year }),
        sec('signup', 'band', { eyebrow: 'Join', title: 'Be part of *what comes next*', text: 'Occasional letters about the work, and ways to help.', button: 'Sign the manifesto', note: 'No spam. Leave any time.' }),
        sec('footer', 'simple', { tagline, social: [] }),
      ], ''),
    ];
  } else if (kind === 'cases') {
    const who = r.person || N;
    const role = (r.raw.match(/\b(?:a|an)\s+([a-z][a-z\s&-]{2,40}?(?:designer|developer|engineer|architect|director|photographer|writer|researcher|illustrator|maker|artist|strategist|producer))\b/i) || [])[1] || 'designer';
    const now = new Date().getFullYear();
    const since = +((r.raw.match(/\b(?:since|from)\s+((?:19|20)\d\d)\b/i) || [])[1] || now - 12);
    const things = ((r.raw.match(/\b(?:shipped|built|designed|made|worked on|launched|created)\s+([^.;]{4,160}?)(?:\s+since\b|[.;]|$)/i) || [])[1] || '').split(/,\s*|\s+and\s+/).map((x) => x.trim().replace(/^(a|an|the)\s+/i, '')).filter(Boolean);
    const titles = [...things.map((t) => cap(singular(t))), '[Project]', '[Project]', '[Project]', '[Project]', '[Project]', '[Project]'].slice(0, 6);
    const step = Math.max(1, Math.round((now - since) / 5));
    const surf = (t, k) => (k % 3 === 1 ? `a ${lc(t)} app on a phone, clean studio light` : `the ${lc(t)} interface on a laptop, clean studio light`);
    const items = titles.map((t, k) => ({ year: String(k === 5 ? since : now - k * step), title: t, role: k % 2 ? 'Interaction design' : 'Lead designer', client: '[Client or team]', text: `[What ${t === '[Project]' ? 'it' : lc(t)} is, what you did and what changed, in two sentences.]`, image: im(surf(t, k)), credits: '', link: { label: '', href: '' }, ph: true }));
    tagline = `${cap(role)}${L ? ` in ${L}` : ''}.`;
    accent = '#2b59ff';
    navCta = { label: '', href: '' };
    pages = [
      page('Home', [
        sec('hero', 'minimal', { eyebrow: '', title: who, subtitle: `${cap(role)}${L ? ` in ${L}` : ''}. Work from ${since} to now, newest first.`, cta: link('Work', '/work'), cta2: link('About', '/about'), note: '', image: im('') }),
        sec('cases', 'rail', { eyebrow: `${since} to ${now}`, title: 'Selected work', items }),
        sec('statement', 'left', { eyebrow: 'Approach', text: 'I design the small moments people touch every day, and stay with them until they feel inevitable.', note: '', mark: '' }),
        sec('cta', 'card', { title: 'Working on something *new*?', text: 'I take on one or two projects at a time.', cta: link('Get in touch', '/contact'), cta2: { label: '', href: '' } }),
        sec('footer', 'simple', { tagline, social: [] }),
      ], ''),
      page('Work', [banner('Work', 'Year by *year*', ''), sec('cases', 'list', { eyebrow: '', title: '', items: items.map((x) => ({ ...x, image: { ...x.image } })) }), sec('footer', 'simple', { tagline, social: [] })]),
      page('About', [
        banner('About', `About *${who.split(' ')[0]}*`, ''),
        sec('about', 'split', { eyebrow: '', title: `${cap(role)}${L ? `, ${L}` : ''}`, text: `${who} is a ${role}${L ? ` based in ${L}` : ''}. [Two sentences on your background and what you care about.]\n\n[Where you have worked, and what you are doing now.]`, points: [], cta: { label: '', href: '' }, image: im(`a natural portrait of a ${role} in a bright studio, soft window light`, `Portrait of ${who}`) }),
        sec('timeline', 'vertical', { eyebrow: 'Path', title: 'So *far*', subtitle: '', items: items.slice(0, 4).map((x) => ({ date: x.year, title: x.title, text: x.role })) }),
        sec('footer', 'simple', { tagline, social: [] }),
      ]),
      page('Contact', [banner('Contact', 'Say *hello*', 'A line about the project and a rough timeline is plenty.'), sec('contact', 'centered', { eyebrow: '', title: 'Send a *note*', text: 'I reply within two days.', hours: '', button: 'Send' }), sec('footer', 'simple', { tagline, social: [] })]),
    ];
  } else if (kind === 'product') {
    const what = (r.raw.match(/\b(?:AI|app|tool|product|platform|model|assistant|studio|agent)\s+(?:that|which|to|for)\s+([^.]{6,140})/i) || [])[1] || 'does the hard part for you';
    const visual = /character|portrait|face|avatar|photo|video|image|selfie|fashion|influenc|model/i.test(r.raw);
    tagline = cap(`${N} ${lc(what)}.`);
    accent = '#0b0b0c';
    navCta = link('Start free', '#pricing');
    const claim = visual ? 'The same face, *every frame.*' : what.length <= 56 ? emphasizeTail(cap(what)) : 'The hard part, *done for you.*';
    const tags = visual ? ['Face matched', 'Hair matched', 'Light kept', 'Style set', 'Jewelry kept'] : ['Context read', 'Tone matched', 'Sources linked', 'Draft ready'];
    const portrait = visual ? 'a studio portrait of the character, a young woman with freckles and a short bob, soft daylight, plain warm backdrop' : 'a person working calmly at a laptop in soft morning light, plain warm backdrop';
    const scenes = visual ? ['the same woman sitting on brick steps in the city, candid street photo', 'the same woman holding a coffee in a cafe window, morning light', 'the same woman laughing on a rooftop at golden hour', 'the same woman walking a dog in a park, autumn', 'the same woman in a studio portrait with a red backdrop'] : ['a laptop screen with a calm writing interface', 'a phone showing a summary card', 'a team table with laptops and coffee', 'a tablet with a chart on a desk', 'an inbox with sorted messages on a screen'];
    pages = [
      page('Home', [
        sec('hero', 'portrait', { eyebrow: `Introducing ${N}`, title: claim, subtitle: tagline, cta: link('Start free', '#pricing'), cta2: link('See how it works', '#demo'), note: '', image: im(portrait, visual ? 'Studio portrait of a character' : '') }),
        sec('annotated', 'portrait', { eyebrow: 'How it works', title: visual ? 'Locked in, *detail by detail*' : 'It reads *everything* first', subtitle: visual ? `${N} learns a face once, then keeps every detail consistent in new photos and video.` : `${N} reads what you already have before it writes a word.`, status: visual ? 'Building your character' : 'Reading your context', image: im(portrait), items: tags.map((label) => ({ label })) }),
        sec('features', 'bento', { eyebrow: '', title: visual ? 'One character. *Endless content.*' : `One tool. *Every workflow.*`, subtitle: '', items: (visual ? [['camera', 'From a prompt', 'Describe a scene and get the same person in it, from any angle.'], ['layers', 'From a reference', 'Drop in a photo of a place and put your character into it.'], ['sparkle', 'Any style', 'Street, studio, film or editorial. The face stays the same.'], ['bolt', 'Made for posting', 'Square, portrait and wide, ready for every platform.']] : [['bolt', 'Fast', 'Answers in seconds, not meetings.'], ['shield', 'Private', 'Your data is never used to train anything.'], ['layers', 'Connected', 'Works with the tools you already use.'], ['sparkle', 'Careful', 'Shows its sources so you can check its work.']]).map(([icon, title, text], k) => ({ icon, title, text, image: im(scenes[k]) })) }, 'inv'),
        sec('gallery', 'strip', { eyebrow: '', title: visual ? 'See them *in motion*' : 'See it *at work*', subtitle: visual ? 'Every still can become a short video of the same character.' : '', items: scenes.map((p, k) => ({ image: im(p), caption: ['Any vibe', 'Showcase', 'Golden hour', 'Everyday', 'Studio'][k] })) }, 'inv'),
        sec('timeline', 'steps', { eyebrow: 'Three steps', title: 'From idea to *post*', subtitle: '', items: [['01', visual ? 'Create a character' : 'Connect your work', visual ? 'Start from a description or a few photos.' : 'Link the documents and tools you already use.'], ['02', visual ? 'Lock the identity' : 'Ask for what you need', visual ? `${N} remembers the face, hair and style.` : 'Plain words are enough.'], ['03', visual ? 'Make anything' : 'Review and ship', visual ? 'Photos and video, at any scale.' : 'Check the sources, then send it.']].map(([date, title, text]) => ({ date, title, text })) }),
        sec('pricing', 'cards', { eyebrow: 'Pricing', title: 'Start free, *grow later*', subtitle: '', note: '', items: [['Free', '$0', 'To try it out', false], ['Creator', '[Price]', 'For regular posting', true], ['Studio', '[Price]', 'For teams and brands', false]].map(([name, price, text, featured]) => ({ name, price, period: price === '$0' ? '' : '/ month', text, features: visual ? 'Characters you can keep\nPhotos and video\nCommercial use' : 'Unlimited questions\nSources on every answer\nEmail support', cta: link(featured ? 'Start free trial' : 'Get started', '#signup'), featured, ph: price !== '$0' })) }),
        sec('faq', 'accordion', { eyebrow: 'FAQ', title: 'Questions, *answered*', subtitle: '', items: faqItems([[`What is ${N}?`, tagline], ['Who owns what I make?', '[Say who owns the output and how it can be used.]'], ['Which platforms does it support?', '[List the platforms and export formats.]'], ['What about my data?', '[Say what you store, for how long, and how to delete it.]']]) }),
        sec('signup', 'card', { eyebrow: 'Get early access', title: `Start with *${N}*`, text: 'Leave your email and we will send an invite.', button: 'Request access', note: 'No spam. Unsubscribe any time.' }),
        footer(tagline),
      ], ''),
    ];
  } else {
    // launch: a course or a book
    const isBook = /\bbook|novel|guide|memoir|cookbook/i.test(r.raw);
    const T = r.quoted || N;
    const author = r.author || r.person || '[Author name]';
    tagline = isBook ? `A new book by ${author}.` : `A course by ${author}.`;
    accent = '#c2410c';
    navCta = link(isBook ? 'Get the book' : 'Enroll', '#pricing');
    const topic = (r.raw.match(/\b(?:guide|course|book)\s+(?:to|on|about)\s+([^.,]{4,80})/i) || [])[1] || 'the thing you have always meant to learn';
    pages = [
      page('Home', [
        sec('hero', 'split', { eyebrow: isBook ? 'New book' : 'New course', title: `${T}`, subtitle: `${isBook ? 'A practical guide' : 'A step-by-step course'} to ${lc(topic)}, by ${author}.`, cta: link(isBook ? 'Get the book' : 'Enroll now', '#pricing'), cta2: link(isBook ? 'Read a sample' : 'See the lessons', '#how-it-works'), note: '', image: im(isBook ? `a hardcover book standing on a wooden table, minimal, soft daylight, about ${topic}` : `a laptop showing an online lesson on a desk with a notebook, about ${topic}`, isBook ? `Cover of ${T}` : `${T} course preview`) }),
        sec('features', 'cards', { eyebrow: isBook ? 'Inside the book' : 'What you will learn', title: 'Practical from *page one*', subtitle: '', items: [['compass', 'Start with a plan', 'A simple framework so you know what to do first.'], ['book', 'Step-by-step chapters', 'Short sections you can read and use the same day.'], ['check', 'Checklists and templates', 'Ready-to-use pages that keep you on track.']].map(([icon, title, text]) => ({ icon, title, text, image: im('') })) }),
        sec('timeline', 'vertical', { eyebrow: isBook ? 'Chapters' : 'Curriculum', title: `What is *inside*`, subtitle: '', items: [1, 2, 3, 4, 5].map((k) => ({ date: isBook ? `Chapter ${k}` : `Module ${k}`, title: `[Title ${k}]`, text: '[One line on what this part covers.]' })) }, 'alt'),
        sec('about', 'split', { eyebrow: isBook ? 'The author' : 'Your teacher', title: `Meet *${author.replace(/^\[|\]$/g, '')}*`, text: '[A short bio: why you are the right person to write this.]', points: [], cta: { label: '', href: '' }, image: im('an author portrait in a cozy library, soft window light', `Portrait of ${author}`) }),
        sec('pricing', 'cards', { eyebrow: isBook ? 'Get the book' : 'Enroll', title: isBook ? 'Choose your *edition*' : 'Choose your *plan*', subtitle: '', note: '', items: (isBook ? [['Ebook', 'Instant download'], ['Hardcover', 'Signed first edition'], ['Bundle', 'Hardcover plus ebook']] : [['Self-paced', 'All lessons'], ['With feedback', 'Lessons plus reviews'], ['Group', 'For teams']]).map(([name, text], k) => ({ name, price: '[Price]', period: '', text, features: isBook ? 'Every chapter\nPrintable checklists\nFree updates' : 'Every lesson\nWorksheets\nLifetime access', cta: link(isBook ? 'Order' : 'Enroll', '#signup'), featured: k === 1, ph: true })) }),
        sec('testimonials', 'cards', { eyebrow: 'Early readers', title: 'What readers *say*', items: placeholderReviews(3) }, 'alt'),
        sec('faq', 'accordion', { eyebrow: 'FAQ', title: 'Questions', subtitle: '', items: faqItems([['When is it out?', '[Release date.]'], ['Who is it for?', `Anyone who wants to learn ${lc(topic)}, beginners included.`], ['Is there a sample?', 'Join the list below and we will send the first chapter.'], ['Refunds?', '[Your refund policy.]']]) }),
        sec('signup', 'band', { eyebrow: 'Free sample', title: 'Read the *first chapter* free', text: 'Leave your email and we will send it straight away.', button: 'Send me the sample', note: 'No spam. Unsubscribe any time.' }, 'acc'),
        footer(tagline),
      ], ''),
    ];
  }

  const theme = themeFor(styleId, accent);
  const site = {
    v: SPEC_VERSION,
    name: N,
    tagline,
    kind,
    prompt: r.raw.slice(0, 600),
    theme,
    seo: { title: clean(tagline && tagline.includes(N) ? tagline.replace(/\.$/, '') : `${N}${tagline ? ` | ${tagline.split(/[,.]/)[0]}` : ''}`, 64), description: clean(`${tagline} ${pages[0].sections[0].subtitle || ''}`.replace(/\*/g, '').replace(/\[[^\]]*\]/g, ''), 160), url: '', image: im(''), lang: 'en' },
    contact: { email: r.email || '', phone: r.phone || '', address: r.address ? `${r.address}${L ? `, ${L}` : ''}` : (kind === 'business' || kind === 'restaurant') && L ? L : '', form: '' },
    nav: { cta: navCta },
    pages,
    collections,
    credit: true,
  };
  return finalize(site);
}

// ---------------------------------------------------------------------------------------------
// sanitizeSite(): model output, shared links and saved projects all go through here
// ---------------------------------------------------------------------------------------------

function cleanImage(v, opts, fallbackPrompt = '') {
  if (typeof v === 'string') return im(clean(v, LIMITS.prompt));
  const o = v && typeof v === 'object' ? v : {};
  const prompt = clean(o.prompt ?? fallbackPrompt, LIMITS.prompt);
  let src = '';
  if (opts.source === 'user' && typeof o.src === 'string') {
    if (/^asset:[\w-]{4,40}$/.test(o.src) && opts.assets && opts.assets.has(o.src.slice(6))) src = o.src;
    else if (/^\/media\/[\w\-/]+\.(jpe?g|png|webp)$/.test(o.src)) src = o.src;
  }
  const alt = clean(o.alt ?? (prompt ? cap(prompt.replace(/^(a|an|the)\s+/i, '')) : ''), LIMITS.alt);
  return { src, alt, prompt, ...(o.decorative ? { decorative: true } : {}) };
}

function cleanLink(v) {
  if (typeof v === 'string') return { label: clean(v, LIMITS.label), href: '' };
  const o = v && typeof v === 'object' ? v : {};
  return { label: clean(o.label, LIMITS.label), href: safeHref(o.href) };
}

function cleanField(type, key, v, opts) {
  if (type === 'image') return cleanImage(v, opts);
  if (type === 'link') return cleanLink(v);
  if (type === 'href') return safeHref(v);
  if (type === 'bool') return !!v;
  if (type === 'icon') return ICON_NAMES.includes(v) ? v : 'sparkle';
  if (type === 'motif') return MOTIFS[v] ? v : 'orbit';
  if (type === 'url') return clean(v, 400);
  if (type === 'audio') return opts.source === 'user' && /^asset:[\w-]{4,40}$/.test(v || '') && opts.assets?.has(String(v).slice(6)) ? v : '';
  if (type === 'list') return clean(Array.isArray(v) ? v.join('\n') : v, TYPE_LIMIT.list, true);
  const multi = type === 'para' || type === 'long';
  return clean(v, LIMITS[key] || TYPE_LIMIT[type] || 140, multi);
}

function cleanItems(spec, v, opts, fact) {
  const arr = Array.isArray(v) ? v : [];
  return arr.slice(0, spec.max).filter((x) => x && typeof x === 'object').map((x) => {
    const o = {};
    for (const [k, t] of Object.entries(spec.item)) o[k] = cleanField(t, k, x[k], opts);
    if (x.ph || x.placeholder) o.ph = true;
    if (x.id && /^[\w-]{1,24}$/.test(x.id)) o.id = x.id;
    if (fact) fact(o, x);
    return o;
  });
}

const VALID_TONES = Object.keys(TONES);

function cleanSection(raw, opts) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').toLowerCase();
  const def = SECTIONS[type];
  if (!def) return null;
  const s = { id: /^[\w-]{2,24}$/.test(raw.id || '') ? raw.id : uid('s'), type, variant: def.variants[raw.variant] ? raw.variant : Object.keys(def.variants)[0] };
  s.tone = VALID_TONES.includes(raw.tone) ? raw.tone : defaultTone(type, s.variant);
  const fromModel = opts.source === 'model';
  const knownNum = (val) => {
    const nums = String(val || '').match(/\d[\d,.]*/g) || [];
    return nums.every((n) => opts.facts.some((f) => f.replace(/[,.]/g, '') === n.replace(/[,.]+$/, '').replace(/[,.]/g, '')));
  };
  const inPrompt = (txt) => opts.prompt.toLowerCase().includes(String(txt || '').toLowerCase().trim());
  for (const [k, t] of Object.entries(def.fields)) {
    if (typeof t === 'object') {
      let fact = null;
      if (fromModel && type === 'testimonials') {
        const n = Math.max(1, Math.min(3, Array.isArray(raw[k]) ? raw[k].length : 3));
        s[k] = placeholderReviews(s.variant === 'single' ? 1 : n);
        continue;
      }
      if (fromModel && type === 'stats') fact = (o) => { if (!knownNum(o.value)) o.ph = true; };
      if (fromModel && type === 'pricing') fact = (o) => { if (/\d/.test(o.price) && !knownNum(o.price)) o.ph = true; };
      if (fromModel && type === 'team') fact = (o) => { if (o.name && !inPrompt(o.name)) { o.name = 'Your name'; o.ph = true; } };
      if (fromModel && type === 'logos') fact = (o) => { if (o.name && !inPrompt(o.name)) o.ph = true; };
      if (type === 'pricing') {
        const raws = Array.isArray(raw[k]) ? raw[k] : [];
        s[k] = cleanItems(t, raws, opts, (o, x) => { o.features = cleanField('list', 'features', Array.isArray(x.features) ? x.features.join('\n') : x.features, opts); fact && fact(o, x); });
        continue;
      }
      s[k] = cleanItems(t, raw[k], opts, fact);
    } else {
      s[k] = cleanField(t, k, raw[k], opts);
    }
  }
  if (type === 'testimonials' && opts.source === 'user') s.items.forEach((it) => { if (it.ph) { it.quote = it.quote || 'Placeholder: paste a real review from a customer here, with their permission.'; } });
  if (raw.anchor && /^[a-z][\w-]{0,40}$/.test(raw.anchor)) s.anchor = raw.anchor;
  if (raw.hidden) s.hidden = true;
  return s;
}

function defaultTone(type, variant) {
  if (type === 'footer') return 'inv';
  if (type === 'cta' && variant === 'band') return 'acc';
  if (type === 'stats') return 'inv';
  return 'base';
}

function cleanCollections(raw, opts) {
  const out = blankCollections();
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const [key, def] of Object.entries(COLLECTIONS)) {
    const arr = Array.isArray(src[key]) ? src[key] : Array.isArray(src[key]?.items) ? src[key].items : [];
    out[key] = arr.slice(0, 40).filter((x) => x && typeof x === 'object').map((x) => {
      const o = { id: /^[\w-]{2,24}$/.test(x.id || '') ? x.id : uid('i') };
      for (const [k, t] of Object.entries(def.fields)) o[k] = cleanField(t, k, x[k], opts);
      if (def.detail) o.slug = slugify(x.slug || o.title || o.address) || o.id;
      if (x.ph || x.placeholder) o.ph = true;
      if (opts.source === 'model' && key === 'menu' && /\d/.test(o.price) && !opts.facts.some((f) => o.price.includes(f))) o.ph = true;
      return o;
    });
  }
  return out;
}

/**
 * Unique page slugs, section anchors and collection item slugs, in place. The editor runs this after it adds,
 * duplicates or re-anchors something; unlike finalize() it never rewrites links the visitor typed.
 */
export function tidySite(site) {
  const seen = new Set();
  site.pages.forEach((p, i) => {
    let slug = i === 0 ? '' : slugify(p.slug || p.title) || `page-${i + 1}`;
    if (['assets', 'posts', 'listings'].includes(slug)) slug = `${slug}-page`;
    while (seen.has(slug)) slug = `${slug}-2`;
    seen.add(slug);
    p.slug = slug;
    p.id = p.id || uid('p');
    p.title = p.title || (i === 0 ? 'Home' : cap(slug.replace(/-/g, ' ')));
    p.seo = p.seo || { title: '', description: '' };
    const anchors = new Set();
    for (const s of p.sections) {
      let a = s.anchor || ANCHORS[s.type];
      if (!a) continue;
      while (anchors.has(a)) a = `${a}-2`;
      anchors.add(a);
      s.anchor = a;
    }
  });
  // collection detail slugs
  for (const [key, def] of Object.entries(COLLECTIONS)) {
    if (!def.detail) continue;
    const used = new Set();
    for (const it of site.collections[key] || []) {
      let sl = slugify(it.slug || it.title || it.address) || it.id;
      while (used.has(sl)) sl = `${sl}-2`;
      used.add(sl);
      it.slug = sl;
    }
  }
  return site;
}

/** Fill in what every site needs: unique slugs and anchors, a hero and a footer, links that resolve. */
function finalize(site) {
  tidySite(site);
  // links: map "/Page Title" style hrefs and dangling anchors onto real pages
  const slugs = new Map(site.pages.map((p) => [p.slug, p]));
  const anchorsOn = (p) => new Set(p.sections.map((s) => s.anchor).filter(Boolean));
  const fix = (href, p) => {
    if (!href) return href;
    const m = href.match(/^\/([\w-]*)(#[\w-]+)?$/);
    if (m) {
      let target = m[1];
      if (!slugs.has(target)) {
        const guess = site.pages.find((x) => x.slug && (x.slug.startsWith(target) || target.startsWith(x.slug) || slugify(x.title) === target));
        target = guess ? guess.slug : '';
      }
      return `/${target}${m[2] || ''}`;
    }
    const a = href.match(/^#([\w-]+)$/);
    if (a && !anchorsOn(p).has(a[1])) {
      if (slugs.has(a[1])) return `/${a[1]}`;
      const other = site.pages.find((x) => anchorsOn(x).has(a[1]));
      if (other) return `/${other.slug}#${a[1]}`;
      const contactPage = site.pages.find((x) => x.sections.some((s) => s.type === 'contact' || s.type === 'signup'));
      if (contactPage) {
        const sx = contactPage.sections.find((s) => s.type === 'contact' || s.type === 'signup');
        return contactPage === p ? `#${sx.anchor}` : `/${contactPage.slug}#${sx.anchor}`;
      }
    }
    return href;
  };
  const walk = (o, p) => {
    if (Array.isArray(o)) { o.forEach((x) => walk(x, p)); return; }
    if (!o || typeof o !== 'object') return;
    if ('href' in o && 'label' in o) o.href = fix(o.href, p);
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, p);
  };
  site.pages.forEach((p) => p.sections.forEach((s) => walk(s, p)));
  if (site.nav?.cta) site.nav.cta.href = fix(site.nav.cta.href, site.pages[0]);
  return site;
}

function ensureShape(p, i, name) {
  const secs = p.sections;
  if (!secs.length || secs[0].type !== 'hero') {
    const h = newSection('hero', { name });
    if (i > 0) { h.variant = 'banner'; h.title = p.title; h.eyebrow = ''; h.subtitle = ''; h.cta = { label: '', href: '' }; h.cta2 = { label: '', href: '' }; }
    secs.unshift(h);
  }
  const fi = secs.findIndex((s) => s.type === 'footer');
  if (fi === -1) secs.push(footer(''));
  else if (fi !== secs.length - 1) secs.push(secs.splice(fi, 1)[0]);
  // a second footer is dropped
  for (let k = secs.length - 2; k >= 0; k--) if (secs[k].type === 'footer') secs.splice(k, 1);
}

/**
 * Validate a site. `raw` may be model output (compact: images as prompt strings, testimonials as
 * placeholders) or a full saved spec. Returns `fallback` unchanged when raw is not usable.
 * opts: { source: 'model' | 'user', assets: Set<assetId>, prompt }
 */
export function sanitizeSite(raw, fallback, options = {}) {
  const opts = { source: options.source || 'model', assets: options.assets || new Set(), prompt: String(options.prompt ?? fallback?.prompt ?? '') };
  opts.facts = (opts.prompt.match(/\d[\d,.]*/g) || []).map((n) => n.replace(/[,.]+$/, ''));
  try {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pages)) return fallback;
    const name = clean(raw.name, 80) || fallback?.name || 'My site';
    const pages = raw.pages.slice(0, 5).filter((p) => p && typeof p === 'object' && Array.isArray(p.sections)).map((p, i) => ({
      id: /^[\w-]{2,24}$/.test(p.id || '') ? p.id : uid('p'),
      slug: i === 0 ? '' : clean(p.slug ?? p.title, 60),
      title: clean(p.title, 40) || (i === 0 ? 'Home' : `Page ${i + 1}`),
      seo: { title: clean(p.seo?.title, 70), description: clean(p.seo?.description, 170) },
      sections: p.sections.slice(0, 16).map((s) => cleanSection(s, opts)).filter(Boolean),
    })).filter((p) => p.sections.length);
    const total = pages.reduce((n, p) => n + p.sections.length, 0);
    if (!pages.length || total < 3) return fallback;
    pages.forEach((p, i) => ensureShape(p, i, name));
    const style = raw.theme?.style && STYLES[raw.theme.style] ? raw.theme.style : fallback?.theme?.style || 'editorial';
    let theme = opts.source === 'user' && raw.theme ? cleanTheme(raw.theme, style) : { ...themeFor(style, isHex(raw.accent) ? raw.accent : fallback?.theme?.accent) };
    if (opts.source === 'model' && fallback?.theme) theme = { ...fallback.theme, accent: STYLES[style].fixedAccent ? fallback.theme.accent : isHex(raw.accent) ? raw.accent.toLowerCase() : fallback.theme.accent };
    const seo = raw.seo && typeof raw.seo === 'object' ? raw.seo : {};
    const contact = raw.contact && typeof raw.contact === 'object' ? raw.contact : {};
    const fbc = fallback?.contact || {};
    const site = {
      v: SPEC_VERSION,
      name,
      tagline: clean(raw.tagline, 140) || (opts.source === 'model' ? fallback?.tagline || '' : ''),
      kind: KINDS[raw.kind] ? raw.kind : fallback?.kind || 'business',
      prompt: clean(raw.prompt ?? fallback?.prompt ?? '', 600),
      theme,
      seo: {
        title: clean(seo.title, 70) || name,
        description: clean(seo.description, 170) || fallback?.seo?.description || '',
        url: opts.source === 'user' ? safeFormUrl(seo.url).replace(/\/+$/, '') : '',
        image: cleanImage(seo.image, opts),
        lang: /^[a-z]{2}(-[A-Z]{2})?$/.test(seo.lang || '') ? seo.lang : 'en',
      },
      contact: {
        email: safeEmail(contact.email) && (opts.source === 'user' || opts.prompt.includes(contact.email)) ? safeEmail(contact.email) : fbc.email || '',
        phone: opts.source === 'user' || opts.prompt.replace(/\D/g, '').includes(String(contact.phone || '-').replace(/\D/g, '')) ? clean(contact.phone, 40) || fbc.phone || '' : fbc.phone || '',
        address: clean(contact.address, 160) || fbc.address || '',
        form: opts.source === 'user' ? safeFormUrl(contact.form) : '',
      },
      nav: { cta: cleanLink(raw.nav?.cta || fallback?.nav?.cta || { label: '', href: '' }) },
      pages,
      collections: cleanCollections(raw.collections, opts),
      credit: raw.credit !== false,
    };
    if (opts.source === 'model') {
      // the model's site keeps the template's sample collections when it lists one but writes no items
      for (const key of Object.keys(COLLECTIONS)) {
        const used = pages.some((p) => p.sections.some((s) => SECTIONS[s.type].collection === key));
        if (used && !site.collections[key].length) site.collections[key] = (fallback?.collections?.[key] || []).map((x) => ({ ...x })) || [];
        if (used && !site.collections[key].length) site.collections[key] = [newItem(key), newItem(key), newItem(key)];
      }
    }
    return finalize(site);
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('sanitizeSite fell back:', e);
    return fallback;
  }
}

function cleanTheme(t, style) {
  const base = themeFor(style);
  return {
    style,
    palette: PALETTES[t.palette] ? t.palette : base.palette,
    mode: t.mode === 'dark' ? 'dark' : 'light',
    heading: FONTS[t.heading] ? t.heading : base.heading,
    body: FONTS[t.body] ? t.body : base.body,
    hw: Number.isFinite(+t.hw) ? Math.max(100, Math.min(1000, Math.round(+t.hw / 100) * 100)) : base.hw,
    accent: isHex(t.accent) ? t.accent.toLowerCase() : base.accent,
    radius: Number.isFinite(+t.radius) ? Math.max(0, Math.min(28, Math.round(+t.radius))) : base.radius,
    spacing: SPACING[t.spacing] ? t.spacing : base.spacing,
    motion: MOTION.includes(t.motion) ? t.motion : base.motion,
  };
}

/** Things to fix before publishing: placeholders, missing alt text, contact details. */
export function checklist(site) {
  const out = [];
  let ph = 0;
  let reviews = 0;
  let noAlt = 0;
  const scan = (o) => {
    if (Array.isArray(o)) { o.forEach(scan); return; }
    if (!o || typeof o !== 'object') return;
    if (o.ph) ph++;
    if ('src' in o && 'alt' in o && 'prompt' in o && o.src && !o.alt && !o.decorative) noAlt++;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && k !== 'prompt' && k !== 'alt' && isPlaceholder(v) && !o.ph) ph++;
      else if (v && typeof v === 'object') scan(v);
    }
  };
  for (const p of site.pages) for (const s of p.sections) {
    if (s.hidden) continue;
    if (s.type === 'testimonials') reviews += s.items.filter((x) => x.ph).length;
    scan(s);
  }
  for (const key of Object.keys(COLLECTIONS)) if (site.pages.some((p) => p.sections.some((s) => !s.hidden && SECTIONS[s.type].collection === key))) scan(site.collections[key]);
  if (reviews) out.push({ level: 'warn', text: `${reviews} review placeholder${reviews > 1 ? 's' : ''}. They say "Placeholder" on the live site until you paste real reviews, or remove the section.` });
  if (ph - reviews > 0) out.push({ level: 'warn', text: `${ph - reviews} placeholder${ph - reviews > 1 ? 's' : ''} to fill in (text in [brackets] or marked "Check").` });
  if (noAlt) out.push({ level: 'warn', text: `${noAlt} image${noAlt > 1 ? 's' : ''} without alt text.` });
  const hasForm = site.pages.some((p) => p.sections.some((s) => !s.hidden && (s.type === 'contact' || s.type === 'signup')));
  if (hasForm && !site.contact.form && !site.contact.email) out.push({ level: 'warn', text: 'Your form has nowhere to send messages. Add an email or a form URL in Settings.' });
  if (!site.seo.url) out.push({ level: 'info', text: 'Add your site address in Settings so the sitemap and link previews use full URLs.' });
  if (!site.seo.description) out.push({ level: 'info', text: 'Add a search description in Settings.' });
  return out;
}
