import { expect, test } from "./support/test"

// Canary runs a Fellowship with one decided referendum, F#0 (approved).
// The test wallet isn't a member, so it can follow but not vote.

test("the Fellowship hub lists members and referenda from the chain", async ({ page }) => {
  await page.goto("/fellowship?network=canary-relay")
  await expect(page.getByRole("heading", { level: 1, name: "Fellowship" })).toBeVisible()
  const card = page.getByRole("link", { name: /F#0/ })
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect(card.getByText("Approved")).toBeVisible()
  await expect(page.getByText("Not a member")).toBeVisible()

  await page.getByRole("tab", { name: "Members" }).click()
  await expect(page.getByText("Grand Master").first()).toBeVisible()
  await expect(page.getByText("Weight on")).toBeVisible()
})

test("a decided fellowship referendum has its own F# page", async ({ page }) => {
  await page.goto("/fellowship/0?network=canary-relay")
  await expect(page.getByText("F#0").first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText("Fellowship", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("Voting has ended for this referendum.")).toBeVisible()
  await expect(page.getByRole("link", { name: "Fellowship" }).first()).toHaveAttribute(
    "href",
    /\/fellowship/,
  )
})

test("the nav links the Fellowship on a runtime that has one", async ({ page }) => {
  await page.goto("/proposals?network=canary-relay")
  // The entry appears once the chain connection shows the pallets.
  await expect(page.getByText("Referendum #").first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole("button", { name: "Open menu" }).first().click()
  await expect(page.getByRole("link", { name: "Fellowship" })).toHaveAttribute("href", "/fellowship")
})
