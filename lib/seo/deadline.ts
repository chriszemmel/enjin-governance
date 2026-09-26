/**
 * Settle with `work`, or reject once `ms` have passed. For best-effort reads
 * (database, chain) that must never hold up a page or a sitemap. The work
 * itself keeps running; its result is simply no longer waited for.
 */
export function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`exceeded ${ms}ms`)), ms)
    // Don't keep a process (or a test run) alive just for this timer.
    ;(timer as { unref?: () => void }).unref?.()
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}
