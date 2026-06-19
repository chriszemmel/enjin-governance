# Wallet integration

Two signing paths, behind one `Connector` interface:

- **WalletConnect v2** - Enjin Wallet (mobile-first) and any WC-compatible
  Polkadot wallet (Nova, Talisman mobile, …). Desktop = QR, mobile = deep link.
- **Browser extension** - Polkadot.js, Talisman, SubWallet, PolkaGate. All four
  inject through the same `@polkadot/extension-dapp` interface, so one
  connector handles all of them - only the detection logic and install URLs
  differ per extension.

A single modal lists all supported wallets and shows
install / not-installed / connected state per row, so the user can see
what's available and what they'd need to install.

## Connector interface

```ts
// lib/wallet/connectors/types.ts
export interface Connector {
  id: ConnectorId                                    // "walletconnect" | "polkadot-js" | ...
  name: string                                       // "Enjin Wallet" | "Polkadot.js" | ...
  icon: string                                       // path under public/brand/wallets/
  installUrl: string                                 // store / extension URL
  detect: () => Promise<"installed" | "not-installed" | "n/a">
  connect: () => Promise<ConnectedSession>
  disconnect: (session: ConnectedSession) => Promise<void>
  getSigner: (session: ConnectedSession, address: string) => Promise<Signer>
}
```

The wallet modal renders the registry and routes the user's choice to
`connector.connect()`. The `useExtrinsic` hook is connector-agnostic - it
calls `activeConnector.getSigner(session, address)` and passes the result to
`tx.signAndSend(address, { signer }, cb)`.

## Registry (`lib/wallet/connector-registry.ts`)

| Connector | Channel | Detection | Install URL |
|---|---|---|---|
| `walletconnect` | WC v2 | always installed (just opens QR / deep link) | - |
| `polkadot-js` | `window.injectedWeb3["polkadot-js"]` | check global | https://polkadot.js.org/extension/ |
| `talisman` | `window.injectedWeb3["talisman"]` | check global | https://talisman.xyz/download |
| `subwallet-js` | `window.injectedWeb3["subwallet-js"]` | check global | https://subwallet.app/download.html |
| `polkagate` | `window.injectedWeb3["polkagate"]` | check global | https://polkagate.xyz/ |

WalletConnect is always present; the modal labels it as "WalletConnect" with
a sub-label for Enjin Wallet specifically (the default partner) and includes
a separate "Enjin Wallet" pseudo-entry that opens the same WC flow but with
metadata pre-targeting Enjin's app.

## Browser extension flow

```
1. User clicks "Polkadot.js" → modal calls connector.connect()
2. lib/wallet/connectors/extension.ts:
     const { web3Enable, web3Accounts, web3FromSource } =
       await import("@polkadot/extension-dapp")
     const extensions = await web3Enable("Enjin Governance")
     if (extensions.length === 0) throw new Error("no extension authorised the connection")
     const accounts = await web3Accounts()
     // Filter to the chosen extension by source: accounts.filter(a => a.meta.source === "polkadot-js")
3. Modal shows account picker if more than one
4. On vote/submit:
     const { signer } = await web3FromSource("polkadot-js")
     tx.signAndSend(address, { signer }, cb)
```

`@polkadot/extension-dapp` is a thin wrapper around `window.injectedWeb3`.
The same code works for Talisman (`web3FromSource("talisman")`),
SubWallet (`"subwallet-js"`), and PolkaGate (`"polkagate"`).

## WalletConnect flow: desktop QR

```
1. User clicks "Enjin Wallet" or "WalletConnect" → wallet-modal.tsx opens
2. lib/wallet/connectors/walletconnect.ts calls signClient.connect({
     optionalNamespaces: {
       polkadot: { methods: ["polkadot_signTransaction", "polkadot_signMessage"],
                   chains:  [<enjin-relay CAIP-2>],
                   events:  ["chainChanged", "accountsChanged"] }
     }
   })
3. WC returns { uri, approval }
4. We render the URI as a QR code
5. User scans with Enjin Wallet → approves
6. await approval() resolves with the session
7. We extract accounts from session.namespaces.polkadot.accounts
   (each is "polkadot:<chain>:<ss58>")
8. Session topic + accounts saved to lib/wallet/store.ts + localStorage
```

## WalletConnect flow: mobile deep link

Same as desktop, except step 4 is:

```
4. We detect mobile (User-Agent match) and instead of QR, render a button
   that opens enjinwallet://wc?uri=<encoded uri>
   The user is dropped into Enjin Wallet, approves, and is returned to
   the browser by the OS scheme handler.
```

## Setup

1. Create a project at <https://cloud.reown.com> (formerly WalletConnect Cloud - free).
2. Add the project ID to `.env.local`:
   ```env
   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID="32-char-hex"
   ```
3. (Production only) Whitelist your domain in the Reown dashboard so the
   project metadata loads.

## Session restore

On every page load:

- **WalletConnect**: `lib/wallet/connectors/walletconnect.ts` checks
  `signClient.session.getAll()`. If a session exists with a matching chain,
  we hydrate the store. `session_update` refreshes accounts;
  `session_delete` clears it.
- **Extension**: `lib/wallet/connectors/extension.ts` re-calls `web3Enable`
  on load. Extensions remember authorizations per-origin, so this resolves
  without a prompt if the user previously approved.
- The active connector ID is persisted to `localStorage` so we know which
  connector to restore from.

A user only sees the connect modal on first visit.

## Signer adapters

`@polkadot/api`'s `signAndSend(address, { signer }, cb)` expects a `Signer`
object implementing `signPayload(payload: SignerPayloadJSON)`. Each
connector exposes a `getSigner(session, address)` that returns one.

**Extension** wallets ship a ready-made signer via `web3FromSource`:

```ts
// lib/wallet/connectors/extension.ts
async getSigner(_session, address) {
  const { web3FromAddress } = await import("@polkadot/extension-dapp")
  const injected = await web3FromAddress(address)
  return injected.signer
}
```

**WalletConnect** has no native signer object - we wrap `signClient.request`
in our own adapter:

```ts
// lib/wallet/connectors/walletconnect.ts
function buildSigner(signClient, topic, caipChainId): Signer {
  let id = 0
  return {
    signPayload: async (payload) => {
      const result = await signClient.request<{ signature: HexString }>({
        topic,
        chainId,
        request: {
          method: "polkadot_signTransaction",
          params: { address: payload.address, transactionPayload: payload },
        },
      })
      return { id: ++id, signature: result.signature }
    },
  }
}
```

`id` is a client-side counter, used by `@polkadot/api` to match the response
to the request when there are multiple in flight.

## Chain ID format (CAIP-2)

WalletConnect identifies Polkadot-SDK chains by
`polkadot:<first-32-hex-chars-of-genesis-hash>`. For Enjin Relay:

```
genesis hash: 0xd8761d3c88f26dc12875c00d3165f7d6...
CAIP-2:       polkadot:d8761d3c88f26dc12875c00d3165f7d6
```

Constants live in `lib/chain/chains.ts`.

## What we DO use

- `optionalNamespaces` over `requiredNamespaces` - wallet won't refuse a
  connection if it doesn't perfectly match.
- `polkadot_signTransaction` for extrinsics.
- `polkadot_signMessage` reserved for off-chain signing (e.g. proving
  ownership of an address to the metadata API). Currently unused.

## What we do NOT use

- `polkadot_signSpecVersion` - not standardized; Enjin Wallet handles this internally.
- Multi-chain sessions across chains we don't currently support. The
  connect call only advertises Enjin Relay (and Canary Relay if the user's
  on a Canary build).

## Troubleshooting

- **"Project not found"** (WalletConnect) - your
  `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is missing or wrong. Check
  `.env.local`. The browser console will show a more specific error.
- **QR scans but wallet shows "unsupported method"** - your wallet doesn't
  support `polkadot_signTransaction`. Use Enjin Wallet (or any WC-Polkadot
  wallet).
- **Connection succeeds but signing pop-up never appears** - usually a
  stale session topic. Open the wallet, manually disconnect Enjin Governance,
  retry from the browser.
- **Extension click does nothing** - the extension is installed but didn't
  inject into `window.injectedWeb3` before we checked. `lib/wallet/connectors/extension.ts`
  retries detection on a short interval before giving up; if it still fails,
  reload the page (some extensions only inject on full page load).
- **"No accounts" after extension connect** - the user hasn't created or
  imported any Polkadot-format account in their extension yet. Tell them to
  do that and reconnect.
- **Address mismatch (chain prefix wrong)** - `lib/chain/ss58.ts`
  `encodeForChain(address, chainId)` re-encodes. Don't display raw
  `session.namespaces.polkadot.accounts` entries directly.

## One network per session

The WC connector requests only the active chain's CAIP-2 at connect
time - not the full enabled-chains list. Switching networks goes
through the network switcher's confirm modal which disconnects the
wallet + signs out, so the user re-pairs against the new chain. This
keeps the accounts list clean (no doubled-up en…/cn… entries for the
same key) and keeps the per-network handle namespace honest.

`walletDisplayFor(session)` (in `connector-registry.ts`) resolves the
user-facing wallet name + icon for the sign-request modal. Dedicated
connectors (Enjin Wallet, Polkadot.js, …) trust the bundled brand;
only the generic `walletconnect` connector falls back to
`peer.metadata.name` / `.icons[0]` from the paired wallet, so a Nova
pairing reads as "Sign with Nova Wallet" with Nova's icon while an
Enjin Wallet pairing stays Enjin-branded regardless of what peer
metadata the wallet advertises (it sometimes ships an Ethereum
diamond by default).

Switching the active address calls `signOut` first: the SIWE session
is bound to a specific address, so a silent switch would desync `me`
from `wallet.activeAddress`. Disconnect does the same.

## See also

- [`GOVERNANCE_FLOW.md`](GOVERNANCE_FLOW.md) - what we sign
- [`CHAIN_FLOW.md`](CHAIN_FLOW.md) - chain ID and CAIP-2
