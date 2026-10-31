import { VOICES, BEDS, MELO_LANGS, speak, speakMelo, renderBed, voiceBackend, MAX_BED_SECONDS } from '../audio-engine.js';
import * as T from '../transcribe.js';
import * as X from '../extract.js';
import * as store from '../store.js';
import { warmHuman } from '../human.js';
import { createMaster } from './audio-master.js';
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

// Master (its own module); setBusy and progress are function declarations, so they exist already
const master = createMaster({ $, state, setBusy: (...a) => setBusy(...a), progress: (...a) => progress(...a) });

// ---------- tabs ----------
const COPY = {
  voice: ['Turn text<br>into voiceover', 'Eight English voices on your own device, or six languages with MeloTTS on Cloudflare. Pair a voice with a sound bed and drop both under a clip from Video.'],
  cap: ['Captions from<br>any clip', 'Drop audio or video and get an editable transcript, plus .srt and .vtt captions with timestamps. Whisper large-v3-turbo, free.'],
  bed: ['Score the<br>scene', 'Rain, wind, ocean and city ambience synthesized from scratch in seconds. Fades at both ends, so it loops under any clip.'],
  ext: ['Extract audio<br>from video', 'Drop a video or audio file, pick MP3, M4A or WAV and press Convert. It all runs in this tab, so nothing is uploaded.'],
  master: ['Master<br>your mix', 'Drop a finished mix, read the report in plain words, pick a character and where it is going. Fair A/B, 24-bit WAV or MP3. It all runs in this tab.'],
};
const TABS = ['voice', 'cap', 'bed', 'ext', 'master'];
function showTab(which) {
  state.tab = which;
  for (const t of TABS) {
    const on = t === which;
    $(`#t-${t}`).setAttribute('aria-selected', String(on));
    $(`#tab-${t}`).hidden = !on;
    $(`#foot-${t}`).hidden = !on;
    $(`#p-${t}`).classList.toggle('on', on);
  }
  const files = which === 'cap' || which === 'ext' || which === 'master';
  if (which !== 'master') master.stop();
  $('#voice-view-cards').hidden = files;
  if (which === 'cap') warmHuman(); // Captions uses Whisper on Cloudflare
  $('#history-view').hidden = files;
  $('#cap-view').hidden = which !== 'cap';
  $('#ext-view').hidden = which !== 'ext';
  $('#master-view').hidden = which !== 'master';
  const tabBtn = $(`#t-${which}`);
  const row = tabBtn.parentElement;
  if (row.scrollWidth > row.clientWidth) row.scrollLeft += tabBtn.getBoundingClientRect().left - row.getBoundingClientRect().left - 12;
  $('#voice-view').hidden = which !== 'voice';
  $('#stage-title').innerHTML = COPY[which][0];
  $('#stage-sub').textContent = COPY[which][1];
  syncSource();
  if (which === 'ext') extCaps();
}
function syncSource() {
  let s;
  if (state.tab === 'cap') s = 'Whisper large-v3-turbo on Cloudflare Workers AI';
  else if (state.tab === 'ext' || state.tab === 'master') s = 'Runs in your browser · nothing is uploaded';
  else if (state.tab === 'voice' && state.engine === 'melo') s = 'MeloTTS on Cloudflare Workers AI';
  else s = voiceBackend() ? `Kokoro-82M on ${voiceBackend()}` : 'Kokoro-82M · loads on first use';
  $('#src-label').textContent = s;
}

// ---------- engines ----------
function selectEngine(id) {
  state.engine = id === 'melo' ? 'melo' : 'kokoro';
  const melo = state.engine === 'melo';
  if (melo) warmHuman(); // MeloTTS runs on Cloudflare
  document.querySelectorAll('#engines .engine').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === state.engine)));
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
const LABELS = { voice: 'Generate voice', bed: 'Render bed', cap: 'Transcribe', ext: 'Convert', master: 'Master' };
function progress(f, label) {
  const lbl = $(`#gen-${state.tab}-label`);
  lbl.textContent = label ? `${label}${f != null ? ` ${Math.round(f * 100)}%` : ''}` : 'Working…';
}
function setBusy(on, label) {
  state.busy = on;
  for (const t of TABS) {
    const b = $(`#gen-${t}`);
    b.disabled = on || (t === 'cap' && !cap.prep) || (t === 'ext' && !extTodo().length) || (t === 'master' && !master.ready());
    b.classList.toggle('busy', on);
    $(`#gen-${t}-label`).textContent = on && state.tab === t ? label || 'Working…' : t === 'ext' ? extLabel() : LABELS[t];
  }
  $('#cap-go-inline').hidden = !cap.prep;
  $('#cap-go-inline').disabled = on;
  $('#cap-go-inline').textContent = on && state.tab === 'cap' ? label || 'Working…' : 'Transcribe';
  syncExtInline();
  master.sync();
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
    await addItem({ type: 'voice', title: text, sub: `${v.name} · ${res.duration.toFixed(1)} s`, blob: res.blob, duration: res.duration, file: `chucksi-voice-${v.name.toLowerCase()}` }, true);
  } catch (e) { toast(`Voice failed: ${e.message}`, 'error'); } finally { setBusy(false); }
}

async function genMelo(text) {
  const l = MELO_LANGS.find((x) => x.id === state.lang) || MELO_LANGS[0];
  setBusy(true, 'Sending to Cloudflare');
  try {
    const res = await speakMelo(text, { lang: l.id, onProgress: progress });
    await addItem({ type: 'voice', title: text, sub: `MeloTTS · ${l.name} · ${res.duration.toFixed(1)} s`, blob: res.blob, duration: res.duration, file: `chucksi-voice-melotts-${l.id}` }, true);
  } catch (e) { toast(`Voice failed: ${e.message}`, 'error'); } finally { setBusy(false); }
}

async function genBed() {
  if (state.busy) return;
  setBusy(true, 'Rendering');
  const b = BEDS.find((x) => x.id === state.bed);
  const seconds = Math.min(MAX_BED_SECONDS, Number($('#length').value));
  try {
    const res = await renderBed(b.id, seconds, { intensity: Number($('#bed-intensity').value) });
    await addItem({ type: 'bed', title: `${b.name} bed`, sub: `${seconds} s · stereo 48 kHz`, blob: res.blob, duration: res.duration, file: `chucksi-bed-${b.id}` }, true);
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
    if (state.tab === 'ext') extAdd(e.dataTransfer.files);
    else if (state.tab === 'master') master.add(e.dataTransfer.files[0]);
    else pickFile(e.dataTransfer.files[0]);
  });
}

// ---------- extract audio ----------
const ext = { items: [], fmt: 'mp3', kbps: { mp3: 192, m4a: 192 }, mono: false, fadeIn: 0, fadeOut: 0, loud: false, aac: null, run: null };
const preview = new Audio();
let previewing = null;
let extSeq = 0;
let readChain = Promise.resolve();
const STEP = 0.1; // trim resolution, seconds
const KBPS_NOTE = {
  mp3: { 128: 'Fine for speech and podcasts. About 1 MB a minute.', 192: 'Good for music, and the usual pick. About 1.4 MB a minute.', 320: 'The most MP3 can hold. About 2.4 MB a minute.' },
  m4a: { 128: 'AAC sounds better than MP3 at the same size. About 1 MB a minute.', 192: 'Very good for music. About 1.4 MB a minute.', 256: 'The rate Apple Music uses. About 1.9 MB a minute.' },
};
const ENCODER = { mp3: 'LAME 3.100 · open source', m4a: 'AAC · this browser’s encoder', wav: '16-bit PCM · no encoder needed' };
const kHz = (r) => `${r / 1000} kHz`; // 48, 44.1, 22.05
const fsize = (b) => (b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} KB` : mb(b));
const chName = (n) => (n === 1 ? 'Mono' : n === 2 ? 'Stereo' : `${n} channels`);
const clockX = (t) => T.clock(t, 1);
const extSettings = () => ({ format: ext.fmt, kbps: ext.fmt === 'wav' ? 0 : ext.kbps[ext.fmt], mono: ext.mono, fadeIn: ext.fadeIn, fadeOut: ext.fadeOut, normalize: ext.loud });
const keyFor = (it, s = extSettings()) => [s.format, s.kbps, s.mono, s.fadeIn, s.fadeOut, s.normalize, it.start, it.end].join('|');
const needsWork = (it, s) => it.status === 'ready' && !it.ctl && (!it.result || it.result.key !== keyFor(it, s));
const extTodo = (s) => ext.items.filter((it) => needsWork(it, s));
function extLabel() {
  const n = extTodo().length;
  return n > 1 ? `Convert ${n} files` : 'Convert';
}
function syncExtInline() {
  const b = $('#ext-go-inline');
  b.hidden = !ext.items.length;
  b.disabled = state.busy || !extTodo().length;
  b.textContent = ext.run ? $('#gen-ext-label').textContent : extLabel();
}
function syncExt() {
  const n = ext.items.length;
  $('#ext-files').hidden = !n;
  $('#ext-drop').classList.toggle('compact', n > 0);
  $('#ext-drop-title').textContent = n ? 'Add more files' : 'Drop video or audio here';
  $('#ext-drop-sub').textContent = n
    ? `${n} file${n === 1 ? '' : 's'} below. Drop more here, or choose them. Nothing is uploaded.`
    : 'mp4, mov, webm, mp3, wav, m4a, ogg or flac. Add several at once. Nothing is uploaded.';
  $('#ext-choose').textContent = n ? 'Add files' : 'Choose files';
  const results = ext.items.filter((it) => it.result).length;
  $('#ext-all').hidden = results < 2;
  if (!state.busy) {
    $('#gen-ext').disabled = !extTodo().length;
    $('#gen-ext-label').textContent = extLabel();
  }
  syncExtInline();
  for (const it of ext.items) paintStatus(it);
}
function saveExt() {
  save('massless.extract', JSON.stringify({ fmt: ext.fmt, kbps: ext.kbps, mono: ext.mono, fadeIn: ext.fadeIn, fadeOut: ext.fadeOut, loud: ext.loud }));
}
function loadExt() {
  let d = null;
  try { d = JSON.parse(load('massless.extract') || 'null'); } catch {}
  if (!d) return;
  if (X.FORMATS[d.fmt]) ext.fmt = d.fmt;
  for (const f of ['mp3', 'm4a']) if (X.FORMATS[f].kbps.includes(d.kbps?.[f])) ext.kbps[f] = d.kbps[f];
  ext.mono = !!d.mono;
  ext.loud = !!d.loud;
  ext.fadeIn = Math.min(10, Math.max(0, Number(d.fadeIn) || 0));
  ext.fadeOut = Math.min(10, Math.max(0, Number(d.fadeOut) || 0));
}

// format, quality and options
let wantM4a = false; // M4A was the saved choice: pick it again once the encoder check says yes
async function extCaps() {
  if (ext.aac) return;
  const c = await X.caps();
  if (ext.aac) return;
  ext.aac = c.aac || [];
  const off = !ext.aac.length;
  const m4a = $('.engine[data-fmt="m4a"]');
  m4a.classList.toggle('off', off);
  m4a.setAttribute('aria-disabled', String(off));
  $('#ext-m4a-note').textContent = off ? 'Not in this browser' : 'Smaller files';
  if (!off && wantM4a) selectFormat('m4a');
  else buildKbps();
  wantM4a = false;
}
function selectFormat(id, persist = true) {
  if (id === 'm4a' && !ext.aac?.length) {
    toast(ext.aac ? 'This browser can’t make M4A files. MP3 plays everywhere, or try Chrome, Edge or Safari on a Mac or PC.' : 'Checking what this browser can encode…');
    return;
  }
  ext.fmt = X.FORMATS[id] ? id : 'mp3';
  wantM4a = false;
  document.querySelectorAll('#ext-fmts .engine').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.fmt === ext.fmt)));
  buildKbps();
  if (persist) saveExt();
  syncExt();
  if (ext.fmt === 'mp3' && ext.items.length) X.warm();
}
function buildKbps() {
  const f = X.FORMATS[ext.fmt];
  const opts = ext.fmt === 'm4a' ? f.kbps.filter((k) => (ext.aac || f.kbps).includes(k)) : f.kbps;
  if (opts.length && !opts.includes(ext.kbps[ext.fmt])) ext.kbps[ext.fmt] = opts.includes(f.def) ? f.def : opts[0];
  const box = $('#ext-kbps');
  box.replaceChildren(...opts.map((k) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(k === ext.kbps[ext.fmt]), 'data-kbps': k, onclick: () => selectKbps(k) }, `${k} kbps`)));
  box.hidden = !opts.length;
  const wav = ext.fmt === 'wav';
  $('#o-ext-q').textContent = wav ? '16-bit PCM' : `${ext.kbps[ext.fmt]} kbps`;
  $('#ext-q-note').textContent = wav ? 'Uncompressed, for editing. About 10 MB a minute in stereo.' : KBPS_NOTE[ext.fmt][ext.kbps[ext.fmt]] || '';
  $('#ext-enc').textContent = ENCODER[ext.fmt];
}
function selectKbps(k) {
  ext.kbps[ext.fmt] = k;
  buildKbps();
  saveExt();
  syncExt();
}
function syncOptions() {
  $('#ext-mono').checked = ext.mono;
  $('#ext-loud').checked = ext.loud;
  $('#ext-fi').value = ext.fadeIn;
  $('#ext-fo').value = ext.fadeOut;
  $('#o-ext-fi').textContent = ext.fadeIn ? `${ext.fadeIn} s` : 'Off';
  $('#o-ext-fo').textContent = ext.fadeOut ? `${ext.fadeOut} s` : 'Off';
}

// the queue
function extAdd(files) {
  const list = [...(files || [])];
  if (!list.length) return;
  if (state.tab !== 'ext') showTab('ext');
  let skipped = 0;
  for (const file of list) {
    if (!X.looksLikeMedia(file)) { skipped++; continue; }
    const it = { id: `x${++extSeq}`, file, name: file.name, size: file.size, status: 'reading', start: 0, end: 0, duration: 0 };
    ext.items.push(it);
    $('#ext-queue').append(extCard(it));
    readChain = readChain.then(() => extRead(it));
  }
  if (skipped) toast(skipped === list.length ? 'Choose a video or audio file.' : `Skipped ${skipped} file${skipped === 1 ? '' : 's'} that ${skipped === 1 ? 'isn’t' : 'aren’t'} audio or video.`, 'error');
  syncExt();
  if (ext.fmt === 'mp3' && ext.items.length) X.warm();
}
async function extRead(it) {
  if (!ext.items.includes(it)) return;
  try {
    const info = await X.read(it.file, it.id, (f) => {
      if (it.status !== 'reading') return;
      it.statusEl.textContent = `Reading the audio… ${Math.round(f * 100)}%`;
      it.meterEl.classList.remove('indeterminate');
      it.meterEl.firstChild.style.width = `${Math.round(f * 100)}%`;
    });
    Object.assign(it, info, { status: 'ready', start: 0, end: info.duration });
  } catch (e) {
    it.status = 'error';
    it.error = e.message;
  }
  if (!ext.items.includes(it)) { X.forget(it.id); return; }
  fillCard(it);
  syncExt();
  if (it.status === 'error') toast(`${it.name}: ${it.error}`, 'error');
}
function extRemove(it) {
  it.ctl?.abort();
  if (previewing === it) stopPreview();
  if (it.result) URL.revokeObjectURL(it.result.url);
  if (it.url) URL.revokeObjectURL(it.url);
  X.forget(it.id);
  ext.items = ext.items.filter((x) => x !== it);
  it.el.remove();
  syncExt();
}
function extClear() {
  for (const it of [...ext.items]) extRemove(it);
}

const ICON_VIDEO = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3.5" width="9" height="9" rx="1.5"/><path d="M10.5 7l4-2.5v7l-4-2.5"/></svg>';
const ICON_AUDIO = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 12V3.5l7-1.5v8.5"/><circle cx="4.3" cy="12" r="1.8"/><circle cx="11.3" cy="10.5" r="1.8"/></svg>';
function extCard(it) {
  const x = el('button', { type: 'button', class: 'xc-x', 'aria-label': `Remove ${it.name}`, html: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>' });
  x.addEventListener('click', () => extRemove(it));
  it.metaEl = el('span', { class: 'xc-meta' }, `${fsize(it.size)} · reading…`);
  it.icoEl = el('span', { class: 'xc-ico', html: /^video\//.test(it.file.type) ? ICON_VIDEO : ICON_AUDIO });
  it.statusEl = el('span', { class: 'xc-status' }, 'Reading the audio…');
  it.meterEl = el('div', { class: 'meter indeterminate' }, el('div', { class: 'meter-fill' }));
  it.bodyEl = el('div', { class: 'xc-body' });
  it.el = el('li', { class: 'xcard reading', 'data-id': it.id },
    el('div', { class: 'xc-head' }, it.icoEl, el('div', { class: 't' }, el('strong', { title: it.name }, it.name), it.metaEl), x),
    it.bodyEl,
    el('div', { class: 'xc-foot' }, it.statusEl, it.meterEl));
  return it.el;
}
/** Once read: the waveform with trim handles, the time fields, the play and download buttons. */
function fillCard(it) {
  it.el.classList.remove('reading');
  it.meterEl.classList.remove('indeterminate');
  if (it.status === 'error') {
    it.el.classList.add('error');
    it.metaEl.textContent = fsize(it.size);
    it.statusEl.textContent = it.error;
    it.statusEl.classList.add('err');
    it.meterEl.hidden = true;
    return;
  }
  it.icoEl.innerHTML = it.video ? ICON_VIDEO : ICON_AUDIO;
  it.metaEl.textContent = `${clockX(it.duration)} · ${chName(it.channels)} · ${kHz(it.sampleRate)} · ${fsize(it.size)}`;
  it.canvas = el('canvas', { 'aria-hidden': 'true' });
  it.handles = ['start', 'end'].map((which) => {
    const h = el('div', { class: `xc-h ${which}`, role: 'slider', tabindex: 0, 'aria-label': which === 'start' ? `Trim start of ${it.name}` : `Trim end of ${it.name}`, 'aria-valuemin': 0, 'aria-valuemax': it.duration.toFixed(1) });
    h.addEventListener('keydown', (e) => {
      const d = (e.shiftKey ? 10 : 1) * STEP;
      const cur = it[which];
      const to = { ArrowLeft: cur - d, ArrowDown: cur - d, ArrowRight: cur + d, ArrowUp: cur + d, Home: 0, End: it.duration, PageDown: cur - 10, PageUp: cur + 10 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      setTrim(it, which, to);
    });
    return h;
  });
  it.playhead = el('div', { class: 'xc-ph', hidden: true });
  const wave = el('div', { class: 'xc-wave' }, it.canvas, it.playhead, ...it.handles);
  bindWave(it, wave);
  it.playEl = el('button', { type: 'button', class: 'vplay', 'aria-label': `Play the selection of ${it.name}`, html: PLAY });
  it.playEl.addEventListener('click', () => togglePreview(it));
  it.startIn = timeField(it, 'start');
  it.endIn = timeField(it, 'end');
  it.lenEl = el('output', { class: 'xc-len' });
  it.dlEl = el('a', { class: 'btn-accent small xc-dl', hidden: true }, 'Download');
  it.bodyEl.append(wave, el('div', { class: 'xc-row' }, it.playEl,
    el('label', { class: 'xc-time' }, el('small', {}, 'Start'), it.startIn),
    el('label', { class: 'xc-time' }, el('small', {}, 'End'), it.endIn),
    el('span', { class: 'xc-lenw' }, el('small', {}, 'Length'), it.lenEl),
    it.dlEl));
  waveObserver.observe(wave);
  syncTrim(it);
}
function timeField(it, which) {
  const input = el('input', { class: 'xt', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', 'aria-label': `${which === 'start' ? 'Start' : 'End'} time of ${it.name}` });
  input.addEventListener('change', () => {
    const t = T.parseTime(input.value);
    if (!Number.isFinite(t)) { toast('Type a time like 1:05.5 or 65.5.', 'error'); syncTrim(it); return; }
    setTrim(it, which, t);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  return input;
}
function setTrim(it, which, t) {
  const D = it.duration;
  let v = Math.round(t / STEP) / (1 / STEP);
  if (t >= D - STEP / 2) v = D;
  if (which === 'start') it.start = Math.max(0, Math.min(v, it.end - X.MIN_SECONDS));
  else it.end = Math.min(D, Math.max(v, it.start + X.MIN_SECONDS));
  syncTrim(it);
  syncExt();
}
function syncTrim(it) {
  const D = it.duration;
  it.handles.forEach((h, i) => {
    const t = i ? it.end : it.start;
    h.style.left = `${(t / D) * 100}%`;
    h.setAttribute('aria-valuenow', t.toFixed(1));
    h.setAttribute('aria-valuetext', clockX(t));
  });
  if (document.activeElement !== it.startIn) it.startIn.value = clockX(it.start);
  if (document.activeElement !== it.endIn) it.endIn.value = clockX(it.end);
  it.lenEl.textContent = clockX(it.end - it.start);
  drawTrim(it);
}
/** Drag on the waveform: the nearer handle follows. A touch only drags once it moves sideways, so the page still scrolls. */
function bindWave(it, wave) {
  let drag = null;
  const at = (e) => {
    const r = wave.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * it.duration;
  };
  wave.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const t = at(e);
    const which = Math.abs(t - it.start) <= Math.abs(t - it.end) ? 'start' : 'end';
    drag = { id: e.pointerId, x: e.clientX, which, live: e.pointerType === 'mouse' };
    if (drag.live) { e.preventDefault(); wave.setPointerCapture(e.pointerId); setTrim(it, which, t); it.handles[which === 'start' ? 0 : 1].focus({ preventScroll: true }); }
  });
  wave.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.live && Math.abs(e.clientX - drag.x) > 6) { drag.live = true; wave.setPointerCapture(e.pointerId); }
    if (drag.live) setTrim(it, drag.which, at(e));
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.live && e.type === 'pointerup') setTrim(it, drag.which, at(e)); // a tap moves the nearer handle there
    drag = null;
  };
  wave.addEventListener('pointerup', end);
  wave.addEventListener('pointercancel', () => (drag = null));
}
const fadeEnv = (p, len) => {
  const fi = Math.min(ext.fadeIn, len / 2);
  const fo = Math.min(ext.fadeOut, len / 2);
  let g = 1;
  if (fi && p < fi) g *= 0.5 - 0.5 * Math.cos((Math.PI * p) / fi);
  if (fo && len - p < fo) g *= 0.5 - 0.5 * Math.cos((Math.PI * (len - p)) / fo);
  return g;
};
function drawTrim(it) {
  const c = it.canvas;
  if (!c || !it.peaks) return;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w || !h) return;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const pk = it.peaks;
  const bars = Math.max(24, Math.floor(w / 3));
  const bw = w / bars;
  const D = it.duration;
  const len = it.end - it.start;
  for (let i = 0; i < bars; i++) {
    const a = Math.floor((i * pk.length) / bars);
    const b = Math.max(a + 1, Math.floor(((i + 1) * pk.length) / bars));
    let m = 0;
    for (let j = a; j < b; j++) if (pk[j] > m) m = pk[j];
    const t = ((i + 0.5) / bars) * D;
    const inside = t >= it.start && t <= it.end;
    const amp = inside ? m * fadeEnv(t - it.start, len) : m;
    const bh = Math.max(2, amp * (h - 6));
    g.fillStyle = inside ? '#ffbf2f' : '#3b3b41';
    g.fillRect(i * bw + 0.5, (h - bh) / 2, Math.max(1, bw - 1), bh);
  }
}
const waveObserver = new ResizeObserver((entries) => {
  for (const e of entries) {
    const it = ext.items.find((x) => x.canvas && e.target.contains(x.canvas));
    if (it) drawTrim(it);
  }
});
function paintStatus(it) {
  if (!it.statusEl || it.status === 'reading' || it.status === 'error') return;
  const s = it.statusEl;
  const busy = !!it.job;
  const fresh = it.result && it.result.key === keyFor(it);
  it.el.classList.toggle('busy', busy);
  it.el.classList.toggle('done', !!fresh && !busy);
  s.classList.toggle('err', !!it.convError && !busy);
  if (busy) {
    const f = it.job.f;
    s.textContent = f == null ? `${it.job.label}…` : `${it.job.label} ${Math.round(f * 100)}%`;
  } else if (it.convError) s.textContent = it.convError;
  else if (ext.run && needsWork(it, ext.run)) s.textContent = 'Waiting';
  else if (fresh) s.textContent = `${X.FORMATS[it.result.fmt].label} · ${fsize(it.result.size)} · ${clockX(it.result.duration)}${it.result.note || ''}`;
  else if (it.result) s.textContent = 'Settings changed. Press Convert for a new file.';
  else s.textContent = 'Ready';
  it.meterEl.classList.toggle('indeterminate', busy && it.job.f == null);
  it.meterEl.firstChild.style.width = busy ? `${Math.round((it.job.f || 0) * 100)}%` : '0%';
  it.meterEl.hidden = !busy;
  if (it.dlEl) {
    it.dlEl.hidden = !it.result || busy;
    if (it.result) {
      it.dlEl.href = it.result.url;
      it.dlEl.download = it.result.name;
      it.dlEl.textContent = `Download ${X.FORMATS[it.result.fmt].label}`;
      it.dlEl.classList.toggle('stale', !fresh);
    }
  }
}
function setResult(it, r, s) {
  if (it.result) URL.revokeObjectURL(it.result.url);
  const ext2 = X.FORMATS[s.format].ext;
  let name = X.outputName(it.name, ext2);
  const taken = new Set(ext.items.filter((x) => x !== it && x.result).map((x) => x.result.name.toLowerCase()));
  for (let k = 2; taken.has(name.toLowerCase()); k++) name = X.outputName(it.name, ext2).replace(/(\.[^.]+)$/, ` (${k})$1`);
  const note = s.normalize && Number.isFinite(r.gainDb) && Math.abs(r.gainDb) >= 0.1 ? ` · ${r.gainDb > 0 ? '+' : '−'}${Math.abs(r.gainDb).toFixed(1)} dB` : '';
  it.result = { blob: r.blob, url: URL.createObjectURL(r.blob), name, key: keyFor(it, s), fmt: s.format, size: r.blob.size, duration: r.duration, note };
}

async function genExtract() {
  if (state.busy) { if (!ext.run) toast('One job at a time. Try again in a moment.'); return; }
  if (!ext.items.length) { $('#ext-in').click(); return; }
  const s = extSettings();
  if (!extTodo(s).length) {
    toast(ext.items.some((it) => it.status === 'reading') ? 'Still reading your files. One moment.' : 'All converted. Change a setting or add a file to convert again.');
    return;
  }
  ext.run = s;
  setBusy(true, 'Converting');
  let made = 0;
  let failed = 0;
  let last = null;
  const tried = new Set();
  try {
    for (let n = 1; ; n++) {
      const it = ext.items.find((x) => needsWork(x, s) && !tried.has(x));
      if (!it) break;
      tried.add(it);
      const total = n - 1 + ext.items.filter((x) => needsWork(x, s) && !tried.has(x)).length + 1;
      const ctl = new AbortController();
      it.ctl = ctl;
      it.convError = null;
      it.job = { f: null, label: 'Starting' };
      syncExt();
      const label = (f, l) => {
        it.job = { f, label: l };
        paintStatus(it);
        const pct = f == null ? '' : ` ${Math.round(f * 100)}%`;
        const text = total > 1 ? `Converting ${n} of ${total}${pct}` : `${l === 'Converting' ? 'Converting' : l}${pct}`;
        $('#gen-ext-label').textContent = text;
        syncExtInline();
      };
      try {
        const r = await X.convert(it, s, { signal: ctl.signal, onProgress: label });
        it.job = null;
        it.ctl = null;
        if (!ext.items.includes(it)) continue;
        setResult(it, r, s);
        made++;
        last = it;
      } catch (e) {
        it.job = null;
        it.ctl = null;
        if (e.name === 'AbortError' || !ext.items.includes(it)) continue;
        it.convError = e.message;
        failed++;
        toast(`${it.name}: ${e.message}`, 'error');
      }
      syncExt();
    }
  } finally {
    ext.run = null;
    setBusy(false);
    syncExt();
  }
  if (made === 1 && !failed) toast(`Ready: ${last.result.name}, ${fsize(last.result.size)}. Download it from the list.`);
  else if (made > 1) toast(`${made} files converted${failed ? `, ${failed} failed` : ''}. Download them from the list.`);
}
async function downloadAll() {
  const done = ext.items.filter((it) => it.result);
  for (const [i, it] of done.entries()) {
    if (i) await new Promise((r) => setTimeout(r, 400)); // browsers drop downloads that arrive together
    download(it.result.blob, it.result.name);
  }
}

// preview: play the selection with a media element (it plays the sound of a video too)
function togglePreview(it) {
  if (previewing === it && !preview.paused) { stopPreview(); return; }
  stopPreview();
  if (playingBtn) { player.pause(); playingBtn.innerHTML = PLAY; playingBtn = null; }
  it.url ||= URL.createObjectURL(it.file);
  previewing = it;
  if (preview.src !== it.url) preview.src = it.url;
  const go = () => {
    if (previewing !== it) return;
    preview.currentTime = it.start;
    preview.play().then(() => {
      it.playEl.innerHTML = PAUSE;
      it.playhead.hidden = false;
      requestAnimationFrame(function tick() {
        if (previewing !== it || preview.paused) return;
        const t = preview.currentTime;
        if (t >= it.end) { stopPreview(); return; }
        it.playhead.style.left = `${(t / it.duration) * 100}%`;
        requestAnimationFrame(tick);
      });
    }).catch(() => { stopPreview(); toast('This browser can’t play this file here, but it can still convert it.'); });
  };
  if (preview.readyState >= 1) go();
  else preview.addEventListener('loadedmetadata', go, { once: true });
}
function stopPreview() {
  preview.pause();
  if (previewing) {
    previewing.playEl.innerHTML = PLAY;
    previewing.playhead.hidden = true;
  }
  previewing = null;
}
preview.addEventListener('ended', stopPreview);
preview.addEventListener('error', () => { if (previewing) { stopPreview(); toast('This browser can’t play this file here, but it can still convert it.'); } });

function bindExtract() {
  loadExt();
  syncOptions();
  document.querySelectorAll('#ext-fmts .engine').forEach((b) => b.addEventListener('click', () => selectFormat(b.dataset.fmt)));
  if (ext.fmt === 'm4a') {
    // M4A waits for the encoder check; show MP3 meanwhile without forgetting the choice
    selectFormat('mp3', false);
    wantM4a = true;
    extCaps();
  } else selectFormat(ext.fmt, false);
  $('#ext-mono').addEventListener('change', (e) => { ext.mono = e.target.checked; saveExt(); syncExt(); });
  $('#ext-loud').addEventListener('change', (e) => { ext.loud = e.target.checked; saveExt(); syncExt(); });
  for (const [id, k] of [['#ext-fi', 'fadeIn'], ['#ext-fo', 'fadeOut']]) {
    $(id).addEventListener('input', (e) => {
      ext[k] = Number(e.target.value);
      syncOptions();
      saveExt();
      syncExt();
      for (const it of ext.items) drawTrim(it);
    });
  }
  $('#ext-in').addEventListener('change', (e) => { extAdd(e.target.files); e.target.value = ''; });
  $('#gen-ext').addEventListener('click', genExtract);
  $('#ext-go-inline').addEventListener('click', genExtract);
  $('#ext-clear').addEventListener('click', extClear);
  $('#ext-all').addEventListener('click', downloadAll);
  syncExt();
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
    el('div', { class: 't' }, el('strong', { title: item.title }, item.title), el('span', {}, item.unsaved ? 'Not saved — download before leaving' : `${item.type === 'voice' ? 'Voiceover' : 'Sound bed'} · ${item.sub}`)),
    canvas,
    el('a', { href: url, download: name }, 'Download WAV'));
  requestAnimationFrame(() => drawWave(canvas, item.peaks || []));
  return row;
}
async function addItem(data, autoplay) {
  const item = { id: `audio-${Date.now()}-${Math.floor(Math.random() * 1e4)}`, kind: 'audio', created: Date.now(), ...data };
  item.peaks = await peaks(item.blob);
  try { await store.put(item); } catch { item.unsaved = true; }
  const row = rowFor(item, true);
  $('#history').prepend(row);
  syncHistory();
  if (autoplay) playUrl(URL.createObjectURL(item.blob), row.querySelector('.play'));
  row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (item.unsaved) toast('Browser storage could not save this audio. Download the WAV before leaving.', 'error');
  else toast(`${item.type === 'voice' ? 'Voiceover' : 'Sound bed'} ready: ${item.duration.toFixed(1)} s WAV.`);
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
    $(`#p-${t}`)?.addEventListener('click', () => showTab(t));
  }
  document.querySelectorAll('#engines .engine').forEach((b) => b.addEventListener('click', () => selectEngine(b.dataset.id)));
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
  bindExtract();
  master.bind();
  restoreDraft();
  const p = new URLSearchParams(location.search);
  if (location.hash === '#beds' || p.get('tab') === 'beds') showTab('bed');
  else if (location.hash === '#captions' || p.get('tab') === 'captions') showTab('cap');
  else if (location.hash === '#extract' || p.get('tab') === 'extract') showTab('ext');
  else if (location.hash === '#master' || p.get('tab') === 'master') showTab('master');
  else showTab('voice');
  if (['kokoro', 'melo'].includes(p.get('engine'))) selectEngine(p.get('engine'));
  else if (p.get('lang')) selectEngine('melo');
  if (p.get('lang') && MELO_LANGS.some((l) => l.id === p.get('lang'))) selectLang(p.get('lang'));
  if (p.get('text')) { $('#script').value = p.get('text').slice(0, 2000); chars(); }
  restoreHistory();
  animateCards();
  window.massless = { state: { ...state, recording: false }, genVoice, genBed, genCaptions, genExtract, selectEngine, selectLang, showTab, cap, ext, extract: X, master: master.m };
}

init();

const incomingMediaId=new URLSearchParams(location.search).get('shot');
if(incomingMediaId)store.get(incomingMediaId).then(item=>{if(item?.blob&&(item.blob.type.startsWith('audio/')||item.blob.type.startsWith('video/'))){const f=new File([item.blob],item.name||'Saved media',{type:item.blob.type});if(state.tab==='master')master.add(f,item.id);else pickFile(f);}}).catch(()=>toast('Could not load the saved media.', 'error'));
