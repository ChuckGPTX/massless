// Export a camera move as video.
// Preferred: WebCodecs H.264 + MP4 muxing, rendered frame by frame (exact timing, faster than real time).
// Fallback: MediaRecorder on the canvas stream in real time (WebM or MP4, whatever the browser offers).

const AVC_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.42001f'];

// Yield to the event loop without timers or animation frames, which Chrome throttles in background tabs.
const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
function yieldTask() {
  if (!channel) return new Promise((r) => setTimeout(r, 0));
  return new Promise((r) => {
    channel.port1.onmessage = () => r();
    channel.port2.postMessage(0);
  });
}

async function pickAvc(width, height, fps) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of AVC_CODECS) {
    try {
      const cfg = { codec, width, height, bitrate: 10_000_000, framerate: fps, avc: { format: 'avc' } };
      const s = await VideoEncoder.isConfigSupported(cfg);
      if (s.supported) return cfg;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Record one or more segments back to back into a single clip.
 * segments: [{ duration, enter?: async () => void, draw(t, timeSec) }]
 * onProgress(fraction). Returns { blob, ext, mime }.
 */
export async function recordSegments(canvas, { segments, fps = 24, onProgress = () => {}, signal }) {
  const width = canvas.width;
  const height = canvas.height;
  const counts = segments.map((s) => Math.max(2, Math.round(s.duration * fps)));
  const total = counts.reduce((a, b) => a + b, 0);
  const cfg = await pickAvc(width, height, fps);

  if (cfg) {
    const { Muxer, ArrayBufferTarget } = await import('./vendor/mp4-muxer.mjs');
    const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' });
    let encodeError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { encodeError = e; },
    });
    encoder.configure(cfg);
    let n = 0;
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s];
      if (seg.enter) await seg.enter();
      const frames = counts[s];
      for (let i = 0; i < frames; i++) {
        if (signal?.aborted) { encoder.close(); throw new Error('Cancelled'); }
        if (encodeError) throw encodeError;
        seg.draw(i / (frames - 1), i / fps);
        const frame = new VideoFrame(canvas, { timestamp: Math.round((n * 1e6) / fps), duration: Math.round(1e6 / fps) });
        encoder.encode(frame, { keyFrame: i === 0 || i % (fps * 2) === 0 });
        frame.close();
        n++;
        while (encoder.encodeQueueSize > 6) await yieldTask();
        if (n % 4 === 0) {
          onProgress(n / total);
          await yieldTask();
        }
      }
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
    onProgress(1);
    return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4', mime: 'video/mp4' };
  }

  // Real-time fallback
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) throw new Error('This browser cannot record video. Save frames instead.');
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 10_000_000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start();
  const totalDur = segments.reduce((a, s) => a + s.duration, 0);
  let elapsedBefore = 0;
  for (const seg of segments) {
    if (seg.enter) await seg.enter();
    const start = performance.now();
    await new Promise((resolve, reject) => {
      const step = (now) => {
        if (signal?.aborted) { rec.stop(); reject(new Error('Cancelled')); return; }
        const el = (now - start) / 1000;
        const t = Math.min(1, el / seg.duration);
        seg.draw(t, el);
        onProgress((elapsedBefore + Math.min(el, seg.duration)) / totalDur);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    elapsedBefore += seg.duration;
  }
  await new Promise((r) => setTimeout(r, 120));
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  const type = rec.mimeType || mime || 'video/webm';
  return { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm', mime: type };
}

/** One camera move as a clip. draw(t, timeSec) renders a frame onto `canvas`. */
export function recordMove(canvas, { duration, fps = 24, draw, onProgress, signal }) {
  return recordSegments(canvas, { segments: [{ duration, draw }], fps, onProgress, signal });
}
