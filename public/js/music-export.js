// Offline MP4 encoding with the same local muxer used by Launch Film.
export async function exportMusic({
  canvas,
  draw,
  score,
  duration,
  onProgress,
  signal,
}) {
  if (
    typeof VideoEncoder === "undefined" ||
    typeof AudioEncoder === "undefined"
  )
    throw new Error(
      "MP4 export needs a browser with WebCodecs audio and video support. Try desktop Chrome.",
    );
  const fps = 24;
  // H.264 + AAC plays everywhere. Browsers without an H.264 encoder (Chromium on Linux, for one)
  // fall back to VP9 + Opus in the same MP4 container instead of failing.
  const videos = [
    { mux: "avc", config: { codec: "avc1.42001f", avc: { format: "avc" } } },
    { mux: "vp9", config: { codec: "vp09.00.31.08" } },
  ].map((v) => ({ ...v, config: { ...v.config, width: canvas.width, height: canvas.height, framerate: fps, bitrate: 4000000 } }));
  const audios = [
    { mux: "aac", config: { codec: "mp4a.40.2" } },
    { mux: "opus", config: { codec: "opus" } },
  ].map((a) => ({ ...a, config: { ...a.config, numberOfChannels: 2, sampleRate: score.sampleRate, bitrate: 192000 } }));
  const pick = async (list, Encoder) => { for (const item of list) if ((await Encoder.isConfigSupported(item.config)).supported) return item; return null; };
  const chosenVideo = await pick(videos, VideoEncoder), chosenAudio = await pick(audios, AudioEncoder);
  if (!chosenVideo || !chosenAudio)
    throw new Error(
      "Video export is unavailable in this browser. Try desktop Chrome.",
    );
  const video = chosenVideo.config, audio = chosenAudio.config;
  const { Muxer, ArrayBufferTarget } = await import("./vendor/mp4-muxer.mjs");
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: chosenVideo.mux,
      width: canvas.width,
      height: canvas.height,
      frameRate: fps,
    },
    audio: { codec: chosenAudio.mux, sampleRate: score.sampleRate, numberOfChannels: 2 },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let failure;
  const venc = new VideoEncoder({
    output: (chunk, meta) => {
      try { muxer.addVideoChunk(chunk, meta); } catch (e) { failure = e; }
    },
    error: (e) => {
      failure = e;
    },
  });
  const aenc = new AudioEncoder({
    output: (chunk, meta) => {
      try { muxer.addAudioChunk(chunk, meta); } catch (e) { failure = e; }
    },
    error: (e) => {
      failure = e;
    },
  });
  const check = () => {
    if (failure) throw failure;
    if (signal?.aborted) throw new Error("Export cancelled.");
  };
  try {
    venc.configure(video);
    aenc.configure(audio);
    const sr = score.sampleRate,
      length = Math.min(score.channels[0].length, Math.floor(duration * sr));
    for (let i = 0; i < length; i += 4096) {
      check();
      const n = Math.min(4096, length - i),
        data = new Float32Array(n * 2);
      data.set(score.channels[0].subarray(i, i + n));
      data.set((score.channels[1] || score.channels[0]).subarray(i, i + n), n);
      const frame = new AudioData({
        format: "f32-planar",
        sampleRate: sr,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round((i / sr) * 1e6),
        data,
      });
      try {
        aenc.encode(frame);
      } finally {
        frame.close();
      }
      // Keep one continuous AAC stream. Mid-track flushes can insert encoder
      // padding at every batch boundary and produce duplicate audio timestamps.
      while (aenc.encodeQueueSize > 20) {
        check();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    for (let i = 0, total = Math.ceil(duration * fps); i < total; i++) {
      check();
      draw(canvas, i / fps);
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((i / fps) * 1e6),
        duration: Math.round(1e6 / fps),
      });
      try {
        venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      } finally {
        frame.close();
      }
      if (i % 12 === 0) {
        onProgress?.(i / total);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (venc.encodeQueueSize > 12) await venc.flush();
    }
    await Promise.all([venc.flush(), aenc.flush()]);
    check();
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    if (venc.state !== "closed") venc.close();
    if (aenc.state !== "closed") aenc.close();
  }
}
