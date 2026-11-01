// Templates: complete example sites, one click away (/website?template=<id> or the builder's picker).
// Each starts from the built-in writer (so a description of the same kind makes the same structure), then fills
// the writer's [bracketed] blanks with sample copy for a fictional brand. Sample prices and facts stay marked as
// placeholders (ph) so the editor and the export checklist still ask the owner to replace them.

import { TEMPLATES_LIST } from './templates-list.js';
import { KINDS, templateSite, sanitizeSite } from './spec.js';

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

/** The example site for a template id, or null. A fresh copy every time (new ids). */
export function buildTemplate(id) {
  const t = TEMPLATES[id];
  if (!t) return null;
  const site = templateSite({ prompt: KINDS[t.kind].example, kind: t.kind, style: t.style });
  POLISH[id]?.(site);
  return sanitizeSite(site, site, { source: 'user' });
}
