# Descript, reverse-engineered for Massless

Clean-room notes: everything below about Descript comes from its public help center (help.descript.com, which publishes Markdown copies of every article), third-party reviews and press. No Descript code, binaries, UI assets or text were copied. Feature names in our design are our own; we do not reuse "Studio Sound", "Overdub", "Underlord" or "Regenerate".

Research date: 2026-10-30.

---

## 1. Feature map

Value column: how much the feature matters to users, judged from review coverage and from how central the help center makes it. **H** = the reason people pay; **M** = commonly used; **L** = niche.

| Feature | What users see | How it appears to work (inferred from public behavior) | Value | Sources |
| --- | --- | --- | --- | --- |
| **Edit media by editing the transcript** | Delete or cut/paste words and the audio/video follows. Non-destructive: removed media can be restored. Three ways to drop text: *Delete* (gone from media and transcript), *Ignore* (strikethrough, kept visible, not played), *Remove from transcript* (text hidden, media kept). A "wordbar" adjusts individual word start/end times. Inline notes in parentheses are not aligned to media. | Word-level forced alignment ties each word to a time span. The composition is an edit decision list over source media; the script is a view of it. Delete/ignore mark spans; playback and export skip them. | **H** | [Edit like a doc](https://help.descript.com/getting-started/edit-like-a-doc.md), [Delete vs ignore](https://help.descript.com/script-editing/delete-vs-ignore.md) |
| **Filler words** | English only. Fillers ("um", "uh", "you know") are underlined; a review sidebar lists each with timestamp and preview; per instance: delete, delete and leave a gap clip, ignore, or remove from transcript only. An "avoid harsh cuts" option skips fillers that cannot be cut cleanly. Metered in AI credits (capped per file). | A verbatim ASR pass that keeps disfluencies, plus a lexical classifier. "Avoid harsh cuts" runs a quick audio check at the boundaries (if a filler is glued to the next word, skip it). | **H** | [Filler words](https://help.descript.com/script-editing/filler-words.md), [Media minutes and AI credits](https://help.descript.com/billing-payments-plans/track-and-understand-your-media-minutes-and-ai-credits.md) |
| **Shorten word gaps** | Find gaps "more than X" or "between X and Y" ms and set them to a target (for example 200 ms); shorten one or all; also a manual "edit word gap" at the cursor (Cmd+G). | Gap = next word start minus previous word end, straight from alignment. Shortening trims the middle of the silence. | **H** | [Shorten word gaps](https://help.descript.com/script-editing/shorten-word-gaps.md), [Edit word gaps](https://help.descript.com/script-editing/word-gaps.md) |
| **Automatic microfades** | No clicks at edit points. | Tiny fades (about five samples, per the help page) at every cut boundary, not exported to timeline/XML exports. | M (invisible but essential) | [Automatic microfades](https://help.descript.com/timeline/automatic-microfades.md) |
| **Edit for clarity** | One button with a Low/Medium/Heavy intensity: removes rambling, repeats, off-topic parts; removals show as ignored text; optional "reword for flow" with an AI voice. Review, accept, discard, or copy to a new composition. | An LLM reads the aligned transcript and returns spans to drop (and optionally rewritten sentences); the app applies them as "ignore" marks so they are reviewable. | M | [Edit for Clarity](https://help.descript.com/script-editing/edit-for-clarity.md) |
| **Regenerate / change what was said** | Heal jump cuts, smooth pacing, or replace words in a speaker's voice (English only); video regeneration asks for consent first. | Speech synthesis in a consented voice clone stitched into the edit; video re-render of the mouth/face around the edit. | M | [Regenerate overview](https://help.descript.com/script-editing/regenerate-overview.md) |
| **Studio Sound** | A toggle with an intensity slider that removes noise and room echo from speech; applied per file; cloud only; very loud noise can make speech vanish (lower the intensity). | A speech enhancement / regeneration model run server-side; "intensity" behaves like a wet/dry mix. | **H** | [Studio Sound](https://help.descript.com/effects-animations-transitions/studio-sound.md) |
| **AI voice clone ("AI Speaker", successor of Overdub)** | Record a consent statement in your own voice (read in English); clone ready in minutes; no clones of deceased, non-consenting, or AI voices; a third party may send a recording of the consent statement. Voice models listed include ElevenLabs versions. | Zero-shot or few-shot voice cloning from the consent recording itself, gated by a fixed consent script. | M (also the main abuse vector) | [Create a custom voice clone](https://help.descript.com/ai-speech/custom-speaker.md), [AI speech](https://help.descript.com/ai-speech/tts.md) |
| **Eye Contact** | Redirects gaze to the lens; one clear face only; skips segments with head turns; needs constant frame rate; cloud only. | Per-frame face/eye landmarking plus a gaze-redirection generator, applied where confidence is high. | L-M | [Eye Contact](https://help.descript.com/effects-animations-transitions/eye-contact.md) |
| **Green Screen** | Removes the background of a video without a real green screen; toggle without reprocessing; separate chroma key for real green screens. | Video matting model run once in the cloud, alpha cached so the toggle is free. | M | [Green Screen](https://help.descript.com/effects-animations-transitions/green-screen.md) |
| **Scenes, layers, layouts, multitrack** | Scenes control what is on screen when; layout packs; multi-track sequences; Automatic Multicam picks the active speaker's camera and adds cutaways every 10 s or 30 s. | Per-speaker voice activity from each track's audio drives camera switching; layouts are templates applied per scene. | M (podcast video) | [Scenes](https://help.descript.com/getting-started/scenes.md), [Automatic Multicam](https://help.descript.com/visuals/automatic-multicam.md) |
| **Styled captions** | Presets; font, colors, stroke; separate styling for the *active word* and *future words*; per-word/line animations; one captions layer per speaker; SRT/VTT export. | Captions are rendered from the same word timings as the script, so editing the script edits the captions. | **H** | [Captions](https://help.descript.com/visuals/captions.md), [Subtitles export](https://help.descript.com/export-and-share/subtitles.md) |
| **Translate, dub, lip sync** | Translate captions; dub into about 30 languages with stock voices, each speaker mapped to a voice; optional lip sync for single-speaker, front-facing footage; each output is a new composition. | MT over the transcript, TTS per translated segment fitted to the original timing, then a lip-sync video model. | M | [Dub speech](https://help.descript.com/repurpose/dubbing.md), [Lip sync](https://help.descript.com/repurpose/lip-sync.md) |
| **Create clips** | 1 to 20 clips of 10 s to 5 min, optional 9:16 or 1:1 layout, optional topic; each clip is its own composition. | LLM highlight picking over the timed transcript, then reframing and captions. | **H** for social creators | [Create clips](https://help.descript.com/repurpose/create-clips-from-your-content.md) |
| **Underlord (agentic co-editor)** | A chat panel with a model picker; it can add captions, make clips, translate, apply effects, search the web; each prompt costs credits for the "agent brain" plus any tool it runs; costs are non-deterministic. | An LLM with tool calls into the editor. | M (growing) | [Underlord](https://help.descript.com/getting-started/underlord-beta-your-ai-co-editor-in-descript.md), [AI tools overview](https://help.descript.com/descript-tour/ai-tools-overview.md) |
| Recording (Rooms), publishing, share pages | Remote multi-person recording, hosted share pages, podcast host exports. | Out of scope for Massless. | — | [Help center index](https://help.descript.com/llms.txt) |

**Pricing context.** Plans meter two currencies: media minutes (upload/record) and AI credits (every AI feature, including chatting with the agent). A 2026 review lists Free (1 media hour, 100 one-time credits), Hobbyist $16-24/mo (10 h, 400 credits), Creator $24-35/mo (30 h, 800 credits), Business $50-65/mo (40 h, 1,500 credits) ([Style Factory review](https://www.stylefactoryproductions.com/?p=39448); [Descript credits page](https://help.descript.com/billing-payments-plans/track-and-understand-your-media-minutes-and-ai-credits.md)). Filler removal and the speech enhancer cost credits, so the most loved features are exactly the ones behind the meter. That is the gap Massless can fill for $0.

**What users value most** (same review, plus G2/Capterra aggregates it quotes at 4.5/5): transcript editing, one-pass filler and silence removal, the speech enhancer (no metallic artifacts), styled captions, clips for social. **Complaints:** names and jargon need manual transcript fixes; filler removal is sometimes too aggressive; cloud processing slows long projects; visual editing is weak; AI and team features are tier-locked.

---

## 2. What Massless already has to build on

| Existing piece | File | Reuse for |
| --- | --- | --- |
| Decode any audio/video to 16 kHz mono, split long files at quiet points, send parts to `/api/transcribe` | `public/js/transcribe.js` (`prepareAudio`, `planParts`, `partWav`) | The ASR step, unchanged |
| Whisper large-v3-turbo on Workers AI, VTT parsed into **word timings** attached to segments | `src/index.js` (`transcribe`), `transcribe.js` (`parseVtt`, words matched to segments) | The word list the editor works on |
| Editable transcript that keeps word timings for unchanged lines | `transcribe.js` (`readEdited`) | Starting point of the text editor |
| Streaming decoder for MP4/MOV/M4A/MP3/WAV, BS.1770 gated loudness meter, look-ahead limiter, MP3/M4A/WAV writers | `public/js/extract.js`, `public/js/extract-worker.js` | Audio export of an edited cut (with loudness levelling) |
| WebCodecs H.264 encoder + mp4-muxer (MIT) | `public/js/recorder.js` (`recordSegments`) | Video export (needs an AAC audio track added) |
| Storyboard of shots exported as one MP4 | `public/js/pages/video.js` | Destination for edited clips (new card type) |
| Kokoro (browser) and MeloTTS (6 languages, Workers AI) | `public/js/audio-engine.js` | Stock-voice dubbing and "fix a word" without cloning |
| Turnstile pass + per-feature daily caps | `src/index.js` (`allow`, `needsHuman`) | Any new LLM endpoint |
| RunPod GPU worker driving ComfyUI, job registry `JOBS` | `gpu/handler.py`, `gpu/models.json` | Heavy jobs: enhancement, alignment, matting |

Two small facts from the Workers AI docs that matter here:

- Whisper turbo's output schema includes `segments[].words[]` with `word/start/end` plus `avg_logprob` and `no_speech_prob` per segment, and the input accepts `initial_prompt`, `prefix`, `beam_size`, `condition_on_previous_text` and `hallucination_silence_threshold` ([model page](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/), [output schema](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/schema-output.json)). Today the Worker returns only `start/end/text` per segment and the page re-derives words from the VTT; passing `words` and the confidence fields through is a one-line change when we get there.
- Cost: 46.63 Neurons per audio minute, so the 10,000 free Neurons per day cover about 214 minutes of transcription if nothing else ran ([pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)).

---

## 3. Open-source building blocks (licenses verified)

"Verified" means I opened the repo's LICENSE file (raw.githubusercontent.com) and, for weights, the Hugging Face model card metadata (`huggingface.co/api/models/...`) on 2026-10-30. Verdicts:

- **Use directly**: permissive (MIT/BSD/Apache/ISC/Unlicense, or MPL used unmodified); fine to load in the MIT site.
- **Call as service**: fine to run, but only as a separate process (GPL code, gated or large GPU models). Our GPU worker image already keeps GPL ComfyUI as a separate program.
- **Research only**: non-commercial weights or unverified terms; at most the Lab endpoint, never the main site.
- **Avoid**: AGPL in the browser bundle, licenses that forbid hosted services, or no license.

### Transcription and word alignment

| Project | Code license | Weights license | Verdict | Notes |
| --- | --- | --- | --- | --- |
| [openai/whisper](https://github.com/openai/whisper) | MIT | `openai/whisper-large-v3-turbo`: MIT | Use directly (already, via Workers AI) | Tends to drop fillers; prompting with disfluent text nudges it to keep them ([OpenAI Whisper prompting guide](https://nbviewer.org/format/script/github/openai/openai-cookbook/blob/main/examples/Whisper_prompting_guide.ipynb), [HF discussion](https://huggingface.co/spaces/openai/whisper/discussions/30)). |
| [m-bain/whisperX](https://github.com/m-bain/whisperX) | BSD-2-Clause | Depends on the alignment model: `facebook/wav2vec2-base-960h` Apache-2.0, `jonatasgrosman/wav2vec2-large-xlsr-53-english` Apache-2.0; **`facebook/mms-*` CC-BY-NC-4.0** | Call as service (GPU) | Phoneme-level forced alignment gives tighter word edges than Whisper's own timestamps. Pin Apache alignment models; never the MMS aligner. Diarization pulls pyannote (gated). |
| [jianfch/stable-ts](https://github.com/jianfch/stable-ts) | MIT | uses Whisper | Call as service, or port ideas | Stabilizes timestamps with silence suppression; its idea (snap word edges to silence) is easy to do in JS. |
| [linto-ai/whisper-timestamped](https://github.com/linto-ai/whisper-timestamped) | **AGPL-3.0** | — | Avoid | |
| [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper) | MIT | `Systran/faster-whisper-large-v3`: MIT | Call as service | Fast GPU ASR for the worker. |
| [ggerganov/whisper.cpp](https://github.com/ggerganov/whisper.cpp) | MIT | Whisper (MIT) | Use directly (optional) | WASM build is an offline fallback when the free cap is hit. |
| [huggingface/transformers.js](https://github.com/huggingface/transformers.js) | Apache-2.0 | `onnx-community/whisper-base_timestamped`: no license tag on the ONNX repo (upstream Whisper is MIT) | Use directly (already used for depth) | Word timestamps in the browser via cross-attention; export our own ONNX if we need a clean license trail. |
| [nyrahealth/CrisperWhisper](https://github.com/nyrahealth/CrisperWhisper) | MIT (inference code) | **`nyralabs/CrisperWhisper`: CC-BY-NC-4.0** (README: weights under a non-commercial research license) | Research only | Verbatim ASR that keeps "um/uh" with accurate word times: exactly the filler use case, but not for the main site. |
| [distil-whisper](https://huggingface.co/distil-whisper/distil-large-v3.5) | — | MIT | Call as service (optional) | |

### Silence and voice activity

| Project | License | Verdict | Notes |
| --- | --- | --- | --- |
| [snakers4/silero-vad](https://github.com/snakers4/silero-vad) | MIT (`onnx-community/silero-vad`: MIT) | Use directly | 1-2 MB ONNX, runs in the browser. |
| [ricky0123/vad](https://github.com/ricky0123/vad) (`@ricky0123/vad-web`) | ISC | Use directly | Browser wrapper around Silero. |
| [WyattBlue/auto-editor](https://github.com/WyattBlue/auto-editor) | Unlicense (public domain; README: hosted app assets are separately proprietary) | Use directly / port | The classic "cut where loudness is under a threshold, keep a margin" algorithm; we re-implement it in JS on our own meter. |

### Speaker diarization

| Project | License | Verdict | Notes |
| --- | --- | --- | --- |
| [pyannote/pyannote-audio](https://github.com/pyannote/pyannote-audio) | MIT | Call as service | `pyannote/speaker-diarization-3.1` and `segmentation-3.0`: MIT but **gated** (accept terms with an HF token at build time). `speaker-diarization-community-1`: CC-BY-4.0, gated. |
| [k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) | Apache-2.0 | Use directly (v3, optional) | WASM builds for VAD, ASR and diarization in the browser; check each bundled model's own license. |

### Speech enhancement ("clean voice")

| Project | License | Verdict | Notes |
| --- | --- | --- | --- |
| [xiph/rnnoise](https://github.com/xiph/rnnoise) | BSD-3-Clause | Use directly | Small RNN noise suppressor, 48 kHz, real time on any CPU. |
| [jitsi/rnnoise-wasm](https://github.com/jitsi/rnnoise-wasm) | Apache-2.0 | Use directly | |
| [sapphi-red/web-noise-suppressor](https://github.com/sapphi-red/web-noise-suppressor) | MIT | Use directly | AudioWorklet wrappers for RNNoise and Speex. |
| [Rikorose/DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) | MIT or Apache-2.0 (dual) | Call as service (now); browser later | Full-band 48 kHz, real time on CPU; ships a Rust binary and ONNX models. Much better than RNNoise on music-like noise. |
| [resemble-ai/resemble-enhance](https://github.com/resemble-ai/resemble-enhance) | MIT; `ResembleAI/resemble-enhance`: MIT | Call as service (GPU) | Denoise plus generative enhancement (bandwidth extension); the closest open match to a "make it sound like a studio" button. |
| [modelscope/ClearerVoice-Studio](https://github.com/modelscope/ClearerVoice-Studio) | Apache-2.0; `alibabasglab/MossFormer2_SE_48K`: Apache-2.0 | Call as service (GPU) | Also has speech separation and target-speaker extraction. |
| [haoheliu/voicefixer](https://github.com/haoheliu/voicefixer) | MIT, but the LICENSE file still has the template's `[year] [fullname]`; checkpoint license not stated in the README | Research only until clarified | |

### Background removal and matting ("green screen")

| Project | Code | Weights | Verdict | Notes |
| --- | --- | --- | --- | --- |
| [google-ai-edge/mediapipe](https://github.com/google-ai-edge/mediapipe) Selfie Segmenter | Apache-2.0 | Apache-2.0 (model card PDF) | Use directly | 256x256 or 144x256, real time in the browser in `VIDEO` mode ([docs](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter)). |
| [ZHKKKe/MODNet](https://github.com/ZHKKKe/MODNet) | Apache-2.0 | Apache-2.0 (README covers code, models, demos); `Xenova/modnet`: Apache-2.0 | Use directly | Portrait matting with soft hair edges; Transformers.js-ready. |
| [ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | MIT | `ZhengPeng7/BiRefNet`, `BiRefNet_lite`, `onnx-community/BiRefNet_lite-ONNX`: MIT | Use directly (stills in browser), call as service (video) | State-of-the-art general background removal. |
| [facebookresearch/sam2](https://github.com/facebookresearch/sam2) | Apache-2.0 | `facebook/sam2.1-hiera-tiny`: Apache-2.0 | Use directly / service | Click-to-select subject plus video propagation. `Xenova/slimsam-77-uniform` (Apache-2.0) for clicks in the browser. |
| [facebookresearch/sam3](https://github.com/facebookresearch/sam3) | **SAM License** (custom, trade-control and use restrictions) | `facebook/sam3`: gated, manual approval | Avoid (Lab at most) | |
| [PeterL1n/RobustVideoMatting](https://github.com/PeterL1n/RobustVideoMatting) | **GPL-3.0** (re-released under GPL in 2021, per README) | ONNX files in GitHub releases | Call as service only | Best temporal stability for talking heads, but GPL: keep it inside the GPU worker image as a separate program, never in the site's JS. |
| [briaai/RMBG-2.0](https://huggingface.co/briaai/RMBG-2.0) | — | **CC BY-NC 4.0** | Avoid | |
| [briaai/RMBG-1.4](https://huggingface.co/briaai/RMBG-1.4) | — | Bria custom agreement | Avoid | |

### Voice (only with explicit consent) and dubbing

| Project | Code | Weights | Verdict |
| --- | --- | --- | --- |
| [hexgrad/kokoro](https://github.com/hexgrad/kokoro) | Apache-2.0 | `hexgrad/Kokoro-82M`: Apache-2.0 | Use directly (already; stock voices, no cloning) |
| MeloTTS on Workers AI | MIT | MIT | Use directly (already; 6 languages, 18.63 Neurons per audio minute) |
| [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox) | MIT | `ResembleAI/chatterbox`, `chatterbox-turbo`: MIT | Call as service, Lab only, consent-gated |
| [resemble-ai/Perth](https://github.com/resemble-ai/Perth) | MIT | — | Use with any cloned output (watermark) |
| [myshell-ai/OpenVoice](https://github.com/myshell-ai/OpenVoice) | MIT | `myshell-ai/OpenVoiceV2`: MIT | Call as service, consent-gated |
| [FunAudioLLM/CosyVoice](https://github.com/FunAudioLLM/CosyVoice) | Apache-2.0 | `FunAudioLLM/CosyVoice2-0.5B`: Apache-2.0 | Call as service (multilingual dubbing voices) |
| [Zyphra/Zonos](https://github.com/Zyphra/Zonos) | Apache-2.0 | `Zyphra/Zonos-v0.1-transformer`: Apache-2.0 | Call as service |
| [nari-labs/dia](https://github.com/nari-labs/dia) | Apache-2.0 | `nari-labs/Dia-1.6B`: Apache-2.0 | Call as service (optional, dialogue) |
| [SWivid/F5-TTS](https://github.com/SWivid/F5-TTS) | MIT | **`SWivid/F5-TTS`: CC-BY-NC-4.0** | Research only |
| [coqui-ai/TTS](https://github.com/coqui-ai/TTS) (XTTS-v2) | MPL-2.0 | **`coqui/XTTS-v2`: Coqui Public Model License (non-commercial)** | Avoid |
| [fishaudio/fish-speech](https://github.com/fishaudio/fish-speech) | **Fish Audio Community License** (Oct 2026): no license to offer a hosted service | — | Avoid |
| [index-tts/index-tts](https://github.com/index-tts/index-tts) | **bilibili Model Use License** | — | Avoid |
| [Plachtaa/seed-vc](https://github.com/Plachtaa/seed-vc) | **GPL-3.0** | — | Avoid (voice conversion) |
| [RVC-Project](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI) | MIT | — | Avoid (policy: converts a voice into someone else's) |
| `m2m100-1.2b` on Workers AI | — | `facebook/m2m100_1.2B`: MIT | Use directly (translation, 31 Neurons per 1k tokens) |
| [facebook/seamless-m4t-v2-large](https://huggingface.co/facebook/seamless-m4t-v2-large) | — | **CC-BY-NC-4.0** | Avoid |
| [bytedance/LatentSync](https://github.com/bytedance/LatentSync) | Apache-2.0 | `ByteDance/LatentSync-1.5`: OpenRAIL++ (use restrictions) | Call as service, Lab, v3 |
| [TMElyralab/MuseTalk](https://github.com/TMElyralab/MuseTalk) | MIT | `TMElyralab/MuseTalk`: MIT (pulls in other models with their own terms) | Research only until each dependency is checked |
| Rudrabha/Wav2Lip | no LICENSE file at the repo root | — | Avoid |

### Eye contact

| Project | License | Verdict | Notes |
| --- | --- | --- | --- |
| [KwaiVGI/LivePortrait](https://github.com/KwaiVGI/LivePortrait) | MIT; weights `KlingTeam/LivePortrait`: MIT | Research only (v3) | Its LICENSE notes that the bundled InsightFace detection models are non-commercial research only and must be replaced for commercial use (MediaPipe's face landmarker is the natural swap; check its model card first). Its keypoint retargeting is the most promising open route to gaze correction; nothing open matches Descript's effect today. |

### Media plumbing in the browser

| Project | License | Verdict | Notes |
| --- | --- | --- | --- |
| [Vanilagy/mp4-muxer](https://github.com/Vanilagy/mp4-muxer) | MIT | Use directly (already) | Supports an AAC audio track next to H.264. |
| [Vanilagy/mediabunny](https://github.com/Vanilagy/mediabunny) | MPL-2.0 | Use directly, unmodified from the CDN | Demux, decode, cut and remux in one library; MPL is file-level copyleft, fine next to MIT if we don't modify its files. |
| [gpac/mp4box.js](https://github.com/gpac/mp4box.js) | BSD-3-Clause | Use directly | MP4 demuxing for WebCodecs decode. |
| [ffmpegwasm/ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) | Wrapper MIT, but **`@ffmpeg/core` and `@ffmpeg/core-mt` are `GPL-2.0-or-later`** (their package.json) | Avoid the core in the bundle | An LGPL-only self-build is possible (FFmpeg is mostly LGPL-2.1+, see [ffmpeg.wasm-core](https://github.com/ffmpegwasm/ffmpeg.wasm-core)), but WebCodecs plus the muxers above already cover us. |
| [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) (onnxruntime-web) | MIT | Use directly | WebGPU and WASM execution for every ONNX model above. |
| [remotion-dev/remotion](https://github.com/remotion-dev/remotion) | Remotion License (source-available; company license required for larger teams) | Avoid | |
| [Breakthrough/PySceneDetect](https://github.com/Breakthrough/PySceneDetect) | BSD-3-Clause | Research / service | Shot-change detection for B-roll, if ever needed. |

---

## 4. Our design: "Edit by text"

### Where it lives

A new **Edit** page (`/edit`), linked from the Audio page's Captions tab ("Edit this by text") and from Video ("Add an edited clip"). It shares `transcribe.js` with Captions, so one transcription serves captions, cuts and clips. Everything runs in the visitor's tab except ASR (Workers AI, already capped) and the optional GPU jobs.

### UX flow

1. **Drop** an audio or video file. The page probes it (`extract.probe`), decodes audio to 16 kHz mono for ASR and keeps the original for export (`extract.read`).
2. **Transcribe** with the existing parts upload. New: send `initial_prompt` with a short disfluent sentence in the chosen language so Whisper keeps more "um/uh", and keep `segments[].words` and `avg_logprob`.
3. **The script view.** Words as inline spans with `data-i`. Select and press Delete: the span gets a strikethrough (our "struck" state) and playback skips it; Shift+Delete removes it from view entirely. Undo stack of operations, never of media. Low-confidence words are underlined so names can be fixed (text fixes do not move media).
4. **One-click tools** in a side panel, each showing a count and a review list with per-item preview, like a spell checker:
   - *Fillers (n)*: delete all, review each, or keep.
   - *Pauses*: "shorten pauses longer than [0.8] s to [0.3] s".
   - *Repeats*: "I I think", "the the", restarted phrases.
   - *Clean voice*: Off / Light (browser) / Studio (GPU).
   - *Captions*: style picker, burned into the video export or exported as SRT/VTT.
   - *Clips*: "find 3 clips of 30-60 s about [topic]", 9:16 or 1:1.
   - *Translate*: captions only, or a stock-voice dub.
5. **Preview** plays the source and jumps over cut ranges (Web Audio for audio-only; for video a `<video>` element that seeks at each cut, which is approximate; the export is exact).
6. **Export**: MP3/M4A/WAV (audio), MP4 (video with optional burned captions), SRT/VTT re-timed to the edit, a JSON project file, or **Send to storyboard** as a new clip card.

### Data format: the edit list

Stored in IndexedDB under a new `kind: 'edit'` item (the `store.js` pattern), media kept as a Blob reference.

```json
{
  "v": 1,
  "kind": "edit",
  "source": { "name": "episode-12.mp4", "duration": 1812.4, "audio": { "rate": 48000, "channels": 2 }, "video": { "w": 1920, "h": 1080, "fps": 30 } },
  "asr": { "model": "@cf/openai/whisper-large-v3-turbo", "lang": "en" },
  "words": [
    { "i": 0, "t": "So", "s": 0.52, "e": 0.71, "seg": 0, "spk": null, "conf": -0.21 },
    { "i": 1, "t": "um,", "s": 0.74, "e": 1.10, "seg": 0, "spk": null, "conf": -0.80, "tag": "filler" }
  ],
  "ops": [
    { "op": "strike", "from": 1, "to": 1, "why": "filler" },
    { "op": "gap", "after": 14, "to": 0.3, "why": "pause" },
    { "op": "strike", "from": 210, "to": 248, "why": "manual" }
  ],
  "voice": { "clean": "light", "mix": 0.8 },
  "captions": { "style": "pop", "font": "Instrument Sans", "active": "#ffd23f", "maxChars": 32 },
  "out": { "loudness": -16, "format": "mp3", "kbps": 192 }
}
```

`ops` are the only thing a user (or the AI planner) edits. A pure function `compile(words, ops, audio)` turns them into **keep ranges** in source seconds:

```json
{ "keep": [[0.0, 0.74], [1.10, 12.31], [13.02, 40.0]], "joins": [{ "at": 0.74, "fade": 0.006 }] }
```

The same function re-times words for captions (`t_out = t_src - removed_before(t_src)`), so captions, preview and export always agree.

### Cutting well (the part that decides quality)

Whisper's word edges are often 50-150 ms off. Before cutting, each cut edge is moved to the quietest point in a +/-80 ms window around the word boundary (20 ms RMS frames on the 48 kHz source), then to the nearest zero crossing; joins get a 5-10 ms equal-power crossfade. A filler is skipped (left in, flagged "can't cut cleanly") when either neighbour gap is under 30 ms of quiet, which is our own version of avoiding harsh cuts. For video, cut points snap to frame boundaries, and an optional "punch-in" alternates 100% and 108% scale at each jump cut, a standard editor's trick that needs no model.

### Finding fillers without a verbatim model

Whisper often silently drops "um". Three cheap layers, all free:

1. **Prompted ASR**: `initial_prompt` with disfluencies (documented in OpenAI's prompting guide) makes Whisper keep more of them.
2. **Lexicon per language**: `um, uh, er, ah, hmm, mm` always; `like`, `you know`, `I mean`, `so` only when bounded by pauses (more than 150 ms) or commas; repeated tokens ("I I"); restarts (a word followed by the same two words).
3. **Unworded speech**: Silero VAD (browser) finds speech inside gaps that have no word. A voiced island of 150-700 ms between two words is almost always a filler or a breath; list it as "unlabeled sound" with a preview.

CrisperWhisper would do this better but its weights are non-commercial, so it stays in the Lab.

### Clean voice

- **Light (browser, $0)**: 80 Hz high-pass, RNNoise (BSD-3) in an AudioWorklet at 48 kHz, a gentle de-esser, then the existing BS.1770 levelling to -16 LUFS (podcast) or -14 LUFS (video) with the existing look-ahead limiter. Mix slider = wet/dry.
- **Studio (GPU)**: new `enhance` job in `gpu/handler.py` running DeepFilterNet (MIT/Apache) or Resemble Enhance (MIT). Input: 48 kHz mono Opus inside the handler's 9.5 MB base64 body limit (`MAX_INPUT_B64`; base64 adds a third, so about 13 minutes at 64 kb/s); longer files go in parts cut at quiet points (reuse `planParts`). The result must fit `MASSLESS_MAX_RESULT_MB` (15 MB base64), so return Opus or FLAC, not WAV. The mix slider is applied in the browser so moving it never re-runs the GPU (this also covers the "speech disappears in loud noise" failure Descript documents).

### Captions on the picture

Styles are data, drawn on the export canvas by one renderer: `line` (two lines, bottom), `pop` (one word at a time, scale-in), `karaoke` (active word filled, future words dim), `box` (word-by-word highlight box). Inputs: re-timed words, safe area for the aspect ratio, font from the fonts already shipped. Same renderer for preview and export, matching the "every frame is a function of time" rule the effects use.

### Clips for social

`POST /api/clips` (new, gated and capped like `/api/ask`): the browser sends numbered sentences with start/end times (no media). The LLM returns JSON `{clips: [{from: 41, to: 58, title, hook}]}` against a JSON schema (Workers AI JSON mode supports Llama 3.3 70B, [docs](https://developers.cloudflare.com/workers-ai/features/json-mode/)). The browser validates ranges, cuts, and reframes to 9:16 by tracking the subject center (our depth-based subject finder from `effects.js`, or MediaPipe's face detector once its model card license is checked; only the selfie segmenter's card was verified here), smoothing the crop path with a critically damped spring. Cost: a 30-minute transcript is about 6k input tokens and 600 output tokens, so roughly 280 Neurons per request on Llama 3.3 (26,668 per M input, 204,805 per M output).

### AI actions (our answer to an agent panel)

A command box ("remove fillers, tighten pauses to 0.3 s, cut the intro before 'welcome back'") goes to `POST /api/edit-plan`, which returns **only ops** from a fixed vocabulary: `strike{from,to}`, `fillers{mode}`, `gaps{over,to}`, `captions{style}`, `clips{n,len,topic}`, `clean{level}`. The browser shows the plan, applies it as reviewable ops, and nothing runs that the user can't see or undo. Deterministic, cheap (a few hundred Neurons), no tool-calling loop, no surprise costs.

### Translate and dub

Captions: m2m100 or Llama 3.3 per segment, keeping segment times. Dub (v3): MeloTTS for its six languages, Kokoro for English, or CosyVoice2 on the GPU for more; each translated segment is synthesized, then fitted to its original slot by adjusting TTS speed (Kokoro takes a speed parameter) and, if still long, a WSOLA time-stretch of at most 15%; the original voice is ducked under the dub, or replaced when a speech/music separation is available. Lip sync (LatentSync) stays in the Lab.

### Voice cloning policy

Default: no cloning. "Fix a word" uses a stock voice, and we say so. If a cloned voice is ever offered (Lab only), it must be the visitor's own voice: the page shows a **randomized** consent sentence, records it live (no uploads), checks the transcript matches (Whisper) and that the consent voice and the sample voice match by speaker embedding, watermarks every output with Perth (MIT), and stores nothing server-side. That is stricter than a fixed consent script, which a recording of someone else could replay. Synthetic speech must be labelled as such (right-of-publicity laws and AI transparency rules such as the EU AI Act's deepfake disclosure duty apply).

### Green screen

- **Browser ($0)**: MediaPipe Selfie Segmenter at 256x256 per frame during export, alpha feathered and temporally smoothed (exponential moving average with a motion gate), background replaced by a still from the Image tool, a blur of the original, or a solid color. Good for webcam talking heads.
- **GPU (quality)**: BiRefNet (MIT) per frame, or RVM (GPL-3.0, isolated in the worker image) for temporal stability; alpha returned as a grayscale H.264 or WebM (VP9) track and composited in the browser.

### Eye contact

Not in scope until an open, commercially usable gaze model exists. Track LivePortrait-style keypoint retargeting in the Lab.

---

## 5. Phased plan

| Phase | Scope | Effort | Cost per use |
| --- | --- | --- | --- |
| **v1** | `/edit` page; script view with strike/remove/undo; fillers (lexicon + prompted ASR), repeats, pause shortening; quiet-point edge snapping and crossfades; preview; **audio export** through the existing extract pipeline with loudness levelling; re-timed SRT/VTT. | 1-2 days | ASR only: 46.6 Neurons per audio minute (already capped). Everything else $0 in the browser. |
| **v2** | Video export (WebCodecs decode via mp4box.js or Mediabunny, canvas, H.264 + AAC with mp4-muxer); burned-in caption styles; unworded-speech filler detection with Silero VAD; Light clean voice (RNNoise); green screen with MediaPipe; `/api/clips` with 9:16 reframing; `/api/edit-plan`; translated captions; "send to storyboard" clip cards. | 4-6 days | LLM calls about 200-300 Neurons each; translation about 31 Neurons per 1k tokens. |
| **v3** | GPU jobs: `enhance` (DeepFilterNet / Resemble Enhance), `align` (WhisperX with Apache alignment models, optional pyannote diarization for speaker labels and per-speaker captions), `matte` (BiRefNet / RVM); stock-voice dubbing with timing fit; Lab: consented voice, lip sync, eye-contact research. | 1-2 weeks | See below. |

**GPU cost per use (rough, to be measured).** RunPod lists the 24 GB serverless tier (L4, A5000, 3090) at $0.75/hour ([pricing](https://www.runpod.io/pricing)), so $0.000208 per second and the $0.75/day budget buys about 3,600 GPU-seconds a day. Billing runs from worker start to stop, including cold start and the idle timeout (default 5 s) ([docs](https://docs.runpod.io/serverless/pricing)). Estimates:

| Job | Warm GPU time (estimate) | Cost |
| --- | --- | --- |
| Enhance 10 min of speech (DeepFilterNet; Resemble Enhance is several times slower) | 10-60 s | $0.002-0.013 |
| WhisperX align and diarize 10 min | 20-60 s | $0.004-0.013 |
| BiRefNet matte, 1 min of 1080p30 video (1,800 frames) | 60-120 s | $0.013-0.025 |
| Any cold start (container up, models into VRAM) | 20-90 s | $0.004-0.019 |

At those rates the daily budget covers on the order of 50-150 enhance jobs, so the GPU path needs its own daily cap and the same Turnstile pass as the free endpoints.

### Risks

- **Timestamp quality.** Whisper word edges and dropped fillers are the main quality risk; edge snapping and VAD islands mitigate it, WhisperX alignment fixes it on the GPU.
- **Browser memory.** A one-hour 1080p video cannot be fully decoded; decode and encode in a streaming loop (`VideoDecoder` to canvas to `VideoEncoder`) and keep only the audio buffer in memory, as Extract already does.
- **Codec support.** WebCodecs H.264 encoding is missing on some Firefox/Linux builds; keep the existing WebM recorder fallback in `recorder.js`.
- **Free-tier caps.** ASR shares 10,000 Neurons a day with images, TTS and LLM calls. Offer whisper.cpp in the browser as an offline fallback when the cap is reached.
- **License contamination.** RVM, pedalboard, Matchering and ComfyUI are GPL: keep them in the GPU image, never in `public/`. Never use MMS alignment, CrisperWhisper, F5 or XTTS weights outside the Lab.
- **Abuse.** Voice cloning and lip sync enable impersonation; both stay off the main site, consent-gated and watermarked in the Lab.
- **Clean-room.** Use our own names and our own UI; this document is the only place Descript's feature names appear.
