/**
 * The Status tab's database probes against real Postgres (PGlite, with
 * every migration in scripts/ applied as `pnpm db:migrate` does): the
 * migrations 011-013 are judged by their tables and constraints, and the
 * ledger is only extra information.
 */
import { describe, expect, it, vi } from "vitest"
import { setupTestDb } from "@/test/pglite"

vi.mock("@/lib/db/client", () => import("@/test/pglite").then((m) => m.dbClientMock))

import { moderationSchema, pingDatabase } from "@/lib/db/moderation"

const db = setupTestDb()

describe("moderationSchema", () => {
  // One test: it drops tables, which the per-test reset can't undo.
  it("sees what is applied, with or without the ledger", async () => {
    await expect(pingDatabase()).resolves.toBeUndefined()
    expect(await moderationSchema()).toEqual({
      moderation: true,
      settings: true,
      keepState: true,
      ledger: [
        "011_moderation.sql",
        "012_moderation_settings.sql",
        "013_moderation_keep_state.sql",
      ],
    })

    // 011 as first released: deleting a draft took its moderation state along.
    await db.sql.query(
      "ALTER TABLE moderation_state DROP CONSTRAINT moderation_state_proposal_id_fkey",
    )
    await db.sql.query(`
      ALTER TABLE moderation_state ADD CONSTRAINT moderation_state_proposal_id_fkey
        FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
    `)
    expect((await moderationSchema()).keepState).toBe(false)

    // Applied by hand: no ledger, the tables tell.
    await db.sql.query("DROP TABLE _migrations")
    expect(await moderationSchema()).toMatchObject({ moderation: true, ledger: null })

    await db.sql.query("DROP TABLE moderation_scan_usage")
    expect((await moderationSchema()).settings).toBe(false)
    await db.sql.query("DROP TABLE moderation_suspensions")
    expect((await moderationSchema()).moderation).toBe(false)
  })
})
