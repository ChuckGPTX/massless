-- Chucksi hosting (<slug>.v2web.site): D1 schema. Files live in R2 (SITES_BUCKET); this is the registry,
-- the daily publish and report counters, and visitor reports.
-- Applied to the existing massless-sign database (src/sites.js uses SITES_DB, else SIGN_DB):
--   npx wrangler d1 execute massless-sign --remote --file migrations/sites/0001_init.sql
-- Times are milliseconds since the epoch (UTC). Owners are Supabase user IDs; no emails are stored.

CREATE TABLE IF NOT EXISTS sites (
  slug        TEXT PRIMARY KEY,                 -- the address: <slug>.v2web.site, first come, first served
  owner       TEXT NOT NULL,                    -- Supabase auth user id
  version     INTEGER NOT NULL DEFAULT 1,       -- R2 files are under sites/<slug>/v<version>/
  bytes       INTEGER NOT NULL DEFAULT 0,       -- all files of the live version (max 10 MB)
  files       INTEGER NOT NULL DEFAULT 0,       -- file count of the live version (max 60)
  title       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  reports     INTEGER NOT NULL DEFAULT 0,       -- visitor reports since publishing
  flagged_at  INTEGER                           -- first report; review these
);
CREATE INDEX IF NOT EXISTS sites_owner ON sites (owner);
CREATE INDEX IF NOT EXISTS sites_flagged ON sites (flagged_at);

-- Daily counters: who is 'u:<user id>' (publishes per account), 'ip:<hash>' (per IP) or 'r:<hash>' (reports per IP).
CREATE TABLE IF NOT EXISTS site_quota (
  day  TEXT NOT NULL,                           -- YYYY-MM-DD (UTC)
  who  TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, who)
);

CREATE TABLE IF NOT EXISTS site_reports (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  slug     TEXT NOT NULL,
  reason   TEXT NOT NULL CHECK (reason IN ('phishing', 'scam', 'malware', 'impersonation', 'spam', 'illegal', 'copyright', 'other')),
  details  TEXT,
  contact  TEXT,                                -- optional, given by the reporter for follow-up
  who      TEXT NOT NULL,                       -- 'r:' + salted hash of the reporter's IP
  at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS site_reports_slug ON site_reports (slug, at);
