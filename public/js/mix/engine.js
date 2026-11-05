// A mix session, start to finish: open every stem, listen, label, ask the AI for the creative calls, run each
// channel strip, balance the buses, add the reverbs, master. Emits events the loading screen animates:
//   { type: 'stage', id, label }       { type: 'progress', value: 0..1 }
//   { type: 'track', index, name, role, color, peaks, feats }   (a lane appears in the DAW)
//   { type: 'trick', kind, index, data }                         (show off what's happening right now)
//   { type: 'notes', text }                                      (the AI's take)

import { decode } from '../extract.js';
import { labelStems, ROLES, ROLE_IDS } from './roles.js';
import { looksLikeRough } from './rough.js';
import { renderStrip, renderBuses, makeIR } from './render.js';
import { GENRES } from './rules.js';
import { cleanMacros, spreadPans, describeStrip, NEUTRAL_MACROS } from './plan.js';

export const RATE = 44100;
export const MAX_SECONDS = 7 * 60;

let worker, seq = 0;
const pending = new Map();
function call(type, payload = {}, transfer = []) {
  worker ||= Object.assign(new Worker(new URL('./mix-worker.js', import.meta.url), { type: 'module' }), {
    onmessage: (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error)); },
    onerror: (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'The mixer stopped.')); pending.clear(); worker = null; },
  });
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); worker.postMessage({ id, type, ...payload }, transfer); });
}

async function open(stem, signal) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  // Stems that are already audio (split from one song on this device): a copy, since the worker takes it.
  if (stem.channels) {
    if (stem.channels[0].length / RATE > MAX_SECONDS) throw new Error(`${stem.name} is ${Math.round(stem.channels[0].length / RATE / 60)} minutes long. Mix songs up to ${MAX_SECONDS / 60} minutes.`);
    return stem.channels.map((c) => c.slice());
  }
  const blob = await stem.blob();
  const file = blob instanceof File ? blob : new File([blob], stem.path.split('/').pop());
  const pcm = await decode(file, RATE);
  if (pcm.duration > MAX_SECONDS) throw new Error(`${stem.name} is ${Math.round(pcm.duration / 60)} minutes long. Mix songs up to ${MAX_SECONDS / 60} minutes.`);
  const chs = [];
  for (let c = 0; c < Math.min(2, pcm.numberOfChannels); c++) chs.push(Float32Array.from(pcm.getChannelData(c)));
  return chs;
}

/** Ask the server's AI for roles it's unsure of and the creative calls (bounded). Falls back silently. */
async function aiPlan({ apiFetch, genre, referenceUrl, tracks, signal }) {
  if (!apiFetch) return null;
  try {
    const r = await apiFetch('/api/mix-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, signal, body: JSON.stringify({ genre, reference: referenceUrl || '', tracks }) });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
}

/**
 * Run a session. stems: from intake.gather(). opts: { genre, referenceUrl, referenceFile, macros, apiFetch, onEvent, signal }.
 * Returns { audio: { mix, instrumental, acapella, before, premaster }, rate, report }.
 */
export async function runMix(stems, opts = {}) {
  const { genre = 'hiphop', referenceUrl = '', referenceFile = null, apiFetch, signal } = opts;
  const emit = (e) => { try { opts.onEvent?.(e); } catch { /* the show must go on */ } };
  const G = GENRES[genre] || GENRES.hiphop;
  const n = stems.length;
  if (!n) throw new Error('Add at least one stem.');
  // Weights for the progress bar: listening 30%, the console 45%, buses 10%, master 15%.
  const prog = (base, span, k) => emit({ type: 'progress', value: base + span * k });
  await call('reset', { rate: RATE });

  // 0. The rough mix: a file given on its own, a stem marked as the rough, or one named like a bounce.
  const forced = opts.roles || [];
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  let roughIndex = forced.findIndex((r) => r === 'rough');
  if (roughIndex < 0 && !opts.roughFile && opts.autoRough !== false) roughIndex = stems.findIndex((s) => looksLikeRough(s.path, stems.map((x) => x.path)));
  const roughSource = opts.roughFile ? { name: opts.roughFile.name.replace(/\.[^.]+$/, ''), path: opts.roughFile.name, blob: async () => opts.roughFile } : roughIndex >= 0 ? stems[roughIndex] : null;
  const excluded = (i) => i === roughIndex || forced[i] === 'skip';
  let roughInfo = null;
  if (roughSource) {
    emit({ type: 'stage', id: 'listen', label: `Listening to your rough mix: ${roughSource.name}` });
    const chs = await open(roughSource, signal);
    const r = await call('bounce', { channels: chs }, chs.map((c) => c.buffer));
    roughInfo = { name: roughSource.name, duration: r.duration };
    emit({ type: 'rough', name: roughSource.name, peaks: r.peaks, duration: r.duration });
  }

  // 1. Listen.
  emit({ type: 'stage', id: 'listen', label: 'Opening your session' });
  const feats = [], names = stems.map((s) => s.name);
  for (let i = 0; i < n; i++) {
    if (excluded(i)) continue;
    emit({ type: 'stage', id: 'listen', label: `Listening to ${stems[i].name}` });
    const chs = await open(stems[i], signal);
    const r = await call('analyze', { index: i, channels: chs }, chs.map((c) => c.buffer));
    feats[i] = r.feats;
    const guess = labelStems([{ path: stems[i].path, feats: r.feats }])[0];
    emit({ type: 'track', index: i, name: names[i], role: guess.role, color: ROLES[guess.role].color, peaks: r.peaks, feats: r.feats });
    prog(0, 0.3, (i + 1) / n);
  }
  const blank = { activeSeconds: 0, lowShare: 0, highShare: 0, onsetsPerSec: 0, isMono: true, activeRatio: 0, subShare: 0, midShare: 0, centroid: 1000, crestDb: 0, width: 0 };
  let labels = labelStems(stems.map((s, i) => ({ path: s.path, feats: feats[i] || blank })));
  // Roles the person picked by hand win over everything.
  labels = labels.map((l, i) => (ROLE_IDS.includes(forced[i]) ? { role: forced[i], source: 'name' } : l));
  const live = [...Array(n).keys()].filter((i) => !excluded(i));

  // 2. The creative calls.
  emit({ type: 'stage', id: 'think', label: 'Planning the mix for ' + G.name });
  const ai = await aiPlan({ apiFetch, genre, referenceUrl, signal, tracks: live.map((i) => stems[i]).map((s, k, arr, i = live[k]) => ({ name: s.path.split('/').slice(-2).join('/'), role: labels[i].role, sure: labels[i].source === 'name', seconds: Math.round(feats[i].activeSeconds), low: +feats[i].lowShare.toFixed(2), high: +feats[i].highShare.toFixed(2), punch: +feats[i].onsetsPerSec.toFixed(1), stereo: !feats[i].isMono })) });
  if (ai?.roles) live.forEach((i, k) => { if (labels[i].source !== 'name' && ROLE_IDS.includes(ai.roles[k])) labels[i] = { role: ai.roles[k], source: 'ai' }; });
  const macros = cleanMacros({ ...NEUTRAL_MACROS, ...(ai?.macros || {}), ...(opts.macros || {}) });
  if (ai?.notes) emit({ type: 'notes', text: ai.notes, reference: ai.reference || null });
  live.forEach((i) => emit({ type: 'relabel', index: i, role: labels[i].role, color: ROLES[labels[i].role].color }));

  let reference = null;
  if (referenceFile) {
    emit({ type: 'stage', id: 'think', label: 'Measuring your reference track' });
    try { const chs = await open({ name: referenceFile.name, path: referenceFile.name, blob: async () => referenceFile }, signal); reference = await call('reference', { channels: chs }, chs.map((c) => c.buffer)); }
    catch (e) { if (signal?.aborted) throw e; emit({ type: 'notes', text: 'Couldn’t read the reference file, so the genre target is used instead.' }); }
  }
  const prep = await call('prepare', { roles: labels.map((l, i) => (i === roughIndex ? 'rough' : forced[i] === 'skip' ? 'skip' : l.role)) });
  emit({ type: 'tempo', bpm: prep.bpm });
  // No rough given, but one "stem" is clearly the whole song: start again with it as the rough.
  if (!roughSource && Number.isInteger(prep.rough?.probable) && opts.autoRough !== false) {
    emit({ type: 'notes', text: `${names[prep.rough.probable]} sounds like the full song, so it's your rough mix: the reference for timing and balance.` });
    const roles = stems.map((_, i) => (i === prep.rough.probable ? 'rough' : forced[i] || ''));
    return runMix(stems, { ...opts, roles, autoRough: false });
  }
  const matched = roughSource && prep.rough?.moved ? prep.rough : null; // without a rough, prep only says whether a stem sounds like one
  const leftOut = new Set(matched?.leaveOut || []);
  if (matched) {
    const R = prep.rough;
    roughInfo = { ...roughInfo, fit: R.fit, moved: R.moved.map((m) => ({ name: names[m.index], ms: m.ms })), leftOut: [...leftOut].map((i) => names[i]), missing: R.missing.map((g) => g.label), adjust: R.adjust.filter((a) => Math.abs(a.db) >= 0.5).map((a) => ({ name: names[a.index], db: a.db })), diag: (R.diag || []).map((d) => ({ ...d, name: names[d.index] })) };
    emit({ type: 'trick', kind: 'align', data: roughInfo });
    for (const i of leftOut) emit({ type: 'leftout', index: i });
  }

  // Pans for roles that spread (backing vocals, ad-libs, percussion, guitars).
  const pans = new Array(n).fill(null);
  for (const role of ['backVox', 'adlib', 'perc', 'guitar']) {
    const idx = live.filter((i) => labels[i].role === role && !leftOut.has(i));
    const pp = idx.length === 1 && role !== 'guitar' ? [-0.3] : spreadPans(idx.length, role === 'guitar' ? 0.6 : 0.35);
    pp.forEach((p, k) => { pans[idx[k]] = p; });
  }

  // 3. The console: every strip.
  const strips = [];
  const order = live.filter((i) => !leftOut.has(i)).sort((a, b) => ['drums', 'bass', 'music', 'vox'].indexOf(ROLES[labels[a].role].group) - ['drums', 'bass', 'music', 'vox'].indexOf(ROLES[labels[b].role].group));
  for (let k = 0; k < order.length; k++) {
    const i = order[k], role = labels[i].role;
    emit({ type: 'stage', id: 'console', label: `Mixing ${names[i]}`, index: i });
    const { plan } = await call('plan', { index: i, role, pan: pans[i], genre, macros, bpm: prep.bpm });
    emit({ type: 'trick', kind: pickTrick(plan), index: i, data: plan });
    const chs = await open(stems[i], signal);
    const { dry, wet } = await renderStrip(chs, plan, RATE, prep.renderLength);
    const r = await call('addStrip', { index: i, plan: { ...plan, rider: null, duck: null, deess: plan.deess ? { f: plan.deess.f } : null }, dry, wet }, [...dry, ...wet].map((c) => c.buffer));
    strips[i] = { name: names[i], role, color: ROLES[role].color, fader: r.fader, pan: plan.pan, plan: lite(plan), text: describeStrip(names[i], plan, r.fader) };
    emit({ type: 'strip', index: i, strip: strips[i] });
    prog(0.3, 0.45, (k + 1) / order.length);
  }

  // 4. Buses and space.
  emit({ type: 'stage', id: 'bus', label: 'Gluing the buses and building the space' });
  emit({ type: 'trick', kind: 'verb', data: { decay: G.verbDecay } });
  const b = await call('buses', { genre, macros });
  const busPlan = {
    gains: b.gains,
    drums: { threshold: -22, ratio: 2.5, attack: 0.03, release: 0.12, knee: 6 },
    vox: { threshold: -20, ratio: 2, attack: 0.01, release: 0.15, knee: 6 },
    mix: { threshold: -14, ratio: 2, attack: 0.03, release: 0.2, knee: 6 },
    duck: { f: 2500, eq: b.duck.eq, gain: b.duck.gain },
    verbDuck: G.verbDuck ? b.duck.verb : null,
    voxIR: makeIR(RATE, { decay: Math.max(0.5, G.verbDecay + macros.space * 0.15), predelay: G.predelay ?? 0.035, damp: 7000, early: 0.15 }),
    beatIR: makeIR(RATE, { decay: 0.9, predelay: 0.01, damp: 5000, early: 0.35, seed: 11 }),
    voxReturn: { hp: 250, lp: 6000 }, beatReturn: { hp: 300, lp: 6000 },
  };
  prog(0.75, 0.05, 0.5);
  const out = await renderBuses(b.buses, busPlan, RATE, b.length);
  prog(0.75, 0.1, 1);

  // 5. Master.
  emit({ type: 'stage', id: 'master', label: `Mastering to ${G.lufs} LUFS for ${G.name}` });
  emit({ type: 'trick', kind: 'loud', data: { lufs: G.lufs } });
  const m = await call('master', { mix: out.mix, instrumental: out.instrumental, acapella: out.acapella, genre, macros, reference }, [...out.mix, ...out.instrumental, ...out.acapella].map((c) => c.buffer));
  prog(0.85, 0.15, 1);
  emit({ type: 'stage', id: 'done', label: 'Your mix is ready' });
  return {
    rate: RATE,
    audio: { mix: m.mix, instrumental: m.instrumental, acapella: m.acapella, before: m.before, premaster: m.premaster },
    report: { rough: roughInfo ? { ...roughInfo, coverage: m.coverage } : null, genre, genreName: G.name, bpm: prep.bpm, lufs: m.lufs, truePeak: m.truePeak, targetLufs: G.lufs, macros, strips, balance: b.balance, tone: m.tone, notes: ai?.notes || '', reference: ai?.reference || null, usedReferenceFile: !!reference, aiUsed: !!ai },
  };
}

function pickTrick(p) {
  if (p.duck) return 'sidechain';
  if (p.deess) return 'deess';
  if (p.comp && p.comp.ratio >= 3.5) return 'comp';
  if (Math.abs(p.pan) > 0.2 || (p.width && p.width > 1.05)) return 'pan';
  return 'eq';
}
function lite(p) {
  return { hpf: p.hpf, lpf: p.lpf, eq: p.eq, comp: p.comp, comp2: p.comp2, sat: p.sat, pan: p.pan, width: p.width, verb: p.verb, delay: p.delay ? { time: p.delay.time, send: p.delay.send } : null, deess: !!p.deess, rider: !!p.rider, duck: !!p.duck, group: p.group, level: p.level, trim: p.trim };
}
