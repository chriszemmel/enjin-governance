/**
 * Clean up an uploaded proposal image before it is stored.
 *
 * - Metadata is dropped: phone photos carry EXIF with GPS coordinates,
 *   camera serials and timestamps. The EXIF orientation is applied to the
 *   pixels first so the picture doesn't end up sideways.
 * - Images are scaled down to fit MAX_EDGE_PX. Nobody needs a 48 MP photo
 *   inside a proposal, and it keeps pages fast on mobile.
 * - A small WebP thumbnail is produced for galleries.
 *
 * GIFs are stored as uploaded (they carry no EXIF, and re-encoding would
 * mangle animations); they still get a still thumbnail. PDFs never come
 * here.
 */

import "server-only"
import sharp from "sharp"

export const MAX_EDGE_PX = 2560
export const THUMB_EDGE_PX = 640
/** Refuse decompression bombs early (~ 12000 x 10000 px). */
const MAX_INPUT_PIXELS = 120_000_000

type ProcessedImage = {
  body: Buffer
  thumbnail: Buffer
}

export class ImageProcessingError extends Error {}

export async function processProposalImage(
  input: Buffer,
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif",
): Promise<ProcessedImage> {
  try {
    const opts = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" as const }
    let body: Buffer
    if (mime === "image/gif") {
      body = input
    } else {
      const meta = await sharp(input, opts).metadata()
      const animated = (meta.pages ?? 1) > 1
      if (animated) {
        // Animated WebP: re-encode every frame to drop metadata, keep size.
        body = await sharp(input, { ...opts, animated: true })
          .webp({ quality: 85 })
          .toBuffer()
      } else {
        const pipeline = sharp(input, opts).rotate().resize({
          width: MAX_EDGE_PX,
          height: MAX_EDGE_PX,
          fit: "inside",
          withoutEnlargement: true,
        })
        body =
          mime === "image/jpeg"
            ? await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer()
            : mime === "image/png"
              ? await pipeline.png({ compressionLevel: 9 }).toBuffer()
              : await pipeline.webp({ quality: 85 }).toBuffer()
      }
    }

    const thumbnail = await sharp(body, opts)
      .rotate()
      .resize({
        width: THUMB_EDGE_PX,
        height: THUMB_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 75 })
      .toBuffer()

    return { body, thumbnail }
  } catch (e) {
    throw new ImageProcessingError(e instanceof Error ? e.message : String(e))
  }
}
