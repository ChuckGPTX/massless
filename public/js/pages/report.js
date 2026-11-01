// Report a hosted site (/report?site=<slug>, linked from every v2web.site badge). Sends POST /api/sites/report.
import { apiFetch } from '../human.js';

const $ = (s) => document.querySelector(s);
const form = $('#report');
const site = $('#site');
const msg = $('#msg');
const clean = (v) => String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.v2web\.site.*$/, '').replace(/[^a-z0-9-]/g, '');

const given = clean(new URLSearchParams(location.search).get('site'));
if (given) site.value = given;
(given ? form.querySelector('input[name=reason]') : site).focus();
site.addEventListener('change', () => { site.value = clean(site.value); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const slug = clean(site.value);
  const reason = form.querySelector('input[name=reason]:checked')?.value;
  if (slug.length < 3) { msg.textContent = 'Enter the site address.'; site.focus(); return; }
  if (!reason) { msg.textContent = 'Pick what is wrong.'; return; }
  const send = $('#send');
  send.disabled = true;
  msg.textContent = 'Sending…';
  try {
    const r = await apiFetch('/api/sites/report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ site: slug, reason, details: $('#details').value, contact: $('#contact').value }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'The report could not be sent. Try again.');
    form.hidden = true;
    $('#done').hidden = false;
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    send.disabled = false;
  }
});
