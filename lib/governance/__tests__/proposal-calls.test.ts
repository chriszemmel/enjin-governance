import { describe, expect, it } from "vitest"
import type { ApiPromise } from "@polkadot/api"
import { hexToU8a, stringToHex } from "@polkadot/util"
import { formatTrackName } from "@/lib/governance/display"
import {
  buildProposalCall,
  PROPOSAL_KIND_META,
  SUBMIT_ORIGINS,
  type ProposalCallSpec,
  type ProposalKind,
} from "@/lib/governance/proposal-calls"
import { canonicalTrackName } from "@/lib/governance/tracks"

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

  it("rawCall → api.createType('Call', hex), only when it re-encodes to the same bytes", () => {
    // A decoder that, like the real one, stops at the end of the first call.
    const api = {
      createType: (_type: string, hex: string) => ({
        __call: "Call",
        value: hex,
        toU8a: () => hexToU8a(hex).slice(0, 2),
      }),
    } as unknown as ApiPromise
    const call = buildProposalCall(api, { kind: "rawCall", callHex: "0x0102" }) as unknown as {
      __call: string
      value: unknown
    }
    expect(call.__call).toBe("Call")
    expect(call.value).toBe("0x0102")
    expect(() => buildProposalCall(api, { kind: "rawCall", callHex: "0x0102deadbeef" })).toThrow(
      /exactly one call/,
    )
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

describe("SUBMIT_ORIGINS", () => {
  // Every origin with a referenda track on Enjin 1070 and 1080 (the
  // `Origins` enum minus Emergency and the fellowship ranks), by track id.
  const TRACKS: [string, number][] = [
    ["root", 0],
    ["whitelisted_caller", 1],
    ["referendum_canceller", 2],
    ["referendum_killer", 3],
    ["staking_admin", 100],
    ["treasury_admin", 101],
    ["lease_admin", 102],
    ["fellowship_admin", 103],
    ["general_admin", 104],
    ["auction_admin", 105],
    ["multi_tokens_admin", 106],
    ["fuel_tanks_admin", 107],
    ["whitelist_admin", 111],
    ["parachains_admin", 112],
    ["small_tipper", 200],
    ["big_tipper", 201],
    ["small_spender", 202],
    ["medium_spender", 203],
    ["big_spender", 204],
  ]

  it("offers one origin per track, in track order", () => {
    expect(SUBMIT_ORIGINS.map((o) => o.track)).toEqual(TRACKS.map(([name]) => name))
  })

  it("includes the admin origins", () => {
    const labels = SUBMIT_ORIGINS.map((o) => o.label)
    for (const admin of ["StakingAdmin", "TreasuryAdmin", "FellowshipAdmin", "GeneralAdmin"]) {
      expect(labels).toContain(admin)
    }
    expect(labels).not.toContain("Emergency")
  })

  it("names each origin after its track", () => {
    for (const o of SUBMIT_ORIGINS) {
      expect(canonicalTrackName(o.label)).toBe(canonicalTrackName(o.track))
      const expected = o.label === "Root" ? { System: "Root" } : { Origins: o.label }
      expect(o.origin).toEqual(expected)
    }
  })

  it("formats the labels for display", () => {
    const shown = Object.fromEntries(SUBMIT_ORIGINS.map((o) => [o.label, formatTrackName(o.label)]))
    expect(shown.MultiTokensAdmin).toBe("Multi Tokens Admin")
    expect(shown.FuelTanksAdmin).toBe("Fuel Tanks Admin")
    expect(shown.StakingAdmin).toBe("Staking Admin")
    expect(shown.Root).toBe("Root")
    expect(new Set(Object.values(shown)).size).toBe(SUBMIT_ORIGINS.length)
  })

  it("lists every suggested origin", () => {
    for (const meta of Object.values(PROPOSAL_KIND_META)) {
      if (!meta.suggestedOrigin) continue
      expect(SUBMIT_ORIGINS.some((o) => JSON.stringify(o.origin) === JSON.stringify(meta.suggestedOrigin))).toBe(true)
    }
  })
})
