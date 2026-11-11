import { describe, expect, it } from "vitest"
import { backupCreatedAt, backupFileName, isBackupKey, newBackupKey } from "@/lib/backup/keys"
import { dollarTag, restoreSql, tableJson } from "@/lib/backup/restore-sql"

const RANDOM = "0123456789abcdef".repeat(2)
const KEY = `backups/2026-09-26T09:05:07Z-${RANDOM}.zip`

describe("backup keys", () => {
  it("name the start time and a random suffix, under backups/", () => {
    expect(newBackupKey(new Date("2026-09-26T09:05:07.891Z"), RANDOM)).toBe(KEY)
    expect(() => newBackupKey(new Date(), "../../x")).toThrow()
    expect(() => newBackupKey(new Date(), "0123456789abcdef")).toThrow()
    expect(backupCreatedAt(KEY)).toBe("2026-09-26T09:05:07.000Z")
    expect(backupFileName(KEY)).toBe("enjin-governance-backup-2026-09-26T09-05-07Z.zip")
  })

  it("accept exactly the shape they are created in", () => {
    expect(isBackupKey(KEY)).toBe(true)
    for (const bad of [
      undefined,
      null,
      42,
      "",
      "backups/",
      `${KEY}/`,
      `/${KEY}`,
      `x/${KEY}`,
      `${KEY}\n`,
      KEY.replace(".zip", ".sql"),
      KEY.replace(RANDOM, RANDOM.toUpperCase()),
      KEY.replace(RANDOM, RANDOM.slice(0, 16)),
      KEY.replace(RANDOM, "../../../../../../../../etc/pass"),
      KEY.replace("backups/", "backups/../"),
      "backups/../proposals/enjin-relay/x/proposal.json",
    ]) {
      expect(isBackupKey(bad), String(bad)).toBe(false)
    }
  })
})

describe("restore script", () => {
  it("picks a dollar-quote tag the data doesn't contain", () => {
    expect(dollarTag('[{"a":"b"}]')).toBe("$json$")
    expect(dollarTag("$json$")).toBe("$json1$")
    expect(dollarTag("$json$ $json1$ $json3$")).toBe("$json2$")
  })

  it("inserts listed columns only, skips generated ones, and reads NOT NULL JSON null as null", () => {
    const script = [
      ...restoreSql(
        [
          {
            name: "t",
            columns: [
              { name: "id", type: "uuid", notNull: true, generated: false },
              { name: "doc", type: "jsonb", notNull: true, generated: false },
              { name: "extra", type: "jsonb", notNull: false, generated: false },
              { name: "total", type: "integer", notNull: false, generated: true },
            ],
            rows: ['{"id":"1","doc":null,"extra":null,"total":3}'],
          },
          { name: "empty", columns: [], rows: [] },
        ],
        { createdAt: "2026-09-26T09:05:07.000Z", appVersion: "1.2.3" },
      ),
    ].join("")
    expect(script).toContain(`INSERT INTO "t" ("id", "doc", "extra")
SELECT r."id", COALESCE(r."doc", 'null'::jsonb), r."extra"
FROM json_populate_recordset(NULL::"t", $json$${tableJson(['{"id":"1","doc":null,"extra":null,"total":3}'])}$json$) AS r
ON CONFLICT DO NOTHING;`)
    expect(script).toContain("-- empty: no rows")
    expect(script).toMatch(/^-- Enjin Governance backup/)
    expect(script.indexOf("BEGIN;")).toBeLessThan(script.indexOf("INSERT"))
    expect(script.trimEnd().endsWith("COMMIT;")).toBe(true)
  })
})
