# Environment

Every environment variable the app reads is declared in `lib/env.ts`, with a
Zod schema for each. That file is the source of truth. `.env.example` lists
every variable with a short comment, and this page explains what each one
does.

Two names are read outside `lib/env.ts`: `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`, accepted by `lib/rate-limit.ts` as alternatives
to the `KV_REST_API_*` pair.

## How loading works

- **Server variables** (no `NEXT_PUBLIC_` prefix) are available on the
  server only. Reading one in browser code throws.
- **Browser variables** (`NEXT_PUBLIC_*`) are built into the browser bundle.
  Never put a secret in one.
- **Validation.** `lib/env.ts` checks every value when it is first imported.
  An invalid value throws an error that names the variable, for example an
  `R2_ENDPOINT` that does not start with `https://`, a `CRON_SECRET` shorter
  than 16 characters, or a `SITE_PASSWORD_STATUS` other than `ON` or `OFF`.
- **Nothing is required.** Every variable is optional or has a default. A
  missing value never stops the app; the feature that needs it is off, and
  its API routes answer `503`.
- **Empty values count as unset**, so `NAME=` in `.env.local` means the
  default applies.
- `SKIP_ENV_VALIDATION=true` skips the checks. `pnpm lint` does this on its
  own. Never set it in production.

## Build time and runtime

- `NEXT_PUBLIC_*` values are fixed when the app is built. Changing them
  after `pnpm build` has no effect until the next build.
- Server variables are read at runtime. On Vercel, a change only applies to
  new deployments, so redeploy after changing one.
- Pages that are prerendered at build time, such as the legal pages, keep
  the values they were built with.

## What each feature needs

| Feature | Variables |
|---|---|
| Browsing and voting with browser-extension wallets | None |
| Enjin Wallet and WalletConnect | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` |
| Sign-in, profiles, comments, drafts, security reports | `DATABASE_URL`, plus migrations |
| Proposal JSON, attachments, avatars | All five `R2_*` credentials and URLs, plus the database |
| Moderation | `GOVERNANCE_ADMIN_PUBLIC_KEYS`, plus migrations `011` to `013` |
| Automatic content checks | `ANTHROPIC_API_KEY`, migration `012`, switched on by an admin |
| Rate limits shared across instances | `KV_REST_API_URL` and `KV_REST_API_TOKEN` |
| Telegram notices | `TELEGRAM_BOT_TOKEN` and a chat ID |
| A public deployment | `NEXT_PUBLIC_APP_URL`, `LEGAL_*`, `NEXT_PUBLIC_SITE_MAINTAINER`, `NEXT_PUBLIC_SOURCE_URL` |

## App

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | The canonical origin of the deployment. Used for OpenGraph and WalletConnect metadata, links in Telegram notices, the cross-site check, and as the base of every file URL (`<origin>/r/...`), including the EGOV1 pointer pinned on chain. Set it to the production domain before any real proposal is filed: a wrong value is pinned on chain for good. |
| `NEXT_PUBLIC_DEFAULT_NETWORK` | `canary-relay` | The network the app opens on: `canary-relay` or `enjin-relay` (mainnet). Users can switch in the app. |

## Wallet

| Variable | Default | Notes |
|---|---|---|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | unset | Project ID from <https://cloud.reown.com>. Enables Enjin Wallet and generic WalletConnect (`lib/wallet/connectors/walletconnect.ts`). Unset, those two show as not configured and the browser-extension wallets (Polkadot.js, Talisman, SubWallet, PolkaGate) keep working. |
| `NEXT_PUBLIC_WALLETCONNECT_RELAY_URL` | `wss://relay.walletconnect.com` | WalletConnect relay. |

## Database (Neon Postgres)

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Pooled connection string (the host contains `-pooler`). Used for every request (`lib/db/client.ts`). Unset, sign-in answers `503`, and profiles, comments, drafts, moderation and security reports are unavailable. The rest of the app keeps working from the chain. |
| `DATABASE_URL_UNPOOLED` | Unpooled connection string. Used only by `pnpm db:migrate` (`scripts/run-migrations.mjs`), which falls back to `DATABASE_URL`. Prefer the unpooled URL: the pooler can drop sessions during long schema changes. |

## Storage (Cloudflare R2)

Storage counts as configured only when `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` and `R2_PUBLIC_URL` are all set
(`lib/r2/client.ts`). Otherwise uploads and the `/r` file route answer
`503`.

| Variable | Default | Notes |
|---|---|---|
| `R2_ACCOUNT_ID` | unset | Cloudflare account ID. |
| `R2_ACCESS_KEY_ID` | unset | R2 API token with object read and write access to the bucket. |
| `R2_SECRET_ACCESS_KEY` | unset | Secret for that token. |
| `R2_BUCKET` | `enjin-governance` | Bucket name. |
| `R2_ENDPOINT` | unset | `https://<account-id>.r2.cloudflarestorage.com`. Must start with `https://`. |
| `R2_PUBLIC_URL` | unset | The bucket's own public URL (`r2.dev` or a custom domain). The app serves files through its own `/r` route, so beyond the check above this is only used to recognise older draft versions staged under the bucket's URL. If public access is off, any `https://` placeholder works. |

The bucket layout (`lib/r2/paths.ts`):

```
proposals/{network}/{uuid}/proposal-{sha256 prefix}.json   one per staged version
proposals/{network}/{uuid}/proposal.json                   drafts staged before v1.1
proposals/{network}/{uuid}/media/{random}-{name}           attachments
proposals/{network}/{uuid}/media/{random}-{name}.thumb.webp  image thumbnails
proposals/{network}/index/{referendum_index}.json          referendum index to proposal
user-avatars/{user_uuid}.png
```

## Rate limits (Upstash Redis)

| Variable | Notes |
|---|---|
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | REST URL and token of an Upstash Redis database. With both set, rate limits are counted in one shared store and hold across serverless instances (`lib/rate-limit.ts`). The names `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` also work, so either Vercel integration is fine. Other variables an integration adds (`KV_URL`, `REDIS_URL`, `KV_REST_API_READ_ONLY_TOKEN`) are ignored. Unset, or when the store fails, each instance counts on its own; limiting is never switched off. Recommended in production. |

## Moderation and content checks

| Variable | Notes |
|---|---|
| `GOVERNANCE_ADMIN_PUBLIC_KEYS` | Wallets that are always admins: SS58 addresses on any network, or `0x` public keys, separated by commas or spaces. Entries that are not valid are skipped. These admins cannot be removed in the app; they grant further moderator and admin roles in **Moderation → Roles**, which are stored in the database. Moderation needs migrations `011` to `013` (`lib/auth/roles.ts`). |
| `ANTHROPIC_API_KEY` | Enables the automatic content checks (`lib/moderation/scan.ts`). The key alone checks nothing: an admin switches the checks on in **Moderation → Settings** and chooses the model, what is checked, how clear violations are handled and a daily limit. The settings need migration `012`. The key is used only on the server. |

## Telegram notices

All notices are best-effort: a missing configuration or a Telegram error
never fails a request.

| Variable | Notes |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather. Add the bot to each chat it should post in. |
| `TELEGRAM_CHAT_ID` | Chat for new `/security` reports (`lib/security/notify.ts`). The report text and the reporter's contact are posted. Reports are always stored in the database as well. |
| `TELEGRAM_MODERATION_CHAT_ID` | Chat for a short notice about each new moderation report: the kind of item, the category and a link to `/moderation`, never the reporter, their note or the content (`lib/moderation/notify.ts`). Unset: `TELEGRAM_CHAT_ID` is used. `OFF`: no moderation notices. |

## Legal pages and footer

The imprint (`/imprint`), privacy policy (`/privacy`) and terms (`/terms`)
read the operator's details from these variables (`lib/legal/operator.ts`).
The pages are prerendered at build time, so **redeploy after changing
any of them**.

The defaults name the original maintainer. Anyone running their own
instance must set their own details.

| Variable | Notes |
|---|---|
| `LEGAL_OPERATOR_NAME` | Full name or company of the person responsible. Default: `NEXT_PUBLIC_SITE_MAINTAINER`. |
| `LEGAL_OPERATOR_ADDRESS` | Optional postal address for service, for example a c/o address. Separate lines with `\|` or newlines: `Street 1 \| 12345 City \| Country`. Unset, the pages say the address is available on request by email. |
| `LEGAL_CONTACT_EMAIL` | Contact address, also used for content reports and complaints. Default: the original maintainer's address (see `lib/env.ts`). |
| `LEGAL_CONTACT_PHONE` | Optional. |
| `LEGAL_VAT_ID` | Optional; only if you have one. |
| `NEXT_PUBLIC_SITE_MAINTAINER` | Name in the footer disclaimer. Default: the original maintainer's name. |
| `NEXT_PUBLIC_SOURCE_URL` | Public repository for the AGPL source offer in the footer and the terms. Default `https://github.com/chriszemmel/enjin-governance`. Point it at your own fork if you change the code. |

## Site password gate

Access control for a staging or pre-launch site. `proxy.ts` sends every
request without the access cookie to `/unlock`. The page posts to
`/api/unlock`, which checks the password (rate-limited per IP) and sets an
`httpOnly` cookie holding a SHA-256 hash of `SITE_PASSWORD`, valid for 7
days. Changing the password invalidates every cookie.

While the gate is on, the API and the `/r` file route are locked too, so
EGOV1 links do not resolve for outsiders. `/unlock`, the legal pages,
`/brand/*` and OpenGraph images stay open, and link-preview crawlers
(recognised by user agent) can read pages outside `/api/`.

| Variable | Default | Notes |
|---|---|---|
| `SITE_PASSWORD_STATUS` | `OFF` | `ON` enables the gate. |
| `SITE_PASSWORD` | unset | The shared password. Needed when the gate is on. If it is unset, the gate stays closed and every unlock answers `503`. |

## Subscan

| Variable | Notes |
|---|---|
| `SUBSCAN_API_KEY` | Optional key from <https://pro.subscan.io>, sent only from the server (`lib/subscan/client.ts`). Subscan is used only to decode call data for very old finalised referenda on Enjin mainnet. Without a key, Subscan's public limits apply, which is enough for one referendum at a time; a call over the limit returns nothing and the page shows less detail. |

## Network endpoints and explorer links

All have defaults. Override them to use a dedicated RPC provider.

| Variable | Default |
|---|---|
| `NEXT_PUBLIC_ENJIN_RELAY_WSS` | `wss://rpc.relay.blockchain.enjin.io` |
| `NEXT_PUBLIC_ENJIN_RELAY_FALLBACK_WSS` | `wss://enjin-relay-rpc.n.dwellir.com` |
| `NEXT_PUBLIC_ENJIN_MATRIX_WSS` | `wss://rpc.matrix.blockchain.enjin.io` |
| `NEXT_PUBLIC_ENJIN_MATRIX_FALLBACK_WSS` | `wss://enjin-matrix-rpc.n.dwellir.com` |
| `NEXT_PUBLIC_CANARY_RELAY_WSS` | `wss://rpc.relay.canary.enjin.io` |
| `NEXT_PUBLIC_CANARY_MATRIX_WSS` | `wss://rpc.matrix.canary.enjin.io` |
| `NEXT_PUBLIC_ENJIN_SUBSCAN_URL` | `https://enjin.subscan.io` |
| `NEXT_PUBLIC_MATRIX_SUBSCAN_URL` | `https://matrix.subscan.io` |
| `NEXT_PUBLIC_CANARY_SUBSCAN_URL` | `https://canary.subscan.io` |
| `NEXT_PUBLIC_CANARY_MATRIX_SUBSCAN_URL` | `https://canary-matrix.subscan.io` |

RPC URLs must start with `wss://`, explorer URLs with `https://`. The
explorer URLs are only used for links. Archive RPCs are fixed in
`lib/chain/chains.ts`; they are public and stable, so they are not
configurable.

## Reserved

| Variable | Notes |
|---|---|
| `CRON_SECRET` | Declared for a future scheduled job. Nothing uses it yet. If set, it must be at least 16 characters. |

## Adding a new variable

1. Add it to `lib/env.ts` with a Zod schema, in the `server` or `client`
   block, and to `runtimeEnv`.
2. A browser variable needs the `NEXT_PUBLIC_` prefix and must be declared
   in the `client` block; `@t3-oss/env-nextjs` needs both.
3. Add it to `.env.example` with a one-line comment.
4. Add it to this page, and to the inventory in
   [`HANDOVER.md`](HANDOVER.md) if it holds a secret or an account.

## CI

CI (`.github/workflows/ci.yml`) builds with only `NEXT_PUBLIC_APP_URL` set.
Every other variable is optional or has a default, so the build needs
nothing else.

## See also

- [`DEPLOYMENT.md`](DEPLOYMENT.md) - setting up Vercel, Neon, R2, Reown and the optional services
- [`HANDOVER.md`](HANDOVER.md) - secrets inventory and accounts
- [`WALLET_INTEGRATION.md`](WALLET_INTEGRATION.md) - WalletConnect project setup
