import type { Page, Route } from "@playwright/test"
import { expect, test } from "./support/test"

test.use({ moderationRole: "admin", viewport: { width: 1280, height: 900 } })

type Backup = { key: string; size: number; created: string }

const OLD: Backup = {
  key: `backups/2026-09-20T08:00:00Z-${"a".repeat(32)}.zip`,
  size: 3 * 1024 * 1024,
  created: "2026-09-20T08:00:00.000Z",
}
const NEW: Backup = {
  key: `backups/2026-09-26T09:00:00Z-${"b".repeat(32)}.zip`,
  size: 42 * 1024 * 1024,
  created: "2026-09-26T09:00:00.000Z",
}

/**
 * The backup routes, answered in the browser: a list, a creation that
 * runs until `finish()` is called (showing progress meanwhile), and deletes.
 */
async function mockBackups(page: Page) {
  const items: Backup[] = [OLD]
  let running: Record<string, unknown> | null = null
  const created: unknown[] = []
  let finish = () => {}
  const finished = new Promise<void>((resolve) => (finish = resolve))

  await page.route(/\/api\/moderation\/status$/, (route) =>
    route.fulfill({
      json: {
        ok: true,
        checked_at: "2026-09-26T09:00:00.000Z",
        production: false,
        sections: [],
        health: null,
        can_send_test: false,
      },
    }),
  )
  await page.route(/\/api\/moderation\/backup$/, async (route: Route) => {
    const req = route.request()
    if (req.method() === "GET") {
      return route.fulfill({ json: { ok: true, items, running, keep: 5 } })
    }
    if (req.method() === "POST") {
      created.push(req.postDataJSON())
      running = {
        phase: "files",
        done: 3,
        total: 12,
        bytes: 5 * 1024 * 1024,
        include_media: true,
        started_at: new Date().toISOString(),
      }
      await finished
      running = null
      items.unshift(NEW)
      return route.fulfill({ json: { ok: true, backup: NEW } })
    }
    if (req.method() === "DELETE") {
      const { key } = req.postDataJSON() as { key: string }
      items.splice(
        items.findIndex((i) => i.key === key),
        1,
      )
      return route.fulfill({ json: { ok: true } })
    }
    return route.fulfill({ status: 405, json: { ok: false } })
  })
  return { created, finish: () => finish() }
}

async function openBackup(page: Page) {
  await page.goto("/moderation")
  await page.getByRole("button", { name: "Status", exact: true }).click({ timeout: 30_000 })
  const panel = page.getByRole("region", { name: "Backup", exact: true })
  await expect(panel).toBeVisible()
  return panel
}

test("An admin creates a backup with progress, then downloads and deletes backups", async ({
  page,
}) => {
  const api = await mockBackups(page)
  const panel = await openBackup(page)

  await expect(panel.getByText("The ZIP contains personal data")).toBeVisible()
  await expect(panel.getByRole("listitem")).toHaveCount(1)
  await expect(panel.getByRole("listitem")).toContainText("2026-09-20 08:00 UTC")
  await expect(panel.getByRole("listitem")).toContainText("3.0 MB")

  await panel.getByRole("checkbox", { name: /Include uploaded files/ }).click()
  await panel.getByRole("button", { name: "Create backup" }).click()
  await expect(panel.getByRole("progressbar", { name: "Backup progress" })).toBeVisible()
  await expect(panel.getByText("Adding files · 3 of 12")).toBeVisible()
  await expect(panel.getByRole("button", { name: "Creating backup…" })).toBeDisabled()
  expect(api.created).toEqual([{ include_media: true }])

  api.finish()
  await expect(page.getByText("Backup created")).toBeVisible()
  await expect(panel.getByRole("progressbar")).toHaveCount(0)
  await expect(panel.getByRole("listitem")).toHaveCount(2)
  const newest = panel.getByRole("listitem").first()
  await expect(newest).toContainText("2026-09-26 09:00 UTC")
  await expect(newest).toContainText("42 MB")

  // A download is a plain link to the route that redirects to storage.
  await expect(
    panel.getByRole("link", { name: "Download the backup of 2026-09-26 09:00 UTC" }),
  ).toHaveAttribute("href", `/api/moderation/backup/download?key=${encodeURIComponent(NEW.key)}`)

  // Deleting asks once more.
  await panel.getByRole("button", { name: "Delete the backup of 2026-09-20 08:00 UTC" }).click()
  const sent = page.waitForRequest(
    (r) => r.method() === "DELETE" && new URL(r.url()).pathname === "/api/moderation/backup",
  )
  await panel.getByRole("button", { name: "Delete for good" }).click()
  expect((await sent).postDataJSON()).toEqual({ key: OLD.key })
  await expect(page.getByText("Backup deleted")).toBeVisible()
  await expect(panel.getByRole("listitem")).toHaveCount(1)
})

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 800 } })

  test("the backup section fits the screen", async ({ page }) => {
    await mockBackups(page)
    const panel = await openBackup(page)
    await expect(panel.getByRole("listitem")).toHaveCount(1)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    const box = (await panel.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
  })
})
