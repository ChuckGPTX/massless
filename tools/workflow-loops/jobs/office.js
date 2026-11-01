const pageRect = async (pg) => { const r = await pg.$eval('#pages > .pg', (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.floor(b.width / 2) * 2 }; }); return { ...r, h: Math.floor((r.w * 9) / 16 / 2) * 2 }; };
let P = null;
module.exports = [
  {
    id: 'office-annotate', url: '/office?sample=1', vw: 1280, vh: 900, dur: 5,
    prep: async (pg) => { await pg.waitForSelector('#pages canvas', { timeout: 60000 }); await pg.waitForTimeout(2500); P = await pageRect(pg); await pg.mouse.move(2, 2); },
    rect: async () => P,
    step: async (pg, t, i) => {
      const at = (x, y) => [P.x + x, P.y + y];
      if (i === 8) { await pg.click('#tool-buttons button[data-tool="highlight"]'); await pg.mouse.move(...at(72, 309)); await pg.mouse.down(); }
      if (i > 8 && i <= 32) await pg.mouse.move(...at(72 + (296 * (i - 8)) / 24, 336));
      if (i === 33) await pg.mouse.up();
      if (i === 38) { await pg.click('#tool-buttons button[data-tool="draw"]'); await pg.mouse.move(...at(330, 393)); await pg.mouse.down(); }
      if (i > 38 && i <= 70) { const a = ((i - 38) / 32) * Math.PI * 2.1; await pg.mouse.move(...at(290 + 48 * Math.cos(a), 393 - 22 * Math.sin(a))); }
      if (i === 71) await pg.mouse.up();
      if (i === 76) { await pg.click('#tool-buttons button[data-tool="text"]'); await pg.mouse.click(...at(540, 140)); }
      const words = 'Ready to send.';
      if (i > 78 && i <= 78 + words.length * 2 && (i - 78) % 2 === 0) await pg.keyboard.type(words[(i - 78) / 2 - 1]);
      if (i === 78 + words.length * 2 + 2) await pg.mouse.move(2, 2);
      await pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    },
  },
  {
    id: 'office-sign', url: '/office?tab=sign', vw: 1280, vh: 800, dur: 5.5,
    prep: async (pg) => { await pg.waitForTimeout(2500); await pg.getByText('Use template').first().click(); await pg.waitForTimeout(3500); await pg.mouse.move(2, 2); },
    rect: async () => ({ x: 0, y: 60, w: 1280, h: 720 }),
    step: async (pg, t, i) => {
      const name = 'Jordan Avery', addr = '14 Harbour Row, Old Town';
      if (i === 6) await pg.getByPlaceholder('Full legal name').first().click();
      if (i > 6 && i <= 6 + name.length * 2 && (i - 6) % 2 === 0) await pg.keyboard.type(name[(i - 6) / 2 - 1]);
      const s = 6 + name.length * 2 + 6;
      if (i === s) await pg.keyboard.press('Tab');
      if (i > s && i <= s + addr.length * 2 && (i - s) % 2 === 0) await pg.keyboard.type(addr[(i - s) / 2 - 1]);
      await pg.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    },
  },
  {
    id: 'office-templates', url: '/office?tab=sign', vw: 1280, vh: 800, dur: 5,
    prep: async (pg) => { await pg.waitForTimeout(3000); await pg.mouse.move(2, 2); },
    rect: async () => ({ x: 0, y: 60, w: 1280, h: 720 }),
    frame: ([t]) => { const sc = [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 400 && getComputedStyle(e).overflowY !== 'visible' && e.closest('main')) || document.scrollingElement; const e = t < 0.1 ? 0 : (t - 0.1) / 0.9; sc.scrollTop = 900 * e * e * (3 - 2 * e); return new Promise((r) => requestAnimationFrame(() => r())); },
  },
];
