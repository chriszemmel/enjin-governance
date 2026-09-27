import { describe, expect, it } from "vitest"
import { fitForUpload } from "@/lib/uploads/fit-for-upload"
import { MAX_UPLOAD_BYTES } from "@/lib/uploads/limits"

const fileOf = (size: number, type: string, name = "file") =>
  new File([new Uint8Array(size)], name, { type })

describe("fitForUpload", () => {
  it("sends files under the limit as they are", async () => {
    const pdf = fileOf(MAX_UPLOAD_BYTES, "application/pdf", "a.pdf")
    const shrink = async () => {
      throw new Error("not needed")
    }
    expect(await fitForUpload(pdf, shrink)).toEqual({ ok: true, file: pdf })
  })

  it("refuses big PDFs and GIFs with a reason instead of sending them", async () => {
    const pdf = await fitForUpload(fileOf(MAX_UPLOAD_BYTES + 1, "application/pdf"))
    expect(pdf).toMatchObject({ ok: false, error: expect.stringContaining("4 MB") })
    const gif = await fitForUpload(fileOf(MAX_UPLOAD_BYTES + 1, "image/gif"))
    expect(gif).toMatchObject({ ok: false, error: "Files can be up to 4 MB." })
  })

  it("shrinks big photos, and refuses them when that doesn't get under the limit", async () => {
    const photo = fileOf(MAX_UPLOAD_BYTES * 3, "image/jpeg", "photo.jpg")
    const smaller = fileOf(1_000_000, "image/jpeg", "photo.jpg")
    expect(await fitForUpload(photo, async () => smaller)).toEqual({ ok: true, file: smaller })
    expect((await fitForUpload(photo, async () => null)).ok).toBe(false)
    const stillBig = fileOf(MAX_UPLOAD_BYTES + 1, "image/jpeg")
    expect((await fitForUpload(photo, async () => stillBig)).ok).toBe(false)
  })
})
