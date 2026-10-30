/**
 * /api/moderation/settings (admins)
 *
 *   GET  the content-check settings, whether an API key is configured,
 *        today's check count and this month's usage with its cost
 *   PUT  the full settings object
 *
 * The API key itself never leaves the server.
 */

import { NextResponse, type NextRequest } from "next/server"
import { requireRole } from "@/lib/auth/roles"
import { scanChecksToday, scanUsageThisMonth } from "@/lib/db/moderation"
import { env } from "@/lib/env"
import { costUsd, scanSettingsSchema } from "@/lib/moderation/scan-settings"
import { getScanSettings, saveScanSettings } from "@/lib/moderation/settings-store"

export const runtime = "nodejs"

export async function GET(): Promise<NextResponse> {
  const admin = await requireRole("admin")
  if (admin instanceof NextResponse) return admin
  const [settings, today, usage] = await Promise.all([
    getScanSettings(),
    scanChecksToday().catch(() => null),
    scanUsageThisMonth().catch(() => null),
  ])
  const month = usage?.map((u) => ({
    ...u,
    cost_usd: costUsd(u.model, u.input_tokens, u.output_tokens),
  }))
  return NextResponse.json(
    {
      ok: true,
      settings,
      api_key_configured: Boolean(env.ANTHROPIC_API_KEY),
      // null when the usage table is missing (migration 012 not applied).
      checks_today: today,
      month: month ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const admin = await requireRole("admin")
  if (admin instanceof NextResponse) return admin
  const parsed = scanSettingsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid settings." }, { status: 400 })
  }
  try {
    await saveScanSettings(parsed.data, admin.publicKey)
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Settings could not be saved. Is migration 012_moderation_settings.sql applied?",
      },
      { status: 503 },
    )
  }
  return NextResponse.json({ ok: true, settings: parsed.data })
}
