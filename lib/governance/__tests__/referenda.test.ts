import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { stringToU8a, u8aToHex } from "@polkadot/util"
import {
  boundedProposalArg,
  buildCancelReferendumCall,
  buildKillReferendumCall,
  buildSetMetadata,
  buildSubmit,
  buildWhitelistCall,
  extractReferendumIndex,
  getDecidedTrack,
  getReferendumMetadata,
} from "@/lib/governance/referenda"
import type { EventRecord } from "@polkadot/types/interfaces"

/**
 * buildSubmit wraps the bounded proposal as `{ Lookup: { hash, len } }` and
 * maps the enactment moment onto the `At` / `After` codec variants. The
 * treasury happy-path (Origins tier + After 0) is covered elsewhere; these
 * tests exercise the two branches that path never hits: the `At`-block
 * enactment variant and a non-Origins origin (`{ System: 'Root' }`).
 */

type Recorded = { args: unknown[] }

function fakeApi(sink: Recorded[]): ApiPromise {
  return {
    tx: {
      referenda: {
        submit: (...args: unknown[]) => {
          sink.push({ args })
          return { __tx: "submit" } as unknown
        },
      },
    },
  } as unknown as ApiPromise
}

const PROPOSAL = { hash: "0xabc" as `0x${string}`, len: 42 }

describe("buildSubmit - enactment + origin variants", () => {
  it("maps an 'After' enactment to the { After: block } variant", () => {
    const sink: Recorded[] = []
    buildSubmit(fakeApi(sink), {
      origin: { Origins: "SmallTipper" },
      proposal: PROPOSAL,
      enactment: { type: "After", block: 0 },
    })
    expect(sink[0].args).toEqual([
      { Origins: "SmallTipper" },
      { Lookup: { hash: "0xabc", len: 42 } },
      { After: 0 },
    ])
  })

  it("maps an 'At' enactment to the { At: block } variant", () => {
    const sink: Recorded[] = []
    buildSubmit(fakeApi(sink), {
      origin: { Origins: "BigSpender" },
      proposal: PROPOSAL,
      enactment: { type: "At", block: 1_000 },
    })
    expect(sink[0].args[2]).toEqual({ At: 1_000 })
  })

  it("passes a { System: 'Root' } origin straight through", () => {
    const sink: Recorded[] = []
    buildSubmit(fakeApi(sink), {
      origin: { System: "Root" },
      proposal: PROPOSAL,
      enactment: { type: "At", block: 5 },
    })
    expect(sink[0].args[0]).toEqual({ System: "Root" })
    expect(sink[0].args[1]).toEqual({ Lookup: { hash: "0xabc", len: 42 } })
    expect(sink[0].args[2]).toEqual({ At: 5 })
  })

  it("wraps an Inline proposal as { Inline: <hex> } (skips the preimage)", () => {
    const sink: Recorded[] = []
    const bytes = new Uint8Array([1, 2, 3, 4])
    buildSubmit(fakeApi(sink), {
      origin: { Origins: "SmallTipper" },
      proposal: { inline: bytes },
      enactment: { type: "After", block: 0 },
    })
    expect(sink[0].args[1]).toEqual({ Inline: u8aToHex(bytes) })
  })
})

describe("boundedProposalArg", () => {
  it("maps a PreimageRef to the Lookup variant", () => {
    expect(boundedProposalArg(PROPOSAL)).toEqual({
      Lookup: { hash: "0xabc", len: 42 },
    })
  })

  it("maps inline bytes to the Inline hex variant", () => {
    expect(boundedProposalArg({ inline: new Uint8Array([255, 0]) })).toEqual({
      Inline: "0xff00",
    })
  })
})

describe("admin call builders", () => {
  function adminApi(sink: Recorded[]): ApiPromise {
    const rec =
      (name: string) =>
      (...args: unknown[]) => {
        sink.push({ args })
        return { method: { __call: name, args } }
      }
    return {
      tx: {
        referenda: { cancel: rec("referenda.cancel"), kill: rec("referenda.kill") },
        whitelist: { whitelistCall: rec("whitelist.whitelistCall") },
      },
    } as unknown as ApiPromise
  }

  it("buildCancelReferendumCall calls referenda.cancel(index) and returns its method", () => {
    const sink: Recorded[] = []
    const call = buildCancelReferendumCall(adminApi(sink), 12) as unknown as {
      __call: string
    }
    expect(sink[0].args).toEqual([12])
    expect(call.__call).toBe("referenda.cancel")
  })

  it("buildKillReferendumCall calls referenda.kill(index)", () => {
    const sink: Recorded[] = []
    buildKillReferendumCall(adminApi(sink), 9)
    expect(sink[0].args).toEqual([9])
  })

  it("buildWhitelistCall calls whitelist.whitelistCall(hash)", () => {
    const sink: Recorded[] = []
    buildWhitelistCall(adminApi(sink), "0xdeadbeef")
    expect(sink[0].args).toEqual(["0xdeadbeef"])
  })
})

describe("buildSetMetadata", () => {
  it("calls referenda.setMetadata(index, hash)", () => {
    const sink: Recorded[] = []
    const api = {
      tx: {
        referenda: {
          setMetadata: (...args: unknown[]) => {
            sink.push({ args })
            return { __tx: "setMetadata" }
          },
        },
      },
    } as unknown as ApiPromise
    const tx = buildSetMetadata(api, 11, "0xfeed")
    expect(sink[0].args).toEqual([11, "0xfeed"])
    expect(tx).toEqual({ __tx: "setMetadata" })
  })
})

describe("getReferendumMetadata", () => {
  const ENVELOPE = 'EGOV1:{"u":"https://x/p.json","h":"abc123"}'
  const ENVELOPE_BYTES = stringToU8a(ENVELOPE)
  const HASH = "0x11" as `0x${string}`

  /**
   * Fakes the three storage reads the resolution path touches:
   * referenda.metadataOf → the bound hash, preimage.requestStatusFor →
   * the Unrequested{len} row (MetadataOf stores no length, so getPreimage
   * recovers it from here), preimage.preimageFor → the envelope bytes.
   */
  function metadataApi(opts: {
    metadataHash: `0x${string}` | null
    preimageBytes: Uint8Array | null
  }): ApiPromise {
    const preimageFor = async (key: [string, number]) =>
      opts.preimageBytes && key[0] === opts.metadataHash
        ? {
            isSome: true,
            unwrap: () => ({ toU8a: () => opts.preimageBytes }),
          }
        : { isSome: false }
    preimageFor.keys = async () => []
    return {
      query: {
        referenda: {
          metadataOf: async () =>
            opts.metadataHash
              ? { isSome: true, unwrap: () => ({ toHex: () => opts.metadataHash }) }
              : { isSome: false },
        },
        preimage: {
          requestStatusFor: async () =>
            opts.preimageBytes
              ? {
                  isSome: true,
                  unwrap: () => ({
                    isUnrequested: true,
                    asUnrequested: {
                      len: { toNumber: () => opts.preimageBytes!.length },
                    },
                  }),
                }
              : { isSome: false },
          preimageFor,
        },
      },
    } as unknown as ApiPromise
  }

  it("resolves MetadataOf → preimage bytes → parsed envelope", async () => {
    const api = metadataApi({ metadataHash: HASH, preimageBytes: ENVELOPE_BYTES })
    const envelope = await getReferendumMetadata(api, 10)
    expect(envelope).toEqual({ u: "https://x/p.json", h: "abc123" })
  })

  it("returns null when the referendum has no metadata", async () => {
    const api = metadataApi({ metadataHash: null, preimageBytes: null })
    expect(await getReferendumMetadata(api, 10)).toBeNull()
  })

  it("returns null when the bound preimage is missing/pruned", async () => {
    const api = metadataApi({ metadataHash: HASH, preimageBytes: null })
    expect(await getReferendumMetadata(api, 10)).toBeNull()
  })

  it("returns null when the preimage is not an EGOV1 envelope", async () => {
    const api = metadataApi({
      metadataHash: HASH,
      preimageBytes: stringToU8a("QmSomeIpfsHashFromAnotherClient"),
    })
    expect(await getReferendumMetadata(api, 10)).toBeNull()
  })
})

describe("extractReferendumIndex", () => {
  const evt = (section: string, method: string, index?: number): EventRecord =>
    ({
      event: {
        section,
        method,
        data: index == null ? [] : [{ toNumber: () => index }],
      },
    }) as unknown as EventRecord

  it("returns the index from a referenda.Submitted event", () => {
    const events = [evt("balances", "Withdraw"), evt("referenda", "Submitted", 77)]
    expect(extractReferendumIndex(events)).toBe(77)
  })

  it("returns null when no Submitted event is present", () => {
    expect(extractReferendumIndex([evt("system", "ExtrinsicSuccess")])).toBeNull()
  })
})

/**
 * getDecidedTrack reads only the leading bytes of the raw ReferendumInfo at
 * the block before the decision: variant 0 (Ongoing), then the track as a
 * little-endian u16. Mainnet #12 was on MediumSpender (track 203).
 */
describe("getDecidedTrack", () => {
  const apiWith = (value: Uint8Array | null) => {
    const calls: unknown[] = []
    const api = {
      rpc: {
        chain: { getBlockHash: async (n: number) => (calls.push(n), "0xhash") },
        state: {
          getStorage: async () =>
            value == null
              ? { isSome: false, toU8a: () => new Uint8Array() }
              : { isSome: true, unwrap: () => ({ toU8a: () => value }), toU8a: () => value },
        },
      },
      query: { referenda: { referendumInfoFor: { key: () => "0xkey" } } },
    } as unknown as ApiPromise
    return { api, calls }
  }

  it("reads the track from an Ongoing record at the block before the decision", async () => {
    const { api, calls } = apiWith(new Uint8Array([0, 0xcb, 0x00, 9, 9, 9]))
    await expect(getDecidedTrack(api, 12, 17_533_282)).resolves.toBe(203)
    expect(calls).toEqual([17_533_281])
  })

  it("is null for a missing or non-Ongoing record, or an impossible block", async () => {
    await expect(getDecidedTrack(apiWith(null).api, 1, 100)).resolves.toBeNull()
    await expect(getDecidedTrack(apiWith(new Uint8Array([1, 2, 3])).api, 1, 100)).resolves.toBeNull()
    await expect(getDecidedTrack(apiWith(new Uint8Array([0, 1, 0])).api, 1, 1)).resolves.toBeNull()
  })
})
