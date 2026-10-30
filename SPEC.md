# Massless: clean-room feature contract

This is the "oracle" step of the REA-style loop (observe → write the contract → rebuild from scratch → check against the contract). Every behavior below was taken from **public** material only: product help pages, public API schemas published on docs.comfy.org, third-party tutorials and marketing pages. No proprietary code, binaries, weights, prompts or assets were inspected, decompiled or copied.

## Target 1: Cinema Studio (shot design)

**Observed public behavior**

- A "rig" step before generation: camera body, lens type, focal length, aperture. Public help text lists a sensor/look profile (VHS, film, digital cinema), focal lengths from roughly 8mm to 135mm, and apertures from about f/1.4 to f/11.
- Per-shot camera settings, plus project-wide genre, lighting, color palette and aspect ratio.
- A key ("hero") frame is generated first and defines the look; motion is applied after.
- Paid models do the generation (Kling, Veo, Seedance, Higgsfield's own).

**Massless contract**

| Input | Values |
| --- | --- |
| Subject + setting | free text |
| Camera look | large-format digital, Super 35 digital, 65mm film, 35mm film, 16mm film, Super 8, VHS camcorder |
| Lens | clean spherical prime, vintage prime, anamorphic, macro, tilt-shift |
| Focal length | 8, 14, 24, 35, 50, 85, 135 mm |
| Aperture | f/1.4, f/2.8, f/5.6, f/11 |
| Shot size, angle | extreme wide → insert; eye level, low, high, overhead, dutch, over-the-shoulder |
| Light | 10 presets (golden hour, blue hour, neon night, …) |
| Stock / grade | 8 presets |
| Aspect | 2.39:1, 1.85:1, 16:9, 4:5, 9:16, 1:1 |

**Output:** a hero frame at the chosen aspect, plus the exact compiled prompt shown to the user (Higgsfield hides it; Massless shows it and lets you edit it).

**Improvement over the original:** the rig is not only words in a prompt. Lens, focal length, camera look and aperture also drive a physical post pipeline: barrel distortion for 8/14mm, oval bokeh and streak flares for anamorphic, glow for vintage glass, grain and gate weave for film bodies, chroma bleed and scanlines for VHS, and real depth-based blur for aperture.

## Target 2: Camera-motion presets (image → video)

**Observed public behavior**

- Image in, preset out: Dolly In/Out, Crash Zoom In/Out, Dolly Zoom, Arc Left/Right, Crane Up/Down, Tilt Up/Down, Handheld, Bullet Time, Focus Change, Static, and more.
- About 150 seconds of server time per clip on a paid video model; fixed duration; credits per clip.

**Massless contract**

- Input: any still (generated or uploaded).
- 14 presets: Breathe (static), Dolly In, Dolly Out, Crash Zoom, Dolly Zoom, Arc Left, Arc Right, Crane Up, Truck Right, Tilt Up, Handheld, Rack Focus, Bullet Time, Float.
- Controls: duration 2–8 s, intensity, focus point, finish (grain, halation, vignette, aberration, grade).
- Output: MP4 (or WebM where MP4 recording is unavailable) at 24/30 fps, plus PNG frames.

**How it works without a video model:** a monocular depth map (Depth Anything V2 Small, open weights) is estimated in the visitor's browser. The still becomes a displaced mesh whose vertices are pushed along their own camera rays, so the rest frame is pixel-identical to the source, and a virtual camera flies through it. Camera moves are real geometry, which is why a dolly zoom is a dolly zoom and never a plain zoom (the failure mode the original's own marketing warns about with text-prompted video models).

**Honest limits:** the subject cannot act (no new motion inside the scene) and large moves reveal stretched edges behind foreground objects. For real in-scene motion, the ComfyUI path in `comfy/` is where open video models (LTX-Video, Wan) slot in.

## Free-model replacement map

| Paid in the original | Massless uses | License | Where it runs |
| --- | --- | --- | --- |
| Hero-frame model (Higgsfield Soul, Seedream, Nano Banana…) | FLUX.1 [schnell] | Apache-2.0 | Pollinations free API, Cloudflare Workers AI free daily allocation, or your own ComfyUI |
| Image-to-video camera models (Kling, Veo, Wan, Seedance) | Depth Anything V2 Small + WebGL camera | Apache-2.0 | The visitor's browser (WebGPU or WASM) |
| Prompt "enhance" LLM | Deterministic rig compiler | MIT (this repo) | Browser |
| Grading / finishing | Custom GLSL post pipeline | MIT (this repo) | Browser |

## Checks

- Rest frame equals source frame (rays-preserving displacement): verified by the headless render test.
- Each preset produces non-zero motion and stays inside the overscan (no plane edges in frame) at intensity 1.0: verified by rendering first, middle and last frames of every preset.
- No paid API is reachable from the code: grep for keys and paid endpoints returns nothing.
