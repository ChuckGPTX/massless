"""Games (Build > Games) test: gallery -> play -> remix -> export on desktop and phone, every gallery game under its bot, every template's playtest on
20 random seeds, sanitizeRecipe against fuzzed junk, Generate with a mocked /api/game (good, bad JSON, 500),
AI art through a mocked /api/shot (keyed sprite, cached on replay), the share link round trip, and the
downloaded HTML playing from file:// with the network off.
python3 tests/games_test.py [out_dir]   (screenshots: tests/out/games/)"""
import http.server, threading, socketserver, os, sys, functools, json, base64, io, time
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'out', 'games')
os.makedirs(OUT, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/image', '/video', '/audio', '/3d', '/film', '/office', '/games', '/build', '/library'): p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)

    def log_message(self, *a): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT))
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{port}'
GAMES = f'{BASE}/build/?template=game'
ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required']

res = {}
checks = {}
errors = []


def check(name, ok, detail=None):
    checks[name] = bool(ok)
    if detail is not None: res[name] = detail
    print(('PASS ' if ok else 'FAIL ') + name, '' if detail is None else json.dumps(detail)[:300], flush=True)


def watch(pg, label):
    pg.on('pageerror', lambda e: errors.append(f'{label}: {e}'))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(f'{label}: {m.text[:200]}'))
    # a static server has no Worker: /api/* answers 404/501 by design; anything else missing is a bug
    pg.on('response', lambda r: r.status >= 400 and '/api/' not in r.url and errors.append(f'{label}: {r.status} {r.url}'))


def sprite_png():
    """A test sprite on a flat chroma background, the way /api/shot is asked to paint one."""
    im = Image.new('RGB', (1024, 1024), (0, 177, 64))
    d = ImageDraw.Draw(im)
    d.ellipse((330, 260, 700, 760), fill=(230, 60, 60), outline=(20, 20, 20), width=14)
    d.rectangle((440, 420, 590, 520), fill=(40, 90, 230))
    b = io.BytesIO()
    im.save(b, 'PNG')
    return b.getvalue()


GOOD = {'recipe': {
    'title': 'Mock Moon Run', 'genre': 'runner', 'dims': '2d', 'theme': 'A robot runs across the moon, hopping craters.', 'palette': 'moon', 'seed': 777,
    'player': {'name': 'Bolt', 'desc': 'a small silver robot', 'shape': 'robot'}, 'enemy': {'name': 'Saucer', 'desc': 'a tiny saucer', 'shape': 'ufo'},
    'item': {'name': 'Star', 'desc': 'a star', 'shape': 'star'}, 'hazard': {'name': 'Rock', 'desc': 'a moon rock', 'shape': 'rock'},
    'world': {'desc': 'the lunar surface', 'scene': 'moon'},
    'tuning': {'speed': 330, 'accel': 3, 'maxSpeed': 640, 'gravity': 2600, 'jump': 980, 'gap': 1, 'coins': 0.7, 'pits': 0.4, 'flyers': 0.3, 'walkers': 0.3},
    'goal': 1500, 'text': {'start': 'Tap to jump.', 'win': 'Bolt made it!', 'lose': 'Bonk.'}, 'music': {'style': 'drive', 'bpm': 120},
}}

with sync_playwright() as p:
    b = p.chromium.launch(args=ARGS)

    # ---------- 1. the page, desktop and phone ----------
    for label, opts in [('desktop', dict(viewport={'width': 1440, 'height': 900})), ('phone', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))]:
        ctx = b.new_context(**opts)
        pg = ctx.new_page()
        watch(pg, label)
        pg.goto(GAMES, wait_until='domcontentloaded')
        pg.wait_for_function('window.massless && window.massless.openGallery', timeout=60000)
        pg.wait_for_timeout(1500)
        info = pg.evaluate("({ sw: document.documentElement.scrollWidth, iw: innerWidth, cards: document.querySelectorAll('.g-card').length, filters: document.querySelectorAll('#genre-filter button').length, tab: document.querySelector('.build-tabs a[aria-current=true]')?.textContent, websiteHidden: document.querySelector('#website-view').hidden })")
        pg.screenshot(path=f'{OUT}/games-{label}.png', timeout=60000)
        pg.screenshot(path=f'{OUT}/games-{label}-full.png', full_page=True, timeout=60000)
        want_w = 1440 if label == 'desktop' else 390
        check(f'page {label}: Build opens on Games, 12 cards, no horizontal overflow', info['cards'] == 12 and info['tab'] == 'Games' and info['websiteHidden'] and info['sw'] <= want_w and info['iw'] == want_w, info)
        if label == 'phone':
            pg.evaluate("massless.openGallery('star-hornets', { noMusic: true })")
            pg.wait_for_function("massless.current() && massless.current().galleryId === 'star-hornets'", timeout=60000)
            pg.evaluate("massless.current().mount.game.stop()")
            sw = pg.evaluate('document.documentElement.scrollWidth')
            fr = pg.evaluate("(() => { const r = massless.current().mount.frame.getBoundingClientRect(); return [r.left, r.right, r.width, r.height]; })()")
            pg.screenshot(path=f'{OUT}/games-phone-player.png', timeout=60000)
            check('phone player: game frame fits the screen', sw <= 390 and fr[0] >= 0 and fr[1] <= 390, {'scrollWidth': sw, 'frame': fr})
            # touch: a tap on the title screen's Play button starts the game, a drag steers the ship
            pg.evaluate("massless.current().mount.game.go()")
            pg.tap('.mg-ov [data-act="play"]', force=True)
            pg.wait_for_timeout(300)
            x0 = pg.evaluate('massless.current().mount.game.world.p.x')
            box = pg.evaluate("(() => { const r = massless.current().mount.frame.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.7]; })()")
            cdp = ctx.new_cdp_session(pg)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': box[0], 'y': box[1]}]})
            for k in range(1, 8):
                cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': box[0] - 12 * k, 'y': box[1]}]})
                pg.wait_for_timeout(40)
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
            pg.wait_for_timeout(300)
            x1 = pg.evaluate('massless.current().mount.game.world.p.x')
            st = pg.evaluate('massless.current().mount.game.state')
            check('touch: tap starts, drag steers', st == 'play' and x1 < x0 - 30, {'x0': round(x0), 'x1': round(x1), 'state': st})
            pg.evaluate('massless.closeGame()')
        ctx.close()

    # ---------- 1b. the whole flow: gallery -> play -> remix -> export, desktop and phone ----------
    for label, opts in [('1440', dict(viewport={'width': 1440, 'height': 900})), ('390', dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True))]:
        ctx = b.new_context(accept_downloads=True, **opts)
        pg = ctx.new_page()
        watch(pg, f'flow-{label}')
        width = opts['viewport']['width']
        widths = []
        snap = lambda name: (pg.evaluate("massless.current() && (massless.current().mount.game.stop(), massless.current().mount.game.render())"), widths.append(pg.evaluate('document.documentElement.scrollWidth')), pg.screenshot(path=f'{OUT}/flow-{label}-{name}.png', timeout=90000))
        pg.goto(GAMES, wait_until='domcontentloaded')
        pg.wait_for_function('window.massless && window.massless.openGallery', timeout=60000)
        pg.wait_for_timeout(800)
        snap('1-gallery')
        pg.locator('.g-card[data-id="dune-rover"] .g-play').scroll_into_view_if_needed()
        pg.click('.g-card[data-id="dune-rover"] .g-play')
        pg.wait_for_function("massless.current() && massless.current().galleryId === 'dune-rover'", timeout=60000)
        (pg.tap if label == '390' else pg.click)('.mg-ov [data-act="play"]', force=True)
        pg.wait_for_timeout(600)
        playing = pg.evaluate('massless.current().mount.game.state')
        before = pg.evaluate('massless.current().recipe.tuning.speed')
        snap('2-play')
        pg.evaluate('massless.current().mount.game.go()')
        if label == '390': pg.click('#pl-remix')
        pg.fill('#rx-title', 'My Mars Remix')
        pg.select_option('#rx-palette', 'candy')
        pg.click('.rx-diff [data-diff="1"]')
        pg.click('#rx-apply')
        pg.wait_for_function("massless.current() && massless.current().recipe.title === 'My Mars Remix'", timeout=60000)
        rx = pg.evaluate("({ title: massless.current().recipe.title, palette: massless.current().recipe.palette, speed: massless.current().recipe.tuning.speed, source: massless.current().source, tested: !document.querySelector('#pl-tested').hidden })")
        snap('3-remix')
        with pg.expect_download(timeout=180000) as d:
            pg.click('#pl-download')
        path = os.path.join(OUT, f'flow-{label}-{d.value.suggested_filename}')
        d.value.save_as(path)
        html = open(path, encoding='utf-8').read()
        pg.wait_for_timeout(800)
        lib = pg.evaluate("async () => (await (await import('/js/store.js')).all()).filter((x) => x.engine === 'games' && x.blob).map((x) => ({ name: x.name, type: x.blob.type, size: x.blob.size }))")
        snap('4-exported')
        ok = playing == 'play' and rx['speed'] > before and rx['palette'] == 'candy' and rx['source'] == 'remix' and rx['tested'] and 'My Mars Remix' in html and 'MIT License' in html and any(x['name'] == 'My Mars Remix' for x in lib) and max(widths) <= width
        check(f'flow {label}: gallery -> play -> remix -> export, saved to My library, no sideways scroll', ok, {'playing': playing, 'speed': [before, rx['speed']], 'remix': rx, 'bytes': len(html), 'library': lib, 'scrollWidths': widths})
        ctx.close()

    # ---------- 2. every gallery game under its bot; keyboard input; fps ----------
    # (a fresh browser per section: software WebGL on a small machine runs out of room otherwise)
    def fresh(label):
        global b, ctx, pg
        try: b.close()
        except Exception: pass
        b = p.chromium.launch(args=ARGS)
        ctx = b.new_context(viewport={'width': 1280, 'height': 900}, accept_downloads=True)
        pg = ctx.new_page()
        watch(pg, label)
        pg.goto(GAMES, wait_until='domcontentloaded')
        pg.wait_for_function('window.massless && window.massless.openGallery', timeout=60000)
    fresh('games')
    ids = pg.evaluate('massless.GALLERY.map(g => g.id)')
    runs = {}
    frames = []
    crashes = []
    def run_game(gid):
        return pg.evaluate("""async (id) => {
          const m = await massless.openGallery(id, { bot: true, autostart: true, noMusic: true });
          const g = m.game;
          await new Promise((r) => setTimeout(r, 1200));
          const fps = g.fps;
          g.stop();
          const s0 = g.score;
          let t0 = performance.now();
          g.advance(20, { draw: true });
          const ms = (performance.now() - t0) / (20 * 60);
          const c = document.createElement('canvas'); c.width = 270; c.height = 480;
          const x = c.getContext('2d'); g.render(); for (const cv of m.frame.querySelectorAll('canvas')) x.drawImage(cv, 0, 0, 270, 480);
          const out = { s0, s1: g.score, state: g.state, t: +g.time.toFixed(1), fps, msPerStepAndHalfRender: +ms.toFixed(3), tested: !document.querySelector('#pl-tested').hidden, frame: c.toDataURL('image/jpeg', 0.8) };
          massless.closeGame();
          return out;
        }""", gid)
    for gid in ids:
        print('  game', gid, flush=True)
        try:
            r = run_game(gid)
        except Exception as e:
            # headless software WebGL on this small shared machine sometimes kills the renderer; retry once in a new browser
            if 'crashed' not in str(e) and 'closed' not in str(e): raise
            crashes.append(gid)
            print('renderer crashed during', gid, '- retrying in a fresh browser', flush=True)
            fresh('games')
            r = run_game(gid)
        frames.append(Image.open(io.BytesIO(base64.b64decode(r.pop('frame').split(',')[1]))))
        runs[gid] = r
    sheet = Image.new('RGB', (6 * 270, 2 * 480))
    for i, f in enumerate(frames): sheet.paste(f.convert('RGB'), ((i % 6) * 270, (i // 6) * 480))
    sheet.save(f'{OUT}/games-frames.jpg', quality=82)
    check('every gallery game runs 20 s under its bot, score changes, playtested', all(r['s1'] != r['s0'] and r['state'] in ('play', 'win') and r['tested'] for r in runs.values()), {**runs, 'rendererCrashesRetried': crashes})

    pg.evaluate("massless.openGallery('dune-rover', { noMusic: true })")
    pg.wait_for_function("massless.current() && massless.current().galleryId === 'dune-rover'", timeout=60000)
    pg.wait_for_timeout(300)
    pg.keyboard.press('Space')
    pg.wait_for_timeout(250)
    k1 = pg.evaluate('massless.current().mount.game.state')
    pg.keyboard.down('Space')
    pg.wait_for_timeout(120)
    vy = pg.evaluate('massless.current().mount.game.world.p.vy')
    pg.keyboard.up('Space')
    pg.keyboard.press('p')
    k2 = pg.evaluate('massless.current().mount.game.state')
    check('keyboard: Space starts and jumps, P pauses', k1 == 'play' and vy < 0 and k2 == 'paused', {'start': k1, 'vy': round(vy), 'afterP': k2})
    pg.evaluate('massless.closeGame()')

    # ---------- 3. playtests: every template, 20 random seeds ----------
    fresh('playtest')
    t = time.time()
    pt = pg.evaluate("""async () => {
      const { loadTemplate } = await import('/js/games/index.js');
      const { templateRecipe } = await import('/js/games/recipe.js');
      const prompts = { runner: ['a fox hopping puddles in the rain', 'a robot dashing over neon rooftops', 'easy cat run for kids', 'insane fast penguin on ice'],
        stack: ['stack donuts as high as you can', 'build a 3d skyscraper'], shooter: ['a bee shooting pollen at wasps', 'hard space invaders'],
        match: ['match three with fruit in a jungle', 'gem puzzle'], maze: ['a ghost escaping a haunted maze', 'a knight collecting keys in a dungeon, hard'],
        eatgrow: ['a hungry shark in the reef', 'a slime that eats everything in a cave'] };
      const out = {};
      for (const [genre, ps] of Object.entries(prompts)) {
        const tpl = await loadTemplate(genre);
        const r = { pass: 0, fail: [], ms: 0 };
        for (let i = 0; i < 20; i++) {
          const seed = Math.floor(Math.random() * 2e9);
          const rec = templateRecipe(ps[i % ps.length], genre, { seed, dims: genre === 'stack' && i % 2 ? '3d' : '2d' });
          const t0 = performance.now();
          const x = tpl.playtest(rec);
          r.ms += performance.now() - t0;
          if (x.ok) r.pass++; else r.fail.push(`${seed}: ${x.notes.join(' | ')}`);
        }
        r.ms = Math.round(r.ms / 20);
        out[genre] = r;
      }
      return out;
    }""")
    check('playtest: all six templates pass on 20 random seeds each', all(v['pass'] == 20 for v in pt.values()), {**pt, 'seconds': round(time.time() - t, 1)})

    # ---------- 4. sanitizeRecipe against fuzzed junk ----------
    fz = pg.evaluate("""async () => {
      const { sanitizeRecipe, templateRecipe, TUNING, GENRES } = await import('/js/games/recipe.js');
      const { PALETTES, SCENES } = await import('/js/games/art.js');
      const { loadTemplate } = await import('/js/games/index.js');
      const { Game } = await import('/js/games/engine.js');
      let s = 12345; const R = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
      const junk = (d = 0) => {
        const k = Math.floor(R() * 12);
        if (d > 3) return R();
        return [null, undefined, NaN, Infinity, -1e308, R() * 1e9 - 5e8, 'x'.repeat(Math.floor(R() * 5000)), '<script>alert(1)</script>', [junk(d + 1), junk(d + 1)],
          Object.fromEntries(['title', 'genre', 'tuning', 'player', 'art', 'music', 'goal', 'seed', 'palette', '__proto__', 'constructor', 'speed', 'text', 'world', 'dims'].map((key) => [key, junk(d + 1)])),
          { genre: ['runner', 'stack', 'shooter', 'match', 'maze', 'eatgrow', 'chess'][Math.floor(R() * 7)], tuning: { speed: '9999', kinds: -5, size: 'big', lives: 1e9 }, art: { player: 'https://evil.example/x.png', bg: ['javascript:alert(1)', '/media/games/../../etc'], enemy: { src: '/media/games/a.png', cw: 1e9, ch: -4, anims: { walk: [1, 2, 'x'], '__proto__': [1] } } }, music: { style: 'metal', bpm: 9000 }, seed: -7 },
          JSON.stringify({ title: 'From a string', genre: 'maze' })][k];
      };
      const fb = templateRecipe('a fox', 'runner');
      let bad = [];
      const outs = [];
      for (let i = 0; i < 600; i++) {
        let out;
        try { out = sanitizeRecipe(junk(), fb); } catch (e) { bad.push('throw ' + e.message); continue; }
        const G = GENRES[out.genre];
        if (!G) { bad.push('genre ' + out.genre); continue; }
        if (!PALETTES[out.palette]) bad.push('palette');
        if (!SCENES.includes(out.world.scene)) bad.push('scene');
        if (typeof out.title !== 'string' || out.title.length > 40 || out.title.length < 2 || /[<>]/.test(out.title)) bad.push('title ' + out.title);
        if (out.theme.length > 160) bad.push('theme');
        for (const [k, [lo, hi]] of Object.entries(TUNING[out.genre])) if (!(out.tuning[k] >= lo && out.tuning[k] <= hi)) bad.push(`tuning ${k}=${out.tuning[k]}`);
        if (Object.keys(out.tuning).some((k) => !(k in TUNING[out.genre]))) bad.push('extra tuning key');
        if (!(out.goal >= G.goal[0] && out.goal <= G.goal[1])) bad.push('goal');
        if (!(out.music.bpm >= 80 && out.music.bpm <= 170)) bad.push('bpm');
        if (!(Number.isInteger(out.seed) && out.seed >= 0)) bad.push('seed');
        const urls = JSON.stringify(out.art);
        if (/evil|javascript|\\.\\./.test(urls)) bad.push('art url ' + urls);
        if (!G.dims.includes(out.dims)) bad.push('dims');
        outs.push(out);
      }
      const polluted = ({}).speed !== undefined || ({}).title !== undefined || Object.prototype.walk !== undefined;
      // a handful of the survivors must actually play
      let played = 0;
      for (const out of outs.filter((_, i) => i % 40 === 0)) {
        const tpl = await loadTemplate(out.genre);
        const g = new Game({ template: { create: tpl.create, bot: tpl.bot }, recipe: out, headless: true, bot: true });
        g.start(); g.advance(4); played++;
      }
      return { inputs: 600, problems: bad.slice(0, 10), nProblems: bad.length, polluted, played, sameObjectForJunk: sanitizeRecipe(null, fb) === fb };
    }""")
    check('sanitizeRecipe survives fuzzed junk (600 inputs, ranges, whitelist, no pollution)', fz['nProblems'] == 0 and not fz['polluted'] and fz['played'] > 5 and fz['sameObjectForJunk'], fz)

    # ---------- 5. Generate: mocked /api/game ----------
    fresh('generate')
    def generate(prompt, handler, ai=False):
        calls = []
        def route(r):
            if r.request.method == 'POST': calls.append(json.loads(r.request.post_data or '{}'))
            handler(r)
        pg.route('**/api/game', route)
        pg.fill('#prompt', prompt)
        pg.evaluate("(on) => { document.querySelector('#ai-art').checked = on; }", ai)
        pg.evaluate("document.querySelector('#toast') && (document.querySelector('#toast').textContent = '')")
        pg.click('#generate')
        pg.wait_for_function("massless.current() && !massless.state.busy", timeout=180000)
        pg.unroute('**/api/game')
        out = pg.evaluate("""() => ({ title: massless.current().recipe.title, genre: massless.current().recipe.genre, made: [...document.querySelectorAll('#pl-side dd')][0]?.textContent,
          tested: !document.querySelector('#pl-tested').hidden, toast: document.querySelector('#toast')?.textContent || '', images: Object.keys(massless.current().images) })""")
        out['calls'] = calls
        return out

    good = generate('a robot running on the moon', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(GOOD)))
    check('generate: good JSON from /api/game is used', good['title'] == 'Mock Moon Run' and good['made'] == 'Recipe by Llama 3.3' and good['tested'] and good['calls'] and good['calls'][0].get('prompt') == 'a robot running on the moon' and good['calls'][0].get('genre') == 'auto' and 'dims' in good['calls'][0], good)
    good_recipe = pg.evaluate('massless.current().recipe')
    pg.screenshot(path=f'{OUT}/games-generated.png', timeout=60000)
    pg.evaluate('massless.closeGame()')
    expect = pg.evaluate("async () => (await import('/js/games/recipe.js')).templateRecipe('a ghost escaping a haunted maze', 'auto').title")
    badj = generate('a ghost escaping a haunted maze', lambda r: r.fulfill(status=200, content_type='application/json', body='{"recipe": {"title": "Broken'))
    check('generate: bad JSON falls back to the built-in recipe with a toast', badj['title'] == expect and badj['genre'] == 'maze' and 'built-in recipe' in badj['toast'] and badj['tested'], badj)
    pg.evaluate('massless.closeGame()')
    e500 = generate('a ghost escaping a haunted maze', lambda r: r.fulfill(status=500, content_type='application/json', body=json.dumps({'error': 'model down'})))
    check('generate: HTTP 500 falls back with a toast', e500['title'] == expect and 'model down' in e500['toast'], e500)
    pg.evaluate('massless.closeGame()')

    # ---------- 6. AI art: mocked /api/shot, keyed in the browser, cached on replay ----------
    png = sprite_png()
    shots = []
    def shot(r):
        shots.append(json.loads(r.request.post_data or '{}'))
        r.fulfill(status=200, content_type='image/png', body=png, headers={'x-massless-model': '@cf/black-forest-labs/flux-1-schnell'})
    pg.route('**/api/shot', shot)
    art1 = generate('a robot running on the moon', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(GOOD)), ai=True)
    keyed = pg.evaluate("""() => {
      const im = massless.current().images.player;
      const c = document.createElement('canvas'); c.width = im.naturalWidth || im.width; c.height = im.naturalHeight || im.height;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      const a = (px, py) => x.getImageData(Math.floor(px * (c.width - 1)), Math.floor(py * (c.height - 1)), 1, 1).data;
      const corner = a(0, 0)[3], centre = a(0.5, 0.5);
      let green = 0, n = 0;
      const d = x.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 16) { if (d[i + 3] > 200) { n++; if (d[i + 1] > 150 && d[i] < 80 && d[i + 2] < 120) green++; } }
      return { w: c.width, h: c.height, cornerAlpha: corner, centre: [...centre], greenLeft: +(green / Math.max(1, n)).toFixed(3), bg: !!massless.current().images.bg };
    }""")
    n_first = len(shots)
    pg.evaluate('massless.closeGame()')
    art2 = generate('a robot running on the moon', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(GOOD)), ai=True)
    n_second = len(shots) - n_first
    pg.unroute('**/api/shot')
    check('AI art: /api/shot sprite on a flat background gets keyed; replay is cached', n_first >= 2 and keyed['cornerAlpha'] == 0 and keyed['centre'][3] == 255 and keyed['greenLeft'] < 0.01 and keyed['w'] < 512 and n_second == 0 and 'player' in art2['images'],
          {'shotsFirst': n_first, 'shotsReplay': n_second, 'keyed': keyed, 'prompt': shots[0].get('prompt', '')[:120] if shots else '', 'images': art1['images']})
    pg.screenshot(path=f'{OUT}/games-ai-art.png', timeout=60000)
    pg.evaluate('massless.closeGame()')

    # ---------- 7. share link round trip ----------
    code = pg.evaluate('(r) => massless.encodeRecipe(r)', good_recipe)
    link = f'{BASE}/games#g={code}'  # the friendly address forwards to Build, keeping the hash
    pg2 = ctx.new_page()
    watch(pg2, 'share')
    pg2.goto(link, wait_until='domcontentloaded')
    pg2.wait_for_function('window.massless && massless.current && massless.current()', timeout=60000)
    back = pg2.evaluate('massless.current().recipe')
    same = json.dumps(back, sort_keys=True) == json.dumps(good_recipe, sort_keys=True)
    pg2.goto(f'{BASE}/games#play=crystal-caves', wait_until='domcontentloaded')
    pg2.wait_for_url('**/build/?template=game#play=crystal-caves', timeout=60000)
    pg2.wait_for_function('window.massless && massless.current && massless.current() && massless.current().galleryId', timeout=60000)
    gid = pg2.evaluate('massless.current().galleryId')
    pg2.close()
    check('share: #g= link reopens the same recipe; #play= opens a gallery game', same and gid == 'crystal-caves' and code.startswith('z') and len(link) < 2000, {'linkLength': len(link), 'same': same, 'gallery': gid})

    # ---------- 8. download: one HTML file that plays from file:// with no network ----------
    fresh('download')
    dl = {}
    for gid in ['t1-street-run', 'sky-tower']:
        pg.evaluate(f"massless.openGallery('{gid}', {{ noMusic: true }})")
        pg.wait_for_function(f"massless.current() && massless.current().galleryId === '{gid}'", timeout=60000)
        with pg.expect_download(timeout=180000) as d:
            pg.click('#pl-download')
        path = os.path.join(OUT, d.value.suggested_filename)
        d.value.save_as(path)
        pg.evaluate('massless.closeGame()')
        off = b.new_context(viewport={'width': 600, 'height': 900})
        net = []
        off.route('**/*', lambda r: (net.append(r.request.url), r.abort()) if not r.request.url.startswith(('file:', 'data:', 'blob:')) else r.continue_())
        op = off.new_page()
        local_err = []
        op.on('pageerror', lambda e: local_err.append(str(e)))
        op.on('console', lambda m: m.type == 'error' and local_err.append(m.text[:200]))
        op.goto('file://' + os.path.abspath(path), wait_until='domcontentloaded')
        op.wait_for_function('window.massless && window.massless.mount', timeout=120000)
        r = op.evaluate("""async () => {
          const m = massless.mount; const g = m.game;
          document.querySelector('.mg-ov [data-act="play"]').click();
          g.botOn = true; g.stop();
          g.advance(12, { draw: true });
          const imgs = [...document.querySelectorAll('canvas')].length;
          return { state: g.state, score: g.score, title: massless.recipe.title, canvases: imgs, artInline: JSON.stringify(massless.recipe.art).includes('data:image') || massless.recipe.art.mode === 'procedural' };
        }""")
        op.screenshot(path=f'{OUT}/games-download-{gid}.png', timeout=60000)
        off.close()
        size = os.path.getsize(path)
        head = open(path, encoding='utf-8').read(400)
        dl[gid] = {**r, 'bytes': size, 'network': net[:3], 'errors': local_err[:3], 'mitHeader': 'MIT License' in head}
    check('download: the .html plays from file:// with the network blocked', all(v['score'] > 0 and v['state'] in ('play', 'win') and not v['network'] and not v['errors'] and v['mitHeader'] and v['artInline'] for v in dl.values()), dl)
    ctx.close()
    b.close()

print(json.dumps({k: v for k, v in res.items() if k.startswith('playtest')}, indent=1)[:2000])
print('errors:', errors)
failed = [k for k, v in checks.items() if not v]
print(f'{len(checks) - len(failed)}/{len(checks)} checks passed', 'FAILED: ' + ', '.join(failed) if failed else '')
sys.exit(1 if failed or errors else 0)
