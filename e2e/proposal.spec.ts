import { ATTACHMENTS, ME, MULTISIG, PROPOSAL_PATH, SUMMARY, TITLE } from "./support/data"
import { expect, openProposal, test } from "./support/test"

test("proposal title, summary and proposer show before the chain answers", async ({ page }) => {
  // The chain sockets open but never answer, so nothing from the chain arrives.
  await page.routeWebSocket(/^wss:\/\//, () => {})
  await page.goto(PROPOSAL_PATH)

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE)
  await expect(page.getByText(SUMMARY)).toBeVisible()
  // The proposer's chip (it opens their profile).
  await expect(page.locator(`button[title="${ME}"]`)).toBeVisible()
  // Still waiting for the chain: no status, no tally.
  await expect(page.getByText("Approved", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Tally" })).toHaveCount(0)
})

test("proposal page shows the verified EGOV1 text with its table, image and addresses", async ({
  page,
}) => {
  await openProposal(page)

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(TITLE)
  await expect(page.getByText(SUMMARY)).toBeVisible()
  await expect(page.getByRole("button", { name: "EGOV1 · Verified" })).toBeVisible()

  // Markdown table
  const table = page.getByRole("table").filter({ hasText: "Milestone" })
  await expect(table.getByRole("columnheader")).toHaveText(["Milestone", "Month", "Amount"])
  await expect(table.getByRole("row")).toHaveCount(4)
  await expect(table.getByRole("row").last()).toHaveText(/M3 Audit \+ launch\s*Dec\s*35,000 cENJ/)

  // Inline image: one of the proposal's own files, loaded through /r
  const image = page.getByRole("img", { name: "Roadmap Q4 2026", exact: true })
  await image.scrollIntoViewIfNeeded()
  await expect(image).toHaveAttribute("src", `/r/${ATTACHMENTS[0].key}`)
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1200)

  // Address chip: short on screen, the full address on the clipboard
  const chip = page.locator(`button[title="${MULTISIG}"]`)
  await expect(chip).toHaveText(`${MULTISIG.slice(0, 6)}…${MULTISIG.slice(-5)}`)
  await chip.click()
  await expect(page.getByText("Address copied")).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(MULTISIG)
})
