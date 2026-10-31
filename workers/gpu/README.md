# Massless GPU worker

Heavy open models on a RunPod Serverless GPU that scales to zero. ComfyUI runs inside the worker; our own
small handler (`handler.py`, MIT) drives it over its local HTTP and websocket API.

The main endpoint runs on an 80 GB GPU (A100 80GB first, H100 80GB PRO as fallback). Its image carries no
weights: they live on a RunPod network volume (`/runpod-volume/massless/models`), and `volume.py` fetches any
file that is missing from its pinned Hugging Face commit when a worker starts, checks size and SHA-256, and moves
it into place atomically, with a lock file so two workers never download the same file. ComfyUI is pointed at the
volume with `--extra-model-paths-config`. The image is about 12 GB and builds in 5-10 minutes.

The site never talks to RunPod. Signed-in users submit through `/api/generations`; the `GenerationLedger`
Durable Object (`src/generations.js`, `src/gpu-jobs.js`) reserves the worst-case cost, enforces one daily
budget for every hosted job (MOSS Image included) and a per-user daily limit, sends the job, settles the real
cost from RunPod's reported times, and stores the result for 24 hours. Anonymous visitors get no GPU jobs; the
browser tools stay free and need no account.

## Jobs

Main image (`Dockerfile`, every model Apache-2.0, MIT or BSD-3-Clause):

| Job | Model | Input | Output |
| --- | --- | --- | --- |
| `animate` | Wan 2.2 I2V-A14B (with `image`) or T2V-A14B (text only), MoE high/low-noise experts, fp8 scaled. `mode` `quick`: Wan2.2-Lightning 4-step LoRA, 4-8 steps, no CFG; `best`: no LoRA, 10-30 steps (480p) or 10-20 (720p), CFG 3.5 (1.5-8) | `image` (optional), `prompt` (required without image), `negative` (best), `resolution` 480p/720p, `aspect` 16:9/9:16/1:1, `steps`, `cfg`, `seed` | 5.06 s H.264 MP4, 16 fps, 81 frames: 832x480, 480x832, 640x640, 1280x720, 720x1280, 960x960 |
| `motion` | Wan-Animate-2 14B distilled (bf16), 10 steps (6-12), context windows of 21 latent frames | `image` (the character), `video` (driving clip: MP4/MOV/WebM, at most 10 s and 7 MB), `prompt` (character and background), `keep_audio`, `seed`, `steps` | the character performing the clip's motion at 480p (orientation of the clip), 16 fps, with the clip's sound |
| `lipsync` | Wan 2.2 S2V-14B (fp8 scaled) + wav2vec2; `quick` (Lightning LoRA, 4-8 steps) or `best` (20 steps, CFG 6) | `image` (a face), `audio` (MP3/WAV/M4A/OGG/FLAC, at most 10 s), `prompt`, `aspect`, `mode`, `steps`, `seed` | a talking video at 480p, 16 fps, as long as the speech, with it as the soundtrack (77-frame chunks chained) |
| `upscale_video` | SeedVR2 7B (fp16), one step, temporal chunks sized to free VRAM, LAB color match | `video` (at most 10 s and 7 MB), `scale` 2/4, `seed` | up to 1920x1080, same fps (capped at 30), sound kept |
| `music` | ACE-Step 1.5 turbo (8 steps) + 1.7B planner LM | `tags` (required), `lyrics` (empty = instrumental), `duration` 10-180 s, `bpm` 40-220, `key`, `timesignature`, `language`, `seed` | MP3, LAME V0 |
| `upscale` | Real-ESRGAN x4plus | `image`, `scale` 2/4, `format` jpeg/webp | JPEG/WebP q92, long side capped at 4096 px |
| `prepare` | operator only (the site never sends it) | `jobs` (optional list), `check` (true: only report) | `{type: "status", ready, files, files_ready, bytes, bytes_ready, models[]}` |

Every result: `{type, mime, data (base64), width, height, duration, seconds, model, seed, ...}`, or `{error}`.
A video over the 15 MB result limit is re-encoded to fit (`reencoded: true`). Images arrive as JPEG <= 1536 px
from the site; clips and audio are prepared on the CPU with ffmpeg (re-timed to 16 fps for the Wan models, 30 fps
at most for SeedVR2, trimmed to 10 s) before ComfyUI sees them. All inputs together stay under RunPod's 10 MB
request limit (the Worker refuses more than 9.5 MB of base64).

Choices, and what was left out:

- **Wan 2.2 TI2V-5B / FastWan is dropped.** On an 80 GB GPU every second costs the same whatever runs, and A14B
  Quick at 480p (about 1 minute) is in the same range as FastWan 720p was, with clearly better motion and
  prompt-following. Dropping it saves 11.4 GB of volume, the diffusers-to-ComfyUI key conversion and a code path.
- **Wan-Animate-2, not Wan 2.2 Animate (v1).** Both are Apache-2.0 14B models from Wan-AI; v2 reads the driving
  clip directly, while v1 needs a pose/face preprocessing pass (DWPose, SAM2) that only exists as custom nodes.
- **Wan 2.2 S2V, not InfiniteTalk.** Both are Apache-2.0. S2V shares the umT5 encoder and VAE already on the
  volume (16.4 + 0.6 GB more); InfiniteTalk would add a Wan 2.1 I2V-14B base, its own weights and a second
  wav2vec2. S2V takes a still, not a video, as its reference: lip sync over an existing video is not offered.
- **SeedVR2 7B, not 3B.** At 80 GB the 7B fits with room for 1080p chunks and restores more detail; the step is
  one pass either way and the VAE (shared) dominates the time.
- **fp8 scaled / bf16, never int8 or nvfp4 weights.** ComfyUI's int8/fp4 kernels (comfy-kitchen) need CUDA 13
  builds of PyTorch; this image is CUDA 12.6. (The Animate-2 pose cache is stored as int8 by ComfyUI's eager code,
  which works without those kernels.)
- **720p is only offered for `animate`.** Motion and lip sync at 720p would take about 3.5x as long.
- LTX-2.5 stays out: gated repo, and its ComfyUI build needs the CUDA 13 kernels.

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
card at the source, is in `models.json` and `models.lab.json`.

Main endpoint, ComfyUI v0.42.5 (`483dae43`), torch 2.14.1+cu126. Files are downloaded from:
`Comfy-Org/Wan-2.2@ee6f4a40`, `lightx2v/Wan2.2-Lightning@18bccf88`, `Comfy-Org/Wan-Animate-2@e7181fe1`,
`Comfy-Org/SeedVR2@df488797`, `Comfy-Org/ACE-Step-1.5@371bb168`, `Comfy-Org/Real-ESRGAN@5fd49b7b`.

| File | Jobs | Size | License (upstream card) |
| --- | --- | --- | --- |
| umT5-XXL fp8 text encoder | animate, motion, lipsync | 6.74 GB | Apache-2.0 |
| Wan 2.1 VAE | animate, motion, lipsync | 0.25 GB | Apache-2.0 (Wan-AI) |
| Wan 2.2 I2V-A14B high + low noise, fp8 scaled | animate | 2 x 14.29 GB | Apache-2.0 (`Wan-AI/Wan2.2-I2V-A14B@206a9ee1`) |
| Wan 2.2 T2V-A14B high + low noise, fp8 scaled | animate | 2 x 14.29 GB | Apache-2.0 (`Wan-AI/Wan2.2-T2V-A14B@c8c270b1`) |
| Wan2.2-Lightning 4-step LoRAs: I2V Seko V1, T2V Seko V1.1 (high + low each; rank 64) | animate, lipsync (T2V high) | 4 x 1.23 GB | Apache-2.0 (`lightx2v/Wan2.2-Lightning@18bccf88`; byte-identical to Comfy-Org's copies) |
| Wan 2.2 S2V-14B, fp8 scaled | lipsync | 16.39 GB | Apache-2.0 (`Wan-AI/Wan2.2-S2V-14B@dab4e9c5`) |
| wav2vec2 large XLSR-53 English, fp16 | lipsync | 0.63 GB | Apache-2.0 (`jonatasgrosman/wav2vec2-large-xlsr-53-english`) |
| Wan-Animate-2 14B distilled, bf16 | motion | 32.79 GB | Apache-2.0 (`Wan-AI/Wan2.2-Animate-2-14B@6e8f1973`) |
| CLIP ViT-H/14 (OpenCLIP, LAION-2B) | motion | 1.26 GB | MIT (`laion/CLIP-ViT-H-14-laion2B-s32B-b79K`) |
| SeedVR2 7B fp16 + EMA VAE | upscale_video | 16.48 + 0.50 GB | Apache-2.0 (`ByteDance-Seed/SeedVR2-7B@eb0c4281`) |
| ACE-Step 1.5 turbo DiT, Qwen3-0.6B encoder, 1.7B planner LM, VAE | music | 4.79 + 1.19 + 3.71 + 0.34 GB | MIT (output usable commercially) |
| Real-ESRGAN x4plus (safetensors) | upscale | 0.07 GB | BSD-3-Clause |

147.2 GB of weights in 21 files (animate 69.1 GB, motion 41.0, lipsync 25.2, upscale_video 17.0, music 10.0).
Image: CUDA 12.6 runtime base 3.9 GB + Python environment about 7.9 GB + ffmpeg + ComfyUI, no weights.

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
amd64 image as Docker Hub's) to avoid Docker Hub's anonymous pull limit. The main build downloads only Python
wheels (about 3 GB) and ComfyUI: about 5-10 minutes, well inside the 30-minute `docker build` limit.

```
docker build -f workers/gpu/Dockerfile -t massless-gpu .
```

## Setup (main endpoint)

### 1. Network volume

**Created 2026-10-31:** `chucksi-models` (id `idcdu8gen6`), **180 GB, high-performance tier, data center US-CA-2**,
$25.20 a month ($0.14/GB/month; the standard tier would be $12.60). 147.2 GB of weights plus room for one replaced
file and the `.part` of a re-download; volumes can grow later but never shrink. S3 API: endpoint
`https://s3api-us-ca-2.runpod.io`, bucket `idcdu8gen6`, region `us-ca-2`.

Why US-CA-2: on the day of setup no US data center had A100 80GB in stock, and none anywhere had both A100 and
H100. US-CA-2 had H100 SXM and H200 SXM for GPUs and plenty of CPU pods for filling the volume without GPU billing.
The endpoint only runs where its volume is.

### 2. Fill the volume (once)

Either:

- **CPU pod (cheapest, no GPU billed).** If the datacenter offers CPU pods with network volumes, deploy one
  (any Python 3 image) with the volume attached and run, from a checkout of this repository or with
  `workers/gpu/volume.py` and `workers/gpu/models.json` copied over:
  `pip install requests && python3 workers/gpu/volume.py --root /workspace/massless --manifest workers/gpu/models.json`.
  Pods mount the volume at `/workspace` and Serverless workers at `/runpod-volume`, so the files land in the same
  place. Stop the pod when it prints `"ready": true` (install `aria2` first for faster downloads).
- **The `prepare` job (on the endpoint, after step 3).** It runs on the GPU worker, so it is billed at the GPU
  rate (roughly $1-2 for a fresh volume):

```
curl -s https://api.runpod.ai/v2/$GPU_ENDPOINT_ID/run -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"input": {"job": "prepare"}, "policy": {"executionTimeout": 3600000}}'
curl -s https://api.runpod.ai/v2/$GPU_ENDPOINT_ID/status/<id> -H "Authorization: Bearer $RUNPOD_API_KEY"
```

`{"job": "prepare", "check": true}` only reports; `"jobs": ["animate"]` limits it to some job kinds.

First fill: 147 GB. The volume writes at about 200-400 MB/s and aria2c pulls with 16 connections, then every
file is hashed once (SHA-256) before it is moved into place, so expect about 15-25 minutes. After that a worker
start only stats each file and reads its marker (no hashing, no network). Any worker that starts and finds a file
missing fetches it in the background (with the per-file lock), but a user job never waits for downloads by
default (`MASSLESS_MODEL_WAIT=0`): it fails at once with "models are not on the GPU volume yet", and its cost
settles to the few seconds it ran.

### 3. Endpoint

Serverless, New Endpoint, from this repository (step "Build"), Queue type:

- GPUs, in priority order: **80 GB PRO** (H100 SXM, $5.39/hr) first, **141 GB** (H200, $6.99/hr) as the fallback
  when H100s are busy. (A100 80GB was not available in US-CA-2 at setup; add it first if it appears, since it is
  half the hourly price.)
- Active workers 0, **max workers 1**, idle timeout **5 s**, **FlashBoot on**.
- Execution timeout **3600 s** (only a ceiling: every request carries its own, tighter `executionTimeout`; the
  longest user job is 2460 s, and the `prepare` job needs up to an hour).
- Advanced, Network Volumes: **`chucksi-models`** (US-CA-2).
- Container disk 20 GB; allowed CUDA versions 12.4 and up (the image ships CUDA 12.6).
- No environment variables are needed (defaults: `MASSLESS_IMAGE=main`, `MASSLESS_VOLUME=/runpod-volume/massless`).

MOSS Image stays its own 48 GB endpoint (`workers/moss`, `AMPERE_48`, $1.22/hr) with its own stack; the ledger
puts it inside the same daily budget.

### 4. Worker vars (Cloudflare)

Existing: `RUNPOD_API_KEY` (secret), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `GENERATION_LEDGER` (no new
migration), `MOSS_ENDPOINT_ID`, `MOSS_BUDGET_CENTS`. GPU vars (an invalid value turns GPU jobs off):

| Var | Set to | Meaning |
| --- | --- | --- |
| `GPU_ENDPOINT_ID` | the endpoint id | main endpoint |
| `GPU_DAILY_BUDGET_CENTS` | `500` | one daily budget for all hosted jobs, MOSS included (0/unset = off, max 10000) |
| `GPU_CENTS_PER_HOUR` | `699` | the dearest GPU the endpoint may use (H200 fallback), used to reserve and settle (default 539, max 2000) |
| `GPU_PER_USER_DAILY` | `10` | jobs per signed-in user per UTC day (default 10) |
| `MOSS_CENTS_PER_HOUR` | `122` | MOSS settlement |
| `LAB_ENABLED`, `LAB_ENDPOINT_ID`, `LAB_CENTS_PER_HOUR` | off | Lab image (below) |

Pricing at 699 is deliberately conservative: RunPod does not report which GPU ran a job, so the ledger assumes
the dearest one the endpoint may use (H200). Jobs that land on an H100 ($5.39/hr) are charged about 30% more than
RunPod bills. $5 a day is at most about $150 a month of GPU time; with a handful of testers expect far less.

A job reserves `(timeout + 90 s boot + 45 s cold start + 5 s idle) x price` before it is sent and is settled to
`(executionTime + min(delayTime, 45 s) + 5 s) x price` when RunPod reports it (a job with no reported time keeps
its reservation; a submission whose result is unknown is never retried). One running job per user. Only a hash
of the input is stored, never the image or clip.

## Cost per job

**On the H100 endpoint (US-CA-2):** an H100 runs these jobs in roughly half the A100 time below at about twice the
hourly price, so the per-job cost is about the same as the "A100 real" column, and the budget charge at 699¢/hr is
about 1.3x that. Cold starts matter most with few users: boot plus reading the job's weights is about 2.5-3.5 min
of H100 time, roughly 25-30¢ of real cost before the clip itself. Replace these estimates with measured numbers
after the first runs.

Estimates for an A100 80GB (one Wan 14B pass over 81 frames: about 11 s at 480p, 40 s at 720p; not yet measured
on RunPod). "Warm" is a worker with the models loaded; "cold" adds the worker boot (90 s) and reading the job's
weights from the volume (60-120 s). Charged = what the daily budget is charged at 539¢/hr; A100 real = what
RunPod bills at 272¢/hr (an H100 run is about half the time at 539¢/hr, so it costs about the same).

| Job | Warm GPU time | Cold | Timeout | Charged warm / cold | Reserved | A100 real warm / cold |
| --- | --- | --- | --- | --- | --- | --- |
| animate quick 480p (4 steps) | ~64 s | ~4.6 min | 240 s | 11¢ / 49¢ | 57¢ | 6¢ / 25¢ |
| animate quick 720p (4 steps) | ~3.4 min | ~6.9 min | 450 s | 32¢ / 70¢ | 89¢ | 16¢ / 36¢ |
| animate best 480p (20 steps) | ~6.9 min | ~10.4 min | 750 s | 64¢ / $1.02 | $1.34 | 32¢ / 52¢ |
| animate best 720p (20 steps) | ~25 min | ~28 min | 2370 s | $2.24 / $2.62 | $3.76 | $1.13 / $1.32 |
| motion, 10 s clip (10 steps) | ~8.2 min | ~11.7 min | 870 s | 75¢ / $1.13 | $1.52 | 38¢ / 57¢ |
| lipsync quick, 10 s | ~3.1 min | ~6.1 min | 390 s | 29¢ / 63¢ | 80¢ | 15¢ / 32¢ |
| lipsync best, 10 s (20 steps) | ~24 min | ~27 min | 2250 s | $2.16 / $2.50 | $3.58 | $1.09 / $1.26 |
| upscale_video, 10 s to 1080p | ~4.8 min | ~7.3 min | 510 s | 45¢ / 74¢ | 98¢ | 23¢ / 38¢ |
| music, 30 s | ~18 s | ~1.8 min | 120 s | 4¢ / 24¢ | 39¢ | 2¢ / 12¢ |
| upscale image | ~15 s | ~1.8 min | 150 s | 3¢ / 24¢ | 44¢ | 2¢ / 12¢ |
| MOSS (48 GB, measured 77.6-81.9 s) | ~85 s | | | ~4¢ | 50¢ | |

Shorter clips cost less (motion and lipsync scale with length; the reservation assumes 10 s). With $5 a day the
budget allows, for example, about 45 warm animate quick 480p clips, or two Best 720p clips. Best 720p and lipsync
Best reserve $3.58-3.76, so they can only start while most of the day's budget is unreserved.

## Handler environment

`COMFY_DIR` (/opt/ComfyUI), `COMFY_HOST` (127.0.0.1:8188), `COMFY_START` (1), `COMFY_CMD`, `COMFY_ARGS`,
`COMFY_STARTUP_TIMEOUT` (180), `MASSLESS_IMAGE` (main or lab), `MASSLESS_VOLUME` (/runpod-volume/massless; `off`
for the Lab image), `MASSLESS_MANIFEST`, `MASSLESS_MODEL_WAIT` (0), `MASSLESS_DOWNLOADER` (auto: aria2c when
installed, else Python), `MASSLESS_LOCK_STALE` (300 s), `MASSLESS_LOCK_HEARTBEAT` (10 s), `HF_TOKEN` (optional,
for Hugging Face rate limits), `MASSLESS_WORKFLOWS`, `MASSLESS_TIMEOUT_SCALE` (1), `MASSLESS_MAX_RESULT_MB` (15),
`MASSLESS_RIG`, `FFMPEG`, `FFPROBE`. None are secrets; the endpoint needs none set.

## Lab endpoint

Unchanged: weights baked into `Dockerfile.lab` (40 GB), a 24 GB GPU (`AMPERE_24`, set `LAB_CENTS_PER_HOUR=76`),
max workers 1, idle 5 s, FlashBoot, execution timeout 600 s, no volume. Off unless `LAB_ENABLED=true`.

## Tests

`python3 tests/gpu_handler_test.py`: workflows checked against the pinned ComfyUI and custom-node sources (ast),
including the graphs the handler builds (Best mode without LoRAs, S2V chunks); manifests and Dockerfiles; every
URL by HEAD (size and SHA-256); the volume bootstrap against a fake Hugging Face server (fresh fill, second boot
without hashing, resume with Range, server ignoring Range, dropped connection, hash mismatch, oversize download,
two workers on one file, live and stale locks, full volume, aria2c path, extra_model_paths.yaml); and the handler
end to end against a fake ComfyUI for every job type (clips, speech and muxing for real with ffmpeg).
`npm test` and `npm run test:runtime` cover the ledger (timeouts are checked against `tests/fixtures/gpu_timeouts.json`,
which the handler test checks too). `GPU_TEST_OFFLINE=1` skips network checks.
