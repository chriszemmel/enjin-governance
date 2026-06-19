"use client"

import { cn } from "@/lib/utils"
import { type ChainConfig, subscanAccountUrl } from "@/lib/chain/chains"
import {
  encodeForChain,
  encodePublicKeyForChain,
  shortenAddress,
} from "@/lib/chain/ss58"

interface AddressLinkProps {
  /** Either an SS58 address or a 0x-prefixed 32-byte hex public key. */
  value: string
  chain: ChainConfig
  /** When true, render the full address rather than the shortened form. */
  full?: boolean
  /** Override truncation lengths when not `full`. Defaults to (6, 6). */
  lead?: number
  trail?: number
  className?: string
}

/**
 * Renders an account address as a Subscan link. Accepts either SS58
 * (`enFzES…`) or a raw hex pubkey (`0xeabc…`), translating the latter
 * to the chain's SS58 prefix. Falls back to a plain mono span when
 * the chain has no Subscan instance configured.
 */
export function AddressLink({
  value,
  chain,
  full = false,
  lead = 6,
  trail = 6,
  className,
}: AddressLinkProps) {
  const ss58 = normaliseToSs58(value, chain)
  if (!ss58) {
    return (
      <span className={cn("font-mono break-all", className)}>
        {value}
      </span>
    )
  }
  const display = full ? ss58 : shortenAddress(ss58, lead, trail)
  const href = subscanAccountUrl(chain, ss58)
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title="View on Subscan"
      className={cn(
        "font-mono break-all text-foreground hover:text-primary underline-offset-2 hover:underline transition-colors",
        className,
      )}
    >
      {display}
    </a>
  )
}

function normaliseToSs58(value: string, chain: ChainConfig): string | null {
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
    try {
      return encodePublicKeyForChain(value, chain.id)
    } catch {
      return null
    }
  }
  // Already SS58 - re-encode to the chain's prefix in case it came in
  // a different format (e.g. a 5… polkadot-prefixed address).
  try {
    return encodeForChain(value, chain.id)
  } catch {
    // Not a recognisable address.
    return null
  }
}
