/**
 * Format-agnostic CSV profiler.
 *
 * Reads any CSV and reports its shape: columns, fill rates, cardinality,
 * numeric ranges, and the structural anomalies that silently corrupt an
 * import. Run it before trusting a new export.
 *
 *   npm run profile [path]
 */
import { readFileSync } from 'node:fs'
import { parseCsv, toRecords, parseNumber } from '../src/logic/csv.ts'

const path = process.argv[2] ?? 'Examples/2026-07-22_08-05-17.csv'
const raw = readFileSync(path, 'utf8')

const hasBom = raw.charCodeAt(0) === 0xfeff
const crlf = (raw.match(/\r\n/g) ?? []).length
const naiveLines = raw.split('\n').filter((l) => l.trim() !== '').length

const parsed = parseCsv(raw)
const records = toRecords(parsed)

console.log(`file            ${path}`)
console.log(`bytes           ${Buffer.byteLength(raw).toLocaleString()}`)
console.log(`BOM             ${hasBom ? 'yes (stripped)' : 'no'}`)
console.log(`line endings    ${crlf > 0 ? `CRLF (${crlf})` : 'LF'}`)
console.log(`columns         ${parsed.header.length}`)
console.log(`data rows       ${records.length}`)
console.log(
  `naive linecount ${naiveLines - 1}` +
    (naiveLines - 1 !== records.length
      ? `  <-- differs by ${naiveLines - 1 - records.length}; embedded newlines`
      : ''),
)

const multiline = records.filter(({ record }) =>
  Object.values(record).some((v) => v.includes('\n')),
)
if (multiline.length > 0) {
  const byCol = new Map<string, number>()
  for (const { record } of multiline)
    for (const [k, v] of Object.entries(record))
      if (v.includes('\n')) byCol.set(k, (byCol.get(k) ?? 0) + 1)
  console.log(`multiline rows  ${multiline.length}`)
  for (const [col, n] of [...byCol].sort((a, b) => b[1] - a[1]))
    console.log(`                  ${String(n).padStart(4)}  in "${col}"`)
}

console.log('\ncolumn profile')
console.log('─'.repeat(78))
for (const col of parsed.header) {
  const values = records.map((r) => r.record[col])
  const filled = values.filter((v) => v.trim() !== '')
  const distinct = new Set(filled)
  const nums = filled.map((v) => parseNumber(v)).filter((n): n is number => n !== null)
  const allNumeric = nums.length === filled.length && filled.length > 0

  const pct = ((filled.length / values.length) * 100).toFixed(1)
  let detail = `filled ${filled.length}/${values.length} (${pct}%)  distinct ${distinct.size}`
  if (allNumeric) {
    const sorted = [...nums].sort((a, b) => a - b)
    detail += `  range ${sorted[0]}..${sorted[sorted.length - 1]}  median ${sorted[Math.floor(sorted.length / 2)]}`
  }
  console.log(`  ${col}`)
  console.log(`      ${detail}`)
  if (distinct.size > 0 && distinct.size <= 8) {
    console.log(`      values: ${[...distinct].map((v) => JSON.stringify(v)).join(', ')}`)
  } else {
    const sample = [...distinct].slice(0, 3).map((v) => JSON.stringify(v.slice(0, 34)))
    console.log(`      e.g.    ${sample.join(', ')}`)
  }
}
