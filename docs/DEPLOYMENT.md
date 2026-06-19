# Deployment

The path of least resistance is **Vercel + Neon + Cloudflare R2 + Reown
(WalletConnect Cloud)**. You can be live in under an hour.

## Vercel

1. Import the repo at <https://vercel.com/new>.
2. Framework preset: **Next.js** (auto-detected).
3. Set env vars under "Settings → Environment Variables":

   | Name | Value | Environment |
   |---|---|---|
   | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | from Reown | Production, Preview, Development |
   | `NEXT_PUBLIC_APP_URL` | `https://your-domain.com` | Production |
   | `NEXT_PUBLIC_APP_URL` | `https://*.vercel.app` (or empty) | Preview |
   | `DATABASE_URL` | Neon pooled connection | Production, Preview |
   | `DATABASE_URL_UNPOOLED` | Neon unpooled connection | Production, Preview |
   | `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | from Cloudflare | Production, Preview |
   | `R2_BUCKET` | `enjin-governance` | Production, Preview |
   | `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` | Production, Preview |
   | `R2_PUBLIC_URL` | `https://<bucket>.r2.dev` or custom domain | Production, Preview |
   | `SUBSCAN_API_KEY` | optional, from `pro.subscan.io` | Production |

4. Deploy.

After the first deploy, **update Reown** to add your Vercel domain to
the project's allowed origins, otherwise the WalletConnect modal will
refuse to load metadata.

## Neon

1. Create a project at <https://neon.tech>.
2. Copy both the **pooled** (`-pooler.neon.tech`) and **unpooled**
   connection strings - the app uses the pooled one for requests, the
   unpooled one for migrations.
3. Apply the migrations in order:

   ```bash
   psql "$DATABASE_URL_UNPOOLED" -f scripts/004_proposals_comments_profiles.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/005_user_verification.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/006_proposal_edits.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/007_proposal_withdrawal.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/008_auth_nonces.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/009_users_per_network_handle.sql
   psql "$DATABASE_URL_UNPOOLED" -f scripts/010_security_disclosures.sql
   ```

   (or `pnpm db:migrate`, which runs `scripts/run-migrations.mjs`.)

4. Set `DATABASE_URL` + `DATABASE_URL_UNPOOLED` in Vercel.

The app degrades gracefully when `DATABASE_URL` is unset: sign-in
returns 503, the auth / profile / comments / drafts surfaces show
"unavailable", and the rest of the app keeps working off the RPC.

### Schema overview

The migrations create:

| Table | Purpose |
|---|---|
| `users` | One row per SS58 address. Profile fields (display name, handle, bio, avatar URL, `is_verified`) live here. |
| `wallet_sessions` | httpOnly session cookies. Rotating; one row per signed-in session. |
| `proposals` | Off-chain mirror of every proposal filed through the wizard. `status ∈ ('draft', 'submitted', 'on_chain', 'failed', 'cancelled')`. The R2 JSON is canonical; this row is a fast index. |
| `proposal_attachments` | Image / PDF attachments referenced by a proposal. R2 objects. |
| `comments` | Threaded comments per referendum. Soft-deletable. |
| `comment_reactions` | Up/down votes on comments. |
| `auth_nonces` | Short-lived SIWE sign-in nonces, consumed atomically on verify (added in `008`). |
| `security_disclosures` | Inbound vulnerability reports from the public `/security` form (added in `010`). No account required; IP-rate-limited and honeypot-guarded against bots, raw IP never stored. |

The `updated_at` trigger function ships with the same migration.
There's no migration framework wired in by design - flat, forward-only
SQL files are easier to audit than a Prisma/Drizzle pipeline. Revisit
if migration count exceeds ~20.

## Cloudflare R2

1. Create an R2 bucket at <https://dash.cloudflare.com> (default name
   in env is `enjin-governance`).
2. Create an R2 API token with read + write on the bucket.
3. Either enable the bucket's public `r2.dev` URL or attach a custom
   domain. Both work; the custom domain is faster and survives
   rate-limited public dev URLs.
4. Paste the credentials + the public base URL into Vercel.

CORS isn't required - every R2 write goes through our API routes
server-side. Reads are direct from the browser via the public URL but
that's a GET-only HEAD-friendly fetch, no preflight.

## Reown (WalletConnect Cloud)

1. Create a project at <https://cloud.reown.com>.
2. Name it "Enjin Governance" (or whatever).
3. App URL: your Vercel domain.
4. Copy the 32-char project ID into Vercel env vars.
5. Under "Allowed Domains", add:
   - your production domain,
   - `*.vercel.app` for preview deploys,
   - `localhost:3000` for local dev.

## Custom RPC (optional, recommended for production)

Public RPC endpoints rate-limit. For real traffic:

- **Dwellir** - already wired as fallback. Sign up at <https://www.dwellir.com>
  for a higher quota.
- **OnFinality** - alternative provider. Both relay and matrix supported.
- **Self-hosted** - run an Enjin node and proxy WS.

Set `NEXT_PUBLIC_ENJIN_RELAY_WSS` to your dedicated endpoint.

## Custom domain

In Vercel:

1. "Settings → Domains" → add your domain.
2. Add DNS records as instructed.
3. Update `NEXT_PUBLIC_APP_URL` to match.
4. Update Reown allowed origins.

## CSP and security headers

Defined in `next.config.mjs`. If you add new external services (a new
RPC provider, an analytics tool, etc.), update `connect-src`
accordingly.

## Monitoring

`@vercel/analytics` is in the dependency list - wire it into
`app/layout.tsx` when ready (it's a 2-line addition).

For chain-level errors (RPC connect failures, signing errors), the app
already surfaces them to the user via toast + `friendlyError()`. For
long-term tracking, an opt-in Sentry integration is the right move -
not in v1.

## Rollback

Vercel preserves previous deploys. To roll back:

1. "Deployments" tab → find the last good deploy → "Promote to Production".

Migrations are forward-only - Neon doesn't auto-revert. Keep
migrations backward-compatible (add columns, don't drop) for at least
one deploy cycle.

## See also

- [`ENVIRONMENT.md`](ENVIRONMENT.md) - every env var
- [`WALLET_INTEGRATION.md`](WALLET_INTEGRATION.md) - Reown setup
