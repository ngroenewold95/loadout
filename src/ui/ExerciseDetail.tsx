/**
 * One exercise: what it is, how to do it, and everything ever logged of it.
 *
 * The first screen in the app to read the five years back for a single
 * movement. It is one statement per question and none of them run in a loop:
 * `exerciseStats` is scalar aggregates, `exerciseHistory` is the same
 * `DENSE_RANK` window function the logging screen depends on, paged by whole
 * sessions so `Load more` can never show half of one.
 *
 * **The best set inverts for assistance.** A higher number on an Assisted
 * Chinup is an easier set, so the repo returns the heaviest load and the least
 * assistance as separate columns and this screen labels whichever it got. A
 * single "best" would read backwards for 420 sets of the imported history.
 */
import { useState } from 'react'
import {
  useExerciseDetail,
  useExerciseHistory,
  useExerciseSessions,
  useExerciseStats,
} from '../state/queries.ts'
import { localDateOf } from '../db/repo.ts'
import { formatDuration } from '../logic/entry.ts'
import { bestOf, stallOf, trendSeries, type BestPoint } from '../logic/trend.ts'
import { compactWeight, formatWeight, type Unit } from '../logic/units.ts'
import { CueList } from './CueList.tsx'
import { GroupRail, GroupWord } from './GroupTag.tsx'
import { HistoryCard } from './HistoryCard.tsx'
import { Stat } from './Stat.tsx'
import { TrendChart } from './TrendChart.tsx'

/** Sessions per page. `Load more` adds another page of whole sessions. */
const PAGE = 10

/** Weight and assistance are the two measures the tile's `unit` applies to. */
function isWeight(best: BestPoint): boolean {
  return best.measure === 'weight' || best.measure === 'assistance'
}

/**
 * The best set as one short string.
 *
 * Reps and distance carry their word here rather than through `Stat`'s `unit`,
 * which is a weight unit and only ever kg or lb.
 */
function bestValue(best: BestPoint, unit: Unit): string {
  switch (best.measure) {
    case 'weight':
    case 'assistance':
      return formatWeight(best.value, unit)
    case 'duration':
      return formatDuration(best.value)
    case 'distance':
      return `${Math.round(best.value) / 1000} km`
    default:
      return String(best.value)
  }
}

export function ExerciseDetail({ exerciseId }: { exerciseId: number }) {
  const [sessions, setSessions] = useState(PAGE)
  const { data: exercise } = useExerciseDetail(exerciseId)
  const { data: stats } = useExerciseStats(exerciseId)
  const { data: history, isFetching } = useExerciseHistory(exerciseId, sessions)
  // Every session at once, oldest first. It is one statement over a few hundred
  // rows for the whole five years, which is cheaper than the paged history the
  // list below it reads.
  const { data: trend } = useExerciseSessions(exerciseId)
  const today = localDateOf()

  if (!exercise) {
    return <p className="text-text-dim px-5 py-8 text-sm">Loading…</p>
  }

  const unit: Unit = exercise.preferredUnit ?? 'lb'

  /**
   * The best set comes out of the same series the chart draws, not out of a
   * second query with its own opinion. `trendSeries` is pure and already
   * decides which number this exercise is judged by, so calling it twice on the
   * same rows costs nothing and cannot disagree with the chart below.
   */
  const series = trendSeries(trend ?? [], exercise.trackingType, exercise.loadMode)
  const best = bestOf(series)
  // Same series again, and for the same reason: one definition of "better" in
  // the app rather than one per screen. The assistance inversion comes with it.
  const stall = stallOf(series)

  return (
    <div className="pb-safe-b min-h-0 flex-1 overflow-y-auto px-5 pt-1">
      <div className="flex items-stretch gap-3">
        <GroupRail primaryMuscle={exercise.primaryMuscle} />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{exercise.name}</h2>
          <GroupWord primaryMuscle={exercise.primaryMuscle} />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Sets" value={String(stats?.totalSets ?? 0)} />
        <Stat label="Sessions" value={String(stats?.sessionCount ?? 0)} />
        <Stat
          // The label carries the inversion and the measure, so the number
          // never has to be read against the wrong idea of better.
          label={best?.label ?? 'Best'}
          value={best ? bestValue(best, unit) : '-'}
          unit={best && isWeight(best) ? unit : undefined}
          sub={best?.localDate}
        />
      </div>

      {stats && stats.totalSets > 0 && (
        <p className="text-text-dim mt-2 text-xs">
          {[
            stats.firstDate && stats.lastDate
              ? `${stats.firstDate} to ${stats.lastDate}`
              : null,
            // Not repeated when the tile above IS the rep count.
            stats.bestReps != null && best?.measure !== 'reps'
              ? `most reps ${stats.bestReps}`
              : null,
            stats.volumeKg ? `${compactWeight(stats.volumeKg, unit)} ${unit} lifted` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      {/* The thing a coach would notice and the app could not say. It sits
          directly under the tiles because it is about the number in the one
          beside it: the best set, and how long it has stood. Nothing renders
          while the line is still going up. */}
      {stall && (
        <p className="mt-3 rounded-xl bg-amber-950 px-3 py-2 text-sm text-amber-300">
          No new best in {stall.sessions} sessions, since {stall.since}.
        </p>
      )}

      {/* Above the cues and the session list, because it answers the question
          the screen is opened with: which way is this going. It renders nothing
          at all for an exercise with no plottable session. */}
      <section className="mt-6">
        <TrendChart
          sessions={trend}
          trackingType={exercise.trackingType}
          loadMode={exercise.loadMode}
          unit={unit}
        />
      </section>

      <section className="mt-6">
        <h3 className="text-text-dim text-xs tracking-wide uppercase">How to do it</h3>
        {/* Only the programme's own exercises are authored, so the empty case
            says so rather than leaving a heading over nothing. */}
        <CueList guidance={exercise.guidance} />
      </section>

      <section className="mt-6">
        <h3 className="text-text-dim text-xs tracking-wide uppercase">Every session</h3>
        {history?.length === 0 && (
          <p className="text-text-dim mt-2 text-sm">Never performed.</p>
        )}
        <div className="mt-2 flex flex-col gap-2">
          {(history ?? []).map((session) => (
            <HistoryCard
              key={session.sessionId}
              localDate={session.localDate}
              today={today}
              sets={session.sets}
              unit={unit}
            />
          ))}
        </div>
        {/* Grown rather than paged with a cursor, the way `All workouts` does
            it: the database is a local file and re-reading a few sessions
            costs less than the code to avoid it would. */}
        {history && history.length >= sessions && (
          <button
            type="button"
            className="text-text-dim active:text-text mt-3 px-2 py-1 text-sm"
            disabled={isFetching}
            onClick={() => setSessions((n) => n + PAGE)}
          >
            Load more
          </button>
        )}
      </section>

      {/* Clears the gesture bar. A `pb-6` on the container would
          overwrite `pb-safe-b`, since both set padding-bottom. */}
      <div className="pb-6" />
    </div>
  )
}
