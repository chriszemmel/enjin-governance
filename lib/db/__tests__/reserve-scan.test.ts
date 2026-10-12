import { beforeEach, describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  totals: { total: 1, text: 0 } as { total: number; text: number } | Error,
  takeBackFails: false,
  queries: [] as string[],
}))
vi.mock("@/lib/db/client", () => ({
  getSql: () => async (strings: TemplateStringsArray) => {
    const q = strings.join("?").trim()
    db.queries.push(q.split(/\s+/)[0]!)
    if (q.startsWith("SELECT")) {
      if (db.totals instanceof Error) throw db.totals
      return [db.totals]
    }
    if (q.startsWith("UPDATE") && db.takeBackFails) throw new Error("connection lost")
    return []
  },
}))

import { reserveScanCheck } from "@/lib/db/moderation"

describe("reserveScanCheck", () => {
  beforeEach(() => {
    db.totals = { total: 1, text: 0 }
    db.takeBackFails = false
    db.queries = []
  })

  it("lets a check through under the limit", async () => {
    expect(await reserveScanCheck("claude-haiku-4-5", "images", 10)).toBe(true)
    expect(db.queries).toEqual(["INSERT", "SELECT"])
  })

  it("refuses over the limit and takes the count back", async () => {
    db.totals = { total: 11, text: 0 }
    expect(await reserveScanCheck("claude-haiku-4-5", "images", 10)).toBe(false)
    expect(db.queries).toEqual(["INSERT", "SELECT", "UPDATE"])
    db.totals = { total: 6, text: 6 }
    expect(await reserveScanCheck("claude-haiku-4-5", "comments", 10)).toBe(false)
  })

  it("refuses when the totals can't be read after counting", async () => {
    db.totals = new Error("connection lost")
    expect(await reserveScanCheck("claude-haiku-4-5", "images", 10)).toBe(false)
    expect(db.queries).toEqual(["INSERT", "SELECT", "UPDATE"])
  })

  it("still refuses when taking the count back fails", async () => {
    db.totals = { total: 11, text: 0 }
    db.takeBackFails = true
    expect(await reserveScanCheck("claude-haiku-4-5", "images", 10)).toBe(false)
  })
})
