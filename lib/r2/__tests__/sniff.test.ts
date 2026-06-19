import { describe, expect, it } from "vitest"
import { sniffMediaMime } from "@/lib/r2/sniff"

function bytes(...prefix: number[]): Uint8Array {
  // Pad to >= 12 bytes so the length guard passes.
  const out = new Uint8Array(16)
  out.set(prefix, 0)
  return out
}

describe("sniffMediaMime", () => {
  it("detects PNG", () => {
    expect(sniffMediaMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png")
  })

  it("detects JPEG", () => {
    expect(sniffMediaMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg")
  })

  it("detects GIF", () => {
    expect(sniffMediaMime(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("image/gif")
  })

  it("detects WEBP (RIFF....WEBP)", () => {
    const b = bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50)
    expect(sniffMediaMime(b)).toBe("image/webp")
  })

  it("detects PDF", () => {
    expect(sniffMediaMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBe("application/pdf")
  })

  it("rejects HTML masquerading as an image", () => {
    // "<!DOCTYPE" - what a spoofed-content-type HTML upload would start with.
    const html = new TextEncoder().encode("<!DOCTYPE html><script>alert(1)</script>")
    expect(sniffMediaMime(html)).toBeNull()
  })

  it("rejects an SVG (text, not an allowed binary image)", () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")
    expect(sniffMediaMime(svg)).toBeNull()
  })

  it("returns null for a too-short buffer", () => {
    expect(sniffMediaMime(new Uint8Array([0x89, 0x50]))).toBeNull()
  })
})
