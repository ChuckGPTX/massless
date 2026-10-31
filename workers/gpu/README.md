# Massless GPU worker

Heavy open models on a RunPod Serverless GPU that scales to zero. ComfyUI runs inside the worker; our own
small handler (`handler.py`, MIT) drives it over its local HTTP and websocket API. Weights are baked into the
image at build time (no network volume), each in its own layer, checked by size and SHA-256.

The site never talks to RunPod. Signed-in users submit through `/api/generations`; the `GenerationLedger`
Durable Object (`src/generations.js`, `src/gpu-jobs.js`) reserves the worst-case cost, enforces one daily
budget for every hosted job (MOSS Image included) and a per-user daily limit, sends the job, settles the real
cost from RunPod's reported times, and stores the result for 24 hours. Anonymous visitors get no GPU jobs; the
browser tools stay free and need no account.

## Jobs

Main image (`Dockerfile`, every model licensed for commercial use):

| Job | Model | Input | Output |
| --- | --- | --- | --- |
| `animate` | Wan 2.2 TI2V-5B: `wan-fast` (default, FastWan 3-step DMD distill) or `wan` (stock, 4-40 steps, CFG 5) | `image` (base64 JPEG/PNG/WebP, at most 2048 px), `prompt`, `negative` (wan only), `resolution` 480p/720p, `aspect` 16:9/9:16/1:1, `seed`, `steps` | 5.04 s H.264 MP4, 24 fps, 121 frames (832x480, 480x832, 640x640, 1280x704, 704x1280, 960x960) |
| `music` | ACE-Step 1.5 turbo (8 steps) + 1.7B planner LM | `tags` (required), `lyrics` (empty = instrumental), `duration` 10-180 s, `bpm` 40-220, `key`, `timesignature`, `language`, `seed` | MP3, LAME V0 |
| `upscale` | Real-ESRGAN x4plus | `image`, `scale` 2/4, `format` jpeg/webp | JPEG/WebP q92, long side capped at 4096 px |

Every result: `{type, mime, data (base64), width, height, duration, seconds, model, seed, ...}`, or `{error}`.
LTX-2.5 is not included: its repo is gated (needs an HF token), its ComfyUI int8 build (21.5 GB transformer plus
a 15.4 GB Gemma-4 encoder) does not fit 24 GB, and ComfyUI's int8/fp4 kernels need CUDA 13 builds of PyTorch.

Lab image (`Dockerfile.lab`, research licenses; off unless the Worker sets `LAB_ENABLED=true`; every result
carries `license` and `commercial: false`):

| Job | Model | Input | Output |
| --- | --- | --- | --- |
| `sound` | `mmaudio` (MMAudio large 44k v2, default) or `foley` (HunyuanVideo-Foley XXL, fp8) | `video` (MP4 at most 10 s and 7 MB), `prompt`, `negative`, `seed`, `steps` | the same MP4 with the generated sound muxed in (video stream copied, AAC 192k) plus the audio alone as M4A |
| `fibo` | Fibo 2.0 edit turbo (4 steps, does text-to-image and edits) | `mode` generate/edit, `prompt` (text or a Fibo JSON caption), `shot` (a Massless rig selection), `image` (edit), `aspect`, `seed`, `steps` 2-8 | JPEG q92 at Fibo's trained size for the aspect (about 1 MP), plus the `caption` sent |

The sound clip is re-timed to 25 fps and scaled to 512 px on the short side before ComfyUI sees it (the MMAudio
node assumes 25 fps frames); the original picture is what gets the new track. The 7 MB cap exists because
RunPod `/run` bodies are limited to 10 MB and base64 adds a third.

Foley's license (Tencent Hunyuan Community) does not apply in the EU, the UK or South Korea; the ledger refuses
`foley` for those countries (from `request.cf.country`) with HTTP 451 and suggests MMAudio.

### Fibo: from a Massless shot to a Fibo caption

Fibo 2.0 reads structured captions (Bria VGL). A `shot` uses the same ids as `public/js/rig.js` (`subject`,
`camera`, `lens`, `focal`, `aperture`, `shot`, `angle`, `light`, `stock`, `genre`, `palette`, `aspect`; same
defaults) and the phrases are rig.json's own prompt text:

| Caption field | From |
| --- | --- |
| `short_description` | subject, shot size phrase, light conditions, genre phrase (+ `prompt` text if given) |
| `objects[0]` | subject; `location` center (foreground for over-the-shoulder); `relative_size` from the shot size |
| `lighting` | `conditions`, `direction`, `shadows`: the light preset split into three (table in `handler.py`) |
| `aesthetics` | `composition` shot + framing + aspect; `color_scheme` palette + stock; `mood_atmosphere` genre (or light) |
| `photographic_characteristics` | `depth_of_field`/`focus` from the aperture (macro and tilt-shift lenses set focus); `camera_angle` angle; `lens_focal_length` focal + lens |
| `style_medium`, `artistic_style` | from the camera body (digital: photograph; film: film photograph; VHS: analog video still) |
| `context` | "This is a cinematic film still [from a <genre> film], <camera phrase>." |
| `text_render` | `[]` (Massless shots have no text) |

In edit mode the `prompt` text becomes `edit_instruction`. A raw caption object is passed through after a key check.

## Licenses

Our files are MIT (`LICENSE`). ComfyUI is GPL-3.0, installed unmodified at a pinned commit as a separate
program. Every weight file, with URL pinned to a Hugging Face commit, SHA-256, size and the license read from its
card, is in `models.json` and `models.lab.json`.

Main image, ComfyUI v0.42.5 (`483dae43`), torch 2.14.1+cu126:

| File | Size | License |
| --- | --- | --- |
| Wan 2.2 TI2V-5B fp16 (Comfy-Org repack of Wan-AI) | 10.00 GB | Apache-2.0 |
| FastWan 2.2 TI2V-5B FullAttn, bf16 (FastVideo; renamed from diffusers layout in place at build time) | 10.00 GB | Apache-2.0 |
| umT5-XXL fp8 text encoder | 6.74 GB | Apache-2.0 |
| Wan 2.2 VAE | 1.41 GB | Apache-2.0 |
| ACE-Step 1.5 turbo DiT | 4.79 GB | MIT (upstream card; output usable commercially) |
| ACE-Step 1.5 Qwen3-0.6B encoder, 1.7B planner LM, VAE | 1.19 + 3.71 + 0.34 GB | MIT |
| Real-ESRGAN x4plus (safetensors) | 0.07 GB | BSD-3-Clause |

Weights 38.24 GB; Python environment 7.9 GB; CUDA runtime base 3.9 GB. Image about 50 GB.

Lab image, ComfyUI v0.43.1 (`086099f5`, first release with Fibo 2.0), torch 2.11.0+cu126 (torchaudio, which
Foley imports, stops at 2.11), custom nodes `kijai/ComfyUI-MMAudio@8eaeb72e` (MIT) and
`phazei/ComfyUI-HunyuanVideo-Foley@afd2960b` (Tencent Hunyuan Community License: it contains Tencent code):

| File | Size | License |
| --- | --- | --- |
| Fibo 2.0 edit turbo bf16 (Comfy-Org repack; Bria's weights) | 16.45 GB | CC BY-NC 4.0 |
| Qwen3-VL-4B encoder, FLUX.2 VAE | 8.88 + 0.34 GB | Apache-2.0 |
| MMAudio large 44k v2, VAE, Synchformer (fp16 by Kijai; the mirror's card says MIT, the weights are CC BY-NC 4.0) | 2.06 + 0.61 + 0.47 GB | CC BY-NC 4.0 |
| Apple DFN5B CLIP ViT-H-14-384 fp16 | 1.97 GB | Apple AMLR (research only) |
| NVIDIA BigVGAN v2 44 kHz | 0.49 GB | MIT |
| HunyuanVideo-Foley XXL fp8, Synchformer, DAC VAE (safetensors by phazei) | 5.34 + 0.47 + 0.74 GB | Tencent Hunyuan Community (not EU/UK/KR) |
| SigLIP2 base 512, LAION CLAP (offline Hugging Face cache) | 1.50 + 0.78 GB | Apache-2.0 |

Weights 40.12 GB; Python 7.5 GB; plus ffmpeg. Image about 52 GB.

## Build

RunPod endpoint, "Import Git Repository": branch `main`, build context `.` (repository root), Dockerfile path
`workers/gpu/Dockerfile` (Lab: `workers/gpu/Dockerfile.lab`); a GitHub release rebuilds it. The base image comes
from NVIDIA's public registry (`nvcr.io/nvidia/cuda:12.6.3-runtime-ubuntu24.04`, pinned by digest, the same
amd64 image as Docker Hub's) to avoid Docker Hub's anonymous pull limit. Downloads use aria2c with 16
connections: about 38-40 GB per image, roughly 5-10 minutes on a datacenter link, inside the 30-minute
`docker build` limit. Layers go base, weights, Python, ComfyUI, our code, so code changes never re-download weights.

```
docker build -f workers/gpu/Dockerfile -t massless-gpu .
docker build -f workers/gpu/Dockerfile --build-arg MASSLESS_SKIP_MODELS=1 -t massless-gpu:noweights .   # no weights
docker run --gpus all --rm massless-gpu python -u handler.py --test_input '{"input": {"job": "music", "tags": "lofi"}}'
```

`fetch_model.py --summary models.json` prints the weight sizes; the last build step prints the image size estimate.

### Endpoints (both)

Queue endpoint; GPU 24 GB (L4, RTX A5000, RTX 3090; about $0.76/hr), optional fallback 24 GB PRO (RTX 4090,
$1.34/hr: then set `GPU_CENTS_PER_HOUR=134` so settlement never undercounts); active workers 0, max workers 1;
idle timeout 5 s; FlashBoot on; execution timeout 1800 s main, 600 s Lab (a backstop: each request carries its
own tighter `executionTimeout`); container disk 20 GB; no network volume; allowed CUDA versions 12.4 and up (the
image ships CUDA 12.6, which runs on 12.4 drivers by minor-version compatibility). Fibo bf16 (16.5 GB) and its
encoder (8.9 GB) swap through host RAM on 24 GB; a 48 GB GPU avoids that but costs about $1.22/hr.

MOSS Image stays its own image and endpoint (`workers/moss`, 48 GB): it needs a 48 GB GPU and its own
PyTorch 2.9/diffusers stack, and putting it in this image would move every job to the 48 GB price and push the
image past 80 GB. The ledger still puts both in one daily budget.

## Handler environment

`COMFY_DIR` (/opt/ComfyUI), `COMFY_HOST` (127.0.0.1:8188), `COMFY_START` (1), `COMFY_CMD`, `COMFY_ARGS`,
`COMFY_STARTUP_TIMEOUT` (180), `MASSLESS_IMAGE` (main or lab), `MASSLESS_WORKFLOWS`, `MASSLESS_TIMEOUT_SCALE`
(1), `MASSLESS_MAX_RESULT_MB` (15), `MASSLESS_RIG`, `FFMPEG`, `FFPROBE`. None are secrets; the endpoints need none set.

## Worker configuration

Existing: `RUNPOD_API_KEY` (secret), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `GENERATION_LEDGER` (no new
migration), `MOSS_ENDPOINT_ID`, `MOSS_BUDGET_CENTS`. New vars (invalid values turn GPU jobs off):

- `GPU_ENDPOINT_ID`: the main endpoint.
- `GPU_DAILY_BUDGET_CENTS`: one daily budget for all hosted jobs, MOSS included; 0 or unset = off; max 1000.
  120 is about $36 a month at most.
- `GPU_CENTS_PER_HOUR` (76), `GPU_PER_USER_DAILY` (3), `MOSS_CENTS_PER_HOUR` (122).
- `LAB_ENABLED` (`true` to allow Lab jobs; default off), `LAB_ENDPOINT_ID`, `LAB_CENTS_PER_HOUR` (= GPU).

A job reserves `(timeout + 90 s boot + 45 s cold start + 5 s idle) x price` before it is sent and is settled to
`(executionTime + min(delayTime, 45 s) + 5 s) x price` when RunPod reports it (a job with no reported time keeps
its reservation; a submission whose result is unknown is never retried). One running job per user.

## Cost per job (24 GB at $0.76/hr; GPU-seconds are estimates until measured)

| Job | Warm GPU time | Settled | Reserved |
| --- | --- | --- | --- |
| animate wan-fast 480p | 30-45 s (3 DiT passes about 10-15 s, VAE decode 10-25 s) | about 1-2¢ | 9¢ |
| animate wan-fast 720p | 70-120 s | 2-3¢ | 13¢ |
| animate wan 480p, 20 steps | 3-4 min | 4-6¢ | 11¢ |
| animate wan 720p, 20 steps | 7-10 min | 9-13¢ | 22¢ |
| music 30 s / 180 s | 10-20 s / 30-60 s | 1¢ / 1-2¢ | 6¢ / 9¢ |
| upscale 1536 px x2 or x4 | 5-10 s | 1¢ | 7¢ |
| Lab sound MMAudio / Foley | 10-20 s / 40-80 s | 1¢ / 1-2¢ | 6¢ / 8¢ |
| Lab fibo | 15-30 s | 1¢ | 8¢ |
| MOSS (48 GB, measured 77.6-81.9 s) | about 85 s | about 4¢ | 50¢ |

A cold worker adds ComfyUI's boot (about 15-25 s on a RunPod host; 44 s on a 2-CPU test box) and the first
load of the job's weights (animate 18 GB, music 10 GB: 10-30 s), so the first job after idle costs 1-2¢ more.

## Tests

`python3 tests/gpu_handler_test.py`: workflows checked against the pinned ComfyUI and custom-node sources (ast),
manifests against the Dockerfiles, every URL by HEAD (size and SHA-256), the FastWan rename against Comfy-Org's
5B header, and the handler end to end against a fake ComfyUI for every job type (the sound job muxes for real with
ffmpeg). `npm test` and `npm run test:runtime` cover the ledger. `GPU_TEST_OFFLINE=1` skips network checks.
