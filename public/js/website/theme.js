// Website themes: a curated Google Fonts set, palettes with light and dark neutrals, and a handful of
// strong styles (type pairing, palette, radius, spacing, motion). tokens() turns a theme into CSS custom
// properties for four section tones and nudges colours until every text pair passes WCAG AA.

/** Curated Google Fonts. w = available weight range, dw = default display weight, ital = has italics. */
export const FONTS = {
  'Fraunces': { cat: 'serif', w: [100, 900], dw: 500, ital: true, fb: "Georgia, 'Times New Roman', serif" },
  'Instrument Serif': { cat: 'serif', w: [400, 400], dw: 400, ital: true, fb: "Georgia, 'Times New Roman', serif" },
  'Cormorant Garamond': { cat: 'serif', w: [300, 700], dw: 500, ital: true, fb: "Garamond, Georgia, serif" },
  'Playfair Display': { cat: 'serif', w: [400, 900], dw: 600, ital: true, fb: "Georgia, serif" },
  'DM Serif Display': { cat: 'serif', w: [400, 400], dw: 400, ital: true, fb: "Georgia, serif" },
  'Source Serif 4': { cat: 'serif', w: [200, 900], dw: 600, ital: true, fb: "Georgia, serif" },
  'Inter Tight': { cat: 'sans', w: [100, 900], dw: 600, fb: "'Helvetica Neue', Arial, sans-serif" },
  'Plus Jakarta Sans': { cat: 'sans', w: [200, 800], dw: 800, fb: "system-ui, 'Segoe UI', sans-serif" },
  'Archivo': { cat: 'sans', w: [100, 900], dw: 900, fb: "'Arial Black', Arial, sans-serif" },
  'Sora': { cat: 'sans', w: [100, 800], dw: 600, fb: "system-ui, sans-serif" },
  'Space Grotesk': { cat: 'sans', w: [300, 700], dw: 700, fb: "system-ui, sans-serif" },
  'Bricolage Grotesque': { cat: 'sans', w: [200, 800], dw: 700, fb: "system-ui, sans-serif" },
  'Syne': { cat: 'sans', w: [400, 800], dw: 700, fb: "system-ui, sans-serif" },
  'Outfit': { cat: 'sans', w: [100, 900], dw: 600, fb: "system-ui, sans-serif" },
  'Inter': { cat: 'sans', w: [100, 900], dw: 600, fb: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  'DM Sans': { cat: 'sans', w: [100, 1000], dw: 600, fb: "system-ui, sans-serif" },
  'Manrope': { cat: 'sans', w: [200, 800], dw: 700, fb: "system-ui, sans-serif" },
  'Instrument Sans': { cat: 'sans', w: [400, 700], dw: 600, fb: "system-ui, sans-serif" },
  'Work Sans': { cat: 'sans', w: [100, 900], dw: 600, fb: "system-ui, sans-serif" },
  'IBM Plex Sans': { cat: 'sans', w: [100, 700], dw: 600, fb: "system-ui, sans-serif" },
  // Archivo's width axis at 125: the wide, flat caps of a fashion label (same OFL family as Archivo)
  'Archivo Expanded': { cat: 'sans', w: [100, 900], dw: 800, fam: 'Archivo', wdth: 125, fb: "'Arial Black', Arial, sans-serif" },
  'Hanken Grotesk': { cat: 'sans', w: [100, 900], dw: 400, fb: "'Helvetica Neue', Arial, sans-serif" },
  'Geist': { cat: 'sans', w: [100, 900], dw: 600, fb: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
};
/** The real Google Fonts family behind a font name ('Archivo Expanded' is Archivo at width 125). */
export const fontFamily = (name) => (FONTS[name] && FONTS[name].fam) || name;
export const HEADING_FONTS = ['Fraunces', 'Instrument Serif', 'Cormorant Garamond', 'Playfair Display', 'DM Serif Display', 'Source Serif 4', 'Inter Tight', 'Plus Jakarta Sans', 'Archivo', 'Archivo Expanded', 'Sora', 'Space Grotesk', 'Bricolage Grotesque', 'Syne', 'Outfit', 'Manrope', 'Hanken Grotesk', 'Geist'];
export const BODY_FONTS = ['Inter', 'DM Sans', 'Manrope', 'Plus Jakarta Sans', 'Instrument Sans', 'Work Sans', 'IBM Plex Sans', 'Archivo', 'Outfit', 'Source Serif 4', 'Hanken Grotesk', 'Geist'];

/** Neutrals for light and dark, plus a default accent and a second colour for gradients. */
export const PALETTES = {
  paper: { name: 'Paper', accent: '#c2410c', accent2: '#e9a23b',
    light: { bg: '#f6f1e7', surface: '#fffaf2', alt: '#efe7d8', text: '#1f1a14', muted: '#5f564a' },
    dark: { bg: '#15120e', surface: '#1e1a15', alt: '#1a1612', text: '#f3ece0', muted: '#b4aa9b' } },
  snow: { name: 'Snow', accent: '#2f54eb', accent2: '#7c9cff',
    light: { bg: '#ffffff', surface: '#f4f5f7', alt: '#f4f5f7', text: '#0b0d12', muted: '#565d6b' },
    dark: { bg: '#0a0c10', surface: '#13161d', alt: '#0f1217', text: '#f2f4f8', muted: '#9ba3b3' } },
  meadow: { name: 'Meadow', accent: '#2e7d4f', accent2: '#a3d977',
    light: { bg: '#f5f8f2', surface: '#ffffff', alt: '#e9f0e3', text: '#13251a', muted: '#4d6152' },
    dark: { bg: '#0e1811', surface: '#152219', alt: '#111d15', text: '#edf5ee', muted: '#a2b7a8' } },
  noir: { name: 'Noir', accent: '#c9a45c', accent2: '#8a6d3b',
    light: { bg: '#f4f1eb', surface: '#ffffff', alt: '#ebe6dc', text: '#141311', muted: '#5d5850' },
    dark: { bg: '#0c0b0a', surface: '#161513', alt: '#12110f', text: '#f2ece2', muted: '#aaa196' } },
  pop: { name: 'Pop', accent: '#ff4a1c', accent2: '#ffd23f',
    light: { bg: '#fff6e5', surface: '#ffffff', alt: '#ffeccc', text: '#111111', muted: '#4b4740' },
    dark: { bg: '#111111', surface: '#1b1b1b', alt: '#161616', text: '#fff6e5', muted: '#c2bcae' } },
  aurora: { name: 'Aurora', accent: '#7c5cff', accent2: '#22d3ee',
    light: { bg: '#f7f7fc', surface: '#ffffff', alt: '#eeeef9', text: '#0d0c1f', muted: '#575772' },
    dark: { bg: '#08081a', surface: '#11112a', alt: '#0c0c22', text: '#eeeefe', muted: '#a3a3c4' } },
  stone: { name: 'Stone', accent: '#3b3a36', accent2: '#c8b8a2',
    light: { bg: '#f2f0ec', surface: '#fbfaf8', alt: '#e8e5df', text: '#191816', muted: '#5c5a55' },
    dark: { bg: '#121211', surface: '#1b1a19', alt: '#161615', text: '#efede9', muted: '#a9a69f' } },
  blush: { name: 'Blush', accent: '#c8385e', accent2: '#f2a7b8',
    light: { bg: '#fbf3f1', surface: '#ffffff', alt: '#f5e6e2', text: '#2a1619', muted: '#6a5054' },
    dark: { bg: '#170d0f', surface: '#221417', alt: '#1c1013', text: '#f8eced', muted: '#c0a5a9' } },
  ocean: { name: 'Ocean', accent: '#0e7490', accent2: '#5eead4',
    light: { bg: '#f2f7f8', surface: '#ffffff', alt: '#e3eef1', text: '#0b1d24', muted: '#4b6169' },
    dark: { bg: '#071419', surface: '#0d1e25', alt: '#0a191f', text: '#e9f5f7', muted: '#98b3ba' } },
  lilac: { name: 'Lilac', accent: '#6d4aff', accent2: '#ffb38a',
    light: { bg: '#f6f4fb', surface: '#ffffff', alt: '#ece8f7', text: '#17142a', muted: '#5a5670' },
    dark: { bg: '#100e1c', surface: '#191628', alt: '#141221', text: '#f1effa', muted: '#aaa5c2' } },
  chalk: { name: 'Chalk', accent: '#111111', accent2: '#b9b2a6',
    light: { bg: '#f3f3f1', surface: '#ffffff', alt: '#e9e8e4', text: '#0b0b0b', muted: '#62625e' },
    dark: { bg: '#0b0b0b', surface: '#161616', alt: '#111111', text: '#f3f3f1', muted: '#a3a39e' } },
  void: { name: 'Void', accent: '#ff5a1f', accent2: '#8b5cff',
    light: { bg: '#f4f3f1', surface: '#ffffff', alt: '#eae8e4', text: '#0a0a0a', muted: '#5c5a56' },
    dark: { bg: '#000000', surface: '#0d0d0f', alt: '#09090b', text: '#f4f4f2', muted: '#9a9a9f' } },
  gallery: { name: 'Gallery', accent: '#2b59ff', accent2: '#ffb38a',
    light: { bg: '#ffffff', surface: '#f6f6f5', alt: '#f4f4f2', text: '#111111', muted: '#6e6e6e' },
    dark: { bg: '#0e0e0e', surface: '#181818', alt: '#131313', text: '#f2f2f2', muted: '#9b9b9b' } },
  linen: { name: 'Linen', accent: '#0b0b0c', accent2: '#e8c6a4',
    light: { bg: '#f7f6f3', surface: '#ffffff', alt: '#efede8', text: '#0b0b0c', muted: '#67655f' },
    dark: { bg: '#0b0b0c', surface: '#151517', alt: '#111113', text: '#f7f6f3', muted: '#a19e98' } },
};

/** The style chips. Each is a complete look: type pairing, palette, shape, rhythm and motion. */
export const STYLES = {
  editorial: { name: 'Editorial', blurb: 'Serif headlines, warm paper, calm', heading: 'Fraunces', body: 'Inter', hw: 500, palette: 'paper', mode: 'light', radius: 4, spacing: 'airy', motion: 'subtle', tracking: -0.025, lead: 1.04 },
  swiss: { name: 'Swiss', blurb: 'Tight grotesk, white space, sharp grid', heading: 'Inter Tight', body: 'Inter', hw: 600, palette: 'snow', mode: 'light', radius: 10, spacing: 'normal', motion: 'subtle', tracking: -0.045, lead: 1.0 },
  friendly: { name: 'Friendly', blurb: 'Round, warm and easy to trust', heading: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans', hw: 800, palette: 'meadow', mode: 'light', radius: 22, spacing: 'normal', motion: 'lively', tracking: -0.035, lead: 1.05 },
  luxe: { name: 'Luxe', blurb: 'Dark, gold and a fine serif', heading: 'Cormorant Garamond', body: 'Manrope', hw: 500, palette: 'noir', mode: 'dark', radius: 0, spacing: 'airy', motion: 'subtle', tracking: -0.01, lead: 1.02, fixedAccent: true },
  bold: { name: 'Bold', blurb: 'Loud caps, hard edges, big colour', heading: 'Archivo', body: 'Archivo', hw: 900, palette: 'pop', mode: 'light', radius: 0, spacing: 'normal', motion: 'lively', tracking: -0.025, lead: 0.92, upper: true, fixedAccent: true },
  aurora: { name: 'Aurora', blurb: 'Night sky gradients and glass', heading: 'Sora', body: 'Inter', hw: 600, palette: 'aurora', mode: 'dark', radius: 18, spacing: 'normal', motion: 'lively', tracking: -0.04, lead: 1.04, fixedAccent: true },
  studio: { name: 'Studio', blurb: 'Soft serif italics, quiet neutrals', heading: 'Instrument Serif', body: 'Instrument Sans', hw: 400, palette: 'stone', mode: 'light', radius: 14, spacing: 'airy', motion: 'subtle', tracking: -0.02, lead: 1.0 },
  // template styles: each is reverse-engineered from a reference technique (docs/design-notes/website-templates.md)
  'editorial-shop': { name: 'Atelier', blurb: 'Tiny chrome, wide caps, lookbook', heading: 'Archivo Expanded', body: 'Archivo', hw: 800, palette: 'chalk', mode: 'light', radius: 2, spacing: 'normal', motion: 'subtle', tracking: 0, lead: 0.98, upper: true },
  manifesto: { name: 'Manifesto', blurb: 'Black, big statements, ambient lines', heading: 'Inter Tight', body: 'Inter', hw: 300, palette: 'void', mode: 'dark', radius: 6, spacing: 'airy', motion: 'lively', tracking: -0.035, lead: 1.06 },
  'portfolio-timeline': { name: 'Timeline', blurb: 'White, quiet type, work in order', heading: 'Hanken Grotesk', body: 'Hanken Grotesk', hw: 400, palette: 'gallery', mode: 'light', radius: 10, spacing: 'airy', motion: 'subtle', tracking: -0.02, lead: 1.12 },
  'ai-product': { name: 'Product', blurb: 'Warm white, tight type, portrait hero', heading: 'Geist', body: 'Geist', hw: 600, palette: 'linen', mode: 'light', radius: 16, spacing: 'normal', motion: 'lively', tracking: -0.045, lead: 1.0 },
};

export const RADII = { min: 0, max: 28 };
export const SPACING = { compact: 0.72, normal: 1, airy: 1.28 };
export const MOTION = ['none', 'subtle', 'lively'];

/** A complete theme for a style, optionally with a brand accent. */
export function themeFor(styleId, accent) {
  const st = STYLES[styleId] || STYLES.editorial;
  const pal = PALETTES[st.palette];
  return {
    style: STYLES[styleId] ? styleId : 'editorial',
    palette: st.palette,
    mode: st.mode,
    heading: st.heading,
    body: st.body,
    hw: st.hw,
    accent: !st.fixedAccent && isHex(accent) ? accent.toLowerCase() : pal.accent,
    radius: st.radius,
    spacing: st.spacing,
    motion: st.motion,
  };
}

// ---------------------------------------------------------------------------------------------
// Colour math (WCAG 2.1 relative luminance and contrast)
// ---------------------------------------------------------------------------------------------

export const isHex = (h) => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h);
const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
export function luminance(h) {
  const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const A = luminance(a);
  const B = luminance(b);
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
}
export function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return hex(A.map((v, i) => v + (B[i] - v) * t));
}
/** Move fg toward black or white (whichever helps) until it reaches `target` against every bg. */
export function ensure(fg, bgs, target = 4.5) {
  const list = [].concat(bgs);
  const ok = (c) => list.every((b) => contrast(c, b) >= target);
  if (ok(fg)) return fg;
  const avg = list.reduce((s, b) => s + luminance(b), 0) / list.length;
  const poles = avg > 0.18 ? ['#000000', '#ffffff'] : ['#ffffff', '#000000'];
  for (const pole of poles) {
    for (let t = 0.04; t <= 1.0001; t += 0.04) {
      const c = mix(fg, pole, t);
      if (ok(c)) return c;
    }
  }
  return poles[0];
}

const INK_DARK = '#0c0c0e';
/** Button colours: keep the brand colour if white or near-black text reads on it, otherwise nudge it. */
function buttonPair(accent) {
  if (contrast('#ffffff', accent) >= 4.5) return { accent, ink: '#ffffff' };
  if (contrast('#ffffff', accent) >= 3.4) return { accent: ensure(accent, ['#ffffff'], 4.6), ink: '#ffffff' };
  if (contrast(INK_DARK, accent) >= 4.5) return { accent, ink: INK_DARK };
  return { accent: ensure(accent, [INK_DARK], 4.6), ink: INK_DARK };
}

/** Tokens for one tone: background, cards, text, muted text, lines and the accent pair. */
function tone({ bg, surface, text, muted, accent, accent2 }) {
  // a near-black accent on a black band (or near-white on white) becomes the ink colour, so buttons stay visible
  if (contrast(accent, bg) < 1.6) accent = text;
  const soft = mix(bg, accent, 0.13);
  const t = ensure(text, [bg, surface, soft], 7);
  const m = ensure(muted, [bg, surface], 4.6);
  const btn = buttonPair(accent);
  return {
    bg, surface, 'surface-2': mix(surface, t, 0.05), text: t, muted: m,
    line: mix(bg, t, 0.12), 'line-2': mix(bg, t, 0.24),
    accent: btn.accent, 'accent-ink': btn.ink,
    'accent-text': ensure(accent, [bg, surface, soft], 4.6),
    'accent-soft': soft,
    'accent-2': accent2,
  };
}

/** All four tones for a theme. Returned as plain objects so tests can check every pair. */
export function tokens(theme) {
  const pal = PALETTES[theme.palette] || PALETTES.paper;
  const n = pal[theme.mode === 'dark' ? 'dark' : 'light'];
  const accent = isHex(theme.accent) ? theme.accent : pal.accent;
  const accent2 = pal.accent2;
  const base = tone({ ...n, accent, accent2 });
  const alt = tone({ bg: n.alt, surface: n.surface === n.alt ? n.bg : n.surface, text: n.text, muted: n.muted, accent, accent2 });
  // inverse: swap ink and paper for a high-contrast band
  const inv = tone({ bg: n.text, surface: mix(n.text, n.bg, 0.08), text: n.bg, muted: mix(n.bg, n.text, 0.3), accent: theme.mode === 'dark' ? accent : mix(accent, '#ffffff', 0.12), accent2 });
  // accent: the brand colour as the background, its ink as text, buttons inverted
  const ab = base.accent;
  const ai = base['accent-ink'];
  const acc = {
    bg: ab, surface: mix(ab, ai, 0.1), 'surface-2': mix(ab, ai, 0.16), text: ai, muted: ensure(mix(ai, ab, 0.22), [ab, mix(ab, ai, 0.1)], 4.6),
    line: mix(ab, ai, 0.2), 'line-2': mix(ab, ai, 0.34), accent: ai, 'accent-ink': ab, 'accent-text': ai, 'accent-soft': mix(ab, ai, 0.12), 'accent-2': accent2,
  };
  return { base, alt, inv, acc };
}

/** Every text pair a page uses, with its contrast ratio (for the theme panel and the tests). */
export function contrastReport(theme) {
  const tk = tokens(theme);
  const out = [];
  for (const [name, t] of Object.entries(tk)) {
    out.push({ tone: name, pair: 'text / background', ratio: contrast(t.text, t.bg) });
    out.push({ tone: name, pair: 'muted / background', ratio: contrast(t.muted, t.bg) });
    out.push({ tone: name, pair: 'muted / card', ratio: contrast(t.muted, t.surface) });
    out.push({ tone: name, pair: 'link / background', ratio: contrast(t['accent-text'], t.bg) });
    out.push({ tone: name, pair: 'link / tint', ratio: contrast(t['accent-text'], t['accent-soft']) });
    out.push({ tone: name, pair: 'button text / button', ratio: contrast(t['accent-ink'], t.accent) });
  }
  return out;
}

const clampW = (font, w) => { const f = FONTS[font] || FONTS.Inter; return Math.max(f.w[0], Math.min(f.w[1], w)); };
export const headingWeight = (theme) => clampW(theme.heading, theme.hw || FONTS[theme.heading]?.dw || 600);

/** The Google Fonts stylesheet for a theme, with only the weights (and widths) it uses. */
export function fontsHref(theme) {
  const fams = new Map();
  const add = (name, weights, ital) => {
    const f = FONTS[name];
    if (!f) return;
    const fam = f.fam || name;
    const cur = fams.get(fam) || { t: new Set(), ital: false, wdth: false };
    const it = !!(ital && f.ital);
    weights.forEach((w) => cur.t.add(`${clampW(name, w)}|${f.wdth || 100}|0`));
    if (it) weights.forEach((w) => cur.t.add(`${clampW(name, w)}|${f.wdth || 100}|1`));
    cur.ital = cur.ital || it;
    cur.wdth = cur.wdth || !!f.wdth;
    fams.set(fam, cur);
  };
  add(theme.heading, [headingWeight(theme)], true);
  add(theme.body, [400, 500, 600, 700], false);
  const parts = [];
  for (const [fam, { t, ital, wdth }] of fams) {
    const tuples = [...t].map((x) => x.split('|').map(Number)).map(([w, d, i]) => [...(ital ? [i] : []), ...(wdth ? [d] : []), w]);
    tuples.sort((a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k]; return 0; });
    const axes = [ital && 'ital', wdth && 'wdth', 'wght'].filter(Boolean).join(',');
    parts.push(`family=${fam.replace(/ /g, '+')}:${axes}@${[...new Set(tuples.map((x) => x.join(',')))].join(';')}`);
  }
  return `https://fonts.googleapis.com/css2?${parts.join('&')}&display=swap`;
}

export const fontStack = (fam) => `'${fontFamily(fam)}', ${(FONTS[fam] || FONTS.Inter).fb}`;

/** CSS custom properties for the theme (the :root block plus the three tone classes). */
export function themeCss(theme) {
  const st = STYLES[theme.style] || STYLES.editorial;
  const tk = tokens(theme);
  const vars = (t) => Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(';');
  const r = Math.max(RADII.min, Math.min(RADII.max, Number(theme.radius) || 0));
  const sp = SPACING[theme.spacing] || 1;
  const serifHead = FONTS[theme.heading]?.cat === 'serif';
  const root = [
    vars(tk.base),
    `--font-h:${fontStack(theme.heading)}`, `--font-b:${fontStack(theme.body)}`,
    `--hw:${headingWeight(theme)}`, `--ht:${st.tracking ?? -0.02}em`, `--hl:${st.lead ?? 1.05}`, `--hc:${st.upper ? 'uppercase' : 'none'}`,
    `--h-ital:${serifHead ? 'italic' : 'normal'}`, `--h-str:${FONTS[theme.heading]?.wdth || 100}%`,
    `--r:${r}px`, `--r-lg:${Math.min(36, Math.round(r * 1.5))}px`, `--r-sm:${Math.round(r * 0.6)}px`, `--r-btn:${r >= 18 ? '999px' : `${Math.min(r, 12)}px`}`,
    `--sp:${sp}`,
    `color-scheme:${theme.mode === 'dark' ? 'dark' : 'light'}`,
  ].join(';');
  return `:root{${root}}\n.t-alt{${vars(tk.alt)}}\n.t-inv{${vars(tk.inv)}}\n.t-acc{${vars(tk.acc)}}`;
}
