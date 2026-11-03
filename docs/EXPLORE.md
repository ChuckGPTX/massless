# Explore: share, feed and Remix

`chucksi.com/explore` is the public feed of things people made with Chucksi. A post is an image or a looping video,
a title, tags, the creator's display name, and a **Remix** link: a same-site path that reopens the tool with the
same settings (`/video?effect=lidar&look=cyan&sample=canyon`, `/website#s=…`, `/games#g=…`,
`/office?tab=slides&play=1#d=…`, `/workflows?make=map&…`, `/image?model=…&prompt=…`).

## Pieces

| Piece | File |
| --- | --- |
| API and media route | `src/explore.js` (wired in `src/index.js`) |
| Tool list and Remix allow-list (shared by Worker and pages) | `public/js/explore-tools.js` |
| Feed page | `public/explore/index.html`, `public/js/pages/explore-feed.js`, `public/css/feed.css` |
| Share sheet any tool can open | `public/js/explore-share.js`, `public/css/explore-share.css` |
| Schema | `migrations/explore/0001_init.sql` |
| Seed posts | `tools/explore/seed.mjs` → `tools/explore/seed/seed.sql`, `tools/explore/seed/apply.sh` |
| Tests | `tests/explore.test.js` (API on fakes), `tests/explore_test.py` (Playwright, mocked API) |

Share buttons: Video (text-to-video results and rendered clips, including every effect preset and camera move),
Image (each shot), Workflows design kits (`public/js/make/app.js`), Website builder (toolbar **Explore**), Games
(player bar **Explore**), Slides (share panel). Any other tool can call:

```js
import('/js/explore-share.js').then((m) => m.shareToExplore({ blob, poster, title, tool: 'video', remixUrl: '/video?move=fpv' }));
```

Signed out, the share is kept in IndexedDB while the visitor signs in; they return to `/explore` and the same sheet
opens again, ready to post.

## API

| Route | Who | Notes |
| --- | --- | --- |
| `GET /api/explore?tool=&sort=new\|top&cursor=&limit=` | public | edge-cached 20 s; `top` = likes × 2 + remixes |
| `GET /api/explore?mine=1` | signed in | your posts with `status` live / held / hidden |
| `GET /api/explore/:id` | public | adds `liked` and `mine` when signed in |
| `POST /api/explore` | signed in, confirmed email, Turnstile | multipart: `meta` JSON, `media`, `poster` |
| `DELETE /api/explore/:id` | owner | removes the R2 objects and likes |
| `POST`/`DELETE /api/explore/:id/like` | signed in | one like per account |
| `POST /api/explore/:id/report` | anyone, Turnstile | `{ reason, details }` |
| `POST /api/explore/:id/remix` | anyone | sent when a Remix link opens (`?from=<id>`, see `public/js/navigation.js`); counted once per IP per post per day |
| `GET /explore-media/<id>/media.<ext>`, `…/poster.<ext>` | public | R2, byte ranges, `nosniff`, `sandbox` CSP, 410 when taken down |

Limits: images ≤ 3 MB (WebP, JPEG, PNG; the bytes are sniffed), videos ≤ 8 MB (MP4, WebM) with a poster ≤ 600 KB,
title ≤ 80 characters and no links, ≤ 5 tags, Remix link ≤ 6,000 characters from the tool's own paths only. Daily:
20 posts per account (5 for accounts under a day old), 40 per IP, 300 likes per account, 10 reports per IP.

## Moderation choices

- **New accounts are held from the feed, not from the web.** A post from an account younger than
  `EXPLORE_HOLD_HOURS` (24) works by its link at once (the creator can share it), but only enters the public feed
  when the account is that old. A throwaway account therefore can't put anything in front of every visitor, and
  nobody has to approve posts by hand. Set `EXPLORE_HOLD_HOURS` to `0` to turn this off, or higher to be stricter.
  To list a held post early: `UPDATE explore_posts SET listed_at = created_at WHERE id = '…'`.
- **Reports hide automatically.** When `EXPLORE_REPORT_HIDE` (3) different people report a post, it is marked
  hidden and KV `explore-block:<id>` is set to `reports`: it leaves the feed and its media answers 410. Only the
  owner still sees it (as hidden). Review: `SELECT * FROM explore_reports ORDER BY at DESC`.
- **Takedown:** `npx wrangler kv key put --binding MASSLESS_KV explore-block:<id> manual --remote`. Restore: delete the
  key and `UPDATE explore_posts SET status = 'live' WHERE id = '…'`.
- `EXPLORE_PAUSED=1` stops new posts; the feed stays up.

## Apply (nothing has been run against production)

```sh
# 1. schema (same D1 database as Sign and hosting)
npx wrangler d1 execute massless-sign --remote --file migrations/explore/0001_init.sql
# 2. seed posts: 26 posts from public/media/templates, uploaded to chucksi-sites/explore/chucksi01…26/
node tools/explore/seed.mjs          # regenerates seed.sql and apply.sh (already committed)
sh tools/explore/seed/apply.sh       # 52 R2 uploads, then one d1 execute
# remove the seed posts later
npx wrangler d1 execute massless-sign --remote --command "DELETE FROM explore_posts WHERE owner = 'chucksi'"
```

No new bindings: Explore uses `SITES_BUCKET` (R2 `chucksi-sites`, prefix `explore/`), the Sign D1 database through
`SITES_DB`/`SIGN_DB`, `MASSLESS_KV`, and the Supabase vars already set. Optional `EXPLORE_BUCKET` and `EXPLORE_DB`
override them. With Workers Static Assets (`wrangler.jsonc`), `/explore-media/*` is in `run_worker_first`; the
production config serves everything through the Worker already.
