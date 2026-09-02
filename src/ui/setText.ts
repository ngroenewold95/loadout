/**
 * How a performed set reads on screen, in one place.
 *
 * Every screen that shows a past set shows it this way - the history cards, the
 * slot rows in the logging screen, and the exercise detail screen. Two copies
 * of "355 lb x 8" would be two things to keep in step, and `PROJECT.md` records
 * what happened the one time set text was assembled ad hoc: the sets of a
 * session were joined with spaces and HTML collapsed them into one unreadable
 * run.
 */
import type { PerformedSet } from '../db/repo.ts'
import { formatDuration } from '../logic/entry.ts'
import { formatWeight, type Unit } from '../logic/units.ts'

/**
 * How much of the set spells itself out.
 *
 * `compact` is what a row under a bar reads: the unit is stated once by the
 * column it sits in, so `355 × 8` is unambiguous and short. `spoken` is for
 * text that leaves the app - the share text - where nothing around it says
 * what the numbers are, so it reads `355 lb × 8 reps`.
 */
export type SetStyle = 'compact' | 'spoken'

export function describeSet(
  set: PerformedSet,
  unit: Unit,
  style: SetStyle = 'compact',
): string {
  const parts: string[] = []
  if (set.weightKg != null) {
    const weight = formatWeight(set.weightKg, unit)
    parts.push(style === 'spoken' ? `${weight} ${unit}` : weight)
  }
  if (set.reps != null) {
    const reps = style === 'spoken' ? `${set.reps} reps` : String(set.reps)
    parts.push(parts.length > 0 ? `× ${reps}` : style === 'spoken' ? reps : `${set.reps} reps`)
  }
  if (set.durationS != null) parts.push(formatDuration(set.durationS))
  if (set.distanceM != null) parts.push(`${set.distanceM} m`)
  return parts.join(' ')
}
