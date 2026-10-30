import type { NextResponse } from "next/server"

/**
 * Wraps a route handler whose answer depends on who asks (the session
 * cookie), so no browser or shared cache keeps it: every response it
 * returns, errors included, carries `Cache-Control: private, no-store`.
 */
export function noStore<A extends unknown[]>(
  handler: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    const res = await handler(...args)
    res.headers.set("Cache-Control", "private, no-store")
    return res
  }
}
