import test from 'node:test';
import assert from 'node:assert/strict';
import { exportMusic } from '../public/js/music-export.js';

// Exercise encoder backpressure and failure cleanup; actual codecs are verified
// separately with browser exports and a complete ffmpeg decode.
function codecs(t, failAudio = false) {
  const created = [];
  class Chunk {
    constructor(timestamp, duration) { this.timestamp = timestamp; this.duration = duration; this.type = 'key'; this.byteLength = 1; }
    copyTo(target) { target[0] = 0; }
  }
  class Frame {
    constructor(source, options) { Object.assign(this, options || source); }
    close() {}
  }
  class Encoder {
    static async isConfigSupported() { return { supported: true }; }
    constructor(callbacks) { this.callbacks = callbacks; this.encodeQueueSize = 0; this.flushes = 0; this.state = 'unconfigured'; created.push(this); }
    configure(config) { this.config = config; this.state = 'configured'; }
    encode(frame) {
      this.encodeQueueSize++;
      queueMicrotask(() => {
        const isAudio = this.config.codec === 'mp4a.40.2';
        this.callbacks.output(new Chunk(isAudio && failAudio ? -1 : frame.timestamp, frame.duration || Math.round(frame.numberOfFrames / frame.sampleRate * 1e6)), { decoderConfig: { codec: this.config.codec, description: new Uint8Array([1, 66, 0, 31]) } });
        this.encodeQueueSize--;
      });
    }
    async flush() { this.flushes++; await Promise.resolve(); }
    close() { this.state = 'closed'; }
  }
  for (const [name, value] of Object.entries({ VideoEncoder: Encoder, AudioEncoder: Encoder, VideoFrame: Frame, AudioData: Frame, EncodedVideoChunk: Chunk, EncodedAudioChunk: Chunk })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  return created;
}
const input = () => ({ canvas: { width: 1280, height: 720 }, draw() {}, score: { sampleRate: 48000, channels: [new Float32Array(48000 * 3)] }, duration: 3 });

test('audio backpressure keeps one continuous stream and closes encoders', async t => {
  const created = codecs(t);
  const result = await exportMusic(input());
  assert.equal(result.type, 'video/mp4');
  assert(result.size > 100);
  assert.equal(created.find(e => e.config.codec === 'mp4a.40.2').flushes, 1);
  assert(created.every(e => e.state === 'closed'));
});

test('muxer errors reject the export instead of reporting a damaged download as ready', async t => {
  const created = codecs(t, true);
  await assert.rejects(exportMusic(input()), /non-negative|timestamp/i);
  assert(created.every(e => e.state === 'closed'));
});

test('cancelled export closes both encoders and returns no download', async t => {
  const created = codecs(t), controller = new AbortController();
  await assert.rejects(exportMusic({ ...input(), signal: controller.signal, onProgress() { controller.abort(); } }), /cancelled/);
  assert(created.every(e => e.state === 'closed'));
});
