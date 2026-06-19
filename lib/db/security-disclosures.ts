/**
 * Persistence for inbound security disclosures. The raw client IP is never
 * stored - only a SHA-256 of it, enough to correlate spam from one source
 * without retaining a PII identifier.
 */

import "server-only"
import { createHash } from "node:crypto"
import { getSql } from "./client"
import type { DisclosureInput } from "@/lib/security/disclosure"

type CreateDisclosureArgs = DisclosureInput & {
  ip: string | null
  userAgent: string | null
}

export async function createSecurityDisclosure(
  a: CreateDisclosureArgs,
): Promise<{ id: string }> {
  const sql = getSql()
  const ipHash =
    a.ip && a.ip !== "unknown"
      ? createHash("sha256").update(a.ip).digest("hex")
      : null
  const rows = (await sql`
    INSERT INTO security_disclosures (
      severity, category, summary, details, contact, network, ip_hash, user_agent
    ) VALUES (
      ${a.severity}, ${a.category ?? null}, ${a.summary}, ${a.details},
      ${a.contact ?? null}, ${a.network ?? null}, ${ipHash}, ${a.userAgent}
    )
    RETURNING id
  `) as { id: string }[]
  return { id: rows[0].id }
}
