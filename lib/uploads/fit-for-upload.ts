/**
 * Make a picked file fit the upload limit before it is sent.
 *
 * Photos straight from a phone or camera are often over 4 MB. The server
 * scales images to 2560 px anyway, so doing that in the browser first
 * loses nothing and keeps them under the limit. PDFs and GIFs can't be
 * shrunk here without breaking them (pages, animation), so those get a
 * clear message instead of a failed request.
 */

import { MAX_IMAGE_EDGE_PX, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "./limits"

type FitResult = { ok: true; file: File } | { ok: false; error: string }

const SHRINKABLE = new Set(["image/png", "image/jpeg", "image/webp"])

export async function fitForUpload(
  file: File,
  shrink: (file: File) => Promise<File | null> = shrinkImage,
): Promise<FitResult> {
  if (file.size <= MAX_UPLOAD_BYTES) return { ok: true, file }
  if (file.type === "application/pdf") {
    return {
      ok: false,
      error: `PDFs can be up to ${MAX_UPLOAD_LABEL}. Export it with smaller images, or split it into parts.`,
    }
  }
  if (!SHRINKABLE.has(file.type)) {
    return { ok: false, error: `Files can be up to ${MAX_UPLOAD_LABEL}.` }
  }
  const smaller = await shrink(file).catch(() => null)
  if (!smaller || smaller.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `Images can be up to ${MAX_UPLOAD_LABEL}, and this one couldn't be made smaller here. Try saving it as JPEG.`,
    }
  }
  return { ok: true, file: smaller }
}

type Attempt = { type: "image/png" | "image/webp" | "image/jpeg"; quality?: number }

/** PNG stays lossless if it fits; photos go to JPEG, the rest to WebP. */
function attemptsFor(type: string): Attempt[] {
  if (type === "image/jpeg") {
    return [
      { type: "image/jpeg", quality: 0.9 },
      { type: "image/jpeg", quality: 0.8 },
    ]
  }
  return [
    ...(type === "image/png" ? [{ type: "image/png" as const }] : []),
    { type: "image/webp", quality: 0.9 },
    { type: "image/webp", quality: 0.8 },
    { type: "image/jpeg", quality: 0.85 },
  ]
}

const EXTENSION = { "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg" } as const

async function shrinkImage(file: File): Promise<File | null> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
  try {
    let scale = Math.min(1, MAX_IMAGE_EDGE_PX / Math.max(bitmap.width, bitmap.height))
    for (let round = 0; round < 4; round++) {
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      for (const attempt of attemptsFor(file.type)) {
        const blob = await encode(bitmap, width, height, attempt)
        // A browser that can't write a format quietly returns PNG instead.
        if (blob && blob.type === attempt.type && blob.size <= MAX_UPLOAD_BYTES) {
          return new File([blob], renamed(file.name, EXTENSION[attempt.type]), {
            type: attempt.type,
          })
        }
      }
      scale *= 0.75
    }
    return null
  } finally {
    bitmap.close()
  }
}

function encode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  attempt: Attempt,
): Promise<Blob | null> {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) return Promise.resolve(null)
  if (attempt.type === "image/jpeg") {
    // JPEG has no transparency: put see-through parts on white, not black.
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  return new Promise((resolve) => canvas.toBlob(resolve, attempt.type, attempt.quality))
}

function renamed(name: string, extension: string): string {
  const base = name.replace(/\.[^./\\]*$/, "") || "image"
  return `${base}.${extension}`
}
