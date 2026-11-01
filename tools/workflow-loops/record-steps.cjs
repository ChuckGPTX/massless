// Deterministic page recorder: for each of n frames, run job.frame(t) in the page, then screenshot the crop.
// node record-steps.cjs jobs/<file>.js [id ...]  -> steps/<id>/f%04d.jpg (meant to play at 24 fps)
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8787';
const jobs = require(require('path').resolve(process.argv[2]));
const only = process.argv.slice(3);
(async () => {
  const b = await chromium.launch();
  for (const j of jobs) {
    if (only.length && !only.includes(j.id)) continue;
    const ctx = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: j.vw || 1280, height: j.vh || 800 }, deviceScaleFactor: j.dpr || 1 });
    const pg = await ctx.newPage();
    if (j.fakeTime) await pg.addInitScript(() => { const real = performance.now.bind(performance); const raf = window.requestAnimationFrame.bind(window); window.__fakeT = null; performance.now = () => (window.__fakeT ?? real()); window.requestAnimationFrame = (cb) => raf(() => cb(performance.now())); });
    pg.setDefaultTimeout(180000);
    const errs = []; pg.on('pageerror', e => errs.push(e.message.slice(0, 120)));
    try {
      await pg.goto(BASE + j.url, { waitUntil: 'load', timeout: 120000 });
      if (j.prep) await j.prep(pg);
      const rect = typeof j.rect === 'function' ? await j.rect(pg) : await pg.$eval(j.rect, (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.floor(r.width / 2) * 2, h: Math.floor(r.height / 2) * 2 }; });
      if (j.adjust) Object.assign(rect, j.adjust(rect));
      const n = Math.round(j.dur * 24);
      const dir = 'steps/' + j.id; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      for (let i = 0; i < n; i++) {
        if (j.step) await j.step(pg, i / n, i, n); else await pg.evaluate(j.frame, [i / n, i, n]);
        if (j.settle) await pg.waitForTimeout(j.settle);
        await pg.screenshot({ path: `${dir}/f${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 90, clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h }, animations: 'allow' });
      }
      console.log(j.id, n, JSON.stringify(rect), errs.slice(0, 2).join(' | '));
    } catch (e) { console.log(j.id, 'FAILED', e.message.slice(0, 200)); }
    await ctx.close();
  }
  await b.close();
})();
