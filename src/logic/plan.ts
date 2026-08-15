/**
 * The current training programme, as a seed for the templates table.
 *
 * This is a SEED, not a runtime source of truth. It is written into `templates`
 * once, and from then on the database owns them - the in-app template editor
 * has to have something to edit, and a file that silently overwrote it every
 * launch would undo every change the moment it was made.
 *
 * Replaces the Day 1 / Day 2 / Day 3 split that was seeded from history. That
 * history is still valid as history; it is simply no longer the programme.
 *
 * `exercise` values are exact `exercises.name` strings. 20 of the 21 already
 * exist with real history behind them, which is the point - the last-session
 * panel is populated from day one. Two names in the source plan were ambiguous
 * and are resolved to the variant actually in current use:
 *
 *   "Hammer curl"    -> Incline Dumbbell Hammer Curl  (used through 2026-07-22;
 *                       plain `Dumbbell Hammer Curl` was last touched in 2022)
 *   "Cable pushdown" -> Cable Pushdown (with Bar Handle)  (2026-07-19; the rope
 *                       handle variant was last used in 2024)
 *
 * Do not "tidy" these into one exercise each. PROJECT.md records why the
 * short-lived name inside a long-lived one's span is a distinct exercise.
 *
 * **Reconciled 2026-08-13 against the app itself**, read out of
 * `Examples/progression.*.pgnbkp` by `npm run analyze:backup`. This file had
 * been encoded from the written `Examples/Plan.md` and never checked against
 * what Progression was actually running, and the two had diverged: nine rep
 * ranges, the Day B ordering, and every rest value. The app wins, because the
 * app is what the last four sessions were logged against.
 */

/**
 * Rest bands from the written programme header:
 * 3-5 min heavy compounds · 2-3 min machines · 60-90s isolation/core.
 *
 * **These are no longer what the plan seeds.** Day B in the app carries
 * explicit per-movement rests of 240 / 180 / 120 / 90 s, which three buckets
 * cannot express, so `PlannedExercise` now holds seconds directly. This is kept
 * because `seedPlan` still needs a default for an exercise it has to create,
 * and because Day A's inferred values below are drawn from it.
 */
export const REST_S = {
  compound: 240,
  machine: 150,
  isolation: 75,
} as const

export interface PlannedExercise {
  /** Exact `exercises.name`. Created on seed if it does not exist yet. */
  exercise: string
  sets: number
  repMin: number
  repMax: number
  /**
   * Rest in seconds, straight into `template_exercises.rest_s`.
   *
   * Day B's values are measured off the app. **Day A's are inferred** - see the
   * comment on that day.
   */
  restS: number
  notes?: string
}

export interface PlannedDay {
  name: string
  /** The day's own description in the app, into `templates.notes`. */
  notes?: string
  exercises: PlannedExercise[]
}

/**
 * Exercises the plan introduces that have no history at all.
 *
 * Only one, which is why the switch is cheap. Everything else inherits five
 * years of sets, its history-seeded rest default and its load mode.
 *
 * `Pallof Press` has since been performed and now arrives from the export like
 * any other exercise, so this entry is historical. It stays because `seedPlan`
 * only creates what is missing, and because a re-import against an export
 * predating 2026-08-13 still needs it.
 */
export const NEW_EXERCISES = [
  { name: 'Pallof Press', trackingType: 'weight_reps', loadMode: 'total' },
] as const

/**
 * Two days, rotated A/B/A/B rolling - deliberately NOT tied to weekdays.
 * `nextTemplate` in the repo picks whichever was performed less recently.
 */
export const PLAN: PlannedDay[] = [
  {
    /**
     * Exercise order and rep ranges are the app's, verbatim.
     *
     * **The rest values are inferred, not measured.** Every movement on this
     * day has no rest set in Progression, so it falls back to the global
     * `restPeriod` of 120 s - which is plainly not the intent for a Trap Bar
     * Deadlift when the written plan says 3-5 min for heavy compounds and the
     * app's own Day B gives the RDL 240 s. So the `REST_S` bands are applied
     * here. Do not read these as coming off the backup; the other day's do.
     */
    name: 'Day A - Trap Bar',
    exercises: [
      { exercise: 'Trap Bar Deadlift', sets: 2, repMin: 5, repMax: 8, restS: REST_S.compound },
      { exercise: 'Smith Machine Bulgarian Split Squat', sets: 2, repMin: 5, repMax: 8, restS: REST_S.compound },
      { exercise: 'Smith Machine Incline Bench Press', sets: 2, repMin: 5, repMax: 8, restS: REST_S.compound },
      { exercise: 'Bent-Over Barbell Row', sets: 2, repMin: 5, repMax: 8, restS: REST_S.compound },
      { exercise: 'Machine Shoulder Press', sets: 2, repMin: 5, repMax: 8, restS: REST_S.machine },
      { exercise: 'Assisted Pullup', sets: 2, repMin: 5, repMax: 8, restS: REST_S.machine },
      // Standing, i.e. the plain `Machine Calf Raise`. The `(Seated)` variant is
      // a separate exercise and appears on Day B.
      { exercise: 'Machine Calf Raise', sets: 2, repMin: 10, repMax: 15, restS: REST_S.isolation },
      {
        exercise: 'Pallof Press',
        sets: 2,
        repMin: 6,
        repMax: 10,
        restS: REST_S.isolation,
        notes: '10 each side',
      },
      { exercise: 'Incline Dumbbell Hammer Curl', sets: 2, repMin: 5, repMax: 8, restS: REST_S.isolation },
      { exercise: 'Chest Dip', sets: 2, repMin: 5, repMax: 8, restS: REST_S.machine },
    ],
  },
  {
    /**
     * Order, rep ranges and rests are all measured off the app. The rests do
     * not fit three bands - 240 / 180 / 120 / 90 - which is why the band enum
     * stopped being the storage format.
     */
    name: 'Day B - RDL',
    notes: 'Skip leg curls and calves under high load',
    exercises: [
      { exercise: 'Romanian Deadlift', sets: 2, repMin: 5, repMax: 8, restS: 240 },
      { exercise: 'Machine Leg Curl', sets: 2, repMin: 5, repMax: 8, restS: 180 },
      { exercise: 'Machine Single-Leg Extension', sets: 2, repMin: 5, repMax: 8, restS: 180 },
      { exercise: 'Machine Calf Raise (Seated)', sets: 2, repMin: 6, repMax: 10, restS: 120 },
      { exercise: 'Machine Chest Press', sets: 2, repMin: 5, repMax: 8, restS: 180 },
      { exercise: 'Machine Row', sets: 2, repMin: 5, repMax: 8, restS: 180 },
      { exercise: 'Machine Lateral Raise', sets: 2, repMin: 5, repMax: 8, restS: 120 },
      { exercise: 'Cable Face Pull', sets: 2, repMin: 6, repMax: 10, restS: 90 },
      { exercise: 'Machine Preacher Curl', sets: 2, repMin: 5, repMax: 8, restS: 90 },
      { exercise: 'Cable Pushdown (with Bar Handle)', sets: 2, repMin: 5, repMax: 8, restS: 90 },
      { exercise: 'Cable Crunch', sets: 2, repMin: 5, repMax: 8, restS: 90 },
    ],
  },
]

/**
 * The programme's progression rule, in one place:
 * "hit the top of the range on both sets -> increase load".
 *
 * Pure so the logging screen and any future review can share one definition of
 * "earned". `reps` is every working set of that exercise in the session.
 */
export function shouldIncreaseLoad(
  reps: number[],
  targetSets: number,
  repMax: number,
): boolean {
  if (reps.length < targetSets) return false
  // Only the prescribed number of sets counts; extra sets do not lower the bar.
  return reps.slice(0, targetSets).every((r) => r >= repMax)
}

/** The least a planned exercise has to be to say whether it earned load. */
interface Prescribed {
  exerciseId: number
  targetSets: number | null
  targetRepMax: number | null
}

/** The least a past session has to be. `sets` is that session's sets only. */
interface PastSession {
  localDate: string
  sets: readonly { reps: number | null }[]
}

/**
 * Which exercises of a whole template earned more load last time.
 *
 * The same fold `ExerciseView` does inline for the exercise on screen, applied
 * across a template so Home can say what is waiting before the workout starts.
 * Generic over the minimum shape rather than importing the repo's row types,
 * which is the rule `logic/` keeps and what lets this be tested with plain
 * objects.
 *
 * **Only the most recent session counts**, and an exercise with no history at
 * all cannot earn anything - there is nothing to have hit the top of.
 * `targetRepMax` null means the exercise carries no rep goal, so no goal was
 * met; that is the case for an exercise added to a workout by hand.
 *
 * **`since` is what keeps this current rather than archaeological.** Without it
 * an exercise dropped from the programme a year ago still reports that it earned
 * more load, on the strength of a session nobody remembers - and after a long
 * enough layoff the old top of the range says nothing about what is possible
 * today. Omitting it considers every exercise's last session however old.
 */
export function earnedIncreases(
  planned: readonly Prescribed[],
  recent: ReadonlyMap<number, readonly PastSession[]>,
  opts: { since?: string } = {},
): number[] {
  const earned: number[] = []
  for (const exercise of planned) {
    if (exercise.targetRepMax == null) continue
    const last = recent.get(exercise.exerciseId)?.[0]
    if (!last || last.sets.length === 0) continue
    if (opts.since != null && last.localDate < opts.since) continue
    const reps = last.sets.map((s) => s.reps ?? 0)
    if (shouldIncreaseLoad(reps, exercise.targetSets ?? reps.length, exercise.targetRepMax)) {
      earned.push(exercise.exerciseId)
    }
  }
  return earned
}
