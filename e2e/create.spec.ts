import { ME, ME_MATRIX } from "./support/data"
import { expect, openComposer, test } from "./support/test"

test.describe("beneficiary in another network's format", () => {
  test("opens the wrong-network dialog, and Convert fills in the relay address", async ({
    page,
  }) => {
    await openComposer(page)
    const beneficiary = page.getByPlaceholder(ME)
    await beneficiary.fill(ME_MATRIX)

    const dialog = page.getByRole("dialog", { name: "This is a Canary Matrixchain address" })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(ME_MATRIX)
    await expect(dialog).toContainText(ME)
    await expect(dialog.getByText("This is your own connected wallet")).toBeVisible()

    await dialog.getByRole("button", { name: "Convert" }).click()
    await expect(dialog).toBeHidden()
    await expect(beneficiary).toHaveValue(ME)
    await expect(
      page.getByText("Canary Relay address - this is your connected wallet."),
    ).toBeVisible()
  })

  test("Cancel clears the field", async ({ page }) => {
    await openComposer(page)
    const beneficiary = page.getByPlaceholder(ME)
    await beneficiary.fill(ME_MATRIX)

    const dialog = page.getByRole("dialog", { name: "This is a Canary Matrixchain address" })
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toBeHidden()
    await expect(beneficiary).toHaveValue("")
  })
})
