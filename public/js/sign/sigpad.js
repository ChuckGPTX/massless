// "Adopt your signature": draw it, type it in a script font, or upload a picture of it. Returns PNGs
// (base64url) for the signature and the initials. Nothing leaves the browser until the signer finishes,
// and then only encrypted.

import { el, toast } from '../ui.js';
import { b64u } from './crypto.js';

const FS = 'https://cdn.jsdelivr.net/npm/@fontsource';
export const SIG_FONTS = [
  { id: 'dancing', family: 'MS Dancing Script', label: 'Classic', url: `${FS}/dancing-script@5.2.5/files/dancing-script-latin-400-normal.woff2`, k: 1 },
  { id: 'vibes', family: 'MS Great Vibes', label: 'Formal', url: `${FS}/great-vibes@5.2.5/files/great-vibes-latin-400-normal.woff2`, k: 1.12 },
  { id: 'caveat', family: 'MS Caveat', label: 'Casual', url: `${FS}/caveat@5.2.5/files/caveat-latin-400-normal.woff2`, k: 1.05 },
  { id: 'apple', family: 'MS Homemade Apple', label: 'Handwritten', url: `${FS}/homemade-apple@5.2.5/files/homemade-apple-latin-400-normal.woff2`, k: 0.78 },
];
const INKS = { blue: '#1b2f7a', black: '#141419' };
const FALLBACK = '"Segoe Script", "Brush Script MT", "Snell Roundhand", cursive';

let fontsP = null;
export function loadSigFonts() {
  if (fontsP) return fontsP;
  fontsP = Promise.all(SIG_FONTS.map(async (f) => {
    try {
      const face = new FontFace(f.family, `url(${f.url})`);
      await face.load();
      document.fonts.add(face);
      return true;
    } catch { return false; }
  }));
  return fontsP;
}

export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---------- canvas helpers ----------
function trim(canvas, pad = 8) {
  const g = canvas.getContext('2d');
  const { width: W, height: H } = canvas;
  const d = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}
function toImage(canvas) {
  const url = canvas.toDataURL('image/png');
  const bin = atob(url.split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { png: b64u(bytes), w: canvas.width, h: canvas.height, url };
}
function typed(text, font, ink, W = 1000, H = 300) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let size = Math.round(H * 0.5 * (font ? font.k : 1));
  const fam = font ? `"${font.family}", ${FALLBACK}` : FALLBACK;
  g.font = `${size}px ${fam}`;
  while (g.measureText(text).width > W - 60 && size > 20) { size -= 4; g.font = `${size}px ${fam}`; }
  g.fillStyle = ink;
  g.textBaseline = 'alphabetic';
  g.fillText(text, 30, H * 0.66);
  return c;
}

// ---------- drawing pad ----------
function pad(canvas, getInk) {
  const strokes = [];
  const g = canvas.getContext('2d');
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)]; };
  const draw = () => {
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = getInk();
    g.lineCap = g.lineJoin = 'round';
    g.lineWidth = canvas.width / 150;
    for (const s of strokes) {
      g.beginPath();
      g.moveTo(s[0][0], s[0][1]);
      if (s.length === 1) g.lineTo(s[0][0] + 0.1, s[0][1]);
      for (let i = 1; i < s.length - 1; i++) {
        const mx = (s[i][0] + s[i + 1][0]) / 2, my = (s[i][1] + s[i + 1][1]) / 2;
        g.quadraticCurveTo(s[i][0], s[i][1], mx, my);
      }
      if (s.length > 1) g.lineTo(s.at(-1)[0], s.at(-1)[1]);
      g.stroke();
    }
    canvas.parentElement.classList.toggle('inked', strokes.length > 0);
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    const s = [at(e)];
    strokes.push(s);
    draw();
    const move = (ev) => { (ev.getCoalescedEvents?.() || [ev]).forEach((p) => s.push(at(p))); draw(); };
    const up = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up); };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  });
  return { clear: () => { strokes.length = 0; draw(); }, redraw: draw, empty: () => strokes.length === 0 };
}

// ---------- the sheet ----------
let sheet = null;
function build() {
  const d = el('dialog', { class: 'sheet sg-sheet sg-adopt', 'aria-labelledby': 'sg-adopt-h' });
  d.innerHTML = `
    <form method="dialog" class="sheet-head"><h2 id="sg-adopt-h">Adopt your signature</h2><button class="x" aria-label="Close" value="cancel">×</button></form>
    <div class="sg-names">
      <label class="sg-in"><span>Full name</span><input id="sg-name" type="text" maxlength="80" autocomplete="name" spellcheck="false"></label>
      <label class="sg-in sg-in-ini"><span>Initials</span><input id="sg-ini" type="text" maxlength="5" autocomplete="off" spellcheck="false"></label>
    </div>
    <div class="groups sg-modes" role="tablist" aria-label="How to sign">
      <button type="button" role="tab" data-mode="type" aria-selected="true">Type</button>
      <button type="button" role="tab" data-mode="draw" aria-selected="false">Draw</button>
      <button type="button" role="tab" data-mode="upload" aria-selected="false">Upload</button>
    </div>
    <div class="sg-mode" data-pane="type"><div class="sg-styles" id="sg-styles" role="radiogroup" aria-label="Signature style"></div></div>
    <div class="sg-mode" data-pane="draw" hidden>
      <div class="sg-pad"><canvas id="sg-pad-sig" width="1000" height="300" aria-label="Draw your signature"></canvas><span class="sg-line"></span><span class="sg-hint">Sign here with your finger, pen or mouse</span><button type="button" class="sg-clear" data-clear="sig">Clear</button></div>
      <div class="sg-pad sg-pad-ini" id="sg-ini-wrap"><canvas id="sg-pad-ini" width="500" height="300" aria-label="Draw your initials"></canvas><span class="sg-line"></span><span class="sg-hint">Initials</span><button type="button" class="sg-clear" data-clear="ini">Clear</button></div>
    </div>
    <div class="sg-mode" data-pane="upload" hidden>
      <label class="sg-upload" for="sg-file"><span class="sg-upload-prev" id="sg-up-prev">Choose a photo or scan of your signature</span><small>PNG or JPG. White backgrounds are removed.</small></label>
      <input type="file" id="sg-file" accept="image/png,image/jpeg,image/webp" hidden>
    </div>
    <div class="sg-ink" role="radiogroup" aria-label="Ink color"><span>Ink</span>
      <button type="button" role="radio" data-ink="blue" aria-checked="true" aria-label="Blue ink"><i style="--c:${INKS.blue}"></i>Blue</button>
      <button type="button" role="radio" data-ink="black" aria-checked="false" aria-label="Black ink"><i style="--c:${INKS.black}"></i>Black</button>
    </div>
    <p class="sg-legal">By selecting <strong>Adopt and sign</strong>, I agree that this signature and these initials are my electronic signature and initials, and are as valid as my handwritten ones.</p>
    <div class="sg-actions"><button type="button" class="btn-ghost" data-cancel>Cancel</button><button type="button" class="btn-accent" id="sg-adopt-go">Adopt and sign</button></div>`;
  document.body.append(d);
  d.addEventListener('click', (e) => { if (e.target === d) d.close('cancel'); });
  return d;
}

/**
 * Open the sheet. Resolves with { name, initials, signature, initialsImg } or null when cancelled.
 * opts: { name, initials, needInitials, ink }
 */
export function adoptSignature(opts = {}) {
  if (!sheet) sheet = build();
  const d = sheet;
  const q = (s) => d.querySelector(s);
  const st = { mode: 'type', font: SIG_FONTS[0].id, ink: opts.ink || 'blue', upload: null };
  const nameIn = q('#sg-name'), iniIn = q('#sg-ini');
  nameIn.value = opts.name || '';
  iniIn.value = opts.initials || initialsOf(opts.name);
  let iniTouched = !!opts.initials;
  q('#sg-ini-wrap').hidden = opts.needInitials === false;
  q('.sg-in-ini').hidden = opts.needInitials === false;
  const ink = () => INKS[st.ink];
  const sigPad = pad(q('#sg-pad-sig'), ink);
  const iniPad = pad(q('#sg-pad-ini'), ink);
  sigPad.clear(); iniPad.clear();
  q('#sg-up-prev').textContent = 'Choose a photo or scan of your signature';

  const styles = q('#sg-styles');
  const drawStyles = () => {
    const name = nameIn.value.trim() || 'Your Name';
    styles.replaceChildren(...SIG_FONTS.map((f) => {
      const b = el('button', { type: 'button', role: 'radio', class: 'sg-style', 'aria-checked': String(st.font === f.id), 'data-font': f.id, 'aria-label': `${f.label} style` });
      const c = typed(name, f, ink(), 1000, 260);
      c.className = 'sg-style-sig';
      const ini = typed(iniIn.value.trim() || initialsOf(name) || 'YN', f, ink(), 360, 260);
      ini.className = 'sg-style-ini';
      if (opts.needInitials === false) ini.hidden = true;
      b.append(c, ini, el('small', {}, f.label));
      b.addEventListener('click', () => { st.font = f.id; styles.querySelectorAll('.sg-style').forEach((x) => x.setAttribute('aria-checked', String(x === b))); });
      return b;
    }));
  };
  const setMode = (m) => {
    st.mode = m;
    d.querySelectorAll('.sg-modes [role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === m)));
    d.querySelectorAll('.sg-mode').forEach((p) => { p.hidden = p.dataset.pane !== m; });
    if (m === 'draw') { sigPad.redraw(); iniPad.redraw(); }
  };
  setMode('type');
  drawStyles();
  loadSigFonts().then(() => drawStyles());

  return new Promise((resolve) => {
    const ac = new AbortController();
    const on = (node, ev, fn) => node.addEventListener(ev, fn, { signal: ac.signal });
    const done = (val) => { ac.abort(); if (d.open) d.close(); resolve(val); };
    on(nameIn, 'input', () => { if (!iniTouched) iniIn.value = initialsOf(nameIn.value); drawStyles(); });
    on(iniIn, 'input', () => { iniTouched = true; drawStyles(); });
    d.querySelectorAll('.sg-modes [role=tab]').forEach((t) => on(t, 'click', () => setMode(t.dataset.mode)));
    d.querySelectorAll('[data-ink]').forEach((b) => on(b, 'click', () => {
      st.ink = b.dataset.ink;
      d.querySelectorAll('[data-ink]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      drawStyles(); sigPad.redraw(); iniPad.redraw();
      if (st.upload) renderUpload();
    }));
    d.querySelectorAll('[data-clear]').forEach((b) => on(b, 'click', () => (b.dataset.clear === 'sig' ? sigPad : iniPad).clear()));
    const renderUpload = () => {
      const prev = q('#sg-up-prev');
      prev.replaceChildren(el('img', { src: st.upload.url, alt: 'Your uploaded signature' }));
    };
    on(q('#sg-file'), 'change', async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) { toast('That image is over 8 MB. Use a smaller one.', 'error'); return; }
      try {
        const bmp = await createImageBitmap(f);
        const k = Math.min(1, 1000 / bmp.width, 400 / bmp.height);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0, c.width, c.height);
        const img = g.getImageData(0, 0, c.width, c.height);
        const px = img.data;
        for (let i = 0; i < px.length; i += 4) {
          const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          px[i + 3] = lum > 200 ? 0 : lum > 150 ? Math.round(px[i + 3] * (200 - lum) / 50) : px[i + 3];
        }
        g.putImageData(img, 0, 0);
        const t = trim(c);
        if (!t) { toast('No signature found in that image. Try a darker photo.', 'error'); return; }
        st.upload = toImage(t);
        renderUpload();
      } catch {
        toast('That image could not be read. Try a PNG or JPG.', 'error');
      }
    });
    on(d, 'close', () => done(null), { once: true });
    on(q('[data-cancel]'), 'click', () => done(null));
    on(q('#sg-adopt-go'), 'click', () => {
      const name = nameIn.value.trim().replace(/\s+/g, ' ');
      const initials = iniIn.value.trim().replace(/\s+/g, '');
      if (name.length < 2) { toast('Type your full name first.', 'error'); nameIn.focus(); return; }
      if (opts.needInitials !== false && !initials) { toast('Type your initials.', 'error'); iniIn.focus(); return; }
      const font = SIG_FONTS.find((f) => f.id === st.font);
      let sigC, iniC;
      if (st.mode === 'type') {
        sigC = trim(typed(name, font, ink()));
        iniC = trim(typed(initials || initialsOf(name), font, ink(), 500, 300));
      } else if (st.mode === 'draw') {
        if (sigPad.empty()) { toast('Draw your signature first.', 'error'); return; }
        sigC = trim(q('#sg-pad-sig'));
        if (opts.needInitials !== false && iniPad.empty()) { toast('Draw your initials too.', 'error'); return; }
        iniC = iniPad.empty() ? trim(typed(initials || initialsOf(name), font, ink(), 500, 300)) : trim(q('#sg-pad-ini'));
      } else {
        if (!st.upload) { toast('Choose an image of your signature first.', 'error'); return; }
        iniC = trim(typed(initials || initialsOf(name), font, ink(), 500, 300));
      }
      const signature = st.mode === 'upload' ? { png: st.upload.png, w: st.upload.w, h: st.upload.h, mode: 'upload' } : { ...strip(toImage(sigC)), mode: st.mode, font: st.mode === 'type' ? font.id : undefined };
      const initialsImg = strip(toImage(iniC));
      done({ name, initials: initials || initialsOf(name), signature, initialsImg, ink: st.ink, preview: { sig: signature.url || st.upload?.url || toImage(sigC).url, ini: toImage(iniC).url } });
    });
    d.showModal();
    if (!nameIn.value) nameIn.focus();
  });
}
const strip = ({ png, w, h }) => ({ png, w, h });
