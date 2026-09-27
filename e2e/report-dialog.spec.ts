import { PROPOSAL_ID } from "./support/data"
import { expect, openProposal, test } from "./support/test"

// Narrow and common phone widths: labels wrap differently on each.
for (const width of [360, 390]) {
  test.describe(`${width} px phone`, () => {
    test.use({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true })

    test("report dialog lines up and sends the chosen category", async ({ page }) => {
      await openProposal(page)
      await page.getByRole("button", { name: "More" }).click()
      await page.getByRole("menuitem", { name: "Report this proposal" }).click()

      const dialog = page.getByRole("dialog", { name: "Report this proposal" })
      await expect(dialog).toBeVisible()
      const options = dialog.getByRole("radio")
      await expect(options).toHaveCount(8)
      // Measure after the open animation, not halfway through the zoom.
      await dialog.evaluate((el) =>
        Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
      )

      const heights = await options.evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().height),
      )
      expect(
        Math.max(...heights) - Math.min(...heights),
        `option heights ${heights.join(", ")}`,
      ).toBeLessThanOrEqual(0.5)

      const box = await dialog.boundingBox()
      expect(box).not.toBeNull()
      const left = box!.x
      const right = width - (box!.x + box!.width)
      expect(left, "dialog stays on screen").toBeGreaterThan(0)
      expect(Math.abs(left - right), `side margins ${left} / ${right}`).toBeLessThanOrEqual(1)

      const choice = dialog.getByRole("radio", { name: "Seed phrase / key" })
      await choice.click()
      await expect(choice).toHaveAttribute("aria-checked", "true")
      await expect(options.and(page.locator("[aria-checked=true]"))).toHaveCount(1)

      const sent = page.waitForRequest(
        (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/moderation/reports",
      )
      await dialog.getByRole("button", { name: "Send report" }).click()
      expect((await sent).postDataJSON()).toEqual({
        target_type: "proposal",
        target_id: PROPOSAL_ID,
        category: "secrets",
        note: null,
      })
      await expect(page.getByText("Report sent")).toBeVisible()
      await expect(dialog).toBeHidden()
    })
  })
}

test.describe("signed out", () => {
  test.use({
    signedIn: false,
    viewport: { width: 390, height: 800 },
    isMobile: true,
    hasTouch: true,
  })

  test("report dialog offers one sign-in link that comes back here", async ({ page }) => {
    await openProposal(page)
    await page.getByRole("button", { name: "More" }).click()
    await page.getByRole("menuitem", { name: "Report this proposal" }).click()

    const dialog = page.getByRole("dialog", { name: "Report this proposal" })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("link")).toHaveCount(1)
    const signIn = dialog.getByRole("link", { name: "Sign in to report" })
    const next = new URL((await signIn.getAttribute("href"))!, "http://x").searchParams.get("next")
    expect(next).toBe(new URL(page.url()).pathname + new URL(page.url()).search)
    await expect(dialog.getByRole("radio")).toHaveCount(0)
  })
})
