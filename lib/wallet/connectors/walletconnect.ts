"use client"

import type { Signer, SignerResult } from "@polkadot/api/types"
import type { SignerPayloadJSON, SignerPayloadRaw } from "@polkadot/types/types"
import { hexToU8a, u8aToString } from "@polkadot/util"
import { env } from "@/lib/env"
import { getChain } from "@/lib/chain/chains"
import { getActiveChain } from "@/lib/chain/use-chain"
import { APP_DESCRIPTION, APP_NAME } from "@/lib/config"
import type {
  ConnectOptions,
  ConnectedSession,
  Connector,
  ConnectorId,
  DetectionState,
  WalletAccount,
} from "./types"

type SignClientType = Awaited<ReturnType<typeof importAndInit>>

let signClientPromise: Promise<SignClientType> | null = null

/**
 * The last reason the relay gave for closing the socket. When Reown refuses
 * a connection it closes with code 3000 and a reason like "Unauthorized:
 * origin not allowed"; the SDK keeps retrying and `connect` just times out,
 * so we hold on to the reason and report it instead of the timeout.
 */
let lastRelayError: string | null = null

async function importAndInit() {
  if (!env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID) {
    throw new Error(
      "WalletConnect is not configured. Set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID " +
        "(get one free at https://cloud.reown.com). " +
        "Browser-extension wallets still work without it.",
    )
  }
  const { SignClient } = await import("@walletconnect/sign-client")
  // The page's own origin, not NEXT_PUBLIC_APP_URL: wallets compare the
  // metadata URL with the origin Reown verifies, so a preview deployment
  // has to announce its own domain.
  const origin = typeof window === "undefined" ? env.NEXT_PUBLIC_APP_URL : window.location.origin
  const client = await SignClient.init({
    projectId: env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    relayUrl: env.NEXT_PUBLIC_WALLETCONNECT_RELAY_URL,
    metadata: {
      name: APP_NAME,
      description: APP_DESCRIPTION,
      url: origin,
      icons: [`${origin}/favicon.svg`],
    },
  })

  client.core.relayer.on("relayer_error", (err: unknown) => {
    lastRelayError = err instanceof Error ? err.message : String(err)
  })

  // Kick the relay socket awake the moment the dapp tab regains
  // visibility. iOS Safari aggressively suspends background JS - when
  // the user goes over to the wallet to sign, our WC WebSocket
  // disconnects. The SDK reconnects on its own, but the post-suspend
  // resync often takes 5-10 s before any pending response from the
  // relay (i.e. the wallet's signature) is actually delivered to the
  // dapp side. That's the long "nothing happens after I sign" gap.
  // Pinging every active session topic on visibilitychange forces the
  // transport to come up immediately so buffered responses land
  // straight away.
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return
      try {
        for (const session of client.session.getAll()) {
          client.ping({ topic: session.topic }).catch(() => {
            /* relay down - SDK will reconnect on its own */
          })
        }
      } catch {
        /* defensive - session store may not be ready yet */
      }
    })
  }

  return client
}

async function getSignClient(): Promise<SignClientType> {
  if (typeof window === "undefined") {
    throw new Error("WalletConnect can only be used in the browser")
  }
  if (!signClientPromise) signClientPromise = importAndInit()
  return signClientPromise
}

/**
 * Race a promise against a timeout. Used to bound the URI-generation phase
 * of connect (client init + `signClient.connect`) so a stalled relay
 * surfaces as a clear error the user can retry - instead of the modal
 * sitting on a spinner forever. The user-paced `approval()` is never
 * wrapped: scanning + approving legitimately takes as long as it takes.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ])
}

/**
 * Clear WalletConnect's persisted state and drop the cached client.
 * The SDK keeps pairings, sessions, message history, and the relay
 * subscription in localStorage; when that store goes stale or corrupt
 * (observed on iOS Safari, where it can wedge `init`/`connect` so no
 * URI is ever produced) the only reliable recovery is to wipe it and
 * re-init fresh. We only call this after a connect *fails* - never on
 * the happy path or on a user-cancelled approval - so a one-off retry
 * starts from a clean slate.
 */
function resetSignClient(): void {
  signClientPromise = null
  lastRelayError = null
  if (typeof window === "undefined") return
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && (key.startsWith("wc@2:") || key === "WALLETCONNECT_DEEPLINK_CHOICE")) {
        keys.push(key)
      }
    }
    for (const key of keys) window.localStorage.removeItem(key)
  } catch {
    /* private mode etc. - non-fatal */
  }
}

/**
 * Turn the relay's close reason into something an admin can act on. The
 * project id is public (it ships in the bundle), so naming its last
 * characters is fine and tells them which Reown project the build uses.
 */
export function describeRelayRefusal(
  reason: string,
  origin: string,
  projectId: string | undefined,
): string {
  const project = projectId ? `project …${projectId.slice(-6)}` : "the project"
  if (/origin/i.test(reason)) {
    return (
      `WalletConnect refused this site (${origin}). ` +
      `Add it to the allowed domains of Reown ${project}.`
    )
  }
  if (/key|project/i.test(reason)) {
    return (
      `WalletConnect rejected ${project}. Check NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ` +
      "for this deployment and redeploy."
    )
  }
  return `WalletConnect closed the connection: ${reason}`
}

function relayRefusal(): Error | null {
  if (!lastRelayError || typeof window === "undefined") return null
  return new Error(
    describeRelayRefusal(
      lastRelayError,
      window.location.origin,
      env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    ),
  )
}

/**
 * Parse a CAIP-10 account string, recovering a name when the wallet
 * extends the format with one (some wallets append `?name=foo` or use
 * an extra colon-segment past the address).
 */
function parseCaipAccount(caip: string, source: ConnectorId) {
  // `polkadot:<genesis>:<address>` - standard
  // Some wallets append metadata after the address, e.g.
  // `polkadot:<genesis>:<address>?name=Main` or
  // `polkadot:<genesis>:<address>:Main`. We try both.
  const [withoutQuery, queryPart] = caip.split("?", 2) as [string, string?]
  const parts = withoutQuery.split(":")
  const address = parts[2] ?? parts[parts.length - 1] ?? ""
  let name: string | undefined
  if (queryPart) {
    const params = new URLSearchParams(queryPart)
    name = params.get("name") ?? params.get("label") ?? undefined
  }
  // 4th colon-segment as a label (Enjin Wallet uses this convention)
  if (!name && parts.length > 3) {
    const candidate = parts.slice(3).join(":").trim()
    if (candidate) name = candidate
  }
  return { address, name, source }
}

/**
 * Some wallets (Enjin included) put per-account display names in
 * `sessionProperties` keyed by address. Standard pattern:
 *   sessionProperties: { "accountName:<address>": "Main" }
 * or:
 *   sessionProperties: { accountNames: '{"<address>": "Main"}' }
 * We accept both shapes.
 */
function namesFromSessionProperties(
  props: Record<string, string> | undefined,
): Map<string, string> {
  const out = new Map<string, string>()
  if (!props) return out

  for (const [key, value] of Object.entries(props)) {
    if (typeof value !== "string") continue
    const prefixed = key.match(/^(?:accountName|account_name|name):(.+)$/i)
    if (prefixed && prefixed[1]) {
      out.set(prefixed[1], value)
      continue
    }
    if (/^(account_?names?|account_meta)$/i.test(key)) {
      try {
        const parsed = JSON.parse(value)
        if (parsed && typeof parsed === "object") {
          for (const [addr, n] of Object.entries(parsed)) {
            if (typeof n === "string") out.set(addr, n)
            else if (n && typeof n === "object" && "name" in n) {
              const inner = (n as { name?: unknown }).name
              if (typeof inner === "string") out.set(addr, inner)
            }
          }
        }
      } catch {
        // not JSON, ignore
      }
    }
  }
  return out
}

/**
 * Take everything we know about an opened/restored session and build
 * the `WalletAccount[]` the rest of the app consumes. Combines
 * names from the CAIP string with names from sessionProperties; when
 * both are present, sessionProperties wins (more specific).
 */
function accountsFromSession(
  session: {
    namespaces: Record<string, { accounts?: string[] }>
    sessionProperties?: Record<string, string>
    peer?: { metadata?: unknown }
  },
  source: ConnectorId,
): WalletAccount[] {
  const ns = session.namespaces.polkadot
  const caipAccounts = ns?.accounts ?? []
  const propNames = namesFromSessionProperties(session.sessionProperties)
  const peerNames = namesFromPeerMetadata(
    session.peer?.metadata as Record<string, unknown> | undefined,
  )
  const out: WalletAccount[] = caipAccounts.map((caip) => {
    const parsed = parseCaipAccount(caip, source)
    return {
      address: parsed.address,
      name: propNames.get(parsed.address) ?? peerNames.get(parsed.address) ?? parsed.name,
      source,
    }
  })

  return out
}

/**
 * peer.metadata is the wallet's app metadata (name, icons, url). Some
 * wallets embed account name hints in custom fields. We look for the
 * common shapes; nothing standardised here.
 */
function namesFromPeerMetadata(
  meta: Record<string, unknown> | undefined,
): Map<string, string> {
  const out = new Map<string, string>()
  if (!meta) return out
  // Custom field: `accounts: [{ address, name }]`
  const accountsField = meta.accounts
  if (Array.isArray(accountsField)) {
    for (const a of accountsField) {
      if (
        a &&
        typeof a === "object" &&
        typeof (a as { address?: unknown }).address === "string" &&
        typeof (a as { name?: unknown }).name === "string"
      ) {
        out.set(
          (a as { address: string }).address,
          (a as { name: string }).name,
        )
      }
    }
  }
  return out
}

/**
 * Pull the list of CAIP-2 chain ids the wallet actually approved in this
 * session. The polkadot namespace can declare `chains: [...]` directly
 * and/or imply chains via the `accounts: ["polkadot:<genesis>:<addr>"]`
 * list - we union both so a wallet that only populates one still works.
 */
function approvedChainsFromSession(session: {
  namespaces?: Record<string, { chains?: string[]; accounts?: string[] }>
}): string[] {
  const ns = session.namespaces?.polkadot
  if (!ns) return []
  const out = new Set<string>()
  for (const c of ns.chains ?? []) out.add(c)
  for (const a of ns.accounts ?? []) {
    const parts = a.split(":")
    if (parts.length >= 2) out.add(`${parts[0]}:${parts[1]}`)
  }
  return Array.from(out)
}

/**
 * Pull the wallet-declared native deep link from `peer.metadata.redirect`,
 * which WC v2 wallets set so dapps can bring them to the foreground after
 * a request. Falls back to null if the wallet didn't provide one; the
 * caller can then default to `enjinwallet://`.
 */
function nativeRedirectFromPeer(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null
  const m = meta as Record<string, unknown>
  const redirect = m.redirect as Record<string, unknown> | undefined
  if (!redirect) return null
  const native = redirect.native
  if (typeof native === "string" && native.length > 0) return native
  return null
}

/**
 * Pull the wallet's self-reported display name + icon from
 * `peer.metadata`. WC v2 wallets advertise these so the dapp can show
 * "Sign with Nova Wallet" instead of generic "Sign with WalletConnect"
 * when the user paired through the generic WC connector. Both fields
 * are wallet-supplied strings - display-only, never used as identity.
 */
function peerDisplayFromMeta(meta: unknown): {
  name: string | null
  icon: string | null
} {
  if (!meta || typeof meta !== "object") return { name: null, icon: null }
  const m = meta as Record<string, unknown>
  const name = typeof m.name === "string" && m.name.length > 0 ? m.name : null
  const icons = m.icons
  const icon =
    Array.isArray(icons) && typeof icons[0] === "string" && icons[0].length > 0
      ? (icons[0] as string)
      : null
  return { name, icon }
}

function chainNameForCaip(caip: string): string | null {
  // Lazy lookup so this stays a pure helper without importing the whole
  // CHAINS table eagerly at module top level.
  try {
    for (const id of ["enjin-relay", "enjin-matrix", "canary-relay", "canary-matrix"] as const) {
      const c = getChain(id)
      if (c.caip2 === caip) return c.name
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * Trim `SignerPayloadJSON` down to the fields `polkadot_signTransaction`
 * actually defines.
 *
 * @polkadot/api serialises three extras that aren't part of that request
 * shape: `assetId` and `metadataHash` arrive as explicit `null` when unused,
 * and `withSignedTransaction` is an api-internal flag describing the signer's
 * *return* shape, not signing input. The polkadot-js extension ignores them,
 * but Enjin Wallet rejects the whole request with "Transaction invalid"
 * before the user can confirm - which is why the identical extrinsic signs
 * fine via the extension and lands on chain.
 *
 * Dropping them does not change the signed bytes for this app: `mode` (0) is
 * preserved, and `metadataHash` / `assetId` only carry data when mode is 1 or
 * a fee asset is set, neither of which we use.
 */
export function toRequestPayload(
  payload: SignerPayloadJSON,
): Record<string, unknown> {
  const entries = Object.entries(payload).filter(
    ([key, value]) => value !== null && key !== "withSignedTransaction",
  )
  return Object.fromEntries(entries)
}

function buildSigner(
  signClient: SignClientType,
  topic: string,
  caipChainId: string,
): Signer {
  let id = 0

  // signClient.request() internally fires its own deep-link redirect
  // (handleDeeplinkRedirect from @walletconnect/utils) via
  // window.open(enjinwallet://wc?requestId=…&sessionTopic=…). That
  // call lives several microtasks + a localStorage read past the
  // originating click, and on iOS Safari the user-gesture token is
  // typically dead by then - the navigation is silently ignored, the
  // wallet never opens, the request hangs at the relay, and the
  // wallet eventually returns code 5000.
  //
  // The reliable path is the pair flow's mechanism: a deep link the user
  // taps. SignRequestModal renders an "Open in <wallet>" `<a>` built by
  // buildSignRequestDeepLink (via useSignFlow) while the request is
  // pending. Wipe WALLETCONNECT_DEEPLINK_CHOICE here so the library's
  // redirect short-circuits at `if (!wcDeepLink) return` - the modal's
  // link is the single authoritative deep link.
  const suppressInternalRedirect = (): void => {
    if (typeof window === "undefined") return
    try {
      window.localStorage.removeItem("WALLETCONNECT_DEEPLINK_CHOICE")
    } catch {
      /* private mode etc. - non-fatal */
    }
  }

  return {
    signPayload: async (payload: SignerPayloadJSON): Promise<SignerResult> => {
      suppressInternalRedirect()
      const result = await signClient.request<{ signature: `0x${string}` }>({
        topic,
        chainId: caipChainId,
        request: {
          method: "polkadot_signTransaction",
          params: {
            address: payload.address,
            transactionPayload: toRequestPayload(payload),
          },
        },
      })
      return { id: ++id, signature: result.signature }
    },
    signRaw: async (raw: SignerPayloadRaw): Promise<SignerResult> => {
      // The polkadot-js Signer interface passes `data` as 0x-prefixed
      // hex. WC v2's `polkadot_signMessage` expects `message` as the
      // plain UTF-8 string; Enjin Wallet (and Talisman/SubWallet) wrap
      // that string in `<Bytes>…</Bytes>` and sign the result. Passing
      // hex through would make the wallet sign the literal hex
      // characters, and our server's verifySignature (which wraps the
      // original UTF-8 message) would never match - surfacing as the
      // misleading "Signature did not match the address" sign-in error.
      const message =
        typeof raw.data === "string" && raw.data.startsWith("0x")
          ? u8aToString(hexToU8a(raw.data))
          : raw.data
      suppressInternalRedirect()
      const result = await signClient.request<{ signature: `0x${string}` }>({
        topic,
        chainId: caipChainId,
        request: {
          method: "polkadot_signMessage",
          params: { address: raw.address, message },
        },
      })
      return { id: ++id, signature: result.signature }
    },
  }
}

function createWalletConnectConnector(id: ConnectorId): Connector {
  return {
    id,
    async detect(): Promise<DetectionState> {
      // WalletConnect itself is a protocol, not installed software - but
      // we need the project ID to be configured for connections to work.
      // Surface that as "not-installed" so the modal greys it out with
      // an install link (pointing to the docs for setting the env var).
      return env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ? "installed" : "not-installed"
    },

    async connect(options?: ConnectOptions): Promise<ConnectedSession> {
      const chain = getActiveChain()

      // Bound only the URI-generation phase (client init +
      // signClient.connect). If no `uri` is produced quickly the relay
      // is unreachable or - on iOS Safari especially - the persisted WC
      // store has gone stale and wedged the SDK. Either way, fail loudly
      // and wipe the WC state so the user's retry starts clean, rather
      // than hanging forever on the connecting spinner. The user-paced
      // `approval()` below is intentionally never bounded or reset.
      //
      // Request ONLY the active chain. Networks are isolated per
      // session - switching chains (Relay ↔ Canary) goes through the
      // network switcher's confirm-and-disconnect modal and re-pairs the
      // wallet against the new chain. Requesting both up-front would let
      // the same key surface twice (en…/cn…) and cross the per-network
      // handle namespace.
      const { uri, approval } = await (async () => {
        lastRelayError = null
        try {
          const signClient = await withTimeout(
            getSignClient(),
            15_000,
            "Couldn't reach WalletConnect. Check your connection and try again.",
          )
          return await withTimeout(
            signClient.connect({
              optionalNamespaces: {
                polkadot: {
                  methods: ["polkadot_signTransaction", "polkadot_signMessage"],
                  chains: [chain.caip2],
                  events: ["chainChanged", "accountsChanged"],
                },
              },
            }),
            15_000,
            "Couldn't start the WalletConnect session. Please try again.",
          )
        } catch (err) {
          const refused = relayRefusal()
          resetSignClient()
          throw refused ?? err
        }
      })()

      if (uri) options?.onUri?.(uri)

      const session = await approval()
      const accounts = accountsFromSession(session, id)

      const peerDisplay = peerDisplayFromMeta(session.peer?.metadata)
      return {
        connectorId: id,
        accounts,
        meta: {
          topic: session.topic,
          chainId: chain.caip2,
          approvedChains: approvedChainsFromSession(session),
          peerRedirect: nativeRedirectFromPeer(session.peer?.metadata),
          peerName: peerDisplay.name,
          peerIcon: peerDisplay.icon,
        },
      }
    },

    async disconnect(session: ConnectedSession): Promise<void> {
      const topic = session.meta.topic as string | undefined
      if (!topic) return
      const signClient = await getSignClient()
      try {
        await signClient.disconnect({
          topic,
          reason: { code: 6000, message: "User disconnected" },
        })
      } catch {
        // Session may already be gone - non-fatal.
      }
    },

    async getSigner(session: ConnectedSession): Promise<Signer> {
      const topic = session.meta.topic as string
      const signClient = await getSignClient()

      // The chain to sign FOR is whichever one the app is currently
      // showing the user - not the one that happened to be active at
      // connect time. The wallet must have approved it; otherwise the
      // request hangs silently. We check the session's namespaces and
      // throw a clear error before sending the request if not.
      const active = getActiveChain()
      const approved = approvedChainsFromSession(
        signClient.session.get(topic) ?? { namespaces: {} },
      )
      if (approved.length > 0 && !approved.includes(active.caip2)) {
        const approvedNames = approved
          .map((caip) => {
            try {
              return chainNameForCaip(caip) ?? caip
            } catch {
              return caip
            }
          })
          .join(", ")
        throw new Error(
          `Your wallet hasn't approved ${active.name} in this session. ` +
            `Approved: ${approvedNames}. ` +
            `Disconnect and reconnect to approve ${active.name}.`,
        )
      }

      return buildSigner(signClient, topic, active.caip2)
    },

    async restore(): Promise<ConnectedSession | null> {
      if (typeof window === "undefined") return null
      try {
        const signClient = await getSignClient()
        const sessions = signClient.session.getAll()
        if (sessions.length === 0) return null
        const last = sessions[sessions.length - 1]!
        const accounts = accountsFromSession(last, id)
        const chain = getActiveChain()
        const peerDisplay = peerDisplayFromMeta(last.peer?.metadata)
        return {
          connectorId: id,
          accounts,
          meta: {
            topic: last.topic,
            chainId: chain.caip2,
            approvedChains: approvedChainsFromSession(last),
            peerRedirect: nativeRedirectFromPeer(last.peer?.metadata),
            peerName: peerDisplay.name,
            peerIcon: peerDisplay.icon,
          },
        }
      } catch {
        return null
      }
    },
  }
}

export const enjinWalletConnector = createWalletConnectConnector("enjin-wallet")
export const walletConnectConnector = createWalletConnectConnector("walletconnect")
