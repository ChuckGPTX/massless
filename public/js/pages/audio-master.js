// The Master tab on the Audio page: drop a mix, read the report, pick a character and a destination, A/B the
// master against the original at the same loudness, export 24-bit WAV or MP3, and keep it in the library.
// Decoding happens in this tab (extract.js), the chain runs in master-worker.js, the encoders are Extract's.

import * as X from '../extract.js';
import { DESTINATIONS, CHARACTERS } from '../master.js';
import { retainExport } from '../assets.js';
import { el, toast, download } from '../ui.js';

const PLAY = '<svg viewBox="0 0 16 16"><path d="M4.5 2.5v11l9-5.5z"/></svg>';
const PAUSE = '<svg viewBox="0 0 16 16"><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg>';
export const MAX_MASTER_SECONDS = 20 * 60;
const f1 = (x) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toFixed(1).replace('-', '−') : '−∞');
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function createMaster({ $, state, setBusy, progress }) {
  const m = {
    file: null, name: '', sourceId: null, rate: 0, origBuf: null, report: null, result: null, key: '',
    settings: { character: 'balanced', destination: 'streaming', widen: false },
    side: 'master', fair: true, ctx: null, play: null, offset: 0, lib: [],
  };
  try { Object.assign(m.settings, JSON.parse(localStorage.getItem('massless.master') || '{}')); } catch { /* defaults */ }
  if (!CHARACTERS[m.settings.character]) m.settings.character = 'balanced';
  if (!DESTINATIONS[m.settings.destination]) m.settings.destination = 'streaming';
  const save = () => { try { localStorage.setItem('massless.master', JSON.stringify(m.settings)); } catch { /* private mode */ } };

  // ---------- the worker ----------
  let worker = null;
  let seq = 0;
  const pending = new Map();
  function call(type, data = {}, transfer = [], onProgress) {
    if (!worker) {
      worker = new Worker(new URL('../master-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const { id, ok, error, code, progress: f, label, ...rest } = e.data;
        const p = pending.get(id);
        if (!p) return;
        if (f !== undefined && ok === undefined) { p.onProgress?.(f, label); return; }
        pending.delete(id);
        if (ok) p.resolve(rest);
        else { const err = new Error(error); err.code = code; p.reject(err); }
      };
      worker.onerror = (e) => {
        e.preventDefault?.();
        for (const p of pending.values()) p.reject(new Error('The mastering worker stopped. Reload the page and try again.'));
        pending.clear();
        worker = null;
      };
    }
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ id, type, ...data }, transfer);
    });
  }

  // ---------- side panel ----------
  function radios(box, items, key, sub) {
    box.replaceChildren(...Object.values(items).map((it) => el('button', { type: 'button', class: 'engine', role: 'radio', 'aria-checked': String(m.settings[key] === it.id), 'data-id': it.id, onclick: () => pick(key, it.id) },
      el('strong', {}, it.name), sub ? el('small', {}, sub(it)) : null, el('span', {}, it.note))));
  }
  function buildSide() {
    radios($('#mst-chars'), CHARACTERS, 'character', null);
    radios($('#mst-dests'), DESTINATIONS, 'destination', (d) => `${f1(d.lufs)} LUFS · ${f1(d.tp)} dBTP`);
    $('#mst-widen').checked = !!m.settings.widen;
    $('#mst-widen').addEventListener('change', (e) => pick('widen', e.target.checked));
  }
  function pick(key, value) {
    m.settings[key] = value;
    save();
    for (const [box, k] of [['#mst-chars', 'character'], ['#mst-dests', 'destination']]) {
      $(box).querySelectorAll('.engine').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === m.settings[k])));
    }
    if (m.result) render(); // a master already exists: make the new one right away
  }

  // ---------- reading a file ----------
  async function add(file, sourceId = null) {
    if (!file) return;
    if (state.busy) { toast('Wait for the current job to finish.'); return; }
    if (!X.looksLikeMedia(file)) { toast('Choose an audio file, or a video with sound.', 'error'); return; }
    stop();
    m.file = file;
    m.name = file.name || 'mix';
    m.sourceId = sourceId;
    m.result = null;
    m.report = null;
    m.key = '';
    $('#mst-out').hidden = true;
    $('#mst-quiet').hidden = true;
    $('#mst-body').hidden = true;
    $('#mst-drop').classList.add('compact');
    $('#mst-drop-title').textContent = m.name;
    $('#mst-drop-sub').textContent = 'Reading the audio in this tab…';
    $('#mst-choose').textContent = 'Choose another';
    setBusy(true, 'Reading');
    meter(true);
    try {
      const info = await X.probe(file);
      if (info.noAudio) throw new Error('This file has no sound track.');
      if (info.duration > MAX_MASTER_SECONDS) throw new Error('Master takes up to 20 minutes. Trim the file first.');
      const rate = X.workRate(info.sampleRate >= 8000 && info.sampleRate <= 96000 ? info.sampleRate : 0, 'mp3');
      const buf = await X.decode(file, rate, (f) => progress(f, 'Reading'));
      if (buf.duration > MAX_MASTER_SECONDS) throw new Error('Master takes up to 20 minutes. Trim the file first.');
      if (buf.duration < 1) throw new Error('This file is under a second long.');
      const n = Math.min(2, buf.numberOfChannels);
      const chs = [];
      for (let c = 0; c < n; c++) chs.push(Float32Array.from(buf.getChannelData(c)));
      if (buf.numberOfChannels > 2) for (let c = 2; c < buf.numberOfChannels; c++) { const x = buf.getChannelData(c); for (let i = 0; i < x.length; i++) chs[c % 2][i] += 0.5 * x[i]; }
      m.rate = buf.sampleRate;
      m.origBuf = new AudioBuffer({ length: chs[0].length, numberOfChannels: n, sampleRate: m.rate });
      chs.forEach((x, c) => m.origBuf.copyToChannel(x, c));
      setBusy(true, 'Measuring');
      await call('load', { rate: m.rate, channels: chs }, chs.map((x) => x.buffer));
      const { report } = await call('analyze');
      m.report = report;
      showReport();
      $('#mst-drop-sub').textContent = `${clock(report.duration)} · ${report.channels === 1 ? 'mono' : 'stereo'} · ${m.rate / 1000} kHz. Nothing is uploaded.`;
    } catch (e) {
      m.file = null;
      $('#mst-drop-title').textContent = 'Drop a finished mix here';
      $('#mst-drop-sub').textContent = e.message;
      $('#mst-drop').classList.remove('compact');
      toast(e.message, 'error');
      return;
    } finally {
      meter(false);
      setBusy(false);
      sync();
    }
    if (!m.report.tooQuiet) await render();
  }
  function meter(on) { $('#mst-meter').hidden = !on; }

  function rows(box, lines) {
    box.replaceChildren(...lines.flatMap((l) => [el('dt', {}, l.label), el('dd', {}, el('strong', {}, l.value), l.say ? el('span', {}, l.say) : null)]));
  }
  function showReport() {
    $('#mst-body').hidden = false;
    $('#mst-file').textContent = m.name;
    rows($('#mst-report'), m.report.lines);
    $('#mst-quiet').hidden = !m.report.tooQuiet;
  }

  // ---------- mastering ----------
  const keyOf = () => `${m.settings.character}|${m.settings.destination}|${m.settings.widen}`;
  let queued = false;
  async function render() {
    if (!m.report || m.report.tooQuiet) return;
    if (state.busy) { queued = true; return; }
    const key = keyOf();
    if (m.result && m.key === key) return;
    setBusy(true, 'Mastering');
    meter(true);
    try {
      const r = await call('render', { ...m.settings, lossy: false }, [], (f, label) => progress(f, label));
      const buf = new AudioBuffer({ length: r.channels[0].length, numberOfChannels: r.channels.length, sampleRate: m.rate });
      r.channels.forEach((x, c) => buf.copyToChannel(x, c));
      m.result = { ...r, buf };
      m.key = key;
      m.lib = [];
      showResult();
      swapPlaying();
    } catch (e) {
      if (e.code === 'quiet') { $('#mst-quiet').hidden = false; } else toast(`Mastering failed: ${e.message}`, 'error');
    } finally {
      meter(false);
      setBusy(false);
      sync();
    }
    if (queued) { queued = false; if (keyOf() !== m.key) render(); }
  }
  function showResult() {
    const r = m.result;
    const D = DESTINATIONS[r.plan.destination];
    $('#mst-out').hidden = false;
    rows($('#mst-after'), [
      { label: 'Master', value: `${f1(r.lufs)} LUFS · ${f1(r.truePeak)} dBTP`, say: `${CHARACTERS[r.plan.character].name} for ${D.name.toLowerCase()} (target ${f1(D.lufs)} LUFS, peaks under ${f1(D.tp)} dBTP).` },
      { label: 'What changed', value: `${r.gainDb >= 0 ? '+' : '−'}${Math.abs(r.gainDb).toFixed(1)} dB gain · limiter up to ${r.limiterDb.toFixed(1)} dB`, say: r.limiterDb > 6 ? 'The limiter works hard here: expect less punch. A gentler destination keeps more of it.' : D.id === 'loud' ? 'Streaming services will turn this down to about −14 LUFS.' : 'Peaks were held with headroom to spare.' },
    ]);
    $('#mst-measured').textContent = '';
    $('#mst-lib').hidden = true;
    syncAb();
  }

  // ---------- A/B ----------
  function gains() {
    const o = m.report?.lufs;
    const t = m.result?.lufs;
    if (!m.fair || !Number.isFinite(o) || !Number.isFinite(t)) return [1, 1];
    const low = Math.min(o, t); // turn the louder one down, never the quieter one up
    return [10 ** ((low - o) / 20), 10 ** ((low - t) / 20)];
  }
  function syncAb() {
    $('#mst-a').setAttribute('aria-pressed', String(m.side === 'original'));
    $('#mst-b').setAttribute('aria-pressed', String(m.side === 'master'));
    $('#mst-play').innerHTML = m.play ? PAUSE : PLAY;
    $('#mst-play').setAttribute('aria-label', m.play ? 'Pause' : 'Play');
    const [ga, gb] = gains();
    if (m.play) {
      const t = m.play.ctx.currentTime;
      m.play.ga.gain.setTargetAtTime(m.side === 'original' ? ga : 0, t, 0.004);
      m.play.gb.gain.setTargetAtTime(m.side === 'master' ? gb : 0, t, 0.004);
    }
    const g = m.side === 'original' ? ga : gb;
    $('#mst-ab-note').textContent = `Hearing the ${m.side}${m.fair && g < 0.999 ? `, turned down ${f1(-20 * Math.log10(g))} dB to match` : ''}`;
  }
  function position() {
    if (!m.play) return m.offset;
    return Math.min(m.origBuf.duration, m.offset + (m.play.ctx.currentTime - m.play.t0));
  }
  async function start(at = m.offset) {
    if (!m.result) return;
    m.ctx ||= new AudioContext({ sampleRate: m.rate });
    await m.ctx.resume();
    const ctx = m.ctx;
    const ga = ctx.createGain();
    const gb = ctx.createGain();
    ga.gain.value = 0;
    gb.gain.value = 0;
    ga.connect(ctx.destination);
    gb.connect(ctx.destination);
    const a = ctx.createBufferSource();
    const b = ctx.createBufferSource();
    a.buffer = m.origBuf;
    b.buffer = m.result.buf;
    a.connect(ga);
    b.connect(gb);
    const t0 = ctx.currentTime + 0.03;
    m.offset = Math.max(0, Math.min(at, m.origBuf.duration - 0.05));
    a.start(t0, m.offset);
    b.start(t0, m.offset);
    b.onended = () => { if (m.play?.b === b) { stop(); m.offset = 0; tick(); } };
    m.play = { ctx, a, b, ga, gb, t0 };
    syncAb();
    requestAnimationFrame(tick);
  }
  function stop() {
    if (!m.play) return;
    m.offset = position();
    const { a, b, ga, gb } = m.play;
    m.play = null;
    try { a.stop(); b.stop(); } catch { /* not started */ }
    setTimeout(() => { ga.disconnect(); gb.disconnect(); }, 50);
    syncAb();
  }
  function swapPlaying() {
    if (!m.play) return;
    const at = position();
    stop();
    start(at);
  }
  function tick() {
    const t = position();
    const d = m.origBuf?.duration || 1;
    if (document.activeElement !== $('#mst-pos')) $('#mst-pos').value = String(t / d);
    $('#mst-time').textContent = `${clock(t)} / ${clock(d)}`;
    if (m.play) requestAnimationFrame(tick);
  }
  function side(which) {
    m.side = which;
    syncAb();
  }

  // ---------- export ----------
  const base = () => X.outputName(m.name, 'x').replace(/\.x$/, '');
  function parseWav(buf) {
    const v = new DataView(buf);
    let o = 12;
    let fmt = null;
    while (o + 8 <= v.byteLength) {
      const id = String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
      const size = v.getUint32(o + 4, true);
      if (id === 'fmt ') fmt = { ch: v.getUint16(o + 10, true), bits: v.getUint16(o + 22, true) };
      if (id === 'data' && fmt) {
        const bytes = fmt.bits / 8;
        const n = Math.floor(size / (bytes * fmt.ch));
        const chs = Array.from({ length: fmt.ch }, () => new Float32Array(n));
        for (let i = 0, p = o + 8; i < n; i++) {
          for (let c = 0; c < fmt.ch; c++, p += bytes) {
            if (bytes === 3) { let x = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16); chs[c][i] = x / 8388608; }
            else chs[c][i] = v.getInt16(p, true) / 32768;
          }
        }
        return chs;
      }
      o += 8 + size + (size & 1);
    }
    throw new Error('Could not read the WAV back.');
  }
  async function exportAs(format) {
    if (!m.result || state.busy) return;
    const D = DESTINATIONS[m.result.plan.destination];
    setBusy(true, format === 'wav' ? 'Writing WAV' : 'Mastering for MP3');
    meter(true);
    try {
      let chs = m.result.channels;
      if (format === 'mp3') {
        // MP3 encoders overshoot peaks a little, so the MP3 gets its own master with 1 dB more headroom
        const r = await call('render', { ...m.settings, lossy: true }, [], (f, label) => progress(f, label));
        chs = r.channels;
        X.warm();
      }
      const src = { rate: m.rate, channels: chs.length, frames: chs[0].length, read: (off, n) => chs.map((x) => x.slice(off, off + n)) };
      const out = await X.encode(src, format === 'wav' ? { format: 'wav', bits: 24 } : { format: 'mp3', kbps: 320 }, { onProgress: (f, l) => progress(f, l === 'Converting' ? 'Encoding' : l) });
      const name = `${base()} (master, ${D.name.toLowerCase()}).${format}`;
      download(out.blob, name);
      // measure what was actually written
      progress(null, 'Checking the file');
      let back;
      if (format === 'wav') back = parseWav(await out.blob.arrayBuffer());
      else {
        const dec = await new OfflineAudioContext(chs.length, 1, m.rate).decodeAudioData(await out.blob.arrayBuffer());
        back = Array.from({ length: dec.numberOfChannels }, (_, c) => Float32Array.from(dec.getChannelData(c)));
      }
      const meas = await call('measure', { rate: m.rate, channels: back }, back.map((x) => x.buffer));
      const ok = meas.truePeak <= D.tp + 0.05;
      $('#mst-measured').textContent = `Measured on the ${format.toUpperCase()} file: ${f1(meas.lufs)} LUFS, ${f1(meas.truePeak)} dBTP${ok ? '' : ` (over the ${f1(D.tp)} dBTP target after encoding: try WAV)`}.`;
      const { saved } = await retainExport(out.blob, { name, engine: 'local-master', sourceId: m.sourceId, settings: { ...m.settings, lufs: meas.lufs, truePeak: meas.truePeak, format } });
      $('#mst-lib').hidden = !saved;
      toast(saved ? `${name} downloaded and saved to your library.` : `${name} downloaded. Browser storage could not keep a copy.`);
      window.massless && (window.massless.lastMaster = { format, name, size: out.blob.size, lufs: meas.lufs, truePeak: meas.truePeak, destination: D.id, saved });
    } catch (e) {
      toast(`Export failed: ${e.message}`, 'error');
    } finally {
      meter(false);
      setBusy(false);
      sync();
    }
  }

  // ---------- wiring ----------
  function sync() {
    const b = $('#gen-master');
    if (!state.busy) {
      b.disabled = !m.report || m.report.tooQuiet;
      $('#gen-master-label').textContent = m.result && m.key === keyOf() ? 'Mastered' : 'Master';
    }
    for (const id of ['#mst-wav', '#mst-mp3']) $(id).disabled = state.busy || !m.result;
  }
  function bind() {
    buildSide();
    $('#mst-in').addEventListener('change', (e) => { add(e.target.files[0]); e.target.value = ''; });
    $('#gen-master').addEventListener('click', () => (m.report ? render() : $('#mst-in').click()));
    $('#mst-play').addEventListener('click', () => (m.play ? stop() : start()));
    $('#mst-a').addEventListener('click', () => side('original'));
    $('#mst-b').addEventListener('click', () => side('master'));
    $('#mst-fair').addEventListener('change', (e) => { m.fair = e.target.checked; syncAb(); });
    $('#mst-pos').addEventListener('change', (e) => {
      const t = Number(e.target.value) * (m.origBuf?.duration || 0);
      if (m.play) { stop(); start(t); } else { m.offset = t; tick(); }
    });
    $('#mst-wav').addEventListener('click', () => exportAs('wav'));
    $('#mst-mp3').addEventListener('click', () => exportAs('mp3'));
    document.addEventListener('keydown', (e) => {
      if (state.tab !== 'master' || !m.result || e.target.closest?.('input, textarea, select')) return;
      if (e.key === 'a' || e.key === 'A') side('original');
      else if (e.key === 'b' || e.key === 'B') side('master');
      else if (e.key === ' ' && !e.target.closest?.('button')) { e.preventDefault(); m.play ? stop() : start(); }
    });
    $('#mst-play').innerHTML = PLAY;
    sync();
  }

  return { m, add, render, bind, sync, stop, ready: () => !!m.report && !m.report.tooQuiet };
}
