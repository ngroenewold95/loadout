/**
 * Volume over time, as weeks.
 *
 * Home already says how *often* training happened and where the work went. What
 * it never said is which way any of it is going, and that question is only
 * answerable over weeks: the programme is A/B rolling and explicitly not pinned
 * to weekdays, so a single session is noise and a calendar month cuts a
 * rotation in half.
 *
 * Pure, over rows the repo returns. The bucketing lives here rather than in SQL
 * for the reason `logic/dates.ts` exists: `local_date` is a string, `startOfWeek`
 * already owns the Monday rule that the cadence line uses, and a second
 * definition of a training week written in SQLite date functions would be free
 * to disagree with it.
 */
import { daysAgo, startOfWeek } from './dates.ts'

/** The least a session row has to be. Mirrors `SessionVolumeRow`. */
export interface VolumeRow {
  localDate: string
  volumeKg: number | null
}

export interface VolumeWeek {
  /** The Monday the week starts on, as `YYYY-MM-DD`. */
  weekStart: string
  volumeKg: number
  sessions: number
}

/**
 * The last `weeks` weeks, oldest first, including the weeks nothing happened.
 *
 * **A week with no training is a zero, not a gap.** Dropping it would draw a
 * line straight over a fortnight off and claim the volume held, which is the
 * one thing a trend is read to find out. This is the opposite of `trendSeries`,
 * which drops sessions that carry no plottable number - there the gap is a hole
 * in the record, here it is a fact about the week.
 */
export function weeklyVolume(
  rows: readonly VolumeRow[],
  today: string,
  weeks: number,
): VolumeWeek[] {
  const buckets = new Map<string, VolumeWeek>()
  const thisWeek = startOfWeek(today)

  // Seeded oldest first, so the map's insertion order is the order drawn.
  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = daysAgo(thisWeek, i * 7)
    buckets.set(weekStart, { weekStart, volumeKg: 0, sessions: 0 })
  }

  for (const row of rows) {
    const bucket = buckets.get(startOfWeek(row.localDate))
    // A row older than the window asked for is ignored rather than folded into
    // the first bucket, which would make the oldest week read high every time.
    if (!bucket) continue
    bucket.volumeKg += row.volumeKg ?? 0
    bucket.sessions += 1
  }

  return [...buckets.values()]
}

export interface PeriodComparison {
  currentKg: number
  previousKg: number
  /** Null when there is nothing to divide by - the first month of training. */
  changePct: number | null
}

/**
 * This period against the one before it, both `days` long.
 *
 * Four weeks against the previous four by default, which is the same window the
 * muscle balance and the readiness list already use, so Home is not comparing
 * three different ideas of "lately".
 */
export function periodOverPeriod(
  rows: readonly VolumeRow[],
  today: string,
  days = 28,
): PeriodComparison {
  const currentFrom = daysAgo(today, days - 1)
  const previousFrom = daysAgo(today, days * 2 - 1)

  let currentKg = 0
  let previousKg = 0
  for (const row of rows) {
    if (row.localDate >= currentFrom) currentKg += row.volumeKg ?? 0
    else if (row.localDate >= previousFrom) previousKg += row.volumeKg ?? 0
  }

  return {
    currentKg,
    previousKg,
    changePct: previousKg > 0 ? ((currentKg - previousKg) / previousKg) * 100 : null,
  }
}

export interface CalendarDay {
  localDate: string
  volumeKg: number
  sets: number
  /** The workout to open. The newest one, on the rare day with two. */
  sessionId: number | null
}

/** The least a row has to be to land on a calendar day. */
export interface CalendarRow extends VolumeRow {
  sessionId: number
  setCount: number
}

/**
 * Every day from `weeks` Mondays ago to today, in calendar order.
 *
 * A day that was not trained is present and empty rather than missing, for the
 * same reason `weeklyVolume` seeds its buckets: the gaps are the point of a
 * calendar. The run starts on a Monday and ends on today, so the caller can
 * lay it out in columns of seven without arithmetic of its own.
 *
 * The count is days, not sessions, so it is O(weeks) regardless of how much
 * training is in the window.
 */
export function calendarDays(
  rows: readonly CalendarRow[],
  today: string,
  weeks: number,
): CalendarDay[] {
  const byDate = new Map<string, CalendarDay>()
  const start = daysAgo(startOfWeek(today), (weeks - 1) * 7)

  for (let cursor = start; cursor <= today; cursor = daysAgo(cursor, -1)) {
    byDate.set(cursor, { localDate: cursor, volumeKg: 0, sets: 0, sessionId: null })
  }

  for (const row of rows) {
    const day = byDate.get(row.localDate)
    if (!day) continue
    day.volumeKg += row.volumeKg ?? 0
    day.sets += row.setCount
    day.sessionId = row.sessionId
  }

  return [...byDate.values()]
}

/**
 * The same days, cut into weeks of seven for a column-per-week grid.
 *
 * The last week is short - it ends on today - and is padded with nulls so
 * every column is seven cells and nothing has to reason about a ragged end.
 */
export function calendarGrid(days: readonly CalendarDay[]): (CalendarDay | null)[][] {
  const columns: (CalendarDay | null)[][] = []
  for (let i = 0; i < days.length; i += 7) {
    const week: (CalendarDay | null)[] = days.slice(i, i + 7)
    while (week.length < 7) week.push(null)
    columns.push(week)
  }
  return columns
}

/** The least a row has to be to land in a muscle week. */
export interface MuscleRow {
  localDate: string
  muscle: string | null
  sets: number
}

export interface MuscleWeek {
  weekStart: string
  /** Sets per group, including the null group under the key `other`. */
  sets: Map<string, number>
  total: number
}

/** The key a null group is filed under, matching what the legend renders. */
export const OTHER = 'other'

/**
 * Sets per muscle group per week, oldest first, empty weeks included.
 *
 * **Sets rather than volume, deliberately**, and the same choice `setsByMuscle`
 * makes: the groups are loaded in completely different ranges, so a leg day
 * would outweigh an arm day several times over on volume while saying nothing
 * about how the work was distributed.
 */
export function muscleWeeks(
  rows: readonly MuscleRow[],
  today: string,
  weeks: number,
): MuscleWeek[] {
  const buckets = new Map<string, MuscleWeek>()
  const thisWeek = startOfWeek(today)

  for (let i = weeks - 1; i >= 0; i--) {
    const weekStart = daysAgo(thisWeek, i * 7)
    buckets.set(weekStart, { weekStart, sets: new Map(), total: 0 })
  }

  for (const row of rows) {
    const bucket = buckets.get(startOfWeek(row.localDate))
    if (!bucket) continue
    const key = row.muscle ?? OTHER
    bucket.sets.set(key, (bucket.sets.get(key) ?? 0) + row.sets)
    bucket.total += row.sets
  }

  return [...buckets.values()]
}
