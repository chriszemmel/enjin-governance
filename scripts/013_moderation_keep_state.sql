-- 013_moderation_keep_state.sql
--
-- A moderation decision outlives the draft it was made on: with CASCADE,
-- deleting a draft dropped the state of its held or hidden files, and /r
-- served them again. Recreate the two foreign keys as SET NULL (a no-op
-- where 011 already created them that way).
--
-- Apply with `pnpm db:migrate`. Idempotent.

ALTER TABLE moderation_state DROP CONSTRAINT IF EXISTS moderation_state_proposal_id_fkey;
ALTER TABLE moderation_state
  ADD CONSTRAINT moderation_state_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE SET NULL;

ALTER TABLE moderation_reports DROP CONSTRAINT IF EXISTS moderation_reports_proposal_id_fkey;
ALTER TABLE moderation_reports
  ADD CONSTRAINT moderation_reports_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE SET NULL;
