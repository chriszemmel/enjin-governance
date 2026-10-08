/**
 * The share image of one referendum (1200x630): the Enjin mark and
 * "#N · Track" on top, the title filling the middle, and the amount or what
 * the call does at the bottom. Only the title changes size (fitTitle); the
 * rest is fixed so a long title never squeezes the facts.
 */

import { ImageResponse } from "next/og"
import { loadOgFonts } from "./fonts"
import { type CardFact, fitTitle } from "./referendum-facts"

export type ReferendumCard = {
  index: number
  title: string | null
  track: string | null
  fact: CardFact | null
}

const SIZE = { width: 1200, height: 630 }
const ACCENT = "#A99BFF"

const E_PATH =
  "M232 116C136 116 96 157.017 96 212L96 300C96 354.983 136 396 232 396L325 396C412 396 416 385.501 416 368C416 348.001 408 340 388 340L232 340C184 340 160 316.055 160 292L160 284L388 284C404 284 416 273.5 416 256C416 238.5 404 228 388 228L160 228L160 220C160 195.945 184 172 232 172L388 172C408 172 416 163.999 416 144C416 126.499 412 116 325 116L232 116Z"
const DISC =
  "M0 256C0 114.615 114.615 0 256 0C397.385 0 512 114.615 512 256C512 397.385 397.385 512 256 512C114.615 512 0 397.385 0 256Z"

export async function renderReferendumCard(
  card: ReferendumCard,
  headers: Record<string, string>,
): Promise<ImageResponse> {
  const title = fitTitle(card.title ?? `Referendum #${card.index}`)
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
          background: "linear-gradient(160deg, #110c2b 0%, #07051a 55%, #050410 100%)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-260px",
            right: "-300px",
            width: "900px",
            height: "900px",
            borderRadius: "9999px",
            background:
              "radial-gradient(circle, rgba(120,102,213,0.36) 0%, rgba(120,102,213,0.08) 45%, transparent 68%)",
          }}
        />
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

        {/* Top row: brand left, number and track right. */}
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
          <div style={{ display: "flex", alignItems: "center", fontSize: "34px", fontWeight: 500, color: "rgba(255,255,255,0.66)" }}>
            <div style={{ display: "flex", color: "#B7AAFF", fontWeight: 600 }}>#{card.index}</div>
            {card.track && (
              <div style={{ display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", color: "rgba(255,255,255,0.28)", padding: "0 14px" }}>·</div>
                <div style={{ display: "flex" }}>{card.track}</div>
              </div>
            )}
          </div>
        </div>

        {/* Middle: the title, the only part that changes size. */}
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "330px", marginTop: "6px" }}>
          <div
            style={{
              display: "flex",
              fontSize: `${title.size}px`,
              fontWeight: 600,
              lineHeight: 1.08,
              letterSpacing: "-0.03em",
              maxWidth: "1088px",
              ...(title.lines > 1 ? { textWrap: "balance" as const } : { whiteSpace: "nowrap" as const }),
            }}
          >
            {title.text}
          </div>
        </div>

        {/* Bottom: the amount or the action, then the site. */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "flex-end",
            justifyContent: "space-between",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            paddingTop: "20px",
          }}
        >
          <Fact fact={card.fact} />
          <div style={{ display: "flex", fontSize: "26px", fontWeight: 500, color: "rgba(255,255,255,0.48)" }}>
            gov.enjin.cloud
          </div>
        </div>
      </div>
    ),
    { ...SIZE, fonts: await loadOgFonts(), headers },
  )
}

function Fact({ fact }: { fact: CardFact | null }) {
  if (!fact) return <div style={{ display: "flex" }} />
  if (fact.kind === "amount") {
    return (
      <div style={{ display: "flex", fontSize: "56px", fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1, color: ACCENT }}>
        {fact.text}
      </div>
    )
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", fontSize: "44px", fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1, color: ACCENT }}>
        {fact.label}
      </div>
      {fact.detail && (
        <div style={{ display: "flex", fontSize: "22px", fontWeight: 500, lineHeight: 1, color: "rgba(255,255,255,0.5)" }}>
          {fact.detail}
        </div>
      )}
    </div>
  )
}
