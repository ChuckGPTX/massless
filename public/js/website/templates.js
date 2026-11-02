// Templates: complete example sites, one click away (/website?template=<id> or the builder's picker).
// Each starts from the built-in writer (so a description of the same kind makes the same structure), then fills
// the writer's [bracketed] blanks with sample copy for a fictional brand. Sample prices and facts stay marked as
// placeholders (ph) so the editor and the export checklist still ask the owner to replace them.

import { TEMPLATES_LIST } from './templates-list.js';
import { KINDS, templateSite, sanitizeSite, newSection } from './spec.js';
import { buildStarter } from './starters.js';

export { TEMPLATES_LIST };
export const TEMPLATES = Object.fromEntries(TEMPLATES_LIST.map((t) => [t.id, t]));

/** Replace [blanks] across a site: map is { '[blank]': 'sample' } or a function (blank) => sample | undefined. */
function fillBlanks(site, map) {
  const get = typeof map === 'function' ? map : (k) => map[k];
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && k !== 'prompt') o[k] = v.replace(/\[[^\]\n]{1,120}\]/g, (m) => get(m) ?? m);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  walk(site.pages);
  walk(site.collections);
  return site;
}
const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const sections = (site, type) => site.pages.flatMap((p) => p.sections.filter((s) => s.type === type));

const POLISH = {
  'editorial-shop'(site) {
    const tick = Object.assign(newSection('logos', site), { variant: 'marquee', title: '', items: ['Small runs', 'Free repairs for a year', 'Made in Lyon', 'Waxed cotton from Scotland', 'Shipping EU · UK · US · Japan', 'New pieces every season'].map((name) => ({ name })) });
    site.pages[0].sections.splice(1, 0, tick);
    const prices = { 'Waxed field jacket': '€340', 'Wool coat': '€420', 'Travel trouser': '€165', 'Overshirt': '€190' };
    for (const s of sections(site, 'products')) for (const it of s.items) { it.price = prices[it.name] || '€180'; it.ph = true; }
    fillBlanks(site, {
      '[A few lines on the season: where it was shot, what it is about.]': 'Shot over two grey mornings by the river, in the clothes we wear to work. Nothing styled, nothing pressed: just the pieces, worn the way they are meant to be.',
      '[Add who makes the pieces and where.]': 'Every piece is cut and sewn by a workshop of six, twenty minutes from the studio.',
      '[Where the fabric comes from]': 'Waxed cotton woven in Scotland',
      '[List the countries you ship to.]': 'Across the EU, the UK, the US and Japan. Orders leave the studio within two working days.',
      '[Your return window and how to start one.]': 'Thirty days, unworn, with the tags on. Write to us and we send a prepaid label.',
      '[A line on fit, and where to find the size guide.]': 'Cut true to size with room for a knit underneath. Each product page lists exact measurements.',
      '[Washing and care, in plain words.]': 'Brush off dirt, sponge with cold water, re-wax once a year. We do it for free if you ask.',
    });
  },
  manifesto(site) {
    fillBlanks(site, {
      '[Add one fact or story that shows the problem.]': 'The average street is now louder than a vacuum cleaner, all day and most of the night.',
      '[Say plainly what you make or do, and who it is for.]': 'We map the quiet places that are left, design rooms and streets that keep them, and record the sound of a city at rest so that people remember what it is like.',
    });
  },
  'portfolio-timeline'(site) {
    const work = {
      Map: ['Maps that read like a walk', 'Wayline', 'A pocket map that shows the next turn, not the whole city. Turn-by-turn became glance-by-glance.', 'Product lead\nTwo engineers\nOne researcher'],
      Camera: ['A camera that gets out of the way', 'Shutter Co.', 'One button, no modes. Photos taken in the first second after opening went up by half.', 'Design and prototyping\nCamera team of four'],
      'Reading app': ['Reading, one paragraph at a time', 'Folio', 'Long articles broken into calm, swipeable pages, with type set for phones first.', 'Interaction design\nEditorial team'],
      Thermostat: ['A dial for the whole house', 'Hearth Labs', 'A single ring that learns the schedule. The first week of setup became the first minute.', 'Interface design\nHardware team'],
    };
    for (const s of sections(site, 'cases')) {
      s.items.forEach((it, i) => {
        const w = work[it.title];
        if (w) {
          [it.title, it.client, it.text, it.credits] = w;
          if (i === 0) it.link = { label: 'Read the case study', href: '#' };
        } else if (it.title === '[Project]') {
          Object.assign(it, i === 4 ? { title: 'A notebook for field biologists', client: 'Open source', text: 'Offline notes, photos and GPS tags in one tap. Used on three continents.', credits: 'Design and code' } : { title: 'Interface studies', client: 'Independent', text: 'Small experiments in touch, scrolling and motion, published as I go.', credits: 'Self-initiated' });
          it.image = { ...it.image, alt: `${it.title}, shown on a ${i === 4 ? 'phone' : 'laptop'}`, prompt: `${lcFirst(it.title)} app on a ${i === 4 ? 'phone' : 'laptop'}, clean studio light` };
        }
      });
    }
    for (const s of sections(site, 'timeline')) s.items.forEach((it) => { const w = work[it.title]; if (w) it.title = w[0]; });
    fillBlanks(site, {
      '[Two sentences on your background and what you care about.]': 'She studied architecture, then moved to screens because buildings take too long to test. She cares about the first ten seconds of anything people touch.',
      '[Where you have worked, and what you are doing now.]': 'She has led design at two startups and one very large company, and now works independently with small product teams.',
    });
  },
  'ai-product'(site) {
    const p = { Creator: '$24', Studio: '$79' };
    for (const s of sections(site, 'pricing')) for (const it of s.items) if (p[it.name]) it.price = p[it.name];
    fillBlanks(site, {
      '[Say who owns the output and how it can be used.]': 'You do. Everything you make is yours to post, sell and license, including for commercial work.',
      '[List the platforms and export formats.]': 'Web, iPhone and Android. Export stills as PNG or JPG and video as MP4, in square, portrait and wide.',
      '[Say what you store, for how long, and how to delete it.]': 'Only the photos you upload and the characters you save. Delete a character and everything about it is gone within a day.',
    });
  },
  'local-business'(site) {
    fillBlanks(site, {
      '[Add a line about how you started and who does the work.]': 'Two brothers started it with one mower and a borrowed trailer; today a crew of six does every job.',
      '[List your service area.]': 'Cedar Rapids, Marion, Hiawatha and Robins.',
      '[Say how customers pay: card, transfer, invoice.]': 'By card or bank transfer after each visit, or one monthly invoice for regular plans.',
      '[Say if there is a minimum.]': 'No minimum for regular customers. One-off jobs start at one hour.',
      '[Say what is included in the price.]': 'Yes: fuel, tools, clippings and leaf removal are all in the quote.',
      '[Tell your story: who started it, when and why.]': 'It started as a summer job and became a business when the neighbors kept calling back.',
    });
  },
  photographer(site) {
    let n = 0;
    const names = ['Lake wedding, June', 'The Ortega family', 'Studio portraits', 'Hill Country elopement', 'Bakery brand shoot', 'Winter engagement', 'Garden party', 'Graduation portraits', 'East Austin wedding'];
    fillBlanks(site, (k) => (/^\[Project \d+\]$/.test(k) ? names[n++ % names.length] : {
      '[Add a sentence about your background and what you love to make.]': 'I studied photojournalism and still shoot like a reporter: quietly, from the edges, waiting for the real moment.',
      '[Write the post here.]': 'A short note from the studio. Replace it with your own post.',
    }[k]));
  },
  'app-landing'(site) {
    for (const s of sections(site, 'pricing')) for (const it of s.items) if (it.price === '[Price]') it.price = it.name === 'Pro' ? '$6' : '$12';
    fillBlanks(site, { '[List platforms: web, iPhone, Android.]': 'Web, iPhone and Android, synced between them.' });
  },
  conference(site) {
    const names = [['Maya Okafor', 'Design systems at small scale'], ['Luis Brandt', 'Shipping on Fridays'], ['Priya Nair', 'Accessible by default'], ['Tom Whitfield', 'The boring stack']];
    for (const s of sections(site, 'team')) s.items.forEach((it, i) => { if (names[i]) [it.name, it.role] = names[i]; });
    for (const s of sections(site, 'pricing')) for (const it of s.items) if (it.price === '[Price]') it.price = it.name === 'Student' ? '$49' : '$149';
    fillBlanks(site, {
      '[Add who should come and what they will leave with.]': 'Come if you build software for a living or want to. You will leave with three ideas you can use on Monday.',
      '[Announcing soon.]': 'Sample speakers: replace them with your line-up.',
      '[Parking and transit details.]': 'Two garages within a block; the downtown bus loop stops at the door.',
      '[Your refund policy.]': 'Full refunds until two weeks before the day; after that, transfer your ticket to a friend.',
      '[Accessibility details.]': 'Step-free entry, live captions on the main stage and a quiet room all day.',
    });
  },
  restaurant(site) {
    const dishes = { 'Al pastor tacos': ['Spit-roasted pork, pineapple, onion and cilantro on our own corn tortillas.', '$4'], 'Carne asada plate': ['Grilled skirt steak, rice, beans and a stack of warm tortillas.', '$18'], 'Chicken tinga tostadas': ['Smoky chipotle chicken, crema and queso fresco on crisp tostadas.', '$12'], Elote: ['Grilled corn with mayo, cotija, lime and chile.', '$6'], Horchata: ['Rice, cinnamon and vanilla, made fresh every morning.', '$4'], Churros: ['Cinnamon sugar and a cup of dark chocolate for dipping.', '$7'] };
    for (const it of site.collections.menu) if (dishes[it.title]) [it.text, it.price] = dishes[it.title];
    for (const s of sections(site, 'contact')) if (/^\[Mon/.test(s.hours)) s.hours = 'Mon–Thu 11–9\nFri–Sat 11–10\nSun closed';
    fillBlanks(site, {
      '[Tell the story: who cooks, where the recipes come from.]': 'Rosa Verde cooks the recipes her grandmother made in Puebla, with masa ground in the kitchen every morning.',
      '[Note on allergies and dietary options.]': 'Tell us about allergies when you order. Most dishes can be made vegetarian.',
      '[One line about the food and the room.]': 'Tortillas pressed by hand, a long patio and a kitchen you can see from every table.',
    });
  },
  'book-launch'(site) {
    const ch = [['Start with the soil', 'What your yard already has, and the three tests that tell you what it needs.'], ['A bed in a weekend', 'Build one raised bed with tools you already own.'], ['What to plant first', 'Twelve plants that forgive beginners, by season.'], ['Water, less often', 'Deep watering, mulch and the end of daily chores.'], ['Keep going', 'Saving seed, sharing the harvest and planning year two.']];
    for (const s of sections(site, 'timeline')) s.items.forEach((it, i) => { if (ch[i]) [it.title, it.text] = ch[i]; });
    for (const s of sections(site, 'pricing')) for (const it of s.items) if (it.price === '[Price]') it.price = { Ebook: '$14', Hardcover: '$28', Bundle: '$34' }[it.name] || '$20';
    fillBlanks(site, {
      '[A short bio: why you are the right person to write this.]': 'June Park has kept a backyard garden for fifteen years and teaches the most popular beginner class at her city’s community garden.',
      '[Release date.]': 'Spring 2027, in time for planting.',
      '[Your refund policy.]': 'If it is not for you, email us within 30 days for a full refund.',
    });
  },
  'app-waitlist'(site) {
    fillBlanks(site, {
      '[Add your launch window.]': 'Early next year. Waitlist members get in first.',
      '[Say how pricing will work.]': 'Planning one weekend a month will always be free.',
      '[List platforms: web, iPhone, Android.]': 'iPhone first, with Android and web soon after.',
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Template photography (generated with Higgsfield Soul; see photos.js and media/website/provenance.json).
// Only the template examples get these; a site someone describes keeps its empty slots and SVG art.
// ---------------------------------------------------------------------------------------------

const ph = (tpl, name, alt, prompt = '') => ({ src: `/media/website/${tpl}/${name}.webp`, alt, prompt: prompt || alt });

const SHOP = [
  ['Waxed field jacket', 'Black', '€340', 'field-jacket-black', 'A woman in a black waxed field jacket and dark trousers on a grey studio backdrop'],
  ['Wool coat', 'Olive', '€420', 'wool-coat-olive', 'A long olive wool coat over a cream knit, full length'],
  ['Overshirt', 'Stone', '€190', 'overshirt-stone', 'A man in a stone cotton overshirt and ecru trousers'],
  ['Waxed field jacket', 'Navy', '€340', 'field-jacket-navy', 'A man in a navy waxed field jacket and dark denim'],
  ['Wool coat', 'Chalk', '€420', 'wool-coat-chalk', 'A woman in a long chalk wool coat and black boots'],
  ['Travel trouser', 'Black', '€165', 'travel-trouser-black', 'A woman in black wide-leg travel trousers and a white shirt'],
  ['Overshirt', 'Chalk', '€190', 'overshirt-chalk', 'A woman in a chalk overshirt and olive trousers'],
  ['Waxed field jacket', 'Rust', '€340', 'field-jacket-rust', 'A man in a rust waxed field jacket and cream trousers'],
];

const PHOTOGRAPHY = {
  'editorial-shop'(site) {
    const T = 'editorial-shop';
    const items = () => SHOP.map(([name, note, price, file, alt]) => ({ image: ph(T, file, alt), name, price, note, link: { label: '', href: '' }, ph: true }));
    for (const s of sections(site, 'products')) s.items = items();
    const hero = ph(T, 'hero', 'A woman in a long charcoal coat walking through a pale concrete courtyard');
    const looks = [ph(T, 'look-collar', 'Close crop of a waxed cotton collar and brass snaps in low sun'), ph(T, 'look-bridge', 'Two people in neutral outerwear on a bridge at dusk'), ph(T, 'look-steps', 'A woman in an overshirt sitting on wide stone steps'), ph(T, 'rail', 'A rail of jackets in olive, black, rust and stone in a white studio')];
    site.pages[0].sections[0].image = hero;
    for (const s of sections(site, 'lookbook')) {
      if (s.variant === 'full') s.items = looks.slice(0, 3).map((image, k) => ({ image, caption: `Look ${String(k + 1).padStart(2, '0')}`, note: ['Waxed field jacket', 'Overshirt', 'Wool coat'][k] }));
      else s.items = [hero, ...looks].map((image, k) => ({ image, caption: `Look ${String(k + 1).padStart(2, '0')}`, note: ['Wool coat', 'Waxed field jacket', 'Overshirt', 'Travel trouser', 'The rail'][k] }));
    }
    for (const s of sections(site, 'about')) s.image = looks[3];
    for (const s of sections(site, 'hero')) if (s.variant === 'banner' && /pieces/.test(s.subtitle)) s.subtitle = `${SHOP.length} pieces, made in small runs.`;
  },
  'local-business'(site) {
    const T = 'local-business';
    const pics = [ph(T, 'edging', 'A crisp lawn edge along a concrete walkway'), ph(T, 'beds', 'A green backyard with tidy flower beds'), ph(T, 'mower', 'A riding mower striping a wide lawn'), ph(T, 'leaves', 'Autumn leaves raked into a neat pile')];
    site.pages[0].sections[0].image = ph(T, 'hero', 'A freshly striped front lawn in morning light');
    for (const s of sections(site, 'features')) s.items.forEach((it, k) => { if (pics[k]) it.image = pics[k]; });
    // the home page shows the work: services as a bento with photos
    const home = site.pages[0].sections.find((s) => s.type === 'features');
    if (home) home.variant = 'bento';
    for (const s of sections(site, 'about')) s.image = s.variant === 'centered' ? pics[2] : pics[1];
  },
  'portfolio-timeline'(site) {
    const T = 'portfolio-timeline';
    const pics = [ph(T, 'map', 'A laptop showing a pastel map with a blue route'), ph(T, 'camera', 'A phone showing a camera view of a green valley'), ph(T, 'reading', 'A tablet showing a calm reading layout'), ph(T, 'dial', 'A round wall thermostat with a glowing blue ring'), ph(T, 'field', 'A phone with a topographic map held in a mossy forest'), ph(T, 'studies', 'Translucent glass shapes on white')];
    for (const s of sections(site, 'cases')) s.items.forEach((it, k) => { if (pics[k]) it.image = pics[k]; });
    for (const s of sections(site, 'about')) s.image = ph(T, 'portrait', 'Portrait of Noor Haddad at a desk in a bright studio');
  },
  manifesto(site) {
    const T = 'manifesto';
    const home = site.pages[0];
    home.sections[0].image = { ...ph(T, 'fog-avenue', 'An empty avenue dissolving into fog at blue hour'), decorative: true };
    const band = (file, alt, caption, note) => Object.assign(newSection('lookbook', site), { eyebrow: '', title: '', items: [{ image: ph(T, file, alt), caption, note }] });
    const at = home.sections.findIndex((s) => s.type === 'chapters');
    home.sections.splice(at, 0, band('dusk-water', 'Still water under a violet sky with a band of light on the horizon', 'The quiet hour', 'Every city has one left'));
    const sign = home.sections.findIndex((s) => s.type === 'signup');
    home.sections.splice(sign, 0, band('light-room', 'An empty concrete room with one shaft of light on the floor', 'Room to think', 'What silence makes possible'));
  },
  'ai-product'(site) {
    const T = 'ai-product';
    const face = ph(T, 'portrait', 'Studio portrait of the Twinlight character: a woman with a copper bob and freckles', 'a studio portrait of the character, a young woman with freckles and a short bob, soft daylight, plain warm backdrop');
    site.pages[0].sections[0].image = face;
    for (const s of sections(site, 'annotated')) s.image = face;
    const scenes = [ph(T, 'steps', 'The character sitting on brick steps in the city'), ph(T, 'cafe', 'The character holding a coffee by a cafe window'), ph(T, 'rooftop', 'The character laughing on a rooftop at golden hour'), ph(T, 'park', 'The character walking a dog in an autumn park'), ph(T, 'studio-red', 'The character in a studio portrait against a red backdrop')];
    for (const s of sections(site, 'features')) s.items.forEach((it, k) => { if (scenes[k]) it.image = scenes[k]; });
    for (const s of sections(site, 'gallery')) s.items.forEach((it, k) => { if (scenes[k]) it.image = scenes[k]; });
  },
  photographer(site) {
    const T = 'photographer';
    const pics = [ph(T, 'couple', 'A couple laughing together in a field, black and white'), ph(T, 'family', 'A family walking through a golden field at sunset'), ph(T, 'rings', 'Two gold wedding rings on white linen'), ph(T, 'window', 'A woman by a tall window in soft light'), ph(T, 'dance', 'A couple dancing under string lights, black and white'), ph(T, 'lake', 'A couple by a misty lake at dawn')];
    site.pages[0].sections[0].image = pics[0];
    for (const s of sections(site, 'gallery')) s.items = pics.map((image, k) => ({ image, caption: s.items[k]?.caption || '' }));
    for (const s of sections(site, 'about')) s.image = ph(T, 'portrait', 'Portrait of Ana Ruiz with a film camera in her studio');
    site.collections.posts.forEach((it, k) => { it.image = [pics[2], pics[3], pics[5]][k % 3]; });
  },
  'app-landing'(site) {
    const T = 'app-landing';
    site.pages[0].sections[0].image = ph(T, 'glass', 'Soft glass shapes in violet and peach light');
    for (const s of sections(site, 'features')) { if (s.items[0]) s.items[0].image = ph(T, 'window', 'Someone relaxing by a sunny window with tea and a phone'); if (s.items[3]) s.items[3].image = ph(T, 'motion', 'Abstract figures in violet and cyan light'); }
  },
  'app-waitlist'(site) {
    const T = 'app-waitlist';
    site.pages[0].sections[0].image = ph(T, 'phone', 'A phone on a cabin table at night showing a lake at dusk');
    for (const s of sections(site, 'features')) { if (s.items[0]) s.items[0].image = ph(T, 'porch', 'A cabin porch above a calm lake at twilight'); if (s.items[3]) s.items[3].image = ph(T, 'road', 'A quiet road through pines at blue hour'); }
  },
  conference(site) {
    const T = 'conference';
    site.pages[0].sections[0].image = ph(T, 'hall', 'A conference hall with warm stage lights, seen from the back');
    for (const s of sections(site, 'about')) s.image = ph(T, 'coffee', 'People laughing during a coffee break');
    const tick = Object.assign(newSection('logos', site), { variant: 'marquee', title: '', items: ['Design systems', 'Shipping on Fridays', 'Accessible by default', 'The boring stack', 'Hands-on workshops', 'Hallway track', 'After-party'].map((name) => ({ name })) });
    site.pages[0].sections.splice(2, 0, tick);
  },
  restaurant(site) {
    const T = 'restaurant';
    const room = ph(T, 'room', 'The candle-lit dining room at night');
    const kitchen = ph(T, 'kitchen', 'Chefs plating food in the open kitchen');
    site.pages[0].sections[0].image = room;
    for (const s of sections(site, 'about')) s.image = kitchen;
    for (const s of sections(site, 'gallery')) s.items = [ph(T, 'tacos', 'Al pastor tacos with lime and cilantro'), room, kitchen, ph(T, 'patio', 'The patio under string lights at dusk'), ph(T, 'ingredients', 'Tomatoes, chiles, limes and cilantro on a board')].map((image) => ({ image, caption: '' }));
  },
  'book-launch'(site) {
    const T = 'book-launch';
    site.pages[0].sections[0].image = ph(T, 'book', 'Small Fires: a terracotta hardcover beside a seedling');
    for (const s of sections(site, 'about')) s.image = ph(T, 'author', 'June Park reading in a library');
  },
};

/** The example site for a template id, or null. A fresh copy every time (new ids). */
export function buildTemplate(id) {
  const t = TEMPLATES[id];
  if (!t) return null;
  const starter = buildStarter(id);
  if (starter) return starter;
  const site = templateSite({ prompt: KINDS[t.kind].example, kind: t.kind, style: t.style });
  POLISH[id]?.(site);
  PHOTOGRAPHY[id]?.(site);
  return sanitizeSite(site, site, { source: 'user' });
}
