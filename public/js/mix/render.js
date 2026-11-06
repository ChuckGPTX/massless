// The console. Each stem runs through its own channel strip, rendered offline by the browser's audio engine
// (native filters, compressors, saturation, delay); then the buses, the reverbs and the mix bus.
// Every path through a strip or the bus stage passes exactly two compressors, so their look-ahead delay is the
// same everywhere and the stems stay sample-aligned; that latency is measured once and trimmed.

import { ENV_RATE } from './analyze.js';

const dbToGain = (d) => 10 ** (d / 20);

function bufferFrom(ctx, chs, rate) {
  const b = ctx.createBuffer(chs.length, chs[0].length, rate);
  chs.forEach((c, i) => b.copyToChannel(c, i));
  return b;
}

function compressor(ctx, c) {
  const n = ctx.createDynamicsCompressor();
  const s = c || { threshold: 0, ratio: 1, knee: 0, attack: 0.01, release: 0.1 };
  n.threshold.value = s.threshold; n.ratio.value = Math.max(1, Math.min(20, s.ratio)); n.knee.value = s.knee ?? 6;
  n.attack.value = Math.max(0, s.attack); n.release.value = Math.max(0.01, s.release);
  return n;
}

function filter(ctx, f) {
  const n = ctx.createBiquadFilter();
  n.type = f.type; n.frequency.value = Math.min(f.f, ctx.sampleRate * 0.45);
  // Q is given the usual way (0.707 = Butterworth); for lowpass and highpass the browser wants it in dB.
  if (f.q != null) n.Q.value = f.type === 'lowshelf' || f.type === 'highshelf' ? 0 : f.type === 'lowpass' || f.type === 'highpass' ? 20 * Math.log10(f.q) : f.q;
  if (f.gain != null) n.gain.value = f.gain;
  return n;
}

// Soft clip: tanh with drive, level-compensated so a drive change is a colour change, not a level change.
export function saturationCurve(drive, n = 2048) {
  const c = new Float32Array(n), k = Math.max(0.1, drive), norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
}

function curveAt(param, values, duration, toGain) {
  if (!values || !values.length) return;
  const v = toGain ? Float32Array.from(values, (d) => dbToGain(d)) : Float32Array.from(values);
  param.setValueCurveAtTime(v, 0, Math.max(0.02, Math.min(duration, values.length / ENV_RATE)));
}

let latencyCache = null;
/** Samples of delay a strip adds (the compressors' look-ahead), measured on this browser. */
export async function stripLatency(rate) {
  if (latencyCache?.rate === rate) return latencyCache.n;
  const len = Math.round(rate * 0.1), ctx = new OfflineAudioContext(1, len, rate);
  const imp = ctx.createBuffer(1, len, rate); imp.getChannelData(0)[0] = 1;
  const src = ctx.createBufferSource(); src.buffer = imp;
  src.connect(compressor(ctx)).connect(compressor(ctx)).connect(ctx.destination); src.start();
  const out = (await ctx.startRendering()).getChannelData(0);
  let at = 0, best = 0;
  for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > best) { best = Math.abs(out[i]); at = i; }
  latencyCache = { rate, n: at };
  return at;
}

/**
 * One channel strip. chs: the stem (planar, 1 or 2 channels). p: its plan (see plan.js).
 * Returns { dry: [L, R], wet: [L, R] } at `length` samples (wet = the strip's own delay echoes).
 */
export async function renderStrip(chs, p, rate, length) {
  if (p.mono && chs.length > 1) { const m = new Float32Array(chs[0].length); for (let i = 0; i < m.length; i++) m[i] = 0.5 * (chs[0][i] + chs[1][i]); chs = [m]; }
  const lat = await stripLatency(rate);
  const ctx = new OfflineAudioContext(4, length + lat, rate);
  ctx.destination.channelInterpretation = 'discrete';
  const dur = length / rate;
  const src = ctx.createBufferSource(); src.buffer = bufferFrom(ctx, chs, rate);
  let node = src;
  const chain = (n) => { node.connect(n); node = n; return n; };
  chain(ctx.createGain()).gain.value = dbToGain(p.trim);
  if (p.rider) curveAt(chain(ctx.createGain()).gain, p.rider, dur, true);
  // Automation written by the arrangement: clean-up between phrases, section lifts, the drop before a chorus.
  if (p.auto) curveAt(chain(ctx.createGain()).gain, p.auto, dur, true);
  // The build-up sweep: a high-pass that climbs over the last bars before a chorus (10 Hz = out of the way).
  if (p.hpfCurve) { const sw = chain(filter(ctx, { type: 'highpass', f: 10, q: 0.707 })); curveAt(sw.frequency, Float32Array.from(p.hpfCurve, (v) => Math.max(10, v)), dur, false); }
  if (p.hpf) { chain(filter(ctx, { type: 'highpass', f: p.hpf, q: 0.54 })); chain(filter(ctx, { type: 'highpass', f: p.hpf, q: 1.31 })); }
  if (p.lpf) chain(filter(ctx, { type: 'lowpass', f: p.lpf, q: 0.707 }));
  for (const f of p.eq || []) if (!/peaking|shelf/.test(f.type) || Math.abs(f.gain || 0) >= 0.1) chain(filter(ctx, f));
  if (p.deess) { const d = chain(filter(ctx, { type: 'peaking', f: p.deess.f, q: 1.4, gain: 0 })); curveAt(d.gain, p.deess.curve, dur, false); }
  chain(compressor(ctx, p.comp));
  chain(compressor(ctx, p.comp2));
  if (p.sat && p.sat.mix > 0) {
    const split = ctx.createGain(), join = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain(), shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve(p.sat.drive); shaper.oversample = 'none';
    dry.gain.value = 1 - p.sat.mix; wet.gain.value = p.sat.mix * dbToGain(p.sat.wetTrim || 0);
    node.connect(split); split.connect(dry).connect(join); split.connect(shaper).connect(wet).connect(join); node = join;
  }
  if (p.post) chain(filter(ctx, p.post));
  const fader = chain(ctx.createGain());
  if (p.duck) curveAt(fader.gain, p.duck, dur, true);
  const pan = ctx.createStereoPanner(); pan.pan.value = Math.max(-1, Math.min(1, p.pan || 0));
  node.connect(pan);
  const merger = ctx.createChannelMerger(4), split2 = ctx.createChannelSplitter(2);
  pan.connect(split2); split2.connect(merger, 0, 0); split2.connect(merger, 1, 1);
  if (p.delay && p.delay.send > -60) {
    const send = ctx.createGain(); send.gain.value = dbToGain(p.delay.send);

    const hp = filter(ctx, { type: 'highpass', f: p.delay.hp || 300, q: 0.707 }), lp = filter(ctx, { type: 'lowpass', f: p.delay.lp || 6000, q: 0.707 });
    const dl = ctx.createDelay(4); dl.delayTime.value = Math.min(3.9, p.delay.time);
    const fb = ctx.createGain(); fb.gain.value = Math.min(0.7, p.delay.feedback);
    let into = fader.connect(send);
    if (p.fxMute) { const m = ctx.createGain(); curveAt(m.gain, p.fxMute, dur, true); into = into.connect(m); } // the dry punch: delay off for the last beat
    into.connect(hp).connect(lp).connect(dl); dl.connect(fb).connect(dl);
    const dpan = ctx.createStereoPanner(); dpan.pan.value = p.delay.pan ?? 0;
    const split3 = ctx.createChannelSplitter(2);
    // the delay ducker: the echoes duck while the voice sings and come up in the gaps
    let echo = dl;
    if (p.delayDuck) { const dg = ctx.createGain(); curveAt(dg.gain, p.delayDuck, dur, true); echo = dl.connect(dg); }
    echo.connect(dpan).connect(split3); split3.connect(merger, 0, 2); split3.connect(merger, 1, 3);
  }
  merger.connect(ctx.destination);
  // Where the stem sits in the song (from the rough mix): later is a delay, earlier skips into the file.
  const shift = p.shift || 0;
  if (shift >= 0) src.start(shift); else src.start(0, -shift);
  const out = await ctx.startRendering();
  const take = (c) => out.getChannelData(c).slice(lat, lat + length);
  const dry = [take(0), take(1)], wet = [take(2), take(3)];
  if (p.width && p.width !== 1) { // mid/side width on stereo stems
    const [L, R] = dry, w = p.width;
    for (let i = 0; i < length; i++) { const m = 0.5 * (L[i] + R[i]), s = 0.5 * (L[i] - R[i]) * w; L[i] = m + s; R[i] = m - s; }
  }
  return { dry, wet };
}

// ---------- reverb ----------

/** A synthetic stereo impulse response: pre-delay, a few early reflections, an exponential tail that darkens. */
export function makeIR(rate, { decay = 1.6, predelay = 0.02, damp = 6000, early = 0.3, seed = 7 } = {}) {
  const n = Math.round(rate * (predelay + decay * 1.15)), pre = Math.round(rate * predelay);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const out = [new Float32Array(n), new Float32Array(n)];
  for (const ch of out) {
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / rate, env = Math.exp((-6.91 * t) / decay);
      const cutoff = damp * Math.exp(-t * 1.8) + 900; // highs die first
      const a = Math.exp((-2 * Math.PI * cutoff) / rate);
      lp = (1 - a) * rnd() + a * lp;
      ch[i] = lp * env * (t < 0.01 ? t / 0.01 : 1);
    }
    for (let k = 0; k < 6; k++) { const at = pre + Math.round(rate * (0.004 + 0.011 * k + Math.abs(rnd()) * 0.006)); if (at < n) ch[at] += early * (1 - k / 7) * (rnd() > 0 ? 1 : -1); }
  }
  let p = 0;
  for (const ch of out) for (let i = 0; i < n; i++) p += ch[i] * ch[i];
  const g = 1 / Math.sqrt(p / 2 || 1);
  for (const ch of out) for (let i = 0; i < n; i++) ch[i] *= g;
  return out;
}

/**
 * The bus stage. buses: { drums, inst, vox, voxVerb, beatVerb } (each [L, R] or null) at `length`.
 * plan: { drums: comp, vox: comp, mix: comp, gains: { drums, inst, vox, voxVerb, beatVerb } (dB),
 *         duck: { eq: dB[] curve, gain: dB[] curve }, voxIR, beatIR, voxReturn, beatReturn, verbDuck: dB[] }
 * Returns { mix, instrumental, acapella }: planar stereo arrays at `length`.
 */
export async function renderBuses(buses, plan, rate, length) {
  const lat = await stripLatency(rate);
  const ctx = new OfflineAudioContext(6, length + lat, rate);
  ctx.destination.channelInterpretation = 'discrete';
  const dur = length / rate;
  const sumA = ctx.createGain(), sumB = ctx.createGain(), sumC = ctx.createGain();
  const merger = ctx.createChannelMerger(6);
  [sumA, sumB, sumC].forEach((sum, k) => {
    const comp = compressor(ctx, plan.mix), split = ctx.createChannelSplitter(2);
    sum.connect(comp).connect(split); split.connect(merger, 0, k * 2); split.connect(merger, 1, k * 2 + 1);
  });
  merger.connect(ctx.destination);
  const source = (chs, gainDb) => {
    if (!chs) return null;
    const s = ctx.createBufferSource(); s.buffer = bufferFrom(ctx, chs, rate);
    const g = ctx.createGain(); g.gain.value = dbToGain(gainDb || 0); s.connect(g); s.start();
    return g;
  };
  const G = plan.gains || {};
  const drums = source(buses.drums, G.drums);
  if (drums) {
    const c = drums.connect(compressor(ctx, plan.drums)); c.connect(sumA); c.connect(sumB);
    // parallel compression: a squashed copy under the drums, for weight without losing the hits
    if (Number.isFinite(plan.parComp)) { const pc = ctx.createGain(); pc.gain.value = dbToGain(plan.parComp); const sq = drums.connect(compressor(ctx, { threshold: -32, ratio: 8, attack: 0.001, release: 0.1, knee: 4 })).connect(filter(ctx, { type: 'highpass', f: 60, q: 0.7 })).connect(pc); sq.connect(sumA); sq.connect(sumB); }
  }
  const inst = source(buses.inst, G.inst);
  if (inst) {
    const eq = filter(ctx, { type: 'peaking', f: plan.duck?.f || 2500, q: 0.9, gain: 0 });
    const dg = ctx.createGain();
    inst.connect(eq).connect(dg).connect(compressor(ctx)).connect(sumA);
    curveAt(eq.gain, plan.duck?.eq, dur, false);
    curveAt(dg.gain, plan.duck?.gain, dur, true);
    inst.connect(compressor(ctx)).connect(sumB); // the instrumental keeps everything the vocal was covering
  }
  const vox = source(buses.vox, G.vox);
  if (vox) {
    // The lead bus in three bands (Linkwitz-Riley crossovers, which sum flat): the lows and the highs get their own
    // compressors, so mud and harshness ride themselves down only when they build up (the multiband-on-vocals
    // move), while the mids get the glue. Every band passes one compressor, so the bands stay aligned.
    const lr = (type, f) => { const a = filter(ctx, { type, f, q: Math.SQRT1_2 }), b = filter(ctx, { type, f, q: Math.SQRT1_2 }); a.connect(b); return { in: a, out: b }; };
    const mb = plan.mb || { low: 220, high: 4500 };
    const join = ctx.createGain();
    const lowMid = lr('lowpass', mb.high), high = lr('highpass', mb.high);
    vox.connect(lowMid.in); vox.connect(high.in);
    const low = lr('lowpass', mb.low), mid = lr('highpass', mb.low);
    lowMid.out.connect(low.in); lowMid.out.connect(mid.in);
    low.out.connect(compressor(ctx, plan.voxLow || plan.vox)).connect(join);
    mid.out.connect(compressor(ctx, plan.vox)).connect(join);
    high.out.connect(compressor(ctx, plan.voxHigh || plan.vox)).connect(join);
    // then a touch of bus EQ (the templates' Vocal EQ on the lead bus)
    const c = join.connect(filter(ctx, { type: 'peaking', f: 250, q: 1.2, gain: -1 })).connect(filter(ctx, { type: 'highshelf', f: 10000, gain: 0.8 }));
    c.connect(sumA); c.connect(sumC);
    // Air: an exciter (the Aphex / Pultec "sheen" step): the top of the voice, saturated so it grows harmonics
    // above 7 kHz, blended low under the lead. Only what's above the cutoff gets in, and only new highs come out.
    if (Number.isFinite(plan.air)) {
      const sh = ctx.createWaveShaper(); sh.curve = saturationCurve(2.5); sh.oversample = '2x';
      const ag = ctx.createGain(); ag.gain.value = dbToGain(plan.air);
      const a = c.connect(filter(ctx, { type: 'highpass', f: 3500, q: Math.SQRT1_2 })).connect(filter(ctx, { type: 'highpass', f: 3500, q: Math.SQRT1_2 })).connect(sh).connect(filter(ctx, { type: 'highpass', f: 3500, q: Math.SQRT1_2 })).connect(ag);
      a.connect(sumA); a.connect(sumC);
    }
    // parallel distortion under the lead (the DISTORTION bus of the rap templates): band-limited, blended low;
    // a neutral compressor keeps its path the same length as the lead's
    if (Number.isFinite(plan.dist)) {
      const sh = ctx.createWaveShaper(); sh.curve = saturationCurve(6); sh.oversample = '2x';
      const dg = ctx.createGain(); dg.gain.value = dbToGain(plan.dist);
      const d = vox.connect(compressor(ctx)).connect(filter(ctx, { type: 'highpass', f: 300, q: 0.7 })).connect(sh).connect(filter(ctx, { type: 'lowpass', f: 5000, q: 0.7 })).connect(dg);
      d.connect(sumA); d.connect(sumC);
    }
    // a short slap under the lead (100-150 ms, the rock and hip-hop templates' SLAP return)
    if (Number.isFinite(plan.slap)) {
      const dl = ctx.createDelay(1); dl.delayTime.value = 0.11; const sg = ctx.createGain(); sg.gain.value = dbToGain(plan.slap);
      const sl = c.connect(dl).connect(filter(ctx, { type: 'highpass', f: 400, q: 0.7 })).connect(filter(ctx, { type: 'lowpass', f: 5000, q: 0.7 })).connect(sg);
      sl.connect(sumA); sl.connect(sumC);
    }
  }
  const hook = source(buses.hook, G.hook);
  if (hook) {
    // the hook / BGV bus: glue, warmth, and the same gentle EQ, so the stack reads as one voice
    const sh = ctx.createWaveShaper(); sh.curve = saturationCurve(1.6); sh.oversample = '2x';
    const dry = ctx.createGain(), wet = ctx.createGain(), join = ctx.createGain(); dry.gain.value = 0.82; wet.gain.value = 0.18;
    const g = hook.connect(compressor(ctx, plan.hook || { threshold: -22, ratio: 3, attack: 0.01, release: 0.15, knee: 6 }));
    g.connect(dry).connect(join); g.connect(sh).connect(wet).connect(join);
    const c = join.connect(filter(ctx, { type: 'peaking', f: 300, q: 1.2, gain: -1.5 })).connect(filter(ctx, { type: 'highshelf', f: 10000, gain: 0.6 }));
    c.connect(sumA); c.connect(sumC);
  }
  const ret = (chs, gainDb, ir, eq, duckCurve, targets) => {
    const s = source(chs, gainDb);
    if (!s || !ir) return;
    const conv = ctx.createConvolver(); conv.normalize = false; conv.buffer = bufferFrom(ctx, ir, rate);
    let n = s.connect(conv);
    n = n.connect(filter(ctx, { type: 'highpass', f: eq?.hp || 250, q: 0.707 })).connect(filter(ctx, { type: 'lowpass', f: eq?.lp || 9000, q: 0.707 }));
    const dg = ctx.createGain(); n = n.connect(dg); curveAt(dg.gain, duckCurve, dur, true);
    const c = n.connect(compressor(ctx));
    for (const t of targets) c.connect(t);
  };
  ret(buses.voxVerb, G.voxVerb, plan.voxIR, plan.voxReturn, plan.verbDuck, [sumA, sumC]);
  ret(buses.hookVerb, G.hookVerb, plan.hookIR || plan.voxIR, plan.hookReturn || plan.voxReturn, plan.verbDuck, [sumA, sumC]);
  ret(buses.beatVerb, G.beatVerb, plan.beatIR, plan.beatReturn, null, [sumA, sumB]);
  const out = await ctx.startRendering();
  const pair = (k) => [out.getChannelData(k * 2).slice(lat, lat + length), out.getChannelData(k * 2 + 1).slice(lat, lat + length)];
  return { mix: pair(0), instrumental: pair(1), acapella: pair(2) };
}
