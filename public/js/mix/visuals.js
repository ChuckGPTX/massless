// What the client watches while the mix runs: a breathing console in the hero, track lanes laying in one by one,
// and a panel that shows the move being made right now: EQ curves drawn from the real filter settings,
// a compressor's transfer curve and gain-reduction meter, the 808 pumping under the kick, a de-esser biting,
// the stereo field filling, a reverb tail, the loudness meter climbing to target.

import { biquad } from '../master.js';

const TAU = Math.PI * 2;
const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const AMBER = '#ffbf2f', VIOLET = '#a98bff', CYAN = '#46d6ff', DIM = 'rgba(255,255,255,.12)';

/** Magnitude response (dB) of a list of filters at frequency f. */
export function responseDb(filters, f, rate = 44100) {
  const w = (2 * Math.PI * f) / rate, cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  let db = 0;
  for (const spec of filters) {
    const q = biquad(spec.type, spec.f, rate, { q: spec.q ?? Math.SQRT1_2, gain: spec.gain || 0 });
    const nr = q.b0 + q.b1 * cw + q.b2 * c2, ni = -(q.b1 * sw + q.b2 * s2), dr = 1 + q.a1 * cw + q.a2 * c2, di = -(q.a1 * sw + q.a2 * s2);
    db += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di) || 1e-12);
  }
  return db;
}
export function stripFilters(p) {
  const out = [];
  if (p?.hpf) out.push({ type: 'highpass', f: p.hpf, q: 0.54 }, { type: 'highpass', f: p.hpf, q: 1.31 });
  if (p?.lpf) out.push({ type: 'lowpass', f: p.lpf, q: 0.707 });
  for (const e of p?.eq || []) out.push(e);
  return out;
}
const fx = (f, w) => (Math.log10(f / 20) / Math.log10(1000)) * w; // 20 Hz - 20 kHz across w

function grid(g, w, h) {
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1;
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = fx(f, w); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,.35)'; g.font = `${Math.round(h * 0.045)}px "Instrument Sans", sans-serif`;
  for (const [f, l] of [[100, '100'], [1000, '1k'], [10000, '10k']]) g.fillText(l, fx(f, w) + 4, h - 8);
}

/** A small EQ curve (for mixer strips and lanes). */
export function drawEqThumb(canvas, plan, color = AMBER) {
  const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height, filters = stripFilters(plan);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.beginPath();
  for (let x = 0; x <= w; x += 2) { const f = 20 * 1000 ** (x / w), d = Math.max(-18, Math.min(12, responseDb(filters, f))); const y = h / 2 - (d / 18) * (h / 2 - 2); x ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.strokeStyle = color; g.lineWidth = 1.5; g.stroke();
}

/** A lane's waveform from 600 peak bins. */
export function drawPeaks(canvas, peaks, color, progress = 1) {
  const g = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
  g.clearRect(0, 0, w, h);
  const n = peaks.length, top = Math.max(1e-6, ...peaks);
  for (let x = 0; x < w; x++) {
    const v = peaks[Math.floor((x / w) * n)] / top, bar = Math.max(1, v * (h - 4));
    g.fillStyle = x / w <= progress ? color : 'rgba(255,255,255,.18)';
    g.fillRect(x, (h - bar) / 2, 1, bar);
  }
}

// ---------- the trick panel ----------

export class TrickPanel {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.kind = 'listen'; this.data = {}; this.t0 = performance.now(); this.pans = [];
    this.loop = this.loop.bind(this); this.raf = requestAnimationFrame(this.loop);
  }
  show(kind, data = {}, extra = {}) { this.kind = kind; this.data = data; this.extra = extra; this.t0 = performance.now(); }
  addPan(p, color) { this.pans.push({ p, color, born: performance.now() }); }
  stop() { cancelAnimationFrame(this.raf); }
  loop(now) {
    const t = still ? 1.2 : (now - this.t0) / 1000;
    const g = this.g, w = this.c.width, h = this.c.height;
    g.clearRect(0, 0, w, h);
    const fn = this[`draw_${this.kind}`] || this.draw_listen;
    fn.call(this, g, w, h, t, now / 1000);
    if (!still) this.raf = requestAnimationFrame(this.loop);
  }
  draw_listen(g, w, h, t, abs) {
    // a scrolling spectrum analyser
    const n = 48, bw = w / n;
    for (let i = 0; i < n; i++) {
      const f = i / n, v = 0.25 + 0.6 * Math.abs(Math.sin(abs * (1.3 + f * 3) + i * 0.7)) * (1 - f * 0.5) * (0.6 + 0.4 * Math.sin(abs * 6 + i));
      const bh = v * h * 0.8, grad = g.createLinearGradient(0, h, 0, h - bh);
      grad.addColorStop(0, VIOLET); grad.addColorStop(1, AMBER);
      g.fillStyle = grad; g.fillRect(i * bw + 2, h - bh, bw - 4, bh);
    }
  }
  draw_eq(g, w, h, t) {
    grid(g, w, h);
    const p = this.data, filters = stripFilters(p), k = Math.min(1, t / 1.4), spec = this.extra?.spectrum;
    if (spec) { // the track's own spectrum behind the curve
      g.fillStyle = 'rgba(169,139,255,.18)';
      const THIRDS = [31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000];
      const top = Math.max(...spec), wiggle = (i) => (still ? 0 : Math.sin(t * 7 + i) * 1.5);
      THIRDS.forEach((f, i) => { const v = Math.max(0, (spec[i] - top + 48 + wiggle(i)) / 48), x = fx(f, w); g.fillRect(x - w / 70, h * 0.92 - v * h * 0.7, w / 36, v * h * 0.7); });
    }
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.setLineDash([4, 6]); g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); g.setLineDash([]);
    g.beginPath();
    for (let x = 0; x <= w; x += 2) { const f = 20 * 1000 ** (x / w), d = Math.max(-20, Math.min(14, responseDb(filters, f) * k)); const y = h / 2 - (d / 20) * (h * 0.42); x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = AMBER; g.lineWidth = 3; g.shadowColor = AMBER; g.shadowBlur = 12; g.stroke(); g.shadowBlur = 0;
    for (const e of p.eq || []) { if (Math.abs(e.gain || 0) < 0.4) continue; const x = fx(e.f, w), y = h / 2 - ((e.gain * k) / 20) * (h * 0.42); g.fillStyle = e.gain < 0 ? CYAN : AMBER; g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill(); }
  }
  draw_comp(g, w, h, t, abs) {
    const c = this.data.comp || { threshold: -20, ratio: 4 }, pad = 30, size = Math.min(w * 0.55, h - pad * 2), ox = pad, oy = h - pad;
    const toX = (db) => ox + ((db + 48) / 48) * size, toY = (db) => oy - ((db + 48) / 48) * size;
    g.strokeStyle = 'rgba(255,255,255,.08)'; g.strokeRect(ox, oy - size, size, size);
    const out = (i) => (i < c.threshold ? i : c.threshold + (i - c.threshold) / c.ratio);
    g.beginPath(); for (let i = -48; i <= 0; i += 0.5) { const x = toX(i), y = toY(out(i)); i === -48 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.strokeStyle = AMBER; g.lineWidth = 3; g.stroke();
    g.setLineDash([3, 5]); g.strokeStyle = 'rgba(255,255,255,.3)'; g.beginPath(); g.moveTo(toX(c.threshold), oy); g.lineTo(toX(c.threshold), oy - size); g.stroke(); g.setLineDash([]);
    const level = -18 + 12 * Math.abs(Math.sin(abs * 2.3)) * Math.abs(Math.sin(abs * 0.9 + 1));
    g.fillStyle = CYAN; g.beginPath(); g.arc(toX(level), toY(out(level)), 8, 0, TAU); g.fill();
    // gain reduction meter
    const gr = Math.max(0, level - out(level)), mx = ox + size + 40, mw = 26, mh = size;
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(mx, oy - mh, mw, mh);
    g.fillStyle = AMBER; g.fillRect(mx, oy - mh, mw, Math.min(mh, (gr / 12) * mh));
    g.fillStyle = '#fff'; g.font = `700 ${Math.round(h * 0.07)}px "Instrument Sans", sans-serif`;
    g.fillText(`−${gr.toFixed(1)} dB`, mx + mw + 10, oy - mh + 20);
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `${Math.round(h * 0.05)}px "Instrument Sans", sans-serif`;
    g.fillText(`${c.ratio}:1`, mx + mw + 10, oy - mh + 46); g.fillText('gain reduction', mx + mw + 10, oy - mh + 70);
  }
  draw_sidechain(g, w, h, t, abs) {
    const beat = 0.43, mid = h * 0.3, low = h * 0.72;
    g.fillStyle = 'rgba(255,255,255,.5)'; g.font = `600 ${Math.round(h * 0.05)}px "Instrument Sans", sans-serif`;
    g.fillText('KICK', 10, mid - h * 0.16); g.fillText('808 / BASS', 10, low - h * 0.2);
    for (let x = 0; x < w; x += 2) {
      const time = abs - (w - x) / w * 2.6, ph = ((time % beat) + beat) % beat, kick = Math.exp(-ph * 30);
      g.fillStyle = `rgba(255,91,91,${0.25 + 0.75 * kick})`; const kh = kick * h * 0.2; g.fillRect(x, mid - kh / 2, 2, kh);
      const duck = 1 - 0.55 * Math.exp(-ph * 9), wave = Math.sin(time * 2 * Math.PI * 7) * duck * h * 0.13;
      g.fillStyle = `rgba(184,107,255,${0.5 + 0.5 * duck})`; g.fillRect(x, low - Math.abs(wave), 2, Math.abs(wave) * 2);
    }
  }
  draw_deess(g, w, h, t, abs) {
    grid(g, w, h);
    const f0 = this.data.deess?.f || 6800, sib = Math.max(0, Math.sin(abs * 3.1)) ** 6, cut = sib * 7;
    g.fillStyle = 'rgba(70,214,255,.12)'; g.fillRect(fx(4500, w), 0, fx(10000, w) - fx(4500, w), h);
    g.beginPath();
    for (let x = 0; x <= w; x += 2) { const f = 20 * 1000 ** (x / w), d = responseDb([{ type: 'peaking', f: f0, q: 1.4, gain: -cut }], f); const y = h / 2 - (d / 20) * h * 0.42; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.strokeStyle = CYAN; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#fff'; g.font = `800 ${Math.round(h * 0.16)}px "Big Shoulders Display", sans-serif`;
    g.globalAlpha = 0.25 + sib * 0.75; g.fillText('sss', fx(f0, w) - h * 0.12, h * 0.3); g.globalAlpha = 1;
  }
  draw_pan(g, w, h, t) {
    const cx = w / 2, cy = h * 0.9, r = Math.min(w * 0.45, h * 0.8);
    g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1;
    for (const k of [0.33, 0.66, 1]) { g.beginPath(); g.arc(cx, cy, r * k, Math.PI, TAU); g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.5)'; g.font = `600 ${Math.round(h * 0.05)}px "Instrument Sans", sans-serif`;
    g.fillText('L', cx - r - 4, cy - 6); g.fillText('R', cx + r - 8, cy - 6);
    const all = [...this.pans, { p: this.data.pan || 0, color: AMBER, born: this.t0 }];
    all.forEach((d, i) => {
      const age = Math.min(1, (performance.now() - d.born) / 700), a = Math.PI * (1.5 + (d.p || 0) * 0.45), rr = r * (0.45 + (i % 4) * 0.13);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      g.fillStyle = d.color; g.globalAlpha = 0.35 + 0.65 * age; g.beginPath(); g.arc(x, y, 7 + 5 * (1 - age), 0, TAU); g.fill(); g.globalAlpha = 1;
    });
  }
  draw_verb(g, w, h, t, abs) {
    const decay = this.data.decay || 1.6, period = decay + 0.6, ph = (abs % period);
    for (let i = 0; i < 90; i++) {
      const at = 0.03 + (i / 90) * decay, x = (at / (decay + 0.2)) * w, amp = Math.exp((-6.9 * at) / decay) * (0.4 + 0.6 * Math.abs(Math.sin(i * 12.9898)));
      const on = ph > at ? 1 : 0.15;
      g.fillStyle = `rgba(169,139,255,${0.15 + 0.7 * on * amp})`; const bh = amp * h * 0.8; g.fillRect(x, h - bh - 10, Math.max(2, w / 120), bh);
    }
    g.fillStyle = '#fff'; g.font = `700 ${Math.round(h * 0.07)}px "Instrument Sans", sans-serif`; g.fillText(`${decay.toFixed(1)} s plate`, 12, 28);
  }
  draw_align(g, w, h, t, abs) {
    // the rough on top, a stem below sliding into place until their hits line up
    const k = Math.min(1, t / 1.6), off = (1 - (1 - k) ** 3) , slide = (1 - off) * w * 0.18, lanes = [h * 0.32, h * 0.7];
    const hit = (x) => { const ph = ((x / w) * 8) % 1; return Math.exp(-ph * 9); };
    for (let x = 0; x < w; x += 3) {
      const a = 0.25 + 0.75 * hit(x), b = 0.25 + 0.75 * hit(x - slide);
      g.fillStyle = 'rgba(232,228,242,.85)'; g.fillRect(x, lanes[0] - a * h * 0.13, 2, a * h * 0.26);
      g.fillStyle = CYAN; g.fillRect(x, lanes[1] - b * h * 0.13, 2, b * h * 0.26);
    }
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `600 ${Math.round(h * 0.05)}px "Instrument Sans", sans-serif`;
    g.fillText('YOUR ROUGH MIX', 10, lanes[0] - h * 0.16); g.fillText('STEM', 10, lanes[1] - h * 0.16);
    if (k >= 1) { g.strokeStyle = '#55e3a1'; g.lineWidth = 2; for (let i = 0; i < 8; i++) { const x = (i / 8) * w; g.beginPath(); g.moveTo(x, lanes[0]); g.lineTo(x, lanes[1]); g.stroke(); } g.fillStyle = '#55e3a1'; g.fillText('LOCKED TO THE SAMPLE', w - h * 0.62, h * 0.95); }
  }
  draw_loud(g, w, h, t) {
    const target = this.data.lufs || -9, k = Math.min(1, t / 3), now = -30 + (target + 30) * (1 - (1 - k) ** 3) + (still ? 0 : Math.sin(t * 9) * 0.4 * k);
    const mx = w * 0.12, mw = w * 0.14, top = 20, bot = h - 20, toY = (v) => bot - ((v + 30) / 30) * (bot - top);
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(mx, top, mw, bot - top);
    const grad = g.createLinearGradient(0, bot, 0, top); grad.addColorStop(0, CYAN); grad.addColorStop(0.7, AMBER); grad.addColorStop(1, '#ff4f6d');
    g.fillStyle = grad; g.fillRect(mx, toY(now), mw, bot - toY(now));
    g.strokeStyle = '#fff'; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(mx - 8, toY(target)); g.lineTo(mx + mw + 8, toY(target)); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#fff'; g.font = `900 ${Math.round(h * 0.26)}px "Big Shoulders Display", sans-serif`;
    g.fillText(`${now.toFixed(1)}`, w * 0.38, h * 0.55);
    g.font = `600 ${Math.round(h * 0.06)}px "Instrument Sans", sans-serif`; g.fillStyle = 'rgba(255,255,255,.6)';
    g.fillText(`LUFS · target ${target}`, w * 0.38, h * 0.55 + h * 0.1); g.fillText('true peak ≤ −1 dB', w * 0.38, h * 0.55 + h * 0.19);
  }
}

// ---------- the hero console ----------

export function heroConsole(canvas) {
  const g = canvas.getContext('2d');
  let raf;
  const tracks = [['KICK', '#ff5b5b'], ['SNARE', '#ff8a4c'], ['HATS', '#ffc94c'], ['808', '#b86bff'], ['KEYS', '#55e3a1'], ['PAD', '#4cc7a0'], ['LEAD', '#46d6ff'], ['ADLIB', '#7aa5ff']];
  const draw = (now) => {
    const t = still ? 2 : now / 1000, w = canvas.width, h = canvas.height;
    g.clearRect(0, 0, w, h);
    const n = tracks.length, pad = 22, sw = (w - pad * 2) / n;
    tracks.forEach(([name, color], i) => {
      const x = pad + i * sw, cx = x + sw / 2;
      g.fillStyle = 'rgba(255,255,255,.03)'; g.fillRect(x + 4, pad, sw - 8, h - pad * 2);
      // EQ curve per strip
      g.beginPath();
      for (let k = 0; k <= 20; k++) { const yy = pad + 34 + Math.sin(k * 0.6 + i + t * 0.8) * 6 * Math.sin(t * 0.5 + i); const xx = x + 8 + (k / 20) * (sw - 16); k ? g.lineTo(xx, yy) : g.moveTo(xx, yy); }
      g.strokeStyle = color; g.lineWidth = 2; g.stroke();
      // knob
      const ky = pad + 78, a = Math.sin(t * 0.7 + i * 1.3) * 2.2;
      g.strokeStyle = 'rgba(255,255,255,.2)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, ky, 12, 0, TAU); g.stroke();
      g.strokeStyle = AMBER; g.beginPath(); g.moveTo(cx, ky); g.lineTo(cx + Math.sin(a) * 10, ky - Math.cos(a) * 10); g.stroke();
      // meter + fader
      const mTop = pad + 110, mBot = h - pad - 34, level = 0.35 + 0.55 * Math.abs(Math.sin(t * (2.1 + i * 0.37) + i)) * (0.7 + 0.3 * Math.sin(t * 7.1 + i * 2));
      const segs = 22;
      for (let s = 0; s < segs; s++) {
        const on = s / segs < level, y = mBot - (s + 1) * ((mBot - mTop) / segs);
        g.fillStyle = on ? (s > segs * 0.85 ? '#ff4f6d' : s > segs * 0.65 ? AMBER : color) : 'rgba(255,255,255,.06)';
        g.fillRect(cx - 16, y + 1, 8, (mBot - mTop) / segs - 2);
      }
      const fy = mTop + (mBot - mTop) * (0.3 + 0.25 * Math.sin(t * 0.4 + i));
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(cx + 6, mTop, 3, mBot - mTop);
      g.fillStyle = '#d8d4e6'; g.fillRect(cx - 2, fy - 7, 20, 14);
      g.fillStyle = '#fff'; g.font = '600 12px "Instrument Sans", sans-serif'; g.textAlign = 'center';
      g.fillText(name, cx, h - pad - 12);
    });
    g.textAlign = 'left';
    if (!still) raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
}
