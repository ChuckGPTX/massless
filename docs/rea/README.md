# REA notes: what to build next

Clean-room studies of three paid products and one technical question, written to decide what Chucksi builds next. Each study maps the product's features from public sources, lists open-source building blocks with licenses checked at the source, and designs our own version on Chucksi's architecture (browser first, Cloudflare Workers AI free tier, the RunPod GPU worker for heavy models).

| Study | One-line takeaway |
| --- | --- |
| [descript.md](descript.md) | Text-based cutting, filler and pause removal and styled captions are what people pay for, and almost all of it runs in the browser on top of our Captions transcripts. |
| [landr.md](landr.md) | AI mastering is a fixed chain with smart presets; our loudness meter and limiter are most of it already. Distribution is out of reach and not worth chasing. |
| [framer.md](framer.md) | A prompt-to-site builder works best as a typed JSON spec rendered by hand-built sections; export ZIPs first, host previews only on a separate domain. |
| [beat-detection.md](beat-detection.md) | Finish the DSP port, then add Beat This! (MIT code and weights) in the browser: about 0.89 beat F1 and 0.78 downbeat F1 on GTZAN, versus roughly 0.80 and 0.46 for the DSP family. |

Research date: 2026-10-30. Sources are linked in each study.

---

## Build order: most user value per unit of effort

| # | Build | From | Effort | Running cost | Why this rank |
| --- | --- | --- | --- | --- | --- |
| 1 | **Edit by text, audio first**: strike words to cut, fillers, repeats, pause shortening, quiet-point edge snapping, crossfades, audio export through the Extract pipeline, re-timed SRT/VTT | Descript v1 | 1-2 days | ASR only (46.6 Neurons per audio minute, already capped) | The most-loved Descript features, today behind a credit meter, for every podcaster and YouTuber. Reuses `transcribe.js` and `extract-worker.js` almost as they are. |
| 2 | **Master tab**: analysis report, three characters x four loudness destinations (Spotify -14 LUFS / -1 dBTP, podcast -16 LUFS, broadcast -23, loud), true-peak limiter, loudness-matched A/B | LANDR v1 | 1-2 days | $0 | Our BS.1770 meter, limiter and encoders are most of a mastering chain already. Small build, broad audience (musicians, podcasters, anyone exporting audio). |
| 3 | **Beats: finish the DSP port, then Beat This! small in the browser** | Beat study v1-v2 | 1 day + 1-2 days | $0 (about 8 MB model download) | Unlocks "use my song" on Film and "cut to the beat" on the storyboard; downbeats improve from a heuristic (~0.46 F class) to ~0.78 F. |
| 4 | **Video export of text edits with burned-in caption styles and 9:16 clips** | Descript v2 | 3-4 days | LLM clip picking about 280 Neurons per request | Social clips with karaoke captions are the highest-demand creator output; builds on #1 and the WebCodecs recorder. |
| 5 | **Clean voice**: RNNoise in the browser now, DeepFilterNet / Resemble Enhance as a GPU job later | Descript v2-v3 | 1 day + 1 day | $0, then about $0.002-0.013 per 10 min on the GPU | Bad laptop audio is the most common problem; the browser tier is nearly free to build. |
| 6 | **Website v1**: brief, Llama 3.3 JSON spec (template fallback), 14 hand-built section types, art from our Image tool, SEO pack, ZIP export, no hosting | Framer v1 | 2-3 days | about 650 Neurons per site | New audience and a natural hand-off to Image and Film; zero abuse exposure while we only export files. |
| 7 | **Stems GPU job (Demucs) and reference mastering** | LANDR v2 | 2-3 days | about $0.002-0.006 per song warm | Valuable, but costs GPU time, needs R2 or tight Opus encoding for payloads, and carries rights risk. |
| 8 | **Green screen in the browser** (MediaPipe Selfie Segmenter), GPU matting later | Descript v2-v3 | 1-2 days | $0 / about $0.013-0.025 per minute of video | Useful for talking heads; quality ceiling in the browser is modest. |
| 9 | **Translate captions, then stock-voice dubbing** | Descript v2-v3 | 1 day + 2-3 days | about 31 Neurons per 1k tokens to translate; MeloTTS 18.6 Neurons per audio minute | Cheap captions win early; dubbing timing is harder. |
| 10 | **Website v2-v3** (AI edits as JSON Patch, localization, GrapesJS freeform, preview links on a separate domain), **mix assistant**, **all-in-one sections** | all | 1-2 weeks | small | After the core tools are solid. |
| — | **Lab only**: consented voice clone (Chatterbox + Perth watermark), lip sync (LatentSync), eye contact (LivePortrait research) | Descript v3 | — | GPU | High abuse potential or no commercially usable open model yet. |
| — | **Not building**: music distribution, a sample store, plugins, permanent site hosting with custom domains | LANDR, Framer | — | — | Business deals, licensing or abuse load, not software. |

**Budgets these plans assume.** Workers AI gives 10,000 free Neurons a day across all endpoints ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)); every new endpoint gets its own daily and per-visitor cap behind the Turnstile pass, plus a no-model fallback. The GPU worker's 24 GB tier is $0.75/hour on RunPod serverless ([pricing](https://www.runpod.io/pricing)), so the $0.75/day budget is about 3,600 GPU-seconds a day, billed from worker start (cold start included) to stop ([billing](https://docs.runpod.io/serverless/pricing)). GPU times in the studies are estimates to be measured.

---

## Key license findings

- **Clean, strong, use them**: Beat This! (MIT code and weights), Demucs (MIT), BiRefNet (MIT), MODNet (Apache-2.0 code and models), MediaPipe Selfie Segmenter (Apache-2.0 model card), SAM 2.1 (Apache-2.0), DeepFilterNet (MIT/Apache), Resemble Enhance (MIT), ClearerVoice MossFormer2 (Apache-2.0), RNNoise (BSD-3), Silero VAD (MIT), auto-editor (public domain), GrapesJS (BSD-3), Motion (MIT), all-in-one (MIT), Chatterbox and OpenVoice V2 (MIT), CosyVoice2 and Zonos (Apache-2.0), m2m100 (MIT).
- **GPL, keep out of `public/`** (separate program in the GPU image at most): `@ffmpeg/core` and `core-mt` are **GPL-2.0-or-later** even though the ffmpeg.wasm wrapper is MIT; RobustVideoMatting, Matchering, Spotify's pedalboard, aubio and seed-vc are **GPL-3.0**.
- **AGPL, avoid**: essentia.js, whisper-timestamped, Webstudio, Silex, tempo-cnn.
- **Non-commercial weights** (Lab or nothing): madmom's models (CC BY-NC-SA 4.0, while its code is BSD), CrisperWhisper (CC-BY-NC-4.0 weights, MIT code), F5-TTS weights, XTTS-v2 (Coqui Public Model License), Meta's MMS aligner (used by some WhisperX setups), SeamlessM4T v2, MusicGen, Open-Unmix `umxl`, RMBG-2.0, Diff-MST, Adobe's DeepAFx-ST, and the InsightFace detectors bundled with LivePortrait.
- **Custom terms that block us**: Fish Audio Community License (no hosted services), bilibili's IndexTTS license, SAM 3's license (gated, use restrictions), Stability's community license for Stable Audio Open (gated), Remotion's license, and StackBlitz's WebContainer API (commercial license needed for production for-profit use, which is what bolt.diy and bolt.new run on). free-music-demixer's code is MIT but the weights on its site are proprietary.
- **Gated but permissive**: pyannote 3.1 diarization (MIT, needs an accepted HF token at build time).
- **Attribution we owe**: Imagination Studio's NOTICE asks for credit to "Keys (github.com/drowzeys)" and "Sam Wasserman / Wasserman Productions (wassermanproductions.com)" in documentation and any about/credits surface (the license and NOTICE are already in `LICENSES/`); CC-BY-4.0 (BeatNet, pyannote community-1) if ever used; MPL-2.0 (Mediabunny) files used unmodified.
- **Unverified, check before use**: VoiceFixer weights (and its LICENSE has an unfilled template line), Wav2Lip (no LICENSE file found), MuseTalk's dependency models, MediaPipe face detector/landmarker cards, Llama Guard's license, community RoFormer separation checkpoints, the license tags missing on some `onnx-community` exports (export our own from the permissive upstream).

---

## Every repo and model evaluated

Verdicts: **Use** = load or bundle in the MIT site; **Service** = run only as a separate process (GPU worker or Workers AI); **Research** = learn from it, Lab at most; **Avoid** = don't use. "Weights" is the Hugging Face model card's license field (or the repo's statement) as read on 2026-10-30.

### Speech, transcription, editing (Descript study)

| Repo / model | Code | Weights | Verdict |
| --- | --- | --- | --- |
| [openai/whisper](https://github.com/openai/whisper), `openai/whisper-large-v3-turbo` | MIT | MIT | Use (Workers AI) |
| [m-bain/whisperX](https://github.com/m-bain/whisperX) | BSD-2-Clause | alignment models vary | Service |
| `facebook/wav2vec2-base-960h`, `jonatasgrosman/wav2vec2-large-xlsr-53-english` | — | Apache-2.0 | Service |
| `facebook/mms-1b-all`, `facebook/mms-300m` | — | CC-BY-NC-4.0 | Avoid |
| [jianfch/stable-ts](https://github.com/jianfch/stable-ts) | MIT | — | Service / port ideas |
| [linto-ai/whisper-timestamped](https://github.com/linto-ai/whisper-timestamped) | AGPL-3.0 | — | Avoid |
| [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper), `Systran/faster-whisper-large-v3` | MIT | MIT | Service |
| [ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp) | MIT | Whisper (MIT) | Use (offline fallback) |
| [huggingface/transformers.js](https://github.com/huggingface/transformers.js) | Apache-2.0 | — | Use (already) |
| `onnx-community/whisper-base_timestamped` | — | no tag (upstream MIT) | Use after self-export |
| [xenova/whisper-web](https://github.com/xenova/whisper-web) | MIT | — | Research |
| [nyrahealth/CrisperWhisper](https://github.com/nyrahealth/CrisperWhisper), `nyralabs/CrisperWhisper` | MIT | CC-BY-NC-4.0 | Research |
| `distil-whisper/distil-large-v3.5` | — | MIT | Service (optional) |
| [snakers4/silero-vad](https://github.com/snakers4/silero-vad), `onnx-community/silero-vad` | MIT | MIT | Use |
| [ricky0123/vad](https://github.com/ricky0123/vad) | ISC | — | Use |
| [WyattBlue/auto-editor](https://github.com/WyattBlue/auto-editor) | Unlicense | — | Use / port |
| [pyannote/pyannote-audio](https://github.com/pyannote/pyannote-audio), `speaker-diarization-3.1`, `segmentation-3.0` | MIT | MIT (gated) | Service |
| `pyannote/speaker-diarization-community-1` | — | CC-BY-4.0 (gated) | Service (attribution) |
| [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Apache-2.0 | per model | Use (optional) |
| [xiph/rnnoise](https://github.com/xiph/rnnoise) | BSD-3-Clause | bundled | Use |
| [jitsi/rnnoise-wasm](https://github.com/jitsi/rnnoise-wasm) | Apache-2.0 | — | Use |
| [sapphi-red/web-noise-suppressor](https://github.com/sapphi-red/web-noise-suppressor) | MIT | — | Use |
| [Rikorose/DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) | MIT or Apache-2.0 | same repo | Service (browser later) |
| [resemble-ai/resemble-enhance](https://github.com/resemble-ai/resemble-enhance), `ResembleAI/resemble-enhance` | MIT | MIT | Service |
| [modelscope/ClearerVoice-Studio](https://github.com/modelscope/ClearerVoice-Studio), `alibabasglab/MossFormer2_SE_48K` | Apache-2.0 | Apache-2.0 | Service |
| [haoheliu/voicefixer](https://github.com/haoheliu/voicefixer) | MIT (template line unfilled) | not stated | Research |
| [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe), Selfie Segmenter | Apache-2.0 | Apache-2.0 (model card) | Use |
| [ZHKKKe/MODNet](https://github.com/ZHKKKe/MODNet), `Xenova/modnet` | Apache-2.0 | Apache-2.0 | Use |
| [ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet), `BiRefNet`, `BiRefNet_lite`, `onnx-community/BiRefNet_lite-ONNX` | MIT | MIT | Use / Service (video) |
| `studioludens/birefnet-lite-512` (512 × 512 export of BiRefNet_lite; the 1024 exports run out of memory in browsers) | — | MIT (LICENSE in repo) | Use (Edit page) |
| [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN), `realesr-general-x4v3.pth` (v0.2.5.0) | BSD-3-Clause | BSD-3-Clause (release asset) | Use (Edit page, converted to ONNX and served by us) |
| [mv-lab/swin2sr](https://github.com/mv-lab/swin2sr), `caidas/swin2SR-*`, `Xenova/swin2SR-*` | Apache-2.0 | Apache-2.0 | Use (not chosen: the x4 model was about 18× slower per pixel than Real-ESRGAN x4v3 on WebAssembly in our test) |
| [Picsart-AI-Research/MI-GAN](https://github.com/Picsart-AI-Research/MI-GAN), `andraniksargsyan/migan` | MIT | MIT (`LICENSE-WEIGHTS`) | Use (Edit page) |
| [advimman/lama](https://github.com/advimman/lama), `Carve/LaMa-ONNX` | Apache-2.0 | Apache-2.0 | Use (208 MB fixed 512 × 512 ONNX: too big for the browser tool) |
| [facebookresearch/segment-anything](https://github.com/facebookresearch/segment-anything) | Apache-2.0 | Apache-2.0 | Use / Service |
| [facebookresearch/sam2](https://github.com/facebookresearch/sam2), `facebook/sam2.1-hiera-tiny` | Apache-2.0 | Apache-2.0 | Use / Service |
| `Xenova/slimsam-77-uniform` | — | Apache-2.0 | Use |
| [facebookresearch/sam3](https://github.com/facebookresearch/sam3), `facebook/sam3` | SAM License (custom) | gated, custom | Avoid |
| [PeterL1n/RobustVideoMatting](https://github.com/PeterL1n/RobustVideoMatting) | GPL-3.0 | release files | Service only |
| `briaai/RMBG-2.0` | — | CC BY-NC 4.0 | Avoid |
| `briaai/RMBG-1.4` | — | Bria custom | Avoid |
| [hexgrad/kokoro](https://github.com/hexgrad/kokoro), `hexgrad/Kokoro-82M` | Apache-2.0 | Apache-2.0 | Use (already) |
| [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox), `ResembleAI/chatterbox`, `chatterbox-turbo` | MIT | MIT | Service (Lab, consent-gated) |
| [resemble-ai/Perth](https://github.com/resemble-ai/Perth) | MIT | — | Use with any cloned output |
| [myshell-ai/OpenVoice](https://github.com/myshell-ai/OpenVoice), `OpenVoiceV2` | MIT | MIT | Service (consent-gated) |
| [FunAudioLLM/CosyVoice](https://github.com/FunAudioLLM/CosyVoice), `CosyVoice2-0.5B` | Apache-2.0 | Apache-2.0 | Service |
| [Zyphra/Zonos](https://github.com/Zyphra/Zonos), `Zonos-v0.1-transformer` | Apache-2.0 | Apache-2.0 | Service |
| [nari-labs/dia](https://github.com/nari-labs/dia), `Dia-1.6B` | Apache-2.0 | Apache-2.0 | Service (optional) |
| [SWivid/F5-TTS](https://github.com/SWivid/F5-TTS) | MIT | CC-BY-NC-4.0 | Research |
| [coqui-ai/TTS](https://github.com/coqui-ai/TTS), `coqui/XTTS-v2` | MPL-2.0 | Coqui Public Model License (NC) | Avoid |
| [fishaudio/fish-speech](https://github.com/fishaudio/fish-speech) | Fish Audio Community License | same | Avoid |
| [index-tts/index-tts](https://github.com/index-tts/index-tts) | bilibili Model Use License | — | Avoid |
| [microsoft/VibeVoice](https://github.com/microsoft/VibeVoice) | MIT | not checked | Research |
| [boson-ai/higgs-audio](https://github.com/boson-ai/higgs-audio) | Apache-2.0 | not checked | Research |
| [canopyai/Orpheus-TTS](https://github.com/canopyai/Orpheus-TTS) | Apache-2.0 | not checked | Research |
| [Plachtaa/seed-vc](https://github.com/Plachtaa/seed-vc) | GPL-3.0 | — | Avoid |
| [RVC-Project/Retrieval-based-Voice-Conversion-WebUI](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI) | MIT | — | Avoid (policy) |
| `facebook/m2m100_1.2B` (Workers AI `m2m100-1.2b`) | — | MIT | Use |
| `facebook/seamless-m4t-v2-large` | — | CC-BY-NC-4.0 | Avoid |
| `meta-llama/Llama-3.3-70B-Instruct` (Workers AI) | — | Llama 3.3 Community License | Use (already) |
| `openai/gpt-oss-120b` (Workers AI) | — | Apache-2.0 | Use |
| [bytedance/LatentSync](https://github.com/bytedance/LatentSync), `ByteDance/LatentSync-1.5` | Apache-2.0 | OpenRAIL++ | Service (Lab) |
| [TMElyralab/MuseTalk](https://github.com/TMElyralab/MuseTalk), `TMElyralab/MuseTalk` | MIT | MIT (+ dependencies) | Research |
| Rudrabha/Wav2Lip | no LICENSE found | — | Avoid |
| [KwaiVGI/LivePortrait](https://github.com/KwaiVGI/LivePortrait), `KlingTeam/LivePortrait` | MIT | MIT; bundled InsightFace detectors non-commercial | Research |
| [Vanilagy/mp4-muxer](https://github.com/Vanilagy/mp4-muxer) | MIT | — | Use (already) |
| [Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny) | MPL-2.0 | — | Use (unmodified) |
| [gpac/mp4box.js](https://github.com/gpac/mp4box.js) | BSD-3-Clause | — | Use |
| [ffmpegwasm/ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) | MIT wrapper; `@ffmpeg/core`, `core-mt` GPL-2.0-or-later | — | Avoid the core |
| [ffmpegwasm/ffmpeg.wasm-core](https://github.com/ffmpegwasm/ffmpeg.wasm-core) | FFmpeg: mostly LGPL-2.1+ | — | Research (LGPL self-build possible) |
| [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) | MIT | — | Use |
| [remotion-dev/remotion](https://github.com/remotion-dev/remotion) | Remotion License | — | Avoid |
| [diffusionstudio/core](https://github.com/diffusionstudio/core) | MPL-2.0 | — | Research |
| [Breakthrough/PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | BSD-3-Clause | — | Research |

### Mastering, mixing, stems, music (LANDR study)

| Repo / model | Code | Weights | Verdict |
| --- | --- | --- | --- |
| [sergree/matchering](https://github.com/sergree/matchering) | GPL-3.0 | — | Service only (or our own clean-room technique) |
| [csteinmetz1/pyloudnorm](https://github.com/csteinmetz1/pyloudnorm) | MIT | — | Use (test oracle) |
| [spotify/pedalboard](https://github.com/spotify/pedalboard) | GPL-3.0 | — | Service only |
| [csteinmetz1/dasp-pytorch](https://github.com/csteinmetz1/dasp-pytorch) | Apache-2.0 | — | Service (v3) |
| [csteinmetz1/automix-toolkit](https://github.com/csteinmetz1/automix-toolkit) | Apache-2.0 | research-dataset checkpoints, no license stated | Research |
| [sai-soum/Diff-MST](https://github.com/sai-soum/Diff-MST) | CC BY-NC-SA 4.0 | — | Research |
| [adobe-research/DeepAFx-ST](https://github.com/adobe-research/DeepAFx-ST) | Adobe Research License (NC) | — | Avoid |
| [facebookresearch/demucs](https://github.com/facebookresearch/demucs), [adefossez/demucs](https://github.com/adefossez/demucs) | MIT | MIT (repo) | Service |
| [sevagh/demucs.onnx](https://github.com/sevagh/demucs.onnx) | MIT | Meta's | Research (browser later) |
| [sevagh/demucs.cpp](https://github.com/sevagh/demucs.cpp) | MIT | Meta's | Research |
| [sevagh/free-music-demixer](https://github.com/sevagh/free-music-demixer) | MIT | site weights proprietary | Research |
| [sigsep/open-unmix-pytorch](https://github.com/sigsep/open-unmix-pytorch) | MIT | `umxl` CC BY-NC-SA 4.0 | Avoid `umxl` |
| [deezer/spleeter](https://github.com/deezer/spleeter) | MIT | MIT | Service (fallback) |
| [lucidrains/BS-RoFormer](https://github.com/lucidrains/BS-RoFormer) | MIT | community, mixed | Research |
| [ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training) | MIT | community, mixed | Research |
| [nomadkaraoke/python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator) | MIT | wraps mixed-license models | Research |
| Anjok07/ultimatevocalremovergui | not confirmed (no LICENSE at the usual paths) | bundles mixed-license models | Avoid until confirmed |
| [ace-step/ACE-Step-1.5](https://github.com/ace-step/ACE-Step-1.5), `ACE-Step/Ace-Step1.5` | MIT | MIT | Use (already, GPU) |
| [Stability-AI/stable-audio-tools](https://github.com/Stability-AI/stable-audio-tools), `stable-audio-open-1.0`, `-small` | MIT | Stability AI Community License (gated) | Avoid |
| `facebook/musicgen-small` | — | CC-BY-NC-4.0 | Avoid |
| [Tonejs/Tone.js](https://github.com/Tonejs/Tone.js) | MIT | — | Use |

### Site builders (Framer study)

| Repo | License | Verdict |
| --- | --- | --- |
| [GrapesJS/grapesjs](https://github.com/GrapesJS/grapesjs) | BSD-3-Clause | Use (v2 freeform) |
| [puckeditor/puck](https://github.com/puckeditor/puck) | MIT (React) | Research |
| [prevwong/craft.js](https://github.com/prevwong/craft.js) | MIT (React) | Research |
| [onlook-dev/onlook](https://github.com/onlook-dev/onlook) | Apache-2.0 | Research |
| [webstudio-is/webstudio](https://github.com/webstudio-is/webstudio) | AGPL-3.0 | Avoid |
| [silexlabs/Silex](https://github.com/silexlabs/Silex) | AGPL-3.0 | Avoid |
| [wandb/openui](https://github.com/wandb/openui) | Apache-2.0 | Research |
| [stackblitz-labs/bolt.diy](https://github.com/stackblitz-labs/bolt.diy) | MIT, but needs the WebContainer API (commercial license for production) | Avoid in production |
| [stackblitz/bolt.new](https://github.com/stackblitz/bolt.new) | MIT, same WebContainer caveat | Research |
| [stackblitz/webcontainer-core](https://github.com/stackblitz/webcontainer-core) | MIT (repo only; the API has its own terms) | Avoid |
| [BuilderIO/mitosis](https://github.com/BuilderIO/mitosis) | MIT | Research |
| [plasmicapp/plasmic](https://github.com/plasmicapp/plasmic) | MIT | Research |
| [motiondivision/motion](https://github.com/motiondivision/motion) | MIT | Use (exported sites) |
| [withastro/astro](https://github.com/withastro/astro) | MIT | Use (optional export) |
| [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) | MIT | Optional |
| [decaporg/decap-cms](https://github.com/decaporg/decap-cms) | MIT | Use (v3 export) |
| [tinacms/tinacms](https://github.com/tinacms/tinacms) | Apache-2.0 | Research |
| [cure53/DOMPurify](https://github.com/cure53/DOMPurify) | Apache-2.0 or MPL-2.0 | Use |
| [101arrowz/fflate](https://github.com/101arrowz/fflate) | MIT | Use (already) |
| `@cf/meta/llama-guard-3-8b` (Workers AI) | Llama license (not re-checked) | Service (moderation) |

### Beat tracking (beat study)

| Repo / model | Code | Weights | Verdict |
| --- | --- | --- | --- |
| Imagination Studio `app/beats.py` ([repo](https://github.com/drowzeys/Imagination-Studio-by-keys-Wasserman)) | Apache-2.0 + NOTICE credits | — | Use (JS port) |
| [librosa/librosa](https://github.com/librosa/librosa) | ISC | — | Use (tests) |
| [CPJKU/beat_this](https://github.com/CPJKU/beat_this) | MIT | MIT (README) | Use |
| `tuneperfect/beat-this-onnx`, `musetric/beat-this-onnx`, `aaatmy/beat-this-onnx` | — | MIT | Use (or self-export `small0`) |
| [mjhydri/BeatNet](https://github.com/mjhydri/BeatNet) | CC-BY-4.0 | CC-BY-4.0 | Research |
| [CPJKU/madmom](https://github.com/CPJKU/madmom) | BSD-style | CC BY-NC-SA 4.0 | Avoid models |
| [mir-aidj/all-in-one](https://github.com/mir-aidj/all-in-one), `taejunkim/allinone` | MIT | MIT | Service (v3) |
| [MTG/essentia.js](https://github.com/MTG/essentia.js) | AGPL-3.0 | — | Avoid |
| [aubio/aubio](https://github.com/aubio/aubio) | GPL-3.0 | — | Avoid |
| [hendriks73/tempo-cnn](https://github.com/hendriks73/tempo-cnn) | AGPL-3.0 | — | Avoid |
| [chrisguttandin/web-audio-beat-detector](https://github.com/chrisguttandin/web-audio-beat-detector) | MIT | — | Research |
| [meyda/meyda](https://github.com/meyda/meyda) | MIT | — | Research |
| [craffel/mir_eval](https://github.com/craffel/mir_eval) | MIT | — | Use (tests) |
| [SonyCSLParis/pesto](https://github.com/SonyCSLParis/pesto) (pitch, checked in passing) | LGPL-3.0 | — | Research |

---

## How these notes were made

- Product behavior: public help centers (Descript and Framer publish Markdown copies of their pages), launch coverage, hands-on reviews and platform docs. LANDR's help center refused automated reads, so its section leans on press and reviews.
- Licenses: each repo's LICENSE file fetched from `raw.githubusercontent.com`; weights from `huggingface.co/api/models/<id>` (`cardData.license`, gating) plus README statements where the card was silent; the MediaPipe card from its PDF.
- Third-party code was read only, never executed. Nothing in these notes copies product text, code or assets; feature names in our designs are our own.
