import { gather, fetchLink, AUDIO_EXT } from '../mix/intake.js';
import { openSong, splitSong, stemsFromSplit, gpuReady, prefetch, deviceFitsSplit } from '../mix/split.js';
import { runMix } from '../mix/engine.js';
import { GENRES, TIPS } from '../mix/rules.js';
import { ROLES, ROLE_IDS, roleFromName } from '../mix/roles.js';
import { looksLikeRough } from '../mix/rough.js';
import { TrickPanel, heroConsole, drawPeaks, drawEqThumb, splitArt, SPLIT_PARTS } from '../mix/visuals.js';
import { fmtHz } from '../mix/plan.js';
import { apiFetch, warmHuman } from '../human.js';
import * as X from '../extract.js';

const $ = (s) => document.querySelector(s);
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const GENRE_NOTES = {
  hiphop: 'Vocal up front, punchy and dry', trap: 'Huge 808, crisp hats, FX vocals', drill: 'Sliding 808s, dark and tight',
  rnb: 'Silky vocals, lush space', pop: 'Bright, wide, polished', rock: 'Guitars wide, vocal inside the band',
  edm: 'Loud, wide, pumping', afrobeats: 'Bouncy low end, open percussion', lofi: 'Warm, soft top, tape feel',
  country: 'Natural, clear vocal', latin: 'Dembow forward, big low end',
};
const params = new URLSearchParams(location.search);
const state = { mode: params.get('mode') === 'song' ? 'song' : 'stems', song: null, method: 'split', split: null, roughFile: null, stems: [], sessions: [], roles: [], genre: GENRES[params.get('genre')] ? params.get('genre') : 'hiphop', refFile: null, result: null, ctrl: null, macros: null };

// ---------- intake ----------
const stopHero = heroConsole($('#hero-console'));

function buildGenres() {
  const box = $('#genres');
  box.replaceChildren(...Object.entries(GENRES).map(([id, g]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'genre'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(id === state.genre));
    b.innerHTML = '<i aria-hidden="true"></i><b></b><span></span>';
    b.querySelector('b').textContent = g.name.replace(' / ', ' · ');
    b.querySelector('span').textContent = GENRE_NOTES[id] || '';
    b.onclick = () => { state.genre = id; buildGenres(); };
    return b;
  }));
}

function note(text, warn = false) { const n = $('#intake-note'); n.textContent = text; n.classList.toggle('warn', warn); }

async function take(files) {
  if (!files?.length) return;
  // One audio file that isn't named like a part, with nothing else here yet: that's a whole song.
  const only = files.length === 1 ? files[0] : null;
  if (only && !state.stems.length && AUDIO_EXT.test(only.name) && !(only.webkitRelativePath || only.relativePath) && !roleFromName(only.name)) {
    setMode('song'); await takeSong(only);
    if (state.song) note(`One file, so it’s treated as the whole song${fits ? ': we split it into stems first' : ''}. Was it a single stem? Switch to “I have stems”.`);
    return;
  }
  note('Opening your session…');
  try {
    const zipFile = [...files].find((f) => /\.zip$/i.test(f.name));
    if (zipFile) state.zipName = zipFile.name;
    const g = await gather([...files]);
    if (!g.stems.length) { note(g.sessions.length ? `That ${g.sessions[0]} session has no audio files inside. Export or consolidate every track as a stem from bar 1, then drop the folder or a zip.` : 'No audio files found. Drop WAV, AIFF, MP3 or FLAC stems, or a zip of them.', true); return; }
    // add to what's already there (people drop the vocals, then the beat)
    const keys = new Set(state.stems.map((s) => s.path + s.size));
    for (const s of g.stems) if (!keys.has(s.path + s.size)) state.stems.push(s);
    state.roles = state.stems.map((s, i) => state.roles[i] || '');
    // The full bounce, if it came along: the best-named candidate becomes the rough mix.
    if (!state.roughFile && !state.roles.includes('rough')) {
      const paths = state.stems.map((x) => x.path), cands = state.stems.map((x, i) => i).filter((i) => looksLikeRough(paths[i], paths));
      if (cands.length) { const best = cands.sort((a, b) => (/rough|bounce|mixdown|full/i.test(paths[b]) - /rough|bounce|mixdown|full/i.test(paths[a])) || state.stems[b].size - state.stems[a].size)[0]; state.roles[best] = 'rough'; }
    }
    renderStems(); roughStatus();
    const sess = g.sessions.length ? ` Found a ${g.sessions.join(' and ')} session: its clips are placed by that app, so we mix the audio files as they are. For the best result, export every track as a stem from bar 1.` : '';
    note(`${state.stems.length} track${state.stems.length === 1 ? '' : 's'} ready.${g.skipped.length ? ` Skipped ${g.skipped.length} file${g.skipped.length === 1 ? '' : 's'} that aren't audio.` : ''}${sess}`, !!sess);
    warmHuman();
  } catch (e) { note(e.message || 'Couldn’t open those files.', true); }
  updateStart();
}

function renderStems() {
  const list = $('#stem-list');
  list.hidden = !state.stems.length || state.mode !== 'stems';
  list.replaceChildren(...state.stems.map((s, i) => {
    const li = document.createElement('li');
    const guess = roleFromName(s.path);
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = ROLES[state.roles[i] || guess]?.color || '#555';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = s.name; nm.title = s.path;
    const sel = document.createElement('select'); sel.setAttribute('aria-label', `What is ${s.name}?`);
    sel.append(new Option(guess ? `${ROLES[guess].name}` : 'Auto-detect', ''));
    sel.append(new Option('Rough mix (reference)', 'rough'), new Option('Leave out', 'skip'));
    for (const id of ROLE_IDS) if (id !== guess) sel.append(new Option(ROLES[id].name, id));
    sel.value = state.roles[i] && state.roles[i] !== guess ? state.roles[i] : '';
    if (state.roles[i] === 'rough' || state.roles[i] === 'skip') li.classList.add(state.roles[i]);
    if (state.roles[i] === 'rough') sw.style.background = '#e8e4f2';
    sel.onchange = () => {
      if (sel.value === 'rough') { state.roles = state.roles.map((r) => (r === 'rough' ? '' : r)); state.roughFile = null; $('#rough-file').value = ''; }
      state.roles[i] = sel.value; renderStems(); roughStatus();
    };
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'text-button'; rm.textContent = '✕'; rm.setAttribute('aria-label', `Remove ${s.name}`);
    rm.onclick = () => { state.stems.splice(i, 1); state.roles.splice(i, 1); renderStems(); updateStart(); note(`${state.stems.length} tracks ready.`); };
    li.append(sw, nm, sel, rm);
    return li;
  }));
}

const drop = $('#drop');
for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  const items = [...(e.dataTransfer.items || [])].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  if (items.some((en) => en.isDirectory)) take(await readEntries(items));
  else take(e.dataTransfer.files);
});
async function readEntries(entries, prefix = '') {
  const out = [];
  for (const en of entries) {
    if (en.isFile) out.push(await new Promise((res, rej) => en.file((f) => { f.relativePath = prefix + f.name; res(f); }, rej)));
    else if (en.isDirectory) {
      const reader = en.createReader(), kids = [];
      for (;;) { const batch = await new Promise((res, rej) => reader.readEntries(res, rej)); if (!batch.length) break; kids.push(...batch); }
      out.push(...(await readEntries(kids, `${prefix}${en.name}/`)));
    }
  }
  return out;
}
$('#stem-files').onchange = (e) => { take(e.target.files); e.target.value = ''; };
$('#pick-folder').onclick = (e) => { e.preventDefault(); e.stopPropagation(); $('#stem-folder').click(); };
$('#stem-folder').onchange = (e) => { take(e.target.files); e.target.value = ''; };
$('#fetch-link').onclick = async () => {
  const url = $('#stem-link').value.trim();
  if (!url) { note('Paste a Dropbox or Google Drive link first.', true); return; }
  $('#fetch-link').disabled = true;
  try {
    const file = await fetchLink(url, { apiFetch, onProgress: (k, got) => note(`Downloading… ${k ? Math.round(k * 100) + '%' : (got / 1048576).toFixed(0) + ' MB'}`) });
    await take([file]);
  } catch (e) { note(e.message, true); }
  finally { $('#fetch-link').disabled = false; }
};
function roughStatus() {
  const k = state.roles.indexOf('rough'), row = $('#rough-row');
  const name = state.roughFile?.name || (k >= 0 ? state.stems[k].path.split('/').pop() : '');
  row.classList.toggle('found', !!name);
  $('#rough-file-name').textContent = name ? 'Use a different file' : 'Add your rough mix';
  $('#rough-status').textContent = name ? `Using ${name} as your rough mix. Every stem gets lined up with it, your balance guides the mix, and the finished song is checked against it.` : 'The full song as you bounced it, before mixing. We line every stem up with it, follow your balance, leave out takes you didn\u2019t use, and check the finished song plays every part.';
}
$('#rough-file').onchange = (e) => { state.roughFile = e.target.files[0] || null; if (state.roughFile) state.roles = state.roles.map((r) => (r === 'rough' ? '' : r)); renderStems(); roughStatus(); };
$('#ref-file').onchange = (e) => { state.refFile = e.target.files[0] || null; $('#ref-file-name').textContent = state.refFile ? state.refFile.name : 'Add a reference file'; };
$('#mix-form').onsubmit = (e) => { e.preventDefault(); start(); };

// ---------- one song file ----------
let stopArt = null, gpuP = null, fetching = null;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function updateStart() {
  const song = state.mode === 'song', b = $('#start');
  b.disabled = song ? !state.song : !state.stems.length;
  b.textContent = song ? (state.method === 'split' ? 'Split & mix my song ↗' : 'Polish my song ↗') : 'Mix my song ↗';
}
function setMode(m) {
  state.mode = m;
  $('#mode-stems').setAttribute('aria-selected', String(m === 'stems')); $('#mode-song').setAttribute('aria-selected', String(m === 'song'));
  $('#stems-pane').hidden = m !== 'stems'; $('#song-pane').hidden = m !== 'song';
  $('#step1-sub').textContent = m === 'stems' ? 'Stems (WAV, AIFF, MP3, FLAC), a .zip, a DAW session folder, or a link.' : 'One finished song, unmixed or rough. We split it into parts, mix each one and master it.';
  if (m === 'song') stopArt ||= splitArt($('#split-art'));
  renderStems(); note(''); updateStart();
}
$('#mode-stems').onclick = () => setMode('stems');
$('#mode-song').onclick = () => setMode('song');
// Splitting needs about 3 GB of memory: phones and small devices polish instead of having the tab killed.
let fits = deviceFitsSplit();
function pickMethod(m) {
  state.method = m;
  document.querySelectorAll('[data-method]').forEach((x) => x.setAttribute('aria-checked', String(x.dataset.method === m)));
  if (m === 'split' && state.song) getSplitter();
  updateStart();
}
function markSplit() {
  const card = document.querySelector('[data-method="split"]');
  card.classList.toggle('off', !fits); card.setAttribute('aria-disabled', String(!fits));
  if (!fits && state.method === 'split') pickMethod('polish');
}
for (const b of document.querySelectorAll('[data-method]')) b.onclick = () => {
  if (b.dataset.method === 'split' && !fits) { note('Split & mix needs about 3 GB of memory, more than this browser gives one page. Open chucksi.com/mix on a computer to split, or use Quick polish here.', true); return; }
  pickMethod(b.dataset.method);
};

async function takeSong(file) {
  if (!file) return;
  if (!AUDIO_EXT.test(file.name) && !/^audio\//.test(file.type)) { note('That isn’t an audio file. Drop an MP3, WAV, M4A or FLAC.', true); return; }
  note('Opening your song…');
  try {
    const s = await openSong(file);
    state.song = { file, ...s }; state.split = null;
    $('#song-drop').hidden = true; $('#song-card').hidden = false;
    $('#song-name').textContent = file.name.replace(/\.[^.]+$/, '');
    $('#song-meta').textContent = `${fmt(s.duration)} · ${(file.size / 1048576).toFixed(1)} MB · ${(file.name.split('.').pop() || 'audio').toUpperCase()}`;
    drawSongWave(); note(''); warmHuman(); markSplit();
    speedHint().then(() => { if (fits && state.method === 'split') getSplitter(); });
  } catch (e) { note(e.message || 'Couldn’t open that file. Try an MP3 or WAV.', true); }
  updateStart();
}
function drawSongWave() {
  const cv = $('#song-wave'), g = cv.getContext('2d'), w = cv.width, h = cv.height, p = state.song.peaks, top = Math.max(1e-6, ...p);
  const grad = g.createLinearGradient(0, 0, w, 0); grad.addColorStop(0, '#ffbf2f'); grad.addColorStop(0.55, '#a98bff'); grad.addColorStop(1, '#46d6ff');
  g.clearRect(0, 0, w, h); g.fillStyle = grad;
  for (let x = 0; x < w; x += 3) { const v = p[Math.floor((x / w) * p.length)] / top, bar = Math.max(2, v * (h - 8)); g.fillRect(x, (h - bar) / 2, 2, bar); }
}
async function speedHint() {
  const el = $('#split-speed');
  if (!fits) { el.classList.add('slow'); el.textContent = 'Needs a computer: splitting takes about 3 GB of memory, more than a phone browser allows.'; return false; }
  const gpu = await (gpuP ||= gpuReady()), mins = (state.song?.duration || 180) / 60;
  el.classList.toggle('slow', !gpu);
  el.textContent = gpu ? `Runs on your graphics chip, usually ${mins < 4 ? 'a minute or two' : 'a few minutes'}. One-time 181 MB download.`
    : `This browser can’t use your graphics chip, so splitting takes about ${Math.max(3, Math.round(mins * 3))} minutes. One-time 181 MB download.`;
  return gpu;
}
/** Download the splitter in the background while the genre gets picked. */
function getSplitter() {
  fetching ||= prefetch((d) => { if (state.method === 'split' && d.stage === 'download') $('#split-speed').textContent = `${d.label}…`; })
    .then((ok) => { if (ok && state.method === 'split') speedHint().then((gpu) => { $('#split-speed').textContent = 'Splitter downloaded. ' + $('#split-speed').textContent.replace(/ One-time 181 MB download\./, ''); }); if (!ok) fetching = null; return ok; });
  return fetching;
}
$('#song-file').onchange = (e) => { takeSong(e.target.files[0]); e.target.value = ''; };
$('#song-change').onclick = () => { state.song = null; state.split = null; $('#song-card').hidden = true; $('#song-drop').hidden = false; updateStart(); };
{
  const sd = $('#song-drop');
  for (const ev of ['dragenter', 'dragover']) sd.addEventListener(ev, (e) => { e.preventDefault(); sd.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) sd.addEventListener(ev, () => sd.classList.remove('over'));
  sd.addEventListener('drop', (e) => { e.preventDefault(); const f = [...(e.dataTransfer.files || [])].find((x) => AUDIO_EXT.test(x.name) || /^audio\//.test(x.type)); if (f) takeSong(f); else note('Drop one audio file: MP3, WAV, M4A or FLAC.', true); });
}

// ---------- the session ----------
let panel, tipTimer, lanes = [];
function show(id) { for (const s of ['intake', 'session', 'result', 'failed']) $('#' + s).hidden = s !== id; scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' }); }

function lane(i, name, role, color, peaks) {
  const el = document.createElement('div'); el.className = 'lane';
  el.innerHTML = '<div class="ln"><span class="sw"></span><div><b></b><small></small></div></div><canvas width="900" height="76"></canvas><div class="chips"></div>';
  el.querySelector('.sw').style.background = color; el.querySelector('b').textContent = name; el.querySelector('small').textContent = ROLES[role].name;
  el.style.animationDelay = `${Math.min(i, 8) * 40}ms`;
  $('#lanes').append(el);
  drawPeaks(el.querySelector('canvas'), peaks, color, 1);
  lanes[i] = { el, peaks, color };
}

const TRICK_TEXT = {
  eq: (n, p) => { const c = p.eq.filter((e) => e.gain < -0.4).slice(0, 2), b = p.eq.filter((e) => e.gain > 0.4).slice(0, 2); return `${n}: ${[p.hpf ? `high-pass at ${fmtHz(p.hpf)}` : '', ...c.map((e) => `cut ${fmtHz(e.f)} ${e.gain.toFixed(1)} dB`), ...b.map((e) => `lift ${fmtHz(e.f)} +${e.gain.toFixed(1)} dB`)].filter(Boolean).join(', ')}.`; },
  comp: (n, p) => `${n}: ${p.comp.ratio}:1 with a ${Math.round(p.comp.attack * 1000)} ms attack${p.comp2 ? `, then ${p.comp2.ratio}:1 to smooth it` : ''}.`,
  sidechain: (n) => `${n} ducks a few dB every time the kick hits, so the low end stays tight and loud.`,
  deess: (n, p) => `${n}: the “s” sounds around ${fmtHz(p.deess?.f || 6800)} are turned down only when they jump out.`,
  pan: (n, p) => `${n} goes ${Math.abs(p.pan) < 0.05 ? 'to the centre' : `${Math.round(Math.abs(p.pan) * 100)}% ${p.pan < 0 ? 'left' : 'right'}`}${p.width > 1.05 ? `, ${Math.round((p.width - 1) * 100)}% wider` : ''}.`,
};
function alignText(r) {
  const bits = [];
  bits.push(r.moved?.length ? `Moved ${r.moved.map((m) => `${m.name} ${m.ms > 0 ? '+' : ''}${(m.ms / 1000).toFixed(2)} s`).join(', ')} into place.` : 'Every stem already starts in the right place.');
  if (r.adjust?.length) bits.push(`Following your balance on ${r.adjust.length} track${r.adjust.length === 1 ? '' : 's'}.`);
  if (r.leftOut?.length) bits.push(`Leaving out ${r.leftOut.join(', ')}: not in your rough.`);
  if (r.missing?.length) bits.push(`Your rough has parts the stems don't at ${r.missing.join(', ')}.`);
  return bits.join(' ');
}
const TRICK_TITLE = { align: 'Lining up', eq: 'EQ', comp: 'Compression', sidechain: 'Sidechain', deess: 'De-esser', pan: 'Stereo field', verb: 'Space', loud: 'Loudness', listen: 'Listening' };

function setBar(v) { const p = Math.round(v * 100); $('#bar-fill').style.width = p + '%'; $('#bar-pct').textContent = p + '%'; $('.bar').setAttribute('aria-valuenow', p); }

/** Split the song on this device, drawing the four parts as they come out. Progress 0 → 45%. */
async function runSplit(signal) {
  const S = state.song, bins = Math.ceil(S.duration * 10);
  const song = document.createElement('div'); song.className = 'lane song-lane';
  song.innerHTML = '<div class="ln"><span class="sw"></span><div><b></b><small>Your song</small></div></div><canvas width="900" height="76"></canvas><div class="chips"></div>';
  song.querySelector('.sw').style.background = '#e8e4f2'; song.querySelector('b').textContent = $('#song-name').textContent;
  $('#lanes').append(song); drawPeaks(song.querySelector('canvas'), S.peaks, '#e8e4f2', 1);
  const parts = SPLIT_PARTS.map((p, k) => {
    const el = document.createElement('div'); el.className = 'lane split-lane';
    el.innerHTML = '<div class="ln"><span class="sw"></span><div><b></b><small>Splitting…</small></div></div><canvas width="900" height="76"></canvas><div class="chips"></div>';
    el.style.animationDelay = `${(k + 1) * 60}ms`; el.querySelector('.sw').style.background = p.color;
    el.querySelector('b').textContent = { vocals: 'Vocals', drums: 'Drums', bass: 'Bass', other: 'Music' }[p.id];
    $('#lanes').append(el);
    return { ...p, el, peaks: new Array(bins).fill(0), cv: el.querySelector('canvas') };
  });
  $('#fx-kicker').textContent = 'SPLITTING'; $('#fx-title').textContent = 'Pulling your song apart';
  $('#fx-detail').textContent = 'Getting the splitter ready…'; $('#stage-label').textContent = 'Getting the splitter ready';
  panel.show('split', { levels: {}, found: 0 });
  const r = await splitSong(S.channels, { signal, onEvent: (d) => {
    if (d.type === 'progress') { if (d.stage === 'download') setBar(0.06 * d.value); $('#stage-label').textContent = d.label; $('#fx-detail').textContent = d.label + '.'; return; }
    if (d.type !== 'segment') return;
    const levels = {};
    for (const p of parts) {
      const lv = d.levels[p.id] || [], at = Math.round(d.start * 10);
      lv.forEach((v, j) => { if (at + j < bins) p.peaks[at + j] = v; });
      drawPeaks(p.cv, p.peaks, p.color, Math.min(1, (at + lv.length) / bins));
      levels[p.id] = lv.length ? Math.min(1, (lv.reduce((a, b) => a + b, 0) / lv.length) * 2.5) : 0;
    }
    panel.data = { levels, found: d.value };
    setBar(0.06 + 0.39 * d.value);
    $('#stage-label').textContent = `Splitting your song: section ${d.index + 1} of ${d.total}`;
    const eta = d.eta > 90 ? `about ${Math.round(d.eta / 60)} min left` : d.eta > 5 ? `about ${Math.max(5, Math.round(d.eta / 5) * 5)} s left` : 'almost there';
    $('#fx-detail').textContent = `Finding the vocals, drums, bass and the rest of the music, ${d.backend === 'webgpu' ? 'on your graphics chip' : 'on your processor'}. ${d.value < 1 ? eta[0].toUpperCase() + eta.slice(1) + '.' : ''}`;
  } });
  for (const p of parts) { p.el.querySelector('small').textContent = 'Split'; p.el.classList.add('done'); }
  $('#fx-detail').textContent = `Split in ${Math.round(r.seconds)} s. Now every part goes on the console.`;
  return r;
}

function openSession() {
  const G = GENRES[state.genre];
  stopHero?.();
  $('#lanes').replaceChildren(); lanes = [];
  $('#session-genre').textContent = G.name.toUpperCase(); $('#session-bpm').textContent = '— BPM';
  setBar(0);
  $('#session-title').textContent = state.mode === 'song' && state.method === 'split' && state.split?.file !== state.song?.file ? 'Splitting your song' : 'Mixing your song';
  show('session');
  panel ||= new TrickPanel($('#fx-canvas'));
  panel.pans = []; panel.show('listen');
  let tip = 0;
  const nextTip = () => { const el = $('#tip'); el.style.opacity = 0; setTimeout(() => { el.textContent = TIPS[tip++ % TIPS.length]; el.style.opacity = 1; }, 250); };
  nextTip(); clearInterval(tipTimer); tipTimer = setInterval(nextTip, 4800);
}

async function start() {
  const songMode = state.mode === 'song';
  if (songMode ? !state.song : !state.stems.length) return;
  const G = GENRES[state.genre];
  openSession();
  state.ctrl = new AbortController();
  let stems = state.stems, roles = state.roles, roughFile = state.roughFile, base = 0;
  try {
    if (songMode) {
      if (state.method === 'split') {
        if (state.split?.file !== state.song.file) {
          // If this tab dies mid-split (out of memory), the next visit knows and polishes instead.
          try { sessionStorage.setItem('mix-splitting', String(Date.now())); } catch { /* storage blocked */ }
          try { state.split = { file: state.song.file, ...(await runSplit(state.ctrl.signal)) }; }
          finally { try { sessionStorage.removeItem('mix-splitting'); } catch { /* storage blocked */ } }
          base = 0.45;
        }
        ({ stems, roles } = stemsFromSplit(state.split.stems, state.genre));
        roughFile = state.song.file; // the song itself is the reference: timing, balance, before/after
        await new Promise((r) => setTimeout(r, still ? 0 : 900));
      } else {
        stems = [{ name: $('#song-name').textContent, path: state.song.file.name, size: state.song.file.size, channels: state.song.channels }];
        roles = ['beat']; roughFile = null;
      }
      $('#lanes').replaceChildren(); lanes = [];
      $('#session-title').textContent = 'Mixing your song';
    }
    state.mixStems = stems;
    const names = stems.map((s) => s.name);
    const mixing = stems.map((s, i) => i).filter((i) => !['rough', 'skip'].includes(roles[i]));
    const res = await runMix(stems, {
      roughFile, genre: state.genre, referenceUrl: $('#ref-link').value.trim(), referenceFile: state.refFile, roles, macros: state.macros || undefined,
      apiFetch, signal: state.ctrl.signal,
      onEvent: (e) => {
        if (e.type === 'progress') setBar(base + (1 - base) * e.value);
        else if (e.type === 'stage') {
          $('#stage-label').textContent = e.label;
          if (e.id === 'think') { $('#fx-kicker').textContent = 'THINKING'; $('#fx-title').textContent = 'Planning the mix'; $('#fx-detail').textContent = `Reading every track and choosing the ${G.name} moves.`; panel.show('listen'); }
          if (e.id === 'console' && Number.isInteger(e.index)) { lanes.forEach((l, k) => l?.el.classList.toggle('active', k === e.index)); lanes[e.index]?.el.scrollIntoView?.({ block: 'nearest', behavior: still ? 'auto' : 'smooth' }); }
        } else if (e.type === 'track') { lane(e.index, e.name, e.role, e.color, e.peaks); $('#fx-kicker').textContent = 'LISTENING'; $('#fx-title').textContent = e.name; $('#fx-detail').textContent = `Track ${mixing.indexOf(e.index) + 1} of ${mixing.length} is on the console.`; lanes[e.index].feats = e.feats; }
        else if (e.type === 'relabel') { const l = lanes[e.index]; if (l) { l.el.querySelector('.sw').style.background = e.color; l.el.querySelector('small').textContent = ROLES[e.role].name; l.color = e.color; drawPeaks(l.el.querySelector('canvas'), l.peaks, e.color, 1); } }
        else if (e.type === 'rough') {
          const el = document.createElement('div'); el.className = 'lane rough-lane';
          el.innerHTML = '<div class="ln"><span class="sw"></span><div><b></b><small></small></div></div><canvas width="900" height="76"></canvas><div class="chips"></div>';
          el.querySelector('small').textContent = songMode ? 'Your song · reference' : 'Rough mix · reference';
          el.querySelector('.sw').style.background = '#e8e4f2'; el.querySelector('b').textContent = e.name;
          $('#lanes').prepend(el); drawPeaks(el.querySelector('canvas'), e.peaks, '#e8e4f2', 1);
          $('#fx-kicker').textContent = songMode ? 'YOUR SONG' : 'YOUR ROUGH MIX'; $('#fx-title').textContent = e.name;
          $('#fx-detail').textContent = songMode ? 'The original keeps your balance in view while every part gets mixed.' : `${Math.round(e.duration)} seconds of song: the map every stem gets lined up against.`;
        } else if (e.type === 'leftout') { const l = lanes[e.index]; if (l) { l.el.classList.add('out'); l.el.querySelector('.chips').replaceChildren(chip(songMode ? 'Nothing here' : 'Not in your rough')); } }
        else if (e.type === 'tempo') $('#session-bpm').textContent = e.bpm ? `${Math.round(e.bpm)} BPM` : 'free time';
        else if (e.type === 'notes') { $('#fx-detail').textContent = e.text; }
        else if (e.type === 'trick') {
          const n = Number.isInteger(e.index) ? names[e.index] : '';
          $('#fx-kicker').textContent = (TRICK_TITLE[e.kind] || 'MIXING').toUpperCase();
          $('#fx-title').textContent = n || { verb: 'Reverb and delay', loud: 'The master', align: songMode ? 'Following your song' : 'Matching your rough mix' }[e.kind] || TRICK_TITLE[e.kind];
          $('#fx-detail').textContent = e.kind === 'align' ? (songMode ? songAlignText(e.data) : alignText(e.data)) : TRICK_TEXT[e.kind] && n ? TRICK_TEXT[e.kind](n, e.data) : e.kind === 'verb' ? `Building a ${e.data.decay.toFixed(1)} s plate for the vocals and a short room for the beat, both filtered so they never get muddy.` : e.kind === 'loud' ? `Matching the tone of finished ${G.name} records, then raising it to ${e.data.lufs} LUFS with true peaks under −1 dB.` : '';
          panel.show(e.kind, e.data, { spectrum: lanes[e.index]?.feats?.spectrum });
        } else if (e.type === 'strip') {
          const l = lanes[e.index]; if (!l) return;
          l.el.classList.remove('active'); l.el.classList.add('done');
          const chips = l.el.querySelector('.chips'); chips.replaceChildren(...chipList(e.strip.plan).slice(0, 4).map(chip));
          panel.addPan(e.strip.pan, e.strip.color);
        }
      },
    });
    state.result = res;
    showResult(res);
  } catch (e) {
    if (state.ctrl?.signal.aborted || e?.name === 'AbortError') { show('intake'); note(songMode ? 'Stopped. Your song is still here.' : 'Stopped. Your tracks are still here.'); }
    else { $('#fail-message').textContent = e.message || 'Something went wrong while mixing.'; show('failed'); }
  } finally { clearInterval(tipTimer); }
}
function songAlignText(r) {
  const bits = [r.adjust?.length ? `Keeping your song's balance in view on ${r.adjust.length} part${r.adjust.length === 1 ? '' : 's'}, within the ${GENRES[state.genre].name} targets.` : 'Your song’s balance already sits on the genre targets.'];
  if (r.leftOut?.length) bits.push(`${r.leftOut.join(', ')}: nothing there, so it's left out.`);
  return bits.join(' ');
}
$('#cancel').onclick = () => state.ctrl?.abort();
$('#retry').onclick = () => start();
$('#back').onclick = () => show('intake');

function chip(text) { const s = document.createElement('span'); s.className = 'chip'; s.textContent = text; return s; }
function chipList(p) {
  const out = [];
  if (p.hpf) out.push(`HPF ${fmtHz(p.hpf)}`);
  if (p.eq?.some((e) => Math.abs(e.gain) >= 0.4)) out.push('EQ');
  if (p.comp) out.push(`${p.comp.ratio}:1${p.comp2 ? ' ×2' : ''}`);
  if (p.deess) out.push('De-ess');
  if (p.sat) out.push('Sat');
  if (p.duck) out.push('Sidechain');
  if (p.rider) out.push('Rider');
  if (p.verb && p.verb.send > -40) out.push(p.verb.bus === 'vox' ? 'Plate' : 'Room');
  if (p.delay) out.push('Delay');
  return out;
}

// ---------- result ----------
let ctx, buffers = {}, playing = null, startedAt = 0, offset = 0, ab = 'after', gains = {}, raf;

function showResult(res) {
  const r = res.report;
  $('#result-genre').textContent = r.genreName.toUpperCase();
  $('#result-stats').replaceChildren(...[[r.lufs.toFixed(1), 'LUFS integrated'], [r.truePeak.toFixed(1), 'dBTP true peak'], [r.bpm ? Math.round(r.bpm) : '—', 'BPM'], [r.strips.filter(Boolean).length, 'tracks mixed']].map(([v, l]) => { const d = document.createElement('div'); d.className = 'stat'; d.innerHTML = '<b></b><span></span>'; d.firstChild.textContent = v; d.lastChild.textContent = l; return d; }));
  buildMixer(r.strips);
  $('#ai-notes').textContent = r.notes ? `${r.notes}${r.reference?.title ? ` (Reference: ${r.reference.title}${r.reference.author ? `, ${r.reference.author}` : ''}.)` : ''}` : '';
  $('#strip-notes').replaceChildren(...r.strips.filter(Boolean).map((s) => { const li = document.createElement('li'); li.textContent = s.text; return li; }));
  buildMacros(r.macros);
  showRough(r);
  stopAudio(); buffers = {}; offset = 0;
  show('result');
  drawWave(0);
  $('#result-title').focus({ preventScroll: true });
}

function buildMixer(strips) {
  const box = $('#mixer');
  box.replaceChildren(...strips.filter(Boolean).map((s) => {
    const el = document.createElement('div'); el.className = 'strip';
    el.innerHTML = '<span class="nm"></span><span class="rl"></span><canvas class="eqv" width="200" height="68"></canvas><div class="fx"></div><div class="knob"></div><div class="fader"><i></i></div><span class="db"></span>';
    el.querySelector('.nm').textContent = s.name; el.querySelector('.nm').title = s.name; el.querySelector('.rl').textContent = ROLES[s.role].name;
    el.querySelector('.rl').style.color = s.color;
    drawEqThumb(el.querySelector('.eqv'), s.plan, s.color);
    el.querySelector('.fx').replaceChildren(...chipList(s.plan).map(chip));
    el.querySelector('.knob').style.setProperty('--a', `${(s.pan || 0) * 135}deg`);
    el.querySelector('.knob').title = Math.abs(s.pan) < 0.05 ? 'Centre' : `${Math.round(Math.abs(s.pan) * 100)}% ${s.pan < 0 ? 'left' : 'right'}`;
    const level = s.plan.level ?? 0;
    el.querySelector('.fader i').style.setProperty('--p', `${Math.max(6, Math.min(94, 70 + level * 3))}%`);
    el.querySelector('.db').textContent = `${level >= 0 ? '+' : ''}${level.toFixed(1)} LU`;
    el.title = s.text;
    return el;
  }));
}

function showRough(r) {
  const rr = $('#rough-report'), songMode = state.mode === 'song';
  const split = songMode && state.method === 'split' && !!state.split;
  $('#stem-dl').hidden = !split;
  document.querySelector('[data-ab="before"]').textContent = songMode ? 'Your song' : r.rough ? 'Your rough' : 'Before';
  $('#ab-note').textContent = songMode ? 'Your song is the file you dropped, turned to the same loudness, so you hear the mix, not just volume.' : r.rough ? 'Your rough is your own bounce, lined up and turned to the same loudness, so you hear the mix, not just volume.' : 'Before is your stems added up and turned to the same loudness, so you hear the mix, not just volume.';
  rr.hidden = !r.rough && !songMode;
  if (songMode) {
    const gaps = r.rough?.coverage?.gaps || [], items = [];
    if (split) items.push(`Split into vocals, drums, bass and music in ${Math.round(state.split.seconds)} s ${state.split.backend === 'webgpu' ? 'on your graphics chip' : 'on this device'}, then each part was mixed on its own channel. The four stems add back up to your song exactly; download them below.`);
    else items.push('Polished as one track: EQ, glue compression and a master for your genre. For a deeper mix, try Split & mix.');
    if (r.rough?.adjust?.length) items.push(`Balance, starting from yours: ${r.rough.adjust.map((a) => `${a.name} ${a.db > 0 ? '+' : ''}${a.db} dB`).join(', ')}.`);
    if (r.rough?.leftOut?.length) items.push(`${r.rough.leftOut.join(', ')}: nothing in that part, so it was left out.`);
    items.push(gaps.length ? `These parts are much quieter in the mix than in your song: ${gaps.map((g) => g.label).join(', ')}.` : `Every section of your song plays in the mix${state.song?.duration ? ` (${fmt(state.song.duration)})` : ''}.`);
    rr.classList.toggle('warn', !!gaps.length);
    rr.innerHTML = '<h3></h3><ul></ul>';
    rr.querySelector('h3').textContent = gaps.length ? '⚠ Checked against your song' : split ? '✓ Split, mixed and checked against your song' : '✓ Polished and checked against your song';
    rr.querySelector('ul').replaceChildren(...items.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
    return;
  }
  if (!r.rough) return;
  const gaps = r.rough.coverage?.gaps || [], items = [];
  items.push(gaps.length ? `These parts of your rough are much quieter or missing in the mix: ${gaps.map((g) => g.label).join(', ')}. Check those stems are in the session.` : `Every section of your rough mix plays in the finished song${r.rough.duration ? ` (${Math.round(r.rough.duration)} s)` : ''}.`);
  if (r.rough.moved?.length) items.push(`Lined up: ${r.rough.moved.map((m) => `${m.name} (${m.ms > 0 ? '+' : ''}${(m.ms / 1000).toFixed(2)} s)`).join(', ')}.`);
  if (r.rough.adjust?.length) items.push(`Followed your balance: ${r.rough.adjust.map((a) => `${a.name} ${a.db > 0 ? '+' : ''}${a.db} dB`).join(', ')}.`);
  if (r.rough.leftOut?.length) items.push(`Left out (not in your rough): ${r.rough.leftOut.join(', ')}. Give them a role and remix if you want them in.`);
  if (r.rough.missing?.length) items.push(`Your rough has parts no stem covers at ${r.rough.missing.join(', ')}. Add those stems for a complete song.`);
  const warn = !!(gaps.length || r.rough.missing?.length);
  rr.classList.toggle('warn', warn);
  rr.innerHTML = '<h3></h3><ul></ul>';
  rr.querySelector('h3').textContent = warn ? '⚠ Checked against your rough mix' : '✓ Matches your rough mix';
  rr.querySelector('ul').replaceChildren(...items.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
}

const MACRO_LABELS = { vox: 'Vocal level', low: 'Low end', bright: 'Brightness', space: 'Space', width: 'Width', loud: 'Loudness' };
function buildMacros(m) {
  $('#macros').replaceChildren(...Object.entries(MACRO_LABELS).map(([k, label]) => {
    const row = document.createElement('label'); row.className = 'macro';
    const input = Object.assign(document.createElement('input'), { type: 'range', min: -3, max: 3, step: 0.5, value: m?.[k] ?? 0 });
    const out = document.createElement('output'); out.textContent = Number(input.value) > 0 ? `+${input.value}` : input.value;
    input.oninput = () => { out.textContent = Number(input.value) > 0 ? `+${input.value}` : input.value; };
    input.dataset.k = k;
    row.append(document.createTextNode(label), input, out);
    return row;
  }));
}
$('#remix').onclick = () => {
  state.macros = Object.fromEntries([...document.querySelectorAll('#macros input')].map((i) => [i.dataset.k, Number(i.value)]));
  stopAudio(); start();
};
$('#again').onclick = () => { stopAudio(); state.song = null; state.split = null; $('#song-card').hidden = true; $('#song-drop').hidden = false; state.stems = []; state.roles = []; state.roughFile = null; $('#rough-file').value = ''; roughStatus(); state.macros = null; state.result = null; renderStems(); updateStart(); note(''); show('intake'); };

function toBuffer(chs) {
  ctx ||= new AudioContext();
  const b = ctx.createBuffer(chs.length, chs[0].length, state.result.rate);
  chs.forEach((c, i) => b.copyToChannel(c, i));
  return b;
}
function stopAudio() {
  for (const s of Object.values(playing || {})) { try { s.stop(); } catch { /* already stopped */ } }
  if (playing && ctx) offset = Math.min(dur(), offset + (ctx.currentTime - startedAt));
  playing = null; cancelAnimationFrame(raf); $('#play').textContent = '▶'; $('#play').setAttribute('aria-label', 'Play');
}
const dur = () => state.result ? state.result.audio.mix[0].length / state.result.rate : 0;
function play() {
  const a = state.result.audio;
  buffers.after ||= toBuffer(a.mix); buffers.before ||= toBuffer(a.before || a.mix);
  if (ctx.state === 'suspended') ctx.resume();
  if (offset >= dur() - 0.05) offset = 0;
  playing = {};
  for (const k of ['before', 'after']) {
    const s = ctx.createBufferSource(); s.buffer = buffers[k];
    gains[k] = ctx.createGain(); gains[k].gain.value = k === ab ? 1 : 0;
    s.connect(gains[k]).connect(ctx.destination); s.start(0, offset); playing[k] = s;
  }
  playing.after.onended = () => { if (playing && ctx.currentTime - startedAt + offset >= dur() - 0.1) { stopAudio(); offset = 0; drawWave(0); } };
  startedAt = ctx.currentTime;
  $('#play').textContent = 'Ⅱ'; $('#play').setAttribute('aria-label', 'Pause');
  const tick = () => { if (!playing) return; const t = offset + ctx.currentTime - startedAt; drawWave(t / dur()); $('#time').textContent = fmt(t); raf = requestAnimationFrame(tick); };
  tick();
}
$('#play').onclick = () => (playing ? stopAudio() : play());
for (const b of document.querySelectorAll('[data-ab]')) b.onclick = () => {
  ab = b.dataset.ab;
  document.querySelectorAll('[data-ab]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  if (playing && ctx) for (const k of ['before', 'after']) gains[k].gain.setTargetAtTime(k === ab ? 1 : 0, ctx.currentTime, 0.015);
  drawWave(playing ? (offset + ctx.currentTime - startedAt) / dur() : offset / dur());
};
let wavePeaks = null;
function drawWave(k) {
  const cv = $('#wave'), g = cv.getContext('2d'), w = cv.width, h = cv.height;
  if (!state.result) return;
  const src = ab === 'before' ? state.result.audio.before || state.result.audio.mix : state.result.audio.mix;
  if (!wavePeaks || wavePeaks.src !== src) {
    const n = src[0].length, bins = w, step = n / bins, p = new Float32Array(bins);
    for (let b = 0; b < bins; b++) { let m = 0; for (let i = Math.floor(b * step), e = Math.min(n, Math.floor((b + 1) * step)); i < e; i += 32) { const v = Math.abs(src[0][i]) + Math.abs(src[1]?.[i] || 0); if (v > m) m = v; } p[b] = m / 2; }
    wavePeaks = { src, p };
  }
  g.clearRect(0, 0, w, h);
  const mid = h / 2, played = Math.floor(k * w);
  for (let x = 0; x < w; x++) { const v = wavePeaks.p[x] * (h / 2 - 2); g.fillStyle = x <= played ? (ab === 'after' ? '#ffbf2f' : '#a98bff') : 'rgba(255,255,255,.22)'; g.fillRect(x, mid - v, 1, Math.max(1, v * 2)); }
}
$('#wave').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect(), k = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  const was = !!playing; if (was) stopAudio();
  offset = k * dur(); drawWave(k); $('#time').textContent = fmt(offset);
  if (was) play();
};

// downloads
// Name downloads after the session: the folder or zip the stems came in, otherwise "My song".
const title = () => {
  if (state.mode === 'song' && state.song) return state.song.file.name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'My song';
  const paths = state.stems.map((s) => s.path), top = paths[0]?.includes('/') ? paths[0].split('/')[0] : '';
  const name = top && paths.every((p) => p.startsWith(top + '/')) ? top : state.zipName || 'My song';
  return name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 60) || 'My song';
};
for (const b of document.querySelectorAll('[data-dl]')) b.onclick = async () => {
  const [what, format] = b.dataset.dl.split(':'), chs0 = what.startsWith('stem-') ? state.split?.stems[what.slice(5)] : state.result?.audio[what];
  if (!chs0) { $('#dl-note').textContent = what === 'acapella' ? 'There are no vocal tracks in this session.' : 'Nothing to download yet.'; return; }
  b.disabled = true; $('#dl-note').textContent = 'Preparing your file…';
  try {
    // MP3 encoders overshoot peaks a little: the MP3 gets 1 dB of extra headroom.
    const chs = format === 'mp3' ? chs0.map((c) => { const o = new Float32Array(c.length); const g = 10 ** (-1 / 20); for (let i = 0; i < c.length; i++) o[i] = c[i] * g; return o; }) : chs0;
    const src = { rate: state.result.rate, channels: chs.length, frames: chs[0].length, read: (off, n) => chs.map((x) => x.slice(off, off + n)) };
    const out = await X.encode(src, format === 'wav' ? { format: 'wav', bits: 24 } : { format: 'mp3', kbps: 320 }, { onProgress: (f) => { $('#dl-note').textContent = `Encoding… ${Math.round((f || 0) * 100)}%`; } });
    const label = { mix: 'Chucksi mix', instrumental: 'instrumental', acapella: 'a cappella', premaster: 'mix for mastering', 'stem-vocals': 'vocals stem', 'stem-drums': 'drums stem', 'stem-bass': 'bass stem', 'stem-other': 'music stem' }[what];
    const a = document.createElement('a'); a.href = URL.createObjectURL(out.blob); a.download = `${title()} (${label}).${format}`; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    $('#dl-note').textContent = 'Saved.';
  } catch (e) { $('#dl-note').textContent = e.message || 'Couldn’t write that file.'; }
  finally { b.disabled = false; }
};

buildGenres();
setMode(state.mode);
try {
  const was = Number(sessionStorage.getItem('mix-splitting'));
  if (was) {
    sessionStorage.removeItem('mix-splitting');
    if (Date.now() - was < 60 * 60 * 1000) {
      localStorage.setItem('mix-split-crashed', '1'); fits = false;
      setMode('song');
      note('Your last split stopped: this browser ran out of memory and reloaded the page. Quick polish works here; for Split & mix, open chucksi.com/mix on a computer.', true);
    }
  }
} catch { /* storage blocked */ }
if (params.get('demo') === '1') $('#stem-link').focus();
