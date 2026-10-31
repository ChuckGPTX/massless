# syntax=docker/dockerfile:1
# Massless GPU worker, main endpoint: animate (Wan 2.2 TI2V-5B), music (ACE-Step 1.5), upscale (Real-ESRGAN).
# Only open weights whose licenses allow commercial use (see workers/gpu/models.json and workers/gpu/README.md).
# Our files are MIT; ComfyUI (GPL-3.0) is fetched at its pinned commit and installed unmodified.
#
# Build context is the repository root (RunPod: Dockerfile path workers/gpu/Dockerfile, build context .):
#   docker build -f workers/gpu/Dockerfile -t massless-gpu .
#   docker build -f workers/gpu/Dockerfile --build-arg MASSLESS_SKIP_MODELS=1 -t massless-gpu:noweights .   # no 38 GB download
#
# Layer order: base -> model weights (one layer per file) -> Python -> ComfyUI -> our code. Editing the
# handler, the workflows or the Python pins never re-downloads a model.

# CUDA 12.6 runtime on Ubuntu 24.04 (Python 3.12). Same amd64 image as docker.io/nvidia/cuda:12.6.3-runtime-ubuntu24.04,
# pulled from NVIDIA's public registry, which has no anonymous pull limit.
ARG BASE_IMAGE=nvcr.io/nvidia/cuda:12.6.3-runtime-ubuntu24.04@sha256:2c8193530ecc423e0f123d0c85b68a15d1395adcddabfc943e2523dbfde172e1
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates curl aria2 git \
 && rm -rf /var/lib/apt/lists/*

# ---- model weights: values copied from workers/gpu/models.json (tests/gpu_handler_test.py checks they match) ----
COPY workers/gpu/fetch_model.py /opt/massless/fetch_model.py
ARG MASSLESS_SKIP_MODELS=0

# Real-ESRGAN x4plus [BSD-3-Clause], 0.07 GB
RUN python3 /opt/massless/fetch_model.py \
    https://huggingface.co/Comfy-Org/Real-ESRGAN/resolve/5fd49b7b278836f48af63ecd314d0f98ab336105/RealESRGAN_x4plus.safetensors \
    37f9a931c215f040aa6d50f711f2cb115f713c46df1d0d6469a8bd7bfe9a60bb 66857836 /models/upscale_models/RealESRGAN_x4plus.safetensors

# Wan 2.2 VAE [Apache-2.0], 1.41 GB
RUN python3 /opt/massless/fetch_model.py \
    https://huggingface.co/Comfy-Org/Wan-2.2/resolve/ee6f4a40737a995bf5818954cfce6d59443b0f04/split_files/vae/wan2.2_vae.safetensors \
    e40321bd36b9709991dae2530eb4ac303dd168276980d3e9bc4b6e2b75fed156 1409400960 /models/vae/wan2.2_vae.safetensors

# umT5-XXL text encoder, fp8 [Apache-2.0], 6.74 GB
RUN python3 /opt/massless/fetch_model.py \
    https://huggingface.co/Comfy-Org/Wan-2.1/resolve/123acf1cc74bccbb9bfff8ac1ee72edc08c2341d/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors \
    c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68 6735906897 /models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors

# Wan 2.2 TI2V-5B, fp16 [Apache-2.0], 10.00 GB
RUN python3 /opt/massless/fetch_model.py \
    https://huggingface.co/Comfy-Org/Wan-2.2/resolve/ee6f4a40737a995bf5818954cfce6d59443b0f04/split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors \
    456f901338bd9eadbded3828b819109a9b68e8a525ca5cf8d0049a69fcfeca1e 9999658848 /models/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors

# ACE-Step 1.5 audio VAE [MIT], 0.34 GB
RUN python3 /opt/massless/fetch_model.py \
    https://huggingface.co/Comfy-Org/ACE-Step-1.5/resolve/371bb1680f8c88d8c1083f6ffb6330d3d55bff76/split_files/vae/ace_1.5_vae.safetensors \
    6de92e3a862acd287e08b024ac90f0783a8635451b728721a33ff03565bcb2bb 337431732 /models/vae/ace_1.5_vae.safetensors

# ACE-Step 1.5 text encoder, Qwen3-0.6B [MIT], 1.19 GB
RUN python3 /opt/massless/fetch_model.py \
    https://huggingface.co/Comfy-Org/ACE-Step-1.5/resolve/371bb1680f8c88d8c1083f6ffb6330d3d55bff76/split_files/text_encoders/qwen_0.6b_ace15.safetensors \
    fd4590c82153b8ddb67e15a2e7aaa8afa8b83a858c8a9b82a4831063156aa7a7 1191588248 /models/text_encoders/qwen_0.6b_ace15.safetensors

# ACE-Step 1.5 turbo DiT [MIT], 4.79 GB
RUN python3 /opt/massless/fetch_model.py \
    https://huggingface.co/Comfy-Org/ACE-Step-1.5/resolve/371bb1680f8c88d8c1083f6ffb6330d3d55bff76/split_files/diffusion_models/acestep_v1.5_turbo.safetensors \
    3f6e0797fad420a39bd33979eb6e840e30989e34a3794e843d23b60ec6e422d7 4787825604 /models/diffusion_models/acestep_v1.5_turbo.safetensors

# ACE-Step 1.5 planner LM, Qwen3-1.7B base [MIT], 3.71 GB
RUN python3 /opt/massless/fetch_model.py \
    https://huggingface.co/Comfy-Org/ACE-Step-1.5/resolve/371bb1680f8c88d8c1083f6ffb6330d3d55bff76/split_files/text_encoders/qwen_1.7b_ace15.safetensors \
    ed63e9247d1f55f3ace04fa11e95b085fc82d459c82c5626f0b2e37b91ebd710 3708523360 /models/text_encoders/qwen_1.7b_ace15.safetensors

# FastWan 2.2 TI2V-5B, 3-step distill, bf16 [Apache-2.0], 10.00 GB (diffusers layout, renamed for ComfyUI in place)
RUN python3 /opt/massless/fetch_model.py \
    https://huggingface.co/FastVideo/FastWan2.2-TI2V-5B-FullAttn-Diffusers/resolve/3e187042a324f6f5fb68fd22110a78725253de8f/transformer/diffusion_pytorch_model.safetensors \
    a1cf4acd5d0242ca0cad68e115064f4ac7e748686c9cf0da050ce87decc6b9bf 9999660080 /models/diffusion_models/fastwan2.2_ti2v_5B_bf16.safetensors --convert diffusers-wan

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
 && rm -rf .git models \
 && mkdir -p /models input output temp user \
 && ln -s /models models

# ---- our code (MIT) ----
COPY workers/gpu/handler.py /opt/massless/handler.py
COPY workers/gpu/workflows /opt/massless/workflows
COPY workers/gpu/models.json workers/gpu/LICENSE /opt/massless/
ENV COMFY_DIR=/opt/ComfyUI \
    MASSLESS_IMAGE=main
RUN python -m py_compile /opt/massless/handler.py \
 && echo "---- image size estimate ----" \
 && du -sh /models /opt/venv /opt/ComfyUI 2>/dev/null; \
    python3 /opt/massless/fetch_model.py --summary /opt/massless/models.json

WORKDIR /opt/massless
CMD ["python", "-u", "/opt/massless/handler.py"]
