# LANDR, reverse-engineered for Massless

Clean-room notes: LANDR's own help center blocks automated reads (HTTP 403), so the behavior below comes from LANDR's public blog, launch coverage, hands-on reviews, the AudioShake press releases and Wikipedia. No LANDR code, presets, audio or text were copied. Our style and setting names are our own.

Research date: 2026-10-30.

---

## 1. Feature map

Value: **H** = why people come, **M** = regularly used, **L** = niche or out of reach for us.

| Feature | What users see | How it appears to work | Value | Sources |
| --- | --- | --- | --- | --- |
| **AI mastering (web)** | Upload a finished mix (WAV/MP3), get a master in a few minutes (a reviewer's 4-minute song took about three). A/B the original and the master. Three **styles** (a warm/soft one, a balanced one, an open/punchy modern one) and three **intensities** (low preserves dynamics for acoustic or spoken word, medium general, high loudest for EDM). Album mode masters up to 24 songs together. | Analysis of the mix (genre or "micro-genre" estimate, spectrum, dynamics), then a fixed chain (multiband compression, EQ, stereo enhancement, saturation, limiting) whose settings are chosen per track; intensity mostly moves the loudness target and limiter drive. | **H** | [Planetary Group hands-on test](https://www.planetarygroup.com/landr-ai-mastering-engine-overview-test/), [LANDR reference-mastering post](https://blog.landr.com/reference-mastering/) |
| **Mastering plugin** | Runs on the DAW master bus; scans the loudest part of the song and proposes a master; the same three styles; manual 3-band EQ with a spectrum view, presence, loudness against a LUFS meter, stereo width, compression, saturation, de-esser; all in real time. $299 or in the Studio Pro subscription. | The web engine's analysis on a short excerpt, exposing the chain's macro controls. | M | [MusicRadar launch](https://www.musicradar.com/news/landr-mastering-plugin) |
| **Reference mastering** | Add up to three reference tracks you own or have rights to; the master is styled after them. | Measures the references' tonal balance, loudness and width, then sets the chain to move the mix toward them. | M-H | [LANDR blog](https://blog.landr.com/reference-mastering/) |
| **Delivery and loudness** | Free trial: two tracks as 192 kb/s MP3; 320 kb/s MP3 and WAV paid per track or by subscription (2024 test: Basic $6/mo, Advanced $14/mo, Pro $39/mo). | Encoding after a true-peak-safe limiter. | M | [Planetary Group](https://www.planetarygroup.com/landr-ai-mastering-engine-overview-test/) |
| **Stems** | A stem-splitting plugin (vocals, drums, bass, other; later piano and guitar) powered by AudioShake. | A licensed source-separation model. | M | [AudioShake press release](https://www.audioshake.ai/press-releases/landr-introduces-landr-stems-plugin-powered-by-audioshakes-award-winning-ai-technology), [upgrade](https://www.audioshake.ai/post/landr-upgrades-its-stems-plugin-with-audioshakes-next-generation-separation----now-featuring-piano-and-guitar) |
| **Layers and Blueprints** (AI co-production) | Blueprints suggests song starters and structures from a genre, lyrics or reference audio and can output DAW-ready stems; Layers generates parts (guitar leads, basslines) fitted to a song's key, tempo and structure. Marketed under a "Fair Trade AI" framework with consenting, compensated artists. | Generative audio models conditioned on key, tempo and structure. | M | [MusicTech](https://musictech.com/news/gear/landr-blueprints-layers-ai-tools/) |
| **Samples** | A library of over a million samples, a "Selector" that suggests complementary samples, a browser previewer and a DAW plugin. | Licensed sample catalog plus similarity search. | M | [Wikipedia](https://en.wikipedia.org/wiki/LANDR) |
| **Collaboration** | Projects, Sessions and a services marketplace (LANDR Network). | Shared project storage, comments, video sessions. | L-M | [Wikipedia](https://en.wikipedia.org/wiki/LANDR) |
| **Distribution** | Release to streaming services and stores (since 2017). | Aggregator agreements with stores, metadata, royalties. | **H** for releasing artists, **out of reach** for us | [Wikipedia](https://en.wikipedia.org/wiki/LANDR) |
| **Plugins** | Rent-to-own plugins and a Studio subscription; LANDR bought Reason Studios in January 2026. | Licensing. | L for us | [Wikipedia](https://en.wikipedia.org/wiki/LANDR), [MusicRadar](https://www.musicradar.com/news/landr-mastering-plugin) |

**What matters most to users.** Mastering is the brand and the reason people try LANDR: one upload, a louder and more finished track, three simple choices, A/B. The test above found the master at least 5 dB louder with added "shimmer", which is also a warning: louder always sounds better in a quick A/B, so a fair tool must loudness-match its preview. Distribution and samples matter to releasing artists but are business deals, not software.

**Platform loudness targets** we will expose (verified from the platforms where possible):

| Destination | Integrated loudness | Peak | Source |
| --- | --- | --- | --- |
| Spotify | -14 LUFS (normal); listeners can pick -11 (loud) or -19 (quiet) | -1 dBTP; -2 dBTP if the master is louder than -14 LUFS | [Spotify for Artists](https://support.spotify.com/us/artists/article/loudness-normalization/) |
| Apple Podcasts | -16 LUFS +/-1 dB | -1 dBTP | [Apple Podcasts audio requirements](https://podcasters.apple.com/support/893-audio-requirements) |
| YouTube, Apple Music, Tidal, Amazon | commonly quoted as -14 (YouTube) and -16 (Apple Music Sound Check) | -1 dBTP | Not verified from first-party pages here; label as "typical" in the UI |
| Broadcast | -23 LUFS (EBU R 128) | -1 dBTP | EBU R 128 (well known; cite the EBU page when shipping) |
| "Club / loud" | -9 to -8 LUFS | -1 dBTP | Our choice; warn that streaming services turn it down |

Spotify measures with ITU-R BS.1770, the same meter `extract-worker.js` already implements.

---

## 2. What Massless already has

| Existing piece | File | Reuse |
| --- | --- | --- |
| Streaming BS.1770 gated loudness meter, gain-to-target, look-ahead limiter with a measure / simulate / encode pass loop that corrects the gain until the limited output hits the target | `public/js/extract-worker.js` (`TARGET_LUFS = -14`, `Limiter`, `Job`) | The last stage of the mastering chain, unchanged |
| A true-peak estimate (Catmull-Rom between samples), a feedback-delay-network reverb, sidechain ducking, and mastering of the score to -14 LUFS | `public/js/score.js` | True-peak metering for the limiter; ducking for the mix assistant |
| Streaming decode of MP4/MOV/M4A/MP3/WAV at native rate, MP3 (LAME, LGPL, loaded unmodified), M4A, WAV writers | `public/js/extract.js` | Input and output of the Master tab |
| GPU worker with job registry, 9.5 MB base64 input and 15 MB base64 output limits | `gpu/handler.py` (`MAX_INPUT_B64`, `MAX_RESULT_B64`) | Stems job |
| ACE-Step 1.5 (MIT) music generation | `gpu/models.json` | Loops and backing parts (our "Layers") |
| The beat tracker port in progress | see `beat-detection.md` | Tempo and bars for the mix assistant and loop sync |

The current limiter checks sample peaks with conservative ceilings (-1.05 dBFS for WAV, -1.6 dBFS for lossy) rather than true peak. For mastering we will run the limiter's detector on 4x-oversampled peaks (ITU-R BS.1770 Annex 2 method) or on `score.js`'s interpolated peak, so a -1 dBTP promise is actually kept.

---

## 3. Open-source building blocks (licenses verified)

Verified from each repo's LICENSE file and, for weights, the Hugging Face model card on 2026-10-30.

### Mastering and mixing

| Project | Code | Weights | Verdict | Notes |
| --- | --- | --- | --- | --- |
| [sergree/matchering](https://github.com/sergree/matchering) | **GPL-3.0** | — | Call as service (separate container), or re-implement the technique | Matches a target's RMS, frequency response, peak amplitude and stereo width to a reference, then applies its own brickwall limiter (README). The technique is generic (long-term spectrum matching plus loudness and width matching); we build our own from first principles in JS and never read its source while doing so. It also ships as a Docker web app and a ComfyUI node, so it could run inside the GPU image as a comparison oracle. |
| [csteinmetz1/pyloudnorm](https://github.com/csteinmetz1/pyloudnorm) | MIT | — | Use directly (tests) | Oracle for our JS meter in `tests/`: integrated LUFS on reference signals must match within 0.1 LU. |
| [spotify/pedalboard](https://github.com/spotify/pedalboard) | **GPL-3.0** | — | Call as service only | Handy on the GPU worker for offline effect chains; never in the site. |
| [csteinmetz1/dasp-pytorch](https://github.com/csteinmetz1/dasp-pytorch) | Apache-2.0 | — | Call as service (v3) | Differentiable EQ, compressor, reverb: fit a chain's parameters to a reference by gradient descent on the GPU, then run the same chain in the browser. |
| [csteinmetz1/automix-toolkit](https://github.com/csteinmetz1/automix-toolkit) | Apache-2.0 | Pretrained checkpoints trained on research datasets (ENST-Drums and others); no weight license stated | Research only (weights) | Good reference architectures for a mix assistant. |
| [sai-soum/Diff-MST](https://github.com/sai-soum/Diff-MST) | **CC BY-NC-SA 4.0** | — | Research only | Mixing style transfer from a reference mix. |
| [adobe-research/DeepAFx-ST](https://github.com/adobe-research/DeepAFx-ST) | **Adobe Research License** (noncommercial research only) | — | Avoid | |
| [Tonejs/Tone.js](https://github.com/Tonejs/Tone.js) | MIT | — | Use directly | Sample playback and loop sequencing if we add a loop library. |

### Stems (source separation)

| Project | Code | Weights | Verdict | Notes |
| --- | --- | --- | --- | --- |
| [facebookresearch/demucs](https://github.com/facebookresearch/demucs) (maintained at [adefossez/demucs](https://github.com/adefossez/demucs)) | MIT | htdemucs / htdemucs_6s distributed with the MIT repo | Call as service (GPU) | The default: 4 stems (vocals, drums, bass, other) or 6 (adds guitar, piano). |
| [sevagh/demucs.onnx](https://github.com/sevagh/demucs.onnx) | MIT | uses Meta's weights | Research, later browser | ONNX Runtime port that can target WebGPU. |
| [sevagh/demucs.cpp](https://github.com/sevagh/demucs.cpp) / [free-music-demixer](https://github.com/sevagh/free-music-demixer) | MIT (WASM and JS) | **The free-music-demixer site's own weights and assets are proprietary** (README) | Research only | Its README reports a 7-minute song taking about 41 minutes single-threaded and about 9 minutes with 8 workers in WASM: too slow to be the default. |
| [sigsep/open-unmix-pytorch](https://github.com/sigsep/open-unmix-pytorch) | MIT | **`umxl` weights: CC BY-NC-SA 4.0** (README) | Avoid `umxl` | |
| [deezer/spleeter](https://github.com/deezer/spleeter) | MIT | MIT | Call as service (fallback) | Lower quality than Demucs, very fast. |
| [lucidrains/BS-RoFormer](https://github.com/lucidrains/BS-RoFormer), [ZFTurbo/Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training), [nomadkaraoke/python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator) | MIT | Community checkpoints with mixed or unstated licenses | Research only | Best vocal separation quality today comes from RoFormer checkpoints, but each checkpoint's license must be checked one by one. |

### Generative music (for a "Layers"-like feature)

| Project | Code | Weights | Verdict |
| --- | --- | --- | --- |
| [ace-step/ACE-Step-1.5](https://github.com/ace-step/ACE-Step-1.5) | MIT | `ACE-Step/Ace-Step1.5`: MIT | Use (already in the GPU worker) |
| [Stability-AI/stable-audio-tools](https://github.com/Stability-AI/stable-audio-tools) | MIT | **`stable-audio-open-1.0`, `-small`: Stability AI Community License, gated** | Avoid on the main site |
| MusicGen | — | **`facebook/musicgen-small`: CC-BY-NC-4.0** | Avoid |

### Browser techniques (no library needed)

- **Render offline** with `OfflineAudioContext` or, better, our own streaming DSP in a Worker (what Extract already does), so a 10-minute file never needs a 10-minute real-time render.
- **EQ**: biquad peaking and shelf filters (RBJ cookbook formulas) in JS; linear-phase FIR (FFT overlap-add) for reference matching, where phase shifts would smear transients.
- **Crossovers**: 4th-order Linkwitz-Riley (two cascaded Butterworth biquads) at about 120 Hz and 4 kHz, which sum flat for multiband compression.
- **Mid/side**: `M = (L+R)/2`, `S = (L-R)/2`; width = side gain above about 150 Hz, mono below.
- **Saturation**: `tanh` soft clip at 4x oversampling to avoid aliasing.
- **Meters**: BS.1770 integrated (have), short-term and momentary, loudness range (EBU Tech 3342), true peak (4x oversampling), correlation.
- `DynamicsCompressorNode` is not suitable (fixed knee and detector, no look-ahead, no sidechain filter); write the compressor ourselves.

---

## 4. Our design: a Master tab

### Where it lives

`/audio?tab=master`, next to Extract audio, using the same drop zone, queue and encoder. Input: any file Extract can read. Everything runs in a Worker in the visitor's tab; nothing is uploaded. A "Master this" button on the Film page's score and on Extract results sends audio straight in.

### UX flow

1. Drop a mix. The page decodes it at its native rate and shows a **report**: integrated loudness, true peak, loudness range, dynamic range (peak-to-loudness ratio), a 1/3-octave long-term spectrum against a reference band, stereo width and phase correlation, low-end mono compatibility, plus tempo and key when the beat port is in.
2. Pick a **character** (our names): *Soft* (gentle glue, slight low-mid warmth, a little saturation), *Neutral* (corrective EQ only, transparent), *Punch* (tighter low end, presence lift, wider sides). Pick a **destination**: Streaming (-14 LUFS, -1 dBTP), Podcast (-16 LUFS, -1 dBTP), Video/broadcast (-23 LUFS), Loud (-9 LUFS, with a note that streaming will turn it down). Optional: a **reference track** you own.
3. **A/B, loudness-matched.** The original and the master play gain-matched to the same LUFS by default ("Fair A/B"), with a toggle to hear the real level difference. Waveform and spectrum overlays show what changed.
4. **Fine controls** (collapsed): low/mid/high tilt, presence, width, glue amount, saturation, de-ess, ceiling.
5. **Export** with the existing writers: WAV 24-bit (new; WAV is 16-bit today), MP3 320, M4A 256, plus a JSON "master card" with before/after numbers.
6. **Album mode**: several tracks share one destination and are matched to the same loudness and a common tonal target, so the album plays evenly.

### The chain (per track, in this order)

| Stage | What it does | How the settings are chosen |
| --- | --- | --- |
| 1. Analyze | LTAS in 1/3-octave bands, crest factor, LUFS, true peak, side/mid energy per band, DC offset | One pass of the existing streaming read |
| 2. Subsonic | 2nd-order high-pass at 20-30 Hz, DC removal | Fixed |
| 3. Tonal balance | EQ toward a target curve: either our built-in "pink-ish" curves (a gentle downward tilt of a few dB per octave, varied by character) or the reference's LTAS. Difference curve smoothed over 1/3 octave, clamped to +/-4 dB (+/-6 dB with a reference), fitted with 6-8 biquads, or applied as a linear-phase FIR | Automatic; the fine controls offset the target |
| 4. De-ess | Dynamic band cut at 5-9 kHz when sibilance exceeds the band's average by a threshold | On for vocal-heavy material (high 5-9 kHz crest) |
| 5. Glue | 3-band compressor (Linkwitz-Riley at ~120 Hz and ~4 kHz), slow attack (10-30 ms), auto release, 1.5:1 to 3:1 | Ratio and threshold from the character and from the gap between the mix's crest factor and the destination's typical crest |
| 6. Width | Side gain above ~150 Hz (0.9x to 1.25x), mono below ~120 Hz, with a correlation guard (never below +0.2) | Character; reference width when given |
| 7. Saturation | Soft clip at 4x oversampling, 0-3 dB drive, mixed in parallel | Character |
| 8. Loudness + limit | Gain to the destination, then the look-ahead limiter with a true-peak detector; the existing measure/simulate loop corrects the gain until the limited result measures on target | Destination; ceiling -1 dBTP, or -2 dBTP when the target is louder than -14 LUFS (Spotify's advice) |
| 9. Dither | TPDF dither when writing 16-bit | Fixed |

### Reference mastering (v2)

The reference is decoded in the browser and never uploaded. We measure its LTAS, integrated loudness, crest factor and band-wise side/mid ratio, then: EQ target = reference LTAS (both normalized to equal loudness first), loudness target = reference LUFS (capped by the destination's ceiling), glue amount chosen so the master's crest factor lands near the reference's, width matched band by band. A checkbox confirms the user has rights to the reference; nothing about it is stored except the numbers.

### Data format

```json
{
  "v": 1,
  "kind": "master",
  "source": { "name": "mix-v7.wav", "rate": 48000, "channels": 2, "duration": 214.6 },
  "analysis": {
    "lufs": -19.8, "truePeak": -3.1, "lra": 7.4, "plr": 16.7,
    "ltas": { "bands": [25, 31.5, 40, "... 1/3-octave centres ...", 20000], "db": [-38.2, -33.0, "..."] },
    "width": { "low": 0.04, "mid": 0.31, "high": 0.42 }, "correlation": 0.61,
    "bpm": 124.0, "key": null
  },
  "settings": { "character": "punch", "destination": "streaming", "lufs": -14, "ceiling": -1.0, "reference": null,
                "tilt": 0, "presence": 1.0, "width": 1.1, "glue": 0.5, "drive": 0.3, "deess": "auto" },
  "chain": { "eq": [{ "type": "peaking", "f": 180, "q": 0.9, "gain": -1.6 }], "comp": [{ "band": "low", "ratio": 2.0, "thresh": -24 }] },
  "result": { "lufs": -14.0, "truePeak": -1.0, "gainDb": 5.8, "limiterMaxGr": 2.3 }
}
```

`chain` is computed from `analysis` and `settings` by a pure function, so the same card always renders the same master and tests can pin it.

### Stems (v2, GPU)

New `stems` job in `gpu/handler.py` running htdemucs (4 stems) or htdemucs_6s. Payload limits shape the format: a 4-minute song as 192 kb/s MP3 is about 5.8 MB, 7.7 MB in base64, so it fits the 9.5 MB input limit; four stems back as 96 kb/s Opus are about 2.9 MB each, about 15.4 MB in base64, just over the 15 MB result limit. So return 80 kb/s Opus (fits), or move results to R2 with presigned URLs, which also lifts the song-length limit. The browser shows a mixer (gain, mute, solo per stem), exports a ZIP (fflate, MIT, already used by Office) and can send the instrumental to the Video page as a bed. A rights checkbox is required ("I made this or have the rights"); stems are never stored server-side.

### Mix assistant (v3)

With stems from the user's own project (or from separation), auto gain-staging to typical stem balances (vocals sitting 2-4 LU above the rest, a common starting point), EQ un-masking (cut 1-3 dB where two stems' spectra overlap most), vocal-keyed sidechain ducking (already in `score.js`), then the Master chain. dasp-pytorch on the GPU can fit chain parameters to a reference mix; the fitted parameters run in the browser.

### What we will not build

- **Distribution**: needs store agreements, royalty accounting, payments and fraud control. Link out instead.
- **A sample store**: licensing. Our "samples" are generated (ACE-Step loops, the synth beds) and are the user's to use.
- **Plugins** (VST/AU): not a browser product.
- **Collaboration**: wait for the roadmap's R2 + D1 shared reels; a master card is small JSON and shares easily then.

---

## 5. Phased plan

| Phase | Scope | Effort | Cost per use |
| --- | --- | --- | --- |
| **v1** | Master tab: analysis report, three characters x four destinations, the chain above minus reference matching, true-peak limiter, fair A/B, WAV 24-bit / MP3 / M4A export; Python tests that check our LUFS against pyloudnorm and true peak against 4x-oversampled numpy | 1-2 days | $0 (browser) |
| **v2** | Reference mastering, album mode, de-esser tuning, `stems` GPU job (htdemucs) with a stem mixer, "Master this" buttons on Film and Extract | 2-4 days | Stems: GPU time estimated at 10-30 s warm for a 4-minute song on the 24 GB tier ($0.75/h, so about $0.002-0.006), plus 20-90 s on a cold start ($0.004-0.019). The $0.75/day budget is about 3,600 GPU-seconds. |
| **v3** | Mix assistant on stems, dasp-pytorch chain fitting, optional Matchering container as a comparison oracle in the Lab, ACE-Step "add a part" in the song's key and tempo | 1-2 weeks | Similar GPU cost per job |

### Risks

- **Taste.** An automatic master that is loud but harsh does harm; fair A/B, conservative clamps and the Neutral default keep us honest. Collect opt-in thumbs up/down per character (stored locally, never the audio) to tune presets.
- **Loudness war.** Users will pick Loud; show what Spotify will do to it (turned down to -14, so it only loses dynamics).
- **True-peak overs after encoding.** Lossy encoders overshoot; keep the lossy ceiling lower (as Extract does) and measure the decoded MP3 in tests.
- **Rights.** Stem separation and reference matching on copyrighted songs is a grey area; rights checkbox, no storage, no sharing of stems.
- **GPL.** Matchering and pedalboard only as separate programs in the GPU image, never in `public/`.
- **Payload limits.** Stems and long songs need R2 transfer instead of base64 bodies.
