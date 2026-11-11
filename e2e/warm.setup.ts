import { expect, test as setup } from "@playwright/test"
import { NETWORK } from "./support/data"

// The server reads each decided referendum's track from the archive once
// and keeps it (/api/chain/[chain]/decided-tracks); in production that
// cache is warm. A fresh build starts empty, and the route stops after
// 40 s with what it has, so fill it here before any test runs: otherwise
// the browser reads the rest itself while other tests use the same
// archive node, and both run out of time.
setup("fill the server's cache of decided tracks", async ({ request }) => {
  setup.setTimeout(300_000)
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/chain/${NETWORK}/decided-tracks`, { timeout: 70_000 })
        return res.ok() && ((await res.json()) as { complete?: boolean }).complete === true
      },
      { timeout: 280_000, intervals: [1_000] },
    )
    .toBe(true)
})
