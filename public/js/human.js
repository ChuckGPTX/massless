// Proof of human for the free APIs.
// The Worker asks for it at most once every few hours: a 401 with { human: true, sitekey }. We then run
// Cloudflare Turnstile (invisible unless Cloudflare needs a click), trade its one-time token for a
// short-lived cookie at /api/human, and retry the request once. Nothing about the visitor is stored.
// Pages that use the APIs also warm the check up in the background after load, so the first Generate
// doesn't wait for it.

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading = null;
let passing = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT;
      s.async = true;
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('The human check did not load.')));
      s.onerror = () => {
        loading = null;
        reject(new Error('The human check could not load. Check your connection or ad blocker, then try again.'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// One Turnstile token. The widget only shows itself if Cloudflare wants a click.
async function turnstileToken(sitekey) {
  const ts = await loadTurnstile();
  return new Promise((resolve, reject) => {
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Human check');
    box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;border-radius:14px;';
    // Shown only if Cloudflare wants a click; otherwise the check stays invisible.
    const label = document.createElement('p');
    label.textContent = 'Quick check that you’re human, then your render starts.';
    label.hidden = true;
    label.style.cssText = 'margin:0 0 10px;font:600 14px/1.3 system-ui,sans-serif;color:#f6f6f2;';
    const slot = document.createElement('div');
    box.append(label, slot);
    const showCard = (on) => {
      label.hidden = !on;
      box.style.background = on ? '#16161a' : '';
      box.style.border = on ? '1px solid #2c2c33' : '';
      box.style.padding = on ? '14px' : '';
      box.style.boxShadow = on ? '0 12px 40px rgba(0,0,0,.5)' : '';
    };
    document.body.appendChild(box);
    let id = null;
    const finish = (fn, value) => {
      clearTimeout(timer);
      try { if (id !== null) ts.remove(id); } catch { /* already gone */ }
      box.remove();
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('The human check timed out. Try again.')), 45000);
    try {
      id = ts.render(slot, {
        sitekey,
        appearance: 'interaction-only',
        'before-interactive-callback': () => showCard(true),
        'after-interactive-callback': () => showCard(false),
        callback: (token) => finish(resolve, token),
        'error-callback': () => { finish(reject, new Error('The human check failed. Reload the page and try again.')); return true; },
        'expired-callback': () => finish(reject, new Error('The human check expired. Try again.')),
      });
    } catch (e) {
      finish(reject, e);
    }
  });
}

function pass(sitekey) {
  if (!passing) {
    passing = (async () => {
      const token = await turnstileToken(sitekey);
      const r = await fetch('/api/human', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'The human check failed. Reload the page and try again.');
    })().finally(() => { passing = null; });
  }
  return passing;
}

/** fetch() for /api/*: answers the Worker's human check once, then retries. Bodies must be re-sendable (string, Blob, ArrayBuffer). */
export async function apiFetch(url, init = {}) {
  const res = await fetch(url, init);
  if (res.status !== 401) return res;
  const info = await res.clone().json().catch(() => null);
  if (!info || !info.human || !info.sitekey) return res;
  try {
    await pass(info.sitekey);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 403, headers: { 'content-type': 'application/json' } });
  }
  return fetch(url, init);
}

// Warm-up: ask the Worker whether this visitor needs a pass and, if so, earn it now in the background.
// HTTPS only, because the pass cookie is Secure (local test servers are plain HTTP).
function warm() {
  if (location.protocol !== 'https:') return;
  fetch('/api/human')
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => (s && s.on && !s.passed && s.sitekey ? pass(s.sitekey) : null))
    .catch(() => { /* the check runs again on the first real call */ });
}
if (document.readyState === 'complete') setTimeout(warm, 800);
else window.addEventListener('load', () => setTimeout(warm, 800), { once: true });
