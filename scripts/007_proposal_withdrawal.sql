-- 007_proposal_withdrawal.sql
--
-- Proposer-driven off-chain withdrawal. The referendum stays `on_chain`
-- (the chain state is unchanged), but `withdrawn_at` flips on so the
-- detail page can render a "the proposer asks voters to NAY this"
-- banner. Reason is an optional one-line explanation shown in the
-- banner.
--
-- Apply with:
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/007_proposal_withdrawal.sql

BEGIN;

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS withdrawn_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdrawn_reason  TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'proposals_withdrawn_reason_len'
  ) THEN
    ALTER TABLE proposals
      ADD CONSTRAINT proposals_withdrawn_reason_len
      CHECK (withdrawn_reason IS NULL OR char_length(withdrawn_reason) <= 280);
  END IF;
END $$;

COMMIT;
