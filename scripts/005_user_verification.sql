-- 005_user_verification.sql
--
-- Manual verification flag on users. Flipped via direct DB access only -
-- there is no API surface that lets a connected wallet self-verify.
-- A small `verified_at` timestamp records when the flag was set so the
-- profile page can show "Verified since …" if we ever want to.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_verified  BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_verified ON users(is_verified) WHERE is_verified;

COMMIT;
