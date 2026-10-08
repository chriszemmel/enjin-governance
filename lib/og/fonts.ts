/**
 * Inter (latin, OFL; see fonts/README.md) for the share images, read from
 * disk once per server instance. `next/og` needs the font data itself.
 */

import { readFile } from "node:fs/promises"
import { join } from "node:path"

type OgFont = { name: string; data: Buffer; weight: 500 | 600; style: "normal" }

let fonts: Promise<OgFont[]> | null = null

export function loadOgFonts(): Promise<OgFont[]> {
  fonts ??= Promise.all(
    ([500, 600] as const).map(async (weight) => ({
      name: "Inter",
      weight,
      style: "normal" as const,
      data: await readFile(join(process.cwd(), `lib/og/fonts/inter-latin-${weight}-normal.woff`)),
    })),
  ).catch((err: unknown) => {
    fonts = null
    throw err
  })
  return fonts
}
