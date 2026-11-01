// Capture the artboards (or film frames) the design workflows render for each Made-with-Chucksi example.
const { chromium } = require('playwright');
const fs = require('fs');
const LIST = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../../public/data/showcase.json'), 'utf8'));
const only = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  for (const x of LIST) {
    if (only.length && !only.includes(x.id)) continue;
    const pg = await b.newPage({ viewport: { width: 1440, height: 1000 } });
    const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(`${process.env.BASE || 'http://localhost:8787'}/workflows?make=${x.workflow}&example=${x.id}`, { waitUntil: 'load' });
    await pg.waitForFunction(() => /^Ready|^Done/.test(document.querySelector('.maker-status')?.textContent || ''), null, { timeout: 120000 });
    await pg.waitForTimeout(800);
    const dir = 'design/' + x.id; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const film = await pg.$('.maker-film');
    if (film) {
      const info = await pg.evaluate(() => { const o = document.querySelector('.maker-player output').textContent; return o; });
      const total = parseFloat(info.split('/')[1]);
      const from = Math.min(5.5, total / 4), len = Math.min(7, total - from - 0.5);
      const n = Math.round(len * 24);
      for (let s = 0; s < n; s += 24) {
        const fr = await pg.evaluate(([from, s, e, total]) => {
          const scrub = document.querySelector('.maker-player input[type=range]'), c = document.querySelector('.maker-film'), out = [];
          for (let i = s; i < e; i++) { scrub.value = String(Math.round(((from + i / 24) / total) * 1000)); scrub.dispatchEvent(new Event('input')); out.push(c.toDataURL('image/jpeg', 0.9).split(',')[1]); }
          return out;
        }, [from, s, Math.min(n, s + 24), total]);
        fr.forEach((f, k) => fs.writeFileSync(`${dir}/f${String(s + k).padStart(4, '0')}.jpg`, Buffer.from(f, 'base64')));
      }
      console.log(x.id, 'film', n, total, errs.join('|'));
    } else {
      const boards = await pg.evaluate(() => [...document.querySelectorAll('.maker-board canvas')].map(c => {
        const k = Math.min(1, 1100 / Math.max(c.width, c.height)); const t = document.createElement('canvas');
        t.width = Math.round(c.width * k); t.height = Math.round(c.height * k); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
        return t.toDataURL('image/jpeg', 0.92).split(',')[1];
      }));
      boards.forEach((f, k) => fs.writeFileSync(`${dir}/b${k}.jpg`, Buffer.from(f, 'base64')));
      console.log(x.id, 'boards', boards.length, errs.join('|'));
    }
    await pg.close();
  }
  await b.close();
})();
