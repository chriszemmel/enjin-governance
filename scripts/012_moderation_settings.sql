-- 012_moderation_settings.sql
--
-- Settings for the automatic content checks, editable by admins at
-- /moderation → Settings, and a per-day usage counter so the cost stays
-- visible and a daily cap can be enforced.
--
-- Apply with `pnpm db:migrate`. Idempotent.

CREATE TABLE IF NOT EXISTS moderation_settings (
  key        TEXT        PRIMARY KEY,
  value      JSONB       NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderation_scan_usage (
  day           DATE    NOT NULL,
  model         TEXT    NOT NULL,
  kind          TEXT    NOT NULL,
  checks        INTEGER NOT NULL DEFAULT 0,
  input_tokens  BIGINT  NOT NULL DEFAULT 0,
  output_tokens BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model, kind),
  CONSTRAINT moderation_scan_usage_kind CHECK (kind IN ('images', 'pdfs', 'proposals', 'comments'))
);
