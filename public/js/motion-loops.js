// Motion Loops for the browser: the shared library plus MP4 export and "copy as one HTML file".
import { installLoops } from './loops-core.js';

export const { LOOPS, PALETTES, drawLoop } = installLoops();
export { installLoops };

export const FORMATS = {
  square: { name: 'Square · 1:1', w: 1080, h: 1080 },
  portrait: { name: 'Story · 9:16', w: 1080, h: 1920 },
  wide: { name: 'Wide · 16:9', w: 1920, h: 1080 },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const colour = (c, fallback) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : fallback);

// One self-contained HTML file: the loop library, the chosen loop and colours, nothing else.
// Change the three colours in OPTIONS and it is recoloured for your brand.
export function loopHtml({ id, colors, bg, period = 12, title }) {
  const loop = LOOPS.find((l) => l.id === id) || LOOPS[0];
  const pal = PALETTES.chucksi;
  const opts = { colors: (colors || pal.ink).map((c, i) => colour(c, pal.ink[i])), bg: bg === null ? null : colour(bg, pal.bg) };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || `${loop.name} loop`)} · made with Chucksi</title>
<style>html,body{margin:0;height:100%;background:${opts.bg || 'transparent'}}canvas{display:block;width:100%;height:100%}</style>
</head><body><canvas aria-label="${esc(loop.name)} motion loop"></canvas>
<script>
// ${esc(loop.name)} · a seamless ${period}-second loop from Chucksi Motion Loops (MIT). https://chucksi.com/loops
// Recolour: change the three colours and the background below.
const OPTIONS = ${JSON.stringify({ loop: loop.id, colors: opts.colors, bg: opts.bg, seconds: period })};
const installLoops = ${installLoops.toString()};
const { drawLoop } = installLoops();
const canvas = document.querySelector('canvas'), g = canvas.getContext('2d');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
function fit() { const d = Math.min(2, devicePixelRatio || 1); canvas.width = innerWidth * d; canvas.height = innerHeight * d; }
addEventListener('resize', fit); fit();
const start = performance.now();
(function frame(now) {
  const p = still ? 0.2 : ((now - start) / 1000 / OPTIONS.seconds) % 1;
  g.clearRect(0, 0, canvas.width, canvas.height);
  drawLoop(g, OPTIONS.loop, p, canvas.width, canvas.height, { colors: OPTIONS.colors, bg: OPTIONS.bg });
  if (!still) requestAnimationFrame(frame);
})(start);
</script></body></html>
`;
}

// Encode any canvas animation to MP4 (H.264, VP9 where H.264 isn't available). No sound track.
export async function exportCanvasVideo({ width, height, fps = 30, duration, draw, onProgress, signal }) {
  if (typeof VideoEncoder === 'undefined') throw new Error('Video export needs a browser with WebCodecs. Try desktop Chrome, Edge or Safari.');
  const options = [
    { mux: 'avc', config: { codec: width * height > 1920 * 1088 ? 'avc1.640033' : 'avc1.640028', avc: { format: 'avc' } } },
    { mux: 'avc', config: { codec: 'avc1.42003e', avc: { format: 'avc' } } },
    { mux: 'vp9', config: { codec: 'vp09.00.40.08' } },
  ].map((o) => ({ ...o, config: { ...o.config, width, height, framerate: fps, bitrate: Math.round(width * height * fps * 0.12) } }));
  let chosen = null;
  for (const o of options) { try { if ((await VideoEncoder.isConfigSupported(o.config)).supported) { chosen = o; break; } } catch { /* next */ } }
  if (!chosen) throw new Error('This browser can’t export video at this size. Try a smaller format.');
  const { Muxer, ArrayBufferTarget } = await import('./vendor/mp4-muxer.mjs');
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: chosen.mux, width, height, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let failure = null;
  const enc = new VideoEncoder({ output: (c, m) => { try { muxer.addVideoChunk(c, m); } catch (e) { failure = e; } }, error: (e) => (failure = e) });
  enc.configure(chosen.config);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const total = Math.round(duration * fps);
  try {
    for (let i = 0; i < total; i++) {
      if (failure) throw failure;
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      draw(canvas, i / fps, i / total);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i / fps) * 1e6), duration: Math.round(1e6 / fps) });
      try { enc.encode(frame, { keyFrame: i % (fps * 2) === 0 }); } finally { frame.close(); }
      if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
      if (i % 10 === 0) { onProgress?.(i / total); await new Promise((r) => setTimeout(r, 0)); }
    }
    await enc.flush();
    if (failure) throw failure;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  } finally {
    if (enc.state !== 'closed') enc.close();
  }
}
