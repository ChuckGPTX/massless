# Massless artwork provenance

Created October 30, 2026 using the built-in OpenAI image-generation tool in generation mode. These are original promotional images for Massless's visual identity, not demonstrations of models offered by the application. No reference images or third-party artwork were supplied. The original PNGs were converted to JPEG at quality 82 for web delivery; the layout crops them using CSS.

| Web asset | Role | Dimensions | Delivery |
| --- | --- | --- | --- |
| `public/media/art/massless-portal-v1.jpg` | Original brand artwork and social preview | 1536 × 1024 | Social preview |
| `public/media/art/massless-world-v1.jpg` | Original floating-world brand artwork | 1536 × 1024 | Retained asset |

## Portal prompt

Use case: ads-marketing. Create an original premium cinematic website hero artwork for Massless, an open-source creative studio for film, image, audio and 3D. Landscape 3:2 composition. A small solitary explorer in a burnt-orange technical coat stands at the edge of a monumental black stone landscape, facing an enormous thin luminous amber circular portal tilted slightly in space on the RIGHT HALF of the composition. A dark reflective plain, distant craggy peaks, delicate atmospheric haze, tiny warm reflections and realistic film grain. Visually arresting art-house science fiction film still, photographic materials, incredible scale, quiet confidence, no generic stock-art feel. The LEFT 45 percent must stay mostly nearly black atmospheric negative space for large white website headline overlaid later in HTML. Palette charcoal, black, warm gold, restrained rust; no purple. Lighting rim-lit amber edge with soft dawn cloud glow. Wide cinematic framing with subject and portal center-right that also survive a narrow crop. No text, no typography, no logos, no watermarks, no UI. This is a standalone finished artwork, not a website screenshot.

## Floating world prompt

Use case: stylized-concept. Asset type: landscape 3:2 editorial artwork for a premium open-source creative studio's visual-workflow section. Original miniature cinematic world suspended in a dark studio: a sculpted charcoal rock island hovering in space, a warm amber illuminated winding path leading to a small modern glass pavilion, a tiny orange-clad figure for scale, delicate suspended stone fragments and one beautifully controlled orbital amber light trail. Sophisticated physical scale-model photography mixed with immaculate 3D materials, tangible rock and brushed metal, warm window light, deep black background, restrained subtle teal reflected highlights, shallow atmospheric depth. Main island occupies center and right with breathing room around every edge, clean legible silhouette at thumbnail size. Matches a dark charcoal and golden-amber creative brand. No words, no letters, no logo, no interface, no watermark. Avoid toy-like plastic, purple neon, generic AI circuit patterns, busy collage. Finished standalone art, not a website mockup.

## Presentation

Keep headline and navigation as live HTML. Provide descriptive alternative text. Maintain the distinction between brand artwork and the “Made in Massless” clips, whose motion is rendered by Massless. No image-generation API dependency is added to the app.

## Commissioned motion references (October 30, 2026)

The `public/media/showcase/` files were commissioned for the Explore gallery using the exact Higgsfield API model endpoints requested by the project owner. They are reference media, not demonstrations of Massless model output. No API key, provider job URL or private account metadata is shipped to the browser. `provenance.json` records prompts, model endpoints, settings, checksums and web asset sizes.

Downloaded originals are converted to H.264 MP4 at 24 fps and 960 pixels wide with audio removed, plus JPEG posters extracted from their actual frames. The Marketing Studio character image is used as the target for the single requested Genjutsu Light transfer. The source dance was generated with Kling 4.0. No real-person reference was uploaded.

The native LiDAR and Vanish active posters are frames extracted from Massless's existing effect clips at 1.8 and 1.3 seconds, respectively. Original Canvas game/3D demos and the HTML/CSS website study are included under the repository's MIT code license.

### Reference model sources

- [Kling 4.0 text-to-video](https://open.higgsfield.ai/models/kling-video/v4.0/text-to-video/playground)
- [Wan 3.0 Prime text-to-video](https://open.higgsfield.ai/models/alibaba/wan-3.0-prime/text-to-video/playground)
- [Genjutsu Light motion transfer](https://open.higgsfield.ai/models/higgsfield/genjutsu-light/motion-transfer/v1.0/playground)
- [Marketing Studio Image](https://open.higgsfield.ai/models/marketing-studio/image/playground)

Pre-rendered references do not make these model implementations open source and do not inherit the repository's software license automatically. Consult the provider terms for generated asset use. The site can run without a Higgsfield account.
