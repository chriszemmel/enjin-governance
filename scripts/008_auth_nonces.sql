-- 008_auth_nonces.sql
--
-- SIWE nonces, persisted. The auth flow:
--
--   1. POST /api/auth/nonce inserts a row (nonce, address, the exact
--      message bytes we handed to the wallet, expires_at).
--   2. The wallet signs those bytes.
--   3. POST /api/auth/verify DELETEs the row and reads back the
--      stored message; if the DELETE returned no row, the nonce is
--      unknown, expired, or bound to a different address.
--
-- Nonces persist in Postgres so verification is independent of which
-- serverless instance handles each hop: the verify request can land on a
-- different instance than the one that minted the nonce and still resolve it.
--
-- Apply with:
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/008_auth_nonces.sql
-- or via the migration runner:
--   pnpm db:migrate
CREATE TABLE auth_nonces (
  nonce      TEXT         PRIMARY KEY,
  address    TEXT         NOT NULL,
  message    TEXT         NOT NULL,
  expires_at TIMESTAMPTZ  NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Used by the periodic GC sweep in /api/auth/nonce. Skinny index keeps
-- the cleanup query a partial scan rather than a seq scan on the whole
-- table, which matters once the row count rises.
CREATE INDEX idx_auth_nonces_expires ON auth_nonces(expires_at);
