/**
 * A year of training, one square a day.
 *
 * The one view of the history the app did not have. Home says how often
 * training happened lately and the trend says which way volume is going;
 * neither shows the shape of a year - the runs, the weeks off, the month that
 * went missing. This does, and it is the fastest thing on the phone to read.
 *
 * **The empty days are the content.** `calendarDays` returns every day in the
 * window, trained or not, for the same reason `weeklyVolume` seeds its buckets:
 * a calendar drawn only from the days that happened is a calendar with nothing
 * to say.
 *
 * Squares, not a chart library. Fifty-two columns of seven divs need no axis,
 * no tooltip and no `recharts`, and the muscle balance on Home is already built
 * this way.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { useSessionVolumes } from '../state/queries.ts'
import { localDateOf } from '../db/repo.ts'
import { relativeDay } from '../logic/dates.ts'
import { calendarDays, calendarGrid, type CalendarDay } from '../logic/volume.ts'
import { compactWeight, DEFAULT_UNIT } from '../logic/units.ts'
import { useNav } from '../state/nav.ts'

const UNIT = DEFAULT_UNIT

/** A year, in whole weeks. */
const WEEKS = 53

/** Monday first, matching `startOfWeek` and the cadence line on Home. */
const WEEKDAYS = ['M', '', 'W', '', 'F', '', 'S']

/**
 * Four steps plus empty.
 *
 * Fixed thresholds against the window's own busiest day rather than absolute
 * pounds: a light week reads light next to a heavy one, which is the comparison
 * the screen is for. Volume, not sets, because a day of heavy singles and a day
 * of high-rep accessory work are not the same day.
 */
function shade(day: CalendarDay, peak: number): string {
  if (day.sets === 0) return 'bg-surface-1'
  if (peak === 0) return 'bg-primary-container'
  const share = day.volumeKg / peak
  if (share > 0.75) return 'bg-primary'
  if (share > 0.5) return 'bg-primary/75'
  if (share > 0.25) return 'bg-primary/50'
  return 'bg-primary/30'
}

export function TrainingCalendar() {
  const { data: rows } = useSessionVolumes(WEEKS * 7)
  const push = useNav((s) => s.push)
  const today = localDateOf()

  /** The day being read, if any. One at a time, cleared by tapping it again. */
  const [selected, setSelected] = useState<CalendarDay | null>(null)

  /**
   * Open on this week, not on last autumn.
   *
   * Fifty-three columns do not fit a phone, and the grid runs oldest to newest,
   * so the default scroll position showed a year ago and the recent weeks - the
   * only ones anyone opens this screen for - were off the right edge. Measured
   * on device.
   *
   * A layout effect, before paint, so the screen never appears at the left and
   * jump. The dependency is the row count: the first render has no data, and
   * the scroll has to be redone once the grid actually has width.
   */
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [rows?.length])

  if (!rows) {
    return <p className="text-text-dim px-5 py-8 text-sm">Loading…</p>
  }

  const days = calendarDays(rows, today, WEEKS)
  const grid = calendarGrid(days)
  const peak = Math.max(...days.map((d) => d.volumeKg))
  const trained = days.filter((d) => d.sets > 0)

  return (
    <div className="pb-safe-b min-h-0 flex-1 overflow-y-auto px-5 pt-2">
      <h2 className="text-2xl font-semibold">The last year</h2>
      <p className="text-text-dim text-sm tabular-nums">
        {trained.length} {trained.length === 1 ? 'day' : 'days'} trained ·{' '}
        {trained.reduce((sum, d) => sum + d.sets, 0)} sets
      </p>

      {/* The grid scrolls sideways on its own rather than the page: 53 columns
          do not fit a phone, and a body that scrolls horizontally makes every
          other screen feel loose. The weekday column sits OUTSIDE that
          scroller - inside it, scrolling to this week carried the axis off the
          left edge along with the grid. */}
      <div className="mt-4 flex gap-2">
        <div className="flex shrink-0 flex-col gap-1 pt-0.5">
          {WEEKDAYS.map((label, i) => (
            <span
              key={i}
              className="text-text-dim flex h-3 w-3 items-center text-[9px] leading-none"
            >
              {label}
            </span>
          ))}
        </div>

        <div ref={scroller} className="min-w-0 overflow-x-auto">
          <div className="flex gap-1">
            {grid.map((week, w) => (
              <div key={w} className="flex flex-col gap-1">
                {week.map((day, d) =>
                  day == null ? (
                    <span key={d} className="h-3 w-3" />
                  ) : (
                    <button
                      key={d}
                      type="button"
                      aria-label={`${day.localDate}, ${day.sets} sets`}
                      onClick={() =>
                        setSelected((current) =>
                          current?.localDate === day.localDate ? null : day,
                        )
                      }
                      className={`h-3 w-3 rounded-[3px] ${shade(day, peak)} ${
                        selected?.localDate === day.localDate
                          ? 'ring-text ring-1'
                          : day.localDate === today
                            ? 'ring-text-dim ring-1'
                            : ''
                      }`}
                    />
                  ),
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="text-text-dim mt-3 flex items-center gap-2 text-xs">
        <span>Lighter</span>
        <span className="bg-surface-1 h-3 w-3 rounded-[3px]" />
        <span className="bg-primary/30 h-3 w-3 rounded-[3px]" />
        <span className="bg-primary/50 h-3 w-3 rounded-[3px]" />
        <span className="bg-primary/75 h-3 w-3 rounded-[3px]" />
        <span className="bg-primary h-3 w-3 rounded-[3px]" />
        <span>Heavier</span>
      </div>

      {/* A square is 12 px and cannot carry a number, so the day being read
          says itself here rather than in a tooltip a thumb would cover. */}
      <div className="mt-5 min-h-24">
        {selected == null ? (
          <p className="text-text-dim text-sm">Tap a day.</p>
        ) : (
          <div className="bg-surface-1 rounded-xl px-4 py-3">
            <p className="font-medium">
              {selected.localDate}
              <span className="text-text-dim text-sm">
                {' · '}
                {relativeDay(selected.localDate, today)}
              </span>
            </p>
            {selected.sets === 0 ? (
              <p className="text-text-dim mt-1 text-sm">Rest day.</p>
            ) : (
              <>
                <p className="mt-1 text-sm tabular-nums">
                  {selected.sets} sets · {compactWeight(selected.volumeKg, UNIT)} {UNIT}
                </p>
                {selected.sessionId != null && (
                  <button
                    type="button"
                    className="text-primary active:text-text mt-2 text-sm"
                    onClick={() =>
                      push({ kind: 'summary', sessionId: selected.sessionId! })
                    }
                  >
                    Open the workout
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="pb-6" />
    </div>
  )
}
