/**
 * Answers every /api/* and /r/* request inside the browser, so the tests
 * need no database, bucket or outside service. Only the chain is real.
 */
import type { Page, Request, Route } from "@playwright/test"
import {
  ATTACHMENTS,
  ME,
  NETWORK,
  OTHER,
  PROPOSAL_ID,
  PROPOSAL_JSON_TEXT,
  PROPOSAL_METADATA,
  QUEUE,
  REFERENDUM,
  fixture,
} from "./data"

export type ModerationRole = "moderator" | "admin" | null

type MockOptions = {
  signedIn: boolean
  role: ModerationRole
}

/** One file that reached the upload endpoint, as the server would see it. */
type ReceivedUpload = {
  name: string
  contentType: string
  bytes: Buffer
}

export type ApiMocks = {
  /** Files posted to /api/proposals/<id>/media, in order. */
  uploads: ReceivedUpload[]
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

export async function installApiMocks(page: Page, opts: MockOptions): Promise<ApiMocks> {
  const mocks: ApiMocks = { uploads: [] }
  const uploaded = new Map<string, ReceivedUpload>()

  await page.route(/^https?:\/\/[^/]+\/r\//, (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.slice(3))
    if (key.endsWith("/proposal.json")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: PROPOSAL_JSON_TEXT,
      })
    }
    const thumb = key.endsWith(".thumb.webp")
    const base = thumb ? key.slice(0, -".thumb.webp".length) : key
    const att = ATTACHMENTS.find((a) => a.key === base)
    if (att) {
      const file = thumb ? `${att.file}.thumb.webp` : att.file
      if (thumb && !att.content_type.startsWith("image/")) return json(route, { ok: false }, 404)
      return route.fulfill({
        status: 200,
        contentType: thumb ? "image/webp" : att.content_type,
        body: fixture(file),
      })
    }
    const up = uploaded.get(base)
    if (up && !thumb)
      return route.fulfill({ status: 200, contentType: up.contentType, body: up.bytes })
    return json(route, { ok: false, error: "Not found" }, 404)
  })

  await page.route(/^https?:\/\/[^/]+\/api\//, (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const p = url.pathname
    const method = req.method()

    if (p === "/api/auth/me") {
      return opts.signedIn
        ? json(route, {
            ok: true,
            user: {
              id: "me",
              address: ME,
              handle: "tester",
              display_name: null,
              bio: null,
              avatar_url: null,
            },
          })
        : json(route, { ok: false }, 401)
    }
    // Signing in would ask the fake wallet for a signature: never needed here.
    if (p === "/api/auth/nonce")
      return json(route, { ok: false, error: "Sign-in is off in tests" }, 503)
    if (p === "/api/moderation/me") return json(route, { ok: true, role: opts.role })

    if (p === `/api/proposals/by-index/${REFERENDUM}`) return json(route, PROPOSAL_METADATA)
    if (p.startsWith("/api/proposals/by-index/")) return json(route, { ok: false }, 404)
    if (p === "/api/proposals/by-indices")
      return json(route, { ok: true, proposals: [PROPOSAL_METADATA] })
    if (p.startsWith("/api/proposals/by-proposer/")) return json(route, { ok: true, items: [] })
    if (p === `/api/proposals/${PROPOSAL_ID}/json`) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: PROPOSAL_JSON_TEXT,
        headers: { "x-proposal-status": "on_chain" },
      })
    }
    if (p === `/api/proposals/${PROPOSAL_ID}/comments`) return json(route, { ok: true, items: [] })

    const media = /^\/api\/proposals\/([0-9a-f-]{36})\/media$/.exec(p)
    if (media && method === "POST") {
      const file = readMultipartFile(req)
      if (!file) return json(route, { ok: false, error: "No file" }, 400)
      mocks.uploads.push(file)
      const network = url.searchParams.get("network") ?? NETWORK
      const stored = `${String(mocks.uploads.length).padStart(8, "0")}-${file.name}`
      const key = `proposals/${network}/${media[1]}/media/${stored}`
      uploaded.set(key, file)
      return json(route, {
        ok: true,
        bucket_key: key,
        url: `${url.origin}/r/${key}`,
        sha256: "0".repeat(64),
        size_bytes: file.bytes.length,
        content_type: file.contentType,
        name: file.name,
        moderation: null,
      })
    }

    if (p === "/api/moderation/state") return json(route, { ok: true, items: [] })
    if (p === "/api/moderation/reports" && method === "POST")
      return json(route, { ok: true, duplicate: false })
    if (p === "/api/moderation/queue") {
      return opts.role
        ? json(route, { ...QUEUE, role: opts.role })
        : json(route, { ok: false }, 403)
    }
    if (p === "/api/moderation/actions" && method === "POST") return json(route, { ok: true })
    if (p === "/api/moderation/log") return json(route, { ok: true, items: [] })

    if (p === "/api/users/by-addresses") {
      return json(route, {
        ok: true,
        users: [
          {
            id: "u1",
            address: OTHER,
            handle: "alice",
            display_name: "Alice",
            bio: null,
            avatar_url: null,
            is_verified: false,
            created_at: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "me",
            address: ME,
            handle: "tester",
            display_name: null,
            bio: null,
            avatar_url: null,
            is_verified: false,
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      })
    }
    return json(route, { ok: false, error: "Not mocked in the e2e tests" }, 404)
  })

  return mocks
}

/** The first file part of a multipart/form-data request body. */
function readMultipartFile(req: Request): ReceivedUpload | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers()["content-type"] ?? "")
  const body = req.postDataBuffer()
  if (!boundary || !body) return null
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`)
  let start = body.indexOf(delimiter)
  while (start !== -1) {
    const headersEnd = body.indexOf("\r\n\r\n", start)
    if (headersEnd === -1) return null
    const headers = body.subarray(start + delimiter.length, headersEnd).toString("utf8")
    const next = body.indexOf(delimiter, headersEnd)
    if (next === -1) return null
    const name = /filename="([^"]*)"/i.exec(headers)?.[1]
    if (name != null) {
      return {
        name,
        contentType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "",
        // The part ends with CRLF before the next delimiter.
        bytes: Buffer.from(body.subarray(headersEnd + 4, next - 2)),
      }
    }
    start = next
  }
  return null
}
