# Chucksi

Formerly Massless; now at https://chucksi.com.

**A free cinema camera for AI shots.** Design a shot with real camera, lens and film choices, render it with a free open-weight model, then fly a camera through it: dolly zoom, crash zoom, arcs, crane, rack focus, bullet time. Export MP4.

Live: **https://chucksi.com**

Chucksi, the open creative studio, aims to remove the weight from creative tools: no account required, open-weight models, and editing that runs on your device. Browser tools are free to use. Hosted inference has shared daily limits; operating a GPU or exceeding a provider's free allowance can cost money.

## The site

Five showcase pages introduce the tools: `/studios/image/`, `/studios/video/`, `/studios/audio/`, `/studios/3d/` and `/studios/office/`. Each navigation label opens its showcase; the separate arrow opens its feature menu. The existing workspaces remain available:

| Page | What it does |
| --- | --- |
| **Explore** (`/`) | Original cinematic artwork, clear starting points, launch rail, tool tiles, the moves showcase and a wall of clips made in Chucksi. |
| **Image** (`/image`) | Cinema Studio, the shot designer. Camera body, lens, focal length (8–135mm), aperture (f/1.4–f/11), shot size, angle, light, film stock, aspect ratio, genre and palette compile into a prompt you can read and edit. Up to four takes per prompt with FLUX.1 schnell. |
| **Video** (`/video`) | 28 camera moves on any still (dolly zoom, crash zoom, arcs, crane, rack focus, bullet time), with lens and film finish, plus one-tap effects: LiDAR scan, Vanish, Bullet time freeze and Clones. Render a clip, or add shots to a storyboard, reorder them and export one stitched MP4. |
| **Music Preview** (`/music`) | Turn artwork and a short audio clip into a beat-grid music teaser. Local upload, playback, landscape/portrait/square layouts and MP4 with audio. |
| **Launch Film** (`/film`) | Build a kinetic launch film from a brief, with typography, scenes, music and export. |
| **3D** (`/3d`) | Image to 3D. Any still becomes a Gaussian splat you can orbit, built in the browser from its depth map, or a full object from Idol (speridlabs, Apache-2.0) running on your own GPU. Opens and exports standard 3DGS `.ply`. |
| **Office** (`/office`) | A free PDF toolkit in the browser: edit (highlight, text, draw, sign, notes) and save a real PDF; convert images to PDF and back, merge, split, rotate, compress, extract text; ask questions about a PDF with Llama 3.3. Files never leave the browser except the text you choose to ask about. |
| **Image workroom** (`/edit`) | Reframe, grade and compose a product visual, plus three image AI tools that run on the visitor's device. **Remove background** (`/edit/?tool=remove-bg`): BiRefNet lite for any subject or MODNet for people; transparent PNG, or replace with a color, a blur of the original or a backdrop, with an edge-softness slider. **Upscale 2× / 4×** (`/edit/?tool=upscale`): Real-ESRGAN, tiled so memory stays bounded. **Erase object** (`/edit/?tool=erase`): brush over it, then MI-GAN fills the gap (or a no-download PatchMatch texture copy). Before/after slider, save to the library, PNG download; results carry from one tool to the next. |
| **Audio** (`/audio`) | Voiceover from a script with eight English Kokoro voices in the browser, or six languages (English, Spanish, French, Chinese, Japanese, Korean) with MeloTTS. Captions: drop audio or video, get an editable transcript and `.srt`/`.vtt` from Whisper, with optional translation to English. Sound beds (rain, wind, ocean, city night, room tone, campfire, forest) synthesized from scratch. WAV out. Extract audio: drop a video or audio file you have the rights to and get MP3 (128–320 kbps), M4A or WAV, with trim, fades and loudness levelling, all in the browser. Master: see below. Deep links: `/audio?tab=captions`, `/audio?tab=extract`, `/audio?tab=master`, `/audio?engine=melo&lang=es`. |
| **Sign** (`/office?tab=sign`, `/sign`) | Send a contract or your own PDF for signature, DocuSign-style: 59 open (CC0) templates for real estate, creative finance (Subto, wraps, novation, lease-option, contract for deed), music (split sheets, beat leases, producer, sync) and joint ventures, with notes for all 50 states and DC. Signers sign on any phone with no account. Documents are encrypted in the browser; the server only holds ciphertext and a signed audit trail. Templates, not legal advice. |
| **Edit by text** (`/cut/`) | On the Cut page (Clip workroom): open audio or video, transcribe it with Whisper, then cut the media by striking words in the transcript. Remove fillers, repeats and long pauses in one tap each, with a review list; undo and redo; play the edit with the current word lit, click a word to jump there. Export the edited MP3 or WAV, the edited video as MP4 (with captions burned in), re-timed `.srt`/`.vtt`, and a CMX 3600 edit list. Only the sound, as 16 kHz mono, leaves the device, and only when you press Transcribe. |
| **Games** (`/games`) | Describe a game and play it in seconds: runner, stacker (3D with three.js, or 2D), shooter, match 3, maze or eat and grow. A built-in writer turns the sentence into a recipe in the browser, a bot playtests it (re-seeding until it passes), and you can add your own art or optional FLUX.1 schnell sprites. Remix the title, look and difficulty, share the recipe as a link, or download one HTML file that plays offline. Twelve gallery games. Old `/build/?template=game` links land here. |
| **Website** (`/website`) | Describe a business, restaurant, band, event, listing or launch and get a multi-page site from the built-in writer (in the browser). Edit any text in place, add, move and duplicate sections, switch among seven styles, fill images with your uploads or FLUX.1 schnell, share a link that carries the whole site, and export a ZIP of static HTML/CSS (with sitemap, robots.txt and phone-size images) or one HTML file. Old `/build/?template=website` links land here. |
| **Master** (`/audio?tab=master`) | Drop a finished mix and read a plain-words report: loudness (LUFS), true peak, loudness range, tone against a typical mastered mix, stereo width, clipping. Pick a character (Warm, Balanced, Bright) and a destination (Streaming −14, Podcast −16, Broadcast −23, Loud −9 LUFS, all −1 dBTP), A/B against the original at the same loudness, and export 24-bit WAV or MP3 320, measured again on the file itself. Saves to the library. Nothing is uploaded. |

Saved shots and audio live in the visitor's browser (IndexedDB). New saves never automatically delete older originals. The Image page loads older shots in batches of 24. If a save fails, the result stays available for download in that session and is visibly marked as unsaved. There are no accounts or cloud backups; browser data can still be cleared or evicted, so download work you want to keep.

What it rebuilds, clean-room from public behavior (see [SPEC.md](SPEC.md)): the shot designer, camera-motion presets, takes, storyboard and voiceover of paywalled AI film studios.

## How it stays free

| Job | Model | License | Where it runs |
| --- | --- | --- | --- |
| Hero frame | FLUX.1 [schnell] (Apache-2.0), SDXL-Lightning and SDXL 1.0 (OpenRAIL++), DreamShaper 8 (CreativeML OpenRAIL-M) | Open weights | Cloudflare Workers AI free daily allocation, or your own ComfyUI; Pollinations' community API (NVIDIA Sana, 1 image per 45 s) as a fallback |
| Depth | Depth Anything V2 Small | Apache-2.0 | The visitor's browser, WebGPU or WebAssembly, via Transformers.js |
| Camera, lens, film | Chucksi renderer (WebGL2) | MIT | The visitor's browser |
| Video | WebCodecs H.264 + mp4-muxer | Built in / MIT | The visitor's device |
| Voiceover | Kokoro-82M via kokoro-js | Apache-2.0 | The visitor's browser, WebGPU or WebAssembly |
| Voiceover, 6 languages | MeloTTS | MIT | Cloudflare Workers AI free daily allocation (`/api/tts`, capped) |
| Captions | Whisper large-v3-turbo | MIT | Cloudflare Workers AI free daily allocation (`/api/transcribe`, capped); audio is downmixed to 16 kHz mono in the browser first |
| Sound beds | Chucksi synth (Web Audio) | MIT | The visitor's browser |
| Video to MP3 | LAME 3.100 via wasm-media-encoders 0.7.0 (MP3), WebCodecs + mp4-muxer (M4A) | LGPL-2.0 / MIT | The visitor's browser; the encoder is loaded unmodified from jsDelivr and checked by SHA-256 |
| Remove background | BiRefNet lite (512 × 512 ONNX) or MODNet | MIT / Apache-2.0 | The visitor's browser, WebGPU or WebAssembly, via ONNX Runtime Web |
| Upscale 2× / 4× | Real-ESRGAN general x4v3 | BSD-3-Clause | The visitor's browser, WebGPU or WebAssembly |
| Erase object | MI-GAN (512, Places2), or PatchMatch texture copy | MIT | The visitor's browser |
| Edit by text | Whisper large-v3-turbo for the words; Chucksi edit engine (`textedit.js`) for cuts, crossfades and captions | MIT | Whisper: Cloudflare Workers AI (`/api/transcribe`, capped); everything else in the visitor's browser |
| Mastering | Chucksi mastering chain (`master.js`, `loudness.js`), encoders as Video to MP3 | MIT | The visitor's browser |
| 3D, in the browser | Depth Anything V2 + Chucksi splat builder, rendered with Spark | Apache-2.0 / MIT | The visitor's browser |
| 3D, full object | Idol (speridlabs) | Apache-2.0 | Your own NVIDIA GPU, through `comfy/idol_server.py` |

The `/api/shot` Worker has a daily request cap (`DAILY_CAP`, default 120 frames) and a per-visitor cap (`PER_VISITOR_CAP`, default 12). These KV-backed request counters are best-effort limits, not a guaranteed spending ceiling: concurrent requests can race, models consume different amounts, and other AI endpoints share Cloudflare's allocation. Atomic budget reservation across all inference endpoints is required before expanding hosted GPU features. When a cap is hit, alternative engines may still be available through Pollinations or your ComfyUI.

Every endpoint that spends the free allowance (`/api/shot`, `/api/beats`, `/api/ask`, `/api/tts`, `/api/transcribe`) has its own daily and per-visitor cap, and two free Cloudflare services sit in front of them:

- **Turnstile.** Once every six hours a visitor's browser passes a Cloudflare Turnstile check (`public/js/human.js`), trades the token at `/api/human` for a signed cookie, and retries the request. This helps reduce automated abuse; it does not guarantee a spending ceiling. Set `TURNSTILE_SITEKEY` and the secrets `TURNSTILE_SECRET` and `PASS_KEY` to turn it on; without them the check is off.
- **AI Gateway.** Model calls go through the `massless` gateway (`AI_GATEWAY`) for request analytics and a burst rate limit. Logging and caching are off on that gateway, so scripts, documents and audio are not kept there.

## How Edit by text works

1. **Words.** The Cut page decodes the file in the tab and sends only the sound, as 16 kHz mono WAV, to `/api/transcribe` (Whisper large-v3-turbo on Workers AI, capped). It asks with a short disfluent `initial_prompt` in the chosen language ("Umm, so, uh, I was like…"), which makes Whisper write fillers down instead of dropping them, and keeps Whisper's per-word timings and segment confidence.
2. **The edit is data.** Striking words and capping pauses only changes a small state (`struck` word indexes, `caps` per gap). `compile()` turns words + state into keep ranges: struck words go together with the silences around them except the longer of the two that touch the kept neighbours, so a deletion never leaves a rushed join; a capped pause is shortened from its middle.
3. **Clean-up tools.** Fillers come from a per-language list: sounds like "um", "uh", "erm" always count; real words like "like" or "you know" only when a comma or a pause of 150 ms or more sets them off on both sides. Repeats are doubled words or phrases and cut-off words ("th- the"). Pauses are gaps longer than the cap. An energy check on the sound marks fillers with no quiet moment near their edges (left unticked) and pauses that hold sound Whisper did not write down (also left unticked).
4. **Clean cuts.** Every cut edge moves to the quietest 20 ms moment within 80 ms of it, then each join gets an 8 ms equal-power crossfade centred on the cut, so the edit is exactly as long as the kept ranges and nothing clicks.
5. **Out.** Playback renders the edit in half-second blocks scheduled back to back in Web Audio; the video follows the sound. Exports share Extract's encoders (LAME MP3, WAV), video export draws every frame of the edit (H.264 with WebCodecs, sound as AAC or Opus, mp4-muxer) with captions built from the edited transcript, and `.srt`/`.vtt` and the EDL come from the same keep ranges, so they always agree.

## How mastering works

1. **Report.** The mix is decoded in the tab and measured in a worker: integrated loudness (ITU-R BS.1770, gated), loudness range (EBU Tech 3342), true peak (4x oversampled, 24-tap interpolators), an octave-band spectrum compared with a typical mastered mix, side-to-mid width, correlation and bass width, and flat-topped clipping. Under −55 LUFS it says "Too quiet to master".
2. **Chain.** 25 Hz high-pass and 19.5 kHz low-pass; a tilt EQ that corrects about half of what is off and adds the character's lean (Warm: rounder lows, softer highs; Balanced: neutral; Bright: tighter lows, open highs, presence); a slow, stereo-linked, soft-knee glue compressor; optional width on the sides above 150 Hz with the bass kept in the middle (skipped when the mix is already very wide).
3. **Loudness and true peak.** Gain to the destination, then a look-ahead limiter whose detector watches the peaks between samples (8x oversampled). The gain is corrected (secant steps on the measured result) until the limited output is within 0.15 LU of the target, and the true peak of the actual output is checked; if any in-between peak got through, the ceiling drops and it runs again. MP3 gets its own pass with 1 dB more headroom, because encoders overshoot.
4. **Fair A/B.** Original and master play in sync and switch by gain, turned to the same loudness unless you untick it, so louder never wins by default. Exports are measured again from the written file (the WAV read back, the MP3 decoded).

## How the camera moves work

1. Depth Anything V2 estimates a depth map of the still, on the visitor's device.
2. The still becomes a 320-column mesh. Each vertex is pushed along its own ray from the rest camera, so the first frame matches the source exactly.
3. Triangles that span a depth cliff are cut away. Behind them sits a background layer: the same scene with foreground objects refilled from whatever is farther away, so a move reveals plausible background instead of stretched streaks.
4. A virtual camera follows the chosen preset. The app measures where the image edges would enter the frame over the whole move and tightens the field of view just enough to keep them out.
5. A finishing pass applies lens and film character, then WebCodecs encodes H.264 MP4 frame by frame.

## How the effects work

The effects need no video model either. They start from the same depth map:

1. **Subject.** Each row of the depth map gets a baseline (the ground or the far scene at that height). What stands out toward the camera from it is the subject: Otsu splits it, a small open and close cleans it, and the strongest piece wins, with a penalty for pieces stuck to the frame sides. A colour model then adds legs and feet that sit at floor depth and tightens the edge. No clear subject: the nearest depth band.
2. **Clean plate.** The scene behind the subject is filled with coarse-to-fine PatchMatch, copying patches from nearby places at the right depth, so a floor is filled with floor and a wall with wall.
3. **LiDAR scan.** A plane sweeps through depth and turns the photo into about 345k points on scan lines (at 1080p), drawn as glowing sprites while the camera drifts through them; a second sweep hands back the photo. Cyan, thermal or white.
4. **Vanish.** A noisy front crosses the subject. Each bit of it comes loose as a particle (ash, embers or pixels) and rides wind plus curl noise, and the clean plate shows where it was.
5. **Bullet time freeze.** Push in, a flash, then the camera swings about 34° around the subject over the clean plate, mirrored past the picture's edge, and settles back on the photo.
6. **Clones.** The camera slides sideways and copies of the subject from earlier in the move trail behind it: natural, rainbow or ghost glow.

Every frame is a function of time only, so the preview, the MP4 and the tests see the same picture. The finish (lens, film, grade) and the recorder are the ones the moves use.

## How the image tools work

The Remove background, Upscale and Erase tools on `/edit` cost nothing per use: the model runs in the visitor's browser and the image never leaves the device. A module worker (`public/js/image-ai-worker.js`) runs ONNX Runtime Web 1.30.0 on WebGPU when the browser has it and on WebAssembly otherwise, so the page stays responsive. Every runtime and model file is pinned to an exact version or revision, checked against its SHA-256 before it runs (`public/js/image-models.js`) and stored in the browser's Cache API, so it downloads once. The page states the download size before first use, shows progress, and has a button to remove the downloaded files.

| Tool | Model | Source (pinned) | License | Download |
| --- | --- | --- | --- | --- |
| Runtime | ONNX Runtime Web 1.30.0 (`ort.webgpu.bundle.min.mjs` + asyncify WASM) | jsDelivr, npm `onnxruntime-web@1.30.0` | MIT | 27 MB |
| Remove background, any subject | BiRefNet lite, 512 × 512 ONNX re-export of `ZhengPeng7/BiRefNet_lite` | Hugging Face `studioludens/birefnet-lite-512` @ `962e679` | MIT | 98 MB (fp16, WebGPU) or 192 MB (fp32, WebAssembly) |
| Remove background, people | MODNet, 8-bit ONNX | Hugging Face `Xenova/modnet` @ `fa2fa54` | Apache-2.0 | 6.6 MB |
| Upscale 2× / 4× | Real-ESRGAN general x4v3 (`realesr-general-x4v3.pth`, release v0.2.5.0), converted to ONNX without changing the weights by `tools/convert_realesrgan.py` | This repo (`public/models/`), served by jsDelivr at a pinned commit | BSD-3-Clause, see `LICENSES/` | 4.9 MB |
| Erase object | MI-GAN 512 Places2 ONNX pipeline (the file the MI-GAN README links) | Hugging Face `andraniksargsyan/migan` @ `406830d` | MIT | 28 MB |

- **Remove background** resizes the image to the model's input (512 × 512 for BiRefNet; short side 512 for MODNet), turns the output into an 8-bit matte, scales it back to full size, softens the edge on request and composites over the chosen background. Nothing else runs again when you change the background or the softness.
- **Upscale** always runs the 4× model; 2× is its output halved with a box filter. The image goes through in tiles that each carry 34 pixels of context, exactly the network's reach (34 stacked 3 × 3 convolutions), so the stitched result is identical to one full-image pass: no seams. Inputs are capped at 1024 px (2×) and 768 px (4×) on the long side.
- **Erase** turns brush strokes into a hole mask grown by a few pixels, crops around it and lets MI-GAN repaint only the hole. The no-download option reuses the coarse-to-fine PatchMatch inpainting from the Video page's clean plate (`inpaint` in `public/js/effects.js`).
- Without WebGPU, BiRefNet needs about 3 GB of memory and up to a minute; MODNet is the light option for portraits. RMBG-2.0 is not used: its weights are non-commercial.

## Run it

```bash
npm install
npx wrangler dev        # http://localhost:8787, Worker + static app
```

Any static server works for the app alone (`python3 -m http.server -d public`); the Cloudflare engine needs the Worker.

Deploy to your own Cloudflare account: create a KV namespace, put its id in `wrangler.jsonc`, then `npx wrangler deploy`. Workers AI is enabled through the `ai` binding.

How chucksi.com runs today: the Worker in `src/index.js` was uploaded through the Cloudflare API without an assets binding, so it serves the files in `public/` straight from this repo's `main` branch and caches them at Cloudflare's edge. Each page load is pinned to one commit, so a push to `main` goes live within about a minute and a page never mixes two versions; only changes to `src/index.js` need a Worker re-upload (or a switch to `wrangler deploy`, which uses the assets binding instead).

## Open weights only, on your GPU (ComfyUI)

`public/comfy/massless_shot_flux_schnell.api.json` is the hero-frame workflow in ComfyUI API format: core nodes only, FLUX.1 [schnell] fp8, no partner nodes.

From the web app: start ComfyUI with `--enable-cors-header`, choose **My own ComfyUI** as the engine and Shoot.

From the Comfy SDK (Comfy Developer Platform):

```bash
pip install comfy-sdk comfy-api-proxy
comfy-api-proxy                                   # Comfy API v2 on 127.0.0.1:8189
export COMFY_BASE_URL=http://127.0.0.1:8189
python comfy/run_shot.py "a lighthouse keeper on a spiral stair" --camera 16mm --lens vintage --focal 24 --aspect 185
```

`run_shot.py` compiles the prompt from the same `rig.json` the web app uses, so a shot designed in the browser renders identically on your GPU.

## Idol on your GPU (full 3D objects)

Idol turns one image into a complete 3D Gaussian splat, including the sides the picture never showed. It needs PyTorch and an NVIDIA GPU with about 8 GB, which neither the browser nor Cloudflare can provide (Workers AI runs a fixed model catalog, and Cloudflare Containers have no GPUs yet), so it runs on your machine:

```bash
# request access to facebook/dinov3-vith16plus-pretrain-lvd1689m and black-forest-labs/FLUX.2-dev first
hf auth login
git clone https://github.com/speridlabs/idol-sdk && pip install -e idol-sdk
python comfy/idol_server.py          # http://127.0.0.1:7861, allows chucksi.com and localhost:8787
```

Open `/3d`, choose **Full object** and press **Build 3D**. The page posts the still to `/generate` and shows the returned `.ply`. No GPU: Idol's Hugging Face demo exports a `.ply` that **Open .ply** loads.

## How Sign works

The sender's browser encrypts the PDF and every field with a fresh AES-256 key that travels only in the part of each link after `#`, which browsers never send to a server. The Worker stores ciphertext in R2 and bookkeeping (hashed tokens, signing order, event times, fingerprints) in D1, enforces signing order and consent, and signs the audit record with an ECDSA P-256 key. Every signer's browser can rebuild the identical final PDF with a Certificate of Completion; anyone can check a signed PDF at `/sign` (Verify). Unsigned envelopes are deleted after 30 days and completed ones after 90.

The contract library is CC0 JSON in `public/office/contracts/` (regenerate with `python3 tools/contracts/build.py`, check with `python3 tests/contracts_test.py`). Each template lists sources and watch-outs; creative-finance and state-specific terms need review by a local attorney.

Setup: an R2 bucket (`SIGN_BUCKET`), a D1 database (`SIGN_DB`, schema in `migrations/sign/`) and a `SIGN_KEY` secret (`node tools/sign/keygen.mjs`). See `wrangler.jsonc`.

## Tests

```bash
npm ci --ignore-scripts
npm test                            # saved-library retention, isolation, failures and connection cleanup; edit-by-text and mastering logic
pip install playwright && python -m playwright install chromium
python3 tests/render_test.py          # every move: first, middle and last frame, motion and edge checks
python3 tests/effects_test.py         # every effect and look: contact sheets, photo in and out, Vanish reveal, MP4 export
python3 tests/pages_test.py           # Video: render a clip, build and export a storyboard; Audio: render a bed
python3 tests/pages_test.py voice audio   # also generates a Kokoro voiceover (downloads the model once)
python3 tests/audio_test.py           # audio engine: every voice and every bed
python3 tests/audio_page_test.py      # Audio page: MeloTTS chunking, Captions (short, CJK, 10-minute split) against mocks
python3 tests/extract_audio_test.py   # Extract audio: MP3, WAV and M4A out, trim, fades, loudness, a queue, unreadable files
python3 tests/games_test.py           # Games: gallery, play, remix, export, every gallery game under its bot, playtests, AI art (mocked), share, offline download
python3 tests/website_test.py         # Website: generate, edit in place, sections, styles, fill images (mocked), share, ZIP and single-file export
python3 tests/edit_tools_test.py      # Edit: remove background, upscale, erase with real models, library, download, 390 px
python3 tests/edit_tools_test.py heavy  # also BiRefNet (192 MB, about 3 GB of memory without WebGPU)
python3 tests/cut_edit_test.py       # Edit by text: strike/undo, fillers, repeats, pauses, WAV/MP3/MP4 lengths, SRT/VTT timing, no clicks
python3 tests/master_test.py         # Master: report, four destinations checked with ffmpeg ebur128, 24-bit WAV, MP3, fair A/B
python3 tests/office_test.py          # Office: every convert operation, edit and save, and Ask against a mock
python3 tests/human_test.py           # the Turnstile human check: one check for concurrent calls, retries, readable failures
python3 tests/three_d_test.py         # 3D: depth splat from a sample, then the Idol path against a mock server
python3 tools/bake_depth.py           # precompute depth for the sample stills (public/media/depth)
python3 tools/effect_previews.py      # the effect tiles in the library (public/media/clips/effect-*)
python3 tests/shots.py out "/!@1440x900" "/video@390x844"   # screenshots, ! = full page
```

## Launch media

The portal hero and floating-world artwork (`massless-portal-v1.jpg`, `massless-world-v1.jpg`) were created with OpenAI image generation for the site's visual identity. They are promotional artwork, not examples of output from a Chucksi model. See [asset provenance and generation prompts](docs/asset-provenance.md).

The sample stills in `public/media/art` were generated for the launch page with a commercial image model (Higgsfield Soul). The "Real projects" row uses art from two projects by the Chucksi maker, used with permission: [Tiny Prompters](https://tinyprompters.com) (`tp-*`) and the T1 Vendetta fighting game (`t1-*`). Every clip in `public/media/clips` was rendered from those stills by Chucksi's own camera in headless Chromium. Nothing a visitor runs touches a paid model, and the stills can be swapped for FLUX.1 schnell renders without code changes.

## Limits

- People in the shot cannot act; the scene is frozen and the camera moves. For in-scene motion, open video models (LTX-Video, Wan) slot into the ComfyUI path.
- Large moves reveal stretched background behind foreground objects. Keep intensity moderate for clean results.
- Pollinations' anonymous tier allows one image per 45 seconds per IP and now serves NVIDIA Sana.

## Roadmap

- Shared project and asset library, exportable backups and resumable jobs
- Speech cleanup (noise removal), beat-aligned cuts, reference mastering and album mode
- A versioned model/workflow catalog with license, capability and measured cost information
- Open video models in ComfyUI for true in-scene motion
- Shared reels stored in R2 with a D1 index
- Atomic inference budgets, preview deployments and provider contract tests

Expanded contract/e-sign workflows and hosted Runpod inference are planned experiments, not capabilities shipped by this branch. Research notes in `docs/rea/` are design inputs; they do not certify working integrations.

## Credits and license

MIT, see [LICENSE](LICENSE); third-party notices for the image tools' models are in [LICENSES/](LICENSES/). Uses FLUX.1 [schnell] by Black Forest Labs (Apache-2.0), Depth Anything V2 Small (Apache-2.0), Transformers.js by Hugging Face (Apache-2.0), ONNX Runtime Web by Microsoft (MIT), BiRefNet (MIT), MODNet (Apache-2.0), Real-ESRGAN (BSD-3-Clause), MI-GAN by Picsart AI Research (MIT), mp4-muxer by Vanilagy (MIT), Big Shoulders Display and Instrument Sans (SIL Open Font License).

Inspired by Comfy's Open Source Higgsfield challenge and by REA (Reverse Engineer Anything). Chucksi contains no code, prompts, assets or branding from Higgsfield; features were rebuilt from public descriptions of their behavior.

## Motion-first Explore

Explore now leads with Showtime music-video previews, native effects, five distinct studio landing pages and live browser demos. The camera library has 28 distinct scene artworks, including four new original studies. The Music Preview tool renders artwork and audio locally; Form & Field uses images generated through Chucksi. The Orbit game and Form & Field website are original, small open-source demos. The gallery's commissioned Kling/Wan/Genjutsu films are visual references, not outputs of the current Chucksi tools. No paid generation API is required to run the site. See [release notes and GPU roadmap](docs/MOTION-RELEASE.md) and [artwork provenance](docs/asset-provenance.md).

## Workflows, private projects and MOSS Image

The top-level **Workflows** page connects six practical creator tasks with reusable plans and exports. **My projects** adds optional Supabase sign-in, private files and saved workflow plans. **MOSS Image SFT** is available through a limited, authenticated Runpod preview; other browser tools remain usable without an account. Five curated VFX4All presets and the official FLUX 3 Klein ComfyUI template are downloadable, with separate setup and license requirements clearly identified. See [setup, verification and budget details](docs/WORKFLOWS-CLOUD-MOSS.md).
