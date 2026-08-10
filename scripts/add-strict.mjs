/**
 * Post-process drizzle-kit output to add STRICT to every CREATE TABLE.
 * drizzle-kit has no option for this.
 *
 * Measured behaviour (SQLite 3.53.4) - STRICT is narrower than it sounds:
 *
 *   REJECTED  'abc' -> REAL      (without STRICT, stores the literal text)
 *   REJECTED  ''    -> REAL      the important one: the export has 274 blank
 *                                Weight fields and 49 blank Repetitions, so
 *                                passing '' instead of null is a live bug shape
 *   REJECTED  '8.5' -> INTEGER   relevant: Repetitions arrive as "8.00"
 *   ACCEPTED  '130.00' -> REAL   coerced to 130, STRICT does NOT catch this
 *   ACCEPTED  '  12 ', '1e3'     whitespace and exponent forms are coerced too
 *
 * So it is a guard against blank and malformed CSV fields reaching numeric
 * columns, not a guarantee that values arrived pre-parsed. The importer still
 * has to parse properly; this catches the cases where it forgets.
 *
 * Runs automatically after `npm run db:generate`. Idempotent.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'drizzle'

// A CREATE TABLE block ends with a `)` alone on a line, then `;`.
const TABLE_BLOCK = /(CREATE TABLE[\s\S]*?\n\))(;)/g

let touched = 0

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql'))) {
  const path = join(DIR, file)
  const before = readFileSync(path, 'utf8')
  const after = before.replace(TABLE_BLOCK, (match, body, semi) =>
    body.endsWith(' STRICT') ? match : `${body} STRICT${semi}`,
  )
  if (after !== before) {
    writeFileSync(path, after)
    const n = (after.match(/\) STRICT;/g) ?? []).length
    console.log(`  ${file}: STRICT applied to ${n} table(s)`)
    touched++
  }
}

console.log(touched === 0 ? '  all migrations already STRICT' : `  ${touched} file(s) updated`)
