import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { stringToHex } from "@polkadot/util"
import { buildProposalCall, SUBMIT_ORIGINS, submitOriginAt } from "@/lib/governance/proposal-calls"
import { defined } from "@/test/defined"

/**
 * The Fellowship kinds of buildProposalCall (member actions, taking back a
 * whitelisted call), the system calls, and the origin fallback.
 */

type Recorded = { call: string; args: unknown[] }

function fakeApi(sink: Recorded[], pallets: Record<string, string[]>): ApiPromise {
  const tx: Record<string, Record<string, unknown>> = {}
  for (const [pallet, calls] of Object.entries(pallets)) {
    tx[pallet] = Object.fromEntries(
      calls.map((call) => [
        call,
        (...args: unknown[]) => {
          sink.push({ call: `${pallet}.${call}`, args })
          return { method: { call: `${pallet}.${call}`, args } }
        },
      ]),
    )
  }
  return { tx } as unknown as ApiPromise
}

const FELLOWSHIP = {
  fellowshipCollective: ["addMember", "promoteMember", "demoteMember", "removeMember"],
}
const HASH = `0x${"ab".repeat(32)}` as const

describe("buildProposalCall - Fellowship and system kinds", () => {
  it("routes each member action to its ranked-collective call", () => {
    const sink: Recorded[] = []
    const api = fakeApi(sink, FELLOWSHIP)
    for (const action of ["add", "promote", "demote"] as const) {
      buildProposalCall(api, { kind: "fellowshipMember", action, who: "enBob", rank: 2 })
    }
    buildProposalCall(api, { kind: "fellowshipMember", action: "remove", who: "enBob", rank: 4 })
    expect(sink).toEqual([
      { call: "fellowshipCollective.addMember", args: ["enBob"] },
      { call: "fellowshipCollective.promoteMember", args: ["enBob"] },
      { call: "fellowshipCollective.demoteMember", args: ["enBob"] },
      { call: "fellowshipCollective.removeMember", args: ["enBob", 4] },
    ])
  })

  it("removes a member of unknown rank with rank 0 as the witness", () => {
    const sink: Recorded[] = []
    buildProposalCall(fakeApi(sink, FELLOWSHIP), {
      kind: "fellowshipMember",
      action: "remove",
      who: "enBob",
      rank: null,
    })
    expect(defined(sink[0]).args).toEqual(["enBob", 0])
  })

  it("takes back a whitelisted call by its hash", () => {
    const sink: Recorded[] = []
    buildProposalCall(fakeApi(sink, { whitelist: ["removeWhitelistedCall"] }), {
      kind: "removeWhitelistedCall",
      callHash: HASH,
    })
    expect(sink).toEqual([{ call: "whitelist.removeWhitelistedCall", args: [HASH] }])
  })

  it("authorizes an upgrade by code hash and hex-encodes a remark", () => {
    const sink: Recorded[] = []
    const api = fakeApi(sink, { system: ["authorizeUpgrade", "remark"] })
    buildProposalCall(api, { kind: "authorizeUpgrade", codeHash: HASH })
    buildProposalCall(api, { kind: "remark", text: "gm" })
    expect(sink).toEqual([
      { call: "system.authorizeUpgrade", args: [HASH] },
      { call: "system.remark", args: [stringToHex("gm")] },
    ])
  })

  it("names the missing pallet instead of failing on undefined", () => {
    expect(() =>
      buildProposalCall(fakeApi([], {}), { kind: "removeWhitelistedCall", callHash: HASH }),
    ).toThrow("Chain does not expose whitelist.removeWhitelistedCall")
  })
})

describe("submitOriginAt", () => {
  it("returns the origin at an index and Root outside the table", () => {
    expect(submitOriginAt(1)).toBe(SUBMIT_ORIGINS[1])
    expect(submitOriginAt(-1).label).toBe("Root")
    expect(submitOriginAt(SUBMIT_ORIGINS.length).origin).toEqual({ System: "Root" })
  })
})
