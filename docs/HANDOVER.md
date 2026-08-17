# Handover and Operations

The hosted instance at `gov.enjin.cloud` is run and maintained by the
project maintainer on an ongoing basis. This document is the continuity
reference: what the app runs on, what backs it, and how anyone could
stand up their own independent instance from the source.

That last point is the important one. On approval, the full repository is
published under AGPL-3.0, so the safety net for "what if the maintainer
stops" is not a credential handover. It is that anyone, including the
Enjin team, can deploy their own instance from the open source using
their own accounts. The stack is all standard, self-provisionable
infrastructure.

It deliberately does not repeat the step-by-step setup. For that:

- [`DEPLOYMENT.md`](DEPLOYMENT.md) - how to stand the whole thing up.
- [`ENVIRONMENT.md`](ENVIRONMENT.md) - every environment variable.

No secret values live in the repository. The inventory below lists what
is required and where each value comes from. A new operator provisions
their own; the maintainer's current values are never needed for that, and
would only be shared over a secure channel if ever genuinely necessary.

## 1. Deployment at a glance

| Aspect | Detail |
|---|---|
| Hosting | Vercel (Next.js App Router, auto-detected) |
| Build | `pnpm build` |
| Dev | `pnpm dev` (localhost:3000) |
| Tests | `pnpm test` (Vitest), plus `pnpm typecheck`, `pnpm lint`, `pnpm knip` |
| CI | GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, lint, knip, test, build on every push |
| Production domain | `gov.enjin.cloud` (CNAME to Vercel, Cloudflare DNS only / not proxied) |
| Database | Neon Postgres (pooled for requests, unpooled for migrations) |
| Object storage | Cloudflare R2 (S3-compatible) |
| Rate-limit store | Upstash KV (optional, falls back to in-process) |

Full provider setup is in [`DEPLOYMENT.md`](DEPLOYMENT.md).

## 2. Secrets and environment inventory

Values are provisioned per service and set in Vercel (Settings ->
Environment Variables). Full descriptions in
[`ENVIRONMENT.md`](ENVIRONMENT.md).

| Variable | Purpose | Provisioned by | Required |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Canonical site origin (CSRF host check, OpenGraph) | Set to the live domain | Yes |
| `NEXT_PUBLIC_DEFAULT_NETWORK` | Default chain (`enjin-relay` for mainnet) | Config | Yes |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect / Enjin Wallet connect | Reown Cloud | Yes |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | Postgres (requests / migrations) | Neon | Yes |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 API credentials | Cloudflare R2 | Yes |
| `R2_BUCKET` / `R2_ENDPOINT` / `R2_PUBLIC_URL` | R2 bucket name, endpoint, public base URL | Cloudflare R2 | Yes |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Shared rate-limit store (or the `UPSTASH_REDIS_REST_*` pair) | Upstash KV | Recommended |
| `NEXT_PUBLIC_*_WSS` | Custom RPC endpoints (relay / matrix, plus fallbacks) | RPC provider (Dwellir / OnFinality / self-host) | Optional |
| `SUBSCAN_API_KEY` | Call-data enrichment for old finalised referenda | pro.subscan.io | Optional |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Mirror `/security` reports to a team chat | Telegram | Optional |
| `SITE_PASSWORD` / `SITE_PASSWORD_STATUS` | Pre-launch access gate (`OFF` to disable) | Config | Optional |
| `CRON_SECRET` | Guards any scheduled route | Config | Optional |

`lib/env.ts` validates these at boot, so a missing required value fails
fast rather than silently.

## 3. Off-chain data

Two stores back the off-chain layer. The chain is always canonical for
governance; these hold human-readable metadata and the social layer.

**Neon Postgres** (schema in
[`DEPLOYMENT.md`](DEPLOYMENT.md#schema-overview)):

| Surface | Tables |
|---|---|
| Sign-in (SIWE-style) | `wallet_sessions`, `auth_nonces`, `users.is_verified` |
| Profiles | `users` (handle, display name, bio, avatar URL) |
| Comments | `comments`, `comment_reactions` |
| Proposals and drafts | `proposals`, `proposal_attachments` |
| Security reports | `security_disclosures` |

**Cloudflare R2** (object storage):

| Object | Holds |
|---|---|
| `proposal JSON` | Canonical EGOV1 metadata (title, body, attachments, hash) |
| `avatars` | User profile images |
| `proposal media` | Images / PDFs attached to a proposal |

### Export and migration

- **Database:** `pg_dump "$DATABASE_URL_UNPOOLED" > backup.sql`, restore
  with `psql` into any Postgres. The schema is plain forward-only SQL in
  `scripts/004-010`, so it is portable to any Postgres host (Neon also
  offers branching and point-in-time restore).
- **R2:** sync the bucket to any S3-compatible target with `rclone sync`
  or `aws s3 sync` (R2 speaks the S3 API), then repoint the `R2_*` vars.
- **No proprietary lock-in:** a maintainer can rebuild the full backend
  from the repo plus a Postgres dump plus an R2 sync.

> Losing the off-chain data does not lose governance state. Every
> proposal's canonical metadata is the on-chain `EGOV1:` envelope plus the
> R2 JSON it points to, recoverable straight from chain by resolving
> `referenda.metadataOf` through the preimage pallet (or, for older
> referenda, decoding the `system.remark` call args - see
> [`GOVERNANCE_FLOW.md`](GOVERNANCE_FLOW.md)).

## 4. Third-party accounts and services

Everything the hosted instance depends on. Because the code is
open-source, the primary path for a new operator is to provision their
own of each (fast, and exactly what the deploy docs describe); taking
over the maintainer's existing accounts is an alternative, not a
requirement.

| Service | Role | How a new operator gets it |
|---|---|---|
| **Vercel** | Hosting, deploys, domain, env vars | Move the project into the new owner's Vercel team, or re-import the repo into their account and re-add env vars |
| **Neon** | Postgres database | Transfer the project to the new org, or `pg_dump` and restore into their Postgres |
| **Cloudflare R2** | Object storage (JSON, avatars, media) | Move the bucket to the new Cloudflare account, or sync objects across and repoint `R2_*` |
| **Reown (WalletConnect Cloud)** | Connect project ID and allowed domains | Transfer project ownership, or the new owner creates their own project and swaps `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` plus re-adds allowed domains |
| **RPC provider** (Dwellir / OnFinality, optional) | Dedicated chain endpoints | Swap the `NEXT_PUBLIC_*_WSS` values to the new owner's endpoints |
| **Subscan API** (optional) | Call-data fallback | New owner's key in `SUBSCAN_API_KEY` |
| **Telegram** (optional) | Security-report mirror | New owner's bot token and chat id |
| **Cloudflare DNS** | `enjin.cloud` zone, `gov` record | Already controlled by Enjin |
| **GitHub** | Source repository | Public and AGPL-3.0 on approval; anyone can fork and run it. The maintainer's repo stays canonical while maintained |

## 5. Continuity if maintenance ends

This is a public good for the Enjin ecosystem, funded by the on-chain
treasury rather than by any single company. The maintainer runs the
hosted instance on an ongoing basis, so there is no transfer to perform
today and no shared credentials for anyone to rotate. This section is the
contingency for if the maintainer ever steps back.

**Notice window.** Per the funding proposal, maintenance runs only while
each quarterly referendum is approved, and ends if a quarter's request is
declined roughly three times over about a month. For any wind-down
outside that, a 30-day written notice is the suggested default.

**How continuity works.** Because the project is open-source (AGPL-3.0)
and the stack is standard, anyone in the ecosystem can stand up a fully
independent instance from the repository:

1. Provision your own accounts (Vercel, Neon, Cloudflare R2, Reown, and
   an RPC endpoint) and deploy per [`DEPLOYMENT.md`](DEPLOYMENT.md).
2. Point a domain at it. `gov.enjin.cloud` sits on Enjin's own DNS, so it
   can be repointed to a community-run deployment independently of the
   maintainer.
3. There is nothing to rotate: a new instance uses its own freshly
   provisioned credentials from the start.

**Data.** The hosted instance's off-chain data (profiles, comments,
drafts) can be exported and shared on request (section 3), but it carries
limited value. This is a client. The canonical governance record -
referenda, votes, locks, treasury, and each proposal's metadata via its
on-chain `EGOV1` remark - all lives on chain and is unaffected either
way. A fresh instance is fully functional from an empty off-chain store.

**Env values.** Not needed for any of the above. If a specific value is
ever genuinely required, it is shared only over a secure channel.

## See also

- [`DEPLOYMENT.md`](DEPLOYMENT.md) - provider setup, step by step
- [`ENVIRONMENT.md`](ENVIRONMENT.md) - every environment variable
- [`ARCHITECTURE.md`](ARCHITECTURE.md) - how the pieces fit together
- [`GOVERNANCE_FLOW.md`](GOVERNANCE_FLOW.md) - the EGOV1 metadata standard
