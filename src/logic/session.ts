/**
 * Arithmetic over a whole session: where to go next, and what was done.
 *
 * Pure, and generic over the minimum shape each function needs rather than
 * importing `PerformedSet` from `db/repo.ts`. That is the rule `logic/` keeps
 * (see `slots.ts`) and it is what lets these be tested with plain objects.
 */

/** The least an exercise has to be to say whether it is finished. */
interface Targeted {
  exerciseId: number
  targetSets: number | null
}

/** The least a set has to be to count toward one. */
interface Counted {
  exerciseId: number
}

/** How many sets each exercise carries. One pass, not one filter per exercise. */
function countByExercise(sets: readonly Counted[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const set of sets) {
    counts.set(set.exerciseId, (counts.get(set.exerciseId) ?? 0) + 1)
  }
  return counts
}

/**
 * Has this exercise had every set it asked for?
 *
 * **A null target is never complete**, and that is deliberate rather than an
 * oversight: no target means nothing decided how many sets there should be, so
 * the app is not entitled to declare it finished. The programme always sets one,
 * so this only bites on an exercise added by hand.
 */
export function isComplete(planned: Targeted, setCount: number): boolean {
  return planned.targetSets != null && setCount >= planned.targetSets
}

/**
 * Where logging the last set of exercise `from` should move to.
 *
 * **The next INCOMPLETE exercise, not `from + 1`.** Going back to add a set to
 * something earlier would otherwise leave you parked at the end of the list with
 * the finished exercises between you and the one that still needs work, so the
 * search wraps.
 *
 * `from` itself is excluded, because the only caller is "this exercise just
 * became complete". Null means there is nothing incomplete left anywhere, which
 * is the signal to go to the summary.
 */
export function nextIncompleteIndex(
  planned: readonly Targeted[],
  sets: readonly Counted[],
  from: number,
): number | null {
  if (planned.length === 0) return null
  const counts = countByExercise(sets)

  // Starting at 1, so `from` is the one index never tried.
  for (let step = 1; step < planned.length; step++) {
    const at = (from + step) % planned.length
    const exercise = planned[at]
    if (!isComplete(exercise, counts.get(exercise.exerciseId) ?? 0)) return at
  }
  return null
}

/** The least a set has to be to be totalled. */
interface Totalled {
  exerciseId: number
  weightKg: number | null
  reps: number | null
  loadMode: string
}

export interface SessionTotals {
  sets: number
  exercises: number
  /** Sum of weight × reps, in kg. See below for what is deliberately left out. */
  volumeKg: number
}

/**
 * What a session added up to.
 *
 * **`assistance` sets are excluded from volume, not added to it.** 420 sets in
 * the imported history record machine assistance, where a *higher* number is an
 * easier set - an Assisted Chinup went from 115 lb in 2023 to 20 lb in 2026, and
 * that decline is the athlete getting stronger. Summing it as though it were
 * load would make a good session look like a small one, and would make progress
 * look like decline. There is no honest single number that mixes the two, so the
 * count reports them and the volume does not.
 */
export function sessionTotals(sets: readonly Totalled[]): SessionTotals {
  let volumeKg = 0
  const exercises = new Set<number>()

  for (const set of sets) {
    exercises.add(set.exerciseId)
    if (set.loadMode === 'assistance') continue
    if (set.weightKg == null || set.reps == null) continue
    volumeKg += set.weightKg * set.reps
  }

  return { sets: sets.length, exercises: exercises.size, volumeKg }
}
