import * as T from "../transcribe.js";
import { parseCaptions, activeCaption, validateTrim } from "../captions.js";
import { retainExport, selectedAsset, downloadBlob } from "../assets.js";
const $ = (s) => document.querySelector(s),
  video = $("#source"),
  canvas = $("#caption-canvas"),
  ctx = canvas.getContext("2d");
let cues = [],
  sourceId,
  url,
  raf,
  controller,
  audioContext,
  audioSource,
  recording = false;
const message = (t) => ($("#status").textContent = t);
function draw() {
  if (video.readyState >= 2)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const text = activeCaption(cues, video.currentTime);
  if (!text) return;
  const size = (canvas.width * Number($("#size").value)) / 100;
  ctx.font = `700 ${size}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const words = text.split(/\s+/),
    lines = [];
  let line = "";
  for (const word of words) {
    if (
      ctx.measureText(line + " " + word).width > canvas.width * 0.85 &&
      line
    ) {
      lines.push(line);
      line = word;
    } else line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 4),
    height = shown.length * size * 1.2 + size * 0.6,
    top = canvas.height * 0.88 - height;
  ctx.fillStyle = "rgba(0,0,0,.76)";
  ctx.fillRect(canvas.width * 0.05, top, canvas.width * 0.9, height);
  ctx.fillStyle = $("#color").value;
  shown.forEach((l, i) =>
    ctx.fillText(l, canvas.width / 2, top + size * 0.9 + i * size * 1.2),
  );
}
function preview() {
  draw();
  raf = requestAnimationFrame(preview);
}
raf = requestAnimationFrame(preview);
async function open(blob, id) {
  if (recording) return;
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(blob);
  sourceId = id;
  video.src = url;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () =>
      reject(new Error("This video format cannot be decoded here."));
  });
  const scale = Math.min(
    1,
    1280 / Math.max(video.videoWidth, video.videoHeight),
  );
  canvas.width = Math.max(2, Math.round((video.videoWidth * scale) / 2) * 2);
  canvas.height = Math.max(2, Math.round((video.videoHeight * scale) / 2) * 2);
  $("#start").value = 0;
  $("#end").value = Math.min(120, video.duration).toFixed(2);
  video.currentTime = 0;
  message(
    "Ready. Set the trim and add captions, or export a clean trimmed clip.",
  );
}
$("#file").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (f) await open(f);
  } catch (e) {
    message(e.message);
  }
};
$("#cues").oninput = () => {
  try {
    cues = parseCaptions($("#cues").value);
    message(cues.length + " caption cues ready.");
    draw();
  } catch (e) {
    message(e.message);
  }
};
$("#srt").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 500000)
      throw new Error("Choose captions smaller than 500 KB.");
    const text = await f.text();
    cues = parseCaptions(text);
    $("#cues").value = text;
    message(cues.length + " cues imported.");
  } catch (e) {
    message(e.message);
  }
};
$("#cancel").onclick = () => controller?.abort();
$("#export").onclick = async () => {
  let rec,
    stream,
    destination,
    oldTime = video.currentTime;
  try {
    if (recording) return;
    if (!video.src || !Number.isFinite(video.duration))
      throw new Error("Open a video first.");
    const trim = validateTrim(
      $("#start").value,
      $("#end").value,
      video.duration,
    );
    cues = parseCaptions($("#cues").value);
    if (!window.MediaRecorder || !canvas.captureStream)
      throw new Error(
        "Recording is unavailable in this browser. Try desktop Chrome.",
      );
    const mime = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find(
      (t) => MediaRecorder.isTypeSupported(t),
    );
    if (!mime) throw new Error("A supported video recorder is unavailable.");
    recording = true;
    controller = new AbortController();
    $("#export").disabled = true;
    $("#cancel").hidden = false;
    for (const e of document.querySelectorAll(
      ".controls input,.controls textarea,.controls select",
    ))
      e.disabled = true;
    video.controls = false;
    video.pause();
    video.currentTime = trim.start;
    await new Promise((resolve) =>
      video.seeking
        ? video.addEventListener("seeked", resolve, { once: true })
        : resolve(),
    );
    draw();
    audioContext ||= new AudioContext();
    await audioContext.resume();
    if (!audioSource) {
      audioSource = audioContext.createMediaElementSource(video);
      audioSource.connect(audioContext.destination);
    }
    destination = audioContext.createMediaStreamDestination();
    audioSource.connect(destination);
    stream = canvas.captureStream(30);
    destination.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 6000000,
    });
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise((resolve, reject) => {
      rec.onstop = resolve;
      rec.onerror = (e) => reject(e.error || new Error("Recording failed."));
    });
    rec.start(250);
    await video.play();
    await new Promise((resolve, reject) => {
      const tick = () => {
        if (controller.signal.aborted) {
          reject(new Error("Export cancelled."));
          return;
        }
        if (document.hidden) {
          reject(
            new Error(
              "Export stopped because the tab was hidden. Keep it visible and retry.",
            ),
          );
          return;
        }
        if (video.ended || video.currentTime >= trim.end) {
          resolve();
          return;
        }
        message(
          "Exporting " +
            Math.min(
              100,
              Math.round(
                ((video.currentTime - trim.start) / (trim.end - trim.start)) *
                  100,
              ),
            ) +
            "%",
        );
        requestAnimationFrame(tick);
      };
      tick();
    });
    video.pause();
    rec.stop();
    await stopped;
    if (controller.signal.aborted) throw new Error("Export cancelled.");
    const blob = new Blob(chunks, { type: mime.split(";")[0] }),
      ext = mime.includes("mp4") ? "mp4" : "webm";
    const { item, saved } = await retainExport(blob, {
      name: "Captioned clip." + ext,
      engine: "local-caption-render",
      sourceId,
      settings: {
        ...trim,
        cues,
        color: $("#color").value,
        size: Number($("#size").value),
      },
    });
    const result = $("#result");
    result.replaceChildren();
    const button = document.createElement("button");
    button.className = "btn-accent";
    button.textContent = "Download " + ext.toUpperCase();
    button.onclick = () => downloadBlob(blob, item.name);
    const a = document.createElement("a");
    a.href = "/library/";
    a.textContent = "Open saved clip in library ↗";
    result.append(button);
    if (saved) result.append(a);
    message(
      saved
        ? "Finished and saved to your local library."
        : "Clip ready. Browser storage could not save it. Download before leaving.",
    );
  } catch (e) {
    message(e.message);
  } finally {
    if (rec?.state === "recording") rec.stop();
    video.pause();
    if (destination) {
      audioSource?.disconnect(destination);
      destination.stream.getTracks().forEach((t) => t.stop());
    }
    stream?.getTracks().forEach((t) => t.stop());
    video.currentTime = oldTime;
    video.controls = true;
    recording = false;
    $("#export").disabled = false;
    $("#cancel").hidden = true;
    for (const e of document.querySelectorAll(
      ".controls input,.controls textarea,.controls select",
    ))
      e.disabled = false;
  }
};
try {
  const it = await selectedAsset();
  if (it?.blob?.type.startsWith("video/")) await open(it.blob, it.id);
  else {
    const r = await fetch("/media/clips/effect-lidar.mp4");
    await open(await r.blob());
  }
} catch (e) {
  message(e.message);
}
addEventListener("pagehide", () => {
  controller?.abort();
  video.pause();
  cancelAnimationFrame(raf);
  if (url) URL.revokeObjectURL(url);
});

$("#use-transcript").onclick = () => {
  try {
    const d = JSON.parse(localStorage.getItem("massless.captions") || "null");
    if (!d?.segments?.length)
      throw new Error(
        "Create a transcript in Audio first, or import an SRT file.",
      );
    const segs = T.parseTranscript(d.text || "", d.segments);
    const text = T.toSrt(T.buildCues(segs));
    cues = parseCaptions(text);
    $("#cues").value = text;
    message(
      "Saved transcript loaded. Review the captions against this clip before exporting.",
    );
  } catch (e) {
    message(e.message);
  }
};

$("#sample").onchange = async (e) => {
  try {
    const path =
      e.target.value === "music"
        ? "/media/showcase/glass-tide.mp4"
        : "/media/clips/effect-lidar.mp4";
    const r = await fetch(path);
    if (!r.ok) throw new Error("Could not load this sample.");
    await open(await r.blob());
  } catch (e) {
    message(e.message);
  }
};
