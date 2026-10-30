import { FilmRenderer, PALETTES, BLOCKS, layout, check, templateSpec, sanitizeSpec } from '../film.js';
import * as store from '../store.js';
import { bindDialogs, toast, el } from '../ui.js';
import { apiFetch } from '../human.js';

const $ = (s) => document.querySelector(s);
const FALLBACK_STYLES = [
  { id: 'phonk', name: 'Phonk', bpm: 150 },
  { id: 'drive', name: 'Drive', bpm: 118 },
  { id: 'trailer', name: 'Trailer', bpm: 96 },
  { id: 'trap', name: 'Trap', bpm: 140 },
  { id: 'house', name: 'House', bpm: 124 },
];
const ASPECTS = { 169: [16, 9], 916: [9, 16], 11: [1, 1] };
const SAMPLE_STILLS = ['/media/art/rider.jpg', '/media/art/neon.jpg', '/media/art/lighthouse.jpg', '/media/art/astronaut.jpg'];

const state = { spec: null, lay: null, palette: 'amber', score: null, scoreMod: null, playing: false, t: 0, busy: false, recording: false, source: 'template' };
let renderer;
let actx = null;
let srcNode = null;
let startAt = 0;
let raf = 0;

// ---------- status ----------
function status(text, fraction = null) {
  const box = $('#vf-status');
  if (!text) { box.hidden = true; return; }
  box.hidden = false;
  $('#vf-status-text').textContent = text;
  box.querySelector('.meter').classList.toggle('indeterminate', fraction == null);
  $('#meter-fill').style.width = fraction == null ? '' : `${Math.round(fraction * 100)}%`;
}

async function scoreModule() {
  if (state.scoreMod !== null) return state.scoreMod;
  try { state.scoreMod = await import('../score.js'); } catch { state.scoreMod = false; }
  return state.scoreMod;
}

// ---------- sizing ----------
function frameSize(quality) {
  const [a, b] = ASPECTS[$('#aspect').value] || ASPECTS[169];
  const short = quality;
  return a >= b ? [Math.round((short * a) / b / 2) * 2, short] : [short, Math.round((short * b) / a / 2) * 2];
}
function sizePreview() {
  const [w, h] = frameSize(window.innerWidth < 760 ? 540 : 720);
  const c = $('#film');
  c.width = w;
  c.height = h;
  $('#viewfinder').style.aspectRatio = `${w} / ${h}`;
}
const filmDuration = () => Math.max(renderer.duration, state.score ? state.score.duration : 0);

// ---------- stills ----------
async function stills() {
  if (!$('#use-stills').checked) return [];
  const mine = (await store.all().catch(() => [])).filter((x) => (x.kind || 'shot') === 'shot').sort((a, b) => b.created - a.created).slice(0, 4);
  const urls = mine.map((it) => URL.createObjectURL(it.blob));
  return urls.length >= 2 ? urls : [...urls, ...SAMPLE_STILLS].slice(0, 4);
}

// ---------- building ----------
async function writeSpec() {
  const name = $('#name').value.trim() || 'Massless';
  const brief = $('#brief').value.trim();
  const style = $('#style').value;
  const bpm = Number($('#bpm').value);
  const length = $('#length').value;
  const images = await stills();
  const base = templateSpec({ name, brief, style, bpm, palette: state.palette, length, images });
  state.source = 'template';
  if ($('#use-llm').checked && brief) {
    status('Llama 3.3 is writing the beat sheet', null);
    try {
      const r = await apiFetch('/api/beats', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, brief, length }), signal: AbortSignal.timeout(30000) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const spec = sanitizeSpec(j.spec, base);
      if (spec !== base) { spec.title = name; state.source = 'llm'; return spec; }
    } catch (e) {
      toast(`The script writer is unavailable (${e.message}). Using the built-in template.`, 'error');
    }
  }
  return base;
}

async function applySpec(spec, { rescore = true } = {}) {
  state.spec = spec;
  state.lay = renderer.setSpec(spec);
  await renderer.loadImages(spec.blocks.filter((b) => b.type === 'image').map((b) => b.src));
  renderSheet();
  if (rescore) await scoreIt();
  renderChecks();
  $('#export').disabled = false;
  $('#src-label').textContent = `${state.source === 'llm' ? 'Llama 3.3 wrote it' : 'Built-in template'} · ${(FALLBACK_STYLES.find((s) => s.id === spec.style) || {}).name || spec.style} · ${spec.bpm} BPM`;
  seek(0);
}

async function scoreIt() {
  const mod = await scoreModule();
  stop();
  if (!mod) { state.score = null; return; }
  status('Scoring the film at the exact tempo', null);
  try {
    const lay = state.lay;
    const res = await mod.renderScore({ style: state.spec.style, bpm: state.spec.bpm, beats: lay.beats, dropBeat: lay.dropBeat, endBeat: lay.endBeat, cuts: lay.cuts, seed: hashStr(state.spec.title + state.spec.style) });
    state.score = res;
  } catch (e) {
    state.score = null;
    toast(`The score could not render: ${e.message}`, 'error');
  } finally { status(null); }
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

async function make() {
  if (state.busy) return;
  state.busy = true;
  $('#make').disabled = true;
  $('#make-label').textContent = 'Writing…';
  try {
    const spec = await writeSpec();
    $('#make-label').textContent = 'Scoring…';
    await applySpec(spec);
    toast(`${state.lay.blocks.length} blocks on ${state.lay.beats} beats, ${filmDuration().toFixed(1)} s. Press play.`);
  } catch (e) {
    toast(`Could not build the film: ${e.message}`, 'error');
  } finally {
    status(null);
    state.busy = false;
    $('#make').disabled = false;
    $('#make-label').textContent = 'Write and score';
  }
}

// ---------- playback ----------
function draw(t) {
  renderer.render(t, { samples: 1 });
  const d = filmDuration();
  $('#scrub').value = String(Math.round((t / d) * 1000));
  $('#tc').textContent = `${t.toFixed(1)} / ${d.toFixed(1)} s`;
}
function seek(t) { state.t = Math.max(0, Math.min(filmDuration(), t)); if (state.playing) { stop(); play(); } else draw(state.t); }
function play() {
  if (!state.spec) return;
  if (state.t >= filmDuration() - 0.05) state.t = 0;
  state.playing = true;
  $('#play').textContent = 'Pause';
  $('#big-play').hidden = true;
  const offset = state.t;
  let clock;
  if (state.score) {
    actx = actx || new AudioContext({ sampleRate: state.score.sampleRate });
    actx.resume();
    const buf = actx.createBuffer(2, state.score.channels[0].length, state.score.sampleRate);
    buf.copyToChannel(state.score.channels[0], 0);
    buf.copyToChannel(state.score.channels[1], 1);
    srcNode = actx.createBufferSource();
    srcNode.buffer = buf;
    srcNode.connect(actx.destination);
    startAt = actx.currentTime + 0.05 - offset;
    srcNode.start(actx.currentTime + 0.05, offset);
    clock = () => actx.currentTime - startAt;
  } else {
    const t0 = performance.now() / 1000 - offset;
    clock = () => performance.now() / 1000 - t0;
  }
  const step = () => {
    if (!state.playing) return;
    if (state.recording) { raf = requestAnimationFrame(step); return; }
    state.t = Math.max(0, clock());
    if (state.t >= filmDuration()) { stop(); state.t = filmDuration(); draw(state.t); return; }
    draw(state.t);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
function stop() {
  state.playing = false;
  cancelAnimationFrame(raf);
  try { srcNode?.stop(); } catch { /* already stopped */ }
  srcNode = null;
  $('#play').textContent = 'Play';
  $('#big-play').hidden = false;
}

// ---------- beat sheet editor ----------
function fieldFor(blk, key, label, onChange) {
  const val = Array.isArray(blk[key]) ? blk[key].join(', ') : blk[key] ?? '';
  const input = el('input', { type: 'text', value: val, 'aria-label': label, placeholder: label });
  input.addEventListener('change', () => { blk[key] = Array.isArray(blk[key]) || key === 'words' ? input.value.split(',').map((w) => w.trim()).filter(Boolean) : key === 'to' ? Number(input.value) || 0 : input.value; onChange(false); });
  return input;
}
function renderSheet() {
  const list = $('#sheet');
  list.innerHTML = '';
  const lay = state.lay;
  $('#block-count').textContent = lay.blocks.length;
  $('#block-count').classList.toggle('on', lay.blocks.length > 0);
  const changed = (rescore) => applySpec(state.spec, { rescore });
  lay.blocks.forEach((b, i) => {
    const blk = state.spec.blocks[i];
    const keys = { words: [['words', 'Words, comma separated']], strike: [['text', 'Old way'], ['then', 'New way']], hero: [['text', 'Name'], ['sub', 'Line under']], prompt: [['text', 'Typed request']], counter: [['to', 'Number'], ['suffix', 'Suffix'], ['label', 'Label']], stretch: [['text', 'Word']], fly: [['words', 'Words, comma separated']], image: [['words', 'Words, comma separated']], graph: [['to', 'Number'], ['label', 'Label']], logo: [['text', 'Name'], ['sub', 'Tagline']] }[b.type] || [];
    const beats = el('select', { 'aria-label': 'Beats' }, ...[2, 3, 4, 6, 8, 12].map((n) => el('option', { value: n, selected: n === b.beats }, `${n} beats`)));
    beats.addEventListener('change', () => { blk.beats = Number(beats.value); changed(true); });
    const up = el('button', { type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [state.spec.blocks[i - 1], state.spec.blocks[i]] = [state.spec.blocks[i], state.spec.blocks[i - 1]]; changed(true); } }, '↑');
    const del = el('button', { type: 'button', 'aria-label': 'Remove block', disabled: b.type === 'logo', onclick: () => { state.spec.blocks.splice(i, 1); changed(true); } }, '×');
    list.append(el('li', { class: `sheet-item${b.drop ? ' drop' : ''}` },
      el('div', { class: 'si-head' }, el('span', { class: 'si-type' }, BLOCKS[b.type]?.name || b.type), b.drop ? el('span', { class: 'si-drop' }, 'DROP') : null, el('span', { class: 'si-beat' }, `beat ${b.start}`), beats, up, del,
        el('button', { type: 'button', class: 'si-go', 'aria-label': 'Preview from here', onclick: () => seek((b.start * 60) / state.spec.bpm) }, '▶')),
      el('div', { class: 'si-fields' }, ...keys.map(([k, l]) => fieldFor(blk, k, l, changed)))));
  });
  const add = el('select', { class: 'si-add', 'aria-label': 'Add a block' }, el('option', { value: '' }, '+ Add a block'), ...Object.entries(BLOCKS).filter(([k]) => k !== 'logo').map(([k, v]) => el('option', { value: k }, `${v.name}: ${v.hint}`)));
  add.addEventListener('change', () => {
    if (!add.value) return;
    const t = add.value;
    const words = ['NEW', 'BLOCK', 'RIGHT', 'HERE'];
    const blk = { type: t, beats: 4, words, text: t === 'prompt' ? 'type what you want' : 'NEW', then: 'NEXT', to: 100, label: 'label', sub: '' };
    if (t === 'image') blk.src = SAMPLE_STILLS[0];
    state.spec.blocks.splice(Math.max(0, state.spec.blocks.length - 1), 0, blk);
    applySpec(state.spec, { rescore: true });
  });
  list.append(el('li', { class: 'sheet-add' }, add));
}

function renderChecks() {
  const c = check(state.lay, state.spec.bpm);
  const items = [
    ['Length', `${filmDuration().toFixed(1)} s`, true],
    ['Hard cuts every 10 s', c.cutsPer10.toFixed(1), c.cutsPer10 >= 6],
    ['Longest hold', `${c.longestHold.toFixed(2)} s`, c.longestHold <= 0.8],
    ['Blocks', String(c.blocks), c.blocks >= 6],
    ['Tempo', `${state.spec.bpm} BPM`, true],
    ['Music', state.score ? 'Scored in your browser' : 'Silent (score unavailable)', !!state.score],
  ];
  $('#checks').replaceChildren(...items.map(([k, v, ok]) => el('div', { class: `chk${ok ? ' ok' : ' warn'}` }, el('strong', {}, v), el('span', {}, k))));
}

// ---------- export ----------
const AVC = [['avc1.640033', 2160], ['avc1.640028', 1088], ['avc1.4d0028', 1088], ['avc1.42001f', 720]];
async function pickVideo(width, height, fps) {
  for (const [codec] of AVC) {
    const cfg = { codec, width, height, bitrate: width * height > 3e6 ? 40e6 : 12e6, framerate: fps, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch { /* next */ }
  }
  return null;
}
async function pickAudio(sampleRate) {
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate, numberOfChannels: 2, bitrate: 192000 };
    try { if (typeof AudioEncoder !== 'undefined' && (await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux }; } catch { /* next */ }
  }
  return null;
}
const yieldTask = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

async function exportFilm() {
  if (!state.spec || state.recording) return;
  if (typeof VideoEncoder === 'undefined') { toast('This browser cannot encode video. Use desktop Chrome, Edge or Safari 17+.', 'error'); return; }
  stop();
  state.recording = true;
  const btn = $('#export');
  btn.disabled = true;
  const fps = 30;
  const [W, H] = frameSize(Number($('#quality').value));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const r2 = new FilmRenderer(canvas);
  Object.assign(r2.images, renderer.images);
  r2.setSpec(state.spec);
  const samples = W * H > 3e6 ? 3 : 5;
  try {
    const vcfg = await pickVideo(W, H, fps);
    if (!vcfg) throw new Error(`this browser cannot encode ${W}×${H} H.264; try a lower quality`);
    const acfg = state.score ? await pickAudio(state.score.sampleRate) : null;
    const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.mjs');
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H, frameRate: fps },
      ...(acfg ? { audio: { codec: acfg.mux, numberOfChannels: 2, sampleRate: state.score.sampleRate } } : {}),
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    let err = null;
    const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (err = e) });
    venc.configure(vcfg);
    let aenc = null;
    if (acfg) {
      aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (err = e) });
      aenc.configure(acfg.cfg);
      const [L, Rch] = state.score.channels;
      const sr = state.score.sampleRate;
      const step = 4800;
      for (let i = 0; i < L.length; i += step) {
        const n = Math.min(step, L.length - i);
        const data = new Float32Array(n * 2);
        data.set(L.subarray(i, i + n), 0);
        data.set(Rch.subarray(i, i + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / sr) * 1e6), data });
        aenc.encode(ad);
        ad.close();
      }
    }
    const total = Math.ceil(filmDuration() * fps);
    for (let i = 0; i < total; i++) {
      if (err) throw err;
      r2.render(i / fps, { samples, fps });
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 6) await yieldTask();
      if (i % 6 === 0) {
        $('#export-label').textContent = `Exporting ${Math.round((i / total) * 100)}%`;
        status(`Rendering frame ${i + 1} of ${total} with motion blur`, i / total);
        await yieldTask();
      }
    }
    await venc.flush();
    if (aenc) await aenc.flush();
    if (err) throw err;
    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    addFilm(blob, W, H);
    toast(`Film exported: ${W}×${H}, ${filmDuration().toFixed(1)} s${acfg ? ', with sound' : ''}. Download it under Your films.`);
  } catch (e) {
    toast(`Export failed: ${e.message}`, 'error');
  } finally {
    status(null);
    state.recording = false;
    btn.disabled = false;
    $('#export-label').textContent = 'Export MP4 with sound';
    draw(state.t);
  }
}
function addFilm(blob, W, H) {
  $('#clips-wrap').hidden = false;
  const url = URL.createObjectURL(blob);
  const v = el('video', { src: url, controls: true, playsinline: true });
  const name = `${(state.spec.title || 'massless').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-film-${H}p.mp4`;
  $('#clips').prepend(el('div', { class: 'clip fresh' }, v, el('div', { class: 'meta' }, el('span', {}, `${W}×${H} · ${(blob.size / 1e6).toFixed(1)} MB`), el('a', { class: 'dl', href: url, download: name }, 'Download'))));
  $('#clips-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- page ----------
function showTab(which) {
  const sheet = which === 'sheet';
  $('#t-brief').setAttribute('aria-selected', String(!sheet));
  $('#t-sheet').setAttribute('aria-selected', String(sheet));
  $('#tab-brief').hidden = sheet;
  $('#tab-sheet').hidden = !sheet;
}

function buildStatic(styles) {
  const sel = $('#style');
  sel.replaceChildren(...styles.map((s) => el('option', { value: s.id, selected: s.id === 'phonk' }, `${s.name} · ${s.bpm} BPM`)));
  sel.addEventListener('change', () => {
    const s = styles.find((x) => x.id === sel.value);
    if (s) { $('#bpm').value = s.bpm; $('#o-bpm').textContent = `${s.bpm} BPM`; }
  });
  const pals = $('#palettes');
  for (const [id, p] of Object.entries(PALETTES)) {
    const b = el('button', { type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(id === state.palette), title: p.name, 'aria-label': p.name },
      ...p.grounds.slice(0, 3).map((c) => el('i', { style: `background:${c}` })));
    b.addEventListener('click', () => {
      state.palette = id;
      pals.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      if (state.spec) { state.spec.palette = id; applySpec(state.spec, { rescore: false }); }
    });
    pals.append(b);
  }
  $('#block-grid').replaceChildren(...Object.values(BLOCKS).map((b) => el('div', { class: 'bk' }, el('strong', {}, b.name.toUpperCase()), el('span', {}, b.hint))));
}

async function init() {
  renderer = new FilmRenderer($('#film'));
  bindDialogs();
  const mod = await scoreModule();
  buildStatic(mod && Array.isArray(mod.STYLES) ? mod.STYLES : FALLBACK_STYLES);
  $('#t-brief').addEventListener('click', () => showTab('brief'));
  $('#t-sheet').addEventListener('click', () => showTab('sheet'));
  $('#make').addEventListener('click', make);
  $('#export').addEventListener('click', exportFilm);
  $('#play').addEventListener('click', () => (state.playing ? (stop(), draw(state.t)) : play()));
  $('#big-play').addEventListener('click', () => play());
  $('#film').addEventListener('click', () => (state.playing ? (stop(), draw(state.t)) : play()));
  $('#scrub').addEventListener('input', (e) => seek((Number(e.target.value) / 1000) * filmDuration()));
  $('#bpm').addEventListener('input', (e) => ($('#o-bpm').textContent = `${e.target.value} BPM`));
  $('#bpm').addEventListener('change', (e) => { if (state.spec) { state.spec.bpm = Number(e.target.value); applySpec(state.spec); } });
  $('#aspect').addEventListener('change', () => { sizePreview(); if (state.spec) draw(state.t); });
  const chars = () => ($('#o-brief').textContent = `${$('#brief').value.length} / 600`);
  $('#brief').addEventListener('input', chars);
  chars();
  document.addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#play').click(); } });
  sizePreview();
  window.addEventListener('resize', () => { if (!state.recording) { sizePreview(); if (state.spec) draw(state.t); } });
  await Promise.all(['900 80px "Big Shoulders Display"', '500 40px "Instrument Sans"', '600 40px "Instrument Sans"', '700 40px "Instrument Sans"'].map((f) => document.fonts.load(f).catch(() => {})));
  // a first film straight away, from the template (no model call until the visitor asks)
  const images = await stills();
  state.source = 'template';
  await applySpec(templateSpec({ name: $('#name').value, brief: $('#brief').value, style: $('#style').value, bpm: Number($('#bpm').value), palette: state.palette, length: 'standard', images }));
  draw(((state.lay.dropBeat + 0.6) * 60) / state.spec.bpm);
  window.massless = { state, renderer, make, exportFilm, applySpec, seek, play, stop };
}

init();
