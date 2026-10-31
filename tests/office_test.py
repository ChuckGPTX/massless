"""Office page end-to-end check in headless Chromium: the PDF editor, every Convert operation and Ask.

Serves public/ on a random port (with /office mapped to office/index.html and a fake /api/ask),
builds its own inputs (PDFs with reportlab + pypdf, images with PIL), drives the real UI and checks
every output independently in Python with pypdf / zipfile / PIL. Fails on page errors, failed
requests and console errors. Writes screenshots and outputs to --out (default tests/out/office).

  python3 tests/office_test.py [--out DIR] [--no-shots]
"""
import argparse, base64, functools, http.server, io, json, os, socketserver, sys, threading, time, zipfile
from playwright.sync_api import sync_playwright
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream
from PIL import Image
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas as rl_canvas

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'public')
ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(HERE, 'out', 'office'))
ap.add_argument('--no-shots', action='store_true')
args = ap.parse_args()
OUT = os.path.abspath(args.out)
IN = os.path.join(OUT, 'inputs')
os.makedirs(IN, exist_ok=True)

# ---------- fake API ----------
ASK = {'mode': '404', 'bodies': []}


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        p = path.split('?')[0].split('#')[0]
        if p.rstrip('/') in ('/image', '/video', '/audio', '/3d', '/film', '/office'):
            p = p.rstrip('/') + '/index.html'
        return super().translate_path(p)

    def log_message(self, *a):
        pass

    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n)
        if self.path != '/api/ask' or ASK['mode'] == '404':
            return self.reply(404, {'error': 'Not found'})
        ASK['bodies'].append(json.loads(body))
        if ASK['mode'] == '429':
            return self.reply(429, {'error': 'The free daily limit for Ask is used up. It resets at midnight UTC.'})
        q = ASK['bodies'][-1]['question']
        return self.reply(200, {'answer': f'Mock answer to: {q}', 'model': '@cf/meta/llama-3.3-70b-instruct-fp8-fast'})

    def reply(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Handler, directory=ROOT))
port = httpd.server_address[1]
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{port}'


# ---------- inputs ----------
def make_pdf(path, label, n, rotate=None):
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=letter)
    for i in range(1, n + 1):
        c.setFont('Helvetica-Bold', 26)
        c.drawString(72, 700, f'Chucksi {label} page {i}')
        c.setFont('Helvetica', 13)
        for k in range(12):
            c.drawString(72, 660 - k * 22, f'Line {k + 1} of sample text on page {i} for the Office test.')
        c.showPage()
    c.save()
    r = PdfReader(io.BytesIO(buf.getvalue()))
    w = PdfWriter()
    for i, p in enumerate(r.pages):
        if rotate and (i + 1) in rotate:
            p.rotate(rotate[i + 1])
        w.add_page(p)
    with open(path, 'wb') as f:
        w.write(f)
    return path


DOC3 = make_pdf(os.path.join(IN, 'doc3.pdf'), 'doc3', 3, rotate={2: 90})
DOC2 = make_pdf(os.path.join(IN, 'doc2.pdf'), 'doc2', 2)
IMGS = []
for name, size, color, fmt in (('red.png', (400, 300), (220, 40, 40), 'PNG'), ('blue.png', (300, 500), (40, 80, 220), 'PNG'), ('green.webp', (320, 240), (40, 200, 90), 'WEBP')):
    im = Image.new('RGB', size, color)
    for x in range(0, size[0], 40):
        for y in range(size[1]):
            im.putpixel((x, y), (255, 255, 255))
    IMGS.append(os.path.join(IN, name))
    im.save(IMGS[-1], fmt)

TO_B64 = """async (blob) => {
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}"""

results, failures, errors, failed_requests = {}, [], [], []


def check(name, cond, detail=None):
    results[name] = {'ok': bool(cond), **({'detail': detail} if detail is not None else {})}
    if not cond:
        failures.append(name)
    return cond


def approx(a, b, tol=1.5):
    return abs(a - b) <= tol


def page_ops(page):
    return ContentStream(page.get_contents(), page.pdf).operations


def rects(page):
    """(x, y, w, h) for every pdf-lib drawRectangle: 'cm' translate, then m 0 0, l 0 h, l w h, l w 0."""
    ops = page_ops(page)
    out = []
    for i, (operands, op) in enumerate(ops):
        if op == b'cm' and [float(v) for v in operands[:4]] == [1, 0, 0, 1]:
            ls = [o for o, k in ops[i + 1:i + 8] if k == b'l']
            if len(ls) >= 2:
                out.append((float(operands[4]), float(operands[5]), float(ls[1][0]), float(ls[1][1])))
    return out


def ui_result_bytes(pg, idx=0):
    return base64.b64decode(pg.evaluate(f'async () => ({TO_B64})(massless.live.results[{idx}].blob)'))


def run_convert(pg, op, files, setup=None):
    pg.click(f'.op[data-op="{op}"]')
    if pg.locator('#queue-clear').is_visible():
        pg.click('#queue-clear')
    pg.set_input_files('#conv-in', files)
    if setup:
        setup()
    n = pg.locator('.rcard').count()
    pg.click('#convert')
    pg.wait_for_function(f"document.querySelectorAll('.rcard').length > {n} && !massless.live.busy", timeout=120000)
    r = pg.evaluate('({ name: massless.live.results[0].name, size: massless.live.results[0].size, meta: massless.live.results[0].meta })')
    data = ui_result_bytes(pg)
    with open(os.path.join(OUT, r['name']), 'wb') as f:
        f.write(data)
    return r, data


def page_box(pg, page, fy=0.5):
    """Scroll the stage so the point at fraction fy of the page is on screen, then return the page's overlay box."""
    x, y, w, h = pg.evaluate("""([page, fy]) => {
      const ov = document.querySelector(`.pg[data-page="${page}"] .ov`);
      let r = ov.getBoundingClientRect();
      const y = r.top + r.height * fy;
      if (y < 160 || y > innerHeight - 80) { document.querySelector('.stage').scrollBy(0, y - innerHeight / 2); r = ov.getBoundingClientRect(); }
      return [r.left, r.top, r.width, r.height];
    }""", [page, fy])
    return {'x': x, 'y': y, 'width': w, 'height': h}


def drag(pg, x0, y0, x1, y1, steps=12):
    pg.mouse.move(x0, y0)
    pg.mouse.down()
    pg.mouse.move(x1, y1, steps=steps)
    pg.mouse.up()


t_start = time.time()
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page()
    pg.set_default_timeout(60000)
    pg.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    pg.on('requestfailed', lambda r: failed_requests.append(f'{r.url[:160]} {r.failure}'))

    def on_console(m):
        if m.type != 'error':
            return
        if '/api/ask' in (m.location or {}).get('url', '') or ('status of 4' in m.text and ASK['mode'] in ('404', '429')):
            return  # the expected 404 / 429 from the fake Ask endpoint
        errors.append(f'console: {m.text[:300]}')
    pg.on('console', on_console)

    pg.goto(f'{BASE}/office', wait_until='domcontentloaded')
    pg.wait_for_function('window.massless && window.massless.live')
    check('shell_renders_without_libraries', pg.evaluate("!!document.querySelector('#edit-drop') && document.querySelector('h1').textContent.includes('Edit')"))
    check('nav_office_current', pg.get_attribute('.nav-links a[aria-current="page"]', 'href') == '/office')

    # ---------- libraries load from jsDelivr ----------
    libs = pg.evaluate("""async () => {
      const L = massless.T.LIBS;
      const lib = await import(L.pdfLib), js = await import(L.pdfjs), ff = await import(L.fflate);
      const w = await fetch(L.pdfjsWorker);
      return { urls: L, pdfLib: ['PDFDocument', 'StandardFonts', 'rgb', 'degrees'].every((k) => k in lib),
        pdfjs: ['getDocument', 'GlobalWorkerOptions'].every((k) => k in js), pdfjsVersion: js.version,
        fflate: typeof ff.zipSync === 'function', worker: w.ok && (w.headers.get('content-type') || '').includes('javascript') };
    }""")
    check('libraries_load', libs['pdfLib'] and libs['pdfjs'] and libs['fflate'] and libs['worker'], libs)

    # ================= Edit =================
    pg.set_input_files('#pdf-in', DOC3)
    pg.wait_for_function("massless.live.doc && massless.live.doc.pages.length === 3 && massless.live.doc.pages[0].rz > 0", timeout=90000)
    check('edit_opens_pdf', pg.inner_text('#doc-name') == 'doc3.pdf' and pg.locator('.pg').count() == 3, pg.inner_text('#src-label'))
    z = pg.evaluate('massless.live.zoom')
    box0 = pg.locator('.pg[data-page="0"] .ov').bounding_box()
    W, H = box0['width'], box0['height']
    check('page_size_matches_zoom', approx(W, 612 * z, 1) and approx(H, 792 * z, 1), {'zoom': z, 'w': W, 'h': H})

    def at(box, fx, fy):
        return box['x'] + box['width'] * fx, box['y'] + box['height'] * fy

    # highlight on page 1
    pg.click('[data-tool="highlight"]')
    box0 = page_box(pg, 0, 0.12)
    (hx0, hy0), (hx1, hy1) = at(box0, 0.1, 0.1), at(box0, 0.45, 0.14)
    drag(pg, hx0, hy0, hx1, hy1)
    exp_hl1 = ((hx0 - box0['x']) / z, 792 - (hy1 - box0['y']) / z, (hx1 - hx0) / z, (hy1 - hy0) / z)
    # text on page 1
    pg.click('[data-tool="text"]')
    box0 = page_box(pg, 0, 0.45)
    pg.mouse.click(*at(box0, 0.15, 0.45))
    pg.keyboard.type('Hello from the test')
    pg.keyboard.press('Escape')
    # ink on page 1
    pg.click('[data-tool="draw"]')
    box0 = page_box(pg, 0, 0.6)
    pg.mouse.move(*at(box0, 0.2, 0.6))
    pg.mouse.down()
    for k in range(1, 15):
        pg.mouse.move(*at(box0, 0.2 + k * 0.02, 0.6 + (0.03 if k % 2 else -0.03)))
    pg.mouse.up()
    # note on page 1
    pg.click('[data-tool="note"]')
    box0 = page_box(pg, 0, 0.2)
    pg.mouse.click(*at(box0, 0.85, 0.2))
    pg.keyboard.type('Check this')
    pg.keyboard.press('Escape')
    types = pg.evaluate('massless.live.items.map((i) => i.type)')
    check('edit_adds_highlight_text_ink_note', types == ['highlight', 'text', 'ink', 'note'], types)
    check('text_item_value', pg.evaluate("massless.live.items[1].text") == 'Hello from the test')

    # signature: dialog, draw, place on page 3, resize
    pg.click('[data-tool="sign"]')
    pg.wait_for_selector('#sig[open]')
    pad = pg.locator('#sig-pad').bounding_box()
    pg.mouse.move(pad['x'] + 40, pad['y'] + pad['height'] * 0.6)
    pg.mouse.down()
    for k in range(1, 30):
        pg.mouse.move(pad['x'] + 40 + k * 14, pad['y'] + pad['height'] * (0.6 + 0.2 * ((-1) ** k) * (k % 3) / 3))
    pg.mouse.up()
    pg.click('#sig-use')
    pg.wait_for_function("!document.querySelector('#sig').open && massless.live.tool === 'sign'")
    box2 = page_box(pg, 2, 0.5)
    pg.wait_for_function('massless.live.doc.pages[2].rz > 0')
    pg.mouse.click(*at(box2, 0.3, 0.5))
    sig0 = pg.evaluate("massless.live.items.at(-1)")
    rh = pg.locator('.it.sg .rh').bounding_box()
    drag(pg, rh['x'] + 7, rh['y'] + 7, rh['x'] + 7 + 60, rh['y'] + 7 + 10, steps=6)
    sig1 = pg.evaluate("massless.live.items.at(-1)")
    check('signature_placed_and_resized', sig0['type'] == 'sign' and sig0['page'] == 2 and sig1['w'] > sig0['w'] + 30 and approx(sig1['w'] / sig1['h'], sig0['w'] / sig0['h'], 0.01),
          {'before': [sig0['w'], sig0['h']], 'after': [sig1['w'], sig1['h']], 'tool_after_place': pg.evaluate('massless.live.tool')})

    # highlight on the rotated page 2 (/Rotate 90): screen (u, v) maps to PDF (x, y) = (v, u)
    box1 = page_box(pg, 1, 0.5)
    pg.wait_for_function('massless.live.doc.pages[1].rz > 0')
    check('rotated_page_is_landscape', approx(box1['width'], 792 * z, 1) and approx(box1['height'], 612 * z, 1), box1)
    pg.click('[data-tool="highlight"]')
    (rx0, ry0), (rx1, ry1) = at(box1, 0.2, 0.3), at(box1, 0.5, 0.4)
    drag(pg, rx0, ry0, rx1, ry1)
    u0, v0 = (rx0 - box1['x']) / z, (ry0 - box1['y']) / z
    exp_hl2 = (v0, u0, (ry1 - ry0) / z, (rx1 - rx0) / z)

    # undo / delete: add a throwaway highlight on page 2, select it, delete, undo, undo
    n0 = pg.evaluate('massless.live.items.length')
    box1 = page_box(pg, 1, 0.65)
    (tx0, ty0), (tx1, ty1) = at(box1, 0.6, 0.6), at(box1, 0.8, 0.7)
    drag(pg, tx0, ty0, tx1, ty1)
    n1 = pg.evaluate('massless.live.items.length')
    pg.click('[data-tool="select"]')
    pg.mouse.click((tx0 + tx1) / 2, (ty0 + ty1) / 2)
    selected = pg.evaluate('massless.live.sel === massless.live.items.at(-1).id')
    pg.click('#delete')
    n2 = pg.evaluate('massless.live.items.length')
    pg.click('#undo')
    n3 = pg.evaluate('massless.live.items.length')
    pg.click('#undo')
    n4 = pg.evaluate('massless.live.items.length')
    check('select_delete_undo', (n1, n2, n3, n4) == (n0 + 1, n0, n0 + 1, n0) and selected, {'counts': [n0, n1, n2, n3, n4], 'selected': selected})

    # move: drag the page-1 highlight by 20 px and back with undo
    box0 = page_box(pg, 0, 0.12)
    hl = pg.locator('.pg[data-page="0"] .it.hl').bounding_box()
    before_x = pg.evaluate('massless.live.items[0].x')
    drag(pg, hl['x'] + 10, hl['y'] + 5, hl['x'] + 30, hl['y'] + 5, steps=5)
    moved_x = pg.evaluate('massless.live.items[0].x')
    pg.click('#undo')
    check('move_and_undo', approx(moved_x - before_x, 20 / z, 0.5) and approx(pg.evaluate('massless.live.items[0].x'), before_x, 0.01), {'before': before_x, 'moved': moved_x})

    if not args.no_shots:
        pg.click('[data-tool="highlight"]')
        pg.evaluate("document.querySelector('.stage').scrollTo(0, 0)")
        pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(OUT, 'office-edit-1440.png'))

    # save via the real button and download
    with pg.expect_download() as dl:
        pg.click('#save')
    d = dl.value
    saved = os.path.join(OUT, d.suggested_filename)
    d.save_as(saved)
    check('save_filename', d.suggested_filename == 'doc3-edited.pdf', d.suggested_filename)
    orig = PdfReader(DOC3)
    r = PdfReader(saved)
    check('saved_page_count', len(r.pages) == 3, len(r.pages))
    check('saved_rotation_kept', [p.rotation for p in r.pages] == [0, 90, 0], [p.rotation for p in r.pages])
    grew = [len(r.pages[i].get_contents().get_data()) - len(orig.pages[i].get_contents().get_data()) for i in range(3)]
    check('content_streams_grew', grew[0] > 200 and grew[1] > 50 and grew[2] > 20, grew)
    t1 = r.pages[0].extract_text()
    check('saved_text_drawn', 'Hello from the test' in t1 and 'Chucksi doc3 page 1' in t1)
    r1 = rects(r.pages[0])
    check('highlight_coords_page1', any(all(approx(a, b) for a, b in zip(rc, exp_hl1)) for rc in r1), {'expected': [round(v, 1) for v in exp_hl1], 'found': [[round(v, 1) for v in rc] for rc in r1]})
    r2 = rects(r.pages[1])
    check('highlight_coords_rotated_page2', any(all(approx(a, b) for a, b in zip(rc, exp_hl2)) for rc in r2), {'expected': [round(v, 1) for v in exp_hl2], 'found': [[round(v, 1) for v in rc] for rc in r2]})
    gs = [g.get_object() for g in (r.pages[0]['/Resources'].get('/ExtGState') or {}).values()]
    check('highlight_translucent_multiply', any(float(g.get('/ca', 1)) < 0.5 and g.get('/BM') == '/Multiply' for g in gs), [dict(g) for g in gs])
    ink_ops = [op for _, op in page_ops(r.pages[0])]
    check('ink_stroked', b'S' in ink_ops and ink_ops.count(b'l') > 10)
    annots = [a.get_object() for a in (r.pages[0].get('/Annots') or [])]
    check('note_is_text_annotation', any(a.get('/Subtype') == '/Text' and a.get('/Contents') == 'Check this' for a in annots), [{k: str(v) for k, v in a.items()} for a in annots])
    xo = r.pages[2]['/Resources'].get('/XObject') or {}
    check('signature_embedded_png', any(v.get_object().get('/Subtype') == '/Image' and v.get_object().get('/SMask') is not None for v in xo.values()), list(xo.keys()))

    # reopen the saved file in pdf.js (the same engine the page uses) and in the editor
    with open(saved, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()
    re_open = pg.evaluate("""async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const pdf = await massless.T.openPdfjs(bytes);
      const a = await (await pdf.getPage(1)).getAnnotations();
      const n = pdf.numPages; massless.T.closePdf(pdf);
      const ok = await massless.openBytes('doc3-edited.pdf', bytes);
      return { n, annots: a.map((x) => x.subtype), ok, pages: massless.live.doc.pages.length };
    }""", b64)
    pg.wait_for_function('massless.live.doc.pages[0].rz > 0')
    check('saved_reopens_in_pdfjs', re_open['n'] == 3 and 'Text' in re_open['annots'] and re_open['ok'] and re_open['pages'] == 3, re_open)

    # ================= Convert =================
    pg.click('#t-convert')
    # images to PDF, with reorder (move blue to the top)
    def reorder():
        pg.click('.qrow:nth-child(2) button[title="Move up"]')
    info, data = run_convert(pg, 'images', IMGS, reorder)
    rr = PdfReader(io.BytesIO(data))
    sizes = [(round(float(p.mediabox.width)), round(float(p.mediabox.height))) for p in rr.pages]
    check('images_to_pdf', sizes == [(300, 500), (400, 300), (320, 240)], {'sizes': sizes, **info})

    # PDF to images (PNG, 1x) -> zip with one PNG per page
    def png1x():
        pg.select_option('#img-format', 'png')
        pg.select_option('#img-scale', '1')
    info, data = run_convert(pg, 'toimg', [DOC3], png1x)
    zf = zipfile.ZipFile(io.BytesIO(data))
    dims = [Image.open(io.BytesIO(zf.read(n))).size for n in sorted(zf.namelist())]
    check('pdf_to_images_zip', info['name'] == 'doc3-images.zip' and dims == [(612, 792), (792, 612), (612, 792)], {'names': zf.namelist(), 'dims': dims})

    # merge, with doc2 moved first
    def merge_order():
        pg.click('.qrow:nth-child(2) button[title="Move up"]')
    info, data = run_convert(pg, 'merge', [DOC3, DOC2], merge_order)
    rr = PdfReader(io.BytesIO(data))
    check('merge', len(rr.pages) == 5 and 'doc2 page 1' in rr.pages[0].extract_text() and 'doc3 page 1' in rr.pages[2].extract_text(), info)

    # split: extract "1, 3" into one PDF, then one file per page
    info, data = run_convert(pg, 'split', [DOC3], lambda: pg.fill('#split-ranges', '1, 3'))
    rr = PdfReader(io.BytesIO(data))
    check('split_extract', len(rr.pages) == 2 and 'page 3' in rr.pages[1].extract_text(), info)

    def each():
        pg.fill('#split-ranges', '1-3')
        pg.check('#split-each')
    info, data = run_convert(pg, 'split', [DOC3], each)
    zf = zipfile.ZipFile(io.BytesIO(data))
    counts = [len(PdfReader(io.BytesIO(zf.read(n))).pages) for n in sorted(zf.namelist())]
    check('split_per_page_zip', counts == [1, 1, 1] and info['name'].endswith('.zip'), {'names': zf.namelist()})

    # bad range shows an error and makes no result
    pg.fill('#split-ranges', '9')
    n = pg.locator('.rcard').count()
    pg.click('#convert')
    pg.wait_for_function("!massless.live.busy")
    pg.wait_for_selector('#toast.error')
    check('split_bad_range_error', pg.locator('.rcard').count() == n and 'outside' in pg.inner_text('#toast'), pg.inner_text('#toast'))
    pg.uncheck('#split-each')

    # rotate pages 1 and 3 by 180
    def rot():
        pg.select_option('#rot-angle', '180')
        pg.fill('#rot-ranges', '1, 3')
    info, data = run_convert(pg, 'rotate', [DOC3], rot)
    rr = PdfReader(io.BytesIO(data))
    check('rotate', [p.rotation for p in rr.pages] == [180, 90, 180], [p.rotation for p in rr.pages])

    # compress
    info, data = run_convert(pg, 'compress', [DOC3], lambda: pg.fill('#quality', '0.5'))
    rr = PdfReader(io.BytesIO(data))
    imgs = [len(p['/Resources'].get('/XObject') or {}) for p in rr.pages]
    msizes = [(round(float(p.mediabox.width)), round(float(p.mediabox.height))) for p in rr.pages]
    check('compress', len(rr.pages) == 3 and imgs == [1, 1, 1] and msizes == [(612, 792), (792, 612), (612, 792)] and not rr.pages[0].extract_text().strip(), {**info, 'sizes': msizes})

    # extract text
    info, data = run_convert(pg, 'text', [DOC3])
    txt = data.decode('utf-8')
    check('extract_text', all(f'Chucksi doc3 page {i}' in txt for i in (1, 2, 3)) and '--- Page 2 ---' in txt and pg.input_value('#text-out') == txt, {**info, 'head': txt[:80]})

    # downloads happen only on click, from the result card
    with pg.expect_download() as dl:
        pg.click('.rcard:first-child .dl')
    check('result_download_button', dl.value.suggested_filename == 'doc3.txt', dl.value.suggested_filename)
    check('result_cards', pg.locator('.rcard').count() == 8, pg.locator('.rcard').count())

    if not args.no_shots:
        pg.evaluate("document.querySelector('.stage').scrollTo(0, 0)")
        pg.set_input_files('#conv-in', [DOC2])
        pg.wait_for_timeout(200)
        pg.screenshot(path=os.path.join(OUT, 'office-convert-1440.png'))

    # ================= Ask =================
    pg.click('#t-ask')
    pg.fill('#question', 'What is on page 2?')
    pg.click('#ask')
    pg.wait_for_selector('.acard')
    check('ask_404_friendly', "isn't switched on yet" in pg.inner_text('.acard:first-child p'))
    ASK['mode'] = 'ok'
    pg.click('#ask')
    pg.wait_for_function("document.querySelectorAll('.acard').length === 2 && !massless.live.busy")
    body = ASK['bodies'][-1]
    check('ask_answer_shown', pg.inner_text('.acard:first-child p') == 'Mock answer to: What is on page 2?' and 'llama-3.3-70b' in pg.inner_text('.acard:first-child .meta'),
          pg.inner_text('.acard:first-child'))
    check('ask_request_shape', set(body) == {'question', 'text'} and body['question'] == 'What is on page 2?' and 0 < len(body['text']) <= 12000 and 'Chucksi doc3 page 2' in body['text'], {'keys': list(body), 'chars': len(body['text'])})
    ASK['mode'] = '429'
    pg.click('#ask')
    pg.wait_for_function("document.querySelectorAll('.acard').length === 3 && !massless.live.busy")
    check('ask_429_message_as_is', pg.inner_text('.acard:first-child p') == 'The free daily limit for Ask is used up. It resets at midnight UTC.')
    if not args.no_shots:
        pg.screenshot(path=os.path.join(OUT, 'office-ask-1440.png'))
    pg.close()

    # ================= phone layout and empty state =================
    if not args.no_shots:
        e = ctx.new_page()
        e.on('pageerror', lambda x: errors.append(f'pageerror: {x}'))
        e.goto(f'{BASE}/office', wait_until='domcontentloaded')
        e.wait_for_timeout(800)
        e.screenshot(path=os.path.join(OUT, 'office-empty-1440.png'))
        e.close()
        m = browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True)
        m.on('pageerror', lambda x: errors.append(f'pageerror (phone): {x}'))
        m.on('requestfailed', lambda r: failed_requests.append(f'{r.url[:160]} {r.failure}'))
        m.goto(f'{BASE}/office?sample', wait_until='domcontentloaded')
        m.wait_for_function("window.massless && massless.live.doc && massless.live.doc.pages[0].rz > 0", timeout=90000)
        bx = m.locator('.pg[data-page="0"] .ov').bounding_box()
        m.click('[data-tool="highlight"]')
        drag(m, bx['x'] + bx['width'] * 0.08, bx['y'] + bx['height'] * 0.215, bx['x'] + bx['width'] * 0.75, bx['y'] + bx['height'] * 0.24)
        m.wait_for_timeout(300)
        no_hscroll = m.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
        check('phone_no_horizontal_scroll', no_hscroll, m.evaluate('[document.documentElement.scrollWidth, window.innerWidth]'))
        m.screenshot(path=os.path.join(OUT, 'office-edit-390.png'))
        m.screenshot(path=os.path.join(OUT, 'office-edit-390-full.png'), full_page=True)
        m.close()
    browser.close()

httpd.shutdown()
check('no_page_errors', not errors, errors)
check('no_failed_requests', not failed_requests, failed_requests)
summary = {'ok': not failures, 'failures': failures, 'pdfjs_version': libs.get('pdfjsVersion'), 'total_s': round(time.time() - t_start, 1), 'out': OUT,
           'checks': {k: (v if not v['ok'] else 'ok') for k, v in results.items()}}
print(json.dumps(summary, indent=2, default=str))
sys.exit(0 if summary['ok'] else 1)
