// The preset catalog: every one-tap preset as a spec (see spec.js). Packs build many specs from small tables
// (scenes x sizes, rain kinds, transition styles, social layouts), which is how the catalog grows without new code.
// Each spec opens at /workflows?preset=<id>, renders on the visitor's device, and has a preview loop rendered from
// the same engine by tools/presets/render-previews.cjs.

import { validateSpec } from './spec.js';

const FEED = '1080x1350', STORY = '1080x1920', LINK = '1200x628', SQUARE = '1080x1080', WIDE = '1280x720', HD = '1920x1080';
const SAFE = { faces: 'none', realPeopleInSamples: false, minors: 'block', ipCheck: true, disclosure: '' };
const FREE = { tier: 'free', estimateUSD: 0 };

const spec = (o) => ({
  version: 1, author: 'chucksi', license: 'MIT', status: 'published', cost: FREE, safety: SAFE, badge: 'new',
  ...o,
  preview: { video: `/media/presets/${o.id}.mp4`, poster: `/media/presets/${o.id}.webp`, ar: '4/5', ...(o.preview || {}) },
});

// ---------- sample inputs ----------
const BRAND = { serum: ['Glow Serum', 'Daily radiance, bottled'], sneaker: ['Stride One', 'Light on every mile'], headphones: ['Hush Studio', 'Sound, without the noise'], can: ['Fizz & Co', 'Bright, cold, citrus'], candle: ['Ember Hour', 'Amber, cedar and slow evenings'], mug: ['Kiln Mug', 'Handmade for slow mornings'], perfume: ['Rosé No. 7', 'Soft petals, long days'] };
export const PRODUCTS = [
  ['serum', 'Serum'], ['sneaker', 'Sneaker'], ['headphones', 'Headphones'], ['can', 'Drink can'],
  ['candle', 'Candle'], ['mug', 'Mug'], ['perfume', 'Perfume'],
].map(([id, label]) => ({ id, label, src: `/presets/samples/${id}.webp` }));
const productInput = (first = 'serum', label = 'Your product', withBrand = false) => ({
  key: 'product', type: 'image', label, prep: ['removeBackground'],
  hint: 'A product photo on a plain background works best. Transparent PNGs are used as they are.',
  samples: [PRODUCTS.find((p) => p.id === first), ...PRODUCTS.filter((p) => p.id !== first)].map(({ id, src, label: l }) => ({ src, label: l, ...(withBrand ? { params: { brand: BRAND[id][0], tagline: BRAND[id][1] } } : {}) })),
});
const PHOTOS = {
  astronaut: 'Wheat field', dancer: 'Theater leap', summit: 'Above the clouds', lighthouse: 'Storm lighthouse', canyon: 'Canyon road',
  train: 'Desert station', fisherman: 'Dawn nets', rider: 'Desert rider', jellyfish: 'Jellyfish drift', diner: 'Night diner', neon: 'Red raincoat',
};
const photo = (key) => ({ src: `/media/art/${key}.jpg`, label: PHOTOS[key], matte: `/presets/samples/matte-${key}.webp` });
const shot = (id, label) => ({ src: `/presets/samples/shot-${id}.webp`, label, matte: `/presets/samples/shot-${id}-matte.webp` });

// ---------- 1. Product scenes ----------
// Plates are photographs made for this pack (see public/presets/plates/provenance.json). Each orientation records
// where a product stands: a = base centre (fractions of the plate), box = the largest product size (w of plate
// width, h of plate height), dir = cast-shadow direction (radians; 0 right, +PI/2 straight back), cast/contact
// strengths, reflect = mirror strength for glossy floors, ink = text colour over the open space at the top.
export const SCENES = [
  ['marble-podium', 'Marble podium', 'Warm stone and soft window light', 'beauty', { a: [0.52, 0.755], box: [0.42, 0.29], dir: 0.35 }, { a: [0.4, 0.63], box: [0.17, 0.42], dir: 0.35 }, { ink: '#3b2f25', font: 'luxe', badge: 'trending' }],
  ['beach-rocks', 'Beach rock', 'A flat stone on a sunny shore', 'outdoor', { a: [0.48, 0.665], box: [0.36, 0.24], dir: -2.3, cast: 0.45, length: 0.9 }, { a: [0.47, 0.56], box: [0.17, 0.38], dir: -2.3, cast: 0.4 }, { ink: '#ffffff', font: 'serif' }],
  ['kitchen-counter', 'Kitchen counter', 'Morning light on white stone', 'home', { a: [0.55, 0.62], box: [0.4, 0.28], dir: 0.3 }, { a: [0.58, 0.72], box: [0.18, 0.44], dir: 0.3 }, { ink: '#2b2b2b', font: 'sans' }],
  ['studio-sweep', 'Studio sweep', 'Peach paper and big soft lights', 'studio', { a: [0.53, 0.73], box: [0.32, 0.26], dir: 1.45, cast: 0.15 }, { a: [0.5, 0.74], box: [0.15, 0.42], dir: 1.45, cast: 0.15 }, { ink: '#4a2a1c', font: 'grotesk', badge: 'trending' }],
  ['botanical-shadows', 'Palm shadows', 'Plaster block in dappled sun', 'beauty', { a: [0.5, 0.61], box: [0.42, 0.26], dir: 0.25, cast: 0.4 }, { a: [0.52, 0.63], box: [0.15, 0.4], dir: 0.25, cast: 0.4 }, { ink: '#3d3226', font: 'serif' }],
  ['water-splash', 'Water ripple', 'A clear disc in shallow water', 'fresh', { a: [0.5, 0.6], box: [0.4, 0.27], dir: 1.4, cast: 0.15, reflect: 0.22 }, { a: [0.5, 0.6], box: [0.2, 0.48], dir: 1.4, cast: 0.15, reflect: 0.2 }, { ink: '#0b4a4a', font: 'round' }],
  ['sand-dune', 'Desert dune', 'Golden hour on a sandstone slab', 'outdoor', { a: [0.55, 0.535], box: [0.4, 0.24], dir: 0.2, cast: 0.45, length: 1.1 }, { a: [0.5, 0.53], box: [0.16, 0.36], dir: 0.2, cast: 0.45, length: 1.1 }, { ink: '#3b2414', font: 'luxe' }],
  ['neon-shelf', 'Neon shelf', 'Glossy black and pink light', 'night', { a: [0.5, 0.665], box: [0.4, 0.26], dir: 1.5, cast: 0.1, reflect: 0.3 }, { a: [0.5, 0.84], box: [0.18, 0.45], dir: 1.5, cast: 0.1, reflect: 0.25 }, { ink: '#ffffff', font: 'display' }],
  ['linen', 'Linen drape', 'Soft folds and calm daylight', 'home', { a: [0.5, 0.42], box: [0.5, 0.26], dir: 1.0, cast: 0.2 }, { a: [0.5, 0.7], box: [0.2, 0.46], dir: 1.0, cast: 0.2 }, { ink: '#4a3f33', font: 'luxe' }],
  ['terrazzo', 'Terrazzo cube', 'Speckled stone in hard sun', 'studio', { a: [0.5, 0.42], box: [0.44, 0.26], dir: 0.1, cast: 0.45 }, { a: [0.47, 0.53], box: [0.17, 0.4], dir: 0.1, cast: 0.45 }, { ink: '#24302a', font: 'bric' }],
  ['pastel-arches', 'Pastel arches', 'Pink steps under a cloud arch', 'dreamy', { a: [0.52, 0.765], box: [0.3, 0.27], dir: 1.3, cast: 0.15 }, { a: [0.5, 0.73], box: [0.12, 0.32], dir: 1.3, cast: 0.15 }, { ink: '#6a2c3a', font: 'serif' }],
  ['concrete-plinth', 'Concrete plinth', 'Raw blocks under a blue sky', 'outdoor', { a: [0.48, 0.71], box: [0.4, 0.28], dir: 0.6, cast: 0.45 }, { a: [0.47, 0.65], box: [0.18, 0.4], dir: 0.6, cast: 0.45 }, { ink: '#1e2a33', font: 'display' }],
  ['black-gloss', 'Black gloss', 'Mirror floor and light strips', 'night', { a: [0.5, 0.7], box: [0.4, 0.32], dir: 1.5, cast: 0.05, reflect: 0.38 }, { a: [0.5, 0.78], box: [0.2, 0.48], dir: 1.5, cast: 0.05, reflect: 0.35 }, { ink: '#ffffff', font: 'luxe' }],
  ['wood-window', 'Oak table', 'Late sun through a window', 'home', { a: [0.5, 0.68], box: [0.42, 0.3], dir: 0.4, cast: 0.4 }, { a: [0.55, 0.68], box: [0.2, 0.42], dir: 0.4, cast: 0.4 }, { ink: '#2e2015', font: 'serif' }],
  ['stone-steps', 'Travertine steps', 'Spa-calm stone and sage', 'beauty', { a: [0.5, 0.47], box: [0.42, 0.26], dir: 1.3, cast: 0.15 }, { a: [0.55, 0.6], box: [0.18, 0.42], dir: 1.3, cast: 0.15 }, { ink: '#2f3328', font: 'luxe' }],
  ['sky-clouds', 'Cloud podium', 'Floating above soft clouds', 'dreamy', { a: [0.51, 0.62], box: [0.48, 0.28], dir: 1.2, cast: 0.12 }, { a: [0.6, 0.66], box: [0.2, 0.42], dir: 1.2, cast: 0.12 }, { ink: '#1f3550', font: 'round' }],
  ['ice-cubes', 'Ice cubes', 'Crisp blue with scattered ice', 'fresh', { a: [0.5, 0.7], box: [0.4, 0.27], dir: 1.4, cast: 0.15, reflect: 0.12 }, { a: [0.5, 0.72], box: [0.2, 0.46], dir: 1.4, cast: 0.15, reflect: 0.12 }, { ink: '#0d2f57', font: 'grotesk' }],
  ['tropical-leaves', 'Tropical leaves', 'Monstera and dappled light', 'outdoor', { a: [0.53, 0.62], box: [0.4, 0.27], dir: 0.5, cast: 0.3 }, { a: [0.48, 0.75], box: [0.2, 0.42], dir: 0.5, cast: 0.3 }, { ink: '#22351f', font: 'serif' }],
  ['pop-blocks', 'Pop blocks', 'Bold colour-block set', 'studio', { a: [0.6, 0.625], box: [0.34, 0.26], dir: 0.3, cast: 0.3 }, { a: [0.47, 0.69], box: [0.16, 0.4], dir: 0.3, cast: 0.3 }, { ink: '#1a2a7a', font: 'bold' }],
  ['bokeh-night', 'Velvet bokeh', 'Festive lights and red velvet', 'night', { a: [0.5, 0.67], box: [0.46, 0.32], dir: 1.5, cast: 0.1 }, { a: [0.5, 0.7], box: [0.22, 0.44], dir: 1.5, cast: 0.1 }, { ink: '#fff3d6', font: 'luxe' }],
].map(([id, title, line, group, p, l, extra]) => ({ id, title, line, group, p: { cast: 0.3, length: 0.6, reflect: 0, ...p }, l: { cast: 0.3, length: 0.6, reflect: 0, ...l }, ...extra }));
const SCENE_FIRST = { 'marble-podium': 'serum', 'beach-rocks': 'sneaker', 'kitchen-counter': 'mug', 'studio-sweep': 'headphones', 'botanical-shadows': 'perfume', 'water-splash': 'can', 'sand-dune': 'perfume', 'neon-shelf': 'can', linen: 'candle', terrazzo: 'mug', 'pastel-arches': 'perfume', 'concrete-plinth': 'sneaker', 'black-gloss': 'headphones', 'wood-window': 'candle', 'stone-steps': 'serum', 'sky-clouds': 'headphones', 'ice-cubes': 'can', 'tropical-leaves': 'serum', 'pop-blocks': 'sneaker', 'bokeh-night': 'candle' };
const sceneSpecs = SCENES.map((s) => spec({
  id: `scene-${s.id}`, title: s.title, summary: `Your product, ${s.line.charAt(0).toLowerCase() + s.line.slice(1)}`,
  description: 'Add a product photo. The background comes off, the product stands in the scene with a matching shadow and light, and you can add your brand name.',
  category: 'ads', tags: ['product', 'scene', s.group], badge: s.badge || 'new', engine: 'scene',
  steps: [{ op: 'cutout' }, { op: 'plate', scene: s.id }, { op: 'place' }, { op: 'shadow' }, { op: 'colorMatch' }, { op: 'text' }],
  inputs: [
    productInput(SCENE_FIRST[s.id], 'Your product', true),
    { key: 'brand', type: 'text', label: 'Brand or product name', max: 28, default: BRAND[SCENE_FIRST[s.id]][0], placeholder: 'Leave empty for no text' },
    { key: 'tagline', type: 'text', label: 'Line under it', max: 44, default: BRAND[SCENE_FIRST[s.id]][1] },
    { key: 'size', type: 'range', label: 'Product size', min: 0.6, max: 1.3, step: 0.01, default: 1 },
  ],
  outputs: [{ type: 'image', sizes: [FEED, STORY, LINK], label: 'Feed, story and link ad' }],
  scene: s,
  preview: { ar: '4/5', loop: 'samples' },
}));

// ---------- 2. Product spin ----------
const spinSpec = spec({
  id: 'product-spin', title: 'Product spin', summary: 'Your product turning on a glossy turntable', badge: 'trending',
  description: 'Your product cut out and turned in 3D on a reflective turntable, with a moving light sweep. Loops cleanly.',
  category: 'ads', tags: ['product', 'video', 'turntable'], engine: 'spin',
  steps: [{ op: 'cutout' }, { op: 'depth' }, { op: 'turntable' }, { op: 'floor' }, { op: 'lightSweep' }, { op: 'text' }],
  inputs: [
    productInput('sneaker'),
    { key: 'backdrop', type: 'choice', label: 'Backdrop', default: 'cream', options: [{ id: 'cream', label: 'Cream' }, { id: 'midnight', label: 'Midnight' }, { id: 'blush', label: 'Blush' }, { id: 'sage', label: 'Sage' }, { id: 'cobalt', label: 'Cobalt' }] },
    { key: 'brand', type: 'text', label: 'Brand or product name', max: 28, default: 'Stride One' },
    { key: 'motion', type: 'choice', label: 'Motion', default: 'turn', options: [{ id: 'turn', label: 'Full turn' }, { id: 'sway', label: 'Gentle sway' }] },
  ],
  outputs: [{ type: 'video', sizes: [FEED, STORY, SQUARE], duration: 5, fps: 30, label: 'Looping clip' }],
  preview: { ar: '4/5' },
});

// ---------- 3. Mockups ----------
// quad = the four corners of the blank surface (fractions of the plate: top-left, top-right, bottom-right, bottom-left).
export const MOCKUPS = [
  ['billboard', 'Billboard', 'Your ad on a highway billboard', '16/9', 'mockup-billboard', [[0.3292, 0.2269], [0.7292, 0.3324], [0.737, 0.588], [0.3266, 0.5407]], 'design-fest-harbourlight'],
  ['box-truck', 'Box truck', 'Your ad on the side of a truck', '16/9', 'mockup-box-truck', [[0.0922, 0.212], [0.7271, 0.2083], [0.7307, 0.7102], [0.0906, 0.7046]], 'design-id-northwind'],
  ['phone', 'Phone in hand', 'Your app or story on a phone', '3/4', 'mockup-phone', [[0.3485, 0.2118], [0.6566, 0.207], [0.67, 0.728], [0.359, 0.7297]], 'site-ai-product'],
  ['street-poster', 'Street poster', 'Your poster pasted on a city wall', '3/4', 'mockup-street-poster', [[0.2519, 0.2194], [0.7111, 0.2146], [0.7269, 0.7139], [0.2639, 0.7083]], 'design-poe-small-maps'],
  ['storefront', 'Storefront window', 'Your campaign in a shop window', '16/9', 'mockup-storefront', [[0.217, 0.294], [0.757, 0.287], [0.757, 0.813], [0.217, 0.77]], 'design-fest-copper-lantern'],
].map(([id, title, summary, ar, plate, quad, sample]) => ({ id, title, summary, ar, plate, quad, sample }));
const DESIGNS = [
  ['/presets/samples/design-launch.webp', 'Launch ad'], ['/presets/samples/design-sale.webp', 'Sale poster'],
  ['/media/make/thumb-festival.webp', 'Festival poster'], ['/media/make/thumb-identity.webp', 'Brand board'], ['/media/make/thumb-map.webp', 'Map poster'],
];
const WIDE_DESIGNS = [['/presets/samples/design-wide-launch.webp', 'Launch banner'], ['/presets/samples/design-wide-sale.webp', 'Sale banner']];
const mockupSpecs = MOCKUPS.map((m, i) => spec({
  id: `mockup-${m.id}`, title: m.title, summary: m.summary, badge: i === 0 ? 'trending' : 'new',
  description: 'Add your design. It is fitted to the surface in perspective and takes on the light, colour and grain of the photo.',
  category: 'ads', tags: ['mockup', 'outdoor', 'ad'], engine: 'mockup',
  steps: [{ op: 'plate', mockup: m.id }, { op: 'warp' }, { op: 'light' }, { op: 'grain' }],
  inputs: [
    { key: 'design', type: 'image', label: 'Your design', hint: 'A poster, ad, screenshot or photo.', samples: (m.id === 'phone' ? [['/presets/samples/design-app.webp', 'App screen'], ...DESIGNS] : m.ar === '16/9' ? [...WIDE_DESIGNS, ...DESIGNS.slice(2)] : DESIGNS).map(([src, label]) => ({ src, label })) },
    { key: 'fit', type: 'choice', label: 'Fit', default: 'cover', options: [{ id: 'cover', label: 'Fill the surface' }, { id: 'contain', label: 'Show all of it' }] },
  ],
  outputs: [{ type: 'image', sizes: [m.ar === '16/9' ? HD : '1080x1440'], label: 'Mockup photo' }, { type: 'video', sizes: [m.ar === '16/9' ? HD : '1080x1440'], duration: 4, fps: 30, label: 'Slow push-in clip' }],
  mockup: m,
  preview: { ar: m.ar, loop: 'samples' },
}));

// ---------- 4. Earth zoom out ----------
const earthSpec = spec({
  id: 'earth-zoom-out', title: 'Earth zoom out', summary: 'Pull back from your photo to the whole planet', badge: 'trending',
  description: 'Starts on your photo and rises through rooftops, the city, the coast and the clouds until the whole Earth hangs in space.',
  category: 'effects', tags: ['viral', 'zoom', 'travel'], engine: 'earth',
  steps: [{ op: 'pullBack' }, { op: 'layers' }, { op: 'clouds' }, { op: 'globe' }, { op: 'label' }],
  inputs: [
    { key: 'photo', type: 'image', label: 'Your photo', hint: 'A place, a moment, a product: anything shot outdoors works well.', samples: ['lighthouse', 'canyon', 'astronaut', 'train', 'rider'].map((k) => ({ src: `/media/art/${k}.jpg`, label: PHOTOS[k] })) },
    { key: 'place', type: 'text', label: 'Place name (optional)', max: 32, default: 'Somewhere on Earth' },
  ],
  outputs: [{ type: 'video', sizes: [STORY, SQUARE], duration: 7, fps: 30, label: 'Vertical and square clips' }],
  preview: { ar: '9/16' },
});

// ---------- 5. Squish, inflate, levitate, poke, melt (object effects) ----------
const WARPS = [
  ['squish', 'Squish it', 'A soft press squashes it, then it springs back', 'trending'],
  ['inflate', 'Inflate', 'Your product puffs up like a balloon'],
  ['levitate', 'Levitate', 'It lifts off and floats in mid-air'],
  ['poke', 'Poke', 'A poke sends a jelly wobble through it'],
  ['melt', 'Melt down', 'It melts into a glossy puddle'],
];
const warpSpecs = WARPS.map(([id, title, summary, badge], i) => spec({
  id, title, summary, badge: badge || 'new',
  description: 'Add a product photo. It is cut out and brought to life with a soft-body effect, over a studio backdrop or its own photo.',
  category: 'effects', tags: ['viral', 'product', 'physics'], engine: 'warp',
  steps: [{ op: 'cutout' }, { op: 'cleanPlate' }, { op: 'meshWarp', effect: id }, { op: 'shadow' }],
  inputs: [
    productInput(['can', 'perfume', 'headphones', 'sneaker', 'candle'][i]),
    { key: 'backdrop', type: 'choice', label: 'Backdrop', default: ['pop-blocks', 'sky-clouds', 'pastel-arches', 'studio-sweep', 'sand-dune'][i], options: [
      { id: 'studio-sweep', label: 'Studio' }, { id: 'pop-blocks', label: 'Pop' }, { id: 'pastel-arches', label: 'Pastel' }, { id: 'sky-clouds', label: 'Clouds' }, { id: 'sand-dune', label: 'Desert' }, { id: 'own', label: 'My photo' },
    ] },
  ],
  outputs: [{ type: 'video', sizes: [FEED, STORY, SQUARE], duration: 5, fps: 30, label: 'Clip' }],
  effect: id,
  preview: { ar: '4/5' },
}));

// ---------- 6. Rains ----------
const RAINS = [
  ['money-rain', 'Money rain', 'Bills and coins pour down around you', 'money', 'trending', [photo('astronaut'), shot('sneaker-pop', 'Sneaker'), photo('dancer')]],
  ['confetti-rain', 'Confetti burst', 'Party confetti falls in front and behind', 'confetti', 'new', [shot('serum-marble', 'Serum'), photo('summit'), photo('dancer')]],
  ['petal-rain', 'Petal fall', 'Soft petals drift across the frame', 'petals', 'new', [shot('perfume-arches', 'Perfume'), photo('fisherman'), photo('astronaut')]],
  ['snowfall', 'Snowfall', 'A quiet snow with depth', 'snow', 'new', [photo('lighthouse'), shot('candle-bokeh', 'Candle'), photo('summit')]],
  ['fireworks', 'Fireworks', 'Fireworks burst in the sky behind', 'fireworks', 'new', [photo('lighthouse'), shot('candle-bokeh', 'Candle'), photo('rider')]],
];
const rainSpecs = RAINS.map(([id, title, summary, kind, badge, samples]) => spec({
  id, title, summary, badge,
  description: 'Add a photo. The subject is found, and the particles fall both behind and in front of it for real depth.',
  category: 'effects', tags: ['viral', 'celebration', 'particles'], engine: 'rain',
  steps: [{ op: 'layers' }, { op: 'emit', kind }, { op: 'occlude' }, { op: 'grade' }],
  inputs: [
    { key: 'photo', type: 'image', label: 'Your photo', prep: ['layers'], samples },
    { key: 'amount', type: 'range', label: 'Amount', min: 0.3, max: 1.6, step: 0.01, default: 1 },
    ...(kind === 'fireworks' ? [{ key: 'night', type: 'toggle', label: 'Turn the sky to night', default: true }] : []),
  ],
  outputs: [{ type: 'video', sizes: [FEED, STORY, SQUARE], duration: 5, fps: 30, label: 'Clip' }],
  kind,
  preview: { ar: '4/5' },
}));

// ---------- 7. Transitions ----------
const TRANSITIONS = [
  ['whip-pan', 'Whip pan', 'A fast blurred swipe to the next shot', 'whip', 'trending'],
  ['zoom-punch', 'Zoom punch', 'Punch in through a zoom blur', 'zoom'],
  ['light-leak', 'Light leak', 'A warm film burn between shots', 'leak'],
  ['ink-wipe', 'Ink wipe', 'Ink bleeds the next shot in', 'ink'],
  ['glitch-cut', 'Glitch cut', 'Digital slices tear to the next shot', 'glitch'],
  ['spin-swap', 'Spin swap', 'A spinning blur flips the shot', 'spin'],
  ['iris-reveal', 'Iris reveal', 'A circle opens on the next shot', 'iris'],
  ['liquid-morph', 'Liquid morph', 'One shot ripples into the next', 'liquid'],
];
const transitionSpecs = TRANSITIONS.map(([id, title, summary, style, badge]) => spec({
  id, title, summary, badge: badge || 'new',
  description: 'Add two or three photos. They are cut together with the transition, timed for social video.',
  category: 'effects', tags: ['transition', 'video', 'edit'], engine: 'transition',
  steps: [{ op: 'hold' }, { op: 'transition', style }, { op: 'hold' }],
  inputs: [
    { key: 'a', type: 'image', label: 'First photo', samples: [shot('serum-marble', 'Serum'), photo('canyon'), photo('lighthouse')] },
    { key: 'b', type: 'image', label: 'Second photo', samples: [shot('perfume-arches', 'Perfume'), photo('summit'), photo('train')] },
    { key: 'c', type: 'image', label: 'Third photo (optional)', optional: true, samples: [shot('candle-bokeh', 'Candle'), photo('jellyfish'), photo('diner')] },
    { key: 'pace', type: 'choice', label: 'Pace', default: 'snappy', options: [{ id: 'snappy', label: 'Snappy' }, { id: 'smooth', label: 'Smooth' }] },
  ],
  outputs: [{ type: 'video', sizes: [STORY, SQUARE, HD], duration: 6, fps: 30, label: 'Clip' }],
  style,
  preview: { ar: '9/16' },
}));

// ---------- 8. Social, story and thumbnail templates ----------
const SOCIAL = [
  ['launch', 'New drop', 'Product launch post with a date', 'trending', { image: 'shot-serum-marble', headline: 'New drop', sub: 'Glow Serum, out Friday', cta: 'Shop 10.24' }],
  ['sale', 'Big sale', 'A loud discount post with a sticker', 'new', { image: 'shot-sneaker-pop', headline: '40% off', sub: 'Every pair, this weekend only', cta: 'Shop the sale' }],
  ['quote', 'Quote card', 'A big quote over your photo', 'new', { image: 'art-summit', headline: 'Small steps, every day, add up to summits.', sub: 'Field notes', cta: '' }],
  ['review', 'Five-star review', 'A customer review with stars', 'new', { image: 'shot-candle-bokeh', headline: 'The best candle I have ever owned. My whole flat smells like a cabin.', sub: 'Sam, verified buyer', cta: 'Ember Hour' }],
  ['event', 'Event poster', 'Date, place and title', 'new', { image: 'art-lighthouse', headline: 'Harbour Lights Night Market', sub: 'Pier 4, from 6 pm', cta: 'SAT 14 DEC' }],
  ['tips', 'Three tips', 'A numbered list post', 'new', { image: 'shot-mug-terrazzo', headline: '3 ways to brew better', sub: 'Warm the mug first\nGrind just before\nWait 30 seconds', cta: '@kilnmug' }],
  ['before-after', 'Before and after', 'Two photos side by side', 'new', { image: 'art-canyon', image2: 'art-summit', headline: 'Before / After', sub: 'Same trail, one year later', cta: '' }],
  ['countdown', 'Coming soon', 'A countdown teaser', 'new', { image: 'shot-perfume-arches', headline: 'Coming soon', sub: 'Rosé No. 7', cta: '03 DAYS' }],
  ['stat', 'Big number', 'One giant stat with a caption', 'new', { image: 'shot-headphones-gloss', headline: '40 h', sub: 'of battery on one charge', cta: 'Hush Studio' }],
  ['thumbnail', 'Video thumbnail', 'A bold title for your next video', 'trending', { image: 'art-rider', headline: 'I rode 1,000 miles alone', sub: '', cta: 'NEW' }],
  ['podcast', 'Podcast episode', 'An episode cover with a waveform', 'new', { image: 'art-jellyfish', headline: 'Deep Water Thinking', sub: 'Episode 12 · How slow ideas win', cta: 'Listen now' }],
  ['price-list', 'Price list', 'Three items with prices', 'new', { image: 'shot-can-ice', headline: 'Summer menu', sub: 'Citrus fizz · 4\nBerry spritz · 5\nCold brew tonic · 6', cta: 'Fizz & Co' }],
];
const socialImage = (key) => key.startsWith('art-') ? { src: `/media/art/${key.slice(4)}.jpg`, label: PHOTOS[key.slice(4)] || 'Photo' } : { src: `/presets/samples/${key}.webp`, label: 'Product shot' };
const socialSpecs = SOCIAL.map(([id, title, summary, badge, d]) => spec({
  id: `social-${id}`, title, summary, badge,
  description: 'Edit the words and add your photo. You get post, portrait, story and video-thumbnail sizes, plus an animated story.',
  category: 'social', tags: ['social', 'template', id], engine: 'social',
  steps: [{ op: 'layout', layout: id }, { op: 'text' }, { op: 'animate' }],
  inputs: [
    { key: 'image', type: 'image', label: 'Photo', samples: [socialImage(d.image), socialImage('shot-serum-marble'), socialImage('art-canyon'), socialImage('shot-sneaker-pop')].filter((s, i, a) => a.findIndex((x) => x.src === s.src) === i) },
    ...(d.image2 ? [{ key: 'image2', type: 'image', label: 'Second photo', samples: [socialImage(d.image2), socialImage('art-lighthouse')] }] : []),
    { key: 'headline', type: id === 'quote' || id === 'review' ? 'textarea' : 'text', label: id === 'quote' ? 'Quote' : id === 'review' ? 'Review' : 'Headline', max: 120, default: d.headline },
    { key: 'sub', type: d.sub.includes('\n') ? 'textarea' : 'text', label: id === 'tips' ? 'Tips (one per line)' : id === 'price-list' ? 'Items (one per line)' : 'Second line', max: 160, default: d.sub },
    { key: 'cta', type: 'text', label: id === 'event' ? 'Date' : id === 'countdown' ? 'Countdown' : 'Small print', max: 32, default: d.cta },
    { key: 'color', type: 'color', label: 'Brand colour', default: ['#ff5a36', '#ffd400', '#f5efe6', '#1b1b1b', '#2742ff', '#d7ff3a', '#ffffff', '#f2b8c6', '#7cf2d4', '#ffcf1a', '#7b5cff', '#ff7a1a'][SOCIAL.findIndex((s) => s[0] === id)] },
  ],
  outputs: [{ type: 'image', sizes: [SQUARE, FEED, STORY, WIDE], label: 'Post, portrait, story and thumbnail' }, { type: 'video', sizes: [STORY], duration: 6, fps: 30, label: 'Animated story' }],
  layout: id,
  preview: { ar: id === 'thumbnail' ? '16/9' : '4/5' },
}));

// ---------- 9. Talking product ad ----------
export const PRESENTERS = [
  { id: 'ava', label: 'Ava', src: '/presets/samples/presenter-ava.webp', voice: 'en' },
  { id: 'leo', label: 'Leo', src: '/presets/samples/presenter-leo.webp', voice: 'en' },
  { id: 'mei', label: 'Mei', src: '/presets/samples/presenter-mei.webp', voice: 'en' },
];
const talkingSpec = spec({
  id: 'talking-ad', title: 'Talking product ad', summary: 'A presenter reads your script beside your product', badge: 'new',
  description: 'Write a short script and add your product. A digital presenter (not a real person) reads it with a voiceover and bold captions, cut like a social ad.',
  category: 'ads', tags: ['ugc', 'ad', 'voiceover'], engine: 'talking',
  cost: { tier: 'daily-free', estimateUSD: 0.001 },
  safety: { ...SAFE, disclosure: 'Digital presenter. Not a real person.' },
  note: 'Precise lip-sync is coming soon. For now the mouth follows the voice.',
  steps: [{ op: 'script' }, { op: 'voice' }, { op: 'presenter' }, { op: 'captions' }, { op: 'layout' }],
  inputs: [
    { key: 'presenter', type: 'choice', label: 'Presenter', default: 'ava', options: PRESENTERS.map((p) => ({ id: p.id, label: p.label })) },
    productInput('serum'),
    { key: 'script', type: 'textarea', label: 'Script', max: 320, default: 'Okay, my skin has never looked this good. This is Glow Serum. Three drops every morning, and it just sinks right in. Light, fast, no sticky feel. Tap the link and try it.' },
    { key: 'brand', type: 'text', label: 'Brand or product name', max: 28, default: 'Glow Serum' },
    { key: 'cta', type: 'text', label: 'Call to action', max: 28, default: 'Shop now' },
  ],
  outputs: [{ type: 'video', sizes: [STORY], duration: 15, fps: 30, label: 'Vertical ad with voice' }],
  preview: { ar: '9/16' },
});

export const PRESETS = [...sceneSpecs, spinSpec, ...mockupSpecs, talkingSpec, earthSpec, ...warpSpecs, ...rainSpecs, ...transitionSpecs, ...socialSpecs];
export const presetById = (id) => PRESETS.find((p) => p.id === id) || null;
export const presetURL = (id) => '/workflows?preset=' + encodeURIComponent(id);
/** Problems in the catalog (an empty list means every spec is valid). */
export function catalogProblems() {
  const out = [];
  const ids = new Set();
  for (const p of PRESETS) {
    if (ids.has(p.id)) out.push(`${p.id}: duplicate id`);
    ids.add(p.id);
    for (const e of validateSpec(p)) out.push(`${p.id}: ${e}`);
  }
  return out;
}
