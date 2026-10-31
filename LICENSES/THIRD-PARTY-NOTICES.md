# Third-party notices: image tools

The Edit page's image tools (`/edit`) download these files into the visitor's browser. Each is pinned and checked against the SHA-256 in `public/js/image-models.js`. All are under permissive licenses; nothing here is GPL, AGPL or non-commercial.

| File | Project and copyright | License | Where it is served from |
| --- | --- | --- | --- |
| `public/models/realesr-general-x4v3.onnx` | Real-ESRGAN, Copyright (c) 2021 Xintao Wang. Weights `realesr-general-x4v3.pth` from release v0.2.5.0 (SHA-256 `8dc7edb9…6292`), converted to ONNX by `tools/convert_realesrgan.py` | BSD-3-Clause, full text in [Real-ESRGAN-BSD-3-Clause.txt](Real-ESRGAN-BSD-3-Clause.txt) and next to the model | This repository (redistributed) |
| `onnxruntime-web@1.30.0` `ort.webgpu.bundle.min.mjs`, `ort-wasm-simd-threaded.asyncify.wasm` | ONNX Runtime, Copyright (c) Microsoft Corporation | MIT | jsDelivr (not redistributed here) |
| `studioludens/birefnet-lite-512` `onnx/model_fp16.onnx`, `onnx/model.onnx` @ `962e67969ec6acec9c19fab76acee4f5e22e990c` | BiRefNet, Copyright (c) 2024 ZhengPeng; 512 × 512 export Copyright (c) 2026 Studio Ludens V.O.F. | MIT | Hugging Face (not redistributed here) |
| `Xenova/modnet` `onnx/model_quantized.onnx` @ `fa2fa546052fba4c08921230a26cc69a333fca12` | MODNet, ZHKKKe; ONNX conversion by Xenova | Apache-2.0 | Hugging Face (not redistributed here) |
| `andraniksargsyan/migan` `migan_pipeline_v2.onnx` @ `406830d0fa60666da0071c342ad2fbc8f30c5c64` | MI-GAN, Copyright (c) 2024 Picsart AI Research (PAIR); code and weights (`LICENSE-WEIGHTS`) | MIT | Hugging Face (not redistributed here) |

Not used: RMBG-2.0 (weights are non-commercial) and the 1024 × 1024 BiRefNet ONNX exports (they run out of memory in browsers).
