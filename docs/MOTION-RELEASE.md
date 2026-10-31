# Motion-first Explore

This release brings examples above the fold: native LiDAR and Vanish effects, a commissioned cinematic reference, a live 3D projection, a playable original arcade game, and a working responsive website study. The example website is a small HTML/CSS demo, not an AI website builder. Orbit is a small browser game, not an AI game studio.

## What ships

- Compact introduction and three moving feature cards, with distinct imagery.
- Six completed commissioned reference videos and one original Marketing Studio character image are integrated, including the single requested Genjutsu Light transfer. One additional Kling lunar-rover job was submitted but could not be recovered after the provider request-history page returned HTTP 403. It is excluded from the gallery until its output is downloaded and verified.
- Model credits on every reference card and an explanatory model/artwork dialog. No proprietary generation API is added to Massless.
- Canvas 3D rotation study with actual perspective projection and sorted polygon faces.
- Orbit game: keyboard/pointer control, collectible stars, collision, score and restart.
- Form & Field website example: responsive layout, working section navigation, scrolling, original CSS shapes and subtle motion.
- Gallery filters and a full video viewer.
- A global preview pause control, lazy video sources, offscreen pausing, hidden-tab suspension, modal suspension, reduced-motion and data-saver defaults. Explicit play is supported when the default is paused.
- Eight varied camera-library thumbnails using existing Massless renders matched to their camera moves. Choosing a move retains the user's current image.

## Media boundary

The code is MIT licensed. Pre-rendered paid references are optional media assets; the application does not call Higgsfield at runtime. Kling, Wan 3.0 Prime, Genjutsu Light and Marketing Studio are not described as open-source models. Their outputs do not demonstrate the current Massless generation capabilities. The native effects are labeled separately.

Model weights and assets do not automatically inherit the software license. See `asset-provenance.md` and the model ledger. New image/video generation integrations require their own model-license review.

## GPU development priorities

1. **Image editing:** masked inpainting, background replacement, clean product shots and upscaling. Start with one license-checked model and a fixed evaluation set rather than an untested model picker.
2. **True video generation:** open-weight image-to-video plus reproducible seeds and short duration presets. Current camera moves animate a still; this would add independent subject and scene motion.
3. **Audio finishing:** word-level alignment for edit-by-text, speech denoising and source separation. Preserve the original and store an editable cut list.
4. **3D reconstruction:** multi-view/depth reconstruction and downloadable scene assets. Distinguish estimated geometry from measured LiDAR data.
5. **Motion transfer:** pose extraction plus controlled character animation, after the basic video job pipeline is reliable.

LiDAR-style scans, Vanish, basic camera movement, game previews and scrolling web demos already run in the browser. They should not occupy a rented GPU just to animate the homepage.

## Cloudflare + Runpod path

Use Cloudflare for the site, authenticated job submission, budgets and status; use Runpod for asynchronous model execution. Store job/ownership metadata transactionally (D1 or a Durable Object), large inputs/outputs in R2 with bounded signed access, and queue long jobs with explicit retries and idempotency. Avoid a non-atomic KV counter as the authoritative spend limit. Use separate preview and production environments.

Pin the worker image, model revision and workflow JSON. Store seed, dimensions, prompt, workflow version, execution time, cost and artifact checksum for every completed job. Provide cancel, retry and download without re-running a successful job. Begin with scale-to-zero and a concurrency cap; do not keep a development GPU running between experiments.

The account audit found no deployed Runpod workload for Massless. No GPU resource has been purchased or deployed as part of this media release. The $10 authorization applies only to the requested Higgsfield references.

## Development workflow

Keep work in feature branches with isolated ownership when multiple assistants are active. Require passing tests and a working preview before promotion. Preserve existing unfinished Claude work; screenshots of planned features are not evidence that their code is in the repository. Build one complete path per release, while maintaining parallel backlogs for creator tools, websites, games and office workflows.

Every new model should have a small evaluation pack: fixed inputs, expected constraints, example outputs, median/tail latency, failure rate, GPU memory, cost per useful output and a verified license link. Every homepage claim should link to a working tool, be labeled as a prototype, or be labeled as reference media.

## Verification

- `npm test`: library persistence and preview behavior, including accessibility defaults, visibility suspension and late-play races.
- Browser checks: desktop/mobile layout, actual video playback, pause/resume, filtering, modal video, game scoring/collision/restart, website navigation and source page links.
- Assets: local H.264 MP4, 24 fps, no audio on autoplay previews, fast-start metadata, JPEG posters. The original downloads are kept outside the application repository.
