// HT-Demucs pre- and post-processing from demucs-web 1.0.2 (MIT, timcsy, https://github.com/timcsy/demucs-web).
// The STFT input the model expects and the iSTFT of its frequency branch, taken unchanged from src/processor.js;
// the constants from src/constants.js. The session, segmenting and overlap-add live in /js/mix/split-worker.js.
import { stft, istft, reflectPad } from './fft.js';

export const CONSTANTS = {
  SAMPLE_RATE: 44100,
  FFT_SIZE: 4096,
  HOP_SIZE: 1024,
  TRAINING_SAMPLES: 343980,
  MODEL_SPEC_BINS: 2048,
  MODEL_SPEC_FRAMES: 336,
  SEGMENT_OVERLAP: 0.25,
  TRACKS: ['drums', 'bass', 'other', 'vocals']
};

const { FFT_SIZE, HOP_SIZE, TRAINING_SAMPLES, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES } = CONSTANTS;

/**
 * Convert model frequency output to complex spectrogram per track
 */
export function standaloneMask(freqOutput) {
  const numTracks = 4;
  const numChannels = 4;
  const numBins = MODEL_SPEC_BINS;
  const numFrames = MODEL_SPEC_FRAMES;
  const result = [];

  for (let t = 0; t < numTracks; t++) {
    const trackSpec = {
      leftReal: new Float32Array(numBins * numFrames),
      leftImag: new Float32Array(numBins * numFrames),
      rightReal: new Float32Array(numBins * numFrames),
      rightImag: new Float32Array(numBins * numFrames)
    };

    for (let f = 0; f < numFrames; f++) {
      for (let b = 0; b < numBins; b++) {
        const baseIdx = t * numChannels * numBins * numFrames;
        const outIdx = b * numFrames + f;
        trackSpec.leftReal[outIdx] = freqOutput[baseIdx + 0 * numBins * numFrames + b * numFrames + f];
        trackSpec.leftImag[outIdx] = freqOutput[baseIdx + 1 * numBins * numFrames + b * numFrames + f];
        trackSpec.rightReal[outIdx] = freqOutput[baseIdx + 2 * numBins * numFrames + b * numFrames + f];
        trackSpec.rightImag[outIdx] = freqOutput[baseIdx + 3 * numBins * numFrames + b * numFrames + f];
      }
    }
    result.push(trackSpec);
  }

  return result;
}

/**
 * Convert complex spectrogram back to time domain (iSTFT with proper offsets)
 */
export function standaloneIspec(trackSpec, targetLength) {
  const numBins = MODEL_SPEC_BINS;
  const numFrames = MODEL_SPEC_FRAMES;
  const hopLength = HOP_SIZE;
  const paddedBins = numBins + 1;
  const paddedFrames = numFrames + 4;

  const padChannel = (real, imag) => {
    const paddedReal = new Float32Array(paddedFrames * paddedBins);
    const paddedImag = new Float32Array(paddedFrames * paddedBins);

    for (let f = 0; f < numFrames; f++) {
      for (let b = 0; b < numBins; b++) {
        const srcIdx = b * numFrames + f;
        const dstFrame = f + 2;
        const dstIdx = dstFrame * paddedBins + b;
        paddedReal[dstIdx] = real[srcIdx];
        paddedImag[dstIdx] = imag[srcIdx];
      }
    }
    return { real: paddedReal, imag: paddedImag };
  };

  const leftPadded = padChannel(trackSpec.leftReal, trackSpec.leftImag);
  const rightPadded = padChannel(trackSpec.rightReal, trackSpec.rightImag);

  const centerPad = FFT_SIZE / 2;
  const pad = Math.floor(hopLength / 2) * 3;
  const istftLength = (paddedFrames - 1) * hopLength + FFT_SIZE;

  const leftOut = istft(leftPadded.real, leftPadded.imag, paddedFrames, paddedBins, FFT_SIZE, hopLength, istftLength);
  const rightOut = istft(rightPadded.real, rightPadded.imag, paddedFrames, paddedBins, FFT_SIZE, hopLength, istftLength);

  const totalOffset = centerPad + pad;
  const left = leftOut.subarray(totalOffset, totalOffset + targetLength);
  const right = rightOut.subarray(totalOffset, totalOffset + targetLength);

  return { left: new Float32Array(left), right: new Float32Array(right) };
}

/**
 * Prepare model input from stereo audio
 */
export function prepareModelInput(leftChannel, rightChannel) {
  const inputLength = TRAINING_SAMPLES;

  const paddedLeft = new Float32Array(inputLength);
  const paddedRight = new Float32Array(inputLength);
  const copyLen = Math.min(leftChannel.length, inputLength);
  paddedLeft.set(leftChannel.subarray(0, copyLen));
  paddedRight.set(rightChannel.subarray(0, copyLen));

  const le = Math.ceil(inputLength / HOP_SIZE);
  const pad = Math.floor(HOP_SIZE / 2) * 3;
  const padRight = pad + le * HOP_SIZE - inputLength;

  const stftInputLeft = reflectPad(paddedLeft, pad, padRight);
  const stftInputRight = reflectPad(paddedRight, pad, padRight);

  const centerPad = FFT_SIZE / 2;
  const centeredLeft = reflectPad(stftInputLeft, centerPad, centerPad);
  const centeredRight = reflectPad(stftInputRight, centerPad, centerPad);

  const stftLeft = stft(centeredLeft, FFT_SIZE, HOP_SIZE);
  const stftRight = stft(centeredRight, FFT_SIZE, HOP_SIZE);

  const numBins = MODEL_SPEC_BINS;
  const numFrames = MODEL_SPEC_FRAMES;
  const frameOffset = 2;

  const magSpec = new Float32Array(4 * numBins * numFrames);

  for (let f = 0; f < numFrames; f++) {
    const srcFrame = f + frameOffset;
    for (let b = 0; b < numBins; b++) {
      const srcIdx = srcFrame * stftLeft.numBins + b;
      magSpec[0 * numBins * numFrames + b * numFrames + f] = stftLeft.real[srcIdx];
      magSpec[1 * numBins * numFrames + b * numFrames + f] = stftLeft.imag[srcIdx];
      magSpec[2 * numBins * numFrames + b * numFrames + f] = stftRight.real[srcIdx];
      magSpec[3 * numBins * numFrames + b * numFrames + f] = stftRight.imag[srcIdx];
    }
  }

  const waveform = new Float32Array(2 * inputLength);
  waveform.set(paddedLeft, 0);
  waveform.set(paddedRight, inputLength);

  return { waveform, magSpec, numBins, numFrames, originalLength: leftChannel.length };
}

