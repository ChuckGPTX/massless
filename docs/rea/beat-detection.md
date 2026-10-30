# Beat and downbeat detection for Massless

Goal: given a song the visitor drops in (or one Massless made), return its tempo, every beat and the first beat of every bar, fast enough to cut Film blocks and Video storyboard shots to it, in the browser for $0, with a more accurate path where it's worth it.

Research date: 2026-10-30. Licenses verified from each repo's LICENSE file and, for weights, the Hugging Face model card metadata. Third-party code was read, not executed.

---

## 1. The starting point: Imagination Studio's `app/beats.py`

Source: [drowzeys/Imagination-Studio-by-keys-Wasserman](https://github.com/drowzeys/Imagination-Studio-by-keys-Wasserman), `app/beats.py` (301 lines), Apache-2.0. Massless already carries its license and NOTICE in `LICENSES/`.

**What it does** (from reading the code):

1. Decode to mono float32 at 22,050 Hz (ffmpeg).
2. STFT with a 1,024-sample Hann window, hop 256 (86.1 frames per second), power spectrum projected onto 40 triangular mel-scale bands from 30 Hz to 8 kHz; level in dB, floored 80 dB under the loudest frame.
3. **Onset envelope** = positive rise in dB from the previous frame, averaged over all bands (spectral flux); a second envelope over the bands under 200 Hz (kick and bass). The first frame rises from the quietest level of the first quarter second, so a song that starts on a beat keeps it. Each envelope is detrended (minus a 0.4 s moving average, floored at 0) and divided by its standard deviation.
4. **Tempo**: autocorrelation of the envelope (FFT), smoothed by a small Gaussian; candidate lags for 60-200 BPM in 0.02-frame steps; score = AC(lag) + 0.5 x AC(4 x lag) (a 4/4 bar term), times a log-normal prior centred on 120 BPM (sigma 1.4 octaves) to settle half/double tempo. Confidence = clipped comb score / 1.5.
5. **Beats**: dynamic-programming beat tracking in the style of [Ellis (2007)](https://hajim.rochester.edu/ece/sites/zduan/teaching/ece472/reading/Ellis_2007.pdf): each frame's score is its onset strength plus the best predecessor 0.5-2 periods back, penalised by `-100 * log(gap/period)^2`; backtrack from the best frame in the last period; drop leading and trailing beats weaker than 10% of the median.
6. **Refine**: each beat moved to its onset peak with a three-point parabola (sub-frame).
7. **BPM** from a straight-line fit of beat time against beat index.
8. **Downbeats**: of the four phases (beats 0,4,8..., 1,5,9..., ...), the one with the strongest low-band plus half the full-band onset; ties go to the earliest. Then every fourth beat from that phase.
9. Output: `{bpm, beats[], downbeats[], bars, duration, confidence, first, beatsPerBar: 4, version}`, cached beside the file.

**Accuracy evidence available for it**: its own tests use synthetic click tracks only (tempo within 2% at 90, 120, 128 and 150 BPM, gaps within 30 ms, the accented phase found as the downbeat, a song starting on its first beat). There is no real-music benchmark. Its design assumptions are a constant tempo and 4/4.

**Licensing for the JS port**: Apache-2.0 code may go into an MIT project. Keep the license and NOTICE (done, `LICENSES/Imagination-Studio-*`), mark the JS file as a port with changes, and honour the NOTICE's request to credit "Keys (github.com/drowzeys)" and "Sam Wasserman / Wasserman Productions (wassermanproductions.com)" in documentation and any about/credits surface (README credits plus the site's credits).

---

## 2. Open trackers compared

| Tracker | Approach | Beats / downbeats | Runs where | Code license | Weights license | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Imagination `beats.py` | Spectral flux + autocorrelation tempo + Ellis DP; downbeat by low-band phase | Yes / heuristic (4/4 only) | Anywhere (numpy); our JS port in the browser | Apache-2.0 | none | **Use directly** (port in progress) |
| [librosa](https://github.com/librosa/librosa) `beat_track` | Same family (onset strength + tempo + Ellis DP) | Beats only | Python | ISC | none | **Use directly** in tests as a second DSP reference |
| [CPJKU/beat_this](https://github.com/CPJKU/beat_this) (ISMIR 2024) | Transformer on a log-mel spectrogram, trained on 16 datasets; plain peak picking, no DBN needed | Yes / yes | PyTorch; ONNX in the browser | MIT | MIT (README: "code and the published model weights"; it adds that some training audio is copyrighted, for users to assess) | **Use directly** |
| [tuneperfect/beat-this-onnx](https://huggingface.co/tuneperfect/beat-this-onnx), [musetric/beat-this-onnx](https://huggingface.co/musetric/beat-this-onnx), [aaatmy/beat-this-onnx](https://huggingface.co/aaatmy/beat-this-onnx) | ONNX exports of `final0` (about 82 MB; musetric's is 190 MB) | Yes / yes | onnxruntime-web (WebGPU or WASM) | — | MIT (model cards) | Use, or better, export `small0` ourselves |
| [mjhydri/BeatNet](https://github.com/mjhydri/BeatNet) (ISMIR 2021) | CRNN + particle filtering (online, real time); offline mode uses madmom's DBN | Yes / yes, plus meter | Python (+ madmom, PyAudio) | CC-BY-4.0 | CC-BY-4.0 (same repo) | Research (attribution is fine, but Beat This! is more accurate and simpler; real time isn't our need) |
| [CPJKU/madmom](https://github.com/CPJKU/madmom) | RNN/TCN activations + DBN (Böck et al.) | Yes / yes | Python (unmaintained on modern numpy) | BSD-style | **CC BY-NC-SA 4.0** for all model/data files (LICENSE) | **Avoid** the models; the DBN algorithm itself is fine to learn from |
| [mir-aidj/all-in-one](https://github.com/mir-aidj/all-in-one) | Demucs stems + neighbourhood-attention transformer | Beats, downbeats, **sections** (intro/verse/chorus...) | GPU | MIT | `taejunkim/allinone`: MIT | **Call as service** (v3) for song structure |
| [MTG/essentia.js](https://github.com/MTG/essentia.js) | Essentia's DSP rhythm extractors in WASM | Yes / limited | Browser | **AGPL-3.0** | (Essentia's TF models carry their own terms) | **Avoid** |
| [aubio/aubio](https://github.com/aubio/aubio) | Onset + tempo DSP | Beats | C / Python / WASM ports | **GPL-3.0** (COPYING) | none | **Avoid** in the bundle |
| [hendriks73/tempo-cnn](https://github.com/hendriks73/tempo-cnn) | CNN tempo estimation | Tempo only | Python | **AGPL-3.0** | — | Avoid |
| [chrisguttandin/web-audio-beat-detector](https://github.com/chrisguttandin/web-audio-beat-detector) | Peak-interval tempo guess in the browser | Tempo and offset only | Browser | MIT | none | Research (too coarse for cutting) |
| [meyda/meyda](https://github.com/meyda/meyda) | Audio feature extraction | — | Browser | MIT | — | Not needed |
| [craffel/mir_eval](https://github.com/craffel/mir_eval) | Standard beat metrics (F-measure, CMLt, AMLt) | — | Python | MIT | — | **Use directly** in tests |
| [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) (onnxruntime-web) | Inference runtime | — | Browser | MIT | — | **Use directly** |

---

## 3. Accuracy evidence

Metrics: **F-measure** counts a detected beat as correct within +/-70 ms of an annotation. **CMLt** requires the correct metrical level and continuity. **AMLt** also accepts double/half tempo and off-beat. GTZAN is the usual held-out test set (Beat This!'s `final*` and `small*` models were trained on everything except GTZAN, so their GTZAN numbers are fair).

**Neural trackers on GTZAN** (Beat This! paper, Table 2, [arXiv 2407.21658](https://arxiv.org/abs/2407.21658); mean +/- std over 3 seeds):

| System | Beat F1 | Beat CMLt | Beat AMLt | Downbeat F1 | Downbeat CMLt | Downbeat AMLt |
| --- | --- | --- | --- | --- | --- | --- |
| Beat This!, main model (~20M params) | 89.1 +/- 0.3 | 79.8 | 89.8 | **78.3** +/- 0.4 | 67.3 | 79.1 |
| Beat This!, small model (~2M params, `small0..2`, about 8.1 MB each) | 88.8 +/- 0.2 | 79.4 | 89.0 | 77.2 +/- 0.2 | 65.3 | 78.0 |
| Beat This! with madmom's DBN | 88.1 | 80.5 | 91.1 | 77.4 | 73.3 | 87.8 |
| Hung et al. 2022 (from their paper) | 88.7 | 81.2 | 92.0 | 75.6 | 71.5 | 88.1 |

**Older neural and DSP baselines** (as reported in later papers):

| System | Dataset | Beat F | Downbeat F | Source |
| --- | --- | --- | --- | --- |
| Spectral TCN (Böck and Davies 2020) | GTZAN | 0.885 | 0.672 | [WaveBeat](https://arxiv.org/abs/2110.01436), Table 1 |
| Multi-model RNN (Böck et al. 2014, madmom) | GTZAN / SMC / Ballroom | 0.864 / 0.529 / 0.910 | — | [Self-supervised beat tracking](https://arxiv.org/abs/2201.01771), Table 2 |
| **Spectral-difference DSP tracker** (Davies and Plumbley) | GTZAN / SMC | **0.806 / 0.337** | **0.462** | same, Table 2 |

**What this means for us.** Our numpy/JS tracker belongs to the same DSP family as the Davies-Plumbley and Ellis trackers (handcrafted onset function, autocorrelation tempo, dynamic programming). The closest published proxy puts that family around **0.80 beat F on GTZAN** and **0.34 on SMC** (expressive, rubato material), with **downbeat F around 0.46**; Beat This! is around **0.89 and 0.78**. So:

- For steady pop, hip-hop and EDM (most songs people cut videos to), the DSP tracker will usually be fine for beats.
- Downbeats are where it is weakest: a heuristic phase pick under a fixed 4/4 assumption. Cutting on the bar is what makes a Film edit feel right, so this is the main reason to add Beat This!.
- Continuity matters for editing (one skipped beat shifts every later cut): the DBN row shows a tempo-constrained post-processor raises CMLt/AMLt even when F1 drops slightly. Our existing DP does the same job (see the hybrid below).

These are proxies, not measurements of our port. Section 5 adds our own measurement.

---

## 4. Our design

### One result format, three engines

Every engine returns the `beats.py` shape plus an `engine` field, so Film, Video and Audio never care which one ran:

```json
{
  "version": 2, "engine": "dsp|beatthis-small|beatthis-final|allinone",
  "bpm": 123.98, "beats": [0.512, 0.996, "..."], "downbeats": [0.512, 2.448, "..."],
  "bars": 96, "beatsPerBar": 4, "first": 0.512, "duration": 186.4, "confidence": 0.83,
  "sections": [{ "start": 0.0, "end": 15.6, "label": "intro" }]
}
```

`sections` is present only from the GPU engine. Results are cached in IndexedDB keyed by the SHA-256 of the decoded mono PCM plus engine and version, the browser equivalent of `beats.py`'s sidecar file.

| Engine | When | Cost | Speed (expected, to be measured) |
| --- | --- | --- | --- |
| **DSP** (JS port of `beats.py`) | Always available; instant first answer | $0, no download | Well under a second for a 3-minute song in a Worker (one 1,024-point FFT per 256 samples) |
| **Beat This! small** (ONNX, `small0`) | Default once shipped, when WebGPU or WASM is available | $0, about 8 MB download (fp32; about 4 MB in fp16), cached | One 30 s window per call; WASM is much slower than WebGPU (musetric reports about 12x for `final0` with identical results), but the small model is 10x smaller |
| **all-in-one** (GPU worker) | On request: "find the drop / chorus" | About 15-40 s warm on the 24 GB tier for a 4-minute song (estimate), so about $0.003-0.008 at $0.75/h, plus any cold start | Seconds plus queue |

### Beat This! in the browser: the contract

The network expects exactly this input (from the paper and the ONNX model cards; get any of it wrong and beats move):

- Mono at 22,050 Hz, channels **averaged** (not ffmpeg's energy-preserving `-ac 1`, which comes out about sqrt(2) louder and shifts the log features).
- STFT: `n_fft` 1,024, hop 441 (50 frames/s), periodic Hann, centred with reflect padding, magnitude divided by sqrt(1024).
- 128 mel bins from 30 Hz to 10 kHz (filterbank shipped as a small binary next to the model), then `log1p(1000 * x)`.
- Windows of 1,500 frames (30 s) with 6-frame borders, the last window shifted to end at the song's end; overlapping predictions keep the first window's values.
- Post-processing: a frame is a beat if its logit is above 0 and it is the maximum within +/-3 frames; adjacent peaks merge; each downbeat snaps to the nearest beat.

We compute the log-mel in JS (or with tuneperfect's 4.5 MB `logmel.onnx`), run the network with onnxruntime-web (WebGPU first, WASM fallback), and derive `bpm` by a straight-line fit of beat times, `beatsPerBar` from the median number of beats between downbeats (3 or 4), and `confidence` from the mean peak logit. We export `small0` to ONNX ourselves from the MIT checkpoint, pin its SHA-256 the way `extract-worker.js` pins LAME, and load it from our own origin or jsDelivr.

### Hybrid: neural activations, steady grid

For editing, a stable grid beats a few perfectly placed but discontinuous beats. Optional "steady grid" mode feeds Beat This!'s beat probabilities (sigmoid of the logits) into the ported Ellis DP as its onset envelope, with the tempo taken from the network's own beats. This keeps the neural model's accuracy and adds the continuity a DBN gives, using code we already have. Same for downbeats: choose the downbeat phase that maximizes the summed downbeat probability over the whole song instead of the low-band heuristic.

### Where it plugs in

| Page | Use |
| --- | --- |
| **Film** | "Use my song": the beat sheet's blocks are laid on the song's beats and bars instead of a fixed `bpm`; the drop block lands on a downbeat (or on the GPU engine's chorus/drop section); the in-browser score is skipped. |
| **Video storyboard** | "Cut to the beat": add a music bed, snap each shot's duration to whole bars (or beats), and start camera moves on downbeats. |
| **Audio** | BPM and bar count in the Master tab report; beat-locked fades in Extract. |
| **Edit** (Descript-style page) | Duck a music bed under speech; place B-roll cuts on beats. |
| **Games** | Rhythm mechanics from a visitor's song. |

---

## 5. Measuring it ourselves

Add `tests/beats_eval.py` (mir_eval, MIT) and a JS harness that runs the engines headlessly on:

1. **Synthetic** (committed, generated in the test): click tracks at 60-200 BPM, with tempo ramps, swing, a pickup bar, 3/4 and 6/8, added noise and reverb. Pass bar: tempo within 1%, beat F above 0.95, correct downbeat phase for 4/4 and 3/4.
2. **Parity**: the JS DSP port against reference JSON produced once from the reviewed Python original (committed fixtures; beat times within 1 ms, BPM within 0.01).
3. **Real music, local only**: GTZAN (with the publicly shared beat annotations) or any set the maintainer owns, never committed (audio copyright). Report F, CMLt, AMLt for beats and downbeats per engine, so the table in section 3 gets a "Massless DSP" and "Massless Beat This! small (ONNX)" row measured by us.
4. **CC-licensed songs** (5-10, committed with attribution, beats hand-annotated by tapping and correcting): a small regression set that runs in CI.

---

## 6. Phased plan

| Phase | Scope | Effort | Cost |
| --- | --- | --- | --- |
| **v1** (now) | Finish the JS port in a Web Worker; result cache; parity and synthetic tests; Film "use my song" and storyboard "cut to the beat"; credits per the NOTICE | 1-2 days (port already under way) | $0 |
| **v2** | Export `small0` to ONNX, JS log-mel matching the contract, onnxruntime-web WebGPU/WASM, steady-grid hybrid, automatic engine choice (DSP first, then Beat This! replaces it when ready), mir_eval harness with local GTZAN numbers | 1-2 days | $0, about 8 MB one-time download per visitor |
| **v3** | all-in-one GPU job for sections and the drop; meter changes and tempo maps (piecewise tempo from beat intervals) for live recordings | 2-3 days | about $0.003-0.008 per song (estimate), within the daily GPU budget |

### Risks

- **WebGPU numerics.** musetric documents silently wrong fp32 logits from onnxruntime's WebGPU backend on mobile Adreno GPUs for one graph; verify the output against the WASM backend on a short probe window at load and fall back to WASM (or DSP) when they disagree.
- **Feature contract drift.** Any mismatch in resampling, downmix or STFT details moves beats; test our JS log-mel against the reference log-mel on fixed inputs.
- **Download size and memory.** Keep `final0` (80-190 MB) out of the default path; small model only.
- **Non-4/4, rubato, tempo changes.** The DSP engine assumes constant tempo and 4/4; label its results "steady tempo" and prefer Beat This! when available.
- **Training-data provenance.** Beat This!'s weights are MIT but its authors note some training audio is copyrighted; the output (beat times) is not a copy of anything, so the practical risk is low, but say where the model comes from in the credits.
- **Attribution.** Keep the Imagination Studio NOTICE and credits wherever the port ships.
