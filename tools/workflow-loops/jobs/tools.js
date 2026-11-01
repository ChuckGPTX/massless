// Chucksi tools recorded frame by frame: each frame sets the tool's own controls, then the crop is captured.
const fit169 = (r) => { const h = Math.floor((r.w * 9) / 16 / 2) * 2; return h <= r.h ? { y: r.y + Math.round((r.h - h) / 2), h } : (() => { const w = Math.floor((r.h * 16) / 9 / 2) * 2; return { x: r.x + Math.round((r.w - w) / 2), w }; })(); };
const ease = (t) => 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
const waitTool = (sel, done) => async (pg) => {
  await pg.waitForFunction(() => document.querySelector('#art') && !document.querySelector('#status')?.textContent.includes('Loading'), null, { timeout: 60000 });
  await pg.waitForTimeout(1500);
  if (sel) {
    await pg.click(sel);
    await pg.waitForFunction(done, null, { timeout: 900000 });
    await pg.waitForTimeout(800);
  }
  await pg.mouse.move(2, 2);
};
module.exports = [
  {
    id: 'image-compose', url: '/edit/', vw: 1280, vh: 900, dur: 5,
    prep: async (pg) => { await waitTool()(pg); await pg.selectOption('#frame', 'wide'); await pg.waitForTimeout(600); },
    rect: '#art', adjust: fit169,
    frame: ([t]) => {
      const set = (id, v) => { const e = document.getElementById(id); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); };
      const s = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
      const bd = document.getElementById('backdrop'); const want = t < 0.5 ? 'studio' : 'neon';
      if (bd.value !== want) { bd.value = want; bd.dispatchEvent(new Event('change', { bubbles: true })); }
      const sc = document.getElementById('scale'); set('scale', Number(sc.min) + (Number(sc.max) - Number(sc.min)) * (0.45 + 0.3 * s));
      const x = document.getElementById('x'); set('x', Number(x.min) + (Number(x.max) - Number(x.min)) * (0.5 + 0.18 * Math.sin(2 * Math.PI * t)));
      const words = 'Made by hand'; const k = Math.max(0, Math.min(words.length, Math.round((t < 0.5 ? t / 0.35 : (1 - t) / 0.35) * words.length)));
      set('headline', words.slice(0, k));
      return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
  },
  ...[['remove-bg', '#bg-run']].map(([tool, run]) => ({
    id: 'image-' + tool, url: '/edit/?tool=' + tool, vw: 1280, vh: 900, dur: 5,
    prep: waitTool(run, () => !document.querySelector('#compare-row').hidden),
    rect: '#art', adjust: fit169,
    frame: ([t]) => { const c = document.getElementById('compare'); c.value = String(Math.round(100 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t)))); c.dispatchEvent(new Event('input', { bubbles: true })); return new Promise((r) => requestAnimationFrame(r)); },
  })),
  {
    id: 'image-erase', url: '/edit/?tool=erase', vw: 1280, vh: 900, dur: 5,
    prep: async (pg) => {
      await waitTool()(pg);
      const r = await pg.$eval('#art', (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
      // brush over the small vase on the right
      // paint over the whole orange vase on the right, row by row
      await pg.mouse.move(r.x + r.w * 0.56, r.y + r.h * 0.4); await pg.mouse.down();
      for (let k = 0, y = 0.4; y <= 0.92; y += 0.025, k++) {
        await pg.mouse.move(r.x + r.w * (k % 2 ? 0.56 : 0.795), r.y + r.h * y, { steps: 6 });
        await pg.mouse.move(r.x + r.w * (k % 2 ? 0.56 : 0.795), r.y + r.h * (y + 0.025), { steps: 2 });
      }
      await pg.mouse.up();
      await pg.click('#er-run');
      await pg.waitForFunction(() => !document.querySelector('#compare-row').hidden, null, { timeout: 900000 });
      await pg.waitForTimeout(800); await pg.mouse.move(2, 2);
    },
    rect: '#art', adjust: fit169,
    frame: ([t]) => { const c = document.getElementById('compare'); c.value = String(Math.round(100 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t)))); c.dispatchEvent(new Event('input', { bubbles: true })); return new Promise((r) => requestAnimationFrame(r)); },
  },
  {
    id: 'film-launch', url: '/film', vw: 1280, vh: 900, dur: 5.5,
    prep: async (pg) => { await pg.waitForFunction(() => window.massless && massless.renderer, null, { timeout: 60000 }); await pg.waitForTimeout(2500); await pg.addStyleTag({ content: '#big-play{display:none!important}' }); await pg.mouse.move(2, 2); },
    rect: '#film', adjust: fit169,
    frame: ([t]) => { massless.seek(3.2 + t * 5.5); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); },
  },
  {
    id: 'film-music', url: '/music', vw: 1280, vh: 900, dur: 5.5,
    prep: async (pg) => {
      await pg.waitForFunction(() => !document.querySelector('#scrub').disabled && !document.querySelector('#art-file').disabled, null, { timeout: 120000 });
      await pg.waitForTimeout(1500);
      await pg.setInputFiles('#art-file', require('path').join(__dirname, '../../../public/media/art/lighthouse.jpg'));
      await pg.waitForFunction(() => document.querySelector('#art-thumb').src.startsWith('blob:'), null, { timeout: 60000 });
      await pg.fill('#artist', 'Chucksi Sessions'); await pg.fill('#track-title', 'Lighthouse');
      await pg.waitForTimeout(1500); await pg.mouse.move(2, 2);
    },
    rect: '#music-canvas', adjust: fit169,
    frame: ([t]) => { const s = document.getElementById('scrub'); s.value = String(2 + t * 5.5); s.dispatchEvent(new Event('input', { bubbles: true })); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); },
  },
];
// The lighthouse sample shrunk to 320 x 180 in the browser, so 4x upscaling has something to recover.
const smallLighthouse = async (pg) => Buffer.from(await pg.evaluate(async () => {
  const img = new Image(); img.src = '/media/art/lighthouse.jpg'; await img.decode();
  const c = document.createElement('canvas'); c.width = 320; c.height = 180; c.getContext('2d').drawImage(img, 0, 0, 320, 180);
  return c.toDataURL('image/png').split(',')[1];
}), 'base64');
module.exports.push({
  id: 'image-upscale', url: '/edit/?tool=upscale', vw: 1280, vh: 900, dur: 5,
  prep: async (pg) => {
    await pg.waitForFunction(() => document.querySelector('#art') && !document.querySelector('#status')?.textContent.includes('Loading'), null, { timeout: 60000 });
    await pg.waitForTimeout(1500);
    await pg.setInputFiles('#image-file', { name: 'lighthouse-small.png', mimeType: 'image/png', buffer: await smallLighthouse(pg) });
    await pg.waitForTimeout(2500);
    await pg.click('input[name="up-factor"][value="4"]');
    await pg.click('#up-run');
    await pg.waitForFunction(() => !document.querySelector('#compare-row').hidden, null, { timeout: 900000 });
    await pg.waitForTimeout(800); await pg.mouse.move(2, 2);
  },
  rect: '#art',
  adjust: (r) => { const h = Math.floor((r.w * 9) / 16 / 2) * 2; return h <= r.h ? { y: r.y + Math.round((r.h - h) / 2), h } : {}; },
  frame: ([t]) => { const c = document.getElementById('compare'); c.value = String(Math.round(100 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t)))); c.dispatchEvent(new Event('input', { bubbles: true })); return new Promise((r) => requestAnimationFrame(r)); },
});
module.exports.push({
  id: 'film-captions', url: '/cut/', vw: 1280, vh: 1000, dur: 4.4,
  prep: async (pg) => {
    await pg.waitForTimeout(2000);
    await pg.selectOption('#sample', 'lidar');
    await pg.waitForFunction(() => document.querySelector('#source').readyState >= 2, null, { timeout: 60000 });
    const srt = '1\n00:00:00,000 --> 00:00:01,500\nOne still.\n\n2\n00:00:01,500 --> 00:00:03,000\nOne laser sweep.\n\n3\n00:00:03,000 --> 00:00:04,500\nA whole new scene.\n';
    await pg.$eval('#cues', (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }, srt);
    await pg.waitForTimeout(800); await pg.mouse.move(2, 2);
  },
  rect: '#caption-canvas',
  frame: ([t]) => new Promise((r) => { const v = document.querySelector('#source'); v.pause(); v.addEventListener('seeked', () => requestAnimationFrame(() => requestAnimationFrame(r)), { once: true }); v.currentTime = t * 4.4; }),
});
