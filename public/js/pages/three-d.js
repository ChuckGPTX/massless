import { estimateDepth, depthBackend, backgroundLayer, depthStats } from '../depth.js';
import { depthToSplat } from '../splat.js';
import * as store from '../store.js';
import { bindDialogs, toast, el, download, SAMPLES } from '../ui.js';

const $ = (s) => document.querySelector(s);
const FOV = 40;
const state = {
  engine: 'depth', current: null, splat: null, mode: 'scene', flip: false, auto: true, busy: false, recording: false,
  strength: 1, cols: 420, fill: true,
};
const depthCache = new Map();
let THREE, OrbitControls, SparkRenderer, SplatMesh;
let renderer, scene, camera, controls, mesh, clock0 = performance.now();
let restOffset = null;

// ---------- status ----------
function status(text, fraction = null) {
  const box = $('#vf-status');
  if (!text) { box.hidden = true; return; }
  box.hidden = false;
  $('#vf-status-text').textContent = text;
  box.querySelector('.meter').classList.toggle('indeterminate', fraction == null);
  $('#meter-fill').style.width = fraction == null ? '' : `${Math.round(fraction * 100)}%`;
}
function setBusy(on, label) {
  state.busy = on;
  $('#build').disabled = on;
  $('#build').classList.toggle('busy', on);
  $('#build-label').textContent = on ? label || 'Working…' : 'Build 3D';
}

// ---------- viewer ----------
async function initViewer() {
  [THREE, { OrbitControls }, { SparkRenderer, SplatMesh }] = await Promise.all([
    import('three'), import('three/addons/controls/OrbitControls.js'), import('@sparkjsdev/spark'),
  ]);
  const canvas = $('#view3d');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x0c0c0e, 1);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.01, 200);
  scene.add(new SparkRenderer({ renderer }));
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.addEventListener('start', () => setAuto(false));
  const fit = () => {
    const vf = $('#viewfinder');
    const w = vf.clientWidth;
    const h = vf.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(fit).observe($('#viewfinder'));
  fit();
  renderer.setAnimationLoop(() => {
    if (state.recording) return;
    const t = (performance.now() - clock0) / 1000;
    if (state.auto && restOffset && state.mode === 'scene') {
      const a = 0.42 * Math.sin(t * 0.55);
      const p = 0.07 * Math.sin(t * 0.37);
      const o = restOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a).applyAxisAngle(new THREE.Vector3(1, 0, 0), p);
      camera.position.copy(controls.target).add(o);
    }
    controls.autoRotate = state.auto && state.mode === 'object';
    controls.update();
    renderer.render(scene, camera);
  });
}

function setAuto(on) {
  state.auto = on;
  $('#p-orbit').classList.toggle('on', on);
}

function frameScene(target, D) {
  const tgt = new THREE.Vector3(...target);
  camera.fov = FOV;
  camera.updateProjectionMatrix();
  camera.position.set(0, 0, D);
  controls.target.copy(tgt);
  restOffset = camera.position.clone().sub(tgt);
  const r = restOffset.length();
  controls.minDistance = r * 0.25;
  controls.maxDistance = r * 2.2;
  controls.minAzimuthAngle = -1.1;
  controls.maxAzimuthAngle = 1.1;
  controls.minPolarAngle = Math.PI / 2 - 0.7;
  controls.maxPolarAngle = Math.PI / 2 + 0.7;
  controls.update();
}

function frameObject() {
  mesh.updateMatrixWorld(true);
  const box = mesh.getBoundingBox(true).clone().applyMatrix4(mesh.matrixWorld);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const dist = (Math.max(size.x, size.y, size.z) / (2 * Math.tan((FOV * Math.PI) / 360))) * 1.35 || 3;
  controls.target.copy(c);
  camera.position.set(c.x, c.y + dist * 0.18, c.z + dist);
  restOffset = camera.position.clone().sub(c);
  controls.minDistance = dist * 0.2;
  controls.maxDistance = dist * 5;
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;
  controls.autoRotateSpeed = 1.6;
  controls.update();
}

/** kind: 'scene' (Chucksi depth splat, already in viewer coordinates) or 'object' (Idol or any .ply). */
async function showSplat(bytes, { name, kind, target, D, count }) {
  if (!SplatMesh) await viewerReady;
  const next = new SplatMesh({ fileBytes: bytes.slice(0), fileName: name });
  await next.initialized;
  if (mesh) { scene.remove(mesh); mesh.dispose?.(); }
  mesh = next;
  state.mode = kind;
  state.splat = { bytes, name };
  state.flip = kind === 'object';
  if (state.flip) mesh.quaternion.set(1, 0, 0, 0);
  scene.add(mesh);
  if (kind === 'scene') frameScene(target, D);
  else frameObject();
  $('#p-flip').hidden = kind !== 'object';
  $('#download').disabled = false;
  const n = count ?? mesh.numSplats;
  $('#hud-count').textContent = n ? `${n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.round(n / 1000) + 'k'} points` : '';
}

// ---------- sources ----------
async function bitmapFrom(url) { return await createImageBitmap(await (await fetch(url)).blob()); }

async function precomputedDepth(key) {
  try {
    const res = await fetch(`/media/depth/${key}.png`);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const data = new Uint8Array(c.width * c.height);
    for (let i = 0; i < data.length; i++) data[i] = px[i * 4];
    return { data, w: c.width, h: c.height, source: 'precomputed' };
  } catch { return null; }
}

async function setSource({ ref, name, sub, image, depth = null, thumbUrl, blob = null }) {
  state.current = { ref, name, image, depth, blob };
  $('#frame-img').src = thumbUrl || '';
  $('#frame-name').textContent = name;
  $('#frame-sub').textContent = sub || 'Source still';
  await build();
}

async function loadSample(key) {
  const s = SAMPLES.find((x) => x.key === key) || SAMPLES[0];
  const [image, depth] = await Promise.all([bitmapFrom(`/media/art/${s.key}.jpg`), depthCache.get(`sample:${s.key}`) || precomputedDepth(s.key)]);
  await setSource({ ref: `sample:${s.key}`, name: s.name, sub: 'Sample still', image, depth, thumbUrl: `/media/art/${s.key}.jpg` });
}

async function loadShot(id) {
  const item = await store.get(id).catch(() => null);
  if (!item) { toast('That shot is no longer in this browser. Showing a sample instead.', 'error'); return loadSample('samurai'); }
  await setSource({ ref: `shot:${id}`, name: item.engine === 'upload' ? 'Your still' : 'Your shot', sub: (item.prompt || '').slice(0, 60) || 'Source still', image: await createImageBitmap(item.blob), thumbUrl: URL.createObjectURL(item.thumb || item.blob), blob: item.blob });
}

async function loadFile(file) {
  if (!file) return;
  if (/\.(ply|spz|splat|ksplat)$/i.test(file.name)) return openSplatFile(file);
  if (!file.type.startsWith('image/')) { toast('Use a JPEG, PNG or WebP still, or a .ply file.', 'error'); return; }
  const bmp = await createImageBitmap(file);
  const sc = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc);
  c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  const id = `shot-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  await store.put({ id, kind: 'shot', created: Date.now(), prompt: '', engine: 'upload', blob, thumb: blob }).catch(() => {});
  $('#picker').close();
  await setSource({ ref: `shot:${id}`, name: 'Your still', sub: file.name, image: c, thumbUrl: URL.createObjectURL(blob), blob });
}

async function openSplatFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder().decode(bytes.slice(0, 200));
  const ours = head.includes('Chucksi depth splat') || head.includes('Massless depth splat'); // older exports
  status('Opening…', null);
  try {
    if (ours) {
      // our own export: viewer coordinates, camera at the rest position
      await showSplat(bytes, { name: file.name, kind: 'scene', target: [0, 0, 0.6], D: 1.4 });
    } else await showSplat(bytes, { name: file.name, kind: 'object' });
    $('#hud-name').textContent = file.name;
    $('#src-label').textContent = 'Your file';
    setAuto(true);
  } catch (e) { toast('Could not open that file. Try a .ply, .spz or .splat file.', 'error'); } finally { status(null); }
}

// ---------- building ----------
const depthRange = () => {
  const k = state.strength;
  return [Math.max(0.12, 1 - 0.5 * k), 1 + 0.6 * k];
};

async function ensureDepth(cur) {
  let d = cur.depth || depthCache.get(cur.ref);
  if (!d) {
    status('Preparing your still…', null);
    d = await estimateDepth(cur.image, (f, msg) => status(msg, f));
    if (d.source === 'estimate') toast('The 3D may look a little rough on this device.', 'error');
  }
  if (!d.bg) {
    const layer = backgroundLayer(cur.image, d.data, d.w, d.h);
    d.bg = layer.bgDepth;
    d.bgColor = layer.bgColor;
  }
  d.stats = d.stats || depthStats(d.data, d.w, d.h);
  depthCache.set(cur.ref, d);
  cur.depth = d;
  return d;
}

async function buildDepth() {
  const cur = state.current;
  const d = await ensureDepth(cur);
  if (state.current !== cur) return;
  status('Building your scene…', null);
  await new Promise((r) => setTimeout(r, 16));
  const [sNear, sFar] = depthRange();
  const D = 1 / (2 * Math.tan((FOV * Math.PI) / 360)) / 1.0;
  const res = depthToSplat({ image: cur.image, depth: d, cols: state.cols, sNear, sFar, D, background: state.fill, subject: d.stats.subject });
  await showSplat(res.bytes, { name: `${cur.name}.ply`, kind: 'scene', target: res.target, D: res.D, count: res.count });
  $('#hud-name').textContent = `${cur.name} · 3D scene`;
  $('#src-label').textContent = d.source === 'precomputed' ? 'Sample' : 'Ready';
}

async function imageBlob(cur) {
  if (cur.blob) return cur.blob;
  const c = document.createElement('canvas');
  c.width = cur.image.width;
  c.height = cur.image.height;
  c.getContext('2d').drawImage(cur.image, 0, 0);
  return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
}

const idolBase = () => $('#idol-url').value.trim().replace(/\/+$/, '');
async function checkIdol() {
  const out = $('#o-idol');
  out.textContent = 'checking…';
  try {
    const r = await fetch(`${idolBase()}/health`, { signal: AbortSignal.timeout(2500) });
    const j = await r.json();
    out.textContent = j.ok ? 'connected' : 'not connected';
    return !!j.ok;
  } catch {
    out.textContent = 'not reachable';
    return false;
  }
}

async function buildIdol() {
  const cur = state.current;
  if (!(await checkIdol())) {
    toast('Connect an object service in Connection settings, or open an existing 3D file.', 'error');
    return;
  }
  status('Creating your complete object…', null);
  const q = new URLSearchParams({ mode: $('#idol-mode').value, seed: $('#idol-seed').value, num_gaussians: $('#idol-count').value });
  const t0 = performance.now();
  const r = await fetch(`${idolBase()}/generate?${q}`, { method: 'POST', body: await imageBlob(cur), headers: { 'content-type': 'image/jpeg' } });
  if (!r.ok) throw new Error('the object service could not build this one. Try again.');
  const bytes = new Uint8Array(await r.arrayBuffer());
  await showSplat(bytes, { name: `${cur.name}-idol.ply`, kind: 'object' });
  $('#hud-name').textContent = `${cur.name} · Full object`;
  $('#src-label').textContent = 'Object ready';
  setAuto(true);
}

async function build() {
  if (!state.current || state.busy) return;
  setBusy(true, state.engine === 'idol' ? 'Generating' : 'Building');
  try {
    if (state.engine === 'idol') await buildIdol();
    else await buildDepth();
  } catch (e) {
    toast(`3D failed: ${e.message}`, 'error');
  } finally {
    status(null);
    setBusy(false);
  }
}

let rebuildTimer = 0;
function rebuildSoon() {
  if (state.engine !== 'depth' || !state.current?.depth) return;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(build, 250);
}

// ---------- pickers ----------
async function openPicker() {
  const mine = $('#pick-mine');
  mine.innerHTML = '';
  const items = (await store.all().catch(() => [])).filter((x) => (x.kind || 'shot') === 'shot').sort((a, b) => b.created - a.created).slice(0, 18);
  $('#mine-head').hidden = !items.length;
  for (const it of items) {
    const b = el('button', { type: 'button', class: 'pick' }, el('img', { src: URL.createObjectURL(it.thumb || it.blob), alt: it.prompt || 'Your shot' }));
    b.addEventListener('click', () => { $('#picker').close(); loadShot(it.id); });
    mine.append(b);
  }
  $('#picker').showModal();
}
function buildSamples() {
  const box = $('#samples');
  for (const s of SAMPLES) {
    const b = el('button', { type: 'button', class: 'pick' }, el('img', { loading: 'lazy', src: `/media/art/${s.key}.jpg`, alt: s.prompt }), el('span', {}, s.name));
    b.addEventListener('click', () => { $('#viewfinder').scrollIntoView({ behavior: 'smooth', block: 'center' }); loadSample(s.key); });
    box.append(b);
  }
}

function showTab(which) {
  state.engine = which;
  const idol = which === 'idol';
  $('#t-depth').setAttribute('aria-selected', String(!idol));
  $('#t-idol').setAttribute('aria-selected', String(idol));
  $('#tab-depth').hidden = idol;
  $('#tab-idol').hidden = !idol;
  if (idol) checkIdol();
}

function bind() {
  $('#t-depth').addEventListener('click', () => showTab('depth'));
  $('#t-idol').addEventListener('click', () => showTab('idol'));
  $('#frame-card').addEventListener('click', openPicker);
  $('#upload').addEventListener('change', (e) => loadFile(e.target.files[0]));
  $('#ply-in').addEventListener('change', (e) => openSplatFile(e.target.files[0]));
  $('#open-splat').addEventListener('click', () => $('#ply-in').click());
  $('#build').addEventListener('click', build);
  $('#download').addEventListener('click', () => state.splat && download(new Blob([state.splat.bytes], { type: 'application/octet-stream' }), `chucksi-${state.splat.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}`));
  $('#strength').addEventListener('input', (e) => { state.strength = Number(e.target.value); $('#o-strength').textContent = `${Math.round(state.strength * 100)}%`; rebuildSoon(); });
  $('#detail').addEventListener('change', (e) => { state.cols = Number(e.target.value); rebuildSoon(); });
  $('#fill').addEventListener('change', (e) => { state.fill = e.target.checked; rebuildSoon(); });
  $('#idol-seed').addEventListener('input', (e) => ($('#o-seed').textContent = e.target.value));
  $('#idol-url').addEventListener('change', checkIdol);
  $('#p-orbit').addEventListener('click', () => setAuto(!state.auto));
  $('#p-reset').addEventListener('click', () => {
    if (!mesh) return;
    if (state.mode === 'object') frameObject();
    else { camera.position.copy(controls.target).add(restOffset); controls.update(); }
  });
  $('#p-flip').addEventListener('click', () => {
    if (!mesh) return;
    state.flip = !state.flip;
    mesh.quaternion.set(state.flip ? 1 : 0, 0, 0, state.flip ? 0 : 1);
    frameObject();
  });
  const vf = $('#viewfinder');
  ['dragenter', 'dragover'].forEach((t) => vf.addEventListener(t, (e) => { e.preventDefault(); $('#drop-hint').hidden = false; }));
  ['dragleave', 'drop'].forEach((t) => vf.addEventListener(t, (e) => { e.preventDefault(); $('#drop-hint').hidden = true; }));
  vf.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
  document.addEventListener('paste', (e) => { const it = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/')); if (it) loadFile(it.getAsFile()); });
}

let viewerReady;
async function init() {
  bind();
  bindDialogs();
  buildSamples();
  viewerReady = initViewer().catch((e) => { status('The 3D viewer could not start on this device. Reload the page to try again.'); throw e; });
  const p = new URLSearchParams(location.search);
  if (p.get('engine') === 'idol') showTab('idol');
  if (p.get('panel') === 'import') {
    $('#open-splat').focus();
    $('#open-splat').scrollIntoView({ block: 'nearest' });
  }
  try { await viewerReady; } catch { return; }
  $('#src-label').textContent = 'Ready';
  if (p.get('shot')) await loadShot(p.get('shot'));
  else await loadSample(p.get('sample') || 'samurai');
  window.massless = { state, build, loadSample, openSplatFile, get mesh() { return mesh; }, get camera() { return camera; } };
}

init();
