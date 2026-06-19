/**
 * React Query client factory. One client per browser session - created
 * lazily in Providers via useState so HMR doesn't recreate it on every
 * render.
 */

import { QueryClient } from "@tanstack/react-query"

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Chain reads are cheap to re-fetch but expensive to over-fetch.
        // 30s default is fine for list pages; per-query overrides tighten
        // for actively-changing data (e.g. a single ongoing referendum).
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 3,
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 10_000),
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  })
}
