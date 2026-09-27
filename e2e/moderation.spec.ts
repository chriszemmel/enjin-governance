import { QUEUE_ITEMS } from "./support/data"
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
