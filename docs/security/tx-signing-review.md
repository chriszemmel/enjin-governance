# Transaction signing review

Every place the app builds something for the user to sign, what the user sees
before signing, and whether that is exactly what gets signed. Written
2026-11-24 against `main` at `574a001` plus the QA patch; mainnet Enjin Relay
was on spec 1082. F1 and F2 are fixed on the same branch; the other
findings are listed, not fixed.

**How it was checked**

- **Code reading** of each signing site.
- **Component tests** (`components/**/__tests__`): the real panel and the
  real `useExtrinsic`, with a fake chain whose extrinsics record what is
  passed to `signAsync`. A test enters values in the UI and asserts on the
  extrinsic the signer received.
- **Fork checks** (`pnpm test:fork`, `fork/signing.fork.ts`): a Chopsticks
  fork of Enjin Relay mainnet. Each flow is built with the app's own
  builder, signed through a payload-signing "wallet" that keeps the payload,
  included in a block, and read back. Asserted: payload `method` == built
  call == call in the block, the dispatch succeeded, and chain state matches
  the values the UI shows.

A finding left open can be pinned with `it.fails`: the test passes while
the finding stands and turns red once it is fixed (then flip it to `it`).

## The signing path

All extrinsics go through `useExtrinsic` (`lib/query/hooks/use-tx.ts`):

1. `build(api)` returns one extrinsic or an array; an array is wrapped in
   `utility.batchAll` (all or nothing).
2. The connected address is re-encoded to the active chain's SS58 prefix.
3. `tx.signAsync(address, { signer, era: 256 })` - one signature, mortal
   for 256 blocks (~25 min), then `send`.

Signers:

| Wallet | Signer | What the wallet is given | Can it sign something else? |
|---|---|---|---|
| Polkadot.js, Talisman, SubWallet, PolkaGate | extension `injected.signer` (`lib/wallet/connectors/extension.ts`) | `SignerPayloadJSON`; the extension decodes and shows the call | No: only the returned signature is used; a different payload gives an invalid signature |
| Enjin Wallet, WalletConnect | `polkadot_signTransaction` (`lib/wallet/connectors/walletconnect.ts:752`) | `SignerPayloadJSON` minus `null` fields and `withSignedTransaction` (`toRequestPayload`) | No: only `result.signature` is used, a returned `signedTransaction` is ignored |

The dropped fields carry nothing for this app (`mode` 0, no `assetId`), so
the signed bytes are unchanged. Fork check: the payload's `method` equals
the built call for every flow below.

For WalletConnect users, `SignRequestModal` is shown while the phone signs.
It shows the wallet name, a fixed sentence per flow ("Approve the vote in
your wallet") and the lifecycle - **no amount, conviction, track or
target** (pinned in `sign-request-modal.test.tsx`). Extension users see the
extension's own popup instead.

## Signing sites

"Shown" is what the app shows before the click that starts signing. ✅ means
every value in the signed call is shown and equal; ⚠️ means a value is
shown differently or not at all (see the finding).

| # | Where | Signed call | Shown before signing | Equal? | Checked by |
|---|---|---|---|---|---|
| 1 | Vote - `components/governance/vote-panel.tsx:253` | `convictionVoting.vote(poll, Standard{aye, conviction, balance} \| SplitAbstain{0, 0, amount}, currency)` | referendum #, Aye/Nay/Abstain, amount as typed, source (ENJ / sENJ pool), conviction (multiplier + lock), voting power | ✅ values; ⚠️ preview rounding (F4), lock wording (F9) | component, fork |
| 2 | Remove vote - `vote-panel.tsx:336` | `convictionVoting.removeVote(track, poll, currency)` | the vote card (amount, conviction, source); track not shown, taken from the vote | ✅ (track is the vote's own; F1 fixed) | component, fork |
| 3 | Delegate - `components/governance/delegation-panel.tsx:320` | `delegate(track, to, conviction, balance, Enj)`, or `batchAll` of one per track | track or "All tracks (N)", conviction multiplier, target address (full, as typed), amount as typed | ⚠️ "All tracks": count only, not which (F6) | component, fork |
| 4 | Undelegate - `delegation-panel.tsx:95` | `undelegate(track, currency)` | row: amount, track name, target (short), conviction, currency | ✅ call; ⚠️ amount ticker (F7) | component, fork |
| 5 | Unlock - `components/governance/locked-balance-panel.tsx:80` | `unlock(track, ownAddress, currency)` | amount + token; track not shown | ✅ (only frees own expired locks) | fork (builder) |
| 6 | Refund / reclaim - `components/governance/reserved-deposits-panel.tsx:83` | `referenda.refundDecisionDeposit(i)` / `refundSubmissionDeposit(i)` / `preimage.unnotePreimage(hash)` | referendum #, kind, amount / hash (first 10 chars), confirmation for a proposal record | ✅ (hash truncated, own deposits only) | code |
| 7 | Refund button - `components/governance/refund-deposit-button.tsx:65` | `refundDecisionDeposit(i)` / `refundSubmissionDeposit(i)` | button on referendum # page | ✅ | code |
| 8 | Place decision deposit - `components/governance/place-deposit-button.tsx:51` | `referenda.placeDecisionDeposit(i)` | referendum page, amount "Reserves X" from the track table | ⚠️ amount missing while tracks load (F10) | fork (builder) |
| 9 | Fellowship decision deposit - `components/fellowship/fellowship-deposit-button.tsx:28` | `fellowshipReferenda.placeDecisionDeposit(i)` | F# page, amount from the track | ✅ | code |
| 10 | Fellowship vote - `components/fellowship/fellowship-vote-panel.tsx:66` | `fellowshipCollective.vote(poll, aye)` | F#, Aye/Nay, rank, weight | ✅ (Retry fixed, F2) | component |
| 11 | Treasury top-up - `components/governance/top-up-treasury-button.tsx:88` | `balances.transferKeepAlive(chain.treasuryAddress, amount)` | amount (button: 6 decimals), USD estimate, "treasury system account" | ✅ amount and recipient; ⚠️ rounding (F4) | fork: address == treasury pallet account, exact amount transferred |
| 12 | Treasury proposal - `app/create/page.tsx:750` | `batchAll[preimage.notePreimage(spendLocal(amount, beneficiary)), referenda.submit(Origins.<tier>, Lookup{hash, len}, enactment), preimage.notePreimage(envelope), referenda.setMetadata(index, hash)]` | review: amount, beneficiary, track, raw call hex, preimage hash, enactment; submit step: one card per call | ✅ (raw bytes shown); ⚠️ amount rounded (F4) | fork: referendum on the tier's track, preimage == spendLocal(amount, beneficiary), metadata == envelope |
| 13 | Advanced composer - `app/create/advanced/page.tsx:854` | `batchAll[(notePreimage), submit(origin, Inline \| Lookup, enactment), (notePreimage envelope), setMetadata]`, or envelope + `setMetadata` for an existing referendum | pallet.method, call hex, hash, size, origin, enactment | ⚠️ arguments not decoded (F11) | unit (builders) |
| 14 | Sign-in - `lib/auth/siwe.ts:48`, signed via `signRaw` | a text message: app name, address, nonce, time | the wallet shows the message | ⚠️ no site in the message (F12) | code |
| 15 | Claim a payout - `components/governance/claim-payout-button.tsx` | `treasury.payout(index)` | the confirmation: amount, beneficiary (identicon, short address linked to Subscan, copy button, "You" when it is the connected account), `treasury.payout(index)`, who receives it, the deadline | ✅ the index is the spend the card names; the funds go to the beneficiary, not the signer | component, fork (`fork/spend-claim.fork.ts`) |

## Findings

Severity is about what a user could end up signing or believing; none of
these lets the app sign a call other than the one it built.

### F1 - High: votes cast on spec 1082 can't be read back (fixed)

Spec 1082 stores each casting vote as `{ vote: AccountVote, counted:
AccountVote }`. `decodeVotes` (`lib/governance/conviction-voting.ts`)
still read the entry as a bare `AccountVote`, finds neither `isStandard`
nor `isSplit`, and throws on `asSplitAbstain` (`TypeError: Cannot read
properties of undefined (reading 'aye')`). On the fork:

- `getMyVotesOnPoll` throws, so the vote panel shows "Cast your vote" with
  no current vote and no remove button, right after the user voted;
- `getAccountLocks` throws for every account with an active vote, so the
  locks panel fails (and feeds F6);
- `listVotesOnPoll` and `getMyVotesOnPollAnyTrack` use the same decoder.

Signing is not affected (the vote lands as built), but what the user sees
afterwards contradicts it. On mainnet, referendum 20's page said "No votes
have been cast" while its tally showed 21 votes.

**Fix:** `decodeVotes` reads both shapes and takes the account's own vote
from `vote` (`counted` is what the tally holds). An entry in neither shape
is left out instead of failing every vote of the account. Checked by unit
tests for both shapes, by the fork checks (the vote panel, voter list and
locks readers see what was signed) and read-only against mainnet:
referendum 20's 21 votes are read again.

### F2 - High: Fellowship Retry can sign the opposite vote (fixed)

The Retry in the sign-request modal calls `tx.submit()` again, and `build`
reads the panel's current choice (`vote === "aye"`). A
`useEffect(() => setVote(null), [myVote?.aye])` clears the choice whenever
the on-chain vote changes. If the first attempt did land but the app
reported it lost (the 90 s "Lost contact… tap Retry" error), the refetch on
returning from the wallet shows the new vote, the choice resets to `null`,
and Retry signs **Nay** while the user chose Aye. The vote panel, delegation
and lock flows don't have this: they keep the target in a ref or hydrate
only once.

The success card had the same cause: after a vote landed, the refetch reset
the selection and the card named "Nay" for an Aye vote.

**Fix:** the panel keeps the choice the user signed for; Retry signs it
again and the success card names it, whatever the selection is by then.
Checked by `components/fellowship/__tests__/fellowship-vote-panel.test.tsx`,
which fails on the old panel (Retry signed `[poll, false]`).

### F3 - Medium: nothing in the sign-request modal says what is signed

For WalletConnect, the last in-app screen before the phone takes over is
`SignRequestModal`, which carries no amount, conviction, track or target -
only "Approve the vote in your wallet". Flows 1-11 are one click from the
form to the wallet, so the user must check every value on the phone. Fine
when the wallet decodes the call well; the app can't verify that.
Suggestion: pass a one-line summary ("Aye · 12.5 ENJ · 3x · referendum
#42") to the modal.

### F4 - Medium: amounts are shown cut off, without a sign

`formatTokenAmount` truncates to 4 decimals by default, without `≈`: the
treasury proposal review (`amountFormatted`), delegation rows and locks use
it; the top-up button uses 6 decimals, the vote preview 2. The signed amount
is always the exact amount typed. Example: 100.00009 ENJ is reviewed as
"100 ENJ" and signed as 100.00009.

### F5 - Low: "1,000" is one ENJ

`parseTokenAmount` reads `,` as the decimal separator, so an English "1,000"
is 1 ENJ, not a thousand. The preview shows "≈ 1 ENJ" before signing, so it
is visible. Pinned in `vote-panel.test.tsx`.

### F6 - Low: "All tracks" doesn't say which tracks

The form shows "All tracks (N)" and "Delegates across all N eligible tracks
in one signature" but not their names. Eligibility excludes tracks with an
active vote using the locks query; while that is still loading or has failed,
those tracks are included and the whole `batchAll` reverts with
`AlreadyVoting`. Derived from code, not run on the fork.

### F7 - Low: sENJ delegations are printed in ENJ

A delegation row prints its amount with the chain ticker ("100 ENJ") next to
the label "sENJ · Pool #4". The undelegate call is right (currency SEnj).
Pinned in `delegation-panel.test.tsx`.

### F8 - Low: the recipient of a top-up isn't shown

The dialog names "the treasury system account" but not its address. The
configured `treasuryAddress` is the treasury pallet's account (fork check),
and the wallet shows the address.

### F9 - Low: lock wording

The vote panel says "Lock for 28d after the referendum ends" for every
conviction vote; the runtime locks a vote only when it ended on the winning
side. The delegation text says the balance is locked "until you undelegate";
after undelegating, the conviction lock period still runs.

### F10 - Low: a decision deposit can be placed without its amount on screen

"Reserves X" is shown only once the track table resolves; the button works
before that. The wallet shows `placeDecisionDeposit(index)`, not the amount
it reserves (on the root track, a large sum).

### F11 - Low: raw calls are previewed as pallet.method and bytes

The advanced composer shows the pasted call's `section.method`, hex, hash and
size, but not its arguments. The bytes are exact (a call that doesn't
re-encode to the pasted bytes is refused), but e.g. a transfer's amount is
only visible as hex.

### F12 - Low: the sign-in message doesn't name the site

`buildSiweMessage` contains the app name, address, nonce and time, but no
domain or URL. A lookalike site can fetch a nonce for the victim's address
from the real server and have the victim sign an identical message, then
sign in as them (comments, profile, drafts - no funds). Adding the origin
to the message lets the user see where they sign in.

## Not covered

- What each wallet's own screen shows - the app can only control the
  payload.
- Fork runs of refunds, unnoting and the fellowship flows: they need a
  finished referendum or fellowship membership on the fork.
