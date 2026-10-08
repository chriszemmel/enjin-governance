# Governance flow

The Enjin Relaychain runs the Polkadot SDK OpenGov pallets: `referenda`,
`preimage` and `treasury`, plus `utility` for batching and `whitelist`.
Voting goes through Enjin's multi-token `convictionVoting` fork, or
`voteManager` on runtimes that have it. This doc explains the lifecycle of
a referendum and points to the code for each step.

For RPC connections see [`CHAIN_FLOW.md`](CHAIN_FLOW.md). For how a
signature is produced see [`WALLET_INTEGRATION.md`](WALLET_INTEGRATION.md).

## Concepts

Skip this section if you already know OpenGov.

- **Referendum** - one on-chain decision: enact this call if it passes.
- **Track** - a class of decision (Root, BigSpender, SmallTipper, ...). Each
  track has its own decision deposit, prepare, decision, confirm and
  minimum enactment periods, and approval and support curves.
- **Origin** - the privilege the call is dispatched with. Each track maps
  to one origin, encoded as `{ Origins: "SmallTipper" }` or
  `{ System: "Root" }`.
- **Proposal** - the call itself, passed to `referenda.submit` as a bounded
  value: `Inline` (the call bytes, at most 128 bytes) or
  `Lookup { hash, len }` (a preimage noted with `preimage.notePreimage`).
- **Enactment** - when a passed call runs: `After n` blocks (clamped by the
  runtime to the track's minimum) or `At` a block height.
- **Submission deposit** - reserved when the referendum is filed.
  Refundable only if the referendum is approved or cancelled.
- **Decision deposit** - per track and larger. Anyone can place it. Until
  it is placed, the referendum cannot start deciding. Refundable once the
  referendum concludes, unless it was killed.
- **Conviction** - multiplies a vote's weight in exchange for a lock:
  `None` counts 0.1x with no lock, `Locked1x` to `Locked6x` count 1x to 6x.
- **Metadata** - an optional preimage hash bound to a referendum with
  `referenda.setMetadata`. This app uses it for its EGOV1 record.
- **Status** - `Ongoing`, `Approved`, `Rejected`, `Cancelled`, `TimedOut`
  or `Killed`.

The Polkadot SDK referenda pallet docs are the canonical reference.

## Reading the chain

### Referenda

`lib/governance/referenda.ts`:

- `listReferenda(api, { trackId?, status? })` reads
  `referenda.referendumInfoFor.entries()`, decodes each row with
  `decodeReferendumInfo` (`lib/governance/status.ts`), filters, and sorts
  newest first.
- `getReferendum(api, index)` reads one row. It returns `null` when the
  index doesn't exist.
- `getReferendumCount(api)` reads `referenda.referendumCount()`, the index
  the next submission will get.

Hooks in `lib/query/hooks/`:

| Hook | Stale time | Refetch |
|---|---|---|
| `useReferenda` | 30 s | every 60 s while the tab is visible |
| `useReferendum` | 10 s | every 10 s while ongoing, 60 s after |
| `useReferendumCount` | 10 s | refetched right before a proposal is signed |

### Tracks

`getTracks(api)` in `lib/governance/tracks.ts` decodes
`api.consts.referenda.tracks` and caches the result per `ApiPromise`.
Tracks only change with a runtime upgrade, so `useTracks` never refetches.

The runtime pads track names with NUL bytes and uses snake_case
(`small_tipper`), while origins use PascalCase (`SmallTipper`). Compare
names with `findTrackByName` or `canonicalTrackName`, never with `===`.

### History, voters and calls

- **History** - a concluded referendum drops its tally, call and
  submission block. `getReferendumHistory(api, index, atBlock)` reads the
  row at the block before the terminal transition, through the archive
  RPC.
- **Voters** - `listVotesOnPoll(api, pollIndex)` in
  `lib/governance/conviction-voting.ts` reads
  `convictionVoting.votingFor.entries()` and keeps the votes on that poll.
  For a concluded referendum, `useReferendumVotes` runs it on the archive
  node at the block before it concluded, so later vote removals don't hide
  voters.
- **Calls** - `getPreimage(api, { hash, len })` in
  `lib/governance/preimage.ts` reads `preimage.preimageFor`. When `len` is
  wrong or 0 (old `Legacy` proposals), it recovers the length from
  `requestStatusFor` and, as a last resort, by scanning the preimage keys.
- **Inline calls** - a call of 128 bytes or less (e.g.
  `system.authorizeUpgrade`, `referenda.cancel`) rides in the referendum
  itself, with no preimage. `decodeStatus` keeps its bare bytes (no compact
  length prefix), and `useInlineCall` in `lib/query/hooks/use-preimage.ts`
  decodes them: a live referendum with today's runtime, a decided one with
  the runtime of the block its history was read at, since a later upgrade
  can re-index calls. A call that still won't decode yields to Subscan's
  decode, or is shown raw.
- **Runtime code** - for a runtime upgrade the proposal page shows the code
  hash voters compare with the srtool build: computed from the wasm of a
  `system.setCode` call (older referenda), or read from an
  `authorizeUpgrade` call (`runtimeCodeOf` in
  `lib/governance/runtime-code.ts`).

## Writing to the chain: `useExtrinsic`

Every write goes through `useExtrinsic` in `lib/query/hooks/use-tx.ts`:

1. `build(api)` returns one extrinsic or an array. An array is wrapped in
   `utility.batchAll`, so all calls apply or none do.
2. The active address is re-encoded for the active chain, and the
   connector returns a `Signer` for it.
3. `signAsync` signs with a mortal era of 256 blocks (about 25 minutes).
   Enjin Wallet refuses immortal payloads, and the default era can expire
   during a slow mobile round trip.
4. If the RPC socket dropped while the user was in the wallet, the hook
   waits up to 15 s for it to reconnect, then calls `send()`.
5. Status moves through `signing`, `broadcast`, `in-block` and
   `finalized`, or ends in `error`. Dispatch errors are decoded to module
   errors with `decodeDispatchError` (`lib/chain/events.ts`).

`resolveOn` decides when `onSuccess` runs. The default is `in-block`, used
for votes, deposits and unlocks. Proposal submission uses `finalized`,
because it writes the new referendum index to the database and a reorg
could otherwise store the wrong one. On success the hook invalidates the
referenda and balance queries; callers invalidate anything else they own.

Other safeguards:

- A second tap while a submit is in flight gets the same promise, so a
  wallet never sees two sign requests.
- If no block notification arrives within 90 s of broadcasting, the hook
  reports an error that says the transaction may still have gone through.

Callers show progress. For browser extensions they use toasts. For
WalletConnect wallets they open the sign-request modal, which follows the
same status (see [`WALLET_INTEGRATION.md`](WALLET_INTEGRATION.md#sign-request-modal)).

### Casting a vote

```text
vote-panel.tsx
  useExtrinsic({ build: (api) => buildVote(api, { pollIndex, aye, balance, conviction, currency }) })
        │
        ▼
  buildVote (lib/governance/conviction-voting.ts)
    voteManager.vote(poll, { Standard: { vote, balance } }, currency)   runtime has voteManager
    convictionVoting.vote(poll, accountVote, currency)                  multi-token fork, 3 args
    convictionVoting.vote(poll, accountVote)                            stock Substrate, 2 args
        │
        ▼
  signAsync(address, { signer, era: 256 })
    extension: the extension's popup
    WalletConnect: polkadot_signTransaction, approved on the phone
        │
        ▼
  send() ─► broadcast ─► in-block ─► finalized
                          │            └─ toast "Vote finalised on chain"
                          └─ onSuccess: refetch the voter list, the user's
                             votes and account locks; the modal shows success
                             (WalletConnect) or a "Vote submitted" toast
```

## Filing a proposal

There are two composers. Both end in one signed `utility.batchAll` that
files the referendum and binds its EGOV1 record.

- **Treasury wizard** (`/create`, `app/create/page.tsx`) - a
  `treasury.spendLocal(amount, beneficiary)` call. The origin tier is
  picked from the amount (see [Origins and treasury tiers](#origins-and-treasury-tiers)).
  The call is always noted as a preimage and submitted by `Lookup`.
- **Advanced composer** (`/create/advanced`, `app/create/advanced/page.tsx`) -
  any of the curated calls in `lib/governance/proposal-calls.ts`: a
  treasury spend, `referenda.cancel`, `referenda.kill`,
  `whitelist.whitelistCall`, a runtime upgrade
  (`system.authorizeUpgrade`), a `system.remark`, or a raw SCALE-encoded
  call. A raw call must re-encode to exactly the pasted bytes. The origin
  is chosen from `SUBMIT_ORIGINS` and defaults to the kind's suggested
  origin. Calls of 128 bytes or less are submitted `Inline`; larger calls
  are noted as a preimage first.

**Runtime upgrades** are filed as `system.authorizeUpgrade(code_hash)` on
Root: a 34-byte inline call, so there is no multi-MB preimage, deposit or
block-size limit on the referendum. The hash is pasted, or computed in the
browser (blake2-256) from the `.wasm` - the exact file that will be
applied, normally srtool's `compact.compressed.wasm`; the file is never
uploaded. Once enacted, anyone submits
`system.applyAuthorizedUpgrade(code)`, which checks the hash, that the spec
name is unchanged and that the spec version increases, and is free when
valid. The composer doesn't offer `system.setCode`, which would put the
whole wasm in the submission batch; the raw call kind still covers any
encoded call.

### 1. Compose

The composer builds the call locally and previews its bytes, blake2-256
hash and length before any signature. The enactment moment (as soon as
possible, a delay, or a fixed block) is checked by `validateEnactment` in
`lib/governance/enactment.ts`. An `At` block must be in the future and, in
the treasury wizard, past the track's minimum enactment period.

Beneficiary addresses from another network are caught here. See
[Wrong-network addresses](#wrong-network-addresses).

### 2. Stage the draft

Staging writes the proposal text before anything is signed on chain. It
needs a signed-in session for the connected account, so the composer asks
for a sign-in signature first if there isn't one (`useEnsureSignedIn`; a
session for another account doesn't count). The advanced composer
disables its buttons from the click until sign-in, staging and the
pre-sign chain reads are done, so a double tap can't stage twice.

```text
POST /api/proposals/draft                     (app/api/proposals/draft/route.ts)
  checks: signed in, proposer_address is the session's own key,
          beneficiary valid for the network, attachments in the proposal's
          own media folder and matching the stored files
  writes: proposals/<network>/<uuid>/proposal-<first 16 hex of sha256>.json
          a proposals row with status 'draft'
  returns { id, json_url, json_sha256, remark_payload, proposal }
```

`remark_payload` is the EGOV1 envelope, `EGOV1:{"u":"<json_url>","h":"<json_sha256>"}`.

Every staged version gets its own key, and staging never overwrites an
earlier one. A batch signed from an older version (a second tab, or a
re-stage while it was in flight) still points at the exact bytes it
pinned. Staging the same draft again updates the row in place, but only:

- by its own proposer, on the same network, while it is still a draft;
- from the version the browser last saw (`expected_sha256`), so two tabs
  can't overwrite each other;
- while no version's envelope is on chain yet. If one is, the draft must
  be linked to its referendum instead. The check fails closed when the
  chain can't be read.

Staging with nothing changed returns the saved version without writing.

### 3. Build and sign the batch

```text
utility.batchAll([
  preimage.notePreimage(<call bytes>),            left out when inline or already noted
  referenda.submit(<origin>, <Inline | Lookup{hash, len}>, <enactment>),
  preimage.notePreimage(<EGOV1 envelope bytes>),  left out when already noted
  referenda.setMetadata(<index>, blake2_256(<envelope bytes>)),
])
```

The builders are `buildTreasuryProposal` in
`lib/governance/submit-treasury-proposal.ts` and `buildProposalBatch` in
`lib/governance/proposal-batch.ts`.

- **Order.** `setMetadata` needs an ongoing referendum and a preimage for
  the hash, so it comes last.
- **Index.** `<index>` is `referenda.referendumCount()`, refetched right
  before signing. If another submission lands first, the index is stale,
  `setMetadata` fails the depositor check (`NoPermission`) and the whole
  batch reverts. It can never annotate someone else's referendum. Retry
  rebuilds with a fresh count. The advanced composer refuses to build when
  that read fails. A stale index passes only for the same account's own
  earlier ongoing referendum; the advanced composer compares the index it
  bound with the `Submitted` one and says so instead of linking.
- **Already noted.** Noting a preimage that an account already noted
  (`Unrequested`) aborts with `preimage.AlreadyNoted` and reverts the
  batch. The composers read the preimage status of the call and of the
  envelope right before signing and leave out such a note
  (`noteWouldAbort`). A `Requested` preimage keeps its note: noting it is
  accepted, and it may not hold the bytes yet. The envelope can already
  exist if someone copied it. On an `AlreadyNoted` error both statuses are
  read again, so the retry skips the right call.

The user signs once. The hook resolves on finalisation and reads the new
index from the `referenda.Submitted` event (`extractReferendumIndex`). The
sign dialog shows success only then, when the details get linked. The
advanced composer links the draft its batch was built with, and its form
stays locked from Review on, so Retry resends the same call and draft.

### 4. Link the draft to its referendum

The client posts the index with `confirmWithRetry`
(`lib/governance/confirm-client.ts`) to
`POST /api/proposals/<id>/confirm` (`app/api/proposals/[uuid]/confirm/route.ts`).
The tx and block hashes are optional; the route proves ownership from
chain state:

1. The caller is signed in as the draft's proposer (matched by public key).
2. `referenda.metadataOf(index)` equals the blake2-256 of this draft's
   envelope. If it matches an older staged version instead, the draft is
   switched back to that version, so the page shows exactly what the
   referendum pins.
3. The referendum was filed by the proposer (its submission deposit), and
   when its call can be read, it has the same hash and length as the
   draft's. For a concluded referendum the route reads its last ongoing
   state from the archive node. This stops anyone who notes a copy of a
   draft's envelope on their own referendum from claiming it.

Then the row becomes `on_chain` with the index and tx coordinates, and a
redirect file is written at `proposals/<network>/index/<index>.json` for
indexers that only have the index. The proposal text is queued for the
automatic content check if that is switched on.

Chain reads are capped at 8 s. An unreachable RPC (503) or a node that
hasn't seen the `setMetadata` yet (409, `retryable: true`) is retried after
1, 3 and 6 s. A hash or filer mismatch is final. A 401 triggers one fresh
sign-in and an immediate retry.

If linking still fails, the referendum is live but has no text here. The
drafts panel on `/create` offers "Already on chain? Link it to its
referendum", which calls the same route with the index alone.

### 5. Place the decision deposit

`referenda.placeDecisionDeposit(index)` is a separate transaction, because
the index is only known after the batch lands. The success screen offers
it (`components/governance/place-deposit-button.tsx`), and so does the
proposal page. Anyone can pay it.

### Add details to an existing referendum

The advanced composer has a second mode for referenda filed elsewhere
(Polkadot-JS Apps, scripts). It stages a draft that records the existing
call, then signs only the envelope calls (`attachMetadataToExisting`):
`preimage.notePreimage(envelope)` and `referenda.setMetadata(index, hash)`.
The runtime accepts this only from the referendum's submission depositor
while it is ongoing, and the composer checks both first. It refuses a
referendum that already has details here.

## After submission

### Draft states

| Status | Meaning | Allowed actions |
|---|---|---|
| `draft` | Staged, not linked to a referendum | Resume (re-stage), link, cancel, delete |
| `on_chain` | Linked to a referendum | Edit while ongoing, withdraw |
| `cancelled` | Marked outdated by the proposer | Delete |

The schema also has `submitted` and `failed`; the drafts lists still show
`submitted` rows, but the current code doesn't set either status.

- **Private drafts.** `GET /api/proposals/<id>/json` serves a proposal that
  hasn't reached the chain only to its signed-in proposer.
- **Resume.** Drafts appear on `/create` and `/account`. The treasury
  wizard reopens an unsigned draft with `?from=<id>` and updates it in
  place, restoring its beneficiary only for the connected account's own
  drafts. Drafts from the advanced composer can't be resumed in the
  treasury wizard; the drafts lists offer them Cancel, then Delete.
- **Cancel** (`POST /api/proposals/<id>/cancel`) sets the status to
  `cancelled`. It is refused for `on_chain` rows.
- **Delete** (`DELETE /api/proposals/<id>`) removes the row and the
  proposal's whole R2 folder: every JSON version and every upload. It is
  refused for `on_chain` rows and for drafts whose envelope (any version)
  is already on chain. The on-chain check fails closed.

### Proposer edits

After linking, the proposer can edit the title, summary, body and
attachments on `/proposals/<index>/edit`, which calls
`PATCH /api/proposals/<id>`:

- Only for `on_chain` rows, and only while the referendum is ongoing. A
  concluded referendum's text is frozen. (This chain check fails open: an
  RPC error still allows the edit, and the hash divergence below still
  shows it.)
- The JSON is rewritten at the same R2 key, so the pinned URL keeps
  resolving. The EGOV1 1.2.0 `call` and `enactment` sections are carried
  over.
- The spend amount, beneficiary, preimage, track and proposer are not
  editable. They are part of the referendum.

The on-chain envelope still pins the original sha256, so a hash mismatch
between the envelope and the stored JSON is the public signal of an edit.
The row records `edited_at` and `edit_count`, and the JSON carries the same
fields. The proposal page shows "(edited)" next to the title. Its source
badge (`components/governance/proposal-metadata-header.tsx`) reads
`EGOV1 · Edited`. `EGOV1 · Unverified` is reserved for stored JSON that
doesn't match the recorded hash when no edit was recorded.

### Withdrawing

A proposer can't cancel their own referendum: `referenda.cancel` needs the
ReferendumCanceller origin. Instead, `POST /api/proposals/<id>/withdraw`
sets an off-chain flag, and the proposal page shows a banner asking voters
to vote NAY, with an optional reason of up to 280 characters.

- Only proposals that reached the chain (`on_chain`) can be marked
  withdrawn. `{ "undo": true }` clears the flag at any time.
- A body that doesn't parse is refused, so a failed undo never withdraws
  again.
- Linking a draft clears any withdrawal flag.

## The EGOV1 record

Each proposal filed here carries an EGOV1 record: a JSON document in R2
and a short envelope on chain that pins it.

```text
EGOV1:{"u":"<url>","h":"<sha256>"}
```

- `u` is the JSON's public URL. With `NEXT_PUBLIC_APP_URL` set it is served
  by the app's own `/r` route:
  `<app>/r/proposals/<network>/<uuid>/proposal-<16 hex>.json`.
- `h` is the sha256 of the canonical JSON: keys sorted at every level,
  `JSON.stringify` separators, UTF-8 (`stringifyStable` in
  `lib/r2/json.ts`).
- The envelope is noted as its own preimage and bound with
  `referenda.setMetadata(index, blake2_256(envelope))`. That hash commits
  to the envelope, not to the JSON; `expectedMetadataHash` rebuilds it
  from a stored URL and sha256.

To read a referendum's record without this app's database, read
`referenda.metadataOf(index)`, resolve the hash through the `preimage`
pallet, check for the `EGOV1:` prefix and fetch `u`.
`getReferendumMetadata(api, index)` in `lib/governance/referenda.ts` does
this. Referenda filed before the `setMetadata` binding shipped carry the
same envelope in a `system.remark` inside their submission batch;
indexers should check `MetadataOf` first and fall back to the remark.

Schema versions (`lib/governance/proposal-metadata.ts`):

- **1.1.0** - treasury proposals: title, summary, body, track, spend,
  attachments, preimage hash and length.
- **1.2.0** - adds the optional `call` section (section, method, origin,
  preimage hash and length, whether it was inline, and the code hash for
  runtime upgrades) and `enactment`. The advanced composer writes it. 1.1.0
  readers keep working.

The README section
[The EGOV1 metadata standard](../README.md#the-egov1-metadata-standard) is
the public description of the format.

## Wrong-network addresses

Enjin addresses differ per network (`en…` on the Relaychain, `cn…` on
Canary, `ef…` on the Matrixchain), but the same key can be written in any
of them. `inspectAddress(input, chainId)` in `lib/chain/ss58.ts` classifies
what was typed as `empty`, `invalid`, `native` (this chain's format) or
`foreign` (another network's format, or a raw 0x public key).

A `foreign` beneficiary is never converted silently. The composer opens
`AddressFormatDialog`, which shows the matching address for this chain and
converts only when the user agrees. The draft route rejects a beneficiary
that isn't valid for the proposal's network. A delegation target must also
be valid for the active chain.

## Origins and treasury tiers

Each treasury origin can authorize a spend up to a fixed limit, set by the
runtime's `Spender` EnsureOrigin (relaychain
`runtime/common/src/governance/origins.rs`, the treasury's `SpendOrigin`).
If the amount exceeds the origin's limit, `spend_local` fails with
`InsufficientPermission` at enactment, after the full vote. The limits
aren't in metadata or `api.consts`, so `ENJIN_SPEND_LIMITS` in
`lib/governance/treasury.ts` copies them from the runtime source, one
table per runtime spec version. The enjin and canary runtimes both take
`Spender` from `runtime/common`, so one table per spec covers both
networks.

| Origin | Spec 1070 (v1.7.0) | Spec 1080 (v1.8.0) |
|---|---|---|
| `SmallTipper` | 100 ENJ | 2,500 ENJ |
| `BigTipper` | 5,000 ENJ | 10,000 ENJ |
| `SmallSpender` | 50,000 ENJ | 50,000 ENJ |
| `MediumSpender` | 250,000 ENJ | 250,000 ENJ |
| `BigSpender` | 2,500,000 ENJ | 2,500,000 ENJ |
| `TreasuryAdmin` | 25,000,000 ENJ | 25,000,000 ENJ |

```ts
tiers = treasuryTiersForSpec(api.runtimeVersion.specVersion).tiers
pickOriginForAmount(amount, tiers) →
  the first tier (smallest first) with amount ≤ tier.maxAmount
  : null   // above the top tier's limit - rejected at compose time
```

- `useTreasuryTiers` (`lib/query/hooks/use-treasury-tiers.ts`) reads the
  connected runtime's `specVersion` and picks the table with
  `treasuryTiersForSpec`. It holds each origin to the lowest limit across
  that spec and every later listed one, so a referendum filed before a
  listed upgrade still enacts after it.
- A spec missing from the list (newer than every entry, or between two)
  uses the nearest older table, flagged unverified: the wizard, the
  advanced composer and `/treasury` warn. A spec older than every entry
  gets no table, and no spend can be filed.
- `TreasuryAdmin` is Enjin's counterpart to Polkadot's `Treasurer` (there
  is no origin by that name): the largest `Spender` entry and the
  treasury's `RejectOrigin`. It is the top tier; a larger amount returns
  `null`, and the composers block it rather than fall back to an origin
  that can't authorize the spend. Its decision deposit is much larger than
  the other tiers'.
- `assertTierCoversAmount` re-checks at build time, so a referendum is
  never filed under an origin the table says is too small.
- `spend_local` doesn't check the treasury balance. The wizard warns,
  without blocking, when a request is larger than the treasury holds: an
  approved spend is paid at a later spend period, once the treasury can
  cover it in full.
- The proposal page warns when an ongoing `spend_local` is above its
  track's limit, e.g. one filed before these limits were in place.
- When a runtime upgrade changes `Spender`, add its spec version to
  `ENJIN_SPEND_LIMITS` before the upgrade is applied.

The advanced composer offers these origins (`SUBMIT_ORIGINS` in
`lib/governance/proposal-calls.ts`): `Root`, `WhitelistedCaller`,
`ReferendumCanceller`, `ReferendumKiller`, `GeneralAdmin` and the treasury
origins up to `BigSpender`. Cancel defaults to `ReferendumCanceller` and
kill to `ReferendumKiller`; every other kind defaults to `Root`. A treasury
spend in the advanced composer still takes its origin from the amount, and
can reach `TreasuryAdmin`. An origin that is too weak for the call only
fails at enactment, after the full vote, so the composer warns about it.

## Deposits

- **Submission deposit** - `api.consts.referenda.submissionDeposit`,
  reserved when the batch lands.
- **Decision deposit** - the track's `decisionDeposit`, reserved from
  whoever places it.
- **Preimage deposits** - one per noted preimage, so a proposal holds up
  to two: the call and the envelope. The runtime prices them per byte
  (`base + perByte × length`); Enjin exposes no constant for it, so the
  app reads it with a dry run of `preimage.notePreimage` (DryRunApi, from
  spec 1080) and otherwise uses its table per spec: 1.0016 ENJ + 0.000025
  ENJ per byte on 1070, 1 ENJ + 0.001 ENJ per byte on 1080
  (`lib/governance/filing-deposits.ts`). They can be reclaimed with
  `preimage.unnotePreimage` while the preimage is `Unrequested`.
  `setMetadata` doesn't request the envelope, so it stays `Unrequested`.
  Unnoting it removes the bytes that `MetadataOf` points to: the app still
  finds the record through its database, but outside readers can no
  longer resolve it from chain. The Reserved deposits panel therefore
  marks an envelope as the record of its referendum (its hash is a
  referendum's `metadataOf`, or its bytes start with `EGOV1:`) and asks
  for confirmation before unnoting it. The call of an ongoing referendum
  is also `Unrequested` on Enjin's runtime; the panel holds it back as
  "In use by a referendum" (`lib/governance/deposits.ts`).

The treasury wizard and the advanced composer show what a filing batch
reserves and only let a proposer continue when their free balance covers
it (`filingRequirement`): the submission deposit, the preimage deposits for
the call (unless inline or already noted) and for the EGOV1 envelope (its
length estimated from the app URL until the draft is staged), 0.01 of a
token for the fee, and `balances.existentialDeposit`, which must stay free
while deposits are reserved. The track's decision deposit is shown, not
required: deciding needs it, but anyone can place it later.

| Spec | Submission deposit | Preimage deposit |
|---|---|---|
| 1070 | 0.025 ENJ | 1.0016 ENJ + 0.000025 ENJ per byte |
| 1080 | 1,000 ENJ | 1 ENJ + 0.001 ENJ per byte |

Spec 1080 also raises the decision deposits (Root 2.5M ENJ, BigSpender
250k, MediumSpender 37.5k, SmallSpender 12.5k, BigTipper 5k, SmallTipper
2.5k ENJ). The app reads the submission and decision deposits from the
runtime's constants, so this table is for reference only.

Refunds follow pallet_referenda (`canRefundDeposit` in
`lib/governance/deposits.ts`); neither deposit comes back by itself, and
anyone can submit the refund for the original depositor:

| Status | `refundSubmissionDeposit` | `refundDecisionDeposit` |
|---|---|---|
| Ongoing | No (`BadStatus`) | No (`Unfinished`) |
| Approved, Cancelled | Yes | Yes |
| Rejected, TimedOut | No (`BadStatus`): stays reserved for good | Yes |
| Killed | Slashed | Slashed |

The proposal page and the Reserved deposits panel on `/account`
(`components/governance/reserved-deposits-panel.tsx`) offer Refund only
where the runtime accepts it, and say why a rejected or timed-out
referendum's submission deposit stays reserved. The panel lists the
connected account's deposits with `getReferendumDepositsFor` and
`getPreimageDepositsFor` (`lib/governance/deposits.ts`) and reclaims them
with `referenda.refundSubmissionDeposit`,
`referenda.refundDecisionDeposit` or `preimage.unnotePreimage`. A
reserved deposit is separate from a conviction lock: unlocking votes
never frees it.

## Conviction voting

### Calls and arity

Enjin adds a `currency` argument to the voting calls. The builders in
`lib/governance/conviction-voting.ts` use `voteManager` when the runtime
has it and `convictionVoting` otherwise, and read each call's argument
count from metadata, so `currency` is passed exactly when the runtime
expects it:

| Builder | Multi-token form | Stock Substrate form |
|---|---|---|
| `buildVote` (also split and split-abstain) | `vote(poll, vote, currency)` | `vote(poll, vote)` |
| `buildRemoveVote` | `removeVote(track, poll, currency)` | `removeVote(track, poll)` |
| `buildUnlock` | `unlock(track, target, currency)` | `unlock(track, target)` |
| `buildDelegate` | `delegate(track, to, conviction, balance, currency)` | `delegate(track, to, conviction, balance)` |
| `buildUndelegate` | `undelegate(track, currency)` | `undelegate(track)` |

`currency` defaults to ENJ (`{ Enj: null }`).

### Vote currency: liquid ENJ or staked-pool sENJ

A voter can vote with liquid ENJ (`{ Enj: null }`) or with a nomination
pool's sENJ tokens (`{ SEnj: { tokenId } }`, built by `sEnjCurrency(poolId)`;
the token id is the pool id). The runtime needs the inner struct: a flat
`{ SEnj: 34 }` fails to decode.

The currency is part of the `convictionVoting.votingFor` storage key,
which is a triple map of `(account, track, currency)`. `listVotesOnPoll`
reads it from the key, and on runtimes with `voteManager` it also reads
`voteManager.voteCurrencies`. One account can hold separate ENJ and sENJ
votes on the same referendum.

From spec 1080, sENJ of a pool that is being destroyed (pool state
`Destroying`) can no longer vote or delegate; spec 1070 still accepts it.
`getStakedEnjBalances` reports each pool's state, and the vote panel lists
such a pool disabled with a note (`senjCanVote` in
`lib/governance/staking-pools.ts`). The delegation form only delegates
liquid ENJ, so it has no pool to pick.

### Lock periods

`CONVICTION_LOCK_PERIODS` in `lib/governance/types.ts` gives the lock
length in periods: 0 for `None`, then 1, 2, 4, 8, 16 and 32 for `Locked1x`
to `Locked6x`. One period is the runtime constant
`convictionVoting.voteLockingPeriod` (100,800 blocks, 7 days, on both
networks), read by `getVoteLockingPeriod()`. The lock is the same on every
track and starts when the referendum ends; `convictionLockBlocks()` turns
it into blocks for the vote panel and the vote lists.

### Removing votes and unlocking

A conviction lock outlives the referendum. To free it, the voter:

1. removes the vote with `removeVote(track, poll, currency)`. The proposal
   page offers this, also for concluded referenda
   (`getMyVotesOnPollAnyTrack` finds the track from storage);
2. once the lock period has passed, calls `unlock(track, account, currency)`.

Locks are held per track and per currency: `classLocksFor` is keyed
`(account, currency)` on Enjin. An ENJ unlock frees the ENJ lock on that
track however many ENJ votes built it; an sENJ lock is freed separately.

`getAccountLocks(api, address)` builds the picture for the Locked balance
panel on `/account` (`components/governance/locked-balance-panel.tsx`, via
`useAccountLocks`):

- `classLocksFor.entries(address)` gives one row per track and currency,
  with the authoritative locked amount.
- `votingFor` for the same track and currency gives the votes that still
  hold the lock, and the `prior` lock (`unlockAt`, `amount`) that the
  chain sets when a vote is removed. An ENJ row never lists sENJ votes.

Each row shows one of: "Held by your vote on #N - remove it first",
"Unlocks in …" (a prior lock still counting down), or "Unlockable now"
with an enabled Unlock button. sENJ rows are labelled
`sENJ · <pool name>`. Voting, removing a vote or unlocking invalidates
`["account-locks", chainId, address]`, so the panel stays current.

### Delegation

The Delegation panel on `/account`
(`components/governance/delegation-panel.tsx`) delegates ENJ voting power:

- to one track, or to all eligible tracks in one signature (one
  `delegate` per track, batched). A track is eligible when the account
  isn't already delegating on it and has no active vote there; otherwise
  the runtime rejects the call.
- The target must be a valid address for the chain and not the account
  itself. The amount can't exceed the free balance.
- `getDelegationsFor` lists active delegations, one per track and
  currency. Each has its own Undelegate button.

## Staking-pool NFTs

Each nomination pool on the relay owns an NFT in the staking-pool
collection (the "Degens" family, collection `2` on mainnet). The UI uses
it as the pool's avatar next to sENJ votes and locks.

```text
poolId ─► nominationPools.bondedPools(poolId).tokenId ─► multiTokens (collectionId, tokenId)
```

- `getPool(api, poolId)` in `lib/governance/staking-pools.ts` reads the
  pool's `tokenId`, name and state. It returns `null` when the pallet or
  the pool is missing.
- `lib/governance/multi-tokens.ts`: `getCollectionUriTemplate(api,
  collectionId)` reads the collection's `uri` attribute, a template with
  `{id}`. `buildTokenMetadataUrl(template, c, t)` replaces `{id}` with
  `<c>-<t>`. `fetchTokenMetadata(url)` fetches and normalises the JSON and
  returns `null` on any error.
- `usePoolNft(poolId)` in `lib/query/hooks/use-pool-nft.ts` wraps these
  in React Query (30-minute stale time), so many rows for one pool share
  one fetch.
- `ChainConfig.stakingPoolNftCollectionId` (`lib/chain/chains.ts`) sets
  the collection per chain. `null` (Canary today) turns the lookup off,
  and the UI shows `Pool #N` text instead.

## See also

- [`ARCHITECTURE.md`](ARCHITECTURE.md) - layers and data flow
- [`CHAIN_FLOW.md`](CHAIN_FLOW.md) - RPC connection, archive RPCs, event matching
- [`WALLET_INTEGRATION.md`](WALLET_INTEGRATION.md) - how signing works
- `scripts/0*.sql` - the off-chain schema
