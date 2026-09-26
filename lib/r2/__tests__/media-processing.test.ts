import { describe, expect, it } from "vitest"
import sharp from "sharp"
import {
  ImageProcessingError,
  MAX_EDGE_PX,
  THUMB_EDGE_PX,
  processProposalImage,
} from "@/lib/r2/media-processing"

function photo(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } },
  })
}

describe("processProposalImage", () => {
  it("drops EXIF (incl. GPS) and scales big photos down", async () => {
    const input = await photo(4000, 3000)
      .withExif({
        IFD0: { Make: "PhoneCo", Model: "X1" },
        IFD3: { GPSLatitudeRef: "N", GPSLongitudeRef: "E" },
      })
      .jpeg()
      .toBuffer()
    expect((await sharp(input).metadata()).exif).toBeDefined()

    const { body, thumbnail } = await processProposalImage(input, "image/jpeg")
    const meta = await sharp(body).metadata()
    expect(meta.exif).toBeUndefined()
    expect(meta.format).toBe("jpeg")
    expect(Math.max(meta.width!, meta.height!)).toBe(MAX_EDGE_PX)

    const thumb = await sharp(thumbnail).metadata()
    expect(thumb.format).toBe("webp")
    expect(Math.max(thumb.width!, thumb.height!)).toBe(THUMB_EDGE_PX)
  })

  it("applies the EXIF orientation before dropping it", async () => {
    // 300x100 stored, orientation 6 = rotate 90° clockwise when shown.
    const input = await photo(300, 100).withMetadata({ orientation: 6 }).jpeg().toBuffer()
    const { body } = await processProposalImage(input, "image/jpeg")
    const meta = await sharp(body).metadata()
    expect([meta.width, meta.height]).toEqual([100, 300])
    expect(meta.orientation).toBeUndefined()
  })

  it("keeps small images at their size and format", async () => {
    const input = await photo(800, 600).png().toBuffer()
    const { body } = await processProposalImage(input, "image/png")
    const meta = await sharp(body).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(["png", 800, 600])
  })

  it("stores GIFs untouched but still makes a thumbnail", async () => {
    const input = await photo(1200, 900).gif().toBuffer()
    const { body, thumbnail } = await processProposalImage(input, "image/gif")
    expect(body.equals(input)).toBe(true)
    expect((await sharp(thumbnail).metadata()).width).toBe(THUMB_EDGE_PX)
  })

  it("rejects bytes that don't decode", async () => {
    const junk = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)])
    await expect(processProposalImage(junk, "image/jpeg")).rejects.toBeInstanceOf(
      ImageProcessingError,
    )
  })
})
