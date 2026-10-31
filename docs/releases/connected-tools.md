# Connected creative tools — first implementation release

This release starts the Higgsfield comparison roadmap with usable browser-first tools, without expanding paid inference capacity.

## Shipped

- `/library/`: guest media library backed by the existing IndexedDB store. Import images/audio/video, search, filter, rename, download originals and JSON recipes, and hand off selected images to editing, camera motion, 3D, music previews and launch films. Existing stored images and audio remain intact. No automatic upload.
- `/edit/`: local raster composition, aspect framing, image position/size, brightness/contrast/saturation, headline, original comparison, transparent-background export, PNG download and saving a new take linked to the source. This is not generative image editing or background removal.
- `/cut/`: import local video and SRT/VTT, load the saved Audio transcript, preview styled caption overlays, trim and export with source sound. Uses real-time MediaRecorder, max 120 seconds, and stops if the page becomes hidden. Output format follows browser support. Saved locally; no video upload.
- `/scene/`: real Three.js geometry, editable transforms/materials, orbit camera, lighting, PNG frame saves, GLB export including a camera, scene-settings download/restore. Primitives only; not prompt-to-mesh reconstruction.
- `/build/`: editable original website and arcade game templates. Sandboxed live previews, names/copy/colors, selected local image for the website, game difficulty, settings backup and self-contained HTML export. Not a general AI code generator.
- Camera exports, music teasers and launch films now save to the shared library. Launch Film accepts a selected image and workflow brief rather than always pulling the newest four images.
- Four new workflow guides and navigation links. Homepage now leads with the locally rendered music preview; paid films remain credited in the motion gallery.

## Verification

33 Node tests: existing data retention, model job idempotency/budget/owner isolation, new routes and immutable dependencies, subtitle timings/trim validation, template markup escaping and media lineage. Actual SQLite Durable Object runtime check passes. Chrome exercised image edit/save/library, captioned MP4 render and saved output, website preview/export, arcade boot/input/collision/lives, 3D scene frame saving and GLB export.

## Remaining roadmap

Hosted Qwen image editing, Wan text/image-to-video and motion transfer, ACE-Step music generation, mesh reconstruction, transcript deletion/silence cutting, advanced compositing/masks, a full multi-asset clip timeline, community publishing/remix history and executable resumable workflows remain separate implementation stages. The current workflows are guided steps with selected-image/brief handoffs; they do not execute a graph automatically. No additional hosted-model allowance or public storage exposure is enabled by this release.

## Data and licensing

MIT application code and original templates. Three.js 0.180.0 (MIT) reuses the existing pinned dependency. Local work can be lost if browser storage is cleared; download originals and recipes. The optional cloud project area keeps its existing authentication and owner-scoped data controls. Scene JSON and template settings import are validated. User text is escaped in exported HTML; template previews run in an iframe with only `allow-scripts`, without same-origin access.
