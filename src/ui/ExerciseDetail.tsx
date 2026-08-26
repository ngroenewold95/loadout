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
import { useExerciseDetail, useExerciseHistory, useExerciseStats } from '../state/queries.ts'
import { localDateOf } from '../db/repo.ts'
import { compactWeight, formatWeight, type Unit } from '../logic/units.ts'
import { GroupRail, GroupWord } from './GroupTag.tsx'
import { HistoryCard } from './HistoryCard.tsx'
import { Stat } from './Stat.tsx'

/** Sessions per page. `Load more` adds another page of whole sessions. */
const PAGE = 10

export function ExerciseDetail({ exerciseId }: { exerciseId: number }) {
  const [sessions, setSessions] = useState(PAGE)
  const { data: exercise } = useExerciseDetail(exerciseId)
  const { data: stats } = useExerciseStats(exerciseId)
  const { data: history, isFetching } = useExerciseHistory(exerciseId, sessions)
  const today = localDateOf()

  if (!exercise) {
    return <p className="text-text-dim px-5 py-8 text-sm">Loading…</p>
  }

  const unit: Unit = exercise.preferredUnit ?? 'lb'
  const cues = (exercise.guidance ?? '').split('\n').filter((line) => line.trim().length > 0)
  const assisted = exercise.loadMode === 'assistance'
  const best = assisted ? stats?.leastAssistKg : stats?.bestWeightKg

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
          // The label carries the inversion, so the number never has to be
          // read against the wrong idea of better.
          label={assisted ? 'Least assist' : 'Best'}
          value={best != null ? formatWeight(best, unit) : '-'}
          unit={best != null ? unit : undefined}
        />
      </div>

      {stats && stats.totalSets > 0 && (
        <p className="text-text-dim mt-2 text-xs">
          {[
            stats.firstDate && stats.lastDate
              ? `${stats.firstDate} to ${stats.lastDate}`
              : null,
            stats.bestReps != null ? `most reps ${stats.bestReps}` : null,
            stats.volumeKg ? `${compactWeight(stats.volumeKg, unit)} ${unit} lifted` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      <section className="mt-6">
        <h3 className="text-text-dim text-xs tracking-wide uppercase">How to do it</h3>
        {cues.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-2">
            {cues.map((cue) => (
              <li key={cue} className="flex gap-2 text-sm">
                <span className="text-text-dim" aria-hidden="true">
                  ·
                </span>
                <span>{cue}</span>
              </li>
            ))}
          </ul>
        ) : (
          // Only the programme's own exercises are authored. The rest say so
          // rather than showing an empty heading.
          <p className="text-text-dim mt-2 text-sm">No guidance yet.</p>
        )}
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
