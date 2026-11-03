// Seed posts for Chucksi Explore, made from loops and posters already in this repository (public/media/templates,
// recorded by Chucksi's own tools; see public/media/templates/provenance.json). Each post's Remix link is the same
// working entry point the Workflows gallery uses (public/js/workflow-data.js GALLERY).
//
//   node tools/explore/seed.mjs            write tools/explore/seed/seed.sql and tools/explore/seed/apply.sh
//   node tools/explore/seed.mjs --check    only validate (used by tests/explore.test.js)
//
// Nothing here touches production. To apply (after migrations/explore/0001_init.sql):
//   sh tools/explore/seed/apply.sh           uploads media to R2 (chucksi-sites, explore/<id>/…) and inserts the rows
// The SQL uses INSERT OR IGNORE, so running it twice is harmless. Remove the seed posts with:
//   npx wrangler d1 execute massless-sign --remote --command "DELETE FROM explore_posts WHERE owner = 'chucksi'"

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GALLERY, CAMERA_MOVES } from '../../public/js/workflow-data.js';
import { checkMeta, checkMedia, MEDIA_TYPES } from '../../src/explore.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'tools', 'explore', 'seed');
const BUCKET = 'chucksi-sites';
const DB = 'massless-sign';

// [gallery card id, tool, tags] — a mix of effects, camera moves, design kits, websites and games
export const SEED_PICKS = [
  ['fx-hologram-ion', 'video', ['effect', 'hologram']],
  ['design-fest-harbourlight', 'design', ['poster', 'festival']],
  ['move-arc-right', 'video', ['camera-move']],
  ['site-manifesto', 'website', ['website', 'type']],
  ['fx-lidar-cyan', 'video', ['effect', 'lidar']],
  ['game-sky-tower', 'games', ['game', 'stack']],
  ['design-id-northwind', 'design', ['brand', 'identity']],
  ['fx-shatter-spectrum', 'video', ['effect', 'glass']],
  ['move-fpv', 'video', ['camera-move', 'drone']],
  ['design-map-saltmere', 'design', ['map', 'illustration']],
  ['fx-vanish-embers', 'video', ['effect', 'fire']],
  ['site-restaurant', 'website', ['website', 'food']],
  ['game-star-hornets', 'games', ['game', 'shooter']],
  ['fx-portal-cosmic', 'video', ['effect', 'portal']],
  ['design-film-tide', 'design', ['film-poem']],
  ['move-dolly-zoom', 'video', ['camera-move', 'vertigo']],
  ['fx-ink-signature', 'video', ['effect', 'ink']],
  ['design-poe-weather', 'design', ['poster', 'poetry']],
  ['site-photographer', 'website', ['website', 'portfolio']],
  ['fx-clones-rainbow', 'video', ['effect', 'neon']],
  ['game-deep-snack', 'games', ['game', 'ocean']],
  ['move-bullet-time', 'video', ['camera-move']],
  ['fx-kaleido-signature', 'video', ['effect', 'kaleidoscope']],
  ['design-id-pebble', 'design', ['brand', 'bakery']],
  ['site-conference', 'website', ['website', 'event']],
  ['fx-freeze', 'video', ['effect', 'freeze']],
];
const SIZE = { '16/9': [1280, 720], '3/4': [960, 1280], '4/5': [960, 1200], '1/1': [1080, 1080], '9/16': [720, 1280] };
const BASE = Date.UTC(2026, 10, 1, 12, 0, 0); // posts are spread over the day before launch, newest first
const sql = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

export function seedPosts() {
  return SEED_PICKS.map(([cardId, tool, tags], i) => {
    const card = [...GALLERY, ...CAMERA_MOVES].find((c) => c.id === cardId); // camera moves are one gallery card now
    if (!card) throw new Error(`seed: no gallery card ${cardId}`);
    const [width, height] = SIZE[card.ar] || [960, 1200];
    const meta = checkMeta({ title: card.name, tool, remix: card.href, tags, width, height });
    if (meta.error) throw new Error(`seed ${cardId}: ${meta.error}`);
    const mediaFile = join(ROOT, 'public', card.video);
    const posterFile = join(ROOT, 'public', card.poster);
    if (!existsSync(mediaFile) || !existsSync(posterFile)) throw new Error(`seed ${cardId}: media missing`);
    const media = checkMedia(new Uint8Array(readFileSync(mediaFile)), new Uint8Array(readFileSync(posterFile)));
    if (media.error) throw new Error(`seed ${cardId}: ${media.error}`);
    const id = `chucksi${String(i + 1).padStart(2, '0')}`;
    const at = BASE - i * 47 * 60000;
    return {
      id, cardId, mediaFile: card.video, posterFile: card.poster,
      row: {
        id, owner: 'chucksi', author: 'Chucksi', title: meta.title, tool: meta.tool, remix: meta.remix, link: null, tags: meta.tags.join(','),
        kind: media.kind, media_ext: media.mediaExt, poster_ext: media.posterExt, bytes: media.media.length + media.poster.length,
        width: meta.width, height: meta.height, created_at: at, listed_at: at,
      },
    };
  });
}

function write(posts) {
  mkdirSync(OUT, { recursive: true });
  const cols = Object.keys(posts[0].row);
  const lines = [
    '-- Chucksi Explore seed posts (generated by node tools/explore/seed.mjs; do not edit by hand).',
    '-- Media: public/media/templates (see provenance.json). Apply with: sh tools/explore/seed/apply.sh',
    ...posts.map((p) => `INSERT OR IGNORE INTO explore_posts (${cols.join(', ')}) VALUES (${cols.map((c) => sql(p.row[c])).join(', ')});`),
  ];
  writeFileSync(join(OUT, 'seed.sql'), `${lines.join('\n')}\n`);
  const sh = [
    '#!/bin/sh',
    '# Upload the Explore seed media to R2 and insert the seed rows. Generated by node tools/explore/seed.mjs.',
    '# Run from the repository root, after: npx wrangler d1 execute massless-sign --remote --file migrations/explore/0001_init.sql',
    'set -e',
    ...posts.flatMap((p) => [
      `npx wrangler r2 object put ${BUCKET}/explore/${p.id}/media.${p.row.media_ext} --file public${p.mediaFile} --content-type ${MEDIA_TYPES[p.row.media_ext]} --remote`,
      `npx wrangler r2 object put ${BUCKET}/explore/${p.id}/poster.${p.row.poster_ext} --file public${p.posterFile} --content-type ${MEDIA_TYPES[p.row.poster_ext]} --remote`,
    ]),
    `npx wrangler d1 execute ${DB} --remote --file tools/explore/seed/seed.sql`,
    '',
  ];
  writeFileSync(join(OUT, 'apply.sh'), sh.join('\n'), { mode: 0o755 });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const posts = seedPosts();
  if (!process.argv.includes('--check')) write(posts);
  console.log(`${posts.length} seed posts ${process.argv.includes('--check') ? 'valid' : `written to ${OUT}`}`);
}
