-- 009_users_per_network_handle.sql
--
-- Networks are isolated identities. Switching from Enjin Relay to
-- Canary (or vice-versa) goes through a confirm-and-disconnect modal
-- in the UI, so a single wallet session only ever touches one chain.
-- That lets the same handle live on both networks (your @chris on
-- Canary doesn't block a fresh @chris on Relay) - useful when you
-- want a coherent presence per chain instead of one global identity.
--
-- This migration:
--   1. ADD COLUMN network - derived cheaply from the SS58 prefix
--      (en…/cn…/ef…/cm…). Anything we can't classify stays NULL and
--      gets backfilled the next time that user signs in.
--   2. Backfill from address prefix (pure SQL, no JS decode needed).
--   3. Drop the global handle UNIQUE.
--   4. Add a per-(network, handle) UNIQUE - handles stay unique within
--      a single network but are independent across networks.
--
-- Pure SQL; safe to paste into the Neon console. Idempotent via
-- IF NOT EXISTS / probes on pg_constraint + pg_indexes.

ALTER TABLE users ADD COLUMN IF NOT EXISTS network TEXT;

UPDATE users
   SET network = CASE
     WHEN address LIKE 'en%' THEN 'enjin-relay'
     WHEN address LIKE 'cn%' THEN 'canary-relay'
     WHEN address LIKE 'ef%' THEN 'enjin-matrix'
     WHEN address LIKE 'cm%' THEN 'canary-matrix'
     ELSE NULL
   END
 WHERE network IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_network ON users(network);

-- Drop the global handle UNIQUE. The auto-generated name in older
-- Postgres versions is users_handle_key; on some it's named after the
-- column directly. IF EXISTS makes both no-op safely.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_handle_key;

-- Per-(network, handle) UNIQUE. Partial index - only rows with a
-- handle participate, so a thousand handle-less users don't fight
-- over the (network, NULL) slot.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'users_network_handle_unique'
  ) THEN
    CREATE UNIQUE INDEX users_network_handle_unique
      ON users(network, handle)
      WHERE handle IS NOT NULL;
  END IF;
END $$;
