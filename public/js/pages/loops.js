import { LOOPS, PALETTES, FORMATS, drawLoop, loopHtml, exportCanvasVideo } from '../motion-loops.js';

const $ = (s) => document.querySelector(s);
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);
const state = {
  id: LOOPS.some((l) => l.id === params.get('loop')) ? params.get('loop') : 'bounce',
  palette: PALETTES[params.get('palette')] ? params.get('palette') : 'chucksi',
  colors: null, bg: null, kind: 'All', busy: false,
};
const setPalette = (key) => { state.palette = key; state.colors = [...PALETTES[key].ink]; state.bg = PALETTES[key].bg; };
setPalette(state.palette);
const opts = () => ({ colors: state.colors, bg: state.bg });
const period = () => Number($('#period').value) || 12;
const loopById = (id) => LOOPS.find((l) => l.id === id);

// ---------- controls ----------
for (const [key, f] of Object.entries(FORMATS)) $('#format').append(new Option(f.name, key));
$('#format').value = FORMATS[params.get('format')] ? params.get('format') : 'square';

function buildPalettes() {
  const box = $('#palettes'); box.replaceChildren();
  for (const [key, p] of Object.entries(PALETTES)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'palette'; b.setAttribute('role', 'radio'); b.dataset.key = key;
    b.setAttribute('aria-checked', String(key === state.palette));
    const dots = document.createElement('span');
    for (const c of [p.bg, ...p.ink]) { const i = document.createElement('i'); i.style.background = c; dots.append(i); }
    b.append(dots, document.createTextNode(' ' + p.name));
    b.onclick = () => { setPalette(key); syncInputs(); buildPalettes(); redrawStills(); };
    box.append(b);
  }
}
function redrawStills() { if (still) { for (const t of tiles) drawLoop(t.g, t.loop.id, 0.2, 320, 320, opts()); drawLoop(pg, state.id, 0.2, preview.width, preview.height, opts()); } }
function syncInputs() { state.colors.forEach((c, i) => ($('#c' + i).value = c)); $('#bg').value = state.bg; }
for (const i of [0, 1, 2]) $('#c' + i).oninput = (e) => { state.colors[i] = e.target.value; state.palette = 'custom'; buildPalettes(); redrawStills(); };
$('#bg').oninput = (e) => { state.bg = e.target.value; state.palette = 'custom'; buildPalettes(); redrawStills(); };
$('#format').onchange = () => { sizePreview(); redrawStills(); };

function select(id) {
  state.id = id;
  const loop = loopById(id);
  $('#loop-name').textContent = loop.name;
  $('#loop-kind').textContent = loop.kind.toUpperCase();
  document.querySelectorAll('.loop-tile').forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.id === id)));
  const url = new URL(location.href); url.searchParams.set('loop', id); history.replaceState(null, '', url);
  redrawStills();
}

function sizePreview() {
  const f = FORMATS[$('#format').value], cv = $('#loop-preview'), scale = 720 / Math.max(f.w, f.h);
  cv.width = Math.round(f.w * scale); cv.height = Math.round(f.h * scale);
}

// ---------- gallery ----------
const tiles = [];
function buildKinds() {
  const kinds = ['All', ...new Set(LOOPS.map((l) => l.kind))], box = $('#kinds');
  box.replaceChildren(...kinds.map((k) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = k; b.setAttribute('aria-selected', String(k === state.kind));
    b.onclick = () => { state.kind = k; buildKinds(); tiles.forEach((t) => (t.el.hidden = k !== 'All' && t.loop.kind !== k)); };
    return b;
  }));
}
function buildGrid() {
  const grid = $('#loop-grid'), io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => es.forEach((e) => (e.target._visible = e.isIntersecting))) : null;
  for (const loop of LOOPS) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'loop-tile'; el.dataset.id = loop.id; el.setAttribute('aria-label', `${loop.name} loop`);
    const cv = document.createElement('canvas'); cv.width = cv.height = 320;
    const label = document.createElement('span'); label.innerHTML = `<small></small>`; label.firstChild.textContent = loop.kind; label.append(loop.name);
    el.append(cv, label);
    el.onclick = () => { select(loop.id); $('.loop-stage').scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' }); };
    el._visible = !io; io?.observe(el);
    grid.append(el);
    const tile = { el, cv, g: cv.getContext('2d'), loop };
    drawLoop(tile.g, loop.id, 0.2, 320, 320, opts()); // a still frame straight away; visible tiles animate
    tiles.push(tile);
  }
}

// ---------- animation ----------
const preview = $('#loop-preview'), pg = preview.getContext('2d');
const t0 = performance.now();
function frame(now) {
  const p = still ? 0.2 : ((now - t0) / 1000 / period()) % 1;
  drawLoop(pg, state.id, p, preview.width, preview.height, opts());
  $('#loop-progress').style.width = `${(p * 100).toFixed(2)}%`;
  for (const t of tiles) if (t.el._visible && !t.el.hidden) drawLoop(t.g, t.loop.id, p, 320, 320, opts());
  if (!still) requestAnimationFrame(frame);
}

// ---------- exports ----------
const status = (text) => ($('#loop-status').textContent = text);
const fileBase = () => `chucksi-loop-${state.id}-${$('#format').value}`;
function save(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function busy(on) { state.busy = on; for (const id of ['download-mp4', 'download-png', 'download-html', 'copy-html']) $('#' + id).disabled = on; }

$('#download-mp4').onclick = async () => {
  if (state.busy) return;
  const f = FORMATS[$('#format').value], seconds = period() * Number($('#repeats').value), o = opts(), id = state.id;
  busy(true); status('Making your MP4… 0%');
  try {
    const blob = await exportCanvasVideo({
      width: f.w, height: f.h, fps: 30, duration: seconds,
      draw: (cv, t) => drawLoop(cv.getContext('2d'), id, (t / period()) % 1, f.w, f.h, o),
      onProgress: (k) => status(`Making your MP4… ${Math.round(k * 100)}%`),
    });
    save(blob, `${fileBase()}.mp4`);
    status(`Saved a ${seconds}-second ${f.name.split(' ·')[0].toLowerCase()} MP4. It loops cleanly end to start.`);
  } catch (e) { status(e.message || 'Export failed. Try again.'); }
  finally { busy(false); }
};
$('#download-png').onclick = () => {
  const f = FORMATS[$('#format').value], cv = document.createElement('canvas');
  cv.width = f.w; cv.height = f.h;
  drawLoop(cv.getContext('2d'), state.id, 0.21, f.w, f.h, opts());
  cv.toBlob((b) => { if (b) { save(b, `${fileBase()}.png`); status('Saved a still frame.'); } }, 'image/png');
};
const html = () => loopHtml({ id: state.id, colors: state.colors, bg: state.bg, period: period(), title: `${loopById(state.id).name} loop` });
$('#download-html').onclick = () => { save(new Blob([html()], { type: 'text/html' }), `${fileBase()}.html`); status('Saved one HTML file. Open it in any browser, or drop it into your site.'); };
$('#copy-html').onclick = async () => {
  try { await navigator.clipboard.writeText(html()); status('Copied. Paste it into a file ending in .html, or hand it to your coding agent to restyle.'); }
  catch { status('Your browser blocked copying. Use “One HTML file” instead.'); }
};

buildPalettes(); syncInputs(); buildKinds(); buildGrid(); select(state.id); sizePreview();
requestAnimationFrame(frame);
