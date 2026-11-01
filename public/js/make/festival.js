// Festival poster series: one ink on one ground, performers printed as flat silhouettes (or a two-tone
// photographic print) inside mid-century frames, a compressed display headline and a fixed kit of small parts
// (date, venue, lineup, oval badges, vertical stacks, rules) re-arranged per format: 3-5 posters + feed + story.

import { canvas, font, measure, text, fitSize, cover, grain, inkPrint, oklch, hashStr, clamp } from './kit.js';

export const PALETTES = {
  cobalt: { name: 'Cobalt on periwinkle', ink: oklch(0.3, 0.16, 266), ground: oklch(0.79, 0.075, 262) },
  oxblood: { name: 'Oxblood on blush', ink: oklch(0.32, 0.12, 22), ground: oklch(0.87, 0.055, 35) },
  forest: { name: 'Forest on mint', ink: oklch(0.3, 0.065, 165), ground: oklch(0.88, 0.065, 150) },
  mustard: { name: 'Ink on mustard', ink: oklch(0.2, 0.015, 80), ground: oklch(0.83, 0.15, 88) },
  plum: { name: 'Plum on peach', ink: oklch(0.29, 0.1, 335), ground: oklch(0.87, 0.07, 55) },
};
export const GENRES = {
  jazz: ['saxophone player', 'double bass player', 'trumpet player', 'pianist at a grand piano', 'drummer with cymbals'],
  electronic: ['DJ with headphones at a mixer', 'dancer with raised arms', 'producer at a synthesizer', 'singer with a microphone', 'crowd hands in the air'],
  folk: ['acoustic guitar player', 'fiddle player', 'banjo player', 'accordion player', 'singer with a tambourine'],
  classical: ['cellist', 'violinist', 'conductor with a baton', 'pianist', 'flautist'],
};
const HEAD = {
  serif: { family: 'DM Serif Display', weight: 400, tracking: -0.005, minScale: 0.58 },
  grotesk: { family: 'Big Shoulders Display', weight: 900, tracking: 0.005, minScale: 0.8 },
};
const SMALL = { family: 'DM Serif Display', weight: 400 };
const LABEL = { family: 'Archivo', weight: 800 };

export function festivalPrompt(genre, i, treatment) {
  const who = (GENRES[genre] || GENRES.jazz)[i % 5];
  return treatment === 'silhouette'
    ? `high-contrast black and white photograph of a ${who} as a dark full-figure silhouette against a plain bright white background, strong backlight, crisp edges, no text, no letters`
    : `high-contrast black and white concert photograph of a ${who} on stage, dramatic side light, smoke, grainy, 1960s photography, no text, no letters`;
}
const yearOf = (d) => (String(d).match(/\b(19|20)\d{2}\b/) || [''])[0];
export function splitTwo(name) {
  const w = String(name).trim().split(/\s+/);
  if (w.length < 2) return [w.join(' ')];
  let best = 1, bd = Infinity;
  for (let i = 1; i < w.length; i++) { const d = Math.abs(w.slice(0, i).join(' ').length - w.slice(i).join(' ').length); if (d < bd) { bd = d; best = i; } }
  return [w.slice(0, best).join(' '), w.slice(best).join(' ')];
}

/** Draw a line compressed horizontally (never stretched) to fill maxW at cap height `size`. */
function squeezed(g, str, H, x, y, maxW, size, align = 'center') {
  font(g, { ...H, size });
  const w = measure(g, str);
  let sx = Math.min(1, maxW / w);
  if (sx < H.minScale) { size *= sx / H.minScale; font(g, { ...H, size }); sx = H.minScale; }
  const ww = measure(g, str) * sx;
  g.save();
  g.translate(align === 'center' ? x - ww / 2 : align === 'right' ? x - ww : x, y);
  g.scale(sx, 1);
  g.textAlign = 'left';
  text(g, str, 0, 0);
  g.restore();
  return { width: ww, size };
}
function shapePath(g, kind, x, y, w, h) {
  g.beginPath();
  if (kind === 'arch') { const r = w / 2; g.moveTo(x, y + h); g.lineTo(x, y + r); g.arc(x + r, y + r, r, Math.PI, 0); g.lineTo(x + w, y + h); g.closePath(); }
  else if (kind === 'circle') { const r = Math.min(w, h) / 2; g.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2); }
  else g.roundRect(x, y, w, h, Math.min(w, h) * 0.06);
}
function badge(g, lines, cx, cy, rx, ry, ink) {
  g.save();
  g.strokeStyle = ink; g.lineWidth = Math.max(2, rx * 0.035);
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.stroke();
  const size = ry * (lines.length > 1 ? 0.5 : 0.62);
  font(g, { ...SMALL, size });
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  lines.forEach((l, i) => text(g, l.toUpperCase(), cx, cy + size * 0.36 + (i - (lines.length - 1) / 2) * size * 1.02));
  g.restore();
}
function stack(g, str, x, y, size, gap, ink) {
  font(g, { ...SMALL, size });
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  [...str.toUpperCase()].forEach((ch, i) => text(g, ch, x, y + i * gap));
}
const badgeLines = (b) => { const w = b.split(/\s+/); if (w.length < 2 || b.length < 9) return [b]; const h = Math.ceil(w.length / 2); return [w.slice(0, h).join(' '), w.slice(h).join(' ')]; };

export default {
  id: 'festival',
  fields: [
    { key: 'name', label: 'Event name', max: 40 },
    { key: 'dates', label: 'Dates', max: 40 },
    { key: 'venue', label: 'Venue', max: 50 },
    { key: 'lineup', label: 'Lineup', type: 'textarea', rows: 5, max: 500, hint: 'One act per line. Poster 1 headlines the first act, poster 2 the second, and so on.' },
    { key: 'badges', label: 'Badges', max: 80, hint: 'Separate with “·”. They become the oval stamps.' },
    { key: 'genre', label: 'Music (for the photographs)', type: 'select', options: [['jazz', 'Jazz'], ['electronic', 'Electronic'], ['folk', 'Folk'], ['classical', 'Classical']] },
    { key: 'palette', label: 'Two colours', type: 'select', options: Object.entries(PALETTES).map(([k, v]) => [k, v.name]) },
    { key: 'type', label: 'Headline type', type: 'select', options: [['serif', 'Compressed serif'], ['grotesk', 'Condensed grotesk']] },
    { key: 'treatment', label: 'Photographs', type: 'select', options: [['silhouette', 'Printed silhouettes'], ['duotone', 'Two-tone photographs']] },
    { key: 'count', label: 'Posters in the series', type: 'range', min: 3, max: 5 },
  ],
  presets: [{
    state: { name: 'Harbourlight Jazz Weekend', dates: '12–14 June 2027', venue: 'Riverside Gardens, Old Town', lineup: 'Mara Quist Quartet\nThe Low Tide Trio\nInes Okafor\nFelix Brand & the Night Shift\nDelta Hour Big Band', badges: 'Live music · Food & drinks · All ages', genre: 'jazz', palette: 'cobalt', type: 'serif', treatment: 'silhouette', count: 3 },
    samples: { p0: '/media/make/samples/fest-1.webp', p1: '/media/make/samples/fest-4.webp', p2: '/media/make/samples/fest-2.webp', p3: '/media/make/samples/fest-5.webp', p4: '/media/make/samples/fest-3.webp' },
  }],
  frames: (s) => clamp(Number(s.count) || 3, 3, 5),
  surprise(r) {
    const ideas = [
      ['Northern Lights Folk Gathering', '2–4 August 2027', 'Hollow Hill Farm', 'The Wren Sisters\nOld Pine Stringband\nAnnick Dalla\nCalloway Road', 'Camping · Workshops · Family tickets', 'folk'],
      ['Afterhours Electronic Festival', '18–19 September 2027', 'The Old Gasworks', 'NOVA HALE\nKiln\nSister Static\nUnderpass Choir', 'Two stages · Until 4 am · 18+', 'electronic'],
      ['Midsummer Strings', '21 June 2027', 'Glasshouse Hall', 'The Arden Quartet\nLina Petrov, cello\nYoung Sinfonia\nRuth Amsel, violin', 'Evening concerts · Garden picnic · Free under 12', 'classical'],
      ['Blue Hour Jazz Nights', '5–7 October 2027', 'The Corn Exchange', 'Sol Ibarra Sextet\nNight Owl Trio\nGrace Mbeki\nThe Late Set Orchestra', 'Live music · Late bar · All ages', 'jazz'],
    ];
    const [name, dates, venue, lineup, badges, genre] = ideas[Math.floor(r() * ideas.length)];
    const pk = Object.keys(PALETTES);
    return { name, dates, venue, lineup, badges, genre, palette: pk[Math.floor(r() * pk.length)], type: r() < 0.6 ? 'serif' : 'grotesk', treatment: r() < 0.65 ? 'silhouette' : 'duotone' };
  },
  async build(s, io) {
    const P = PALETTES[s.palette] || PALETTES.cobalt, Hd = HEAD[s.type] || HEAD.serif;
    const n = clamp(Number(s.count) || 3, 3, 5);
    const acts = s.lineup.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 12);
    const badges = s.badges.split(/\s*[·|,]\s*/).map((x) => x.trim()).filter(Boolean).slice(0, 3);
    const year = yearOf(s.dates), first = (s.name.split(/\s+/)[0] || 'LIVE').slice(0, 7);
    const head = splitTwo(s.name);
    const seed0 = 6000 + (hashStr(s.name) % 30000);
    const prints = [];
    for (let i = 0; i < n; i++) {
      const img = await io.image(`p${i}`, festivalPrompt(s.genre, i, s.treatment), 768, 1024, seed0 + i);
      prints.push(inkPrint(img, P.ink, P.ground, s.treatment === 'duotone' ? 'duotone' : 'silhouette', 768, 1024));
    }
    io.status('Printing the series…');
    const shapes = ['arch', 'circle', 'rect'];

    const frame = (g, i, x, y, w, h) => {
      const kind = shapes[i % 3];
      g.save();
      shapePath(g, kind, x, y, w, h);
      g.clip();
      cover(g, prints[i % prints.length], x, y, w, h, { zoom: 1.02, py: -0.1 });
      g.restore();
      g.save(); g.strokeStyle = P.ink; g.lineWidth = Math.max(3, w * 0.006); shapePath(g, kind, x, y, w, h); g.stroke(); g.restore();
    };
    const rule = (g, x1, y, x2, wgt = 3) => { g.fillStyle = P.ink; g.fillRect(x1, y, x2 - x1, wgt); };
    const info = (g, lines, x, y, size, align) => { font(g, { ...SMALL, size }); g.fillStyle = P.ink; g.textAlign = align; lines.forEach((l, k) => text(g, l.toUpperCase(), x, y + k * size * 1.02)); };
    const datesTwo = () => { const d = s.dates.replace(year, '').replace(/[,\s]+$/, '').trim(); return year ? [d, year] : [d]; };
    const venueTwo = () => { const p = s.venue.split(/,\s*/); return p.length > 1 ? [p[0], p.slice(1).join(', ')] : [s.venue]; };
    const headline = (g, W, x, y, maxW, capH) => {
      g.fillStyle = P.ink; g.textBaseline = 'alphabetic';
      const lines = head.map((l) => l.toUpperCase());
      let yy = y;
      for (const l of lines) { yy += capH; squeezed(g, l, Hd, x, yy, maxW, capH * (Hd.family.startsWith('Big') ? 1.3 : 1.42)); yy += capH * 0.16; }
      return yy;
    };
    const lineupBlock = (g, i, cx, y, w, big) => {
      const star = acts[i % Math.max(1, acts.length)] || '';
      const others = acts.filter((_, k) => k !== i % Math.max(1, acts.length));
      g.fillStyle = P.ink; g.textAlign = 'center';
      squeezed(g, star.toUpperCase(), { ...SMALL, tracking: 0.01, minScale: 0.7 }, cx, y + big, w, big);
      font(g, { ...LABEL, size: big * 0.3, tracking: 0.16 });
      text(g, 'WITH', cx, y + big * 1.62);
      font(g, { ...SMALL, size: big * 0.42 });
      const line = others.slice(0, 4).join('  ·  ').toUpperCase();
      squeezed(g, line, { ...SMALL, tracking: 0.02, minScale: 0.55 }, cx, y + big * 2.3, w, big * 0.42);
      return y + big * 2.5;
    };

    function poster(i, W, H, variant) {
      const c = canvas(W, H), g = c.getContext('2d');
      g.fillStyle = P.ground; g.fillRect(0, 0, W, H);
      grain(g, W, H, 0.14, 21 + i);
      const M = W * 0.06, inner = W - 2 * M;
      const stackSize = W * 0.034;
      if (variant === 'story') {
        headline(g, W, W / 2, M * 1.4, inner, W * 0.13);
        frame(g, i, M + inner * 0.09, H * 0.27, inner * 0.82, H * 0.42);
        info(g, datesTwo(), M, H * 0.75, W * 0.045, 'left');
        info(g, venueTwo(), W - M, H * 0.75, W * 0.045, 'right');
        rule(g, M, H * 0.8, W - M);
        lineupBlock(g, i, W / 2, H * 0.815, inner, W * 0.07);
        badges.forEach((b, k) => badge(g, badgeLines(b), M + inner * (0.17 + k * 0.33), H * 0.95, inner * 0.14, W * 0.045, P.ink));
      } else if (variant === 'feed') {
        frame(g, i, M + inner * 0.2, M, inner * 0.6, H * 0.4);
        stack(g, first, M + stackSize * 0.5, M + stackSize, stackSize, stackSize * 1.25, P.ink);
        stack(g, year || 'LIVE', W - M - stackSize * 0.5, M + stackSize, stackSize, stackSize * 1.25, P.ink);
        const yH = headline(g, W, W / 2, H * 0.46, inner, W * 0.1);
        rule(g, M, yH + H * 0.015, W - M);
        info(g, datesTwo(), M, yH + H * 0.06, W * 0.04, 'left');
        info(g, venueTwo(), W - M, yH + H * 0.06, W * 0.04, 'right');
        badges.slice(0, 2).forEach((b, k) => badge(g, badgeLines(b), W / 2 + (k ? 1 : -1) * inner * 0.13, H - M - W * 0.06, inner * 0.115, W * 0.055, P.ink));
      } else {
        const top = i % 2 === 0;
        const imgY = top ? M : H * 0.4, imgH = H * 0.42;
        frame(g, i, M + inner * 0.14, imgY, inner * 0.72, imgH);
        stack(g, first, M + stackSize * 0.5, imgY + stackSize * 1.2, stackSize, stackSize * 1.3, P.ink);
        stack(g, year || 'LIVE', W - M - stackSize * 0.5, imgY + stackSize * 1.2, stackSize, stackSize * 1.3, P.ink);
        const ty = top ? H * 0.485 : M * 0.9;
        info(g, datesTwo(), M, ty + W * 0.03, W * 0.03, 'left');
        info(g, venueTwo(), W - M, ty + W * 0.03, W * 0.03, 'right');
        const yH = headline(g, W, W / 2, ty + W * 0.07, inner, W * 0.105);
        rule(g, M, yH + W * 0.012, W - M);
        const yL = lineupBlock(g, i, W / 2, yH + W * 0.03, inner * 0.9, W * 0.06);
        if (top) {
          badges.forEach((b, k) => badge(g, badgeLines(b), M + inner * (0.17 + k * 0.33), Math.min(H - M - W * 0.06, yL + (H - M - yL) / 2 + W * 0.01), inner * 0.135, W * 0.06, P.ink));
        } else {
          badges.forEach((b, k) => badge(g, badgeLines(b), M + inner * (0.17 + k * 0.33), H - M - W * 0.05, inner * 0.135, W * 0.06, P.ink));
        }
      }
      return c;
    }
    const boards = [];
    for (let i = 0; i < n; i++) boards.push({ id: `poster-${i + 1}`, label: `Poster ${i + 1} · ${acts[i % Math.max(1, acts.length)] || s.name}`, canvas: poster(i, 1200, 1800, 'poster'), print: true });
    boards.push({ id: 'feed-1080x1350', label: 'Feed post 1080 × 1350', canvas: poster(0, 1080, 1350, 'feed') });
    boards.push({ id: 'story-1080x1920', label: 'Story 1080 × 1920', canvas: poster(1, 1080, 1920, 'story') });
    return { name: s.name, prompt: festivalPrompt(s.genre, 0, s.treatment), layout: 'series', boards };
  },
};
