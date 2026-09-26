/**
 * Who operates this deployment, for the Imprint, Privacy and Terms pages.
 * Set via LEGAL_* environment variables so personal details (like a
 * postal address) never land in the repository. Missing values render as
 * visible placeholders, so a gap is obvious before going live.
 */

import "server-only"
import { env } from "@/lib/env"

type Operator = {
  name: string
  /** Address lines; empty when not configured. */
  address: string[]
  email: string | null
  phone: string | null
  vatId: string | null
  /** True when name, address and email are all set. */
  complete: boolean
}

export function getOperator(): Operator {
  const address = (env.LEGAL_OPERATOR_ADDRESS ?? "")
    .split(/\||\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const name = env.LEGAL_OPERATOR_NAME?.trim() || env.NEXT_PUBLIC_SITE_MAINTAINER
  const email = env.LEGAL_CONTACT_EMAIL?.trim() || null
  return {
    name,
    address,
    email,
    phone: env.LEGAL_CONTACT_PHONE?.trim() || null,
    vatId: env.LEGAL_VAT_ID?.trim() || null,
    complete: Boolean(env.LEGAL_OPERATOR_NAME && address.length > 0 && email),
  }
}
