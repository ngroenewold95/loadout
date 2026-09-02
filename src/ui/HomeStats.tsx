/**
 * What Home says about training so far.
 *
 * The ordering principle: **actionable first, then honest description, then
 * totals.** A lifetime volume figure is the easiest thing to compute and the
 * least useful thing to read under a bar, so it is one quiet line at the bottom
 * rather than the headline it would naturally become.
 *
 * There is deliberately no PR, e1RM or "strength score" here. `docs/PROJECT.md`
 * records Epley as wrong at reps=1 (141 rows), unreliable above ~10 reps (844
 * rows), incoherent for duration and distance work, and inverted for
 * `assistance`. That is a data model to be built and argued about, not a tile.
 */
import {
  useHistoryStats,
  useReadyToAddLoad,
  useSessionVolumes,
  useSetsByMuscle,
  useSetsByMuscleDay,
} from '../state/queries.ts'
import { localDateOf } from '../db/repo.ts'
import { relativeDay } from '../logic/dates.ts'
import { muscleMark } from '../logic/muscles.ts'
import { compactWeight, DEFAULT_UNIT } from '../logic/units.ts'
import { muscleWeeks, OTHER, periodOverPeriod, weeklyVolume } from '../logic/volume.ts'
import { GroupWord } from './GroupTag.tsx'

const UNIT = DEFAULT_UNIT

/** Weeks in the muscle trend. A quarter, matching the volume sparkline. */
const MUSCLE_WEEKS = 12

export function HomeStats() {
  return (
    <div className="flex flex-col gap-3">
      <ReadyToAddLoad />
      <Cadence />
      <VolumeTrend />
      <MuscleBalance />
      <Lifetime />
    </div>
  )
}

/**
 * The one thing on Home worth acting on.
 *
 * "Top of the range on every set -> add load" is the programme's own rule, and
 * `shouldIncreaseLoad` has encoded it since before there was a logging screen.
 * The workout already says this per exercise once you are standing in front of
 * the machine; saying it before the workout starts is what lets the numbers be
 * decided at home rather than under a bar.
 *
 * **Renders nothing when nothing earned it.** A proud `0 ready` would be a
 * number on screen that nobody can act on.
 */
function ReadyToAddLoad() {
  const { template, exercises } = useReadyToAddLoad()
  if (!template || exercises.length === 0) return null

  return (
    <section className="bg-surface-1 rounded-xl px-4 py-3">
      <h2 className="font-medium">
        {exercises.length} {exercises.length === 1 ? 'exercise' : 'exercises'} ready for
        more load
      </h2>
      <p className="text-text-dim text-xs tracking-wide uppercase">{template.name}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {exercises.map((exercise) => (
          <li key={exercise.exerciseId} className="flex items-baseline gap-2 text-sm">
            <GroupWord primaryMuscle={exercise.primaryMuscle} />
            <span className="truncate">{exercise.name}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * How often, lately.
 *
 * Weeks rather than days, and a four-week average beside this week's count,
 * because the programme is A/B **rolling** and explicitly not pinned to
 * weekdays: a single week is too short a window to say anything, and a streak
 * counted in days would punish the rest days the plan asks for.
 */
function Cadence() {
  const { data: stats } = useHistoryStats()
  if (!stats || stats.sessions === 0) return null

  const perWeek = (stats.last28 / 4).toFixed(1)

  return (
    <p className="text-sm">
      <span className="font-medium tabular-nums">{stats.thisWeek} this week</span>
      <span className="text-text-dim">
        {' · '}
        {perWeek} per week over 4 weeks
        {stats.lastDate && ` · last trained ${relativeDay(stats.lastDate, localDateOf())}`}
      </span>
    </p>
  )
}

/** Weeks drawn. A quarter is long enough to show a direction and still fit. */
const WEEKS = 12

/**
 * Which way training is going, as one row of bars.
 *
 * **Drawn as plain elements, not with `recharts`.** The chart on the exercise
 * detail screen has axes, a tooltip and a unit to label; this has twelve
 * numbers and no room for any of that, and a stacked bar built the same way is
 * already the muscle balance below. Nothing here needs a chart library.
 *
 * The comparison beside it is the same 28-day window the readiness list and the
 * muscle balance use, so Home is not holding three different ideas of "lately".
 */
function VolumeTrend() {
  // One read covers both: the sparkline needs 12 weeks, the comparison needs
  // eight, so the longer window answers both and they cannot disagree.
  const { data: rows } = useSessionVolumes(WEEKS * 7)
  const today = localDateOf()
  if (!rows || rows.length === 0) return null

  const weeks = weeklyVolume(rows, today, WEEKS)
  const peak = Math.max(...weeks.map((w) => w.volumeKg))
  if (peak === 0) return null

  const change = periodOverPeriod(rows, today)

  return (
    <section>
      <h2 className="text-text-dim flex items-baseline justify-between gap-2 text-xs tracking-wide uppercase">
        <span>Volume · {WEEKS} weeks</span>
        {change.changePct != null && (
          <span className="normal-case tabular-nums">
            {change.changePct >= 0 ? '+' : ''}
            {Math.round(change.changePct)}% vs previous 4 weeks
          </span>
        )}
      </h2>

      <div className="mt-2 flex h-12 items-end gap-1">
        {weeks.map((week, i) => (
          <div
            key={week.weekStart}
            // A week with no training draws a flat sliver rather than nothing,
            // so the gap is visible as a gap instead of as missing data.
            className={`min-h-px flex-1 rounded-sm ${
              i === weeks.length - 1 ? 'bg-primary' : 'bg-muted'
            }`}
            style={{ height: `${(week.volumeKg / peak) * 100}%` }}
          />
        ))}
      </div>

      <p className="text-text-dim mt-1 text-xs tabular-nums">
        {compactWeight(change.currentKg, UNIT)} {UNIT} in 4 weeks
        {change.previousKg > 0 &&
          `, after ${compactWeight(change.previousKg, UNIT)} ${UNIT}`}
      </p>
    </section>
  )
}

/**
 * Where the last four weeks of work went.
 *
 * **Sets, not volume.** The groups being compared are loaded in completely
 * different ranges - a leg day outweighs an arm day several times over on
 * volume while saying nothing about how the work was distributed. Counting sets
 * is the comparison actually being made.
 *
 * The four unclassified exercises are cardio and general mobility and come back
 * with a null group. They get the neutral colour and the word `other`, the same
 * refusal to guess that `muscleMark` makes everywhere else.
 */
function MuscleBalance() {
  const { data: rows } = useSetsByMuscle()
  if (!rows || rows.length === 0) return null

  const total = rows.reduce((sum, row) => sum + row.sets, 0)
  if (total === 0) return null

  return (
    <section>
      <h2 className="text-text-dim text-xs tracking-wide uppercase">
        Last 4 weeks · {total} sets
      </h2>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full">
        {rows.map((row) => (
          <span
            key={row.muscle ?? 'other'}
            className="h-full"
            style={{
              width: `${(row.sets / total) * 100}%`,
              backgroundColor: muscleMark(row.muscle).color,
            }}
          />
        ))}
      </div>
      <MuscleTrend />

      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {rows.map((row) => (
          <li key={row.muscle ?? 'other'} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ backgroundColor: muscleMark(row.muscle).color }}
            />
            <span className="text-text-dim">
              {muscleMark(row.muscle).muscle ?? 'other'} {row.sets}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The same question over time: has the balance held, week by week.
 *
 * One stacked column per week, each column scaled to its own total so a light
 * week and a heavy one can be compared on shape rather than on height. The
 * height a column does carry is its share of the busiest week, so a week off
 * still reads as a week off.
 *
 * **Sets, not volume**, the same choice the bar above it makes and for the same
 * reason: a leg day outweighs an arm day several times over on volume and says
 * nothing about where the work went.
 */
function MuscleTrend() {
  const { data: rows } = useSetsByMuscleDay(MUSCLE_WEEKS * 7)
  if (!rows || rows.length === 0) return null

  const weeks = muscleWeeks(rows, localDateOf(), MUSCLE_WEEKS)
  const peak = Math.max(...weeks.map((w) => w.total))
  if (peak === 0) return null

  return (
    <div className="mt-3 flex h-14 items-end gap-1" aria-hidden="true">
      {weeks.map((week) => (
        <div
          key={week.weekStart}
          className="flex min-h-px flex-1 flex-col-reverse overflow-hidden rounded-sm"
          style={{ height: `${(week.total / peak) * 100}%` }}
        >
          {[...week.sets.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([muscle, sets]) => (
              <span
                key={muscle}
                style={{
                  height: `${(sets / week.total) * 100}%`,
                  backgroundColor: muscleMark(muscle === OTHER ? null : muscle).color,
                }}
              />
            ))}
        </div>
      ))}
    </div>
  )
}

/** Five years, as one line. Not tiles: this is context, not a dashboard. */
function Lifetime() {
  const { data: stats } = useHistoryStats()
  if (!stats || stats.sessions === 0) return null

  const parts = [
    `${stats.sessions.toLocaleString()} workouts`,
    `${stats.sets.toLocaleString()} sets`,
    stats.volumeKg ? `${compactWeight(stats.volumeKg, UNIT)} ${UNIT}` : null,
    stats.trainedMs ? `${Math.round(stats.trainedMs / 3_600_000)} hours` : null,
    stats.firstDate ? `since ${stats.firstDate}` : null,
  ].filter(Boolean)

  return <p className="text-text-dim text-xs tabular-nums">{parts.join(' · ')}</p>
}
