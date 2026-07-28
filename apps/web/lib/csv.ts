/**
 * Tiny CSV helpers — RFC 4180 compliant enough for Excel, Google
 * Sheets, and `pandas.read_csv`.
 *
 * We don't pull in a CSV library because the only transformations we
 * do (escape, quote, join) are trivial, and adding a dependency for
 * them would obscure more than it removes.
 */

/** Escape one cell — quote and escape inner quotes if it contains
 *  comma, quote, newline, or carriage return. */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** Build a CSV string from a header row and an array of rows.
 *  Each row may be a plain object (keys == headers) or an array. */
export function toCsv(
  headers: string[],
  rows: Array<Record<string, unknown> | unknown[]>
): string {
  const lines: string[] = [headers.map(csvEscape).join(',')]
  for (const row of rows) {
    if (Array.isArray(row)) {
      lines.push(row.map(csvEscape).join(','))
    } else {
      lines.push(headers.map((h) => csvEscape(row[h])).join(','))
    }
  }
  return lines.join('\r\n')
}
