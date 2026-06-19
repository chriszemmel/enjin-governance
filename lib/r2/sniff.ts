/**
 * Magic-byte sniffing for uploaded proposal media.
 *
 * The upload route can only see the client-supplied `Content-Type`, which is
 * trivially spoofable. We additionally derive the real type from the file's
 * leading bytes and store that, so a file cannot be persisted (and later
 * served) under a content-type it doesn't actually match. Only the formats the
 * proposal body can render are recognized; anything else returns null and is
 * rejected by the caller.
 */

type SniffedMediaMime =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "application/pdf"

/** Detect the media type from magic bytes, or null if not a recognized type. */
export function sniffMediaMime(buf: Uint8Array): SniffedMediaMime | null {
  if (buf.length < 12) return null

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png"
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg"
  }
  // GIF: "GIF8"
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return "image/gif"
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp"
  }
  // PDF: "%PDF"
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return "application/pdf"
  }
  return null
}
