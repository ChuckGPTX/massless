# Website templates: technique briefs

Four one-click templates in the Website builder (`/website?template=<id>`) borrow *techniques* from four
sites featured on recent.design. We studied each reference at 1440 and 390 px, scrolled it, recorded a few
frames of motion and read its recent.design tags. We kept the ideas (type scale, grid, rhythm, motion, image
treatment, interaction). We did not copy any text, logo, brand name, image or exact layout. Every template's
brand, copy and art is our own, and all placeholder art is generated SVG (`public/js/website/art.js`). Real
photos come only from the builder's own image engine (`/api/shot`) or uploads, when the owner asks for them.

Reference screenshots stay out of the repository.

## 1. `editorial-shop` (style "Atelier")

**Reference:** Becane Paris, a minimalist fashion shop (recent.design tags: Typographic, Minimal, Clean, Big
Background Image, Large Type, Editorial, Transitions).

What makes it good:
- The chrome is tiny and quiet. Navigation sits in small floating white boxes on a pale grey page, set in
  11 px uppercase, with grey counts beside the labels ("All 27", "Stories 04", "Cart 00").
- One wide, flat display face does all the shouting, in caps: a collection title and a long brand statement
  set as one centred block of extended capitals.
- Product imagery is the interface: full-length figures cut out on the page colour, lined up or arranged in
  a ring, so the collection reads as a cast of characters before it reads as a grid.
- Hard edges everywhere, almost no colour except the clothes.

Rules we use:
- UI chrome at 0.64 to 0.72 rem, 600 weight, uppercase, 0.07 em tracking, inside floating chips with 2 px
  corners (`.site-head .wrap` becomes a chip; nav items get CSS-counter indices in muted grey, 01, 02, 03).
- Display type: Archivo at width 125 (Google Fonts width axis, OFL), 800 weight, caps, line-height 0.92 to 1.02.
- One oversized image per viewport in the lookbook (`lookbook / full`: 100svh tall, no radius), each with a
  floating white caption chip ("01 / 03 · Look 01 · Wool coat").
- Products in a 4-column grid with name and price in 11 px caps on one line, colour underneath; a "Products 08"
  count opposite the section title. A second "lineup" variant shows every piece as a standing figure on the
  bare page colour, scroll-snapped on phones.
- A statement section between product and editorial: 30 to 45 words of wide caps, centred, max 27ch.
- Placeholder art: a fashion-sketch figure (9-head proportions, shaded coat with lapels and belt, wide
  trousers, a soft floor shadow) on a seamless studio backdrop, or the same figure in a street or rooftop scene.

## 2. `manifesto` (style "Manifesto")

**Reference:** the Endel manifesto (manifesto.endel.io; tags: Typographic, Illustrative, Large Type, Editorial,
Long Scrolling, Dark).

What makes it good:
- Pure black, one column, and a strict cadence: a big statement, a short paragraph in small type, then a
  line illustration, repeated down a very long page.
- Every illustration is drawn with the same thin white stroke, so twenty drawings read as one voice.
- Exactly one moment of colour (a warm-to-violet sunrise gradient) makes the black feel intentional.
- Motion is ambient rather than decorative: lines drift and draw themselves as you scroll.

Rules we use:
- Black background, near-white text, Inter Tight at weight 300 for statements (2.6 to 7.2 rem in the hero),
  Inter for body at muted grey, max 44ch.
- The single accent is a gradient (accent to accent-2) used only on emphasised words (`*words*` in titles)
  and on the sunrise motif.
- Hero `ambient`: an original generative canvas, about 24 stacked sine contours whose amplitude is shaped by a
  Gaussian envelope around the centre, slowly phase-shifting. A static SVG frame of the same field is in the
  HTML, so no-JS, the editor and `prefers-reduced-motion` get a still image. The animation pauses off-screen.
- `chapters / stack`: numbered parts, each with a line motif (orbits, waves, horizon, bloom, grid, steps) drawn
  with one stroke weight (`vector-effect: non-scaling-stroke`) that draws itself in on reveal
  (`pathLength=1`, dash offset 1 to 0).
- `statement / reveal`: words light up one by one as the block scrolls through the viewport (per-word opacity
  from a single `--p` custom property; no per-word JS).
- `statement / framed`: the promise in a hairline frame beside a huge outlined numeral (text-stroke only).
- Any photo slot in this style draws its composition as line art (same stroke as the motifs).

## 3. `portfolio-timeline` (style "Timeline")

**Reference:** Mike Matas's portfolio (tags: Minimal, Clean, Light, Type, Case Study).

What makes it good:
- White page, two lines of regular-weight type top left (a name and a year), three grey links top right in a
  thin weight. Nothing else competes with the work.
- The work is chronological and moves sideways: a vertical scroll drives a horizontal rail of devices, and the
  year beside the name counts down as you travel back in time.
- Every project is shown in its real context (a phone, a tablet, a laptop) on white, with credits in small
  grey type.

Rules we use:
- Hanken Grotesk (OFL) at 400 for everything large, 300 for the grey links; no bold except project titles.
- The name card hero (`hero / minimal`) replaces the header on the home page; title and subtitle at the same
  scale, subtitle in muted grey.
- `cases / rail`: on screens 900 px and wider with motion allowed, the section becomes a sticky viewport whose
  vertical scroll translates the track horizontally; a large tabular year (`rail-year`) updates to the project
  nearest the travelling focus point. Everywhere else (phones, reduced motion, no JS, the editor) it is a
  plain horizontal scroll-snap strip, so nothing depends on JS.
- Cards alternate wide and narrow (4:3, 3:4) for rhythm; meta is title, then role · client · year, a two-line
  summary and credits.
- `cases / list` is the vertical alternative with a sticky outlined year column.
- Placeholder art: device mock-ups (laptop, phone or a round dial) whose screens follow the project: a map with
  a route, a camera view, a page of text, a dashboard.

## 4. `ai-product` (style "Product")

**Reference:** Orior AI (tags: Minimal, Clean, Large Type, Transitions).

What makes it good:
- Warm off-white, a short tight headline, one grey sentence, and a single portrait that fills the rest of the
  first screen. The product is the face.
- As you scroll, the portrait stays put while labels with leader lines lock in one by one ("matched", "kept",
  "set") under a status pill with a spinner, so the page demonstrates the product instead of describing it.
- The proof then moves onto a black band (examples, motion), and the page returns to off-white for pricing.

Rules we use:
- Geist (OFL) at 600 with -0.045 em tracking, 2.5 to 4.7 rem; the emphasised half of the headline in muted grey.
- Pill everything: buttons, the status chip, a small dotted eyebrow pill.
- `hero / portrait`: centred copy, then a 4:5 portrait with rounded top corners that runs into the next section.
- `annotated / portrait`: a sticky stage (210svh tall on wide screens) where each label's opacity is
  `clamp(0, (p * (n + 1.2) - k - .25) * 4, 1)` of the section's scroll progress `--p`; leader lines connect the
  chips to the image. On phones the chips sit inside the image edges and are all visible.
- Proof on `t-inv` (the inverse tone): a bento of features and a scroll-snap strip of scenes.
- Placeholder art: a sculpted head-and-shoulders bust (radial-lit skin tone, hair framing the face, a plain
  top). Slots whose prompt names "the character" share one look, so the hero and the demo show the same
  person; scene prompts ("the same woman on brick steps in the city") become a figure in a street, window,
  park or rooftop scene.

## Shared engineering rules

- Everything is a section in the spec, so templates work with the built-in writer (four new kinds: shop,
  manifesto, cases, product), edit in place, restyle into any style, share links and both exports.
- Exported sites stay static: one stylesheet, one ~5 KB script (`SITE_JS`) for reveal, the scroll scrub, the
  rail and the canvas. Motion is skipped entirely when the theme's motion is "none" or the visitor asks for
  reduced motion (`html.rv` is only set when both allow it).
- Placeholder art is inline SVG coloured by theme tokens through CSS classes, sized to the slot's aspect ratio
  and seeded by the slot path, so it is stable between renders and restyles with the site.
- Thumbnails (`public/media/website/tpl-<id>.webp`, 640 x 400, under 80 KB) are screenshots of the templates
  themselves: `python3 tests/website_thumbs.py`.

## Template photography and motion (November 2026)

- Every template's example site ships real photographs generated with Higgsfield Soul (`soul/v2/standard`,
  and `soul/cinema` for the manifesto's dark atmospherics), one art direction per site: full-length studio
  figures and an editorial lookbook on pale grey for the shop, foggy low-key cityscapes for the manifesto,
  devices on white for the portfolio (blended into the page with `mix-blend-mode: multiply`), one consistent
  fictional character for the AI product, and warm morning service photos for the local business. Fictional
  people only, no logos or text; rejects (magazine-page framing, logos, on-screen text) were regenerated.
  Prompts, seeds and hashes: `public/media/website/provenance.json`. Each photo has a large WebP and a small
  `-sm` copy used in `srcset`; exports copy both into `assets/img/`, the one-file export embeds them.
- Sites someone describes keep the generated SVG art in empty slots; photos are only for the examples.
- Motion: masked headline and clip-revealed hero image on load, a slow Ken Burns on hero photos, scroll
  parallax (`data-scrub="par"`) on hero and lookbook photos, photos that open up as their section reveals,
  hover zoom on product, case and gallery images, a ticker for the shop and the conference, underline and
  press micro-interactions. Transform, opacity and clip-path only; skipped for reduced motion or motion "none".

## Fonts (all SIL Open Font License, from Google Fonts)

| Template | Display | Body |
| --- | --- | --- |
| editorial-shop | Archivo, width axis at 125 ("Archivo Expanded" in the font list) | Archivo |
| manifesto | Inter Tight 300 | Inter |
| portfolio-timeline | Hanken Grotesk 400 | Hanken Grotesk |
| ai-product | Geist 600 | Geist |
