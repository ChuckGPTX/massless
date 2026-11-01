# Free site hosting (`<name>.v2web.site`)

The Website builder's **Publish** button puts a site online at `https://<name>.v2web.site`. The same Worker as
chucksi.com (`src/sites.js`, routed from `src/index.js`) takes the upload, checks it, stores it in R2 and serves it.

## Setup (once)

1. R2 bucket: `npx wrangler r2 bucket create chucksi-sites` (binding `SITES_BUCKET`, already in `wrangler.jsonc`).
2. D1 tables, in the existing Sign database (the code uses `SITES_DB` when bound, else `SIGN_DB`):
   `npx wrangler d1 execute massless-sign --remote --file migrations/sites/0001_init.sql`
3. Worker routes on zone `v2web.site`: `v2web.site/*` and `*.v2web.site/*` → Worker `massless`.
   DNS: proxied `v2web.site`, `www` and `*` records (already there). The Microsoft 365 records stay as they are;
   their names (`autodiscover`, `sip`, `lyncdiscover`, `enterpriseregistration`, ...) are reserved and never handed out.
4. When uploading the Worker through the API, add the `SITES_BUCKET` R2 binding next to the existing ones.

Optional vars: `SITES_DOMAIN` (default `v2web.site`), `SITES_PER_ACCOUNT_DAILY` (30), `SITES_PER_IP_DAILY` (60),
`SITES_REPORT_PAUSE` (5 distinct reporters pause a site; `0` turns that off), `SITES_PAUSED=1` (stops publishing and
updates; live sites keep serving).

## Limits and rules

- Signed-in accounts with a confirmed email; Turnstile on publish, update and report.
- 5 sites per account, 10 MB and 60 files per site; html, css, the builder's `assets/site.js`, webp/jpg/png/gif/svg/ico,
  xml/txt/json, woff2. Audio is not hosted yet.
- Addresses: 3–40 characters, `a-z0-9` and single hyphens, first come first served; reserved names and brand,
  sign-in, banking and wallet look-alikes are refused (`slugProblem()` in `src/sites.js`).
- Pages must carry `<meta name="generator" content="Chucksi Website">`. Refused: password, payment, account-number and
  any non-builder form fields; forms or `formaction` to other sites; scripts other than the builder's (the Worker
  serves its own copy of `assets/site.js`); event-handler attributes; iframes, objects, `<base>`, meta refresh; SVGs
  with scripts or outside links.
- Served with a strict CSP (`script-src 'self'` plus the hash of the builder's one inline boot script,
  `form-action 'self'`, `frame-ancestors 'none'`, frames only for the builder's embeds), HSTS, `nosniff`, and a fixed
  "Made with Chucksi · Report" badge on every page.

## Takedowns

Block a site (it then serves "This site is unavailable", HTTP 410, within about a minute):

    npx wrangler kv key put --binding=MASSLESS_KV --remote "site-block:<name>" "phishing"

Unblock:

    npx wrangler kv key delete --binding=MASSLESS_KV --remote "site-block:<name>"

Any value blocks. The value `reports` is written automatically when enough different people report a site; the
owner sees it as "paused". A blocked address can't be published or updated, even after the owner unpublishes it, until
the key is deleted. The owner can still unpublish (delete) a blocked site.

Reports (from `chucksi.com/report?site=<name>`, linked from every badge):

    npx wrangler d1 execute massless-sign --remote --command "SELECT * FROM site_reports ORDER BY at DESC LIMIT 50"
    npx wrangler d1 execute massless-sign --remote --command "SELECT slug, owner, reports, flagged_at FROM sites WHERE flagged_at IS NOT NULL ORDER BY flagged_at DESC"

`owner` is the Supabase user ID; look the account up in Supabase if you need to contact or remove it.

## Storage layout

- R2 `sites/<name>/manifest.json`: owner, created and updated times, size, version and the file list.
- R2 `sites/<name>/v<version>/<path>`: the files. An update writes the next version, switches the manifest, then
  deletes the old version, so visitors never see a half-updated site.
- D1 `sites` (registry and the 5-site limit), `site_quota` (daily counters), `site_reports`.
