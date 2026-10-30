# Massless

**A free cinema camera for AI shots.** Design a shot with real camera, lens and film choices, render it with a free open-weight model, then fly a camera through it: dolly zoom, crash zoom, arcs, crane, rack focus, bullet time. Export MP4.

Live: **https://massless.chucksi.com**

The Higgs field is what gives particles mass. Massless is the version with none: no subscription, no credits, no paid models. Every model it uses has open weights and costs $0 to run.

## The site

Four pages, laid out like a commercial AI film studio, with every paid model swapped for an open one:

| Page | What it does |
| --- | --- |
| **Explore** (`/`) | Launch rail, tool tiles, the moves showcase and a wall of clips made in Massless. |
| **Image** (`/image`) | Cinema Studio, the shot designer. Camera body, lens, focal length (8–135mm), aperture (f/1.4–f/11), shot size, angle, light, film stock, aspect ratio, genre and palette compile into a prompt you can read and edit. Up to four takes per prompt with FLUX.1 schnell. |
| **Video** (`/video`) | 28 camera moves on any still (dolly zoom, crash zoom, arcs, crane, rack focus, bullet time), with lens and film finish. Render a clip, or add shots to a storyboard, reorder them and export one stitched MP4. |
| **3D** (`/3d`) | Image to 3D. Any still becomes a Gaussian splat you can orbit, built in the browser from its depth map, or a full object from Idol (speridlabs, Apache-2.0) running on your own GPU. Opens and exports standard 3DGS `.ply`. |
| **Office** (`/office`) | A free PDF toolkit in the browser: edit (highlight, text, draw, sign, notes) and save a real PDF; convert images to PDF and back, merge, split, rotate, compress, extract text; ask questions about a PDF with Llama 3.3. Files never leave the browser except the text you choose to ask about. |
| **Audio** (`/audio`) | Voiceover from a script with eight English Kokoro voices in the browser, or six languages (English, Spanish, French, Chinese, Japanese, Korean) with MeloTTS. Captions: drop audio or video, get an editable transcript and `.srt`/`.vtt` from Whisper, with optional translation to English. Sound beds (rain, wind, ocean, city night, room tone, campfire, forest) synthesized from scratch. WAV out. Deep links: `/audio?tab=captions`, `/audio?engine=melo&lang=es`. |

Everything a visitor makes is stored in their own browser (IndexedDB). There are no accounts.

What it rebuilds, clean-room from public behavior (see [SPEC.md](SPEC.md)): the shot designer, camera-motion presets, takes, storyboard and voiceover of paywalled AI film studios.

## How it stays free

| Job | Model | License | Where it runs |
| --- | --- | --- | --- |
| Hero frame | FLUX.1 [schnell] (Apache-2.0), SDXL-Lightning and SDXL 1.0 (OpenRAIL++), DreamShaper 8 (CreativeML OpenRAIL-M) | Open weights | Cloudflare Workers AI free daily allocation, or your own ComfyUI; Pollinations' community API (NVIDIA Sana, 1 image per 45 s) as a fallback |
| Depth | Depth Anything V2 Small | Apache-2.0 | The visitor's browser, WebGPU or WebAssembly, via Transformers.js |
| Camera, lens, film | Massless renderer (WebGL2) | MIT | The visitor's browser |
| Video | WebCodecs H.264 + mp4-muxer | Built in / MIT | The visitor's device |
| Voiceover | Kokoro-82M via kokoro-js | Apache-2.0 | The visitor's browser, WebGPU or WebAssembly |
| Voiceover, 6 languages | MeloTTS | MIT | Cloudflare Workers AI free daily allocation (`/api/tts`, capped) |
| Captions | Whisper large-v3-turbo | MIT | Cloudflare Workers AI free daily allocation (`/api/transcribe`, capped); audio is downmixed to 16 kHz mono in the browser first |
| Sound beds | Massless synth (Web Audio) | MIT | The visitor's browser |
| 3D, in the browser | Depth Anything V2 + Massless splat builder, rendered with Spark | Apache-2.0 / MIT | The visitor's browser |
| 3D, full object | Idol (speridlabs) | Apache-2.0 | Your own NVIDIA GPU, through `comfy/idol_server.py` |

The `/api/shot` Worker keeps itself inside Cloudflare's 10,000 free Neurons per day with a daily cap (`DAILY_CAP`, default 120 frames) and a per-visitor cap (`PER_VISITOR_CAP`, default 12). When the cap is hit the app keeps working through Pollinations or your ComfyUI.

## How the camera moves work

1. Depth Anything V2 estimates a depth map of the still, on the visitor's device.
2. The still becomes a 320-column mesh. Each vertex is pushed along its own ray from the rest camera, so the first frame matches the source exactly.
3. Triangles that span a depth cliff are cut away. Behind them sits a background layer: the same scene with foreground objects refilled from whatever is farther away, so a move reveals plausible background instead of stretched streaks.
4. A virtual camera follows the chosen preset. The app measures where the image edges would enter the frame over the whole move and tightens the field of view just enough to keep them out.
5. A finishing pass applies lens and film character, then WebCodecs encodes H.264 MP4 frame by frame.

## Run it

```bash
npm install
npx wrangler dev        # http://localhost:8787, Worker + static app
```

Any static server works for the app alone (`python3 -m http.server -d public`); the Cloudflare engine needs the Worker.

Deploy to your own Cloudflare account: create a KV namespace, put its id in `wrangler.jsonc`, then `npx wrangler deploy`. Workers AI is enabled through the `ai` binding.

How massless.chucksi.com runs today: the Worker in `src/index.js` was uploaded through the Cloudflare API without an assets binding, so it serves the files in `public/` straight from this repo's `main` branch and caches them at Cloudflare's edge. Each page load is pinned to one commit, so a push to `main` goes live within about a minute and a page never mixes two versions; only changes to `src/index.js` need a Worker re-upload (or a switch to `wrangler deploy`, which uses the assets binding instead).

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
python comfy/idol_server.py          # http://127.0.0.1:7861, allows massless.chucksi.com and localhost:8787
```

Open `/3d`, choose **Idol on your GPU** and press **Build 3D**. The page posts the still to `/generate` and shows the returned `.ply`. No GPU: Idol's Hugging Face demo exports a `.ply` that **Open .ply** loads.

## Tests

```bash
pip install playwright && python -m playwright install chromium
python3 tests/render_test.py          # every move: first, middle and last frame, motion and edge checks
python3 tests/pages_test.py           # Video: render a clip, build and export a storyboard; Audio: render a bed
python3 tests/pages_test.py voice audio   # also generates a Kokoro voiceover (downloads the model once)
python3 tests/audio_test.py           # audio engine: every voice and every bed
python3 tests/audio_page_test.py      # Audio page: MeloTTS chunking, Captions (short, CJK, 10-minute split) against mocks
python3 tests/office_test.py          # Office: every convert operation, edit and save, and Ask against a mock
python3 tests/three_d_test.py         # 3D: depth splat from a sample, then the Idol path against a mock server
python3 tools/bake_depth.py           # precompute depth for the sample stills (public/media/depth)
python3 tests/shots.py out "/!@1440x900" "/video@390x844"   # screenshots, ! = full page
```

## Launch media

The sample stills in `public/media/art` were generated for the launch page with a commercial image model (Higgsfield Soul). Every clip in `public/media/clips` was rendered from those stills by Massless's own camera in headless Chromium. Nothing a visitor runs touches a paid model, and the stills can be swapped for FLUX.1 schnell renders without code changes.

## Limits

- People in the shot cannot act; the scene is frozen and the camera moves. For in-scene motion, open video models (LTX-Video, Wan) slot into the ComfyUI path.
- Large moves reveal stretched background behind foreground objects. Keep intensity moderate for clean results.
- Pollinations' anonymous tier allows one image per 45 seconds per IP and now serves NVIDIA Sana.

## Roadmap

- Multi-shot sequencer with cuts, exported as one clip
- Open video models in ComfyUI for true in-scene motion
- Shared reels stored in R2 with a D1 index

## Credits and license

MIT, see [LICENSE](LICENSE). Uses FLUX.1 [schnell] by Black Forest Labs (Apache-2.0), Depth Anything V2 Small (Apache-2.0), Transformers.js by Hugging Face (Apache-2.0), mp4-muxer by Vanilagy (MIT), Big Shoulders Display and Instrument Sans (SIL Open Font License).

Inspired by Comfy's Open Source Higgsfield challenge and by REA (Reverse Engineer Anything). Massless contains no code, prompts, assets or branding from Higgsfield; features were rebuilt from public descriptions of their behavior.
