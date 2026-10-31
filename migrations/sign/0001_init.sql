-- Massless Sign: D1 schema.
--   wrangler d1 create massless-sign
--   wrangler d1 execute massless-sign --remote --file migrations/sign/0001_init.sql   (or: wrangler d1 migrations apply massless-sign --remote)
-- D1 holds bookkeeping only. Documents, field values, names, emails, signatures, messages and decline
-- reasons are encrypted in the browser and stored in R2 as ciphertext (or here as base64url ciphertext).
-- Times are milliseconds since the epoch (UTC). Hashes are lowercase hex SHA-256.

CREATE TABLE IF NOT EXISTS sign_envelopes (
  id            TEXT PRIMARY KEY,                  -- 16 random bytes, base64url
  owner_hash    TEXT NOT NULL,                     -- SHA-256 of the owner token; the token is never stored
  status        TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'completed', 'declined')),
  routing       TEXT NOT NULL DEFAULT 'sequential' CHECK (routing IN ('sequential', 'parallel')),
  doc_hash      TEXT NOT NULL,                     -- SHA-256 of the original PDF, computed by the sender
  signer_count  INTEGER NOT NULL CHECK (signer_count BETWEEN 1 AND 10),
  bytes         INTEGER NOT NULL DEFAULT 0,        -- ciphertext held in R2 for this envelope (max 10 MB)
  event_count   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  completed_at  INTEGER,
  declined_at   INTEGER,
  expires_at    INTEGER NOT NULL,                  -- created + 30 days; completed + 90 days
  signed_hash   TEXT,                              -- SHA-256 of the signed pages, before the certificate
  attest_json   TEXT,                              -- canonical JSON audit record the Worker signed
  attest_sig    TEXT,                              -- ECDSA P-256 (ES256) signature over attest_json, base64url
  final_hash    TEXT                               -- SHA-256 of the final PDF (signed pages + certificate)
);
CREATE INDEX IF NOT EXISTS sign_envelopes_expires ON sign_envelopes (expires_at);

CREATE TABLE IF NOT EXISTS sign_signers (
  envelope_id   TEXT NOT NULL,
  idx           INTEGER NOT NULL,                  -- position in the sender's list, 0-based
  token_hash    TEXT NOT NULL,                     -- SHA-256 of the signer token
  ord           INTEGER NOT NULL DEFAULT 1,        -- signing order; equal numbers sign in parallel
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'declined')),
  viewed_at     INTEGER,
  consented_at  INTEGER,                           -- ESIGN / UETA consent to do business electronically
  signed_at     INTEGER,
  declined_at   INTEGER,
  payload_bytes INTEGER NOT NULL DEFAULT 0,        -- size of this signer's encrypted fields in R2
  PRIMARY KEY (envelope_id, idx)
);
CREATE UNIQUE INDEX IF NOT EXISTS sign_signers_token ON sign_signers (token_hash);

CREATE TABLE IF NOT EXISTS sign_events (
  envelope_id   TEXT NOT NULL,
  seq           INTEGER NOT NULL,                  -- 1, 2, 3 ... per envelope
  type          TEXT NOT NULL,                     -- created viewed consented signed declined completed downloaded sealed
  actor         TEXT NOT NULL,                     -- owner | signer:<idx> | server
  signer_idx    INTEGER,
  at            INTEGER NOT NULL,                  -- server time
  ip            TEXT,                              -- CF-Connecting-IP
  ua            TEXT,                              -- User-Agent, first 300 characters
  doc_hash      TEXT,                              -- the fingerprint the browser had open
  detail        TEXT,                              -- small JSON: counts, flags, ciphertext reason
  PRIMARY KEY (envelope_id, seq)
);

-- Seals outlive the envelope: fingerprints and dates only (no names, no content), so a final PDF that
-- people already downloaded still verifies after the envelope is deleted.
CREATE TABLE IF NOT EXISTS sign_seals (
  final_hash    TEXT PRIMARY KEY,
  envelope_id   TEXT NOT NULL,
  seal_json     TEXT NOT NULL,                     -- canonical JSON the Worker signed
  seal_sig      TEXT NOT NULL,
  kid           TEXT NOT NULL,                     -- RFC 7638 thumbprint of the signing key
  sealed_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sign_seals_envelope ON sign_seals (envelope_id);

-- Daily envelope caps per visitor (hashed IP, as in src/index.js) and in total ('*').
CREATE TABLE IF NOT EXISTS sign_quota (
  day           TEXT NOT NULL,
  who           TEXT NOT NULL,
  n             INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, who)
);
