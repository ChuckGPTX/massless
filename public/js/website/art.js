// Placeholder art: an empty image slot gets a small inline SVG composition instead of a grey box. The composition
// follows the slot's suggested photo (a lawn gets hills, a portrait a sculpted bust, an app a device, a jacket a
// figure on a studio backdrop), its colours come from the theme tokens through CSS classes, and it is cropped to
// the slot's aspect ratio, so a site without photos still reads as art-directed. Deterministic per slot path.

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
function rng(seed) {
  let a = seed || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const f = (n) => Math.round(n * 10) / 10;

export const ART_KINDS = ['scene', 'figure', 'bust', 'device', 'dish', 'disc', 'stage', 'house', 'landscape', 'interior', 'still', 'orbit'];
const RULES = [
  ['figure', /\b(model|outfit|jacket|coat|trouser|dress|fashion|wear|lookbook|garment|shirt|knit|denim|runway|parka|overshirt|skirt)/i],
  ['device', /\b(app|screen|laptop|phone|dashboard|interface|ui|software|website|mockup|screenshot|tablet|device|prototype)\b/i],
  ['bust', /\b(portrait|person|people|speaker|author|founder|face|character|headshot|team member|woman|man|stylist|designer|teacher|coach)\b/i],
  ['dish', /\b(pizza|taco|tacos|ramen|bowl|plate|dish|burger|food|meal|curr(y|ies)|pho|brisket|salad|tortilla|cake|dessert|pastr|croissant|bread|latte|coffee|espresso|tostada|churro|noodle)/i],
  ['disc', /\b(album|vinyl|record|song|music|guitar|drum|microphone|playlist|turntable)/i],
  ['stage', /\b(stage|concert|crowd|audience|conference|keynote|festival|venue|perform)/i],
  ['house', /\b(house|home|porch|craftsman|exterior|cottage|bungalow|farmhouse)\b/i],
  ['landscape', /\b(lawn|garden|yard|field|landscape|hill|mountain|sunset|sunrise|beach|sea|ocean|forest|road|trip|travel|park|outdoor|sky|tree|leaves|meadow|desert|lake|city)/i],
  ['interior', /\b(room|kitchen|interior|studio|office|bathroom|bedroom|living|salon|gym|clinic|shop|store|workspace|desk|window|garage|hall|library)/i],
  ['still', /\b(bottle|vase|ceramic|cup|product|object|still life|jar|candle|soap|book|tool|flower|bouquet|bag|shoe|lamp|chair)/i],
];
/** Which composition suits a photo prompt. */
export function artKind(prompt = '', seed = 0) {
  if (PERSON.test(prompt) && PLACE.test(prompt) && !/backdrop/i.test(prompt)) return 'scene';
  for (const [k, re] of RULES) if (re.test(prompt)) return k;
  return ['orbit', 'landscape', 'still', 'interior'][seed % 4];
}

const SKIN = ['#e8c4a6', '#c89670', '#8c5b3c', '#f0d2bb', '#ad7752', '#5e3b27'];
const CLOTH = [['#3f4a2f', '#1b1b1a'], ['#7a3b22', '#2a211c'], ['#d9d0c1', '#1f1f1f'], ['#1c1c1c', '#5d7da6'], ['#5b6573', '#c9bfae'], ['#2b2622', '#8a6a4f'], ['#a8a29a', '#151515'], ['#6d1f1f', '#d8d2c6'], ['#1f2a3a', '#b7ab98']];

// --- compositions: (W, H, r, id) -> SVG markup ---------------------------------------------------------------

function landscape(W, H, r, id) {
  const sy = H * (0.3 + r() * 0.12);
  const sx = W * (0.25 + r() * 0.5);
  const sun = Math.min(W, H) * (0.08 + r() * 0.05);
  const layers = [0.52, 0.64, 0.78].map((y, i) => {
    const base = H * (y + r() * 0.04);
    const amp = H * (0.05 + r() * 0.06) / (i + 1);
    const ph = r() * 6.28;
    let d = `M0 ${f(base)}`;
    for (let x = 0; x <= W; x += W / 12) d += ` L${f(x)} ${f(base - Math.sin(x / W * (2.2 + i) * 3.14 + ph) * amp - Math.cos(x / W * 7 + ph) * amp * 0.25)}`;
    return `<path class="k-${['a3', 'a2', 'a'][i]}" d="${d} L${W} ${H} L0 ${H}Z"/>`;
  }).join('');
  return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop class="s-b3" offset="0"/><stop class="s-paper" offset="1"/></linearGradient></defs><rect class="bgr keep" width="${W}" height="${H}" fill="url(#${id}s)"/><circle class="k-b2" cx="${f(sx)}" cy="${f(sy)}" r="${f(sun)}"/>${layers}`;
}

function interior(W, H, r, id) {
  const fl = H * 0.72;
  const aw = Math.min(W * 0.34, H * 0.36);
  const ax = W * (0.22 + r() * 0.3);
  const top = H * 0.16;
  const plantX = ax + aw + W * 0.12 > W * 0.9 ? ax - W * 0.14 : ax + aw + W * 0.1;
  return `<defs><linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop class="s-b2" offset="0"/><stop class="s-paper" offset="1"/></linearGradient></defs>
<rect class="bgr k-bg" width="${W}" height="${H}"/><rect class="k-ink2" y="${f(fl)}" width="${W}" height="${f(H - fl)}"/>
<path class="keep" fill="url(#${id}w)" d="M${f(ax)} ${f(fl - 4)}V${f(top + aw / 2)}A${f(aw / 2)} ${f(aw / 2)} 0 0 1 ${f(ax + aw)} ${f(top + aw / 2)}V${f(fl - 4)}Z"/>
<path class="k-paper o5" d="M${f(ax)} ${f(fl)}L${f(ax + aw)} ${f(fl)}L${f(ax + aw + W * 0.32)} ${H}L${f(ax + W * 0.12)} ${H}Z"/>
<rect class="k-a2" x="${f(plantX)}" y="${f(fl - H * 0.1)}" width="${f(W * 0.07)}" height="${f(H * 0.1)}" rx="3"/>
<ellipse class="k-a" cx="${f(plantX + W * 0.02)}" cy="${f(fl - H * 0.2)}" rx="${f(W * 0.03)}" ry="${f(H * 0.09)}" transform="rotate(-18 ${f(plantX + W * 0.02)} ${f(fl - H * 0.2)})"/>
<ellipse class="k-a2" cx="${f(plantX + W * 0.055)}" cy="${f(fl - H * 0.22)}" rx="${f(W * 0.028)}" ry="${f(H * 0.1)}" transform="rotate(16 ${f(plantX + W * 0.055)} ${f(fl - H * 0.22)})"/>`;
}

function still(W, H, r, id) {
  const t = H * 0.7;
  const u = Math.min(W, H);
  const cx = W / 2 + (r() - 0.5) * W * 0.1;
  const vh = u * (0.36 + r() * 0.1);
  const vw = u * 0.16;
  const sr = u * 0.1;
  return `<defs><radialGradient id="${id}o" cx=".35" cy=".3" r=".8"><stop class="s-paper" offset="0"/><stop class="s-b" offset=".55"/><stop class="s-b-d" offset="1"/></radialGradient><linearGradient id="${id}v" x1="0" x2="1"><stop class="s-a2" offset="0"/><stop class="s-a" offset=".7"/><stop class="s-a-d" offset="1"/></linearGradient><linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop class="s-bg" offset="0"/><stop class="s-b3" offset="1"/></linearGradient></defs>
<rect class="bgr keep" width="${W}" height="${H}" fill="url(#${id}b)"/><rect class="k-ink2" y="${f(t)}" width="${W}" height="${f(H - t)}"/>
<ellipse class="k-sh" cx="${f(cx - vw * 0.6 + vw * 0.5)}" cy="${f(t + 6)}" rx="${f(vw * 1.1)}" ry="${f(u * 0.02)}"/>
<path class="keep" fill="url(#${id}v)" d="M${f(cx - vw)} ${f(t)}V${f(t - vh * 0.6)}Q${f(cx - vw)} ${f(t - vh * 0.82)} ${f(cx - vw * 0.42)} ${f(t - vh * 0.86)}V${f(t - vh)}H${f(cx - vw * 0.08)}V${f(t - vh * 0.86)}Q${f(cx + vw * 0.5)} ${f(t - vh * 0.82)} ${f(cx + vw * 0.5)} ${f(t - vh * 0.6)}V${f(t)}Z"/>
<ellipse class="k-sh" cx="${f(cx + vw * 1.4)}" cy="${f(t + 4)}" rx="${f(sr * 1.1)}" ry="${f(u * 0.018)}"/>
<circle class="keep" fill="url(#${id}o)" cx="${f(cx + vw * 1.35)}" cy="${f(t - sr)}" r="${f(sr)}"/>
<path class="k-paper" d="M${f(cx - vw * 2.6)} ${f(t)}a${f(vw * 0.9)} ${f(vw * 0.55)} 0 0 0 ${f(vw * 1.8)} 0Z"/>`;
}

const TONE = ['#ead9c8', '#d8bea6', '#c29a7c', '#9a7258', '#6e4f3c', '#e3cdb9'];
const HAIR = ['#1d1714', '#2e2119', '#4a3426', '#151413', '#8a6a4c', '#c9b8a3'];
const TOP = ['#151515', '#2b2622', '#ebe6dc', '#4a5a3c', '#7a3b22', '#33415c', '#b9ab95'];
const pick = (r, a) => a[Math.floor(r() * a.length)];

/** A soft elliptical floor shadow. */
const shadow = (id, cx, cy, rx, ry) => `<radialGradient id="${id}" cx=".5" cy=".5" r=".5"><stop class="s-shd" offset="0"/><stop class="s-sh0" offset="1"/></radialGradient>`;
const shadowUse = (id, cx, cy, rx, ry) => `<ellipse class="keep" fill="url(#${id})" cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}"/>`;

/** A standing figure in a coat and trousers, feet at top + fh. Proportions of a fashion sketch. */
function person(cx, top, fh, r, id) {
  const [coat, pants] = pick(r, CLOTH);
  const u = fh / 100;
  const long = r() < 0.55;
  const hemK = long ? 67 : 45;
  const hw = long ? 9.6 : 8.2;
  const X = (k) => f(cx + u * k);
  const Y = (k) => f(top + u * k);
  const bun = r() < 0.4;
  return `<g style="--coat:${coat};--pants:${pants};--sk:${pick(r, TONE)};--hair:${pick(r, HAIR)}"><defs><linearGradient id="${id}c" x1="0" x2="1"><stop class="s-coat-d" offset="0"/><stop class="s-coat" offset=".32"/><stop class="s-coat-l" offset=".52"/><stop class="s-coat" offset=".72"/><stop class="s-coat-d" offset="1"/></linearGradient><linearGradient id="${id}p" x1="0" x2="1"><stop class="s-pants-d" offset="0"/><stop class="s-pants" offset=".45"/><stop class="s-pants-d" offset="1"/></linearGradient>${shadow(`${id}s`)}</defs>${shadowUse(`${id}s`, cx, top + fh, u * 16, u * 2.4)}
<path class="keep" fill="url(#${id}p)" d="M${X(-6)} ${Y(40)}L${X(-6.6)} ${Y(96.6)}H${X(-0.9)}L${X(-0.2)} ${Y(54)}L${X(0.2)} ${Y(54)}L${X(0.9)} ${Y(96.6)}H${X(6.6)}L${X(6)} ${Y(40)}Z"/>
<path class="k-crease" d="M${X(-3.8)} ${Y(hemK + 2)}V${Y(96)}M${X(3.8)} ${Y(hemK + 2)}V${Y(96)}"/>
<rect class="k-shoe" x="${X(-7.3)}" y="${Y(96.2)}" width="${f(u * 6.6)}" height="${f(u * 3)}" rx="${f(u * 1.3)}"/><rect class="k-shoe" x="${X(0.7)}" y="${Y(96.2)}" width="${f(u * 6.6)}" height="${f(u * 3)}" rx="${f(u * 1.3)}"/>
<path class="k-sleeve" d="M${X(-8.4)} ${Y(14.5)}Q${X(-11)} ${Y(16)} ${X(-11)} ${Y(22)}L${X(-11.6)} ${Y(45)}H${X(-8.6)}L${X(-7.6)} ${Y(24)}ZM${X(8.4)} ${Y(14.5)}Q${X(11)} ${Y(16)} ${X(11)} ${Y(22)}L${X(11.6)} ${Y(45)}H${X(8.6)}L${X(7.6)} ${Y(24)}Z"/>
<ellipse class="k-skin" cx="${X(-10.1)}" cy="${Y(46.6)}" rx="${f(u * 1.3)}" ry="${f(u * 1.9)}"/><ellipse class="k-skin" cx="${X(10.1)}" cy="${Y(46.6)}" rx="${f(u * 1.3)}" ry="${f(u * 1.9)}"/>
<path class="keep" fill="url(#${id}c)" d="M${X(-8.6)} ${Y(16.5)}Q${X(-8.4)} ${Y(13.6)} ${X(-4.4)} ${Y(13)}L${X(0)} ${Y(14.6)}L${X(4.4)} ${Y(13)}Q${X(8.4)} ${Y(13.6)} ${X(8.6)} ${Y(16.5)}L${X(hw)} ${Y(hemK)}Q${X(0)} ${Y(hemK + 0.8)} ${X(-hw)} ${Y(hemK)}Z"/>
<path class="k-inner" d="M${X(-2.2)} ${Y(13.4)}L${X(0)} ${Y(23)}L${X(2.2)} ${Y(13.4)}Z"/>
<path class="k-lapel" d="M${X(-2.4)} ${Y(13.2)}L${X(0.3)} ${Y(26)}M${X(2.4)} ${Y(13.2)}L${X(-0.3)} ${Y(26)}M${X(0.3)} ${Y(26)}L${X(0.3)} ${Y(hemK - 1)}"/>
${long ? `<rect class="k-belt" x="${X(-8.9)}" y="${Y(37)}" width="${f(u * 17.8)}" height="${f(u * 1.5)}" rx="${f(u * 0.4)}"/>` : ''}
<rect class="k-skin" x="${X(-1.25)}" y="${Y(8.5)}" width="${f(u * 2.5)}" height="${f(u * 5.4)}"/>
${bun ? `<circle class="k-hair" cx="${X(1.2)}" cy="${Y(0.6)}" r="${f(u * 2.2)}"/>` : ''}<ellipse class="k-hair" cx="${X(0)}" cy="${Y(4.9)}" rx="${f(u * 3.55)}" ry="${f(u * 4.3)}"/>
<ellipse class="k-skin" cx="${X(0.15)}" cy="${Y(5.9)}" rx="${f(u * 3.05)}" ry="${f(u * 3.95)}"/>
<path class="k-hair" d="M${X(-3.4)} ${Y(5.4)}C${X(-3.6)} ${Y(1.2)} ${X(-0.6)} ${Y(0.4)} ${X(0.4)} ${Y(0.6)}C${X(2.6)} ${Y(0.7)} ${X(3.7)} ${Y(2.4)} ${X(3.5)} ${Y(5)}C${X(2.2)} ${Y(2.9)} ${X(-0.4)} ${Y(2.6)} ${X(-3.4)} ${Y(5.4)}Z"/></g>`;
}

function figure(W, H, r, id) {
  const two = W / H > 1.25 && r() < 0.6;
  const fh = Math.min(H * (two ? 0.74 : 0.8), W * (two ? 1.1 : 2.2));
  const top = (H - fh) * 0.58;
  const cx = W / 2 + (r() - 0.5) * W * 0.06;
  const people = two ? person(cx - fh * 0.16, top + fh * 0.02, fh * 0.98, r, `${id}q`) + person(cx + fh * 0.15, top, fh, r, `${id}p`) : person(cx, top, fh, r, `${id}p`);
  return `<defs><linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop class="s-paper" offset="0"/><stop class="s-bg" offset=".7"/><stop class="s-ink2" offset="1"/></linearGradient><radialGradient id="${id}v" cx=".5" cy=".45" r=".75"><stop class="s-paper" offset="0" style="stop-opacity:.7"/><stop class="s-paper" offset="1" style="stop-opacity:0"/></radialGradient></defs>
<rect class="bgr keep" width="${W}" height="${H}" fill="url(#${id}b)"/><rect class="keep vig" width="${W}" height="${H}" fill="url(#${id}v)"/>${people}`;
}

/** A head-and-shoulders portrait: lit from the left, hair framing a quiet face, a plain top. */
function bust(W, H, r, id) {
  const u = Math.min(W, H * 0.82);
  const cx = W / 2;
  const hr = u * 0.135;
  const cy = H * 0.43;
  const sw = u * 0.44;
  const style = Math.floor(r() * 4);
  const hairBack = [
    `<path class="k-hair" d="M${f(cx - hr * 1.18)} ${f(cy + hr * 1.25)}C${f(cx - hr * 1.32)} ${f(cy - hr * 1.5)} ${f(cx + hr * 1.32)} ${f(cy - hr * 1.5)} ${f(cx + hr * 1.18)} ${f(cy + hr * 1.25)}Q${f(cx)} ${f(cy + hr * 1.45)} ${f(cx - hr * 1.18)} ${f(cy + hr * 1.25)}Z"/>`,
    `<path class="k-hair" d="M${f(cx - hr * 1.15)} ${f(cy + hr * 2.6)}C${f(cx - hr * 1.5)} ${f(cy - hr * 1.6)} ${f(cx + hr * 1.5)} ${f(cy - hr * 1.6)} ${f(cx + hr * 1.15)} ${f(cy + hr * 2.6)}Z"/>`,
    `<circle class="k-hair" cx="${f(cx + hr * 0.15)}" cy="${f(cy - hr * 1.2)}" r="${f(hr * 0.55)}"/><ellipse class="k-hair" cx="${f(cx)}" cy="${f(cy - hr * 0.12)}" rx="${f(hr * 0.96)}" ry="${f(hr * 1.16)}"/>`,
    `<ellipse class="k-hair" cx="${f(cx)}" cy="${f(cy - hr * 0.18)}" rx="${f(hr * 0.95)}" ry="${f(hr * 1.12)}"/>`,
  ][style];
  return `<g style="--sk:${pick(r, TONE)};--hair:${pick(r, HAIR)};--top:${pick(r, TOP)}"><defs><radialGradient id="${id}bg" cx=".5" cy=".38" r=".8"><stop class="s-paper" offset="0"/><stop class="s-bg" offset=".72"/><stop class="s-b3" offset="1"/></radialGradient><radialGradient id="${id}h" cx=".36" cy=".34" r=".9"><stop class="s-sk-l" offset="0"/><stop class="s-sk" offset=".55"/><stop class="s-sk-d" offset="1"/></radialGradient><linearGradient id="${id}n" x1="0" y1="0" x2="0" y2="1"><stop class="s-sk-d" offset="0"/><stop class="s-sk" offset=".6"/></linearGradient><linearGradient id="${id}t" x1="0" x2="1"><stop class="s-top-l" offset="0"/><stop class="s-top" offset=".55"/><stop class="s-top-d" offset="1"/></linearGradient></defs>
<rect class="bgr keep" width="${W}" height="${H}" fill="url(#${id}bg)"/>${hairBack}
<path class="keep" fill="url(#${id}n)" d="M${f(cx - hr * 0.42)} ${f(cy + hr * 0.5)}V${f(cy + hr * 2.35)}Q${f(cx)} ${f(cy + hr * 2.9)} ${f(cx + hr * 0.42)} ${f(cy + hr * 2.35)}V${f(cy + hr * 0.5)}Z"/>
<path class="keep" fill="url(#${id}t)" d="M${f(cx - sw)} ${H}C${f(cx - sw)} ${f(cy + hr * 2.8)} ${f(cx - sw * 0.62)} ${f(cy + hr * 2.25)} ${f(cx - hr * 0.95)} ${f(cy + hr * 2.12)}Q${f(cx)} ${f(cy + hr * 3.05)} ${f(cx + hr * 0.95)} ${f(cy + hr * 2.12)}C${f(cx + sw * 0.62)} ${f(cy + hr * 2.25)} ${f(cx + sw)} ${f(cy + hr * 2.8)} ${f(cx + sw)} ${H}Z"/>
<ellipse class="keep" fill="url(#${id}h)" cx="${f(cx)}" cy="${f(cy)}" rx="${f(hr * 0.8)}" ry="${f(hr * 1.04)}"/>
<path class="k-hair" d="M${f(cx - hr * 0.86)} ${f(cy + hr * 0.15)}C${f(cx - hr * 0.95)} ${f(cy - hr * 1.15)} ${f(cx + hr * 0.2)} ${f(cy - hr * 1.32)} ${f(cx + hr * 0.62)} ${f(cy - hr * 0.95)}C${f(cx + hr * 0.9)} ${f(cy - hr * 0.7)} ${f(cx + hr * 0.92)} ${f(cy - hr * 0.2)} ${f(cx + hr * 0.86)} ${f(cy + hr * 0.15)}C${f(cx + hr * 0.62)} ${f(cy - hr * 0.62)} ${f(cx - hr * 0.1)} ${f(cy - hr * 0.78)} ${f(cx - hr * 0.86)} ${f(cy + hr * 0.15)}Z"/></g>`;
}

const PERSON = /\b(woman|man|person|people|model|character|couple|family|girl|boy|friends|she|he)\b/i;
const PLACE = /\b(street|city|cafe|café|park|rooftop|steps|bridge|beach|garden|courtyard|window|road|field|sunset|golden hour|dusk|autumn)\b/i;

/** A person in a place: a city street, a window, a park or a rooftop at golden hour. */
function scene(W, H, r, id, prompt = '') {
  const kind = /rooftop|golden hour|sunset|dusk/i.test(prompt) ? 'roof' : /cafe|café|window|coffee/i.test(prompt) ? 'window' : /park|garden|field|autumn|beach/i.test(prompt) ? 'park' : 'street';
  const gy = H * 0.9;
  let bg = '';
  if (kind === 'roof') {
    bg = `<defs><linearGradient id="${id}k" x1="0" y1="0" x2="0" y2="1"><stop class="s-b2" offset="0"/><stop class="s-a2" offset=".75"/><stop class="s-a" offset="1"/></linearGradient></defs><rect class="bgr keep" width="${W}" height="${H}" fill="url(#${id}k)"/><circle class="k-paper o5" cx="${f(W * 0.7)}" cy="${f(H * 0.62)}" r="${f(H * 0.12)}"/>`;
    let x = 0;
    while (x < W) { const w = W * (0.05 + r() * 0.09); const h = H * (0.08 + r() * 0.2); bg += `<rect class="k-a-d" x="${f(x)}" y="${f(gy - h)}" width="${f(w + 1)}" height="${f(h)}"/>`; x += w; }
    bg += `<rect class="k-a-d" y="${f(gy)}" width="${W}" height="${f(H - gy)}"/>`;
  } else if (kind === 'window') {
    bg = `<rect class="bgr k-bg" width="${W}" height="${H}"/><rect class="k-b3" x="${f(W * 0.08)}" y="${f(H * 0.08)}" width="${f(W * 0.84)}" height="${f(H * 0.66)}"/><path class="k-paper o5" d="M${f(W * 0.08)} ${f(H * 0.08)}H${f(W * 0.5)}L${f(W * 0.3)} ${f(H * 0.74)}H${f(W * 0.08)}Z"/><path class="k-frame" d="M${f(W * 0.5)} ${f(H * 0.08)}V${f(H * 0.74)}M${f(W * 0.08)} ${f(H * 0.4)}H${f(W * 0.92)}"/><rect class="k-ink2" y="${f(H * 0.74)}" width="${W}" height="${f(H * 0.26)}"/>`;
  } else if (kind === 'park') {
    bg = landscape(W, H, r, `${id}l`) + [0.18, 0.84].map((k) => `<rect class="k-ink2" x="${f(W * k - 3)}" y="${f(H * 0.5)}" width="6" height="${f(H * 0.25)}"/><circle class="k-a2" cx="${f(W * k)}" cy="${f(H * 0.46)}" r="${f(H * 0.12)}"/>`).join('');
  } else {
    bg = `<defs><linearGradient id="${id}k" x1="0" y1="0" x2="0" y2="1"><stop class="s-b3" offset="0"/><stop class="s-paper" offset="1"/></linearGradient><pattern id="${id}w" width="28" height="34" patternUnits="userSpaceOnUse"><rect class="k-paper" x="8" y="9" width="12" height="17" opacity=".42"/></pattern></defs><rect class="bgr keep" width="${W}" height="${H}" fill="url(#${id}k)"/>`;
    let x = -W * 0.05;
    while (x < W) {
      const w = W * (0.16 + r() * 0.14);
      const h = H * (0.45 + r() * 0.35);
      bg += `<rect class="${pick(r, ['k-a3', 'k-ink2', 'k-b3', 'k-a2'])}" x="${f(x)}" y="${f(gy - h)}" width="${f(w)}" height="${f(h)}"/><rect class="keep win" fill="url(#${id}w)" x="${f(x + 6)}" y="${f(gy - h + 8)}" width="${f(w - 12)}" height="${f(h - 40)}"/>`;
      x += w + W * 0.012;
    }
    bg += `<rect class="k-ink2" y="${f(gy)}" width="${W}" height="${f(H - gy)}"/>`;
  }
  const fh = H * (kind === 'window' ? 0.6 : 0.56);
  const cx = W * (0.38 + r() * 0.24);
  return `${bg}${person(cx, gy - fh + (kind === 'window' ? -H * 0.06 : 0), fh, r, `${id}p`)}`;
}

/** What a device shows: a map, a camera, a page of text or a dashboard, drawn into the screen rect. */
function screen(kind, x, y, w, h, r, id) {
  const R = (cls, rx, ry, rw, rh, rr = 2) => `<rect class="${cls}" x="${f(x + rx * w)}" y="${f(y + ry * h)}" width="${f(rw * w)}" height="${f(rh * h)}" rx="${rr}"/>`;
  if (kind === 'map') {
    let d = '';
    for (let k = 0; k < 7; k++) d += `<path class="k-road" d="M${f(x)} ${f(y + h * (0.1 + k * 0.14 + r() * 0.05))}L${f(x + w)} ${f(y + h * (0.05 + k * 0.15 + r() * 0.08))}"/><path class="k-road" d="M${f(x + w * (0.08 + k * 0.15))} ${f(y)}L${f(x + w * (0.02 + k * 0.16 + r() * 0.06))} ${f(y + h)}"/>`;
    const px = x + w * 0.62;
    const py = y + h * 0.42;
    return `${R('k-b3', 0, 0, 1, 1, 0)}${R('k-a3', 0.05, 0.55, 0.3, 0.3, 4)}${R('k-a3', 0.7, 0.08, 0.26, 0.22, 4)}${d}<path class="k-route" d="M${f(x + w * 0.12)} ${f(y + h * 0.9)}C${f(x + w * 0.3)} ${f(y + h * 0.5)} ${f(x + w * 0.45)} ${f(y + h * 0.7)} ${f(px)} ${f(py)}"/><circle class="k-a" cx="${f(px)}" cy="${f(py)}" r="${f(Math.min(w, h) * 0.05)}"/><circle class="k-paper" cx="${f(px)}" cy="${f(py)}" r="${f(Math.min(w, h) * 0.018)}"/>${R('k-paper', 0.06, 0.06, 0.5, 0.09, 6)}`;
  }
  if (kind === 'photo') {
    return `<defs><linearGradient id="${id}ph" x1="0" y1="0" x2="0" y2="1"><stop class="s-b2" offset="0"/><stop class="s-a2" offset="1"/></linearGradient></defs><rect class="keep" fill="url(#${id}ph)" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"/><circle class="k-b" cx="${f(x + w * 0.66)}" cy="${f(y + h * 0.32)}" r="${f(Math.min(w, h) * 0.1)}"/><path class="k-a" d="M${f(x)} ${f(y + h * 0.72)}Q${f(x + w * 0.3)} ${f(y + h * 0.52)} ${f(x + w * 0.55)} ${f(y + h * 0.68)}T${f(x + w)} ${f(y + h * 0.62)}V${f(y + h)}H${f(x)}Z"/>${R('k-ink', 0, 0.84, 1, 0.16, 0)}<circle class="k-paper" cx="${f(x + w / 2)}" cy="${f(y + h * 0.92)}" r="${f(h * 0.05)}"/>`;
  }
  if (kind === 'doc') {
    let lines = '';
    for (let k = 0; k < 9; k++) lines += R('k-ink3', 0.12, 0.42 + k * 0.055, 0.76 - (k % 3 === 2 ? 0.3 : r() * 0.1), 0.022);
    return `${R('k-paper', 0, 0, 1, 1, 0)}${R('k-ink2', 0.12, 0.1, 0.62, 0.05)}${R('k-ink3', 0.12, 0.18, 0.4, 0.03)}<rect class="keep" fill="url(#${id}g)" x="${f(x + w * 0.12)}" y="${f(y + h * 0.25)}" width="${f(w * 0.76)}" height="${f(h * 0.13)}" rx="2"/>${lines}`;
  }
  const cards = [0, 1, 2, 3, 4, 5].map((k) => R(['k-a3', 'k-b3', 'k-ink3'][(k + Math.floor(r() * 3)) % 3], 0.3 + (k % 3) * 0.225, 0.42 + Math.floor(k / 3) * 0.28, 0.205, 0.24)).join('');
  return `${R('k-paper', 0, 0, 1, 1, 0)}${R('k-ink3', 0, 0, 0.24, 1, 0)}${R('k-ink2', 0.03, 0.08, 0.15, 0.035)}${R('k-a', 0.03, 0.17, 0.18, 0.06, 3)}${R('k-ink3', 0.03, 0.27, 0.12, 0.03)}${R('k-ink3', 0.03, 0.34, 0.14, 0.03)}<rect class="keep" fill="url(#${id}g)" x="${f(x + w * 0.3)}" y="${f(y + h * 0.08)}" width="${f(w * 0.655)}" height="${f(h * 0.28)}" rx="2"/>${cards}`;
}

function device(W, H, r, id, prompt = '') {
  const u = Math.min(W, H);
  const kind = /\b(map|maps|route|navigation)\b/i.test(prompt) ? 'map' : /\b(camera|photo|photos|shutter)\b/i.test(prompt) ? 'photo' : /\b(read|reading|article|book|notes?|journal|news)\b/i.test(prompt) ? 'doc' : 'dash';
  const bg = `<defs><linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop class="s-paper" offset="0"/><stop class="s-bg" offset="1"/></linearGradient><linearGradient id="${id}g" x1="0" y1="0" x2="1" y2="1"><stop class="s-a" offset="0"/><stop class="s-b" offset="1"/></linearGradient></defs><rect class="bgr keep" width="${W}" height="${H}" fill="url(#${id}b)"/>`;
  if (/\b(thermostat|dial|watch|knob)\b/i.test(prompt)) {
    const R = u * 0.3;
    const cx = W / 2;
    const cy = H / 2;
    let ticks = '';
    for (let k = 0; k < 48; k++) { const a = Math.PI * (0.75 + (k / 47) * 1.5); ticks += `<path class="${k < 30 ? 'k-tick-on' : 'k-tick'}" d="M${f(cx + Math.cos(a) * R * 0.66)} ${f(cy + Math.sin(a) * R * 0.66)}L${f(cx + Math.cos(a) * R * 0.74)} ${f(cy + Math.sin(a) * R * 0.74)}"/>`; }
    return `${bg}<defs><radialGradient id="${id}d" cx=".4" cy=".35" r=".8"><stop class="s-a2" offset="0"/><stop class="s-a" offset=".7"/><stop class="s-a-d" offset="1"/></radialGradient><linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1"><stop class="s-paper" offset="0"/><stop class="s-ink2" offset=".5"/><stop class="s-paper" offset="1"/></linearGradient></defs><ellipse class="k-sh" cx="${f(cx + R * 0.1)}" cy="${f(cy + R * 1.08)}" rx="${f(R * 0.9)}" ry="${f(R * 0.08)}"/><circle class="keep" fill="url(#${id}m)" cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}"/><circle class="k-ink" cx="${f(cx)}" cy="${f(cy)}" r="${f(R * 0.88)}"/><circle class="keep" fill="url(#${id}d)" cx="${f(cx)}" cy="${f(cy)}" r="${f(R * 0.82)}"/>${ticks}<circle class="k-paper" cx="${f(cx)}" cy="${f(cy)}" r="${f(R * 0.2)}" opacity=".9"/>`;
  }
  const phone = H > W * 1.05;
  if (phone) {
    const pw = Math.min(W * 0.5, H * 0.36);
    const ph = pw * 2.05;
    const x = (W - pw) / 2;
    const y = (H - ph) / 2;
    const sx = x + pw * 0.045;
    const sy = y + pw * 0.045;
    const inner = kind === 'dash' ? [0, 1, 2, 3].map((k) => `<rect class="k-ink3" x="${f(x + pw * 0.1)}" y="${f(y + ph * (0.55 + k * 0.09))}" width="${f(pw * 0.14)}" height="${f(pw * 0.14)}" rx="${f(pw * 0.04)}"/><rect class="k-ink2" x="${f(x + pw * 0.3)}" y="${f(y + ph * (0.56 + k * 0.09))}" width="${f(pw * (0.35 + r() * 0.25))}" height="${f(pw * 0.035)}" rx="2"/>`).join('') + `<rect class="keep" fill="url(#${id}g)" x="${f(x + pw * 0.08)}" y="${f(y + ph * 0.1)}" width="${f(pw * 0.84)}" height="${f(ph * 0.38)}" rx="${f(pw * 0.06)}"/>` : screen(kind, sx, sy, pw * 0.91, ph - pw * 0.09, r, id);
    return `${bg}<ellipse class="k-sh" cx="${f(W / 2)}" cy="${f(y + ph + u * 0.03)}" rx="${f(pw * 0.55)}" ry="${f(u * 0.015)}"/><rect class="k-ink" x="${f(x)}" y="${f(y)}" width="${f(pw)}" height="${f(ph)}" rx="${f(pw * 0.16)}"/><svg x="${f(sx)}" y="${f(sy)}" width="${f(pw * 0.91)}" height="${f(ph - pw * 0.09)}" viewBox="${f(sx)} ${f(sy)} ${f(pw * 0.91)} ${f(ph - pw * 0.09)}"><rect class="k-paper" x="${f(sx)}" y="${f(sy)}" width="${f(pw * 0.91)}" height="${f(ph - pw * 0.09)}" rx="${f(pw * 0.12)}"/>${inner}</svg><rect class="k-ink" x="${f(x + pw * 0.36)}" y="${f(y + pw * 0.08)}" width="${f(pw * 0.28)}" height="${f(pw * 0.06)}" rx="${f(pw * 0.03)}"/>`;
  }
  const lw = Math.min(W * 0.74, H * 1.25);
  const lh = lw * 0.62;
  const x = (W - lw) / 2;
  const y = (H - lh) / 2 - lh * 0.04;
  const sx = x + lw * 0.035;
  const sy = y + lw * 0.035;
  const sw = lw * 0.93;
  const sh = lh - lw * 0.07;
  return `${bg}<ellipse class="k-sh" cx="${f(W / 2)}" cy="${f(y + lh + lw * 0.05)}" rx="${f(lw * 0.56)}" ry="${f(u * 0.02)}"/><rect class="k-ink" x="${f(x)}" y="${f(y)}" width="${f(lw)}" height="${f(lh)}" rx="${f(lw * 0.025)}"/><svg x="${f(sx)}" y="${f(sy)}" width="${f(sw)}" height="${f(sh)}" viewBox="${f(sx)} ${f(sy)} ${f(sw)} ${f(sh)}">${screen(kind, sx, sy, sw, sh, r, id)}</svg><path class="k-ink2" d="M${f(x - lw * 0.07)} ${f(y + lh)}H${f(x + lw * 1.07)}L${f(x + lw * 1.03)} ${f(y + lh + lw * 0.03)}H${f(x - lw * 0.03)}Z"/>`;
}

function dish(W, H, r, id) {
  const u = Math.min(W, H);
  const cx = W / 2 + (r() - 0.5) * W * 0.12;
  const cy = H / 2 + (r() - 0.5) * H * 0.06;
  const R = u * 0.34;
  const dots = Array.from({ length: 14 }, () => { const a = r() * 6.28; const d = r() * R * 0.62; return `<circle class="${r() < 0.5 ? 'k-a' : 'k-b'}" cx="${f(cx + Math.cos(a) * d)}" cy="${f(cy + Math.sin(a) * d)}" r="${f(u * (0.012 + r() * 0.022))}"/>`; }).join('');
  return `<defs><radialGradient id="${id}f" cx=".45" cy=".4" r=".7"><stop class="s-b2" offset="0"/><stop class="s-a2" offset="1"/></radialGradient></defs><rect class="bgr k-ink2" width="${W}" height="${H}"/><path class="k-ink3" d="M0 ${f(H * 0.18)}H${W}M0 ${f(H * 0.82)}H${W}" style="stroke-width:${f(u * 0.004)}"/>
<ellipse class="k-sh" cx="${f(cx + u * 0.03)}" cy="${f(cy + u * 0.04)}" rx="${f(R * 1.08)}" ry="${f(R * 1.04)}"/><circle class="k-paper" cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}"/><circle class="k-bg" cx="${f(cx)}" cy="${f(cy)}" r="${f(R * 0.8)}"/><circle class="keep" fill="url(#${id}f)" cx="${f(cx)}" cy="${f(cy)}" r="${f(R * 0.68)}"/>${dots}
<rect class="k-paper" x="${f(cx + R * 1.25)}" y="${f(cy - R * 0.9)}" width="${f(u * 0.035)}" height="${f(R * 1.9)}" rx="${f(u * 0.017)}"/>`;
}

function disc(W, H, r, id) {
  const u = Math.min(W, H);
  const cx = W * (0.5 + (r() - 0.5) * 0.1);
  const cy = H / 2;
  const R = u * 0.36;
  const gx = cx + R * 0.15;
  const grooves = [0.95, 0.85, 0.75, 0.65, 0.55].map((k) => `<circle class="k-groove" cx="${f(gx)}" cy="${f(cy)}" r="${f(R * k)}"/>`).join('');
  return `<defs><linearGradient id="${id}l" x1="0" y1="0" x2="1" y2="1"><stop class="s-a" offset="0"/><stop class="s-b" offset="1"/></linearGradient></defs><rect class="bgr k-bg" width="${W}" height="${H}"/><rect class="keep" fill="url(#${id}l)" x="${f(cx - R * 1.25)}" y="${f(cy - R)}" width="${f(R * 2)}" height="${f(R * 2)}" opacity=".9"/><circle class="k-ink" cx="${f(gx)}" cy="${f(cy)}" r="${f(R)}"/>${grooves}<circle class="k-a2" cx="${f(cx + R * 0.15)}" cy="${f(cy)}" r="${f(R * 0.3)}"/><circle class="k-paper" cx="${f(cx + R * 0.15)}" cy="${f(cy)}" r="${f(R * 0.03)}"/>`;
}

function stage(W, H, r, id) {
  const fl = H * 0.66;
  const beams = [0.2, 0.5, 0.8].map((k) => `<path class="k-beam" d="M${f(W * k)} 0L${f(W * k - W * 0.16)} ${f(fl)}H${f(W * k + W * 0.16)}Z"/>`).join('');
  let crowd = '';
  for (let k = 0; k < 13; k++) { const x = (k + 0.5) * (W / 12) + (r() - 0.5) * 20; const s = H * (0.07 + r() * 0.025); crowd += `<circle class="k-ink" cx="${f(x)}" cy="${f(H - s * 1.9)}" r="${f(s * 0.55)}"/><rect class="k-ink" x="${f(x - s)}" y="${f(H - s * 1.3)}" width="${f(s * 2)}" height="${f(s * 1.4)}" rx="${f(s * 0.7)}"/>`; }
  return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop class="s-ink" offset="0"/><stop class="s-a-d" offset="1"/></linearGradient></defs><rect class="bgr keep" width="${W}" height="${H}" fill="url(#${id}s)"/>${beams}<rect class="k-a2" y="${f(fl)}" width="${W}" height="${f(H * 0.04)}"/><circle class="k-b" cx="${f(W * 0.5)}" cy="${f(fl - H * 0.2)}" r="${f(H * 0.05)}" opacity=".9"/>${crowd}`;
}

function house(W, H, r, id) {
  const u = Math.min(W, H);
  const gw = u * 0.62;
  const x = W / 2 - gw / 2;
  const base = H * 0.78;
  const wh = gw * 0.48;
  const roof = gw * 0.34;
  const win = (wx, wy) => `<rect class="k-b2" x="${f(wx)}" y="${f(wy)}" width="${f(gw * 0.13)}" height="${f(gw * 0.15)}" rx="1"/>`;
  return `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop class="s-b3" offset="0"/><stop class="s-paper" offset="1"/></linearGradient></defs><rect class="bgr keep" width="${W}" height="${H}" fill="url(#${id}s)"/><rect class="k-a3" y="${f(base)}" width="${W}" height="${f(H - base)}"/>
<circle class="k-a2" cx="${f(x - gw * 0.12)}" cy="${f(base - gw * 0.32)}" r="${f(gw * 0.2)}"/><rect class="k-ink2" x="${f(x - gw * 0.13)}" y="${f(base - gw * 0.18)}" width="${f(gw * 0.03)}" height="${f(gw * 0.18)}"/>
<rect class="k-paper" x="${f(x)}" y="${f(base - wh)}" width="${f(gw)}" height="${f(wh)}"/><path class="k-a" d="M${f(x - gw * 0.06)} ${f(base - wh)}L${f(x + gw / 2)} ${f(base - wh - roof)}L${f(x + gw * 1.06)} ${f(base - wh)}Z"/>
${win(x + gw * 0.12, base - wh * 0.78)}${win(x + gw * 0.75, base - wh * 0.78)}<rect class="k-ink" x="${f(x + gw * 0.43)}" y="${f(base - wh * 0.58)}" width="${f(gw * 0.14)}" height="${f(wh * 0.58)}"/>`;
}

function orbit(W, H, r, id) {
  const u = Math.min(W, H);
  const cx = W * (0.4 + r() * 0.2);
  const cy = H * (0.42 + r() * 0.16);
  const R = u * (0.26 + r() * 0.06);
  const rings = [1.35, 1.7, 2.1].map((k) => `<circle class="k-ring" cx="${f(cx)}" cy="${f(cy)}" r="${f(R * k)}"/>`).join('');
  const a = r() * 6.28;
  return `<defs><radialGradient id="${id}o" cx=".32" cy=".28" r=".9"><stop class="s-paper" offset="0"/><stop class="s-b" offset=".35"/><stop class="s-a" offset=".8"/><stop class="s-a-d" offset="1"/></radialGradient></defs><rect class="bgr k-bg" width="${W}" height="${H}"/>${rings}<circle class="keep" fill="url(#${id}o)" cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}"/><circle class="k-a" cx="${f(cx + Math.cos(a) * R * 1.7)}" cy="${f(cy + Math.sin(a) * R * 1.7)}" r="${f(u * 0.025)}"/><circle class="k-ink2" cx="${f(cx + Math.cos(a + 2.4) * R * 2.1)}" cy="${f(cy + Math.sin(a + 2.4) * R * 2.1)}" r="${f(u * 0.014)}"/>`;
}

const DRAW = { landscape, interior, still, bust, figure, scene, device, dish, disc, stage, house, orbit };

/**
 * An SVG composition for an empty image slot.
 * prompt: the suggested photo; key: a stable id (the slot path); ratio: width / height of the slot.
 */
export function placeholderArt(prompt, key, ratio = 4 / 3, kind = '') {
  // a named character keeps one look wherever the same prompt appears (the AI product's hero and demo)
  const seed = hash(/\bcharacter\b/i.test(prompt) ? prompt : key);
  const k = DRAW[kind] ? kind : artKind(prompt, seed);
  const W = 600;
  const H = Math.round(W / Math.max(0.3, Math.min(3.2, ratio || 4 / 3)));
  const id = `a${seed.toString(36)}`;
  return `<svg class="art art-${k}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${DRAW[k](W, H, rng(seed), id, prompt)}</svg>`;
}

// ---------------------------------------------------------------------------------------------
// Line motifs for the manifesto chapters: drawn with one stroke weight, they draw themselves in on scroll.
// ---------------------------------------------------------------------------------------------

export const MOTIFS = { orbit: 'Orbits', wave: 'Waves', horizon: 'Horizon', bloom: 'Bloom', grid: 'Grid', stairs: 'Steps', none: 'None' };
export function motifSvg(kind, key = '') {
  const r = rng(hash(`${kind}:${key}`));
  const p = (d, cls = '') => `<path pathLength="1" ${cls ? `class="${cls}" ` : ''}d="${d}"/>`;
  const c = (x, y, rr, cls = '') => `<circle pathLength="1" ${cls ? `class="${cls}" ` : ''}cx="${f(x)}" cy="${f(y)}" r="${f(rr)}"/>`;
  let body = '';
  if (kind === 'orbit') {
    body = [40, 70, 100, 130].map((rr, i) => `<ellipse pathLength="1" cx="200" cy="120" rx="${rr * 1.3}" ry="${rr * 0.55}" transform="rotate(${-18 + i * 9} 200 120)"/>`).join('') + c(200, 120, 18) + c(200 + 130 * 1.3 * Math.cos(r() * 6), 120 + 50 * Math.sin(r() * 6), 5, 'fill');
  } else if (kind === 'wave') {
    for (let k = 0; k < 6; k++) { let d = `M0 ${120 + (k - 2.5) * 16}`; for (let x = 0; x <= 400; x += 8) d += ` L${x} ${f(120 + (k - 2.5) * 16 + Math.sin(x / 400 * 6.28 * (1.5 + k * 0.3) + k) * (26 - k * 3) * Math.sin(x / 400 * 3.14))}`; body += p(d); }
  } else if (kind === 'horizon') {
    body = `<defs><linearGradient id="hz${hash(key).toString(36)}" x1="0" y1="1" x2="0" y2="0"><stop class="s-a" offset="0"/><stop class="s-b" offset=".55"/><stop class="s-b0" offset="1"/></linearGradient></defs><path class="sun" fill="url(#hz${hash(key).toString(36)})" d="M90 170A110 110 0 0 1 310 170Z"/>` + p('M0 170H400') + [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => p(`M200 170L${f(200 + Math.cos(3.14 + k * 0.39) * 190)} ${f(170 + Math.sin(3.14 + k * 0.39) * 150)}`, 'ray')).join('') + [0, 1, 2].map((k) => p(`M${60 + k * 30} ${190 + k * 14}H${340 - k * 30}`)).join('');
  } else if (kind === 'bloom') {
    for (let k = 0; k < 9; k++) { const a = k / 9 * 6.28; body += `<ellipse pathLength="1" cx="${f(200 + Math.cos(a) * 46)}" cy="${f(120 + Math.sin(a) * 46)}" rx="58" ry="22" transform="rotate(${f(a * 57.3)} ${f(200 + Math.cos(a) * 46)} ${f(120 + Math.sin(a) * 46)})"/>`; }
    body += c(200, 120, 16);
  } else if (kind === 'grid') {
    for (let k = 0; k <= 8; k++) body += p(`M${f(200 + (k - 4) * 24)} 60L${f(200 + (k - 4) * 70)} 220`);
    for (let k = 0; k < 6; k++) { const y = 60 + (k * k) * 6.4; const w = 96 + (y - 60) * 1.15; body += p(`M${f(200 - w)} ${f(y)}H${f(200 + w)}`); }
    body += c(200, 46, 10);
  } else if (kind === 'stairs') {
    let d = 'M40 210';
    for (let k = 0; k < 7; k++) d += ` H${80 + k * 44} V${f(210 - (k + 1) * 24)}`;
    body = p(d) + c(80 + 7 * 44 - 10, 210 - 7 * 24 - 26, 12) + p('M30 214H380');
  }
  if (!body) return '';
  return `<svg class="motif motif-${kind}" viewBox="0 0 400 240" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** The manifesto hero's still frame (the canvas draws over it when motion is allowed). */
export function ambientSvg(key = '') {
  const r = rng(hash(key) || 7);
  let lines = '';
  for (let k = 0; k < 22; k++) {
    const y0 = 380 + (k - 11) * 22;
    const ph = r() * 1.2;
    let d = `M-20 ${y0}`;
    for (let x = -20; x <= 1480; x += 40) {
      const e = Math.exp(-(((x - 720) / 420) ** 2));
      d += ` L${x} ${f(y0 - e * (90 + k * 5) * Math.sin(k * 0.35 + x / 260 + ph) * 0.9 - e * 40)}`;
    }
    lines += `<path d="${d}"/>`;
  }
  return `<svg class="amb" viewBox="0 0 1440 760" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs><radialGradient id="amb-g" cx=".5" cy=".62" r=".5"><stop class="s-a" offset="0" style="stop-opacity:.55"/><stop class="s-b" offset=".45" style="stop-opacity:.25"/><stop class="s-b0" offset="1"/></radialGradient></defs><ellipse class="glow" cx="720" cy="470" rx="620" ry="300" fill="url(#amb-g)"/>${lines}</svg>`;
}
