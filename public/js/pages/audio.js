import { VOICES, BEDS, speak, renderBed, voiceBackend, MAX_BED_SECONDS } from '../audio-engine.js';
import * as store from '../store.js';
import { bindDialogs, toast, el, download } from '../ui.js';

const $ = (s) => document.querySelector(s);
const PLAY = '<svg viewBox="0 0 16 16"><path d="M4.5 2.5v11l9-5.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>';
const state = { voice: VOICES[0].id, bed: BEDS[0].id, busy: false, tab: 'voice' };
const player = new Audio();
let playingBtn = null;

// ---------- tabs ----------
const COPY = {
  voice: ['Turn text<br>into voiceover', 'Eight open voices with natural pacing, generated on your own device. Pair a voice with a sound bed and drop both under a clip from Video.'],
  bed: ['Score the<br>scene', 'Rain, wind, ocean and city ambience synthesized from scratch in seconds. Fades at both ends, so it loops under any clip.'],
};
function showTab(which) {
  state.tab = which;
  const bed = which === 'bed';
  $('#t-voice').setAttribute('aria-selected', String(!bed));
  $('#t-bed').setAttribute('aria-selected', String(bed));
  $('#tab-voice').hidden = bed;
  $('#tab-bed').hidden = !bed;
  $('#foot-voice').hidden = bed;
  $('#foot-bed').hidden = !bed;
  $('#p-voice').classList.toggle('on', !bed);
  $('#p-bed').classList.toggle('on', bed);
  $('#stage-title').innerHTML = COPY[which][0];
  $('#stage-sub').textContent = COPY[which][1];
}

// ---------- voices ----------
function selectVoice(id) {
  const v = VOICES.find((x) => x.id === id) || VOICES[0];
  state.voice = v.id;
  $('#voice-name').textContent = `${v.name} · ${v.accent} ${v.gender.toLowerCase()}`;
  $('#voice-avatar').textContent = v.name[0];
  document.querySelectorAll('.vcard').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.id === v.id)));
  try { localStorage.setItem('massless.voice', v.id); } catch {}
}
function buildVoices() {
  const box = $('#voices');
  for (const v of VOICES) {
    const preview = el('button', { type: 'button', class: 'vplay', 'aria-label': `Hear ${v.name}`, html: PLAY });
    const card = el('div', { class: 'vcard', role: 'radio', tabindex: 0, 'aria-checked': 'false', 'data-id': v.id },
      el('span', { class: 'avatar' }, v.name[0]),
      el('span', { class: 'vt' }, el('strong', {}, v.name), el('span', {}, `${v.accent} · ${v.gender}`), el('em', {}, v.note)),
      preview);
    card.addEventListener('click', (e) => { if (!e.target.closest('.vplay')) selectVoice(v.id); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectVoice(v.id); } });
    preview.addEventListener('click', () => previewVoice(v, preview));
    box.append(card);
  }
}
const previews = new Map();
async function previewVoice(v, btn) {
  if (previews.has(v.id)) return playUrl(previews.get(v.id), btn);
  if (state.busy) { toast('One generation at a time. Try again in a moment.'); return; }
  btn.classList.add('busy');
  setBusy(true, 'Loading voice');
  try {
    const res = await speak(`Hi, I'm ${v.name}. This line was spoken on your own device, for free.`, { voice: v.id, onProgress: progress });
    previews.set(v.id, res.url);
    playUrl(res.url, btn);
  } catch (e) { toast(`Voice failed: ${e.message}`, 'error'); } finally { btn.classList.remove('busy'); setBusy(false); }
}

// ---------- beds ----------
function buildBeds() {
  const box = $('#beds');
  for (const b of BEDS) {
    const btn = el('button', { type: 'button', class: 'bed', role: 'radio', 'aria-checked': String(b.id === state.bed), 'data-id': b.id }, el('strong', {}, b.name), el('span', {}, b.note));
    btn.addEventListener('click', () => { state.bed = b.id; box.querySelectorAll('.bed').forEach((x) => x.setAttribute('aria-checked', String(x === btn))); });
    box.append(btn);
  }
}

// ---------- generation ----------
function progress(f, label) {
  const lbl = state.tab === 'bed' ? $('#gen-bed-label') : $('#gen-voice-label');
  lbl.textContent = label ? `${label}${f != null ? ` ${Math.round(f * 100)}%` : ''}` : 'Working…';
}
function setBusy(on, label) {
  state.busy = on;
  for (const id of ['gen-voice', 'gen-bed']) { $(`#${id}`).disabled = on; $(`#${id}`).classList.toggle('busy', on); }
  $('#gen-voice-label').textContent = on && state.tab === 'voice' ? label || 'Working…' : 'Generate voice';
  $('#gen-bed-label').textContent = on && state.tab === 'bed' ? label || 'Working…' : 'Render bed';
  if (!on && voiceBackend()) $('#src-label').textContent = `Kokoro-82M on ${voiceBackend()}`;
}

async function genVoice() {
  const text = $('#script').value.trim();
  if (!text) { toast('Write a script first.', 'error'); $('#script').focus(); return; }
  if (state.busy) return;
  setBusy(true, 'Loading voice');
  const v = VOICES.find((x) => x.id === state.voice);
  try {
    const res = await speak(text, { voice: v.id, speed: Number($('#speed').value), onProgress: progress });
    await addItem({ type: 'voice', title: text, sub: `${v.name} · ${res.duration.toFixed(1)} s`, blob: res.blob, duration: res.duration, file: `massless-voice-${v.name.toLowerCase()}` }, true);
  } catch (e) { toast(`Voice failed: ${e.message}`, 'error'); } finally { setBusy(false); }
}

async function genBed() {
  if (state.busy) return;
  setBusy(true, 'Rendering');
  const b = BEDS.find((x) => x.id === state.bed);
  const seconds = Math.min(MAX_BED_SECONDS, Number($('#length').value));
  try {
    const res = await renderBed(b.id, seconds, { intensity: Number($('#bed-intensity').value) });
    await addItem({ type: 'bed', title: `${b.name} bed`, sub: `${seconds} s · stereo 48 kHz`, blob: res.blob, duration: res.duration, file: `massless-bed-${b.id}` }, true);
  } catch (e) { toast(`Render failed: ${e.message}`, 'error'); } finally { setBusy(false); }
}

// ---------- history ----------
async function peaks(blob, n = 90) {
  try {
    const ctx = new OfflineAudioContext(1, 1, 24000);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const d = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(d.length / n));
    const out = [];
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = i * step, e = Math.min(d.length, j + step); j < e; j += 4) m = Math.max(m, Math.abs(d[j]));
      out.push(m);
    }
    const top = Math.max(...out, 1e-4);
    return out.map((x) => x / top);
  } catch { return []; }
}
function drawWave(canvas, pk, color = '#ffbf2f') {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 180;
  const h = canvas.clientHeight || 34;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = color;
  const bw = w / Math.max(pk.length, 1);
  pk.forEach((p, i) => { const bh = Math.max(2, p * h * 0.92); g.fillRect(i * bw + 0.5, (h - bh) / 2, Math.max(1, bw - 1.5), bh); });
}
function playUrl(url, btn) {
  if (playingBtn && playingBtn !== btn) playingBtn.innerHTML = PLAY;
  if (playingBtn === btn && !player.paused) { player.pause(); btn.innerHTML = PLAY; return; }
  player.src = url;
  player.play().catch(() => {});
  btn.innerHTML = PAUSE;
  playingBtn = btn;
}
player.addEventListener('ended', () => { if (playingBtn) playingBtn.innerHTML = PLAY; playingBtn = null; });

function rowFor(item, fresh = false) {
  const url = URL.createObjectURL(item.blob);
  const play = el('button', { type: 'button', class: 'play', 'aria-label': `Play ${item.title}`, html: PLAY });
  play.addEventListener('click', () => playUrl(url, play));
  const canvas = el('canvas', { 'aria-hidden': 'true' });
  const name = `${item.file}-${item.id.slice(-5)}.wav`;
  const row = el('div', { class: `hrow${fresh ? ' fresh' : ''}`, 'data-id': item.id },
    play,
    el('div', { class: 't' }, el('strong', { title: item.title }, item.title), el('span', {}, `${item.type === 'voice' ? 'Voiceover' : 'Sound bed'} · ${item.sub}`)),
    canvas,
    el('a', { href: url, download: name }, 'Download WAV'));
  requestAnimationFrame(() => drawWave(canvas, item.peaks || []));
  return row;
}
async function addItem(data, autoplay) {
  const item = { id: `audio-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, kind: 'audio', created: Date.now(), ...data };
  item.peaks = await peaks(item.blob);
  await store.put(item).catch(() => {});
  const row = rowFor(item, true);
  $('#history').prepend(row);
  syncHistory();
  if (autoplay) playUrl(URL.createObjectURL(item.blob), row.querySelector('.play'));
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  toast(`${item.type === 'voice' ? 'Voiceover' : 'Sound bed'} ready: ${item.duration.toFixed(1)} s WAV.`);
}
function syncHistory() {
  const n = $('#history').children.length;
  $('#history-empty').hidden = n > 0;
  $('#clear-history').hidden = n === 0;
}
async function restoreHistory() {
  const items = (await store.all().catch(() => [])).filter((x) => x.kind === 'audio').sort((a, b) => b.created - a.created);
  for (const it of items) $('#history').append(rowFor(it));
  syncHistory();
}
async function clearHistory() {
  const items = (await store.all().catch(() => [])).filter((x) => x.kind === 'audio');
  await Promise.all(items.map((x) => store.del(x.id).catch(() => {})));
  $('#history').innerHTML = '';
  player.pause();
  syncHistory();
}

// ---------- decorative waves on the feature cards ----------
function animateCards() {
  const cards = [$('#wave-a'), $('#wave-b')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw = (now) => {
    for (const [i, c] of cards.entries()) {
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (!w) continue;
      if (c.width !== w) { c.width = w; c.height = h; }
      const g = c.getContext('2d');
      g.clearRect(0, 0, w, h);
      const t = now / 1000;
      const n = i === 0 ? 64 : 40;
      const bw = w / n;
      g.fillStyle = i === 0 ? 'rgba(255,191,47,0.95)' : 'rgba(255,255,255,0.9)';
      for (let k = 0; k < n; k++) {
        const x = k / n;
        const env = i === 0 ? Math.max(0.08, Math.abs(Math.sin(x * 9 + t * 2.1)) * Math.sin(Math.PI * x) * (0.55 + 0.45 * Math.sin(t * 3.3 + x * 20))) : 0.25 + 0.2 * Math.sin(x * 5 + t * 0.9) + 0.12 * Math.sin(x * 23 - t * 2.4);
        const bh = env * h * 0.62;
        g.fillRect(k * bw + bw * 0.2, h * 0.5 - bh / 2, bw * 0.6, bh);
      }
    }
    if (!reduce) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

// ---------- init ----------
function init() {
  buildVoices();
  buildBeds();
  let saved = null;
  try { saved = localStorage.getItem('massless.voice'); } catch {}
  selectVoice(saved || VOICES[0].id);
  bindDialogs();
  $('#t-voice').addEventListener('click', () => showTab('voice'));
  $('#t-bed').addEventListener('click', () => showTab('bed'));
  $('#p-voice').addEventListener('click', () => showTab('voice'));
  $('#p-bed').addEventListener('click', () => showTab('bed'));
  $('#voice-sel').addEventListener('click', () => $('#voices-head').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  const chars = () => ($('#o-chars').textContent = `${$('#script').value.length} / 2000`);
  $('#script').addEventListener('input', chars);
  chars();
  $('#script').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) genVoice(); });
  $('#speed').addEventListener('input', (e) => ($('#o-speed').textContent = `${Number(e.target.value).toFixed(2)}×`));
  $('#length').addEventListener('input', (e) => ($('#o-length').textContent = `${e.target.value} s`));
  $('#bed-intensity').addEventListener('input', (e) => ($('#o-bed-intensity').textContent = `${Math.round(e.target.value * 100)}%`));
  $('#gen-voice').addEventListener('click', genVoice);
  $('#gen-bed').addEventListener('click', genBed);
  $('#clear-history').addEventListener('click', clearHistory);
  const p = new URLSearchParams(location.search);
  if (location.hash === '#beds' || p.get('tab') === 'beds') showTab('bed');
  if (p.get('text')) { $('#script').value = p.get('text').slice(0, 2000); chars(); }
  restoreHistory();
  animateCards();
  window.massless = { state: { ...state, recording: false }, genVoice, genBed };
}

init();
