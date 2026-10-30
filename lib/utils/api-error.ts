/**
 * Human-readable error from a failed API response. Our routes answer
 * `{ ok: false, error: "…" }`; anything else falls back to the text body or
 * the status code, so a toast never shows raw JSON.
 */
export async function readApiError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  if (text) {
    try {
      const json = JSON.parse(text) as { error?: unknown }
      if (typeof json.error === "string" && json.error) return json.error
    } catch {
      // Not JSON - use the text as is.
    }
    return text
  }
  return `HTTP ${res.status}`
}
