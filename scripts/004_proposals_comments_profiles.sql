-- 004_proposals_comments_profiles.sql
--
-- Off-chain home for proposal narrative, comments, and user profiles.
--
-- Source-of-truth for proposal metadata is the JSON blob in R2; this
-- schema mirrors the indexable fields plus carries the inherently
-- mutable data (comments, profiles) that doesn't belong on chain.
--
-- Apply with:
--   psql "$DATABASE_URL_UNPOOLED" -f scripts/004_proposals_comments_profiles.sql
--
-- (Use the unpooled URL - Neon's pgbouncer drops sessions mid-DDL.)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- One row per SS58 address we've seen. Auto-created on first wallet connect.
-- A future "merge identities" feature can introduce a join table without
-- breaking callers that look up by address.
CREATE TABLE users (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  address           TEXT         NOT NULL UNIQUE,
  handle            CITEXT       UNIQUE,
  display_name      TEXT,
  bio               TEXT,
  avatar_url        TEXT,
  avatar_key        TEXT,
  avatar_updated_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT users_handle_format
    CHECK (handle IS NULL OR handle ~ '^[a-z0-9_]{3,32}$'),
  CONSTRAINT users_bio_len
    CHECK (bio IS NULL OR char_length(bio) <= 500),
  CONSTRAINT users_display_len
    CHECK (display_name IS NULL OR char_length(display_name) <= 80)
);

CREATE INDEX idx_users_address ON users(address);

-- ---------------------------------------------------------------------------
-- wallet_sessions  (SIWE-style bearer tokens for comment / profile writes)
-- ---------------------------------------------------------------------------
-- A signed-message exchange grants a bearer token valid for ~30 days.
-- token_hash is sha256 of the opaque token so the DB never sees the secret.
CREATE TABLE wallet_sessions (
  token_hash   TEXT         PRIMARY KEY,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address      TEXT         NOT NULL,
  issued_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ  NOT NULL,
  last_seen_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  user_agent   TEXT,
  ip_address   INET
);

CREATE INDEX idx_wallet_sessions_user    ON wallet_sessions(user_id);
CREATE INDEX idx_wallet_sessions_expires ON wallet_sessions(expires_at);

-- ---------------------------------------------------------------------------
-- proposals  (mirror of the R2 proposal.json + the on-chain pointer)
-- ---------------------------------------------------------------------------
-- Lifecycle:
--   draft     → JSON uploaded, extrinsic not yet broadcast
--   submitted → batchAll broadcast, awaiting finalization
--   on_chain  → finalized, referendum_index populated
--   failed    → dispatch error; details in last_error
--   cancelled → user aborted before broadcast
CREATE TABLE proposals (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  network            TEXT        NOT NULL,
  referendum_index   INTEGER,
  proposer_user_id   UUID        REFERENCES users(id) ON DELETE SET NULL,
  proposer_address   TEXT        NOT NULL,

  title              TEXT        NOT NULL,
  summary            TEXT,
  body_markdown      TEXT        NOT NULL DEFAULT '',

  track              TEXT,
  beneficiary        TEXT,
  amount_planck      NUMERIC(40, 0),

  json_url           TEXT        NOT NULL,
  json_key           TEXT        NOT NULL,
  json_sha256        TEXT        NOT NULL,
  proposer_signature TEXT,

  preimage_hash      TEXT,
  preimage_len       INTEGER,
  remark_payload     TEXT,
  tx_hash            TEXT,
  block_hash         TEXT,
  block_number       BIGINT,

  status             TEXT        NOT NULL DEFAULT 'draft',
  last_error         TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT proposals_status_check
    CHECK (status IN ('draft','submitted','on_chain','failed','cancelled')),
  CONSTRAINT proposals_title_len
    CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT proposals_summary_len
    CHECK (summary IS NULL OR char_length(summary) <= 500),
  CONSTRAINT proposals_body_len
    CHECK (char_length(body_markdown) <= 100000),
  CONSTRAINT proposals_amount_nonneg
    CHECK (amount_planck IS NULL OR amount_planck >= 0),
  CONSTRAINT proposals_network_index_unique
    UNIQUE (network, referendum_index)
);

CREATE INDEX idx_proposals_network_status   ON proposals(network, status);
CREATE INDEX idx_proposals_proposer_address ON proposals(proposer_address);
CREATE INDEX idx_proposals_proposer_user    ON proposals(proposer_user_id);
CREATE INDEX idx_proposals_created_at       ON proposals(created_at DESC);
CREATE INDEX idx_proposals_network_index
  ON proposals(network, referendum_index)
  WHERE referendum_index IS NOT NULL;

-- ---------------------------------------------------------------------------
-- proposal_attachments  (uploaded files in proposals/<uuid>/media/*)
-- ---------------------------------------------------------------------------
CREATE TABLE proposal_attachments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  UUID        NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  bucket_key   TEXT        NOT NULL UNIQUE,
  url          TEXT        NOT NULL,
  filename     TEXT        NOT NULL,
  content_type TEXT        NOT NULL,
  size_bytes   BIGINT      NOT NULL,
  sha256       TEXT        NOT NULL,
  uploaded_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attachments_size_limit
    CHECK (size_bytes > 0 AND size_bytes <= 20 * 1024 * 1024),
  CONSTRAINT attachments_filename_len
    CHECK (char_length(filename) BETWEEN 1 AND 255)
);

CREATE INDEX idx_attachments_proposal ON proposal_attachments(proposal_id);

-- ---------------------------------------------------------------------------
-- comments  (threaded, soft-deletable, scoped to a proposal)
-- ---------------------------------------------------------------------------
CREATE TABLE comments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id    UUID        NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  parent_id      UUID        REFERENCES comments(id) ON DELETE CASCADE,
  user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_address TEXT        NOT NULL,
  body_markdown  TEXT        NOT NULL,
  is_deleted     BOOLEAN     NOT NULL DEFAULT FALSE,
  edited_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT comments_body_len
    CHECK (char_length(body_markdown) BETWEEN 1 AND 10000),
  CONSTRAINT comments_no_self_parent
    CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX idx_comments_proposal_created ON comments(proposal_id, created_at);
CREATE INDEX idx_comments_user             ON comments(user_id);
CREATE INDEX idx_comments_parent
  ON comments(parent_id)
  WHERE parent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- comment_reactions  (one row per user per emoji per comment)
-- ---------------------------------------------------------------------------
CREATE TABLE comment_reactions (
  comment_id UUID        NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  emoji      TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id, emoji),
  CONSTRAINT comment_reactions_emoji_len
    CHECK (char_length(emoji) BETWEEN 1 AND 16)
);

CREATE INDEX idx_comment_reactions_comment ON comment_reactions(comment_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_proposals_updated_at
  BEFORE UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
