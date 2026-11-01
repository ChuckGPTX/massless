// Pages whose animation runs on performance.now(): the recorder fakes the clock and steps it 1/24 s per frame.
const fit169 = (r) => { const h = Math.floor((r.w * 9) / 16 / 2) * 2; if (h <= r.h) return { ...r, y: r.y + Math.round((r.h - h) / 2), h }; const w = Math.floor((r.h * 16) / 9 / 2) * 2; return { ...r, x: r.x + Math.round((r.w - w) / 2), w }; };
const rectOf = (sel) => async (pg) => fit169(await pg.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.floor(r.width / 2) * 2, h: Math.floor(r.height / 2) * 2 }; }));
const tick = ([t, i]) => { window.__fakeT = 100000 + (i * 1000) / 24; return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))); };
module.exports = [
  { id: 'image-depth', url: '/3d?sample=samurai', vw: 960, vh: 640, dur: 2,
    prep: async (pg) => {
      await pg.waitForFunction(() => window.massless && massless.mesh, null, { timeout: 300000 }); await pg.waitForTimeout(1500);
      await pg.$eval('#p-orbit', (b) => b.click()); await pg.waitForTimeout(500);
      const r = await pg.$eval('#view3d', (e) => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      await pg.mouse.move(r.x, r.y); await pg.mouse.down(); module.exports.depthCenter = r;
    },
    rect: rectOf('#view3d'),
    step: async (pg, t) => { const r = module.exports.depthCenter; await pg.mouse.move(r.x - 45 * Math.sin(2 * Math.PI * t), r.y - 8 * Math.sin(4 * Math.PI * t)); await pg.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())))); },
  },
  { id: 'film-voice', url: '/audio?tab=voice', vw: 1280, vh: 1200, dur: 5, fakeTime: true, dpr: 2,
    prep: async (pg) => { await pg.waitForTimeout(2500); await pg.$eval('#wave-a', (e) => e.scrollIntoView({ block: 'center' })); await pg.waitForTimeout(800); },
    rect: rectOf('.vis:has(#wave-a)'), frame: tick },
  { id: 'film-beds', url: '/audio?tab=voice', vw: 1280, vh: 1200, dur: 5, fakeTime: true, dpr: 2,
    prep: async (pg) => { await pg.waitForTimeout(2500); await pg.$eval('#wave-b', (e) => e.scrollIntoView({ block: 'center' })); await pg.waitForTimeout(800); },
    rect: rectOf('.vis:has(#wave-b)'), frame: tick },
  { id: 'image-scene', url: '/scene/', vw: 1280, vh: 900, dur: 5,
    prep: async (pg) => {
      await pg.waitForSelector('#scene canvas', { timeout: 60000 }); await pg.waitForTimeout(2500);
      const c = await pg.$('#orbit'); if (c && (await c.isChecked())) await c.uncheck();
      const r = await pg.$eval('#scene canvas', (e) => { const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
      await pg.mouse.move(r.x, r.y); await pg.mouse.down(); module.exports.center = r;
    },
    rect: rectOf('#scene canvas'),
    step: async (pg, t) => { const r = module.exports.center; await pg.mouse.move(r.x - 260 * Math.sin(2 * Math.PI * t), r.y - 30 * Math.sin(4 * Math.PI * t)); await pg.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => res())))); },
  },
];
