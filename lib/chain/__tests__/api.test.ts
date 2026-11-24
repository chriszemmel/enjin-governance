import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { defined } from "@/test/defined"

/**
 * getArchiveApi opens the chain's RPC connection first and hands its
 * metadata to the archive connection, which also gets the long archive
 * timeout. Polkadot's ApiPromise and WsProvider are faked: each "chain" is
 * identified by its endpoint, and the fake records what it was created with.
 */

const created = vi.hoisted(
  () => [] as Array<{ endpoint: string; timeout: number; metadata: Record<string, string> }>,
)

vi.mock("@polkadot/api", () => {
  class WsProvider {
    constructor(
      public endpoint: string,
      _autoConnectMs: number,
      _headers: object,
      public timeout: number,
    ) {}
  }
  const ApiPromise = {
    create: async (opts: { provider: WsProvider; metadata: Record<string, string> }) => {
      created.push({
        endpoint: opts.provider.endpoint,
        timeout: opts.provider.timeout,
        metadata: opts.metadata,
      })
      return {
        isConnected: true,
        isReady: Promise.resolve(),
        genesisHash: { toHex: () => "0xgenesis" },
        runtimeVersion: { specVersion: { toString: () => "1082" } },
        runtimeMetadata: { toHex: () => `0xmetadata-from-${opts.provider.endpoint}` },
        disconnect: async () => {},
      }
    },
  }
  return { ApiPromise, WsProvider }
})

const chain = { rpc: "wss://rpc.example", archiveRpc: "wss://archive.example" }

beforeEach(() => {
  created.length = 0
  vi.resetModules()
})
afterEach(() => {
  vi.resetModules()
})

describe("getArchiveApi", () => {
  it("opens the RPC first and gives the archive its metadata and a long timeout", async () => {
    const { getArchiveApi } = await import("@/lib/chain/api")
    await getArchiveApi(chain, 0)

    expect(created.map((c) => c.endpoint)).toEqual([chain.rpc, chain.archiveRpc])
    const [rpc, archive] = created
    expect(defined(rpc).timeout).toBe(10_000)
    expect(defined(rpc).metadata).toEqual({})
    expect(defined(archive).timeout).toBe(60_000)
    expect(defined(archive).metadata).toEqual({
      "0xgenesis-1082": "0xmetadata-from-wss://rpc.example",
    })
  })

  it("uses the RPC node, with its own timeout, for a chain without an archive", async () => {
    const { getArchiveApi } = await import("@/lib/chain/api")
    await getArchiveApi({ rpc: chain.rpc, archiveRpc: null }, 0)
    expect(created).toHaveLength(1)
    expect(defined(created[0])).toMatchObject({ endpoint: chain.rpc, timeout: 10_000 })
  })

  it("reuses an open archive connection", async () => {
    const { getArchiveApi } = await import("@/lib/chain/api")
    const first = await getArchiveApi(chain, 0)
    const second = await getArchiveApi(chain, 0)
    expect(second).toBe(first)
    expect(created).toHaveLength(2)
  })
})
