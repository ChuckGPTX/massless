"""Check a list of URLs (one per line on stdin or as JSON list file arg). Prints status and <title>."""
import sys, json, re, html, subprocess, concurrent.futures as cf

def check(u):
    try:
        p = subprocess.run(["curl", "-sS", "-L", "-A", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
                            "--max-time", "35", "-o", "-", "-w", "\n__STATUS__%{http_code}", u], capture_output=True, timeout=45)
        out = p.stdout.decode("utf-8", "ignore")
        m = re.search(r"__STATUS__(\d+)$", out)
        code = m.group(1) if m else "000"
        t = re.search(r"<title[^>]*>(.*?)</title>", out, re.S | re.I)
        title = " ".join(html.unescape(t.group(1)).split())[:90] if t else ("(pdf)" if out.startswith("%PDF") else "")
        err = p.stderr.decode()[-120:].strip()
        return u, code, title, err
    except Exception as e:
        return u, "ERR", "", str(e)[:100]

if __name__ == "__main__":
    urls = json.load(open(sys.argv[1])) if len(sys.argv) > 1 else [l.strip() for l in sys.stdin if l.strip()]
    urls = sorted(set(urls))
    with cf.ThreadPoolExecutor(12) as ex:
        for u, code, title, err in ex.map(check, urls):
            print(f"{code}\t{u}\t{title}\t{err if code in ('000','ERR') else ''}")
