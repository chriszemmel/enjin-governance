"use client"

import { useMemo } from "react"
import QRCode from "qrcode"

interface BrandedQrProps {
  uri: string
  /** CSS size in px. */
  size?: number
  /**
   * Centre-logo URL. Defaults to the Enjin mark; pass the WalletConnect
   * logo (or another wallet's icon) when surfacing the generic
   * WalletConnect flow so the QR doesn't read as Enjin-specific.
   */
  logoUrl?: string
  /** Accessible label override. */
  ariaLabel?: string
}

const ENJIN_MARK_URL = "/brand/enjin-mark.svg"

const QUIET = 2

// Diameter of the carved white circle, as a fraction of QR side.
// The brand marks (Enjin, WalletConnect, …) are all circular, so a
// circular carve hugs their bounds - the QR corners stay populated
// (less data damage than a square carve of the same diameter), and
// the white margin around the visible logo edge is visually uniform.
//
// Sized for breathing room: ~26% diameter, which gives the visible
// logo (drawn at LOGO_RATIO of that) ~4% margin per side before the
// nearest QR cell. The skipped-cell budget stays well inside the
// ~30% damage tolerance level-H allows.
const HOLE_DIAMETER_RATIO = 0.26

// Logo diameter as a fraction of the carved-circle diameter. The
// remainder is the white halo between the logo edge and the carved
// boundary - i.e. the visible separation between the logo and the
// QR cells.
const LOGO_RATIO = 0.72

/**
 * QR with a centred logo. Level-H error correction lets us carve a
 * white circle through the data layer; we skip any QR cell that the
 * carve circle touches (not just cells whose centres fall inside),
 * so no black square ever pokes into the white halo. The logo is
 * drawn into a square `<image>` element sized smaller than the
 * carve, leaving a uniform visible margin between the logo edge and
 * the nearest QR cell.
 */
export function BrandedQr({
  uri,
  size = 280,
  logoUrl = ENJIN_MARK_URL,
  ariaLabel = "WalletConnect QR code",
}: BrandedQrProps) {
  const qr = useMemo(() => {
    const created = QRCode.create(uri, { errorCorrectionLevel: "H" })
    const n = created.modules.size
    const data = created.modules.data as Uint8Array
    const total = n + QUIET * 2

    const cx = QUIET + n / 2
    const cy = QUIET + n / 2
    const holeRadius = (n * HOLE_DIAMETER_RATIO) / 2
    const holeR2 = holeRadius * holeRadius
    const logoRadius = holeRadius * LOGO_RATIO

    const cells: string[] = []
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (data[r * n + c] !== 1) continue
        const x = QUIET + c
        const y = QUIET + r
        // Closest point on the cell rect [x..x+1, y..y+1] to the
        // carve centre. Skipping by closest-point-distance (not cell
        // centre) means any cell the carve circle even clips into is
        // dropped - no half-black bites at the rim.
        const nearestX = Math.max(x, Math.min(x + 1, cx))
        const nearestY = Math.max(y, Math.min(y + 1, cy))
        const dx = nearestX - cx
        const dy = nearestY - cy
        if (dx * dx + dy * dy < holeR2) continue
        cells.push(`M${x} ${y}h1v1h-1z`)
      }
    }

    return {
      total,
      path: cells.join(""),
      cx,
      cy,
      holeRadius,
      logoStart: cx - logoRadius,
      logoUnits: logoRadius * 2,
    }
  }, [uri])

  return (
    <svg
      viewBox={`0 0 ${qr.total} ${qr.total}`}
      width={size}
      height={size}
      role="img"
      aria-label={ariaLabel}
      className="rounded-lg"
    >
      <rect width={qr.total} height={qr.total} fill="#ffffff" />
      <path d={qr.path} fill="#0a0820" shapeRendering="crispEdges" />
      <circle
        cx={qr.cx}
        cy={qr.cy}
        r={qr.holeRadius}
        fill="#ffffff"
      />
      <image
        href={logoUrl}
        x={qr.logoStart}
        y={qr.logoStart}
        width={qr.logoUnits}
        height={qr.logoUnits}
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  )
}
