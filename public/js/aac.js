// Sound that survives every browser.
//
// Safari's AAC AudioEncoder hands back a broken decoder description (WebKit bug 302253:
// object type 0, 22050 Hz, no channels). Muxed as is, the MP4 plays with a silent soundtrack.
// For AAC-LC the description is just two bytes (the AudioSpecificConfig, ISO 14496-3), so we write
// them ourselves on every exporter. Chrome's own bytes are identical, so nothing changes there.
// If an encoder ever returns ADTS-framed chunks, the 7 or 9 byte headers are removed too.

const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

export function aacDescription(sampleRate, channels) {
  const index = RATES.indexOf(Number(sampleRate));
  const ch = Number(channels);
  if (index < 0 || !(ch >= 1 && ch <= 7)) return null;
  // 5 bits object type (2 = AAC LC), 4 bits frequency index, 4 bits channel configuration, 3 zero bits.
  return new Uint8Array([(2 << 3) | (index >> 1), ((index & 1) << 7) | (ch << 3)]);
}

const isAac = (codec) => /^mp4a\.40\.2$/i.test(String(codec || '')) || codec === 'aac';

function stripAdts(chunk) {
  if (typeof EncodedAudioChunk === 'undefined' || !chunk?.byteLength || chunk.byteLength < 9) return chunk;
  const bytes = new Uint8Array(chunk.byteLength);
  chunk.copyTo(bytes);
  if (bytes[0] !== 0xff || (bytes[1] & 0xf6) !== 0xf0) return chunk;
  const header = bytes[1] & 1 ? 7 : 9;
  return new EncodedAudioChunk({ type: chunk.type, timestamp: chunk.timestamp, duration: chunk.duration ?? undefined, data: bytes.subarray(header) });
}

// Returns an encoder output callback that feeds `muxer` with corrected AAC metadata.
// config is the AudioEncoder config ({ codec, sampleRate, numberOfChannels }).
export function audioSink(muxer, config) {
  if (!isAac(config?.codec)) return (chunk, meta) => muxer.addAudioChunk(chunk, meta);
  const description = aacDescription(config.sampleRate, config.numberOfChannels);
  let first = true;
  return (chunk, meta) => {
    const fixed = stripAdts(chunk);
    if (description && (first || meta?.decoderConfig)) {
      meta = { ...(meta || {}), decoderConfig: { ...(meta?.decoderConfig || {}), codec: 'mp4a.40.2', sampleRate: config.sampleRate, numberOfChannels: config.numberOfChannels, description } };
    }
    first = false;
    muxer.addAudioChunk(fixed, meta);
  };
}

// After an export: does the file's soundtrack actually play back in this browser?
// Returns 'ok', 'silent' (decodes but holds no sound) or 'unknown' (couldn't check).
export async function soundCheck(blob, { expectSound = true } = {}) {
  if (!expectSound || typeof OfflineAudioContext === 'undefined') return 'unknown';
  if (!blob || blob.size > 400 * 1024 * 1024) return 'unknown';
  let audio;
  try {
    audio = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
  } catch {
    return 'unknown'; // some browsers can't decode MP4 here at all; that isn't proof of silence
  }
  {
    let peak = 0;
    for (let c = 0; c < audio.numberOfChannels; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < d.length; i += 97) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
    }
    return peak > 0.001 ? 'ok' : 'silent';
  }
}

// Does a source actually hold sound? Saves a false alarm when the song itself is silent.
export function hasSound(channels) {
  for (const d of channels || []) for (let i = 0; i < d.length; i += 97) if (Math.abs(d[i]) > 0.001) return true;
  return false;
}
