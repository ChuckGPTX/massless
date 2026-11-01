// Exports. A rendered slide is read back from the DOM into a "scene": a flat list of rectangles, images,
// words (with their exact font, colour and baseline) and chart shapes, in slide pixels (1280 x 720). The same
// scene then becomes a PDF page with real, selectable text in the theme's own OFL fonts (pdf-lib + fontkit),
// a PowerPoint slide with editable text boxes, shapes and a native chart (PptxGenJS), or a PNG.
// The libraries are loaded on first use from jsDelivr at pinned versions; the writers take them as arguments,
// so tests can run them in Node.

import { SLIDE_W, SLIDE_H, plain } from './spec.js';
import { faceFor, woffURL, FACE_FILES } from './themes.js';

export const CDN = {
  pdfLib: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm',
  fontkit: 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/+esm',
  pptx: 'https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js',
};
const PT = 0.75; // 1280 px slide = 960 pt = 13.333 in
const PX_IN = 1 / 96;

// ---------- colours ----------
export function parseColor(c) {
  const m = String(c || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/);
  if (m) {
    let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { hex: '#' + [m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join(''), a };
  }
  const h = String(c || '').match(/^#([0-9a-f]{6})$/i);
  if (h) return { hex: `#${h[1].toLowerCase()}`, a: 1 };
  return { hex: '#000000', a: 0 };
}
const rgb01 = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** Rounded-rectangle SVG path at the origin. */
export function roundRectPath(w, h, r = 0) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return `M0 0H${w}V${h}H0Z`;
  return `M${r} 0H${w - r}A${r} ${r} 0 0 1 ${w} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h}H${r}A${r} ${r} 0 0 1 0 ${h - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z`;
}

// ======================================================================
// DOM -> scene (browser only)
// ======================================================================
let measureCtx = null;
function fontMetrics(family, weight, style, size) {
  measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
  measureCtx.font = `${style} ${weight} ${size}px ${family}`;
  const m = measureCtx.measureText('Hgy');
  const asc = m.fontBoundingBoxAscent ?? size * 0.8, desc = m.fontBoundingBoxDescent ?? size * 0.2;
  return { asc, desc };
}
const firstFamily = (ff) => String(ff || '').split(',')[0].trim().replace(/^["']|["']$/g, '');

/** Read a laid-out slide element back into a scene. */
export function extractScene(slideEl) {
  const base = slideEl.getBoundingClientRect();
  const k = base.width / SLIDE_W || 1;
  const box = (r) => ({ x: (r.left - base.left) / k, y: (r.top - base.top) / k, w: r.width / k, h: r.height / k });
  const items = [];
  const cs0 = getComputedStyle(slideEl);
  const scene = { w: SLIDE_W, h: SLIDE_H, bg: parseColor(cs0.backgroundColor).hex, items };

  function textBlock(el, op, group) {
    const cs = getComputedStyle(el);
    const words = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
      const p = node.parentElement;
      const pcs = getComputedStyle(p);
      if (pcs.visibility === 'hidden' || pcs.display === 'none') continue;
      const family = firstFamily(pcs.fontFamily), weight = Number(pcs.fontWeight) || 400, style = pcs.fontStyle === 'italic' ? 'italic' : 'normal';
      if (p !== el && p.closest('[data-tb]') !== el && el.namespaceURI !== 'http://www.w3.org/2000/svg') continue;
      const size = parseFloat(pcs.fontSize);
      const col = parseColor(pcs.color || pcs.fill);
      const fillCol = el.namespaceURI === 'http://www.w3.org/2000/svg' ? parseColor(pcs.fill) : col;
      const ls = pcs.letterSpacing === 'normal' ? 0 : parseFloat(pcs.letterSpacing) || 0;
      const upper = pcs.textTransform === 'uppercase';
      const { asc, desc } = fontMetrics(pcs.fontFamily, weight, style, size);
      const re = /\S+/g;
      let m;
      while ((m = re.exec(node.data))) {
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const rects = range.getClientRects();
        if (!rects.length) continue;
        const r = rects[0];
        if (!r.width) continue;
        const b = box(r);
        words.push({ s: upper ? m[0].toUpperCase() : m[0], x: b.x, y: b.y + b.h - desc * (b.h / (asc + desc) || 1), w: b.w, top: b.y, size, family, weight, style, color: fillCol.hex, a: fillCol.a * op, ls });
      }
    }
    if (!words.length) return;
    // group into lines by baseline
    const lines = [];
    for (const [i, w] of words.entries()) {
      const line = lines.find((l) => Math.abs(l.y - w.y) < w.size * 0.35);
      if (line) line.words.push(i); else lines.push({ y: w.y, words: [i] });
    }
    lines.sort((a, b) => a.y - b.y);
    const r = box(el.getBoundingClientRect());
    const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
    let align = cs.textAlign;
    if (align === 'start') align = 'left'; if (align === 'end') align = 'right';
    if (el.getAttribute && el.getAttribute('text-anchor') === 'middle') align = 'center';
    items.push({ t: 'text', ...r, align, lh, words, lines, g: group || undefined });
  }

  function svgShapes(svg, op) {
    const r = box(svg.getBoundingClientRect());
    const vb = svg.viewBox?.baseVal;
    const s = vb && vb.width ? r.w / vb.width : 1;
    let data = null;
    try { data = JSON.parse(svg.getAttribute('data-chart') || 'null'); } catch { /* not a chart */ }
    const css = getComputedStyle(slideEl);
    if (data) items.push({ t: 'chart', ...r, data, colors: [css.getPropertyValue('--c1').trim(), css.getPropertyValue('--c2').trim()], ink: parseColor(getComputedStyle(svg).color).hex, muted: css.getPropertyValue('--muted').trim(), grid: css.getPropertyValue('--grid').trim() });
    for (const n of svg.querySelectorAll('rect, line, path, circle, text')) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const a = op * parseFloat(cs.opacity || 1);
      if (n.tagName === 'text') { textBlock(n, a, 'chart'); continue; }
      let d = '';
      const num = (attr) => parseFloat(n.getAttribute(attr)) || 0;
      if (n.tagName === 'rect') { const rx = num('rx'); d = roundRectPath(num('width'), num('height'), rx).replace(/^M/, 'M'); d = offsetPath(d, num('x'), num('y')); }
      else if (n.tagName === 'line') d = `M${num('x1')} ${num('y1')}L${num('x2')} ${num('y2')}`;
      else if (n.tagName === 'circle') { const cx = num('cx'), cy = num('cy'), rr = num('r'); d = `M${cx - rr} ${cy}A${rr} ${rr} 0 1 0 ${cx + rr} ${cy}A${rr} ${rr} 0 1 0 ${cx - rr} ${cy}Z`; }
      else d = n.getAttribute('d') || '';
      const fill = parseColor(cs.fill), stroke = parseColor(cs.stroke);
      items.push({ t: 'path', d, ox: r.x, oy: r.y, k: s, fill: cs.fill === 'none' ? null : fill.hex, fa: fill.a * a, stroke: cs.stroke === 'none' ? null : stroke.hex, sa: stroke.a * a, sw: parseFloat(cs.strokeWidth) || 0, cap: cs.strokeLinecap, g: 'chart' });
    }
  }

  function walk(el, op) {
    if (el.nodeType !== 1) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden) return;
    const o = op * parseFloat(cs.opacity || 1);
    if (o < 0.01) return;
    if (el.tagName.toLowerCase() === 'svg') { svgShapes(el, o); return; }
    const r = box(el.getBoundingClientRect());
    if (el !== slideEl) {
      const bg = parseColor(cs.backgroundColor);
      const rad = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.w / 2, r.h / 2);
      if (bg.a > 0.01 && r.w > 0.5 && r.h > 0.5) items.push({ t: 'rect', ...r, r: /%/.test(cs.borderTopLeftRadius) ? Math.min(r.w, r.h) / 2 : rad, fill: bg.hex, a: bg.a * o });
      for (const [side, fx] of [['Top', (bw) => ({ x: r.x, y: r.y, w: r.w, h: bw })], ['Bottom', (bw) => ({ x: r.x, y: r.y + r.h - bw, w: r.w, h: bw })], ['Left', (bw) => ({ x: r.x, y: r.y, w: bw, h: r.h })], ['Right', (bw) => ({ x: r.x + r.w - bw, y: r.y, w: bw, h: r.h })]]) {
        const bw = parseFloat(cs[`border${side}Width`]) || 0;
        const bc = parseColor(cs[`border${side}Color`]);
        if (bw > 0 && cs[`border${side}Style`] !== 'none' && bc.a > 0.01) items.push({ t: 'rect', ...fx(bw), r: 0, fill: bc.hex, a: bc.a * o });
      }
    }
    if (el.tagName === 'IMG') {
      if (!el.naturalWidth) return;
      const clipEl = el.parentElement;
      const pcs = getComputedStyle(clipEl);
      const pr = box(clipEl.getBoundingClientRect());
      const nw = el.naturalWidth, nh = el.naturalHeight;
      const sc = Math.max(r.w / nw, r.h / nh);
      const sw = r.w / sc, sh = r.h / sc;
      const [px, py] = (cs.objectPosition || '50% 50%').split(' ').map((v) => (parseFloat(v) || 50) / 100);
      const rad = /%/.test(pcs.borderTopLeftRadius) ? Math.min(pr.w, pr.h) / 2 : Math.min(parseFloat(pcs.borderTopLeftRadius) || 0, pr.w / 2, pr.h / 2);
      items.push({ t: 'img', ...r, r: rad, src: el.currentSrc || el.src, nw, nh, sx: (nw - sw) * px, sy: (nh - sh) * py, sw, sh, a: o, alt: el.alt || '' });
      return;
    }
    if (el.hasAttribute('data-tb')) { textBlock(el, o); }
    for (const c of el.children) walk(c, o);
  }
  walk(slideEl, 1);
  return scene;
}
function offsetPath(d, dx, dy) {
  // only used on our own M/H/V/A/Z rounded-rect paths
  return d.replace(/([MHVA])([^MHVAZ]*)/g, (all, cmd, args) => {
    const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (cmd === 'M') return `M${n[0] + dx} ${n[1] + dy}`;
    if (cmd === 'H') return `H${n[0] + dx}`;
    if (cmd === 'V') return `V${n[0] + dy}`;
    if (cmd === 'A') return `A${n[0]} ${n[1]} ${n[2]} ${n[3]} ${n[4]} ${n[5] + dx} ${n[6] + dy}`;
    return all;
  });
}

// ======================================================================
// scene -> canvas (PNG export, library cover)
// ======================================================================
const imgCache = new Map();
export function loadImg(src) {
  if (!imgCache.has(src)) imgCache.set(src, new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error(`Could not load ${src}`)); im.src = src; }));
  return imgCache.get(src);
}
export async function drawScene(ctx, scene, scale = 1) {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = scene.bg;
  ctx.fillRect(0, 0, scene.w, scene.h);
  for (const it of scene.items) {
    if (it.t === 'chart') continue;
    ctx.save();
    if (it.t === 'rect') { ctx.globalAlpha = it.a; ctx.fillStyle = it.fill; ctx.translate(it.x, it.y); ctx.fill(new Path2D(roundRectPath(it.w, it.h, it.r))); }
    else if (it.t === 'img') {
      try {
        const im = await loadImg(it.src);
        ctx.globalAlpha = it.a;
        ctx.translate(it.x, it.y);
        ctx.clip(new Path2D(roundRectPath(it.w, it.h, it.r)));
        ctx.drawImage(im, it.sx, it.sy, it.sw, it.sh, 0, 0, it.w, it.h);
      } catch { /* a missing image leaves its card colour */ }
    } else if (it.t === 'path') {
      ctx.translate(it.ox, it.oy);
      ctx.scale(it.k, it.k);
      const p = new Path2D(it.d);
      if (it.fill) { ctx.globalAlpha = it.fa; ctx.fillStyle = it.fill; ctx.fill(p); }
      if (it.stroke && it.sw) { ctx.globalAlpha = it.sa; ctx.strokeStyle = it.stroke; ctx.lineWidth = it.sw; ctx.lineCap = it.cap || 'butt'; ctx.lineJoin = 'round'; ctx.stroke(p); }
    } else if (it.t === 'text') {
      for (const w of it.words) {
        ctx.globalAlpha = w.a;
        ctx.fillStyle = w.color;
        ctx.font = `${w.style} ${w.weight} ${w.size}px "${w.family}"`;
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${w.ls}px`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(w.s, w.x, w.y);
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

// ======================================================================
// scenes -> PDF (pdf-lib, injected)
// ======================================================================
const WINANSI = /[^\x20-\x7e\xa0-\xff–—‘’‚“”„†‡•…‰‹›€™ŒœŠšŸŽžƒˆ˜]/g;

/**
 * scenes -> PDF bytes. lib: the pdf-lib module. opts: { fontkit, fontBytes(family, weight, style) -> bytes|null,
 * imageBytes(item) -> { bytes, type: 'jpg'|'png' } | null, title }
 */
export async function buildPdf(scenes, lib, opts = {}) {
  const { PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState, setCharacterSpacing, moveTo, lineTo, appendBezierCurve, closePath, clip, endPath } = lib;
  const doc = await PDFDocument.create();
  if (opts.fontkit) doc.registerFontkit(opts.fontkit);
  doc.setTitle(opts.title || 'Deck');
  doc.setCreator('Chucksi Slides');
  doc.setProducer('Chucksi Slides (pdf-lib)');
  const fonts = new Map(), images = new Map();
  let fallback = null;
  const report = { fonts: [], fallbackWords: 0 };
  async function fontFor(w) {
    const key = `${w.family}|${w.weight}|${w.style}`;
    if (fonts.has(key)) return fonts.get(key);
    let f = null;
    try {
      const bytes = opts.fontBytes ? await opts.fontBytes(w.family, w.weight, w.style) : null;
      if (bytes) { f = await doc.embedFont(bytes, { subset: true }); report.fonts.push(key); }
    } catch { f = null; }
    fonts.set(key, f);
    return f;
  }
  async function standard() { fallback = fallback || await doc.embedFont(StandardFonts.Helvetica); return fallback; }
  const H = SLIDE_H * PT;
  const col = (hex) => rgb(...rgb01(hex));
  const rr = (x, y, w, h, r) => { // PDF coords, (x, y) bottom-left
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    const c = 0.5523 * r;
    if (!r) return [moveTo(x, y), lineTo(x + w, y), lineTo(x + w, y + h), lineTo(x, y + h), closePath()];
    return [moveTo(x + r, y), lineTo(x + w - r, y), appendBezierCurve(x + w - r + c, y, x + w, y + r - c, x + w, y + r), lineTo(x + w, y + h - r), appendBezierCurve(x + w, y + h - r + c, x + w - r + c, y + h, x + w - r, y + h), lineTo(x + r, y + h), appendBezierCurve(x + r - c, y + h, x, y + h - r + c, x, y + h - r), lineTo(x, y + r), appendBezierCurve(x, y + r - c, x + r - c, y, x + r, y), closePath()];
  };
  for (const scene of scenes) {
    const page = doc.addPage([SLIDE_W * PT, H]);
    page.drawRectangle({ x: 0, y: 0, width: SLIDE_W * PT, height: H, color: col(scene.bg) });
    for (const it of scene.items) {
      if (it.t === 'chart') continue;
      if (it.t === 'rect') {
        if (it.r > 0.5) page.drawSvgPath(roundRectPath(it.w, it.h, it.r), { x: it.x * PT, y: H - it.y * PT, scale: PT, color: col(it.fill), opacity: it.a });
        else page.drawRectangle({ x: it.x * PT, y: H - (it.y + it.h) * PT, width: it.w * PT, height: it.h * PT, color: col(it.fill), opacity: it.a });
      } else if (it.t === 'img') {
        let emb = images.get(it.key || it.src + it.sx + it.sy + it.w);
        if (emb === undefined) {
          const got = opts.imageBytes ? await opts.imageBytes(it) : null;
          try { emb = got ? (got.type === 'png' ? await doc.embedPng(got.bytes) : await doc.embedJpg(got.bytes)) : null; } catch { emb = null; }
          images.set(it.key || it.src + it.sx + it.sy + it.w, emb);
        }
        if (!emb) continue;
        const x = it.x * PT, y = H - (it.y + it.h) * PT, w = it.w * PT, h = it.h * PT;
        page.pushOperators(pushGraphicsState(), ...rr(x, y, w, h, it.r * PT), clip(), endPath());
        page.drawImage(emb, { x, y, width: w, height: h, opacity: it.a });
        page.pushOperators(popGraphicsState());
      } else if (it.t === 'path') {
        const o = { x: it.ox * PT, y: H - it.oy * PT, scale: it.k * PT };
        if (it.fill) page.drawSvgPath(it.d, { ...o, color: col(it.fill), opacity: it.fa });
        if (it.stroke && it.sw) page.drawSvgPath(it.d, { ...o, borderColor: col(it.stroke), borderWidth: it.sw, borderOpacity: it.sa, borderLineCap: it.cap === 'round' ? 1 : 0 });
      } else if (it.t === 'text') {
        for (const w of it.words) {
          let font = await fontFor(w), text = w.s;
          if (!font) { font = await standard(); text = text.replace(WINANSI, '?'); report.fallbackWords++; }
          // fit each word to the width the browser measured (kerning and letter-spacing included)
          let tc = 0;
          try {
            const n = [...text].length;
            const base = font.widthOfTextAtSize(text, w.size * PT);
            if (n && w.w) tc = Math.max(-0.15 * w.size * PT, Math.min(0.3 * w.size * PT, (w.w * PT - base) / n));
          } catch { tc = w.ls * PT; }
          if (tc) page.pushOperators(setCharacterSpacing(tc));
          try { page.drawText(text, { x: w.x * PT, y: H - w.y * PT, size: w.size * PT, font, color: col(w.color), opacity: w.a }); } catch { /* a glyph the font cannot encode */ }
          if (tc) page.pushOperators(setCharacterSpacing(0));
        }
      }
    }
  }
  const bytes = await doc.save({ useObjectStreams: false });
  return { bytes, report };
}

// ======================================================================
// scenes -> PPTX (PptxGenJS, injected)
// ======================================================================
const hex6 = (h) => String(h || '#000000').replace('#', '').slice(0, 6).toUpperCase();
const inch = (px) => +(px * PX_IN).toFixed(4);
/** scenes + deck -> a PptxGenJS presentation (call .write() on it). opts: { imageData(item) -> dataURL|null } */
export async function buildPptx(scenes, deck, PptxGenJS, opts = {}) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = plain(deck.title);
  pptx.author = 'Chucksi Slides';
  pptx.company = 'Chucksi';
  for (const [i, scene] of scenes.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: hex6(scene.bg) };
    const hasChart = scene.items.some((x) => x.t === 'chart');
    for (const it of scene.items) {
      if (hasChart && it.g === 'chart') continue;
      if (it.t === 'rect') {
        const round = it.r > 0.5;
        const ell = round && it.r >= Math.min(it.w, it.h) / 2 - 0.5 && Math.abs(it.w - it.h) < 1;
        slide.addShape(ell ? pptx.ShapeType.ellipse : round ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
          x: inch(it.x), y: inch(it.y), w: inch(it.w), h: inch(it.h), fill: { color: hex6(it.fill), transparency: Math.round((1 - it.a) * 100) }, line: { type: 'none' }, ...(round && !ell ? { rectRadius: inch(it.r) } : {}),
        });
      } else if (it.t === 'img') {
        const data = opts.imageData ? await opts.imageData(it) : null;
        if (!data) continue;
        const circle = it.r >= Math.min(it.w, it.h) / 2 - 0.5;
        slide.addImage({ data, x: inch(it.x), y: inch(it.y), w: inch(it.w), h: inch(it.h), rounding: circle, altText: it.alt || '' });
      } else if (it.t === 'text') {
        const runs = [];
        it.lines.forEach((ln, li) => {
          ln.words.forEach((wi, j) => {
            const w = it.words[wi];
            const prev = runs[runs.length - 1];
            const style = { fontFace: w.family, fontSize: +(w.size * PT).toFixed(1), color: hex6(w.color), bold: w.weight >= 600 && !/Black|Display$/.test(w.family), italic: w.style === 'italic', charSpacing: w.ls ? +(w.ls * PT).toFixed(2) : undefined, transparency: w.a < 0.99 ? Math.round((1 - w.a) * 100) : undefined };
            const text = (j ? ' ' : '') + w.s;
            if (prev && !prev.options.breakLine && JSON.stringify({ ...prev.options, breakLine: undefined }) === JSON.stringify(style)) prev.text += text;
            else runs.push({ text, options: style });
          });
          if (li < it.lines.length - 1 && runs.length) runs[runs.length - 1].options.breakLine = true;
        });
        if (!runs.length) continue;
        const f = it.words[0];
        slide.addText(runs, { x: inch(it.x), y: inch(it.y), w: inch(it.w * 1.04 + 4), h: inch(Math.max(it.h, it.lh * it.lines.length)), margin: 0, valign: 'top', align: it.align === 'center' ? 'center' : it.align === 'right' ? 'right' : 'left', lineSpacing: +(it.lh * PT).toFixed(1), fontFace: f.family, fontSize: +(f.size * PT).toFixed(1), isTextBox: true, fit: 'none', paraSpaceBefore: 0, paraSpaceAfter: 0 });
      } else if (it.t === 'chart') {
        const d = it.data;
        const data = d.series.map((s) => ({ name: s.name, labels: d.labels, values: s.values }));
        const colors = it.colors.map(hex6).filter(Boolean);
        slide.addChart(d.type === 'line' ? pptx.ChartType.line : pptx.ChartType.bar, data, {
          x: inch(it.x), y: inch(it.y), w: inch(it.w), h: inch(it.h),
          chartColors: colors.length ? colors : ['333333'], barDir: 'col', barGapWidthPct: 70, lineSize: 3, lineDataSymbolSize: 8,
          showValue: true, dataLabelColor: hex6(it.ink), dataLabelFontSize: 12, dataLabelFormatCode: `"${d.prefix || ''}"#,##0.##"${d.suffix || ''}"`, dataLabelPosition: d.type === 'line' ? 't' : 'outEnd',
          catAxisLabelColor: hex6(it.muted), catAxisLabelFontSize: 12, catAxisLineShow: false, valAxisHidden: true, valGridLine: { color: hex6(it.grid), size: 1 },
          showLegend: d.series.length > 1, legendPos: 'b', legendColor: hex6(it.muted), legendFontSize: 12,
        });
      }
    }
    if (deck.slides[i]?.notes) slide.addNotes(deck.slides[i].notes);
  }
  return pptx;
}

// ======================================================================
// single-file HTML player
// ======================================================================
/** A self-contained HTML page: slides, CSS, fonts and images inline, plus the runtime as a script. */
export function buildHtml({ title, slides, css, fontCSS, runtime, accent, lang = 'en' }) {
  const safe = (s) => String(s).replace(/<\/(script|style)/gi, '<\\/$1');
  const data = JSON.stringify(slides).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="generator" content="Chucksi Slides">
<title>${String(title).replace(/[<&>]/g, '')}</title>
<style>${safe(fontCSS)}
${safe(css)}
html, body { margin: 0; height: 100%; background: #050506; }
noscript { display: block; color: #f4f4f1; font: 16px system-ui, sans-serif; padding: 24px; }
</style>
</head>
<body>
<noscript>This presentation needs JavaScript to play.</noscript>
<script>
const SLIDES = ${data};
const RT = (${safe(runtime)})();
RT.Player(SLIDES, { title: ${JSON.stringify(String(title))}, accent: ${JSON.stringify(accent || '#ffbf2f')}, inline: true }).mount(document.body);
</script>
</body>
</html>
`;
}

/** Strip url(/fonts/…) @font-face rules from a stylesheet (the export embeds its own). */
export const withoutFontFaces = (css) => String(css).replace(/@font-face\s*\{[^}]*\}\s*/g, '');

/** Every face a set of scenes draws text with, resolved to a file. */
export function facesUsed(scenes) {
  const out = new Map();
  for (const s of scenes) for (const it of s.items) if (it.t === 'text') for (const w of it.words) {
    const f = faceFor(w.family, w.weight, w.style);
    if (f) out.set(`${w.family}|${w.weight}|${w.style}`, { family: w.family, file: f[2], weight: f[0], style: f[1] });
  }
  return [...out.values()];
}
export { woffURL, FACE_FILES };
