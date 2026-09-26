# Wallet integration

The app supports six wallets over two transports, behind one `Connector`
interface:

- **WalletConnect v2** - Enjin Wallet and any WalletConnect-compatible
  Polkadot wallet (Nova, Talisman Mobile, SubWallet Mobile, ...). The user
  scans a QR code; on a phone, Enjin Wallet can also be opened with a deep
  link.
- **Browser extensions** - Polkadot.js, Talisman, SubWallet and PolkaGate.
  All four inject through `@polkadot/extension-dapp`, so one connector
  factory drives them. Only the injection key and install link differ.

The connect modal lists every wallet. A wallet that isn't available is
greyed out and, when it has one, links to its install page.

## Where the code lives

| File | Role |
|---|---|
| `lib/wallet/connectors/types.ts` | `Connector` interface and session types |
| `lib/wallet/connectors/walletconnect.ts` | The two WalletConnect connectors and their signer |
| `lib/wallet/connectors/extension.ts` | The four extension connectors |
| `lib/wallet/connector-registry.ts` | `CONNECTOR_REGISTRY` (order, names, icons, install links) and `walletDisplayFor` |
| `lib/wallet/store.ts` | Zustand store for the session and active address, and `restoreWallet` |
| `lib/wallet/use-wallet.ts` | `useWallet`, `useWalletActions`, `useDisplayAddress` |
| `lib/wallet/restore-mounter.tsx` | Restores the session when the app loads |
| `lib/wallet/deep-link.ts` | Enjin Wallet deep links and mobile detection |
| `lib/wallet/use-sign-flow.ts` | State and deep link for the sign-request modal |
| `lib/wallet/use-ensure-signed-in.ts` | Signs in before a write that needs a session |
| `components/wallet/wallet-modal.tsx` | Connect modal, QR view, account picker and switcher |
| `components/wallet/sign-request-modal.tsx` | Status modal for WalletConnect signatures |
| `components/wallet/branded-qr.tsx` | QR code with the wallet's logo in the middle |

## Connector interface

```ts
// lib/wallet/connectors/types.ts (condensed)
export interface Connector {
  id: ConnectorId
  detect(): Promise<"installed" | "not-installed" | "n/a">
  connect(options?: { onUri?: (uri: string) => void }): Promise<ConnectedSession>
  disconnect(session: ConnectedSession): Promise<void>
  getSigner(session: ConnectedSession, address: string): Promise<Signer>
  restore(): Promise<ConnectedSession | null>
  wakeWallet?(session: ConnectedSession): void
}

export type ConnectedSession = {
  connectorId: ConnectorId
  accounts: { address: string; name?: string; source: ConnectorId }[]
  meta: Record<string, unknown> // WalletConnect: topic, chainId, approvedChains, peer*; extension: source
}
```

`ConnectorId` is one of `enjin-wallet`, `walletconnect`, `polkadot-js`,
`talisman`, `subwallet-js` or `polkagate`. Display data (name, icon,
install link, description) lives in the registry, not on the connector.
The optional `wakeWallet` is implemented by the WalletConnect connectors
but not called anywhere; the sign-request modal's button opens the wallet
instead.

Components connect and disconnect through `useWalletActions()`, which
also updates the store. `useExtrinsic` and `useSignIn` ask the active
session's connector for a `Signer`. The connect modal calls each
connector's `detect()` to show which wallets are available.

## Registry

`CONNECTOR_REGISTRY` in `lib/wallet/connector-registry.ts`, in the order
the modal shows them:

| Id | Name | Transport | Shown as installed when | Install link |
|---|---|---|---|---|
| `enjin-wallet` | Enjin Wallet | WalletConnect | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set | <https://enjin.io/products/wallet> |
| `walletconnect` | WalletConnect | WalletConnect | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set | - |
| `polkadot-js` | Polkadot.js | `window.injectedWeb3["polkadot-js"]` | the extension has injected | <https://polkadot.js.org/extension/> |
| `talisman` | Talisman | `window.injectedWeb3["talisman"]` | the extension has injected | <https://talisman.xyz/download> |
| `subwallet-js` | SubWallet | `window.injectedWeb3["subwallet-js"]` | the extension has injected | <https://subwallet.app/download.html> |
| `polkagate` | PolkaGate | `window.injectedWeb3["polkagate"]` | the extension has injected | <https://polkagate.xyz/> |

The two WalletConnect entries are "featured" and appear above the
extensions. They share one `SignClient` and the same flow. They differ in:

- **QR logo** - the Enjin mark for Enjin Wallet, the WalletConnect logo for
  the generic entry.
- **Mobile button** - only Enjin Wallet offers "Open in Enjin Wallet" next
  to the QR. The generic entry offers "Download QR" instead.
- **Name in the sign-request modal** - see
  [Wallet name and icon](#wallet-name-and-icon).

## Connecting

### Browser extensions

```text
1. The modal runs detect(): it polls window.injectedWeb3[source] up to
   4 times, 150 ms apart, because some extensions inject late.
2. The user picks the extension. connect() (lib/wallet/connectors/extension.ts):
     const { web3Enable, web3Accounts } = await import("@polkadot/extension-dapp")
     const enabled = await web3Enable("Enjin Governance")   // the extension may prompt
     if (enabled.length === 0) throw new Error("No extension authorised the connection. …")
     const accounts = await web3Accounts({ extensions: [source] })
     if (accounts.length === 0) throw new Error("No accounts found in <id>. …")
3. With more than one account, the modal shows the account picker.
```

`disconnect()` only drops the local session. Extensions have no "forget
this site" API; the user revokes access in the extension.

### WalletConnect

```text
1. getSignClient() initialises the SignClient once per page with the
   project id, the relay URL and the app metadata (APP_NAME, APP_DESCRIPTION,
   NEXT_PUBLIC_APP_URL and its /favicon.svg).
2. connect() (lib/wallet/connectors/walletconnect.ts):
     signClient.connect({
       optionalNamespaces: {
         polkadot: {
           methods: ["polkadot_signTransaction", "polkadot_signMessage"],
           chains:  [<active chain's CAIP-2>],
           events:  ["chainChanged", "accountsChanged"],
         },
       },
     })
3. The pairing URI goes to the modal through onUri, which renders it as a
   QR code. On a phone, the Enjin Wallet entry also shows a button that
   opens enjinwallet://wc?uri=<encoded uri> (buildEnjinWalletDeepLink).
4. The user approves in the wallet. await approval() resolves with the session.
5. Accounts come from session.namespaces.polkadot.accounts
   ("polkadot:<genesis>:<address>"). Names come from sessionProperties,
   peer metadata or an extra segment of the account string, when the
   wallet provides one.
6. session.meta keeps the topic, the chain, the approved chains, and the
   peer's redirect link, name and icon.
7. With more than one account, the modal shows the account picker.
```

Details that matter:

- `optionalNamespaces` is used instead of `requiredNamespaces`, so a wallet
  doesn't refuse a session that doesn't match exactly.
- SDK init and `signClient.connect` each have a 15 s limit. On failure the
  connector deletes the SDK's `wc@2:*` keys from localStorage and drops the
  cached client, so the retry starts clean. This recovers from a stale
  store, which has been seen to stop iOS Safari from ever producing a URI.
  `approval()` has no limit: the user takes as long as they need.
- When the tab becomes visible again, the client pings every session. iOS
  Safari suspends the relay socket while the user is in the wallet, and the
  ping brings it back at once, so a finished signature arrives without a
  delay.

### Picking and switching accounts

When a wallet shares more than one account, the modal always asks which
one to use. It never picks the first one silently. The connected-wallet
view also lets the user switch accounts later.

A sign-in session belongs to one public key. When the user picks or
switches to an account with a different key, or disconnects, the app
signs out (`POST /api/auth/logout`). Otherwise `me` and the active address
would disagree.

## Session restore

- The store persists only `connectorId` and `activeAddress`, in
  localStorage under `enjin-governance:wallet`. The live session comes from
  the connector.
- `WalletRestoreMounter` initialises the crypto WASM and calls
  `restoreWallet()` once per page load. That calls the persisted
  connector's `restore()`.
- **WalletConnect** - the SDK keeps its sessions in its own `wc@2:` keys.
  `restore()` takes the most recent session from
  `signClient.session.getAll()`. It doesn't check the chain; `getSigner`
  does that before each signature.
- **Extension** - `restore()` checks the extension is present and calls
  `web3Enable` again. Extensions remember their approval per origin, so
  there is no prompt.
- When `restore()` returns `null` or throws, the store resets to
  disconnected. Otherwise the persisted active address is kept, or the
  first account is used when none was saved.

The user sees the connect modal again only after disconnecting, or when
the wallet no longer has the session.

## Signing transactions

`useExtrinsic` (`lib/query/hooks/use-tx.ts`) re-encodes the active address
for the active chain, asks the connector for a `Signer`, and signs with:

```ts
const signed = await tx.signAsync(signingAddress, { signer, era: MORTAL_ERA_BLOCKS }) // 256
```

It then broadcasts with `signed.send()`. The mortal era of 256 blocks
(about 25 minutes) matters for WalletConnect: Enjin Wallet refuses to sign
an immortal payload, and the default era can run out during a slow phone
round trip. The whole pipeline is described in
[`GOVERNANCE_FLOW.md`](GOVERNANCE_FLOW.md#writing-to-the-chain-useextrinsic).

### Extension signer

Extensions provide a ready-made `Signer`:

```ts
// lib/wallet/connectors/extension.ts
async getSigner(_session, address) {
  const { web3FromAddress } = await import("@polkadot/extension-dapp")
  const injected = await web3FromAddress(address)
  return injected.signer
}
```

### WalletConnect signer

WalletConnect has no signer object. `buildSigner(signClient, topic,
caipChainId)` wraps `signClient.request` in one:

```ts
// lib/wallet/connectors/walletconnect.ts
signPayload: async (payload) => {
  suppressInternalRedirect()
  const result = await signClient.request<{ signature: `0x${string}` }>({
    topic,
    chainId: caipChainId,
    request: {
      method: "polkadot_signTransaction",
      params: { address: payload.address, transactionPayload: toRequestPayload(payload) },
    },
  })
  return { id: ++id, signature: result.signature }
},
```

- **`toRequestPayload`** removes fields that `polkadot_signTransaction`
  doesn't define: `assetId` and `metadataHash` when they are `null`, and
  the api-internal `withSignedTransaction` flag. Enjin Wallet rejects the
  whole request as "Transaction invalid" when they are present. The signed
  bytes don't change, because the app signs with `mode` 0 and no fee asset.
- **`signRaw`** sends `polkadot_signMessage` with `{ address, message }`.
  polkadot-js passes the data as hex; the signer decodes it to the UTF-8
  string first. Otherwise the wallet signs the hex characters and sign-in
  fails with "Signature did not match the address".
- **Deep links** - both methods first remove `WALLETCONNECT_DEEPLINK_CHOICE`
  from localStorage, which turns off the SDK's own redirect to the wallet.
  That redirect runs too late for iOS Safari and was silently ignored. The
  sign-request modal's button is the only deep link.
- **`id`** is a client-side counter that `@polkadot/api` uses to match
  responses to requests.

Before building the signer, `getSigner` checks that the session approved
the active chain. If it didn't, it throws "Your wallet hasn't approved
<chain> in this session …" instead of sending a request the wallet would
ignore.

## Sign-request modal

`SignRequestModal` (`components/wallet/sign-request-modal.tsx`) is the one
status surface for every WalletConnect signature: votes and vote removals,
deposits and refunds, unlocks, delegation, treasury top-ups, proposal
batches and sign-in. The user is on their phone, so the browser tab shows
where things stand.

- `useSignFlow()` holds its open state and deep link. `open()` does nothing
  for extension sessions: the extension shows its own popup, and callers
  report progress with toasts.
- The title reads "Sign with <wallet>", using `walletDisplayFor`.
- It follows `useExtrinsic`'s status. While waiting for the signature it
  shows a spinner and, on a phone, an "Open in <wallet>" button. It then
  shows broadcast and in-block progress, and ends with a check mark and a
  "View on Subscan" link, or with the error and a Retry button.
- `successAt` sets when the check mark appears. The default, `finalized`,
  suits proposal submission, which waits for finality. Quick actions such
  as votes pass `in-block` and show a "Finalising on chain…" note until
  finality. An `in-block` modal closes itself after 2 s unless
  `autoDismiss` is false.
- The "Open in <wallet>" button is a plain link the user taps, because iOS
  Safari only follows a deep link from a live tap. Its URL comes from
  `buildSignRequestDeepLink`: the wallet's own redirect link from
  `peer.metadata.redirect.native` (or `enjinwallet://`), plus
  `/wc?sessionTopic=<topic>`. The request itself arrives over the relay.

## Signing in

Sign-in proves control of an address with a signed message. There is no
transaction and no fee. It runs through the same signer:

1. **Nonce.** Once a wallet is connected, `useNoncePrefetch`
   (`lib/query/hooks/use-session.ts`) requests a nonce with
   `POST /api/auth/nonce { address }`, using the address encoded for the
   active chain. It refreshes every 5 minutes and when the tab regains
   focus. The server stores the nonce and the exact message in
   `auth_nonces` for 30 minutes. Fetching it in advance keeps network
   waits out of the path from the tap to the signature.
2. **Signature.** `useSignIn` calls
   `signer.signRaw({ address, data: stringToHex(message), type: "bytes" })`.
   The message says it does not authorise any on-chain transaction.
3. **Verify.** `POST /api/auth/verify { address, nonce, signature }`. The
   server consumes the nonce in one step, checks the signature against the
   stored message (`verifySignature` in `lib/auth/siwe.ts` accepts the
   `<Bytes>`-wrapped, plain and hex forms), and sets the httpOnly cookie
   `enjin-governance:session` for 30 days.

Writes that need a session (staging a draft, uploading media, linking a
proposal, draft actions) call `ensureSignedIn()` from `useEnsureSignedIn`
first. It re-checks `/api/auth/me` before asking for a signature, opens
the sign-request modal for WalletConnect wallets, and returns `false` when
the user declines. After a 401 from the server, callers pass
`{ fresh: true }` to skip the cached answer. The server side is described
in [`ARCHITECTURE.md`](ARCHITECTURE.md#data-flow-signing-in-siwe-style).

## Networks and addresses

### One network per session

The WalletConnect connector requests only the active chain's CAIP-2 at
connect time. Switching networks with a wallet connected goes through the
network switcher's confirm dialog, which signs out and disconnects, so the
user pairs again on the new chain. This keeps the account list free of
duplicate `en…` and `cn…` entries for the same key, and keeps each
network's handles separate.

A proposal link with `?network=` switches the chain without that dialog.
For a WalletConnect session, `getSigner`'s approved-chain check then
refuses to sign until the wallet is paired on that chain.

### CAIP-2 chain ids

WalletConnect identifies Polkadot SDK chains as
`polkadot:<first 32 hex characters of the genesis hash>`. The values are
the `caip2` field in `lib/chain/chains.ts`:

| Network | CAIP-2 |
|---|---|
| Enjin Relaychain | `polkadot:d8761d3c88f26dc12875c00d3165f7d6` |
| Canary Relaychain | `polkadot:735d8773c63e74ff8490fee5751ac07e` |

### Address encoding

Wallets can return an address in any SS58 format. The app re-encodes it
for the active chain with `encodeForChain(address, chainId)`
(`lib/chain/ss58.ts`): for display (`useDisplayAddress`), for signing and
for sign-in. Addresses are compared by public key with `samePublicKey`,
never as strings. Don't display raw `session.namespaces.polkadot.accounts`
entries.

### Wallet name and icon

`walletDisplayFor(session)` returns the wallet name and icon for the
sign-request modal. Dedicated connectors (Enjin Wallet, Polkadot.js, ...)
use the bundled brand. Only the generic `walletconnect` connector uses the
paired wallet's `peer.metadata.name` and first icon, so a Nova pairing
reads "Sign with Nova Wallet". An Enjin Wallet pairing stays Enjin-branded
whatever its peer metadata says; it has advertised an Ethereum icon.

## Setup

1. Create a project at <https://cloud.reown.com> (formerly WalletConnect
   Cloud). It is free.
2. Add the project id to `.env.local`:
   ```env
   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="32-char-hex"
   ```
   `NEXT_PUBLIC_WALLETCONNECT_RELAY_URL` is optional and defaults to
   `wss://relay.walletconnect.com`. `NEXT_PUBLIC_APP_URL` is sent to the
   wallet as the app's URL and icon location.
3. In production, add your domain under **Allowed Domains** in the Reown
   dashboard.

Without a project id, extension wallets still work, and both WalletConnect
entries show as not installed. See [`ENVIRONMENT.md`](ENVIRONMENT.md) and
[`DEPLOYMENT.md`](DEPLOYMENT.md).

## Troubleshooting

- **"WalletConnect is not configured"** - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
  is not set. Set it and restart or redeploy.
- **"Couldn't reach WalletConnect" or "Couldn't start the WalletConnect
  session"** - the relay didn't answer within 15 s, or the stored WC state
  was stale. The app has already cleared that state, so retrying starts
  fresh. If it keeps failing, check the project id and the Allowed Domains
  list; the browser console shows the relay's error.
- **The QR scans but the wallet reports an unsupported method** - the
  wallet doesn't support `polkadot_signTransaction` or
  `polkadot_signMessage`. Use Enjin Wallet or another WalletConnect
  Polkadot wallet.
- **"Your wallet hasn't approved <chain> in this session"** - the session
  was paired on another network. Disconnect and connect again.
- **The sign prompt never appears on the phone** - tap "Open in <wallet>"
  in the sign-request modal. If nothing arrives, the session topic is
  probably stale: disconnect Enjin Governance in the wallet and in the
  app, then connect again.
- **"Signature did not match the address" at sign-in** - the wallet signed
  different bytes than the server issued. The server logs a
  `[auth/verify]` warning with the message hash and lengths to compare.
- **"Nonce is unknown or expired"** - the nonce is single-use and valid for
  30 minutes. Sign in again.
- **An extension shows as not installed, or clicking it does nothing** -
  it injected after detection gave up (4 tries, 150 ms apart). Reload the
  page; some extensions only inject on a full load.
- **"No extension authorised the connection"** - the extension's approval
  prompt was dismissed or didn't show. Reload and approve.
- **"No accounts found in <wallet>"** - the extension has no Polkadot
  account yet. Create or import one and connect again.
- **"Lost contact with the chain after broadcasting your transaction"** -
  no block notification arrived within 90 s. The transaction may have
  gone through; check the explorer before retrying.

## See also

- [`GOVERNANCE_FLOW.md`](GOVERNANCE_FLOW.md) - what the app signs
- [`CHAIN_FLOW.md`](CHAIN_FLOW.md) - RPC connection and chain config
- [`ARCHITECTURE.md`](ARCHITECTURE.md) - layers and the sign-in data flow
