import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { stringToHex } from "@polkadot/util"
import {
  buildProposalCall,
  PROPOSAL_KIND_META,
  type ProposalCallSpec,
  type ProposalKind,
} from "@/lib/governance/proposal-calls"

/**
 * buildProposalCall routes each curated proposal kind to the right pallet call
 * and returns its `.method`. We fake api.tx so each call records its args.
 */
type Recorded = { call: string; args: unknown[] }

function fakeApi(sink: Recorded[]): ApiPromise {
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      sink.push({ call: name, args })
      return { method: { __call: name, args } }
    }
  return {
    tx: {
      treasury: { spendLocal: rec("treasury.spendLocal") },
      referenda: { cancel: rec("referenda.cancel"), kill: rec("referenda.kill") },
      whitelist: { whitelistCall: rec("whitelist.whitelistCall") },
      system: {
        authorizeUpgrade: rec("system.authorizeUpgrade"),
        remark: rec("system.remark"),
      },
    },
    createType: (type: string, value: unknown) => ({ __call: type, value }),
  } as unknown as ApiPromise
}

describe("buildProposalCall", () => {
  it("treasurySpend → treasury.spendLocal(amount, beneficiary)", () => {
    const sink: Recorded[] = []
    buildProposalCall(fakeApi(sink), {
      kind: "treasurySpend",
      amount: 500n,
      beneficiary: "enAlice",
    })
    expect(sink[0]).toEqual({ call: "treasury.spendLocal", args: ["500", "enAlice"] })
  })

  it("cancelReferendum → referenda.cancel(index)", () => {
    const sink: Recorded[] = []
    buildProposalCall(fakeApi(sink), { kind: "cancelReferendum", index: 3 })
    expect(sink[0]).toEqual({ call: "referenda.cancel", args: [3] })
  })

  it("killReferendum → referenda.kill(index)", () => {
    const sink: Recorded[] = []
    buildProposalCall(fakeApi(sink), { kind: "killReferendum", index: 7 })
    expect(sink[0]).toEqual({ call: "referenda.kill", args: [7] })
  })

  it("whitelistCall → whitelist.whitelistCall(hash)", () => {
    const sink: Recorded[] = []
    buildProposalCall(fakeApi(sink), { kind: "whitelistCall", callHash: "0xabc" })
    expect(sink[0]).toEqual({ call: "whitelist.whitelistCall", args: ["0xabc"] })
  })

  it("authorizeUpgrade → system.authorizeUpgrade(codeHash)", () => {
    const sink: Recorded[] = []
    buildProposalCall(fakeApi(sink), { kind: "authorizeUpgrade", codeHash: "0xabc" })
    expect(sink[0]).toEqual({ call: "system.authorizeUpgrade", args: ["0xabc"] })
  })

  it("remark → system.remark(stringToHex(text)) (hex, not raw UTF-8)", () => {
    const sink: Recorded[] = []
    buildProposalCall(fakeApi(sink), { kind: "remark", text: "hello" })
    expect(sink[0]).toEqual({ call: "system.remark", args: [stringToHex("hello")] })
  })

  it("rawCall → api.createType('Call', hex)", () => {
    const api = fakeApi([])
    const call = buildProposalCall(api, { kind: "rawCall", callHex: "0x0102" }) as unknown as {
      __call: string
      value: unknown
    }
    expect(call.__call).toBe("Call")
    expect(call.value).toBe("0x0102")
  })
})

describe("PROPOSAL_KIND_META", () => {
  it("has an entry for every proposal kind", () => {
    const kinds: ProposalKind[] = [
      "treasurySpend",
      "cancelReferendum",
      "killReferendum",
      "whitelistCall",
      "authorizeUpgrade",
      "remark",
      "rawCall",
    ]
    for (const k of kinds) {
      expect(PROPOSAL_KIND_META[k]).toBeDefined()
      expect(PROPOSAL_KIND_META[k].label.length).toBeGreaterThan(0)
    }
  })

  it("suggests privileged origins for the admin kinds", () => {
    expect(PROPOSAL_KIND_META.cancelReferendum.suggestedOrigin).toEqual({
      Origins: "ReferendumCanceller",
    })
    expect(PROPOSAL_KIND_META.killReferendum.suggestedOrigin).toEqual({
      Origins: "ReferendumKiller",
    })
    expect(PROPOSAL_KIND_META.authorizeUpgrade.suggestedOrigin).toEqual({ System: "Root" })
  })

  it("leaves treasurySpend origin null (derived from amount)", () => {
    expect(PROPOSAL_KIND_META.treasurySpend.suggestedOrigin).toBeNull()
  })

  // Type-level guard: ensure every spec kind is buildable (exhaustive switch).
  it("covers all ProposalCallSpec kinds", () => {
    const specs: ProposalCallSpec[] = [
      { kind: "treasurySpend", amount: 1n, beneficiary: "x" },
      { kind: "cancelReferendum", index: 0 },
      { kind: "killReferendum", index: 0 },
      { kind: "whitelistCall", callHash: "0x" },
      { kind: "authorizeUpgrade", codeHash: "0x" },
      { kind: "remark", text: "" },
      { kind: "rawCall", callHex: "0x" },
    ]
    expect(specs).toHaveLength(7)
  })
})
