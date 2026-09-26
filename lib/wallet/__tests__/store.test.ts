import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto"
import type { ConnectedSession, ConnectorId } from "@/lib/wallet/connectors/types"

/**
 * The wallet store persists `connectorId` + `activeAddress` and re-reads the
 * live session on boot. The persisted account can be gone by then (removed
 * from the extension, a different WalletConnect session), so the store must
 * fall back to the restored session's first account instead of keeping an
 * address it can no longer sign for - and report the switch so the sign-in
 * session can be handled like an account switch.
 */

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"
const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty"
const CHARLIE = "5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y"
/** Bob's key in Enjin mainnet's SS58 encoding (`en…`). */
const BOB_ENJIN = encodeAddress(decodeAddress(BOB), 2135)

const PERSIST_KEY = "enjin-governance:wallet"

const restore = vi.fn<() => Promise<ConnectedSession | null>>()

vi.mock("@/lib/wallet/connector-registry", () => ({
  getConnectorMeta: () => ({ connector: { restore } }),
}))

function session(addresses: string[], connectorId: ConnectorId = "polkadot-js"): ConnectedSession {
  return {
    connectorId,
    accounts: addresses.map((address) => ({ address, source: connectorId })),
    meta: {},
  }
}

function memoryStorage(seed: Record<string, string>): Storage {
  const m = new Map(Object.entries(seed))
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size
    },
  }
}

/** A fresh store module, hydrated from `persisted` like a page reload. */
async function loadStore(persisted: {
  connectorId: ConnectorId | null
  activeAddress: string | null
}) {
  vi.resetModules()
  vi.stubGlobal(
    "localStorage",
    memoryStorage({ [PERSIST_KEY]: JSON.stringify({ state: persisted, version: 0 }) }),
  )
  return import("@/lib/wallet/store")
}

beforeEach(() => {
  restore.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("pickActiveAddress", () => {
  it("keeps the preferred account while the session holds it", async () => {
    const { pickActiveAddress } = await loadStore({ connectorId: null, activeAddress: null })
    expect(pickActiveAddress(session([ALICE, BOB]), BOB)).toBe(BOB)
  })

  it("matches by public key and returns the session's encoding", async () => {
    const { pickActiveAddress } = await loadStore({ connectorId: null, activeAddress: null })
    expect(pickActiveAddress(session([ALICE, BOB]), BOB_ENJIN)).toBe(BOB)
  })

  it("falls back to the first account when the preferred one is gone", async () => {
    const { pickActiveAddress } = await loadStore({ connectorId: null, activeAddress: null })
    expect(pickActiveAddress(session([ALICE, BOB]), CHARLIE)).toBe(ALICE)
    expect(pickActiveAddress(session([ALICE, BOB]), null)).toBe(ALICE)
    expect(pickActiveAddress(session([]), CHARLIE)).toBeNull()
  })
})

describe("restoreWallet", () => {
  it("drops a persisted account the restored session no longer holds", async () => {
    const { restoreWallet, useWalletStore } = await loadStore({
      connectorId: "polkadot-js",
      activeAddress: CHARLIE,
    })
    restore.mockResolvedValue(session([ALICE, BOB]))

    await expect(restoreWallet()).resolves.toBe(ALICE)
    const s = useWalletStore.getState()
    expect(s.status).toBe("connected")
    expect(s.activeAddress).toBe(ALICE)
  })

  it("keeps a persisted account the session still holds", async () => {
    const { restoreWallet, useWalletStore } = await loadStore({
      connectorId: "polkadot-js",
      activeAddress: BOB,
    })
    restore.mockResolvedValue(session([ALICE, BOB]))

    await expect(restoreWallet()).resolves.toBeNull()
    expect(useWalletStore.getState().activeAddress).toBe(BOB)
  })

  it("treats a re-encoded persisted address as the same account", async () => {
    const { restoreWallet, useWalletStore } = await loadStore({
      connectorId: "polkadot-js",
      activeAddress: BOB_ENJIN,
    })
    restore.mockResolvedValue(session([ALICE, BOB]))

    await expect(restoreWallet()).resolves.toBeNull()
    expect(useWalletStore.getState().activeAddress).toBe(BOB)
  })

  it("resets when the connector has no session to restore", async () => {
    const { restoreWallet, useWalletStore } = await loadStore({
      connectorId: "polkadot-js",
      activeAddress: BOB,
    })
    restore.mockResolvedValue(null)

    await expect(restoreWallet()).resolves.toBeNull()
    const s = useWalletStore.getState()
    expect(s.status).toBe("disconnected")
    expect(s.activeAddress).toBeNull()
    expect(s.connectorId).toBeNull()
  })

  it("resets when restoring throws", async () => {
    const { restoreWallet, useWalletStore } = await loadStore({
      connectorId: "polkadot-js",
      activeAddress: BOB,
    })
    restore.mockRejectedValue(new Error("extension locked"))

    await expect(restoreWallet()).resolves.toBeNull()
    expect(useWalletStore.getState().status).toBe("disconnected")
  })

  it("does nothing without a persisted connector", async () => {
    const { restoreWallet } = await loadStore({ connectorId: null, activeAddress: CHARLIE })
    await expect(restoreWallet()).resolves.toBeNull()
    expect(restore).not.toHaveBeenCalled()
  })
})

describe("setConnected", () => {
  it("replaces an address from an earlier session on a fresh connect", async () => {
    const { useWalletStore } = await loadStore({ connectorId: null, activeAddress: CHARLIE })
    useWalletStore.getState().setConnected(session([ALICE, BOB], "walletconnect"))
    expect(useWalletStore.getState().activeAddress).toBe(ALICE)
  })
})
