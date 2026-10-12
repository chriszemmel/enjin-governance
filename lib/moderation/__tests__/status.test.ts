/**
 * The Status tab's checklist: every check's ok / warning / problem states,
 * from plain inputs. The route and what it may reveal are tested in
 * lib/__sec__/moderation-status-routes.test.ts.
 */
import { describe, expect, it } from "vitest"
import { DEFAULT_SCAN_SETTINGS } from "@/lib/moderation/scan-settings"
import {
  buildStatus,
  formatUtc,
  isLocalUrl,
  type StatusInputs,
  type StatusLevel,
} from "@/lib/moderation/status"

type Overrides = { [K in keyof StatusInputs]?: Partial<StatusInputs[K]> } & {
  production?: boolean
  walletConnect?: boolean
}

/** A fully set-up production deployment, with some parts replaced. */
function inputs(o: Overrides = {}): StatusInputs {
  return {
    production: o.production ?? true,
    database: {
      configured: true,
      reachable: true,
      schema: {
        moderation: true,
        settings: true,
        keepState: true,
        ledger: [
          "011_moderation.sql",
          "012_moderation_settings.sql",
          "013_moderation_keep_state.sql",
          "014_drop_proposer_signature.sql",
        ],
      },
      ...o.database,
    },
    storage: { configured: true, missing: [], ...o.storage },
    appUrl: { value: "https://gov.example", set: true, refused: false, ...o.appUrl },
    rateLimit: { shared: true, ...o.rateLimit },
    telegram: { token: true, securityChat: true, moderationChat: "own", ...o.telegram },
    scan: {
      apiKey: true,
      settings: { ...DEFAULT_SCAN_SETTINGS, enabled: true },
      savedModel: "claude-haiku-5-5",
      checksToday: 12,
      health: { state: "ok" },
      ...o.scan,
    },
    legal: { name: true, email: "set", address: true, ...o.legal },
    walletConnect: o.walletConnect ?? true,
  }
}

function find(o: Overrides, id: string) {
  const report = buildStatus(inputs(o))
  const found = report.sections.flatMap((s) => s.items).find((i) => i.id === id)
  if (!found) throw new Error(`no item ${id}`)
  return found
}
const level = (o: Overrides, id: string): StatusLevel => find(o, id).level
const hint = (o: Overrides, id: string): string => find(o, id).hint

describe("a fully set-up deployment", () => {
  it("is all ok, in sections, with nothing to warn about", () => {
    const report = buildStatus(inputs())
    expect(report.sections.map((s) => s.id)).toEqual([
      "database",
      "storage",
      "rate-limit",
      "telegram",
      "scan",
      "legal",
      "wallet",
    ])
    const items = report.sections.flatMap((s) => s.items)
    expect(items.filter((i) => i.level !== "ok")).toEqual([])
    for (const i of items) {
      expect(i.label.length).toBeGreaterThan(0)
      expect(i.hint.length).toBeGreaterThan(0)
    }
    expect(report.health).toBeNull()
    expect(report.can_send_test).toBe(true)
    expect(report.production).toBe(true)
  })
})

describe("database", () => {
  it("is a problem when not set up or not reachable", () => {
    expect(level({ database: { configured: false, reachable: false } }, "database")).toBe("problem")
    expect(hint({ database: { configured: false, reachable: false } }, "database")).toContain(
      "DATABASE_URL",
    )
    expect(level({ database: { reachable: false, schema: null } }, "database")).toBe("problem")
  })

  it("can't judge the migrations without the database", () => {
    for (const id of ["migration-011", "migration-012", "migration-013"]) {
      expect(level({ database: { reachable: false, schema: null } }, id)).toBe("warning")
    }
  })

  it("judges migrations by their tables; a missing ledger means applied by hand", () => {
    const schema = (over: object) => ({
      database: {
        schema: {
          moderation: true,
          settings: true,
          keepState: true,
          ledger: null as string[] | null,
          ...over,
        },
      },
    })
    expect(level(schema({}), "migration-012")).toBe("ok")
    expect(hint(schema({}), "migration-012")).toContain("by hand")
    expect(hint(schema({ ledger: ["011_moderation.sql"] }), "migration-011")).toBe("Applied.")
    expect(level(schema({ settings: false }), "migration-012")).toBe("problem")
    expect(hint(schema({ settings: false }), "migration-012")).toContain("pnpm db:migrate")
    expect(level(schema({ keepState: false }), "migration-013")).toBe("problem")
    // Listed in the ledger, but the tables are gone.
    const gone = schema({ moderation: false, ledger: ["011_moderation.sql"] })
    expect(level(gone, "migration-011")).toBe("problem")
    expect(hint(gone, "migration-011")).toContain("tables are missing")
  })

  it("reminds about migration 014 until the ledger lists it, without calling it a problem", () => {
    const schema = (ledger: string[] | null) => ({
      database: { schema: { moderation: true, settings: true, keepState: true, ledger } },
    })
    expect(level(schema(["013_keep_state.sql"]), "migration-014")).toBe("warning")
    expect(hint(schema(["013_keep_state.sql"]), "migration-014")).toContain(
      "every deployment runs 2.0",
    )
    expect(level(schema(null), "migration-014")).toBe("warning")
    expect(level(schema(["014_drop_proposer_signature.sql"]), "migration-014")).toBe("ok")
    expect(() => level({ database: { reachable: false, schema: null } }, "migration-014")).toThrow(
      "no item migration-014",
    )
  })
})

describe("storage and links", () => {
  it("names the missing storage settings", () => {
    const o = { storage: { configured: false, missing: ["R2_ENDPOINT", "R2_PUBLIC_URL"] } }
    expect(level(o, "storage")).toBe("problem")
    expect(hint(o, "storage")).toContain("R2_ENDPOINT, R2_PUBLIC_URL")
  })

  it("won't let a localhost base be pinned on chain in production", () => {
    const local = { appUrl: { value: "http://localhost:3000", set: false } }
    expect(level(local, "app-url")).toBe("problem")
    expect(level({ appUrl: { value: "http://127.0.0.1:3000" } }, "app-url")).toBe("problem")
    expect(level({ appUrl: { value: "https://gov.example", set: false } }, "app-url")).toBe(
      "problem",
    )
    expect(
      hint({ appUrl: { value: "http://localhost:3000", refused: true } }, "app-url"),
    ).toContain("uploads and new proposals are refused")
    // Outside production, localhost is how development works.
    expect(level({ ...local, production: false }, "app-url")).toBe("ok")
  })

  it("wants https in production and shows only the origin", () => {
    expect(level({ appUrl: { value: "http://gov.example" } }, "app-url")).toBe("warning")
    const o = { appUrl: { value: "https://admin:hunter2@gov.example/some/path?x=1" } }
    expect(level(o, "app-url")).toBe("ok")
    expect(hint(o, "app-url")).toBe("File links use https://gov.example/r.")
  })
})

describe("rate limits", () => {
  it("warns about a per-instance store in production only", () => {
    expect(level({ rateLimit: { shared: false } }, "rate-limit")).toBe("warning")
    expect(hint({ rateLimit: { shared: false } }, "rate-limit")).toContain("KV_REST_API_URL")
    expect(level({ rateLimit: { shared: false }, production: false }, "rate-limit")).toBe("ok")
  })
})

describe("telegram", () => {
  it("warns about a missing token or chat, and only offers the test when it can go", () => {
    expect(level({ telegram: { token: false } }, "telegram-token")).toBe("warning")
    expect(level({ telegram: { token: false } }, "telegram-moderation")).toBe("warning")
    expect(buildStatus(inputs({ telegram: { token: false } })).can_send_test).toBe(false)
    expect(level({ telegram: { securityChat: false } }, "telegram-chat")).toBe("warning")
    expect(hint({ telegram: { moderationChat: "security" } }, "telegram-moderation")).toContain(
      "security chat",
    )
    expect(buildStatus(inputs({ telegram: { moderationChat: "security" } })).can_send_test).toBe(
      true,
    )
    for (const chat of ["off", "none"] as const) {
      expect(level({ telegram: { moderationChat: chat } }, "telegram-moderation")).toBe("warning")
      expect(buildStatus(inputs({ telegram: { moderationChat: chat } })).can_send_test).toBe(false)
    }
  })
})

describe("automatic checks", () => {
  const settings = (over: object) => ({
    scan: { settings: { ...DEFAULT_SCAN_SETTINGS, enabled: true, ...over } },
  })

  it("needs the API key once checks are on", () => {
    expect(level({ scan: { apiKey: false } }, "scan-key")).toBe("problem")
    expect(
      level({ scan: { apiKey: false, ...settings({ enabled: false }).scan } }, "scan-key"),
    ).toBe("warning")
  })

  it("says whether checks run, and on what", () => {
    expect(hint({}, "scan-enabled")).toBe("On for images, PDFs, proposal text, comments.")
    expect(level(settings({ enabled: false }), "scan-enabled")).toBe("warning")
    expect(
      level(
        settings({ images: false, pdfs: false, proposals: false, comments: false }),
        "scan-enabled",
      ),
    ).toBe("warning")
    expect(level({ scan: { settings: null } }, "scan-enabled")).toBe("warning")
  })

  it("flags a saved model that is no longer offered", () => {
    expect(hint({}, "scan-model")).toBe("Claude Haiku 5.5, offered.")
    const retired = { scan: { savedModel: "claude-haiku-3" } }
    expect(level(retired, "scan-model")).toBe("warning")
    expect(hint(retired, "scan-model")).toContain("claude-haiku-3")
  })

  it("compares today's checks with the daily limit", () => {
    expect(hint({}, "scan-today")).toBe("12 of 300.")
    expect(level({ scan: { checksToday: 250 } }, "scan-today")).toBe("warning")
    expect(level({ scan: { checksToday: 300 } }, "scan-today")).toBe("warning")
    expect(hint({ scan: { checksToday: 300 } }, "scan-today")).toContain("Daily limit reached")
    expect(level({ scan: { checksToday: null } }, "scan-today")).toBe("warning")
    // Checks off: a full counter is history, not a warning.
    expect(
      level({ scan: { checksToday: 300, ...settings({ enabled: false }).scan } }, "scan-today"),
    ).toBe("ok")
  })

  it("shows a recorded failure, for the list and for the banner", () => {
    const health = {
      state: "failing" as const,
      problem: "The Anthropic account is out of credit.",
      first_seen: "2026-09-26T09:12:30.000Z",
      last_seen: "2026-09-26T10:40:00.000Z",
    }
    expect(level({ scan: { health } }, "scan-health")).toBe("problem")
    expect(hint({ scan: { health } }, "scan-health")).toBe(
      "The Anthropic account is out of credit. Since 2026-09-26 09:12 UTC, last seen 2026-09-26 10:40 UTC. Uploads are posted without a check.",
    )
    expect(buildStatus(inputs({ scan: { health } })).health).toEqual({
      problem: health.problem,
      first_seen: health.first_seen,
      last_seen: health.last_seen,
    })
    expect(level({ scan: { health: null } }, "scan-health")).toBe("warning")
  })
})

describe("legal pages and wallets", () => {
  it("need the operator's name and email in production; the address is optional", () => {
    expect(level({ legal: { name: false } }, "legal-name")).toBe("problem")
    expect(level({ legal: { name: false }, production: false }, "legal-name")).toBe("warning")
    expect(level({ legal: { email: "missing" } }, "legal-email")).toBe("problem")
    expect(level({ legal: { email: "invalid" }, production: false }, "legal-email")).toBe("warning")
    expect(level({ legal: { address: false } }, "legal-address")).toBe("ok")
  })

  it("need the WalletConnect project id for Enjin Wallet", () => {
    expect(level({ walletConnect: false }, "walletconnect")).toBe("problem")
    expect(level({ walletConnect: false, production: false }, "walletconnect")).toBe("warning")
  })
})

describe("helpers", () => {
  it("spot local addresses", () => {
    for (const url of [
      "http://localhost:3000",
      "http://LOCALHOST",
      "http://app.localhost",
      "http://127.0.0.1:3000",
      "http://0.0.0.0:3000",
      "http://[::1]:3000",
      "not a url",
    ]) {
      expect(isLocalUrl(url)).toBe(true)
    }
    expect(isLocalUrl("https://gov.example")).toBe(false)
    expect(isLocalUrl("https://localhost.example.com")).toBe(false)
  })

  it("write times in UTC", () => {
    expect(formatUtc("2026-09-26T23:59:59.999Z")).toBe("2026-09-26 23:59 UTC")
    expect(formatUtc("garbage")).toBe("an unknown time")
  })
})
