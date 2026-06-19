-- 010_security_disclosures.sql
--
-- Inbound security / vulnerability reports from the public disclosure form
-- (POST /api/security-disclosures, page /security). No account required - a
-- researcher should be able to report without connecting a wallet - so the
-- route is rate-limited by IP and we store only a salted-free SHA-256 of the
-- IP for abuse correlation, never the raw address.
--
-- Apply with:
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/010_security_disclosures.sql
-- or via the migration runner:
--   pnpm db:migrate
CREATE TABLE security_disclosures (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  severity   TEXT         NOT NULL,           -- low | medium | high | critical
  category   TEXT,                            -- optional free-form area
  summary    TEXT         NOT NULL,
  details    TEXT         NOT NULL,
  contact    TEXT,                            -- optional, for follow-up
  network    TEXT,                            -- optional chain id
  status     TEXT         NOT NULL DEFAULT 'new',  -- new | triaged | resolved | dismissed
  ip_hash    TEXT,                            -- sha256(ip), not PII
  user_agent TEXT,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Triage queue: newest open reports first.
CREATE INDEX idx_security_disclosures_status
  ON security_disclosures(status, created_at DESC);
