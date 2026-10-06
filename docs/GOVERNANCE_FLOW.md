# Governance flow

The Enjin Relaychain runs the Polkadot SDK OpenGov pallets (`referenda`,
`convictionVoting`, `preimage`, `treasury`). This doc explains the
lifecycle and points to the code that implements each step.

## Concepts (skim if you already know OpenGov)

- **Referendum** - a single on-chain decision: enact this call if it passes.
- **Track** - a class of decision (Root, BigSpender, SmallTipper, ...). Each
  track has its own decision period, prepare period, confirm period, min
  approval curve, and min support curve.
- **Origin** - the privilege level required to dispatch the call. Each
  track is associated with one origin (e.g. the `SmallTipper` track grants
  the `SmallTipper` origin).
- **Preimage** - the call bytes. Stored separately on chain. You
  `preimage.notePreimage(bytes)` and reference it by `Lookup { hash, len }`
  in the referendum.
- **Submission deposit** - small, refundable when decided.
- **Decision deposit** - per-track, larger, refundable when decided.
  Anyone can pay it; until it is paid, the referendum waits in the queue.
- **Conviction** - multiplier (1x, 2x, 3x, 4x, 5x, 6x) applied to a voter's
  balance, with a proportional lock period applied after the vote.
- **Status** - `Ongoing | Approved | Rejected | Cancelled | TimedOut | Killed`.

For the canonical reference, see the Polkadot SDK referenda pallet docs.

## Read flow: listing referenda

```ts
// lib/governance/referenda.ts
export async function listReferenda(
  api: ApiPromise,
  { trackId, status }: { trackId?: number; status?: ReferendumStatus } = {},
): Promise<Referendum[]> {
  const entries = await api.query.referenda.referendumInfoFor.entries()
  return entries
    .map(([key, opt]) => decodeReferendum(key, opt))
    .filter((r): r is Referendum => !!r)
    .filter((r) => (trackId == null ? true : r.trackId === trackId))
    .filter((r) => (status == null ? true : r.status.type === status))
    .sort((a, b) => b.index - a.index)
}
```

Wrapped by `lib/query/hooks/use-referenda.ts` with a 30s stale time and a
60s refetch interval when the page is visible.

## Read flow: single referendum

```ts
// lib/governance/referenda.ts
export async function getReferendum(
  api: ApiPromise,
  index: number,
): Promise<Referendum | null> {
  const info = await api.query.referenda.referendumInfoFor(index)
  return decodeReferendum(index, info)
}
```

`use-referendum.ts` polls every 10s while ongoing, drops to 60s on
terminal status.

## Read flow: tracks

```ts
// lib/governance/tracks.ts
export function getTracks(api: ApiPromise): Track[] {
  const raw = api.consts.referenda.tracks
  return decodeTracks(raw)
}
```

Cached per `api` instance - tracks change only on runtime upgrade, so we
treat them as effectively constant per session.

## Write flow: casting a vote

```
                                                           ┌──────────────┐
   vote-panel.tsx                                          │  Wallet app  │
        │                                                  │  (mobile/UI) │
        ▼                                                  └──────┬───────┘
   useExtrinsic({                                                 ▲
     build: buildVote({                                           │
       pollIndex: 42,                                             │
       aye: true,                                                 │
       balance: 10n * 10n**18n,                                   │
       conviction: 'Locked1x',                                    │
     }),                                                          │
   })                                                             │
        │                                                          │
        │ api.tx.convictionVoting.vote(42, { Standard: { ... } })  │
        ▼                                                          │
   tx.signAndSend(address, { signer }, callback)                   │
        │                                                          │
        │ The signer adapter calls signClient.request({            │
        │   method: 'polkadot_signTransaction', ...                │
        │ }) which surfaces in the wallet ─────────────────────────┘
        ▼
   { status: ready }   →   { status: broadcast }
   { status: inBlock(blockHash) }   →   { status: finalized, events }
        │
        ▼
   match events:  api.events.convictionVoting.Voted   ✓
                  api.events.system.ExtrinsicSuccess  ✓
        │
        ▼
   toast: "Vote submitted"
   invalidate use-referendum(42) → refetch on next tick
```

The whole pipeline lives in `lib/query/hooks/use-tx.ts` so every write
flow (votes, proposals, deposit placement, unlocks) gets the same
status + toast treatment for free.

## Write flow: submitting a treasury referendum

The wizard's full pipeline. The signed extrinsic is one
`utility.batchAll` of four calls.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. Build the spend call                                              │
│                                                                      │
│   const call = api.tx.treasury.spendLocal(                           │
│     /* amount      */ amountPlanck,                                  │
│     /* beneficiary */ MultiAddress(beneficiarySs58),                 │
│   )                                                                  │
│                                                                      │
│   const bytes = call.method.toU8a()                                  │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 2. Pre-signature stage (R2 + DB)                                     │
│                                                                      │
│   POST /api/proposals/draft                                          │
│   ├─ putJson(r2://proposals/<network>/<uuid>/proposal.json)          │
│   │     → { url, sha256 }                                            │
│   └─ insertProposalDraft({ id: uuid, status: 'draft', … })           │
│   returns { id, json_url, json_sha256, remark_payload }              │
│                                                                      │
│   remark_payload = `EGOV1:{"u":"<url>","h":"<sha256>"}`              │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 3. Build the batchAll                                                │
│                                                                      │
│   const tier = pickOriginForAmount(amountPlanck)                     │
│                  // -> { origin: "BigSpender", maxAmount } | null    │
│   const index = referenda.referendumCount()  // read at build time   │
│   const envelope = stringToU8a(remark_payload)                       │
│                                                                      │
│   utility.batchAll([                                                 │
│     preimage.notePreimage(bytes),                                    │
│     referenda.submit(                                                │
│       { Origins: tier.origin },                                      │
│       { Lookup: { hash: blake2_256(bytes), len: bytes.length } },    │
│       { After: 0 },                                                  │
│     ),                                                               │
│     preimage.notePreimage(envelope),                                 │
│     referenda.setMetadata(index, blake2_256(envelope)),              │
│   ])                                                                 │
│                                                                      │
│   One signature; all four apply atomically or none do. If another    │
│   submission lands first, `index` is stale, setMetadata fails the    │
│   runtime's depositor check (NoPermission), the batch reverts, and   │
│   the wizard rebuilds with a fresh count on retry - a stale index    │
│   can never annotate someone else's referendum.                      │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 4. Confirm on the server                                             │
│                                                                      │
│   On finalised:                                                      │
│   POST /api/proposals/<id>/confirm                                   │
│     { referendum_index, tx_hash, block_hash, block_number }          │
│   → attachReferendumIndex(…) flips status to 'on_chain'.             │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 5. (Optional) Place the decision deposit                             │
│                                                                      │
│   api.tx.referenda.placeDecisionDeposit(index)                       │
│                                                                      │
│   The new referendum's index is known only after the batch emits     │
│   referenda.Submitted{index}, so this is a separate signed tx.       │
│   Anyone can pay it - not just the proposer.                         │
└──────────────────────────────────────────────────────────────────────┘
```

The `EGOV1:` envelope is a content-addressed backlink to the off-chain
JSON, bound to the referendum through `referenda.metadataOf(index)`.
Any third party can rebuild the proposal corpus by reading `MetadataOf`,
resolving the hash through the `preimage` pallet to the envelope bytes,
and fetching the URL - no integration against our DB required. Generic
tooling (Polkadot-JS Apps, Subscan) renders the binding natively.

Referenda filed before the setMetadata anchor shipped carry the same
envelope as a `system.remark` call co-located in the submission
`utility.batchAll` instead - indexers should check `MetadataOf` first
and fall back to remark-scanning for those.
Schema lives in `lib/governance/proposal-metadata.ts`.

### Proposer edits

After submission the proposer can edit the off-chain narrative (title,
summary, body, attachments) via `PATCH /api/proposals/[uuid]`. The
endpoint re-uploads `proposal.json` at the same R2 key, so existing
URLs keep resolving, but the canonical bytes (and therefore the
sha256) change. The on-chain envelope still pins the **original**
hash, so the pinned-hash vs. bucket-hash divergence is the public
signal that an edit happened.

The DB tracks `edited_at` + `edit_count`. The detail page shows
`(edited)` next to the title and switches the verification badge to
`EGOV · Edited` (neutral tone) instead of `EGOV · Unverified`
(warning tone). Spend amount, beneficiary, preimage, and proposer
address are **not** editable - those are baked into the referendum.

## Write flow: advanced proposals

`/create/advanced` files any curated call (`lib/governance/proposal-calls.ts`)
under an origin picked from a dropdown. `lib/governance/submit-proposal.ts`
builds the batch:

```
utility.batchAll([
  preimage.notePreimage(bytes),            // only if bytes > 128 (Lookup)
  referenda.submit(origin, Inline(bytes) | Lookup{hash, len}, enactment),
  preimage.notePreimage(envelope),         // only with details attached
  referenda.setMetadata(index, blake2_256(envelope)),
])
```

A lone `referenda.submit` (small call, no details) is sent unbatched. With
details attached, the page signs in, stages the draft (`POST
/api/proposals/draft`, no spend fields unless the call is a treasury spend),
and confirms after finality - the same draft → `setMetadata` → confirm path
as the treasury wizard, so the detail page shows the narrative. Drafts
without a spend don't store their call, so the `/create` wizard can't
resume them; the drafts lists only offer cancel / delete for them.

**Runtime upgrades** use `system.authorizeUpgrade(code_hash)` (Root): a
34-byte inline call, so no multi-MB preimage, deposit, or block-size limit
on the referendum. The page hashes the `.wasm` locally (blake2-256 - hash
the exact file you will apply, normally srtool's `compact.compressed.wasm`).
Once enacted, anyone submits `system.applyAuthorizedUpgrade(code)`, which
checks the hash and that the spec name is unchanged and the spec version
increases, and is free when valid. `system.setCode` remains available.

The detail page decodes inline proposals straight from `ReferendumInfoFor`
(`useInlineCall`), so voters see e.g. `system.authorizeUpgrade(code_hash)`
without a preimage lookup.

## Origin selection (`lib/governance/treasury.ts`)

Tracks have a `maxDeciding` and an implicit "max amount" derived from their
origin's spending limit. We map amount → track:

```ts
pickOriginForAmount(tracks, amount) →
  amount ≤ tracks.SmallTipper.maxAmount      ? SmallTipperOrigin
  amount ≤ tracks.BigTipper.maxAmount        ? BigTipperOrigin
  amount ≤ tracks.SmallSpender.maxAmount     ? SmallSpenderOrigin
  amount ≤ tracks.MediumSpender.maxAmount    ? MediumSpenderOrigin
  amount ≤ tracks.BigSpender.maxAmount       ? BigSpenderOrigin
  : null   // above the cap - rejected at compose time
```

Enjin has no `Treasurer` track, so `BigSpender` is the top tier and the table
is capped at 1,000,000 ENJ; a larger amount returns null and the wizard blocks
it rather than filing under an origin that can't authorize the spend. The
deposit thresholds come from chain config (read at runtime). The treasury
wizard auto-picks the tier; the `/create/advanced` composer lets you choose any
track origin explicitly.

## Voting lock periods

A vote with conviction `Locked3x` locks the balance for 3 × track decision
period after the vote is finalized. The decision period varies by track:

- BigSpender: ~28 days
- SmallTipper: ~7 days
- (etc - read `Track.decisionPeriod` from `lib/governance/tracks.ts`)

Conviction selector shows the actual lock duration for the current track,
not a hard-coded "8 / 16 / 32 day" table.

## Unlocking locked balance

A conviction lock outlives the referendum. To free it the voter must (1)
remove the vote (`convictionVoting.removeVote(track, index, currency)`), then
(2) once the lock period has elapsed, call
`convictionVoting.unlock(track, account, currency)`. On Enjin these calls are
the multi-token fork's 3-arg form (the extra `currency` arg); `buildUnlock` /
`buildRemoveVote` in `lib/governance/conviction-voting.ts` probe metadata for
the arity so the arg is never dropped. The lock is **per track and per
currency** - `classLocksFor` is keyed `(account, currency)` on Enjin - so an
ENJ `unlock` frees the ENJ lock on that track regardless of how many ENJ votes
contributed to it; an sENJ lock is freed separately.

`getAccountLocks(api, address)` builds the per-track picture the UI needs:
`classLocksFor` gives the authoritative frozen `locked` amount, while
`votingFor` supplies the `prior` lock (the `(unlockAt, amount)` tuple that
the chain sets when a vote is removed) and the list of votes still actively
holding a lock. Because locks are per currency, it enumerates **every**
currency (`classLocksFor.entries(address)`), so an ENJ lock and an sENJ lock
on the same track surface as two distinct rows - each carrying its own
`currencyRaw` and `locked` amount, and each unlockable in its own currency.
The matching `votingFor` rows are filtered by currency so an ENJ lock's
"held by" list only references the ENJ votes that hold it, never an sENJ
vote on the same track (and vice-versa). The account page
(`components/governance/locked-balance-panel.tsx`, via `useAccountLocks`)
uses this with the current block to show, per lock, one of: *held by your
vote on #N* (link to remove it there), *unlocks in N days* (a `prior` lock
still counting down), or *unlockable now* (enabled Unlock button), labelled
with the lock's own token (ENJ or sENJ · pool #N). Casting a vote or removing
one invalidates `["account-locks", chainId, address]` so the panel stays live.

## Vote currency: liquid ENJ vs staked-pool sENJ

Enjin extends `AccountVote` with a `currency` argument so a voter can
stake either liquid ENJ (`{ Enj: null }`) or staked-pool tokens
(`{ SEnj: { tokenId } }`) into a referendum. The per-vote currency is part of
the `convictionVoting.votingFor` storage key (a triple map of
`(account, track, currency)`); `listVotesOnPoll` (in
`lib/governance/conviction-voting.ts`) reads it from there, and also enriches
from `voteManager.VoteCurrencies(voter, pollIndex)` on any runtime that exposes
the `voteManager` pallet.

Each nomination pool on the relay also owns an NFT in the chain's
staking-pool collection (the "Degens" family, collection id `2` on
mainnet). The mapping is:

```
poolId  ─►  nominationPools.bondedPools(poolId).tokenId  ─►  multiTokens (collectionId, tokenId)
```

Helpers:

- `lib/governance/staking-pools.ts` → `getPool(api, poolId)` reads the
  pool's `tokenId`, name, and state. Returns `null` when the pallet
  isn't present (matrix chains).
- `lib/governance/multi-tokens.ts` → `getCollectionUriTemplate(api,
  collectionId)` reads the collection's `uri` attribute (a template
  containing `{id}`). `buildTokenMetadataUrl(template, c, t)`
  substitutes `{id}` with `<c>-<t>`. `fetchTokenMetadata(url)` pulls
  + normalises the JSON; falls back to `null` on any error.
- `lib/query/hooks/use-pool-nft.ts` → `usePoolNft(poolId)` wraps the
  above in React Query (30-minute staleTime). Dedupes across rows.
- The collection id per chain lives in `ChainConfig.stakingPoolNftCollectionId`
  (`lib/chain/chains.ts`); `null` disables the lookup and the UI
  degrades to plain "sENJ · pool #N" text.

## See also

- [`CHAIN_FLOW.md`](CHAIN_FLOW.md) - RPC connection
- [`WALLET_INTEGRATION.md`](WALLET_INTEGRATION.md) - how signing works
- The `scripts/00*.sql` files - canonical off-chain schema
