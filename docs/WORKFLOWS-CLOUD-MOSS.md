# Workflows, private projects and MOSS Image

This release adds a top-level Workflows hub, optional Supabase accounts/private projects, and a MOSS Image SFT inference worker. Existing browser tools and local libraries remain usable without signing in.

## Shipped workflows

Six guided workflows link to working tools and identify their exported artifact: artwork-to-music-teaser MP4; product-to-launch-film; LiDAR reveal; transcription-to-SRT/VTT; image-to-depth-scene PLY; annotated/merged PDF pack. Plans keep a brief, selected browser image and checked steps; they autosave locally, support validated JSON import/export and optional private project saves. These are guided steps, not unattended orchestration. Image selections pass to Video, Music and 3D using existing browser-library IDs. Source images are never automatically uploaded.

The community section bundles five VFX4All presets and API graphs: Walk of Fire, Liquid Chrome, Disintegrate, Zero Gravity and LiDAR Scan. Attribution: Noma Studio, `nomastudioai/vfx4all`, revision `c1fbc4f38b513c1bf9fe4344c62f47ac138a2ae2`, MIT code. The upstream license and third-party model notices are included under `public/comfy/vfx4all/`. The graphs require Qwen Image Edit and LTX 2.5 installations or a separately funded Comfy Cloud account. Their videos have not been rendered by this release. New MOSS stills are labeled concept art, not VFX output.

FLUX 3 Image Klein's official ComfyUI distilled template is included from `Comfy-Org/workflow_templates`, revision `c067929d7e9cc0f3fd15be348fa1a1d85da15946`, with its MIT license. It includes the required prompt upsampler. Model weights have their own FLUX Kommunity License and gated access. We have not accepted these terms on the user's behalf, downloaded the weights or enabled a hosted FLUX 3 generation endpoint.

## Supabase

**Update 2026-10-31:** accounts and private projects moved to a dedicated Supabase project, `chucksi` (ref `njiwcpzqefgrmhbcjnxn`, us-east-2), created fresh with the schema in `supabase/schema.sql`. The shared `gorilla-city-2032` project was paused at the owner's request and no longer serves this site. The paragraphs below describe the original setup.

The user selected the existing `gorilla-city-2032` project in ChuckGPTX's Org after the free-project limit prevented a new dedicated project. Changes are limited to `massless_projects`, `massless_assets`, `massless_workflow_runs` and the private `massless-private` storage bucket. `supabase/schema.sql` records the applied schema. Existing game tables, functions and auth settings were not changed.

Every Chucksi table has owner-based RLS and authenticated grants; anonymous table access is revoked. Composite foreign keys prevent assigning assets/runs to someone else's project. Storage policies restrict paths to the signed-in user's UUID folder. Uploads are capped at 30 MB and allowed MIME types; signed downloads expire after five minutes. The browser receives only a Supabase publishable key. No service-role key is used. Sign-out targets only the current session, so another app's sessions are not globally revoked.

Email/password sign-in and sign-up use existing Supabase settings. Email confirmation is enabled. A user must confirm their email and return to Chucksi to sign in. Existing Gorilla City accounts share the same authentication project. Browser storage retains the Chucksi session until sign-out. A fresh user session is needed for the final manual sign-in/upload check; no user's credentials were entered or exposed during development.

Verification: a rolled-back database transaction tested two synthetic identities, owner reads, cross-owner invisibility, forged ownership rejection, composite ownership rejection, and storage path rejection. No test users/files remain. Public REST access to project rows returns HTTP 401. Security advisors report no new Chucksi findings; existing Gorilla City function warnings remain outside this release.

## MOSS worker and budget

`workers/moss/` runs `OpenMOSS-Team/MOSS-Image-SFT` at pinned revision `f972bd4b4b9e3852133cc5da954d87bc32cd8fb9`. The model is Apache-2.0. Pinned Runpod/Diffusers/Transformers dependencies run in the official PyTorch 2.9 CUDA 12.8 container. The handler accepts only prompts, dimensions and seeds; arbitrary URLs, code and model IDs are rejected. It uses 50 steps, guidance 3, layer 22 negative skipping, CPU offload and VAE tiling.

The Runpod development endpoint is `na7yc13nrqld7r`, built from the repository's `workers/moss/Dockerfile`. Configuration: AMPERE_48, one GPU per worker, max one worker, min zero, five-second idle timeout, ten-minute execution timeout, 80 GB container disk, host model caching, no separately provisioned persistent volume. Listed GPU price at setup: $1.22/hour while running. User approved a $5 development budget. Three images completed successfully; inference times were 77.571, 81.894 and 80.630 seconds. They are in `public/media/workflows/`, with prompts and seeds in `provenance.json`. Billing reporting may lag; do not interpret empty hourly billing records as zero actual cost.

The website submits through an authenticated Cloudflare Worker. Supabase `/auth/v1/user` validates the bearer token. The Runpod key remains a Worker secret. `GenerationLedger` uses SQLite-backed Durable Object storage to coordinate one shared development allowance, deduplicate requests, restrict ownership, and store image chunks. A global object is intentional here: the coordination atom is the single shared budget. It reserves 50 cents per request pessimistically and never refunds automatically. Ambiguous provider submissions are never retried automatically. The configured app allowance for launch is 200 cents (four requests), leaving room for direct development tests and infrastructure overhead inside the $5 budget. Reservations are not the provider's bill and cannot control jobs submitted directly to Runpod.

Required Worker configuration:

- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`: public client connection settings.
- `MOSS_ENDPOINT_ID`: the tested endpoint.
- `RUNPOD_API_KEY`: server-side secret, retained from existing deployment.
- `GENERATION_LEDGER`: `GenerationLedger` Durable Object binding, SQLite migration `massless-generations-v1`.
- `MOSS_BUDGET_CENTS`: lifetime allowance in this ledger; defaults to zero, hard maximum 500. Invalid values fail closed. Do not raise or reset it without a new budget decision.

Worker source must be bundled because it now imports `src/generations.js`; Wrangler does this automatically. For direct API uploads use esbuild's ESM bundle, retain all existing secret bindings and preserve non-secret configuration. `keep_vars` is enabled for future Wrangler deploys. Local `.dev.vars` is ignored by Git.

## Validation

`npm test`: 30 tests. `npm run test:runtime`: actual Cloudflare SQLite Durable Object test covering concurrent idempotency, global budget, owner isolation and chunked image retrieval. CI runs both. Browser checks cover local project connection, workflow persistence, accessible navigation, menu destinations and responsive layout. Hosted inference was tested directly through Runpod; full browser upload/generation should also be checked after the user signs in.

## Next features from saved X posts

- A visual workflow canvas with real ComfyUI connections, execution status, reusable inputs and export, inspired by `raph651/open-source-canvas` (MIT). Its offline demo imagery is placeholder content; require real runs before showing completed output in Chucksi.
- Transcript-based cuts, silence removal, caption burn-in and portrait reframing, inspired by the saved `kajisho5/ffmpeg-skill` post. Review the source license and package FFmpeg as an isolated media worker before implementing. A skill collection is development tooling, not an inference model.
- Reference-consistent video with Pika H3 Flex: evaluate official weights, license, memory, runtime and output quality before buying capacity.
- Local speech and dubbing evaluation from Audio8 and VoiceStudio bookmarks, including voice-consent controls and model license review.
- Playable scene templates informed by `lovisdotio/video-to-game` agent skills. Those skills are not a video-to-3D reconstruction model.
- Original scroll-driven website scenes inspired by the Scrolltide bookmark. Do not redistribute a commercial prompt library without a license.

Prioritize the canvas and transcript-editing workflows after the sign-in and MOSS path have real user acceptance coverage.

## GPU worker jobs (Video, Music, Upscale, Lab)

`workers/gpu/` (see its README) adds a second RunPod worker on an 80 GB GPU (A100 80GB, H100 80GB PRO as
fallback) whose weights live on a RunPod network volume: Wan 2.2 A14B image/text to video (Quick with the
Wan2.2-Lightning LoRA, or Best), Wan-Animate-2 motion transfer, Wan 2.2 S2V lip sync, SeedVR2 7B video upscale,
ACE-Step 1.5 music and Real-ESRGAN image upscale, and a separate Lab image (MMAudio, HunyuanVideo-Foley,
Fibo 2.0; non-commercial licenses, off unless `LAB_ENABLED=true`). They go through the same `GenerationLedger`:
`src/gpu-jobs.js` validates each job and prices it from GPU-seconds at `GPU_CENTS_PER_HOUR` (539, the H100 rate,
so an A100 run is overstated about 2x), `GPU_DAILY_BUDGET_CENTS` (500) is one daily budget for every hosted job
(MOSS included, settled to its real cost; the MOSS lifetime cap still applies), and `GPU_PER_USER_DAILY` (10)
limits each signed-in user. The Video page's GPU panel (`public/js/gpu-panel.js`) has Animate, Motion, Lip sync
and Upscale video modes; the Music page has Compose. Both show the remaining daily budget, the queue and each
job's expected cost before it is sent.
