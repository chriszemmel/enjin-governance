/**
 * Shared OpenGraph image for the site's pages (the home page, proposals,
 * treasury, docs, create, unlock). Same frame as a referendum's card
 * (referendum-card.tsx): the Enjin mark and "Enjin Governance" on top with
 * the page's name on the right, a big title in the middle, and a short line
 * in the accent colour at the bottom next to the site's address.
 *
 * Inlined SVG paths (not <img>) so nothing is fetched while rendering.
 */

import { ImageResponse } from "next/og"
import { loadOgFonts } from "./fonts"
import { Backdrop } from "./referendum-card"
import { fitTitle } from "./referendum-facts"

export const OG_SIZE = { width: 1200, height: 630 } as const
export const OG_CONTENT_TYPE = "image/png"

type Args = {
  /** The page's name, top right ("Docs"); none on the home page. */
  section?: string
  title: string
  /** A few words at the bottom, in the accent colour. */
  tagline?: string
}

const E_PATH =
  "M232 116C136 116 96 157.017 96 212L96 300C96 354.983 136 396 232 396L325 396C412 396 416 385.501 416 368C416 348.001 408 340 388 340L232 340C184 340 160 316.055 160 292L160 284L388 284C404 284 416 273.5 416 256C416 238.5 404 228 388 228L160 228L160 220C160 195.945 184 172 232 172L388 172C408 172 416 163.999 416 144C416 126.499 412 116 325 116L232 116Z"
const DISC =
  "M0 256C0 114.615 114.615 0 256 0C397.385 0 512 114.615 512 256C512 397.385 397.385 512 256 512C114.615 512 0 397.385 0 256Z"

export async function renderOgImage({ section, title, tagline }: Args): Promise<ImageResponse> {
  const fit = fitTitle(title)
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          padding: "56px",
          color: "#FFFFFF",
          fontFamily: "Inter",
          background: "#07051a",
          overflow: "hidden",
        }}
      >
        <Backdrop />
        <div style={{ position: "absolute", top: "90px", right: "-190px", display: "flex", opacity: 0.045 }}>
          <svg width="560" height="560" viewBox="96 116 320 280">
            <path d={E_PATH} fill="#FFFFFF" />
          </svg>
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: "1200px",
            height: "4px",
            background: "linear-gradient(90deg, #7866D5 0%, rgba(120,102,213,0) 70%)",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: "76px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
            <svg width="76" height="76" viewBox="0 0 512 512">
              <path d={DISC} fill="#7866D5" />
              <path d={E_PATH} fill="#FFFFFF" />
            </svg>
            <div style={{ display: "flex", fontSize: "36px", fontWeight: 600, letterSpacing: "-0.015em" }}>
              Enjin Governance
            </div>
          </div>
          {section && (
            <div style={{ display: "flex", fontSize: "34px", fontWeight: 600, color: "#B7AAFF" }}>{section}</div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "330px", marginTop: "6px" }}>
          <div
            style={{
              display: "flex",
              fontSize: `${fit.size}px`,
              fontWeight: 600,
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
              maxWidth: "1088px",
              ...(fit.lines > 1 ? { textWrap: "balance" as const } : { whiteSpace: "nowrap" as const }),
            }}
          >
            {fit.text}
          </div>
        </div>

        <div style={{ display: "flex", width: "72px", height: "4px", borderRadius: "2px", background: "#7866D5" }} />
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "flex-end",
            justifyContent: "space-between",
            paddingTop: "20px",
          }}
        >
          <div style={{ display: "flex", fontSize: "40px", fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1, color: "#A99BFF" }}>
            {tagline ?? ""}
          </div>
          <div style={{ display: "flex", fontSize: "26px", fontWeight: 500, color: "rgba(255,255,255,0.48)" }}>
            gov.enjin.cloud
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await loadOgFonts() },
  )
}
