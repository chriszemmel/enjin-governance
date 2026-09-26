import { describe, expect, it } from "vitest"
import { decodeAddress } from "@polkadot/util-crypto"
import { u8aToHex } from "@polkadot/util"
import {
  allowedActions,
  mediaServable,
  parseAdminKeys,
  parseMediaKey,
  reportStatusAfter,
  roleAtLeast,
  stateAfter,
} from "@/lib/moderation/policy"

const EN = "enCrdzdh8TVcEuoWtWokRRzgWVgLdGoyo5P4c7344LXRzFidX"
const toKey = (a: string) => u8aToHex(decodeAddress(a))

describe("roles and actions", () => {
  it("orders roles", () => {
    expect(roleAtLeast(null, "moderator")).toBe(false)
    expect(roleAtLeast("moderator", "moderator")).toBe(true)
    expect(roleAtLeast("moderator", "admin")).toBe(false)
    expect(roleAtLeast("admin", "moderator")).toBe(true)
  })

  it("only admins may delete files, and only attachments have files", () => {
    expect(allowedActions("attachment", "moderator")).not.toContain("delete_file")
    expect(allowedActions("attachment", "admin")).toContain("delete_file")
    expect(allowedActions("comment", "admin")).not.toContain("delete_file")
    expect(allowedActions("proposal", "admin")).not.toContain("blur")
    expect(allowedActions("proposal", null)).toEqual([])
  })

  it("maps actions onto states and report outcomes", () => {
    expect(stateAfter("blur")).toBe("blurred")
    expect(stateAfter("hide")).toBe("hidden")
    expect(stateAfter("delete_file")).toBe("removed")
    expect(stateAfter("restore")).toBe("visible")
    expect(reportStatusAfter("keep")).toBe("dismissed")
    expect(reportStatusAfter("hide")).toBe("resolved")
  })

  it("serves blurred media but not hidden or removed media", () => {
    expect(mediaServable(null)).toBe(true)
    expect(mediaServable("blurred")).toBe(true)
    expect(mediaServable("hidden")).toBe(false)
    expect(mediaServable("removed")).toBe(false)
  })
})

describe("parseAdminKeys", () => {
  it("accepts addresses on any prefix and raw keys, skipping junk", () => {
    const keys = parseAdminKeys(` ${EN}, 0x${"AB".repeat(32)}  nonsense`, toKey)
    expect(keys).toEqual(new Set([toKey(EN), `0x${"ab".repeat(32)}`]))
    expect(parseAdminKeys(undefined, toKey).size).toBe(0)
  })
})

describe("parseMediaKey", () => {
  it("finds the proposal behind a media key", () => {
    const id = "11111111-2222-4333-8444-555555555555"
    expect(parseMediaKey(`proposals/canary-relay/${id}/media/ab12-x.png`)).toEqual({
      network: "canary-relay",
      proposalId: id,
    })
    expect(parseMediaKey(`proposals/canary-relay/${id}/proposal.json`)).toBeNull()
    expect(parseMediaKey(`user-avatars/${id}.png`)).toBeNull()
  })
})
