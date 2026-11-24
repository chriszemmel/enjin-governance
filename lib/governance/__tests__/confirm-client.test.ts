import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { confirmWithRetry } from "@/lib/governance/confirm-client"

/**
 * confirmWithRetry links a finalised submission to its draft. It must retry
 * what can clear on its own (5xx, 409 + retryable, network), stop on a
 * verdict (hash mismatch), and give a lapsed session one re-sign-in.
 */

const BODY = { referendum_index: 12, tx_hash: "0xtx", block_hash: "0xblock", block_number: 100 }

type Reply = { status: number; json?: unknown } | Error

function stubFetch(replies: Reply[]) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const reply = replies.shift()
    if (reply === undefined) throw new Error("unexpected extra request")
    if (reply instanceof Error) throw reply
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => {
        if (reply.json === undefined) throw new SyntaxError("no body")
        return reply.json
      },
    }
  })
  return calls
}

/** Run confirmWithRetry to completion, skipping its backoff sleeps. */
async function run(...args: Parameters<typeof confirmWithRetry>) {
  const result = confirmWithRetry(...args)
  await vi.runAllTimersAsync()
  return result
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("confirmWithRetry", () => {
  it("POSTs the confirm body once and succeeds", async () => {
    const calls = stubFetch([{ status: 200, json: {} }])
    expect(await run("draft-1", BODY)).toBeNull()
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe("/api/proposals/draft-1/confirm")
    expect(call?.init.method).toBe("POST")
    expect(JSON.parse(String(call?.init.body))).toEqual(BODY)
  })

  it("does not retry a verdict (4xx without retryable)", async () => {
    const calls = stubFetch([{ status: 422, json: { error: "Metadata hash does not match" } }])
    expect(await run("d", BODY)).toBe("Metadata hash does not match")
    expect(calls).toHaveLength(1)
  })

  it("retries a 409 marked retryable and a 5xx, then succeeds", async () => {
    const calls = stubFetch([
      { status: 409, json: { error: "Node behind", retryable: true } },
      { status: 503 },
      { status: 200, json: {} },
    ])
    expect(await run("d", BODY)).toBeNull()
    expect(calls).toHaveLength(3)
  })

  it("gives up after the last backoff with the last error", async () => {
    const calls = stubFetch([
      new TypeError("Failed to fetch"),
      { status: 502 },
      { status: 503, json: { error: "RPC unreachable" } },
      { status: 503, json: { error: "RPC still unreachable" } },
    ])
    expect(await run("d", BODY)).toBe("RPC still unreachable")
    expect(calls).toHaveLength(4)
  })

  it("reports the status when a failing response has no error text", async () => {
    stubFetch([{ status: 400 }])
    expect(await run("d", BODY)).toBe("Server responded 400.")
  })

  it("signs in again once on a 401 and retries right away", async () => {
    const calls = stubFetch([{ status: 401 }, { status: 200, json: {} }])
    const reauth = vi.fn(async () => true)
    expect(await run("d", BODY, reauth)).toBeNull()
    expect(reauth).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
  })

  it("does not loop when signing in again fails or the 401 repeats", async () => {
    stubFetch([{ status: 401, json: { error: "Sign in again" } }])
    expect(await run("d", BODY, async () => false)).toBe("Sign in again")

    stubFetch([{ status: 401 }, { status: 401, json: { error: "Still signed out" } }])
    const reauth = vi.fn(async () => true)
    expect(await run("d", BODY, reauth)).toBe("Still signed out")
    expect(reauth).toHaveBeenCalledTimes(1)
  })
})
