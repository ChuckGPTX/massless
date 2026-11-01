const ids = ['editorial-shop','manifesto','portfolio-timeline','ai-product','local-business','photographer','app-landing','conference','restaurant','book-launch','app-waitlist'];
module.exports = ids.map((id) => ({
  id: 'site-' + id, url: '/website?template=' + id, vw: 1280, vh: 1500, dur: 5.5,
  prep: async (pg) => {
    await pg.waitForTimeout(2500);
    await pg.click('[data-bp="tablet"]');
    await pg.mouse.move(5, 5);
    await pg.waitForTimeout(1500);
  },
  rect: (pg) => pg.$eval('#frame-wrap', (el) => { const r = el.getBoundingClientRect(); const w = Math.floor(r.width / 2) * 2; return { x: Math.round(r.x), y: Math.round(r.y), w, h: Math.floor((w * 4) / 3 / 2) * 2 }; }),
  // hold the top, then ease down the page
  frame: ([t]) => { const f = document.querySelector('#preview'); const w = f.contentWindow; const d = f.contentDocument;
    const max = Math.min(d.documentElement.scrollHeight - w.innerHeight, 2400);
    const e = t < 0.15 ? 0 : (t - 0.15) / 0.85; w.scrollTo(0, Math.round(max * e * e * (3 - 2 * e))); return new Promise((r) => requestAnimationFrame(() => r())); },
  settle: 60,
}));
