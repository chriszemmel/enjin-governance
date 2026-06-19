import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { u8aToHex } from "@polkadot/util"
import {
  boundedProposalArg,
  buildCancelReferendumCall,
  buildKillReferendumCall,
  buildSubmit,
  buildWhitelistCall,
  extractReferendumIndex,
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
