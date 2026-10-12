-- 014_drop_proposer_signature.sql
--
-- proposals.proposer_signature was never written (every draft stored NULL)
-- and nothing reads it. 2.0 no longer names it, but 1.0 still inserts it:
-- dropping it while 1.0 serves breaks staging drafts there, and so does a
-- rollback to 1.0 afterwards.
--
-- Apply only AFTER 2.0 is deployed, once a rollback to 1.0 is no longer
-- wanted. Before the deploy, apply the earlier files with
-- `pnpm db:migrate --until 013`; afterwards, `pnpm db:migrate`.
--
-- Idempotent.

ALTER TABLE proposals DROP COLUMN IF EXISTS proposer_signature;
