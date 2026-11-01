// Office > Slides: deck spec validation, the in-browser writer, theme contrast, share links and the export
// writers (PDF page structure via pdf-lib, PPTX zip contents via PptxGenJS + JSZip), all in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import * as PDFLib from 'pdf-lib';
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { LAYOUTS, LAYOUT_IDS, sanitizeDeck, validateDeck, newSlide, changeLayout, safeSrc, imageSlots, runs, LIMITS, MAX_SLIDES } from '../public/js/slides/spec.js';
import { THEMES, contrastReport, palette, tokens, themeFaces, FACE_FILES, FONTSOURCE, woffURL } from '../public/js/slides/themes.js';
import { writeDeck, readBrief, detectKind, KINDS, SURPRISES, choose } from '../public/js/slides/writer.js';
import { TEMPLATES, templateDeck } from '../public/js/slides/templates.js';
import { renderSlide, chartGeometry, parseCount, fitSize, esc } from '../public/js/slides/render.js';
import { encodeDeck, decodeDeck, shareable, localImageCount } from '../public/js/slides/share.js';
import { buildPdf, buildPptx, buildHtml, roundRectPath, parseColor, withoutFontFaces, CDN } from '../public/js/slides/export.js';
import { deckRuntime } from '../public/js/slides/runtime.js';

const pub = (p) => new URL(`../public${p}`, import.meta.url);
const stripIds = (d) => JSON.parse(JSON.stringify(d, (k, v) => (k === 'id' ? undefined : v)));

// ---------------------------------------------------------------- themes
test('at least eight themes, every text and chart pairing passes its WCAG minimum', () => {
  assert.ok(THEMES.length >= 8, `${THEMES.length} themes`);
  assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
  assert.equal(new Set(THEMES.map((t) => `${t.display.family}|${t.body.family}|${t.bg.join()}`)).size, THEMES.length, 'themes are distinct');
  for (const t of THEMES) {
    for (const [name, ratio, min] of contrastReport(t)) assert.ok(ratio >= min, `${t.id} ${name}: ${ratio.toFixed(2)} < ${min}`);
    const p = palette(t);
    for (const v of [p.bg, p.ink, p.accent, p.onAccent, ...Object.values(p.tones).flatMap((c) => [c.bg, c.ink, c.muted, c.card])]) assert.match(v, /^#[0-9a-f]{6}$/);
    const vars = tokens(t, 'accent');
    assert.ok(vars['--fd'].startsWith(`'${t.display.family}'`));
  }
});

test('theme fonts are self-hosted OFL faces with licences, and the PDF font URLs are pinned', async () => {
  for (const t of THEMES) {
    for (const [family, , , file] of themeFaces(t)) {
      assert.ok(FACE_FILES[family], family);
      assert.ok((await stat(pub(`/fonts/${file}.woff2`))).size > 5000, file);
      const lic = (await readFile(pub(`/fonts/OFL-${family.replace(/\s+/g, '')}.txt`), 'utf8'));
      assert.match(lic, /SIL OPEN FONT LICENSE/i, family);
      assert.match(woffURL(family, file), /^https:\/\/cdn\.jsdelivr\.net\/npm\/@fontsource\/[a-z-]+@\d+\.\d+\.\d+\/files\/[\w-]+\.woff$/);
      assert.ok(FONTSOURCE[family]);
    }
  }
  const css = await readFile(pub('/css/deck.css'), 'utf8');
  for (const fam of Object.keys(FACE_FILES)) assert.ok(css.includes(`font-family: '${fam}'`), `deck.css declares ${fam}`);
});

// ---------------------------------------------------------------- spec
test('every template is a valid, polished example deck', () => {
  assert.ok(TEMPLATES.length >= 6);
  for (const name of ['Pitch', 'Launch', 'Sales', 'Report', 'Portfolio', 'Event']) assert.ok(TEMPLATES.some((t) => t.name === name), name);
  const themes = new Set();
  for (const t of TEMPLATES) {
    const d = templateDeck(t.id);
    assert.deepEqual(validateDeck(d), [], t.id);
    assert.ok(d.slides.length >= 8 && d.slides.length <= 12, `${t.id}: ${d.slides.length} slides`);
    assert.equal(d.slides[0].layout, 'title');
    assert.equal(d.slides.at(-1).layout, 'closing');
    assert.ok(new Set(d.slides.map((s) => s.layout)).size >= 7, `${t.id} uses at least 7 layouts`);
    for (const s of d.slides) for (const [, im] of imageSlots(s)) if (im.src) assert.match(im.src, /^\/media\//);
    themes.add(d.theme);
  }
  assert.ok(themes.size >= 6, 'templates show off different themes');
  const all = new Set(TEMPLATES.flatMap((t) => templateDeck(t.id).slides.map((s) => s.layout)));
  for (const l of LAYOUT_IDS) assert.ok(all.has(l), `some template uses ${l}`);
});

test('template photos exist on disk', async () => {
  const srcs = new Set(TEMPLATES.flatMap((t) => templateDeck(t.id).slides.flatMap((s) => imageSlots(s).map(([, im]) => im.src)).filter(Boolean)));
  for (const src of srcs) assert.ok((await stat(pub(src))).size > 1000, src);
});

test('sanitizeDeck turns anything into a valid deck and blocks unsafe sources', () => {
  for (const junk of [null, 42, 'deck', [], { slides: 'x' }, { slides: [{ layout: 'nope', title: 5 }] }]) assert.deepEqual(validateDeck(sanitizeDeck(junk)), []);
  const d = sanitizeDeck({
    theme: 'nope', transition: 'spin',
    slides: [
      { layout: 'title', title: 'A'.repeat(500), image: { src: 'javascript:alert(1)' } },
      { layout: 'imagetext', title: 'x', image: { src: 'https://evil.example/x.jpg' } },
      { layout: 'imagetext', title: 'x', image: { src: '/media/../../etc/passwd.jpg' } },
      { layout: 'gallery', title: 'g', items: Array.from({ length: 20 }, () => ({ image: { src: 'asset:abc' }, caption: 'c' })) },
      { layout: 'chart', title: 'c', chart: { type: 'pie', labels: Array.from({ length: 20 }, (_, i) => `L${i}`), series: [{ name: 's', values: ['3', 'x', 1e99] }, {}, {}] } },
      { layout: 'statement', title: 'ok', notes: '<script>alert(1)</script>' },
    ],
  });
  assert.deepEqual(validateDeck(d), []);
  assert.equal(d.theme, 'studio');
  assert.equal(d.transition, 'fade');
  assert.equal(d.slides[0].title.length, LIMITS.text);
  assert.equal(d.slides[0].image.src, '');
  assert.equal(d.slides[1].image.src, '');
  assert.equal(d.slides[2].image.src, '');
  assert.equal(d.slides[3].items.length, LAYOUTS.gallery.fields.items.max);
  assert.equal(d.slides[3].items[0].image.src, 'asset:abc');
  assert.equal(d.slides[4].chart.type, 'bar');
  assert.equal(d.slides[4].chart.labels.length, LIMITS.chartLabels);
  assert.equal(d.slides[4].chart.series.length, 2);
  assert.deepEqual(d.slides[4].chart.series[0].values.slice(0, 3), [3, 0, 1e12]);
  assert.equal(sanitizeDeck({ slides: Array.from({ length: 99 }, () => ({ layout: 'statement', title: 't' })) }).slides.length, MAX_SLIDES);
  assert.equal(safeSrc('/media/website/pavilion.jpg'), '/media/website/pavilion.jpg');
  assert.equal(safeSrc('data:image/png;base64,AAAA'), '');
});

test('validateDeck reports real problems', () => {
  const d = templateDeck('pitch');
  d.slides[1].layout = 'carousel';
  d.slides[2].id = d.slides[3].id;
  d.slides[5].chart.series[0].values.pop();
  d.slides[4].value = '';
  const problems = validateDeck(d).join('\n');
  assert.match(problems, /unknown layout carousel/);
  assert.match(problems, /duplicate id/);
  assert.match(problems, /does not match its labels/);
  assert.match(problems, /main text is empty/);
});

test('new slides and layout changes stay valid and keep the headline', () => {
  for (const l of LAYOUT_IDS) assert.deepEqual(validateDeck(sanitizeDeck({ slides: [newSlide(l)] })), [], l);
  const src = templateDeck('sales').slides;
  for (const s of src) for (const to of LAYOUT_IDS) {
    const c = changeLayout(s, to);
    assert.equal(c.layout, to);
    assert.equal(c.id, s.id);
    assert.deepEqual(validateDeck(sanitizeDeck({ slides: [c] })), [], `${s.layout} -> ${to}`);
    if (s.title && 'title' in LAYOUTS[to].fields) assert.equal(c.title, s.title);
  }
  assert.deepEqual(runs('Say *one* thing'), [{ text: 'Say ', em: false }, { text: 'one', em: true }, { text: ' thing', em: false }]);
});

// ---------------------------------------------------------------- writer
test('the writer maps a description to the right kind, slides and facts', () => {
  for (const [kind, k] of Object.entries(KINDS)) {
    assert.equal(detectKind(k.example), kind, `detects ${kind}`);
    const d = writeDeck(k.example);
    assert.equal(d.kind, kind);
    assert.deepEqual(validateDeck(d), [], kind);
    assert.ok(d.slides.length >= 8 && d.slides.length <= 12);
    assert.equal(d.slides[0].layout, 'title');
    assert.equal(d.slides.at(-1).layout, 'closing');
  }
  const pitch = writeDeck(KINDS.pitch.example);
  assert.equal(pitch.slides[0].title, 'Tallyfern');
  assert.match(pitch.slides[0].subtitle, /turns receipts into a tidy monthly budget/);
  const nums = pitch.slides.filter((s) => s.layout === 'bignumber');
  assert.equal(nums[0].value, '48,000');
  assert.equal(nums[0].label, 'households');
  assert.ok(nums[0].items.some((x) => x.value === '31%'));
  assert.equal(nums.at(-1).value, '$3M');
  const f = readBrief(KINDS.event.example);
  assert.equal(f.name, 'Prairie Code Camp');
  assert.equal(f.date, 'May 16, 2027');
  assert.equal(f.venue, 'Paramount Theatre');
  assert.equal(f.price, '$189');
  const ev = writeDeck(KINDS.event.example);
  assert.match(ev.slides[0].eyebrow, /May 16, 2027 · Cedar Rapids/);
  assert.ok(ev.slides.some((s) => s.layout === 'pricing' && s.items.some((p) => p.price === '$189')));
  const lesson = writeDeck(KINDS.lesson.example);
  assert.match(lesson.slides[0].title, /Photosynthesis/);
  assert.match(lesson.slides[0].eyebrow, /Grade 7/);
  const report = readBrief(KINDS.report.example);
  assert.deepEqual(report.stats.slice(0, 2), [{ value: '$480k', label: 'revenue' }, { value: '+18%', label: 'growth' }]);
  assert.equal(readBrief(KINDS.portfolio.example).person, 'Noor Haddad');
});

test('the writer honours length and kind, is deterministic and handles every surprise', () => {
  for (const n of [8, 10, 12]) {
    const d = writeDeck(KINDS.pitch.example, { count: n });
    assert.equal(d.slides.length, n);
  }
  assert.equal(writeDeck('Our new garden app', { kind: 'lesson' }).kind, 'lesson');
  assert.deepEqual(stripIds(writeDeck(SURPRISES[0])), stripIds(writeDeck(SURPRISES[0])));
  assert.equal(writeDeck('').slides.length, 10);
  for (const s of SURPRISES) {
    const d = writeDeck(s);
    assert.deepEqual(validateDeck(d), [], s);
    assert.notEqual(d.title, 'Pitch');
  }
  const plan = [1, 2, 3, 4, 1, 2, 3, 1, 4, 2, 3, 1].map((prio, i) => ({ prio, i }));
  assert.deepEqual(choose(plan, 8).map((x) => x.i), [0, 1, 2, 4, 5, 7, 9, 11]);
});

// ---------------------------------------------------------------- render
test('slides render to safe HTML with edit hooks, motion marks and fitted headlines', () => {
  for (const t of TEMPLATES) {
    const d = templateDeck(t.id);
    d.slides.forEach((s, i) => {
      const h = renderSlide(s, d, { index: i, total: d.slides.length });
      assert.match(h, new RegExp(`^<section class="sl sl-${s.layout} `));
      assert.doesNotMatch(h, /undefined|NaN|\[object/);
      assert.match(h, /data-a="/);
      const e = renderSlide(s, d, { index: i, total: d.slides.length, edit: true });
      assert.match(e, /data-k="/);
    });
  }
  const d = sanitizeDeck({ title: 'X', slides: [{ layout: 'statement', title: '<img src=x onerror=alert(1)> *bold*' }, { layout: 'bignumber', value: '$4.2M', label: 'ARR' }] });
  const h = renderSlide(d.slides[0], d, {});
  assert.ok(!h.includes('<img src=x'));
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt; <em>bold</em>'));
  assert.match(renderSlide(d.slides[1], d, {}), /data-count="\$4\.2M"/);
  assert.ok(fitSize('Hi', 100) > fitSize('A much longer headline that keeps going on', 100));
  assert.deepEqual(parseCount('$4.2M'), { prefix: '$', value: 4.2, decimals: 1, suffix: 'M', comma: false });
  assert.deepEqual(parseCount('12,000+'), { prefix: '', value: 12000, decimals: 0, suffix: '+', comma: true });
  assert.equal(parseCount('n/a'), null);
  assert.equal(esc('"<&>\''), '&quot;&lt;&amp;&gt;&#39;');
});

test('chart geometry: grouped bars scale to a nice maximum, lines get one point per label', () => {
  const g = chartGeometry({ type: 'bar', labels: ['Q1', 'Q2', 'Q3'], series: [{ name: 'a', values: [10, 20, 40] }, { name: 'b', values: [5, 15, 30] }], prefix: '$', suffix: 'k' }, 600, 400);
  assert.equal(g.bars.length, 6);
  assert.equal(g.max, 50);
  const [b0, , b2] = g.bars;
  assert.ok(b2.h > b0.h * 3.9 && b2.h < b0.h * 4.1, 'bar heights are proportional');
  assert.equal(g.bars[2].label, '$40k');
  assert.ok(g.bars.every((b) => b.y >= 0 && b.y + b.h <= 400 && b.x >= 0 && b.x + b.w <= 600));
  const l = chartGeometry({ type: 'line', labels: ['a', 'b', 'c', 'd'], series: [{ name: 'x', values: [1, 3, 2, 4] }], prefix: '', suffix: '%' }, 640, 480);
  assert.equal(l.lines[0].points.length, 4);
  assert.match(l.lines[0].d, /^M[\d.]+ [\d.]+ L/);
});

// ---------------------------------------------------------------- share
test('share links round-trip the deck and leave local images behind', async () => {
  const d = templateDeck('portfolio');
  d.slides[0].image.src = 'asset:local-photo';
  assert.equal(localImageCount(d), 1);
  const code = await encodeDeck(d);
  assert.match(code, /^z[\w-]+$/);
  assert.ok(code.length < 9000, `link payload is ${code.length} chars`);
  const back = await decodeDeck(code);
  assert.deepEqual(back, sanitizeDeck(shareable(d)));
  assert.equal(back.slides[0].image.src, '');
  assert.equal(back.slides[0].image.prompt, d.slides[0].image.prompt);
  assert.equal(back.slides[2].items[0].image.src, d.slides[2].items[0].image.src);
  const plainCode = `j${Buffer.from(JSON.stringify({ title: 'Plain', slides: [{ layout: 'statement', title: 'Hi' }] })).toString('base64url')}`;
  assert.equal((await decodeDeck(plainCode)).title, 'Plain');
  await assert.rejects(() => decodeDeck('xnope'), /not a Chucksi deck/);
});

// ---------------------------------------------------------------- export
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyQAAAABJRU5ErkJggg==', 'base64');
/** A scene like extractScene() makes in the browser, built straight from the spec. */
function sceneFor(s, i) {
  const words = String(s.title || s.value || s.quote || 'Slide').replace(/\*/g, '').split(/\s+/).slice(0, 8);
  let x = 92;
  const items = [
    { t: 'rect', x: 0, y: 0, w: 1280, h: 8, r: 0, fill: '#cf3b18', a: 1 },
    { t: 'rect', x: 1000, y: 500, w: 200, h: 200, r: 100, fill: '#51deec', a: 0.2 },
    { t: 'text', x: 92, y: 120, w: 1000, h: 90, align: 'left', lh: 90, lines: [{ y: 190, words: words.map((_, k) => k) }], words: words.map((w) => { const o = { s: w, x, y: 190, w: w.length * 30, size: 72, family: 'Instrument Sans', weight: 700, style: 'normal', color: '#1d1712', a: 1, ls: i % 2 ? 1.5 : 0 }; x += w.length * 30 + 18; return o; }) },
  ];
  if (imageSlots(s).some(([, im]) => im.src)) items.push({ t: 'img', x: 700, y: 0, w: 580, h: 720, r: i % 3 ? 0 : 290, src: 'test.png', nw: 2, nh: 2, sx: 0, sy: 0, sw: 2, sh: 2, a: 1 });
  if (s.layout === 'chart') {
    items.push({ t: 'chart', x: 560, y: 160, w: 640, h: 480, data: s.chart, colors: ['#51deec', '#b897f0'], ink: '#f1f6fa', muted: '#a0a8b4', grid: '#2a3242' });
    items.push({ t: 'path', d: roundRectPath(40, 200, 6).replace('M6 0', 'M106 200'), ox: 560, oy: 160, k: 1, fill: '#51deec', fa: 1, stroke: null, sa: 1, sw: 0, g: 'chart' });
    items.push({ t: 'path', d: 'M0 300L100 200L200 250', ox: 560, oy: 160, k: 1, fill: null, fa: 1, stroke: '#51deec', sa: 1, sw: 5, cap: 'round', g: 'chart' });
  }
  return { w: 1280, h: 720, bg: '#0d1528', items };
}

test('PDF export: one 16:9 page per slide with real text and embedded images', async () => {
  const d = templateDeck('pitch');
  const scenes = d.slides.map(sceneFor);
  const { bytes, report } = await buildPdf(scenes, PDFLib, { title: d.title, fontBytes: async () => null, imageBytes: async () => ({ bytes: PNG, type: 'png' }) });
  const pdf = await PDFLib.PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), d.slides.length);
  for (const p of pdf.getPages()) assert.deepEqual([p.getWidth(), p.getHeight()], [960, 540]);
  assert.equal(pdf.getTitle(), d.title);
  assert.equal(pdf.getCreator(), 'Chucksi Slides');
  assert.ok(report.fallbackWords > 0, 'without font bytes the writer falls back to Helvetica');
  const raw = Buffer.from(bytes).toString('latin1');
  assert.ok((raw.match(/\/Subtype \/Image/g) || []).length >= 1, 'images are embedded');
  assert.match(raw, /\/BaseFont \/Helvetica/);
});

test('PPTX export: slides, notes, a native chart and images in the zip', async () => {
  const d = templateDeck('pitch');
  const scenes = d.slides.map(sceneFor);
  const pptx = await buildPptx(scenes, d, PptxGenJS, { imageData: async () => `data:image/png;base64,${PNG.toString('base64')}` });
  const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }));
  const files = Object.keys(zip.files);
  const slides = files.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  assert.equal(slides.length, d.slides.length);
  const charts = files.filter((f) => /^ppt\/charts\/chart\d+\.xml$/.test(f));
  assert.equal(charts.length, d.slides.filter((s) => s.layout === 'chart').length);
  assert.ok(files.some((f) => /^ppt\/media\/image/.test(f)), 'images');
  const notes = files.filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f));
  assert.equal(notes.length, d.slides.length);
  const s1 = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(s1, /Budgets/);
  assert.match(s1, /latin typeface="Instrument Sans"/);
  const n1 = await zip.file('ppt/notesSlides/notesSlide1.xml').async('string');
  assert.match(n1, /one-line promise/);
  const chartSlide = d.slides.findIndex((s) => s.layout === 'chart') + 1;
  const sx = await zip.file(`ppt/slides/slide${chartSlide}.xml`).async('string');
  assert.match(sx, /graphicFrame/);
  assert.doesNotMatch(sx, /M0 300/);
  const pres = await zip.file('ppt/presentation.xml').async('string');
  assert.match(pres, /sldSz cx="12192000" cy="6858000"/);
});

test('HTML player export is one self-contained file', async () => {
  const d = templateDeck('report');
  const slides = d.slides.map((s, i) => ({ html: renderSlide(s, d, { index: i, total: d.slides.length, resolve: () => 'data:image/png;base64,AAAA' }), notes: s.notes }));
  const css = withoutFontFaces(await readFile(pub('/css/deck.css'), 'utf8'));
  assert.doesNotMatch(css, /url\(/);
  const html = buildHtml({ title: d.title, slides, css, fontCSS: '@font-face{font-family:x;src:url(data:font/woff2;base64,AAAA)}', runtime: deckRuntime.toString(), accent: '#084ee8' });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /const SLIDES = \[/);
  assert.match(html, /RT\.Player\(SLIDES/);
  assert.doesNotMatch(html, /(?:src|href)="https?:|url\(https?:/, 'no external requests');
  assert.ok(!html.includes('</script><'), 'slide markup cannot close the script early');
  const scripts = html.match(/<script>[\s\S]*?<\/script>/g);
  assert.equal(scripts.length, 1);
});

test('the runtime survives toString() and the exporters pin their CDN versions', () => {
  const rt = new Function(`return (${deckRuntime.toString()})`)()();
  for (const k of ['playIn', 'settle', 'transition', 'playAfter', 'Player', 'parseCount']) assert.equal(typeof rt[k], 'function', k);
  assert.deepEqual(rt.parseCount('31%'), { prefix: '', value: 31, decimals: 0, suffix: '%', comma: false });
  assert.doesNotMatch(deckRuntime.toString(), /\bimport\b|\brequire\(/);
  for (const url of Object.values(CDN)) assert.match(url, /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@[\w-]+\/)?[\w-]+@\d+\.\d+\.\d+\//);
  assert.deepEqual(parseColor('rgba(10, 20, 30, 0.5)'), { hex: '#0a141e', a: 0.5 });
  assert.equal(roundRectPath(10, 10, 0), 'M0 0H10V10H0Z');
});

// ---------------------------------------------------------------- page wiring
test('Office has a Slides tab, view and card', async () => {
  const html = await readFile(pub('/office/index.html'), 'utf8');
  for (const id of ['t-slides', 'tab-slides', 'view-slides', 'p-slides', 'foot-slides', 'sp-write', 'sp-design', 'sp-slide']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.match(html, /\/css\/deck\.css/);
  assert.match(html, /\/css\/slides\.css/);
  const js = await readFile(pub('/js/pages/office.js'), 'utf8');
  assert.match(js, /const TABS = \[[^\]]*'slides'/);
  assert.match(js, /import\('\.\.\/slides\/app\.js'\)/);
  const studio = await readFile(pub('/studios/office/index.html'), 'utf8');
  assert.match(studio, /href="\/office\?tab=slides/);
});
