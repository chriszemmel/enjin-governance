# Changelog

All notable changes to Enjin Governance. Versions follow
[semantic versioning](https://semver.org/); dates are UTC.

## 2.0.0 - unreleased

Everything since 1.0.0 in one release: the patches 1.1 to 1.9 below.
Highlights:

- **Better proposals:** Markdown text with inline images, tables and
  address chips, a live preview, and a title, text and EGOV1 record for
  any call, not just treasury spends.
- **Moderation:** reports, a review queue, roles by wallet, posting
  pauses and a public moderation log, with optional automatic checks,
  a status page and one-click backups for admins.
- **Legal pages:** imprint, privacy policy and terms.
- **Safer by default:** a 4 MB upload limit, attachment details checked
  against the stored files, rate limits on every write, and several
  rounds of security review.
- **Found by search engines:** robots.txt, a sitemap and per-page
  metadata.
- **Tested end to end:** route tests, database tests against real
  Postgres, and browser tests in CI.

### Upgrading from 1.0

1. Back up the database (a Neon branch is enough), then run
   `pnpm db:migrate --until 013` for migrations `011`, `012` and `013`.
   Don't apply `014` yet: it drops a column 1.0 still writes.
2. Set `NEXT_PUBLIC_APP_URL` to the production domain: in production the
   app refuses to stage proposals while it points at localhost.
3. Set `GOVERNANCE_ADMIN_PUBLIC_KEYS` to your wallet to become the first
   admin. Optional: `ANTHROPIC_API_KEY` for automatic checks,
   `TELEGRAM_MODERATION_CHAT_ID` for moderation notices, the `LEGAL_*`
   details, and Upstash (`KV_REST_API_*`) for shared rate limits.
4. Redeploy, then open **Moderation → Status** as an admin: it lists
   anything still missing.
5. Only once 2.0 is live and you won't roll back to 1.0, run
   `pnpm db:migrate` to apply `014`, which drops the never-written
   `proposals.proposer_signature`. 1.0 inserts that column on every
   draft: applied earlier, `014` breaks staging drafts on 1.0 and any
   rollback to it.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the details.

### Since 1.9

- **Backups:** admins download one ZIP from Moderation → Status → Backup
  with every table, a restore script, every proposal JSON file and,
  optionally, the uploaded files. Backups are kept in R2 (the newest
  five) and downloaded through a five-minute link.
- **Dependencies:** `pnpm audit` reports nothing; Vitest 5, and newer
  ESLint and PostCSS.
- **Phones:** proposal tables scroll again instead of squeezing a column
  to one letter; sign-in prompts are one link that comes back to the
  page; a dialog opened by touch no longer rings its close button; the
  advanced proposal page says a wallet is needed before its fields
  unlock; a shorter footer that shows the release.
- **Faster proposal pages:** the title and summary come with the page
  from the server, so they show before the chain connection is up. The
  wallet dialog loads only when it's opened.
- **Accessibility:** names for the vote carousel buttons, focus that
  stays in dialogs, and stronger contrast in the light theme.
- **Runtime upgrades** are filed as `system.authorizeUpgrade(code_hash)`
  on Root, with the hash pasted or computed in the browser from the
  `.wasm`; once enacted, anyone applies the file with
  `system.applyAuthorizedUpgrade`. `system.setCode` and the wasm upload
  are gone from the advanced composer. The proposal page shows the code
  hash for both kinds. (#8)
- **Inline proposals** (calls of 128 bytes or less) are decoded on the
  proposal page from the referendum itself; a decided one with the runtime
  of the block it was read at. (#8)
- **Submitting is sturdier:** a batch leaves out a preimage note only
  when an account already noted those bytes (a requested preimage is
  noted again). The advanced composer refuses to sign without a fresh
  referendum count, ignores a double tap while signing in or saving,
  links the draft its batch was built with, and shows success at
  finality, then links the details. A sign-in for another account no
  longer counts. Advanced drafts can be cancelled, then deleted, from
  `/account`. (#8)
- **Treasury tiers follow the runtime's spend limits** for spec 1070 and
  1080 (SmallTipper was offered up to 250 ENJ but mainnet allows 100, so
  such spends failed at enactment). TreasuryAdmin is the top tier at
  25,000,000 ENJ. An unlisted runtime gets a warning, the wizard warns when
  a request is larger than the treasury holds, the proposal page flags an
  ongoing spend above its track's limit, and `/docs` shows the limits per
  spec. (#9)
- **Deposit refunds follow the runtime:** a submission deposit is offered
  for refund only when the referendum was approved or cancelled, and a
  decision deposit once it concluded. A rejected or timed-out
  referendum's submission deposit stays reserved for good; the proposal
  page and the Reserved deposits panel now say so instead of showing a
  Refund button that failed with `BadStatus`. A killed referendum's
  deposits show as slashed.
- **Filing shows what it reserves:** both composers list the submission
  deposit, the preimage deposits for the call and the EGOV1 record (priced
  per byte by the runtime, read with a dry run where the runtime offers
  one), fees and the minimum balance, and only let a proposer continue
  when their free balance covers them. The track's decision deposit is
  shown but no longer required to file: anyone can place it later, and on
  spec 1080 it reaches 250,000 ENJ for BigSpender. The review step no
  longer says the submission deposit is refunded when the referendum is
  decided: it comes back only if the referendum is approved or cancelled.
- **Pools being destroyed:** from spec 1080, sENJ of a nomination pool in
  the Destroying state can't vote or delegate. The vote panel lists such a
  pool disabled with a note and falls back to ENJ; on 1070 it can still
  vote.
- **Migration `014`** drops `proposals.proposer_signature`, which was
  never written (drafts always stored null) and is no longer read or
  inserted. Apply it only after 2.0 is deployed (upgrade step 5);
  `pnpm db:migrate --until 013` applies the earlier ones without it, and
  restoring a backup uses the same option to match the migrations its
  manifest lists.
- **Every admin origin in the advanced composer:** StakingAdmin,
  TreasuryAdmin, LeaseAdmin, FellowshipAdmin, AuctionAdmin,
  MultiTokensAdmin, FuelTanksAdmin, WhitelistAdmin and ParachainsAdmin join
  GeneralAdmin, each mapped to its track and listed in track order.
- **No duplicate referenda on Retry:** when a batch landed but its status
  updates were lost, Retry in either composer finds the referendum it
  filed and links it instead of filing it again with a second deposit.
  Neither composer signs once the account or network changed after
  Review.
- **Sign-in and drafts:** closing the WalletConnect sign-in dialog no
  longer locks the advanced composer. A draft whose batch landed can't be
  cancelled (link it instead). `/account` and `/treasury` find the drafts
  of extension accounts, and the drafts panel offers sign-in when the
  session is for another account.
- **WalletConnect on other domains:** the app announces the page's own
  origin to wallets, so a preview deployment no longer claims to be the
  production site. When the relay refuses the connection, the error says
  why (the site isn't in the Reown project's allowed domains, or the
  project id is wrong) instead of a generic timeout.
- **Support is measured like the runtime does it:** against active
  issuance (total minus inactive) on spec 1070, against total issuance
  from 1080. Mainnet showed about 28% too little support: about 575M of
  the 2,029M ENJ is inactive.
- **Enact and Payout follow the chain:** an approved referendum's Enact
  stage stays in progress until the scheduler runs the call (mainnet #12
  was enacted a day after approval), read from `scheduler.lookup`, with
  the executed block and result from the archive; a failed call shows as
  failed. While confirming, the estimate uses the requested enactment
  (`After` / `At`) and the track minimum. A treasury `spend_local` gets a
  payout step: next spend period, then paid, from `treasury.proposals`.
- **A calmer lifecycle card:** while anything is still to come it leads
  with the time left (to vote, to confirm, to enactment, to the payout)
  and lists Prepare, Decide, Confirm, Enact and the payout with one date
  each, estimates marked "≈". Confirmation starts where the runtime's alarm
  says rather than at a guess. Once everything has happened the card folds
  to one line ("Paid out 30,000 ENJ", "Enacted on Aug 24"), with every
  event and its block behind Details. Proposal cards say "Voting" or
  "Confirming" with the time left, an approved one its approval date, and
  drop the block number from the footer. Fits a 360 px screen.
- **What is asked comes first:** on a proposal page the treasury request
  (amount, beneficiary, call) now sits above the lifecycle. Proposal cards
  show what a live spend pays next to "Voting", decoded from its call on
  chain rather than taken from the proposer's metadata.
- **Treasury counts include decided spends:** a decided referendum no
  longer carries its track on chain, so the treasury page counted 0
  approved and 0 rejected. Tracks of decided referenda are read from the
  archive one at a time from their raw storage (no old runtime metadata
  needed) by the server, which caches them for good and serves them from
  the CDN, so a phone gets the counts in a couple of seconds without any
  archive read of its own. What the server can't supply the browser reads
  itself, with retries; only if that fails too do the counts say "-".
- **A share image per referendum:** links to a referendum now unfurl with
  its own card - number, track, title, and the amount it requests or what
  it does in words ("Runtime upgrade", "Batch · 4 calls"). Only stable
  facts, no status or tally, so each card is drawn once and cached for a
  day. Short titles are set large, long ones step down to a floor and are
  cut after four lines; the rest of the card never changes size. The image
  lives at `/og/referendum/<network>/<index>`, so a Canary page shows the
  Canary referendum.
- **Runtime upgrades in an open tab:** tracks, spend tiers, the support
  denominator and treasury constants are keyed on the runtime's spec
  version and refresh when it changes, instead of keeping the old values
  until a reload.

## 1.9

- **Search:** robots.txt, a sitemap with every referendum, a web app
  manifest, per-page titles, descriptions, canonical URLs and share
  previews, structured data on proposal pages, and noindex on private
  areas. A path with a broken %-escape answers 400 instead of a server
  error.
- **Status page for admins:** Moderation → Status shows the database and
  migrations, storage and the public URL, the rate-limit store,
  Telegram (with a test message), the content checks, the legal details
  and WalletConnect.
- **Content-check health:** a check that fails because of the setup
  (bad key, a model that is no longer available, no credit left) is
  shown in Status and Settings and reported to the moderators' Telegram
  chat once a day. The daily check limit holds even when the database
  fails.
- **Comments** can be edited for 15 minutes after posting.
- **Conviction lock times** now use the runtime's vote-locking period;
  most tracks showed twice the real lock.
- **Reserved deposits:** the preimage holding a referendum's EGOV1
  record asks for confirmation before it is unnoted, and the call of an
  ongoing referendum isn't offered for reclaim.
- **Fixes:** clearing a profile field works; sign-in accepts only the
  Enjin and Canary relay address formats and survives odd proxy headers;
  display names are checked in a normalised form; rate limits on profile
  saves, confirm, cancel, withdraw and comment edits and deletes; the
  site refuses to pin a localhost URL on chain; dropped chain
  connections are closed; a restored wallet session falls back to an
  account it really has.
- **Tests:** database tests against Postgres (PGlite) with the real
  migrations, and Playwright browser tests in CI.
- **Docs:** every document checked against the code and rewritten where
  needed.

## 1.8

- Uploads are limited to 4 MB, the most the hosting accepts; large
  photos are shrunk in the browser first.
- The size, type and hash of each attachment are checked against the
  stored file, and file names can't be disguised.
- The supported AI models live in one table, so a newer model is one
  entry.
- Fixes from a security review: every staged draft version is kept, a
  copied EGOV1 envelope can't block or claim a submission, unsigned
  drafts are private to their proposer, and the daily check limit is a
  hard cap.
- Route tests for every API route that writes data or checks
  permissions, and the fixes they led to: no redirect to another site
  after unlocking, no look-alike handles, comments only on published
  proposals, and a failed undo no longer withdraws again.
- A README with screenshots.

## 1.7

- Content-check settings for admins: on or off, the model, what is
  checked, reject or hold clear violations, a daily limit, and this
  month's usage and cost. Replaces the `CONTENT_SCAN` variable.
- New reports are posted to the moderators' Telegram chat.
- Migrations `012` and `013`.

## 1.6

- Imprint, privacy policy and terms, filled from `LEGAL_*`.
- A footer with legal links, a disclaimer and the AGPL source link.

## 1.5

- Automatic checks of uploads, proposal text and comments; borderline
  items go to the review queue.

## 1.4

- Moderation: reports, a review queue, roles by wallet, posting pauses
  and a public moderation log.
- Migration `011`.

## 1.3

- Advanced proposals get a title, description and EGOV1 record; EGOV1
  1.2.0 adds the `call` and `enactment` sections.

## 1.2

- Proposal text with Markdown, inline images, address chips and a live
  preview; an image viewer and thumbnails.

## 1.1

- An address from another network is converted only after asking.
- Drafts are updated in place, resumed, and linked to their referendum.
- Sign-in from the drafts panel, readable API errors, and long words
  wrap on small screens.

## 1.0.0 - 2026-06-28

First public release: live referenda from the chain, conviction voting
and delegation, treasury proposals with the EGOV1 record, sign-in by
signature, profiles and comments.
