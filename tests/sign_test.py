"""Massless Sign end-to-end in headless Chromium.

Starts tools/sign/dev_server.mjs (serves public/, mounts src/sign.js on in-memory R2/D1, serves the
fixture templates from tests/fixtures/contracts at /office/contracts/), then drives the real UI:
  1. Deals: create a Music release deal, check the preset checklist.
  2. Office > Sign: fill the Mutual NDA template, live preview, place extra fields by drag and by click,
     two sequential signers, create the envelope, QR code decodes to the signing link.
  3. Signer 2 on a phone is held back (signing order), signer 1 signs on desktop (typed signature),
     signer 2 signs on the phone (drawn signature) and the final PDF is built, sealed and downloaded.
  4. The final PDF is checked in Python: certificate text, hashes, embedded audit record, ES256 signature
     (verified with `cryptography`), and its SHA-256 matches the sealed record. The owner's manage view
     rebuilds the same bytes on another device.
  5. Verify passes for the file and fails after one changed byte (on /sign and in Office).
  6. Decline path, in-person signing on one device, Deals export/import (encrypted), envelopes list.
  7. Nothing readable reaches storage; no page errors; no horizontal overflow on phone screens.
Screenshots and outputs go to tests/out/sign.

  python3 tests/sign_test.py [--out DIR]
"""
import argparse, base64, hashlib, io, json, os, re, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
from pypdf import PdfReader
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas as rl_canvas

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..'))
ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(HERE, 'out', 'sign'))
args = ap.parse_args()
OUT = os.path.abspath(args.out)
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith(('.png', '.pdf', '.json')):
        os.remove(os.path.join(OUT, f))

results, failures, errors = {}, [], []


def check(name, cond, detail=None):
    results[name] = {'ok': bool(cond), **({'detail': detail} if detail is not None else {})}
    if not cond:
        failures.append(name)
        print(f'FAIL {name}', '' if detail is None else str(detail)[:400])
    else:
        print(f'ok   {name}')
    return cond


# ---------- server ----------
srv = subprocess.Popen(['node', '--no-warnings', os.path.join(REPO, 'tools', 'sign', 'dev_server.mjs'), '--port', '0', '--contracts', os.path.join(HERE, 'fixtures', 'contracts'), '--test'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
import atexit
atexit.register(srv.kill)
line = srv.stdout.readline()
m = re.search(r'READY (http://\S+)', line)
if not m:
    print('server did not start:', line, srv.stdout.read()[:2000])
    sys.exit(1)
BASE = m.group(1)


def get_json(path):
    with urllib.request.urlopen(BASE + path) as r:
        return json.loads(r.read())


def b64u(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


# A plain PDF to upload for the in-person envelope.
def make_pdf(path):
    c = rl_canvas.Canvas(path, pagesize=letter)
    c.setFont('Helvetica-Bold', 22)
    c.drawString(72, 700, 'Equipment Loan Receipt')
    c.setFont('Helvetica', 12)
    for k, t in enumerate(['The borrower received one camera kit in working order.', 'It will be returned within 14 days.', '', 'Lender signature', '', '', 'Borrower signature']):
        c.drawString(72, 660 - k * 22, t)
    c.showPage()
    c.save()


UPLOAD = os.path.join(OUT, 'upload-receipt.pdf')
make_pdf(UPLOAD)

DESKTOP = {'viewport': {'width': 1440, 'height': 900}}
PHONE = {'viewport': {'width': 390, 'height': 844}, 'device_scale_factor': 2, 'is_mobile': True, 'has_touch': True}


def watch(pg, label):
    pg.on('pageerror', lambda e: errors.append(f'{label}: pageerror {e}'))
    pg.on('console', lambda msg: msg.type == 'error' and errors.append(f'{label}: console {msg.text[:240]}'))
    pg.on('requestfailed', lambda r: (not r.url.startswith('blob:') and 'net::ERR_ABORTED' not in (r.failure or '')) and errors.append(f'{label}: requestfailed {r.url[:120]} {r.failure}'))
    pg.on('dialog', lambda d: d.accept())


def shot(pg, name, full=False):
    pg.wait_for_timeout(250)
    pg.screenshot(path=os.path.join(OUT, f'{name}.png'), full_page=full)


def no_overflow(pg, name):
    w = pg.evaluate('() => [document.documentElement.scrollWidth, window.innerWidth]')
    check(f'layout: no horizontal overflow ({name})', w[0] <= w[1] + 1, w)


def sign_all(pg, label, draw=False, title='Chief Executive Officer'):
    """Walk the guided flow: adopt, sign, fill, check, finish."""
    pg.wait_for_selector('.sg-f.mine', timeout=30000)
    for _ in range(30):
        act = pg.get_attribute('#main', 'data-action')
        if act == 'finish':
            break
        pg.click('#main')
        pg.wait_for_timeout(250)
        if pg.locator('.sg-adopt[open]').count():
            pg.wait_for_timeout(500)
            shot(pg, f'{label}-adopt')
            if draw:
                pg.click('.sg-adopt [data-mode="draw"]')
                for sel in ('#sg-pad-sig', '#sg-pad-ini'):
                    if not pg.locator(sel).is_visible():
                        continue
                    b = pg.locator(sel).bounding_box()
                    pg.mouse.move(b['x'] + b['width'] * 0.12, b['y'] + b['height'] * 0.6)
                    pg.mouse.down()
                    for k in range(1, 26):
                        pg.mouse.move(b['x'] + b['width'] * (0.12 + k * 0.03), b['y'] + b['height'] * (0.6 - 0.25 * ((k % 6) / 5)), steps=2)
                    pg.mouse.up()
                shot(pg, f'{label}-adopt-drawn')
            pg.click('#sg-adopt-go')
            pg.wait_for_timeout(300)
        if pg.locator('.sg-edit[open]').count():
            pg.fill('#edit-in', title)
            pg.click('#edit-save')
            pg.wait_for_timeout(200)
    for box in pg.locator('.sg-f.mine.t-checkbox:not(.done)').all():
        box.click()
    shot(pg, f'{label}-ready')
    pg.click('#main')
    pg.wait_for_selector('.sg-finish[open]')
    shot(pg, f'{label}-finish')
    pg.click('#finish-go')


with sync_playwright() as p:
    browser = p.chromium.launch(args=['--disable-gpu'])
    desk = browser.new_context(**DESKTOP, accept_downloads=True)
    phone = browser.new_context(**PHONE, accept_downloads=True)
    o = desk.new_page()
    watch(o, 'office')

    # ---------------- Deals first, so the envelope can join it ----------------
    o.goto(BASE + '/office?tab=sign')
    o.wait_for_selector('.sg-tcard[data-template]')
    cards = o.eval_on_selector_all('.sg-tcard[data-template]', 'els => els.map(e => e.dataset.template)')
    check('gallery: lists the fixture templates', cards == ['mutual-nda', 'split-sheet', 'bill-of-sale'], cards)
    check('gallery: not-legal-advice notice is visible', o.locator('.sg-legal-note').first.is_visible())
    shot(o, '01-office-gallery')
    o.click('#sv-t-deals')
    o.select_option('#deal-preset', 'music')
    o.fill('#deal-title', 'Midnight Static')
    o.click('#sign-go')
    o.wait_for_selector('.sg-deal')
    tasks = o.locator('.sg-tasks li').count()
    check('deals: Music release preset checklist', tasks == 12, tasks)
    o.locator('.sg-tasks li input').first.check()
    o.fill('.sg-padd input[placeholder="Name"]', 'Ava Chen')
    o.fill('.sg-padd input[type="email"]', 'ava@example.com')
    o.click('.sg-padd button')
    o.set_input_files('input[id^="deal-doc-"]', UPLOAD)
    o.wait_for_selector('.sg-dsec .sg-drow:has-text("upload-receipt.pdf")')
    shot(o, '02-deal')

    # ---------------- Prepare the NDA ----------------
    o.click('#sv-t-prepare')
    o.click('.sg-tcard[data-template="mutual-nda"]')
    o.wait_for_selector('#sg-pages .pg canvas')
    o.wait_for_timeout(800)
    missing0 = o.text_content('#sg-missing')
    o.fill('#sgv-effective_date', '2026-11-02')
    o.fill('#sgv-party_a_name', 'Northwind Labs, Inc.')
    o.fill('#sgv-party_b_name', 'Jordan Rivera')
    o.check('#sgv-include_nonsolicit')
    o.fill('#sgv-penalty', '25000')
    o.wait_for_timeout(1500)
    check('details: required count updates', missing0 != o.text_content('#sg-missing') and 'All set' in o.text_content('#sg-missing'), [missing0, o.text_content('#sg-missing')])
    names = o.eval_on_selector_all('.sg-sname', 'els => els.map(e => e.value)')
    check('signers: party names fill the signers', names == ['Northwind Labs, Inc.', 'Jordan Rivera'], names)
    o.fill('.sg-srow >> nth=0 >> .sg-sname', 'Avery Stone')
    o.fill('.sg-srow >> nth=0 >> .sg-semail', 'avery@northwind.example')
    o.fill('#sg-message', 'Hi both, here is the NDA we discussed.')
    o.fill('#sg-from', 'Morgan Lee')
    o.select_option('#sg-deal', label='Midnight Static')
    pdf_text = o.evaluate('async () => { const s = massless.sign.state; return [s.markers.length, s.pages.length]; }')
    check('preview: template rendered with marker fields', pdf_text[0] == 10 and pdf_text[1] >= 2, pdf_text)
    # drag a text field for signer 2
    o.select_option('#sg-role', '1')
    btn = o.locator('.sg-pal[data-type="text"]').bounding_box()
    pg1 = o.locator('#sg-pages .pg').first.bounding_box()
    o.mouse.move(btn['x'] + 15, btn['y'] + 12)
    o.mouse.down()
    o.mouse.move(pg1['x'] + 420, pg1['y'] + 260, steps=10)
    o.mouse.up()
    o.fill('#sg-insp input[aria-label="Field label"]', 'Phone')
    # click-to-place a checkbox for signer 1
    o.select_option('#sg-role', '0')
    o.click('.sg-pal[data-type="checkbox"]')
    o.locator('#sg-pages .pg').first.click(position={'x': 80, 'y': 330})
    o.wait_for_timeout(300)
    nfields = o.evaluate('massless.sign.api.allFields().length')
    check('fields: drag and click placement', nfields == 12, nfields)
    shot(o, '03-office-prepare')
    o.set_viewport_size({'width': 1440, 'height': 900})
    o.click('#sign-go')
    o.wait_for_selector('.sg-sent', timeout=30000)
    links = o.eval_on_selector_all('.sg-sent .sg-lcard[data-signer] input', 'els => els.map(e => e.value)')
    manage = o.input_value('.sg-lcard.owner input')
    check('create: one private link per signer plus a manage link', len(links) == 2 and all('/sign#e=' in u and '&s=' in u and '&k=' in u for u in links) and '&o=' in manage, links)
    env_id = re.search(r'e=([A-Za-z0-9_-]{22})', links[0]).group(1)
    shot(o, '04-office-sent')
    # QR code holds the exact link
    o.locator('.sg-lcard[data-signer="0"] button:has-text("QR code")').click()
    o.wait_for_selector('.sg-qr[open] svg')
    o.locator('.sg-qr-code').screenshot(path=os.path.join(OUT, '05-qr.png'))
    shot(o, '05-qr-dialog')
    try:
        import cv2
        img = cv2.imread(os.path.join(OUT, '05-qr.png'))
        val = ''
        for det in [cv2.QRCodeDetectorAruco(), cv2.QRCodeDetector()]:
            val = det.detectAndDecode(img)[0]
            if val:
                break
        check('qr: decodes to the signer link', val == links[0], val[:80])
    except ImportError:
        check('qr: decoder available', False, 'opencv missing')
    o.keyboard.press('Escape')

    dump = get_json('/__sign/dump')
    blob_keys = list(dump['r2'].keys())
    check('storage: only the encrypted document in R2', blob_keys == [f'e/{env_id}/doc'], blob_keys)

    # ---------------- signer 2 on a phone first: held back ----------------
    s2 = phone.new_page()
    watch(s2, 'signer2')
    s2.goto(links[1])
    s2.wait_for_selector('.sg-banner')
    check('order: second signer waits for the first', 'signs first' in s2.text_content('.sg-banner'), s2.text_content('.sg-banner'))
    check('fragment: key removed from the address bar', '#' not in s2.url and 'k=' not in s2.url, s2.url)
    shot(s2, '06-phone-waiting')
    no_overflow(s2, 'phone waiting')

    # ---------------- signer 1 on desktop ----------------
    s1 = desk.new_page()
    watch(s1, 'signer1')
    s1.goto(links[0])
    s1.wait_for_selector('#consent-go')
    check('consent: ESIGN disclosure before signing', all(t in s1.text_content('.sg-consent') for t in ['paper copy', 'withdraw', 'What you need', 'download']), None)
    check('consent: continue disabled until agreed', s1.is_disabled('#consent-go'))
    shot(s1, '07-desktop-consent', full=True)
    s1.check('#agree')
    s1.click('#consent-go')
    s1.wait_for_selector('.sg-f.mine')
    s1.wait_for_timeout(800)
    shot(s1, '08-desktop-signing')
    sign_all(s1, '09-desktop')
    s1.wait_for_selector('h1:has-text("You signed")', timeout=30000)
    shot(s1, '10-desktop-signed')

    # ---------------- signer 2 signs on the phone and completes ----------------
    s2.click('.sg-banner button')
    s2.wait_for_selector('#consent-go', timeout=20000)
    shot(s2, '11-phone-consent', full=True)
    no_overflow(s2, 'phone consent')
    s2.check('#agree')
    s2.click('#consent-go')
    s2.wait_for_selector('.sg-f.mine')
    s2.wait_for_timeout(1000)
    shot(s2, '12-phone-signing')
    no_overflow(s2, 'phone signing')
    sign_all(s2, '13-phone', draw=True, title='Consultant')
    s2.wait_for_selector('#dl-final:not([disabled])', timeout=60000)
    shot(s2, '14-phone-completed')
    no_overflow(s2, 'phone completed')
    check('complete: sealed on the signer\'s device', 'Sealed' in s2.text_content('.sg-sealing'), s2.text_content('.sg-sealing'))
    with s2.expect_download() as dl:
        s2.click('#dl-final')
    final_path = os.path.join(OUT, 'final-signed.pdf')
    dl.value.save_as(final_path)
    final = open(final_path, 'rb').read()
    final_hash = hashlib.sha256(final).hexdigest()

    # ---------------- check the final PDF in Python ----------------
    dump = get_json('/__sign/dump')
    seals = dump['d1']['sign_seals']
    check('seal: final SHA-256 registered', any(s['final_hash'] == final_hash for s in seals), [s['final_hash'][:12] for s in seals])
    rd = PdfReader(io.BytesIO(final))
    texts = [pg.extract_text() or '' for pg in rd.pages]
    cert = '\n'.join(t for t in texts if 'Certificate of Completion' in t)
    envrow = [e for e in dump['d1']['sign_envelopes'] if e['id'] == env_id][0]
    check('final: certificate page appended', bool(cert) and len(rd.pages) >= 3, len(rd.pages))
    check('final: certificate names signers, envelope and hashes', all(x in cert for x in ['Avery Stone', 'Jordan Rivera', env_id, envrow['doc_hash'], envrow['signed_hash'], 'avery@northwind.example', 'Agreed to sign electronically']), cert[:300])
    check('final: certificate shows IP, device and order', '127.0.0.1' in cert and 'HeadlessChrome' in cert.replace('\n', '') and 'sequential' in cert, None)
    check('final: not-legal-advice notice on the certificate', 'not legal advice' in cert)
    body = '\n'.join(texts[:2])
    check('final: typed values flattened into the pages', 'Chief Executive Officer' in body and 'Consultant' in body, None)
    def xobjs(pg):
        res = pg.get('/Resources')
        res = res.get_object() if res is not None else {}
        xo = res.get('/XObject')
        return len(xo.get_object()) if xo is not None else 0
    imgs = sum(xobjs(pg) for pg in rd.pages[:2])
    check('final: signature and initial images drawn on the pages', imgs >= 4, imgs)
    att = rd.attachments.get('massless-sign-audit.json')
    check('final: audit record embedded', bool(att))
    audit = json.loads(att[0])
    rec = json.loads(audit['record'])
    key = get_json('/api/sign/key')
    try:
        from cryptography.hazmat.primitives.asymmetric import ec, utils
        from cryptography.hazmat.primitives import hashes
        pub = ec.EllipticCurvePublicNumbers(int.from_bytes(b64u(key['x']), 'big'), int.from_bytes(b64u(key['y']), 'big'), ec.SECP256R1()).public_key()
        sig = b64u(audit['sig'])
        der = utils.encode_dss_signature(int.from_bytes(sig[:32], 'big'), int.from_bytes(sig[32:], 'big'))
        pub.verify(der, audit['record'].encode(), ec.ECDSA(hashes.SHA256()))
        ok = True
    except Exception as e:  # noqa: BLE001
        ok = False
        print('verify error', e)
    check('final: ES256 attestation verifies independently (cryptography)', ok)
    check('final: attested record binds the hashes and order', rec['originalHash'] == envrow['doc_hash'] and rec['signedHash'] == envrow['signed_hash'] and [s['order'] for s in rec['signers']] == [1, 2] and all(s['consentedAt'] and s['signedAt'] and s['ip'] for s in rec['signers']), rec['signers'])
    check('final: audit trail lists every step', [e['type'] for e in rec['events']][:2] == ['created', 'viewed'] and {'consented', 'signed', 'completed'} <= {e['type'] for e in rec['events']}, [e['type'] for e in rec['events']])
    subprocess.run(['pdftoppm', '-r', '70', '-png', final_path, os.path.join(OUT, 'final-page')], check=False)

    # ---------------- owner's manage view rebuilds the same file ----------------
    mg = desk.new_page()
    watch(mg, 'manage')
    mg.goto(manage)
    mg.wait_for_selector('.sg-table tbody tr', timeout=20000)
    check('manage: status, timeline and audit trail', 'Completed' in mg.text_content('.sg-pill') and mg.locator('.sg-timeline li').count() == 2 and mg.locator('.sg-table tbody tr').count() >= 8, mg.text_content('.sg-pill'))
    shot(mg, '15-manage', full=True)
    with mg.expect_download() as dl2:
        mg.click('#dl-final')
    again = open(dl2.value.path(), 'rb').read()
    check('final: another device rebuilds byte-identical PDF', hashlib.sha256(again).hexdigest() == final_hash)

    # ---------------- Verify ----------------
    v = desk.new_page()
    watch(v, 'verify')
    v.goto(BASE + '/sign#verify')
    v.wait_for_selector('.sg-vdrop')
    shot(v, '16-sign-landing')
    v.set_input_files('#app input[type="file"]', final_path)
    v.wait_for_selector('.sg-vcard.ok, .sg-vcard.bad', timeout=20000)
    check('verify: the sealed PDF passes', v.locator('.sg-vcard.ok').count() == 1 and v.locator('.sg-vsteps li.bad').count() == 0, v.text_content('.sg-vout')[:300])
    v.evaluate("document.querySelector('.sg-vsec').scrollIntoView()")
    shot(v, '17-verify-pass')
    tampered = bytearray(final)
    tampered[len(final) // 2] ^= 0x01
    tpath = os.path.join(OUT, 'final-tampered.pdf')
    open(tpath, 'wb').write(bytes(tampered))
    v.set_input_files('#app input[type="file"]', tpath)
    v.wait_for_selector('.sg-vcard.bad', timeout=20000)
    check('verify: one changed byte fails', 'changed' in v.text_content('.sg-vcard.bad').lower() or 'not a sealed' in v.text_content('.sg-vcard.bad').lower(), v.text_content('.sg-vcard.bad'))
    v.evaluate("document.querySelector('.sg-vsec').scrollIntoView()")
    shot(v, '18-verify-fail')
    o.click('#sv-t-verify')
    o.set_input_files('#sg-verify input[type="file"]', final_path)
    o.wait_for_selector('#sg-verify .sg-vcard.ok', timeout=20000)
    check('verify: Office Verify passes too', True)
    shot(o, '19-office-verify')

    # ---------------- decline path ----------------
    o.click('#sv-t-prepare')
    o.click('#sign-go')  # Start another
    o.wait_for_selector('.sg-tcard[data-template="bill-of-sale"]')
    o.click('.sg-tcard[data-template="bill-of-sale"]')
    o.wait_for_selector('#sg-pages .pg canvas')
    for k, val in {'seller_name': 'Dana Smith', 'buyer_name': 'Lee Park', 'vehicle': '2016 Honda Civic', 'vin': '2HGFC2F59GH000000', 'odometer': '84200', 'price': '9800', 'sale_date': '2026-11-05'}.items():
        o.fill(f'#sgv-{k}', val)
    o.wait_for_timeout(900)
    shot(o, '20-office-bill-of-sale')
    o.click('#sign-go')
    o.wait_for_selector('.sg-sent', timeout=30000)
    dlinks = o.eval_on_selector_all('.sg-sent .sg-lcard[data-signer] input', 'els => els.map(e => e.value)')
    dmanage = o.input_value('.sg-lcard.owner input')
    d1 = desk.new_page()
    watch(d1, 'decline')
    d1.goto(dlinks[0])
    d1.wait_for_selector('#consent-go')
    d1.click('button:has-text("Decline to sign")')
    d1.fill('#decline-reason', 'The price should be 9,500 dollars.')
    shot(d1, '21-decline-dialog')
    d1.click('#decline-go')
    d1.wait_for_selector('h1:has-text("Declined")', timeout=20000)
    check('decline: signer sees the declined screen with the reason', 'The price should be 9,500 dollars.' in d1.text_content('.sg-reasons'))
    shot(d1, '22-declined')
    d2 = phone.new_page()
    watch(d2, 'decline-2')
    d2.goto(dlinks[1])
    d2.wait_for_selector('h1:has-text("Declined")', timeout=20000)
    check('decline: nobody else can sign', True)
    dm = desk.new_page()
    watch(dm, 'decline-manage')
    dm.goto(dmanage)
    dm.wait_for_selector('.sg-banner.bad')
    check('decline: owner sees who declined and why', 'Dana Smith declined' in dm.text_content('.sg-banner.bad') and '9,500' in dm.text_content('.sg-banner.bad'), dm.text_content('.sg-banner.bad'))

    # ---------------- in-person signing of an uploaded PDF ----------------
    o.click('#sign-go')  # Start another
    o.wait_for_selector('#sg-pdf-in', state='attached')
    o.set_input_files('#sg-pdf-in', UPLOAD)
    o.wait_for_selector('#sg-pages .pg canvas')
    o.fill('.sg-srow >> nth=0 >> .sg-sname', 'Sam Ortiz')
    o.fill('.sg-srow >> nth=0 >> .sg-srole', 'Lender')
    o.click('#sg-add-signer')
    o.fill('.sg-srow >> nth=1 >> .sg-sname', 'Riley Kim')
    o.fill('.sg-srow >> nth=1 >> .sg-srole', 'Borrower')
    page_box = o.locator('#sg-pages .pg').first
    zoom = o.evaluate('massless.sign.state.zoom')
    for who, y in ((0, 210), (1, 276)):
        o.select_option('#sg-role', str(who))
        o.click('.sg-pal[data-type="signature"]')
        page_box.click(position={'x': 72 * zoom + 90 * zoom, 'y': y * zoom})
        o.select_option('#sg-role', str(who))
        o.click('.sg-pal[data-type="date"]')
        page_box.click(position={'x': 330 * zoom + 56 * zoom, 'y': y * zoom})
    shot(o, '23-office-upload-fields')
    o.click('#sign-go')
    o.wait_for_selector('.sg-sent', timeout=30000)
    shot(o, '24-office-sent-upload')
    with desk.expect_page() as popup:
        o.locator('.sg-lcard[data-signer="0"] button:has-text("Sign in person")').click()
    ip = popup.value
    watch(ip, 'in-person')
    ip.wait_for_selector('#confirm-name', timeout=20000)
    shot(ip, '25-handoff')
    ip.fill('#confirm-name', 'Someone Else')
    ip.click('#confirm-go')
    check('in person: a different name is refused', ip.locator('#confirm-name').count() == 1)
    ip.fill('#confirm-name', 'sam ortiz')
    ip.click('#confirm-go')
    ip.wait_for_selector('#consent-go')
    ip.check('#agree')
    ip.click('#consent-go')
    sign_all(ip, '26-inperson-1')
    ip.wait_for_selector('#next-signer', timeout=20000)
    shot(ip, '27-inperson-next')
    ip.click('#next-signer')
    ip.wait_for_selector('#confirm-name', timeout=20000)
    ip.fill('#confirm-name', 'Riley Kim')
    ip.click('#confirm-go')
    ip.wait_for_selector('#consent-go')
    ip.check('#agree')
    ip.click('#consent-go')
    sign_all(ip, '28-inperson-2')
    ip.wait_for_selector('#dl-final:not([disabled])', timeout=60000)
    shot(ip, '29-inperson-completed')
    with ip.expect_download() as dl3:
        ip.click('#dl-final')
    ipdf = open(dl3.value.path(), 'rb').read()
    open(os.path.join(OUT, 'final-in-person.pdf'), 'wb').write(ipdf)
    itext = '\n'.join(pg.extract_text() or '' for pg in PdfReader(io.BytesIO(ipdf)).pages)
    check('in person: certificate records the typed name check', 'In person on a shared device' in itext.replace('\n', ' ') and 'sam ortiz' in itext, None)
    subprocess.run(['pdftoppm', '-r', '70', '-png', os.path.join(OUT, 'final-in-person.pdf'), os.path.join(OUT, 'inperson-page')], check=False)

    # ---------------- envelopes list ----------------
    o.click('#sv-t-envelopes')
    o.wait_for_selector('.sg-ecard')
    o.wait_for_timeout(1500)
    pills = o.eval_on_selector_all('.sg-ecard .sg-pill', 'els => els.map(e => e.textContent)')
    check('envelopes: list shows live status', sorted(pills) == ['Completed', 'Completed', 'Declined'], pills)
    shot(o, '30-office-envelopes')

    # ---------------- Deals: envelope linked, export, delete, import ----------------
    o.click('#sv-t-deals')
    o.wait_for_selector('.sg-dcard, .sg-deal')
    if o.locator('.sg-dcard').count():
        o.click('.sg-dcard')
    o.wait_for_selector('.sg-deal')
    check('deals: the NDA envelope joined the deal', 'Mutual Non-Disclosure Agreement' in o.text_content('.sg-deal'))
    shot(o, '31-deal-with-envelope', full=True)
    with o.expect_download() as dl4:
        o.click('#deal-export')
        o.fill('#deal-pass', 'correct horse battery')
        o.fill('#deal-pass2', 'correct horse battery')
        o.click('#deal-pass-go')
    exp_path = os.path.join(OUT, 'deal-export.json')
    dl4.value.save_as(exp_path)
    exp = open(exp_path).read()
    check('deals: export is encrypted', json.loads(exp)['kind'] == 'massless-sign/deals-export' and 'Midnight' not in exp and 'Ava Chen' not in exp and 'ownerToken' not in exp)
    o.click('.sg-dhead button:has-text("Delete")')
    o.wait_for_selector('.sg-dz-ico')
    o.set_input_files('#deal-import-in', exp_path)
    o.fill('#deal-pass', 'wrong passphrase')
    o.click('#deal-pass-go')
    o.wait_for_timeout(1200)
    check('deals: wrong passphrase is refused', 'Wrong passphrase' in (o.text_content('#toast') or ''), o.text_content('#toast'))
    o.set_input_files('#deal-import-in', exp_path)
    o.fill('#deal-pass', 'correct horse battery')
    o.click('#deal-pass-go')
    o.wait_for_selector('.sg-deal', timeout=20000)
    restored = o.evaluate("() => [document.querySelector('.sg-dtitle').value, document.querySelectorAll('.sg-tasks li.done').length, document.querySelector('.sg-deal').textContent.includes('upload-receipt.pdf'), document.querySelector('.sg-deal').textContent.includes('Ava Chen')]")
    check('deals: import restores title, checklist, documents and people', restored == ['Midnight Static', 1, True, True], restored)

    # ---------------- phone layouts ----------------
    ph = phone.new_page()
    watch(ph, 'phone-office')
    ph.goto(BASE + '/office?tab=sign')
    ph.wait_for_selector('.sg-tcard[data-template]')
    no_overflow(ph, 'office sign gallery')
    shot(ph, '32-phone-office-gallery')
    ph.click('.sg-tcard[data-template="split-sheet"]')
    ph.wait_for_selector('#sg-pages .pg canvas')
    ph.wait_for_timeout(800)
    no_overflow(ph, 'office sign editor')
    shot(ph, '33-phone-office-editor')
    ph.evaluate("() => document.querySelector('#tab-sign').scrollIntoView()")
    shot(ph, '34-phone-office-details')
    ph.click('#sv-t-deals')
    ph.wait_for_selector('.sg-dcard, .sg-deal, .sg-dz-ico')
    no_overflow(ph, 'office deals')
    land = phone.new_page()
    watch(land, 'phone-landing')
    land.goto(BASE + '/sign')
    land.wait_for_selector('.sg-hero')
    no_overflow(land, 'sign landing')
    shot(land, '35-phone-landing', full=True)

    # ---------------- limits in the editor ----------------
    capped = o.evaluate("""() => { const a = massless.sign.api; let made = 0; for (let i = 0; i < 60; i++) if (a.addField('checkbox', 0, 10 + (i % 10) * 20, 10 + Math.floor(i / 10) * 20)) made++; return [made, a.allFields().filter(f => f.page === 0).length]; }""")
    check('limits: at most 50 fields per page', capped[1] == 50, capped)

    # ---------------- nothing readable stored ----------------
    dump = get_json('/__sign/dump')
    blobs = [base64.b64decode(v) for v in dump['r2'].values()]
    rows = json.dumps(dump['d1'])
    needles = ['Northwind', 'Avery Stone', 'Jordan Rivera', 'avery@northwind', 'Chief Executive', 'Consultant', 'here is the NDA', 'Morgan Lee', '9,500', 'Dana Smith', 'Honda Civic', 'Sam Ortiz', 'Riley Kim', '%PDF', 'Midnight Static']
    leaks = [n for n in needles if any(n.encode() in b for b in blobs) or n in rows]
    check('privacy: R2 and D1 hold no document text, names, values, signatures or reasons', not leaks and len(blobs) >= 6, leaks)
    check('privacy: every stored blob is ciphertext', all(b[0] == 1 for b in blobs))
    gated = set(dump['gated'])
    check('human check: every Sign POST goes through a gated path', {'/api/sign/envelopes', '/api/sign/envelopes/:id/events', '/api/sign/verify'} <= gated, sorted(gated))

    browser.close()

srv.terminate()
real_errors = [e for e in errors if 'favicon' not in e]
check('no page errors, console errors or failed requests', not real_errors, real_errors[:12])
json.dump(results, open(os.path.join(OUT, 'results.json'), 'w'), indent=1)
print(f'\n{len(results) - len(failures)}/{len(results)} checks passed. Screenshots in {OUT}')
sys.exit(1 if failures else 0)
