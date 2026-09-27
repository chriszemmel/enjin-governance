/**
 * The 4 MB upload limit in a real browser (lib/uploads/fit-for-upload.ts):
 * files that can't be shrunk are refused before they are sent, large
 * photos are scaled down first.
 */
import fs from "node:fs"
import type { Page } from "@playwright/test"
import sharp from "sharp"
import { fixture } from "./support/data"
import { expect, openComposer, test } from "./support/test"

/** lib/uploads/limits.ts: MAX_UPLOAD_BYTES. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024
/** lib/uploads/limits.ts: MAX_IMAGE_EDGE_PX. */
const MAX_IMAGE_EDGE_PX = 2560

const fileInput = (page: Page) => page.locator("input[type=file][accept*='application/pdf']")

/**
 * A 12-megapixel "phone photo": a gradient with sensor-like noise, which
 * JPEG can't compress well. Seeded, so every run gets the same bytes.
 */
async function noisyPhoto(width: number, height: number): Promise<Buffer> {
  let seed = 0x2545f491
  const next = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) % 96
  }
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3
      raw[i] = Math.min(255, ((x * 200) / width + next()) | 0)
      raw[i + 1] = Math.min(255, ((y * 200) / height + next()) | 0)
      raw[i + 2] = Math.min(255, 80 + next())
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer()
}

test("a PDF over 4 MB is refused in the browser and never sent", async ({ page, api }) => {
  await openComposer(page)
  const pdf = fixture("budget.pdf")
  const bigPdf = Buffer.concat([pdf, Buffer.alloc(MAX_UPLOAD_BYTES + 1 - pdf.length, 0x20)])

  // A small PDF goes with it: once that one is listed, the big one has
  // been dealt with, so "not sent" is checked without waiting on a timer.
  await fileInput(page).setInputFiles([
    { name: "big-budget.pdf", mimeType: "application/pdf", buffer: bigPdf },
    { name: "budget.pdf", mimeType: "application/pdf", buffer: pdf },
  ])

  await expect(page.getByText("Upload failed: big-budget.pdf")).toBeVisible()
  await expect(page.getByText(/PDFs can be up to 4 MB/)).toBeVisible()
  await expect(page.getByRole("link", { name: "budget.pdf", exact: true })).toBeVisible()
  expect(api.uploads.map((u) => u.name)).toEqual(["budget.pdf"])
  await expect(page.getByRole("link", { name: "big-budget.pdf" })).toHaveCount(0)
})

test("a large photo is shrunk under 4 MB before the upload request", async ({
  page,
  api,
}, testInfo) => {
  const photo = await noisyPhoto(4000, 3000)
  expect(photo.length, "the test photo must start over the limit").toBeGreaterThan(MAX_UPLOAD_BYTES)
  const photoPath = testInfo.outputPath("big-photo.jpg")
  fs.writeFileSync(photoPath, photo)

  await openComposer(page)
  const request = page.waitForRequest(
    (r) =>
      r.method() === "POST" &&
      /^\/api\/proposals\/[0-9a-f-]{36}\/media$/.test(new URL(r.url()).pathname),
  )
  await fileInput(page).setInputFiles(photoPath)
  const sent = await request

  // The whole request stays under the host's 4.5 MB body limit.
  const body = sent.postDataBuffer()
  expect(body).not.toBeNull()
  expect(body!.length).toBeLessThan(4_500_000)
  await expect(page.getByRole("link", { name: "big-photo.jpg" })).toBeVisible()
  expect(api.uploads).toHaveLength(1)
  const [upload] = api.uploads
  expect(upload.name).toBe("big-photo.jpg")
  expect(upload.contentType).toBe("image/jpeg")
  expect(upload.bytes.length).toBeLessThanOrEqual(MAX_UPLOAD_BYTES)
  expect(upload.bytes.length).toBeLessThan(photo.length)

  // Still the same picture, scaled to fit the stored size.
  const meta = await sharp(upload.bytes).metadata()
  expect(meta.format).toBe("jpeg")
  expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(MAX_IMAGE_EDGE_PX)
  expect((meta.width ?? 0) / (meta.height ?? 1)).toBeCloseTo(4 / 3, 2)
  testInfo.annotations.push({
    type: "shrunk",
    description: `${photo.length} B 4000×3000 -> ${upload.bytes.length} B ${meta.width}×${meta.height}`,
  })
})
