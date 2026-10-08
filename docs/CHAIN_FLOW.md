# Chain flow

How the app connects to Enjin chains, how connections are cached and
reused, and what happens when an endpoint is slow, down, or has pruned the
state a page needs.

## Endpoints

Configured in `lib/chain/chains.ts`. Primary and fallback URLs come from
`lib/env.ts`. Archive URLs are fixed in the registry.

| Chain | Enabled | Primary (default) | Fallback (default) | Archive |
|---|---|---|---|---|
| Enjin Relay | Yes | `NEXT_PUBLIC_ENJIN_RELAY_WSS` (`wss://rpc.relay.blockchain.enjin.io`) | `NEXT_PUBLIC_ENJIN_RELAY_FALLBACK_WSS` (`wss://enjin-relay-rpc.n.dwellir.com`) | `wss://archive.relay.blockchain.enjin.io` |
| Canary Relay | Yes | `NEXT_PUBLIC_CANARY_RELAY_WSS` (`wss://rpc.relay.canary.enjin.io`) | - | `wss://archive.relay.canary.enjin.io` |
| Enjin Matrix | No | `NEXT_PUBLIC_ENJIN_MATRIX_WSS` (`wss://rpc.matrix.blockchain.enjin.io`) | `NEXT_PUBLIC_ENJIN_MATRIX_FALLBACK_WSS` (`wss://enjin-matrix-rpc.n.dwellir.com`) | `wss://archive.matrix.blockchain.enjin.io` |
| Canary Matrix | No | `NEXT_PUBLIC_CANARY_MATRIX_WSS` (`wss://rpc.matrix.canary.enjin.io`) | - | `wss://archive.matrix.canary.enjin.io` |

- The env values must be `wss://` URLs; `lib/env.ts` rejects anything else.
  They are `NEXT_PUBLIC_*`, so they are built into the browser bundle and a
  change needs a redeploy.
- The Matrixchains are in the registry but disabled. They run the legacy
  `democracy` pallet, not OpenGov.
- Each registry entry also holds the SS58 prefix, the CAIP-2 ID that
  WalletConnect namespaces use (see
  [`WALLET_INTEGRATION.md`](WALLET_INTEGRATION.md)), the Subscan base URL
  and the treasury address.
- The defaults are Enjin's public RPC. For production traffic, use your own
  node or a paid provider (see [`DEPLOYMENT.md`](DEPLOYMENT.md)).

## Active chain (`lib/chain/use-chain.ts`)

- The chosen network is a zustand store saved in `localStorage`
  (`enjin-governance:chain`). A first visit starts on
  `NEXT_PUBLIC_DEFAULT_NETWORK` (`enjin-relay` or `canary-relay`; the default
  is `canary-relay`).
- `useActiveChain()` is the reactive read. `getActiveChain()` is for code
  outside React; on the server it returns the env default.
  `useChainHydrated()` turns true once the saved choice has loaded, so the
  UI doesn't flash the default chain first.
- Hooks take an optional `chain` and key their caches by chain ID or
  endpoint, so a network switch re-keys every query instead of mixing data.
- Switching networks in the UI disconnects the wallet. A proposal link with
  `?network=<id>` switches the active chain to match.

## Connection pool (`lib/chain/api.ts`)

`getApi(endpoint, retries = 3)` returns one cached `ApiPromise` per endpoint
URL.

- **Opening.** `ApiPromise.create` must resolve within 10 s, then
  `api.isReady` within 15 s. An API that misses either deadline is
  disconnected, so its socket doesn't leak.
- **Retries.** A failed open is retried `retries` times, 1 s apart (four
  attempts by default). Then `getApi` throws
  `Failed to connect to <endpoint> after N attempts`.
- **Sharing.** Concurrent callers for the same endpoint share one in-flight
  connection promise, so a burst of hooks opens one socket.
- **Cache hits.** A cached instance is returned while it reports
  `isConnected`. One that doesn't is dropped from the cache and
  disconnected, so its provider stops reconnecting in the background, and
  a new one is opened.
- **Provider settings.** The socket is a
  `WsProvider(endpoint, 1_000, {}, 10_000)`. After a drop it reconnects on
  its own, retrying every second. Any single RPC request without an answer
  within 10 s fails with `No response received from RPC endpoint in 10s`.
  Established subscriptions, such as an extrinsic's status feed, are not cut
  by this timeout.
- `disconnectApi(endpoint)` and `disconnectAllApis()` close cached sockets.
  Nothing in the app calls them today.

### In the browser

`useApi(chain?)` (`lib/query/hooks/use-api.ts`) wraps `getApi(chain.rpc)` in
React Query under the key `["api", endpoint]`, with `staleTime` and `gcTime`
set to `Infinity` and `retry: 3`. A page keeps one socket per endpoint it
uses, for its whole life. When the socket drops, the provider reconnects by itself;
requests in flight fail and their queries retry.

### On the server

Route handlers and the sitemap use the same pool. A warm function instance
reuses its socket across requests, and routes don't disconnect after use.
Server reads pass `retries = 0` and put one deadline on the whole read,
because the caller retries the request instead (for the sitemap, the next
hourly rebuild). See [Server-side reads](#server-side-reads).

## Refresh and retries in the browser (`lib/query/client.ts`)

- **Defaults.** `staleTime` 30 s, `gcTime` 5 min, `retry: 3` with
  exponential backoff capped at 10 s, no refetch on window focus. React
  Query never retries mutations.
- **Polling.** Reads poll; there are no storage subscriptions. The current
  block refreshes every 6 s, balances every 12 s, locks, votes and sENJ
  balances every 24 s, a referendum every 10 s while ongoing and every 60 s
  after, the referenda list and the support issuance every 60 s, an
  Approved referendum's scheduler lookup every 30 s while its call waits,
  and a spend's treasury proposal every 60 s until it is paid.
- **Runtime version.** `useSpecVersion` re-reads `api.runtimeVersion`
  every 15 s from memory (polkadot.js keeps it current); caches of runtime
  constants are keyed on it.
- **History.** Archive history (`useReferendumHistory`, and an executed
  enactment's record in `useEnactment`) never goes stale, since concluded
  state can't change.
- **After a transaction.** `useExtrinsic` invalidates that chain's referenda
  queries and all balance queries.

## Primary→fallback helper (`lib/chain/connect.ts`)

`createApiWithFallback(primary, fallback)` and `connectChain(chain)` open an
uncached `ApiPromise`:

1. Try the primary with a 10 s timeout.
2. On timeout or error, try the fallback with the same timeout, if one is
   configured.
3. If both fail, throw an error that names both endpoints.

The caller must `disconnect()` the result.

**No page or route uses this helper today.** The browser and the server
read through the pool, which only knows the primary endpoint. A primary
outage therefore shows as query errors, softened by React Query's retries,
until the endpoint recovers or its env var is pointed elsewhere and the app
is redeployed. The `*_FALLBACK_WSS` variables only take effect once a caller
uses the helper.

## Archive nodes

A concluded referendum's `referendumInfoFor` record keeps only its end block
and deposits (a killed one only its end block). The tally, the call and the
submitted block are gone. A full
node keeps about 256 blocks of state, so reading the last ongoing state
needs an archive node.

- `useArchiveApi(chain?)` (`lib/query/hooks/use-archive-api.ts`) opens
  `chain.archiveRpc` through the same pool, with the same settings as
  `useApi`. It falls back to the primary only when `archiveRpc` is null,
  which no chain currently is.
- Archive readers:
  - `useReferendumHistory(index, at)` calls `getReferendumHistory`
    (`lib/governance/referenda.ts`), which reads `referendumInfoFor` at
    block `at - 1`, the last block where the referendum was ongoing. Any
    error returns `null`.
  - `useReferendumVotes(index)` lists the voters of a concluded referendum
    (`listVotesOnPoll`) at `at - 1` on the archive, so votes removed after
    the end still count. Ongoing referenda read live state from the primary.
  - `POST /api/proposals/[uuid]/confirm` reads a concluded referendum's last
    ongoing state on the archive to find its depositor and its call.
- Preimages are read from the primary (`usePreimage`). A noted preimage
  stays in live state until someone unnotes it.

## Fallback order for older referenda

`/proposals/[index]` combines several sources. The first one that has the
data wins.

| Data | Sources, in order |
|---|---|
| Tally, submitted block, track, proposer, call hash | Live state (`useReferendum`) → archive at `at - 1` (`useReferendumHistory`) → Subscan (`useSubscanReferendum`) |
| Decoded call | `preimage.preimageFor` on the primary (`usePreimage`) → Subscan referendum `pre_image` → Subscan preimage endpoint (`useSubscanPreimage`) |
| Voters | Live state, or the archive at `at - 1` once concluded (`useReferendumVotes`) |

The Subscan requests run in parallel with the chain reads, not after they
fail, so the data is ready when it is needed.

`getPreimage` (`lib/governance/preimage.ts`) tries three lookups before it
gives up: the `(hash, len)` it was given; the length stored in
`preimage.requestStatusFor`, for old referenda that report `len = 0`; and a
scan of the `preimage.preimageFor` keys for the hash.

Subscan:

- The browser never calls Subscan directly. The routes under
  `app/api/subscan/[chain]/` (`referendum`, `preimage`, `votes`) proxy it and
  add `SUBSCAN_API_KEY` when it is set. The key is optional.
- Responses carry CDN cache headers, because Subscan allows 5 requests per
  second: a referendum 5 minutes (1 day once concluded), a preimage 1 hour,
  votes 5 minutes, each with `stale-while-revalidate`. The client hooks use
  similar stale times.
- Only Enjin Relay (and the disabled Enjin Matrix) has a Subscan API base
  in `lib/subscan/client.ts`. Canary gets no Subscan data, so older Canary
  referenda depend on the archive node alone.

## Submitting extrinsics (`lib/query/hooks/use-tx.ts`)

`useExtrinsic({ build, resolveOn, onStatus, onSuccess, onError })` returns
`submit()`, which runs these steps:

1. **Build.** `build(api)` returns one extrinsic or an array. An array is
   wrapped in `utility.batchAll`, so every call applies or none does.
2. **Sign.** The address is re-encoded to the active chain's SS58 prefix
   and signed with `signAsync` and a mortal era of 256 blocks (about 25
   minutes at 6 s per block). Enjin Wallet refuses immortal payloads over
   WalletConnect, and the long era survives slow mobile round-trips.
3. **Wait for the socket.** Mobile browsers suspend background tabs while
   the user signs in the wallet, which can close the RPC socket. If it is
   down after signing, the hook waits up to 15 s for it to reconnect, then
   fails with "Chain RPC is reconnecting".
4. **Send and watch.** The status moves through broadcast, in block and
   finalized. `resolveOn: "in-block"` (the default) settles on inclusion.
   `"finalized"` waits for finality; the proposal flows use it because the
   referendum index is written to the database. A finalized notice always
   settles the call, even when the in-block notice was lost.
5. **Errors.** A dispatch error is decoded with `decodeDispatchError`
   (`lib/chain/events.ts`) into `pallet.Error: docs`.
6. **Lost notifications.** If no final status arrives within 90 s, the call
   fails with a message that the transaction may still have landed, and the
   subscription is torn down.

A second `submit()` while one is running returns the same promise. Nothing
is retried automatically. The proposal flows re-read the preimage status
and `referenda.referendumCount()` right before signing, and again after an
`AlreadyNoted` error, so the next attempt builds a batch that can succeed.

## Server-side reads

The server reads the chain only before it acts on a proposal, and for the
sitemap.

| Caller | Reads | Endpoint | `getApi` retries | Deadline | On failure |
|---|---|---|---|---|---|
| `POST /api/proposals/[uuid]/confirm` | `referenda.metadataOf`, `referendumInfoFor` | Primary; archive for a concluded referendum | 0 | 8 s per check | 503, retryable (fails closed) |
| `isEnvelopeOnChain` (`lib/governance/envelope-status.ts`), through `anyVersionOnChain` in `POST /api/proposals/draft` (re-stage) and `DELETE /api/proposals/[uuid]` | `preimage.requestStatusFor` for each stored version's envelope | Primary | 0 | 8 s per version | 503; nothing is written or deleted (fails closed) |
| `PATCH /api/proposals/[uuid]` (`referendumConcluded`) | `referendumInfoFor` | Primary | 0 | 8 s | The edit is allowed (fails open) |
| `/sitemap.xml` (`listPublicReferenda` in `lib/seo/referenda.ts`) | `referenda.referendumCount` | Primary of `NEXT_PUBLIC_DEFAULT_NETWORK` | 0 | 5 s | The sitemap lists only the referenda the database knows; it never fails |

The confirm route is also rate-limited per account (30 calls in 5 minutes),
because every call reads the chain. Over the limit it answers `429` with
`retryable: false`.

The confirm route answers with a `retryable` flag:

- chain unreachable: 503, retryable;
- no metadata on chain yet (the node is behind): 409, retryable;
- a different envelope, depositor or call: 409, not retryable.

`confirmWithRetry` (`lib/governance/confirm-client.ts`) retries retryable
answers up to three times, 1 s, 3 s and 6 s apart. Without the flag, a 5xx
counts as retryable and a 4xx as final. On a 401 it signs in once and
retries straight away.

The edit check fails open on purpose. A transient RPC error at worst allows
an edit, and the edit still shows, because the JSON hash no longer matches
the on-chain envelope.

## Events and errors (`lib/chain/events.ts`)

- `findEvent` and `findAllEvents` match event records by `section` and
  `method` strings, so they need no `api` instance. The proposal flows use
  `extractReferendumIndex(events)` (`lib/governance/referenda.ts`), which
  reads the new index from the `referenda.Submitted` event with
  `findEvent(events, "referenda", "Submitted")`.
- `wasExtrinsicSuccessful` and `didExtrinsicFail` check for
  `system.ExtrinsicSuccess` and `system.ExtrinsicFailed`.
- `decodeDispatchError(api, error)` resolves module errors through the
  metadata, so the UI shows `balances.InsufficientBalance: …` instead of a
  raw index.
- `isDiscardedError(error)` recognises the "State already discarded",
  "Unknown block" and "Unable to retrieve header" errors a pruned node
  returns. App code doesn't call it today: `getReferendumHistory` treats
  every error as "no history" and returns `null`.

## SS58 and WASM (`lib/chain/ss58.ts`)

`@polkadot/util-crypto` does address and signature work in WASM, which
loads asynchronously. `initializeWasm()` wraps `cryptoWaitReady()` once per
process. API routes await it before they decode addresses or verify
signatures. In the browser, `WalletRestoreMounter`
(`lib/wallet/restore-mounter.tsx`) calls it on mount.

Other helpers: `samePublicKey` compares addresses across prefixes,
`encodeForChain` re-encodes to a chain's prefix, and
`isValidAddressForChain` and `inspectAddress` check an address against a
chain.

## Bundling and CSP (`next.config.mjs`)

- `serverExternalPackages` loads these from `node_modules` at runtime on the
  server instead of bundling them: `@polkadot/api`, `@polkadot/util`,
  `@polkadot/util-crypto`, `@polkadot/keyring`, `@polkadot/extension-dapp`
  and `@neondatabase/serverless`.
- Builds use Turbopack, the Next.js 16 default. The `turbopack` block is
  empty: there are no aliases or fallbacks for Node built-ins.
- The CSP `connect-src` is `'self' wss: https:`, so any `wss://` RPC and any
  `https://` API is allowed. Changing an RPC URL needs no CSP change.
  `frame-src` allows WalletConnect's verify pages.

## See also

- [`ARCHITECTURE.md`](ARCHITECTURE.md) - layers, modules and data flow
- [`GOVERNANCE_FLOW.md`](GOVERNANCE_FLOW.md) - specific reads and writes
- [`WALLET_INTEGRATION.md`](WALLET_INTEGRATION.md) - connectors, signing and CAIP-2 IDs
- [`ENVIRONMENT.md`](ENVIRONMENT.md) - the RPC env vars
- [`DEPLOYMENT.md`](DEPLOYMENT.md) - custom RPC and security headers
