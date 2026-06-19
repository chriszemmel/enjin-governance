-- 006_proposal_edits.sql
--
-- Lets the proposer edit a proposal's narrative (title/summary/body/
-- attachments) after it's on-chain by overwriting the R2 JSON. We track
-- the edit timestamp + count so the UI can surface "(edited)" and we
-- can decode the divergence from the on-chain pinned sha256.
--
-- The on-chain `system.remark` hash NEVER changes - it pins the original
-- bytes. After an edit the bucket sha256 will diverge from the pinned
-- one; that's expected and visible to external indexers.
--
-- Apply with:
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/006_proposal_edits.sql

BEGIN;

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS edited_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_count  INTEGER     NOT NULL DEFAULT 0;

COMMIT;
