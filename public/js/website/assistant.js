import { SECTIONS } from './spec.js';

// A bounded editing contract shared by the browser and Worker. Never accepts code, URLs,
// account data or arbitrary object paths from a model.
export const NEMOTRON_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
const OMIT = new Set(['testimonials', 'stats', 'pricing', 'team', 'logos', 'schedule', 'menu', 'listing']);
export function editableFields(site, pageId) {
  const fields = [];
  const add = (path, label, value, maxLength = 140, choices) => {
    if (typeof value === 'string' && fields.length < 50) fields.push({ path, label, value: value.slice(0, maxLength), maxLength, ...(choices ? { choices } : {}) });
  };
  add('name', 'Site name', site.name, 80); add('tagline', 'Site tagline', site.tagline, 140);
  add('theme.accent', 'Brand colour (#rrggbb)', site.theme.accent, 7);
  const pi = Math.max(0, site.pages.findIndex(p => p.id === pageId));
  const page = site.pages[pi];
  add(`pages.${pi}.seo.title`, 'Page search title', page.seo?.title || '', 70);
  add(`pages.${pi}.seo.description`, 'Page search description', page.seo?.description || '', 170);
  function walk(def, data, base, label) {
    for (const [key, type] of Object.entries(def)) {
      if (['text', 'para'].includes(type)) add(`${base}.${key}`, `${label}: ${key}`, data?.[key], type === 'para' ? 600 : key === 'eyebrow' ? 60 : 140);
      else if (type === 'link') add(`${base}.${key}.label`, `${label}: button`, data?.[key]?.label, 40);
      else if (type?.item && Array.isArray(data?.[key])) data[key].slice(0, 6).forEach((item, i) => walk(type.item, item, `${base}.${key}.${i}`, label));
    }
  }
  page.sections.forEach((section, si) => {
    if (OMIT.has(section.type)) return;
    const def = SECTIONS[section.type]; if (!def) return;
    const base = `pages.${pi}.sections.${si}`;
    // These three layouts work with a single image and preserve existing section content.
    if (section.type === 'hero' && ['split', 'centered', 'cover'].includes(section.variant)) add(`${base}.variant`, 'Hero layout', section.variant, 20, ['split', 'centered', 'cover']);
    walk(def.fields, section, base, def.name);
  });
  return fields;
}

export function validateFields(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 50) throw new Error('Choose a page with editable text.');
  const seen = new Set();
  return raw.map(f => {
    if (!f || typeof f.path !== 'string' || !/^(name|tagline|theme\.accent|pages\.[0-4]\.(seo\.(title|description)|sections\.\d{1,2}\.[a-zA-Z][a-zA-Z0-9]*(\.(\d|label|[a-zA-Z][a-zA-Z0-9]*)){0,3}))$/.test(f.path) || /__proto__|constructor|prototype/.test(f.path) || seen.has(f.path)) throw new Error('Invalid editable field.');
    if (typeof f.value !== 'string' || f.value.length > 600 || typeof f.label !== 'string' || f.label.length > 100 || !Number.isInteger(f.maxLength) || f.maxLength < 1 || f.maxLength > 600) throw new Error('Invalid field content.');
    if (f.choices && (!Array.isArray(f.choices) || f.choices.length > 10 || f.choices.some(c => typeof c !== 'string' || c.length > 30))) throw new Error('Invalid field options.');
    seen.add(f.path);
    return { path: f.path, label: f.label, value: f.value, maxLength: f.maxLength, ...(f.choices ? { choices: f.choices } : {}) };
  });
}

export function validateProposal(raw, fields) {
  if (!raw || typeof raw.summary !== 'string' || !Array.isArray(raw.changes) || raw.changes.length > 50) throw new Error('The assistant returned an incomplete draft. Try a shorter request.');
  const allowed = new Map(fields.map(f => [f.path, f])), used = new Set();
  const changes = raw.changes.map(c => {
    const f = allowed.get(c?.path);
    if (!f || used.has(c.path) || typeof c.value !== 'string' || c.value.length > f.maxLength || /[<>\u0000-\u0008]/.test(c.value) || (f.choices && !f.choices.includes(c.value)) || (c.path === 'theme.accent' && !/^#[0-9a-f]{6}$/i.test(c.value))) throw new Error('The assistant suggested an unsupported edit. Your site has not changed.');
    used.add(c.path); return { path: c.path, value: c.value };
  }).filter(c => c.value !== allowed.get(c.path).value);
  return { summary: raw.summary.slice(0, 400), changes };
}

export function applyProposal(site, proposal, fields) {
  const safe = validateProposal(proposal, fields);
  for (const c of safe.changes) {
    const parts = c.path.split('.'), key = parts.pop(); let holder = site;
    for (const part of parts) { if (!Object.hasOwn(holder, part)) throw new Error('This page changed. Ask for a fresh draft.'); holder = holder[part]; }
    if (!Object.hasOwn(holder, key)) throw new Error('This page changed. Ask for a fresh draft.');
    holder[key] = c.value;
  }
  return site;
}
