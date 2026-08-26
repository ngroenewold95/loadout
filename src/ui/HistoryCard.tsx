/**
 * One past session of one exercise.
 *
 * `docs/PROGRESSION.md` calls the highlight below the single highest-value
 * detail found in the whole investigation, and it is the reason this is a stack
 * of numbered rows rather than the one-line run of text it replaces: **the
 * history row matching the set you are about to do is lit.** On set 1 the `1`
 * lights; once set 1 is logged the highlight moves to `2`. "What did I do for
 * this set last time" is then answered without reading, which is the only way it
 * gets answered at all under a bar.
 *
 * Rows are separate elements rather than a joined string. HTML collapses runs of
 * whitespace, and `PROJECT.md` records what that looked like the first time:
 * `355 × 8   355 × 8` rendered as one unreadable line.
 *
 * **Tapping a row loads it into the entry bar**, without logging anything. The
 * card answers "what did I do for this set last time" already; this is the
 * shortest way to act on the answer, and it is how you get back to a weight you
 * have not done since June without scrubbing to it.
 *
 * Today's own slots keep their meaning - a tap there aims the bar at that set to
 * CORRECT it. The two never collide, because a past set cannot be corrected from
 * here and a set from today is not in this card.
 */
import type { PerformedSet } from '../db/repo.ts'
import { relativeDay } from '../logic/dates.ts'
import type { Unit } from '../logic/units.ts'
import { describeSet } from './setText.ts'

interface Props {
  localDate: string
  /** Today, as a `local_date` string. Passed in so this stays pure to render. */
  today: string
  sets: PerformedSet[]
  unit: Unit
  /**
   * Slot index the entry bar is aiming at, or null when it is aiming at
   * nothing. The row at this index is the one lit. Absent where there is no
   * set being aimed at, which is every screen outside a live workout.
   */
  activeIndex?: number | null
  /**
   * Load this set's numbers into the entry bar. Logs nothing.
   *
   * Optional, and its absence is what makes the card read-only: the exercise
   * detail screen shows the same history with nothing to load it into.
   */
  onPick?: (set: PerformedSet) => void
}

export function HistoryCard({
  localDate,
  today,
  sets,
  unit,
  activeIndex = null,
  onPick,
}: Props) {
  return (
    <div className="bg-surface-1 rounded-xl p-3">
      <p className="text-text-dim flex items-baseline justify-between gap-2 text-xs tracking-wide uppercase">
        <span>{localDate}</span>
        <span className="normal-case opacity-70">{relativeDay(localDate, today)}</span>
      </p>

      <div className="mt-2 flex flex-col gap-1">
        {sets.map((set, i) => {
          const lit = i === activeIndex
          // A button only where there is somewhere to send the numbers. A
          // tappable row that does nothing is worse than a plain one.
          const Row = onPick ? 'button' : 'div'
          return (
            <Row
              key={set.id}
              {...(onPick ? { type: 'button' as const, onClick: () => onPick(set) } : {})}
              // Full width, so the target is the row rather than the text on it.
              // These are read under a bar, one-handed.
              className={`-mx-1 flex items-center gap-3 rounded-lg px-1 py-1 text-left text-sm ${
                onPick ? 'active:bg-surface-3' : ''
              }`}
            >
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                  lit ? 'bg-primary text-on-primary' : 'bg-muted text-text-dim'
                }`}
              >
                {i + 1}
              </span>
              <span className={`tabular-nums ${lit ? 'text-text' : 'text-text-dim'}`}>
                {describeSet(set, unit)}
              </span>
            </Row>
          )
        })}
      </div>
    </div>
  )
}
