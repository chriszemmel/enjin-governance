# Environment

Every env var the app reads is declared in `lib/env.ts` with a zod
schema. That file is the single source of truth - `.env.example`
mirrors it.

## How env loading works

- **Server-side** vars (no `NEXT_PUBLIC_` prefix) are read on the server
  only. Trying to import them from the client throws.
- **Client-side** vars (`NEXT_PUBLIC_*`) are inlined into the browser
  bundle at build time. Never put secrets here.
- `lib/env.ts` parses both at startup. Missing or invalid values throw
  at first use with a clear error.

## Required for development

| Variable | Where used | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | OpenGraph + deep-link callbacks | Defaults to `http://localhost:3000`. |

## Required for the WalletConnect / Enjin Wallet flow

| Variable | Where used | Notes |
|---|---|---|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | `lib/wallet/connectors/walletconnect.ts` | 32-char hex from <https://cloud.reown.com>. Optional at build time - when unset, the WalletConnect and Enjin Wallet entries show as "not configured" in the connect modal but the four browser-extension wallets (Polkadot.js / Talisman / SubWallet / PolkaGate) keep working. |

## Required for sign-in, profiles, comments, proposal drafts

| Variable | Where used | Notes |
|---|---|---|
| `DATABASE_URL` | `lib/db/client.ts` | Neon pooled connection string (ends `-pooler.neon.tech`). Without it, sign-in returns 503 and the auth/profile/comments/drafts surfaces degrade gracefully. |
| `DATABASE_URL_UNPOOLED` | migrations only | Unpooled connection string. Used by `pnpm db:migrate` because Neon's pgbouncer drops sessions mid-transaction. |

## Required for proposal JSON + avatars (R2)

The bucket layout (set in `lib/r2/paths.ts`) is:

```
proposals/{network}/{uuid}/proposal.json
proposals/{network}/{uuid}/media/{filename}
proposals/{network}/index/{referendum_index}.json
user-avatars/{user_uuid}.png
```

| Variable | Where used | Notes |
|---|---|---|
| `R2_ACCOUNT_ID` | `lib/r2/client.ts` | Your Cloudflare account id. |
| `R2_ACCESS_KEY_ID` | `lib/r2/client.ts` | R2 API token (read + write on the bucket). |
| `R2_SECRET_ACCESS_KEY` | `lib/r2/client.ts` | Pair to the access key. |
| `R2_BUCKET` | `lib/r2/client.ts` | Defaults to `enjin-governance`. |
| `R2_ENDPOINT` | `lib/r2/client.ts` | `https://<account-id>.r2.cloudflarestorage.com`. |
| `R2_PUBLIC_URL` | `lib/r2/client.ts` | Public URL serving the bucket (r2.dev domain or your custom domain). |

## Optional

| Variable | Where used | Notes |
|---|---|---|
| `SUBSCAN_API_KEY` | `lib/subscan/client.ts` | Enables call-data enrichment for very old finalised referenda. Optional: without a key, calls fall back to Subscan's public rate limits (fine for enriching one referendum at a time); an over-limit call returns null and the UI degrades gracefully. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | `lib/rate-limit.ts` | Set both (Upstash KV REST credentials) and rate limiting uses a shared store, so ceilings hold across serverless instances. The native Upstash names `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are also accepted, so either integration works. Unset, or on a transient KV error, it falls back to a per-instance in-process store - rate limiting is never fully disabled. Any other vars the integration injects (e.g. `KV_URL`, `REDIS_URL`, `KV_REST_API_READ_ONLY_TOKEN`) are ignored. Recommended for production. |
| `CRON_SECRET` | future cron handlers | Not currently used; reserved for any post-v1 background job. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | `lib/security/notify.ts` | Set both to also push each `/security` disclosure to a Telegram chat (e.g. a shared Enjin team group). Token from @BotFather; chat id is the group id (add the bot first). Unset = disclosures persist to the DB only. |

## Moderation

| Variable | Where used | Notes |
|---|---|---|
| `GOVERNANCE_ADMIN_PUBLIC_KEYS` | `lib/auth/roles.ts` | Wallets that are always admins: comma or space separated SS58 addresses (any network prefix) or 0x public keys. Admins grant further moderator/admin roles in `/moderation → Roles` (stored in the database). Needs migration `011`. |
| `ANTHROPIC_API_KEY` | `lib/moderation/scan.ts` | Enables the automatic content checks. Having the key alone checks nothing: an admin switches the checks on and picks the model, the kinds checked and a daily limit in `/moderation → Settings` (needs migration `012`). The key never leaves the server. |

## Legal pages and footer

The imprint (`/imprint`), privacy policy (`/privacy`) and terms (`/terms`)
read the operator's details from the environment so nothing personal is
committed. A missing value shows as an amber "not configured" placeholder
on the page. The pages are prerendered, so **redeploy after changing
these**.

| Variable | Notes |
|---|---|
| `LEGAL_OPERATOR_NAME` | Full name (or company) of the person responsible. |
| `LEGAL_OPERATOR_ADDRESS` | Postal address for service. Separate lines with `\|` or newlines, e.g. `Street 1 \| 12345 City \| Germany`. |
| `LEGAL_CONTACT_EMAIL` | Contact address, also used for reports and complaints. |
| `LEGAL_CONTACT_PHONE` | Optional. |
| `LEGAL_VAT_ID` | Optional; only if you have one. |
| `NEXT_PUBLIC_SITE_MAINTAINER` | Name in the footer disclaimer. Default `Chris Zemmel`. |
| `NEXT_PUBLIC_SOURCE_URL` | Public repository for the AGPL source offer in the footer and terms. Default `https://github.com/chriszemmel/enjin-governance`. |

## Site password gate

Pre-launch / staging access control. The Next.js proxy (`proxy.ts`)
redirects every unauthenticated, non-static request to `/unlock`. The
page POSTs to `/api/unlock`, which validates the password and sets a
signed, HTTP-only access cookie (SHA-256 of `SITE_PASSWORD`, so
rotating the password invalidates every existing session).

| Variable | Notes |
|---|---|
| `SITE_PASSWORD_STATUS` | `ON` to require the password, `OFF` (default) to disable the gate entirely. |
| `SITE_PASSWORD` | The shared password. Required when `SITE_PASSWORD_STATUS=ON`; the gate fails closed (every unlock returns 503) when unset. |

## Network defaults (override if needed)

| Variable | Default |
|---|---|
| `NEXT_PUBLIC_DEFAULT_NETWORK` | `canary-relay` (set to `enjin-relay` for mainnet) |
| `NEXT_PUBLIC_ENJIN_RELAY_WSS` | `wss://rpc.relay.blockchain.enjin.io` |
| `NEXT_PUBLIC_ENJIN_RELAY_FALLBACK_WSS` | `wss://enjin-relay-rpc.n.dwellir.com` |
| `NEXT_PUBLIC_ENJIN_MATRIX_WSS` | `wss://rpc.matrix.blockchain.enjin.io` |
| `NEXT_PUBLIC_ENJIN_MATRIX_FALLBACK_WSS` | `wss://enjin-matrix-rpc.n.dwellir.com` |
| `NEXT_PUBLIC_CANARY_RELAY_WSS` | `wss://rpc.relay.canary.enjin.io` |
| `NEXT_PUBLIC_CANARY_MATRIX_WSS` | `wss://rpc.matrix.canary.enjin.io` |
| `NEXT_PUBLIC_WALLETCONNECT_RELAY_URL` | `wss://relay.walletconnect.com` |
| `NEXT_PUBLIC_ENJIN_SUBSCAN_URL` | `https://enjin.subscan.io` (deep links) |
| `NEXT_PUBLIC_MATRIX_SUBSCAN_URL` | `https://matrix.subscan.io` |
| `NEXT_PUBLIC_CANARY_SUBSCAN_URL` | `https://canary.subscan.io` |
| `NEXT_PUBLIC_CANARY_MATRIX_SUBSCAN_URL` | `https://canary-matrix.subscan.io` |

Archive RPCs (`wss://archive.relay.{blockchain,canary}.enjin.io`) are
hard-wired in `lib/chain/chains.ts`. They're public and stable enough
that pulling them into env vars buys us nothing.

## Adding a new env var

1. Add it to `lib/env.ts` with a zod schema.
2. Add it to `.env.example` with a comment describing what it does.
3. Add an entry in this file.
4. If it's client-side, prefix with `NEXT_PUBLIC_` AND declare it on
   the `client: { … }` half of the schema in `lib/env.ts`. Both halves
   are required for `@t3-oss/env-nextjs` to expose it to the browser.

## Build-time vs runtime

- `NEXT_PUBLIC_*` vars are **inlined at build time**. Changing them in
  `.env.local` after `pnpm build` has no effect on the built artifacts.
- Server-side vars are **read at runtime** from the process environment.
  On Vercel, set them in the project settings; they apply on next deploy.

## CI

CI runs the build with placeholder values for the variables that must
be present for `next build` to succeed. See `.github/workflows/ci.yml`.

## See also

- [`DEPLOYMENT.md`](DEPLOYMENT.md) - Vercel env vars + R2 + Neon setup
- [`WALLET_INTEGRATION.md`](WALLET_INTEGRATION.md) - WC project ID setup
