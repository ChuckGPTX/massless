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

# Third-party notices: typefaces for the design workflows

The one-click design workflows (`/workflows?make=…`, code in `public/js/make/`) draw text on canvas with these typefaces. Each is self-hosted as a Latin-subset WOFF2 from the Fontsource 5.3.0 packages, unmodified, with its licence file next to it in `public/fonts/`. All are under the SIL Open Font License 1.1.

| Family | Files in `public/fonts/` | Copyright | Licence file |
| --- | --- | --- | --- |
| Fraunces | `fraunces-latin-300-normal`, `-300-italic`, `-700-normal`, `-900-normal` | The Fraunces Project Authors | `OFL-Fraunces.txt` |
| Instrument Serif | `instrument-serif-latin-400-normal`, `-400-italic` | The Instrument Serif Project Authors | `OFL-InstrumentSerif.txt` |
| Space Grotesk | `space-grotesk-latin-400-normal`, `-700-normal` | The Space Grotesk Project Authors | `OFL-SpaceGrotesk.txt` |
| Archivo | `archivo-latin-400-normal`, `-800-normal` | The Archivo Project Authors | `OFL-Archivo.txt` |
| Archivo Black | `archivo-black-latin-400-normal` | The Archivo Black Project Authors | `OFL-ArchivoBlack.txt` |
| DM Serif Display | `dm-serif-display-latin-400-normal`, `-400-italic` | Adobe Systems Incorporated (Source), Google LLC | `OFL-DMSerifDisplay.txt` |
| IBM Plex Mono | `ibm-plex-mono-latin-400-normal`, `-500-normal` | IBM Corp. | `OFL-IBMPlexMono.txt` |
| Unbounded | `unbounded-latin-700-normal` | The Unbounded Project Authors | `OFL-Unbounded.txt` |
| Bricolage Grotesque | `bricolage-grotesque-latin-500-normal`, `-800-normal` | The Bricolage Grotesque Project Authors | `OFL-BricolageGrotesque.txt` |

Big Shoulders Display and Instrument Sans were already in the repository with their licences.

The SVG exports of the Brand identity kit embed the display face (base64 WOFF2) so the file renders anywhere; the OFL permits embedding in documents.
