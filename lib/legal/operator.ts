/**
 * Who operates this deployment, for the Imprint, Privacy and Terms pages.
 * Set via LEGAL_* environment variables so personal details (like a
 * postal address) never land in the repository. Without an address the
 * pages say it is available on request by email.
 */

import "server-only"
import { env } from "@/lib/env"

type Operator = {
  name: string
  /** Address lines; empty when not configured. */
  address: string[]
  email: string
  phone: string | null
  vatId: string | null
}

export function getOperator(): Operator {
  const address = (env.LEGAL_OPERATOR_ADDRESS ?? "")
    .split(/\||\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const name = env.LEGAL_OPERATOR_NAME?.trim() || env.NEXT_PUBLIC_SITE_MAINTAINER
  return {
    name,
    address,
    email: env.LEGAL_CONTACT_EMAIL.trim(),
    phone: env.LEGAL_CONTACT_PHONE?.trim() || null,
    vatId: env.LEGAL_VAT_ID?.trim() || null,
  }
}
