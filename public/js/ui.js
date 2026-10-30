// Small shared UI helpers for every page.

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Lazy-load and autoplay muted clips while they are on screen; pause them when they leave. */
export function autoplayVideos(videos) {
  const list = [...videos];
  if (!('IntersectionObserver' in window)) {
    list.forEach((v) => { v.src = v.dataset.src; });
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const v = e.target;
      if (e.isIntersecting) {
        if (!v.src) v.src = v.dataset.src;
        if (!reduceMotion()) v.play().catch(() => {});
      } else if (!v.paused) {
        v.pause();
      }
    }
  }, { rootMargin: '120px 0px', threshold: 0.25 });
  list.forEach((v) => io.observe(v));
}

/** Buttons and links with data-dialog="id" open <dialog id="id">; clicks on the backdrop close it. */
export function bindDialogs() {
  document.querySelectorAll('[data-dialog]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById(b.dataset.dialog)?.showModal();
  }));
  document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
}

let toastTimer;
export function toast(msg, kind = '') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    document.body.append(t);
  }
  t.textContent = msg;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), kind === 'error' ? 7000 : 4000);
}

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
}

export function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

export const SAMPLES = [
  { key: 'rider', name: 'Desert rider', prompt: 'A lone motorcyclist riding an empty desert highway at golden hour, long dust trail, red mesas on the horizon' },
  { key: 'samurai', name: 'Neon samurai', prompt: 'A samurai standing still in heavy rain in a narrow neon-lit alley at night' },
  { key: 'lighthouse', name: 'Storm lighthouse', prompt: 'A lighthouse on a jagged sea cliff during a storm at blue hour, enormous waves crashing' },
  { key: 'dancer', name: 'Theater leap', prompt: 'A ballet dancer mid-leap in an abandoned grand theater, dust in shafts of window light' },
  { key: 'neon', name: 'Red raincoat', prompt: 'Close-up of a young woman in a red raincoat under a neon-lit awning at night, rain falling' },
  { key: 'train', name: 'Desert station', prompt: 'A sleek retro-futuristic train arriving at a lonely desert station at noon, heat haze' },
  { key: 'fisherman', name: 'Dawn nets', prompt: 'An old fisherman mending nets on a wooden boat at dawn, mist drifting over a still lake' },
  { key: 'jellyfish', name: 'Jellyfish drift', prompt: 'A scuba diver drifting among glowing jellyfish in deep blue water, light rays from the surface' },
  { key: 'diner', name: 'Night diner', prompt: 'A vintage roadside diner at night, waitress pouring coffee, pink and teal neon through rain on the windows' },
  { key: 'summit', name: 'Above the clouds', prompt: 'A mountaineer on a knife-edge snowy ridge above a sea of clouds at sunrise' },
  { key: 'bmx', name: 'Puddle jump', prompt: 'A kid on a BMX bike mid-jump over a puddle on a suburban street at sunset, 1990s summer' },
  { key: 'astronaut', name: 'Wheat field', prompt: 'An astronaut standing alone in a field of tall golden wheat at sunset, helmet visor reflecting the sky' },
  { key: 'cinema', name: 'Night shoot', prompt: 'A cinematographer at night on a rain-soaked city street adjusting a vintage cinema camera, neon reflections' },
  { key: 'canyon', name: 'Canyon road', prompt: 'Aerial view of a vast red rock canyon at sunset, a lone vintage car on a cliffside road kicking up dust' },
];
