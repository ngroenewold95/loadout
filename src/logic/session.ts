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

/** The least a set has to be to say whether it is one of the ones that count. */
interface Typed {
  setType?: string | null
}

/**
 * Does this set count toward the target, the totals and the trend?
 *
 * **The test is negative on purpose, and this is the reason it lives in one
 * place.** All 6,209 imported rows carry `set_type = 'unknown'`, because the
 * export has no such column and nothing in the app wrote one until warm-ups
 * existed. A positive test - `setType === 'working'` - would therefore erase
 * five years of history from every total on the day warm-ups shipped.
 *
 * A warm-up is still a set that happened. It stays in `listSessionSets`, on the
 * summary and in the share text; what it leaves is every number that is a claim
 * about how hard the session was, and every rule that decides what to do next.
 */
export function isWorkingSet(set: Typed): boolean {
  return set.setType !== 'warmup'
}

/** The least a set has to be to count toward one. */
interface Counted extends Typed {
  exerciseId: number
}

/** How many sets each exercise carries. One pass, not one filter per exercise. */
function countByExercise(sets: readonly Counted[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const set of sets) {
    // A warm-up must not move the fraction in the header or satisfy a target,
    // or three warm-ups would auto-advance past an exercise never worked.
    if (!isWorkingSet(set)) continue
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
 * How many sets an exercise added by hand should ask for.
 *
 * **The rest of this workout's answer, not a constant.** An exercise added
 * mid-session with no target could never be complete - `isComplete` says so
 * above, deliberately - so auto-advance kept returning to it and only `Finish`
 * ended the workout. That was recorded as a rough edge when the picker was
 * built and this is the fix: adding an exercise means "one more of these",
 * so it inherits what everything else here is doing.
 *
 * The most common target wins, ties going to the smaller number, because
 * over-asking traps the workout again in a smaller way: a target of 3 among
 * twos leaves an exercise that reads incomplete after the sets that were
 * actually wanted. Null only when nothing in the workout has a target at all,
 * and then the honest answer really is "nobody decided".
 */
export function defaultTargetSets(planned: readonly Targeted[]): number | null {
  const counts = new Map<number, number>()
  for (const exercise of planned) {
    if (exercise.targetSets == null) continue
    counts.set(exercise.targetSets, (counts.get(exercise.targetSets) ?? 0) + 1)
  }

  let best: number | null = null
  let bestCount = 0
  for (const [target, count] of counts) {
    if (count > bestCount || (count === bestCount && best != null && target < best)) {
      best = target
      bestCount = count
    }
  }
  return best
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
interface Totalled extends Typed {
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
  /**
   * Every rep performed, assistance included.
   *
   * Unlike volume, a rep is a rep whichever direction the load runs, so an
   * Assisted Chinup contributes its reps here and nothing to the volume above.
   * A set logged by duration or distance carries no reps and adds nothing.
   */
  reps: number
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
 *
 * **Warm-ups leave every number here, including the rep count.** Unlike
 * assistance, which is a real set loaded the other way round, a warm-up is not
 * a claim about what the session came to at all. An exercise reached only by
 * warm-ups is not part of the workout either, so it does not count toward
 * `exercises`.
 */
export function sessionTotals(sets: readonly Totalled[]): SessionTotals {
  let volumeKg = 0
  let reps = 0
  let counted = 0
  const exercises = new Set<number>()

  for (const set of sets) {
    if (!isWorkingSet(set)) continue
    counted++
    exercises.add(set.exerciseId)
    reps += set.reps ?? 0
    if (set.loadMode === 'assistance') continue
    if (set.weightKg == null || set.reps == null) continue
    volumeKg += set.weightKg * set.reps
  }

  return { sets: counted, exercises: exercises.size, volumeKg, reps }
}

/** The least a set has to be to be grouped under its exercise. */
interface Groupable {
  exerciseId: number
  exerciseName: string
  primaryMuscle: string | null
}

export interface ExerciseGroup<T> {
  exerciseId: number
  name: string
  primaryMuscle: string | null
  sets: T[]
}

/**
 * A session's sets, gathered under each exercise in the order performed.
 *
 * The summary screen and the share text both need this and must not disagree
 * about it, which is the same argument that put `describeSet` in one place.
 *
 * **The order is first-performed, not sorted.** `order_index` follows what
 * actually happened, so a superset interleaves truthfully in the rows; grouping
 * by first appearance lists each exercise once without pretending the sets came
 * in blocks.
 */
export function groupByExercise<T extends Groupable>(
  sets: readonly T[],
): ExerciseGroup<T>[] {
  const groups: ExerciseGroup<T>[] = []
  for (const set of sets) {
    let group = groups.find((g) => g.exerciseId === set.exerciseId)
    if (!group) {
      group = {
        exerciseId: set.exerciseId,
        name: set.exerciseName,
        primaryMuscle: set.primaryMuscle,
        sets: [],
      }
      groups.push(group)
    }
    group.sets.push(set)
  }
  return groups
}
