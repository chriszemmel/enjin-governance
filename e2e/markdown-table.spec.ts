import { expect, openComposer, test } from "./support/test"

// A table with one long text column on a phone: the narrow column keeps
// whole words, and a wide table scrolls inside its box.
const TABLE = [
  "| Term | Commitment |",
  "|---|---|",
  "| Use of funds | 100% to player rewards; 0% platform fee; the studio bears KYC, onboarding and operating costs |",
  "| Allocation | Ten slots of 5,000 ENJ; at most one slot per studio or organization |",
].join("\n")

const WIDE = [
  "| Address | Role |",
  "|---|---|",
  "| ReferendumCancellerWhitelistedCallerTreasurySpendApprovalOriginTrack | Multisig |",
].join("\n")

test.use({ viewport: { width: 390, height: 844 } })

test("tables on a phone keep whole words in narrow columns and scroll when wide", async ({
  page,
}) => {
  await openComposer(page)
  await page.getByPlaceholder(/Motivation, specification/).fill(`${TABLE}\n\n${WIDE}`)
  await page.getByRole("tab", { name: "Preview" }).click()

  // Each word stays whole: its text takes one line box, not a letter per line.
  const lines = (cell: ReturnType<typeof page.getByRole>) =>
    cell.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return range.getClientRects().length
    })
  const term = page.getByRole("columnheader", { name: "Term" })
  await expect(term).toBeVisible()
  expect(await lines(term)).toBe(1)
  expect(await lines(page.getByRole("cell", { name: "Allocation" }))).toBe(1)

  // The wide table scrolls inside its own box instead of squeezing.
  const wide = page.getByRole("table").filter({ hasText: "Multisig" })
  const scroller = wide.locator("xpath=..")
  const { scrollWidth, clientWidth } = await scroller.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  expect(scrollWidth).toBeGreaterThan(clientWidth)
})
