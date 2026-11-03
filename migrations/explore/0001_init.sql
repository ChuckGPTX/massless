-- Chucksi Explore (chucksi.com/explore): D1 schema. Media lives in R2 (EXPLORE_BUCKET, else SITES_BUCKET) under
-- explore/<id>/; this is the post registry, likes, reports and the daily counters.
-- Applied to the existing massless-sign database (src/explore.js uses EXPLORE_DB, else SITES_DB, else SIGN_DB):
--   npx wrangler d1 execute massless-sign --remote --file migrations/explore/0001_init.sql
-- Times are milliseconds since the epoch (UTC). Owners are Supabase user IDs; no emails are stored.

CREATE TABLE IF NOT EXISTS explore_posts (
  id           TEXT PRIMARY KEY,                -- 12 random lowercase letters and digits
  owner        TEXT NOT NULL,                   -- Supabase auth user id ('chucksi' for the seed posts)
  author       TEXT NOT NULL DEFAULT 'Creator', -- display name at posting time (never an email)
  title        TEXT NOT NULL,                   -- up to 80 characters
  tool         TEXT NOT NULL,                   -- video, image, design, website, games, slides, 3d
  remix        TEXT NOT NULL,                   -- same-site relative link that reopens the tool (allow-listed per tool)
  link         TEXT,                            -- optional https://<slug>.v2web.site address
  tags         TEXT NOT NULL DEFAULT '',        -- comma-separated, up to 5
  kind         TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  media_ext    TEXT NOT NULL,                   -- webp, jpg, png, mp4 or webm: R2 explore/<id>/media.<ext>
  poster_ext   TEXT NOT NULL,                   -- webp, jpg or png: R2 explore/<id>/poster.<ext>
  bytes        INTEGER NOT NULL DEFAULT 0,      -- media + poster
  width        INTEGER NOT NULL DEFAULT 1,      -- for the masonry layout only
  height       INTEGER NOT NULL DEFAULT 1,
  likes        INTEGER NOT NULL DEFAULT 0,
  remixes      INTEGER NOT NULL DEFAULT 0,
  score        INTEGER NOT NULL DEFAULT 0,      -- likes * 2 + remixes, for Top
  reports      INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'hidden')),  -- hidden: paused by reports
  created_at   INTEGER NOT NULL,
  listed_at    INTEGER NOT NULL                 -- when it enters the public feed (later for brand-new accounts)
);
CREATE INDEX IF NOT EXISTS explore_new ON explore_posts (status, listed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS explore_top ON explore_posts (status, score DESC, listed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS explore_tool_new ON explore_posts (tool, status, listed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS explore_owner ON explore_posts (owner, created_at);

CREATE TABLE IF NOT EXISTS explore_likes (
  post_id  TEXT NOT NULL,
  user_id  TEXT NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS explore_likes_user ON explore_likes (user_id);

CREATE TABLE IF NOT EXISTS explore_reports (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id  TEXT NOT NULL,
  reason   TEXT NOT NULL CHECK (reason IN ('sexual', 'violence', 'hate', 'harassment', 'spam', 'illegal', 'copyright', 'other')),
  details  TEXT,
  who      TEXT NOT NULL,                       -- 'r:' + salted hash of the reporter's IP
  at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS explore_reports_post ON explore_reports (post_id, at);

-- Daily counters: 'u:<user>' posts per account, 'ip:<hash>' posts per IP, 'l:<user>' likes, 'r:<hash>' reports,
-- 'x:<hash>' remix opens per IP and 'x:<id>:<hash>' (one counted remix per post per IP per day).
CREATE TABLE IF NOT EXISTS explore_quota (
  day  TEXT NOT NULL,                           -- YYYY-MM-DD (UTC)
  who  TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, who)
);
