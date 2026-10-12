-- 011_moderation.sql
--
-- Moderation (patch v1.4) and automatic content checks (v1.5).
--
--   moderation_roles    who may moderate. Keyed by the 32-byte public key,
--                       so a wallet keeps its role on every network prefix.
--                       Admins listed in GOVERNANCE_ADMIN_PUBLIC_KEYS need no
--                       row; rows are grants made from /moderation.
--   moderation_state    current state of a proposal, one of its attachments
--                       (by bucket key) or a comment: visible / blurred /
--                       hidden / removed. No row = visible.
--   moderation_actions  the public log. Every change carries a reason.
--   moderation_reports  user reports and automatic flags, open until a
--                       moderator decides.
--   moderation_suspensions
--                       admins can pause someone's posting (comments,
--                       drafts, edits, uploads). Keyed by public key, so a
--                       pause holds whatever network format the wallet
--                       signs in with.
--
-- Nothing here touches referenda, votes or on-chain data, and moderation
-- never rewrites anyone's text: proposal.json stays byte-identical, so its
-- EGOV1 verification is unaffected.
--
-- Apply with `pnpm db:migrate` (or paste into the Neon console). Idempotent.

CREATE TABLE IF NOT EXISTS moderation_roles (
  public_key  TEXT        PRIMARY KEY,
  role        TEXT        NOT NULL,
  granted_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT moderation_roles_role CHECK (role IN ('moderator', 'admin')),
  CONSTRAINT moderation_roles_key CHECK (public_key ~ '^0x[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS moderation_state (
  target_type TEXT        NOT NULL,
  target_id   TEXT        NOT NULL,
  proposal_id UUID        REFERENCES proposals(id) ON DELETE SET NULL,
  state       TEXT        NOT NULL,
  reason      TEXT,
  source      TEXT        NOT NULL DEFAULT 'moderator',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_type, target_id),
  CONSTRAINT moderation_state_type CHECK (target_type IN ('proposal', 'attachment', 'comment')),
  CONSTRAINT moderation_state_state CHECK (state IN ('visible', 'blurred', 'hidden', 'removed')),
  CONSTRAINT moderation_state_source CHECK (source IN ('moderator', 'proposer', 'automatic'))
);

CREATE INDEX IF NOT EXISTS idx_moderation_state_proposal ON moderation_state(proposal_id);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type      TEXT        NOT NULL,
  target_id        TEXT        NOT NULL,
  proposal_id      UUID        REFERENCES proposals(id) ON DELETE SET NULL,
  network          TEXT,
  referendum_index INTEGER,
  action           TEXT        NOT NULL,
  reason           TEXT        NOT NULL,
  source           TEXT        NOT NULL DEFAULT 'moderator',
  actor_public_key TEXT,
  actor_label      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT moderation_actions_type
    CHECK (target_type IN ('proposal', 'attachment', 'comment', 'user', 'role')),
  CONSTRAINT moderation_actions_action
    CHECK (action IN ('keep', 'blur', 'hide', 'restore', 'delete_file',
                      'suspend', 'unsuspend', 'grant', 'revoke')),
  CONSTRAINT moderation_actions_source CHECK (source IN ('moderator', 'proposer', 'automatic')),
  CONSTRAINT moderation_actions_reason_len CHECK (char_length(reason) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_moderation_actions_created ON moderation_actions(created_at DESC);

CREATE TABLE IF NOT EXISTS moderation_reports (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type      TEXT        NOT NULL,
  target_id        TEXT        NOT NULL,
  proposal_id      UUID        REFERENCES proposals(id) ON DELETE SET NULL,
  source           TEXT        NOT NULL DEFAULT 'user',
  reporter_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
  category         TEXT        NOT NULL,
  severity         TEXT        NOT NULL DEFAULT 'medium',
  note             TEXT,
  details          JSONB,
  status           TEXT        NOT NULL DEFAULT 'open',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at      TIMESTAMPTZ,
  CONSTRAINT moderation_reports_type CHECK (target_type IN ('proposal', 'attachment', 'comment')),
  CONSTRAINT moderation_reports_source CHECK (source IN ('user', 'automatic')),
  CONSTRAINT moderation_reports_category
    CHECK (category IN ('personal_data', 'scam', 'sexual_violent', 'harassment',
                        'secrets', 'illegal', 'spam', 'other')),
  CONSTRAINT moderation_reports_severity CHECK (severity IN ('low', 'medium', 'high')),
  CONSTRAINT moderation_reports_status CHECK (status IN ('open', 'resolved', 'dismissed')),
  CONSTRAINT moderation_reports_note_len CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_moderation_reports_open
  ON moderation_reports(status, created_at DESC);
-- One open report per person per item, and one open automatic flag.
CREATE UNIQUE INDEX IF NOT EXISTS uq_moderation_reports_open_reporter
  ON moderation_reports(target_type, target_id, reporter_user_id)
  WHERE status = 'open' AND reporter_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_moderation_reports_open_automatic
  ON moderation_reports(target_type, target_id)
  WHERE status = 'open' AND source = 'automatic';

CREATE TABLE IF NOT EXISTS moderation_suspensions (
  public_key  TEXT        PRIMARY KEY,
  until       TIMESTAMPTZ NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT moderation_suspensions_key CHECK (public_key ~ '^0x[0-9a-f]{64}$')
);
