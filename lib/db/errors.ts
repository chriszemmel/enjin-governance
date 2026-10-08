/** Postgres "relation does not exist": a migration hasn't been applied yet. */
export function isMissingTable(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "42P01"
}
