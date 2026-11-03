// Edit with words: the rules the page and the Worker share (no DOM, no network).
// The page shrinks every picture before sending it, the Worker checks the same limits again.

/** Every input picture must be smaller than 512 x 512, so the page fits the long side in 511 px. */
export const INPUT_MAX = 511;
/** Bytes per input picture after shrinking (a 511 px JPEG is far below this). */
export const INPUT_BYTES = 1024 * 1024;
/** The picture being edited plus up to three references. */
export const MAX_IMAGES = 4;
export const MAX_INSTRUCTION = 1000;
/** Output sizes. "match" keeps the first picture's shape with a 1024 px long side. */
export const EDIT_SIZES = {
  match: { label: 'Match original' },
  square: { label: 'Square', w: 1024, h: 1024 },
  portrait: { label: 'Portrait', w: 816, h: 1024 },
  landscape: { label: 'Landscape', w: 1024, h: 576 },
};

const r16 = (v) => Math.max(256, Math.min(1024, Math.round(v / 16) * 16));

/** Output width and height for a size choice; w and h are the first picture's size (for "match"). */
export function editSize(kind, w, h) {
  const fixed = EDIT_SIZES[kind];
  if (fixed && fixed.w) return { w: fixed.w, h: fixed.h };
  const ratio = w > 0 && h > 0 ? Math.min(4, Math.max(0.25, w / h)) : 1;
  return ratio >= 1 ? { w: 1024, h: r16(1024 / ratio) } : { w: r16(1024 * ratio), h: 1024 };
}

/** Size that fits inside max on the long side, keeping the aspect ratio. */
export function fitInside(w, h, max = INPUT_MAX) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.floor(w * s)), h: Math.max(1, Math.floor(h * s)) };
}

// Obvious requests to undress or sexualize anyone, and edits aimed at children, are refused before any
// picture leaves the page, and again by the Worker. This is a word check, so it is a floor, not a filter.
const CLOTHES = '(?:clothes|clothing|outfit|shirt|t-?shirt|blouse|dress|skirt|bra|underwear|panties|pants|trousers|jeans|shorts|bikini|swimsuit|swimwear|robe|garments?)';
const SEXUAL = [
  /\b(?:un-?dress(?:ed|ing)?|un-?cloth(?:e|ed|ing)|de-?cloth(?:e|ed|ing)?|disrobe[ds]?)\b/,
  /\b(?:naked|nude|nudes|nudity|topless|bottomless|nsfw|porn\w*|xxx|hentai|erotic\w*|sexy|sexual\w*|sexualis\w*|sexualiz\w*|seductive\w*|lewd|lingerie|fetish\w*|strip-?tease|onlyfans)\b/,
  /\b(?:breasts?|boobs?|nipples?|genitals?|genitalia|penis|vagina|butt-?cheeks|crotch|cleavage)\b/,
  new RegExp(`\\b(?:remove|take\\s+off|take\\s+away|strip(?:\\s+off)?|erase|delete|lose|no|without|less|fewer)\\s+(?:all\\s+|of\\s+)?(?:(?:her|his|their|the|my|its|your|this|that|these|those)\\s+)?(?:\\w+\\s+)?${CLOTHES}\\b`),
  new RegExp(`\\bstrip\\s+(?:her|him|them|the\\s+(?:woman|man|girl|boy|person|people))\\b`),
  new RegExp(`\\b(?:see-?through|transparent|sheer|wet|tight(?:er)?|skimpy|revealing|tiny|smaller|shorter)\\s+(?:\\w+\\s+)?${CLOTHES}\\b`),
  /\b(?:in|into|wearing)\s+(?:a\s+|her\s+|his\s+|their\s+)?(?:bikini|lingerie|underwear|bra|panties|thong)\b/,
  /\b(?:bigger|larger|enlarge\w*|increase\w*)\s+(?:her\s+|his\s+|the\s+)?(?:breasts?|boobs?|chest|butt|bum|hips)\b/,
];
const MINOR = [
  /\b(?:child|children|childs?|kids?|kiddos?|minors?|under-?age|under\s+18|teen|teens|teenager\w*|tween\w*|pre-?teen\w*|adolescent\w*|toddler\w*|bab(?:y(?!\s*(?:blue|pink|grand|breath|spinach|carrots?|leaves|shower))|ies)|infants?|newborns?|school-?(?:girl|boy|kid)s?|loli\w*|shota\w*|juvenile\w*|youngsters?)\b/,
  /\b(?:little|young|small)\s+(?:girl|boy|girls|boys|daughter|son|sister|brother)s?\b/,
  /\b(?:girl|boy)s?\s+(?:aged|age)\s+\d/,
];

/** A plain-language refusal for instructions this tool will not run, or '' when it may run. */
export function editRefusal(text) {
  const t = String(text || '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ');
  for (const m of t.matchAll(/\b(\d{1,2})(?:\s*-?\s*(?:years?|yrs?)[\s-]*old|\s*y\/?o)\b/g)) {
    if (Number(m[1]) < 18) return "This tool doesn't edit pictures of children. Try a different picture or instruction.";
  }
  if (MINOR.some((re) => re.test(t))) return "This tool doesn't edit pictures of children. Try a different picture or instruction.";
  if (SEXUAL.some((re) => re.test(t))) return "This tool won't undress anyone or make sexual edits. Try a different instruction.";
  return '';
}
