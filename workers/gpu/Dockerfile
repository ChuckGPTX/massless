# syntax=docker/dockerfile:1
# Massless GPU worker, main endpoint (80 GB GPU): animate (Wan 2.2 A14B), motion (Wan-Animate-2), lipsync (Wan 2.2 S2V),
# upscale_video (SeedVR2 7B), music (ACE-Step 1.5), upscale (Real-ESRGAN).
# No weights in the image: they live on a RunPod network volume and the handler fetches any that are missing from
# their pinned Hugging Face commits on worker start (workers/gpu/volume.py, workers/gpu/models.json). Only open
# weights whose licenses allow commercial use. Our files are MIT; ComfyUI (GPL-3.0) is fetched at its pinned commit
# and installed unmodified.
#
# Build context is the repository root (RunPod: Dockerfile path workers/gpu/Dockerfile, build context .):
#   docker build -f workers/gpu/Dockerfile -t massless-gpu .
# The build downloads about 3 GB of Python wheels and no models; it takes 5-10 minutes on a fresh builder.
#
# Layer order: base -> apt -> Python -> ComfyUI -> our code. Editing the handler or the workflows rebuilds only the last layer.

# CUDA 12.6 runtime on Ubuntu 24.04 (Python 3.12). Same amd64 image as docker.io/nvidia/cuda:12.6.3-runtime-ubuntu24.04,
# pulled from NVIDIA's public registry, which has no anonymous pull limit.
ARG BASE_IMAGE=nvcr.io/nvidia/cuda:12.6.3-runtime-ubuntu24.04@sha256:2c8193530ecc423e0f123d0c85b68a15d1395adcddabfc943e2523dbfde172e1
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ffmpeg: driving clips, speech and clips to upscale are prepared on the CPU; aria2: fast first fill of the volume
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates curl aria2 git ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# ---- Python: torch 2.14.1+cu126 and everything else pinned in workers/gpu/requirements.txt ----
COPY workers/gpu/requirements.txt /opt/massless/requirements.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install -r /opt/massless/requirements.txt \
 && /opt/venv/bin/python -c "import torch, torchvision, av, runpod, websocket; print('torch', torch.__version__, 'cuda', torch.version.cuda)"
ENV PATH=/opt/venv/bin:$PATH

# ---- ComfyUI v0.42.5, installed as a dependency at its exact commit (GPL-3.0, unmodified) ----
ARG COMFYUI_COMMIT=483dae4326356b81de05d27aca3f433dd323cc25
RUN git init -q /opt/ComfyUI \
 && cd /opt/ComfyUI \
 && git fetch -q --depth 1 https://github.com/comfyanonymous/ComfyUI.git ${COMFYUI_COMMIT} \
 && git checkout -q FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "${COMFYUI_COMMIT}" \
 && rm -rf .git \
 && mkdir -p input output temp user

# ---- our code (MIT) ----
COPY workers/gpu/handler.py workers/gpu/volume.py /opt/massless/
COPY workers/gpu/workflows /opt/massless/workflows
COPY workers/gpu/models.json workers/gpu/LICENSE /opt/massless/
ENV COMFY_DIR=/opt/ComfyUI \
    MASSLESS_IMAGE=main \
    MASSLESS_VOLUME=/runpod-volume/massless
RUN python -m py_compile /opt/massless/handler.py /opt/massless/volume.py \
 && python -c "import json; m = json.load(open('/opt/massless/models.json')); print('volume needs', round(sum(e['size'] for e in m['models']) / 1e9, 1), 'GB in', len(m['models']), 'files')" \
 && du -sh /opt/venv /opt/ComfyUI

WORKDIR /opt/massless
CMD ["python", "-u", "/opt/massless/handler.py"]
