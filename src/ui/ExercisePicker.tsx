/**
 * Pick an exercise: to add one to the workout, or to swap one out.
 *
 * `searchExercises` has been written, tested and ordered by recency since the
 * repo layer landed, with no caller at all. This is the caller.
 *
 * **Recency is the ordering, not the alphabet.** 87 exercises with five years
 * behind them means the one you want is nearly always one you did recently, and
 * an A-Z list would put `Assisted Chinup` above it every time. The search box
 * is there for the exception.
 */
import { useState } from 'react'
import {
  useEditSessionPlan,
  useExerciseSearch,
  useSessionExercises,
} from '../state/queries.ts'
import { relativeDay } from '../logic/dates.ts'
import { localDateOf } from '../db/repo.ts'
import { useNav } from '../state/nav.ts'
import { MuscleBadge } from './MuscleBadge.tsx'

/**
 * The picker wired to a live workout.
 *
 * Separate from the list itself so the list stays a plain component the
 * template editor can reuse later without dragging session mutations with it.
 */
export function SessionExercisePicker({
  sessionId,
  replacing,
}: {
  sessionId: number
  /** Set when swapping this exercise out rather than appending a new one. */
  replacing?: number
}) {
  const { data: planned } = useSessionExercises(sessionId)
  const { add, replace } = useEditSessionPlan(sessionId)
  const back = useNav((s) => s.back)

  const inWorkout = (planned ?? []).map((p) => p.exerciseId)

  return (
    <ExercisePicker
      // When replacing, the exercise being swapped out is not "already in the
      // workout" in a way that should block anything else - but picking it
      // would be a no-op, so it stays excluded along with the rest.
      excludeIds={inWorkout}
      onPick={async (exerciseId) => {
        if (replacing != null) {
          await replace.mutateAsync({ exerciseId: replacing, withExerciseId: exerciseId })
        } else {
          await add.mutateAsync({ exerciseId })
        }
        back()
      }}
    />
  )
}

interface Props {
  /** Already in the workout: shown, but not addable twice. */
  excludeIds?: number[]
  onPick: (exerciseId: number) => void
}

export function ExercisePicker({ excludeIds = [], onPick }: Props) {
  const [term, setTerm] = useState('')
  const { data: results, isLoading } = useExerciseSearch(term)
  const today = localDateOf()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-5 pb-3">
        <input
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search exercises"
          // autoFocus is deliberately absent: opening the keyboard immediately
          // would hide the recency list, which is the answer most of the time.
          className="bg-field text-text placeholder:text-text-dim w-full rounded-xl px-4 py-3 text-base"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {isLoading && <p className="text-text-dim text-sm">Loading…</p>}

        {results?.length === 0 && (
          <p className="text-text-dim text-sm">Nothing matches “{term}”.</p>
        )}

        <div className="flex flex-col gap-2">
          {(results ?? []).map((exercise) => {
            const already = excludeIds.includes(exercise.id)
            return (
              <button
                key={exercise.id}
                type="button"
                disabled={already}
                onClick={() => onPick(exercise.id)}
                className="bg-surface-1 active:bg-surface-3 flex items-center gap-3 rounded-xl px-3 py-3 text-left disabled:opacity-40"
              >
                <MuscleBadge primaryMuscle={exercise.primaryMuscle} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{exercise.name}</span>
                  <span className="text-text-dim block text-xs">
                    {already
                      ? 'already in this workout'
                      : exercise.lastPerformedAtUtc == null
                        ? 'never performed'
                        : `${relativeDay(
                            localDateOf(new Date(exercise.lastPerformedAtUtc)),
                            today,
                          )} · ${exercise.setCount} sets`}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
