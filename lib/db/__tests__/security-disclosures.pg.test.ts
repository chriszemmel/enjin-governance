import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { setupTestDb } from "@/test/pglite"

vi.mock("@/lib/db/client", () => import("@/test/pglite").then((m) => m.dbClientMock))

import { createSecurityDisclosure } from "@/lib/db/security-disclosures"

const db = setupTestDb()

const report = {
  severity: "high" as const,
  category: "Auth / API / backend",
  summary: "Session cookie is readable",
  details: "Steps: open devtools, read document.cookie, see the session token.",
  contact: "researcher@example.org",
  network: "enjin-relay",
}

describe("createSecurityDisclosure", () => {
  it("stores the report with a hash of the IP, never the IP itself", async () => {
    const { id } = await createSecurityDisclosure({
      ...report,
      ip: "203.0.113.9",
      userAgent: "curl/8",
      // Extra body fields (the honeypot, anything else) have nowhere to go.
      ...({ website: "spam.example" } as object),
    })
    const rows = await db.sql`SELECT * FROM security_disclosures`
    expect(rows).toEqual([
      {
        id,
        ...report,
        status: "new",
        ip_hash: createHash("sha256").update("203.0.113.9").digest("hex"),
        user_agent: "curl/8",
        created_at: expect.any(Date),
      },
    ])
    expect(JSON.stringify(rows)).not.toContain("203.0.113.9")
    expect(JSON.stringify(rows)).not.toContain("spam.example")
  })

  it("stores no hash for an unknown or missing IP, and nulls for left-out optional fields", async () => {
    await createSecurityDisclosure({
      severity: "low",
      summary: report.summary,
      details: report.details,
      ip: "unknown",
      userAgent: null,
    })
    await createSecurityDisclosure({ ...report, ip: null, userAgent: null })
    const rows = await db.sql`
      SELECT severity, category, contact, network, ip_hash, user_agent
        FROM security_disclosures ORDER BY created_at
    `
    expect(rows).toEqual([
      {
        severity: "low",
        category: null,
        contact: null,
        network: null,
        ip_hash: null,
        user_agent: null,
      },
      {
        severity: "high",
        category: report.category,
        contact: report.contact,
        network: report.network,
        ip_hash: null,
        user_agent: null,
      },
    ])
  })
})
