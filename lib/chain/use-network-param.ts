"use client"

import { useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { CHAINS, type ChainId } from "./chains"
import { useSetActiveChain } from "./use-chain"

/**
 * Shareable links carry `?network=<id>`: switch the active chain to it, so
 * a Canary link opens on Canary whatever network the visitor last chose.
 */
export function useNetworkParam(): void {
  const searchParams = useSearchParams()
  const setActiveChain = useSetActiveChain()
  const requested = searchParams.get("network")
  useEffect(() => {
    if (requested && Object.hasOwn(CHAINS, requested)) setActiveChain(requested as ChainId)
  }, [requested, setActiveChain])
}
