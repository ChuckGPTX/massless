// Render camera-move and effect loops with the Video page's own renderer, frame by frame.
// node record-video.cjs jobs/video.json  -> rec/<id>/f%04d.jpg
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8787';
const jobs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const only = process.argv.slice(3);
(async () => {
  const b = await chromium.launch();
  for (const j of jobs) {
    if (only.length && !only.includes(j.id)) continue;
    const dir = 'rec/' + j.id; fs.mkdirSync(dir, { recursive: true });
    const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = []; pg.on('pageerror', e => errs.push(e.message));
    const q = j.effect ? `effect=${j.effect}&look=${j.look || ''}` : `move=${j.move}`;
    await pg.goto(`${BASE}/video?sample=${j.sample}&${q}`, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.massless && massless.state.current && massless.state.current.depth && (!massless.state.effect || massless.effects.prep), null, { timeout: 300000 });
    await pg.waitForTimeout(500);
    const n = Math.round(j.dur * 24);
    for (let start = 0; start < n; start += 24) {
      const frames = await pg.evaluate(async ([dur, start, end, W, H]) => {
        const m = window.massless;
        m.state.recording = true; m.state.duration = dur; m.state.fps = 24; m.state.playing = false;
        m.renderer.setSize(W, H);
        if (m.updateZoom) m.updateZoom();
        const out = [];
        for (let i = start; i < end; i++) {
          const t = i / (dur * 24);
          m.drawFrame(t, t * dur);
          out.push(m.renderer.canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
        }
        return out;
      }, [j.dur, start, Math.min(n, start + 24), j.w || 640, j.h || 360]);
      frames.forEach((f, k) => fs.writeFileSync(`${dir}/f${String(start + k).padStart(4, '0')}.jpg`, Buffer.from(f, 'base64')));
    }
    console.log(j.id, n, 'frames', errs.length ? errs.slice(0, 2) : '');
    await pg.close();
  }
  await b.close();
})();
