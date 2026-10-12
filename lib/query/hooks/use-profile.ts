"use client"

import { useMemo } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fitForUpload } from "@/lib/uploads/fit-for-upload"
import { MAX_UPLOAD_LABEL } from "@/lib/uploads/limits"
import { readApiError } from "@/lib/utils/api-error"

export type PublicProfile = {
  id: string
  address: string
  handle: string | null
  display_name: string | null
  bio: string | null
  avatar_url: string | null
  is_verified: boolean
  created_at: string
}

export function usePublicProfile(address: string | null | undefined) {
  return useQuery<PublicProfile | null>({
    queryKey: ["public-profile", address],
    queryFn: async () => {
      if (!address) return null
      const res = await fetch(
        `/api/users/by-address/${encodeURIComponent(address)}`,
      )
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { ok: true; user: PublicProfile }
      return json.user
    },
    enabled: !!address,
    staleTime: 60_000,
  })
}

/**
 * Batch sibling to `usePublicProfile`. One POST returns every profile in
 * the list - used by lists that would otherwise fan out into N requests
 * (wallet account picker, comment threads, etc.).
 *
 * Side-effect: primes the per-address `["public-profile", addr]` cache so
 * a subsequent navigation to a profile page is an instant hit, and any
 * stray `usePublicProfile(addr)` calls (single-use widgets, nav header)
 * see fresh data without a second round-trip.
 *
 * Render contract: data is a `Map<address, PublicProfile | null>` keyed
 * by the addresses that were actually requested - `null` means the row
 * doesn't exist (rather than `undefined` = "not in result"). Loading
 * state is the standard React Query `isPending` on the returned query.
 */
export function usePublicProfiles(
  addresses: ReadonlyArray<string | null | undefined>,
) {
  const qc = useQueryClient()

  const valid = useMemo(() => {
    const seen = new Set<string>()
    for (const a of addresses) {
      if (typeof a === "string" && a.length >= 4) seen.add(a)
    }
    return Array.from(seen).sort()
  }, [addresses])

  const cacheKey = valid.join(",")

  return useQuery<Map<string, PublicProfile | null>>({
    queryKey: ["public-profiles", cacheKey],
    queryFn: async () => {
      const result = new Map<string, PublicProfile | null>()
      if (valid.length === 0) return result
      const res = await fetch("/api/users/by-addresses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: valid }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { ok: true; users: PublicProfile[] }
      const byAddress = new Map<string, PublicProfile>()
      for (const u of json.users) byAddress.set(u.address, u)
      for (const a of valid) {
        const profile = byAddress.get(a) ?? null
        result.set(a, profile)
        // Keep single-address consumers (profile pages, nav header) in
        // sync without an extra request.
        qc.setQueryData(["public-profile", a], profile)
      }
      return result
    },
    enabled: valid.length > 0,
    staleTime: 60_000,
  })
}

type ProfilePatch = {
  display_name?: string | null
  bio?: string | null
  handle?: string | null
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, ProfilePatch>({
    mutationFn: async (patch) => {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      })
      const json = (await res.json()) as
        | { ok: true }
        | { ok: false; error: string }
      if (!("ok" in json) || !json.ok) {
        throw new Error("error" in json ? json.error : `HTTP ${res.status}`)
      }
      return null
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["me"] })
      void qc.invalidateQueries({ queryKey: ["public-profile"] })
    },
  })
}

export function useUploadAvatar() {
  const qc = useQueryClient()
  return useMutation<{ avatar_url: string }, Error, File>({
    mutationFn: async (picked) => {
      const fit = await fitForUpload(picked)
      if (!fit.ok) throw new Error(fit.error)
      const form = new FormData()
      form.set("file", fit.file)
      const res = await fetch("/api/users/me/avatar", {
        method: "POST",
        body: form,
      })
      if (!res.ok) {
        throw new Error(
          res.status === 413
            ? `Images can be up to ${MAX_UPLOAD_LABEL}.`
            : await readApiError(res),
        )
      }
      const json = (await res.json()) as
        | { ok: true; avatar_url: string }
        | { ok: false; error: string }
      if (!("ok" in json) || !json.ok) {
        throw new Error("error" in json ? json.error : `HTTP ${res.status}`)
      }
      return { avatar_url: json.avatar_url }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["me"] })
      void qc.invalidateQueries({ queryKey: ["public-profile"] })
    },
  })
}
