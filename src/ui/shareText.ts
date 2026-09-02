/**
 * A finished workout as plain text, for the clipboard.
 *
 * Patterned on the reference app's share button, which is how a workout leaves
 * that app and lands in a message. The shape is the same - a heading, the
 * totals, then every set under its exercise - with two deliberate differences
 * recorded here rather than left to be re-argued:
 *
 * - **Volume is stated in the unit the app logs in**, not in tons. This is an
 *   lb app throughout, and a unit nobody trains in is a worse headline than a
 *   bigger number.
 * - **Assistance stays out of the volume line and in the rep line**, which is
 *   the rule `sessionTotals` already applies. A higher number on an Assisted
 *   Chinup is an easier set, so summing it as load would send someone a message
 *   claiming their best session was their worst.
 *
 * Pure, and tested as such: the format is provable without a phone, a database
 * or a clipboard.
 */
import type { PerformedSet } from '../db/repo.ts'
import { formatDuration } from '../logic/entry.ts'
import { groupByExercise, isWorkingSet, sessionTotals } from '../logic/session.ts'
import { formatWeight, type Unit } from '../logic/units.ts'
import { describeSet } from './setText.ts'

/** The least a session has to be to be described. Mirrors `SessionRow`. */
export interface ShareableSession {
  name: string | null
  startedAtUtc: number
  endedAtUtc: number | null
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/**
 * `25 Aug 5:05 PM`, built by hand rather than by `toLocaleString`.
 *
 * The locale format is the device's to choose and would make this untestable,
 * and the text is being pasted into a message where a stable shape matters more
 * than matching the phone's date settings.
 */
function stamp(at: Date): string {
  const hour24 = at.getHours()
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12
  const minute = String(at.getMinutes()).padStart(2, '0')
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${hour}:${minute} ${hour24 < 12 ? 'AM' : 'PM'}`
}

/** `7543590` reads as `7,543,590`. A five-year total is unreadable without it. */
function groupDigits(value: string): string {
  const [whole, fraction] = value.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fraction ? `${grouped}.${fraction}` : grouped
}

function plural(n: number, word: string): string {
  return `${groupDigits(String(n))} ${n === 1 ? word : `${word}s`}`
}

export function shareText(
  session: ShareableSession,
  sets: readonly PerformedSet[],
  unit: Unit,
): string {
  const totals = sessionTotals(sets)
  const durationS = Math.max(
    0,
    Math.round(((session.endedAtUtc ?? Date.now()) - session.startedAtUtc) / 1000),
  )

  const lines: string[] = [
    session.name ?? 'Workout',
    stamp(new Date(session.startedAtUtc)),
    '',
    formatDuration(durationS),
    plural(totals.sets, 'set'),
    plural(totals.reps, 'rep'),
    `${groupDigits(formatWeight(totals.volumeKg, unit))} ${unit}`,
  ]

  for (const group of groupByExercise(sets)) {
    lines.push('', group.name)
    // Warm-ups are listed but not numbered, and they do not advance the count:
    // they are outside the plan, so calling one "set 1" would put the working
    // sets a number out of step with everything else that describes them.
    let n = 0
    for (const set of group.sets) {
      const label = isWorkingSet(set) ? `${++n}.` : 'W.'
      lines.push(`${label} ${describeSet(set, unit, 'spoken')}`)
    }
  }

  return lines.join('\n')
}
