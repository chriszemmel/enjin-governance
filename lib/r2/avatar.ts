/**
 * Avatar transcode → 150x150 PNG, EXIF stripped.
 *
 * `sharp` accepts any common raster format (PNG, JPEG, WebP, AVIF, GIF).
 * Output is always PNG so the bucket key shape is predictable.
 */

import "server-only"
import sharp from "sharp"

export const AVATAR_SIZE_PX = 150

export async function transcodeAvatar(input: Buffer | Uint8Array): Promise<Buffer> {
  return sharp(input)
    .rotate() // honour EXIF orientation before stripping
    .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, { fit: "cover", position: "centre" })
    .png({ compressionLevel: 9 })
    .toBuffer()
}
