import { describe, expect, it } from "vitest"
import {
  PROPOSAL_SCHEMA_VERSION,
  REMARK_MAGIC,
  buildRemarkPayload,
  expectedMetadataHash,
  parseRemarkPayload,
  type ProposalJson,
} from "@/lib/governance/proposal-metadata"
import { hashCall } from "@/lib/governance/preimage"
import { stringToU8a } from "@polkadot/util"
import { stringifyStable } from "@/lib/r2/json"

describe("buildRemarkPayload", () => {
  it("starts with the EGOV1 magic prefix", () => {
    const payload = buildRemarkPayload("https://pub.example.com/p/abc/proposal.json", "deadbeef")
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

describe("expectedMetadataHash", () => {
  const url = "https://pub.example.com/p/abc/proposal.json"
  const sha = "6a1c2d46e6b22ee5e95816daebfc2a06ddb2b4297d9921c23c17b58b95c7078a"

  it("is the blake2-256 of the envelope bytes", () => {
    expect(expectedMetadataHash(url, sha)).toBe(hashCall(stringToU8a(buildRemarkPayload(url, sha))))
  })

  it("is NOT the sha256 that the envelope carries in h", () => {
    // The distinction the confirm check depends on: setMetadata binds the
    // envelope's blake2-256, while `h` commits to the off-chain JSON.
    expect(expectedMetadataHash(url, sha)).not.toBe(`0x${sha}`)
  })

  it("is deterministic and 32 bytes", () => {
    const a = expectedMetadataHash(url, sha)
    expect(a).toBe(expectedMetadataHash(url, sha))
    expect(a).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it("changes when either the url or the sha changes", () => {
    const base = expectedMetadataHash(url, sha)
    expect(expectedMetadataHash(`${url}?v=2`, sha)).not.toBe(base)
    expect(expectedMetadataHash(url, sha.replace(/a/g, "b"))).not.toBe(base)
  })
})

describe("backwards compatibility with pre-setMetadata remarks", () => {
  it("parses a legacy on-chain remark string verbatim", () => {
    // Frozen copy of the envelope shape emitted while the anchor was
    // system.remark. Referenda filed then must stay resolvable forever.
    const legacy =
      'EGOV1:{"u":"https://pub.example.com/p/abc/proposal.json","h":"0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0"}'
    expect(parseRemarkPayload(legacy)).toEqual({
      u: "https://pub.example.com/p/abc/proposal.json",
      h: "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
    })
  })

  it("builds an envelope byte-identical to the legacy remark output", () => {
    // The setMetadata change moves the anchor, not the envelope: the same
    // (url, sha256) must produce the same string the remark era produced,
    // so one decoder serves both bindings.
    const url = "https://pub.example.com/p/abc/proposal.json"
    const sha = "deadbeefdeadbeefdeadbeefdeadbeef"
    expect(buildRemarkPayload(url, sha)).toBe(`EGOV1:{"u":"${url}","h":"${sha}"}`)
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
