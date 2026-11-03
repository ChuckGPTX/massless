// The preset factory's spec format. One JSON file per preset (public/presets/specs/<id>.json) describes what the
// visitor adds, which engine renders it, what comes out and what it costs. validateSpec() is used by the page
// (a bad spec never renders) and by tests/presets.test.js (a bad spec never merges). Pure: no DOM, runs in Node.

export const ENGINES = {
  composite: { ops: ['plate', 'place', 'shadow', 'reflect', 'colorMatch', 'text', 'warp', 'grade', 'grain'], kind: 'image' },
  'flux.generate': { ops: ['generate'], kind: 'image', userTriggeredOnly: true },
  'ib.camera': { ops: ['depthFromMatte', 'orbit', 'turntable', 'floor', 'text', 'grade'], kind: 'video' },
  'ib.earth': { ops: ['pullBack', 'globe', 'clouds', 'label', 'grade'], kind: 'video' },
  'ib.warp': { ops: ['layers', 'meshWarp', 'shadow', 'grade'], kind: 'video' },
  'ib.particles': { ops: ['layers', 'emit', 'occlude', 'grade'], kind: 'video' },
  'ib.vanish': { ops: ['layers', 'shatter', 'emit', 'smoke', 'flash', 'grade'], kind: 'video' },
  'ib.transition': { ops: ['hold', 'transition', 'grade'], kind: 'video' },
  'layout.kinetic': { ops: ['layout', 'text', 'animate'], kind: 'image' },
  'ib.presenter': { ops: ['script', 'voice', 'presenter', 'captions', 'layout'], kind: 'video' },
};
export const CATEGORIES = { ads: 'Ads & products', effects: 'Effects', social: 'Social' };
export const INPUT_TYPES = ['image', 'media', 'text', 'textarea', 'choice', 'color', 'toggle'];
export const PREPS = ['removeBackground', 'trim', 'layers'];
export const COST_TIERS = ['free', 'daily-free'];
export const OUTPUT_TYPES = ['image', 'video'];
export const STATUSES = ['published', 'draft'];

/** Words that must never appear in a spec or its sample copy: real brands, celebrities, real currency. */
export const DENY = [
  'nike', 'adidas', 'apple', 'iphone', 'samsung', 'coca-cola', 'coke', 'pepsi', 'gucci', 'chanel', 'dior', 'prada', 'louis vuitton', 'rolex',
  'starbucks', "mcdonald's", 'mcdonalds', 'disney', 'marvel', 'pixar', 'ghibli', 'barbie', 'lego', 'tesla', 'amazon', 'google', 'youtube premium',
  'tiktok', 'instagram', 'netflix', 'red bull', 'sephora', 'ikea', 'taylor swift', 'beyonce', 'elon musk', 'kardashian', 'mrbeast', 'drake',
  'us dollar', 'dollar bill', 'euro note', 'banknote replica', 'federal reserve', 'higgsfield', 'kling', 'pika', 'runway', 'flux', 'gpu', 'model',
];
// "model", "flux" and "gpu" stay out of customer copy (title, summary, labels, hints); see denyHits.
const COPY_ONLY = new Set(['flux', 'gpu', 'model', 'kling', 'pika', 'runway', 'higgsfield']);

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const parseSize = (s) => {
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(String(s));
  return m ? [Number(m[1]), Number(m[2])] : null;
};

/** Every string in the visible copy of a spec (what visitors read). */
export function copyStrings(spec) {
  const out = [spec.title, spec.summary, spec.description];
  for (const i of spec.inputs || []) {
    out.push(i.label, i.hint, i.placeholder, typeof i.default === 'string' ? i.default : '');
    for (const o of i.options || []) out.push(o.label, o.hint);
  }
  for (const o of spec.outputs || []) out.push(o.label);
  return out.filter((s) => typeof s === 'string' && s);
}
/** Deny-listed words found in a spec: brands and people anywhere, tech words only in visible copy. */
export function denyHits(spec) {
  const all = JSON.stringify({ ...spec, preview: undefined }).toLowerCase();
  const copy = copyStrings(spec).join(' \n ').toLowerCase();
  const hits = [];
  for (const w of DENY) {
    const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
    if (re.test(COPY_ONLY.has(w) ? copy : all)) hits.push(w);
  }
  return hits;
}

/** Returns a list of problems; an empty list means the spec is valid. */
export function validateSpec(spec) {
  const e = [];
  const need = (cond, msg) => { if (!cond) e.push(msg); };
  if (!spec || typeof spec !== 'object') return ['spec is not an object'];
  need(SLUG.test(spec.id || ''), 'id must be a lowercase slug');
  need(spec.version === 1, 'version must be 1');
  need(typeof spec.title === 'string' && spec.title.length >= 3 && spec.title.length <= 40, 'title: 3 to 40 characters');
  need(typeof spec.summary === 'string' && spec.summary.length >= 8 && spec.summary.length <= 60, 'summary: 8 to 60 characters');
  need(typeof spec.description === 'string' && spec.description.length <= 400, 'description: up to 400 characters');
  need(Object.hasOwn(CATEGORIES, spec.category), `category must be one of ${Object.keys(CATEGORIES)}`);
  need(Array.isArray(spec.tags) && spec.tags.length && spec.tags.every((t) => SLUG.test(t)), 'tags: a list of slugs');
  need(spec.badge == null || ['new', 'trending'].includes(spec.badge), 'badge: new, trending or none');
  const eng = ENGINES[spec.engine];
  need(!!eng, `engine must be one of ${Object.keys(ENGINES)}`);
  // inputs
  const keys = new Set();
  need(Array.isArray(spec.inputs) && spec.inputs.length > 0, 'inputs: at least one');
  for (const i of spec.inputs || []) {
    need(/^[a-z][a-zA-Z0-9]{0,23}$/.test(i.key || '') && !keys.has(i.key), `input key ${i.key} must be a unique camelCase name`);
    keys.add(i.key);
    need(INPUT_TYPES.includes(i.type), `input ${i.key}: type must be one of ${INPUT_TYPES}`);
    need(typeof i.label === 'string' && i.label.length <= 40, `input ${i.key}: label up to 40 characters`);
    for (const p of i.prep || []) need(PREPS.includes(p), `input ${i.key}: unknown prep ${p}`);
    if (i.type === 'image' || i.type === 'media') {
      need(Array.isArray(i.samples) && i.samples.length >= 1, `input ${i.key}: at least one sample`);
      for (const s of i.samples || []) need(typeof s.src === 'string' && s.src.startsWith('/') && typeof s.label === 'string', `input ${i.key}: samples are { src: "/…", label }`);
    }
    if (i.type === 'choice') {
      need(Array.isArray(i.options) && i.options.length >= 2, `input ${i.key}: at least two options`);
      const ids = (i.options || []).map((o) => o.id);
      need(new Set(ids).size === ids.length && ids.every((x) => SLUG.test(x || '')), `input ${i.key}: option ids are unique slugs`);
      need(ids.includes(i.default), `input ${i.key}: default must be an option`);
    }
    if (i.type === 'text' || i.type === 'textarea') need(Number.isInteger(i.max) && i.max > 0 && i.max <= 2000 && (i.default ?? '').length <= i.max, `input ${i.key}: max length and a default that fits`);
    if (i.type === 'color') need(/^#[0-9a-f]{6}$/i.test(i.default || ''), `input ${i.key}: default colour #rrggbb`);
    if (i.type === 'toggle') need(typeof i.default === 'boolean', `input ${i.key}: default true or false`);
  }
  // steps
  need(Array.isArray(spec.steps) && spec.steps.length > 0, 'steps: at least one');
  for (const s of spec.steps || []) need(eng && eng.ops.includes(s.op), `step ${s.op} is not an operation of ${spec.engine}`);
  // outputs
  need(Array.isArray(spec.outputs) && spec.outputs.length > 0, 'outputs: at least one');
  for (const o of spec.outputs || []) {
    need(OUTPUT_TYPES.includes(o.type), `output type must be one of ${OUTPUT_TYPES}`);
    need(Array.isArray(o.sizes) && o.sizes.length && o.sizes.every((s) => { const p = parseSize(s); return p && p[0] >= 256 && p[1] >= 256 && p[0] <= 2160 && p[1] <= 2160; }), 'output sizes like "1080x1350", 256 to 2160 px');
    if (o.type === 'video') need(o.duration > 0 && o.duration <= 20 && [24, 30].includes(o.fps), 'video outputs need duration (s, up to 20) and fps 24 or 30');
  }
  if (spec.animate) need(typeof spec.animate.move === 'string' && spec.animate.duration > 0 && spec.animate.duration <= 10, 'animate: { move, duration up to 10 s }');
  // cost and safety
  need(spec.cost && COST_TIERS.includes(spec.cost.tier) && typeof spec.cost.estimateUSD === 'number' && spec.cost.estimateUSD >= 0 && spec.cost.estimateUSD < 0.05, 'cost: { tier, estimateUSD under $0.05 }');
  if (spec.engine === 'flux.generate' || (spec.steps || []).some((s) => s.op === 'generate')) need(spec.cost?.tier === 'daily-free', 'generation steps must be on the daily-free tier');
  const sf = spec.safety || {};
  need(['none', 'self-or-permission'].includes(sf.faces), 'safety.faces: none or self-or-permission');
  need(sf.realPeopleInSamples === false, 'safety.realPeopleInSamples must be false');
  need(['block'].includes(sf.minors), 'safety.minors must be block');
  need(sf.ipCheck === true, 'safety.ipCheck must be true');
  need(typeof sf.disclosure === 'string', 'safety.disclosure: a short label or ""');
  // preview
  const pv = spec.preview || {};
  need(/^\/media\/presets\/[a-z0-9-]+\.mp4$/.test(pv.video || ''), 'preview.video: /media/presets/<id>.mp4');
  need(/^\/media\/presets\/[a-z0-9-]+\.webp$/.test(pv.poster || ''), 'preview.poster: /media/presets/<id>.webp');
  need(/^\d+\/\d+$/.test(pv.ar || ''), 'preview.ar like "4/5"');
  need(spec.author === 'chucksi' && spec.license === 'MIT' && STATUSES.includes(spec.status), 'author, license MIT and status');
  for (const w of denyHits(spec)) e.push(`deny-listed word: ${w}`);
  return e;
}

/** Default parameter values for a spec. */
export function defaults(spec) {
  const p = {};
  for (const i of spec.inputs) if (!['image', 'media'].includes(i.type)) p[i.key] = i.default;
  return p;
}
/** Output files a run produces: [{ type, w, h, label, name }]. */
export function outputList(spec) {
  const list = [];
  for (const o of spec.outputs) for (const s of o.sizes) {
    const [w, h] = parseSize(s);
    list.push({ type: o.type, w, h, label: o.label || '', size: s, duration: o.duration, fps: o.fps, name: `${spec.id}-${w}x${h}.${o.type === 'video' ? 'mp4' : 'png'}` });
  }
  return list;
}
