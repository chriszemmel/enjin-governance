import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { SESSION_COOKIE, hashToken } from "@/lib/auth/siwe"
import { deleteSession } from "@/lib/db/sessions"
import { isDbConfigured } from "@/lib/db/client"

export const runtime = "nodejs"

export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (token && isDbConfigured()) {
    try {
      await deleteSession(hashToken(token))
    } catch {
      /* best-effort */
    }
  }
  const response = NextResponse.json({ ok: true })
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
  return response
}
