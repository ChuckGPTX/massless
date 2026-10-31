// Contract templates for Massless Sign: load, fill and render to a PDF with pdf-lib and standard fonts.
// Template format: public/office/contracts/<id>.json, listed in public/office/contracts/index.json.
// Section bodies are markdown-lite: blank lines split paragraphs, a newline is a line break, "- " is a
// bullet, "1. " or "(a) " a numbered item, "## " a subheading, **bold** and *italic*. {{variable}} fills
// in a value, and [[sig:role]] [[initial:role]] [[date:role]] [[name:role]] [[text:role:Label]]
// [[check:role:Label]] become fields placed for that role.

import { FIELD_TYPES, MARKER_TYPES, fieldCaption } from './fields.js';

export const CATEGORIES = {
  business: 'Business', 'real-estate': 'Real estate', 'creative-finance': 'Creative finance',
  music: 'Music', 'joint-venture': 'Joint venture', everyday: 'Everyday',
};
export const CONTRACTS_BASE = '/office/contracts/';

export async function loadIndex(base = CONTRACTS_BASE) {
  const r = await fetch(`${base}index.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`The template library is not available (${r.status}).`);
  const list = await r.json();
  return (Array.isArray(list) ? list : []).filter((t) => t && t.id && t.title);
}
export async function loadTemplate(id, base = CONTRACTS_BASE) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new Error('That template name is not valid.');
  const r = await fetch(`${base}${id}.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Could not load the template "${id}" (${r.status}).`);
  return normalize(await r.json());
}

/** Fill gaps so the renderer and the form can trust the shape. */
export function normalize(t) {
  const tpl = { version: 1, roles: [], variables: [], sections: [], watchOuts: [], sources: [], ...t };
  tpl.roles = tpl.roles.filter((r) => r && r.id).map((r) => ({ id: String(r.id), label: String(r.label || r.id) }));
  tpl.variables = tpl.variables.filter((v) => v && v.id).map((v) => ({ type: 'text', label: v.id, required: false, default: '', options: [], ...v, id: String(v.id) }));
  tpl.sections = tpl.sections.filter((s) => s && (s.body || s.title)).map((s, i) => ({ id: String(s.id || `s${i + 1}`), title: String(s.title || ''), body: String(s.body || ''), optional: !!s.optional, showIf: s.showIf || '' }));
  // Markers may name roles the template forgot to list.
  const known = new Set(tpl.roles.map((r) => r.id));
  for (const s of tpl.sections) for (const m of s.body.matchAll(/\[\[([a-z]+):([A-Za-z0-9_-]+)/g)) {
    if (MARKER_TYPES[m[1]] && !known.has(m[2])) { known.add(m[2]); tpl.roles.push({ id: m[2], label: m[2] }); }
  }
  return tpl;
}

// ---------- values ----------
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function initialValues(tpl) {
  const v = {};
  for (const x of tpl.variables) {
    let d = x.default;
    if (x.type === 'bool') d = d === true || d === 'true';
    else if (x.type === 'date' && (d === 'today' || d === 'now')) d = todayIso();
    else if (x.type === 'select' && (d === '' || d == null) && x.options?.length && x.required) d = optValue(x.options[0]);
    else d = d == null ? '' : String(d);
    v[x.id] = d;
  }
  return v;
}
const optValue = (o) => (o && typeof o === 'object' ? String(o.value ?? o.label ?? '') : String(o));
const optLabel = (o) => (o && typeof o === 'object' ? String(o.label ?? o.value ?? '') : String(o));
export const options = (x) => (x.options || []).map((o) => ({ value: optValue(o), label: optLabel(o) }));

/** The variable that holds a role's name: one with role: <id>, or a party-type variable named after the role. */
export function roleVariable(tpl, roleId) {
  const vars = tpl.variables;
  return vars.find((v) => v.role === roleId)
    || vars.find((v) => v.type === 'party' && (v.id === roleId || v.id.startsWith(`${roleId}_`)))
    || vars.find((v) => v.type === 'party' && v.id.toLowerCase().replace(/[^a-z0-9]/g, '').includes(roleId.toLowerCase().replace(/[^a-z0-9]/g, '')));
}

function isEmpty(v) { return v === '' || v == null || (typeof v === 'string' && !v.trim()); }

export function formatValue(x, raw) {
  if (x?.type === 'bool') return raw === true || raw === 'true' ? 'Yes' : 'No';
  if (isEmpty(raw)) return '';
  const s = String(raw).trim();
  switch (x?.type) {
    case 'date': {
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return s;
      return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    }
    case 'money': {
      const n = Number(s.replace(/[$,\s]/g, ''));
      if (!Number.isFinite(n)) return s;
      return n.toLocaleString('en-US', { style: 'currency', currency: x.currency || 'USD' });
    }
    case 'percent': {
      const n = Number(s.replace(/[%\s]/g, ''));
      return Number.isFinite(n) ? `${n.toLocaleString('en-US', { maximumFractionDigits: 4 })}%` : s;
    }
    case 'number': {
      const n = Number(s.replace(/[,\s]/g, ''));
      return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 6 }) : s;
    }
    case 'select': {
      const o = options(x).find((p) => p.value === s);
      return o ? o.label : s;
    }
    case 'address': return s.split(/\n+/).map((l) => l.trim()).filter(Boolean).join(', ');
    default: return s;
  }
}

// ---------- showIf: a tiny, safe expression language (no eval) ----------
// Supports: name, !name, not name, ==, !=, >, <, >=, <=, &&, ||, and, or, ( ), 'strings', numbers, true/false.
export function evalCondition(expr, values) {
  const src = String(expr || '').trim();
  if (!src) return true;
  const toks = [];
  const re = /\s*(?:(&&|\|\||==|!=|>=|<=|[()!<>])|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?)|([A-Za-z_][\w.-]*))/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1]) toks.push({ op: m[1] });
    else if (m[2] !== undefined) toks.push({ v: m[2].replace(/\\(.)/g, '$1') });
    else if (m[3] !== undefined) toks.push({ v: m[3].replace(/\\(.)/g, '$1') });
    else if (m[4] !== undefined) toks.push({ v: Number(m[4]) });
    else {
      const w = m[5];
      const lw = w.toLowerCase();
      if (lw === 'and') toks.push({ op: '&&' });
      else if (lw === 'or') toks.push({ op: '||' });
      else if (lw === 'not') toks.push({ op: '!' });
      else if (lw === 'true' || lw === 'false') toks.push({ v: lw === 'true' });
      else toks.push({ id: w });
    }
    if (/^\s*$/.test(src.slice(re.lastIndex))) break;
  }
  let i = 0;
  const peek = () => toks[i];
  const val = (t) => (t.id !== undefined ? values[t.id] : t.v);
  const truthy = (v) => !(v === false || v === 'false' || v == null || v === '' || v === 0 || v === '0');
  const cmp = (a, b, op) => {
    const na = Number(a), nb = Number(b);
    const num = a !== '' && b !== '' && a != null && b != null && typeof a !== 'boolean' && typeof b !== 'boolean' && Number.isFinite(na) && Number.isFinite(nb);
    if (op === '==' || op === '!=') {
      let eq;
      if (typeof a === 'boolean' || typeof b === 'boolean') eq = truthy(a) === truthy(b);
      else eq = num ? na === nb : String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
      return op === '==' ? eq : !eq;
    }
    if (!num) return false;
    return op === '>' ? na > nb : op === '<' ? na < nb : op === '>=' ? na >= nb : na <= nb;
  };
  function atom() {
    const t = toks[i++];
    if (!t) throw new Error('unexpected end');
    if (t.op === '(') { const v = or(); if (toks[i++]?.op !== ')') throw new Error('missing )'); return v; }
    if (t.op === '!') return !truthy(atom());
    if (t.op) throw new Error(`unexpected ${t.op}`);
    const left = val(t);
    const n = peek();
    if (n && ['==', '!=', '>', '<', '>=', '<='].includes(n.op)) { i++; const r = toks[i++]; if (!r || r.op) throw new Error('bad comparison'); return cmp(left, val(r), n.op); }
    return left;
  }
  function and() { let v = truthy(atom()); while (peek()?.op === '&&') { i++; const r = truthy(atom()); v = v && r; } return v; }
  function or() { let v = and(); while (peek()?.op === '||') { i++; const r = and(); v = v || r; } return v; }
  try {
    const v = truthy(or());
    return i < toks.length ? true : v;
  } catch {
    return true; // a broken condition shows the section rather than silently dropping contract text
  }
}

export function visibleSections(tpl, values, omit = []) {
  const off = new Set(omit);
  return tpl.sections.filter((s) => !(s.optional && off.has(s.id)) && evalCondition(s.showIf, values));
}

/** Required variables the visible text uses (or that no section uses) and that are still empty. */
export function missingRequired(tpl, values, omit = []) {
  const used = new Set();
  for (const s of visibleSections(tpl, values, omit)) for (const m of `${s.title}\n${s.body}`.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) used.add(m[1]);
  const anyUse = new Set();
  for (const s of tpl.sections) for (const m of `${s.title}\n${s.body}`.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) anyUse.add(m[1]);
  return tpl.variables.filter((x) => x.required && x.type !== 'bool' && isEmpty(values[x.id]) && (used.has(x.id) || !anyUse.has(x.id)));
}

// ---------- markdown-lite ----------
export function blocks(body) {
  const out = [];
  const groups = String(body || '').replace(/\r/g, '').split(/\n[ \t]*\n+/);
  for (const g of groups) {
    let para = [];
    const flush = () => { if (para.length) { out.push({ kind: 'p', text: para.join('\n') }); para = []; } };
    for (const raw of g.split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) continue;
      let m;
      if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line) && !/^_+$/.test(line.trim())) { flush(); out.push({ kind: 'hr' }); }
      else if ((m = line.match(/^\s*#{1,6}\s+(.*)$/))) { flush(); out.push({ kind: 'h', text: m[1] }); }
      else if ((m = line.match(/^(\s*)[-*•]\s+(.*)$/))) { flush(); out.push({ kind: 'li', marker: '•', text: m[2], depth: m[1].length >= 2 ? 1 : 0 }); }
      else if ((m = line.match(/^(\s*)(\d{1,3}[.)]|\([a-zA-Z0-9]{1,4}\))\s+(.*)$/))) { flush(); out.push({ kind: 'li', marker: m[2], text: m[3], depth: m[1].length >= 2 ? 1 : 0 }); }
      else para.push(line.trim());
    }
    flush();
    out.push({ kind: 'gap' });
  }
  if (out.at(-1)?.kind === 'gap') out.pop();
  return out;
}

const INLINE = /(\[\[[^\]\n]{1,120}\]\])|(\{\{\s*[\w.-]+\s*\}\})|(\*\*)|(\*)/g;
/** Split text into styled pieces: { t: 'text', s, b, i, ph } | { t: 'marker', m } | { t: 'br' }. */
export function inline(text, ctx) {
  const pieces = [];
  let b = false, it = false, last = 0;
  const push = (s, extra = {}) => {
    const parts = String(s).split('\n');
    parts.forEach((p, k) => {
      if (k) pieces.push({ t: 'br' });
      if (p) pieces.push({ t: 'text', s: p, b, i: it, ...extra });
    });
  };
  for (const m of String(text).matchAll(INLINE)) {
    if (m.index > last) push(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      const inner = m[1].slice(2, -2).split(':');
      const type = MARKER_TYPES[inner[0].toLowerCase()];
      if (type) pieces.push({ t: 'marker', m: { type, role: inner[1] || '', label: inner.slice(2).join(':').trim(), raw: m[1] } });
      else push(m[1]);
    } else if (m[2]) {
      const id = m[2].replace(/[{}\s]/g, '');
      const x = ctx.vars.get(id);
      const val = x ? formatValue(x, ctx.values[id]) : '';
      if (val) push(x?.type === 'longtext' ? val : val.replace(/\n+/g, ' '), { ph: ctx.preview ? 'filled' : null });
      else if (ctx.preview) push(`[${x ? x.label : id}]`, { ph: 'empty' });
      else push('_______________', { ph: 'blank' });
    } else if (m[3]) b = !b;
    else if (m[4]) it = !it;
  }
  if (last < text.length) push(text.slice(last));
  return pieces;
}

// ---------- rendering ----------
const PAGE = { letter: [612, 792], a4: [595.28, 841.89] };
const INK = [0.09, 0.09, 0.11];
const SOFT = [0.42, 0.42, 0.46];
const RULE = [0.82, 0.82, 0.84];

const MARK_SIZE = {
  signature: { w: 196, h: 34 }, initials: { w: 64, h: 26 }, date: { w: 120, h: 16 }, name: { w: 196, h: 16 },
  text: { w: 170, h: 16 }, dropdown: { w: 150, h: 16 }, attachment: { w: 170, h: 16 }, checkbox: { w: 11, h: 11 },
};

/**
 * Render a template to PDF bytes. `lib` is pdf-lib. Returns { bytes, fields, pages, name }.
 * fields: [{ id, type, role, page, x, y, w, h, label, required, source: 'template' }] in view units
 * (top-left origin, points), ready for the field editor and the signer page.
 * opts: { preview, omit: [sectionId], parties: { roleId: name }, title }
 */
export async function renderTemplate(lib, tplIn, values, opts = {}) {
  const tpl = normalize(tplIn);
  const { PDFDocument, StandardFonts, rgb } = lib;
  const doc = await PDFDocument.create();
  const F = {
    r: await doc.embedFont(StandardFonts.TimesRoman), b: await doc.embedFont(StandardFonts.TimesRomanBold),
    i: await doc.embedFont(StandardFonts.TimesRomanItalic), bi: await doc.embedFont(StandardFonts.TimesRomanBoldItalic),
    s: await doc.embedFont(StandardFonts.Helvetica), sb: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const [PW, PH] = PAGE[opts.pageSize || (String(tpl.jurisdiction || 'US').toUpperCase().startsWith('US') ? 'letter' : 'a4')] || PAGE.letter;
  const ML = 72, MR = 72, MT = 66, MB = 72;
  const W = PW - ML - MR;
  const C = (c) => rgb(c[0], c[1], c[2]);
  const ctx = { vars: new Map(tpl.variables.map((x) => [x.id, x])), values: values || {}, preview: !!opts.preview };
  const roleLabel = (id) => tpl.roles.find((r) => r.id === id)?.label || id;
  const fields = [];
  const markerCount = new Map();
  let page, y;
  const pages = [];

  // WinAnsi-safe text: the standard fonts cannot draw every character.
  const memo = new Map();
  const safe = (font, s) => {
    let out = '';
    for (const ch of String(s).replace(/\t/g, ' ')) {
      const k = `${font === F.s || font === F.sb ? 's' : 't'}${ch}`;
      if (!memo.has(k)) { try { font.encodeText(ch); memo.set(k, ch); } catch { memo.set(k, { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ', '•': '-' }[ch] || '?'); } }
      out += memo.get(k);
    }
    return out;
  };
  const width = (font, size, s) => font.widthOfTextAtSize(safe(font, s), size);

  function newPage() {
    page = doc.addPage([PW, PH]);
    pages.push(page);
    y = PH - MT;
  }
  const ensure = (h) => { if (y - h < MB) newPage(); };
  newPage();

  // ----- title -----
  const title = opts.title || tpl.title || 'Agreement';
  const tSize = 20;
  for (const line of wrapPlain(F.sb, tSize, title, W)) { y -= tSize * 1.05; page.drawText(safe(F.sb, line), { x: ML, y, size: tSize, font: F.sb, color: C(INK) }); y -= 3; }
  y -= 8;
  const metaLine = [CATEGORIES[tpl.category] ? `${CATEGORIES[tpl.category]} agreement` : '', tpl.jurisdiction ? `Jurisdiction: ${tpl.jurisdiction}` : ''].filter(Boolean).join('   ·   ');
  if (metaLine) { y -= 8; page.drawText(safe(F.s, metaLine.toUpperCase()), { x: ML, y, size: 7, font: F.s, color: C(SOFT) }); }
  y -= 10;
  page.drawLine({ start: { x: ML, y }, end: { x: PW - MR, y }, thickness: 0.8, color: C(INK) });
  y -= 18;

  // ----- party block -----
  if (tpl.roles.length) {
    const cols = Math.min(tpl.roles.length, tpl.roles.length === 4 ? 2 : 3);
    const colW = (W - 20 - (cols - 1) * 16) / cols;
    const rowsN = Math.ceil(tpl.roles.length / cols);
    const cell = (r) => {
      const v = roleVariable(tpl, r.id);
      const name = (v && formatValue(v, ctx.values[v.id])) || (opts.parties && opts.parties[r.id]) || '';
      return { label: r.label, name, empty: !name, ph: v && ctx.preview ? (name ? 'filled' : 'empty') : null, placeholder: v ? `[${v.label}]` : '' };
    };
    const cells = tpl.roles.map(cell);
    const nameLines = cells.map((c) => wrapPlain(F.r, 11, c.name || (ctx.preview ? c.placeholder : '') || ' ', colW).slice(0, 3));
    const rowH = (k) => 12 + Math.max(...nameLines.slice(k * cols, k * cols + cols).map((l) => l.length)) * 13 + 4;
    const boxH = 14 + [...Array(rowsN).keys()].reduce((a, k) => a + rowH(k), 0) + 2;
    ensure(boxH + 10);
    page.drawRectangle({ x: ML, y: y - boxH, width: W, height: boxH, color: rgb(0.965, 0.965, 0.97), borderColor: C(RULE), borderWidth: 0.6 });
    let ry = y - 14;
    for (let k = 0; k < rowsN; k++) {
      cells.slice(k * cols, k * cols + cols).forEach((c, j) => {
        const x = ML + 10 + j * (colW + 16);
        page.drawText(safe(F.sb, c.label.toUpperCase()), { x, y: ry - 2, size: 6.8, font: F.sb, color: C(SOFT) });
        nameLines[k * cols + j].forEach((ln, li) => {
          const by = ry - 15 - li * 13;
          if (c.ph && ln.trim()) page.drawRectangle({ x: x - 1, y: by - 3, width: width(F.r, 11, ln) + 2, height: 13.5, color: c.ph === 'empty' ? rgb(1, 0.86, 0.45) : rgb(1, 0.95, 0.78) });
          if (c.empty && !ctx.preview) page.drawLine({ start: { x, y: by - 2 }, end: { x: x + Math.min(colW, 170), y: by - 2 }, thickness: 0.6, color: C(SOFT) });
          else page.drawText(safe(F.r, ln), { x, y: by, size: 11, font: F.r, color: C(c.empty ? [0.55, 0.38, 0] : INK) });
        });
      });
      ry -= rowH(k);
    }
    y -= boxH + 18;
  }

  // ----- paragraph engine -----
  const BODY = 10.5;
  const LEAD = 15;
  const fontOf = (p) => (p.b && p.i ? F.bi : p.b ? F.b : p.i ? F.i : F.r);

  function markerAtom(m) {
    const size = MARK_SIZE[m.type] || MARK_SIZE.text;
    if (m.type === 'checkbox') {
      const label = m.label || 'I agree';
      return { marker: m, w: size.w + 5 + width(F.r, BODY, label), h: size.h, asc: BODY, desc: BODY * 0.4, label };
    }
    return { marker: m, w: size.w, h: size.h, asc: size.h + 2, desc: 12 };
  }

  function atomsOf(pieces) {
    const atoms = [];
    let cur = null, space = false;
    const flush = () => { if (cur) { cur.w = cur.pieces.reduce((a, p) => a + width(fontOf(p), BODY, p.s), 0); atoms.push(cur); cur = null; } };
    for (const p of pieces) {
      if (p.t === 'br') { flush(); atoms.push({ br: true }); space = false; continue; }
      if (p.t === 'marker') { flush(); atoms.push({ ...markerAtom(p.m), space: true }); space = true; continue; }
      for (const part of p.s.split(/( +)/)) {
        if (!part) continue;
        if (/^ +$/.test(part)) { flush(); space = true; continue; }
        if (!cur) { cur = { pieces: [], space }; space = false; }
        cur.pieces.push({ ...p, s: part });
      }
    }
    flush();
    return atoms;
  }

  function lines(atoms, maxW) {
    const out = [];
    let line = { atoms: [], w: 0 };
    const spaceW = width(F.r, BODY, ' ');
    const gap = (a, prev) => (!prev || !a.space ? 0 : a.marker || prev.marker ? 18 : spaceW);
    const push = () => { out.push(line); line = { atoms: [], w: 0 }; };
    for (const a of atoms) {
      if (a.br) { push(); continue; }
      const prev = line.atoms.at(-1);
      let g = gap(a, prev);
      if (line.atoms.length && line.w + g + a.w > maxW) { push(); g = 0; }
      if (!a.marker && a.w > maxW) {
        // one very long word (a URL or a run of underscores): break it by characters
        let rest = a.pieces.map((p) => p.s).join('');
        const p0 = a.pieces[0];
        while (rest) {
          let n = rest.length;
          while (n > 1 && width(fontOf(p0), BODY, rest.slice(0, n)) > maxW - line.w) n--;
          const chunk = rest.slice(0, n);
          line.atoms.push({ pieces: [{ ...p0, s: chunk }], w: width(fontOf(p0), BODY, chunk), space: false });
          line.w += width(fontOf(p0), BODY, chunk);
          rest = rest.slice(n);
          if (rest) push();
        }
        continue;
      }
      line.atoms.push({ ...a, g });
      line.w += g + a.w;
    }
    if (line.atoms.length || !out.length) out.push(line);
    for (const l of out) {
      l.asc = Math.max(BODY * 0.98, ...l.atoms.map((a) => (a.marker ? a.asc : 0)));
      l.desc = Math.max(LEAD - BODY * 0.98, ...l.atoms.map((a) => (a.marker ? a.desc : 0)));
    }
    return out;
  }

  function drawMarker(a, x, base, pageIndex) {
    const m = a.marker;
    const key = `${opts._section}`;
    const k = markerCount.get(key) || 0;
    markerCount.set(key, k + 1);
    const id = `m-${opts._section}-${k}`;
    const def = FIELD_TYPES[m.type] || FIELD_TYPES.text;
    const label = m.type === 'checkbox' ? a.label : m.label || '';
    if (m.type === 'checkbox') {
      const s = MARK_SIZE.checkbox;
      page.drawRectangle({ x, y: base - 1, width: s.w, height: s.h, borderColor: C(INK), borderWidth: 0.8 });
      page.drawText(safe(F.r, a.label), { x: x + s.w + 5, y: base, size: BODY, font: F.r, color: C(INK) });
      fields.push({ id, type: 'checkbox', role: m.role, page: pageIndex, x, y: PH - (base - 1 + s.h), w: s.w, h: s.h, label, required: false, source: 'template' });
      return;
    }
    const s = MARK_SIZE[m.type] || MARK_SIZE.text;
    page.drawLine({ start: { x, y: base }, end: { x: x + s.w, y: base }, thickness: 0.7, color: C([0.2, 0.2, 0.24]) });
    const cap = fieldCaption({ type: m.type, label }, roleLabel(m.role));
    page.drawText(safe(F.s, cap), { x, y: base - 8.5, size: 6.6, font: F.s, color: C(SOFT) });
    fields.push({ id, type: m.type, role: m.role, page: pageIndex, x, y: PH - (base + 1 + s.h), w: s.w, h: s.h, label: label || (m.type === 'text' ? 'Text' : ''), required: def.required, source: 'template' });
  }

  function drawLines(ls, x0) {
    for (const l of ls) {
      ensure(l.asc + l.desc);
      const base = y - l.asc;
      let x = x0;
      let lastPh = null; // highlight the space between two words of the same filled-in value
      for (const a of l.atoms) {
        const gapStart = x;
        x += a.g || 0;
        if (a.marker) { drawMarker(a, x, base, pages.length - 1); x += a.w; lastPh = null; continue; }
        a.pieces.forEach((p, k) => {
          const f = fontOf(p);
          const t = safe(f, p.s);
          const w = f.widthOfTextAtSize(t, BODY);
          if (p.ph === 'filled' || p.ph === 'empty') {
            const from = k === 0 && a.g && lastPh === p.ph ? gapStart : x;
            page.drawRectangle({ x: from - 0.5, y: base - 3, width: x + w - from + 1, height: BODY + 3.5, color: p.ph === 'empty' ? rgb(1, 0.86, 0.45) : rgb(1, 0.95, 0.78) });
          }
          lastPh = p.ph || null;
          page.drawText(t, { x, y: base, size: BODY, font: f, color: C(p.ph === 'empty' ? [0.45, 0.3, 0] : INK) });
          x += w;
        });
      }
      y = base - l.desc;
    }
  }

  function paragraph(text, { indent = 0, marker = null } = {}) {
    const atoms = atomsOf(inline(text, ctx));
    const hang = marker ? 16 : 0;
    const ls = lines(atoms, W - indent - hang);
    // keep a short paragraph, and anything with fields in it, on one page
    const total = ls.reduce((a, l) => a + l.asc + l.desc, 0);
    if ((ls.length <= 3 || ls.some((l) => l.atoms.some((a) => a.marker))) && total < PH - MT - MB) ensure(total);
    else ensure(ls[0].asc + ls[0].desc);
    if (marker) {
      const f = marker === '•' ? F.r : F.r;
      page.drawText(safe(f, marker), { x: ML + indent + (marker === '•' ? 3 : 0), y: y - ls[0].asc, size: BODY, font: f, color: C(INK) });
    }
    drawLines(ls, ML + indent + hang);
  }

  // ----- sections -----
  const shown = visibleSections(tpl, ctx.values, opts.omit || []);
  const rolesSigned = new Set();
  for (const s of shown) for (const m of s.body.matchAll(/\[\[(sig|signature):([A-Za-z0-9_-]+)/g)) rolesSigned.add(m[2]);
  let n = 0;
  const heading = (text, numbered = true) => {
    const label = numbered ? `${++n}.  ${text}` : text;
    const ls = wrapPlain(F.sb, 9.5, label.toUpperCase(), W);
    ensure(14 + ls.length * 12 + 2 * LEAD);
    y -= 14;
    for (const l of ls) { y -= 10; page.drawText(safe(F.sb, l), { x: ML, y, size: 9.5, font: F.sb, color: C(INK) }); y -= 2; }
    y -= 6;
  };
  for (const s of shown) {
    opts._section = s.id;
    const t = s.title.replace(/^\s*(\d+(\.\d+)*|[IVXLC]+|[A-Z])[.)]?\s+(?=\S)/, '').trim();
    if (t) heading(fill(t));
    for (const blk of blocks(s.body)) {
      if (blk.kind === 'gap') { y -= 6; continue; }
      if (blk.kind === 'hr') { ensure(12); y -= 6; page.drawLine({ start: { x: ML, y }, end: { x: PW - MR, y }, thickness: 0.5, color: C(RULE) }); y -= 6; continue; }
      if (blk.kind === 'h') { ensure(LEAD * 2); y -= 4; paragraph(`**${blk.text.replace(/\*\*/g, '')}**`); continue; }
      if (blk.kind === 'li') { paragraph(blk.text, { indent: 6 + blk.depth * 16, marker: blk.marker }); y -= 2; continue; }
      paragraph(blk.text);
    }
  }
  function fill(t) { return inline(t, { ...ctx, preview: false }).map((p) => (p.t === 'text' ? p.s : p.t === 'br' ? ' ' : '')).join(''); }

  // ----- signature blocks for roles the text did not place a signature for -----
  const need = tpl.roles.filter((r) => !rolesSigned.has(r.id));
  if (need.length) {
    opts._section = 'signatures';
    const colW = (W - 24) / 2;
    const ROWS = ['signature', 'name', 'date'];
    const blockH = 27 + ROWS.reduce((a, t) => a + MARK_SIZE[t].h + 3 + 12 + 12, 0);
    ensure(14 + 18 + 6 + LEAD + 10 + blockH + 8); // keep the heading with the first row of blocks
    heading('Signatures');
    paragraph('Each party signs below to show they agree.');
    y -= 10;
    for (let k = 0; k < need.length; k += 2) {
      const pair = need.slice(k, k + 2);
      ensure(blockH + 8);
      const top = y;
      pair.forEach((r, j) => {
        const x = ML + j * (colW + 24);
        let yy = top;
        page.drawText(safe(F.sb, r.label.toUpperCase()), { x, y: yy - 8, size: 7, font: F.sb, color: C(SOFT) });
        const v = roleVariable(tpl, r.id);
        const nm = (v && formatValue(v, ctx.values[v.id])) || (opts.parties && opts.parties[r.id]) || '';
        if (nm) page.drawText(safe(F.b, wrapPlain(F.b, 10.5, nm, colW)[0]), { x, y: yy - 21, size: 10.5, font: F.b, color: C(INK) });
        yy -= 27;
        for (const type of ROWS) {
          const s = MARK_SIZE[type];
          const w = Math.min(colW - 6, type === 'date' ? 140 : 210);
          yy -= s.h + 3;
          const base = yy;
          page.drawLine({ start: { x, y: base }, end: { x: x + w, y: base }, thickness: 0.7, color: C([0.2, 0.2, 0.24]) });
          page.drawText(safe(F.s, fieldCaption({ type }, type === 'signature' ? r.label : '')), { x, y: base - 8.5, size: 6.6, font: F.s, color: C(SOFT) });
          fields.push({ id: `m-signatures-${r.id}-${type}`, type, role: r.id, page: pages.length - 1, x, y: PH - (base + 1 + s.h), w, h: s.h, label: '', required: true, source: 'template' });
          yy -= 12 + 12;
        }
      });
      y = top - blockH;
    }
  }

  // ----- disclaimer on the last page -----
  const notice = 'Massless Sign provides templates and signing tools, not legal advice.';
  const disc = [tpl.disclaimer, notice].filter(Boolean).join(' ');
  const dl = wrapPlain(F.s, 7.4, disc, W - 20);
  const dH = 22 + dl.length * 9.6 + 8;
  if (y - dH - 14 < MB) newPage();
  {
    const top = Math.min(y - 14, MB + dH + 4);
    page.drawRectangle({ x: ML, y: top - dH, width: W, height: dH, color: rgb(0.975, 0.975, 0.975), borderColor: C(RULE), borderWidth: 0.5 });
    page.drawText('DISCLAIMER', { x: ML + 10, y: top - 14, size: 6.8, font: F.sb, color: C(SOFT) });
    dl.forEach((l, k) => page.drawText(safe(F.s, l), { x: ML + 10, y: top - 26 - k * 9.6, size: 7.4, font: F.s, color: C([0.32, 0.32, 0.36]) }));
  }

  // ----- footers -----
  const total = pages.length;
  const foot = safe(F.s, `${tpl.title || 'Agreement'}   ·   ${tpl.id || 'template'} v${tpl.version || 1}   ·   Generated with Massless Sign`);
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: ML, y: 48 }, end: { x: PW - MR, y: 48 }, thickness: 0.4, color: C(RULE) });
    p.drawText(foot, { x: ML, y: 36, size: 6.8, font: F.s, color: C(SOFT) });
    const pn = `Page ${i + 1} of ${total}`;
    p.drawText(pn, { x: PW - MR - F.s.widthOfTextAtSize(pn, 6.8), y: 36, size: 6.8, font: F.s, color: C(SOFT) });
  });

  doc.setTitle(safe(F.s, title));
  doc.setSubject(`Massless Sign template ${tpl.id || ''} v${tpl.version || 1}`);
  doc.setProducer('Massless Sign');
  doc.setCreator('Massless Sign (massless.chucksi.com)');
  const bytes = await doc.save();
  return { bytes, fields, pages: pages.map(() => ({ w: PW, h: PH })), name: `${title}.pdf` };
}

function wrapPlain(font, size, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${w}` : w;
      let tw;
      try { tw = font.widthOfTextAtSize(t, size); } catch { tw = t.length * size * 0.5; }
      if (tw > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}
