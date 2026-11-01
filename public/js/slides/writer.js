// The built-in deck writer: a description becomes an 8-12 slide deck with no model call. It reads the brief
// for facts (name, what it is, audience, numbers, dates, prices, people, features), picks a deck kind and a
// theme, then fills a slide plan for that kind. Anything it cannot know is written as clearly marked example
// copy, with a speaker note saying what to replace. Same input, same deck (seeded by the text).

import { sanitizeDeck } from './spec.js';
import { THEME_IDS } from './themes.js';

export const KINDS = {
  pitch: { name: 'Pitch', theme: 'midnight', transition: 'morph', example: 'An investor pitch for Tallyfern, an app that turns receipts into a tidy monthly budget. 48,000 households, 31% monthly growth, raising $3M.' },
  launch: { name: 'Launch', theme: 'aurora', transition: 'zoom', example: 'Launch deck for Driftwood, an app that plans calm weekend trips within two hours of home. Launching May 1, 2027 at $4/month.' },
  sales: { name: 'Sales', theme: 'harvest', transition: 'push', example: 'A sales proposal from Groundwork Grounds Co. to Cedar Ridge Office Park for year-round lawn, bed and snow care.' },
  report: { name: 'Report', theme: 'swiss', transition: 'fade', example: 'Q3 2026 report for Quiet Hours sound studio: revenue $480k, up 18%, 16 projects, 40% margin.' },
  portfolio: { name: 'Portfolio', theme: 'studio', transition: 'morph', example: 'A portfolio for Noor Haddad, an interaction designer in Oakland who designs maps, cameras and reading apps.' },
  event: { name: 'Event', theme: 'stadium', transition: 'push', example: 'Prairie Code Camp, a one-day developer conference on May 16, 2027 at the Paramount Theatre in Cedar Rapids. 600 developers, tickets $189.' },
  lesson: { name: 'Lesson', theme: 'pop', transition: 'zoom', example: 'A lesson on photosynthesis for 7th graders: how plants turn light, water and air into sugar.' },
};
export const KIND_IDS = Object.keys(KINDS);

export const SURPRISES = [
  'An investor pitch for Loomline, an AI tool that turns customer calls into product roadmaps. 120 teams, $40k MRR, raising $2.5M seed.',
  'Launch deck for Hearth, a smart kettle that learns when you wake up. Shipping October 2027, $129, with app control, quiet boil and a 5-year warranty.',
  'Sales deck from Brightside Solar to the Maple Grove school district: rooftop solar for 9 schools, saving $210,000 a year.',
  'Annual report 2026 for Second Harvest Food Bank: 4.2 million meals, 1,800 volunteers, up 22%.',
  'A portfolio for Kenji Mori, a brand designer in Tokyo who builds identities for coffee roasters and small hotels.',
  'Northern Lights Music Festival, three days of indie and folk on August 14, 2027 at Lakeside Park in Duluth. 12,000 fans, tickets $95.',
  'A lesson on the solar system for 4th graders: the planets, why Pluto changed, and how big space really is.',
  'A pitch for Ferment & Co, a kombucha brand sold in 340 stores, growing 60% a year, raising $1.5M for a second brewery.',
  'Launch of Paperlight, a minimalist e-reader for kids with no apps, no ads and a 6-week battery. $89, available March 2027.',
  'A workshop on public speaking for new managers: structure, slides, nerves and handling questions.',
];

// ---------- reading the brief ----------
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lc = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const trimP = (s) => String(s || '').replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '').replace(/(?<!\b(?:Co|Inc|Ltd|St|Jr|Sr))\.+$/, '');
const NOT_NAME = /^(A|An|The|My|Our|This|That|Deck|Slides|Pitch|Presentation|Launch|Sales|Annual|Report|Portfolio|Lesson|Workshop|Event|Investor|Quarterly|Q[1-4]|We|I|It|For|About|New|Monthly|Weekly)$/;
const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';

export function readBrief(prompt = '') {
  const p = String(prompt).replace(/\s+/g, ' ').trim();
  const f = { raw: p };
  const q = p.match(/["“”]([^"“”]{2,60})["“”]/);
  const called = p.match(/\b(?:called|named)\s+([A-Z0-9][\w&'’.-]*(?:\s+(?:of|the|and|&|[A-Z0-9][\w&'’.-]*)){0,3})/);
  const forName = p.match(/\b(?:for|from|of|by)\s+((?:[A-Z][\w&'’.-]*)(?:\s+(?:&|and|of|[A-Z][\w&'’.-]*)){0,3})(?=,|\s+[a-z]|\.|:|$)/);
  const lead = p.match(/^((?:The\s+)?[A-Z0-9][\w&'’.-]*(?:\s+(?:of|the|and|&|[A-Z0-9][\w&'’.-]*)){0,3})(?:,\s+(?=[a-z0-9])|\s+is\s+(?:a|an|the|our|my)\s)/);
  for (const c of [q?.[1], called?.[1], lead?.[1], forName?.[1]]) {
    if (c && !NOT_NAME.test(c.split(' ')[0]) && c.length <= 48) { f.name = trimP(c); break; }
  }
  // what it is: "Name, an app that ...", "Name is a ...", "for an app that ..."
  const appo = p.match(/,\s+((?:a|an|the|our)\s+[^.;:]{4,140}?)(?=[.;:]|,\s+(?:\d|\$|with|raising|launching|shipping|available|on|at)\b|$)/i)
    || p.match(/\bis\s+((?:a|an)\s+[^.;:]{4,140}?)(?=[.;:]|$)/i)
    || p.match(/\b(?:for|about|on)\s+((?:a|an)\s+[^.;:,]{4,140}?)(?=[.;:,]|$)/i);
  if (appo) f.what = trimP(appo[1]);
  if (!f.what && f.name) {
    const after = p.slice(p.indexOf(f.name) + f.name.length).match(/^,\s+([a-z0-9][^.;]{4,140}?)(?=\s+(?:on|at|in)\s+[A-Z]|[.;]|$)/);
    if (after) f.what = trimP(after[1]);
  }
  const offer = p.match(/\bfor\s+((?:year-round|ongoing|monthly|annual|full|complete|managed|[a-z]+-[a-z]+)\s+[a-z][^.;]{3,100})(?=[.;]|$)/) || p.match(/\b(?:offering|to provide|providing)\s+([a-z][^.;]{3,100})/);
  if (offer) f.offer = trimP(offer[1]);
  const verb = f.what && f.what.match(/\b(?:that|which|who|to)\s+(.+)$/i);
  if (verb) f.does = trimP(verb[1]);
  const noun = f.what && f.what.match(/^(?:a|an|the|our)\s+(.+?)(?:\s+(?:that|which|who|to|for|in|from|with)\b|$)/i);
  if (noun) f.noun = trimP(noun[1]);
  const into = f.does && f.does.match(/\b(?:into|for|so|to)\s+(.+)$/i);
  if (into) f.outcome = trimP(into[1]);
  const aud = p.match(/\bfor\s+((?:(?:new|small|busy|first-time|young|local|independent|remote|busy|tired|curious|working|home|\d+(?:st|nd|rd|th)|grade\s*\d+|[a-z]+-[a-z]+)\s+){0,2}(?:teams|families|households|students|parents|developers|founders|managers|teachers|kids|children|graders|beginners|designers|marketers|nurses|clinics|restaurants|shops|retailers|creators|freelancers|engineers|investors|customers|travellers|travelers|homeowners|schools|startups|businesses|companies))\b/i);
  if (aud) f.audience = aud[1];
  const grade = p.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+graders?\b|\bgrade\s+(\d{1,2})\b/i);
  if (grade) f.grade = grade[1] || grade[2];
  const topic = p.match(/\b(?:lesson|class|lecture|workshop|course|unit|talk|introduction|intro)\s+(?:on|about|to|in)\s+(?:the\s+)?([^.:;,]{3,60}?)(?=\s+for\b|[.:;,]|$)/i);
  if (topic) f.topic = trimP(topic[1]);
  const place = p.match(/\b(?:in|near|across|based in)\s+((?:[A-Z][a-zA-Z'’-]+)(?:\s+[A-Z][a-zA-Z'’-]+){0,2}(?:,\s*[A-Z]{2}\b)?)/);
  if (place && !NOT_NAME.test(place[1])) f.place = place[1];
  const venue = p.match(/\bat\s+(?:the\s+)?((?:[A-Z][\w'’&-]*\s?){1,5})/);
  if (venue) f.venue = trimP(venue[1]);
  const date = p.match(new RegExp(`\\b(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2}(?:\\s*[–-]\\s*\\d{1,2})?(?:,?\\s*\\d{4})?|\\b(?:${MONTHS})[a-z]*\\s+\\d{4}\\b`, 'i'));
  if (date) f.date = date[0];
  const qtr = p.match(/\b(Q[1-4])\s*(20\d\d)?\b/);
  if (qtr) f.quarter = qtr[0];
  const year = p.match(/\b(20\d\d)\b/);
  if (year) f.year = year[1];
  const ask = p.match(/\b(?:raising|raise|seeking|ask(?:ing)? for)\s+(\$\s?\d[\d,.]*\s?(?:[kKmMbB]n?|million|billion)?)(?:\s+(seed|series [a-c]|pre-seed|round))?/i);
  if (ask) { f.ask = ask[1].replace(/\s+/g, '').replace(/million/i, 'M').replace(/billion/i, 'B'); f.round = ask[2] || ''; }
  const price = p.match(/(\$\s?\d[\d,.]*)\s*(?:\/|\s(?:a|per)\s)\s*(month|mo|year|yr|seat|user|ticket|night|session)\b/i) || p.match(/\b(?:tickets?|priced at|costs?|for)\s+(\$\s?\d[\d,.]*)/i) || p.match(/(\$\s?\d[\d,.]*)(?=,|\.|\s+(?:with|available|shipping))/);
  if (price) { f.price = price[1].replace(/\s/g, '').replace(/[.,]+$/, ''); f.period = price[2] ? `/${{ month: 'mo', mo: 'mo', year: 'yr', yr: 'yr' }[price[2].toLowerCase()] || price[2].toLowerCase()}` : ''; }
  // "48,000 households", "31% monthly growth", "$40k MRR"
  const stats = [];
  const re = /(\$?\d[\d,.]*\s?(?:%|[kKmMbB]n?\b|x\b|×)?)\s+((?:[a-z][a-z'’-]*)(?:\s+[a-z][a-z'’-]*){0,4})/g;
  let m;
  while ((m = re.exec(p))) {
    const v = m[1].replace(/\s/g, ''), label = m[2].replace(/\s+(?:and|with|in|on|at|for|to|from|a|an|the|raising|tickets?)$/i, '').replace(/\s+(?:and|with|in|on|at|for|to|from|a|an|the)\s.*$/i, '');
    if (/^(?:19|20)\d\d$/.test(v) || /^\d{1,2}$/.test(v) && /^(?:am|pm|st|nd|rd|th|graders?|minutes?|hours?|days?)\b/.test(label)) continue;
    if (f.ask && v === f.ask) continue;
    if (f.price && v === f.price) continue;
    if (!/[a-z]{3}/.test(label)) continue;
    stats.push({ value: v, label: label.trim() });
  }
  // "revenue $480k", "up 18%"
  const re2 = /\b(revenue|sales|profit|arr|mrr|income|funding|budget|savings|saving|costs?|spend)\s+(?:of\s+|was\s+|is\s+|at\s+|:\s*)?(\$\d[\d,.]*\s?(?:[kKmMbB]n?)?)/gi;
  while ((m = re2.exec(p))) stats.push({ value: m[2].replace(/\s/g, '').replace(/[.,]+$/, ''), label: m[1].toLowerCase().replace(/^saving$/, 'saved a year'), at: m.index });
  const up = p.match(/\bup\s+(\d[\d.]*%)/i);
  if (up) stats.push({ value: `+${up[1]}`, label: 'growth', at: up.index });
  f.stats = stats.map((x, i) => ({ ...x, at: x.at ?? p.indexOf(x.value) ?? i })).sort((a, b) => a.at - b.at)
    .filter((x, i, arr) => arr.findIndex((y) => y.value === x.value) === i).slice(0, 4).map(({ value, label }) => ({ value: value.replace(/[.,]+$/, ''), label }));
  const withs = p.match(/\bwith\s+([^.;]{4,160})/i) || p.match(/\bfeatures?:?\s+([^.;]{4,160})/i);
  const listOf = (raw) => raw.split(/,\s*|\s+and\s+|\s*&\s*/).map((x) => trimP(x).replace(/^(?:and|or|the|a|an)\s+/i, '')).filter((x) => x && x.split(' ').length <= 6 && !/^\$?\d/.test(x));
  if (withs) f.features = listOf(withs[1]).slice(0, 4);
  const colon = p.match(/:\s*([^.]{6,200})/);
  if (colon) {
    f.after = trimP(colon[1]);
    const l = listOf(colon[1]);
    const sentence = /\b(?:into|from|to|with)\b/.test(l.at(-1) || '') && l.some((x) => !x.includes(' ')) || /\d/.test(colon[1]);
    if (!sentence && l.length >= 2 && (!f.features || f.features.length < 2)) f.features = l.slice(0, 5);
  }
  const people = p.match(/\b(?:founded by|led by|speakers?(?: include)?|team(?: of)?:?|with)\s+([A-Z][a-z]+\s+[A-Z][a-z'’-]+(?:(?:,\s*|\s+and\s+)[A-Z][a-z]+\s+[A-Z][a-z'’-]+){0,3})/);
  if (people) f.people = people[1].split(/,\s*|\s+and\s+/).slice(0, 4);
  const person = p.match(/\b(?:for|by|of)\s+([A-Z][a-z]+\s+[A-Z][a-z'’-]+)\b(?=,|\s+(?:a|an|the|who)\b)/);
  if (person) f.person = person[1];
  const role = p.match(/,\s+(?:a|an)\s+([a-z][a-z\s-]{3,40}?(?:designer|photographer|developer|engineer|architect|illustrator|writer|artist|consultant|coach|director|filmmaker|chef|planner|strategist))\b/i);
  if (role) f.role = role[1];
  const prospect = p.match(/\b(?:to|for)\s+(?:the\s+)?((?:[A-Z][\w&'’.-]*)(?:\s+(?:[A-Z][\w&'’.-]*|of|&)){0,4})(?=\s*[:,.]|\s+(?:for|to|on)\b|$)/g);
  if (prospect && prospect.length) f.prospect = trimP(prospect[prospect.length - 1].replace(/^(?:to|for)\s+(?:the\s+)?/i, ''));
  const email = p.match(/[\w.+-]+@[\w-]+\.[\w.-]*\w/);
  if (email) f.email = email[0];
  const url = p.match(/\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+(?:com|app|io|co|org|net|dev|studio|ai|camp|xyz))\b/i);
  if (url) f.url = url[1];
  return f;
}

export function detectKind(prompt) {
  const p = String(prompt).toLowerCase();
  const score = {
    pitch: /\b(investor|investors|pitch|raising|raise|seed|series [a-c]|fundrais|vc|venture|startup)\b/g,
    launch: /\b(launch|launching|introducing|announc|release|new app|new product|shipping|available|waitlist|unveil)\b/g,
    sales: /\b(sales|proposal|propose|client|prospect|customer|offer|rfp|quote|pitch to|deal|renewal)\b/g,
    report: /\b(report|quarter|quarterly|q[1-4]|annual|results|review|kpi|metrics|update|year in review|board)\b/g,
    portfolio: /\b(portfolio|my work|case stud|designer|photographer|illustrator|architect|artist|freelance)\b/g,
    event: /\b(event|conference|summit|festival|meetup|gala|wedding|concert|expo|hackathon|fair|tour|retreat)\b/g,
    lesson: /\b(lesson|class|lecture|students|teach|course|workshop|graders?|grade \d|school|training|tutorial|explain)\b/g,
  };
  let best = 'pitch', top = 0;
  for (const [k, re] of Object.entries(score)) {
    const n = (p.match(re) || []).length;
    if (n > top) { top = n; best = k; }
  }
  return best;
}

const THEME_HINTS = [
  [/\b(luxury|luxe|premium|jewel|fashion|hotel|gala|wine|fine dining)\b/i, 'luxe'],
  [/\b(kids|children|playful|fun|candy|toy|graders?)\b/i, 'pop'],
  [/\b(night|dark|space|planets?|solar system|astronomy|ocean)\b/i, 'midnight'],
  [/\b(ai|developer|code|api|software|crypto|data|security|devops|tech)\b/i, 'signal'],
  [/\b(bold|loud|protest|manifesto|streetwear|poster)\b/i, 'poster'],
  [/\b(minimal|clean|swiss|finance|bank|report|board|quarterly)\b/i, 'swiss'],
  [/\b(farm|garden|food|organic|coffee|bakery|kombucha|lawn|outdoor|wellness|harvest|solar)\b/i, 'harvest'],

  [/\b(sport|sports|festival|stadium|race|marathon|league|concert|music)\b/i, 'stadium'],
  [/\b(editorial|book|author|photograph|wedding|magazine|portfolio)\b/i, 'studio'],
];
export function pickTheme(prompt, kind) {
  for (const [re, id] of THEME_HINTS) if (re.test(prompt)) return id;
  return KINDS[kind]?.theme || 'studio';
}

// ---------- copy helpers ----------
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const pickBy = (seed, arr, k = 0) => arr[(seed + k * 7) % arr.length];
/** "Turns receipts into a tidy budget" -> "Turns receipts into a *tidy budget.*" */
export function emphasize(t, words = 2) {
  const w = trimP(t).split(' ');
  if (w.length < 3) return `*${w.join(' ')}.*`;
  const k = Math.min(words, w.length - 1);
  return `${w.slice(0, -k).join(' ')} *${w.slice(-k).join(' ')}.*`;
}
const M = '/media/website/';
const MOOD = {
  pitch: ['app-landing/glass.webp', 'app-landing/window.webp', 'app-landing/motion.webp', 'portfolio-timeline/dial.webp'],
  launch: ['app-waitlist/road.webp', 'app-waitlist/phone.webp', 'app-waitlist/porch.webp', 'app-landing/motion.webp'],
  sales: ['conference/coffee.webp', 'portfolio-timeline/reading.webp', 'app-landing/window.webp', 'ceramics.jpg'],
  report: ['manifesto/light-room.webp', 'pavilion.jpg', 'manifesto/fog-avenue.webp', 'lounge.jpg'],
  portfolio: ['portfolio-timeline/studies.webp', 'portfolio-timeline/camera.webp', 'portfolio-timeline/map.webp', 'portfolio-timeline/field.webp'],
  event: ['conference/hall.webp', 'conference/coffee.webp', 'restaurant/patio.webp', 'ai-product/rooftop.webp'],
  lesson: ['portfolio-timeline/reading.webp', 'manifesto/dusk-water.webp', 'local-business/leaves.webp', 'portfolio-timeline/map.webp'],
};
const photo = (kind, i, prompt, alt) => ({ src: `${M}${MOOD[kind][i % MOOD[kind].length]}`, alt: alt || 'Mood photograph (replace or generate your own)', prompt });

// ---------- the plans ----------
// Each plan returns slides with a priority (1 = always). writeDeck keeps the highest-priority ones, in order.
const S = (prio, layout, fields) => ({ prio, layout, ...fields });

function pitchPlan(f, seed) {
  const N = f.name || 'Your company';
  const what = f.what ? cap(f.what) : 'A better way to do something people do every day';
  const does = f.does || 'makes the hard part simple';
  const A = f.audience || pickBy(seed, ['busy teams', 'small businesses', 'households']);
  const st = f.stats.length ? f.stats : [{ value: '10,000', label: 'early users (example)' }, { value: '30%', label: 'monthly growth (example)' }, { value: '70%', label: 'still active after 90 days (example)' }];
  const feats = f.features && f.features.length >= 2 ? f.features : ['Set up in minutes', 'Works with the tools you already use', 'Private by default'];
  return [
    S(1, 'title', { variant: 'split', eyebrow: `${f.round ? cap(f.round) + ' round' : 'Investor presentation'} · ${f.year || new Date().getFullYear()}`, title: f.name ? `${N}` : emphasize(what, 2), subtitle: `${what}.`, meta: f.person ? `${f.person}` : f.url || 'Your name, title', image: photo('pitch', seed, `${what}, cinematic product mood photograph, soft light`), notes: 'Say the one-line promise, then pause.' }),
    S(1, 'statement', { tone: 'ink', eyebrow: 'The problem', title: f.outcome ? `Getting ${f.outcome} still takes *hours of manual work.*` : `${cap(A)} still do this *the slow way.*`, subtitle: 'Say who feels the pain, how often, and what it costs them.', notes: 'Replace the subtitle with one real story or number.' }),
    S(1, 'imagetext', { eyebrow: 'The solution', title: `Meet *${N}*`, text: `${N} ${does}. ${f.what ? '' : 'Describe the product in one or two plain sentences.'}`.trim(), items: feats.slice(0, 3).map((t) => ({ text: cap(t) })), image: photo('pitch', seed + 1, `${what}, product in use, natural light, editorial photograph`) }),
    S(2, 'twocol', { eyebrow: 'How it works', title: 'Three steps, *no friction*', items: [{ title: 'Connect', text: `Bring in what ${A} already have. It takes a few minutes.` }, { title: 'Automate', text: `${N} does the repetitive part, every time, without reminders.` }, { title: 'Decide', text: 'A clear view of what matters, ready when you need it.' }] }),
    S(1, 'bignumber', { eyebrow: 'Traction', value: st[0].value, label: st[0].label, text: f.stats.length ? '' : 'Example figures. Replace them with your own.', items: st.slice(1, 4), notes: f.stats.length ? '' : 'These are placeholders. Use your real metrics.' }),
    S(3, 'chart', { variant: 'side', eyebrow: 'Growth', title: 'Growing *every month*', text: 'Example data. Edit the numbers in the Slide panel.', chart: { type: 'bar', labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], series: [{ name: 'Users', values: [12, 16, 22, 29, 38, 50] }], prefix: '', suffix: 'k' } }),
    S(3, 'pricing', { eyebrow: 'Business model', title: 'How we *make money*', items: f.price ? [{ name: 'Free', price: '$0', period: f.period || '/mo', features: ['Try the core product', 'No card needed'] }, { name: 'Pro', price: f.price, period: f.period || '/mo', features: feats.slice(0, 3).map(cap), featured: true }] : [{ name: 'Starter', price: '$0', period: '/mo', features: ['The core product', 'One user'] }, { name: 'Pro', price: '$12', period: '/mo', features: ['Everything in Starter', 'Unlimited use', 'Priority help'], featured: true }, { name: 'Team', price: '$49', period: '/mo', features: ['Everything in Pro', 'Up to 10 seats'] }] }),
    S(4, 'timeline', { eyebrow: 'Roadmap', title: 'The next *18 months*', items: [{ date: 'Now', title: 'Core product', text: 'Live with early customers.' }, { date: '+6 months', title: 'Expand', text: 'The most requested features.' }, { date: '+12 months', title: 'Scale', text: 'New markets and partners.' }, { date: '+18 months', title: 'Series A', text: 'Ready for the next round.' }] }),
    S(3, 'team', { eyebrow: 'Team', title: `The people behind *${N}*`, items: (f.people || ['Founder Name', 'Co-founder Name', 'Lead Engineer']).slice(0, 4).map((n, i) => ({ name: n, role: ['CEO', 'CTO', 'Design', 'Growth'][i], image: { src: '', alt: n, prompt: '' } })) }),
    S(4, 'quote', { quote: 'Placeholder: one sentence from a customer about the problem you solve, with their permission.', name: 'Customer name', role: 'Title, Company' }),
    S(1, 'bignumber', { variant: 'center', tone: 'accent', eyebrow: 'The ask', value: f.ask || '$2M', label: f.ask ? `${f.round ? cap(f.round) : 'Round'} to reach the next milestone` : 'Example round size. Replace it with your ask.', items: [{ value: '40%', label: 'Product' }, { value: '35%', label: 'Growth' }, { value: '25%', label: 'Operations' }] }),
    S(1, 'closing', { eyebrow: 'Thank you', title: `Let’s build *${N}* together.`, subtitle: 'Questions, intros and term sheets welcome.', cta: f.email || 'Get in touch', contact: f.url || f.email || 'you@company.com' }),
  ];
}

function launchPlan(f, seed) {
  const N = f.name || 'Your product';
  const what = f.what ? cap(f.what) : 'Something new, made for people like you';
  const feats = f.features && f.features.length >= 2 ? f.features : ['Fast to set up', 'Beautifully simple', 'Built to last'];
  const when = f.date || (f.year ? `in ${f.year}` : 'soon');
  return [
    S(1, 'title', { variant: 'full', eyebrow: 'Introducing', title: N, subtitle: `${what}.`, meta: f.date ? `Available ${f.date}` : 'Launching soon', image: photo('launch', seed, `${what}, hero product photograph, cinematic light`) }),
    S(1, 'statement', { variant: 'center', eyebrow: 'Why now', title: f.outcome ? `Everyone deserves *${f.outcome}.*` : 'It should not be this *hard.*', subtitle: 'One line on what changed, and why today is the day.' }),
    S(1, 'imagetext', { variant: 'left', eyebrow: `Meet ${N}`, title: emphasize(f.does ? cap(f.does) : what, 2), text: `${N} ${f.does || 'does the one thing you need, really well'}. Tell people how it feels to use it.`, items: feats.slice(0, 3).map((t) => ({ text: cap(t) })), image: photo('launch', seed + 1, `${what}, close-up product detail, studio light`) }),
    S(1, 'twocol', { eyebrow: 'Features', title: `What makes *${N}* different`, items: feats.slice(0, 3).concat(['Made with care']).slice(0, 3).map((t, i) => ({ title: cap(t), text: ['The moment you notice it, you will not want to go back.', 'Less setup, fewer settings, more doing.', 'Designed for real life, not a demo.'][i] })) }),
    S(2, 'bignumber', { eyebrow: f.stats.length ? 'So far' : 'Early access', value: f.stats[0]?.value || '10,000', label: f.stats[0]?.label || 'people on the waitlist (example)', items: f.stats.slice(1, 3) }),
    S(3, 'quote', { quote: 'Placeholder: a sentence from an early customer, with their permission.', name: 'Customer name', role: 'Early tester' }),
    S(3, 'gallery', { eyebrow: 'In the wild', title: `${N}, *up close*`, items: [0, 1, 2].map((i) => ({ image: photo('launch', seed + i + 2, `${what}, lifestyle photograph ${i + 1}`), caption: ['Detail', 'In use', 'Everywhere'][i] })) }),
    S(2, 'pricing', { eyebrow: 'Pricing', title: 'Simple, *honest pricing*', items: f.price ? [{ name: N, price: f.price, period: f.period || '', features: feats.slice(0, 3).map(cap), featured: true }] : [{ name: 'Free', price: '$0', period: '/mo', features: ['The essentials'] }, { name: 'Plus', price: '$5', period: '/mo', features: ['Everything, unlimited'], featured: true }] }),
    S(4, 'timeline', { eyebrow: 'Launch plan', title: `The road to *${when}*`, items: [{ date: 'Now', title: 'Waitlist', text: 'Build the list.' }, { date: 'Beta', title: 'Early access', text: 'Learn from the first users.' }, { date: f.date || 'Launch', title: 'Public launch', text: 'Open to everyone.' }, { date: 'After', title: 'Grow', text: 'New features every month.' }] }),
    S(4, 'chart', { variant: 'side', eyebrow: 'Momentum', title: 'Sign-ups, *week by week*', text: 'Example data. Edit the numbers in the Slide panel.', chart: { type: 'line', labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'], series: [{ name: 'Sign-ups', values: [800, 1500, 2600, 4100, 6300, 9200] }], prefix: '', suffix: '' } }),
    S(4, 'team', { eyebrow: 'Team', title: `Made by the *${N}* team`, items: (f.people || ['Founder Name', 'Designer Name', 'Engineer Name']).slice(0, 4).map((n, i) => ({ name: n, role: ['Founder', 'Design', 'Engineering', 'Growth'][i], image: { src: '', alt: n, prompt: '' } })) }),
    S(1, 'closing', { eyebrow: f.date ? `Available ${f.date}` : 'Coming soon', title: `Say hello to *${N}.*`, subtitle: 'Be first in line.', cta: 'Join the waitlist', contact: f.url || f.email || 'yourproduct.com' }),
  ];
}

function salesPlan(f, seed) {
  const N = f.name || 'Our company';
  const P = f.prospect && f.prospect !== f.name ? f.prospect : 'your team';
  const offer = f.offer || (f.after && !/\d{2,}/.test(f.after.split(',')[0]) ? f.after.split(',')[0] : f.after ? f.after.split(',')[0] : null) || (f.what ? lc(f.what.replace(/^(?:a|an|the)\s+/i, '')) : 'a better way to get this done');
  const feats = f.features && f.features.length >= 2 ? f.features : ['A dedicated team', 'One clear schedule', 'Reporting you can share'];
  return [
    S(1, 'title', { variant: 'split', eyebrow: P !== 'your team' ? `Proposal for ${P}` : 'Proposal', title: emphasize(cap(offer), 2), subtitle: `How ${N} can help ${P} ${f.outcome ? `get ${f.outcome}` : 'save time and money'}.`, meta: `${N} · ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`, image: photo('sales', seed, `${offer}, professional editorial photograph`) }),
    S(2, 'agenda', { eyebrow: 'Today', title: 'What we will cover', items: [{ title: 'What we heard', text: 'Your goals' }, { title: 'Our approach', text: 'How we work' }, { title: 'Results', text: 'What clients saw' }, { title: 'Investment', text: 'Options and pricing' }, { title: 'Next steps', text: 'How to start' }] }),
    S(1, 'statement', { tone: 'alt', eyebrow: 'What we heard', title: `${cap(P)} wants results *without the overhead.*`, subtitle: 'Write their goal in their own words.', notes: 'Use a quote from your discovery call here.' }),
    S(1, 'imagetext', { eyebrow: 'Our approach', title: `How *${N}* works`, text: `${N} provides ${offer}. One team, one plan and one person to call.`, items: feats.slice(0, 3).map((t) => ({ text: cap(t) })), image: photo('sales', seed + 1, `${offer}, team at work, natural light`) }),
    S(2, 'twocol', { eyebrow: 'What you get', title: 'Everything, *handled*', items: feats.slice(0, 3).map((t, i) => ({ title: cap(t), text: ['So nothing falls through the cracks.', 'So you always know what happens next.', 'So you can prove the value internally.'][i] })) }),
    S(1, 'bignumber', { eyebrow: 'Results', value: f.stats[0]?.value || '30%', label: f.stats[0]?.label || 'average savings in year one (example)', items: f.stats.slice(1, 4), notes: f.stats.length ? '' : 'Replace with a real client result.' }),
    S(3, 'chart', { variant: 'side', eyebrow: 'Proof', title: 'Before and *after*', text: 'Example data. Edit the numbers in the Slide panel.', chart: { type: 'line', labels: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'], series: [{ name: `With ${N}`, values: [40, 52, 63, 71, 78, 84] }, { name: 'Before', values: [40, 41, 39, 42, 40, 41] }], prefix: '', suffix: '' } }),
    S(3, 'quote', { tone: 'ink', quote: 'Placeholder: a short quote from a happy client, with their permission.', name: 'Client name', role: 'Title, Company' }),
    S(2, 'pricing', { eyebrow: 'Investment', title: 'Three ways to *start*', items: [{ name: 'Essentials', price: f.price || '$—', period: f.period || '/mo', features: [cap(feats[0])] }, { name: 'Recommended', price: '$—', period: '/mo', features: feats.slice(0, 3).map(cap), featured: true }, { name: 'Complete', price: '$—', period: '/mo', features: ['Everything, plus reporting'] }], note: 'Fill in prices for this client.' }),
    S(4, 'timeline', { eyebrow: 'Onboarding', title: 'Your first *90 days*', items: [{ date: 'Week 1', title: 'Kickoff', text: 'Meet the team, agree goals.' }, { date: 'Week 2', title: 'Set up', text: 'Plan, schedule and access.' }, { date: 'Month 1', title: 'First results', text: 'A report you can share.' }, { date: 'Day 90', title: 'Review', text: 'What worked, what is next.' }] }),
    S(4, 'team', { eyebrow: 'Your team', title: 'Who you will *work with*', items: (f.people || ['Account Lead', 'Project Manager', 'Specialist']).slice(0, 4).map((n, i) => ({ name: n, role: ['Your main contact', 'Runs the day to day', 'Does the work', 'Support'][i], image: { src: '', alt: n, prompt: '' } })) }),
    S(1, 'closing', { eyebrow: 'Next steps', title: 'Let’s get *started.*', subtitle: 'A short call to agree scope, then a fixed quote within a week.', cta: 'Book a call', contact: f.email || f.url || 'you@company.com' }),
  ];
}

function reportPlan(f, seed) {
  const N = f.name || 'Our team';
  const period = f.quarter || (f.year ? `${f.year}` : 'This quarter');
  const st = f.stats.length ? f.stats : [{ value: '$480k', label: 'revenue (example)' }, { value: '18%', label: 'growth (example)' }, { value: '40%', label: 'margin (example)' }];
  return [
    S(1, 'title', { variant: 'plain', eyebrow: f.quarter ? 'Quarterly report' : 'Report', title: `${period} *in review*`, subtitle: `${N}: what happened, what we learned and what comes next.`, meta: `${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}` }),
    S(2, 'agenda', { eyebrow: 'Contents', title: 'In this report', items: [{ title: 'Headline numbers', text: '' }, { title: 'Trends', text: '' }, { title: 'Highlights', text: '' }, { title: 'Lessons', text: '' }, { title: 'Next priorities', text: '' }] }),
    S(1, 'bignumber', { eyebrow: 'Headline', value: st[0].value, label: st[0].label, items: st.slice(1, 4), notes: f.stats.length ? '' : 'Example figures. Replace with your numbers.' }),
    S(1, 'chart', { variant: 'wide', eyebrow: 'Trend', title: 'The numbers, *month by month*', text: 'Example data. Edit the numbers in the Slide panel.', chart: { type: 'bar', labels: ['Month 1', 'Month 2', 'Month 3'], series: [{ name: 'Last period', values: [120, 135, 140] }, { name: 'This period', values: [140, 162, 178] }], prefix: '', suffix: '' } }),
    S(2, 'twocol', { variant: 'plain', eyebrow: 'Highlights', title: 'What *went well*', items: [{ title: 'Win one', text: 'The single result you are proudest of.' }, { title: 'Win two', text: 'A second result, with a number.' }, { title: 'Win three', text: 'Something the team learned to do.' }] }),
    S(3, 'imagetext', { variant: 'left', eyebrow: 'Spotlight', title: 'One project, *up close*', text: 'Tell the story behind one result: who did it, what changed and why it matters.', items: [], image: photo('report', seed, `${N}, documentary editorial photograph`) }),
    S(3, 'chart', { variant: 'side', eyebrow: 'Efficiency', title: 'Trending the *right way*', text: 'Example data.', chart: { type: 'line', labels: ['M1', 'M2', 'M3', 'M4', 'M5', 'M6'], series: [{ name: 'Score', values: [52, 55, 61, 64, 70, 73] }], prefix: '', suffix: '%' } }),
    S(2, 'statement', { tone: 'ink', eyebrow: 'What we learned', title: 'Write the *one lesson* you want everyone to remember.' }),
    S(4, 'quote', { quote: 'Placeholder: a line from a customer, partner or team member that captures the period.', name: 'Name', role: 'Role' }),
    S(4, 'gallery', { eyebrow: 'Moments', title: 'The period *in pictures*', items: [0, 1, 2].map((i) => ({ image: photo('report', seed + i + 1, `${N}, team at work, documentary photograph ${i + 1}`), caption: ['Caption', 'Caption', 'Caption'][i] })) }),
    S(1, 'timeline', { variant: 'steps', eyebrow: 'Next', title: 'Priorities for *next period*', items: [{ date: '1', title: 'Priority one', text: 'What and by when.' }, { date: '2', title: 'Priority two', text: 'What and by when.' }, { date: '3', title: 'Priority three', text: 'What and by when.' }] }),
    S(1, 'closing', { eyebrow: 'Thank you', title: 'Questions?', subtitle: 'Details and the full numbers are in the appendix.', cta: 'Open discussion', contact: f.email || '' }),
  ];
}

function portfolioPlan(f, seed) {
  const N = f.person || f.name || 'Your Name';
  const R = f.role || (f.what ? f.what.replace(/^(?:a|an)\s+/i, '').split(/\s+(?:in|who|that)\b/)[0] : 'designer');
  const work = f.does || (f.what && f.what.match(/\bwho\s+(.+)/i)?.[1]) || 'makes thoughtful work for people who care about details';
  const feats = f.features && f.features.length >= 2 ? f.features : ['Identity', 'Product', 'Editorial'];
  return [
    S(1, 'title', { variant: 'split', eyebrow: `Portfolio ${f.year || new Date().getFullYear()}`, title: `${N}, *${R}*`, subtitle: `${cap(work.replace(/^who\s+/i, ''))}${f.place ? `, in ${f.place}` : ''}.`, meta: f.url || f.email || 'yourname.com', image: photo('portfolio', seed, `${R} studio, work in progress, editorial photograph`) }),
    S(1, 'statement', { variant: 'center', eyebrow: 'Approach', title: 'Good work starts by *listening.*', subtitle: 'One sentence on how you work and why it is different.' }),
    S(1, 'gallery', { eyebrow: 'Selected work', title: 'Recent projects', items: [0, 1, 2, 3, 4, 5].map((i) => ({ image: photo('portfolio', seed + i, `${R} portfolio piece ${i + 1}, ${work}`), caption: `Project ${i + 1}` })) }),
    S(1, 'imagetext', { eyebrow: 'Case study', title: 'Project name, *the short story*', text: 'The brief, what you did, and what changed for the client. Three sentences is plenty.', items: [{ text: 'Role: what you owned' }, { text: 'Result: one number' }], image: photo('portfolio', seed + 2, `${R} case study hero image`) }),
    S(3, 'imagetext', { variant: 'left', eyebrow: 'Case study', title: 'A second project, *in brief*', text: 'Pick something different from the first: another client, scale or medium.', items: [], image: photo('portfolio', seed + 3, `${R} second case study image`) }),
    S(2, 'twocol', { eyebrow: 'Services', title: 'What I *do*', items: feats.slice(0, 3).map((t) => ({ title: cap(t), text: 'One line on what this includes.' })) }),
    S(3, 'bignumber', { eyebrow: 'In numbers', value: f.stats[0]?.value || '120+', label: f.stats[0]?.label || 'projects delivered (example)', items: f.stats.slice(1, 3) }),
    S(2, 'quote', { quote: 'Placeholder: a sentence from a client about working with you, with their permission.', name: 'Client name', role: 'Title, Company' }),
    S(4, 'timeline', { eyebrow: 'Experience', title: 'Where I have *worked*', items: [{ date: '2016', title: 'Studio', text: 'Where you started.' }, { date: '2019', title: 'Company', text: 'What you led.' }, { date: '2022', title: 'Independent', text: 'Your own practice.' }, { date: 'Now', title: 'Next', text: 'What you are looking for.' }] }),
    S(4, 'agenda', { eyebrow: 'Process', title: 'How I *work*', items: [{ title: 'Listen', text: 'A call to understand the problem' }, { title: 'Explore', text: 'Sketches and directions to react to' }, { title: 'Make', text: 'Design, test and refine' }, { title: 'Deliver', text: 'Files, guidelines and a handover' }] }),
    S(4, 'statement', { tone: 'ink', eyebrow: 'Currently', title: 'Booking projects for *next quarter.*', subtitle: 'Say what kind of work you want more of.' }),
    S(1, 'closing', { variant: 'split', eyebrow: 'Available for new projects', title: 'Let’s make something *together.*', subtitle: 'Tell me about your project.', cta: f.email || 'hello@yourname.com', contact: f.place || f.url || '', image: photo('portfolio', seed + 4, `${R} portrait in studio`) }),
  ];
}

function eventPlan(f, seed) {
  const N = f.name || 'Your Event';
  const what = f.what ? cap(f.what) : 'A day worth clearing your calendar for';
  const where = [f.venue, f.place].filter(Boolean).join(', ');
  const st = f.stats[0];
  return [
    S(1, 'title', { variant: 'full', eyebrow: [f.date, f.place].filter(Boolean).join(' · ') || 'Save the date', title: N, subtitle: `${what}.`, meta: f.venue || 'Venue', image: photo('event', seed, `${what}, atmospheric event photograph`) }),
    S(2, 'bignumber', { variant: 'center', eyebrow: 'At a glance', value: st?.value || '500', label: st?.label || 'people, one unforgettable day (example)' }),
    S(1, 'statement', { eyebrow: 'Why come', title: 'Meet the people *doing the work.*', subtitle: 'One sentence on what attendees take home.' }),
    S(1, 'agenda', { eyebrow: 'Programme', title: 'What’s on', items: (f.features && f.features.length >= 2 ? f.features : ['Keynotes', 'Workshops', 'Panels', 'Evening party']).slice(0, 5).map((t) => ({ title: cap(t), text: '' })) }),
    S(2, 'team', { eyebrow: 'Speakers', title: 'On stage', items: (f.people || ['Speaker Name', 'Speaker Name', 'Speaker Name', 'Speaker Name']).slice(0, 4).map((n) => ({ name: n, role: 'Title, Company', image: { src: '', alt: n, prompt: '' } })) }),
    S(2, 'timeline', { eyebrow: 'Schedule', title: `${f.date ? f.date.replace(/,?\s*\d{4}$/, '') : 'The day'} *at a glance*`, items: [{ date: '9:00', title: 'Doors', text: 'Coffee and check-in.' }, { date: '10:00', title: 'Opening', text: 'Welcome and keynote.' }, { date: '13:00', title: 'Sessions', text: 'Talks and workshops.' }, { date: '18:00', title: 'Party', text: 'Food, music, people.' }] }),
    S(1, 'imagetext', { eyebrow: 'Venue', title: f.venue ? `${f.venue}` : 'The *venue*', text: `${where ? `${where}. ` : ''}How to get there, where to stay and what is nearby.`, items: [{ text: 'Step-free access' }, { text: 'Hotels nearby' }], image: photo('event', seed + 1, `${f.venue || 'event venue'} interior, warm light`) }),
    S(1, 'pricing', { eyebrow: 'Tickets', title: 'Get your *ticket*', items: [{ name: 'Early bird', price: f.price ? f.price : '$99', period: f.period || 'per person', features: ['Full access', 'Limited number'] }, { name: 'Standard', price: f.price || '$149', period: f.period || 'per person', features: ['Full access', 'Food and drinks'], featured: true }, { name: 'Group', price: '−15%', period: '5 or more', features: ['Bring your team'] }] }),
    S(3, 'gallery', { eyebrow: 'Last time', title: 'In pictures', items: [0, 1, 2].map((i) => ({ image: photo('event', seed + i + 1, `${what}, crowd and atmosphere ${i + 1}`), caption: ['The stage', 'The people', 'The party'][i] })) }),
    S(4, 'quote', { quote: 'Placeholder: a line from last year’s attendee, with their permission.', name: 'Attendee name', role: 'Role, Company' }),
    S(4, 'statement', { tone: 'ink', eyebrow: 'Everyone welcome', title: 'A code of conduct, *enforced.*', subtitle: 'Step-free access, captions and a quiet room.' }),
    S(1, 'closing', { tone: 'accent', eyebrow: 'Tickets on sale', title: f.date ? `See you on *${f.date.replace(/,?\s*\d{4}$/, '')}.*` : 'See you *there.*', subtitle: where || 'Grab a ticket before they are gone.', cta: f.url || 'Get tickets', contact: f.email || '' }),
  ];
}

function lessonPlan(f, seed) {
  const T = f.topic ? cap(f.topic) : f.name || 'Today’s topic';
  const who = f.grade ? `Grade ${f.grade}` : f.audience ? cap(f.audience) : 'Class';
  const pts = f.features && f.features.length >= 2 ? f.features : [];
  const goals = (pts.length >= 2 ? pts : ['Explain the key idea', 'Use the new words', 'Apply it to a real example']).slice(0, 4);
  const sub = f.after ? `${cap(f.after)}.` : f.does ? `${cap(f.does)}.` : 'Key ideas, real examples and a hands-on activity.';
  const titleT = T.includes(' ') ? T.replace(/(\S+)$/, '*$1*') : `*${T}*`;
  return [
    S(1, 'title', { variant: 'split', eyebrow: `${who} · ${/workshop/i.test(f.raw) ? 'Workshop' : 'Lesson'}`, title: titleT, subtitle: sub, meta: '45 minutes', image: photo('lesson', seed, `${T}, educational illustration photograph, bright and clear`) }),
    S(1, 'agenda', { eyebrow: 'Today', title: 'By the end of class you can', items: goals.map((g) => ({ title: cap(g), text: '' })) }),
    S(1, 'statement', { variant: 'center', eyebrow: 'Big idea', title: `${T} is *everywhere,* once you know where to look.`, subtitle: 'Start with a question the class can answer from experience.' }),
    S(1, 'imagetext', { eyebrow: 'Key concept', title: `What is *${lc(T)}?*`, text: 'Define it in one or two sentences a student could repeat to a friend.', items: [{ text: 'A simple example' }, { text: 'A common mistake' }], image: photo('lesson', seed + 1, `${T}, clear explanatory photograph`) }),
    S(1, 'timeline', { variant: 'steps', eyebrow: 'Step by step', title: pts.length >= 3 ? 'Part by *part*' : 'How it *works*', items: (pts.length >= 3 ? pts : ['First', 'Then', 'Next', 'Finally']).slice(0, 4).map((t, i) => ({ date: String(i + 1), title: cap(t), text: 'One sentence to explain it.' })) }),
    S(3, 'bignumber', { eyebrow: 'Did you know', value: f.stats[0]?.value || '1 in 3', label: f.stats[0]?.label || 'a surprising fact about the topic (example)' }),
    S(3, 'chart', { variant: 'side', eyebrow: 'Data', title: 'Read the *chart*', text: 'Ask: what is the biggest bar, and why?', chart: { type: 'bar', labels: ['A', 'B', 'C', 'D'], series: [{ name: 'Value', values: [30, 55, 40, 70] }], prefix: '', suffix: '' } }),
    S(2, 'twocol', { eyebrow: 'Compare', title: 'Two ideas, *side by side*', items: [{ title: 'Idea one', text: 'What it is, in a sentence.' }, { title: 'Idea two', text: 'How it differs.' }] }),
    S(2, 'agenda', { variant: 'plain', tone: 'alt', eyebrow: 'Activity', title: 'Try it *yourself*', items: [{ title: 'Read the prompt', text: '2 minutes' }, { title: 'Work in pairs', text: '10 minutes' }, { title: 'Share one answer', text: '5 minutes' }] }),
    S(4, 'gallery', { eyebrow: 'Look closer', title: 'Spot it *in the world*', items: [0, 1, 2].map((i) => ({ image: photo('lesson', seed + i + 2, `${T}, real-world example photograph ${i + 1}`), caption: ['Example one', 'Example two', 'Example three'][i] })) }),
    S(4, 'quote', { quote: 'Placeholder: a line from a scientist, writer or student that sums up the lesson.', name: 'Name', role: 'Who they are' }),
    S(1, 'closing', { eyebrow: 'Exit ticket', title: `One thing you learned about *${lc(T)}.*`, subtitle: 'Write it down before you leave.', cta: 'Questions?', contact: 'Next lesson: …' }),
  ];
}

const PLANS = { pitch: pitchPlan, launch: launchPlan, sales: salesPlan, report: reportPlan, portfolio: portfolioPlan, event: eventPlan, lesson: lessonPlan };

/** Keep the most important slides, in plan order. Title and closing always stay. */
export function choose(plan, count) {
  const n = Math.max(8, Math.min(12, count || 10));
  if (plan.length <= n) return plan;
  const keep = new Set(plan.map((s, i) => [s.prio, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, n).map(([, i]) => i));
  return plan.filter((_, i) => keep.has(i));
}

/** Description -> deck. opts: { kind, theme, count (8-12) } */
export function writeDeck(prompt = '', opts = {}) {
  const text = String(prompt || '').trim() || KINDS[opts.kind || 'pitch'].example;
  const kind = KINDS[opts.kind] ? opts.kind : detectKind(text);
  const f = readBrief(text);
  const seed = hash(text);
  const plan = choose(PLANS[kind](f, seed), opts.count || 10);
  const theme = THEME_IDS.includes(opts.theme) ? opts.theme : pickTheme(text, kind);
  const title = f.name || f.topic || f.person || KINDS[kind].name;
  return sanitizeDeck({
    title: `${title}${kind === 'pitch' && f.name ? ' pitch' : kind === 'report' && f.quarter ? ` ${f.quarter}` : ''}`,
    kind, theme, transition: KINDS[kind].transition,
    slides: plan.map(({ prio, ...s }) => s),
  });
}
