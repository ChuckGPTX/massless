// Poetry posters: a poem set as an editorial poster series. Big verse, tiny captions, two text sizes only,
// a strict column grid with offset blocks, one rotated layout, crop-marked image frames from an optional FLUX
// texture printed in the series ink.

import { canvas, font, measure, text, fitSize, cover, grain, inkPrint, oklch, hashStr, clamp } from './kit.js';

const W = 1200, H = 1800, M = 84, COLS = 6, GUT = 18;
const colX = (i) => M + i * ((W - 2 * M + GUT) / COLS);
export const INKS = { black: ['Black', '#161616'], ultramarine: ['Ultramarine', oklch(0.44, 0.23, 268)], vermilion: ['Vermilion', oklch(0.6, 0.21, 33)], forest: ['Forest', oklch(0.4, 0.08, 158)] };
export const PAPERS = { warm: ['Warm white', '#f2efe7'], cool: ['Cool white', '#eef0ef'], grey: ['Newsprint', '#dedcd4'] };
export const TYPES = {
  grotesk: { name: 'Grotesk capitals', verse: { family: 'Archivo', weight: 800, tracking: -0.018 }, upper: true, lead: 0.88, cap: { family: 'Archivo', weight: 800, tracking: 0.01 } },
  serif: { name: 'Serif', verse: { family: 'Instrument Serif', weight: 400, tracking: -0.012 }, upper: false, lead: 0.94, cap: { family: 'IBM Plex Mono', weight: 500, tracking: 0.04 } },
  mono: { name: 'Mono capitals', verse: { family: 'IBM Plex Mono', weight: 500, tracking: -0.03 }, upper: true, lead: 1.0, cap: { family: 'IBM Plex Mono', weight: 500, tracking: 0.04 } },
};
export const LAYOUTS = ['offset', 'rotated', 'monument', 'centred', 'split'];

/** Split a poem into n non-empty chunks, stanza-first, in reading order. */
export function splitPoem(src, n) {
  const stanzas = String(src || '').split(/\n\s*\n/).map((s) => s.split('\n').map((l) => l.trim()).filter(Boolean)).filter((s) => s.length);
  const lines = stanzas.flat();
  if (!lines.length) return Array.from({ length: n }, () => ['Untitled']);
  let chunks = stanzas.map((s) => [...s]);
  while (chunks.length > n) { // merge the two shortest neighbours
    let best = 0;
    for (let i = 1; i < chunks.length - 1; i++) if (chunks[i].length + chunks[i + 1].length < chunks[best].length + chunks[best + 1].length) best = i;
    chunks.splice(best, 2, [...chunks[best], ...chunks[best + 1]]);
  }
  while (chunks.length < n) { // split the longest chunk, or reuse lines when the poem is shorter than the series
    let li = 0;
    chunks.forEach((c, i) => { if (c.length > chunks[li].length) li = i; });
    if (chunks[li].length < 2) { chunks.push([lines[chunks.length % lines.length]]); continue; }
    const c = chunks[li], half = Math.ceil(c.length / 2);
    chunks.splice(li, 1, c.slice(0, half), c.slice(half));
  }
  return chunks;
}

/** Break words into lines of about `chars` characters each (greedy, by character count). */
export function breakAt(words, chars) {
  const out = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > chars) { out.push(line); line = w; } else line = line ? line + ' ' + w : w;
  }
  if (line) out.push(line);
  return out;
}

function cropMarks(ctx, x, y, w, h, ink) {
  const a = 14, o = 6;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [cx, cy, sx, sy] of [[x, y, -1, -1], [x + w, y, 1, -1], [x, y + h, -1, 1], [x + w, y + h, 1, 1]]) {
    ctx.moveTo(cx + sx * o, cy); ctx.lineTo(cx + sx * (o + a), cy);
    ctx.moveTo(cx, cy + sy * o); ctx.lineTo(cx, cy + sy * (o + a));
  }
  ctx.stroke();
  ctx.restore();
}

export default {
  id: 'poetry',
  fields: [
    { key: 'title', label: 'Title', max: 40 },
    { key: 'poem', label: 'Poem or text', type: 'textarea', rows: 9, max: 1400, hint: 'Leave a blank line between stanzas. Each poster takes one part.' },
    { key: 'source', label: 'Author or source', max: 50 },
    { key: 'count', label: 'Posters in the series', type: 'range', min: 3, max: 5 },
    { key: 'type', label: 'Type', type: 'select', options: Object.entries(TYPES).map(([k, v]) => [k, v.name]) },
    { key: 'ink', label: 'Ink', type: 'select', options: Object.entries(INKS).map(([k, v]) => [k, v[0]]) },
    { key: 'paper', label: 'Paper', type: 'select', options: Object.entries(PAPERS).map(([k, v]) => [k, v[0]]) },
    { key: 'texture', label: 'FLUX texture frames', type: 'check', hint: 'One painted texture, cropped into small framed images and printed in the ink.' },
    { key: 'seed', label: 'Layout variation', type: 'range', min: 0, max: 4 },
  ],
  presets: [{
    state: {
      title: 'Small Maps', source: 'Text written for Chucksi',
      poem: 'We wrote the day on the back of a receipt,\nfolded it twice and called it a map.\n\nThe city leaned in to listen,\nthen went on with its errands.\n\nEvery window held a different weather.\nWe chose the one with the kettle on.\n\nNothing is lost that was first loved\nall the way down to its edges.',
      count: 4, type: 'grotesk', ink: 'black', paper: 'warm', texture: true, seed: 0,
    },
    samples: { tex: '/media/make/samples/poem-tex.webp' },
  }],
  frames: (s) => (s.texture ? 1 : 0),
  surprise(r) {
    const ideas = [
      ['Weather Report', 'Light rain over the old harbour,\nclearing by the second coffee.\n\nA high pressure of small talk\nsettles across the market.\n\nTonight: stars, mostly,\nand a chance of staying out.', 'A forecast in three parts'],
      ['Instructions for a Slow Day', 'Open the window before the news.\nLet the bread take its time.\n\nWalk to the end of the street\nand back, by the long way.\n\nAnswer nothing until noon.\nWrite one true sentence.', 'House rules'],
      ['Field Recording', 'The microphone hears the river first,\nthen the bridge, then us.\n\nWe stand very still\nso the birds will continue.\n\nLater, at home, the tape\nremembers what we missed.', 'Notes from a walk'],
    ];
    const [title, poem, source] = ideas[Math.floor(r() * ideas.length)];
    const keys = (o) => Object.keys(o);
    return { title, poem, source, type: keys(TYPES)[Math.floor(r() * 3)], ink: keys(INKS)[Math.floor(r() * 4)], paper: keys(PAPERS)[Math.floor(r() * 3)], seed: Math.floor(r() * 5), count: 3 + Math.floor(r() * 3), texture: true };
  },
  async build(s, io) {
    const T = TYPES[s.type] || TYPES.grotesk, ink = (INKS[s.ink] || INKS.black)[1], paper = (PAPERS[s.paper] || PAPERS.warm)[1];
    const n = clamp(Number(s.count) || 4, 3, 5);
    const chunks = splitPoem(s.poem, n);
    let tex = null;
    if (s.texture) {
      const img = await io.image('tex', 'abstract risograph ink texture, soft ink bleed on grainy paper, organic shapes, high contrast, minimal, no text, no letters', 768, 1024, 4000 + (hashStr(s.title) % 5000));
      tex = inkPrint(img, ink, paper, 'duotone', 768, 1024);
    }
    io.status('Setting the type…');
    const up = (l) => (T.upper ? l.toUpperCase() : l);
    const CAP = 19;
    const posters = chunks.map((lines, i) => {
      const c = canvas(W, H), g = c.getContext('2d');
      g.fillStyle = paper; g.fillRect(0, 0, W, H);
      grain(g, W, H, 0.12, 11 + i);
      g.fillStyle = ink;
      g.textBaseline = 'alphabetic';
      const cap = (str, x, y, align = 'left') => { font(g, { ...T.cap, size: CAP }); g.fillStyle = ink; g.textAlign = align; text(g, str.toUpperCase(), x, y); };
      const capBlock = (list, x, y, align = 'left') => list.forEach((l, k) => cap(l, x, y + k * CAP * 1.12, align));
      const verse = (list, x, y, size, align = 'left') => {
        font(g, { ...T.verse, size });
        g.fillStyle = ink; g.textAlign = align;
        list.forEach((l, k) => text(g, up(l), x, y + size * 0.78 + k * size * T.lead));
        return y + size * 0.78 + (list.length - 1) * size * T.lead;
      };
      const fit = (list, maxW, maxH) => Math.min(fitSize(g, list.map(up), T.verse, maxW), maxH / (list.length * T.lead));
      // Re-break the verse for the box: try measures from 6 to 40 characters, keep the one that sets it biggest.
      const set = (list, maxW, maxH) => {
        const words = list.join(' ').split(/\s+/).filter(Boolean);
        let best = { lines: list, size: fit(list, maxW, maxH) };
        for (let chars = 6; chars <= 40; chars += 2) {
          const ls = breakAt(words, chars);
          if (ls.length > 9) continue;
          const size = fit(ls, maxW, maxH);
          if (size > best.size * 1.02) best = { lines: ls, size };
        }
        return best;
      };
      const frame = (x, y, w, h, k) => {
        if (!tex) return;
        g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
        cover(g, tex, x, y, w, h, { zoom: 2.2 + (k % 3) * 0.6, px: ((k * 37) % 9) / 4 - 1, py: ((k * 53) % 9) / 4 - 1 });
        g.restore();
        cropMarks(g, x, y, w, h, ink);
      };
      // running head: number, title, source
      const num = `${n > 1 ? '0.' : ''}${i + 1}`;
      cap(num, M, M);
      cap(s.title, colX(2), M);
      cap(s.source, W - M, M, 'right');
      cap(`${i + 1} / ${n}`, W - M, H - M + CAP, 'right');
      const layout = LAYOUTS[(i + (Number(s.seed) || 0)) % LAYOUTS.length];
      const k = i + (Number(s.seed) || 0);
      if (layout === 'offset') {
        const half = Math.ceil(lines.length / 2);
        const A = set(lines.slice(0, half), W - 2 * M, H * 0.3);
        const B = lines.length > half ? set(lines.slice(half), W - M - colX(2), H * 0.27) : null;
        const size = B ? Math.min(A.size, B.size) : A.size;
        const endA = verse(A.lines, M, H * 0.1, size);
        if (B) { const yB = Math.max(endA + size * 0.9, H * 0.47); verse(B.lines, colX(2), yB, size); cap('0.2', colX(2) - 4, yB - CAP * 0.6); }
        frame(colX(4), H * 0.8, colX(6) - colX(4) - GUT, H * 0.11, k);
        frame(M, H * 0.84, colX(1) - M - GUT + 40, H * 0.07, k + 1);
        capBlock(['Set in ' + T.verse.family, 'Poster series'], colX(1) + 70, H * 0.865);
      } else if (layout === 'rotated') {
        g.save();
        g.translate(W - M, H - M);
        g.rotate(-Math.PI / 2);
        const R = set(lines, H - 2 * M - 40, W * 0.62);
        const size = R.size;
        font(g, { ...T.verse, size });
        g.fillStyle = ink; g.textAlign = 'left';
        R.lines.forEach((l, j) => text(g, up(l), 0, -(R.lines.length - 1 - j) * size * T.lead - size * 0.06));
        g.restore();
        frame(M, H * 0.16, colX(2) - M - GUT, H * 0.16, k);
        capBlock(['Read upwards', 'from the corner'], M, H * 0.16 + H * 0.16 + 34);
        frame(M, H * 0.62, colX(1) - M + 30, H * 0.1, k + 2);
        capBlock([`${lines.length} lines`, s.source], M, H * 0.75);
      } else if (layout === 'monument') {
        const hero = [...lines].sort((p, q) => p.split(' ').length - q.split(' ').length)[0];
        const wordsArr = hero.replace(/[.,;:]+$/, '').split(/\s+/);
        const size = fit(wordsArr, W - 2 * M, H * 0.62);
        verse(wordsArr, M - size * 0.03, H * 0.13, size);
        const rest = lines.map((l) => (l === hero ? '[' + l + ']' : l));
        capBlock(rest, colX(3), H * 0.82);
        capBlock(['A line,', 'made monument'], M, H * 0.82);
        frame(colX(1) + 40, H * 0.82 - 10, colX(3) - colX(1) - 70, H * 0.09, k);
      } else if (layout === 'centred') {
        const S = set(lines, W - 2 * M - 80, H * 0.56);
        const size = S.size;
        const blockH = size * 0.78 + (S.lines.length - 1) * size * T.lead;
        const y0 = (H - blockH) / 2 - size * 0.1;
        verse(S.lines, W / 2 + 20, y0, size, 'center');
        S.lines.forEach((l, j) => cap(String(j + 1).padStart(2, '0'), M, y0 + size * 0.78 + j * size * T.lead - size * 0.32));
        capBlock(['Read aloud,', 'slowly'], W - M, H * 0.84, 'right');
        frame(M, H * 0.8, colX(2) - M - GUT, H * 0.1, k);
      } else {
        frame(M, H * 0.1, W - 2 * M, H * 0.38, k);
        if (!tex) { g.fillStyle = ink; g.fillRect(M, H * 0.1, W - 2 * M, H * 0.38); }
        capBlock(['Fig. ' + (i + 1), 'Texture study'], M, H * 0.52);
        const S = set(lines, W - M - colX(1), H * 0.33);
        verse(S.lines, colX(1), H * 0.55, S.size);
      }
      return c;
    });
    return {
      name: s.title,
      layout: 'series',
      boards: posters.map((c, i) => ({ id: `poster-${i + 1}`, label: `Poster ${i + 1} of ${n}`, canvas: c, print: true })),
    };
  },
};
