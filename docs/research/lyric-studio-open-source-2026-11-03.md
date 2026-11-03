# Lyric Studio: open-source review and improvements

Date: 3 November 2026

## What we tested

We made an original 48-second test song with ACE-Step 1.5 XL Turbo (open source, on Comfy Cloud). It has sung vocals and a 22-second instrumental ending. The song went through the live studio, and we kept the real Whisper large-v3-turbo responses, with and without typed lyrics as a prompt.

Problems found in the live version:

- **Misheard words, even on a clean mix.** "Drop your song in" came back as "Draw your song in", and "Chuck S.I. makes the lyrics breezy" as "Chug this time as the lyrics breezy".
- **Orphaned words.** Splitting every 7 words left "go" alone for 0.6 s.
- **Invented lines over the instrumental.** One run added "I love you" and held it for 22 s. Another added "We'll be right back." These are well-known Whisper inventions.
- **Prompting changes segmentation.** With typed lyrics as the prompt, Whisper returned almost the whole song as one 46-word segment.
- **Word times were unused.** Whisper's per-word times were kept but never drawn.
- **Export failed in some browsers.** Browsers without an AAC encoder (Chromium on Linux) could not export at all.

## Open-source projects reviewed

Licences were checked against each project's own LICENSE file or model card.

| Project | Licence | Used for | Decision |
|---|---|---|---|
| stable-ts `align()` and regroup presets ([github](https://github.com/jianfch/stable-ts)) | MIT | Matching typed lyrics to heard words; breaking lines at 0.5 s pauses and punctuation | Idea ported to JS |
| WhisperX ([github](https://github.com/m-bain/whisperX)) and karaoke-gen anchor sequences ([github](https://github.com/nomadkaraoke/karaoke-gen)) | BSD-2, MIT | Trust typed words, borrow heard timing | Idea ported |
| faster-whisper word anomaly score ([github](https://github.com/SYSTRAN/faster-whisper)) | MIT | Flags words squeezed under 0.133 s or stretched past 2 s, when surrounded by silence | Ported (without the probability term, which Workers AI doesn't return) |
| Bag of Hallucinations, ICASSP 2025 ([github](https://github.com/DSP-AGH/ICASSP2025_Whisper_Hallucination)) | MIT | Most frequent invented phrases | Phrase list |
| Mediabunny ([github](https://github.com/Vanilagy/mediabunny)) | MPL-2.0 | Successor to the deprecated mp4-muxer | Later: mp4-muxer still works |
| web-audio-beat-detector ([github](https://github.com/chrisguttandin/web-audio-beat-detector)) | MIT | Tempo and offset | Not needed: a 20-line autocorrelation on the existing band analysis gets 118.0 BPM on the 118 BPM test song |
| Beat This! small ONNX ([hf](https://huggingface.co/jenila-ai/beat-this-small0-onnx)) | MIT | Downbeats, bar-aware motion | Later (10 MB) |
| htdemucs web ONNX ([hf](https://huggingface.co/monteslu/htdemucs-web-onnx)) | MIT | Vocal stem before transcription | Later, as an opt-in: 126 MB download |
| w2v-bert-2.0 music lyrics CTC ([hf](https://huggingface.co/mrfakename/w2v-bert-2.0-music-lyrics-ctc)) | MIT | Real audio forced alignment for singing | Watch: 2.3 GB, no ONNX build yet |
| MMS forced aligner | Weights CC-BY-NC | Speech alignment | Skip: non-commercial |
| whisper-timestamped, essentia.js, aubio, AMLL | AGPL/GPL | — | Skip: licence |

## What shipped

1. **Add your lyrics, keep the timing.**
   - Lyrics can be typed before upload, or pasted in the editor after transcription.
   - A word-level global alignment (Needleman–Wunsch, edit-distance similarity) gives every typed word the time of the word Whisper heard.
   - Unmatched words are spread between their timed neighbours by character length.
   - Section labels such as `[Chorus]` are ignored.
   - On the real responses, 94–96% of typed words matched, and every line landed within the sung phrase.
2. **Lyrics as a hint.** Typed lyrics (up to 240 characters) are sent as Whisper's prompt, which fixed "the groove" → "your groove".
3. **Natural line breaks.**
   - Each Whisper segment becomes one line.
   - A merged segment is cut at phrase starts: a pause of 0.5 s or more, sentence punctuation, or a capitalised word.
   - Long lines are split into balanced halves, at a comma when there is one, so no line is left with one orphaned word.
4. **Invented lines removed.** Lines are dropped when any of these apply:
   - they match the phrase list;
   - they have low confidence with no speech;
   - they repeat in a loop (compression ratio above 2.4);
   - their timing is anomalous and there is silence on both sides.

   Words are also never held for more than 2.5 s.
5. **Word-by-word highlight.** The highlight appears in all six looks whenever real per-word timing exists. Upcoming words wait at 34% opacity.
6. **Beat pulse.**
   - Words kick slightly on the beat.
   - The tempo is refined to fractions of a frame so the pulse doesn't drift.
   - The pulse is off when Movement is set to still type.
7. **Export fallback.** Export falls back to VP9/Opus in MP4 when H.264 or AAC encoding is unavailable. Tested: H.264 + Opus export from headless Chromium decodes fully with ffmpeg.

## Still to validate

- Accuracy across more songs, genres and languages (one song is a smoke test, not a benchmark).
- Whether Workers AI's `hallucination_silence_threshold` helps on singing.
- Vocal separation as an optional accuracy boost.
