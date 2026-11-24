/**
 * The row a `RETURNING` statement produced. An INSERT always returns its
 * row and an UPDATE by id returns one when the id exists; when there is
 * none, the caller would otherwise hand `undefined` on typed as a row.
 * Throw `missing` instead, so the failure surfaces where it happened.
 */
export function firstRow<T>(rows: readonly T[], missing: string): T {
  const [row] = rows
  if (row === undefined) throw new Error(missing)
  return row
}
