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

// Stills from real projects by the Massless maker, moved by Massless's camera. tall = 9:16.
const PROJECTS = [
  ['tp-greenhouse', 'Tiny Prompters', 'https://tinyprompters.com', 'Robots tending a seedling in a dome greenhouse on the Moon', 'Dolly in'],
  ['tp-city', 'Tiny Prompters', 'https://tinyprompters.com', 'Kids and a robot walking through a green future city', 'Crane up', true],
  ['t1-keyart', 'T1 Vendetta', '', 'T1 Vendetta 16-bit fighting game key art', 'Dolly in'],
  ['t1-skywalk', 'T1 Vendetta', '', 'Pixel-art skywalk over a neon street at night', 'Crane up', true],
  ['tp-crew', 'Tiny Prompters', 'https://tinyprompters.com', 'Astra, Rivet and Quark, the Tiny Prompters robot crew', 'Arc right'],
  ['tp-garden', 'Tiny Prompters', 'https://tinyprompters.com', 'A little robot beside a sprout in a space garden', 'Dolly zoom', true],
  ['t1-navypier', 'T1 Vendetta', '', 'Pixel-art pier with a Ferris wheel on a snowy night', 'Arc right'],
];

function hoverCard(a) {
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
}

function buildProjects() {
  const box = $('#projects');
  if (!box) return;
  for (const [key, project, site, alt, move, tall] of PROJECTS) {
    const a = document.createElement('a');
    a.className = tall ? 'reel-card tall' : 'reel-card';
    a.href = site || '/video';
    if (site) a.rel = 'noopener';
    a.innerHTML = `<video muted loop playsinline preload="none" poster="/media/art/${key}.jpg" data-src="/media/clips/wall-${key}.mp4" aria-label="${alt}"></video><span class="cap">${project} · ${move}</span>`;
    box.append(a);
  }
}

function buildMade() {
  const box = $('#masonry');
  for (const [key, alt, move] of MADE) {
    const a = document.createElement('a');
    a.href = `/video?sample=${key}`;
    a.innerHTML = `<img loading="lazy" src="/media/art/${key}.jpg" alt="${alt}"><video muted loop playsinline preload="none" data-src="/media/clips/wall-${key}.mp4" data-hover></video><span class="cap">${move}</span>`;
    hoverCard(a);
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
buildProjects();
buildMade();
bindRail();
bindDialogs();
autoplayVideos(document.querySelectorAll('video[data-src]:not([data-hover])'));

// the trailer opens in a dialog with sound; it stops when the dialog closes
const trailer = document.getElementById('trailer');
const trailerVideo = document.getElementById('trailer-video');
if (trailer && trailerVideo) {
  document.getElementById('trailer-card')?.addEventListener('click', () => { trailerVideo.currentTime = 0; trailerVideo.muted = false; trailerVideo.play().catch(() => {}); });
  trailer.addEventListener('close', () => trailerVideo.pause());
  if (location.hash === '#trailer') { trailer.showModal(); }
}
