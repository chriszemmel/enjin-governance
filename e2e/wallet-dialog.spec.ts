import { expect, test } from "./support/test"

test.use({ viewport: { width: 1280, height: 900 } })

test("the wallet dialog takes focus, keeps Tab inside and closes on Escape", async ({ page }) => {
  await page.goto("/docs")
  await page.getByRole("button", { name: "Open menu" }).click()
  const opener = page.getByRole("button", { name: "Open wallet menu" })
  await opener.click()

  // Its code loads on demand; the fake wallet is connected.
  const dialog = page.getByRole("dialog", { name: "Wallet connected" })
  await expect(dialog).toBeVisible()
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)

  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab")
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+Tab")
  await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)

  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
})
