// Front page: a live Lyric Studio preview and a Motion Loops reel, drawn by the same engines the studios use.
// Nothing loads until the cards are near the screen; they pause off screen and hold one frame for reduced motion.
const lyricCanvas = document.querySelector('[data-home-lyrics]');
const loopCanvas = document.querySelector('[data-home-loops]');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

const CUES = [
  { start: 0.4, end: 3.1, text: 'Drop your song in' },
  { start: 3.2, end: 6.1, text: 'Every word on the beat', emphasis: true },
  { start: 6.2, end: 9.1, text: 'A picture for every scene' },
  { start: 9.2, end: 11.8, text: 'Now it’s a film', emphasis: true },
];
const LOOKS = ['kinetic', 'orbit', 'echo', 'matter', 'architecture'];
const PICTURES = ['/media/showcase/glass-tide.jpg', '/media/workflows/moss-gravity.jpg', '/media/clips/effect-lidar-active.jpg', '/media/workflows/moss-fire.jpg'];
const LOOP_REEL = ['morph', 'burst', 'bounce', 'ripple', 'petals', 'jelly', 'spiral', 'scribble', 'tiles', 'orbit'];
const SPAN = 12;

function fakeAnalysis() {
  const n = 50 * SPAN, beat = { period: 0.5, offset: 0.4 };
  const bands = [0, 1, 2].map((j) => Float32Array.from({ length: n }, (_, k) => {
    const t = k / 50, sinceBeat = ((t - beat.offset) % beat.period + beat.period) % beat.period;
    return Math.min(1, 0.25 + 0.6 * Math.exp(-sinceBeat / (0.12 + j * 0.05)) + 0.1 * Math.sin(t * 3 + j));
  }));
  return { fps: 50, bands, beat };
}

function whenNear(el, start) {
  if (!el) return;
  if (!('IntersectionObserver' in window)) { start(); return; }
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '300px' });
  io.observe(el);
}
function visibility(el) {
  const state = { on: true };
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { state.on = es[0].isIntersecting; }).observe(el);
  return state;
}
function fit(canvas, max) {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1), s = Math.min(1, max / Math.max(1, r.width * dpr));
  canvas.width = Math.max(2, Math.round(r.width * dpr * s)); canvas.height = Math.max(2, Math.round(r.height * dpr * s));
}

whenNear(lyricCanvas, async () => {
  const [{ drawMotion, planScenes }] = await Promise.all([import('./lyric-motion.js'), document.fonts?.load?.('900 40px "Big Shoulders Display"').catch(() => {})]);
  const analysis = fakeAnalysis(), scenes = planScenes(CUES, SPAN, 4, analysis.beat);
  const images = PICTURES.map(() => null);
  PICTURES.forEach((src, i) => { const img = new Image(); img.decoding = 'async'; img.onload = () => { images[i] = img; }; img.src = src; });
  const vis = visibility(lyricCanvas);
  fit(lyricCanvas, 1280); addEventListener('resize', () => fit(lyricCanvas, 1280));
  const t0 = performance.now();
  const draw = (now) => {
    const elapsed = still ? 4.2 : (now - t0) / 1000, round = Math.floor(elapsed / SPAN), t = elapsed % SPAN;
    drawMotion(lyricCanvas, t, { cues: CUES, look: LOOKS[round % LOOKS.length], analysis, scenes, images, duration: SPAN, title: 'Chucksi', motion: !still });
  };
  if (still) { setTimeout(() => draw(0), 600); return; }
  (function frame(now) { if (vis.on && !document.hidden) draw(now); requestAnimationFrame(frame); })(t0);
});

whenNear(loopCanvas, async () => {
  const { drawLoop } = await import('./motion-loops.js');
  const vis = visibility(loopCanvas), period = 6;
  fit(loopCanvas, 800); addEventListener('resize', () => fit(loopCanvas, 800));
  const t0 = performance.now();
  const draw = (now) => {
    const k = still ? 0.2 : (now - t0) / 1000 / period, id = LOOP_REEL[Math.floor(k) % LOOP_REEL.length];
    drawLoop(loopCanvas.getContext('2d'), id, k % 1, loopCanvas.width, loopCanvas.height, { palette: 'chucksi', bg: '#0d0b14' });
  };
  if (still) { draw(0); return; }
  (function frame(now) { if (vis.on && !document.hidden) draw(now); requestAnimationFrame(frame); })(t0);
});
