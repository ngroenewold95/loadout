/**
 * Unit conversion.
 *
 * Storage rule: every weight is persisted as kilograms. Conversion happens only
 * at input parse and at render. The originally-entered value and unit are also
 * stored on the set, purely so history displays what was actually typed.
 *
 * This matters more than it looks: 100% of the five years of imported history
 * was logged in pounds, so every historical kg value is a converted float.
 */

export type Unit = 'kg' | 'lb'

/** Exact by international definition - not an approximation. */
export const LB_TO_KG = 0.45359237

/**
 * Decimal places kg values are rounded to before storage.
 *
 * 9 of the 105 distinct weights in the Progression export fail a bit-exact
 * lb -> kg -> lb round trip (drift ~3e-14). That is invisible on screen but
 * fatal for `WHERE weight_kg = ?`. Quantising on write makes stored values
 * comparable; see `weightsEqual` for the read side.
 */
const STORAGE_DP = 4

const round = (value: number, dp: number): number => {
  const f = 10 ** dp
  // Math.round on the scaled value, with a nudge to counter representation
  // error in values like 2.675 * 100 = 267.49999999999997.
  return Math.round((value + Number.EPSILON * Math.abs(value)) * f) / f
}

/**
 * Snap a kg value onto the storage grid (0.1 g steps).
 *
 * Anything compared against a stored weight must go through this first,
 * otherwise a freshly-computed value sits between grid points and no sane
 * epsilon can match it.
 */
export function quantize(kg: number): number {
  return round(kg, STORAGE_DP)
}

/** Convert a user-entered value to canonical storage kg. */
export function toKg(value: number, from: Unit): number {
  return quantize(from === 'kg' ? value : value * LB_TO_KG)
}

/** Convert canonical storage kg to a display unit. Not rounded for display. */
export function fromKg(kg: number, to: Unit): number {
  return to === 'kg' ? kg : kg / LB_TO_KG
}

/**
 * Smallest increment each unit is displayed and stepped at.
 *
 * lb is 0.25, deliberately not 0.5: the export contains a logged 37.25 lb, and
 * rounding display to the nearest half pound would silently render it as 37.5.
 */
export const DISPLAY_STEP: Record<Unit, number> = { kg: 0.1, lb: 0.25 }

/**
 * What a screen shows when it has no exercise to ask.
 *
 * **100% of five years of history is lb** - one distinct `Weight Unit` value in
 * the whole export - and `app_settings` has no unit column, so this is a
 * constant rather than a setting. It exists because three screens had the same
 * hard-coded `const UNIT: Unit = 'lb'` and three copies of a decision is three
 * places to change it.
 */
export const DEFAULT_UNIT: Unit = 'lb'

/** Round a display-unit value to that unit's display granularity. */
export function roundForDisplay(value: number, unit: Unit): number {
  const step = DISPLAY_STEP[unit]
  return round(Math.round(value / step) * step, 4)
}

/** Format canonical kg for display, dropping trailing zeros. */
export function formatWeight(kg: number, unit: Unit): string {
  const v = roundForDisplay(fromKg(kg, unit), unit)
  return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(2)))
}

/**
 * Format a large total for display, shortened.
 *
 * Only for lifetime and multi-session totals: five years of history is
 * 7,543,590 lb, which `formatWeight` renders as a seven-digit run that nobody
 * reads as a number. A single session stays on `formatWeight`, where the figure
 * is four or five digits and the exact value is the point.
 *
 * The threshold is 10,000 rather than 1,000 because a four-digit session volume
 * is still read at a glance, and `5.7k lb` would be a worse rendering of it.
 */
export function compactWeight(kg: number, unit: Unit): string {
  const v = fromKg(kg, unit)
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${round(v / 1_000_000, 1)}M`
  if (abs >= 10_000) return `${Math.round(v / 1000)}k`
  return formatWeight(kg, unit)
}

/**
 * Compare two weights in kg. Always use this rather than `===`.
 *
 * Both sides are snapped to the storage grid before comparing, so a value read
 * from the database and a value just computed from user input land on the same
 * point. That asymmetry is the real hazard - it is exactly the shape of PR
 * detection ("is today's lift equal to the stored best?"), and a naive epsilon
 * smaller than the quantisation step gets it wrong every time.
 */
export function weightsEqual(a: number, b: number): boolean {
  return Math.abs(quantize(a) - quantize(b)) < 1e-6
}

/** Ordering helper that respects the same tolerance. */
export function compareWeights(a: number, b: number): -1 | 0 | 1 {
  if (weightsEqual(a, b)) return 0
  return a < b ? -1 : 1
}
