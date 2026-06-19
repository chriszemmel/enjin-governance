/**
 * Shared OpenGraph image renderer.
 *
 * Every per-route `opengraph-image.tsx` calls this so the look stays
 * consistent. Each page passes an eyebrow ("Enjin Governance" by
 * default), a big title, and a short subtitle. The renderer handles
 * the rest: the inline Enjin mark, the gradient background, the soft
 * purple orb in the upper right, and a green EGOV1 shield on the
 * header row.
 *
 * Inlined SVG paths (not <img>) so the edge runtime doesn't need to
 * fetch the asset; `next/og` rasterises everything in-process.
 */

import { ImageResponse } from "next/og"

export const OG_SIZE = { width: 1200, height: 630 } as const
export const OG_CONTENT_TYPE = "image/png"

type Args = {
  eyebrow?: string
  title: string
  subtitle?: string
  /** Override the accent / orb tone. Defaults to brand purple. */
  accent?: string
}

export function renderOgImage(args: Args): ImageResponse {
  const {
    eyebrow = "Enjin Governance",
    title,
    subtitle,
    accent = "rgba(120, 102, 213, 0.45)",
  } = args

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          padding: "72px 80px",
          background:
            "linear-gradient(180deg, #0d0a1f 0%, #050410 100%)",
          color: "#FFFFFF",
          fontFamily: "Inter, sans-serif",
          overflow: "hidden",
        }}
      >
        {/* Soft accent orb: radial gradient bleeding in from the
            top-right corner. */}
        <div
          style={{
            position: "absolute",
            top: "-220px",
            right: "-220px",
            width: "780px",
            height: "780px",
            borderRadius: "9999px",
            background: `radial-gradient(circle, ${accent} 0%, transparent 60%)`,
            filter: "blur(8px)",
          }}
        />
        {/* Secondary haze on the bottom-left for depth. */}
        <div
          style={{
            position: "absolute",
            bottom: "-280px",
            left: "-180px",
            width: "640px",
            height: "640px",
            borderRadius: "9999px",
            background:
              "radial-gradient(circle, rgba(150, 131, 227, 0.18) 0%, transparent 60%)",
            filter: "blur(12px)",
          }}
        />

        {/* Header row: mark + eyebrow on the left, EGOV1 shield on
            the right. The shield matches the proposal-page verified
            badge so the brand reads consistently across surfaces.
            Stacking above the orbs is handled by DOM order - Satori
            doesn't support `zIndex`. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "20px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "20px",
            }}
          >
            <EnjinMark size={64} />
            <div
              style={{
                fontSize: "26px",
                fontWeight: 600,
                color: "#FFFFFF",
                letterSpacing: "-0.01em",
              }}
            >
              {eyebrow}
            </div>
          </div>
          <Egov1Shield />
        </div>

        {/* Title + subtitle, centred vertically in the remaining
            space. Footer removed: the EGOV1 shield + Enjin lockup in
            the header already carry the branding. */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "22px",
            maxWidth: "1000px",
          }}
        >
          <div
            style={{
              fontSize: title.length > 60 ? "68px" : "88px",
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.025em",
              color: "#FFFFFF",
            }}
          >
            {title}
          </div>
          {subtitle && (
            <div
              style={{
                fontSize: "28px",
                lineHeight: 1.4,
                fontWeight: 400,
                color: "rgba(255, 255, 255, 0.62)",
                maxWidth: "880px",
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      </div>
    ),
    { ...OG_SIZE },
  )
}

/**
 * Green shield-pill carrying the EGOV1 wordmark. Same tone family as
 * the verification badge on the proposal About card so a sharer
 * recognises the same chip across surfaces.
 */
function Egov1Shield() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "10px 18px",
        borderRadius: "9999px",
        border: "1.5px solid rgba(52, 211, 153, 0.55)",
        background: "rgba(16, 185, 129, 0.12)",
        color: "#34D399",
        fontSize: "18px",
        fontWeight: 600,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
      }}
    >
      <ShieldGlyph size={18} />
      EGOV1
    </div>
  )
}

function ShieldGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2.5 4 5.5v6c0 4.5 3.2 8.5 8 10 4.8-1.5 8-5.5 8-10v-6l-8-3Z"
        stroke="#34D399"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="rgba(52, 211, 153, 0.18)"
      />
      <path
        d="m9 12 2 2 4-4"
        stroke="#34D399"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Inline Enjin "e" mark: purple disc with the e-glyph cut out. Same
 * vector as /public/brand/enjin-mark.svg so the brand stays
 * pixel-identical. `next/og` doesn't support external <img> refs
 * cheaply on the edge runtime, so we hand it the path directly.
 */
function EnjinMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M0 256C0 114.615 114.615 0 256 0C397.385 0 512 114.615 512 256C512 397.385 397.385 512 256 512C114.615 512 0 397.385 0 256Z"
        fill="#7866D5"
      />
      <path
        d="M232 116C136 116 96 157.017 96 212L96 300C96 354.983 136 396 232 396L325 396C412 396 416 385.501 416 368C416 348.001 408 340 388 340L232 340C184 340 160 316.055 160 292L160 284L388 284C404 284 416 273.5 416 256C416 238.5 404 228 388 228L160 228L160 220C160 195.945 184 172 232 172L388 172C408 172 416 163.999 416 144C416 126.499 412 116 325 116L232 116Z"
        fill="white"
      />
    </svg>
  )
}
