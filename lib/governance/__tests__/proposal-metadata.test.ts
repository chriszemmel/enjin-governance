import { describe, expect, it } from "vitest"
import {
  PROPOSAL_SCHEMA_VERSION,
  REMARK_MAGIC,
  buildRemarkPayload,
  parseRemarkPayload,
  type ProposalJson,
} from "@/lib/governance/proposal-metadata"
import { stringifyStable } from "@/lib/r2/json"

describe("buildRemarkPayload", () => {
  it("starts with the EGOV1 magic prefix", () => {
    const payload = buildRemarkPayload(
      "https://pub.example.com/p/abc/proposal.json",
      "deadbeef",
    )
    expect(payload.startsWith(REMARK_MAGIC)).toBe(true)
  })

  it("round-trips through parseRemarkPayload", () => {
    const url = "https://pub.example.com/p/abc/proposal.json"
    const sha = "deadbeefdeadbeefdeadbeefdeadbeef"
    const env = parseRemarkPayload(buildRemarkPayload(url, sha))
    expect(env).toEqual({ u: url, h: sha })
  })

  it("rejects payloads without the magic prefix", () => {
    expect(parseRemarkPayload('{"u":"x","h":"y"}')).toBeNull()
  })

  it("rejects malformed JSON after the magic prefix", () => {
    expect(parseRemarkPayload(`${REMARK_MAGIC}not-json`)).toBeNull()
  })
})

describe("ProposalJson edit fields", () => {
  it("schema version is at 1.1.0 once edit fields land", () => {
    expect(PROPOSAL_SCHEMA_VERSION).toBe("1.1.0")
  })

  it("edited_at + edit_count are optional so unedited payloads omit them", () => {
    const minimal: ProposalJson = {
      schema: "enjin-governance-proposal",
      version: PROPOSAL_SCHEMA_VERSION,
      network: "enjin-relay",
      proposer: "en1",
      title: "x",
      summary: null,
      body_markdown: "",
      track: null,
      spend: null,
      attachments: [],
      preimage_hash: null,
      preimage_len: null,
      created_at: "2024-01-01T00:00:00.000Z",
      signature: null,
    }
    expect(minimal.edited_at).toBeUndefined()
    expect(minimal.edit_count).toBeUndefined()
  })

  it("an edited payload sets edited_at and edit_count", () => {
    const edited: ProposalJson = {
      schema: "enjin-governance-proposal",
      version: PROPOSAL_SCHEMA_VERSION,
      network: "enjin-relay",
      proposer: "en1",
      title: "edited",
      summary: null,
      body_markdown: "new body",
      track: null,
      spend: null,
      attachments: [],
      preimage_hash: null,
      preimage_len: null,
      created_at: "2024-01-01T00:00:00.000Z",
      edited_at: "2024-02-01T00:00:00.000Z",
      edit_count: 1,
      signature: null,
    }
    expect(edited.edit_count).toBe(1)
    expect(edited.edited_at).toBe("2024-02-01T00:00:00.000Z")
  })
})

describe("stringifyStable", () => {
  it("orders keys lexicographically at every level", () => {
    const out = stringifyStable({ b: 1, a: { y: 2, x: 1 } })
    expect(out).toBe('{"a":{"x":1,"y":2},"b":1}')
  })

  it("produces identical output for input objects with shuffled keys", () => {
    const a = stringifyStable({ title: "x", proposer: "en1", body: "" })
    const b = stringifyStable({ body: "", proposer: "en1", title: "x" })
    expect(a).toBe(b)
  })
})
