import {get} from "../store.js";
import { analyzeTrack, drawMusicFrame } from "../music-visualizer.js";
import { exportMusic } from "../music-export.js";

const $ = (s) => document.querySelector(s);
const canvas = $("#music-canvas");
let artwork,
  score,
  analysis,
  context,
  source,
  startAt,
  offset = 0,
  playing = false,
  busy = false,
  cancel,
  resultURL,
  artURL;
let demo = true;
const config = () => ({
  artist: $("#artist").value || "Your artist",
  title: $("#track-title").value || "Your release",
  color: $("#color").value,
  bpm: Math.max(60, Math.min(180, Number($("#tempo").value) || 120)),
  duration: Math.min(60, score?.duration || 16),
});
const message = (text) => {
  $("#music-status").textContent = text;
};
const format = (t) =>
  `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
function invalidate() {
  if (resultURL) URL.revokeObjectURL(resultURL);
  resultURL = null;
  $("#download-music").hidden = true;
}
function lock(on) {
  busy = on;
  for (const e of document.querySelectorAll(
    ".music-controls input, .music-controls select, .music-controls button, #scrub",
  ))
    e.disabled = on;
  $("#cancel-export").disabled = false;
  if (!on) {
    $("#play-music").disabled = !score;
    $("#export-music").disabled = !score;
  }
}
function draw(t = offset, target = canvas) {
  if (artwork) drawMusicFrame(target, artwork, config(), analysis, t);
  if (target === canvas) {
    $("#scrub").value = t;
    $("#time-label").textContent =
      `${format(t)} / ${format(config().duration)}`;
  }
}
function stop() {
  if (playing)
    offset = Math.min(config().duration, context.currentTime - startAt);
  playing = false;
  if (source) {
    source.onended = null;
    try {
      source.stop();
    } catch {}
    source.disconnect();
    source = null;
  }
  $("#play-music").textContent = "Play with sound";
}
async function play() {
  if (!score || busy) return;
  if (playing) {
    stop();
    return;
  }
  context ||= new AudioContext();
  await context.resume();
  if (offset >= config().duration - 0.05) offset = 0;
  const buffer = context.createBuffer(
    2,
    score.channels[0].length,
    score.sampleRate,
  );
  buffer.copyToChannel(score.channels[0], 0);
  buffer.copyToChannel(score.channels[1] || score.channels[0], 1);
  source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.onended = () => {
    playing = false;
    offset = 0;
    source = null;
    $("#play-music").textContent = "Play with sound";
    draw(0);
  };
  source.start(0, offset, config().duration - offset);
  startAt = context.currentTime - offset;
  playing = true;
  $("#play-music").textContent = "Pause";
}
function useScore(value) {
  score = value;
  analysis = analyzeTrack(value.channels, value.sampleRate);
  offset = 0;
  $("#scrub").max = config().duration;
  invalidate();
  draw();
}
async function makeDemo() {
  stop();
  lock(true);
  message("Composing an original demo instrumental…");
  try {
    const { renderScore } = await import("../score.js");
    const value = await renderScore({
      style: "trap",
      bpm: config().bpm,
      beats: 32,
      dropBeat: 8,
      endBeat: 28,
      seed: 410041,
    });
    value.duration = (32 * 60) / config().bpm;
    useScore(value);
    demo = true;
    $("#track-file").value = "";
    $("#track-info").textContent =
      "Original Chucksi demo instrumental · no artist vocals. Your own track stays on this device.";
    message("Ready. Play with sound or export your preview.");
  } catch (e) {
    message(`Could not create the demo: ${e.message}`);
  } finally {
    lock(false);
  }
}
async function loadArtwork(file) {
  if (!file || busy) return;
  if (file.size > 15 * 1024 * 1024) {
    message("Choose an image smaller than 15 MB.");
    return;
  }
  stop();
  lock(true);
  let url;
  try {
    url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    if (artURL) URL.revokeObjectURL(artURL);
    artURL = url;
    artwork = img;
    $("#art-thumb").src = url;
    invalidate();
    draw();
    message("Artwork updated.");
  } catch {
    if (url) URL.revokeObjectURL(url);
    message("That image could not be opened. Try JPG, PNG or WebP.");
  } finally {
    lock(false);
  }
}
async function loadTrack(file) {
  if (!file || busy) return;
  if (file.size > 30 * 1024 * 1024) {
    message("Choose audio smaller than 30 MB.");
    return;
  }
  stop();
  lock(true);
  message("Reading your audio locally…");
  try {
    context ||= new AudioContext();
    const audio = await context.decodeAudioData(await file.arrayBuffer());
    if (audio.duration > 60)
      throw new Error("Use a clip of 60 seconds or less.");
    useScore({
      sampleRate: audio.sampleRate,
      channels: [
        audio.getChannelData(0),
        audio.getChannelData(Math.min(1, audio.numberOfChannels - 1)),
      ],
      duration: audio.duration,
    });
    demo = false;
    $("#track-info").textContent =
      `${file.name} · ${format(audio.duration)} · stays on this device`;
    message("Track loaded. Set its tempo to align the cut grid.");
  } catch (e) {
    message(`Could not use that track: ${e.message}`);
  } finally {
    lock(false);
  }
}
$("#play-music").addEventListener("click", () =>
  play().catch((e) => message(e.message)),
);
$("#art-file").addEventListener("change", (e) =>
  loadArtwork(e.target.files[0]),
);
$("#track-file").addEventListener("change", (e) =>
  loadTrack(e.target.files[0]),
);
$("#demo-track").addEventListener("click", makeDemo);
for (const id of ["artist", "track-title", "color", "frame"])
  $(`#${id}`).addEventListener("input", () => {
    stop();
    invalidate();
    [canvas.width, canvas.height] =
      $("#frame").value === "portrait"
        ? [720, 1280]
        : $("#frame").value === "square"
          ? [720, 720]
          : [1280, 720];
    draw();
  });
$("#tempo").addEventListener("change", () => {
  $("#tempo").value = config().bpm;
  if (demo) makeDemo();
  else {
    stop();
    invalidate();
    draw();
  }
});
$("#scrub").addEventListener("input", () => {
  stop();
  offset = Number($("#scrub").value);
  draw();
});
$("#export-music").addEventListener("click", async () => {
  if (busy || !score) return;
  stop();
  invalidate();
  lock(true);
  cancel = new AbortController();
  $("#cancel-export").hidden = false;
  message("Rendering MP4 on your device…");
  const target = document.createElement("canvas");
  target.width = canvas.width;
  target.height = canvas.height;
  try {
    const blob = await exportMusic({
      canvas: target,
      score,
      duration: config().duration,
      signal: cancel.signal,
      draw: (c, t) => draw(t, c),
      onProgress: (p) => message(`Rendering MP4 · ${Math.round(p * 100)}%`),
    });
    try { const {saveAsset}=await import('../assets.js');await saveAsset(blob,{name:config().title+' teaser.mp4',engine:'music-visualizer',settings:config()}); } catch { message('Video ready; local saving failed. Download before leaving.'); }
    resultURL = URL.createObjectURL(blob);
    $("#download-music").href = resultURL;
    $("#download-music").hidden = false;
    message(
      `MP4 ready · ${(blob.size / 1024 / 1024).toFixed(1)} MB · includes audio.`,
    );
  } catch (e) {
    message(e.message);
  } finally {
    cancel = null;
    $("#cancel-export").hidden = true;
    lock(false);
  }
});
$("#cancel-export").addEventListener("click", () => cancel?.abort());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stop();
});
window.addEventListener("pagehide", () => {
  stop();
  cancel?.abort();
  context?.close();
});
function tick() {
  if (playing) draw(Math.min(config().duration, context.currentTime - startAt));
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
async function init() {
  try {
    artwork = new Image();
    const shotId = new URLSearchParams(location.search).get('shot');
    const shot = shotId ? await get(shotId) : null;
    if(shot?.blob?.type.startsWith('image/')) { artURL=URL.createObjectURL(shot.blob); artwork.src=artURL; $("#artist").value="Your artist"; $("#track-title").value="Your release"; }
    else artwork.src = "/media/music/showtime-animated.jpg";
    await Promise.all([artwork.decode(), document.fonts.ready]);
    draw();
    await makeDemo();
  } catch (e) {
    message(`Could not load the preview: ${e.message}`);
  }
}
init();
