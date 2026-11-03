// Talking product ad: a digital presenter (a made-up person, labelled as such) reads the script with a voiceover,
// cut like a social ad: medium and close shots, a product cutaway, bold word-by-word captions and an end card.
// The mouth moves with the voice's loudness; precise lip-sync is not offered yet.
import { loadImage, canvas, cover, clamp, ease, span, setFont, fitText, FONT, meanColor, rgbCss, luma, mix } from '../common.js';
import { PRESENTERS } from '../catalog.js';
import { apiFetch } from '../../human.js';

export const kind = 'video';
export const heavy = ['presenter'];
// lips: centre of the mouth, mouth width (fractions of the presenter photo)
const FACE = { ava: { mouth: [0.508, 0.507], mw: 0.13, eyes: 0.43 }, leo: { mouth: [0.504, 0.522], mw: 0.15, eyes: 0.42 }, mei: { mouth: [0.479, 0.534], mw: 0.15, eyes: 0.44 } };
const FPS = 30, END = 1.6;

export async function prepare(spec, io, params) {
  const pr = PRESENTERS.find((p) => p.id === params.presenter) || PRESENTERS[0];
  const [face, cut] = await Promise.all([loadImage(pr.src), io.cutout('product')]);
  const tone = meanColor(cut.cut);
  return { pr, face, faceMeta: FACE[pr.id], cut: cut.cut, tone, env: null, voice: null, voiceLen: 0, script: '', words: [] };
}

function words(script) { return String(script || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 80); }
function speechLength(ctx, params) {
  if (ctx.voice && ctx.script === params.script) return ctx.voiceLen;
  return Math.max(2.5, words(params.script).length / 2.7);
}
export function duration(ctx, params) { return Math.min(20, speechLength(ctx, params) + END + 0.3); }

/** Word timings spread over the speech by length. */
function timings(ctx, params) {
  const ws = words(params.script), L = speechLength(ctx, params);
  const weight = ws.map((w) => w.replace(/[^\w]/g, '').length + 2 + (/[.,!?]$/.test(w) ? 3 : 0));
  const total = weight.reduce((a, b) => a + b, 0) || 1;
  let t = 0.15;
  return ws.map((w, i) => { const d = (weight[i] / total) * (L - 0.25); const r = { w, t0: t, t1: t + d }; t += d; return r; });
}
/** Mouth opening 0..1 at time t: from the voice when there is one, otherwise from the words. */
function mouth(ctx, params, t, tw) {
  if (ctx.env && ctx.script === params.script) { const i = Math.floor(t * FPS); return clamp((ctx.env[i] || 0) * 1.1); }
  const cur = tw.find((x) => t >= x.t0 && t < x.t1);
  if (!cur) return 0;
  const k = (t - cur.t0) / (cur.t1 - cur.t0);
  const syl = Math.max(1, Math.round(cur.w.length / 3));
  return 0.35 + 0.45 * Math.abs(Math.sin(k * Math.PI * syl));
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
    // loudness per frame drives the mouth
    const per = 48000 / FPS, env = new Float32Array(Math.ceil(mono.length / per));
    let peak = 1e-4;
    for (let i = 0; i < env.length; i++) { let s = 0; for (let j = 0; j < per; j++) { const v = mono[i * per + j] || 0; s += v * v; } env[i] = Math.sqrt(s / per); peak = Math.max(peak, env[i]); }
    for (let i = 0; i < env.length; i++) env[i] = clamp((env[i] / peak - 0.08) * 1.4);
    ctx.env = env; ctx.voiceLen = dec.duration; ctx.script = params.script;
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
  else presenter(ctx, g, w, h, T, Math.floor(T / 2.4) % 2 === 1, mouth(ctx, params, T, tw), params);
  if (!end) captions(g, w, h, T, tw, u);
  // disclosure, always on
  g.save();
  setFont(g, FONT.grotesk, u * 0.026, { tracking: 0.04 });
  const label = 'DIGITAL PRESENTER · NOT A REAL PERSON';
  const lw = g.measureText(label).width + u * 0.04, lh = u * 0.05;
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.roundRect(u * 0.04, u * 0.05, lw, lh, lh / 2); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(label, u * 0.06, u * 0.05 + lh / 2);
  g.restore();
}

function presenter(ctx, g, w, h, T, close, open, params) {
  const f = ctx.face, m = ctx.faceMeta;
  // draw the face into its own canvas with the jaw moved, then frame it
  const pc = ctx._pc || (ctx._pc = canvas(f.width, f.height));
  const pg = pc.getContext('2d');
  pg.setTransform(1, 0, 0, 1, 0, 0);
  pg.drawImage(f, 0, 0);
  const mw = m.mw * f.width, mx = m.mouth[0] * f.width, my = m.mouth[1] * f.height;
  const gap = open * mw * 0.16;
  if (gap > 0.6) {
    // the dark of the open mouth between the lips
    pg.fillStyle = 'rgba(48,18,20,0.92)';
    pg.beginPath(); pg.ellipse(mx, my + gap * 0.35, mw * 0.36, gap * 0.55 + 0.5, 0, 0, Math.PI * 2); pg.fill();
    // move the lower lip and chin down with a soft-edged slice
    const sw = mw * 1.9, sh = mw * 1.25, sx = mx - sw / 2, sy = my + mw * 0.02;
    const slice = ctx._slice || (ctx._slice = canvas(Math.ceil(sw), Math.ceil(sh)));
    const sg = slice.getContext('2d');
    sg.globalCompositeOperation = 'source-over';
    sg.clearRect(0, 0, slice.width, slice.height);
    sg.drawImage(f, sx, sy, sw, sh, 0, 0, sw, sh);
    sg.globalCompositeOperation = 'destination-in';
    const gx = sg.createRadialGradient(sw / 2, sh * 0.3, sw * 0.18, sw / 2, sh * 0.3, sw * 0.5);
    gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
    sg.fillStyle = gx; sg.fillRect(0, 0, sw, sh);
    pg.drawImage(slice, sx, sy + gap);
  }
  g.fillStyle = '#ddd'; g.fillRect(0, 0, w, h);
  const zoom = close ? 1.32 : 1.04;
  const bob = Math.sin(T * 1.7) * 0.004, sway = Math.sin(T * 1.1) * 0.006;
  g.save();
  g.translate(w / 2, h / 2); g.rotate(sway * 0.8); g.translate(-w / 2, -h / 2);
  cover(g, pc, -w * 0.02, -h * 0.02 + bob * h, w * 1.04, h * 1.04, { zoom, fx: m.mouth[0], fy: close ? m.eyes + 0.05 : 0.42 });
  g.restore();
  // the product rides along in a card
  const pIn = ease.back(span(T, 0.9, 1.4));
  if (pIn > 0) {
    const cw = w * 0.3, ch = cw * 1.15, x = w - cw - w * 0.05, y = h * 0.47 + Math.sin(T * 2) * h * 0.004;
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
