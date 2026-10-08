import { formatError } from "@/lib/utils/format-error"

type ConfirmBody = {
  referendum_index: number
  tx_hash: string
  block_hash: string
  block_number: number
}

/** Backoff between confirm attempts. Short - the user is watching. */
const CONFIRM_RETRY_DELAYS_MS = [1_000, 3_000, 6_000]

/**
 * POST /api/proposals/[id]/confirm, retrying the failures that can clear on
 * their own.
 *
 * The route verifies the on-chain metadata binding before it will attach the
 * index, and fails closed: an unreachable RPC (503) or a node that has not
 * caught up with our own setMetadata yet (409 + retryable) are both
 * transient. A hash mismatch is not - it means this row does not own that
 * referendum, and retrying would never change the answer.
 *
 * Returns null on success, or a message describing why the link failed.
 */
export async function confirmWithRetry(
  draftId: string,
  body: ConfirmBody,
): Promise<string | null> {
  let lastError = "Could not reach the server."

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`/api/proposals/${draftId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) return null

      const payload = (await res.json().catch(() => null)) as {
        error?: string
        retryable?: boolean
      } | null
      lastError = payload?.error ?? `Server responded ${res.status}.`
      // Absent flag: 4xx is a verdict, 5xx is worth another go.
      const retryable = payload?.retryable ?? res.status >= 500
      if (!retryable) return lastError
    } catch (e) {
      lastError = formatError(e)
    }

    const delay = CONFIRM_RETRY_DELAYS_MS[attempt]
    if (delay == null) return lastError
    await new Promise((r) => setTimeout(r, delay))
  }
}
