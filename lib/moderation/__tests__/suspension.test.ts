import { describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({ next: null as unknown }))
vi.mock("@/lib/auth/roles", () => ({ publicKeyHex: (a: string) => `0x${a}` }))
vi.mock("@/lib/db/moderation", () => ({
  getSuspension: async () => {
    if (db.next instanceof Error) throw db.next
    return db.next
  },
}))

import { postingSuspendedResponse } from "@/lib/moderation/suspension"

const me = { address: "abc" }

describe("postingSuspendedResponse", () => {
  it("blocks a paused account and lets everyone else post", async () => {
    db.next = new Date("2030-01-01")
    expect((await postingSuspendedResponse(me))?.status).toBe(403)
    db.next = null
    expect(await postingSuspendedResponse(me)).toBeNull()
  })

  it("lets posts through only while the table doesn't exist yet", async () => {
    db.next = Object.assign(new Error('relation "moderation_suspensions" does not exist'), {
      code: "42P01",
    })
    expect(await postingSuspendedResponse(me)).toBeNull()
    db.next = new Error("connection reset")
    expect((await postingSuspendedResponse(me))?.status).toBe(503)
  })
})
