# Design workflow templates: what we learned, as rules

Five one-click design workflows live at `/workflows?make=<id>` (`map`, `identity`, `film-poem`, `poetry`, `festival`).
Each one was studied against a published reference for its **technique**, never its artwork, words, logos or
names. Nothing from the references ships in this repository; screenshots were kept outside the repo.

The rules below are what the code in `public/js/make/` actually enforces. When you change a template, keep the
rule or change this file with it.

## 1. Illustrated aerial map (`map.js`)

Reference: a series of animated top-down landscape illustrations (rice paddies, grassland, savanna, mustard fields).

What it does well
- **One vantage point, held strictly.** Everything is seen from directly above; no horizon, no perspective. The
  flatness is what makes it read as a map rather than a painting.
- **The edge is soft and painted.** The illustration sits on white paper with a feathered, brush-like border instead
  of a hard rectangle, so it feels like an object on a page.
- **Very quiet typography.** A small centred caption block under the image: place name, a one-line season note,
  coordinates in a tiny mono face. The type never competes with the picture.
- **A few living details** (a cloud shadow, a plane, cattle) give scale and time.

Rules we use
1. The FLUX prompt always says *seen from directly above, bird's-eye, flat cartographic illustration, no text*; the
   model never draws labels. All words are ours, in a vector layer, so they are editable and always spelled right.
2. The image is masked with a deterministic feathered edge (seeded noise) on a paper ground with 8–10 % margin.
3. Typography hierarchy is fixed: title (serif display, tracked caps or large italic), one-line subtitle, coordinates
   and scale in mono at ~35 % of the subtitle size. Max three sizes on the poster.
4. Labels are white-haloed pills or plain small caps with a 2–3 px paper-coloured stroke, so they read on any
   texture. A label has a dot (its point) and text offset to the right.
5. Cartographic furniture (compass, scale bar, legend) is thin, single-weight line work in the ink colour, kept in
   the margins, never on top of the busiest area.

## 2. Brand identity kit (`identity.js`)

Reference: a playful, very saturated identity system shown as a sequence of applications (type lock-ups, pills,
stickers, cards, merch, motion).

What it does well
- **The wordmark is the brand.** Heavy grotesque, tight spacing, lower case, shown huge and confident.
- **Few colours, used at full strength.** Large flat fields of a primary, with one or two accents and black/white.
- **A repeatable shape language** (pills, ovals, a radial line mark) shows up on every application, so totally
  different objects still look like one family.
- **Applications prove the system**: cards, posters, social tiles and merch, each one simple.

Rules we use
1. The wordmark is set in one of five OFL display faces with **tuned tracking per face** (negative for heavy
   grotesques, positive for wide faces) and optical kerning from the font. Lower case for friendly vibes, caps for
   serious ones.
2. The monogram is generated as SVG from a small shape grammar (circle, rounded square, arch, pill + initial or
   radial lines) on a 100-unit grid, so it scales and exports cleanly.
3. The palette is built in **OKLCH**: one primary at a vibe-specific hue, accents at hue offsets with matched
   lightness steps, plus ink and paper. Every text/background pair used on the board is checked for WCAG contrast
   ≥ 4.5 (body) or ≥ 3 (display); if a pair fails, the ink is swapped for paper or vice versa.
4. One pattern built from the mark's own shape, tiled on a grid; it is used on at least two applications.
5. Six applications, each a single idea: business card (front/back), poster, social post, shop sign, tote bag, sticker
   sheet. The board lays them out on a 12-column grid with captions in mono.
6. Tokens are exported as JSON (colours in hex and OKLCH, type, spacing) so the identity can move into code.

## 3. Film poem (`filmpoem.js`)

Reference: a short vertical film that sets a poem to archival images.

What it does well
- **Paper, not screen.** A pale grey-green paper ground and a typewriter/mono face; the film looks printed.
- **Typography as image.** The poem appears line by line, then its words are scattered onto a grid, then the whole
  text is set as a block: the same words, re-arranged, carry the rhythm.
- **Captions and running heads** ("fig. 12", title, credits in the corners) give the film the feel of a book.
- **Images are framed**, not full-bleed most of the time, and enter with a slow, small camera move.
- **Silence and pace.** Long holds, one idea per shot, very few transitions (cuts and short dissolves).

Rules we use
1. Timeline: title card → for each line: image (Ken Burns, 1.06–1.14 scale over the shot) with the line typed on
   (character reveal) → a word-grid interlude → the full poem as a block → end card. 20–40 s total, length scales
   with the line count.
2. Two styles: *Paper* (mono on paper, framed images, running heads) and *Cinema* (full-bleed images, serif italic
   lower-thirds, letterbox). Both use the same timeline.
3. Images are desaturated and grain-matched (one grade for all frames) so FLUX frames feel like one film.
4. Camera moves alternate direction shot to shot; nothing moves faster than ~4 % of the frame per second.
5. Sound is optional: one of the existing in-browser ambience beds (rain, wind, ocean…) at a low level, faded in
   and out. Export is H.264 MP4 through WebCodecs (the same muxer the Film page uses), or WebM via MediaRecorder.

## 4. Editorial poetry posters (`poetry.js`)

Reference: a series of typographic posters where verse is set in big upper-case grotesque blocks with small images
and tiny captions floating on a light ground.

What it does well
- **Extreme scale contrast.** The verse is huge and tightly leaded; the captions and numbers are tiny. Nothing in
  between.
- **A visible but invisible grid.** Everything snaps to columns, yet the composition feels loose because blocks are
  offset (indented) against each other.
- **Rotation as a layout move.** One poster turns the whole verse 90°.
- **Tiny reference marks** (numbers like `0.1`, crop corners on images) make it feel editorial.

Rules we use
1. Each poster is one layout from a set (stacked offset blocks, rotated column, single-line monument,
   centred stanza with marginalia, split image). A 3–5 poster series cycles them, never repeating back to back.
2. The verse is set in caps with leading 0.86–0.92 and tracking −1 to −2 %, fitted to the column width by measuring
   (not guessing) the longest line.
3. Two text sizes only: verse and caption (≤ 1.6 % of the poster height), plus the number.
4. Images (optional FLUX texture) are small framed rectangles with crop marks, at most two per poster.
5. Paper colour is warm off-white; the ink is near-black or one strong colour per series.

## 5. Festival poster series (`festival.js`)

Reference: a jazz festival series in two tones (deep blue on periwinkle) with silhouettes of musicians, a condensed
high-contrast serif, oval badges and vertical letter stacks, repeated across portrait and landscape formats.

What it does well
- **Two colours only.** Everything is one ink on one ground; the restraint makes the series instantly recognisable.
- **Figures as silhouettes**, cropped and repeated, give rhythm.
- **A kit of small typographic parts** (date block, venue block, oval badges, a vertical word stack, rules) is
  rearranged per format, so each size is different but obviously related.

Rules we use
1. One ink + one ground per series, chosen from mid-century pairs (ink at OKLCH L ≈ 0.25–0.35, ground at L ≈ 0.75–0.92).
2. FLUX makes high-contrast black-and-white performance photographs; the browser **thresholds** them into flat
   silhouettes (Otsu level, then a 1 px soften) and maps them to the ink, so photos become prints.
3. The headline is a condensed serif or condensed grotesque, horizontally compressed when needed to fill the
   measure exactly; dates and venue in a smaller weight of the same family.
4. The part kit is fixed (headline, date, venue, lineup list, oval badge, vertical stack, rules) and every format
   uses at least four parts in the same positions relative to the headline.
5. Formats: 3–5 posters (one per performer image) at 2:3, plus social 1080×1350 and 1080×1920 built from the same
   parts.

## Shared rules (all five)

- **Fonts:** OFL only, self-hosted under `public/fonts` with each licence next to the files.
- **AI use:** only the existing `/api/shot` (FLUX.1 schnell), called through `engines.js` with the same request body.
  Each workflow says how many frames it will use (the daily cap is per visitor). Sample images ship so the first
  result appears with zero calls; if the cap is reached the workflow falls back to them.
- **Text is never generated inside an image.** All words are drawn by us.
- **Exports:** PNG for every artboard, a PDF-ready file for print pieces (JPEG in a one-page PDF at the artboard
  size), MP4/WebM for film, ZIP for multi-file kits. Every result can be saved to My library.
