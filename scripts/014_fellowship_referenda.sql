-- 014_fellowship_referenda.sql
--
-- The Fellowship's referenda (F#N) are numbered apart from the public ones
-- (#N): F#0 and #0 are different referenda. Proposals and moderation
-- actions say which pallet their index belongs to, and an index is unique
-- per network AND pallet.
--
-- Additive: existing rows are public referenda (the default), and 1.0
-- keeps working against it, so apply it before deploying 2.0, with
-- 011-013 (`pnpm db:migrate --until 014`). Idempotent.

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS referenda_pallet TEXT NOT NULL DEFAULT 'referenda';
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_referenda_pallet_check;
ALTER TABLE proposals
  ADD CONSTRAINT proposals_referenda_pallet_check
  CHECK (referenda_pallet IN ('referenda', 'fellowshipReferenda'));

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_network_index_unique;
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_network_pallet_index_unique;
ALTER TABLE proposals
  ADD CONSTRAINT proposals_network_pallet_index_unique
  UNIQUE (network, referenda_pallet, referendum_index);

DROP INDEX IF EXISTS idx_proposals_network_index;
CREATE INDEX IF NOT EXISTS idx_proposals_network_pallet_index
  ON proposals(network, referenda_pallet, referendum_index)
  WHERE referendum_index IS NOT NULL;

ALTER TABLE moderation_actions
  ADD COLUMN IF NOT EXISTS referenda_pallet TEXT NOT NULL DEFAULT 'referenda';
