// Edit by text on the Cut page: transcribe, then cut the media by striking words in its transcript.
// Transcription is the only step that leaves the device (the sound as 16 kHz mono, to Whisper on Cloudflare).
// Playback, cutting, captions and every export run in this tab. The logic lives in textedit.js.

import * as T from '../transcribe.js';
import * as X from '../extract.js';
import * as E from '../textedit.js';
import { warmHuman } from '../human.js';
import { retainExport, downloadBlob } from '../assets.js';

const PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5v11l9-5.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>';
const MAX_VIDEO_SECONDS = 10 * 60;
const VIDEO_FPS = 30;
const $ = (s) => document.querySelector(s);
const clock = (t) => T.clock(Math.max(0, t), 1);

/**
 * page: { video, canvas, message(text), drawFrame(timeSrc, captionText), captionStyle(), cues() (source time),
 *         lockPage(on) }
 */
export function createTextEdit(page) {
  const S = {
    src: null, // { blob, name, id, isVideo }
    prep: null, // 16 kHz mono for Whisper and the energy envelope
    env: null,
    words: [],
    segments: [],
    lang: '',
    state: E.emptyState(),
    undo: [],
    redo: [],
    keep: [],
    retimed: [],
    pcm: null, // full-rate audio for playback and export
    pcmPromise: null,
    sel: null, // { a, b } word indexes
    found: { fillers: [], repeats: [], pauses: [] },
    review: null,
    busy: false,
    ctl: null,
  };
  let player = null;

  // ---------- source ----------
  function setSource(src) {
    stop();
    if (S.ctx) { S.ctx.close().catch(() => {}); S.ctx = null; } // the next file may have another sample rate
    S.src = src;
    S.prep = null;
    S.pcm = null;
    S.pcmPromise = null;
    S.words = [];
    S.state = E.emptyState();
    S.undo = [];
    S.redo = [];
    $('#te').hidden = true;
    $('#te-video').hidden = !src?.isVideo;
    $('#te-burn-row').hidden = !src?.isVideo;
    $('#te-go').disabled = !src;
    $('#te-result').replaceChildren();
  }

  function languages() {
    const sel = $('#te-lang');
    const nav = (navigator.language || 'en').slice(0, 2);
    for (const [id, name] of T.ASR_LANGS) sel.append(new Option(id ? name : 'Auto-detect (keeps fewer “um”s)', id));
    let saved = '';
    try { saved = localStorage.getItem('massless.editLang') || ''; } catch { /* private mode */ }
    sel.value = T.ASR_LANGS.some(([id]) => id === saved) && saved ? saved : E.VERBATIM_PROMPTS[nav] ? nav : 'en';
    sel.onchange = () => { try { localStorage.setItem('massless.editLang', sel.value); } catch { /* private mode */ } };
  }

  // ---------- transcription ----------
  async function transcribe() {
    if (!S.src || S.busy) return;
    warmHuman();
    lock(true);
    const lang = $('#te-lang').value;
    try {
      const file = S.src.blob instanceof File ? S.src.blob : new File([S.src.blob], S.src.name || 'media', { type: S.src.blob.type });
      page.message('Reading the sound in this tab…');
      S.prep ||= await T.prepareAudio(file);
      S.pcmPromise ||= decodeFull(file);
      const n = S.prep.parts.length;
      const out = await T.transcribeParts(S.prep.samples, S.prep.parts, {
        lang,
        prompt: E.VERBATIM_PROMPTS[lang] || '',
        onPart: (i, st) => { if (st === 'sending') page.message(n > 1 ? `Transcribing part ${i + 1} of ${n} with Whisper…` : 'Transcribing with Whisper…'); },
      });
      if (!out.segments.length) throw new Error('No speech was found in this file.');
      S.lang = lang || (E.FILLERS[out.language] ? out.language : 'en');
      load(out.segments);
      page.message(`Transcript ready: ${S.words.length} words. Select words and press Delete to cut them.`);
    } catch (e) {
      page.message(`Transcription stopped: ${e.message}`);
    } finally {
      lock(false);
    }
  }

  /** Words in, everything derived from them out. Also the entry point for tests and saved transcripts. */
  function load(segments, prep = S.prep) {
    S.prep = prep;
    S.segments = segments;
    S.words = E.wordsFromSegments(segments);
    S.env = E.rmsFrames(S.prep.samples, T.ASR_RATE);
    S.state = E.emptyState();
    S.undo = [];
    S.redo = [];
    S.sel = null;
    S.review = null;
    build();
    $('#te').hidden = false;
    update();
  }

  async function decodeFull(file) {
    const info = await X.probe(file);
    const rate = X.workRate(info.sampleRate >= 8000 && info.sampleRate <= 96000 ? info.sampleRate : 0, 'mp3');
    const buf = await X.decode(file, rate);
    const chs = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chs.push(buf.getChannelData(c));
    S.pcm = { rate: buf.sampleRate, channels: chs, duration: buf.duration };
    return S.pcm;
  }
  const duration = () => S.prep?.duration || 0;

  // ---------- the transcript view ----------
  function build() {
    const box = $('#te-words');
    box.replaceChildren();
    let p = null;
    let seg = -1;
    const gapLen = (g) => (g + 1 < S.words.length ? S.words[g + 1].s : duration()) - (g < 0 ? 0 : S.words[g].e);
    const chip = (g) => {
      const len = gapLen(g);
      if (len < 0.3) return null;
      const c = document.createElement('span');
      c.className = 'gap';
      c.dataset.g = g;
      c.dataset.len = len;
      return c;
    };
    const lead = chip(-1);
    for (const w of S.words) {
      if (w.seg !== seg) {
        seg = w.seg;
        p = document.createElement('p');
        box.append(p);
        if (w.i === 0 && lead) p.append(lead);
      }
      const span = document.createElement('span');
      span.className = `w${w.low ? ' low' : ''}`;
      span.dataset.i = w.i;
      span.textContent = String(w.text).trim();
      p.append(span, ' ');
      const c = chip(w.i);
      if (c) p.append(c, ' ');
    }
    S.spans = [...box.querySelectorAll('.w')];
    S.chips = [...box.querySelectorAll('.gap')];
    detect();
  }

  function detect() {
    const lang = S.lang || 'en';
    S.found.fillers = E.markTight(E.detectFillers(S.words, lang), S.env, S.words);
    S.found.repeats = E.detectRepeats(S.words);
    const cap = Number($('#te-cap').value) || 0.5;
    S.found.pauses = E.markSpeechInPauses(E.detectPauses(S.words, duration(), { over: cap }), S.env, S.words);
    const filler = new Set(S.found.fillers.flatMap((f) => range(f.from, f.to)));
    S.spans.forEach((s, i) => s.classList.toggle('filler', filler.has(i)));
    const sound = new Set(S.found.pauses.filter((q) => q.speech).map((q) => q.gap));
    for (const c of S.chips) c.classList.toggle('sound', sound.has(Number(c.dataset.g)));
  }
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

  /** Recompile and repaint after any change to the edit. */
  function update() {
    const st = S.state;
    S.keep = E.snapCuts(E.compile(S.words, st, duration()), S.env, duration());
    S.retimed = E.retimeWords(S.words, S.keep, st);
    S.spans.forEach((s, i) => {
      s.classList.toggle('struck', st.struck.has(i));
      s.classList.toggle('sel', !!S.sel && i >= S.sel.a && i <= S.sel.b);
    });
    for (const c of S.chips) {
      const g = Number(c.dataset.g);
      const len = Number(c.dataset.len);
      const cap = st.caps.get(g);
      c.classList.toggle('capped', cap !== undefined && cap < len);
      c.textContent = cap !== undefined && cap < len ? `${len.toFixed(1)}→${cap.toFixed(1)} s` : `${len.toFixed(1)} s`;
    }
    const total = E.keptLength(S.keep);
    const cut = duration() - total;
    const nStruck = st.struck.size;
    $('#te-summary').textContent = `${nStruck ? `${nStruck} word${nStruck === 1 ? '' : 's'} cut · ` : ''}${cut >= 0.05 ? `${cut.toFixed(1)} s removed · ` : ''}new length ${clock(total)} of ${clock(duration())}`;
    $('#te-undo').disabled = !S.undo.length;
    $('#te-redo').disabled = !S.redo.length;
    counts();
    if (!player) showTime(S.pos || 0);
    window.massless = { ...(window.massless || {}), edit: api };
  }

  function counts() {
    const st = S.state;
    const cap = Number($('#te-cap').value) || 0.5;
    const open = {
      fillers: S.found.fillers.filter((f) => range(f.from, f.to).some((i) => !st.struck.has(i))),
      repeats: S.found.repeats.filter((f) => range(f.from, f.to).some((i) => !st.struck.has(i))),
      pauses: S.found.pauses.filter((q) => !(st.caps.get(q.gap) <= cap)),
    };
    for (const k of Object.keys(open)) {
      const b = $(`#te-${k}`);
      b.querySelector('output').textContent = String(open[k].length);
      b.classList.toggle('has', open[k].length > 0);
    }
    S.open = open;
  }

  // ---------- editing ----------
  function apply(fn) {
    S.undo.push(E.cloneState(S.state));
    if (S.undo.length > 200) S.undo.shift();
    S.redo = [];
    const before = S.keep;
    fn(S.state);
    afterChange(before);
  }
  function afterChange(before) {
    const at = player ? player.pos() : S.pos || 0;
    update();
    if (player) {
      // keep playing from the same moment of the source
      const src = E.outToSrc(at, before);
      restart(E.srcToOut(src, S.keep));
    }
  }
  function undo() {
    if (!S.undo.length) return;
    S.redo.push(E.cloneState(S.state));
    const before = S.keep;
    S.state = S.undo.pop();
    afterChange(before);
  }
  function redo() {
    if (!S.redo.length) return;
    S.undo.push(E.cloneState(S.state));
    const before = S.keep;
    S.state = S.redo.pop();
    afterChange(before);
  }
  function strike(on) {
    const sel = currentSelection();
    if (!sel) { page.message('Select words first: click one, or drag across several.'); return; }
    const ids = range(sel.a, sel.b);
    const struck = on ?? !ids.every((i) => S.state.struck.has(i));
    apply((st) => { for (const i of ids) (struck ? st.struck.add(i) : st.struck.delete(i)); });
    page.message(`${struck ? 'Cut' : 'Restored'} ${ids.length} word${ids.length === 1 ? '' : 's'}. Undo with Ctrl+Z.`);
  }

  // selection: a click picks a word; shift-click or a drag selects a run
  function wordOf(node) {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    const w = el?.closest?.('.w');
    return w ? Number(w.dataset.i) : null;
  }
  function currentSelection() {
    const s = window.getSelection();
    if (s && !s.isCollapsed && $('#te-words').contains(s.anchorNode)) {
      const r = s.getRangeAt(0);
      const ids = S.spans.filter((sp) => r.intersectsNode(sp)).map((sp) => Number(sp.dataset.i));
      if (ids.length) S.sel = { a: Math.min(...ids), b: Math.max(...ids) };
    }
    return S.sel;
  }
  function bindWords() {
    const box = $('#te-words');
    box.addEventListener('click', (e) => {
      const i = wordOf(e.target);
      if (i === null) return;
      const s = window.getSelection();
      if (s && !s.isCollapsed) { currentSelection(); update(); return; }
      if (e.shiftKey && S.sel) S.sel = { a: Math.min(S.sel.a, i), b: Math.max(S.sel.b, i) };
      else S.sel = { a: i, b: i };
      update();
      seekWord(i);
    });
    box.addEventListener('mouseup', () => setTimeout(() => { const s = window.getSelection(); if (s && !s.isCollapsed) { currentSelection(); update(); } }, 0));
    // keyboard: arrows move through the words, Shift extends, Enter jumps there, Delete cuts
    box.addEventListener('keydown', (e) => {
      if (!S.words.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(e.key)) return;
      e.preventDefault();
      const last = S.words.length - 1;
      const cur = S.sel ? (S.focus ?? S.sel.b) : -1;
      if (e.key === 'Enter') { if (S.sel) seekWord(S.sel.a); return; }
      const to = e.key === 'Home' ? 0 : e.key === 'End' ? last : Math.max(0, Math.min(last, cur + (e.key === 'ArrowLeft' ? -1 : 1)));
      if (e.shiftKey && S.sel) {
        const anchor = S.anchor ?? S.sel.a;
        S.sel = { a: Math.min(anchor, to), b: Math.max(anchor, to) };
      } else { S.sel = { a: to, b: to }; S.anchor = to; }
      S.focus = to;
      window.getSelection()?.removeAllRanges();
      update();
      S.spans[to]?.scrollIntoView({ block: 'nearest' });
      $('#te-summary').textContent = `Selected “${S.words.slice(S.sel.a, S.sel.b + 1).map((w) => w.text.trim()).join(' ')}”. ${$('#te-summary').textContent}`;
    });
  }
  function seekWord(i) {
    const w = S.words[i];
    const t = E.srcToOut(w.s, S.keep);
    if (player) restart(t);
    else {
      S.pos = t;
      showTime(t);
      if (S.src?.isVideo) page.video.currentTime = Math.min(page.video.duration || Infinity, w.s);
    }
  }

  // ---------- clean-up tools with review ----------
  const TOOL = {
    fillers: { title: (n) => `${n} filler${n === 1 ? '' : 's'} found`, note: 'Unticked ones sit too close to the next word to cut cleanly; tick them to cut anyway.' },
    repeats: { title: (n) => `${n} repeat${n === 1 ? '' : 's'} found`, note: 'The first copy is cut, the second kept.' },
    pauses: { title: (n) => `${n} long pause${n === 1 ? '' : 's'} found`, note: 'Each is shortened from the middle. Unticked ones hold a sound Whisper did not write down, maybe a word; tick them to shorten anyway.' },
  };
  function openReview(kind) {
    detect();
    counts();
    const items = S.open[kind];
    S.review = { kind, items };
    for (const k of Object.keys(TOOL)) $(`#te-${k}`).setAttribute('aria-expanded', String(k === kind));
    $('#te-review').hidden = false;
    $('#te-review-title').textContent = items.length ? TOOL[kind].title(items.length) : `No ${kind} left to fix`;
    $('#te-review-note').textContent = items.length ? TOOL[kind].note : kind === 'pauses' ? 'Pick a shorter length to find more.' : 'Nothing to do here.';
    const list = $('#te-review-list');
    list.replaceChildren(...items.map((it, k) => {
      const li = document.createElement('li');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !(it.tight || it.speech);
      box.dataset.k = k;
      box.setAttribute('aria-label', `Include ${it.text || 'pause'} at ${clock(it.s)}`);
      const time = document.createElement('time');
      time.textContent = clock(it.s);
      const ctx = document.createElement('span');
      ctx.className = 'ctx';
      if (kind === 'pauses') {
        ctx.textContent = `${it.len.toFixed(1)} s → ${Number($('#te-cap').value).toFixed(1)} s after “${S.words[it.gap]?.text.trim() || 'the start'}”`;
      } else {
        const before = S.words.slice(Math.max(0, it.from - 3), it.from).map((w) => w.text.trim()).join(' ');
        const after = S.words.slice(it.to + 1, it.to + 4).map((w) => w.text.trim()).join(' ');
        const b = document.createElement('b');
        b.textContent = it.text;
        ctx.append(`…${before} `, b, ` ${after}…`);
      }
      if (it.tight || it.speech) {
        const f = document.createElement('span');
        f.className = 'flag';
        f.textContent = it.tight ? ' · tight' : ' · sound inside';
        ctx.append(f);
      }
      const play = document.createElement('button');
      play.type = 'button';
      play.innerHTML = PLAY;
      play.setAttribute('aria-label', `Hear ${clock(it.s)} in the original`);
      play.onclick = () => previewSource(Math.max(0, it.s - 1.2), it.e + 1.2);
      li.append(box, time, ctx, play);
      return li;
    }));
    $('#te-review-apply').disabled = !items.length;
    $('#te-review-apply').textContent = items.length ? `Apply ${items.filter((it) => !(it.tight || it.speech)).length}` : 'Apply';
    list.onchange = () => { $('#te-review-apply').textContent = `Apply ${list.querySelectorAll('input:checked').length}`; };
  }
  function closeReview() {
    S.review = null;
    $('#te-review').hidden = true;
    for (const k of Object.keys(TOOL)) $(`#te-${k}`).setAttribute('aria-expanded', 'false');
  }
  function applyReview() {
    if (!S.review) return;
    const { kind, items } = S.review;
    const chosen = [...$('#te-review-list').querySelectorAll('input:checked')].map((b) => items[Number(b.dataset.k)]);
    const cap = Number($('#te-cap').value) || 0.5;
    if (chosen.length) {
      apply((st) => {
        for (const it of chosen) {
          if (kind === 'pauses') st.caps.set(it.gap, cap);
          else for (let i = it.from; i <= it.to; i++) st.struck.add(i);
        }
      });
    }
    closeReview();
    page.message(chosen.length ? `${kind === 'pauses' ? 'Shortened' : 'Cut'} ${chosen.length}. Undo with Ctrl+Z.` : 'Nothing changed.');
  }
  /** Hear a stretch of the original, for the review list. */
  async function previewSource(a, b) {
    stop();
    const pcm = await ensurePcm();
    player = startPlayer(pcm, [[a, Math.min(b, pcm.duration)]], 0, { review: true });
  }

  // ---------- playback: the edit rendered in short blocks, scheduled back to back ----------
  async function ensurePcm() {
    if (S.pcm) return S.pcm;
    page.message('Reading the full-quality sound…');
    if (!S.pcmPromise) {
      const file = S.src.blob instanceof File ? S.src.blob : new File([S.src.blob], S.src.name || 'media', { type: S.src.blob.type });
      S.pcmPromise = decodeFull(file);
    }
    try { return await S.pcmPromise; } catch (e) { S.pcmPromise = null; throw e; }
  }
  function startPlayer(pcm, keep, fromOut, { review = false } = {}) {
    const ctx = (S.ctx ||= new AudioContext({ sampleRate: pcm.rate }));
    ctx.resume();
    const rate = pcm.rate;
    const total = E.keepFrames(keep, rate).reduce((a, r) => a + r.e - r.s, 0);
    let next = Math.max(0, Math.min(total, Math.round(fromOut * rate)));
    const first = next;
    const t0 = ctx.currentTime + 0.06;
    const BLOCK = Math.round(rate * 0.5);
    const nodes = [];
    const p = {
      keep, review,
      pos: () => Math.min(total / rate, first / rate + Math.max(0, ctx.currentTime - t0)),
      done: false,
    };
    const pump = () => {
      while (next < total && t0 + (next - first) / rate < ctx.currentTime + 1.2) {
        const n = Math.min(BLOCK, total - next);
        const chs = E.renderEdit(pcm.channels, rate, keep, { from: next, to: next + n });
        const buf = ctx.createBuffer(chs.length, n, rate);
        chs.forEach((x, c) => buf.copyToChannel(x, c));
        const node = ctx.createBufferSource();
        node.buffer = buf;
        node.connect(ctx.destination);
        node.start(t0 + (next - first) / rate);
        nodes.push(node);
        next += n;
      }
      if (nodes.length > 8) nodes.splice(0, nodes.length - 8);
    };
    pump();
    p.timer = setInterval(pump, 150);
    p.stop = () => {
      clearInterval(p.timer);
      for (const nd of nodes) { try { nd.stop(); } catch { /* not started */ } }
      p.done = true;
    };
    p.total = total / rate;
    requestAnimationFrame(function tick() {
      if (player !== p || p.done) return;
      const t = p.pos();
      if (!review) follow(t);
      if (t >= p.total - 0.005) { stop(); if (!review) { S.pos = 0; showTime(0); } return; }
      requestAnimationFrame(tick);
    });
    $('#te-play').innerHTML = review ? PLAY : PAUSE;
    $('#te-play').setAttribute('aria-label', review ? 'Play the edit' : 'Pause');
    if (S.src.isVideo) { page.video.muted = true; page.video.currentTime = review ? keep[0][0] : E.outToSrc(fromOut, keep); page.video.play().catch(() => {}); }
    return p;
  }
  async function play(from = S.pos || 0) {
    if (!S.words.length) return;
    try {
      const pcm = await ensurePcm();
      stop();
      if (from >= E.keptLength(S.keep) - 0.05) from = 0;
      player = startPlayer(pcm, S.keep, from);
      page.message('Playing the edit. Click a word to jump there.');
    } catch (e) {
      page.message(e.message);
    }
  }
  function restart(at) {
    if (!S.pcm) return;
    stop();
    player = startPlayer(S.pcm, S.keep, at);
  }
  function stop() {
    if (!player) return;
    if (!player.review) S.pos = player.pos();
    player.stop();
    player = null;
    page.overlay = null;
    if (S.src?.isVideo) { page.video.pause(); page.video.muted = false; }
    $('#te-play').innerHTML = PLAY;
    $('#te-play').setAttribute('aria-label', 'Play the edit');
    for (const sp of S.spans || []) sp.classList.remove('now');
  }
  let lastNow = -1;
  function follow(t) {
    showTime(t);
    // the word under the playhead
    const ws = S.retimed;
    let lo = 0;
    let hi = ws.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ws[mid].os <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const w = found >= 0 && t < ws[found].oe + 0.15 ? ws[found].i : -1;
    if (w !== lastNow) {
      if (lastNow >= 0) S.spans[lastNow]?.classList.remove('now');
      if (w >= 0) {
        const sp = S.spans[w];
        sp.classList.add('now');
        const box = $('#te-words');
        const r = sp.getBoundingClientRect();
        const b = box.getBoundingClientRect();
        if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - b.height / 3;
      }
      lastNow = w;
    }
    // the picture follows the sound
    if (S.src.isVideo) {
      const src = E.outToSrc(t, S.keep);
      const v = page.video;
      if (Math.abs(v.currentTime - src) > 0.25) v.currentTime = src;
      if (v.paused) v.play().catch(() => {});
    }
    page.overlay = captionAtOut(t);
  }
  function showTime(t) {
    $('#te-time').textContent = `${clock(t)} / ${clock(E.keptLength(S.keep))}`;
  }

  // ---------- captions on the edited timeline ----------
  function editedCues() {
    return T.buildCues(E.editedSegments(S.words, S.keep, S.state));
  }
  let cueCache = null;
  function captionAtOut(t) {
    if (!S.src?.isVideo || !$('#te-burn').checked) return null;
    const key = E.stateKey(S.state);
    if (!cueCache || cueCache.key !== key) cueCache = { key, cues: editedCues() };
    const c = cueCache.cues.find((q) => t >= q.start && t < q.end);
    return c ? c.lines.join(' ') : '';
  }

  // ---------- exports ----------
  const base = () => X.outputName(S.src?.name || 'edit', 'x').replace(/\.x$/, '');
  function lock(on) {
    S.busy = on;
    page.lockPage?.(on);
    for (const id of ['#te-go', '#te-mp3', '#te-wav', '#te-video', '#te-srt', '#te-vtt', '#te-edl', '#te-fillers', '#te-repeats', '#te-pauses']) { const b = $(id); if (b) b.disabled = on; }
    $('#te-cancel').hidden = !on || !S.ctl;
  }
  function editedSource(pcm) {
    const frames = E.keepFrames(S.keep, pcm.rate).reduce((a, r) => a + r.e - r.s, 0);
    return { rate: pcm.rate, channels: pcm.channels.length, frames, read: (off, n) => E.renderEdit(pcm.channels, pcm.rate, S.keep, { from: off, to: off + n }) };
  }
  async function save(blob, name, extra = {}) {
    const { saved } = await retainExport(blob, { name, engine: 'local-text-edit', sourceId: S.src.id || null, settings: { ...E.toEditJson({ name: S.src.name, duration: duration(), words: S.words, state: S.state, keep: S.keep }), ...extra } });
    const out = $('#te-result');
    const btn = document.createElement('button');
    btn.className = 'btn-accent';
    btn.textContent = `Download ${name.split('.').pop().toUpperCase()} again`;
    btn.onclick = () => downloadBlob(blob, name);
    out.replaceChildren(btn);
    if (saved) {
      const a = document.createElement('a');
      a.href = '/library/';
      a.textContent = 'Open in library ↗';
      out.append(a);
    }
    return saved;
  }
  async function exportAudio(format) {
    if (S.busy || !S.words.length) return;
    stop();
    lock(true);
    S.ctl = new AbortController();
    $('#te-cancel').hidden = false;
    try {
      const pcm = await ensurePcm();
      if (format === 'mp3') X.warm();
      const r = await X.encode(editedSource(pcm), format === 'mp3' ? { format: 'mp3', kbps: 192 } : { format: 'wav' }, {
        signal: S.ctl.signal,
        onProgress: (f, l) => page.message(`${l === 'Converting' ? 'Encoding' : l}${f == null ? '' : ` ${Math.round(f * 100)}%`}`),
      });
      const name = `${base()} (edited).${format}`;
      downloadBlob(r.blob, name);
      const saved = await save(r.blob, name);
      api.last = { kind: format, name, duration: r.duration, size: r.blob.size };
      page.message(`${name}: ${clock(r.duration)}${saved ? ', saved to your library' : ''}.`);
    } catch (e) {
      page.message(e.name === 'AbortError' ? 'Export cancelled.' : `Export failed: ${e.message}`);
    } finally {
      S.ctl = null;
      lock(false);
    }
  }
  function exportCaptions(kind) {
    if (!S.words.length) return;
    const cues = editedCues();
    const text = kind === 'srt' ? T.toSrt(cues) : T.toVtt(cues);
    const name = `${base()} (edited).${kind}`;
    downloadBlob(new Blob([text], { type: kind === 'srt' ? 'application/x-subrip' : 'text/vtt' }), name);
    api.last = { kind, name, text };
    page.message(`${name}: ${cues.length} captions on the edited timeline.`);
  }
  function exportEdl() {
    if (!S.words.length) return;
    const text = E.toEdl(S.keep, { title: `${base()} edit`, clip: S.src.name || 'source', fps: VIDEO_FPS });
    const name = `${base()} (edit list).edl`;
    downloadBlob(new Blob([text], { type: 'text/plain' }), name);
    api.last = { kind: 'edl', name, text };
    page.message(`${name}: ${S.keep.length} kept ranges, as CMX 3600 at ${VIDEO_FPS} fps. Any video editor can apply it to the original.`);
  }

  async function pickVideoCodec(w, h) {
    if (typeof VideoEncoder === 'undefined') return null;
    for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.42001f']) {
      const cfg = { codec, width: w, height: h, bitrate: 6_000_000, framerate: VIDEO_FPS, avc: { format: 'avc' } };
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch { /* next */ }
    }
    return null;
  }
  async function pickAudioCodec(rate, channels) {
    if (typeof AudioEncoder === 'undefined') return null;
    for (const [codec, mux, r] of [['mp4a.40.2', 'aac', rate], ['opus', 'opus', 48000]]) {
      const cfg = { codec, sampleRate: r, numberOfChannels: channels, bitrate: 160000 };
      try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux }; } catch { /* next */ }
    }
    return null;
  }
  async function exportVideo() {
    if (S.busy || !S.words.length || !S.src?.isVideo) return;
    stop();
    const total = E.keptLength(S.keep);
    if (total > MAX_VIDEO_SECONDS) { page.message('Edited video export takes up to 10 minutes. Export the audio and the edit list for longer edits.'); return; }
    const { canvas, video } = page;
    const vcfg = await pickVideoCodec(canvas.width, canvas.height);
    if (!vcfg) {
      page.message('This browser cannot encode video here. Download the edited audio and the edit list (EDL) instead; any video editor can apply the EDL to your original.');
      return;
    }
    lock(true);
    S.ctl = new AbortController();
    $('#te-cancel').hidden = false;
    const signal = S.ctl.signal;
    let venc;
    let aenc;
    try {
      const pcm = await ensurePcm();
      const acodec = await pickAudioCodec(pcm.rate, pcm.channels.length);
      const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.mjs');
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: 'avc', width: canvas.width, height: canvas.height, frameRate: VIDEO_FPS },
        ...(acodec ? { audio: { codec: acodec.mux, numberOfChannels: pcm.channels.length, sampleRate: acodec.cfg.sampleRate } } : {}),
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });
      let fail = null;
      venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (fail = e) });
      venc.configure(vcfg);
      // sound first: the edit, resampled for Opus when the browser has no AAC encoder
      if (acodec) {
        page.message('Encoding the sound…');
        aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (fail = e) });
        aenc.configure(acodec.cfg);
        const src = editedSource(pcm);
        let chs = src.read(0, src.frames);
        let rate = pcm.rate;
        if (acodec.cfg.sampleRate !== rate) {
          const len = Math.ceil((src.frames * acodec.cfg.sampleRate) / rate);
          const off = new OfflineAudioContext(chs.length, len, acodec.cfg.sampleRate);
          const b = off.createBuffer(chs.length, src.frames, rate);
          chs.forEach((x, c) => b.copyToChannel(x, c));
          const node = off.createBufferSource();
          node.buffer = b;
          node.connect(off.destination);
          node.start();
          const r = await off.startRendering();
          chs = Array.from({ length: r.numberOfChannels }, (_, c) => r.getChannelData(c));
          rate = acodec.cfg.sampleRate;
        }
        const n = chs[0].length;
        const B = rate; // one second per AudioData
        for (let o = 0; o < n; o += B) {
          const k = Math.min(B, n - o);
          const data = new Float32Array(k * chs.length);
          chs.forEach((x, c) => data.set(x.subarray(o, o + k), c * k));
          const ad = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: k, numberOfChannels: chs.length, timestamp: Math.round((o / rate) * 1e6), data });
          aenc.encode(ad);
          ad.close();
        }
        await aenc.flush();
      }
      // pictures: every frame of the edit, sought on the source and drawn with the edited captions
      video.pause();
      video.muted = true;
      const frames = Math.max(1, Math.round(total * VIDEO_FPS));
      const style = page.captionStyle();
      const cues = $('#te-burn').checked ? editedCues() : E.retimeCues(page.cues(), S.keep);
      const seek = (t) => new Promise((resolve) => {
        if (Math.abs(video.currentTime - t) < 0.0005 && video.readyState >= 2) { resolve(); return; }
        const done = () => { clearTimeout(timer); video.removeEventListener('seeked', done); resolve(); };
        const timer = setTimeout(done, 3000);
        video.addEventListener('seeked', done);
        video.currentTime = t;
      });
      for (let f = 0; f < frames; f++) {
        if (signal.aborted) throw Object.assign(new Error('Export cancelled.'), { name: 'AbortError' });
        if (fail) throw fail;
        const tOut = f / VIDEO_FPS;
        await seek(Math.min(video.duration - 0.001, E.outToSrc(tOut, S.keep)));
        const c = cues.find((q) => tOut >= q.start && tOut < q.end);
        page.drawFrame(null, c ? (c.lines ? c.lines.join(' ') : c.text) : '', style);
        const vf = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / VIDEO_FPS), duration: Math.round(1e6 / VIDEO_FPS) });
        venc.encode(vf, { keyFrame: f % (VIDEO_FPS * 2) === 0 });
        vf.close();
        while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
        if (f % 10 === 0) page.message(`Exporting the edited video ${Math.round((f / frames) * 100)}%`);
      }
      await venc.flush();
      if (fail) throw fail;
      muxer.finalize();
      const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
      const name = `${base()} (edited).mp4`;
      downloadBlob(blob, name);
      const saved = await save(blob, name, { video: { fps: VIDEO_FPS, width: canvas.width, height: canvas.height, audio: acodec?.mux || null, captions: cues.length } });
      api.last = { kind: 'mp4', name, duration: frames / VIDEO_FPS, size: blob.size, audio: acodec?.mux || null };
      page.message(`${name}: ${clock(frames / VIDEO_FPS)}${acodec ? '' : ' (this browser could not encode its sound; download the edited audio too)'}${saved ? ', saved to your library' : ''}.`);
    } catch (e) {
      page.message(e.name === 'AbortError' ? 'Export cancelled.' : `Video export failed: ${e.message}. The edited audio and the edit list still work.`);
    } finally {
      try { if (venc?.state !== 'closed') venc?.close(); } catch { /* closed */ }
      try { if (aenc?.state !== 'closed') aenc?.close(); } catch { /* closed */ }
      video.muted = false;
      S.ctl = null;
      lock(false);
    }
  }

  // ---------- wiring ----------
  function bind() {
    languages();
    $('#te-go').onclick = transcribe;
    $('#te-play').innerHTML = PLAY;
    $('#te-play').onclick = () => (player && !player.review ? stop() : play());
    $('#te-strike').onclick = () => strike(true);
    $('#te-restore').onclick = () => strike(false);
    $('#te-undo').onclick = undo;
    $('#te-redo').onclick = redo;
    for (const k of ['fillers', 'repeats', 'pauses']) $(`#te-${k}`).onclick = (e) => { if (e.target.closest('select')) return; S.review?.kind === k ? closeReview() : openReview(k); };
    $('#te-cap').onchange = () => { detect(); counts(); if (S.review?.kind === 'pauses') openReview('pauses'); };
    $('#te-cap').onclick = (e) => e.stopPropagation();
    $('#te-review-apply').onclick = applyReview;
    $('#te-review-cancel').onclick = closeReview;
    $('#te-mp3').onclick = () => exportAudio('mp3');
    $('#te-wav').onclick = () => exportAudio('wav');
    $('#te-video').onclick = exportVideo;
    $('#te-srt').onclick = () => exportCaptions('srt');
    $('#te-vtt').onclick = () => exportCaptions('vtt');
    $('#te-edl').onclick = exportEdl;
    $('#te-cancel').onclick = () => S.ctl?.abort();
    bindWords();
    document.addEventListener('keydown', (e) => {
      if ($('#te').hidden || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && currentSelection()) { e.preventDefault(); strike(); }
      else if (e.key === ' ' && !e.target.closest?.('button')) { e.preventDefault(); player && !player.review ? stop() : play(); }
      else if (e.key === 'Escape') { S.sel = null; window.getSelection()?.removeAllRanges(); update(); }
    });
    $('#te-go').disabled = true;
  }

  const api = {
    S,
    load,
    play,
    stop,
    strike,
    undo,
    redo,
    openReview,
    applyReview,
    select: (a, b = a) => { S.sel = { a, b }; update(); },
    keep: () => S.keep,
    length: () => E.keptLength(S.keep),
    playing: () => (player ? { pos: player.pos(), review: player.review } : null),
    last: null,
  };
  return { bind, setSource, api, stop, busy: () => S.busy };
}
