// A mix session, start to finish: open every stem, listen, label, ask the AI for the creative calls, run each
// channel strip, balance the buses, add the reverbs, master. Emits events the loading screen animates:
//   { type: 'stage', id, label }       { type: 'progress', value: 0..1 }
//   { type: 'track', index, name, role, color, peaks, feats }   (a lane appears in the DAW)
//   { type: 'trick', kind, index, data }                         (show off what's happening right now)
//   { type: 'notes', text }                                      (the AI's take)

import { decode } from '../extract.js';
import { labelStems, ROLES, ROLE_IDS } from './roles.js';
import { looksLikeRough } from './rough.js';
import { placeClips, applyTightening, ghostDouble, fmtTime } from './timeline.js';
import { retune } from './tune.js';
import { octaveDown } from './fx.js';
import { renderStrip, renderBuses, makeIR } from './render.js';
import { GENRES } from './rules.js';
import { cleanMacros, spreadPans, describeStrip, NEUTRAL_MACROS } from './plan.js';

export const RATE = 44100;
export const MAX_SECONDS = 7 * 60;
export const PLAN_TIMEOUT_MS = 15000;

let worker, seq = 0;
const pending = new Map();
function call(type, payload = {}, transfer = []) {
  worker ||= Object.assign(new Worker(new URL('./mix-worker.js', import.meta.url), { type: 'module' }), {
    onmessage: (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error)); },
    onerror: (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'The mixer stopped.')); pending.clear(); worker = null; },
  });
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); worker.postMessage({ id, type, ...payload }, transfer); });
}

async function open(stem, signal, { tighten = null } = {}) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  let chs;
  // Stems that are already audio (split from one song on this device): a copy, since the worker takes it.
  if (stem.channels) {
    if (stem.channels[0].length / RATE > MAX_SECONDS) throw new Error(`${stem.name} is ${Math.round(stem.channels[0].length / RATE / 60)} minutes long. Mix songs up to ${MAX_SECONDS / 60} minutes.`);
    chs = stem.channels.map((c) => c.slice());
  } else {
    const blob = await stem.blob();
    const file = blob instanceof File ? blob : new File([blob], stem.path.split('/').pop());
    const pcm = await decode(file, RATE);
    if (pcm.duration > MAX_SECONDS) throw new Error(`${stem.name} is ${Math.round(pcm.duration / 60)} minutes long. Mix songs up to ${MAX_SECONDS / 60} minutes.`);
    chs = [];
    for (let c = 0; c < Math.min(2, pcm.numberOfChannels); c++) chs.push(Float32Array.from(pcm.getChannelData(c)));
  }
  // A recording placed by its session: only the clips the artist kept, where they sit, as many times as they sit there.
  if (stem.clips?.length) {
    chs = placeClips(chs, RATE, stem.clips);
    if (chs[0].length / RATE > MAX_SECONDS) throw new Error(`The session runs ${Math.round(chs[0].length / RATE / 60)} minutes. Mix songs up to ${MAX_SECONDS / 60} minutes.`);
  }
  if (tighten?.length) chs = applyTightening(chs, RATE, tighten);
  return chs;
}

/** Ask the server's AI for roles it's unsure of and the creative calls (bounded). Falls back silently. */
async function aiPlan({ apiFetch, genre, referenceUrl, tracks, signal }) {
  if (!apiFetch) return null;
  // The planner is a bonus: if it (or the human check in front of it) takes more than 15 s, mix without it.
  const ctrl = new AbortController(), stop = () => ctrl.abort();
  signal?.addEventListener('abort', stop, { once: true });
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => { ctrl.abort(); resolve(null); }, PLAN_TIMEOUT_MS); });
  try {
    return await Promise.race([late, (async () => {
      const r = await apiFetch('/api/mix-plan', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctrl.signal, body: JSON.stringify({ genre, reference: referenceUrl || '', tracks }) });
      return r.ok ? await r.json() : null;
    })()]);
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
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
  // Roles the person set win; then roles a DAW session gave its tracks; then names and sound.
  const forced = stems.map((s, i) => opts.roles?.[i] || s.role || '');
  const session = stems.some((s) => s.clips?.length) ? { placed: stems.filter((s) => s.clips?.length).length, unused: stems.filter((s) => s.unused).length, daw: opts.sessionName || 'your session' } : null;
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
    const r = await call('analyze', { index: i, channels: chs, placed: !!stems[i].clips?.length }, chs.map((c) => c.buffer));
    feats[i] = r.feats;
    const guess = labelStems([{ path: stems[i].path, feats: r.feats }])[0];
    emit({ type: 'track', index: i, name: names[i], track: stems[i].track || null, role: guess.role, color: ROLES[guess.role].color, peaks: r.peaks, feats: r.feats });
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
  // A line the artist placed more than once (the same clip, several times) is a hook: it marks a chorus.
  const hookBars = [];
  for (const i of live) {
    const clips = stems[i].clips || [];
    if (!['leadVox', 'double', 'backVox'].includes(labels[i].role) || clips.length < 2) continue;
    const seen = new Map();
    for (const c of clips) { const key = `${c.offset.toFixed(2)}|${c.length.toFixed(2)}`; seen.set(key, [...(seen.get(key) || []), c]); }
    for (const same of seen.values()) if (same.length >= 2) for (const c of same) hookBars.push([c.start, c.start + c.length]);
  }
  const prep = await call('prepare', { roles: labels.map((l, i) => (i === roughIndex ? 'rough' : forced[i] === 'skip' ? 'skip' : l.role)), hookBars, genre });
  emit({ type: 'tempo', bpm: prep.bpm });
  if (prep.arrange) emit({ type: 'arrange', ...prep.arrange, names });
  for (const t of prep.tightened || []) emit({ type: 'tighten', index: t.index, name: names[t.index], phrases: t.phrases, maxMs: t.maxMs });
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

  // Pans for roles that spread (doubles, backing vocals, ad-libs, percussion, guitars). A session's track name wins.
  const pans = new Array(n).fill(null);
  for (const role of ['double', 'backVox', 'adlib', 'perc', 'guitar']) {
    const idx = live.filter((i) => labels[i].role === role && !leftOut.has(i));
    const named = idx.filter((i) => typeof stems[i].pan === 'number'), rest = idx.filter((i) => typeof stems[i].pan !== 'number');
    for (const i of named) pans[i] = stems[i].pan;
    const pp = rest.length === 1 && role !== 'guitar' && role !== 'double' ? [-0.3] : spreadPans(rest.length, role === 'double' ? 0.85 : role === 'guitar' ? 0.6 : 0.35, role === 'double' ? -0.2 : 0.15);
    pp.forEach((p, k) => { pans[rest[k]] = p; });
  }
  // Several doubles on one side spread inward a little, so they're a wall, not a point.
  for (const side of [-1, 1]) { const ds = live.filter((i) => labels[i].role === 'double' && !leftOut.has(i) && Math.sign(pans[i] || 0) === side); ds.forEach((i, k) => { pans[i] = side * Math.max(0.55, 0.9 - k * 0.15); }); }
  // Choruses with a lone lead get two made doubles (pitched ∓6 cents, 10 and 20 ms late, hard left and right).
  const hasDoubles = live.some((i) => ['double', 'backVox'].includes(labels[i].role) && !leftOut.has(i));
  const choruses = prep.arrange?.sections.filter((s) => s.kind === 'chorus') || [];
  const leadFor = choruses.length ? live.find((i) => labels[i].role === 'leadVox' && !leftOut.has(i)) : undefined;
  const ghostFor = !hasDoubles ? leadFor : undefined;
  // the deep layer: the lead an octave down under the hooks, in genres built on it
  const deepFor = G.deep ? leadFor : undefined;

  // 3. The console: every strip.
  const strips = [];
  const order = live.filter((i) => !leftOut.has(i)).sort((a, b) => ['drums', 'bass', 'music', 'vox'].indexOf(ROLES[labels[a].role].group) - ['drums', 'bass', 'music', 'vox'].indexOf(ROLES[labels[b].role].group));
  for (let k = 0; k < order.length; k++) {
    const i = order[k], role = labels[i].role;
    emit({ type: 'stage', id: 'console', label: `Mixing ${names[i]}`, index: i });
    const { plan } = await call('plan', { index: i, role, pan: pans[i], genre, macros, bpm: prep.bpm });
    const ghostSpecs = [...(i === ghostFor ? [[-6, 10, -0.85, 'double'], [6, 20, 0.85, 'double']] : []), ...(i === deepFor ? [[-1200, 0, 0, 'deep']] : [])];
    const ghosts = await Promise.all(ghostSpecs.map(async ([cents, delayMs, pan, grole]) => ({ cents, delayMs, pan, role: grole, plan: (await call('plan', { index: i, role: grole, pan, genre, macros, bpm: prep.bpm, ghost: true })).plan })));
    emit({ type: 'trick', kind: pickTrick(plan), index: i, data: plan });
    const tighten = (prep.tightened || []).some((t) => t.index === i) ? (await call('tightening', { index: i })).moves : null;
    let chs = await open(stems[i], signal, { tighten });
    // Retune: every vocal pulled toward the song's key at the genre's speed (the Tune macro moves it; -3 turns it off).
    let tuned = null;
    if (['leadVox', 'backVox', 'double', 'adlib'].includes(role) && G.tune && macros.tune > -3 && prep.key) {
      emit({ type: 'stage', id: 'console', label: `Tuning ${names[i]} to ${prep.key.name}`, index: i });
      const speedMs = Math.max(0, Math.round(G.tune.speedMs * 2 ** (-macros.tune / 1.5))), strength = Math.min(1, G.tune.strength * (1 + macros.tune * 0.15));
      const mono = chs.length > 1 ? Float32Array.from(chs[0], (v, j) => 0.5 * (v + chs[1][j])) : chs[0];
      const r = retune(mono, RATE, { key: prep.key, speedMs, strength });
      if (r.voicedShare > 0.02) { chs = [r.audio]; tuned = { key: prep.key.name, cents: Math.round(r.cents), speedMs, strength }; emit({ type: 'trick', kind: 'tune', index: i, data: { ...tuned } }); }
    }
    const monoForGhosts = ghosts.length ? (chs.length > 1 ? Float32Array.from(chs[0], (v, j) => 0.5 * (v + chs[1][j])) : chs[0].slice()) : null;
    const { dry, wet } = await renderStrip(chs, plan, RATE, prep.renderLength);
    const light = (p) => ({ ...p, rider: null, duck: null, auto: null, hpfCurve: null, deess: p.deess ? { f: p.deess.f } : null });
    const r = await call('addStrip', { index: i, plan: light(plan), dry, wet }, [...dry, ...wet].map((c) => c.buffer));
    strips[i] = { name: names[i], track: stems[i].track?.replace(/\.dup\d+$/, '') || null, role, color: ROLES[role].color, fader: r.fader, pan: plan.pan, plan: lite(plan), tuned, text: describeStrip(names[i], plan, r.fader, { tightened: tighten?.length || 0, tuned }) };
    emit({ type: 'strip', index: i, strip: strips[i] });
    for (const g of ghosts) {
      const deep = g.role === 'deep';
      emit({ type: 'stage', id: 'console', label: deep ? `Laying ${names[i]} an octave down under the hooks` : `Stacking ${names[i]} for the chorus`, index: i });
      emit({ type: 'trick', kind: 'stack', index: i, data: { cents: g.cents, delayMs: g.delayMs, pan: g.pan, choruses: choruses.length, deep } });
      const gch = [deep ? octaveDown(monoForGhosts, RATE) : ghostDouble(monoForGhosts, RATE, { cents: g.cents, delayMs: g.delayMs })];
      const out = await renderStrip(gch, g.plan, RATE, prep.renderLength);
      const gr = await call('addStrip', { index: i, plan: light(g.plan), dry: out.dry, wet: out.wet }, [...out.dry, ...out.wet].map((c) => c.buffer));
      const label = deep ? 'deep layer' : `double ${g.pan < 0 ? 'L' : 'R'}`;
      strips.push({ name: `${names[i]} · ${label}`, role: g.role, color: ROLES[g.role].color, fader: gr.fader, pan: g.pan, plan: lite(g.plan), made: true, text: deep ? `${names[i]} deep layer: the lead an octave down, under the hooks only, band-limited · fader ${gr.fader.toFixed(1)} dB` : `${names[i]} ${label}: made from the lead, ${g.cents > 0 ? '+' : ''}${g.cents} cents and ${g.delayMs} ms late, in the choruses only · fader ${gr.fader.toFixed(1)} dB` });
      emit({ type: 'strip', index: i, strip: strips[strips.length - 1], ghost: true });
    }
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
    // the hook bus gets a hall: longer and darker than the lead's plate, so the stack sits behind the lead
    hookIR: makeIR(RATE, { decay: Math.max(0.8, G.verbDecay * 1.4 + macros.space * 0.2), predelay: 0.045, damp: 5500, early: 0.1, seed: 23 }),
    hookReturn: { hp: 300, lp: 5500 },
    hook: { threshold: -22, ratio: 3, attack: 0.01, release: 0.15, knee: 6 },
    dist: Number.isFinite(G.dist) ? G.dist : null, parComp: Number.isFinite(G.parComp) ? G.parComp : null, slap: Number.isFinite(G.slap) ? G.slap : null,
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
    report: { buses: { hook: live.some((i) => ['double', 'backVox', 'adlib'].includes(labels[i].role) && !leftOut.has(i)), dist: busPlan.dist, parComp: busPlan.parComp, slap: busPlan.slap, punch: G.punch || 0, deep: deepFor !== undefined }, rough: roughInfo ? { ...roughInfo, coverage: m.coverage } : null, session, key: prep.key ? { name: prep.key.name, score: +prep.key.score.toFixed(2) } : null, tuned: strips.filter((s) => s?.tuned).map((s) => ({ name: s.name, cents: s.tuned.cents })), arrange: prep.arrange ? { ...prep.arrange, moves: prep.arrange.moves.map((mv) => ({ ...mv, time: fmtTime(mv.at) })) } : null, tightened: (prep.tightened || []).map((t) => ({ name: names[t.index], phrases: t.phrases, maxMs: t.maxMs })), ghosts: ghostFor !== undefined ? names[ghostFor] : null, genre, genreName: G.name, bpm: prep.bpm, lufs: m.lufs, truePeak: m.truePeak, targetLufs: G.lufs, macros, strips, balance: b.balance, tone: m.tone, notes: ai?.notes || '', reference: ai?.reference || null, usedReferenceFile: !!reference, aiUsed: !!ai },
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
