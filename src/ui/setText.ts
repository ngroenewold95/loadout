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

export function describeSet(set: PerformedSet, unit: Unit): string {
  const parts: string[] = []
  if (set.weightKg != null) parts.push(`${formatWeight(set.weightKg, unit)}`)
  if (set.reps != null) parts.push(parts.length > 0 ? `× ${set.reps}` : `${set.reps} reps`)
  if (set.durationS != null) parts.push(formatDuration(set.durationS))
  if (set.distanceM != null) parts.push(`${set.distanceM} m`)
  return parts.join(' ')
}
