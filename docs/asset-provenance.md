# Massless artwork provenance

Created October 30, 2026 using the built-in OpenAI image-generation tool in generation mode. These are original promotional images for Massless's visual identity, not demonstrations of models offered by the application. No reference images or third-party artwork were supplied. The original PNGs were converted to JPEG at quality 82 for web delivery; the layout crops them using CSS.

| Web asset | Role | Dimensions | Delivery |
| --- | --- | --- | --- |
| `public/media/art/massless-portal-v1.jpg` | Homepage hero and social preview | 1536 × 1024 | High-priority hero |
| `public/media/art/massless-world-v1.jpg` | Image-to-motion workflow promotion | 1536 × 1024 | Lazy-loaded |

## Portal prompt

Use case: ads-marketing. Create an original premium cinematic website hero artwork for Massless, an open-source creative studio for film, image, audio and 3D. Landscape 3:2 composition. A small solitary explorer in a burnt-orange technical coat stands at the edge of a monumental black stone landscape, facing an enormous thin luminous amber circular portal tilted slightly in space on the RIGHT HALF of the composition. A dark reflective plain, distant craggy peaks, delicate atmospheric haze, tiny warm reflections and realistic film grain. Visually arresting art-house science fiction film still, photographic materials, incredible scale, quiet confidence, no generic stock-art feel. The LEFT 45 percent must stay mostly nearly black atmospheric negative space for large white website headline overlaid later in HTML. Palette charcoal, black, warm gold, restrained rust; no purple. Lighting rim-lit amber edge with soft dawn cloud glow. Wide cinematic framing with subject and portal center-right that also survive a narrow crop. No text, no typography, no logos, no watermarks, no UI. This is a standalone finished artwork, not a website screenshot.

## Floating world prompt

Use case: stylized-concept. Asset type: landscape 3:2 editorial artwork for a premium open-source creative studio's visual-workflow section. Original miniature cinematic world suspended in a dark studio: a sculpted charcoal rock island hovering in space, a warm amber illuminated winding path leading to a small modern glass pavilion, a tiny orange-clad figure for scale, delicate suspended stone fragments and one beautifully controlled orbital amber light trail. Sophisticated physical scale-model photography mixed with immaculate 3D materials, tangible rock and brushed metal, warm window light, deep black background, restrained subtle teal reflected highlights, shallow atmospheric depth. Main island occupies center and right with breathing room around every edge, clean legible silhouette at thumbnail size. Matches a dark charcoal and golden-amber creative brand. No words, no letters, no logo, no interface, no watermark. Avoid toy-like plastic, purple neon, generic AI circuit patterns, busy collage. Finished standalone art, not a website mockup.

## Presentation

Keep headline and navigation as live HTML. Provide descriptive alternative text. Maintain the distinction between brand artwork and the “Made in Massless” clips, whose motion is rendered by Massless. No image-generation API dependency is added to the app.
