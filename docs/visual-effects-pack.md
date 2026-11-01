# Visual effects pack — 15 presets

Built on 2026-11-01 on top of main 37539f0. Original MIT-licensed browser rendering code; the existing LiDAR, Vanish, Freeze and Clones remain available.

## Research behind the pack

Read actual X posts, then checked primary project/model pages. These are inspiration and technical leads, not code or footage copied into ChuckSI:

- [Pika’s Pikaffects launch](https://x.com/pika_labs/status/1841143349576941863) and [Justin Hart’s examples](https://x.com/justin_hart/status/1841144350572413259): playful melt, inflate, squish and other transformations. Pika’s [current effects page](https://creation.pika.art/apps/pikaffects?tab=all-apps) describes the image-to-effect workflow. Applied here as Liquid melt, Bubble lens and Elastic bounce: deterministic frame distortions, not AI-generated physical object transformations.
- [Higgsfield’s motion library](https://higgsfield.ai/motion) and [effects release](https://higgsfield.ai/es/blog/Higgsfield-Effects-9-New-Ways-to-Break-Reality): glass, disintegration, glitch, glow and strong single-action reveals. Applied as Prism shatter, Signal break, Neon sketch, Hologram and Portal pull.
- [Higgsfield’s code-based launch video post](https://x.com/higgsfield_ai/status/2108370085178138694): a useful example of motion made in code. This pack likewise renders real effects instead of placing unrelated generated footage on its preview cards.
- [Luma’s camera motion concepts](https://lumalabs.ai/news/camera-motion-concepts): combining simple controls produces reusable motion. Applied to animated lens warps, refractive pulses, zoom trails and timed loops.
- [Nico Ruarte / VFX 4 All on X](https://x.com/nicolasmariar/status/2116146288353812499): 45 presets advertised as open source. The thread links vfx.nomastudio.ai. Its implementation/license was not verified during this task; no assets or code were imported.
- [Cocktail Peanut’s open Pikaffects alternative](https://x.com/cocktailpeanut/status/1900237861955527161): led to Remade’s Wan adapters. [Squish](https://huggingface.co/Remade-AI/Squish) and [Inflate](https://huggingface.co/Remade-AI/Inflate) list Apache-2.0 licenses and Wan2.1 I2V base models. They are candidates for a separate, tested generative-effects worker. They are **not deployed by this pack**. Model cards and complete base-model/dependency licenses must be checked at integration time.

X research also included creator Pika demonstrations and CapCut effect searches. Marketing claims about model quality, speed and costs were not treated as verified benchmarks.

## Shipped in this branch

| Preset | What it does | Bundled example |
|---|---|---|
| Hologram | Scanning light, depth contours and projection lines | Samurai |
| Prism shatter | Separated, refractive glass facets | Neon portrait |
| Shockwave | A moving ring of refraction and light | Astronaut |
| Portal pull | Twisted image inside an animated energy ring | Lighthouse |
| Liquid melt | Depth-weighted flowing image ribbons | Diner |
| Bubble lens | An expanding circular glass lens | Jellyfish |
| Elastic bounce | Frame compression and spring-back | BMX |
| Prism zoom | Chromatic zoom with layered trails | Train |
| Signal break | Digital band offsets and channel separation | Rider |
| Pixel cascade | Bright details stretched into color streams | Neon portrait |
| Ink reveal | Paper, ink contours and a spreading reveal | Fisherman |
| Neon sketch | Colored edge tracing with a scanning reveal | Cinema |
| Mirror bloom | Animated radial reflections | Summit |
| Ribbon drift | Offset strips flowing across the frame | Dancer |
| Paper fan | Shaded accordion-like image folds | Canyon |

Each has a ready-to-use gallery entry, a real MP4 demonstration, a poster, duration and intensity controls, and works with the existing clip and storyboard export. The first four also have alternate color treatments. The gallery contains 15 new entries, not 15 recolors.

These are still-image effects. They do not reconstruct hidden geometry, animate a person's performance, turn objects into cake, or implement physical fluid/destruction simulation. No Pika/Higgsfield runtime, assets, model badge or paid call is included. Reuse of existing stills is recorded in the media provenance manifest.

## Architecture

- `public/js/effect-presets.js`: shared metadata, samples, default looks and media paths.
- `public/js/optical-effects.js`: one WebGL2 pass, then the existing lens/film finish.
- `public/js/effects.js`: routes optical effects through the same engine used by preview/export/storyboard.
- `public/js/pages/video.js`: skips subject-mask preparation for whole-frame effects; keeps the user's selected image when changing effect.
- `public/js/workflow-data.js`: 15 one-click entries; `public/index.html` features four.
- All source-frame transitions return to the starting frame. Motion is a function of normalized time, not frame history. No random network or model state affects export.
- Existing reduced-motion / Save-Data controls and lazy video loading apply to the new cards.

## Reproduce the checks and previews

Run `python3 tools/effect_review_server.py`, open `http://127.0.0.1:8776/review/optical-effects.html`, then use **Run render checks** and **Render all 15 preview clips**. The local-only review server writes into ignored `tests/out/optical-effects`. It accepts only same-origin requests and constrained output filenames; it is not part of the deployed site.

`python3 tools/package_effect_previews.py` compresses the browser's MP4 outputs, encodes WebP posters, and updates SHA-256 provenance records. It needs ffmpeg with H.264 support and Pillow with WebP support. It does not automate a browser.

`npm ci --ignore-scripts && npm test` runs the repository checks. The gallery test now reads the exported effect registry rather than attempting to parse one hard-coded source block with a regex.

Verification performed: all 15 active-frame differences, identical start/end frames, zero strength, deterministic repeats, alternate looks where present, portrait/landscape rendering without WebGL errors; all 192 repository tests; actual Video-page 1280×720 single-clip and two-shot storyboard exports.

## Next generative-effects step

Build one Wan2.1 I2V worker supporting pinned, allowlisted LoRA adapters, explicit per-job budgets and an output-quality review. Begin with Squish and Inflate from the verified Remade sources. Save the actual model, revision, adapter, prompt, strength and seed with each job so a preset is reproducible. Keep those results distinct from the instant optical effects. No compute budget was consumed for this pack.
