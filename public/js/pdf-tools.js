// In-browser PDF toolkit for the Office page. Everything runs on the user's device:
// pdf.js (Apache-2.0) reads and renders, pdf-lib (MIT) writes, fflate (MIT) zips.
// Libraries load lazily, the first time a tool needs them.

export const LIBS = {
  pdfLib: 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm',
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs',
  pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs',
  fflate: 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm',
};

let pdfLibP, pdfjsP, fflateP;
export const loadPdfLib = () => (pdfLibP ||= import(LIBS.pdfLib).catch((e) => { pdfLibP = null; throw e; }));
export const loadFflate = () => (fflateP ||= import(LIBS.fflate).catch((e) => { fflateP = null; throw e; }));
export function loadPdfjs() {
  return (pdfjsP ||= import(LIBS.pdfjs).then((m) => {
    m.GlobalWorkerOptions.workerSrc = LIBS.pdfjsWorker;
    return m;
  }).catch((e) => { pdfjsP = null; throw e; }));
}

/** Open bytes with pdf.js. pdf.js transfers the buffer to its worker, so it always gets a copy. */
export async function openPdfjs(bytes) {
  const pdfjs = await loadPdfjs();
  try {
    return await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
  } catch (e) {
    throw friendly(e);
  }
}

/** Open bytes with pdf-lib for writing. */
export async function openPdfLib(bytes) {
  const { PDFDocument } = await loadPdfLib();
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    throw friendly(e);
  }
}

function friendly(e) {
  const m = String(e?.message || e);
  if (e?.name === 'PasswordException' || /encrypt|password/i.test(m)) return new Error('This PDF is password protected. Remove the password and try again.');
  if (e?.name === 'InvalidPDFException' || /invalid pdf|no pdf header|failed to parse/i.test(m)) return new Error("This file doesn't look like a PDF.");
  return e instanceof Error ? e : new Error(m);
}

export const isPdf = (f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
export const isImage = (f) => f && (/^image\/(png|jpe?g|webp)$/.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name));
export const baseName = (name) => String(name || 'document').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'document';
export const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Parse page ranges like "1-3, 5, 8-" into zero-based page indices (in the order written).
 * An empty string means every page. Throws a readable error on bad input.
 */
export function parseRanges(text, total) {
  const s = String(text || '').trim();
  if (!s || /^all$/i.test(s)) return [...Array(total).keys()];
  const out = [];
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d*)\s*[-–]\s*(\d*)$/) || part.match(/^(\d+)$/);
    if (!m) throw new Error(`"${part}" isn't a page or a range. Try something like 1-3, 5.`);
    let a, b;
    if (m.length === 2) { a = b = Number(m[1]); } else { a = m[1] ? Number(m[1]) : 1; b = m[2] ? Number(m[2]) : total; }
    if (a < 1 || b < 1 || a > total || b > total) throw new Error(`This PDF has ${total} page${total === 1 ? '' : 's'}; "${part}" is outside that.`);
    const step = a <= b ? 1 : -1;
    for (let i = a; i !== b + step; i += step) out.push(i - 1);
  }
  if (!out.length) throw new Error('Pick at least one page.');
  return out;
}

/** Group ranges into separate chunks: "1-3, 5" -> [[0,1,2],[4]]. */
export function parseRangeGroups(text, total) {
  const s = String(text || '').trim();
  if (!s) return [[...Array(total).keys()]];
  return s.split(/[,;]+/).map((p) => p.trim()).filter(Boolean).map((p) => parseRanges(p, total));
}

// ---------- canvas helpers ----------
const canvasToBlob = (canvas, type, quality) => new Promise((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error('Could not encode the image.'))), type, quality));

async function renderPage(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

/** Read the EXIF orientation of a JPEG (1 when absent). */
function jpegOrientation(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return 1;
  let off = 2;
  while (off + 4 < v.byteLength) {
    const marker = v.getUint16(off);
    const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
      const t = off + 10;
      const le = v.getUint16(t) === 0x4949;
      const ifd = t + v.getUint32(t + 4, le);
      const n = v.getUint16(ifd, le);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 10 > v.byteLength) break;
        if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
    off += 2 + len;
  }
  return 1;
}

/** Turn any image file into something pdf-lib can embed, keeping JPEGs untouched when it is safe to. */
async function embedImageFile(doc, file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (isJpg && jpegOrientation(bytes) === 1) {
    try { return await doc.embedJpg(bytes); } catch { /* fall through to canvas (e.g. CMYK) */ }
  }
  if (isPng) {
    try { return await doc.embedPng(bytes); } catch { /* fall through (e.g. 16-bit or interlaced) */ }
  }
  const bmp = await createImageBitmap(new Blob([bytes], { type: file.type || 'image/*' }));
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d');
  const hasAlpha = isPng || /webp/i.test(file.type) || /\.webp$/i.test(file.name);
  if (!hasAlpha) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(bmp, 0, 0);
  bmp.close?.();
  if (hasAlpha) return doc.embedPng(new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer()));
  return doc.embedJpg(new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.92)).arrayBuffer()));
}

export const PAPER = { a4: [595.28, 841.89], letter: [612, 792] };

// ---------- operations ----------

/** Images -> one PDF, one page per image. size: 'image' | 'a4' | 'letter'. */
export async function imagesToPdf(files, { size = 'image', margin = 24, onProgress } = {}) {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  for (const [i, f] of files.entries()) {
    onProgress?.(i / files.length, `Adding image ${i + 1} of ${files.length}`);
    const img = await embedImageFile(doc, f);
    if (size === 'image') {
      // 1 image pixel = 1 point (72 dpi), capped so giant photos stay printable.
      const k = Math.min(1, 14400 / Math.max(img.width, img.height));
      const w = img.width * k, h = img.height * k;
      doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    } else {
      let [pw, ph] = PAPER[size] || PAPER.a4;
      if (img.width > img.height) [pw, ph] = [ph, pw];
      const k = Math.min((pw - 2 * margin) / img.width, (ph - 2 * margin) / img.height);
      const w = img.width * k, h = img.height * k;
      doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
  }
  doc.setProducer('Massless Office');
  return doc.save();
}

/** PDF -> one image per page. */
export async function pdfToImages(bytes, { format = 'png', scale = 2, pages, onProgress } = {}) {
  const pdf = await openPdfjs(bytes);
  const list = pages || [...Array(pdf.numPages).keys()];
  const type = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const out = [];
  try {
    for (const [k, i] of list.entries()) {
      onProgress?.(k / list.length, `Rendering page ${i + 1} of ${pdf.numPages}`);
      const page = await pdf.getPage(i + 1);
      const canvas = await renderPage(page, scale);
      out.push({ page: i + 1, width: canvas.width, height: canvas.height, blob: await canvasToBlob(canvas, type, 0.9) });
      page.cleanup();
      canvas.width = canvas.height = 0;
    }
  } finally {
    pdf.destroy();
  }
  return out;
}

/** Zip a list of { name, blob | bytes } into one Blob. Images and PDFs are already compressed, so store them. */
export async function zipFiles(files) {
  const { zipSync } = await loadFflate();
  const entries = {};
  const used = new Set();
  for (const f of files) {
    let name = f.name;
    for (let n = 2; used.has(name); n++) name = f.name.replace(/(\.[^.]+)?$/, `-${n}$1`);
    used.add(name);
    const data = f.bytes || new Uint8Array(await f.blob.arrayBuffer());
    entries[name] = [data, { level: /\.(txt|svg)$/i.test(name) ? 6 : 0 }];
  }
  return new Blob([zipSync(entries)], { type: 'application/zip' });
}

/** Merge PDFs in the given order. */
export async function mergePdfs(list, { onProgress } = {}) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  for (const [i, bytes] of list.entries()) {
    onProgress?.(i / list.length, `Merging file ${i + 1} of ${list.length}`);
    const src = await openPdfLib(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  out.setProducer('Massless Office');
  return out.save();
}

/** Copy the given zero-based pages into a new PDF. */
export async function extractPages(bytes, indices, srcDoc) {
  const { PDFDocument } = await loadPdfLib();
  const src = srcDoc || await openPdfLib(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  out.setProducer('Massless Office');
  return out.save();
}

/** Split: either one PDF per range group, or one PDF per page. Returns [{ label, bytes }]. */
export async function splitPdf(bytes, rangeText, { perPage = false, onProgress } = {}) {
  const src = await openPdfLib(bytes);
  const total = src.getPageCount();
  const groups = perPage ? parseRanges(rangeText, total).map((i) => [i]) : parseRangeGroups(rangeText, total);
  const out = [];
  for (const [k, g] of groups.entries()) {
    onProgress?.(k / groups.length, `Writing part ${k + 1} of ${groups.length}`);
    const label = g.length === 1 ? `p${g[0] + 1}` : contiguous(g) ? `p${g[0] + 1}-${g.at(-1) + 1}` : `part${k + 1}`;
    out.push({ label, pages: g.length, bytes: await extractPages(bytes, g, src) });
  }
  return out;
}
const contiguous = (g) => g.every((v, i) => i === 0 || v === g[i - 1] + 1);

/** Rotate pages clockwise by 90, 180 or 270 degrees. */
export async function rotatePdf(bytes, angle, rangeText = '') {
  const { degrees } = await loadPdfLib();
  const doc = await openPdfLib(bytes);
  const idx = parseRanges(rangeText, doc.getPageCount());
  for (const i of new Set(idx)) {
    const p = doc.getPage(i);
    p.setRotation(degrees((((p.getRotation().angle + angle) % 360) + 360) % 360));
  }
  return doc.save();
}

/** Compress by re-rendering every page to JPEG and rebuilding the PDF. Text stops being selectable. */
export async function compressPdf(bytes, { quality = 0.6, dpi = 110, onProgress } = {}) {
  const { PDFDocument } = await loadPdfLib();
  const pdf = await openPdfjs(bytes);
  const out = await PDFDocument.create();
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.((i - 1) / pdf.numPages, `Compressing page ${i} of ${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(dpi / 72, 4000 / Math.max(base.width, base.height));
      const canvas = await renderPage(page, scale);
      const jpg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', quality)).arrayBuffer());
      const img = await out.embedJpg(jpg);
      out.addPage([base.width, base.height]).drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
      page.cleanup();
      canvas.width = canvas.height = 0;
    }
  } finally {
    pdf.destroy();
  }
  out.setProducer('Massless Office');
  return out.save();
}

/** Pull the text layer out of every page. */
export async function extractText(bytes, { maxChars = Infinity, onProgress, pdf: given } = {}) {
  const pdf = given || await openPdfjs(bytes);
  const parts = [];
  let size = 0;
  try {
    for (let i = 1; i <= pdf.numPages && size < maxChars; i++) {
      onProgress?.((i - 1) / pdf.numPages, `Reading page ${i} of ${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      let s = '';
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        s += it.str;
        if (it.hasEOL) s += '\n';
      }
      s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      const block = `--- Page ${i} ---\n${s || '(no text on this page)'}\n`;
      parts.push(block);
      size += block.length;
    }
  } finally {
    if (!given) pdf.destroy();
  }
  const text = parts.join('\n');
  return Number.isFinite(maxChars) ? text.slice(0, maxChars) : text;
}

// ---------- annotations ----------

const COLORS = {
  amber: [1, 0.749, 0.184],
  pink: [1, 0.41, 0.71],
  green: [0.36, 0.9, 0.45],
  black: [0.08, 0.08, 0.1],
  blue: [0.13, 0.36, 0.86],
  red: [0.86, 0.15, 0.2],
};
export const colorRgb = (name) => COLORS[name] || COLORS.black;

const dataUrlBytes = (url) => {
  const b = atob(url.split(',')[1]);
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
};

/** WinAnsi can't encode everything; swap what Helvetica can't draw for close equivalents or '?'. */
function winAnsiSafe(font, s) {
  const map = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '…': '...', ' ': ' ' };
  let out = '';
  for (const ch of s.replace(/[‘’“”–—… ]/g, (c) => map[c])) {
    try { font.encodeText(ch); out += ch; } catch { out += '?'; }
  }
  return out;
}

/**
 * Write annotation items into the PDF.
 * Items are in "view units": the page as pdf.js shows it at scale 1 (top-left origin, after /Rotate).
 * `toPdf(pageIndex, x, y)` maps a view point to PDF user space (pdf.js viewport.convertToPdfPoint),
 * which takes care of the y flip, the crop box offset and the page rotation.
 */
export async function writeAnnotations(bytes, items, toPdf) {
  const lib = await loadPdfLib();
  const { StandardFonts, rgb, degrees, BlendMode, LineCapStyle, PDFHexString, PDFName } = lib;
  const doc = await openPdfLib(bytes);
  const font = items.some((i) => i.type === 'text') ? await doc.embedFont(StandardFonts.Helvetica) : null;
  const pngs = new Map();
  const pages = doc.getPages();
  const C = (name) => rgb(...colorRgb(name));
  const angleOf = (pi, x, y) => { // direction of view +x in PDF space, in degrees
    const [ax, ay] = toPdf(pi, x, y);
    const [bx, by] = toPdf(pi, x + 1, y);
    return Math.round(Math.atan2(by - ay, bx - ax) * 180 / Math.PI);
  };
  const rectOf = (pi, x, y, w, h) => {
    const pts = [toPdf(pi, x, y), toPdf(pi, x + w, y + h)];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.abs(xs[0] - xs[1]), height: Math.abs(ys[0] - ys[1]) };
  };

  for (const it of items) {
    const page = pages[it.page];
    if (!page) continue;
    if (it.type === 'highlight') {
      page.drawRectangle({ ...rectOf(it.page, it.x, it.y, it.w, it.h), color: C(it.color), opacity: 0.38, blendMode: BlendMode.Multiply, borderWidth: 0 });
    } else if (it.type === 'text') {
      const text = winAnsiSafe(font, it.text || '');
      if (!text.trim()) continue;
      const rot = angleOf(it.page, it.x, it.y);
      const lh = it.size * 1.2;
      text.split('\n').forEach((line, k) => {
        if (!line) return;
        // baseline of line k, measured down from the top of the box in view units
        const [x, y] = toPdf(it.page, it.x, it.y + it.size * 0.93 + k * lh);
        page.drawText(line, { x, y, size: it.size, font, color: C(it.color), rotate: degrees(rot) });
      });
    } else if (it.type === 'ink') {
      if (it.points.length < 2) continue;
      // drawSvgPath flips y, so feed it (x, -y) in PDF space and anchor at the origin.
      const d = it.points.map(([px, py], k) => {
        const [x, y] = toPdf(it.page, px, py);
        return `${k ? 'L' : 'M'}${x.toFixed(2)} ${(-y).toFixed(2)}`;
      }).join(' ');
      page.drawSvgPath(d, { x: 0, y: 0, borderColor: C(it.color), borderWidth: it.width, borderLineCap: LineCapStyle.Round });
    } else if (it.type === 'sign') {
      let img = pngs.get(it.src);
      if (!img) { img = await doc.embedPng(dataUrlBytes(it.src)); pngs.set(it.src, img); }
      const [x, y] = toPdf(it.page, it.x, it.y + it.h); // image's bottom-left corner as seen on screen
      const k = Math.hypot(...[0, 1].map((j) => toPdf(it.page, it.x + 1, it.y)[j] - toPdf(it.page, it.x, it.y)[j]));
      page.drawImage(img, { x, y, width: it.w * k, height: it.h * k, rotate: degrees(angleOf(it.page, it.x, it.y)) });
    } else if (it.type === 'note') {
      const r = rectOf(it.page, it.x, it.y, 22, 22);
      const annot = doc.context.obj({
        Type: 'Annot', Subtype: 'Text', Name: 'Comment', F: 4, Open: false,
        Rect: [r.x, r.y, r.x + r.width, r.y + r.height],
        Contents: PDFHexString.fromText(it.text || ''),
        T: PDFHexString.fromText('Note'),
        C: colorRgb(it.color),
        M: PDFHexString.fromText(new Date().toISOString()),
      });
      page.node.addAnnot(doc.context.register(annot));
      void PDFName;
    }
  }
  return doc.save();
}
