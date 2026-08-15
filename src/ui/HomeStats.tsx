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
import { useHistoryStats, useReadyToAddLoad, useSetsByMuscle } from '../state/queries.ts'
import { localDateOf } from '../db/repo.ts'
import { relativeDay } from '../logic/dates.ts'
import { muscleMark } from '../logic/muscles.ts'
import { compactWeight, type Unit } from '../logic/units.ts'
import { GroupWord } from './GroupTag.tsx'

const UNIT: Unit = 'lb'

export function HomeStats() {
  return (
    <div className="flex flex-col gap-3">
      <ReadyToAddLoad />
      <Cadence />
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
