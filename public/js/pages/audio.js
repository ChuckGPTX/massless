import { VOICES, BEDS, MELO_LANGS, speak, speakMelo, renderBed, voiceBackend, MAX_BED_SECONDS } from '../audio-engine.js';
import * as T from '../transcribe.js';
import * as store from '../store.js';
import { bindDialogs, toast, el, download } from '../ui.js';

const $ = (s) => document.querySelector(s);
const PLAY = '<svg viewBox="0 0 16 16"><path d="M4.5 2.5v11l9-5.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>';
const state = { voice: VOICES[0].id, engine: 'kokoro', lang: MELO_LANGS[0].id, bed: BEDS[0].id, busy: false, tab: 'voice' };
const cap = { file: null, prep: null, results: [], key: '', segments: [], language: '', translated: false };
const player = new Audio();
let playingBtn = null;
const save = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

// ---------- tabs ----------
const COPY = {
  voice: ['Turn text<br>into voiceover', 'Eight English voices on your own device, or six languages with MeloTTS on Cloudflare. Pair a voice with a sound bed and drop both under a clip from Video.'],
  cap: ['Captions from<br>any clip', 'Drop audio or video and get an editable transcript, plus .srt and .vtt captions with timestamps. Whisper large-v3-turbo, free.'],
  bed: ['Score the<br>scene', 'Rain, wind, ocean and city ambience synthesized from scratch in seconds. Fades at both ends, so it loops under any clip.'],
};
const TABS = ['voice', 'cap', 'bed'];
function showTab(which) {
  state.tab = which;
  for (const t of TABS) {
    const on = t === which;
    $(`#t-${t}`).setAttribute('aria-selected', String(on));
    $(`#tab-${t}`).hidden = !on;
    $(`#foot-${t}`).hidden = !on;
    $(`#p-${t}`).classList.toggle('on', on);
  }
  const captions = which === 'cap';
  $('#voice-view-cards').hidden = captions;
  $('#history-view').hidden = captions;
  $('#cap-view').hidden = !captions;
  $('#voice-view').hidden = which !== 'voice';
  $('#stage-title').innerHTML = COPY[which][0];
  $('#stage-sub').textContent = COPY[which][1];
  syncSource();
}
function syncSource() {
  let s;
  if (state.tab === 'cap') s = 'Whisper large-v3-turbo on Cloudflare Workers AI';
  else if (state.tab === 'voice' && state.engine === 'melo') s = 'MeloTTS on Cloudflare Workers AI';
  else s = voiceBackend() ? `Kokoro-82M on ${voiceBackend()}` : 'Kokoro-82M · loads on first use';
  $('#src-label').textContent = s;
}

// ---------- engines ----------
function selectEngine(id) {
  state.engine = id === 'melo' ? 'melo' : 'kokoro';
  const melo = state.engine === 'melo';
  document.querySelectorAll('.engine').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === state.engine)));
  $('#voices').hidden = melo;
  $('#langs').hidden = !melo;
  $('#voices-title').textContent = melo ? 'Languages' : 'Voices';
  $('#voices-hint').textContent = melo ? 'One MeloTTS voice per language · ▶ hear a line (sent to Cloudflare)' : 'Tap to choose · ▶ to hear a line';
  $('#model-name').textContent = melo ? 'MeloTTS · open weights (MIT)' : 'Kokoro-82M · open weights';
  $('#voice-note').textContent = melo
    ? 'Your script is sent to Cloudflare Workers AI to be spoken, in chunks under 1,000 characters, and the audio comes back here. Nothing is stored. There is a daily free limit.'
    : 'The first voice downloads the model once (about 90 MB), then it runs offline in this tab. Nothing you type leaves your device.';
  $('#speed').disabled = melo;
  $('#speed-field').classList.toggle('off', melo);
  $('#speed-note').hidden = !melo;
  if (melo) selectLang(state.lang); else selectVoice(state.voice);
  save('massless.voiceEngine', state.engine);
  syncSource();
}

// ---------- voices ----------
function selectVoice(id) {
  const v = VOICES.find((x) => x.id === id) || VOICES[0];
  state.voice = v.id;
  document.querySelectorAll('#voices .vcard').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.id === v.id)));
  save('massless.voice', v.id);
  if (state.engine !== 'kokoro') return;
  $('#voice-kind').textContent = 'Voice';
  $('#voice-name').textContent = `${v.name} · ${v.accent} ${v.gender.toLowerCase()}`;
  $('#voice-avatar').textContent = v.name[0];
  $('#voice-avatar').classList.remove('tag');
}
function selectLang(id) {
  const l = MELO_LANGS.find((x) => x.id === id) || MELO_LANGS[0];
  state.lang = l.id;
  document.querySelectorAll('#langs .vcard').forEach((c) => c.setAttribute('aria-checked', String(c.dataset.id === l.id)));
  save('massless.meloLang', l.id);
  if (state.engine !== 'melo') return;
  $('#voice-kind').textContent = 'Language';
  $('#voice-name').textContent = l.native === l.name ? l.name : `${l.name} · ${l.native}`;
  $('#voice-avatar').textContent = l.tag;
  $('#voice-avatar').classList.add('tag');
}
function radioCard(id, avatar, title, sub, note, onPick, onPreview, label, tag) {
  const preview = el('button', { type: 'button', class: 'vplay', 'aria-label': label, html: PLAY });
  const card = el('div', { class: 'vcard', role: 'radio', tabindex: 0, 'aria-checked': 'false', 'data-id': id },
    el('span', { class: `avatar${tag ? ' tag' : ''}` }, avatar),
    el('span', { class: 'vt' }, el('strong', {}, title), sub, el('em', {}, note)),
    preview);
  card.addEventListener('click', (e) => { if (!e.target.closest('.vplay')) onPick(id); });
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(id); } });
  preview.addEventListener('click', () => onPreview(preview));
  return card;
}
function buildVoices() {
  for (const v of VOICES) {
    $('#voices').append(radioCard(v.id, v.name[0], v.name, el('span', {}, `${v.accent} · ${v.gender}`), v.note, selectVoice, (b) => previewVoice(v, b), `Hear ${v.name}`));
  }
  for (const l of MELO_LANGS) {
    const sub = el('span', {}, l.native === l.name ? 'MeloTTS voice' : el('span', { class: 'native' }, l.native), l.native === l.name ? null : ' · MeloTTS voice');
    $('#langs').append(radioCard(l.id, l.tag, l.name, sub, `“${l.sample}”`, selectLang, (b) => previewLang(l, b), `Hear ${l.name}`, true));
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
async function previewLang(l, btn) {
  const key = `melo-${l.id}`;
  if (previews.has(key)) return playUrl(previews.get(key), btn);
  if (state.busy) { toast('One generation at a time. Try again in a moment.'); return; }
  btn.classList.add('busy');
  setBusy(true, 'Speaking');
  try {
    const res = await speakMelo(l.sample, { lang: l.id, onProgress: progress });
    previews.set(key, res.url);
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
const LABELS = { voice: 'Generate voice', bed: 'Render bed', cap: 'Transcribe' };
function progress(f, label) {
  const lbl = $(`#gen-${state.tab}-label`);
  lbl.textContent = label ? `${label}${f != null ? ` ${Math.round(f * 100)}%` : ''}` : 'Working…';
}
function setBusy(on, label) {
  state.busy = on;
  for (const t of TABS) {
    const b = $(`#gen-${t}`);
    b.disabled = on || (t === 'cap' && !cap.prep);
    b.classList.toggle('busy', on);
    $(`#gen-${t}-label`).textContent = on && state.tab === t ? label || 'Working…' : LABELS[t];
  }
  $('#cap-go-inline').hidden = !cap.prep;
  $('#cap-go-inline').disabled = on;
  $('#cap-go-inline').textContent = on && state.tab === 'cap' ? label || 'Working…' : 'Transcribe';
  if (!on) syncSource();
}

async function genVoice() {
  const text = $('#script').value.trim();
  if (!text) { toast('Write a script first.', 'error'); $('#script').focus(); return; }
  if (state.busy) return;
  if (state.engine === 'melo') return genMelo(text);
  setBusy(true, 'Loading voice');
  const v = VOICES.find((x) => x.id === state.voice);
  try {
    const res = await speak(text, { voice: v.id, speed: Number($('#speed').value), onProgress: progress });
    await addItem({ type: 'voice', title: text, sub: `${v.name} · ${res.duration.toFixed(1)} s`, blob: res.blob, duration: res.duration, file: `massless-voice-${v.name.toLowerCase()}` }, true);
  } catch (e) { toast(`Voice failed: ${e.message}`, 'error'); } finally { setBusy(false); }
}

async function genMelo(text) {
  const l = MELO_LANGS.find((x) => x.id === state.lang) || MELO_LANGS[0];
  setBusy(true, 'Sending to Cloudflare');
  try {
    const res = await speakMelo(text, { lang: l.id, onProgress: progress });
    await addItem({ type: 'voice', title: text, sub: `MeloTTS · ${l.name} · ${res.duration.toFixed(1)} s`, blob: res.blob, duration: res.duration, file: `massless-voice-melotts-${l.id}` }, true);
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

// ---------- captions ----------
const fmtMin = (t) => T.clock(t, 0);
const mb = (bytes) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
async function pickFile(file) {
  if (!file) return;
  if (state.busy) { toast('Wait for the current job to finish.'); return; }
  if (!/^(audio|video)\//.test(file.type) && !/\.(mp3|wav|m4a|mp4|mov|webm|ogg|opus|flac|aac|mkv)$/i.test(file.name)) {
    toast('Choose an audio or video file.', 'error');
    return;
  }
  showTab('cap');
  cap.file = file;
  cap.prep = null;
  cap.results = [];
  $('#cap-file-name').textContent = file.name;
  $('#cap-drop-title').textContent = file.name;
  $('#cap-drop-sub').textContent = 'Reading the audio in this tab…';
  $('#cap-drop').classList.add('compact');
  $('#cap-parts').hidden = true;
  setBusy(true, 'Reading file');
  try {
    cap.prep = await T.prepareAudio(file);
    const { duration, parts } = cap.prep;
    const bytes = parts.reduce((a, p) => a + 44 + Math.round((p.end - p.start) * T.ASR_RATE) * 2, 0);
    $('#cap-drop-sub').textContent = `${fmtMin(duration)} · ${mb(bytes)} of 16 kHz mono to send${parts.length > 1 ? ` in ${parts.length} parts` : ''}. Nothing is sent until you press Transcribe.`;
    renderParts();
  } catch (e) {
    cap.file = null;
    $('#cap-file-name').textContent = 'Choose audio or video';
    $('#cap-drop-title').textContent = 'Drop audio or video here';
    $('#cap-drop-sub').textContent = e.message;
    toast(e.message, 'error');
  } finally { setBusy(false); }
}
function renderParts(status = []) {
  const box = $('#cap-parts');
  box.innerHTML = '';
  const parts = cap.prep?.parts || [];
  if (parts.length < 2 && !status.length) { box.hidden = true; return; }
  box.hidden = false;
  parts.forEach((p, i) => {
    const st = status[i] || (cap.results[i] ? 'done' : 'waiting');
    const word = { waiting: 'Waiting', sending: 'Transcribing…', done: 'Done', error: 'Failed' }[st];
    box.append(el('li', { class: `part ${st}`, 'data-part': i },
      el('span', { class: 'n' }, String(i + 1)),
      el('span', {}, el('strong', {}, `Part ${i + 1} of ${parts.length}`), el('span', { class: 'span' }, `  ${fmtMin(p.start)}–${fmtMin(p.end)}`)),
      el('span', { class: 'st' }, word),
      el('div', { class: `meter${st === 'sending' ? ' indeterminate' : ''}` }, el('div', { class: 'meter-fill' }))));
  });
}
async function genCaptions() {
  if (state.busy) return;
  if (!cap.prep) { $('#cap-in').click(); return; }
  const lang = $('#cap-lang').value;
  const translate = $('#cap-translate').checked;
  const key = `${cap.file.name}|${cap.file.size}|${lang}|${translate}`;
  if (cap.key !== key) cap.results = [];
  cap.key = key;
  const n = cap.prep.parts.length;
  const status = cap.prep.parts.map((_, i) => (cap.results[i] ? 'done' : 'waiting'));
  renderParts(status);
  setBusy(true, n > 1 ? `Part 1 of ${n}` : 'Transcribing');
  try {
    const out = await T.transcribeParts(cap.prep.samples, cap.prep.parts, {
      lang, translate, done: cap.results,
      onPart: (i, st, info) => {
        status[i] = st;
        if (st === 'done') cap.results[i] = info;
        renderParts(status);
        if (st === 'sending') { const l = n > 1 ? `Part ${i + 1} of ${n}` : 'Transcribing'; progress(null, l); $('#cap-go-inline').textContent = l; }
      },
    });
    cap.segments = out.segments;
    cap.language = out.language;
    cap.translated = translate;
    showTranscript();
    saveDraft();
    toast(out.segments.length ? `Transcript ready: ${out.segments.length} segment${out.segments.length === 1 ? '' : 's'}.` : 'No speech found in that file.');
  } catch (e) {
    if (e.results) cap.results = e.results;
    toast(`Transcription stopped: ${e.message}${n > 1 ? ' Press Transcribe to retry; finished parts are kept.' : ''}`, 'error');
  } finally { setBusy(false); }
}
function showTranscript() {
  $('#cap-result').hidden = false;
  $('#cap-text').value = T.formatTranscript(cap.segments);
  syncCapMeta();
}
function syncCapMeta() {
  const segs = currentSegments();
  const end = segs.length ? segs[segs.length - 1].end : 0;
  let langName = T.ASR_LANGS.find(([id]) => id === cap.language)?.[1] || cap.language;
  if (cap.translated) langName = langName && langName !== 'English' ? `${langName} → English` : 'English';
  $('#cap-count').textContent = `${segs.length} segment${segs.length === 1 ? '' : 's'} · ${fmtMin(end)}${langName ? ` · ${langName}` : ''}`;
}
function currentSegments() {
  return T.parseTranscript($('#cap-text').value, cap.segments);
}
function capName(ext) {
  const base = (cap.file?.name || cap.draftName || 'captions').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'captions';
  return `${base}.${ext}`;
}
function exportCaptions(kind) {
  const segs = currentSegments();
  if (!segs.length) { toast('The transcript is empty.', 'error'); return; }
  if (kind === 'txt') return download(new Blob([T.toText(segs)], { type: 'text/plain' }), capName('txt'));
  const cues = T.buildCues(segs);
  if (kind === 'srt') return download(new Blob([T.toSrt(cues)], { type: 'application/x-subrip' }), capName('srt'));
  return download(new Blob([T.toVtt(cues)], { type: 'text/vtt' }), capName('vtt'));
}
function saveDraft() {
  try { localStorage.setItem('massless.captions', JSON.stringify({ name: cap.file?.name || cap.draftName || '', language: cap.language, translated: cap.translated, segments: cap.segments, text: $('#cap-text').value })); } catch {}
}
function restoreDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem('massless.captions') || 'null'); } catch {}
  if (!d?.segments?.length) return;
  cap.segments = d.segments;
  cap.language = d.language || '';
  cap.translated = !!d.translated;
  cap.draftName = d.name;
  showTranscript();
  if (d.text) $('#cap-text').value = d.text;
  syncCapMeta();
}
function bindDrop() {
  const stage = $('.stage');
  let depth = 0;
  const has = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  stage.addEventListener('dragenter', (e) => { if (!has(e)) return; e.preventDefault(); depth++; stage.classList.add('dragging'); });
  stage.addEventListener('dragover', (e) => { if (has(e)) e.preventDefault(); });
  stage.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; stage.classList.remove('dragging'); } });
  stage.addEventListener('drop', (e) => {
    if (!has(e)) return;
    e.preventDefault();
    depth = 0;
    stage.classList.remove('dragging');
    pickFile(e.dataTransfer.files[0]);
  });
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
  state.voice = load('massless.voice') || VOICES[0].id;
  state.lang = load('massless.meloLang') || MELO_LANGS[0].id;
  selectVoice(state.voice);
  selectLang(state.lang);
  selectEngine(load('massless.voiceEngine') || 'kokoro');
  for (const [id, name] of T.ASR_LANGS) $('#cap-lang').append(el('option', { value: id }, name));
  bindDialogs();
  for (const t of TABS) {
    $(`#t-${t}`).addEventListener('click', () => showTab(t));
    $(`#p-${t}`).addEventListener('click', () => showTab(t));
  }
  document.querySelectorAll('.engine').forEach((b) => b.addEventListener('click', () => selectEngine(b.dataset.id)));
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
  $('#gen-cap').addEventListener('click', genCaptions);
  $('#cap-go-inline').addEventListener('click', genCaptions);
  $('#cap-file-sel').addEventListener('click', () => $('#cap-in').click());
  $('#cap-in').addEventListener('change', (e) => { pickFile(e.target.files[0]); e.target.value = ''; });
  $('#cap-text').addEventListener('input', () => { syncCapMeta(); saveDraft(); });
  $('#cap-txt').addEventListener('click', () => exportCaptions('txt'));
  $('#cap-srt').addEventListener('click', () => exportCaptions('srt'));
  $('#cap-vtt').addEventListener('click', () => exportCaptions('vtt'));
  $('#cap-copy').addEventListener('click', () => {
    navigator.clipboard?.writeText(T.toText(currentSegments())).then(() => toast('Transcript copied.'), () => toast('Copy failed. Select the text and copy it.', 'error'));
  });
  $('#clear-history').addEventListener('click', clearHistory);
  bindDrop();
  restoreDraft();
  const p = new URLSearchParams(location.search);
  if (location.hash === '#beds' || p.get('tab') === 'beds') showTab('bed');
  else if (location.hash === '#captions' || p.get('tab') === 'captions') showTab('cap');
  else showTab('voice');
  if (p.get('engine') === 'melo' || p.get('lang')) selectEngine('melo');
  if (p.get('lang') && MELO_LANGS.some((l) => l.id === p.get('lang'))) selectLang(p.get('lang'));
  if (p.get('text')) { $('#script').value = p.get('text').slice(0, 2000); chars(); }
  restoreHistory();
  animateCards();
  window.massless = { state: { ...state, recording: false }, genVoice, genBed, genCaptions, selectEngine, selectLang, showTab, cap };
}

init();
