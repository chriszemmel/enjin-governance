/**
 * Test data for the browser tests. Chain reads go to the real Canary Relay
 * (referendum 13 is a concluded, approved referendum there); everything the
 * app would read from its database or bucket is made up here.
 */
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

export const NETWORK = "canary-relay"
/** Concluded and approved on Canary; its on-chain state no longer changes. */
export const REFERENDUM = 13
export const PROPOSAL_ID = "7d9c2f4e-1b3a-4c5d-9e8f-0a1b2c3d4e5f"
export const PROPOSAL_PATH = `/proposals/${REFERENDUM}?network=${NETWORK}`

/** The fake wallet's address: a random throwaway key, nothing is ever signed. */
export const ME = "cnSWX418aRiAqxBfE35gEkUH9f16RQfGjSXF4jMAY9XAxnKrq"
/** The same key in Canary Matrixchain format (SS58 prefix 9030). */
export const ME_MATRIX = "cxKSpeDjVUWkoQzi9hnmb8gcDe3FXqocG7e64e1qLzB3EeGfH"
export const OTHER = "cnTfU9odSe157jiEmsDGsQgBanpTXcDa2GJSJSB2oEdgMnwL9"
export const MULTISIG = "cnTxmnXAtb5WE48CVU3RKAsdAbgPFhUtQQwjskwLi69N14WBY"

const FIXTURES = path.join(__dirname, "..", "fixtures")
export const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name))

const sha256 = (buf: Buffer | string) => createHash("sha256").update(buf).digest("hex")

/** Same bytes as the app's stringifyStable: keys sorted at every level. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.keys(val)
            .sort()
            .map((k) => [k, (val as Record<string, unknown>)[k]]),
        )
      : val,
  )
}

type Attachment = {
  /** Bucket key inside this proposal's media folder. */
  key: string
  /** File in e2e/fixtures served for it. */
  file: string
  name: string
  content_type: string
  size_bytes: number
  sha256: string
  url: string
}

function attachment(stored: string, file: string, contentType: string): Attachment {
  const key = `proposals/${NETWORK}/${PROPOSAL_ID}/media/${stored}`
  const buf = fixture(file)
  return {
    key,
    file,
    name: file,
    content_type: contentType,
    size_bytes: buf.length,
    sha256: sha256(buf),
    // The origin doesn't matter: the app keeps only the key and loads /r/<key>.
    url: `http://localhost:3100/r/${key}`,
  }
}

export const ATTACHMENTS = [
  attachment("ab12cd34-roadmap-q4.png", "roadmap-q4.png", "image/png"),
  attachment("9a8b7c6d-budget.pdf", "budget.pdf", "application/pdf"),
]

export const TITLE = "Community tooling fund: Q4 2026"
export const SUMMARY =
  "Funds three milestones of shared governance tooling. Paid to the community multisig after each milestone report."

const BODY = `## Motivation

Community tools for Enjin governance need a **shared**, maintained home. Funds are sent to the community multisig ${MULTISIG} which is controlled by three signers.

![Roadmap Q4 2026](${ATTACHMENTS[0].url})

## Milestones

| Milestone | Month | Amount |
|---|---|---|
| M1 Research | Oct | 25,000 cENJ |
| M2 Build | Nov | 40,000 cENJ |
| M3 Audit + launch | Dec | 35,000 cENJ |

## Signers

- Alice: ${OTHER}
- Bob: ${ME}
`

const PROPOSAL_JSON = {
  schema: "enjin-governance-proposal",
  version: "1.1.0",
  network: NETWORK,
  proposer: ME,
  title: TITLE,
  summary: SUMMARY,
  body_markdown: BODY,
  track: "SmallSpender",
  spend: { beneficiary: MULTISIG, amount_planck: "100000000000000000000000" },
  attachments: ATTACHMENTS.map(({ name, url, sha256, content_type, size_bytes }) => ({
    name,
    url,
    sha256,
    content_type,
    size_bytes,
  })),
  preimage_hash: null,
  preimage_len: null,
  created_at: "2026-09-20T10:00:00.000Z",
  signature: null,
}

/** proposal.json exactly as stored: its sha256 is what "Verified" checks. */
export const PROPOSAL_JSON_TEXT = stableJson(PROPOSAL_JSON)

export const PROPOSAL_METADATA = {
  ok: true,
  id: PROPOSAL_ID,
  network: NETWORK,
  referendum_index: REFERENDUM,
  title: TITLE,
  summary: SUMMARY,
  body_markdown: BODY,
  track: "SmallSpender",
  beneficiary: MULTISIG,
  amount_planck: PROPOSAL_JSON.spend.amount_planck,
  proposer_address: ME,
  json_url: `http://localhost:3100/r/proposals/${NETWORK}/${PROPOSAL_ID}/proposal.json`,
  json_sha256: sha256(PROPOSAL_JSON_TEXT),
  status: "on_chain",
  edited_at: null,
  edit_count: 0,
  withdrawn_at: null,
  withdrawn_reason: null,
  created_at: "2026-09-20T10:00:00.000Z",
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

export const QUEUE_ITEMS = {
  /** Flagged by the automatic check: its explanation pre-fills the reason. */
  automatic: {
    target_type: "comment",
    target_id: "c2",
    proposal_id: PROPOSAL_ID,
    reports: 1,
    user_reports: 0,
    automatic: true,
    severity: "low",
    categories: ["scam"],
    notes: [],
    details: [
      {
        decision: "review",
        labels: ["scam_phishing"],
        explanation: "Asks readers to verify their wallet on an outside site.",
      },
    ],
    first_at: ago(1500),
    last_at: ago(1500),
    state: null,
    state_reason: null,
    network: NETWORK,
    referendum_index: REFERENDUM,
    proposal_title: TITLE,
    proposer_address: ME,
    attachment_name: null,
    attachment_type: null,
    comment_body: "Claim the bonus airdrop now at enjin-bonus.example, just verify your wallet.",
    comment_author: MULTISIG,
  },
  /** Reported by users only: the reason starts empty. */
  reported: {
    target_type: "proposal",
    target_id: "00000000-0000-4000-8000-000000000012",
    proposal_id: "00000000-0000-4000-8000-000000000012",
    reports: 1,
    user_reports: 1,
    automatic: false,
    severity: "medium",
    categories: ["scam"],
    notes: ["Links to an outside site."],
    details: [],
    first_at: ago(300),
    last_at: ago(300),
    state: null,
    state_reason: null,
    network: NETWORK,
    referendum_index: 12,
    proposal_title: "Liquidity incentive pilot",
    proposer_address: OTHER,
    attachment_name: null,
    attachment_type: null,
    comment_body: null,
    comment_author: null,
  },
}

export const QUEUE = {
  ok: true,
  role: "admin",
  stats: { open: 2, auto_blurred_today: 0 },
  items: [QUEUE_ITEMS.automatic, QUEUE_ITEMS.reported],
}
