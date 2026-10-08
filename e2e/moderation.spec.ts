import { ME, QUEUE_ITEMS } from "./support/data"
import type { Page } from "@playwright/test"
import { u8aToHex } from "@polkadot/util"
import { decodeAddress } from "@polkadot/util-crypto"
import { expect, test } from "./support/test"

test.use({ moderationRole: "admin", viewport: { width: 1280, height: 900 } })

test("Hide in the moderation queue needs a reason and posts it", async ({ page }) => {
  await page.goto("/moderation")

  // The first item opens by itself, its reason taken from the automatic check.
  const reason = page.getByPlaceholder("Reason (public)")
  await expect(reason).toHaveValue(QUEUE_ITEMS.automatic.details[0].explanation, {
    timeout: 30_000,
  })

  // A user report comes without a reason.
  const item = QUEUE_ITEMS.reported
  await page.getByRole("button", { name: new RegExp(item.proposal_title) }).click()
  await expect(page.getByRole("heading", { level: 2, name: item.proposal_title })).toBeVisible()
  await expect(reason).toHaveValue("")

  await page.getByRole("button", { name: "Hide", exact: true }).click()
  const apply = page.getByRole("button", { name: "Apply · Hide" })
  await expect(apply).toBeDisabled()
  await reason.fill("   ")
  await expect(apply).toBeDisabled()
  await reason.fill("ok")
  await expect(apply).toBeDisabled()

  const text = "Sends readers to a phishing site."
  await reason.fill(`  ${text} `)
  await expect(apply).toBeEnabled()
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/moderation/actions",
  )
  await apply.click()
  expect((await sent).postDataJSON()).toEqual({
    target_type: item.target_type,
    target_id: item.target_id,
    action: "hide",
    reason: text,
  })
  await expect(page.getByText("Hide - logged publicly")).toBeVisible()
})

test.describe("the Moderation menu entry", () => {
  test.use({ viewport: { width: 1280, height: 900 } })
  const entry = (page: Page) => page.getByRole("link", { name: "Moderation", exact: true })
  // The links live in the menu, which also lists Treasury.
  const openMenu = async (page: Page) => {
    await page.goto("/proposals")
    await page.getByRole("button", { name: "Open menu" }).first().click()
    await expect(page.getByRole("link", { name: "Treasury", exact: true })).toBeVisible({
      timeout: 30_000,
    })
  }
  const hintKey = "enjin-governance:moderator-wallets"
  const remembered = (page: Page) =>
    page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "[]") as string[], hintKey)

  test.describe("a moderator, signed in", () => {
    test.use({ signedIn: true, moderationRole: "moderator" })
    test("shows, and this device remembers the wallet", async ({ page }) => {
      await openMenu(page)
      await expect(entry(page)).toBeVisible({ timeout: 30_000 })
      await expect.poll(() => remembered(page)).toEqual([u8aToHex(decodeAddress(ME))])
    })
  })

  test.describe("a remembered moderator's wallet, not signed in", () => {
    test.use({ signedIn: false, moderationRole: null })
    test("shows before signing in", async ({ page }) => {
      await page.addInitScript(
        ([k, v]) => localStorage.setItem(k, v),
        [hintKey, JSON.stringify([u8aToHex(decodeAddress(ME))])],
      )
      await openMenu(page)
      await expect(entry(page)).toBeVisible({ timeout: 30_000 })
    })
  })

  test.describe("a wallet this device doesn't know, not signed in", () => {
    test.use({ signedIn: false, moderationRole: "moderator" })
    test("does not show, and the server is not asked", async ({ page }) => {
      const asked: string[] = []
      page.on("request", (r) => {
        if (new URL(r.url()).pathname.startsWith("/api/moderation/")) asked.push(r.url())
      })
      await openMenu(page)
      await expect(entry(page)).toHaveCount(0)
      expect(asked).toEqual([])
    })
  })

  test.describe("a signed-in user without a role", () => {
    test.use({ signedIn: true, moderationRole: null })
    test("does not show, and a stale hint is dropped", async ({ page }) => {
      await page.addInitScript(
        ([k, v]) => localStorage.setItem(k, v),
        [hintKey, JSON.stringify([u8aToHex(decodeAddress(ME))])],
      )
      await openMenu(page)
      await expect(entry(page)).toHaveCount(0)
      await expect.poll(() => remembered(page)).toEqual([])
    })
  })
})
