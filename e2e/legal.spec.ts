import type { Page } from "@playwright/test"
import { expect, test } from "./support/test"

const LEGAL_PAGES = [
  { path: "/imprint", link: "Imprint", title: "Imprint (Impressum)" },
  { path: "/privacy", link: "Privacy", title: "Privacy policy" },
  { path: "/terms", link: "Terms", title: "Terms of use" },
]

/** The footer's legal links, on every page. */
async function expectLegalFooter(page: Page) {
  const legal = page.getByRole("contentinfo").getByRole("navigation", { name: "Legal" })
  for (const { path, link } of LEGAL_PAGES) {
    await expect(legal.getByRole("link", { name: link, exact: true })).toHaveAttribute("href", path)
  }
  // The AGPL source offer for people using the running site.
  const source = legal.getByRole("link", { name: /^Source code/ })
  await expect(source).toHaveAttribute("href", /^https:\/\/\S+/)
  await expect(source).toHaveAttribute("target", "_blank")
}

for (const { path, title } of LEGAL_PAGES) {
  test(`${path} loads with the legal footer`, async ({ page }) => {
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title)
    await expect(page).toHaveTitle(new RegExp(`^${title.replace(/[()]/g, "\\$&")}`))
    await expect(page.getByText(/Last updated:/)).toBeVisible()
    await expectLegalFooter(page)
  })
}

test("the footer on the home page leads to each legal page", async ({ page }) => {
  await page.goto("/")
  await expectLegalFooter(page)
  const legal = page.getByRole("contentinfo").getByRole("navigation", { name: "Legal" })
  for (const { path, link, title } of LEGAL_PAGES) {
    await legal.getByRole("link", { name: link, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title)
  }
})
