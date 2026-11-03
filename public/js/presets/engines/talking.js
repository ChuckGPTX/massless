// Talking product ad: a digital presenter (a made-up person, labelled as such) reads the script with a voiceover,
// cut like a social ad: medium and close shots, a product cutaway, bold word-by-word captions and an end card.
// The presenter is a flat illustration drawn in code (presenter.js). Its mouth follows the words: the script is
// lined up with the voice (lipsync.js), each word becomes mouth shapes, and the voice's loudness sets the jaw.
import { clamp, ease, span, setFont, fitText, FONT, meanColor, rgbCss, luma, mix } from '../common.js';
import { apiFetch } from '../../human.js';
import { align, fallbackTimings, track, mouthAt, envelope } from '../lipsync.js';
import { CAST, frame, backdrop as drawBackdrop, drawPresenter } from '../presenter.js';

export const kind = 'video';
export const heavy = [];
// flat colours compress well: about 3 Mbps keeps a 15 s 1080x1920 ad well under Explore's 8 MB
export const bitrate = 3e6;
const FPS = 30, END = 1.6;

export async function prepare(spec, io, params) {
  const cut = await io.cutout('product');
  return { cut: cut.cut, tone: meanColor(cut.cut), env: null, voice: null, voiceLen: 0, script: '', words: [] };
}

function words(script) { return String(script || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 80); }
function speechLength(ctx, params) {
  if (ctx.voice && ctx.script === params.script) return ctx.voiceLen;
  return Math.max(2.5, words(params.script).length / 2.7);
}
export function duration(ctx, params) { return Math.min(20, speechLength(ctx, params) + END + 0.3); }

const voiced = (ctx, params) => !!(ctx.env && ctx.script === params.script);
/** Word timings: lined up with the voice when there is one, otherwise spread by length with rests at punctuation. */
function timings(ctx, params) {
  const v = voiced(ctx, params), k = `${v ? 'v' : 'n'}|${params.script}`;
  if (ctx._tk !== k) {
    const ws = words(params.script);
    ctx._tw = v ? align(ws, ctx.env, FPS) : fallbackTimings(ws, speechLength(ctx, params));
    ctx._keys = track(ctx._tw);
    ctx._tk = k;
  }
  return ctx._tw;
}
/** Loudness at t (0..1), smoothed over a few frames. */
function loudness(ctx, t) {
  const e = ctx.env, f = t * FPS, i = Math.floor(f), at = (j) => e[Math.max(0, Math.min(e.length - 1, j))] || 0;
  const v = at(i) + (at(i + 1) - at(i)) * (f - i);
  return (at(i - 2) + 2 * at(i - 1) + 3 * v + 2 * at(i + 2) + at(i + 3)) / 9;
}
/** The mouth at t: the blended shape of the words, its jaw opening scaled by the voice's loudness. */
function mouth(ctx, params, t) {
  timings(ctx, params);
  const m = mouthAt(ctx._keys, t);
  m.open *= voiced(ctx, params) ? clamp(0.2 + 1.1 * loudness(ctx, t), 0.2, 1.15) : 0.9;
  return m;
}
/** Eyelids: a quick blink every few seconds (0 open .. 1 shut), the same on every run. */
function blink(t) {
  let at = 0.9;
  for (let i = 1; at < t + 1; i++) {
    const d = t - at;
    if (d >= 0 && d < 0.2) return d < 0.07 ? d / 0.07 : 1 - (d - 0.07) / 0.13;
    at += 2.3 + 2.4 * ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
  }
  return 0;
}

/** Brows lift a little at the start of each sentence and on long words (0..1). */
function brow(ctx, params, t) {
  const tw = timings(ctx, params);
  let b = 0;
  tw.forEach((x, i) => {
    const lead = i === 0 || /[.!?]$/.test(tw[i - 1].w), long = x.w.replace(/[^a-z]/gi, '').length >= 6;
    if (!lead && !long) return;
    const z = (t - x.t0 - 0.08) / 0.32;
    b = Math.max(b, (lead ? 1 : 0.7) * Math.exp(-z * z));
  });
  return b;
}

export async function audio(ctx, params) {
  ctx.voiceNote = '';
  const text = String(params.script || '').trim();
  if (!text) return null;
  try {
    const r = await apiFetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, lang: 'en' }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The voice could not be made.');
    const buf = await r.arrayBuffer();
    const ac = new OfflineAudioContext(1, 48000, 48000);
    const dec = await ac.decodeAudioData(buf);
    const n = Math.ceil(dec.duration * 48000);
    const off = new OfflineAudioContext(1, n, 48000);
    const src = off.createBufferSource(); src.buffer = dec; src.connect(off.destination); src.start();
    const mono = (await off.startRendering()).getChannelData(0);
    // loudness per frame: the words are lined up with it, and it sets how far the jaw opens
    ctx.env = envelope(mono, 48000, FPS); ctx.voiceLen = dec.duration; ctx.script = params.script;
    ctx.voice = { channels: [mono], sampleRate: 48000 };
    return ctx.voice;
  } catch (e) {
    ctx.voiceNote = `The voice couldn’t be made just now (${e.message}), so this ad has captions only. Try again later.`;
    ctx.env = null; ctx.voice = null;
    return null;
  }
}

export function render(ctx, c, { w, h, t, duration: D0, params }) {
  const g = c.getContext('2d');
  const D = D0 || duration(ctx, params);
  const T = t == null ? Math.min(2.2, D * 0.3) : t % D;
  const u = Math.min(w, h);
  const brandRGB = ctx.tone;
  const L = speechLength(ctx, params);
  const tw = timings(ctx, params);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none';
  // shot list: presenter medium/close, one product cutaway around the middle, then the end card
  const cut0 = L * 0.42, cut1 = Math.min(L - 0.4, cut0 + 1.8);
  const end = T >= L + 0.3;
  if (end) endCard(ctx, g, w, h, T - L - 0.3, params, brandRGB);
  else if (T >= cut0 && T < cut1) productShot(ctx, g, w, h, (T - cut0) / (cut1 - cut0), params, brandRGB);
  else presenter(ctx, g, w, h, T, Math.floor(T / 2.4) % 2 === 1, mouth(ctx, params, T), params);
  if (!end) captions(g, w, h, T, tw, u);
  // disclosure, always on
  g.save();
  setFont(g, FONT.grotesk, u * 0.026, { tracking: 0.04 });
  const label = 'DIGITAL PRESENTER';
  const lw = g.measureText(label).width + u * 0.04, lh = u * 0.05;
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.roundRect(u * 0.04, u * 0.05, lw, lh, lh / 2); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(label, u * 0.06, u * 0.05 + lh / 2);
  g.restore();
}

function presenter(ctx, g, w, h, T, close, mo, params) {
  const look = CAST[params.presenter] || CAST.ava;
  drawBackdrop(g, w, h, look, params.backdrop === 'brand' ? ctx.tone : null);
  // nod with the voice, a slow sway and a gentle bob
  const nod = voiced(ctx, params) ? loudness(ctx, T - 0.1) * 7 : 0;
  const bob = Math.sin(T * 1.7) * 5, tilt = Math.sin(T * 1.1) * 0.02 + Math.sin(T * 0.43) * 0.012;
  const f = frame(w, h, close ? { zoom: 1.2, fy: 0.42 } : { zoom: 1, fy: 0.45 });
  g.save();
  g.translate(f.ox, f.oy + bob * f.k); g.scale(f.k, f.k);
  drawPresenter(g, look, { mouth: mo, blink: blink(T), brow: brow(ctx, params, T), tilt, nod: -nod });
  g.restore();
  // the product rides along in a card
  const pIn = ease.back(span(T, 0.9, 1.4));
  if (pIn > 0) {
    const cw = w * 0.3, ch = cw * 1.15, x = w - cw - w * 0.05, y = h * 0.53 + Math.sin(T * 2) * h * 0.004;
    g.save();
    g.translate(x + cw / 2, y + ch / 2); g.scale(pIn, pIn); g.rotate(0.04); g.translate(-(x + cw / 2), -(y + ch / 2));
    g.shadowColor = 'rgba(0,0,0,0.3)'; g.shadowBlur = cw * 0.1; g.shadowOffsetY = cw * 0.04;
    g.fillStyle = '#fff'; g.beginPath(); g.roundRect(x, y, cw, ch, cw * 0.1); g.fill();
    g.shadowColor = 'transparent';
    fitInto(g, ctx.cut, x + cw * 0.1, y + ch * 0.08, cw * 0.8, ch * 0.66);
    g.fillStyle = '#141414'; g.textAlign = 'center'; g.textBaseline = 'top';
    const fit = fitText(g, String(params.brand || ''), FONT.grotesk, cw * 0.84, ch * 0.14, { max: cw * 0.12, lines: 1 });
    g.fillText(fit.lines[0] || '', x + cw / 2, y + ch * 0.8);
    g.restore();
  }
}
function fitInto(g, img, x, y, w, h) {
  const k = Math.min(w / img.width, h / img.height);
  g.drawImage(img, x + (w - img.width * k) / 2, y + (h - img.height * k) / 2, img.width * k, img.height * k);
}
function backdrop(g, w, h, rgb) {
  const light = mix(rgb, [255, 255, 255], 0.72), deep = mix(rgb, [255, 255, 255], 0.35);
  const gr = g.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.7);
  gr.addColorStop(0, rgbCss(light)); gr.addColorStop(1, rgbCss(deep));
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}
function productShot(ctx, g, w, h, k, params, rgb) {
  backdrop(g, w, h, rgb);
  const z = 0.9 + 0.12 * ease.out(k);
  const pw = w * 0.62 * z, ph = h * 0.46 * z;
  const sg = g.createRadialGradient(w / 2, h * 0.66, 0, w / 2, h * 0.66, pw * 0.5);
  sg.addColorStop(0, 'rgba(0,0,0,0.28)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.setTransform(1, 0, 0, 0.14, 0, h * 0.66 * 0.86); g.fillStyle = sg; g.fillRect(0, h * 0.66 - pw, w, pw * 2); g.restore();
  fitInto(g, ctx.cut, (w - pw) / 2, h * 0.66 - ph, pw, ph);
  const ink = luma(mix(rgb, [255, 255, 255], 0.5)) > 0.55 ? '#141414' : '#fff';
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'top';
  const fit = fitText(g, String(params.brand || '').toUpperCase(), FONT.bold, w * 0.84, h * 0.1, { max: w * 0.11, lines: 1 });
  g.globalAlpha = ease.out(k * 3);
  g.fillText(fit.lines[0] || '', w / 2, h * 0.1);
  g.globalAlpha = 1;
}
function endCard(ctx, g, w, h, k, params, rgb) {
  backdrop(g, w, h, rgb);
  const a = ease.out(clamp(k / 0.5));
  fitInto(g, ctx.cut, w * 0.2, h * 0.24, w * 0.6, h * 0.38);
  g.fillStyle = '#141414'; g.textAlign = 'center'; g.textBaseline = 'top';
  g.globalAlpha = a;
  const fit = fitText(g, String(params.brand || '').toUpperCase(), FONT.bold, w * 0.84, h * 0.1, { max: w * 0.12, lines: 1 });
  g.fillText(fit.lines[0] || '', w / 2, h * 0.08);
  const cta = String(params.cta || '').trim();
  if (cta) {
    setFont(g, FONT.grotesk, w * 0.055);
    const bw = g.measureText(cta).width + w * 0.12, bh = w * 0.13, x = (w - bw) / 2, y = h * 0.7 + (1 - a) * h * 0.04;
    g.fillStyle = '#141414'; g.beginPath(); g.roundRect(x, y, bw, bh, bh / 2); g.fill();
    g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(cta, w / 2, y + bh / 2);
  }
  g.globalAlpha = 1;
}
function captions(g, w, h, T, tw, u) {
  if (!tw.length) return;
  // groups of up to three words, broken at punctuation
  const groups = [];
  let cur = [];
  for (const x of tw) { cur.push(x); if (cur.length === 3 || /[.,!?]$/.test(x.w)) { groups.push(cur); cur = []; } }
  if (cur.length) groups.push(cur);
  const gr = groups.find((gp) => T >= gp[0].t0 - 0.05 && T < gp[gp.length - 1].t1 + 0.12);
  if (!gr) return;
  const txt = gr.map((x) => x.w).join(' ').toUpperCase();
  const pop = ease.back(clamp((T - gr[0].t0 + 0.05) / 0.18));
  g.save();
  const fit = fitText(g, txt, FONT.bold, w * 0.86, h * 0.16, { max: u * 0.11, lines: 2, lh: 1.05 });
  g.textAlign = 'left'; g.textBaseline = 'top'; g.lineJoin = 'round';
  const y0 = h * 0.74;
  g.translate(w / 2, y0); g.scale(0.85 + 0.15 * pop, 0.85 + 0.15 * pop); g.translate(-w / 2, -y0);
  let wi = 0;
  fit.lines.forEach((ln, li) => {
    const lw = g.measureText(ln).width;
    let x = (w - lw) / 2;
    const y = y0 + li * fit.size * 1.05;
    for (const word of ln.split(' ')) {
      const item = gr[wi++];
      const on = item && T >= item.t0 && T < item.t1 + 0.05;
      g.lineWidth = fit.size * 0.16; g.strokeStyle = '#000'; g.strokeText(word, x, y);
      g.fillStyle = on ? '#ffd23f' : '#ffffff'; g.fillText(word, x, y);
      x += g.measureText(word + ' ').width;
    }
  });
  g.restore();
}
