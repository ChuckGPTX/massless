import { MOVES } from '../moves.js';
import { autoplayVideos, bindDialogs } from '../ui.js';

const $ = (s) => document.querySelector(s);
const GROUP_LABEL = { push: 'Push and pull', orbit: 'Orbit', rise: 'Crane and tilt', slide: 'Slide and pan', feel: 'Texture' };
const TRENDING = ['dolly-zoom', 'crash-zoom', 'bullet-time', 'fpv', 'wide-orbit', 'crane-up', 'snorricam', 'rack-focus', 'truck-right', 'dutch-roll', 'earthquake', 'handheld'];

function buildTrending() {
  const row = $('#move-row');
  for (const id of TRENDING) {
    const m = MOVES.find((x) => x.id === id);
    if (!m) continue;
    const a = document.createElement('a');
    a.className = 'mv';
    a.href = `/video?move=${m.id}`;
    a.innerHTML = `<div class="frame"><video muted loop playsinline preload="none" poster="/media/clips/move-${m.id}.jpg" data-src="/media/clips/move-${m.id}.mp4"></video><span class="cta">Use move</span></div><strong>${m.name}</strong><span>${GROUP_LABEL[m.group] || ''}</span>`;
    row.append(a);
  }
}

const MADE = [
  ['samurai', 'Samurai in a rain-soaked neon alley', 'Crash zoom in'],
  ['diner', 'Waitress pouring coffee in a neon-lit diner', 'Pan right'],
  ['jellyfish', 'Diver among glowing jellyfish', 'Crane up'],
  ['train', 'Retro-futuristic train at a desert station', 'Dolly zoom in'],
  ['fisherman', 'Old fisherman mending nets at dawn', 'Float'],
  ['bmx', 'Kid jumping a BMX bike over a puddle at sunset', 'Truck right'],
  ['summit', 'Mountaineer on a ridge above the clouds', 'Dolly out'],
  ['dancer', 'Ballet dancer leaping in an abandoned theater', 'Bullet time'],
];

function buildMade() {
  const box = $('#masonry');
  for (const [key, alt, move] of MADE) {
    const a = document.createElement('a');
    a.href = `/video?sample=${key}`;
    a.innerHTML = `<img loading="lazy" src="/media/art/${key}.jpg" alt="${alt}"><video muted loop playsinline preload="none" data-src="/media/clips/wall-${key}.mp4" data-hover></video><span class="cap">${move}</span>`;
    const v = a.querySelector('video');
    const start = () => {
      if (!v.src) v.src = v.dataset.src;
      v.play().then(() => a.classList.add('playing')).catch(() => {});
    };
    const stop = () => { v.pause(); a.classList.remove('playing'); };
    a.addEventListener('pointerenter', start);
    a.addEventListener('pointerleave', stop);
    a.addEventListener('focus', start);
    a.addEventListener('blur', stop);
    box.append(a);
  }
}

function bindRail() {
  const rail = $('#rail');
  const prev = $('#rail-prev');
  const next = $('#rail-next');
  const step = () => (rail.querySelector('.launch')?.getBoundingClientRect().width || 400) + 18;
  next.addEventListener('click', () => rail.scrollBy({ left: step(), behavior: 'smooth' }));
  prev.addEventListener('click', () => rail.scrollBy({ left: -step(), behavior: 'smooth' }));
  const sync = () => {
    prev.hidden = rail.scrollLeft < 8;
    next.hidden = rail.scrollLeft + rail.clientWidth > rail.scrollWidth - 8;
  };
  rail.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('resize', sync);
  sync();
}

buildTrending();
buildMade();
bindRail();
bindDialogs();
autoplayVideos(document.querySelectorAll('video[data-src]:not([data-hover])'));
