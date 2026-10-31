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
  const video = {
    codec: "avc1.42001f",
    width: canvas.width,
    height: canvas.height,
    framerate: fps,
    bitrate: 4000000,
    avc: { format: "avc" },
  };
  const audio = {
    codec: "mp4a.40.2",
    numberOfChannels: 2,
    sampleRate: score.sampleRate,
    bitrate: 192000,
  };
  if (
    !(await VideoEncoder.isConfigSupported(video)).supported ||
    !(await AudioEncoder.isConfigSupported(audio)).supported
  )
    throw new Error(
      "H.264/AAC export is unavailable in this browser. Try desktop Chrome.",
    );
  const { Muxer, ArrayBufferTarget } = await import("./vendor/mp4-muxer.mjs");
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: "avc",
      width: canvas.width,
      height: canvas.height,
      frameRate: fps,
    },
    audio: { codec: "aac", sampleRate: score.sampleRate, numberOfChannels: 2 },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let failure;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = e;
    },
  });
  const aenc = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
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
      if (aenc.encodeQueueSize > 20) await aenc.flush();
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
