import { expect, openProposal, test } from "./support/test"

// Canary referendum 13 (support/data.ts) is a SmallTipper spend_local of
// 1 cENJ: approved at 17,387,342, enacted by the scheduler at 17,387,352
// (approval + the track's 10-block minimum enactment), and its treasury
// proposal #2 paid at a later spend period. All of it is settled history,
// read from the Canary RPC and archive node. The payout needs the call
// decoded from its preimage, as the page's treasury summary does.
for (const width of [360, 390, 1280]) {
  test.describe(`${width} px`, () => {
    test.use({
      viewport: { width, height: 900 },
      ...(width < 400 ? { isMobile: true, hasTouch: true } : {}),
    })

    test("a paid-out spend folds to one line and opens to its events, within the screen", async ({
      page,
    }) => {
      await openProposal(page)
      // All of it has happened, so the card is one line until opened.
      const card = page.getByRole("region", { name: "Lifecycle" })
      const details = card.getByRole("button", { name: /Details/ })
      await expect(details).toContainText("Paid out 1 cENJ", { timeout: 60_000 })
      await expect(details).toContainText("treasury proposal #2")
      await details.click()

      const timeline = card.getByRole("list", { name: "Timeline" })
      const row = (label: string) =>
        timeline.getByRole("listitem").filter({ has: page.getByText(label, { exact: true }) })
      await expect(row("Approved")).toContainText("#17,387,342")
      // The exact block, from the scheduler's Dispatched event (no "≈").
      await expect(row("Executed")).toContainText("#17,387,352")
      await expect(row("Executed")).not.toContainText("≈")
      await expect(row("Paid out")).toBeVisible()

      // Nothing sticks out: not the page, the card, or any timeline row.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
      const box = (await card.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      const rowOverflow = await timeline
        .getByRole("listitem")
        .evaluateAll((rows) => rows.map((r) => r.scrollWidth - r.clientWidth))
      expect(Math.max(...rowOverflow)).toBeLessThanOrEqual(0)
    })
  })
}
