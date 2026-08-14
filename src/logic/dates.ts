/**
 * How long ago a session was, in words.
 *
 * The reference app labels each history card `22 Jul / 17 days ago`, and the
 * second half is the one that answers the question actually being asked under a
 * bar: not which date it was, but whether it was recent.
 *
 * Pure, and it works on `local_date` strings rather than instants. That is
 * deliberate: `local_date` is ground truth in this schema (see `db/schema.ts`)
 * precisely because the export carries no timezone, so an answer derived from a
 * UTC instant would be the lossy one. "Yesterday" is a wall-clock fact.
 */

/** Days between two `YYYY-MM-DD` strings. Positive when `from` is older. */
export function daysBetween(from: string, to: string): number {
  const a = parseLocalDate(from)
  const b = parseLocalDate(to)
  if (a == null || b == null) return 0
  // Both are UTC midnights, so this is exact - no DST hour to lose. Building
  // them with `new Date('2026-08-13')` would also be UTC, but building them
  // with `new Date(2026, 7, 13)` would not, and the difference is a whole day
  // whenever a clock change falls between the two.
  return Math.round((b - a) / 86_400_000)
}

/** UTC midnight for a `YYYY-MM-DD` string, or null if it is not one. */
function parseLocalDate(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/**
 * `today`, `yesterday`, `17 days ago`, `3 months ago`, `2 years ago`.
 *
 * Months and years are approximations and are meant to be: past a few weeks the
 * exact count stops being informative and starts being noise. The date itself
 * is always rendered beside this, so nothing is lost.
 */
export function relativeDay(date: string, today: string): string {
  const days = daysBetween(date, today)

  if (days < 0) return 'today' // A future date is a clock problem, not a label.
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 45) return `${days} days ago`

  // Years take over at twelve months exactly, because "12 months ago" is what
  // a wider months branch produces at the one-year mark and it reads badly. The
  // information lost above a year is not information anyone wants from this
  // label, and the date itself is rendered beside it.
  const months = Math.round(days / 30.44)
  if (months < 12) return `${months} months ago`

  const years = Math.round(days / 365.25)
  return years === 1 ? '1 year ago' : `${years} years ago`
}
