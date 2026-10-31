// Field types for Massless Sign. Sizes are in PDF points (1/72 inch) at page scale 1.

export const FIELD_TYPES = {
  signature: { label: 'Signature', short: 'Sign', w: 180, h: 38, required: true, icon: '<path d="M2 11.5c1.5-1 2.8-5 4.3-5S6 11 7.5 11s1.9-2.6 3-2.6.6 1.8 1.6 1.8 1.4-.8 1.9-1.3M2 14h12"/>' },
  initials: { label: 'Initials', short: 'Initial', w: 64, h: 32, required: true, icon: '<path d="M3 3.5v9M6.5 12.5V3.5l3 5 3-5v9"/>' },
  date: { label: 'Date signed', short: 'Date', w: 112, h: 18, required: true, auto: true, icon: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/>' },
  name: { label: 'Name', short: 'Name', w: 170, h: 18, required: true, icon: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.8-2.6 2.7-4 5-4s4.2 1.4 5 4"/>' },
  text: { label: 'Text', short: 'Text', w: 160, h: 18, required: true, icon: '<path d="M3 3.5h10M8 3.5v9.5M6 13h4"/>' },
  checkbox: { label: 'Checkbox', short: 'Check', w: 12, h: 12, required: false, icon: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M5 8.2l2 2 4-4.4"/>' },
  dropdown: { label: 'Dropdown', short: 'Choose', w: 140, h: 18, required: true, icon: '<rect x="2" y="4" width="12" height="8" rx="1.5"/><path d="M9.5 7.2L11 8.8l1.5-1.6"/>' },
  attachment: { label: 'Attachment', short: 'Attach', w: 150, h: 22, required: true, icon: '<path d="M10.5 5L6 9.5a1.5 1.5 0 002.1 2.1l5-5a3 3 0 00-4.2-4.2l-5 5a4.5 4.5 0 006.4 6.4L13.5 10"/>' },
};
export const FIELD_ORDER = ['signature', 'initials', 'date', 'name', 'text', 'checkbox', 'dropdown', 'attachment'];

/** Template markers: [[sig:role]] [[initial:role]] [[date:role]] [[name:role]] [[text:role:Label]] [[check:role:Label]]. */
export const MARKER_TYPES = { sig: 'signature', signature: 'signature', initial: 'initials', initials: 'initials', date: 'date', name: 'name', text: 'text', check: 'checkbox', checkbox: 'checkbox', select: 'dropdown', dropdown: 'dropdown', attach: 'attachment', attachment: 'attachment' };

// One color per signer, readable on a white page and on the dark UI.
export const ROLE_COLORS = ['#f5a524', '#3b82f6', '#10b981', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#e11d48', '#64748b'];
export const roleColor = (i) => ROLE_COLORS[((i % ROLE_COLORS.length) + ROLE_COLORS.length) % ROLE_COLORS.length];

export function fieldCaption(f, roleLabel) {
  if (f.type === 'signature') return `Signature${roleLabel ? ` · ${roleLabel}` : ''}`;
  if (f.type === 'initials') return `Initials${roleLabel ? ` · ${roleLabel}` : ''}`;
  if (f.type === 'date') return 'Date';
  if (f.type === 'name') return 'Printed name';
  return f.label || FIELD_TYPES[f.type]?.label || 'Field';
}

/** Date the way it is written into the PDF: "October 30, 2026". */
export function longDate(d = new Date()) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
export function localLongDate(d = new Date()) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}
