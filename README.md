# Massless

**A free cinema camera for AI shots.** Design a shot with real camera, lens and film choices, render it with a free open-weight model, then fly a camera through it: dolly zoom, crash zoom, arcs, crane, rack focus, bullet time. Export MP4.

Live: **https://massless.chucksi.com**

The Higgs field is what gives particles mass. Massless is the version with none: no subscription, no credits, no paid models. Every model it uses has open weights and costs $0 to run.

## What it rebuilds

Two paywalled features of commercial AI film studios, rebuilt clean-room from their public behavior (see [SPEC.md](SPEC.md)):

1. **Cinema Studio, the shot designer.** Camera body, lens, focal length (8–135mm), aperture (f/1.4–f/11), shot size, angle, light, film stock, aspect ratio. Massless compiles these into a prompt you can read and edit, and then applies the same choices physically in post: barrel distortion on wide glass, oval bokeh and streak flares on anamorphic, glow on vintage lenses, grain and gate weave on film bodies, chroma bleed and scanlines on VHS, depth-based blur for aperture.
2. **Camera-motion presets.** Fourteen moves on any still, generated or your own. A dolly zoom is real geometry here, not a guess by a video model.

## How it stays free

| Job | Model | License | Where it runs |
| --- | --- | --- | --- |
| Hero frame | FLUX.1 [schnell] | Apache-2.0 | Pollinations (no key), Cloudflare Workers AI free daily allocation, or your own ComfyUI |
| Depth | Depth Anything V2 Small | Apache-2.0 | The visitor's browser, WebGPU or WebAssembly, via Transformers.js |
| Camera, lens, film | Massless renderer (WebGL2) | MIT | The visitor's browser |
| Video | WebCodecs H.264 + mp4-muxer | Built in / MIT | The visitor's device |

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

## Tests

```bash
pip install playwright && python -m playwright install chromium
python3 tests/render_test.py
```

Renders the first, middle and last frame of every move headlessly and checks for motion, for image edges entering the frame, and for console errors.

## Limits

- People in the shot cannot act; the scene is frozen and the camera moves. For in-scene motion, open video models (LTX-Video, Wan) slot into the ComfyUI path.
- Large moves reveal stretched background behind foreground objects. Keep intensity moderate for clean results.
- Pollinations' anonymous tier allows about one frame per 15 seconds per visitor.

## Roadmap

- Multi-shot sequencer with cuts, exported as one clip
- Open video models in ComfyUI for true in-scene motion
- Shared reels stored in R2 with a D1 index

## Credits and license

MIT, see [LICENSE](LICENSE). Uses FLUX.1 [schnell] by Black Forest Labs (Apache-2.0), Depth Anything V2 Small (Apache-2.0), Transformers.js by Hugging Face (Apache-2.0), mp4-muxer by Vanilagy (MIT), Big Shoulders Display and Instrument Sans (SIL Open Font License).

Inspired by Comfy's Open Source Higgsfield challenge and by REA (Reverse Engineer Anything). Massless contains no code, prompts, assets or branding from Higgsfield; features were rebuilt from public descriptions of their behavior.
