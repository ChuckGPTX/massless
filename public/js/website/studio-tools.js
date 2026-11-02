import { sanitizeSite, checklist } from './spec.js';

export const TEMPLATE_CATEGORIES = {
  all: 'All designs', business: 'Get enquiries', creative: 'Show your work', launch: 'Launch something', event: 'Bring people together', shop: 'Show a collection', property: 'Show a property',
};
const GROUPS = { business: 'business', restaurant: 'business', portfolio: 'creative', cases: 'creative', band: 'creative', manifesto: 'creative', landing: 'launch', waitlist: 'launch', product: 'launch', launch: 'launch', event: 'event', shop: 'shop', realestate: 'property' };
export const templateCategory = (t) => GROUPS[t.kind] || 'business';
export function filterTemplates(list, { category = 'all', query = '' } = {}) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return list.filter(t => (category === 'all' || templateCategory(t) === category) && terms.every(term => `${t.title} ${t.description} ${t.kind} ${TEMPLATE_CATEGORIES[templateCategory(t)]}`.toLocaleLowerCase().includes(term)));
}

// Change only explicit brand fields; keep addresses, asset ids, URLs and placeholder flags intact.
export function personalizeSite(site, { name, description, email } = {}) {
  const copy = structuredClone(site);
  const nextName = String(name || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 70);
  if (!nextName) throw new Error('Add your business, project or artist name.');
  const old = copy.name;
  const skip = new Set(['id', 'slug', 'src', 'href', 'url', 'email', 'phone', 'form', 'prompt', 'anchor']);
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      if (skip.has(key)) continue;
      if (typeof value === 'string' && old) obj[key] = value.split(old).join(nextName);
      else if (value && typeof value === 'object') walk(value);
    }
  };
  walk(copy.pages); walk(copy.collections);
  copy.name = nextName;
  copy.tagline = copy.tagline.split(old).join(nextName);
  copy.seo.title = copy.seo.title.split(old).join(nextName).slice(0, 70);
  if (description !== undefined) {
    const text = String(description).trim().slice(0, 350);
    const hero = copy.pages[0]?.sections.find(s => s.type === 'hero');
    if (hero) hero.subtitle = text;
    copy.seo.description = text.slice(0, 170);
  }
  if (email !== undefined) {
    const value = String(email).trim();
    if (value && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)) throw new Error('Use a valid contact email address.');
    copy.contact.email = value;
  }
  return sanitizeSite(copy, copy, { source: 'user' });
}

export function launchReview(site) {
  const items = checklist(site).filter(x => !x.text.startsWith('Add your site address'));
  const hasContact = site.pages.some(p => p.sections.some(s => !s.hidden && ['contact', 'signup'].includes(s.type)));
  if (site.contact.form) items.push({ level: 'warn', text: 'Free subdomain hosting uses email forms. Remove the external form address in Settings before publishing.' });
  if (!hasContact && !site.contact.email && !site.contact.phone) items.push({ level: 'info', text: 'Add a contact method so visitors can reach you.' });
  let unfinished = 0;
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (typeof obj.label === 'string' && obj.label && 'href' in obj && (!obj.href || obj.href === '#')) unfinished++;
    for (const val of Object.values(obj)) if (val && typeof val === 'object') walk(val);
  };
  walk(site.nav);
  for (const p of site.pages) for (const s of p.sections) if (!s.hidden) walk(s);
  if (unfinished) items.push({ level: 'warn', text: `${unfinished} button${unfinished === 1 ? '' : 's'} still need${unfinished === 1 ? 's' : ''} a destination. Select the section to add a link.` });
  return items;
}
