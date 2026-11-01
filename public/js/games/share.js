/*! Chucksi Games · share.js · MIT License · Copyright (c) 2026 Chuck Crawley · https://github.com/ChuckGPTX/massless */
// Share: the recipe (never image data) deflated with CompressionStream and base64url-encoded into the URL hash.
// Download: one self-contained .html file with the engine, the template, the score engine, the recipe, the art
// and the fonts inlined (and, for 3D Stack, three.js 0.180.0 inlined as data: modules), so it plays offline.

import { shareable } from './recipe.js';

const b64url = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (str) => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/** Recipe -> 'z...' (deflate) or 'j...' (plain JSON when CompressionStream is missing). */
export async function encodeRecipe(recipe) {
  const bytes = new TextEncoder().encode(JSON.stringify(shareable(recipe)));
  if (typeof CompressionStream !== 'undefined') return `z${b64url(await pipe(bytes, new CompressionStream('deflate')))}`;
  return `j${b64url(bytes)}`;
}
export async function decodeRecipe(code) {
  const kind = code[0];
  let bytes = unb64url(code.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate'));
  else if (kind !== 'j') throw new Error('Unknown link format');
  if (bytes.length > 200000) throw new Error('Link too long');
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function shareUrl(recipe, base = `${location.origin}/games`) {
  return `${base}#g=${await encodeRecipe(recipe)}`;
}

// ---------- download ----------
const MIT = `MIT License

Copyright (c) 2026 Chuck Crawley

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.`;
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/';

/**
 * Turn an ES module into a function-scoped block of a bundle: static imports of sibling modules become
 * reads from __m, `export` keywords are dropped and the names returned. Imports of 'three' are hoisted.
 */
export function wrapModule(name, src) {
  const names = [];
  const hoisted = [];
  let code = src.replace(/^import\s+([^;]+?)\s+from\s+['"]([^'"]+)['"];?[ \t]*$/gm, (m, what, from) => {
    if (from === 'three') { hoisted.push(`import ${what} from 'three';`); return ''; }
    const mod = from.replace(/^.*\//, '').replace(/\.js$/, '');
    if (what.trim().startsWith('*')) return `const ${what.split(/\s+as\s+/)[1].trim()} = __m['${mod}'];`;
    return `const ${what.replace(/\s+as\s+/g, ': ')} = __m['${mod}'];`;
  });
  code = code.replace(/import\(\s*['"](?:\.\.?\/)+([\w-]+)\.js['"]\s*\)/g, (m, n) => `Promise.resolve(__m['${n}'])`);
  code = code.replace(/^export\s+(async\s+function\*?|function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/gm, (m, kw, id) => { names.push(id); return `${kw} ${id}`; });
  return { code: `__m['${name}'] = (() => {\n${code}\nreturn { ${names.join(', ')} };\n})();\n`, hoisted };
}

async function text(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}
async function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
const toDataUri = async (src) => (src.startsWith('data:') ? src : dataUrl(await (await fetch(src)).blob()));
function canvasUri(img, jpeg = false) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.86);
}
const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const safeScript = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

/**
 * Build the standalone game. images: the live images the page plays with (uploads, AI art), keyed by role;
 * static art in the recipe (/media/games/...) is fetched and inlined. Returns { html, bytes, threeInlined }.
 */
export async function buildStandalone(recipe, images = {}, { genreName = '', help = '', base = new URL('../', import.meta.url).href } = {}) {
  const r = JSON.parse(JSON.stringify(recipe));
  r.art = r.art || {};
  // inline art: live images first, then the recipe's own static paths
  for (const role of ['player', 'enemy', 'item', 'hazard']) {
    const live = images[role];
    if (live && !live.sheet) r.art[role] = canvasUri(live);
    else if (typeof r.art[role] === 'string') r.art[role] = await toDataUri(r.art[role]).catch(() => undefined);
    else if (r.art[role]?.src) r.art[role].src = await toDataUri(r.art[role].src).catch(() => r.art[role].src);
  }
  if (images.bg) {
    const list = Array.isArray(images.bg) ? images.bg : [images.bg];
    r.art.bg = list.map((im) => canvasUri(im, true));
  } else if (r.art.bg) {
    const list = Array.isArray(r.art.bg) ? r.art.bg : [r.art.bg];
    r.art.bg = await Promise.all(list.map((u) => toDataUri(u).catch(() => null))).then((l) => l.filter(Boolean));
  }
  const mods = ['engine', 'art', 'sound', r.genre];
  const srcs = await Promise.all([...mods.map((m) => text(new URL(`./${m}.js`, import.meta.url))), text(new URL('../score.js', import.meta.url))]);
  const hoisted = new Set();
  let bundle = '';
  for (const [i, m] of [...mods, 'score'].entries()) {
    const w = wrapModule(m === r.genre ? 'template' : m, srcs[i]);
    w.hoisted.forEach((h) => hoisted.add(h));
    bundle += w.code;
  }
  // fonts
  const fontUrl = (f) => new URL(`/fonts/${f}`, base).href;
  const fonts = await Promise.all([
    ['Big Shoulders Display', 900, 'big-shoulders-display-latin-900-normal.woff2'],
    ['Big Shoulders Display', 800, 'big-shoulders-display-latin-800-normal.woff2'],
    ['Instrument Sans', 600, 'instrument-sans-latin-600-normal.woff2'],
    ['Instrument Sans', 400, 'instrument-sans-latin-400-normal.woff2'],
  ].map(async ([fam, wt, file]) => {
    try { return `@font-face{font-family:'${fam}';font-weight:${wt};font-display:swap;src:url(${await toDataUri(fontUrl(file))}) format('woff2')}`; } catch { return ''; }
  }));
  // three.js for 3D Stack: inline both modules as data: URLs, or fall back to the pinned CDN
  let importmap = '';
  let threeInlined = false;
  if (hoisted.size) {
    let map = { three: `${THREE_CDN}three.module.min.js` };
    try {
      const [mod, core] = await Promise.all([text(`${THREE_CDN}three.module.min.js`), text(`${THREE_CDN}three.core.min.js`)]);
      map = { three: `data:text/javascript;base64,${b64(mod.replaceAll('"./three.core.min.js"', '"three-core"'))}`, 'three-core': `data:text/javascript;base64,${b64(core)}` };
      threeInlined = true;
    } catch { /* offline: the file loads three.js from jsDelivr when it is opened */ }
    importmap = `<script type="importmap">${JSON.stringify({ imports: map })}</script>`;
  }
  const boot = `
const recipe = JSON.parse(document.getElementById('recipe').textContent);
const tpl = __m.template;
const sound = new __m.sound.Sound({ loadScore: () => Promise.resolve(__m.score) });
const art = await __m.art.loadArt(recipe);
sound.prepareMusic({ ...recipe.music, seed: recipe.seed });
await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
const box = document.getElementById('game');
const mount = __m.engine.mountGame(box, { template: tpl, recipe, art, sound, genreName: ${JSON.stringify(genreName)}, help: ${JSON.stringify(help)} || tpl.meta?.help, accent: art.pal.accent });
const snd = document.getElementById('snd');
const label = () => { snd.textContent = sound.muted ? 'Sound off' : 'Sound on'; snd.setAttribute('aria-pressed', String(!sound.muted)); };
snd.addEventListener('click', () => { sound.unlock(); sound.setMuted(!sound.muted); label(); });
label();
window.massless = { mount, recipe, sound };
`;
  const title = String(r.title).replace(/[<>&"]/g, '');
  const html = `<!doctype html>
<!--
${title}: a game made with Chucksi Games (https://chucksi.com/games).
Engine, templates and score: ${MIT.split('\n')[0]}. Full text below.${threeInlined ? '\nIncludes three.js 0.180.0, Copyright 2010-2025 Three.js Authors, MIT License.' : ''}

${MIT}
-->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0b0c">
<title>${title} · a Chucksi game</title>
<style>
${fonts.join('\n')}
html,body{margin:0;height:100%;background:#0b0b0c;color:#f4f4f1;font:500 14px/1.4 'Instrument Sans',system-ui,sans-serif;overflow:hidden}
#game{position:fixed;left:0;right:0;top:0;bottom:46px;padding:10px}
.bar{position:fixed;left:0;right:0;bottom:0;height:46px;display:flex;align-items:center;gap:12px;padding:0 14px;border-top:1px solid rgba(255,255,255,.08);background:#101012}
.bar b{font:900 18px/1 'Big Shoulders Display',Impact,sans-serif;text-transform:uppercase;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar button,.bar a{margin-left:auto;font:inherit;color:#f4f4f1;background:#1d1d20;border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:6px 11px;cursor:pointer;text-decoration:none;white-space:nowrap}
.bar a{margin-left:0;color:#9b9ba2}
</style>
${importmap}
</head>
<body>
<div id="game"></div>
<div class="bar"><b>${title}</b><button type="button" id="snd" aria-pressed="true">Sound on</button><a href="https://chucksi.com/games" rel="noopener">Made with Chucksi</a></div>
<script type="application/json" id="recipe">${safeScript(JSON.stringify(r))}</script>
<script type="module">
${[...hoisted].join('\n')}
const __m = {};
${safeScript(bundle)}
${boot}
</script>
</body>
</html>
`;
  return { html, bytes: html.length, threeInlined };
}
