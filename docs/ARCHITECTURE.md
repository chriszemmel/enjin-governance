# Architecture

> Read this first. It explains the layer boundaries and what depends on what.

## Layer diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  app/ + components/                                                 │
│  ──────────────────                                                 │
│  Renders UI, manages local state, never touches chain or DB.        │
│                                                                     │
│  Calls hooks from ↓                                                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│  lib/query/                                                         │
│  ──────────                                                         │
│  React Query setup + hooks. The ONLY place components fetch data    │
│  from. Reads cache-then-fetch, mutations route through useExtrinsic │
│  which wraps signing + broadcast + status decoding.                 │
│                                                                     │
│  Calls helpers from ↓                                               │
└────────┬─────────────┬───────────────┬─────────────────┬────────────┘
         │             │               │                 │
┌────────▼─────┐ ┌─────▼──────┐ ┌──────▼──────┐ ┌────────▼─────────┐
│ lib/         │ │ lib/       │ │ lib/db/     │ │ lib/r2/          │
│ governance/  │ │ wallet/    │ │ ─────────── │ │ ──────────────── │
│ ──────────── │ │ ────────── │ │ Neon SQL    │ │ Cloudflare R2    │
│ Pallet helpers│ │ WC + ext + │ │ helpers     │ │ uploader for     │
│ over an api. │ │ sign-req   │ │ (users,     │ │ avatars + the    │
│ Pure funcs.  │ │ modal +    │ │ comments,   │ │ EGOV1 proposal   │
│              │ │ signer     │ │ proposals,  │ │ JSON + media.    │
│              │ │ adapter.   │ │ sessions).  │ │ Server-side only.│
└────────┬─────┘ └─────┬──────┘ └─────────────┘ └──────────────────┘
         │             │
         │ Uses ↓      │ Uses ↓
         │             │
┌────────▼─────────────▼────────────────────────────────────────────┐
│  lib/chain/                                                       │
│  ──────────                                                       │
│  Primitive chain helpers: apiPool, SS58, format, event matchers.  │
│  No knowledge of governance, wallets, or persistence.             │
└───────────────────────────────────────────────────────────────────┘
```

`lib/auth/` (SIWE nonce + httpOnly session cookie) sits next to `lib/db/`
on the server side - it reads from `lib/db/users.ts` + `lib/db/sessions.ts`
and exposes `getCurrentUser()` to API routes.

`lib/subscan/` (server-side Subscan API wrapper) is enrichment only. It is
called from the `app/api/subscan/*` routes and wrapped client-side by the
`use-subscan-*` query hooks; it depends on nothing but `lib/chain` (for
`ChainId`) and `lib/env`. `lib/governance/call-extract.ts` imports one of
its types (`SubscanCallParam`) - a type-only reference, no runtime edge.

`lib/og/` renders the OpenGraph card images for the per-route
`opengraph-image.tsx` files via `next/og`. It is leaf code with no other
`lib/*` dependency.

## Hard rules

| You're in… | You can import… | You CANNOT import… |
|---|---|---|
| `app/` or `components/` | `lib/query/**`, `lib/utils/**`, `lib/config`, `components/**` | `lib/governance/**`, `lib/wallet/**` (except types), `lib/chain/**`, `lib/db/**`, `lib/r2/**`, `lib/auth/**`, `@polkadot/api` |
| `lib/query/**` | All of `lib/*` (client surface) | `react`, JSX |
| `lib/governance/**` | `lib/chain/**`, `@polkadot/api`, `@polkadot/util*` | `react`, `lib/wallet/**`, `lib/db/**`, `lib/r2/**`, `lib/query/**` |
| `lib/wallet/**` | `lib/chain/ss58`, `@walletconnect/*`, `@polkadot/extension-dapp`, `@polkadot/util*` | `lib/governance/**`, `lib/db/**`, `lib/query/**` |
| `lib/chain/**` | `@polkadot/api`, `@polkadot/util*` | Anything else from `lib/*` |
| `lib/db/**` | `@neondatabase/serverless` | `lib/chain/**`, `lib/governance/**`, `lib/wallet/**`, `lib/r2/**` |
| `lib/r2/**` | `@aws-sdk/client-s3` (R2 is S3-compatible) | `lib/chain/**`, `lib/governance/**`, `lib/wallet/**`, `lib/db/**` |
| `lib/auth/**` | `lib/db/users`, `lib/db/sessions`, `@polkadot/util-crypto` | `lib/chain/**`, `lib/governance/**`, `lib/wallet/**` |
| `lib/subscan/**` | `lib/chain/chains` (types), `lib/env` | `lib/governance/**`, `lib/wallet/**`, `lib/db/**`, `lib/r2/**`, `lib/query/**`, `react` |
| `lib/og/**` | `next/og` | Anything else from `lib/*` |

The rest is enforced by code review.

## Data flow: reading a referendum

```
  /proposals/[index]/page.tsx
    └── useReferendum(index)                     [lib/query/hooks/use-referendum.ts]
          └── getReferendum(api, index)          [lib/governance/referenda.ts]
                ├── api.query.referenda.referendumInfoFor(index)
                └── normalizeStatus(raw)         [lib/governance/status.ts]
```

For terminal referenda the preimage call may have been pruned from live
state; the hook falls through to:

1. archive RPC at `finalisation_block - 1`,
2. `preimage.preimageFor((hash, len))` (with `len`-recovery + key-scan),
3. Subscan as a last resort.

## Data flow: filing a treasury proposal

```
  app/create/page.tsx
    └── POST /api/proposals/draft
          ├── putJson(r2://…/proposal.json)            [lib/r2/json.ts]
          └── insertProposalDraft(…)                   [lib/db/proposals.ts]
    └── useExtrinsic({ build: buildTreasuryProposal(api, …) })
          ├── api.tx.preimage.notePreimage(<spend bytes>)
          ├── api.tx.referenda.submit({ Origins }, Lookup{hash, len}, <enactment>)
          ├── api.tx.preimage.notePreimage('EGOV1:{"u":"…","h":"…"}')
          ├── api.tx.referenda.setMetadata(<index>, blake2_256(envelope))
          └── api.tx.utility.batchAll([…])             ← what the wallet signs
    └── on finalised: POST /api/proposals/[id]/confirm
          └── attachReferendumIndex(…)                 [lib/db/proposals.ts]
```

The `EGOV1:` envelope is a content-addressed backlink to the off-chain
JSON, bound to the referendum via `referenda.metadataOf(index)`. Anyone
resolving `MetadataOf` through the `preimage` pallet can rebuild the
proposal corpus by URL + sha256 without our DB. (Referenda filed before
this anchor shipped carry the same envelope as a `system.remark` in the
submission batch - indexers fall back to remark-scanning for those.)

## Data flow: signing in (SIWE-style)

```
  /account → "Sign in with wallet"
    └── POST /api/auth/nonce         [freshNonce + insertNonce → auth_nonces row]
    └── signRaw via the active connector's Signer
    └── POST /api/auth/verify        [consumeNonceRow (atomic DELETE…RETURNING),
                                      verifySignature, upsertUserByAddress,
                                      insertSession + set HttpOnly cookie]
    └── GET  /api/auth/me            [server reads cookie + DB → ProfileMe]
```

Nonces live in Postgres (`auth_nonces`), not process memory - Vercel
function instances don't share heap, so an in-memory map drops the
nonce between the issue hop and the verify hop. The cookie is
httpOnly, rotating, and gated by `lib/db/sessions.ts`. No chain side
effects.

**One identity per network.** Each SS58 address is its own `users`
row, scoped via `network` (derived from the SS58 prefix). The same
key on Enjin Relay (`en…`) and Canary (`cn…`) is intentionally two
separate users so handles live in per-network namespaces - `@chris`
on Canary doesn't block `@chris` on Relay. The network switcher
disconnects the wallet on every change so one session only ever
touches one chain.

## Source-of-truth rules

1. **The chain RPC is canonical.** Subscan, Neon, R2, and any future
   indexer are caches or enrichment - never sources of truth for
   on-chain state.
2. **`lib/env.ts` is the single source of truth for env vars.** Nothing
   else reads `process.env` directly.
3. **`lib/chain/chains.ts` is the single source of truth for chain
   config.** No hard-coded RPC URLs, SS58 prefixes, or CAIP-2 chain
   IDs elsewhere.
4. **`lib/config.ts` is the single source of truth for app constants**
   like treasury addresses.
5. **The R2 proposal JSON is the source of truth for proposal narrative.**
   The DB row is an index for fast list pages; the on-chain
   `EGOV1:` envelope (bound via `referenda.metadataOf`, or a legacy
   `system.remark`) is the canonical pointer.

## When to add a new layer

Don't, unless you genuinely need it. The current layers are deliberately
flat. If you need shared logic between two existing layers, put it in
the lower one (e.g. shared between `governance/` and `wallet/` → put
it in `chain/`).

## See also

- [`CHAIN_FLOW.md`](CHAIN_FLOW.md) - how chain connections are managed
- [`GOVERNANCE_FLOW.md`](GOVERNANCE_FLOW.md) - referenda lifecycle
- [`WALLET_INTEGRATION.md`](WALLET_INTEGRATION.md) - connectors + signing
- [`ENVIRONMENT.md`](ENVIRONMENT.md) - env vars
- [`DEPLOYMENT.md`](DEPLOYMENT.md) - Vercel + Neon + R2 setup
