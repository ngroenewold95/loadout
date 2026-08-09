/**
 * RFC 4180 CSV parsing.
 *
 * Written by hand rather than pulled in, because the one thing that matters
 * here is embedded newlines inside quoted fields: 91 rows of the Progression
 * export contain them (56 in `Set Comment`, 35 in `Workout Description`).
 * Splitting on '\n' yields 6,231 rows where the truth is 6,140 — and the
 * damage is silent, because the extra fragments still look like plausible rows.
 */

export interface ParsedCsv {
  header: string[]
  rows: string[][]
  /** 1-based line number in the source file where each row began. */
  rowLines: number[]
}

const BOM = '﻿'

export function parseCsv(input: string): ParsedCsv {
  const text = input.startsWith(BOM) ? input.slice(1) : input

  const rows: string[][] = []
  const rowLines: number[] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let line = 1
  let rowStartLine = 1
  let rowHasContent = false

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    row.push(field)
    field = ''
    // Skip blank trailing lines, but keep genuinely empty fields.
    if (rowHasContent) {
      rows.push(row)
      rowLines.push(rowStartLine)
    }
    row = []
    rowHasContent = false
    rowStartLine = line + 1
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        if (ch === '\n') line++
        field += ch
      }
      continue
    }

    switch (ch) {
      case '"':
        inQuotes = true
        rowHasContent = true
        break
      case ',':
        rowHasContent = true
        endField()
        break
      case '\r':
        break
      case '\n':
        endRow()
        line++
        break
      default:
        rowHasContent = true
        field += ch
    }
  }

  // Final row without a trailing newline.
  if (rowHasContent || field.length > 0 || row.length > 0) endRow()

  if (rows.length === 0) return { header: [], rows: [], rowLines: [] }

  return {
    header: rows[0],
    rows: rows.slice(1),
    rowLines: rowLines.slice(1),
  }
}

/** Index rows by header name, failing loudly on a shape change. */
export function toRecords(
  parsed: ParsedCsv,
): { record: Record<string, string>; line: number }[] {
  const { header, rows, rowLines } = parsed
  return rows.map((row, i) => {
    if (row.length !== header.length) {
      throw new Error(
        `line ${rowLines[i]}: expected ${header.length} fields, got ${row.length}`,
      )
    }
    const record: Record<string, string> = {}
    for (let c = 0; c < header.length; c++) record[header[c]] = row[c]
    return { record, line: rowLines[i] }
  })
}

/**
 * Parse 'HH:MM:SS' or 'HH:MM:SS.mmm' into seconds after midnight.
 *
 * Milliseconds are optional in the export — 27 `Time` values and 4
 * `Set Timestamp` values omit them. Assuming '.mmm' throws away real rows.
 */
export function parseClock(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value.trim())
  if (!m) return null
  const [, h, min, s, ms] = m
  return (
    Number(h) * 3600 +
    Number(min) * 60 +
    Number(s) +
    (ms ? Number(ms.padEnd(3, '0')) / 1000 : 0)
  )
}

/** Parse a numeric CSV field, treating blank as absent rather than zero. */
export function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null
  const t = value.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse a field that must land in an INTEGER column.
 *
 * The export writes reps as "8.00", so this parses as a float and then insists
 * the value is whole — passing "8.00" straight through would be rejected by
 * STRICT, and passing 8.0 silently would hide a genuinely fractional value.
 */
export function parseInteger(value: string | undefined): number | null {
  const n = parseNumber(value)
  if (n === null) return null
  if (!Number.isInteger(n)) return null
  return n
}
