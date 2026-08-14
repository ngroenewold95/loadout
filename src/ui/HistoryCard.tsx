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
 */
import type { PerformedSet } from '../db/repo.ts'
import { relativeDay } from '../logic/dates.ts'
import type { Unit } from '../logic/units.ts'

interface Props {
  localDate: string
  /** Today, as a `local_date` string. Passed in so this stays pure to render. */
  today: string
  sets: PerformedSet[]
  unit: Unit
  /**
   * Slot index the entry bar is aiming at, or null when it is aiming at
   * nothing. The row at this index is the one lit.
   */
  activeIndex: number | null
  describe: (set: PerformedSet, unit: Unit) => string
}

export function HistoryCard({
  localDate,
  today,
  sets,
  unit,
  activeIndex,
  describe,
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
          return (
            <div key={set.id} className="flex items-center gap-3 text-sm">
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                  lit ? 'bg-primary text-on-primary' : 'bg-muted text-text-dim'
                }`}
              >
                {i + 1}
              </span>
              <span className={`tabular-nums ${lit ? 'text-text' : 'text-text-dim'}`}>
                {describe(set, unit)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
